import 'dotenv/config';
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import {
  notifyNewRepair,
  notifyRepairRejected,
  notifyRepairApproved,
  handleLineEvent,
} from './lineWorkOrder.js';
import { registerDailyTasks } from './dailyTasks.js';
import { registerAccess } from './access.js';
import { registerPersonPhotos, personRow, PERSON_TABLES } from './personPhotos.js';
import { registerAdminSubmissions } from './adminSubmissions.js';


const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  JWT_SECRET = 'dev',
  ADMIN_USER = 'admin',
  ADMIN_PASS = 'admin',
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_TARGET_ID,
} = process.env;

// secret ของ token รูปงานซ่อม (ประกาศไว้ตรงนี้ก่อนถูกใช้งานทุกจุด)
const PHOTO_SECRET = `${JWT_SECRET}:photo`;

app.use(cors());

/* =========================================================
   LINE Notifications: แจ้งเตือนการเพิ่ม/แก้ไข/ลบข้อมูล
========================================================= */
async function sendLineNotification(title, details = []) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_TARGET_ID) {
    console.warn(
      '[LINE notification] ไม่พบ LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_TARGET_ID ใน .env',
    );
    return false;
  }

  const message = [
    title,
    ...details.filter((item) => item !== undefined && item !== null && item !== ''),
    `เวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
  ].join('\n');

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: LINE_TARGET_ID,
        messages: [{ type: 'text', text: message.slice(0, 4900) }],
      }),
    });

    if (!response.ok) {
      console.error(
        '[LINE notification] ส่งไม่สำเร็จ:',
        response.status,
        await response.text(),
      );
      return false;
    }

    console.log('[LINE notification] ส่งข้อความสำเร็จ:', title);
    return true;
  } catch (err) {
    console.error('[LINE notification]', err?.message || err);
    return false;
  }
}

function notifyRepairStatusChanged(repair, previousStatus) {
  const statusLabels = {
    new: 'งานใหม่',
    doing: 'กำลังดำเนินการ',
    done: 'เสร็จสิ้น',
    completed: 'เสร็จสิ้น',
    cancelled: 'ยกเลิก',
    canceled: 'ยกเลิก',
  };

  return sendLineNotification('🔧 เปลี่ยนสถานะงานซ่อม', [
    `เลขที่งาน: #${repair.id}`,
    `รายละเอียด: ${repair.title || '-'}`,
    `สถานที่: ${repair.location || '-'}`,
    `สถานะเดิม: ${statusLabels[previousStatus] || previousStatus || '-'}`,
    `สถานะใหม่: ${statusLabels[repair.status] || repair.status || '-'}`,
    `ผู้รับผิดชอบ: ${repair.assignee || '-'}`,
  ]);
}

function notifyCanteenSaved(record, action) {
  const revenue = Number(record.revenue || 0);
  const cost = Number(record.cost || 0);

  return sendLineNotification(
    action === 'create' ? '🍽️ บันทึกรายการโรงอาหารใหม่' : '🍽️ แก้ไขรายการโรงอาหาร',
    [
      `วันที่: ${record.date || '-'}`,
      `รายรับ: ${revenue.toLocaleString('th-TH')} บาท`,
      `รายจ่าย: ${cost.toLocaleString('th-TH')} บาท`,
      `คงเหลือ: ${(revenue - cost).toLocaleString('th-TH')} บาท`,
      `ร้านค้า: ${record.shop || '-'}`,
      `หมายเหตุ: ${record.note || '-'}`,
      `ผู้บันทึก: ${record.reporter || '-'}`,
    ],
  );
}

function notifyOtherResource(table, action, record) {
  const labels = {
    vehicles: '🚗 ข้อมูลรถ',
    workers: '👷 ข้อมูลพนักงาน',
    committees: '👥 ข้อมูลคณะกรรมการ',
    employees: '🧑‍💼 ข้อมูลพนักงาน',
  };

  const actions = {
    create: 'เพิ่มข้อมูล',
    update: 'แก้ไขข้อมูล',
    delete: 'ลบข้อมูล',
  };

  const title = labels[table];
  if (!title) return Promise.resolve(false);

  const identity = table === 'vehicles'
    ? `${record.plate || '-'} ${record.name || ''}`.trim()
    : record.full_name || record.name || `ID ${record.id}`;

  const details = [
    `รายการ: ${identity}`,
    `ID: ${record.id || '-'}`,
  ];

  if (table === 'vehicles') {
    details.push(
      `ผู้ขับ: ${record.driver || '-'}`,
      `สถานะ: ${record.status || '-'}`,
    );
  } else {
    details.push(
      `ตำแหน่ง: ${record.position || record.role || '-'}`,
      `แผนก: ${record.department || '-'}`,
      `เบอร์โทร: ${record.phone || '-'}`,
    );
  }

  return sendLineNotification(
    `${title}: ${actions[action] || action}`,
    details,
  );
}

/* =========================================================
   สุขอนามัยและพยาบาล
========================================================= */
const VISIT_STATUS = {
  treated: 'รักษาเบื้องต้น',
  rest: 'พักห้องพยาบาล',
  referred: 'ส่งต่อโรงพยาบาล',
  home: 'กลับบ้าน',
};

// แจ้งเตือนแบบสั้น ไม่ใส่ยา/ผลตรวจ/น้ำหนักส่วนสูง (ข้อมูลสุขภาพส่วนบุคคล)
function notifyHealthSaved(table, action, r) {
  const actions = { create: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ' };
  const act = actions[action] || action;
  if (table === 'nurse_visits') {
    return sendLineNotification(`🏥 ห้องพยาบาล: ${act}รายการ`, [
      `เลขที่: #${r.id}`,
      `นักเรียน: ${r.student || '-'} (${r.class_room || '-'})`,
      `อาการ: ${r.symptom || '-'}`,
      `ผลการดูแล: ${VISIT_STATUS[r.status] || r.status || '-'}`,
    ]);
  }
  return sendLineNotification(`🩺 ตรวจสุขภาพ: ${act}รายการ`, [
    `นักเรียน: ${r.student || '-'} (${r.class_room || '-'})`,
    `วันที่ตรวจ: ${r.date || '-'}`,
  ]);
}

/* =========================================================
   Live updates (Server-Sent Events)
========================================================= */
const clients = new Set();

const broadcast = (type, data) => {
  const message = `data: ${JSON.stringify({ type, data })}\n\n`;

  for (const res of clients) {
    try {
      res.write(message);
    } catch (err) {
      console.error('[SSE]', err.message);
      clients.delete(res);
    }
  }
};

/* =========================================================
   Work Order: ส่งใบงานเข้า LINE
========================================================= */
async function issueWorkOrder(repair) {
  if (!repair?.id) return;

  try {
    if (repair.wo_sent_at) {
      console.log(`[work-order] #${repair.id} ส่งแล้ว`);
      return;
    }

    const sent = await notifyNewRepair(repair);

    if (sent) {
      await pool.query(
        `UPDATE repairs
         SET wo_sent_at = now()
         WHERE id = $1 AND wo_sent_at IS NULL`,
        [repair.id],
      );

      console.log(`[work-order] ส่งใบงาน #${repair.id} สำเร็จ`);
    } else {
      console.warn(`[work-order] ยังส่งใบงาน #${repair.id} ไม่สำเร็จ`);
    }
  } catch (err) {
    console.error(`[work-order] #${repair.id}`, err);
  }
}

/* =========================================================
   LINE dependencies: อ่านใบงาน / บันทึกรูป / ปิดงาน
========================================================= */
const lineDeps = {
  getRepair: async (id) => {
    const { rows } = await pool.query(
      'SELECT * FROM repairs WHERE id = $1',
      [id],
    );

    return rows[0] || null;
  },

  addPhoto: async (id, buf, mime) => {
    const { rows: [exists] } = await pool.query(
      'SELECT status, approval_status FROM repairs WHERE id = $1',
      [id],
    );

    if (!exists) return null;
    // งานที่ผู้ดูแลอนุมัติปิดแล้ว ไม่รับรูปเพิ่ม
    if (exists.approval_status === 'approved' || exists.status === 'done') return null;

    const { rows: [photo] } = await pool.query(
      `INSERT INTO repair_photos (repair_id, mime, data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [id, mime, buf],
    );

    const photoUrl = `/api/photos/${photo.id}`;

    // ส่งงานแล้ว -> รอผู้ดูแลอนุมัติปิดงาน (จะเป็น "เสร็จแล้ว" ก็ต่อเมื่ออนุมัติ)
    const { rows: [repair] } = await pool.query(
      `UPDATE repairs
       SET done_photos = COALESCE(done_photos, '[]'::jsonb)
                            || to_jsonb($2::text),
           status = CASE WHEN status = 'new' THEN 'doing' ELSE status END,
           approval_status = 'submitted',
           done_at = now(),
           rejection_reason = NULL,
           reviewed_by = NULL,
           reviewed_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, photoUrl],
    );
    return repair;
  },

  onChange: (repair) => broadcast('repair_done', repair),
};

