# PATAPOTEA

An Aviator-style **crash game** demo: a red plane climbs an exponential curve, the multiplier rises,
and you cash out before it flies away. Built as a full-stack application with an authoritative
server, a real database, two simultaneous bet slots, accounts, dashboards and an admin view.

> **DEMO / VIRTUAL CREDITS ONLY.**
> Every balance, stake, payout and transaction in this project is simulated and has **no monetary
> value**. There is no deposit, withdrawal or real-money wagering path anywhere in the codebase.
> See [docs/REAL_MONEY_READINESS.md](docs/REAL_MONEY_READINESS.md) for what a separately authorized
> real-money launch would require.

---

## What is included

| Area | Details |
| --- | --- |
| Game loop | 7s betting countdown → flight → crash → 4.5s result → automatic next round |
| Bets | Two independent slots per player per round; stake 1–5,000 VC |
| Cash-out | Server-timed multiplier, one settlement per bet, refused after the crash |
| Fairness | Demo commit-and-reveal: SHA-256 commitment published before betting, seed revealed after the crash. **Not audited or certified** |
| Accounts | Email + password registration/login, scrypt hashing, httpOnly cookie sessions |
| Player dashboard | Virtual balance, bet history, full credit ledger, profile settings, auto cash-out |
| Admin dashboard | Live round, completed rounds, demo/test accounts, virtual-credit flow (read-only) |
| Round records | Unique round ID, crash multiplier, open/close/take-off/crash timestamps, revealed seed |
| Verification | Commit-and-reveal round history screen with local reproduction and explicit limitations |
| Audio | Synthesised WebAudio takeoff/cash-out/crash cues with a persistent mute button |
| Responsive | Dedicated layouts for Android/iPhone (bottom nav, two-up bet panels) and desktop |
| Tests | 50 automated tests covering math, betting, cash-outs, crashes, transitions, auth, admin, round records, verification and invalid inputs |

---

## Quick start

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`). No external database service is needed.

```bash
npm install

# 1) Production-style: build the client, then serve API + SPA from one process
npm run build
npm start
# → http://localhost:3001

# 2) Development: API with watch + Vite dev server with HMR
npm run dev
# → client http://localhost:5173  (proxies /api to :3001)
```

On first boot the server creates `data/patapotea.db` and seeds:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@patapotea.demo` | `AdminDemo!2025` |
| Player | `player@patapotea.demo` | `PlayerDemo!2025` |
| Bots (SIM) | `*@bots.patapotea.demo` | random (not usable for login) |

Override the seeded passwords with
`SEED_ADMIN_PASSWORD` / `SEED_PLAYER_PASSWORD` **before** first boot, or delete `data/` to reseed.
See `.env.example`.

### Run the tests

```bash
npm test
```

The suite uses `node:test` with in-memory SQLite and an injected clock, so rounds are deterministic
and fast. It covers:

- SHA-256 vectors, crash-point distribution, multiplier/payout math, stake parsing
- betting debits + ledger, negative/zero/oversized stakes, duplicate slots, insufficient balance
- two simultaneous bets, betting-window enforcement
- cash-out payout math, duplicate cash-out prevention, cash-out after crash, before takeoff
- partial settlement (one slot cashed, one lost), crash resolution, round transitions
- seed commitment/reveal, persisted round outcomes, history reload after restart
- HTTP auth, CSRF header, session invalidation, full bet → cash-out → crash flow via the API
- admin role protection and unrevealed crash-point redaction
- round history records, timestamps, commitment/reveal and verification
- tampered seeds/crash values, malformed seeds, invalid round numbers and query parameters
- idempotent verification with repeated requests, unsettled-round refusal and seed redaction
- demo top-up cooldown, profile validation, JSON 404s

### Offline preview build

A completely self-contained single-file version for quick previews without running the server:

```bash
npm run build:preview     # → preview-dist/index.html (everything inlined)
```

It reuses the **same** crash engine and math in the browser, backed by `localStorage`
(`shared/local-repo.js`, `client/src/api/local.js`). Auth in that build is a convenience stub,
clearly marked **PREVIEW · LOCAL SIMULATION**. Use the same demo credentials (or register).
Round history and verification work there too — the records are local to that browser profile,
which is itself a documented limitation.

---

## Project structure

