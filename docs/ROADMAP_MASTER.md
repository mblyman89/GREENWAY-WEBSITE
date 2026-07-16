# Greenway Master Roadmap — POS Hardening + Owner Wishlist

> Created after the full POS front-end compliance audit (see `POS_FRONTEND_AUDIT_REPORT`
> findings F-1..F-10) and the owner's direction: **"create a new comprehensive roadmap
> with all of your recommendations added to it … Please also add all of my wish list
> items … Highest priority first, then whatever most logical slice order thereafter."**
>
> This document is the single source of truth going forward. It merges:
>   1. **Task AN** — POS compliance hardening slices (from the audit, highest priority).
>   2. **Slices 65–80** — the owner's 18-item wishlist, already grounded and decision-locked
>      in `docs/COMMAND_CENTER_ENHANCEMENTS_TASKLIST.md` (batches preserved).
>   3. **Residual triage** — still-live items from older roadmap docs, plus items verified
>      as already shipped (marked superseded so no doc sends us in circles).
>
> **Standing rules apply to every slice:** never guess — verify by reading code; migrations
> applied MANUALLY by owner; money in minor units (cents); one branch/PR per slice; CI green
> (compliance + Vercel) before squash-merge; pure cores get self-tests registered in
> `scripts/compliance/run-pure-selftests.ts` (import AND call — verify `grep -c` = 2) plus
> vitest mirrors; shipped-notes recorded here on completion.
>
> **Permanent exclusions (do not resurrect):** customer-facing display; gift cards (not
> allowed under the license); B45 fees/donations; B46 pre-orders; employee ACH payroll
> (owner uses Sage).

---

## Phase −1 — Task AO: Register front-end rebuild to the approved Dutchie-style design (TOP PRIORITY)

> Owner reviewed the shipped dark register and rejected the visual design outright, then
> APPROVED two light-theme mockups modeled directly on their Dutchie example screenshot
> (`another_example_of_pos.png`): white/light background, navy top bar with tab nav,
> customer band header, clean product TABLE, and a right-hand "Cart Summary" rail with
> legal-limit meter and a single green tender button. Owner decisions locked:
> **no "Checked In"/"In Progress" queue columns — pickup orders are the only queue**;
> **ID scan should auto-load the matching customer**; owner delegated feature/flow
> decisions ("executive decisions") to the agent. This is a RE-SKIN + RE-FLOW: every
> compliance/offline mechanism underneath (ID gate, WAC limits, offline queue, drawer,
> voids/returns, sync) is kept exactly as built.

- [x] **AO-1 — Light theme + shell.** New POS design tokens (light bg, navy `#12233d`
  top bar, teal/green accents), top tab nav (REGISTER · PICKUP · DRAWER · REPORTS · MORE ▾)
  replacing the wall-of-cards home, status strip (sync/menu/queue/app version) moved to a
  slim footer. Employee + register + online/drawer state in the top-right.
  *Shipped (PR #524): `DEFAULT_THEME` flipped to `"light"` (devices that chose dark keep
  it), approved mockup palette + navy chrome tokens (`--pos-chrome*`) in globals.css,
  flat light canvas. Tab nav itself landed with AO-2.*
- [x] **AO-2 — Scan-first home screen.** Landing surface = "Scan an ID to start a sale"
  hero with an always-focused scan box (wedge-ready), Manual ID check + member lookup as
  secondary buttons, held-sales resume strip, pickup-orders rail (the only queue, per
  owner). All existing functions (no-sale, day report, void, return, reprint, leaderboard,
  clock out, lock) move under MORE ▾ / DRAWER / REPORTS tabs — nothing is removed.
  *Shipped (PR #525): navy chrome top bar (REGISTER · PICKUP w/ badge · REPORTS · MORE ▾
  dropdown holding all demoted functions + theme toggle + clock + lock), ID-scan hero with
  the same drawer/menu/clock-in gating, held-sale strip, pickup rail with drawer
  info/drop/close shortcuts, slim SYNC/MENU/QUEUE status footer. Render-only — zero
  compliance/offline changes; suite 1,625/123 green. The always-focused wedge scan box on
  the home screen itself arrives with AO-3 (scan needs the match endpoint to be useful
  before the sale starts).*
