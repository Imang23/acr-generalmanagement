// สโตร์ยาห้องพยาบาล + แดชบอร์ดสรุปงานอนามัย — ลงทะเบียนด้วย registerMedicine(app, {...}) ใน server
// สิทธิ์: ใช้เมนู 'nurse' (read = ดู, write = เพิ่ม/แก้/จ่าย/รับเข้า/ลบ)

const NORMAL = /^(ปกติ|ไม่พบ|ไม่มี|สายตาปกติ|-)/;

const FINDINGS = [
  ['disease', 'โรคประจำตัว'], ['skin', 'ผิวหนัง'], ['eyes', 'ตา'], ['ears', 'หู'], ['neck', 'คอ'],
  ['oral', 'ช่องปาก'], ['lymph', 'ต่อมน้ำเหลือง'], ['heart_rhythm', 'หัวใจ (จังหวะ)'],
  ['heart_sound', 'หัวใจ (เสียง)'], ['liver', 'ตับ'], ['chest', 'ทรวงอกและปอด'], ['spleen', 'ม้าม'],
  ['bone', 'กระดูกและข้อ'], ['lice', 'เหา'], ['vision', 'สายตา'], ['colorblind', 'ตาบอดสี'],
];
const NUTRITION_WATCH = new Set(['ผอม', 'อ้วน', 'เริ่มอ้วน']);

const countBy = (arr) => {
  const m = {};
  for (const v of arr) if (v) m[v] = (m[v] || 0) + 1;
  return m;
};

// สรุปผลตรวจจากแถว health_checks (class_room, student, detail) — ฟังก์ชันล้วน ทดสอบได้
export function summarizeHealth(rows) {
  const details = rows.map((r) => ({ ...r, d: r.detail || {} }));
  const findings = FINDINGS.map(([key, label]) => ({
    key, label,
    count: details.filter((r) => r.d[key] && !NORMAL.test(r.d[key])).length,
  }));

  const byRoom = {};
  for (const r of details) {
    const room = r.class_room || '-';
    (byRoom[room] ||= []).push(r.d.nut_wh);
  }

  const follow = [];
  for (const r of details) {
    const issues = [];
    for (const [key, label] of FINDINGS) {
      const v = r.d[key];
      if (v && !NORMAL.test(v)) issues.push(`${label}: ${v}`);
    }
    if (NUTRITION_WATCH.has(r.d.nut_wh)) issues.push(`รูปร่าง: ${r.d.nut_wh}`);
    if (issues.length) follow.push({ student: r.student, class_room: r.class_room, issues });
  }

  return {
    total: details.length,
    nutrition: {
      weight_age: countBy(details.map((r) => r.d.nut_wa)),
      height_age: countBy(details.map((r) => r.d.nut_ha)),
      weight_height: countBy(details.map((r) => r.d.nut_wh)),
    },
    nutrition_by_room: Object.fromEntries(
      Object.entries(byRoom).map(([room, vals]) => [room, countBy(vals)]),
    ),
    findings,
    follow_up: follow.slice(0, 500),
    follow_up_count: follow.length,
  };
}

