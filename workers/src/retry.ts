import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

// Total delivery attempts before a message is moved to the dead-letter queue.
export const MAX_ATTEMPTS = 3;

// How long a failed message waits in the retry queue before it is redelivered.
// Changing this requires deleting the existing *.retry queue, because
// RabbitMQ refuses to redeclare a queue with different arguments.
export const RETRY_DELAY_MS = 5_000;

const ATTEMPT_HEADER = 'tracelens-attempt';

export type QueueTopology = {
  main: string;
  retry: string;
  dead: string;
};

export function topologyFor(mainQueue: string): QueueTopology {
  return {
    main: mainQueue,
    retry: `${mainQueue}.retry`,
    dead: `${mainQueue}.dlq`,
  };
}

/**
 * main  -> consumed by the worker
 * retry -> no consumer; messages expire after RETRY_DELAY_MS and are
 *          dead-lettered back to `main` by RabbitMQ
 * dead  -> parking queue for messages that failed permanently
 */
export async function assertTopology(
  channel: ConfirmChannel,
  topology: QueueTopology,
): Promise<void> {
  await channel.assertQueue(topology.main, { durable: true });

  await channel.assertQueue(topology.retry, {
    durable: true,
    arguments: {
      'x-message-ttl': RETRY_DELAY_MS,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': topology.main,
    },
  });

  await channel.assertQueue(topology.dead, { durable: true });
}

export function attemptOf(message: ConsumeMessage): number {
  const raw = message.properties.headers?.[ATTEMPT_HEADER];
  const attempt = Number(raw ?? 1);

  return Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
}

async function moveTo(
  channel: ConfirmChannel,
  queue: string,
  message: ConsumeMessage,
  headers: Record<string, unknown>,
): Promise<void> {
  // Ack the original only after the broker has confirmed the copy,
  // so a crash in between causes a duplicate, never a lost message.
  await new Promise<void>((resolve, reject) => {
    channel.sendToQueue(
      queue,
      message.content,
      {
        persistent: true,
        contentType: message.properties.contentType,
        headers: { ...message.properties.headers, ...headers },
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });

  channel.ack(message);
}

export async function deadLetter(
  channel: ConfirmChannel,
  topology: QueueTopology,
  message: ConsumeMessage,
  reason: string,
): Promise<void> {
  await moveTo(channel, topology.dead, message, {
    [ATTEMPT_HEADER]: attemptOf(message),
    'tracelens-error': reason.slice(0, 500),
    'tracelens-failed-at': new Date().toISOString(),
  });
}

/**
 * Schedules a delayed retry, or dead-letters the message once
 * MAX_ATTEMPTS has been reached.
 */
export async function retryOrDeadLetter(
  channel: ConfirmChannel,
  topology: QueueTopology,
  message: ConsumeMessage,
  error: unknown,
): Promise<'retried' | 'dead-lettered'> {
  const attempt = attemptOf(message);

  if (attempt >= MAX_ATTEMPTS) {
    const reason = error instanceof Error ? error.message : String(error);
    await deadLetter(channel, topology, message, reason);
    return 'dead-lettered';
  }

  await moveTo(channel, topology.retry, message, {
    [ATTEMPT_HEADER]: attempt + 1,
  });

  return 'retried';
}
