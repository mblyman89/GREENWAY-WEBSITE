# Greenway POS — Audit & Documentation Program

> **Start here.** This folder is the single source of truth for the full-scope audit of the
> Greenway platform (Next.js + Supabase POS / back office / website for WA I-502 retailer
> license 413541, Port Orchard). It is written to be equally usable by the OWNER (a
> self-described novice — plain English first) and by an AI ASSISTANT in a future session
> (stable IDs, file+line references, machine-scannable conventions).

---

## Why this exists

- Cultivera (the incumbent POS) renews **October 31, 2026**. The platform must be
  audit-hardened, stress-tested, and cutover-ready before that date (~3.5 months of runway
  from mid-July 2026).
- Scale at kickoff: ~280,000 lines across 1,114 TS/TSX files, 73 pure logic cores in
  `src/lib/pos/`, 152 vitest compliance files, 36 API route groups, 126 SQL migrations —
  built in under a month. Speed built it; this program makes it trustworthy.

## The four deliverables (living Markdown now, polished PDFs at the end)

| Doc | Path | Purpose |
| --- | --- | --- |
| **System Behavior Bible** | `bible/` (one chapter per feature) | Exactly how each feature is SUPPOSED to behave, verified against code — the owner's reference for spotting misbehavior during testing. |
| **Audit Findings** | `FINDINGS.md` | Every issue found, graded and tracked to resolution. |
| **Test Plan** | `TEST-PLAN.md` | Click-by-click manual test scenarios with expected results, keyed to Bible sections. |
| **Cutover Checklist** | `CUTOVER-CHECKLIST.md` | What must be true before dropping Cultivera, sequenced backward from Oct 31, 2026. |

## Conventions (read this before editing anything)

### Finding IDs
Every audit finding gets a stable ID `GW-###` (never reused, never renumbered). Severity:

- 🔴 **CRITICAL** — can cause a legal violation, lose money, corrupt data, or block a sale
  path with no workaround. Fix before cutover, full stop.
- 🟠 **MODERATE** — wrong/fragile behavior with a workaround, or a latent bug awaiting the
  right conditions. Fix before cutover unless explicitly deferred with rationale.
- 🟡 **LOW** — cosmetic, confusing copy, minor inefficiency, deviation from convention.
- 🔵 **HARDENING** — not a bug; an opportunity to make the system tougher (validation,
  rate limits, fail-safes, monitoring).
- 🟢 **ENHANCEMENT** — new capability or UX improvement worth considering post-cutover.

Finding statuses: `OPEN` → `FIX-PLANNED` → `FIXED (PR #n, main <sha>)` or `ACCEPTED-RISK
(owner sign-off, date)` or `NOT-A-BUG (explanation)`.

### Bible chapters
- One file per feature area in `bible/`, numbered in audit order (e.g.
  `01-register-lifecycle.md`).
- Every behavioral claim carries a code reference in the form `src/path/file.ts:LINE`
  (line numbers are as-of the commit named at the top of each chapter; they drift as code
  changes — the *anchor function/const name* is the durable pointer).
- Each chapter ends with **"What SHOULD never happen"** — the misbehavior watchlist the
  owner tests against.
- Plain-English first; code detail second. The owner reads the prose; the AI reads the refs.

### Audit method (the standing rules apply here too)
1. **NEVER GUESS.** Every statement in these docs is verified by reading the code or by a
   live probe. Unverifiable claims are marked `UNVERIFIED:` and become findings.
2. Trace each feature end-to-end: UI → pure core → API route → store → DB (migration), and
   back. Note every trust boundary.
3. Record findings the moment they're seen — even mid-trace — in `FINDINGS.md`.
4. Docs live in the repo and merge through the same PR discipline as code.

### For a future AI session picking this up
- Read this README, then `FINDINGS.md` (state of known issues), then the Bible chapter for
  whatever area you're touching. `../pos_build_tracking.md` (OUTSIDE the repo, in the
  workspace) has session-by-session history.
- Verification suite (run per slice): `npx tsx scripts/compliance/run-pure-selftests.ts`,
  `npx tsc --noEmit`, eslint touched files, `node_modules/.bin/vitest run`,
  `cd crawler && python3 -m pytest -q`.
- Migrations are applied MANUALLY by the owner — never assume a migration has run.
- Money is in CENTS everywhere.

## Audit lenses (the 8 passes)

1. **Compliance & legal correctness** (WA I-502 / LCB WAC 314-55 / DOH medical) — license risk.
2. **Money correctness** — cents-only math, rounding, drawer accountability, refunds.
3. **Security & access** — PINs, device provisioning, permission walls, secrets, injection.
4. **Data integrity & offline** — sync queue, idempotency, crash recovery, duplicates.
5. **Reliability & failure modes** — network flaps, dead printer, stale menu, bad scans.
6. **Load & concurrency** — 2 registers, 10 staff, rush hour; races and collisions.
7. **Code quality & maintainability** — dead code, giant files, coverage gaps, dependencies.
8. **UX & operational readiness** — trainability, human error messages, foot-guns.

## Progress tracker

| Area | Bible chapter | Audit lenses done | Status |
| --- | --- | --- | --- |
| POS register lifecycle (device, lock, unlock, drawer) | `bible/01-register-lifecycle.md` | 2,3,4,5 (first pass) | DRAFTED (findings GW-001…GW-007) |
| POS sale flow (age gate → cart → tender → receipt) | `bible/02-sale-flow.md` | 1,2,3,4,5 (first pass) | DRAFTED (finding GW-008) |
| POS medical sales | `bible/03-medical-sales.md` | 1,2,3,4,5 (first pass) | DRAFTED (finding GW-009) |
| POS offline sync & event queue | `bible/04-offline-sync.md` | 1,2,3,4,5 (first pass) | DRAFTED |
| POS returns / voids / holds / pickups | `bible/05-returns-voids-holds.md` | 1,2,3,4,5 (first pass) | DRAFTED |
| Loyalty & members | `bible/06-loyalty.md` | 1,2,3,4,5 (first pass) | DRAFTED |
| Menu pipeline (back office → register bundle) | `bible/07-menu-pipeline.md` | 1,2,3,4,5 (first pass) | DRAFTED |
| Back office: staffing & time clock | `bible/08-staffing.md` | 1,2,3,4,5 (first pass) | DRAFTED |
| Back office: inventory / catalog / purchasing | `bible/09-inventory.md` | — | QUEUED |
| Back office: reports & day close | `bible/10-reports.md` | — | QUEUED |
| Compliance: CCRS reporting & audit trails | `bible/11-ccrs-compliance.md` | — | QUEUED |
| Website / checkout / orders → POS pickup | `bible/12-website-orders.md` | — | QUEUED |
| Payroll & banking (S-10 walls) | `bible/13-payroll.md` | — | QUEUED |
| Auth & admin permissions | `bible/14-auth-permissions.md` | — | QUEUED |
