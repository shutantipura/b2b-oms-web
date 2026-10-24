-- Restore explicit staff verification before an order is marked completed.
-- The legacy trigger auto-completed payment_submitted orders immediately.
-- After removal, staff claim payment_verification and call verify_my_payment.
DROP TRIGGER IF EXISTS trg_complete_order_on_payment_slip ON public.orders;

-- Keep the legacy trigger function for historical audit compatibility,
-- but do not attach it to an order-status transition.
