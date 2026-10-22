import 'dotenv/config';
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { notifyNewRepair, handleLineEvent } from './lineWorkOrder.js';

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
      `หมายเหตุ: ${record.note || '-'}`,
      `ผู้บันทึก: ${record.reporter || '-'}`,
    ],
  );
}

function notifyOtherResource(table, action, record) {
  const labels = {
    vehicles: '🚗 ข้อมูลรถ',
    workers: '👷 ข้อมูลพนักงาน',
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
    : record.name || `ID ${record.id}`;

  return sendLineNotification(`${title}: ${actions[action] || action}`, [
    `รายการ: ${identity}`,
    `ID: ${record.id || '-'}`,
    ...(table === 'vehicles'
      ? [`ผู้ขับ: ${record.driver || '-'}`, `สถานะ: ${record.status || '-'}`]
      : [`ตำแหน่ง: ${record.role || '-'}`, `เบอร์โทร: ${record.phone || '-'}`]),
  ]);
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
      'SELECT 1 FROM repairs WHERE id = $1',
      [id],
    );

    if (!exists) return null;

    const { rows: [photo] } = await pool.query(
      `INSERT INTO repair_photos (repair_id, mime, data)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [id, mime, buf],
    );

    const photoUrl = `/api/photos/${photo.id}`;

    const { rows: [repair] } = await pool.query(
      `UPDATE repairs
       SET done_photos = COALESCE(done_photos, '[]'::jsonb)
                            || to_jsonb($2::text),
           status = 'done',
           done_at = COALESCE(done_at, now()),
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
  const { rows: [prev] } = await pool.query('SELECT status FROM repairs WHERE id = $1', [id]);
  if (!prev) return null;
  const { rows: [repair] } = await pool.query(
    `UPDATE repairs
     SET status = $2::text,
         assignee = CASE WHEN $2::text = 'doing'
                         THEN COALESCE(NULLIF(assignee, ''), $3::text)
                         ELSE assignee END,
         done_at = CASE WHEN $2::text = 'done' THEN COALESCE(done_at, now()) ELSE NULL END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, by],
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
           ON CONFLICT (date)
           DO UPDATE SET
             revenue = EXCLUDED.revenue,
             cost = EXCLUDED.cost,
             note = EXCLUDED.note,
             reporter = EXCLUDED.reporter
           RETURNING *`,
          [
            revenue,
            cost,
            canteenMatch[3] || '',
            name,
          ],
        );

        broadcast('canteen', rows[0]);

        await lineReply(
          ev.replyToken,
          `✅ บันทึกโรงอาหารสำเร็จ\nรายรับ ${revenue.toLocaleString()} บาท\nรายจ่าย ${cost.toLocaleString()} บาท\nกำไร ${(revenue - cost).toLocaleString()} บาท`,
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

        broadcast('repair_status', result.repair);

        const lines = [
          `🔧 ใบงาน #${id}: ${result.repair.title}`,
          `สถานะ: ${REPAIR_LABEL[result.previous] || result.previous} → ${REPAIR_LABEL[status]}`,
        ];
        if (result.repair.assignee) lines.push(`ผู้รับผิดชอบ: ${result.repair.assignee}`);
        if (status === 'done' && !result.repair.done_photos?.length) {
          lines.push(`ส่งรูปงานได้โดยพิมพ์ #ส่งงาน ${id} แล้วส่งรูป`);
        }
        await lineReply(ev.replyToken, lines.join('\n'));
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
            '#ส่งงาน เลขที่ใบงาน (แล้วส่งรูป)',
            '#โรงอาหาร รายรับ รายจ่าย หมายเหตุ',
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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({
      error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    });
  }

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

    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.sendStatus(401);
  }
};

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
app.get('/api/photos/:id', auth, async (req, res) => {
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
  ],
  canteen: ['date', 'revenue', 'cost', 'note', 'reporter'],
  vehicles: [
    'plate',
    'name',
    'driver',
    'status',
    'mileage',
    'next_service',
    'note',
  ],
  workers: ['name', 'role', 'phone', 'active', 'note'],
  nurse_visits: ['date', 'student', 'class_room', 'symptom', 'treatment', 'status', 'reporter'],
  health_checks: ['date', 'student', 'class_room', 'weight', 'height', 'note', 'reporter'],
};

