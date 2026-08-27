# Slice books-65 — the forms Michael cannot see, and the data that never reached them

Michael's order, verbatim: *"first, please finish wa forms, tell me more better
what i need to get you for D-10 to be resolved, find out why company data is not
filling the forms even though it is correctly stored in company info page in
accounting, and then tell me your plan for finishing the forms clickability
thoroughness."*

## What was MEASURED before any code was written

| Question | Command | Answer |
| --- | --- | --- |
| Is the WA page missing from the menu? | `grep -n books admin-nav-data.ts` | **No.** "WA Quarterly Returns" is line 169, gated `books.view`. |
| Do the other forms have a paper view? | `find src/app/admin/books/form-*` | 941, 940, W-2 each have `sheet/page.tsx`. **`wa-quarterly` has none.** |
| Does the 941 sheet read the company profile? | `grep -rn loadCompanyProfile src/` | Yes — 4 readers: the 3 sheet pages and the company page itself. |
| Do the profile keys match? | field registry vs sheet | Exact match: `ein`, `legal_name`, `trade_name`, `address_line1`, `city`, `state_code`, `zip_code`. |
| Then why is it blank? | `npx tsx scripts/tmp-measure-d15.ts` | **`teachingBoxes` emits NO entity boxes.** Identity is joined by `identity[box.box]`, so with no `ein`/`name`/`tradeName`/`address`/`cityStateZip` box, **0 of 5 values find a home.** |
| How many boxes lack a lesson? | `npx tsx scripts/tmp-measure-coverage.ts` | 941: 3 (`12`,`13`,`14`). 940: 10 (`4`,`6`,`11`,`13`,`14`,`15a`,`16a`–`16d`). W-2/W-3/ESD: 0. |
| Can a 5208A facsimile be built? | `pypdf` on `public/forms/esd/esd5208a.pdf` | **No. Zero widget annotations** (`/Fields: []`), and the artwork is the **2011 draft** printing the obsolete numbering (12/13/14/15) that D-13 already disproved. |

## Tasks

- [x] **D-15** — record the entity-box defect: identity computed, no box to land in.
- [x] Fix D-15 in the CLASS: `teachingBoxes` must emit the entity area for every
      form that prints one, so a specimen carries the company profile too.
- [x] Gate it: a test that FAILS if identity keys and specimen box ids ever
      diverge again, for every form and both modes.
- [x] **WA reachability** — build `/admin/books/wa-quarterly/sheet`, link it from
      the WA page the way 941 and 940 link theirs.
- [x] Record WHY the WA sheet is not a facsimile (measured, above), on the page
      itself, so the absence reads as a decision rather than an omission.
- [x] **Red squiggly** — untaught boxes must stop being a dotted amber underline
      and become a clickable box with a plain-English explanation.
- [x] Write those 13 plain-English notes (3 on the 941, 10 on the 940).
- [x] **SOC code** — a way to enter each employee's ESD work code (Michael's is
      `41-2031`). Column `soc_code` exists (migration 0207); no UI reaches it.
- [x] **D-10** — plain English, plus the exact list of what Michael must obtain.
- [x] **D-14** — record the owner's decision that Sage is wrong.
- [x] Close-out: tsc, vitest, pure self-tests, verbatim verifier, eslint, ONE
      visual check, owner report + PDF, roadmap, commit, push, verify author.

## The SOC / work code — planned before it was written

Michael: "for esd, they require a work code for each employee, so i will need a way
to enter that code in. the code my employees use is, 41-2031."

## What the authorities actually say (measured, not assumed)

- RCW 50.12.070(2)(a)(i): the quarterly report must set forth "the standard
  occupational classification **or job title** of each worker".
- WAC 192-310-010(3)(b)(vii): the SOC categories "are identified by a six-digit
  numerical code."
- ESD EAMS wage-file spec, Column H: "Can be only 6 digits or blank."

So the obligation is real, but the wage FILE column is legitimately blankable,
because the statute's alternative is a job title typed into EAMS. Therefore:

| case | severity | why |
|---|---|---|
| malformed code | **block** | it cannot be right, and EAMS rejects the upload |
| blank code | **warn** | ESD permits blank; blocking payroll would invent a rule |

Never default the field to `41-2031`. Michael said that is what HIS employees
use, which is a fact about his roster, not a system default. A code that arrived
by default states what work a person does without anyone having said so.

## Where it goes (rule 25 — extend, never duplicate)

- Step: `labor_role` ("What kind of work they do"). Not a new step.
- Validator: reuse `eamsSocCode()` from `esd-eams-csv-core`. No second regex.
- Column: `employees.soc_code`, already created by migration 0207.
- Reader: `listEmployeeSetup` already selects named columns; add `soc_code`.
- Writer: fold into the existing `employees` update beside `ssn_full`.
- UI: one input in `EmployeePayrollSetupForm`, in the labor-role card.


