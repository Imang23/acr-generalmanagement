import dotenv from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// โหลด .env จากโฟลเดอร์หลัก acr-management
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

// DATE → YYYY-MM-DD
pg.types.setTypeParser(1082, (value) => value);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'ไม่พบ DATABASE_URL ในไฟล์ acr-management/.env'
  );
}

const hostname = new URL(connectionString).hostname;
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);

export const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});