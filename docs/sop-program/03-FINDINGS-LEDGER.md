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
- **Pin:** `src/lib/admin/concierge-kb.ts` L476–489 (`id: "pos"`, `planned: true`), plus `src/lib/admin/concierge-assistant.ts` prompt line *"If it's about the POS, note it's planned-not-built first."*
- **Reality:** the register exists. `src/app/(site)/pos/RegisterShell.tsx` (5,949 lines), `SaleFlow.tsx` (6,198 lines), 23 `/api/pos/*` routes, and a Capacitor iOS build (`register-app/`, `ios/`).
- **Effect:** an employee who asks the concierge "how do I close my till?" is told the register does not exist. This is the single biggest knowledge gap in the concierge.

### F-00-2 · CONFIRMED · DOC · S3 — The concierge KB is small and does not read the help that already exists
- **Pin:** `concierge-kb.ts` has **33 topics**. `registers` has **2 facts**, `time-clock` has 2, `samples` has 2, `promotions` has 2. The grounding prompt (`concierge-assistant.ts` L66–74) includes **only** `setupGroundingBlock()` + `conciergeGroundingBlock()`.
- **Not fed to the concierge:** `help-content.ts` (34 sections, 1,098 lines), `page-helpers-core.ts` (19 helpers), `sop-core.ts` (10 SOP sheets), `handbook-content.ts`, and 104 page-level `<HelpPanel>`s.
- **Effect:** the help content already exists, but the global helper cannot see it. See `04-CONCIERGE-COVERAGE-LEDGER.md`.

### F-00-3 · CONFIRMED · BUG · S2 — Morning "Verify till" records no recount and no verifier identity
- **Pin:** `src/app/admin/registers/page.tsx` L256–268. The form posts only `session_id`, a free-text `verified_by` ("Manager name") and an `agrees` checkbox. It has **no denomination inputs.**
- `src/app/admin/registers/actions.ts` L149: `parseDenoms(...)` therefore reads all zeros, so `verifyTill()` (`src/lib/registers/store.ts` L311–312) stores `verified_count_minor = 0` and `variance_minor = 0 − closing_count`. The variance always equals the negative of the close, even when "Count agrees" is ticked.
- `verified_by` is `uuid references employees(id)` (`supabase/migrations/0038_registers_drawers.sql` L152), but it receives typed text such as "Mike". **Suspected** outcome: the insert fails (Postgres invalid-uuid error) and the action redirects with an error, so the morning verify may never succeed at all. Must be proven in SOP-01 against the live schema.
- **Owner requirement affected:** *"the morning employee recounts and verifies the amount."*

### F-00-4 · CONFIRMED · BUG · S2 — Same free-text-into-uuid pattern on Reconcile
- **Pin:** `src/app/admin/registers/page.tsx` L235–238 `name="reconciled_by" placeholder="Manager name"` → `store.ts` L285 `reconciled_by: opts.reconciledBy` → column `uuid references employees(id)` (`0038` L84).
- **Suspected** effect: reconcile fails whenever a name is typed, and "succeeds" only when the box is left blank, which records no reconciler. The safe count does this correctly with a `<Select>` of employees (`registers/safe/page.tsx` L165), which proves the right pattern already exists in the codebase.

### F-00-5 · CONFIRMED · GAP · S1 — No second-person sign-off on a till count
- **Owner requirement:** *"requires a second person to count the till and sign off on the accuracy of the count."*
- **Reality:** a second-PIN witness exists **only on mid-shift drops** (`src/lib/pos/till-core.ts` `TillDropRequest.witnessPin`, optional; `/api/pos/till/route.ts` L139–150). **Open** and **close** take one PIN only (`TillOpenRequest`, `TillCloseRequest`). The back-office verify (F-00-3) is not PIN-attested and is not enforced. Nothing stops a till from being closed and reconciled by one person.

### F-00-6 · CONFIRMED · GAP · S1 — No deposit-bag screen (seal, morning verify, into safe, to bank)
- **Owner requirement:** *"end of day spreadsheet that one person completes before close, and the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe."*
- **Reality:** the `deposit_bags` table (`supabase/migrations/0212_deposit_bags.sql`) and the pure builders (`src/lib/accounting/safe-bag-core.ts`) exist and are tested. The owner memo `MICHAEL-books-98-the-store-safe.md` states plainly: *"no screen calls them yet — you cannot seal a bag from the app today."* `grep deposit_bags src/app` returns 0 hits.
- `/admin/registers/eod` shows **Undeposited Funds by day** (`UndepositedFunds.tsx`), which says "each line should be one sealed deposit bag". That is a mirror of the books, not a bag workflow.

### F-00-7 · CONFIRMED · GAP · S2 — The master-till "little safe ↔ master" exchange is not modelled
- **Owner requirement:** *"balance the master till using small bills from the little safe in exchange for big bills from the master … count twice a day."*
- **Reality:** one safe is modelled: `safe-core.ts` "the $1,000 master change fund", `SAFE_TARGET_MINOR = 100_000`, windows `am | pm | other` (the twice-daily count **does** exist at `/admin/registers/safe`). Register↔safe **swaps** exist (`TillSwapRequest`, manager/lead approver PIN). No second store of value ("little safe") exists in schema or code. `grep -i "little safe\|small safe"` returns 0 hits.
- **Needs an owner decision:** is the "little safe" a physical box whose balance we track, or just a source of change with no tracked balance? (See Open Question Q3 in `02-SOP-CATALOG-AND-ROADMAP.md`.)

### F-00-8 · CONFIRMED · GAP · S2 — Safe-count (master till) sheet has no print or export; EOD and till summary print only, with no export
- **Pin:** `registers/safe/page.tsx`: no `PrintButton`, no CSV route. `registers/eod/page.tsx` L74 and `registers/history/[id]/page.tsx` L80 have `PrintButton` (window.print) but no CSV/XLSX route.
- **Owner requirement:** shift and day reports *"exported and printed"*. Master till *"exportable and printable"*.
- `exceljs` and `xlsx` are already dependencies. CSV-route precedents exist (`inventory/cycle-counts/[id]/export/route.ts`, `reports/compliance/export/route.ts`).

### F-00-9 · CONFIRMED · GAP · S3 — No cleaning schedule or daily-task checklist feature exists
- `grep -i "cleaning|dusting|sanitiz"` over `src` finds only unrelated text (data "cleaning", promotions). Checklists exist only for HR onboarding/offboarding (`employee-lifecycle-core.ts`) and payroll mentors.
- Cycle counts **do** exist as an owner-initiated queue (`/admin/inventory/cycle-counts`, books-23: owner creates the audit, staff do the blind count). A *daily task checklist* that surfaces them does not.
- The SOP can ship as paper first (a printable checklist). A digital sign-off checklist is a build decision.

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
- **Pin:** `registers/page.tsx` L226–233 has a manager-typed `cash_sales` input. `actions.ts` L26–30 has a local `dollarsToMinor` that strips everything except digits, "." and "-", returns **0** on bad input, and accepts negatives. The pure `till-core.ts dollarsToMinor` already returns `null` on invalid input.
- Expected-close and over/short therefore depend on a manager typing the right figure, even though the register records every sale (`pos_sale_events`, `day-report-core.ts`). A blank field = $0 cash sales = a large false "over".
- To verify in SOP-01: is there a reason the system figure is not prefilled (for example, sales across sessions on a shared register)?

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
- A reconcile run twice re-posts nothing new: `postDrawerCloseForSession` returns `duplicate` (`src/lib/registers/drawer-posting-service.ts` L116–117). But the second run **overwrites** `expected_close_minor` / `over_short_minor` with the second typed figure. **The books then keep the first figure while the drawer record shows the second**, a silent books ↔ register disagreement.
- The register UI blocks double taps (`busy` state in TillModal), and `/api/pos/till` carries **no idempotency key**. The back-office forms have no pending state.
- Confirms and supersedes F-00-12.