```
patapotea/
├── server/
│   ├── index.js              # bootstrap: DB, seed, engine, HTTP server, graceful shutdown
│   ├── app.js                # Express app factory: auth, CSRF, routes, SSE, static SPA
│   ├── db.js                 # SQLite schema + SqliteRepo (atomic guarded transactions)
│   ├── validate.js           # input validation helpers
│   └── game/
│       └── engine.js         # CrashEngine: authoritative phases, bets, cash-outs, bots
├── shared/                   # code used by BOTH server and browser preview
│   ├── config.js             # timings, limits, house edge, phases
│   ├── game-math.js          # crash distribution, multiplier curve, payout math
│   ├── sha256.js             # synchronous SHA-256 for seed commitments
│   ├── verification.js       # commit-and-reveal algorithm, limitations, verifier
│   ├── round-record.js       # public round-record serialisation
│   └── local-repo.js         # localStorage repository for the preview build
├── client/
│   ├── index.html
│   └── src/
│       ├── App.jsx           # hash router + providers + route guards
│       ├── main.jsx
│       ├── styles.css        # dark/charcoal + signal-red design system
│       ├── api/              # adapter layer: http.js (SSE) / local.js (preview)
│       ├── components/       # GameStage (canvas), BetPanel, Nav, history, feed, icons
│       ├── context/          # auth, toasts, sound
│       ├── hooks/            # game state/SSE, live multiplier, countdown, hash route
│       ├── lib/              # formatting, WebAudio sound design
│       └── pages/            # Play, Rounds, Login/Register, Dashboard, Admin
├── tests/
│   ├── engine.test.js
│   └── api.test.js
├── docs/
│   ├── FAIRNESS.md           # scheme, reproducible verification, limitations
│   └── REAL_MONEY_READINESS.md
├── data/                     # SQLite database (created at runtime, git-ignored)
├── vite.config.js
└── package.json
```

### Separation of concerns

- **`shared/`** is pure and UI-free. The crash distribution and curve math run identically on the
  server and in the preview.
- **`server/game/engine.js`** owns *all* game rules and timing. It knows nothing about Express or
  React. It talks to a repository interface, so the same engine runs on SQLite or on localStorage.
- **`server/app.js`** is a thin HTTP shell: authenticate → validate → delegate to the engine.
- **`client/`** never decides an outcome. It renders a locally interpolated multiplier from
  server timestamps and asks the server to settle every cash-out.

---

## Game loop (authoritative)

Defined in `shared/config.js`:

| Phase | Duration | Behaviour |
| --- | --- | --- |
| `betting` | 7s | Bets accepted; two slots per player; seed hash shown |
| `flying` | until crash | Multiplier `m(t) = e^(0.09 · seconds)`, cash-outs accepted while server time < crash time |
| `crashed` | 4.5s | Remaining bets marked lost, crash point + server seed revealed, then next round |

The crash point uses the standard distribution `P(crash ≥ m) = (1 − houseEdge) / m` with a 3% demo
edge, rounded down to two decimals, capped at 500x. The seed for each round is random, hashed with
SHA-256 and committed before betting opens; the seed itself is revealed only after the crash.

### Anti-abuse / correctness rules

- Stake must be an integer number of cents, within limits, and ≤ the player's balance.
- Balance debit is `UPDATE ... WHERE balance_cents >= ?`, so it cannot go negative under concurrency.
- `UNIQUE (round_id, user_id, slot)` prevents duplicate active bets.
- Cash-out uses `UPDATE bets SET status='cashed' WHERE id=? AND status='active'` and refuses if no
  row changed — duplicates can never double-pay.
- Cash-outs are rejected outside `flying` and when `serverNow >= crashAt`, regardless of what the
  client displays.
- Every stake and payout writes a ledger row in the same transaction as the balance change.
- Rounds persist `id`, `round_no`, crash point, status, timestamps, seed hash and revealed seed.

---

## HTTP API

All mutations require the `X-Requested-With: patapotea` header (CSRF guard) and the httpOnly
`pp_session` cookie. Bodies are JSON.

