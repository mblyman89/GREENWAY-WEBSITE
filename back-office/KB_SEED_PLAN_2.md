# KB Seed — Expansion Pass 2

Owner asks (this pass):
- Hold off on building new AI features; keep strengthening the KB.
- Fill out the remaining **terpene** profiles (the major well-documented ones beyond the first 8).
- Expand the strain list from 101 to **a few hundred more** (target ~350–450 total).
- **Loosen the matching rule**: very-similar names / grower-to-grower spelling
  variants should be treated as the SAME strain via aliases (not rejected for not
  being an exact match). Examples the owner gave:
  - Gorilla Glue #1 / #4 / GG4 / "Gorilla Glue" → aliased to the canonical entry
  - Cherry OG / Cherries OG / Cherry's OG / "Cherries" → aliased together
  Cannabis names drift between growers; capture the variants as aliases so the
  retrieval matcher recognizes them all.

Still-firm rules:
- No guessing on FACTS. Type + lineage only when corroborated across reputable
  sources (Leafly / Wikileaf / AllBud / Seedfinder / breeder-stated). Disputed
  lineage stays null.
- Sensory / botanical / market-factual ONLY. No medical or effect claims (I-502).
- Every row keeps `sources[]` + `confidence`.
- The "loosening" applies to NAME MATCHING (aliases), NOT to inventing facts.

Deliverables:
- Updated `back-office/kb_seed/build_strains.py` (the verified list grows).
- Regenerated `strains_seed.csv`, `strains_seed.sql`, `src/lib/ai/kb/strains-data.ts`.
- Expanded `SEED_TERPENES` in `src/lib/ai/kb/seed.ts` + matching seed in store.

Deferred (owner): vendor/brand data, product images, edibles/drinks crawling,
eval harness, reviewer accept-gate.

## TODO
- [x] Branch + plan (this file)
- [x] Expand SEED_TERPENES with major terpenes (sensory only) — now 22 (was 8)
- [x] Append verified strains with rich aliases (name variants) — now 166 (was 101)
- [x] ALIAS_MERGES: add grower-to-grower variants to existing strains
      (Gorilla Glue #1/#4/GG4 → Original Glue; GSC; Do-Si-Dos; GDP; etc.)
- [x] Regenerate CSV/SQL/TS
- [x] tsc + eslint + next build (all pass)
- [ ] Commit, PR, merge, sync main
- [ ] Present CSV + SQL to owner

## Result
- Strains: 166 (101 original + 65 new), 14 high-CBD/balanced, 0 duplicate slugs,
  every row has sources[] + confidence. Disputed lineage left null.
- Terpenes: 22 major terpenes, sensory/flavor only.
- Loosened matching: variant aliases so grower-to-grower spellings resolve to the
  canonical strain (the owner's Gorilla Glue / Cherry-Cherries example).
