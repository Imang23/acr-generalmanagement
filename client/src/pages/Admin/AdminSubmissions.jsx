import { useCallback, useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Descriptions, Empty, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, getToken } from '../../api.js';

const { Text } = Typography;
const statusMap = {
  pending: { label: 'รอตรวจสอบ', color: 'gold' },
  approved: { label: 'อนุมัติแล้ว', color: 'green' },
  rejected: { label: 'ส่งกลับแก้ไข', color: 'red' },
};
const dt = (v) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '-';

export default function AdminSubmissions({ tick }) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api('/admin/submissions')); setError(''); }
    catch (e) { setError(e.message || 'โหลดรายการไม่สำเร็จ'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, tick]);

  const review = async (status) => {
    if (status === 'rejected' && !note.trim()) { message.warning('กรุณาระบุเหตุผลที่ส่งกลับแก้ไข'); return; }
    setSaving(true);
    try {
      await api(`/admin/submissions/${selected.id}/review`, 'PUT', { status, review_note: note.trim() });
      message.success(status === 'approved' ? 'อนุมัติรายการแล้ว' : status === 'rejected' ? 'ส่งกลับแก้ไขแล้ว' : 'อัปเดตสถานะแล้ว');
      setSelected(null); setNote(''); await load();
    } catch (e) { message.error(e.message || 'บันทึกไม่สำเร็จ'); }
    finally { setSaving(false); }
  };

  const download = async (file) => {
    try {
      const res = await fetch(`/api/admin/submissions/files/${file.id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error('ดาวน์โหลดไฟล์ไม่สำเร็จ');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name || 'attachment'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { message.error(e.message); }
  };

  const columns = [
    { title: 'สถานะ', dataIndex: 'status', width: 130, render: (v) => { const s = statusMap[v] || statusMap.pending; return <Tag color={s.color}>{s.label}</Tag>; } },
    { title: 'เรื่อง / ประเภท', render: (_, r) => <><Text strong>{r.subject}</Text><br/><Text type="secondary">{r.category || 'ไม่ระบุประเภท'}{r.month ? ` · ${r.month}` : ''}</Text></> },
    { title: 'ผู้ส่ง', dataIndex: 'sender', width: 130 },
    { title: 'วันที่ส่ง', dataIndex: 'created_at', width: 155, render: dt },
    { title: 'ไฟล์', dataIndex: 'files', width: 80, render: (v) => `${(v || []).length} ไฟล์` },
    { title: '', width: 100, render: (_, r) => <Button type="primary" ghost onClick={() => { setSelected(r); setNote(r.review_note || ''); }}>ตรวจรายการ</Button> },
  ];

  return <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
    <Card style={{ borderRadius: 16, marginBottom: 16, background: 'linear-gradient(120deg,#eff6ff,#fff)' }}>
      <Space align="start" size={12}><div style={{ fontSize: 28, color: '#1677ff' }}>📥</div><div><Typography.Title level={3} style={{ margin: 0 }}>กล่องรับเอกสารเพื่ออนุมัติ</Typography.Title><Text type="secondary">รวมไฟล์จากงานธุรการและรายการที่ส่งให้ผู้ดูแลระบบตรวจสอบ</Text><div style={{ marginTop: 8 }}><Tag color="gold">รอตรวจ {rows.filter(r => (r.status || 'pending') === 'pending').length}</Tag><Tag color="green">อนุมัติ {rows.filter(r => r.status === 'approved').length}</Tag><Tag color="red">ส่งกลับแก้ไข {rows.filter(r => r.status === 'rejected').length}</Tag></div></div></Space>
    </Card>
    {error && <Alert type="error" showIcon message="โหลดรายการไม่สำเร็จ" description={error} action={<Button onClick={load}>ลองใหม่</Button>} style={{ marginBottom: 12 }} />}
    <Card title="รายการส่งตรวจ" extra={<Button icon={<ReloadOutlined />} onClick={load}>รีเฟรช</Button>} style={{ borderRadius: 14 }}>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={{ pageSize: 10, showSizeChanger: true }} locale={{ emptyText: <Empty description="ยังไม่มีเอกสารส่งตรวจ" /> }} />
    </Card>
    <Modal title={`ตรวจเอกสาร #${selected?.id || ''}`} open={!!selected} onCancel={() => setSelected(null)} footer={null} width={760} destroyOnClose>
      {selected && <>
        <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="เรื่อง">{selected.subject}</Descriptions.Item><Descriptions.Item label="ประเภท / เดือน">{selected.category || '-'} / {selected.month || '-'}</Descriptions.Item><Descriptions.Item label="ผู้ส่ง / วันที่">{selected.sender} · {dt(selected.created_at)}</Descriptions.Item><Descriptions.Item label="รายละเอียด">{selected.message || '-'}</Descriptions.Item><Descriptions.Item label="ผลการตรวจเดิม">{selected.review_note || '-'}</Descriptions.Item>
        </Descriptions>
        <Typography.Title level={5}>ไฟล์แนบ</Typography.Title>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          {(selected.files || []).map(f => <Card size="small" key={f.id}><Space wrap style={{ justifyContent: 'space-between', width: '100%' }}><span>📎 {f.name} <Text type="secondary">({Math.max(1, Math.round((f.size || 0) / 1024))} KB)</Text></span><Button icon={<DownloadOutlined />} onClick={() => download(f)}>ดาวน์โหลด</Button></Space></Card>)}
        </Space>
        <Typography.Title level={5}>หมายเหตุผู้ตรวจ</Typography.Title><Input.TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="หากส่งกลับแก้ไข กรุณาระบุเหตุผล" maxLength={1000} showCount />
        <Space style={{ marginTop: 16 }} wrap>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={saving} onClick={() => review('approved')}>อนุมัติ</Button>
          <Button danger icon={<RollbackOutlined />} loading={saving} onClick={() => review('rejected')}>ส่งกลับแก้ไข</Button>
          <Button icon={<ClockCircleOutlined />} loading={saving} onClick={() => review('pending')}>ตั้งเป็นรอตรวจ</Button>
        </Space>
      </>}
    </Modal>
  </div>;
}
