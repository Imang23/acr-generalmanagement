import { Tabs } from 'antd';
import CrudPage from '../../CrudPage';

const checks = [
  { key: 'date', label: 'วันที่ตรวจ', type: 'date', required: true, today: true },
  { key: 'student', label: 'ชื่อนักเรียน', required: true },
  { key: 'class_room', label: 'ชั้น/ห้อง' },
  { key: 'weight', label: 'น้ำหนัก (กก.)', type: 'number' },
  { key: 'height', label: 'ส่วนสูง (ซม.)', type: 'number' },
  { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

// งานอนามัยและการพยาบาล: บันทึกห้องพยาบาล + ตรวจสุขภาพ
export default function Healthcheckup({ tick }) {
  return (
    <Tabs
      items={[
       { key: 'health_checks', label: 'ตรวจสุขภาพ', children: <CrudPage resource="health_checks" title="ตรวจสุขภาพ" fields={checks} tick={tick} /> },
      ]}
    />
  );
}
