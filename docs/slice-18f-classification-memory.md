# SLICE 18F — CATALOG DEFAULTS: THE CLASSIFICATION MEMORY

Owner instruction for this round, verbatim:

> *"Please proceed with 18F now. Let's go with option b, pre fill + remembered
> provenance. Follow the standing rules and never guess, never assume. Go above
> and beyond for me as you have been doing, it's working very well. Test
> everything including the tests."*

Standing rule, in force: **do not guess, do not assume. we build from fact, not
memory.** Every claim below was read out of the tree or produced by running
something. Where a design choice was made, the fact that forced it is cited.

Recon that preceded this build: `docs/slice-18f-recon.md`.

---

## 1. THE DEFECT, STATED PRECISELY

SLICE 18-0 installed a targeted gate at draft approval: for the product
categories where WAC 314-55-095(1)(d)(i)(D) can bite, the approver must answer
*"is this taken into the body another way?"* before the draft can be approved.
The gate is deliberately fail-loud, and `required` on the picker is the whole
point of it.

The gate has no memory. It asks per DRAFT, and a draft is created per delivery.
So Michael answers the same question about the same Fairwinds suppository every
time a new manifest lands. The answer he gave in August is sitting in the
database and is never shown to him in September.

**But not for every product, and the difference is load-bearing.**
`src/lib/inventory/intake-parser.ts:414` reads, verbatim:

```ts
pos_product_key: sku ?? lot_code,
```

When a WCIA/CCRS manifest carries a SKU, the product key is stable across
deliveries, `planDraftSeeding()` marks the row `"match"`
(`src/lib/pos/draft-seed-core.ts:93`), and no re-ask occurs. When the manifest
carries **no SKU**, the key falls back to the **lot code** — which is unique per
delivery. A new key means a new product means a new draft means the 18-0 gate
fires again.

That narrows the defect to *non-SKU'd products*, and it also **kills the obvious
design**: a memory keyed on `pos_product_key` would be keyed on the very value
that changes. It would never match, and it would fail silently — the worst
failure mode available, because it looks exactly like "this product is new".

## 2. WHAT WAS BUILT — OPTION B, AS RATIFIED

Three options were put to the owner. He chose **B**:

- **A** — show the prior answer as a read-only hint. Saves nothing; the operator
  still types it.
- **B** — **pre-fill the answer, keep `required`, and record that the value came
  from memory.** *(chosen)*
- **C** — auto-apply the prior answer without asking. Rejected: it converts a
  statutory gate into a silent default, which is the thing 18-0 exists to stop.

Option B's contract, in one line: **the memory saves the typing, never the
decision.** The picker arrives pre-filled, and it is still `required`, so the
form cannot be submitted without a human having looked at it.

`MemoryPrefill.stillRequiresConfirmation` is typed as the literal `true` — not
`boolean`. Downgrading Option B to Option C is therefore a **compile error**,
not merely a test failure. That is deliberate: the type system is the cheapest
place to make a policy irreversible.

### The identity key

Because `pos_product_key` cannot be trusted, the memory keys on **identity**:

```ts
[collapseFamilyKeyPart(vendor), categoryPart, familyPart].join("|")
```

built with the vocabulary the repo already had — `familyFromName()`,
`collapseFamilyKeyPart()`, `groupingCategoryAxis()` from
`intake-mastering-core.ts`. No new identity notion was invented, because two
competing notions of "the same product" is a defect generator.

One real bug was found here **by a test, in my own code**, and fixed in the
SOURCE rather than the test: `groupingCategoryAxis()` returns
`PACK_CATEGORY_AXIS[category] ?? category`, so an *unrecognised* category passes
through **with its original case preserved**. Dock-entered `"Topical"` and
`"topical"` would have produced two different keys — the memory would simply
never match, silently. The axis is now collapsed like every other key part.

The key refuses to be built at all in two cases: no product name, and a name
that *collapses* to nothing (`"---"`). A blank key would be shared by every
other blank-keyed product, handing one product's compliance answer to an
unrelated one.

### Which prior answers may be replayed

```ts
const RECALLABLE_PROVENANCE = [human, remembered];
```

`machine_default` and `unanswered` are **deliberately absent**, and that absence
is the safety property. A machine default is the gate not having been asked;
replaying it to an operator as a pre-filled answer would launder a guess into
something that looks like a decision.

A literal `false` is recallable and must stay so. A human answering *"no, this
is not a suppository"* has answered. Coalescing that away with `||` would
re-ask forever — which is why every mapper on this path uses `?? null`, and why
the suite has a mutant that swaps each one.

### The fourth provenance value

