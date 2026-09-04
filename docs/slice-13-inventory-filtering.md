# Slice 13 — inventory filtering, sorting and smart search

Technical record. The owner-facing version is
`docs/MICHAEL-slice13-inventory-filtering.md`; the pre-work reconnaissance,
with the original file and line citations, is
`docs/slice-13-inventory-filtering-recon.md`.

## The defect

`src/lib/inventory/store.ts`, in `listLotsPaged`, built the free-text predicate
as a single `ilikeContains(opts.q)` across exactly three columns —
`product_name`, `lot_code` and `pos_product_key`. That one expression carried
three separate defects. It required the query to appear as one contiguous
phrase, so multi-word queries failed unless the words were adjacent and in
order. It covered three of the twelve fields an operator would reasonably search.
And it had no typo tolerance, so a single mistyped character produced an empty
table.

Underneath that sat a structural blocker. `hydrateLots` resolved `vendor_name`,
`brand_name` and the lab result **after** the page had already been selected in
SQL. Those fields therefore did not exist at the moment the database decided
which rows to return, which is why filtering or sorting by vendor, brand, THC or
CBD was not merely missing but impossible in that shape.

## The shape of the fix

The page now loads the whole lot set and does the work in pure TypeScript:
filter, then search, then sort, then paginate. That is a deliberate trade and it
was justified before it was taken, not after — the page already walked every lot
twice on every request, in `computeInventoryStats()` and
`getInventoryCommandCenter()`, so whole-set traversal was the existing cost
profile rather than a new one. `listAllLotsForFiltering()` was added to
`store.ts` using `pagedAll` with an explicit `.order("id", { ascending: true })`
(without a stable order, pages can overlap or skip rows), and a private
`hydrateLotsChunked()` resolves vendors, brands and lab results through
`chunkedIn` so a four-thousand-lot store cannot overflow the PostgREST query
string.

Six pure modules were added under `src/lib/inventory/`:

| Module | Responsibility | Embedded assertions |
|---|---|---|
| `inventory-search-core.ts` | tokenising, match ladder, two-tier search | 65 |
| `inventory-filter-core.ts` | facets, tri-states, ranges, URL parsing | 108 |
| `inventory-sort-core.ts` | 17 column definitions, 3-state cycle, comparators | 52 |
| `inventory-list-core.ts` | field weights, the filter→search→sort→page pipeline | 22 |
| `inventory-url-core.ts` | the URL contract, hrefs, chips | 131 |
| `inventory-page-core.ts` | legacy knob compatibility, facet sourcing | 68 |

`src/lib/ai/kb/strain-matcher.ts` was an inherited dependency with no tests at
all. Because the new search rests on its metrics, it was brought under test
(67 assertions) as part of this slice.

## Decisions that were measured rather than assumed

**The fuzzy threshold, and why the search is two-tier.** The first draft picked
0.78 by intuition. `scripts/slice13/probe-threshold.ts` measured the actual
similarity scores and found `dreem`≈`dream` and `resin`≈`rosin` both at exactly
**0.6500**. The typo we must forgive and the product confusion we must never
make are numerically identical, so no single threshold separates them. The
design changed in response: a strict pass with fuzzy matching disabled runs
first, and the forgiving pass runs only when the strict pass returns nothing,
flagged with `didYouMean`. The threshold was then set to 0.58 on measured data.

**`normalizeStrainQuery` was deliberately not reused.** It is destructive — it
strips weights, pack sizes, percentages and fifty form words — so `gummies`,
`400mg` and `10 pack` would have normalised toward nothing. Reusing it would
have reproduced the owner's bug in a new location. Only the content-agnostic
metrics (`diceCoefficient`, `levenshteinRatio`) are borrowed. A test pins this,
reading the source with comments stripped so that the comment *explaining* the
decision does not itself satisfy or violate the pin.

**Facet options come from the unfiltered set.** Options are computed from
`facetSource` — after the legacy knobs, before the Slice 13 filters — so
selecting vendor A does not remove vendor B from the list and strand the user.
Values are keyed on the displayed label.

**Doctrine carried forward.** `NULL` means unknown, never "no": `matchesTriState`
returns `false` for both "yes" and "no" when the value is null, and exposes
"unknown" as an explicit third choice. Unknown numeric values are excluded from
ranges rather than coerced to zero. Unknown values sink in both sort directions
rather than flipping ends. Garbage URL parameters mean "filter off" and never
raise.

## Defects found *during* the slice

