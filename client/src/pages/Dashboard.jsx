import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Col, List, Progress, Row, Space, Tag, Typography } from 'antd';
import {
  CarOutlined, CheckCircleOutlined, ClockCircleOutlined, MedicineBoxOutlined, ShopOutlined,
  TeamOutlined, ToolOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api.js';
import { BarChart, Donut } from '../Charts.jsx';
import InspectorWork from '../InspectorWork.jsx';
import { useAccess } from '../AccessContext.jsx';

/* ---------- ค่าคงที่ / สไตล์กลาง ---------- */
const NAVY = '#0b2a8a';
const BLUE = '#1a4fb8';
const MUTED = '#6b7a99';
const BORDER = '#dbe6f7';
const RED = '#c0392b';
const ORANGE = '#c9821a';
const GREEN = '#2e8b57';

const cardStyle = { borderRadius: 12, border: `1px solid ${BORDER}`, boxShadow: '0 1px 3px rgba(26,79,184,.06)' };

const statusTag = { new: ['red', 'ใหม่'], doing: ['orange', 'กำลังซ่อม'], done: ['green', 'เสร็จแล้ว'] };
const REPAIR = [['new', 'ใหม่', RED], ['doing', 'กำลังซ่อม', ORANGE], ['done', 'เสร็จแล้ว', GREEN]];
const VEHICLE = [['available', 'ว่าง', GREEN], ['in_use', 'ใช้งานอยู่', '#3b6fd8'], ['repair', 'ซ่อมบำรุง', RED]];
const VISIT = [
  ['treated', 'รักษาเบื้องต้น', '#3b6fd8'], ['rest', 'พักห้องพยาบาล', ORANGE],
  ['referred', 'ส่งต่อโรงพยาบาล', RED], ['home', 'กลับบ้าน', '#9aa7c2'],
];

const slices = (defs, map = {}) => defs.map(([key, label, color]) => ({ label, color, value: map[key] || 0 }));
const num = (v) => Number(v ?? 0).toLocaleString('th-TH');

// ล่าช้ามาแล้วนานเท่าไร
function lateText(due, now) {
  const m = Math.max(0, now.diff(dayjs(due), 'minute'));
  if (m >= 1440) return `${Math.floor(m / 1440)} วัน`;
  if (m >= 60) return `${Math.floor(m / 60)} ชม.`;
  return `${m} นาที`;
}

/* ---------- ชิ้นส่วนที่ใช้ซ้ำ ---------- */
function Section({ title, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
      <span style={{ width: 4, height: 18, borderRadius: 2, background: BLUE, alignSelf: 'center' }} />
      <Typography.Title level={5} style={{ margin: 0, color: NAVY }}>{title}</Typography.Title>
      {hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{hint}</Typography.Text>}
    </div>
  );
}

function IconBubble({ color, children, size = 44 }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 12, flex: 'none', display: 'inline-grid', placeItems: 'center',
        background: `${color}1a`, color, fontSize: size * 0.46,
      }}
    >
      {children}
    </span>
  );
}