| Method & path | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create demo account, 10,000 VC grant |
| `POST /api/auth/login` | Session cookie |
| `POST /api/auth/logout` | Destroy session |
| `GET /api/auth/me` | Current user + balance |
| `PATCH /api/auth/profile` | Sound / auto-cash-out settings |
| `POST /api/auth/password` | Change password, invalidate other sessions |
| `GET /api/game/state` | Current snapshot (phase, timing, bets, history) |
| `GET /api/game/stream` | SSE stream of snapshots (`state`, `bet`, `cashout`, `crash`) |
| `POST /api/game/bet` | `{ slot: 0|1, stake: number }` |
| `POST /api/game/cashout` | `{ slot: 0|1 }` |
| `GET /api/fairness` | Algorithm, parameters and limitations |
| `GET /api/rounds` | Settled demo rounds, newest first (no seeds in the list) |
| `GET /api/rounds/:id` | Full round record: timestamps, commitment, revealed seed, verification |
| `GET /api/rounds/:id/verify` | Deterministic verification result |
| `GET /api/me/bets` | Player bet history |
| `GET /api/me/transactions` | Virtual credit ledger |
| `POST /api/wallet/demo-topup` | +2,500 demo credits (5-minute cooldown) |
| `GET /api/admin/overview` | Aggregate stats + live round (admin) |
| `GET /api/admin/users` | Accounts incl. SIM bots (admin) |
| `GET /api/admin/rounds` | Round history; unrevealed crash points redacted (admin) |
| `GET /api/admin/rounds/:id` | Round + its bets (admin) |

Errors are always JSON: `{ "error": "...", "code": "MACHINE_CODE", "field": "optional" }`.

---

## Round verification (demo)

Every round is recorded with a unique UUID, its crash multiplier, the seed commitment and five
timestamps. Open **Rounds** (`#/rounds`) to browse settled demo rounds, inspect a record and
reproduce its outcome.

Scheme (`patapotea-sha256-v1`, implemented in `shared/verification.js`):

1. The server generates a 32-byte `serverSeed` and publishes `seedHash = SHA-256(serverSeed)` before
   betting opens.
2. At settlement: `roundHash = SHA-256(serverSeed + ":" + roundNo)`,
   `u = parseInt(roundHash.slice(0, 13), 16) / 2^52`,
   `crash = max(1, floor(min((1 − 0.03) / (1 − u), 500) × 100) / 100)`.
3. After the crash the seed is revealed, so the commitment and crash point can be recomputed by
   anyone — in the in-app verifier, via `/api/rounds/:id/verify`, or with plain `node:crypto`.

**Honesty note:** this is a demo commit-and-reveal scheme. It has **not** been independently audited
or certified, and it is not correct to call it "provably fair". Verification shows that a recorded
outcome matches the revealed seed; it does **not** prove the seed was chosen before betting, that the
commitment was not replaced, or that the operator is trustworthy. Full details and limitations are in
[docs/FAIRNESS.md](docs/FAIRNESS.md).

## Security notes for this demo

- Passwords hashed with `scrypt` (random 16-byte salt), compared in constant time.
- Session tokens are 256-bit random values; only their SHA-256 hash is stored server-side.
- Cookies are `httpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production` (serve over HTTPS).
- Login/register and game actions are rate limited; generic login errors avoid user enumeration.
- Helmet-style headers + a strict Content-Security-Policy are applied to the SPA.
- All input is length/format/range validated server-side; JSON bodies capped at 32 KB.
- `TRUST_PROXY` is opt-in so forwarded headers can't spoof rate-limit identities by default.
- Admin endpoints are role-gated and never expose unrevealed crash points.

**Not production-hardened:** no email verification, no password reset, no MFA, no persistent
rate-limit store, no audit-log UI, no WAF. Do not expose this publicly with valuable data.

---

## Design

- Obsidian/charcoal surfaces (`#060607` → `#17171a`) with a signal-red accent (`#ff2d3f`).
- Canvas-rendered flight curve, glowing trail, sparks, explosion and screen shake; `prefers-reduced-
  motion` respected.
- All icons are inline SVG; all sound is synthesised at runtime (no external assets, works offline).
- Layouts: desktop two-column (game + bet rail), tablet two-up bet panels, mobile stacked panels with
  a fixed bottom navigation and safe-area insets for iPhone.

---

## Limitations (intentional)

- No payments, no real-money deposits/withdrawals, no cash-out to external value.
- No independent audit, certification, RNG testing or regulatory approval of any kind.
- No KYC/AML, geo-blocking, age verification or licensing integration.
- Demo bots (`SIM`) are cosmetic and never affect a human player's outcome.
- Real-money readiness is documented but **not implemented**.

See [docs/REAL_MONEY_READINESS.md](docs/REAL_MONEY_READINESS.md).
