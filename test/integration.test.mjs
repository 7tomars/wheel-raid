import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wr-int-"));
process.env.WR_DATA_DIR = dir;

const squeek = await import("../src/squeek.mjs");
const g = await import("../src/game.mjs");
const { setMeta } = await import("../src/db.mjs");

test("live Squeekchain core feed returns rounds with real block distance", async () => {
  const core = await squeek.readCore();
  assert.ok(core.settledThroughRound > 0, "chain head should be positive");
  assert.ok(core.rounds.length > 0, "should return settled rounds");
  const last = core.rounds.at(-1);
  assert.ok(Number.isFinite(last.work));
  assert.ok(Number.isFinite(last.blocks));
  assert.ok(last.blocks >= 0);
  assert.ok(g.distOf(last.work, last.blocks) > 0);
});

test("a live round settles into the game with damage math", async () => {
  const core = await squeek.readCore();
  const r = core.rounds.at(-1);
  setMeta("settledThrough", 999998);   // aim the next prediction at the round we settle
  const p = g.join({ name: "live-tester", role: "dps" });
  const call = g.predict(p.token, "run");
  assert.equal(call.roundId, 999999);
  const out = g.settleRound({ id: 999999, work: r.work, blocks: r.blocks, timestamp: r.timestamp });
  assert.equal(Math.round(out.dist), Math.round(r.blocks * 500 + r.work * 5));
  assert.ok(out.teamDamage > 0);
  assert.ok(out.recap.includes("Round 999999"));
});
