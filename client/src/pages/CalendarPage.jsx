import { useEffect, useMemo, useState } from 'react';
import { Badge, Calendar, Card, Checkbox, Empty, Grid, List, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api.js';

// แหล่งข้อมูลของทุกงานที่จะมาแสดงบนปฏิทิน
// เพิ่มงานใหม่ได้ด้วยการเติม 1 รายการในอาร์เรย์นี้
const SOURCES = [
  {
    key: 'repairs', label: 'งานซ่อม', color: '#c0392b', page: 'facilities', path: '/repairs',
    date: (r) => r.created_at,
    title: (r) => r.title,
    desc: (r) => [r.location, r.reporter].filter(Boolean).join(' · '),
  },
  {
    key: 'repairs_due', label: 'กำหนดส่งงานซ่อม', color: '#8e44ad', page: 'facilities', path: '/repairs',
    date: (r) => r.due_date,
    title: (r) => `ส่งงาน ${dayjs(r.due_date).format('HH:mm')} น. ${r.title}`,
    desc: (r) => (r.assignee ? `ผู้รับผิดชอบ ${r.assignee}` : ''),
  },
  {
    key: 'vehicles', label: 'เช็กระยะรถ', color: '#c9821a', page: 'general', path: '/vehicles',
    date: (r) => r.next_service,
    title: (r) => `ครบกำหนดเช็กระยะ ${r.plate}`,
    desc: (r) => [r.name, r.driver].filter(Boolean).join(' · '),
  },
  {
    key: 'nurse_visits', label: 'ห้องพยาบาล', color: '#3b6fd8', page: 'health', path: '/nurse_visits',
    date: (r) => r.date,
    title: (r) => `${r.student} – ${r.symptom}`,
    desc: (r) => r.class_room,
  },
  {
    key: 'health_checks', label: 'ตรวจสุขภาพ', color: '#0b2a8a', page: 'health', path: '/health_checks',
    date: (r) => r.date,
    title: (r) => `ตรวจสุขภาพ ${r.student}`,
    desc: (r) => r.class_room,
  },
  {
    key: 'canteen', label: 'โรงอาหาร', color: '#2e8b57', page: 'nutrition', path: '/canteen',
    date: (r) => r.date,
    title: (r) => `กำไร ${((r.revenue || 0) - (r.cost || 0)).toLocaleString()} บาท`,
    desc: (r) => r.note,
  },
];

const dayKey = (d) => dayjs(d).format('YYYY-MM-DD');

export default function CalendarPage({ tick, onNavigate }) {
  const screens = Grid.useBreakpoint();
  const [events, setEvents] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [selected, setSelected] = useState(dayjs());

  useEffect(() => {
    let alive = true;
    Promise.allSettled(SOURCES.map((s) => api(s.path))).then((results) => {
      if (!alive) return;
      const all = [];
      results.forEach((res, i) => {
        if (res.status !== 'fulfilled' || !Array.isArray(res.value)) return;
        const s = SOURCES[i];
        res.value.forEach((r) => {
          const d = s.date(r);
          if (!d || !dayjs(d).isValid()) return;
          all.push({
            id: `${s.key}-${r.id ?? all.length}`,
            day: dayKey(d),
            source: s,
            title: s.title(r),
            desc: s.desc(r),
          });
        });
      });
      setEvents(all);
    });
    return () => { alive = false; };
  }, [tick]);

  const byDay = useMemo(() => {
    const m = {};
    events.filter((e) => !hidden.includes(e.source.key)).forEach((e) => {
      (m[e.day] ||= []).push(e);
    });
    return m;
  }, [events, hidden]);

  const cellRender = (current, info) => {
    if (info.type !== 'date') return info.originNode;
    const list = byDay[dayKey(current)] || [];
    if (!list.length) return null;
    // จอเล็ก: แสดงเป็นจุดสี / จอใหญ่: แสดงรายการย่อ
    if (!screens.md) {
      return (
        <div style={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[...new Set(list.map((e) => e.source.color))].map((c) => <Badge key={c} color={c} />)}
        </div>
      );
    }
    return (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {list.slice(0, 3).map((e) => (
          <li key={e.id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
            <Badge color={e.source.color} text={e.title} />
          </li>
        ))}
        {list.length > 3 && <li style={{ fontSize: 12, color: '#888' }}>+{list.length - 3} รายการ</li>}
      </ul>
    );
  };

  const dayEvents = byDay[dayKey(selected)] || [];

  return (
    <div className="grid gap-4">
      <Card size="small">
        <Space wrap>
          <Typography.Text strong>แสดงงาน:</Typography.Text>
          <Checkbox.Group
            value={SOURCES.map((s) => s.key).filter((k) => !hidden.includes(k))}
            onChange={(vals) => setHidden(SOURCES.map((s) => s.key).filter((k) => !vals.includes(k)))}
            options={SOURCES.map((s) => ({
              value: s.key,
              label: <Badge color={s.color} text={s.label} />,
            }))}
          />
        </Space>
      </Card>

      <Card size="small">
        <Calendar
          fullscreen={!!screens.md}
          value={selected}
          onSelect={(d) => setSelected(d)}
          cellRender={cellRender}
        />
      </Card>

      <Card size="small" title={`รายการวันที่ ${selected.format('D/M/YYYY')}`}>
        {dayEvents.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ไม่มีรายการในวันนี้" />
        ) : (
          <List
            dataSource={dayEvents}
            renderItem={(e) => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => onNavigate?.(e.source.page)}
                extra={<Tag color={e.source.color}>{e.source.label}</Tag>}
              >
                <List.Item.Meta title={e.title} description={e.desc} />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
