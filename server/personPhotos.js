// รูปคณะกรรมการ / พนักงาน
//  - GET  /api/{committees|employees}            รายการ (ไม่ส่ง bytea ออกไป แนบ photo_url แทน)
//  - GET  /api/{table}/:id/photo                 เปิดรูป (photo token หรือ Bearer)
//  - PUT  /api/{table}/:id/photo                 เพิ่ม/เปลี่ยนรูป (เฉพาะ Admin)
//  - DELETE /api/{table}/:id/photo               ลบรูป (เฉพาะ Admin)
import jwt from 'jsonwebtoken';

export const PERSON_TABLES = ['committees', 'employees'];

const PHOTO_MAX = 1_000_000;
const jwtSecret = () => process.env.JWT_SECRET || 'dev';
const photoSecret = () => `${jwtSecret()}:person-photo`;

const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

const signPhoto = (table, id) =>
  jwt.sign({ type: 'person-photo', table, id: Number(id) }, photoSecret(), { expiresIn: '1d' });

// ตัด bytea ออก แล้วแนบ photo_url (ใช้กับทุก response ของ committees/employees)
export function personRow(table, row) {
  if (!row) return row;
  const { photo_data, photo_mime, ...rest } = row;
  const has = rest.has_photo ?? Boolean(photo_data);
  return {
    ...rest,
    has_photo: has,
    photo_url: has
      ? `/api/${table}/${rest.id}/photo?v=${rest.photo_v || 0}&pt=${signPhoto(table, rest.id)}`
      : null,
  };
}

export function registerPersonPhotos(app, { pool, auth, broadcast }) {
  for (const table of PERSON_TABLES) {
    const orderBy = 'id DESC';

    // LIST (ลงทะเบียนก่อน CRUD loop จึงถูกใช้แทน GET เดิม)
    app.get(`/api/${table}`, auth, async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT id, full_name, position, department, phone, email, status, notes,
                ${table === 'committees' ? 'term_start, term_end,' : 'employee_code,'}
                created_at, updated_at,
                (photo_data IS NOT NULL) AS has_photo, photo_v
         FROM ${table}
         ORDER BY ${orderBy}
         LIMIT 500`,
      );
      res.json(rows.map((r) => personRow(table, r)));
    });

    // GET รูป
    app.get(`/api/${table}/:id/photo`, async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.sendStatus(400);

      let authorized = false;
      try {
        const p = jwt.verify(String(req.query.pt || ''), photoSecret());
        authorized = p.type === 'person-photo' && p.table === table && Number(p.id) === id;
      } catch { /* ไม่มี photo token */ }

      if (!authorized) {
        const header = req.get('authorization') || '';
        const bearer = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
        try {
          if (bearer) {
            jwt.verify(String(bearer), jwtSecret());
            authorized = true;
          }
        } catch { /* ไม่มีสิทธิ์ */ }
      }
      if (!authorized) return res.sendStatus(401);

      const { rows: [row] } = await pool.query(
        `SELECT photo_mime, photo_data FROM ${table} WHERE id = $1`,
        [id],
      );
      if (!row?.photo_data) return res.sendStatus(404);

      res.set({
        'Content-Type': row.photo_mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable', // เปลี่ยนรูป = เปลี่ยนค่า ?v=
      });
      res.send(row.photo_data);
    });

    // PUT รูป
    app.put(`/api/${table}/:id/photo`, auth, async (req, res) => {
      // สิทธิ์ตรวจโดย access.js (req.access) ก่อนถึงตรงนี้แล้ว
      if (!req.access) return res.sendStatus(401);
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
      }

      const { mime, data } = req.body || {};
      const check = IMAGE_SIGNATURES[mime];
      if (!check || typeof data !== 'string') {
        return res.status(400).json({ error: 'รองรับเฉพาะรูป JPG, PNG หรือ WebP' });
      }
      if (data.length > Math.ceil((PHOTO_MAX * 4) / 3) + 8) {
        return res.status(413).json({ error: 'รูปใหญ่เกิน 1 MB' });
      }
      const buf = Buffer.from(data, 'base64');
      if (buf.length < 12 || buf.length > PHOTO_MAX || !check(buf)) {
        return res.status(400).json({ error: 'ไฟล์รูปไม่ถูกต้อง หรือมีขนาดเกิน 1 MB' });
      }

      const { rows: [row] } = await pool.query(
        `UPDATE ${table}
         SET photo_mime = $2, photo_data = $3, photo_v = photo_v + 1, updated_at = now()
         WHERE id = $1
         RETURNING id, photo_v`,
        [id, mime, buf],
      );
      if (!row) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

      broadcast('refresh', { table });
      res.json(row);
    });

    // DELETE รูป
    app.delete(`/api/${table}/:id/photo`, auth, async (req, res) => {
      // สิทธิ์ตรวจโดย access.js (req.access) ก่อนถึงตรงนี้แล้ว
      if (!req.access) return res.sendStatus(401);
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
      }
      const { rowCount } = await pool.query(
        `UPDATE ${table}
         SET photo_mime = NULL, photo_data = NULL, photo_v = photo_v + 1, updated_at = now()
         WHERE id = $1`,
        [id],
      );
      if (!rowCount) return res.status(404).json({ error: 'ไม่พบข้อมูล' });

      broadcast('refresh', { table });
      res.sendStatus(204);
    });
  }
}