function StatCard({ icon, color, title, value, suffix, hint }) {
  return (
    <Card size="small" className="h-full" style={cardStyle} styles={{ body: { padding: 16 } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconBubble color={color}>{icon}</IconBubble>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.35 }}>{title}</div>
          <div style={{ color, fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
            {value}
            {suffix && <small style={{ fontSize: 13, fontWeight: 500, marginLeft: 4, color: MUTED }}>{suffix}</small>}
          </div>
          {hint && <div style={{ fontSize: 11, color: '#9aa7c2', lineHeight: 1.3 }}>{hint}</div>}
        </div>
      </div>
    </Card>
  );
}

function OnTimeCard({ pct }) {
  if (pct == null) {
    return <StatCard icon={<CheckCircleOutlined />} color="#9aa7c2" title="ส่งงานซ่อมตรงเวลา" value="-" hint="ยังไม่มีงานที่ปิดแล้วและมีกำหนดส่ง" />;
  }
  const color = pct >= 80 ? GREEN : pct >= 50 ? ORANGE : RED;
  return (
    <Card size="small" className="h-full" style={cardStyle} styles={{ body: { padding: 16 } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Progress type="circle" percent={pct} size={44} strokeWidth={12} strokeColor={color} format={() => ''} />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.35 }}>ส่งงานซ่อมตรงเวลา</div>
          <div style={{ color, fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>{pct}%</div>
          <div style={{ fontSize: 11, color: '#9aa7c2', lineHeight: 1.3 }}>จากงานที่ปิดแล้วและมีกำหนดส่ง</div>
        </div>
      </div>
    </Card>
  );
}

function Panel({ title, extra, children, accent }) {
  return (
    <Card
      size="small"
      className="h-full"
      style={{ ...cardStyle, ...(accent ? { borderColor: accent } : null) }}
      title={<span style={{ fontWeight: 600, color: NAVY, fontSize: 14 }}>{title}</span>}
      extra={extra}
      styles={{ header: { minHeight: 46, borderBottom: `1px solid ${BORDER}` } }}
    >
      {children}
    </Card>
  );
}

/* ---------- งานที่ล่าช้า ---------- */
function OverdueCard({ list, now, onNavigate }) {
  const top = list.slice(0, 5);
  return (
    <Panel
      accent={list.length ? '#f1c4be' : undefined}
      title={
        <Space size={8}>
          <WarningOutlined style={{ color: list.length ? RED : GREEN }} />
          <span>งานที่ล่าช้า</span>
          <Badge count={list.length} showZero color={list.length ? RED : GREEN} />
        </Space>
      }
      extra={list.length > top.length && <a onClick={() => onNavigate?.('facilities')}>ดูทั้งหมด</a>}
    >
      {list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: GREEN }}>
          <CheckCircleOutlined style={{ fontSize: 36 }} />
          <div style={{ marginTop: 8, fontWeight: 600 }}>ไม่มีงานล่าช้า</div>
          <div style={{ fontSize: 12, color: MUTED }}>ทุกงานอยู่ในกำหนดส่ง</div>
        </div>
      ) : (
        <List
          dataSource={top}
          renderItem={(r) => (
            <List.Item style={{ cursor: 'pointer', padding: '10px 0' }} onClick={() => onNavigate?.('facilities')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Typography.Text strong ellipsis style={{ minWidth: 0 }}>#{r.id} {r.title}</Typography.Text>
                    <Tag color={statusTag[r.status]?.[0]} style={{ marginInlineEnd: 0, flex: 'none' }}>{statusTag[r.status]?.[1]}</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: MUTED }}>
                    {[r.location, r.assignee ? `ผู้รับผิดชอบ ${r.assignee}` : 'ยังไม่มีผู้รับผิดชอบ'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <Tag color="red" style={{ marginInlineEnd: 0, fontWeight: 600 }}>เลย {lateText(r.due_date, now)}</Tag>
                  <div style={{ fontSize: 11, color: '#9aa7c2', marginTop: 2 }}>
                    กำหนด {dayjs(r.due_date).format('DD/MM HH:mm')} น.
                  </div>
                </div>
              </div>
            </List.Item>
          )}
        />
      )}
    </Panel>
  );
}

const LINE_COMMANDS = [
  ['#ซ่อม แอร์ห้อง 301 ไม่เย็น @อาคาร 3', 'แจ้งซ่อม'],
  ['#รับงาน 12', 'รับงาน'],
  ['#สถานะ 12 เสร็จ', 'เปลี่ยนสถานะ'],
  ['#ส่งงาน 12', 'ส่งงาน + ส่งรูป'],
  ['#โรงอาหาร 5000 3200 ขายดี', 'บันทึกโรงอาหาร'],
  ['#พยาบาล สมชาย ใจดี @ม.2/3 ปวดท้อง', 'บันทึกห้องพยาบาล'],
  ['#ผลดูแล 5 กลับบ้าน', 'อัปเดตผลการดูแล'],
  ['#ตรวจสุขภาพ สมชาย ใจดี @ม.2/3 45 158', 'บันทึกตรวจสุขภาพ'],
];

/* ---------- ส่วนแสดงผล (รับข้อมูลเข้ามา) ---------- */
export function DashboardView({ s, k, repairs, now, onNavigate, tick, showInspectorWork }) {
  const overdue = useMemo(
    () => repairs
      .filter((r) => r.status !== 'done' && r.due_date && dayjs(r.due_date).isBefore(now))
      .sort((a, b) => dayjs(a.due_date).valueOf() - dayjs(b.due_date).valueOf()),
    [repairs, now],
  );
  const recent = repairs.slice(0, 5);

  const stats = [
    [<ToolOutlined />, RED, 'งานซ่อมใหม่รอรับเรื่อง', num(s.repairs_new)],
    [<ToolOutlined />, ORANGE, 'งานซ่อมกำลังดำเนินการ', num(s.repairs_doing)],
    [<ShopOutlined />, BLUE, 'กำไรโรงอาหารเดือนนี้', num(s.profit_month), 'บาท'],
    [<CarOutlined />, NAVY, 'รถที่ว่าง', `${s.vehicles_free}/${s.vehicles_total}`, 'คัน'],
    [<MedicineBoxOutlined />, GREEN, 'เข้าห้องพยาบาลวันนี้', num(s.nurse_today), 'ราย'],
    [<TeamOutlined />, '#3b6fd8', 'คนงานที่ทำงานอยู่', num(s.workers_active), 'คน'],
  ];

  return (
    <div className="grid gap-4">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
        <Typography.Title level={4} style={{ margin: 0, color: NAVY }}>ภาพรวมวันนี้</Typography.Title>
        <Typography.Text type="secondary">{now.format('dddd D MMMM YYYY')}</Typography.Text>
      </div>

      <Row gutter={[12, 12]}>
        {stats.map(([icon, color, title, value, suffix]) => (
          <Col key={title} xs={12} md={8} xl={4}>
            <StatCard icon={icon} color={color} title={title} value={value} suffix={suffix} />
          </Col>
        ))}
      </Row>

      <Section title="ตัวชี้วัด (KPI)" />
      {k === false && (
        <Alert type="warning" showIcon message="โหลดข้อมูลกราฟไม่สำเร็จ" description="ตรวจสอบว่าเซิร์ฟเวอร์เป็นเวอร์ชันล่าสุดและรัน node server/initdb.js แล้ว" />
      )}
      {k === null && <Typography.Text type="secondary">กำลังโหลดกราฟ…</Typography.Text>}
      {k && (
        <Row gutter={[12, 12]}>
          <Col xs={12} lg={6}><OnTimeCard pct={k.repairs_on_time_pct} /></Col>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<ClockCircleOutlined />} color={BLUE} title="เวลาเฉลี่ยปิดงานซ่อม"
              value={k.repairs_avg_days ?? '-'} suffix={k.repairs_avg_days == null ? '' : 'วัน'} hint="นับจากวันที่แจ้ง"
            />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<WarningOutlined />} color={overdue.length ? RED : GREEN} title="งานซ่อมเลยกำหนดส่ง"
              value={num(overdue.length)} suffix="งาน" hint={overdue.length ? 'ดูรายการด้านล่าง' : 'ไม่มีงานล่าช้า'}
            />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<CarOutlined />} color={k.vehicles_service_soon ? ORANGE : GREEN} title="รถครบกำหนดเช็กระยะ"
              value={num(k.vehicles_service_soon)} suffix="คัน" hint="ภายใน 30 วัน"
            />
          </Col>
        </Row>
      )}

      {showInspectorWork && (
        <>
          <Section title="งานของผู้ตรวจ" hint="งานที่ยังไม่เสร็จและอยู่ในแผน" />
          <InspectorWork tick={tick} onNavigate={onNavigate} />
        </>
      )}

      <Section title="งานที่ต้องติดตาม" />
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}><OverdueCard list={overdue} now={now} onNavigate={onNavigate} /></Col>
        <Col xs={24} lg={10}>
          <Panel title="งานซ่อมล่าสุด">
            <List
              dataSource={recent}
              locale={{ emptyText: 'ยังไม่มีงานซ่อม' }}
              renderItem={(r) => (
                <List.Item style={{ padding: '10px 0' }} extra={<Tag color={statusTag[r.status]?.[0]} style={{ marginInlineEnd: 0 }}>{statusTag[r.status]?.[1]}</Tag>}>
                  <List.Item.Meta
                    title={<Typography.Text ellipsis>{r.title}</Typography.Text>}
                    description={[r.location, r.reporter].filter(Boolean).join(' · ') || '-'}
                  />
                </List.Item>
              )}
            />
          </Panel>
        </Col>
      </Row>

      {k && (
        <>
          <Section title="กราฟสรุป" />
          <Row gutter={[12, 12]}>
            <Col xs={24} lg={12}>
              <Panel title="สถานะงานซ่อมทั้งหมด">
                <Donut data={slices(REPAIR, k.repairs_by_status)} centerLabel="งาน" />
              </Panel>
            </Col>
            <Col xs={24} lg={12}>
              <Panel title="งานซ่อม แจ้งเข้า / ปิดงาน รายเดือน (6 เดือน)">
                <BarChart
                  integer
                  data={k.repairs_monthly.map((m) => ({ ...m, label: dayjs(`${m.month}-01`).format('MMM') }))}
                  series={[
                    { key: 'created', label: 'แจ้งเข้า', color: ORANGE },
                    { key: 'done', label: 'ปิดงานแล้ว', color: GREEN },
                  ]}
                  unit=" งาน"
                />
              </Panel>
            </Col>
            <Col xs={24} lg={12}>
              <Panel
                title="รายรับ-รายจ่ายโรงอาหาร รายเดือน (6 เดือน)"
                extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>กำไรเดือนนี้ {num(s.profit_month)} บาท</Typography.Text>}
              >
                <BarChart
                  data={k.canteen_monthly.map((m) => ({ ...m, label: dayjs(`${m.month}-01`).format('MMM') }))}
                  series={[
                    { key: 'revenue', label: 'รายรับ', color: BLUE },
                    { key: 'cost', label: 'รายจ่าย', color: ORANGE },
                  ]}
                  unit=" บาท"
                />
              </Panel>
            </Col>
            <Col xs={24} lg={12}>
              <Panel title="จำนวนเข้าห้องพยาบาล 14 วันล่าสุด">
                <BarChart
                  integer
                  data={k.nurse_daily.map((d) => ({ label: dayjs(d.day).format('D'), n: d.n }))}
                  series={[{ key: 'n', label: 'ราย', color: GREEN }]}
                  unit=" ราย"
                />
              </Panel>
            </Col>
            <Col xs={24} lg={12}>
              <Panel title="ผลการดูแลห้องพยาบาล (30 วัน)">
                <Donut data={slices(VISIT, k.nurse_by_status)} centerLabel="ราย" />
              </Panel>
            </Col>
            <Col xs={24} lg={12}>
              <Panel title="สถานะยานพาหนะ">
                <Donut data={slices(VEHICLE, k.vehicles_by_status)} centerLabel="คัน" />
              </Panel>
            </Col>
          </Row>
        </>
      )}

      <Section title="ส่งงานผ่านกลุ่มไลน์" hint="ข้อมูลจะขึ้นที่เว็บทันที" />
      <Card size="small" style={cardStyle} styles={{ body: { padding: 16 } }}>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {LINE_COMMANDS.map(([cmd, label]) => (
            <div key={cmd} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 120, flex: 'none', fontSize: 12, color: MUTED }}>{label}</span>
              <code style={{ background: '#f2f6fc', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '1px 8px', fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cmd}
              </code>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- ดึงข้อมูล ---------- */
export default function Dashboard({ tick, onNavigate }) {
  const [s, setS] = useState(null);
  const [k, setK] = useState(null); // null = กำลังโหลด, false = โหลดไม่สำเร็จ
  const [repairs, setRepairs] = useState([]);
  const [now, setNow] = useState(dayjs());
  const { access } = useAccess();

  useEffect(() => {
    api('/stats').then(setS).catch(() => {});
    api('/repairs').then(setRepairs).catch(() => {});
    api('/kpi').then(setK).catch(() => setK(false));
  }, [tick]);

  // อัปเดต "เลยกำหนด" ทุก 1 นาทีโดยไม่ต้องรีเฟรชหน้า
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 60000);
    return () => clearInterval(t);
  }, []);

  if (!s) return null;
  const showInspectorWork = Boolean(access && (access.is_admin || access.role === 'inspector'));
  return (
    <DashboardView
      s={s}
      k={k}
      repairs={repairs}
      now={now}
      onNavigate={onNavigate}
      tick={tick}
      showInspectorWork={showInspectorWork}
    />
  );
}