- [x] **AO-3 — ID scan auto-attaches the customer.** After a passing AAMVA scan, the
  register (online) sends parsed name + DOB to a new device-authenticated match endpoint;
  an unambiguous single match auto-attaches the loyalty member (points/tier ride the
  band); ambiguous/no match falls back to today's manual lookup. Privacy budget
  unchanged (label + points + tier only; DOB never returned — matching happens
  server-side). Offline: scan still gates age locally; member attach skipped as today.
  *Shipped (PR #527): `member-match-core.ts` pure matcher (exact DOB + normalized
  first/last; nicknames and duplicates never attach; 16 self-tests + vitest mirror),
  `POST /api/pos/member-match` (device-authed, candidates via exact-birthdate query,
  ambiguous reported as null), fire-and-forget wiring after the gate passes —
  cart opens instantly, member band appears when the server answers; an AM-D
  order-loaded member is never overridden. Suite 1,635/124.*
- [x] **AO-4 — Sale screen rebuild.** Customer band (name + ID✓age + tier/points badges +
  History/Hold/Cancel), "THE USUAL" one-tap re-add chips from member history (B29 data),
  live scan/search bar + category chips, cart as a clean table (qty steppers, remove,
  "just scanned" flash), Cart Summary rail (legal-limit meter wired to the real B22 meter,
  itemized lines, loyalty box with earn preview + redeem, subtotal/discount/tax/TOTAL,
  green "Tender Cash" + quick-tender denomination buttons that compute change instantly).
  *Shipped (PR #529): new CustomerBand (member/walk-in identity, ID✓ + MEDICAL + tier
  badges, detach, History/Hold/Cancel chips, embedded lookup for walk-ins); THE USUAL
  chips render only when a B29 favorite matches exactly ONE in-stock variant and route
  through the same manualAdd guard (scan-required still gates cannabis); cart rebuilt as
  a table with qty steppers, JUST SCANNED tag on the latest scan (all 4 scan paths), and
  an expandable row for the B24 override/undo controls; "Cart Summary" rail with boxed
  LEGAL LIMIT meter (real B22 math), itemized lines, loyalty box (balance/cash value/earn
  preview), reordered totals, and quick-tender chips that derive from the SAME B31
  smartTenderSuggestions + B33 roundCashDue as the tender screen — a chip preseeds the
  tendered amount via a new initialTenderedMinor prop so amounts can never disagree.
  Re-skin/re-flow only; suite 1,635/124 green.*