/* =========================================================
   เปลี่ยนสถานะผ่าน LINE
========================================================= */
const REPAIR_LABEL = { new: 'ใหม่', doing: 'กำลังซ่อม', done: 'เสร็จแล้ว' };
const REPAIR_ALIASES = {
  new: 'new', 'ใหม่': 'new', 'รอรับเรื่อง': 'new',
  doing: 'doing', 'กำลังซ่อม': 'doing', 'กำลังทำ': 'doing', 'รับงาน': 'doing',
  done: 'done', 'เสร็จ': 'done', 'เสร็จแล้ว': 'done', 'เสร็จสิ้น': 'done',
};
const VISIT_ALIASES = {
  treated: 'treated', 'รักษา': 'treated', 'รักษาเบื้องต้น': 'treated',
  rest: 'rest', 'พัก': 'rest', 'พักห้องพยาบาล': 'rest',
  referred: 'referred', 'ส่งต่อ': 'referred', 'ส่งต่อโรงพยาบาล': 'referred',
  home: 'home', 'กลับบ้าน': 'home',
};

async function setRepairStatus(id, status, by) {
  const { rows: [prev] } = await pool.query(
    'SELECT status, approval_status FROM repairs WHERE id = $1',
    [id],
  );
  if (!prev) return null;
  // ปิดงาน (เสร็จแล้ว) ได้เมื่อผู้ดูแลอนุมัติการส่งงานแล้วเท่านั้น
  if (status === 'done' && prev.approval_status !== 'approved') {
    return { blocked: true, approval: prev.approval_status };
  }
  // เปิดงานที่ปิดไปแล้วกลับมาทำใหม่ -> ต้องส่งงานและรออนุมัติอีกครั้ง
  const reopen = prev.status === 'done' && status !== 'done';
  const { rows: [repair] } = await pool.query(
    `UPDATE repairs
     SET status = $2::text,
         assignee = CASE WHEN $2::text = 'doing'
                         THEN COALESCE(NULLIF(assignee, ''), $3::text)
                         ELSE assignee END,
         done_at = CASE WHEN $2::text = 'done' THEN COALESCE(done_at, now())
                        WHEN $4::boolean THEN NULL
                        ELSE done_at END,
         approval_status = CASE WHEN $4::boolean THEN 'pending' ELSE approval_status END,
         approved_by = CASE WHEN $4::boolean THEN NULL ELSE approved_by END,
         approved_at = CASE WHEN $4::boolean THEN NULL ELSE approved_at END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, by, reopen],
  );
  return { repair, previous: prev.status };
}

/* =========================================================
   LINE API helpers
========================================================= */

// ตอบข้อความกลับ LINE
async function lineReply(replyToken, text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('[LINE] ไม่พบ LINE_CHANNEL_ACCESS_TOKEN');
    return false;
  }

  if (!replyToken) {
    console.warn('[LINE] ไม่มี replyToken');
    return false;
  }

  try {
    const response = await fetch(
      'https://api.line.me/v2/bot/message/reply',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [
            {
              type: 'text',
              text: String(text).slice(0, 5000),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      console.error(
        '[LINE reply]',
        response.status,
        await response.text(),
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error('[LINE reply]', err);
    return false;
  }
}

// อ่านชื่อผู้ส่ง
async function lineName(src = {}) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !src.userId) {
    return 'LINE';
  }

  try {
    const url = src.groupId
      ? `https://api.line.me/v2/bot/group/${src.groupId}/member/${src.userId}`
      : `https://api.line.me/v2/bot/profile/${src.userId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });

    if (!response.ok) {
      return 'LINE';
    }

    const profile = await response.json();
    return profile.displayName || 'LINE';
  } catch (err) {
    console.error('[LINE profile]', err.message);
    return 'LINE';
  }
}

/* =========================================================
   LINE WEBHOOK
   ต้องประกาศก่อน express.json()
========================================================= */

// ตรวจสอบ URL จาก Browser
app.get('/api/line/webhook', (_req, res) => {
  res.status(200).send('LINE Webhook endpoint is running');
});

// รับ Event จาก LINE
app.post(
  '/api/line/webhook',
  express.raw({ type: '*/*', limit: '10mb' }),
  async (req, res) => {
    try {
      if (!LINE_CHANNEL_SECRET) {
        console.error('[LINE webhook] ไม่พบ LINE_CHANNEL_SECRET');
        return res.status(500).send('LINE webhook is not configured');
      }

      if (!Buffer.isBuffer(req.body)) {
        console.error('[LINE webhook] Request body is not a Buffer');
        return res.status(400).send('Invalid request body');
      }

      const signature = req.get('x-line-signature');

      if (!signature) {
        console.warn('[LINE webhook] Missing x-line-signature');
        return res.sendStatus(401);
      }

      // ตรวจสอบ Signature จาก Raw Body
      const expected = crypto
        .createHmac('sha256', LINE_CHANNEL_SECRET)
        .update(req.body)
        .digest();

      let actual;

      try {
        actual = Buffer.from(signature, 'base64');
      } catch {
        return res.sendStatus(401);
      }

      if (
        actual.length !== expected.length ||
        !crypto.timingSafeEqual(actual, expected)
      ) {
        console.warn('[LINE webhook] Signature ไม่ถูกต้อง');
        return res.sendStatus(401);
      }

      // แปลง JSON
      let payload;

      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch (err) {
        console.error('[LINE webhook] JSON ไม่ถูกต้อง:', err.message);
        return res.status(400).send('Invalid JSON');
      }

      const events = Array.isArray(payload.events)
        ? payload.events
        : [];

      console.log(`[LINE webhook] รับ Event ${events.length} รายการ`);

      // ตอบ LINE ก่อน แล้วค่อยประมวลผล
      res.sendStatus(200);

      void processLineEvents(events);
    } catch (err) {
      console.error('[LINE webhook]', err);

      if (!res.headersSent) {
        res.sendStatus(500);
      }
    }
  },
);

/* =========================================================
   ประมวลผล LINE Events
========================================================= */
async function processLineEvents(events) {
  for (const ev of events) {
    try {
      // แสดง Group ID และ User ID ใน Terminal
      console.log('[LINE event]', {
        type: ev.type,
        sourceType: ev.source?.type,
        groupId: ev.source?.groupId,
        userId: ev.source?.userId,
        messageType: ev.message?.type,
      });

      // #ส่งงาน <id> และรูปภาพที่ส่งตามมา (จัดการใน lineWorkOrder.js)
      if (await handleLineEvent(ev, lineDeps)) {
        continue;
      }

      // คำสั่งอื่นรองรับเฉพาะข้อความ Text
      if (ev.type !== 'message' || ev.message?.type !== 'text') {
        continue;
      }

      const text = (ev.message.text || '').trim();

      if (!text) {
        continue;
      }

      // ผูกบัญชี LINE กับผู้ใช้ในระบบ (ขอรหัสจากหน้าเว็บ ใช้ในแชทส่วนตัวกับบอท)
      const linkMatch = text.match(/^#ผูกบัญชี\s+([A-Za-z0-9]{6})\s*$/);
      if (linkMatch) {
        if (ev.source?.type !== 'user') {
          await lineReply(ev.replyToken, 'กรุณาพิมพ์คำสั่งนี้ในแชทส่วนตัวกับบอท ไม่ใช่ในกลุ่ม');
          continue;
        }
        const linked = await access.linkLine(linkMatch[1].toUpperCase(), ev.source.userId);
        await lineReply(
          ev.replyToken,
          linked
            ? `✅ ผูกบัญชี LINE กับผู้ใช้ ${linked} แล้ว`
            : 'รหัสไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่จากหน้าเว็บ',
        );
        continue;
      }

      // ตรวจสอบคำสั่งก่อนเรียก LINE Profile API
      const isRepair = /^#(?:แจ้ง)?ซ่อม\s+/s.test(text);
      const isCanteen = /^#โรงอาหาร\s+/s.test(text);

      if (!isRepair && !isCanteen && !text.startsWith('#')) {
        continue;
      }

      const name = await lineName(ev.source);

      // ================================================
      // คำสั่งแจ้งซ่อม
      // ตัวอย่าง: #ซ่อม แอร์ห้อง 301 ไม่เย็น @อาคาร 3
      // ================================================
      const repairMatch = text.match(
        /^#(?:แจ้ง)?ซ่อม\s+([^@]+?)(?:\s*@\s*(.+))?$/s,
      );

      if (repairMatch) {
        const { rows } = await pool.query(
          `INSERT INTO repairs
             (title, location, reporter, source)
           VALUES ($1, $2, $3, 'line')
           RETURNING *`,
          [
            repairMatch[1].trim(),
            (repairMatch[2] || '').trim(),
            name,
          ],
        );

        broadcast('repair', rows[0]);
        void issueWorkOrder(rows[0]);

        await lineReply(
          ev.replyToken,
          `✅ รับแจ้งซ่อม #${rows[0].id}: ${rows[0].title}`,
        );

        continue;
      }

      // ================================================
      // คำสั่งบันทึกโรงอาหาร
      // ตัวอย่าง: #โรงอาหาร 5000 3200 หมายเหตุ
      // ================================================
      const canteenMatch = text.match(
        /^#โรงอาหาร\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s+(.+))?$/s,
      );

      if (canteenMatch) {
        const revenue = Number(canteenMatch[1]);
        const cost = Number(canteenMatch[2]);

        const { rows } = await pool.query(
          `INSERT INTO canteen
             (date, revenue, cost, note, reporter)
           VALUES (
             (now() AT TIME ZONE 'Asia/Bangkok')::date,
             $1, $2, $3, $4
           )
           RETURNING *`,
          [
            revenue,
            cost,
            canteenMatch[3] || '',
            name,
          ],
        );

        broadcast('canteen', rows[0]);

        const { rows: [day] } = await pool.query(
          `SELECT count(*)::int AS n, COALESCE(sum(revenue - cost), 0)::float AS profit
           FROM canteen WHERE date = $1`,
          [rows[0].date],
        );

        await lineReply(
          ev.replyToken,
          `✅ บันทึกโรงอาหารสำเร็จ (#${rows[0].id})\nรายรับ ${revenue.toLocaleString()} บาท\nรายจ่าย ${cost.toLocaleString()} บาท\nกำไร ${(revenue - cost).toLocaleString()} บาท\n\nรวมวันนี้ ${day.n} รายการ กำไร ${day.profit.toLocaleString()} บาท`,
        );

        continue;
      }

      // ================================================
      // อัปเดตสถานะงานซ่อม
      //   #รับงาน 12            -> กำลังซ่อม (+ตั้งผู้รับผิดชอบเป็นคนที่พิมพ์ ถ้ายังว่าง)
      //   #สถานะ 12 เสร็จ        -> new | doing | done (หรือ ใหม่ / กำลังซ่อม / เสร็จ)
      // ================================================
      const acceptMatch = text.match(/^#รับงาน\s+#?(\d+)\s*$/);
      const statusMatch = text.match(/^#สถานะ\s+#?(\d+)\s+(\S+)\s*$/);

      if (acceptMatch || statusMatch) {
        const id = Number((acceptMatch || statusMatch)[1]);
        const status = acceptMatch
          ? 'doing'
          : REPAIR_ALIASES[statusMatch[2].toLowerCase()];

        if (!status) {
          await lineReply(ev.replyToken, 'สถานะที่ใช้ได้: ใหม่ / กำลังซ่อม / เสร็จ\nเช่น #สถานะ 12 เสร็จ');
          continue;
        }

        const result = await setRepairStatus(id, status, name);
        if (!result) {
          await lineReply(ev.replyToken, `ไม่พบใบงาน #${id}`);
          continue;
        }

        if (result.blocked) {
          await lineReply(
            ev.replyToken,
            result.approval === 'submitted'
              ? `ใบงาน #${id} ส่งงานแล้ว กำลังรอผู้ดูแลอนุมัติปิดงาน`
              : `ใบงาน #${id} ปิดงานเองไม่ได้ ต้องส่งงานพร้อมรูป (#ส่งงาน ${id}) แล้วรอผู้ดูแลอนุมัติก่อน`,
          );
          continue;
        }

        broadcast('repair_status', result.repair);

        const lines = [
          `🔧 ใบงาน #${id}: ${result.repair.title}`,
          `สถานะ: ${REPAIR_LABEL[result.previous] || result.previous} → ${REPAIR_LABEL[status]}`,
        ];
        if (result.repair.assignee) lines.push(`ผู้รับผิดชอบ: ${result.repair.assignee}`);
        if (status === 'done' && !result.repair.done_photos?.length) {
          lines.push(`ส่งรูปงานได้โดยพิมพ์ #ส่งงาน ${id} แล้วส่งรูป`);
        }
        if (statusMatch){
          await lineReply(ev.replyToken, lines.join('\n'));
        }
        
        continue;
      }

      // ================================================
      // ห้องพยาบาล
      //   #พยาบาล สมชาย ใจดี @ม.2/3 ปวดท้อง
      //   #ผลดูแล 5 กลับบ้าน     -> รักษา | พัก | ส่งต่อ | กลับบ้าน
      // ================================================
      const nurseMatch = text.match(/^#พยาบาล\s+([^@]+?)\s*@\s*(\S+)\s+(.+)$/s);

      if (nurseMatch) {
        const { rows } = await pool.query(
          `INSERT INTO nurse_visits (date, student, class_room, symptom, reporter)
           VALUES ((now() AT TIME ZONE 'Asia/Bangkok')::date, $1, $2, $3, $4)
           RETURNING *`,
          [nurseMatch[1].trim(), nurseMatch[2].trim(), nurseMatch[3].trim(), name],
        );

        broadcast('nurse', rows[0]);

        await lineReply(
          ev.replyToken,
          `✅ บันทึกห้องพยาบาล #${rows[0].id}\n${rows[0].student} (${rows[0].class_room})\nอาการ: ${rows[0].symptom}\nอัปเดตผล: #ผลดูแล ${rows[0].id} กลับบ้าน`,
        );
        continue;
      }

      const careMatch = text.match(/^#ผลดูแล\s+#?(\d+)\s+(\S+)\s*$/);

      if (careMatch) {
        const status = VISIT_ALIASES[careMatch[2].toLowerCase()];
        if (!status) {
          await lineReply(ev.replyToken, 'ผลการดูแลที่ใช้ได้: รักษา / พัก / ส่งต่อ / กลับบ้าน');
          continue;
        }
        const { rows } = await pool.query(
          'UPDATE nurse_visits SET status = $2 WHERE id = $1 RETURNING *',
          [Number(careMatch[1]), status],
        );
        if (!rows[0]) {
          await lineReply(ev.replyToken, `ไม่พบรายการห้องพยาบาล #${careMatch[1]}`);
          continue;
        }
        broadcast('nurse', rows[0]);
        await lineReply(
          ev.replyToken,
          `✅ #${rows[0].id} ${rows[0].student}: ${VISIT_STATUS[status]}`,
        );
        continue;
      }

      // ================================================
      // ตรวจสุขภาพ
      //   #ตรวจสุขภาพ สมชาย ใจดี @ม.2/3 45 158 หมายเหตุ
      //   (น้ำหนักกก. ส่วนสูงซม.)
      // ================================================
      const checkMatch = text.match(
        /^#ตรวจสุขภาพ\s+([^@]+?)\s*@\s*(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s+(.+))?$/s,
      );

      if (checkMatch) {
        const { rows } = await pool.query(
          `INSERT INTO health_checks (date, student, class_room, weight, height, note, reporter)
           VALUES ((now() AT TIME ZONE 'Asia/Bangkok')::date, $1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            checkMatch[1].trim(), checkMatch[2].trim(),
            Number(checkMatch[3]), Number(checkMatch[4]),
            checkMatch[5] || '', name,
          ],
        );
        broadcast('health_check', rows[0]);
        await lineReply(
          ev.replyToken,
          `✅ บันทึกตรวจสุขภาพ\n${rows[0].student} (${rows[0].class_room})\nน้ำหนัก ${checkMatch[3]} กก. ส่วนสูง ${checkMatch[4]} ซม.`,
        );
        continue;
      }

      // รูปแบบคำสั่งไม่ถูกต้อง
      if (text.startsWith('#')) {
        await lineReply(
          ev.replyToken,
          [
            'รูปแบบข้อความ:',
            '#ซ่อม รายละเอียด @สถานที่',
            '#รับงาน เลขที่ใบงาน',
            '#สถานะ เลขที่ใบงาน ใหม่|กำลังซ่อม|เสร็จ',
            '#ส่งงาน เลขที่ใบงาน (แล้วส่งรูป รอผู้ดูแลอนุมัติปิดงาน)',
            '#โรงอาหาร รายรับ รายจ่าย หมายเหตุ',
            '#ผูกบัญชี รหัส6ตัว (ขอรหัสจากหน้าเว็บ ใช้ในแชทส่วนตัว)',
            '#พยาบาล ชื่อ @ชั้น อาการ',
            '#ผลดูแล เลขที่ รักษา|พัก|ส่งต่อ|กลับบ้าน',
            '#ตรวจสุขภาพ ชื่อ @ชั้น น้ำหนัก ส่วนสูง',
          ].join('\n'),
        );
      }
    } catch (err) {
      console.error('[LINE event processing]', err);
    }
  }
}

/* =========================================================
   JSON middleware
   อยู่หลัง LINE Webhook เพื่อรักษา Raw Body
========================================================= */
app.use(express.json({ limit: '10mb' }));

/* =========================================================
   Authentication
========================================================= */
/* ---------- รหัสผ่าน (scrypt ในตัว Node ไม่ต้องติดตั้งเพิ่ม) ---------- */
const scrypt = (pw, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(pw, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

async function verifyLogin(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  try {
    const { rows: [u] } = await pool.query(
      'SELECT password_hash, active FROM users WHERE username = $1',
      [username],
    );
    // บัญชีที่ผู้ดูแลปิดใช้งาน ล็อกอินไม่ได้
    if (u && u.active === false) return false;
    // เคยเปลี่ยนรหัสผ่านในระบบแล้ว -> ใช้รหัสในฐานข้อมูล
    if (u?.password_hash) return checkPassword(password, u.password_hash);
  } catch (err) {
    // ตาราง users ยังไม่ถูกสร้าง (ยังไม่ได้รัน initdb) -> ไม่ให้ล็อกอินพัง
    console.warn('[login] อ่านตาราง users ไม่ได้ ใช้ ADMIN_USER/ADMIN_PASS แทน:', err.code || err.message);
  }
  return username === ADMIN_USER && password === ADMIN_PASS;
}

// จำกัดจำนวนครั้งล็อกอินผิดต่อ IP (กัน brute force)
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // ip -> { n, reset }

setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of loginFails) {
    if (f.reset <= now) loginFails.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip || 'unknown';
  const fail = loginFails.get(ip);

  if (fail && fail.reset > Date.now() && fail.n >= LOGIN_MAX_FAILS) {
    return res.status(429).json({
      error: 'ล็อกอินผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    });
  }

  if (!(await verifyLogin(username, password))) {
    const f = fail && fail.reset > Date.now()
      ? fail
      : { n: 0, reset: Date.now() + LOGIN_WINDOW_MS };
    f.n += 1;
    loginFails.set(ip, f);

    return res.status(401).json({
      error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    });
  }

  loginFails.delete(ip);

  res.json({
    token: jwt.sign({ u: username }, JWT_SECRET, {
      expiresIn: '7d',
    }),
  });
});

const auth = (req, res, next) => {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : req.query.token;

    if (!token) {
      return res.sendStatus(401);
    }

    req.username = jwt.verify(token, JWT_SECRET).u;
    next();
  } catch {
    res.sendStatus(401);
  }
};

/* =========================================================
   โปรไฟล์ผู้ใช้ (ชื่อ ตำแหน่ง เบอร์ติดต่อ รูป รหัสผ่าน)
========================================================= */
const PROFILE_MAX = { display_name: 80, job_title: 80, phone: 30, email: 120, line_id: 60, note: 500 };
const PROFILE_SELECT = `
  SELECT username, display_name, job_title, phone, email, line_id, note,
         (avatar_data IS NOT NULL) AS has_avatar, avatar_v,
         (line_user_id IS NOT NULL) AS line_linked
  FROM users WHERE username = $1`;

async function loadProfile(username) {
  // ผู้ใช้จาก .env ยังไม่มีแถวในตาราง -> สร้างให้ครั้งแรกที่เปิดโปรไฟล์
  await pool.query(
    'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO NOTHING',
    [username],
  );
  return (await pool.query(PROFILE_SELECT, [username])).rows[0];
}

const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

app.get('/api/me', auth, async (req, res) => {
  res.json({
    ...(await loadProfile(req.username)),
    is_admin: req.username === ADMIN_USER,
    ...(await (async () => {
      const acc = await access.getAccess(req.username);
      return acc
        ? { role: acc.role, permissions: acc.perms, is_admin: acc.isAdmin }
        : {};
    })()),
  });
});

app.put('/api/me', auth, async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const values = [req.username];

  for (const [field, max] of Object.entries(PROFILE_MAX)) {
    if (body[field] === undefined) continue;
    const value = String(body[field] ?? '').trim();
    if (value.length > max) {
      return res.status(400).json({ error: 'ข้อมูลยาวเกินกำหนด' });
    }
    if (field === 'email' && value && !/^\S+@\S+\.\S+$/.test(value)) {
      return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }
    if (field === 'phone' && !/^[0-9+\-()\s#,.]*$/.test(value)) {
      return res.status(400).json({ error: 'เบอร์โทรใช้ได้เฉพาะตัวเลขและ + - ( )' });
    }
    values.push(value);
    sets.push(`${field} = $${values.length}`);
  }

  await loadProfile(req.username);
  if (sets.length) {
    await pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE username = $1`,
      values,
    );
  }
  res.json((await pool.query(PROFILE_SELECT, [req.username])).rows[0]);
});

app.get('/api/me/avatar', auth, async (req, res) => {
  const { rows: [u] } = await pool.query(
    'SELECT avatar_mime, avatar_data FROM users WHERE username = $1',
    [req.username],
  );
  if (!u?.avatar_data) return res.sendStatus(404);

  res.set({
    'Content-Type': u.avatar_mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable', // เปลี่ยนรูป = เปลี่ยนค่า ?v=
  });
  res.send(u.avatar_data);
});

app.put('/api/me/avatar', auth, async (req, res) => {
  const { mime, data } = req.body || {};
  const check = IMAGE_SIGNATURES[mime];
  if (!check || typeof data !== 'string') {
    return res.status(400).json({ error: 'รองรับเฉพาะรูป JPG, PNG หรือ WebP' });
  }

  const buf = Buffer.from(data, 'base64');
  if (buf.length < 12 || !check(buf)) {
    return res.status(400).json({ error: 'ไฟล์รูปไม่ถูกต้อง' });
  }
  if (buf.length > 1_000_000) {
    return res.status(400).json({ error: 'รูปใหญ่เกิน 1 MB' });
  }

  await loadProfile(req.username);
  await pool.query(
    `UPDATE users
     SET avatar_mime = $2, avatar_data = $3,
         avatar_v = extract(epoch FROM now())::int, updated_at = now()
     WHERE username = $1`,
    [req.username, mime, buf],
  );
  res.json((await pool.query(PROFILE_SELECT, [req.username])).rows[0]);
});

app.delete('/api/me/avatar', auth, async (req, res) => {
  await pool.query(
    `UPDATE users
     SET avatar_mime = NULL, avatar_data = NULL,
         avatar_v = extract(epoch FROM now())::int, updated_at = now()
     WHERE username = $1`,
    [req.username],
  );
  res.sendStatus(204);
});

// หมายเหตุ: รหัสผ่านเดิมผิดต้องตอบ 400 (ไม่ใช่ 401) ไม่เช่นนั้นหน้าเว็บจะเด้งออกจากระบบ
app.post('/api/me/password', auth, async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || typeof next !== 'string') {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }
  if (next.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
  if (!(await verifyLogin(req.username, current))) {
    return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }

  await loadProfile(req.username);
  await pool.query(
    'UPDATE users SET password_hash = $2, updated_at = now() WHERE username = $1',
    [req.username, await hashPassword(next)],
  );
  res.json({ ok: true });
});

/* =========================================================
   Server-Sent Events
========================================================= */
app.get('/api/events', auth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.flushHeaders();
  clients.add(res);

  const ping = setInterval(() => {
    if (!res.destroyed) {
      res.write(': ping\n\n');
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

/* =========================================================
   รูปงานซ่อม
========================================================= */
app.get('/api/photos/:id', (req, res, next) => {
  try {
    // token รูปผูกกับ id ของรูปแต่ละรูป
    const p = jwt.verify(String(req.query.pt || ''), PHOTO_SECRET);
    if (String(p.pid) === String(req.params.id)) return next();
  } catch { /* ไม่มี photo token -> ใช้ Bearer ปกติ */ }
  return auth(req, res, next);
}, async (req, res) => {
  const { rows: [photo] } = await pool.query(
    'SELECT mime, data FROM repair_photos WHERE id = $1',
    [req.params.id],
  );

  if (!photo) {
    return res.sendStatus(404);
  }

  res.set({
    'Content-Type': photo.mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
  });

  res.send(photo.data);
});

/* =========================================================
   CRUD resources
========================================================= */
const resources = {
  repairs: [
    'title',
    'location',
    'detail',
    'status',
    'reporter',
    'assignee',
    'due_date',
    'inspector_username',
  ],
  // ชื่อคอลัมน์ต้องตรงกับตารางใน schema.sql (full_name, notes)
  committees: [
    'full_name',
    'position',
    'department',
    'phone',
    'email',
    'term_start',
    'term_end',
    'status',
    'notes',
  ],

  employees: [
    'employee_code',
    'full_name',
    'position',
    'department',
    'phone',
    'email',
    'status',
    'notes',
  ],
  canteen: ['date', 'revenue', 'cost', 'shop', 'note', 'reporter'],
  vehicles: [
    'plate',
    'name',
    'driver',
    'status',
    'mileage',
    'next_service',
    'check_date',
    'check_tires',
    'check_lights',
    'check_brakes',
    'check_fluids',
    'check_equipment',
    'ready_status',
    'check_note',
    'note',
  ],
  workers: ['name', 'role', 'phone', 'active', 'license_no', 'license_expiry', 'emergency_contact', 'note'],
  nurse_visits: ['date', 'student', 'class_room', 'symptom', 'treatment', 'status', 'reporter'],
  health_checks: ['date', 'student', 'class_room', 'weight', 'height', 'note', 'reporter'],
  buildings: ['code', 'name', 'location', 'description', 'status'],
  store_items: ['name', 'category', 'qty', 'unit', 'min_qty', 'location', 'note'],
};

// ตารางที่ต้องเซ็ต updated_at ทุกครั้งที่แก้ไข
const touchUpdatedAt = new Set([
  'repairs',
  'store_items',
  'committees',
  'employees',
]);

const allowedStatus = {
  repairs: ['new', 'doing', 'done'],
  vehicles: ['available', 'in_use', 'repair'],
  nurse_visits: ['treated', 'rest', 'referred', 'home'],
  buildings: ['active', 'inactive'],
  // ต้องเป็นตัวพิมพ์ใหญ่ ตรงกับหน้าเว็บและ CHECK ใน schema.sql
  committees: ['ACTIVE', 'EXPIRED', 'INACTIVE'],
  employees: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'],
};

// รูปงานซ่อมเป็น <img src> ส่ง header ไม่ได้ -> แนบ token อายุสั้นที่ผูกกับรูปนั้นๆ เท่านั้น
const signPhoto = (u, pid) =>
  jwt.sign({ u, pid: String(pid) }, PHOTO_SECRET, { expiresIn: '1d' });

function withPhotoTokens(table, row, username) {
  if (PERSON_TABLES.includes(table)) return personRow(table, row);
  if (table !== 'repairs' || !row || !Array.isArray(row.done_photos)) return row;
  return {
    ...row,
    done_photos: row.done_photos.map((u) => {
      const url = String(u);
      if (url.includes('?')) return url;
      const m = url.match(/\/api\/photos\/(\d+)/);
      return m ? `${url}?pt=${signPhoto(username, m[1])}` : url;
    }),
  };
}

/* =========================================================
   Building Images — รูปภาพอาคาร
========================================================= */

const BUILDING_IMAGE_MAX = 1_000_000;

// ใช้ token แยกสำหรับเปิดรูปผ่าน <img src="...">
// ไม่ต้องส่ง Authorization header จาก browser
const BUILDING_IMAGE_SECRET = `${JWT_SECRET}:building-image`;

const signBuildingImage = (id) =>
  jwt.sign(
    { id: Number(id), type: 'building-image' },
    BUILDING_IMAGE_SECRET,
    { expiresIn: '1d' },
  );

// GET: อ่านรูปอาคาร
app.get('/api/buildings/:id/image', async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'รหัสอาคารไม่ถูกต้อง' });
  }

  // ตรวจสอบ token สำหรับแสดงรูป หรือใช้ Bearer token ปกติ
  let authorized = false;

  try {
    const payload = jwt.verify(
      String(req.query.pt || ''),
      BUILDING_IMAGE_SECRET,
    );

    authorized =
      payload.type === 'building-image' &&
      Number(payload.id) === id;
  } catch {
    // ถ้าไม่มี token รูป ให้ตรวจสอบ Bearer token ต่อ
  }

  if (!authorized) {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ')
      ? header.slice(7)
      : req.query.token;

    try {
      if (bearer) {
        jwt.verify(String(bearer), JWT_SECRET);
        authorized = true;
      }
    } catch {
      // ไม่มีสิทธิ์เข้าถึง
    }
  }

  if (!authorized) return res.sendStatus(401);

  const { rows: [building] } = await pool.query(
    `SELECT image_mime, image_data
     FROM buildings
     WHERE id = $1`,
    [id],
  );

  if (!building?.image_data) {
    return res.sendStatus(404);
  }

  res.set({
    'Content-Type': building.image_mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  });

  res.send(building.image_data);
});

// PUT: เพิ่มหรือเปลี่ยนรูปอาคาร
app.put('/api/buildings/:id/image', auth, async (req, res) => {
  if (!access.can(await access.getAccess(req.username), 'buildings', 'write')) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์จัดการรูปอาคาร' });
  }

  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'รหัสอาคารไม่ถูกต้อง' });
  }

  const { mime, data } = req.body || {};
  const check = IMAGE_SIGNATURES[mime];

  if (!check || typeof data !== 'string') {
    return res.status(400).json({
      error: 'รองรับเฉพาะรูป JPG, PNG หรือ WebP',
    });
  }

  // ป้องกัน Base64 ที่ใหญ่เกินไปก่อนแปลง Buffer
  if (data.length > Math.ceil(BUILDING_IMAGE_MAX * 4 / 3) + 8) {
    return res.status(413).json({ error: 'รูปใหญ่เกิน 1 MB' });
  }

  const buf = Buffer.from(data, 'base64');

  if (
    buf.length < 12 ||
    buf.length > BUILDING_IMAGE_MAX ||
    buf.toString('base64') !== data ||
    !check(buf)
  ) {
    return res.status(400).json({
      error: 'ไฟล์รูปไม่ถูกต้อง หรือมีขนาดเกิน 1 MB',
    });
  }

  const { rows: [building] } = await pool.query(
    `UPDATE buildings
     SET image_mime = $2,
         image_data = $3,
         image_v = image_v + 1
     WHERE id = $1
     RETURNING id, code, name, image_v,
               (image_data IS NOT NULL) AS has_image`,
    [id, mime, buf],
  );

  if (!building) {
    return res.status(404).json({ error: 'ไม่พบอาคาร' });
  }

  broadcast('refresh', { table: 'buildings' });
  res.json(building);
});

