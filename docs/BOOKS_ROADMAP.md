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
| ~~**E**~~ | ~~**WA DOR Combined Excise Tax Return**~~ | **CANCELLED BY MICHAEL, books-59.** No page will be built. | See below. |

**E IS CANCELLED. Do not build it, and do not re-propose it.** Michael's words,
books-59: *"as for the dor form. i think since it is really a self explanatory
form, i simply enter total sales and it tells me what i owe. really nothing to
know or learn, so i think we should not worry about it."*

He is right, and the reason is worth keeping: the My DOR portal computes the tax
from the figures he types in, so a facsimile would teach him nothing he does not
already see on the screen in front of him. Every other form in this roadmap
exists because a box needs *deriving* or *explaining*; this one does not.

**What survived the cancellation, and it is the valuable half.** The reason the
form was wanted at all was to get all three sales-tax types classified
correctly. That is now done in the ENGINE instead of a screen — see
`src/lib/accounting/bo-tax-core.ts` and §7 below. His instruction: *"we need to
account for sales tax by all three types, state/ local/ b&o. its important that
the books account for b&o as it is an expense and not a liability."*

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

### C1. Six mentor modules that no screen renders — 84 lessons, 2,162 lines

| Module | Lessons | Lines | Importers under `src/` |
|--------|---------|-------|------------------------|
| `payroll/payroll-onboarding-mentor.ts` | 34 | 778 | **0** |
| `accounting/tax-penalty-mentor.ts` | 20 | 540 | **0** |
| `accounting/interest-mentor.ts` | 11 | 287 | **0** |
| `accounting/period-close-mentor.ts` | 9 | 234 | **0** |
| `accounting/s-corporation-year-mentor.ts` | 5 | 153 | **0** |
| `reports/payroll-reconciliation-mentor.ts` | 5 | 170 | **0** |
| **Total** | **84** | **2,162** | — |

**WHY FOUR OF THESE LINE COUNTS FELL DURING SLICE C, AND THE TOTAL WITH THEM.**
When this table was first written the total was **2,345**. Four of the six
modules imported `node:fs` to read authority text off disk, which meant no
client component could ever import them — the one hard constraint that decided
slice C's whole architecture. So those four were split: the lesson DATA stayed
in `*-mentor.ts`, and the disk-reading coverage checks moved to a sibling
`*-mentor-gates.ts`, per standing rule 65b. The lessons did not change and none
were lost — the count did not move at all across that refactor, 82 before and 82
after — but 245 lines of gate code left the four files. The `importsNodeFs` column in
`tests/compliance/books-roadmap-agreed-order.test.ts` is now `false` for all six,
and that gate re-derives every figure above from the tree on each run, which is
why this paragraph exists rather than a quietly edited number.

**WHY THE TOTAL ROSE IN BOOKS-50, AND WHY THAT IS THE GOOD DIRECTION.** The
roster correction added one exported function to `interest-core.ts`:
`formatSection6699MaximumUsd`, which derives the twelve-month §6699 exposure from
the number of people on the shareholder roster instead of leaving it typed into a
sentence. It exists because the typed version had gone stale — it was built on a
roster of three when the filed Schedule K-1s report four, understating the
exposure by $2,340. Standing rule 26 does not allow a new exported function to
ship untaught, so `interest-mentor.ts` went from 10 lessons to 11 and from 257
lines to 287, and the totals above moved with it. The lesson was then placed in
the curriculum next to the §6699 penalty it sizes, so nothing became reachable-
in-principle-only: every one of the lessons in this table appears in a unit on
`/admin/books/learn`, and the count is still **84** after placement as it was
before it. Thirty lines arriving with exactly one lesson is the pairing worth
noticing — lines rising while the lesson count stayed flat would have meant
thirty lines of something that is not teaching had entered a teaching module.

**books-65 repeated the pattern a third time, 83 → 84.** Michael asked for the
ESD work code (“they require a work code for each employee … the code my
employees use is, 41-2031”). Deciding whether a code is acceptable is a new
exported function, `socCodeProblems`, so rule 26 required a lesson and
`payroll-onboarding-mentor.ts` went from 33 lessons to 34 and from 746 lines to
778. It was placed in unit 3, hiring, beside `validatePay` — the two answer the
same question, “what does this person do”, for two different readers: §280E and
Washington. The placement was not optional politeness; the curriculum gate
failed the build until it happened, naming `onboarding:socCodeProblems` as a
lesson nothing teaches.

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
Handles the shareholder reality: Michael B Lyman 85%, his grandfather Nicholas C
Mullan 5% (paid), his step-father James H Becker 5%, his mother Theresa L Becker
5%. **CORRECTED IN books-50.** As shipped, books-19 was built on a three-person
roster of Michael 85 / mother 10 / grandfather 5, which is not what the Form
1120-S reports: box I says four shareholders and there are four K-1s at
85/5/5/5. (SUPERSEDED-ROSTER: the 10% was the Becker HOUSEHOLD - Theresa and
James are married to each other and Washington is a community-property state -
recorded where the legal roster belonged.) The engine was always input-driven
and correct; the fixture and the prose were wrong.

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
  assumed. The real floor is **$9,360** for the four shareholders the return
  actually reports, at the un-inflated base. **CORRECTED IN books-50:** this
  line originally read $7,020 for three shareholders (SUPERSEDED-ROSTER),
  which understated the twelve-month exposure by $2,340. The figure is now
  computed by `formatSection6699MaximumUsd()` rather than typed. A system that reports a five-figure exposure as nothing does not fail to
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

### 7. WA DOR Combined Excise Tax Return — THE FORM IS CANCELLED, THE TAX LOGIC IS BUILT

> **STATUS, books-59: the SCREEN is cancelled. The three-way tax classification
> described in this section is BUILT and TESTED in
> `src/lib/accounting/bo-tax-core.ts`.**
>
> Michael cancelled the facsimile: *"as for the dor form. i think since it is
> really a self explanatory form, i simply enter total sales and it tells me
> what i owe. really nothing to know or learn, so i think we should not worry
> about it."*
>
> He then named the part that actually mattered: *"However, we need to account
> for sales tax by all three types, state/ local/ b&o. its important that the
> books account for b&o as it is an expense and not a liability."*
>
> **What was measured before building (books-59):** state (650 bps) and local
> (280 bps) were ALREADY computed and reported separately in
> `src/lib/reports/wa-tax.ts`. B&O was absent from the entire codebase — no
> rate, no computation, and nothing posting to `75040 B&O Tax Expense` or
> `32200 B&O Tax Payable`, both of which migration 0173 had created months
> earlier and left unused.
>
> **The unit defect this uncovered (standing rule 114):** B&O Retailing is
> `0.004710` = **47.10 basis points**, which is not an integer. Storing it in
> bps understates Michael's filed July return by \$1.68/month (47 bps) or
> overstates it by \$15.16/month (48 bps). B&O rates are therefore stored in
> MILLIONTHS (rate x 1e6): `4710` and `15000`, both exact. 650/280 bps convert
> without moving, so no existing figure changed.
>
> **Corpus:** his filed July 2026 return, confirmation # 0-053-958-352, mirrored
> at `docs/authorities/state-wa/dor-combined-excise-return-july-2026.txt` and
> reconciled to the cent on all six lines before any figure was used
> (standing rule 115).
>
> The classification table below is still correct and is now enforced by tests
> rather than being a plan. Keep it for the reasoning; do not build the page.

**Originally requested by Michael (books-45), now superseded:** *"a department of
revenue sales tax form so i can see visually what the monthly return will look
like before i go onto my portal to report and pay. we will need to know all
sales, cannabis and non cannabis, as well as monthly atm revenue."*

**This is a DIFFERENT RETURN from the one already built, and confusing the two
would be an expensive mistake.** `src/lib/compliance/excise-return-core.ts` is
the **WSLCB** Cannabis Retailer Sales & Excise Tax return, form LIQ-1295 — the
37% cannabis excise under RCW 69.50.535, filed with the Liquor and Cannabis
Board. The return described here is the **Department of Revenue** Combined
Excise Tax Return, filed monthly on My DOR. Two agencies, two portals, two due
dates, two sets of penalties. Greenway files both.

