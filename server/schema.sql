-- ตารางหลัก
CREATE TABLE IF NOT EXISTS repairs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  location TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',      -- new | doing | done
  reporter TEXT DEFAULT '',
  source TEXT DEFAULT 'web',               -- web | line
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS canteen (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  reporter TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate TEXT NOT NULL,
  name TEXT DEFAULT '',
  driver TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available', -- available | in_use | repair
  mileage INTEGER DEFAULT 0,
  next_service DATE,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT DEFAULT ''
);

-- โรงอาหาร: บันทึกได้หลายรายการต่อวัน -> ถอด UNIQUE ที่คุมคอลัมน์ date ออก (รันซ้ำได้)
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'canteen' AND con.contype = 'u'
      AND (SELECT array_agg(att.attname::text)
             FROM unnest(con.conkey) AS k
             JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k) = ARRAY['date']
  LOOP
    EXECUTE format('ALTER TABLE canteen DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS canteen_date_idx ON canteen (date);

-- ใบงานซ่อม: มอบหมายงาน + กำหนดส่ง + รูปที่ส่งกลับทางไลน์
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS assignee    text;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS due_date    timestamptz;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS done_at     timestamptz;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS done_photos jsonb NOT NULL DEFAULT '[]';
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS wo_sent_at  timestamptz;

-- กำหนดส่งแบบมีเวลา: แปลงคอลัมน์เดิม (date -> timestamptz) ครั้งเดียว ข้อมูลเก่าตั้งเป็น 17:00 น.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'repairs' AND column_name = 'due_date' AND data_type = 'date') THEN
    ALTER TABLE repairs ALTER COLUMN due_date TYPE timestamptz
      USING ((due_date + time '17:00') AT TIME ZONE 'Asia/Bangkok');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS repair_photos (
  id         serial PRIMARY KEY,
  repair_id  int NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ผู้ใช้ระบบ: โปรไฟล์ (ตำแหน่ง เบอร์ติดต่อ รูป) และรหัสผ่านที่เปลี่ยนในระบบ
-- password_hash เป็น NULL = ยังใช้ ADMIN_USER / ADMIN_PASS จาก .env
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name  TEXT NOT NULL DEFAULT '',
  job_title     TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  line_id       TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  avatar_mime   TEXT,
  avatar_data   BYTEA,
  avatar_v      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- สุขอนามัยและพยาบาล
CREATE TABLE IF NOT EXISTS nurse_visits (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  student    TEXT NOT NULL,
  class_room TEXT DEFAULT NULL,
  symptom    TEXT NOT NULL,
  treatment  TEXT DEFAULT NULL,
  status     TEXT NOT NULL DEFAULT 'treated',  -- treated | rest | referred | home
  reporter   TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nurse_visits_date_idx ON nurse_visits (date DESC);

CREATE TABLE IF NOT EXISTS health_checks (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  student    TEXT NOT NULL,
  class_room TEXT DEFAULT NULL,
  weight     NUMERIC(5,1),
  height     NUMERIC(5,1),
  note       TEXT DEFAULT NULL,
  reporter   TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_checks_date_idx ON health_checks (date DESC);

-- อาคาร
CREATE TABLE IF NOT EXISTS buildings (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  location    TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',   -- active | inactive
  created_at  TIMESTAMPTZ DEFAULT now()
);
INSERT INTO buildings (code, name, location, description, status) VALUES
  ('BLD-001', 'อาคารที่ 1', 'สำนักงานใหญ่', 'อาคารสำนักงานหลัก', 'active'),
  ('BLD-002', 'อาคารที่ 2', 'อาคารสำนักงาน', 'อาคารสำนักงานทั่วไป', 'active'),
  ('BLD-003', 'อาคารที่ 3', 'พื้นที่ปฏิบัติงาน', 'อาคารสำหรับปฏิบัติงาน', 'inactive')
ON CONFLICT (code) DO NOTHING;
-- เพิ่มคอลัมน์สำหรับรูปอาคาร
ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS image_mime TEXT,
  ADD COLUMN IF NOT EXISTS image_data BYTEA,
  ADD COLUMN IF NOT EXISTS image_v INTEGER NOT NULL DEFAULT 0;
-- สโตร์ / พัสดุ
CREATE TABLE IF NOT EXISTS store_items (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT DEFAULT '',
  qty        NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit       TEXT DEFAULT '',
  min_qty    NUMERIC(12,2) NOT NULL DEFAULT 0,
  location   TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- อนุมัติปิดงานซ่อม: pending (ยังไม่ส่งงาน) | submitted (ส่งงานแล้วรออนุมัติ) | approved (ปิดงาน) | rejected (ส่งกลับแก้ไข) (รันซ้ำได้)
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending';
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS rejection_reason text;

UPDATE repairs SET approval_status = 'pending'
WHERE approval_status IS NULL OR approval_status = '';

-- ย้ายขั้นตอนเดิม (อนุมัติก่อนทำ) มาเป็นอนุมัติตอนส่งงาน/ปิดงาน
-- รันเพียงครั้งเดียว บันทึกไว้ใน schema_migrations จึงรัน schema.sql ซ้ำได้โดยไม่ล้างสถานะที่เกิดใหม่
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = 'completion_approval') THEN
    -- งานเดิมที่ยังไม่เสร็จ: ล้างผลอนุมัติ/ปฏิเสธจากขั้นตอนเก่า ให้กลับเป็น "ยังไม่ส่งงาน"
    UPDATE repairs
    SET approval_status = 'pending',
        approved_by = NULL, approved_at = NULL,
        reviewed_by = NULL, reviewed_at = NULL,
        rejection_reason = NULL
    WHERE status <> 'done'
      AND approval_status IN ('approved', 'rejected');

    -- งานที่เสร็จไปแล้วก่อนมีขั้นตอนนี้: ถือว่าอนุมัติแล้ว จะได้ไม่ค้างในคิว
    UPDATE repairs
    SET approval_status = 'approved'
    WHERE status = 'done'
      AND approval_status <> 'approved';

    INSERT INTO schema_migrations (name) VALUES ('completion_approval');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_repairs_approval_status
  ON repairs (approval_status);

-- ตารางงานแม่บ้าน
CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  cleaner    TEXT NOT NULL,
  building   TEXT DEFAULT '',
  location   TEXT DEFAULT '',
  task       TEXT NOT NULL,
  start_time TEXT DEFAULT '05:00',
  end_time   TEXT DEFAULT '05:30',
  inspector  TEXT DEFAULT '',
  checked    BOOLEAN NOT NULL DEFAULT false,
  checked_by TEXT DEFAULT '',
  checked_at TIMESTAMPTZ,
  remark     TEXT DEFAULT ''
);

-- =========================================================
-- บริหารทั่วไป: คณะกรรมการ (committees) และพนักงาน (employees)
-- 1) สร้างตารางถ้ายังไม่มี
-- 2) ถ้ามีตารางเก่าอยู่แล้ว (คอลัมน์ name / note, status ตัวพิมพ์เล็ก)
--    ให้ปรับให้ตรงกับโค้ดอัตโนมัติ รันซ้ำได้
-- =========================================================
CREATE TABLE IF NOT EXISTS committees (
    id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(200) NOT NULL,
    position VARCHAR(150) NOT NULL,
    department VARCHAR(150),
    phone VARCHAR(30),
    email VARCHAR(200),
    term_start DATE,
    term_end DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    employee_code VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    position VARCHAR(150) NOT NULL,
    department VARCHAR(150),
    phone VARCHAR(30),
    email VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['committees', 'employees'] LOOP

    -- ตารางเก่าใช้ name / note -> เปลี่ยนเป็น full_name / notes
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'name')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'full_name') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN name TO full_name', t);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'note')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'notes') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN note TO notes', t);
    END IF;

    -- เพิ่มคอลัมน์ที่ขาด
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS full_name   text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS position    text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS department  text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS phone       text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS email       text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT ''ACTIVE''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS notes       text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now()', t);

    -- ลบ CHECK เดิมของ status (อาจเป็นตัวพิมพ์เล็ก) แล้วแปลงค่าเป็นตัวพิมพ์ใหญ่
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || t)
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;

    EXECUTE format('UPDATE %I SET status = upper(status)', t);
  END LOOP;
