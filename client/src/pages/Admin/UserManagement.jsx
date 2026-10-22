import { useEffect, useState, useCallback } from 'react';
import {
  App, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../../api.js';
import { useAccess, ROLE_LABEL, ROLE_COLOR } from '../../AccessContext.jsx';

const { Title, Text } = Typography;

export default function UserManagement() {
  const { message } = App.useApp();
  const { access } = useAccess();
  const [form] = Form.useForm();
  const [pwForm] = Form.useForm();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // null = สร้างใหม่
  const [open, setOpen] = useState(false);
  const [pwUser, setPwUser] = useState(null);

  const modules = access?.modules || [];
  const moduleLabel = Object.fromEntries(modules.map((m) => [m.value, m.label]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api('/users'));
    } catch (e) {
      message.error(`โหลดไม่สำเร็จ: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'technician', permissions: ['repairs'], active: true });
    setOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    form.resetFields();
    form.setFieldsValue(u);
    setOpen(true);
  };

  const save = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      if (editing) {
        await api(`/users/${editing.id}`, 'PUT', {
            display_name: v.display_name, role: v.role,
            permissions: v.permissions, active: v.active,
          });
      } else {
        await api('/users', 'POST', v);
      }
      message.success('บันทึกเรียบร้อย');
      setOpen(false);
      load();
    } catch (e) {
      if (!e?.errorFields) message.error(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    try {
      const v = await pwForm.validateFields();
      await api(`/users/${pwUser.id}/password`, 'POST', { password: v.password });
      message.success('เปลี่ยนรหัสผ่านเรียบร้อย');
      setPwUser(null);
    } catch (e) {
      if (!e?.errorFields) message.error(e.message);
    }
  };

  const role = Form.useWatch('role', form);

  const columns = [
    { title: 'ชื่อผู้ใช้', dataIndex: 'username', render: (v) => <Text strong>{v}</Text> },
    { title: 'ชื่อที่แสดง', dataIndex: 'display_name', render: (v) => v || '-' },
    {
      title: 'บทบาท', dataIndex: 'role',
      render: (v) => <Tag color={ROLE_COLOR[v]}>{ROLE_LABEL[v] || v}</Tag>,
    },
    {
      title: 'เมนูที่เข้าได้', dataIndex: 'permissions',
      render: (v, r) => (r.role === 'admin'
        ? <Tag>ทุกเมนู</Tag>
        : (v?.length ? v.map((p) => <Tag key={p}>{moduleLabel[p] || p}</Tag>) : <Text type="secondary">ยังไม่กำหนด</Text>)),
    },
    { title: 'LINE', dataIndex: 'line_linked', render: (v) => (v ? <Tag color="green">ผูกแล้ว</Tag> : <Tag>ยังไม่ผูก</Tag>) },
    { title: 'สถานะ', dataIndex: 'active', render: (v) => (v ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิดใช้งาน</Tag>) },
    {
      title: 'จัดการ', key: 'a', width: 110,
      render: (_, r) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button icon={<KeyOutlined />} onClick={() => { pwForm.resetFields(); setPwUser(r); }} />
        </Space>
      ),
    },
  ];

  if (access && !access.is_admin) {
    return <Card>เฉพาะผู้ดูแลระบบเท่านั้นที่จัดการผู้ใช้ได้</Card>;
  }

  return (
    <div style={{ padding: 4 }}>
      <Title level={2} style={{ marginBottom: 4 }}>จัดการผู้ใช้</Title>
      <Text type="secondary">กำหนดบทบาทและเมนูที่แต่ละคนเข้าได้</Text>

      <Card style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>เพิ่มผู้ใช้</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>รีเฟรช</Button>
        </Space>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={users} scroll={{ x: 800 }} />
      </Card>

      <Modal
        title={editing ? `แก้ไขผู้ใช้ ${editing.username}` : 'เพิ่มผู้ใช้'}
        open={open} onCancel={() => setOpen(false)} onOk={save}
        confirmLoading={saving} okText="บันทึก" cancelText="ยกเลิก" destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="ชื่อผู้ใช้" rules={[{ required: true, message: 'กรุณากรอกชื่อผู้ใช้' }]}>
            <Input disabled={Boolean(editing)} placeholder="a-z 0-9 _ . -" />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="รหัสผ่าน" rules={[{ required: true, min: 6, message: 'อย่างน้อย 6 ตัวอักษร' }]}>
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="display_name" label="ชื่อที่แสดง"><Input /></Form.Item>
          <Form.Item name="role" label="บทบาท" rules={[{ required: true }]}>
            <Select options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          {role !== 'admin' && (
            <Form.Item name="permissions" label="เมนูที่เข้าได้">
              <Select mode="multiple" options={modules} placeholder="เลือกเมนู" />
            </Form.Item>
          )}
          {editing && (
            <Form.Item name="active" label="เปิดใช้งานบัญชี" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          <Text type="secondary">
            ผู้ตรวจ: ทำได้ทุกอย่างในเมนูที่กำหนด แต่งานซ่อม/แม่บ้าน/สวน เห็นและตรวจได้เฉพาะงานที่ได้รับมอบหมายให้ · ช่าง: ดู/เพิ่ม/แก้ไขได้ ลบต้องขออนุมัติ · ทั่วไป: ดูอย่างเดียว
          </Text>
        </Form>
      </Modal>

      <Modal
        title={`เปลี่ยนรหัสผ่าน ${pwUser?.username || ''}`}
        open={Boolean(pwUser)} onCancel={() => setPwUser(null)} onOk={resetPassword}
        okText="บันทึก" cancelText="ยกเลิก" destroyOnClose
      >
        <Form form={pwForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="password" label="รหัสผ่านใหม่" rules={[{ required: true, min: 6, message: 'อย่างน้อย 6 ตัวอักษร' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
