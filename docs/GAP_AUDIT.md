# GREENWAY GAP AUDIT — Mission-Critical Compliance Findings (2026)

> **Scope.** Every file in the repo was read/traced (src/lib, src/app incl. all actions
> and routes, src/components sweep, all 95 migrations, crawler worker, docs, e2e, config).
> Regulatory basis: `docs/COMPLIANCE_BIBLE.md`. Full per-file trace notes:
> `research/notes/phase3-system-inventory.md` (workspace). Ratings: **HIGH** = could
> directly cause a violation / license jeopardy in production; **MED** = compliance-adjacent
> or one-mistake-away; **LOW** = hardening/hygiene.
>
> **Headline:** the architecture is genuinely strong — drafts-only AI, permission+audit on
> every mutation, a fail-closed CCRS submit gate, hard-capped samples, WAC-exact limit
> defaults, lot-activation gating, 2× cost price floor on drafts. But **two HIGH gaps mean
> the two most important sale-time protections are not actually connected**, and a family
> of promo mechanics can produce $0 cannabis. Fix those and this system is defensible.

---

## HIGH — must fix before any real sale

### H-1. The sales-limit gate exists but is WIRED TO NOTHING
- `src/lib/compliance/sales-limits.ts` exports `enforceSalesLimitForSale()` — self-described
  "authoritative POINT-OF-SALE gate … the sale path must refuse to commit when
  verdict.allowed is false." **grep across the entire repo: zero callers.**
- Neither `POST /api/orders` (guest placement) nor the admin `setStatusAction → completed`
  (pickup completion) ever evaluates a cart against WAC 314-55-095. The owner-tunable
  settings page, the pure engine (defaults exactly match statute), the override logging,
  and the `sales_limit_events` table all exist and are correct — **but no sale is ever
  actually checked.** Selling over limit is a Category III violation (WAC 314-55-522).
- Confirmed at schema level: `sales_limit_events` (0045) has no writer in any sale path.
- **Fix (Roadmap S-1):** soft-evaluate at placement; HARD gate at the completed-status
  transition with permission-gated manager override; resolve WAC buckets from menu/lot
  category + unit grams; write `sales_limit_events`; e2e test proving an over-limit cart
  is refused.

### H-2. Client-supplied money is persisted verbatim and flows into the 37% excise math and the CCRS Sale.csv
- `components/checkout/CheckoutFlow.tsx` computes every number in the browser
  (`CartProvider` does all tax math client-side) and posts `subtotal/estimatedTax/savings/
  total` + per-line `priceMinorUnits`/`regularPriceMinorUnits`. `POST /api/orders` →
  `orders-store.createOrder` persists them **verbatim**; `setOrderStatus(→completed)` does
  NO reprice.
- Downstream blast radius: `lib/reports/wa-tax.ts` (LIQ-1295 excise figures) and
  `lib/compliance/ccrs-sales.ts` (LCB Sale.csv) both read `order_lines.price_minor_units` —
  i.e., attacker-tamperable numbers feed the state tax return and the state traceability
  file. Loyalty accrual also uses the stored subtotal.
- **Worse at the DB layer:** migration 0007 RLS allows the ANON key to insert orders
  (`status='new'`) and `order_lines` with `check (true)` — tampering doesn't even need the
  API route.
- Mitigations today: pickup is staff-confirmed, no online payment, `normalizeTaxableBase`
  catches tax-inclusive anomalies. Nothing recomputes price × the published menu.
- Remember the LCB tax guide: *"Retailers are responsible for paying uncollected excise
  tax if the tax rate is not correctly set up in their systems."*
- **Fix (Roadmap S-2):** server-side reprice at placement from the published menu version
  (reject/clamp mismatches); completion-time recompute gate (discrepancy ⇒ block with
  fix-first message); order edits only through priced server actions; tighten/remove the
  anon insert RLS (service-role placement or RPC).

### H-3. Free-cannabis exposure: three independent mechanisms can price a cannabis line at $0
- WA prohibits giving away cannabis at retail; below-acquisition-cost selling is Category IV
  (WAC 314-55-523; RCW 69.50.357). Three code paths can hit $0:
  1. **Sunday "Ice Cream Sunday" 3-for-2** (`specials/cart-discount`): cheapest unit free —
     `Math.max(0, regular − savings)` can floor a line at $0; promo copy "buy 3 for the
     price of 2" is itself a compliance question.
  2. **Promotions engine BOGO** (`promotions`): default `getPercent: 100` + `basketNforM`;
     the self-test literally asserts `unitPriceMinorUnits === 0`; stackable promos compound.
  3. **Loyalty**: tier discounts up to 100% + redemption value at checkout.
