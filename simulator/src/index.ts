const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const args = process.argv.slice(2);
const burstMode = args.includes('--burst');

const intervalArg = args.find((arg) => arg.startsWith('--interval='));
const intervalMs = intervalArg
  ? Number(intervalArg.split('=')[1])
  : 3000;

const logLevels = ['INFO', 'INFO', 'INFO', 'WARN'] as const;

const messages = [
  'Request processed successfully',
  'Database query completed',
  'Cache lookup completed',
  'User authentication successful',
  'External API response received',
];

const errorMessages = [
  'Payment gateway request failed',
  'Database connection timeout',
  'External service returned HTTP 500',
  'Payment processing failed',
];

const metricNames = [
  'request_count',
  'response_time_ms',
  'cpu_usage',
  'memory_usage',
];

interface Service {
  name: string;
}

async function postEvent(
  endpoint: string,
  payload: Record<string, string | number>,
): Promise<void> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${endpoint} returned ${response.status}: ${error}`);
  }
}

async function getServices(): Promise<Service[]> {
  const response = await fetch(`${API_URL}/api/services`);

  if (!response.ok) {
    throw new Error(`Could not retrieve services: ${response.status}`);
  }

  const data = await response.json() as
    | { services: Service[] }
    | Service[];

  const services = Array.isArray(data) ? data : data.services;

  if (!services?.length) {
    throw new Error('No services found. Add services before running simulator.');
  }

  return services;
}

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomMetricValue(metricName: string): number {
  switch (metricName) {
    case 'request_count':
      return Math.floor(Math.random() * 100) + 1;
    case 'response_time_ms':
      return Math.floor(Math.random() * 500) + 20;
    case 'cpu_usage':
    case 'memory_usage':
      return Number((Math.random() * 80 + 10).toFixed(2));
    default:
      return Number((Math.random() * 100).toFixed(2));
  }
}

async function sendLog(
  serviceName: string,
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
): Promise<void> {
  await postEvent('/api/logs', {
    serviceName,
    level,
    message,
    occurredAt: new Date().toISOString(),
  });

  console.log(`[LOG] ${level} ${serviceName}: ${message}`);
}

async function sendMetric(serviceName: string): Promise<void> {
  const metricName = randomItem(metricNames);

  await postEvent('/api/metrics', {
    serviceName,
    metricName,
    value: randomMetricValue(metricName),
    recordedAt: new Date().toISOString(),
  });

  console.log(`[METRIC] ${serviceName}: ${metricName}`);
}

async function runCycle(services: Service[]): Promise<void> {
  const service = randomItem(services);

  await sendLog(
    service.name,
    randomItem(logLevels),
    randomItem(messages),
  );

  await sendMetric(service.name);
}

async function runBurst(services: Service[]): Promise<void> {
  const service = randomItem(services);

  console.log(`Starting error burst for ${service.name}`);

  // Send 12 errors quickly to trigger the detector.
  for (let i = 0; i < 12; i++) {
    await sendLog(
      service.name,
      'ERROR',
      randomItem(errorMessages),
    );
  }

  console.log('Error burst completed.');
}

async function main(): Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs < 500) {
    throw new Error('Interval must be at least 500 milliseconds.');
  }

  console.log(`TraceLens simulator connecting to ${API_URL}`);

  const services = await getServices();

  console.log(
    `Found services: ${services.map((service) => service.name).join(', ')}`,
  );

  if (burstMode) {
    await runBurst(services);
    return;
  }

  console.log(`Normal traffic running every ${intervalMs}ms`);

  while (true) {
    try {
      await runCycle(services);
    } catch (error) {
      console.error('Simulation cycle failed:', error);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((error) => {
  console.error('Simulator failed:', error);
  process.exitCode = 1;
});