const order = {
  repairs: 'id DESC',
  canteen: 'date DESC',
  vehicles: 'id',
  workers: 'id',
  nurse_visits: 'date DESC, id DESC',
  health_checks: 'date DESC, id DESC',
};

for (const [table, cols] of Object.entries(resources)) {
  const pick = (body = {}) =>
    cols
      .filter((col) => body[col] !== undefined)
      .map((col) => [
        col,
        body[col] === '' ? null : body[col],
      ]);

  // READ
  app.get(`/api/${table}`, auth, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM ${table}
       ORDER BY ${order[table]}
       LIMIT 500`,
    );

    res.json(rows);
  });

  // CREATE
  app.post(`/api/${table}`, auth, async (req, res) => {
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

    res.json(rows[0]);

    // แจ้งเตือน LINE หลังบันทึกข้อมูลสำเร็จ
    if (table === 'repairs') {
      // ใช้ระบบใบงานเดิม เพื่อไม่ส่งแจ้งเตือนงานซ่อมซ้ำ
      void issueWorkOrder(rows[0]);
    } else if (table === 'canteen') {
      void notifyCanteenSaved(rows[0], 'create');
    } else if (table === 'vehicles' || table === 'workers') {
      void notifyOtherResource(table, 'create', rows[0]);
    } else if (table === 'nurse_visits' || table === 'health_checks') {
      void notifyHealthSaved(table, 'create', rows[0]);
    }
  });

  // UPDATE
  app.put(`/api/${table}/:id`, auth, async (req, res) => {
    const fields = pick(req.body);

    if (!fields.length) {
      return res.status(400).json({
        error: 'ไม่พบข้อมูลสำหรับแก้ไข',
      });
    }

    // อ่านสถานะเดิมก่อน UPDATE เพื่อแจ้งเตือนเฉพาะเมื่อสถานะงานซ่อมเปลี่ยนจริง
    const previousRepair = table === 'repairs'
      ? (await pool.query(
          'SELECT status FROM repairs WHERE id = $1',
          [req.params.id],
        )).rows[0]
      : null;

    const setSql = fields.map(
      ([col], i) => `${col} = $${i + 1}`,
    );

    if (table === 'repairs') {
      setSql.push('updated_at = now()');
      if (req.body?.status !== undefined) {
        setSql.push(
          req.body.status === 'done'
            ? 'done_at = COALESCE(done_at, now())'
            : 'done_at = NULL',
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

    res.json(rows[0]);

    // แจ้งเตือนเมื่อสถานะงานซ่อมเปลี่ยน
    if (
      table === 'repairs' &&
      previousRepair &&
      previousRepair.status !== rows[0].status
    ) {
      void notifyRepairStatusChanged(rows[0], previousRepair.status);
    }

    if (table === 'canteen') {
      void notifyCanteenSaved(rows[0], 'update');
    } else if (table === 'vehicles' || table === 'workers') {
      void notifyOtherResource(table, 'update', rows[0]);
    } else if (table === 'nurse_visits' || table === 'health_checks') {
      void notifyHealthSaved(table, 'update', rows[0]);
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
    const { rows } = await pool.query(
      `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
      [req.params.id],
    );

    if (!rows[0]) {
      return res.sendStatus(404);
    }

    res.sendStatus(204);

    if (table === 'vehicles' || table === 'workers') {
      void notifyOtherResource(table, 'delete', rows[0]);
    } else if (table === 'nurse_visits' || table === 'health_checks') {
      void notifyHealthSaved(table, 'delete', rows[0]);
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

app.get('*', (_req, res) => {
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

  const duplicate = err.code === '23505';

  res.status(duplicate ? 409 : 500).json({
    error: duplicate
      ? 'ข้อมูลซ้ำ (เช่น มีรายการของวันนี้อยู่แล้ว)'
      : 'เซิร์ฟเวอร์ผิดพลาด',
  });
});

/* =========================================================
   Start server
========================================================= */
const PORT = process.env.PORT || 3000;

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
