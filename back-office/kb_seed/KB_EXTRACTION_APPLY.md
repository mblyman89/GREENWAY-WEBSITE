# KB Deep-Extraction — apply guide (owner)

This slice expands the Knowledge Base from verified public sources and adds a
customer-facing PRODUCT-TYPE taxonomy. Everything is **sensory / botanical /
market-factual only** — no medical or effect claims (WA I-502).

## What changed
- **Strains:** `STRAINS_RICH` seed grew from **184 → 2,370** entries. The original
  184 curated entries are **unchanged**; 2,186 verified strains were appended
  (appended only when the name + normalized name were not already present, so the
  curated higher-confidence rows always win).
- **New product-category taxonomy:** 24 validated product types (Flower, Pre-Rolls,
  Wax, Shatter, Live Resin, Rosin, CO2 Oil, Distillate, Kief, Hash, Bubble Hash,
  Vape Cartridges, Disposable Vapes, Gummies, Chocolates, Candy, Baked Goods,
  Beverages, Capsules, Tinctures, Cooking Oils, Topicals, Bath & Body,
  Suppositories) across 6 groups, each mapped to the WA CCRS `inventory_type`
  names it corresponds to.
- **KB admin UI:** strain manage-list now has type filter + terpene filter + sort;
  a new **Product types** section browses the taxonomy with group filter + sort.

## Sources (verified, combined — never guessed)
1. **dolthub/cannabis-testing-wa** (215,285 WA I-502 state lab tests) — strain type,
   measured THC/CBD ranges, WA inventory-type product categories. *Most
   authoritative WA source.*
2. **Terpene-Profile-Parser-for-Cannabis-Strains** (43k multi-lab assays;
   analytical360 / sclabs / psilabs) — measured terpene dominance per strain.
   Values were normalized per-column to remove a source scale artifact before
   ranking; a terpene is only asserted when measured in ≥5 samples with a
   meaningful average share.
3. **The_Cannabis_API** (Piyush-Bhor) — flavor + type.
4. **Kushy cannabis-dataset** — flavor, breeder (origin), lineage (crosses
   resolved by ID→name), retail product categories.
- Effects/ailment columns from these sources were **never** imported (WA I-502).

## Apply order (MANUAL — run in Supabase SQL editor)
1. Migration: `supabase/migrations/0070_kb_product_categories.sql`
   *(Note: this repo also has an open PR #222 introducing `0069`. If you have
   NOT yet applied 0069, apply it first so numbering stays sequential; 0070 has
   no dependency on 0069 and is independent/idempotent.)*
2. Strain seed: `back-office/kb_seed/strains_seed.sql` (idempotent upsert on slug;
   re-run AFTER migrations 0019 + 0020). This upserts all 2,370 strains.
3. Product categories seed: `back-office/kb_seed/product_categories_seed.sql`
   (idempotent upsert on slug; run AFTER 0070).

All three are idempotent — safe to re-run.

## Regenerating the seed (if sources change)
The TS/SQL/CSV artifacts are generated, not hand-edited:
```
cd back-office/kb_seed
python3 build_strains.py             # -> strains-data.ts, strains_seed.sql, strains_seed.csv
python3 build_product_categories.py  # -> product-categories-data.ts, product_categories_seed.sql
```
`strains_extracted.py` (the appended verified set) is produced by
`build_extracted.py` from the raw source datasets under a scratch workspace; the
committed `strains_extracted.py` captures that verified output.

## Compliance note
CCRS/DOH export paths are untouched. The taxonomy stores the WA inventory-type
names purely as a reference mapping for customer-facing copy; it does not feed
state reporting.
