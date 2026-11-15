-- สโตร์ยาห้องพยาบาล (รันซ้ำได้) — psql -f schema-medicine.sql
-- หมายเหตุ: คอลัมน์ข้อความไม่ใส่ NOT NULL เพราะ CRUD ของระบบแปลงค่าว่าง '' เป็น NULL ก่อนบันทึก
CREATE TABLE IF NOT EXISTS medicines (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT DEFAULT '',
  unit       TEXT DEFAULT 'เม็ด',
  qty        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  min_qty    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  lot        TEXT DEFAULT '',
  expiry     DATE,
  location   TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medicines_name_idx   ON medicines (name);
CREATE INDEX IF NOT EXISTS medicines_expiry_idx ON medicines (expiry) WHERE expiry IS NOT NULL;

-- ประวัติรับเข้า / จ่ายออก / ปรับยอด (ลบยาแล้วประวัติยังอยู่ เพราะเก็บชื่อยาไว้)
CREATE TABLE IF NOT EXISTS medicine_logs (
  id            BIGSERIAL PRIMARY KEY,
  medicine_id   INTEGER REFERENCES medicines(id) ON DELETE SET NULL,
  medicine_name TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('in', 'out', 'adjust')),
  qty           NUMERIC(12,2) NOT NULL,          -- in/out = จำนวนที่เคลื่อนไหว, adjust = ยอดใหม่
  balance       NUMERIC(12,2) NOT NULL CHECK (balance >= 0),  -- ยอดคงเหลือหลังทำรายการ
  student       TEXT,
  class_room    TEXT,
  visit_id      INTEGER REFERENCES nurse_visits(id) ON DELETE SET NULL,
  note          TEXT DEFAULT '',
  by_user       TEXT DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT medicine_logs_qty_chk CHECK (
    (kind = 'adjust' AND qty >= 0) OR (kind IN ('in', 'out') AND qty > 0)
  )
);
CREATE INDEX IF NOT EXISTS medicine_logs_created_idx  ON medicine_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS medicine_logs_medicine_idx ON medicine_logs (medicine_id);
CREATE INDEX IF NOT EXISTS medicine_logs_visit_idx    ON medicine_logs (visit_id) WHERE visit_id IS NOT NULL;