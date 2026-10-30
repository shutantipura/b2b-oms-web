-- Financial KPIs use only completed commercial orders and completed group members.
-- The existing date selector continues to represent the Thai LOCAL BILL DATE,
-- not the completion date; a bill enters the selected day's totals once completed.
-- Re-running this migration is safe and does not mutate order rows.
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
        coalesce(sum(oi.actual_qty * coalesce(oi.unit_cost_at_billing, pc.cost)), 0) as known_cost,
        count(*) filter (
          where oi.actual_qty is null
            or (oi.actual_qty > 0 and coalesce(oi.unit_cost_at_billing, pc.cost) is null)
        ) as missing_cost_lines,
        count(*) filter (
          where oi.actual_qty > 0 and oi.unit_cost_at_billing is null
            and pc.updated_at > b.billed_at
        ) as changed_after_bill_lines,
        count(*) filter (
          where oi.actual_qty > 0 and oi.unit_cost_at_billing is null
        ) as unsnapshotted_cost_lines,
        count(*) filter (
          where oi.actual_qty > 0
            and coalesce(oi.unit_cost_at_billing, pc.cost) >
                (10 * coalesce(oi.piece_price_per_kg_snapshot, oi.unit_price_snapshot))
            and coalesce(oi.piece_price_per_kg_snapshot, oi.unit_price_snapshot) > 0
        ) as suspicious_cost_lines
      from public.orders member
      join public.order_items oi on oi.order_id = member.id
      left join public.product_costs pc on pc.product_id = oi.product_id
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
    'cost_basis', case when unsnapshotted_cost_lines = 0 then 'billing_time_snapshots'
                       else 'mixed_historical_estimate' end
  )
  from summary
  into v_result;
  return v_result;
end;
$function$
;
