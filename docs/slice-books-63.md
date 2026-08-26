# books-63 — Form 940 + W-3 on paper, and one scope selector for every form page

Michael's mandate, verbatim:
- "Yes please complete 940 and w-3 this next slice, with lessons on boxes that bite only please."
- "sorting and filtering per period/ employee/ qtr/ yr, etc would be really handy on the forms
  pages in some way. I am not sure the smart industry standard or professional way to do it."
- "Please make sure you are building these features so I can sort and filter that works with the
  full form workflow and all its tabs and pages."
- "Follow the standing rules, stay on budget, and do what the expert would do."

Rule 132(c): BATCH like-for-like. 940 and W-3 ship together.

## Tasks

- [x] Geometry: 940-p1 (59), 940-p2 (31), w3 (46) input areas measured + SVG art
- [x] Box map: extend `derive-form-box-map.py` with `derive_940` and `derive_w3`
- [x] D-04 discipline: cents `/MaxLen` measured per form — 940 = 2, W-3 does not split
- [x] Rule 123: every one of 59/31/46 rects placed or reasoned
- [x] Verify 941/W-2 output unchanged by the shared `glue_runs` addition
- [x] Sheet page for the 940 (both pages) reusing `FormFacsimile`
- [x] Sheet page for the W-3 reusing `FormFacsimile` — placed ON the W-2 sheet, above the
      W-2s it sums, and hidden when one employee is selected (batch totals over a single W-2
      read as that person's). The W-3 has no route of its own, by design.
- [x] ONE shared scope selector (year / quarter / employee) across ALL form pages and tabs,
      preserving the existing `?year=&q=&employee=` URL contract
- [x] Provenance for f940.pdf / fw3.pdf / i940 / iw2w3 into the authorities file
- [x] Lessons: only boxes that bite — 940 (20) and W-3 (31) hand over clean; the source-tree
      gate reports "7 lesson sets in source, all handed over"
- [x] Run ONCE at the end: tsc clean, 11,559 vitest tests in 470 files, pure self-tests,
      verbatim verifier (345 verified), scoped eslint — all four CI steps green LOCALLY
      (CI does not fire on token-based pushes)
- [x] ONE visual check per new surface — and it caught D-09 (a live 940 with no EIN, name or
      address on either page) plus D-08 (`normaliseEinInput` dead code). 940 p1, 940 p2 and
      the W-3 all looked at against a LIVE-shaped return, not the specimen
- [x] Wire `normaliseEinInput` so a pasted `46-4217016` is accepted instead of hitting a raw
      Postgres constraint error (Michael, this slice: "Please include in this slice the fix to
      wire normaliseEinInput so it is not dead code.")
- [x] One-page owner report + PDF, commit, push, verify author

Deferred, in his stated order: PDF export after ALL forms including the Washington ones;
then ESD 5208A/B + PFML/WA Cares if budget allows. L&I has no form — skipped.
