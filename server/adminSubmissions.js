/**
 * adminSubmissions.js — รับไฟล์แนบที่ผู้ใช้ส่งถึง Admin (แท็บ "ส่งไฟล์ถึง Admin" ใน Administration.jsx)
 *
 * ต้องติดตั้งก่อน:  npm i multer
 *
 * Endpoint
 *   POST   /api/admin/submissions              ผู้ใช้ที่ล็อกอินทุกคนส่งได้ (multipart: subject, category, message, month, files[])
 *   GET    /api/admin/submissions              เฉพาะ admin — รายการทั้งหมด (ไม่ส่งตัวไฟล์)
 *   GET    /api/admin/submissions/files/:id    เฉพาะ admin — ดาวน์โหลดไฟล์ (รองรับ ?token= เหมือน auth เดิม)
 *   PUT    /api/admin/submissions/:id/read     เฉพาะ admin — ทำเครื่องหมายอ่านแล้ว
 *   DELETE /api/admin/submissions/:id          เฉพาะ admin — ลบพร้อมไฟล์
 *
 * ผู้ส่ง (sender) ใช้ชื่อจาก token เสมอ ไม่เชื่อค่าที่หน้าเว็บส่งมา
 */
import multer from 'multer';
import path from 'path';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.zip',
]);
const MAX_LEN = { subject: 150, category: 60, message: 1000 };

// multer อ่านชื่อไฟล์เป็น latin1 -> แปลงกลับเป็น UTF-8 เพื่อให้ชื่อไฟล์ไทยไม่เพี้ยน
const fixName = (name = '') => {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const base = path.basename(decoded.includes('\ufffd') ? name : decoded);
  return base.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 200) || 'file';
};

