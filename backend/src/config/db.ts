
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';

dotenv.config({
  path: path.resolve(process.cwd(), '../.env'),
  override: false,
  quiet: true,
});

export const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
