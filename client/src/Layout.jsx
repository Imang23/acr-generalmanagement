import { useState } from 'react';
import { Avatar, Breadcrumb, Button, Drawer, Grid, Layout, Tooltip, Typography } from 'antd';
import { LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined } from '@ant-design/icons';
import SideMenu from './Menu.jsx';

const { Sider, Header, Content, Footer } = Layout;

// วางไฟล์โลโก้ไว้ที่ public/logo.png (ถ้าโหลดไม่ได้จะแสดงตัวอักษร ACR แทน)
export const LOGO_SRC = '/ACR-LOGO_.png';

export const BLUE = {
  primary: '#1a4fb8',
  navy: '#0b2a8a',
  soft: '#e8f0fe',
  bg: '#f2f6fc',
  border: '#dbe6f7',
};

function Brand({ collapsed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: collapsed ? '16px 0' : '16px 20px', justifyContent: collapsed ? 'center' : 'flex-start', borderBottom: `1px solid ${BLUE.border}` }}>
      <Avatar src={LOGO_SRC} size={collapsed ? 48 : 48} style={{ background: '#fff', color: BLUE.navy, border: `1px solid ${BLUE.border}`, flex: 'none' }}>
        ACR
      </Avatar>
      {!collapsed && (
        <div style={{ lineHeight: 1.2, minWidth: 0 }}>
          <div style={{ color: BLUE.navy, fontWeight: 600, fontSize: 20 }}>ฝ่ายบริหารทั่วไป</div>
          <div style={{ color: '#6b7a99', fontSize: 11 }}>Assumption College Rayong</div>
        </div>
      )}
    </div>
  );
}

function LogoutButton({ collapsed, onLogout }) {
  const button = (
    <Button
      type="text"
      danger
      block
      icon={<LogoutOutlined />}
      onClick={onLogout}
      aria-label="ออกจากระบบ"
      style={{ height: 40, justifyContent: collapsed ? 'center' : 'flex-start' }}
    >
      {!collapsed && 'ออกจากระบบ'}
    </Button>
  );
  return (
    <div style={{ padding: 12, borderTop: `1px solid ${BLUE.border}` }}>
      {collapsed ? <Tooltip title="ออกจากระบบ" placement="right">{button}</Tooltip> : button}
    </div>
  );
}

/**
 * AppLayout — โครงหน้าหลัก (Sider + Header + Content + Footer) ธีมฟ้า-ขาว
 * props: items (antd Menu items), selectedKey, onSelect(key), onLogout, pageTitle, breadcrumb, headerExtra, children
 * headerExtra: ส่วนด้านขวาของ Header (เช่น ข้อมูลผู้ใช้)
 */
export default function AppLayout({ items, selectedKey, onSelect, onLogout, pageTitle, breadcrumb, headerExtra, children }) {
  const isMobile = !Grid.useBreakpoint().lg;
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  return (
    <Layout style={{ minHeight: '100vh', background: BLUE.bg }}>
      {!isMobile && (
        <Sider
          theme="light"
          width={240}
          collapsible
          trigger={null}
          collapsed={collapsed}
          style={{ position: 'sticky', top: 0, height: '100vh', background: '#fff', borderRight: `1px solid ${BLUE.border}` }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Brand collapsed={collapsed} />
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <SideMenu items={items} selectedKey={selectedKey} onSelect={onSelect} collapsed={collapsed} />
            </div>
            <LogoutButton collapsed={collapsed} onLogout={onLogout} />
          </div>
        </Sider>
      )}

      <Layout style={{ background: BLUE.bg }}>
        <Header
          style={{
            position: 'sticky', top: 0, zIndex: 10, height: 60, lineHeight: '60px', padding: '0 16px',
            display: 'flex', alignItems: 'center', gap: 12, background: '#fff',
            borderBottom: `1px solid ${BLUE.border}`, boxShadow: '0 2px 8px rgba(26,79,184,.06)',
          }}
        >
          {isMobile ? (
            <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} aria-label="เมนู" />
          ) : (
            <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} aria-label="ย่อ/ขยายเมนู" />
          )}
          <Typography.Text strong style={{ flex: 1, color: BLUE.navy, fontSize: 16 }} ellipsis>
            {isMobile ? pageTitle : 'ระบบจัดการงานโรงเรียน โรงเรียนอัสสัมชัญระยอง'}
          </Typography.Text>
          {headerExtra}
        </Header>

        <Content style={{ padding: isMobile ? 12 : 24 }}>
          <div style={{ maxWidth: 1152, margin: '0 auto' }}>
            <Breadcrumb style={{ marginBottom: 16 }} items={breadcrumb || [{ title: 'หน้าหลัก' }, { title: pageTitle }]} />
            {children}
          </div>
        </Content>

        <Footer style={{ textAlign: 'center', background: 'transparent', color: '#6b7a99', fontSize: 12 }}>
          © {new Date().getFullYear()} Assumption College Rayong · Managrmant
        </Footer>
      </Layout>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        placement="left"
        width={260}
        closable={false}
        styles={{ body: { padding: 0 }, header: { display: 'none' } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Brand />
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <SideMenu items={items} selectedKey={selectedKey} onSelect={(k) => { onSelect(k); setDrawer(false); }} />
          </div>
          <LogoutButton onLogout={() => { setDrawer(false); onLogout?.(); }} />
        </div>
      </Drawer>
    </Layout>
  );
}