### F-01-3 · CONFIRMED · BUG · S3 — Reconcile card shows "expected $0.00" before reconcile
- **Pin:** `src/app/admin/registers/page.tsx` L211–212 prints `formatCents(a.expectedCloseMinor)`. `expected_close_minor` is written **only** by `reconcileDrawer` (`store.ts` L282). `formatCents(null)` returns `$0.00` (`src/lib/registers/cash.ts` L91–92).
- **Effect:** every Reconcile card reads "counted $X vs expected $0.00". This is misleading, and it undercuts the blind-count design, because a manager may think the drawer is massively over.

### F-01-4 · CONFIRMED · HARDEN · S1 — Reconcile cash sales is hand-typed, with no per-drawer refunds and no per-drawer sales figure
- **Pin:** `registers/page.tsx` L226–233 (`cash_sales` input, `min="0"`), `actions.ts` L115 (local `dollarsToMinor`, blank → 0). The day report (`src/lib/pos/day-report-core.ts`; `/api/pos/day-report` filters `register_id`, L104/L119) is **per register per business day**, not per drawer session. Voids and returns carry no register attribution (*"Voids/returns are not tied to one register — count them against the drawer that paid."*).
- **Effect:** expected close and over/short depend entirely on a manager's arithmetic. A register with two drawers in one day has no system figure for either drawer. A blank field shows a large false "over". Over/short then posts to the books (`postDrawerCloseForSession`).
- **Interim:** SOP-01 §4.27 step 9 (X report at each mid-day close) and §4.30 (paper formula). Confirms and extends F-00-13.

### F-01-5 · CONFIRMED (code path) · BUG · S2 — Free-text names posted into uuid columns at reconcile and verify
- **Pin:** `registers/page.tsx` L237 `reconciled_by` / L260 `verified_by` (`placeholder="Manager name"`) → `actions.ts` L116 / L150 → `store.ts` L285 / L316 → columns `uuid references public.employees(id)` (`0038` L84, L152).
- Postgres rejects non-uuid text for a uuid column (`22P02 invalid input syntax for type uuid`). The SOP therefore instructs "leave blank, sign the paper slip". Proof against production is still owed (no live DB access in this slice). Also, `reconcileDrawerAction` audits `session.userId` (the back-office login), so identity is captured in the audit log even when the column is blank.
- Same root as F-00-3/F-00-4. Recorded here because SOP-01 now carries a workaround that depends on it.

### F-01-6 · CONFIRMED · HARDEN · S2 — Done-screen "Print receipt" opens the drawer on every tap, with no audit
- **Pin:** `src/app/(site)/pos/SaleFlow.tsx` L1580 `{ html, openDrawer: true, jobKind: "sale" }`. The button stays live (*"Tap again to reprint"*, L1634). By contrast, MORE → Reprint last receipt and the history reprint never kick the drawer.
- **Effect:** after a sale, any number of extra drawer openings are possible without a No-sale record, a reason or a manager PIN. This bypasses the No-sale control (§4.21).

### F-01-7 · CONFIRMED · UX · S3 — The drawer opens only by printing a receipt
- **Pin:** same as F-01-6. There is no "open drawer without printing" path for a completed sale except No sale (manager PIN). A customer who declines a receipt still gets one printed. If the printer is down, the drawer cannot open (*"… The drawer did not open — use No Sale if you need it."*), and No sale also prints, so it fails too.
- Paper waste plus a printer-down dead end. The SOP covers it with "print anyway / drawer key".

### F-01-8 · CONFIRMED · GAP · S2 — Change swaps record value only, not denominations (owner D3)
- **Pin:** `src/lib/pos/till-core.ts` `TillSwapRequest` (L61–74) and its validator (L210–232) carry `amountMinor`, `approverPin` and `notes`. There are no denomination fields. The owner (D3): *"I just want to know when big bills leave the master till and go into the little safe. And what the small bills and coin are that came out of the little safe."*
- **Interim:** SOP-01 form 8.3 plus Notes. Related to F-00-7 (the little safe is not modelled).

### F-01-9 · CONFIRMED · GAP · S1 — No second-person count at close (owner D2)
- **Pin:** `till-core.ts` `TillCloseRequest` has a single `pin` (L48–58). `RegisterShell.tsx` TillModal close has no second PIN field. Owner D2: second-person count **at close only**, by **any** second employee.
- **Interim:** SOP-01 close slip 8.2/8.4. Narrows F-00-5 to the close step per D2.

### F-01-10 · CONFIRMED · GAP · S3 — No per-shift / per-cashier report
- **Pin:** `/api/pos/day-report` is scoped by `auth.device.register_id` and business day (L58, L104, L119). Cart adjustments are tracked per employee (`pos_cart_adjustments`), but there is no printable per-cashier shift summary of sales, voids, no-sales, discounts given or adjustments.
- Owner SOP-00 request: shift reports *"exported and printed"*. Ties to F-00-8.

### F-01-11 · CONFIRMED · GAP · S2 — No $5 over/short warning screen or required reason (owner D7)
- **Pin:** `reconcileDrawerAction` (`actions.ts` L109–141) redirects with an `overShortLabel` banner only. There is no threshold, no reason field and no admin list. `grep -ri "over_short_reason\|overShortReason" src supabase` → 0 hits.
- Owner D7: *"$5. It should be an admin only screen placed in the most logical place… Just warnings for now. Who, when, how much, their reason for why it's over/ under (should be required to be input for over/ under)."*
- **Interim:** SOP-01 form 8.5. Suggested home (for the build discussion, not decided): a **Register Activity → Over/short warnings** section, or a tab gated `settings.manage`/owner-admin.

### F-01-12 · CONFIRMED · HARDEN · S2 — Verify is allowed on a drawer that was never reconciled
- **Pin:** `store.ts` `verifyTill` L307 accepts `status === "closed"` **or** `"reconciled"`, then sets `status = "verified"` (L332). `reconcileDrawer` L268 requires `status === "closed"`. A drawer verified straight from "closed" can therefore never be reconciled. Its over/short is never computed, and `postDrawerCloseForSession` never runs for it.
- The UI shows Verify only for reconciled sessions (`oversight.ts` L357–372), so this is reachable only by a crafted form post or by a race with a stale page. It is still a missing state-machine guard.

### F-01-13 · CONFIRMED · GAP · S3 — No standard float target for register drawers
- **Pin:** `till-core.ts` L13: *"the total IS the float"*. `openDrawer` stores whatever was counted. There is no configured float amount, and nothing warns when a count-in differs from the standard (the safe has `SAFE_TARGET_MINOR`; registers have nothing similar).
- **Effect:** a short float at open is invisible until reconcile, and then it reads as a drawer shortage that belongs to the wrong person. SOP-01 §4.3 says "tell a manager before ringing".

