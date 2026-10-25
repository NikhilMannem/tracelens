
import dotenv from 'dotenv';
import path from 'node:path';
import amqp, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage,
} from 'amqplib';
import { Pool } from 'pg';

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});

const queueName = 'tracelens.metrics';
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
    console.error(`Unknown service "${metric.serviceName}". Discarding metric.`);
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
  channel: Channel,
  message: ConsumeMessage,
): Promise<void> {
  const metric = parseMetric(message.content);

  if (!metric) {
    console.error('Invalid metric message. Discarding.');
    channel.ack(message);
    return;
  }

  try {
    const stored = await persistMetric(metric);
    channel.ack(message);

    if (stored) {
      console.log(
        `Stored ${metric.metricName}=${metric.value} for ${metric.serviceName}`,
      );
    }
  } catch (error) {
    console.error('Metric persistence failed; requeueing:', error);
    channel.nack(message, false, true);
  }
}

let connection: ChannelModel | undefined;
let channel: Channel | undefined;
let stopping = false;

async function start(): Promise<void> {
  connection = await amqp.connect(rabbitmqUrl!);
  channel = await connection.createChannel();

  await channel.assertQueue(queueName, { durable: true });
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
