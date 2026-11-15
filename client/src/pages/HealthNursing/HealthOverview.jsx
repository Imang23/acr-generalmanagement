import { useEffect, useState } from 'react';
import { Alert, Card, Col, Empty, Progress, Row, Segmented, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../api.js';

const { Text } = Typography;

const COLORS = {
  สมส่วน: '#52c41a', น้ำหนักตามเกณฑ์: '#52c41a', ส่วนสูงตามเกณฑ์: '#52c41a',
  ผอม: '#f5222d', อ้วน: '#f5222d', เริ่มอ้วน: '#fa8c16', ท้วม: '#faad14', ค่อนข้างผอม: '#faad14',
};
const colorOf = (k) => COLORS[k] || (/(มาก|เตี้ย|น้อย)/.test(k) ? '#fa8c16' : '#1677ff');
const STATUS = { treated: 'รักษาเบื้องต้น', rest: 'พักห้องพยาบาล', referred: 'ส่งต่อโรงพยาบาล', home: 'กลับบ้าน' };
const NUT_TABS = [
  { value: 'weight_height', label: 'น้ำหนักตามเกณฑ์ส่วนสูง' },
  { value: 'weight_age', label: 'น้ำหนักตามเกณฑ์อายุ' },
  { value: 'height_age', label: 'ส่วนสูงตามเกณฑ์อายุ' },
];

// การ์ดสูงเท่ากันในแถวเดียวกัน และเนื้อหายืดเต็มการ์ด
const fill = { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' };
const fillBody = { body: { flex: 1 } };
const Fill = ({ children, ...p }) => <Col {...p} style={{ display: 'flex', minWidth: 0 }}>{children}</Col>;

function Kpi({ title, value, suffix, color, hint }) {
  return (
    <Card size="small" style={fill} styles={{ body: { padding: '14px 18px', flex: 1 } }}>
      <Statistic title={title} value={value} suffix={suffix} valueStyle={{ color, fontSize: 28 }} />
      {hint && <Text type="secondary" style={{ fontSize: 12 }}>{hint}</Text>}
    </Card>
  );
}

function Bars({ data, total }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ไม่มีข้อมูล" />;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={10}>
      {entries.map(([k, n]) => (
        <div key={k}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text>{k}</Text>
            <Text type="secondary">{n} คน · {total ? Math.round((n * 100) / total) : 0}%</Text>
          </div>
          <Progress percent={total ? (n * 100) / total : 0} showInfo={false} strokeColor={colorOf(k)} size={['100%', 10]} />
        </div>
      ))}
    </Space>
  );
}

function Row2({ left, right, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}>
      <Text>{left}</Text><Text strong={strong}>{right}</Text>
    </div>
  );
}

