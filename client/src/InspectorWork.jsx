import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Empty, List, Progress, Row, Space, Spin, Statistic, Tag, Typography,
} from 'antd';
import {
  AuditOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DeleteOutlined, ShopOutlined, ToolOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from './api.js';

const { Text } = Typography;

const REPAIR_STAGE = {
  submitted: ['orange', 'ส่งงานแล้ว รออนุมัติปิดงาน'],
  rejected: ['red', 'ส่งกลับแก้ไข'],
  pending: ['blue', 'กำลังดำเนินการ'],
};

const fmtDate = (v) => (v ? dayjs(v).format('DD/MM/YY') : '-');
const fmtDateTime = (v) => (v ? dayjs(v).format('DD/MM/YY HH:mm') : '-');

function Tile({ icon, color, title, value, suffix, onClick }) {
  return (
    <Card
      size="small"
      hoverable={Boolean(onClick)}
      onClick={onClick}
      style={{ borderRadius: 12, height: '100%' }}
      styles={{ body: { padding: 14 } }}
    >
      <Statistic
        title={<span style={{ fontSize: 12 }}>{title}</span>}
        value={value}
        suffix={suffix}
        prefix={<span style={{ color }}>{icon}</span>}
        valueStyle={{ color: value ? color : undefined, fontSize: 24 }}
      />
    </Card>
  );
}

// ตารางงานประจำ (แม่บ้าน/คนสวน) ของผู้ตรวจหนึ่งคน
function DailyBlock({ title, data, onOpen }) {
  if (!data) return null;
  const pct = data.today_total ? Math.round((data.today_done * 100) / data.today_total) : 0;

  return (
    <div style={{ marginTop: 16 }}>
      <Space wrap style={{ marginBottom: 8 }}>
        <Text strong>{title}</Text>
        <Tag color={data.today_pending ? 'orange' : 'green'}>
          วันนี้ตรวจแล้ว {data.today_done}/{data.today_total}
        </Tag>
        {data.missed_count > 0 && <Tag color="red">ค้างย้อนหลัง 7 วัน {data.missed_count}</Tag>}
        <Tag color="blue">แผน 7 วันข้างหน้า {data.upcoming_count}</Tag>
        {onOpen && <Button size="small" type="link" onClick={onOpen}>เปิดหน้าตรวจงาน</Button>}
      </Space>

      {data.today_total > 0 && <Progress percent={pct} size="small" status={pct === 100 ? 'success' : 'active'} />}

      {data.today_items.length > 0 && (
        <List
          size="small"
          header={<Text type="secondary">วันนี้ยังไม่ตรวจ ({data.today_pending})</Text>}
          dataSource={data.today_items}
          renderItem={(r) => (
            <List.Item>
              <List.Item.Meta
                title={<span>{r.task}</span>}
                description={[
                  r.cleaner,
                  [r.building, r.location].filter(Boolean).join(' '),
                  r.start_time && `${r.start_time}-${r.end_time || ''}`,
                ].filter(Boolean).join(' · ')}
              />
            </List.Item>
          )}
        />
      )}

      {data.missed_items.length > 0 && (
        <List
          size="small"
          header={<Text type="danger">ค้างย้อนหลัง ยังไม่ได้ตรวจ ({data.missed_count})</Text>}
          dataSource={data.missed_items}
          renderItem={(r) => (
            <List.Item extra={<Tag color="red">{fmtDate(r.date)}</Tag>}>
              <List.Item.Meta title={r.task} description={r.cleaner} />
            </List.Item>
          )}
        />
      )}

      {data.upcoming_by_date.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <CalendarOutlined /> แผนล่วงหน้า:{' '}
          </Text>
          <Space size={[4, 4]} wrap>
            {data.upcoming_by_date.map((d) => (
              <Tag key={d.date}>{fmtDate(d.date)} · {d.count} งาน</Tag>
            ))}
          </Space>
        </div>
      )}
    </div>
  );
}

