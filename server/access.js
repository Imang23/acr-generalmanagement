// บทบาท/สิทธิ์ + คำขอลบ + แจ้งผู้ตรวจ
//   admin      เข้าได้ทุกเมนู ทำทุกอย่างได้
//   inspector  เข้าเฉพาะเมนูที่กำหนด (permissions) ทำได้ทุกอย่างในเมนูนั้น รวมลบและอนุมัติ
//   technician เข้าเฉพาะเมนูที่กำหนด ดู/เพิ่ม/แก้ไขได้ ลบต้องส่งคำขอให้ผู้ตรวจอนุมัติ
//   staff      เข้าเฉพาะเมนูที่กำหนด ดูได้อย่างเดียว
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const MODULES = [
  { value: 'repairs', label: 'งานซ่อม' },
  { value: 'canteen', label: 'โรงอาหาร' },
  { value: 'vehicles', label: 'ยานพาหนะ' },
  { value: 'workers', label: 'คนงาน' },
  { value: 'nurse', label: 'สุขอนามัยและพยาบาล' },
  { value: 'buildings', label: 'อาคาร' },
  { value: 'store', label: 'สโตร์/พัสดุ' },
  { value: 'general', label: 'บริหารทั่วไป (กรรมการ/พนักงาน)' },
  { value: 'housekeeping', label: 'งานแม่บ้าน' },
  { value: 'gardening', label: 'งานสวน' },
  { value: 'administration', label: 'ธุรการ' },
];
const MODULE_KEYS = MODULES.map((m) => m.value);
const ROLES = ['admin', 'inspector', 'technician', 'staff'];

// segment แรกหลัง /api -> เมนู
const SEG_MODULE = {
  repairs: 'repairs',
  canteen: 'canteen',
  vehicles: 'vehicles',
  workers: 'workers',
  nurse_visits: 'nurse',
  health_checks: 'nurse',
  buildings: 'buildings',
  store_items: 'store',
  committees: 'general',
  employees: 'general',
  housekeeping_tasks: 'housekeeping',
  gardening_tasks: 'gardening',
};

// ข้อมูลอ้างอิงที่ทุกคนที่ล็อกอินอ่านได้ (เช่น รายชื่ออาคารในฟอร์มแจ้งซ่อม) แก้ได้ตามต้องการ
const READ_OPEN = new Set(['buildings']);

// เมนูที่อ่านข้อมูลของเมนูอื่นได้ (เช่น หน้างานแม่บ้าน/คนสวนต้องดึงรายชื่อพนักงานและกรรมการมาเลือก)
const READ_VIA = {
  general: ['housekeeping', 'gardening',],
};

// ตารางที่ขอลบได้ -> เมนู + คอลัมน์ที่ใช้เป็นชื่อรายการ
const DELETE_TABLES = {
  repairs: { module: 'repairs', label: 'title' },
  canteen: { module: 'canteen', label: 'date' },
  vehicles: { module: 'vehicles', label: 'plate' },
  workers: { module: 'workers', label: 'name' },
  nurse_visits: { module: 'nurse', label: 'student' },
  health_checks: { module: 'nurse', label: 'student' },
  buildings: { module: 'buildings', label: 'name' },
  store_items: { module: 'store', label: 'name' },
  committees: { module: 'general', label: 'full_name' },
  employees: { module: 'general', label: 'full_name' },
  housekeeping_tasks: { module: 'housekeeping', label: 'task' },
  gardening_tasks: { module: 'gardening', label: 'task' },
};

// ตารางที่ "ผู้ตรวจ" เห็น/ตรวจได้เฉพาะแถวที่ได้รับมอบหมาย (คอลัมน์ inspector_username)
// admin เห็นทั้งหมด งานที่ยังไม่ระบุผู้ตรวจ เห็นเฉพาะ admin
const SCOPED_TABLES = new Set(['repairs', 'housekeeping_tasks', 'gardening_tasks']);
const SCOPED_MODULES = ['repairs', 'housekeeping', 'gardening'];

// ชื่อผู้ใช้ที่ต้องกรองแถว (null = เห็นทั้งหมด)
const scopeOf = (acc) => (acc && !acc.isAdmin && acc.role === 'inspector' ? acc.username : null);

const METHOD_ACTION = {
  GET: 'read', HEAD: 'read', OPTIONS: 'read',
  POST: 'write', PUT: 'write', PATCH: 'write',
  DELETE: 'delete',
};