// DELETE: ลบรูปอาคาร
app.delete('/api/buildings/:id/image', auth, async (req, res) => {
  if (!access.can(await access.getAccess(req.username), 'buildings', 'write')) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์จัดการรูปอาคาร' });
  }

  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'รหัสอาคารไม่ถูกต้อง' });
  }

  const { rowCount } = await pool.query(
    `UPDATE buildings
     SET image_mime = NULL,
         image_data = NULL,
         image_v = image_v + 1
     WHERE id = $1`,
    [id],
  );

  if (!rowCount) {
    return res.status(404).json({ error: 'ไม่พบอาคาร' });
  }

  broadcast('refresh', { table: 'buildings' });
  res.sendStatus(204);
});

const order = {
  buildings: 'id',
  store_items: 'name',
  repairs: 'id DESC',
  canteen: 'date DESC, id DESC',
  vehicles: 'id',
  workers: 'id',
  nurse_visits: 'date DESC, id DESC',
  health_checks: 'date DESC, id DESC',
  committees: 'id DESC',
  employees: 'id DESC',
};

/* =========================================================
   อนุมัติปิดงานซ่อม
   APPROVE = ส่ง Flex Card แจ้งอนุมัติ
   REJECT  = ส่ง Flex Card แจ้งส่งกลับแก้ไข
========================================================= */
app.post('/api/repairs/:id/approval', auth, async (req, res) => {
  try {
    // อนุญาตเฉพาะผู้ดูแลระบบ
    const acc = await access.getAccess(req.username);
    if (!access.can(acc, 'repairs', 'approve')) {
      return res.status(403).json({
        error: 'เฉพาะผู้ดูแลระบบหรือผู้ตรวจงานเท่านั้นที่อนุมัติปิดงานได้',
      });
    }

    const id = Number(req.params.id);
    const action = String(req.body?.action || '')
      .trim()
      .toLowerCase();
    const reason = String(req.body?.reason || '').trim();

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        error: 'เลขที่ใบงานไม่ถูกต้อง',
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        error: 'action ต้องเป็น approve หรือ reject',
      });
    }

    if (action === 'reject' && !reason) {
      return res.status(400).json({
        error: 'กรุณาระบุเหตุผลที่ต้องแก้ไข',
      });
    }

    // ตรวจสอบใบงาน
    const { rows: [current] } = await pool.query(
      'SELECT * FROM repairs WHERE id = $1',
      [id],
    );

    if (!current) {
      return res.status(404).json({
        error: 'ไม่พบใบงาน',
      });
    }

    // ผู้ตรวจอนุมัติได้เฉพาะงานที่ตนเองเป็นผู้ตรวจ (admin อนุมัติได้ทุกงาน)
    const approveScope = access.scopeOf(acc);
    if (approveScope && current.inspector_username !== approveScope) {
      return res.status(403).json({
        error: 'งานนี้ไม่ได้มอบหมายให้คุณเป็นผู้ตรวจ',
      });
    }

    if (current.approval_status !== 'submitted') {
      return res.status(409).json({
        error: 'ใบงานนี้ยังไม่ได้ส่งงาน หรือได้รับการพิจารณาแล้ว กรุณารีเฟรชข้อมูล',
      });
    }

    // บันทึกผลอนุมัติลงฐานข้อมูล
    const sql = action === 'approve'
      ? `
        UPDATE repairs
        SET approval_status = 'approved',
            approved_by = $2,
            approved_at = NOW(),
            reviewed_by = $2,
            reviewed_at = NOW(),
            rejection_reason = NULL,
            status = 'done',
            done_at = COALESCE(done_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
          AND approval_status = 'submitted'
        RETURNING *
      `
      : `
        UPDATE repairs
        SET approval_status = 'rejected',
            reviewed_by = $2,
            reviewed_at = NOW(),
            rejection_reason = $3,
            approved_by = NULL,
            approved_at = NULL,
            status = 'doing',
            done_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND approval_status = 'submitted'
        RETURNING *
      `;

    const values = action === 'approve'
      ? [id, req.username]
      : [id, req.username, reason];

    const { rows: [repair] } = await pool.query(sql, values);

    if (!repair) {
      return res.status(409).json({
        error: 'ใบงานนี้ถูกพิจารณาไปแล้ว กรุณารีเฟรชข้อมูล',
      });
    }

    // แจ้งหน้าเว็บให้อัปเดตข้อมูล
    broadcast('repair_approval', repair);

    // ตอบกลับหน้าเว็บทันทีหลังบันทึกข้อมูลสำเร็จ
    res.json(
      withPhotoTokens('repairs', repair, req.username),
    );

    // ส่ง Flex Card ไป LINE แบบไม่ขวางการตอบกลับหน้าเว็บ
    try {
      let sent = false;

      if (action === 'approve') {
        sent = await notifyRepairApproved(
          repair,
          req.username,
        );
      } else {
        sent = await notifyRepairRejected(
          repair,
          reason,
          req.username,
        );
      }

      if (sent) {
        console.log(
          `[LINE approval] ส่งการ์ด ${
            action === 'approve' ? 'อนุมัติ' : 'ส่งกลับแก้ไข'
          } ใบงาน #${repair.id} สำเร็จ`,
        );
      } else {
        console.error(
          `[LINE approval] ส่ง Flex Card ใบงาน #${repair.id} ไม่สำเร็จ กรุณาตรวจสอบ LINE Token และ LINE_TARGET_ID`,
        );
      }
    } catch (lineError) {
      console.error(
        `[LINE approval] เกิดข้อผิดพลาดในการส่งการ์ดใบงาน #${repair.id}:`,
        lineError?.message || lineError,
      );
    }
  } catch (error) {
    console.error('[Repair approval] Error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'ไม่สามารถดำเนินการอนุมัติใบงานได้',
      });
    }
  }
});

