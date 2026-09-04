# SLICE 18G — Defect 3 fixed: classifications survive a re-stage

Slice 18E found the defect and proved it. This slice fixes it, guards it so it
cannot come back quietly, and reports on the data it already destroyed.

Standing rule, as always: do not guess, do not assume. Build from fact, not
memory. Every claim below was verified against source, against a real
PostgreSQL 15, or by breaking the code and watching a test notice.

---

## What was wrong

Four columns on `menu_items` are what the register reads to decide whether a
cart has crossed a statutory sales limit. Migration 0219 labels them the
ENFORCEMENT SOURCE OF TRUTH:

| column | what it decides |
| --- | --- |
| `otherwise_taken` | the ten-unit bucket, WAC 314-55-095(1)(d)(i)(D) |
| `units_per_package` | how many units are in one package, RCW 69.50.101 |
| `low_thc_liquid` | the 200 mg carve-out, WAC 314-55-095(1)(d)(i)(E)+(F) |
| `unit_thc_mg` | the per-unit ceiling that carve-out depends on |

Every time a manifest was received, the intake path rebuilt the menu by copying
the live rows forward field by field, then auto-published the result. The four
columns were not in that copy list. They were not fetched into the type, not
carried by the mapper, and not written by the insert.

So a classification a human had actually made was erased on the next delivery,
and the row went back to `NULL`. `NULL` is the fail-open value: the limit
simply stops engaging. Nothing looks broken from behind the counter. It looks
like a normal sale.

---

## The finding 18E did not have: it was BOTH producers

The 18E writeup described this as a carry-forward bug. Reading the code for
this slice showed it was wider than that. A staged row has **two** producers,
and both dropped all four columns:

- `carryForward()` — the live product being carried into the new snapshot.
  A classification set weeks ago was erased.
- `masteredToSnapshot()` — the newly approved product arriving from intake.
  Slice 18-0 had deliberately plumbed these values all the way to
  `PlannedInjectedItem`, and `standaloneCard()` preserved them through its
  `...rest` spread — and then this mapper dropped them on the last hop.

That second path means the answer the approver gave **at the gate, minutes
earlier**, never reached the register either.

Proven mechanically before any code was written: `grep -c` over the body of
`masteredToSnapshot()` returned `0` occurrences of all four column names.

Fixing only the first producer would have looked like a fix and still lost
data. This is recorded because the original writeup was incomplete, and the
record should say so.

---

## The fix, in four layers

| layer | file | what changed |
| --- | --- | --- |
| READ | `intake-menu-staging.ts` → `loadCarryForwardItems()` | map the four off the published row |
| TYPE | `intake-menu-staging-core.ts` → `CarryForwardItem` | added, **optional** |
| TYPE | `intake-menu-staging-core.ts` → `StagedSnapshotItem` | added, **required** |
| MAPPER | `carryForward()` | carry the four with `?? null` |
| MAPPER | `masteredToSnapshot()` | carry the four |
| WRITE | `persistSnapshotItems()` | include the four in the insert |

The query never changed. `loadCarryForwardItems` already ran `select("*")`, so
the values were always present in memory — the loss was purely the hand-written
mapping. That is why the fix is small: nothing had to be fetched, only stopped
from being thrown away.

### Two deliberate type decisions

**`CarryForwardItem` fields are optional; `StagedSnapshotItem` fields are
required.** That asymmetry is the actual repair. Optional on the input keeps
historical fixtures compiling. Required on the output means a future producer
that forgets a column is a **compile error**, not a silently-NULL production
column. When the fields were made required, `tsc` immediately pointed at
exactly two locations — independently confirming the two-producer finding
above.

**`?? null`, never `||`.** `false ?? null` is `false`; `false || null` is
`null`. Here that distinction is load-bearing:

- `null` = nobody has answered, so the receiving dock keeps asking.
- `false` = a human looked and said no, which is what makes the dock go quiet.
- `true` = the limit engages.