function RepairBlock({ data, onOpen }) {
  if (!data) return null;
  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Text strong><ToolOutlined /> งานซ่อมที่ยังไม่ปิด ({data.open})</Text>
        {data.waiting_approval > 0 && <Tag color="orange">รออนุมัติปิดงาน {data.waiting_approval}</Tag>}
        {data.in_progress > 0 && <Tag color="blue">กำลังดำเนินการ {data.in_progress}</Tag>}
        {data.rejected > 0 && <Tag color="red">ส่งกลับแก้ไข {data.rejected}</Tag>}
        {data.overdue > 0 && <Tag color="red" icon={<WarningOutlined />}>เลยกำหนด {data.overdue}</Tag>}
        {onOpen && <Button size="small" type="link" onClick={onOpen}>เปิดหน้างานซ่อม</Button>}
      </Space>
      {data.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ไม่มีงานซ่อมค้าง" />
      ) : (
        <List
          size="small"
          dataSource={data.items}
          renderItem={(r) => {
            const [color, label] = REPAIR_STAGE[r.approval_status] || REPAIR_STAGE.pending;
            return (
              <List.Item
                extra={(
                  <Space direction="vertical" size={2} align="end">
                    <Tag color={color} style={{ marginInlineEnd: 0 }}>{label}</Tag>
                    {r.due_date && (
                      <Text type={r.overdue ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                        <ClockCircleOutlined /> กำหนด {fmtDateTime(r.due_date)}
                      </Text>
                    )}
                  </Space>
                )}
              >
                <List.Item.Meta
                  title={<span>#{r.id} {r.title}</span>}
                  description={[
                    r.location,
                    r.assignee && `ผู้รับผิดชอบ ${r.assignee}`,
                    r.rejection_reason && `เหตุผลที่ส่งกลับ: ${r.rejection_reason}`,
                  ].filter(Boolean).join(' · ') || '-'}
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * งานของผู้ตรวจ: งานที่ยังไม่เสร็จและอยู่ในแผน
 * admin เห็นของผู้ตรวจทุกคน (+ งานที่ยังไม่มอบหมาย) ผู้ตรวจเห็นเฉพาะของตัวเอง
 */
export default function InspectorWork({ tick, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api('/inspector-work'));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, tick]);

  const go = (key) => (onNavigate ? () => onNavigate(key) : undefined);

  if (loading) return <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>;
  if (error) return <Alert type="warning" showIcon message="โหลดงานของผู้ตรวจไม่สำเร็จ" description={error} />;
  if (!data) return null;

  const { totals, inspectors, unassigned, canteen } = data;
  const isAll = data.scope === 'all';

  const items = inspectors.map((u) => ({
    key: u.username,
    label: (
      <Space wrap>
        <AuditOutlined />
        <Text strong>{u.display_name}</Text>
        <Tag color={u.open_total ? 'orange' : 'green'}>
          {u.open_total ? `ค้าง ${u.open_total} รายการ` : 'ไม่มีงานค้าง'}
        </Tag>
        {u.delete_requests > 0 && <Tag color="red">คำขอลบรอพิจารณา {u.delete_requests}</Tag>}
      </Space>
    ),
    children: (
      <div>
        <RepairBlock data={u.repairs} onOpen={go('facilities-repair')} />
        <DailyBlock title="งานแม่บ้าน" data={u.housekeeping} onOpen={go('facilities-housekeeping')} />
        <DailyBlock title="งานสวน" data={u.gardening} onOpen={go('facilities-garden')} />
        {!u.repairs && !u.housekeeping && !u.gardening && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่ได้กำหนดเมนูงานให้ผู้ตรวจคนนี้" />
        )}
      </div>
    ),
  }));

  return (
    <div className="grid gap-4">
      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<CheckCircleOutlined />} color="#c9821a" title="งานซ่อมรออนุมัติปิดงาน"
            value={totals.repairs_waiting_approval} onClick={go('facilities-repair')} />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<ToolOutlined />} color="#1a4fb8" title="งานซ่อมที่ยังไม่ปิด"
            value={totals.repairs_open} onClick={go('facilities-repair')} />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<WarningOutlined />} color="#c0392b" title="งานซ่อมเลยกำหนดส่ง"
            value={totals.repairs_overdue} onClick={go('facilities-repair')} />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<AuditOutlined />} color="#c9821a" title="แม่บ้านวันนี้ รอตรวจ"
            value={totals.housekeeping_today_pending} onClick={go('facilities-housekeeping')} />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<AuditOutlined />} color="#2e8b57" title="งานสวนวันนี้ รอตรวจ"
            value={totals.gardening_today_pending} onClick={go('facilities-garden')} />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<WarningOutlined />} color="#c0392b" title="ค้างย้อนหลัง 7 วัน (แม่บ้าน/สวน)"
            value={totals.missed} />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<CalendarOutlined />} color="#3b6fd8" title="อยู่ในแผน 7 วันข้างหน้า"
            value={totals.upcoming} suffix="งาน" />
        </Col>
        <Col xs={12} md={8} xl={6}>
          <Tile icon={<DeleteOutlined />} color="#c0392b" title="คำขอลบรอพิจารณา"
            value={totals.delete_requests} onClick={go('delete-requests')} />
        </Col>
        {canteen && (
          <Col xs={12} md={8} xl={6}>
            <Tile icon={<ShopOutlined />} color="#1a4fb8" title="โรงอาหารรอตรวจสอบ"
              value={totals.canteen_unverified} suffix="รายการ" onClick={go('nutrition')} />
          </Col>
        )}
      </Row>

      {isAll && totals.unassigned > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`มีงานที่ยังไม่มอบหมายผู้ตรวจ ${totals.unassigned} รายการ`}
          description={(
            <Space direction="vertical" size={2}>
              <span>ผู้ตรวจจะไม่เห็นงานเหล่านี้ จนกว่าจะเลือกผู้ตรวจในฟอร์มแก้ไขงาน</span>
              <Space wrap>
                {unassigned.repairs.open > 0 && (
                  <Button size="small" onClick={go('facilities-repair')}>งานซ่อม {unassigned.repairs.open}</Button>
                )}
                {(unassigned.housekeeping.today_pending + unassigned.housekeeping.missed_count) > 0 && (
                  <Button size="small" onClick={go('facilities-housekeeping')}>
                    งานแม่บ้าน {unassigned.housekeeping.today_pending + unassigned.housekeeping.missed_count}
                  </Button>
                )}
                {(unassigned.gardening.today_pending + unassigned.gardening.missed_count) > 0 && (
                  <Button size="small" onClick={go('facilities-garden')}>
                    งานสวน {unassigned.gardening.today_pending + unassigned.gardening.missed_count}
                  </Button>
                )}
              </Space>
            </Space>
          )}
        />
      )}

      {items.length === 0 ? (
        <Empty description="ยังไม่มีผู้ตรวจในระบบ สร้างบัญชีผู้ตรวจได้ที่เมนู จัดการผู้ใช้" />
      ) : (
        <Collapse
          items={items}
          defaultActiveKey={items.map((i) => i.key)}
          style={{ background: '#fff' }}
        />
      )}

      {canteen && canteen.items.length > 0 && (
        <Card
          size="small"
          title={<span><ShopOutlined /> โรงอาหารที่รอตรวจสอบ ({canteen.unverified})</span>}
          extra={<Button size="small" type="link" onClick={go('nutrition')}>เปิดหน้าโรงอาหาร</Button>}
        >
          <List
            size="small"
            dataSource={canteen.items}
            renderItem={(c) => (
              <List.Item extra={<Text>กำไร {(Number(c.revenue) - Number(c.cost)).toLocaleString('th-TH')} บาท</Text>}>
                <List.Item.Meta
                  title={`${fmtDate(c.date)} ${c.shop ? `· ${c.shop}` : ''}`}
                  description={[`รายรับ ${Number(c.revenue).toLocaleString('th-TH')}`, `รายจ่าย ${Number(c.cost).toLocaleString('th-TH')}`, c.reporter].filter(Boolean).join(' · ')}
                />
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
}