### F-01-14 · CONFIRMED · BUG · S1 — Medical test mode can complete a real sale with tax removed and no exemption record
- **Pin:** `src/lib/pos/medical-testmode-core.ts` flips `bundle.medical.endorsed = true` on the device only. The register then prices medical lines tax-exempt. At sync, `src/lib/orders/completion-gate.ts` L166–182 builds the exemption plan with the **real** `medSettings.medicallyEndorsed`. With the store unendorsed, `claimedLineCount = 0`, so **no** WAC 314-55-090(2) exempt-sale rows are written (L214), and the gate does **not** refuse. `sync-store.ts` stores the device's `sale.taxMinor` (L866) and does not recompute tax.
- **Effect:** a carded sale rung with test mode left on completes with tax under-collected and no exemption ledger. This is a tax liability (WAC 314-55-090(3): unrecorded exemptions are presumed incorrect). The banner is the only guard.
- Upgraded from SUSPECTED during the slice after tracing the full path.

### F-01-15 · CONFIRMED · HARDEN · S3 — Cash drop witness is optional
- **Pin:** `till-core.ts` L195 (`witnessPin` optional), UI *"Witness PIN (optional, second person)"* (`RegisterShell.tsx` L5779). Drops are the highest-value cash movement during a shift. The SOP sets "always get a witness when someone else is on the floor" as store practice.

### F-01-16 · CONFIRMED · DOC · S2 — The concierge still says the POS is planned (re-confirmed)
- `src/lib/admin/concierge-kb.ts` L479 `planned: true` is unchanged at `d03fe15b`. SOP-01 content is now the source for fixing it (see `04-CONCIERGE-COVERAGE-LEDGER.md`). Same item as F-00-1. It is listed here only so the slice index counts it as re-verified. **Not a new defect.**

---

## SOP-02 Master Till / Store Safe findings (audited at `0055f06c`, 2026-10-27)

Owner decisions referenced: D3 (little safe), D7 ($5), D10 (three tills at $167.50), D11 (master till mix), D12 (page for the two daily counts), D13 (pin everything). See `00-OWNER-REQUEST-VERBATIM.md`.
**D12 verdict: MET.** The twice-daily count page exists at `/admin/registers/safe` (AM / PM / Extra). Documented in SOP-02 §4.3–4.7; not a gap.
Status updates: **F-00-7** re-confirmed (still no little-safe model; `grep -rni "little safe\|small safe" src supabase` → 0 hits). **F-00-8** re-confirmed for the safe page (no `PrintButton`, no export route under `src/app/admin/registers/safe/`).

### F-02-1 · CONFIRMED · BUG · S1 — Cash drops are never posted; 10110 Tills keeps every dropped dollar for good
- **Pin:** `register-cash-journal-core.ts` `buildTillCloseJournal` L235–345. With `floatStaysInDrawer: true` (passed by `drawer-posting-service.ts` L190–193), `removedMinor = counted − float` (L275–277). The till is relieved by `removedMinor − overShort` (L307–310). Drops are used only to work out *expected* (L270). They are never moved out of 10110 or into 10100.
- **No other poster:** `grep -rn drawer_drops src/lib/accounting` returns only `factory-reset-core.ts` L426. `recordDrop` (`src/lib/registers/store.ts` L171–190) inserts a row and posts nothing. `ledger-census-data.ts` has no drop event (`grep -i drop` → 0 hits).
- **Proof by running the real builder** (`sop02/drops.ts`, run with tsx at `0055f06c`): $167.50 float, $500.00 cash sales, a $200.00 drop, counted $467.50 → lines `10100 +30000 "Cash from Register 1 to safe"`, `10110 −30000`. Each sale debits 10110 (`sale-journal-core.ts` L106, L415–417), so 10110 got +$500.00 and lost $300.00. **$200.00 stays in 10110 with no entry**, and 10100 Vault is $200.00 low. The builder self-test (L860–872) checks only "not short" and "balances", not the 10110 net. The tests repeat the gap.
- **Effect:** 10110 "Cash on Hand — Tills" goes up by the day's total drops, every day, forever. That is the same shape as the D-39 "drawers hold more money every day" problem the close posting was built to fix. 10100 Vault and later 10400 Undeposited Funds (bag seal) come up short by the same amount. The bank match (D-77 notes) works from a pool that never had the drop cash in it.
- **SOP impact:** none for staff. Recorded in SOP-02 §4.12 for the owner and bookkeeper.

### F-02-2 · WITHDRAWN (D19, slice SOP-03) · was BUG · S2 — Manager Till standard float is $300.00; the owner says $167.50
- **Withdrawn after the owner's correction (D19):** *"And I was wrong, it should be 300 in it."* The code's $300.00 Manager Till float matches the owner. The entry below is kept as history (IDs are never renumbered). The misleading code comment stays open under **F-02-9**. The EOD worked example that still uses 3 × $167.50 is a new finding in SOP-03 (**F-03-2**).
- **Owner (D10):** *"there are three tills, two sales and one manager register. They are the ones with 167.5 in them."*
- **Pin:** `0038_registers_drawers.sql` L177–184 seed `('Manager Till', 'manager_till', 30000, 30)`, with the comment *"Manager Till float $300 (30000)"*. `0077_drawer_counts_extra_denoms.sql` L40–46 updates `where kind = 'sales'` only: *"the shared Manager Till float is left as-is (owner has not specified a change)"*. No later migration touches `default_float_minor` (`grep -l default_float supabase/migrations` → 0038, 0077 only). No UI edits it (`grep -rn default_float_minor src` → read-only, `oversight.ts` L318, `store.ts` L18).
- **Effect:** back-office **Open drawer** for the Manager Till says *"Standard float for this register is $300.00"*, and the grid shows a correct $167.50 count as **Short by $132.50** (`RegisterControls.tsx` L63–75).
- **Comment also wrong:** `drawer-posting-service.ts` L190–191 says *"migration 0077 pins every register's default float at 16750"*. It pins only the two sales registers.
- **Not verified:** the live database value (no production access in this slice). The owner can run `select name, default_float_minor from registers;`.

### F-02-3 · CONFIRMED · GAP · S2 — No master till denomination standard; the mix is saved but never shown or checked
- **Owner (D11):** the master till is *"32 tens, 64 fives, 318 ones, 95 quarters, 120 dimes, 100 nickels, and 125 pennies"*.
- **Pin:** `validateSafeCount` (`safe-core.ts` L64–96) compares the **total** only, against `SAFE_TARGET_MINOR` (L26). The 13 denomination columns are stored (`0135` L37–50) but the **Recent counts** table shows only Total/Target/Variance (`safe/page.tsx` L192–233). The EOD reads only `count_window, total_minor, variance_minor` (`eod-store.ts` L126–129).
- The owner's mix **is** in the code, but only as a worked example: `SPECIMEN_MASTER_COUNTS` (`register-cash-specimen-core.ts` L43–46), which is shown in the EOD specimen panel and is not used by the safe page.
- **Effect:** 10 × $20 + 12 × $10 + the standard rest = $1,000.00 → **"Balanced"** (script-checked, `sop02/calc2.py`). The registers can run out of change while the page says all is well.
- The $1,000 target is a code constant, with no setting (minor; recorded here so nobody looks for a setting).
- **Interim:** SOP-02 form 8.1 mix columns. Gap **G-08**.