/* =========================================================
   API compatibility aliases
   ให้หน้า GeneralManagement.jsx ใช้ URL เดิมได้
   ต้องอยู่ "ก่อน" การลงทะเบียน CRUD routes ด้านล่าง
   ไม่เช่นนั้น req.url ที่แก้จะไม่ถูกส่งไปที่ route เหล่านั้น
========================================================= */
app.use((req, res, next) => {
  // หน้า GeneralManagement.jsx เรียก /api/general-management/committees
  if (/^\/api\/general-management\/committees(?=\/|$)/.test(req.url)) {
    req.url = req.url.replace(
      /^\/api\/general-management\/committees(?=\/|$)/,
      '/api/committees',
    );
  }

  // รองรับ URL ของพนักงาน
  if (/^\/api\/general-management\/employees(?=\/|$)/.test(req.url)) {
    req.url = req.url.replace(
      /^\/api\/general-management\/employees(?=\/|$)/,
      '/api/employees',
    );
  }

  next();
});

/* บทบาท/สิทธิ์ (ต้องอยู่หลัง alias และก่อนทุก route ของข้อมูล) — ดู access.js */
const access = registerAccess(app, {
  pool,
  broadcast,
  hashPassword,
  adminUser: ADMIN_USER,
  notify: sendLineNotification,
});

