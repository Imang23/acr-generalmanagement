import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  CameraOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api.js';
import { useAccess } from '../../AccessContext.jsx';
import { compressImage } from '../../imageUtil.js';
import { askDeleteRequest } from '../../deleteRequest.jsx';

const { Title, Text } = Typography;

const today = () => dayjs().format('YYYY-MM-DD');

const WEEK_DAYS = [
  { label: 'จ.', value: 1 },
  { label: 'อ.', value: 2 },
  { label: 'พ.', value: 3 },
  { label: 'พฤ.', value: 4 },
  { label: 'ศ.', value: 5 },
  { label: 'ส.', value: 6 },
  { label: 'อา.', value: 7 },
];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

const repeatLabel = (days = ALL_DAYS) => {
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5,6,7') return 'ทุกวัน';
  if (key === '1,2,3,4,5') return 'จันทร์–ศุกร์';
  if (key === '1,2,3,4,5,6') return 'จันทร์–เสาร์';
  return WEEK_DAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(' ');
};

const grade = (pct) => {
  if (pct == null) return { label: '-', color: 'default' };
  if (pct >= 90) return { label: 'ดีเยี่ยม', color: 'success' };
  if (pct >= 75) return { label: 'ดี', color: 'processing' };
  if (pct >= 60) return { label: 'พอใช้', color: 'warning' };
  return { label: 'ต้องปรับปรุง', color: 'error' };
};

const fmtDate = (value) =>
  value && dayjs(value).isValid() ? dayjs(value).format('DD/MM/YYYY') : '-';

const toList = (data) => {
  const list = Array.isArray(data) ? data : data?.data;
  return Array.isArray(list) ? list : [];
};

// แปลงข้อมูลจาก API เป็นข้อมูลสำหรับหน้าจอ
const fromRow = (r = {}) => ({
  id: r.id,
  date: r.date,
  startDate: r.start_date || r.date,
  endDate: r.end_date || '',
  employeeId: r.employee_id != null ? String(r.employee_id) : '',
  employeeCode: r.employee_code || '',
  employeePosition: r.employee_position || '',
  cleaner: r.cleaner || '',
  building: r.building || '',
  location: r.location || '',
  task: r.task || '',
  startTime: r.start_time || '',
  endTime: r.end_time || '',
  inspector: r.inspector || '',
  maxScore: Number(r.max_score) || 10,
  repeatDays:
    Array.isArray(r.repeat_days) && r.repeat_days.length
      ? r.repeat_days.map(Number)
      : ALL_DAYS,
  remark: r.remark || '',
  checked: r.checked === true,
  checkedBy: r.checked_by || '',
  checkedTime: r.checked_time || '',
  finishedTime: r.finished_time || '',
  score: r.score == null ? null : Number(r.score),
  inspectRemark: r.inspect_remark || '',
  inspectorUsername: r.inspector_username || '',
  photos: Array.isArray(r.photos) ? r.photos : [],
});

