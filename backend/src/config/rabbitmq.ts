
import * as dotenv from 'dotenv';
import amqp, {
  type ChannelModel,
  type ConfirmChannel,
} from 'amqplib';
import path from 'node:path';

export type LogPayload = {
  serviceName: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  occurredAt: string;
};

const QUEUE_NAME = 'tracelens.logs';

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;

dotenv.config({
  path: path.resolve(__dirname, '../../../.env'),
});

export async function connectRabbitMQ(): Promise<ConfirmChannel> {
  if (channel) {
    return channel;
  }

  const rabbitmqUrl = process.env.RABBITMQ_URL;

  if (!rabbitmqUrl) {
    throw new Error('RABBITMQ_URL is missing');
  }

  let newConnection: ChannelModel | null = null;

  try {
    newConnection = await amqp.connect(rabbitmqUrl);
    const newChannel = await newConnection.createConfirmChannel();

    await newChannel.assertQueue(QUEUE_NAME, {
      durable: true,
    });

    newConnection.on('close', () => {
      if (connection === newConnection) {
        connection = null;
        channel = null;
      }
    });

    newChannel.on('close', () => {
      if (channel === newChannel) {
        channel = null;
      }
    });

    connection = newConnection;
    channel = newChannel;

    return newChannel;
  } catch (error) {
    channel = null;

    if (newConnection) {
      try {
        await newConnection.close();
      } catch {
        // Preserve the original initialization error.
      }
    }

    if (connection === newConnection) {
      connection = null;
    }

    throw error;
  }
}

export async function publishLog(payload: LogPayload): Promise<void> {
  const activeChannel = await connectRabbitMQ();

  const messageBuffer = Buffer.from(JSON.stringify(payload));

  activeChannel.sendToQueue(QUEUE_NAME, messageBuffer, {
    persistent: true,
    contentType: 'application/json',
  });

  await activeChannel.waitForConfirms();
}

export async function closeRabbitMQ(): Promise<void> {
  const activeConnection = connection;

  // Clear references so a later call can establish a new connection.
  connection = null;
  channel = null;

  if (activeConnection) {
    await activeConnection.close();
  }
}
