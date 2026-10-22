import DailyTaskBoard from './DailyTaskBoard.jsx';

// ตารางงานสวน: งานประจำ + ตรวจรายวัน + KPI (ลอจิกทั้งหมดอยู่ใน DailyTaskBoard.jsx)
const CONFIG = {
  key: 'gardening',
  path: '/gardening_tasks',
  title: 'จัดการงานสวน',
  subtitle: 'Gardening Schedule, Inspection & KPI',
  workerLabel: 'พนักงานสวน',
};

export default function GardenerPage({ tick }) {
  return <DailyTaskBoard config={CONFIG} tick={tick} />;
}
