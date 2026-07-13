# Pre-POS Seam Audit — the five back-office surfaces the iPad POS will build on

Status: AUDIT COMPLETE (Task AA). Every contract below was verified by reading the actual
source files in full and running the verification loop on current `main`:
- `npx tsc --noEmit` → 0 errors
- `npx vitest run` → 1,289 tests / 88 files, all passing
- `npx tsx scripts/compliance/run-pure-selftests.ts` → ALL PURE SELF-TESTS PASSED

Purpose: ground the POS build in the REAL code (owner directive: "No guessing"). Each section
states the public contract, how the POS consumes it, and any gap the build must close.
Companion doc: `docs/POS_FRONTEND_RESEARCH.md` (the mega report; §14 records owner decisions).

---

## Seam 1 — Money math: `src/lib/orders/order-pricing-core.ts` (pure, 0 I/O)

**Contract (verified):**
- Constants: `CANNABIS_EXCISE_TAX_BPS=3700`, `STATE_SALES_TAX_BPS=650`,
  `LOCAL_CITY_SALES_TAX_BPS=280`, `TAX_INCLUSIVE_DIVISOR=1.463`,
  `NON_CANNABIS_TAX_INCLUSIVE_DIVISOR=1.093`,
  `NON_CANNABIS_TAX_CATEGORIES={merch,accessories,accessory,paraphernalia}`,
  `MIN_CANNABIS_UNIT_PRICE_MINOR=1`.
- `assertCannabisLineSellable(line, floorMinor=1): {ok}|{ok:false,reason}` — cannabis lines
  must carry a positive minor-unit price; non-cannabis exempt.
- `clampCannabisUnitPrice(category, unit, regular, floor=1)` — discount engines can never
  produce a $0 cannabis unit; regular-price-0 lines are left for the assert to refuse.
- `computeOrderTotals(lines: TotalsLine[]): OrderTotals` — total = Σ tax-inclusive line
  totals; subtotal = per-line back-out with category-correct divisor, rounded ONCE
  (`Math.round` of the float sum); tax = total − subtotal; savings = max(0, regular − total).
  Quantities are `Math.max(0, Math.round(q))`.
- `moneyMatches(a, b, toleranceMinor=2)`.
- Self-tests: `__runOrderPricingTests()` — pass on main.

**POS consumption:** import verbatim into the Capacitor bundle (file is already pure — no
React/DB/server-only imports; confirmed). The cart, tender screen, and receipt all call
`computeOrderTotals`; manual-discount UI calls `clampCannabisUnitPrice` +
`assertCannabisLineSellable` before accepting input.

**Gaps:** none in the core. Note the acquisition-cost floor (below-cost) lives in
`cart-discount.ts` / `loyalty-sale-core.ts`, not here — the POS must pull BOTH floors.

---

## Seam 2 — Completion gate: `src/app/admin/orders/actions.ts` → `runCompletionGate` (584 lines, read)

**Contract (verified gate sequence, in order; returns `null` = may complete, else a
human-readable refusal):**
1. Idempotent re-complete: `status === "completed"` → null.
2. **S-12 sales hours** (WAC 314-55-147): `evaluateSalesHours(new Date(), getSalesHoursWindow())`
   — HARD block, no override; owner may only TIGHTEN in Settings.
3. **S-2b money recompute**: `verifyStoredOrderForCompletion(order)` from
   `src/lib/orders/order-pricing.ts` — recomputes totals from stored lines using the Seam-1
   core; compares header total/subtotal/tax with `moneyMatches`; ALSO re-runs the cannabis
   floor per line. Category source: placement-time snapshot (migration 0096) → live-menu
   fallback → CONSERVATIVE default `"flower"` (counts as useable cannabis, and that note
   alone does not fail the money gate). Returns `{ok, problems, limitLines, storedTotals}`.
4. **Loyalty-code consistency** (`checkLoyaltyCodeForCompletion`) — a code order completes
   only while ITS redemption row is consumed by this order.
5. **Medical card re-validation**: attached card → `authorizationValidityAt(card, now)`;
   attached-but-invalid BLOCKS (fix or detach).
6. **DOH 246-70 exemption plan** (`buildOrderExemptionPlan` from stored lines + durable
   registry) → **High-THC HARD gate**: high-THC products sell ONLY with a valid card,
   NO override exists.
