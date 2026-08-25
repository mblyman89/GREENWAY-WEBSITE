# books-56 scratch plan — the four WA forms (DELETE BEFORE FINAL COMMIT)

## Baseline measured at start of slice two (HEAD 57843b96)
- tsc 0 · eslint (CI scope) 0 · 455 files / 11,168 tests green
- 335 quotes verified, 130 unmirrored (34 recorded debt)
- todo.md vs main: 104 added / 0 deleted (append-only intact)
- standing rules through 111

## THE GAP, MEASURED (not assumed)
14 WA specimens, 8 lessons. Six boxes have a specimen and NO lesson:

| form | box | caption | state |
|---|---|---|---|
| esd_5208a | esd-total | Total due | GAP |
| esd_5208b | employee | Employee name and SSN | GAP |
| esd_5208b | wage-detail-wages | Total gross wages paid this quarter | GAP |
| esd_5208b | wage-detail-hours | Total hours worked this quarter | GAP |
| esd_5208b | wage-detail-total | Report total — sum of every row | GAP |
| lni_quarterly | lni-premium | Amount owed | GAP |

esd_5208b is the worst: 4 specimens, ZERO lessons. This is the form that
carries the actual wage detail per employee.

## Known pins that must be updated DELIBERATELY (not silently)
- `owner-report-books-54.test.ts` pins `lessonsFor5208b` at 0, and the books-54
  report prose says "zero lessons". Both must change together, and the books-54
  report is a DATED DOCUMENT — do not rewrite history, add a correction the way
  the books-55 retraction was handled.
- `form-box-explorer-wiring.test.ts` `checksMissingBecause` prose for
  `wa-quarterly`.
- `docs/ROADMAP-forms-and-lessons.md` measured table: wa row is 8/4; total
  103/96. Gated by `forms-roadmap-tracker.test.ts` — it WILL go red, by design.
- `books-roadmap-agreed-order.test.ts` count-of-counts pin currently 7.

## Legs
- [ ] Mirror the ESD CSV spec under docs/authorities/state-wa/
- [ ] Lessons for the 6 gap boxes (authoritative text, verbatim, no invention)
- [ ] PFML/WA Cares CSV writer to the v8.1 spec
- [ ] Gate the CSV byte-for-byte against the spec's own example
- [ ] Mutation-prove: rounding down, comma in wages, stripped SSN leading zero,
      wrong column order, omitted empty column, totals row present
- [ ] Update the four pins above, each with a recorded reason
- [ ] Full verify + roadmap + owner report + PDF + gate
- [ ] DELETE this file; push BOTH slices; ONE combined summary report
