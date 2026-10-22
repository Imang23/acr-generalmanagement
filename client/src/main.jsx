import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import thTH from 'antd/locale/th_TH';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import App from './App.jsx';
import './index.css';

dayjs.locale('th');

createRoot(document.getElementById('root')).render(
  <ConfigProvider
    locale={thTH}
    theme={{
      token: { colorPrimary: '#1a4fb8', colorLink: '#1a4fb8', borderRadius: 8, fontFamily: "'IBM Plex Sans Thai', system-ui, sans-serif" },
      components: {
        Layout: { bodyBg: '#f2f6fc', headerBg: '#ffffff', siderBg: '#ffffff' },
        Menu: {
          itemSelectedBg: '#e8f0fe',
          itemSelectedColor: '#1a4fb8',
          subMenuItemBg: 'transparent', // เมนูย่อยโปร่งใส กลืนกับ Sider
          itemHoverBg: '#f2f6fc',
          groupTitleColor: '#6b7a99',
        },
      },
    }}
  >
    <AntApp><App /></AntApp>
  </ConfigProvider>
);
