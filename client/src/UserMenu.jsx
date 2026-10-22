import { useEffect, useState } from 'react';
import {
  App as AntApp, Avatar, Button, Col, Form, Grid, Input, Modal, Row, Space, Tabs, Typography, Upload,
} from 'antd';
import {
  CameraOutlined, DeleteOutlined, IdcardOutlined, LockOutlined, MailOutlined, MessageOutlined, PhoneOutlined, UserOutlined,
} from '@ant-design/icons';
import { api, getToken } from './api.js';
import { BLUE } from './Layout.jsx';
import LineLinkButton from './LineLinkButton.jsx';
import { ROLE_LABEL } from './AccessContext.jsx';

const avatarUrl = (me) => (me?.has_avatar ? `/api/me/avatar?v=${me.avatar_v}&token=${getToken()}` : undefined);

// ย่อ + ตัดรูปเป็นสี่เหลี่ยมจัตุรัส 256px (JPEG) ก่อนอัปโหลด -> ไฟล์เล็ก โหลดไว
function resizeToJpeg(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // รูป PNG โปร่งใสให้พื้นขาว
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('เปิดไฟล์รูปไม่ได้ กรุณาใช้ไฟล์ JPG, PNG หรือ WebP'));
    };
    img.src = url;
  });
}

const PROFILE_KEYS = ['display_name', 'job_title', 'phone', 'email', 'line_id', 'note'];

