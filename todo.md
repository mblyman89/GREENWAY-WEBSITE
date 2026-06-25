## Phase 1.5: Additional Popcorn Keywords + Infused Flower Category

### A. Expand popcorn-bud keyword detection
- [ ] Add "bong buddies", "b-bud"/"b bud", "littles", "snappers" to POPCORN_KEYWORDS regex
- [ ] Only detect popcorn-bud for FLOWER category items (not prerolls, infused prerolls)
- [ ] Handle "Small Buds" keyword as well (Skord products)

### B. Add "infused-flower" GreenwayCategory
- [ ] Add `"infused-flower"` to GreenwayCategory union in types.ts
- [ ] Add `"infused-flower"` to VALID_CATEGORIES in transformer
- [ ] Add `"infused-flower"` to category taxonomy with label + helper
- [ ] Map "Moon Rocks" → "infused-flower" (was "concentrate")
- [ ] Map "Mix Infused Flower" → "infused-flower" (was "concentrate")
- [ ] Add infused-flower keyword detection (detect "iceberg", "moon rock", "caviar", "infused flower" in names when POS cat = Flower)
- [ ] Add `"infused-flower"` to deriveDisplayName strain-display list
- [ ] Add filterCategories: infused-flower maps to both "infused-flower" AND "concentrate"
- [ ] Add filterCategories: infused-flower also maps to "flower" (like popcorn-bud)

### C. Verify and push
- [ ] Run transformer and verify output
- [ ] Verify Next.js build compiles
- [ ] Commit and push branch to GitHub

## Phase 2: Product Name Parser + Catalog (future slice)
- [ ] Build product name parser (dash-delimited format parsing)
- [ ] Build strain alias catalog (normalizing similar strain names)
- [ ] Build brand alias resolution (close/fuzzy match → brand column wins)
- [ ] Build confidence-based correction engine
