-- Six-digit enrollment PINs require persistent throttling across all Vercel
-- serverless instances. Only the server's service_role may use this function.
-- The station's long-lived 256-bit token is unchanged.
CREATE TABLE IF NOT EXISTS public.alarm_station_pair_attempt_windows (
  scope text PRIMARY KEY CHECK (
    scope = 'global' OR scope ~ '^ip:[a-f0-9]{64}$'
  ),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000)
);

CREATE INDEX IF NOT EXISTS alarm_station_pair_attempt_expiry_idx
  ON public.alarm_station_pair_attempt_windows (window_started_at);

ALTER TABLE public.alarm_station_pair_attempt_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alarm_station_pair_attempt_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alarm_station_pair_attempt_windows
  TO service_role;

CREATE OR REPLACE FUNCTION public.allow_alarm_station_pair_attempt(p_source_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  attempt_time timestamptz := now();
  local_attempts integer;
  global_attempts integer;
BEGIN
  IF p_source_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;

  -- Serialize the two counters: concurrent guesses cannot slip past limits.
  PERFORM pg_catalog.pg_advisory_xact_lock(1776438997::bigint);

  INSERT INTO public.alarm_station_pair_attempt_windows
    (scope, window_started_at, attempts)
  VALUES ('ip:' || p_source_hash, attempt_time, 1)
  ON CONFLICT (scope) DO UPDATE SET
    attempts = CASE
      WHEN alarm_station_pair_attempt_windows.window_started_at
           <= attempt_time - interval '15 minutes' THEN 1
      ELSE LEAST(alarm_station_pair_attempt_windows.attempts + 1, 1000000)
    END,
    window_started_at = CASE
      WHEN alarm_station_pair_attempt_windows.window_started_at
           <= attempt_time - interval '15 minutes' THEN attempt_time
      ELSE alarm_station_pair_attempt_windows.window_started_at
    END
  RETURNING attempts INTO local_attempts;

  -- A blocked source cannot drain the global allowance indefinitely.
  IF local_attempts > 12 THEN
    RETURN false;
  END IF;

  INSERT INTO public.alarm_station_pair_attempt_windows
    (scope, window_started_at, attempts)
  VALUES ('global', attempt_time, 1)
  ON CONFLICT (scope) DO UPDATE SET
    attempts = CASE
      WHEN alarm_station_pair_attempt_windows.window_started_at
           <= attempt_time - interval '15 minutes' THEN 1
      ELSE LEAST(alarm_station_pair_attempt_windows.attempts + 1, 1000000)
    END,
    window_started_at = CASE
      WHEN alarm_station_pair_attempt_windows.window_started_at
           <= attempt_time - interval '15 minutes' THEN attempt_time
      ELSE alarm_station_pair_attempt_windows.window_started_at
    END
  RETURNING attempts INTO global_attempts;

  -- Opportunistic cleanup; IP identifiers are HMACs, never raw addresses.
  DELETE FROM public.alarm_station_pair_attempt_windows
   WHERE scope <> 'global'
     AND window_started_at < attempt_time - interval '1 day';

  RETURN global_attempts <= 100;
END;
$function$;

REVOKE ALL ON FUNCTION public.allow_alarm_station_pair_attempt(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allow_alarm_station_pair_attempt(text)
  TO service_role;