7. **S-1b sales-limit HARD gate**: `enforceSalesLimitForSale(limitLines,
   cardedValid ? "medical" : "recreational", {orderId, actorId, override})` — override only
   when caller verified `sales_limit.override` permission AND passed a reason; every
   over-limit encounter is logged to `sales_limit_events` (blocked or overridden — nothing
   silent).
8. **WAC 314-55-090(2) exempt-sale ledger** (write-or-block): claimed exemptions must write
   their 5-year record rows via `recordExemptSalesForOrder`; write failure = refuse to
   complete.
Refusals audit as `completion_blocked` in `setOrderStatusAction`.

**POS consumption (the critical design decision, now grounded):**
- **On-device:** the POS runs the PURE pieces locally for the guided-sale checkpoint —
  Seam-1 totals/floors, `evaluateSalesHours` (pure core), sales-limit evaluation via the
  pure `sales-limits-core`/`sales-limit-gate-core` with a cached copy of the owner's limit
  settings, and the medical plan math (`buildOrderExemptionPlan` is pure given registry +
  card data snapshots).
- **On-sync:** every synced POS sale re-runs the FULL server gate (steps 1–8, including the
  DB-backed loyalty/medical/ledger writes). Gate refusal on sync routes to the manager
  exception queue (POS_FRONTEND_RESEARCH §4.2) — never silently dropped.

**Gaps:** `runCompletionGate` is a private function inside a `"use server"` actions file.
The POS sync endpoint cannot import it as-is → **extract it (verbatim) into a shared
server module** (e.g. `src/lib/orders/completion-gate.ts`) that both the admin action and
the POS sync route call. Pure-refactor slice, behavior identical, existing tests must stay
green.

---

## Seam 3 — Registers & drawers: `src/lib/registers/{store,cash,oversight}.ts` (403/105/496 lines, read)

**Contract (verified):**
- Types: `Register{id,name,kind:"sales"|"manager_till",default_float_minor,active,sort_order,notes}`;
  `DrawerSession{status:"open"|"closed"|"reconciled"|"verified", opening/closing/expected/
  over_short _minor, business_day, opened_by/closed_by, shift_id, ...}`;
  `DrawerDrop{amount_minor, drop_window:"afternoon"|"night"|"other", dropped_by, witnessed_by}`.
- Lifecycle functions: `openDrawer({registerId,employeeId,shiftId,denoms})` (one open session
  per register, denomination count-in writes `drawer_counts` type "open");
  `recordDrop(...)` (amount>0); `closeDrawerBlind(...)` (blind — stores count, does NOT
  reveal expected); `reconcileDrawer({sessionId,cashSalesMinor,reconciledBy})` (manager
  enters cash sales; expected = opening + cashSales − drops; reveals over/short);
  `verifyTill(...)` (manager-till next-morning independent recount → `till_verifications`).
- Pure math in `cash.ts`: `DenomCounts` (13 denominations incl. $2 bills, 50¢ and $1 coins),
  `denomTotalMinor`, `parseDenoms`, `expectedClose`, `overShort`, `formatCents`.
- **Seed (migration 0038, corrected by 0077): exactly the owner's launch plan already —
  "Sales Register 1" + "Sales Register 2" (float $167.50 = 16750¢ each) + "Manager Till"
  (float $300.00 = 30000¢).** No schema change needed for 3 registers.

**POS consumption:** the iPad till binds to a `Register` row; PIN-unlock associates each
sale with the budtender + the register's open `DrawerSession`; count-in/count-out screens
reuse `DenomCounts`/`denomTotalMinor` (pure — bundles fine); drops prompt in the
afternoon/night windows.

**Gaps:** (a) `reconcileDrawer` takes `cashSalesMinor` as MANUAL manager input today — once
the POS records tendered cash per sale, the reconcile UI should PREFILL cash sales from
synced POS events (keep manual override, log deltas). (b) `drawer_sessions` has no
`device_id` — add nullable column when POS lands so a session knows which iPad served it.
(c) Sales are not yet linked to sessions — POS sale events must carry
`register_id` + `drawer_session_id` + `employee_id`.

---

## Seam 4 — Time clock: `src/lib/staffing/timeclock-core.ts` (175 lines) + `store.ts` callers (read)

