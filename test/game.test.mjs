import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wr-test-"));
process.env.WR_DATA_DIR = dir;

const g = await import("../src/game.mjs");

test("distance converts work to metres", () => {
  assert.equal(g.distOf(0), 0);
  assert.equal(g.distOf(100), 500);
  assert.equal(g.distOf(100, 2), 1500);
  assert.equal(g.distOf(-5), 0);
});

test("threshold is the median of the last ten rounds", () => {
  assert.equal(g.thresholdFrom([]), 500);
  assert.equal(g.thresholdFrom([100, 300, 200]), 200);
  assert.equal(g.thresholdFrom([100, 200, 300, 400]), 250);
  assert.equal(g.thresholdFrom([1, 2, 3, 999, 999, 999, 999, 999, 999, 999, 1000]), 999);
});

test("outcome splits at the threshold", () => {
  assert.equal(g.outcomeOf(800, 500), "run");
  assert.equal(g.outcomeOf(500, 500), "run");
  assert.equal(g.outcomeOf(499, 500), "sleep");
});

test("correct dps call deals 1.5x role damage and hurts the boss", () => {
  const bossBefore = g.activeBoss();
  const p = g.join({ name: "tester", role: "dps" });
  const call = g.predict(p.token, "run");
  assert.equal(call.roundId, 1);
  const out = g.settleRound({ id: 1, work: 100, blocks: 2, timestamp: Math.floor(Date.now() / 1000) });
  assert.equal(out.outcome, "run");
  assert.equal(out.dist, 1500);
  assert.equal(Math.round(out.teamDamage), Math.round(1500 * 1.3 * 1.5));
  const bossAfter = g.activeBoss();
  assert.equal(bossAfter.id, bossBefore.id);
  assert.ok(bossAfter.hp < bossBefore.hp);
});

test("wrong call deals base damage only, correct healer adds team bonus", () => {
  const h = g.join({ name: "medic", role: "healer" });
  g.predict(h.token, "run");
  const out = g.settleRound({ id: 2, work: 50, blocks: 0, timestamp: Math.floor(Date.now() / 1000) });
  assert.equal(out.outcome, "sleep");           // 250 m < median threshold
  assert.equal(Math.round(out.teamDamage), Math.round(250 * 0.8)); // wrong guess → no bonus, no team lift

  // healer calls it right: 1.5x own damage AND +10% for the whole round
  g.predict(h.token, "sleep");
  const out2 = g.settleRound({ id: 3, work: 50, blocks: 0, timestamp: Math.floor(Date.now() / 1000) });
  assert.equal(out2.outcome, "sleep");
  assert.equal(Math.round(out2.teamDamage), Math.round(250 * 0.8 * 1.5 * 1.1));
});

test("leaderboard only counts settled damage", () => {
  const lb = g.leaderboard();
  assert.ok(lb.length >= 1);
  assert.ok(lb[0].damage >= 1);
});
