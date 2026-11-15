import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api.js';

const { Text } = Typography;
const UNITS = ['เม็ด', 'แคปซูล', 'ซอง', 'ขวด', 'หลอด', 'กล่อง', 'แผ่น', 'ชิ้น', 'มล.'];
const CATEGORIES = ['ยาแก้ปวด/ลดไข้', 'ยาแก้แพ้', 'ยาระบบทางเดินอาหาร', 'ยาใช้ภายนอก', 'ยาหยอด/ล้างตา', 'เวชภัณฑ์', 'อื่น ๆ'];
const KIND = { in: ['รับเข้า', 'green'], out: ['จ่ายออก', 'volcano'], adjust: ['ปรับยอด', 'blue'] };

const fmtDate = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '-');

function MedicineForm({ open, item, onClose, onSaved }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (item) form.setFieldsValue({ ...item, expiry: item.expiry ? dayjs(item.expiry) : null });
  }, [open, item, form]);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = { ...v, expiry: v.expiry ? v.expiry.format('YYYY-MM-DD') : '' };
      if (item) await api(`/medicines/${item.id}`, 'PUT', body);
      else await api('/medicines', 'POST', body);
      message.success('บันทึกแล้ว');
      onSaved();
      onClose();
    } catch (e) {
      message.error(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={item ? 'แก้ไขข้อมูลยา' : 'เพิ่มยา'} okText="บันทึก" cancelText="ยกเลิก"
      onOk={submit} onCancel={onClose} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ unit: 'เม็ด', qty: 0, min_qty: 0 }}>
        <Form.Item name="name" label="ชื่อยา / เวชภัณฑ์" rules={[{ required: true, message: 'กรุณากรอกชื่อยา' }]}><Input /></Form.Item>
        <Space style={{ display: 'flex' }} align="start" wrap>
          <Form.Item name="category" label="หมวด"><Select allowClear style={{ width: 200 }} options={CATEGORIES.map((v) => ({ value: v }))} /></Form.Item>
          <Form.Item name="unit" label="หน่วย"><Select style={{ width: 110 }} options={UNITS.map((v) => ({ value: v }))} /></Form.Item>
          {!item && <Form.Item name="qty" label="ยอดยกมา"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>}
          <Form.Item name="min_qty" label="จุดสั่งซื้อ (เตือนเมื่อเหลือ ≤)"><InputNumber min={0} style={{ width: 170 }} /></Form.Item>
        </Space>
        <Space style={{ display: 'flex' }} align="start" wrap>
          <Form.Item name="expiry" label="วันหมดอายุ"><DatePicker format="DD/MM/YYYY" /></Form.Item>
          <Form.Item name="lot" label="เลขล็อต"><Input style={{ width: 160 }} /></Form.Item>
          <Form.Item name="location" label="ที่เก็บ"><Input style={{ width: 160 }} /></Form.Item>
        </Space>
        <Form.Item name="note" label="หมายเหตุ"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

