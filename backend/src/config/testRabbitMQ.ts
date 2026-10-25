
import {
  connectRabbitMQ,
  closeRabbitMQ,
  type LogPayload,
} from './rabbitmq';

async function runTestPublisher(): Promise<void> {
  try {
    const payload: LogPayload = {
      serviceName: 'payment-service',
      level: 'ERROR',
      message: 'RabbitMQ test message',
      occurredAt: new Date().toISOString(),
    };

    const channel = await connectRabbitMQ();

    channel.sendToQueue(
      'tracelens.logs',
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        contentType: 'application/json',
      },
    );

    await channel.waitForConfirms();

    console.log('RabbitMQ confirmed the message.');
  } catch (error) {
    console.error('RabbitMQ publisher test failed:', error);
    process.exitCode = 1;
  } finally {
    try {
      await closeRabbitMQ();
      console.log('RabbitMQ connection closed.');
    } catch (error) {
      console.error('Failed to close RabbitMQ connection:', error);
      process.exitCode = 1;
    }
  }
}

void runTestPublisher();
