-- Atomically consume one pairing code and create its alarm station.
-- Used solely by the server with service_role; never callable by anon or staff.
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

    INSERT INTO public.alarm_stations (label, secret_hash)
      VALUES (pairing_row.label, p_station_secret_hash)
      RETURNING * INTO created_station;

    UPDATE public.alarm_station_pairing_codes
       SET consumed_at = now(), station_id = created_station.id
     WHERE id = pairing_row.id;

    RETURN QUERY SELECT created_station.id, created_station.label;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_alarm_station_pairing(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_alarm_station_pairing(text,text)
  TO service_role;