**Why it once ranked above the remaining chain items (retained for the
reasoning, no longer a ranking):** it is a monthly, recurring, cash-out-the-door
filing, and the one place where cannabis sales, non-cannabis sales and ATM income
all have to be classified correctly. That classification burden was real — which
is why it moved into the engine when the screen was cancelled. The portal does
the arithmetic; only the classification ever needed our help.

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

**~~What it must produce~~ — CANCELLED.** No facsimile will be built. What
replaced it: `threeTypeBreakdown()` in `src/lib/accounting/bo-tax-core.ts`
returns state, local and B&O as three separate figures, with B&O split by
classification (retailing vs service-and-other), and `boAccrualEntry()` books
B&O as an EXPENSE with a timing payable — never as trust money the way sales tax
and the 37% excise are booked. 54 tests, 18 mutations, all caught.

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
| The law, verbatim | `form-w2-authorities.ts` (31 own + 13 borrowed = 44) | `form-w2-authorities.test.ts` (41) |
| The teaching | `form-w2-mentor.ts` | `form-w2-mentor-gates.ts` |
| The filed-941 table | `0204_filed_form_941_totals.sql` | `migration-execution-gate.test.ts` |
| The screen | `src/app/admin/books/form-w2/page.tsx` (1027 lines) | `nav-gate-core.test.ts` |
| The W-3 taught box by box **(books-55)** | `form-box-lessons-w3.ts` | `form-box-lessons-w3.test.ts` (17) |
| The form as one big sheet **(books-58)** | `form-sheet-core.ts`, `FormSheet.tsx`, `form-w2/sheet/page.tsx` | `form-sheet-core.test.ts` (85) |
| The 941 as one big sheet **(books-60)** | `form-941/sheet/page.tsx`, one link added to `form-941/page.tsx` | `form-sheet-core.test.ts` (85), `owner-report-books-60.test.ts` (25) |
| The filed 940 as an authority **(books-60)** | `docs/authorities/federal/filed-form-940-2025-greenway.txt`, `scripts/mirror-filed-940.py` | `filed-940-threshold.test.ts` (12) |
| The actual printed form **(books-61)** | `form-facsimile-core.ts`, `FormFacsimile.tsx`, `FormPrintBar.tsx`, `scripts/derive-form-geometry.py`, `scripts/derive-form-box-map.py` | `form-facsimile-core.test.ts` (20) |

**books-58 grew the screen row above by 29 lines, and that is the ENTIRE change
to that file.** Michael asked for "one large page with nothing on it but form",
where clicking a mapped box brings the whole lesson to him rather than
redirecting him, and was explicit that the tabbed screen must not be altered:
"rather than updating or changing any of it". So the sheet is a sibling route
and those 29 lines are a single link in the header, "View just the form →".

The link is not decoration and was not in the first version. The route shipped
linking BACK to the W-2 screen with nothing linking forward to it, and
`nav-gate-core.test.ts` failed naming it: *"owner-only pages that are not in the
menu... Each one is a decision nobody made."* That is the books-49 failure
exactly — Michael's own report was "I am unable to see or use the tab system" —
and it was caught in the same hour rather than by him, a year later.

`/admin/books/form-w2/sheet` is now on that gate's `known` list, which exempts
it from the MENU and not from reachability; the two are different, and the
`known` list cannot tell them apart. So `form-sheet-core.test.ts` asserts the
door exists. Delete the link and it goes red.

### books-60: the second sheet, and what the second sheet exposed

Michael asked to "get back to work on the forms. i really want to see and
interact with the forms now." The 941 was chosen over the 940 and the W-3 for a
reason recorded in books-58's own report as a known weakness: the W-2 has zero
untaught boxes, so the sheet's "not taught yet" marker was UNREACHABLE on the
only form that had a sheet — an untested guard by rule 40. The 941 has three
untaught boxes (12, 13, 14), so it is the first screen where both affordances
render together and the marker stops being a claim.

Adding the second route immediately showed the cost of the first route's tests
being written by name. `form-sheet-core.test.ts` pinned `form-w2/sheet` and
nothing else, so the 941's page could have shipped with no door, no access
guard, no specimen fallback and no honesty line with every test green. The
block now DISCOVERS sheet routes by walking `src/app/admin/books/*/sheet/` and
holds each to the same nine promises; a third route inherits them by existing.
Recorded as rule 117.

**And one mutant escaped, on the assertion that mattered most.** The access
check read `expect(sheetPage).toMatch(/requireBooksAccess/)`. Deleting the
`await requireBooksAccess();` call from the body of the page — leaving a screen
of payroll and tax figures with no permission check — left the suite GREEN,
because the `import { requireBooksAccess }` line still matched. The gate had
been testing an import, never a guard. `extractPageGuard` in
`src/lib/auth/nav-gate-core.ts` already existed for exactly this, strips
comments first, requires a call shape, and even carried a comment describing
the hazard; it simply was not being used. Both the 941's and the W-2's
assertions were repaired and a mutant was run against the W-2 to prove the fix
reached it. Recorded as rule 116 — third recurrence of the "passed for the
wrong reason" class.

Two defects were found by running the new core over forms it had not been
written against, which is the argument for it being form-agnostic:

- **W-2 box 9 nearly lost its lesson.** Its printed caption is "(not used)", and
  it HAS a lesson — "The box that must stay empty", explaining that the entire
  IRS instruction is "do not enter an amount in box 9". A three-state affordance
  that tested unusedness first made it unclickable, hiding a finished lesson on
  exactly the kind of box where the instinct to be helpful produces a filing
  error. Root cause: two orthogonal facts flattened into one enum — "does the
  form use this box" (about THE FORM) and "has anyone written the lesson" (about
  THIS PRODUCT). Carried separately now, and neither may overrule the other.
- **Half the forms sat under a heading that lied.** Grouping on "is the id a
  single letter" put the W-3's `b-kind-of-payer`, `b-kind-of-employer`,
  `b-third-party-sick-pay` and `contact` — plus EVERY box on all four Washington
  forms, which have no numbered boxes at all — under a heading reading "The
  numbered boxes". Split now keys on whether the id starts with a digit, and an
  empty group is not emitted.

Rule 40 shaped the whole slice: the W-2 has 26 of 26 boxes taught, so the "not
taught yet" marker Michael approved is UNREACHABLE on the form he chose. The
marker is therefore proved on the 941 (7 untaught: 5e, 6, 7, 10, 12, 13, 14) and
the 940 (10), and the W-2's zero is pinned so adding an untaught box there is a
deliberate decision. **17 untaught boxes across two federal forms** is the real
remaining teaching backlog.

### books-63: Form 940 and the W-3 on paper, and one period selector for every form page

Michael: *"Yes please complete 940 and w-3 this next slice, with lessons on boxes
that bite only please."* And, in the same message: *"sorting and filtering per
period/ employee/ qtr/ yr, etc would be really handy on the forms pages in some
way. I am not sure the smart industry standard or professional way to do it ...
Please make sure you are building these features so I can sort and filter that
works with the full form workflow and all its tabs and pages."*

**The paper.** Form 940 renders both pages of the return - 59 and 31 measured
rectangles - and NOT page 3, which is Form 940-V, a payment voucher Greenway
should never use because it pays by EFTPS. Page 2 is not optional: it carries
Part 5, the four quarterly FUTA liabilities whose total must equal line 12, and
a one-page 940 would look finished while omitting the only self-checking
arithmetic on the form. The whole form carries a gold banner saying every cent
on it is the employer's money, because no part of FUTA is ever withheld.

**The W-3 has no route of its own, deliberately.** It is a TRANSMITTAL: every
figure on it is a sum of the W-2s behind it, and `buildW3` takes the W-2 batch
as its only input. So it renders at the top of the W-2 sheet, above the forms it
sums, where the addition can be checked by eye - and it is HIDDEN when one
employee is selected, because batch totals sitting above a single W-2 read as
that person's figures. Its money boxes do not split cents at all: 15 single
`/MaxLen 16` fields, measured, which is why D-04's per-page rule matters.

