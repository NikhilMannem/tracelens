
import { pool } from '../config/db';

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type ServiceRow = {
  id: string;
  name: string;
};

type CountRow = {
  count: string;
};

type AverageRow = {
  average: string | null;
};

const ERROR_WINDOW_MINUTES = 1;
const ERROR_HIGH_THRESHOLD = 5;
const ERROR_CRITICAL_THRESHOLD = 10;

const RESPONSE_WINDOW_MINUTES = 5;
const RESPONSE_TIME_THRESHOLD_MS = 1000;

// Define request_rate as requests per minute for the simulator.
const TRAFFIC_WINDOW_MINUTES = 1;
const TRAFFIC_THRESHOLD_PER_MINUTE = 100;

async function createOrUpdateIncident(
  serviceId: string,
  title: string,
  description: string,
  severity: Severity,
): Promise<void> {
  const result = await pool.query(
    `INSERT INTO incidents
       (service_id, title, description, severity, status)
     VALUES ($1, $2, $3, $4, 'OPEN')
     ON CONFLICT (service_id, title)
       WHERE status IN ('OPEN', 'INVESTIGATING')
     DO UPDATE SET
       description = EXCLUDED.description,
       severity = CASE
         WHEN CASE incidents.severity
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
       END
     RETURNING id`,
    [serviceId, title, description, severity],
  );

  if (result.rowCount && result.rowCount > 0) {
    // The upsert also returns an ID when it updates an existing incident.
    // A separate insert-only result is added below for clean reporting.
  }
}

async function detectErrorBursts(service: ServiceRow): Promise<void> {
  const result = await pool.query<CountRow>(
    `SELECT COUNT(*)::text AS count
     FROM logs
     WHERE service_id = $1
       AND level = 'ERROR'
       AND occurred_at >= NOW() - ($2 * INTERVAL '1 minute')`,
    [service.id, ERROR_WINDOW_MINUTES],
  );

  const count = Number(result.rows[0]?.count ?? 0);

  if (count >= ERROR_CRITICAL_THRESHOLD) {
    await createOrUpdateIncident(
      service.id,
      'Repeated error burst',
      `${count} ERROR logs detected within the last minute.`,
      'CRITICAL',
    );
  } else if (count >= ERROR_HIGH_THRESHOLD) {
    await createOrUpdateIncident(
      service.id,
      'Repeated error burst',
      `${count} ERROR logs detected within the last minute.`,
      'HIGH',
    );
  }
}

async function detectSlowResponses(service: ServiceRow): Promise<void> {
  const result = await pool.query<AverageRow>(
    `SELECT AVG(value)::text AS average
     FROM metrics
     WHERE service_id = $1
       AND metric_name = 'response_time_ms'
       AND recorded_at >= NOW() - ($2 * INTERVAL '1 minute')`,
    [service.id, RESPONSE_WINDOW_MINUTES],
  );

  const average = result.rows[0]?.average;

  if (average !== null && average !== undefined) {
    const responseTime = Number(average);

    if (Number.isFinite(responseTime) &&
        responseTime > RESPONSE_TIME_THRESHOLD_MS) {
      await createOrUpdateIncident(
        service.id,
        'High response time',
        `Average response time is ${Math.round(responseTime)} ms over the last five minutes.`,
        'HIGH',
      );
    }
  }
}

async function detectTrafficSpikes(service: ServiceRow): Promise<void> {
  const result = await pool.query<AverageRow>(
    `SELECT AVG(value)::text AS average
     FROM metrics
     WHERE service_id = $1
       AND metric_name = 'requests_per_minute'
       AND recorded_at >= NOW() - ($2 * INTERVAL '1 minute')`,
    [service.id, TRAFFIC_WINDOW_MINUTES],
  );

  const average = result.rows[0]?.average;

  if (average !== null && average !== undefined) {
    const requestsPerMinute = Number(average);

    if (Number.isFinite(requestsPerMinute) &&
        requestsPerMinute > TRAFFIC_THRESHOLD_PER_MINUTE) {
      await createOrUpdateIncident(
        service.id,
        'Traffic spike detected',
        `Average traffic is ${Math.round(requestsPerMinute)} requests per minute.`,
        'MEDIUM',
      );
    }
  }
}

export async function detectIncidentsOnce(): Promise<void> {
  const services = await pool.query<ServiceRow>(
    'SELECT id, name FROM services ORDER BY id',
  );

  for (const service of services.rows) {
    try {
      await detectErrorBursts(service);
      await detectSlowResponses(service);
      await detectTrafficSpikes(service);
    } catch (error) {
      // One service/rule failing should not stop detection for other services.
      console.error(
        `Incident detection failed for ${service.name}:`,
        error,
      );
    }
  }
}

export function startIncidentDetector(intervalMs = 15_000): () => void {
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