**`parseMultiParam` split facet values on commas.** This was a defect in the new
code, found before merge. Real seed data contains `Grow Op Farms, LLC`,
`Free Rain Farms, Inc.` and `Legacy Organics, LLC`. A probe confirmed
`parseMultiParam({ fVendor: "Grow Op Farms, LLC" })` yielded
`["Grow Op Farms", "LLC"]` and that `lotMatchesFilters` then returned `false`
for the lot's own vendor — recreating the owner's exact complaint inside its own
fix. Rewritten to use repeated URL keys and never a delimiter, with regression
tests in four places using the real names.

**`filterParams()` was a hand-written whitelist.** It would have silently
dropped every new filter from pager, status-tab and bulk-action links. Replaced
with `paramsFrom(sp as RawParams)`, with only `page` managed per link.

**A stale string pin in `slice7-lot-enrichment-worklists.test.ts`.** The
refactor moved gap wiring into the pure core and broke
`expect(src).toContain("gaps: activeGaps")`. Rather than relocate the string,
it was replaced with two behavioural tests proving each gap knob selects exactly
what `def.matches` counts. A string pin can be satisfied by a comment;
behaviour cannot.

**A guessed assertion.** `tokenAlignment(...) > 0.85` was written from
expectation and failed. The real value is **0.825** (dice 0.5 and levenshtein
0.8 give a per-word blend of 0.65; `(1.0 + 0.65) / 2 = 0.825`). Pinned with the
arithmetic documented rather than softened.

## Mutation testing

`scripts/slice13/mutate.sh` applies 28 mutants from
`scripts/slice13/mutants.json`, each a behavioural change the tests should
catch, and runs the Slice 13 suites plus the pure self-test sweep against each.

The runner carries three integrity guards, because a mutation score is easy to
fake accidentally. A mutant whose `find` string does not match exactly once is
reported as **NOT APPLIED** and fails the run, rather than being silently scored
as "killed". A mutant *declared* equivalent that turns out to be killed is
flagged as a **stale proof**, since that means the code moved underneath the
argument. And the script verifies via `git diff` that the working tree was
restored clean, so a crashed run cannot leave a mutant behind to poison the next
one. The second guard fired for real: adding a comment to `scoreTokenInField`
invalidated one mutant's anchor, and the run refused to score it.

Final result: **27 killed, 1 proven-equivalent, 0 survived, 0 invalid.**

### The survivor, and what it uncovered

Disabling the plain substring rung —
`if (fieldText.includes(token)) return "substring";` — left every test passing.
That is either a test gap on the owner's headline requirement or an equivalent
mutant, and the difference is not something to reason about loosely.

`scripts/slice13/probe-substring-subsumption.ts` brute-forced every
`(field, token)` pair over the alphabet `{a, b, space}` up to lengths 5 and 4 —
44,044 pairs. There were 804 disagreements, and **every one of them had a
whitespace-only token**; zero disagreements involved a token carrying a real
character. The glue-free check immediately below subsumes the plain check,
because squashing spaces out of both sides can only make a match easier. The
line is retained for clarity and to avoid two string allocations on the hot
path, but it is not load-bearing, and the proof is recorded both in
`mutants.json` and at the code site.

The equivalence holds only if a whitespace-only token can never reach the
function, which is a claim about callers.
`scripts/slice13/probe-token-whitespace.ts` measured it across 26 hostile inputs
(tabs, newlines, non-breaking and ideographic spaces, punctuation runs) and
found `searchTokens` emits no blank token.

That probe also exposed a genuine latent defect. The guard read
`if (!token || !fieldText) return null;` — falsy-only, so `""` was refused but
`" "` was not, and `scoreTokenInField(" ", "blue dream")` returned
`"substring"`. A single space is a substring of nearly every product name, so a
blank token would have matched the entire shelf. Unreachable through the current
UI, but the function is exported and the next caller has not been written.
Fixed to `!token.trim()` and pinned by 11 new assertions in the core and 2
vitest tests, including one asserting the tokenizer never emits a blank — the
precondition on which the equivalence argument depends.

## Verification

- Full suite: **557 files, 14,178 tests**, all passing (baseline before this
  slice: 556 files, 14,096 tests).
- Pure self-test sweep: all cores green, 513 assertions across the seven new or
  newly-tested modules.
- `tsc --noEmit`: clean.
- `eslint` on all touched files: 0 errors, 0 warnings.
- `todo.md` verified untouched at 3,577 lines.
