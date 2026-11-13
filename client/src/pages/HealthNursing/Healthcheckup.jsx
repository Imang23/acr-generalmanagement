import { useState } from 'react';
import { App as AntApp, Alert, Button, Modal, Space, Table, Tag, Tabs, Typography, Upload } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import CrudPage from '../../CrudPage';
import { api } from '../../api.js';

dayjs.extend(customParseFormat);
const { Text } = Typography;

const checks = [
  { key: 'date', label: 'วันที่ตรวจ', type: 'date', required: true, today: true },
  { key: 'student', label: 'ชื่อนักเรียน', required: true },
  { key: 'class_room', label: 'ชั้น/ห้อง' },
  { key: 'weight', label: 'น้ำหนัก (กก.)', type: 'number' },
  { key: 'height', label: 'ส่วนสูง (ซม.)', type: 'number' },
  { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

/* ---------- นำเข้าจากไฟล์ CSV ---------- */
const HEAD = {
  วันที่ตรวจ: 'date', วันที่: 'date', date: 'date',
  ชื่อนักเรียน: 'student', ชื่อ: 'student', student: 'student',
  'ชั้น/ห้อง': 'class_room', ชั้น: 'class_room', class_room: 'class_room',
  น้ำหนัก: 'weight', weight: 'weight',
  ส่วนสูง: 'height', height: 'height',
  หมายเหตุ: 'note', note: 'note',
};
const fieldOf = (k) => HEAD[String(k).replace(/\(.*?\)/g, '').replace(/\s/g, '').toLowerCase()];

// รับ 2026-11-13 หรือ 13/11/2026 (ปี พ.ศ. ก็ได้) ว่าง = วันนี้
function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return dayjs().format('YYYY-MM-DD');
  let d = dayjs(s, ['YYYY-MM-DD', 'D/M/YYYY', 'DD/MM/YYYY'], true);
  if (!d.isValid()) return null;
  if (d.year() > 2400) d = d.subtract(543, 'year');
  return d.format('YYYY-MM-DD');
}

function toRow(raw, index) {
  const r = {};
  Object.entries(raw).forEach(([k, v]) => {
    const f = fieldOf(k);
    if (f) r[f] = String(v ?? '').trim();
  });
  const errors = [];
  if (!r.student) errors.push('ไม่มีชื่อนักเรียน');
  const date = parseDate(r.date);
  if (!date) errors.push('วันที่ไม่ถูกต้อง');
  const weight = r.weight ? Number(r.weight) : null;
  const height = r.height ? Number(r.height) : null;
  if (r.weight && !(weight >= 1 && weight <= 200)) errors.push('น้ำหนักผิดปกติ');
  if (r.height && !(height >= 30 && height <= 220)) errors.push('ส่วนสูงผิดปกติ');
  return {
    line: index + 2, // บรรทัดในไฟล์ (บรรทัด 1 คือหัวตาราง)
    date, student: r.student || '', class_room: r.class_room || '',
    weight, height, note: r.note || '', error: errors.join(', '),
  };
}

function downloadTemplate() {
  const csv = '\ufeff' + [
    'วันที่ตรวจ,ชื่อนักเรียน,ชั้น/ห้อง,น้ำหนัก (กก.),ส่วนสูง (ซม.),หมายเหตุ',
    '2026-11-13,สมชาย ใจดี,ม.2/3,45.5,158,',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'แบบฟอร์มนำเข้าตรวจสุขภาพ.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function ImportBar({ reload }) {
  const { message } = AntApp.useApp();
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const onFile = (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data.map(toRow);
        if (!rows.length) return message.warning('ไม่พบข้อมูลในไฟล์');
        if (rows.length > 1000) return message.error('นำเข้าได้ครั้งละไม่เกิน 1,000 แถว');
        setPreview(rows);
      },
      error: () => message.error('อ่านไฟล์ไม่สำเร็จ'),
    });
    return false; // ไม่อัปโหลดอัตโนมัติ
  };

  const good = (preview || []).filter((r) => !r.error);
  const bad = (preview || []).filter((r) => r.error);

  const confirm = async () => {
    setSaving(true);
    try {
      const out = await api('/health_checks/import', 'POST', {
        rows: good.map(({ line, error, ...r }) => r),
      });
      message.success(`นำเข้า ${out.inserted} รายการ ข้ามที่ซ้ำ ${out.skipped} รายการ`);
      setPreview(null);
      reload();
    } catch (e) {
      message.error(e.message || 'นำเข้าไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Space wrap>
        <Upload accept=".csv" showUploadList={false} beforeUpload={onFile}>
          <Button icon={<UploadOutlined />}>นำเข้าจากไฟล์ CSV</Button>
        </Upload>
        <Button type="link" icon={<DownloadOutlined />} onClick={downloadTemplate}>ดาวน์โหลดแบบฟอร์ม</Button>
      </Space>

      <Modal
        open={!!preview}
        title="ตรวจสอบก่อนนำเข้า"
        width={820}
        okText={`นำเข้า ${good.length} รายการ`}
        cancelText="ยกเลิก"
        okButtonProps={{ disabled: !good.length }}
        confirmLoading={saving}
        onOk={confirm}
        onCancel={() => !saving && setPreview(null)}
        destroyOnHidden
      >
        <Alert
          style={{ marginBottom: 12 }}
          type={bad.length ? 'warning' : 'success'}
          showIcon
          message={`ถูกต้อง ${good.length} แถว · มีปัญหา ${bad.length} แถว (แถวที่มีปัญหาจะไม่ถูกนำเข้า)`}
        />
        <Table
          size="small"
          rowKey="line"
          dataSource={preview || []}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          scroll={{ x: 700 }}
          columns={[
            { title: 'แถว', dataIndex: 'line', width: 60 },
            { title: 'วันที่', dataIndex: 'date', width: 110, render: (v) => v || '-' },
            { title: 'ชื่อ', dataIndex: 'student' },
            { title: 'ชั้น/ห้อง', dataIndex: 'class_room', width: 90 },
            { title: 'นน.', dataIndex: 'weight', width: 70, render: (v) => v ?? '-' },
            { title: 'สส.', dataIndex: 'height', width: 70, render: (v) => v ?? '-' },
            {
              title: 'ผลตรวจไฟล์',
              dataIndex: 'error',
              width: 190,
              render: (v) => (v ? <Text type="danger">{v}</Text> : <Tag color="green">พร้อมนำเข้า</Tag>),
            },
          ]}
        />
      </Modal>
    </>
  );
}

// งานอนามัยและการพยาบาล: ตรวจสุขภาพ
export default function Healthcheckup({ tick }) {
  return (
    <Tabs
      items={[
        {
          key: 'health_checks',
          label: 'ตรวจสุขภาพ',
          children: (
            <CrudPage
              resource="health_checks"
              title="ตรวจสุขภาพ"
              fields={checks}
              tick={tick}
              beforeContent={({ reload }) => <ImportBar reload={reload} />}
            />
          ),
        },
      ]}
    />
  );
}