# Roadmap Part 2 — POS Front End Build + Sequencing + Open Questions

Continues `ROADMAP_ENHANCEMENTS_AND_POS.md`. PLAN ONLY. Grounded in `POS_FRONTEND_RESEARCH.md` and
`_research_notes_ccrs.md`. Do the POS section AFTER Section 1 enhancements are complete.

---

## SECTION 2 — POS FRONT END (iPad, offline-first, compliant)

Prerequisite: owner confirms the platform decision (Capacitor recommended — reuses our TS compliance
cores; see research doc §1) and hardware models. Each slice = one branch + one PR.

### P0 — Platform decision + spike  [MISSING]
- Confirm Capacitor vs native SwiftUI with owner. Stand up a Capacitor iOS shell that loads a single
  screen reading a live menu snapshot from Supabase. Prove the toolchain end-to-end on a real iPad.
- Acceptance: app installs on an iPad, shows live menu data, builds reproducibly.

### P1 — Local store + append-only event log  [MISSING]
- Native SQLite (Capacitor) schema: cached menu/prices/tax rules/promotions/limits/loyalty + an
  append-only outbound event log (client UUID, device id, monotonic version/timestamp, synced flag).
- Acceptance: menu + rules cache locally; every mutation appends an immutable, idempotent event.

### P2 — Sync engine (device → Supabase)  [MISSING]
- Flush queue in order on reconnect; server upserts on client UUID (idempotent); inventory applied as
  **deltas** server-side (not absolute overwrite); ACKed events marked synced (retained until confirmed).
- Sync-status UI: online/offline, pending-queue depth, last-sync time, manual "Sync now"; health metrics.
- Acceptance: pull the network mid-sale, finish the sale offline, reconnect → sale lands once in Supabase;
  concurrent registers both decrement inventory correctly; retries never double-post.

### P3 — Cart + shared compliance cores  [MISSING]
- Wire the iPad cart to the SAME TypeScript cores the back office uses: `sales-limits-core.ts`,
  `sales-limit-gate-core.ts`, `discount-engine-core.ts`, `auto-discount.ts`, `cart-discount.ts`,
  tax calc (37% excise + sales tax), medical (RecreationalMedical) exemption path, returns.
- Product-equivalency limits (flower/concentrate/edible; infused pre-rolls = concentrate). All math
  automatic — no manual calculation anywhere. QTY>1 line semantics match CCRS Sale.CSV.
- Acceptance: limits block overselling/over-limit; discounts/taxes auto-computed; medical path zeroes both
  taxes only when DOH endorsement + MCAD card + Medically-Compliant product; returns produce correct
  inventory-adjustment events; outputs reconcile with the weekly CCRS export.

### P4 — Age/ID verification  [MISSING]
- Require 21+ verification (hardware scanner or camera ID read) before a cart can proceed; medical path
  per DOH. Block the sale UI until verified.
- Acceptance: no sale can start without verification; medical customers routed correctly.

### P5 — Hardware: scanner → printer → cash drawer  [MISSING]
- Bluetooth/USB barcode + ID scanner; ESC/POS receipt printer (Star mC-Print3-class); cash drawer kick
  via printer. Confirm exact models with owner (research doc §5).
- Acceptance: scan adds items; receipt prints; drawer opens on cash sale; graceful errors if a device is
  offline.

### P6 — Offline hardening + flaky-network test matrix + monitoring  [MISSING]
- Test: cold start offline, long-idle offline, mid-sale disconnect, partial-flush failure, storage
  pressure, clock skew. Monitor sync success/failure rate + queue depth; alert on stuck queues.
- Acceptance: documented test matrix passes; no data loss under any offline scenario; health dashboard live.

### P7 — Beauty pass + pilot  [MISSING]
- Design-system parity with the back office; polished, fast, math-free cashier UX. Pilot on ONE register
  before rollout.
- Acceptance: owner sign-off on look/feel; successful multi-day pilot with clean CCRS export for the period.

---

## SECTION 3 — GLOBAL WORKING AGREEMENTS (apply to every slice)

- One branch + one PR per slice; squash-merge to protected `main`.
- Migrations: idempotent, applied MANUALLY by owner in the Supabase SQL editor; never auto-run.
- Money in MINOR UNITS (cents) everywhere.
- ALWAYS satisfy CCRS compliance and ALL DOH cannabis rules; verify against source, never guess.
- AI/crawler output is DRAFT-ONLY and labeled as such.
- Walk the file tree before touching an area; don't assume/rebuild.
- If unsure, STOP and ask. Slices are small and independently shippable.

---

## SECTION 4 — RECOMMENDED SEQUENCE (overview)

1. Section 1 enhancements E1→E13 (owner may reprioritize order; E4 strain types and E7 manifest are
   compliance-adjacent — do carefully with CCRS verification).
2. Then POS P0→P7. P0 (platform decision) gates everything else.

---

## SECTION 5 — OPEN QUESTIONS FOR OWNER (must answer before building)

POS:
1. Approve **Capacitor** (recommended — one shared compliance brain) or require fully-native SwiftUI?
2. Exact hardware models (printer / scanner / cash drawer)?
3. Payments at launch: cash-only or add a cashless/debit processor (which)?
4. How many registers run concurrently (inventory-conflict test scope)?
5. Loyalty: reuse website loyalty data on the POS, or POS-local at first?

Enhancements:
6. E4: are "indica leaning hybrid" / "sativa leaning hybrid" for OUR display/filter only, with CCRS export
   mapped to the nearest CCRS-accepted base category? (Recommended, pending final CCRS value check.)
7. E11: OK to split the crowded "Operations" group (e.g., Operations / Compliance / Finance) — approve the
   proposed grouping before merge?
8. E8 clean-slate: confirm the exact definition of "test data" (a specific test menu upload, the accepted
   test JSONs, and test sales) and that soft-delete + audit log is acceptable.
9. E1 marketing AI: confirm GPT-4o as the model and that web-research grounding + DOH ad guardrails are
   the required behavior.