// จ่ายยา / รับเข้า / ปรับยอด
function ActionModal({ mode, item, onClose, onSaved }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [visits, setVisits] = useState([]);
  const open = !!mode && !!item;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (mode === 'adjust') form.setFieldsValue({ qty: item.qty });
    if (mode === 'dispense') {
      const since = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
      api('/nurse_visits').then((rows) => setVisits(
        (Array.isArray(rows) ? rows : []).filter((v) => String(v.date).slice(0, 10) >= since),
      )).catch(() => setVisits([]));
    }
  }, [open, mode, item, form]);

  const title = { dispense: 'จ่ายยา', restock: 'รับยาเข้า', adjust: 'ปรับยอดตามการนับจริง' }[mode];

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = { ...v, expiry: v.expiry ? v.expiry.format('YYYY-MM-DD') : undefined };
      await api(`/medicines/${item.id}/${mode}`, 'POST', body);
      message.success(`${title}แล้ว`);
      onSaved();
      onClose();
    } catch (e) {
      message.error(e.message || 'ทำรายการไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={item ? `${title}: ${item.name}` : title} okText="ยืนยัน" cancelText="ยกเลิก"
      onOk={submit} onCancel={onClose} confirmLoading={saving} destroyOnHidden>
      {item && <Text type="secondary">คงเหลือ {item.qty.toLocaleString()} {item.unit}</Text>}
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="qty" label={mode === 'adjust' ? 'ยอดคงเหลือที่นับได้' : `จำนวน (${item?.unit || ''})`}
          rules={[{ required: true, message: 'กรุณากรอกจำนวน' }]}>
          <InputNumber min={mode === 'adjust' ? 0 : 0.01} style={{ width: 160 }} />
        </Form.Item>

        {mode === 'dispense' && (
          <>
            <Form.Item name="visit_id" label="ผูกกับรายการห้องพยาบาล (7 วันล่าสุด) — จะเติมชื่อยาในช่อง “การรักษา/ยาที่ให้” ให้อัตโนมัติ">
              <Select allowClear showSearch optionFilterProp="label" placeholder="เลือกรายการ (ไม่บังคับ)"
                options={visits.map((v) => ({
                  value: v.id,
                  label: `#${v.id} ${String(v.date).slice(5, 10)} ${v.student} (${v.class_room || '-'}) — ${v.symptom}`,
                }))} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.visit_id !== b.visit_id}>
              {({ getFieldValue }) => !getFieldValue('visit_id') && (
                <Space>
                  <Form.Item name="student" label="ชื่อนักเรียน"><Input style={{ width: 220 }} /></Form.Item>
                  <Form.Item name="class_room" label="ชั้น/ห้อง"><Input style={{ width: 110 }} /></Form.Item>
                </Space>
              )}
            </Form.Item>
          </>
        )}

        {mode === 'restock' && (
          <Space>
            <Form.Item name="lot" label="เลขล็อตใหม่"><Input style={{ width: 160 }} /></Form.Item>
            <Form.Item name="expiry" label="วันหมดอายุใหม่"><DatePicker format="DD/MM/YYYY" /></Form.Item>
          </Space>
        )}

        <Form.Item name="note" label={mode === 'adjust' ? 'เหตุผล (จำเป็น)' : 'หมายเหตุ'}
          rules={mode === 'adjust' ? [{ required: true, message: 'กรุณาระบุเหตุผล' }] : []}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function Stock({ tick }) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ open: false, item: null });
  const [action, setAction] = useState({ mode: null, item: null });

  const load = useCallback(() => {
    setLoading(true);
    api('/medicines').then(setRows).catch((e) => message.error(e.message || 'โหลดข้อมูลยาไม่สำเร็จ')).finally(() => setLoading(false));
  }, [message]);
  useEffect(load, [load, tick]);

  const data = useMemo(() => rows.filter((r) =>
    (!q || `${r.name} ${r.category} ${r.lot}`.toLowerCase().includes(q.toLowerCase())) &&
    (filter === 'all' || (filter === 'low' && r.low) || (filter === 'expiry' && (r.expired || r.expiring)))), [rows, q, filter]);

  const remove = async (r) => {
    try { await api(`/medicines/${r.id}`, 'DELETE'); message.success('ลบแล้ว'); load(); } catch (e) { message.error(e.message || 'ลบไม่สำเร็จ'); }
  };

  const columns = [
    { title: 'ชื่อยา', dataIndex: 'name', fixed: 'left', width: 200 },
    { title: 'หมวด', dataIndex: 'category', width: 150, render: (v) => v || '-' },
    {
      title: 'คงเหลือ', dataIndex: 'qty', width: 130, align: 'right',
      render: (v, r) => <Text type={v <= 0 ? 'danger' : r.low ? 'warning' : undefined} strong>{v.toLocaleString()} {r.unit}</Text>,
    },
    { title: 'จุดสั่งซื้อ', dataIndex: 'min_qty', width: 90, align: 'right', render: (v) => v.toLocaleString() },
    {
      title: 'หมดอายุ', dataIndex: 'expiry', width: 140,
      render: (v, r) => (r.expired ? <Tag color="red">หมดอายุ {fmtDate(v)}</Tag>
        : r.expiring ? <Tag color="orange">ใกล้หมด {fmtDate(v)}</Tag> : fmtDate(v)),
    },
    { title: 'ล็อต', dataIndex: 'lot', width: 110, render: (v) => v || '-' },
    { title: 'ที่เก็บ', dataIndex: 'location', width: 120, render: (v) => v || '-' },
    {
      title: 'สถานะ', width: 100,
      render: (_, r) => (r.qty <= 0 ? <Tag color="red">หมด</Tag> : r.low ? <Tag color="orange">ใกล้หมด</Tag> : <Tag color="green">ปกติ</Tag>),
    },
    {
      title: '', fixed: 'right', width: 320,
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size="small" type="primary" disabled={r.qty <= 0 || r.expired} onClick={() => setAction({ mode: 'dispense', item: r })}>จ่ายยา</Button>
          <Button size="small" onClick={() => setAction({ mode: 'restock', item: r })}>รับเข้า</Button>
          <Button size="small" onClick={() => setAction({ mode: 'adjust', item: r })}>ปรับยอด</Button>
          <Button size="small" type="link" onClick={() => setForm({ open: true, item: r })}>แก้ไข</Button>
          <Popconfirm title={`ลบ ${r.name}?`} description="ประวัติรับ/จ่ายยังอยู่" okText="ลบ" cancelText="ยกเลิก" onConfirm={() => remove(r)}>
            <Button size="small" type="link" danger>ลบ</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="ค้นหาชื่อยา / หมวด / ล็อต" style={{ width: 240 }} onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
        <Select value={filter} onChange={setFilter} style={{ width: 170 }}
          options={[{ value: 'all', label: 'ทั้งหมด' }, { value: 'low', label: 'ใกล้หมด/หมด' }, { value: 'expiry', label: 'หมดอายุ/ใกล้หมดอายุ' }]} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, item: null })}>เพิ่มยา</Button>
        <Text type="secondary">{data.length} รายการ · ใกล้หมดอายุ = ภายใน 60 วัน</Text>
      </Space>
      <Table size="small" bordered rowKey="id" loading={loading} columns={columns} dataSource={data}
        scroll={{ x: 'max-content' }} pagination={{ pageSize: 20, hideOnSinglePage: true }} />
      <MedicineForm open={form.open} item={form.item} onClose={() => setForm({ open: false, item: null })} onSaved={load} />
      <ActionModal mode={action.mode} item={action.item} onClose={() => setAction({ mode: null, item: null })} onSaved={load} />
    </>
  );
}

