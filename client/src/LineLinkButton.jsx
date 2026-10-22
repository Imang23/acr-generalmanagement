import { useState } from 'react';
import { App as AntApp, Button, Modal, Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { api } from './api.js';

const { Text, Title } = Typography;

// ผูกบัญชี LINE เพื่อรับแจ้งเตือนส่วนตัว (วางในหน้าโปรไฟล์)
export default function LineLinkButton({ linked = false }) {
  const { message } = AntApp.useApp();
  const [code, setCode] = useState(null);

  const request = async () => {
    try {
      setCode((await api('/me/line-link-code', 'POST')).code);
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <>
      <Button icon={<LinkOutlined />} onClick={request}>
        {linked ? 'ผูก LINE ใหม่' : 'ผูกบัญชี LINE'}
      </Button>
      <Modal open={Boolean(code)} onCancel={() => setCode(null)} footer={null} title="ผูกบัญชี LINE">
        <p>พิมพ์ข้อความนี้ในแชทส่วนตัวกับบอทภายใน 10 นาที</p>
        <Title level={3} copyable={{ text: `#ผูกบัญชี ${code}` }} style={{ textAlign: 'center' }}>
          #ผูกบัญชี {code}
        </Title>
        <Text type="secondary">ใช้ได้ครั้งเดียว ห้ามพิมพ์ในกลุ่ม</Text>
      </Modal>
    </>
  );
}