- [x] **AO-5 — Remaining surfaces restyle.** Tender/change + receipt screens, pickup
  fulfillment, drawer (open/drop/close), returns/void flows, day report, leaderboard —
  all restyled to the approved light theme so no screen drops back to the old dark UI.
  *Shipped (PR #530): full audit found the token system already carried every listed
  surface; the three real remnants were fixed — (1) the B36 category chip/dot palette's
  last five entries were dark-only Tailwind -300/-400 shades, now on new `--pos-cat-*`
  tokens re-tinted per theme (deep -700/-600 on light; array still exactly
  CATEGORY_COLOR_COUNT); (2) the PWA metadata still declared the dark canvas —
  viewport themeColor → #f4f6f9 (light --pos-canvas), status bar "black-translucent" →
  "default", manifest background/theme colors matched; (3) sweep verified zero remaining
  Tailwind palette colors or hex literals in src/app/pos/ (text-white only on solid
  semantic fills or the always-dark modal scrim). Task AO complete. Suite 1,635/124.*

## Phase 0 — Task AN: POS compliance hardening (HIGHEST PRIORITY)

One PR per slice. These close the gaps found in the front-end audit; AN-1/AN-2 are the
only quantitative compliance gaps and go first.

- [x] **AN-0 — POS PWA update affordance** *(small; fixes the owner's "I can't see the new
  front end" pain)*. The installed Home-Screen app has NO in-app refresh path today
  (`public/pos-sw.js` has no version stamp, no skipWaiting message handler; RegisterShell
  has no update UI). Build: bump SW cache names to versioned constants tied to a build id;
  add a `message`-driven `skipWaiting()` + `controllerchange` reload; surface an
  unobtrusive "Update available — tap to refresh" banner in RegisterShell (guarded so it
  never interrupts an in-progress sale, i.e. only offered when the cart is empty and no
  sale is held); show the running app version in Settings so staleness is visible.
  *Shipped (PR #532): new `sw-core.ts` pure core (23 self-tests + vitest mirror) builds
  the worker source with the deploy's short commit SHA in its cache names; served by
  `src/app/pos-sw.js/route.ts` at the same URL registers already use (static file
  deleted). Install-time skipWaiting REMOVED — activation is message-driven only, so an
  update can never land mid-sale (self-test pins exactly one skipWaiting call, inside
  the message handler). RegisterShell watches for a waiting worker (+ proactive
  reg.update() since a standalone PWA rarely navigates), shows the banner ONLY on the
  home screen and never while a sale is held, and reloads once on controllerchange.
  Running version (same resolver as the worker) shown in the status footer.
  Suite 1,642/125.*
- [x] **AN-1 (F-1) — Per-variant grams → limit engine.** `lineGrams()` already honors
  `line.grams` but NO caller passes it — both the register meter (`limitLinesFor`) and the
  server gate fall back to `DEFAULT_UNIT_GRAMS` category defaults (a 7 g flower jar counts
  as 3.5 g). `transform.ts` already parses `gramsEquivalent` from package sizes. Build:
  carry grams on the menu-bundle variant (`GreenwayMenuVariant` currently has no grams
  field), snapshot grams onto `order_lines` (migration), and pass real grams through BOTH
  the register meter and `enforceSalesLimitForSale`. Closes the only quantitative
  WAC 314-55-095 gap.
  *Shipped (PR #534): new `variant-grams-core.ts` pure core (38 self-tests + vitest
  mirror) parses per-unit grams back OUT of the variant label — a closed, machine-
  generated vocabulary from the same transform parse that computes `gramsEquivalent`
  (g → qty, oz → qty × 28), so already-published menus work with NO re-import and no
  menu-schema change. Non-weight labels (mg/ml/fl oz/pk/each/free text) → null = keep
  the conservative category default. Menu API stamps `unitGrams` per product; register
  carries it priceCart → limitLinesFor (live meter) → buildSalePayload (queued
  snapshot, validated positive-finite when present; pre-AN-1 queues stay valid);
  website reprice stamps it and BOTH the placement soft-check and the completion hard
  gate meter on stored `unit_grams` (`normalizeUnitGrams` accepts pg numeric-as-text).
  Grams semantics verified: `LimitCartLine.grams` is the WHOLE-line total. Migration
  0122 (owner applies manually) adds nullable `order_lines.unit_grams`; sync-store and
  orders-store both retry without the column (PGRST204/42703 ladder) so an unapplied
  migration never breaks a sale. No backfill — old rows meter on category defaults
  exactly as before. Suite 1,649/126.*
- [x] **AN-2 (F-2) — Statutory clamp on sales-limit settings.** `updateSalesLimitSettingsAction`
  accepts any ≥ 0 values with no clamp (unlike sales hours, which clamp INTO the statute via
  `normalizeSalesHoursWindow`). Apply the same clamp pattern so owner-entered limits can
  never exceed WAC 314-55-095 maximums (recreational and medical-endorsement tiers).
  *Shipped (PR #536): new pure `clampLimitProfile(raw, base)` in sales-limits-core —
  tighten below the statutory max allowed; above it clamps to the statute; zero/negative/
  NaN/garbage collapses to the statute (mirrors normalizeSalesHoursWindow's collapse-to-
  legal-window); pg numeric-as-string accepted. Applied at THREE layers: (1) WRITE — the
  admin action clamps before persisting and before the audit record, and
  updateSalesLimitSettings clamps again server-side; (2) READ — getSalesLimitSettings
  clamps rows so manual DB edits can tighten but never widen; (3) ENGINE CHOKE POINT —
  resolveLimits clamps overrides, so every evaluation (register meter, website placement,
  completion hard gate) is protected even against a STALE CACHED DEVICE BUNDLE carrying
  widened values. No migration. +10 pure self-tests (sales-limits-core → 57) + 2 vitest
  cases. Suite 1,651/126.*
- [x] **AN-3 (F-4 + F-6 + F-10a) — Sync-ingest hardening.** (a) hours gate evaluated on the
  event's `occurredAt`, not sync-arrival time; (b) re-run manual-ID age/expiry math at sync
  (today `validateManualIdEventPayload` is format-only); (c) validate `drawerSessionId`
  refers to a real open session (today only UUID-shape checked); (d) flag device clock
  drift beyond tolerance as a POS exception. All pure-core testable.
  *Shipped (PR #538): all four as pure functions in sync-core.ts (+21 self-tests → 37,
  vitest mirrors). (a) `CompletionGateOptions.hoursAt` (defaults to now for back office +
  pickup); POS sync passes `envelope.occurredAt` — a legal 11 PM sale flushing at 2 AM
  passes, an illegal 2 AM sale syncing at noon is refused. (b) `checkManualIdMathAtSync`
  re-runs ageOn + isExpired against the EVENT's own date (not sync arrival — a doc
  expiring in between must still pass); excepted verifications grant nothing (the sale
  path now also requires the referenced verification's ledger status = processed).
  (c) `checkDrawerSessionForSale`: session must exist, belong to the device's register,
  and its open interval must contain occurredAt (late flushes fine; sales predating
  open/postdating close are exceptions). (d) `checkClockDrift` excepts envelopes stamped
  >5 min in the FUTURE before any processing (lateness is never drift), which also
  makes (a) ungameable forward. All failures are EXCEPTIONS (ledger fact preserved,
  manager reviews) — never silent drops. No migration. Suite 1,661/126.*
- [x] **AN-4 (F-5) — Refunds in the drawer story.** Voids/returns pop the drawer and pay
  cash out but are ABSENT from the X/Z day report and reconcile math
  (`expectedClose = opening + cashSales − drops` today). Add refund lines to X/Z and a
  refund total to the reconcile screen so blind counts stop showing false shortages.
  *Shipped PR #540. day-report-core gains pure `summarizeRefunds` + `auditRefundMinor`
  and an optional `DayReportSlipInput.refunds` (absent → no section, so older cached
  register bundles keep printing); the slip gains a REFUNDS — STORE-WIDE CASH OUT
  section (voids + counter returns, negative amounts, explicit caveat). New
  `refunds-store.refundsForBusinessDay` is the ONE query (audit_logs
  `register.sale_voided` after_json.refundMinor + customer_returns.refund_minor_units,
  Pacific-day window) shared by the day-report route AND the back-office reconcile
  cards, so both print the same number; best-effort (read failure → zeros, never blocks
  the slip). Reconcile cards show "refunded store-wide this day — enter cash sales NET
  of refunds" (`AttentionItem.dayRefundTotalMinor`, one query per distinct business
  day). STORE-WIDE by design: neither refund record carries register attribution (void
  audits only name the device; customer_returns has no register column) — we say so on
  paper rather than guess a register. No migration. Suite 1,664/126.*
- [x] **AN-5 (F-3) — Price-drift exception at sync.** Sync trusts device-stored prices
  (correct for offline integrity) but never cross-checks against the current menu. Add a
  tolerance-based, override-aware comparison that raises a POS exception (never blocks the
  sale) when a synced sale's prices drift from the menu of record.
  *Shipped PR #542. New pure `price-drift-core`: `buildMenuPriceIndex` +
  `checkPriceDrift` + `summarizePriceDrift`. Override-aware BY CONSTRUCTION — compares
  the line's `regularPriceMinor` (the device's PRE-discount menu snapshot; overrides,
  promos, and loyalty only ever change `unitPriceMinor`) against the current published
  variant price, so discounts can never false-positive. Detects price moves (signed
  delta), delisted products, and missing variants; pre-B20 lines without a variantId
  are SKIPPED (never guess a variant); default tolerance 0¢ (both sides are integer
  cents from the same source), garbage tolerance collapses to 0. Implementation note:
  shipped as a durable `register.price_drift` AUDIT ROW after the sale completes rather
  than a queue exception — excepting the sale would strip its money from the X/Z report
  (only PROCESSED sales are summed) for what is usually a benign reprice; the audit
  trail still tells the manager exactly which register needs a menu refresh. Wrapped in
  try/catch so a drift-check failure can never affect a completed sale. 16 self-tests +
  7 vitest mirrors. No migration. Suite 1,671/127.*
- [x] **AN-6 (F-7) — POS exception reminders + nav badge.** Unresolved POS exceptions are
  invisible until someone opens the page. Ride the existing Task W reminders engine
  (`compliance-reminders.ts`, currently CCRS-deadlines-only) + add an admin-nav badge count.
  *SHIPPED (PR #544): pure planner `exception-reminder-core.ts` — one reminder per Pacific
  day while ANY exception is unresolved (dedupe key `pos-exceptions:<date>`; per-day keys
  re-fire daily until the queue drains, then go quiet). Urgency warning → critical when
  the oldest exception is 3+ Pacific days old; unknown age never escalates and invents no
  number. `posExceptionSnapshot()` in sync-store (exact count + oldest occurred_at,
  best-effort). Task W `Reminder` gained optional linkPath/linkLabel/footnote overrides so
  the POS reminder deep-links to `/admin/registers/exceptions`; the POS planner is wired
  best-effort so its failure never breaks CCRS deadline mails. Nav badge: data-driven
  `badges` prop on AdminTopNav (href → label, orange chip on the Employee tab, the
  Register Activity dropdown item, and mobile accordion; caps at 99+); admin layout
  fetches the count server-side only for roles with orders.manage. 30 self-tests + vitest
  mirror. No migration — rides compliance_reminder_log (0118). Suite 1,678/128.*
- [x] **AN-7 (F-8) — Recall/quarantine hard stop in the sale path.** No hold gate exists in
  the sell flow today. Build: recall hold flag → excluded from the published menu bundle
  AND a completion-gate hard block (same discipline as the DOH high-THC gate).
  *SHIPPED (PR #546): pure core `recall-hold-core.ts` — a product key is held while ANY of
  its lots has status `recalled` (deliberately NOT `quarantine`: intake lots start
  quarantined and the 72h destruction hold parks return lots there — holding on quarantine
  would false-block a product the moment a restock arrives). Whole-key hold because order
  lines carry no lot identity (B19 decrements FIFO after the fact). Two layers with an
  ASYMMETRIC fail posture: `/api/pos/menu` excludes held products from the register bundle
  best-effort (read failure ships an unfiltered menu, never a blank register); the
  completion gate (both callers — admin dashboard + POS sync) hard-blocks right after the
  sales-hours gate, fail-CLOSED (a recall-status read failure refuses the sale rather than
  guessing safe), NO override — same posture as the DOH high-THC gate. Mark/release path is
  the existing Admin → Inventory lot-status editor. 11 self-tests + vitest mirror. No
  migration — rides inventory_lots.status (0023). Suite 1,684/129.*
- [x] **AN-8 (F-9, lowest) — Durable PIN throttle.** Current 5-fails/60 s throttle is
  in-memory per lambda instance (resets on cold start, not shared across instances). Move
  to a durable store keyed per device+employee.
  *SHIPPED (PR #548): **MIGRATION 0123 pending — owner applies manually** (`pin_throttle`
  table, one row per scope: `pos-device:<uuid>` per register pad, `timeclock` for the
  shared staffing pad — a failed PIN identifies no employee, so per-entry-point scoping
  replaces the roadmap's device+employee idea; RLS staff-read, service-role writes). Pure
  core `pin-throttle-core.ts` computes the identical S-10 policy over the durable row with
  defensive parsing (future/garbage timestamps dropped; a locked_until beyond now+LOCK_MS
  is corrupt and ignored — a tampered row can never hold an unbounded lock). Store falls
  back to the legacy in-memory window whenever the durable layer is unconfigured/missing/
  failing, so protection never regresses even before 0123 lands. All 8 call sites migrated
  (6 POS routes incl. the till witness PIN → per-device scope; station + phone timeclock →
  shared scope). 18 self-tests + vitest mirror. Suite 1,691/130.*

*(F-10 minor leftovers — bundle-staleness enforcement — fold into AN-3 or AN-0 where natural.)*

---

## Phase 1 — Wishlist Batch 1: daily-operations wins (Slices 65–70)

Locked scope lives in `docs/COMMAND_CENTER_ENHANCEMENTS_TASKLIST.md`; slice numbers preserved.

- [ ] **Slice 65 — Nav → top tabs with dropdowns** [item 16]: convert `AdminSidebar` +
  `admin-nav-data` into a top tab bar with grouped dropdowns; keep permission gating + mobile.
- [ ] **Slice 66 — Site Content: all pages** [item 9]: add Blog + legal/info pages (Consumer
  Health Data, Privacy Policy, Terms of Use, Unsubscribe, Vendor Delivery) to the content hub.
- [ ] **Slice 67 — Loyalty customizer** [item 2]: full editor over `loyalty_config` +
  `loyalty_tiers` + `loyalty_promotions` with live preview; audited.
- [ ] **Slice 68 — Cycle counts: barcode scanning + hardening** [item 3]: wedge/USB + camera
  capture on `cycle_count_lines`, blind-count mode, variance flags, session locking, audit.
- [ ] **Slice 69 — Schedule builder** [item 4]: week grid over `shifts` (create/copy/publish
  per employee/role), coverage view. (`/admin/staffing/schedule` does not exist yet — verified.)
- [ ] **Slice 70 — Phone clock-in + hour adjustments** [item 8]: mobile self clock in/out
  (PIN over `time_punches`) + owner/manager punch-edit with reason + audit.

## Phase 2 — Wishlist Batch 2: compliance + content depth (Slices 71–76)

- [ ] **Slice 71 — Sample compliance (WAC 314-55-096)** [item 6]: sample ledger + HARD blocks
  (WSR 25-08-032 eff. 4/26/25: 120 units/processor/quarter incoming, 30 units/employee/quarter,
  unit caps 3.5 g flower / 1 g concentrate / 100 mg infused, NO customer samples), insight
  dashboard on the Sales Limits page.
- [ ] **Slice 72 — Midjourney prompt builder + media overhaul** [items 7 + 17]: grounded
  prompt builder with presets & references + drag-drop/bulk/AI-alt-text media library.
- [ ] **Slice 73 — Sage 50 KB enrichment + Chart of Accounts upload** [items 1 + 13]: COA +
  bookkeeping report kinds, PDF/CSV text extraction, index uploads into KB/RAG.
- [ ] **Slice 74 — Manifest pipeline** [item 10]: pipeline board over `inbound_manifests`
  lifecycle states (pending / in-transit / awaiting-intake) + events timeline.
- [ ] **Slice 75 — KB seed coverage + owner uploads** [item 14]: audit which back-office areas
  have KB/seed data; add seeds where available; add an upload-your-own-seed path. *(Note: the
  five `back-office/kb_seed/*.sql` files — product categories, strains, vendors baseline +
  batch 2 + batch 3 — are idempotent upserts that live OUTSIDE `supabase/migrations/` and are
  applied separately by the owner; this slice audits/extends that coverage.)*
- [ ] **Slice 76 — Mobile-friendly pass** [item 15]: dashboard, orders, clock, manifests,
  schedule, loyalty genuinely usable on a phone.

## Phase 3 — Wishlist Batch 3: banking + customer AI (Slices 77–80)

- [ ] **Slice 77 — Vendor ACH: banking + approval model** [items 5/11]: ACH origination
  profile + per-vendor banking (secure, permission-gated); approve-for-ACH; match to accepted
  CCRS manifest. Bank: Timberland (Jack Henry Treasury).
- [ ] **Slice 78 — Vendor ACH: NACHA batch generation** [items 5/11]: approved+matched
  payables → byte-correct NACHA `.ach` (94-char records, SEC CCD, tc 22/32, entry hash,
  routing 325170754) + CSV worksheet + PDF summary for upload; audited. *(Reminder: employee
  payroll is permanently excluded — vendor payments only.)*
- [ ] **Slice 79 — Customer-facing AI concierge** [item 18]: grounded public chat (menu +
  strain KB + store info) with compliance guardrails (21+, no medical/dosing claims).
- [ ] **Slice 80 — Customer AI knowledge seeding** [item 18 cont.]: cannabis-education seed
  data + store facts so the concierge is robust.

## Phase 4 — Residual triage from older roadmap docs

**Still live (build if/when the owner wants them; lowest priority):**

- [ ] **R-1 — WSLCB SODA vendor-lead auto-sync** (from `ROADMAP_DISCOVERY_AUTOMATION.md`):
  `src/lib/discovery/soda.ts` / `wslcb.ts` / `sync.ts` + `runVendorLeadSync` were never
  built (verified absent). The discovery hub took a different, CCRS-import-based path that
  works well — build this only if automatic license-list lead generation is still wanted.
- [ ] **R-2 — CCRS product names → `kb_strains` alias suggestions** (from
  `ROADMAP_VENDORS_AND_KB_ENRICHMENT.md`): not built (verified). Natural companion to Slice 75.
- [ ] **R-3 — KB-powered vendor filter upgrade** (same doc): not built (verified).
- [ ] **R-4 — OWNER ACTION: rotate the Supabase service-role key** (flagged long ago after
  the key was shared in a chat). Standing reminder until the owner confirms rotation.

**Verified already shipped — superseded, do NOT rebuild:**

- ~~CLEANUP_PLAN reset RPC~~ → shipped as migrations `0069_reset_operational_data.sql` +
  `0097_reset_retention_guard.sql` + `/admin/settings/reset`.
- ~~kb_products potency columns~~ → shipped as `0084_kb_products_potency.sql`.
- ~~Benchmarks → market context in AI drafting~~ → shipped in `src/lib/discovery/leads-ai.ts`
  (local-area benchmark grounding).
- ~~Discovery benchmarks page + nav~~ → shipped at `/admin/discovery/benchmarks`.

---

## SQL files that live OUTSIDE `supabase/migrations/` (owner reference)

The owner applies migrations from `supabase/migrations/` only (0001–0121 all applied).
These additional SQL files exist and are applied SEPARATELY, on purpose:

| File | What it is | When to run |
| --- | --- | --- |
| `back-office/kb_seed/product_categories_seed.sql` | Idempotent KB category taxonomy (upsert on slug) | After migration 0070; safe to re-run |
| `back-office/kb_seed/strains_seed.sql` | Idempotent strain KB seed (upsert on slug) | After migrations 0019 + 0020; safe to re-run |
| `back-office/kb_seed/vendors_baseline_seed.sql` | Human-verified vendor KB baseline (12 vendors) | After migration 0003; safe to re-run |
| `back-office/kb_seed/vendors_batch2_seed.sql` | Vendor KB batch 2 (21 producer/processors) | After migration 0003; safe to re-run |
| `back-office/kb_seed/vendors_batch3_seed.sql` | Vendor KB batch 3 (~80 names) | After migration 0003; safe to re-run |
| `supabase/diagnostics/cogs_cost_linkage.sql` | READ-ONLY diagnostic for $0-COGS investigations | Only when debugging COGS; changes nothing |

If the KB pages (strains, vendors, categories) look sparse, the seeds above are why —
they are optional data loads, not schema, and each is idempotent (safe to run any time).

---

## Shipped notes

*(Append one line per merged slice: slice id — PR # — one-sentence summary.)*

- **Intake auto-publish (owner request, Option 1) — PR #550** — approving a priced
  onboarding draft now publishes the menu automatically (same gated
  `publish_menu_version` RPC as Menu Imports; atomic swap; timeline + audit events;
  staged-version fallback on Menu Imports if the auto-publish ever hiccups, with stale
  intake-origin staged siblings archived after each successful publish); the intake
  ribbon gained step ④ "On menu" (pure core `menu-live-step-core`, 24 self-tests +
  vitest mirror) that deep-links to Product Onboarding while drafts are unpriced or to
  Menu Imports when a staged version is stuck — the owner never has to visit Menu
  Imports on the normal receiving path. Copy truthed-up on drafts page / next-action
  guidance / Menu Imports intake section. No migration. Suite 1,703/131.

- **Product Mastering Slice 1 (variant-aware sale path) — PR #552** — sold lines now
  resolve the VARIANT's own inventory lot key (intake variants have always encoded it
  as `source_variant_id = `${lotKey}-onboarded``) before the `product_id` fallback,
  across every lot-keyed surface: B19 FIFO decrement + B20 CCRS line stamping, weekly
  Sale.csv lot index, void restock, scan-to-cart (a lot barcode adds the EXACT size on
  a multi-lot card — no redundant pick), POS menu bundle (per-variant cost + AN-7
  recall exclusion + barcode sellable-key union), recall-hold completion gate
  (variant-aware `findHeldLines`), website repricing / COGS / loyalty cost lookups,
  purchasing + draft-seeding velocity, and returns lot resolution. New pure core
  `variant-lot-core` (registered self-tests + vitest mirror). 100% backward compatible:
  single-lot cards encode the same key both ways. Readiness for Slice 2 (intake
  mastering: one card per brand+category+product family, one variant per size/lot).
  No migration. Suite 1,710/132.