function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = `\uFEFF${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   แท็บ KPI: สรุปคะแนน เวลา และอัตราสำเร็จรายพนักงาน
========================================================= */
function KpiPanel({ config, tick }) {
  const [range, setRange] = useState([dayjs().startOf('month'), dayjs()]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqRef = useRef(0);

  const from = range?.[0]?.format('YYYY-MM-DD');
  const to = range?.[1]?.format('YYYY-MM-DD');

  useEffect(() => {
    if (!from || !to) return;

    const id = ++reqRef.current;
    setLoading(true);

    api(`${config.path}/kpi?from=${from}&to=${to}`)
      .then((result) => {
        if (id !== reqRef.current) return;
        setData(result);
        setError('');
      })
      .catch((err) => {
        if (id !== reqRef.current) return;
        setError(err?.message || 'โหลดสรุป KPI ไม่สำเร็จ');
      })
      .finally(() => {
        if (id === reqRef.current) setLoading(false);
      });
  }, [config.path, from, to, tick]);

  const totals = data?.totals;
  const employees = data?.employees || [];

  const exportCsv = () => {
    const head = [
      'พนักงาน', 'รหัส', 'ตำแหน่ง', 'งานทั้งหมด', 'เสร็จแล้ว', 'ค้าง', '% สำเร็จ',
      'คะแนนที่ได้', 'คะแนนเต็ม', 'KPI %', 'คุณภาพ %', 'ตรงเวลา %', 'เวลาเฉลี่ย (นาที)',
    ];
    const body = employees.map((e) => [
      e.name, e.employee_code, e.position, e.assigned, e.done, e.pending,
      e.completion_pct, e.score_got, e.score_max_all, e.score_pct, e.quality_pct,
      e.on_time_pct, e.avg_minutes,
    ]);
    downloadCsv(`kpi-${config.key}-${from}_${to}.csv`, [head, ...body]);
  };

  const columns = [
    {
      title: 'พนักงาน',
      key: 'name',
      width: 220,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {[r.employee_code, r.position, r.department].filter(Boolean).join(' · ') ||
              'ไม่อยู่ในทะเบียนพนักงาน'}
          </Text>
        </Space>
      ),
    },
    { title: 'งานทั้งหมด', dataIndex: 'assigned', align: 'center', width: 100 },
    {
      title: 'เสร็จแล้ว',
      key: 'done',
      align: 'center',
      width: 100,
      sorter: (a, b) => a.done - b.done,
      render: (_, r) => `${r.done}/${r.assigned}`,
    },
    {
      title: '% สำเร็จ',
      key: 'completion',
      width: 150,
      sorter: (a, b) => (a.completion_pct ?? -1) - (b.completion_pct ?? -1),
      render: (_, r) => (
        <Progress percent={Math.round(r.completion_pct ?? 0)} size="small" />
      ),
    },
    {
      title: 'คะแนน',
      key: 'score',
      align: 'center',
      width: 120,
      render: (_, r) => `${r.score_got} / ${r.score_max_all}`,
    },
    {
      title: 'KPI',
      key: 'kpi',
      width: 160,
      defaultSortOrder: 'descend',
      sorter: (a, b) => (a.score_pct ?? -1) - (b.score_pct ?? -1),
      render: (_, r) => {
        const g = grade(r.score_pct);
        return (
          <Space>
            <Text strong>{r.score_pct == null ? '-' : `${r.score_pct}%`}</Text>
            <Tag color={g.color}>{g.label}</Tag>
          </Space>
        );
      },
    },
    {
      title: 'ตรงเวลา',
      key: 'ontime',
      align: 'center',
      width: 100,
      sorter: (a, b) => (a.on_time_pct ?? -1) - (b.on_time_pct ?? -1),
      render: (_, r) => (r.on_time_pct == null ? '-' : `${r.on_time_pct}%`),
    },
    {
      title: 'เวลาเฉลี่ย/งาน',
      key: 'avg',
      align: 'center',
      width: 120,
      render: (_, r) => (r.avg_minutes == null ? '-' : `${r.avg_minutes} นาที`),
    },
  ];

  const itemColumns = [
    { title: 'วันที่', dataIndex: 'date', width: 110, render: fmtDate },
    {
      title: 'งาน',
      key: 'task',
      render: (_, i) => (
        <Space direction="vertical" size={0}>
          <Text>{i.task}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {[i.building, i.location].filter(Boolean).join(' · ') || '-'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'เวลาตามแผน',
      key: 'plan',
      width: 120,
      render: (_, i) => (i.start_time || i.end_time ? `${i.start_time || '-'}–${i.end_time || '-'}` : '-'),
    },
    {
      title: 'ผล',
      key: 'result',
      width: 200,
      render: (_, i) =>
        i.done ? (
          <Space size={4} wrap>
            <Tag color="success">เสร็จ {i.finished_time || ''}</Tag>
            <Tag color={i.on_time ? 'green' : 'orange'}>{i.on_time ? 'ตรงเวลา' : 'เกินเวลา'}</Tag>
            <Text>{i.score}/{i.max_score}</Text>
          </Space>
        ) : (
          <Tag color="error">ยังไม่ได้ทำ (0/{i.max_score})</Tag>
        ),
    },
  ];

  return (
    <div>
      <Card bordered={false} style={{ marginBottom: 20 }}>
        <Space wrap>
          <DatePicker.RangePicker
            size="large"
            format="DD/MM/YYYY"
            allowClear={false}
            value={range}
            onChange={(v) => v && setRange(v)}
            presets={[
              { label: 'วันนี้', value: [dayjs(), dayjs()] },
              { label: '7 วันล่าสุด', value: [dayjs().subtract(6, 'day'), dayjs()] },
              { label: 'เดือนนี้', value: [dayjs().startOf('month'), dayjs()] },
              {
                label: 'เดือนที่แล้ว',
                value: [
                  dayjs().subtract(1, 'month').startOf('month'),
                  dayjs().subtract(1, 'month').endOf('month'),
                ],
              },
            ]}
          />
          <Button size="large" icon={<DownloadOutlined />} disabled={!employees.length} onClick={exportCsv}>
            ดาวน์โหลด CSV
          </Button>
        </Space>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            KPI = คะแนนที่ได้ ÷ คะแนนเต็มของ “ทุกงานที่ต้องทำในช่วงนี้” (งานที่ไม่ได้ทำนับ 0 คะแนน, ไม่นับวันในอนาคต)
            · ตรงเวลา = เวลาที่เสร็จจริงไม่เกินเวลาสิ้นสุดของงาน
          </Text>
        </div>
      </Card>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic title="งานที่ต้องทำ" value={totals?.assigned ?? 0} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="ทำเสร็จ"
              value={totals?.completion_pct ?? 0}
              suffix="%"
              valueStyle={{ color: '#16a34a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="KPI รวม"
              value={totals?.score_pct ?? 0}
              suffix="%"
              valueStyle={{ color: '#2563eb' }}
              prefix={<TrophyOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="ตรงเวลา"
              value={totals?.on_time_pct ?? 0}
              suffix="%"
              valueStyle={{ color: '#d97706' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false} title="สรุป KPI รายพนักงาน">
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={employees}
          pagination={{ pageSize: 10, showTotal: (n) => `ทั้งหมด ${n} คน` }}
          scroll={{ x: 1000 }}
          locale={{ emptyText: 'ไม่มีงานในช่วงวันที่เลือก' }}
          expandable={{
            expandedRowRender: (r) => (
              <Table
                rowKey={(i) => `${i.task_id}-${i.date}`}
                size="small"
                columns={itemColumns}
                dataSource={r.items}
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}

/* =========================================================
   หน้างานประจำวัน (ใช้ร่วมกันทั้งแม่บ้านและคนสวน)
========================================================= */
export default function DailyTaskBoard({ config, tick }) {
  const { message, modal } = App.useApp();

  const [date, setDate] = useState(today());
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [committees, setCommittees] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [me, setMe] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [taskModal, setTaskModal] = useState(null);
  const [inspectModal, setInspectModal] = useState(null);
  // รูปแนบการตรวจ: pending = รูปใหม่ที่ยังไม่อัปโหลด, removed = id รูปเดิมที่จะลบ
  const [inspectPhotos, setInspectPhotos] = useState({ pending: [], removed: [] });
  const MAX_INSPECT_PHOTOS = 3;
  const [saving, setSaving] = useState(false);
  const [taskForm] = Form.useForm();
  const [inspectForm] = Form.useForm();
  const reqRef = useRef(0);

  // สิทธิ์ตามบทบาท: เพิ่ม/แก้ = write, ลบตรง = delete (ช่างต้องขออนุมัติ), ตรวจงาน = approve
  const { can, access } = useAccess();
  const canWrite = can(config.key, 'write');
  const canDelete = can(config.key, 'delete');
  const canInspect = can(config.key, 'approve');
  const meName = me?.display_name || me?.username || '';
  const isFuture = date > today();

  /* ---------- โหลดข้อมูล ---------- */
  const load = useCallback(async () => {
    const id = ++reqRef.current;
    setLoading(true);

    try {
      const data = await api(`${config.path}?date=${date}`);
      if (id !== reqRef.current) return;

      const list = Array.isArray(data) ? data : data?.data;
      if (!Array.isArray(list)) throw new Error('รูปแบบข้อมูลจาก API ไม่ถูกต้อง');

      setRows(list.map(fromRow));
      setError('');
    } catch (err) {
      if (id !== reqRef.current) return;
      console.error('Load daily tasks error:', err);
      setError(err?.message || 'ไม่สามารถโหลดข้อมูลได้');
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, [config.path, date]);

  useEffect(() => {
    load();
  }, [load, tick]);

  // ทะเบียนพนักงาน ทะเบียนกรรมการ และผู้ใช้ปัจจุบัน
  useEffect(() => {
    let active = true;

    api('/employees')
      .then((data) => {
        if (!active) return;
        setEmployees(toList(data));
      })
      .catch((err) => console.error('Load employees error:', err));

    // ถ้าไม่มี endpoint กรรมการ (หรือโหลดไม่ได้) จะใช้ทะเบียนพนักงานแทนอัตโนมัติ
    api('/committees')
      .then((data) => {
        if (!active) return;
        setCommittees(toList(data));
      })
      .catch((err) => {
        console.error('Load committees error:', err);
        if (active) setCommittees([]);
      });

    // ทะเบียนอาคาร (หน้า "จัดการอาคาร")
    api('/buildings')
      .then((data) => {
        if (!active) return;
        setBuildings(toList(data));
      })
      .catch((err) => {
        console.error('Load buildings error:', err);
        if (active) setBuildings([]);
      });

    api('/me')
      .then((profile) => active && setMe(profile))
      .catch((err) => console.error('Load user profile error:', err));

    return () => {
      active = false;
    };
  }, [tick]);

  /* ---------- ข้อมูลที่คำนวณ ---------- */
  const hasEmployees = employees.length > 0;

  const workerOptions = useMemo(() => {
    const known = new Set();

    const fromRegistry = employees.map((e) => {
      known.add(String(e.full_name || '').trim().toLowerCase());
      const suffix =
        e.status === 'ON_LEAVE' ? ' · ลางาน' : e.status === 'INACTIVE' ? ' · พ้นสภาพ' : '';
      return {
        value: `e:${e.id}`,
        label: `${e.full_name}${e.employee_code ? ` (${e.employee_code})` : ''}${suffix}`,
        disabled: e.status === 'INACTIVE',
      };
    });

    // ชื่อเดิมที่พิมพ์ไว้แต่ไม่อยู่ในทะเบียนพนักงาน
    const legacy = [];
    for (const r of rows || []) {
      const name = r.cleaner.trim();
      if (!r.employeeId && name && !known.has(name.toLowerCase())) {
        known.add(name.toLowerCase());
        legacy.push({ value: `n:${name}`, label: `${name} (ยังไม่อยู่ในทะเบียน)` });
      }
    }

    return [...fromRegistry, ...legacy];
  }, [employees, rows]);

  // ผู้ตรวจ: ใช้ "ชื่อ" เป็นค่า (value) ตรง ๆ เพราะระบบบันทึกผู้ตรวจเป็นชื่อ
  const inspectorSource = committees.length ? committees : employees;
  const hasInspectors = inspectorSource.length > 0;

  const inspectorOptions = useMemo(() => {
    const known = new Set();
    const options = [];

    for (const e of inspectorSource) {
      const name = String(e.full_name || e.name || '').trim();
      if (!name || known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());

      const suffix =
        e.status === 'ON_LEAVE' ? ' · ลางาน' : e.status === 'INACTIVE' ? ' · พ้นสภาพ' : '';

      options.push({
        value: name,
        label: `${name}${e.position ? ` (${e.position})` : ''}${suffix}`,
        disabled: e.status === 'INACTIVE',
      });
    }

    // ชื่อผู้ตรวจเดิมที่บันทึกไว้ (และผู้ใช้ปัจจุบัน) แต่ไม่มีในทะเบียน
    const extras = [...(rows || []).map((r) => r.inspector), meName];
    for (const raw of extras) {
      const name = String(raw || '').trim();
      if (name && !known.has(name.toLowerCase())) {
        known.add(name.toLowerCase());
        options.push({ value: name, label: `${name} (ยังไม่อยู่ในทะเบียน)` });
      }
    }

    return options;
  }, [inspectorSource, rows, meName]);

  // อาคาร: ใช้ "ชื่ออาคาร" เป็นค่า (value) เพราะตารางงานเก็บอาคารเป็นข้อความ
  const hasBuildings = buildings.length > 0;

  const buildingOptions = useMemo(() => {
    const known = new Set();
    const options = [];

    for (const b of buildings) {
      const name = String(b.name || '').trim();
      if (!name || known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());
      options.push({
        value: name,
        label: `${name}${b.code ? ` (${b.code})` : ''}${b.status === 'inactive' ? ' · ปิดใช้งาน' : ''}`,
        disabled: b.status === 'inactive',
      });
    }

    // ชื่ออาคารเดิมที่พิมพ์ไว้ในงาน แต่ไม่อยู่ในทะเบียนอาคาร
    for (const r of rows || []) {
      const name = String(r.building || '').trim();
      if (name && !known.has(name.toLowerCase())) {
        known.add(name.toLowerCase());
        options.push({ value: name, label: `${name} (ยังไม่อยู่ในทะเบียน)` });
      }
    }

    return options;
  }, [buildings, rows]);

  const tasks = rows || [];
  const total = tasks.length;
  const checkedCount = tasks.filter((t) => t.checked).length;
  const pendingCount = total - checkedCount;
  const scoreGot = tasks.reduce((s, t) => s + (t.checked ? t.score || 0 : 0), 0);
  const scoreMax = tasks.reduce((s, t) => s + t.maxScore, 0);

  const staff = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      const key = t.employeeId ? `e:${t.employeeId}` : `n:${t.cleaner.trim().toLowerCase()}`;
      const emp = t.employeeId ? employees.find((e) => String(e.id) === t.employeeId) : null;
      const g = map.get(key) || {
        key,
        name: emp?.full_name || t.cleaner || '(ไม่ระบุ)',
        code: emp?.employee_code || t.employeeCode,
        position: emp?.position || t.employeePosition,
        total: 0,
        done: 0,
        score: 0,
        max: 0,
      };
      g.total += 1;
      g.max += t.maxScore;
      if (t.checked) {
        g.done += 1;
        g.score += t.score || 0;
      }
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [tasks, employees]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return tasks.filter((t) => {
      const matchSearch =
        !q ||
        [t.cleaner, t.employeeCode, t.building, t.location, t.task, t.inspector].some((v) =>
          String(v ?? '').toLowerCase().includes(q),
        );
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'checked' && t.checked) ||
        (statusFilter === 'pending' && !t.checked);
      return matchSearch && matchStatus;
    });
  }, [tasks, keyword, statusFilter]);

  /* ---------- เพิ่ม / แก้ไข / ลบ งานประจำ ---------- */
  const workerKeyOf = (rec) => {
    if (!hasEmployees) return rec.cleaner;
    if (rec.employeeId) return `e:${rec.employeeId}`;
    const m = employees.find(
      (e) => String(e.full_name || '').trim() === rec.cleaner.trim(),
    );
    if (m) return `e:${m.id}`;
    return rec.cleaner ? `n:${rec.cleaner}` : undefined;
  };

  const openAdd = () => {
    if (!canWrite) return message.warning('คุณไม่มีสิทธิ์เพิ่มตารางงาน');
    setTaskModal({
      editing: null,
      key: Date.now(),
      init: {
        date: today(),
        endDate: '',
        worker: undefined,
        building: '',
        location: '',
        task: '',
        startTime: '05:00',
        endTime: '05:30',
        inspector: meName,
        inspectorUsername: access?.role === 'inspector' ? access.username : undefined,
        maxScore: 10,
        repeatDays: ALL_DAYS,
      },
    });
  };

  const openEdit = (rec) => {
    if (!canWrite) return message.warning('คุณไม่มีสิทธิ์แก้ไขตารางงาน');
    setTaskModal({
      editing: rec,
      key: Date.now(),
      init: {
        date: rec.startDate,
        endDate: rec.endDate,
        worker: workerKeyOf(rec),
        building: rec.building,
        location: rec.location,
        task: rec.task,
        startTime: rec.startTime,
        endTime: rec.endTime,
        inspector: rec.inspector,
        inspectorUsername: rec.inspectorUsername || undefined,
        maxScore: rec.maxScore,
        repeatDays: rec.repeatDays,
      },
    });
  };

  const closeTaskModal = () => {
    if (!saving) setTaskModal(null);
  };

  const saveTask = async () => {
    if (saving || !taskModal) return;
    if (!canWrite) return message.warning('คุณไม่มีสิทธิ์บันทึกตารางงาน');

    try {
      const v = await taskForm.validateFields();

      if (v.startTime && v.endTime && v.endTime <= v.startTime) {
        return message.warning('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
      }
      if (v.endDate && v.endDate < v.date) {
        return message.warning('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
      }

      const body = {
        date: v.date,
        end_date: v.endDate || null,
        building: String(v.building || '').trim(),
        location: String(v.location || '').trim(),
        task: String(v.task || '').trim(),
        start_time: v.startTime || null,
        end_time: v.endTime || null,
        inspector: String(v.inspector || '').trim(),
        inspector_username: v.inspectorUsername || null,
        max_score: Number(v.maxScore),
        repeat_days: v.repeatDays,
      };

      const worker = String(v.worker || '').trim();
      if (worker.startsWith('e:')) {
        body.employee_id = Number(worker.slice(2));
      } else {
        body.employee_id = null;
        body.cleaner = worker.startsWith('n:') ? worker.slice(2) : worker;
      }

      setSaving(true);

      if (taskModal.editing) {
        await api(`${config.path}/${taskModal.editing.id}`, 'PUT', body);
        message.success('แก้ไขตารางงานเรียบร้อย');
      } else {
        await api(config.path, 'POST', body);
        message.success('เพิ่มงานประจำเรียบร้อย');
      }

      setTaskModal(null);
      await load();
    } catch (err) {
      if (err?.errorFields) return;
      console.error('Save task error:', err);
      message.error(err?.message || 'บันทึกตารางงานไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = (rec) => {
    if (!canWrite) return message.warning('คุณไม่มีสิทธิ์ลบตารางงาน');
    if (!canDelete) {
      // ช่างลบเองไม่ได้ -> ส่งคำขอให้ผู้ตรวจอนุมัติ
      return askDeleteRequest({
        message,
        table: config.path.replace('/', ''),
        recordId: rec.id,
        label: `${rec.task} (${rec.cleaner})`,
      });
    }
    modal.confirm({
      title: 'ลบงานประจำนี้?',
      content: (
        <div>
          <div>“{rec.task}” ({rec.cleaner})</div>
          <Text type="secondary">
            งานจะไม่แสดงตั้งแต่วันนี้เป็นต้นไป ส่วนประวัติการตรวจและ KPI ที่ผ่านมายังคงอยู่
          </Text>
        </div>
      ),
      okText: 'ลบงาน',
      cancelText: 'ยกเลิก',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api(`${config.path}/${rec.id}`, 'DELETE');
          message.success('ลบงานเรียบร้อย');
          await load();
        } catch (err) {
          message.error(err?.message || 'ลบงานไม่สำเร็จ');
          throw err;
        }
      },
    });
  };

  /* ---------- ตรวจงานรายวัน (คะแนน + เวลาที่เสร็จ) ---------- */
  const openInspect = (rec) => {
    if (!canInspect) return message.warning('เฉพาะผู้ตรวจงานหรือผู้ดูแลระบบที่ตรวจงานได้');
    if (rec.date > today()) return message.warning('ยังไม่ถึงวันที่ของงานนี้');
    setInspectPhotos({ pending: [], removed: [] });
    setInspectModal({
      record: rec,
      key: Date.now(),
      init: {
        finishedTime: rec.checked
          ? rec.finishedTime
          : rec.date === today()
            ? dayjs().format('HH:mm')
            : rec.endTime || '',
        score: rec.checked ? rec.score : rec.maxScore,
        remark: rec.inspectRemark,
      },
    });
  };

  // บัญชีผู้ตรวจที่มอบหมายงานได้ (ผู้ตรวจเห็น/ตรวจได้เฉพาะงานที่ได้รับมอบหมาย)
  const [inspectorAccounts, setInspectorAccounts] = useState([]);
  useEffect(() => {
    api(`/inspectors?module=${config.key}`)
      .then((list) => setInspectorAccounts(Array.isArray(list) ? list : []))
      .catch(() => setInspectorAccounts([]));
  }, [config.key]);
  const hasInspectorAccounts = inspectorAccounts.length > 0;
  const inspectorAccountOptions = inspectorAccounts.map((u) => ({
    value: u.username,
    label: u.display_name || u.username,
  }));

  const keptPhotos = inspectModal
    ? (inspectModal.record.photos || []).filter((p) => !inspectPhotos.removed.includes(p.id))
    : [];
  const photoCount = keptPhotos.length + inspectPhotos.pending.length;

  const pickInspectPhoto = async (file) => {
    if (photoCount >= MAX_INSPECT_PHOTOS) {
      message.warning(`แนบรูปได้ไม่เกิน ${MAX_INSPECT_PHOTOS} รูป`);
      return false;
    }
    try {
      const img = await compressImage(file);
      setInspectPhotos((prev) => ({ ...prev, pending: [...prev.pending, img] }));
    } catch (err) {
      message.error(err.message);
    }
    return false; // ไม่ให้ antd อัปโหลดเอง
  };

  const saveInspect = async () => {
    if (saving || !inspectModal) return;

    try {
      const v = await inspectForm.validateFields();
      const rec = inspectModal.record;
      setSaving(true);

      await api(`${config.path}/${rec.id}/inspect`, 'POST', {
        date: rec.date,
        checked: true,
        score: Number(v.score),
        finished_time: v.finishedTime,
        remark: String(v.remark || '').trim(),
        checked_by: meName,
        photos: inspectPhotos.pending.map((p) => ({ mime: p.mime, data: p.data })),
        remove_photo_ids: inspectPhotos.removed,
      });

      message.success('บันทึกผลตรวจแล้ว');
      setInspectModal(null);
      await load();
    } catch (err) {
      if (err?.errorFields) return;
      console.error('Inspect error:', err);
      message.error(err?.message || 'บันทึกผลตรวจไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const cancelInspect = (rec) => {
    if (!canInspect) return message.warning('เฉพาะผู้ตรวจงานหรือผู้ดูแลระบบที่ยกเลิกผลตรวจได้');
    modal.confirm({
      title: 'ยกเลิกผลตรวจงาน?',
      content: `งาน “${rec.task}” ของวันที่ ${fmtDate(rec.date)} จะกลับเป็นรอตรวจ และคะแนนจะถูกลบ`,
      okText: 'ยืนยัน',
      cancelText: 'กลับ',
      onOk: async () => {
        try {
          await api(`${config.path}/${rec.id}/inspect`, 'POST', {
            date: rec.date,
            checked: false,
          });
          message.success('ยกเลิกผลตรวจแล้ว');
          await load();
        } catch (err) {
          message.error(err?.message || 'ยกเลิกผลตรวจไม่สำเร็จ');
          throw err;
        }
      },
    });
  };

  /* ---------- ตาราง ---------- */
  const columns = [
    {
      title: 'เวลา',
      key: 'time',
      width: 110,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.startTime || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ถึง {r.endTime || '-'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'รายละเอียดงาน',
      key: 'details',
      width: 260,
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Text strong>{r.task || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.building || '-'} · {r.location || '-'}
          </Text>
          <Space size={4} wrap>
            <Tag>{repeatLabel(r.repeatDays)}</Tag>
            <Tag color="blue">เต็ม {r.maxScore} คะแนน</Tag>
            {r.endDate && <Tag color="orange">ถึง {fmtDate(r.endDate)}</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: config.workerLabel,
      key: 'worker',
      width: 190,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text>{r.cleaner || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {[r.employeeCode, r.employeePosition].filter(Boolean).join(' · ') || ' '}
          </Text>
        </Space>
      ),
    },
    {
      title: 'ผู้ตรวจ',
      dataIndex: 'inspector',
      key: 'inspector',
      width: 130,
      render: (v) => v || '-',
    },
    {
      title: 'ผลการตรวจ',
      key: 'result',
      width: 230,
      render: (_, r) => {
        if (!r.checked) {
          return <Tag color="warning">รอตรวจ</Tag>;
        }
        const late = r.endTime && r.finishedTime && r.finishedTime > r.endTime;
        return (
          <Space direction="vertical" size={2}>
            <Space size={4} wrap>
              <Tag color="success">ตรวจแล้ว</Tag>
              <Tag color="blue">
                {r.score}/{r.maxScore}
              </Tag>
              <Tag color={late ? 'orange' : 'green'}>
                เสร็จ {r.finishedTime || '-'} {late ? '(เกินเวลา)' : ''}
              </Tag>
            </Space>
            <Text type="secondary" style={{ fontSize: 11 }}>
              โดย {r.checkedBy || '-'} · {r.checkedTime || '-'}
              {r.inspectRemark ? ` · ${r.inspectRemark}` : ''}
            </Text>
            {r.photos.length > 0 && (
              <Image.PreviewGroup>
                <Space size={4} wrap>
                  {r.photos.map((p) => (
                    <Image
                      key={p.id}
                      src={p.url}
                      width={36}
                      height={36}
                      style={{ objectFit: 'cover', borderRadius: 4 }}
                    />
                  ))}
                </Space>
              </Image.PreviewGroup>
            )}
          </Space>
        );
      },
    },
    ...(canWrite || canInspect
      ? [
          {
            title: 'จัดการ',
            key: 'actions',
            width: 250,
            fixed: 'right',
            render: (_, r) => (
              <Space wrap>
                {canInspect && (
                  <Button
                    type={r.checked ? 'default' : 'primary'}
                    icon={<CheckCircleOutlined />}
                    disabled={r.date > today()}
                    onClick={() => openInspect(r)}
                  >
                    {r.checked ? 'แก้ผลตรวจ' : 'ตรวจงาน'}
                  </Button>
                )}
                {canInspect && r.checked && (
                  <Button onClick={() => cancelInspect(r)}>ยกเลิกผล</Button>
                )}
                {canWrite && <Button icon={<EditOutlined />} onClick={() => openEdit(r)} />}
                {canWrite && (
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    title={canDelete ? 'ลบ' : 'ขออนุมัติลบ'}
                    onClick={() => deleteTask(r)}
                  />
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];

  /* ---------- แสดงผล ---------- */
  if (error && rows === null) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="error"
          showIcon
          message={`โหลด${config.title}ไม่สำเร็จ`}
          description={error}
          action={<Button onClick={load}>ลองใหม่</Button>}
        />
      </div>
    );
  }

  if (rows === null) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" tip="กำลังโหลด..." />
      </div>
    );
  }

  const dailyTab = (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="งานที่เพิ่มไว้จะแสดงต่อเนื่องทุกวันตามที่กำหนด สถานะการตรวจของแต่ละวันเริ่มเป็น “รอตรวจ” ใหม่เสมอ"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic title="งานทั้งหมด" value={total} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="รอตรวจ"
              value={pendingCount}
              valueStyle={{ color: '#d97706' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="ตรวจแล้ว"
              value={checkedCount}
              valueStyle={{ color: '#16a34a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card bordered={false}>
            <Statistic
              title="คะแนนวันนี้"
              value={scoreGot}
              suffix={`/ ${scoreMax}`}
              valueStyle={{ color: '#2563eb' }}
              prefix={<TrophyOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        bordered={false}
        title={
          <span>
            <TeamOutlined /> ความคืบหน้ารายพนักงาน · {fmtDate(date)}
          </span>
        }
        style={{ marginBottom: 20 }}
      >
        {staff.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ไม่มีงานในวันนี้" />
        ) : (
          <Row gutter={[12, 12]}>
            {staff.map((s) => {
              const percent = s.total ? Math.round((s.done * 100) / s.total) : 0;
              const complete = s.total > 0 && s.done === s.total;
              return (
                <Col xs={24} md={12} xl={8} key={s.key}>
                  <Card size="small">
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Text strong>{s.name}</Text>
                        {complete ? (
                          <Tag color="success">เสร็จครบ</Tag>
                        ) : s.done === 0 ? (
                          <Tag color="default">ยังไม่เริ่ม</Tag>
                        ) : (
                          <Tag color="warning">เหลือ {s.total - s.done} งาน</Tag>
                        )}
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {[s.code, s.position].filter(Boolean).join(' · ') || ' '}
                      </Text>
                      <Progress percent={percent} size="small" status={complete ? 'success' : 'active'} />
                      <Text style={{ fontSize: 12 }}>
                        ตรวจแล้ว {s.done}/{s.total} งาน · คะแนน {s.score}/{s.max}
                      </Text>
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Card bordered={false} style={{ marginBottom: 20 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={8}>
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined />}
              placeholder={`ค้นหา${config.workerLabel} อาคาร หรือชื่องาน`}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Col>
          <Col xs={24} md={6}>
            <Select
              size="large"
              style={{ width: '100%' }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: 'ทุกสถานะ', value: 'all' },
                { label: 'รอตรวจ', value: 'pending' },
                { label: 'ตรวจแล้ว', value: 'checked' },
              ]}
            />
          </Col>
          <Col xs={24} md={4}>
            <Button
              size="large"
              icon={<ClearOutlined />}
              block
              onClick={() => {
                setKeyword('');
                setStatusFilter('all');
              }}
            >
              รีเซ็ต
            </Button>
          </Col>
        </Row>
      </Card>

      <Card
        bordered={false}
        title="ตารางปฏิบัติงานและตรวจรับ"
        extra={<Text type="secondary">{filtered.length} รายการ</Text>}
      >
        {isFuture && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="เป็นวันในอนาคต: ดูตารางล่วงหน้าได้ แต่ยังตรวจงานไม่ได้"
          />
        )}
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: 'ไม่พบตารางงาน' }}
        />
      </Card>
    </div>
  );

  return (
    <div style={{ padding: 24, background: '#f5f7fb', minHeight: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <FileTextOutlined /> {config.title}
          </Title>
          <Text type="secondary">{config.subtitle}</Text>
        </div>

        <Space wrap>
          <DatePicker
            size="large"
            format="DD/MM/YYYY"
            allowClear={false}
            value={dayjs(date)}
            onChange={(d) => d && setDate(d.format('YYYY-MM-DD'))}
          />
          <Button size="large" icon={<ReloadOutlined />} onClick={load} loading={loading}>
            รีเฟรช
          </Button>
          {canWrite && (
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openAdd}>
              เพิ่มงานประจำ
            </Button>
          )}
        </Space>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      <Tabs
        defaultActiveKey="daily"
        items={[
          { key: 'daily', label: 'ตารางงานรายวัน', children: dailyTab },
          {
            key: 'kpi',
            label: (
              <span>
                <TrophyOutlined /> สรุป KPI พนักงาน
              </span>
            ),
            children: <KpiPanel config={config} tick={tick} />,
          },
        ]}
      />

      {/* ฟอร์มเพิ่ม/แก้ไขงานประจำ */}
      <Modal
        title={taskModal?.editing ? 'แก้ไขงานประจำ' : `เพิ่มงานประจำ${config.workerLabel}`}
        open={!!taskModal}
        onCancel={closeTaskModal}
        onOk={saveTask}
        confirmLoading={saving}
        okText="บันทึก"
        cancelText="ยกเลิก"
        destroyOnHidden
        width={700}
        maskClosable={!saving}
        closable={!saving}
      >
        {taskModal && (
          <Form
            key={taskModal.key}
            form={taskForm}
            layout="vertical"
            initialValues={taskModal.init}
            preserve={false}
          >
            {taskModal.editing && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="การแก้ไขมีผลกับงานประจำทุกวัน ส่วนผลตรวจที่บันทึกไว้แล้วจะไม่เปลี่ยน"
              />
            )}
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="เริ่มทำตั้งแต่วันที่"
                  name="date"
                  rules={[{ required: true, message: 'กรุณาเลือกวันที่เริ่ม' }]}
                >
                  <Input type="date" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="สิ้นสุดวันที่ (เว้นว่าง = ทำต่อไปเรื่อย ๆ)" name="endDate">
                  <Input type="date" />
                </Form.Item>
              </Col>

              <Col span={24}>
                <Form.Item
                  label="วันที่ทำงานในสัปดาห์"
                  name="repeatDays"
                  rules={[{ required: true, type: 'array', min: 1, message: 'เลือกอย่างน้อย 1 วัน' }]}
                >
                  <Checkbox.Group options={WEEK_DAYS} />
                </Form.Item>
              </Col>

              <Col xs={24} sm={12}>
                <Form.Item
                  label={`${config.workerLabel}ผู้รับผิดชอบ (จากทะเบียนพนักงาน)`}
                  name="worker"
                  rules={[{ required: true, whitespace: true, message: 'กรุณาเลือกพนักงาน' }]}
                >
                  {hasEmployees ? (
                    <Select
                      showSearch
                      allowClear
                      placeholder="เลือกพนักงาน"
                      options={workerOptions}
                      optionFilterProp="label"
                    />
                  ) : (
                    <Input placeholder="ชื่อพนักงาน" />
                  )}
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                {hasInspectorAccounts ? (
                  <Form.Item
                    label="ผู้ตรวจงาน"
                    name="inspectorUsername"
                    extra="ผู้ตรวจจะเห็นและตรวจได้เฉพาะงานที่มอบหมายให้"
                    rules={[{ required: true, message: 'กรุณาเลือกผู้ตรวจ' }]}
                  >
                    <Select
                      showSearch
                      placeholder="เลือกผู้ตรวจ"
                      options={inspectorAccountOptions}
                      optionFilterProp="label"
                      disabled={
                        access?.role === 'inspector' ||
                        (Boolean(taskModal?.editing) && !access?.is_admin)
                      }
                    />
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="หัวหน้างานผู้ตรวจ"
                    name="inspector"
                    rules={[{ required: true, whitespace: true, message: 'กรุณาระบุผู้ตรวจ' }]}
                  >
                    {hasInspectors ? (
                      <Select
                        showSearch
                        allowClear
                        placeholder="เลือกผู้ตรวจ"
                        options={inspectorOptions}
                        optionFilterProp="label"
                      />
                    ) : (
                      <Input placeholder="ชื่อผู้ตรวจ" />
                    )}
                  </Form.Item>
                )}
              </Col>

              <Col xs={24} sm={12}>
                <Form.Item
                  label="อาคาร"
                  name="building"
                  rules={[{ required: true, whitespace: true, message: 'กรุณาระบุอาคาร' }]}
                >
                  {hasBuildings ? (
                    <Select
                      showSearch
                      allowClear
                      placeholder="เลือกอาคาร"
                      options={buildingOptions}
                      optionFilterProp="label"
                    />
                  ) : (
                    <Input placeholder="เช่น อาคารที่ 1" />
                  )}
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="สถานที่ทำงาน"
                  name="location"
                  rules={[{ required: true, whitespace: true, message: 'กรุณาระบุสถานที่' }]}
                >
                  <Input placeholder="เช่น ห้องน้ำชั้น 1" />
                </Form.Item>
              </Col>

              <Col span={24}>
                <Form.Item
                  label="รายละเอียดงาน"
                  name="task"
                  rules={[{ required: true, whitespace: true, message: 'กรุณาระบุรายละเอียดงาน' }]}
                >
                  <Input.TextArea rows={2} placeholder="เช่น ทำความสะอาด กวาด ถูพื้น และเก็บขยะ" />
                </Form.Item>
              </Col>

              <Col xs={24} sm={8}>
                <Form.Item
                  label="เวลาเริ่ม"
                  name="startTime"
                  rules={[{ required: true, message: 'กรุณาระบุเวลาเริ่ม' }]}
                >
                  <Input type="time" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  label="เวลาสิ้นสุด"
                  name="endTime"
                  rules={[{ required: true, message: 'กรุณาระบุเวลาสิ้นสุด' }]}
                >
                  <Input type="time" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  label="คะแนนเต็มของงาน"
                  name="maxScore"
                  rules={[{ required: true, type: 'number', min: 1, max: 100, message: 'ระบุ 1-100' }]}
                >
                  <InputNumber min={1} max={100} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        )}
      </Modal>

      {/* ฟอร์มตรวจงาน: คะแนน + เวลาที่เสร็จจริง */}
      <Modal
        title={inspectModal?.record?.checked ? 'แก้ผลตรวจงาน' : 'ตรวจงาน'}
        open={!!inspectModal}
        onCancel={() => !saving && setInspectModal(null)}
        onOk={saveInspect}
        confirmLoading={saving}
        okText="บันทึกผลตรวจ"
        cancelText="ยกเลิก"
        destroyOnHidden
        width={520}
        maskClosable={!saving}
        closable={!saving}
      >
        {inspectModal && (
          <Form
            key={inspectModal.key}
            form={inspectForm}
            layout="vertical"
            initialValues={inspectModal.init}
            preserve={false}
          >
            <div style={{ marginBottom: 16 }}>
              <Text strong>{inspectModal.record.task}</Text>
              <br />
              <Text type="secondary">
                {inspectModal.record.cleaner} · {fmtDate(inspectModal.record.date)} · เวลาตามแผน{' '}
                {inspectModal.record.startTime || '-'}–{inspectModal.record.endTime || '-'}
              </Text>
            </div>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="เวลาที่ทำเสร็จจริง"
                  name="finishedTime"
                  rules={[{ required: true, message: 'กรุณาระบุเวลาที่เสร็จ' }]}
                >
                  <Input type="time" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label={`คะแนน (เต็ม ${inspectModal.record.maxScore})`}
                  name="score"
                  rules={[{ required: true, type: 'number', message: 'กรุณาให้คะแนน' }]}
                >
                  <InputNumber
                    min={0}
                    max={inspectModal.record.maxScore}
                    step={0.5}
                    precision={1}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="หมายเหตุผลตรวจ" name="remark">
                  <Input.TextArea rows={2} placeholder="ไม่บังคับ" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  label={`รูปประกอบการตรวจ (${photoCount}/${MAX_INSPECT_PHOTOS})`}
                  extra="ถ่ายหรือเลือกรูปขณะตรวจงาน ระบบจะย่อรูปให้อัตโนมัติ"
                >
                  <Space size={8} wrap align="start">
                    <Image.PreviewGroup>
                      {keptPhotos.map((p) => (
                        <div key={p.id} style={{ position: 'relative' }}>
                          <Image src={p.url} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
                          <Button
                            size="small"
                            danger
                            shape="circle"
                            icon={<DeleteOutlined />}
                            style={{ position: 'absolute', top: -6, right: -6 }}
                            onClick={() => setInspectPhotos((prev) => ({ ...prev, removed: [...prev.removed, p.id] }))}
                          />
                        </div>
                      ))}
                      {inspectPhotos.pending.map((p, i) => (
                        <div key={`new-${i}`} style={{ position: 'relative' }}>
                          <Image src={p.preview} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
                          <Button
                            size="small"
                            danger
                            shape="circle"
                            icon={<DeleteOutlined />}
                            style={{ position: 'absolute', top: -6, right: -6 }}
                            onClick={() => setInspectPhotos((prev) => ({
                              ...prev,
                              pending: prev.pending.filter((_, idx) => idx !== i),
                            }))}
                          />
                        </div>
                      ))}
                    </Image.PreviewGroup>
                    {photoCount < MAX_INSPECT_PHOTOS && (
                      <Upload
                        accept="image/jpeg,image/png,image/webp"
                        showUploadList={false}
                        beforeUpload={pickInspectPhoto}
                      >
                        <Button icon={<CameraOutlined />} style={{ width: 72, height: 72 }}>
                          เพิ่มรูป
                        </Button>
                      </Upload>
                    )}
                  </Space>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        )}
      </Modal>
    </div>
  );
}
