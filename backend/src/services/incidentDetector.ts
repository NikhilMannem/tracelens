
import { pool } from '../config/db';

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type Comparison = 'GT' | 'GTE';

type ServiceRow = {
  id: string;
  name: string;
};

type RuleRow = {
  rule_key: string;
  rule_type: 'ERROR_COUNT' | 'METRIC_AVG';
  title: string;
  metric_name: string | null;
  threshold: string;
  comparison: Comparison;
  window_minutes: number;
  severity: Severity;
};

type ObservedValue = {
  value: string | null;
};

const severityRank: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// Exported so that we can unit-test threshold behaviour.
export function thresholdMet(
  observed: number,
  threshold: number,
  comparison: Comparison,
): boolean {
  if (comparison === 'GTE') {
    return observed >= threshold;
  }

  return observed > threshold;
}

async function createOrUpdateIncident(
  serviceId: string,
  title: string,
  description: string,
  severity: Severity,
): Promise<void> {
  await pool.query(
    `INSERT INTO incidents
       (service_id, title, description, severity, status)
     VALUES ($1, $2, $3, $4, 'OPEN')
     ON CONFLICT (service_id, title)
       WHERE status IN ('OPEN', 'INVESTIGATING')
     DO UPDATE SET
       description = EXCLUDED.description,
       severity = CASE
         WHEN
           CASE incidents.severity
             WHEN 'LOW' THEN 1
             WHEN 'MEDIUM' THEN 2
             WHEN 'HIGH' THEN 3
             WHEN 'CRITICAL' THEN 4
           END
           <
           CASE EXCLUDED.severity
             WHEN 'LOW' THEN 1
             WHEN 'MEDIUM' THEN 2
             WHEN 'HIGH' THEN 3
             WHEN 'CRITICAL' THEN 4
           END
         THEN EXCLUDED.severity
         ELSE incidents.severity
       END`,
    [serviceId, title, description, severity],
  );
}

async function evaluateRule(
  service: ServiceRow,
  rule: RuleRow,
): Promise<void> {
  let observed: number | null = null;

  if (rule.rule_type === 'ERROR_COUNT') {
    const result = await pool.query<ObservedValue>(
      `SELECT COUNT(*)::text AS value
       FROM logs
       WHERE service_id = $1
         AND level = 'ERROR'
         AND occurred_at >=
             NOW() - ($2 * INTERVAL '1 minute')`,
      [service.id, rule.window_minutes],
    );

    const value = result.rows[0]?.value;

    observed = value === null || value === undefined
      ? null
      : Number(value);
  }

  if (rule.rule_type === 'METRIC_AVG') {
    if (!rule.metric_name) {
      throw new Error(
        `Missing metric name for rule ${rule.rule_key}`,
      );
    }

    const result = await pool.query<ObservedValue>(
      `SELECT AVG(value)::text AS value
       FROM metrics
       WHERE service_id = $1
         AND metric_name = $2
         AND recorded_at >=
             NOW() - ($3 * INTERVAL '1 minute')`,
      [
        service.id,
        rule.metric_name,
        rule.window_minutes,
      ],
    );

    const value = result.rows[0]?.value;

    observed = value === null || value === undefined
      ? null
      : Number(value);
  }

  if (observed === null || !Number.isFinite(observed)) {
    return;
  }

  const threshold = Number(rule.threshold);

  if (!thresholdMet(observed, threshold, rule.comparison)) {
    return;
  }

  const description =
    rule.rule_type === 'ERROR_COUNT'
      ? `${observed} ERROR logs detected within the last ${rule.window_minutes} minute(s).`
      : `Average ${rule.metric_name} is ${observed.toFixed(2)} over the last ${rule.window_minutes} minute(s).`;

  console.log(
    `Rule ${rule.rule_key} triggered for ${service.name}`,
  );

  await createOrUpdateIncident(
    service.id,
    rule.title,
    description,
    rule.severity,
  );
}

export async function detectIncidentsOnce(): Promise<void> {
  const [servicesResult, rulesResult] = await Promise.all([
    pool.query<ServiceRow>(
      'SELECT id, name FROM services ORDER BY id',
    ),

    pool.query<RuleRow>(
      `SELECT
         rule_key,
         rule_type,
         title,
         metric_name,
         threshold::text AS threshold,
         comparison,
         window_minutes,
         severity
       FROM incident_rules
       WHERE enabled = TRUE
       ORDER BY
         CASE severity
           WHEN 'CRITICAL' THEN 4
           WHEN 'HIGH' THEN 3
           WHEN 'MEDIUM' THEN 2
           WHEN 'LOW' THEN 1
         END DESC`,
    ),
  ]);

  for (const service of servicesResult.rows) {
    for (const rule of rulesResult.rows) {
      try {
        await evaluateRule(service, rule);
      } catch (error) {
        console.error(
          `Rule ${rule.rule_key} failed for ${service.name}:`,
          error,
        );
      }
    }
  }
}

export function startIncidentDetector(
  intervalMs = 15_000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async (): Promise<void> => {
    if (stopped) return;

    try {
      await detectIncidentsOnce();
    } catch (error) {
      console.error('Incident detection cycle failed:', error);
    }

    if (!stopped) {
      timer = setTimeout(() => {
        void run();
      }, intervalMs);
    }
  };

  void run();

  return () => {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
    }
  };
}