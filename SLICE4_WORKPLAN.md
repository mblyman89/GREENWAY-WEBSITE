# SLICE 4 WORKPLAN — Commit-Gate Integrity (Part A of two)

## Scoping decision (owner delegated the call)

Michael asked me to split the slice if that is what building it correctly
requires, and to grow the slice count with the scope. Grounding SLICE 4
uncovered facts that change the original one-line plan:

**Original plan:** cross-check `rowsIn` against `menu_versions.item_count`.

**What grounding actually found (verified, not assumed):**

1. `evaluateCommitGate` derives `rowsIn` from `buckets`, which are built from
   the SAME reads the gate is validating. It is **self-referential**: a
   truncated read still balances perfectly. Confirmed in
   `import-commit-core.ts:87` (`rowsIn = stagedItems + standaloneFlags`).

2. `getVersionItems()` returns `[]` on ANY read failure (SLICE 3 fail-closed).
   Correct for the public menu. But in the gate, `items = []` →
   `rowsIn = 0` → and the gate's own self-test asserts
   *"empty import trivially passes"* (`import-commit-core.ts:328`).
   **The SLICE 3 fail-closed behaviour is fail-OPEN in the gate context.**
   This is not a regression from SLICE 3 — the same hole existed before, and
   `[]` was previously also what a truncated/failed read produced.

3. `listFactReviews()` (`fact-review-store.ts:25`) has **no pagination at all**
   AND swallows errors by returning `[]`. Resolutions are what mark a review
   row decided; an empty list means every row reads as pending... but if the
   ITEMS list is also empty there are no rows at all, so the gate opens.
   On a >1,000-review import it is also silently truncated.

4. `item_count` IS trustworthy as an independent record, but only because
   `draft-injection.ts:290` increments it after injecting drafts. That
   increment is a read-modify-write inside a best-effort try/catch
   (`import-service.ts:180-184` logs and continues on failure). So a naive
   equality check would false-alarm whenever draft injection partly failed.
   **A naive `rowsIn === item_count` check would have been wrong in two
   different directions.** This is exactly why the slice needed grounding.

5. `count: "exact", head: true` is an established pattern in this repo
   (15+ call sites, e.g. `vendors/store.ts:136`). It is a server-side COUNT
   and is therefore immune to `db.max_rows`. This gives a THIRD independent
   witness that depends on neither the paged read nor the stored counter.

## The professional call

Two genuinely different kinds of work were hiding in "SLICE 4":

- **(A) Make the gate's evidence trustworthy** — pure invariant logic that
  cross-checks independent witnesses and can distinguish "0 rows because the
  import was empty" from "0 rows because the read failed".
- **(B) Fix the remaining unpaged/fail-open reads that FEED the gate**
  (`listFactReviews`) and give the gate a server-side COUNT witness.

Shipping (A) without (B) would produce a gate that is rigorous about evidence
it is still collecting incorrectly. Shipping (B) without (A) would fix the
reads but leave the self-referential arithmetic. Both must land, but they are
different risk profiles: (A) is pure and fully unit-testable; (B) touches live
DB read paths.

Standing Rule 5 requires PURE `*-core.ts` logic with `__run…Tests()`.
So the split follows the rule's own grain:

- **SLICE 4A (this branch)** — PURE integrity core + wire it into the gate.
  No DB read changes. Fully unit-tested, zero runtime risk to reads.
- **SLICE 4B (next)** — page + fail-closed `listFactReviews`, add the
  server-side `count: "exact"` witness, feed it to 4A's core.

Total slice count grows 6 → 7. Reported to the owner.

## SLICE 4A scope (STRICT — one feature)

Create `src/lib/pos/commit-integrity-core.ts` (PURE):

- `evaluateEvidenceIntegrity(input)` → verdict describing whether the counts
  the gate is about to reason over are TRUSTWORTHY.
- Witnesses (all optional except `observedItems`, so 4B can add the count
  witness without breaking callers):
  - `observedItems` — rows the paged read returned
  - `recordedItemCount` — `menu_versions.item_count` (parser-written)
  - `serverItemCount` — `count: "exact"` (4B supplies; optional here)
  - `readFailed` — explicit signal a read errored
- Rules (each unit-tested):
  - explicit read failure → NOT trustworthy (never publish on unknown data)
  - observed 0 while a witness says > 0 → NOT trustworthy (the empty-import
    fail-open)
  - observed < witness → NOT trustworthy (truncation)
  - observed > recordedItemCount → tolerated ONLY within the documented
    draft-injection drift, and reported
  - genuinely empty import (all witnesses 0) → trustworthy, gate may pass
- Wire into `evaluateCommitGate` as a precondition that refuses with a
  plain-English message.

Explicitly NOT in 4A: changing `listFactReviews`, adding DB count reads,
touching `getVersionItems`. Those are 4B.

## Scope adjustment DURING build (recorded, not hidden)

4A was planned as "pure core only, wire nothing". While building it I
confirmed that the `empty_but_expected` rule ALREADY closes the fail-open
caused by a failed item read, because `getVersionItems()` signals failure by
returning `[]`. So supplying the witnesses required no change to any read
path -- only:

  - adding `item_count` to the version `.select(...)` (already being read)
  - one new `countVersionItems()` helper using the repo's existing
    `count:"exact", head:true` pattern
  - passing three numbers to `evaluateCommitGate`

Shipping the core WITHOUT that wiring would have been dead code: a gate that
is rigorous in a file nothing calls. Wiring it is what makes the slice real,
and it carries no read-path risk. Done in 4A.

`listFactReviews` pagination + fail-closed remains 4B: it is a genuine read
path change and deserves its own slice and its own test battery. The core
already accepts `reviewsReadFailed`, so 4B is a small, safe wiring change.

## RESULT (verified, all green)

| Gate | Result |
|---|---|
| pure self-tests | ALL PASSED (import-commit 29 assertions) |
| tsc --noEmit | 0 errors |
| eslint (touched files) | 0 errors, 0 warnings |
| vitest full suite | 512 files / 13,003 tests passed (baseline 12,977 + 26) |

Non-vacuous proof -- each bug deliberately reintroduced, guardrail confirmed
failing, then restored and re-confirmed green:
  1. disabled `empty_but_expected` -> pure runner exit 1
  2. disabled `short_read` -> pure runner exit 1 (3 assertions failed)
  3. reverted gate to bare `evaluateCommitGate(buckets)` -> 2 vitest failures
  4. made `countVersionItems` return 0 instead of null -> 1 vitest failure

A test I wrote FAILED first and that was correct: I had assumed an arbitrary
`needs_review` diagnostic code creates a pending review. It does not -- only
`REVIEW_DIAGNOSTIC_CODES` (fact-review-core.ts:51) matched by
displayName/productName do. Fixed the test against the verified behaviour
rather than weakening the assertion.
