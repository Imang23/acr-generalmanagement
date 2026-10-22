import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Row,
  Select,
  Spin,
  Statistic,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  BankOutlined,
  EnvironmentOutlined,
  EditOutlined,
  SearchOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { api } from '../../api';
import { useAccess } from '../../AccessContext.jsx';

const { Title, Text } = Typography;

const DEFAULT_VALUES = { status: 'active', code: '', location: '', description: '' };

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const imageSrc = (building) =>
  building.image_url ? `${building.image_url}&v=${building.image_v ?? 0}` : null;

function BuildingsView({
  isAdmin = false,
  initialBuildings = [],
  onAddBuilding,
  onUpdateBuilding,
  onUploadImage,
  onRemoveImage,
  onSaved,
  onOpenBuilding,
}) {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // ใช้ข้อมูลจากเซิร์ฟเวอร์โดยตรง (ไม่เก็บสำเนาใน state) จึงไม่ค้าง id ชั่วคราว
  const buildings = initialBuildings;

  // ตั้งค่าฟอร์มหลัง Modal เรนเดอร์แล้ว
  useEffect(() => {
    if (!modalOpen) return;
    form.resetFields();
    form.setFieldsValue({
      ...DEFAULT_VALUES,
      ...(editing || {}),
      imageFile: editing && imageSrc(editing)
        ? [{ uid: '-1', name: 'current', status: 'done', url: imageSrc(editing) }]
        : [],
    });
  }, [modalOpen, editing, form]);

  const filteredBuildings = useMemo(() => {
    const search = keyword.trim().toLowerCase();

    return buildings.filter((building) => {
      const matchesKeyword =
        !search ||
        [building.name, building.code, building.location].some((value) =>
          String(value || '').toLowerCase().includes(search),
        );

      const matchesStatus = statusFilter === 'all' || building.status === statusFilter;

      return matchesKeyword && matchesStatus;
    });
  }, [buildings, keyword, statusFilter]);

  const activeCount = buildings.filter((item) => item.status === 'active').length;

  const openAddModal = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEditModal = (building) => {
    if (!isAdmin) return;
    setEditing(building);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!isAdmin) {
      message.warning('คุณไม่มีสิทธิ์จัดการอาคาร');
      return;
    }

    try {
      const values = await form.validateFields();
      setSaving(true);

      const file = values.imageFile?.[0];
      const newFile = file?.originFileObj; // มีค่าเฉพาะรูปที่เพิ่งเลือก
      const removedOld = Boolean(editing && imageSrc(editing) && !file);

      let saved;
      if (editing) {
        saved = (await onUpdateBuilding?.({ ...editing, ...values })) || editing;
      } else {
        saved = await onAddBuilding?.(values);
      }

      const id = saved?.id ?? editing?.id;

      if (id && newFile) {
        try {
          await onUploadImage?.(id, newFile);
        } catch (err) {
          message.warning(`บันทึกอาคารแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ${err?.message || ''}`);
        }
      } else if (id && removedOld) {
        try {
          await onRemoveImage?.(id);
        } catch (err) {
          message.warning(`ลบรูปไม่สำเร็จ: ${err?.message || ''}`);
        }
      }

      message.success(editing ? 'แก้ไขข้อมูลอาคารเรียบร้อย' : 'เพิ่มอาคารเรียบร้อย');
      setModalOpen(false);
      setEditing(null);
      onSaved?.();
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error?.message || 'บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        padding: 24,
        minHeight: '100%',
        background: '#f5f7fb',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <BankOutlined style={{ marginRight: 10 }} />
            จัดการอาคาร
          </Title>
          <Text type="secondary">Buildings Management / จัดการข้อมูลอาคารทั้งหมด</Text>
        </div>

        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} size="large" onClick={openAddModal}>
            เพิ่มอาคารใหม่
          </Button>
        )}
      </div>

      {/* Summary */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card variant="borderless">
            <Statistic title="อาคารทั้งหมด" value={buildings.length} prefix={<BankOutlined />} />
          </Card>
        </Col>

        <Col xs={12} sm={8}>
          <Card variant="borderless">
            <Statistic
              title="เปิดใช้งาน"
              value={activeCount}
              styles={{ content: { color: '#16a34a' } }}
            />
          </Card>
        </Col>

        <Col xs={12} sm={8}>
          <Card variant="borderless">
            <Statistic
              title="ปิดใช้งาน"
              value={buildings.length - activeCount}
              styles={{ content: { color: '#94a3b8' } }}
            />
          </Card>
        </Col>
      </Row>

      {/* Search and filters */}
      <Card variant="borderless" style={{ marginBottom: 20 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={15}>
            <Input
              size="large"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="ค้นหาชื่ออาคาร รหัสอาคาร หรือสถานที่..."
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </Col>

          <Col xs={24} md={9}>
            <Select
              size="large"
              style={{ width: '100%' }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: 'ทุกสถานะ', value: 'all' },
                { label: 'เปิดใช้งาน', value: 'active' },
                { label: 'ปิดใช้งาน', value: 'inactive' },
              ]}
            />
          </Col>
        </Row>
      </Card>

      {/* Building cards */}
      <Row gutter={[16, 16]}>
        {filteredBuildings.map((building) => {
          const src = imageSrc(building);

          return (
            <Col xs={24} sm={12} lg={8} xl={6} key={building.id}>
              <Card
                hoverable={Boolean(onOpenBuilding)}
                variant="borderless"
                style={{ height: '100%', borderRadius: 12, overflow: 'hidden' }}
                styles={{ body: { padding: 20 } }}
                cover={
                  src ? (
                    <Image
                      src={src}
                      alt={building.name}
                      height={160}
                      preview={false}
                      style={{ objectFit: 'cover', width: '100%' }}
                    />
                  ) : null
                }
                onClick={() => onOpenBuilding?.(building)}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      background: '#e8f1ff',
                      color: '#2563eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 25,
                    }}
                  >
                    <BankOutlined />
                  </div>

                  <Tag color={building.status === 'active' ? 'success' : 'default'}>
                    {building.status === 'active' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                  </Tag>
                </div>

                <Text type="secondary" style={{ fontSize: 12 }}>
                  {building.code}
                </Text>

                <Title level={4} style={{ marginTop: 6, marginBottom: 8 }}>
                  {building.name}
                </Title>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <EnvironmentOutlined style={{ color: '#64748b' }} />
                  <Text type="secondary">{building.location || 'ไม่ได้ระบุสถานที่'}</Text>
                </div>

                <Text type="secondary" style={{ display: 'block', minHeight: 44, marginBottom: 16 }}>
                  {building.description || 'ไม่มีรายละเอียด'}
                </Text>

                <div
                  style={{
                    borderTop: '1px solid #f0f0f0',
                    paddingTop: 14,
                    display: 'flex',
                    justifyContent: onOpenBuilding ? 'space-between' : 'flex-end',
                    alignItems: 'center',
                  }}
                >
                  {onOpenBuilding && (
                    <Button
                      type="link"
                      icon={<AppstoreOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenBuilding(building);
                      }}
                      style={{ paddingLeft: 0 }}
                    >
                      ดูรายละเอียด
                    </Button>
                  )}

                  {isAdmin && (
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditModal(building);
                      }}
                    >
                      แก้ไข
                    </Button>
                  )}
                </div>
              </Card>
            </Col>
          );
        })}

        {filteredBuildings.length === 0 && (
          <Col span={24}>
            <Card variant="borderless">
              <Empty description="ไม่พบข้อมูลอาคาร">
                {isAdmin && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
                    เพิ่มอาคารใหม่
                  </Button>
                )}
              </Empty>
            </Card>
          </Col>
        )}
      </Row>

      {/* Add / Edit modal */}
      <Modal
        title={editing ? 'แก้ไขข้อมูลอาคาร' : 'เพิ่มอาคารใหม่'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={handleSave}
        okText="บันทึกข้อมูล"
        cancelText="ยกเลิก"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            label="รูปภาพอาคาร"
            name="imageFile"
            valuePropName="fileList"
            getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
          >
            <Upload
              accept="image/jpeg,image/png,image/webp"
              listType="picture-card"
              maxCount={1}
              beforeUpload={(file) => {
                const allowed = ['image/jpeg', 'image/png', 'image/webp'];

                if (!allowed.includes(file.type)) {
                  message.error('รองรับเฉพาะ JPG, PNG และ WebP');
                  return Upload.LIST_IGNORE;
                }

                if (file.size > 700 * 1024) {
                  // base64 ใหญ่กว่าไฟล์จริง ~33% และเซิร์ฟเวอร์จำกัด 1 MB หลังถอดรหัส
                  message.error('รูปต้องมีขนาดไม่เกิน 700 KB');
                  return Upload.LIST_IGNORE;
                }

                return false; // ไม่อัปโหลดทันที ส่งตอนกดบันทึก
              }}
            >
              <div>
                <PlusOutlined />
                <div style={{ marginTop: 8 }}>เลือกรูป</div>
              </div>
            </Upload>
          </Form.Item>

          <Form.Item
            label="รหัสอาคาร"
            name="code"
            rules={[
              { required: true, message: 'กรุณาระบุรหัสอาคาร' },
              { whitespace: true, message: 'กรุณาระบุรหัสอาคาร' },
            ]}
          >
            <Input placeholder="เช่น BLD-004" maxLength={50} disabled={Boolean(editing)} />
          </Form.Item>

          <Form.Item
            label="ชื่ออาคาร"
            name="name"
            rules={[
              { required: true, message: 'กรุณาระบุชื่ออาคาร' },
              { whitespace: true, message: 'กรุณาระบุชื่ออาคาร' },
            ]}
          >
            <Input placeholder="เช่น อาคารที่ 4" maxLength={150} />
          </Form.Item>

          <Form.Item label="สถานที่ตั้ง" name="location">
            <Input placeholder="ระบุสถานที่ตั้งอาคาร" maxLength={255} />
          </Form.Item>

          <Form.Item label="รายละเอียด" name="description">
            <Input.TextArea placeholder="รายละเอียดเพิ่มเติม" rows={3} maxLength={1000} />
          </Form.Item>

          <Form.Item
            label="สถานะ"
            name="status"
            rules={[{ required: true, message: 'กรุณาเลือกสถานะ' }]}
          >
            <Select
              options={[
                { label: 'เปิดใช้งาน', value: 'active' },
                { label: 'ปิดใช้งาน', value: 'inactive' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

const toPayload = ({ code, name, location, description, status }) => ({
  code: String(code || '').trim(),
  name: String(name || '').trim(),
  location,
  description,
  status,
});

// หน้าอาคาร: โหลด/บันทึกผ่าน /api/buildings
export default function Buildings({ tick, onOpenBuilding }) {
  const { can } = useAccess();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api('/buildings')
      .then((data) => {
        setRows(Array.isArray(data) ? data : data?.data || []);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load, tick]);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="โหลดข้อมูลอาคารไม่สำเร็จ"
        description={error}
        style={{ margin: 24 }}
      />
    );
  }
  if (!rows) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  return (
    <BuildingsView
      isAdmin={can('buildings', 'write')}
      initialBuildings={rows}
      onOpenBuilding={onOpenBuilding}
      onSaved={load}
      onAddBuilding={(b) => api('/buildings', 'POST', toPayload(b))}
      onUpdateBuilding={(b) => api(`/buildings/${b.id}`, 'PUT', toPayload(b))}
      onUploadImage={async (id, file) =>
        api(`/buildings/${id}/image`, 'PUT', {
          mime: file.type,
          data: await fileToBase64(file),
        })
      }
      onRemoveImage={(id) => api(`/buildings/${id}/image`, 'DELETE')}
    />
  );
}