**The answer to "the professional way to do it"**: in filing software the period
selector is a PERSISTENT BAR, in the same place on every screen, with the
selection in the ADDRESS. That way a link to "the Q2 941" can be sent to a CPA,
Back means what it looks like, and the period is visible while the figures are
on screen. `form-scope-core.ts` + `FormScopeBar.tsx` do this for all seven form
surfaces, with no client JS - a `<select>` needing hydration is a picker that
does nothing while the page loads. On a quarterly form the year row is labelled
*"Same quarter, another year:"* and jumps a year KEEPING the quarter: one click
for the comparison an owner actually makes, where it used to take four.

**"all its tabs and pages" is a GATE, not a hope.** A shared selector is
trivially easy to bypass, so `form-scope-core.test.ts` DISCOVERS every books
page that both teaches boxes and reads `searchParams` (7 today) and holds each
to five promises, including that it does not keep a private copy of the
closed-period rule.

Writing it measured four latent defects, none of which any test was failing on:

- The closed-period rule was written out **six times**, and `?year=` was
  validated three different ways. Two pages - `wa-quarterly` and the tabbed 941
  - checked only `Number.isFinite`, so `?year=1&q=1` was accepted and would
  compute a Washington return for **the year 1**.
- The W-2 sheet's year links silently CLEARED the employee filter.
- A substituted period was shown under a self-consistent heading, with nothing
  saying a substitution had happened. It is now recorded and said out loud.
- The rule-123 rectangle-coverage gate - the one that exists to prove no
  rectangle goes unplaced - had been scoped to a **hand-written 3-page list**.
  Schedule B and both 940 pages and the W-3 were never covered by it. It now
  reads `ALL_PAGE_KEYS`, and per-page counts are pinned as one object equality
  so a new page cannot arrive without stating its count.

Two more were caught by the gates during the slice: my own new "Show everybody
to see the W-3" link was hardcoded `?year=` - exactly the class of bug the slice
exists to close - and `tsc` refused an `/s` regex flag that vitest had happily
accepted, which is a green test that fails the build.

### books-65: the work code, the data with nowhere to land, and the cent that was never a rounding tie

Michael's order was explicit and was followed in it: finish the Washington forms,
explain D-10 and what he must obtain, find out why company data never reached the
forms, then state the plan for clickability thoroughness.

**The clickability answer was to make the question disappear.** He asked for a
fallback panel saying "what this box is and why it doesn't need a lesson". Before
building it, the 23 untaught boxes were measured and each was checked for real
authority on disk. All 23 had it — so not one of them was a box that did not need
a lesson; they were boxes nobody had written. Writing them removes the marker's
cause instead of dressing its symptom, and the standing untaught total across
every form is now **0**. Asking the question before building the feature is what
made the feature unnecessary.

**Why the Washington sheet is not a facsimile, measured rather than asserted:**
`pypdf` reports `/Fields: []` on both ESD PDFs — zero widget annotations between
them, against 116 on the 941 — so there is no agency answer to where a figure
belongs. And the published blank 5208A is the **2011 draft**, numbering the wage
lines 12/13/14 against a $37,300 base where his filed returns number them 13/14/16
against $78,200. The page says this out loud, so the absence reads as a decision.

Three defects, in `docs/DEFECTS.md`:

- **D-15**, the one he reported: his company information was stored correctly,
  read correctly, and printed nowhere. Identity is joined onto the specimen by
  `identity[box.box]`, and `teachingBoxes` emitted **no entity boxes at all** —
  five values, zero homes, on every form. Nothing threw and nothing was null;
  each half was correct in isolation and the defect lived in the space between
  them. The 941 went 27 → 32 boxes and the 940 30 → 35, both measured against his
  filed returns with `pdftotext` first. `assertEveryIdentityValueHasABox` now
  fails if any of the five loses its home again.
- **D-16**, and it is the lesson of the slice: after 11,616 green tests, a clean
  type check, the self-tests, the verbatim verifier and the linter, the ONE
  screenshot rule 130(c) requires showed the new ESD work-code box displaying
  **the labor role's error message**. `problemFor(path)` returned
  `row.problems[0]` — the first complaint on the STEP, whichever field owned it.
  For eight slices `labor_role` raised exactly one problem, so index 0 was right
  **by accident**; this slice gave it a second and the accident ended. Every gate
  was blind because every gate was looking at a correct thing: right problem,
  right field, faithful copy — only the JOIN was wrong, in a component function
  no test called. `ChecklistRow` now carries `fieldProblems`, pairing each message
  with its own field and severity. Mutation-proven.
- **D-10 was re-measured and the previous entry was WRONG.** Answering his
  question meant re-doing the arithmetic rather than re-reading the note. The
  claim that "Q2 is consistent with either reading" is false: Q2 discriminates and
  refutes the combined-0.40% reading the entry had proposed. Reading A fits Q2 and
  misses Q1; reading B fits Q1 and misses Q2 — so the rounding rule was never the
  variable, and that wrong question had been asked for two slices. One rule fits
  all four figures across both quarters: **ESD drops the cents from taxable wages
  before applying the rate.** At $61,531.21 the UI figure is 227.665477 and rounds
  UP; drop the 21 cents of wages and it is 227.6647, which rounds DOWN to the
  227.66 ESD charged. The 0.5477 was never a tie — it was wages already discarded.
  **Deliberately not implemented** (rule 62d): a rule fitting four data points is
  a pattern, not an authority, and no ESD publication stating it was found. Pinned
  by a test that walks all three candidate readings against both quarters, so the
  next reader inherits a measurement instead of a paragraph.

**D-14 was closed by the owner**, not by the code: *"sage is wrong, i need to
update the formula … we will build a compliance cron bot that will poll the
agencies for tax updates and such. that way our books never lie to me."* The
engine was already right; what changed is that it is no longer an open question.
The cron bot is the correct generalisation — D-14 is not about one rate, it is
about a rate going stale while nothing noticed for two quarters — and it is
recorded as intent, **not built**.

**On the SOC code, the system declined to invent an obligation.** Michael said ESD
"require a work code for each employee". RCW 50.12.070(2)(a)(i) says the standard
occupational classification **or job title**, and the EAMS spec says the column
"can be only 6 digits or blank" — so blank WARNS and malformed BLOCKS, and
`41-2031` is never auto-defaulted because that is a fact about his roster. Wiring
the write also exposed a live bug: `4-12031` strips to six digits and passed
validation, but the 0207 CHECK would have rejected it — screen says saved,
database throws. `socCodeCanonical` re-seats the hyphen so the stored value
satisfies the constraint by construction.

**Two count-pins were widened rather than bumped** (rule 129d): an exact
`toBe(77)` on the engine suite and a `toBe(70)` on the naive test counter both
had to be hand-edited on every slice touching that file. They now assert the
risks that actually matter — coverage may never fall below the 72 promised in the
books-41 report, and the counter must still see the loop-generated tests a naive
regex cannot. Verified both ways: deleting a describe block still fails the gate.

### books-66: the ESD confirmation rebuilt as paper, and the half of D-10 that authority closed

Michael's ask was specific: *"I am just trying to mimic sage \u2014 is there a way for
you to take the form 5208 I gave you \u2026 and somehow use it like form 940 and 941?
its only for visualization only."* Then he improved on it himself: *"I would not
be opposed to the form looking like the one given after efiling \u2026
1st_quarter_form_5208a.pdf. that would actually be better in my opinion as thats
what I am used to seeing."* That second version is what was built, and it is the
easier of the two to build honestly.

**Why this facsimile is possible where books-65's was not, which is the whole
argument of the slice.** books-65 refused to paint the 5208A and gave two measured
reasons: `pypdf` reports `/Fields: []` on both ESD PDFs, so the agency states no
coordinates, and the published blank is the **2011 draft** numbering its wage
lines against a $37,300 base while his filed returns use $78,200. Neither
objection touches the EAMS confirmation. That document is **a printed web page** \u2014
Michael's own copy carries the browser print header and the `portal.esd.wa.gov`
footer \u2014 so rebuilding it is a flow layout in HTML, not an attempt to guess where
a box sits on someone else's artwork. Nothing is placed at coordinates, so rule
62d is never engaged. The refusal and the build are the same policy applied to two
different documents.

