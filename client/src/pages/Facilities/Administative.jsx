/**
 * Administration.jsx — หน้าธุรการ (ACR-Management)
 * React + Ant Design v5
 *
 * โครงสร้างตามแผนผังงานธุรการเดิม:
 *  1) งานประจำเดือนตามกำหนดวัน  : ค่าน้ำค่าไฟ(20) · เงินกู้พนักงาน(5) · ปิดยอดเงินกู้(10) · เงินเดือน(25) · OT(25)
 *  2) สรุปบัญชีโรงอาหาร และร้านกาแฟ
 *  3) สรุปเงินรายเดือน
 *       - นำเอกสารที่อนุมัติมาส่งงานงบประมาณ
 *       - สรุปงวดเงินแผนก ส่งงบประมาณ (ภายในวันที่ 8)
 *  4) วาระการประชุม (ตามหัวหน้างานกำหนด): ประชุมฝ่าย · ประชุมพนักงาน
 *  5) ส่งไฟล์ถึง Admin : แนบไฟล์ + ข้อความ แล้วส่งให้ผู้ดูแลระบบ (ใหม่)
 *
 * การเก็บข้อมูล: ตอนนี้ใช้ localStorage (ฟังก์ชัน usePersistentState)
 * เมื่อมี API จริง ให้แทนที่ hook ตัวนั้นด้วยการเรียก service ได้เลย
 *
 * การส่งไฟล์ถึง Admin:
 *  - ส่งด้วย POST multipart/form-data ไปที่ prop `adminEndpoint` (ค่าเริ่มต้น /api/admin/submissions)
 *  - ฟิลด์ที่ส่ง: subject, category, message, month, sender, files (ซ้ำได้หลายไฟล์)
 *  - ตอบกลับสถานะ 2xx = สำเร็จ
 *  - ถ้าต้องใช้ token/axios ให้ส่ง prop `onSubmitToAdmin(formData)` เข้ามาแทน (คืน Promise)
 *  - ไฟล์เองไม่ถูกเก็บใน localStorage เก็บเฉพาะประวัติ (ชื่อไฟล์/ขนาด/สถานะ)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, ConfigProvider, DatePicker, Empty, Form, Input, InputNumber,
  Modal, Popconfirm, Progress, Row, Segmented, Select, Space, Statistic, Table, Tabs, Tag,
  TimePicker, Timeline, Tooltip, Typography, Upload, message,
} from 'antd';
import thTH from 'antd/locale/th_TH';
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CoffeeOutlined, DashboardOutlined,
  DeleteOutlined, DollarOutlined, DownloadOutlined, EditOutlined, ExclamationCircleOutlined,
  FileDoneOutlined, InboxOutlined, PaperClipOutlined, PlusOutlined, SendOutlined, TeamOutlined,
  ThunderboltOutlined, UndoOutlined, WalletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const { Text, Title } = Typography;

/* ------------------------------------------------------------------ */
/* ค่าคงที่                                                             */
/* ------------------------------------------------------------------ */
const STORAGE_KEY = 'acr-management:administration:v1';
const EMPTY_DATA = { duties: {}, canteen: [], docs: [], deptPeriods: [], meetings: [], submissions: [] };

const DEFAULT_ADMIN_ENDPOINT = '/api/admin/submissions';
const MAX_FILES = 5;
const MAX_FILE_MB = 10;
const ACCEPT_FILES = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.zip';
const SUBMIT_CATEGORIES = [
  'เอกสารอนุมัติ',
  'สรุปงวดเงินแผนก',
  'สรุปงวดเงินแผนก ส่งงบประมาณ',
  'บัญชีโรงอาหาร/ร้านกาแฟ',
  'เงินเดือน/OT',
  'วาระการประชุม',
  'อื่น ๆ',
];

const MONTH_DUTIES = [
  { key: 'utility', title: 'ค่าน้ำค่าไฟ', day: 20, icon: <ThunderboltOutlined />, desc: 'ตรวจใบแจ้งหนี้ค่าน้ำ-ค่าไฟและส่งเบิกจ่าย' },
  { key: 'staffLoan', title: 'เงินกู้พนักงาน', day: 5, icon: <WalletOutlined />, desc: 'รวบรวมรายการเงินกู้พนักงานประจำเดือน' },
  { key: 'loanClose', title: 'ปิดยอดเงินกู้', day: 10, icon: <FileDoneOutlined />, desc: 'ปิดยอดเงินกู้และตรวจสอบความถูกต้อง' },
  { key: 'salary', title: 'เงินเดือน', day: 25, icon: <DollarOutlined />, desc: 'จัดทำและส่งข้อมูลเงินเดือน' },
  { key: 'ot', title: 'OT', day: 25, icon: <ClockCircleOutlined />, desc: 'สรุปค่าล่วงเวลา (OT) ของพนักงาน' },
];

const SHOPS = ['โรงอาหาร', 'ร้านกาแฟ'];
const MEETING_TYPES = ['ประชุมฝ่าย', 'ประชุมพนักงาน'];
const MEETING_TYPE_COLOR = { ประชุมฝ่าย: 'geekblue', ประชุมพนักงาน: 'cyan' };
const MEETING_STATUS = {
  planned: { label: 'กำหนดการ', color: 'blue' },
  done: { label: 'ประชุมแล้ว', color: 'green' },
  cancelled: { label: 'ยกเลิก', color: 'default' },
};
const BUDGET_DEADLINE_DAY = 8; // สรุปงวดเงินแผนกส่งงบประมาณภายในวันที่ 8 (ของเดือนถัดไป)

const STATUS_TAG = {
  done: { color: 'success', text: 'เสร็จแล้ว' },
  overdue: { color: 'error', text: 'เลยกำหนด' },
  soon: { color: 'warning', text: 'ใกล้ครบกำหนด' },
  pending: { color: 'default', text: 'รอดำเนินการ' },
};
const STATUS_COLOR = { done: 'green', overdue: 'red', soon: 'orange', pending: 'blue' };

/* ------------------------------------------------------------------ */
/* ตัวช่วย                                                              */
/* ------------------------------------------------------------------ */
const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) =>
  Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const beYear = (d) => d.year() + 543;
const thMonthYear = (d) => `${d.locale('th').format('MMMM')} ${beYear(d)}`;
const thDate = (v) => {
  if (!v) return '-';
  const d = dayjs(v);
  return `${d.locale('th').format('D MMM')} ${beYear(d)}`;
};
const thDateTime = (v) => (v ? `${thDate(v)} ${dayjs(v).format('HH:mm')} น.` : '-');
const fileSize = (b = 0) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
// อ่าน token ล็อกอินจาก localStorage/sessionStorage (ลองชื่อ key ที่พบบ่อย)
// ถ้าโปรเจกต์ใช้ชื่ออื่น ให้เพิ่มชื่อใน TOKEN_KEYS หรือส่ง prop getToken เข้ามา
const TOKEN_KEYS = ['token', 'acr_token', 'acr-token', 'authToken', 'auth_token', 'accessToken', 'access_token', 'jwt'];
const readToken = () => {
  for (const store of [localStorage, sessionStorage]) {
    for (const k of TOKEN_KEYS) {
      try {
        const v = store.getItem(k);
        if (v) return v.replace(/^"|"$/g, '');
      } catch {
        /* อ่านไม่ได้ก็ข้าม */
      }
    }
  }
  return '';
};
const monthKey = (d) => d.format('YYYY-MM');
const deadlineOf = (mk, day) => {
  const m = dayjs(`${mk}-01`);
  return m.date(Math.min(day, m.daysInMonth())).endOf('day');
};
const getStatus = (deadline, done) => {
  if (done) return 'done';
  const now = dayjs();
  if (now.isAfter(deadline)) return 'overdue';
  if (deadline.diff(now, 'day') <= 3) return 'soon';
  return 'pending';
};
const sumShop = (rows, shop) =>
  rows
    .filter((r) => !shop || r.shop === shop)
    .reduce(
      (a, r) => ({ income: a.income + (r.income || 0), expense: a.expense + (r.expense || 0) }),
      { income: 0, expense: 0 },
    );

