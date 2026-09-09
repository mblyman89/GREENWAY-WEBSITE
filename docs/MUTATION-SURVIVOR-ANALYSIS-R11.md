# Mutation survivor analysis — rule 11 (receiving intake is the real pipeline)

Harness: `scripts/compliance/mutate-r11.py`. Final score **28/28 killed**, with
**1 proven-equivalent mutant excluded** (documented, never deleted).

The first run scored **23/27 with 4 survivors.** Every survivor is recorded
below with what it turned out to be, because a survivor I explain away is worth
nothing — and two of these were my own defects, not the tests'.

## Run 1 — 23/27, four survivors

### S1 — "core: blank brand rows allowed to match" → PROVEN EQUIVALENT

Mutation: delete `rowKey !== ""` from the squeeze filter.

`resolveBrandDecision` returns `miss` earlier when `!key`. Therefore `key` is
guaranteed non-empty by the time the filter runs, and `rowKey === key` can
never hold for `rowKey === ""`. The guard cannot change the outcome.

Proven, not asserted: a differential probe compared both versions across
**3,888 scenarios that actually reach the filter** — every combination of 16
labels against 18×18 pairs of brand-row names, including `""`, `"   "`, `"--"`,
`"!!"` and `null`. **0 differences.**

The same probe also showed the guard becomes **live in 3 scenarios** the moment
the `!key` early return is removed. So the two guards are **jointly redundant**,
not individually useless. That is why:

- the guard **stays in the code** (it is the backstop if the early return goes),
- this mutation is **excluded from scoring** as equivalent,
- and the mutation that removes the *early return* ("core: punctuation-only
  label allowed to match") **is** scored, and is **killed**.

### S2 — "wiring: intake-store reverts to the bare ILIKE resolver" → REAL GAP

This is the important one. I reverted `resolveBrandId` to the original
one-line `.ilike(...).limit(1)` — i.e. **I put the production bug back** — and
the suite stayed **green**.

Cause: every test asserted on `resolveBrandDecision` (the pure core) or read
`intake-store.ts` as **source text**. Nothing ever **called** the real
`resolveBrandId`. A source-text assertion proves a string is present; it does
not prove the function behaves. Someone could have reverted the fix and CI
would have applauded.

Fix: six **executing** wiring tests. `resolveBrandId` takes the Supabase admin
client as a **parameter**, so it can be run for real against a fake PostgREST
builder that faithfully models the chain actually used — `.select()`,
`.ilike()` (exact, case-insensitive, no wildcards), `.eq()`, `.order()`,
`.range()`, and thenability. The fake also **counts** which paths were taken,
so the tests prove the fast path is used when it should be (`ranged === 0`) and
that the fallback genuinely ran when it must (`ranged > 0`) — rather than
assuming either.

### S3 — "wiring: intake-store drops the brand-resolve-core import" → MY DEFECT

Mutation re-aliased the imports:
`resolveBrandDecision as _rbd` … `const resolveBrandDecision = _rbd`.

That is **behaviourally identical code**. It survived because it *should* have:
there was nothing to detect. A defective mutation, not a hole in the tests.
Replaced with one that genuinely stops delegating — it substitutes a local
`toLowerCase()` comparison for the shared core — and that version is **killed**.

Recorded rather than quietly swapped, because "I wrote a bad mutation" and
"the tests have a hole" look identical in a score line, and only one of them
is a reason to change the tests.

### S4 — "wiring: an INCOMPLETE read is treated as a confident miss" → REAL GAP, and a REAL DESIGN DEFECT

Mutation: delete the `if (!verdict.complete)` branch.

It survived because **the code was wrong in a way the tests could not see.**
Both a failed read and a genuine miss returned `{ kind: "miss" }`. The two are
*not* the same thing:

- **miss** = we looked at every brand, this one does not exist.
- **read failed** = we could not look.

Both wrote `brand_id: null` and were indistinguishable in the log — which is
precisely the silent-drop failure mode this whole slice exists to eliminate. My
mutation could not be killed because there was no observable difference to
assert on.

So I fixed the **code**, not just the test: a distinct
`{ kind: "read-incomplete"; label; reason }` outcome, whose message says
`READ INCOMPLETE …` and explicitly `this is NOT a confirmed miss`, carrying the
`ReadStopReason` through. Then three mutations pin it:

- delete the branch → killed
- downgrade `read-incomplete` to `miss` → killed
- make the message stop denying it is a miss → killed

**A mutant that cannot be killed is sometimes telling you the code is wrong,
not the test.** That was the case here.

## Run 2 — 24/26, two survivors (S3 defect + S4 unfixed). Run 3 and 4 — 28/28.

Mutation count rose from 27 to 28+1-excluded because S4's fix created two new
things worth attacking.

## Verification on the final tree

- `npm run typecheck` → **0 errors** (one real error was found and fixed along
  the way: comparing the two narrowed literal kinds directly is `TS2367`, so
  the runtime distinctness assertion now reads through a widening accessor)
- `npx eslint` on all touched files → **0 problems**
- `npx tsx scripts/compliance/run-pure-selftests.ts` → `brand-resolve-core: 92
  assertions passed`
- `npm run test:compliance` → **606 files / 15,449 tests passed**
- `python3 -u scripts/compliance/mutate-r11.py` → **28/28 killed**