/* รูปคณะกรรมการ / พนักงาน — ดู personPhotos.js */
registerPersonPhotos(app, { pool, auth, broadcast });

/* งานประจำวันแม่บ้าน/คนสวน (งานประจำ + ตรวจรายวัน + KPI) — ดู dailyTasks.js */
registerDailyTasks(app, {
  pool,
  auth,
  broadcast,
  isAdminUser: (username) => username === ADMIN_USER,
});

/* ไฟล์ที่ผู้ใช้ส่งถึง Admin (หน้าธุรการ) — ดู adminSubmissions.js */
registerAdminSubmissions(app, {
  pool,
  auth,
  broadcast,
  // LINE notification intentionally omitted: only repair workflows notify LINE
  getAccess: (u) => access.getAccess(u),
});

// รายชื่อพนักงานส่วนกลางสำหรับ Dropdown ในแบบฟอร์มงานต่าง ๆ
// ส่งเฉพาะข้อมูลจำเป็น ไม่เปิดเผยเบอร์โทร/อีเมล/หมายเหตุส่วนตัวให้ทุกแผนก
app.get('/api/employee-options', auth, async (req, res) => {
  const acc = await access.getAccess(req.username);
  const allowedModules = ['general', 'repairs', 'vehicles', 'workers', 'housekeeping', 'gardening'];
  const allowed = allowedModules.some((module) => access.can(acc, module, 'read'));

  if (!allowed) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูรายชื่อพนักงานสำหรับเลือกผู้รับผิดชอบ' });
  }

  const { rows } = await pool.query(
    `SELECT id, employee_code, full_name, position, department, status
     FROM employees
     WHERE status = 'ACTIVE'
     ORDER BY full_name ASC
     LIMIT 1000`,
  );

  res.json(rows);
});