**It reproduces his filed Q1 2026 to the cent, and the test suite is anchored to
that fact rather than to invented figures**: gross $61,531.21, excess $0.00,
taxable $61,531.21, UI $227.66, EAF $18.46, charges $246.12, eleven employees,
3,027 hours, all SOC `41-2031`. The render harness asserts every one of those
before it will emit an image, so a screenshot of a wrong document cannot be
produced.

**Three things it deliberately does NOT do, each visible on screen rather than
hidden.** It carries no confirmation code and no submitted-on date \u2014 absent by
design, with no such fields on the view type at all, because a facsimile that
displays a receipt number is a forgery rather than a preview; the page says
`CONFIRMATION CODE: none \u2014 not filed` in as many words, under an amber *PREVIEW,
NOT A RECEIPT* banner. Names print in one column, not two (**D-17**), because
splitting on whitespace guesses wrong on exactly the names that matter \u2014 "Van
Dyke", "De La Cruz". And the three monthly employment counts print as em dashes
(**D-18**), because the engine has never been asked for headcount-on-the-12th and
printing `0` would assert on filed-looking paper that Michael employed nobody in
January.

**Hours ASSERT rather than round, and the reason is the interesting part.** The
ceiling is applied once, in `eamsHours()`, on the path to the uploaded file. If a
fractional value ever reaches the confirmation sheet, `confirmationHours` throws
instead of tidying it, because rounding in the second place would make the
displayed figure and the uploaded figure agree while concealing which of the two
was wrong. A gate mutates the throw into a silent `Math.round` and fails.

**The mutation campaign found a real defect in my own gate, and it is the lesson
of the slice.** Flipping `deriveExcessWagesCents(gross, taxable)` to compute
`taxable - gross` \u2014 a sign inversion on a filed tax figure \u2014 left all 24 tests
GREEN. Michael's Q1 is degenerate: gross equals taxable, so excess is zero in
either direction. The handbook itself says excess wages *"are most often paid
during Q3 or Q4"*, which means the error would have shipped and first appeared as
a large negative number on a Q3 document formatted to look filed. **A suite
anchored entirely to real data is anchored to that data's blind spots too.** Fixed
by adding gates built on the handbook's own worked example (Q3: $18,000 gross,
$12,000 taxable, $6,000 excess) plus a negative-formatting check; re-applying the
mutation now fails, and it was re-applied to prove it.

**Both of Michael's questions were answered by measurement, not opinion.**

- *Are the three documents sufficient?* **Yes, and one rule they confirm was
  already implemented.** The handbook's *"round up to the next whole number \u2026 if
  an employee worked 9.75 hours, you should report 10 hours"* is the **second and
  third** independent statement of a rule `Math.ceil` has been enforcing in
  `eamsHours` and its Paid Leave twin for several slices. Nothing to change; a
  citation gained.
- *Are the exports ready to upload?* **Yes, and they already were.** `esd-upload/route.ts`
  and both download links on the Washington screen have been live since books-56/64.
  He can file with them today.

**D-10 split in two, and one half is now closed by authority** \u2014 see `docs/DEFECTS.md`.
The ICESA specification names ESD's own fields as *"UI Taxes Due (taxable wages
multiplied by the UI tax rate)"* and *"EAF Assessment Amount \u2026 (total taxable
wages x EAF rate)"*, with EAF enumerated as its own basis-point rate. That is
per-fund arithmetic in the agency's own words, and it **refutes by authority** the
combined-0.40% reading the original D-10 entry proposed. The engine already
computed it this way. What remains unsettled is only the rounding question \u2014
whether the rate meets taxable wages with or without cents \u2014 and an exhaustive
grep across all three documents returns **zero hits** on it. A probe narrowed four
candidate readings to exactly one that fits all four filed figures, and it is
**still not implemented**, because one surviving pattern over four data points is
not a published rule (rule 62d). The probe was kept on purpose, so the fifth
quarter costs a command instead of a re-derivation.

**Not needed:** Michael offered to re-export the Sage 5208A without its watermark.
He should not spend time on it \u2014 he preferred the EAMS confirmation layout, and
that is what was built.

### books-67: the button that looked forbidden, and the form that would not draw

Michael reported two things and they turned out to be one defect seen twice.

*"I think I see the export button for esd and pfml, the button is not very clear
it is the button to use to export the files ... it has a circle with a slash in
it when I hover over that box."* And: *"the esd form page says it refuses to draw
the form because there is 1 problem, no payroll yet ... Ideally I'd like to see
the form like all the others, even with no payroll data to fill it with."*

**The measurement came before the fix.** A throwaway probe built an empty Q3 2026
and printed what the engine actually says: exactly one refusal, `NO_SUBJECTS`,
"This quarter has nobody on it at all" — matching his "1 problem" precisely. That
mattered, because fixing the wrong refusal would have left his screen unchanged
while looking, from here, exactly like success. (The probe's first run threw: it
guessed the PFML fields were flat on the request when they are nested under
`pfml`. Read the type, corrected, re-ran — rule 1, on my own scratch code.)

**The two reports share one cause: `{result.ok ? ... : null}`.** With no payroll,
`result.ok` is false, and the card holding BOTH download links was removed from
the page entirely. The only button-shaped object left was *"Taking these figures
to the State"* — deliberately inert, deliberately `cursor-not-allowed`. **He
hovered the one control designed to look forbidden because the two that are not
were not on the screen.** The confirmation route refused for the same reason.

**This is the second occurrence of a class this repo already fixed.**
`form-sheet-core.test.ts` has said so since books-49: *"hiding a teaching surface
behind `result.ok` made it invisible for a year."* The `sheet` route learned it;
books-66 shipped two new surfaces without it. Rule 23 — so the fix is a gate that
walks back from each download link to its enclosing card and fails if the
preceding conditional is the figures gate, sitting beside the books-49 gate it
generalises. Mutation-proven in both directions.

**An empty quarter draws the form; a broken one still refuses.** That distinction
is the whole design. `NO_SUBJECTS` is a fact about the quarter and safe to render
blank. Every other refusal — negative wages, fractional hours, a missing rate —
means something is wrong, and drawing those as a blank form would hide a real
fault behind a page that merely looks empty. The route branches on the refusal
CODE, never on `result.ok`.

**Null, never zero.** `buildEamsConfirmation` now accepts `ret: null` and every
derived figure becomes an em dash, because `$0.00` on an unemployment report is
an affirmative claim that no wages were paid. One builder, not two — a separate
`buildEmptyConfirmation` would be a second layout free to drift, so the blank
form he studies would slowly stop resembling the filled form he files (rule 25).
Counts are treated differently from money on purpose: "0 rows" is a true
statement about a table, "$0.00" is a claim about a quarter.

**And the screenshot found what 11,658 tests could not — D-19.** The first render
of the blank form showed `TOTAL EMPLOYEES 0` above `JANUARY 10  FEBRUARY 11
MARCH 9`. `monthlyHeadcount` is passed independently of `ret`, so it went on
echoing its input while everything derived from `ret` correctly dashed. Both
halves were individually correct and the contradiction lived between them —
the same shape as D-15, on the two figures ESD reconciles against each other.
Fixed at the source, gated with a deliberately non-empty headcount rather than
the nulls today's caller passes, and mutation-proven.

**Also answered, without building anything (rule 132):** the ATM model. His four
uploaded reports were measured rather than assumed — $526,620.00 of transaction
settlements against $16,272.50 of surcharge over 1 May–23 Aug 2026, and the
Timberland account showing 230 `DLY SETTLE MVNT` credits against 66
`TRANSFER FROM X6228 TO X6048`. That confirms his description: the surcharge is
the ATM company's revenue, not Greenway's, and it arrives separated in the data.
What he still owes is named in the owner report; the wiring is the next slice.

### books-62: Schedule B, and three defects a green test suite could not see

