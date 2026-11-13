-- Customer edits become effective immediately and retain a compact, reviewable
-- field-level history. All writes go through server-authorized service_role RPCs.
CREATE TABLE IF NOT EXISTS public.sales_customer_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  field_name text NOT NULL,
  previous_value jsonb NOT NULL,
  proposed_value jsonb NOT NULL,
  approved_baseline jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid REFERENCES public.staff(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (field_name IN (
    'customer_code', 'has_no_cv', 'customer_name', 'customer_type',
    'contact_name', 'phone', 'delivery_address',
    'delivery_map_url', 'delivery_map_url_2',
    'delivery_location_1_name', 'delivery_location_2_name',
    'rider_note', 'notes'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_customer_one_pending_field
 ON public.sales_customer_change_audit(customer_id,field_name)
 WHERE status='pending';
CREATE INDEX IF NOT EXISTS sales_customer_audit_history
 ON public.sales_customer_change_audit(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sales_customer_audit_pending
 ON public.sales_customer_change_audit(created_at DESC) WHERE status='pending';
ALTER TABLE public.sales_customer_change_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_customer_change_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sales_customer_change_audit TO service_role;

CREATE TABLE IF NOT EXISTS public.sales_special_price_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  old_price numeric,
  proposed_price numeric NOT NULL CHECK (proposed_price > 0),
  cost_snapshot numeric,
  gp_pct numeric,
  status text NOT NULL CHECK (status IN ('pending', 'auto_applied', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid REFERENCES public.staff(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_prices_one_pending
 ON public.sales_special_price_requests(customer_id,product_id)
 WHERE status='pending';
CREATE INDEX IF NOT EXISTS sales_prices_history
 ON public.sales_special_price_requests(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sales_prices_pending
 ON public.sales_special_price_requests(created_at DESC) WHERE status='pending';
ALTER TABLE public.sales_special_price_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_special_price_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sales_special_price_requests TO service_role;

CREATE OR REPLACE FUNCTION public.sales_submit_customer_changes(
  p_customer_id uuid, p_staff_id uuid, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_role text;
  v_customer public.customers%ROWTYPE;
  v_field text;
  v_val jsonb;
  v_old jsonb;
  v_baseline jsonb;
  v_prior public.sales_customer_change_audit%ROWTYPE;
  v_count integer := 0;
  v_text text;
BEGIN
  SELECT account_type INTO v_role FROM public.staff
   WHERE id=p_staff_id AND is_active=true;
  IF v_role <> 'salesman' OR v_role IS NULL THEN
    RAISE EXCEPTION 'Active Salesman authorization required';
  END IF;
  SELECT * INTO v_customer FROM public.customers
   WHERE id=p_customer_id AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active customer not found'; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb THEN RAISE EXCEPTION 'Non-empty changes required'; END IF;
  FOR v_field IN SELECT key FROM jsonb_each(p_changes) LOOP
    IF v_field NOT IN (
      'customer_code','has_no_cv','customer_name','customer_type','contact_name',
      'phone','delivery_address','delivery_map_url','delivery_map_url_2',
      'delivery_location_1_name','delivery_location_2_name','rider_note','notes'
    ) THEN RAISE EXCEPTION 'Field not editable by Salesman: %',v_field; END IF;
    v_val := p_changes -> v_field;
    IF v_field = 'has_no_cv' THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN RAISE EXCEPTION 'Invalid No-CV flag'; END IF;
    ELSE
      IF jsonb_typeof(v_val) NOT IN ('string','null') THEN
        RAISE EXCEPTION 'Only text values accepted for %', v_field;
      END IF;
      v_text := trim(p_changes ->> v_field);
      IF length(v_text) > 1000 THEN RAISE EXCEPTION 'Field too long: %',v_field; END IF;
      IF v_field='customer_code' AND
         (v_text IS NULL OR (v_text <> 'C001' AND v_text !~ '^[0-9]{10}$'))
         THEN RAISE EXCEPTION 'CV must be 10 digits'; END IF;
      IF v_field='customer_name' AND (v_text IS NULL OR v_text='') THEN
        RAISE EXCEPTION 'Customer name is required'; END IF;
      IF v_field IN ('delivery_location_1_name','delivery_location_2_name') AND
         (v_text IS NULL OR v_text='') THEN RAISE EXCEPTION 'Delivery location name required'; END IF;
      IF v_field IN ('delivery_map_url','delivery_map_url_2') AND v_text <> '' AND
         v_text !~ '^https?://' THEN RAISE EXCEPTION 'Invalid delivery URL'; END IF;
      -- The audit must record the actual stored value, including trimming and
      -- empty text -> NULL normalization, otherwise a review can never match.
      v_val := CASE WHEN v_text IS NULL OR v_text='' THEN 'null'::jsonb
                    ELSE to_jsonb(v_text) END;
    END IF;
    v_old := to_jsonb(v_customer) -> v_field;
    IF v_old IS NOT DISTINCT FROM v_val THEN CONTINUE; END IF;
    SELECT * INTO v_prior FROM public.sales_customer_change_audit
     WHERE customer_id=p_customer_id AND field_name=v_field AND status='pending'
     FOR UPDATE;
    v_baseline := CASE WHEN FOUND THEN v_prior.approved_baseline ELSE v_old END;
    UPDATE public.sales_customer_change_audit SET status='superseded', reviewed_at=now()
     WHERE customer_id=p_customer_id AND field_name=v_field AND status='pending';
    IF v_field='has_no_cv' THEN
      UPDATE public.customers SET has_no_cv=(v_val::text)::boolean,updated_at=now()
       WHERE id=p_customer_id;
    ELSE
      EXECUTE format('UPDATE public.customers SET %I=$1, updated_at=now() WHERE id=$2',v_field)
       USING nullif(trim(p_changes ->> v_field),''),p_customer_id;
    END IF;
    INSERT INTO public.sales_customer_change_audit
      (customer_id,staff_id,field_name,previous_value,proposed_value,approved_baseline)
    VALUES (p_customer_id,p_staff_id,v_field,v_old,v_val,v_baseline);
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('changedCount',v_count,'status','pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_review_customer_change(
  p_change_id uuid, p_manager_id uuid, p_approve boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_change public.sales_customer_change_audit%ROWTYPE;
  v_customer public.customers%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_manager_id AND
      account_type='manager' AND is_active=true) THEN
    RAISE EXCEPTION 'Manager required'; END IF;
  SELECT * INTO v_change FROM public.sales_customer_change_audit
   WHERE id=p_change_id FOR UPDATE;
  IF NOT FOUND OR v_change.status <> 'pending' THEN
    RAISE EXCEPTION 'Change already reviewed or superseded'; END IF;
  SELECT * INTO v_customer FROM public.customers WHERE id=v_change.customer_id FOR UPDATE;
  IF to_jsonb(v_customer)->v_change.field_name IS DISTINCT FROM v_change.proposed_value THEN
    RAISE EXCEPTION 'The customer was modified again; reload before reviewing'; END IF;
  IF NOT p_approve THEN
    IF v_change.field_name='has_no_cv' THEN
      UPDATE public.customers SET has_no_cv=(v_change.approved_baseline::text)::boolean,
        updated_at=now() WHERE id=v_change.customer_id;
    ELSE
      EXECUTE format('UPDATE public.customers SET %I=$1, updated_at=now() WHERE id=$2',
        v_change.field_name)
      USING CASE WHEN v_change.approved_baseline='null'::jsonb THEN NULL
                 ELSE v_change.approved_baseline #>> '{}' END, v_change.customer_id;
    END IF;
  END IF;
  UPDATE public.sales_customer_change_audit SET
    status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by=p_manager_id,reviewed_at=now()
   WHERE id=p_change_id;
  RETURN jsonb_build_object('status',CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_submit_special_price(
  p_customer_id uuid, p_product_id uuid, p_staff_id uuid, p_price numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_cost numeric;
  v_gp numeric;
  v_old numeric;
  v_id uuid;
  v_price_id uuid;
  v_status text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_staff_id
       AND account_type='salesman' AND is_active=true) THEN
    RAISE EXCEPTION 'Salesman required'; END IF;
  IF p_price IS NULL OR p_price<=0 OR p_price>9999999 THEN
    RAISE EXCEPTION 'Positive selling price required'; END IF;
  -- Serializes proposals for the same customer; avoids duplicate pending requests.
  PERFORM 1 FROM public.customers WHERE id=p_customer_id AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active customer not found'; END IF;
  PERFORM 1 FROM public.products WHERE id=p_product_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active product not found'; END IF;
  SELECT cost INTO v_cost FROM public.product_costs WHERE product_id=p_product_id;
  v_gp := CASE WHEN v_cost IS NOT NULL AND v_cost>=0
               THEN (p_price-v_cost)*100/p_price ELSE NULL END;
  v_status := CASE WHEN v_gp>7 THEN 'auto_applied' ELSE 'pending' END;
  SELECT agreed_price INTO v_old FROM public.customer_prices
    WHERE customer_id=p_customer_id AND product_id=p_product_id AND is_active=true
    ORDER BY updated_at DESC LIMIT 1;
  UPDATE public.sales_special_price_requests SET status='superseded', reviewed_at=now()
    WHERE customer_id=p_customer_id AND product_id=p_product_id AND status='pending';
  INSERT INTO public.sales_special_price_requests
    (customer_id,product_id,staff_id,old_price,proposed_price,cost_snapshot,gp_pct,status)
  VALUES (p_customer_id,p_product_id,p_staff_id,v_old,p_price,v_cost,v_gp,v_status)
    RETURNING id INTO v_id;
  IF v_status='auto_applied' THEN
    SELECT id INTO v_price_id FROM public.customer_prices
      WHERE customer_id=p_customer_id AND product_id=p_product_id
      ORDER BY is_active DESC,updated_at DESC,id LIMIT 1 FOR UPDATE;
    IF v_price_id IS NULL THEN
      INSERT INTO public.customer_prices (customer_id,product_id,agreed_price,is_active)
       VALUES(p_customer_id,p_product_id,p_price,true);
    ELSE
      UPDATE public.customer_prices SET agreed_price=p_price,is_active=true,updated_at=now()
       WHERE id=v_price_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('requestId',v_id,'status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_review_special_price(
  p_request_id uuid, p_manager_id uuid, p_approve boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_request public.sales_special_price_requests%ROWTYPE;
  v_price_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_manager_id AND
       account_type='manager' AND is_active=true) THEN
    RAISE EXCEPTION 'Manager required'; END IF;
  SELECT * INTO v_request FROM public.sales_special_price_requests
     WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already reviewed or superseded'; END IF;
  IF p_approve THEN
    PERFORM 1 FROM public.customers WHERE id=v_request.customer_id AND is_active=true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer is inactive'; END IF;
    SELECT id INTO v_price_id FROM public.customer_prices
      WHERE customer_id=v_request.customer_id AND product_id=v_request.product_id
      ORDER BY is_active DESC,updated_at DESC,id LIMIT 1 FOR UPDATE;
    IF v_price_id IS NULL THEN
      INSERT INTO public.customer_prices(customer_id,product_id,agreed_price,is_active)
      VALUES(v_request.customer_id,v_request.product_id,v_request.proposed_price,true);
    ELSE
      UPDATE public.customer_prices SET agreed_price=v_request.proposed_price,
       is_active=true,updated_at=now() WHERE id=v_price_id;
    END IF;
  END IF;
  UPDATE public.sales_special_price_requests SET
    status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by=p_manager_id, reviewed_at=now() WHERE id=p_request_id;
  RETURN jsonb_build_object('status',CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END;
$$;

REVOKE ALL ON FUNCTION public.sales_submit_customer_changes(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_review_customer_change(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_submit_special_price(uuid,uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_review_special_price(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_submit_customer_changes(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_review_customer_change(uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_submit_special_price(uuid,uuid,uuid,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_review_special_price(uuid,uuid,boolean) TO service_role;
