# Strain Type Audit — adding Indica-Leaning & Sativa-Leaning Hybrids

Owner request (verbatim): "We recently expanded our strain types to include
indica and sativa leaning hybrids. Will you please walk the entire project to
make sure the entire project is now using these new designations for the website
and back office only, don't mess with the strain details regarding CCRS they are
hard set. I ask because I noticed that the shop menu does not have them included
in the strain type filter. I want you to make certain that everywhere and
anything that needs this or would use this has access to it and can be tracked
and reported and all that."

Standing-rule scope: WEBSITE + BACK OFFICE only. **Do NOT touch CCRS strain
designations** (they are hard-set to Indica/Sativa/Hybrid).

---

## Canonical values (decision, grounded)
The new website/back-office strain types are the existing set PLUS two leaning
hybrids. Machine value ↔ display label:

| machine value    | display label            | CCRS export (unchanged) |
|------------------|--------------------------|-------------------------|
| `indica`         | Indica                   | Indica                  |
| `sativa`         | Sativa                   | Sativa                  |
| `hybrid`         | Hybrid                   | Hybrid                  |
| `indica-hybrid`  | Indica-Leaning Hybrid    | **Hybrid**              |
| `sativa-hybrid`  | Sativa-Leaning Hybrid    | **Hybrid**              |
| `cbd`            | CBD                      | Hybrid                  |
| `unknown`        | (category label shown)   | Hybrid (defaulted)      |

**Machine-value choice:** the app already used two DIFFERENT string spellings for
leaning hybrids in different places, which is itself a bug:
- Space form `"indica leaning hybrid"` / `"sativa leaning hybrid"` in
  `syndication/menu-feed-core.ts` (VALID_STRAIN), `StrainEditor.tsx`,
  `MenuFilters.tsx` (static fallback), and `concierge-kb.ts`.
- The website union type `GreenwayStrainType` and the interactive filter use
  compact tokens (`indica`, `sativa`, `hybrid`, `cbd`, `unknown`).

Decision: use hyphenated tokens **`indica-hybrid`** / **`sativa-hybrid`** as the
canonical machine values across the app (consistent with the compact-token union
and safe as query-string filter values), and add ONE label helper that renders
the friendly "Indica-Leaning Hybrid" text. `normalizeStrainType` on both the POS
and syndication sides must accept the legacy space spellings AND the hyphen
tokens and canonicalize to the hyphen tokens, so nothing already stored breaks.

## Why the shop-menu filter is missing them (root cause)
The interactive filter (`InteractiveMenuBrowser.tsx` → `strainOptions`) builds its
options DYNAMICALLY from the `item.strainType` values actually present in the
data. Leaning hybrids never appear because:
1. `GreenwayStrainType` doesn't include them, and
2. `pos/transform.ts` `STRAIN_MAP` / `normalizeStrainType` never PRODUCE them —
   e.g. "indica dominant" collapses to `indica`, and there's no mapping for
   "indica leaning hybrid" (it falls through to `unknown`).
So the fix is: (a) add the values to the type, (b) map source labels to them in
the transform, (c) give the filter/cards friendly labels + tone colors.

## CCRS is already safe (verified — do not change)
`src/lib/compliance/ccrs-batch-core.ts` `normalizeStrainType()` maps anything
containing "hybrid" (and any indica+sativa/ratio/dominant/cbd) to `Hybrid`. So
`"indica leaning hybrid"` / `indica-hybrid` already export correctly as **Hybrid**.
CCRS_STRAIN_TYPES stays exactly Indica/Sativa/Hybrid. **No CCRS edits.**

## Database (verified — no migration needed)
`strain_type` is free-text `text` in every table that stores it — NO CHECK
constraint:
- `0002_slice2_pos_import.sql` → `strain_type text not null default 'unknown'`
- `0036_product_masters.sql` → `strain_type text`
- `0019_cannabis_knowledge_base.sql` → `strain_type text`
So the DB already accepts the new values. This is a **code-only** change.

---

## Files touched by strain type (full inventory, 41 files / 343 matches)

### A. Core type + NEW shared label helper (do first)
- [ ] `src/lib/leafly/types.ts` — extend `GreenwayStrainType` union with
      `"indica-hybrid" | "sativa-hybrid"`. (Compiler will then flag every
      `Record<GreenwayStrainType, ...>` that needs new entries — good.)
- [ ] `src/lib/pos/transform.ts` — local duplicate `type GreenwayStrainType`
      (line 29) must match; extend `STRAIN_MAP` to map "indica leaning hybrid",
      "sativa leaning hybrid", "indica-hybrid", "sativa-hybrid",
      "indica dominant hybrid", "sativa dominant hybrid" → the new tokens.
- [ ] **NEW** `src/lib/menu/strain-taxonomy.ts` (mirror category-taxonomy.ts):
      canonical value list, `strainTypeLabel(value)`, `canonicalStrainType(raw)`
      (accepts legacy space spellings + hyphen tokens). Single source of truth.

### B. Website menu (customer-facing — the owner's main concern)
- [ ] `src/components/menu/InteractiveMenuBrowser.tsx` — pass a strain label
      formatter to `buildOptions` for `strainOptions` (so chips read
      "Indica-Leaning Hybrid"); confirm `matchesStrainSelection` works for the
      new values (it does — equality on strainType). haystack line already
      includes strainType.
