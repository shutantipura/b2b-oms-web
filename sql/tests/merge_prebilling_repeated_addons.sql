-- Test with BEGIN; ... ROLLBACK; (never retain fake customers, staff or photos).
-- Expected: an already-confirmed add-on can be requeued for new Confirmation
-- without duplicating previous confirmations or losing original picks.
DO $verify$
DECLARE
  v_user uuid:=gen_random_uuid();
  v_staff uuid;v_customer uuid;v_line uuid;v_product_id uuid;v_sku text;
  v_order_id uuid;v_order_number bigint;
  v_date date:=timezone('Asia/Bangkok',clock_timestamp())::date+1;
  v_result jsonb;v_requested numeric;v_confirmed numeric;v_actual numeric;
  v_pending numeric;v_addon_confirmed numeric;
BEGIN
  SELECT p.id,p.sku INTO STRICT v_product_id,v_sku FROM public.products p
    WHERE p.is_active AND p.is_customer_visible AND p.normal_price>0 ORDER BY p.id LIMIT 1;
  INSERT INTO auth.users(id,email,aud,role,created_at,updated_at)
    VALUES(v_user,'rollback-repeat-'||v_user||'@example.invalid','authenticated','authenticated',now(),now());
  INSERT INTO public.staff(staff_code,staff_name,auth_user_id,is_active,account_type)
    VALUES('S'||lpad((floor(random()*1000000000))::text,9,'0'),
      'ROLLBACK repeat staff',v_user,true,'staff') RETURNING id INTO v_staff;
  INSERT INTO public.staff_task_permissions(staff_id,stage)
    VALUES(v_staff,'confirmation'),(v_staff,'picking');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  INSERT INTO public.customers(customer_code,customer_name,is_test_customer)
    VALUES('9'||lpad((floor(random()*1000000000))::text,9,'0'),
      'ROLLBACK repeat customer',true) RETURNING id INTO v_customer;
  INSERT INTO public.line_users(line_user_id,is_active)
    VALUES('rollback-repeat-'||gen_random_uuid(),true) RETURNING id INTO v_line;
  INSERT INTO public.customer_line_users(customer_id,line_user_id,can_order)
    VALUES(v_customer,v_line,true);
  INSERT INTO public.orders(customer_id,status,order_source,delivery_date,delivery_slot,delivery_address)
    VALUES(v_customer,'awaiting_billing','customer_line',v_date,
      '13:00–15:00','ROLLBACK') RETURNING id,order_number INTO v_order_id,v_order_number;
  INSERT INTO public.order_items(order_id,product_id,product_name_snapshot,unit_snapshot,
      unit_price_snapshot,requested_qty,confirmed_qty,actual_qty)
    SELECT v_order_id,p.id,p.product_name,p.unit,p.normal_price,10,8,7
    FROM public.products p WHERE p.id=v_product_id;

  PERFORM public.merge_customer_order(v_customer,v_order_number,v_date,'13:00–15:00',
    'first',jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',2)),
    v_line,gen_random_uuid());
  PERFORM public.claim_my_task(v_order_number,'confirmation');
  PERFORM public.complete_my_confirmation(v_order_number,
    jsonb_build_array(jsonb_build_object('sku',v_sku,'confirmed_qty',2)));

  SELECT oi.confirmed_qty,oi.actual_qty,oi.addon_requested_qty,oi.addon_confirmed_qty
    INTO v_confirmed,v_actual,v_pending,v_addon_confirmed
  FROM public.order_items oi WHERE oi.order_id=v_order_id AND oi.product_id=v_product_id;
  IF v_confirmed<>10 OR v_actual<>7 OR v_pending<>2 OR v_addon_confirmed<>2
    THEN RAISE EXCEPTION 'First add-on confirmation incorrect';
  END IF;

  SELECT public.merge_customer_order(v_customer,v_order_number,v_date,'13:00–15:00',
    'second',jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',3)),
    v_line,gen_random_uuid()) INTO v_result;

  SELECT oi.requested_qty,oi.confirmed_qty,oi.actual_qty,
    oi.addon_requested_qty,oi.addon_confirmed_qty
    INTO v_requested,v_confirmed,v_actual,v_pending,v_addon_confirmed
  FROM public.order_items oi WHERE oi.order_id=v_order_id AND oi.product_id=v_product_id;

  IF v_requested<>15 OR v_confirmed<>8 OR v_actual<>7
    OR v_pending<>5 OR v_addon_confirmed IS NOT NULL
    THEN RAISE EXCEPTION 'Requeue corrupted totals: % % % % %',
      v_requested,v_confirmed,v_actual,v_pending,v_addon_confirmed;
  END IF;

  PERFORM public.claim_my_task(v_order_number,'confirmation');
  PERFORM public.complete_my_confirmation(v_order_number,
    jsonb_build_array(jsonb_build_object('sku',v_sku,'confirmed_qty',4)));
  PERFORM public.claim_my_task(v_order_number,'picking');
  INSERT INTO public.order_files(order_id,file_type,storage_path,original_filename,uploaded_by_staff_id)
    VALUES(v_order_id,'cart_photo','orders/rollback/addon.jpg','addon.jpg',v_staff);
  PERFORM public.complete_my_picking(v_order_number,
    jsonb_build_array(jsonb_build_object('sku',v_sku,'actual_qty',4)));

  SELECT oi.requested_qty,oi.confirmed_qty,oi.actual_qty,oi.addon_requested_qty
    INTO v_requested,v_confirmed,v_actual,v_pending
  FROM public.order_items oi WHERE oi.order_id=v_order_id AND oi.product_id=v_product_id;
  IF v_requested<>15 OR v_confirmed<>12 OR v_actual<>11 OR v_pending<>0
    THEN RAISE EXCEPTION 'Final totals incorrect: % % % %',
      v_requested,v_confirmed,v_actual,v_pending;
  END IF;
  RAISE NOTICE 'PASS: Two add-ons were re-confirmed once; old 7 picked units preserved';
END
$verify$;