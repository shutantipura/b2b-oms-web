
-- Shop/CV registry. Existing public.customers remain OMS shops; customer_code is
-- their historical stable order identifier, not a reusable CV-account ID.
CREATE TABLE IF NOT EXISTS public.cv_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_number text NOT NULL UNIQUE CHECK (cv_number ~ '^[0-9]{10}$'),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','deactivated')),
  shop_photos text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(shop_photos) <= 3),
  id_card_path text,
  registration_photos text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(registration_photos) <= 2),
  legacy_import boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  deactivated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);
ALTER TABLE public.cv_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cv_accounts FROM anon, authenticated;

-- Legacy CV numbers are pre-approved, and their document fields intentionally
-- start blank. Historical customer_code and order/customer foreign keys stay as is.
INSERT INTO public.cv_accounts (cv_number,status,legacy_import)
SELECT DISTINCT c.customer_code, 'approved',true
FROM public.customers c
WHERE c.has_no_cv = false AND c.customer_code ~ '^[0-9]{10}$'
ON CONFLICT (cv_number) DO NOTHING;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS cv_account_id uuid REFERENCES public.cv_accounts(id) ON DELETE RESTRICT;
-- Billing staff need the approved CV number rather than the independent
-- internal shop ID used by OMS for newly created shops.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS active_cv_number text;
CREATE INDEX IF NOT EXISTS customers_cv_account_idx
  ON public.customers(cv_account_id);
UPDATE public.customers c SET cv_account_id = cv.id
FROM public.cv_accounts cv
WHERE c.customer_code = cv.cv_number AND c.has_no_cv = false
  AND c.cv_account_id IS NULL;
UPDATE public.customers c SET active_cv_number=cv.cv_number
FROM public.cv_accounts cv WHERE c.cv_account_id=cv.id AND cv.status='approved'
  AND c.active_cv_number IS DISTINCT FROM cv.cv_number;

