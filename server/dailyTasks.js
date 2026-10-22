/* =========================================================
   งานประจำวัน: แม่บ้าน (housekeeping_tasks) / คนสวน (gardening_tasks)

   - ตาราง housekeeping_tasks / gardening_tasks = "งานประจำ"
       แสดงทุกวันตั้งแต่ date จนถึง end_date (ว่าง = ไม่มีวันสิ้นสุด)
       เฉพาะวันในสัปดาห์ที่อยู่ใน repeat_days (1=จันทร์ ... 7=อาทิตย์)
   - ตาราง daily_task_logs = ผลตรวจรายวัน (มีแถว = ตรวจแล้ว)
       วันใหม่ยังไม่มีแถว จึงกลับเป็น "รอตรวจ" เองโดยไม่ต้องรีเซ็ต
   - เพิ่ม / แก้ไข / ลบ / ตรวจงาน เฉพาะ Admin
   - GET /kpi สรุปคะแนน เวลา และอัตราสำเร็จรายพนักงาน
========================================================= */

import jwt from 'jsonwebtoken';

const MODULES = {
  housekeeping_tasks: 'housekeeping',
  gardening_tasks: 'gardening',
};

const TZ = 'Asia/Bangkok';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_KPI_DAYS = 93;

const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const bkkNowHM = () =>
  new Date().toLocaleTimeString('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });

const isDate = (v) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const blank = (v) => v === undefined || v === null || v === '';
const toId = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const round1 = (n) => Math.round(n * 10) / 10;

/* ---------- รูปแนบการตรวจงาน ---------- */
const MAX_PHOTOS = 3;
const PHOTO_MAX_BYTES = 1_000_000;
// ตั้ง REQUIRE_INSPECT_PHOTO=1 ใน .env เพื่อบังคับให้แนบรูปทุกครั้งที่ตรวจ (ค่าเริ่มต้น: ไม่บังคับ)
const REQUIRE_PHOTO = process.env.REQUIRE_INSPECT_PHOTO === '1';
const PHOTO_SECRET = () => `${process.env.JWT_SECRET || 'dev'}:daily-photo`;
const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
const signPhoto = (id) =>
  jwt.sign({ type: 'daily-photo', id: Number(id) }, PHOTO_SECRET(), { expiresIn: '1d' });

// photo_ids (จาก SQL) -> photos: [{ id, url }] พร้อม token อายุสั้นสำหรับ <img src>
function withPhotos(row) {
  if (!row) return row;
  const { photo_ids: ids, ...rest } = row;
  return {
    ...rest,
    photos: (Array.isArray(ids) ? ids : []).map((id) => ({
      id: Number(id),
      url: `/api/daily-task-photos/${id}?pt=${signPhoto(id)}`,
    })),
  };
}

// ตรวจรูปที่ส่งมา (base64) -> [{ mime, buf }] หรือ { error }
function parsePhotos(list) {
  if (list === undefined || list === null) return { photos: [] };
  if (!Array.isArray(list)) return { error: 'รูปแนบไม่ถูกต้อง' };
  const photos = [];
  for (const item of list) {
    const check = IMAGE_SIGNATURES[item?.mime];
    if (!check || typeof item?.data !== 'string') {
      return { error: 'รองรับเฉพาะรูป JPG, PNG หรือ WebP' };
    }
    if (item.data.length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 8) {
      return { error: 'รูปใหญ่เกิน 1 MB' };
    }
    const buf = Buffer.from(item.data, 'base64');
    if (buf.length < 12 || buf.length > PHOTO_MAX_BYTES || !check(buf)) {
      return { error: 'ไฟล์รูปไม่ถูกต้อง หรือมีขนาดเกิน 1 MB' };
    }
    photos.push({ mime: item.mime, buf });
  }
  return { photos };
}
const minutesOf = (s) => {
  const m = /^(\d{2}):(\d{2})/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/* ---------- SQL ---------- */

// $1 = วันที่ทำงาน (date), $2 = ชื่อโมดูล
const selectRow = (table) => `
  SELECT t.id,
         to_char($1::date, 'YYYY-MM-DD')  AS date,
         to_char(t.date, 'YYYY-MM-DD')    AS start_date,
         to_char(t.end_date, 'YYYY-MM-DD') AS end_date,
         t.employee_id, t.cleaner, t.building, t.location, t.task,
         left(t.start_time::text, 5) AS start_time,
         left(t.end_time::text, 5)   AS end_time,
         t.inspector, t.inspector_username, t.max_score, t.repeat_days, t.remark,
         (l.id IS NOT NULL) AS checked,
         l.checked_by, l.checked_at, l.finished_at, l.score,
         to_char(l.checked_at  AT TIME ZONE '${TZ}', 'HH24:MI') AS checked_time,
         to_char(l.finished_at AT TIME ZONE '${TZ}', 'HH24:MI') AS finished_time,
         l.remark AS inspect_remark,
         COALESCE((SELECT json_agg(p.id ORDER BY p.id)
                   FROM daily_task_log_photos p WHERE p.log_id = l.id), '[]'::json) AS photo_ids,
         e.employee_code,
         e.position   AS employee_position,
         e.department AS employee_department,
         e.status     AS employee_status
  FROM ${table} t
  LEFT JOIN daily_task_logs l
         ON l.module = $2 AND l.task_id = t.id AND l.work_date = $1::date
  LEFT JOIN employees e ON e.id = t.employee_id`;

const SCHEDULED = `
  t.date <= $1::date
  AND (t.end_date IS NULL OR t.end_date >= $1::date)
  AND EXTRACT(ISODOW FROM $1::date)::int = ANY (t.repeat_days)`;

/* ---------- ตรวจและแปลงข้อมูลงานประจำ ---------- */

const CAST = { date: '::date', end_date: '::date', repeat_days: '::int[]' };

async function parseTemplate(pool, body, creating) {
  const f = {};
  const err = (error) => ({ error });
  const has = (k) => body[k] !== undefined;

  // วันที่เริ่ม
  if (has('date') && !blank(body.date)) {
    if (!isDate(body.date)) return err('วันที่เริ่มไม่ถูกต้อง');
    f.date = body.date;
  } else if (creating) {
    f.date = bkkToday();
  } else if (has('date')) {
    return err('วันที่เริ่มไม่ถูกต้อง');
  }

  // วันที่สิ้นสุด (ว่าง = ทำต่อไปเรื่อย ๆ)
  if (has('end_date')) {
    if (blank(body.end_date)) f.end_date = null;
    else if (!isDate(body.end_date)) return err('วันที่สิ้นสุดไม่ถูกต้อง');
    else f.end_date = body.end_date;
  }
  if (f.date && f.end_date && f.end_date < f.date) {
    return err('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
  }

  // พนักงาน: ถ้าระบุ employee_id ให้ใช้ชื่อจากทะเบียนพนักงานเสมอ
  if (has('employee_id') && !blank(body.employee_id)) {
    const id = toId(body.employee_id);
    if (!id) return err('รหัสพนักงานไม่ถูกต้อง');
    const { rows: [emp] } = await pool.query(
      'SELECT id, full_name FROM employees WHERE id = $1',
      [id],
    );
    if (!emp) return err('ไม่พบพนักงานในทะเบียน');
    f.employee_id = id;
    f.cleaner = clean(emp.full_name, 150);
  } else {
    if (has('employee_id')) f.employee_id = null;
    if (has('cleaner')) f.cleaner = clean(body.cleaner, 150);
  }
  if ((creating || 'cleaner' in f) && !f.cleaner) {
    return err('กรุณาระบุพนักงานผู้รับผิดชอบ');
  }

  if (has('task')) f.task = clean(body.task, 2000);
  if ((creating || 'task' in f) && !f.task) return err('กรุณาระบุรายละเอียดงาน');

  if (has('building')) f.building = clean(body.building, 150) || null;
  if (has('location')) f.location = clean(body.location, 255) || null;
  if (has('inspector')) f.inspector = clean(body.inspector, 150) || null;
  if (has('inspector_username')) {
    const who = clean(body.inspector_username, 80);
    f.inspector_username = who || null;
    // ผูกกับบัญชีผู้ใช้ -> ใช้ชื่อที่แสดงของบัญชีเป็นชื่อผู้ตรวจ (แสดงในตาราง/รายงาน)
    if (who) {
      const { rows: [u] } = await pool.query(
        'SELECT COALESCE(NULLIF(display_name, \'\'), username) AS name FROM users WHERE username = $1',
        [who],
      );
      f.inspector = clean(u?.name || who, 150);
    }
  }
  if (has('remark')) f.remark = clean(body.remark, 1000) || null;

  for (const k of ['start_time', 'end_time']) {
    if (!has(k)) continue;
    if (blank(body[k])) f[k] = null;
    else if (!TIME_RE.test(String(body[k]))) return err('รูปแบบเวลาต้องเป็น HH:mm');
    else f[k] = String(body[k]);
  }
  if (f.start_time && f.end_time && f.end_time <= f.start_time) {
    return err('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
  }

  if (has('max_score')) {
    const n = Number(body.max_score);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return err('คะแนนเต็มต้องเป็นจำนวนเต็ม 1-100');
    }
    f.max_score = n;
  }

  if (has('repeat_days')) {
    const arr = Array.isArray(body.repeat_days) ? body.repeat_days.map(Number) : [];
    const uniq = [...new Set(arr)].sort((a, b) => a - b);
    if (!uniq.length || uniq.some((n) => !Number.isInteger(n) || n < 1 || n > 7)) {
      return err('กรุณาเลือกวันที่ทำงานอย่างน้อย 1 วัน');
    }
    f.repeat_days = uniq;
  }

  return { fields: f };
}

/* ---------- สรุป KPI ---------- */

function summarize(rows) {
  const groups = new Map();

  const blankGroup = (key, r) => ({
    key,
    employee_id: r.employee_id ?? null,
    employee_code: r.employee_code ?? null,
    name: r.employee_name || r.cleaner || '(ไม่ระบุ)',
    position: r.employee_position ?? null,
    department: r.employee_department ?? null,
    assigned: 0, done: 0, on_time: 0,
    score_got: 0, score_max_all: 0, score_max_done: 0,
    minutes_sum: 0, minutes_n: 0,
    items: [],
  });

  const total = blankGroup('total', {});

  const add = (g, r, item) => {
    const max = item.max_score;
    g.assigned += 1;
    g.score_max_all += max;
    if (!item.done) return;
    g.done += 1;
    g.score_got += item.score;
    g.score_max_done += max;
    if (item.on_time) g.on_time += 1;
    const a = minutesOf(item.start_time);
    const b = minutesOf(item.finished_time);
    if (a !== null && b !== null && b >= a) {
      g.minutes_sum += b - a;
      g.minutes_n += 1;
    }
  };

  for (const r of rows) {
    const key = r.employee_id != null
      ? `e:${r.employee_id}`
      : `n:${String(r.cleaner || '').trim().toLowerCase()}`;

    let g = groups.get(key);
    if (!g) {
      g = blankGroup(key, r);
      groups.set(key, g);
    }

    const item = {
      date: r.work_date_text,
      task_id: r.task_id,
      task: r.task,
      building: r.building,
      location: r.location,
      start_time: r.start_time || '',
      end_time: r.end_time || '',
      done: r.done,
      score: r.done ? Number(r.score) : null,
      max_score: Number(r.max_score) || 0,
      finished_time: r.finished_time || '',
      on_time: r.done ? r.on_time : null,
    };

    add(g, r, item);
    add(total, r, item);
    g.items.push(item);
  }

  const finish = (g) => {
    const out = {
      ...g,
      pending: g.assigned - g.done,
      completion_pct: g.assigned ? round1((g.done * 100) / g.assigned) : null,
      // KPI รวม = คะแนนที่ได้ / คะแนนเต็มของ "ทุกงานที่ต้องทำ" (งานที่ยังไม่ทำ = 0)
      score_pct: g.score_max_all ? round1((g.score_got * 100) / g.score_max_all) : null,
      // คุณภาพ = คะแนนที่ได้ / คะแนนเต็มเฉพาะงานที่ทำแล้ว
      quality_pct: g.score_max_done ? round1((g.score_got * 100) / g.score_max_done) : null,
      on_time_pct: g.done ? round1((g.on_time * 100) / g.done) : null,
      avg_minutes: g.minutes_n ? Math.round(g.minutes_sum / g.minutes_n) : null,
      score_got: round1(g.score_got),
    };
    delete out.minutes_sum;
    delete out.minutes_n;
    return out;
  };

  const employees = [...groups.values()]
    .map(finish)
    .sort((a, b) =>
      (b.score_pct ?? -1) - (a.score_pct ?? -1) ||
      String(a.name).localeCompare(String(b.name), 'th'));

  const totals = finish(total);
  delete totals.items;
  delete totals.key;
  delete totals.name;

  return { employees, totals };
}

/* ---------- ลงทะเบียน route ---------- */

export function registerDailyTasks(app, { pool, auth, broadcast, isAdminUser }) {
  // สิทธิ์ตรวจที่ access.js แล้ว (req.access) ถ้าไม่มีให้ถอยกลับไปใช้ admin เดิม
  const adminOnly = (req, res, next) => {
    if (req.access || isAdminUser(req.username)) return next();
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
  };

  for (const [table, module] of Object.entries(MODULES)) {
    const base = `/api/${table}`;

    const fetchOne = async (id, date) => {
      const { rows } = await pool.query(
        `${selectRow(table)} WHERE t.id = $3`,
        [date, module, id],
      );
      return withPhotos(rows[0] || null);
    };

    // รายการงานของวันที่เลือก (งานประจำ + ผลตรวจของวันนั้น)
    app.get(base, auth, async (req, res) => {
      const date = blank(req.query.date) ? bkkToday() : String(req.query.date);
      if (!isDate(date)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });

      const { rows } = await pool.query(
        `${selectRow(table)}
         WHERE ${SCHEDULED}
           AND ($3::text IS NULL OR t.inspector_username = $3)
         ORDER BY NULLIF(t.start_time::text, '') NULLS LAST, t.id`,
        [date, module, req.rowScope || null],
      );
      res.json(rows.map(withPhotos));
    });

    // รูปแนบการตรวจงาน (<img src> ใช้ token ของรูป หรือ Bearer)
    if (table === 'housekeeping_tasks') app.get(`/api/daily-task-photos/:id`, async (req, res) => {
      const id = toId(req.params.id);
      if (!id) return res.sendStatus(400);
      let ok = false;
      try {
        const p = jwt.verify(String(req.query.pt || ''), PHOTO_SECRET());
        ok = p.type === 'daily-photo' && Number(p.id) === id;
      } catch { /* ไม่มี photo token */ }
      if (!ok) {
        const h = req.get('authorization') || '';
        const bearer = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
        try {
          if (bearer) { jwt.verify(String(bearer), process.env.JWT_SECRET || 'dev'); ok = true; }
        } catch { /* ไม่มีสิทธิ์ */ }
      }
      if (!ok) return res.sendStatus(401);
      const { rows: [p] } = await pool.query('SELECT mime, data FROM daily_task_log_photos WHERE id = $1', [id]);
      if (!p) return res.sendStatus(404);
      res.set({
        'Content-Type': p.mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
      res.send(p.data);
    });

    // สรุป KPI รายพนักงาน
    app.get(`${base}/kpi`, auth, async (req, res) => {
      const today = bkkToday();
      const from = blank(req.query.from) ? `${today.slice(0, 8)}01` : String(req.query.from);
      const to = blank(req.query.to) ? today : String(req.query.to);

      if (!isDate(from) || !isDate(to)) {
        return res.status(400).json({ error: 'ช่วงวันที่ไม่ถูกต้อง' });
      }
      if (to < from) {
        return res.status(400).json({ error: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' });
      }
      if (daysBetween(from, to) + 1 > MAX_KPI_DAYS) {
        return res.status(400).json({ error: `เลือกช่วงวันที่ได้ไม่เกิน ${MAX_KPI_DAYS} วัน` });
      }

      // ไม่นับวันในอนาคตเป็นงานค้าง
      const upTo = to > today ? today : to;
      const empty = { from, to, employees: [], totals: summarize([]).totals };
      if (from > upTo) return res.json(empty);

      const { rows } = await pool.query(
        `WITH days AS (
           SELECT d::date AS work_date
           FROM generate_series($1::date, $2::date, interval '1 day') AS d
         ),
         sched AS (
           SELECT t.id AS task_id, dd.work_date, t.employee_id, t.cleaner,
                  t.task, t.building, t.location,
                  left(t.start_time::text, 5) AS start_time,
                  left(t.end_time::text, 5)   AS end_time,
                  t.max_score
           FROM ${table} t
           JOIN days dd
             ON dd.work_date >= t.date
            AND (t.end_date IS NULL OR dd.work_date <= t.end_date)
            AND EXTRACT(ISODOW FROM dd.work_date)::int = ANY (t.repeat_days)
           WHERE ($4::text IS NULL OR t.inspector_username = $4)
         ),
         logged AS (
           SELECT l.* FROM daily_task_logs l
           WHERE l.module = $3 AND l.work_date BETWEEN $1::date AND $2::date
             AND ($4::text IS NULL OR EXISTS (
                   SELECT 1 FROM ${table} t
                   WHERE t.id = l.task_id AND t.inspector_username = $4))
         ),
         joined AS (
           SELECT COALESCE(l.task_id, s.task_id)       AS task_id,
                  COALESCE(l.work_date, s.work_date)   AS work_date,
                  COALESCE(l.employee_id, s.employee_id) AS employee_id,
                  COALESCE(l.cleaner, s.cleaner)       AS cleaner,
                  COALESCE(l.task, s.task)             AS task,
                  COALESCE(l.building, s.building)     AS building,
                  COALESCE(l.location, s.location)     AS location,
                  COALESCE(l.start_time, s.start_time) AS start_time,
                  COALESCE(l.end_time, s.end_time)     AS end_time,
                  COALESCE(l.max_score, s.max_score)   AS max_score,
                  (l.id IS NOT NULL) AS done,
                  l.score, l.finished_at
           FROM sched s
           FULL OUTER JOIN logged l
             ON l.task_id = s.task_id AND l.work_date = s.work_date
         )
         SELECT j.task_id, j.work_date, j.cleaner, j.task, j.building, j.location,
                j.start_time, j.end_time, j.max_score, j.done, j.score, j.finished_at,
                COALESCE(j.employee_id, e.id) AS employee_id,
                to_char(j.work_date, 'YYYY-MM-DD') AS work_date_text,
                to_char(j.finished_at AT TIME ZONE '${TZ}', 'HH24:MI') AS finished_time,
                CASE
                  WHEN NOT j.done THEN NULL
                  WHEN NULLIF(j.end_time, '') IS NULL OR j.finished_at IS NULL THEN true
                  ELSE j.finished_at <=
                       ((j.work_date + NULLIF(j.end_time, '')::time) AT TIME ZONE '${TZ}')
                END AS on_time,
                e.full_name  AS employee_name,
                e.employee_code,
                e.position   AS employee_position,
                e.department AS employee_department
         FROM joined j
         LEFT JOIN LATERAL (
           -- งานเก่าที่ยังไม่ผูก employee_id: จับคู่ด้วยชื่อ (เฉพาะกรณีชื่อตรงกับพนักงานคนเดียว)
           SELECT x.* FROM employees x
           WHERE x.id = j.employee_id
              OR (j.employee_id IS NULL
                  AND lower(btrim(x.full_name)) = lower(btrim(j.cleaner))
                  AND (SELECT count(*) FROM employees y
                       WHERE lower(btrim(y.full_name)) = lower(btrim(j.cleaner))) = 1)
           ORDER BY (x.id = j.employee_id) DESC NULLS LAST, x.id
           LIMIT 1
         ) e ON true
         ORDER BY j.work_date, NULLIF(j.start_time, '') NULLS LAST, j.task_id`,
        [from, upTo, module, req.rowScope || null],
      );

      res.json({ from, to, ...summarize(rows) });
    });

    // เพิ่มงานประจำ
    app.post(base, auth, adminOnly, async (req, res) => {
      const parsed = await parseTemplate(pool, req.body || {}, true);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const cols = Object.keys(parsed.fields);
      const values = cols.map((c) => parsed.fields[c]);
      const { rows: [created] } = await pool.query(
        `INSERT INTO ${table} (${cols.join(', ')})
         VALUES (${cols.map((c, i) => `$${i + 1}${CAST[c] || ''}`).join(', ')})
         RETURNING id`,
        values,
      );

      res.json(await fetchOne(created.id, parsed.fields.date));
      broadcast('refresh', { table });
    });

    // แก้ไขงานประจำ (ไม่แตะผลตรวจที่บันทึกไว้แล้ว)
    app.put(`${base}/:id`, auth, adminOnly, async (req, res) => {
      const id = toId(req.params.id);
      if (!id) return res.status(400).json({ error: 'รหัสงานไม่ถูกต้อง' });

      const parsed = await parseTemplate(pool, req.body || {}, false);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const cols = Object.keys(parsed.fields);
      if (!cols.length) return res.status(400).json({ error: 'ไม่พบข้อมูลสำหรับแก้ไข' });

      const values = cols.map((c) => parsed.fields[c]);
      values.push(id);

      const { rows: [updated] } = await pool.query(
        `UPDATE ${table}
         SET ${cols.map((c, i) => `${c} = $${i + 1}${CAST[c] || ''}`).join(', ')},
             updated_at = now()
         WHERE id = $${values.length}
         RETURNING to_char(date, 'YYYY-MM-DD') AS date`,
        values,
      );
      if (!updated) return res.sendStatus(404);

      const viewDate = isDate(String(req.query.date || '')) ? String(req.query.date) : updated.date;
      res.json(await fetchOne(id, viewDate));
      broadcast('refresh', { table });
    });

    // ลบงานประจำ
    //  - ยังไม่เคยมีวันที่ต้องทำ และไม่มีผลตรวจ -> ลบทิ้งจริง
    //  - เคยมีวันที่ต้องทำหรือเคยตรวจแล้ว -> ยุติตั้งแต่วันนี้เป็นต้นไป เก็บประวัติและ KPI ย้อนหลังไว้
    app.delete(`${base}/:id`, auth, adminOnly, async (req, res) => {
      const id = toId(req.params.id);
      if (!id) return res.status(400).json({ error: 'รหัสงานไม่ถูกต้อง' });

      const today = bkkToday();
      const { rows: [t] } = await pool.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date,
                EXISTS (SELECT 1 FROM daily_task_logs l
                        WHERE l.module = $2 AND l.task_id = $1) AS has_logs
         FROM ${table} WHERE id = $1`,
        [id, module],
      );
      if (!t) return res.sendStatus(404);

      let archived = false;
      if (!t.has_logs && t.date >= today) {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      } else {
        const yesterday = addDays(today, -1);
        const endDate = t.date > yesterday ? t.date : yesterday;
        await pool.query(
          `UPDATE ${table}
           SET end_date = LEAST(COALESCE(end_date, $2::date), $2::date), updated_at = now()
           WHERE id = $1`,
          [id, endDate],
        );
        archived = true;
      }

      res.json({ ok: true, archived });
      broadcast('refresh', { table });
    });

    // ตรวจงานของวันที่เลือก: ให้คะแนน + เวลาที่เสร็จจริง / ยกเลิกผลตรวจ
    app.post(`${base}/:id/inspect`, auth, adminOnly, async (req, res) => {
      const id = toId(req.params.id);
      if (!id) return res.status(400).json({ error: 'รหัสงานไม่ถูกต้อง' });

      const body = req.body || {};
      const today = bkkToday();
      const workDate = blank(body.date) ? today : String(body.date);

      if (!isDate(workDate)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
      if (workDate > today) {
        return res.status(400).json({ error: 'ยังไม่ถึงวันที่ของงานนี้ ตรวจงานล่วงหน้าไม่ได้' });
      }
      if (typeof body.checked !== 'boolean') {
        return res.status(400).json({ error: 'checked ต้องเป็น true หรือ false' });
      }

      // ยกเลิกผลตรวจ
      if (!body.checked) {
        await pool.query(
          'DELETE FROM daily_task_logs WHERE module = $1 AND task_id = $2 AND work_date = $3::date',
          [module, id, workDate],
        );
        res.json(await fetchOne(id, workDate));
        broadcast('refresh', { table });
        return;
      }

      const { rows: [t] } = await pool.query(
        `SELECT t.id, t.employee_id, t.cleaner, t.building, t.location, t.task,
                left(t.start_time::text, 5) AS start_time,
                left(t.end_time::text, 5)   AS end_time,
                t.max_score
         FROM ${table} t
         WHERE t.id = $1 AND ${SCHEDULED.replaceAll('$1::date', '$2::date')}`,
        [id, workDate],
      );
      if (!t) {
        return res.status(409).json({ error: 'ไม่พบงานนี้ หรืองานนี้ไม่ได้อยู่ในตารางของวันที่เลือก' });
      }

      // คะแนน (ไม่ระบุ = เต็ม)
      let score = blank(body.score) ? t.max_score : Number(body.score);
      if (!Number.isFinite(score) || score < 0 || score > t.max_score) {
        return res.status(400).json({ error: `คะแนนต้องอยู่ระหว่าง 0 ถึง ${t.max_score}` });
      }
      score = round1(score);

      // เวลาที่ทำเสร็จจริง (ไม่ระบุ: วันนี้ = เวลาปัจจุบัน, วันก่อนหน้า = เวลาสิ้นสุดตามแผน)
      let finished = body.finished_time;
      if (blank(finished)) {
        finished = workDate === today
          ? bkkNowHM()
          : (TIME_RE.test(t.end_time || '') ? t.end_time : '00:00');
      } else if (!TIME_RE.test(String(finished))) {
        return res.status(400).json({ error: 'รูปแบบเวลาที่เสร็จต้องเป็น HH:mm' });
      }

      const checkedBy = clean(body.checked_by, 150) || req.username;
      const remark = clean(body.remark, 1000) || null;

      // รูปแนบการตรวจ: photos = รูปใหม่ (base64), remove_photo_ids = รูปเดิมที่ต้องการลบ
      const parsedPhotos = parsePhotos(body.photos);
      if (parsedPhotos.error) return res.status(400).json({ error: parsedPhotos.error });
      const newPhotos = parsedPhotos.photos;
      const removeIds = (Array.isArray(body.remove_photo_ids) ? body.remove_photo_ids : [])
        .map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [log] } = await client.query(
          `INSERT INTO daily_task_logs
             (module, task_id, work_date, employee_id, cleaner, building, location, task,
              start_time, end_time, max_score, score, finished_at, checked_by, checked_at, remark)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   (($3::date + $13::time) AT TIME ZONE '${TZ}'), $14, now(), $15)
           ON CONFLICT (module, task_id, work_date) DO UPDATE SET
             employee_id = EXCLUDED.employee_id, cleaner = EXCLUDED.cleaner,
             building = EXCLUDED.building, location = EXCLUDED.location, task = EXCLUDED.task,
             start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
             max_score = EXCLUDED.max_score, score = EXCLUDED.score,
             finished_at = EXCLUDED.finished_at, checked_by = EXCLUDED.checked_by,
             checked_at = now(), remark = EXCLUDED.remark
           RETURNING id`,
          [
            module, id, workDate, t.employee_id, t.cleaner, t.building, t.location, t.task,
            t.start_time, t.end_time, t.max_score, score, String(finished), checkedBy, remark,
          ],
        );

        if (removeIds.length) {
          await client.query(
            'DELETE FROM daily_task_log_photos WHERE log_id = $1 AND id = ANY($2::bigint[])',
            [log.id, removeIds],
          );
        }
        const { rows: [{ n }] } = await client.query(
          'SELECT count(*)::int AS n FROM daily_task_log_photos WHERE log_id = $1',
          [log.id],
        );
        if (n + newPhotos.length > MAX_PHOTOS) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `แนบรูปได้ไม่เกิน ${MAX_PHOTOS} รูปต่อการตรวจ` });
        }
        if (REQUIRE_PHOTO && n + newPhotos.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'กรุณาแนบรูปการตรวจงานอย่างน้อย 1 รูป' });
        }
        for (const ph of newPhotos) {
          await client.query(
            'INSERT INTO daily_task_log_photos (log_id, mime, data) VALUES ($1, $2, $3)',
            [log.id, ph.mime, ph.buf],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      res.json(await fetchOne(id, workDate));
      broadcast('refresh', { table });
    });
  }
}
