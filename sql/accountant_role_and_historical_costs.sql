-- Accountant access is separate from OMS Staff; no operational tasks or customer ordering.
-- This migration introduces no Accountant identities automatically.
ALTER TABLE public.line_users DROP CONSTRAINT IF EXISTS line_users_assigned_role_check;
ALTER TABLE public.line_users ADD CONSTRAINT line_users_assigned_role_check
CHECK (assigned_role IS NULL OR assigned_role IN ('manager','salesman','staff','customer','accountant'));

CREATE TABLE IF NOT EXISTS public.accountant_order_item_costs (
  order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id) ON DELETE RESTRICT,
  unit_cost numeric(16,4) NOT NULL CHECK(unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  entered_by_line_user_id uuid NOT NULL REFERENCES public.line_users(id)
);
CREATE TABLE IF NOT EXISTS public.accountant_cost_entry_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  old_unit_cost numeric(16,4),
  new_unit_cost numeric(16,4) NOT NULL CHECK(new_unit_cost >= 0),
  quantity_at_entry numeric,
  entered_by_line_user_id uuid NOT NULL REFERENCES public.line_users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accountant_cost_entry_audit_batch_idx
 ON public.accountant_cost_entry_audit(batch_id);
CREATE INDEX IF NOT EXISTS accountant_cost_entry_audit_item_idx
 ON public.accountant_cost_entry_audit(order_item_id);
CREATE INDEX IF NOT EXISTS accountant_cost_entry_audit_created_idx
 ON public.accountant_cost_entry_audit(created_at DESC);

ALTER TABLE public.accountant_order_item_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountant_cost_entry_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accountant_order_item_costs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.accountant_cost_entry_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.accountant_order_item_costs TO service_role;
GRANT ALL ON public.accountant_cost_entry_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.accountant_cost_entry_audit_id_seq TO service_role;

-- Neither a historical cost assignment nor its audit history may be silently
-- revised or removed. Corrections, if ever needed, require a separate
-- explicitly reviewed and audited reversal process.
CREATE OR REPLACE FUNCTION public.reject_accountant_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $fn$
BEGIN
 RAISE EXCEPTION 'Accountant cost history is immutable';
END $fn$;
REVOKE ALL ON FUNCTION public.reject_accountant_history_mutation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS accountant_cost_entries_immutable ON public.accountant_order_item_costs;
CREATE TRIGGER accountant_cost_entries_immutable
 BEFORE UPDATE OR DELETE ON public.accountant_order_item_costs
 FOR EACH ROW EXECUTE FUNCTION public.reject_accountant_history_mutation();
DROP TRIGGER IF EXISTS accountant_cost_audit_immutable ON public.accountant_cost_entry_audit;
CREATE TRIGGER accountant_cost_audit_immutable
 BEFORE UPDATE OR DELETE ON public.accountant_cost_entry_audit
 FOR EACH ROW EXECUTE FUNCTION public.reject_accountant_history_mutation();

