# BOOKS ROADMAP — the tracked source of truth

**Status: LIVE. This file is the memory of the bookkeeping branch.**

Created at Michael's direction during slice books-17. His words:

> *"Please add all of these to the roadmap and stash it in the repo maybe so we
> don't forget to finish all of these tasks. They are critical to the system...
> I nearly forgot about all these functions, so let's get our priorities
> straight again."*

Conversations get compacted and sessions end. The repository is the only memory
that survives, so every remaining bookkeeping function lives here, in order,
with the reason it sits where it sits. Standing rule 31 requires this file be
updated as each item lands. Standing rule 30 makes the order below binding.

The narrative companion to this file is `docs/books-roadmap-remaining.md`,
written for Michael in plain English at the end of books-13. That document
explains *why* each piece matters. This one tracks *where each piece stands*.

---

## THE MANDATED ORDER — NOT NEGOTIABLE

Michael, books-17:

> *"You said we have to complete these tasks in this order specifically. That
> each following task builds on the previous task. So that means it's important
> and we must follow this specific order for maximum success and accuracy."*

He is right, and the dependency is mechanical rather than stylistic. Each item
is **assembled from the output of the one before it**. Building out of order
means inventing the inputs, and inventing inputs is guessing, which is standing
rule 1. The order:

| # | Slice | Consumes | Status |
|---|-------|----------|--------|
| 1 | **Financial statements** | trial balance, chart of accounts | **SHIPPED — books-17, PR #989** |
| 2 | **Period close screen** | the statements (a period may not close on statements that do not tie) | **SHIPPED — books-18, PR #992** |
| 3 | **Basis and AAA tracking** | the statement of stockholders' equity | **SHIPPED — books-19, PR #993** |
| 4a | **Form 1125-A and the COGS position** | inventory + the 280E wall | **SHIPPED — books-20, PR #994** |
| — | **Correction slice: the S-corporation year, §6621 interest, §6699** | nothing — it FIXES 3 and 4a | **SHIPPED — books-21** |
| — | **Cleanup slice: the Accounting and Lyman tabs; the Security Log; nav/page gate agreement** | nothing — it LOCKS what 1–4a built | **SHIPPED — books-22** |
| — | **Inventory audits reach the ledger: the count, the owner's approval, the journal entry** | nothing — it CONNECTS the shelf to 4a | **SHIPPED — books-23** |
| 4b | **Form 1120-S and Schedule K-1** | the statements + AAA/basis + 1125-A | **NEXT** |
| 5 | **Form 1040 and §199A** | the K-1 produced by #4 | not started |
| 6 | **941 / 940 / W-2 / W-3** | payroll engine + the returns above | not started |
| 7 | **WA B&O and local taxes** | the income statement's revenue lines | not started |
| 8 | **Forms builder, generalized** | the pattern proven across #4–#7 | not started |

Then, and only then: **push notifications and the calendar.** Michael,
books-17: *"there's no point notifying me yet if we can't use it."*

Two further items sit outside the chain because they are blocked on documents
Michael owes, not on code:

| # | Slice | Blocked on | Status |
|---|-------|-----------|--------|
| 9 | **Depreciation schedule completion** | Michael's asset list (see Owner Blockers) | partially built |
| 10 | **Sage conversion** | everything above being provably correct | deliberately last |

---

## Why the order is what it is

**Statements come first** because every return downstream is assembled from
them. Form 1120-S Schedule L *is* the balance sheet. Schedule M-1 *is* the
reconciliation between book income and tax income. If the statements are wrong,
the returns are not merely wrong — they are **confidently** wrong, signed, and
filed. That is the worst outcome this system can produce.

**Period close comes second** because a statement is only true as of a moment.
Without a lock, last month's income statement changes every time someone posts
a correcting entry, and a return filed from it stops matching the books that
produced it. The close machinery already exists in the database (migration
0172 gives `gl_close_period`, which refuses to close a period containing
unposted drafts, and `gl_reopen_period`, which demands a written reason). What
is missing is the screen — today, closing a month means calling a database
function by hand, which is not something Michael should have to do.

**Basis and AAA come third** because they are computed from the equity
statement, and because they decide the single most expensive question in an
S-corp: whether a distribution is tax-free or a capital gain. Getting this
wrong is not a rounding error.

