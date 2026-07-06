# GREENWAY COMPLIANCE ROADMAP — Sliced Work Plan (AI-Ready)

> Companion to `docs/GAP_AUDIT.md` (findings) and `docs/COMPLIANCE_BIBLE.md` (rules).
> Each slice is sized to be built in one branch → PR → squash-merge, drafts-only where AI
> is involved, with **idempotent migrations applied manually by the owner**. Order matters:
> Phase A gates real sales; Phase B is go-live hygiene; Phase C is hardening.
> Every slice ends with proof (test or manual verification script) — never guess.

---

## PHASE A — Sale-path integrity (BLOCKERS before any real sale)

### S-1. Wire the sales-limit gate (GAP H-1) — priority 1
1. **S-1a Placement soft-check:** in `POST /api/orders`, resolve each line to a WAC bucket
   (category → `unit_grams_json`/engine defaults; med vs rec from order context) and call
   `enforceSalesLimitForSale`. Over-limit ⇒ annotate order (`limit_flag`) + surface a
   polite "we'll adjust at pickup" note to the customer; write `sales_limit_events`.
2. **S-1b Completion hard gate:** in the `→ completed` transition (admin orders action),
   re-evaluate; `verdict.allowed === false` + `hard_block` ⇒ REFUSE completion with the
   per-bucket overage list; manager override = separate permission + reason + audit +
   `sales_limit_override` row.
3. **S-1c Category mapping:** verify every menu/inventory category maps to a bucket
   (incl. the topical→liquid question flagged in notes); unknown category ⇒ treat as
   useable (conservative) + admin warning.
4. **S-1d Tests:** unit tests on the wiring + e2e proving an over-limit cart is refused
   and an override is audited. UI: budtender-facing limit gauge (Cova pattern) later (S-16).

### S-2. Server-authoritative money (GAP H-2) — priority 1, pairs with S-1
1. **S-2a Reprice at placement:** server looks up each variant's price in the CURRENT
   published menu version + recomputes discounts server-side (reuse `computeCartDiscounts`
   with Pacific weekday — after S-12 fix); client totals become a cross-check; mismatch
   beyond rounding ⇒ 409 with fresh prices.
2. **S-2b Completion recompute gate:** before `completed`, recompute subtotal/tax from
   lines; discrepancy ⇒ block with fix-first message; edits only via priced server actions.
3. **S-2c RLS tightening (migration, idempotent):** drop/narrow `orders_public_insert` +
   `order_lines_public_insert` (placement via service-role API route or SECURITY DEFINER
   RPC that prices internally).
4. **S-2d Tests:** tampered-body e2e (wrong price, wrong tax, $0 line) all rejected;
   golden-file test asserting wa-tax + ccrs-sales outputs from a seeded order set.

### S-3. Global cannabis price floor + promo mechanics review (GAP H-3)
1. Floor in ONE shared function: `assertCannabisLineSellable(line)` — unit price > $0 AND
   ≥ acquisition cost (lot cost where linkable; else configured floor). Called from the
   cart engine, the promotions engine, loyalty redemption, and S-2 server reprice.
2. Promotions: cap `getPercent` < 100 for cannabis targets; `basketNforM` converts to an
   equivalent % spread across the basket; true freebies restricted to merch.
3. Rework "Ice Cream Sunday" as ~33%-off-basket-of-3; update promo copy; owner/legal review
   of all seven daily-deal descriptions against WAC 314-55-155.
4. Loyalty: tier/redemption application clamped by the same floor.
5. Tests: self-tests updated (the BOGO test currently ASSERTS $0 — flip it), engine unit
   tests, e2e coupon-stacking case.

---

## PHASE B — Go-live hygiene (before opening day on this POS)

### S-4. Compliance re-scan at accept (GAP M-1) + crawler parity (M-2a)
- Shared helper `acceptWithComplianceGate(suggestion)` used by all FIVE accept paths
  (vendor, brand, blog, product single, product bulk): run `checkCompliance`; blocking ⇒
  refuse with flags (force edit); warnings surfaced. Audit records the scan result.
- Re-sync `crawler/app/compliance.py` to `compliance.ts`; export patterns to a shared JSON
  fixture; CI parity test so drift fails the build.

### S-5. Crawler least-privilege + SSRF (M-2b)
- Scoped DB credential (dedicated role: INSERT ai_suggestions, SELECT kb_banned_phrases)
  or proxy writes through a site API route. Block private/link-local/loopback IPs +
  non-http(s) schemes in `fetch_page`; require `CRAWL_ALLOW_DOMAINS` in production config.

### S-6. Retention guard on reset (M-3)
- Migration (idempotent): `reset_operational_data` refuses when completed non-test orders
  or recorded CCRS submissions exist, unless called with an explicit
  `acknowledge_wac_314_55_087 := true` argument; app action adds an export-first
  attestation checkbox + escalated typed confirm naming the rule.

### S-7. Kill the `.in()` truncation family (M-4)
- One `chunkedIn()` helper (500-id chunks, loop, merge) replacing every capped `.in()` in
  wa-tax, sales, cogs, customers, receipts, sage exports, analytics, ccrs-sales.
- Regression test with >2,000 synthetic orders proving totals are complete.

