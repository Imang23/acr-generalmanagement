import { useEffect, useState, useCallback } from 'react';
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  Typography,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  CameraOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAccess } from '../AccessContext.jsx';
import InspectorWork from '../InspectorWork.jsx';
import { askDeleteRequest } from '../deleteRequest.jsx';

const { Title, Text } = Typography;
const API = '/api/general-management';

const COMMITTEE_ROLES = [
  'ผู้อำนวยการ',
  'ผู้ช่วยหัวหน้าฝ่าย',
  'ธุระการฝ่าย',
  'กรรมการ',
  'เลขานุการ',
];

const COMMITTEE_STATUS = [
  { value: 'ACTIVE', label: 'ดำรงตำแหน่ง' },
  { value: 'EXPIRED', label: 'ครบวาระ' },
  { value: 'INACTIVE', label: 'ยุติบทบาท' },
];

const EMPLOYEE_STATUS = [
  { value: 'ACTIVE', label: 'ปฏิบัติงาน' },
  { value: 'INACTIVE', label: 'พ้นสภาพ' },
  { value: 'ON_LEAVE', label: 'ลางาน' },
];

const statusColor = {
  ACTIVE: 'green',
  EXPIRED: 'orange',
  INACTIVE: 'default',
  ON_LEAVE: 'blue',
};

// หา token ที่ล็อกอินไว้ รองรับกรณีหน้าอื่นเก็บไว้ใต้ชื่อคีย์ต่างจาก 'token'
// (token ของระบบนี้เป็น JWT รูปแบบ xxx.yyy.zzz ขึ้นต้นด้วย eyJ)
const JWT_PATTERN = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

function getToken() {
  const stores = [localStorage, sessionStorage];

  for (const store of stores) {
    const direct = store.getItem('token');
    if (direct) return direct.replace(/^"|"$/g, '');
  }

  for (const store of stores) {
    for (let i = 0; i < store.length; i += 1) {
      const raw = store.getItem(store.key(i)) || '';
      const value = raw.replace(/^"|"$/g, '');
      if (JWT_PATTERN.test(value)) return value;
    }
  }

  return null;
}

async function apiRequest(path, options = {}) {
  const token = getToken();

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...options.headers,
    },
  });

  // DELETE ตอบ 204 ไม่มี body -> json() จะ error จึง catch เป็น {}
  const result = await response.json().catch(() => ({}));

  if (response.status === 401) {
    throw new Error(
      token
        ? 'token ไม่ถูกต้องหรือหมดอายุ กรุณาออกจากระบบแล้วล็อกอินใหม่'
        : 'ไม่พบ token การล็อกอิน กรุณาล็อกอินใหม่'
    );
  }

  if (!response.ok) {
    // server ส่ง error กลับมาในฟิลด์ "error"
    throw new Error(
      result.error || result.message || `HTTP ${response.status}`
    );
  }

  return result;
}

// ย่อรูปเหลือไม่เกิน 800px แล้วแปลงเป็น JPEG (ให้ต่ำกว่าลิมิต 1 MB ของเซิร์ฟเวอร์)
function compressImage(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();

    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('อ่านไฟล์รูปไม่ได้'));
    };

    img.src = url;
  });
}