- The 2×-cost floor exists on the catalog-draft pricing path, but the discount engines
  operate AFTER pricing and have no floor.
- **Fix (Roadmap S-3):** one global "cannabis unit price must be > $0 AND ≥ acquisition
  cost" floor in the cart engine AND at server reprice (pairs with S-2); cap cannabis promo
  percent < 100 / restrict true freebies to merch; rework Sunday deal as an equivalent %
  (~33% off basket of 3); legal review of promo copy.

---

## MED — fix before/at go-live

| # | Finding | Where | Why it matters / Fix |
|---|---|---|---|
| M-1 | **AI-suggestion ACCEPT paths never re-run checkCompliance** — confirmed on FIVE paths: vendor, brand, blog, product single accept, product bulk accept. One click publishes crawler-scanned (drifted) copy to public advertising surfaces. | `admin/{vendors,blog,products,products/bulk-ai}/actions.ts` | WAC 314-55-155 exposure. One shared fix: re-run `checkCompliance` at accept; block on blocking flags. (Roadmap S-4) |
| M-2 | **Crawler compliance mirror has drifted** from `compliance.ts` (missing therapeutic/physiological-claim blocks, etc.); no parity test. Plus crawler holds a **full service-role key** and its **domain allow-list ships empty (SSRF)**. | `crawler/app/compliance.py`, `config.py`, worker deploy | Re-sync patterns; add CI parity test (shared JSON fixture); scoped DB role; block private-IP/non-http fetches + set `CRAWL_ALLOW_DOMAINS`. (S-4/S-5) |
| M-3 | **`reset_operational_data` would destroy 6-year records** if ever run after real trading (sales, inventory, CCRS batches). Typed confirm exists but no production guard. | migration 0069 + settings action | WAC 314-55-087 (Cat IV). Guard: block when CCRS submissions/completed real sales exist, or require export-first attestation naming the rule. (S-6) |
| M-4 | **Silent `.in()` truncation** — wa-tax/sales/cogs/receipts cap at first 2000 order ids (1000 lots elsewhere). A busy month range silently DROPS lines from tax figures. | `lib/reports/*`, `ccrs-sales.ts`, sage exports | Understated LIQ-1295/excise = licensee liability. Fix: chunked pagination (pattern already exists in menu-version.ts). (S-7) |
| M-5 | **Medical-exempt sales counted at full excise** in wa-tax; medical launch would over-remit and mismatch CCRS `RecreationalMedical` rows; also canonical period basis (placed_at vs completed_at) not unified across wa-tax / CCRS / LIQ-1295. | `lib/reports/wa-tax.ts` | Cross-wire `medical_exempt_sales` before medical endorsement goes live; document one period basis. (S-8) |
| M-6 | **Fail-open when secrets unset**: inbound-email webhook, Resend/SendGrid webhooks skip signature checks with a console.warn; CloudPRNT allows all requests until a poll token is set (receipt bodies contain customer name/phone). | `api/webhooks/*`, `api/inbound-email`, `api/cloudprnt` | Set-and-forget env risk. Fail CLOSED in production (require secrets), or hard startup warning + admin banner. (S-9) |
| M-7 | **Plaintext secrets at rest**: employee bank routing/account + company ACH account (0057/0093), integration API secrets (0053), staff clock PINs. `listEmployees` selects `*` so banking flows wherever employees render. | payroll/integrations stores | Privacy/fraud (not LCB). Encrypt at rest or column-restrict + masked reads. (S-10) |
| M-8 | **Legacy `acceptManifest()` bypasses the lot-activation gate** (activates ALL quarantine lots, failed-lab included). UI now uses the gated finalize path only, but the ungated action remains exported/invokable. | `admin/inventory/intake/actions.ts` | Retire it or route through `evaluateLotBatchActivation`. (S-11) |
| M-9 | **Promotions weekday uses server-local time** (`isActiveNow` → `getDay()`), while the storefront is Pacific-pinned — advertised deal ≠ charged deal ~7–8h/day on UTC servers. Same family: audit-anomaly off-hours detection uses server-local hours. | `lib/promotions`, `audit-anomaly-core` | Advertising-integrity risk. Pin all business-day logic to America/Los_Angeles. (S-12) |
| M-10 | **Sage purchases export omits `partially_accepted` manifests** that the payables store treats as payable — books inconsistency. | sage-exports | Include partially_accepted with accepted-lots-only cost basis. (S-13) |
| M-11 | **Zero automated tests for compliance math** — the only test in the repo is a 4-case public-site smoke. No tests for excise, CCRS CSV shape, sales limits, price floor, sample caps. | e2e/ | Golden-file + unit tests are the cheapest license insurance and a formal WAC 314-55-509 mitigator. (S-14) |

