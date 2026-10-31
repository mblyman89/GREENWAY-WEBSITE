# ACCOUNTING BIBLE — 14 · OWNER ANSWERS AND EXPERT RESOLUTIONS (round 2, 2026-10-31)

> **Audience: Michael and me.** Plain English first, then the pins I need to build it.
> Every answer below is recorded verbatim in part 05 (OD-22 … OD-39). This part explains what each answer **means**. Where you asked me to decide, it gives my decision as a CPA/CFO would make it, and **why**.
> Docs only. No application code was changed in this round (OD-39).
> Sources are in part 13 §R2.

---

## 0. The new shape of the project, in one page

**What changed.** You moved the books' go-live from 11/01/2026 to **1/1/2027** (OD-22, OD-24). That is the right call, for four reasons:

1. **Clean year.** An income statement that starts on January 1 needs no Jan–Oct carry-in line. The 40300/current-year-earnings question (old Q-02c) disappears: everything before 2027 is in retained earnings, as of Sage's 12/31/2026 close.
2. **Payroll.** W-2 wages, FUTA/SUTA wage bases, WA PFML and WA Cares all reset on 1/1. Starting payroll mid-year means importing year-to-date wage totals per employee and per tax. Starting on 1/1 means importing none.
3. **One count does double duty.** The **year-end full count** (already built: full-count-core.ts, owner D58) becomes both the 2026 Sage closing inventory and the 2027 opening inventory. One count, one number, two uses. You no longer need the 11/01 cut-over inventory journal (old S-06).
4. **Time.** We get 61 days to build, test and rehearse with real November/December data flowing through the new system while Sage is still the official book.

**The three phases:**

