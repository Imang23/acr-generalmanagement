import { Tabs } from 'antd';
import CrudPage from '../../CrudPage';
import { useAccess } from '../../AccessContext.jsx';

const vehicleStatus = [['available', 'ว่าง'], ['in_use', 'ใช้งานอยู่'], ['repair', 'ซ่อมบำรุง']];

const vehicles = [
  { key: 'plate', label: 'ทะเบียน', required: true },
  { key: 'name', label: 'รุ่น/ชื่อรถ' },
  { key: 'driver', label: 'คนขับ', type: 'employee' },
  { key: 'status', label: 'สถานะ', options: vehicleStatus },
  { key: 'mileage', label: 'เลขไมล์', type: 'number' },
  { key: 'next_service', label: 'ครบกำหนดเช็กระยะ', type: 'date' },
  { key: 'check_date', label: 'วันที่ตรวจสภาพล่าสุด', type: 'date', today: true },
  { key: 'check_tires', label: 'ตรวจยาง/ลมยาง', type: 'switch' },
  { key: 'check_lights', label: 'ตรวจไฟส่องสว่าง/ไฟเลี้ยว', type: 'switch' },
  { key: 'check_brakes', label: 'ตรวจเบรก', type: 'switch' },
  { key: 'check_fluids', label: 'ตรวจน้ำมันเครื่อง/น้ำหล่อเย็น', type: 'switch' },
  { key: 'check_equipment', label: 'ตรวจอุปกรณ์ประจำรถ', type: 'switch' },
  { key: 'ready_status', label: 'ผลตรวจความพร้อม', options: [['ready', 'พร้อมใช้งาน'], ['needs_attention', 'ต้องแก้ไขก่อนใช้งาน']] },
  { key: 'check_note', label: 'รายละเอียด/สิ่งที่ต้องแก้ไข', type: 'textarea' },
];

const workers = [
  { key: 'name', label: 'ชื่อพนักงาน', type: 'employee', required: true },
  { key: 'role', label: 'หน้าที่' },
  { key: 'phone', label: 'เบอร์โทร' },
  { key: 'active', label: 'ทำงานอยู่', type: 'switch' },
  { key: 'license_no', label: 'เลขที่ใบขับขี่' },
  { key: 'license_expiry', label: 'ใบขับขี่หมดอายุ', type: 'date' },
  { key: 'emergency_contact', label: 'ผู้ติดต่อฉุกเฉิน' },
];

// งานบริการทั่วไป: ยานพาหนะ + บุคลากรฝ่ายบริการ
export default function Vehicles({ tick }) {
  const { can } = useAccess();
  const items = [
    { key: 'workers', label: 'พนักงานขับ', children: <CrudPage resource="workers" title="พนักงานขับ" fields={workers} tick={tick} /> },
    { key: 'vehicles', label: 'รถยนต์', children: <CrudPage resource="vehicles" title="รถยนต์" fields={vehicles} tick={tick} /> },
  ].filter((item) => can(item.key, 'read'));

  return <Tabs items={items} />;
}
