-- StageSync D1 Initial Schema & Seed Data

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  main_leader TEXT NOT NULL,
  sub_leader TEXT NOT NULL DEFAULT '',
  song TEXT NOT NULL DEFAULT '',
  members TEXT NOT NULL DEFAULT '[]',
  shoot_date TEXT NOT NULL DEFAULT '',
  stick_info TEXT NOT NULL DEFAULT '',
  a_melo TEXT NOT NULL DEFAULT '[]',
  b_melo TEXT NOT NULL DEFAULT '[]',
  c_melo TEXT NOT NULL DEFAULT '[]',
  last_melo TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability (
  week_key TEXT NOT NULL,
  username TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '[]',
  absent INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (week_key, username)
);

CREATE TABLE IF NOT EXISTS drafts (
  username TEXT NOT NULL,
  draft_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (username, draft_type)
);

CREATE INDEX IF NOT EXISTS idx_projects_pinned_order ON projects (pinned DESC, sort_order DESC);
CREATE INDEX IF NOT EXISTS idx_availability_week ON availability (week_key);

-- Seed default users
INSERT OR IGNORE INTO users (username, password_hash, role, created_at) VALUES
  ('midnight', 'midnight1027', 'admin', '2026-01-01T00:00:00+08:00'),
  ('空羽', '1234', 'user', '2026-01-01T00:00:00+08:00');

-- Seed default monthly todos
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (
  'todos',
  '📌 11/28 社團成果發表排練
📌 12/05 螢光棒顏色與數量統計確認
📌 12/12 拍攝場地勘景
📌 12/18 冬季企劃服裝與燈光測試
📌 12/25 聖誕特別場走位彩排',
  '2026-01-01T00:00:00+08:00'
);

-- Seed sample project P001
INSERT OR IGNORE INTO projects (
  id, category, title, main_leader, sub_leader, song, members,
  shoot_date, stick_info, a_melo, b_melo, c_melo, last_melo,
  pinned, sort_order, created_at, updated_at
) VALUES (
  'P001',
  '企劃',
  '冬季光影特別企劃',
  '空羽',
  '希姆',
  '紅蓮華 (Remix)',
  '["空羽","希姆","方良"]',
  '2026-12-15',
  '大閃橘 x6, 孔雀藍 x4',
  '["空羽","希姆"]',
  '["希姆","方良"]',
  '["空羽","方良"]',
  '["空羽","希姆","方良"]',
  1,
  1,
  '2026-01-01T00:00:00+08:00',
  '2026-01-01T00:00:00+08:00'
);
