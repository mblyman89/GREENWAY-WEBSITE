# Strain Data Sources — leaning type + sativa/indica ratio (SAVE — do not lose)

Owner-provided, verified source list for building the **strain type + percentage/ratio**
(e.g. "70/30 sativa hybrid" = 70% sativa, 30% indica) that powers the leaning-hybrid
designations (`indica-hybrid` / `sativa-hybrid`) across the website + back office.

> Standing rule: capture verbatim, never lose. The owner searched "way back" to
> recover these and does not want them lost again.

## GitHub repositories
- Kushy cannabis dataset: https://github.com/kushyapp/cannabis-dataset
- The Cannabis API (v2 branch): https://github.com/Piyush-Bhor/The_Cannabis_API/tree/v2
- Terpene Profile Parser for Cannabis Strains: https://github.com/MaxValue/Terpene-Profile-Parser-for-Cannabis-Strains
- OpenTerps: https://github.com/Banjerr/OpenTerps
- Strain Database (org): https://github.com/strain-database
- grow_data (Shannon-Goddard): https://github.com/Shannon-Goddard/grow_data

## Owner-provided spreadsheet (BEST ratio source) — `cannabis_strains.csv`
Uploaded by owner to `/workspace/cannabis_strains.csv` (8,910 strains). Columns:
`strain_name, Description, type_ratio, strain_type_summary, strength,
Medicinal Effects, smell_taste, physical effect, flavor, thc, cbd, genetic_background`.
- **`type_ratio`** — explicit split e.g. `30% Indica / 70% Sativa` → this is the
  authoritative sativa/indica RATIO signal (~7,900 rows parse; 7,769 sum to exactly 100).
- `genetic_background` = lineage; `smell_taste` = aroma; `flavor` = flavor.
- thc/cbd: owner note — only use if NOT provided by inventory-intake JSON.
- `strain_type_summary` is skewed/unreliable ("Indica Dominant" ×8273); trust `type_ratio`.
- We store BOTH the numeric ratio (indica_pct/sativa_pct) AND the derived leaning
  designation (indica-hybrid / sativa-hybrid / hybrid).

## DoltHub (WA I-502 state lab data — most authoritative for base type)
Install dolt, then clone:
```
sudo curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | sudo bash
dolt clone dolthub/cannabis-testing-wa
```

## What we need from these
1. **strain_type** — indica / sativa / hybrid / indica-hybrid / sativa-hybrid.
2. **ratio / percentage** — the sativa↔indica split, e.g. `70/30 sativa hybrid`
   → `sativa_pct = 70`, `indica_pct = 30`. Store BOTH the leaning designation and
   the numeric ratio so a customer can see how a hybrid leans.

## Notes / prior finding (verified this project)
- The earlier *combined* extract (`/workspace/kb_sources/combined_strains.json`,
  26,265 rows) only carried base type (hybrid/indica/sativa) with NO leaning or
  ratio field — the extractor collapsed everything via `canon_type`. That is WHY
  we must go back to the ORIGINAL sources above, several of which expose a
  dominant/ratio signal per strain (e.g. "Sativa-dominant", "70% Sativa") that the
  first pass dropped.
- CCRS is hard-set (Indica/Sativa/Hybrid) and must NOT be touched — leaning +
  ratio are WEBSITE + BACK-OFFICE only.

## CBD strain pass (migration 0075)

A dedicated pass for CBD strains, grounded in VERIFIED WA state lab data rather
than marketing copy:

- Source: `dolthub/cannabis-testing-wa` (`tests` table) — real WA state lab
  results with `cbd_max`, `thc_max`, and `strain_chemotype`.
- CBD relevance defined scientifically by modal chemotype:
  - Chemotype 3 = CBD-dominant (Type III)
  - Chemotype 2 = balanced THC:CBD (Type II)
- Threshold: >= 5 lab tests per strain (drops one-off outliers / mislabeled
  products — e.g. a THC strain with a single fluke high-CBD test is excluded).
- Result: 40 strains (9 CBD-dominant, 31 balanced).
- Factual flavor tags cross-referenced from the Cannabis API structured `Flavor`
  list (descriptors only — NO verbatim prose descriptions copied).
- `potency_note` records the averaged lab facts + test count + chemotype.
- Confidence scales with test volume (>=100 tests -> 0.75, >=20 -> 0.65, else 0.55).

Migration `0075_seed_kb_cbd_strains.sql` is idempotent and NON-destructive:
INSERT new strains by slug; ON CONFLICT only fills NULL/empty fields (coalesce)
and merges arrays (deduped append), so owner edits are never overwritten.
Validated against a local Postgres 15 instance: clean apply, owner-row edits
preserved, re-apply stays at 40 rows.

Build artifacts: `kb_sources/cbd/` (build_cbd_seed.py, emit_migration.py,
cbd_strains.json, wa_cbd_chemotype.csv).
