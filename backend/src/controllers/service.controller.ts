
import { Request, Response } from 'express';
import { pool } from '../config/db';

export async function getServices(_req: Request, res: Response) {
  try {
    const result = await pool.query(
      'SELECT id, name, created_at FROM services ORDER BY id'
    );

    return res.status(200).json({ services: result.rows });
  } catch (error) {
    console.error('Failed to fetch services:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getServiceByName(req: Request, res: Response) {
  const name = req.params.name;

  try {
    const result = await pool.query(
      'SELECT name FROM services WHERE name = $1',
      [name]
    );

    if (result.rows.length > 0) {
      return res.status(200).json({ service: name });
    }

    return res.status(404).json({ error: 'Service not found' });
  } catch (error) {
    console.error('Failed to verify service:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
