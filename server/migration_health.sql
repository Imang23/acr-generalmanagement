-- โมดูลสุขอนามัยและพยาบาล (รันซ้ำได้) ต่อท้าย schema.sql แล้วรัน: node initdb.js
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
