# SLICE 17 — build log (the "otherwise taken into the body" ten-unit limit)

Tracking file for this slice. **Deliberately NOT `todo.md`** — that file is 3,577
lines of standing rules and is asserted against by
`tests/compliance/owner-operator-self-approval.test.ts`. It must never be
overwritten.

Branch: `slice-17-otherwise-taken-limit`, off `694722a0` (SLICE 16).

## A. Law — COMPLETE
See `docs/slice-17-legal-findings.md`. Seven findings, each re-scraped from the
primary source this slice rather than reused from the SLICE 16 appendix.

## B. Design — COMPLETE
See `docs/slice-17-design-decisions.md`. Eight decisions, written before code.

## C. Build

- [x] C1 engine — `sales-limits-core.ts`: sixth bucket, `"units"` denomination,
      `qualifiesAsOtherwiseTaken`, `lineUnits`, `suspectsOtherwiseTaken`,
      `formatLimitAmount`, clamp + resolve wiring. 62 new tests, RED first.
- [x] C1b existing tests STRENGTHENED (not loosened): pinned tripling/flat SETS,
      exact bucket names, `LIMIT_BUCKET_UNITS` completeness.
      Full suite: 534 files / 13,604 tests green.
- [ ] C2 migration `0217_otherwise_taken_limit.sql`
- [ ] C3 settings row type + `getSalesLimitSettings` wiring
- [ ] C4 back-office settings page
- [ ] C5 register plumbing
- [ ] C6 website plumbing
- [ ] C7 order snapshot
- [x] C8 truth surfaces (KB, analyst map, bible, naming, POS research).
      33 new tests in `otherwise-taken-truth-surfaces.test.ts`. The KB prose was
      run through the REAL `checkCompliance()` gate BEFORE being written (see
      GOTCHA #2: blocked text is dropped SILENTLY, so a customer asking about
      suppositories would have been quietly told the 72 oz liquid rule while
      every test still passed). All four shipped sentences PASS; three trap
      sentences ("dose", "N mg per", "medicinally to treat") all BLOCK, which is
      what proves the gate assertion is not vacuous.
      **Also corrected a SLICE 16 statement that this slice made FALSE:**
      `compliance-surface.ts` told the regulatory analyst that low-THC beverages
      are "the only bucket that does NOT triple". There are now TWO, and they
      resist tripling for DIFFERENT reasons \u2014 (2)(d) NAMES the identical 200 mg
      figure, but OMITS "otherwise taken into the body" entirely. An analyst
      reading the stale sentence against a future LCB bulletin would have
      concluded the ten-unit cap DOES triple and proposed a 30-unit medical
      limit. Pinned by a dedicated regression test so it cannot go stale again.

## D. Ship
- [ ] All-six-bucket feature parity test
- [x] Mutation testing (100% of mutants actually injected were killed).
      Three rounds, because the FIRST ROUND'S SCORE WAS MISLEADING and reading
      the log rather than the number is what exposed it:
      * **Round 1** (`mutation_test.py`) \u2014 reported "7/10 killed, 3 survivors".
        None of the three was a test hole: all three were ANCHOR failures
        ("matched 2x", "matched 0x"), meaning the mutation was never injected.
        A mutant that was never applied is not a mutant that survived. A fourth
        (medical tripling) was skipped outright by the loop's own
        `if find == replace: continue` because its placeholder was never filled
        in \u2014 so the single most important legal finding in the slice had ZERO
        mutation coverage while the report implied 70%.
      * **Round 2** (`mutation_test_2.py`) \u2014 11 mutants, every anchor verified
        to match exactly once in a PRE-FLIGHT that aborts rather than proceeding
        on a partial set. **11/11 killed**, including medical-tripling,
        rec 10\u219211, all four flooring mutants, units-as-ounces, the silent
        suspicion detector, register-drops-the-flag, website-drops-the-flag, and
        the public table rendering a count through the gram formatter.
      * **Round 3** (`mutation_test_3.py`) \u2014 the intake mutants, re-run after
        the file recovery so that every assertion has a proven kill against the
        RESTORED source rather than the pre-crash one.
      Both surfaces Michael asked about are covered by a dedicated mutant: if
      either the register or the website drops the flag, a test fails.