Collapsing `false` into `null` would resurrect the nagging that Slice 18E
existed to stop. A mutation for exactly this (`||` in place of `??`) is in the
harness, because it looks like a harmless style change.

---

## "Test everything including the tests"

### The guard was written first, and proven to fail

`tests/compliance/classification-survives-restage.test.ts` was written **before**
the fix and run against the broken code. It failed with exactly eight failures —
four columns × two producers — which is the proof that it detects the defect
rather than merely describing it. After the fix: ten passing.

It is behavioural. It runs the real planner and inspects real values. It does
not search for words, because text matching can prove a word exists and can
never prove a value is right.

### The real deliverable is a class-of-bug guard

The specific bug is a few missing lines. The *class* of bug is a hand-written
field list that silently loses whatever nobody remembered to add — and this
repo has now been bitten by it twice (Slice 62 added the structured facts, this
slice added the limit flags).

So the guard derives its expectations from one declared list,
`ENFORCEMENT_COLUMNS`, and then cross-checks that list against
`src/lib/pos/live-menu.ts`: every `row.<col>` the register actually reads must
be covered. Add a fifth flag to the register and forget this file, and the
suite fails.

### Mutation testing: 32 killed, 0 survived

`scripts/slice18g/mutate.sh` breaks the code on purpose and requires the suite
to notice. It backs up every file it touches, verifies each mutation actually
applied (a mutation that matches nothing tests nothing), and confirms
byte-identical restoration at the end.

Rounds: drop each column from each producer; subtle value corruption that keeps
the column name but ruins the value (hard-coded `null`, `||` for `??`,
defaulting to `false`, crossed wires); the DB read and insert; the recovery
planner; the read-only promise; and finally an attack on the guard's own
contract list.

**The first run found two real problems, and neither was papered over:**

1. **A harness bug.** The 4-space read needle was a substring of the 6-space
   insert line, so two rounds aborted having tested nothing. `assert_changed`
   caught it. Fixed with whole-line matching.

2. **A genuine test gap — a real survivor.** Narrowing the `menu_items`
   `select("*")` survived. `loadCarryForwardItems` issues a *second* query
   (`menu_variants`) that also selects `"*"`, and the guard searched the whole
   function body, so one `select("*")` anywhere satisfied it. This is the same
   insufficient-scoping mistake the file's own header warned about, made one
   level deeper: scoping to the function was not scoping to the *query*.

   The guard was sharpened to scope to the `menu_items` query chain. The mutant
   was not softened.

### A control mutant that must survive

A guard that fails on every edit is not precise, it is noisy, and a noisy guard
gets deleted by the next person who trips it. So the harness includes a mutation
that is *supposed* to survive: narrowing the select while still naming all four
columns. That is a legitimate refactor, and the guard is written to state the
real requirement (the query must return these columns) rather than pinning
today's spelling of it (`select("*")`).

---

## The data that was already destroyed

Fixing the code stops the bleeding. It does not give back what was already
lost.

### Recovery is possible, and that was verified rather than hoped

Nothing in this repo ever deletes a `menu_version` or its `menu_items`; a grep
across `src/` for a delete against either table returns nothing, and versions
only change status. Every superseded version is therefore still in the
database, holding the rows written *before* the lossy re-stage — with the
classification intact.

The answer was never destroyed. It was dropped on the way forward, and it can
be read back out of history.

### The rules the recovery obeys

`src/lib/pos/classification-recovery-core.ts` is pure and writes nothing.

- Only a `NULL` on today's row is a candidate. A live answer is never
  overwritten, even if history disagrees — someone may have reclassified
  deliberately.
- Only a non-null historical value can fill it. The newest wins, because a
  classification is revisable and the latest revision is the standing one.
- It looks *past* a newer null to reach an older real answer, because the lossy
  re-stage wrote nulls into history too.
- `false` and `0` are recovered exactly like any other value. A truthiness
  check here would silently discard a human's "I checked, it is not" — and a
  measured 0 mg is a fact, not an absence.
- Conflicts are reported, never resolved silently.
- Nothing is ever invented. A product nobody classified stays null so the dock
  keeps asking.