export default function GeneralManagement({ tick, onNavigate }) {
  const { message, modal } = App.useApp();
  const { can, access } = useAccess();
  const showInspectorTab = Boolean(access && (access.is_admin || access.role === 'inspector'));
  const canWrite = can('general', 'write');
  const canDelete = can('general', 'delete'); // ช่างลบเองไม่ได้ ต้องขออนุมัติ
  const [form] = Form.useForm();

  const [activeTab, setActiveTab] = useState('committee');
  const [committees, setCommittees] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewMode, setViewMode] = useState('card'); // 'card' | 'table'
  const [detail, setDetail] = useState(null); // รายการที่เปิดดูแบบการ์ด
  const [photo, setPhoto] = useState({ pending: null, remove: false });

  const isCommittee = activeTab === 'committee';
  const records = isCommittee ? committees : employees;
  const statusOptions = isCommittee
    ? COMMITTEE_STATUS
    : EMPLOYEE_STATUS;

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [committeeData, employeeData] = await Promise.all([
        apiRequest('/committees'),
        apiRequest('/employees'),
      ]);

      const committeeList = Array.isArray(committeeData)
        ? committeeData
        : committeeData.data || [];

      const employeeList = Array.isArray(employeeData)
        ? employeeData
        : employeeData.data || [];

      // เรียง ID น้อยไปมาก
      setCommittees(
        [...committeeList].sort((a, b) => Number(a.id) - Number(b.id))
      );

      setEmployees(
        [...employeeList].sort((a, b) => Number(a.id) - Number(b.id))
      );
    } catch (error) {
      message.error(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRecords = records.filter((record) => {
    const keyword = search.toLowerCase().trim();

    const matchesSearch = [
      record.employee_code,
      record.full_name,
      record.position,
      record.department,
      record.phone,
    ].some((value) =>
      String(value || '').toLowerCase().includes(keyword)
    );

    const matchesStatus =
      statusFilter === 'ALL' ||
      record.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const openCreate = () => {
    setEditing(null);
    setPhoto({ pending: null, remove: false });
    form.resetFields();
    form.setFieldsValue({ status: 'ACTIVE' });
    setOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    setPhoto({ pending: null, remove: false });
    form.resetFields();

    form.setFieldsValue({
      ...record,
      term_start: record.term_start
        ? dayjs(record.term_start)
        : null,
      term_end: record.term_end
        ? dayjs(record.term_end)
        : null,
    });

    setOpen(true);
  };

  const saveRecord = async () => {
    try {
      const values = await form.validateFields();

      setSaving(true);

      const payload = {
        ...values,

        // แปลงตำแหน่งจาก Array ให้เป็นข้อความธรรมดา
        position: Array.isArray(values.position)
          ? values.position[0] || ''
          : values.position,

        term_start: values.term_start
          ? values.term_start.format('YYYY-MM-DD')
          : null,

        term_end: values.term_end
          ? values.term_end.format('YYYY-MM-DD')
          : null,
      };

      const resource = isCommittee
        ? 'committees'
        : 'employees';

      const path = editing
        ? `/${resource}/${editing.id}`
        : `/${resource}`;

      const saved = await apiRequest(path, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });

      // จัดการรูป (ต้องมี id ก่อน จึงอัปโหลดหลังบันทึกข้อมูล)
      const recordId = editing?.id ?? saved.id;

      try {
        if (photo.pending) {
          await apiRequest(`/${resource}/${recordId}/photo`, {
            method: 'PUT',
            body: JSON.stringify({
              mime: photo.pending.mime,
              data: photo.pending.data,
            }),
          });
        } else if (photo.remove && editing?.has_photo) {
          await apiRequest(`/${resource}/${recordId}/photo`, {
            method: 'DELETE',
          });
        }
      } catch (photoError) {
        message.warning(
          `บันทึกข้อมูลแล้ว แต่รูปไม่สำเร็จ: ${photoError.message}`
        );
      }

      message.success(
        editing
          ? 'แก้ไขข้อมูลเรียบร้อย'
          : 'เพิ่มข้อมูลเรียบร้อย'
      );

      setOpen(false);
      await loadData();
    } catch (error) {
      if (error?.errorFields) return;

      message.error(`บันทึกไม่สำเร็จ: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = (record) => {
    if (!canWrite) return;
    if (!canDelete) {
      askDeleteRequest({
        message,
        table: isCommittee ? 'committees' : 'employees',
        recordId: record.id,
        label: record.full_name,
      });
      return;
    }

    modal.confirm({
      title: 'ยืนยันการลบข้อมูล',
      content: `ต้องการลบ ${record.full_name} หรือไม่?`,
      okText: 'ลบข้อมูล',
      cancelText: 'ยกเลิก',
      okButtonProps: { danger: true },

      onOk: async () => {
        const resource = isCommittee
          ? 'committees'
          : 'employees';

        try {
          await apiRequest(
            `/${resource}/${record.id}`,
            { method: 'DELETE' }
          );

          message.success('ลบข้อมูลเรียบร้อย');
          await loadData();
        } catch (error) {
          message.error(`ลบไม่สำเร็จ: ${error.message}`);
        }
      },
    });
  };

  const handlePickPhoto = async (file) => {
    try {
      const pending = await compressImage(file);
      setPhoto({ pending, remove: false });
    } catch (error) {
      message.error(error.message);
    }

    return false; // ไม่ให้ antd อัปโหลดเอง
  };

  const previewSrc = photo.remove
    ? null
    : photo.pending?.preview || editing?.photo_url || null;

  const columns = [
    {
      title: 'รูป',
      key: 'photo',
      width: 70,
      render: (_, record) => (
        <Avatar
          size={44}
          src={record.photo_url || undefined}
          icon={<UserOutlined />}
          style={{ cursor: 'pointer' }}
          onClick={() => setDetail(record)}
        />
      ),
    },

    ...(!isCommittee
      ? [
        {
          title: 'รหัสพนักงาน',
          dataIndex: 'employee_code',
          key: 'employee_code',
        },
      ]
      : []),

    {
      title: 'ชื่อ-นามสกุล',
      dataIndex: 'full_name',
      key: 'full_name',
      render: (value) => <Text strong>{value}</Text>,
    },
    {
      title: 'ตำแหน่งงาน',
      dataIndex: 'position',
      key: 'position',
    },
    {
      title: isCommittee ? 'หน่วยงาน' : 'แผนก',
      dataIndex: 'department',
      key: 'department',
      render: (value) => value || '-',
    },
    ...(isCommittee
      ? [
        {
          title: 'เริ่มวาระ',
          dataIndex: 'term_start',
          key: 'term_start',
          render: (value) =>
            value ? dayjs(value).format('DD/MM/YYYY') : '-',
        },
        {
          title: 'สิ้นสุดวาระ',
          dataIndex: 'term_end',
          key: 'term_end',
          render: (value) =>
            value ? dayjs(value).format('DD/MM/YYYY') : '-',
        },
      ]
      : []),
    {
      title: 'เบอร์โทร',
      dataIndex: 'phone',
      key: 'phone',
      render: (value) => value || '-',
    },
    {
      title: 'สถานะ',
      dataIndex: 'status',
      key: 'status',
      render: (value) => {
        const option = statusOptions.find(
          (item) => item.value === value
        );

        return (
          <Tag color={statusColor[value] || 'default'}>
            {option?.label || value}
          </Tag>
        );
      },
    },
    {
      title: 'จัดการ',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space>
          {canWrite && (
            <Button
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            />
          )}
          {canWrite && (
            <Button
              danger
              icon={<DeleteOutlined />}
              title={canDelete ? 'ลบ' : 'ขออนุมัติลบ'}
              onClick={() => deleteRecord(record)}
            />
          )}
        </Space>
      ),
    },
  ];

  const activeCount = records.filter(
    (record) => record.status === 'ACTIVE'
  ).length;

  const endingSoon = committees.filter((record) => {
    if (!record.term_end || record.status !== 'ACTIVE') {
      return false;
    }

    const days = dayjs(record.term_end).diff(dayjs(), 'day');

    return days >= 0 && days <= 60;
  }).length;

  return (
    <div style={{ padding: 4 }}>
      <div style={{ marginBottom: 2 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          บริหารทั่วไป
        </Title>

        <Text type="secondary">
          จัดการข้อมูลคณะกรรมการและพนักงาน
        </Text>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setSearch('');
          setStatusFilter('ALL');
          setDetail(null);
        }}
        items={[
          {
            key: 'committee',
            label: (
              <span>
                <TeamOutlined /> คณะกรรมการ
              </span>
            ),
          },
          {
            key: 'employee',
            label: (
              <span>
                <UserOutlined /> พนักงาน
              </span>
            ),
          },
          ...(showInspectorTab
            ? [{
              key: 'inspector-work',
              label: (
                <span>
                  <AuditOutlined /> งานผู้ตรวจ
                </span>
              ),
            }]
            : []),
        ]}
      />

      {activeTab === 'inspector-work' ? (
        <InspectorWork tick={tick} onNavigate={onNavigate} />
      ) : (
      <>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="รายการทั้งหมด"
              value={records.length}
            />
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title={isCommittee ? 'ดำรงตำแหน่ง' : 'ปฏิบัติงาน'}
              value={activeCount}
            />
          </Card>
        </Col>

        {isCommittee && (
          <Col xs={24} sm={8}>
            <Card>
              <Statistic
                title="ใกล้ครบวาระภายใน 60 วัน"
                value={endingSoon}
              />
            </Card>
          </Col>
        )}
      </Row>

      <Card>
        <Row
          gutter={[12, 12]}
          align="middle"
          justify="space-between"
          style={{ marginBottom: 20 }}
        >
          <Col xs={24} md={10}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="ค้นหาชื่อ ตำแหน่ง หรือหน่วยงาน"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </Col>

          <Col>
            <Space wrap>
              <Segmented
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: 'card', icon: <AppstoreOutlined />, label: 'การ์ด' },
                  { value: 'table', icon: <UnorderedListOutlined />, label: 'ตาราง' },
                ]}
              />

              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 160 }}
                options={[
                  { value: 'ALL', label: 'ทุกสถานะ' },
                  ...statusOptions,
                ]}
              />

              <Button
                icon={<ReloadOutlined />}
                onClick={loadData}
              >
                รีเฟรช
              </Button>

              {canWrite && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                >
                  {isCommittee
                    ? 'เพิ่มคณะกรรมการ'
                    : 'เพิ่มพนักงาน'}
                </Button>
              )}
            </Space>
          </Col>
        </Row>

        {viewMode === 'table' ? (
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={filteredRecords}
            scroll={{ x: 1000 }}
            pagination={{
              pageSize: 10,
              showTotal: (total) => `ทั้งหมด ${total} รายการ`,
            }}
          />
        ) : filteredRecords.length === 0 ? (
          <Empty description="ไม่พบข้อมูล" />
        ) : (
          <Row gutter={[16, 16]}>
            {filteredRecords.map((record) => {
              const option = statusOptions.find(
                (s) => s.value === record.status
              );

              return (
                <Col xs={12} sm={8} md={6} xl={4} key={record.id}>
                  <Card
                    hoverable
                    loading={loading}
                    onClick={() => setDetail(record)}
                    styles={{ body: { padding: 12, textAlign: 'center' } }}
                    cover={
                      record.photo_url ? (
                        <img
                          alt={record.full_name}
                          src={record.photo_url}
                          loading="lazy"
                          style={{ height: 200, objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            height: 200,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.04)',
                          }}
                        >
                          <UserOutlined style={{ fontSize: 64, opacity: 0.35 }} />
                        </div>
                      )
                    }
                  >
                    <Text strong ellipsis style={{ display: 'block' }}>
                      {record.full_name}
                    </Text>
                    <Text type="secondary" ellipsis style={{ display: 'block' }}>
                      {record.position || '-'}
                    </Text>
                    <Tag
                      color={statusColor[record.status] || 'default'}
                      style={{ marginTop: 8, marginInlineEnd: 0 }}
                    >
                      {option?.label || record.status}
                    </Tag>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>
      </>
      )}

      {/* รายละเอียด (กดการ์ด/รูปในตาราง) */}
      <Modal
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        title={detail?.full_name}
        width={560}
        destroyOnClose
        footer={
          canWrite ? (
            <Space>
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  const r = detail;
                  setDetail(null);
                  openEdit(r);
                }}
              >
                แก้ไข
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  const r = detail;
                  setDetail(null);
                  deleteRecord(r);
                }}
              >
                {canDelete ? 'ลบ' : 'ขออนุมัติลบ'}
              </Button>
            </Space>
          ) : null
        }
      >
        {detail && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              {detail.photo_url ? (
                <img
                  alt={detail.full_name}
                  src={detail.photo_url}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 360,
                    borderRadius: 8,
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <Avatar size={120} icon={<UserOutlined />} />
              )}
            </div>

            <Descriptions column={1} size="small" bordered>
              {!isCommittee && (
                <Descriptions.Item label="รหัสพนักงาน">
                  {detail.employee_code || '-'}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="ตำแหน่ง">
                {detail.position || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={isCommittee ? 'อาคาร / หน่วยงาน' : 'แผนก'}>
                {detail.department || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="เบอร์โทร">
                {detail.phone || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="อีเมล">
                {detail.email || '-'}
              </Descriptions.Item>
              {isCommittee && (
                <>
                  <Descriptions.Item label="เริ่มวาระ">
                    {detail.term_start
                      ? dayjs(detail.term_start).format('DD/MM/YYYY')
                      : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="สิ้นสุดวาระ">
                    {detail.term_end
                      ? dayjs(detail.term_end).format('DD/MM/YYYY')
                      : '-'}
                  </Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="สถานะ">
                <Tag color={statusColor[detail.status] || 'default'}>
                  {statusOptions.find((s) => s.value === detail.status)?.label ||
                    detail.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="หมายเหตุ">
                {detail.notes || '-'}
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Modal>

      {/* ฟอร์มเพิ่ม/แก้ไข */}
      <Modal
        title={
          `${editing ? 'แก้ไข' : 'เพิ่ม'}ข้อมูล` +
          (isCommittee ? 'คณะกรรมการ' : 'พนักงาน')
        }
        open={open}
        onCancel={() => setOpen(false)}
        onOk={saveRecord}
        confirmLoading={saving}
        okText="บันทึก"
        cancelText="ยกเลิก"
        width={700}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 20 }}
        >
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <Avatar
              size={110}
              src={previewSrc || undefined}
              icon={<UserOutlined />}
            />
            <div style={{ marginTop: 10 }}>
              <Space>
                <Upload
                  accept="image/jpeg,image/png,image/webp"
                  showUploadList={false}
                  beforeUpload={handlePickPhoto}
                >
                  <Button icon={<CameraOutlined />}>
                    {previewSrc ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
                  </Button>
                </Upload>
                {previewSrc && (
                  <Button
                    danger
                    onClick={() => setPhoto({ pending: null, remove: true })}
                  >
                    ลบรูป
                  </Button>
                )}
              </Space>
            </div>
          </div>

          <Row gutter={16}>
            {!isCommittee && (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="employee_code"
                  label="รหัสพนักงาน"
                  rules={[
                    {
                      required: true,
                      message: 'กรุณากรอกรหัสพนักงาน',
                    },
                  ]}
                >
                  <Input placeholder="เช่น EMP001" />
                </Form.Item>
              </Col>
            )}

            <Col xs={24} sm={12}>
              <Form.Item
                name="full_name"
                label="ชื่อ-นามสกุล"
                rules={[
                  {
                    required: true,
                    message: 'กรุณากรอกชื่อ-นามสกุล',
                  },
                ]}
              >
                <Input placeholder="ชื่อและนามสกุล" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="position"
                label="ตำแหน่ง"
                rules={[
                  {
                    required: true,
                    message: 'กรุณาระบุตำแหน่ง',
                  },
                ]}
              >
                {isCommittee ? (
                  <Select
                    mode="tags"
                    showSearch
                    allowClear
                    maxCount={1}
                    placeholder="เลือกตำแหน่งเดิม หรือพิมพ์ตำแหน่งใหม่"
                    options={COMMITTEE_ROLES.map((role) => ({
                      value: role,
                      label: role,
                    }))}
                    style={{ width: '100%' }}
                  />
                ) : (
                  <Input placeholder="เช่น เจ้าหน้าที่อาคาร" />
                )}
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="department"
                label={isCommittee ? 'อาคาร / หน่วยงาน' : 'แผนก'}
              >
                <Input placeholder="ระบุหน่วยงาน" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="เบอร์โทรศัพท์">
                <Input placeholder="เบอร์โทรศัพท์" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="email"
                label="อีเมล"
                rules={[
                  {
                    type: 'email',
                    message: 'รูปแบบอีเมลไม่ถูกต้อง',
                  },
                ]}
              >
                <Input placeholder="name@example.com" />
              </Form.Item>
            </Col>

            {isCommittee && (
              <>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="term_start"
                    label="วันที่เริ่มวาระ"
                  >
                    <DatePicker
                      format="DD/MM/YYYY"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12}>
                  <Form.Item
                    name="term_end"
                    label="วันที่สิ้นสุดวาระ"
                  >
                    <DatePicker
                      format="DD/MM/YYYY"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </>
            )}

            <Col xs={24} sm={12}>
              <Form.Item
                name="status"
                label="สถานะ"
                rules={[
                  {
                    required: true,
                    message: 'กรุณาเลือกสถานะ',
                  },
                ]}
              >
                <Select options={statusOptions} />
              </Form.Item>
            </Col>

            <Col span={24}>
              <Form.Item name="notes" label="หมายเหตุ">
                <Input.TextArea
                  rows={3}
                  placeholder="รายละเอียดเพิ่มเติม"
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
