import { useEffect, useState, useCallback } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Grid,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import dayjs from 'dayjs';
import { api, getToken } from './api.js';
import { useAccess, RESOURCE_MODULE } from './AccessContext.jsx';
import { askDeleteRequest } from './deleteRequest.jsx';

const { Text, Title, Paragraph } = Typography;

const opts = (field) =>
  (field.options || []).map(([value, label]) => ({ value, label }));

const approvalLabels = {
  pending: { text: 'ยังไม่ส่งงาน', color: 'default' },
  submitted: { text: 'รออนุมัติปิดงาน', color: 'gold' },
  approved: { text: 'อนุมัติแล้ว', color: 'green' },
  rejected: { text: 'รอแก้ไข', color: 'red' },
};

const statusLabels = {
  new: { text: 'ใหม่', color: 'blue' },
  doing: { text: 'กำลังซ่อม', color: 'processing' },
  done: { text: 'เสร็จแล้ว', color: 'success' },
};

export default function CrudPage({
  resource,
  title,
  fields,
  tick,
  summary,
  beforeContent,
  filterRows,
  defaultValues,
}) {
  const { message } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const isRepairs = resource === 'repairs';

  // สิทธิ์ตามบทบาท (ฝั่งเซิร์ฟเวอร์บังคับจริงอีกชั้น)
  const { can, access } = useAccess();
  const accessModule = RESOURCE_MODULE[resource];
  const canWrite = can(accessModule, 'write');
  const canDelete = can(accessModule, 'delete');
  const canApprove = can(accessModule, 'approve');

  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(20);

  const [rejectRecord, setRejectRecord] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalSaving, setApprovalSaving] = useState(false);

  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const data = await api('/' + resource);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];

      setRows(list);
    } catch (error) {
      message.error(error.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, [resource, message]);

  useEffect(() => {
    load();
  }, [load, tick]);

  // ผู้ตรวจที่เลือกได้ (ฟิลด์ type: 'inspector') ผู้ตรวจเห็นเฉพาะงานที่ได้รับมอบหมาย
  const needsInspectors = fields.some((field) => field.type === 'inspector');
  const [inspectors, setInspectors] = useState([]);
  const needsEmployees = fields.some((field) => ['employee', 'technician'].includes(field.type));
  const [employees, setEmployees] = useState([]);
  // รายชื่อคณะกรรมการใช้ทั้งช่องผู้แจ้งและผู้ตรวจงาน
  const needsCommittees = fields.some((field) => ['committee', 'inspector'].includes(field.type));
  const [committees, setCommittees] = useState([]);

  useEffect(() => {
    if (!needsInspectors || !accessModule) return;
    api(`/inspectors?module=${accessModule}`)
      .then((list) => setInspectors(Array.isArray(list) ? list : []))
      .catch(() => setInspectors([]));
  }, [needsInspectors, accessModule]);

  // รายชื่อพนักงานส่วนกลางที่ Admin ดูแลไว้ ใช้ร่วมกันในทุกหน้าที่ต้องเลือกผู้รับผิดชอบ
  useEffect(() => {
    if (!needsEmployees) return;
    api('/employee-options')
      .then((list) => {
        const active = (Array.isArray(list) ? list : [])
          .filter((item) => !item.status || String(item.status).toUpperCase() === 'ACTIVE')
          .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th'));
        setEmployees(active);
      })
      .catch((error) => {
        setEmployees([]);
        message.warning(error.message || 'โหลดรายชื่อพนักงานส่วนกลางไม่สำเร็จ');
      });
  }, [needsEmployees, message]);

  const employeeOptions = (currentValue) => {
    const options = employees.map((item) => ({
      value: item.full_name,
      label: [item.full_name, item.employee_code ? `(${item.employee_code})` : '', item.department || item.position || '']
        .filter(Boolean)
        .join(' · '),
    }));
    // ให้ข้อมูลเก่าที่เป็นพนักงานซึ่งถูกปิดใช้งานแล้วยังแสดงได้เมื่อเปิดแก้ไข
    if (currentValue && !options.some((item) => item.value === currentValue)) {
      options.unshift({ value: currentValue, label: `${currentValue} (ข้อมูลเดิม/ไม่อยู่ในรายชื่อที่ใช้งาน)` });
    }
    return options;
  };

  // ช่องผู้รับผิดชอบงานช่าง: แสดงเฉพาะพนักงานที่ตำแหน่งระบุว่าเป็นช่าง และแสดงเฉพาะชื่อ
  const technicianOptions = (currentValue) => {
    const options = employees
      .filter((item) => /ช่าง/.test(String(item.position || '')))
      .map((item) => ({ value: item.full_name, label: item.full_name }));
    if (currentValue && !options.some((item) => item.value === currentValue)) {
      options.unshift({ value: currentValue, label: `${currentValue} (ข้อมูลเดิม)` });
    }
    return options;
  };

  // รายชื่อคณะกรรมการสำหรับช่องผู้แจ้งซ่อม
  useEffect(() => {
    if (!needsCommittees) return;
    api('/committee-options')
      .then((list) => {
        const active = (Array.isArray(list) ? list : [])
          .filter((item) => !item.status || String(item.status).toUpperCase() === 'ACTIVE')
          .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th'));
        setCommittees(active);
      })
      .catch((error) => {
        setCommittees([]);
        message.warning(error.message || 'โหลดรายชื่อคณะกรรมการไม่สำเร็จ');
      });
  }, [needsCommittees, message]);

  const committeeOptions = (currentValue) => {
    const options = committees.map((item) => ({
      value: item.full_name,
      label: item.full_name,
    }));
    // คงชื่อผู้แจ้งของใบงานเก่าไว้ แม้บุคคลนั้นจะไม่ได้อยู่ในรายชื่อ ACTIVE แล้ว
    if (currentValue && !options.some((item) => item.value === currentValue)) {
      options.unshift({ value: currentValue, label: `${currentValue} (ข้อมูลเดิม/ไม่อยู่ในรายชื่อคณะกรรมการที่ใช้งาน)` });
    }
    return options;
  };

  const inspectorName = (username) => {
    const found = inspectors.find((item) => item.username === username);
    return found ? found.display_name || found.username : username;
  };

  // เปิดฟอร์มเพิ่มหรือแก้ไข โดยรองรับค่าเริ่มต้นจากหน้าที่เรียกใช้งาน
  const openForm = (record) => {
    form.resetFields();

    const init = {};

    fields.forEach((field) => {
      if (field.hideInForm) return;

      if (record) {
        init[field.key] = ['date', 'datetime'].includes(field.type)
          ? record[field.key]
            ? dayjs(record[field.key])
            : null
          : record[field.key];
      } else if (field.type === 'inspector') {
        init[field.key] = access?.role === 'inspector' ? access.username : undefined;
      } else if (field.options) {
        init[field.key] = field.options[0]?.[0];
      } else if (field.type === 'switch') {
        init[field.key] = true;
      } else if (field.type === 'date' && field.today) {
        init[field.key] = dayjs();
      }
    });

    // ค่าเริ่มต้นจากหน้าที่เรียกใช้ เช่น หมวดหมู่ที่เลือกในหน้า Store
    if (!record && defaultValues) {
      Object.assign(init, defaultValues);
    }

    form.setFieldsValue(init);
    setModal({ record });
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const body = {};

      fields.forEach((field) => {
        if (field.hideInForm) return;

        const value = values[field.key];

        body[field.key] =
          field.type === 'date'
            ? value?.format('YYYY-MM-DD') ?? null
            : field.type === 'datetime'
              ? value?.toISOString() ?? null
              : value ?? null;
      });

      setSaving(true);

      if (modal.record) {
        await api(`/${resource}/${modal.record.id}`, 'PUT', body);
      } else {
        await api('/' + resource, 'POST', body);
      }

      message.success('บันทึกข้อมูลเรียบร้อย');
      setModal(null);
      await load();
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id, data) => {
    try {
      await api(`/${resource}/${id}`, 'PUT', data);
      message.success('อัปเดตข้อมูลแล้ว');
      await load();
    } catch (error) {
      message.error(error.message || 'แก้ไขข้อมูลไม่สำเร็จ');
      await load();
    }
  };

  const remove = async (id) => {
    try {
      await api(`/${resource}/${id}`, 'DELETE');
      message.success('ลบรายการแล้ว');
      await load();
    } catch (error) {
      message.error(error.message || 'ลบข้อมูลไม่สำเร็จ');
    }
  };

  const approveRepair = (record) => {
    Modal.confirm({
      title: `อนุมัติปิดงานซ่อม #${record.id}`,
      content: (
        <div>
          <Paragraph style={{ marginBottom: 4 }}>
            <Text type="secondary">เรื่อง</Text>
            <br />
            <Text strong>{record.title || '-'}</Text>
          </Paragraph>
          <Paragraph style={{ marginBottom: 0 }}>
            <Text type="secondary">สถานที่</Text>
            <br />
            {record.location || '-'}
          </Paragraph>
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            เมื่ออนุมัติ งานจะเปลี่ยนเป็น "เสร็จแล้ว" และแจ้งผลเข้าไลน์
          </Paragraph>
        </div>
      ),
      okText: 'อนุมัติปิดงาน',
      cancelText: 'ยกเลิก',
      onOk: async () => {
        setApprovalSaving(true);
        try {
          await api(`/repairs/${record.id}/approval`, 'POST', {
            action: 'approve',
          });
          message.success(`อนุมัติปิดงาน #${record.id} แล้ว`);
          await load();
        } catch (error) {
          message.error(error.message || 'อนุมัติปิดงานไม่สำเร็จ');
          throw error;
        } finally {
          setApprovalSaving(false);
        }
      },
    });
  };

  const openReject = (record) => {
    setRejectRecord(record);
    setRejectReason('');
  };

  const rejectRepair = async () => {
    if (!rejectRecord) return;

    const reason = rejectReason.trim();

    if (!reason) {
      message.warning('กรุณาระบุเหตุผลที่ต้องแก้ไข');
      return;
    }

    setApprovalSaving(true);

    try {
      await api(`/repairs/${rejectRecord.id}/approval`, 'POST', {
        action: 'reject',
        reason,
      });

      message.success('ส่งงานกลับแก้ไขแล้ว');
      setRejectRecord(null);
      setRejectReason('');
      await load();
    } catch (error) {
      message.error(error.message || 'ส่งกลับแก้ไขไม่สำเร็จ');
    } finally {
      setApprovalSaving(false);
    }
  };

  const show = (field, record) => {
    const value = record[field.key];

    if (field.type === 'approval') {
      const approval =
        approvalLabels[value] || approvalLabels.pending;

      return (
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <Tag color={approval.color} style={{ marginInlineEnd: 0 }}>
            {approval.text}
          </Tag>

          {value === 'rejected' && record.rejection_reason && (
            <Tooltip title={record.rejection_reason}>
              <Text
                type="danger"
                ellipsis
                style={{ display: 'block', maxWidth: '100%', fontSize: 12 }}
              >
                <CloseCircleOutlined /> {record.rejection_reason}
              </Text>
            </Tooltip>
          )}

          {value === 'approved' && record.approved_by && (
            <Text
              type="secondary"
              ellipsis
              style={{ display: 'block', maxWidth: '100%', fontSize: 11 }}
            >
              ผู้อนุมัติ: {record.approved_by}
            </Text>
          )}
        </div>
      );
    }

    if (field.key === 'status' && isRepairs) {
      const status = statusLabels[value] || {
        text: value || '-',
        color: 'default',
      };

      return <Tag color={status.color}>{status.text}</Tag>;
    }

    if (field.key === 'category') {
      return record.category || '-';
    }

    if (field.type === 'verify') {
      const toggle = async (verified) => {
        try {
          await api(`/${resource}/${record.id}/verify`, 'POST', { verified });
          message.success(verified ? 'ตรวจสอบรายการแล้ว' : 'ยกเลิกการตรวจสอบแล้ว');
          load();
        } catch (err) {
          message.error(err.message);
        }
      };

      return record.verified ? (
        <div>
          <Tag color="green">ตรวจสอบแล้ว</Tag>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
            โดย {record.verified_by || '-'}
            {record.verified_at ? ` · ${dayjs(record.verified_at).format('DD/MM/YY HH:mm')}` : ''}
          </div>
          {canApprove && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => toggle(false)}>
              ยกเลิกการตรวจสอบ
            </Button>
          )}
        </div>
      ) : (
        <Space size={6}>
          <Tag color="warning">รอตรวจสอบ</Tag>
          {canApprove && (
            <Button size="small" type="primary" onClick={() => toggle(true)}>
              ตรวจสอบ
            </Button>
          )}
        </Space>
      );
    }

    if (field.type === 'inspector') {
      return value ? inspectorName(value) : <Tag color="warning">ยังไม่มอบหมาย</Tag>;
    }

    if (field.type === 'switch') {
      return (
        <Switch
          size="small"
          disabled={!canWrite}
          checked={Boolean(value)}
          onChange={(nextValue) =>
            patch(record.id, { [field.key]: nextValue })
          }
        />
      );
    }

    if (field.type === 'profit') {
      const profit = Number(record.revenue) - Number(record.cost);

      return (
        <Text strong type={profit < 0 ? 'danger' : undefined}>
          {profit.toLocaleString()}
        </Text>
      );
    }

    if (field.type === 'images') {
      const list = Array.isArray(value) ? value : [];

      if (!list.length) return '-';

      const MAX_THUMBS = 3;

      return (
        <Image.PreviewGroup>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'nowrap',
              overflow: 'hidden',
              maxWidth: '100%',
            }}
          >
            {list.slice(0, MAX_THUMBS).map((url, index) => (
              <Image
                key={`${url}-${index}`}
                src={`${url}${url.includes('?') ? '&' : '?'}token=${getToken()}`}
                width={36}
                height={36}
                style={{ objectFit: 'cover', borderRadius: 5, flexShrink: 0 }}
              />
            ))}
            {list.length > MAX_THUMBS && (
              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                +{list.length - MAX_THUMBS}
              </Text>
            )}
          </div>
        </Image.PreviewGroup>
      );
    }

    if (field.type === 'datetime' || field.type === 'date') {
      if (!value) return '-';

      const date = dayjs(value);
      const late =
        field.dueDate &&
        record.status !== 'done' &&
        date.isBefore(dayjs());

      return (
        <Text type={late ? 'danger' : undefined}>
          {date.format(field.type === 'date' ? 'DD/MM/YY' : 'DD/MM/YY HH:mm')}
          {field.dueDate && late ? ' · เลยกำหนด' : ''}
        </Text>
      );
    }

    if (field.type === 'number') {
      return value === null || value === undefined || value === ''
        ? '-'
        : Number(value).toLocaleString();
    }

    return value === null || value === undefined || value === ''
      ? '-'
      : String(value);
  };

  const actions = (record, { nowrap = false } = {}) => {
    const pending = isRepairs && canApprove && record.approval_status === 'submitted';

    return (
      <Space
        size={4}
        wrap={!nowrap}
        style={nowrap ? { flexWrap: 'nowrap' } : undefined}
      >
        {pending && (
          <>
            <Tooltip title="อนุมัติปิดงาน">
              <Button
                size="small"
                type="primary"
                ghost
                icon={<CheckCircleOutlined />}
                disabled={approvalSaving}
                onClick={() => approveRepair(record)}
                aria-label="อนุมัติปิดงาน"
              />
            </Tooltip>

            <Tooltip title="ส่งกลับแก้ไข">
              <Button
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                disabled={approvalSaving}
                onClick={() => openReject(record)}
                aria-label="ส่งกลับแก้ไข"
              />
            </Tooltip>
          </>
        )}

        {canWrite && (
          <Tooltip title="แก้ไข">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openForm(record)}
              aria-label="แก้ไข"
            />
          </Tooltip>
        )}

        {canDelete && (
          <Popconfirm
            title="ลบรายการนี้?"
            description="เมื่อลบแล้วจะไม่สามารถกู้คืนจากหน้านี้ได้"
            okText="ลบ"
            cancelText="ยกเลิก"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove(record.id)}
          >
            <Tooltip title="ลบ">
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label="ลบ"
              />
            </Tooltip>
          </Popconfirm>
        )}

        {!canDelete && canWrite && (
          <Tooltip title="ขออนุมัติลบ (ส่งให้ผู้ตรวจ)">
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label="ขออนุมัติลบ"
              onClick={() =>
                askDeleteRequest({
                  message,
                  table: resource,
                  recordId: record.id,
                  label: record.title || record.full_name || record.name || record.plate || record.student || `#${record.id}`,
                })
              }
            />
          </Tooltip>
        )}
      </Space>
    );
  };

  const approvalField = {
    key: 'approval_status',
    label: 'ผลอนุมัติ',
    type: 'approval',
    hideInForm: true,
  };

  const tableFields = [
    ...fields.filter((field) => !field.hideInTable),
    ...(isRepairs ? [approvalField] : []),
  ];

  const KEY_WIDTH = {
    title: 220,
    location: 150,
    status: 110,
    approval_status: 170,
    rejection_reason: 200,
    reporter: 120,
    assignee: 130,
    done_photos: 150,
  };

  const widthOf = (field) =>
    field.width ??
    KEY_WIDTH[field.key] ??
    (field.type === 'datetime'
      ? 140
      : field.type === 'date'
        ? 110
        : field.type === 'switch'
          ? 90
          : field.options
            ? 130
            : 120);

  const actionWidth = isRepairs ? 130 : 90;

  const columns = [
    ...tableFields.map((field) => ({
      title: field.label,
      dataIndex: field.key,
      key: field.key,
      width: widthOf(field),
      ellipsis: !['images', 'approval', 'switch'].includes(field.type),
      render: (_, record) => show(field, record),
    })),
    {
      title: 'จัดการ',
      key: 'act',
      fixed: 'right',
      width: actionWidth,
      render: (_, record) => actions(record, { nowrap: true }),
    },
  ];

  const tableScrollX =
    tableFields.reduce((sum, field) => sum + widthOf(field), 0) + actionWidth;

  const formField = (field) => {
    const rules = field.required
      ? [{ required: true, message: `กรุณากรอก${field.label}` }]
      : [];

    let input = <Input />;


    if (field.type === 'inspector') {
      const locked =
        access?.role === 'inspector' ||
        (Boolean(modal?.record) && !access?.is_admin);

      input = (
        <Select
          showSearch
          allowClear={!locked}
          disabled={locked}
          placeholder={
            inspectors.length
              ? 'เลือกผู้ตรวจงาน'
              : 'ไม่พบรายชื่อผู้ตรวจงาน'
          }
          optionFilterProp="label"
          options={inspectors.map((item) => {
            const username = String(item.username || '').trim();
            const displayName = String(
              item.display_name || username
            ).trim();

            const committee = committees.find(
              (person) =>
                String(person.full_name || '').trim() ===
                displayName
            );

            return {
              // ต้องเก็บ username เพื่อให้ระบบตรวจสอบสิทธิ์ได้
              value: item.username,
              label: committee?.full_name || displayName,
            };
          })}
          notFoundContent="ไม่พบรายชื่อผู้ตรวจงาน"
        />
      );
    }
    else if (field.type === 'employee' || field.type === 'technician') {
      const isTechnician = field.type === 'technician';
      const options = isTechnician
        ? technicianOptions(modal?.record?.[field.key])
        : employeeOptions(modal?.record?.[field.key]);
      input = (
        <Select
          showSearch
          allowClear
          placeholder={isTechnician
            ? (options.length ? 'เลือกผู้รับผิดชอบตำแหน่งช่าง' : 'ไม่พบพนักงานตำแหน่งช่าง')
            : (employees.length ? 'เลือกพนักงานจากข้อมูลส่วนกลาง' : 'ไม่พบรายชื่อพนักงานที่ใช้งาน')}
          optionFilterProp="label"
          options={options}
          notFoundContent={isTechnician ? 'ไม่พบพนักงานตำแหน่งช่าง' : 'ไม่พบพนักงานที่ตรงกัน'}
        />
      );
    } else if (field.type === 'committee') {
      input = (
        <Select
          showSearch
          allowClear
          placeholder={committees.length ? 'เลือกผู้แจ้งจากรายชื่อคณะกรรมการ' : 'ไม่พบรายชื่อคณะกรรมการที่ใช้งาน'}
          optionFilterProp="label"
          options={committeeOptions(modal?.record?.[field.key])}
          notFoundContent="ไม่พบคณะกรรมการที่ตรงกัน"
        />
      );
    } else if (field.options) {
      input = <Select options={opts(field)} />;
    } else if (field.type === 'number') {
      input = <InputNumber style={{ width: '100%' }} min={0} />;
    } else if (field.type === 'date') {
      input = (
        <DatePicker
          style={{ width: '100%' }}
          format="DD/MM/YYYY"
        />
      );
    } else if (field.type === 'datetime') {
      input = (
        <DatePicker
          showTime={{ format: 'HH:mm', minuteStep: 5 }}
          style={{ width: '100%' }}
          format="DD/MM/YYYY HH:mm"
        />
      );
    } else if (field.type === 'textarea') {
      input = <Input.TextArea rows={2} maxLength={3000} showCount />;
    } else if (field.type === 'switch') {
      input = <Switch />;
    }

    return (
      <Col
        key={field.key}
        xs={24}
        sm={field.type === 'textarea' ? 24 : 12}
      >
        <Form.Item
          name={field.key}
          label={field.label}
          rules={rules}
          valuePropName={field.type === 'switch' ? 'checked' : 'value'}
          style={{ marginBottom: 14 }}
        >
          {input}
        </Form.Item>
      </Col>
    );
  };

  const pendingCount = isRepairs
    ? (rows || []).filter((row) => row.approval_status === 'submitted').length
    : 0;

  // กรองข้อมูลก่อนแสดงทั้งในตารางและบนมือถือ
  const displayRows = (rows || []).filter(
    (record) => !filterRows || filterRows(record)
  );

  return (
    <section
      className="grid gap-3"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr)',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {title}
          </Title>

          <Space size={8} wrap style={{ marginTop: 3 }}>
            {rows !== null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                ทั้งหมด {rows.length.toLocaleString()} รายการ
              </Text>
            )}

            {isRepairs && pendingCount > 0 && (
              <Tag color="gold">รออนุมัติปิดงาน {pendingCount}</Tag>
            )}

            {summary && rows && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {summary(rows)}
              </Text>
            )}
          </Space>
        </div>

        <Space size={8}>
          <Tooltip title="รีเฟรชข้อมูล">
            <Button
              icon={<ReloadOutlined />}
              onClick={load}
              aria-label="รีเฟรช"
            />
          </Tooltip>

          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openForm()}
            >
              เพิ่มรายการ
            </Button>
          )}
        </Space>
      </div>

      {/* เนื้อหาเพิ่มเติมของแต่ละหน้า เช่น การ์ดหมวดหมู่และตัวกรอง */}
      {beforeContent && rows !== null && beforeContent({ rows, reload: load })}

      {isMobile ? (
        rows === null ? (
          <Skeleton active />
        ) : displayRows.length === 0 ? (
          <Empty description="ไม่พบข้อมูลตามตัวกรอง" />
        ) : (
          <div className="grid gap-2">
            {displayRows.slice(0, limit).map((record) => (
              <Card
                key={record.id}
                size="small"
                styles={{ body: { padding: 12 } }}
                style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}
                title={
                  <Text
                    strong
                    style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
                  >
                    {record.title || record.name || `รายการ #${record.id}`}
                  </Text>
                }
                extra={actions(record)}
              >
                {tableFields
                  .filter((field) => field.key !== 'title')
                  .map((field) => (
                    <div
                      key={field.key}
                      className="flex items-start justify-between gap-3 py-1"
                    >
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >
                        {field.label}
                      </Text>
                      <div
                        style={{
                          textAlign: 'right',
                          minWidth: 0,
                          flex: 1,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {show(field, record)}
                      </div>
                    </div>
                  ))}
              </Card>
            ))}

            {displayRows.length > limit && (
              <Button block onClick={() => setLimit((value) => value + 20)}>
                ดูเพิ่ม
              </Button>
            )}
          </div>
        )
      ) : (
        <Card
          size="small"
          style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}
          styles={{ body: { padding: 0 } }}
        >
          <Table
            rowKey="id"
            size="small"
            loading={rows === null}
            dataSource={displayRows}
            columns={columns}
            tableLayout="fixed"
            scroll={{ x: tableScrollX }}
            pagination={{
              pageSize: 10,
              hideOnSinglePage: true,
              showSizeChanger: false,
              size: 'small',
              showTotal: (total) => `${total} รายการ`,
            }}
            locale={{
              emptyText: <Empty description="ไม่พบข้อมูลตามตัวกรอง" />,
            }}
          />
        </Card>
      )}

      <Modal
        open={!!modal}
        forceRender
        title={modal?.record ? `แก้ไข${title}` : `เพิ่ม${title}`}
        okText="บันทึก"
        cancelText="ยกเลิก"
        confirmLoading={saving}
        onOk={submit}
        onCancel={() => setModal(null)}
        width={isMobile ? 'calc(100vw - 20px)' : 620}
        style={isMobile ? { top: 10 } : undefined}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" size="middle">
          <Row gutter={12}>
            {fields
              .filter((field) => !field.hideInForm)
              .map(formField)}
          </Row>
        </Form>
      </Modal>

      <Modal
        open={!!rejectRecord}
        title={
          <Space>
            <CloseCircleOutlined style={{ color: '#cf1322' }} />
            ส่งงานกลับแก้ไข #{rejectRecord?.id || ''}
          </Space>
        }
        okText="ยืนยันส่งกลับแก้ไข"
        cancelText="ยกเลิก"
        okButtonProps={{ danger: true }}
        confirmLoading={approvalSaving}
        onOk={rejectRepair}
        onCancel={() => {
          if (!approvalSaving) {
            setRejectRecord(null);
            setRejectReason('');
          }
        }}
        width={isMobile ? 'calc(100vw - 20px)' : 480}
        destroyOnHidden
      >
        <Paragraph style={{ marginBottom: 12 }}>
          <Text type="secondary">เรื่องที่แจ้ง</Text>
          <br />
          <Text strong>{rejectRecord?.title || '-'}</Text>
        </Paragraph>

        <Form layout="vertical">
          <Form.Item
            label="เหตุผลที่ต้องแก้ไข"
            required
            help="เหตุผลนี้จะแจ้งเข้าไลน์ ผู้รับผิดชอบต้องแก้ไขแล้วส่งงานใหม่อีกครั้ง"
          >
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              placeholder="ระบุสิ่งที่ต้องแก้ไขให้ชัดเจน..."
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}