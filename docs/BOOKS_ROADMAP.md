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
| 4b | **Form 1120-S and Schedule K-1** | the statements + AAA/basis + 1125-A | **DEFERRED — see THE AGREED ORDER below** |
| 5 | **Form 1040 and §199A** | the K-1 produced by #4 | **DEFERRED — blocked on Form 7203** |
| 6 | **941 / 940 / W-2 / W-3** | payroll engine + the returns above | **IN PROGRESS — 941 books-40, WA quarterly books-41, 940 + W-2/W-3 authorities books-43** |
| 7 | **WA B&O and local taxes** | the income statement's revenue lines | not started |
| 8 | **Forms builder, generalized** | the pattern proven across #4–#7 | **PROMOTED — becomes slice D below, at Michael's request** |

---

## THE AGREED ORDER — books-44 onward (Michael, Aug 2026)

**This section supersedes the ordering of items 4b, 5 and 8 above.** It was
agreed after the books-43 recon and Michael confirmed it verbatim:

> *"I agree with the roadmap and strategy and order. Let's start with c first,
> then a, then d, then b last as recommended. I will be ready with what you need
> by then. Please make sure to record everything we have just worked out as the
> strategy and roadmap going forward for the next several slices. I don't want
> to miss something and drift from what's important."*

That last sentence is the reason this section exists. Conversations compact;
this file is the memory that survives.

| Order | Slice | What it is | Why it sits here |
|-------|-------|-----------|------------------|
| **C** | **Connect the unreachable teaching** | wire the 6 mentor modules no screen renders; fix the 9 broken RCW citations; retire the duplicate float rounding helper | **CHEAPEST REAL GAIN.** The teaching is already written, already tested, already paid for — and Michael cannot read a word of it. Nothing new has to be invented, only connected. |
| **A** | **Finish the W-2 / W-3 engine** | boxes 1–6, box 12 codes, boxes 15–20, W-3 totals, the W-3 ↔ four-941s reconciliation | Natural continuation of books-43, whose authorities are already merged and verified. |
| **D** | **The Form / Why / Check tab system** | render the actual form, box by box, with per-box authority on click | Michael is a visual learner and said the verbatim panels are "hard to digest as there is a wall of words and color". Built ONCE, generically, so every form inherits it. |
| **B** | **K-1, 1120-S, 1040** | the entity return, the shareholder schedule, the personal return | **LAST ON PURPOSE** — see the blocker note below. |

**Added by Michael, books-45:**

| Order | Slice | What it is | Why it sits here |
|-------|-------|-----------|------------------|
| **E** | **WA DOR Combined Excise Tax Return** | the monthly DOR return: cannabis sales, non-cannabis sales, and ATM surcharge income, each classified correctly, shown as a visual facsimile before Michael keys it into My DOR | Michael's own request. **Monthly** — twelve filings a year against the 941's four and the 1120-S's one — and it is the only screen where all three revenue streams must be classified on one page. **Not** the LCB return already built; see §7. Waiting on his filed **July** return to reconcile against. |

Where E sits is Michael's call. It is placed after D on the assumption that the
Form/Why/Check tab system should exist first, so the DOR return inherits the
per-box authority treatment instead of being built twice — but if the monthly
filing is causing pain now, it can move ahead of D and adopt the tab system
afterwards.

### Why B is last, and it is not a matter of taste

The logic and the forms can be built before the data arrives; Michael asked for
exactly that and it is sound. But **Form 7203 decides whether the S-corporation
losses are deductible at all**, and it is not in hand. Building the 1040 around
an unknown basis figure would mean inventing the one number the return turns on,
which is standing rule 1. The structure gets built; the numbers wait.

Michael's own words on this: *"We may not have the info yet we need. But we can
build the logic and forms themselves to be ready to fill with real data once I
have it."* That is the plan — with the discipline that an unfilled field must
REFUSE rather than default (rule 27).

### The two W-2 traps that must survive every future slice

Recorded here because they look like defects and a future maintainer will try to
"fix" them. Both are proven verbatim against mirrored sources in books-43.

1. **Box 1 legitimately exceeds boxes 3 and 5 on Michael's own W-2.** Company-paid
   health premiums for a 2%-or-more shareholder-employee are wages for income tax
   (Instructions, Box 1, item 5) but are carved out of FICA by §3121(a)(2)(B).
   Making those boxes agree either overpays FICA or understates his income. The
   matching 1040 deduction is only available *if it went on the W-2 first*.
2. **Box 17 must be blank.** Washington levies no personal income tax. PFML and
   WA Cares are real employee deductions but they are **box 14**, not box 17.
   Reporting them as state income tax withheld tells the IRS his employees paid a
   tax that does not exist, and invites a deduction they are not entitled to.

### The design decision behind slice D

Three tabs — **Form · Why · Check** — not one wall of text.

* **Form** renders the form as it is actually printed. Populated boxes show real
  figures. Required-but-empty boxes are red. **Correctly-blank boxes are grey and
  labelled "blank on purpose", with the reason.** A box that is *supposed* to be
  empty must never look like one that was forgotten — that distinction is the
  whole point, and box 17 is the worked example.
* **Why** shows the authority for **one box at a time**, on click. Same verbatim
  quotes, delivered at the moment the question is asked instead of forty at once.
* **Check** carries the reconciliations (W-3 to the four 941s, and so on).

**Scope honesty, so this is not oversold:** this is a *worksheet and review*
surface, not a filing surface. Anything printed from it must be marked as such.
Per the standing boundary, we replace the data-preparation half of Aatrix; we do
NOT become a filing agent.

---

## SLICE C — THE RECON FINDINGS, MEASURED — **COMPLETE (books-44 + books-45)**

Everything below was counted from the tree at commit `0131c62b`, not recalled.
The probe: for each `*-mentor.ts`, list importers under `src/` excluding the
module itself and its own `-gates` sibling. Rule 66d applies — existence is
asserted before absence of importers is called "unreachable work".

### C1. Six mentor modules that no screen renders — 82 lessons, 2,100 lines

| Module | Lessons | Lines | Importers under `src/` |
|--------|---------|-------|------------------------|
| `payroll/payroll-onboarding-mentor.ts` | 33 | 746 | **0** |
| `accounting/tax-penalty-mentor.ts` | 20 | 540 | **0** |
| `accounting/interest-mentor.ts` | 10 | 257 | **0** |
| `accounting/period-close-mentor.ts` | 9 | 234 | **0** |
| `accounting/s-corporation-year-mentor.ts` | 5 | 153 | **0** |
| `reports/payroll-reconciliation-mentor.ts` | 5 | 170 | **0** |
| **Total** | **82** | **2,100** | — |

