# Missing records, the IRS, and how we separate Michael's four books

**Status:** research + strategy. Written 2026-08-14. No code in this file.
**Read this before the cut-over.** Companion to `SAGE_50_WHAT_TO_SEND_ME.md`.

This file answers two questions Michael asked directly:

1. *"How does the IRS treat the type of issue I have specifically? If data doesn't
   exist anymore, what can be done?"*
2. *"Help me strategize how to only extract business records from Sage and then
   focus on rebalancing my life records later."*

Every legal statement below is sourced. Nothing here is guessed. Where the law is
unfavourable it is written down as unfavourable.

---

## PART 1 — WHAT THE IRS ACTUALLY DOES ABOUT MISSING RECORDS

### 1.1 The starting point: the burden is on the taxpayer, always

IRC §6001 requires every taxpayer to keep records adequate to support what is on
the return. Deductions are, in the Supreme Court's words, "a matter of legislative
grace," and "the burden of clearly showing the right to the claimed deduction is on
the taxpayer" (*INDOPCO, Inc. v. Commissioner*, 503 U.S. 79, 84 (1992)).

There is no rule that says missing records are the government's problem. They are
the taxpayer's problem. That is the honest frame for everything below.

### 1.2 The good news: estimates ARE permitted — the Cohan rule

*Cohan v. Commissioner*, 39 F.2d 540 (2d Cir. 1930). George M. Cohan deducted
about $55,000 of travel and entertainment and could not document a dollar of it.
The Board of Tax Appeals disallowed everything. The Second Circuit reversed,
holding that where the court is satisfied that expenses were in fact incurred,
"absolute certainty in such matters is usually impossible and is not necessary;
the Board should make as close an approximation as it can, **bearing heavily if it
chooses upon the taxpayer whose inexactitude is of his own making**" (39 F.2d at 544).

That last clause is the one that matters for us. Estimates are allowed, but the
court is invited to resolve every doubt AGAINST the person who lost the records.

### 1.3 The four hard limits on Cohan

These are the limits, stated plainly, because a half-understood Cohan rule is more
dangerous than none.

**(a) It is discretionary, not a right.** A court *may* estimate; it need not, and
refusing to is not grounds for appeal (*Buelow v. Comm'r*, 970 F.2d 412, 415 (7th
Cir. 1992); *Portillo v. Comm'r*, 932 F.2d 1128, 1134 (5th Cir. 1991)). The IRS is
under no obligation to estimate or to accept an estimate.

**(b) It fixes the AMOUNT, never the EXISTENCE.** Michael must first prove by
credible evidence that a cost was actually incurred and was actually business-
related. Only then may the amount be approximated. "Until the trier has that
assurance from the record, relief to the taxpayer would be unguided largesse"
(*Williams v. United States*, 245 F.2d 559, 561 (5th Cir. 1957)).