Michael: *"I am a schedule b filer, so we don't need to compute the monthly
payment, we need to compute the bi weekly payment figure and add it to that form
next."* Confirmed against his filed Q2 2026 return: line 16's monthly grid is
blank, the semiweekly tick is the one that applies, and Schedule B is required.

One correction he should know: Schedule B is a **daily** liability form - 31
numbered spaces per month - not a fortnightly one. The figure is computed per
payday as asked; the form files it by pay date. His cycle fills 7 of 93 spaces.

The reconciliation is the whole job. `scheduleBLiability` derives the employer
share as the RESIDUAL the 941 implies (line 5a + 5c minus employee FICA by
statutory rate), allocates it by largest remainder, and then REFUSES rather
than drawing a schedule whose total is not line 12 - see D-05. His Q2 ties at
14,204.57.

Three defects, in `docs/DEFECTS.md`:

- **D-04**, caught one step before shipping: `CENTS_MAX_LEN` was a single global
  3. Schedule B uses 2, and W-2 box 12 uses 2 for its CODE boxes, so neither
  the constant nor a widened constant is right. The value is now measured per
  page and carried in the box map.
- **D-06**: only 1 of line 16's 3 ticks was bound to a box. The unreachable
  ones included the **semiweekly** tick - the one that declares this schedule
  is attached. They are now bound by the SENTENCE the IRS prints beside each,
  never by field index: `c2_1[1]` and `c2_1[2]` are indistinguishable by name
  and transposing them tells the IRS a semiweekly depositor is monthly.
- **D-07**, and it is the lesson of the slice: every deliberately-blank money
  box printed `0 00` on any form that splits cents - **86 of the 93 day cells**.
  `paperText` honoured `blankOnPurpose`; the dollars/cents SPLIT path did not.
  On a daily liability form 86 zeros assert that wages were paid on 86 days.
  **Every arithmetic test was green and stayed green.** It was found by LOOKING
  at the rendered page once (rule 130(c)), and it would not have been found by
  reading the figures as text either, because `0 00` reads as a real entry.

Also this slice: a seventh lesson set had to be handed to the books-54/55
cross-reference gates, and Schedule B is printed paper - so labelling it
`screen-only` would have created exactly the stale exemption those gates warn
about. Instead a set may now declare a GENERATED specimen and is checked
bidirectionally against the boxes it really renders. That immediately caught two
dead ties in the new lessons, pointing at `form_941` boxes `ein` and `name`
which do not exist on a line-organised specimen.

### books-61: the form as it would look if you were holding it

Michael, after seeing books-60: *"When I had asked for the physical form to be
displayed on the page by itself, I meant literally. I am hoping that for all the
various forms, I can see the form as it would look if I were holding it in my
hand."* And: *"I want what the cpa needs... It's meant to be a part of the
process for bookkeeping and taxes, not just informative."*

books-58 and books-60 rendered a styled LIST of boxes. This slice renders the
ACTUAL ARTWORK. Every rectangle is measured out of the agency's own PDF with
`pypdf` — `/Rect`, `/FT`, `/Q`, `/MaxLen`, `/Ff` — and the artwork itself is the
IRS's page converted to SVG. Nothing about the layout is hand-typed, so nothing
about it can drift from the paper.

Three findings, all measured rather than reasoned:

- **Comb fields.** `/Ff` bit 25 divides a box into `/MaxLen` equal cells, one
  character per cell. It is why Michael's filed 941 prints his EIN as
  `4 6 - 4 2 1 7 0 1 6`. Six comb fields exist across the 941's two pages and
  none on the W-2. A first implementation derived the cell width from a FONT
  METRIC GUESS and was deleted in favour of dividing the agency's own rectangle
  by its own stated cell count — arithmetic, not estimation.
- **The identity defect, found twice.** A live W-2 was emitting only the eight
  money boxes the engine computes: no SSN, no EIN, no employer, no employee
  name. The teaching specimen emitted all 26, which is exactly why nobody
  noticed — only the specimen was ever screenshotted. Asking the same question
  of the 941 found the same defect, worse: 18 of page 1's 70 rectangles and 32
  of page 2's 35 were going unplaced, including the EIN, the legal name, the
  trade name and page 2's entire repeated header. **A 941 with no EIN on it is
  not a return; it is a page of arithmetic the IRS cannot match to anybody.**
  Rule 23 — fix the class, not the instance.
