import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { api, setToken } from './api.js';
import { BLUE, LOGO_SRC } from './Layout.jsx';

export default function Login() {
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const go = async (v) => {
    setLoading(true);
    setErr('');
    try {
      setToken((await api('/login', 'POST', v)).token);
      location.reload();
    } catch (x) {
      setErr(x.message);
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img
            src={LOGO_SRC}
            alt="Assumption College Rayong"
            width={96}
            height={96}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <Typography.Title level={3} style={{ margin: '8px 0 0', color: BLUE.navy }}>
            ACR-Management
          </Typography.Title>
        </div>
        <Form layout="vertical" onFinish={go}>
          <Form.Item name="username" label="ชื่อผู้ใช้" rules={[{ required: true, message: 'กรุณากรอกชื่อผู้ใช้' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="password" label="รหัสผ่าน" rules={[{ required: true, message: 'กรุณากรอกรหัสผ่าน' }]}>
            <Input.Password />
          </Form.Item>
          {err && <Alert type="error" message={err} showIcon className="mb-3" />}
          <Button type="primary" htmlType="submit" block loading={loading}>เข้าสู่ระบบ</Button>
        </Form>
      </Card>
    </div>
  );
}
