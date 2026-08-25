# The forms and lessons roadmap — the tracker

**Why this file exists.** Michael, August 2026: *"Please make sure we track that
roadmap so we don't drift."* A roadmap that lives only in a chat transcript is a
roadmap that evaporates at the next context boundary. This file is the compass.

**And a second reason, stated plainly.** Drift is not merely untidy here — it is
the thing that runs out the budget before the work is done. So this file also
records **what is deliberately NOT being done**, because an unwritten "not now"
gets rediscovered and re-debated at cost.

### The budget, reconciled by the owner (August 2026)

An earlier version of this file said "about $24,000 of a $30,000 ceiling,
roughly $6,000 remains," and the books-52 report flagged that Michael had stated
two different totals ($24,000 and "about 22k"). He then reconciled it himself:

> *"I have spent in total 24k, I just purchased 2k worth of credits. So I have 2k
> of credits to work with currently. After we spend these tokens, I will allow
> myself to buy another 6k worth of tokens. That's how I arrived at the 8k
> figure."*

So the arithmetic is **$24,000 spent · $2,000 in hand · $6,000 more authorised
= $8,000 of runway**, and the $30,000 ceiling holds. The discrepancy is closed:
there was no error, the two figures were spend-to-date versus spend-before-the-
latest-purchase. **This is a recorded owner-stated fact, not an estimate.**

---

## Priorities, restated by the owner (August 2026)

Michael changed the ordering after books-52. His words, and what each one means
for this file:

> *"We can put the k-1, 1120s, and 1040 on the back burner, finish them last only
> if the platform is truly ready to use and there is left over tokens to build
> it. My grandpa will continue filling out those forms."*

> *"I want to wow him with a set of accurate and confident statements for him to
> use to build my federal forms."*

**This is the actual product goal, and it is narrower and more achievable than
building the income-tax returns.** The deliverable is not a Form 1120-S; it is a
set of statements the preparer can rely on. That reframes Step 4.

> *"After we will build the physical forms, that is truly useful to me. I file all
> payroll and state taxes and such. So I need accurate numbers and I need a way
> to visualize them so I can reproduce them on my various tax agency portals."*

**The visual form layer is not cosmetics.** It was demoted in the original plan
as "cosmetics last," and that was wrong: Michael keys these figures into agency
portals by hand, so a screen laid out like the real form is the working tool that
prevents transcription errors. Renamed accordingly below.

> *"The atm needs to be connected so it's a high priority slice. The rent is also
> high priority. The bank feeds need to be a high priority as well. I don't think
> they are connected to the books. We need to go through all the various
> activities that would and should be posted to the journals and ledgers, need to
> be connected to the books."*

**Promoted to their own step.** Note the owner's own hedge — *"I don't think they
are connected"* — is a belief, not a verified fact, and is recorded as such. It
must be **measured** before anything is built on it (rule 87). That measurement
is step 5a and is cheap.

> *"I am hoping we can finish building everything except for the k-1, 1120s, and
> 1040."*

Every row is checked off only with evidence. No row is marked done because it
felt done.

---

## The strategy, and why it is in this order

The agreed sequence is **coverage before cosmetics**.

The teaching metadata already exists and its architecture is sound: one function
`teachingBoxes(formId)` returns the boxes of a form, and a hard rule ensures a
box with no computed figure is never displayed as `0.00`. What is missing is
**boxes** and, after that, the **visual form layer**.

Building pixel-accurate forms first would produce a beautiful W-2 where clicking
box 14 does nothing — worse than the plain version, because the interface would
have promised something it cannot deliver.

---

## Measured coverage — the baseline, taken at books-52

Counts on the left from the code; counts on the right from `pdftotext -layout`
of Michael's own filed forms. Nothing here is an estimate.

| Form | Taught at baseline | On the real form | Source of the right-hand count |
|---|---|---|---|
| W-2 | 8 | 19 numbered + 5 lettered | `2025_FORM_W-2_EMPLOYEE.pdf` |
| 941 | 13 | 25 | `2ND_QTR_FORM_941.pdf` |
| 940 | 18 | ~~21~~ **30** | `2025_FORM_940_-_SAGE.pdf` |
| ESD 5208A | 3 | to count | `1ST_QUARTER_FORM_5208A.pdf` |
| ESD 5208B | 4 | to count | — |
| PFML / WA Cares | 3 | to count | — |
| L&I quarterly | 4 | to count | — |
| **DOR Combined Excise** | **0 — no table exists** | 4 line groups + local | `JULY.pdf` |

