# Shop Page Cosmetic Overhaul — Handoff-Ready Plan

Branch: `feature/shop-page-cosmetic-overhaul` (based on `main` @ 9add48c)
Goal: Make the shop page (`/menu`) cleaner, wider, 4-column, with smart data-derived filters,
target-style filter pills, fixed desktop filter scroll, high-CBD filter, and aligned product cards.
Visual target: Uncle Oke's dispensary screenshot (clean hero, left-aligned breadcrumb + pills below, 4 columns).

## Data-derived constants (verified from src/data/pos-menu-preview.json, visible items n=2325)
- Variant weight labels actually present: 0.5g, 1g, 1.5g, 2g, 2.5g, 3g, 3.5g, 5g, 7g, 14g, 1oz, 10pk, plus oz/fl oz/ml/mg
- Price: min $3, max $320, median $24  -> price slider 3 -> 320
- THC%: min 0.3, max 99.0, median 37.4 -> THC slider max ~99 (data-derived)
- CBD%: min 0.0, max 72.0, median 0.2  -> CBD slider max ~72 (data-derived)
- strainType counts: hybrid 1953, sativa 170, indica 170, unknown 32, cbd 0
  -> High-CBD must be threshold-based on totalCbd (unit %), NOT strainType.
- High-CBD threshold: CBD >= 4% (industry "CBD-rich" / Dutch Passion). Yields ~31 items.

## Tasks

### A. Top section cleanup (src/app/menu/page.tsx)
- [x] Remove badges, long description (totalInventoryUnits), disclaimer box, 3 buttons
- [x] Remove `<MenuCollectionShell>` desktop block (stats + SHOP BY CATEGORY clutter)
- [x] Drop unused imports (Link, MenuCollectionShell, totalInventoryUnits helper)

### B. Hero banner — wide + short (src/app/menu/page.tsx)
- [x] Wide, short banner: "SHOP OUR MENU" left-aligned + one short subtitle line
- [x] Keep a tasteful illustration on the right, NO logo icon
- [x] Reduce vertical height vs current

### C. Wider page + 4th column (InteractiveMenuBrowser.tsx)
- [x] Increase shop max width beyond max-w-7xl (max-w-[88rem])
- [x] Product grids: sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4
- [x] Adjust sidebar grid lg:grid-cols-[280px_1fr]

### D. Desktop filter scroll/pin fix (InteractiveMenuBrowser.tsx aside)
- [x] Sticky aside scrollable: lg:sticky lg:top-24 + max-h + overflow-y-auto. Mobile unchanged.

### E. High-CBD "CBD" strain filter
- [x] Add synthetic strain option value "cbd" labeled "CBD" to strainOptions
- [x] itemMatchesCriteria: selected "cbd" => totalCbd unit % value >= 4
- [x] Count = items meeting threshold

### F. Smart filter values
- [x] Replace hardcoded requestedWeights with weights derived from actual variant labels
- [x] Price slider min=3, max=data max; THC max=data max; CBD max=data max
- [x] Pass min/max props to MenuFilterControls; update sentinel logic

### G. Product card box alignment (ProductCardVisual.tsx)
- [x] Move strain pill + THC/CBD grid into the BOTTOM group (above price/cart)
- [x] Boxes align across cards regardless of name length

### H. Filter pills target-style (FilterTags.tsx)
- [x] Remove "No active filters" empty box (render nothing when none)
- [x] Clean horizontal pill row (value + x)

### I. Search NOT a pill (InteractiveMenuBrowser.tsx)
- [x] Remove "search" entry from activeFilterTags; verify search still composes

### J. Layout/breadcrumb
- [x] HOME > SHOP left-aligned, widen to shop width
- [x] Filter pills horizontal line below breadcrumb area

### K. Verification & delivery
- [x] npx tsc --noEmit clean
- [x] npm run build succeeds
- [x] Commit + push; open PR -> Vercel preview
