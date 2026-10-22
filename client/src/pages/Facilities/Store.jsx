import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  PlusOutlined,
  SearchOutlined,
  ToolOutlined,
  EditOutlined,
  DeleteOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import CrudPage from '../../CrudPage';

const { Text, Title } = Typography;

const STORAGE_KEY = 'acr_store_categories_v1';

const DEFAULT_CATEGORIES = [
  'วัสดุสำนักงาน',
  'วัสดุไฟฟ้า',
  'เครื่องมือช่าง',
  'อุปกรณ์ซ่อมบำรุง',
  'อุปกรณ์ประปา',
  'อุปกรณ์คอมพิวเตอร์',
  'วัสดุทำความสะอาด',
  'อุปกรณ์ความปลอดภัย',
  'วัสดุก่อสร้าง',
  'อื่น ๆ',
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'normal', label: 'ปกติ' },
  { value: 'low', label: 'ใกล้หมด' },
  { value: 'out', label: 'หมดสต็อก' },
];

function loadCategories() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed)) {
        return [...new Set(
          parsed.filter(
            (item) => typeof item === 'string' && item.trim()
          )
        )];
      }
    }
  } catch (error) {
    console.error('โหลดหมวดหมู่ไม่สำเร็จ', error);
  }

  return DEFAULT_CATEGORIES;
}

function saveCategories(categories) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
}

function getStockStatus(item) {
  const qty = Number(item.qty ?? 0);
  const minQty = Number(item.min_qty ?? 0);

  if (qty <= 0) return 'out';
  if (minQty > 0 && qty <= minQty) return 'low';

  return 'normal';
}

const stockLabels = {
  normal: { text: 'ปกติ', color: 'success' },
  low: { text: 'ใกล้หมด', color: 'warning' },
  out: { text: 'หมดสต็อก', color: 'error' },
};

