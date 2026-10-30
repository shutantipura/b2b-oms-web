-- Cancellation KPI by requested delivery date in Asia/Bangkok.
-- Grouped /x orders count once; cancellation actor is recovered from order history.

CREATE OR REPLACE FUNCTION public.get_cancellation_kpi_summary(p_delivery_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if not exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.account_type = 'manager'
      and s.is_active = true
  ) then
    raise exception 'Manager access required';
  end if;
  with eligible as (
    select
      o.id,
      o.order_number,
      o.status,
      o.delivery_slot,
      o.cancellation_reason,
      c.customer_name,
      case when o.status = 'cancelled' then
        coalesce(o.cancelled_by_staff_id, (
          select h.performed_by_staff_id
          from public.order_history h
          where h.order_id = o.id
            and (h.action in ('manager_cancelled', 'order_cancelled') or h.to_status = 'cancelled')
            and h.performed_by_staff_id is not null
          order by h.created_at desc, h.id desc
          limit 1
        ))
      else null end as cancelled_by_staff_id
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    where o.delivery_date = p_delivery_date
      -- Count a grouped /x order as one commercial order.
      and (o.group_root_order_id is null or o.group_root_order_id = o.id)
  )
  select jsonb_build_object(
    'delivery_date', p_delivery_date,
    'total_orders', count(*),
    'cancelled_count', count(*) filter (where status = 'cancelled'),
    'cancelled_orders', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_id', id,
          'order_number', order_number,
          'customer_name', customer_name,
          'delivery_slot', delivery_slot,
          'cancellation_reason', cancellation_reason,
          'cancelled_by_staff_id', cancelled_by_staff_id
        ) order by order_number
      ) filter (where status = 'cancelled'),
      '[]'::jsonb
    )
  )
  from eligible
  into v_result;
  return v_result;
end;
$function$
;

REVOKE EXECUTE ON FUNCTION public.get_cancellation_kpi_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cancellation_kpi_summary(date) TO authenticated;