-- A batch is all-or-nothing. Missing billing snapshots only; never overwrite
-- an existing billing snapshot, previously entered cost or master SKU cost.
CREATE OR REPLACE FUNCTION public.accountant_fill_missing_costs(
  p_actor_line_user_row_id uuid, p_order_item_ids uuid[],
  p_unit_cost numeric, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_count integer;

 v_row record;
 v_batch uuid := gen_random_uuid();
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.line_users
   WHERE id = p_actor_line_user_row_id AND assigned_role='accountant' AND is_active
 ) THEN RAISE EXCEPTION 'Active Accountant LINE role required'; END IF;
 IF p_unit_cost IS NULL OR p_unit_cost < 0 OR p_unit_cost > 99999999
 THEN RAISE EXCEPTION 'Invalid unit cost'; END IF;
 IF p_order_item_ids IS NULL OR cardinality(p_order_item_ids) < 1
   OR cardinality(p_order_item_ids) > 100
   OR (SELECT count(DISTINCT x) FROM unnest(p_order_item_ids) x) <> cardinality(p_order_item_ids)
 THEN RAISE EXCEPTION 'Select 1–100 different order lines'; END IF;
 IF length(coalesce(p_reason,'')) > 500 THEN RAISE EXCEPTION 'Reason is too long'; END IF;
 IF p_unit_cost=0 AND NULLIF(btrim(coalesce(p_reason,'')),'') IS NULL THEN
  RAISE EXCEPTION 'A zero unit cost requires an explanation'; END IF;
 -- Serialize overlapping batch attempts and preserve original snapshots.
 PERFORM 1 FROM public.order_items WHERE id=ANY(p_order_item_ids)
 ORDER BY id FOR UPDATE;
 SELECT count(*) INTO v_count
 FROM public.order_items oi
 JOIN public.orders o ON o.id=oi.order_id
 WHERE oi.id=ANY(p_order_item_ids) AND o.status='completed'
   AND oi.actual_qty > 0
   AND oi.unit_cost_at_billing IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.accountant_order_item_costs ac
                   WHERE ac.order_item_id=oi.id)
   AND EXISTS (SELECT 1 FROM public.order_history h
      WHERE h.order_id=COALESCE(o.group_root_order_id,o.id)
        AND h.action='billing_completed');
 IF v_count <> cardinality(p_order_item_ids)
 THEN RAISE EXCEPTION 'One or more selected lines are no longer eligible'; END IF;
 IF (SELECT count(DISTINCT oi.product_id) FROM public.order_items oi
     WHERE oi.id=ANY(p_order_item_ids))<>1
   OR (SELECT count(DISTINCT oi.unit_snapshot) FROM public.order_items oi
     WHERE oi.id=ANY(p_order_item_ids))<>1
 THEN RAISE EXCEPTION 'Batch must use one product and the same billed unit'; END IF;
 FOR v_row IN SELECT oi.id,oi.actual_qty FROM public.order_items oi
   WHERE oi.id=ANY(p_order_item_ids) ORDER BY oi.id LOOP
   INSERT INTO public.accountant_order_item_costs
    (order_item_id,unit_cost,entered_by_line_user_id)
   VALUES (v_row.id,p_unit_cost,p_actor_line_user_row_id);
   INSERT INTO public.accountant_cost_entry_audit
    (batch_id,order_item_id,old_unit_cost,new_unit_cost,quantity_at_entry,
     entered_by_line_user_id,reason)
   VALUES (v_batch,v_row.id,NULL,p_unit_cost,v_row.actual_qty,
     p_actor_line_user_row_id,NULLIF(btrim(coalesce(p_reason,'')),''));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'batchId',v_batch,'updatedLines',v_count,
   'costPerUnit',p_unit_cost);
