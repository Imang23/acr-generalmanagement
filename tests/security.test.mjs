// ชุดทดสอบความปลอดภัย ACR-Management (รันกับเซิร์ฟเวอร์จริง + PostgreSQL จริงในเครื่องทดสอบ)
// ใช้: node tests/security.test.mjs <โฟลเดอร์โปรเจกต์> <DATABASE_URL ของฐานข้อมูลทดสอบ>
//   ห้ามชี้ไปที่ฐานข้อมูลจริง: สคริปต์จะ DROP SCHEMA public ทุกครั้งที่เริ่มรัน
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(process.argv[2] || '..');
const dbUrl = process.argv[3] || process.env.TEST_DATABASE_URL;
if (!dbUrl || !/localhost|127\.0\.0\.1/.test(dbUrl)) {
  console.error('ปฏิเสธ: DATABASE_URL ต้องเป็น localhost เท่านั้น (สคริปต์นี้ลบข้อมูลทั้งหมด)');
  process.exit(2);
}
const require = createRequire(path.join(projectDir, 'package.json'));
const pg = require('pg');
const db = new pg.Pool({ connectionString: dbUrl });

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const GROUP_OK = 'Cgroup_allowed_000000000000000000';
const ENV = {
  DATABASE_URL: dbUrl,
  PORT: String(PORT),
  NODE_ENV: 'production',
  JWT_SECRET: crypto.randomBytes(40).toString('base64url'),
  ADMIN_USER: 'admin',
  ADMIN_PASS: 'Test-Admin-Pass-2569!',
  LINE_CHANNEL_SECRET: 'line-secret-for-tests',
  LINE_TARGET_ID: GROUP_OK,
};