| Phase | Dates | The official book | What the new system does |
|---|---|---|---|
| **P1 · Store live, books shadow** | 11/01/2026 → 12/31/2026 | **Sage 50** | POS, inventory, AP, payroll, bank feeds run for real as **sub-ledgers**. The GL is built and **rehearsed** on this real data in a sandbox posture: drafts and rehearsal journals only, never "the" numbers. Sage keeps receiving its exports (src/lib/accounting/sage-exports-core.ts, /admin/reports/accounting/sage-export). |
| **P2 · Year-end and opening balances** | 12/31/2026 → mid-Jan 2027 | Sage closes 2026 | Year-end full count. Sage year-end close (Sage's Year-End Wizard runs its Internal Accounting Review first). Export Sage's 12/31 trial balance per entity. Load it into the OB worksheet, count-valued inventory replaces Sage's inventory line, bless. |
| **P3 · Books live** | 1/1/2027 → | **Greenway platform** | Every feeder posts. January closes by about 2/25. Sage becomes read-only history. |

**The quality bar (OD-22a).** "Better than QuickBooks, like Sage." Concretely, part 15 builds the Sage 50 Quantum / Sage Intacct features that matter to a one-owner multi-entity cannabis retailer:

- period lock;
- a full audit trail (already strong: immutability trigger 0172:524, gapless numbering);
- an **Internal Accounting Review** (Sage runs 15 automated checks before year-end; we build ours, block G);
- a guided **year-end wizard**;
- memorized/recurring transactions (our posting templates);
- bank reconciliation;
- AP/AR aging;
- 140-report parity on the statements that matter;
- role security (owner-only books, OD-03);
- multi-company (4 entities + intercompany);
- **adjustment books** (Intacct's "user-defined books", OD-34).

Things Sage has that we deliberately do not build are listed in part 15 §Z.

---

## Q-01 · Cash events (drawer, seal bag, deposit, supply run): template or drafts? → OD-23, "option A"

**Means:** each recurring cash event posts automatically because you pre-approved its **shape** once. This is Sage's "memorized transaction" idea with controls on top: a ceiling, a tolerance and (from Q-15) an account allow-list.

**Built in:** 15 A-03 (template rows) + A-04 (allow-list). Rows ship `is_active=false` until you approve each one on the template screen. The approval is your signature (OD-04: self-approval is allowed for you, and it is logged).

**One thing to note:** with go-live on 1/1/2027, the November–December cash events are **rehearsal**. They prove the templates on real data, and then the rehearsal journals are wiped before the OB is loaded (15 I-01).

---

## Q-02 · Opening balances → OD-24

**Means:**

- OB date = **12/31/2026**.
- Cut-over = **1/1/2027**.
- Source = Sage 50's **post-closing** 12/31/2026 trial balance for each entity that has books:
  - greenway;
  - ATM (Lyman's Enterprises);
  - landholding;
  - personal, if you want personal books at all (decided at I-02; my recommendation is yes, but only balance-sheet lines: bank, loans to/from the entities, basis).

**What the system already supports:**

- `gl_conversion_config` (0186) is a one-row table you are allowed to **update**.
- Its CHECKs force OB date = cut-over − 1 day and parallel-start = cut-over.
- `gl_opening_balance_date()` (0186:175) and `gl_cutover_date()` (:183) read it live.
- The 2026-01-01 "line in the sand" (0172:309-314) allows 2026-12-31.
- **So the date move is a config UPDATE plus three TypeScript constants** (cutover-core.ts:66, :73, :76-77; the stale "2025-12-31" at ledger-core.ts:166 too). This is slice A-01.

**Parallel run (my decision).** The old plan ran Sage alongside us for Nov–Dec. Now Sage is the book for Nov–Dec, and **we** shadow **it** (P1). For 2027 I set the parallel window to **January 2027 only**: you keep Sage open for January and key only the bank totals and the monthly summary. At the January close we prove our TB = Sage's for the same month (slice I-05). After that, Sage is retired. Not keying January into Sage at all is acceptable too, if time is short. Rehearsing on Nov–Dec real data already gives most of that proof. The config row stores whichever you choose (`parallel_run_end` 2027-01-31, or = start).

---

## Q-03 · Fractional / gram lots → OD-25 ("we only have end products, prepackaged")

**Plain English:** the question was "do you ever sell product by weight from a bulk jar?" Your answer is no. Every lot is a sealed, labelled, whole unit, and the vendor did the weighing in CCRS. So the system never has to multiply "cost per gram × grams", and the question **goes away**.

**The one proof I still run** is a read-only query that counts lots with a non-whole quantity (part 12 **U-22**). If it returns 0, Q-03 is closed forever. If it returns anything, it is a data-entry slip on a lot (e.g. "2.5 units"). It gets fixed on the inventory side, not in accounting.

---

## Q-04 · Inventory inside the OB worksheet or a separate journal? → OD-26 (you asked me to decide)

**Plain English:** on 12/31 your balance sheet has a line "Inventory $X".

- Q-04 asked whether $X goes in **the same opening entry** as cash, payables, loans etc., or in **its own** entry.
- **My decision: the same opening entry (the OB worksheet), one per entity.** One opening entry that balances is what an auditor expects. A separate inventory journal creates a window where the books are out of balance, or need a temporary plug.

**Where $X comes from:**

- It comes from the **year-end full count** valued at **lot cost** (each lot's unit cost × units counted; OD-15 makes sure every lot has a cost, and samples are $0 on purpose).
- It does **not** come from Sage's inventory balance.
- If Sage's 12/31 inventory differs from the count value, the difference is a **2026** adjustment you book in Sage before closing it (shrink, Dr COGS / Cr Inventory), so Sage's closing TB and our opening TB agree.
- This is 26 CFR 1.471-2(d): book inventory must be verified by physical count.
- Built in 15 I-03 (valuation) + I-04 (worksheet line with `evidence_kind 'inventory_count'`, 0176:77-83).

**Per-category detail (OD-13):** the OB inventory line is split across the 21 category accounts (200xx) using `audit-posting-accounts.ts`'s category map. The count already knows each lot's category.

**OD-08 status:** you said in books-73 "we are not ready to migrate inventory over yet." The 1/1 plan answers it: inventory migrates **once**, from the year-end count. That releases OD-08 for that purpose only.

---

## Q-05 · Medical endorsement → OD-27 ("we have not gotten our medical endorsement yet") — ⚠ ACTION FOR TONIGHT

**Short answer:** yes, you can switch it off, but **not from a back-office screen today**. The setting that actually controls the register has no on/off button. There are **three** switches. Here they are, in order of danger.

| # | Switch | Where | What it controls | Has a button? | Current value |
|---|---|---|---|---|---|
| 1 | `medical_endorsement_config.is_medically_endorsed` | database table (0040:55-70) | **The register.** Read by src/lib/medical/store.ts `getMedTaxSettings` → /api/pos/menu (route.ts:148, `endorsed: medSettings.medicallyEndorsed`) → every register's menu bundle. When true and a budtender ticks "Medical patient (DOH recognition card)", the sale **drops sales tax and the 37% excise** on DOH-compliant products, and **18–20-year-olds with a card are allowed to buy** (medical-pos-core.ts:143-149). | **No.** /admin/medical only *shows* a badge. | Seeded **true** with the note "Greenway holds an LCB medical endorsement." (0040:68-70). If the row is missing, the code also assumes **true** (src/lib/medical/tax.ts:36). Needs checking: **U-21**. |
| 2 | Tax Settings checkbox "Store holds a DOH medical endorsement" | /admin/settings/tax (TaxSettingsForm.tsx) | Reports and Sage export tax math only (src/lib/reports/tax.ts:93, :198). | Yes | Unknown; uncheck it. |
| 3 | Register "MEDICAL TEST MODE" | Per device, register settings (medical-testmode-core.ts, RegisterShell.tsx:394-399) | Forces #1 on for **that device** for rehearsal; a loud "⚠️ MEDICAL TEST MODE" banner shows. | Yes | Must be **OFF** on every register. |

**Tonight, before you open (about 5 minutes):**

1. Open Supabase → SQL Editor. Run this **read-only** check first:

   ```sql
   select id, is_medically_endorsed, endorsement_number, notes, created_at, updated_at
   from public.medical_endorsement_config
   order by created_at desc;
   ```

   - Expected today: one row, `is_medically_endorsed = true`.
   - If it shows **zero rows**, tell me. Don't insert one by hand: the code treats "no row" as endorsed, and the fix is A-06.

2. Switch it off (this changes only that one flag and its note):

   ```sql
   update public.medical_endorsement_config
   set is_medically_endorsed = false,
       notes = 'NOT endorsed yet — owner 2026-10-31',
       updated_at = now();
   ```

3. Re-run the step-1 query. Expect `false` on every row.
4. On each register, while online, reload the menu (close and reopen the register app, or use its menu refresh). The menu bundle is cached for offline use, so a register that does not refresh keeps the old value until it does.
   - The /admin/medical page should now say **"Not endorsed — exemptions disabled"**.
   - On the register, ticking the medical box should take **nothing** off the price.
5. /admin/settings/tax → **uncheck** "Store holds a DOH medical endorsement" → Save.
6. On each register, open settings and confirm Medical Test Mode reads **OFF** and no "⚠️ MEDICAL TEST MODE" banner shows.
7. Tell staff: no medical sales until you say so.

**Why it is safe to run.** The UPDATE touches one config row. Every register re-checks this flag on the server when a sale syncs (sync-store.ts:614-623 refuses exempted sales from an unendorsed store), so after the flip a stale register cannot sneak an exemption through either.

**What I will build (15 A-06):**

- One owner toggle on /admin/medical that writes switch #1, with your name and date, and mirrors switch #2 (one authority, rule 25).
- The "no row ⇒ endorsed" default flips to **not endorsed**, so missing data can never drop tax.
- An endorsement number is required to turn it on.
- The comment that contradicts the seed is corrected.
- Effective-dating (rule 114): the day you get the endorsement, you switch it on from that date, and the excise return knows which days were endorsed.

**Accounting side:** with the flag false, the old N-09 problem (GL ignoring medical exemptions) has nothing to act on until you are endorsed. Slice B-02 stays in the plan, priority lowered, and must ship **before** the toggle is ever turned on.

---

## Q-06 · Payroll in COGS (§280E) → OD-28 ("follow those settings … warn … but I dont want it to block")

**Plain English:**

- Because of §280E, the IRS allows Greenway to subtract only **cost of goods sold**, not ordinary business expenses.
- Every dollar of wages that counts as COGS is a dollar that reduces tax. Every dollar that doesn't is not deductible.
- Your employee records already carry a COGS role and a percentage: `employee_pay.labor_role_code` + `cogs_split_basis_points` (0195:381-387), set on the Employee Payroll Setup form ("Share of hours…").
- You want the books to **follow that percentage**, and to **explain the risk without stopping you**.

**What the system does today (three places that block):**

1. `payroll-posting-core.ts:387` refuses any partial split (PAYROLL_SPLIT_AMBIGUOUS) unless a `gl_payroll_allocations` row exists.
2. The database trigger `gl_payroll_allocation_guard` (0188:480-534) refuses:
   - selling labour → COGS;
   - allocations with no task detail;
   - allocations not tied to deliveries.
3. `payroll-cogs-core.ts` blocks an acquisition-labour share over 25% (ACQUISITION_LABOR_CEILING_MILLI_PCT = 25000, :1008; severity "block" at :1772) and refuses the producer role (:937).

**My resolution (slice D-06):**

- **The employee record becomes the authority (rule 25).** Each payroll run reads each employee's role and split, and builds the allocation automatically:
  - COGS share → 61000-series labour-in-COGS;
  - the rest → the 7xxxx wage expense.
  - You no longer type allocations by hand.
- **Every "block" above becomes a WARNING with a recorded acknowledgement:**
  - the screen says, in plain English, what the risk is and what evidence would support it;
  - you click "I understand — post it", with a one-line reason;
  - the reason, the evidence references and your name are stored, exactly like your OD-04 override log;
  - the database trigger is changed to accept an acknowledged allocation and refuse only an **unacknowledged** one. The posting core and the pure core change the same way, so the three layers can never disagree (rule 133).
- **The warnings it gives (from the data, not opinion):**
  1. Percent above 25% for purchasing/receiving roles.
  2. Any budtender/selling role in COGS (*Harborside*, 2021: selling activity is not inventoriable).
  3. No time records supporting the percent.
  4. Percent unchanged for 12+ months while duties changed.
  5. COGS labour rising while units received fall.
- **What still refuses, and why.** These are arithmetic or law, not judgement:
  - (a) the entry must balance;
  - (b) **your own** officer pay (role `owner_officer`, payroll-cogs-core.ts:957: wage expense, cost class `nondeductible_280e`, `neverInventoriable: true`) stays out of COGS. That is a reasonable-compensation and 280E double hit, and the flag exists for exactly this. *If you want even this to warn instead, say so and I will record it; my advice is to keep it.*
  - (c) a percent above 100% or below 0%.

**The honest risk, in one paragraph.** For a reseller (you buy finished goods and resell them), 26 CFR 1.471-3(b) defines inventory cost as invoice price less discounts, **plus transportation and other necessary charges in acquiring possession**. It has no "direct labour" line like a producer has. The Tax Court in *Harborside* (2021), *Alternative Health Care Advocates* (2018) and *Richmond Patients Group* (2020) disallowed labour and overhead for resellers, and the Ninth Circuit affirmed Harborside. Your position (receiving and inventory-handling labour as "necessary charges in acquiring possession") is **aggressive but arguable**. The best defence is contemporaneous evidence: time records by task, job descriptions, and a consistent percent. The warnings are designed to push you toward that evidence. The year-end report (D-07, Form 1125-A view) shows the tax at stake under the conservative and aggressive positions side by side, so you and your CPA see the dollars.

---

## Q-07 · Sales journals → OD-29, "option B": one daily summary

- One revenue journal and one COGS journal per entity per business day (America/Los_Angeles).
- Each journal line carries the order count, and the `orders` table stays the drill-down.
- Built in 15 B-01. It matches how LCB/DOR returns are filed and how the drawer closes. Sage users know it as "batch posting".

## Q-08 · 12300 Excise Receivable → OD-30, deferred

The account stays in the chart, unused. Part 10 B-07 keeps it. My guess at its original purpose: an excise overpayment LCB credits forward. If that ever happens, we will wire it then.

---

## Q-09 · Related-party money → OD-31 ("what would you do?")

**Plain English first: the two kinds of related-party money.**

- **Between you and Greenway** (an S-corporation you own 85% of). When you take money out, it is either:
  - a **distribution** (your share of profits, not taxed again), or
  - a **loan** to you (you owe it back, with interest).

  When you put money in, it is either a **contribution** (more ownership investment) or a **loan** to the company.
- **Between Greenway and the ATM company / Landholding** (separate businesses you also own). Money moving between them must look like money between strangers: rent, fees, loans with paperwork. That separation is **the reason they exist** (OD-11: "They exist solely to mitigate 280E"). If the IRS can show the money just sloshes around, it can argue the three are one cannabis business, and §280E then reaches the ATM and rental income too.

**What I would do: a hybrid. Conservative now, built to switch later.**

1. **You ↔ Greenway: option (b), contributions and distributions.** This is your intuition, and I agree with it.
   - It is simpler, needs no notes or interest, and matches how you actually behave (OD-12: "moving my money around as I please").
   - **One rule must be enforced:** an S-corp may have only one class of stock, so distributions must be **proportional** to ownership (85/5/5/5).
     - If you take $8,500, the other three shareholders are entitled to $500 each, whether they take it now or it is tracked as owed.
     - The single-class-of-stock regulation (26 CFR 1.1361-1(l)(2)) tolerates timing differences, but governing provisions that give unequal distribution rights break the S election. A pattern of only one shareholder being paid invites that argument.
     - So the books track each shareholder's **distributions-to-date vs entitlement** and warn you when you are ahead (slice H-02).
   - Where you truly want to borrow beyond your share, the tool books it as a **shareholder loan** with a note (option a), so it never breaks proportionality.
2. **Greenway ↔ ATM ↔ Landholding: option (a), documented demand notes.**
   - Each pair gets a simple written demand note: who lends, a demand (call-anytime) term, and interest at the IRS **Applicable Federal Rate** (short-term AFR, published monthly).
   - The system records each movement as a loan advance or repayment, accrues monthly interest, and shows the running balance. related-party-loan-core.ts already does the math; it is not wired yet (DC-07).
   - Rent from Landholding and fees from the ATM company go through their own journals, at arm's-length amounts.
   - This is what protects the separation that OD-11 relies on.
3. **Built to upgrade (your "when we're allowed to be a normal business").** Every related-party and every cost line carries two tags that already exist or are cheap to add:
   - a **classification** (loan / capital / distribution / intercompany-charge);
   - a **cost class** (inventoriable / selling / general; 0172's 280E cost classes).

   On top of that I add one **dated "tax regime" setting** (rule 114): `280E applies` today. If adult-use cannabis leaves Schedule I, or if you get your medical endorsement and medical sales are Schedule III (next paragraph), the setting changes **from a date forward**. The statements and the 1120-S support report then deduct the selling/general costs normally from that date, with no rebuild and no re-keying. History before that date keeps its 280E treatment.

**Where federal law stands today (sources in part 13 §R2):**

- **Medical:** DEA's final order moved **state-licensed medical marijuana** to Schedule III effective **2026-04-22** (Federal Register 2026-08176; Duane Morris 4/24/2026). §280E applies only to Schedule I/II trafficking, so §280E no longer reaches **medical** activity under a state medical licence. Commentators read the IRS as applying it from the tax year that includes the effective date (Foley Hoag 9/21/2026).
- **Adult-use:** still **Schedule I**. The DEA's administrative hearing on broader rescheduling ran 6/29–7/15/2026, and a decision is pending (Morgan Lewis 9/24/2026). The IRS's public position is that §280E still applies to adult-use sales.
- **For Greenway today:** you have no medical endorsement (Q-05), so **all** your sales are adult-use, and §280E applies in full. When you get the endorsement, the books will have to split costs between medical (deductible) and adult-use (not). The cost-class tags plus the regime setting are exactly what make that split a report, not a rebuild (H-05). Taking any non-280E position on a return needs your CPA's written opinion. The system will record that opinion's date and reference before the switch can be turned on.

---

## Q-10 · Inventory write-downs → OD-32 ("the professional expert enterprise grade method")

**What a CPA/CFO builds (slice D-04):**

1. **At every count (cycle or full), each discrepancy gets a reason code:**
   - expired;
   - damaged;
   - recalled/quarantined;
   - lost/stolen;
   - count error;
   - vendor return pending;
   - destroyed.

   The existing audit flow already captures counts and posts shrink (inventory-audit-post-core: Dr 60xxx COGS / Cr 200xx Inventory, as an owner-approved draft).
2. **Book treatment (accrual, when known):**
   - Missing units → **shrink**, Dr 60810 Inventory Shrink & Destruction / Cr the category inventory account, at lot cost.
   - Units present but **unsaleable** (expired, damaged, recalled) are moved to **quarantine** (20890) at count. They are written down to what you can actually get for them. For cannabis that is usually **$0**, because they can only be destroyed. Entry: Dr 60810 / Cr 20890, with the lot and reason on the line.
   - Product on hold that may still sell (e.g. a vendor-return credit expected) stays at cost in 20890 until resolved.
3. **Tax treatment (26 CFR 1.471-2(c)):**
   - The IRS allows the write-down of "subnormal" goods (damaged, unsaleable) to **bona fide selling price less direct cost of disposition**, but only if the goods are actually offered for sale (or disposed of) within **30 days** after the inventory date.
   - For product that **must** be destroyed, the deduction is safest **when destroyed with evidence**. destruction-evidence-core already records photo/video, witness and the CCRS destruction record.
   - So the system flags any quarantine write-down **without destruction evidence by year end** as a **tax add-back** (book ≠ tax) on the 1120-S support report (D-07).
4. **No general "reserve" for tax.** 1.471-2(f)(1) forbids a reserve for expected price drops or "estimated depreciation". 20810 Inventory Shrink/Waste Reserve stays a **book-only** monthly estimate, if you want one at all. My default: don't use it in year one, because actual counts monthly are better. If it is used, it is automatically an add-back on the tax report.
5. **Destruction itself posts no new expense.** It was already written down at count. Destruction is the **evidence event** that closes the quarantine lot and turns the tax add-back into a deduction. Today destruction posts nothing (ledger-census-data.ts:293); D-05 wires the evidence link.

---

## Q-11 · Use the new audits and cycle counts, including the year-end count → OD-33

**What already exists (reviewed):**

- `full-count-core.ts` is the year-end full count:
  - a count year (months ≥ 7 count toward that year);
  - sections of about 60 lots (DEFAULT_SECTION_LOTS);
  - grouped audit sessions (0328 `full_count_id/year/section_no`).
- `count-generators-core` generates cycle counts by due date, vendor, ABC class, exceptions and expiring lots.
- `inventory-audit-store` submits a `kind 'inventory'` journal with sourceRef `audit:<session>`, as a **draft** for you to approve. `audit-posting-accounts.ts` maps category → inventory and COGS accounts.

**How accounting plugs in (no second count system, rule 25):**

- **D-02 Cycle-count posting:** every approved audit session posts its shrink/quarantine journal (Q-10 reason codes). It reads the session's own lot costs. A cycle count is an ordinary month event.
- **D-03 Year-end full count = valuation event:** when all sections of the `full_count_id` for year 2026 are approved, the system:
  - (a) produces the **inventory valuation report** (lot × units × cost, by category, with samples at $0 shown separately per OD-15);
  - (b) produces the **Sage adjusting entry** for 2026 (count value vs Sage balance);
  - (c) hands the per-category totals to the **OB worksheet** (I-04).
  - For 2027 onward, the same event becomes the **year-end inventory proof**: count value must equal the GL inventory balance, or the difference posts as year-end shrink (C-INV-2 in part 11).
- **Timing:** schedule the 2026 full count for **12/31 after close**, or 1/1 before open. If it runs on another date, sales and receipts between the count and 12/31 roll it forward (the system computes that). Rev. Proc. 98-29's estimate (part 10 F-03) is not needed when the count is at year end.

---

## Q-12 · Tax-basis or GAAP? → OD-34 ("is it too much trouble to do both?")

**Plain English:**

- **Tax-basis** statements follow the tax return's rules. They are simple and are what you and your CPA need.
- **GAAP** statements follow accounting standards (e.g. leases on the balance sheet, loyalty points as a liability). Banks and buyers usually want them.

**Not too much trouble, done the Sage Intacct way:**

- There is **one** set of books (tax-basis accrual, everything you post day to day).
- A separate **adjustments book** holds only the GAAP-only entries (e.g. the store lease as a right-of-use asset, ASC 842).
- Reports run as "tax", "GAAP adjustments only" or "tax + GAAP adjustments = GAAP". Monthly history is never rewritten.
- Technically: a `book` code on each journal ('tax' default, 'gaap_adj').
- Built after go-live (G-08), when a lender or buyer appears. The hook (the `book` column) is added early so nothing has to be migrated later.

---

## Q-13 · Excise (LCB) and sales tax (DOR) payments → OD-35 ("please use your best judgement")

**Plain English, the four-step life of a tax dollar:**

| Step | What happens | Where it lives in the system | Journal |
|---|---|---|---|
| 1 **Collect** | Each day's sales collect excise (37%) and sales tax | Daily summary journal (B-01) | Cr 32000 Excise Payable (trust), Cr 32100 Retail Sales Tax Payable (trust; state + local in one rate). B&O accrues separately to 32200 (F-05) |
| 2 **File** | Month end: you file the LCB excise return (the LIQ-1295 CSV template you already use) and the DOR excise-tax return (sales tax + B&O) | **Tax return record** (F-01 LCB, F-02 DOR) built from the sales data. It must tie to step 1 (C-TAX-1/2), and any difference is explained before you file. | none, it's a tie-out |
| 3 **Pay** | You pay in the LCB portal (soon) / DOR portal and save the confirmation | You **attach** the confirmation number + PDF to that return record (F-03). The record already has fields for LCB (excise_return_drafts, 0051: payment_method, payment_confirmation, amount_paid, paid_at); DOR gets the same. | Dr 32000 / 32100 / 32200 / Cr 10200 Operating Bank, posted by template when the confirmation is attached |
| 4 **Clear** | 1–3 days later the Timberland Plaid feed shows the debit | Bank match (C-04) **pairs** the Plaid line with the step-3 journal by amount + date + payee. It does not create a new expense. | none, it's a match |

**Why this is the enterprise answer:**

- The **return** is the legal fact, the **confirmation** proves payment, and the **bank** proves the cash left. Each is a separate record, and the system checks they agree.
- Plaid alone cannot do it, because a bank line says "WA DEPT REVENUE $4,213.17", not which month or which tax. It also can't tell excise from sales tax inside one DOR payment.
- **One authority:** paying taxes through a *vendor bill* (vendor-bill-core.ts:755/769, `excise_remittance`/`sales_tax_remittance`) is retired for taxes, so the same payment can't be booked twice (rule 25).

**Your monthly routine after go-live, about 10 minutes:**

1. Open "Tax returns", pick the month.
2. Check the green tie-out ticks.
3. Download the LCB CSV.
4. Pay in each portal.
5. Paste the confirmation number and drop in the PDF.
6. Later, the bank line turns green on its own.

---

## Q-14 · Who keys AP payments → OD-36, "template please"

An admin (OD-03 allows it) paying an **already-approved** bill posts Dr 30000 AP / Cr bank automatically, under the `TPL-AP-PAYMENT` template with an account allow-list (Q-15). A payment with no approved bill behind it is never autoposted. It goes to your queue. Built in 15 E-01.

## Q-15 · Template account allow-list → OD-37, "option b"

New table `gl_posting_template_accounts`. `gl_submit_journal` refuses an autopost that touches any account not on its template's list (GL_TEMPLATE_ACCOUNT_NOT_ALLOWED). It then falls back to a draft, with the reason shown to you. Built in 15 A-04.

## Q-16 · Drawer over/short tolerance → OD-38 ("your recommendation")

- **Expected** cash = what the POS says should be in the drawer.
- If counted minus expected is within tolerance, the till-close posts automatically. If it is outside, it waits for you with the difference shown.
- **The one number I still need (U-19):** your over/short alert threshold. **I propose $5.00 per drawer**, a common retail standard. Change it any time on the template screen.

---

## Remaining owner inputs (short list)

| # | What | When needed | Default if you say nothing |
|---|---|---|---|
| 1 | Run the Q-05 SQL tonight | **Before opening 11/01** | none, it is a safety step |
| 2 | Over/short threshold (U-19) | Before C-02 goes live (Jan) | $5.00 |
| 3 | Deposit bank account after 11/01 (U-18) | Before C-01 templates | 10200 Operating |
| 4 | Personal books on the platform: yes/no | I-02 (December) | Yes, balance-sheet only |
| 5 | Parallel January in Sage: yes/no | I-05 (December) | Bank totals only |
| 6 | Year-end count date/time | D-03 (by 12/15) | 12/31 after close |
| 7 | Fixed-asset list (cost, date in service) | H-06 (December) | Sage's asset register |
| 8 | CPA name for the 280E and regime notes | D-07/H-05 | Recorded later |