### F-02-4 · CONFIRMED · HARDEN · S2 — Who counted is optional and unverified; the audit row is not linked to the count
- **Pin:** **Counted by** defaults to **— none —** (`safe/page.tsx` L165–166). The action sends `counted_by || null` (`safe/actions.ts` L31) and `recordSafeCount` inserts it as given (`safe-store.ts` L82). No PIN, no second counter. Any manager-level login can name any active employee. The audit `safe.counted` stores the login, window and variance, with `entityId: null` (`safe/actions.ts` L38–45), so the audit row cannot be tied to the `safe_counts` row except by time.
- **Contrast:** a register swap checks a manager/lead PIN on the server (`till/route.ts` L186–211), and a drop can take a witness PIN. The master till, which the owner calls *"the one to watch"* (books-98 L64), has the weakest attribution of any cash movement.
- **Effect:** with an open count (by design, `safe-core.ts` L7–10), a named, verified counter is the main control. Today it is optional.
- **Interim:** SOP-02 §4.5 step 10. Always pick the counter; note who entered it.

### F-02-5 · CONFIRMED · HARDEN · S2 — Several AM/PM counts per day are allowed; the EOD shows only the newest; the window defaults to AM; no double-submit guard
- **Pin:** no unique `(business_day, count_window)`. Only plain indexes (`0135` L65–66). `safeStatus` uses `.some(...)` (`safe-store.ts` L178–179). `eod-core.ts` L182–183 takes `find(...)` on newest-first rows, so it shows the **latest** AM and PM. The select starts at `defaultValue="am"` (`safe/page.tsx` L157) at every time of day. The submit button has no pending/disabled state, and a server action re-post saves a second row.
- **Effect:** (a) a PM count saved by mistake as AM leaves today's PM **Not yet**, while the AM card already said Done; (b) a bad count can be pushed off the EOD report by saving another one; (c) a double tap saves two counts. All earlier counts stay in **Recent counts**, so nothing is lost, but the official daily record can be chosen after the fact.
- **Interim:** SOP-02 §4.6 (change the window), §4.17 (corrections as Extra, never overwrite).

### F-02-6 · CONFIRMED · GAP · S2 — No variance threshold, no reason, and no books posting for master till variances
- **Pin:** `safe-core.ts` has no threshold. Notes are optional (L79–82). `recordSafeCount` posts no journal (`safe-store.ts` L62–93). `grep -rn "safe_counts" src/lib/accounting` → only `factory-reset-core.ts`. Drawer over/short posts to 50920 at reconcile (`buildTillCloseJournal` L313–326); a master till short posts nothing, so 10100 Vault keeps the old figure.
- **Owner D7** set $5 + a required reason for drawer over/short. Whether it covers the master till is **Q-02-3**.
- **Update (D16, slice SOP-03):** the owner confirmed D7 **applies to the master till as well**. This finding is now a confirmed owner requirement (gap G-03).
- **Interim:** SOP-02 §4.8 (reason for any variance; form 8.5 over $5). Extends gap **G-03**.

### F-02-7 · CONFIRMED · DOC/UX · S2 — One "safe" in code, three places in the store; the page's help says to count drops with the change fund
- **Owner:** *"three tills, one master till, and a store safe"* (quoted in `safe-bag-core.ts` L17), plus a **little safe** (original request; D3).
- **Code:** one "safe" = *"the $1,000 master change fund"* (`safe-core.ts` L1–5); `VAULT_ACCOUNT` 10100 = *"The safe / master till"* (`register-cash-journal-core.ts` L70); close takings also post *"to safe"* into the same 10100 (L302). The page is titled **Store safe** (`safe/page.tsx` L75).
- **Help and placeholder pin:** HelpPanel L97–100: *"Cash drops … appear on the drawer session, not here. If the safe drifts off target, drops waiting to be banked are the usual reason — note it and bank the overage."* Notes placeholder L177: *"e.g. two drops waiting to be banked"*. Both tell a counter to accept drop cash as master till "over", which is the opposite of the owner's three-place model.
- **Effect:** confused counts (false Over), and a books account (10100) that mixes the change fund and the takings, so the PM count can never be checked against 10100.
- **Interim:** SOP-02 §1 terms, §4.3 warning, §4.12.

### F-02-8 · CONFIRMED · DOC · S3 — SOP-01 form 8.3 mixes up two different exchanges (self-finding)
- **Pin:** `docs/sop/SOP-01-register-operations.md` L1106–1112. Form 8.3 is titled *"Change-swap denomination log (D3: master till ↔ little safe)"*, but its columns are for **register** swaps (*"Register/till … Matches register 'Record swap'?"*). A register swap is till ↔ change fund; a D3 balance is master till ↔ little safe.
- **Fix in the SOP program:** SOP-02 splits them into form 8.2 (master till ↔ little safe) and form 8.3 (register ↔ master till). SOP-01 is to point to SOP-02 at its next revision. Not edited in this slice (one SOP per slice).

### F-02-9 · CONFIRMED · DOC · S3 — Stale code comments about posting and floats
- `register-cash-journal-core.ts` L50–52: *"nothing calls `submitJournal` with them yet: closing a shift still does not post. That is D-39"*. That is stale: `reconcileDrawerAction` → `postDrawerCloseForSession` → `submitJournal` (`src/app/admin/registers/actions.ts` L124; `drawer-posting-service.ts` L218; census `till_close_to_safe` reachable = PRESENT, `ledger-census-data.ts` L1471–1478). The same stale claim is in `docs/MICHAEL-books-93-register-cash.md` L58 (*"Nothing posts yet"*). That is a dated memo, so it stays as history.
- `drawer-posting-service.ts` L190–191 says the float is *"16750"* for every register (see F-02-2).
- `docs/MICHAEL-books-93` L26 says the close debits *10400*, which D-77 (books-98) changed to 10100. That is history; the code is right.

### F-02-10 · CONFIRMED · UX · S3 — The Safe button is shown to staff logins, who are then denied
- **Pin:** `registers/page.tsx` L87–89 renders **Safe** with no permission check. Register Activity needs `orders.manage`, which includes `staff` (`roles.ts` L90). The safe page needs `inventory.manage` (owner/admin/manager, L106), so staff are redirected to `/admin?denied=1` (`session.ts` L184). The same pattern applies to **End-of-day report** (L96–97; `eod/page.tsx` L45).

- **Update (D15, slice SOP-03):** the owner wants **any employee** to count *and record* the master count. So staff being refused the safe page is now against an owner decision, not just a UX issue. Gap **G-13**.

### F-02-11 · CONFIRMED · GAP · S3 — Supply runs from the master till cannot be recorded
- **Pin:** `buildSupplyAdvanceJournal` / `buildSupplySettleJournal` (`register-cash-journal-core.ts` L501–646) are built and tested; the census marks them *reachable: MISSING — "No screen records a supply run yet"* (`ledger-census-data.ts` L1660–1665).
- **Owner policy since books-99:** supplies go on the shop card, not master till cash (`card-payment-core.ts` L7–8). Severity S3 because the policy covers it. If a run ever happens, nothing in the app records it, and the next count is simply "short".
- **Interim:** SOP-02 §4.13, form 8.4. Gap **G-11**. **Update (D17, slice SOP-03):** the owner wants the screen built; G-11 is approved and queued for build.

