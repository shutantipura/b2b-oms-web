-- One terminal enrollment code binds a station to one dedicated OMS staff identity.
ALTER TABLE public.alarm_station_pairing_codes
  ADD COLUMN IF NOT EXISTS dedicated_staff_id uuid REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE public.alarm_stations
  ADD COLUMN IF NOT EXISTS dedicated_staff_id uuid REFERENCES public.staff(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS alarm_station_unique_dedicated_staff
  ON public.alarm_stations(dedicated_staff_id)
  WHERE dedicated_staff_id IS NOT NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_alarm_station_pairing(
    p_code_hash text,
    p_station_secret_hash text
)
RETURNS TABLE (station_id uuid, station_label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    pairing_row public.alarm_station_pairing_codes%ROWTYPE;
    created_station public.alarm_stations%ROWTYPE;
BEGIN
    IF p_code_hash !~ '^[a-f0-9]{64}$' OR
       p_station_secret_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'Invalid station pairing parameters';
    END IF;

    SELECT * INTO pairing_row
      FROM public.alarm_station_pairing_codes
     WHERE code_hash = p_code_hash
       AND consumed_at IS NULL
       AND expires_at > now()
       FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    -- A dedicated account must still be active at the moment of enrollment.
    IF pairing_row.dedicated_staff_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff
        WHERE id = pairing_row.dedicated_staff_id
          AND is_active = true
          AND account_type = 'staff'
    ) THEN
        RAISE EXCEPTION 'Dedicated terminal account inactive';
    END IF;

    INSERT INTO public.alarm_stations (label, secret_hash, dedicated_staff_id)
      VALUES (pairing_row.label, p_station_secret_hash, pairing_row.dedicated_staff_id)
      RETURNING * INTO created_station;
    UPDATE public.alarm_station_pairing_codes
       SET consumed_at = now(), station_id = created_station.id
     WHERE id = pairing_row.id;
    RETURN QUERY SELECT created_station.id, created_station.label;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_alarm_station_pairing(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_alarm_station_pairing(text,text) TO service_role;