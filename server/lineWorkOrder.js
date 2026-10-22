import 'dotenv/config';

// ใบงานซ่อมผ่าน LINE OA
// notifyNewRepair(repair) -> ส่ง Flex ใบงานเข้า LINE_TARGET_ID
// handleLineEvent(event, deps) -> รับคำสั่งส่งงานและบันทึกรูป

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';
const PENDING_TTL = 10 * 60 * 1000;
const pending = new Map();

const auth = () => ({
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
});

async function line(endpoint, body) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('[LINE] ไม่พบ LINE_CHANNEL_ACCESS_TOKEN');
    return false;
  }

  try {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('[LINE]', endpoint, res.status, await res.text());
      return false;
    }

    return true;
  } catch (err) {
    console.error('[LINE]', endpoint, err?.message || err);
    return false;
  }
}

function responseFlex(text, options = {}) {
  const message = String(text || 'ดำเนินการเรียบร้อย').slice(0, 1800);
  let title = options.title || 'แจ้งเตือนจาก LINE OA';
  let color = options.color || '#0b2a8a';
  let icon = options.icon || '📋';

  if (!options.title) {
    if (/ไม่พบ|ไม่สำเร็จ|ข้อผิดพลาด|หมดเวลา|ไม่รองรับ|ไม่รับรูป/.test(message)) {
      title = 'ดำเนินการไม่สำเร็จ'; color = '#b91c1c'; icon = '⚠️';
    } else if (/ต้องแก้ไข|ส่งกลับแก้ไข/.test(message)) {
      title = 'งานซ่อมต้องแก้ไข'; color = '#b91c1c'; icon = '🛠️';
    } else if (/ปิดงานแล้ว/.test(message)) {
      title = 'ปิดงานแล้ว'; color = '#15803d'; icon = '✅';
    } else if (/รอผู้ดูแลอนุมัติ|รอผู้ดูแลตรวจ|กำลังรอ/.test(message)) {
      title = 'รอผู้ดูแลตรวจสอบ'; color = '#b45309'; icon = '⏳';
    } else if (/ส่งงาน|เพิ่มรูป|บันทึกรูป|รับทราบ/.test(message)) {
      title = 'สถานะใบงานซ่อม'; color = '#15803d'; icon = '📋';
    }
  }

  return {
    type: 'flex',
    altText: `${title}: ${message.replace(/\s+/g, ' ').slice(0, 250)}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px',
        contents: [{ type: 'text', text: `${icon} ${title}`, color: '#ffffff', weight: 'bold', size: 'lg', wrap: true }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px',
        contents: [{ type: 'text', text: message, size: 'sm', color: '#333333', wrap: true }],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px',
        contents: [{ type: 'text', text: 'ระบบจัดการใบงานซ่อม', size: 'xs', color: '#8c8c8c', align: 'center', wrap: true }],
      },
      styles: { body: { backgroundColor: '#ffffff' }, footer: { separator: true, separatorColor: '#eeeeee' } },
    },
  };
}

const reply = (replyToken, text, options = {}) => {
  if (!replyToken) return Promise.resolve(false);
  return line('/message/reply', {
    replyToken,
    messages: [responseFlex(text, options)],
  });
};

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' น.'
    : '-';

function workOrderFlex(r) {
  const row = (label, value) => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: '#8c8c8c',
        flex: 3,
      },
      {
        type: 'text',
        text: String(value || '-'),
        size: 'sm',
        wrap: true,
        flex: 7,
      },
    ],
  });

  return {
    type: 'flex',
    altText: `ใบงานซ่อม #${r.id}: ${r.title || 'งานซ่อม'}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0b2a8a',
        contents: [
          {
            type: 'text',
            text: `ใบงานซ่อม #${r.id}`,
            color: '#ffffff',
            weight: 'bold',
            size: 'lg',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: String(r.title || 'งานซ่อม'),
            weight: 'bold',
            wrap: true,
          },
          row('สถานที่', r.location),
          row('ผู้แจ้ง', r.reporter),
          row('ผู้รับผิดชอบ', r.assignee),
          row('กำหนดส่ง', fmtDateTime(r.due_date)),
          ...(r.detail ? [row('รายละเอียด', r.detail)] : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'message',
              label: 'รับงาน',
              text: `#รับงาน ${r.id}`,
            },
          },
          {
            type: 'button',
            style: 'primary',
            color: '#1a4fb8',
            action: {
              type: 'message',
              label: 'ส่งงาน (แนบรูป)',
              text: `#ส่งงาน ${r.id}`,
            },
          },
        ],
      },
    },
  };
}