**Baseline total: 53 taught boxes across 7 forms.**

### A structural constraint discovered before writing any code

A box cannot simply be added to the teaching table. `resolveWhose` **throws**
unless that box also exists in the adapters' `FORM_*_WHOSE` classification
table, because "whose money is this" must have exactly one answer in the
codebase and the teaching file is deliberately not allowed to hold a second
copy. Adding a box is therefore always **two** coordinated edits, and the
classification is the legally consequential half.

**Corrected in books-54: it is THREE edits, not two.** A box that is also to be
*taught* needs (a) a teaching specimen in `form-box-teaching-core.ts`, (b) a
classification in the adapters' `FORM_*_WHOSE`, and (c) a `BoxLesson` in the
relevant `form-box-lessons-*.ts`. Miss (b) and `resolveWhose` throws loudly,
which is the safe failure. Miss (c) and **nothing fails at all** — the box
appears on screen, invites a click, and teaches nothing. That is the quiet half
of the coupling and it is the one worth writing down.

**Also corrected in books-54: a fourth thing that nothing checked.** Every
lesson carries `tiesTo` cross-references, and no gate verified the target box
existed. **2 dead** were found — both in `form-box-lessons-wa.ts`, both pointing
at `esd_5208b` box `"wage-detail"`, which has never existed (the real columns
are `wage-detail-wages`, `-hours` and `-total`). Pre-existing since books-47
slice D. Closed by `assertEveryTieResolves`, now applied to every lesson set.

**Correction issued in books-55 to a number this document and the books-54
owner report both stated wrongly.** That paragraph originally read "Measured: 56
ties, 2 dead". The 56 was wrong when it was written; the true figure at the time
was 62. It was a partial count — taken over four lesson sets while six exist —
and it was reported to Michael in the books-54 summary as though it were the
whole population. The two dead ties were real and are genuinely fixed; only the
denominator was wrong.

Recorded here rather than quietly overwritten, because the failure was not
arithmetic. It was reporting a measurement without checking that the thing
measured was the whole of the thing described, which is the same mistake as the
gates that checked four of six lesson sets, three of four ownership tables and
one of two explorers on a shared page.

Counted at books-56, by loading every lesson module and summing `tiesTo`. The
books-55 figure is kept in the right-hand columns rather than overwritten,
because the movement is the interesting part and a table that only ever shows
today's number cannot be audited against the slice that produced it:

| lesson set | lessons | ties | was (books-55) |
| --- | --- | --- | --- |
| `form-box-lessons-941.ts` | 20 | 19 | 20 / 19 |
| `form-box-lessons-940.ts` | 20 | 20 | 20 / 20 |
| `form-box-lessons-wa.ts` | 14 | 11 | 8 / 4 |
| `form-box-lessons-w2.ts` | 26 | 20 | 20 / 13 |
| `form-box-lessons-w3.ts` | 31 | 34 | 31 / 34 |
| `form-941-confirmation-lessons.ts` | 4 | 6 | 4 / 6 |
| **total** | **115** | **110** | **103 / 96** |

Every one of the 110 resolves to a box that exists. The W-3 is the first set
with more ties than lessons, which is what a transmittal should look like: most
of its boxes have to agree with something on another form.

### What moved in books-56, and which of it was not planned

The `form-box-lessons-wa.ts` row going 8 → 14 was the plan: six lessons for the
six Washington boxes that had a specimen and no teaching.

