// squeek.mjs — read-only client for the public Squeekchain protocol API.
// Only ever GETs public endpoints. No wallet, no key, no signing, no transactions.
const BASE = process.env.SQUEEK_API || "https://api.squeekchain.com/v1";

async function get(pathname, { timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${pathname}`, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Latest settled round + rolling history, derived from /v1/core (public). */
export async function readCore() {
  const d = await get("/core");
  const c = d?.core || {};
  const events = Array.isArray(d?.events) ? d.events : [];
  const rounds = events
    .filter((e) => e.eventName === "RoundRecorded")
    .map((e) => {
      const arg = (n) => e.arguments?.find((a) => a.name === n)?.value;
      return {
        id: Number(arg("roundId")),
        work: Number(arg("work")),
        cumulativeWork: Number(arg("cumulativeWork")),
        cumulativeBlockUnits: String(arg("cumulativeBlockUnits") || "0"),
        timestamp: Number(e.blockTimestamp),
        tx: e.transactionHash,
      };
    })
    .sort((a, b) => a.id - b.id);
  return {
    status: d?.status,
    chainId: d?.chain?.chainId,
    settledThroughRound: Number(c.settledThroughRound || 0),
    blockHeight: Number(c.blockHeight || 0),
    paused: Boolean(c.paused),
    rounds,
  };
}

/** Public settlement feed: per-round work + completed blocks (real distance). */
export async function readSettlements(range = "24h") {
  const d = await get(`/settlements?range=${encodeURIComponent(range)}`);
  const rows = Array.isArray(d?.recentSettlements) ? d.recentSettlements : [];
  return {
    status: d?.status, chainId: d?.chain?.chainId, range: d?.range,
    summary: d?.summary || {},
    rounds: rows.map((r) => ({
      id: Number(r.settledThroughRound),
      work: Number(r.workAdded || 0),
      blocks: Number(r.completedBlockCount || 0),
      timestamp: Date.parse(r.blockTimestamp) / 1000,
      tx: r.transactionHash,
      confirmed: r.confirmationStatus,
    })).sort((a, b) => a.id - b.id),
  };
}

export async function readStatus() {
  const d = await get("/status");
  return { freshness: d?.measurement?.freshness, observedAt: d?.measurement?.observedAt, builder: d?.builder?.status, oracle: d?.oracle?.status };
}
