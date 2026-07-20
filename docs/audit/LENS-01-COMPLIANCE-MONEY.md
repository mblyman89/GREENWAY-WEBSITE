# Lens Pass 1 — Compliance, Money & Data Integrity

**Scope:** WA I-502 / WAC 314-55 compliance surfaces (CCRS Sale.csv, LIQ-1295
excise return, wa-tax report, medical/DOH exemptions, sales limits), all money
math (pricing, taxes, rounding, refunds, drawer), and money-adjacent data
integrity (idempotency, concurrency, period bucketing).

**Basis:** every claim below was verified by reading the code at main commit
`41d908b3` (branch `lens-01-compliance-money-integrity`). File:line anchors are
as-of that commit. Standing rule: NEVER GUESS — nothing here is inferred.

**Fix policy (owner's direction):** ALL fixes are deferred until the full
audit finishes; this pass only documents. Findings are logged in
`FINDINGS.md` as GW-010…GW-016 and ordered below from most severe to least,
ending with value-adds.

---

## 1. The one Critical finding

### GW-010 — Compliance exports tax the tax-INCLUSIVE price (Sale.csv, Sage, return corrections)

The whole system prices "out the door": the number on the product card already
contains all tax, and the true pre-tax base is that price divided by 1.463
(cannabis) or 1.093 (non-cannabis) — verified at
`src/lib/orders/order-pricing-core.ts:11,36–39` and the column comment in
migration `0007_slice7_orders.sql:138` ("tax-inclusive").

But the CCRS Sale.csv builder (`src/lib/compliance/ccrs-sales.ts:337–364`),
both Sage exports (`sage50.ts:254–263`, `sage-exports.ts:346–360`), and the
return-correction snapshots (`disposition.ts:575–618`) all take the stored
line price AS IF it were pre-tax and multiply the tax rates on top. On a
$10.00 cannabis line the register really collected $6.84 base + $3.16 tax;
the Sale.csv row would claim $0.93 sales tax + $3.70 excise — tax computed on
the wrong, bigger number.

Three aggravators, all verified:

1. Only `wa-tax.ts` routes through the corrective `normalizeTaxableBase`
   (`wa-tax.ts:369`); the other four consumers never call it, so the DB
   setting `tax_base_mode = 'tax_inclusive'` fixes only one of five surfaces.
2. The default mode is `'pre_tax'` (`tax.ts:60`) and even `'auto'` gets it
   wrong: the detector (`tax.ts:137–159`) checks whether the order HEADER fits
   `total = subtotal + tax` — which it always does here, because the header
   subtotal is already backed out — so it concludes "pre-tax" even though the
   LINE prices are inclusive.
3. Sale.csv `UnitPrice` prints the tax-inclusive regular price
   (`ccrs-sales.ts:344`), but the store's own guide says UnitPrice is one
   unit's price "before discount/tax" (`docs/CCRS_SELF_REPORTING_GUIDE.md:78`).

Why Critical: the weekly CCRS upload would overstate collected tax ~46% on
cannabis lines, and it would contradict the monthly LIQ-1295, whose Box 1
correctly uses the backed-out pre-tax subtotal
(`excise-return.ts:119–131`). Two filings to the same regulator telling two
different stories is the definition of audit exposure — before any real sale
has even happened. The medical engine already does this right
(`medical-sale-core.ts:196–204` divides by the category divisor), so the fix
is applying an existing, proven pattern to five call sites plus self-tests.

**No data has been harmed yet** — the store has not cut over, so this is a
fix-before-cutover item, not a cleanup.

---

## 2. Moderate findings (fix before cutover, one concurrency slice + one period slice)

### GW-011 — Completion race: no compare-and-swap, latches without unique indexes
`setOrderStatus` reads the status, then updates filtering only on `id`
(`orders-store.ts:287–291, 331–334`). Two simultaneous completions both see
"not completed yet" and both fire the side effects. Each side effect's
idempotency latch (inventory: `sale-decrement.ts:54–60` check, `:191` insert
at the very END; loyalty earn: `loyalty-store.ts:261–267`; void restock:
`void-store.ts:194–200`) is check-then-insert with NO unique index behind it
(`0007_slice7_orders.sql:161` and `0039_loyalty_engine.sql:139–140` are
non-unique). Result under a race: double inventory decrement, double points.
Fix shape: CAS on the status flip + partial unique indexes + insert-marker-first.

### GW-012 — Inventory quantities are read-modify-write
Every on-hand change is SELECT → compute in JS → unconditional UPDATE
(`sale-decrement.ts:121, 166–170`; `void-store.ts:227–228, 257–261`;
`disposition.ts:255–258, 291–294`). Two different orders on the same lot can
lose one order's decrement entirely; nothing stops negative quantities
(`0023_pos_inventory_lots.sql:102` — plain numeric, no check). Fix shape:
atomic SQL deltas (`set qty = qty - $d where qty >= $d`) + a non-negative
check constraint.

### GW-013 — LIQ-1295 uses UTC month bounds; everything else is Pacific
`excise-return-core.ts:139–142` builds `Date.UTC` bounds while wa-tax buckets
by `pacificMonthKey` (`wa-tax.ts:143`) and CCRS uses the Pacific day —
`docs/PERIOD_BASIS.md:4` says Pacific is canonical. Every month-boundary
evening (4/5 PM–midnight Pacific) lands in different months on different
reports. Same family as GW-009; same known fix pattern.

### GW-014 — LIQ-1295 Box 1 includes non-cannabis subtotal
Box 1 sums the whole-order header subtotal (`excise-return.ts:119–131`), so a
t-shirt or lighter in an order gets 37% excise applied to it. Direction of
error is overpayment (legally safe, financially not). Fix: build Box 1 from
cannabis-category LINES using the same shared pre-tax base helper GW-010
introduces.

**Suggested fix grouping:** GW-010 + GW-014 are one "tax base" slice
(shared per-line pre-tax helper); GW-011 + GW-012 are one "concurrency"
slice (one small migration + code); GW-013 joins GW-009 in a "Pacific period
basis" slice.

---

## 3. Low findings

### GW-015 — Internal dashboards count never-completed orders as revenue
Sales/COGS/Customers/Analytics filter only `status !== "cancelled"`
(`sales.ts:243`, `cogs.ts:341`, `customers.ts:188`, `analytics.ts:137–140`),
so `no_show` and gate-refused exception orders (which still carry
device-claimed totals) inflate internal gross vs. the completed-basis
compliance reports. Internal-only; label or align the basis.

### GW-016 — 28 vs 28.35 grams-per-ounce duplication
Recreational limit enforcement correctly uses the statutory 28 g/oz
(`sales-limits-core.ts:28`); the medical limits table uses metric 28.35
(`medical/tax.ts:206–215`), plus a third 28.3495 in
`employee-sample-core.ts:78`. Enforcement is correct where it is
licence-critical; name the two constants in one shared module so nobody
"fixes" the wrong one later.

---

## 4. Verified GOOD — things the lens checked hard and found sound

These are documented so future sessions don't re-litigate them, and so the
owner knows what is already protecting him:

- **Server never trusts device money for a completed sale.** POS sync inserts
  orders as `ready` with device totals (`sync-store.ts:522–534`) but the
  completion gate recomputes the money from stored lines and blocks >2¢ drift
  (`completion-gate.ts:121–125` → `order-pricing.ts:361+`,
  `moneyMatches` tolerance ±2¢ at `order-pricing-core.ts:163`). Pickup
  completion runs the identical gate. Every compliance report filters
  `status = 'completed'`, so unverified money cannot reach a filing.
- **Website orders are fully server-repriced** and refused on total mismatch
  (`api/orders/route.ts:82–103`).
- **Sync ingest is DB-level idempotent**: `pos_sale_events.client_uuid` is
  UNIQUE (`0120_pos_foundation.sql:51`) and 23505 converges retries to a
  duplicate-ack (`sync-store.ts:214–224`). A retried flush can never create a
  second order.
- **Loyalty redemption claim is atomic** — a conditional update on
  `status = 'issued'` (`sync-store.ts:675`), not check-then-write.
- **Integer money everywhere it counts**: pricing core, change calc, till
  math, day report, receipts are integer-cents with self-tests; the one float
  (`subtotalFloat`, `order-pricing-core.ts:147–149`) is rounded exactly once
  and tax is derived as `total − subtotal`, keeping the header identity exact.
- **B33 cash rounding** is computed on the post-tax total and reported as its
  own row; gross stays pre-rounded (`day-report-core.ts`).
- **Refund math is exact**: returns refund the stored inclusive price × qty,
  points clawback is proportional, floored, and cumulative-safe
  (`returns-core.ts:195–280`); voids are same-day and cancelled orders never
  reach Sale.csv.
- **CCRS dates are Pacific-correct** (`ccrs-batch-core.ts` uses
  `pacificDayKey`), and the medical exemption path computes its pre-tax base
  correctly (`medical-sale-core.ts:196–204`).
- **LIQ-1295 arithmetic** mirrors the LCB sheet (round2 at each box,
  `excise-return-core.ts:90–116`); the issues found are its INPUTS
  (GW-013 period bounds, GW-014 Box 1 composition), not its math.

---

## 5. Recommended fix order for this lens (when fixes begin)

1. **GW-010 (+GW-014)** — shared per-line pre-tax base for CCRS/Sage/
   disposition/LIQ-1295 Box 1; UnitPrice pre-tax; reconciliation self-tests.
2. **GW-011 + GW-012** — status CAS, partial unique indexes, atomic quantity
   deltas, non-negative check (one small migration for the owner to apply).
3. **GW-013 (+GW-009)** — Pacific period basis for LIQ-1295 and the medical
   sale-date stamps.
4. **GW-015** — dashboard basis label/alignment.
5. **GW-016** — named grams-per-ounce constants (pure refactor).
6. Enhancements from earlier passes (GW-007 etc.) remain post-cutover.
