
import dotenv from 'dotenv';
import path from 'node:path';
import amqp, {
  type ChannelModel,
  type ConfirmChannel,
} from 'amqplib';

dotenv.config({
  path: path.resolve(__dirname, '../../../.env'),
  quiet: true,
});

export type MetricPayload = {
  serviceName: string;
  metricName: string;
  value: number;
  recordedAt: string;
};

const QUEUE_NAME = 'tracelens.metrics';

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;

export async function publishMetric(
  payload: MetricPayload,
): Promise<void> {
  if (!channel) {
    const url = process.env.RABBITMQ_URL;
    if (!url) throw new Error('RABBITMQ_URL is missing');

    const newConnection = await amqp.connect(url);

    try {
      const newChannel = await newConnection.createConfirmChannel();

      await newChannel.assertQueue(QUEUE_NAME, { durable: true });

      connection = newConnection;
      channel = newChannel;

      newConnection.on('close', () => {
        if (connection === newConnection) {
          connection = null;
          channel = null;
        }
      });

      newChannel.on('close', () => {
        if (channel === newChannel) channel = null;
      });
    } catch (error) {
      await newConnection.close().catch(() => undefined);
      throw error;
    }
  }

  const activeChannel = channel;
  if (!activeChannel) throw new Error('Metrics RabbitMQ channel unavailable');

  activeChannel.sendToQueue(
    QUEUE_NAME,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      contentType: 'application/json',
    },
  );

  await activeChannel.waitForConfirms();
}

export async function closeMetricsRabbitMQ(): Promise<void> {
  const activeConnection = connection;
  connection = null;
  channel = null;

  if (activeConnection) await activeConnection.close();
}