**WHY FOUR OF THESE LINE COUNTS FELL DURING SLICE C, AND THE TOTAL WITH THEM.**
When this table was first written the total was **2,345**. Four of the six
modules imported `node:fs` to read authority text off disk, which meant no
client component could ever import them — the one hard constraint that decided
slice C's whole architecture. So those four were split: the lesson DATA stayed
in `*-mentor.ts`, and the disk-reading coverage checks moved to a sibling
`*-mentor-gates.ts`, per standing rule 65b. The lessons did not change and none
were lost — the count is still **82** — but 245 lines of gate code left the four
files. The `importsNodeFs` column in
`tests/compliance/books-roadmap-agreed-order.test.ts` is now `false` for all six,
and that gate re-derives every figure above from the tree on each run, which is
why this paragraph exists rather than a quietly edited number.

Each is reachable from its own test file and from `owner-report-books-38`, which
is precisely the shape rule 50 warns about: **dead code wearing a green check.**
The tests prove the lessons are well-formed and internally consistent. No test
can prove Michael has any way to read them, because he does not.

**They all share one shape**, verified by reading the declarations rather than
assuming: `{ fn, plainEnglish, whyItExists, theTrap, whatIWouldDo, authorityIds }`.
Four import the type from `basis-aaa-mentor` / `cogs-position-mentor` /
`reports-presentation-mentor`; two declare it identically inline. **One generic
renderer can therefore serve all six** — build it once, not six times (rule 25).

**THE CONSTRAINT THAT DECIDES THE ARCHITECTURE:** four of the six
(`interest`, `period-close`, `s-corporation-year`, `payroll-reconciliation`)
import `node:fs` at module top level, for the build-time coverage gates that read
the core file and assert every exported function is taught. **That import cannot
reach a browser bundle.** The lesson DATA is pure and the gates are not, so the
wiring must import the data without dragging `readFileSync` behind it. Options,
in order of preference: import the data through a `server-only` store, or split
the gates into a `*-mentor-gates.ts` sibling as `ytd-mentor` already does. The
second is the house pattern and is the reason that pattern exists.

### C2. Nine RCW citations that route to files which do not exist

`verify-verbatim-quotes` reports these as hard failures today (they are the
long-standing "9 pre-existing RCW failures" every recent slice has reported
around). Two distinct defects hide in the nine:

* `rcw-50-24-010-*` (2) and `rcw-50-24-014-*` (3) route to
  `state-wa/rcw-50.24.010.txt` / `rcw-50.24.014.txt` — **never fetched.**
* `rcw-50a-10-030-*` (4) route to `state-wa/rcw-50.txt` — **a routing bug**, not
  a missing file. The regex is truncating `50A.10.030` to `50`, the same
  swallow-the-suffix defect that once sent §280E to `usc-280.txt`.

The routing bug must be fixed *before* fetching, or the fetch will be filed under
a name nothing looks for.

### C3. One duplicated rounding helper

`applyMilliPct` exists in two places, one of which does float arithmetic. Money is
integer cents by house law; a float rounding helper on a money path is a latent
penny-drift defect. Retire the duplicate, keep the integer implementation
(rule 25: extend, do not duplicate).

### What "done" looks like for slice C

1. Every one of the 82 lessons is reachable from a real screen a signed-in owner
   can navigate to — proven by a test that walks the route, not by a screenshot.
2. `verify-verbatim-quotes` reports **zero** failures, so the nine cease to be
   permanent background noise that trains everyone to ignore a red line.
3. One `applyMilliPct`, integer-only.
4. The reachability probe from `owner-report-books-38` is UPDATED, not deleted —
   rule 66a requires it to assert the property still holds in both directions,
   so once these six are wired the probe must prove they are *reachable*, and
   must still be able to fail.

#### Status after books-45 — ALL FIVE DONE, SLICE C CLOSED

Criteria 1 and 4 closed in books-44; 2, 3 and the added 5 closed in books-45.
Criterion 5 was not in the original four — Michael asked for worked examples
directly, and it was adopted rather than deferred.

| # | Criterion | Status |
|---|-----------|--------|
| 1 | All 82 lessons reachable from a real screen | **DONE** — `/admin/books/learn`, eight units, gated by `tests/compliance/learning-path.test.ts` |
| 2 | `verify-verbatim-quotes` at zero failures | **DONE (books-45)** — 0 failures, and verified quotes rose 296 → 306 |
| 3 | One `applyMilliPct`, integer-only | **DONE (books-45)** — the float duplicate is retired |
| 4 | The reachability probe updated, not deleted | **DONE** — rewritten from a one-hop string match to a transitive value-import graph walk |
| 5 | Lessons teach with NUMBERS, not only paragraphs | **DONE (books-45)** — `worked-examples-core.ts`, 8 examples, every figure computed by the real engine at render time |

**Criterion 1, in detail.** 82 lessons, 8 units, 0 unplaced, 0 dangling. The
count on the screen is DERIVED from the mentor modules — a test asserts the
literal `82` appears nowhere in executable code across all three files, so a
lesson added to any mentor joins the course without anyone remembering to add
it. The nav entry is held by the exact-list assertion in `nav-gate-core.test.ts`,
which fails both when a screen is added AND when one silently vanishes.

**Criterion 4, in detail.** The old probe asked "does any file under `src/app`
import this module?" — one hop, `@/` aliases only. It reported all six mentors
unreachable *after* they were wired, because the page imports a core which
imports the mentors. It now walks the graph transitively, resolves relative
specifiers too, and ignores type-only imports (which emit no code, verified with
a scratch `tsc` compile rather than assumed). See standing rules 75 and 75a.

**Four modules remain unreachable and are named rather than left dark:**
`basis-aaa-mentor`, `cogs-position-mentor`, `financial-statements-mentor`,
`internal-control-mentor`. COGS/§280E is the next one to surface. The engine
`period-close-core` also stays on the unreachable list — its MENTOR was wired in
books-44, its engine was not, and those are different claims.

**Criterion 2, in detail (books-45).** The prediction above was right that two
distinct defects hid in the nine, and right that the router had to be fixed
first — but both halves turned out to be worse than recorded, and a third
problem was hiding behind them.