export function registerAdminSubmissions(app, { pool, auth, broadcast, notify, getAccess }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 10 },
    fileFilter: (_req, file, cb) => {
      file.originalname = fixName(file.originalname);
      cb(null, ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase()));
    },
  }).array('files', MAX_FILES);

  const requireAdmin = async (req, res, next) => {
    const acc = await getAccess(req.username);
    if (acc?.isAdmin || acc?.role === 'admin') return next();
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
  };

  // ---------- ส่งไฟล์ ----------
  app.post(
    '/api/admin/submissions',
    auth,
    (req, res, next) =>
      upload(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'ไฟล์ใหญ่เกิน 10 MB' });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: `แนบได้สูงสุด ${MAX_FILES} ไฟล์` });
        }
        return res.status(400).json({ error: 'อ่านไฟล์ที่แนบไม่ได้' });
      }),
    async (req, res) => {
      const body = req.body || {};
      const subject = String(body.subject || '').trim();
      const category = String(body.category || '').trim();
      const message = String(body.message || '').trim();
      const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : null;
      const files = req.files || [];

      if (!subject || subject.length > MAX_LEN.subject) {
        return res.status(400).json({ error: 'กรุณากรอกเรื่อง (ไม่เกิน 150 ตัวอักษร)' });
      }
      if (category.length > MAX_LEN.category || message.length > MAX_LEN.message) {
        return res.status(400).json({ error: 'ข้อมูลยาวเกินกำหนด' });
      }
      if (!files.length) {
        return res.status(400).json({
          error: 'ไม่พบไฟล์ที่รองรับ (รองรับ PDF, Word, Excel, PowerPoint, รูปภาพ, CSV, ZIP)',
        });
      }

      const client = await pool.connect();
      let submission;
      try {
        await client.query('BEGIN');
        ({ rows: [submission] } = await client.query(
          `INSERT INTO admin_submissions (subject, category, message, month, sender)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, created_at`,
          [subject, category, message, month, req.username],
        ));
        for (const f of files) {
          await client.query(
            `INSERT INTO admin_submission_files (submission_id, filename, mime, size, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [submission.id, f.originalname, f.mimetype || 'application/octet-stream', f.size, f.buffer],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      res.status(201).json({ id: submission.id, files: files.length });

      broadcast('refresh', { table: 'admin_submissions' });
      // ไม่ส่ง LINE สำหรับงานธุรการ: LINE สงวนไว้สำหรับงานซ่อมบำรุงเท่านั้น
    },
  );

  // ---------- ประวัติของผู้ส่งเอง ----------
  app.get('/api/admin/submissions/mine', auth, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.subject, s.category, s.message, s.month, s.sender,
              s.created_at, s.status, s.review_note, s.reviewed_at, s.reviewed_by,
              COALESCE(
                json_agg(json_build_object('id', f.id, 'name', f.filename, 'size', f.size, 'mime', f.mime)
                         ORDER BY f.id) FILTER (WHERE f.id IS NOT NULL),
                '[]') AS files
       FROM admin_submissions s
       LEFT JOIN admin_submission_files f ON f.submission_id = s.id
       WHERE s.sender = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 500`,
      [req.username],
    );
    res.json(rows);
  });

  // ---------- รายการ (admin) ----------
  app.get('/api/admin/submissions', auth, requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.subject, s.category, s.message, s.month, s.sender,
              s.created_at, s.read_at, s.read_by, s.status, s.review_note, s.reviewed_at, s.reviewed_by,
              COALESCE(
                json_agg(json_build_object('id', f.id, 'name', f.filename, 'size', f.size, 'mime', f.mime)
                         ORDER BY f.id) FILTER (WHERE f.id IS NOT NULL),
                '[]') AS files
       FROM admin_submissions s
       LEFT JOIN admin_submission_files f ON f.submission_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 500`,
    );
    res.json(rows);
  });

  // ---------- อนุมัติ / ส่งกลับแก้ไข (admin) ----------
  app.put('/api/admin/submissions/:id/review', auth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '');
    const reviewNote = String(req.body?.review_note || '').trim().slice(0, 1000);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'เลขรายการไม่ถูกต้อง' });
    if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    if (status === 'rejected' && !reviewNote) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ส่งกลับแก้ไข' });
    const { rows } = await pool.query(
      `UPDATE admin_submissions SET status=$2, review_note=$3, reviewed_at=now(), reviewed_by=$4
       WHERE id=$1 RETURNING id, status, review_note, reviewed_at, reviewed_by`,
      [id, status, reviewNote || null, req.username],
    );
    if (!rows.length) return res.sendStatus(404);
    broadcast('refresh', { table: 'admin_submissions' });
    res.json(rows[0]);
  });

  // ---------- ดาวน์โหลด: แอดมินดาวน์โหลดได้ทุกไฟล์ ผู้ส่งดาวน์โหลดได้เฉพาะไฟล์ของตน ----------
  app.get('/api/admin/submissions/files/:id', auth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.sendStatus(400);

    const { rows: [f] } = await pool.query(
      `SELECT f.filename, f.mime, f.data, s.sender
       FROM admin_submission_files f
       JOIN admin_submissions s ON s.id = f.submission_id
       WHERE f.id = $1`,
      [id],
    );
    if (!f) return res.sendStatus(404);
    const acc = await getAccess(req.username);
    if (f.sender !== req.username && !(acc?.isAdmin || acc?.role === 'admin')) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้' });
    }

    res.set({
      'Content-Type': f.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(f.data);
  });

  // ---------- อ่านแล้ว / ลบ (admin) ----------
  app.put('/api/admin/submissions/:id/read', auth, requireAdmin, async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE admin_submissions SET read_at = now(), read_by = $2
       WHERE id = $1 AND read_at IS NULL`,
      [Number(req.params.id), req.username],
    );
    res.json({ ok: true, updated: rowCount });
  });

  app.delete('/api/admin/submissions/:id', auth, requireAdmin, async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM admin_submissions WHERE id = $1', [
      Number(req.params.id),
    ]);
    if (!rowCount) return res.sendStatus(404);
    res.sendStatus(204);
    broadcast('refresh', { table: 'admin_submissions' });
  });
}
