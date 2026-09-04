# SLICE 18A — recon before code

Standing rule: never guess, never assume. Every fact below was read from primary
source this session and the file:line is given so anyone can re-check it.

## The owner's ask (verbatim intent)

1. A **worklist** to find unclassified products and fix them.
2. The flags should be **editable on the inventory product detail page**, "like
   how we can edit all the other fields".
3. Cultivera products get classified **via fact review AND** the detail page.
4. Intake-received products get classified via Product Onboarding (18-0, shipped)
   **and** the detail page.
5. Owner's stated belief, to be verified not assumed: *"I'm guessing the work
   list will pertain specifically to Cultivera products, but correct me if I'm
   wrong."*
6. Owner's stated fact: **nothing has been received through intake yet.**

## FINDING 1 — "product detail page" is the LOT detail page

`src/app/admin/inventory/[id]/page.tsx` (929 lines). The `[id]` is a lot id;
it calls `getLotById(id)`. This is the page the owner means, and it already
has an editable "corrections" area with these forms:

| form | action | line |
|---|---|---|
| received date | `updateLotReceivedDateAction` | :254 |
| details | `updateLotDetailsAction` | :469 |
| after-tax price | `updateLotAfterTaxPriceAction` | :666 |
| **website type & category** | **`updateLotWebsiteClassificationAction`** | **:769** |
| adjust qty | `adjustLotAction` | :844 |
| status | `setLotStatusAction` | :868 |

The website-classification form at :769 is the closest existing sibling to what
18A must add, so it is the pattern to mirror rather than invent.

## FINDING 2 — the two doors write to DIFFERENT tables

- **Cultivera door** — `src/lib/pos/fact-review-store.ts`. `FACT_COLUMN`
  (:122-135) maps camelCase fact keys to **`menu_items`** columns, including all
  four flags (`low_thc_liquid`, `unit_thc_mg`, `otherwise_taken`,
  `units_per_package`). `recordFactReview()` mirrors the decision onto the
  STAGED `menu_items` rows for that import (:157-175).
- **Intake door** — `src/lib/inventory/intake-store.ts` writes the flags to
  **`inventory_lots`** (18-0), and `draft-injection.ts` carries them to
  `menu_items` at approval.

Both tables have all four columns: 0216 :95-103 (menu_items + inventory_lots),
0217 :162-170, and 0217 :280-287 (order_lines).

## FINDING 3 (decisive) — `menu_items` is the ONLY enforcement surface

`src/lib/pos/live-menu.ts` :94-100 reads `low_thc_liquid`, `unit_thc_mg`,
`otherwise_taken`, `units_per_package` off the **menu row** and hands them to
the cart engine. Grep for reads of those columns off `inventory_lots` returns
only type declarations and write sites — **nothing reads them back for
enforcement**.

Consequence, and it is the core design constraint of this slice:

> Writing a flag onto `inventory_lots` alone changes NOTHING at the register.
> A "fix" that only updates the lot row would look successful and enforce
> nothing. Any 18A edit MUST reach `menu_items` to be real.

This is the same class of defect as 18-0 itself (a correct rule wired to a
surface that never fires).

## FINDING 4 — the owner's guess needs correcting, with evidence

Cultivera products are NOT confined to `menu_items`. `src/lib/pos/import-service.ts`
:582-624 inserts **`inventory_lots` rows** for every imported lot. So imported
products DO appear on `/admin/inventory` and DO have lot detail pages.

Critically, that insert (:588-616) writes **none of the four flags** — grep for
them in `import-service.ts` returns nothing. So every Cultivera lot currently
carries NULL flags on `inventory_lots`.

Therefore:
- The worklist is not "Cultivera-only" by nature. It is "unclassified-product"
  by nature, and today that set happens to be 100% Cultivera **only because
  nothing has come through intake yet** (owner-stated).
- Building it Cultivera-only would hard-code a temporary condition. The first
  received suppository that someone skips would be invisible.
- Building it source-agnostic costs nothing extra and is correct on day one and
  after the first manifest.