**1120-S and the K-1 come fourth**, assembled from the three statements plus
AAA. **The 1040 and §199A come fifth**, because a 1040 reads the K-1 that #4
produces — building it earlier means typing K-1 numbers in by hand, which
defeats the purpose. **Payroll returns come sixth**, because 941 and W-2 must
agree with wages already on the 1120-S. **B&O comes seventh**, reading revenue
off the income statement. **The forms builder comes last** because it
generalizes a pattern, and a pattern cannot be generalized from one example.

---

## Detail per slice

### 1. Financial statements — SHIPPED (books-17, PR #989, merged 5e1c1a37)

Four reports, per entity and combined, with eliminations:

- **Income statement**, presenting the 280E wall honestly: gross receipts, then
  cost of goods sold, then a hard line, then the operating expenses that are
  real money out the door and *not deductible*. One page should show both the
  number the IRS cares about and the number Michael's bank account cares about,
  and make the gap between them obvious.
- **Classified balance sheet**, ordered per Reg S-X 5-02.
- **Statement of cash flows**, indirect method (ASC 230).
- **Statement of stockholders' equity**, which for an S-corp is where the
  Accumulated Adjustments Account lives and is the input to slice 3.

Hard requirement, standing rule 27b: **a statement that does not tie must not
render.** No plugs, ever.

**Shipped as PR #989.** All four statements built, plus stock basis and AAA.
Fourteen refusal codes; the engine returns no numbers at all when the books do
not tie, when counted cash disagrees by a single cent, or when accumulated E&P
is unconfirmed. AAA deliberately carries **no zero floor** while stock basis
does — §1368(e)(1)(A) disregards "but not below zero" and §1367(a)(2) does not,
so they are tracked as genuinely different numbers.

Seven defects were found by attacking the suite *after* it was already green;
the seventh (authorities cited by nothing) had left a load-bearing authority
orphaned through 130 passing tests. All fixed at the class level.

**Combined statements and eliminations were NOT built.** The four ledger
entities are real but the intercompany eliminations have no evidence behind
them yet, and inventing them would be standing rule 1. Per-entity statements
work today; the combined view waits for the intercompany detail.

**What changed underneath everything:** Michael obtained the FASB Codification
on 2026-08-20. Four presentation rules that previously rested only on the
conceptual framework or on Regulation S-X — which does not bind this entity at
all — now rest on binding GAAP: ASC 205-10-45-1 and 45-1A, ASC 210-20-45-4,
ASC 230-10-45-7, ASC 330-10-30-1. Every quote is verbatim and mechanically
verified against the source rather than trusted.

### 2. Period close screen — SHIPPED (books-18, PR #992)

Delivered as `period-close-core.ts`: a pure engine that answers the question the
database cannot. `gl_close_period` and `gl_reopen_period` already know HOW to
close a period; they are deliberately NOT reimplemented, because two opinions
about what "closed" means will drift (standing rule 2). This decides whether a
period SHOULD close.

- **A ten-item checklist**, each item carrying the question in plain English,
  why it matters, what counts as evidence, and its binding authority.
- **`passed: null` is not `passed: false`.** "Nobody looked" and "we looked and
  it is wrong" are different facts, and collapsing them is exactly how an
  unanswered question becomes a passed one. An unanswered check blocks.
- **Two severities, not three.** No "warning" tier, because a warning is a
  button Michael learns to click past, and a control that is habitually
  dismissed is not a control (standing rule 27).
- **Every reason at once.** A checklist that reveals one problem per attempt
  turns a ten-minute close into a ten-round argument.
- **A period-identity gate**: the entity must be one of the four sets of books,
  the month 1–12, the year 2026–2100 — every bound copied from the `gl_periods`
  check constraints rather than chosen.
- **The month must have finished.** Closing August on 20 August seals a month
  with eleven days of sales still to come.
- **Reopen mirrors the database exactly**, including the 3-character minimum
  reason, so the screen never accepts a reason the server then rejects. A
  `locked` period never reopens — the route is an amended return.

Four verbatim ASC 250 authorities behind it, each mechanically verified against
the Codification text in `docs/authorities/` rather than carefully typed
(standing rule 35).

