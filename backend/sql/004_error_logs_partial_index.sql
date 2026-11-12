-- The incident detector counts ERROR logs per service inside a time window:
--   WHERE service_id = $1 AND level = 'ERROR' AND occurred_at >= NOW() - window
-- A partial index containing only ERROR rows matches that query exactly and
-- stays small, because most logs are INFO/WARN.
CREATE INDEX IF NOT EXISTS idx_logs_errors_service_time
    ON logs (service_id, occurred_at DESC)
    WHERE level = 'ERROR';
