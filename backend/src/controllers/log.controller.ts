
import { Request, Response } from 'express';
import { pool } from '../config/db';
import { publishLog } from '../config/rabbitmq';

const validLevels = ['INFO', 'WARN', 'ERROR'];

export async function validateLog(req: Request, res: Response) {
  const { serviceName, level, message } = req.body ?? {};

  if (typeof serviceName !== 'string' || !serviceName.trim()) {
    return res.status(400).json({
      error: 'Invalid or unknown serviceName',
    });
  }

  if (!validLevels.includes(level)) {
    return res.status(400).json({ error: 'Invalid log level' });
  }

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  try {
    const result = await pool.query(
      'SELECT 1 FROM services WHERE name = $1',
      [serviceName.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid or unknown serviceName',
      });
    }

    return res.status(200).json({ valid: true });
  } catch (error) {
    console.error('Failed to validate log service:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createLog(req: Request, res: Response) {
  const { serviceName, level, message, occurredAt } = req.body ?? {};

  if (typeof serviceName !== 'string' || !serviceName.trim()) {
    return res.status(400).json({ error: 'Invalid serviceName' });
  }

  if (typeof level !== 'string' || !validLevels.includes(level)) {
    return res.status(400).json({ error: 'Invalid log level' });
  }

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  const timestamp =
    occurredAt === undefined ? new Date() : new Date(occurredAt);

  if (Number.isNaN(timestamp.getTime())) {
    return res.status(400).json({
      error: 'Invalid occurredAt timestamp',
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
}

export async function getLogs(req: Request, res: Response) {
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
}