// รายชื่อคณะกรรมการที่ใช้งาน สำหรับช่องผู้แจ้งในแบบฟอร์มงานซ่อม
app.get('/api/committee-options', auth, async (req, res) => {
  try {
    const acc = await access.getAccess(req.username);
    const allowed = access.can(acc, 'repairs', 'read') || access.can(acc, 'committees', 'read');

    if (!allowed) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูรายชื่อคณะกรรมการสำหรับแจ้งซ่อม' });
    }

    const { rows } = await pool.query(
      `SELECT id, full_name, position, department, status
       FROM committees
       WHERE status = 'ACTIVE'
       ORDER BY full_name ASC
       LIMIT 1000`,
    );

    res.json(rows);
  } catch (error) {
    console.error('โหลดรายชื่อคณะกรรมการสำหรับแจ้งซ่อมไม่สำเร็จ:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดรายชื่อคณะกรรมการได้' });
  }
});

for (const [table, cols] of Object.entries(resources)) {
  const pick = (body = {}) =>
    cols
      .filter((col) => body[col] !== undefined)
      .map((col) => [
        col,
        body[col] === '' ? null : body[col],
      ]);
  const badStatus = (body = {}) =>
    Boolean(
      allowedStatus[table] &&
      body.status !== undefined &&
      body.status !== '' &&
      !allowedStatus[table].includes(body.status)
    );

  // จำกัดสิทธิ์เพิ่ม/แก้ไข/ลบข้อมูลคณะกรรมการและพนักงานเฉพาะ Admin
  // สิทธิ์ตรวจที่ access.js แล้ว (ตามบทบาทและเมนูที่กำหนด)
  const requireAdmin = () => true;

  // READ
  app.get(`/api/${table}`, auth, async (req, res) => {
    if (table === 'buildings') {
      // ไม่ส่ง image_data (bytea) ออกไป ส่งเฉพาะ URL ของรูป
      const { rows } = await pool.query(
        `SELECT id, code, name, location, description, status,
                created_at,
                (image_data IS NOT NULL) AS has_image,
                image_v
         FROM buildings
         ORDER BY ${order[table]}
         LIMIT 500`,
      );

      return res.json(rows.map((row) => ({
        ...row,
        image_url: row.has_image
          ? `/api/buildings/${row.id}/image?pt=${signBuildingImage(row.id)}`
          : null,
      })));
    }

    // ผู้ตรวจเห็นเฉพาะงานที่ได้รับมอบหมาย (งานซ่อม) admin เห็นทั้งหมด
    const scopeUser = access.scopeUser(req, table);
    const { rows } = await pool.query(
      `SELECT * FROM ${table}
       ${scopeUser ? 'WHERE inspector_username = $1' : ''}
       ORDER BY ${order[table]}
       LIMIT 500`,
      scopeUser ? [scopeUser] : [],
    );

    res.json(rows.map((r) => withPhotoTokens(table, r, req.username)));
  });

  // CREATE
  app.post(`/api/${table}`, auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;

    if (badStatus(req.body)) {
      return res.status(400).json({ error: 'ค่าสถานะไม่ถูกต้อง' });
    }
    const fields = pick(req.body);

    if (!fields.length) {
      return res.status(400).json({
        error: 'ไม่พบข้อมูลสำหรับบันทึก',
      });
    }

    const columns = fields.map(([col]) => col);
    const placeholders = fields.map((_, i) => `$${i + 1}`);
    const values = fields.map(([, value]) => value);

    const { rows } = await pool.query(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING *`,
      values,
    );

    res.json(withPhotoTokens(table, rows[0], req.username));

    // ให้หน้าเว็บของทุกคนโหลดข้อมูลใหม่
    if (table === 'repairs') broadcast('repair', rows[0]);
    else if (table === 'nurse_visits') broadcast('nurse', rows[0]);
    else if (table === 'health_checks') broadcast('health_check', rows[0]);
    else if (table === 'canteen') broadcast('canteen', rows[0]);
    else broadcast('refresh', { table });

    // แจ้งเตือน LINE หลังบันทึกข้อมูลสำเร็จ
    if (table === 'repairs') {
      // งานซ่อมใหม่: ส่งใบงานเข้า LINE ทันที (ไม่ต้องรออนุมัติ อนุมัติตอนส่งงาน)
      void issueWorkOrder(rows[0]);
    } else if (table === 'canteen') {
    } else if (['vehicles', 'workers', 'committees', 'employees'].includes(table)) {
    } else if (table === 'nurse_visits' || table === 'health_checks') {
    }
  });

  // UPDATE
  app.put(`/api/${table}/:id`, auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;

    if (badStatus(req.body)) {
      return res.status(400).json({ error: 'ค่าสถานะไม่ถูกต้อง' });
    }
    const fields = pick(req.body);

    if (!fields.length) {
      return res.status(400).json({
        error: 'ไม่พบข้อมูลสำหรับแก้ไข',
      });
    }

    // อ่านสถานะเดิมก่อน UPDATE เพื่อแจ้งเตือนเฉพาะเมื่อสถานะงานซ่อมเปลี่ยนจริง
    const previousRepair = table === 'repairs'
      ? (await pool.query(
          'SELECT status, approval_status FROM repairs WHERE id = $1',
          [req.params.id],
        )).rows[0]
      : null;

    // ปิดงาน (เสร็จแล้ว) ได้เมื่อผู้ดูแลอนุมัติการส่งงานแล้วเท่านั้น
    if (
      table === 'repairs' &&
      previousRepair &&
      req.body?.status === 'done' &&
      previousRepair.approval_status !== 'approved'
    ) {
      return res.status(409).json({
        error: 'ปิดงานได้เมื่อผู้ดูแลอนุมัติการส่งงานแล้วเท่านั้น (ให้ผู้รับผิดชอบส่งงานแนบรูปทางไลน์ก่อน)',
      });
    }

    const setSql = fields.map(
      ([col], i) => `${col} = $${i + 1}`,
    );

    if (touchUpdatedAt.has(table)) setSql.push('updated_at = now()');

    // แก้ไขรายการโรงอาหาร = ต้องให้ผู้ตรวจตรวจสอบใหม่
    if (table === 'canteen') {
      setSql.push('verified = false', 'verified_by = NULL', 'verified_at = NULL');
    }

    if (table === 'repairs' && req.body?.status !== undefined) {
      if (req.body.status === 'done') {
        setSql.push('done_at = COALESCE(done_at, now())');
      } else if (previousRepair?.status === 'done') {
        // เปิดงานที่ปิดแล้วกลับมาทำใหม่ -> ต้องส่งงานและรออนุมัติอีกครั้ง
        setSql.push(
          'done_at = NULL',
          "approval_status = 'pending'",
          'approved_by = NULL',
          'approved_at = NULL',
          'reviewed_by = NULL',
          'reviewed_at = NULL',
        );
      }
    }

    const values = fields.map(([, value]) => value);
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE ${table}
       SET ${setSql.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      values,
    );

    if (!rows[0]) {
      return res.sendStatus(404);
    }

    res.json(withPhotoTokens(table, rows[0], req.username));

    if (table === 'repairs') {
      if (previousRepair && previousRepair.status !== rows[0].status) {
        broadcast('repair_status', rows[0]);
      } else {
        broadcast('refresh', { table });
      }
    } else if (table === 'nurse_visits') broadcast('nurse', rows[0]);
    else if (table === 'health_checks') broadcast('health_check', rows[0]);
    else broadcast('refresh', { table });

    // แจ้งเตือนเมื่อสถานะงานซ่อมเปลี่ยน
    if (
      table === 'repairs' &&
      previousRepair &&
      previousRepair.status !== rows[0].status
    ) {
      void notifyRepairStatusChanged(rows[0], previousRepair.status);
    }

    if (table === 'canteen') {
    } else if (['vehicles', 'workers', 'committees', 'employees'].includes(table)) {
    } else if (table === 'nurse_visits' || table === 'health_checks') {
    }

    // ส่งใบงานเมื่อมีผู้รับผิดชอบและยังไม่เคยส่ง (ระบบเดิม)
    if (
      table === 'repairs' &&
      rows[0].assignee &&
      !rows[0].wo_sent_at
    ) {
      void issueWorkOrder(rows[0]);
    }
  });

  // DELETE
  app.delete(`/api/${table}/:id`, auth, async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { rows } = await pool.query(
      `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
      [req.params.id],
    );

    if (!rows[0]) {
      return res.sendStatus(404);
    }

    res.sendStatus(204);
    broadcast('refresh', { table });

    if (['vehicles', 'workers', 'committees', 'employees'].includes(table)) {
    } else if (table === 'nurse_visits' || table === 'health_checks') {
    }
  });
}