### S-8. Medical tax cross-wiring (M-5) — required before medical endorsement launch
- wa-tax joins `medical_exempt_sales` to zero excise/sales tax on valid exempt lines and
  report exempt totals separately (LIQ-1295 needs both numbers).
- CCRS Sale.csv: `SaleType=RecreationalMedical`, OtherTax=0 for exempt lines.
- Decide + document the canonical period basis (completed_at recommended) across wa-tax /
  CCRS sales / LIQ-1295 so the three always reconcile.
- Per-sale exempt record retention check: {date, patient id, card dates, SKU, price} —
  5-year query proof.

### S-9. Fail-closed env posture (M-6)
- Production mode: inbound-email + Resend/SendGrid webhooks REQUIRE their secrets (503 if
  unset); CloudPRNT requires poll token. Admin dashboard banner while any is missing.
- "Unverified sender" badge on intake-staged manifests that failed/skipped signature.

### S-10. Secrets at rest (M-7)
- Encrypt employee banking + company ACH + integration credentials (pgcrypto/pgsodium or
  app-layer envelope). `listEmployees` default select excludes banking columns; masked
  display; dedicated read path for NACHA generation only. Hash clock PINs + attempt throttle.

### S-11. Retire ungated manifest accept (M-8)
- Delete `acceptManifestAction`/`acceptManifest` or route through
  `evaluateLotBatchActivation` identically to finalize. Grep-guard test: no activation
  path without the gate.

### S-12. Pacific-pinned business time (M-9)
- Shared `storeNow()`/`storeWeekday()` (America/Los_Angeles) used by: promotions
  `isActiveNow`, audit-anomaly off-hours, receipts timestamp, any `getDay()/getHours()`
  business logic. Add **sales-hours gate**: block `completed` outside 8am–midnight Pacific
  (WAC 314-55-147) with owner-configurable tighter window.

### S-13. Sage purchases parity (M-10)
- Include `partially_accepted` manifests (accepted-lots-only cost basis) so payables and
  the Purchases export agree.

### S-14. Compliance test harness (M-11)
- Vitest + golden files: ccrs-batch-core (all 7 file types, header rows, NumberRecords),
  ccrs-sales rows from seeded orders, wa-tax excise math (incl. medical-exempt),
  sales-limits-core buckets, price floor, sample caps, naming validateName, cart-discount
  client/server parity. Wire into CI on every PR. (This is the WAC 314-55-509 mitigation
  evidence.)

---

## PHASE C — Hardening & benchmark parity (post go-live, prioritized)

### S-15. Order/PO lifecycle integrity
- Legal-transition matrix for orders (no completed→new; reversal = new event + reason);
  PO soft-delete/void + sequence-based numbering; audit rows for masters/image-substitute
  deletions.

### S-16. Budtender limit gauge + ID workflow
- Visual per-bucket limit gauge during order review (Cova pattern); ID-checked
  acknowledgment step at completion; age-verification report (Dutchie pattern).

### S-17. CCRS operations UX (benchmark parity)
- Error-reply CSV ingestion matched to archived submissions (content/time matching since
  LCB scrambles names); duplicate-error triage; POS↔CCRS inventory reconciliation report
  (BLAZE "Compliance Difference"); submission activity log UI; full-reset reference dump
  for gap recovery (Dutchie pattern).

### S-18. Compliance calendar
- Recurring tasks with dashboard nags: LIQ-1295 by the 20th; weekly CCRS window (Sun–Sat);
  CCTV 45-day retention spot-check; badge/visitor-log check; scale calibration; medical
  card expirations (when endorsed); consultant certificate renewal.

### S-19. Copy & content hardening
- Footer warning block: validate mandated sentences on save (non-removable core language).
- Advisory `lintCopy` warn-on-save for human-typed marketing surfaces (sections, carousel,
  FAQ, blog) and Midjourney/FLUX prompt briefs. Sanitize SiteText html mode.
- High-THC POS notice (RCW 69.50.357(6)) — add to receipt footer/pickup screen content.

### S-20. Misc LOWs
- Excise-rate "WA is 37%" hint + confirm on deviation; shared sales-tax-rate constant
  (settings-backed) replacing 0.093/930bps duplicates; loyalty ledger SQL-increment +
  `status='issued'` guard on redemption use; newsletter double-send cooldown; WebAuthn
  `requireUserVerification` decision; customer birthdate timezone-safe parse; concierge-KB
  "POS planned" copy refresh.

---

## Sequencing & rules of engagement
1. Order: S-1 → S-2 → S-3 (Phase A, in that order; S-1/S-2 share test scaffolding), then
   Phase B in numeric order (S-8 may defer to medical-endorsement date), then Phase C.
2. Every slice: branch → PR → squash-merge; migrations idempotent + applied manually by
   the owner (keep `docs/MIGRATIONS_TO_RUN.md` current — 0093→0094→0095 still pending
   as of this audit).
3. No slice may weaken a verified positive control (Slice-105 CCRS gate, Slice-107 lot
   gate, sample caps, drafts-only AI, audit trail).
4. Definition of done per slice: code + test/proof + GAP_AUDIT row updated with resolution
   date + one-line entry in the PR description mapping to the WAC/RCW it protects.

— END OF ROADMAP —