### F-02-12 · CONFIRMED · DOC · S3 — The concierge and the help library know nothing about the master till
- **Pin:** `grep -n -i "safe\|master till" src/lib/admin/concierge-kb.ts` → only unrelated uses ("safely", "am I safe?", equipment "safes"). `help-content.ts` `registers` topic (L227–262) has no safe or master till item. The page HelpPanel (F-02-7) is the only in-app help, and it contradicts the owner's model.
- See `04-CONCIERGE-COVERAGE-LEDGER.md` SOP-02 slice log.

### F-02-13 · CONFIRMED · GAP · S3 — Count and swap history is capped at 30 with no date filter
- **Pin:** `listSafeCounts(30)` and `listSwaps(30)` (`safe/page.tsx` L61–62; `safe-store.ts` L126–150). There is no paging, date picker or per-day view. At two counts a day, the page shows about 15 days of counts. Older counts exist in the database but can be reached only through Supabase. Ties to G-09 (print/export).

---

## SOP-03 End-of-Day Close & Deposit Bag findings (audited at `3385bfa9`, 2026-10-27)

Owner decisions referenced: D2 (second person at close), D7 ($5 / reason), D10, D14–D20. The owner's request quoted in SOP-03 §1: *"End of day spreadsheet that one person completes before close, and the morning employee recounts and verifies the amount before sealing the bag and putting it into the safe for depositing to the bank."*
**Verdict: NOT MET in the app.** The End-of-day report (`/admin/registers/eod`) prints the day. But the deposit figure, the morning recount, the bag, the seal and the bank clearing do not exist or cannot be reached. SOP-03 is a paper procedure (night sheet, bag log, bank-run checklist).
Status updates: **F-00-6** re-confirmed (no deposit-bag screen; `grep -rn "deposit_bags" src/app` → 0 hits). **F-00-8** re-confirmed for the EOD page (prints via `PrintButton`; no export route under `src/app/admin/registers/eod/`). **F-00-3** still stands (manager-till verify records $0, SOP-02).

### F-03-1 · CONFIRMED · BUG · S1 — 10400 Undeposited Funds is never filled, so the books panel gives a false "all matched"
- **Pin:** since D-77 (`docs/DEFECTS.md` L4138), the drawer close debits **10100 Vault**, not 10400 (`register-cash-journal-core.ts` L294–303, self-test L807–813). The only builder that debits 10400 is `buildSealBagJournal` (L405–441). It has **no poster** (`ledger-census-data.ts` L1585 `poster: null`; reachable MISSING L1596–1600).
- **Effect:** 10400 stays at $0.00 (or at any pre-D-77 residue), so the Undeposited Funds panel shows its green *"Every dollar … matched"* message while bags sit in the safe. The panel text *"A drawer close moves cash into it"* (`UndepositedFunds.tsx` L82–84) is stale.
- **Also stale:** the header comments in `UndepositedFunds.tsx` L11–12, `deposit-clearing-service.ts` L12/L22–23, `deposit-clearing-core.ts` L9–12/L129 and `drawer-posting-service.ts` L27 all still describe the close as filling 10400.
- **SOP impact:** SOP-03 §4.15 tells staff and the owner not to use the panel and to use the bag log plus the safe instead. Ties to G-14.

### F-03-2 · CONFIRMED · DOC · S3 — EOD worked example still uses 3 × $167.50 = $1,502.50 floats
- **Pin:** `register-cash-specimen-core.ts` L49 `SPECIMEN_TILL_COUNT = 3`; its self-test asserts `150_250` (L136). `RegisterCashSpecimen.tsx` L128 *"Each drawer (x3)"*, L132–137. Census text `ledger-census-data.ts` L1449 and the owner-quote history in `safe-bag-core.ts` L18–20 also carry the three-till figure.
- **Owner (D19):** the Manager Till holds $300.00, so the floats total **$635.00** ($1,635.00 including the master till).
- **SOP impact:** SOP-03 §4.9 labels the panel a teaching example with an out-of-date float total.

### F-03-3 · CONFIRMED · GAP + DOC · S1 — Bank-deposit clearing has no caller; the census says it is reachable
- **Pin:** `clearDepositForBankRow` (`deposit-clearing-service.ts` L237+) is called only by `tests/compliance/deposit-clearing.test.ts`. `grep -rn clearDepositForBankRow src` → only its definition and the census strings. The bank page's `actions.ts` exports only `recordBankExpensesAction`.
- **Census:** `cash_deposit_to_bank` (`ledger-census-data.ts` L1519–1575) marks *exists* and *reachable* **PRESENT**. Its exists evidence (*"books-93 built the first leg - the drawer count into 10400"*) is stale after D-77.
- **Even if wired:** it would refuse every deposit with DEPOSIT_NOTHING_UNDEPOSITED (`deposit-clearing-core.ts` L396–402), because of F-03-1.
- **SOP impact:** SOP-03 §4.13 makes the bag log plus the bank receipts the till-to-bank trail. Ties to G-14.

### F-03-4 · CONFIRMED · DOC · S3 — SOP-01 §4.29 says the float goes back to the master till / safe (self-finding)
- **Pin:** `docs/sop/SOP-01-register-operations.md` §4.29 (≈L749–757): *"the float for tomorrow goes back to the master till / safe"*. The code keeps the float in the drawer (`floatStaysInDrawer: true`, `drawer-posting-service.ts` L193; `register-cash-journal-core.ts` L275). SOP-03 §4.4 (the float stays in the till) follows the code and the owner.
- **Also stale:** the Registers page help (`src/app/admin/registers/page.tsx` L117–120) says sales shown are *"online pickup order sales … the only transaction records in this back office"*. That is out of date now that the register records in-store sales (`sale-event-core.ts` L15–33).
- **Fix later:** correct SOP-01 §4.29 at its next revision (docs only; recorded here first per the program rule).
- **Status (slice SOP-04):** the SOP-01 half is **FIXED IN DOCS** (SOP-01 v1.1 §4.29: the float stays in the drawer). It is a documentation correction of the program's own SOP, not a code change. The Registers page help text (`page.tsx` L117–120) is code and stays **OPEN**.

### F-03-5 · CONFIRMED · GAP · S2 — EOD print has one signature and no deposit figure, bag # or denominations
- **Pin:** `src/app/admin/registers/eod/page.tsx` L248–258. Only *"Prepared by (signature)"* and *"Date / time"*. The table shows Opening / Drops / Closed count, but not takings-to-bag. There is no morning-verify line, no bag number and no denomination grid.
- **Owner:** *"one person completes before close, and the morning employee recounts and verifies"*. Two people, two counts.
- **SOP impact:** night sheet form 8.1 parts A/B/C. Ties to G-15.

### F-03-6 · CONFIRMED · GAP · S2 — EOD report omits refunds; "Gross" is not cash
- **Pin:** `src/lib/registers/eod-store.ts` does not query voids or returns. The Z report does (`day-report-core.ts` L136–175, L265–280: *"REFUNDS — STORE-WIDE CASH OUT"*).
- **Effect:** a manager reading EOD "Gross" as the cash to expect will be over by the refunds paid out.
- **SOP impact:** SOP-03 §4.8 says to use the Z report for cash. Ties to G-15.