export async function notifyNewRepair(repair) {
  if (!process.env.LINE_TARGET_ID || !process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error(
      '[work-order] ไม่พบ LINE_TARGET_ID หรือ LINE_CHANNEL_ACCESS_TOKEN',
    );
    return false;
  }

  if (!repair?.id) return false;

  return line('/message/push', {
    to: process.env.LINE_TARGET_ID,
    messages: [workOrderFlex(repair)],
  });
}

// การ์ดแจ้ง "งานซ่อมต้องแก้ไข" (ผู้ดูแลส่งงานกลับ) หน้าตาเดียวกับใบงาน แต่ใช้โทนแดง + ปุ่มส่งงานใหม่
function rejectedFlex(r, reason, reviewer) {
  const row = (label, value, color) => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: '#8c8c8c',
        flex: 3,
      },
      {
        type: 'text',
        text: String(value || '-'),
        size: 'sm',
        wrap: true,
        flex: 7,
        ...(color ? { color } : {}),
      },
    ],
  });

  return {
    type: 'flex',
    altText: `งานซ่อม #${r.id} ต้องแก้ไข: ${r.title || 'งานซ่อม'}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#b91c1c',
        contents: [
          {
            type: 'text',
            text: `งานซ่อมต้องแก้ไข #${r.id}`,
            color: '#ffffff',
            weight: 'bold',
            size: 'lg',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: String(r.title || 'งานซ่อม'),
            weight: 'bold',
            wrap: true,
          },
          row('สถานที่', r.location),
          row('ผู้แจ้ง', r.reporter),
          row('ผู้รับผิดชอบ', r.assignee),
          row('สถานะ', 'รอแก้ไข', '#b91c1c'),
          row('เหตุผล', String(reason || '-').slice(0, 500), '#b91c1c'),
          row('ผู้พิจารณา', reviewer),
          {
            type: 'text',
            text: 'รบกวนผู้รับผิดชอบแก้ไขงานตามเหตุผลข้างต้น แล้วส่งงานใหม่อีกครั้ง',
            size: 'xs',
            color: '#8c8c8c',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#b91c1c',
            action: {
              type: 'message',
              label: 'ส่งงานใหม่ (แนบรูป)',
              text: `#ส่งงาน ${r.id}`,
            },
          },
        ],
      },
    },
  };
}

export async function notifyRepairRejected(repair, reason, reviewer) {
  if (!process.env.LINE_TARGET_ID || !process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error(
      '[work-order] ไม่พบ LINE_TARGET_ID หรือ LINE_CHANNEL_ACCESS_TOKEN',
    );
    return false;
  }

  if (!repair?.id) return false;

  return line('/message/push', {
    to: process.env.LINE_TARGET_ID,
    messages: [rejectedFlex(repair, reason, reviewer)],
  });
}

// การ์ดแจ้ง "อนุมัติปิดงานซ่อม" โทนเขียว
function approvedFlex(r, reviewer) {
  const row = (label, value, color) => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: '#8c8c8c',
        flex: 3,
      },
      {
        type: 'text',
        text: String(value || '-'),
        size: 'sm',
        wrap: true,
        flex: 7,
        ...(color ? { color } : {}),
      },
    ],
  });

  return {
    type: 'flex',
    altText: `อนุมัติปิดงานซ่อม #${r.id}: ${r.title || 'งานซ่อม'}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#15803d',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: `✅ อนุมัติปิดงาน #${r.id}`,
            color: '#ffffff',
            weight: 'bold',
            size: 'lg',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          {
            type: 'text',
            text: String(r.title || 'งานซ่อม'),
            weight: 'bold',
            size: 'md',
            wrap: true,
          },
          row('สถานที่', r.location),
          row('ผู้แจ้ง', r.reporter),
          row('ผู้รับผิดชอบ', r.assignee),
          row('สถานะ', 'อนุมัติปิดงานแล้ว', '#15803d'),
          row('ผู้อนุมัติ', reviewer),
          row('วันที่ปิดงาน', fmtDateTime(r.approved_at || new Date())),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          {
            type: 'text',
            text: 'ใบงานซ่อมเสร็จสมบูรณ์',
            size: 'sm',
            color: '#15803d',
            weight: 'bold',
            align: 'center',
            wrap: true,
          },
        ],
      },
    },
  };
}

export async function notifyRepairApproved(repair, reviewer) {
  if (!process.env.LINE_TARGET_ID || !process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error(
      '[work-order] ไม่พบ LINE_TARGET_ID หรือ LINE_CHANNEL_ACCESS_TOKEN',
    );
    return false;
  }

  if (!repair?.id) {
    console.error('[work-order] ไม่พบข้อมูลใบงานที่อนุมัติ');
    return false;
  }

  return line('/message/push', {
    to: process.env.LINE_TARGET_ID,
    messages: [approvedFlex(repair, reviewer)],
  });
}