function usePersistentState(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* เก็บไม่ได้ก็ข้ามไป */
    }
  }, [key, state]);
  return [state, setState];
}

function useModalState() {
  const [s, setS] = useState({ open: false, record: null });
  return {
    ...s,
    show: (record = null) => setS({ open: true, record }),
    close: () => setS((p) => ({ ...p, open: false })),
  };
}

function downloadCsv(filename, rows) {
  const csv =
    '\ufeff' +
    rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* ส่วนประกอบใช้ซ้ำ                                                       */
/* ------------------------------------------------------------------ */
function RecordModal({ open, title, record, toForm, fromForm, onClose, onSubmit, width = 520, children }) {
  const [form] = Form.useForm();
  // เปลี่ยน key ทุกครั้งที่เปิด เพื่อให้ฟอร์มเริ่มจากค่าเริ่มต้นใหม่เสมอ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const formKey = useMemo(() => `${open}-${record?.id ?? 'new'}-${Date.now()}`, [open, record]);

  const handleOk = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    onSubmit({ ...(record || {}), ...(fromForm ? fromForm(values) : values), id: record?.id || uid() });
    onClose();
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      onOk={handleOk}
      okText="บันทึก"
      cancelText="ยกเลิก"
      width={width}
      maskClosable={false}
    >
      <Form
        key={formKey}
        form={form}
        layout="vertical"
        requiredMark="optional"
        initialValues={toForm ? toForm(record) : record}
      >
        {children}
      </Form>
    </Modal>
  );
}

const RowActions = ({ onEdit, onDelete, children }) => (
  <Space size={4}>
    {children}
    {onEdit && (
      <Tooltip title="แก้ไข">
        <Button type="text" icon={<EditOutlined />} onClick={onEdit} />
      </Tooltip>
    )}
    <Popconfirm
      title="ลบรายการนี้?"
      okText="ลบ"
      cancelText="ยกเลิก"
      okButtonProps={{ danger: true }}
      onConfirm={onDelete}
    >
      <Button type="text" danger icon={<DeleteOutlined />} />
    </Popconfirm>
  </Space>
);

const cardStyle = { borderRadius: 12 };
const moneyInput = <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="บาท" />;