### F-03-7 · CONFIRMED · HARDEN · S3 — EOD store ignores read errors
- **Pin:** `eod-store.ts`:
  - The register/session reads (L86–89), the drop read (L100–107) and the event read (L112–120) never check `error`. A failed read renders as *"No drawer sessions on this business day."* or as zeros.
  - The safe_counts/safe_swaps reads treat any error other than a missing table as "Not done" (L131–132, L144–145).
- **SOP impact:** SOP-03 §6 says: if you know drawers were used, reload, then tell the owner and use the close slips.

### F-03-8 · CONFIRMED · UX · S3 — No date picker; a malformed `?day=` silently shows today
- **Pin:** `src/app/admin/registers/eod/page.tsx` L15–19 `normalizeDay`: anything not `YYYY-MM-DD` falls back to `pacificToday()` with no message. There is no date control on the page, so a past day is reachable only by editing the address.
- **SOP impact:** SOP-03 §4.8 documents `?day=YYYY-MM-DD`. Ties to G-15.

### F-03-9 · CONFIRMED · HARDEN · S2 — deposit_bags lets any staff login rewrite any bag (for when it is built)
- **Pin:** `0212_deposit_bags.sql` L150–163. The `<t>_staff_write` policy is `for all using (is_staff()) with check (is_staff())` on `deposit_bags` and `deposit_bag_sessions`, so status and `amount_minor` can be changed directly via the API. There is no immutability trigger after `sealed`/`deposited`, and `updated_at` (L83) has no trigger. `pulled_by`/`counted_by` are deliberately not forced to differ (L68–73).
- **Not reachable today** (no screen, F-00-6). It is recorded so the G-04 build closes it: sealed bags should be append-only, and changes should go through a server action with an audit row.

### F-03-10 · CONFIRMED · GAP · S2 — Bag lifecycle, close-block and $10k shape check are built but never called
- **Pin:** `safe-bag-core.ts`: lifecycle transitions, `blockCloseForUndeclaredBags` (L212–226), `checkDepositShape` (L305–328) and `validateBagAmount` have no callers outside the file, its tests (`safe-bag.test` 18 cases) and `buildSealBagJournal` (itself unreachable). `grep -rn "checkDepositShape\|blockCloseForUndeclaredBags" src` → `safe-bag-core.ts` only.
- **Effect:** the cash-deposit policy's near-$10k / structuring warning (`bank-match-core.ts` L1587 CTR_THRESHOLD_CENTS, L1594 STRUCTURING_NEAR_MISS_CENTS; `CASH_DEPOSIT_POLICY_DECISION.md` L66–73) is never shown at bag time.
- **SOP impact:** SOP-03 §4.14, the $10k rule on paper and the bag log's **Note** column. Ties to G-04 / G-14.

### F-03-11 · CONFIRMED · DOC · S3 — Help and concierge have no end-of-day or deposit-bag content
- **Pin:** `grep -n -i "deposit\|end.of.day\|eod" src/lib/admin/help-content.ts src/lib/admin/concierge-kb.ts` → only payroll **direct deposit** (`help-content.ts` L725–742; `concierge-kb.ts` L262–280).
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
- **Pin:** `src/app/admin/inventory/[id]/page.tsx` L130–136 (STATUSES include `active`), form L1497–1512 → `setLotStatusAction` (`src/app/admin/inventory/actions.ts` L142–155) → `updateLotStatus` (`src/lib/inventory/store.ts` L836–851). It writes any status. There is no `evaluateLotActivation` call and no `recordAudit`.
- **Guard miss:** `scripts/compliance/check-activation-gate.ts` L60–100 greps only for the literal `status: "active"`, so a status passed in a variable escapes it. The intake comment (`intake/actions.ts` L195–198) says Finalize is the only activation path.
- **Effect:** a manager can make a lot with no COA, or a FAILED result, sellable, and nothing records who did it. `issues-core.ts` L553 directs staff to this box for now-clear held lots.
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
- **Pin:** `src/lib/admin/issues-core.ts` L570. The lot page has **Attach a lab result** (S37 LotCoaAttach; `inventory/[id]/page.tsx` L763; `inventory/actions.ts` L268–303, audit `inventory_lot.coa_linked`).
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
- **Pin:** Lifecycle status → `setLotStatusAction` (`src/app/admin/inventory/actions.ts` L142–155) → `updateLotStatus` (`src/lib/inventory/store.ts` L836–851) writes the status only: no quantity change, no adjustment row, no audit. The weekly CCRS Inventory file reads lots `.neq("status","destroyed")` (`src/lib/compliance/ccrs-batch.ts` L1209–1217) and re-reads destroyed lots only when an event row in the same batch names them (`readDestroyedLots`, L380–411). The proper path sets Destroyed only when the destruction empties the lot (`src/lib/inventory/disposition.ts` L1087–1094).
- **Effect:** a lot destroyed by hand silently leaves Greenway's state filing while CCRS still holds its last quantity. No Destruction adjustment is filed and no waste record exists.
- **SOP impact:** SOP-05a §4.9 ("Never Destroyed by hand"), header box, §9 card. Ties to **G-22**.

### F-05a-2 · CONFIRMED · HARDEN · S1 — A recall hold (status Recalled) is placed and released with no audit row, no reason and no role limit
- **Pin:** **Recalled** is set only through the same blind Lifecycle status write (`actions.ts` L142–155 → `store.ts` L836–851). The register hold keys on it (`src/lib/pos/recall-hold-core.ts` L44, L53–63). Any `inventory.manage` login (owner, admin, manager; `roles.ts` L106) can set or clear it.
- **Effect:** a statutory sale stop (WAC 314-55-225) can be lifted by any manager with no record of who, when or why. Rated S1 with F-04-2 because it is a control over a regulated sale stop (license integrity).
- **SOP impact:** §4.8, §4.10: form 8.1 for every change; only the owner releases, on written clearance. Ties to **G-22** (extends G-19).

### F-05a-3 · CONFIRMED · HARDEN · S2 — Manual adjustment is read-then-write, has no zero floor, never sets Sold out and writes no audit row
- **Pin:** `createAdjustment` (`store.ts` L578–616) reads `on_hand_qty` (L587–591) and writes current + delta (L603–608). It does not use the atomic `applyLotDelta` (`atomic-quantity.ts`, GW-012) that sales, voids, counts and disposition use, and has no `next < 0` check and no `sold_out` flip (the atomic path does that, L44). The action has no `recordAudit` (`actions.ts` L111–140). The adjustment row itself carries `actor_id` (L594–600).
- **Effect:** a sale at the same moment can be lost; on-hand can go negative; a lot at zero stays Active.
- **SOP impact:** §4.6 (count twice, quiet times, check On hand after, form 8.2). Ties to **G-23**.

### F-05a-4 · CONFIRMED · BUG/UX · S2 — "Other" and "Employee sample" adjustments with no note are withheld by CCRS (E13), and the form does not warn
- **Pin:** both map to CCRS **Other** (`ccrs-inventory-adjustment-core.ts` L62–93), which requires a detail (`ccrs-preflight-core.ts` L271; withheld at build L201–212). The lot page note is labelled *"Optional detail for the audit trail…"* (`[id]/page.tsx` L1489).
- **SOP impact:** §4.6 step 3, §4.7: always a note; required for these two. Ties to **G-23**.

