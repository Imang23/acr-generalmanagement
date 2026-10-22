import { useEffect, useState, useCallback } from 'react';
import { App, Button, Card, Input, Modal, Segmented, Space, Table, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api.js';
import { useAccess } from '../../AccessContext.jsx';

const { Title, Text } = Typography;

const STATUS = {
  pending: { label: 'รอพิจารณา', color: 'orange' },
  approved: { label: 'อนุมัติแล้ว (ลบแล้ว)', color: 'green' },
  rejected: { label: 'ไม่อนุมัติ', color: 'default' },
};

export default function DeleteRequests() {
  const { message, modal } = App.useApp();
  const { access, can } = useAccess();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api(`/delete-requests?status=${status}`));
    } catch (e) {
      message.error(`โหลดไม่สำเร็จ: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [status, message]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, action, text = '') => {
    try {
      await api(`/delete-requests/${id}/decision`, 'POST', { action, note: text });
      message.success(action === 'approve' ? 'อนุมัติและลบข้อมูลแล้ว' : 'ไม่อนุมัติคำขอแล้ว');
      setRejecting(null);
      setNote('');
      load();
    } catch (e) {
      message.error(e.message);
      load();
    }
  };

  const approve = (r) => modal.confirm({
    title: 'ยืนยันอนุมัติการลบ',
    content: `ข้อมูล "${r.record_label || r.record_id}" จะถูกลบถาวร`,
    okText: 'อนุมัติและลบ', cancelText: 'ยกเลิก', okButtonProps: { danger: true },
    onOk: () => decide(r.id, 'approve'),
  });

  const columns = [
    { title: 'คำขอ', dataIndex: 'id', width: 80, render: (v) => `#${v}` },
    {
      title: 'รายการ', key: 'item',
      render: (_, r) => (
        <div>
          <Text strong>{r.record_label || '-'}</Text><br />
          <Text type="secondary">{r.table_name} #{r.record_id}</Text>
        </div>
      ),
    },
    { title: 'เหตุผล', dataIndex: 'reason' },
    { title: 'ผู้ขอ', dataIndex: 'requested_by' },
    { title: 'เวลา', dataIndex: 'requested_at', render: (v) => dayjs(v).format('DD/MM/YYYY HH:mm') },
    {
      title: 'สถานะ', dataIndex: 'status',
      render: (v, r) => (
        <div>
          <Tag color={STATUS[v]?.color}>{STATUS[v]?.label || v}</Tag>
          {r.decided_by && <div><Text type="secondary">โดย {r.decided_by}</Text></div>}
          {r.decision_note && <div><Text type="secondary">{r.decision_note}</Text></div>}
        </div>
      ),
    },
    {
      title: 'จัดการ', key: 'a', width: 170,
      render: (_, r) => (r.status === 'pending' && can(r.module, 'approve') ? (
        <Space>
          <Button type="primary" danger icon={<CheckOutlined />} onClick={() => approve(r)}>อนุมัติ</Button>
          <Button icon={<CloseOutlined />} onClick={() => setRejecting(r)}>ไม่อนุมัติ</Button>
        </Space>
      ) : null),
    },
  ];

  return (
    <div style={{ padding: 4 }}>
      <Title level={2} style={{ marginBottom: 4 }}>คำขอลบข้อมูล</Title>
      <Text type="secondary">
        {access?.role === 'technician' ? 'คำขอของคุณและผลการพิจารณา' : 'ตรวจสอบและอนุมัติคำขอลบจากช่าง'}
      </Text>

      <Card style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pending', label: 'รอพิจารณา' },
              { value: 'approved', label: 'อนุมัติแล้ว' },
              { value: 'rejected', label: 'ไม่อนุมัติ' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>รีเฟรช</Button>
        </Space>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 900 }} />
      </Card>

      <Modal
        title={`ไม่อนุมัติคำขอ #${rejecting?.id || ''}`}
        open={Boolean(rejecting)}
        onCancel={() => { setRejecting(null); setNote(''); }}
        onOk={() => decide(rejecting.id, 'reject', note)}
        okText="ยืนยัน" cancelText="ยกเลิก" okButtonProps={{ disabled: !note.trim() }}
      >
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ระบุเหตุผลที่ไม่อนุมัติ" />
      </Modal>
    </div>
  );
}
