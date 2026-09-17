import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "commissioning.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_number TEXT DEFAULT '',
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  equipment_type TEXT NOT NULL DEFAULT '',
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  blocked_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS points (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  panel TEXT DEFAULT '',
  ip_op TEXT DEFAULT '',
  analog_digital TEXT DEFAULT '',
  point_number TEXT NOT NULL,
  descriptor TEXT DEFAULT '',
  wired TEXT NOT NULL DEFAULT '',
  tagged TEXT NOT NULL DEFAULT '',
  end_to_end TEXT NOT NULL DEFAULT '',
  calibrate TEXT NOT NULL DEFAULT '',
  sequence TEXT NOT NULL DEFAULT '',
  alarm TEXT NOT NULL DEFAULT '',
  graphics TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  blocked_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_project ON equipment(project_id);
CREATE INDEX IF NOT EXISTS idx_points_equipment ON points(equipment_id);
`);
