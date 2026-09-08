# Liquid sales limit + receiving/intake volume recon

Status: **RECON AND STRATEGY ONLY. No production code written.**

Owner decisions locked in this round:
- **72 = FLUID ounces → cap 2129.3 ml.** Consistency preferred.
- **Topicals stay on weighted ounces.** Not moved to volume.
- Unknown-volume policy: owner requested my input first (§6).

---

## 1. Correction carried forward from the first recon

The `72 × 28 = 2016` constant is **not** the bug. For an ounce-labelled liquid
the engine allows `2016 ÷ (q × 28) = 72/q`, and the statutory answer is
`(72 × 29.5735) ÷ (q × 29.5735) = 72/q`. **Identical — the 28 cancels.**

The real defect is that `gramsFromVariantLabel` matches only
`g|gram|grams|oz|ounce|ounces`, so `ml` / `fl oz` / `L` return `null` and fall
back to the 28 g category default → 72 units allowed regardless of true size.
Worst measured case **72× oversell** (`1.5L`), and `10ml` tinctures **under**-sell
at 0.34× (refusing legal sales today).

That analysis stands. What follows is the new work: the **receiving/intake**
pipeline, which is the path that matters going forward.

## 2. Headline: the volume column already exists. Nothing needs a migration.

`supabase/migrations/0138_structured_product_facts.sql`:

```sql
alter table public.inventory_lots add column if not exists net_volume_ml numeric; -- liquid net volume, normalized to ml
alter table public.menu_items    add column if not exists net_volume_ml numeric;
```

So `net_volume_ml` is already on **both** the lot (the golden record) and the
menu item, already normalised to ml, already with a `fact_provenance` companion
column. My earlier plan called for a new migration and a new `volume_ml` column.
**That was wrong and is withdrawn.** Reusing `net_volume_ml` is strictly better:
one name, one unit, already indexed alongside its siblings.

## 3. The extraction layer already reads fl oz and ml — correctly

`src/lib/inventory/fact-extraction-core.ts`:

```ts
sizes: { quantity: number; unit: "g" | "oz" | "floz" | "ml" }[];
const FLOZ_RE = /\b(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|fluid\s*ounces?|floz)\b/gi;
const ML_RE   = /\b(\d+(?:\.\d+)?)\s*(?:ml\b|milliliters?\b)/gi;
```

and the ordering is deliberately correct:

```ts
// 8. package sizes — fl oz before oz before g/ml so "1.7 fl oz" isn't read as oz.
```

This is the good news. Our own intake **can already tell a fluid ounce from a
weight ounce**, which is precisely the distinction the limit engine is missing.

**Gap: no liter support.** `FLOZ_RE`/`ML_RE` have no `l|liter|litre` sibling, so
a `1L` bottle extracts no size at all. Same hole I found in the Cultivera
`parsePackageSize`, present independently in our own extractor.

## 4. Where the volume is thrown away — three named seams

### Seam 1 — `LotFactBundle` has no volume field
`src/lib/pos/intake-mastering-core.ts:116`:

```ts
export type LotFactBundle = {
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  fact_provenance: Record<string, string>;
};
```

Five facts travel from extraction to persistence. `sizes[]` — the fl oz / ml
figures from §3 — is **not among them.** The volume is parsed and then dropped
at the mastering step.

### Seam 2 — the intake→snapshot mapper hardcodes null
`src/lib/pos/intake-menu-staging-core.ts:253-254`, inside `masteredToSnapshot()`:

```ts
net_weight_grams: null,
net_volume_ml: null,
```

**Literal `null`, not `it.net_volume_ml`.** Compare the carry-forward mapper 90
lines below at :339-340, which does it properly:

```ts
net_weight_grams: item.net_weight_grams ?? null,
net_volume_ml: item.net_volume_ml ?? null,
```

So a product **carried forward** keeps its volume, and a product **newly
received** is guaranteed to have none. This is the same class of defect as
"SLICE 18G (DEFECT 3)" documented in the comment immediately beneath these very
lines — a mapper silently dropping a compliance fact that a human had already
supplied. Identical bug, adjacent field, still open.

### Seam 3 — the register never reads it
`src/app/api/pos/menu/route.ts:170` selects
`id, lot_code, pos_product_key, ccrs_inventory_external_id, status, on_hand_qty, product_name`
— no `net_volume_ml`. And line 316 derives the limit fact from the label instead:

```ts
unitGrams: gramsFromVariantLabel(variant.label),
```

Even if seams 1 and 2 were fixed, the register would still be re-deriving grams
from a text label rather than reading the stored ml.

## 5. CCRS can never supply volume — this is the important structural finding

`src/lib/inventory/ccrs-manifest-csv-core.ts`:

```ts
if (uom && !["each", "gram"].includes(uom.toLowerCase())) {
  w.push(`Unrecognized UOM "${uom}" — CCRS accepts only "Each" or "Gram".`);
}
```

The state manifest's only units are **Each** and **Gram**. `WeightPerUnit` is
recorded as `unit_weight_uom: "g"`, unconditionally.

**Consequence:** no manifest, from any vendor, will ever carry a fluid volume.
The state traceability schema has no field for it. So volume can only come from
one of two places: the product **name/description** text (§3, already working
for `ml`/`fl oz`), or a **human at the receiving dock**. There is no third option
and no amount of parser work changes that. This is not a Cultivera problem — it
is true of our own pipeline permanently.

## 6. My input on the unknown-volume question (your question 3)

You asked for my read before deciding. Here it is, and it changes shape given §5.