export default function Store({ tick }) {
  const { message } = App.useApp();

  const [categories, setCategories] = useState(loadCategories);
  const [selectedCategory, setSelectedCategory] = useState('ทั้งหมด');
  const [keyword, setKeyword] = useState('');
  const [stockStatus, setStockStatus] = useState('all');

  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryName, setCategoryName] = useState('');

  const categoryOptions = useMemo(
    () => categories.map((name) => [name, name]),
    [categories]
  );

  useEffect(() => {
    try {
      saveCategories(categories);
    } catch (error) {
      message.error('บันทึกหมวดหมู่ในเครื่องไม่สำเร็จ');
    }
  }, [categories, message]);

  const fields = useMemo(
    () => [
      {
        key: 'name',
        label: 'ชื่อพัสดุ / วัสดุ',
        required: true,
        width: 220,
      },
      {
        key: 'category',
        label: 'หมวดหมู่',
        options: categoryOptions,
        required: true,
        width: 100,
      },
      {
        key: 'qty',
        label: 'คงเหลือ',
        type: 'number',
        width: 100,
      },
      {
        key: 'unit',
        label: 'หน่วย',
        width: 90,
      },
      {
        key: 'min_qty',
        label: 'จุดสั่งซื้อขั้นต่ำ',
        type: 'number',
        width: 130,
      },
      {
        key: 'location',
        label: 'ที่เก็บ',
        width: 140,
      },
      {
        key: 'note',
        label: 'หมายเหตุ',
        type: 'textarea',
        hideInTable: true,
      },
      {
        key: 'updated_at',
        label: 'อัปเดตล่าสุด',
        type: 'datetime',
        hideInForm: true,
      },
    ],
    [categoryOptions]
  );

  const filterRows = (item) => {
    const matchesCategory =
      selectedCategory === 'ทั้งหมด'
        ? true
        : selectedCategory === 'ยังไม่จัดหมวดหมู่'
          ? !String(item.category || '').trim()
          : item.category === selectedCategory;

    const search = keyword.trim().toLowerCase();

    const matchesKeyword =
      !search ||
      [
        item.name,
        item.category,
        item.location,
        item.unit,
        item.note,
      ].some((value) =>
        String(value ?? '').toLowerCase().includes(search)
      );

    const matchesStatus =
      stockStatus === 'all' ||
      getStockStatus(item) === stockStatus;

    return matchesCategory && matchesKeyword && matchesStatus;
  };

  const addCategory = () => {
    setEditingCategory(null);
    setCategoryName('');
    setCategoryModal(true);
  };

  const editCategory = (name) => {
    setEditingCategory(name);
    setCategoryName(name);
    setCategoryModal(true);
  };

  const submitCategory = () => {
    const name = categoryName.trim();

    if (!name) {
      message.warning('กรุณากรอกชื่อหมวดหมู่');
      return;
    }

    const duplicate = categories.some(
      (item) =>
        item.toLocaleLowerCase() === name.toLocaleLowerCase() &&
        item !== editingCategory
    );

    if (duplicate) {
      message.warning('มีหมวดหมู่นี้แล้ว');
      return;
    }

    if (editingCategory) {
      setCategories((previous) =>
        previous.map((item) =>
          item === editingCategory ? name : item
        )
      );

      if (selectedCategory === editingCategory) {
        setSelectedCategory(name);
      }

      message.success(
        'แก้ไขชื่อหมวดหมู่แล้ว หากมีพัสดุเดิม ต้องย้ายหมวดในรายการพัสดุให้ตรงกันด้วย'
      );
    } else {
      setCategories((previous) => [...previous, name]);
      message.success('เพิ่มหมวดหมู่แล้ว');
    }

    setCategoryModal(false);
    setCategoryName('');
    setEditingCategory(null);
  };

  const deleteCategory = (name) => {
    // ไม่ลบหมวดหมู่ที่ยังถูกเลือกอยู่ในหน้าจอ
    // การตรวจสอบข้อมูลพัสดุทั้งหมดต้องทำที่ API ฝั่งเซิร์ฟเวอร์
    setCategories((previous) => previous.filter((item) => item !== name));

    if (selectedCategory === name) {
      setSelectedCategory('ทั้งหมด');
    }

    message.success('ลบหมวดหมู่ออกจากรายการในเครื่องแล้ว');
  };

  const beforeContent = ({ rows }) => {
    const data = rows || [];

    const categoryCounts = (category) =>
      data.filter((item) =>
        category === 'ทั้งหมด'
          ? true
          : category === 'ยังไม่จัดหมวดหมู่'
            ? !String(item.category || '').trim()
            : item.category === category
      );

    const getCounts = (items) => ({
      items: items.length,
      qty: items.reduce(
        (sum, item) => sum + Math.max(0, Number(item.qty ?? 0)),
        0
      ),
      low: items.filter(
        (item) => getStockStatus(item) === 'low'
      ).length,
      out: items.filter(
        (item) => getStockStatus(item) === 'out'
      ).length,
    });

    const unclassified = data.some(
      (item) => !String(item.category || '').trim()
    );

    const cards = [
      'ทั้งหมด',
      ...categories,
      ...(unclassified ? ['ยังไม่จัดหมวดหมู่'] : []),
    ];

    const total = getCounts(data);

    return (
      <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="รายการพัสดุ"
                value={total.items}
                prefix={<InboxOutlined />}
              />
            </Card>
          </Col>

          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="จำนวนคงเหลือรวม"
                value={total.qty}
              />
            </Card>
          </Col>

          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="รายการใกล้หมด"
                value={total.low}
                valueStyle={{ color: '#d48806' }}
              />
            </Card>
          </Col>

          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="หมดสต็อก"
                value={total.out}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
        </Row>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <Title level={5} style={{ margin: 0 }}>
              <AppstoreOutlined /> หมวดหมู่พัสดุ
            </Title>
            <Text type="secondary">
              เลือกหมวดเพื่อดูเฉพาะพัสดุในหมวดนั้น
            </Text>
          </div>

          <Button
            icon={<PlusOutlined />}
            onClick={addCategory}
          >
            จัดการหมวดหมู่
          </Button>
        </div>

        <Row gutter={[12, 12]}>
          {cards.map((category) => {
            const counts = getCounts(categoryCounts(category));
            const active = selectedCategory === category;

            return (
              <Col xs={12} sm={8} lg={6} xl={4} key={category}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => setSelectedCategory(category)}
                  style={{
                    height: '100%',
                    borderColor: active ? '#1677ff' : undefined,
                    background: active ? '#f0f7ff' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <AppstoreOutlined
                      style={{
                        fontSize: 22,
                        color: active ? '#1677ff' : '#8c8c8c',
                      }}
                    />

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text
                        strong
                        style={{
                          display: 'block',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {category}
                      </Text>

                      <Title level={4} style={{ margin: '8px 0 0' }}>
                        {counts.items}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {' '}รายการ
                        </Text>
                      </Title>

                      <Text type="secondary" style={{ fontSize: 12 }}>
                        คงเหลือ {counts.qty.toLocaleString()} หน่วย
                      </Text>
                    </div>
                  </div>

                  {category !== 'ทั้งหมด' && (
                    <div style={{ marginTop: 10 }}>
                      <Space size={4} wrap>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={(event) => {
                            event.stopPropagation();
                            editCategory(category);
                          }}
                          aria-label={`แก้ไข ${category}`}
                        />

                        <Popconfirm
                          title="ลบหมวดหมู่นี้?"
                          description="ต้องตรวจสอบก่อนว่ามีพัสดุใช้หมวดนี้อยู่หรือไม่"
                          okText="ลบ"
                          cancelText="ยกเลิก"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => deleteCategory(category)}
                          onCancel={(event) => event?.stopPropagation?.()}
                        >
                          <Button
                            size="small"
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`ลบ ${category}`}
                          />
                        </Popconfirm>
                      </Space>
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>

        <Card size="small">
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} md={10}>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="ค้นหาชื่อพัสดุ ที่เก็บ หรือหมายเหตุ..."
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </Col>

            <Col xs={24} md={6}>
              <Select
                style={{ width: '100%' }}
                value={stockStatus}
                options={STATUS_OPTIONS}
                onChange={setStockStatus}
                placeholder="กรองสถานะ"
              />
            </Col>

            <Col xs={24} md={8}>
              <Space wrap>
                <Tag color="blue">
                  {selectedCategory}
                </Tag>

                <Text type="secondary">
                  พบ {data.filter(filterRows).length} รายการ
                </Text>

                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setKeyword('');
                    setStockStatus('all');
                    setSelectedCategory('ทั้งหมด');
                  }}
                >
                  ล้างตัวกรอง
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>
      </div>
    );
  };

  return (
    <>
      <CrudPage
        resource="store_items"
        title="คลังพัสดุ"
        fields={fields}
        tick={tick}
        beforeContent={beforeContent}
        filterRows={filterRows}
        defaultValues={
          selectedCategory !== 'ทั้งหมด' &&
          selectedCategory !== 'ยังไม่จัดหมวดหมู่'
            ? { category: selectedCategory }
            : {}
        }
      />

      <Modal
        open={categoryModal}
        title={editingCategory ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        onOk={submitCategory}
        onCancel={() => setCategoryModal(false)}
        destroyOnHidden
      >
        <Form layout="vertical" onFinish={submitCategory}>
          <Form.Item label="ชื่อหมวดหมู่" required>
            <Input
              autoFocus
              maxLength={100}
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              onPressEnter={submitCategory}
              placeholder="เช่น อุปกรณ์เครื่องมือวัด"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}