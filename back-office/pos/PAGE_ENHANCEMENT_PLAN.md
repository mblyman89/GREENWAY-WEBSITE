# Products / Vendors / Brands — Page Enhancement Plan (Slice 1)

> Directly answers the owner's immediate ask: make these pages "much more feature rich," tell me
> "exactly what information is missing," show "more statistics and detailed info," for "complete
> insight." Pure UI + read-only analytics over existing data — **zero DB risk**, no source-of-truth
> change. Builds on helpers that already exist in the codebase.

---

## What already exists (verified in Slice 0)
- **`src/lib/vendors/completeness.ts`** — `vendorCompleteness(v, hasLogo)` and
  `brandCompleteness(b, hasLogo)` returning `{ percent, completed, total, items[], nextUp, level }`.
  - Vendor checks: logo (w3), mission (w2), about (w3), website (w1), email (w1), social (w1).
  - Brand checks: logo (w3), about (w3), product_philosophy (w2), website (w1).
- **`/admin/vendors/page.tsx`** — 3 StatCards (Total/Published/Drafts), search + status filter,
  grid of cards with logo + `CompletenessMeter`.
- **`/admin/products/page.tsx`** — `computeGaps(item, enrichment): GapFlags`
  (`hasDescription`, `hasImage`, `hasBrandLink`, `enrichmentStatus`); StatCards
  (Products, Enriched & live, Missing description, Missing image) + table.
- `/admin/vendors/[id]/page.tsx` detail page (482 lines) — extend with full breakdown.

## Design goal
Turn each page into a **mini command center** with three layers:
1. **Top stats band** — the at-a-glance numbers.
2. **"What's missing" insight** — exact gaps, counted and deep-linked to fix.
3. **Rich list/table** — sortable/filterable with inline completeness + quick facts.

---

## Products page `/admin/products`
**Stats band (add to existing):**
- Total products, % enriched & live, draft enrichments, hidden count.
- Missing: description, short description, image, brand link, COA/lab data, price, category.
- Distribution: by category, by strain type, price range (min/median/max), stock status mix.
- Top brands / top vendors by product count.

**What's missing insight:**
- A ranked list of the biggest gaps (e.g., "142 products missing images", "37 missing descriptions"),
  each a deep link (reuse existing `?gap=description` / `?gap=image` pattern; add `?gap=coa`, etc.).
- Per-row "next best action" (highest-weight missing field).

**Table upgrades:**
- Add columns: completeness %, strain type, price, stock status, lot/COA presence (once `[S4]`).
- Sort by completeness, price, stock; filter by category/brand/vendor/gap.

**Enhancement to `computeGaps`/`GapFlags`:** extend to a weighted score (mirror `completeness.ts`)
so products get the same `{percent, items[], nextUp, level}` shape — one shared insight model.

## Vendors page `/admin/vendors`
**Stats band (extend the 3 cards):**
- Total / Published / Drafts (existing) + Avg completeness %, vendors missing logo,
  vendors with no brands, vendors with no products, vendors missing website/email.
- Total brands across vendors, total products across vendors.

**What's missing insight:**
- Ranked gap list (e.g., "9 vendors missing logo", "5 vendors with no about").
- Per-vendor card already shows meter; add `nextUp` chip ("Add logo", "Add about").

**Detail page `/admin/vendors/[id]`:**
- Full completeness breakdown (every check, weight, done/undone).
- Vendor's brands with their completeness, product counts.
- Vendor stats: product count, brand count, category mix, (later) PO/receiving history `[S5/S6]`.

## Brands page `/admin/brands`
> If a dedicated brands list page doesn't exist yet, add one mirroring vendors (the data + helper
> `brandCompleteness` already exist).
- Stats band: total brands, avg completeness, brands missing logo/about/philosophy/website,
  brands with no products, brands by vendor.
- "What's missing" ranked gaps + per-brand `nextUp`.
- Brand detail: completeness breakdown + products + parent vendor.

---

## Shared building blocks to add `[S1]`
- **`completeness.ts` → generalize** to also score products (extend, don't duplicate): add a
  `productCompleteness(item, enrichment, hasImage)` using the weighted model.
- **`<StatBand>`** reusable component (responsive grid of stat cards with optional deep links).
- **`<MissingInsight>`** component: takes counted gaps + links, renders the ranked "fix these" list.
- **`<CompletenessMeter>`** (exists) reused across products/brands.
- All read-only server components (Next.js App Router) — no new tables, no writes.

## Acceptance for Slice 1
- Each page shows a stats band, a "what's missing" ranked insight list (deep-linked), and a richer
  sortable/filterable list/table — for products, vendors, and brands.
- One shared weighted completeness model powers all three.
- No DB migration; no change to POS/price/inventory source of truth.
- These insight patterns become the template every later POS admin screen reuses.