The receiving dock **already has exactly the right machinery**, built in Slice
16/17 — `src/lib/inventory/receiving-classification-core.ts` has a documented
two-tier design:

```
otherwise_taken is GATED. low_thc_liquid is only PROMPTED.
  otherwise_taken fails PERMISSIVELY — an unanswered suppository is …
  low_thc_liquid fails CONSERVATIVELY — an unanswered beverage stays in the …
```

with `needsOtherwiseTakenPick` (blocking) vs `promptsLowThcLiquid` (advisory),
and the header notes the naming is deliberate "so the difference is visible at
every call site." **There is no volume question at all** — I grepped
`receiving-classification-core.ts`, `intake-checklist-core.ts` and
`intake-review-core.ts` for volume/ml and got zero hits.

**My recommendation: don't put the fail-closed decision at the register. Put it
at receiving, as a third GATED question.**

Reasoning: a hard block at the register punishes a budtender with a customer at
the counter for a data gap created days earlier at the dock, and your existing
override would then get used routinely — which trains people to click through
compliance prompts, the exact habit the Slice 16 header warns about. A gate at
receiving stops the bad data from ever reaching the shelf, and it is asked of the
person who is physically holding the bottle and can read the label.

So, concretely:
- **At receiving:** if the shelf is a liquid category and no `net_volume_ml` was
  extracted, **require** it (gated, like `otherwise_taken`). One number, typed
  once, by someone looking at the package.
- **At the register:** a liquid with unknown volume is treated as **fail-closed**
  — but this should now be an unreachable state for anything received through
  our system. Keep the permission-gated logged override strictly as the
  break-glass path for legacy/migrated rows.

This directly serves what you said — *"products received by our system will have
no doubt what the product is"* — and it means the register enforcement is
protecting against a state that our own intake makes impossible.

**Still your call**, and it is the only open decision left.

## 7. One small precision item

`transform.ts:1115` and `card-cannabinoids.ts:233` use `29.5735`;
`weight-display-core.ts:57` defines `ML_PER_FL_OZ = 29.5735`. The exact value is
`29.5735295625`. Measured difference on the cap:

```
cap via 29.5735      : 2129.2920 ml
cap via 29.5735295625: 2129.2941 ml
delta                : 0.0021 ml  (1.0e-4 % of cap)
```

Immaterial at the cap, but there are now four hand-copied literals of the same
physical constant. I'd fold them into one named export beside
`STATUTORY_GRAMS_PER_OUNCE` in `grams-per-ounce.ts` (or a sibling), so the cap
has exactly one arithmetic basis. Cosmetic, not a correctness fix.

## 8. Revised roadmap

Changed from the first version: **no migration** (§2), **reuse `net_volume_ml`**,
and the fail-closed gate moves to **receiving** rather than the register (§6).

1. **`liquid-volume-core.ts`** (new, pure, self-tested) — `ML_PER_FLUID_OUNCE`,
   `REC_LIQUID_ML = 2129.3` (72 fl oz, your decision), `MED_LIQUID_ML` (216 fl oz),
   and `volumeMlFromLabel()` covering `ml`, `fl oz`, and `l|liter|litre`.
   Returns `null` for unknown — never a silent default.
2. **Close the liter gap** in `fact-extraction-core.ts` (§3) — a liter product
   currently extracts no size. Add the `L` sibling regex with the same
   fl-oz-before-oz precedence discipline.
3. **Seam 1** — add `net_volume_ml` to `LotFactBundle` and populate it from
   `sizes[]` in `intake-mastering-core.ts`, converting `floz → ml`.
4. **Seam 2** — `masteredToSnapshot()`: replace the hardcoded `net_volume_ml: null`
   with the real value, matching the carry-forward mapper 90 lines below.
5. **Seam 3** — add `net_volume_ml` to the `inventory_lots` select in
   `api/pos/menu/route.ts` and carry it onto the register card.
6. **Re-base the limit bucket onto ml** — `LIMIT_BUCKET_UNITS.liquid_edible = "ml"`,
   add `volumeMl?` to `LimitCartLine`, cap `2129.3`. **Topicals keep the ounce
   basis per your decision**, which means `categoryToBucket` needs care: `topical`
   currently routes into `liquid_edible`, so weight-based topicals and volume-based
   drinks would land in one bucket measured in ml. This needs its own explicit
   handling and is the trickiest part of the change.
7. **Receiving volume gate** (§6, pending your confirmation) — third gated
   question in `receiving-classification-core.ts`, following the established
   `needsOtherwiseTakenPick` pattern and provenance discipline.
8. **Plumbing test** in the Slice 16 style — prove the ml fact survives every
   register hop, the website path, and the order snapshot. The engine test alone
   would not catch seams 1, 2 or 3; a plumbing test catches all three.
9. **Retarget, never weaken, existing assertions** — `sales-limits.test.ts:31,37`,
   `low-thc-liquid-limit.test.ts:346,394,398`, `receiving-pipeline-plumbing.test.ts:509`,
   plus the explanatory comments in `otherwise-taken-*.test.ts` and
   `receiving-classification-parity.test.ts` that reason from "2016 g".
10. **Mutation-test** with the §1 oversell table as the oracle.

## 9. Sources

- WAC 314-55-095(1)(d)(i)(E),(F) and (2)(d); RCW 69.50.4013(4)(a)(iii).
- `supabase/migrations/0138_structured_product_facts.sql` — `net_volume_ml` origin.
- `supabase/migrations/0216_low_thc_liquid_limit.sql` — gated-question precedent.
- All line numbers above verified by direct read at commit `18263a3`.