function ProfileModal({ me, open, onClose, onChange }) {
  const { message } = AntApp.useApp();
  const [tab, setTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm();
  const [pwForm] = Form.useForm();

  useEffect(() => {
    if (!open || !me) return;
    setTab('profile');
    form.setFieldsValue(Object.fromEntries(PROFILE_KEYS.map((k) => [k, me[k] || ''])));
    pwForm.resetFields();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; } // ข้อมูลไม่ผ่าน: ฟอร์มแสดงข้อความแดงอยู่แล้ว
    setSaving(true);
    try {
      onChange(await api('/me', 'PUT', values));
      message.success('บันทึกข้อมูลแล้ว');
      onClose();
    } catch (e) { message.error(e.message); } finally { setSaving(false); }
  };

  const changePassword = async () => {
    let v;
    try { v = await pwForm.validateFields(); } catch { return; }
    setSaving(true);
    try {
      await api('/me/password', 'POST', { current: v.current, next: v.next });
      message.success('เปลี่ยนรหัสผ่านแล้ว');
      pwForm.resetFields();
      onClose();
    } catch (e) { message.error(e.message); } finally { setSaving(false); }
  };

  const uploadAvatar = async (file) => {
    if (file.size > 8 * 1024 * 1024) { message.error('ไฟล์รูปใหญ่เกิน 8 MB'); return; }
    setUploading(true);
    try {
      const data = await resizeToJpeg(file);
      onChange(await api('/me/avatar', 'PUT', { mime: 'image/jpeg', data }));
      message.success('เปลี่ยนรูปแล้ว');
    } catch (e) { message.error(e.message); } finally { setUploading(false); }
  };

  const removeAvatar = async () => {
    try {
      await api('/me/avatar', 'DELETE');
      onChange({ ...me, has_avatar: false, avatar_v: Date.now() });
      message.success('ลบรูปแล้ว');
    } catch (e) { message.error(e.message); }
  };

  const profileTab = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <Avatar size={88} src={avatarUrl(me)} icon={<UserOutlined />} style={{ background: BLUE.soft, color: BLUE.primary, flex: 'none' }} />
        <div>
          <Typography.Text strong style={{ display: 'block' }}>{me?.display_name || me?.username}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>ชื่อผู้ใช้: {me?.username}</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={(f) => { uploadAvatar(f); return false; }}>
                <Button size="small" icon={<CameraOutlined />} loading={uploading}>{me?.has_avatar ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}</Button>
              </Upload>
              {me?.has_avatar && <Button size="small" danger icon={<DeleteOutlined />} onClick={removeAvatar}>ลบรูป</Button>}
            </Space>
          </div>
        </div>
      </div>

      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="display_name" label="ชื่อที่แสดง" rules={[{ max: 80 }]}>
              <Input prefix={<UserOutlined />} placeholder="เช่น ครูสมชาย ใจดี" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="job_title" label="ตำแหน่ง" rules={[{ max: 80 }]}>
              <Input prefix={<IdcardOutlined />} placeholder="เช่น หัวหน้างานอาคารสถานที่" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="เบอร์โทร" rules={[{ pattern: /^[0-9+\-()\s#,.]*$/, message: 'ใช้ได้เฉพาะตัวเลขและ + - ( )' }, { max: 30 }]}>
              <Input prefix={<PhoneOutlined />} placeholder="081-234-5678" inputMode="tel" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="email" label="อีเมล" rules={[{ type: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง' }, { max: 120 }]}>
              <Input prefix={<MailOutlined />} placeholder="name@example.com" inputMode="email" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="line_id" label="LINE ID" rules={[{ max: 60 }]}>
              <Input prefix={<MessageOutlined />} placeholder="LINE ID" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="note" label="ข้อมูลติดต่ออื่นๆ / หมายเหตุ" rules={[{ max: 500 }]}>
              <Input.TextArea rows={3} showCount maxLength={500} placeholder="เช่น เบอร์ภายใน ต่อ 101, เวลาที่ติดต่อได้" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </>
  );

  const passwordTab = (
    <Form form={pwForm} layout="vertical">
      <Form.Item name="current" label="รหัสผ่านปัจจุบัน" rules={[{ required: true, message: 'กรุณากรอกรหัสผ่านปัจจุบัน' }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item name="next" label="รหัสผ่านใหม่" rules={[{ required: true, message: 'กรุณากรอกรหัสผ่านใหม่' }, { min: 6, message: 'อย่างน้อย 6 ตัวอักษร' }]}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm" label="ยืนยันรหัสผ่านใหม่" dependencies={['next']}
        rules={[
          { required: true, message: 'กรุณายืนยันรหัสผ่านใหม่' },
          ({ getFieldValue }) => ({
            validator: (_, v) => (!v || getFieldValue('next') === v ? Promise.resolve() : Promise.reject(new Error('รหัสผ่านไม่ตรงกัน'))),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </Form>
  );

  return (
    <Modal
      open={open}
      forceRender
      title="บัญชีผู้ใช้"
      okText={tab === 'password' ? 'เปลี่ยนรหัสผ่าน' : 'บันทึก'}
      cancelText="ยกเลิก"
      confirmLoading={saving}
      onOk={tab === 'password' ? changePassword : saveProfile}
      onCancel={onClose}
      width={560}
      style={{ top: 24 }}
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'profile', label: 'ข้อมูลส่วนตัว', children: profileTab, forceRender: true },
          { key: 'password', label: <span><LockOutlined /> รหัสผ่าน</span>, children: passwordTab, forceRender: true },
          {
            key: 'line',
            label: <span><MessageOutlined /> LINE แจ้งเตือน</span>,
            children: (
              <div style={{ paddingTop: 8 }}>
                <p>บทบาท: <b>{ROLE_LABEL[me.role] || '-'}</b></p>
                <p>
                  ผูกบัญชี LINE เพื่อรับแจ้งเตือนส่วนตัว เช่น ช่างส่งงานรอตรวจ หรือคำขอลบรอพิจารณา
                  {me.line_linked ? ' (ผูกแล้ว)' : ''}
                </p>
                <LineLinkButton linked={Boolean(me.line_linked)} />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}

/** ข้อมูลผู้ใช้บน Header: รูป + ชื่อ + ตำแหน่ง กดเพื่อแก้ไขโปรไฟล์ */
export default function UserMenu() {
  const { message } = AntApp.useApp();
  const isMobile = !Grid.useBreakpoint().md;
  const [me, setMe] = useState(null); // null = กำลังโหลด, false = โหลดไม่สำเร็จ
  const [open, setOpen] = useState(false);

  useEffect(() => { api('/me').then(setMe).catch(() => setMe(false)); }, []);

  const name = me?.display_name || me?.username || 'ผู้ใช้';

  const openProfile = () => {
    if (!me) { message.error('โหลดข้อมูลผู้ใช้ไม่สำเร็จ ตรวจสอบว่าเซิร์ฟเวอร์เป็นเวอร์ชันล่าสุดและรัน initdb แล้ว'); return; }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openProfile}
        title="แก้ไขข้อมูลผู้ใช้"
        className="transition-colors hover:bg-[#f2f6fc]"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, maxWidth: 280,
          padding: '4px 10px 4px 4px', border: 0, borderRadius: 999, background: 'transparent', cursor: 'pointer', font: 'inherit',
        }}
      >
        <Avatar src={avatarUrl(me)} icon={<UserOutlined />} style={{ background: BLUE.soft, color: BLUE.primary, flex: 'none' }} />
        {!isMobile && (
          <span style={{ display: 'block', minWidth: 0, textAlign: 'left', lineHeight: 1.25 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: BLUE.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            <span style={{ display: 'block', fontSize: 12, color: '#6b7a99', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {me?.job_title || 'ยังไม่ระบุตำแหน่ง'}
            </span>
          </span>
        )}
      </button>
      {me && <ProfileModal me={me} open={open} onClose={() => setOpen(false)} onChange={setMe} />}
    </>
  );
}
