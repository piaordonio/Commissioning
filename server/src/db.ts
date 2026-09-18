import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// COMMISSIONING_DATA_DIR lets the Electron desktop wrapper point this at
// its per-user app-data folder (Program Files isn't writable); defaults to
// ./data for plain `npm run dev` / `npm start` use.
const dataDir = process.env.COMMISSIONING_DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// node:sqlite (built into Node 22.5+, no native compilation needed) instead
// of better-sqlite3 — avoids the node-gyp/prebuild-install toolchain that
// breaks behind corporate TLS-intercepting proxies.
export const db = new DatabaseSync(path.join(dataDir, "commissioning.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

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
