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
- [ ] S1 — seed: add kb_product_categories to seedKnowledgeBase() (idempotent upsert on slug).
- [ ] S2 — store: add upsertKbProductCategory() + setProductCategoryActive() + list active-any (incl. inactive) for editor.
- [ ] S3 — actions: upsertProductCategoryAction() + toggleProductCategoryAction() (mirror strain actions).
- [ ] S4 — UI: unified KbLibrary switcher [Strains][Product Types]; move filters/sort up top; add Product Type add/edit form.
- [ ] S5 — verify slice (tsc + build) BEFORE touching intake.
- [ ] A3 — intelligent inventory→KB fuzzy matcher (exact + near-exact), audit intake, wire suggestion.
- [ ] A3b — intake→KB growth: capture new non-strain products into KB on intake (draft/pending).
- [ ] A2 — fix reset RPC "DELETE requires a WHERE clause".
- [ ] Verify: tsc clean + next build; menu untouched; CCRS/DOH untouched; push; PR.

## Notes
- kb_product_categories schema (0070): id, slug UNIQUE, name, group_key, summary, aliases[], wa_inventory_types[],
  sort_order, active, created_by/updated_by, timestamps.
- PRODUCT_CATEGORIES seed lives in src/lib/ai/kb/product-categories-data.ts (24 entries).
- group_key ∈ flower|concentrate|vape|edible|liquid|topical.
