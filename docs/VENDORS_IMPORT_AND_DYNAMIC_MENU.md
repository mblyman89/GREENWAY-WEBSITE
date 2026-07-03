# Vendors/Brands Import + Dynamic Menu — Work Plan

**Status:** living document. Hand-off ready. Follows standing rules
(verbatim requests, verified-not-guessed, drafts-only, slices, idempotent
migrations applied MANUALLY by owner, money in minor units, CCRS+DOH
compliance, branch+PR+squash-merge to protected `main`).

Branch: `feature/vendors-import-and-dynamic-menu` (off `main` after #222 + #223 merged).

---

## Verbatim request (Request F)
> "the vendor and brands data should not be deleted... I will be getting my vendor
> and brand data from Cultivera soon, and when I do I will upload it in and it will
> fill in as many gaps as it can. I will however need an import button so the
> vendors and brands page can get the data from Cultivera please add that feature
> in first. I'll give it to you first so you can make sure the file upload works
> for the spreadsheet they give me, but for now just add an import button if there
> isn't one there already. Then let's just focus on the dynamic menu. You can
> merge the reset feature and the one after it too... After the import button has
> been added and the dynamic menu has been resolved, we can go back to the kb
> hardening. Please complete all work on the import button and dynamic menu issue
> then stop. Then I will inspect, then on to kb hardening."
> (Follow-up: "I need you to do the pushing and merging and stuff.")

---

## Done
- [x] Squash-merged PR #222 (reset) → main (0069 on main).
- [x] Squash-merged PR #223 (KB deep-extraction + taxonomy) → main (0070 on main).
- [x] Branched `feature/vendors-import-and-dynamic-menu` off fresh main.

## Verified facts (not guessed)
- `/admin/vendors` = the combined Vendors & Brands page. No separate `/admin/brands`.
- **No import button exists today.** Vendors/brands are only seeded via
  `npm run seed:vendors` (105 vendors + 168 brands, upsert by slug) or edited
  one at a time.
- Customer menu is served from the **static committed JSON**
  `src/data/pos-menu-preview.json` (6,226 items) via `src/lib/pos/preview-menu.ts`
  — NOT the DB. The DB menu (`menu_versions`→`menu_items`, migration 0002) exists
  but the site never reads it. THIS is the "broken pipeline."

## Slice V1 — Vendors/Brands Import button (FIRST)
- [ ] Add Import control to `/admin/vendors` (upload spreadsheet: csv/xlsx).
- [ ] Server action + parser scaffold that upserts by slug (mirror
  `seed_vendors_brands.ts`: draft status, gap-fill, never blindly overwrite
  curated fields). Column mapping finalized when owner supplies the real
  Cultivera file. NO GUESSING columns before then.
- [ ] Audit-log the import. Idempotent.

## Slice P1 — Dynamic menu (SECOND, then STOP)
- [ ] Make customer pages read the live DB menu (active `menu_versions`→
  `menu_items`) with the committed JSON as an explicit build-time fallback.
- [ ] Empty back office ⇒ no product cards on home/shop/specials/menu.
- [ ] Verify all four surfaces switch cleanly; tsc + build green.

## After that: STOP for owner inspection, then resume KB hardening
(see prior audit conclusion: validated enrichment does NOT flow to KB yet;
build write-back per agreed design — drafts-only, per-SKU kb_products,
effects with medical-claim filter, images via kb_image_substitutes).
