# SOP Program — Findings Ledger (audit record)

**Rule of this file:** record, do not fix (owner: *"Don't fix them yet, just identify everything"*).
Each finding carries a stable ID, so the patch-strategy discussion at the end of the program can reference it.

## How to read an entry

| Field | Meaning |
|---|---|
| **ID** | `F-<sop#>-<n>`. Program-wide items use `F-00-<n>`. Never renumbered. |
| **Status** | `CONFIRMED` = I read the code and the evidence is quoted. `SUSPECTED` = the pattern was seen, but the full path has not been traced yet; it gets verified in the SOP slice that owns it. Nothing goes in as CONFIRMED without a file:line pin. |
| **Type** | `BUG` (wrong behavior) · `GAP` (owner-requested capability does not exist) · `HARDEN` (works, but is fragile, racy or bypassable) · `DOC` (help, concierge or SOP is wrong or stale) · `UX` (works, but invites error) |
| **Severity** | `S1` money, license or data-integrity risk · `S2` a control can be bypassed, or a wrong record can be saved · `S3` friction or confusion · `S4` cosmetic |
| **Pin** | The file:line at the commit audited. |

Audited at commit `54445a68` (main, 2026-10-27).

---

## SOP-00 recon findings (found while walking the tree for the roadmap)

### F-00-1 · CONFIRMED · DOC · S2 — The concierge tells staff the POS "is PLANNED, not built yet"
- **Pin:** `src/lib/admin/concierge-kb.ts` L494–507 (`id: "pos"`, `planned: true`), plus `src/lib/admin/concierge-assistant.ts` prompt line *"If it's about the POS, note it's planned-not-built first."*
- **Reality:** the register exists. `src/app/(site)/pos/RegisterShell.tsx` (5,949 lines), `SaleFlow.tsx` (6,198 lines), 23 `/api/pos/*` routes, and a Capacitor iOS build (`register-app/`, `ios/`).
- **Effect:** an employee who asks the concierge "how do I close my till?" is told the register does not exist. This is the single biggest knowledge gap in the concierge.

### F-00-2 · CONFIRMED · DOC · S3 — The concierge KB is small and does not read the help that already exists
- **Pin:** `concierge-kb.ts` has **33 topics**. `registers` has **2 facts**, `time-clock` has 2, `samples` has 2, `promotions` has 2. The grounding prompt (`concierge-assistant.ts` L66–74) includes **only** `setupGroundingBlock()` + `conciergeGroundingBlock()`.
- **Not fed to the concierge:** `help-content.ts` (34 sections, 1,098 lines), `page-helpers-core.ts` (19 helpers), `sop-core.ts` (10 SOP sheets), `handbook-content.ts`, and 104 page-level `<HelpPanel>`s.
- **Effect:** the help content already exists, but the global helper cannot see it. See `04-CONCIERGE-COVERAGE-LEDGER.md`.

### F-00-3 · CONFIRMED · BUG · S2 — Morning "Verify till" records no recount and no verifier identity
- **Pin:** `src/app/admin/registers/page.tsx` L286–298. The form posts only `session_id`, a free-text `verified_by` ("Manager name") and an `agrees` checkbox. It has **no denomination inputs.**
- `src/app/admin/registers/actions.ts` L279: `parseDenoms(...)` therefore reads all zeros, so `verifyTill()` (`src/lib/registers/store.ts` L417–418) stores `verified_count_minor = 0` and `variance_minor = 0 − closing_count`. The variance always equals the negative of the close, even when "Count agrees" is ticked.
- `verified_by` is `uuid references employees(id)` (`supabase/migrations/0038_registers_drawers.sql` L152), but it receives typed text such as "Mike". **Suspected** outcome: the insert fails (Postgres invalid-uuid error) and the action redirects with an error, so the morning verify may never succeed at all. Must be proven in SOP-01 against the live schema.
- **Owner requirement affected:** *"the morning employee recounts and verifies the amount."*