*The routing bug was not "a missing file", it was a wrong statute.* `[\d.]+`
cannot express a letter, so `RCW 50A.10.030` captured `50` and the verifier
looked for `rcw-50.txt`. Chapter 50 is the **unemployment** act; chapter 50A is
**Paid Family and Medical Leave**. Had anyone ever placed a `rcw-50.txt` on
disk, four PFML quotes would have been cheerfully "verified" against a different
law. Fixing the class rather than the instance (rule 23) also repaired `50B`
(WA Cares), which nobody had noticed was broken.

*The routing lived in two places and a test already asserted they agreed.* It
passed the whole time, because both copies carried the same bug. An agreement
test proves consistency, never correctness — now standing rule 78. The
replacement gate checks the routed path against **the filenames actually on
disk**, and was proven failable by restoring the old pattern and watching it go
red (the agreement test stayed green, which is the point).

*Mirroring the sources immediately exposed two quote defects* that had been
invisible for as long as the quotes existed, because nothing could check them:
`rcw-50a-10-030-agent-and-trust` ran subsections (7)(a) and (7)(b) together as
one continuous sentence with no elision, and `rcw-50a-10-030-pfml` opened its
last segment with `(6)(b)(ii)` — a label the statute does not print, assembled
from the surrounding nesting and placed inside the quotation marks. The pinpoint
belongs in `cite`, which is our words. That is now twice (RCW 49.52.050 at
books-37) that mirroring has behaved as an audit rather than as bookkeeping.

New: `scripts/fetch-wa-authority-text.ts`, the Washington sibling of the federal
fetcher — the sixteen existing WA mirrors had all been placed by hand, with no
recorded provenance. Its 200-character floor earned its keep on first run by
refusing to write three caption-only files after an off-by-one in the div walk;
without it the verifier would have reported nine **bad quotes**, blaming
Michael's statutory text for a parser bug (rule 79).

Debt ledger: `rcw-50a-10-030-pfml` deleted from `KNOWN_UNMIRRORED_AUTHORITY_IDS`
(16 → 15 payroll authorities still unmirrored). The count may only ever fall.

**Criterion 3, in detail (books-45).** Measured before touched: the two
`applyMilliPct` implementations were compared exhaustively over −300,000 to
+300,000 cents at all six rates in use, including exact-half cases. **Zero
disagreements.** This was never putting a wrong number on a filed form, and it
would be dishonest to present the fix as a near-miss.

The divergence was in the refusals. The float version silently accepted a
non-integer **rate** — `applyMilliPct(10_000, 6_200.5)` returned `620` rather
than throwing — and silently returned a value from a product beyond 2^53. The
integer version refuses both. Two functions with one name meant the safety net
under any given line of the return depended on which file the caller sat in.
The stricter one now serves both (rule 81).

That change surfaced a third blind spot: the shared `exportedFunctionNames`
scrape reads `export function` lines, so it could not see a re-export and
declared the still-taught `applyMilliPct` "dead teaching". Widened in the shared
helper, not the caller. The loud direction was harmless; the same gap against a
facade module would have reported **full coverage over an untaught module**
(rule 80).

**Gate strength, measured.** `scripts/prove-learning-path-gate.sh` runs 27
mutations against the new code and 3 silent controls. Result: **27/27 caught,
0 missed, 0 no-ops, 3/3 controls correctly green.** The first run scored 19/21
and found two real holes — a security assertion satisfied by an unused import
line, and two `assert*` functions that could be emptied to `return;` without
going red (standing rule 74). Both are fixed and both attacks are kept
permanently as regression witnesses.

**Criterion 5, in detail (books-45).** Michael asked for *"worked examples...
colorful, interactive... lead me through all steps and important reasoning."*
Before building anything the existing lessons were measured, because "the
lessons are too wordy" is an opinion and a count is not: **82 lessons, 14,562
words, median 173 words each, and only 25 of the 82 containing a single
concrete number.** That is the wall he described, quantified.

`src/lib/accounting/worked-examples-core.ts` answers it with eight examples
covering the DOR penalty ladder, all five agency clocks side by side, the LCB
weekend roll, weekly overtime, SSN handling, salary division, "or part thereof"
month counting, and the three clocks that start on a hire date. Each renders as
a table of GIVEN → OUTPUT → WHY IT MATTERS, with the trap row in the same orange
that already means "what goes wrong here" elsewhere on the card. The table
renders **above** the four paragraphs, so an opened lesson leads with figures.

**The rule that makes it trustworthy: not one number is typed by hand.** Every
output is produced by calling the real engine at render time. A hand-typed
example is a second implementation with no tests, and this codebase already
carried that scar — an earlier learning screen claimed a 47.9% gross margin the
engine did not compute.

That rule paid for itself immediately, three times:

1. **The SSN example was backwards.** It was written around `078-05-1120` (the
   1938 wallet-card number) as the one the system refuses. Calling
   `ssnProblems()` proved the reverse: the engine accepts it and refuses
   `123-45-6789` as a `sequential_placeholder`. The checks test structural
   impossibility per SSA's randomisation FAQ, not fame. As prose this would have
   shipped and taught a fact that is simply false.
2. **The overtime example computed zero.** The first draft called
   `hourlyGrossCents` twice and subtracted — but that function is straight-time
   only, so the 45/35 versus 40/40 comparison would have shown no difference at
   all, teaching the precise opposite of the lesson. Rebuilt on
   `computePeriodHours`, the real timesheet engine, with real punches: **$1,960.00
   versus $2,021.25 for the identical 80 hours.**
3. **A row's sentence contradicted its own number.** The monthly-salary row said
   "twelve divides cleanly, so there is nothing left over" while the engine
   returned **$4,583.37** for January — $55,000 does not divide by 12. Caught by
   printing the rendered output instead of trusting that it read well.

**The refusal boundary held.** `computeDorPenalty` refuses to compute interest
without an evidenced rate (RCW 82.32.050(2)). A worked example is not a licence
to slip a plausible number past that gate, so the rate is read from
`DOR_ANNUAL_RATES`, converted basis-points → milli-percent in one named function
(600 and 6,000 are both plausible integers; passing bp straight through is a
tenfold error), and a gate fails CI if any example ever renders a refusal.

**Gate strength, measured.** `worked-examples-gates.ts` checks four things in
rising order of value: structure, substance (no example without a digit in it),
provenance (the source text really imports the engines and contains no typed
currency), and **contradiction** (a row claiming two things "cost the same" must
show the same figure twice). Eleven tests drive each gate with a deliberately
broken example and require it to throw — rule 39.