### F-05a-5 · CONFIRMED · HARDEN · S2 — "Destruction" and "Recall removal" are offered as manual adjustment reasons
- **Pin:** lot page REASONS L118–128; both export as CCRS Destruction (`ccrs-inventory-adjustment-core.ts` L66–67, L80–81). They bypass the SOP-15 disposition flow, including its recall block (`disposition-core.ts` L226–243: no destruction until LCB coordination is confirmed and the officer named). The Issues tab's expired-lot fix text points to it (*"…or record the destruction under Adjust quantity"*, `issues-core.ts` L461).
- **SOP impact:** §4.7 "Never"; §4.16 "do not use the row's suggestion". Ties to **G-23**; owner question **Q-05a-4**.

### F-05a-6 · CONFIRMED · GAP · S3 — No Theft or Seizure adjustment reason
- **Pin:** CCRS supports Theft and Seizure (`ccrs-inventory-adjustment-core.ts` L91–94); the form's list (lot page L118–128; `VALID_REASONS`, `actions.ts` L89–101) has neither.
- **SOP impact:** §4.7: theft or seizure goes to the owner (SOP-20); interim **Other** with "THEFT:" / "SEIZURE:" note. Ties to **G-23**.

### F-05a-7 · CONFIRMED · HARDEN · S2 — "Receive (add)" adds units that CCRS never hears about
- **Pin:** `isReportableAdjustment` skips it (`ccrs-inventory-adjustment-core.ts` L101–105). Stock should enter only through Receiving (SOP-04; Rule 11).
- **Effect:** units appear on Greenway's books with no CCRS adjustment and no manifest. (S2: a control bypass of the one-way-in rule; S3 if the owner treats it as a rare correction.)
- **SOP impact:** §4.7 "Never". Ties to **G-23**; **Q-05a-4**.

### F-05a-8 · CONFIRMED · GAP · S2 — Expired lots are not blocked or warned at the register; sales draw FIFO, not FEFO; the Issues text states a rule the code says WA lacks
- **Pin:** no expiry read in `completion-gate.ts`, `api/pos/menu/route.ts` or the sale decrement (grep). Sale lot order is oldest created first (`sale-lot-read.ts` L39–47). FEFO exists only as advice (`inventory-intel-core.ts` L13, L124, L532). Issues says *"Expired product may not be sold."* (`issues-core.ts` L388, L460) while `expiry-rules-core.ts` L32–34 says WA does not require a date (WAC 314-55-105(8) "best by" optional).
- **SOP impact:** §4.16: daily pull and quarantine until **Q-05a-1** is answered. Ties to **G-24**.

### F-05a-9 · CONFIRMED · UX/HARDEN · S3 — The register "86" does not stick while the books show stock
- **Pin:** `/api/pos/stock-flag` sets the card unavailable and audits `pos.stock_flag` (`route.ts` L28–102). On every menu download `reconcileRegisterAvailability` restores any unavailable card with Active units (`register-availability-core.ts` L318–421, message L389; called `api/pos/menu/route.ts` L240). The register prompt says *"a manager brings it back through the back office when stock returns"* (`SaleFlow.tsx` L4279–4280). The name on the audit row is client-supplied (`route.ts` L48–52).
- **SOP impact:** §4.12: the manager investigates every 86 the same shift. Ties to **G-26**; **Q-05a-5**.

### F-05a-10 · CONFIRMED · UX · S3 — The lot label is linked only from the manifest page, and its fallback barcode does not scan
- **Pin:** the only link is on `intake/[id]/page.tsx` L1072–1078; the lot page has none (grep `/label` in `[id]/page.tsx`). The barcode is `lot_code || pos_product_key || id` (`lots/[id]/label/page.tsx` L38–40); the register indexes only lot code and CCRS id (`scan-to-cart-core.ts` L55–70).
- **SOP impact:** §4.19: reach it through the Manifest link; scan before use. Ties to **G-26**.

### F-05a-11 · CONFIRMED · HARDEN · **S1** (re-rated from S3 by owner decision D38) — Bulk fill lets anyone with Inventory access type a cannabis unit cost
- **Pin:** `bulkFillAction` is `inventory.manage` (`actions.ts` L904) and accepts `unit_cost_minor_units` (`bulk-fill-core.ts` L318–325). `roles.ts` L143–148: *"Cannabis cost entry is NOT built"*; `inventory.cost.fill` is owner + admin. The fill is blank-only, migration-lot-only and audited (`inventory_lot.bulk_filled`, `actions.ts` L975–996), which limits the risk.
- **Owner decision D38** (Q-05a-3): *"absolutely not. That's illegal. Cost comes from the state CCRS manifest created by the vendor."* Cannabis cost comes only from the manifest (`intake-parser.ts` L415–420) and is locked on the lot page (`lot-edit-core.ts` L38). Bulk fill is the one place it can be typed (`bulk-fill-core.ts` L54).
- **SOP impact:** SOP-05a v1.1 §4.20: nobody uses Bulk fill → Unit cost. Fixed by **G-27** (APPROVED).

### F-05a-12 · CONFIRMED · DOC · S4 — Inventory help panel is stale
- **Pin:** `inventory/page.tsx` L465 *"Vendor JSON intake (next slice)…"* (intake shipped; SOP-04); L464 lists "destructions" as an adjustment (contradicts SOP-15); `SopSheetLink slug="publish"` L473 points at the pre-R31 sheet (F-04-5).
- **SOP impact:** §4.2 note: follow the SOP where they differ.

### F-05a-13 · CONFIRMED · UX · S4 — Adjustment history shows the browser's date and no name
- **Pin:** `new Date(a.created_at).toLocaleDateString()` (`[id]/page.tsx` L1539): browser time zone, not Pacific. `actor_id` is stored (`store.ts` L594–600) but not shown.
- **SOP impact:** §4.5; form 8.2 is the readable record.

### F-05a-14 · CONFIRMED · UX · S4 — The "Needs attention" card counts expiring-soon lots but does not turn orange for them
- **Pin:** value includes `expiringSoon`; the accent sum omits it (`inventory/page.tsx` L524–536).
- **SOP impact:** §4.2 table note.

### F-05a-15 · CONFIRMED · GAP · S2 — No recall plan, recall coordinator or recall log in the app (WAC 314-55-225(3)(d) makes the plan mandatory)
- **Pin:** grep `recall plan|recall coordinator` → only `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` L136. The law (read 2026-10-27, app.leg.wa.gov): (3)(d)(i)(A)–(D) coordinator, identify/isolate, retrieve/destroy, communications; (3)(f) weekly progress tracking.
- **SOP impact:** §4.13, forms 8.4 (the plan) and 8.5 (event worksheet). Ties to **G-25**. Q-05a-2 answered (D37): the admin is the coordinator, no back-up.

