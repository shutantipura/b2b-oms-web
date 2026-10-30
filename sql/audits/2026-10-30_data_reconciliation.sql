-- Read-only reconciliation report for legacy OMS records. Run in Supabase SQL Editor.
-- No UPDATE/DELETE; grouped /x child orders are intentionally excluded from bill exceptions.
-- 1. Completed commercial orders without a recorded final amount.
SELECT o.order_number,o.created_at,o.status,o.final_amount
FROM public.orders o
WHERE o.status='completed' AND o.final_amount IS NULL
 AND (o.group_root_order_id IS NULL OR o.group_root_order_id=o.id)
ORDER BY o.order_number;

-- 2. Legacy piece-to-weight picks with no recorded piece count. Do not infer pieces from kg.
SELECT o.order_number,i.product_name_snapshot,i.requested_qty,i.confirmed_qty,
       i.actual_qty AS picked_kg,i.actual_piece_qty
FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
WHERE i.piece_price_per_kg_snapshot IS NOT NULL
  AND i.actual_qty IS NOT NULL AND i.actual_piece_qty IS NULL
ORDER BY o.order_number;

-- 3. Items with unusually large master cost / master price ratios.
-- These require review against original supplier cost source, not automatic correction.
SELECT p.sku,p.product_name,p.normal_price,c.cost,
       round(c.cost/nullif(p.normal_price,0),2) AS cost_price_multiple
FROM public.products p JOIN public.product_costs c ON c.product_id=p.id
WHERE p.normal_price>0 AND c.cost>10*p.normal_price
ORDER BY c.cost/nullif(p.normal_price,0) DESC;

-- 4. Non-cancelled orders without product lines.
SELECT o.order_number,o.status,o.created_at
FROM public.orders o
WHERE o.status <> 'cancelled'
 AND NOT EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=o.id)
ORDER BY o.order_number;

-- 5. Queue/station health (unacknowledged alerts from completed/cancelled orders
-- remain in audit history but are hidden from the Android feed).
SELECT count(*) AS total_alerts,
       count(*) FILTER(WHERE a.acknowledged_at IS NULL) AS pending_unacknowledged,
       count(*) FILTER(WHERE a.acknowledged_at IS NULL
         AND o.status IN ('completed','cancelled')) AS finished_order_alert_history
FROM public.order_alerts a JOIN public.orders o ON o.id=a.order_id;
SELECT count(*) AS paired_stations FROM public.alarm_stations WHERE revoked_at IS NULL;
