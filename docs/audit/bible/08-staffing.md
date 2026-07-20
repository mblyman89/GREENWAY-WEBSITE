# Bible Chapter 08 — Staffing & the Time Clock (Roster, PINs, Punches, Schedules, Lifecycle)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9a63c8b1` (every file:line anchor re-checked on
> that tree — if a line looks off, the file changed after this chapter was
> written; re-verify before trusting).
> **Plain-English promise of this chapter:** every employee is one row in one
> table; their 4–6 digit PIN is stored as an irreversible hash; every guess at
> a PIN pad is rate-limited; every minute worked comes from a punch row that
> only a manager can edit — and every edit leaves a written reason and an audit
> trail. When someone is terminated, their PIN is wiped in the same database
> write that ends their employment.

---

## 1. The big idea in one paragraph

Staffing lives in three database tables created by migration
`supabase/migrations/0037_staffing_timeclock.sql`: `employees` (`:32`),
`shifts` (`:58`), and `time_punches` (`:85`). An employee clocks in and out by
PIN; each in/out pair becomes one **punch** row attached to a **shift** row for
that Pacific-time business day. Hours-worked math is nothing more than
"clock-out minus clock-in, in minutes" summed over work punches — there is no
hidden calculation anywhere. Around that simple core sit four protective
layers: (a) PINs are scrypt-hashed so nobody (not even the database) can read
them; (b) a durable brute-force throttle locks a PIN pad after 5 bad guesses in
60 seconds; (c) manager hour-adjustments require a written 3–500 character
reason and write a `timepunch.edited` / `timepunch.created` audit event; and
(d) a full employment-lifecycle module (migration `0117`) walks the owner
through hiring and termination in the legally required order (WA Fair Chance
Act) and computes WA paid sick leave accrual.

---

## 2. The roster — one employee, one row

**File:** `src/lib/staffing/store.ts` (639 lines, server-only).

- The `Employee` type is at `store.ts:17`. Key columns:
  - `clock_pin` (`:26`) — since Slice S-10 this holds a **scrypt hash**, never
    the raw PIN. The comment block at `:21–26` documents the hashing rule.
  - `saw_username` (`:36`) — the employee's Secure Access Washington username,
    added by **migration `0126`** (Slice 6). Shown to managers so state-portal
    work (L&I, ESD) doesn't require asking the employee. The select list at
    `:48` includes it.
- `EmployeeBanking` (`:51`) is deliberately a **separate type with a separate
  read path**: `listEmployeeBanking` (`:149`) is the ONLY function that reads
  the `bank_*` columns, and it decrypts them with the `encv1` secret-wrapping
  helper (S-10). Regular roster reads (`listEmployees` `:87`, `getEmployee`
  `:99`) never touch banking columns — a wall, not a habit.
- `getEmployeeByPin` (`:117`) is how a PIN becomes a person. Because scrypt
  hashes are salted, there is no `.eq("clock_pin", pin)` shortcut (comment at
  `:112`): the function loads all active employees with PINs (`:124`) and
  verifies the guess against each hash until one matches. Two things to know:
  1. **Legacy upgrade:** if a stored value is still an old plaintext PIN and it
     matches, the row is transparently re-saved as a hash (`:127–139`). Old
     data heals itself on first use.
  2. **This is finding GW-004** (🟡 Low): each attempt costs ~25 ms of scrypt
     per candidate — fine at 10 employees, a scaling ceiling at 100+. Accepted
     as-is for current scale. See §9.
- PIN format is enforced by `isValidPin` (`src/lib/staffing/time.ts:41`):
  exactly 4–6 digits.

---

## 3. PIN guessing is throttled — durably

**Files:** `src/lib/security/pin-throttle-core.ts` (pure math),
`src/lib/security/pin-throttle-store.ts` (server wrapper), migration
`0123_pin_throttle.sql`.

- **Policy** (`pin-throttle-core.ts:20–31`): `THROTTLE_MAX_FAILURES = 5`
  failures inside `THROTTLE_WINDOW_MS = 60_000` (60 s) locks the scope for
  `THROTTLE_LOCK_MS = 60_000` (60 s). A success clears everything; failures
  age out of the window. Pure self-tests live in the same file.
- **Scopes** keep attackers from sharing one budget: the admin time clock uses
  `TIMECLOCK_THROTTLE_SCOPE = "timeclock"` (`pin-throttle-core.ts:101`), and
  each register iPad gets its own `pos-device:<id>` scope via
  `deviceThrottleScope` (re-exported at `pin-throttle-store.ts:35`).
