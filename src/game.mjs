// game.mjs — Wheel Raid rules. Pure-ish: DB writes + deterministic math (testable).
import crypto from "node:crypto";
import { db, getMeta, setMeta } from "./db.mjs";

export const ROLES = { dps: 1.3, tank: 1.0, healer: 0.8 };
export const M_PER_WORK = 5;          // 1 unit of round work = 5 m
export const M_PER_BLOCK = 500;       // every completed chain block = 500 m of real sprint
export const PREDICTION_BONUS = 1.5;  // correct run/sleep guess
export const HEALER_TEAM_BONUS = 1.1; // one correct healer lifts the whole round
export const BASE_HP = 80000;
export const TIER_GROWTH = 1.35;

export const wib = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3);
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
export function weekStart(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (day - 1));
  return t.toISOString();
}

export const BOSS_NAMES = [
  "The Idle Wheel", "Sleepy Squeek", "Rusty Runner", "The Snooze Engine",
  "Wheel of Naps", "Midnight Hamster", "Cog Collector", "The Slow Kernel",
];

export function bossForTier(week, tier) {
  const row = db.prepare("SELECT * FROM bosses WHERE week=? AND tier=?").get(week, tier);
  if (row) return row;
  const idx = (tier - 1) % BOSS_NAMES.length;
  const hp = Math.round(BASE_HP * Math.pow(TIER_GROWTH, tier - 1));
  const name = tier <= BOSS_NAMES.length ? BOSS_NAMES[idx] : `${BOSS_NAMES[idx]} ${tier}`;
  db.prepare("INSERT INTO bosses(week,tier,name,hp,max_hp,started_at) VALUES(?,?,?,?,?,?)")
    .run(week, tier, name, hp, hp, new Date().toISOString());
  return db.prepare("SELECT * FROM bosses WHERE week=? AND tier=?").get(week, tier);
}

export function activeBoss(now = new Date()) {
  const week = weekKey(now);
  let tier = Number(getMeta(`bossTier:${week}`, 1));
  for (;;) {
    const b = bossForTier(week, tier);
    if (!b.defeated_at && b.hp > 0) return b;
    tier += 1;
    setMeta(`bossTier:${week}`, tier);
  }
}

export function distOf(work, blocks = 0) {
  return Math.max(0, Number(blocks) || 0) * M_PER_BLOCK + Math.max(0, Number(work) || 0) * M_PER_WORK;
}