## Notable LOWs (bundled into hardening slices)
- `setOrderStatus`/PO status: no transition matrix (completed→new possible); PO hard-delete;
  PO numbering race. Masters/image-substitute/marketing hard-deletes without audit.
- Excise-rate setting accepts any bps with no "WA is 37%" hint (fat-finger risk; audited though).
- Footer warning block is editable rich text — validate mandated sentences on save.
- Loyalty ledger races (balance cache, redemption double-use window); newsletter double-send guard.
- SiteText `dangerouslySetInnerHTML` (staff-authored) — sanitize.
- Hardcoded 9.3% local tax in two places (client 0.093 / server 930bps) — one settings-backed constant.
- WebAuthn `requireUserVerification:false`; PIN attempts unthrottled at store layer.
- CCTV 45-day retention & scale-calibration have no compliance-calendar reminders.
- Customer birthdate parse (`new Date`) can drift a day on UTC servers.

## Positive controls verified (keep these; they are your WAC 314-55-509 mitigation story)
- **CCRS submit hard-gate (Slice 105)** — consolidated sync issues + offline verifier;
  any blocking error ⇒ HTTP 409, zip never created. Fails closed.
- **Lot activation gate (Slice 107)** — failed/missing lab ⇒ quarantine, on the actual UI path.
- **Sample caps hard-enforced** per WAC 314-55-096; customer samples impossible by design.
- **Limits settings owner-only** with statute-exact defaults; **2× cost price floor** on drafts.
- **Drafts-only AI everywhere** with compliance scan + provenance; KB writeback re-scans.
- **Permission + recordAudit on every mutation**; last-owner lockout protection; anomaly engine.
- **Naming convention engine** (75-char cap, no commas, derived-only cannabinoid tags).
- **Medical report card-validity audit**; COA archive; manifest event chain of custody.
- **Footer warning text matches WAC-mandated language**; age gate; honest "representative image" badges.
- **ACH hard-gated on source documents**; typed-confirm destructive ops; soft-delete pattern for types.

## Resolution log (per Roadmap "definition of done" — findings above kept verbatim)

