import { Input, Modal } from 'antd';
import { api } from './api.js';

/**
 * ช่างลบเองไม่ได้ -> เปิดฟอร์มขออนุมัติลบให้ผู้ตรวจ
 * table = ชื่อตารางใน API (เช่น 'repairs', 'housekeeping_tasks')
 */
export function askDeleteRequest({ message, table, recordId, label, onDone }) {
  let reason = '';
  Modal.confirm({
    title: 'ขออนุมัติลบข้อมูล',
    content: (
      <div>
        <div style={{ marginBottom: 8 }}>
          รายการ: <b>{label || `#${recordId}`}</b>
          <br />
          ช่างลบเองไม่ได้ ระบบจะส่งคำขอให้ผู้ตรวจพิจารณา
        </div>
        <Input.TextArea
          rows={3}
          maxLength={500}
          placeholder="ระบุเหตุผลที่ขอลบ"
          onChange={(e) => { reason = e.target.value; }}
        />
      </div>
    ),
    okText: 'ส่งคำขอ',
    cancelText: 'ยกเลิก',
    onOk: async () => {
      if (!reason.trim()) {
        message.warning('กรุณาระบุเหตุผลที่ขอลบ');
        throw new Error('reason required'); // ให้หน้าต่างค้างไว้
      }
      try {
        await api('/delete-requests', 'POST', { table, record_id: recordId, reason: reason.trim() });
      } catch (e) {
        message.error(e.message);
        throw e;
      }
      message.success('ส่งคำขอลบให้ผู้ตรวจแล้ว');
      onDone?.();
    },
  });
}
