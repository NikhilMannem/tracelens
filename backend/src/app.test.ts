
import request from 'supertest';
import { afterAll, expect, describe, it } from '@jest/globals';
import app from './app';
import { pool } from './config/db';

afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  it('returns 200 and an ok status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/validate-log', () => {
  it('accepts a valid log payload', async () => {
    const response = await request(app)
      .post('/api/validate-log')
      .send({
        serviceName: 'payment-service',
        level: 'ERROR',
        message: 'Payment gateway timeout',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: true });
  });

  it('rejects an invalid log level', async () => {
    const response = await request(app)
      .post('/api/validate-log')
      .send({
        serviceName: 'payment-service',
        level: 'DEBUG',
        message: 'Test message',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid log level' });
  });
});

describe('GET /api/incidents', () => {
  it('returns incidents with their service names', async () => {
    const response = await request(app).get('/api/incidents?limit=10');

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(response.body.incidents.length);
    expect(response.body.incidents).toEqual(expect.any(Array));
    for (const incident of response.body.incidents) {
      expect(incident).toEqual(
        expect.objectContaining({
          service_name: expect.any(String),
          title: expect.any(String),
        }),
      );
    }
  });

  it('rejects a non-integer limit', async () => {
    const response = await request(app).get('/api/incidents?limit=1e0');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'limit must be an integer between 1 and 100',
    });
  });
});
