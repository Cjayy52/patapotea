# Real-money readiness — what this demo deliberately does **not** do

> **This document is not legal advice.** It is an engineering/compliance checklist for planning
> discussions with qualified counsel, regulators and accredited test labs. Requirements vary by
> jurisdiction, product and operator structure, and change frequently. Nothing here authorizes a
> real-money launch.

## 1. Current status

PATAPOTEA is a **simulation**. It has:

- no payment provider integration, no card/bank/wallet rails;
- no real-money deposit, wager, payout or withdrawal endpoints;
- no cash-out of virtual credits to money or goods;
- no KYC, age verification, sanctions/PEP screening or geo-blocking;
- no licence, certification or regulatory approval.

Balances are integers in a local SQLite ledger and cannot be redeemed. The product must not be
marketed or described as real-money gambling, “free spins”, “winnings”, or anything implying value.

## 2. Licensing and jurisdiction

Before any real-money version:

1. **Determine the licensing perimeter** for every jurisdiction you intend to serve — including
   where players are physically located, not just where the company is incorporated.
2. Obtain the appropriate **gambling/remote gaming licence(s)** (e.g. national monopoly, state
   licence, MGA, UKGC, Curaçao, or a federal/state combination). Some markets require local
   establishment, a local domain, data residency, or a licensed local partner.
3. Confirm **game-type classification** (crash/betting-style game vs. casino game vs. lottery),
   permitted RTP, stake limits, jackpot rules and mandatory game information.
4. Implement **geo-location and geo-blocking** at the edge, with VPN/proxy detection and an appeal
   process. Block restricted jurisdictions and self-excluded users before any bet is accepted.
5. Maintain **licence registers**: approved game list, certified builds, change log, marketing
   approvals, and regulator correspondence.
6. Verify **advertising rules** (no targeting minors, no misleading “guaranteed win” claims,
   mandatory risk warnings, affiliate controls and age-gating of all creative).

## 3. Independent testing and certification

Before launch and after material changes:

- Engage an **accredited test lab** (e.g. GLI, BMM, eCOGRA, iTech Labs) to audit:
  - RNG design and statistical behaviour (entropy source, seeding, HMAC derivation, no bias);
  - the **crash-point distribution and published RTP**, including house edge and max multiplier;
  - the **provable-fairness scheme** (commit before betting, reveal after settlement, ability to
    independently verify hash → crash point);
  - payout calculations, rounding rules, currency and precision handling;
  - round timing and race conditions (cash-out vs. crash), including network latency policies;
  - client/server integrity: the client must not be able to influence any outcome.
- Certify **integration** against the platform/PSP and produce a **test report + certificate** per
  jurisdiction. Regulators typically require a **controlled build hash** and re-certification for any
  change to game logic or RNG.
- Publish an **RTP and game-rules page**, a fairness verification guide, and a round-verifier tool.
- Run **load and soak tests** at projected peak concurrency, including a large number of
  simultaneous cash-outs at crash boundaries.
- Establish **vulnerability disclosure** and periodic penetration testing (web, API, mobile, infra).

## 4. Security and integrity

Minimum additions expected by regulators and auditors:

- **Authentication:** MFA for players (at least for withdrawals), strong password policy, breached
  password screening, session binding, device fingerprinting, suspicious-login alerts.
- **Authorisation:** deny-by-default, per-account object checks, admin 4-eyes approval for any
  balance movement, privileged access reviews, break-glass procedures.
- **Ledger integrity:** append-only double-entry ledger, immutable settlement records, reconciliation
  jobs, per-round hash chaining, no destructive updates, full transaction audit trail with retention
  aligned to local law.
- **Concurrency correctness:** idempotency keys on every money-moving request, database-level
  guarantees for “settle exactly once”, retry-safe APIs, and documented crash-recovery semantics.
- **Clock authority:** NTP-synchronised server clocks, monotonic timers, explicit latency policy and
  a documented (small) grace window if regulators permit it. Never trust client timestamps.
- **Key management:** HSM/KMS-backed seed encryption, rotation, separation of duties, no seeds in
  logs, verifiable randomness with a documented entropy source.
- **Infrastructure:** WAF, DDoS protection, secrets management, least-privilege IAM, network
  segmentation, encrypted data at rest/in transit, centralised tamper-evident logging and SIEM
  alerting, hardened CI/CD with signed builds and dependency scanning.
- **Fraud controls:** multi-accounting detection, bonus abuse rules, collusion/bot detection,
  chargeback monitoring, velocity limits and manual review queues.
- **Resilience:** multi-AZ deployment, RPO/RTO targets, tested backups/restores, game-state
  reconciliation after failover, incident response and status communication plan.

## 5. Financial compliance and payments

- **Segregation of player funds:** hold player balances in segregated/trust accounts, with
  independent reconciliation and, where required, an audit opinion on safeguarding.