/* =========================================================
   Dashboard statistics
========================================================= */
app.get('/api/stats', auth, async (_req, res) => {
  const queryOne = async (sql) =>
    (await pool.query(sql)).rows[0];

  const repairs = await queryOne(`
    SELECT
      count(*) FILTER (WHERE status = 'new')::int AS repairs_new,
      count(*) FILTER (WHERE status = 'doing')::int AS repairs_doing
    FROM repairs
  `);

  const canteen = await queryOne(`
    SELECT COALESCE(sum(revenue - cost), 0)::float AS profit_month
    FROM canteen
    WHERE date_trunc('month', date) =
          date_trunc('month', CURRENT_DATE)
  `);

  const vehicles = await queryOne(`
    SELECT
      count(*)::int AS vehicles_total,
      count(*) FILTER (WHERE status = 'available')::int AS vehicles_free
    FROM vehicles
  `);

  const workers = await queryOne(`
    SELECT count(*)::int AS workers_active
    FROM workers
    WHERE active
  `);

  const nurse = await queryOne(`
    SELECT count(*)::int AS nurse_today
    FROM nurse_visits
    WHERE date = (now() AT TIME ZONE 'Asia/Bangkok')::date
  `);

  res.json({
    ...nurse,
    ...repairs,
    ...canteen,
    ...vehicles,
    ...workers,
  });
});

