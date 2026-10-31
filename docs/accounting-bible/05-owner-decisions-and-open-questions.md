# ACCOUNTING BIBLE — 05 · OWNER DECISIONS (verbatim) AND OPEN QUESTIONS

> Standing rule 1 / todo rule 100: owner facts are recorded **in his words**, with where they live.
> I never paraphrase a decision into code. If a slice needs a decision that is not in this file,
> **ask** before building. An "OPEN" question is never answered by me. I give a recommendation and
> wait.

---

## 5.1 Decisions on record (quote → where recorded → what it binds)

| id | Date / slice | Verbatim | Recorded at | Binds |
|---|---|---|---|---|
| OD-01 | 2026-08-17 | "I am cutting over from Cultivera pos and sage on November 1st 2026. I will drop Cultivera completely. I will keep sage and run both books in parallel until year end. If all goes well, we will drop sage and use our platform exclusively. Sage will have all of my Cultivera activity recorded in it already, so I won't need to recreate the full year. I will start from beginning balances." | 0186_cutover_config.sql:16-21 | OB date 2026-10-31; parallel run Nov–Dec; **no Jan–Oct transaction import**; balance-sheet start only (part 07 §7.4 YTD trap) |
| OD-02 | 2026-08-17 | "we are accrual based for all entities and my person." | cutover-core.ts:91-99 | Accrual for greenway, atm, landholding, personal |
| OD-03 | 2026-08-17 | "…there is no reason anyone else needs to see my books or my financials ever, so I want strict controls over all of those things. The only thing an admin can do is pay vendors and pay employees…" | 0185_books_owner_only.sql (header) | `is_owner()` gates all gl_* RLS and RPCs; AP and payroll stay admin-capable. **Any new books screen must use the owner gate** (books-access.ts / createBooksClient). |
| OD-04 | books (0177) | "I think a one time approval for beginning balances is acceptable. I would also like an over ride for my self. I won't be having anyone else help me with admin activities, and so I would rather have the ability to check my own work... I agree with segregation of duties typically, just not in this case where it's a one man job done by the one owner." | 0177_owner_override.sql:16-20 | OB self-approval; override flag with a written reason; N-05 parity |
| OD-05 | books-89 | "I will need you to turn off the over 5k approval feature. I am the one and only owner operator that will have access to the books. I liked it because it flags large purchases, but I regularly have over 5k invoices, so I want to be notified about it, then it needs to allow me to approve it. But we will work on that later, just add it to the list of things to complete later on." | 0211_owner_operator_self_approval.sql:6-12 | Keep the $5k **flag**, remove the **block**; "PR D" (flag screen) is still owed → S-04 |
| OD-06 | books-70 | "We need to systematically and methodically go through each function, every aspect of the system that generates a book entry to make sure it is…" (continues in file) | ledger-census-data.ts:6-14 | The census is the progress instrument. Every slice flips census rows with evidence. |
| OD-07 | books-73 | "the ledger should use its own accounts and not the website map." | DEFECTS.md:2406-2410 (D-50 UPDATE) | ledger-category-map-core is the only category → account map |
| OD-08 | books-73 | "**we are not ready to migrate inventory over yet.**" | DEFECTS.md:2439; ledger-census-data.ts:444-446 | The cut-over inventory wiring is an **owner deferral**. The census row stays `reachable: MISSING` "until he asks for the wiring". **S-06 must not start without his go-ahead.** Part 07 asks for it (with the evidence-capture steps that are safe regardless). |
| OD-09 | books-73 (D-41) | "for question 4, i am not sure, please tell me your professional opinion and recommendation." → opinion given in D-41 UPDATE | DEFECTS.md:2551+ | Vendors paid from the ATM account (6228): treatment per the D-41 UPDATE opinion. **Read it in full before S-23.** |
| OD-10 | books-69 (D-30) | "My plan is to switch to paying vendors from the atm account starting on November 1st. I will begin paying employees via the atm account on January 1st." | DEFECTS.md:1302-1304 | Effective-dated classification (atm-classification-core). From **11/01** vendor payments leave 6228. From **2027-01-01** payroll too. Intercompany volume jumps tomorrow. S-23 priority. |
| OD-11 | D-55 | "They exist solely to mitigate 280E, otherwise all three businesses would be under the cannabis business." | DEFECTS.md:2647-2648 | Entity separation is a tax position (Harborside risk, D-55). Intercompany must be **real, documented, arm's length**. No commingling (FinCEN red flag, part 02 §7). |
| OD-12 | D-60 | "The outstanding inter company balance is not tracked anywhere. I never thought to track it before. We will now." / "Demand has never been made. It's just me moving my money around as I please with out structure." | DEFECTS.md:3164-3168 | `balanceIsTracked: false` in related-party-loan-core. Loan characterisation is at risk. S-26 needs a **note / terms** decision (Q-09). |
| OD-13 | coa | "For inventory, I want details down to the category, not just the…" | coa-core.ts:172 | 21 per-category inventory and COGS accounts |
| OD-14 | coa | "no asking, hard no! Block everything, gate everything lock everything." | coa-core.ts:561 | New-account creation refuses; rule 14 (refuse over warn) |
| OD-15 | lot cost | "the system needs to know that every product coming in has a cost attached. Unless it is a sample. Those are zero cost, and the system knows how to keep them separate from menu products." | lot-cost-classification-core.ts:6-8 | $0 lots must be *samples*, never "unknown". The cut-over builder drops $0 lots **by name**. |
| OD-16 | deposits | "For question 1, post with a warning." (aged cash) | deposit-clearing-core.ts:716 | Aged undeposited cash posts with a warning, not a refusal |
| OD-17 | card | "I will go with the low limit credit card ... I don't want to use the master till any more for petty cash." | card-payment-core.ts:7-8 | 33000 card; supply runs via card |
| OD-18 | B&O | "it is currently set at .00471 for retailing, and .015000 for the atm activity (service and other activities less than 1,000,000 in the prior year)" / "the surcharge only is what i enter into the dor portal when paying sales taxes. the atm service provider deposits the surcharge separate so it will be very simple to track." | bo-tax-core.ts:181-183, :204-207 | Rates; ATM B&O base = surcharge only |
| OD-19 | teaching | "I learn best visually… I have always needed a mentor, a cpa or…" / "I really think it's smart to not just block, but explain why…" | payroll-cogs-core.ts:2300; vendor-bill-core.ts:891 | Every refusal is a sentence plus a resolution. Every screen teaches. |
| OD-20 | testing | "Please test it, break it, fix it to be better, and test the tests." | payroll-cogs-core.ts:2567 | Mutation testing per slice (part 06) |
| OD-21 | 2026-10-31 (this task) | The request in part 00 §0.1 (verbatim) | 00-INDEX.md | Docs only, no code edits; go slow; everything pinned |

