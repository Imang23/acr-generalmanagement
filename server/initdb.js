import fs from 'fs';
import { pool } from './db.js';
const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
await pool.query(sql);
console.log('✓ สร้างตารางเรียบร้อย');
await pool.end();