### F-05a-16 · CONFIRMED · GAP · S2 — A recall hold does not reach the website or online ordering
- **Pin:** the public menu filters only hidden cards (`src/lib/pos/live-menu.ts` L167–171, L289–292); online order pricing skips only hidden cards (`src/lib/orders/order-pricing.ts` L124–134). `recalledProductKeys` (`recall-hold-store.ts` L72–121) has four callers only: `api/pos/menu/route.ts` L121, `completion-gate.ts` L103, `restore-to-sale-store.ts` L131, `register-sellability-store.ts` L175.
- **Effect:** a recalled product stays visible on the website and can be reserved; the sale is refused only when staff complete the pickup (completion gate, fail-closed). WAC 314-55-225(3)(b)(i) requires preventing distribution.
- **SOP impact:** §4.10 step 5: set **Always hide** on Product Enrichment (audited `product.visibility_changed`). Ties to **G-25** (propagation requirement).

### F-05a-17 · CONFIRMED · GAP · S2 — Returns & Destruction lists only Active lots
- **Pin:** `src/app/admin/inventory/disposition/page.tsx` L103: `listLots({ status: "active", limit: 500 })` feeds the destruction form. Lots in **Quarantine** or **Recalled**, the ones most likely to be destroyed, cannot be chosen.
- **Effect:** staff are pushed to set a held lot Active to destroy it, which puts it back on sale in the meantime (and for a Recalled lot, lifts the hold).
- **SOP impact:** SOP-05a v1.1 §4.9 interim. Fixed by **G-28**. Found while answering the owner's Q-05a-4 question about the Destructions page.

### F-05a-18 · CONFIRMED · BUG · S1 — Scheduling a destruction overwrites Recalled with Quarantine and lifts the recall hold
- **Pin:** `scheduleDestruction` (`src/lib/inventory/disposition.ts` L939–997) writes `status: "quarantine"` at L965–971 whatever the lot's status was (unless `quarantineLot === false`, used only for a single customer-returned unit, L716–723). The register recall hold reads only `recalled` (`src/lib/pos/recall-hold-core.ts` L44); quarantine does not hold (`completion-gate.ts` L98–100).
- **Effect:** once a recalled lot is scheduled, nothing in the app shows it was recalled, and other lots of that product stop being held if it was the only Recalled lot. WAC 314-55-225(3)(b)(i) requires isolating recalled product.
- **SOP impact:** SOP-05a v1.1 §4.9 point 3, §4.10 step 9, form 8.4 (C): recalled lots are not scheduled in the app until **G-28**.

### F-05a-19 · CONFIRMED · BUG · S2 — Cancelling a destruction always sets the lot Active
- **Pin:** `cancelDestruction` (`disposition.ts` L1100–1116) sets `status: "active"` at L1113–1114, with the comment *"Release quarantine back to active (best effort)."*; it does not remember the earlier status.
- **Effect:** a cancelled destruction of an expired, damaged or (if F-05a-17 is worked around) recalled lot returns it to sale with no check.
- **SOP impact:** SOP-05a v1.1 §4.9 point 1, §6. Fixed by **G-28**.

### F-05a-C · CONFIRMED · DOC · S3 — Concierge inventory topic has six one-line facts and nothing on recalls, expiry, adjustments, the 86 or labels
- **Pin:** `src/lib/admin/concierge-kb.ts` `inventory` topic L163–180: six facts (lots and COAs, Other Inventory, Vendors & Brands, Types & Categories, Cycle Counts, Returns & Destruction). grep `recall|expir` in the file → none. Baseline ledger row "Inventory management 🟡" (`04-CONCIERGE-COVERAGE-LEDGER.md` §3).
- **SOP impact:** recorded in the concierge ledger (SOP-05a slice); grounding from SOP-05a §4, §5, §8, §9 in Phase D.

---

## SOP-05b Non-Cannabis, Merch, Publish, Categories, Classification & Sell Price findings (audited at `main@827facb5`, 2026-10-27)

Owner sources: D35 (the 05a / 05b split) and D43 (*"Please finish the inventory management sop."*) in `00-OWNER-REQUEST-VERBATIM.md`; D38 (cannabis cost only from the vendor's CCRS manifest); D41 (living SOPs); D42 (the concierge covers every feature).
**Verdict: PARTLY MET, with two S1 gaps.** Publish Menu, the Merch page, sales-limit classification and the cannabis sell-price floor are careful and audited. Other Inventory is a good catalog, but it is **not connected to the register**. And nothing stops a category change from turning cannabis into non-cannabis for tax, limits and scan.

### F-05b-1 · CONFIRMED · GAP · S1 — Other Inventory is not connected to the register
- **Pin:** the register menu is built from `menu_items` only (`src/lib/pos/live-menu.ts` L155–157; `src/app/api/pos/menu/route.ts` L179, L405–415). Scan-to-cart matches only menu barcodes and lot codes (`scan-to-cart-core.ts` L55–75, L101–144). The sale decrement touches cannabis lots only (`src/lib/inventory/sale-decrement.ts` L107–110). Yet the intake form promises the barcode *"becomes the register code"* (`NonCannabisIntakeForm.tsx` L122–124), and the label page, help panel, `help-content.ts` L470–472 and `concierge-kb.ts` L172 imply scanning works (label page L7–8; `noncannabis/page.tsx` L230–240).
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
- **SOP impact:** §2, §4.3 step 5, §4.6, §4.9 (form 8.2, owner only). Fixed by **G-30**.

### F-05b-7 · CONFIRMED · BUG · S2 — A failed invoice save rolls back only the header
- **Pin:** `invoice-store.ts` L124–128 (header delete on failure), L135–158 (drafts and restock adjustments already written, not undone).
- **Effect:** after a failed save, there are orphan drafts and extra stock on file; a retry doubles them.
- **SOP impact:** §4.6 "If the save fails part-way". **G-32**.

### F-05b-8 · CONFIRMED · HARDEN · S3 — The invoice audit row is fire-and-forget
- **Pin:** `noncannabis/actions.ts` L296–307: `recordAudit(...).catch(() => {})`.
- **Effect:** a saved invoice (a payable source document) can have no audit row, and nobody is told.
- **SOP impact:** §6. **G-32**.

### F-05b-9 · CONFIRMED · BUG/HARDEN · S1 — A category change can turn cannabis into non-cannabis for tax, limits and scan
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
- **SOP impact:** §2, §4.21 (owner only), form 8.2. **G-32** (Q-05b-5).

### F-05b-13 · CONFIRMED · HARDEN · S3 — A classification lot-row write failure is visible only in the audit row
- **Pin:** `inventory/actions.ts` L1105–1145: `lot_row_write_failed` goes into the audit `after`; the user is redirected `?saved=1` (L1156).
- **Effect:** the worklist (which reads the lot row) can keep showing the product as unclassified while the register enforces the new answer.
- **SOP impact:** §4.19 step 6. **G-32**.

### F-05b-C · CONFIRMED · DOC · S3 — The concierge has one line on Other Inventory and nothing on merch, publish, categories, classification or sell price
- **Pin:** `src/lib/admin/concierge-kb.ts` `inventory` topic L163–180 (one Other Inventory line, L172, which repeats the scan promise of F-05b-1; one Types & Categories line).
- **SOP impact:** concierge ledger SOP-05b section; grounding from SOP-05b §4–§9 in Phase D (D42).

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
| SOP-05b Non-Cannabis, Merch, Publish, Categories, Classification & Sell Price | 14 new (F-05b-1…F-05b-13 + F-05b-C; 2×S1, 6×S2, 4×S3, 2×S4) | 14 | 0 |
