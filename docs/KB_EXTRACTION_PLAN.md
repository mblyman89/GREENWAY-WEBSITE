# KB Deep-Extraction Plan (Request 3)

Goal: enhance the Knowledge Base seed data + schema from verified public sources.
Expand KB to include validated PRODUCT-TYPE taxonomy (edibles, liquids, concentrates,
topicals, prerolls, etc.) with sort/filter support. Customer-facing FACTS ONLY.

## Standing constraints
- WA I-502: **NO medical/effect/ailment claims.** Sensory (aroma/flavor), botanical
  (lineage/type/breeder), and market-factual (measured cannabinoid ranges, product
  categories) data ONLY.
- Never guess. Every field traced to a verified source row.
- Migrations idempotent, applied MANUALLY by owner.
- Branch + PR + squash-merge. `main` protected.
- Do NOT damage the existing 184 STRAINS_RICH seed entries.

## Sources inspected (verified, /workspace/kb_sources)

| Source | Rows | Usable (customer-facing) | Notes |
|---|---|---|---|
| kushyapp cannabis-dataset (strains CSV) | 9,524 | flavor (971), breeder (5,922), type | terpenes col empty; effects/ailment EXCLUDED; THC values junk (scale 127) |
| kushyapp products CSV | 17,233 | brand, category, strain | product taxonomy reference |
| The_Cannabis_API cannabis.json | 2,351 | Flavor, Type | Effects EXCLUDED; Description prose may hold claims -> skip |
| Terpene-Profile-Parser (merged results.csv) | 43,018 (32,874 w/ terpene) | **real lab terpene profiles**, sample_type | analytical360/sclabs/psilabs; per-terpene measured %; product types |
| Terpene-Profile-Parser active_components.json | 27 terpenes | canonical terpene list + color + boiling point | enrich kb_terpenes |
| grow_data ALL_data.csv | 2,793 | THC/CBD/Sativa/Indica buckets (HTML) | low quality, heavy cleaning; deprioritized |
| OpenTerps (.go) | 0 | none | API scaffold, no seed data |
| dolthub/cannabis-testing-wa `tests` | 215,285 | **leafly_strain, strain_category, inventory_type, thc_max, cbd_max** | **MOST AUTHORITATIVE (WA I-502 state lab data)**; 1,318 distinct strains |

## WA inventory_type -> product category mapping (from dolt `tests`)
Flower Lot; Hydrocarbon Wax; CO2 Hash Oil; Solid Marijuana Infused Edible;
Marijuana Extract for Inhalation; Marijuana Mix; Food Grade Solvent Extract; Kief;
Liquid Marijuana Infused Edible; Marijuana Mix Infused; Hash; Bubble Hash;
Marijuana Infused Topicals; Infused Cooking Oil; Infused Dairy Butter/Fat;
Capsule; Marijuana Mix Packaged; Tincture; Suppository.

## Extraction strategy (verified facts, combined by strain slug)
1. **strain_type** — priority: dolt WA strain_category (state lab) > The_Cannabis_API Type > kushyapp type. Normalize via canonicalStrainType.
2. **terpenes** — aggregate Terpene-Profile-Parser lab rows per strain; keep terpenes present in >= a threshold of that strain's samples; rank by mean %. Verified measured data.
3. **flavor_notes** — union of The_Cannabis_API Flavor + kushyapp flavor (normalized, deduped).
4. **aroma_notes** — derive from dominant terpene -> canonical aroma descriptor map (KB-curated, factual sensory).
5. **lineage** — kushyapp crosses (resolve numeric IDs to names via same CSV) + The_Cannabis_API where available.
6. **origin/breeder** — kushyapp breeder (skip "Unknown Breeder").
7. **cannabinoid range (potency_note)** — dolt avg thc/cbd per strain+category, phrased factually ("Typically tested ~X% THC in WA flower lots"). MEASURED, not a claim.
8. **product categories** — WA inventory_type taxonomy -> new kb_product_categories table + kb_products seed of validated category facts.

## Deliverables
- `NNNN_kb_extraction_enhancements.sql` — idempotent: add kb_strains cols if missing;
  new kb_product_categories table; new kb_products table (validated category facts).
- Regenerated/expanded `STRAINS_RICH` seed (existing 184 preserved + new verified entries).
- New product-category seed + product-type taxonomy lib.
- KB admin UI: sort/filter by strain_type, terpene, product category.
- tsc + build clean; CCRS/DOH untouched.
