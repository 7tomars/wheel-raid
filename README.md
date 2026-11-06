# Wheel Raid

A weekly community boss raid for **Squeekchain Genesis**. Every settled Squeekchain round is a real
hamster sprint: the distance comes from the public protocol API, not from a random number generator.
Players pick a role, call **RUN** or **SLEEP** for the next round, and convert the hamster's real
distance into damage against a shared weekly boss.

Live demo: <https://opposition-format-sonic-interesting.trycloudflare.com> (temporary tunnel until the
production domain is attached).

## Why it is not a dashboard

Wheel Raid has game state, persistent players, weekly bosses, damage math, prediction resolution and a
community round feed. It consumes Squeekchain data to drive outcomes; nothing is read-only display.

## How it uses Squeekchain

| Endpoint | Use |
|---|---|
| `GET https://api.squeekchain.com/v1/settlements?range=24h` | per-round `workAdded` + `completedBlockCount` → distance |
| `GET https://api.squeekchain.com/v1/core` | fallback round feed and chain head |
| `GET https://api.squeekchain.com/v1/status` | builder/oracle freshness shown on the page |

Public reads only. No wallet connection, no signing, no transactions, no tokens, no private keys.

## Rules

- Distance of a round = `completedBlockCount × 500 m + workAdded × 5 m`.
- `RUN` wins when the round distance is **≥ the median of the last 10 rounds**; otherwise `SLEEP` wins.
- Damage = `distance × role multiplier × 1.5` when the call is right.
- Roles: DPS `1.3×`, Tank `1.0×`, Healer `0.8×` — and one correct healer lifts the whole round by `+10%`.
- Boss HP is shared. Killing a boss spawns the next tier immediately (HP `×1.35`) in the same week.
- Leaderboard resets every ISO week (Monday 00:00 UTC).

## Run

```bash
node src/server.mjs     # public site + JSON API on :3000
node src/poller.mjs     # follows settled rounds, applies damage, posts recaps
npm test                # game math + settlement tests
```

Environment:

```
PORT=3000
SQUEEK_API=https://api.squeekchain.com/v1
SETTLE_RANGE=24h
DISCORD_WEBHOOK_URL=            # optional: round recaps to a Discord channel
WR_DATA_DIR=data
```

## HTTP API

```
GET  /                landing page / game UI
GET  /api/state       boss, open round, leaderboard, recaps, upcoming calls
GET  /api/core        upstream Squeekchain summary + last rounds
POST /api/join        {name, role, address?} -> {token}
POST /api/predict     {guess: run|sleep} + X-Player-Token
GET  /healthz         liveness + settled round
```

## Verification (Squeekchain Code lane)

This project is submitted through the Genesis Code page. Direct submissions require a public HTTPS
site on an owned domain with a DNS TXT challenge, plus a public GitHub repository link. The exact TXT
record and README line are issued by Squeekchain at submission time and will be added here.

## Stack

Node 22+ (ESM), built-in `node:sqlite`, zero runtime dependencies, one static HTML page.