export async function handleLineEvent(event, deps) {
  if (event.type !== 'message') return false;

  const source = event.source || {};
  const key = source.userId || source.groupId;
  const msg = event.message;

  if (!key || !msg) return false;

  // ---------------------------------------------
  // เริ่มส่งงาน: #ส่งงาน 123
  // ---------------------------------------------
  if (msg.type === 'text') {
    const match = String(msg.text || '').trim().match(/^#ส่งงาน\s+#?(\d+)$/);

    if (!match) return false;

    const id = Number(match[1]);
    const repair = await deps.getRepair(id);

    if (!repair) {
      await reply(event.replyToken, `ไม่พบใบงาน #${id}`);
      return true;
    }

    if (repair.approval_status === 'approved' || repair.status === 'done' || repair.status === 'completed') {
      pending.delete(key);
      await reply(event.replyToken, `ใบงาน #${id} ปิดงานแล้ว`);
      return true;
    }

    if (repair.approval_status === 'submitted') {
      pending.delete(key);
      await reply(
        event.replyToken,
        `⏳ ใบงาน #${id} ส่งงานแล้ว กำลังรอผู้ดูแลอนุมัติปิดงาน`,
      );
      return true;
    }

    pending.set(key, { id, at: Date.now() });

    await reply(
      event.replyToken,
      repair.approval_status === 'rejected'
        ? `รับทราบ ใบงาน #${id} (ส่งกลับแก้ไข)\nเหตุผล: ${repair.rejection_reason || '-'}\nแก้ไขแล้วส่งรูปงานใหม่ได้เลย ภายใน 10 นาที`
        : `รับทราบ ใบงาน #${id}\nส่งรูปงานที่เสร็จแล้วได้เลย ภายใน 10 นาที แล้วผู้ดูแลจะตรวจและอนุมัติปิดงาน`,
    );

    return true;
  }

  // ---------------------------------------------
  // รับรูปงาน
  // ---------------------------------------------
  if (msg.type === 'image') {
    const task = pending.get(key);

    if (!task) return false;

    if (Date.now() - task.at > PENDING_TTL) {
      pending.delete(key);
      await reply(event.replyToken, 'หมดเวลาส่งรูปแล้ว กรุณาพิมพ์ #ส่งงาน เลขที่ใบงาน อีกครั้ง');
      return true;
    }

    // ตรวจสถานะล่าสุดอีกครั้งก่อนดาวน์โหลดและบันทึกรูป
    const current = await deps.getRepair(task.id);

    if (!current) {
      pending.delete(key);
      await reply(event.replyToken, `ไม่พบใบงาน #${task.id}`);
      return true;
    }

    if (current.approval_status === 'approved' || current.status === 'done' || current.status === 'completed') {
      pending.delete(key);
      await reply(event.replyToken, `ใบงาน #${task.id} ปิดงานแล้ว ไม่รับรูปเพิ่ม`);
      return true;
    }

    try {
      const response = await fetch(
        `${DATA_API}/message/${msg.id}/content`,
        { headers: auth() },
      );

      if (!response.ok) {
        console.error('[LINE image]', response.status, await response.text());
        await reply(event.replyToken, 'ดาวน์โหลดรูปไม่สำเร็จ กรุณาส่งรูปใหม่');
        return true;
      }

      const mime = (response.headers.get('content-type') || 'image/jpeg')
        .split(';')[0]
        .trim();

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        await reply(event.replyToken, 'ชนิดไฟล์รูปไม่รองรับ กรุณาส่ง JPG, PNG หรือ WebP');
        return true;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const repair = await deps.addPhoto(task.id, buffer, mime);

      if (!repair) {
        pending.delete(key);

        await reply(
          event.replyToken,
          'บันทึกรูปไม่สำเร็จ กรุณาตรวจสอบสถานะใบงานแล้วลองใหม่',
        );

        return true;
      }

      task.at = Date.now();
      deps.onChange?.(repair);

      // นับรูปในการส่งงานรอบนี้ (ส่งได้หลายรูปต่อเนื่องภายใน 10 นาที)
      task.sent = (task.sent || 0) + 1;

      await reply(
        event.replyToken,
        task.sent === 1
          ? `📥 ส่งงานใบงาน #${task.id} แล้ว\nรอผู้ดูแลตรวจและอนุมัติปิดงาน ✅\n(ส่งรูปเพิ่มได้อีกภายใน 10 นาที)`
          : `เพิ่มรูปใบงาน #${task.id} แล้ว (รอบนี้รวม ${task.sent} รูป)`,
      );

      return true;
    } catch (err) {
      console.error('[LINE image processing]', err);
      await reply(event.replyToken, 'เกิดข้อผิดพลาดขณะบันทึกรูป กรุณาลองใหม่');
      return true;
    }
  }

  return false;
}