**What books-18 taught, at some cost:** the suite went green on its first run
with 81 passing tests, and attacking it afterwards (standing rule 33) found
**seven real defects in about ten minutes** — including the engine cheerfully
reporting "Period 2026-NaN is ready to close. All 10 checks pass." An eighth
was found by the mutation harness: the mentor coverage gate could be switched
off entirely with `if (false)` and every test still passed, because its
self-check re-implemented the gate's logic instead of running it. All eight are
now permanent tests. 110 tests, 22 mutants, zero survivors.

**Still to build on top of this engine:** the screen itself, and reuse of the
gate for cut-over gates G1–G5.

### 3. Basis and AAA tracking — SHIPPED (books-19, PR #993)

Stock basis and debt basis per shareholder (IRC §1367), the Accumulated
Adjustments Account (IRC §1368(e)(1)), OAA, and the distribution ordering rules.
Handles the three-shareholder reality: Michael 85%, his mother 10% (allocated,
**not** paid), his grandfather Nicholas Mullan 5% (paid).

Shipped as `basis-aaa-core.ts` (pure engine, integer cents),
`basis-aaa-authorities.ts` (14 verbatim authorities, all machine-verified) and
`basis-aaa-mentor.ts` (a lesson for every exported function). 124 tests.

**What the engine now enforces**

- The two ordering rules are genuinely different code paths, because the law
  makes them different. Stock basis follows §1.1367-1(f): increases, then
  distributions, then nondeductible expenses, then losses. The AAA follows
  §1.1368-2(a)(5), where the net negative adjustment is deferred until AFTER
  distributions. Implementing one and reusing it for the other is the classic
  error and would have understated the AAA.
- A net negative adjustment is the EXCESS of reductions over increases
  (§1368(e)(1)(C)(ii)), not the whole reduction. The first draft got this wrong
  and it was caught on the first test run; see standing rule 38.
- Losses suspended under §1366(d)(1) carry forward indefinitely under
  §1366(d)(2)(A) and are pooled with the following year's losses. Loss used
  plus loss suspended must always equal loss available — asserted directly.
- Opening balances for any year after the first must have been produced by
  `carryForward`, not typed in. A hand-typed opening balance produces a year
  that foots perfectly and is still wrong.
- A shareholder name in next year's figures that matches nobody is refused
  rather than silently treated as zero.

**The one-class-of-stock question, answered properly**

The engine neither shrugs nor cries wolf. §1.1361-1(l)(1) makes the test turn on
whether all outstanding shares confer IDENTICAL RIGHTS to distribution and
liquidation proceeds — a question about the charter, the bylaws, state law and
any binding distribution agreement, **not** about whether the cheques happened to
be proportionate. The regulation's own Example 2 has one shareholder paid a full
year after another and still finds a single class of stock. So disproportionate
distributions are not, by themselves, a second class of stock.

But the last sentence of §1.1361-1(l)(2)(i) does not let it go entirely:
distributions that differ in amount "are to be given appropriate tax effect in
accordance with the facts and circumstances". The gap has to be characterised as
something — a loan from the company, additional compensation, or a gift between
shareholders. The engine names the variance, names the test, and says what must
be verified.

### 4a. Form 1125-A and the COGS position — SHIPPED (books-20)

Form 1125-A is the schedule that carries cost of goods sold onto line 2 of the
1120-S, so it had to be built before the return that consumes it.

Under §280E, inventory is very nearly the only relief Greenway has, which makes
this the single highest-stakes number on the return. The slice therefore does
something no other slice does: it computes cost of goods sold **both ways** —
the strict §1.471-3(b) reseller reading, and the treatment carried forward from
the grandfather's twelve years of returns — shows the gap between them in
dollars, and refuses to file either one until the owner has made a dated,
named, reasoned, per-year election on the record.

What the slice established from source text rather than assumption:

- **Greenway is a reseller permanently, as a matter of Washington law.** RCW
  69.50.328 forbids a producer or processor from having any financial interest
  in a retailer, so the more generous §1.471-3(c) producer rules are not
  available and never will be while the retail licence is held. This is a
  computed result in the engine, not a configurable field.
- **Twelve consistent years is a METHOD, not an error** — §1.446-1(e)(2)(ii)(a).
  That cuts both ways: it means the treatment cannot simply be corrected going
  forward, and it means changing it requires consent under §446(e) FIRST.
