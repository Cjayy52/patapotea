# Fairness, round records and verification (demo)

> **Honest status:** PATAPOTEA is a demo. Its outcomes use a **commit-and-reveal** scheme that you
> can reproduce from the published data. It has **not** been independently audited, certified or
> reviewed by any testing laboratory or regulator, and it is **not** correct to call it
> "provably fair" in a regulatory or commercial sense.

This document explains exactly how a demo round is produced, how to verify a recorded round, and
what that verification does and does not prove.

---

## 1. What is recorded per round

Every round has:

- a unique **round ID** (UUID v4) generated when the round opens;
- a sequential **round number** (`roundNo`, used in the derivation);
- a **server seed** (32 random bytes / 64 hex characters), secret until settlement;
- a **commitment** — `seedHash = SHA-256(serverSeed)` — stored and shown while betting is open;
- the **crash multiplier** and its scheduled crash time;
- timestamps for **round open**, **betting close**, **take-off**, **scheduled crash** and **actual
  settlement**;
- all bets for the round (username, slot, stake, status, cash-out multiplier, payout).

Rounds are stored in SQLite (`rounds` and `bets`). The public API only exposes rounds whose status is
`crashed`; a live round never returns its seed or crash point through the history endpoints.

### Public endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/fairness` | Algorithm description, house edge, limitations, disclaimer |
| `GET /api/rounds?limit=20&before=<roundNo>` | Settled rounds, newest first; no seeds in the list |
| `GET /api/rounds/:roundId` | Full record: timestamps, commitment, revealed seed, verification, bets |
| `GET /api/rounds/:roundId/verify` | Verification result only; deterministic and idempotent |

Invalid `limit`/`before` values return `400 VALIDATION_ERROR`. Unknown IDs return `404
ROUND_NOT_FOUND`. Unsettled rounds return `409 ROUND_NOT_SETTLED` without leaking any seed material.

---

## 2. How the outcome is generated

Algorithm id: `patapotea-sha256-v1`

1. The server draws `serverSeed` from a CSPRNG (32 bytes, hex encoded).
2. Before betting opens it records and displays `seedHash = SHA-256(serverSeed)`.
3. At settlement it derives:

   ```text
   roundHash   = SHA-256(serverSeed + ":" + roundNo)
   u           = parseInt(roundHash.slice(0, 13), 16) / 2^52
   crashPoint  = max(1, floor(min((1 - 0.03) / (1 - u), 500) * 100) / 100)
   ```

   `0.03` is the demo house-edge parameter; `500` is the maximum multiplier.
4. The plane's multiplier is `m(t) = e^(0.09 × seconds)`; the flight stops at `crashPoint`.
5. After the crash the server stores and reveals `serverSeed`. The round is then publicly
   verifiable.

The generation and verification code is the same module: `shared/verification.js`. The engine calls
`recomputeCrashPoint(seed, roundNo)` — there is no second implementation to drift out of sync.

---

## 3. Reproduce a verification yourself

### In the app

1. Open **Rounds** in the navigation (`#/rounds`).
2. Pick a settled round. The panel shows the commitment, the revealed seed, timestamps and both
   checks.
3. The **Reproduce it yourself** panel is pre-filled and pre-run. Change one character of the seed
   (or the crash value) and press **Verify locally** — both checks turn red.

### With `curl`

```bash
# Latest settled round
curl -s "http://localhost:3001/api/rounds?limit=1"
# Its record and verification
curl -s "http://localhost:3001/api/rounds/<roundId>" | jq .
curl -s "http://localhost:3001/api/rounds/<roundId>/verify" | jq .verification
```

### Independently, with Node

```bash
node -e "
const { createHash } = require('node:crypto');
const seed = '<64-char serverSeed from the round record>';
const roundNo = <roundNo>;
const seedHash = createHash('sha256').update(seed).digest('hex');
const roundHash = createHash('sha256').update(seed + ':' + roundNo).digest('hex');
const u = parseInt(roundHash.slice(0, 13), 16) / 2 ** 52;
const crash = Math.max(1, Math.floor(Math.min((1 - 0.03) / (1 - u), 500) * 100) / 100);
console.log({ seedHash, crash });
"
```

The printed `seedHash` must equal the commitment shown before the round, and `crash` must equal the
recorded crash multiplier.

---

## 4. What verification proves — and what it does not

### It does prove

- The revealed seed hashes to the commitment that is stored for that round.
- The recorded crash multiplier is exactly the deterministic result of the revealed seed and round
  number under the documented algorithm.
- Anyone with the same data and an independent SHA-256 implementation gets the same answer.

### It does **not** prove

- That the server chose the seed before betting. A hash is only a commitment; the operator controls
  both the seed and the record of when the hash was shown.
- That the commitment was not replaced. There is no external timestamp, transparency log or
  third-party witness in this demo.
- That the timings shown are truthful. They come from the same server clock.
- That the game is fair, certified, licensed or audited. It is none of those things.
- That past records will persist. Clearing the demo database removes them.

An operator could, in principle, generate many seeds, pre-compute outcomes and publish a favourable
commitment, or rewrite local records. This scheme makes casual tampering detectable; it is **not** a
trustless system and does not remove the need to trust the operator.

---

## 5. Limitations

1. **No independent audit or certification.** Nothing here has been reviewed by a testing lab,
   regulator or auditor.
2. **Operator-controlled entropy and records.** The server generates seeds and owns the database.
3. **No external proof of commitment timing.** The published hash is only as trustworthy as the log
   that contains it.
4. **Demo-scale persistence.** SQLite, local deployment; no immutable or replicated ledger.
5. **Timing is server-reported.** Latency and clock accuracy are not attested.
6. **No RTP certification.** The 3% demo edge and the distribution are documented, not certified.
7. **Virtual credits only.** No real-money deposits, withdrawals, wagering or payment integrations
   exist, and credits cannot be redeemed.

---

## 6. What a real-money implementation would additionally need

- An accredited lab's RNG, game-math, RTP and integration certification for the exact build.
- Externally witnessed commitments (e.g. transparency log, regulator feed, or a published hash chain)
  so timing cannot be silently rewritten.
- Immutable, append-only, double-entry settlement records with reconciliation and retention.
- A licensed RNG/key-management design (HSM/KMS, separation of duties, published entropy source).
- Licensing, AML/KYC, responsible-gambling controls and player-fund segregation per jurisdiction.
- Independent security testing and continuous monitoring of RTP and round integrity.

See [REAL_MONEY_READINESS.md](REAL_MONEY_READINESS.md) for the full checklist. None of it is
implemented or claimed here.

---

## 7. Automated coverage

`tests/verification.test.js` and `tests/rounds.test.js` cover:

- independent SHA-256 comparison of the commitment and derivation;
- valid records, tampered seeds, tampered crash values, uppercase seeds;
- invalid seeds, round numbers, commitment hashes and crash points;
- deterministic repeated verification;
- public round lists excluding active rounds and seeds;
- round IDs, timestamps, stats and revealed seeds in detail records;
- idempotent detail/verify endpoints;
- `409` for unsettled rounds with no leakage;
- `404`/`400` for unknown and malformed IDs;
- pagination limits, invalid query parameters and backwards paging;
- fairness metadata and limitation disclosure.

Run them with `npm test`.
