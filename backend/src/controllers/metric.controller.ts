
import { Request, Response } from 'express';
import { pool } from '../config/db';
import { publishMetric } from '../config/metricsRabbitmq';

export async function createMetric(req: Request, res: Response) {
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
    return res.status(400).json({
      error: 'Invalid recordedAt timestamp',
    });
  }

  try {
    const serviceResult = await pool.query(
      'SELECT id FROM services WHERE name = $1',
      [serviceName.trim()]
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
}

export async function getMetrics(req: Request, res: Response) {
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
      [limit]
    );

    return res.status(200).json({
      count: result.rows.length,
      metrics: result.rows,
    });
  } catch (error) {
    console.error('Failed to retrieve metrics:', error);
    return res.status(500).json({
      error: 'Failed to retrieve metrics',
    });
  }
}
