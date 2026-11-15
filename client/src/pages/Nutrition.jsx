import { useState } from 'react';
import { Alert, Segmented } from 'antd';
import dayjs from 'dayjs';
import CrudPage from '../CrudPage.jsx';
import { useAccess } from '../AccessContext.jsx';

const canteen = [
  { key: 'date', label: 'วันที่', type: 'date', required: true, today: true },
  { key: 'revenue', label: 'รายรับ (บาท)', type: 'number', required: true },
  { key: 'cost', label: 'รายจ่าย (บาท)', type: 'number', required: true },
  { key: 'profit', label: 'กำไร', type: 'profit', hideInForm: true },
  { key: 'shop', label: 'ร้านค้า' },
  { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
  { key: 'verified', label: 'การตรวจสอบ', type: 'verify', hideInForm: true },
];

const coffee = [
  { key: 'date', label: 'วันที่', type: 'date', required: true, today: true },
  { key: 'kind', label: 'ประเภท', required: true, width: 100,
    options: [['ขายเอง', 'ขายเอง'], ['ฝากขาย', 'สินค้าฝากขาย']] },
  { key: 'item', label: 'สินค้า/เมนู', required: true, width: 160 },
  { key: 'owner', label: 'เจ้าของสินค้าฝาก' },
  { key: 'revenue', label: 'ยอดขาย (บาท)', type: 'number', required: true },
  { key: 'cost', label: 'ต้นทุน/จ่ายเจ้าของ (บาท)', type: 'number', required: true },
  { key: 'profit', label: 'กำไร', type: 'profit', hideInForm: true },
  { key: 'note', label: 'หมายเหตุ', type: 'textarea' },
  { key: 'verified', label: 'การตรวจสอบ', type: 'verify', hideInForm: true },
];

const profitOf = (list) => list.reduce((s, r) => s + (Number(r.revenue) - Number(r.cost)), 0);
const todayOf = (rows) => rows.filter((r) => r.date === dayjs().format('YYYY-MM-DD'));

const canteenSummary = (rows) => {
  const t = todayOf(rows);
  return `วันนี้ ${t.length} รายการ กำไร ${profitOf(t).toLocaleString()} บาท · กำไรรวมที่แสดง ${profitOf(rows).toLocaleString()} บาท`;
};

const coffeeSummary = (rows) => {
  const t = todayOf(rows);
  const own = rows.filter((r) => r.kind === 'ขายเอง');
  const consign = rows.filter((r) => r.kind === 'ฝากขาย');
  return `วันนี้ ${t.length} รายการ กำไร ${profitOf(t).toLocaleString()} บาท · ขายเอง ${profitOf(own).toLocaleString()} · ฝากขาย ${profitOf(consign).toLocaleString()} · รวม ${profitOf(rows).toLocaleString()} บาท`;
};

// งานโภชนาการ: แสดงแท็บเฉพาะร้านที่ผู้ใช้มีสิทธิ์อ่าน
export default function Nutrition({ tick }) {
  const { can } = useAccess();
  const [picked, setPicked] = useState('canteen');

  const tabs = [
    can('canteen', 'read') && { value: 'canteen', label: 'โรงอาหาร' },
    can('coffee', 'read') && { value: 'coffee', label: 'ร้านกาแฟ' },
  ].filter(Boolean);

  if (!tabs.length) {
    return <Alert type="warning" showIcon message="คุณไม่มีสิทธิ์เข้าถึงงานโภชนาการ" />;
  }

  // ถ้าแท็บที่เลือกไว้ไม่มีสิทธิ์ ให้ใช้แท็บแรกที่เข้าได้
  const tab = tabs.some((t) => t.value === picked) ? picked : tabs[0].value;

  return (
    <div className="grid gap-3">
      {tabs.length > 1 && <Segmented value={tab} onChange={setPicked} options={tabs} />}
      {tab === 'canteen' ? (
        <CrudPage key="canteen" resource="canteen" title="โรงอาหาร" fields={canteen} summary={canteenSummary} tick={tick} />
      ) : (
        <CrudPage key="coffee" resource="coffee" title="ร้านกาแฟ" fields={coffee} summary={coffeeSummary} tick={tick} />
      )}
    </div>
  );
}
