# The forms and lessons roadmap — the tracker

**Why this file exists.** Michael, August 2026: *"Please make sure we track that
roadmap so we don't drift."* A roadmap that lives only in a chat transcript is a
roadmap that evaporates at the next context boundary. This file is the compass.

**And a second reason, stated plainly.** Michael has spent about $24,000 of a
$30,000 self-imposed ceiling. Roughly $6,000 remains. Drift is not merely
untidy here — it is the thing that runs out the budget before the work is done.
So this file also records **what is deliberately NOT being done**, because an
unwritten "not now" gets rediscovered and re-debated at cost.

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
| 940 | 18 | 21 | `2025_FORM_940_-_SAGE.pdf` |
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
- [ ] **1b. 941: 13 → 25 lines.** Missing 4, 5b, 5d, 5f, 8, 9, 11, 15b, 15d, 16, 17, 18.
- [ ] **1c. 940: 18 → 21 lines.** Missing 1a, 1b, 2, 4a–4e detail.
- [ ] **1d. Count and close the four Washington forms.**

## Step 2 — The form with no teaching at all

- [ ] **2a. DOR Combined Excise Tax Return.** Retailing B&O, Service & Other,
      Retail Sales, local rate by location code. Reference specimen is
      `JULY.pdf`: total 16,526.06, confirmation 0-053-958-352.

## Step 3 — The visual form layer

- [ ] **3a.** One shared renderer driven by the teaching tables — not seven
      hand-drawn pages that drift apart.
- [ ] **3b.** Every box a live click target into its lesson.
- [ ] **3c.** Print-correct HTML/CSS with `@page`, so it prints like the paper
      form for sitting with the preparer.

## Step 4 — Real figures (deliberately last)

- [ ] **4a.** Populate from actual business activity, preserving the
      never-show-a-fake-zero rule. Last because real dollars on a form-shaped
      page is where a display bug becomes a filing error.

## Then

- [ ] **5a. Intercompany rent** between the four entities (open question 6).
- [ ] **5b. The ATM business.**

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
