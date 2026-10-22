import { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Badge } from 'antd';

import {
  BankOutlined,
  CalendarOutlined,
  BarsOutlined,
  DashboardOutlined,
  MedicineBoxOutlined,
  ShopOutlined,
  DiffOutlined,
  TeamOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { getToken, setToken } from './api.js';
import AppLayout from './Layout.jsx';
import Login from './Login.jsx';
import UserMenu from './UserMenu.jsx';
import { AccessProvider, useAccess } from './AccessContext.jsx';
import UserManagement from './pages/Admin/UserManagement.jsx';
import DeleteRequests from './pages/Admin/DeleteRequests.jsx';
import AdminSubmissions from './pages/Admin/AdminSubmissions.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import GeneralManagement from './pages/GeneralManagement.jsx';
import Facilities from './pages/Facilities.jsx';
import Nutrition from './pages/Nutrition.jsx';
import Store from './pages/Facilities/Store.jsx';
import Buildings from './pages/Facilities/Building.jsx';
import Vehicles from './pages/Facilities/Vehicle.jsx';
import HousekeepingPage from './pages/Facilities/Housekeeping.jsx';
import GradenerPage from './pages/Facilities/Gardener.jsx';
import Healthcheckup from './pages/HealthNursing/Healthcheckup.jsx';
import Infirmary from './pages/HealthNursing/Infirmary.jsx';
import Administration from './pages/Facilities/Administative.jsx';

// ========================================
// หน้าที่เปิดได้
// key ต้องตรงกับ key ของเมนู
// ========================================
const pages = {
  dashboard: {
    label: 'ภาพรวม',
    Component: Dashboard,
  },

  calendar: {
    label: 'ปฏิทินงาน',
    Component: CalendarPage,
  },

  // งานอาคารสถานที่
  'facilities-Store': {
    label: 'สโตร์',
    Component: Store,
  },

  'facilities-repair': {
    label: 'ซ่อมบำรุง',
    Component: Facilities,
  },

  'facilities-building': {
    label: 'อาคาร',
    Component: Buildings,
  },

  'facilities-garden': {
    label: 'งานสวน',
    Component: GradenerPage,
  },

  'facilities-housekeeping': {
    label: 'แม่บ้าน',
    Component: HousekeepingPage,
  },

  'facilities-vehicle': {
    label: 'พนักงานยานพาหนะ',
    Component: Vehicles,
  },

  // บริการทั่วไป
  'general-Management': {
    label: 'ภาพรวมบริการทั่วไป',
    Component: GeneralManagement,
  },
   // ธุระการ
  'Administration':{
    label: 'ธุระการ',
    Component: Administration
  },


  // ผู้ดูแลระบบ / ผู้ตรวจ
  'admin-submissions': {
    label: 'ตรวจเอกสาร/อนุมัติ',
    Component: AdminSubmissions,
  },

  'admin-users': {
    label: 'จัดการผู้ใช้',
    Component: UserManagement,
  },

  'delete-requests': {
    label: 'คำขอลบข้อมูล',
    Component: DeleteRequests,
  },

  // สุขอนามัยและพยาบาล
   'health-Infirmary': {
    label: 'ห้องพยาบาล',
    Component: Infirmary,
  },

  'health-check': {
    label: 'ตรวจสุขภาพ',
    Component: Healthcheckup,
  },

  // โภชนาการ
  nutrition: {
    label: 'โภชนาการ',
    Component: Nutrition,
  },
};

// ========================================
// โครงสร้างเมนูหลักและเมนูย่อย
// ========================================
const menuItems = [
  {
    key: 'dashboard',
    icon: <DashboardOutlined />,
    label: 'ภาพรวม',
  },

  {
    key: 'calendar',
    icon: <CalendarOutlined />,
    label: 'ปฏิทินงาน',
  },

  {
    key: 'facilities',
    icon: <BankOutlined />,
    label: 'งานอาคารสถานที่',
    children: [
      {
        key: 'facilities-Store',
        label: 'สโตร์',
      },
      {
        key: 'facilities-repair',
        label: 'ซ่อมบำรุง',
      },
      {
        key: 'facilities-building',
        label: 'อาคาร',
      },
      {
        key: 'facilities-garden',
        label: 'งานสวน',
      },
      {
        key: 'facilities-housekeeping',
        label: 'แม่บ้าน',
      },
      {
        key: 'facilities-vehicle',
        label: 'พนักงานยานพาหนะ',
      },
    ],
  },

  {
    key: 'general-Management',
    icon: <BarsOutlined />,
    label: 'บริหารทั่วไป',
  },
  {
    key: 'Administration',
    icon: <DiffOutlined />,
    label: 'ธุระการ'
  },

  {
    key: 'health',
    icon: <MedicineBoxOutlined />,
    label: 'งานสุขอนามัยและพยาบาล',
    children: [
      {
        key: 'health-Infirmary',
        label: 'ห้องพยาบาล',
      },
      {
        key: 'health-check',
        label: 'ตรวจสุขภาพ',
      },
    ],
  },

  {
    key: 'nutrition',
    icon: <ShopOutlined />,
    label: 'งานโภชนาการ',
  },

  {
    key: 'delete-requests',
    icon: <DeleteOutlined />,
    label: 'คำขอลบข้อมูล',
  },

  {
    key: 'admin-submissions',
    icon: <DiffOutlined />,
    label: 'ตรวจเอกสาร/อนุมัติ',
  },

  {
    key: 'admin-users',
    icon: <TeamOutlined />,
    label: 'จัดการผู้ใช้',
  },
];

// ซ่อนเมนูที่ไม่มีสิทธิ์ (ฝั่งเซิร์ฟเวอร์บังคับสิทธิ์จริงอีกชั้น)
function visibleItems(items, access, canPage) {
  const out = [];
  for (const item of items) {
    if (item.key === 'admin-submissions') {
      if (access?.is_admin || access?.role === 'admin') out.push(item);
      continue;
    }
    if (item.key === 'admin-users') {
      if (access?.is_admin) out.push(item);
      continue;
    }
    if (item.key === 'delete-requests') {
      if (access && access.role !== 'staff') out.push(item);
      continue;
    }
    if (item.children) {
      const children = visibleItems(item.children, access, canPage);
      if (children.length) out.push({ ...item, children });
      continue;
    }
    if (canPage(item.key)) out.push(item);
  }
  return out;
}

// ใส่ป้ายตัวเลขคำขอที่รอพิจารณาบนเมนู
function withBadges(items, access) {
  const n = access
    ? (access.pending.delete_requests || 0) || (access.pending.my_delete_requests || 0)
    : 0;
  return items.map((item) => (item.key === 'delete-requests'
    ? { ...item, label: <Badge count={n} size="small" offset={[10, 0]}>{item.label}</Badge> }
    : item));
}

// ========================================
// ค้นหาเส้นทางเมนูเพื่อสร้าง Breadcrumb
// ========================================
function findPath(items, targetKey, parents = []) {
  for (const item of items) {
    const currentPath = [
      ...parents,
      {
        key: item.key,
        label: item.label,
      },
    ];

    if (item.key === targetKey) {
      return currentPath;
    }

    if (item.children?.length) {
      const result = findPath(
        item.children,
        targetKey,
        currentPath
      );

      if (result) {
        return result;
      }
    }
  }

  return null;
}

// ========================================
// หน้าหลักหลัง Login
// ========================================
function Main() {
  const { notification } = AntApp.useApp();
  const { access, canPage, reload: reloadAccess } = useAccess();

  const [page, setPage] = useState('dashboard');
  const [tick, setTick] = useState(0);

  const accessRef = useRef(access);
  accessRef.current = access;

  // เมนูที่ผู้ใช้นี้เห็น
  const shownItems = useMemo(
    () => withBadges(visibleItems(menuItems, access, canPage), access),
    [access, canPage],
  );

  // ตัวเลขรอตรวจอัปเดตเมื่อมีเหตุการณ์ใหม่
  useEffect(() => {
    if (tick > 0) reloadAccess();
  }, [tick, reloadAccess]);

  // รับการแจ้งเตือนจาก Backend แบบ Real-time
  useEffect(() => {
    const token = getToken();

    if (!token) return undefined;

    const es = new EventSource(
      `/api/events?token=${encodeURIComponent(token)}`
    );

    es.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);

        // แจ้งให้หน้าที่เกี่ยวข้องโหลดข้อมูลใหม่
        setTick((current) => current + 1);

        // Refresh ข้อมูลโดยไม่แสดง Notification
        if (type === 'refresh') return;

        const notes = {
          repair: [
            'มีแจ้งซ่อมใหม่',
            `${data.reporter || '-'}: ${data.title || '-'}`,
          ],

          repair_done: [
            'พนักงานส่งงานแล้ว',
            `#${data.id} ${data.title || '-'}`,
          ],

          repair_status: [
            'เปลี่ยนสถานะงานซ่อม',
            `#${data.id} ${data.title || '-'}`,
          ],

          nurse: [
            'ห้องพยาบาลอัปเดต',
            `${data.student || '-'} (${data.class_room || '-'})`,
          ],

          health_check: [
            'บันทึกตรวจสุขภาพ',
            `${data.student || '-'} (${data.class_room || '-'})`,
          ],

          canteen: [
            'โรงอาหารอัปเดต',
            `จาก ${data.reporter || '-'}`,
          ],
        };

        // คำขอลบ: แจ้งเฉพาะผู้ตรวจ (คำขอใหม่) และผู้ขอ (ผลพิจารณา)
        if (type === 'delete_request') {
          const me = accessRef.current;
          if (!me) return;
          if (data.status === 'pending') {
            if (!(me.is_admin || (me.role === 'inspector' && me.permissions.includes(data.module)))) return;
            notes.delete_request = ['มีคำขอลบรอพิจารณา', `${data.record_label || '-'} โดย ${data.requested_by}`];
          } else {
            if (data.requested_by !== me.username) return;
            notes.delete_request = [
              data.status === 'approved' ? 'คำขอลบได้รับอนุมัติ' : 'คำขอลบไม่ได้รับอนุมัติ',
              data.record_label || '-',
            ];
          }
        }

        const [message, description] = notes[type] || [
          'มีข้อมูลอัปเดต',
          '',
        ];

        notification.info({
          message,
          description,
          placement: 'topRight',
          duration: 6,
        });
      } catch (error) {
        console.error(
          'อ่านข้อมูลแจ้งเตือนไม่สำเร็จ:',
          error
        );
      }
    };

    es.onerror = (error) => {
      console.error(
        'การเชื่อมต่อระบบแจ้งเตือนขัดข้อง:',
        error
      );
    };

    return () => {
      es.close();
    };
  }, [notification]);

  // ตรวจสอบหน้าที่เลือก (หน้าที่ไม่มีสิทธิ์ถอยกลับไปภาพรวม)
  const allowed = (page === 'admin-submissions' ? (access?.is_admin || access?.role === 'admin')
    : page === 'admin-users' ? access?.is_admin
    : page === 'delete-requests' ? access && access.role !== 'staff'
      : canPage(page));
  const currentPage = (allowed && pages[page]) || pages.dashboard;
  const { Component, label } = currentPage;

  // สร้าง Breadcrumb จากเมนู
  const trail = findPath(menuItems, page) || [];

  const breadcrumb = [
    { title: 'หน้าหลัก' },
    ...trail.map((item) => ({
      title: item.label,
    })),
  ];

  // ออกจากระบบ
  const handleLogout = () => {
    setToken(null);
    window.location.reload();
  };

  return (
    <AppLayout
      items={shownItems}
      selectedKey={page}
      onSelect={setPage}
      pageTitle={label}
      breadcrumb={breadcrumb}
      headerExtra={<UserMenu />}
      onLogout={handleLogout}
    >
      <Component
        key={page}
        view={page}
        tick={tick}
        onNavigate={setPage}
      />
    </AppLayout>
  );
}

// ========================================
// App Entry
// ========================================
export default function App() {
  return getToken()
    ? <AccessProvider><Main /></AccessProvider>
    : <Login />;
}