/* ------------------------------------------------------------------ */
/* แท็บ: ภาพรวม                                                         */
/* ------------------------------------------------------------------ */
function OverviewTab({ totals, percent, timelineItems, canteenNet, budgetInfo }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {budgetInfo.alert}
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <Statistic title="งานประจำเดือน" value={`${totals.dutiesDone}/${totals.duties}`} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <Statistic title="เอกสารส่งงบประมาณแล้ว" value={`${totals.docsSent}/${totals.docs}`} prefix={<FileDoneOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <Statistic
              title="ยอดสุทธิโรงอาหาร+กาแฟ (บาท)"
              value={canteenNet}
              precision={2}
              valueStyle={{ color: canteenNet >= 0 ? '#389e0d' : '#cf1322' }}
              prefix={<CoffeeOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <Statistic title="ประชุมแล้ว" value={`${totals.meetingsDone}/${totals.meetings}`} prefix={<TeamOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title="ความคืบหน้าเดือนนี้" style={cardStyle}>
            <div style={{ textAlign: 'center' }}>
              <Progress type="dashboard" percent={percent} strokeColor={{ '0%': '#69b1ff', '100%': '#1677ff' }} />
              <div>
                <Text type="secondary">
                  รวมงานประจำ เอกสาร สรุปงวดเงินแผนก และการประชุม ({totals.done}/{totals.total} รายการ)
                </Text>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title="กำหนดการประจำเดือน" style={cardStyle}>
            {timelineItems.length ? (
              <Timeline mode="left" items={timelineItems} style={{ marginTop: 8 }} />
            ) : (
              <Empty description="ยังไม่มีกำหนดการ" />
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* ตัวช่วยส่งรายการใดก็ได้พร้อมเอกสารให้ Admin                         */
/* ------------------------------------------------------------------ */
function SubmissionButton({ onSendToAdmin, monthKeyStr, subject, category, details = '', buttonText = 'ส่งงาน + แนบไฟล์', buttonType = 'default' }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [form] = Form.useForm();
  const submit = async (values) => {
    const files = (values.files || []).map((item) => item.originFileObj || item).filter(Boolean);
    setSending(true);
    try {
      await onSendToAdmin({
        subject,
        category,
        message: [details, values.message?.trim()].filter(Boolean).join('\n'),
        month: monthKeyStr,
        files,
      });
      message.success('ส่งรายการพร้อมเอกสารให้แอดมินตรวจสอบแล้ว');
      setOpen(false);
      form.resetFields();
    } catch (error) {
      message.error(error?.message || 'ส่งไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally { setSending(false); }
  };
  return <>
    <Button size="small" type={buttonType} icon={<PaperClipOutlined />} onClick={() => { form.resetFields(); setOpen(true); }}>{buttonText}</Button>
    <Modal
      open={open}
      title={`ส่งรายการพร้อมเอกสาร - ${subject}`}
      okText="ส่งให้แอดมินตรวจสอบ"
      cancelText="ยกเลิก"
      confirmLoading={sending}
      onCancel={() => { if (!sending) setOpen(false); }}
      onOk={() => form.submit()}
      destroyOnClose
      maskClosable={false}
      width={650}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={category} description={`เดือน ${monthKeyStr}${details ? ` · ${details}` : ''}`} />
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ files: [], message: '' }}>
        <Form.Item name="message" label="หมายเหตุถึงแอดมิน"><Input.TextArea rows={3} maxLength={1000} showCount placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)" /></Form.Item>
        <Form.Item label={`เอกสารแนบ (สูงสุด ${MAX_FILES} ไฟล์ ไฟล์ละไม่เกิน ${MAX_FILE_MB} MB)`} required>
          <Form.Item name="files" valuePropName="fileList" getValueFromEvent={(event) => Array.isArray(event) ? event : event?.fileList} noStyle rules={[{ validator: (_, value) => !value?.length ? Promise.reject(new Error('กรุณาแนบเอกสารอย่างน้อย 1 ไฟล์')) : value.length > MAX_FILES ? Promise.reject(new Error(`แนบได้สูงสุด ${MAX_FILES} ไฟล์`)) : Promise.resolve() }]}>
            <Upload.Dragger multiple accept={ACCEPT_FILES} maxCount={MAX_FILES} beforeUpload={(file) => file.size > MAX_FILE_MB * 1024 * 1024 ? (message.error(`${file.name} ใหญ่เกิน ${MAX_FILE_MB} MB`), Upload.LIST_IGNORE) : false}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">คลิกหรือลากไฟล์มาวางที่นี่</p>
              <p className="ant-upload-hint">PDF, Word, Excel, PowerPoint, รูปภาพ, CSV หรือ ZIP</p>
            </Upload.Dragger>
          </Form.Item>
        </Form.Item>
      </Form>
    </Modal>
  </>;
}

/* ------------------------------------------------------------------ */
/* แท็บ: งานประจำเดือน                                                   */
/* ------------------------------------------------------------------ */
function DutiesTab({ rows, monthKeyStr, setDuty, onSendToAdmin }) {
  const columns = [
    {
      title: 'งาน',
      dataIndex: 'title',
      render: (_, r) => (
        <Space align="start">
          <span style={{ color: '#1677ff', fontSize: 18 }}>{r.icon}</span>
          <div>
            <Text strong>{r.title}</Text>
            <div><Text type="secondary" style={{ fontSize: 12 }}>{r.desc}</Text></div>
          </div>
        </Space>
      ),
    },
    {
      title: 'กำหนด',
      width: 170,
      render: (_, r) => (
        <div>
          <Tag color="cyan">ทุกวันที่ {r.day}</Tag>
          <div><Text type="secondary" style={{ fontSize: 12 }}>{thDate(r.deadline)}</Text></div>
        </div>
      ),
    },
    {
      title: 'สถานะ',
      width: 140,
      render: (_, r) => <Tag color={STATUS_TAG[r.status].color}>{STATUS_TAG[r.status].text}</Tag>,
    },
    {
      title: 'หมายเหตุ',
      width: 240,
      render: (_, r) => (
        <Input
          key={`${monthKeyStr}-${r.key}`}
          placeholder="บันทึกเพิ่มเติม"
          defaultValue={r.note}
          onBlur={(e) => e.target.value !== r.note && setDuty(r.key, { note: e.target.value })}
        />
      ),
    },
    {
      title: '',
      width: 290,
      align: 'right',
      render: (_, r) => <Space wrap><SubmissionButton onSendToAdmin={onSendToAdmin} monthKeyStr={monthKeyStr} subject={`${r.title} ประจำเดือน ${monthKeyStr}`} category="งานประจำเดือน" details={`งาน: ${r.title}\nกำหนดส่ง: วันที่ ${r.day}\nสถานะ: ${STATUS_TAG[r.status].text}\nหมายเหตุ: ${r.note || '-'}`} />{r.done ? (
          <Button icon={<UndoOutlined />} onClick={() => setDuty(r.key, { done: false, doneAt: null })}>
            ยกเลิกเสร็จ
          </Button>
        ) : (
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setDuty(r.key, { done: true, doneAt: dayjs().toISOString() })}>
            ทำเสร็จแล้ว
          </Button>
        )}</Space>,
    },
  ];
  return (
    <Card style={cardStyle} title="งานประจำเดือนตามกำหนดวัน">
      <Table rowKey="key" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 800 }} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* แท็บ: สรุปบัญชีโรงอาหาร และร้านกาแฟ                                     */
/* ------------------------------------------------------------------ */
function CanteenTab({ rows, monthKeyStr, defaultDate, upsert, remove, onSendToAdmin }) {
  const [shop, setShop] = useState('ทั้งหมด');
  const modal = useModalState();
  const filtered = useMemo(
    () => rows.filter((r) => shop === 'ทั้งหมด' || r.shop === shop).sort((a, b) => a.date.localeCompare(b.date)),
    [rows, shop],
  );
  const total = sumShop(filtered);

  const columns = [
    { title: 'วันที่', dataIndex: 'date', width: 130, render: thDate },
    { title: 'ร้าน', dataIndex: 'shop', width: 120, render: (s) => <Tag color={s === 'โรงอาหาร' ? 'geekblue' : 'volcano'}>{s}</Tag> },
    { title: 'รายรับ', dataIndex: 'income', align: 'right', render: (v) => money(v) },
    { title: 'รายจ่าย', dataIndex: 'expense', align: 'right', render: (v) => money(v) },
    {
      title: 'สุทธิ',
      align: 'right',
      render: (_, r) => {
        const net = (r.income || 0) - (r.expense || 0);
        return <Text type={net < 0 ? 'danger' : 'success'}>{money(net)}</Text>;
      },
    },
    { title: 'หมายเหตุ', dataIndex: 'note', ellipsis: true },
    { title: '', width: 100, align: 'right', render: (_, r) => <RowActions onEdit={() => modal.show(r)} onDelete={() => remove('canteen', r.id)} /> },
  ];

  const exportCsv = () =>
    downloadCsv(`สรุปบัญชีร้านค้า-${monthKeyStr}.csv`, [
      ['วันที่', 'ร้าน', 'รายรับ', 'รายจ่าย', 'สุทธิ', 'หมายเหตุ'],
      ...filtered.map((r) => [r.date, r.shop, r.income, r.expense, (r.income || 0) - (r.expense || 0), r.note]),
    ]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        {SHOPS.map((s) => {
          const t = sumShop(rows, s);
          return (
            <Col xs={24} md={12} key={s}>
              <Card title={s} style={cardStyle} size="small">
                <Row gutter={8}>
                  <Col span={8}><Statistic title="รายรับ" value={t.income} precision={2} /></Col>
                  <Col span={8}><Statistic title="รายจ่าย" value={t.expense} precision={2} /></Col>
                  <Col span={8}>
                    <Statistic title="คงเหลือ" value={t.income - t.expense} precision={2} valueStyle={{ color: t.income - t.expense >= 0 ? '#389e0d' : '#cf1322' }} />
                  </Col>
                </Row>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card
        style={cardStyle}
        title="รายการบัญชีรายวัน"
        extra={
          <Space wrap>
            <Segmented options={['ทั้งหมด', ...SHOPS]} value={shop} onChange={setShop} />
            <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!filtered.length}>ส่งออก CSV</Button>
            <SubmissionButton onSendToAdmin={onSendToAdmin} monthKeyStr={monthKeyStr} subject={`สรุปบัญชี${shop === 'ทั้งหมด' ? 'โรงอาหารและร้านกาแฟ' : shop} ประจำเดือน ${monthKeyStr}`} category={shop === 'ทั้งหมด' ? 'บัญชีโรงอาหาร/ร้านกาแฟ' : `บัญชี${shop}`} buttonText="ส่งงาน + แนบไฟล์" details={`รายการ ${filtered.length} รายการ\nรายรับรวม ${money(total.income)} บาท\nรายจ่ายรวม ${money(total.expense)} บาท\nยอดสุทธิ ${money(total.income - total.expense)} บาท`} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => modal.show()}>เพิ่มรายการ</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          scroll={{ x: 760 }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="ยังไม่มีรายการในเดือนนี้" /> }}
          summary={() =>
            filtered.length ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}><Text strong>รวม</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right"><Text strong>{money(total.income)}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right"><Text strong>{money(total.expense)}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right"><Text strong>{money(total.income - total.expense)}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={5} colSpan={2} />
              </Table.Summary.Row>
            ) : null
          }
        />
      </Card>

      <RecordModal
        open={modal.open}
        record={modal.record}
        title={modal.record ? 'แก้ไขรายการบัญชี' : 'เพิ่มรายการบัญชี'}
        onClose={modal.close}
        onSubmit={(r) => upsert('canteen', r)}
        toForm={(r) => ({ shop: 'โรงอาหาร', income: 0, expense: 0, ...r, date: dayjs(r?.date || defaultDate) })}
        fromForm={(v) => ({ ...v, date: v.date.format('YYYY-MM-DD') })}
      >
        <Form.Item name="date" label="วันที่" rules={[{ required: true, message: 'เลือกวันที่' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="shop" label="ร้าน" rules={[{ required: true }]}>
          <Select options={SHOPS.map((s) => ({ value: s, label: s }))} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="income" label="รายรับ">{moneyInput}</Form.Item></Col>
          <Col span={12}><Form.Item name="expense" label="รายจ่าย">{moneyInput}</Form.Item></Col>
        </Row>
        <Form.Item name="note" label="หมายเหตุ"><Input.TextArea rows={2} /></Form.Item>
      </RecordModal>
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* แท็บ: สรุปเงินรายเดือน                                                 */
/* ------------------------------------------------------------------ */
function FinanceTab({ docs, depts, monthKeyStr, budgetInfo, upsert, remove, onSendToAdmin }) {
  const docModal = useModalState();
  const deptModal = useModalState();
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendRecord, setSendRecord] = useState(null);
  const [sendForm] = Form.useForm();
  const [sending, setSending] = useState(false);

  const openSendModal = (record) => {
    setSendRecord(record);
    sendForm.resetFields();
    sendForm.setFieldsValue({ files: [], message: '' });
    setSendModalOpen(true);
  };

  const submitDeptPeriod = async (values) => {
    if (!sendRecord) return;
    const files = (values.files || []).map((item) => item.originFileObj || item).filter(Boolean);
    setSending(true);
    try {
      const result = await onSendToAdmin({
        subject: `สรุปงวดเงินแผนก ส่งงบประมาณ - ${sendRecord.dept}`,
        category: 'สรุปงวดเงินแผนก ส่งงบประมาณ',
        message: [`แผนก: ${sendRecord.dept}`, `งวดเงิน: ${money(sendRecord.amount)} บาท`, values.message?.trim()].filter(Boolean).join('\n'),
        month: monthKeyStr,
        files,
      });
      upsert('deptPeriods', { ...sendRecord, submitted: true, submittedAt: dayjs().toISOString(), adminSubmissionId: result?.id || null, approvalStatus: 'pending' }, true);
      message.success('ส่งงานพร้อมเอกสารให้แอดมินตรวจสอบแล้ว');
      setSendModalOpen(false);
      setSendRecord(null);
      sendForm.resetFields();
    } catch (error) {
      message.error(error?.message || 'ส่งงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setSending(false);
    }
  };
  const docsSent = docs.filter((d) => d.sent).length;
  const docPercent = docs.length ? Math.round((docsSent / docs.length) * 100) : 0;

  const docColumns = [
    { title: 'เอกสาร', dataIndex: 'name' },
    { title: 'แผนก', dataIndex: 'dept', width: 150 },
    { title: 'เลขที่อนุมัติ', dataIndex: 'refNo', width: 140, render: (v) => v || '-' },
    { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', width: 140, render: (v) => money(v) },
    {
      title: 'ส่งงานงบประมาณ',
      width: 170,
      render: (_, r) => (
        <Checkbox
          checked={!!r.sent}
          onChange={(e) => upsert('docs', { ...r, sent: e.target.checked, sentAt: e.target.checked ? dayjs().toISOString() : null }, true)}
        >
          {r.sent ? `ส่งแล้ว ${thDate(r.sentAt)}` : 'ยังไม่ส่ง'}
        </Checkbox>
      ),
    },
    { title: 'ส่งงาน + แนบไฟล์', width: 210, align: 'right', render: (_, r) => <Space wrap><SubmissionButton onSendToAdmin={onSendToAdmin} monthKeyStr={monthKeyStr} subject={`${r.name} - ${r.dept || 'ไม่ระบุแผนก'}`} category="สรุปเงินรายเดือน" details={`ชื่อเอกสาร: ${r.name}\nแผนก: ${r.dept || '-'}\nเลขที่อนุมัติ: ${r.refNo || '-'}\nจำนวนเงิน: ${money(r.amount)} บาท`} /><RowActions onEdit={() => docModal.show(r)} onDelete={() => remove('docs', r.id)} /></Space> },
  ];

  const deptColumns = [
    { title: 'แผนก', dataIndex: 'dept' },
    { title: 'งวดเงิน (บาท)', dataIndex: 'amount', align: 'right', width: 160, render: (v) => money(v) },
    { title: 'สถานะ', width: 170, render: (_, r) => (r.submitted ? <Tag color="success">ส่งให้แอดมินแล้ว</Tag> : <Tag>ฉบับร่าง</Tag>) },
    { title: 'วันที่ส่ง', dataIndex: 'submittedAt', width: 140, render: (v) => thDate(v) },
    {
      title: '',
      width: 180,
      align: 'right',
      render: (_, r) => (
        <RowActions onEdit={() => deptModal.show(r)} onDelete={() => remove('deptPeriods', r.id)}>
          <Button size="small" type="primary" icon={<SendOutlined />} disabled={!!r.submitted} onClick={() => openSendModal(r)}>{r.submitted ? 'ส่งแล้ว' : 'ส่งงาน + แนบไฟล์'}</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        style={cardStyle}
        title="นำเอกสารที่อนุมัติมาส่งงานงบประมาณ"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => docModal.show()}>เพิ่มเอกสาร</Button>}
      >
        <Progress percent={docPercent} format={() => `${docsSent}/${docs.length}`} style={{ marginBottom: 12 }} />
        <Table
          rowKey="id"
          columns={docColumns}
          dataSource={docs}
          pagination={false}
          scroll={{ x: 820 }}
          locale={{ emptyText: <Empty description="ยังไม่มีเอกสารที่อนุมัติ" /> }}
        />
      </Card>

      <Card
        style={cardStyle}
        title={
          <Space wrap>
            <span>สรุปงวดเงินแผนก ส่งงบประมาณ</span>
            <Tag color="red">ภายในวันที่ {BUDGET_DEADLINE_DAY}</Tag>
          </Space>
        }
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => deptModal.show()}>เพิ่มแผนก</Button>}
      >
        {budgetInfo.alert}
        <Table
          style={{ marginTop: 12 }}
          rowKey="id"
          columns={deptColumns}
          dataSource={depts}
          pagination={false}
          scroll={{ x: 740 }}
          locale={{ emptyText: <Empty description="ยังไม่มีข้อมูลงวดเงินแผนก" /> }}
        />
      </Card>

      <RecordModal
        open={docModal.open}
        record={docModal.record}
        title={docModal.record ? 'แก้ไขเอกสาร' : 'เพิ่มเอกสารที่อนุมัติ'}
        onClose={docModal.close}
        onSubmit={(r) => upsert('docs', { month: monthKeyStr, sent: false, ...r })}
        toForm={(r) => ({ amount: 0, ...r })}
      >
        <Form.Item name="name" label="ชื่อเอกสาร" rules={[{ required: true, message: 'กรอกชื่อเอกสาร' }]}><Input /></Form.Item>
        <Form.Item name="dept" label="แผนก"><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="refNo" label="เลขที่อนุมัติ"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="amount" label="จำนวนเงิน">{moneyInput}</Form.Item></Col>
        </Row>
      </RecordModal>

      <Modal
        open={sendModalOpen}
        title={`ส่งสรุปงวดเงินแผนกพร้อมเอกสาร${sendRecord?.dept ? ` - ${sendRecord.dept}` : ''}`}
        okText="ส่งให้แอดมินตรวจสอบ"
        cancelText="ยกเลิก"
        confirmLoading={sending}
        onCancel={() => { if (!sending) { setSendModalOpen(false); setSendRecord(null); } }}
        onOk={() => sendForm.submit()}
        destroyOnClose
        maskClosable={false}
      >
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="เอกสารจะถูกบันทึกพร้อมรายการส่งงาน และส่งให้แอดมินอนุมัติ" description={`งวดเดือน ${monthKeyStr} · แผนก ${sendRecord?.dept || '-'} · จำนวนเงิน ${money(sendRecord?.amount)} บาท`} />
        <Form form={sendForm} layout="vertical" onFinish={submitDeptPeriod} initialValues={{ files: [], message: '' }}>
          <Form.Item name="message" label="หมายเหตุถึงแอดมิน"><Input.TextArea rows={3} maxLength={1000} showCount placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)" /></Form.Item>
          <Form.Item label="เอกสารประกอบ" required>
            <Form.Item name="files" valuePropName="fileList" getValueFromEvent={(event) => Array.isArray(event) ? event : event?.fileList} noStyle rules={[{ validator: (_, value) => !value?.length ? Promise.reject(new Error('กรุณาแนบเอกสารอย่างน้อย 1 ไฟล์')) : value.length > MAX_FILES ? Promise.reject(new Error(`แนบได้สูงสุด ${MAX_FILES} ไฟล์`)) : Promise.resolve() }]}>
              <Upload.Dragger multiple accept={ACCEPT_FILES} maxCount={MAX_FILES} beforeUpload={(file) => file.size > MAX_FILE_MB * 1024 * 1024 ? (message.error(`${file.name} ใหญ่เกิน ${MAX_FILE_MB} MB`), Upload.LIST_IGNORE) : false}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">คลิกหรือลากไฟล์มาวางที่นี่</p>
                <p className="ant-upload-hint">PDF, Word, Excel, PowerPoint, รูปภาพ, CSV หรือ ZIP · สูงสุด {MAX_FILES} ไฟล์ · ไฟล์ละไม่เกิน {MAX_FILE_MB} MB</p>
              </Upload.Dragger>
            </Form.Item>
          </Form.Item>
        </Form>
      </Modal>

      <RecordModal
        open={deptModal.open}
        record={deptModal.record}
        title={deptModal.record ? 'แก้ไขงวดเงินแผนก' : 'เพิ่มงวดเงินแผนก'}
        onClose={deptModal.close}
        onSubmit={(r) => upsert('deptPeriods', { month: monthKeyStr, submitted: false, ...r })}
        toForm={(r) => ({ amount: 0, ...r })}
      >
        <Form.Item name="dept" label="แผนก" rules={[{ required: true, message: 'กรอกชื่อแผนก' }]}><Input /></Form.Item>
        <Form.Item name="amount" label="งวดเงิน">{moneyInput}</Form.Item>
      </RecordModal>
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* แท็บ: วาระการประชุม                                                   */
/* ------------------------------------------------------------------ */
function MeetingsTab({ rows, defaultDate, monthKeyStr, upsert, remove, onSendToAdmin }) {
  const [type, setType] = useState('ทั้งหมด');
  const modal = useModalState();
  const list = useMemo(
    () =>
      rows
        .filter((m) => type === 'ทั้งหมด' || m.type === type)
        .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`)),
    [rows, type],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        style={cardStyle}
        title={
          <Space wrap>
            <span>วาระการประชุม</span>
            <Tag color="red">ตามหัวหน้างานกำหนด</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Segmented options={['ทั้งหมด', ...MEETING_TYPES]} value={type} onChange={setType} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => modal.show()}>เพิ่มการประชุม</Button>
          </Space>
        }
      >
        {list.length ? (
          <Row gutter={[16, 16]}>
            {list.map((m) => (
              <Col xs={24} lg={12} key={m.id}>
                <Card
                  size="small"
                  style={{ borderRadius: 10, opacity: m.status === 'cancelled' ? 0.6 : 1 }}
                  title={
                    <Space wrap>
                      <Tag color={MEETING_TYPE_COLOR[m.type]}>{m.type}</Tag>
                      <Text strong>{m.title}</Text>
                    </Space>
                  }
                  extra={<Tag color={MEETING_STATUS[m.status || 'planned'].color}>{MEETING_STATUS[m.status || 'planned'].label}</Tag>}
                  actions={[
                    m.status === 'done' ? (
                      <Button key="u" type="link" icon={<UndoOutlined />} onClick={() => upsert('meetings', { ...m, status: 'planned' }, true)}>ยกเลิกสถานะ</Button>
                    ) : (
                      <Button key="d" type="link" icon={<CheckCircleOutlined />} onClick={() => upsert('meetings', { ...m, status: 'done' }, true)}>ประชุมแล้ว</Button>
                    ),
                    <SubmissionButton key="s" onSendToAdmin={onSendToAdmin} monthKeyStr={monthKeyStr} subject={`วาระการประชุม: ${m.title}`} category="วาระการประชุม" buttonText="ส่งงาน + แนบไฟล์" details={`ประเภท: ${m.type}\nวันที่: ${thDate(m.date)}\nเวลา: ${m.time || '-'}\nสถานที่: ${m.place || '-'}\nผู้กำหนด: ${m.setBy || '-'}\nวาระ: ${(m.agenda || []).map((a, i) => `${i + 1}. ${a.text}`).join(' | ')}`} />,
                    <Button key="e" type="link" icon={<EditOutlined />} onClick={() => modal.show(m)}>แก้ไข</Button>,
                    <Popconfirm key="x" title="ลบการประชุมนี้?" okText="ลบ" cancelText="ยกเลิก" okButtonProps={{ danger: true }} onConfirm={() => remove('meetings', m.id)}>
                      <Button type="link" danger icon={<DeleteOutlined />}>ลบ</Button>
                    </Popconfirm>,
                  ]}
                >
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text><CalendarOutlined /> {thDate(m.date)}{m.time ? ` · ${m.time} น.` : ''}{m.place ? ` · ${m.place}` : ''}</Text>
                    {m.setBy && <Text type="secondary">กำหนดโดย: {m.setBy}</Text>}
                    <div style={{ marginTop: 8 }}>
                      <Text strong>วาระ</Text>
                      {(m.agenda || []).length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                          {m.agenda.map((a, i) => (
                            <Checkbox
                              key={i}
                              checked={!!a.done}
                              onChange={(e) =>
                                upsert('meetings', { ...m, agenda: m.agenda.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) }, true)
                              }
                            >
                              <span style={{ textDecoration: a.done ? 'line-through' : 'none' }}>{i + 1}. {a.text}</span>
                            </Checkbox>
                          ))}
                        </div>
                      ) : (
                        <div><Text type="secondary">ยังไม่มีวาระ</Text></div>
                      )}
                    </div>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty description="ยังไม่มีการประชุมในเดือนนี้" />
        )}
      </Card>

      <RecordModal
        open={modal.open}
        record={modal.record}
        width={600}
        title={modal.record ? 'แก้ไขการประชุม' : 'เพิ่มการประชุม'}
        onClose={modal.close}
        onSubmit={(r) => upsert('meetings', r)}
        toForm={(r) => ({
          type: 'ประชุมฝ่าย',
          status: 'planned',
          agenda: [{ text: '', done: false }],
          ...r,
          date: dayjs(r?.date || defaultDate),
          time: r?.time ? dayjs(r.time, 'HH:mm') : null,
        })}
        fromForm={(v) => ({ ...v, date: v.date.format('YYYY-MM-DD'), time: v.time ? v.time.format('HH:mm') : '', agenda: v.agenda || [] })}
      >
        <Form.Item name="type" label="ประเภทการประชุม" rules={[{ required: true }]}>
          <Segmented options={MEETING_TYPES} />
        </Form.Item>
        <Form.Item name="title" label="หัวข้อการประชุม" rules={[{ required: true, message: 'กรอกหัวข้อ' }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="date" label="วันที่" rules={[{ required: true, message: 'เลือกวันที่' }]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="time" label="เวลา"><TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="place" label="สถานที่"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="setBy" label="หัวหน้างานผู้กำหนด"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="status" label="สถานะ">
          <Select options={Object.entries(MEETING_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        </Form.Item>
        <Form.Item label="วาระการประชุม">
          <Form.List name="agenda">
            {(fields, { add, remove: rm }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex', width: '100%' }}>
                    <Form.Item name={[f.name, 'text']} rules={[{ required: true, message: 'กรอกหัวข้อวาระ' }]} style={{ flex: 1, marginBottom: 8, minWidth: 380 }}>
                      <Input placeholder={`วาระที่ ${f.name + 1}`} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'done']} valuePropName="checked" hidden><Checkbox /></Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => rm(f.name)} />
                  </Space>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ text: '', done: false })}>เพิ่มวาระ</Button>
              </>
            )}
          </Form.List>
        </Form.Item>
      </RecordModal>
    </Space>
  );
}

/* ------------------------------------------------------------------ */
/* แท็บ: ส่งไฟล์ถึง Admin                                                */
/* ------------------------------------------------------------------ */
function AdminSubmitTab({ rows = [], monthKeyStr, onSend, upsert, remove, notify }) {
  const [activeCategory, setActiveCategory] = useState('งานประจำเดือน');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historySearch, setHistorySearch] = useState('');

  const categories = [
    { key: 'งานประจำเดือน', title: 'งานประจำเดือน', desc: 'ส่งเอกสารงานประจำเดือน เช่น ค่าน้ำค่าไฟ เงินกู้พนักงาน เงินเดือน และ OT', icon: <CalendarOutlined />, color: '#1677ff' },
    { key: 'บัญชีโรงอาหาร', title: 'บัญชีโรงอาหาร', desc: 'ส่งรายงานรายรับ รายจ่าย และเอกสารบัญชีโรงอาหารประจำเดือน', icon: <TeamOutlined />, color: '#389e0d' },
    { key: 'บัญชีร้านกาแฟ', title: 'บัญชีร้านกาแฟ', desc: 'ส่งสรุปยอดขาย ต้นทุน และเอกสารบัญชีร้านกาแฟประจำเดือน', icon: <CoffeeOutlined />, color: '#d48806' },
  ];
  const selectedCategory = categories.find(c => c.key === activeCategory) || categories[0];

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const token = readToken();
      const res = await fetch('/api/admin/submissions/mine', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('โหลดประวัติจากเซิร์ฟเวอร์ไม่สำเร็จ');
      setHistory(await res.json());
    } catch (e) {
      notify.error(e.message || 'โหลดประวัติไม่สำเร็จ');
    } finally { setLoadingHistory(false); }
  };
  useEffect(() => { loadHistory(); }, []);

  const beforeUpload = (file) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      notify.error(`${file.name} ใหญ่เกิน ${MAX_FILE_MB} MB`);
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  const handleFinish = async (v) => {
    const fileObjs = (v.files || []).map((f) => f.originFileObj || f).filter(Boolean);
    setSending(true);
    try {
      await onSend({ subject: v.subject, category: activeCategory, message: v.message || '', month: monthKeyStr, files: fileObjs });
      notify.success('ส่งเอกสารให้แอดมินตรวจสอบแล้ว');
      form.resetFields();
      setCreateModalOpen(false);
      await loadHistory();
    } catch (err) {
      notify.error(`ส่งไม่สำเร็จ: ${err?.message || 'ไม่ทราบสาเหตุ'}`);
    } finally { setSending(false); }
  };

  const download = async (file) => {
    try {
      const token = readToken();
      const res = await fetch(`/api/admin/submissions/files/${file.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('ดาวน์โหลดไฟล์ไม่สำเร็จ');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name || 'attachment'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { notify.error(e.message || 'ดาวน์โหลดไฟล์ไม่สำเร็จ'); }
  };

  const statusInfo = {
    pending: { label: 'รอแอดมินตรวจสอบ', color: 'gold' },
    approved: { label: 'อนุมัติแล้ว', color: 'green' },
    rejected: { label: 'ส่งกลับแก้ไข', color: 'red' },
  };
  const filteredHistory = history.filter(r => {
    const status = r.status || 'pending';
    const statusMatch = historyStatus === 'all' || status === historyStatus;
    const q = historySearch.trim().toLowerCase();
    const searchMatch = !q || [r.subject, r.category, r.message, r.review_note, r.reviewed_by, r.month].some(v => String(v || '').toLowerCase().includes(q));
    return statusMatch && searchMatch;
  });
  const historyPageSize = 8;
  const [historyPage, setHistoryPage] = useState(1);
  const pageHistory = filteredHistory.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);


  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card style={cardStyle} title={<Space><PaperClipOutlined /> ส่งเอกสารให้แอดมินตรวจสอบ</Space>} extra={<Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)} style={{ borderRadius: 9, fontWeight: 600 }}>เพิ่มเอกสาร</Button>}>
      <Alert type="info" showIcon message="ส่งเอกสารให้แอดมินตรวจสอบ" description="กด “เพิ่มเอกสาร” เพื่อเลือกประเภทงาน กรอกรายละเอียด และแนบไฟล์ จากนั้นติดตามผลการตรวจสอบได้จากประวัติด้านล่าง" />
      <Modal title={<Space><PaperClipOutlined /> เพิ่มเอกสารส่งให้แอดมินตรวจสอบ</Space>} open={createModalOpen} onCancel={() => { if (!sending) { setCreateModalOpen(false); form.resetFields(); } }} footer={null} width={820} destroyOnClose maskClosable={!sending} keyboard={!sending}>
      <Tabs activeKey={activeCategory} onChange={key => { setActiveCategory(key); form.resetFields(); }} items={categories.map(c => ({ key: c.key, label: <Space>{c.icon}{c.title}</Space>, children: <div style={{ paddingTop: 8 }}><Alert type="info" showIcon message={c.title} description={c.desc} style={{ marginBottom: 18 }} /><Form form={form} layout="vertical" onFinish={handleFinish} initialValues={{ files: [] }}>
        <Row gutter={16}><Col xs={24} md={15}><Form.Item name="subject" label="หัวข้อเอกสาร" rules={[{ required: true, message: 'กรุณาระบุหัวข้อเอกสาร' }]}><Input maxLength={150} showCount placeholder={`เช่น ${c.title} ประจำเดือน ${monthKeyStr}`} /></Form.Item></Col><Col xs={24} md={9}><Form.Item label="เดือนที่รายงาน"><Input value={monthKeyStr} readOnly /></Form.Item></Col></Row>
        <Form.Item name="message" label="รายละเอียดเพิ่มเติม"><Input.TextArea rows={3} maxLength={1000} showCount placeholder="ระบุรายละเอียดหรือหมายเหตุถึงแอดมิน (ถ้ามี)" /></Form.Item>
        <Form.Item label={`ไฟล์แนบ (สูงสุด ${MAX_FILES} ไฟล์ ไฟล์ละไม่เกิน ${MAX_FILE_MB} MB)`} required><Form.Item name="files" valuePropName="fileList" getValueFromEvent={e => Array.isArray(e) ? e : e?.fileList} noStyle rules={[{ validator: (_, val) => !val?.length ? Promise.reject(new Error('กรุณาแนบไฟล์อย่างน้อย 1 ไฟล์')) : val.length > MAX_FILES ? Promise.reject(new Error(`แนบได้สูงสุด ${MAX_FILES} ไฟล์`)) : Promise.resolve() }]}><Upload.Dragger multiple accept={ACCEPT_FILES} beforeUpload={beforeUpload} maxCount={MAX_FILES}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">คลิกหรือลากไฟล์มาวางที่นี่</p><p className="ant-upload-hint">รองรับ PDF, Word, Excel, PowerPoint, รูปภาพ, CSV และ ZIP</p></Upload.Dragger></Form.Item></Form.Item>
        <Space><Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={sending}>ส่งให้แอดมินตรวจสอบ</Button><Button onClick={() => form.resetFields()} disabled={sending}>ล้างฟอร์ม</Button></Space>
      </Form></div> }))} />
      </Modal>
    </Card>
    <Card style={{ ...cardStyle, borderTop: '3px solid #1677ff' }} title={<Space><FileDoneOutlined style={{ color: '#1677ff' }} /><span>ติดตามสถานะและประวัติการส่งเอกสาร</span></Space>} extra={<Button icon={<UndoOutlined />} onClick={loadHistory} loading={loadingHistory}>รีเฟรชข้อมูล</Button>}>
      <Alert type="info" showIcon message="ติดตามผลตรวจจากแอดมินได้ที่นี่" description="สถานะจะเปลี่ยนเมื่อแอดมินตรวจรายการและกดอนุมัติหรือส่งกลับแก้ไข หากมีหมายเหตุจะแสดงพร้อมชื่อผู้ตรวจและวันที่ตรวจ" style={{ marginBottom: 16 }} />
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        <Col xs={12} md={6}><Card size="small" style={{ background: '#fffbe6', borderColor: '#ffe58f' }}><Statistic title="รอตรวจสอบ" value={history.filter(r => !r.status || r.status === 'pending').length} valueStyle={{ color: '#ad6800' }} prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}><Statistic title="อนุมัติแล้ว" value={history.filter(r => r.status === 'approved').length} valueStyle={{ color: '#389e0d' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small" style={{ background: '#fff2f0', borderColor: '#ffccc7' }}><Statistic title="ส่งกลับแก้ไข" value={history.filter(r => r.status === 'rejected').length} valueStyle={{ color: '#cf1322' }} prefix={<UndoOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small" style={{ background: '#f0f5ff', borderColor: '#adc6ff' }}><Statistic title="ส่งทั้งหมด" value={history.length} valueStyle={{ color: '#1d39c4' }} prefix={<PaperClipOutlined />} /></Card></Col>
      </Row>
      <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 14 }}>
        <Col xs={24} md={14}><Input.Search allowClear value={historySearch} onChange={e => { setHistorySearch(e.target.value); setHistoryPage(1); }} placeholder="ค้นหาหัวข้อเอกสาร ประเภทงาน หรือหมายเหตุ" /></Col>
        <Col xs={24} md={10}><Segmented block value={historyStatus} onChange={v => { setHistoryStatus(v); setHistoryPage(1); }} options={[{ label: 'ทั้งหมด', value: 'all' }, { label: 'รอตรวจ', value: 'pending' }, { label: 'อนุมัติ', value: 'approved' }, { label: 'แก้ไข', value: 'rejected' }]} /></Col>
      </Row>
      <div style={{ display: 'grid', gap: 16 }}>
        {loadingHistory && !history.length ? <Card loading /> : pageHistory.map((r) => {
          const st = statusInfo[r.status] || statusInfo.pending;
          const attachments = r.files || [];
          return <Card key={r.id} className="admin-submission-history-card" style={{ borderRadius: 14, border: '1px solid #e5eaf2', boxShadow: '0 3px 12px rgba(15, 23, 42, 0.04)' }} bodyStyle={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
              <div style={{ minWidth: 0, flex: '1 1 340px' }}>
                <Space wrap size={[8, 8]} style={{ marginBottom: 10 }}>
                  <Tag color="blue" style={{ borderRadius: 6, padding: '3px 9px', fontSize: 13 }}>{r.category || 'ไม่ระบุประเภท'}</Tag>
                  <Tag style={{ borderRadius: 6, padding: '3px 9px', fontSize: 13 }}><CalendarOutlined /> {r.month || 'ไม่ระบุเดือน'}</Tag>
                </Space>
                <Title level={4} style={{ margin: 0, fontSize: 19, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{r.subject || 'ไม่มีชื่อเรื่อง'}</Title>
                <Text type="secondary" style={{ display: 'block', marginTop: 7, fontSize: 13 }}><ClockCircleOutlined /> ส่งเมื่อ {thDateTime(r.created_at)}</Text>
              </div>
              <Tag color={st.color} style={{ margin: 0, borderRadius: 8, padding: '7px 12px', fontSize: 14, fontWeight: 600, whiteSpace: 'normal' }}>{st.label}</Tag>
            </div>
            {r.message && <div style={{ background: '#f8fafc', border: '1px solid #edf1f6', borderRadius: 10, padding: '13px 15px', marginBottom: 16 }}>
              <Text strong style={{ display: 'block', fontSize: 13, marginBottom: 5, color: '#475569' }}>รายละเอียดที่ส่ง</Text>
              <Text style={{ fontSize: 14, lineHeight: 1.85, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.message}</Text>
            </div>}
            <Row gutter={[16, 14]}>
              <Col xs={24} md={12}>
                <div style={{ height: '100%', background: r.status === 'rejected' ? '#fff7f6' : r.status === 'approved' ? '#f6ffed' : '#fafafa', border: `1px solid ${r.status === 'rejected' ? '#ffccc7' : r.status === 'approved' ? '#d9f7be' : '#edf0f4'}`, borderRadius: 10, padding: 14 }}>
                  <Text strong style={{ display: 'block', marginBottom: 7, fontSize: 14 }}>ผลตรวจ / หมายเหตุจาก Admin</Text>
                  <Text style={{ fontSize: 14, lineHeight: 1.8, overflowWrap: 'anywhere' }} type={r.status === 'rejected' ? 'danger' : 'secondary'}>{r.review_note || 'ยังไม่มีหมายเหตุจากผู้ตรวจ'}</Text>
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div style={{ height: '100%', border: '1px solid #edf0f4', borderRadius: 10, padding: 14 }}>
                  <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>ข้อมูลผู้ตรวจ</Text>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <Text style={{ fontSize: 14 }}><Text type="secondary">ผู้ตรวจ: </Text>{r.reviewed_by || 'ยังไม่ระบุ'}</Text>
                    <Text style={{ fontSize: 14 }}><Text type="secondary">วันที่ตรวจ: </Text>{r.reviewed_at ? thDateTime(r.reviewed_at) : 'รอการตรวจสอบ'}</Text>
                  </div>
                </div>
              </Col>
            </Row>
            <div style={{ borderTop: '1px solid #edf0f4', marginTop: 16, paddingTop: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Text strong style={{ fontSize: 14 }}><PaperClipOutlined /> ไฟล์แนบ ({attachments.length})</Text>
              {attachments.length ? <Space wrap size={[8, 8]}>{attachments.map(f => <Button key={f.id} size="middle" icon={<DownloadOutlined />} onClick={() => download(f)} style={{ borderRadius: 8, maxWidth: '100%' }}>{f.name}</Button>)}</Space> : <Text type="secondary">ไม่มีไฟล์แนบ</Text>}
            </div>
          </Card>;
        })}
        {!loadingHistory && !pageHistory.length && <Card style={{ borderRadius: 14 }}><Empty description={history.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีประวัติการส่งเอกสาร'} /></Card>}
      </div>
      {filteredHistory.length > historyPageSize && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
        <Text type="secondary">แสดง {Math.min((historyPage - 1) * historyPageSize + 1, filteredHistory.length)}–{Math.min(historyPage * historyPageSize, filteredHistory.length)} จาก {filteredHistory.length} รายการ</Text>
        <Space>
          <Button disabled={historyPage === 1} onClick={() => setHistoryPage(p => Math.max(1, p - 1))}>ก่อนหน้า</Button>
          <Text strong>{historyPage} / {Math.ceil(filteredHistory.length / historyPageSize)}</Text>
          <Button disabled={historyPage >= Math.ceil(filteredHistory.length / historyPageSize)} onClick={() => setHistoryPage(p => Math.min(Math.ceil(filteredHistory.length / historyPageSize), p + 1))}>ถัดไป</Button>
        </Space>
      </div>}
    </Card>
  </Space>;
}

/* ------------------------------------------------------------------ */
/* หน้าหลัก                                                              */
/* ------------------------------------------------------------------ */
export default function Administration({
  adminEndpoint = DEFAULT_ADMIN_ENDPOINT,
  onSubmitToAdmin, // (FormData) => Promise  — ถ้าส่งมา จะใช้แทน fetch ด้านล่าง
  getToken = readToken, // () => string  — ดึง token ล็อกอิน (ใช้เมื่อไม่ส่ง onSubmitToAdmin)
  currentUser = '', // ชื่อผู้ส่ง แนบไปกับคำขอ
}) {
  const [data, setData] = usePersistentState(STORAGE_KEY, EMPTY_DATA);
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [msg, msgCtx] = message.useMessage();
  const mk = monthKey(month);

  /* ---- การเปลี่ยนแปลงข้อมูล ---- */
  const upsert = (list, rec, silent = false) => {
    setData((p) => {
      const cur = p[list] || [];
      const exists = cur.some((x) => x.id === rec.id);
      return { ...p, [list]: exists ? cur.map((x) => (x.id === rec.id ? rec : x)) : [...cur, rec] };
    });
    if (!silent) msg.success('บันทึกแล้ว');
  };
  const remove = (list, id) => {
    setData((p) => ({ ...p, [list]: (p[list] || []).filter((x) => x.id !== id) }));
    msg.success('ลบแล้ว');
  };
  const setDuty = (key, val) =>
    setData((p) => ({
      ...p,
      duties: { ...p.duties, [mk]: { ...(p.duties[mk] || {}), [key]: { ...(p.duties[mk]?.[key] || {}), ...val } } },
    }));

  /* ---- ส่งไฟล์ถึง Admin ---- */
  const sendToAdmin = async ({ subject, category, message: note, month: m, files }) => {
    const fd = new FormData();
    fd.append('subject', subject);
    fd.append('category', category);
    fd.append('message', note || '');
    fd.append('month', m);
    fd.append('sender', currentUser);
    files.forEach((f) => fd.append('files', f, f.name));

    if (onSubmitToAdmin) {
      await onSubmitToAdmin(fd);
      return;
    }
    // ไม่ตั้ง Content-Type เอง เพื่อให้เบราว์เซอร์ใส่ boundary ของ multipart ให้
    const token = getToken();
    const res = await fetch(adminEndpoint, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let msgText = `เซิร์ฟเวอร์ตอบกลับ ${res.status}`;
      if (res.status === 401) {
        msgText = 'ไม่พบ token ล็อกอินหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่';
      } else {
        try {
          const j = await res.json();
          if (j?.error) msgText = j.error;
        } catch {
          /* ไม่ใช่ JSON ใช้ข้อความเดิม */
        }
      }
      throw new Error(msgText);
    }
    return await res.json().catch(() => ({}));
  };

  /* ---- ข้อมูลของเดือนที่เลือก ---- */
  const inMonth = (iso) => !!iso && iso.startsWith(mk);
  const canteenM = data.canteen.filter((r) => inMonth(r.date));
  const docsM = data.docs.filter((r) => r.month === mk);
  const deptM = data.deptPeriods.filter((r) => r.month === mk);
  const meetingsM = data.meetings.filter((r) => inMonth(r.date));
  const submissionsM = (data.submissions || []).filter((r) => r.month === mk);
  const defaultDate = dayjs().format('YYYY-MM') === mk ? dayjs().format('YYYY-MM-DD') : `${mk}-01`;

  const dutyRows = MONTH_DUTIES.map((d) => {
    const st = data.duties[mk]?.[d.key] || {};
    const deadline = deadlineOf(mk, d.day);
    return { ...d, done: !!st.done, doneAt: st.doneAt, note: st.note || '', deadline, status: getStatus(deadline, !!st.done) };
  }).sort((a, b) => a.day - b.day);

  /* ---- กำหนดส่งงบประมาณ: วันที่ 8 ของเดือนถัดไป ---- */
  const nextMonth = month.add(1, 'month');
  const budgetDeadline = deadlineOf(monthKey(nextMonth), BUDGET_DEADLINE_DAY);
  const budgetDone = deptM.length > 0 && deptM.every((d) => d.submitted);
  const budgetStatus = getStatus(budgetDeadline, budgetDone);
  const daysLeft = budgetDeadline.diff(dayjs(), 'day');
  const budgetText = `ส่งสรุปงวดเงินแผนกให้งานงบประมาณภายในวันที่ ${BUDGET_DEADLINE_DAY} ${thMonthYear(nextMonth)}`;
  const budgetInfo = {
    alert: (
      <Alert
        showIcon
        type={budgetStatus === 'done' ? 'success' : budgetStatus === 'overdue' ? 'error' : budgetStatus === 'soon' ? 'warning' : 'info'}
        icon={budgetStatus === 'overdue' ? <ExclamationCircleOutlined /> : undefined}
        message={budgetText}
        description={
          budgetStatus === 'done'
            ? 'ส่งครบทุกแผนกแล้ว'
            : budgetStatus === 'overdue'
              ? 'เลยกำหนดแล้ว กรุณาส่งโดยเร็ว'
              : daysLeft <= 0
                ? 'วันนี้เป็นวันสุดท้าย'
                : `เหลืออีก ${daysLeft} วัน`
        }
      />
    ),
  };

  /* ---- สรุปภาพรวม ---- */
  const totals = {
    duties: dutyRows.length,
    dutiesDone: dutyRows.filter((d) => d.done).length,
    docs: docsM.length,
    docsSent: docsM.filter((d) => d.sent).length,
    depts: deptM.length,
    deptsSent: deptM.filter((d) => d.submitted).length,
    meetings: meetingsM.filter((m) => m.status !== 'cancelled').length,
    meetingsDone: meetingsM.filter((m) => m.status === 'done').length,
  };
  totals.total = totals.duties + totals.docs + totals.depts + totals.meetings;
  totals.done = totals.dutiesDone + totals.docsSent + totals.deptsSent + totals.meetingsDone;
  const percent = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
  const canteenAll = sumShop(canteenM);

  const timelineItems = [
    ...dutyRows.map((d) => ({
      at: d.deadline,
      color: STATUS_COLOR[d.status],
      label: thDate(d.deadline),
      children: `${d.title} (ทุกวันที่ ${d.day})${d.done ? ' ✓' : ''}`,
    })),
    {
      at: budgetDeadline,
      color: STATUS_COLOR[budgetStatus],
      label: thDate(budgetDeadline),
      children: `ส่งสรุปงวดเงินแผนก (งบประมาณ)${budgetDone ? ' ✓' : ''}`,
    },
    ...meetingsM
      .filter((m) => m.status !== 'cancelled')
      .map((m) => ({
        at: dayjs(m.date),
        color: m.status === 'done' ? 'green' : 'purple',
        label: thDate(m.date),
        children: `${m.type}: ${m.title}`,
      })),
  ]
    .sort((a, b) => a.at.valueOf() - b.at.valueOf())
    .map(({ at, ...rest }) => rest);

  /* ---- ข้อมูลตัวอย่าง (ใช้ตอนยังว่างเท่านั้น) ---- */
  const isEmpty = !data.canteen.length && !data.docs.length && !data.deptPeriods.length && !data.meetings.length;
  const seed = () => {
    const d = (n) => `${mk}-${String(n).padStart(2, '0')}`;
    setData((p) => ({
      ...p,
      canteen: [
        { id: uid(), date: d(2), shop: 'โรงอาหาร', income: 18500, expense: 12300, note: 'ตัวอย่าง' },
        { id: uid(), date: d(2), shop: 'ร้านกาแฟ', income: 6200, expense: 3100, note: 'ตัวอย่าง' },
        { id: uid(), date: d(3), shop: 'โรงอาหาร', income: 17900, expense: 11800, note: 'ตัวอย่าง' },
      ],
      docs: [
        { id: uid(), month: mk, name: 'ใบขออนุมัติจัดซื้อวัสดุสำนักงาน', dept: 'ธุรการ', refNo: 'อก.001/69', amount: 4500, sent: false },
      ],
      deptPeriods: [
        { id: uid(), month: mk, dept: 'ธุรการ', amount: 25000, submitted: false },
        { id: uid(), month: mk, dept: 'อาคารสถานที่', amount: 18000, submitted: false },
      ],
      meetings: [
        {
          id: uid(), type: 'ประชุมฝ่าย', title: 'ประชุมฝ่ายประจำเดือน', date: d(12), time: '15:30',
          place: 'ห้องประชุม', setBy: 'หัวหน้าฝ่าย', status: 'planned',
          agenda: [{ text: 'ติดตามงานเดือนที่ผ่านมา', done: false }, { text: 'แผนงานเดือนถัดไป', done: false }],
        },
      ],
    }));
    msg.info('โหลดข้อมูลตัวอย่างแล้ว (ลบได้ทีละรายการ)');
  };

  const tabItems = [
    {
      key: 'overview',
      label: <span><DashboardOutlined /> ภาพรวม</span>,
      children: <OverviewTab totals={totals} percent={percent} timelineItems={timelineItems} canteenNet={canteenAll.income - canteenAll.expense} budgetInfo={budgetInfo} />,
    },
    {
      key: 'duties',
      label: <span><CheckCircleOutlined /> งานประจำเดือน</span>,
      children: <DutiesTab rows={dutyRows} monthKeyStr={mk} setDuty={setDuty} onSendToAdmin={sendToAdmin} />,
    },
    {
      key: 'canteen',
      label: <span><CoffeeOutlined /> บัญชีโรงอาหาร/ร้านกาแฟ</span>,
      children: <CanteenTab rows={canteenM} monthKeyStr={mk} defaultDate={defaultDate} upsert={upsert} remove={remove} onSendToAdmin={sendToAdmin} />,
    },
    {
      key: 'finance',
      label: <span><DollarOutlined /> สรุปเงินรายเดือน</span>,
      children: <FinanceTab docs={docsM} depts={deptM} monthKeyStr={mk} budgetInfo={budgetInfo} upsert={upsert} remove={remove} onSendToAdmin={sendToAdmin} />,
    },
    {
      key: 'meetings',
      label: <span><TeamOutlined /> วาระการประชุม</span>,
      children: <MeetingsTab rows={meetingsM} defaultDate={defaultDate} monthKeyStr={mk} upsert={upsert} remove={remove} onSendToAdmin={sendToAdmin} />,
    },
    {
      key: 'admin',
      label: <span><PaperClipOutlined /> ส่งไฟล์ถึง Admin</span>,
      children: (
        <AdminSubmitTab
          rows={submissionsM}
          monthKeyStr={mk}
          onSend={sendToAdmin}
          upsert={upsert}
          remove={remove}
          notify={msg}
        />
      ),
    },
  ];

  return (
    <ConfigProvider locale={thTH}>
      {msgCtx}
      <div style={{ padding: 24 }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)',
            borderRadius: 16,
            padding: '20px 24px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <Title level={3} style={{ color: '#fff', margin: 0 }}>ธุรการ</Title>
            <Text style={{ color: 'rgba(255,255,255,.88)' }}>ระบบงานธุรการโรงเรียน · แผนกบริหารทั่วไป</Text>
          </div>
          <Space wrap>
            {isEmpty && <Button onClick={seed}>โหลดข้อมูลตัวอย่าง</Button>}
            <DatePicker
              picker="month"
              size="large"
              allowClear={false}
              value={month}
              format={(v) => thMonthYear(v)}
              onChange={(v) => v && setMonth(v.startOf('month'))}
            />
          </Space>
        </div>
        <Tabs items={tabItems} destroyInactiveTabPane={false} />
      </div>
    </ConfigProvider>
  );
}