- [ ] tsc + eslint + `run-pure-selftests.ts`
- [ ] PR + fast-forward merge + CI green
- [ ] Report to Michael

## Bugs this slice's tests caught (evidence the tests have teeth)

1. **Silent no-block.** `clampLimitProfile`/`resolveLimits` did not know about
   `otherwise_taken`, so the resolved max was `undefined`, `overBy` was `NaN`,
   `exceeded` was `false` — the ten-unit limit did not block at all. The feature
   would have shipped looking complete and doing nothing.
2. **Clobbered splice.** `step5_existing_tests.py` buffered edits by re-reading
   each file from disk per edit, so two edits to the SAME file silently
   discarded the first. The import of `LIMIT_BUCKET_UNITS` vanished and the
   assertion it fed threw `ReferenceError`. Fixed by accumulating per-file in a
   dict while still writing nothing until every anchor matches.
3. **A comment that lied about the code (found by mutation testing).**
   `clampLimitProfile` carried the comment *"floored to an integer: a limit of
   10.5 units is not a thing"* \u2014 and the code below it contained no
   `Math.floor` at all. It ran the plain gram clamp, so a settings row of
   `7.9` produced a cap of **7.9 units**: a COUNT of physical items rendered as
   a fraction, and a screen figure ("10.5 units") that no cart could ever
   reach, leaving a budtender arguing a limit they cannot satisfy. Migration
   0217's `= floor(...)` CHECK guards the WRITE path, but `clampLimitProfile`
   takes `raw: unknown` and is the choke point for the READ path \u2014 legacy rows,
   hand-edited overrides, future importers. Fixed with a dedicated `clampUnits`
   that floors, never rounds (9.99 \u2192 9, because rounding up would hand back a
   unit the owner deliberately removed), and falls back to the statutory figure
   rather than to zero (a cap of 0 is not a strict limit, it is an outage that
   blocks every suppository sale in the shop). Six new tests, RED first.
   **This is the exact class of defect a passing suite cannot find: the tests
   were green, the code compiled, and the comment described behaviour that did
   not exist.**
4. **The mutation harness itself was under-testing.** Round 1 reported
   "7/10 killed" with three survivors. Reading the log rather than the score
   showed none of the three was a test hole \u2014 all three were ANCHOR failures
   ("matched 2x", "matched 0x"), meaning the mutation was never injected. A
   fourth mutant, the medical-tripling one, carried a placeholder whose `find`
   and `replace` were identical and was skipped by the loop's own
   `if find == replace: continue`. So the single most important legal finding
   in the slice \u2014 that WAC 314-55-095(2)(d) omits the category, therefore no
   tripling \u2014 had **zero** mutation coverage while the report implied 70%.
   `mutation_test_2.py` re-runs all of them with a PRE-FLIGHT that verifies
   every anchor matches exactly once before mutating anything, and aborts
   rather than proceeding on a partial set.
5. **A SIGKILL left a fake legal rule in the working tree.** The first attempt
   at round 2 was hard-killed by the sandbox supervisor mid-mutant. `finally`
   does not run on SIGKILL, so `MEDICAL_LIMITS.otherwise_taken: 30` \u2014 a
   deliberate 3x over-sale \u2014 was left sitting in `sales-limits-core.ts`. It was
   caught by inspecting the tree rather than by trusting the harness, and
   restored. The runner now writes a `.mutation-in-progress` sentinel naming
   the mutated file before each injection and removes it only after the restore
   succeeds; a later run finding a stale sentinel REFUSES to start and prints
   the `git checkout` needed. It also runs under `setsid` and gives each suite
   a hard timeout. **Lesson recorded because it generalises: a tool that
   deliberately breaks the source must be designed to fail safe when it is
   killed, not merely when it throws.**
