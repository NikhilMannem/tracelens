
import dotenv from 'dotenv';
import path from 'node:path';
import amqp, {
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import { Pool } from 'pg';
import {
  MAX_ATTEMPTS,
  assertTopology,
  attemptOf,
  deadLetter,
  retryOrDeadLetter,
  topologyFor,
} from './retry';

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});

const queueName = 'tracelens.metrics';
const topology = topologyFor(queueName);
const rabbitmqUrl = process.env.RABBITMQ_URL;

if (!rabbitmqUrl) {
  throw new Error('RABBITMQ_URL is missing');
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST ?? process.env.PGHOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? process.env.PGPORT ?? 5433),
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

type MetricPayload = {
  serviceName: string;
  metricName: string;
  value: number;
  recordedAt: string;
};

function parseMetric(content: Buffer): MetricPayload | null {
  try {
    const parsed: unknown = JSON.parse(content.toString());

    if (typeof parsed !== 'object' || parsed === null) return null;

    const data = parsed as Record<string, unknown>;

    if (
      typeof data.serviceName !== 'string' ||
      !data.serviceName.trim() ||
      typeof data.metricName !== 'string' ||
      !data.metricName.trim() ||
      typeof data.value !== 'number' ||
      !Number.isFinite(data.value) ||
      typeof data.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(data.recordedAt))
    ) {
      return null;
    }

    return {
      serviceName: data.serviceName.trim(),
      metricName: data.metricName.trim(),
      value: data.value,
      recordedAt: new Date(data.recordedAt).toISOString(),
    };
  } catch {
    return null;
  }
}

async function persistMetric(metric: MetricPayload): Promise<boolean> {
  const service = await pool.query<{ id: string }>(
    'SELECT id FROM services WHERE name = $1',
    [metric.serviceName],
  );

  if (service.rows.length === 0) {
    console.error(`Unknown service "${metric.serviceName}".`);
    return false;
  }

  await pool.query(
    `INSERT INTO metrics (service_id, metric_name, value, recorded_at)
     VALUES ($1, $2, $3, $4)`,
    [
      service.rows[0].id,
      metric.metricName,
      metric.value,
      metric.recordedAt,
    ],
  );

  return true;
}

async function handleMetric(
  channel: ConfirmChannel,
  message: ConsumeMessage,
): Promise<void> {
  try {
    const metric = parseMetric(message.content);

    if (!metric) {
      console.error('Invalid metric message. Moving to dead-letter queue.');
      await deadLetter(channel, topology, message, 'Invalid metric payload');
      return;
    }

    let stored: boolean;

    try {
      stored = await persistMetric(metric);
    } catch (error) {
      const attempt = attemptOf(message);
      const outcome = await retryOrDeadLetter(channel, topology, message, error);

      console.error(
        `Metric persistence failed (attempt ${attempt}/${MAX_ATTEMPTS}); ${outcome}:`,
        error,
      );
      return;
    }

    if (!stored) {
      await deadLetter(
        channel,
        topology,
        message,
        `Unknown service "${metric.serviceName}"`,
      );
      return;
    }

    channel.ack(message);
    console.log(
      `Stored ${metric.metricName}=${metric.value} for ${metric.serviceName}`,
    );
  } catch (error) {
    // Routing to retry/dead-letter failed; the message stays unacked
    // and RabbitMQ redelivers it.
    console.error('Could not route failed metric message:', error);
  }
}

let connection: ChannelModel | undefined;
let channel: ConfirmChannel | undefined;
let stopping = false;

async function start(): Promise<void> {
  connection = await amqp.connect(rabbitmqUrl!);
  channel = await connection.createConfirmChannel();

  await assertTopology(channel, topology);
  await channel.prefetch(10);

  await channel.consume(
    queueName,
    (message: ConsumeMessage | null) => {
      if (message && channel && !stopping) {
        void handleMetric(channel, message);
      }
    },
    { noAck: false },
  );

  console.log(`Metrics worker listening on "${queueName}"`);
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;

  try {
    if (channel) await channel.close();
  } catch (error) {
    console.error('Error closing metrics channel:', error);
  }

  try {
    if (connection) await connection.close();
  } catch (error) {
    console.error('Error closing metrics connection:', error);
  }

  await pool.end();
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

start().catch(async (error: unknown) => {
  console.error('Metrics worker failed to start:', error);
  await shutdown();
  process.exitCode = 1;
});