END $$;

ALTER TABLE committees ADD COLUMN IF NOT EXISTS term_start date;
ALTER TABLE committees ADD COLUMN IF NOT EXISTS term_end   date;
ALTER TABLE employees  ADD COLUMN IF NOT EXISTS employee_code text;

ALTER TABLE committees DROP CONSTRAINT IF EXISTS committees_status_check;
ALTER TABLE committees ADD CONSTRAINT committees_status_check
  CHECK (status IN ('ACTIVE', 'EXPIRED', 'INACTIVE'));

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE', 'ON_LEAVE'));

CREATE INDEX IF NOT EXISTS idx_committees_name
    ON committees(full_name);

CREATE INDEX IF NOT EXISTS idx_employees_name
    ON employees(full_name);

-- =========================================================
-- ตารางงานสวน (แยกจาก housekeeping_tasks)
-- =========================================================
CREATE TABLE IF NOT EXISTS gardening_tasks (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    cleaner VARCHAR(150),
    building VARCHAR(150),
    location VARCHAR(255),
    task TEXT,
    start_time TIME,
    end_time TIME,
    inspector VARCHAR(150),
    checked BOOLEAN NOT NULL DEFAULT FALSE,
    checked_by VARCHAR(150),
    checked_at TIMESTAMPTZ,
    remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gardening_tasks_date
    ON gardening_tasks (date);

CREATE INDEX IF NOT EXISTS idx_gardening_tasks_building
    ON gardening_tasks (building);
CREATE INDEX IF NOT EXISTS housekeeping_date_idx ON housekeeping_tasks (date DESC);

-- =========================================================
-- งานประจำวัน (แม่บ้าน / คนสวน)  — รันซ้ำได้
--   housekeeping_tasks / gardening_tasks = "งานประจำ" แสดงทุกวันตามช่วงวันที่/วันในสัปดาห์ที่กำหนด
--   daily_task_logs = ผลตรวจรายวัน (มีแถว = ตรวจแล้ว) เก็บคะแนนและเวลาเสร็จจริง ใช้สรุป KPI
--   วันใหม่ไม่มีแถวใน daily_task_logs จึงกลับเป็น "รอตรวจ" อัตโนมัติ
-- =========================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['housekeeping_tasks', 'gardening_tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS employee_id BIGINT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS end_date DATE', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS max_score INTEGER NOT NULL DEFAULT 10', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS repeat_days INTEGER[] NOT NULL DEFAULT ''{1,2,3,4,5,6,7}''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (employee_id)', t || '_employee_idx', t);

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_end_date_chk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (end_date IS NULL OR end_date >= date)', t, t || '_end_date_chk');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_max_score_chk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (max_score BETWEEN 1 AND 100)', t, t || '_max_score_chk');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_repeat_days_chk');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (cardinality(repeat_days) > 0 AND repeat_days <@ ARRAY[1,2,3,4,5,6,7])', t, t || '_repeat_days_chk');
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS daily_task_logs (
  id          BIGSERIAL PRIMARY KEY,
  module      TEXT NOT NULL CHECK (module IN ('housekeeping', 'gardening')),
  task_id     BIGINT NOT NULL,
  work_date   DATE NOT NULL,
  -- snapshot ของงาน ณ วันที่ตรวจ: แก้/ลบงานประจำภายหลังแล้ว KPI ย้อนหลังไม่เพี้ยน
  employee_id BIGINT,
  cleaner     TEXT,
  building    TEXT,
  location    TEXT,
  task        TEXT,
  start_time  TEXT,
  end_time    TEXT,
  max_score   INTEGER NOT NULL DEFAULT 10,
  score       NUMERIC(5,1) NOT NULL DEFAULT 0,
  finished_at TIMESTAMPTZ,                 -- เวลาที่ทำเสร็จจริง
  checked_by  TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  remark      TEXT,
  CONSTRAINT daily_task_logs_score_chk CHECK (score >= 0 AND score <= max_score),
  CONSTRAINT daily_task_logs_uniq UNIQUE (module, task_id, work_date)
);
CREATE INDEX IF NOT EXISTS daily_task_logs_date_idx ON daily_task_logs (module, work_date);
CREATE INDEX IF NOT EXISTS daily_task_logs_emp_idx  ON daily_task_logs (employee_id);

