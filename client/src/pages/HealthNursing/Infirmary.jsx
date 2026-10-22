import { Tabs } from 'antd';
import CrudPage from '../../CrudPage';

const visitStatus = [['treated', 'รักษาเบื้องต้น'], ['rest', 'พักห้องพยาบาล'], ['referred', 'ส่งต่อโรงพยาบาล'], ['home', 'กลับบ้าน']];

const visits = [
  { key: 'date', label: 'วันที่', type: 'date', required: true, today: true },
  { key: 'student', label: 'ชื่อนักเรียน', required: true },
  { key: 'class_room', label: 'ชั้น/ห้อง' },
  { key: 'symptom', label: 'อาการ', required: true },
  { key: 'treatment', label: 'การรักษา/ยาที่ให้', type: 'textarea' },
  { key: 'status', label: 'ผลการดูแล', options: visitStatus },
];
// งานอนามัยและการพยาบาล: บันทึกห้องพยาบาล + ตรวจสุขภาพ
export default function Infirmary({ tick }) {
  return (
    <Tabs
      items={[
        { key: 'nurse_visits', label: 'ห้องพยาบาล', children: <CrudPage resource="nurse_visits" title="บันทึกห้องพยาบาล" fields={visits} tick={tick} /> },
      ]}
    />
  );
}