**Recommendation: build the worklist source-agnostic, and SHOW the source per
row** so the owner still gets the Cultivera view he asked for (by filtering),
without the list lying by omission later.

## FINDING 5 — there is already a worklist system to extend (do not bolt on)

`src/lib/inventory/lot-gap-core.ts` (SLICE 7). One definition per gap, each
carrying:
- `matches(row)` — the in-memory predicate the COUNTER uses
- `sqlPredicate` — the shape the store must apply
- `param` / `href` — the deep link into `/admin/inventory`

`LOT_GAP_DEFINITIONS` (:127) currently has four: `missingProductLink`,
`emptyActive`, `missingExpiry`, `unknownCost`. `countLotGaps()` (:187) is called
by `computeInventoryStats()`, and `/admin/inventory` renders a "What's missing"
panel with a **Fix →** deep link per gap (page.tsx :136).

The file's own header records WHY it exists: SLICE 6A shipped a Fix button whose
filtered list did not match the count beside it, because the count and the
filter were two hand-written predicates free to drift. An equivalence test now
pins them together.

**This is the natural home for the unclassified worklist** — same panel, same
deep-link grammar, same drift-proof structure the owner already knows. That is
"integrates naturally", not "bolted on".

### The obstacle this creates (and why it must be solved, not dodged)

`LotGapRow` (:30-37) is a subset of an **`inventory_lots`** row. The gap engine
is lot-shaped. But per FINDING 3 the truth that matters lives on `menu_items`,
and per FINDING 4 Cultivera lots have NULL flags on `inventory_lots`.

So a naive gap of `otherwise_taken IS NULL` over `inventory_lots` would flag
**every Cultivera lot, including ones already classified in fact review** —
because fact review never writes to `inventory_lots`. That is precisely the
"nag about settled work" failure 18-0 fixed at the receiving dock, reintroduced
at a bigger scale.

## FINDING 6 — the write-through precedent already exists

`src/lib/inventory/price-write-store.ts` solves the exact same shape of problem
for PRICE: the owner edits on the lot detail page, and the change is written
through to `menu_items` / `menu_variants` on the published version plus any
staged versions (:259-313).

Key fact it documents and relies on (:70-77): a lot's `pos_product_key`
**always** equals its card's `menu_items.source_item_id`, for BOTH import lots
(`transform.ts` :1179 vs :982) and intake lots. That is the join 18A needs.

It also models the honesty requirements:
- refuse rather than guess when a card has multiple variants (`ambiguous`)
- return a plain-English error when the product isn't on the menu yet
- never throw into the pipeline; return `{ ok:false, error }`

## FINDING 7 — the per-product override table is the right storage

`src/lib/pos/product-classification-overrides.ts` (migration 0150), keyed by
`pos_product_key`, is the existing "the owner corrected this product" store. It
is a read-time overlay, degrades silently pre-migration, and never touches
CCRS/LCB columns.

`updateLotWebsiteClassificationAction` (actions.ts :272-449) shows the full
existing ritual: permission check → live registry load → pure parse → audit →
`upsertOverride` → `revalidatePath` on `/admin/inventory/[id]`, `/admin/inventory`
and `/menu`.

## DESIGN CONCLUSIONS (what 18A should therefore build)

1. **Source-agnostic worklist**, expressed as new `LOT_GAP_DEFINITIONS` entries
   so the count, the filter and the Fix link cannot drift (FINDING 5).
2. The worklist's truth must come from the **menu** flags joined by
   `pos_product_key`, not from `inventory_lots` (FINDINGS 3 + 4), otherwise it
   nags about products fact review already settled.
3. Scope the worklist to products where the answer can change a legal outcome —
   the same targeted rule 18-0 established (`categoryToBucket` → `liquid_edible`
   plus name suspects). A worklist listing all 3,800 lots is not a worklist.
4. **Detail-page editor** mirroring the website-classification form, writing
   through to `menu_items` like `price-write-store` does, with the same refusal
   honesty.
5. Reuse `receiving-classification-core.ts` (18-0) for the validation rules so
   the two doors cannot disagree — the parity property 18-0 already tests.