- **Legal name and trade name are different boxes and must stay different.**
  Greenway's EIN was issued to `LYMAN'S MARIJUANA`; it trades as
  `GREENWAY MARIJUANA`. The IRS matches a return on the EIN plus the name
  control — the first four characters of the name the EIN was issued to — so
  putting the trading name in the name box is a mismatch, and a mismatched
  return does not post.

The governing gate is **rule 123**: every rectangle on the page must be either
filled or recorded as deliberately blank WITH A WRITTEN REASON. There is no
third state, because the third state is what an unfilled EIN box looked like.
Writing that gate immediately caught an asymmetry — the 941 recorded reasons per
rectangle while the W-2 recorded them per printed label, so the same question
asked of two forms got an answer from one and silence from the other.

**What is deliberately NOT filled, and why it is listed rather than hidden:**
the quarter ticks and the aggregate-filer type (a choice only Michael can make);
the signature block (pre-filling under a perjury declaration is refused even
though the profile carries `signer_name` and `signer_title`); the paid-preparer
block; and **the whole of line 16, the monthly deposit liability** — because
`Form941Return` carries no monthly breakdown at all. That last one is a 941
ENGINE gap rather than a rendering gap, and it is written into the owner report
rather than quietly patched.

**books-55 added the W-3 teaching layer, and the screen row above grew by 37
lines because of it.** Section 5 of that page already rendered the W-3 as a
table of figures. A table cannot say what a box means, whose money it is, or
which line of which Form 941 has to agree with it, so the transmittal got its
own `FormBoxExplorer` — 31 boxes, 31 lessons, 34 cross-references, every one
resolving.

Three things are worth recording because they were found by attacking the work
rather than by reviewing it:

- **The W-3 explorer could be deleted with the whole suite staying green.** The
  wiring gate keyed every assertion on the page FILE, and the W-2 and W-3 rows
  name the same file, so the W-2's explorer satisfied the W-3's checks and the
  surviving import satisfied the lessons check. Closed by counting blocks per
  page and requiring each lessons module to appear as a real prop
  (`form-box-explorer-wiring.test.ts` (14)).
- **`ALL_WHOSE_TABLES` had a docblock claiming a completeness gate that did not
  exist.** Now built, and it reads the adapters' own source
  (`form-box-adapters.test.ts` (33)).
- **The W-3 is NOT gated on `w3 !== null`.** With no W-3 built, every figure
  reads *not computed yet* rather than `$0.00`, because a zero in box 4 asserts
  that Greenway withheld no social security tax all year. That is a claim about
  a filing, not a blank.

The 31 ownership rows were swept exhaustively — each flipped to all four other
legal `WhoseMoney` values, 124 mutations, all caught.

**books-55 also closed a defect class that had nothing to do with the W-3, and
it is the most valuable thing in the slice.** While proving the lesson quotes
were verified, a probe showed the verifier was reporting 465 authorities as
"332 verified, 99 skipped for want of a local copy" — and three of those 99
had their source sitting on disk the whole time. The cause was two characters:
`26 C.F.R. § 31.3402(f)(2)-1(a)(4)` is how the eCFR prints it, with a space
after the section sign, and both the router and the mirrored-corpus table
demanded `§31.` with none. Because the cite matched neither, it was not even
eligible for the loud failure that exists for exactly this situation, so it
was counted as a harmless skip. Verified quotes went **332 → 335**.

That is the FOURTH time this one defect has occurred here (`§280E` resolving to
`usc-280.txt`; the FASB CON 8 chapters; thirteen `IRS, Instructions for Form
941` comma-form cites; now a space). Standing rule 23 says fix the class, so
`authority-routing-completeness.test.ts` (6) now asks the question nobody had
asked: *for every quote the verifier skips, is its text already inside a file we
hold?* It runs the verifier's own comparison, so an offender it names is one the
verifier genuinely could have checked. The books-40 Form 941 routing debt was
re-measured and is **closed** — all thirteen cites route.

**books-57 recorded a FIFTH occurrence, and it defeated the gate above.** The
`26 U.S.C.` rows in both routers still demanded `§` with no space, so five cites
written as the government prints them — `26 U.S.C. § 162(f)(1)` — matched
neither, while `usc-162.txt` and `usc-6651.txt` sat on disk. The books-55 gate
saw nothing, and was right to: it asks whether a held file *contains* a skipped
quote, and all three of those quotes turned out to be **editorial
reconstructions** splicing statutory headings onto bodies, so their text was in
no file at all. A routing defect and five bad quotations concealed each other.
Mirroring `§163` and `§6656` rather than parking them as debt exposed two more.
Verified quotes went **339 → 345**.

The sixth test is the class gate the previous five occurrences needed: *if the
corpus table can classify a cite and the file is on disk, the router must route
it* — asserted over the whole registry, not a list of known cases, and
mutation-proved in both directions (reverting either router's `§\s*` fails).

The gate's first run reported two offenders and **both were false positives**,
which is recorded in its docblock because following them would have caused real
harm. The FASB Codification reprints Regulation S-X in its S99 sections, so the
text really is in the building — but with FASB's editorial markers spliced into
the middle of the SEC's sentences. Routing those cites there would have made the
verifier fail on a quote correctly transcribed from the eCFR, and the tempting
way to silence that failure is to edit the authority text to match FASB's
reprint. A gate that normalises differently from the thing it gates measures its
own opinion, so the gate now uses the verifier's exported `normalise`.

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

### books-68: the new hire report, and the form whose every box printed zero

*"I want to create the new hire form and add it to the w-4 payroll setup page in
the same way the other forms are displayed. I want a button in the setup employee
page at the top right corner that shows me the form filled out and downloadable
for me to send to the state ... I should be able to see the form empty. And if
it's not too much work, learning lessons for each box would be amazing!"*

**The statute chose the placement, not preference.** RCW 26.23.040(2): *"Employers
shall report to the extent practicable by W-4 form, or, at the option of the
employer, an equivalent form."* Washington names the W-4 as the reporting vehicle
for new hires, so putting the door on the W-4 payroll setup screen is where the
law already puts it. Michael's instinct and the RCW agree.

**Why it is a `FormSheet` and not a filled PDF.** `pdfinfo` on the DSHS file
reports `Form: none` — there is no AcroForm, no named fields, nothing to fill
programmatically. Rule 127 forbids placing boxes by eye on a scanned page, so this
took the road books-65 built for the ESD 5208A: the real layout reproduced as a
sheet, every box where DSHS prints it. Twelve boxes, all taught, each lesson
citing RCW 26.23.040.

**Three states, one branch point.** Empty draws a blank specimen; broken still
refuses by name; complete draws the report. That is books-67's law applied at
birth rather than retrofitted — `onlyRefusalIsEmptiness()` is the single place the
question is asked. A missing address or SSN names the employee and the field and
draws nothing, because a form with a hole in it is a failure to report at
**$25 per employee per month** under RCW 26.23.040(5).

**Twenty days, and day twenty is not late.** `newHireDeadline` is hire + 20, with
the boundary pinned in both directions: day 20 passes, day 21 is overdue. Overdue
hires colour on the page. Pagination is four employees per sheet, tail left short
(rule 125(c)) — never padded to look full.

**The SSN prints unmasked, because the statute requires it** — and still routes
through the `employee_ssn_reveals` audit table, one row per employee written
*before* the numbers are returned. If the log fails, the reveal fails: `ssn` is
set to null and the core refuses by name. A statutory requirement to disclose is
not a licence to disclose unaudited.

**Migration 0208** adds `home_street / home_city / home_state / home_zip`,
nullable and deliberately **not** defaulted to `'WA'` — a defaulted state is a
guess wearing the costume of data, on a form where a wrong address is a
misreport. The legal name comes from `w2_last_name` / `w2_first_name_and_initial`
(migration 0203), not from `full_name`, whose own column comment warns it "may be
a nickname". I had guessed `first_name`/`last_name` existed; measuring the schema
corrected it (rule 1).

**The route is exempt from two gates, and both exemptions are argued, not
asserted.** It has no reporting period, because a new hire report is event-driven
— a quarterly grain would hide an overdue hire across a boundary. And it is
owner-only without a menu entry, so it is listed in the nav gate's `known` set
with its statutory rationale, since an unreachable page is a decision nobody made.

**D-21: the screenshot was the only gate that fired.** With all 11,695 tests
green, the filled form rendered a literal `0` in **all twelve boxes** — employer
name `0`, SSN `0`, date of hire `0`. Every test asserted on the view object, which
was correct; the defect lived in the last step between a correct view and the
rendered page. The first fix removed the zeroes and printed "not computed yet"
across a fully populated report instead — a second falsehood, caught by a second
screenshot. Shipped fix: an additive optional `text` field on `FormBox`, read
through `boxText()`, checked after `notComputedYet` and before the numeric
branches, with `assertBoxTextIsHonest` called from `sheetGroups()` so every sheet
in the system passes the same door. Full record in `docs/DEFECTS.md`.

**This is the third slice in a row where a visual check found what the suite could
not** (D-19, D-20, D-21). Rule 130c is earning its place.

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

## Owner-stated facts recorded in books-49 (flagged, NOT computed)

Michael volunteered four facts about his own tax position while reporting the
invisible-tab defect. They are recorded here because each one changes a figure
the engine will eventually compute, and because a fact remembered only in a chat
transcript is a fact that will be lost. Each entry states the mechanism, what is
verified, and the document that would settle it. **None of these is implemented.
None is assumed. Do not compute anything from this section without the document
named in it.**

**1. Nicholas C Mullan (grandfather, 5%) is paid when cash allows.** He defers to
Michael's household. This explains the distribution variance visible on the filed
1120-S. Under Sec. 1.1361-1(l)(1) - mirrored at
`docs/authorities/federal/cfr-1.1361-1.txt`, the operative sentence is on line
366 - uneven distributions are **not** by themselves a second class of stock,
because the test is whether the *governing provisions* confer identical rights.
The second clause of that same sentence is what bites: distributions differing in
timing or amount "are to be given appropriate tax effect in accordance with the
facts and circumstances." So the gap must be characterised as something (most
likely a debt owed to him), and the characterisation must be dated and written
down. The basis/AAA engine from books-19 already names the variance and the test.
**Needed: a dated note in the corporate records saying what the unpaid amount is.**

**2. Theresa L Becker (mother, 5%) was an employee solely to be carried on the
company insurance policy**, because it was cheaper through Greenway than through
her own employer. Michael paid her premiums as compensation for her and James's
share. She is now on Medicare and no longer employed, and will not be paid
materially going forward. She owns 5%, which is more than 2%, so item 5 of the
Box 1 inclusion list in the 2026 Form W-2 instructions applies to her directly:
"The cost of accident and health insurance premiums for 2%-or-more
shareholder-employees paid by an S corporation." Verified at line 2035 of
`docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt`. This is the same
mechanism already documented above for Michael's own W-2, where Box 1 exceeds
Boxes 3 and 5 because Sec. 3121(a)(2)(B) carves the premiums out of FICA. The
matching personal deduction exists **only if the amount went on the W-2 first**.
**Needed: her W-2s for the years she was on the policy, to see how it was
reported.** Note also: the family-attribution rule that would matter if she owned
2% or less is **not** mirrored in this repo; it is not needed for this conclusion
because 5% clears the threshold on its own.

**3. A Fidelity HSA funded to the annual limit every year, connected via Plaid**,
serving as the family's health coverage. Verified from
`docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt` lines 1349-1379:
every employer HSA contribution must appear in **box 12 code W** without
exception, and lands in boxes 1, 3 and 5 **as well** if it is not excludable from
the employee's income. Employee contributions made outside a cafeteria plan are
themselves includible as wages, deductible within limits on the 1040. The rule
that decides excludability **for a more-than-2% shareholder is not mirrored in
this repo.** The widely-followed treatment makes it wages with an offsetting
personal deduction, but that is unproven here and must be sourced before any
computation. This interacts with Sec. 280E: whether a payment is a business
expense or shareholder compensation changes the tax actually owed, so the
characterisation is not clerical. **Needed: which account funds the contributions
(business or personal), and whether they appear on any W-2 or in box 12.**

**4. The QBI deduction is reported as 0.00 and Michael is unsure whether that is
right.** Two readings, mutually exclusive, and the repo takes no position: either
it is a deliberate position that Sec. 280E-disallowed activity generates no
qualified business income, or it is an omission. The way to distinguish them is
documentary - a deliberate position generally leaves a supporting statement on the
return - not doctrinal argument. **Needed: the complete 2024 Form 1040 with all
statements.** Do not resolve this from either direction without it.

---

### books-69: the ATM had never touched the general ledger

*"I will gather the reports now while you begin on the first slice. I agree with
everything you are proposing, in the order you recommended."* — and, before any
of it: *"Please fix the housekeeping item first, I agree 100%, we need bullet
proof logic in place before we touch the books."*

**The recon's finding, in one line.** Fourteen modules, five test files, three
migrations, a portal scraper, a reconciliation engine — and `grep -rn "51000" src`
returned nothing at all. The ATM subsystem *looked* wired to the ledger and had
never written a single journal entry. Account `51000 ATM Surcharge Income` existed
in the chart of accounts and in no line of application code. Neither did the cash
sweep, which had moved **$532,180.08** across two entities in under four months
without either set of books recording it.

**Step 0 — the housekeeping, and D-22.** Michael asked for bulletproof reads
before touching the books, and the ask paid for itself immediately. Typing the
three ATM row reads (recon said four cast sites; there were **five** — rule 89)
exposed `Number(r.cash_load_cents ?? 0)` on a `bigint NOT NULL` column. `Number("")`
is `0`, and `atm-ui-core.ts` accepted the invented zero as a real reading of "no
cash loaded", understating vault cash. Every row type is now paired with a
`Record<keyof Row, true>` column map that the `select` string is generated from,
so select/row drift is a compile error **in both directions**. Four mutations
proven; the one that matters is that `r.surchage_cents` used to compile cleanly
and return `null`.

**Step 1 — the surcharge reaches 51000.** Pure core, no I/O: debit `10300`,
credit `51000`, entity `atm`. The 280E separation is enforced by asserting
`entityCode === "atm"` with the tax consequence in the failure message, because
CHAMP (128 T.C. 173) is the reason the ATM operation is a separate trade or
business at all. Nothing auto-posts: `atm` is not in `AUTOPOSTABLE_SOURCE_KINDS`,
and the gate asserts that against `posting-core` itself rather than restating the
rule locally. **A mutant escaped here and is worth remembering:** deleting
`.trim().toUpperCase()` from `atmSettlementSourceRef` left all 27 tests green,
because the test that seemed to cover it went through a caller that upper-cased
the terminal itself. A normalisation asserted only through its caller is not
asserted at all.

**Step 2 — the sweep, and three corrections to my own plan.** The sweep is the
one movement here that touches two sets of books at once, so it is proposed as a
pair: on the ATM books debit `36000` / credit `10300`, on the store's books debit
`10200` / credit `36000`, the two `36000` legs equal and opposite so consolidation
nets to zero — the standing close check that account's own seed comment describes.

Walking the population (rule 43) corrected the recon twice, and both are stated
rather than quietly amended (rule 89). There are **66** sweeps to x6048
($526,937.58), not 67; the sixty-seventh `TRANSFER` row went to **x3557 on
2026-07-03 for $5,242.50** — Michael's personal checking, which the recon had
said "does not appear anywhere in the four CSVs." One row in sixty-seven, and it
is the one with a different meaning.

That row produced **D-23**, the most expensive near-miss in the slice. Booked as
an intercompany pair it balances, posts, and erases itself: `41000` is not
entity-scoped, so a debit on the ATM books and a credit on the personal books
**sum to zero across the group** and the consolidated equity statement would
report that no distributions were taken — understating the basis consumption that
§1368 turns on. It is now a single entry on the ATM books, and `36000` was
considered and rejected because an undocumented owner "loan" is re-characterised
as a distribution anyway and calling it a loan first is worse.

**D-24** is two defects with one cause: designing an identifier from what reads
nicely instead of from the constraint it must satisfy. `intercompany_ref` is a
`uuid` column, so the draft's readable string ref would have been rejected by
Postgres the first time Michael pressed the button — and **no pure test could
have caught it**, because nothing pure meets the column's type. And the ledger
keys idempotency on `entity:source_kind:source_ref`, returning
`GL_DUPLICATE_IGNORED` on a repeat, so a date-plus-destination ref would have
merged the **two real sweeps on 2026-05-26** and silently dropped $3,522.50.
`occurrence` is therefore required, never defaulted: a default would make the
dangerous case look exactly like the safe case at every call site.

**Classification is by destination, which is what buys the flexibility Michael
asked for.** *"Even after the start of the new year though, I don't know exactly
how the cash flow will work, so we will need a system that allows flexibility."*
Vendors move to the ATM account on **November 1** and payroll on **January 1**.
Those payments will arrive as debits out of 6228 to destinations this code has
never seen, and they surface as `unrecognised` with a reason instead of being
absorbed into the nearest familiar bucket. A transfer arriving *into* the account
is refused too, by name, rather than posted backwards.

**Nothing in this slice posts anything.** Every proposal carries
`postable: false` and quotes `NEVER_AUTOPOST_REASONS.intercompany` verbatim — *"it
is only about 24 entries a year — automation would save minutes and risk the
balance sheet."* The words on Michael's screen and the rule in the ledger are
asserted equal, so they cannot drift.

**Step 3 — the two ATM reports disagree, and the ingest was choosing silently.**
Michael's export carries the same money twice: a Funds Movement report leg by
leg, and a Daily Settlement report day by day. The ingest read one of them and
never asked whether the other agreed. Which one it should read was not a
preference to be picked; it was measured. Across the real export the Daily
Settlement `Settlement` column equals the Funds Movement `Transaction` leg on
**112 of 115 days** and equals transaction-plus-surcharge on **zero** days, so
Funds Movement is primary and Daily Settlement is the cross-check. Where they
disagree the disagreement is now shown with both figures and the difference,
instead of one number quietly winning. **D-25** through **D-28** came out of it,
including **D-27** — three separate money formatters, one of which rendered a
negative as `$-100.00` because the sign came from `toLocaleString` and landed
inside the string. Harmless only while no negative could reach it, and books-69
ended that: the report demonstrably carries reversal rows. One
`formatMoneyCents` now, with a real minus.

**Step 4 — what a debit out of the ATM account MEANS, on its own date.** Steps 1
and 2 gave the settlements and the transfers a home. This closes the account. Of
the **72 debits out of 6228**, 67 are transfers the sweep path owns and five had
no home at all — four of them real costs (three Timberland account-analysis
charges and one Payment Alliance debit, **$25.23** together) that every previous
version refused as "not a transfer" and left permanently unclassified, in the one
entity whose expenses actually reduce tax.

**The fifth row is the one to remember.** A `DLY SETTLE MVNT` arriving as a
**Debit** for $100.00 on 2026-06-29 looks exactly like a bank charge, and booking
it as one would have been defensible-sounding and wrong. Traced into the Funds
Movement report instead of guessed: settlement day 2026-06-27 carries
`Transaction $3,060.00`, `Surcharge $107.50` and `Transaction −$100.00`, and all
three land in the bank on Monday the 29th with the rest of the weekend batch. It
is a card-network reversal that step 1's posting path **already** accounts for,
because `mapFundsMovementCsv` adds negative legs (D-26). Booking it again would
have double-counted it. It now has its own treatment, `already_accounted`, whose
whole purpose is to say "another path records this" rather than to invent a
second record of it.

**The rules are effective-dated, which is the promise the recon made** — *"A
transaction gets classified by the rule that was in force on its own date, never
by today's rules. If your CPA re-runs last March in two years' time, he gets last
March's answer."* `ClassificationRegistry` mirrors `PayrollRateRegistry`
deliberately (construction validates, overlaps are hard errors, and there is no
`current()` or `latest()` or default at all, so no caller can accidentally ask
"what is the rule now?" about a transaction that happened in May) with **one
documented divergence**: a gap is REPORTED, not refused. Michael genuinely has no
vendor-payment rule before November 1st, so wiring gap-detection into `create()`
would make the correct table the one that cannot be built.

**D-30 is why that layer exists at all.** `public.gl_account_rules` already
existed — migration 0173, well built, with its own guard trigger — and it has no
effective dating, and its unique index on
`(match_kind, match_value, coalesce(entity_id, ...))` makes adding any
physically impossible: one row per matcher, so November's rule can only
**overwrite** October's. That is exactly the dateless-rule failure the recon
promised would not happen. Step 4 therefore put a dated layer in FRONT of that
table and wrote nothing to it; the migration that reshapes the index is recorded
as open and has to land before November 1st.

**Michael's two dates are notices, not rules.** Vendors move on November 1st and
payroll on January 1st, but *which account* a vendor payment out of 6228 debits
is a decision he has not made yet — `36000` intercompany or a capital
contribution — and the difference matters to his basis. So those dates exist in
the code as `RuleNotice`, a type with no account and no treatment, which the
compiler therefore cannot post. A November vendor payment gets refused with the
notice attached for context, naming the decision still needed. Nothing invents
the rule on his behalf.

**Nothing posts.** `atm` is not in `AUTOPOSTABLE_SOURCE_KINDS`, every proposal is
`postable: false`, and the source kind is asserted **not** to be `manual` —
because migration 0172's guard (6) rejects a `manual` journal touching a control
account, and `10300` is one, so a `manual` source kind would have failed in
Postgres and passed every pure test ever written. **18 mutants, 18 killed**, each
by an assertion named for the risk. Two of them were repaired first rather than
scored: one survived because it inserted a duplicate object key that TypeScript
resolves in the original's favour, and one killed the whole file at collection
time instead of naming a risk, because the fixture it broke was a `const` in the
describe body. A mutation campaign is only evidence if the mutants themselves are
audited.

**D-29 was found on the way and is the reason to prefer executing code over
reading it.** Looking for an existing ISO-date validator to reuse turned up nine,
and a grep flagged two as broken; both were false positives, correct by different
means. A throwaway script that actually ran all nine against thirteen cases found
the real defect somewhere I had not suspected: `medical-intake-core` validated
dates with `Date.parse`, which **rolls over** rather than rejecting, so
`2026-02-30` passed as valid and became March 2nd. Those dates are a medical
recognition card's effective and expiry dates, which RCW 69.51A.230(4)(a) makes
legally operative, and they feed the check for whether a patient is a minor.

---

### books-70: the census, before any wiring

*"I agree completely that the next slice should be the census build and map so
nothing ever drifts while we wire everything up. I don't want to fold extra work
into this slice. Just build the census and then get back to me with the first
wiring slice."* And the scope, in Michael's own words: *"We need to
systematically and methodically go through each function, every aspect of the
system that generates a book entry to make sure it is producing a book entry and
that it is correct and accurate."*

**Nothing was wired in this slice, deliberately.** No new posting path, no
migration, no schema change. The product is a measurement and the gates that stop
it rotting. Wiring before measuring is how a system ends up with fourteen modules
that look connected and post nothing, which is exactly what books-69 found in the
ATM subsystem.

**The finding, in one line.** Thirty-one money events were catalogued. **Two** are
proven to reach the general ledger end to end. **Twenty-nine cannot reach it at
all.** Twenty-three have nothing that even builds the journal entry, so wiring
alone will not fix them. Only three SQL doors are ever actually called from the
application (`gl_submit_journal`, `gl_submit_intercompany_pair`,
`gl_approve_journal`) out of **66 `gl_*` functions, 15 of them writers** — the
rest are complete, guarded, tested SQL with no caller in `src/`.

**Six layers, because a thing can break in six places between a click and correct
books.** `exists` (is the entry built anywhere), `reachable` (can a real action
get to it), `correct` (balanced, right accounts, right 280E class), `accepted`
(does Postgres take it), `idempotent` (does twice leave the books unchanged),
`married` (is the bank feed matched to it rather than booking the same dollar
twice). Each fails separately, so each is measured separately. The `reachable`
layer is the one nothing pure can ever see, because purity is the absence of the
wiring in question — and it is the layer where 29 of 31 rows fail.

**Every cell cites what was checked.** A verdict with no evidence is refused by
the validator, and `UNKNOWN` and `NOT_APPLICABLE` must both say why. `UNKNOWN` is
used four times and it means *this was not measurable*, not *this is probably
fine*; a census that guesses in the reassuring direction is worse than none. The
most important refusal in the core rejects `reachable = PRESENT` on a row with no
poster, which is the precise error an earlier module-level reading of the payroll
subsystem made: the builder is finished, tested, and correct, and its only
external caller is a development script whose own header says *"Not part of the
app. Development verification only."*

**I got two things wrong and the tests now hold both corrections.** I reported to
Michael that the chart of accounts was complete and only the wires were missing,
having extracted the chart from `0173_chart_of_accounts.sql` alone — 183 accounts
— and concluded the whole fixed-asset block `21000`–`21900` was absent. It is
not: `0178_fixed_assets.sql` seeds it through `gl_upsert_account`, and with
`0189` the real total is **193 accounts across three migrations**. D-43 records
the error itself rather than quietly stating the corrected fact. Separately, a
substring grep told me `fixed-assets-core` and `period-close-core` had importers;
all five hits were comments or a mentor-gate reading the file as *text*. Both
checks are now shaped like what they claim to measure — the chart is scraped from
every migration in both seeding forms, and the import check matches an actual
`import` statement — because the substring grep was wrong *in the direction that
would have quietly marked the census wired*.

**120 tests, and 16 mutants, 16 killed.** Four of those mutants had to be
repaired before they could be scored, and each repair was a real defect in the
gates. Two survived: one softened a row's evidence string from a measured
`grep -rn ... -> 0 hits` into "wired up in a previous slice" while leaving the
status at `MISSING`, and every test stayed green — a census whose evidence can rot
will be argued with later and cannot defend itself. One made `fullyProven()`
count `UNKNOWN` as proof, which makes the report look *better* than the
repository, the single most dangerous direction for this file to drift; the test
meant to catch it was vacuous, because measurement showed **zero** rows have
`UNKNOWN` as their only unproven layer, so a hand-built fixture was needed. The
other two reported "no tests" rather than a named failure, the same
collection-time `const` in a describe body that bit books-69, and "no tests" is
indistinguishable from a surviving mutant.

**A first attempt at one gate was arbitrary and was thrown away.** Requiring
every gap verdict to exceed forty characters failed on 74 of 186 evidence
strings, all legitimately short: on the `accepted` and `idempotent` layers of a
row that cannot post at all there is genuinely nothing to measure, and
manufacturing a measurement there would be guessing. It was replaced by a
structural gate scoped to the six rows that drive the backlog — a builder exists,
nothing reaches it — whose evidence must cite something a reader can go check: a
file, a `gl_` door, or a grep that was really run.

**`docs/LEDGER_REACHABILITY_CENSUS.md` is generated, not written**, and a test
asserts the copy on disk reproduces every count, every verdict and every piece of
evidence. A hand-maintained map drifts within a slice or two, and a map that
disagrees with the territory is worse than no map, because it gets trusted. The
staleness gate was itself verified by making the document stale and confirming a
named test fails.

**Seventeen defects recorded, D-31 through D-47**, contiguous and gated as such.
Among them: no retail sale reaches the ledger at all, and the `orders` table has
no excise column, so excise and sales tax cannot yet be told apart; COGS is never
booked, which is the one deduction Sec. 280E actually allows; a vendor ACH
double-book that *balances*, which is what makes it dangerous; and the opening
balances, which stay blocked on Michael's Sage spreadsheets rather than being
invented.
