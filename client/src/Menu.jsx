import { useEffect, useMemo, useState } from 'react';
import { Menu } from 'antd';

// หาเส้นทางจากรากไปยังเมนูที่เลือก (ใช้ทำ breadcrumb และเปิดกลุ่มแม่อัตโนมัติ)
export function findPath(items, key, trail = []) {
  for (const it of items) {
    const next = [...trail, it];
    if (it.key === key) return next;
    if (it.children) {
      const r = findPath(it.children, key, next);
      if (r) return r;
    }
  }
  return null;
}

/**
 * SideMenu — เมนูด้านข้าง รองรับเมนูย่อย (children) ใช้ร่วมกันทั้ง Sider และ Drawer
 * props: items (antd Menu items), selectedKey, onSelect(key), collapsed
 */
export default function SideMenu({ items, selectedKey, onSelect, collapsed = false }) {
  const parentKeys = useMemo(
    () => (findPath(items, selectedKey) || []).slice(0, -1).map((i) => i.key),
    [items, selectedKey],
  );
  const [openKeys, setOpenKeys] = useState(parentKeys);

  // เปลี่ยนหน้าจากที่อื่น (เช่น onNavigate จาก Dashboard) ให้กลุ่มแม่เปิดตาม
  useEffect(() => {
    setOpenKeys((prev) => Array.from(new Set([...prev, ...parentKeys])));
  }, [parentKeys]);

  return (
    <Menu
      mode="inline"
      inlineCollapsed={collapsed}
      selectedKeys={[selectedKey]}
      openKeys={collapsed ? [] : openKeys}
      onOpenChange={setOpenKeys}
      items={items}
      style={{ border: 0, padding: 8, background: 'transparent' }}
      onClick={({ key }) => onSelect(key)}
    />
  );
}
