-- Base schema for TraceLens.
-- Runs automatically on the first start of the Postgres container
-- (mounted into /docker-entrypoint-initdb.d by docker-compose.yml).

CREATE TABLE IF NOT EXISTS services (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id BIGINT NOT NULL REFERENCES services (id),
    level VARCHAR(10) NOT NULL
        CHECK (level IN ('INFO', 'WARN', 'ERROR')),
    message TEXT NOT NULL
        CHECK (length(trim(message)) > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id BIGINT NOT NULL REFERENCES services (id),
    metric_name VARCHAR(100) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id BIGINT NOT NULL REFERENCES services (id),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity VARCHAR(10) NOT NULL
        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'RESOLVED' AND resolved_at IS NOT NULL)
        OR (status <> 'RESOLVED' AND resolved_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_logs_service_time
    ON logs (service_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_level_time
    ON logs (level, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_service_name_time
    ON metrics (service_id, metric_name, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_status_detected
    ON incidents (status, detected_at DESC);

-- Demo services so the simulator works out of the box.
INSERT INTO services (name)
VALUES ('order-service'), ('user-service'), ('payment-service')
ON CONFLICT (name) DO NOTHING;
