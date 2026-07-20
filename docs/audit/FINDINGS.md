# Audit Findings Log

> Conventions: see `README.md`. IDs are permanent (`GW-###`). Newest findings appended at
> the bottom of their severity section. Every finding carries: where (file:line at the
> commit noted), what, why it matters, recommendation, and status.

**Log opened:** 2026-07-20 · main @ `a61aa816`

---

## 🔴 Critical

### GW-010 — Compliance exports compute tax on the tax-INCLUSIVE stored price, overstating CCRS/Sage tax figures ~46% on cannabis lines
- **Where:** `src/lib/compliance/ccrs-sales.ts:337–364` (Sale.csv builder:
  `baseCents = soldUnit * qty` with `soldUnit = l.price_minor_units`, then
  `applyBps(baseCents, …)` for SalesTax and excise "OtherTax"),
  `src/lib/accounting/sage50.ts:254–263` and
  `src/lib/accounting/sage-exports.ts:346–360` (same pattern),
  `src/lib/inventory/disposition.ts:575–618` (return-correction snapshots, same
  pattern), `src/lib/reports/wa-tax.ts:359–372` (calls `normalizeTaxableBase`
  but see below), `src/lib/reports/tax.ts:60` (`taxBaseMode: "pre_tax"` default)
  and `:31` (doc comment calling `pre_tax` "today's behavior"), versus
  `supabase/migrations/0007_slice7_orders.sql:138` ("Authoritative
  engine-discounted unit price **(tax-inclusive)**"). All at `41d908b3`.
- **What:** The stored line price (`order_lines.price_minor_units`) is the
  tax-INCLUSIVE out-the-door card price — that is the system's documented,
  verified pricing model (`src/lib/orders/order-pricing-core.ts:11,37,39`). But
  the compliance and accounting consumers treat it as a PRE-tax base and apply
  the tax rates directly on top of it. Worked example, one cannabis line sold
  at $10.00: the register actually collects total $10.00 = base $6.84 + tax
  $3.16 (excise ≈ $2.53, sales tax ≈ $0.63). The Sale.csv row for that same
  line reports SalesTax `applyBps(1000, 930)` = $0.93 and OtherTax
  `applyBps(1000, 3700)` = $3.70 — tax computed on $10.00 instead of $6.84,
  overstated by the full 46.3% wedge (9.3% on non-cannabis lines). Three
  compounding problems: (a) only `wa-tax.ts` even calls the corrective
  `normalizeTaxableBase`; the CCRS, Sage, and disposition builders never do, so
  flipping `tax_settings.tax_base_mode` to `'tax_inclusive'` in the DB fixes
  ONE of five consumers; (b) the default mode is `'pre_tax'` and the `auto`
  detector (`tax.ts:137–159`) inspects order HEADERS, which always fit
  `total = subtotal + tax` exactly (the header subtotal is already backed out),
  so auto-detection answers "pre-tax" even though the LINE prices are
  inclusive — the heuristic tests the wrong field's semantics; (c) Sale.csv
  `UnitPrice` is printed from the tax-inclusive regular price
  (`ccrs-sales.ts:344`), while the owner's own guide says UnitPrice is the
  price of one unit "**before** discount/tax"
  (`docs/CCRS_SELF_REPORTING_GUIDE.md:78`).
- **Why it matters:** Every weekly CCRS Sale.csv upload would tell the LCB the
  store collected ~46% more excise and sales tax than it actually did, and the
  monthly LIQ-1295 (whose Box 1 correctly uses the backed-out pre-tax
  subtotal, `src/lib/compliance/excise-return.ts:119–131`) would then claim a
  much SMALLER excise figure than the Sale.csv rows imply for the same month —
  an internally inconsistent story handed to the regulator, plus Sage books
  carrying wrong tax-liability lines, plus return corrections snapshotting the
  same wrong numbers forever. The medical path is NOT affected
  (`src/lib/medical/medical-sale-core.ts:196–204` backs out with the category
  divisor, correctly), which proves the right pattern already exists in the
  codebase.
- **Recommendation:** One focused slice: derive the pre-tax line base in every
  compliance/accounting consumer the same way the medical engine does
  (inclusive price ÷ category divisor — cannabis 1.463, non-cannabis 1.093),
  or equivalently route them all through `normalizeTaxableBase` with the mode
  resolved from line semantics rather than header fit. Also print Sale.csv
  UnitPrice as the pre-tax regular unit, fix the misleading `tax.ts:31` doc
  comment and the `DEFAULT_TAX_SETTINGS` default, and add pure self-tests
  asserting that Σ(Sale.csv line taxes) reconciles with the order header's
  `estimated_tax_minor_units` within rounding. No DB migration required.
- **Status:** OPEN

---

## 🟠 Moderate

### GW-001 — Offline-queue persistence writes are unprotected; a full localStorage crashes the register loop
- **Where:** `src/app/pos/RegisterShell.tsx:404–410` (queue/sequence persist effect), at `a61aa816`.
- **What:** The effect that persists the offline queue calls
  `window.localStorage.setItem(LS_QUEUE, …)` and `setItem(LS_SEQ, …)` with **no
  try/catch**. Every OTHER localStorage write in the shell (theme, medical
  test-mode, menu cache, held sale, last receipt, active-sale snapshot) is
  wrapped in try/catch with a documented degrade path; these two — arguably the
  most important writes in the file — are not. The provisioning write at
  `RegisterShell.tsx:721` (`setItem(LS_DEVICE, …)`) is also unguarded.
- **Why it matters:** If storage quota is exhausted (e.g. a long offline stretch
  growing the queue, or iOS pressure), `setItem` throws inside a `useEffect`,
  which unmounts the React tree — the register white-screens **every time the
  queue changes**, potentially mid-shift. The in-memory queue is lost on the
  resulting reload back to whatever last persisted. Amplifier: a permanently
  rejected/401 state lets the queue grow without bound (no cap or size alarm),
  marching toward exactly this failure.
- **Recommendation:** Wrap both writes in try/catch; on failure surface a
  persistent banner ("Register storage is full — call a manager; do NOT keep
  ringing sales offline") and keep the in-memory queue serving. Consider a
  queue-length watermark banner (e.g. >200 pending) as an early warning.
- **Status:** OPEN

### GW-002 — A register re-bind is never persisted; after a restart, lock-screen punches carry the stale register id and are rejected
- **Where:** `src/app/pos/RegisterShell.tsx:757` (`onUnlocked` updates `creds`
  in memory only) vs `RegisterShell.tsx:721` (the ONLY `setItem(LS_DEVICE, …)`,
  at provisioning), at `a61aa816`.
- **What:** When an unlock reveals the server moved this device to a different
  register, the shell updates the in-memory `creds.registerId` — but never
  rewrites `gw-pos-device`. After the next app restart, boot re-loads the OLD
  register id. Envelopes built before the next successful unlock — notably
  **clock in/out punches from the lock screen** (`onPunch`,
  `RegisterShell.tsx:790`) — carry the stale `registerId`, and the server
  rejects them: `checkEnvelopeForDevice` (`src/lib/pos/sync-core.ts:35`) refuses
  any envelope whose registerId doesn't match the device's current binding.
- **Why it matters:** Punches are payroll facts. A rejected punch is kept and
  surfaced on the device, but it never becomes a time-clock entry — an employee
  who "clocked in" at the lock screen is silently not clocked in until a manager
  notices the rejected row. Trigger conditions are realistic: manager re-binds
  an iPad between registers, then the iPad restarts/reloads.
- **Recommendation:** Persist the corrected creds inside `onUnlocked` (same
  swap-safe write as provisioning), and/or have the empty-batch heartbeat
  refresh the stored `registerId`.
- **Status:** OPEN

### GW-003 — Side effects inside a React state updater can duplicate rejected-row records
- **Where:** `src/app/pos/RegisterShell.tsx:457–466` (`flush()` ACK handling), at `a61aa816`.
- **What:** `setQueue((q) => { … setRejected(…); setBanner(…); return applied.remaining; })`
  performs `setRejected`/`setBanner` **inside** the `setQueue` updater. React
  requires updater functions to be pure; React is permitted to invoke an updater
  more than once (and does, deliberately, in development Strict Mode).
- **Why it matters:** A double-invoked updater appends the same rejected rows to
  the `rejected` list twice. The duplicated rows are then **persisted** to
  `gw-pos-queue` by the persist effect, inflating the "N rejected — manager
  reviews in the back office" count and cluttering review. No money/ledger
  impact (rejected rows never re-send), but it is a genuine correctness bug
  waiting on a re-invocation.
- **Recommendation:** Compute `applyAcks` from `queueRef.current` BEFORE calling
  setState, then issue three sibling setState calls with plain values.
- **Status:** OPEN

### GW-011 — Completion side effects race: no compare-and-swap on status, and the inventory/loyalty idempotency latches are check-then-insert with no unique index
- **Where:** `src/lib/orders/orders-store.ts:287–291` (status read) and
  `:331–334` (the update filters only on `id`, not `status`, so it is not a
  compare-and-swap), then `:370–377` (inventory decrement) and `:383–392`
  (loyalty accrual) both keyed on the earlier in-memory `fromStatus`;
  `src/lib/inventory/sale-decrement.ts:54–60` (marker check) vs `:191` (marker
  insert at the END of the work) with only a NON-unique index on
  `order_events` (`supabase/migrations/0007_slice7_orders.sql:161`);
  `src/lib/loyalty/loyalty-store.ts:261–267` (earn check-then-insert) with only
  non-unique indexes on `loyalty_ledger`
  (`supabase/migrations/0039_loyalty_engine.sql:139–140`);
  `src/lib/pos/void-store.ts:194–200` (restock marker, same pattern). All at
  `41d908b3`.
- **What:** Two requests completing the SAME order at the same time (e.g. a
  POS sync retry racing a back-office click, or pickup-store racing admin)
  both read `fromStatus = "ready"`, both update to `completed`, and both run
  the side effects. Each side effect's "have I already run?" latch is a SELECT
  followed much later by an INSERT, and the database has no unique constraint
  to make the second insert fail — so under a race, inventory can be
  decremented twice and loyalty points earned twice for one order. The same
  check-then-insert shape guards the void restock. Real mitigations already in
  place: the ingest ledger's `client_uuid` is DB-unique
  (`supabase/migrations/0120_pos_foundation.sql:51`), so a RETRIED sync flush
  can never create a second order — this race needs two DIFFERENT actors
  completing the same order in the same instant, which is rare in a
  single-store shop but not impossible (serverless functions overlap freely).
- **Why it matters:** A double decrement silently understates on-hand
  inventory (an LCB-auditable figure) and a double earn overpays points. The
  loyalty cache self-heals its BALANCE from the ledger
  (`loyalty-store.ts` `applyLedger`), but duplicate earn ROWS would both
  count, so the balance would still be doubled. Severity stays Moderate
  because the window is small, requires concurrent completion of one order,
  and no money leaves the drawer — but it is exactly the kind of latent bug
  the audit exists to catch before scale.
- **Recommendation:** One slice, three cheap fixes: (1) make the status flip a
  true compare-and-swap (`.update(patch).eq("id", id).eq("status",
  fromStatus)`) and only fire side effects when the update actually changed a
  row; (2) add partial unique indexes —
  `order_events (order_id, event_type)` where event_type in
  ('inventory_decremented','sale_void_restocked'), and
  `loyalty_ledger (order_id, kind)` where kind='earn' — then INSERT the marker
  FIRST and treat a 23505 as "already done"; (3) leave the existing SELECT
  checks in place as fast paths. Requires one small owner-applied migration.
- **Status:** OPEN

### GW-012 — Inventory quantity updates are read-modify-write with no guard, so two overlapping sales/restocks can silently lose an update
- **Where:** `src/lib/inventory/sale-decrement.ts:121` (variant
  `inventory_level`) and `:166–170` (lot `on_hand_qty`);
  `src/lib/pos/void-store.ts:227–228` and `:257–261` (restock);
  `src/lib/inventory/disposition.ts:255–258` and `:291–294`
  (adjustment posting). `inventory_lots.on_hand_qty` is plain `numeric` with
  no check constraint (`supabase/migrations/0023_pos_inventory_lots.sql:102`).
  All at `41d908b3`.
- **What:** Every quantity change is computed in JavaScript from a previously
  SELECTed value and then written back with an unconditional UPDATE. Two
  DIFFERENT orders selling from the same lot at the same moment can both read
  `on_hand_qty = 10`, compute 9 and 8 respectively, and the later write wins —
  the lot shows 8 (or 9) instead of 7. Unlike GW-011 this does not need the
  same order twice; any two concurrent sales of the same product suffice.
  Nothing prevents the column from going negative either.
- **Why it matters:** On-hand counts drift from reality under everyday
  concurrency (two registers, or a register racing a manual adjustment), and
  inventory accuracy is both an operations problem and an LCB audit exposure.
  Moderate rather than Critical because a single-store, low-register-count
  deployment makes collisions uncommon and cycle counts catch drift — but the
  bug is structural and will fire eventually.
- **Recommendation:** Replace the read-modify-write with atomic SQL deltas —
  either a small RPC (`update inventory_lots set on_hand_qty = on_hand_qty -
  $delta where id = $1 and on_hand_qty >= $delta`) or PostgREST's ability to
  express the same via an RPC function; add a `check (on_hand_qty >= 0)`
  constraint (or handle the conditional-update miss as an oversell exception).
  Same treatment for `menu_variants.inventory_level`. One migration + one
  code slice; fold into the GW-011 concurrency slice.
- **Status:** OPEN

### GW-013 — LIQ-1295 excise return uses UTC month bounds while every other report buckets by Pacific time
- **Where:** `src/lib/compliance/excise-return-core.ts:139–142` (`monthRange`
  builds `Date.UTC(year, month-1, 1)` bounds; the doc comment even says
  "Reporting-period UTC bounds"), consumed at
  `src/lib/compliance/excise-return.ts:117–125` for Box 1; contrast
  `src/lib/reports/wa-tax.ts:143` (`pacificMonthKey`) and
  `docs/PERIOD_BASIS.md:4` ("Pacific-time bucketing for month/day"), and the
  CCRS builder which correctly uses the Pacific day. At `41d908b3`.
- **What:** A sale completed between 4/5 PM and midnight Pacific on the last
  day of a month lands in the NEXT month's LIQ-1295 Box 1, while the wa-tax
  report and CCRS rows put the same sale in the CURRENT month. Every evening
  of a month-boundary day is affected (roughly 7–8 busy hours of sales shift
  one period).
- **Why it matters:** The amounts are all correct in aggregate — nothing is
  lost — but the monthly excise return will not reconcile against the wa-tax
  report or the CCRS uploads for boundary days, which is precisely the
  cross-check an auditor (or the owner) would run. Same family as GW-009 and
  fixable with the same known Pacific-day helper pattern.
- **Recommendation:** Compute the month's `[from, to)` instants from the
  Pacific calendar (first millisecond of the 1st, Pacific, converted to UTC
  instants) instead of `Date.UTC`, mirroring `pacificMonthKey`. Also note Box 2
  already selects by `sale_date` (a DATE), which GW-009 covers — fix both in
  one "Pacific period basis" slice.
- **Status:** OPEN

### GW-014 — LIQ-1295 Box 1 sums the WHOLE-order subtotal, so non-cannabis (merch/accessory) sales inflate reported cannabis sales
- **Where:** `src/lib/compliance/excise-return.ts:119–131` — Box 1 =
  Σ `orders.subtotal_minor_units` over completed orders in the month. The
  header subtotal is the backed-out pre-tax figure for EVERY line
  (`src/lib/orders/order-pricing-core.ts:143–149` accumulates cannabis and
  non-cannabis lines alike). At `41d908b3`.
- **What:** LIQ-1295 Box 1 is "Total sales of cannabis products." An order
  containing a $15 t-shirt or a $5 lighter contributes that item's pre-tax
  value to Box 1 too, and Box 5 then computes 37% excise on it — overpaying
  excise on non-cannabis revenue. Today the store sells mostly cannabis so the
  distortion is small, but the POS explicitly supports non-cannabis categories
  and B39 keypad merch lines.
- **Why it matters:** Direction of error is overpayment (the "safe" direction
  legally, expensive for the owner), and it breaks the identity the auditor
  expects: Box 1 should ≈ Σ cannabis-line pre-tax bases from the same month's
  Sale.csv. Moderate: real money over time, but no compliance exposure.
- **Recommendation:** Build Box 1 from ORDER LINES (cannabis-category lines
  only, pre-tax via the category divisor — the same per-line base GW-010
  standardizes), not the order header. Fold into the GW-010 tax-base slice so
  Sale.csv, wa-tax, and LIQ-1295 all derive from one shared per-line base
  helper.
- **Status:** OPEN

---

## 🟡 Low

### GW-004 — PIN lookup scrypt-verifies against every active employee on each attempt
- **Where:** `src/lib/staffing/store.ts:117` (`getEmployeeByPin`), at `a61aa816`.
- **What:** Each PIN attempt loads ALL active employees with PINs and runs a
  ~25 ms scrypt verify per candidate until a match (hashed PINs can't be looked
  up by equality — this is inherent to salted hashing).
- **Why it matters:** At the store's scale (10 employees) worst case is
  ~250 ms — fine. It sets a scaling ceiling (100 employees ≈ 2.5 s per unlock)
  and each attempt costs server CPU. Not a problem before cutover; worth knowing.
- **Recommendation:** None needed now. If staff count ever grows large, add a
  non-secret bucketing hint (e.g. first digit stored separately) or move to a
  per-employee identifier + PIN model.
- **Status:** OPEN (accept as-is for current scale)

### GW-008 — Favorites persist writes localStorage inside a state updater, unguarded
- **Where:** `src/app/pos/SaleFlow.tsx:1899–1904` (`togglePin` in CartScreen), at `a61aa816`.
- **What:** Pinning/unpinning a favorite calls
  `window.localStorage.setItem(FAVORITES_KEY, …)` INSIDE the `setFavorites`
  functional updater. Two issues: (a) the write is not wrapped in try/catch, so
  a `QuotaExceededError` (or Safari private-mode write refusal) throws inside
  React's render/update path and can crash the cart screen mid-sale; (b) React
  updaters are expected to be pure — under StrictMode double-invocation the
  side effect runs twice (harmless here since the write is idempotent, but the
  same impure-updater pattern caused GW-003 in RegisterShell).
- **Why it matters:** Severity is low because the payload is tiny (a short
  array of variantIds), the write is idempotent, and a crash here loses no
  money — the queue and active-sale snapshot live elsewhere. But a thrown
  quota error during a sale would blank the register screen at the worst
  moment (and localStorage quota pressure is exactly the failure mode GW-001
  describes for the queue key on the same origin).
- **Recommendation:** Move the `setItem` out of the updater (e.g. an effect on
  `favorites`, or compute `next` before `setFavorites`) and wrap it in
  try/catch that degrades to "pin didn't stick" instead of throwing. Fix
  alongside GW-001/GW-003 as one "safe localStorage writes" slice.
- **Status:** OPEN

### GW-009 — Medical card validity and exempt-sale dates use the UTC day, not the store's Pacific day
- **Where:** `src/lib/medical/tax.ts:181` (`cardValidity` compares
  `expirationDate < new Date().toISOString().slice(0, 10)`),
  `src/lib/medical/store.ts:383` (`sale_date` stamped with the same UTC
  `toISOString().slice(0, 10)` pattern), `src/lib/orders/completion-gate.ts:178`
  (`saleDate` for the exemption plan built the same way), and
  `supabase/migrations/0040_medical_doh.sql:89` (`sale_date date ... default
  current_date`, which is the DB server's UTC day). All at `a61aa816`.
- **What:** The store operates on America/Los_Angeles time, but these four
  spots use the UTC calendar day. Between 4/5 PM Pacific and midnight Pacific,
  UTC is already "tomorrow." Two effects: (a) a medical card expiring TODAY is
  treated as already expired for evening sales (fail-safe: the patient loses
  the exemption a few hours early, never keeps it too long); (b) exempt-sale
  ledger rows for evening sales are stamped with tomorrow's date, so a sale
  rung at 6 PM Pacific on the last day of the month lands in NEXT month's
  medical ledger, LIQ-1295 excise return, and CCRS `RecreationalMedical`
  period.
- **Why it matters:** Severity stays Low because the drift direction is
  fail-safe for card validity (never honors an expired card) and the ledger
  drift is a boundary-day reporting-period wobble, not a money error — the
  amounts are correct, just occasionally attributed to the adjacent day. The
  returns/voids code already solved this exact problem with a Pacific-day
  helper, so the fix is a known pattern, not new invention.
- **Recommendation:** One small slice: introduce/reuse a `pacificDay()` helper
  (the same `Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })`
  pattern the returns/void windows use) at all four spots. No backfill needed —
  historical rows are off by at most one day at period boundaries and the
  owner has not yet cut over.
- **Status:** OPEN

### GW-015 — Internal Sales/COGS/Customers/Analytics revenue uses "non-cancelled" orders, so never-completed and no-show orders count as revenue
- **Where:** `src/lib/reports/sales.ts:243`, `src/lib/reports/cogs.ts:341`,
  `src/lib/reports/customers.ts:188`, `src/lib/reports/analytics.ts:137–140`
  (all filter only `status !== "cancelled"`), versus the compliance reports
  which all require `status = "completed"` (e.g.
  `src/lib/compliance/excise-return.ts:123`, `src/lib/reports/wa-tax.ts`,
  `src/lib/compliance/ccrs-sales.ts`). At `41d908b3`.
- **What:** A website order that is placed but never picked up (`no_show`), or
  a POS-sync order stuck in `ready` because the completion gate refused it
  (an exception order carrying device-claimed totals), still counts toward
  gross revenue, AOV, COGS revenue, and customer classification on the
  internal dashboards.
- **Why it matters:** Internal-only — no regulator sees these tabs — but the
  owner's dashboard "gross" will not tie to the tax report's completed-basis
  gross, which invites confusion (and the exception-order case means an
  UNVERIFIED money header can leak into a chart). Low severity: no external
  filing is wrong.
- **Recommendation:** Either switch these reports to completed-only (matching
  `docs/PERIOD_BASIS.md`) or clearly label the basis on each tab and exclude
  `no_show`. Decide once, apply to all four.
- **Status:** OPEN

### GW-016 — Two different grams-per-ounce constants live in the codebase (28 statutory vs 28.35 metric)
- **Where:** `src/lib/compliance/sales-limits-core.ts:28`
  (`GRAMS_PER_OUNCE = 28` — the WA statutory equivalence used for actual limit
  ENFORCEMENT), `src/lib/pos/variant-grams-core.ts:30` (also 28), versus
  `src/lib/medical/tax.ts:206–215` (medical limits computed as `3 * 28.35`
  etc.) and `src/lib/medical/purchase-limit-display-core.ts:13` (28.35,
  display-only conversion that rounds back to whole ounces), and
  `src/lib/compliance/employee-sample-core.ts:78` (28.3495). At `41d908b3`.
- **What:** WA rules define the recreational limit as 28 g = 1 oz, and the
  enforcement path correctly uses 28. The medical-limit table uses the true
  metric conversion 28.35, so a 3-oz medical allowance is enforced as 85.05 g
  rather than 84 g. The display helper divides by 28.35 and rounds, so the
  patient-facing ounce figures come out right either way.
- **Why it matters:** The recreational enforcement (the licence-critical path)
  is correct and conservative. The medical table's extra ~1 g per oz of
  headroom is defensible (DOH expresses medical limits in ounces, and 28.35 is
  the honest conversion) but the inconsistency is undocumented and a future
  editor could "fix" the wrong constant in the wrong direction.
- **Recommendation:** Keep both values but name them
  (`STATUTORY_GRAMS_PER_OUNCE = 28`, `METRIC_GRAMS_PER_OUNCE = 28.35`) in one
  shared module with a comment explaining which law uses which, and import
  from there everywhere. Pure refactor, no behavior change required (or, if
  the owner prefers maximum conservatism, use 28 in the medical table too).
- **Status:** OPEN

---

## 🔵 Hardening

### GW-005 — The durable PIN throttle depends on migration 0123; the fallback is materially weaker on serverless
- **Where:** `src/lib/security/pin-throttle-store.ts` (fallback posture),
  `src/lib/security/pin-hash.ts` (in-memory window), at `a61aa816`.
- **What:** When the `pin_throttle` table is missing (migration 0123 unapplied)
  or unreadable, the throttle falls back to a per-process in-memory window that
  is (a) **global, not per-device-scope**, and (b) **per serverless instance** —
  on Vercel, attempts landing on different lambda instances each get their own
  window, so the effective brute-force protection under fallback is much weaker
  than 5-per-60s.
- **Why it matters:** The design is sound (fallback ≥ legacy protection), but the
  REAL protection assumes 0123 is applied. There is no runtime signal telling
  the owner the durable throttle is active.
- **Recommendation:** Add "confirm migration 0123 applied" to the Cutover
  Checklist (owner applies migrations manually); consider logging one warning
  per boot when the durable table is missing so it shows in Vercel logs.
- **Status:** OPEN

### GW-006 — Device key rests in plaintext localStorage on the iPad
- **Where:** `src/app/pos/RegisterShell.tsx:97` (`LS_DEVICE`), at `a61aa816`.
- **What:** `gw-pos-device` holds the device key in the clear. This is a
  deliberate, reasonable PWA design (the key must survive restarts to work
  offline; there is no OS keychain in a web app), and the blast radius is
  bounded: the key only authenticates THIS device row, is scrypt-hashed
  server-side, and revocation/rotation kills it instantly.
- **Why it matters:** Anyone with unsupervised access to the iPad's browser
  context could copy the key and sync forged (but device-bound, envelope-
  validated) events from elsewhere until revoked.
- **Recommendation:** Operational, not code: run the registers in iOS Guided
  Access/single-app mode, keep iPads physically controlled, and rotate device
  keys if an iPad ever leaves the store's custody. Note for the Capacitor app:
  move the key into the iOS Keychain.
- **Status:** OPEN (operational mitigation; revisit at Capacitor packaging)

---

## 🟢 Enhancement

### GW-007 — Offline PIN unlock (register unusable offline until unlocked)
- **Where:** `src/app/pos/RegisterShell.tsx:1597` (offline unlock error copy), at `a61aa816`.
- **What:** Unlock requires the server, so a register that locks (2-minute idle)
  during an internet outage cannot ring OFFLINE sales until connectivity
  returns — the offline-queue machinery is ready, but nobody can get past the
  PIN pad. The UI copy already promises the fix: "Offline PIN cache ships with
  the Capacitor app."
- **Why it matters:** An outage longer than 2 idle minutes turns "offline-first
  POS" into "offline until it locks." Rush-hour outage + auto-lock = line stops.
- **Recommendation:** Ship the planned offline PIN cache (short-TTL, hashed,
  device-bound) either in the Capacitor app or as a carefully-scoped PWA
  feature. Until then: document for staff that during an outage the register
  should be kept awake/in use.
- **Status:** OPEN (roadmap; owner already aware via UI copy)
