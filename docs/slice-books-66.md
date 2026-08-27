# slice books-66 — the 5208A as Michael holds it, and the exports he cannot yet make

Michael's message, verbatim, is the mandate:

> "I am just trying to mimic sage. they have an official form from esd through legal
> means, they get it directly from esd. is there a way for you to take the form 5208
> I gave you that sage produces, and somehow use it like form 940 and 941? its only
> for visualization only, I just want to mimic sages ability to show me the form."

> "however, I would not be opposed to the form looking like the one given after
> efiling, the example you have in the workspace folder, 1st_quarter_form_5208a.pdf.
> that would actually be better in my opinion as thats what I am used to seeing. if
> its not too much work, please recreate this form using some sort of form building
> software/ technique using the example I gave you."

> "let me know if what I gave you is enough to build the form and to allow for the
> exports for me to use to upload on the esd and pfml portals, I am not able to do
> this yet."

## Tasks

- [x] Finish mining `EmployerTaxHandbook-260424.pdf` (official, WA ESD, 2026-04-24)
      - [x] D-10: handbook is SILENT. Zero hits for cents/EAF/rounding of tax.
      - [x] hours round-up rule (line 705) — engine ALREADY does it (`Math.ceil`
            in `esd-eams-csv-core.ts` and `esd-paid-leave-csv-core.ts`). The
            handbook is a SECOND authority for a rule already implemented.
      - [x] deadlines: last day of month after quarter end; table at handbook
            line ~885. Q1 Apr 30, Q2 Jul 31, Q3 Oct 31, Q4 Jan 31.
      - [x] penalties: incomplete-report penalty, SOC penalty, records penalty.
- [x] Mine the two NEW specs Michael uploaded (both ESD-authored):
      - [x] `ICESA-bulk-filing-specs.pdf` (Hummel, Tami (ESD), rev Dec 2023)
            **SETTLES THE STRUCTURE HALF OF D-10**, verbatim:
            "UI Taxes Due (taxable wages multiplied by the UI tax rate)" and
            "EAF Assessment Amount ... (total taxable wages x EAF rate)".
            Per-fund, on taxable wages. Reading B (combined 0.40%) is now
            REFUTED BY AUTHORITY, not merely by arithmetic.
            Also: "EAF Tax rate ... 0.03% = 0003" confirms EAF is its own rate.
      - [x] `EAMS-bulk-filing-specifications.pdf` (Beck, Aaron (ESD), 2021)
            "Actual fractional hours should be rounded to the next higher whole
            number" — THIRD authority for the ceiling rule already implemented.
      - [x] Rounding half of D-10 still NOT stated by any of the three documents.
            Probe re-run: exactly one of four readings fits all four filed
            figures (drop wage cents, then per-fund rate, half up). Still a
            pattern, not a published rule. NOT implemented (rule 62d).
- [x] Answer Michael Q1: is what he gave sufficient to proceed? Say plainly what it
      settles and what it does not.
      ANSWER: YES, sufficient. Settles (a) the hours round-up rule, which was
      ALREADY implemented — the handbook and EAMS spec are the second and third
      authorities for `Math.ceil` in `eamsHours`; (b) the STRUCTURE half of D-10,
      per-fund rates on taxable wages, by the ICESA spec's own field names.
      Does NOT settle: the ROUNDING half of D-10 (cents on the wage base). Zero
      hits across all three documents. Written up in the owner report.
- [x] Build the 5208A visual sheet — recreate the EAMS confirmation layout from
      `1ST QUARTER FORM 5208A.pdf`, read-only, driven by real book data, boxes that
      open with an explanation (the Schedule B standard).
      `src/lib/payroll/eams-confirmation-core.ts` (pure core, ~470 lines),
      `src/components/admin/books/EamsConfirmationSheet.tsx` (read-only, no inputs),
      `src/app/admin/books/wa-quarterly/confirmation/page.tsx` (server route).
      Four charge rows open with a lesson via `CHARGE_LESSON_BY_LABEL`; reuses the
      shared `BoxLessonBody` rather than a second one (rule 25).
- [x] Answer Michael Q2: are the ESD and PFML/WA Cares exports reachable and
      downloadable from the UI today?
      ANSWER: YES, already wired and already reachable — `wa-quarterly/esd-upload/route.ts`
      (books-56/64, D-11 fix) with both links live on `wa-quarterly/page.tsx`
      (lines 585, 598). Nothing to build. He can upload today.
- [x] Implement the hours round-up rule if the engine does not already do it.
      ALREADY DONE — `Math.ceil` in `eamsHours` (`esd-eams-csv-core.ts` ~line 230)
      and in `esd-paid-leave-csv-core.ts` (~line 215). Not duplicated on the
      confirmation sheet: `confirmationHours` THROWS on a fraction instead of
      rounding, so the displayed and uploaded figures cannot silently disagree.
- [x] Close-out: five gates, ONE visual check (rule 130c), owner report + PDF,
      roadmap, commit, push, verify author email.
      Gates: vitest 472 files / 11,649 passed / 0 failed; `tsc --noEmit` exit 0;
      pure self-tests ALL PASSED; verbatim verifier 357 verified, RULE 24/35
      VERIFICATION PASSED; scoped eslint clean but for one pre-existing warning
      proven by `git stash` to predate this slice.
      Visual: `.render/50-eams-confirmation-filed-q1.png` (reproduces the filed
      document line-for-line) and `51-eams-confirmation-missing-data.png`
      (absences render red / em-dashed, never as zeros). Both inspected.
      Defects registered: D-17 (single name column, deliberate), D-18 (monthly
      counts em-dashed, engine gap). D-10 updated with the authority split.

## Deferred by the owner

- Compliance cron bot — "we will work on the compliance cron bot at the end when the
  system is ready to be used in real life."
- A Sage 5208A without the "record copy do not file" watermark; he offered to upload
  one. Not needed for the EAMS-confirmation layout he says he prefers.