// ภาพรวมงานอนามัย: ผลตรวจสุขภาพ + ห้องพยาบาล + สโตร์ยา
export default function HealthOverview({ tick }) {
  const [date, setDate] = useState();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [nut, setNut] = useState('weight_height');

  useEffect(() => {
    setLoading(true);
    api(`/health-dashboard${date ? `?date=${date}` : ''}`)
      .then((d) => { setData(d); setErr(''); })
      .catch((e) => setErr(e.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [date, tick]);

  if (err) return <Alert type="error" showIcon message={err} />;
  if (loading && !data) return <Spin />;
  if (!data) return null;

  const { health, nurse, medicines } = data;
  const rooms = Object.entries(health?.nutrition_by_room || {}).sort((a, b) => a[0].localeCompare(b[0], 'th', { numeric: true }));
  const nutKeys = [...new Set(rooms.flatMap(([, v]) => Object.keys(v)))]
    .sort((a, b) => (health.nutrition.weight_height[b] || 0) - (health.nutrition.weight_height[a] || 0));
  const statusTotal = Object.values(nurse.by_status).reduce((a, b) => a + b, 0);
  const found = (health?.findings || []).filter((f) => f.count).sort((a, b) => b.count - a.count);
  const clear = (health?.findings || []).filter((f) => !f.count).map((f) => f.label);
  const maxFound = found[0]?.count || 1;
  const medIssue = medicines.low + medicines.expired + medicines.expiring;

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Text strong style={{ fontSize: 16 }}>ภาพรวมงานอนามัย</Text>
          <Space>
            <Text type="secondary">ผลตรวจสุขภาพวันที่</Text>
            <Select style={{ width: 150 }} value={data.date} onChange={setDate} placeholder="ยังไม่มีข้อมูล"
              options={data.dates.map((d) => ({ value: d, label: dayjs(d).format('DD/MM/YYYY') }))} />
          </Space>
        </div>

        {/* 1) ตัวเลขหลัก */}
        <Row gutter={[16, 16]}>
          <Fill xs={12} lg={6}><Kpi title="นักเรียนที่ตรวจ" value={health?.total ?? 0} suffix="คน" /></Fill>
          <Fill xs={12} lg={6}>
            <Kpi title="ต้องติดตาม" value={health?.follow_up_count ?? 0} suffix="คน" color={health?.follow_up_count ? '#cf1322' : undefined}
              hint={health?.total ? `${Math.round((health.follow_up_count * 100) / health.total)}% ของที่ตรวจ` : undefined} />
          </Fill>
          <Fill xs={12} lg={6}><Kpi title="มาห้องพยาบาลวันนี้" value={nurse.today} suffix="คน" hint={`30 วันล่าสุด ${nurse.last30} ครั้ง`} /></Fill>
          <Fill xs={12} lg={6}>
            <Kpi title="ยาที่ต้องดูแล" value={medIssue} suffix={`/ ${medicines.total}`} color={medicines.low + medicines.expired ? '#cf1322' : undefined}
              hint={`หมดอายุ ${medicines.expired} · ใกล้หมดอายุ ${medicines.expiring} · ใกล้หมดสต็อก ${medicines.low}`} />
          </Fill>
        </Row>

        {!health ? <Alert type="info" showIcon message="ยังไม่มีผลตรวจสุขภาพ นำเข้าไฟล์ Excel ที่แท็บ “ตรวจสุขภาพ” ก่อน" /> : (
          <>
            {/* 2) โภชนาการ (กว้าง) + ผลที่พบผิดปกติ */}
            <Row gutter={[16, 16]}>
              <Fill xs={24} lg={14}>
                <Card size="small" style={fill} styles={fillBody} title="ภาวะโภชนาการ">
                  <Segmented block size="small" value={nut} onChange={setNut} options={NUT_TABS} style={{ marginBottom: 16 }} />
                  <Bars data={health.nutrition[nut]} total={health.total} />
                </Card>
              </Fill>
              <Fill xs={24} lg={10}>
                <Card size="small" style={fill} styles={fillBody} title="ผลตรวจที่พบความผิดปกติ">
                  {found.length ? (
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      {found.map((f) => (
                        <div key={f.key}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text>{f.label}</Text><Text strong type="danger">{f.count} คน</Text>
                          </div>
                          <Progress percent={(f.count * 100) / maxFound} showInfo={false} strokeColor="#f5222d" size={['100%', 6]} />
                        </div>
                      ))}
                    </Space>
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ไม่พบความผิดปกติ" />}
                  {clear.length > 0 && found.length > 0 && (
                    <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>ปกติทั้งหมด: {clear.join(' · ')}</Text>
                  )}
                </Card>
              </Fill>
            </Row>

            {/* 3) แยกห้อง (เต็มความกว้าง) */}
            <Card size="small" title="ภาวะโภชนาการแยกห้อง (น้ำหนักตามเกณฑ์ส่วนสูง)">
              <Table size="small" pagination={false} rowKey="room" scroll={{ x: 'max-content' }}
                dataSource={rooms.map(([room, v]) => ({ room, total: Object.values(v).reduce((a, b) => a + b, 0), ...v }))}
                columns={[
                  { title: 'ห้อง', dataIndex: 'room', width: 80 },
                  ...nutKeys.map((k) => ({
                    title: <span style={{ color: colorOf(k) }}>{k}</span>, dataIndex: k, align: 'center', render: (n) => n || '-',
                  })),
                  { title: 'รวม', dataIndex: 'total', align: 'center', render: (n) => <Text strong>{n}</Text> },
                ]} />
            </Card>

            {/* 4) ห้องพยาบาล | สโตร์ยา (สูงเท่ากัน) */}
            <Row gutter={[16, 16]}>
              <Fill xs={24} lg={12}>
                <Card size="small" style={fill} styles={fillBody} title="ห้องพยาบาล 30 วันล่าสุด">
                  {nurse.top_symptoms.length ? (
                    <>
                      <Text type="secondary" style={{ fontSize: 12 }}>อาการที่พบบ่อย</Text>
                      {nurse.top_symptoms.slice(0, 5).map((s) => <Row2 key={s.symptom} left={s.symptom} right={`${s.n} ครั้ง`} strong />)}
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>ผลการดูแล</Text>
                      {Object.entries(nurse.by_status).map(([k, n]) => (
                        <Row2 key={k} left={STATUS[k] || k} right={`${n} · ${statusTotal ? Math.round((n * 100) / statusTotal) : 0}%`} />
                      ))}
                    </>
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ไม่มีข้อมูล" />}
                </Card>
              </Fill>
              <Fill xs={24} lg={12}>
                <Card size="small" style={fill} styles={fillBody} title="สโตร์ยาที่ต้องดูแล">
                  <Table size="small" pagination={false} rowKey="name" dataSource={medicines.attention.slice(0, 6)}
                    locale={{ emptyText: 'ยาทุกรายการปกติ' }}
                    columns={[
                      { title: 'ยา', dataIndex: 'name' },
                      { title: 'คงเหลือ', dataIndex: 'qty', align: 'right', render: (v, r) => `${v.toLocaleString()} ${r.unit}` },
                      {
                        title: 'ปัญหา', render: (_, r) => (
                          <Space size={4} wrap>
                            {r.expired && <Tag color="red">หมดอายุ</Tag>}
                            {!r.expired && r.expiry && <Tag color="orange">หมดอายุ {dayjs(r.expiry).format('DD/MM/YY')}</Tag>}
                            {r.low && <Tag color="volcano">{r.qty <= 0 ? 'หมด' : 'ใกล้หมด'}</Tag>}
                          </Space>),
                      },
                    ]} />
                </Card>
              </Fill>
            </Row>

            {/* 5) รายชื่อติดตาม (เต็มความกว้าง) */}
            <Card size="small" title={`นักเรียนที่ต้องติดตาม (${health.follow_up_count} คน)`}>
              <Table size="small" rowKey={(r) => `${r.class_room}-${r.student}`} dataSource={health.follow_up}
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                columns={[
                  { title: 'ชื่อ', dataIndex: 'student', width: 260 },
                  { title: 'ชั้น/ห้อง', dataIndex: 'class_room', width: 90 },
                  { title: 'ประเด็น', dataIndex: 'issues', render: (v) => <Space wrap size={[4, 4]}>{v.map((i) => <Tag key={i} color="volcano">{i}</Tag>)}</Space> },
                ]} />
            </Card>
          </>
        )}
      </Space>
    </Spin>
  );
}