## Clickability thoroughness — the plan, and the measurement it rests on

Michael: *"the boxes that dont have lessons, the boxes look like there is a red
squiggly line in it, but id rather they just open a box that says in plain
english what it is and why it doesn't need a lesson."* And: *"on the 941
schedule b, every single box opens with an explanation. this is the level of
thoroughness i want."*

There are two ways to answer that. One is to build a second kind of panel — a
"why this box needs no lesson" panel — and wire the untaught state to it. The
other is to write the lessons, so no box is untaught and the squiggly has
nothing left to mark.

The second is the smaller change AND the better product, and the measurement is
what decided it. Question: is there real verbatim authority for every untaught
box, or would some of them have to be explained on my own say-so (rule 62d)?

    $ npx tsx scripts/tmp-gap.ts
    form_941: 32 boxes |  8 UNTAUGHT -> [ein, name, tradeName, address, cityStateZip, 12, 13, 14]
    form_940: 35 boxes | 15 UNTAUGHT -> [ein, name, tradeName, address, cityStateZip, 4, 6, 11, 13, 14, 15a, 16a, 16b, 16c, 16d]
    form_w2:  26 boxes |  0 UNTAUGHT
    form_w3:  31 boxes |  0 UNTAUGHT
    esd_5208a / esd_5208b / pfml_wa_cares / lni_quarterly: 0 UNTAUGHT

Twenty-three boxes. Then, for each one, is the instruction text on disk?

    941 line 12   irs-instructions-941-2026.txt:1322  "Subtract line 11 from line 10 ..."
    941 line 13   irs-instructions-941-2026.txt:1354  "Enter your deposits for this quarter ..."
    941 line 14   irs-instructions-941-2026.txt:1360  "If line 12 is more than line 13 ..."
    941 entity    irs-instructions-941-2026.txt:679   "Type or print your EIN, name, and address ..."
    940 line 4    irs-instructions-940-2025.txt:1041  "If you enter an amount on line 4 ..."
    940 line 6    irs-instructions-940-2025.txt:1162  "To figure your subtotal ..."
    940 line 11   irs-instructions-940-2025.txt:1372  "If you paid FUTA taxable wages ..."
    940 line 13   irs-instructions-940-2025.txt:1393  "Enter the amount of FUTA tax that you deposited ..."
    940 line 14   irs-instructions-940-2025.txt:1397  "If line 13 is less than line 12 ..."
    940 line 15a  irs-instructions-940-2025.txt:1439  "If line 13 is more than line 12 ..."
    940 line 16   irs-instructions-940-2025.txt:1521  "Enter the amount of your FUTA tax liability ..."
    940 entity    irs-instructions-940-2025.txt:814   "Enter your EIN, name, and address ..."

Twenty-three for twenty-three. So NONE of these is a box that "doesn't need a
lesson" — every one of them is a box nobody had written yet. Michael's fallback
panel turns out to be unnecessary, which is the best possible outcome of asking
the question before building the feature.

Every quote below was extracted by `scripts/tmp-extract.ts`, which slices the
corpus between two anchors and prints the result as a JS string literal. Nothing
was retyped, so the 941 gate's `corpus.includes(q.quote)` cannot fail for a
transcription reason — and if it does fail, it means the corpus changed.

## What the build made me do that I had not planned

1. **D-16.** The visual check found the new work-code box showing the labor
   role's error message, after all five gates were green. Fixing it meant
   changing the shape of `ChecklistRow`, which was not in this plan and is the
   most valuable thing in the slice.
2. **D-10 turned out to be a wrong entry, not an open question.** The plan said
   "explain D-10". Explaining it honestly required re-doing the arithmetic, and
   the arithmetic refuted the entry's central claim. The deliverable changed from
   an explanation into a correction plus a measurement.
3. **Two count-pins had to be widened** rather than bumped, because adding one
   test to the engine suite broke two unrelated assertions in the books-41 owner
   report gate. Rule 129d says widen; both were widened and both were
   re-verified to still catch a real deletion.
4. **The screenshot harness would not run.** Playwright asks for a Chromium build
   that is not on disk, and installing one is a ~170MB download onto a volume at
   87%. The shooter now falls back to the build that exists, loudly.
5. **`docs/DEFECTS.md` had no D-15 entry** even though eight files cite D-15 by
   number. Rule 131 requires the entry, so it was written.

## A real bug this found, before it could bite

`4-12031` strips to six digits, so `eamsSocCode` accepted it — but the 0207 CHECK
constraint `^[0-9]{2}-?[0-9]{4}$` would have rejected it. The screen would have
reported a successful save while the database threw. `socCodeCanonical` re-seats
the hyphen so the stored value satisfies the constraint by construction, and a
test reads the regex out of the migration file itself rather than restating it.