---

## 5.2 Open questions (I recommend; Michael decides)

Each has: why it matters, options, my recommendation, which slice waits on it. Ask them **one batch at a time**, most urgent first. Q-01 … Q-04 are needed for the cut-over week.

### Q-01: How do cash events (drawer, seal bag, deposit, supply run) get past the autopost gate? (N-01)

- **(A)** Seed `gl_posting_templates` with one owner-approved template per (entity, kind, pattern), and pass `templateCode` from each service. This is a standing approval, as enterprise systems do.
- **(B)** Drop `autoPost`: the entries land as drafts, `bank` is approval-exempt, so it is one click each (`post_only`).
- **Recommendation: A.** Volume is about 2–4 cash events a day, and each one is already a counted human act (D-74). The template records once that Michael pre-approves this shape, with its limit and tolerance in 0174's columns. Templates survive factory reset (KEEP list, factory-reset-core.ts:222-290).
- **Blocks:** S-01.

### Q-02: Opening-balance evidence

1. **(a)** Will you export a Sage trial balance at 10/31 for each entity (greenway, ATM, landholding, personal)? This is what D-47 is blocked on.
2. **(b)** Do the personal books go live on 11/01, or later?
3. **(c)** Jan–Oct 2026 net income: does it sit in a current-year-earnings line inside equity in the OB, or in 40300 with a memo? (CPA question; part 07 §7.4.)

