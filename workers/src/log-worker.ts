
import dotenv from 'dotenv';
import path from 'node:path';
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { Pool } from 'pg';

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});

const QUEUE_NAME = 'tracelens.logs';

const rabbitmqUrl = process.env.RABBITMQ_URL;

if (!rabbitmqUrl) {
  throw new Error('RABBITMQ_URL is missing from .env');
}

const dbPort = Number(
  process.env.DB_PORT ?? process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5433,
);

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host:
          process.env.DB_HOST ??
          process.env.PGHOST ??
          process.env.POSTGRES_HOST ??
          '127.0.0.1',
        port: dbPort,
        user:
          process.env.DB_USER ??
          process.env.PGUSER ??
          process.env.POSTGRES_USER,
        password:
          process.env.DB_PASSWORD ??
          process.env.PGPASSWORD ??
          process.env.POSTGRES_PASSWORD,
        database:
          process.env.DB_NAME ??
          process.env.PGDATABASE ??
          process.env.POSTGRES_DB,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      },
);

type LogPayload = {
  serviceName: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  occurredAt: string;
};

let connection: ChannelModel | undefined;
let channel: Channel | undefined;
let stopping = false;

function parseLog(content: Buffer): LogPayload | null {
  try {
    const value: unknown = JSON.parse(content.toString());

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const log = value as Record<string, unknown>;

    if (
      typeof log.serviceName !== 'string' ||
      !log.serviceName.trim() ||
      typeof log.message !== 'string' ||
      !log.message.trim() ||
      typeof log.occurredAt !== 'string' ||
      Number.isNaN(Date.parse(log.occurredAt)) ||
      !['INFO', 'WARN', 'ERROR'].includes(String(log.level))
    ) {
      return null;
    }

    return {
      serviceName: log.serviceName.trim(),
      level: log.level as LogPayload['level'],
      message: log.message.trim(),
      occurredAt: new Date(log.occurredAt).toISOString(),
    };
  } catch {
    return null;
  }
}

async function processLog(payload: LogPayload): Promise<boolean> {
  const serviceResult = await pool.query<{ id: string }>(
    'SELECT id FROM services WHERE name = $1',
    [payload.serviceName],
  );

  if (serviceResult.rows.length === 0) {
    console.error(`Unknown service "${payload.serviceName}". Discarding message.`);
    return false;
  }

  await pool.query(
    `INSERT INTO logs (service_id, level, message, occurred_at)
     VALUES ($1, $2, $3, $4)`,
    [
      serviceResult.rows[0].id,
      payload.level,
      payload.message,
      payload.occurredAt,
    ],
  );

  return true;
}

async function handleMessage(
  activeChannel: Channel,
  message: ConsumeMessage,
): Promise<void> {
  const payload = parseLog(message.content);

  if (!payload) {
    console.error('Invalid log message. Discarding message.');
    activeChannel.ack(message);
    return;
  }

  try {
    const stored = await processLog(payload);

    // Ack only after successful persistence or permanent validation failure.
    activeChannel.ack(message);

    if (stored) {
      console.log(`Stored ${payload.level} log for ${payload.serviceName}`);
    }
  } catch (error) {
    console.error('Failed to persist log; requeueing message:', error);

    // Database errors are treated as potentially temporary.
    // Production hardening should add bounded retries and a dead-letter queue.
    if (!stopping) {
      activeChannel.nack(message, false, true);
    }
  }
}

async function startWorker(): Promise<void> {
  connection = await amqp.connect(rabbitmqUrl!);
  channel = await connection.createChannel();

  await channel.assertQueue(QUEUE_NAME, { durable: true });

  // Prevent this worker from taking more than ten unacknowledged messages.
  await channel.prefetch(10);

  await channel.consume(
    QUEUE_NAME,
    (message: ConsumeMessage | null) => {
      if (message && channel) {
        void handleMessage(channel, message);
      }
    },
    { noAck: false },
  );

  console.log(`Log worker listening on "${QUEUE_NAME}"`);
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;

  console.log('Shutting down log worker...');

  try {
    if (channel) {
      await channel.close();
    }
  } catch (error) {
    console.error('Error closing RabbitMQ channel:', error);
  }

  try {
    if (connection) {
      await connection.close();
    }
  } catch (error) {
    console.error('Error closing RabbitMQ connection:', error);
  }

  await pool.end();
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

startWorker().catch(async (error: unknown) => {
  console.error('Could not start log worker:', error);
  await shutdown();
  process.exitCode = 1;
});
