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
- **Reality:** the register exists. `src/app/pos/RegisterShell.tsx` (5,949 lines), `SaleFlow.tsx` (6,198 lines), 23 `/api/pos/*` routes, and a Capacitor iOS build (`register-app/`, `ios/`).
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

### F-00-12 · SUSPECTED · HARDEN · S2 — Drawer state transitions are read-then-act (no compare-and-swap)
- **Pin:** `store.ts` `closeDrawerBlind` L212–227: reads the session, checks `status !== "open"`, then `.update(...).eq("id", …)` with **no** `.eq("status","open")` guard. The same shape appears in `reconcileDrawer` (L266–287) and `verifyTill` (L305–332).
- A double-tap or a retried request could close twice or verify twice (the second write overwrites `closing_count_minor`). AGENTS.md rule 12 explicitly calls read-then-act "NOT a lock".
- `closeDrawerBlind` L245 and `verifyTill` L324 insert into `drawer_counts` and **ignore the returned error**: the session can say "closed" while the denomination record is missing.
- To verify in SOP-01 (does the register UI debounce? does `/api/pos/till` carry an idempotency key?).

### F-00-13 · SUSPECTED · HARDEN · S2 — Reconcile "cash sales" is a hand-typed number
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

---

## Ledger index (updated each slice)

| SOP slice | Findings | Confirmed | Suspected |
|---|---|---|---|
| SOP-00 recon | 15 | 13 | 2 |
