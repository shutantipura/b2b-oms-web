-- Unified LINE onboarding: one assigned role per LINE account, with staff
-- records retained for order/task attribution and created automatically.
ALTER TABLE public.line_users ADD COLUMN IF NOT EXISTS assigned_role text;
ALTER TABLE public.line_users DROP CONSTRAINT IF EXISTS line_users_assigned_role_check;
ALTER TABLE public.line_users ADD CONSTRAINT line_users_assigned_role_check
 CHECK (assigned_role IS NULL OR assigned_role IN ('manager','salesman','staff','customer'));

-- In old mixed accounts, staff authorization takes precedence. Preserve
-- customer link history, but disable its grants for non-customer roles.
UPDATE public.line_users lu SET assigned_role=COALESCE(
 (SELECT s.account_type FROM public.staff_line_users slu
  JOIN public.staff s ON s.id=slu.staff_id
  WHERE slu.line_user_id=lu.line_user_id AND slu.is_authorized AND s.is_active
  ORDER BY slu.updated_at DESC LIMIT 1),
 CASE WHEN lu.all_customers_access OR EXISTS
  (SELECT 1 FROM public.customer_line_users clu
   WHERE clu.line_user_id=lu.id AND clu.can_order)
 THEN 'customer' ELSE NULL END)
WHERE lu.assigned_role IS NULL;

UPDATE public.customer_line_users clu SET can_order=false
 FROM public.line_users lu WHERE clu.line_user_id=lu.id
 AND lu.assigned_role IS DISTINCT FROM 'customer' AND clu.can_order;
-- Existing customer-only "all" access becomes explicit links; no future grants.
UPDATE public.line_users SET all_customers_access=false
 WHERE all_customers_access=true;

-- One staff identity per authorized LINE account; split old shared staff records
-- without altering historical orders/task ownership. Future login provisions
-- each new staff identity's own Auth user.
DO $split$
DECLARE v record; n integer; new_staff uuid; new_code text;
BEGIN
 PERFORM pg_advisory_xact_lock(112233,445566);
 FOR v IN
  SELECT slu.id AS link_id, slu.staff_id, s.staff_name,s.account_type,s.is_active
  FROM public.staff_line_users slu
  JOIN public.staff s ON s.id=slu.staff_id
  WHERE slu.is_authorized AND (
   SELECT count(*) FROM public.staff_line_users x
   WHERE x.staff_id=slu.staff_id AND x.is_authorized AND
     (x.created_at,x.id) < (slu.created_at,slu.id)
  ) > 0
  ORDER BY slu.created_at,slu.id
 LOOP
  SELECT COALESCE(MAX(substring(staff_code from '^S([0-9]+)$')::integer),0)+1
   INTO n FROM public.staff WHERE staff_code ~ '^S[0-9]+$';
  new_code := 'S'||lpad(n::text,3,'0');
  INSERT INTO public.staff(staff_code,staff_name,account_type,is_active)
   VALUES(new_code,v.staff_name,v.account_type,v.is_active) RETURNING id INTO new_staff;
  INSERT INTO public.staff_task_permissions(staff_id,stage)
   SELECT new_staff,stage FROM public.staff_task_permissions WHERE staff_id=v.staff_id
   ON CONFLICT DO NOTHING;
  UPDATE public.staff_line_users SET staff_id=new_staff,updated_at=now()
   WHERE id=v.link_id;
 END LOOP;
END $split$;

CREATE OR REPLACE FUNCTION public.is_current_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT EXISTS(
  SELECT 1 FROM public.staff s JOIN public.staff_line_users slu ON slu.staff_id=s.id
  JOIN public.line_users lu ON lu.line_user_id=slu.line_user_id
  WHERE s.auth_user_id=(SELECT auth.uid()) AND s.account_type='manager'
   AND s.is_active AND slu.is_authorized AND lu.is_active
   AND lu.assigned_role='manager'
 );