The `form-box-lessons-w2.ts` row going 20 → 26 was **not** planned, and it is
the more useful finding. Form W-2 prints six lettered boxes above box 1 — a
(employee's SSN), b (employer's EIN), c (employer's name and address), d
(control number), e (employee's name), f (employee's address). None of the six
existed anywhere in this system: not in `FORM_W2_WHOSE`, not in
`FORM_W2_TEACHING`, and so not teachable at all, because `resolveWhose` throws
on a box it does not know.

They were missing for a reason worth writing down. Every earlier slice built
this form outward from what the W-2 **engine computes**, and the engine computes
money. Nothing computes a person's name, so the name never reached the screen.

The gap was found by a gate, not by reading. One of the six new Washington
lessons — the ESD 5208B employee row — tied itself to `form_w2` box `e`, since
that is where the same person's name appears on the federal form.
`assertEveryTieResolves` refused the tie and printed the twenty boxes the W-2
had. The tie was right about the paper; the specimen was wrong.

This matters more than a count. Boxes a, e and f are the SSN, the name and the
address — the three fields the SSA matches on. A wrong figure in box 1 is
arithmetic and gets queried. A wrong **name** in box e is silent: the filing is
accepted, nothing on Greenway's side looks wrong, and years later an employee
finds a year missing from their earnings record. Michael prepared all ten of
Greenway's 2025 W-2s himself. The boxes with the quietest failure mode were the
boxes with nothing behind them.

`form_w2` therefore now teaches 26 boxes, not 20, and the two owner reports that
pinned 20 carry a dated correction rather than a rewrite.

The drift gate `assertSpecimenMatchesTheEngine` runs one way only — every box
the engine emits must be taught. It does not require that every taught box be
emitted by the engine. So teaching a box the engine does not yet compute is
allowed, and is exactly what `notComputedYet` exists for.

---

## Step 1 — Fill the box coverage

- [x] **1a. W-2: 8 → 19 boxes.** Add 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19,
      20. Verbatim IRS instruction text confirmed present in the mirrored
      authority for every one before starting. **Done in books-52: 20 boxes,
      12 lessons, 20 classifications.**
- [x] **1b. 941: 13 → 27 lines. COMPLETE — every line on the printed form is
      taught.** The target said 25 and listed "15c, 15e" without 15d. Both were
      wrong. Reading the labels mechanically out of `2ND_QTR_FORM_941.pdf` gives
      **27**, because line 15 splits five ways (15a–15e). Trusting this document
      instead of the form would have shipped a slice one line short while
      reporting it finished, so the count now comes from the PDF and is asserted
      against the engine. **Done in books-53: 20 lessons, 27 classifications, 27
      specimens, 28 quotes verbatim, 27/27 mutations caught.**
- [x] **1c. 940: 18 → 30 lines. COMPLETE — every line on the printed form is
      taught.** This entry said **21** and listed the gap as "1a, 1b, 2, 4a–4e
      detail", which is seven boxes. Both figures were wrong, in the same way
      the 941 target was wrong: they were written from memory of the form rather
      than from the form. Reading `2025_FORM_940_-_SAGE.pdf` line by line gives
      **30**, because line 15 splits five ways (15a–15e) exactly as the 941's
      does, and line 16 splits four (16a–16d). The real gap was **twelve**: 1a,
      1b, 2, 4a–4e and 15b–15e.

      A label regex was tried first and could not be trusted — it returned "24"
      and "25" out of a paragraph of body text and MISSED 4a, 4c, 4d, 4e, 15b
      and 15d because a lowercase word followed them. Every one of the thirty
      was confirmed by reading its surrounding line instead.

      **Done in books-54: 20 lessons, 30 classifications, 30 specimens, 13 new
      verbatim quotes, 30/30 mutations caught.** The mutation figure matters
      here: before this slice a sweep of four rows caught only three, and the
      row that survived was **line 17**, the annual total that must equal line
      12 to the cent. That hole was **pre-existing**, measured before anything
      was changed (rule 106).

- [ ] **1d. Count and close the four Washington forms.** Next slice
      (books-55). Weakest point measured: `esd_5208b` has 4 specimens and **0
      lessons**. Also carries the PFML / WA Cares CSV export against ESD
      specification v8.1 (2025.08).

## Step 2 — The form with no teaching at all

- [ ] **2a. DOR Combined Excise Tax Return.** Retailing B&O, Service & Other,
      Retail Sales, local rate by location code. Reference specimen is
      `JULY.pdf`: total 16,526.06, confirmation 0-053-958-352.

## Step 3 — The physical forms (a working tool, NOT cosmetics)

Reprioritised on the owner's instruction: *"After we will build the physical
forms, that is truly useful to me... I need a way to visualize them so I can
reproduce them on my various tax agency portals."* He hand-keys these figures
into state and federal portals, so a page laid out like the real form is what
prevents a transcription error. This is not decoration.

- [ ] **3a.** One shared renderer driven by the teaching tables — not seven
      hand-drawn pages that drift apart.
- [ ] **3b.** Every box a live click target into its lesson.
- [ ] **3c.** Print-correct HTML/CSS with `@page`, so it prints like the paper
      form for sitting with the preparer.
- [ ] **3d.** Layout must place each figure **next to its real line number**, so
      the screen can be read straight across to a portal field. A pretty form
      whose numbering does not match the agency's is worse than a plain list.

## Step 4 — Real figures, and the statements for the preparer

The owner's actual goal, in his words: *"I want to wow him with a set of accurate
and confident statements for him to use to build my federal forms."* The
deliverable is **not** a 1120-S — it is a set of statements his grandfather can
rely on. That is a smaller and more honest target.

- [ ] **4a.** Populate from actual business activity, preserving the
      never-show-a-fake-zero rule.
- [ ] **4b.** The preparer-facing statements: trial balance, income statement,
      balance sheet, and a wage/tax reconciliation that foots to the filed 941s
      and W-3. Every figure traceable to the journal entries behind it.

## Step 5 — Connect everything that should hit the books (HIGH PRIORITY)

Promoted on the owner's instruction: *"The atm needs to be connected so it's a
high priority slice. The rent is also high priority. The bank feeds need to be a
high priority as well."*

- [ ] **5a. MEASURE FIRST — what is actually posting to the journals today?**
      Michael believes the bank feeds are *"not connected to the books"* but said
      *"I don't think"* — a belief, not a verified fact. Before building
      anything, enumerate every activity that produces or should produce a
      journal entry and report which are wired, which are half-wired, and which
      are absent. Cheap, and it prevents building on a guess (rule 87).
- [ ] **5b. Intercompany rent** — cannabis and ATM pay the landholding entity
      (open question 6). Must post to **both** sides: expense in the payer,
      income in the landholder.
- [ ] **5c. The ATM business** connected to the books.
- [ ] **5d. Bank feeds** posting to journals and ledgers.

## Step 6 — Only if the platform is genuinely usable and money remains

Owner: *"We can put the k-1, 1120s, and 1040 on the back burner, finish them
last only if the platform is truly ready to use and there is left over tokens to
build it. My grandpa will continue filling out those forms."*

- [ ] **6a.** Schedule K-1, Form 1120-S, Form 1040. **Explicitly deferred.**
      Not started while any item in steps 1–5 is open.

---

## Deliberately NOT doing (so it is not rediscovered and re-debated)

- **Correcting the multi-statement ownership reshuffle limitation.** The
  pre-existing statement-level sum trigger refuses a legitimate two-step
  reshuffle because it sees the intermediate 95% total. Ownership changes must
  currently be a single statement. Recorded in books-51, not fixed. Rule 4.
- **Mirroring IRC §1372 and §318.** Not in the repository, therefore nothing is
  computed from them and no fringe-benefit or family-attribution conclusion is
  drawn anywhere. The box 14 `HEALTH` question is routed to the preparer.
- **Boxes 14b (Treasury Tipped Occupation Code) and the box 12 code catalogue in
  full.** Box 12 is taught as a box, with the codes that can actually occur at
  Greenway named. Enumerating all ~26 codes is cost with no benefit for a
  ten-employee cannabis retailer.

---

## Progress log

| Slice | What it did | Evidence |
|---|---|---|
| books-50 | Roster corrected to four shareholders | Found $2,340 behind a balanced total |
| books-51 | Empty-roster guard + owner report | 44/44 against real PG15 |
| books-52 | **Step 1a: W-2 8 → 20 boxes** | 12 new lessons + 12 classifications; 315 quotes verbatim repo-wide; 13 mutations all caught |
| books-52 | **Closed a pre-existing hole found by mutation** | `assertWithheldMoneyIsNeverTheEmployers`: 10 mutations red after, same mutation green before |
| books-52 | **Fixed a gate that punished progress** | books-49 box counts made a ratchet; proven red by cutting W-2 to 6 boxes |
| books-53 | **Step 1b: 941 13 → 27 lines, form COMPLETE** | 15 new lessons, 27 classifications, 27 specimens, 28 quotes verbatim; 27/27 ownership mutations caught |
| books-53 | **Closed a pre-existing hole: 20 of 24 lines had no ownership test** | `assertEvery941LineOwnershipIsPinned` + `assertAdditionalMedicareTaxHasNoEmployerShare`; line 13 mutation green before, red after |
| books-53 | **Fixed a pre-existing mislabel: line "15" → "15a"** | IRS and the printed form both say 15a; no test asserted the label, so nothing caught it |
| books-53 | **Fixed 4 prose fields with typesetting damage** | literal `\n` + indentation inside sentences Michael reads; new gate catches the whole class |
| books-53 | **Recovered a clobbered source file** | `form-box-adapters.ts` had lost 787 lines / 19 exports; caught by `tsc`, restored by mechanical splice |

### What books-53 found by breaking things

**1. Twenty of twenty-four 941 lines could be relabelled with nobody noticing.**
Changing line 5d from `employee_money` to `shared` — asserting that Greenway
pays half of the Additional Medicare Tax, when the instructions in this very
repository say *"There is no employer share of Additional Medicare Tax"* —
passed all 11,046 tests. Rule 106 says establish whether a hole is new before
taking credit for closing it, so I mutated line **13**, untouched since
books-49: also green. The hole was **pre-existing**; books-53 only widened it
from 13 lines to 24. Only lines 1, 2, 3 and 5a had named tests.

The fix pins all 27 lines in a hand-written table checked in both directions, so
an ownership change cannot be silent *and* a newly added line fails until
somebody writes down whose money it is. It duplicates data on purpose, which
rule 25 normally forbids: the two copies exist for opposite reasons, and a gate
that imports its expectation from the thing it checks asserts nothing.

**2. A source file had been clobbered, and only the type-checker knew.**
`form-box-adapters.ts` was down to 136 lines from 869 — 19 of 20 exports gone,
including the gate books-52 had just added. Every targeted test I would
naturally have run still passed, because the tests that exercise the missing
exports could no longer import them. `tsc --noEmit` caught it in seconds. This
is the concrete argument for type-checking before testing: **vitest transpiles
without type-checking**, so a green test run says nothing about whether the
module still exists in one piece.

**3. My own fix for a cosmetic defect introduced five more of them.**
Four `whereItComesFrom` fields had a literal `\n` plus six spaces of source
indentation baked into a sentence — invisible to every length and content check,
visible to anyone reading the screen. I replaced the escape with a space; three
of the four strings already ended in a space, so I created double spaces
instead, and a fifth instance I had not spotted survived untouched. The new gate
caught all five immediately. Then the broad `sed`-style cleanup I wrote to fix
them reflowed **Michael's own verbatim quoted instruction** in the file header,
which I only found by reading the diff rather than trusting the green suite.
Lesson recorded plainly: a mechanical fix needs the same suspicion as a
mechanical test (rule 22a), and the diff is part of the verification.

### What books-52 found by breaking things

Three things worth remembering, because each was invisible to a passing suite.

**1. A hole that let withheld money be relabelled as the employer's.** Changing
W-2 box 19 from `employee_money` to `employer_cost` — saying a tax taken out of
a worker's cheque was actually Greenway's expense — passed the whole suite. The
same mutation on box 17, which shipped long before books-52, also passed, which
proves the hole was **pre-existing, not introduced by this slice** (rule 106).
The 940 had `assertFutaIsNeverEmployeeMoney` guarding the mirror-image error;
the W-2 had no counterpart. It does now, and it is deliberately narrow: box 12
code DD really *is* employer money, so a blanket "no W-2 box is employer_cost"
rule would have been false and would have had to be weakened later.

**2. My first attempt to test that gate was itself invalid.** I mutated all five
withholding boxes and every mutation still passed — which I nearly recorded as a
failure of the new gate. It was not: I was running the wrong test file, and the
gate never executed. The tell was box 4, whose mutation should have tripped the
*pre-existing* Social Security gate and did not. A test run that cannot fail for
reasons unrelated to the code proves nothing (rule 22a).

**3. A gate that would have punished every future slice.** The books-49 figures
were pinned with `toBe(53)` and `form_w2: 8`, comparing a **dated letter** to a
**living engine**. Growing W-2 coverage turned the suite red although nothing
was broken. Anyone hitting that would learn to edit the number until green. It
is now a ratchet: the report's prose stays pinned exactly, while the engine may
grow freely but may never silently shrink.
