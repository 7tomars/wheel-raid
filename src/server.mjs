// server.mjs — public HTTP surface for Wheel Raid.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { join, predict, state } from "./game.mjs";
import { readCore, readSettlements, readStatus } from "./squeek.mjs";
import { getMeta } from "./db.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(import.meta.dirname, "..");

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(s);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let b = "";
  req.on("data", (c) => { b += c; if (b.length > 10000) { reject(new Error("body too large")); req.destroy(); } });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error("invalid json")); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if ((req.method === "GET" || req.method === "HEAD") && (url.pathname === "/" || url.pathname === "/index.html")) {
      let html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
      // Squeekchain verification page tag (diisi setelah challenge diterbitkan)
      try {
        const tagFile = path.join(ROOT, "public", "squeek-verify.html");
        if (fs.existsSync(tagFile)) html = html.replace("<!--SQUEEK_VERIFY_TAG-->", fs.readFileSync(tagFile, "utf8"));
      } catch {}
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    if (req.method === "GET" && url.pathname === "/v1/status") {
      const up = await readStatus().catch((e) => ({ error: e.message }));
      return json(res, 200, { app: "wheel-raid", ok: true, settledThrough: Number(getMeta("settledThrough", 0)), upstream: up });
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { ok: true, settledThrough: Number(getMeta("settledThrough", 0)) });
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      return json(res, 200, state());
    }
    if (req.method === "GET" && url.pathname === "/api/core") {
      const c = await readCore();
      const s24 = await readSettlements("24h").catch(() => null);
      return json(res, 200, { status: c.status, settledThroughRound: c.settledThroughRound,
        chainId: c.chainId, summary: s24?.summary || null,
        last: c.rounds.slice(-5).map((r) => ({ id: r.id, work: r.work, blocks: r.blocks, ts: r.timestamp })) });
    }
    if (req.method === "POST" && url.pathname === "/api/join") {
      const b = await readBody(req);
      const p = join({ name: b.name, role: b.role, address: b.address });
      return json(res, 201, p);
    }
    if (req.method === "POST" && url.pathname === "/api/predict") {
      const b = await readBody(req);
      const token = req.headers["x-player-token"] || b.token;
      return json(res, 200, predict(token, String(b.guess || "").toLowerCase()));
    }
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
      return json(res, 200, state().leaderboard);
    }
    return json(res, 404, { error: "not_found" });
  } catch (e) {
    return json(res, e.code || 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => console.log(`wheel-raid on http://${HOST}:${PORT}`));
