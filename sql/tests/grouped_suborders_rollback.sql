-- Execute inside BEGIN; <migration>; <this file>; ROLLBACK.
-- No test users, orders, photos or billing records persist.
DO $test$
DECLARE
  c uuid; lu uuid; st uuid; au uuid:=gen_random_uuid();
  v_product_id uuid; staff_code text; customer_code text;
  root jsonb; child2 jsonb; child3 jsonb; res jsonb;
  root_id uuid; id2 uuid; id3 uuid; root_no bigint;
  d date:=timezone('Asia/Bangkok',clock_timestamp())::date+1;
  request_id uuid:=gen_random_uuid();
  blocked boolean; total_qty numeric; member_count integer;
BEGIN
  SELECT id INTO STRICT v_product_id FROM public.products
  WHERE is_active AND is_customer_visible AND normal_price>0 LIMIT 1;
  staff_code:='S'||lpad((floor(random()*1000000000))::text,9,'0');
  customer_code:='9'||lpad((floor(random()*1000000000))::text,9,'0');
  INSERT INTO auth.users(id,email,aud,role,created_at,updated_at)
  VALUES(au,'rollback-group-'||au||'@example.invalid','authenticated','authenticated',now(),now());
  INSERT INTO public.staff(staff_code,staff_name,auth_user_id,account_type,is_active)
  VALUES(staff_code,'ROLLBACK GROUP STAFF',au,'staff',true) RETURNING id INTO st;
  INSERT INTO public.staff_task_permissions(staff_id,stage) VALUES(st,'billing');
  PERFORM set_config('request.jwt.claim.sub',au::text,true);
  INSERT INTO public.customers(customer_code,customer_name,is_active,is_test_customer)
  VALUES(customer_code,'ROLLBACK GROUP CUSTOMER',true,true) RETURNING id INTO c;
  INSERT INTO public.line_users(line_user_id,is_active)
  VALUES('rollback-group-'||gen_random_uuid(),true) RETURNING id INTO lu;
  INSERT INTO public.customer_line_users(customer_id,line_user_id,can_order) VALUES(c,lu,true);

  root:=public.create_customer_order(customer_code,d,'13:00–15:00','ROLLBACK PRIMARY ADDRESS','original',
    jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',2)));
  root_id:=(root->>'order_id')::uuid;
  root_no:=(root->>'order_number')::bigint;
  UPDATE public.order_items SET confirmed_qty=2,actual_qty=2 WHERE order_id=root_id;
  UPDATE public.orders SET status='awaiting_billing' WHERE id=root_id;

  child2:=public.create_group_suborder(c,root_no,d,'13:00–15:00','ignore this address','addition 2',
    jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',3)),lu,request_id);
  id2:=(child2->>'order_id')::uuid;
  IF child2->>'display_number' <> root_no||'/2' THEN
    RAISE EXCEPTION 'Incorrect first child display number: %',child2;
  END IF;
  res:=public.create_group_suborder(c,root_no,d,'13:00–15:00','ignore this address','retry',
    jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',3)),lu,request_id);
  IF res->>'already_processed'<>'true' OR res->>'order_id' <> child2->>'order_id'
    THEN RAISE EXCEPTION 'Duplicate suborder was created'; END IF;
  IF (SELECT delivery_address FROM public.orders WHERE id=id2)<>'ROLLBACK PRIMARY ADDRESS'
    THEN RAISE EXCEPTION 'Grouped delivery address differs from primary'; END IF;

  child3:=public.create_group_suborder(c,root_no,d,'13:00–15:00','ignore this address','addition 3',
    jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',4)),lu,gen_random_uuid());
  id3:=(child3->>'order_id')::uuid;
  IF child3->>'display_number' <> root_no||'/3' THEN
    RAISE EXCEPTION 'Incorrect third suborder number %',child3;
  END IF;
  SELECT count(*) INTO member_count FROM public.orders WHERE group_root_order_id=root_id;
  IF member_count<>3 THEN RAISE EXCEPTION 'Expected 3 group members, got %',member_count; END IF;
  IF (SELECT count(*) FROM public.order_items WHERE order_id=root_id)<>1
    THEN RAISE EXCEPTION 'Original picking rows mutated'; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.claim_my_task(root_no,'billing');
  EXCEPTION WHEN OTHERS THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Billing was allowed before children finished Picking'; END IF;

  UPDATE public.order_items SET confirmed_qty=3,actual_qty=3 WHERE order_id=id2;
  UPDATE public.orders SET status='awaiting_billing' WHERE id=id2;
  blocked:=false;
  BEGIN
    PERFORM public.claim_my_task(root_no,'billing');
  EXCEPTION WHEN OTHERS THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Billing was allowed before third suborder was picked'; END IF;

  UPDATE public.order_items SET confirmed_qty=4,actual_qty=4 WHERE order_id=id3;
  UPDATE public.orders SET status='awaiting_billing' WHERE id=id3;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.claim_my_task(root_no,'billing');
  EXECUTE 'RESET ROLE';

  SELECT actual_qty INTO total_qty FROM public.group_billing_lines
  WHERE root_order_id=root_id AND product_id=v_product_id;
  IF total_qty<>9 THEN RAISE EXCEPTION 'Expected 9 combined picked units, got %',total_qty; END IF;

  blocked:=false;
  BEGIN
    PERFORM public.create_group_suborder(c,root_no,d,'13:00–15:00','ROLLBACK','too late',
       jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',1)),lu,gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Additional suborder admitted after Billing started'; END IF;

  UPDATE public.orders SET status='ready_for_delivery' WHERE id=root_id;
  IF (SELECT count(*) FROM public.orders WHERE group_root_order_id=root_id
     AND status='ready_for_delivery')<>3 THEN
     RAISE EXCEPTION 'Delivery statuses were not propagated to all children';
  END IF;
  RAISE NOTICE 'PASS: /1 /2 /3; one Billing after all picked; combined quantity 9; idempotency; billing lock; status sync';
END;
$test$;
