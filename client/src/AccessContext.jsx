import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

// ตารางข้อมูล (resource ใน API) -> เมนูสิทธิ์ (ต้องตรงกับ MODULES ใน server/access.js)
export const RESOURCE_MODULE = {
  repairs: 'repairs',
  canteen: 'canteen',
  vehicles: 'vehicles',
  workers: 'workers',
  nurse_visits: 'nurse',
  health_checks: 'nurse',
  buildings: 'buildings',
  store_items: 'store',
  committees: 'general',
  employees: 'general',
  housekeeping_tasks: 'housekeeping',
  gardening_tasks: 'gardening',
};

// key ของเมนูหน้าเว็บ -> เมนูสิทธิ์ (หลายค่า = เข้าได้ถ้ามีอย่างน้อยหนึ่งอย่าง)
export const PAGE_MODULE = {
  'facilities-Store': ['store'],
  'facilities-repair': ['repairs'],
  'facilities-building': ['buildings'],
  'facilities-garden': ['gardening'],
  'facilities-housekeeping': ['housekeeping'],
  'facilities-vehicle': ['vehicles', 'workers'],
  'general-Management': ['general'],
  // หน้าธุรการ: ใช้สิทธิ์เมนู "ธุรการ" (administration)
  // คง 'general' ไว้ชั่วคราวเพื่อไม่ให้คนที่เคยเข้าได้ถูกตัดสิทธิ์ทันที
  // เมื่อ admin ติ๊กเมนู "ธุรการ" ให้ผู้ใช้ครบแล้ว ให้เปลี่ยนเป็น ['administration'] อย่างเดียว
  Administration: ['administration', 'general'],
  'health-Infirmary': ['nurse'],
  'health-check': ['nurse'],
  nutrition: ['canteen'],
};

export const ROLE_LABEL = {
  admin: 'ผู้ดูแลระบบ',
  inspector: 'ผู้ตรวจงาน',
  technician: 'ช่าง',
  staff: 'ทั่วไป',
};

export const ROLE_COLOR = {
  admin: 'red',
  inspector: 'blue',
  technician: 'orange',
  staff: 'default',
};

const AccessContext = createContext({
  access: null,
  loading: true,
  can: () => false,
  canPage: () => true,
  reload: () => {},
});

export function AccessProvider({ children }) {
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setAccess(await api('/access/me'));
    } catch {
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo(() => {
    // action: read | write | delete | approve (ฝั่งเซิร์ฟเวอร์บังคับจริงอีกชั้น)
    const can = (module, action = 'read') => {
      if (!access) return false;
      if (access.is_admin) return true;
      if (!access.permissions.includes(module)) return false;
      if (access.role === 'inspector') return true;
      if (access.role === 'technician') return action === 'read' || action === 'write';
      return action === 'read';
    };
    const canPage = (key) => {
      const mods = PAGE_MODULE[key];
      return !mods || mods.some((m) => can(m, 'read'));
    };
    return { access, loading, can, canPage, reload };
  }, [access, loading, reload]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export const useAccess = () => useContext(AccessContext);