- **Durability** (AN-8): the wrapper reads/writes a `pin_throttle` table
  (migration `0123`) so the count survives serverless restarts —
  `pinPadBlocked` `:53`, `notePinFailure` `:76`, `notePinSuccess` `:112`. If
  the table is missing (`relation does not exist` detection at `:39`) or a
  read/write fails, it falls back to the older in-memory S-10 window and logs
  an error (`:69`, `:105`). A success clears **both** the durable row and the
  in-memory fallback (`:113` comment) so a stale fallback lock can't linger.
- **This is finding GW-005** (🔵 Info): the fallback is per-lambda-instance on
  Vercel, so real protection assumes migration `0123` is applied. The owner
  applies migrations manually — `0123` belongs on the cutover checklist. See §9.
- One documented weakness in the durable path: the read-modify-write of the
  failure list is not atomic across concurrent lambdas (noted in the file
  header). Worst case a burst of simultaneous failures under-counts by a few —
  the lock still lands, just possibly one guess later.

---

## 4. Clocking in and out — the single-open-punch rule

**Files:** `src/lib/staffing/store.ts`, `src/lib/staffing/time.ts` (43 lines,
pure).

- `openWorkPunch` (`store.ts:179`) finds an employee's punch where
  `clock_out_at IS NULL`. The whole system's invariant: **at most one open
  punch per employee**, and every clock action is really a toggle against it.
- `toggleClock` (`:224`) is the one door for all clock actions. Signature takes
  a `source` of `"web" | "station" | "phone" | "manager_edit" | "register"`
  (`:226`) so payroll can always see WHERE a punch came from.
  - **Clock OUT** (`:236–247`): stamps `clock_out_at` and pre-computes
    `minutes` via `punchMinutes` (`time.ts:9` — whole minutes, rounded,
    clamped so it can never be negative).
  - **Clock IN** (`:249–299`): computes the Pacific business day via
    `businessDayFor` (`time.ts:17`, which is `pacificDayKey` — the same
    Pacific-day helper the sales side should be using per finding GW-009),
    finds that day's `scheduled`/`open` shift or creates one (`:251–285`),
    flips it to `open`, then inserts the punch with `punch_kind: "work"`
    (`:287–295`). `punch_kind` is `"work" | "break"`; only `"work"` counts
    toward hours (`totalWorkedMinutes`, `time.ts:32`).
  - Inactive employees are refused up front (`:231`).
- `punchesForDay` (`:302`) and `listPunchesForDayAll` (`:501`) both fetch a
  generous recent window and filter to the Pacific day **in the app** (comment
  at `:499`) — deliberate, because the day boundary is a wall-clock concept the
  database's UTC timestamps don't know about.

---

## 5. The four clock surfaces (who can punch, from where)

All roads lead to `toggleClock`; they differ only in WHO authenticates and HOW.

1. **Web (self-service, logged in):** `clockToggleAction`
   (`src/app/admin/staffing/actions.ts:37`) — requires the `timeclock.use`
   permission (`:38`), any active staff member; source `web`.
2. **Station (shared kiosk PIN pad):** `clockByPinAction` (`:55`) — the caller
   is a logged-in kiosk session, but the EMPLOYEE is identified by PIN. Checks
   `pinPadBlocked(TIMECLOCK_THROTTLE_SCOPE)` first (`:58`), records failure at
   `:64` and success at `:67`; source `station`.
3. **Phone:** `clockByPinPhoneAction` (`:87`) — same PIN + same throttle scope
   (`:92–100`); source `phone`.
4. **Register:** two distinct paths —
   - **Register unlock** (`src/app/api/pos/unlock/route.ts`, feature B5): the
     iPad authenticates as a device, the throttle scope is per-device
     (`deviceThrottleScope(auth.device.id)` at `:42`), the PIN resolves via
     `getEmployeeByPin` (`:56`), and the route opens a work punch + register
     session in parallel (`:64–65`), writes a `register.unlocked` audit event
     (`:71`), and returns `sawUsername` (`:85`) for the on-register display.
   - **Offline punch events**: a punch queued on the iPad while offline flows
     through the sync pipeline of Chapter 04 — `processPunch`
     (`src/lib/pos/sync-store.ts:885`) calls `resolvePunchIntent`
     (`src/lib/pos/sync-core.ts:69`), whose pure logic makes replays
     idempotent: "in" with an already-open punch is a **skip**, not a
     double-punch (self-tests at `sync-core.ts:361–363`).

