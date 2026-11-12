
CREATE TABLE IF NOT EXISTS incident_rules (
    rule_key VARCHAR(100) PRIMARY KEY,

    rule_type VARCHAR(30) NOT NULL
        CHECK (rule_type IN ('ERROR_COUNT', 'METRIC_AVG')),

    title VARCHAR(255) NOT NULL,

    metric_name VARCHAR(100),

    threshold NUMERIC NOT NULL
        CHECK (threshold >= 0),

    comparison VARCHAR(10) NOT NULL
        CHECK (comparison IN ('GT', 'GTE')),

    window_minutes INTEGER NOT NULL
        CHECK (window_minutes > 0),

    severity VARCHAR(20) NOT NULL
        CHECK (
            severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
        ),

    enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (rule_type = 'ERROR_COUNT' AND metric_name IS NULL)
        OR
        (rule_type = 'METRIC_AVG' AND metric_name IS NOT NULL)
    )
);

INSERT INTO incident_rules (
    rule_key,
    rule_type,
    title,
    metric_name,
    threshold,
    comparison,
    window_minutes,
    severity
)
VALUES
(
    'error_burst_high',
    'ERROR_COUNT',
    'Repeated error burst',
    NULL,
    5,
    'GTE',
    1,
    'HIGH'
),
(
    'error_burst_critical',
    'ERROR_COUNT',
    'Repeated error burst',
    NULL,
    10,
    'GTE',
    1,
    'CRITICAL'
),
(
    'high_response_time',
    'METRIC_AVG',
    'High response time',
    'response_time_ms',
    1000,
    'GT',
    5,
    'HIGH'
),
(
    'traffic_spike',
    'METRIC_AVG',
    'Traffic spike detected',
    'requests_per_minute',
    100,
    'GT',
    1,
    'MEDIUM'
)
ON CONFLICT (rule_key) DO NOTHING;