CREATE TABLE IF NOT EXISTS public.cv_account_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK(action IN ('create','amend')),
  cv_account_id uuid REFERENCES public.cv_accounts(id) ON DELETE RESTRICT,
  cv_number text NOT NULL CHECK(cv_number ~ '^[0-9]{10}$'),
  shop_photos text[] NOT NULL DEFAULT '{}' CHECK(cardinality(shop_photos) <= 3),
  id_card_path text,
  registration_photos text[] NOT NULL DEFAULT '{}' CHECK(cardinality(registration_photos) <= 2),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_by uuid NOT NULL REFERENCES public.staff(id),
  reviewed_by uuid REFERENCES public.staff(id),
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT cv_request_action_target CHECK (
    (action='create' AND cv_account_id IS NULL) OR
    (action='amend' AND cv_account_id IS NOT NULL)
  ),
  CONSTRAINT cv_request_docs CHECK (
    (action='create' AND cardinality(shop_photos)>=1
      AND length(nullif(id_card_path,''))>0
      AND cardinality(registration_photos)=2) OR
    (action='amend' AND (cardinality(shop_photos)>0 OR
      length(nullif(id_card_path,''))>0 OR cardinality(registration_photos)>0))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS cv_only_one_pending_create
  ON public.cv_account_requests(cv_number)
  WHERE action='create' AND status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS cv_only_one_pending_amend
  ON public.cv_account_requests(cv_account_id)
  WHERE action='amend' AND status='pending';
CREATE INDEX IF NOT EXISTS cv_requests_status_time_idx
  ON public.cv_account_requests(status,created_at DESC);
ALTER TABLE public.cv_account_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cv_account_requests FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.cv_account_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_account_id uuid NOT NULL REFERENCES public.cv_accounts(id) ON DELETE RESTRICT,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  action text NOT NULL,
  request_id uuid REFERENCES public.cv_account_requests(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cv_account_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cv_account_events FROM anon, authenticated;

-- Guard legacy direct customer edits: a CV is a separate approved account.
CREATE OR REPLACE FUNCTION public.enforce_shop_cv_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $
DECLARE v_status text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.customer_code IS DISTINCT FROM OLD.customer_code THEN
    RAISE EXCEPTION 'Shop ID is permanent; CV numbers are managed in CV Accounts';
  END IF;
  IF NEW.cv_account_id IS NOT NULL THEN
    IF TG_OP='INSERT' THEN
      SELECT status INTO v_status FROM public.cv_accounts WHERE id=NEW.cv_account_id;
      IF v_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'A shop may only link an approved active CV account'; END IF;
    ELSIF NEW.cv_account_id IS DISTINCT FROM OLD.cv_account_id THEN
      SELECT status INTO v_status FROM public.cv_accounts WHERE id=NEW.cv_account_id;
      IF v_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'A shop may only link an approved active CV account'; END IF;
    END IF;
  END IF;
  -- A deactivation does not invalidate an existing shop's historical link;
  -- it only blocks newly linking or changing it to that inactive account.
  -- Deactivated CV accounts remain linked for audit, but are not usable
  -- for new billing, so such shops temporarily behave as No CV.
  IF NEW.cv_account_id IS NULL THEN
    NEW.has_no_cv := true;
    NEW.active_cv_number := NULL;
  ELSE
    SELECT status,cv_number INTO v_status,NEW.active_cv_number
      FROM public.cv_accounts WHERE id=NEW.cv_account_id;
    NEW.has_no_cv := (v_status IS DISTINCT FROM 'approved');
    IF NEW.has_no_cv THEN NEW.active_cv_number := NULL; END IF;
  END IF;
  RETURN NEW;
END $;
-- The trigger must inspect CV status even when a legacy customer editor uses an
-- authenticated user (which correctly cannot SELECT private CV document tables).
-- No client can execute the function directly; only the table trigger calls it.
REVOKE ALL ON FUNCTION public.enforce_shop_cv_integrity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS enforce_shop_cv_integrity_trg ON public.customers;
CREATE TRIGGER enforce_shop_cv_integrity_trg BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_cv_integrity();

-- Service-role-only transactional manager review and activation operations.
CREATE OR REPLACE FUNCTION public.cv_review_account_request(
  p_request_id uuid, p_manager_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_req public.cv_account_requests%ROWTYPE; v_cv uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff
    WHERE id=p_manager_id AND account_type='manager' AND is_active) THEN
    RAISE EXCEPTION 'Active Manager approval required';
  END IF;
  SELECT * INTO v_req FROM public.cv_account_requests
    WHERE id=p_request_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already reviewed'; END IF;
  v_cv := v_req.cv_account_id;
  IF p_approve THEN
    IF v_req.action='create' THEN
      INSERT INTO public.cv_accounts
        (cv_number,status,shop_photos,id_card_path,registration_photos,
         created_by,approved_by,legacy_import)
      VALUES (v_req.cv_number,'approved',v_req.shop_photos,
        v_req.id_card_path,v_req.registration_photos,v_req.created_by,p_manager_id,false)
      RETURNING id INTO v_cv;
    ELSE
      UPDATE public.cv_accounts SET
        shop_photos=CASE WHEN cardinality(v_req.shop_photos)>0
          THEN v_req.shop_photos ELSE shop_photos END,
        id_card_path=COALESCE(nullif(v_req.id_card_path,''),id_card_path),
        registration_photos=CASE WHEN cardinality(v_req.registration_photos)>0
          THEN v_req.registration_photos ELSE registration_photos END,
        updated_at=now(),approved_by=p_manager_id
      WHERE id=v_cv AND status='approved'
      RETURNING id INTO v_cv;
      IF v_cv IS NULL THEN RAISE EXCEPTION 'CV account inactive or missing'; END IF;
    END IF;
    INSERT INTO public.cv_account_events(cv_account_id,actor_staff_id,action,request_id)
      VALUES(v_cv,p_manager_id,CASE WHEN v_req.action='create' THEN 'approved_create'
      ELSE 'approved_amend' END,v_req.id);
  END IF;
  UPDATE public.cv_account_requests
    SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        reviewed_by=p_manager_id,reviewed_at=now(),review_note=left(p_note,1000)
    WHERE id=p_request_id;
  RETURN v_cv;
END $$;

CREATE OR REPLACE FUNCTION public.cv_set_account_active(
  p_cv_id uuid,p_manager_id uuid,p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id=p_manager_id
    AND account_type='manager' AND is_active) THEN
    RAISE EXCEPTION 'Active Manager required';
  END IF;
  UPDATE public.cv_accounts SET status=CASE WHEN p_active THEN 'approved' ELSE 'deactivated' END,
    deactivated_by=CASE WHEN p_active THEN NULL ELSE p_manager_id END,
    deactivated_at=CASE WHEN p_active THEN NULL ELSE now() END,
    updated_at=now() WHERE id=p_cv_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CV account not found'; END IF;
  -- Refresh legacy OMS billing-mode mirror while keeping CV associations.
  UPDATE public.customers SET cv_account_id=cv_account_id WHERE cv_account_id=p_cv_id;
  INSERT INTO public.cv_account_events(cv_account_id,actor_staff_id,action)
    VALUES(p_cv_id,p_manager_id,CASE WHEN p_active THEN 'reactivated' ELSE 'deactivated' END);
END $$;
REVOKE ALL ON FUNCTION public.cv_review_account_request(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cv_review_account_request(uuid,uuid,boolean,text) TO service_role;
REVOKE ALL ON FUNCTION public.cv_set_account_active(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cv_set_account_active(uuid,uuid,boolean) TO service_role;

-- Private storage: no client SELECT/INSERT/UPDATE grants or public bucket.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('cv-documents','cv-documents',false,12582912,ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false,
  file_size_limit=12582912,allowed_mime_types=ARRAY['image/webp'];
