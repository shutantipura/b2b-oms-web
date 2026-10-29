-- Distinguish the external 10-digit CV number from OMS' required internal customer_code.
-- Existing customers are unchanged until a manager selects "No CV".
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS has_no_cv boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.has_no_cv IS
  'True if this customer has no external CV number. customer_code remains a unique OMS routing identifier.';
