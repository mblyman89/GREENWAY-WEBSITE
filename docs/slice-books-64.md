# books-64 — The Washington forms: ESD first, then PFML / WA Cares

Michael's mandate, verbatim:
- "Let move into the Washington forms. Please work on esd first, then pfml/ wa cares second."
- "The later is one form and one upload. I gave you the upload requirements."
- "When we go to do the pdf exports, we will need an export .csv for esd and pfml/ wa cares."
- "Please research the upload structure and requirements for esd while building these forms
  and learning lessons on boxes that bite."
- "Follow the standing rules and stay within budget. Never guess."

## What already exists (MEASURED before writing anything — rule 25)

- `wa-quarterly-core.ts` (976 lines) already COMPUTES all four WA forms. `WaQuarterFormId`
  is `"esd_5208a" | "esd_5208b" | "pfml_wa_cares" | "lni_quarterly"`, and ten lines are
  emitted across them. **No new arithmetic is needed in this slice.**
- `esd-paid-leave-csv-core.ts` (511 lines, books-56) already writes the PFML / WA Cares
  8-column upload WITH its required header row, and already records `EAMS_COLUMN_ORDER`
  purely so a gate can prove the two 8-column files never converge.
- Both authorities are already mirrored: `esd-eams-wage-file-import.txt` and
  `esd-paid-leave-wa-cares-csv-spec-v8.txt`.
- `form-box-lessons-wa.ts` (1031 lines) already teaches the WA boxes.

So the gap is: **the 5208A/B on paper, and the EAMS CSV writer.**

## THE MEASUREMENT THAT DECIDES THE APPROACH

`form 5208A.pdf` and `form 5208B.pdf` were probed for AcroForm widgets, including
inflating every FlateDecode stream (30 and 32 streams respectively):

```
form 5208A.pdf  AcroForm: True   /Widget: 0   /Rect: 0   /FT: 0
form 5208B.pdf  AcroForm: False  /Widget: 0   /Rect: 0   /FT: 0
```

**Zero fillable rectangles on either form.** The federal pipeline
(`derive-form-geometry.py`) reads `/Widget` `/Rect` entries out of the PDF, so it
CANNOT be pointed at these. This is a real structural difference between the IRS
forms and ESD's, not a defect, and it must not be papered over by inventing
coordinates — rule: never guess.

`pdftotext -layout` DOES read both forms cleanly, and the 5208A's numbered lines
1–23 extract intact.

## FOUR MORE MEASUREMENTS, TAKEN BEFORE ANY CODE, THAT CHANGED THE PLAN

### 1. The blank 5208A in the workspace is from 2011 and is OBSOLETE

`pdfinfo` on `form 5208A.pdf`: `Creator: Adobe Illustrator CS3`, title
`5208A-final-draft-4-2011`, `CreationDate 2011-06-22`. Its printed line
numbering runs 1-23 and it states the excess-wage threshold **in the artwork**:

```
13) EXCESS WAGES ... in excess of $37,300 per employee since January 1 of this year
```

Michael's own Q1 and Q2 2026 returns disagree with that document on BOTH counts:

| | 2011 blank PDF | his filed 2026 returns |
| --- | --- | --- |
| Gross wages line | 12 | **13** |
| Excess wages line | 13 | **14** |
| Taxable wages line | 14 | **16** |
| UI tax line | 15 | **17** |
| EAF line | 16 | **18** |
| Total due | 22 | **24** |
| Wage base printed | $37,300 | **$78,200** |

Our registry already carries $78,200 for 2026 (`payroll-rates-2026.ts`), so the
engine is right and the 2011 paper is stale. **Had I laid our figures onto that
artwork, every single amount would have printed one-to-two lines above its own
caption, and the wage base on screen would have contradicted the filing by
$40,900.** Rule 115: a filed return outranks both my reasoning and a stale PDF.

### 2. ESD paper forms cannot be printed by us AT ALL - this is an authority, not a preference

WAC 192-310-010(3)(c)(ii), already mirrored, quoted verbatim:

> "Paper forms supplied by the department (or an approved version of those
> forms). Agency forms include "drop-out ink" that cannot be copied. Therefore,
> photocopies are considered incorrectly formatted reports and forms."

And ESD's own filing page: *"Our system cannot process other forms or copies of
our forms. To avoid an incomplete report penalty, get paper forms from us."*

Both of Michael's real 5208s are stamped **"THIS REPORT IS EFILE ONLY"** and
**"Do Not File"**. So a pixel-perfect facsimile of the 5208A would be a form
that is *penalised* if filed. The federal forms are the opposite - the IRS
publishes fillable PDFs meant to be printed and mailed.

**Decision: the 5208A/5208B get a faithful on-screen WORKSHEET keyed to the line
numbers on his filed returns, carrying an explicit "this is not a filing copy"
notice, and the FILING path is the CSV upload + EAMS.** That honours "see the
form as it would look if I were holding it in my hand" for reading and checking,
without manufacturing a document that would earn a penalty. No coordinates are
invented, because no facsimile is drawn.