$fn$;
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT public.is_current_manager(); $fn$;
-- Even a still-open prior session must not retain staff access after unassigning.
CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT s.id FROM public.staff s JOIN public.staff_line_users slu ON slu.staff_id=s.id
 JOIN public.line_users lu ON lu.line_user_id=slu.line_user_id
 WHERE s.auth_user_id=(SELECT auth.uid()) AND s.is_active AND slu.is_authorized
 AND lu.is_active AND lu.assigned_role=s.account_type
 LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.get_line_roles_admin()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_current_manager() THEN RAISE EXCEPTION 'Manager authorization required'; END IF;
 SELECT jsonb_build_object(
  'users',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',lu.id,'lineId',lu.line_user_id,'displayName',lu.display_name,
   'name',lu.internal_name,'role',lu.assigned_role,'active',lu.is_active,
   'createdAt',lu.created_at,
   'staffCode',(SELECT s.staff_code FROM public.staff_line_users slu
     JOIN public.staff s ON s.id=slu.staff_id WHERE slu.line_user_id=lu.line_user_id
     AND slu.is_authorized ORDER BY slu.updated_at DESC LIMIT 1),
   'stages',COALESCE((SELECT jsonb_agg(stp.stage ORDER BY stp.stage)
     FROM public.staff_line_users slu JOIN public.staff_task_permissions stp ON
       stp.staff_id=slu.staff_id
     WHERE slu.line_user_id=lu.line_user_id AND slu.is_authorized),'[]'::jsonb),
   'customerCodes',COALESCE((SELECT jsonb_agg(c.customer_code ORDER BY c.customer_code)
     FROM public.customer_line_users clu JOIN public.customers c ON c.id=clu.customer_id
     WHERE clu.line_user_id=lu.id AND clu.can_order),'[]'::jsonb)
  ) ORDER BY lu.created_at DESC) FROM public.line_users lu),'[]'::jsonb),
  'customers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'code',c.customer_code,'name',c.customer_name) ORDER BY c.customer_name)
   FROM public.customers c WHERE c.is_active),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END; $fn$;

