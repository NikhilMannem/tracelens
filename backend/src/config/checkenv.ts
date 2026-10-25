
import dotenv from 'dotenv';
import path from 'node:path';

const envPath = path.resolve(__dirname, '../../../.env');
const result = dotenv.config({ path: envPath, override: true });

if (result.error) {
  console.error('Could not load .env:', result.error.message);
  process.exitCode = 1;
} else {
  console.log('Loaded .env:', envPath);
  console.log('DB host:', process.env.DB_HOST);
  console.log('DB port:', process.env.DB_PORT);
  console.log('DB user:', process.env.POSTGRES_USER);
  console.log('DB name:', process.env.POSTGRES_DB);
  console.log(
    'Password matches expected value:',
    process.env.POSTGRES_PASSWORD === 'TraceLensLocal_8264'
  );
}
