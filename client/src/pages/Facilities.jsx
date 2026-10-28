import CrudPage from '../CrudPage.jsx';

const repairStatus = [
  ['new', 'ใหม่'],
  ['doing', 'กำลังซ่อม'],
  ['done', 'เสร็จแล้ว'],
];

// หมายเหตุ: คอลัมน์ "ผลอนุมัติ" (approval_status) และเหตุผลที่ส่งกลับแก้ไข
// CrudPage เพิ่มให้เองในตารางงานซ่อม จึงไม่ต้องประกาศซ้ำที่นี่
const repairs = [
  {
    key: 'title',
    label: 'เรื่องที่แจ้ง',
    required: true,
  },
  {
    key: 'location',
    label: 'สถานที่',
  },
  {
    key: 'status',
    label: 'สถานะงาน',
    options: repairStatus,
  },
  {
    key: 'reporter',
    label: 'ผู้แจ้ง',
    type: 'committee',
  },
  {
    key: 'assignee',
    label: 'ผู้รับผิดชอบ',
    type: 'technician',
  },
  {
    key: 'inspector_username',
    label: 'ผู้ตรวจงาน',
    type: 'inspector',
  },
  {
    key: 'due_date',
    label: 'กำหนดส่งมอบ',
    type: 'datetime',
    dueDate: true,
  },
  {
    key: 'detail',
    label: 'รายละเอียดเพิ่มเติม',
    type: 'textarea',
    hideInTable: true,
  },
  {
    key: 'created_at',
    label: 'วันที่แจ้ง',
    type: 'datetime',
    hideInForm: true,
  },
  {
    key: 'done_at',
    label: 'วันที่ส่งงาน',
    type: 'datetime',
    hideInForm: true,
  },
  {
    key: 'done_photos',
    label: 'รูปงานที่ส่ง',
    type: 'images',
    hideInForm: true,
  },
];

export default function Facilities({ tick }) {
  return (
    <CrudPage
      resource="repairs"
      title="งานซ่อม"
      fields={repairs}
      tick={tick}
    />
  );
}