/* =========================================================
   KPI สำหรับกราฟในหน้า Dashboard
========================================================= */
app.get('/api/kpi', auth, async (_req, res) => {
  const q = async (sql) => (await pool.query(sql)).rows;
  const BKK = `(now() AT TIME ZONE 'Asia/Bangkok')`;
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.n]));

  const [
    repairStatus, repairMonthly, repairKpi, canteenMonthly,
    nurseDaily, nurseOutcome, vehicleStatus, service,
  ] = await Promise.all([
    q(`SELECT status, count(*)::int AS n FROM repairs GROUP BY status`),

    q(`SELECT to_char(m, 'YYYY-MM') AS month,
         (SELECT count(*) FROM repairs r
           WHERE date_trunc('month', r.created_at AT TIME ZONE 'Asia/Bangkok') = m)::int AS created,
         (SELECT count(*) FROM repairs r
           WHERE r.done_at IS NOT NULL
             AND date_trunc('month', r.done_at AT TIME ZONE 'Asia/Bangkok') = m)::int AS done
       FROM generate_series(
         date_trunc('month', ${BKK}) - interval '5 months',
         date_trunc('month', ${BKK}),
         interval '1 month') AS m`),

    q(`SELECT
         count(*) FILTER (WHERE status = 'done' AND due_date IS NOT NULL AND done_at IS NOT NULL)::int AS with_due,
         count(*) FILTER (WHERE status = 'done' AND due_date IS NOT NULL AND done_at IS NOT NULL
                            AND done_at <= due_date)::int AS on_time,
         count(*) FILTER (WHERE status <> 'done' AND due_date IS NOT NULL AND due_date < now())::int AS overdue,
         (avg(EXTRACT(EPOCH FROM (done_at - created_at)) / 86400)
            FILTER (WHERE status = 'done' AND done_at IS NOT NULL))::float AS avg_days
       FROM repairs`),

    q(`SELECT to_char(m, 'YYYY-MM') AS month,
         COALESCE((SELECT sum(revenue) FROM canteen c
                    WHERE date_trunc('month', c.date::timestamp) = m), 0)::float AS revenue,
         COALESCE((SELECT sum(cost) FROM canteen c
                    WHERE date_trunc('month', c.date::timestamp) = m), 0)::float AS cost
       FROM generate_series(
         date_trunc('month', ${BKK}) - interval '5 months',
         date_trunc('month', ${BKK}),
         interval '1 month') AS m`),

    q(`SELECT d::date AS day,
         (SELECT count(*) FROM nurse_visits v WHERE v.date = d::date)::int AS n
       FROM generate_series(${BKK}::date - 13, ${BKK}::date, interval '1 day') AS d`),

    q(`SELECT status, count(*)::int AS n FROM nurse_visits
       WHERE date >= ${BKK}::date - 29 GROUP BY status`),

    q(`SELECT status, count(*)::int AS n FROM vehicles GROUP BY status`),

    q(`SELECT count(*)::int AS n FROM vehicles
       WHERE next_service IS NOT NULL AND next_service <= CURRENT_DATE + 30`),
  ]);

  const k = repairKpi[0];

  res.json({
    repairs_by_status: toMap(repairStatus),
    repairs_monthly: repairMonthly,
    repairs_overdue: k.overdue,
    repairs_on_time_pct: k.with_due ? Math.round((k.on_time * 100) / k.with_due) : null,
    repairs_avg_days: k.avg_days == null ? null : Math.round(k.avg_days * 10) / 10,
    canteen_monthly: canteenMonthly,
    nurse_daily: nurseDaily,
    nurse_by_status: toMap(nurseOutcome),
    vehicles_by_status: toMap(vehicleStatus),
    vehicles_service_soon: service[0].n,
  });
});

/* =========================================================
   Frontend production
========================================================= */
const dist = path.join(__dirname, '../client/dist');

app.use(express.static(dist));

// /api ที่ไม่มีอยู่จริง ต้องตอบ JSON 404 (ไม่ใช่ index.html ที่ทำให้หน้าเว็บอ่าน JSON พัง)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'ไม่พบ API ที่เรียก' });
});

app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

/* =========================================================
   Error handler
========================================================= */
app.use((err, _req, res, _next) => {
  console.error('[API error]', err);

  if (res.headersSent) {
    return;
  }

  // 23505 ซ้ำ | 22P02/22007/22003/22001 ค่าผิดรูปแบบ | 23502 ขาดค่าที่จำเป็น | 23514 ผิดเงื่อนไข
  const badInput = ['22P02', '22007', '22003', '22001', '23502', '23514'].includes(err.code);

  if (err.code === '23505') {
    return res.status(409).json({ error: 'ข้อมูลซ้ำ (เช่น รหัสนี้มีอยู่แล้ว)' });
  }
  if (badInput) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้องหรือไม่ครบ กรุณาตรวจสอบอีกครั้ง' });
  }
  res.status(500).json({ error: 'เซิร์ฟเวอร์ผิดพลาด' });
});

/* =========================================================
   Start server
========================================================= */
const PORT = process.env.PORT || 3000;

if (JWT_SECRET === 'dev' || ADMIN_PASS === 'admin') {
  console.warn('⚠️  ยังใช้ JWT_SECRET / ADMIN_PASS ค่าเริ่มต้น กรุณาตั้งใน .env ก่อนใช้งานจริง');
  if (process.env.NODE_ENV === 'production') {
    console.error('ปฏิเสธการเริ่มระบบ: production ต้องตั้ง JWT_SECRET และ ADMIN_PASS เอง');
    process.exit(1);
  }
}

app.listen(PORT, () => {
  console.log(`ACR-Management พร้อมใช้งานที่ port ${PORT}`);

  console.log(
    `[LINE webhook] ${
      LINE_CHANNEL_SECRET && LINE_CHANNEL_ACCESS_TOKEN
        ? 'ตั้งค่าตัวแปรแล้ว'
        : 'กรุณาตรวจสอบ LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN'
    }`,
  );
});