- **A voluntary Form 3115 buys audit protection for the earlier years** — Rev.
  Proc. 2015-13 §8.01, read from the official Internal Revenue Bulletin and
  mirrored into `docs/authorities/`. All eight exceptions in §8.02 were read;
  none applies on the facts as stated today, but two of them are live
  conditions that the advice now surfaces rather than glosses.
- **A positive §481(a) adjustment spreads over four years; a negative one is
  taken in one** — §7.03(1) — and a positive adjustment under $50,000 may
  elect one year under §7.03(3)(c).

The §280E switch (standing rule 8) was tested here and found a real defect:
throwing the repeal switch initially closed the dollar gap to zero, which
looked like good news and was not — the engine had closed it by bending the
conservative yardstick rather than by removing exposure. §280E denies a
"deduction or credit" and says nothing about inventories, so repeal does not
change what §471 allows into cost of goods sold. The gap survives repeal; what
changes is that it becomes a question of TIMING under §162 rather than of
permanent disallowance.

### Correction slice — SHIPPED (books-21)

Not a roadmap item in its own right; a repair to two that had already shipped,
plus the interest engine that Michael's rate data unblocked.

**The defect.** books-19 and books-20 both hardcoded `FIRST_S_CORP_YEAR = 2026`.
2026 is the books cutover (standing rule 10), not the year of the S election —
Greenway elected around 2015/2016. The constant forced the 2026 opening AAA to
zero, discarding roughly a decade of already-taxed retained earnings and turning
tax-free distributions into reported capital gain under §1368(b)(2). The bug did
not create audit risk; it INVENTED TAX. A second layer: the carry-forward
evidence requirement was gated on `fiscalYear > FIRST_S_CORP_YEAR`, so 2026 — the
only year with live data — was exempt from every evidence requirement in the
module. A rule-12 violation nested inside a rule-11 violation.

**The fix.** `s-corporation-year-core.ts` separates three facts that had been
sharing one number: `SYSTEM_START_YEAR` (2026, the books cutover),
`EARLIEST_PLAUSIBLE_S_ELECTION_YEAR` (1958, a typo bound) and the election year
itself, which is EVIDENCE and has no constant. `"unknown"` is a first-class
third answer and it refuses. Michael's words ("late 2015 - early 2016") are
recorded as `S_ELECTION_AS_STATED_BY_OWNER` — a stated range, not a fact — and the
engine still refuses, because two tax years give two different answers.

**Three of my own planning assumptions were falsified by reading source text:**

- **§6621(c) hot interest cannot apply to Greenway at all.** §6621(c)(3)(A)
  restricts the large-corporate-underpayment rate to an underpayment "by a C
  corporation", and §1361(a)(2) defines a C corporation as one that is not an S
  corporation for the year. This is a real, unadvertised benefit of the election.
  It is implemented as a REFUSAL, and it is stated as good news. It lasts exactly
  as long as the election does.
- **$435 is not stale.** It is the §6651(a) statutory BASE; §6651(j) inflates it.
  The old caveat was right and my assumption about it was wrong.
- **§6699 did not exist in this codebase.** `grep -c 6699` returned 0. Asked what
  a year-late 1120-S cost, the penalty engine applied §6651 — a percentage of tax
  shown — to an S corporation showing none, and answered **$0.00**. Measured, not
  assumed. The real floor is $7,020 for three shareholders at the un-inflated
  base. A system that reports a five-figure exposure as nothing does not fail to
  warn; it recommends the behaviour it exists to prevent.

**Also shipped:** `interest-core.ts` (§6622 daily compounding via BigInt, one
half-up rounding at the end; quarterly re-rating that carries the balance across
boundaries; all five §6621 rates, which are asymmetric; §6699 with its 12-month
cap; the §6651(j) registry). `FEDERAL_SHORT_TERM_RATES` is DELIBERATELY EMPTY and
every computation refuses — carrying a previous quarter's rate forward produces
arithmetic that reconciles against itself and is silently wrong against the IRS.

**Two holes found in existing safety nets (rule 23, fix the class):**

- The books-20 authority-id tripwire matched only `[A-Z0-9_]`, so 29 of 80
  authority ids — every lower-kebab one, including all 10 added here — were never
  checked. It also read only the plural `authorityIds` field, excluding all 25
  singular `authorityId` citations in `tax-penalty-core.ts`. Both closed; 105
  citations now verified.