### 3. Q1 2026 exposes a rounding conflict the engine currently gets wrong one way

His filed Q1: gross **$61,531.21** (the 11 wage-detail rows sum to exactly
this), UI **$227.66**, EAF **$18.46**, total **$246.12**.

```
UI  0.37% of 6153121c = 22766.5477c   statutory half-up -> 22767   ESD CHARGED 22766
EAF 0.03% of 6153121c =  1845.9363c   statutory half-up ->  1846   ESD CHARGED  1846
```

EAF needs the round UP; UI needs it DOWN. No single rounding rule reproduces
both, and per-employee rounding reproduces neither (22767 / 1844). But
`0.40% of 6153121c = 24612.484c -> 24612`, which is the total ESD charged to the
cent. Q2 is consistent with either reading (both give 275.70). **This is
recorded as an open question with the evidence, not resolved by picking the
rounding that flatters us** - it is a $0.01 question on a real filing, ESD bills
from its own computation anyway, and inventing a rule is exactly what rule 62d
forbids. Logged as D-10.

### 4. `buildPaidLeaveCsv` is called from nowhere - D-08's class, again

`grep -rn "buildPaidLeaveCsv" src/` outside its own module returns **nothing**.
511 lines of correct, spec-quoted, gate-covered CSV writer that no screen can
reach. Michael said in this very slice: *"we will need an export .csv for esd
and pfml/ wa cares"* - the PFML half already exists and is stranded. Rule 125d.

## Tasks

- [x] Provenance: mirror + sha256 the two 5208 PDFs and the EAMS/Paid Leave specs into the
      authorities file, recording the zero-widget measurement so nobody re-derives geometry
- [x] EAMS CSV writer (`esd-eams-csv-core.ts`): 8 columns, **NO header row**, in EAMS's own
      order (SSN, Last, First, Middle, Suffix, Hours, GrossWages, SOC), with every column
      rule from the mirrored spec enforced as a REFUSAL not a coercion
- [x] The two-file trap as a GATE: EAMS output must never be mistakable for Paid Leave
      output and vice versa (same column count, different meanings)
- [x] 5208A on paper WITHOUT invented geometry - DECIDED: a worksheet keyed to the filed
      line numbers, NOT a facsimile. WAC 192-310-010(3)(c)(ii) forbids the facsimile and
      both blank PDFs carry zero AcroForm widgets, so there is no geometry to read.
- [x] Verify/add the DB columns the store selects - migration 0207 + an executed verify
      script against real PostgreSQL 15 (21 checks, 0 failures). Logged as D-12.
- [x] 5208A/5208B worksheet CORE keyed to the FILED line numbers 13/14/16/17/18/**19**
      (not the 2011 artwork's 12/13/14/15/16/22, and not the plan's own wrong "24")
- [x] Lessons on boxes that bite: **excess wages** (line 14) and the **12th-day headcount**
      (line 12). EAF and the PFML two-step already had lessons from books-56.
- [x] Wire both CSVs to a download the owner can actually reach (rule 125d) - fixes D-11
- [x] Render the worksheet on the `wa-quarterly` page + both download buttons
- [x] Append D-10 through D-14 to `docs/DEFECTS.md`
- [x] A vitest test file for the new cores - 5 tests appended to `wa-quarterly.test.ts`,
      reusing the real filed-quarter fixture rather than inventing a second one
- [x] Run ONCE at the end: tsc (clean), full vitest (**11,564 passed / 470 files**),
      pure self-tests (all passed), verbatim verifier (345 verified), scoped eslint
      (0 errors; 1 pre-existing warning, confirmed pre-existing by stashing)
- [x] ONE visual check per new surface (rule 130c) - the worksheet photographed via a
      static-render harness, because there is no `.env` here and `next dev` serves the
      access gate rather than the page (measured: HTTP 200, "setup required")
- [x] One-page owner report + PDF, roadmap, commit, push, verify author

Deferred: PDF export of the forms themselves, after this slice completes the form set.

## What the count-pinned tripwires cost, and why that is the system working

Adding two specimen boxes and two lessons turned **seven tests red in five files**
that this slice never touched: the forms roadmap (lesson/tie totals), and the
books-41, books-53, books-55/56 and books-58 owner-report gates. None was a bug
in the new work. Every one was a prior slice's promise to Michael, pinned so it
cannot rot silently.

They were discharged the way the house pattern already established in books-60:
the historical sentence is **left standing**, today's figure is pinned exactly so
a deletion still fails, and a floor is added so coverage can never fall below what
he was told. Two of them also got a recorded REASON for the movement, because the
books-53 gate refuses an unexplained divergence outright.

One of them was a real defect in the guard rather than a stale number. The books-41
"can the counter tell the difference" test compared a naive regex count against a
**hardcoded 72**, because the accurate counter was declared inside a different
test and was unreachable. A literal on that line has to be hand-edited every time
a test is added, which is exactly how a guard goes stale. `countTests` is now
hoisted to module scope and both sides are measured, so the invariant is the GAP
of seven loop-generated tests rather than either number.