export function registerMedicine(app, { pool, auth, broadcast, getAccess, can }) {
  const guard = (action) => async (req, res, next) => {
    const acc = await getAccess(req.username);
    if (!can(acc, 'nurse', action)) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ใช้งานสโตร์ยา / ข้อมูลห้องพยาบาล' });
    }
    next();
  };
  const read = [auth, guard('read')];
  const write = [auth, guard('write')];

  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
  };
  const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  const changed = () => broadcast('refresh', { table: 'medicines' });

  const LIST_SQL = `
    SELECT id, name, category, unit, qty::float AS qty, min_qty::float AS min_qty, lot, expiry,
           location, note,
           (qty <= min_qty) AS low,
           (expiry IS NOT NULL AND expiry < CURRENT_DATE) AS expired,
           (expiry IS NOT NULL AND expiry >= CURRENT_DATE AND expiry <= CURRENT_DATE + 60) AS expiring
    FROM medicines`;

  // รายชื่อนักเรียนสำหรับเลือกตอนบันทึกห้องพยาบาล (มาจากผลตรวจสุขภาพที่นำเข้า ล่าสุดต่อคน)
  // ใช้ path ใต้ health_checks เพื่อให้ตัวคุมสิทธิ์กลาง (เมนู nurse) ครอบคลุมอัตโนมัติ
  app.get('/api/health_checks/students', ...read, async (req, res) => {
    const q = text(req.query.q, 100).replace(/[\\%_]/g, '\\$&');
    const { rows } = await pool.query(
      `SELECT student, class_room, code, sex FROM (
         SELECT DISTINCT ON (student, COALESCE(class_room, ''))
                student, class_room, detail->>'code' AS code, detail->>'sex' AS sex
         FROM health_checks
         WHERE $1 = ''
            OR student ILIKE '%' || $1 || '%'
            OR detail->>'code' = $1
            OR class_room ILIKE $1 || '%'
         ORDER BY student, COALESCE(class_room, ''), date DESC, id DESC
       ) t
       ORDER BY class_room NULLS LAST, student
       LIMIT 30`,
      [q],
    );
    res.json(rows);
  });

  app.get('/api/medicines', ...read, async (_req, res) => {
    res.json((await pool.query(`${LIST_SQL} ORDER BY name LIMIT 1000`)).rows);
  });

  app.post('/api/medicines', ...write, async (req, res) => {
    const b = req.body || {};
    const name = text(b.name, 200);
    const qty = b.qty === undefined || b.qty === '' ? 0 : num(b.qty);
    const min = b.min_qty === undefined || b.min_qty === '' ? 0 : num(b.min_qty);
    if (!name || qty === null || min === null) return res.status(400).json({ error: 'ข้อมูลยาไม่ถูกต้อง' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [m] } = await client.query(
        `INSERT INTO medicines (name, category, unit, qty, min_qty, lot, expiry, location, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, qty::float AS qty`,
        [name, text(b.category, 100), text(b.unit, 30) || 'เม็ด', qty, min,
          text(b.lot, 60), dateOrNull(b.expiry), text(b.location, 100), text(b.note, 500)],
      );
      if (qty > 0) {
        await client.query(
          `INSERT INTO medicine_logs (medicine_id, medicine_name, kind, qty, balance, note, by_user)
           VALUES ($1,$2,'in',$3,$3,'ยอดยกมา',$4)`,
          [m.id, m.name, qty, req.username],
        );
      }
      await client.query('COMMIT');
      changed();
      res.json((await pool.query(`${LIST_SQL} WHERE id = $1`, [m.id])).rows[0]);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  // แก้ข้อมูลยา (ไม่รวมจำนวนคงเหลือ — ใช้ รับเข้า / จ่ายออก / ปรับยอด เพื่อให้มีประวัติ)
  app.put('/api/medicines/:id', ...write, async (req, res) => {
    const b = req.body || {};
    const name = text(b.name, 200);
    const min = b.min_qty === undefined || b.min_qty === '' ? 0 : num(b.min_qty);
    if (!name || min === null) return res.status(400).json({ error: 'ข้อมูลยาไม่ถูกต้อง' });
    const { rowCount } = await pool.query(
      `UPDATE medicines SET name=$2, category=$3, unit=$4, min_qty=$5, lot=$6, expiry=$7,
              location=$8, note=$9, updated_at=now()
       WHERE id=$1`,
      [req.params.id, name, text(b.category, 100), text(b.unit, 30) || 'เม็ด', min,
        text(b.lot, 60), dateOrNull(b.expiry), text(b.location, 100), text(b.note, 500)],
    );
    if (!rowCount) return res.sendStatus(404);
    changed();
    res.json((await pool.query(`${LIST_SQL} WHERE id = $1`, [req.params.id])).rows[0]);
  });

  app.delete('/api/medicines/:id', auth, guard('delete'), async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM medicines WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.sendStatus(404);
    changed();
    res.sendStatus(204);
  });

  // จ่ายยา: ตัดสต็อกแบบ atomic, ไม่จ่ายยาหมดอายุ, ผูกกับรายการห้องพยาบาลได้ (เติมช่อง "การรักษา/ยาที่ให้")
  app.post('/api/medicines/:id/dispense', ...write, async (req, res) => {
    const b = req.body || {};
    const qty = num(b.qty);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'จำนวนที่จ่ายไม่ถูกต้อง' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [cur] } = await client.query('SELECT * FROM medicines WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cur) { await client.query('ROLLBACK'); return res.sendStatus(404); }
      if (cur.expiry && cur.expiry < new Date().toISOString().slice(0, 10)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `ยา ${cur.name} หมดอายุแล้ว จ่ายไม่ได้` });
      }
      if (Number(cur.qty) < qty) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `ยา ${cur.name} คงเหลือ ${Number(cur.qty)} ${cur.unit} ไม่พอจ่าย` });
      }

      let student = text(b.student, 200) || null;
      let classRoom = text(b.class_room, 50) || null;
      let visitId = null;
      if (b.visit_id) {
        const { rows: [v] } = await client.query('SELECT id, student, class_room FROM nurse_visits WHERE id = $1', [b.visit_id]);
        if (!v) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ไม่พบรายการห้องพยาบาล' }); }
        visitId = v.id; student = v.student; classRoom = v.class_room;
      }

      const { rows: [m] } = await client.query(
        'UPDATE medicines SET qty = qty - $2, updated_at = now() WHERE id = $1 RETURNING qty::float AS qty',
        [cur.id, qty],
      );
      await client.query(
        `INSERT INTO medicine_logs (medicine_id, medicine_name, kind, qty, balance, student, class_room, visit_id, note, by_user)
         VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8,$9)`,
        [cur.id, cur.name, qty, m.qty, student, classRoom, visitId, text(b.note, 500), req.username],
      );
      if (visitId) {
        await client.query(
          `UPDATE nurse_visits
           SET treatment = CASE WHEN COALESCE(treatment, '') = '' THEN $2 ELSE treatment || E'\\n' || $2 END
           WHERE id = $1`,
          [visitId, `${cur.name} ${qty} ${cur.unit}`],
        );
      }
      await client.query('COMMIT');
      changed();
      if (visitId) broadcast('refresh', { table: 'nurse_visits' });
      res.json({ id: cur.id, qty: m.qty });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  // รับยาเข้า (อัปเดตล็อต/วันหมดอายุของล็อตล่าสุดได้)
  app.post('/api/medicines/:id/restock', ...write, async (req, res) => {
    const b = req.body || {};
    const qty = num(b.qty);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'จำนวนที่รับเข้าไม่ถูกต้อง' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [m] } = await client.query(
        `UPDATE medicines
         SET qty = qty + $2,
             lot = COALESCE(NULLIF($3, ''), lot),
             expiry = COALESCE($4::date, expiry),
             updated_at = now()
         WHERE id = $1
         RETURNING id, name, qty::float AS qty`,
        [req.params.id, qty, text(b.lot, 60), dateOrNull(b.expiry)],
      );
      if (!m) { await client.query('ROLLBACK'); return res.sendStatus(404); }
      await client.query(
        `INSERT INTO medicine_logs (medicine_id, medicine_name, kind, qty, balance, note, by_user)
         VALUES ($1,$2,'in',$3,$4,$5,$6)`,
        [m.id, m.name, qty, m.qty, text(b.note, 500), req.username],
      );
      await client.query('COMMIT');
      changed();
      res.json(m);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  // ปรับยอดตามการนับจริง (ต้องใส่เหตุผล)
  app.post('/api/medicines/:id/adjust', ...write, async (req, res) => {
    const b = req.body || {};
    const qty = num(b.qty);
    const note = text(b.note, 500);
    if (qty === null) return res.status(400).json({ error: 'ยอดคงเหลือไม่ถูกต้อง' });
    if (!note) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ปรับยอด' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [m] } = await client.query(
        'UPDATE medicines SET qty = $2, updated_at = now() WHERE id = $1 RETURNING id, name, qty::float AS qty',
        [req.params.id, qty],
      );
      if (!m) { await client.query('ROLLBACK'); return res.sendStatus(404); }
      await client.query(
        `INSERT INTO medicine_logs (medicine_id, medicine_name, kind, qty, balance, note, by_user)
         VALUES ($1,$2,'adjust',$3,$3,$4,$5)`,
        [m.id, m.name, qty, note, req.username],
      );
      await client.query('COMMIT');
      changed();
      res.json(m);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/api/medicine_logs', ...read, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { rows } = await pool.query(
      `SELECT id, medicine_id, medicine_name, kind, qty::float AS qty, balance::float AS balance,
              student, class_room, visit_id, note, by_user, created_at
       FROM medicine_logs ORDER BY created_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    res.json(rows);
  });

  // แดชบอร์ดสรุป: ผลตรวจสุขภาพ (ตามวันที่ตรวจ) + ห้องพยาบาล 30 วัน + สโตร์ยา
  app.get('/api/health-dashboard', ...read, async (req, res) => {
    const { rows: dateRows } = await pool.query(
      `SELECT date::text AS d, count(*)::int AS n FROM health_checks GROUP BY date ORDER BY date DESC LIMIT 60`,
    );
    const dates = dateRows.map((r) => r.d);
    const picked = dateOrNull(req.query.date) || dates[0] || null;

    let health = null;
    if (picked) {
      const { rows } = await pool.query(
        'SELECT student, class_room, detail FROM health_checks WHERE date = $1::date ORDER BY id',
        [picked],
      );
      health = summarizeHealth(rows);
    }

    const BKK = `(now() AT TIME ZONE 'Asia/Bangkok')::date`;
    const [{ rows: symptoms }, { rows: statuses }, { rows: [today] }, { rows: [meds] }, { rows: attention }] = await Promise.all([
      pool.query(
        `SELECT lower(btrim(symptom)) AS symptom, count(*)::int AS n FROM nurse_visits
         WHERE date >= ${BKK} - 29 GROUP BY 1 ORDER BY n DESC, 1 LIMIT 8`,
      ),
      pool.query(`SELECT status, count(*)::int AS n FROM nurse_visits WHERE date >= ${BKK} - 29 GROUP BY status`),
      pool.query(
        `SELECT count(*) FILTER (WHERE date = ${BKK})::int AS today,
                count(*) FILTER (WHERE date >= ${BKK} - 29)::int AS last30
         FROM nurse_visits`,
      ),
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE qty <= min_qty)::int AS low,
                count(*) FILTER (WHERE expiry < CURRENT_DATE)::int AS expired,
                count(*) FILTER (WHERE expiry >= CURRENT_DATE AND expiry <= CURRENT_DATE + 60)::int AS expiring
         FROM medicines`,
      ),
      pool.query(
        `SELECT name, qty::float AS qty, unit, min_qty::float AS min_qty, expiry,
                (qty <= min_qty) AS low, (expiry < CURRENT_DATE) AS expired
         FROM medicines
         WHERE qty <= min_qty OR expiry <= CURRENT_DATE + 60
         ORDER BY (expiry < CURRENT_DATE) DESC, expiry NULLS LAST, name LIMIT 20`,
      ),
    ]);

    res.json({
      dates, date: picked, health,
      nurse: {
        today: today.today, last30: today.last30,
        top_symptoms: symptoms,
        by_status: Object.fromEntries(statuses.map((r) => [r.status, r.n])),
      },
      medicines: { ...meds, attention },
    });
  });
}