-- ย้ายข้อมูลเดิมครั้งเดียว (บันทึกใน schema_migrations)
--  1) แถวที่เคย "ตรวจแล้ว" -> ผลตรวจรายวัน (ให้คะแนนเต็ม)
--  2) แถวเดิมเป็นงานของวันนั้นวันเดียว -> เก็บเป็นประวัติ (end_date = date)
--  3) งานของ "วันล่าสุดที่เคยแอด" -> คัดลอกเป็นงานประจำเริ่มวันนี้ (ถ้าเป็นของวันนี้อยู่แล้วให้ทำซ้ำต่อเลย)
DO $$
DECLARE
  t       text;
  m       text;
  v_last  date;
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = 'daily_tasks_recurring') THEN
    FOREACH t IN ARRAY ARRAY['housekeeping_tasks', 'gardening_tasks'] LOOP
      m := CASE WHEN t = 'housekeeping_tasks' THEN 'housekeeping' ELSE 'gardening' END;

      -- ผูกชื่อที่เคยพิมพ์ไว้กับทะเบียนพนักงาน (เฉพาะชื่อที่ตรงกับพนักงานเพียงคนเดียว)
      EXECUTE format($f$
        UPDATE %I t SET employee_id = e.id
        FROM employees e
        WHERE t.employee_id IS NULL
          AND lower(btrim(e.full_name)) = lower(btrim(t.cleaner))
          AND (SELECT count(*) FROM employees x
               WHERE lower(btrim(x.full_name)) = lower(btrim(t.cleaner))) = 1
      $f$, t);

      EXECUTE format($f$
        INSERT INTO daily_task_logs
          (module, task_id, work_date, employee_id, cleaner, building, location, task,
           start_time, end_time, max_score, score, finished_at, checked_by, checked_at, remark)
        SELECT %L, id, date, employee_id, cleaner, building, location, task,
               left(start_time::text, 5), left(end_time::text, 5), max_score, max_score,
               checked_at, checked_by, COALESCE(checked_at, now()), NULLIF(remark, '')
        FROM %I
        WHERE checked
        ON CONFLICT (module, task_id, work_date) DO NOTHING
      $f$, m, t);

      EXECUTE format('SELECT max(date) FROM %I', t) INTO v_last;

      IF v_last IS NOT NULL THEN
        EXECUTE format('UPDATE %I SET end_date = date WHERE date < $1', t) USING v_last;

        IF v_last < v_today THEN
          EXECUTE format($f$
            INSERT INTO %I (date, cleaner, building, location, task, start_time, end_time,
                            inspector, remark, max_score)
            SELECT $1, cleaner, building, location, task, start_time, end_time,
                   inspector, remark, max_score
            FROM %I WHERE date = $2
          $f$, t, t) USING v_today, v_last;
          EXECUTE format('UPDATE %I SET end_date = date WHERE date = $1', t) USING v_last;
        END IF;
      END IF;
    END LOOP;

    INSERT INTO schema_migrations (name) VALUES ('daily_tasks_recurring');
  END IF;
