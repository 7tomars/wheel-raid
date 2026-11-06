// poller.mjs — follows Squeekchain rounds and settles them into Wheel Raid.
import { readCore } from "./squeek.mjs";
import { settleRound } from "./game.mjs";
import { getMeta } from "./db.mjs";

const EVERY = Number(process.env.POLL_MS || 30000);
const HOOK = process.env.DISCORD_WEBHOOK_URL || "";
const log = (...a) => console.log(new Date().toISOString(), "[poller]", ...a);

async function postRecap(text) {
  if (!HOOK) return;
  try {
    const res = await fetch(HOOK, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "Wheel Raid", content: text.slice(0, 1900) }),
    });
    if (!res.ok) log("webhook", res.status);
  } catch (e) { log("webhook error", e.message); }
}

async function tick() {
  const feed = await readCore();
  const local = Number(getMeta("settledThrough", 0));
  const fresh = feed.rounds.filter((r) => r.id > local).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  // Baseline on first run: adopt current chain head without replaying history.
  if (local === 0 && fresh.length > 1) {
    const last = fresh[fresh.length - 1];
    settleRound({ id: last.id, work: last.work, blocks: last.blocks, timestamp: last.timestamp });
    log("baseline", last.id);
    return;
  }
  for (const r of fresh) {
    const out = settleRound({ id: r.id, work: r.work, blocks: r.blocks, timestamp: r.timestamp });
    if (out) {
      log("round", out.roundId, out.outcome, Math.round(out.dist) + "m", "dmg", Math.round(out.teamDamage));
      await postRecap(out.recap);
    }
  }
}

let stop = false;
process.on("SIGTERM", () => { stop = true; });
process.on("SIGINT", () => { stop = true; });
log("start", `every ${EVERY}ms`, HOOK ? "webhook on" : "webhook off");
while (!stop) {
  try { await tick(); } catch (e) { log("error", e.message); }
  await new Promise((r) => setTimeout(r, EVERY));
}
log("stopped");
