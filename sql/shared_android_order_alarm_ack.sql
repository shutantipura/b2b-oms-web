-- Record centrally acknowledged alerts from paired Android stations.
-- Preserve existing staff-based acknowledgement and its foreign key.
ALTER TABLE public.order_alerts
    ADD COLUMN IF NOT EXISTS acknowledged_by_station uuid
        REFERENCES public.alarm_stations(id) ON DELETE SET NULL;

ALTER TABLE public.order_alerts
    DROP CONSTRAINT IF EXISTS acknowledgement_consistent;
ALTER TABLE public.order_alerts
    ADD CONSTRAINT acknowledgement_consistent CHECK (
        (acknowledged_at IS NULL
            AND acknowledged_by IS NULL
            AND acknowledged_by_station IS NULL)
        OR
        (acknowledged_at IS NOT NULL AND (
            (acknowledged_by IS NOT NULL AND acknowledged_by_station IS NULL)
            OR (acknowledged_by IS NULL AND acknowledged_by_station IS NOT NULL)
        ))
    );
CREATE INDEX IF NOT EXISTS order_alerts_acknowledged_by_station_idx
    ON public.order_alerts (acknowledged_by_station)
    WHERE acknowledged_by_station IS NOT NULL;