END $$;
-- แพตช์ schema (รันซ้ำได้) — รันต่อท้าย schema.sql หรือรันแยกด้วย psql -f schema-fixes.sql

-- 1) ใบงานซ่อม: จำกัดค่า status / approval_status
ALTER TABLE repairs DROP CONSTRAINT IF EXISTS repairs_status_chk;
ALTER TABLE repairs ADD CONSTRAINT repairs_status_chk
  CHECK (status IN ('new', 'doing', 'done'));

ALTER TABLE repairs DROP CONSTRAINT IF EXISTS repairs_approval_chk;
ALTER TABLE repairs ADD CONSTRAINT repairs_approval_chk
  CHECK (approval_status IN ('pending', 'submitted', 'approved', 'rejected'));

-- 2) พนักงาน: ตารางเก่าที่เพิ่มคอลัมน์ employee_code ภายหลังจะไม่มี UNIQUE / NOT NULL
UPDATE employees
SET employee_code = 'EMP-' || lpad(id::text, 4, '0')
WHERE employee_code IS NULL OR btrim(employee_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_uniq
  ON employees (employee_code);

ALTER TABLE employees ALTER COLUMN employee_code SET NOT NULL;
-- รูปคณะกรรมการ / พนักงาน (รันซ้ำได้) — รันต่อท้าย schema.sql หรือ psql -f schema-person-photos.sql
ALTER TABLE committees
  ADD COLUMN IF NOT EXISTS photo_mime TEXT,
  ADD COLUMN IF NOT EXISTS photo_data BYTEA,
  ADD COLUMN IF NOT EXISTS photo_v    INTEGER NOT NULL DEFAULT 0;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS photo_mime TEXT,
  ADD COLUMN IF NOT EXISTS photo_data BYTEA,
  ADD COLUMN IF NOT EXISTS photo_v    INTEGER NOT NULL DEFAULT 0;-- รูปคณะกรรมการ / พนักงาน (รันซ้ำได้) — รันต่อท้าย schema.sql หรือ psql -f schema-person-photos.sql
ALTER TABLE committees
  ADD COLUMN IF NOT EXISTS photo_mime TEXT,
  ADD COLUMN IF NOT EXISTS photo_data BYTEA,
  ADD COLUMN IF NOT EXISTS photo_v    INTEGER NOT NULL DEFAULT 0;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS photo_mime TEXT,
  ADD COLUMN IF NOT EXISTS photo_data BYTEA,
  ADD COLUMN IF NOT EXISTS photo_v    INTEGER NOT NULL DEFAULT 0;

-- ระบบบทบาท/สิทธิ์ + คำขอลบ (รันซ้ำได้) — รันต่อท้าย schema.sql หรือ psql -f schema-roles.sql
-- role: admin | inspector | technician | staff
-- permissions: รายชื่อเมนู (module) ที่เข้าได้ เช่น {repairs,general,nurse}
ALTER TABLE users ADD COLUMN IF NOT EXISTS role           TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS active         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_user_id   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_link_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_link_exp  TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk;
ALTER TABLE users ADD CONSTRAINT users_role_chk
  CHECK (role IN ('admin', 'inspector', 'technician', 'staff'));

-- 1 บัญชี LINE ผูกได้กับ 1 ผู้ใช้เท่านั้น
CREATE UNIQUE INDEX IF NOT EXISTS users_line_user_uniq
  ON users (line_user_id) WHERE line_user_id IS NOT NULL;

-- คำขอลบ: ช่างลบเองไม่ได้ ต้องให้ผู้ตรวจ/ผู้ดูแลอนุมัติ
CREATE TABLE IF NOT EXISTS delete_requests (
  id            SERIAL PRIMARY KEY,
  table_name    TEXT NOT NULL,
  module        TEXT NOT NULL,
  record_id     BIGINT NOT NULL,
  record_label  TEXT NOT NULL DEFAULT '',   -- snapshot ชื่อรายการ (ลบแล้วยังอ่านออก)
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by  TEXT NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT
);
-- รายการเดียวมีคำขอรอพิจารณาได้ทีละ 1 คำขอ
CREATE UNIQUE INDEX IF NOT EXISTS delete_requests_pending_uniq
  ON delete_requests (table_name, record_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS delete_requests_status_idx ON delete_requests (status, requested_at DESC);

-- รูปแนบการตรวจงานแม่บ้าน/คนสวน (ผู้ตรวจถ่ายรูปประกอบผลตรวจ) ลบผลตรวจ = ลบรูปตาม
CREATE TABLE IF NOT EXISTS daily_task_log_photos (
  id         BIGSERIAL PRIMARY KEY,
  log_id     BIGINT NOT NULL REFERENCES daily_task_logs(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_task_log_photos_log_idx ON daily_task_log_photos (log_id);

-- ผู้ตรวจที่ได้รับมอบหมาย (ผูกกับบัญชีผู้ใช้): ผู้ตรวจเห็น/ตรวจได้เฉพาะงานของตัวเอง admin เห็นทั้งหมด
-- งานที่ยังไม่ระบุผู้ตรวจ จึงเห็นเฉพาะ admin จนกว่าจะมอบหมาย
ALTER TABLE repairs            ADD COLUMN IF NOT EXISTS inspector_username TEXT;
ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS inspector_username TEXT;
ALTER TABLE gardening_tasks    ADD COLUMN IF NOT EXISTS inspector_username TEXT;
ALTER TABLE delete_requests    ADD COLUMN IF NOT EXISTS scoped_inspector   TEXT;

CREATE INDEX IF NOT EXISTS repairs_inspector_idx            ON repairs (inspector_username);
CREATE INDEX IF NOT EXISTS housekeeping_tasks_inspector_idx ON housekeeping_tasks (inspector_username);
CREATE INDEX IF NOT EXISTS gardening_tasks_inspector_idx    ON gardening_tasks (inspector_username);

-- งานเดิมที่มีชื่อผู้ตรวจเป็นข้อความ: จับคู่กับบัญชีผู้ตรวจ "ที่ชื่อตรงกับเพียงบัญชีเดียว" (รันซ้ำได้ เติมเฉพาะแถวที่ยังว่าง)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['housekeeping_tasks', 'gardening_tasks'] LOOP
    EXECUTE format($f$
      UPDATE %I k SET inspector_username = u.username
      FROM users u
      WHERE k.inspector_username IS NULL
        AND u.role = 'inspector' AND u.active
        AND lower(btrim(COALESCE(NULLIF(u.display_name, ''), u.username))) = lower(btrim(k.inspector))
        AND (SELECT count(*) FROM users x
             WHERE x.role = 'inspector' AND x.active
               AND lower(btrim(COALESCE(NULLIF(x.display_name, ''), x.username))) = lower(btrim(k.inspector))) = 1
    $f$, t);
  END LOOP;
END $$;

-- โรงอาหาร: ร้านค้า + การตรวจสอบรายการโดยผู้ตรวจ/ผู้ดูแล (แก้ไขรายการ = ต้องตรวจสอบใหม่)
ALTER TABLE canteen ADD COLUMN IF NOT EXISTS shop        TEXT DEFAULT '';
ALTER TABLE canteen ADD COLUMN IF NOT EXISTS verified    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE canteen ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE canteen ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ไฟล์แนบที่ผู้ใช้ส่งถึง Admin (รันซ้ำได้) — psql -f schema-admin-submissions.sql
CREATE TABLE IF NOT EXISTS admin_submissions (
  id         BIGSERIAL PRIMARY KEY,
  subject    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  month      TEXT,                          -- YYYY-MM ที่เลือกในหน้าธุรการ
  sender     TEXT NOT NULL,                 -- username จาก token
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ,
  read_by    TEXT
);

CREATE TABLE IF NOT EXISTS admin_submission_files (
  id            BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES admin_submissions(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_submissions_created_idx ON admin_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_submissions_unread_idx  ON admin_submissions (created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_submission_files_sub_idx ON admin_submission_files (submission_id);
-- สถานะการตรวจสอบไฟล์จากธุรการ (รันซ้ำได้)
ALTER TABLE admin_submissions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE admin_submissions ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE admin_submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE admin_submissions ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- รายละเอียดการตรวจความพร้อมรถและพนักงานขับ (รันซ้ำได้)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_date DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_tires BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_lights BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_brakes BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_fluids BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_equipment BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ready_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS check_note TEXT DEFAULT '';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS license_no TEXT DEFAULT '';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS license_expiry DATE;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS emergency_contact TEXT DEFAULT '';