A ten-mutant campaign against the examples scored **9/10 on the first pass.**
The survivor is worth recording: moving the salary remainder from period 0 to
period 25 changed every figure on screen while the row's sentence still claimed
the remainder lands on the first cheque, and all 34 tests stayed green because
none pinned that value. That is the exact prose-versus-arithmetic defect the
module exists to prevent, surviving *inside* the module built to prevent it. A
test was added that checks the class rather than the instance — first cheque
minus the rest must equal the remainder, and the 26 pieces must sum to the
salary — and the retry scored **10/10**.

One gate was also over-broad on its first draft and had to be fixed at the class
level. It grepped output text for `/refus/i`, which failed the SSN example — the
one place a refusal is the correct thing to display. Exempting that example
would have fixed the instance; the real defect was inferring a machine fact
("an engine broke") from English prose. Engine failures now emit
`ENGINE_REFUSAL_MARKER`, a token no sentence contains (rule 23).

**Honest coverage: 8 of 82 lessons carry a worked example.** The screen says so
in those words rather than implying the course is more finished than it is.

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

### 7. WA DOR Combined Excise Tax Return — the monthly one Michael actually files

**Requested by Michael directly (books-45):** *"a department of revenue sales
tax form so i can see visually what the monthly return will look like before i
go onto my portal to report and pay. we will need to know all sales, cannabis
and non cannabis, as well as monthly atm revenue."*

**This is a DIFFERENT RETURN from the one already built, and confusing the two
would be an expensive mistake.** `src/lib/compliance/excise-return-core.ts` is
the **WSLCB** Cannabis Retailer Sales & Excise Tax return, form LIQ-1295 — the
37% cannabis excise under RCW 69.50.535, filed with the Liquor and Cannabis
Board. The return described here is the **Department of Revenue** Combined
Excise Tax Return, filed monthly on My DOR. Two agencies, two portals, two due
dates, two sets of penalties. Greenway files both.

**Why this ranks above the remaining chain items:** it is a **monthly, recurring,
cash-out-the-door filing** that Michael performs by hand today, and it is the one
place where cannabis sales, non-cannabis sales, and ATM income all have to be
classified correctly on a single page. The 941 is quarterly; the 1120-S is
annual; this is twelve times a year, every year.

**Three revenue streams, three different tax treatments — this is the whole
difficulty, and it is exactly what Michael asked to see laid out:**

| Stream | Retailing B&O | Retail sales tax | Notes |
|---|---|---|---|
| Cannabis sales | yes | yes | the 37% LCB excise is **not** part of the retail selling price for sales-tax purposes — RCW 69.50.535(4). Getting this wrong overstates the DOR base every single month |
| Non-cannabis sales (merch, accessories) | yes | yes | already modelled in `src/lib/noncannabis/` |
| ATM surcharge income | **service B&O, not retailing** | **no** | this is fee income for a service, not a retail sale of goods. Putting it on the retailing line is the classic error — it taxes it at the wrong rate *and* wrongly drags it into the sales-tax base. Data already exists in `src/lib/atm/` |

**What it consumes (all of it already exists, none of it needs inventing):** the
POS sale ledger for cannabis and non-cannabis gross, `src/lib/atm/` for surcharge
revenue, `src/lib/medical/tax.ts` for the medical exemption, and
`src/lib/reports/tax-base-core.ts` for the pre-tax base that already knows how to
strip tax out of a tax-inclusive price.

**What it must produce:** a full visual facsimile of the return, line by line,
with every figure traceable to the transactions behind it — so Michael can read
it, understand *why* each number is what it is, and only then key it into My DOR.

**Deliberately NOT a filing agent.** Same boundary as everywhere else in this
product: we prepare and explain, Michael files and pays. The screen's job is to
make the portal a transcription step rather than a judgement call.

**Blocked on one thing, and Michael has already offered it:** his **filed July
return**, so every line can be reconciled against a real one before this is
trusted — the same method that made the 941 engine credible, where his filed
Q2 2026 return became the oracle. Local rates (Port Orchard, Kitsap County) must
come from the DOR rate lookup for the specific period, never from memory: they
change, and a stale local rate is a silent monthly underpayment.

State business & occupation tax and Port Orchard local taxes are computed here,
read off the income statement's revenue lines.

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

## SLICE A — THE W-2 / W-3 ENGINE — **COMPLETE (books-46)**

Built in four commits on `books-46`. What Michael can now do that he could not
before: open `/admin/books/form-w2`, see every employee's W-2 box by box with the
derivation of each figure, see the W-3 totals, and — the point of the slice — see
those totals compared line by line against the four Form 941s he actually filed.

| Piece | Where | Gate |
|---|---|---|
| The engine (boxes 1–6, 12, 14, 15–20, W-3 totals, reconciliation) | `form-w2-core.ts` | `form-w2-core.test.ts` |
| The reader | `form-w2-store.ts` | `form-w2-store.test.ts` (69) |
| The screen logic | `form-w2-ui-core.ts` | `form-w2-ui-core.test.ts` (63) |
| The law, verbatim | `form-w2-authorities.ts` (28 own + 13 borrowed = 41) | `form-w2-authorities.test.ts` (39) |
| The teaching | `form-w2-mentor.ts` | `form-w2-mentor-gates.ts` |
| The filed-941 table | `0204_filed_form_941_totals.sql` | `migration-execution-gate.test.ts` |
| The screen | `src/app/admin/books/form-w2/page.tsx` (881 lines) | `nav-gate-core.test.ts` |

**Both W-2 traps are implemented and on screen**, not merely documented: box 1
exceeding boxes 3 and 5 renders GREEN with the §3121(a)(2)(B) carve-out quoted
beside it, and box 17 renders grey and labelled *blank on purpose* rather than
empty. The trap-1 badge states the **observable** (box 1 exceeds boxes 3 and 5)
rather than asserting shareholder status, because nothing in a wage record knows
who the shareholders are — ownership lives in the ledger.

**The due date is computed, never typed.** For tax year 2026 it resolves to
**2027-02-01**, because 31 January 2027 falls on a Sunday. It is derived through
`onOrAfterBusinessDay` against the holiday calendar and matches the date the
authorities cite, so the screen and the law cannot drift apart.

### The defect class this slice found, and why it mattered more than the form

Running the new store gate for the first time produced one failing assertion. It
was not a test bug. It exposed **one defective idiom duplicated across six
independent stores** — payroll W-2, YTD, garnishment, onboarding, loans and ATM —
each carrying a comment explaining that reading an unreadable wage column as zero
is the most dangerous possible answer, and then producing exactly that zero.

Measured with `npx tsx`, not reasoned about:

