CREATE OR REPLACE FUNCTION public.create_customer_order(p_customer_code text, p_delivery_date date, p_delivery_slot text, p_delivery_address text, p_customer_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer_id public.customers.id%type;
  v_order_id public.orders.id%type;
  v_order_number public.orders.order_number%type;
  v_item_count integer;
begin

  -- =====================================================
  -- 1. FIND ACTIVE CUSTOMER
  -- =====================================================

  select id
  into v_customer_id
  from public.customers
  where upper(customer_code) = upper(trim(p_customer_code))
    and is_active = true
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer does not exist or is inactive';
  end if;

  -- =====================================================
  -- 2. VALIDATION
  -- =====================================================

  if p_delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  if coalesce(trim(p_delivery_slot), '') = '' then
    raise exception 'Delivery slot is required';
  end if;

  if coalesce(trim(p_delivery_address), '') = '' then
    raise exception 'Delivery address is required';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item';
  end if;

  -- =====================================================
  -- 3. CREATE ORDER
  -- =====================================================

  insert into public.orders (
    customer_id,
    status,
    order_source,
    delivery_date,
    delivery_slot,
    delivery_address,
    customer_notes
  )
  values (
    v_customer_id,
    'awaiting_confirmation',
    'customer_line',
    p_delivery_date,
    trim(p_delivery_slot),
    trim(p_delivery_address),
    nullif(trim(p_customer_notes), '')
  )
  returning id, order_number
  into v_order_id, v_order_number;

  -- =====================================================
  -- 4. CREATE ORDER ITEMS
  -- Price is read from database, not trusted from browser.
  -- =====================================================

  insert into public.order_items (
    order_id,
    product_id,
    product_name_snapshot,
    unit_snapshot,
    requested_qty,
    unit_price_snapshot,
    piece_price_per_kg_snapshot,
    customer_note
  )
  select
    v_order_id,
    p.id,
    p.product_name,
    case when lower(item ->> 'order_unit') = 'piece' then 'ชิ้น' else p.unit end,
    (item ->> 'quantity')::numeric,
    case when lower(item ->> 'order_unit') = 'piece' then 0
         else coalesce(cp.agreed_price,p.normal_price) end,
    case when lower(item ->> 'order_unit') = 'piece'
         then coalesce(cp.agreed_price,p.normal_price) else null end,
    case when lower(item ->> 'order_unit') = 'piece'
         then 'ลูกค้าสั่งเป็นชิ้น ต้องชั่งน้ำหนักจริงก่อนคิดราคา / ราคาอ้างอิงต่อ กก.'
         else null end

  from jsonb_array_elements(p_items) as item

  join public.products p
    on p.id::text = item ->> 'product_id'

  left join public.customer_prices cp
    on cp.customer_id = v_customer_id
   and cp.product_id = p.id
   and cp.is_active = true

  where
    (item ->> 'quantity')::numeric > 0
    and (lower(coalesce(item ->> 'order_unit','kg')) <> 'piece'
      or ((lower(p.unit) like '%kg%' or p.unit like '%กก%' or p.unit like '%กิโล%')
          and (item ->> 'quantity')::numeric = trunc((item ->> 'quantity')::numeric)
          and (item ->> 'quantity')::numeric between 1 and 1000));

  get diagnostics v_item_count = row_count;

  if v_item_count = 0 then
    raise exception 'No valid products were submitted';
  end if;

  -- =====================================================
  -- 5. HISTORY
  -- =====================================================

  insert into public.order_history (
    order_id,
    action,
    from_status,
    to_status,
    note
  )
  values (
    v_order_id,
    'order_created',
    null,
    'awaiting_confirmation',
    'Order submitted by customer'
  );

  -- =====================================================
  -- 6. RETURN RESULT
  -- =====================================================

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number
  );

end;
$function$