---

## 6. Scheduling — pure math first, then the database

**Files:** `src/lib/staffing/schedule-core.ts` (pure, with self-tests at
`:167`), `src/lib/staffing/store.ts`.

- `parseHhmm` (`schedule-core.ts:13`) validates "HH:MM"; `mondayOf` (`:48`)
  anchors the week grid; `shiftDurationMinutes` (`:75`) handles
  past-midnight shifts; `parseShiftDraft` (`:104`) rejects shifts shorter than
  15 minutes (`:127`) or longer than 16 hours (`:130`); `weekCoverage`
  (`:149`) powers the coverage summary.
- `createScheduledShift` (`store.ts:355`) converts the Pacific wall time the
  manager typed into UTC via `pacificWallTimeToUtcISO`, including the
  `endsNextDay` wrap for overnight shifts.
- `updateScheduledShift` (`:394`) and `deleteScheduledShift` (`:423`) refuse to
  touch anything that isn't still `status = 'scheduled'` — once a shift has
  been worked, the schedule editor can't rewrite history.
- `copyWeekSchedule` (`:436`) duplicates a week forward — a convenience, still
  creating only `scheduled` rows.

---

## 7. Manager hour adjustments — every change carries a reason

**Files:** `src/lib/staffing/timeclock-core.ts` (pure, Slice 70 item 8),
`src/app/admin/staffing/actions.ts`, `src/lib/staffing/store.ts`.

- `parseWallTimeLocal` (`timeclock-core.ts:26`) strictly validates the
  datetime-local input (self-tests reject month 13 and hour 24, `:130–131`).
- `parsePunchEdit` (`:78`) is the gate: it requires a **reason of 3–500
  characters** and checks same-day ordering (out after in). No reason, no edit.
- `composeEditNote` (`:109`) writes the paper trail into the punch's note:
  every edit prepends a `[hours adjusted] <reason>` line (`:112`), newest on
  top, capped at 2,000 characters — the punch itself carries its own history.
- `editPunchAction` (`actions.ts:221`) and `createPunchAction` (`:268`) both
  require `staffing.manage` (`:227`, `:274`), run `parsePunchEdit`, convert
  wall time to UTC, and write `timepunch.edited` / `timepunch.created` audit
  events. The store side: `updatePunchTimes` (`store.ts:543`) re-checks
  out-after-in and stamps `source: "manager_edit"`; `createManualPunch`
  (`:575`) opens or reuses the day's shift, also `manager_edit`.
- Employee create/update: `createEmployeeAction` (`actions.ts:119`) requires
  `staffing.manage` (`:120`), checks PIN duplicates **by verification** (since
  hashes can't be compared for equality, `:126–130`), and stores `hashPin(pin)`.
  `updateEmployeeAction` (`:153`) treats the PIN as **write-only** (leave blank
  to keep; a `clear_pin` checkbox to remove) and accepts `saw_username`;
  `active` is driven by the lifecycle module, not this form.

---

## 8. The employment lifecycle — hiring and firing in the legal order

**Files:** `src/lib/staffing/employee-lifecycle-core.ts` (pure, Task S-b),
`src/lib/staffing/employee-lifecycle-store.ts`, migration
`0117_employee_command_center.sql`.

- **Statuses** (`employee-lifecycle-core.ts:22`): `candidate → onboarding →
  active → terminated`. `canTransition` defines the legal moves;
  `setEmploymentStatus` (`employee-lifecycle-store.ts:446`) enforces them
  (`:466`), and:
  - **→ active** is blocked until `activationBlockers` (`:477`) is empty — the
    critical onboarding tasks (I-9, LCB 21+ verification, etc.) must be done.
  - **→ terminated** requires a date + reason (kept 5 years per WAC retention)
    and, in the same update, sets `active = false` AND `clock_pin = null` —
    the code comment at `:497` says it plainly: "access ends immediately."
- **WA Fair Chance Act ordering** (RCW 49.94.010): `ONBOARDING_TASKS` (`:66`)
  hard-codes the order — assess fit FIRST (`:70`), conditional offer BEFORE any
  background check (`:76`) — and `taskOrderViolation` (`:396`) refuses
  out-of-order check-offs. `OFFBOARDING_TASKS` (`:189`) and
  `EMPLOYEE_DOCUMENTS` (`:247`) round out the checklist;
  `complianceDeadlines` (`:339`) computes hire-date-relative deadlines.
- **WA paid sick leave** (RCW 49.46.210): `sickLeaveAccruedMinutes` (`:368`)
  accrues a minimum of 1 minute per 40 worked minutes (floor), and the 40-hour
  carryover cap is `SICK_LEAVE_CARRYOVER_CAP_MINUTES` (`:383`).
- **Graceful pre-migration behavior:** the whole module sits on migration
  `0117`, applied manually by the owner. Reads use `select("*")` so missing
  columns simply come back absent (`employee-lifecycle-store.ts:112`), and
  every WRITE refuses with "Apply migration 0117 first (see the banner
  above)." (`:354`, `:375`, `:406`, `:433`, `:463`, `:514`). Nothing breaks
  before the migration; nothing silently pretends to save.

