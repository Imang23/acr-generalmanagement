import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Alert, Button, DatePicker, Input, Modal, Select, Space, Table, Tag, Tabs, Typography, Upload } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
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

/* ---------- นำเข้าจากไฟล์ CSV / Excel ---------- */
// คอลัมน์ของตาราง "สรุปผลการตรวจสุขภาพนักเรียน" (เรียงตาม Excel) — group ใช้จัดหัวตารางซ้อนในหน้าเว็บ
const DETAIL_COLS = [
  { key: 'code', find: 'รหัสนักเรียน', title: 'รหัสนักเรียน' },
  { key: 'sex', find: 'เพศ', title: 'เพศ' },
  { key: 'age', find: 'อายุ', title: 'อายุ' },
  { key: 'bp', find: 'ความดัน', title: 'ความดันโลหิต (mmHg)' },
  { key: 'pulse', find: 'ชีพจร', title: 'ชีพจร (ครั้ง/นาที)' },
  { key: 'resp', find: 'อัตราการหายใจ', title: 'อัตราการหายใจ' },
  { key: 'disease', find: 'โรคประจำตัว', title: 'โรคประจำตัว' },
  { key: 'nut_wa', find: 'ภาวะทางโภชนาการ', offset: 0, title: 'น้ำหนักตามเกณฑ์อายุ', group: 'ภาวะทางโภชนาการ' },
  { key: 'nut_ha', find: 'ภาวะทางโภชนาการ', offset: 1, title: 'ส่วนสูงตามเกณฑ์อายุ', group: 'ภาวะทางโภชนาการ' },
  { key: 'nut_wh', find: 'ภาวะทางโภชนาการ', offset: 2, title: 'น้ำหนักตามเกณฑ์ส่วนสูง', group: 'ภาวะทางโภชนาการ' },
  { key: 'skin', find: 'ผิวหนัง', title: 'ผิวหนัง (Skin)' },
  { key: 'eyes', find: 'ตา(Eyes)', title: 'ตา (Eyes)' },
  { key: 'ears', find: 'หู', title: 'หู (Ears)' },
  { key: 'neck', find: 'คอ(Neck)', title: 'คอ (Neck)' },
  { key: 'oral', find: 'ช่องปาก', title: 'ช่องปาก' },
  { key: 'lymph', find: 'ต่อมน้ำเหลือง', title: 'ต่อมน้ำเหลือง' },
  { key: 'heart_rhythm', find: 'หัวใจ(จังหวะ)', title: 'หัวใจ (จังหวะ)' },
  { key: 'heart_sound', find: 'หัวใจ(เสียงหัวใจ)', title: 'หัวใจ (เสียงหัวใจ)' },
  { key: 'liver', find: 'ช่องท้อง(ตับ', title: 'ช่องท้อง (ตับ)' },
  { key: 'chest', find: 'ทรวงอก', title: 'ทรวงอกและปอด' },
  { key: 'spleen', find: 'ช่องท้อง(ม้าม', title: 'ช่องท้อง (ม้าม)' },
  { key: 'bone', find: 'กระดูกและข้อ', title: 'กระดูกและข้อ' },
  { key: 'lice', find: 'ตรวจหาเหา', title: 'ตรวจหาเหา' },
  { key: 'doctor', find: 'สรุปผลตรวจร่างกาย', title: 'สรุปผลตรวจร่างกายโดยแพทย์' },
  { key: 'eye_r', find: 'ตาขวา', title: 'ตาขวา (Rt)', group: 'ตรวจสายตา' },
  { key: 'eye_l', find: 'ตาซ้าย', title: 'ตาซ้าย (Lt)', group: 'ตรวจสายตา' },
  { key: 'vision', find: 'สรุปผลตรวจสายตา', title: 'สรุปผลตรวจสายตา', group: 'ตรวจสายตา' },
  { key: 'colorblind', find: 'ตรวจตาบอดสี', title: 'ตรวจตาบอดสี' },
];

