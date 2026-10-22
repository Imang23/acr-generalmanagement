import DailyTaskBoard from './DailyTaskBoard.jsx';

// ตารางงานแม่บ้าน: งานประจำ + ตรวจรายวัน + KPI (ลอจิกทั้งหมดอยู่ใน DailyTaskBoard.jsx)
const CONFIG = {
  key: 'housekeeping',
  path: '/housekeeping_tasks',
  title: 'จัดการงานแม่บ้าน',
  subtitle: 'Housekeeping Schedule, Inspection & KPI',
  workerLabel: 'แม่บ้าน',
};

export default function HousekeepingPage({ tick }) {
  return <DailyTaskBoard config={CONFIG} tick={tick} />;
}
