-- Manager-visible, opt-in health reporting for alarm-only Android stations.
-- A station can ring anonymously; pairing is solely for diagnostics.
CREATE TABLE IF NOT EXISTS public.alarm_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  secret_hash text NOT NULL UNIQUE CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_success_at timestamptz,
  monitor_active boolean NOT NULL DEFAULT false,
  pending_count integer NOT NULL DEFAULT 0 CHECK(pending_count BETWEEN 0 AND 200),
  app_version text,
  last_error text,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.alarm_station_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  station_id uuid REFERENCES public.alarm_stations(id),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS alarm_station_pairings_expiry_idx
  ON public.alarm_station_pairing_codes (expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS alarm_stations_last_seen_idx
  ON public.alarm_stations (last_seen_at DESC);
ALTER TABLE public.alarm_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alarm_station_pairing_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alarm_stations FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.alarm_station_pairing_codes FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alarm_stations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alarm_station_pairing_codes TO service_role;
