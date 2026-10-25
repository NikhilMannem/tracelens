import express from 'express';
import { pool } from './config/db';
import { publishLog } from './config/rabbitmq';
import { publishMetric } from './config/metricsRabbitmq';
import cors from 'cors';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:8081',
  ],
}));

const validLevels = ['INFO', 'WARN', 'ERROR'];

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/services', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, created_at FROM services ORDER BY id'
    );

    return res.status(200).json({
      services: result.rows,
    });
  } catch (error) {
    console.error('Failed to fetch services:', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

app.get('/api/services/:name', async (req, res) => {
  const name = req.params.name;
  try {
    const result = await pool.query('SELECT name FROM services WHERE name = $1', [name]);

    if (result.rows.length > 0) {
      return res.status(200).json({ service: name });
    }

    return res.status(404).json({ error: 'Service not found' });
  } catch (error) {
    console.error('Failed to verify service:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/validate-log', async (req, res) => {
  const { serviceName, level, message } = req.body;

  if (typeof serviceName !== 'string') {
    return res.status(400).json({ error: 'Invalid or unknown serviceName' });
  }

  const normalizedServiceName = serviceName.trim();
  if (normalizedServiceName === '') {
    return res.status(400).json({ error: 'Invalid or unknown serviceName' });
  }

  if (!validLevels.includes(level)) {
    return res.status(400).json({ error: 'Invalid log level' });
  }

  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  try {
    const result = await pool.query(
      'SELECT 1 FROM services WHERE name = $1',
      [normalizedServiceName]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or unknown serviceName' });
    }
  } catch (error) {
    console.error('Failed to validate log service:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(200).json({ valid: true });
});



app.post('/api/logs', async (req, res) => {
  const { serviceName, level, message, occurredAt } = req.body ?? {};

  if (typeof serviceName !== 'string' || serviceName.trim() === '') {
    return res.status(400).json({ error: 'Invalid serviceName' });
  }

  if (
    typeof level !== 'string' ||
    !validLevels.includes(level)
  ) {
    return res.status(400).json({ error: 'Invalid log level' });
  }

  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  const timestamp =
    occurredAt === undefined
      ? new Date()
      : new Date(occurredAt);

  if (Number.isNaN(timestamp.getTime())) {
    return res.status(400).json({
      error: 'Invalid occurredAt timestamp',
    });
  }

  try {
    // Verify the service exists before accepting the log.
    const serviceResult = await pool.query(
      'SELECT id FROM services WHERE name = $1',
      [serviceName.trim()],
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await publishLog({
      serviceName: serviceName.trim(),
      level: level as 'INFO' | 'WARN' | 'ERROR',
      message: message.trim(),
      occurredAt: timestamp.toISOString(),
    });

    return res.status(202).json({
      message: 'Log accepted for asynchronous processing',
    });
  } catch (error) {
    console.error('Failed to publish log:', error);

    return res.status(503).json({
      error: 'Log ingestion is temporarily unavailable',
    });
  }
});

app.get('/api/logs', async (req, res) => {
  const rawLimit = req.query.limit ?? '50';
  const limit = Number(rawLimit);

  if (
    typeof rawLimit !== 'string' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return res.status(400).json({
      error: 'limit must be an integer between 1 and 100',
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         logs.id,
         services.name AS service_name,
         logs.level,
         logs.message,
         logs.occurred_at,
         logs.received_at
       FROM logs
       JOIN services ON services.id = logs.service_id
       ORDER BY logs.received_at DESC, logs.id DESC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({
      count: result.rows.length,
      logs: result.rows,
    });
  } catch (error) {
    console.error('Failed to fetch logs:', error);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});


app.post('/api/metrics', async (req, res) => {
  const { serviceName, metricName, value, recordedAt } = req.body ?? {};

  if (typeof serviceName !== 'string' || !serviceName.trim()) {
    return res.status(400).json({ error: 'Invalid serviceName' });
  }

  if (typeof metricName !== 'string' || !metricName.trim()) {
    return res.status(400).json({ error: 'Invalid metricName' });
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return res.status(400).json({ error: 'Invalid metric value' });
  }

  const timestamp =
    recordedAt === undefined ? new Date() : new Date(recordedAt);

  if (Number.isNaN(timestamp.getTime())) {
    return res.status(400).json({ error: 'Invalid recordedAt timestamp' });
  }

  try {
    const serviceResult = await pool.query(
      'SELECT id FROM services WHERE name = $1',
      [serviceName.trim()],
    );

    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await publishMetric({
      serviceName: serviceName.trim(),
      metricName: metricName.trim(),
      value,
      recordedAt: timestamp.toISOString(),
    });

    return res.status(202).json({
      message: 'Metric accepted for asynchronous processing',
    });
  } catch (error) {
    console.error('Failed to publish metric:', error);

    return res.status(503).json({
      error: 'Metric ingestion is temporarily unavailable',
    });
  }
});

app.get('/api/metrics', async (req, res) => {
  const rawLimit = req.query.limit ?? '50';
  const limit = Number(rawLimit);

  if (
    typeof rawLimit !== 'string' ||
    !/^\d+$/.test(rawLimit) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return res.status(400).json({
      error: 'limit must be an integer between 1 and 100',
    });
  }

  try {
    const result = await pool.query(
      `SELECT m.id, s.name AS service_name, m.metric_name,
              m.value, m.recorded_at, m.received_at
       FROM metrics m
       JOIN services s ON s.id = m.service_id
       ORDER BY m.recorded_at DESC, m.id DESC
       LIMIT $1`,
      [limit],
    );

    return res.status(200).json({
      count: result.rows.length,
      metrics: result.rows,
    });
  } catch (error) {
    console.error('Failed to retrieve metrics:', error);

    return res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

app.get('/api/incidents', async (req, res) => {
  const rawLimit = req.query.limit ?? '50';
  const limit = Number(rawLimit);

  if (
    typeof rawLimit !== 'string' ||
    !/^\d+$/.test(rawLimit) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return res.status(400).json({
      error: 'limit must be an integer between 1 and 100',
    });
  }

  try {
    const result = await pool.query(
      `SELECT i.id, s.name AS service_name, i.title,
              i.description, i.severity, i.status,
              i.detected_at, i.resolved_at
       FROM incidents i
       JOIN services s ON s.id = i.service_id
       ORDER BY i.detected_at DESC, i.id DESC
       LIMIT $1`,
      [limit],
    );

    return res.status(200).json({
      count: result.rows.length,
      incidents: result.rows,
    });
  } catch (error) {
    console.error('Failed to retrieve incidents:', error);
    return res.status(500).json({
      error: 'Failed to retrieve incidents',
    });
  }
});


app.get('/api/incidents/:id', async (req, res) => {
  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  try {
    const result = await pool.query(
      `SELECT i.id, s.name AS service_name, i.title,
              i.description, i.severity, i.status,
              i.detected_at, i.resolved_at, i.created_at
       FROM incidents i
       JOIN services s ON s.id = i.service_id
       WHERE i.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    return res.status(200).json({ incident: result.rows[0] });
  } catch (error) {
    console.error('Failed to retrieve incident:', error);
    return res.status(500).json({
      error: 'Failed to retrieve incident',
    });
  }
});

app.patch('/api/incidents/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  if (!['INVESTIGATING', 'RESOLVED'].includes(status)) {
    return res.status(400).json({
      error: 'Status must be INVESTIGATING or RESOLVED',
    });
  }

  try {
    // Perform the transition atomically so invalid transitions cannot race.
    const updated = await pool.query(
      `UPDATE incidents
       SET status = $2,
           resolved_at = CASE
             WHEN $2 = 'RESOLVED' THEN NOW()
             ELSE NULL
           END
       WHERE id = $1
         AND (
           (status = 'OPEN' AND $2 IN ('INVESTIGATING', 'RESOLVED'))
           OR
           (status = 'INVESTIGATING' AND $2 = 'RESOLVED')
         )
       RETURNING id, title, severity, status, detected_at, resolved_at`,
      [id, status],
    );

    if (updated.rows.length > 0) {
      return res.status(200).json({
        message: 'Incident status updated',
        incident: updated.rows[0],
      });
    }

    const existing = await pool.query(
      'SELECT id, status FROM incidents WHERE id = $1',
      [id],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    return res.status(409).json({
      error: `Cannot transition incident from ${existing.rows[0].status} to ${status}`,
      currentStatus: existing.rows[0].status,
    });
  } catch (error) {
    console.error('Failed to update incident status:', error);
    return res.status(500).json({
      error: 'Failed to update incident status',
    });
  }
});

export default app;