- **Blocks:** S-07.

### Q-03: Fractional and gram-tracked lots at cut-over

`extendLotCents` refuses non-integer quantities.

- **(A)** Convert those lots to whole units first.
- **(B)** Allow cost-per-gram × grams with an explicit rounding rule written once.
- **(C)** Load them as named exclusions with a separate journal later.

The snapshot query (07 §7.2) counts them. If the count is 0, the question disappears.

- **Recommendation:** measure first.

### Q-04: Inventory in the OB worksheet or as a separate journal? (07 §7.4)

- **Recommendation:** in the worksheet (one OB journal per entity), with the 40400 inventory share explained on screen.
- **Also:** do you now want the inventory wiring built? OD-08 says not yet. The snapshot at 07:30 on 11/01 keeps that choice open at no cost.

### Q-05: Medical-exempt sales in the ledger (N-09)

Confirm that medical-exempt sales are happening (endorsement row is seeded true, 0040:66). If yes, S-03b is HIGH. If Greenway makes no medical sales, it is LOW but still worth fixing before the first one.

### Q-06: §280E COGS position

Which position does the 1120-S take: strict 1.471-3(b) acquisition cost only (Harborside), or something more aggressive? `cogs-position-core#comparePositions` quantifies each.

- **Recommendation:** conservative (Harborside), reviewed with the CPA.
- **Blocks:** S-20 report text only. The ledger posts the same either way.

### Q-07: Sales: per-order journals or a daily summary? (N-03)

- **(a)** Per order, auto-posted by template.
- **(b)** One revenue and one COGS journal per business day.
- **(c)** Per-order drafts with a bulk-approve button.
- **Recommendation: (b).** It matches how returns are filed and how the drawer closes, keeps the GL readable, and leaves `orders` as the subledger with drill-down.
- **Blocks:** S-03.

### Q-08: What is 12300 Excise Receivable for?

It is seeded but no code uses it. Possible uses: excise overpaid and credited by LCB, or excise on returned goods after the month is filed. Michael or his CPA to say. Otherwise leave it unused.

### Q-09: Related-party money

- **(a)** Do you want to paper the ATM ↔ greenway ↔ personal balances as notes (terms, AFR interest; related-party-loan-core supports it)?
- **(b)** Or treat net movements as contributions/distributions?

The choice changes the 7203 basis (debt basis vs stock basis) and the Harborside optics (OD-11/OD-12).

- **Blocks:** S-23, S-26, S-27.

### Q-10: Inventory write-downs

Should expired/damaged product be written down at count (60810 shrink) or only on destruction? (Tax: deduct when destroyed. Book: when known.) Since this is accrual, a write-down at count is recommended, with destruction evidence later.

### Q-11: Rev. Proc. 98-29 shrink estimate at year end?

Only matters if the year-end count date differs from 12/31. **Defer** (part 10).

### Q-12: Statement framework

Tax-basis presentation or GAAP? Is there a lender or a buyer asking? This decides whether ASC 842/330 layers are ever built.

- **Recommendation:** tax-basis-style statements on accrual books.

### Q-13: Excise/DOR payment confirmation as the GL trigger (N-11)

When you pay LCB / DOR, what document do you keep (confirmation number, PDF)? S-12 marries the payment journal to it.

### Q-14: Who keys AP payments after 11/01?

OD-03 lets an admin pay vendors. The payment journal (S-15) posts Dr 30000 / Cr bank. Should an admin-initiated payment post automatically (template), or wait in the owner's queue?

- **Recommendation:** template, for paying an already-approved bill only.

---

## 5.3 How to record a new decision

1. Add a row to §5.1 with the next OD-number, the date, the exact quote and where you stored it in the repo (migration header, core comment, or DEFECTS UPDATE block).
2. Move the question in §5.2 to "ANSWERED → OD-nn". Do not delete it.
3. If it changes a slice in part 09, edit that slice's "waits on" line.