`remembered` joins the 18-0 three by **spreading** them:

```ts
export const CLASSIFICATION_MEMORY_PROVENANCE = {
  ...RECEIVING_CLASSIFICATION_PROVENANCE,
  remembered: "remembered",
} as const;
```

One vocabulary, not two kept in sync by hand. The three existing values are not
redefined — rows already written depend on their meanings — and a test asserts
the core never redeclares them.

It is recorded **server-side and only when earned**. At approval the server
re-runs the recall and marks `remembered` **only if** a memory existed *and* the
human's submitted answer **matches** it. If they changed the answer, that is a
fresh human decision about a product whose formulation may genuinely have
changed, and crediting it to a prior decision that disagreed would be a false
audit trail. The form cannot claim `remembered`; nothing is read from it.

### Why approved drafts, not `menu_items`

`listPriorClassifications()` reads `catalog_product_drafts` where
`status = "approved"`. `menu_items` would be the more natural-sounding source
and is the wrong one: it has **no classification provenance column**. Verified —
migration 0138 added `fact_provenance` for *dose* facts only; 0216, 0217 and
0219 added none. Without provenance we cannot tell a human's answer from a
machine's default, and the whole safety property above collapses. Drafts are the
only honest source.

## 3. NO MIGRATION REQUIRED

`chosen_classification_provenance` is `jsonb` (0218) with **no CHECK
constraint**, so a fourth value needs no DDL. The vocabulary is code-owned.

One honest caveat, recorded rather than hidden: **0218's column COMMENT
enumerates the three original values and is now incomplete.** No data or
behaviour depends on it. Following the 0219 precedent, a doc-only migration to
refresh that comment is a reasonable follow-up; it is deliberately not bundled
here, because Michael applies migrations by hand and a migration that changes
nothing executable is not worth a manual step in the same round as a behaviour
change. Flagged for his call.

## 4. TESTING, INCLUDING THE TESTS

### Suites

| Suite | Tests | What it proves |
|---|---|---|
| `tests/compliance/classification-memory.test.ts` | 30 | the pure core, behaviourally |
| `tests/compliance/classification-memory-plumbing.test.ts` | 22 | the layers pure tests cannot reach |
| `__runClassificationMemoryTests()` | 17 assertions | runs in CI outside vitest |

The pure suite was written **test-first** and confirmed failing for the right
reason (module not found) before the core existed.

The plumbing suite exists because of SLICE 18E Defect 3, which was correct
policy that two DB-boundary mappers dropped on the floor. A pure core nobody
calls, or calls wrongly, fixes nothing.

### Testing the tests

Six of the plumbing tests test **the test harness itself**. This is not
ceremony — the harness lied during this very slice. `bodyAfter()` returned the
inline *parameter type* of `approveDraftWithPrice` instead of its body, turning
four real, passing behaviours into four red failures; the fix then exposed a
second layer, the return-type generic `Promise<{ ok: boolean; ... }>`. A
source-reading harness that scopes to the wrong region fails in **both**
directions, and the silent direction is passing vacuously. So the extractor is
now pinned against both signature shapes, required to throw when a signature
moves, and proven non-vacuous (it extracts exactly lines 599–937, with all four
needles present and zero bleed into neighbouring functions).

### Mutation testing — `scripts/slice18f/mutate.sh`

Seven rounds plus a control. Final run:

```
 KILLED:    17
 SURVIVED:  0
 UNAPPLIED: 0
 Control (comment-only change): SURVIVED  <-- CORRECT
 Byte-for-byte restoration: clean on all three sources
```

The control mutant earns its place: it changes only a comment and **must**
survive. Had it been killed, the suite would be pinned to prose rather than
behaviour and every "KILLED" above it would be suspect.

**The first run found two genuine test gaps, and both were fixed by
strengthening the suite — never by softening the mutant:**

1. **`unanswered` was recallable and nothing noticed.** There *was* a test for
   it, and it passed for the wrong reason: it supplied `otherwiseTaken: null`,
   so the row was rejected at the *value* check and the provenance gate was
   never reached. The test now supplies a deliberately contradictory row —
   provenance says nobody answered, yet a value is present — so the **only**
   thing that can reject it is the provenance gate. A second test proves a
   non-answer cannot win on recency over a real one.

2. **The second key refusal was untested.** `classificationMemoryKey()` has two
   refusals; the existing test only exercised `name === ""`. A name of `"---"`
   passes that and is stopped only by `familyPart === ""`. Rather than assume
   which inputs reach it, I ran a probe: `"---"` and `" -- .. "` reach the
   second guard; `"6pk"` and `"100"` legitimately do not. The new tests use the
   verified inputs and add the end-to-end consequence — a junk-named product is
   never handed another product's answer.

