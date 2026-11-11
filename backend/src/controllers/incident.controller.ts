
import { Request, Response } from 'express';
import { pool } from '../config/db';

export async function getIncidents(req: Request, res: Response) {
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
      [limit]
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
}

export async function getIncidentById(req: Request, res: Response) {
const id = req.params.id;

if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
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
      [id]
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
}

export async function updateIncidentStatus(req: Request, res: Response) {
  const id = req.params.id;
  const { status } = req.body ?? {};

  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  if (!['INVESTIGATING', 'RESOLVED'].includes(status)) {
    return res.status(400).json({
      error: 'Status must be INVESTIGATING or RESOLVED',
    });
  }

  try {
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
      [id, status]
    );

    if (updated.rows.length > 0) {
      return res.status(200).json({
        message: 'Incident status updated',
        incident: updated.rows[0],
      });
    }

    const existing = await pool.query(
      'SELECT id, status FROM incidents WHERE id = $1',
      [id]
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
}