**Contract (verified):**
- Pure core: `parseWallTimeLocal("YYYY-MM-DDTHH:mm[:ss]")`, `minutesBetween`,
  `parsePunchEdit({clockInLocal,clockOutLocal?,reason})` (reason mandatory 3–500 chars,
  same-day out>in check), `composeEditNote` (stacks newest-first, 2000-char cap),
  `__runTimeclockCoreTests()` — pass.
- Store: `toggleClock(employeeId, source)` with `source: "web" | "station" | "phone"`;
  `openWorkPunch`, `onTheClock()`, `punchesForDay`, `listPunchesForDayAll`,
  `updatePunchTimes`, `createManualPunch`.
- Actions: `clockByPinAction` / `clockByPinPhoneAction` — throttle check → `isValidPin`
  (4–6 digits) → `getEmployeeByPin` → `toggleClock(emp.id, source)` → audit
  (`timeclock.in|out`), all behind `timeclock.use` permission.

**POS consumption:** the register lock screen hosts clock in/out using the same PIN →
`toggleClock` flow with a new `source: "register"` (or reuse `"station"`). Offline
clock-in/out becomes a queued event that replays `toggleClock` on sync.

**Gaps:** (a) `source` is currently typed to the three literals — extending to
`"register"` is a one-line union + column check (verify DB constraint on
`time_punches.source` before adding). (b) Offline punches need idempotent replay (client
UUID like sale events); `toggleClock` is toggle-semantics, so the queued event must record
the INTENDED action (`in`/`out`) and the replay must assert it, not blindly re-toggle.

---

## Seam 5 — Auth & PIN: `src/lib/auth/{session,roles,webauthn-core}.ts` + `src/lib/security/pin-hash.ts` (read)

**Contract (verified):**
- `getStaffSession(): {userId,email,profile}` (Supabase auth + `staff_profiles`, bootstrap
  owner promotion); `requireStaff()`; `requirePermission(p)`.
- Roles: owner/admin/manager/content_editor/staff/readonly; `ROLE_RANK`; permission MATRIX
  is explicit per permission. Relevant grants: `orders.manage` (staff+), `timeclock.use`
  (staff+), `sales_limit.override` (manager+), `inventory.manage` (manager+),
  `settings.manage` (admin+).
- **PIN infrastructure EXISTS (v1 research assumed it would need building — corrected):**
  `employees.clock_pin` stores salted scrypt hashes (`pin-hash.ts` S-10:
  `scrypt$<salt>$<hash>`, N=16384/r=8/p=1, constant-time verify, legacy-plaintext
  hash-on-use migration); `getEmployeeByPin(pin)` verifies against all active employees;
  in-memory throttle (5 failures/60s → 60s lockout); PIN uniqueness enforced at save.
- WebAuthn passkeys (`webauthn-core.ts`, rpID = bare hostname) available for the manager
  approval step on the iPad if wanted later.

**POS consumption:** the iPad holds a device-scoped staff session (provisioned by a
manager at setup); humans are identified per-action by the EXISTING employee PIN system —
same PINs staff already use to clock in. Offline PIN verify: cache active employees'
`clock_pin` hashes in device SQLite; scrypt verify runs locally (pure `node:crypto` —
needs a Capacitor-compatible scrypt (JS/WASM or plugin); parameters are small: 25ms
target).

**Gaps:** (a) `employees` (PIN holders) and `staff_profiles` (auth/permissions) are
SEPARATE tables — POS needs a mapping for manager-override checks by PIN (either link
`employees.staff_id` → profile, which exists as a column (`staff_id`), or gate overrides
on job_role; verify linkage data before relying on it). (b) The PIN throttle is
per-server-process in-memory — the POS device needs its OWN local throttle mirroring the
same constants. (c) No `pos.*` permissions exist yet; likely additions:
`pos.sell` (staff+), `pos.device.provision` (admin+) — additive MATRIX change.

---

## Verdict

The five seams are **stable, pure where it matters, and POS-ready**. No contract needs
breaking changes. The build needs exactly four additive refactors, all low-risk:
1. Extract `runCompletionGate` into a shared server module (Seam 2).
2. Add `register`/device linkage to sale events + optional `device_id` on drawer sessions
   (Seam 3).
3. Extend punch `source` union + intent-carrying offline punch events (Seam 4).
4. Employee↔staff-profile linkage check + local scrypt verify + `pos.*` permissions
   (Seam 5).

These become early tasks in POS slice P0/P1 (POS_FRONTEND_RESEARCH §11).