### What a real database taught us

The proposed SQL was run against a real PostgreSQL 15 rather than reasoned
about, and **Postgres rejected it**. `menu_items` has paired CHECK constraints:

```
menu_items_otherwise_taken_needs_units
  CHECK (otherwise_taken IS NOT TRUE OR units_per_package IS NOT NULL)

menu_items_low_thc_unit_ceiling
  CHECK (low_thc_liquid IS NOT TRUE OR
         (unit_thc_mg IS NOT NULL AND unit_thc_mg > 0 AND unit_thc_mg <= 4))
```

The original renderer emitted one `UPDATE` per column, which makes the row
briefly illegal and fails partway through the owner's transaction.

The constraints are right, and they encode real statute: an `otherwise_taken`
product with no unit count would let the register treat a box of six as **one**
unit against a ten-unit maximum, under-counting sixfold.

Two changes followed:

1. The SQL now sets all recovered columns for a product in **one statement**,
   so a paired row is never briefly illegal. Verified by executing it: the
   paired `UPDATE` commits where the per-column form errored.
2. A `true` on a gated flag is only proposed if its partner will also be
   present. Where history lost the partner, the recovery is **blocked and
   listed** for a human, not guessed. Half an answer is a fabrication, and the
   database is right to refuse it.

Re-running the SQL is a no-op: every statement carries an `is null` guard on
every column it sets, verified against the live database (`UPDATE 0`, values
unchanged).

### It reports; it never writes

`scripts/slice18g/recover-classifications.ts` prints a report and SQL for
review. It contains no write operation at all, it can prove that about itself
(`--check-readonly`), and the same assertion runs in CI so the promise cannot
quietly lapse. That guard was itself tested by injecting a real `.update()` and
confirming it fails.

This restraint is deliberate. A bulk rewrite of enforcement columns, executed
by a script, at a moment nobody chose, against rows nobody read, is a worse
failure than the blank it repairs — a wrong non-null value fails *silently*,
with no blank left to investigate. Michael applies migrations by hand for
exactly this reason, and this follows the same discipline.

---

## The 18E verifier was pinned, not deleted

`scripts/slice18e/verify-defect3.sh` went red the moment the fix landed — seven
assertions failed, every one of them *because* the fix landed.

Deleting it would have destroyed the evidence that the defect was real, leaving
the writeup resting on nothing but assertion. "Updating" it to match the fixed
tree would have rewritten a factual record of the past into something it never
said.

Instead it now reads its files out of git at the commit whose tree the writeup
describes (`bd5272fa`), so it keeps proving exactly what it always proved, no
matter how far the working tree moves on. A new Link 7 then checks the
*current* tree and asserts the defect is gone. Both halves were tested: Link 7
fails when a column is removed, and the historical links stay green even when
every line number in the working tree is shifted.

Result: 50 passing, 0 failing.

---

## Gates

| gate | result |
| --- | --- |
| full vitest suite | 552 files, 13,999 tests, all passing |
| `tsc --noEmit` | exit 0 |
| `eslint tests scripts/compliance vitest.config.ts` | exit 0 |
| pure self-tests | all passed |
| migrations vs real PostgreSQL 15 | 219 applied in order, 0219 re-applied idempotently |
| mutation testing | 32 killed, 0 survived (+1 control survivor, as designed) |
| `verify-defect3.sh` | 50 / 0 |
| `verify-recon.sh` | 42 / 0 |

`eslint` caught a real violation in the new test file (a `require()` import)
and it was fixed properly rather than suppressed.

---

## What still needs a human

The recovery report lists products it cannot repair. Those are not failures of
the tool; they are the honest boundary of what the surviving data supports:

- **no earlier version at all** — a genuinely new product, classify it at the
  dock.
- **never classified** — the product predates the feature; nobody has answered
  yet.
- **blocked on a missing pair** — history kept the flag but lost the unit count
  or the per-unit THC. Supplying the missing half is a judgement about a real
  product on a real shelf, and it belongs to a person, not a script.