### F-00-4 · CONFIRMED · BUG · S2 — Same free-text-into-uuid pattern on Reconcile
- **Pin:** `src/app/admin/registers/page.tsx` L270–273 `name="reconciled_by" placeholder="Manager name"` → `store.ts` L285 `reconciled_by: opts.reconciledBy` → column `uuid references employees(id)` (`0038` L84).
- **Suspected** effect: reconcile fails whenever a name is typed, and "succeeds" only when the box is left blank, which records no reconciler. The safe count does this correctly with a `<Select>` of employees (`registers/safe/page.tsx` L176 before Phase 2.7a, which replaced it with the counter's PIN), which proves the right pattern already exists in the codebase.

### F-00-5 · CONFIRMED · GAP · S1 — No second-person sign-off on a till count
- **Owner requirement:** *"requires a second person to count the till and sign off on the accuracy of the count."*
- **Reality:** a second-PIN witness exists **only on mid-shift drops** (`src/lib/pos/till-core.ts` `TillDropRequest.witnessPin`, optional; `/api/pos/till/route.ts` L139–150). **Open** and **close** take one PIN only (`TillOpenRequest`, `TillCloseRequest`). The back-office verify (F-00-3) is not PIN-attested and is not enforced. Nothing stops a till from being closed and reconciled by one person.
- **Status: close part FIXED (Phase 2.2, G-01, #1545).** Owner D2 narrowed this to the close. Every close now needs a second employee's PIN and their own blind count, on the register (`/api/pos/till` close branch) and on the back-office close form (`closeDrawerAction`); the server refuses the closer's own PIN and a database check backs it up (migration 0314). **Still OPEN:** the back-office verify is still not PIN-attested (F-00-3).

### F-00-6 · CONFIRMED · GAP · S1 — No deposit-bag screen (seal, morning verify, into safe, to bank)
- **Owner requirement:** *"end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe."*
- **Reality:** the `deposit_bags` table (`supabase/migrations/0212_deposit_bags.sql`) and the pure builders (`src/lib/accounting/safe-bag-core.ts`) exist and are tested. The owner memo `MICHAEL-books-98-the-store-safe.md` states plainly: *"no screen calls them yet — you cannot seal a bag from the app today."* `grep deposit_bags src/app` returns 0 hits.
- `/admin/registers/eod` shows **Undeposited Funds by day** (`UndepositedFunds.tsx`), which says "each line should be one sealed deposit bag". That is a mirror of the books, not a bag workflow.
- **Status: FIXED (Phase 2.6a, G-04, #1549; owner message 4: *"deposit bag screen"*).** `/admin/registers/deposit-bags` (`src/app/admin/registers/deposit-bags/page.tsx`, `actions.ts`, `csv/route.ts`): night count by one person with the expected deposit worked out from the drawers and drops (D24); blind morning recount by a **different** employee (refused in the server, `deposit-bag-flow-core.ts` L226–245, and in the database, migration 0316); a reason over $5.00 only (D21); seal by anyone with a PIN (D25), which posts DR 10400 / CR 10100 on the bag's business day (`seal-bag-posting-service.ts`); the owner-only bank run (`requireBooksAccess`, D25); the bag log prints and exports CSV. Every step needs a PIN and writes an audit row. Register Activity has a **Deposit bags** button. Needs migration 0316. SOP-03 v1.6.

### F-00-7 · CONFIRMED · GAP · S2 — The master-till "little safe ↔ master" exchange is not modelled
- **Owner requirement:** *"balance the master till using small bills from the little safe in exchange for big bills from the master … count twice a day."*
- **Reality:** one safe is modelled: `safe-core.ts` "the $1,000 master change fund", `SAFE_TARGET_MINOR = 100_000`, windows `am | pm | other` (the twice-daily count **does** exist at `/admin/registers/safe`). Register↔safe **swaps** exist (`TillSwapRequest`, manager/lead approver PIN). No second store of value ("little safe") exists in schema or code. `grep -i "little safe\|small safe"` returns 0 hits.
- **Needs an owner decision:** is the "little safe" a physical box whose balance we track, or just a source of change with no tracked balance? (See Open Question Q3 in `02-SOP-CATALOG-AND-ROADMAP.md`.)
- **Status: FIXED (Fix Phase 2.7b, G-02, #1552; owner message 4: *"Master till items: denomination log, …"*; owner D3).** The owner answered Q3 (D3): no little-safe balance, only the exchanges. The Store safe page has a **Little safe exchange** box (`safe/page.tsx` L271–277; `LittleSafeExchangeForm.tsx`): **OUT of master till → little safe** and **IN from little safe → master till** by denomination, a live equal / not-equal line, **Done by: your PIN (required)** (any active employee, lockout scope `backoffice-little-safe`, `little-safe-core.ts` L37; `safe/actions.ts` L152–211), and **Record exchange** (disabled until both sides are equal). Equal sides are checked on screen, on the server (`validateExchange`, `little-safe-core.ts` L89) and in the database (`little_safe_exchanges_sides_equal`, migration `0317_little_safe_exchanges.sql`); the table is append-only (trigger). Managers see the **Little safe exchanges** log for the chosen days (`safe/page.tsx` L467–476), the printable sheet lists them (`safe/sheet/page.tsx` L326–332) and the CSV / Excel export has an **Exchanges** sheet (`exchangesSheet`, `master-till-core.ts` L363). There is still no little-safe balance, by design (D3). Needs migration 0317.

### F-00-8 · CONFIRMED · GAP · S2 — Safe-count (master till) sheet has no print or export; EOD and till summary print only, with no export
- **Pin:** `registers/safe/page.tsx`: no `PrintButton`, no CSV route. `registers/eod/page.tsx` L128 and `registers/history/[id]/page.tsx` L81 have `PrintButton` (window.print) but no CSV/XLSX route.
- **Owner requirement:** shift and day reports *"exported and printed"*. Master till *"exportable and printable"*.
- `exceljs` and `xlsx` are already dependencies. CSV-route precedents exist (`inventory/cycle-counts/[id]/export/route.ts`, `reports/compliance/export/route.ts`).
- **Status: EOD part FIXED (Phase 2.6b, G-15, #1550).** The End-of-day report now exports CSV and Excel: `src/app/admin/registers/eod/export/route.ts` (`requirePermission("inventory.manage")` L29; a bad day is refused L32–33; a day with a failed read is refused with HTTP 409 L35–37) builds `eodSheetWorkbook` (`src/lib/registers/eod-sheet-core.ts` L299: sheets Deposit, Cash check, Refunds, Bag, Sales, Signatures). The deposit bag log exports CSV since Phase 2.6a. **Still OPEN:** the master till (safe-count) sheet print/export and the till summary export → Phase 2.7 (G-09).
- **Status: safe part FIXED (Phase 2.7a, G-09, #1551).** The master till sheet prints and exports: `/admin/registers/safe/sheet?day=` (`src/app/admin/registers/safe/sheet/page.tsx`, `requirePermission("inventory.manage")` L73; `PrintButton` L136; signature lines L368–370; a failed read shows *"⚠ This sheet may be incomplete. Do not file it."* L172) and `/admin/registers/safe/export?from=&to=&format=csv|xlsx` (`safe/export/route.ts`, L36; a failed read is refused with 409, L54, never a partial file) building `safeSheetWorkbook` (`master-till-core.ts` L277: sheets Counts, with the D11 standard as row 1, Swaps, and from Phase 2.7b Exchanges). **Still OPEN:** the till summary export.

### F-00-9 · CONFIRMED · GAP · S3 — No cleaning schedule or daily-task checklist feature exists
- `grep -i "cleaning|dusting|sanitiz"` over `src` finds only unrelated text (data "cleaning", promotions). Checklists exist only for HR onboarding/offboarding (`employee-lifecycle-core.ts`) and payroll mentors.
- Cycle counts **do** exist as an owner-initiated queue (`/admin/inventory/cycle-counts`, books-23: owner creates the audit, staff do the blind count). A *daily task checklist* that surfaces them does not.
- The SOP can ship as paper first (a printable checklist). A digital sign-off checklist is a build decision.
- **Re-verified in SOP-06 (`main@c976c7e4`):** still no feature. Recorded as F-06-12; paper forms in SOP-06 §8.5–§8.7; gap **G-38**.

### F-00-10 · CONFIRMED · UX · S2 — Staff cannot open the SOP or Handbook pages they are meant to read
- `/admin/staffing/handbook` → `requirePermission("staffing.manage")` = owner/admin/manager only (`roles.ts`). A budtender (`staff`) cannot open the handbook page they must sign (the acknowledgment gate screen is a separate path, `HandbookGateScreen.tsx`).
- The nav "Employee" group: Employees, Schedule and Handbook are `staffing.manage`. Register Activity is `orders.manage`. A staff user sees only **Time Clock** and **Register Activity**.
- `/admin/sop` is `requireStaff()` (readable by all) but is **not in the nav at all**. It is reachable only from a dashboard button (`src/app/admin/page.tsx` L604) and the `SopSheetLink`s inside 9 HelpPanels.
- **Effect on this program:** the SOP library must be placed where `staff` can reach it. See the storage strategy, `01-PROGRAM-CHARTER-AND-STORAGE.md` §4.

### F-00-11 · CONFIRMED · DOC · S3 — `docs/POS_OPERATIONS_GUIDE.md` is stale and contradicts the register
- Last touched 2026-07-22. §2.6 "Closing" says *"Back office cash controls: drop … blind-close the drawer"*. The owner later moved count-in, drop and blind close to the iPad register (`oversight.ts` header; `till-core.ts` header). §2.6 also says "Clock out on the iPad" but never covers till close at the register.
- SOP-01 supersedes it. Mark it superseded (do not delete) when SOP-01 lands.

### F-00-12 · ~~SUSPECTED~~ CONFIRMED in SOP-01 (F-01-2) · HARDEN · S2 — Drawer state transitions are read-then-act (no compare-and-swap)
- **Pin:** `store.ts` `closeDrawerBlind` L212–227: reads the session, checks `status !== "open"`, then `.update(...).eq("id", …)` with **no** `.eq("status","open")` guard. The same shape appears in `reconcileDrawer` (L266–287) and `verifyTill` (L305–332).
- A double-tap or a retried request could close twice or verify twice (the second write overwrites `closing_count_minor`). AGENTS.md rule 12 explicitly calls read-then-act "NOT a lock".
- `closeDrawerBlind` L245 and `verifyTill` L324 insert into `drawer_counts` and **ignore the returned error**: the session can say "closed" while the denomination record is missing.
- To verify in SOP-01 (does the register UI debounce? does `/api/pos/till` carry an idempotency key?).

### F-00-13 · ~~SUSPECTED~~ CONFIRMED in SOP-01 (F-01-4, raised to S1) · HARDEN · S2 — Reconcile "cash sales" is a hand-typed number
- **Pin:** `registers/page.tsx` L261–268 has a manager-typed `cash_sales` input. `actions.ts` L26–30 has a local `dollarsToMinor` that strips everything except digits, "." and "-", returns **0** on bad input, and accepts negatives. The pure `till-core.ts dollarsToMinor` already returns `null` on invalid input.
- Expected-close and over/short therefore depend on a manager typing the right figure, even though the register records every sale (`pos_sale_events`, `day-report-core.ts`). A blank field = $0 cash sales = a large false "over".
- To verify in SOP-01: is there a reason the system figure is not prefilled (for example, sales across sessions on a shared register)?
- **Status: FIXED (Phase 2.1, G-05).** The `cash_sales` input is gone. The figure is built by the server from the drawer's own processed cash sales, the refunds tied to it and its drops (`drawer-figure-core.ts` `buildDrawerFigure` L129, loaded by `drawer-figure-store.ts` `loadDrawerFigure` L218) at the moment of the click (`registers/actions.ts` `reconcileDrawerAction` L169). Answer to the open question: sales across sessions on a shared register are split exactly by the `drawerSessionId` each sale payload carries. SOP-01 v1.5.

### F-00-14 · CONFIRMED · DOC · S3 — The SOP pack is product-intake only, and its master sheet text predates rule 11 wording
- `sop-core.ts` covers truck-day + 9 journey stages (discover → pay). It contains **no** register, cash, people, compliance-ops, marketing or hardware SOPs. It is the right *foundation* (pure, print-ready, shared with HelpPanels) and will be **extended, not replaced** (Standing Rule 4).
- Its content is re-audited against the live intake code in SOP-04.

### F-00-15 · CONFIRMED · DOC · S3 — Vendor-marketplace menu client is labelled "ONE-TIME IMPORT ONLY"
- **Pin:** `src/lib/purchasing/cultivera-client.ts` L6–20 has a rule-11 banner: *"ONE-TIME IMPORT ONLY — THIS IS NOT HOW PRODUCTS ENTER GREENWAY."* The same module powers **Purchasing → Vendor Menus** (`/admin/purchasing/menus`, endpoints `/cultivera/markets`, `/cultivera/menu`, `/cultivera/product`), which is ongoing wholesale **shopping** for POs, not product entry.
- The owner now asks for an ongoing SOP: *"how to fetch the menu from Cultivera marketplace and growflow marketplace."* Rule 11 is about how products **enter** inventory (receiving intake). Browsing a vendor's wholesale menu to build a PO does not conflict with it, but the banner reads as if the whole client expires.
- **Needs owner confirmation (Q4)** before SOP-09 tells staff to use it routinely. `growflow-client.ts` carries no such banner.
- **Owner answer (D4, 2026-10-27):** the crawler PO builder *"will continue to be allowed going forward and should have a proper sop explaining how to use it, and save the data we get from it."* The banner wording is therefore a DOC fix, to be scheduled in Phase C (not fixed here). Data-saving need tracked as G-07 in `05-GAP-REGISTER.md`.

---

## SOP-01 Register Operations findings (audited at `d03fe15b`, 2026-10-27)

Owner decisions referenced: D2 (second count at close), D3 (swap denominations), D7 ($5 over/short screen). See `00-OWNER-REQUEST-VERBATIM.md`.
Status updates to SOP-00 items: **F-00-12 → CONFIRMED** (see F-01-2). **F-00-13 → CONFIRMED** (see F-01-4). F-00-3/F-00-4: the code path is confirmed. The live-database failure is still to be proven against production (see F-01-5).

### F-01-1 · CONFIRMED · HARDEN · S2 — A register can end up with two open drawers
- **Pin:** `supabase/migrations/0038_registers_drawers.sql` L94–96 has the comment *"At most one OPEN session per register at a time (enforced in app; index helps)"*, but `drawer_sessions_open_idx` is a plain `create index`, **not unique**. `src/lib/registers/store.ts` `openDrawer` L135 reads `openSessionForRegister` and then inserts (L139–150). This is read-then-act (AGENTS rule 12).
- Two count-ins at the same moment (two iPads on one register, or a retried request) can both pass the check. `openSessionForRegister` then returns only the newest (`order opened_at desc limit 1`), so the other drawer is invisible to drops and close.
- No later migration adds a unique index (grep of `supabase/migrations`).

### F-01-2 · CONFIRMED · HARDEN · S2 — Close / reconcile / verify have no compare-and-swap; count rows can silently fail
- **Pin:** `store.ts` `closeDrawerBlind` L214 checks the status, then updates at L227 with only `.eq("id", …)`. The same shape is in `reconcileDrawer` (L268 → L287) and `verifyTill` (L307 → L332).
- `drawer_counts` inserts at L157 (open), L245 (close) and L324 (verify) **ignore the returned error**. A session can read "closed" with no denomination record.
- A reconcile run twice re-posts nothing new: `postDrawerCloseForSession` returns `duplicate` (`src/lib/registers/drawer-posting-service.ts` L117–118). But the second run **overwrites** `expected_close_minor` / `over_short_minor` with the second typed figure. **The books then keep the first figure while the drawer record shows the second**, a silent books ↔ register disagreement.
- The register UI blocks double taps (`busy` state in TillModal), and `/api/pos/till` carries **no idempotency key**. The back-office forms have no pending state.
- Confirms and supersedes F-00-12.
- **Status: PARTLY FIXED (Phase 2.1).** `reconcileDrawer` (`store.ts` L314) now updates only `.eq("status", "closed")` and reports *"This drawer was reconciled by someone else a moment ago. Nothing was changed. Reload the page."* when no row changed, so a second reconcile can no longer overwrite the first figure. ~~**Still OPEN:** close and verify have no compare-and-swap, and the `drawer_counts` insert errors are still ignored.~~ **Close part FIXED (Phase 2.2, #1545):** `closeDrawerBlind` updates only `.eq("status", "open")` and reports *"This drawer was closed by someone else a moment ago. Nothing was changed."* when no row changed; an error on the close / second `drawer_counts` rows is now returned and written to the audit row (`countRowWarnings`). **Still OPEN:** verify has no compare-and-swap, and the open and verify `drawer_counts` insert errors are still ignored.

### F-01-3 · CONFIRMED · BUG · S3 — Reconcile card shows "expected $0.00" before reconcile
- **Pin:** `src/app/admin/registers/page.tsx` L246–247 prints `formatCents(a.expectedCloseMinor)`. `expected_close_minor` is written **only** by `reconcileDrawer` (`store.ts` L282). `formatCents(null)` returns `$0.00` (`src/lib/registers/cash.ts` L91–92).
- **Effect:** every Reconcile card reads "counted $X vs expected $0.00". This is misleading, and it undercuts the blind-count design, because a manager may think the drawer is massively over.
- **Status: FIXED (Phase 2.1, G-05).** The card no longer prints `expected_close_minor` before reconcile. It shows the computed **= Expected in drawer** from the system figure (`registers/page.tsx` ReconcileCard L525, L580), shown only to `inventory.manage`. The blind count stays blind on the register.

### F-01-4 · CONFIRMED · HARDEN · S1 — Reconcile cash sales is hand-typed, with no per-drawer refunds and no per-drawer sales figure
- **Pin:** `registers/page.tsx` L261–268 (`cash_sales` input, `min="0"`), `actions.ts` L115 (local `dollarsToMinor`, blank → 0). The day report (`src/lib/pos/day-report-core.ts`; `/api/pos/day-report` filters `register_id`, L104/L119) is **per register per business day**, not per drawer session. Voids and returns carry no register attribution (*"Voids/returns are not tied to one register — count them against the drawer that paid."*).
- **Effect:** expected close and over/short depend entirely on a manager's arithmetic. A register with two drawers in one day has no system figure for either drawer. A blank field shows a large false "over". Over/short then posts to the books (`postDrawerCloseForSession`).
- **Interim:** SOP-01 §4.27 step 9 (X report at each mid-day close) and §4.30 (paper formula). Confirms and extends F-00-13.
- **Status: FIXED (Phase 2.1, G-05; owner message 4: *"per-drawer figure"*).** No typed cash sales. Per drawer: processed **cash** sales carrying the drawer's id, + rounding, employee tab and any other tender left out; minus refunds **tied to the drawer** (migration 0313 adds `customer_returns.refund_paid_from` / `refund_drawer_session_id`; a void's audit entry carries `drawerSessionId`, `void-store.ts`; the register ties voids and returns to its open drawer, `api/pos/void/route.ts` L101, `api/pos/returns/route.ts` L169; the Returns desk requires **Cash paid from**); minus drops. Anything unknown blocks reconcile: a pending sale, a refund of the day tied to nothing (a manager ties it with **Tie refund**, `assignRefundAction` L269, compare-and-set), an incomplete read, no opening count. Stored on the session (`cash_sales_minor`, `refunds_paid_minor`) and in the `drawer.reconciled` audit. SOP-01 v1.5 §4.27 step 9 and §4.30 paper formula retired.

### F-01-5 · CONFIRMED (code path) · BUG · S2 — Free-text names posted into uuid columns at reconcile and verify
- **Pin:** `registers/page.tsx` L272 `reconciled_by` / L260 `verified_by` (`placeholder="Manager name"`) → `actions.ts` L116 / L150 → `store.ts` L285 / L316 → columns `uuid references public.employees(id)` (`0038` L84, L152).
- Postgres rejects non-uuid text for a uuid column (`22P02 invalid input syntax for type uuid`). The SOP therefore instructs "leave blank, sign the paper slip". Proof against production is still owed (no live DB access in this slice). Also, `reconcileDrawerAction` audits `session.userId` (the back-office login), so identity is captured in the audit log even when the column is blank.
- Same root as F-00-3/F-00-4. Recorded here because SOP-01 now carries a workaround that depends on it.
- **Status: PARTLY FIXED (Phase 2.1).** Reconcile has no name box: `reconciled_by` is the signed-in manager's own `employees.id` (looked up by `staff_id`, `actions.ts` `employeeIdForStaff` L38; blank when no single linked employee). **Still OPEN:** `verified_by` is still free text (F-00-3 / F-00-4).

### F-01-6 · CONFIRMED · HARDEN · S2 — Done-screen "Print receipt" opens the drawer on every tap, with no audit
- **Pin:** `src/app/(site)/pos/SaleFlow.tsx` L1583 `{ html, openDrawer: true, jobKind: "sale" }`. The button stays live (*"Tap again to reprint"*, L1634). By contrast, MORE → Reprint last receipt and the history reprint never kick the drawer.
- **Effect:** after a sale, any number of extra drawer openings are possible without a No-sale record, a reason or a manager PIN. This bypasses the No-sale control (§4.21).

### F-01-7 · CONFIRMED · UX · S3 — The drawer opens only by printing a receipt
- **Pin:** same as F-01-6. There is no "open drawer without printing" path for a completed sale except No sale (manager PIN). A customer who declines a receipt still gets one printed. If the printer is down, the drawer cannot open (*"… The drawer did not open — use No Sale if you need it."*), and No sale also prints, so it fails too.
- Paper waste plus a printer-down dead end. The SOP covers it with "print anyway / drawer key".

### F-01-8 · CONFIRMED · GAP · S2 — Change swaps record value only, not denominations (owner D3)
- **Pin:** `src/lib/pos/till-core.ts` `TillSwapRequest` (L61–74) and its validator (L210–232) carry `amountMinor`, `approverPin` and `notes`. There are no denomination fields. The owner (D3): *"I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe."*
- **Interim:** SOP-01 form 8.3 plus Notes. Related to F-00-7 (the little safe is not modelled).
- **Status: FIXED (Fix Phase 2.7b, G-02, #1552; owner message 4: *"Master till items: denomination log, …"*; owner D3).** The register **Change swap** screen now takes the bills both ways: **Big bills to the safe (from this till)** and **Change back (from the master till)** (`RegisterShell.tsx` L5858–5859), with a live line *"Both sides $X — equal."* / *"Not equal yet: …"* (L5890–5896). The server checks that each side equals the swap amount (`checkSwapDenoms`, `little-safe-core.ts` L125; called from `till-core.ts` L256) and stores them in `safe_swaps.in_denoms` / `out_denoms` (migration 0317, DB check `safe_swaps_denoms_equal`; `recordSwap`, `safe-store.ts` L166). Recent change swaps, the sheet and the export show **Big bills in** / **Change out**. An iPad app built before Phase 2.7b still sends a value only; that swap is still accepted, shown as *"not recorded (value only)"* (`little-safe-core.ts` L195), and form 8.3 covers it. **Owner action:** rebuild and reinstall the iPad register app.

### F-01-9 · CONFIRMED · GAP · S1 · **FIXED (Phase 2.2)** — No second-person count at close (owner D2)
- **Pin:** `till-core.ts` `TillCloseRequest` has a single `pin` (L48–58). `RegisterShell.tsx` TillModal close has no second PIN field. Owner D2: second-person count **at close only**, by **any** second employee.
- **Interim:** SOP-01 close slip 8.2/8.4. Narrows F-00-5 to the close step per D2.
- **Status: FIXED (Phase 2.2, G-01, #1545).** `TillCloseRequest` now requires `secondPin` and `secondDenoms` (`till-core.ts`); the register close is two steps (closer count and PIN, then **Next: second count**, the second person's blind count and PIN); the back-office close needs **Counted by** plus a second count and PIN. The server refuses the same person (`second-count-core.ts` `checkSecondCounter`; DB check `drawer_sessions_second_not_closer`). Both counts are stored (`drawer_sessions.second_*`, `drawer_counts` rows `close` and `second`). A difference is a warning only and is shown on the register, the back-office banner, the Reconcile card and the till history. SOP-01 v1.6 §4.27.

### F-01-10 · CONFIRMED · GAP · S3 — No per-shift / per-cashier report
- **Pin:** `/api/pos/day-report` is scoped by `auth.device.register_id` and business day (L58, L104, L119). Cart adjustments are tracked per employee (`pos_cart_adjustments`), but there is no printable per-cashier shift summary of sales, voids, no-sales, discounts given or adjustments.
- Owner SOP-00 request: shift reports *"exported and printed"*. Ties to F-00-8.

### F-01-11 · CONFIRMED · GAP · S2 — No $5 over/short warning screen or required reason (owner D7) · **FIXED (Phase 2.3)**
- **Pin:** `reconcileDrawerAction` (`actions.ts` L109–141) redirects with an `overShortLabel` banner only. There is no threshold, no reason field and no admin list. `grep -ri "over_short_reason\|overShortReason" src supabase` → 0 hits.
- Owner D7: *"$5. It should be an admin only screen placed in the most logical place… Just warnings for now. Who, when, how much, their reason for why it's over/ under (should be required to be input for over/ under)."*
- **Interim:** SOP-01 form 8.5. Suggested home (for the build discussion, not decided): a **Register Activity → Over/short warnings** section, or a tab gated `settings.manage`/owner-admin.
- **Status: FIXED (Phase 2.3, G-03, #1546).** Threshold `OVER_SHORT_WARN_MINOR = 500` (`over-short-warning-core.ts` L23; more than $5.00 is a warning, `isOverShortWarning` L29). `reconcileDrawer` checks the reason against the server's own over/short (`store.ts` L360, `checkOverShortReason` core L54): blank over $5 → refused, nothing saved, audited `drawer.reconcile_refused` (`actions.ts` L206); $5.00 or less the reason is optional (D21). The reason is saved on `drawer_sessions.over_short_reason` (migration 0315), audited on `drawer.reconciled` and a separate `drawer.over_short_warning` (`actions.ts` L258), and shown on the till summary (`history/[id]/page.tsx` L146). New owner/admin screen **Over / short warnings** (`/admin/registers/over-short`, `requirePermission("registers.warnings")` L59; permission `registers.warnings` = owner, admin, `roles.ts` L287) lists who, when, how much and the reason for drawers and the master till. Linked from Register Activity and the menu (`admin-nav-data.ts` L114). Warnings never block. SOP-01 v1.7 §4.30 step 6.

### F-01-12 · CONFIRMED · HARDEN · S2 — Verify is allowed on a drawer that was never reconciled
- **Pin:** `store.ts` `verifyTill` L307 accepts `status === "closed"` **or** `"reconciled"`, then sets `status = "verified"` (L332). `reconcileDrawer` L268 requires `status === "closed"`. A drawer verified straight from "closed" can therefore never be reconciled. Its over/short is never computed, and `postDrawerCloseForSession` never runs for it.
- The UI shows Verify only for reconciled sessions (`oversight.ts` L345–362), so this is reachable only by a crafted form post or by a race with a stale page. It is still a missing state-machine guard.

### F-01-13 · CONFIRMED · GAP · S3 — No standard float target for register drawers
- **Pin:** `till-core.ts` L13: *"the total IS the float"*. `openDrawer` stores whatever was counted. There is no configured float amount, and nothing warns when a count-in differs from the standard (the safe has `SAFE_TARGET_MINOR`; registers have nothing similar).
- **Effect:** a short float at open is invisible until reconcile, and then it reads as a drawer shortage that belongs to the wrong person. SOP-01 §4.3 says "tell a manager before ringing".

### F-01-14 · CONFIRMED · BUG · S1 — Medical test mode can complete a real sale with tax removed and no exemption record
- **Status: FIXED (Phase 0.1, owner D76).** Device: `medicalTestModeSaleBlock` refuses payment when the simulated endorsement (`medical.simulated`) removed tax. Server: `sync-store.ts` refuses (exception) a medical sale with `medicalSavingsMinor > 0` when `getMedTaxSettings().medicallyEndorsed` is false. SOP-01 v1.3.
- **Pin:** `src/lib/pos/medical-testmode-core.ts` flips `bundle.medical.endorsed = true` on the device only. The register then prices medical lines tax-exempt. At sync, `src/lib/orders/completion-gate.ts` L235–251 builds the exemption plan with the **real** `medSettings.medicallyEndorsed`. With the store unendorsed, `claimedLineCount = 0`, so **no** WAC 314-55-090(2) exempt-sale rows are written (L214), and the gate does **not** refuse. `sync-store.ts` stores the device's `sale.taxMinor` (L866) and does not recompute tax.
- **Effect:** a carded sale rung with test mode left on completes with tax under-collected and no exemption ledger. This is a tax liability (WAC 314-55-090(3): unrecorded exemptions are presumed incorrect). The banner is the only guard.
- Upgraded from SUSPECTED during the slice after tracing the full path.

### F-01-15 · CONFIRMED · HARDEN · S3 — Cash drop witness is optional
- **Pin:** `till-core.ts` L226 (`witnessPin` optional), UI *"Witness PIN (optional, second person)"* (`RegisterShell.tsx` L5835). Drops are the highest-value cash movement during a shift. The SOP sets "always get a witness when someone else is on the floor" as store practice.

### F-01-16 · CONFIRMED · DOC · S2 — The concierge still says the POS is planned (re-confirmed)
- `src/lib/admin/concierge-kb.ts` L497 `planned: true` is unchanged at `d03fe15b`. SOP-01 content is now the source for fixing it (see `04-CONCIERGE-COVERAGE-LEDGER.md`). Same item as F-00-1. It is listed here only so the slice index counts it as re-verified. **Not a new defect.**

---

## SOP-02 Master Till / Store Safe findings (audited at `0055f06c`, 2026-10-27)

Owner decisions referenced: D3 (little safe), D7 ($5), D10 (three tills at $167.50), D11 (master till mix), D12 (page for the two daily counts), D13 (pin everything). See `00-OWNER-REQUEST-VERBATIM.md`.
**D12 verdict: MET.** The twice-daily count page exists at `/admin/registers/safe` (AM / PM / Extra). Documented in SOP-02 §4.3–4.7; not a gap.
Status updates: **F-00-7** re-confirmed (still no little-safe model; `grep -rni "little safe\|small safe" src supabase` → 0 hits). **F-00-8** re-confirmed for the safe page (no `PrintButton`, no export route under `src/app/admin/registers/safe/`).

### F-02-1 · CONFIRMED · BUG · S1 — Cash drops are never posted; 10110 Tills keeps every dropped dollar for good · **FIXED (Phase 2.4)**
- **Pin:** `register-cash-journal-core.ts` `buildTillCloseJournal` L235–345. With `floatStaysInDrawer: true` (passed by `drawer-posting-service.ts` L191–194), `removedMinor = counted − float` (L275–277). The till is relieved by `removedMinor − overShort` (L307–310). Drops are used only to work out *expected* (L270). They are never moved out of 10110 or into 10100.
- **No other poster:** `grep -rn drawer_drops src/lib/accounting` returns only `factory-reset-core.ts` L426. `recordDrop` (`src/lib/registers/store.ts` L189–208) inserts a row and posts nothing. `ledger-census-data.ts` has no drop event (`grep -i drop` → 0 hits).
- **Proof by running the real builder** (`sop02/drops.ts`, run with tsx at `0055f06c`): $167.50 float, $500.00 cash sales, a $200.00 drop, counted $467.50 → lines `10100 +30000 "Cash from Register 1 to safe"`, `10110 −30000`. Each sale debits 10110 (`sale-journal-core.ts` L106, L415–417), so 10110 got +$500.00 and lost $300.00. **$200.00 stays in 10110 with no entry**, and 10100 Vault is $200.00 low. The builder self-test (L860–872) checks only "not short" and "balances", not the 10110 net. The tests repeat the gap.
- **Effect:** 10110 "Cash on Hand — Tills" goes up by the day's total drops, every day, forever. That is the same shape as the D-39 "drawers hold more money every day" problem the close posting was built to fix. 10100 Vault and later 10400 Undeposited Funds (bag seal) come up short by the same amount. The bank match (D-77 notes) works from a pool that never had the drop cash in it.
- **SOP impact:** none for staff. Recorded in SOP-02 §4.12 for the owner and bookkeeper.
- **Status: FIXED (Phase 2.4, G-12, #1547).** Option 1b of G-12: the close entry books the drops. `buildTillCloseJournal` now debits 10100 with `toSafeMinor = removedMinor + dropsMinor` (`register-cash-journal-core.ts` L301, L314–321) and credits 10110 by `toSafeMinor − overShortMinor` (L329); the line text names the drops (L319). Same source ref `till-close:<sessionId>`, same poster (`drawer-posting-service.ts` L174–195), so no new poster and no census reachability change (census row `cash_and_banking.till_close_to_safe` evidence updated). The missing assertion is added: the builder self-test checks 10110 is relieved of exactly the cash sales for a dropped shift, right, short and all-dropped (L898–939), and `register-cash.test.ts` checks net 10110 = 0 and 50920 = −over/short across cases. Mutations 7b (drops stop reaching the safe) and 7c (drops booked twice) are caught; `mutate-slice-books-93.py` 45/45. Re-running the proof case: 10100 +$500.00, 10110 −$500.00. **Back data:** entries posted before the fix are not changed or re-posted (idempotent source ref); they still lack their drops.

### F-02-2 · WITHDRAWN (D19, slice SOP-03) · was BUG · S2 — Manager Till standard float is $300.00; the owner says $167.50
- **Withdrawn after the owner's correction (D19):** *"And I was wrong, it should be 300 in it."* The code's $300.00 Manager Till float matches the owner. The entry below is kept as history (IDs are never renumbered). The misleading code comment stays open under **F-02-9**. The EOD worked example that still uses 3 × $167.50 is a new finding in SOP-03 (**F-03-2**).
- **Owner (D10):** *"there are three tills, two sales and one manager register. They are the ones with 167.5 in them."*
- **Pin:** `0038_registers_drawers.sql` L177–184 seed `('Manager Till', 'manager_till', 30000, 30)`, with the comment *"Manager Till float $300 (30000)"*. `0077_drawer_counts_extra_denoms.sql` L40–46 updates `where kind = 'sales'` only: *"the shared Manager Till float is left as-is (owner has not specified a change)"*. No later migration touches `default_float_minor` (`grep -l default_float supabase/migrations` → 0038, 0077 only). No UI edits it (`grep -rn default_float_minor src` → read-only, `oversight.ts` L316, `store.ts` L18).
- **Effect:** back-office **Open drawer** for the Manager Till says *"Standard float for this register is $300.00"*, and the grid shows a correct $167.50 count as **Short by $132.50** (`RegisterControls.tsx` L63–75).
- **Comment also wrong:** `drawer-posting-service.ts` L191–192 says *"migration 0077 pins every register's default float at 16750"*. It pins only the two sales registers.
- **Not verified:** the live database value (no production access in this slice). The owner can run `select name, default_float_minor from registers;`.

### F-02-3 · CONFIRMED · GAP · S2 — No master till denomination standard; the mix is saved but never shown or checked
- **Owner (D11):** the master till is *"32 tens, 64 fives, 318 ones, 95 quarters, 120 dimes, 100 nickels, and 125 pennies"*.
- **Pin:** `validateSafeCount` (`safe-core.ts` L86–118) compares the **total** only, against `SAFE_TARGET_MINOR` (L26). The 13 denomination columns are stored (`0135` L37–50) but the **Recent counts** table shows only Total/Target/Variance (`safe/page.tsx` L203–244). The EOD reads only `count_window, total_minor, variance_minor` (`eod-store.ts` L170–174).
- The owner's mix **is** in the code, but only as a worked example: `SPECIMEN_MASTER_COUNTS` (`register-cash-specimen-core.ts` L43–46), which is shown in the EOD specimen panel and is not used by the safe page.
- **Effect:** 10 × $20 + 12 × $10 + the standard rest = $1,000.00 → **"Balanced"** (script-checked, `sop02/calc2.py`). The registers can run out of change while the page says all is well.
- The $1,000 target is a code constant, with no setting (minor; recorded here so nobody looks for a setting).
- **Interim:** SOP-02 form 8.1 mix columns. Gap **G-08**.
- **Status: FIXED (Phase 2.7a, G-08, #1551).** One standard: `MASTER_TILL_STANDARD` (`safe-core.ts` L42); the specimen now reads it (`SPECIMEN_MASTER_COUNTS = MASTER_TILL_STANDARD`). The grid shows **Standard N** and a live **Diff ±N** under every box and a separate **Mix vs standard (owner D11)** line, *"Mix on standard"* / *"Mix off: +10 × $20, −20 × $10"* (`CountGrid.tsx` L89, L99, L140–142). The banner adds *"Mix on standard."* / *"Mix off standard: …."* (`safe/actions.ts` L136, `mixSentence` `master-till-core.ts` L113); the `safe.counted` audit carries `mix` (L99). Count history has a **Mix** column whose details show Standard / Counted / Diff (`safe/page.tsx` L346, L382); the sheet and export show the mix; the EOD shows *"mix on standard: yes/no"* (`eod/page.tsx` L59–62, L445, L451; `eod-store.ts` L173, L186). The F-02-3 example (10 × $20, 12 × $10) is now **Balanced · mix off** (self-test `master-till-core.ts` L410–415). SOP-02 v1.6.

### F-02-4 · CONFIRMED · HARDEN · S2 — Who counted is optional and unverified; the audit row is not linked to the count
- **Pin:** **Counted by** defaults to **— none —** (`safe/page.tsx` L176–177 at audit time). The action sends `counted_by || null` (`safe/actions.ts` L43) and `recordSafeCount` inserts it as given (`safe-store.ts` L130). No PIN, no second counter. Any manager-level login can name any active employee. The audit `safe.counted` stores the login, window and variance, with `entityId: null` (`safe/actions.ts` L73–88 at audit time), so the audit row cannot be tied to the `safe_counts` row except by time.
- **Contrast:** a register swap checks a manager/lead PIN on the server (`till/route.ts` L194–219), and a drop can take a witness PIN. The master till, which the owner calls *"the one to watch"* (books-98 L64), has the weakest attribution of any cash movement.
- **Effect:** with an open count (by design, `safe-core.ts` L7–10), a named, verified counter is the main control. Today it is optional.
- **Interim:** SOP-02 §4.5 step 10. Always pick the counter; note who entered it.
- **Status: PARTLY FIXED (Phase 2.3, #1546).** **Counted by** is now required: the page has no "— none —" option (`safe/page.tsx` L186–198), the action refuses a blank or non-active employee (`safe/actions.ts` L51, L55) and `recordSafeCount` refuses a blank counter (`safe-store.ts` L120). The `safe.counted` audit now carries `entityId` = the `safe_counts` row id (`safe/actions.ts` L103) and the counter. **Still open:** no PIN check of the counter (a manager login can still name any active employee). SOP-02 v1.4.
- **Status: FIXED (Phase 2.7a, G-13, #1551).** The picker is replaced by **Counted by: your PIN (required)** (`safe/page.tsx` L250). `counterFromPin` (`safe/actions.ts` L52–66) refuses a blank PIN, a PIN that is not 4–6 digits, and a PIN with no active employee (*"No active employee has that PIN. Counted by must be an active employee. Nothing was saved."* L52), with the PIN lockout on its own scope `backoffice-safe-count` (L46–54). The saved counter is the PIN's employee; the `safe.counted` audit carries `counted_by_name` and `counter_verified: "pin"` (L97–98). SOP-02 v1.6.

### F-02-5 · CONFIRMED · HARDEN · S2 — Several AM/PM counts per day are allowed; the EOD shows only the newest; the window defaults to AM; no double-submit guard
- **Pin:** no unique `(business_day, count_window)`. Only plain indexes (`0135` L65–66). `safeStatus` uses `.some(...)` (`safe-store.ts` L414–415). `eod-core.ts` L192–193 takes `find(...)` on newest-first rows, so it shows the **latest** AM and PM. The select starts at `defaultValue="am"` (`safe/page.tsx` L180) at every time of day. The submit button has no pending/disabled state, and a server action re-post saves a second row.
- **Effect:** (a) a PM count saved by mistake as AM leaves today's PM **Not yet**, while the AM card already said Done; (b) a bad count can be pushed off the EOD report by saving another one; (c) a double tap saves two counts. All earlier counts stay in **Recent counts**, so nothing is lost, but the official daily record can be chosen after the fact.
- **Interim:** SOP-02 §4.6 (change the window), §4.17 (corrections as Extra, never overwrite).
- **Status: PARTLY FIXED (Phase 2.7a, #1551).** The window now starts on the next count due: AM until today's AM is done, then PM, then Extra (`defaultCountWindow`, `master-till-core.ts` L123; `safe/page.tsx` L127, L241). The submit is a `SaveButton` that disables itself while saving, so a double tap cannot post twice (`safe/page.tsx` L265). The printable sheet and Count history show every count of a day. **Still open:** several AM or PM counts per day are still allowed, and the EOD still shows the newest (no unique `(business_day, count_window)`).

### F-02-6 · CONFIRMED · GAP · S2 — No variance threshold, no reason, and no books posting for master till variances
- **Pin:** `safe-core.ts` has no threshold. Notes are optional (L79–82). `recordSafeCount` posts no journal (`safe-store.ts` L100–160). `grep -rn "safe_counts" src/lib/accounting` → only `factory-reset-core.ts`. Drawer over/short posts to 50920 at reconcile (`buildTillCloseJournal` L313–326); a master till short posts nothing, so 10100 Vault keeps the old figure.
- **Owner D7** set $5 + a required reason for drawer over/short. Whether it covers the master till is **Q-02-3**.
- **Update (D16, slice SOP-03):** the owner confirmed D7 **applies to the master till as well**. This finding is now a confirmed owner requirement (gap G-03).
- **Interim:** SOP-02 §4.8 (reason for any variance; form 8.5 over $5). Extends gap **G-03**.
- **Status: PARTLY FIXED (Phase 2.3, G-03, #1546).** Threshold and reason **FIXED**: a master till count more than $5.00 off the $1,000.00 target needs a reason (`safe-store.ts` L122, refused and audited `safe.count_refused`, `safe/actions.ts` L88); the reason is saved on `safe_counts.variance_reason` (migration 0315), audited `safe.over_short_warning` (L84) and listed on the Over / short warnings screen and in Recent counts. **Still open:** no books posting for a master till variance (10100 keeps the old figure); that is Phase 2.4/2.5 territory. SOP-02 v1.4 §4.8.

### F-02-7 · CONFIRMED · DOC/UX · S2 — One "safe" in code, three places in the store; the page's help says to count drops with the change fund
- **Owner:** *"three tills, one master till, and a store safe"* (quoted in `safe-bag-core.ts` L17), plus a **little safe** (original request; D3).
- **Code:** one "safe" = *"the $1,000 master change fund"* (`safe-core.ts` L1–5); `VAULT_ACCOUNT` 10100 = *"The safe / master till"* (`register-cash-journal-core.ts` L70); close takings also post *"to safe"* into the same 10100 (L302). The page is titled **Store safe** (`safe/page.tsx` L133).
- **Help and placeholder pin:** HelpPanel L97–100: *"Cash drops … appear on the drawer session, not here. If the safe drifts off target, drops waiting to be banked are the usual reason — note it and bank the overage."* Notes placeholder L177: *"e.g. two drops waiting to be banked"*. Both tell a counter to accept drop cash as master till "over", which is the opposite of the owner's three-place model.
- **Effect:** confused counts (false Over), and a books account (10100) that mixes the change fund and the takings, so the PM count can never be checked against 10100.
- **Interim:** SOP-02 §1 terms, §4.3 warning, §4.12.
- **Status: page wording FIXED (Phase 2.7a, #1551).** The HelpPanel now says *"Drops and close takings are **not** master till money. They go to the store safe…"* (`safe/page.tsx` L169) and the old *"drops waiting to be banked"* sentence is gone; the Notes placeholder is *"e.g. 3 × $20 from swaps, not yet to the little safe"* (L252); the subtitle names the master till (L129). **Still open:** the code and the books still model one "safe" (10100) for the change fund and the takings.

### F-02-8 · CONFIRMED · DOC · S3 — SOP-01 form 8.3 mixes up two different exchanges (self-finding)
- **Pin:** `docs/sop/SOP-01-register-operations.md` L1106–1112. Form 8.3 is titled *"Change-swap denomination log (D3: master till ↔ little safe)"*, but its columns are for **register** swaps (*"Register/till … Matches register 'Record swap'?"*). A register swap is till ↔ change fund; a D3 balance is master till ↔ little safe.
- **Fix in the SOP program:** SOP-02 splits them into form 8.2 (master till ↔ little safe) and form 8.3 (register ↔ master till). SOP-01 is to point to SOP-02 at its next revision. Not edited in this slice (one SOP per slice).
- **Status: FIXED (Fix Phase 2.7b, #1552).** SOP-01 v1.8 retitles its form 8.3 as the **register** change-swap log and points to SOP-02 form 8.2 for master till ↔ little safe exchanges; both are now paper backups only (the app records both, F-00-7 and F-01-8).

### F-02-9 · CONFIRMED · DOC · S3 — Stale code comments about posting and floats
- `register-cash-journal-core.ts` L50–52: *"nothing calls `submitJournal` with them yet: closing a shift still does not post. That is D-39"*. That is stale: `reconcileDrawerAction` → `postDrawerCloseForSession` → `submitJournal` (`src/app/admin/registers/actions.ts` L218; `drawer-posting-service.ts` L219; census `till_close_to_safe` reachable = PRESENT, `ledger-census-data.ts` L1473–1480). The same stale claim is in `docs/MICHAEL-books-93-register-cash.md` L58 (*"Nothing posts yet"*). That is a dated memo, so it stays as history.
- `drawer-posting-service.ts` L191–192 says the float is *"16750"* for every register (see F-02-2).
- `docs/MICHAEL-books-93` L26 says the close debits *10400*, which D-77 (books-98) changed to 10100. That is history; the code is right.

### F-02-10 · CONFIRMED · UX · S3 — The Safe button is shown to staff logins, who are then denied
- **Pin:** `registers/page.tsx` L135–137 renders **Safe** with no permission check. Register Activity needs `orders.manage`, which includes `staff` (`roles.ts` L91). The safe page needs `inventory.manage` (owner/admin/manager, L106), so staff are redirected to `/admin?denied=1` (`session.ts` L184). The same pattern applies to **End-of-day report** (L96–97; `eod/page.tsx` L80).

- **Update (D15, slice SOP-03):** the owner wants **any employee** to count *and record* the master count. So staff being refused the safe page is now against an owner decision, not just a UX issue. Gap **G-13**.
- **Status: FIXED for the safe page (Phase 2.7a, G-13, #1551).** The page and its action need `orders.manage` (owner/admin/manager/staff; `safe/page.tsx` L93, `safe/actions.ts` L71), so the **Safe** button works for staff logins. History, the sheet and the export stay manager-only (`safe/page.tsx` L94, L280; `safe/sheet/page.tsx` L73; `safe/export/route.ts` L36). **Still open:** the **End-of-day report** button is still shown to staff, who are refused (`eod/page.tsx` L68).

### F-02-11 · CONFIRMED · GAP · S3 — Supply runs from the master till cannot be recorded
- **Pin:** `buildSupplyAdvanceJournal` / `buildSupplySettleJournal` (`register-cash-journal-core.ts` L526–671) are built and tested; the census marks them *reachable: MISSING — "No screen records a supply run yet"* (`ledger-census-data.ts` L1684–1689).
- **Owner policy since books-99:** supplies go on the shop card, not master till cash (`card-payment-core.ts` L7–8). Severity S3 because the policy covers it. If a run ever happens, nothing in the app records it, and the next count is simply "short".
- **Interim:** SOP-02 §4.13, form 8.4. Gap **G-11**. **Update (D17, slice SOP-03):** the owner wants the screen built; G-11 is approved and queued for build.

### F-02-12 · CONFIRMED · DOC · S3 — The concierge and the help library know nothing about the master till
- **Pin:** `grep -n -i "safe\|master till" src/lib/admin/concierge-kb.ts` → only unrelated uses ("safely", "am I safe?", equipment "safes"). `help-content.ts` `registers` topic (L227–262) has no safe or master till item. The page HelpPanel (F-02-7) is the only in-app help, and it contradicts the owner's model.
- See `04-CONCIERGE-COVERAGE-LEDGER.md` SOP-02 slice log.

### F-02-13 · CONFIRMED · GAP · S3 — Count and swap history is capped at 30 with no date filter
- **Pin:** `listSafeCounts(30)` and `listSwaps(30)` (`safe/page.tsx` L64–65; `safe-store.ts` L289–313). There is no paging, date picker or per-day view. At two counts a day, the page shows about 15 days of counts. Older counts exist in the database but can be reached only through Supabase. Ties to G-09 (print/export).
- **Status: FIXED (Phase 2.7a, G-09, #1551).** **Count history** has **From** / **To** days (default the last 30, at most 366; `parseDayRange`, `master-till-core.ts` L153) and reads counts and swaps in pages with a unique order (`listSafeCountsRange` / `listSwapsRange`, `safe-store.ts` L319, L354), so nothing is cut off; a failed page shows *"This history may be incomplete."* and turns export off (`safe/page.tsx` L308–325). SOP-02 v1.6.

---

## SOP-03 End-of-Day Close & Deposit Bag findings (audited at `3385bfa9`, 2026-10-27)

Owner decisions referenced: D2 (second person at close), D7 ($5 / reason), D10, D14–D20. The owner's request quoted in SOP-03 §1: *"End of day spreadsheet that one person completes before close, and the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe for depositing to the bank."*
**Verdict: NOT MET in the app.** The End-of-day report (`/admin/registers/eod`) prints the day. But the deposit figure, the morning recount, the bag, the seal and the bank clearing do not exist or cannot be reached. SOP-03 is a paper procedure (night sheet, bag log, bank-run checklist).
Status updates: **F-00-6** re-confirmed (no deposit-bag screen; `grep -rn "deposit_bags" src/app` → 0 hits). **F-00-8** re-confirmed for the EOD page (prints via `PrintButton`; no export route under `src/app/admin/registers/eod/`). **F-00-3** still stands (manager-till verify records $0, SOP-02).

### F-03-1 · CONFIRMED · BUG · S1 — 10400 Undeposited Funds is never filled, so the books panel gives a false "all matched"
- **Pin:** since D-77 (`docs/DEFECTS.md` L4138), the drawer close debits **10100 Vault**, not 10400 (`register-cash-journal-core.ts` L306–323, self-test L832–838). The only builder that debits 10400 is `buildSealBagJournal` (L405–441). It has **no poster** (`ledger-census-data.ts` L1596 `poster: null`; reachable MISSING L1596–1600).
- **Effect:** 10400 stays at $0.00 (or at any pre-D-77 residue), so the Undeposited Funds panel shows its green *"Every dollar … matched"* message while bags sit in the safe. The panel text *"A drawer close moves cash into it"* (`UndepositedFunds.tsx` L82–84) is stale.
- **Also stale:** the header comments in `UndepositedFunds.tsx` L11–12, `deposit-clearing-service.ts` L12/L22–23, `deposit-clearing-core.ts` L9–12/L129 and `drawer-posting-service.ts` L27 all still describe the close as filling 10400.
- **SOP impact:** SOP-03 §4.15 tells staff and the owner not to use the panel and to use the bag log plus the safe instead. Ties to G-14.
- **Status: wording FIXED (Phase 2.5, G-14, #1548); the seal itself still OPEN → Phase 2.6.** The panel now says *"$X sealed into deposit bags and not yet confirmed at the bank"* and *"Every sealed deposit bag recorded in the books has been matched to a deposit that reached the bank. Cash in the safe that has not been sealed into a bag is not counted here."* (`UndepositedFunds.tsx` L74, L80–82), and *"Sealing a deposit bag moves cash into it from the safe"* (L87–88). The stale header comments in `UndepositedFunds.tsx`, `deposit-clearing-service.ts`, `deposit-clearing-core.ts` (incl. L129) and `drawer-posting-service.ts` now describe D-77. 10400 is still filled only by `buildSealBagJournal`, which gets its poster with the G-04 bag screen (Phase 2.6); the census row `seal_deposit_bag` stays MISSING until then (G-14 requirement 3). SOP-03 v1.5 §4.15.

### F-03-2 · CONFIRMED · DOC · S3 — EOD worked example still uses 3 × $167.50 = $1,502.50 floats
- **Pin:** `register-cash-specimen-core.ts` L51 `SPECIMEN_TILL_COUNT = 3`; its self-test asserts `150_250` (L136). `RegisterCashSpecimen.tsx` L128 *"Each drawer (x3)"*, L132–137. Census text `ledger-census-data.ts` L1449 and the owner-quote history in `safe-bag-core.ts` L18–20 also carry the three-till figure.
- **Owner (D19):** the Manager Till holds $300.00, so the floats total **$635.00** ($1,635.00 including the master till).
- **SOP impact:** SOP-03 §4.9 labels the panel a teaching example with an out-of-date float total.

### F-03-3 · CONFIRMED · GAP + DOC · S1 — Bank-deposit clearing has no caller; the census says it is reachable
- **Pin:** `clearDepositForBankRow` (`deposit-clearing-service.ts` L241+) is called only by `tests/compliance/deposit-clearing.test.ts`. `grep -rn clearDepositForBankRow src` → only its definition and the census strings. The bank page's `actions.ts` exports only `recordBankExpensesAction`.
- **Census:** `cash_deposit_to_bank` (`ledger-census-data.ts` L1524–1586) marks *exists* and *reachable* **PRESENT**. Its exists evidence (*"books-93 built the first leg - the drawer count into 10400"*) is stale after D-77.
- **Even if wired:** it would refuse every deposit with DEPOSIT_NOTHING_UNDEPOSITED (`deposit-clearing-core.ts` L397–403), because of F-03-1.
- **SOP impact:** SOP-03 §4.13 makes the bag log plus the bank receipts the till-to-bank trail. Ties to G-14.
- **Status: FIXED (Phase 2.5, G-14, #1548).** `clearDepositForBankRow` now has one caller: the owner-only **Clear against bags** button on `/admin/books/bank` (`ClearBankDepositsPanel.tsx` → `clearBankDepositAction` in `books/bank/actions.ts`, which calls `requireBooksAccess()` and audits `books.bank_deposit.cleared` → `clearBankDepositLine` in `bank-deposit-door-service.ts`). It lists money-in lines on the **Main operating** account for 60 days, refuses any other account role, refuses an unreadable line, and shows a failed read as a failure, not as "no deposits". The census `cash_deposit_to_bank` evidence is rewritten (no drawer-count-into-10400 claim; reachable names the real door), and `posting-services-are-reachable.test.ts` now holds the door. Until the seal is wired (Phase 2.6), every press is refused with DEPOSIT_NOTHING_UNDEPOSITED, whose text now reads *"…Either the deposit bags have not been sealed in the system yet, or this money came from somewhere other than the tills."* (`deposit-clearing-core.ts` L398–402). Mutations 25/25. SOP-03 v1.5 §4.13.

### F-03-4 · CONFIRMED · DOC · S3 — SOP-01 §4.29 says the float goes back to the master till / safe (self-finding)
- **Pin:** `docs/sop/SOP-01-register-operations.md` §4.29 (≈L749–757): *"the float for tomorrow goes back to the master till / safe"*. The code keeps the float in the drawer (`floatStaysInDrawer: true`, `drawer-posting-service.ts` L194; `register-cash-journal-core.ts` L281). SOP-03 §4.4 (the float stays in the till) follows the code and the owner.
- **Also stale:** the Registers page help (`src/app/admin/registers/page.tsx` L173–176) says sales shown are *"online pickup order sales … the only transaction records in this back office"*. That is out of date now that the register records in-store sales (`sale-event-core.ts` L15–33).
- **Fix later:** correct SOP-01 §4.29 at its next revision (docs only; recorded here first per the program rule).
- **Status (slice SOP-04):** the SOP-01 half is **FIXED IN DOCS** (SOP-01 v1.1 §4.29: the float stays in the drawer). It is a documentation correction of the program's own SOP, not a code change. The Registers page help text (`page.tsx` L117–120) is code and stays **OPEN**.

### F-03-5 · CONFIRMED · GAP · S2 — EOD print has one signature and no deposit figure, bag # or denominations
- **Pin:** `src/app/admin/registers/eod/page.tsx` L478–484. Only *"Prepared by (signature)"* and *"Date / time"*. The table shows Opening / Drops / Closed count, but not takings-to-bag. There is no morning-verify line, no bag number and no denomination grid.
- **Owner:** *"one person completes before close, and the morning employee recounts and verifies"*. Two people, two counts.
- **SOP impact:** night sheet form 8.1 parts A/B/C. Ties to G-15.
- **Status: FIXED (Phase 2.6b, G-15, #1550; owner request *"end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies"*).** `eod/page.tsx` now has **Deposit: what goes in the bag** (per till closing count − float = takings + drops = to the bag, and **Expected deposit**, L164–210, from the same `expectedDeposit` as the bag screen), the day's bag by denomination with night and morning columns (L256–302; the night figure reads *"hidden until the morning recount"* until the recount is saved, `eod-sheet-core.ts` L226–227), the bag number and stage, and two signature lines: **Night count, prepared by (signature)** and **Morning recount and verify, a different employee (signature)**, each with **Date / time** and the name from the app (L464–470). The pin above describes the page before Phase 2.6b. SOP-03 v1.7.

### F-03-6 · CONFIRMED · GAP · S2 — EOD report omits refunds; "Gross" is not cash
- **Pin:** `src/lib/registers/eod-store.ts` does not query voids or returns. The Z report does (`day-report-core.ts` L136–175, L265–280: *"REFUNDS — STORE-WIDE CASH OUT"*).
- **Effect:** a manager reading EOD "Gross" as the cash to expect will be over by the refunds paid out.
- **SOP impact:** SOP-03 §4.8 says to use the Z report for cash. Ties to G-15.
- **Status: FIXED (Phase 2.6b, G-15, #1550).** `eod-store.ts` now reads the day's refunds with `readDayRefunds` (the same source as the Z report and the drawer figure) and the page shows **Cash check (refunds taken off)**: cash sales with rounding (`summarizeCashSales`, `eod-sheet-core.ts` L73) minus voids and counter returns paid from drawers = **Net cash from sales** (L212), then **Expected deposit − net cash (should match the drawers' total over/short)**. Refunds paid from the safe are listed, not taken off. A refund tied to neither a drawer nor the safe blanks the net cash with a reason (L205–208) rather than guessing. Sales now reads **Gross sales (not the cash: see Cash check)**. SOP-03 v1.7.

### F-03-7 · CONFIRMED · HARDEN · S3 — EOD store ignores read errors
- **Pin:** `eod-store.ts`:
  - The register/session reads (L86–89), the drop read (L100–107) and the event read (L112–120) never check `error`. A failed read renders as *"No drawer sessions on this business day."* or as zeros.
  - The safe_counts/safe_swaps reads treat any error other than a missing table as "Not done" (L131–132, L144–145).
- **SOP impact:** SOP-03 §6 says: if you know drawers were used, reload, then tell the owner and use the close slips.
- **Status: FIXED (Phase 2.6b, G-15, #1550).** `eodData` (`eod-store.ts` L85) now collects every failed read into `readProblems`: registers (L120), drawer sessions (L121), drops (L137), sales (read in pages with `pagedAllChecked`, L149–160), safe counts (L175) and change swaps (L189) other than a missing table, refunds (L204), the deposit bag (L205) and employee names (L206). The page shows **⚠ This report may be incomplete. Do not file it.** with the list, turns export off, and the Tills block says the sessions *"could not be read"* instead of *"No drawer sessions"*; the export route refuses with HTTP 409. SOP-03 v1.7.

### F-03-8 · CONFIRMED · UX · S3 — No date picker; a malformed `?day=` silently shows today
- **Pin:** `src/app/admin/registers/eod/page.tsx` L15–19 `normalizeDay`: anything not `YYYY-MM-DD` falls back to `pacificToday()` with no message. There is no date control on the page, so a past day is reachable only by editing the address.
- **SOP impact:** SOP-03 §4.8 documents `?day=YYYY-MM-DD`. Ties to G-15.
- **Status: FIXED (Phase 2.6b, G-15, #1550).** `normalizeDay` was removed. The page uses `parseBusinessDay` (`deposit-bag-flow-core.ts` L60–75; `eod/page.tsx` L82): an empty day is today, a malformed or impossible day shows the error (for example *"… is not a real calendar day."*) and a date picker, never today. A **Business day** date picker with **Show day** is on the page (`DayPicker`, L21–33). SOP-03 v1.7.

### F-03-9 · CONFIRMED · HARDEN · S2 — deposit_bags lets any staff login rewrite any bag (for when it is built)
- **Pin:** `0212_deposit_bags.sql` L150–163. The `<t>_staff_write` policy is `for all using (is_staff()) with check (is_staff())` on `deposit_bags` and `deposit_bag_sessions`, so status and `amount_minor` can be changed directly via the API. There is no immutability trigger after `sealed`/`deposited`, and `updated_at` (L83) has no trigger. `pulled_by`/`counted_by` are deliberately not forced to differ (L68–73).
- **Not reachable today** (no screen, F-00-6). It is recorded so the G-04 build closes it: sealed bags should be append-only, and changes should go through a server action with an audit row.
- **Status: FIXED (Phase 2.6a, G-04, #1549).** Migration `0316_deposit_bag_custody.sql` drops the `<t>_staff_write` policy on both tables (staff keep read only), adds `deposit_bags_sealed_guard` (a sealed bag's counts, people and amount cannot change; `seal_journal_id`, `banked_on` and `deposit_confirmed_on` can be filled once; no bag can be deleted) and the matching guard on `deposit_bag_sessions`, and a check that the morning recounter differs from the night counter. Every write now goes through a server action (permission + PIN + rule) and is audited (`deposit-bags/actions.ts`). Verified in PGlite (21/21 cases).

### F-03-10 · CONFIRMED · GAP · S2 — Bag lifecycle, close-block and $10k shape check are built but never called
- **Pin:** `safe-bag-core.ts`: lifecycle transitions, `blockCloseForUndeclaredBags` (L212–226), `checkDepositShape` (L305–328) and `validateBagAmount` have no callers outside the file, its tests (`safe-bag.test` 18 cases) and `buildSealBagJournal` (itself unreachable). `grep -rn "checkDepositShape\|blockCloseForUndeclaredBags" src` → `safe-bag-core.ts` only.
- **Effect:** the cash-deposit policy's near-$10k / structuring warning (`bank-match-core.ts` L1587 CTR_THRESHOLD_CENTS, L1594 STRUCTURING_NEAR_MISS_CENTS; `CASH_DEPOSIT_POLICY_DECISION.md` L66–73) is never shown at bag time.
- **SOP impact:** SOP-03 §4.14, the $10k rule on paper and the bag log's **Note** column. Ties to G-04 / G-14.
- **Status: FIXED (Phase 2.6a, G-04/G-14, #1549).** `checkDepositShape` is shown at the seal and in the owner's bank run through `depositShapeNotice` (`deposit-bag-flow-core.ts` L393–395), never as a block. The lifecycle is driven by the bag screen (`applyBagAction` in `checkNightCount`, `statusAfterRecount`, `checkSeal`), and `validateBagAmount` checks every count. **`blockCloseForUndeclaredBags` was removed** and replaced by `undeclaredBagWarning` (`safe-bag-core.ts` L221–234), shown on Register Activity, because the owner chose *"warning only please"* (D27). The pin above describes the code before Phase 2.6.

### F-03-11 · CONFIRMED · DOC · S3 — Help and concierge have no end-of-day or deposit-bag content
- **Pin:** `grep -n -i "deposit\|end.of.day\|eod" src/lib/admin/help-content.ts src/lib/admin/concierge-kb.ts` → only payroll **direct deposit** (`help-content.ts` L725–742; `concierge-kb.ts` L265–283).
- **Effect:** an employee asking the concierge *"how do I do the deposit?"* gets payroll ACH content or nothing.
- **SOP impact:** recorded in `04-CONCIERGE-COVERAGE-LEDGER.md` (SOP-03 slice); grounding comes from SOP-03 §4, §8 and §9 in Phase D.

## SOP-04 Receiving Intake & Monthly CCRS Public Records Request findings (audited at `5299660b`, 2026-10-27)

Owner sources quoted in SOP-04 §1: `00-OWNER-REQUEST-VERBATIM.md` L7 (*"There should be a sop for the receiving intake pipeline."*); D28 (the PRR must be included); the rejection rulings in `docs/ccrs-rejection-and-returns.md` L15–21; the R31 one-button design (*"I don't want to have to push any buttons while I walk the page unless I have to."*, `ManifestLotDisposition.tsx` L135); and the transformer vision (`docs/ROADMAP_BACKOFFICE_FIXES.md` L276–289).
**Verdict: MET with gaps.** Truck day works end to end: email → staged draft → count → per-line or whole refusal → one-button Finalize → go-live gate → books → onboarding. The monthly zip transformer works and feeds all three surfaces. The gaps are below: partial quantities, invisible failed emails, an ungated lot-status box, no PRR reminder, and stale help.

### F-04-1 · CONFIRMED · GAP · S1 (was S2; owner re-rated, D29) — No partial-quantity receive ("18 of 20")
- **Pin:** lines are accept-whole or reject-whole (`intake-disposition-core.ts` L24–44; `ManifestLotDisposition.tsx` L59–151). `received_qty` comes from the manifest (`intake-parser.ts` L606). The InventoryTransfer quantity equals the received quantity (`ccrs-transfer-core.ts` L33–36). `grep` for a counted / actual quantity field → none.
- **Owner:** *"So we need the ability to tell the system that we are only accepting a part of the manifest and the rest was rejected. There are several instances where the vendor forgot to send an item…"* (`ccrs-rejection-and-returns.md` L15–21). Line-level partial acceptance is met; unit-level is not.
- **SOP impact:** SOP-04 §4.11 interim rule: refuse the whole short line. Never accept and adjust. Ties to G-16.
- **Owner decision (D29, slice SOP-05a):** *"we need a way to accept less than what came in, please add this to the list of serious issues to fix."* Re-rated **S1** (data integrity: the CCRS record and the shelf must agree); G-16 **APPROVED**.

### F-04-2 · CONFIRMED · HARDEN · S1 — Lot page "Lifecycle status" sets Active with no go-live check and no audit
- **Status: FIXED (Phase 1.1, G-19). `setLotStatusAction` (`inventory/actions.ts` L158) runs `evaluateLotLifecycleChange` (`lot-lifecycle-core.ts`), which runs `evaluateLotActivation` before Active; every change and refusal is audited; `check-activation-gate.ts` now also catches non-literal status writes and runs in `tests/compliance/fix-p1-1-gated-lot-lifecycle.test.ts`).**
- **Pin:** `src/app/admin/inventory/[id]/page.tsx` L130–136 (STATUSES include `active`), form L1497–1512 → `setLotStatusAction` (`src/app/admin/inventory/actions.ts` L142–155) → `updateLotStatus` (`src/lib/inventory/store.ts` L849–864). It writes any status. There is no `evaluateLotActivation` call and no `recordAudit`.
- **Guard miss:** `scripts/compliance/check-activation-gate.ts` L60–100 greps only for the literal `status: "active"`, so a status passed in a variable escapes it. The intake comment (`intake/actions.ts` L195–198) says Finalize is the only activation path.
- **Effect:** a manager can make a lot with no COA, or a FAILED result, sellable, and nothing records who did it. `issues-core.ts` L556 directs staff to this box for now-clear held lots.
- **SOP impact:** SOP-04 §4.19 control: manager only, only from a "now clear" Issues row, logged on form 8.1. Carried into SOP-05. Ties to G-19.

### F-04-3 · CONFIRMED · HARDEN (control note) · S3 — Undecided lines are accepted on Finalize
- **Pin:** `intake-store.ts` L1416, L1440, L1475 (`disposition !== "rejected_at_dock"` → accepted).
- **By design** (R31, owner quote above). Recorded because the count is then the only human control.
- **SOP impact:** "Count first, decide at the dock, then press Finalize once" (SOP-04 header, §4.9, §4.17; form 8.5).

### F-04-4 · CONFIRMED · GAP/UX · S2 — Emails that fail to stage (parse_failed / no_manifest) are invisible
- **Pin:** `inbound-store.ts` L862–884. `listInboundEmails` is documented as surfacing *"the parse_failed / no_manifest rows a human should chase down"*, but its only caller (`intake/page.tsx` L164, L213–220) builds download links only. The panel was removed in commit 7cb4702c (H16a #319). The webhook records the outcomes (`route.ts` L316–320).
- **Effect:** a vendor manifest the reader cannot parse leaves no row, so a truck can arrive with nothing staged.
- **SOP impact:** SOP-04 §4.3 step 4: a daily mailbox-vs-list comparison, logged on form 8.1. Ties to G-17.

### F-04-5 · CONFIRMED · DOC · S3 — In-app SOP sheets and the Receiving help panel describe the pre-R31 flow
- **Pin:** `src/lib/catalog/sop-core.ts`:
  - L79 / L158: *"…or enter it by hand"*. No hand-entry form exists.
  - L81: *"Move the record along the pipeline (in transit → received)…"*. The buttons were removed; Finalize does it (`intake/actions.ts` L949, L1075–1097).
  - L83 / L162: *"…reject it to discard"*. Rejection is refuse-at-dock; nothing is discarded (`intake-disposition-core.ts` L1–13).
  - L137: *"the PO moves to Partial then Received"*. A linked PO is auto-received at Finalize.
  - The Receiving HelpPanel `intake/page.tsx` L279–282 repeats the same three stale lines.
- **SOP impact:** SOP-04 §4.1 note tells staff to follow the SOP where they disagree. Concierge grounding must not use these sheets until fixed.

### F-04-6 · CONFIRMED · UX · S4 — No "Partially Accepted" status card on the Receiving list
- **Pin:** `intake/page.tsx` L304–322: Pending, In transit, Awaiting intake, Accepted, Rejected. Yet `partially_accepted` is a real stage (`manifest-pipeline-core.ts` L28–40, L58–97).
- **SOP impact:** SOP-04 §4.2 says partials appear in the table only.

### F-04-7 · CONFIRMED · UX · S3 — One generic error banner covers five different failures on the review screen
- **Pin:** `intake/[id]/page.tsx` L730–734: *"Something went wrong with that action."* for `error=reason`, reject, finalize, lifecycle and transport.
- **SOP impact:** SOP-04 §5.2 gives a checklist of likely causes; §6 says stop after two tries.

### F-04-8 · CONFIRMED · DOC · S4 — Naming drift: "Vendor intake" breadcrumb vs "Receiving"
- **Pin:** `intake/[id]/page.tsx` L444–452 breadcrumb **Vendor intake**. The list title is **Receiving** (`intake/page.tsx` L136, L264), and the nav label is Receiving. The in-app sheet says *"Inventory → Intake"* (`sop-core.ts` L79).
- **SOP impact:** SOP-04 §4.2 says they are the same screen.

### F-04-9 · CONFIRMED · DOC · S4 — `INTAKE_PIPELINE_BIBLE.md` is cited but not in the repo
- **Pin:** `docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md` L4 cites *"bible `INTAKE_PIPELINE_BIBLE.md` §18.5 / §18.6"*. `git ls-files | grep -i INTAKE_PIPELINE_BIBLE` → none.
- **Effect:** the owner decisions file points at a source nobody can open.

### F-04-10 · CONFIRMED · UX/GAP · S3 — "Fill in cost and COA" with no field; a vendor bill refusal says "finalize again" with no path
- **Pin:** the CSV/PDF banner `intake/[id]/page.tsx` L588–596 *"…Fill in cost and COA before accepting."* There is no cost or COA input on the review screen. The vendor bill refusal `vendor-bill-service.ts` L262–287 says *"Key the unit costs, then finalize again."*, but Finalize renders only while in progress (`[id]/page.tsx` L298), and there is no cost screen for a finalized cannabis lot.
- **Owner decision:** no cost screen, because *"CCRS and Cultivera always carry cost"*, and reopen if the refusal ever appears (`INTAKE_PIPELINE_ROADMAP_DECISIONS.md` L34–46).
- **SOP impact:** SOP-04 §4.5 and §4.20: prefer the JSON or link; report a refusal to the owner the same day.

### F-04-11 · CONFIRMED · HARDEN · S3 — A failed lot insert at staging is logged to the console only
- **Pin:** `intake-store.ts` L930–936 (`console.error("[intake-store] lot insert failed:" …)`). It is non-blocking, so the manifest stages with one line missing its lot and no on-screen warning.
- **SOP impact:** SOP-04 §4.6: the count of lines on screen goes on form 8.1 and is compared with the paper manifest.

### F-04-12 · CONFIRMED · DOC · S3 — Held-lot fix text says "the lot page cannot attach one yet"
- **Status: FIXED (Phase 1.1, G-19). The held-lot fix text now says "If the lab result is already imported, use Attach a lab result on the lot page." (`issues-core.ts` L580)).**
- **Pin:** `src/lib/admin/issues-core.ts` L573. The lot page has **Attach a lab result** (S37 LotCoaAttach; `inventory/[id]/page.tsx` L763; `inventory/actions.ts` L268–303, audit `inventory_lot.coa_linked`).
- **SOP impact:** SOP-04 §4.19 tells the manager to use the attach panel when the lab result is already imported.

### F-04-13 · CONFIRMED · DOC · S3 — Wrong WSLCB public records phone number on the CCRS page
- **Pin:** `discovery/ccrs/page.tsx` L265 *"Phone: (360) 664-1769"*. The WSLCB public records page (2026) lists **(360) 664-1753**. The fax, email and mailing address match.
- **SOP impact:** SOP-04 §4.27, §4.28, form 8.4 and the quick card use 664-1753.

### F-04-14 · CONFIRMED · DOC · S3 — CCRS page Step 1 item 5 and the help panel describe the old per-file CSV path
- **Pin:** `ccrs/page.tsx` L250–256 *"…unzip them and upload them in Step 2 below. File names usually look like Sale_*.csv…"*. HelpPanel *"How CCRS benchmarking works"* L147–163 (upload files → Compute benchmarks). The real delivery is one zip of nested `<Table>_<n>.zip` (`ccrs-extract/zip.ts` L1–20), and Step 2 says *not* to unzip (L289). The legacy flash *"…Now click Compute benchmarks"* (L170–175) belongs to the Advanced path only.
- **SOP impact:** SOP-04 §4.29 says do not unzip; §4.34 explains the Advanced path.

### F-04-15 · CONFIRMED · BUG/UX · S3 — "Generate vendor leads" and "Enrich KB" are enabled on monthly-zip datasets but do nothing
- **Pin:**
  - Buttons enabled on `sales_rows` / `product_rows` > 0 (`ccrs/page.tsx` L404–421). Monthly datasets set both (`market-rollups.ts` L864–906).
  - `generateVendorLeadsFromCcrs` → `listTopLicensees` reads `discovery_ccrs_licensees` (`benchmarks.ts` L365–432).
  - Enrich reads `discovery_ccrs_products` (`ingest.ts` L251).
  - The monthly transformer writes neither table.
  - Contrast: `computeBenchmarksAction` refuses monthly datasets explicitly (`discovery/actions.ts` L598–609).
- **SOP impact:** SOP-04 §4.33: do not press them; use **Draft vendor leads from these suppliers**.
- **Owner decision (D34):** the owner delegated the call to the professional solution, so show only the actions that work for the dataset kind. Hide Compute / Generate vendor leads / Enrich KB on monthly cards (G-20, **APPROVED**).

### F-04-16 · CONFIRMED · UX · S2 — Benchmark dataset "Delete" has no confirmation
- **Pin:** `ccrs/page.tsx` L422–425 (a plain submit) → `deleteCcrsDatasetAction` (`discovery/actions.ts` L770–788, cascade, audit `discovery.ccrs.delete`). It is undoable only by re-dropping the original zip, which the app does not keep.
- **SOP impact:** SOP-04 §4.34: owner approval plus a read-aloud check; §4.29 keeps the original for 18 months.
- **Owner decision (D33/D34):** *"delete should as \"are you sure\""*; 18-month retention. Typed confirmation, admin-tier delete and an automatic purge with notice, hold and audit (G-20, **APPROVED**).

### F-04-17 · CONFIRMED · DOC · S3 — Uploader says "a few minutes"; the program measured ~1.5 h
- **Pin:** `CcrsZipUploader.tsx` L214 *"Takes a few minutes for a full month."* vs `ROADMAP_BACKOFFICE_FIXES.md` L558 *"~1.5h browser crunch"* (measured before the S14 Web Worker, L627). It has not been re-measured since.
- **SOP impact:** SOP-04 §4.31: plan for up to 1.5 h, keep the tab open and stop sleep; form 8.4 records the real time.

### F-04-18 · CONFIRMED · DOC · S4 (was S3; narrowed by D32) — The PRR wording template does not ask for the tables the transformer needs
- **Pin:** `REQUEST_WORDING` (`ccrs/page.tsx` L32–36) asks for *"Sales, Products, Inventory, Lab Results, and Strain"* only, and for a free date range. The transformer reads Licensee, Strains, ManifestHeader, TransportedItems, Product, Inventory, LabResult, SaleHeader and SalesDetail (`ccrs-extract/run.ts` L68–80). It refuses a zip with no SaleHeader / SalesDetail (`discovery/actions.ts` L831–836) or no table zips (`run.ts` L113–116).
- **SOP impact:** SOP-04 §4.27: reuse the proven April/May 2026 wording; one calendar month; Q-04-4. The SOP does not invent request language.
- **Owner decision (D32, slice SOP-05a):** *"I use the built in text provided in the ccrs benchmark page."* The built-in text **is** the proven wording; the owner's deliveries with it were the full extract. The finding is **narrowed** to a residual S4 risk (the text names five extracts, not the nine tables the transformer reads). It stays recorded; SOP-04 v1.1 §4.27 says what to do if a delivery arrives without sales tables. The month drop-down (G-18) is approved.

### F-04-19 · CONFIRMED · GAP · S3 — No monthly PRR task, reminder or tracking-number field
- **Pin:** `compliance-calendar-core.ts` L86–136 tasks: liq1295, ccrs_weekly, cctv_retention, scale_calibration, badge_visitor_log, dor_excise. There is no PRR. The monthly dataset's source note is auto-set to *"Monthly zip: <file>"* (`discovery/actions.ts` L857–862), so there is nowhere to record the tracking number.
- **SOP impact:** form 8.4 (SOP-04 §4.26–§4.28). Ties to G-18.
- **Owner decision (D32):** admin files on the 10th; a standing monthly request is wanted. WAC 44-14-04004(4) means the agency need not supply future records, so a recurring task, pre-filled text and a log are needed either way (G-18, **APPROVED** in part).

### F-04-20 · CONFIRMED · GAP/UX · S3 — The Discovery kill-switch has no "off" control on any screen
- **Pin:** `setDiscoveryEnabledAction` (`discovery/actions.ts` L99–112) accepts `enabled`. Every form that calls it sends the hidden `enabled=1` (**Turn Discovery on**: `discovery/page.tsx` L85–87; `ccrs/page.tsx` L91–93; `discovery/import/page.tsx` L59–61). `grep` for an off form → none. The legal note promises *"This feature is fully removable."* (`ccrs/page.tsx` L280).
- **SOP impact:** SOP-04 §4.34: turning it off needs a developer today.

### F-04-C · CONFIRMED · DOC · S3 — Concierge has no receiving procedure and no PRR / benchmark-intake content
- **Pin:** `concierge-kb.ts` `product-intake` (L132–148) is journey-level only: one Receiving fact (transport details). `ccrs` (L349–360) covers the weekly upload and the LIQ-1295 only. There is nothing on dock refusal, Finalize, held lots, the monthly records request or the zip drop. `help-content.ts` L1009–1011 points to the benchmarks pages only.
- **SOP impact:** recorded in `04-CONCIERGE-COVERAGE-LEDGER.md` (SOP-04 slice); grounding comes from SOP-04 §4, §8 and §9 in Phase D. It must not be grounded on the stale `sop-core.ts` sheets (F-04-5).

---

## SOP-05a Inventory Core findings (audited at `main@ac251766`, 2026-10-27; code unchanged since `5299660b`)

Owner sources quoted in SOP-05a §1: `00-OWNER-REQUEST-VERBATIM.md` L7 (*"Sop for inventory management."*) and D35 (the two-slice split, L98, L114).
**Verdict: MET with serious gaps.** The everyday tools work: the Issues tab, the lot page, expiration rules (save → preview → fingerprinted apply, audited), tags, testing labs and bulk fill. The register's recall hold is a real hard stop, with no override and fail-closed at completion. The gaps sit around the two raw write boxes on the lot page (Lifecycle status and Adjust quantity), the recall process outside the register, and expired stock.

### F-05a-1 · CONFIRMED · BUG/HARDEN · S1 — "Destroyed" set by hand leaves units on file and drops the lot from the CCRS Inventory file
- **Status: FIXED (Phase 1.1, G-22). Destroyed is not in `MANUAL_LOT_STATUSES`; the core and `updateLotStatus` refuse it; the guard fails the build if `destroyed` is written outside `disposition.ts` completeDestruction).**
- **Pin:** Lifecycle status → `setLotStatusAction` (`src/app/admin/inventory/actions.ts` L142–155) → `updateLotStatus` (`src/lib/inventory/store.ts` L849–864) writes the status only: no quantity change, no adjustment row, no audit. The weekly CCRS Inventory file reads lots `.neq("status","destroyed")` (`src/lib/compliance/ccrs-batch.ts` L1196–1207) and re-reads destroyed lots only when an event row in the same batch names them (`readDestroyedLots`, L380–411). The proper path sets Destroyed only when the destruction empties the lot (`src/lib/inventory/disposition.ts` L1163–1170).
- **Effect:** a lot destroyed by hand silently leaves Greenway's state filing while CCRS still holds its last quantity. No Destruction adjustment is filed and no waste record exists.
- **SOP impact:** SOP-05a §4.9 ("Never Destroyed by hand"), header box, §9 card. Ties to **G-22**.

### F-05a-2 · CONFIRMED · HARDEN · S1 — A recall hold (status Recalled) is placed and released with no audit row, no reason and no role limit
- **Status: FIXED (Phase 1.1, G-22). A reason is required on every change; Recalled → other needs `inventory.recall.release` (owner, admin; D37) and a clearance reference; audit rows `inventory_lot.status_changed` / `inventory_lot.status_change_refused`; Status history on the lot page).**
- **Pin:** **Recalled** is set only through the same blind Lifecycle status write (`actions.ts` L142–155 → `store.ts` L849–864). The register hold keys on it (`src/lib/pos/recall-hold-core.ts` L44, L53–63). Any `inventory.manage` login (owner, admin, manager; `roles.ts` L107) can set or clear it.
- **Effect:** a statutory sale stop (WAC 314-55-225) can be lifted by any manager with no record of who, when or why. Rated S1 with F-04-2 because it is a control over a regulated sale stop (license integrity).
- **SOP impact:** §4.8, §4.10: form 8.1 for every change; only the owner releases, on written clearance. Ties to **G-22** (extends G-19).

### F-05a-3 · CONFIRMED · HARDEN · S2 — Manual adjustment is read-then-write, has no zero floor, never sets Sold out and writes no audit row
- **Status: FIXED (Phase 1.2, G-23). `createAdjustment` (`store.ts` L618) uses the strict `applyLotDelta` (no floor breach; adjustment row deleted on refusal), asks for the Sold out flip when removing from an Active lot, and writes `inventory_lot.adjusted`).**
- **Pin:** `createAdjustment` (`store.ts` L591–629) reads `on_hand_qty` (L600–604) and writes current + delta (L616–621). It does not use the atomic `applyLotDelta` (`atomic-quantity.ts`, GW-012) that sales, voids, counts and disposition use, and has no `next < 0` check and no `sold_out` flip (the atomic path does that, L44). The action has no `recordAudit` (`actions.ts` L111–140). The adjustment row itself carries `actor_id` (L607–613).
- **Effect:** a sale at the same moment can be lost; on-hand can go negative; a lot at zero stays Active.
- **SOP impact:** §4.6 (count twice, quiet times, check On hand after, form 8.2). Ties to **G-23**.

### F-05a-4 · CONFIRMED · BUG/UX · S2 — "Other" and "Employee sample" adjustments with no note are withheld by CCRS (E13), and the form does not warn
- **Status: FIXED (Phase 1.2, G-23). `evaluateManualAdjustment` refuses an Other / Employee sample / Theft adjustment with no note (via `adjustmentDetailRequired`) and warns on every other empty note).**
- **Pin:** both map to CCRS **Other** (`ccrs-inventory-adjustment-core.ts` L62–93), which requires a detail (`ccrs-preflight-core.ts` L271; withheld at build L201–212). The lot page note is labelled *"Optional detail for the audit trail…"* (`[id]/page.tsx` L1489).
- **SOP impact:** §4.6 step 3, §4.7: always a note; required for these two. Ties to **G-23**.

### F-05a-5 · CONFIRMED · HARDEN · S2 — "Destruction" and "Recall removal" are offered as manual adjustment reasons
- **Status: FIXED (Phase 1.2, G-23). Destruction and Recall removal removed from the list and refused in the core and the store; a Schedule destruction link opens Returns & Destruction with the lot chosen).**
- **Pin:** lot page REASONS L118–128; both export as CCRS Destruction (`ccrs-inventory-adjustment-core.ts` L66–67, L80–81). They bypass the SOP-15 disposition flow, including its recall block (`disposition-core.ts` L226–243: no destruction until LCB coordination is confirmed and the officer named). The Issues tab's expired-lot fix text points to it (*"…or record the destruction under Adjust quantity"*, `issues-core.ts` L463).
- **SOP impact:** §4.7 "Never"; §4.16 "do not use the row's suggestion". Ties to **G-23**; owner question **Q-05a-4**.

### F-05a-6 · CONFIRMED · GAP · S3 — No Theft or Seizure adjustment reason
- **Status: FIXED (Phase 1.2, G-23). Theft and Seizure on the list, mapped to CCRS Theft / Seizure, with a required incident reference).**
- **Pin:** CCRS supports Theft and Seizure (`ccrs-inventory-adjustment-core.ts` L91–94); the form's list (lot page L118–128; `VALID_REASONS`, `actions.ts` L89–101) has neither.
- **SOP impact:** §4.7: theft or seizure goes to the owner (SOP-20); interim **Other** with "THEFT:" / "SEIZURE:" note. Ties to **G-23**.

### F-05a-7 · CONFIRMED · HARDEN · S2 — "Receive (add)" adds units that CCRS never hears about
- **Status: FIXED (Phase 1.2, G-23). Receive (add) removed and refused).**
- **Pin:** `isReportableAdjustment` skips it (`ccrs-inventory-adjustment-core.ts` L101–105). Stock should enter only through Receiving (SOP-04; Rule 11).
- **Effect:** units appear on Greenway's books with no CCRS adjustment and no manifest. (S2: a control bypass of the one-way-in rule; S3 if the owner treats it as a rare correction.)
- **SOP impact:** §4.7 "Never". Ties to **G-23**; **Q-05a-4**.

### F-05a-8 · CONFIRMED · GAP · S2 — Expired lots are not blocked or warned at the register; sales draw FIFO, not FEFO; the Issues text states a rule the code says WA lacks
- **Pin:** no expiry read in `completion-gate.ts`, `api/pos/menu/route.ts` or the sale decrement (grep). Sale lot order is oldest created first (`sale-lot-read.ts` L45–53). FEFO exists only as advice (`inventory-intel-core.ts` L13, L124, L532). Issues says *"Expired product may not be sold."* (`issues-core.ts` L388, L462) while `expiry-rules-core.ts` L32–34 says WA does not require a date (WAC 314-55-105(8) "best by" optional).
- **SOP impact:** §4.16: daily pull and quarantine until **Q-05a-1** is answered. Ties to **G-24**.
- **Status: FIXED (Phase 1.6b, G-24; owner D36, D44).** The completion gate reads expiry dates fail-closed and refuses an expired Solid Edible, Liquid Edible, Tincture, Capsule or RSO with no override; every other expired lot needs **I told the customer** (back office) or is noted on the order (register sync) (`completion-gate.ts` L151–188, L301–313). The register menu leaves out hard-blocked products (`api/pos/menu/route.ts` L329). The sale draws FEFO (`sale-lot-read.ts` L65). A nightly job quarantines expired hard-block lots, compare-and-set on Active (`api/cron/expired-quarantine/route.ts`, `vercel.json` `20 11 * * *` UTC). The Issues text states the owner's rule (`issues-core.ts` L390–391, L465–467). Guard step 9 in `check-activation-gate.ts`; test `tests/compliance/fix-p1-6b-expired-stock.test.ts`. SOP-05a v1.8.

### F-05a-9 · CONFIRMED · UX/HARDEN · S3 — The register "86" does not stick while the books show stock
- **Pin:** `/api/pos/stock-flag` sets the card unavailable and audits `pos.stock_flag` (`route.ts` L28–102). On every menu download `reconcileRegisterAvailability` restores any unavailable card with Active units (`register-availability-core.ts` L318–421, message L389; called `api/pos/menu/route.ts` L249). The register prompt says *"a manager brings it back through the back office when stock returns"* (`SaleFlow.tsx` L4282–4283). The name on the audit row is client-supplied (`route.ts` L48–52).
- **SOP impact:** §4.12: the manager investigates every 86 the same shift. Ties to **G-26**; **Q-05a-5**.

### F-05a-10 · CONFIRMED · UX · S3 — The lot label is linked only from the manifest page, and its fallback barcode does not scan
- **Pin:** the only link is on `intake/[id]/page.tsx` L1072–1078; the lot page has none (grep `/label` in `[id]/page.tsx`). The barcode is `lot_code || pos_product_key || id` (`lots/[id]/label/page.tsx` L38–40); the register indexes only lot code and CCRS id (`scan-to-cart-core.ts` L55–70).
- **SOP impact:** §4.19: reach it through the Manifest link; scan before use. Ties to **G-26**.

### F-05a-11 · CONFIRMED · HARDEN · **S1** (re-rated from S3 by owner decision D38) — Bulk fill lets anyone with Inventory access type a cannabis unit cost
- **Status: FIXED (Phase 0.5, G-27).** `unit_cost_minor_units` removed from `BULK_FILLABLE_FIELDS` and added to `BULK_FORBIDDEN_FIELDS` (`bulk-fill-core.ts`); `planBulkFill`, `bulkFillLotsAction` and `applyBulkFill` all refuse it; Issues / lot page / POS-import diagnostics say "Cost missing — correct from the manifest". Guard test `tests/compliance/fix-p0-5-no-typed-cannabis-cost.test.ts` allows only `intake-store.ts`, `receipt-service.ts` and `import-service.ts` to write a lot's cost.
- **Pin:** `bulkFillAction` is `inventory.manage` (`actions.ts` L904) and accepts `unit_cost_minor_units` (`bulk-fill-core.ts` L318–325). `roles.ts` L144–149: *"Cannabis cost entry is NOT built"*; `inventory.cost.fill` is owner + admin. The fill is blank-only, migration-lot-only and audited (`inventory_lot.bulk_filled`, `actions.ts` L975–996), which limits the risk.
- **Owner decision D38** (Q-05a-3): *"absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor."* Cannabis cost comes only from the manifest (`intake-parser.ts` L415–420) and is locked on the lot page (`lot-edit-core.ts` L38). Bulk fill is the one place it can be typed (`bulk-fill-core.ts` L54).
- **SOP impact:** SOP-05a v1.1 §4.20: nobody uses Bulk fill → Unit cost. Fixed by **G-27** (APPROVED).

### F-05a-12 · CONFIRMED · DOC · S4 — Inventory help panel is stale
- **Pin:** `inventory/page.tsx` L477 *"Vendor JSON intake (next slice)…"* (intake shipped; SOP-04); L464 lists "destructions" as an adjustment (contradicts SOP-15); `SopSheetLink slug="publish"` L473 points at the pre-R31 sheet (F-04-5).
- **SOP impact:** §4.2 note: follow the SOP where they differ.

### F-05a-13 · CONFIRMED · UX · S4 — Adjustment history shows the browser's date and no name
- **Status: FIXED (Phase 1.2, G-23). The history shows `formatPacificDateTime` and the staff name (`getStaffNames`; Unknown when not found, never a guess)).**
- **Pin:** `new Date(a.created_at).toLocaleDateString()` (`[id]/page.tsx` L1539): browser time zone, not Pacific. `actor_id` is stored (`store.ts` L607–613) but not shown.
- **SOP impact:** §4.5; form 8.2 is the readable record.

### F-05a-14 · CONFIRMED · UX · S4 — The "Needs attention" card counts expiring-soon lots but does not turn orange for them
- **Pin:** value includes `expiringSoon`; the accent sum omits it (`inventory/page.tsx` L536–548).
- **SOP impact:** §4.2 table note.

### F-05a-15 · CONFIRMED · GAP · S2 — No recall plan, recall coordinator or recall log in the app (WAC 314-55-225(3)(d) makes the plan mandatory)
- **Pin:** grep `recall plan|recall coordinator` → only `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` L136. The law (read 2026-10-27, app.leg.wa.gov): (3)(d)(i)(A)–(D) coordinator, identify/isolate, retrieve/destroy, communications; (3)(f) weekly progress tracking.
- **SOP impact:** §4.13, forms 8.4 (the plan) and 8.5 (event worksheet). Ties to **G-25**. Q-05a-2 answered (D37): the admin is the coordinator, no back-up.
- **Status: FIXED (Phase 1.6c, G-25).** **Settings → Recall plan** holds the plan (coordinator, LCB officer, sections A–D, approval and annual review; `settings/recall-plan/page.tsx`, audited `settings.recall_plan.save`), with Issues warnings when it is incomplete or its review is due (`recallPlanIssues`, `recall-event-core.ts` L418). **Inventory → Recalls** is the recall and market-withdrawal log (notice, lots set Recalled through the gated path, LCB notification, weekly rows (3)(f), close-out; tables in migration 0311). SOP-05a v1.9 §4.10, §4.13.

### F-05a-16 · CONFIRMED · GAP · S2 — A recall hold does not reach the website or online ordering
- **Pin:** the public menu filters only hidden cards (`src/lib/pos/live-menu.ts` L170–177, L295–304); online order pricing skips only hidden cards (`src/lib/orders/order-pricing.ts` L128–138). `recalledProductKeys` (`recall-hold-store.ts` L72–121) has four callers only: `api/pos/menu/route.ts` L124, `completion-gate.ts` L132, `restore-to-sale-store.ts` L131, `register-sellability-store.ts` L188.
- **Effect:** a recalled product stays visible on the website and can be reserved; the sale is refused only when staff complete the pickup (completion gate, fail-closed). WAC 314-55-225(3)(b)(i) requires preventing distribution.
- **SOP impact:** §4.10 step 5: set **Always hide** on Product Enrichment (audited `product.visibility_changed`). Ties to **G-25** (propagation requirement).
- **Status: FIXED (Phase 1.6c, G-25).** `loadLiveMenuItems` and `loadLiveMenuItemsCached` drop held products and held sizes (`withoutRecalled`, `recall-event-core.ts` L545; `live-menu.ts` L182, L315, outside the cache; advisory). `repriceOrderLines` reads `recalledProductKeys({ failClosed: true })` and refuses a held line or an unreadable status with 409 (`order-pricing.ts` L231–257). Open pickup orders holding a recalled product are a blocking Issue (`openOrdersIssue`, L598). Tested in `tests/compliance/fix-p1-6c-recall.test.ts`. SOP-05a v1.9 §4.10 step 5, §4.11.

### F-05a-17 · CONFIRMED · GAP · S2 — Returns & Destruction lists only Active lots
- **Status: FIXED (Phase 1.3, G-28). `disposition/page.tsx` L148 also loads Quarantine lots; the picker shows each lot's status; Recalled lots are never listed (D65)).**
- **Pin:** `src/app/admin/inventory/disposition/page.tsx` L107: `listLots({ status: "active", limit: 500 })` feeds the destruction form. Lots in **Quarantine** or **Recalled**, the ones most likely to be destroyed, cannot be chosen.
- **Effect:** staff are pushed to set a held lot Active to destroy it, which puts it back on sale in the meantime (and for a Recalled lot, lifts the hold).
- **SOP impact:** SOP-05a v1.1 §4.9 interim. Fixed by **G-28**. Found while answering the owner's Q-05a-4 question about the Destructions page.

### F-05a-18 · CONFIRMED · BUG · S1 — Scheduling a destruction overwrites Recalled with Quarantine and lifts the recall hold
- **Status: FIXED (Phase 1.3, G-28). `evaluateDestructionSchedule` (`destruction-lot-status-core.ts` L85) refuses a Recalled lot and the Recall reason; the Quarantine write is compare-and-set on Active (`disposition.ts` L1036); completion refuses a Recalled lot (L1117); guard step 5 fails any lot-status write in disposition.ts that is not compare-and-set).**
- **Pin:** `scheduleDestruction` (`src/lib/inventory/disposition.ts` L942–1058) writes `status: "quarantine"` at L965–971 whatever the lot's status was (unless `quarantineLot === false`, used only for a single customer-returned unit, L716–723). The register recall hold reads only `recalled` (`src/lib/pos/recall-hold-core.ts` L44); quarantine does not hold (`completion-gate.ts` L127–129).
- **Effect:** once a recalled lot is scheduled, nothing in the app shows it was recalled, and other lots of that product stop being held if it was the only Recalled lot. WAC 314-55-225(3)(b)(i) requires isolating recalled product.
- **SOP impact:** SOP-05a v1.1 §4.9 point 3, §4.10 step 9, form 8.4 (C): recalled lots are not scheduled in the app until **G-28**.

### F-05a-19 · CONFIRMED · BUG · S2 — Cancelling a destruction always sets the lot Active
- **Status: FIXED (Phase 1.3, G-28). `cancelDestruction` (`disposition.ts` L1269) restores the stored status via `restoreLotAfterEventCloses` (L934): only Quarantine → Active, only if it was Active, compare-and-set; migration 0307 keeps the status).**
- **Pin:** `cancelDestruction` (`disposition.ts` L1176–1192) sets `status: "active"` at L1113–1114, with the comment *"Release quarantine back to active (best effort)."*; it does not remember the earlier status.
- **Effect:** a cancelled destruction of an expired, damaged or (if F-05a-17 is worked around) recalled lot returns it to sale with no check.
- **SOP impact:** SOP-05a v1.1 §4.9 point 1, §6. Fixed by **G-28**.

### F-05a-20 · CONFIRMED · GAP · S2 — RSO has no CCRS type of its own, so an expiry block keyed on the CCRS type would miss it (fix slice, D44)
- **Pin:** the code's own RSO test case files RSO as *Concentrate for Inhalation* (`fact-extraction-core.ts` L890–894). The CCRS EndProduct list has no RSO type (`ccrs-batch-core.ts` L242–260). The store category is `rso` (migration `0035_inventory_category_types.sql` L103), counted in the concentrate limit bucket (`sales-limits-core.ts` L358).
- **Effect:** the owner put RSO in the expiry hard block (D44: *"Q-05a-6- yes, same with rso too."*). A G-24 build that reads only the CCRS type would hard-block edibles, tinctures and capsules but only warn on expired RSO.
- **SOP impact:** SOP-05a v1.2 §4.16 point 2 (read the name and category, not only the LCB classification). Fixed by **G-24** (key on the store category too).
- **Status: FIXED (Phase 1.6b, G-24).** The hard block reads the CCRS type, the store category (direct slug, or through the ledger category map, where *RSO* is `rso`: `ledger-category-map-core.ts` L148), the order line category, and the product name (*RSO* as a word, or *Rick Simpson*) (`expired-stock-core.ts` L112–135). An expired RSO filed as Concentrate for Inhalation is refused; a non-RSO concentrate gets the warning (test `fix-p1-6b-expired-stock.test.ts`).

### F-05a-C · CONFIRMED · DOC · S3 — Concierge inventory topic has six one-line facts and nothing on recalls, expiry, adjustments, the 86 or labels
- **Pin:** `src/lib/admin/concierge-kb.ts` `inventory` topic L163–180: six facts (lots and COAs, Other Inventory, Vendors & Brands, Types & Categories, Cycle Counts, Returns & Destruction). grep `recall|expir` in the file → none. Baseline ledger row "Inventory management 🟡" (`04-CONCIERGE-COVERAGE-LEDGER.md` §3).
- **SOP impact:** recorded in the concierge ledger (SOP-05a slice); grounding from SOP-05a §4, §5, §8, §9 in Phase D.

---

## SOP-05b Non-Cannabis, Merch, Publish, Categories, Classification & Sell Price findings (audited at `main@827facb5`, 2026-10-27)

Owner sources: D35 (the 05a / 05b split) and D43 (*"Please finish the inventory management sop."*) in `00-OWNER-REQUEST-VERBATIM.md`; D38 (cannabis cost only from the vendor's CCRS manifest); D41 (living SOPs); D42 (the concierge covers every feature).
**Verdict: PARTLY MET, with two S1 gaps.** Publish Menu, the Merch page, sales-limit classification and the cannabis sell-price floor are careful and audited. Other Inventory is a good catalog, but it is **not connected to the register**. And nothing stops a category change from turning cannabis into non-cannabis for tax, limits and scan.

### F-05b-1 · CONFIRMED · GAP · S1 — Other Inventory is not connected to the register
- **Pin:** the register menu is built from `menu_items` only (`src/lib/pos/live-menu.ts` L158–160; `src/app/api/pos/menu/route.ts` L188, L420–430). Scan-to-cart matches only menu barcodes and lot codes (`scan-to-cart-core.ts` L55–75, L101–144). The sale decrement touches cannabis lots only (`src/lib/inventory/sale-decrement.ts` L107–110). Yet the intake form promises the barcode *"becomes the register code"* (`NonCannabisIntakeForm.tsx` L122–124), and the label page, help panel, `help-content.ts` L470–472 and `concierge-kb.ts` L172 imply scanning works (label page L7–8; `noncannabis/page.tsx` L230–240).
- **Effect:** non-cannabis goods are rung on the Keypad as free text. **On hand**, **Reorder now**, retail value and margin never move with sales, and shrink is invisible between counts.
- **SOP impact:** SOP-05b header box, §4.1, §4.4, §4.5 (Monday reconciliation, form 8.1), §9. Fixed by **G-29**.

### F-05b-2 · CONFIRMED · HARDEN · S2 — Confirm and Archive write no audit row, and Archive has no restore
- **Pin:** `noncannabis/actions.ts` L86–100 → `store.ts` L422–447: status updates with no `recordAudit`. No action sets an archived item back to active.
- **Effect:** who activated or retired an item cannot be shown; a mistaken archive needs a re-create with a new SKU.
- **SOP impact:** §4.3 step 6, §4.9, form 8.1 catalog line. **G-32**.

### F-05b-3 · CONFIRMED · HARDEN · S2 — A non-cannabis adjustment is read-then-write and not atomic
- **Pin:** `store.ts` L307–343 reads `on_hand`, inserts the ledger row, then writes the new count as a separate step.
- **Effect:** two adjustments at once can lose one. A failure between the steps leaves a ledger row with no count change.
- **SOP impact:** §4.5. **G-32**.

### F-05b-4 · CONFIRMED · HARDEN · S3 — Direction can contradict Reason
- **Pin:** `MerchCatalog.tsx` L90–110 defaults the direction from the reason but lets it be changed; `noncannabis/actions.ts` L119 accepts any pair.
- **Effect:** "Theft / loss" can be posted as **+ Add**, which hides shrink.
- **SOP impact:** §4.5 step 2. **G-32**.

### F-05b-5 · CONFIRMED · UX · S4 — Recent adjustments shows browser-local time and no actor
- **Pin:** `noncannabis/page.tsx` L369.
- **SOP impact:** §4.5. **G-32**.

### F-05b-6 · CONFIRMED · GAP · S2 — No way to edit a non-cannabis price or a non-zero cost, and a $0.00 price is accepted
- **Pin:** the price is set only at draft (`noncannabis/actions.ts` L51; `store.ts` L261). The invoice builder creates $0.00 drafts when retail is blank (`invoice-store.ts` L142). Cost fill works only at $0.00 (`cost-fill-core.ts` L46–47).
- **Effect:** a typo'd price is permanent. The only workaround is archive and re-create, which changes the SKU.
- **SOP impact:** §2, §4.3 step 5, §4.6, §4.9 (form 8.2; owner, admin or manager per D46). Fixed by **G-30** (APPROVED, D46, D48).

### F-05b-7 · CONFIRMED · BUG · S2 — A failed invoice save rolls back only the header
- **Pin:** `invoice-store.ts` L124–128 (header delete on failure), L135–158 (drafts and restock adjustments already written, not undone).
- **Effect:** after a failed save, there are orphan drafts and extra stock on file; a retry doubles them.
- **SOP impact:** §4.6 "If the save fails part-way". **G-32**.

### F-05b-8 · CONFIRMED · HARDEN · S3 — The invoice audit row is fire-and-forget
- **Pin:** `noncannabis/actions.ts` L296–307: `recordAudit(...).catch(() => {})`.
- **Effect:** a saved invoice (a payable source document) can have no audit row, and nobody is told.
- **SOP impact:** §6. **G-32**.

### F-05b-9 · CONFIRMED · BUG/HARDEN · S1 — A category change can turn cannabis into non-cannabis for tax, limits and scan
- **Status: FIXED (Phase 0.4, G-31).** `src/lib/compliance/cannabis-line-core.ts` is the one check; `parseClassificationEdit` (lot override), `buildReassignPlan` (Move products) and the inventory-type create / adopt / update refuse a crossing in both directions with no override; each refusal is audited `cannabis_line.refused`; Inventory → Issues shows a blocking row for any cannabis lot on a non-cannabis category. Test `tests/compliance/fix-p0-4-cannabis-line.test.ts`.
- **Pin:** the non-cannabis set `merch`, `accessories`, `accessory`, `paraphernalia` drives tax (`src/lib/orders/order-pricing-core.ts` L42–50: 9.3% only, no 37% excise), the purchase limit (`sales-limits-core.ts` L370–374: none), scan-required (`scan-required-core.ts` L55–61: off) and the price floor (`price-correction-core.ts` L35–39, L61–67: ×1.093, not ×1.463). **Move products** (`settings/types/actions.ts` L367–397 → `category-registry.ts` L125–160) rewrites `menu_items.category` on the live menu, which the register prices from. `buildReassignPlan` (`category-registry-core.ts` L149–198) has no cannabis check. The lot-page override (`[id]/page.tsx` L1176–1270; `parseClassificationEdit`, `lot-website-classification-core.ts` L61) has no cannabis check either. It changes the website listing and the lot-page price math (L1026, L1083). It was not found in `api/pos/menu` or order pricing.
- **Effect:** one owner/admin click can stop collecting cannabis excise and stop enforcing WAC 314-55-095 limits on a cannabis product at the register. A manager can lower a cannabis lot's legal floor through the override.
- **SOP impact:** §2, §4.15–§4.17, §4.21 step 3, §6, §7, §9, form 8.3. Fixed by **G-31**.

### F-05b-10 · CONFIRMED · HARDEN · S2 — The publish removal check fails open
- **Pin:** `menu-imports/actions.ts` L216–237: if the removal diff throws, the error is only `console.error`-ed and the publish continues.
- **Effect:** the guard that exists because *"an old 3-item draft silently wiped an 18-item menu"* (L214–218) is skipped exactly when it cannot see.
- **SOP impact:** §4.14, §6. **G-32**.

### F-05b-11 · CONFIRMED · HARDEN · S4 — Category rename and delete audits carry no before / after
- **Pin:** `settings/types/actions.ts` L108–114, L148–170.
- **SOP impact:** §4.15 (form 8.3). **G-32**.

### F-05b-12 · CONFIRMED · HARDEN · S2 — A cannabis sell price can be saved with no floor when the cost is unknown
- **Pin:** `afterTaxFloorMinor` returns null without a cost (`price-correction-core.ts` L65); the help says *"Cost is unknown for this lot, so no floor can be enforced."* (`[id]/page.tsx` L1067). Any manager (`inventory.manage`) can save any price above $0.00.
- **Effect:** a below-cost sale (RCW 69.50.357 / WAC 314-55-155) is possible on exactly the lots whose cost is missing. Tied to D38 (cost only from the CCRS manifest).
- **SOP impact:** §2, §4.21, form 8.2: **no price save until the manifest cost is entered** (D49). **G-32** (APPROVED, D49).

### F-05b-13 · CONFIRMED · HARDEN · S3 — A classification lot-row write failure is visible only in the audit row
- **Pin:** `inventory/actions.ts` L1105–1145: `lot_row_write_failed` goes into the audit `after`; the user is redirected `?saved=1` (L1156).
- **Effect:** the worklist (which reads the lot row) can keep showing the product as unclassified while the register enforces the new answer.
- **SOP impact:** §4.19 step 6. **G-32**.

### F-05b-14 · CONFIRMED · GAP · S3 — A manager can permanently Remove a merch product; the owner limited it to owner and admin (fix slice, D47)
- **Pin:** `removeMerchAction` checks only `requirePermission("inventory.manage")` (`merch/actions.ts` L33–34), and `inventory.manage` includes manager (`roles.ts` L107).
- **Effect:** the owner said *"Q05b-3- owner and admin."* The removal can't be undone except by republishing from Merch Studio.
- **SOP impact:** SOP-05b v1.1 §2, §4.11, §6 (store rule). **G-30A**.

### F-05b-15 · CONFIRMED · GAP · S2 — Non-cannabis keypad sales post no cost of goods sold (fix slice, D45)
- **Pin:** a keypad line is built with `costMinorUnits: null` (`custom-sale-core.ts` L144). The daily accounting post drops keypad lines before gathering costs (`sale-posting-service.ts` L360) and, with no other lines, sets every line's cost to null (L369–371).
- **Effect:** non-cannabis revenue posts with no matching cost, so the books overstate margin on glass, papers and devices. The Other Inventory catalog holds the unit cost, but nothing links the sale to it (F-05b-1).
- **SOP impact:** SOP-05b v1.1 §4.1 (the widened G-29 list). **G-29** item 6 (owner D45: *"any other upgrade, enhancement and such needed to fully utilize non cannabis goods in the system"*).

### F-05b-C · CONFIRMED · DOC · S3 — The concierge has one line on Other Inventory and nothing on merch, publish, categories, classification or sell price
- **Pin:** `src/lib/admin/concierge-kb.ts` `inventory` topic L163–180 (one Other Inventory line, L172, which repeats the scan promise of F-05b-1; one Types & Categories line).
- **SOP impact:** concierge ledger SOP-05b section; grounding from SOP-05b §4–§9 in Phase D (D42).

### F-06-1 · CONFIRMED · GAP · S1 — No screen moves a new audit out of "being planned", so it never reaches Cycle Counts
- **Pin:** `createAuditSession` inserts `status: "draft"` (`audit-hub-store.ts` L586). Cycle Counts lists only `COUNT_QUEUE_STATUSES = ["scope_approved","counting"]` (L379–382; `cycle-counts/page.tsx` L90). The only stage buttons are `to=review` while counting and `to=approved` in review (`audits/[id]/page.tsx` L209–238); draft and scope_approved fall to the "kept as a permanent record" text (L270–279). `grep "scope_approved"` under `src/app/admin/inventory` finds only a colour (`audits/page.tsx` L63). The count sheet accepts numbers only while `counting` (`audits/[id]/count/page.tsx` L100).
- **Effect:** the owner's design (*"I approve the scope and push it to the cycle counts page"*, `cycle-counts/page.tsx` L17–20; *"approving it is what pushes the count out to the floor"*, `MICHAEL-books-23.md` L55–59) cannot be done. Every new audit stays invisible to the floor. There is also no button back from review to counting (allowed by `LEGAL_STATUS_MOVES`, `inventory-audit-post-core.ts` L113–119).
- **SOP impact:** SOP-06 "one thing to know", §4.2, §4.7 (paper interim, form 8.2). **G-33**.

### F-06-2 · CONFIRMED · GAP · S2 — No Cancel control for an audit
- **Pin:** `cancelled` is a legal move from draft, scope_approved, counting and review (`inventory-audit-post-core.ts` L113–119), but no form posts `to=cancelled` (`audits/[id]/page.tsx`).
- **Effect:** stale or compromised audits (cutoff broken, F-06-7) can't be closed; the hub's "in progress" count grows.
- **SOP impact:** §4.2, §4.7 step 5, §4.11. **G-33**.

### F-06-3 · CONFIRMED · UX/DOC · S2 — Staff cannot finish a count; the help says they can; staff links lead to denied pages
- **Pin:** Cycle Counts help step 4 (`cycle-counts/page.tsx` L138): *"When every lot has a number, the count leaves this page and goes to the owner to review. You are done at that point…"*. No code moves the stage on the last entry (`saveCountLine`, `audit-hub-store.ts` L877–950); only the owner's **Finish counting and review the differences** does (`audits/[id]/page.tsx` L216–222). The count sheet's **Review and finish** button (`count/page.tsx` L84) and **Auditing** breadcrumb (L67) go to owner-only pages.
- **Effect:** contradicts the owner letter *"When they finish, it leaves their screen."* (`MICHAEL-books-23.md` L72–76). Staff are told they are done; the owner is never told.
- **SOP impact:** §4.8 step 4, §4.9, §4.13. **G-34**. Q-06-2.

### F-06-4 · CONFIRMED · GAP · S3 — Hub "Counted"/"Difference" and the queue progress show 0 / $0.00 until posting
- **Pin:** session totals read `counted_lot_count` / `gross_variance_cents` (`audit-hub-store.ts` L203–205, L291–293); default 0 (migration 0191 L154); written only at posting (0192 L394–400).
- **Effect:** the owner's "Waiting for you" table and the floor's done/remaining figures are wrong for every live audit.
- **SOP impact:** §4.4 caution, §4.8 step 3. **G-34**.

### F-06-5 · CONFIRMED · UX · S2 — Second counts can only be entered by scan; no third count; the "pick it from the list" message has no list for counted lots
- **Pin:** **enter by hand** shows only for outstanding lines (`AuditCountSheet.tsx` L364–375). A counted line's next entry writes `recount_qty` and each further one overwrites it (`audit-hub-store.ts` L920–928). The ambiguous-scan text says *"Pick it from the list below instead"*.
- **Effect:** a lot with an unreadable label can't get its second count; a disagreeing second count can't get a third.
- **SOP impact:** §4.10 step 5, §4.12 steps 3–4. **G-36**.

### F-06-5b · CONFIRMED · GAP · S1/S2 — Re-scanning a counted lot silently becomes its "second count"; scans do not add up
- **Pin:** `saveCountLine` writes `recount_qty` whenever `counted_qty` is already set, with no check that a recount was requested (`audit-hub-store.ts` L920–928). Posting uses `coalesce(recount_qty, counted_qty)` (0192 L292). The built-in checklist says each scan will *"add one to that batch's count"* (`inventory-audit-core.ts` buildCountChecklist, L1416–1493), which the sheet does not do.
- **Effect:** a counter scanning the second package of a lot and typing "1" replaces the lot's whole count at posting. No warning.
- **SOP impact:** §4.10 step 4, §9.2 card, form 8.4. **G-36**. Q-06-7.

### F-06-6 · CONFIRMED · GAP · S2 — Line writes have no stage check, in code or in the database
- **Pin:** `saveCountLine` (`audit-hub-store.ts` L877–950) and `saveLineReason` (L953–970) never read the session status; RLS `inventory_audit_lines_staff_all` is `for all using (public.is_staff())` (0191 L388–390); no status trigger on lines. Only the UI makes the sheet read-only outside counting (`count/page.tsx` L100).
- **Effect:** counts can be changed after **Finish counting**, after **Approve this result** and before posting, by any `is_staff` login with a direct request, so the signed result can differ from the posted one.
- **SOP impact:** §2 store rule 4, §4.13 step 4. **G-36**.

### F-06-7 · CONFIRMED · GAP · S1 — Cutoff: a sale between creating the audit and counting it is subtracted twice at posting; the promised warning does not exist
- **Pin:** quantities freeze at creation (`audit-hub-store.ts` L596–602); posting computes `v_delta := v_effective - r.system_qty` (0192 L318) and applies it to the live shelf (L350–353). Example: frozen 100, 5 sold (shelf 95), count 95 → delta −5 → shelf 90. The ISA 501.A5 explainer claims the hub *"warns you when sales landed in the middle of it"* (`audit-hub-authorities.ts` L215–235); no such feature exists (grep). The work paper says *"a sale rung up mid-count cannot change the figure being measured"* (`audits/[id]/export/page.tsx` L194–196).
- **Effect:** phantom shrink written to the shelf, CCRS (Reconciliation) and the books; possible excise exposure under WAC 314-55-089(4)(c); possible INVENTORY_AUDIT_NEGATIVE refusals.
- **SOP impact:** §4.3, §4.11 (timing rule), §4.17 step 1, §4.19, §7. **G-35**. Q-06-8.

### F-06-8 · CONFIRMED · GAP · S3 — Two different count schedules; the Issues fix links to a page that cannot start a count
- **Pin:** `CADENCE_DAYS` A30/B60/C90/U14 (`inventory-audit-core.ts` L324–329) vs `COUNT_CADENCE_DAYS` A30/B90/C180 (`inventory-intel-core.ts` L301). Issues row *"Start a cycle count."* → **Open cycle counts** (`issues-core.ts` L481–488), which has no create button by design.
- **SOP impact:** §4.5 step 3, §4.22. **G-39**. Q-06-5.

### F-06-9 · CONFIRMED · GAP · S2 — "Read only" legacy cycle counts still write through the service role
- **Pin:** `cycle-counts/actions.ts` (record L92, scan bump L113, apply L147, cancel L183, sheet preview/apply L227/L270, `inventory.manage`); `cycle-counts.ts` `bumpLineCount` L278–320, `recordLineCount` L382–415 (no open-status check), `cancelCycleCount` L526–545; open sessions render Cancel, scanner and **Enter count** (`cycle-counts/[id]/page.tsx` L161–172, L222, L317, L389). Migration 0194 admits the service role bypasses its read-only grant.
- **SOP impact:** §4.20 store rule. **G-39**. Q-06-6.

### F-06-10 · CONFIRMED · DOC · S3 — The built-in counting checklist is never shown; the method text says it is
- **Pin:** `buildCountChecklist` (`inventory-audit-core.ts` L1416–1493) has no caller in `src/app`. `AUDIT_METHOD` step 2 systemDoes *"Generates the count sheet with a step-by-step checklist"* (`audit-hub-guidance-core.ts` L80–180).
- **SOP impact:** §4.10 (the SOP carries the steps). **G-39**.

### F-06-11 · CONFIRMED · UX · S4 — Cosmetic: approved colour differs; browser times; server-time default name
- **Pin:** approved = gold on the audit page (`audits/[id]/page.tsx` L71–75) vs green on the hub (`audits/page.tsx` L60–65); `toLocaleString` in the browser on the oversold and older lists (`cycle-counts/page.tsx` L186, L206, L282–305); `defaultLabel` uses server `new Date()` (`audits/new/page.tsx`).
- **SOP impact:** §4.6, §4.21. **G-39**.

### F-06-12 · CONFIRMED · GAP · S3 — No daily checklist feature (re-verifies F-00-9)
- **Pin:** no checklist model, page or nav entry outside HR lifecycle (`employee-lifecycle-core.ts`); re-checked at `c976c7e4`.
- **Effect:** the owner's *"Checklists for daily tasks like cycle counts I initiate via the inventory audit feature"* and D51 (all employees) are paper only.
- **SOP impact:** §4.23, forms 8.5–8.7. **G-38**. Q-06-4.

### F-06-13 · CONFIRMED · GAP · S1 — A second count that disagrees with the first does not block approval, and posting uses the second count
- **Pin:** `assessLine` sets `blocksPosting: true` for `recount_disagrees` (`inventory-audit-core.ts` L800–980), but `readinessOf` (L1109–1210) adds blockers only for uncounted, needs-recount, merge pattern and undocumented material/unvalued lines; `gateSessionForPosting` (`inventory-audit-post-core.ts` L256–316) does not check per-line `blocksPosting`. **Proved by probe** (sys 10, count 5, recount 7, cost $20): `blocksPosting=true`, `canPost=true`, `blockers=[]`. 0192 L292 posts `coalesce(recount, counted)`.
- **Effect:** **Approve this result** appears and the unresolved second count is posted, despite the line saying *"Do not average them. Go and look again."*
- **SOP impact:** §4.12 step 5, §4.14 owner rule, §6. **G-36**.

### F-06-14 · CONFIRMED · GAP · S2 — A saved reason cannot be changed or completed; a reason without a note deadlocks the audit; reasons are not validated
- **Pin:** the reason form shows only when `requiresDocumentation && reasonCode === null` (`AuditVarianceReview.tsx` L255–297), so after any save it disappears; a material shrink needs reason **and** note (`assessLine`) and stays blocked. `saveReasonAction` does not check `reasonCode` against `VARIANCE_REASONS` (`audits/actions.ts` L221–263; DB `reason_code` free text, 0191 L254). `buildPostPlan`'s `needsOwnerDecision` / `readyToPost` is computed (`inventory-audit-store.ts` L290–355) but not enforced at posting.
- **SOP impact:** §4.15 warning, form 8.3, §6. **G-37**.

### F-06-C · CONFIRMED · DOC · S3 — The concierge has one line on Cycle Counts and nothing on audits, the push, recounts, reasons, posting, the journal draft or checklists
- **Pin:** `src/lib/admin/concierge-kb.ts` L66, L73, L175; help `help-content.ts` L450–451 (*"How do I do a cycle count?"*).
- **SOP impact:** concierge ledger SOP-06 section.

### F-06-15 · CONFIRMED · GAP · S2 — Any employee can enter numbers on any open count; nothing enforces one counter per count
- **Pin:** `saveCountAction` checks only `inventory.count` (`audits/actions.ts` L148–157) and passes the caller as `countedBy` (L189); `saveCountLine` stores `counted_by` / `recount_by` per line (`audit-hub-store.ts` L924–927). There is no claim, assignee or lock on the audit.
- **Effect:** the owner's rule *"Only one employee per scoped count."* (D56) is not enforced; two people can enter numbers on one count, and a second person's entry on a counted lot silently becomes the recount.
- **SOP impact:** SOP-06 §2 store rule 3, §4.12, §9.2. **G-36** (claim).

### F-06-16 · CONFIRMED · GAP · S3 — The /admin cockpit has no item for a count waiting for the owner
- **Pin:** the cockpit's **Needs your attention** list (`src/app/admin/page.tsx` L249–251) is built from `buildAttentionFlags` (`src/lib/admin/cockpit-core.ts` L138–178: drawers, open orders, low stock, refunds) plus `workQueueAttentionFlags` (`page.tsx` L121). No audit or count input exists.
- **Effect:** the owner's *"It should notify me in the main /admin cockpit command center."* (D55) has nowhere to appear yet.
- **SOP impact:** SOP-06 §4.8 step 5. **G-34**.

### F-06-17 · CONFIRMED · GAP · S2 — The clearance markdown lock has no admin screen
- **Pin:** the owner's rule is recorded at `src/lib/promotions/markdown-lock-core.ts` L8–11 (*"a 50% off products we have been sitting on for too long and things about to expire"*); the engine honours `markdownOnly` (`discount-engine-core.ts` L169; `published-rules-core.ts` L134). No file under `src/app` or `src/components` sets it.
- **Effect:** the owner's *"making sure products get heavily discounted before expiring"* (D57) cannot be done as a locked clearance markdown from the back office; staff can only list the items for the owner.
- **SOP impact:** SOP-06 §4.23, forms 8.5–8.8. **G-38** (expiring-soon list) and a clearance screen (to be audited in the promotions SOP).

## SOP-15 · Returns to Vendor, Customer-Return Disposition & Product Destruction (verified at `main@b8101abb`)

### F-15-1 · CONFIRMED · BUG · S1 — Logging a vendor return reduces on-hand and posts the CCRS adjustment before the manifest is confirmed or the product leaves
- **Status: FIXED (Phase 1.5, G-42). `createVendorReturn` now only reserves the units (`reserve_vendor_return`, migration 0309; `disposition.ts` L1037–1119; no `postReduction`); the reduction and the CCRS Other adjustment post at **Record departure**, after the LCB success email step (`depart_vendor_return`, `disposition.ts` L1246). Before 0309 the app refuses to log rather than reduce. Guard step 7; `tests/compliance/fix-p1-5-vendor-return.test.ts`).**
- **Pin:** `createVendorReturn` posts `postReduction(…, "other", …)` first (`src/lib/inventory/disposition.ts` L831–840), at the moment **Log return (reduces on-hand)** is pressed (`disposition/page.tsx` L201, L246). The screen's own checklist says *"Do not release product until the manifest is confirmed."* (`disposition-core.ts` L348). The manifest status is tracked afterwards (L855; `updateVendorReturnManifest` L879–904) but never moves stock.
- **Effect:** if the return is logged when the RMA arrives, the app and that week's CCRS InventoryAdjustment file report the product gone while it is still in the vault for 48–72 hours or more. A cancelled or rescheduled pickup leaves a false CCRS record (S1: state filing).
- **SOP impact:** SOP-15 §4.11 (log on pickup day only), form 8.2. Gap **G-42**.

### F-15-2 · CONFIRMED · GAP · S2 — RMA, manifest number, processor license and detail are optional on a vendor return; the vendor is never linked; a Recall reason has no guard
- **Status: FIXED (Phase 1.5, G-42). `evaluateVendorReturnLog` (`vendor-return-core.ts` L116) requires vendor (pre-filled from the lot), RMA, a numeric processor license (pre-filled from Vendors & Brands) and a detail; reason Recall needs the LCB officer and a contact date not in the future; a Recalled lot needs reason Recall. The manifest number is required at the upload step. The departure note names processor, license, manifest and RMA (L208).**
- **Pin:** `createVendorReturnAction` reads all four with `|| null` (`disposition/actions.ts` L121–124) and passes no `vendorId` (L129–131; the store accepts one, `disposition.ts` L815, L844). The reasons-file header says vendor returns *"always require detail"* (`disposition-reasons.ts` L9–10). Reason **Recall (coordinate with LCB first)** (L29) posts like any other.
- **Effect:** a vendor return can be recorded with nothing tying it to the processor's acceptance or the CCRS manifest, the record WAC 314-55-087 asks us to keep; a recalled lot can be sent back without the coordinator.
- **SOP impact:** SOP-15 §4.11 steps 5–6, §4.21. **G-42**.

### F-15-3 · CONFIRMED · GAP · S3 — Manifest steps are not checked on the server, the return records no actor per step, and pickup time has no time zone
- **Status: FIXED (Phase 1.5, G-42). `evaluateVendorReturnStep` (`vendor-return-core.ts` L159) enforces one step at a time on the server, with a compare-and-set on the status; each step stamps `*_by` / `*_at` on the return (migration 0309); pickup is entered as Pacific date + time and stored as UTC (`pacificInputToIso`), shown with "Pacific".**
- **Pin:** `updateManifestAction` checks only that the status is one of the five (`actions.ts` L152); `nextManifestStatuses` (`disposition-core.ts` L322–335) is used only to fill the dropdown. `updateVendorReturnManifest` discards the actor (`void actorId`, `disposition.ts` L891). **Pickup (optional)** is a `datetime-local` field stored as typed (`page.tsx` L460; `disposition.ts` L898) and displayed with the browser's `toLocaleString` (L435).
- **Effect:** a crafted post can jump to **Picked up**; the vendor-return row cannot say who confirmed the manifest (the audit row can); the pickup time may be read in the wrong zone.
- **SOP impact:** SOP-15 §4.12 (paper time is the record). **G-42**.

### F-15-4 · CONFIRMED · GAP · S2 — The destruction record does not require a witness, a recall contact date, or a prior-approval reference for "Other method"; there is no printable destruction log
- **Status: FIXED (Phase 1.6a, G-43; D64). `completeDestructionAction` (`actions.ts` L342) runs `evaluateDestructionRecord` (`destruction-record-core.ts` L116) before completing: a witness from the staff roster, never the person signed in; a camera and start/end time; for Other method, the LCB approval reference and date. Refusals are audited (`destruction.complete_refused`). The recall contact-date part is moot (recalls are never destroyed, D65). Printable monthly Destruction log (`/admin/inventory/disposition/destruction-log`). Record columns: migration 0310. Guard step 8; `tests/compliance/fix-p1-6a-destruction-record.test.ts`.**
- **Pin:** `validateDestructionCompletion` (`disposition-core.ts` L226–271) never checks `witnessedBy`; for recalls it checks the tick and the officer name only (L233–244), not `lcbContactDate`; `lcb_approved_other` skips the mix and 50% checks (L248) with no approval field. The audit row omits `lcb_contact_date` (`actions.ts` L228–240). No export or print page exists under `disposition/` other than the Sale correction CSV.
- **Effect:** a destruction can be completed by one person, with no witness and, for a recall, no date of the officer contact; the WAC 314-55-097 record exists only as database fields nobody can print.
- **SOP impact:** SOP-15 §2 rule 2, §4.17–§4.18, form 8.3. **G-43**.

### F-15-5 · CONFIRMED · UX · S4 — "Hold policy not elapsed" prints the time in the server's locale and zone
- **Status: FIXED (Phase 1.6a, G-43). The hold refusal uses `holdNotElapsedMessage` (`disposition-core.ts` L231), always Pacific; the page shows hold, completed and cancelled times with `formatDestructionPacific`.**
- **Pin:** `new Date(d.earliestDestroyAt).toLocaleString()` on the server (`disposition-core.ts` L228); the page shows the same time with the browser's clock (`page.tsx` L321).
- **Effect:** the two times can disagree (UTC on the server).
- **SOP impact:** SOP-15 §4.16, §5.3. **G-43**.

### F-15-6 · CONFIRMED · BUG · S1 — A customer-returned unit marked Destroy is added back to an Active lot and can be sold at the register until the destruction is completed
- **Status: FIXED (Phase 1.4, G-44). `record_customer_return` (migration 0308) adds the unit and holds it (`inventory_lots.held_qty`); every sale and stock reader uses `sellableQty` (`held-stock-core.ts` L43): `sale-lot-read.ts`, `sale-decrement.ts`, `sale-posting-service.ts`, `api/pos/menu/route.ts`, `register-sellability-store.ts`; manual adjustments and other disposition reductions refuse held units; guard step 6).**
- **Pin:** `postAddition(lotId, qty, "return", …, { sellable: false })` adds the units to on-hand (`disposition.ts` L713; L289–333); `sellable:false` only skips the menu sync (L330). The destruction is scheduled with `quarantineLot: false` (L715–723), so the lot stays **Active**. The register draws from Active lots with stock, oldest first (`sale-lot-read.ts` L50–53).
- **Effect:** the app counts the returned (often opened) unit as sellable stock; a sale of that product can draw it, and the later destruction then removes a sellable unit instead. On-hand is overstated until completion (S1: product that must not be sold).
- **SOP impact:** SOP-15 "one thing to know" 2, §4.7 (sealed destroy bin, form 8.1). **G-44**.

### F-15-7 · CONFIRMED · BUG · S2 — A customer return is not atomic: the add-back is posted before the return is saved, and a failed destruction event is ignored
- **Status: FIXED (Phase 1.4, G-44). The return, add-back, hold and destruction event are one RPC (`disposition.ts` L782); an RPC error changes nothing; before 0308 every later failure undoes the add-back (`undoAddition` L860) and the "reverse it manually" message is gone).**
- **Pin:** add-back L710; schedule result used only when `ok` (L727); the `customer_returns` insert follows (L731–762). On an insert error the function returns *"Apply migration 0115 first … The inventory add-back was posted — reverse it manually if you abort."* (L768) or the raw error (L770), with the add-back left in place.
- **Effect:** stock can rise with no return record and no Sale correction; a Destroy return can save with no destruction event, so the unit is never scheduled.
- **SOP impact:** SOP-15 §4.7 steps 3–4 and last paragraph. **G-44**.

### F-15-8 · CONFIRMED · GAP · S2 — The back-office Customer return wizard skips the store return policy, takes a typed refund, defaults to Destroy and has no lot picker
- **Pin:** `createCustomerReturnAction` (`actions.ts` L68–105) calls `createCustomerReturn` directly; the 15-day window and loyalty checks live only in `returns-core.ts` (L153, L192) used by the Returns desk and register (`returns-store.ts` L252–360). **Refund ($)** defaults to `0.00` and is typed (`CustomerReturnWizard.tsx` L173–174; capped at what was paid, `disposition-core.ts` L139–140); **What happens to it** lists Destroy first (L185–188). The store falls back to the newest non-quarantine lot (`disposition.ts` L613) and otherwise says *"…pick the lot manually…"* (L617), but the wizard has no lot field.
- **Effect:** a manager can refund outside the owner's policy, with a mistyped amount counted in the day's refunds (`refunds-store.ts` L49); the add-back may land on the wrong lot.
- **SOP impact:** SOP-15 §2 rule 1, §4.4, §4.6. **G-45**.

### F-15-9 · CONFIRMED · GAP · S2 — Cancelling a customer-return destruction sets the lot Active even though it was never quarantined, and no cancel records a reason
- **Status: FIXED (Phase 1.3, G-28). Owner-only `inventory.destruction.cancel`, a required reason kept on the event and in the audit row (before/after lot status); a customer-return event (`lot_status_touched = false`) never touches the lot).**
- **Pin:** `cancelDestruction` sets `status: "active"` on the lot unconditionally (`disposition.ts` L1188–1190); `cancelDestructionAction` records no reason (`actions.ts` L246–253). Extends F-05a-19 to the customer-return case and to the missing reason.
- **Effect:** the destroy-return unit silently becomes ordinary stock; any lot status set by hand after scheduling is overwritten; nobody can tell why a destruction was stopped.
- **SOP impact:** SOP-15 §2 rule 3, §4.19, form 8.5. **G-28** (extended).

### F-15-10 · CONFIRMED · HARDEN · S2 — "Download Sale correction CSV" marks returns exported without the ledger check the weekly batch performs
- **Pin:** route header: *"Prefer the weekly batch once the ledger is loaded: it checks each line is held by CCRS and records the file in the outbox. This download does not."* (`sale-correction-export/route.ts` L18–19); limit 500 (L62); marks exported and audits (L104). The page's banner and the success message tell staff to download it (`page.tsx` L151–166, L62–63).
- **Effect:** a download nobody uploads leaves the returns marked exported, so the weekly batch's pending filter (`ccrs-batch.ts` L445) relies only on its date window to pick them up; a stray file can be uploaded twice.
- **SOP impact:** SOP-15 §4.8 (do not download unless uploading by hand that day), form 8.6. **G-45**.

### F-15-11 · CONFIRMED · GAP · S3 — A partial destruction leaves the rest of the lot in Quarantine
- **Status: FIXED (Phase 1.3, G-28). `completeDestruction` calls `restoreLotAfterEventCloses` when units remain (L1178)).**
- **Pin:** scheduling quarantines the whole lot (`disposition.ts` L968–974); completion sets **Destroyed** only at zero (L1087–1095) and otherwise leaves the status alone.
- **Effect:** sellable units stay off sale until someone sets the lot Active by hand.
- **SOP impact:** SOP-15 §4.20. **G-28** (extended).

### F-15-12 · CONFIRMED · GAP · S3 — Scheduling does not check the quantity against on-hand
- **Status: FIXED (Phase 1.6a, G-43). `scheduleDestruction` (`disposition.ts` L1533–1542) refuses a quantity above on hand less held units less open destructions not backed by held units (`evaluateScheduleQuantity`), with the figures in the message.**
- **Pin:** `scheduleDestruction` checks only `quantity > 0` (`disposition.ts` L961); the comment says *"Quantity is validated against on-hand at completion time."* (L936–937); completion refuses with *"Quantity (x) exceeds on-hand (y)."* (L250).
- **Effect:** an over-scheduled event waits out the whole hold and then fails on destruction day.
- **SOP impact:** SOP-15 §4.15 step 4, §4.18. **G-43**.

### F-15-13 · CONFIRMED · UX · S4 — Missing fields show the bare words "qty" or "reason"
- **Pin:** `redirect(\`${BASE}?error=qty\`)` and `?error=reason` (`actions.ts` L83–84, L126–127, L179–180); the page prints `decodeURIComponent(sp.error)` as is (`page.tsx` L124–127).
- **Effect:** staff see a single word with no instruction.
- **SOP impact:** SOP-15 §4.15, §5.3. **G-46**.

### F-15-14 · CONFIRMED · GAP · S2 — No journal is drafted for customer refunds; 50910 Returns & Refunds is unused
- **Pin:** `ledger-census-data.ts` L252–268 marks `revenue_and_tax_collected.refund_or_return` missing: *"50910 Returns & Refunds is seeded and unused."*
- **Effect:** refunds reduce the drawer (`refunds-store.ts` L49) but not revenue in the books until someone posts them by hand.
- **SOP impact:** SOP-15 §4.24, form 8.6. **G-48**.

### F-15-15 · CONFIRMED (code read; not exercised on a live return) · GAP · S2 — The excise return's Box 1 does not subtract returned sales
- **Pin:** Box 1 is built from completed orders and their lines (`excise-return.ts` L140–158); the file has no read of `customer_returns`. A manual override exists (`cannabisSalesMinorOverride`, L111).
- **Effect:** a sale returned in the same month is likely still counted in cannabis sales on LIQ-1295, overstating excise. Not verified against a filed return.
- **SOP impact:** SOP-15 §4.24, form 8.6. **G-48**.

### F-15-16 · CONFIRMED · GAP · S2 — The Sample-pricing rules saved on this page are not enforced anywhere
- **Status: FIXED (Phase 0.2, G-47).** Panel, `updateSampleSettingsAction`, `get/updateSampleSettings` (disposition.ts) and `sample-guardrails.ts` removed; concierge line corrected. The `sample_settings` table is left in place (no destructive migration).
- **Pin:** `checkSampleSale` and `effectiveSamplePrice` (`src/lib/inventory/sample-guardrails.ts`) have no caller outside that file and its self-test (`scripts/compliance/run-pure-selftests.ts` L948). The panel saves `sample_settings` (`actions.ts` L283–301; `page.tsx` L538).
- **Effect:** **Force samples to the nominal price** and **Block selling samples to the public** do nothing at the register or online; the concierge line *"…plus sample-pricing rules"* (`concierge-kb.ts` L176) implies protection that does not exist.
- **SOP impact:** SOP-15 §4.26. **G-47**.

### F-15-17 · CONFIRMED · DOC · S4 — Stale comments: the migration still calls the 72-hour hold a WSLCB rule; the reasons header says detail is always required
- **Pin:** `supabase/migrations/0042_*.sql` L44 (*"WSLCB requires a quarantine + notice period before destruction."*) and L55 (*"WSLCB notice/quarantine: 72h hold before destruction is permitted."*), contradicted by the compliance doc §5.1 and the page (L511–531); `disposition-reasons.ts` L9–10.
- **Effect:** a future developer may re-assert a removed rule.
- **SOP impact:** SOP-15 §4.27. **G-49**.

### F-15-C · CONFIRMED · DOC · S3 — The concierge has two generic lines on Returns & Destruction and none of the procedures, guards or interim rules
- **Pin:** `concierge-kb.ts` L66 (menu list), L176 (*"Returns & Destruction handles vendor returns and compliant destruction with a quarantine hold, plus sample-pricing rules."*); `help-content.ts` L465–467 (*"Returns & Destruction handles customer returns, samples, and lawful destruction with the documentation WA compliance requires."*). Nothing on the manifest workflow, pickup-day logging, the destroy bin, the recall prohibition, rendering unusable, the witness, cancel, the CSV, or the not-enforced sample rules.
- **Effect:** a rarely-used, legally sensitive procedure (D62) cannot be answered by the concierge.
- **SOP impact:** concierge ledger SOP-15 section (today-vs-once-built table, D42).


### F-15-18 · CONFIRMED · DOC · S3 — The "Returned to seller → Other" CCRS mapping is cited from the wrong table
- **Pin:** `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` L120–124 (*"The Upload User Guide's own mapping table for destruction reasons lists "Returned to seller → Other", confirming `Other` + detail is the LCB-expected encoding"*) and SOP-15 v1.0 §7. In the CCRS Upload User Guide (2-26) that row is in **Table 4, DestructionReason**, under the **PlantDestruction** file (producers' plants). The InventoryAdjustment reasons (Destruction, Reconciliation, Lost, Seizure, Theft, Other) and **Table 5** have **no** return-to-vendor row.
- **Effect:** the encoding (**Other** + detail) is still the best fit, but the document claims an LCB confirmation that does not exist. The open examiner question is U-72 (`docs/ccrs-bible/12-unverified-register.md` L74).
- **SOP impact:** SOP-15 v1.1 §4.13, §7. Correct the compliance doc when G-42 is built (docs only).

### F-15-19 · CONFIRMED · DOC · S2 — The vendor-return checklist states a lead time and an LCB review schedule that are not LCB text
- **Status: FIXED (Phase 1.5, G-42). `VENDOR_RETURN_MANIFEST_STEPS` removed from `disposition-core.ts`; the screen shows `VENDOR_RETURN_STATE_STEPS` (`vendor-return-core.ts` L77–84) with no lead time or review days; the AI advisor text corrected (`disposition-advisor.ts` L24); activation guard step 7 fails if the text comes back.**
- **Pin:** `src/lib/inventory/disposition-core.ts` L340–349 (comment and `VENDOR_RETURN_MANIFEST_STEPS`: *"Submit the manifest 48–72 hours before pickup; LCB confirms manifests Mon/Wed/Fri by email (info@lcb.wa.gov)."*) and the compliance doc §3. The LCB's Manifest User Guide (10-27-2025) and WAC 314-55-085 set no lead time and describe an **automatic** success email with the manifest PDF on upload. The 48–72 h figure is a POS vendor's practice (POSaBIT). The checklist also never says that **Greenway, as the origin**, uploads the manifest (the file name must carry the origin license).
- **Effect:** staff could delay a return for a wait the state does not require, or treat the lack of a Mon/Wed/Fri email as "not confirmed" when the success email has already arrived.
- **SOP impact:** SOP-15 v1.1 §4.9–§4.10, form 8.2, card 9.2. **G-42**.

### F-15-20 · CONFIRMED · GAP · S1 — Trade samples are not kept off the menu or the register
- **Status: FIXED (Phase 0.2, G-51).** `sample-lot-core.ts`; filters in `catalog-drafts.ts` (seed + approve refuses), `intake-menu-staging.ts`, `draft-injection.ts`, `sale-lot-read.ts`, `api/pos/menu/route.ts`, `register-sellability-store.ts`, `lot-menu-stock.ts`, `void-store.ts`. Test `tests/compliance/fix-p0-2-samples.test.ts`.
- **Pin:** no register, menu or product-onboarding code reads `is_sample`. (a) `src/lib/inventory/catalog-drafts.ts` L370–373: `seedDraftsForManifest` reads every non-destroyed lot on the manifest, and `SEED_LOT_COLUMNS` (L239) has no `is_sample`, so a sample lot gets a Product Onboarding draft. (b) `src/lib/inventory/sale-lot-read.ts` L47–53: the register's lot draw takes any Active lot with stock for the product key, oldest first. (c) `src/app/api/pos/menu/route.ts` L188–190 and L420–424: the menu's lot read and barcode index check only status and quantity. A sample lot carries the product's SKU as its key (`intake-parser.ts` L438). The only guard is an advisory review warning (`intake-review-core.ts` L120–124).
- **Effect:** a sample can be approved onto the menu, or used up by an ordinary sale of the same product. WAC 314-55-096(1)(i): *"Trade samples may not be sold"*. The owner: *"They can not be sold at the register, they cannot be found on the menu."* The rest of the samples branch is correct: receiving, the 120 intake cap, the 30 give-out cap, the $0.01 cost, and the decrement at distribution on the hub.
- **SOP impact:** SOP-15 v1.1 §4.26 interim check, §6, §7, form 8.6. **G-51**.

### F-15-21 · CONFIRMED · GAP · S3 — The destruction record has no camera reference
- **Status: FIXED (Phase 1.6a, G-43; D64). Camera name and start/end time (Pacific) are required to complete and are stored (migration 0310; before it, in the witness line) and shown on the Destruction log.**
- **Pin:** `src/app/admin/inventory/disposition/page.tsx` L366 (the only person field is free-text **Witnessed by**, *"Names"*); there is no camera field in the page, `actions.ts` L197–245 or `disposition-core.ts` `validateDestructionCompletion`.
- **Effect:** the owner requires every destruction on camera (D64), and WAC 314-55-083(3)(a) requires cameras where waste is destroyed. Without a camera and time on the record, the footage (kept 45 days) is hard to find for an inspector.
- **SOP impact:** SOP-15 v1.1 §4.17–§4.18, form 8.3. **G-43**.

## SOP-08 · New Hire Onboarding, System Access & Offboarding (verified at `main@bad718b4`)

State texts read 2026-10-28: RCW 69.50.357(2)–(3), WAC 314-55-083(1), WAC 314-55-087(1)(e). Owner basis: books-87 (users are separate from employees, quoted verbatim in migration 0210 L4–12) and D69.

### F-08-1 · CONFIRMED · BUG · S1 — Every new person is created Active, so the Activate gate never runs for a new hire
- **Status: FIXED (Phase 0.3, G-52 + G-59).** `createEmployeeAction` and `addPersonToPayroll` insert `employment_status = 'candidate'`, `active = false`, no PIN; `updateEmployeeAction` refuses a PIN unless Active (`candidate-start-core.ts`); `setStatusAction` needs `staffing.lifecycle` (owner, admin). Migration 0306 keeps candidates on the payroll roster. Test `tests/compliance/fix-p0-3-candidate-lifecycle.test.ts`.
- **Pin:** `src/app/admin/staffing/actions.ts` `createEmployeeAction` L119–151 inserts `{full_name, clock_pin, job_role, active: true}` with no `employment_status` (L132–137), and migration 0117 L38 defaults it to `'active'`. Payroll Setup `addPersonToPayroll` does the same (`payroll-onboarding-store.ts` L1121–1130). `canTransition` (`employee-lifecycle-core.ts` L441–451) and `activationBlockers` (L422–424) only run on the Activate button (`employee-lifecycle-store.ts` L500–514), which a new hire never needs. The roster help text says *"Add them below as a CANDIDATE"* (`employees/page.tsx` L93), and the optional PIN field (L205) works at once.
- **Effect:** a new hire can clock in and unlock the register before the 21+ check, I-9, W-4, handbook or training is done. RCW 69.50.357(2) forbids anyone under 21 working in the store, and (3) requires training. The checklist is advisory only.
- **SOP impact:** SOP-08 "One thing to know", §4.3, §4.6, §4.13, §5, card 9.1; interim rule: **no PIN until form 8.1 is signed**. **G-52**.

### F-08-2 · CONFIRMED · GAP · S2 — No screen links a user (sign-in) to an employee file
- **Pin:** `employees.staff_id` is set only by the 2023 seed (migration 0037 L125–132); `payroll-onboarding-store.ts` L1046 says it must never set it; no action in `/admin/users` or `/admin/staffing/employees/**` writes it. The register handbook gate (`handbook-ack-store.ts` `registerGateForEmployee` L99–155) reads the linked login's acknowledgment or owner role. Without a link it falls back to the paper Document tracker row.
- **Effect:** the digital handbook acknowledgment does not unlock the register for anyone added since 2023, and offboarding cannot find the person's sign-in from the employee file (or the reverse). The separation follows the owner's books-87 rule, but the missing link breaks two features.
- **SOP impact:** SOP-08 §4.1, §4.10, §4.14, §4.21. **G-53** (Q-08-1).

### F-08-3 · CONFIRMED · GAP · S2 — Terminate and Deactivate are not connected
- **Pin:** `employee-lifecycle-store.ts` `setEmploymentStatus` L516–527 (Terminated sets `active=false`, `clock_pin=null`) never touches `staff_profiles`, shifts or punches. `users/actions.ts` `setUserActive` L100–179 (ban L143–153) never touches `employees`. The page text *"Letting someone go? Do both halves."* (`users/page.tsx` L251–268) is the only guard.
- **Effect:** a terminated employee keeps back-office access until someone deactivates the sign-in on a different page. Future shifts stay on the schedule, and an open punch stays open.
- **SOP impact:** SOP-08 §4.21–§4.22, form 8.3, card 9.2 (both halves the same day; for a dismissal, deactivate first). **G-54** (Q-08-2).

### F-08-4 · CONFIRMED · BUG · S2 — The handbook checklist box does not set the Document tracker row the register reads
- **Pin:** `setTaskDone` (`employee-lifecycle-store.ts` L365–409) upserts only the task row. The register reads the document row `handbook` status `signed` (`handbook-ack-store.ts` L107–118). The comment at `employee-lifecycle-core.ts` L62 says a docKey "nudges" the tracker, but nothing does. The paper route has no version, so a HANDBOOK_VERSION bump (`handbook-content.ts` L24, now "2.0") does not re-gate the register for paper signers.
- **Effect:** a manager checks "Employee read and signed the handbook" and the register still says the handbook must be signed. Paper signers of an old version keep passing after a new version.
- **SOP impact:** SOP-08 §4.10 step 4, §4.18 (check the box **and** set the tracker row to Read & signed; re-sign by hand on a version change). **G-55**.

### F-08-5 · CONFIRMED · GAP · S3 — Training checkmarks need no training-log entry; Activate needs no hire date or badge number
- **Pin:** `toggleTask` (`[id]/actions.ts` L41–66) accepts any task. `activationBlockers` (`employee-lifecycle-core.ts` L422–424) checks only the critical task flags, not the training log (`addTraining` L110–134) or hire info (`updateHireInfo` L140–184).
- **Effect:** the 5-year training record (WAC 314-55-087(1)(e), RCW 69.50.357(3)) can be missing while the checklist shows trained.
- **SOP impact:** SOP-08 §4.11 step 3 (no log line, no checkmark), form 8.1. **G-55**.

### F-08-6 · CONFIRMED · BUG · S3 — Rehire erases the earlier termination date and reason and keeps the old checkmarks
- **Pin:** `employee-lifecycle-store.ts` L532–538 clears `termination_date` and `termination_reason` on Terminated → Onboarding and leaves every old task row checked.
- **Effect:** the file loses its employment history (only the audit log keeps it), and a rehire can be activated on old I-9 and training checkmarks.
- **SOP impact:** SOP-08 §4.24 (print the status card first, uncheck everything). **G-56**.

### F-08-7 · CONFIRMED · WEAKNESS · S4 — The station time clock has no handbook gate
- **Pin:** `clockByPinAction` (`src/app/admin/staffing/actions.ts` L55–80) checks only `timeclock.use`, the PIN throttle and `getEmployeeByPin`; it does not call `registerGateForEmployee` (the register does, `pos/unlock/route.ts` L79–96).
- **Effect:** small. Clocking in is not selling, and the back office is gated for sign-ins (`admin/layout.tsx` L67–83). It is recorded for completeness; the SOP-08 interim rule (no PIN until form 8.1) covers it. Not cited in the SOP text.
- **SOP impact:** none beyond §4.13. No gap of its own (folded into G-52 if the PIN is locked until Activate).

### F-08-8 · CONFIRMED · GAP · S2 — No visitor log or visitor badges
- **Pin:** no table, page or action for visitors anywhere in `src/` or `supabase/migrations/`; only a monthly calendar reminder exists. WAC 314-55-083(1)(a)–(d) requires a visitor badge for non-employee visitors in non-public areas and a log (name, badge number, arrival and departure time, purpose) kept three years.
- **Effect:** a WAC record the store must keep has no home in the app.
- **SOP impact:** SOP-08 §4.12, §4.19, forms 8.2 and 8.5 (paper log at the back door). **G-57** (Q-08-3).

### F-08-9 · CONFIRMED · WEAKNESS · S4 — Invite default role differs between screen and server; role descriptions are incomplete
- **Pin:** `users/page.tsx` L134 selects **staff** by default; `users/actions.ts` `inviteUser` L181–250 falls back to **readonly** (L185) if the field is missing. Role descriptions (`roles.ts` L14–19) do not list every permission (for example Budtender / Staff also has `timeclock.use` and Cycle Counts).
- **Effect:** small; the screen always sends a role. The descriptions under-describe access, so least-privilege choices are made on partial information.
- **SOP impact:** SOP-08 §4.16 (role table), form 8.4. **G-58**.

### F-08-10 · CONFIRMED · WEAKNESS · S4 — Job-role changes are audited without the old and new values
- **Pin:** `src/app/admin/staffing/actions.ts` L193–199 records `employee.updated` with no before/after; job role decides safe-swap approval (`till/route.ts` L56, L205: manager/lead).
- **Effect:** who was made a lead (and so a safe-swap approver), and when, cannot be read from the audit log.
- **SOP impact:** SOP-08 §4.17, form 8.4. **G-58**.

### F-08-C · CONFIRMED · STRENGTH — What already works well
- **Pin:** role guard rails for change and invite (self, rank, ceiling, last owner) in `user-guards-core.ts` L43–115; deactivation locks the back office on the next request (`session.ts` L169) **and** bans the sign-in (`users/actions.ts` L143–153); access changes audited and shown on the Users page (L270–285); PINs stored as scrypt hashes, active employees only (`store.ts` L117–146), with a 5-tries/60-s lockout (`pin-throttle-core.ts` L29–31); Terminate requires a date and reason and clears the PIN (`employee-lifecycle-store.ts` L516–527); sensitive document numbers scrubbed (L127–139); the back-office handbook gate re-prompts on a version change (`admin/layout.tsx` L67–83); the I-9 Section 2 / background-check order rules (`employee-lifecycle-core.ts` L85, L108, L407–416).
- **SOP impact:** SOP-08 §7 "What the app already does well".

---

## Ledger index (updated each slice)

| SOP slice | Findings | Confirmed | Suspected |
|---|---|---|---|
| SOP-00 recon | 15 | 13 → 15 (F-00-12, F-00-13 confirmed in SOP-01) | 2 → 0 |
| SOP-01 Register Operations | 16 (15 new + F-01-16 re-verify of F-00-1) | 16 | 0 |
| SOP-02 Master Till / Store Safe | 13 new (1×S1, 6×S2, 6×S3) + re-confirmed F-00-7, F-00-8. **F-02-2 withdrawn** in SOP-03 (D19) → 12 standing | 13 (12 standing, 1 withdrawn) | 0 |
| SOP-03 End-of-Day Close & Deposit Bag | 11 new (2×S1, 4×S2, 5×S3) + re-confirmed F-00-3, F-00-6, F-00-8 | 11 | 0 |
| SOP-04 Receiving Intake & Monthly CCRS PRR | 21 new (F-04-1…F-04-20 + F-04-C; 1×S1, 3×S2, 14×S3, 3×S4). F-03-4 SOP-01 half fixed in docs. **SOP-05a update (D29–D34):** F-04-1 S2 → **S1**; F-04-18 narrowed (S3 → S4); owner decisions noted on F-04-15/16/19 → now 2×S1, 2×S2, 13×S3, 4×S4 | 21 | 0 |
| SOP-05a Inventory Core | 17 new (F-05a-1…F-05a-16 + F-05a-C; 2×S1, 7×S2, 5×S3, 3×S4). F-04-2 carried (lot page Lifecycle status). **v1.1 (D36–D40):** F-05a-11 S3 → **S1** (D38); 3 new F-05a-17 (S2), F-05a-18 (**S1**), F-05a-19 (S2) → 20 findings: 4×S1, 9×S2, 4×S3, 3×S4 | 20 | 0 |
| SOP-05b Non-Cannabis, Merch, Publish, Categories, Classification & Sell Price | 14 new (F-05b-1…F-05b-13 + F-05b-C; 2×S1, 6×S2, 4×S3, 2×S4). **Fix slice (D44–D49):** 3 new: F-05a-20 (S2), F-05b-14 (S3), F-05b-15 (S2) | 17 | 0 |
| SOP-06 Inventory Audits, Cycle Counts & Daily Checklists | 16 new (F-06-1…F-06-14, F-06-5b, F-06-C; 4×S1 (F-06-1, F-06-5b, F-06-7, F-06-13), 6×S2, 5×S3, 1×S4). F-00-9 re-verified (F-06-12). **v1.1 (D54–D61):** 3 new F-06-15 (S2), F-06-16 (S3), F-06-17 (S2) → 19 | 19 | 0 |
| SOP-15 Returns to Vendor, Customer-Return Disposition & Destruction | 18 new (F-15-1…F-15-17 + F-15-C; 2×S1 (F-15-1, F-15-6), 9×S2, 4×S3, 3×S4). F-05a-17…19 carried (F-15-9 extends F-05a-19). **v1.1 (D63–D68):** 4 new F-15-18 (S3), F-15-19 (S2), F-15-20 (**S1**), F-15-21 (S3) → 22: 3×S1, 10×S2, 6×S3, 3×S4 | 22 | 0 |
| SOP-08 New Hire Onboarding, System Access & Offboarding | 11 new (F-08-1…F-08-10 + F-08-C; 1×S1 (F-08-1 new hires created Active, gate bypassed), 4×S2 (F-08-2, F-08-3, F-08-4, F-08-8), 2×S3, 3×S4) | 11 | 0 |