---

## 9. Findings that live in this chapter

| ID | Severity | One-liner | Anchor re-confirmed at `9a63c8b1` |
|---|---|---|---|
| GW-004 | 🟡 Low | PIN lookup scrypt-verifies against every active employee per attempt (~25 ms each) — fine at 10 staff, a ceiling at 100+. Accepted at current scale. | `src/lib/staffing/store.ts:117` (`getEmployeeByPin`) |
| GW-005 | 🔵 Info | Durable PIN throttle depends on migration `0123`; the in-memory fallback is per-lambda on Vercel and materially weaker. Put "confirm 0123 applied" on the cutover checklist. | `src/lib/security/pin-throttle-store.ts:39` (missing-table detection), `:69`/`:105` (fallback logging) |

Cross-references: GW-009 (UTC-vs-Pacific day, Chapter 03) is about the SALES
side — the staffing side already uses the Pacific helper correctly
(`businessDayFor` = `pacificDayKey`, `time.ts:17`). Offline register punches
are covered by Chapter 04's sync guarantees.

---

## 10. What SHOULD never happen (watchlist)

1. **A raw PIN in the database.** `clock_pin` must always be a scrypt hash;
   the only plaintext ever seen is a legacy value being upgraded on first
   match (`store.ts:127–139`).
2. **Banking data on a roster screen.** `listEmployeeBanking` (`store.ts:149`)
   is the ONLY read path for `bank_*` columns; if any other query selects
   them, the S-10 wall has been breached.
3. **Two open punches for one employee.** `openWorkPunch` + the toggle design
   make this impossible through the app; if it appears, someone wrote to
   `time_punches` directly.
4. **An unthrottled PIN pad.** Every PIN entry point (station, phone,
   register unlock) must call `pinPadBlocked` / `notePinFailure` /
   `notePinSuccess` with a proper scope. A new PIN surface without these
   three calls is a brute-force hole.
5. **An hour adjustment without a reason.** `parsePunchEdit` requires 3–500
   characters and the note carries `[hours adjusted]` history; a punch whose
   times changed but whose note has no such line was edited outside the app.
6. **A punch edit without an audit event.** `timepunch.edited` /
   `timepunch.created` must exist for every manager change.
7. **A terminated employee who can still clock in.** Termination sets
   `active = false` and `clock_pin = null` atomically
   (`employee-lifecycle-store.ts:497`); `toggleClock` refuses inactive
   employees (`store.ts:231`); `getEmployeeByPin` only scans active rows
   (`store.ts:124`). All three must hold.
8. **Activation with critical onboarding tasks unchecked.**
   `activationBlockers` must gate every `→ active` transition.
9. **A background check before the conditional offer.** `taskOrderViolation`
   enforces RCW 49.94.010 ordering — the UI must never bypass it.
10. **Hours computed anywhere but `punchMinutes` / `totalWorkedMinutes`.**
    One math, one place (`time.ts:9`, `:32`). A second implementation will
    eventually disagree with the first.
11. **A schedule editor touching worked shifts.** Updates/deletes must stay
    restricted to `status = 'scheduled'` (`store.ts:394`, `:423`).
12. **A business-day filter done in SQL against UTC timestamps.** Punch-day
    queries fetch a window and filter by Pacific day in app code
    (`store.ts:499` comment) — moving that filter into SQL naïvely would
    reintroduce the GW-009 class of bug on the staffing side.
13. **Lifecycle writes silently succeeding before migration 0117.** Every
    write path must keep its "Apply migration 0117 first" refusal until the
    owner applies the migration.

---

*Chapter status: DRAFTED at main `9a63c8b1`. Findings in this chapter:
GW-004 (pre-existing, re-confirmed), GW-005 (pre-existing, re-confirmed).
No new findings — the staffing module's invariants held up under trace.*