CREATE OR REPLACE FUNCTION public.set_line_account_role(
 p_line_user_row_id uuid, p_name text, p_role text,
 p_stages text[] DEFAULT '{}', p_customer_codes text[] DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 line_record public.line_users%ROWTYPE;
 mgr_id uuid; target_staff_id uuid; previous_staff_id uuid; previous_role text;
 stage text; stage_count integer; customer_count integer;
 new_code text; n integer; display_name text;
BEGIN
 IF NOT public.is_current_manager() THEN RAISE EXCEPTION 'Manager account required'; END IF;
 SELECT id INTO mgr_id FROM public.staff WHERE auth_user_id=(SELECT auth.uid())
  AND account_type='manager' AND is_active LIMIT 1;
 IF p_role IS NOT NULL AND p_role NOT IN ('manager','staff','salesman','customer') THEN
  RAISE EXCEPTION 'Invalid LINE role'; END IF;
 display_name := nullif(btrim(coalesce(p_name,'')),'');
 IF display_name IS NULL OR length(display_name)>120 THEN
  RAISE EXCEPTION 'Internal name must have 1 to 120 characters'; END IF;
 IF coalesce(array_length(p_stages,1),0)>5 OR
    EXISTS(SELECT 1 FROM unnest(coalesce(p_stages,'{}'::text[])) x
       WHERE x NOT IN ('confirmation','picking','billing','delivery','payment_verification'))
 THEN RAISE EXCEPTION 'Invalid task stage'; END IF;
 IF p_role<>'staff' AND coalesce(array_length(p_stages,1),0)>0 THEN
  RAISE EXCEPTION 'Only Staff accounts may select task stages'; END IF;
 IF p_role IS DISTINCT FROM 'customer' AND coalesce(array_length(p_customer_codes,1),0)>0 THEN
  RAISE EXCEPTION 'Only Customer accounts may have selected customers'; END IF;
 IF coalesce(array_length(p_customer_codes,1),0)>250 THEN
  RAISE EXCEPTION 'Too many customer selections'; END IF;
 IF coalesce(array_length(p_customer_codes,1),0) !=
   (SELECT count(DISTINCT c.customer_code) FROM public.customers c
    WHERE c.customer_code=ANY(coalesce(p_customer_codes,'{}'::text[])) AND c.is_active)
 THEN RAISE EXCEPTION 'Customer selection includes a duplicate or inactive customer'; END IF;

 PERFORM pg_advisory_xact_lock(112233,445566);
 SELECT * INTO line_record FROM public.line_users WHERE id=p_line_user_row_id FOR UPDATE;
 IF NOT FOUND OR NOT line_record.is_active THEN RAISE EXCEPTION 'Active LINE identity not found'; END IF;
 previous_role := line_record.assigned_role;
 SELECT slu.staff_id INTO previous_staff_id FROM public.staff_line_users slu
  WHERE slu.line_user_id=line_record.line_user_id AND slu.is_authorized
  FOR UPDATE;
 IF previous_staff_id=mgr_id AND p_role IS DISTINCT FROM 'manager' THEN
  RAISE EXCEPTION 'You cannot remove your own Manager role'; END IF;
 IF previous_role='manager' AND p_role IS DISTINCT FROM 'manager' AND
   (SELECT count(DISTINCT s.id) FROM public.staff s
     JOIN public.staff_line_users sl ON sl.staff_id=s.id AND sl.is_authorized
     JOIN public.line_users lu ON lu.line_user_id=sl.line_user_id
     WHERE s.is_active AND s.account_type='manager' AND lu.is_active
      AND lu.assigned_role='manager')<=1
 THEN RAISE EXCEPTION 'Cannot revoke the last Manager'; END IF;

 -- Select or create a unique staff record, retaining historical staff IDs.
 IF p_role IN ('staff','manager','salesman') THEN
   target_staff_id := previous_staff_id;
   IF target_staff_id IS NULL THEN
     SELECT slu.staff_id INTO target_staff_id FROM public.staff_line_users slu
      WHERE slu.line_user_id=line_record.line_user_id LIMIT 1;
   END IF;
   IF target_staff_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_line_users x
      WHERE x.staff_id=target_staff_id AND x.is_authorized AND
      x.line_user_id<>line_record.line_user_id)
   THEN RAISE EXCEPTION 'Shared legacy staff identity: contact administrator to split'; END IF;
   IF target_staff_id IS NULL THEN
     SELECT COALESCE(MAX(substring(staff_code from '^S([0-9]+)$')::integer),0)+1
       INTO n FROM public.staff WHERE staff_code ~ '^S[0-9]+$';
     new_code := 'S'||lpad(n::text,3,'0');
     INSERT INTO public.staff(staff_code,staff_name,account_type,is_active)
       VALUES(new_code,display_name,p_role,true) RETURNING id INTO target_staff_id;
   ELSE
     UPDATE public.staff SET staff_name=display_name,account_type=p_role,
       is_active=true,updated_at=now() WHERE id=target_staff_id;
   END IF;
   INSERT INTO public.staff_line_users(staff_id,line_user_id,display_name,is_authorized,
    authorized_at,authorized_by,deauthorized_at,deauthorized_by)
   VALUES(target_staff_id,line_record.line_user_id,display_name,true,now(),mgr_id,null,null)
   ON CONFLICT(line_user_id) DO UPDATE SET staff_id=excluded.staff_id,
     display_name=excluded.display_name,is_authorized=true,
     authorized_at=now(),authorized_by=mgr_id,
     deauthorized_at=null,deauthorized_by=null,updated_at=now();
   DELETE FROM public.staff_task_permissions WHERE staff_id=target_staff_id;
   IF p_role='manager' THEN
     INSERT INTO public.staff_task_permissions(staff_id,stage)
     SELECT target_staff_id,unnest(ARRAY['confirmation','picking','billing','delivery','payment_verification']::text[])
     ON CONFLICT DO NOTHING;
   ELSIF p_role='staff' THEN
     INSERT INTO public.staff_task_permissions(staff_id,stage)
       SELECT target_staff_id,unnest(p_stages)
       ON CONFLICT DO NOTHING;
   END IF;
 ELSE
   UPDATE public.staff_line_users SET is_authorized=false,deauthorized_at=now(),
    deauthorized_by=mgr_id,updated_at=now()
    WHERE line_user_id=line_record.line_user_id AND is_authorized;
   -- No session may retain access after a role is withdrawn.
   IF previous_staff_id IS NOT NULL THEN
     UPDATE public.staff SET is_active=false,updated_at=now()
     WHERE id=previous_staff_id
       AND NOT EXISTS(SELECT 1 FROM public.staff_line_users slu
        WHERE slu.staff_id=previous_staff_id AND slu.is_authorized);
   END IF;
 END IF;

 UPDATE public.line_users SET internal_name=display_name,assigned_role=p_role,
  all_customers_access=false,updated_at=now()
 WHERE id=p_line_user_row_id;

 -- A staff role never has per-customer grants. Old inactive link rows remain
 -- for referential/audit continuity but cannot grant access.
 UPDATE public.customer_line_users SET can_order=false
 WHERE line_user_id=p_line_user_row_id AND can_order;
 IF p_role='customer' AND coalesce(array_length(p_customer_codes,1),0)>0 THEN
   INSERT INTO public.customer_line_users(line_user_id,customer_id,can_order)
    SELECT p_line_user_row_id,c.id,true FROM public.customers c
     WHERE c.customer_code=ANY(p_customer_codes) AND c.is_active
    ON CONFLICT(line_user_id,customer_id) DO UPDATE SET can_order=true;
 END IF;
 RETURN jsonb_build_object('ok',true,'role',p_role,'staffCode',
  (SELECT staff_code FROM public.staff WHERE id=target_staff_id));
END; $fn$;

REVOKE ALL ON FUNCTION public.get_line_roles_admin() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_line_account_role(uuid,text,text,text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_line_roles_admin() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_line_account_role(uuid,text,text,text[],text[]) TO authenticated,service_role;

-- Retire old authorization mutations: these allowed mixed staff/customer grants.
REVOKE EXECUTE ON FUNCTION public.set_line_staff_access(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.set_line_customer_access(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.set_line_all_customer_access(uuid,boolean) FROM PUBLIC,anon,authenticated;