END $fn$;
REVOKE ALL ON FUNCTION public.accountant_fill_missing_costs(uuid,uuid[],numeric,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accountant_fill_missing_costs(uuid,uuid[],numeric,text)
 TO service_role;

-- Existing managerial financial KPI calculates snapshots plus Accountant
-- corrections for historical lines. Sales/bills still require Completed status
-- and use original billing-date recognition.

CREATE OR REPLACE FUNCTION public.set_line_account_role(p_line_user_row_id uuid, p_name text, p_role text, p_stages text[] DEFAULT '{}'::text[], p_customer_codes text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 line_record public.line_users%ROWTYPE;
 mgr_id uuid; target_staff_id uuid; previous_staff_id uuid; previous_role text;
 stage text; stage_count integer; customer_count integer;
 new_code text; n integer; v_internal_name text;
BEGIN
 IF NOT public.is_current_manager() THEN RAISE EXCEPTION 'Manager account required'; END IF;
 SELECT id INTO mgr_id FROM public.staff WHERE auth_user_id=(SELECT auth.uid())
  AND account_type='manager' AND is_active LIMIT 1;
 IF p_role IS NOT NULL AND p_role NOT IN ('manager','staff','salesman','customer','accountant') THEN
  RAISE EXCEPTION 'Invalid LINE role'; END IF;
 v_internal_name := nullif(btrim(coalesce(p_name,'')),'');
 IF v_internal_name IS NULL OR length(v_internal_name)>120 THEN
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
       VALUES(new_code,v_internal_name,p_role,true) RETURNING id INTO target_staff_id;
   ELSE
     UPDATE public.staff SET staff_name=v_internal_name,account_type=p_role,
       is_active=true,updated_at=now() WHERE id=target_staff_id;
   END IF;
   INSERT INTO public.staff_line_users(staff_id,line_user_id,display_name,is_authorized,
    authorized_at,authorized_by,deauthorized_at,deauthorized_by)
   VALUES(target_staff_id,line_record.line_user_id,v_internal_name,true,now(),mgr_id,null,null)
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

 UPDATE public.line_users SET internal_name=v_internal_name,assigned_role=p_role,
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
END; $function$;

CREATE OR REPLACE FUNCTION public.get_financial_kpi_summary(p_bill_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not public.can_read_product_costs() then
    raise exception 'Manager access required';
  end if;
  with bill_events as (
    -- One billing event per commercial bill, including grouped /x orders.
    select h.order_id, min(h.created_at) as billed_at
    from public.order_history h
    where h.action = 'billing_completed'
    group by h.order_id
  ),
  billed as (
    select o.id, o.final_amount, o.group_root_order_id, e.billed_at
    from bill_events e
    join public.orders o on o.id = e.order_id
    -- A bill counts only after the entire commercial order has finished.
    -- Payment pending / delivery pending / cancelled bills are ineligible.
    where o.status = 'completed'
      and o.final_amount is not null
      and (o.group_root_order_id is null or o.group_root_order_id = o.id)
      -- A /x group counts as one bill only after every suborder completes.
      and not exists (
        select 1
        from public.orders member_check
        where member_check.group_root_order_id = o.id
          and member_check.status is distinct from 'completed'
      )
      and e.billed_at >= (p_bill_date::timestamp at time zone 'Asia/Bangkok')
      and e.billed_at < ((p_bill_date + 1)::timestamp at time zone 'Asia/Bangkok')
  ),
  bill_costs as (
    select
      b.id,
      b.final_amount,
      coalesce(c.known_cost, 0) as known_cost,
      coalesce(c.missing_cost_lines, 0) as missing_cost_lines,
      coalesce(c.changed_after_bill_lines, 0) as changed_after_bill_lines,
      coalesce(c.unsnapshotted_cost_lines, 0) as unsnapshotted_cost_lines,
      coalesce(c.suspicious_cost_lines, 0) as suspicious_cost_lines
    from billed b
    left join lateral (
      select
        coalesce(sum(oi.actual_qty * coalesce(oi.unit_cost_at_billing, ac.unit_cost)), 0) as known_cost,
        count(*) filter (
          where oi.actual_qty is null
            or (oi.actual_qty > 0 and coalesce(oi.unit_cost_at_billing, ac.unit_cost) is null)
        ) as missing_cost_lines,
        count(*) filter (
          where oi.actual_qty > 0 and oi.unit_cost_at_billing is null and ac.unit_cost is null
            and pc.updated_at > b.billed_at
        ) as changed_after_bill_lines,
        count(*) filter (
          where oi.actual_qty > 0 and oi.unit_cost_at_billing is null and ac.unit_cost is null
        ) as unsnapshotted_cost_lines,
        count(*) filter (
          where oi.actual_qty > 0
            and coalesce(oi.unit_cost_at_billing, ac.unit_cost) >
                (10 * coalesce(oi.piece_price_per_kg_snapshot, oi.unit_price_snapshot))
            and coalesce(oi.piece_price_per_kg_snapshot, oi.unit_price_snapshot) > 0
        ) as suspicious_cost_lines
      from public.orders member
      join public.order_items oi on oi.order_id = member.id
      left join public.product_costs pc on pc.product_id = oi.product_id
      left join public.accountant_order_item_costs ac on ac.order_item_id = oi.id
      where member.status <> 'cancelled'
        and (
          (b.group_root_order_id = b.id and member.group_root_order_id = b.id)
          or (b.group_root_order_id is null and member.id = b.id)
        )
    ) c on true
  ),
  summary as (
    select
      count(*) as total_bills,
      round(coalesce(sum(final_amount), 0), 2) as total_sales_value,
      case when count(*) > 0
        then round(sum(final_amount) / count(*), 2)
        else null end as average_sales_per_bill,
      coalesce(sum(missing_cost_lines), 0) as missing_cost_lines,
      coalesce(sum(changed_after_bill_lines), 0) as changed_after_bill_lines,
      coalesce(sum(unsnapshotted_cost_lines), 0) as unsnapshotted_cost_lines,
      coalesce(sum(suspicious_cost_lines), 0) as suspicious_cost_lines,
      count(*) filter (where missing_cost_lines = 0) as cost_complete_bills,
      case
        when count(*) = 0 or sum(final_amount) = 0
          or coalesce(sum(missing_cost_lines), 0) > 0
          or coalesce(sum(suspicious_cost_lines), 0) > 0 then null
        else round(100 * (sum(final_amount) - sum(known_cost)) / sum(final_amount), 2)
      end as gross_profit_percent
    from bill_costs
  )
  select jsonb_build_object(
    'bill_date', p_bill_date,
    'total_sales_value', total_sales_value,
    'total_bills', total_bills,
    'average_sales_per_bill', average_sales_per_bill,
    'gross_profit_percent', gross_profit_percent,
    'cost_complete_bills', cost_complete_bills,
    'missing_cost_lines', missing_cost_lines,
    'changed_after_bill_lines', changed_after_bill_lines,
    'unsnapshotted_cost_lines', unsnapshotted_cost_lines,
    'suspicious_cost_lines', suspicious_cost_lines,
    'cost_basis', case when unsnapshotted_cost_lines = 0 then 'historical_costs_complete'
                       else 'historical_costs_missing' end
  )
  from summary
  into v_result;
  return v_result;
end;
$function$;