## Open question for the owner (do not guess)

Whether the detail-page edit should also write the flags back onto
`inventory_lots` for that lot. It is not needed for enforcement (FINDING 3), but
it keeps the lot row honest for CCRS-style reporting and for the receiving
dock's warning. Default plan: write BOTH (menu for enforcement, lot for
provenance), since 18-0 already established the lot column as the provenance
record.

---

## BUILD ADDENDUM — where the plan changed, and why

Recon is a hypothesis. Two of the conclusions above did not survive contact with
the code, and both corrections are recorded here rather than quietly applied.

### CORRECTION 1 — the worklist is NOT a `LOT_GAP_DEFINITION`

Conclusion 1 proposed expressing the worklist as new entries in
`LOT_GAP_DEFINITIONS` (lot-gap-core.ts:127). That is structurally impossible,
and the reason is exactly what makes the gap engine valuable.

Every gap definition carries BOTH an in-memory `matches(row)` predicate and a
`sqlPredicate` the store applies to `inventory_lots`, and an equivalence test
proves they select the same rows. That pairing is the whole anti-drift device.

But classification truth lives on `menu_items`, joined by `pos_product_key`
(FINDING 3). There is no `inventory_lots` predicate that can express "this
product's published menu row has a null `otherwise_taken`". Forcing one would
mean filtering on the lot columns — which is precisely the defect FINDING 4
identified, since the Cultivera importer never writes them.

So the anti-drift PRINCIPLE was kept and the mechanism was rebuilt for a
different join: `classification-worklist-core.ts` owns exactly one definition of
scope, status, ordering, filtering and href, and the page is forbidden from
re-deriving any of them. `tests/compliance/classification-worklist-plumbing.test.ts`
("hop 6") pins that, and it has already caught one real regression — an early
draft of the page hand-rolled `reasons.length === 0` as a second definition of
"settled".

### CORRECTION 2 — the unit of work is a PRODUCT, not a lot

Not anticipated during recon. The four flags live on ONE menu row per product,
while inventory holds one row per lot, so a product restocked eight times would
have printed the same unanswered question eight times. Answering it once would
clear all eight, which reads as a broken list.

`buildClassificationWorklist()` therefore groups by `pos_product_key` and
reports the lot count alongside. This is also why the worklist lives under
`/admin/compliance` rather than as a filter on the lot-per-row inventory list.

### RESOLVED — the open question above

The owner's brief answered it: *"Received products via intake will be able to be
edited in the product detail page."* The action writes BOTH, in a deliberate
order — the **menu write first** (enforcement; failure aborts and reports), then
the **lot write as best-effort provenance** (failure is captured, not fatal).
Reversing that order would let the lot row claim an answer the register never
received.

### The brief's one factual correction

The brief expected the worklist to be Cultivera-specific. It is source-agnostic,
with a Cultivera *filter*. Grounds: (a) the importer DOES create `inventory_lots`
rows, so imported products are not a distinguishable species; (b) the population
is 100% Cultivera only because nothing has been received yet — a fact about this
week, not about the system. Hard-coding it would make the first received
suppository invisible to the list built to catch it.

The one durable discriminator, used ONLY to power the optional source tab, is
the `POS-IMPORT-` manifest-number prefix stamped by import-service.ts:519.

### Verification performed

- 120 self-test assertions in the worklist core, 64 in the status core
- 30 plumbing tests, 9 parity tests against the 18-0 receiving gate
- **19/19 mutants killed** (`scripts/slice18a/mutate.py`), after mutation
  testing exposed 3 assertions that were passing for the wrong reason:
  a sort tie-break whose fixture let the id tiebreaker fake the name sort, a
  representative-lot fixture with the same defect, and a summary assertion made
  vacuous by a downstream second filter. All three were STRENGTHENED.
- Full suite 542 files / 13,786 tests, `tsc` exit 0, eslint clean, all pure
  self-tests passed.
- **No migration.** 18A reuses the columns 0216/0217 already added.
