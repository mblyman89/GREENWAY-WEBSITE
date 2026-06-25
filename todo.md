## Phase 1: Popcorn Bud Category Fix (current slice)
- [x] Read and trace the current transformer code flow
- [x] Identify where popcorn bud products get grouped with regular flower
- [x] Add `popcorn-bud` GreenwayCategory to types.ts and category-taxonomy.ts
- [x] Add popcorn keyword detection in transformer (name-based override)
- [x] Add variant price-heuristic diagnostic (same size, very different price)
- [x] Update CATEGORY_MAP to map "Popcorn Bud" → "popcorn-bud"
- [x] Test the fix against current data — 13 popcorn-bud items separated, 3 price-heuristic warnings caught
- [x] Investigate edge cases and false positives
  - Phat Panda "bong buddies Trophy wife" = POS Category column says "Popcorn Bud" (data entry issue, not regex false positive)
  - Suspended "THC Iceberg" = infused/mixed flower products miscategorized as "Flower" in POS (not popcorn bud)
  - High Tide "Zeaweed Snappers" = budget small-bud line similar to popcorn (not detected by keyword)
  - Viking Cannabis "Old School Lemons" = has "Popcorn" in product name, correctly detected
- [ ] Verify the Next.js build compiles successfully
- [ ] Commit and push branch to GitHub for user inspection

## Phase 2: Product Name Parser + Catalog (future slice)
- [ ] Build product name parser (dash-delimited format parsing)
- [ ] Build strain alias catalog (normalizing similar strain names)
- [ ] Build brand alias resolution (close/fuzzy match → brand column wins)
- [ ] Build confidence-based correction engine