| Finding | Slice | Resolved in | Resolution |
| --- | --- | --- | --- |
| H-1 | S-1 | PR #268 | `runCompletionGate` in `admin/orders/actions.ts` hard-gates the completed transition through `enforceSalesLimitForSale`; soft evaluation at placement; `sales_limit_events` written; permission-gated manager override; pure gate self-tests. |
| H-2 | S-2 | PR #268 | Server-side reprice at placement from the published menu version; completion-time recompute gate (mismatch ⇒ block); client totals demoted to cross-check; pure order-pricing self-tests. |
| H-3 | S-3 | PR #268 | Global cannabis unit-price floor (> $0 and ≥ acquisition cost) applied in the cart discount engine and at server reprice/completion; promo percent capped for cannabis. |
| M-1 | S-4 | PR #269 | All five AI accept paths re-run `checkCompliance` at accept time and block on blocking flags. |
| M-2 | S-4/S-5 | PR #269 | Crawler compliance mirror re-synced with shared fixture parity check; SSRF hardening (private-IP/non-http blocked, domain allow-list required). |
| M-3 | S-6 | PR #270 | `reset_operational_data` guarded: blocked once CCRS submissions or completed real sales exist. |
| M-4 | S-7 | PR #271 | `.in()` truncation family eliminated via chunked pagination (`chunkedIn`) across wa-tax/sales/cogs/receipts/ccrs-sales/sage exports; pure self-tests. |
| M-5 | S-8 | PR #271 | Medical-exempt sales cross-wired into wa-tax excise math (exempt rows excluded per WAC 314-55-090(2)); canonical period basis documented in `docs/PERIOD_BASIS.md`; pure self-tests. |
| M-6 | S-9 | PR-E | Webhooks fail CLOSED in production: Resend/SendGrid/inbound-email return 503 when their secret is unset (`lib/security/fail-closed.ts`); CloudPRNT auth failure ⇒ 503 in prod; dev keeps warn-and-continue; admin dashboard banner lists missing webhook secrets; unverified inbound senders badged in the intake panel. |
| M-7 | S-10 | PR-E | At-rest AES-256-GCM envelope encryption (`encv1:`; key from `DATA_ENCRYPTION_KEY`, see `.env.example`) for employee bank routing/account, company ACH account, payroll line snapshots, and integration API secrets; legacy plaintext reads pass through and re-encrypt on save. Clock PINs now salted-scrypt hashed with constant-time verify, legacy plaintext upgraded on use, and in-memory throttle (5 fails/60s ⇒ 60s lock). `listEmployees` column-restricted (no `select *` banking leak); the only banking read path is `listEmployeeBanking()`; account numbers render masked (`•••• + last4`). Admin banner when the key is unset. |
| M-8 | S-11 | PR #270 | Legacy ungated `acceptManifest()` retired; only the gated finalize path (lot-activation gate) remains. |
| M-9 | S-12 | PR-E | All business weekday/hour logic pinned to America/Los_Angeles via `storeNow/storeWeekday/storeHour` in `lib/reports/timezone.ts` (promotions engine, auto-discounts, promotions admin page, audit-anomaly off-hours); receipt timestamps print Pacific ("PT"). Bonus: WAC 314-55-147 sales-hours gate — pure core (`lib/compliance/sales-hours-core.ts`, statutory 8:00–24:00 clamp, owner window can only narrow) + settings page (`/admin/settings/sales-hours`) + hard block in the order completion gate. |
| M-10 | S-13 | PR #270 | Sage purchases export includes `partially_accepted` manifests with accepted-lots-only cost basis, matching the payables store. |
| L-1 (order/PO lifecycle, PO hard-delete, PO numbering race) | S-15 | PR-G | PURE order transition matrix (`lib/orders/order-lifecycle-core.ts`): forward-only chain, closures from active, completed/cancelled/no_show TERMINAL except explicit reasoned reversal to a designated reopen target (completed→ready, cancelled/no_show→new); enforced in `setOrderStatus` (store layer) + `setOrderStatusAction` (blocked ⇒ `order.transition_blocked` audit + red banner); reversal logged as its own timeline event with the written reason; "Reopen (logged reversal)" UI on closed orders. PO matrix in `po-core.ts` (`evaluatePoTransition`): forward-only draft→submitted→sent→partial→received, cancel from non-terminal, received/cancelled terminal; `setStatusAction` validates the posted enum (`isValidPoStatus`, no more `as never`) and audits `purchase_order.transition_blocked`. PO delete: only DRAFTS hard-delete (with `before` snapshot audited); issued POs must be cancelled — UI hides Delete off-draft. PO numbering race fixed: max(parsed seq)+1 with unique-violation retry (`parsePoNumberSeq`), immune to deletions (count-based was not). 47 pure tests in `tests/compliance/lifecycle.test.ts`. Masters/kb-substitute/marketing delete audits verified already present (GAP claim stale). |
| L-2 (excise hint), L-3 (footer warning), L-4 (loyalty races, newsletter double-send), L-5 (SiteText XSS), L-6 (9.3% in two places), L-7 (WebAuthn UV) , L-9 (birthdate drift) | S-19/S-20 | PR-H | Excise deviation from statutory 37% now requires typed browser confirm + server-side `confirmExciseDeviation` flag (fat-finger guard). Footer warning block validated against the five WA-mandated sentences (`lib/compliance/warning-text-core.ts`) at BOTH draft-save and publish — missing language hard-blocks with an audited `content.warning_block_rejected` + red banner; formatting stays free (compared on normalized text). `SiteText html` now pipes through a pure allowlist sanitizer (`lib/security/html-sanitize.ts`: script/style/iframe content dropped, on* handlers and javascript:/data: URLs stripped, idempotent). Loyalty: balance/lifetime caches recomputed FROM the ledger (read-modify-write race eliminated, self-healing); redemption use is a conditional `status='issued'` update so a code can never be double-spent. Newsletter broadcasts of the same post are refused inside a 1-hour cooldown (tests exempt). WebAuthn DECISION: `userVerification/requireUserVerification` = required on register + authenticate (staff POS credential ⇒ biometric/PIN mandatory). `isAtLeast21` rewritten as pure Pacific calendar-date math (no `new Date(birthdate)` UTC drift). Client 0.093 / server 930bps twins now derive from single bps constants in `order-pricing-core.ts` (tax.ts imports them). 23 tests in `tests/compliance/hardening.test.ts`. |
| M-11 | S-14 | PR-F | Vitest compliance harness (`tests/compliance/`, `npm run test:compliance`): golden-file byte-comparison for all 7 CCRS retailer file types (goldens generated from a shared fixture by `scripts/compliance/generate-golden-ccrs.ts`, headers cross-checked against the official LCB templates in `docs/ccrs-templates/`), excise math incl. WAC 314-55-090(2) medical exemption, WAC 314-55-095 limit buckets (rec + medical), RCW 69.50.357 price floor, WAC 314-55-096 sample caps, naming `validateName`, cart-discount client/server parity across all 7 weekday mechanics, plus all 10 embedded pure self-test suites. Wired into CI (`.github/workflows/compliance-tests.yml`) on every PR — this is the WAC 314-55-509 mitigation evidence. |

— END OF GAP AUDIT —