// action: read | write | delete | approve
export function can(acc, module, action) {
  if (!acc || !acc.active) return false;
  if (acc.isAdmin) return true;
  if (!acc.perms.includes(module)) return false;
  switch (acc.role) {
    case 'inspector': return true;
    case 'technician': return action === 'read' || action === 'write';
    default: return action === 'read';
  }
}

// งานประจำ (แม่บ้าน/คนสวน): ถ้าเคยมีวันที่ต้องทำหรือเคยตรวจแล้ว ให้ยุติตั้งแต่วันนี้ เก็บ KPI ย้อนหลัง
// (ตรรกะเดียวกับ DELETE ใน dailyTasks.js) ตารางอื่นลบจริง
const SCHEDULE_MODULE = { housekeeping_tasks: 'housekeeping', gardening_tasks: 'gardening' };

async function deleteOrArchive(client, table, id) {
  const module = SCHEDULE_MODULE[table];
  if (!module) {
    await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return;
  }
  const { rows: [t] } = await client.query(
    `SELECT (t.date >= d.today) AS upcoming,
            EXISTS (SELECT 1 FROM daily_task_logs l
                    WHERE l.module = $2 AND l.task_id = t.id) AS has_logs
     FROM ${table} t,
          (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS today) d
     WHERE t.id = $1`,
    [id, module],
  );
  if (!t) return;
  if (t.upcoming && !t.has_logs) {
    await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return;
  }
  await client.query(
    `UPDATE ${table} t
     SET end_date = LEAST(
           COALESCE(t.end_date, GREATEST(t.date, d.today - 1)),
           GREATEST(t.date, d.today - 1)),
         updated_at = now()
     FROM (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS today) d
     WHERE t.id = $1`,
    [id],
  );
}

const jwtSecret = () => process.env.JWT_SECRET || 'dev';

