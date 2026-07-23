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
- **Status:** FIXED (PR #631) — shared pre-tax back-out in
  `src/lib/reports/tax-base-core.ts` (exemption-aware still-due rate, proven
  identical to the cart's category divisors by embedded self-test); routed
  through it: `ccrs-sales.ts` (incl. pre-tax UnitPrice + pre-tax Discount),
  `sage50.ts`, `sage-exports.ts`, `disposition.ts`, `wa-tax.ts` (header-fit
  auto-detection no longer consulted). `DEFAULT_TAX_SETTINGS.taxBaseMode` now
  `tax_inclusive`; doc comment fixed; golden Sale fixture regenerated with
  hand-verified pre-tax figures. Verified by TEST-PLAN T-135/T-136.

---

### GW-036 — Infused prerolls/blunts/flower counted against the 28 g FLOWER limit instead of the 7 g CONCENTRATE limit
- **Where:** `src/lib/compliance/sales-limits-core.ts` (`categoryToBucket`):
  the four infused website categories (`infused-flower`, `infused-preroll`,
  `infused-blunt`, `infused-preroll-pack`) all returned `"usable"` — the
  1 oz (28 g) flower bucket. Found by the owner while testing the register.
- **What:** Infused products are "cannabis mix infused" under
  WAC 314-55-010(8) — flower combined with concentrate for inhalation. The
  applicable single-transaction cap is the 7 g concentrate limit of
  WAC 314-55-095(1)(d)(i)(C) (21 g medical), not the 28 g useable-cannabis
  limit. With the wrong bucket, the register would happily complete a
  recreational sale of, say, 20 one-gram infused prerolls (20 g "flower",
  under 28 g) — nearly 3× the lawful concentrate maximum.
- **Why it matters:** Selling over the statutory limit is an LCB violation
  with license consequences. This is the exact class of error the limit
  engine exists to prevent, and it silently under-enforced on a whole
  product family the store carries.
- **Fix shipped in the same slice:** the four infused categories now map to
  the CONCENTRATE bucket (whole unit weight counts — conservative, since
  labels don't state the flower/concentrate split and under-counting
  concentrate is the enforcement risk). Every other category mapping was
  re-audited against the WAC text scraped from apps.leg.wa.gov: flower
  family → usable ✓, carts/dabs/RSO → concentrate ✓, solid edibles →
  16 oz ✓, liquids/tinctures/topicals → 72 oz ✓, accessories/merch/
  paraphernalia → not limited ✓. Staff-facing copy updated everywhere the
  buckets are explained (admin sales-limits page, register meter label, AI
  budtender knowledge base).
- **Status:** FIXED (PR #644) — verified by TEST-PLAN T-055 (new) and
  T-047; pinned by 18 new self-tests + vitest mirrors.

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
- **Status:** FIXED (PR #639) — all three unguarded writes are wrapped:
  the queue/sequence persist effect and the provisioning write (now routed
  through one guarded `persistCreds` path). On failure the in-memory queue
  keeps serving and a PERSISTENT storage alert (separate state from the
  routine banner, so a sync message can never dismiss it) tells the human
  exactly what is at risk; it self-clears only when a write succeeds again.
  The recommended early-warning watermark also shipped:
  `queueDepthWarning` (pure, `register-client-core.ts`) fires a loud
  call-a-manager line at ≥200 pending events, well before quota is a real
  risk. Alert precedence: storage failure > depth warning > routine banner.
  Verified by TEST-PLAN T-151/T-152 (long outage / offline restart).

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
- **Status:** FIXED (PR #640) — BOTH recommendations shipped. (1)
  `onUnlocked` now persists the corrected creds through the guarded
  `persistCreds` path (GW-001) the moment a re-bind is revealed. (2) The
  sync route's ACK response now carries the device's CURRENT binding (same
  shape as the empty-batch heartbeat), and `flush()` self-heals the stored
  `registerId` on every successful flush — so even a device that is never
  unlocked (lock-screen punches only) converges to the correct register
  within one sync cycle, and a restart can never resurrect a stale id.
  Verified by TEST-PLAN T-026 (lock-screen punches) after a re-bind +
  restart.

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
- **Status:** FIXED (PR #641) — rejected rows are computed ONCE outside any
  updater from `queueRef.current` (exact: a rejected ack can only match a
  row from `toSend`, which was read from the same ref at flush start, and
  `flushingRef` bars concurrent flushes). `setRejected`/`setBanner` are now
  sibling calls with plain values. `setQueue` keeps a functional updater so
  a sale enqueued during the fetch await survives, but the updater is now
  PURE (`applyAcks` is deterministic — re-invocation is idempotent, no side
  effects). GW-008 (the same impure-updater family in SaleFlow's favorites
  `togglePin`) was fixed in the same slice. Verified by TEST-PLAN T-064.

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
- **Status:** FIXED (PR #636) — all three recommendations implemented plus a
  claim-first hardening pass. (1) `setOrderStatus` now does a true
  compare-and-swap: `.update(patch).eq("id", id).eq("status", fromStatus)`;
  on a CAS miss it re-reads the row and classifies via the new pure helper
  `classifyStatusCasMiss` — if the other actor made the SAME transition the
  call converges (returns success, skips side effects); otherwise it refuses
  in plain English naming the current status. (2) Migration
  `0129_concurrency_guards.sql` adds the partial unique indexes
  (`order_events (order_id, event_type)` for
  'inventory_decremented'/'sale_void_restocked'; `loyalty_ledger (order_id)`
  where kind='earn'), deduping any pre-existing double rows first and
  recomputing loyalty caches from the ledger. (3) The inventory-decrement,
  void-restock, and loyalty-earn markers are now INSERTED FIRST as claims;
  a 23505 unique violation means "already done" and the work is skipped. If a
  decrement fails partway AFTER claiming, the latch is deliberately KEPT
  (releasing it could double-apply the already-written portions) and stamped
  with a note directing staff to reconcile with a cycle count. Until 0129 is
  run the code degrades gracefully: without the unique indexes the claims
  still narrow the race window to pre-fix behavior, never worse.

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
- **Status:** FIXED (PR #636, same slice as GW-011) — migration
  `0129_concurrency_guards.sql` adds two locked-row delta functions,
  `apply_lot_delta(p_lot_id, p_delta, p_clamp, p_actor, p_auto_status)` and
  `apply_variant_delta(p_variant_id, p_delta)`, which compute
  `qty + delta` inside the database under the row lock so concurrent writers
  combine instead of overwriting; it also floors any existing negative lots
  at zero and adds the `check (on_hand_qty >= 0)` constraint. New server
  helper `src/lib/inventory/atomic-quantity.ts` calls the RPCs and, if the
  functions don't exist yet (migration not run), falls back to the legacy
  absolute write — pre-fix behavior, never worse. Every read-modify-write
  site named in this finding now goes through it: sale decrement (variant +
  lot, clamped at 0 with automatic sold_out flip), void restock (flips
  sold_out back to active), disposition posting (STRICT mode — a reduction
  that would go negative is refused and its just-inserted adjustment row is
  rolled back so the ledger never lies), plus a bonus site the finding
  missed: cycle-count variance posting in
  `src/lib/inventory/cycle-counts.ts`.

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
- **Status:** FIXED (PR #637) — `monthRange` now derives the `[from, to)`
  instants from the PACIFIC calendar via the repo's existing
  `pacificWallTimeToUtcISO` helper (Intl-based; DST-correct — the self-tests
  pin PST 08:00Z vs PDT 07:00Z bounds and both transition months), matching
  the wa-tax report and CCRS Sale.csv period basis exactly. The finding's
  scenario is now a pinned test: a 9 PM Pacific sale on the last day of May
  stays in May's return. Bonus (same family): the excise page's
  default-to-previous-month and the export route's fallback month/year were
  ALSO computed from the UTC clock — after 4/5 PM Pacific on a month's last
  day they pointed at the wrong period; both now use `pacificParts`. Box 2's
  `sale_date` window slices the Pacific-anchored instants, so its calendar
  labels stay correct. No migration needed.

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
- **Status:** FIXED (PR #637, same slice as GW-013) — Box 1 is now built from
  ORDER LINES exactly as recommended: new pure `aggregateBox1Lines` in
  `excise-return-core.ts` sums ONLY cannabis-classified lines, each backed
  out to its pre-tax base through the shared GW-010 helper
  (`tax-base-core.preTaxLineBaseMinor`) with per-line WAC 314-55-090(2)
  exemption rates honored. Classification uses the SAME
  `isCannabisCategory` + category rules + menu-snapshot lookup (with the
  ccrs-sales line-snapshot fallback for keypad/custom lines) as the wa-tax
  report — the self-tests pin the reconciliation identity Box 1 ≡ Σ per-line
  wa-tax cannabis bases. Non-cannabis (merch/accessory) dollars excluded
  from Box 1 are now surfaced on the excise page and as a warning so the
  owner can see exactly what was kept out of the 37% excise. Line fetches
  are chunked+paginated (S-7) so busy months never truncate. Order counting
  gained the standard legacy `placed_at` fallback (docs/PERIOD_BASIS.md)
  the old header query lacked. No migration needed.

### GW-017 — Staff invites are broken end-to-end: no redirect target on the invite email, and NO set-password page exists anywhere in the app
- **Where:** `src/app/admin/users/actions.ts:203`
  (`admin.auth.admin.inviteUserByEmail(email)` — called with NO `redirectTo`
  option; the option exists in the SDK,
  `@supabase/auth-js@2.108.2` `GoTrueAdminApi.d.ts:131–136`), the SDK's own
  warning that PKCE is NOT supported for invites (`GoTrueAdminApi.d.ts:78`),
  `src/app/auth/callback/route.ts:65–70` (the only place a session can be
  established from an email link — handles both `?code=` and
  `?token_hash=&type=`), `src/components/admin/LoginForm.tsx:66–73` (the
  magic-link path, which DOES pass
  `emailRedirectTo: …/auth/callback?next=/admin` at `:71`), and the promises
  in the UI: `src/app/admin/users/actions.ts:230` ("They'll get an email to
  set a password") and `src/app/admin/users/page.tsx:89,120` ("they get an
  email to set a password" / "They receive a secure email invite to set their
  password"). Verified by exhaustive grep: `supabase.auth.updateUser` appears
  ZERO times under `src/` — there is no page or action anywhere that can set
  a password. All at `184f6fca`.
- **What:** Two independent breaks. (1) **The email link lands in the wrong
  place.** Because no `redirectTo` is passed, the invite email's link
  redirects to whatever Site URL is configured in the Supabase dashboard —
  NOT to `/auth/callback`. Invite links use the legacy token flow (the SDK
  documents that PKCE is unsupported for invites), so the tokens arrive in
  the URL fragment on whatever page the Site URL points at. The browser
  Supabase client is configured for PKCE
  (`@supabase/ssr` `createBrowserClient.js:40` sets `flowType: "pkce"`), and
  GoTrueClient throws `"Not a valid PKCE flow url."` when it meets an
  implicit-flow fragment (`GoTrueClient.js:3185`), so the invited person
  lands on a page, nothing happens, and they are not signed in. This exactly
  matches the owner's report ("when I add a new user and email them the
  login setup, it fails — it happened to me too"). (2) **Even a perfect
  redirect could not finish the job**, because the app has no set-password
  screen: an invited user who does get a session has no way to choose a
  password, despite three pieces of UI copy promising exactly that. The
  historical "login loop" the owner hit himself was the same class of bug,
  partially fixed by adding `/auth/callback` (PR #36) — but only the LOGIN
  magic-link path was pointed at it, never the invite path.
- **Why it matters:** The owner cannot onboard employees — his stated
  immediate need. The workaround that exists today (and how the owner
  "got around it" himself): the invite DOES create the account, so the
  invited person can go to `/admin/login`, switch to "email me a sign-in
  link", and that email goes through `/auth/callback` correctly. But they
  will never have a password until a set-password page ships. This is a CODE
  problem AND a dashboard-config dependency together; it will NOT fix itself
  at deployment.
- **Recommendation:** One small slice: (a) pass
  `redirectTo: ${siteUrl}/auth/callback?next=/admin/account/set-password`
  to `inviteUserByEmail`; (b) build that set-password page (a form calling
  `supabase.auth.updateUser({ password })` for the already-authenticated
  invitee); (c) owner dashboard actions (cannot be verified from the repo,
  see LENS-02 doc §5): set Site URL to the production domain and add
  `https://<domain>/auth/callback` to the Redirect URL allowlist; (d) keep
  the UI copy honest with whatever ships.
- **Status:** FIXED (PR #632) — `inviteUserByEmail` now passes
  `redirectTo: ${siteBase}/admin/account/set-password` (site base resolved
  from `NEXT_PUBLIC_SITE_URL` with an `x-forwarded-host` fallback via the
  pure `resolveSiteBase` in `src/lib/auth/set-password-core.ts`). Because
  invite links use the legacy token flow, the tokens arrive in the URL
  FRAGMENT — so the new `/admin/account/set-password` page is a client page
  (`SetPasswordForm.tsx`) that reads the fragment BEFORE the PKCE-only
  browser client can choke on it, establishes the session with
  `setSession()`, then sets the password via
  `supabase.auth.updateUser({ password })` and lands the invitee in /admin.
  Expired/incomplete links get friendly errors pointing at the magic-link
  fallback. The existing UI copy ("they get an email to set a password") is
  now true. Dashboard half still owner-action: Site URL + Redirect URL
  allowlist must include `https://<domain>/admin/account/set-password`
  (OWNER-TASKLIST §2 / CUTOVER C-041). Verified by TEST-PLAN T-012.

### GW-018 — The public login page can CREATE staff accounts: magic-link form omits `shouldCreateUser: false`, and a DB trigger auto-provisions every new auth user as an ACTIVE readonly staff profile
- **Where:** `src/components/admin/LoginForm.tsx:66–73`
  (`supabase.auth.signInWithOtp({ email, options: { emailRedirectTo … } })` —
  no `shouldCreateUser: false`; verified by grep, `shouldCreateUser` appears
  ZERO times under `src/`),
  `supabase/migrations/0001_slice1_foundation.sql:147–159`
  (`handle_new_auth_user` trigger inserts a `staff_profiles` row for every
  new auth user) with defaults `role 'readonly'` (`0001:26`) and
  `active true` (`0001:27`), and `src/lib/auth/roles.ts:70,91` (readonly
  holds `dashboard.view` and `reports.view`). At `184f6fca`.
- **What:** `signInWithOtp` defaults to creating a user when the email is
  unknown. `/admin/login` is a public page. So — unless the Supabase project
  has "allow new users to sign up" turned OFF (a dashboard setting that
  CANNOT be verified from the repo; marked UNVERIFIED) — any stranger can
  type their own email into the "email me a sign-in link" form, click the
  link, and arrive as an ACTIVE `readonly` staff member with dashboard and
  reports access. No admin approval step exists in this path; the
  auto-created profile is born active.
- **Why it matters:** `reports.view` exposes the store's sales, tax, and
  export surfaces. If project signups are enabled, this is effectively an
  open door to business data (it would be graded Critical); if signups are
  disabled at the project level, the code is still one dashboard-toggle away
  from that state, with nothing in the repo enforcing or even documenting
  the dependency.
- **Recommendation:** Belt and braces: (a) add
  `shouldCreateUser: false` to the login form's `signInWithOtp` call —
  invited/existing users still get their link, unknown emails get nothing;
  (b) change the trigger default so auto-provisioned profiles are born
  `active = false` (invites already set the intended role/active explicitly
  via the upsert at `src/app/admin/users/actions.ts:216–218`, so onboarding
  is unaffected); (c) owner: confirm "allow new users to sign up" is OFF in
  the Supabase Auth settings (see LENS-02 doc §5).
- **Status:** FIXED (PR #633) — (a) `LoginForm.tsx` magic-link path now
  passes `shouldCreateUser: false`; the server's refusal for unknown emails
  (`otp_disabled`, "Signups not allowed for otp" — verified in
  supabase/auth `internal/api/otp.go`) is folded into the SAME neutral
  "check your email" screen a real staffer sees via the new pure
  `classifyMagicLinkError` (`src/lib/auth/login-messages-core.ts`), so the
  public form can't be used to probe which emails have staff accounts
  (anti-enumeration hardening on top of the fix; the leak is documented in
  supabase/auth issue #1547). Rate limits and real errors stay visible.
  (b) NEW migration `0127_staff_profiles_inactive_by_default.sql` (manual,
  idempotent): `handle_new_auth_user` now provisions `active = false`, and
  the column default flips to `false` — invites and the bootstrap-owner path
  set role/active explicitly so both are unaffected; the file ends with a
  read-only owner review query for existing active profiles. (c) remains an
  owner dashboard action (signups OFF), now a checkbox in OWNER-TASKLIST §2.
  Verified by TEST-PLAN T-011.

### GW-019 — Four tables have NO row-level security at all: `kb_product_categories`, `noncannabis_products`, `noncannabis_sku_sequences`, `noncannabis_adjustments`
- **Where:** `supabase/migrations/0070_kb_product_categories.sql:19`,
  `supabase/migrations/0076_noncannabis_products.sql:26,65`, and
  `supabase/migrations/0111_noncannabis_inventory_ops.sql:52` create the
  tables; no `enable row level security` (and no revoke/grant mitigation)
  exists for them in any migration — verified by script across all
  migrations: 159 tables created, 155 with RLS enabled, exactly these 4
  without. At `184f6fca`.
- **What:** In Supabase, a table without RLS is fully readable AND writable
  through the auto-generated PostgREST API by anyone holding the public anon
  key — which ships in the browser bundle by design
  (`src/lib/supabase/env.ts:6`). The app itself always reaches these tables
  through the service-role client (e.g. `src/lib/noncannabis/store.ts:87`),
  so no app feature depends on the missing policies — the exposure is purely
  the direct-API side door.
- **Why it matters:** `noncannabis_products` carries wholesale COST
  (`cost_minor_units`, `0076:43`) and pricing; `noncannabis_adjustments` is
  an inventory audit trail; an anonymous caller could read margins or
  corrupt glassware inventory counts and SKU sequences. Not a cannabis
  compliance surface, but real business data with anonymous write access.
- **Recommendation:** One migration: enable RLS on all four tables with the
  same staff-read/staff-write policies the neighboring tables use (pattern
  at `0040_medical_doh.sql:134–138`); the service-role client bypasses RLS,
  so nothing in the app changes.
- **Status:** FIXED (PR #638) — NEW migration
  `0130_security_rls_hardening.sql` (manual, idempotent) enables RLS on all
  four tables with LEAST-PRIVILEGE policies (stricter than the recommended
  staff-read/staff-write): `kb_product_categories` staff-read /
  service-role-write; `noncannabis_products` and `noncannabis_adjustments`
  manager+-read (cost/margin + ledger data, mirroring `roles.ts`
  `inventory.manage`) / service-role-write; `noncannabis_sku_sequences` no
  policies at all (service-role-only). The `kb_noncannabis_catalog` view
  (0076) is flipped to `security_invoker = on` so it can no longer bypass
  the table's new RLS. Every claim proven against a real Postgres 15 with
  Supabase-like roles (anon/authenticated/service_role + auth.uid()):
  before-fix exploits reproduced, after-fix denials + service-role
  passthrough all green, applied twice for idempotency. REGRESSION GUARD:
  new pure module `src/lib/security/rls-coverage-core.ts` parses every
  migration (static + dynamic `foreach` RLS forms, comment-aware) and
  `tests/compliance/rls-coverage.test.ts` fails CI if ANY table is ever
  created without RLS again — the auditor's one-time script is now a
  permanent tripwire. Verified by TEST-PLAN T-124.

### GW-020 — The `employees` table (hashed PINs, pay data, encrypted bank columns) is readable AND writable by EVERY active staff account, including readonly, via RLS
- **Where:** `supabase/migrations/0037_staffing_timeclock.sql:144–149`
  (`employees_staff_read … using (public.is_staff())` and
  `employees_staff_write … for all using (public.is_staff())`), columns:
  `clock_pin` (`0037:40`), `bank_routing`/`bank_account_number`/
  `bank_account_type` added by `supabase/migrations/0057_payroll_ach.sql:28–31`.
  Contrast: the payroll tables from the same migration are admin-only
  (`0057:130–136`), and the app layer restricts staffing management to
  owner/admin/manager (`src/lib/auth/roles.ts:94`). At `184f6fca`.
- **What:** `is_staff()` is true for ANY active profile of ANY role
  (`0001_slice1_foundation.sql:133–136`) — including `readonly` and the
  auto-provisioned profiles from GW-018. Such an account can bypass the
  admin UI entirely and hit PostgREST directly with its own session token to
  SELECT every employee row (wage/pay fields, scrypt-hashed PINs, bank
  columns) or UPDATE them (e.g. change a pay rate or null out a PIN hash).
  Mitigations verified: PINs are scrypt-hashed (`src/lib/security/pin-hash.ts`)
  and bank numbers are AES-256-GCM encrypted at rest when
  `DATA_ENCRYPTION_KEY` is set (`src/lib/staffing/store.ts:166–168`) — but
  encryption is OPT-IN (`src/lib/security/at-rest-crypto.ts:16`, plaintext
  passthrough when the key is unset).
- **Why it matters:** Workforce PII and payroll-adjacent data should not be
  one curl command away from the lowest-privilege login. The write policy is
  the sharper edge: a disgruntled `staff`-role user could silently edit
  employee records without any admin UI audit event.
- **Recommendation:** One migration: split the policies — reads for
  staffing managers (`role in ('owner','admin','manager')`, mirroring
  `roles.ts:94`) or at minimum drop the broad write policy to admin-only
  like payroll; the app reaches this table through the service-role client
  (staffing stores), so tightening RLS does not break the UI. Also fold
  "confirm `DATA_ENCRYPTION_KEY` is set in production" into the Cutover
  Checklist.
- **Status:** FIXED (PR #638, same migration as GW-019) —
  `0130_security_rls_hardening.sql` goes past the recommendation in four
  layers (defense in depth): (1) `employees` read tightens to a new
  `is_manager()` helper (owner/admin/manager, mirroring `roles.ts:94`) and
  the write policy is REMOVED entirely — all writes go through the app's
  service-role actions, which check `staffing.manage` and record audit
  events; even an owner session token can no longer edit the roster via the
  API. (2) COLUMN-LEVEL privileges: table SELECT is revoked from
  anon/authenticated and granted back on every column EXCEPT `clock_pin` and
  the three `bank_*` columns — so "banking columns have exactly one read
  path" (T-124) is enforced by the database itself, and any FUTURE column is
  born unreadable until explicitly granted (fail-closed). (3) A
  database-level audit trigger (`trg_employees_audit`) records every
  insert/update/delete on `employees` into `audit_logs` with
  REDACTED snapshots — sensitive values never enter the log, only a
  `_sensitive_changed` list naming which protected columns changed; no code
  path can skip it. (4) `audit_logs` itself becomes need-to-know
  (admin-read, matching the audit page's `users.manage` gate) and
  append-only — UPDATE/DELETE revoked even from `service_role`, so history
  cannot be rewritten with a leaked key. The sibling workforce tables come
  along: `shifts`/`time_punches` lose their broad write policies (a punch
  can no longer be forged with a session token; staff read stays for the
  time clock), and the 0117 HR-file tables tighten to manager+ read. All 49
  live-Postgres proofs pass (before-exploits reproduced, after-denials,
  service-role passthrough, audit redaction, idempotent double-apply).
  `DATA_ENCRYPTION_KEY` was already CUTOVER-CHECKLIST C-051. Verified by
  TEST-PLAN T-124.

### GW-023 — A sale stranded mid-processing stays `pending` forever, the register's retry is told "duplicate" and deletes its copy, and no sweeper exists — silent sale loss on a serverless crash
- **Where:** Insert-then-process: `src/lib/pos/sync-store.ts:196–209`
  (ledger row inserted with default status `pending` per
  `supabase/migrations/0120_pos_foundation.sql:65–66`) before `processSale`
  (`sync-store.ts:315–835`, ~29 sequential awaits) runs; success is only
  recorded at the END (`markProcessed`, `:834`). Duplicate mapping:
  `:214–227` — a retried event whose existing row is still `pending` is acked
  `"duplicate"`. The device treats `duplicate` as durable and DELETES its
  queue copy (`src/lib/pos/sync-core.ts:310–312` `ackMeansDurablyAccepted`;
  `register-client-core.ts:83–125` `applyAcks`). No reprocessor/sweeper for
  stuck `pending` rows exists anywhere (verified by grep); the only reader is
  the day report, which just counts them ("Still processing",
  `day-report-core.ts:93–95,324`). The sync route sets no `maxDuration`
  (`src/app/api/pos/sync/route.ts`). At `00ebb3dd`.
- **What:** If the Vercel function dies between the ledger insert and
  `markProcessed` — timeout on a slow cold start, deploy-time kill, OOM,
  Supabase blip mid-chain — the row is stranded at `pending`. The register
  retries the event on its next flush, the server sees the unique-violation,
  reads the existing row, and answers `"duplicate"` (because only
  `exception` is special-cased). The register then deletes the sale from its
  offline queue. Result: cash was taken, the customer left, and the sale
  never materialized an order — no inventory decrement, no X/Z presence, no
  CCRS line — and nothing will ever retry it.
- **Why it matters:** This is the one gap in an otherwise excellent
  exactly-once design. Every OTHER failure mode was handled (exceptions never
  drop, rejects stay on-device, idempotent replay), but a mid-processing crash
  converts a real sale into a permanently invisible row. The day report's
  "Still processing" count is the only breadcrumb, and it disappears from
  attention after close.
- **Recommendation:** Two small changes close it completely: (1) in the
  duplicate path (`:214–227`), when the existing row is still `pending` and
  older than a threshold (say 2 minutes), RE-RUN processing for it instead of
  acking duplicate — the chain is already idempotent enough to resume (latches,
  atomic claims); (2) add a sweeper (the existing daily cron can host it) that
  finds `pending` rows older than N minutes and reprocesses or escalates them
  to `exception` so they land in the manager queue. Also set an explicit
  `maxDuration` on the sync route.
- **Status:** FIXED (PR #634) — belt, braces, and a steel net. (1) Duplicate
  path: a retried event whose row is still `pending` is now classified by the
  pure `classifyPendingRetry` (`pending-recovery-core.ts`): younger than
  2 minutes → NO ack (the register keeps the row and retries — `applyAcks`
  leaves un-acked rows queued, so no device change was needed); stale with no
  order and attempts remaining → the full processing chain RE-RUNS on the
  existing ledger row; stale with an order already materialized, or after 3
  recovery attempts → escalates to the manager exception queue with a written
  reason — never silent, never a blind re-run over a half-built order.
  (2) Sweeper: `sweepStalePendingEvents()` piggybacks on the existing daily
  cron (`/api/cron/compliance-reminders` — Vercel Hobby allows one daily
  cron), healing rows stuck ≥10 minutes even if that register never flushes
  again; every recovery is audited (`register.sync_recovery`). (3) Migration
  **0128**: `pos_sale_events.recovery_attempts` (the poison-event cap) and
  `orders.pos_client_uuid` + UNIQUE index — the DATABASE now refuses a second
  order for the same register event no matter how the code crashes (existing
  POS orders backfilled from the staff-note breadcrumb; the code also stamps
  `order_id` onto the ledger row immediately after the order insert, so a
  crash later in the chain leaves a breadcrumb the classifier trusts).
  (4) The sync route sets `maxDuration = 60` so slow cold starts stop
  causing the strand in the first place. Verified by TEST-PLAN T-060/T-063
  (exactly-once under outage/flake) and the new T-067 (stranded-sale
  recovery drill).

### GW-024 — Order email + receipt-print queueing are fire-and-forget on a serverless runtime with no `waitUntil`: work can be silently dropped when the function freezes
- **Where:** `src/app/api/orders/route.ts:175–181` (`notifyOrderPlaced(…)
  .catch(() => {})`) and `:185–206` (`queueOrderReceipt(…).catch(() => {})`)
  — the response returns immediately after; no `waitUntil` exists anywhere in
  `src` except the service-worker (`sw-core.ts`). At `00ebb3dd`.
- **What:** On Vercel, a function may be frozen as soon as the response is
  sent. The un-awaited promises (Resend fetch; Supabase insert of the print
  job) then may never complete. Some fraction of website orders would save
  correctly but produce NO staff email, NO customer email, and NO queued
  receipt — with `.catch(() => {})` guaranteeing no log either.
- **Why it matters:** Staff email is how the store learns a pickup order came
  in when nobody is watching the admin orders page. A silently-lost
  notification is a customer standing at the counter with no order pulled.
- **Recommendation:** Await both calls before responding (they are quick:
  one HTTP call, one insert — worst case adds ~1s to order placement), or use
  `waitUntil` from `next/server` (Vercel supports it via
  `request.waitUntil`/`after()`) so the platform keeps the function alive.
  Keep the `.catch` so failures still never block the customer, but log them.
- **Status:** FIXED (PR #635) — both post-order work blocks (notify emails +
  receipt-print queue) now run inside `after()` from `next/server` (verified
  exported by the installed Next 16.2.9): the platform keeps the function
  alive until the work finishes, while the customer's 201 response still
  returns immediately. Every branch logs: success logs one confirmation
  line, failure logs the reason (`console.error` inside the `after` blocks —
  no more `.catch(() => {})`). Bonus: `queueOrderReceipt` is now passed the
  real internal `orderId` (previously always `null`), so receipt print jobs
  are linked to their order; the internal id is threaded through
  `PlacedOrderResult` and explicitly stripped from the customer-facing
  response. Exercised by TEST-PLAN T-006 and T-104.

### GW-029 — Every “Back to …” link in the back office is bare: all 33 of them wipe the filters/search you had on the list page
- **Where:** Scripted sweep of every `href` whose text says “Back …” across
  `src/app/admin`: **33 found, 0 carry a query string.** Representative:
  `src/app/admin/orders/[id]/page.tsx:74` (`href="/admin/orders"`),
  `src/app/admin/products/[key]/page.tsx:63`,
  `src/app/admin/menu-imports/[id]/page.tsx:96`,
  `src/app/admin/inventory/intake/page.tsx:171` — full list in
  `LENS-04-UX-FLOW.md §2`. At `9f9880ba`.
- **What:** The list pages themselves are built RIGHT — all 143 admin pages
  are server components and 102 of them read filters from the URL
  (`searchParams`), so the address bar already holds your filter state and
  the browser Back button preserves it. But every in-app “Back to orders” /
  “← All products” link is a hard link to the bare list route, and the
  row-links INTO detail pages (`orders/page.tsx:182`) don’t pass the current
  query along, so there is nothing for the detail page to send you back to.
  Filter to “New”, search “sarah”, open an order, click “Back to orders” —
  filter and search are gone; owner reports this “almost everywhere,” and
  the sweep confirms it is literally everywhere.
- **Why it matters:** This is the single biggest workflow tax in the back
  office. Working a queue (orders, exceptions, intake, drafts) means
  re-applying the same filter after EVERY item — the owner’s “combatant
  bottleneck.” The industry-standard fix (state in the URL) is already 90%
  built; only the links discard it.
- **Recommendation:** One mechanical pattern, applied everywhere: (1) list
  pages append their current query string to each row/detail link as
  `?back=<urlencoded current qs>`; (2) a tiny shared `BackLink` component
  reads `back` from `searchParams` and renders
  `href={`/admin/orders?${back}`}` (falling back to the bare route);
  (3) breadcrumb links to list pages do the same. Server-component friendly,
  no client state, works with the existing URL-state architecture. Spec with
  code-level detail in `DESIGN-SYSTEM-SPEC.md §5`.
- **Status:** FIXED (PR #645) — exactly the recommended pattern, applied
  everywhere. New pure core `src/lib/admin/back-link-core.ts`
  (`withBackParam` / `backHref` / `currentQueryString`, 28 embedded
  self-tests + vitest mirror) and shared server component
  `src/components/admin/ux/BackLink.tsx`. Safety rails beyond spec: `back`
  only ever restores a QUERY STRING onto the caller's own fallback route
  (path/protocol/host injection rejected), and one-shot flash params
  (`saved`, `error`, `created`, `resolved`, …35 keys) are stripped so stale
  banners never resurrect. 40 pages wired (every back-style link found by
  scripted sweep — the audit's 33 plus drift), and 9 list pages with real
  filter state thread `withBackParam` into their row/detail links,
  including multi-level chains (purchasing menus → item). Manual test:
  T-163.

### GW-030 — The button system is fragmented: a canonical brand Button exists, but ~274 raw buttons bypass it — 92 white-text vs 85 black-text, 39 transparent/outline, 29 hard-coded off-palette colors
- **Where:** Canonical component: `src/components/admin/ui/Button.tsx:45–55`
  (5 solid variants, ALL black ink on brand fills, pill/uppercase — the
  owner-approved system from `docs/TODO_BEAUTIFICATION.md`). Scripted sweep
  of `src/app/admin` + `src/components/admin`: 274 raw `<button>` elements
  plus ~91 button-styled links do NOT use it. Classifier results: **92
  white-text vs 85 black-text** (the exact inconsistency the owner
  reported), **39 transparent/outline** (the style the beautification round
  supposedly killed), **29 hard-coded non-brand hex fills**, including
  off-palette `bg-sky-400` and `bg-fuchsia-400`
  (`src/app/admin/vendors/[id]/page.tsx:223,:261,:543`,
  `:508` `bg-[#5ec1ff]`), a rogue lowercase pill
  (`src/app/admin/products/[key]/page.tsx:164`), and `bg-red-600` instead of
  the brand `--admin-danger` (`src/app/admin/settings/reset/page.tsx:142`).
  89 files carry at least one flagged element. At `9f9880ba`.
- **What:** The B1 “button unification” slice converted the shared component
  and the worst pages, but the long tail of ad-hoc buttons was never swept.
  Every ad-hoc button is a page that drifts from the brand: different
  radius, different casing, different color meanings (green sometimes has
  white text, sometimes black; blue and fuchsia mean nothing in the brand
  vocabulary).
- **Why it matters:** This IS the owner’s “some buttons are white-text,
  some are less flashy” report, quantified. Consistent button grammar is
  what makes an interface learnable — staff should know green=go,
  orange=main action, gold=save, red=danger *without reading*.
- **Recommendation:** A mechanical migration sweep, file-by-file, replacing
  every ad-hoc button/link-button with `<Button>` (or its documented chip
  classes for in-table density), using the mapping table in
  `DESIGN-SYSTEM-SPEC.md §3` — including a new PURPLE `special` variant for
  AI/crawler actions (due the sky/fuchsia buttons a home in the palette,
  per the owner’s wish for a purple). Visual before/after:
  `docs/audit/lens4-visuals/01…04.png`.
- **Status:** FIXED (PR #646) — full mechanical sweep landed. Every flagged
  raw button in the back office now goes through the canonical `<Button>`
  (or the exported `CHIP_ACTION` / `CHIP_NEUTRAL` classes for compact
  in-row/in-table actions). The `special` PURPLE variant
  (`--admin-purple: #c084fc`, black ink at 7.95:1) was added for
  "the machine does something for you" actions — every AI advisor,
  crawler, GrowFlow-sync, Ask/Analyze/Suggest/Generate button is now
  purple; the off-palette sky/fuchsia/`#5ec1ff` buttons are gone.
  `bg-red-600` now uses the brand `danger` variant, the rogue lowercase
  pill uses `<Button size="sm">`, and per mapping rule 13 every raw brand
  hex touched in the sweep was converted to its `var(--admin-*)` token in
  the same commit. The only intentional exemption is `AdminTopNav`'s two
  ghost chips (nav chrome, mapping rule 11). Guarded by
  `scripts/audit/button-sweep-inventory.py` (repo) and exercised by
  T-164 (TEST-PLAN §12.8).

### GW-031 — Twelve buttons put WHITE text on the solid brand green: 1.76:1 contrast — unreadable in bright light and a WCAG failure
- **Where:** Scripted contrast sweep (WCAG 2.2 relative-luminance math):
  `#ffffff` on `#7ed957` = **1.76:1** (AA requires 4.5:1 for text; even
  large-text/UI needs 3:1). All 12 sites:
  `src/app/admin/medical/page.tsx:67`,
  `src/app/admin/integrations/page.tsx:113,:140`,
  `src/app/admin/knowledge-base/faqs/page.tsx:93`,
  `src/app/admin/knowledge-base/about/page.tsx:93`,
  `src/app/admin/inventory/drafts/page.tsx:134`,
  `src/app/admin/inventory/intake/page.tsx:405` (file-upload control),
  `src/app/admin/vendors/[id]/page.tsx:155`,
  `src/components/admin/medical/GuidedIntakeWizard.tsx:447`,
  `src/components/admin/medical/MedicalPanel.tsx:107`,
  `src/components/admin/medical/CardPrintButton.tsx:14`,
  `src/components/admin/medical/DohProductRegistry.tsx:146`. At `9f9880ba`.
  Contrast: the canonical Button already gets this right — black ink on
  every brand fill (green 11.95:1, orange 8.29:1, gold 14.97:1, red 6.86:1
  — all PASS).
- **What:** These are exactly the “white text in buttons when all the other
  buttons have black text” the owner flagged — and they’re not just
  inconsistent, they’re objectively hard to read. Notably 5 of the 12 are
  in the medical suite, where a bariatric-bright dispensary counter is the
  worst place for low-contrast labels.
- **Why it matters:** Readability failures cause mis-taps and slow staff
  down; WCAG 1.4.3 is the codified floor for “can a human read this.”
- **Recommendation:** `text-white` → `text-black` on all 12 (or migrate the
  whole element to `<Button variant="confirm">`, which is the same fix with
  consistency thrown in). One-line changes; zero logic risk.
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
- **Status:** FIXED (PR #641, same slice as GW-003) — exactly the
  recommended shape: `toggleFavorite` computes `next` BEFORE setState (pure
  updater gone), and the `setItem` is wrapped in try/catch that degrades to
  "the pin doesn't survive a restart" while the session keeps the pin from
  state. Completes the safe-localStorage-writes family (GW-001 PR #639,
  GW-003 this PR).

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

### GW-021 — Two admin search boxes interpolate the raw search term into a PostgREST `or(…ilike…)` filter without escaping
- **Where:** `src/lib/equipment/store.ts:138–139` (`const like = `%${opts.q}%``
  into `query.or(...)`) and `src/lib/loyalty/signups-store.ts:166–175` (same
  pattern across five columns). Contrast with the sites that DO sanitize:
  `src/lib/vendors/store.ts:54` (escapes `%`, strips commas),
  `src/lib/medical/sale-store.ts:59` (strips `%_,`), and
  `src/lib/purchasing/vendor-platform-store.ts:67,122` (`escapeLike`). At
  `184f6fca`.
- **What:** The term is embedded in PostgREST filter SYNTAX, so a comma,
  parenthesis, or `%` in the search box changes the filter grammar instead
  of being searched for. This is NOT SQL injection (Supabase parameterizes
  the SQL); the blast radius is a broken/over-broad filter or a
  pattern-complexity slowdown, behind a staff login in both cases.
- **Why it matters:** Searching equipment for `50%,off` or a loyalty signup
  for a name containing a comma returns wrong results or an error — a
  papercut, but the codebase already owns the fix.
- **Recommendation:** Reuse the existing `escapeLike` helper (or hoist it to
  a shared module) at both call sites.
- **Status:** OPEN

### GW-025 — Order notification email is sent blind: the Resend response status is never checked
- **Where:** `src/lib/orders/notify.ts:39` (`await fetch(RESEND_ENDPOINT, …)`
  with no `res.ok` check anywhere in the file), at `00ebb3dd`.
- **What:** `sendEmail` awaits the fetch but ignores the response. A 401 (bad
  key), 422 (unverified from-address), or 429 (rate limit) from Resend looks
  exactly like success — no log line, no error, nothing. Contrast: the
  newsletter/loyalty senders and the webhook ingest paths all inspect status.
- **Why it matters:** When order emails stop arriving, there is no signal
  anywhere to distinguish "env not configured" (deliberate silent skip) from
  "Resend rejected every call" (misconfiguration). Combined with GW-024 the
  whole notification path is a black box.
- **Recommendation:** Check `res.ok`; on failure log status + response body
  (Vercel logs) so misconfiguration is diagnosable. Optionally write a row to
  `order_events` so it is visible in the back office.
- **Status:** FIXED (PR #635, same slice as GW-024) — `sendEmail` now checks
  `res.ok` and returns a structured `EmailSendOutcome`
  (sent/failed/skipped + a compact `HTTP <status> — <body snippet>` detail
  via `describeSendFailure`, capped at 180 chars); it never rejects. The
  pure `summarizeNotifyOutcomes` (`notify-outcome-core.ts`, 16 embedded
  self-tests + vitest mirror) turns the outcomes into one diagnosable log
  line AND — the recommendation's "optionally" made mandatory — a
  plain-English warning written onto the order's back-office timeline
  (`order_events`, actor "system · email monitor") whenever a send FAILS.
  A failed STAFF alert gets the loudest note ("treat this page as the only
  alert") because that is the customer-at-the-counter case; legitimate
  skips (env not configured, guest without email) stay quiet. Exercised by
  TEST-PLAN T-006.

### GW-032 — Active filter chips are grey-on-grey whispers: the selected filter barely differs from the unselected ones
- **Where:** The chip pattern repeats on at least 5 list pages:
  `src/app/admin/orders/page.tsx:138–143` (active =
  `bg-[var(--admin-accent-soft)]` — a 14%-alpha tint),
  `src/app/admin/loyalty-signups/page.tsx:256`,
  `src/app/admin/reports/page.tsx:88`,
  `src/app/admin/reports/forecast/page.tsx:93,:137`,
  `src/components/admin/reports/ReportTabs.tsx:46` (active tab =
  `bg-[#7ed957]/15`). At `9f9880ba`.
- **What:** The ACTIVE state is a soft green tint on a dark surface —
  visible if you look for it, invisible at a glance. Owner asked for the
  brand colors to be USED, prominently. A wrong mental model of “which
  filter am I on” is also an error vector (staff acting on the wrong list).
- **Why it matters:** Selected-state prominence is bread-and-butter visual
  hierarchy: the current state of the screen should be its loudest fact.
- **Recommendation:** Active chip = SOLID brand green with black ink
  (`bg-[var(--admin-accent)] text-black`), inactive stays muted. Verified
  visually in the harness (`lens4-visuals/03-….png`) — the solid chip is
  unmissable without shouting. Same treatment for ReportTabs’ active tab.
- **Status:** OPEN

### GW-033 — List pages silently truncate at 200–500 rows with no count, no pagination, no “showing N of M”
- **Where:** `src/lib/orders/orders-store.ts:194` (`limit(filter.limit ??
  200)`), `src/lib/inventory/store.ts:48` (`limit(opts?.limit ?? 500)`),
  `src/lib/customers/store.ts:28` (500) — and the orders, inventory, and
  customers pages render whatever comes back with no total count or “more
  exists” indicator. Contrast: products DOES say “Showing first 300 of N”
  (`src/app/admin/products/page.tsx:426`) and vendors has real pagination
  (`src/app/admin/vendors/page.tsx:246`). At `9f9880ba`.
- **What:** Once the store passes ~200 orders or ~500 customers/lots, the
  oldest rows just stop appearing, with nothing telling staff the list is
  clipped. Search still works (it queries the DB), so the failure is subtle:
  “scroll to find it” quietly becomes “it isn’t there.”
- **Why it matters:** At real retail volume (hundreds of orders/week) this
  bites within the first month of cutover. The two good patterns (products’
  count line, vendors’ pager) already exist in-repo.
- **Recommendation:** Every list query returns `{ rows, total }`; every list
  page shows “Showing X of Y — refine or page” with URL-param pagination
  (`?page=2` — consistent with the URL-state architecture and GW-029’s
  back-links).
- **Status:** OPEN

### GW-027 — The register promises "manager reviews in the back office" for REJECTED rows, but no back-office page shows them
- **Where:** Register status bar copy `src/app/pos/RegisterShell.tsx:2225`
  ("N rejected — manager reviews in the back office"); rejected rows are kept
  only in THAT device's localStorage queue (`applyAcks` keeps non-durable acks,
  `src/lib/pos/register-client-core.ts:83–125`); the admin exception queue
  reads only server-side ledger rows with `status='exception'`
  (`src/lib/pos/sync-store.ts:1087,1107,1130`;
  `src/app/admin/registers/exceptions/page.tsx`). At `00ebb3dd`.
- **What:** "Rejected" means the server refused the event BEFORE it entered
  the ledger (bad envelope, unknown device, schema missing). Those rows never
  exist server-side, so the back office cannot list them — the only place they
  are visible is the register's own status bar and banner. The UI copy tells
  staff a manager will see them in the back office, which is not true; a
  manager must physically go to that iPad.
- **Why it matters:** A persistent rejected row (e.g. after a device re-bind
  problem, GW-002) can sit unnoticed on one device while everyone believes the
  back office has it. The data itself is safe (kept on-device, GW-001 caveat
  aside) but the review workflow the copy promises does not exist.
- **Recommendation:** Either (a) soften the copy to "review on this register",
  or better (b) have the register report its rejected-row count/summaries
  through the existing heartbeat sync so the admin registers page can show
  "Register 2 has 3 rejected rows on-device."
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

### GW-022 — CloudPRNT poll token is compared with plain `===`, not a constant-time compare
- **Where:** `src/app/api/cloudprnt/route.ts:75` (`if (provided === expected)
  return null;`). Contrast: every other secret comparison in the codebase
  uses `timingSafeEqual` (`src/lib/security/pin-hash.ts:17,47`, webhook
  verifiers). At `184f6fca`.
- **What:** The printer-poll endpoint authenticates the Star printer by a
  shared token; a plain string compare short-circuits on the first differing
  character, which in theory leaks match-length via response timing. The
  endpoint already fails closed in production when the token is unset (S-9),
  so this is a polish item, not a hole — practical exploitation over the
  open internet against a V8 string compare is largely theoretical.
- **Why it matters:** Consistency: the codebase's own standard is
  constant-time comparison for every bearer secret; this is the one
  stray site.
- **Recommendation:** Length-check then `timingSafeEqual` on the UTF-8
  bytes, same as `verifyPin` does.
- **Status:** OPEN

### GW-026 — A receipt print job that can never print retries forever every 2 minutes; `attempts` is counted but never capped, and the `failed` status exists but nothing ever sets it
- **Where:** `src/lib/printing/printer-store.ts:186–196` (claimNextJob
  re-claims any `printing` job stale >2 min), `:205` (`attempts:
  job.attempts + 1` — incremented, never checked), `:27–33` (`"failed"` in
  the status union), `:246` (cancelJob is the ONLY code that references
  `failed`, and only to read it). At `00ebb3dd`.
- **What:** The stale-reclaim is good design (a dropped confirmation doesn't
  strand the queue), but there is no upper bound. A poison job — e.g. a
  payload the printer rejects every time — is re-claimed every 2 minutes
  forever, and because claimNextJob takes the OLDEST job first, it sits at
  the head of the line blocking newer receipts behind it until someone
  manually cancels it from the staff UI.
- **Why it matters:** One bad job can quietly stall all receipt printing;
  the schema already anticipated the fix (`attempts` column since 0047,
  `failed` status in the type) — it's just never wired.
- **Recommendation:** In claimNextJob, when `job.attempts` reaches a cap
  (e.g. 5), set status `failed` instead of re-claiming, and surface failed
  jobs on the equipment page (cancelJob already handles them).
- **Status:** OPEN

### GW-028 — The 24-hour order "reservation window" is written but never read: nothing expires an order or releases its hold
- **Where:** `src/lib/orders/orders-store.ts:50` (24h
  `reservationExpiresAt` computed), `:65` (written); the only other
  reference in the entire codebase is the type declaration
  (`src/lib/orders/types.ts:75`). No job, query, or UI reads it. At
  `00ebb3dd`.
- **What:** Every website order stores a reservation-expiry timestamp, but
  no code ever consults it — orders never auto-expire, and marking a
  customer a no-show is a purely manual action on the admin orders page.
  The code comment honestly calls it a "soft reservation window: 24h
  advisory hold," so this is working as designed — but the design leaves
  stale `new` orders accumulating until staff clean them up.
- **Why it matters:** GW-015 already showed never-completed orders leak
  into internal revenue reports; stale unexpired orders are the feedstock
  for that. An owner reading the schema would reasonably believe a 24-hour
  auto-release exists when it does not.
- **Recommendation:** Either enforce it (the daily cron can flip `new`
  orders past `reservation_expires_at` to `no_show`/`expired` and note it in
  `order_events`) or drop the column to stop implying behavior that doesn't
  exist. Enforcing pairs naturally with the GW-015 fix.
- **Status:** OPEN

### GW-034 — Brand colors are hard-coded as raw hex in ~82 class sites instead of the tokens, so a palette tune-up can’t happen in one place
- **Where:** Scripted sweep: 82 button/chip class strings hard-code
  `#7ed957`/`#ff7f00`/`#ffd700` instead of `var(--admin-accent)` /
  `var(--admin-orange)` / `var(--admin-gold)`; e.g.
  `src/app/admin/vendors/[id]/page.tsx:186,:393,:444`,
  `src/app/admin/products/[key]/page.tsx:98,:164,:284`,
  `src/components/admin/reports/ReportTabs.tsx:46`,
  `src/app/admin/loyalty-signups/page.tsx:256`. The tokens exist precisely
  so “change a value here, the whole product moves”
  (`src/app/globals.css:36–44`). At `9f9880ba`.
- **What:** Two sources of truth for the same green. If the owner ever
  tunes the palette (the light POS theme did exactly this — a deeper green
  `#178a5c` at `globals.css:169`), the 82 hard-coded sites won’t move.
- **Why it matters:** Maintainability of the beauty the owner wants: one
  knob, not eighty-three.
- **Recommendation:** Fold into the GW-030 sweep (same files, same lines):
  hex → token as each button is migrated.
- **Status:** OPEN

### GW-035 — The flow-keeping toolkit is built but barely wired: StickyActionBar used ZERO times, ConfirmDialog once, InfoHint once
- **Where:** `src/components/admin/ux/` contains a genuinely excellent
  toolkit: `ScrollKeeper.tsx` (scroll restore after server-action saves —
  wired admin-wide via layout, works), `StickyActionBar.tsx` (**0
  usages**), `ConfirmDialog.tsx` (**used in only ONE file** —
  `ContentBulkBar.tsx`, two dialogs), `InfoHint.tsx` (**1
  usage**) — against `HelpPanel` (84 usages — the hand-holding the owner
  loves), `EmptyState` (44), and `Toast` (35), which ARE wired. At
  `9f9880ba`.
- **What:** Long editor pages (vendor 593 lines, intake review 909 lines)
  scroll the primary Save/Finalize action off-screen — the exact problem
  StickyActionBar was built to solve — and destructive actions mostly rely
  on browser `confirm()` or nothing while a styled ConfirmDialog sits
  unused. The right furniture was built and left in the box.
- **Why it matters:** “Lazy-river” flow is mostly about never hunting for
  the button you need (sticky bar), never fearing a mis-click (confirm
  dialog), never losing your place (ScrollKeeper — already delivered).
- **Recommendation:** Wire StickyActionBar into the 6 longest editor pages
  (intake review 909 lines, purchasing/new 647, employee 603, vendor 593,
  promotions, blog editor); route destructive buttons through ConfirmDialog
  as part of the GW-030 sweep.
- **Status:** OPEN

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