- My own regression test for the 2026 defect checked the two engines the bug had
  been REMOVED from and not the new module written to prevent it. The mutation
  harness reintroduced `FIRST_S_CORP_YEAR` there and the mutant SURVIVED. Now
  scans the whole accounting directory rather than a hand-written list.

**Verification:** 359 files / 7,103 tests green; tsc clean; 67 quotes machine-
verified verbatim (4 of mine were caught misquoted and corrected); mutation
harness 58 killed / 0 survived / 0 skipped with a no-op + fatal self-check.
§6621, §6622, §6651 and §6699 mirrored under `docs/authorities/federal/`.

### 4b. Form 1120-S and Schedule K-1

Including Schedule L (balance sheet per books), M-1 (book-to-tax
reconciliation), M-2 (AAA), and the K-1 per shareholder. Line 2 comes from the
Form 1125-A built in 4a.

**Known exposure to model, not to hide:** reasonable compensation. Roughly $55k
of W-2 wages against roughly $630k of K-1 income is the classic audit trigger.
The system must say so plainly rather than quietly produce the return.

### 5. Form 1040 and §199A

Michael's personal return, including the two Schedule C activities (the ATM
operation, NAICS 522200, and the landholding/Geiger rental, NAICS 531100 at
$48k/yr), plus the §199A qualified business income deduction researched
properly — including whether a §280E business gets it at all.

### 6. 941 / 940 / W-2 / W-3

The withholding engine built in books-13 already produces every number these
forms need. What is missing is the forms themselves and the calendar of when
they are due. Note the trust-fund exposure already modelled in books-16: these
are penalties on money already withheld and already held.

### 7. WA B&O and local taxes

State business & occupation tax and Port Orchard local taxes, read off the
income statement's revenue lines.

### 8. Forms builder, generalized

Michael described this one most specifically, and it is a product in its own
right rather than a printing feature. **Every form field must know four things
about itself:** where its number came from, whether it may be edited, what the
correct path is if it may not be, and what audit record an override produces.
That is exactly the pattern built in books-13 for payroll — nine blockers, three
severities, one route per stated intent, every route naming the record it
leaves behind. The work is applying it to every line of every form.

### 9. Depreciation (blocked)

More is built than first credited: the MACRS percentage tables are transcribed
verbatim from Pub. 946, the asset classes are defined, and the engine currently
**refuses** the mid-quarter convention rather than faking it — because
mid-quarter is a whole-year test across every asset placed in service and
cannot be decided one asset at a time. Remaining: that whole-year test, the
§179 and bonus elections, and the schedule tying it to real assets. Blocked on
Michael's asset list.

### 10. Sage conversion (deliberately last)

Sage has all four entities commingled. Untangling it lands on top of a system
that is already provably correct, never before.

---

## Also outstanding (not in the mandated chain)

- **R1 — the security finding.** Twenty RLS policies use `for all using
  (is_staff())` on banking, mortgage, holdings, loans, crypto and ATM tables,
  meaning any active employee can read and write Michael's personal and business
  financial data. Proven by execution during the is_admin() audit. Needs
  re-gating to `is_admin()` with read/write split. **Owner decision needed:**
  which tables, if any, managers legitimately need.
- Document vault for the evidence every refusal in this system demands.
- Audit-trail review screen — the events are recorded; there is no screen where
  Michael's grandfather can sit down and review them, which was the point of
  recording them.
- Drift register UI.
- Cron-based tax-rate update fetcher; WA Cares newsletter source.
- Timberland → loan payment matching, deferred until it can post a real journal
  entry rather than a standalone link.

---

## Owner blockers — what Michael still owes

These are genuine blockers. Per standing rule 1 they will not be invented, and
per standing rule 27 the affected engines will keep refusing until the evidence
exists.

1. **The depreciation schedule** — what assets exist, what was paid, when they
   were placed in service. MACRS cannot be built without it.
2. **The work papers.**
3. **Twelve years of tax returns** — the permanent test corpus under standing
   rule 19. If the engine cannot reproduce a return already filed, the engine is
   wrong.