| Input | `Number()` returns | Old guard verdict |
|---|---|---|
| `""` | `0` | **accepted as zero** |
| `"   "` | `0` | **accepted as zero** |
| `"0x1F"` | `31` | accepted |
| `"1e3"` | `1000` | accepted |
| `" 900000 "` | `900000` | accepted |
| `"9007199254740993"` | `9007199254740992` | accepted, **off by one, silently** |

Three distinct defects: `Number("")` is 0 rather than `NaN`; `Number.isInteger`
says nothing about whether the digits *survived* the conversion; and the nullable
variants returned `null` for GARBAGE as well as for absence, merging "this column
is empty" with "this column is unreadable". All six comments named the hazard and
none of the six guarded it. Untestable by construction — each was a private
function inside a `server-only` module no unit test could reach.

Fixed as a class in `src/lib/supabase/pg-bigint.ts` (397 lines, 38 self-tests +
29 vitest tests), following the `postgrest-escape.ts` precedent. Split by
NULLABILITY ALONE — `requiredBigint` / `optionalBigint`, not one function with a
flag — and a test proves the two agree on every value that is actually present.
The idiom now has **zero occurrences** in `src/`.

Triaged empirically rather than by inspection: `crypto-store-core.ts` and
`promotions-store.ts` (`parsePotencyNumber`, a float parser) are different in
kind — blank→null is already correct there — and were left alone at a defensible
boundary rather than swept in.

### Four more defects, found by making the modules reachable

1. **Seven dead links in a panel a gate already guarded (rule 39).**
   `form-w2-authorities.ts` documents finding and fixing exactly this bug — a
   repo-relative path in `source`, which is rendered as `href={a.source}` and is
   non-empty, so every existing check passes. It fixed its own 28 and shipped a
   gate. The gate loops `FORM_W2_OWN_AUTHORITIES`; the panel renders **41**. The
   seven borrowed from `ytd-authorities` still carried paths. Fixed by splitting
   `W2_SOURCE_PATH` (for the corpus verifier) from `W2_SOURCE_URL` (for Michael),
   with three new gates including one tying the path and the URL to the same
   document YEAR — a failure mode the split itself newly creates.
2. **The store refused honestly and the page rendered the refusal as blank
   space (rule 63d).** `loadW2s` deliberately returns `null` rather than
   comparing the W-3 against zeros, because zeros-vs-zeros comes back ALL GREEN.
   Its comment says "the screen says so in gold". The screen said nothing — the
   branch was `: null`, so the most important card rendered as a heading over
   empty space, which on a page full of green ticks reads as *nothing to report*.
3. **A comment written one slice earlier was factually wrong (rule 1).** The four
   `employee_w4` cent columns are `bigint NOT NULL`, verified against the live
   schema — so the claim that `null` meant "the employee left Step 3 blank" was
   inventing a meaning for a state the constraint forbids. A blank Step 3 is
   stored as **zero**. Now `requiredBigint`, with the throw caught because
   `foldW4Rows` isolates damage per employee and an uncaught throw would turn one
   corrupt W-4 into a whole-payroll outage naming the column but not the person.
4. **Eleven guessed API shapes.** The page did not compile because it was written
   against what the APIs ought to look like. Notably `ReconciliationResult` has
   `verdict` while `ReconciliationLine` has `plain` — the same word on two types,
   so one of two call sites was right and the other was not.

### Still open in slice A's territory

- **`filed_form_941_totals` now has a writer, and the table is still empty.**
  Those are two different facts and both matter. Slice books-48 built the
  **data-entry surface** that was named here as the next piece of work: a form
  on `/admin/books/form-941` where Michael types the six figures off a return he
  has already filed, plus the date he filed it and where the paper came from.
  Until he types the first one, every reconciliation row still reports
  `cannot_check` — which is the honest answer and is now proven to be the answer
  (see below), because the previous behaviour of comparing an unsupplied figure
  against zero came back as a disagreement rather than as an absence, and a
  future refactor toward `?? 0` would have come back GREEN.
  The figures are typed rather than computed **on purpose**, and this is the
  whole point of the screen: the W-2/W-3 side of the comparison descends from
  `payroll_run_lines`, so if the filed side were derived from pay runs too, both
  sides would share one ancestor and would agree TRIVIALLY, ALWAYS — including
  in the quarter where a 941 went out with a transposed digit. Rule 39 on the
  highest-stakes screen in the module. The typing is the second witness.
  **Still open here:** nobody has keyed a real return yet, because the first one
  will not exist until Q1 2027 is filed in April 2027. Michael can key the four
  2026 quarters from his Aatrix copies at any time and the check will light up
  the moment he does.
- `payroll_ytd_accumulators` does not yet carry PFML / WA Cares **withheld**,
  which box 14 wants.
- Worked examples still cover 8 of 82 lessons.
- The three `atm_*` row types are cast `as Array<Record<string, unknown>>`, so no
  column in `atm/store.ts` has ever been type-checked. Found while repointing it;
  scoped out of a W-2 commit deliberately.

---

## Also outstanding (not in the mandated chain)

- **R1 — the security finding.** Twenty RLS policies use `for all using
  (is_staff())` on banking, mortgage, holdings, loans, crypto and ATM tables,
  meaning any active employee can read and write Michael's personal and business
  financial data. Proven by execution during the is_admin() audit. Needs
  re-gating to `is_admin()` with read/write split. **Owner decision needed:**
  which tables, if any, managers legitimately need.
- **R2 — sixteen duplicate type definitions (books-45a).** Chasing the three
  "pre-existing" eslint warnings turned up `PeriodStatus` declared in BOTH
  `ledger-core.ts` and `period-close-core.ts`, identical values, no import
  between them (rule 76/81). The `ledger-core` copy was referenced by nothing —
  not even its own file — and is now deleted. A scan of every brace-free
  single-line exported alias in `src` found **15 more with identical bodies in
  two or more files**, measured not guessed:

  `AccountType` (3 files: cutover-core, ledger-core, trial-balance-core),
  `AtmConnectionStatus`, `BlogCategory`, `ControlSubledger`, `DiscountType`,
  `ImageFocus`, `NormalBalance`, `PayrollReconcileStatus`, `PlaidEnvName`,
  `PolicyDocId`, `SourceKind`, `TextAlign`, `TextVAlign`, `TxDirection`,
  `VendorReconcileStatus`.

  `AccountType` and `SourceKind` are the dangerous ones: both are long string
  unions in the accounting core, and a member added to one copy and not the
  other compiles perfectly while the two halves of the ledger disagree about
  what an account is. NOT fixed here — each needs its owning module chosen and
  the other call sites repointed, which is a slice, not a footnote. Deliberately
  scoped OUT of books-45a rather than half-done.

  The scan covered only aliases whose whole body fits on one line without
  braces; multi-line object types were skipped rather than compared as
  fragments (rule 86), so 16 is a floor, not a ceiling.
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
10. **Form 7203 per shareholder** — stock and debt basis. **This is the blocker
    that puts slice B last.** §1366(d)(1) allows losses only to the extent of
    basis, so without 7203 the deductibility of every S-corporation loss on the
    1040 is unknown. The forms and logic can be built ahead of it; the numbers
    cannot be inferred, and inferring them would be rule 1.
