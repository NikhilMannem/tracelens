
import request from 'supertest';
import app from './app';
import { pool } from './config/db';
import { publishLog } from './config/rabbitmq';

const testPrefix = `jest-test-${Date.now()}-`;
const seedMessage = `${testPrefix}seed`;

jest.mock('./config/rabbitmq', () => ({
  publishLog: jest.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  await pool.query(
    `INSERT INTO logs (service_id, level, message, occurred_at)
     SELECT id, 'INFO', $2, NOW()
     FROM services
     WHERE name = $1`,
    ['payment-service', seedMessage]
  );
});

afterAll(async () => {
  try {
    await pool.query(
      'DELETE FROM logs WHERE message LIKE $1',
      [`${testPrefix}%`]
    );
  } finally {
    await pool.end();
  }
});

describe('POST /api/logs', () => {
  it('stores a valid log and returns 201', async () => {
    const message = `${testPrefix}post-success`;

    const response = await request(app)
      .post('/api/logs')
      .send({
        serviceName: 'payment-service',
        level: 'ERROR',
        message,
      });

    expect(response.status).toBe(202);
    expect(response.body.message).toBe('Log accepted for asynchronous processing');
  });

  it('rejects an invalid log level', async () => {
    const response = await request(app)
      .post('/api/logs')
      .send({
        serviceName: 'payment-service',
        level: 'DEBUG',
        message: `${testPrefix}invalid-level`,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid log level');
  });

  it('returns 404 for an unknown service', async () => {
    const response = await request(app)
      .post('/api/logs')
      .send({
        serviceName: 'unknown-service',
        level: 'ERROR',
        message: `${testPrefix}unknown-service`,
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Service not found');
  });
});

describe('GET /api/logs', () => {
  it('returns stored logs with their service names', async () => {
    const response = await request(app).get('/api/logs');

    expect(response.status).toBe(200);
    expect(response.body.count).toBeGreaterThan(0);
    expect(response.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service_name: 'payment-service',
          message: seedMessage,
        }),
      ])
    );
  });

  it('rejects a limit greater than 100', async () => {
    const response = await request(app).get('/api/logs?limit=500');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      'limit must be an integer between 1 and 100'
    );
  });
});
