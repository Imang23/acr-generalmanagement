-- ใบงานซ่อม: มอบหมายงาน + กำหนดส่ง + รูปที่ส่งกลับทางไลน์
-- ทุกคำสั่งรันซ้ำได้ ต่อท้ายไฟล์ schema.sql เดิมแล้วรัน migrate ได้เลย
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS assignee    text;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS due_date    date;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS done_at     timestamptz;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS done_photos jsonb NOT NULL DEFAULT '[]';
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS wo_sent_at  timestamptz;

CREATE TABLE IF NOT EXISTS repair_photos (
  id         serial PRIMARY KEY,
  repair_id  int NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
