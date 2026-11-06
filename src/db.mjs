// db.mjs — SQLite (node:sqlite, no deps)
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve(process.env.WR_DATA_DIR || "data");
fs.mkdirSync(DATA, { recursive: true });
export const db = new DatabaseSync(path.join(DATA, "wheel-raid.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  role TEXT NOT NULL DEFAULT 'dps',
  week TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  work INTEGER NOT NULL,
  dist REAL NOT NULL,
  outcome TEXT NOT NULL,
  threshold REAL NOT NULL,
  settled_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL,
  guess TEXT NOT NULL,
  created_at TEXT NOT NULL,
  correct INTEGER,
  damage REAL,
  UNIQUE(player_id, round_id)
);
CREATE TABLE IF NOT EXISTS bosses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL,
  tier INTEGER NOT NULL,
  name TEXT NOT NULL,
  hp REAL NOT NULL,
  max_hp REAL NOT NULL,
  started_at TEXT NOT NULL,
  defeated_at TEXT
);
CREATE TABLE IF NOT EXISTS recaps (
  round_id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`);

export const getMeta = (k, d = null) => {
  const r = db.prepare("SELECT v FROM meta WHERE k=?").get(k);
  return r ? r.v : d;
};
export const setMeta = (k, v) => db.prepare("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