const clean = (v) => String(v ?? '').replace(/\s+/g, '').trim();
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// แปลง array of arrays จากชีต Excel → แถวสำหรับนำเข้า (ชีตที่ไม่ใช่ตารางนี้จะได้ [])
function rowsFromSheet(aoa) {
  const h = aoa.findIndex((r) => r.some((c) => clean(c).startsWith('ชื่อ')) && r.some((c) => clean(c).startsWith('น้ำหนัก')));
  if (h < 0) return [];
  const head = aoa[h].map(clean);
  const col = (k) => head.findIndex((c) => c.startsWith(k));

  const name = col('ชื่อ'), level = col('ระดับชั้น'), room = col('ห้อง'), weight = col('น้ำหนัก'), height = col('ส่วนสูง');
  if (name < 0 || weight < 0) return [];
  const idx = DETAIL_COLS.map((d) => {
    const i = col(d.find);
    return { ...d, i: i < 0 ? -1 : i + (d.offset || 0) };
  });

  const out = [];
  for (const r of aoa.slice(h + 1)) {
    const student = text(r[name]);
    if (!student) continue; // แถวหัวย่อย/แถวว่าง
    const lv = level >= 0 ? text(r[level]) : '';
    const rm = room >= 0 ? text(r[room]) : '';
    const detail = {};
    idx.forEach((d) => { if (d.i >= 0) detail[d.key] = text(r[d.i]); });
    out.push({
      student,
      class_room: lv && rm ? `${lv}/${rm}` : lv || rm,
      weight: text(r[weight]),
      height: text(r[height]),
      detail,
    });
  }
  return out;
}

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
    noDate: !String(r.date || '').trim(), // ไม่มีวันที่ในไฟล์ → ใช้วันที่ที่เลือกในหน้าต่างตรวจสอบ
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

  const [examDate, setExamDate] = useState(dayjs());

  const show = (rows) => {
    if (!rows.length) return message.warning('ไม่พบข้อมูลในไฟล์');
    if (rows.length > 1000) return message.error('นำเข้าได้ครั้งละไม่เกิน 1,000 แถว');
    setExamDate(dayjs());
    setPreview(rows);
  };

  const onFile = (file) => {
    if (/\.xlsx?$/i.test(file.name)) {
      file.arrayBuffer().then((buf) => {
        const wb = XLSX.read(buf, { type: 'array' });
        // รวมทุกชีต (เช่น แยกชีตตามระดับชั้น) ชีตที่ไม่ใช่ตารางตรวจสุขภาพจะถูกข้าม
        const rows = wb.SheetNames.flatMap((n) =>
          rowsFromSheet(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })));
        show(rows.map(({ detail, ...raw }, i) => ({ ...toRow(raw, i), detail })));
      }).catch(() => message.error('อ่านไฟล์ไม่สำเร็จ'));
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => show(res.data.map(toRow)),
        error: () => message.error('อ่านไฟล์ไม่สำเร็จ'),
      });
    }
    return false; // ไม่อัปโหลดอัตโนมัติ
  };

  const good = (preview || []).filter((r) => !r.error);
  const bad = (preview || []).filter((r) => r.error);

  const confirm = async () => {
    setSaving(true);
    try {
      const out = await api('/health_checks/import', 'POST', {
        rows: good.map(({ line, error, noDate, ...r }) => (noDate ? { ...r, date: examDate.format('YYYY-MM-DD') } : r)),
      });
      message.success(`นำเข้า ${out.inserted} รายการ${out.updated ? ` เติมรายละเอียดรายการเดิม ${out.updated} รายการ` : ''} ข้ามที่ซ้ำ ${out.skipped} รายการ`);
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
        <Upload accept=".csv,.xlsx,.xls" showUploadList={false} beforeUpload={onFile}>
          <Button icon={<UploadOutlined />}>นำเข้าจากไฟล์ Excel / CSV</Button>
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
        {(preview || []).some((r) => r.noDate) && (
          <Space style={{ marginBottom: 12 }}>
            <Text>วันที่ตรวจ (ไฟล์นี้ไม่มีวันที่):</Text>
            <DatePicker value={examDate} onChange={(d) => d && setExamDate(d)} allowClear={false} format="DD/MM/YYYY" />
          </Space>
        )}
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
            { title: 'วันที่', dataIndex: 'date', width: 110, render: (v, r) => (r.noDate ? examDate.format('YYYY-MM-DD') : v) || '-' },
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


/* ---------- ตารางสรุปผล หน้าตาแบบ Excel ---------- */
const NORMAL = /^(ปกติ|ไม่พบ|ไม่มี|สมส่วน|สายตาปกติ|น้ำหนักตามเกณฑ์|ส่วนสูงตามเกณฑ์|-)/;
const CHECK_KEYS = new Set(['disease', 'nut_wa', 'nut_ha', 'nut_wh', 'skin', 'eyes', 'ears', 'neck', 'oral', 'lymph',
  'heart_rhythm', 'heart_sound', 'liver', 'chest', 'spleen', 'bone', 'lice', 'doctor', 'vision', 'colorblind']);

const detailOf = (r) => {
  if (!r.detail) return {};
  if (typeof r.detail === 'string') { try { return JSON.parse(r.detail); } catch { return {}; } }
  return r.detail;
};

function SummarySheet({ tick }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [room, setRoom] = useState();
  const [date, setDate] = useState();

  useEffect(() => {
    setLoading(true);
    api('/health_checks')
      .then((d) => setRows((Array.isArray(d) ? d : d?.rows || []).map((r) => ({ ...r, d: detailOf(r) }))))
      .finally(() => setLoading(false));
  }, [tick]);

  const rooms = useMemo(() => [...new Set(rows.map((r) => r.class_room).filter(Boolean))].sort(), [rows]);
  const dates = useMemo(() => [...new Set(rows.map((r) => String(r.date || '').slice(0, 10)).filter(Boolean))].sort().reverse(), [rows]);
  const data = rows
    .filter((r) =>
    (!q || String(r.student).includes(q) || String(r.d.code || '').includes(q)) &&
    (!room || r.class_room === room) &&
    (!date || String(r.date || '').slice(0, 10) === date))
    // เรียงเหมือนในไฟล์ Excel: วันที่ล่าสุดก่อน แล้วตามชั้น/ห้อง และลำดับที่นำเข้า
    .sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(a.class_room || '').localeCompare(String(b.class_room || ''), 'th', { numeric: true }) ||
      (a.id ?? 0) - (b.id ?? 0));

  const cell = (key) => ({
    title: DETAIL_COLS.find((c) => c.key === key).title,
    width: key === 'doctor' ? 220 : key === 'bp' || key.startsWith('nut') ? 130 : 100,
    align: 'center',
    render: (_, r) => {
      const v = r.d[key];
      if (!v) return '';
      const bad = CHECK_KEYS.has(key) && !NORMAL.test(v);
      const el = <span style={bad ? { color: '#cf1322', fontWeight: 600 } : undefined}>{v}</span>;
      return key === 'doctor' ? <div style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{el}</div> : el;
    },
  });
  const group = (title, keys) => ({ title, align: 'center', children: keys.map(cell) });

  const columns = [
    { title: 'ลำดับ', width: 60, align: 'center', fixed: 'left', render: (_, __, i) => i + 1 },
    { title: 'ชื่อ - นามสกุล', dataIndex: 'student', width: 220, fixed: 'left' },
    { title: 'วันที่ตรวจ', dataIndex: 'date', width: 105, align: 'center', render: (v) => String(v || '').slice(0, 10) },
    cell('code'), cell('sex'), cell('age'),
    { title: 'ชั้น/ห้อง', dataIndex: 'class_room', width: 80, align: 'center' },
    { title: 'น้ำหนัก (กก.)', dataIndex: 'weight', width: 90, align: 'center', render: (v) => (v ?? '') },
    { title: 'ส่วนสูง (ซม.)', dataIndex: 'height', width: 90, align: 'center', render: (v) => (v ?? '') },
    cell('bp'), cell('pulse'), cell('resp'), cell('disease'),
    group('ภาวะทางโภชนาการ', ['nut_wa', 'nut_ha', 'nut_wh']),
    cell('skin'), cell('eyes'), cell('ears'), cell('neck'), cell('oral'), cell('lymph'),
    cell('heart_rhythm'), cell('heart_sound'), cell('liver'), cell('chest'), cell('spleen'), cell('bone'), cell('lice'),
    cell('doctor'),
    group('ตรวจสายตา', ['eye_r', 'eye_l', 'vision']),
    cell('colorblind'),
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="ค้นหาชื่อ / รหัส" style={{ width: 220 }} onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
        <Select allowClear placeholder="ชั้น/ห้อง" style={{ width: 120 }} value={room} onChange={setRoom} options={rooms.map((v) => ({ value: v, label: v }))} />
        <Select allowClear placeholder="วันที่ตรวจ" style={{ width: 140 }} value={date} onChange={setDate} options={dates.map((v) => ({ value: v, label: v }))} />
        <Text type="secondary">{data.length} คน · ตัวอักษรสีแดง = ผลผิดปกติ</Text>
      </Space>
      <Table
        bordered
        size="small"
        loading={loading}
        rowKey={(r) => r.id ?? `${r.date}-${r.student}`}
        columns={columns}
        dataSource={data}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 300] }}
        scroll={{ x: 'max-content', y: 560 }}
      />
    </>
  );
}

// งานอนามัยและการพยาบาล: ตรวจสุขภาพ
export default function Healthcheckup({ tick }) {
  return (
    <Tabs
      destroyOnHidden
      items={[
        { key: 'summary', label: 'ตารางสรุปผล (แบบ Excel)', children: <SummarySheet tick={tick} /> },
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