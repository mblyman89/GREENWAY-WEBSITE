# books-67 — the download button that looked forbidden, and the form that would not draw

## What Michael reported, verbatim

1. *"I think I see the export button for esd and pfml, the button is not very
   clear it is the button to use to export the files for esd and pfml/ wa cares,
   it has a circle with a slash in it when I hover over that box. Are you able to
   make it more obvious and have text that tells me this is where you download
   the report."*
2. *"the esd form page says it refuses to draw the form because there is 1
   problem, no payroll yet. I just want to make sure this is correct behavior, or
   if I should still be able to see the form without payroll data in it? Ideally
   I'd like to see the form like all the others, even with no payroll data."*

## What was measured before touching anything

**Both reports have ONE root cause**, and it is a defect class this repository
has already fixed once.

`src/app/admin/books/wa-quarterly/page.tsx` gates the whole "Upload files" card
on `result.ok` (line 575). With no payroll, `validateWaQuarterRequest` raises
`NO_SUBJECTS` ("This quarter has nobody on it at all"), `result.ok` is false, and
**the card containing both download links is not rendered at all.**

So the thing Michael hovered was NOT the download link. The only
`cursor-not-allowed` on the page is line 698 — the *"Taking these figures to the
State"* button, deliberately inert ("the button that does not file"), which
renders unconditionally and is therefore the only button-like object visible when
payroll is empty. He hovered the one control that is supposed to look forbidden,
because the two that are not were invisible. **His two reports are the same bug
seen from two angles.**

`confirmation/page.tsx` refuses via `CannotDraw` on `!loaded.result.ok`, which is
the same `NO_SUBJECTS` refusal — hence "refuses to draw the form because there is
1 problem".

**The precedent settles the answer.** `tests/compliance/form-sheet-core.test.ts`
line 440: *"books-49: hiding a teaching surface behind `result.ok` made it
invisible for a year. But a read FAILURE must not show invented figures as though
they were his."* The `sheet` route already implements the correct three-state
split (`ratesMissing` / `readFailed` / honest-empty) and falls back to
`teachingBoxes`. The confirmation route does not. **Same class, recurred on a new
route** — standing rule 23 says fix the class.

Michael's instinct is therefore correct AND matches existing repo law: an empty
quarter must still draw the form.

## Tasks

- [x] Confirm `NO_SUBJECTS` is the refusal he hit, and that it is the ONLY one on
      an otherwise-clean empty quarter (do not fix the wrong refusal).
      CONFIRMED by `probe-books-67-empty.ts`: exactly one refusal, NO_SUBJECTS,
      "This quarter has nobody on it at all." Matches his "1 problem" exactly.
- [x] Make the two download links unmissable and always reachable.
      Card no longer wrapped in `result.ok` (that was D-20). Real buttons with a
      `download` attribute, each stating "This is the file you upload to EAMS" /
      "...to the Paid Leave portal", plus a blue panel on an empty quarter.
- [x] Confirmation page: draw the form on an honest-empty quarter.
      `buildEamsConfirmation` accepts `ret: null` (one builder, not two — rule 25)
      and dashes every derived figure. Branches on the refusal CODE, so only
      NO_SUBJECTS alone earns the blank form; every other refusal still refuses.
- [x] Gate it in the CLASS, not the instance.
      Added to `form-sheet-core.test.ts` beside the books-49 gate it generalises:
      walks back from each download link to its enclosing Card and fails if the
      preceding conditional is the figures gate. Mutation-proven both ways.
- [x] Answer the ATM question in the owner report.
      All four uploaded files measured: $526,620.00 transaction settlements vs
      $16,272.50 surcharge (separated in the data, confirming his model); 230
      DLY SETTLE MVNT credits vs 66 transfers out. Three owner questions named:
      the date practice changes, the ATM contract/1099, and which accounts x6048
      and x3557 are. No ATM code written (rule 132).
- [x] Close-out: five gates, ONE visual check (rule 130c), owner report + PDF,
      DEFECTS entry, roadmap, commit, push, verify author email.
      Gates: vitest 472 files / 11,659 passed; tsc exit 0; pure self-tests passed;
      verbatim 357 verified RULE 24/35 PASSED; eslint clean but for one
      pre-existing warning. Visual check found D-19 (see below).
      Defects registered: D-19 (blank form contradicted itself on headcount —
      found by the screenshot, not by any test), D-20 (the vanishing download
      card, second occurrence of the books-49 class).

## Explicitly NOT in this slice

- The ATM/Plaid wiring itself. Michael described the model and asked what else is
  needed; answering that is this slice, building it is the next one.
- D-10's rounding half. He looked for the ESD mail and could not find it. Nothing
  changes: it stays open and uninvented (rule 62d).