**(c) There must be a basis for the estimate.** Courts will not guess and will not
bless the taxpayer's guess. A reconstruction created after the audit notice needs
"corroborative evidence with a high degree of probative value ... to elevate that
reconstruction to the same level of credibility as a contemporaneous record"
(*Franklin v. Comm'r*, T.C. Memo 2020-127).

**(d) Some statutes switch Cohan off entirely.** IRC §274(d) (travel, meals, gifts,
listed property) imposes strict substantiation; Temp. Treas. Reg. §1.274-5T(a)
states outright that §274(d) supersedes Cohan and that approximations are not
permitted. IRC §170 does the same for charitable contributions. In those areas no
records means no deduction, full stop.

### 1.4 THE CASE THAT IS ABOUT US: *Alterman*

**This is the most important paragraph in this file.**

*Alterman v. Commissioner*, T.C. Memo 2018-83. A Colorado dispensary. Gross
receipts $894,922 (2010) and $657,126 (2011). Because of §280E they could deduct
essentially nothing except cost of goods sold, so COGS was the whole ballgame.

They computed COGS as purchases plus production costs. The Tax Court:

> "Their method leaves out beginning inventory and ending inventory. Such a method
> is indeed improper."

They then asked the court to apply **Cohan and estimate the beginning and ending
inventories**. The court refused, holding that their recordkeeping made that an
**"impossible"** task. Result: COGS was limited to the amount the IRS had already
conceded, all other deductions were denied, and the §6662(a) accuracy penalty was
sustained — *because they were negligent in not keeping records*. Deficiencies of
$157,821 and $233,421 plus $31,564 and $46,684 in penalties, on a business roughly
a third of Greenway's size.

**What this means for Michael, in plain English:** for a cannabis retailer, the
opening inventory number is not a bookkeeping nicety. It is the single number that
determines COGS, and COGS is the only thing §280E lets him subtract. A dispensary
that cannot prove beginning inventory does not get an estimate — it gets a
disallowance and a negligence penalty. Alterman is precisely the failure mode the
`20009-GRNWY LAZY INVENTORY ENTRY` plug would walk us into.

### 1.5 The other exposure: IRC §446(b)

> "If no method of accounting has been regularly used by the taxpayer, **or if the
> method used does not clearly reflect income**, the computation of taxable income
> shall be made under such method as, in the opinion of the Secretary, does clearly
> reflect income." — IRC §446(b), verbatim.

A general ledger that does not balance, that mixes three businesses and a personal
life in one chart, and that carries a multi-million-dollar plug in an inventory
account is exactly what "does not clearly reflect income" describes. §446(b) lets
the Commissioner throw out the method and substitute his own. Combined with §280E,
the Commissioner's method is not going to be generous.

This is the strongest possible argument for the cut-over we are building, and it is
why the November 1 2026 date is worth protecting.

### 1.6 What the IRS says to actually DO (irs.gov)

From "Reconstructing records after a natural disaster or casualty loss"
(irs.gov/newsroom, reviewed 29-Jul-2026). The guidance is framed around disasters,
but the reconstruction techniques are what the IRS itself proposes when documents
are gone, and they map onto our situation directly:

- **Tax records** — free return transcripts via Get Transcript, or Form 4506-T
  (transcript) / Form 4506 (full copy) by mail. *This gives us 12 years of filed
  numbers even where Michael's own files are gone.*
- **Inventory** — "get copies of invoices from suppliers ... the invoices should
  date back at least one calendar year." *For us: vendor invoices, and in Washington
  the state traceability system, are third-party corroboration Michael already has.*
- **Income** — "get copies of bank statements. The deposits should closely reflect
  what the sales were for any given time period," plus "sales tax reports, payroll
  tax returns and business licenses ... These will reflect gross sales for a given
  time period." *For us: LCB excise filings, B&O returns, Forms 941, and the
  merchant/bank record.*
- **Real property** — title/escrow company, county assessor, appraisals, insurance
  policies, contractor statements for improvements, probate records if inherited.
  *This is the entire evidence plan for the Geiger property's land/building split
  and depreciation basis.*

Relevant IRS publications: Pub. 583 (Starting a Business and Keeping Records),
Pub. 551 (Basis of Assets), Pub. 584-B (Business Casualty/Disaster/Theft Loss
Workbook).

### 1.7 The bottom line for Michael

There is no fire, and that is good news — a fire would not have helped much anyway.
What he has is worse in one way and far better in another.

- **Worse:** "my ledger drifted and I mixed four sets of books together" is
  self-inflicted inexactitude. Cohan says the court may bear heavily against him
  for it, and Alterman shows a dispensary being told an inventory estimate is
  impossible.
- **Far better:** almost nothing is actually *gone*. Bank statements exist. Vendor
  invoices exist. Twelve years of filed returns exist and can be pulled as
  transcripts. Payroll filings exist. Excise filings exist. Washington traceability
  data exists. A physical inventory count can be taken today.

**The correct move is therefore not to reconstruct the Sage ledger. It is to
rebuild the opening balances from third-party evidence and never rely on the drifted
GL at all.** That is standing rule 11, written before this research, and this
research confirms it was right. Third-party documents are stronger evidence than a
clean-looking ledger anyway — a ledger is the taxpayer's own assertion; a bank
statement is not.

**Timing note.** Doing this proactively, before any examination, is worth a great
deal. §6662 negligence penalties turn on whether the taxpayer made a reasonable
attempt to comply. A documented, evidence-linked cut-over performed voluntarily is
the opposite of negligence. A reconstruction produced after a notice arrives is,
per *Franklin*, discounted.

**Not legal advice.** Nicholas Mullan signs the returns. Before the cut-over is
blessed, he should review this file and the opening-balance worksheet. If any
position here is one he disagrees with, his call governs.

---

## PART 2 — WHAT IS ACTUALLY IN MICHAEL'S SAGE CHART

Measured from `supabase/migrations/0173_chart_of_accounts.sql`, the
`gl_account_migration_map` seed rows, by `/workspace/coa-analysis.py`.
Every figure below is computed from the file, not typed by hand.

### 2.1 Four suffixes, one chart — Michael's description confirmed

| suffix | accounts | net balance |
|---|---:|---:|
| `-GRNWY` | 8 | $1,464,065.19 |
| `-GRWYE` | 4 | −$45,230.00 |
| `-OTHER` | 1 | −$5,011.02 |
| `-LYMAN` | 1 | $0.00 |

Michael said he "tried to add three businesses and my personal life to it. All in
one COA." The data agrees exactly: four different suffixes, one chart.

### 2.2 The typo that split one business in two

`-GRNWY` and `-GRWYE` are the same word — Greenway — spelled two different ways.
Eight accounts under one spelling, four under the other. Because Sage treats the
suffix as part of the account number, these never compared, never summed together,
and never reconciled. **This alone can put a trial balance out.**

### 2.3 The same account name under two suffixes

`ACCOUNTS PAYABLE` exists as both `34000-GRWYE` and `35000-LYMAN`. Two payable
control accounts for what a lender or an auditor would read as one company.

### 2.4 The inventory hole — and a correction

`20009-GRNWY LAZY INVENTORY ENTRY` holds **+$4,624,697.31**. It exists because Sage
demanded an inventory item per lot code, which is impossible with per-lot intake and
no UPCs.

The rationale recorded in `0173` states the plug offsets **−$4,388,348.06** of
impossible negative category balances, i.e. the plug covers **105.4%** of the hole.

Only two negative categories are actually visible in the seeded rows —
`20000-GRNWY CONCENTRATE` at −$1,804,022.70 and `20002-GRNWY FLOWER` at
−$1,461,147.84, totalling **−$3,265,170.54**. Against only those two rows the plug
would appear to cover 141.6%.

**Correction (rule 17):** an earlier analysis of mine reported "141.6% coverage,
$1,359,526.77 unexplained." That was wrong — it compared the plug against only the
two rows that happen to be seeded, not against the full hole the file asserts. The
difference between the asserted hole and the visible rows, **$1,123,177.52**, is
simply negative categories that were never seeded into the crosswalk, not money that
vanished. The honest statement is: the plug exceeds the asserted hole by
**$236,349.25**, and that residual is unexplained. Still a real problem — a credit
balance on an asset is impossible and this is exactly the Alterman fact pattern —
but a $236k question, not a $1.36M one.

### 2.5 The cabin — already documented, already flagged

`42000-OTHER  BUEHLER - CONTRIBUTIONS  −$5,011.02`, disposition `retire`. The
rationale on file already reads:

> "Personal: the owner's aunt, tied to a lake cabin he no longer owns. Never
> belonged in the business equity block."

Michael's memory is correct and the repo already agrees with him. Also present:
`73002-GRNWY PAYROLL - THERESA BECKER`, an HSA/health-premium arrangement for his
mother that ended at Medicare — a shareholder relationship encoded as a payroll
account.

### 2.6 Coverage gap — open item

`0173` states "Every one of the 287 Sage accounts is accounted for." **14 rows are
actually present. 273 are unmapped.** The file does say the full set is "loaded from
the Sage export by a separate, reviewable script," so this is unfinished work rather
than a false claim — but until that script exists and runs, the sentence overstates
what is true. Tracked as an open item.

### 2.7 The single most important fact

**`carries_balance` is `false` on all 14 rows. Zero rows carry a Sage balance
forward.**

The architecture already refuses to import Michael's Sage numbers. Nothing he did in
Sage can contaminate the new books, because no Sage balance is trusted into them.

---

## PART 3 — THE STRATEGY: BUSINESS NOW, PERSONAL LATER

### 3.1 Why this is easy here and was impossible in Sage

In Sage, the entity was **part of the account number** (`-GRNWY`, `-LYMAN`). To
separate the businesses you would have to renumber the chart, which breaks every
historical entry.

In the new system, `entity_id` is a **column on every journal line**, and four
entities already exist and are seeded (`0172`, lines 962-972):

| code | name | tax form | NAICS |
|---|---|---|---|
| `greenway` | Greenway Marijuana | 1120S | 453998 |
| `atm` | ATM Operation | 1040 Sch C | 522200 |
| `landholding` | Lyman Land Holding (Geiger) | 1040 Sch C | 531100 |
| `personal` | Michael Lyman (Personal) | 1040 | — |

Separation is therefore a filter, not a migration. Michael's request is already the
architecture.

### 3.2 The blessing is per-entity — this is the key mechanic

`gl_bless_opening_balances(p_entity_code, p_memo)` takes **one entity code**. So:

- Bless `greenway` when its evidence is complete.
- Bless `atm` and `landholding` when theirs are.
- Leave `personal` staged indefinitely. It blocks nothing.

The cabin never has to be solved before go-live. It just has to be **out of the
business entities**, which the `retire` disposition already does.

### 3.3 What happens if the worksheet still doesn't balance — verified, not assumed

Michael's worry is that his numbers won't tie. The system already handles this and
it is **proven by test**, not asserted. From `0176_opening_balances.sql`, the
blessing routine sums the staged rows and, if the total is not zero:

- writes the difference to **`40400 Opening Balance Equity`** as a visible line
  described *"Opening Balance Equity — plug pending evidence"*;
- posts the entry as a **draft, not auto-posted**, so a human must approve it;
- attaches a mandatory `assumption_note` recording the exact imbalance and stating
  it "must be resolved before the cut-over is complete."

`40400` is seeded in `0173` (line 561) as a SYSTEM account: *"must return to ZERO
once every opening balance is evidenced. A permanent balance here means the
cut-over is unfinished."*

**Measured evidence.** `scripts/accounting/opening-balance-tests.sql`, run
2026-08-14, `EXIT=0`, **77 assertions passed, 0 failed**:

- ATTACK 7 — *a worksheet that does NOT balance is plugged VISIBLY*: summary says
  not balanced; predicts the exact plug (−2,500,000 cents); the plug actually
  written matches the prediction; 40400 carries it; the imbalance was recorded as
  an assumption note.
- ATTACK 10 — *the OBE close drives 40400 to EXACTLY zero*: close reports
  `outcome=closed`, moves exactly the plug amount, 40400 lands on **exactly 0**,
  40300 Retained Earnings receives it, entity still balances.
- ATTACKS 14/15 — a non-admin cannot bless, close, or even read the worksheet
  (`GL_FORBIDDEN`); an anonymous admin is refused (`GL_OB_NO_ACTOR`).

So an out-of-balance trial balance does not stop the cut-over, and it cannot be
hidden either. It becomes a labelled number with a written explanation that someone
has to sign off — which is exactly what to hand Nicholas Mullan.

### 3.4 The order of work

1. **Now → go-live.** Keep building and battle-testing. Michael touches nothing in
   Sage. (His instruction: don't gather balances until the app is proven.)
2. **Export, don't migrate.** Pull the 7 files in `SAGE_50_WHAT_TO_SEND_ME.md`,
   CSV, headings on, never a `.ptb`. This is an **archive**, not an import. Note
   `gl_opening_balances.evidence_kind` includes `'sage_trial_balance'` — Sage may be
   *cited* as evidence for an item, it is just never *trusted* wholesale.
3. **Sort the 287 into four buckets.** Suffix is the first pass (`-GRNWY`/`-GRWYE`
   → greenway, `-LYMAN` → landholding or personal, `-OTHER` → personal), then
   account-by-account review. Closes the 273-row gap in §2.6.
4. **Evidence the business entities only.** Cash from bank statements. Inventory
   from a physical count on cut-over day plus vendor invoices — **this is the
   Alterman number, and it gets the most care of anything.** Payables from the aged
   payables report. Excise from LCB filings. Equity from K-1s and Nicholas's
   workpapers.
5. **Bless `greenway` first.** Then `atm`, then `landholding` (which needs the
   fixed-asset accounts that do not exist yet — that is the F5-L build slice).
6. **Get Nicholas's blessing** on the blessed opening balances before going live.
7. **Personal comes later, on Michael's own time.** The cabin, the aunt's
   contributions, the mother's HSA arrangement — all `retire`d out of the business
   books, then reconstructed into `personal` whenever he wants. Nothing waits on it.

### 3.5 The 10-15 year goal

Michael wants the system to replace Nicholas in 10-15 years. Twelve years of returns
plus workpapers is the training corpus. That is what the document vault and drift
register (F7-F10) are for: every year of returns, every workpaper, every judgement
Nicholas made and *why*, captured next to the numbers it touched. The cut-over is
step one of that, not a separate project.

---

## SOURCES

- IRC §6001; IRC §274(d); IRC §170; IRC §280E; IRC §446(b) (verified verbatim,
  Cornell LII: https://www.law.cornell.edu/uscode/text/26/446)
- *Cohan v. Commissioner*, 39 F.2d 540 (2d Cir. 1930)
- *Alterman v. Commissioner*, T.C. Memo 2018-83
- *INDOPCO, Inc. v. Commissioner*, 503 U.S. 79 (1992)
- *Williams v. United States*, 245 F.2d 559 (5th Cir. 1957)
- *Buelow v. Comm'r*, 970 F.2d 412 (7th Cir. 1992); *Portillo v. Comm'r*, 932 F.2d
  1128 (5th Cir. 1991); *Franklin v. Comm'r*, T.C. Memo 2020-127
- Temp. Treas. Reg. §1.274-5T(a), §1.274-5T(c)(2)(ii)
- IRS, "Reconstructing records after a natural disaster or casualty loss,"
  irs.gov/newsroom, reviewed 29-Jul-2026
- Cornell LII Wex, "Cohan rule," reviewed August 2025
- Cook & Webber, "'Cohan Rule' Estimates — A Useful Tool if Properly Used,"
  The CPA Journal, Dec 2021
- Noff, "I.R.C. §280E: A Buzzkill for Those Who Keep Poor Records," Frost Law
- Repo: `0172_gl_core.sql`, `0173_chart_of_accounts.sql`, `0176_opening_balances.sql`,
  `scripts/accounting/opening-balance-tests.sql`