function bearerOf(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ไม่มี 0 O 1 I
function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

export function registerAccess(app, { pool, broadcast, hashPassword, adminUser, notify }) {
  /* ---------- โหลดสิทธิ์ของผู้ใช้ (ทุกคำขอ แก้สิทธิ์แล้วมีผลทันที) ---------- */
  async function getAccess(username) {
    if (!username) return null;
    const isEnvAdmin = username === adminUser; // admin จาก .env เป็น admin เสมอ
    let u = null;
    try {
      u = (await pool.query(
        'SELECT username, display_name, role, permissions, active FROM users WHERE username = $1',
        [username],
      )).rows[0];
    } catch (err) {
      if (!isEnvAdmin) return null; // ยังไม่ได้รัน schema-roles.sql
    }
    if (isEnvAdmin) {
      return { username, display_name: u?.display_name || '', role: 'admin', isAdmin: true, perms: MODULE_KEYS, active: true };
    }
    if (!u) return null;
    return {
      username,
      display_name: u.display_name || '',
      role: ROLES.includes(u.role) ? u.role : 'staff',
      isAdmin: u.role === 'admin',
      perms: (u.permissions || []).filter((p) => MODULE_KEYS.includes(p)),
      active: u.active !== false,
    };
  }

  // ให้ admin จาก .env มี role='admin' ในตารางด้วย (เพื่อให้รับแจ้งเตือนผ่าน LINE ได้)
  pool.query("UPDATE users SET role = 'admin' WHERE username = $1 AND role <> 'admin'", [adminUser])
    .catch(() => {});

  async function userFromRequest(req) {
    try {
      const token = bearerOf(req);
      if (!token) return null;
      const username = jwt.verify(String(token), jwtSecret()).u;
      const acc = await getAccess(username);
      return acc && acc.active ? acc : null;
    } catch {
      return null;
    }
  }

  const needUser = async (req, res, next) => {
    const acc = await userFromRequest(req);
    if (!acc) return res.sendStatus(401);
    req.username = acc.username;
    req.access = acc;
    next();
  };

  const needAdmin = (req, res, next) =>
    (req.access?.isAdmin
      ? next()
      : res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }));

  // ผู้ที่ถูกมอบหมายเป็นผู้ตรวจต้องเป็น admin หรือผู้ตรวจที่มีเมนูนั้น
  async function validInspector(username, module) {
    if (username === adminUser) return true;
    const { rows } = await pool.query(
      `SELECT 1 FROM users
       WHERE username = $1 AND active
         AND (role = 'admin' OR (role = 'inspector' AND $2 = ANY(permissions)))`,
      [username, module],
    );
    return rows.length > 0;
  }

  // สิทธิ์รายแถวสำหรับตาราง SCOPED_TABLES (ผู้ตรวจเห็น/แก้/ตรวจ เฉพาะงานของตัวเอง)
  async function scopeRows(req, res, next, acc, module, action) {
    const seg = req.path.split('/')[2];
    if (!SCOPED_TABLES.has(seg)) return next();

    const scope = scopeOf(acc);
    req.rowScope = scope; // ให้ route ฝั่งข้อมูลใช้กรองรายการ/KPI

    const parts = req.path.split('/'); // ['', 'api', table, id?, sub?]
    const hasId = /^\d+$/.test(parts[3] || '');

    // แก้/ลบ/ตรวจ งานของคนอื่นไม่ได้
    if (scope && hasId && action !== 'read') {
      const { rows } = await pool.query(
        `SELECT inspector_username FROM ${seg} WHERE id = $1`,
        [Number(parts[3])],
      );
      if (rows[0] && rows[0].inspector_username !== scope) {
        return res.status(403).json({ error: 'งานนี้ไม่ได้มอบหมายให้คุณเป็นผู้ตรวจ' });
      }
    }

    // ผู้ตรวจที่ระบุในข้อมูลงาน (สร้าง/แก้ไขเท่านั้น ไม่รวม /inspect /approval)
    const isCreate = req.method === 'POST' && !parts[3];
    const isUpdate = req.method === 'PUT' && hasId && !parts[4];
    if ((isCreate || isUpdate) && req.body && typeof req.body === 'object') {
      if (isCreate && scope) req.body.inspector_username = scope; // ผู้ตรวจสร้างงานเอง -> ผูกกับตัวเอง
      if (isUpdate && !acc.isAdmin) { // เปลี่ยนผู้ตรวจได้เฉพาะ admin
        delete req.body.inspector_username;
        delete req.body.inspector;
      }
      const who = req.body.inspector_username;
      if (who !== undefined && who !== null && who !== '') {
        if (!(await validInspector(String(who), module))) {
          return res.status(400).json({ error: 'ผู้ตรวจที่เลือกไม่ถูกต้อง หรือไม่มีสิทธิ์ในเมนูนี้' });
        }
      }
    }
    return next();
  }

  /* ---------- ตัวคุมสิทธิ์กลาง: ทุก /api/<ตาราง> ที่อยู่ใน SEG_MODULE ---------- */
  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const module = SEG_MODULE[req.path.split('/')[2]];
    if (!module) return next();

    // รูป (<img src>) ใช้ token ของรูปเอง ไม่ผ่าน Bearer
    if (req.method === 'GET' && /\/(photo|image)$/.test(req.path)) return next();

    const acc = await userFromRequest(req);
    if (!acc) return res.sendStatus(401);
    req.username = acc.username;
    req.access = acc;

    const action = /\/(inspect|verify)$/.test(req.path) ? 'approve' : (METHOD_ACTION[req.method] || 'write');
    if (action === 'read' && READ_OPEN.has(module)) return next();
    if (action === 'read' && (READ_VIA[module] || []).some((m) => can(acc, m, 'read'))) return next();
    if (can(acc, module, action)) return scopeRows(req, res, next, acc, module, action);

    if (action === 'delete' && acc.role === 'technician' && acc.perms.includes(module)) {
      return res.status(403).json({
        code: 'NEEDS_DELETE_REQUEST',
        error: 'ช่างลบข้อมูลเองไม่ได้ กรุณาส่งคำขอลบให้ผู้ตรวจอนุมัติ',
      });
    }
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
  });

  /* ---------- LINE ---------- */
  async function linePush(to, text) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token || !to) return false;
    try {
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
      });
      if (!r.ok) console.error('[access push]', r.status, await r.text());
      return r.ok;
    } catch (err) {
      console.error('[access push]', err?.message || err);
      return false;
    }
  }

  // แจ้งผู้ตรวจของเมนูนั้น + admin ถ้าไม่มีใครผูก LINE ไว้เลย ส่งเข้ากลุ่มเดิมแทน
  // inspectorUsername: เมนูที่แยกตามผู้ตรวจ (งานซ่อม/แม่บ้าน/สวน) แจ้งเฉพาะผู้ตรวจของงานนั้น + admin
  async function notifyReviewers(module, title, lines = [], inspectorUsername = null) {
    try {
      const scoped = SCOPED_MODULES.includes(module);
      const { rows } = await pool.query(
        `SELECT line_user_id FROM users
         WHERE active AND line_user_id IS NOT NULL
           AND (role = 'admin' OR username = $2
                OR (NOT $4::boolean AND role = 'inspector' AND $1 = ANY(permissions))
                OR ($4::boolean AND role = 'inspector' AND username = $3))`,
        [module, adminUser, inspectorUsername, scoped],
      );
      const text = [title, ...lines.filter(Boolean)].join('\n');
      let ok = false;
      for (const r of rows) ok = (await linePush(r.line_user_id, text)) || ok;
      if (ok) return true;
    } catch (err) {
      console.error('[notifyReviewers]', err?.message || err);
    }
    return notify ? notify(title, lines) : false;
  }

  async function linkLine(code, lineUserId) {
    const { rows: [t] } = await pool.query(
      'SELECT username FROM users WHERE line_link_code = $1 AND line_link_exp > now()',
      [code],
    );
    if (!t) return null;
    await pool.query('UPDATE users SET line_user_id = NULL WHERE line_user_id = $1', [lineUserId]);
    await pool.query(
      `UPDATE users
       SET line_user_id = $2, line_link_code = NULL, line_link_exp = NULL, updated_at = now()
       WHERE username = $1`,
      [t.username, lineUserId],
    );
    return t.username;
  }

  /* ---------- สิทธิ์ของฉัน + ตัวเลขรอตรวจ (ใช้ทำป้ายบนเมนู) ---------- */
  app.get('/api/access/me', needUser, async (req, res) => {
    const acc = req.access;
    const reviewModules = acc.isAdmin ? MODULE_KEYS : acc.role === 'inspector' ? acc.perms : [];

    const { rows: [d] } = await pool.query(
      `SELECT count(*)::int AS n FROM delete_requests
       WHERE status = 'pending'
         AND (CASE WHEN $1::boolean THEN true
                   ELSE module = ANY($2::text[])
                        AND (table_name <> ALL($3::text[]) OR scoped_inspector = $4) END)`,
      [acc.isAdmin, reviewModules, [...SCOPED_TABLES], acc.username],
    );
    const { rows: [mine] } = await pool.query(
      `SELECT count(*)::int AS n FROM delete_requests WHERE status = 'pending' AND requested_by = $1`,
      [acc.username],
    );
    let repairsSubmitted = 0;
    if (can(acc, 'repairs', 'approve')) {
      repairsSubmitted = (await pool.query(
        `SELECT count(*)::int AS n FROM repairs
         WHERE approval_status = 'submitted'
           AND ($1::text IS NULL OR inspector_username = $1)`,
        [scopeOf(acc)],
      )).rows[0].n;
    }

    res.json({
      username: acc.username,
      display_name: acc.display_name,
      role: acc.role,
      is_admin: acc.isAdmin,
      permissions: acc.perms,
      modules: MODULES,
      pending: {
        delete_requests: reviewModules.length ? d.n : 0,
        my_delete_requests: mine.n,
        repairs_submitted: repairsSubmitted,
      },
    });
  });

  // ตรวจสอบรายการโรงอาหาร (ผู้ตรวจ/admin) verified=false = ยกเลิกการตรวจสอบ
  app.post('/api/canteen/:id/verify', needUser, async (req, res) => {
    if (!can(req.access, 'canteen', 'approve')) {
      return res.status(403).json({ error: 'เฉพาะผู้ตรวจงานหรือผู้ดูแลระบบเท่านั้นที่ตรวจสอบรายการได้' });
    }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'รหัสรายการไม่ถูกต้อง' });
    const verified = req.body?.verified !== false;

    const { rows: [row] } = await pool.query(
      `UPDATE canteen
       SET verified = $2,
           verified_by = CASE WHEN $2 THEN $3 ELSE NULL END,
           verified_at = CASE WHEN $2 THEN now() ELSE NULL END
       WHERE id = $1
       RETURNING *`,
      [id, verified, req.access.display_name || req.username],
    );
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });

    res.json(row);
    broadcast('refresh', { table: 'canteen' });
  });

  /* ---------- งานของผู้ตรวจ: งานที่ยังไม่เสร็จและอยู่ในแผน ---------- */
  // admin เห็นของผู้ตรวจทุกคน (+ งานที่ยังไม่มอบหมาย) ผู้ตรวจเห็นเฉพาะของตัวเอง
  app.get('/api/inspector-work', needUser, async (req, res) => {
    const acc = req.access;
    if (!acc.isAdmin && acc.role !== 'inspector') {
      return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบหรือผู้ตรวจงานเท่านั้น' });
    }
    const self = scopeOf(acc); // null = admin

    const { rows: [{ today }] } = await pool.query(
      "SELECT to_char((now() AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS today",
    );

    // รายชื่อผู้ตรวจ
    let inspectors;
    if (self) {
      inspectors = [{ username: acc.username, display_name: acc.display_name, perms: acc.perms }];
    } else {
      inspectors = (await pool.query(
        `SELECT username, display_name, permissions AS perms FROM users
         WHERE active AND role = 'inspector'
         ORDER BY COALESCE(NULLIF(display_name, ''), username)`,
      )).rows;
    }

    const byUser = new Map(inspectors.map((u) => [u.username, {
      username: u.username,
      display_name: u.display_name || u.username,
      repairs: null, housekeeping: null, gardening: null,
      delete_requests: 0, open_total: 0,
    }]));
    const unassigned = self ? null : {
      repairs: { open: 0, items: [] },
      housekeeping: { today_pending: 0, missed_count: 0, upcoming_count: 0 },
      gardening: { today_pending: 0, missed_count: 0, upcoming_count: 0 },
      delete_requests: 0,
    };
    const has = (u, module) => (u.perms || []).includes(module);
    const ITEM_CAP = 30;

    /* งานซ่อมที่ยังไม่ปิด */
    const { rows: repairRows } = await pool.query(
      `SELECT id, title, location, status, approval_status, assignee, inspector_username,
              due_date, created_at, rejection_reason,
              (due_date IS NOT NULL AND due_date < now()) AS overdue
       FROM repairs
       WHERE NOT (status = 'done' AND approval_status = 'approved')
         AND ($1::text IS NULL OR inspector_username = $1)
       ORDER BY due_date NULLS LAST, id
       LIMIT 1000`,
      [self],
    );
    const blankRepairs = () => ({
      open: 0, waiting_approval: 0, in_progress: 0, rejected: 0, overdue: 0, items: [],
    });
    for (const u of byUser.values()) {
      if (has({ perms: inspectors.find((i) => i.username === u.username).perms }, 'repairs')) {
        u.repairs = blankRepairs();
      }
    }
    for (const r of repairRows) {
      const target = byUser.get(r.inspector_username);
      if (!target) {
        if (unassigned && !r.inspector_username) {
          unassigned.repairs.open += 1;
          if (unassigned.repairs.items.length < ITEM_CAP) unassigned.repairs.items.push(r);
        }
        continue;
      }
      if (!target.repairs) continue;
      const g = target.repairs;
      g.open += 1;
      if (r.approval_status === 'submitted') g.waiting_approval += 1;
      else if (r.approval_status === 'rejected') g.rejected += 1;
      else g.in_progress += 1;
      if (r.overdue) g.overdue += 1;
      if (g.items.length < ITEM_CAP) g.items.push(r);
    }

    /* งานประจำแม่บ้าน/คนสวน: วันนี้ที่ยังไม่ตรวจ + ค้างย้อนหลัง 7 วัน + แผน 7 วันข้างหน้า */
    for (const [table, module] of [['housekeeping_tasks', 'housekeeping'], ['gardening_tasks', 'gardening']]) {
      const { rows } = await pool.query(
        `WITH days AS (
           SELECT d::date AS work_date
           FROM generate_series($1::date - 7, $1::date + 7, interval '1 day') AS d
         )
         SELECT t.id AS task_id, t.inspector_username, t.cleaner, t.task, t.building, t.location,
                left(t.start_time::text, 5) AS start_time, left(t.end_time::text, 5) AS end_time,
                to_char(dd.work_date, 'YYYY-MM-DD') AS date,
                EXISTS (SELECT 1 FROM daily_task_logs l
                        WHERE l.module = $2 AND l.task_id = t.id AND l.work_date = dd.work_date) AS checked
         FROM ${table} t
         JOIN days dd
           ON dd.work_date >= t.date
          AND (t.end_date IS NULL OR dd.work_date <= t.end_date)
          AND EXTRACT(ISODOW FROM dd.work_date)::int = ANY (t.repeat_days)
         WHERE ($3::text IS NULL OR t.inspector_username = $3)
         ORDER BY dd.work_date, NULLIF(t.start_time::text, '') NULLS LAST, t.id`,
        [today, module, self],
      );

      const blank = () => ({
        today_total: 0, today_done: 0, today_pending: 0, today_items: [],
        missed_count: 0, missed_items: [], upcoming_count: 0, upcoming_by_date: [],
      });
      for (const u of byUser.values()) {
        if (has({ perms: inspectors.find((i) => i.username === u.username).perms }, module)) {
          u[module] = blank();
        }
      }

      for (const r of rows) {
        const g = byUser.get(r.inspector_username)?.[module];
        const un = !r.inspector_username && unassigned ? unassigned[module] : null;
        if (!g && !un) continue;
        if (r.date === today) {
          if (g) {
            g.today_total += 1;
            if (r.checked) g.today_done += 1;
            else {
              g.today_pending += 1;
              if (g.today_items.length < ITEM_CAP) g.today_items.push(r);
            }
          } else if (!r.checked) un.today_pending += 1;
        } else if (r.date < today) {
          if (r.checked) continue;
          if (g) {
            g.missed_count += 1;
            if (g.missed_items.length < ITEM_CAP) g.missed_items.push(r);
          } else un.missed_count += 1;
        } else if (g) {
          g.upcoming_count += 1;
          const last = g.upcoming_by_date[g.upcoming_by_date.length - 1];
          if (last && last.date === r.date) last.count += 1;
          else g.upcoming_by_date.push({ date: r.date, count: 1 });
        } else un.upcoming_count += 1;
      }
    }

    /* คำขอลบที่รอพิจารณา */
    const { rows: drs } = await pool.query(
      "SELECT table_name, module, scoped_inspector FROM delete_requests WHERE status = 'pending'",
    );
    for (const d of drs) {
      const scoped = SCOPED_TABLES.has(d.table_name);
      if (scoped) {
        const u = byUser.get(d.scoped_inspector);
        if (u) u.delete_requests += 1;
        else if (unassigned && !d.scoped_inspector) unassigned.delete_requests += 1;
      } else {
        for (const u of byUser.values()) {
          if (has({ perms: inspectors.find((i) => i.username === u.username).perms }, d.module)) u.delete_requests += 1;
        }
      }
    }

    /* โรงอาหารที่รอตรวจสอบ (ไม่แยกตามผู้ตรวจ) */
    let canteen = null;
    if (acc.isAdmin || acc.perms.includes('canteen')) {
      const { rows: [c] } = await pool.query(
        'SELECT count(*)::int AS n FROM canteen WHERE NOT verified',
      );
      const { rows: items } = await pool.query(
        `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, revenue, cost, shop, note, reporter
         FROM canteen WHERE NOT verified ORDER BY date DESC, id DESC LIMIT 10`,
      );
      canteen = { unverified: c.n, items };
    }

    /* ยอดรวม */
    const list = [...byUser.values()];
    for (const u of list) {
      u.open_total =
        (u.repairs?.open || 0) +
        (u.housekeeping ? u.housekeeping.today_pending + u.housekeeping.missed_count : 0) +
        (u.gardening ? u.gardening.today_pending + u.gardening.missed_count : 0) +
        u.delete_requests;
    }
    const sum = (f) => list.reduce((n, u) => n + (f(u) || 0), 0);
    const totals = {
      repairs_open: sum((u) => u.repairs?.open),
      repairs_waiting_approval: sum((u) => u.repairs?.waiting_approval),
      repairs_overdue: sum((u) => u.repairs?.overdue),
      housekeeping_today_pending: sum((u) => u.housekeeping?.today_pending),
      gardening_today_pending: sum((u) => u.gardening?.today_pending),
      missed: sum((u) => (u.housekeeping?.missed_count || 0) + (u.gardening?.missed_count || 0)),
      upcoming: sum((u) => (u.housekeeping?.upcoming_count || 0) + (u.gardening?.upcoming_count || 0)),
      delete_requests: sum((u) => u.delete_requests) + (unassigned?.delete_requests || 0),
      canteen_unverified: canteen?.unverified || 0,
      unassigned: unassigned
        ? unassigned.repairs.open + unassigned.housekeeping.today_pending +
          unassigned.housekeeping.missed_count + unassigned.gardening.today_pending +
          unassigned.gardening.missed_count
        : 0,
    };

    res.json({ today, scope: self ? 'self' : 'all', inspectors: list, unassigned, canteen, totals });
  });

  // รายชื่อผู้ตรวจของเมนูหนึ่ง (ใช้เลือกผู้ตรวจในฟอร์มงาน) ทุกคนที่ล็อกอินเรียกได้
  app.get('/api/inspectors', needUser, async (req, res) => {
    const module = String(req.query.module || '');
    if (!MODULE_KEYS.includes(module)) return res.status(400).json({ error: 'เมนูไม่ถูกต้อง' });
    const { rows } = await pool.query(
      `SELECT username, display_name FROM users
       WHERE active AND role = 'inspector' AND $1 = ANY(permissions)
       ORDER BY COALESCE(NULLIF(display_name, ''), username)`,
      [module],
    );
    res.json(rows);
  });

  /* ---------- จัดการผู้ใช้ (เฉพาะ admin) ---------- */
  const USER_SELECT = `
    SELECT id, username, display_name, job_title, role, permissions, active,
           (line_user_id IS NOT NULL) AS line_linked, created_at
    FROM users`;

  app.get('/api/users', needUser, needAdmin, async (_req, res) => {
    res.json((await pool.query(`${USER_SELECT} ORDER BY id`)).rows);
  });

  const cleanPerms = (p) => [...new Set((Array.isArray(p) ? p : []).filter((x) => MODULE_KEYS.includes(x)))];

  app.post('/api/users', needUser, needAdmin, async (req, res) => {
    const { username, password, display_name = '', role = 'staff', permissions } = req.body || {};
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(String(username || ''))) {
      return res.status(400).json({ error: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 _ . - ยาว 3-40 ตัว' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    }
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });

    const { rows: [u] } = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role, permissions)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, await hashPassword(password), String(display_name).trim().slice(0, 80), role, cleanPerms(permissions)],
    );
    res.json((await pool.query(`${USER_SELECT} WHERE id = $1`, [u.id])).rows[0]);
  });

  app.put('/api/users/:id', needUser, needAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [target] } = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

    const b = req.body || {};
    const isEnvAdmin = target.username === adminUser;
    if ((b.role !== undefined && b.role !== 'admin' && isEnvAdmin) ||
        (b.active === false && (isEnvAdmin || target.username === req.username))) {
      return res.status(400).json({ error: 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีผู้ดูแลหลัก/บัญชีตัวเองได้' });
    }

    const sets = [];
    const values = [id];
    const add = (col, val) => { values.push(val); sets.push(`${col} = $${values.length}`); };

    if (b.display_name !== undefined) add('display_name', String(b.display_name).trim().slice(0, 80));
    if (b.role !== undefined) {
      if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
      add('role', b.role);
    }
    if (b.permissions !== undefined) add('permissions', cleanPerms(b.permissions));
    if (b.active !== undefined) add('active', Boolean(b.active));
    if (!sets.length) return res.status(400).json({ error: 'ไม่พบข้อมูลสำหรับแก้ไข' });

    await pool.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    res.json((await pool.query(`${USER_SELECT} WHERE id = $1`, [id])).rows[0]);
  });

  app.post('/api/users/:id/password', needUser, needAdmin, async (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    }
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
      [Number(req.params.id), await hashPassword(password)],
    );
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ ok: true });
  });

  // ผู้ใช้ขอรหัสผูก LINE (พิมพ์ #ผูกบัญชี รหัส ในแชทส่วนตัวกับบอทภายใน 10 นาที)
  app.post('/api/me/line-link-code', needUser, async (req, res) => {
    await pool.query(
      'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO NOTHING',
      [req.username],
    );
    const code = makeCode();
    await pool.query(
      `UPDATE users SET line_link_code = $2, line_link_exp = now() + interval '10 minutes' WHERE username = $1`,
      [req.username, code],
    );
    res.json({ code, expires_in: 600 });
  });

  /* ---------- คำขอลบ ---------- */
  // ส่งคำขอ (ช่างหรือใครก็ตามที่แก้ไขเมนูนั้นได้)
  app.post('/api/delete-requests', needUser, async (req, res) => {
    const { table, record_id: recordId, reason } = req.body || {};
    const def = DELETE_TABLES[table];
    const id = Number(recordId);
    const why = String(reason || '').trim();

    if (!def || !Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ข้อมูลที่จะลบไม่ถูกต้อง' });
    }
    if (!why) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ขอลบ' });
    if (why.length > 500) return res.status(400).json({ error: 'เหตุผลยาวเกิน 500 ตัวอักษร' });
    if (!can(req.access, def.module, 'write')) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ในเมนูนี้' });
    }

    const { rows: [rec] } = await pool.query(
      `SELECT ${def.label}::text AS label
              ${SCOPED_TABLES.has(table) ? ', inspector_username' : ", NULL::text AS inspector_username"}
       FROM ${table} WHERE id = $1`,
      [id],
    );
    if (!rec) return res.status(404).json({ error: 'ไม่พบรายการที่จะลบ' });

    const { rows: [dup] } = await pool.query(
      "SELECT id FROM delete_requests WHERE table_name = $1 AND record_id = $2 AND status = 'pending'",
      [table, id],
    );
    if (dup) return res.status(409).json({ error: `รายการนี้มีคำขอลบรอพิจารณาอยู่แล้ว (#${dup.id})` });

    // ผู้ตรวจขอลบได้เฉพาะงานที่ตัวเองเป็นผู้ตรวจ
    const requesterScope = scopeOf(req.access);
    if (requesterScope && SCOPED_TABLES.has(table) && rec.inspector_username !== requesterScope) {
      return res.status(403).json({ error: 'งานนี้ไม่ได้มอบหมายให้คุณเป็นผู้ตรวจ' });
    }

    const { rows: [row] } = await pool.query(
      `INSERT INTO delete_requests
         (table_name, module, record_id, record_label, reason, requested_by, scoped_inspector)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [table, def.module, id, (rec.label || '').slice(0, 200), why, req.username, rec.inspector_username],
    );

    res.json(row);
    broadcast('delete_request', row);
    void notifyReviewers(def.module, '🗑️ มีคำขอลบรอพิจารณา', [
      `คำขอ: #${row.id}`,
      `รายการ: ${row.record_label || '-'} (${table} #${id})`,
      `เหตุผล: ${why}`,
      `ผู้ขอ: ${req.access.display_name || req.username}`,
    ], row.scoped_inspector);
  });

  // รายการคำขอ: ผู้ตรวจ/admin เห็นของเมนูตัวเอง ช่างเห็นเฉพาะของตัวเอง
  app.get('/api/delete-requests', needUser, async (req, res) => {
    const acc = req.access;
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const reviewModules = acc.isAdmin ? MODULE_KEYS : acc.role === 'inspector' ? acc.perms : [];

    const { rows } = await pool.query(
      `SELECT * FROM delete_requests
       WHERE ($1::text IS NULL OR status = $1)
         AND (requested_by = $2
              OR (module = ANY($3::text[])
                  AND ($4::boolean OR table_name <> ALL($5::text[]) OR scoped_inspector = $2)))
       ORDER BY (status = 'pending') DESC, requested_at DESC
       LIMIT 300`,
      [status, acc.username, reviewModules, acc.isAdmin, [...SCOPED_TABLES]],
    );
    res.json(rows);
  });

  // อนุมัติ/ปฏิเสธ
  app.post('/api/delete-requests/:id/decision', needUser, async (req, res) => {
    const id = Number(req.params.id);
    const action = String(req.body?.action || '').toLowerCase();
    const note = String(req.body?.note || '').trim().slice(0, 500);

    if (!Number.isSafeInteger(id) || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action ต้องเป็น approve หรือ reject' });
    }
    if (action === 'reject' && !note) {
      return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
    }

    const client = await pool.connect();
    let row;
    try {
      await client.query('BEGIN');
      const { rows: [cur] } = await client.query(
        'SELECT * FROM delete_requests WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!cur) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'ไม่พบคำขอ' });
      }
      if (!can(req.access, cur.module, 'approve')) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'คุณไม่มีสิทธิ์พิจารณาคำขอในเมนูนี้' });
      }
      if (scopeOf(req.access) && SCOPED_TABLES.has(cur.table_name) && cur.scoped_inspector !== req.username) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'งานนี้ไม่ได้มอบหมายให้คุณเป็นผู้ตรวจ' });
      }
      if (cur.status !== 'pending') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'คำขอนี้ถูกพิจารณาไปแล้ว กรุณารีเฟรช' });
      }
      if (!DELETE_TABLES[cur.table_name]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'ตารางไม่ถูกต้อง' });
      }

      if (action === 'approve') {
        await deleteOrArchive(client, cur.table_name, cur.record_id);
      }
      row = (await client.query(
        `UPDATE delete_requests
         SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
         WHERE id = $1 RETURNING *`,
        [id, action === 'approve' ? 'approved' : 'rejected', req.username, note || null],
      )).rows[0];
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json(row);
    broadcast('delete_request', row);
    if (action === 'approve') broadcast('refresh', { table: row.table_name });

    // แจ้งผู้ขอ (ถ้าผูก LINE ไว้)
    void (async () => {
      const { rows: [u] } = await pool.query(
        'SELECT line_user_id FROM users WHERE username = $1',
        [row.requested_by],
      );
      if (u?.line_user_id) {
        await linePush(
          u.line_user_id,
          [
            action === 'approve' ? '✅ คำขอลบได้รับอนุมัติ' : '❌ คำขอลบไม่ได้รับอนุมัติ',
            `คำขอ #${row.id}: ${row.record_label || '-'}`,
            note ? `หมายเหตุ: ${note}` : '',
          ].filter(Boolean).join('\n'),
        );
      }
    })();
  });

  // ชื่อผู้ใช้ที่ต้องกรองแถวของตารางนี้ (null = เห็นทั้งหมด) ใช้ได้หลัง guard ทำงานแล้ว
  const scopeUser = (req, table) => (SCOPED_TABLES.has(table) ? (req.rowScope ?? scopeOf(req.access)) : null);

  return { getAccess, can, notifyReviewers, linkLine, needUser, scopeUser, scopeOf };
}