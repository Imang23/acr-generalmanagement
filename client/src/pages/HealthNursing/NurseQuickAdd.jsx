import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Input, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api.js';

const STATUS = [['treated', 'รักษาเบื้องต้น'], ['rest', 'พักห้องพยาบาล'], ['referred', 'ส่งต่อโรงพยาบาล'], ['home', 'กลับบ้าน']];
const CUSTOM = '__custom__';

// บันทึกผู้ใช้ห้องพยาบาลแบบเร็ว: เลือกชื่อจากรายชื่อนักเรียน (ผลตรวจสุขภาพ) หรือพิมพ์ชื่อเองได้
export default function NurseQuickAdd({ reload }) {
  const { message } = AntApp.useApp();
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [picked, setPicked] = useState(null); // { student, class_room }
  const [classRoom, setClassRoom] = useState('');
  const [symptom, setSymptom] = useState('');
  const [treatment, setTreatment] = useState('');
  const [status, setStatus] = useState('treated');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api(`/health_checks/students?q=${encodeURIComponent(search.trim())}`)
        .then((d) => setList(Array.isArray(d) ? d : []))
        .catch(() => setList([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const key = (s) => `${s.student}|${s.class_room || ''}`;
  const options = list.map((s) => ({
    value: key(s),
    label: `${s.student}${s.class_room ? ` (${s.class_room})` : ''}${s.code ? ` · ${s.code}` : ''}`,
    s,
  }));
  const typed = search.trim();
  if (typed && !list.some((s) => s.student === typed)) {
    options.push({ value: `${CUSTOM}${typed}`, label: `ใช้ชื่อ “${typed}” (ไม่อยู่ในรายชื่อ)`, s: { student: typed, class_room: '' } });
  }

  const onPick = (_, opt) => {
    setPicked(opt.s);
    setClassRoom(opt.s.class_room || '');
  };

  const submit = async () => {
    if (!picked) return message.warning('กรุณาเลือกนักเรียน');
    if (!symptom.trim()) return message.warning('กรุณากรอกอาการ');
    setSaving(true);
    try {
      await api('/nurse_visits', 'POST', {
        date: dayjs().format('YYYY-MM-DD'),
        student: picked.student,
        class_room: classRoom.trim(),
        symptom: symptom.trim(),
        treatment: treatment.trim(),
        status,
      });
      message.success(`บันทึก ${picked.student} แล้ว`);
      setPicked(null); setClassRoom(''); setSymptom(''); setTreatment(''); setSearch('');
      reload?.();
    } catch (e) {
      message.error(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" title="บันทึกผู้ใช้ห้องพยาบาลวันนี้" style={{ marginBottom: 16 }}>
      <Space wrap align="start">
        <Select
          showSearch
          allowClear
          style={{ width: 320 }}
          placeholder="พิมพ์ชื่อ / รหัส / ห้อง เพื่อค้นหานักเรียน"
          filterOption={false}
          value={picked ? key(picked) : undefined}
          options={options}
          onSearch={setSearch}
          onSelect={onPick}
          onClear={() => { setPicked(null); setClassRoom(''); }}
          notFoundContent="ไม่พบรายชื่อ"
        />
        <Input style={{ width: 100 }} placeholder="ชั้น/ห้อง" value={classRoom} onChange={(e) => setClassRoom(e.target.value)} />
        <Input style={{ width: 220 }} placeholder="อาการ *" value={symptom} onChange={(e) => setSymptom(e.target.value)} onPressEnter={submit} />
        <Input style={{ width: 220 }} placeholder="การรักษา/ยาที่ให้" value={treatment} onChange={(e) => setTreatment(e.target.value)} onPressEnter={submit} />
        <Select style={{ width: 150 }} value={status} onChange={setStatus} options={STATUS.map(([value, label]) => ({ value, label }))} />
        <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={submit}>บันทึก</Button>
      </Space>
    </Card>
  );
}