- **AML/CFT programme:** risk assessment, KYC/CIP at thresholds, source-of-funds checks, PEP and
  sanctions screening, transaction monitoring, SAR/STR filing, record retention, a named MLRO, and
  ongoing training.
- **Payments:** licensed PSPs per market, PCI-DSS scope minimisation (hosted fields/tokenisation),
  card/bank/wallet coverage, payout controls, chargeback and dispute handling, FX policy.
- **Tax:** determine gaming duty/GGR tax, VAT treatment, player tax withholding/reporting, and
  jurisdiction-specific reporting.
- **Responsible-finance controls:** deposit limits enforced at the payment layer, not just the UI;
  no credit; no lending; cooling-off periods; blocked players cannot transact.
- **Reporting:** regulator data feeds (e.g. real-time betting/settlement reporting), annual audits,
  and key-event notifications for outages or integrity incidents.

## 6. Responsible gambling

Required for a credible launch:

- **Age verification** (18+/21+ per market) before account activation or deposit; no marketing to
  minors.
- **Player-set limits:** deposit, wager, loss and session-time limits, with cooling-off before
  increases take effect.
- **Reality checks** (session duration and net-loss reminders), session summaries, and visible
  clock/round counters.
- **Self-exclusion:** local and national registers (e.g. GAMSTOP, state schemes), enforced across
  products, marketing and affiliates; no reactivation during the exclusion period.
- **Time-out / cool-off** self-service, with clear consequences.
- **Staff training** to recognise and escalate harm indicators; a documented intervention process.
- **Signposting** to independent support organisations, helplines and treatment providers.
- **Vulnerability safeguards:** indicators for chasing losses, rapid re-deposits, prolonged play and
  large stake escalation; mandatory breaks or manual review.
- **Product design review:** no autoplay-by-default, no loss-masking language, no “near-miss”
  celebration that misrepresents outcomes, and clear disclosure of the house edge.

## 7. Data protection and player rights

- GDPR/CCPA-grade privacy notices, lawful bases, data-minimisation and retention schedules.
- Data subject rights (access, rectification, erasure where applicable, portability) with SLAs.
- Consent management for marketing, cookies and analytics; no dark patterns.
- Data residency/localisation where required; vendor/sub-processor due diligence and DPAs.
- Breach detection and 72-hour notification procedures.
- Special-category/health data avoided; gambling-harm data handled with strict need-to-know access.

## 8. Operations and governance

- Documented **game rules**, RTP, max win, void-round policy, outage compensation and dispute
  resolution; publish a complaints procedure with an independent ADR/ombudsman route.
- **Change management:** every change to RNG, math, limits or settlement goes through review,
  testing, certification and a controlled release with rollback.
- **Monitoring:** real-time dashboards for RTP deviation, round integrity, settlement lag, failed
  cash-outs, balance mismatches and abnormal win patterns.
- **Incident response:** runbooks for RNG compromise, ledger mismatch, payment outage, data breach
  and regulatory notification; regular game days.
- **Business continuity:** tested DR, documented RTO/RPO, communication templates.
- **Staffing:** compliance officer/MLRO, security lead, internal audit or independent review.

## 9. Pre-launch gate (summary)

A real-money launch should be blocked until **all** of the following are true:

- [ ] Licence(s) granted for every served jurisdiction; geo-blocking live and tested.
- [ ] Independent RNG/game/RTP certification obtained for the exact build hash.
- [ ] Security penetration test closed with no critical/high findings.
- [ ] Double-entry ledger, idempotent settlement and reconciliation signed off by finance.
- [ ] KYC/AML/sanctions/fraud controls live; MLRO appointed; staff trained.
- [ ] Segregated player funds and payment rails operational; PCI scope documented.
- [ ] Responsible-gambling limits, self-exclusion, reality checks and support signposting live.
- [ ] Privacy notices, DPA/records, retention and data-subject workflows operational.
- [ ] Monitoring, alerting, incident response, DR and complaint/ADR processes tested.
- [ ] Marketing and affiliate materials approved and age-gated.
- [ ] Tax treatment and regulator reporting confirmed.
- [ ] Legal sign-off that the product and its presentation comply in each market.

## 10. Where this codebase would extend (and where it must not)

The current architecture was kept modular for a *future, separately authorized* evaluation:

- `shared/game-math.js` isolates outcome generation; a certified RNG/HMAC scheme could replace it
  behind the same interface, subject to re-certification.
- `CrashEngine` already separates rules/timing from transport and persistence.
- `SqliteRepo` implements a narrow repository contract; a regulated deployment would use a
  double-entry ledger service with idempotency keys and append-only audit storage.
- `client/src/api` is an adapter layer; a real backend would sit behind the same calls.

**Do not** simply add a payment provider, flip a “real money” flag, or reinterpret virtual credits as
redeemable value. Any real-money version requires the licensing, certification, financial and
responsible-gambling work above — and explicit authorization — before a single real stake is accepted.
