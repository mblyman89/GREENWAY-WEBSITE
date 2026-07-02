# TODO — Indica-Hybrid / Sativa-Hybrid strain types (website + back office)

Owner decisions: machine values `indica-hybrid` / `sativa-hybrid`; display
labels "Indica-Hybrid" / "Sativa-Hybrid". Do NOT touch CCRS. Go slow, break
nothing. Full inventory in docs/STRAIN_TYPE_LEANING_HYBRID_AUDIT.md.

## Phase 0 — prerequisites
- [x] Merge PR #217 (flicker + wordmark)
- [x] Merge PR #216 (non-ACH payment) — owner must apply migration 0068
- [x] Pull latest main; branch feat-leaning-hybrid-strain-types

## Phase 1 — single source of truth (do first)
- [x] NEW src/lib/menu/strain-taxonomy.ts:
      - STRAIN_TYPE_VALUES + labels (indica, sativa, hybrid, indica-hybrid,
        sativa-hybrid, cbd, unknown)
      - strainTypeLabel(value)
      - canonicalStrainType(raw): accepts legacy space spellings ("indica
        leaning hybrid"), dominant spellings, hyphen tokens → canonical token
      - LEANING_HYBRID_VALUES set + isLeaningHybrid()
      - self-tests via `if (require.main === module)` runnable with tsx

## Phase 2 — core type + POS transform
- [x] src/lib/leafly/types.ts: extend GreenwayStrainType union
- [x] src/lib/pos/transform.ts: extend local union + STRAIN_MAP entries +
      normalizeStrainType uses canonicalStrainType (keep category guard)

## Phase 3 — website (customer-facing)
- [x] InteractiveMenuBrowser.tsx: label formatter for strainOptions
- [x] ProductCardVisual.tsx: cardTones entries + strainTypeLabel in displayStrain
- [x] app/menu/products/[id]/page.tsx: productTones entries + strainTypeLabel
- [x] MenuFilters.tsx (static fallback): align values/labels to taxonomy
- [x] lib/leafly/mock-menu.ts: add leaning-hybrid sample item(s)

## Phase 4 — back office
- [x] admin/knowledge-base/StrainEditor.tsx: STRAIN_TYPES from taxonomy
- [x] admin/knowledge-base/actions.ts: ALLOWED_STRAIN_TYPES bug fix (accept
      leaning + canonicalize)
- [x] lib/ai/kb/seed.ts: widen strain_type union literal
- [x] lib/syndication/menu-feed-core.ts: VALID_STRAIN canonicalize (align)

## Phase 5 — reporting / tracking
- [x] lib/insight/products.ts: friendly labels for byStrainType via taxonomy
- [x] verify admin/products/page.tsx DistributionBars display

## Phase 6 — verify passthroughs (no logic edits expected)
- [x] db-types, import-service, masters-store, products/[key]+actions,
      CartProvider, suggestions, leafly/weedmaps ai + payload, feed-source,
      merch, concierge-kb copy, compliance prose, retrieval

## Phase 7 — verify + ship
- [x] taxonomy self-tests pass (tsx)
- [x] rm -rf .next && npx tsc --noEmit (union surfaces all Record<> sites)
- [x] npm run build succeeds (menu, product detail, admin routes present)
- [x] Confirm CCRS unchanged (ccrs-batch-core self-tests still pass)
- [x] Commit, push, open PR, squash-merge