/* ---------- เครื่องมือ ---------- */
const results = [];
const check = (id, title, pass, detail = '') => {
  results.push({ id, title, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(5)} ${title}${detail ? `  [${detail}]` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // วันที่ตามเวลาไทย

function startServer(env, { cwd } = {}) {
  const child = spawn(process.execPath, [path.join(projectDir, 'server/index.js')], {
    env: { PATH: process.env.PATH, ...env },
    cwd: cwd || '/tmp',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  return { child, exited, log: () => log };
}
async function waitUp(base, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${base}/api/line/webhook`); if (r.ok) return true; } catch { /* ยังไม่พร้อม */ }
    await sleep(200);
  }
  return false;
}
const req = async (method, p, { token, body, headers = {}, raw } = {}) => {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  let json = null;
  const text = await r.text();
  try { json = JSON.parse(text); } catch { /* ไม่ใช่ JSON */ }
  return { status: r.status, json, text, headers: r.headers };
};
const login = async (u, p) => (await req('POST', '/api/login', { body: { username: u, password: p } }));
const tokenOf = async (u, p) => (await login(u, p)).json?.token;

function lineWebhook(events, secret = ENV.LINE_CHANNEL_SECRET) {
  const raw = JSON.stringify({ events });
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  return req('POST', '/api/line/webhook', { raw, headers: { 'x-line-signature': sig, 'Content-Type': 'application/json' } });
}
const lineText = (text, source) => ({ type: 'message', replyToken: 'rt', source, message: { type: 'text', id: '1', text } });

async function readSse(token, ms, { query = '' } = {}) {
  const ctl = new AbortController();
  const chunks = [];
  const done = (async () => {
    try {
      const r = await fetch(`${BASE}/api/events${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: ctl.signal });
      if (r.status !== 200) { chunks.push(`HTTP ${r.status}`); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) { const { done: d, value } = await reader.read(); if (d) break; chunks.push(dec.decode(value)); }
    } catch { /* abort */ }
  })();
  return { stop: async () => { await sleep(ms); ctl.abort(); await done; return chunks.join(''); } };
}

/* ---------- เตรียมฐานข้อมูล ---------- */
async function resetDb() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const r = spawnSync(process.execPath, [path.join(projectDir, 'server/initdb.js')], { env: { PATH: process.env.PATH, ...ENV }, cwd: '/tmp', encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error('db:init ล้มเหลว'); }
}

async function main() {
  console.log(`โปรเจกต์: ${projectDir}\nฐานข้อมูลทดสอบ: ${dbUrl.replace(/:[^:@]+@/, ':***@')}\n`);
  await resetDb();

  /* ===== H1: ไม่มี secret -> ต้องไม่ยอมเริ่มระบบ และปลอมโทเคนด้วยค่า dev ไม่ได้ ===== */
  {
    const p2 = PORT + 600;
    const weak = startServer({ DATABASE_URL: dbUrl, PORT: String(p2) });
    const up = await waitUp(`http://127.0.0.1:${p2}`, 6000);
    let forged = null;
    if (up) {
      const jwt = require('jsonwebtoken');
      const t = jwt.sign({ u: 'admin' }, 'dev', { expiresIn: '1h' });
      const r = await fetch(`http://127.0.0.1:${p2}/api/users`, { headers: { Authorization: `Bearer ${t}` } });
      forged = r.status;
    }
    weak.child.kill();
    check('H1', 'ไม่ตั้ง JWT_SECRET/ADMIN_PASS แล้วต้องไม่เริ่มระบบ (ห้ามปลอมโทเคน admin ด้วย "dev" ได้)',
      !up && forged === null, up ? `เริ่มระบบได้ และโทเคนปลอมเข้า /api/users ได้ = HTTP ${forged}` : 'เซิร์ฟเวอร์ปฏิเสธการเริ่ม');
  }

  const srv = startServer(ENV);
  if (!(await waitUp(BASE))) { console.error(srv.log()); throw new Error('เซิร์ฟเวอร์ไม่ขึ้น'); }

  const admin = await tokenOf('admin', ENV.ADMIN_PASS);
  check('REG1', 'ล็อกอิน admin ได้ตามปกติ', !!admin);

  const mk = (username, role, permissions, password = 'LongPassw0rd-123') =>
    req('POST', '/api/users', { token: admin, body: { username, password, display_name: username, role, permissions } });
  await mk('staff1', 'staff', []);
  await mk('hk1', 'staff', ['housekeeping']);
  await mk('tech1', 'technician', ['repairs']);
  await mk('insp1', 'inspector', ['repairs']);
  await mk('gone1', 'staff', []);
  const T = {
    staff: await tokenOf('staff1', 'LongPassw0rd-123'),
    hk: await tokenOf('hk1', 'LongPassw0rd-123'),
    tech: await tokenOf('tech1', 'LongPassw0rd-123'),
    insp: await tokenOf('insp1', 'LongPassw0rd-123'),
    gone: await tokenOf('gone1', 'LongPassw0rd-123'),
  };
  check('REG2', 'สร้างผู้ใช้ 5 บทบาท/สิทธิ์ และล็อกอินได้ทุกคน', Object.values(T).every(Boolean));

  // ข้อมูลตั้งต้น
  const repair = (await req('POST', '/api/repairs', { token: admin, body: { title: 'แอร์ห้อง 301', location: 'อาคาร 3', inspector_username: 'insp1' } })).json;
  await req('POST', '/api/canteen', { token: admin, body: { date: TODAY, revenue: 5000, cost: 3200, reporter: 'x' } });
  const nurse = await req('POST', '/api/nurse_visits', { token: admin, body: { date: TODAY, student: 'เด็กชายลับ ทดสอบ', class_room: 'ม.2/3', symptom: 'ปวดท้อง' } });
  await req('POST', '/api/health_checks', { token: admin, body: { date: TODAY, student: 'เด็กหญิงลับ', class_room: 'ม.1/1', weight: 40, height: 150 } });
  const emp = (await req('POST', '/api/employees', { token: admin, body: { full_name: 'พนักงานทดสอบ', employee_code: 'E001', position: 'แม่บ้าน', phone: '0812345678', email: 'e@x.th', notes: 'หมายเหตุลับ', status: 'ACTIVE' } })).json;
  const tiny = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////', 'base64').toString('base64');
  await db.query(`INSERT INTO repair_photos (repair_id, mime, data) VALUES ($1,'image/jpeg',$2)`, [repair.id, Buffer.from(tiny, 'base64')]);
  const photoId = (await db.query('SELECT max(id) AS id FROM repair_photos')).rows[0].id;
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')]).toString('base64');
  const up = await req('PUT', `/api/employees/${emp?.id}/photo`, { token: admin, body: { mime: 'image/jpeg', data: jpg } });
  check('REG3b', 'admin อัปโหลดรูปพนักงานได้', up.status === 200, `HTTP ${up.status}`);
  check('REG3', 'สร้างข้อมูลตั้งต้นสำเร็จ (งานซ่อม, โรงอาหาร, พยาบาล, พนักงาน)', !!repair?.id && nurse.status === 200 && !!emp?.id);

  /* ===== C1: ข้ามสิทธิ์ด้วยตัวพิมพ์ ===== */
  {
    const base = await req('GET', '/api/repairs', { token: T.staff });
    const a = await req('GET', '/api/Repairs', { token: T.staff });
    const b = await req('GET', '/API/health_checks', { token: T.staff });
    const c = await req('GET', '/api/EMPLOYEES', { token: T.staff });
    const d = await req('DELETE', `/api/Repairs/${repair.id}`, { token: T.staff });
    const e = await req('DELETE', '/API/canteen/1', { token: T.staff });
    const stillThere = (await db.query('SELECT count(*)::int n FROM repairs WHERE id=$1', [repair.id])).rows[0].n === 1
      && (await db.query('SELECT count(*)::int n FROM canteen')).rows[0].n === 1;
    check('REG4', 'ผู้ใช้ staff ที่ไม่มีเมนู เรียก /api/repairs ปกติแล้วถูกปฏิเสธ (403)', base.status === 403, `HTTP ${base.status}`);
    const leaked = [a, b, c].filter((x) => x.status === 200).length;
    check('C1a', 'staff อ่านข้อมูลด้วย URL ตัวพิมพ์ต่างจากเดิมไม่ได้ (Repairs / API / EMPLOYEES)', leaked === 0, `อ่านได้ ${leaked}/3`);
    check('C1b', 'staff ลบข้อมูลด้วย URL ตัวพิมพ์ต่างจากเดิมไม่ได้ และข้อมูลต้องยังอยู่', [d, e].every((x) => x.status !== 204) && stillThere, `DELETE ได้ ${[d, e].filter((x) => x.status === 204).length}/2, ข้อมูลยังอยู่=${stillThere}`);
  }

  /* ===== H2: บัญชีที่ปิด/เปลี่ยนรหัสแล้วโทเคนเดิมต้องใช้ไม่ได้ ===== */
  {
    const before = await req('GET', '/api/me', { token: T.gone });
    const uid = (await db.query(`SELECT id FROM users WHERE username='gone1'`)).rows[0].id;
    await req('PUT', `/api/users/${uid}`, { token: admin, body: { active: false } });
    const me = await req('GET', '/api/me', { token: T.gone });
    const st = await req('GET', '/api/stats', { token: T.gone });
    const ev = await readSse(T.gone, 600);
    const evText = await ev.stop();
    check('H2a', 'หลังปิดบัญชี โทเคนเดิมเข้า /api/me, /api/stats และ SSE ไม่ได้', before.status === 200 && me.status === 401 && st.status === 401 && /HTTP 401/.test(evText), `me=${me.status} stats=${st.status} sse=${evText.slice(0, 20).trim() || 'เชื่อมต่อได้'}`);

    const old = T.hk;
    await req('POST', `/api/users/${(await db.query(`SELECT id FROM users WHERE username='hk1'`)).rows[0].id}/password`, { token: admin, body: { password: 'Another-LongPass-456' } });
    const after = await req('GET', '/api/me', { token: old });
    check('H2b', 'หลัง admin รีเซ็ตรหัสผ่าน โทเคนเก่าของผู้ใช้นั้นต้องใช้ไม่ได้', after.status === 401, `HTTP ${after.status}`);
    T.hk = await tokenOf('hk1', 'Another-LongPass-456');
  }

  /* ===== H3: SSE ต้องไม่ส่งข้อมูลอ่อนไหวให้คนไม่มีสิทธิ์ ===== */
  {
    const sStaff = await readSse(T.staff, 2500);
    const sTech = await readSse(T.tech, 2500);
    const sAdmin = await readSse(admin, 2500);
    await sleep(500);
    await req('POST', '/api/nurse_visits', { token: admin, body: { date: TODAY, student: 'นักเรียนSSE-ลับ', class_room: 'ม.3/1', symptom: 'ไข้' } });
    await req('POST', '/api/canteen', { token: admin, body: { date: TODAY, revenue: 98765, cost: 1, reporter: 'SSE-การเงิน' } });
    await req('POST', '/api/repairs', { token: admin, body: { title: 'ซ่อมSSE', location: 'x', reporter: 'ผู้แจ้ง' } });
    const [tStaff, tTech, tAdmin] = await Promise.all([sStaff.stop(), sTech.stop(), sAdmin.stop()]);
    const leakStaff = /นักเรียนSSE|98765|SSE-การเงิน|ซ่อมSSE/.test(tStaff);
    const leakTech = /นักเรียนSSE|98765|SSE-การเงิน/.test(tTech);
    check('H3a', 'ผู้ใช้ staff (ไม่มีเมนู) ไม่ได้รับข้อมูลนักเรียน/การเงิน/งานซ่อมทาง SSE', !leakStaff, leakStaff ? 'พบข้อมูลรั่ว' : '');
    check('H3b', 'ช่าง (มีเมนูงานซ่อมอย่างเดียว) ไม่ได้รับข้อมูลพยาบาล/โรงอาหาร แต่ยังได้รับงานซ่อม', !leakTech && /ซ่อมSSE/.test(tTech), `leak=${leakTech} repairOK=${/ซ่อมSSE/.test(tTech)}`);
    check('REG5', 'admin ยังได้รับการแจ้งเตือนสดครบ (พยาบาล โรงอาหาร งานซ่อม)', /นักเรียนSSE/.test(tAdmin) && /SSE-การเงิน/.test(tAdmin) && /ซ่อมSSE/.test(tAdmin));
  }

  /* ===== H4: LINE ต้องรับคำสั่งเฉพาะจากกลุ่ม/ผู้ใช้ที่ได้รับอนุญาต ===== */
  {
    const n0 = (await db.query('SELECT count(*)::int n FROM canteen')).rows[0].n;
    const h0 = (await db.query('SELECT count(*)::int n FROM health_checks')).rows[0].n;
    const r0 = (await db.query('SELECT count(*)::int n FROM repairs')).rows[0].n;
    await lineWebhook([
      lineText('#โรงอาหาร 111 22 ปลอม', { type: 'group', groupId: 'Cattacker_group', userId: 'Uattacker' }),
      lineText('#ตรวจสุขภาพ เด็กปลอม @ม.1/1 40 150', { type: 'group', groupId: 'Cattacker_group', userId: 'Uattacker' }),
      lineText('#ซ่อม เรื่องปลอม @ที่ไหนก็ได้', { type: 'user', userId: 'Ustranger' }),
    ]);
    await sleep(2500);
    const n1 = (await db.query('SELECT count(*)::int n FROM canteen')).rows[0].n;
    const h1 = (await db.query('SELECT count(*)::int n FROM health_checks')).rows[0].n;
    const r1 = (await db.query('SELECT count(*)::int n FROM repairs')).rows[0].n;
    check('H4a', 'คำสั่ง LINE จากกลุ่ม/คนแปลกหน้าที่ไม่ได้รับอนุญาตต้องไม่สร้างข้อมูล', n1 === n0 && h1 === h0 && r1 === r0, `เพิ่ม โรงอาหาร+${n1 - n0} สุขภาพ+${h1 - h0} ซ่อม+${r1 - r0}`);
    await lineWebhook([lineText('#โรงอาหาร 700 300 ถูกต้อง', { type: 'group', groupId: GROUP_OK, userId: 'Uok' })]);
    await sleep(2500);
    const n2 = (await db.query('SELECT count(*)::int n FROM canteen')).rows[0].n;
    check('REG6', 'คำสั่ง LINE จากกลุ่มที่อนุญาต (LINE_TARGET_ID) ยังทำงานตามปกติ', n2 === n1 + 1, `+${n2 - n1}`);
    const bad = await lineWebhook([lineText('#โรงอาหาร 1 1', { type: 'group', groupId: GROUP_OK, userId: 'U' })], 'wrong-secret');
    check('REG7', 'Webhook ที่ลายเซ็นผิดถูกปฏิเสธ (401)', bad.status === 401, `HTTP ${bad.status}`);
  }

  /* ===== H5: โทเคนใน URL / headers / CORS ===== */
  {
    const viaQuery = await req('GET', `/api/me?token=${T.tech}`);
    const viaHeader = await req('GET', '/api/me', { token: T.tech });
    check('H5a', 'โทเคนเข้าสู่ระบบผ่าน ?token= ใน URL ต้องใช้ไม่ได้', viaQuery.status === 401 && viaHeader.status === 200, `query=${viaQuery.status} header=${viaHeader.status}`);
    const hdr = await req('GET', '/api/line/webhook', { headers: { Origin: 'https://evil.example' } });
    const h = hdr.headers;
    check('H5b', 'ไม่เปิด CORS ให้ทุกเว็บ (ไม่มี Access-Control-Allow-Origin: *)', h.get('access-control-allow-origin') !== '*', `ACAO=${h.get('access-control-allow-origin')}`);
    check('H5c', 'มี security headers (CSP, X-Content-Type-Options, frame-ancestors)', !!h.get('content-security-policy') && !!h.get('x-content-type-options') && /frame-ancestors/.test(h.get('content-security-policy') || ''), `CSP=${h.get('content-security-policy') ? 'มี' : 'ไม่มี'}`);
  }
  /* ===== M1: รูป/ไฟล์ ต้องตรวจสิทธิ์ ===== */
  {
    const asStaff = await req('GET', `/api/photos/${photoId}`, { token: T.staff });
    const asTech = await req('GET', `/api/photos/${photoId}`, { token: T.tech });
    const empPhoto = await req('GET', `/api/employees/${emp.id}/photo`, { token: T.staff });
    check('M1a', 'staff ที่ไม่มีเมนูงานซ่อมดูรูปงานซ่อม (/api/photos/:id) ไม่ได้', asStaff.status === 403 || asStaff.status === 401, `HTTP ${asStaff.status}`);
    check('REG8', 'ช่างที่มีเมนูงานซ่อมดูรูปงานซ่อมได้ตามปกติ', asTech.status === 200, `HTTP ${asTech.status}`);
    const empPhotoAdmin = await req('GET', `/api/employees/${emp.id}/photo`, { token: admin });
    check('M1b', 'staff ที่ไม่มีเมนูบริหารทั่วไปเปิดรูปพนักงานไม่ได้ (admin ต้องเปิดได้)', empPhoto.status !== 200 && empPhotoAdmin.status === 200, `staff=${empPhoto.status} admin=${empPhotoAdmin.status}`);
    const list = await req('GET', '/api/repairs', { token: T.tech });
    const url = list.json?.[0]?.done_photos?.[0];
    if (url) {
      const viaPt = await fetch(BASE + url);
      check('REG9', 'ภาพที่ลิงก์มากับ photo token (?pt=) ยังเปิดได้โดยไม่ต้องส่ง header', viaPt.status === 200, `HTTP ${viaPt.status}`);
    }
  }

  /* ===== M2: สถิติแยกตามสิทธิ์ ===== */
  {
    const s = await req('GET', '/api/stats', { token: T.staff });
    const sa = await req('GET', '/api/stats', { token: admin });
    const k = await req('GET', '/api/kpi', { token: T.staff });
    const leaks = Number(s.json?.profit_month) !== 0 || Number(s.json?.nurse_today) !== 0 || (k.json?.canteen_monthly || []).some((m) => m.revenue > 0);
    check('M2', 'staff ที่ไม่มีเมนูไม่เห็นกำไรโรงอาหาร/จำนวนผู้ป่วยในสถิติ (/stats, /kpi)', s.status === 200 && !leaks, leaks ? 'ยังเห็นตัวเลขจริง' : '');
    check('REG10', 'admin เห็นสถิติจริงครบ', Number(sa.json?.profit_month) > 0 && Number(sa.json?.nurse_today) > 0, `profit=${sa.json?.profit_month} nurse=${sa.json?.nurse_today}`);
  }

  /* ===== M3: พนักงานแม่บ้านไม่ควรเห็นเบอร์/อีเมล/หมายเหตุ ===== */
  {
    const r = await req('GET', '/api/employees', { token: T.hk });
    const row = (r.json || []).find((x) => x.id === emp.id);
    const leak = !!row && (row.phone || row.email || row.notes);
    const adminRow = ((await req('GET', '/api/employees', { token: admin })).json || []).find((x) => x.id === emp.id);
    check('M3', 'ผู้ใช้เมนูแม่บ้านอ่านรายชื่อพนักงานได้ แต่ไม่เห็นเบอร์โทร/อีเมล/หมายเหตุ', r.status === 200 && !!row && !leak, `status=${r.status} leak=${!!leak}`);
    check('REG11', 'admin ยังเห็นเบอร์โทร/อีเมลของพนักงานครบ', !!adminRow?.phone && !!adminRow?.email);
  }

  /* ===== M4: ล็อกอินผิดของคนหนึ่งต้องไม่ล็อกคนอื่น (เมื่ออยู่หลัง proxy IP เดียวกัน) ===== */
  {
    for (let i = 0; i < 12; i += 1) await login('victim_user', `wrong-${i}`);
    const legit = await login('tech1', 'LongPassw0rd-123');
    const sameUserLocked = await login('victim_user', 'wrong-again');
    check('M4a', 'คนร้ายพิมพ์รหัสผิดรัว ๆ ต้องไม่ทำให้ผู้ใช้อื่นจาก IP เดียวกันล็อกอินไม่ได้', legit.status === 200, `ผู้ใช้อื่น HTTP ${legit.status}`);
    check('M4b', 'บัญชีที่ถูกเดารหัสถูกจำกัดอัตรา (429)', sameUserLocked.status === 429, `HTTP ${sameUserLocked.status}`);
  }

  /* ===== M5: อัปโหลดไฟล์ ===== */
  {
    const send = async (name, content, type = 'application/pdf') => {
      const fd = new FormData();
      fd.append('subject', 'ทดสอบ'); fd.append('category', 'x'); fd.append('message', 'x');
      fd.append('files', new Blob([content], { type }), name);
      const r = await fetch(`${BASE}/api/admin/submissions`, { method: 'POST', headers: { Authorization: `Bearer ${T.staff}` }, body: fd });
      return r.status;
    };
    const fake = await send('invoice.pdf', '<html><script>alert(1)</script></html>', 'text/html');
    const exe = await send('report.xlsx', 'MZ\x90\x00 โปรแกรมอันตราย', 'application/octet-stream');
    const real = await send('ok.pdf', '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    check('M5a', 'ไฟล์ที่นามสกุลไม่ตรงกับเนื้อหาจริง (.pdf/.xlsx ปลอม) ถูกปฏิเสธ', fake === 400 && exe === 400, `pdfปลอม=${fake} xlsxปลอม=${exe}`);
    check('REG12', 'ไฟล์ PDF จริงยังอัปโหลดได้', real === 201, `HTTP ${real}`);
    await send('mimeTest.pdf', '%PDF-1.4\n%%EOF', 'text/html');
    const dl = await db.query(`SELECT mime FROM admin_submission_files WHERE filename='mimeTest.pdf' LIMIT 1`);
    const codes = [];
    for (let i = 0; i < 40; i += 1) codes.push(await send('ok.pdf', '%PDF-1.4\n%%EOF'));
    check('M5b', 'จำกัดอัตราการอัปโหลดต่อผู้ใช้ (ต้องเจอ 429 เมื่อส่งรัว ๆ)', codes.includes(429), `429 ${codes.filter((c) => c === 429).length}/40`);
    check('M5c', 'ชนิดไฟล์ (mime) ที่เก็บมาจากนามสกุลที่ตรวจแล้ว ไม่เชื่อค่าที่ผู้ใช้ส่งมา', dl.rows[0]?.mime === 'application/pdf', dl.rows[0]?.mime);
  }

  /* ===== L: ข้อสังเกตระดับต่ำ ===== */
  {
    const bad = await req('POST', '/api/delete-requests', { token: admin, body: { table: 'constructor', record_id: 1, reason: 'x' } });
    check('L1', 'ตารางชื่อแปลก (constructor) ในคำขอลบต้องตอบ 400 ไม่ใช่ 500', bad.status === 400, `HTTP ${bad.status}`);

    const short = await mk('short6', 'staff', [], 'abc123');
    check('L4', 'รหัสผ่านสั้นเกินไป (6 ตัว) ต้องถูกปฏิเสธ', short.status === 400, `HTTP ${short.status}`);

    const t = await req('POST', '/api/housekeeping_tasks', { token: admin, body: { employee_id: emp.id, task: 'กวาดพื้น', repeat_days: [1, 2, 3, 4, 5, 6, 7], max_score: 10, date: '2026-10-01' } });
    const ins = await req('POST', `/api/housekeeping_tasks/${t.json?.id}/inspect`, { token: admin, body: { checked: true, date: '2026-10-21', score: 8, checked_by: 'ผู้บริหารปลอม' } });
    check('L2', 'ชื่อผู้ตรวจในผลตรวจต้องมาจากโทเคน ไม่เชื่อค่าที่หน้าเว็บส่งมา', ins.status === 200 && ins.json?.checked_by === 'admin', `checked_by=${ins.json?.checked_by}`);
  }

  /* ===== ถดถอย: สิทธิ์ตามบทบาทยังทำงาน ===== */
  {
    const tc = await req('POST', '/api/repairs', { token: T.tech, body: { title: 'ช่างเพิ่ม', location: 'ห้อง 1' } });
    const td = await req('DELETE', `/api/repairs/${tc.json?.id}`, { token: T.tech });
    const sw = await req('POST', '/api/repairs', { token: T.staff, body: { title: 'ไม่ควรได้' } });
    const ins = await req('GET', '/api/repairs', { token: T.insp });
    const only = (ins.json || []).every((r) => r.inspector_username === 'insp1');
    check('REG13', 'ช่างเพิ่มงานซ่อมได้, ลบเองไม่ได้ (NEEDS_DELETE_REQUEST), staff เขียนไม่ได้', tc.status === 200 && td.status === 403 && td.json?.code === 'NEEDS_DELETE_REQUEST' && sw.status === 403, `ช่างเพิ่ม=${tc.status} ช่างลบ=${td.status} staffเขียน=${sw.status}`);
    check('REG14', 'ผู้ตรวจเห็นเฉพาะงานที่ตนเป็นผู้ตรวจ', ins.status === 200 && only && ins.json.length >= 1, `จำนวน=${ins.json?.length}`);
    const del = await req('POST', '/api/delete-requests', { token: T.tech, body: { table: 'repairs', record_id: tc.json?.id, reason: 'ซ้ำ' } });
    const dec = await req('POST', `/api/delete-requests/${del.json?.id}/decision`, { token: admin, body: { action: 'approve' } });
    check('REG15', 'ช่างส่งคำขอลบ -> admin อนุมัติ -> ข้อมูลถูกลบจริง', del.status === 200 && dec.status === 200 && (await db.query('SELECT 1 FROM repairs WHERE id=$1', [tc.json.id])).rowCount === 0, `ขอ=${del.status} อนุมัติ=${dec.status}`);
    const apr = await req('POST', `/api/repairs/${repair.id}/approval`, { token: T.insp, body: { action: 'approve' } });
    check('REG16', 'อนุมัติปิดงานที่ยังไม่ส่งงานต้องถูกปฏิเสธตามกติกา (409)', apr.status === 409, `HTTP ${apr.status}`);
    const myPw = await req('POST', '/api/me/password', { token: T.tech, body: { current: 'LongPassw0rd-123', next: 'Brand-New-Passw0rd' } });
    const relog = await login('tech1', 'Brand-New-Passw0rd');
    check('REG17', 'ผู้ใช้เปลี่ยนรหัสผ่านตัวเองได้ และล็อกอินด้วยรหัสใหม่ได้', myPw.status === 200 && relog.status === 200, `เปลี่ยน=${myPw.status} ล็อกอิน=${relog.status}`);
  }

  srv.child.kill();
  await sleep(300);
  await db.end();

  const fails = results.filter((r) => !r.pass);
  console.log(`\nสรุป: ผ่าน ${results.length - fails.length}/${results.length}  ไม่ผ่าน ${fails.length}`);
  if (fails.length) console.log('ไม่ผ่าน:', fails.map((f) => f.id).join(', '));
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('ผิดพลาด:', e); process.exit(2); });
