import dayjs from 'dayjs';
import CrudPage from '../CrudPage.jsx';

const canteen = [
  { key: 'date', label: 'วันที่', type: 'date', required: true, today: true },
  { key: 'revenue', label: 'รายรับ (บาท)', type: 'number', required: true },
  { key: 'cost', label: 'รายจ่าย (บาท)', type: 'number', required: true },
  { key: 'profit', label: 'กำไร', type: 'profit', hideInForm: true },
  { key: 'shop', label: 'ร้านค้า' },
  { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
  { key: 'verified', label: 'การตรวจสอบ', type: 'verify', hideInForm: true },
];

const profitOf = (list) => list.reduce((s, r) => s + (Number(r.revenue) - Number(r.cost)), 0);

// บันทึกได้หลายรายการต่อวัน: แสดงยอดรวมของวันนี้ก่อน แล้วตามด้วยยอดรวมทั้งหมดที่แสดง
const summary = (rows) => {
  const today = rows.filter((r) => r.date === dayjs().format('YYYY-MM-DD'));
  return `วันนี้ ${today.length} รายการ กำไร ${profitOf(today).toLocaleString()} บาท · กำไรรวมที่แสดง ${profitOf(rows).toLocaleString()} บาท`;
};

// งานโภชนาการ: บัญชีรายรับ-รายจ่ายโรงอาหาร
export default function Nutrition({ tick }) {
  return <CrudPage resource="canteen" title="โรงอาหาร" fields={canteen} summary={summary} tick={tick} />;
}