4. ~~**Evidence that Greenway has zero accumulated E&P**~~ — **RESOLVED
   (Michael, Aug 2026).** Greenway has never been a C corporation, was an S
   corporation from formation, and has had no changes in ownership, so there is
   no accumulated E&P and none can have arisen. The basis engine therefore takes
   `hasAccumulatedEarningsAndProfits: false` as a stated fact rather than an
   assumption. It remains a REQUIRED input that refuses on `null`: the day the
   answer changes, the whole §1368(c) three-tier apparatus switches on, and
   silence at that moment would be dangerous.
5. **Form 2553 and the CP261 acceptance letter** — proof of the S election.
6. ~~**SUTA rate notice and L&I risk classification**~~ — **RESOLVED
   (Michael, Aug 2026).** Both were supplied and are in the dated rate registry
   built in books-15, so they are evidenced rows rather than constants. Michael
   believes payroll taxes are now complete end to end.
7. **Tax rates pending confirmation** — IRC §6621 quarterly underpayment rates,
   the DOR 2026 annual rate, and the §6651(j) 60-day minimum. Michael is
   gathering these.
8. **Whether Greenway has ever adopted the recurring item exception under
   Treas. Reg. §1.461-5** — raised by books-17. The excise tax accrual turns on
   economic performance under §1.461-4(g)(6). If the recurring item exception
   was elected, an excise liability can be deducted in the year it accrues even
   when paid shortly after year end; if it was not, it cannot. This is an
   accounting-method fact recorded on a filed return, so it comes from the
   returns, never from reasoning about what would be sensible. The tax bridge
   will keep presenting both treatments until the returns settle it.
9. **Intercompany detail between the four ledger entities** — blocks the
   combined statements and the eliminations described in slice 1.

---

## Completed slices

| Slice | Feature | PR |
|-------|---------|-----|
| books-01…09 | GL foundation, chart of accounts, posting service, trial balance, opening balances, owner override, fixed assets | various |
| books-10 | vendor bills → GL, 280E cost classes | #979 |
| books-11 | payroll → GL | #980 |
| books-12 | bank matching | #981 |
| — | standing rule 20a (`--rebase`, not `--squash`) | #982 |
| books-13 | payroll withholding: W-4, Worksheet 1A, 2026 tables, 8 wage bases, 9 mentoring blockers | #983 |
| books-13 | closing report — `docs/books-roadmap-remaining.md` | #984 |
| books-14 | L&I employee share taken from the rate notice, not half of medical aid | #985 |
| books-15 | rates become dated, evidenced rows — never constants | #986 |
| books-16 | penalties and interest for all five agencies, with a CPA who explains each | #987 |
| books-17 | financial statements: 280E wall on the face, basis and AAA, binding GAAP | #989 |
| — | standing rules 33–37, learned from books-17 | #990 |
| — | `docs/authorities/` — 3,922 pages of source text + verbatim verifier | #991 |
| books-18 | period close gate: an unanswered check is not a passed check | #992 |
| books-19 | basis and AAA tracking; federal source text mirrored so quotes are machine-proved | #993 |
| books-20 | Form 1125-A: cost of goods sold computed BOTH ways, with a dated election on the record | #994 |
| books-21 | the S-corporation year is EVIDENCE not a constant; §6621/§6622 interest; §6699 found missing entirely | #995 |
| books-22 | owner-only screens gathered into the Accounting and Lyman tabs; the Audit Log became the OWNER-ONLY Security Log; the first test that compares what the menu advertises against what the page enforces | #996 |
| books-23 | the inventory-audit posting engine was 767 lines no screen could reach; it now has a Post button, an owner-only approval gate, and blind counting for staff | TBD |
| — | standing rules 40–41, learned from books-19 | #993 |
| — | standing rules 48–49, learned from books-22 (a check that cannot classify its input must FAIL not skip; when right and wrong return the same value today, test the structure) | #996 |
| — | standing rules 50–51, learned from books-23 (a module only its own test imports is dead code wearing a green check mark; a write that can be blocked without error must be counted) | TBD |

---

## How to use this file

Read `todo.md` for the standing rules (1–32) first — they are binding repo law
and rule 21 defines the method every slice follows. Then read this file to see
what is next. Then read `docs/books-roadmap-remaining.md` for the plain-English
explanation of why it matters.

Update the status table above the moment a slice merges. A roadmap that is not
maintained is worse than no roadmap, because it is trusted.