A third survivor turned out to be a **badly-targeted mutant, not a test gap**,
and is documented here because the distinction matters. The mutant searched
forward from `defaultValue=` for the next `required`, but in the real source
`required` is declared *before* `defaultValue` — so it deleted the word
"required" out of a comment thirty lines below (`PROMPTED, never required`) and
survived for reasons unrelated to the guard. Both sides were fixed: the mutant
now scopes to the control's opening tag and asserts the deletion landed there,
and the test was tightened from a 600-character window (which could spill into a
neighbouring control, or be satisfied by prose) to the element's opening tag on
executable lines only.

An existing 18-0 guard also went red, correctly:
`receiving-pipeline-plumbing.test.ts` asserted the literal
`update.chosen_classification_provenance = compliance.provenance`. The
invariant it defends is untouched, but the spelling changed. It was rewritten
**stricter, not looser** — now pinning (a) that provenance is still *seeded*
from the server-derived assessment, and (b) that the write is still
*unconditional*, asserted via top-level indentation rather than a character
window that produced a false alarm on first attempt.

### Gates

```
tsc --noEmit ......................... 0 errors
eslint ............................... 0 errors (3 pre-existing warnings, unrelated files)
vitest run ........................... 554 files / 14051 tests, all passing
run-pure-selftests.ts ................ ALL PURE SELF-TESTS PASSED
next build ........................... compiles; TS phase OOMs in the SANDBOX only
```

Baseline before this slice was 552 files / 13,999 tests.

On `next build`, stated honestly rather than glossed: it reports
`✓ Compiled successfully in ~60s` and is then killed during `Running
TypeScript ...` with `signal: SIGKILL`. That is not a compile failure and not a
type error. It was traced to fact rather than assumed benign:

- `dmesg` shows a real kernel OOM kill — `Out of memory: Killed process (node)`,
  `anon-rss:2825040kB` — in a sandbox with 3.9 GB total and no swap;
- the **identical failure reproduces on the pre-18F tree**. I stashed all 18F
  work, ran the same command on the clean checkout, and got the same
  `SIGKILL` at the same phase. So 18F did not introduce it;
- the CI `build` job (`.github/workflows/compliance-tests.yml:186`) runs with
  `NODE_OPTIONS=--max-old-space-size=6144` on a 16 GB GitHub runner, with a
  comment already anticipating exactly this: *"an OOM here would be a false red
  that teaches everyone to ignore the job."*

The type safety of this slice is therefore established by `tsc --noEmit -p
tsconfig.json` passing with **0 errors** — the same checker `next build` runs —
and the build gate is confirmed on CI hardware rather than claimed locally.

`tsc` earned its keep twice: it rejected comparing two members of a `const`-
asserted object (no overlap — the assertion already proves distinctness, so the
check was replaced with a stronger runtime one), and it caught that
`vendor_name` / `brand_name` were absent from the `approveDraftWithPrice` row
type before that reached a test.

## 5. FILES

| File | Change |
|---|---|
| `src/lib/inventory/classification-memory-core.ts` | **new** — pure core |
| `src/lib/inventory/catalog-drafts.ts` | `listPriorClassifications()`; server-side provenance re-derivation at approval |
| `src/app/admin/inventory/drafts/page.tsx` | batched recall; pre-filled picker; "remembered" label |
| `scripts/compliance/run-pure-selftests.ts` | registers the new self-test |
| `tests/compliance/classification-memory.test.ts` | **new** — 30 tests |
| `tests/compliance/classification-memory-plumbing.test.ts` | **new** — 22 tests |
| `tests/compliance/receiving-pipeline-plumbing.test.ts` | 18-0 guard rewritten stricter |
| `scripts/slice18f/mutate.sh` | **new** — mutation harness |
| `docs/slice-18f-recon.md` | **new** — recon |

`todo.md` verified untouched at 3,577 lines.

## 6. WHAT THIS DOES NOT DO

Stated plainly so nothing is assumed:

- It does not answer the question for anyone. `required` stays.
- It does not remember across a **category change**. If a product moves to a
  different category axis, the key changes and the question is asked again —
  which is correct, because the category is what makes the question apply.
- It does not touch the **bulk classify** path. That half of the 18F scope line
  was already delivered by SLICE 6A and is wired for real; rebuilding it would
  have created a second competing bulk path over `pos_fact_reviews`. See
  `docs/slice-18f-recon.md` §0.
- It does not backfill anything. Existing approved drafts become the memory
  simply by being read.
