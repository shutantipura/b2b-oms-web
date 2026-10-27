-- Preserve the identity of the station that acknowledged an alert.
-- Stations are soft-revoked in the manager dashboard; hard deletes of
-- referenced stations must not erase the audit trail.
ALTER TABLE public.order_alerts
    DROP CONSTRAINT IF EXISTS order_alerts_acknowledged_by_station_fkey;
ALTER TABLE public.order_alerts
    ADD CONSTRAINT order_alerts_acknowledged_by_station_fkey
    FOREIGN KEY (acknowledged_by_station)
    REFERENCES public.alarm_stations(id) ON DELETE RESTRICT;