function Logs({ tick }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    api('/medicine_logs?limit=500').then(setRows).finally(() => setLoading(false));
  }, [tick]);

  return (
    <Table size="small" bordered rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      columns={[
        { title: 'วันเวลา', dataIndex: 'created_at', width: 150, render: (v) => dayjs(v).format('DD/MM/YYYY HH:mm') },
        { title: 'รายการ', dataIndex: 'kind', width: 90, render: (v) => <Tag color={KIND[v][1]}>{KIND[v][0]}</Tag> },
        { title: 'ยา', dataIndex: 'medicine_name', width: 200 },
        { title: 'จำนวน', dataIndex: 'qty', width: 90, align: 'right', render: (v, r) => `${r.kind === 'out' ? '-' : r.kind === 'in' ? '+' : '='}${v.toLocaleString()}` },
        { title: 'คงเหลือ', dataIndex: 'balance', width: 90, align: 'right', render: (v) => v.toLocaleString() },
        { title: 'นักเรียน', dataIndex: 'student', width: 200, render: (v, r) => (v ? `${v}${r.class_room ? ` (${r.class_room})` : ''}` : '-') },
        { title: 'หมายเหตุ', dataIndex: 'note', render: (v) => v || '-' },
        { title: 'ผู้ทำรายการ', dataIndex: 'by_user', width: 110 },
      ]}
    />
  );
}

// สโตร์ยาห้องพยาบาล
export default function MedicineStore({ tick }) {
  return (
    <Tabs destroyOnHidden items={[
      { key: 'stock', label: 'คลังยา', children: <Stock tick={tick} /> },
      { key: 'logs', label: 'ประวัติรับ/จ่าย', children: <Logs tick={tick} /> },
    ]} />
  );
}