11. **The twelve 2027 rates**, the **Q3/Q4 2026 filed returns**, the **salaried
    reporting method**, the **S-election tax year**, the **ending AAA from
    Schedule M-2**, the **§6699(e) amount**, and the **quarterly federal
    short-term rates**. Michael is gathering these; the first payroll is
    1 January 2027, so the 2027 rates are the time-critical set.

**RESOLVED since the last revision:** the Wells Fargo loan is connected via
Plaid (Michael, Aug 2026), which closes the input side of the non-current
liability question. The *code* side is still open and is tracked as B7: 
`financial-statements-store.ts` `loadNonCurrentAccountCodes()` still
`return []`, deliberately and with the pessimistic direction documented — every
liability presents as current, which understates the position rather than
flattering it.

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
| books-26 | the federal deposit schedule: Michael is SEMIWEEKLY, proved two independent ways; the engine REFUSES rather than defaulting to monthly when lookback history is absent; the 2026 Sage baseline recorded before the PDFs were deleted, and four defects found in the live books | #999 |
| — | the compliance gate had been RED on main since books-20 — six merges landed under a failing check, and because the workflow lints before it tests, vitest never ran on any of them | #999 |
| — | standing rule 57, learned from books-26 (a green local run is not a green gate; when CI is red, prove whose fault it is from a clean worktree; never merge past red in silence) | #999 |
| books-27 | migration 0195 proved SOUND against a real PostgreSQL 15 rebuilt to Michael's exact pre-state; his `relation "a" does not exist` is prose reaching the parser in transit, not a defect in the file — the client that mangles it could NOT be reproduced and was NOT guessed at | #1000 |
| — | nothing in this repo had ever EXECUTED a migration: 195 files, 545 lines of tests on 0195 alone, all of it reading SQL as text. CI now applies all 195 in order to a real postgres, then re-applies the last one for idempotency | #1000 |
| — | the filed Q2 2026 returns overruled Sage's printouts: UI is 0.37% and EAF 0.03% (Sage's 0.64% overstates UI by 186.09/qtr), and TWO of my four reported defects were WITHDRAWN as printout artefacts | #1000 |
| — | standing rule 58, learned from books-27 (a test that reads SQL as text has not run the SQL; apply it twice; build the pre-state; translate the engine's error into the user's problem) | #1000 |
| — | standing rule 59, learned from books-27 (a printout is not a filing; rank the evidence before reporting a defect; a tier-3 disagreement is a question, not an accusation; retract as loudly as you accused) | #1000 |
| — | reports engine built from FIVE MEASURED defects in Michael's own Sage files, not from a blank page: 33 columns over 8 header lines and machine tokens (§8.9), 26 rows to describe 10 people (§8.3), a 7x26 grid of pure blank (§8.7), bare negative leave balances (§8.8) | #1002 |
| — | `reports-presentation-core.ts` — 18-entry Sage field dictionary, suffix-aware `decodeSageToken` (strips `_C` BEFORE `_COGS`, negative-control tested), 8 layout rules each tied to a measured defect AND a citation, `comparePeriods` that REFUSES a percentage across a comparability break (ASC 205-10-45-3), suppression-with-disclosure, real empty states | #1002 |
| — | `payroll-reconciliation-report-core.ts` — Sage's Exception Report done properly; three expectation bases because WA charges three ways, incl. the PFML TWO-STEP that is the only arithmetic reproducing the filed 556.32; rounding bound DERIVED as ceil(N/2) cents, never a tuned tolerance | #1002 |
| — | `known-good-quarters.ts` — Q2 2026 as FILED is now an ORACLE, not a fixture: 10 employees, 14 return lines, 3 agencies, confirmation numbers; one wage base (68,923.45) cross-foots across four independent filings | #1002 |
| — | TWO defects found by the new tests themselves: `comparePeriods` printed the self-contradicting "down 0%" and could emit negative zero ("-0%"); both fixed in the engine, not papered over in the test (rule 28b) | #1002 |
| — | a rule-15c mutation SURVIVED — hard-coding `isExpectedRounding = true` permanently disables the rounding-vs-error control and all 40 tests still passed, because nothing had ever exercised the REFUSAL branch | #1002 |
| — | standing rule 60, learned from books-27 (a branch that excuses a difference must be tested on the day it refuses to; tolerances/thresholds/grace periods are one object; assert on the SENTENCE not the boolean; a mutation harness needs a control mutant; derive the bound, never tune it) | #1002 |
| — | told Michael the dated-rate registry he asked for ALREADY EXISTS (`payroll-rate-registry-core.ts`: dated rows, refuses on gaps, ceiling/overlap/share-sum checks) — the gap is the SCREEN, not the engine | #1002 |
| books-28 | **PARTIAL RETRACTION OF THE books-27 ROW ABOVE.** books-27 recorded that 0195 was "proved SOUND". That was true of the file as a whole and remains true — all 195 migrations apply clean to a real PG15 — but it was NOT the whole story, and Michael was still blocked. Re-opened on his report of the SAME failure on TWO independent machines (rule 61e) and found a SECOND, REAL, SHIPPED defect that books-27 never looked for: an ORDERING bug | #1003 |
| — | **the ordering defect.** `0195`'s `$ssn_col_gate$` block revokes SELECT on `public.employees` and hands it back column-by-column by LOOPING OVER `information_schema.columns`. But `ssn_last_four` was created SIX LINES LATER. On a FIRST application the column did not exist when the catalogue was read, so it received no grant — while the comment six lines above asserted "ssn_last_four IS granted. That is the point of having it." Proven live: apply once, `set role authenticated; select ssn_last_four` → `ERROR: permission denied for table employees`; apply twice → succeeds | #1003 |
| — | fix is a RELOCATION, not a new statement: the column-creation block now sits BEFORE the gate. Proven with a 4-arm probe (original once/twice vs fixed once/twice): before `o1: NO, o2: YES`; after `o1: YES, o2: YES`, with `ssn_full leaked = NO` in every arm | #1003 |
| — | the `42P01 relation "a" does not exist` message is EXACTLY reproducible when prose reaches the parser — line 490 reads `… not edited from a screen.`, and `select 1 from a screen;` yields character-for-character Michael's error (`LOCATION: parserOpenTable, parse_relation.c:1392`). TWENTY splitter models (M01–M20) were run against a live server and NONE reproduced the mangling, so the mechanism is reported as UNPROVEN rather than invented (rule 1) | #1003 |
| — | `scripts/compliance/strip-comments-for-sql-editor.ts` — a real SQL lexer, not a regex: strips `--` and `/* */` only where they are genuinely comments, never inside `'…'` (honouring `''`), and RECURSIVELY inside `$tag$…$tag$` bodies. Removes the transit hazard at the source | #1003 |
| — | `supabase/migrations/editor-safe/0195_…EDITOR_SAFE.sql` — comment-free copy for the Supabase editor, proven EQUIVALENT not merely similar: two fresh databases behind identical 0001–0194 pre-states compared 276 vs 276 catalogue rows, every column/constraint/index/policy/RLS flag/column privilege matching, audit-function body byte-identical at 2,047 bytes | #1003 |
| — | a VACUOUS READ caught in my own probe (rule 39): the first catalogue diff printed "SEMANTICALLY IDENTICAL" while returning only **4 rows** — the query had errored on `operator is not unique: text || "char"`. Repaired it returned 275/276 and IMMEDIATELY exposed the ordering defect. This near-miss is why rule 61d exists | #1003 |
| — | standing rule 61, learned from books-28 (a migration that grants privileges by reading the catalogue is order-dependent, and order-dependent means untested until applied ONCE; the first application is the only one Michael performs; compare catalogues not dump text and PRINT THE ROW COUNT; when the owner reports a failure on two independent machines, the diagnosis is the defect) | #1003 |
| — | answered Michael's UI question with evidence, not reassurance: `grep` for `reports-presentation-core|payroll-reconciliation-report-core|known-good-quarters` across `src/app` and `src/components` returned EMPTY. books-27 shipped ENGINES AND TESTS ONLY — no page, no route, no accounting-dropdown entry. 0195 is NOT what unlocks the reports engine, and he cannot see any of it yet | #1003 |
| books-28 | **verbatim COSO, obtained legitimately.** Michael was right that the full 2013 framework is not free. The Executive Summary IS, so it was mirrored from coso.org (462,770 bytes, 20pp, sha `488d8dde…`) and every quote drawn from it is now machine-checked against that file | #TBD |
| — | the clever part he asked for: the **GAO Green Book** adapts COSO's SAME five components and seventeen principles for government and is a work of the U.S. Government — **no copyright at all** (17 U.S.C. §105). BOTH editions mirrored (GAO-14-704G, 86pp; GAO-25-107721, 131pp), so where COSO's licence makes quoting awkward, the identical concept is quotable at length for free | #TBD |
| — | **40 authority records** in `internal-control-authorities.ts`, all 17 principles and all 5 components covered. `verify-verbatim-quotes.ts` now reports **160 verified against local sources, RULE 24/35 VERIFICATION PASSED**; each new id prints `VERBATIM OK` individually so none can pass by being silently skipped (rule 39/48) | #TBD |
| — | **THREE candidate quotes FAILED verification BEFORE being wired, and were thrown away rather than adjusted (rule 24).** One — "A major deficiency represents an internal control deficiency…" — was ENTIRELY INVENTED by me; the real sentence begins "When a major deficiency exists with respect to…". This is the single most important line in the slice: the gate caught me fabricating an authority | #1003 |
| — | COSO Principle 1 is recorded as **UNQUOTABLE** rather than quoted loosely: the PDF glues footnote marker `2` onto the word (`The organization2`). Widening the shared `normalise` to strip it would have weakened verification for EVERY other corpus, so Principle 1 is cited from the Green Book instead and the reason is written down (rule 1) | #TBD |
| — | the COSO text needed 64 soft-hyphen breaks rejoined (`manage-\nment` broke the definition quote). All 64 were inspected INDIVIDUALLY — every one typesetting, none a real compound — and the join asserts 64 before / 0 after. The Green Books were deliberately NOT treated this way (their breaks ARE compounds: `third-party`, `quasi-governmental`) and a test asserts those SURVIVE, as the negative control | #TBD |
| — | **a mutation SURVIVED and was investigated instead of dismissed (rule 60).** Re-citing the segregation-of-duties quote to the wrong Green Book edition did NOT fail — because that sentence is word-for-word identical in both editions, making it a CONTROL mutant that proved nothing. Re-run on Principle 8, which IS reworded between editions, the mutant was correctly KILLED (exit 1), proving edition routing is load-bearing | #TBD |
| — | `internal-control-core.ts` (6 functions) + `internal-control-mentor.ts` (rule 26). The verdict is a **boolean plus named blockers, never a percentage**: a system with 16 of 17 principles working is NOT "94% effective", it is INEFFECTIVE with one named blocker. A test asserts the conclusion never matches `/\d+\s?%/` | #TBD |
| — | gates: **7,872 tests across 374 files green**, `tsc --noEmit` clean, eslint 0 errors. Two rule-16 proofs write decoy files and require the mentor gate to THROW `MENTOR COVERAGE GAP` and, on an empty read, `GATE BROKEN` — so the gate cannot pass by reading nothing | #TBD |
| books-30 | **THE COMMENT-FREE COPY FAILED TOO.** Michael ran the EDITOR_SAFE file and got the SAME `42P01: relation "a" does not exist`. So "strip the comments" was never the finish line, and the books-28 diagnosis was INCOMPLETE (rule 59d). Re-opened on his report rather than repeating "proved sound" | #TBD |
| — | **the SQL is innocent, proven not asserted.** Built a real 0001-0194 pre-state on a live PG15 (needing auth.users/auth.role/auth.jwt/storage.buckets stubs), then applied the editor-safe 0195 on a TRUE FIRST application: exit 0, and `has_column_privilege` confirms `ssn_last_four` granted / `ssn_full` NOT leaked. The file is valid; the damage happens IN TRANSIT | #TBD |
| — | **the single point of failure, found by enumeration not guesswork.** Searched the whole file for any `(from|into|join|update|table)\s+[a-z]\b` reachable inside a string literal. EXACTLY ONE site existed: the SSN note reading `"Never select this into a list view."` A splitter that loses quote tracking reads `into a` as a relation named `a` — character-for-character Michael's error | #TBD |
| — | two further transit hazards removed: the file's ONLY non-ASCII character (an em dash, U+2014, in that same note) and 2 mid-sentence semicolons inside quoted prose (`"Revoke it; ssn_last_four…"`). Hazard counts went bareRelationWord 2→0, nonAscii 1635→0, semicolonInString 44→0 | #TBD |
| — | `transitHazards()` EXTENDED (rule 25) with a real lexer that walks single-quoted strings and dollar-quoted bodies, so "inside a literal" is decided by the lexer and not a regex. It deliberately does NOT flag a `;` between statements or inside a `$tag$` body, so the gate discriminates instead of just alarming | #TBD |
| — | **MUTANT KILLED (rule 15c).** Re-inserting the exact phrase `"into a list view"` into the shipped copy made 3 of the 14 tests fail immediately; removing it returned 14/14. The guard is load-bearing, not decorative | #TBD |
| — | EQUIVALENCE re-proven after the rewording, with the row count PRINTED (rule 61d): two databases compared columns/constraints/policies/RLS/indexes/column-privileges — **491 rows vs 491, identical** — and the audit function body normalises to 2,344 chars either way, differing only by stripped comments | #TBD |
| — | RESEARCH, as Michael asked: another user hit his EXACT error in the Supabase SQL editor on 2026-08-12 with unrelated SQL and no line number (SO 79993483), and supabase/cli #5146 (plus #4746/#5020/#5062) documents the splitter losing dollar-quote depth. Reported as SHARED fault: their splitter is fragile AND our file gave it something to trip on | #TBD |
| — | answered "should I run it without RLS?" with a plain NO and the reason: 42P01 is a PARSER error raised before any policy is consulted, so disabling RLS cannot help and would trade real SSN protection for an imaginary fix. Gave him `supabase db push` as the splitter-free route | #TBD |
| books-40 | **Form 941** — the quarterly federal return, engine + screen | #1015 |
| books-41 | **WA quarterly returns** (ESD and L&I) wired to a screen, plus the form a test caught us dropping | **#1019 — MERGED** |
| books-42 | **the financial statements wired and taught**, plus the excise defect that made net sales exceed gross sales | **#1020 — MERGED** |
| books-43 | **the annual forms: Form 940 (authorities + engine) and the W-2/W-3 authorities** | **#1021 — MERGED** |
| — | **Form 940**, and the FIVE defects reading the source caught — including a truncation that CHANGED THE LAW (quoting "paid all state unemployment tax by the due date." when the sentence continues "…of your Form 940", which would have told Michael he had lost a credit he had not lost), a word inserted the IRS never wrote, and a fabricated quote assembled entirely out of genuine fragments from two hundred lines apart | #1021 |
| — | **the cite-format hole**: every 940 cite read "IRS, Instructions…" with a comma, so `sourceFileFor` returned null and all seventeen quotes were counted as "no local copy to check against" while the mirrored file sat on disk. Seventeen unverified quotes behind a cheerful green line | #1021 |
| — | **W-2 / W-3 authorities**: 28 own + 13 borrowed = 41. §6051 MIRRORED rather than declared uncheckable (it is a US Government work at a public URL, so `KNOWN_UNMIRRORED_AUTHORITY_IDS` would have been a choice, not a limit) by EXTENDING `fetch-federal-authority-text.ts` (rule 25). Verifier 268 → **296 verified, exactly +28** | #1021 |
| — | **a borrowed id that did not exist.** The reuse list named `iw2w3-2026-employer-contact-person`; the real id is `iw2w3-2026-w3-contact-person`. `formW2Authorities()` FILTERS by that list, and a filter looking for something absent returns a SHORTER ARRAY, not an error — 40 authorities where 41 were intended, silently. Invisible to `tsc` (every string is a valid string) and to the verifier (which only walks quotes that ARE present). **A reused id that does not exist is indistinguishable from one that was never listed.** Gated by asserting every borrowed id RESOLVES | #1021 |
| — | **`source` was a file path, and `source` is an `href`.** All 28 records pointed at the repo-relative corpus path while `CompanyInformationForm` renders `href={a.source}` under "Read the original" — 28 dead links. Nothing would have caught it: the verifier routes on `.cite` and NEVER READS `.source`, and the only registry-wide assertion is non-emptiness, which a repo path satisfies. Surfaced only because six BORROWED authorities quote the same IRS document and link to irs.gov, so half a panel would have worked | #1021 |
| — | tamper campaign **14/14 CAUGHT** (rule 39): altered quote, truncated carve-out, path-as-source, wrong-document URL, the bad borrowed id, a dropped borrowed id, a mangled cite, a mislabelled statute, both oracles, both traps, a unicode elision, a tidied page-break footer | #1021 |

