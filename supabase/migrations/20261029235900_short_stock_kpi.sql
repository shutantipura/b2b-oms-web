-- Short Stock KPI (2026-10-29): no tolerance during stock checking.
-- A picking failure also fails Short Stock; leave unmeasurable records as N/A.
-- Preserves the original Short Pick tolerance and manager-only access check.
CREATE OR REPLACE FUNCTION public.get_operational_kpi_orders(p_delivery_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin

  if not public.is_current_manager() then
    raise exception 'Manager access required';
  end if;

  with history_base as (

    select
      h.order_id,
      h.from_status,
      h.to_status,

      coalesce(
        nullif(to_jsonb(h) ->> 'created_at', ''),
        nullif(to_jsonb(h) ->> 'changed_at', ''),
        nullif(to_jsonb(h) ->> 'recorded_at', ''),
        nullif(to_jsonb(h) ->> 'action_at', ''),
        nullif(to_jsonb(h) ->> 'timestamp', '')
      )::timestamptz as event_at

    from public.order_history h
  ),

  history_rollup as (

    select
      order_id,

      min(event_at) filter (
        where from_status = 'awaiting_confirmation'
          and to_status = 'awaiting_picking'
      ) as confirmation_at,

      min(event_at) filter (
        where to_status = 'awaiting_billing'
      ) as picking_completed_at,

      min(event_at) filter (
        where from_status = 'out_for_delivery'
          and to_status = 'awaiting_payment'
      ) as delivery_at,

      min(event_at) filter (
        where from_status = 'payment_submitted'
          and to_status = 'completed'
      ) as payment_completed_at

    from history_base
    group by order_id
  ),

  item_base as (

    select
      oi.order_id,
      oi.requested_qty,

      nullif(
        coalesce(
          to_jsonb(oi) ->> 'confirmed_qty',
          to_jsonb(oi) ->> 'confirmed_quantity'
        ),
        ''
      )::numeric as confirmed_qty,

      nullif(
        coalesce(
          to_jsonb(oi) ->> 'actual_qty',
          to_jsonb(oi) ->> 'actual_picked_qty',
          to_jsonb(oi) ->> 'actual_quantity',
          to_jsonb(oi) ->> 'picked_qty'
        ),
        ''
      )::numeric as actual_qty,

      oi.actual_piece_qty,
      oi.piece_price_per_kg_snapshot IS NOT NULL AS confirmed_in_pieces_picked_in_kg,

      coalesce(
        nullif(to_jsonb(oi) ->> 'unit_snapshot', ''),
        nullif(to_jsonb(oi) ->> 'unit', ''),
        p.unit,
        ''
      ) as unit_name

    from public.order_items oi

    left join public.products p
      on p.id = oi.product_id
  ),

  item_rollup as (

    select
      order_id,

      case
        -- A definite short pick can be reported even if another line lacks data.
        when bool_or(
          case
            when confirmed_qty is null then null
            -- Mixed units: compare pieces to pieces; KG is for billing only.
            when confirmed_in_pieces_picked_in_kg then
              case when actual_piece_qty is null then null
                   else actual_piece_qty < confirmed_qty end
            when actual_qty is null then null
            -- Native KG lines retain the existing 0.5 KG tolerance.
            when lower(unit_name) like '%kg%' or unit_name like '%กก%' then
              actual_qty < confirmed_qty - 0.5
            else actual_qty < confirmed_qty
          end
        ) is true then true
        -- Missing measurements (including historical mixed-unit lines) are N/A.
        when bool_or(
          confirmed_qty is null
          or (confirmed_in_pieces_picked_in_kg and actual_piece_qty is null)
          or (not confirmed_in_pieces_picked_in_kg and actual_qty is null)
        ) then null
        else false
      end as short_pick,

      -- Stock-check shortage has NO tolerance, even on native KG lines.
      case
        when bool_or(confirmed_qty < requested_qty) is true then true
        when bool_or(confirmed_qty is null or requested_qty is null) then null
        else false
      end as stock_check_shortage

    from item_base
    group by order_id
  ),

  base as (

    select
      o.id,
      o.order_number,
      o.status,
      o.created_at,
      o.delivery_date,
      o.delivery_slot,

      c.customer_name,

      hr.confirmation_at,
      hr.picking_completed_at,
      hr.delivery_at,
      hr.payment_completed_at,

      ir.short_pick,
      ir.stock_check_shortage,

      -- End of customer's selected delivery slot
      case
        when o.delivery_slot is not null
         and substring(
           o.delivery_slot
           from '([0-2][0-9]:[0-5][0-9])[[:space:]]*$'
         ) is not null
        then
          (
            o.delivery_date
            +
            substring(
              o.delivery_slot
              from '([0-2][0-9]:[0-5][0-9])[[:space:]]*$'
            )::time
          )
          at time zone 'Asia/Bangkok'
        else null
      end as delivery_due_at,

      (
        o.delivery_date + time '21:00'
      ) at time zone 'Asia/Bangkok'
        as payment_due_at

    from public.orders o

    left join public.customers c
      on c.id = o.customer_id

    left join history_rollup hr
      on hr.order_id = o.id

    left join item_rollup ir
      on ir.order_id = o.id

    where o.delivery_date = p_delivery_date
      and o.status <> 'cancelled'
  ),

  scored as (

    select
      *,

      created_at + interval '30 minutes'
        as confirmation_due_at,

      case
        when confirmation_at is not null
        then
          confirmation_at
          <= created_at + interval '30 minutes'

        when now() > created_at + interval '30 minutes'
        then false

        else null
      end as confirmation_on_time,

      case
        when delivery_due_at is null
        then null

        when delivery_at is not null
        then delivery_at <= delivery_due_at

        when now() > delivery_due_at
        then false

        else null
      end as delivery_on_time,

      case
        when picking_completed_at is null
        then null

        else short_pick
      end as short_pick_result,

      -- Two-rule definition: stock check shortage OR short pick.
      -- Only score after picking, using the same completion gate.
      case
        when picking_completed_at is null then null
        when stock_check_shortage is true or short_pick is true then true
        when stock_check_shortage is null or short_pick is null then null
        else false
      end as short_stock_result,

      case
        when payment_completed_at is not null
        then payment_completed_at <= payment_due_at

        when now() > payment_due_at
        then false

        else null
      end as payment_on_time

    from base
  )

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_id', id,
        'order_number', order_number,
        'customer_name', customer_name,
        'status', status,

        'created_at', created_at,

        'confirmation_at', confirmation_at,
        'confirmation_due_at', confirmation_due_at,
        'confirmation_on_time', confirmation_on_time,

        'delivery_slot', delivery_slot,
        'delivery_at', delivery_at,
        'delivery_due_at', delivery_due_at,
        'delivery_on_time', delivery_on_time,

        'picking_completed_at', picking_completed_at,
        'short_pick', short_pick_result,
        'stock_check_shortage', stock_check_shortage,
        'short_stock', short_stock_result,

        'payment_completed_at', payment_completed_at,
        'payment_due_at', payment_due_at,
        'payment_on_time', payment_on_time
      )
      order by order_number
    ),
    '[]'::jsonb
  )
  into v_result
  from scored;

  return v_result;

end;
$function$
;
