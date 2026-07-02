# KB rich-seed + unified UI + editable product types + intake→KB growth + mapping + reset fix

Branch: `feature/kb-deep-extraction` (PR #223, open) — extend it.

## Confirmed intent
- Unified top area with master switch [ Strains ] [ Product Types ]; filters/sort up top; swap per view.
- Product Types view = 24-family taxonomy w/ OUR factual descriptions + WA CCRS mapping. NO stale CA imports.
- Make Product Types **addable/editable** like strains (add + edit + toggle-active).
- **Seed hook missing:** seedKnowledgeBase() does NOT seed kb_product_categories yet — add it.
- **Intake→KB growth:** when intaking edibles/liquids/RSO/tinctures/topicals, capture product+info into KB so it
  keeps growing (from staff research or web4ai crawler). KB = backbone; when KB lacks info, it tells us.
- Strains = Flower/Joint/Blunt/Concentrate/RSO (strain-based). Others = own list.

## Standing rules
Never guess; verify from files; stop & ask if unsure; drafts-only; money in cents; CCRS+DOH;
Supabase migrations MANUAL by owner + idempotent; branch+PR+squash-merge; hand-off ready.

## Slices
- [x] S1 — seed: add kb_product_categories to seedKnowledgeBase() (idempotent upsert on slug).
- [x] S2 — store: add upsertKbProductCategory() + setProductCategoryActive() + listAll (incl. inactive) for editor.
- [x] S3 — actions: upsertProductCategoryAction() + toggleProductCategoryAction() (mirror strain actions).
- [x] S4 — UI: unified KbLibrary switcher [Strains][Product Types]; filters/sort up top; product-type add/edit form.
- [x] S5 — verify slice (tsc clean + build exit 0, menu untouched). COMMITTED.
- [x] A3 — intelligent inventory→KB fuzzy matcher (exact + near-exact). PURE lib strain-matcher.ts + 12/12 test.
- [x] A3b — wired matcher into intake review ([id]/page.tsx): green KB match / amber confirm / gray no-match badge.
- [x] A2 — fixed reset RPC: added `where true` to all 52 DELETEs in migration 0069 (on PR #222 branch, pushed).
- [x] Verify: tsc clean + next build exit 0 (2,380 pages); menu untouched; CCRS/DOH untouched; both branches pushed.

## Result
- PR #223 (feature/kb-deep-extraction): unified Strains/Product-types switcher, editable product types,
  seedKnowledgeBase() now seeds kb_product_categories, intelligent intake→KB matcher + review badges.
- PR #222 (feature/reset-operational-data-and-mock-cleanup): 0069 `where true` fix for the reset error.
- Both applied MANUALLY by owner: migration 0070 (product categories) + re-run seed; migration 0069 (reset fix).

## A3 matcher design (grounded in intake fields)
Intake ParsedLine has: product_name, strain_name, category, inventory_type. KB has kb_strains
(name, aliases[], slug) + kb_product_categories (name, aliases[], group_key, wa_inventory_types[]).
Matcher = PURE lib `src/lib/ai/kb/strain-matcher.ts`, no I/O:
  - normalize: lowercase, strip pack sizes/weights (3.5g, 1g, "- Pre-roll", parenthetical brand),
    collapse punctuation, expand known tokens (og, gg#4, etc.).
  - exact: normalized equality vs name or any alias → confidence 1.0.
  - near-exact: token-set + Levenshtein/Dice ratio ≥ threshold → ranked candidates w/ score.
  - handle vendor prefixes/suffixes (brand added to a known strain name).
  - returns { match: best|null, candidates: [{strain, score, reason}], needsReview }.
Vendor name variations: "Blue Dream 3.5g", "GG#4 (Gorilla Glue)", "Wedding Cake - Preroll" → Blue Dream / GG4 / Wedding Cake.

## Notes
- kb_product_categories schema (0070): id, slug UNIQUE, name, group_key, summary, aliases[], wa_inventory_types[],
  sort_order, active, created_by/updated_by, timestamps.
- PRODUCT_CATEGORIES seed lives in src/lib/ai/kb/product-categories-data.ts (24 entries).
- group_key ∈ flower|concentrate|vape|edible|liquid|topical.