/** Threshold = median distance of the last 10 settled rounds (fallback 500 m). */
export function thresholdFrom(dists) {
  const a = (dists || []).filter((n) => Number.isFinite(n)).slice(-10);
  if (!a.length) return 500;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function outcomeOf(dist, threshold) { return dist >= threshold ? "run" : "sleep"; }

export function join({ name, role = "dps", address = null }) {
  const clean = String(name || "").trim().slice(0, 24);
  if (clean.length < 2) throw Object.assign(new Error("nama minimal 2 karakter"), { code: 400 });
  if (!ROLES[role]) throw Object.assign(new Error("role harus dps/tank/healer"), { code: 400 });
  const token = crypto.randomBytes(12).toString("base64url");
  const week = weekKey();
  const r = db.prepare("INSERT INTO players(name,address,role,week,token,created_at) VALUES(?,?,?,?,?,?)")
    .run(clean, address ? String(address).slice(0, 64) : null, role, week, token, new Date().toISOString());
  return { id: Number(r.lastInsertRowid), name: clean, role, token, week };
}

export function playerByToken(token) {
  return db.prepare("SELECT * FROM players WHERE token=?").get(String(token || ""));
}

export function nextRoundId(settledThrough) { return Number(settledThrough) + 1; }

export function predict(token, guess) {
  const p = playerByToken(token);
  if (!p) throw Object.assign(new Error("token tidak dikenal — join dulu"), { code: 401 });
  if (!["run", "sleep"].includes(guess)) throw Object.assign(new Error("guess harus run/sleep"), { code: 400 });
  const settled = Number(getMeta("settledThrough", 0));
  const roundId = nextRoundId(settled);
  const existing = db.prepare("SELECT * FROM predictions WHERE player_id=? AND round_id=?").get(p.id, roundId);
  if (existing) {
    db.prepare("UPDATE predictions SET guess=?, created_at=? WHERE id=?").run(guess, new Date().toISOString(), existing.id);
    return { roundId, guess, changed: true };
  }
  db.prepare("INSERT INTO predictions(player_id,round_id,guess,created_at) VALUES(?,?,?,?)")
    .run(p.id, roundId, guess, new Date().toISOString());
  return { roundId, guess, changed: false };
}

/** Settle one round: insert, resolve predictions, damage boss, write recap. */
export function settleRound({ id, work, blocks = 0, timestamp }) {
  const roundId = Number(id);
  if (db.prepare("SELECT 1 FROM rounds WHERE id=?").get(roundId)) return null;
  const prev = db.prepare("SELECT dist FROM rounds ORDER BY id DESC LIMIT 10").all().map((r) => r.dist);
  const threshold = thresholdFrom(prev);
  const dist = distOf(work, blocks);
  const outcome = outcomeOf(dist, threshold);
  db.prepare("INSERT INTO rounds(id,work,dist,outcome,threshold,settled_at) VALUES(?,?,?,?,?,?)")
    .run(roundId, Number(work), dist, outcome, threshold, new Date(timestamp ? timestamp * 1000 : Date.now()).toISOString());

  const preds = db.prepare(`SELECT pr.*, p.role, p.name FROM predictions pr
                            JOIN players p ON p.id=pr.player_id WHERE pr.round_id=?`).all(roundId);
  const anyHealer = preds.some((x) => x.role === "healer" && x.guess === outcome);
  const teamMult = anyHealer ? HEALER_TEAM_BONUS : 1;
  let teamDamage = 0;
  const perPlayer = [];
  for (const pr of preds) {
    const correct = pr.guess === outcome ? 1 : 0;
    const dmg = dist * (ROLES[pr.role] || 1) * (correct ? PREDICTION_BONUS : 1) * teamMult;
    db.prepare("UPDATE predictions SET correct=?, damage=? WHERE id=?").run(correct, dmg, pr.id);
    teamDamage += dmg;
    perPlayer.push({ name: pr.name, role: pr.role, correct, dmg });
  }

  const boss = activeBoss(new Date(timestamp ? timestamp * 1000 : Date.now()));
  let defeated = null;
  if (teamDamage > 0) {
    const hp = Math.max(0, boss.hp - teamDamage);
    db.prepare("UPDATE bosses SET hp=? WHERE id=?").run(hp, boss.id);
    if (hp === 0) {
      db.prepare("UPDATE bosses SET defeated_at=? WHERE id=?").run(new Date().toISOString(), boss.id);
      defeated = boss.name;
    }
  }

  const top = perPlayer.sort((a, b) => b.dmg - a.dmg)[0];
  const recap = [
    `Round ${roundId} · ${outcome.toUpperCase()} · ${Math.round(dist)} m`,
    `tebakan benar ${perPlayer.filter((p) => p.correct).length}/${perPlayer.length}` +
      (anyHealer ? " · healer bonus +10%" : ""),
    `damage tim ${Math.round(teamDamage).toLocaleString("en-US")}` + (top ? ` · MVP ${top.name}` : ""),
    defeated ? `BOSS DOWN: ${defeated}` : `HP boss ${Math.round(boss.hp - teamDamage).toLocaleString("en-US")}`,
  ].join("\n");
  db.prepare("INSERT INTO recaps(round_id,text,created_at) VALUES(?,?,?)").run(roundId, recap, new Date().toISOString());

  setMeta("settledThrough", roundId);
  return { roundId, dist, outcome, threshold, teamDamage, players: perPlayer.length, defeated, recap };
}

export function leaderboard(week = weekKey()) {
  const since = weekStart();
  return db.prepare(`
    SELECT p.name, p.role, ROUND(SUM(pr.damage),0) AS damage,
           SUM(CASE WHEN pr.correct=1 THEN 1 ELSE 0 END) AS hits,
           COUNT(pr.id) AS guesses
    FROM predictions pr JOIN players p ON p.id=pr.player_id
    JOIN rounds r ON r.id=pr.round_id
    WHERE pr.damage IS NOT NULL AND r.settled_at >= ?
    GROUP BY p.id ORDER BY damage DESC LIMIT 25`).all(since);
}

export function state(settledThrough = Number(getMeta("settledThrough", 0))) {
  const boss = activeBoss();
  const recent = db.prepare("SELECT id,dist,outcome,settled_at FROM rounds ORDER BY id DESC LIMIT 12").all();
  const recaps = db.prepare("SELECT round_id,text,created_at FROM recaps ORDER BY round_id DESC LIMIT 5").all();
  const players = db.prepare("SELECT COUNT(*) c FROM players WHERE week=?").get(weekKey()).c;
  const upcoming = db.prepare("SELECT guess, COUNT(*) c FROM predictions WHERE round_id=? GROUP BY guess")
    .all(nextRoundId(settledThrough));
  const hpPct = boss.max_hp ? Math.max(0, Math.round((boss.hp / boss.max_hp) * 100)) : 0;
  return {
    week: weekKey(), boss: { ...boss, hpPct }, players,
    round: { settledThrough, next: nextRoundId(settledThrough), recent },
    upcoming: Object.fromEntries(upcoming.map((r) => [r.guess, r.c])),
    leaderboard: leaderboard(), recaps,
    rules: { mPerWork: M_PER_WORK, mPerBlock: M_PER_BLOCK, bonus: PREDICTION_BONUS, roles: ROLES },
  };
}