---

## What guards this file

This document is not trusted on its honour. Three artifacts hold it to account,
and anyone editing it should know they exist before being surprised by them:

| Artifact | What it does |
|---|---|
| `tests/compliance/books-roadmap-agreed-order.test.ts` | Re-derives every countable claim here from the actual modules on every suite run |
| `scripts/prove-roadmap-gate.sh` | Mutation campaign against both this file and the owner's copy — 18 attacks, 2 silent controls |
| `docs/MICHAEL-books-43-the-plan-from-here.md` | The same plan in plain English for Michael, with a PDF |

The division of labour matters. The gate checks **numbers, order and structure**
— lesson counts, line counts, the C → A → D → B sequence by position, the
`node:fs` count, the cross-footed total. It deliberately does **not** assert on
the prose explaining *why* B is last or what the three tabs should look like,
because that is judgement, and a test that breaks when someone improves a
sentence teaches people to edit tests instead of thinking (rule 66c). The two
silent controls in the campaign exist to prove the prose really is still free to
change: one adds a sentence here, one rewords an explanation in the owner's copy,
and both must stay green.

The owner document is gated too, and by re-deriving its figures **from the code**
rather than comparing them to this file. Two documents agreeing on a wrong number
is the likely failure mode, because the second is written by copying the first —
a document-to-document comparison is blind to exactly that case (rule 73).

If you change a lesson count, a module name, or the order, expect the suite to go
red and **fix this document** rather than the test. That is the whole point.

## How to use this file

Read `todo.md` for the standing rules (currently 1–73) first — they are binding
repo law and rule 21 defines the method every slice follows. Then read this file
to see what is next. Then read `docs/books-roadmap-remaining.md` for the
plain-English explanation of why it matters.

Update the status table above the moment a slice merges. A roadmap that is not
maintained is worse than no roadmap, because it is trusted.