- [ ] `src/components/menu/ProductCardVisual.tsx` — add tone entries for
      `indica-hybrid`/`sativa-hybrid` in `cardTones`; use `strainTypeLabel` in
      `displayStrain`.
- [ ] `src/app/menu/products/[id]/page.tsx` — add tone entries in
      `productTones`; use `strainTypeLabel` in `displayStrain`.
- [ ] `src/components/menu/MenuFilters.tsx` (static fallback) — align the chip
      list values/labels with the taxonomy (currently space spellings).
- [ ] `src/lib/leafly/mock-menu.ts` — add at least one leaning-hybrid sample so
      the fallback menu + filter demonstrably show the new options.

### C. Back office
- [ ] `src/app/admin/knowledge-base/StrainEditor.tsx` — `STRAIN_TYPES` list
      (already lists leaning) → use taxonomy values/labels. Note: also fixes an
      existing `--admin-bg` token typo in inputCls (token doesn't exist).
- [ ] `src/app/admin/knowledge-base/actions.ts` — **BUG**: `ALLOWED_STRAIN_TYPES`
      = {indica,sativa,hybrid,unknown} silently coerces a leaning selection to
      "hybrid". Expand to include the leaning tokens (+ accept legacy spellings).
- [ ] `src/lib/ai/kb/seed.ts` — `strain_type` union literal (line 28) is
      `"indica"|"sativa"|"hybrid"` → widen to include leaning tokens (type only;
      seed data can stay).
- [ ] `src/lib/ai/kb/store.ts` / `retrieval.ts` — `strain_type: string` (free
      text) — verify passthrough; retrieval default `"hybrid"` fine.

### D. Reporting / tracking (must "be tracked and reported")
- [ ] `src/lib/insight/products.ts` — `byStrainType` distribution is free-text
      → will now naturally show leaning buckets. Confirm label formatting via
      taxonomy for a clean admin display (`DistributionBars` is display-only).
- [ ] `src/app/admin/products/page.tsx` — DistributionBars "By strain type"
      (verify friendly labels).

### E. Passthrough / no logic change (verify only, likely no edit)
- [ ] `src/lib/pos/db-types.ts` (`strain_type: string`) — free text ✓
- [ ] `src/lib/pos/import-service.ts` (passes `item.strainType`) — ✓
- [ ] `src/lib/products/masters-store.ts` (`strain_type: string | null`) — ✓
- [ ] `src/app/admin/products/[key]/page.tsx` + `actions.ts` (hidden field
      passthrough of `posStrainType`) — ✓
- [ ] `src/components/cart/CartProvider.tsx` (`strainType: string`, display) — ✓
- [ ] `src/lib/ai/suggestions.ts`, `src/lib/leafly/ai.ts`, `src/lib/weedmaps/ai.ts`
      (prompt strings, free text) — ✓
- [ ] `src/lib/leafly/payload-core.ts`, `src/lib/weedmaps/payload-core.ts`
      (strainType only in test fixtures; payload maps CATEGORY→type, not strain
      type) — ✓ no third-party contract change.
- [ ] `src/lib/syndication/feed-source.ts` (`strain_type` passthrough) — ✓
- [ ] `src/lib/syndication/menu-feed-core.ts` — `VALID_STRAIN` already lists the
      space spellings; align to canonicalize to hyphen tokens (keep accepting
      legacy) so feed + website agree.
- [ ] `src/components/merch/MerchDetailPanel.tsx`, `src/lib/merch/merch-catalog.ts`
      (hard `"unknown"` for non-cannabis merch) — ✓ leave as is.
- [ ] `src/lib/admin/concierge-kb.ts` — already documents leaning labels; update
      wording to the canonical labels if needed (copy only).
- [ ] `src/lib/ai/compliance.ts` — only mentions "strain type" in guidance prose
      — ✓ no change.
- [ ] `src/lib/ai/kb/strains-data.ts`, `src/lib/ai/kb/seed.ts` data — factual
      seed data; not required to add leaning entries.
- [ ] `src/lib/ai/kb/retrieval.ts` line 82 default — ✓
- [ ] `src/components/menu/ProductDetailPurchasePanel.tsx`,
      `ProductOrderIntent.tsx` (pass `item.strainType` into cart) — ✓ passthrough.

### F. DO NOT TOUCH (CCRS — hard-set)
- `src/lib/compliance/ccrs-batch-core.ts` (CCRS_STRAIN_TYPES + normalizeStrainType)
- `src/lib/compliance/ccrs-batch.ts`
- `src/app/admin/integrations/leafly/actions.ts` / `weedmaps/actions.ts`
  strainType is `string | null` passthrough — verify only, no CCRS impact.

---

## Verification plan
1. `rm -rf .next && npx tsc --noEmit` — the widened union will surface EVERY
   `Record<GreenwayStrainType, …>` site that needs a new entry (tone maps).
2. `npm run build` — must succeed; `/menu`, `/menu/products/[id]`,
   `/admin/knowledge-base`, `/admin/products` present.
3. Manual: confirm the shop-menu strain filter now offers Indica-Leaning /
   Sativa-Leaning Hybrid when such items exist (mock-menu sample proves it).
4. Confirm a CCRS Strain export still emits only Indica/Sativa/Hybrid (unchanged
   normalizer + its self-tests).

## Then
Per owner: after building this, **merge all open PRs** (#216 non-ACH payment —
remind owner to apply migration 0068; #217 flicker+wordmark; and this strain
PR). main is branch-protected → squash-merge each with the token.
