-- Move CV Card ownership to the approved CV account.
-- Existing images stay in the private 'order-files' bucket; only their
-- authoritative reference is migrated. No object is deleted or rewritten.
ALTER TABLE public.cv_accounts
  ADD COLUMN IF NOT EXISTS cv_card_storage_path text;
ALTER TABLE public.cv_account_requests
  ADD COLUMN IF NOT EXISTS cv_card_storage_path text;

-- Preserve legacy customer images and verify by counting linked paths.
UPDATE public.cv_accounts cv
SET cv_card_storage_path = c.cv_card_storage_path, updated_at = now()
FROM public.customers c
WHERE c.cv_account_id = cv.id
  AND c.cv_card_storage_path IS NOT NULL
  AND cv.cv_card_storage_path IS NULL;

-- Keep the original per-shop column as a read-only compatibility mirror.
-- Existing billing workers and old completed orders continue using it.
CREATE OR REPLACE FUNCTION public.enforce_shop_cv_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $cv_card_integrity$
DECLARE v_status text; v_number text; v_card text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.customer_code IS DISTINCT FROM OLD.customer_code THEN
    RAISE EXCEPTION 'Shop ID is permanent; CV numbers are managed in CV Accounts';
  END IF;
  IF NEW.cv_account_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      SELECT status INTO v_status FROM public.cv_accounts WHERE id=NEW.cv_account_id;
      IF v_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'A shop may only link an approved active CV account';
      END IF;
    ELSIF NEW.cv_account_id IS DISTINCT FROM OLD.cv_account_id THEN
      SELECT status INTO v_status FROM public.cv_accounts WHERE id=NEW.cv_account_id;
      IF v_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'A shop may only link an approved active CV account';
      END IF;
    END IF;
  END IF;

  IF NEW.cv_account_id IS NULL THEN
    NEW.has_no_cv := true;
    NEW.active_cv_number := null;
    NEW.cv_card_storage_path := null;
  ELSE
    SELECT status,cv_number,cv_card_storage_path INTO v_status,v_number,v_card
      FROM public.cv_accounts WHERE id=NEW.cv_account_id;
    NEW.has_no_cv := (v_status IS DISTINCT FROM 'approved');
    NEW.active_cv_number := CASE WHEN NEW.has_no_cv THEN null ELSE v_number END;
    -- Intentionally keep the card image available to the existing billing
    -- workflow even if the associated CV account is deactivated.
    NEW.cv_card_storage_path := v_card;
  END IF;
  RETURN NEW;
END $cv_card_integrity$;
REVOKE ALL ON FUNCTION public.enforce_shop_cv_integrity() FROM PUBLIC,anon,authenticated;

-- Approval is the only way an application or CV Card amendment takes effect.
-- Existing pending requests continue to be approved normally.
CREATE OR REPLACE FUNCTION public.cv_review_account_request(
  p_request_id uuid,p_manager_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $cv_card_approval$
DECLARE v_req public.cv_account_requests%ROWTYPE; v_cv uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.staff
    WHERE id=p_manager_id AND account_type='manager' AND is_active) THEN
    RAISE EXCEPTION 'Active Manager approval required';
  END IF;
  SELECT * INTO v_req FROM public.cv_account_requests
    WHERE id=p_request_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already reviewed'; END IF;

  v_cv := v_req.cv_account_id;
  IF p_approve THEN
    IF v_req.action='create' THEN
      INSERT INTO public.cv_accounts(
        cv_number,status,shop_photos,id_card_path,registration_photos,
        cv_card_storage_path,created_by,approved_by,legacy_import)
      VALUES(v_req.cv_number,'approved',v_req.shop_photos,
        v_req.id_card_path,v_req.registration_photos,v_req.cv_card_storage_path,
        v_req.created_by,p_manager_id,false)
      RETURNING id INTO v_cv;
    ELSE
      UPDATE public.cv_accounts SET
        shop_photos=CASE WHEN cardinality(v_req.shop_photos)>0
          THEN v_req.shop_photos ELSE shop_photos END,
        id_card_path=COALESCE(nullif(v_req.id_card_path,''),id_card_path),
        registration_photos=CASE WHEN cardinality(v_req.registration_photos)>0
          THEN v_req.registration_photos ELSE registration_photos END,
        cv_card_storage_path=COALESCE(
          nullif(v_req.cv_card_storage_path,''),cv_card_storage_path),
        updated_at=now(),approved_by=p_manager_id
      WHERE id=v_cv AND status='approved'
      RETURNING id INTO v_cv;
      IF v_cv IS NULL THEN RAISE EXCEPTION 'CV account inactive or missing'; END IF;
    END IF;
    -- Mirror the approved card to the legacy customer field for billing.
    UPDATE public.customers SET cv_account_id=cv_account_id WHERE cv_account_id=v_cv;
    INSERT INTO public.cv_account_events(cv_account_id,actor_staff_id,action,request_id)
    VALUES(v_cv,p_manager_id,
      CASE WHEN v_req.action='create' THEN 'approved_create' ELSE 'approved_amend' END,v_req.id);
  END IF;
  UPDATE public.cv_account_requests
    SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by=p_manager_id,reviewed_at=now(),review_note=left(p_note,1000)
  WHERE id=p_request_id;
  RETURN v_cv;
END $cv_card_approval$;
REVOKE ALL ON FUNCTION public.cv_review_account_request(uuid,uuid,boolean,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cv_review_account_request(uuid,uuid,boolean,text)
  TO service_role;

-- Permit CV Card-only amendments while preserving required documents for new CV accounts.
ALTER TABLE public.cv_account_requests DROP CONSTRAINT IF EXISTS cv_request_docs;
ALTER TABLE public.cv_account_requests ADD CONSTRAINT cv_request_docs CHECK (
  (action='create' AND cardinality(shop_photos)>=1 AND
    length(nullif(id_card_path,''))>0 AND cardinality(registration_photos)=2)
  OR (action='amend' AND (
    cardinality(shop_photos)>0 OR length(nullif(id_card_path,''))>0 OR
    cardinality(registration_photos)>0 OR
    length(nullif(cv_card_storage_path,''))>0
  ))
);

-- Defensively resync the billing compatibility mirror for all linked shops.
UPDATE public.customers SET cv_account_id=cv_account_id WHERE cv_account_id IS NOT NULL;
