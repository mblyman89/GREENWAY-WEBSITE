# PR-P1 — Product picker + brand exclusions + validation table (NO AI, NO migration)

Branch: feat/promotions-product-picker
Base: main @ 70057953

## Tasks
- [ ] 1. Add `listMenuProducts()` to promotions-store.ts (key/name/brand from published menu)
- [ ] 2. Create client island `PromotionProductPicker.tsx` (searchable include + exclude multi-select, chips + hidden inputs `target_product`/`exclude_product`)
- [ ] 3. Add brand-exclusions checkbox grid (`exclude_brand`) to PromotionForm Exclusions section
- [ ] 4. Wire `products` + selected/excluded sets into PromotionForm; derive selectedProducts/excludedProducts/excludedBrands
- [ ] 5. Pass `products` from new/page.tsx and [id]/page.tsx
- [ ] 6. Bring affected-products validation table to the NEW page (shared component `AffectedProductsPreview.tsx`, reused on edit page)
- [ ] 7. Full battery: pure self-tests, tsc, eslint, vitest, crawler pytest, next build
- [ ] 8. Open PR, poll checks, squash-merge, sync git

## Notes
- Parser already handles target_product/exclude_product/exclude_brand (actions.ts:196-222). Backend ready.
- ruleMatches handles product scope (item.key === value). No schema change needed — uses existing promotion_targets/promotion_exclusions with scope='product'/'brand'.
- Affected preview reuses previewAffectedProducts + sampleDiscount (already on edit page [id]/page.tsx:207-263).
- New page has no promotion yet, so live affected-preview can't show until saved; but we CAN show it on edit. Decision: extract the render into a shared component; on NEW page show an explanatory empty-state (no promo to resolve yet) OR skip. Keep edit-page behavior identical.
