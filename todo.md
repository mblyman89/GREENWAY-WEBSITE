# Greenway — Checkout Overhaul + Vendors Page + Full Site Review

Branch: `feature/checkout-vendors-overhaul` (based off `feature/refinements-agegate-shop-specials` head `bf45327`, which is PR #20 — NOT yet merged to main).
Contact email for vendors button: `contact@greenwaymarijuana.com` (already in `src/content/business.ts` as `greenwayBusiness.emailHref`).

## CONTEXT / KEY FILES (read & understood)
- Cart state: `src/components/cart/CartProvider.tsx` — in-memory `useState`, NO persistence, NO qty stepper, NO tax/savings. Items: {productId,productName,brand,category,strainType,variantId,variantLabel,priceMinorUnits,quantity,lineId}.
- Add-to-cart entry points: `src/components/menu/ProductDetailPurchasePanel.tsx` (real one used on product page) + `ProductOrderIntent.tsx` (legacy?). They call `addItem(...)`.
- Checkout page: `src/app/checkout/page.tsx` -> `src/components/checkout/CheckoutPreview.tsx` (FULL of preview cruft — replace).
- Confirmation: `src/app/checkout/confirmation/page.tsx` -> `src/components/checkout/CheckoutConfirmationPreview.tsx` (FULL of mock/preview cruft — replace).
- Vendors page: `src/app/vendor-delivery/page.tsx` -> `src/components/vendors/VendorDeliveryPreview.tsx` (preview cruft — overhaul). Route stays `/vendor-delivery`. Nav label in `MobileNavigation.tsx` (line 46, 312-315) + maybe DesktopMenu.
- Card style reference: `src/components/home/HomeBrands.tsx` (aspect cards w/ gradient + glow). Hero band style: `src/components/home/SectionBanner.tsx` (wide+short).
- Data: `src/data/pos-menu-preview.json` (3005 items). Item.variants[].inventoryLevel = the COUNT to decrement. NO vendor field currently.
- Transformer: `scripts/pos/transform_pos_data.ts`. Reads `pos-data/raw/INVENTORIES.xlsx` (has **Vendor** column!) + PRODUCTS.xlsx. `collapseInventoryRows` line ~635 captures `brand: row.Brand` — ADD `vendor: row.Vendor` here. Thread through ProductGroup + toMenuItem (line ~937). Build runs `transform:pos` then `next build`.
- Format helper: `src/lib/leafly/format.ts` formatMinorCurrency. Types: `src/lib/leafly/types.ts`.

## TARGET DESIGN (from uploaded screenshots — Uncle Ike's style)
- **Cart** (My_cart already close): add qty stepper (− n +) + trash on item card, discount badge if on sale, full breakdown (Subtotal / Taxes Est. / Savings / Total). Keep store card.
- **Secure Checkout** (Target_example_of_secure_check): "Secure Checkout" title, "Customer Information" section: First Name, Last Name, Email, Phone, Birthday (MM/DD/YYYY) inputs -> orange "Save Information". Then "Order Summary" card (line items + Subtotal/Taxes/Savings/Total). Orange "PLACE ORDER" button. Small legal disclaimer footer. NO preview/readiness/compliance-preview cruft.
- **Order Confirmed** (Example_of_target_order_complete): centered card, circular checkmark, "ORDER CONFIRMED" orange heading, real order # (e.g. GWY-XXXXXX), "Email confirmation has been sent..." note, WA cannabis disclaimer, orange "CONTINUE SHOPPING". NO mock/preview/leafly cruft.

## BEHAVIOR REQUIRED (user explicit)
- Full REAL experience now. Completion need not call external services yet, but NO "preview" language.
- On PLACE ORDER: generate a real-looking order number, **decrement the product variant inventoryLevel count as if one sold** (client-side runtime state; next fresh spreadsheet upload resets). Clear cart. Go to confirmation showing the order #.
- Future (note only, do NOT build): alert to store + print receipt for sales team = third-party integration later.

## TASKS

### Phase 1 — Data/transformer: vendor extraction ✅ DONE
- [x] Add `vendor` to `CollapsedInventory` (from `row.Vendor`) in transformer.
- [x] Thread `vendor` through `toMenuItem` -> output `GreenwayMenuItem.vendor`.
- [x] Add `vendor` to `src/lib/leafly/types.ts` GreenwayMenuItem.
- [x] Write distinct vendor list -> `src/data/vendors.json` (112 vendors, name/slug/productCount).
- [x] Re-ran transform: 2964/3005 items carry vendor; vendors.json created.

### Phase 2 — Cart: inventory engine + qty + breakdown ✅ DONE
- [x] Inventory ledger (localStorage) tracking sold counts by variantId. `remainingInventory()` + `recordSale()`.
- [x] CartProvider: qty +/- per line (capped at inventoryLevel), trash remove. Cart persisted to localStorage.
- [x] Cart drawer: Subtotal / Taxes (Est. 9% Port Orchard) / Savings / Total. Disclaimer footer.
- [x] Sale % off badge + struck regular price on cart line. addItem callers pass regularPriceMinorUnits + inventoryLevel. tsc clean.

### Phase 3 — Secure Checkout page ✅ DONE
- [x] New `CheckoutFlow.tsx`: Customer Info form (First/Last/Email/Phone/Birthday) + validation + Save Information. Order Summary card. PLACE ORDER -> generateOrderNumber, recordSale per line, persistCompletedOrder, clearCart, route to confirmation?order=GWY-XXXXXX.
- [x] Clean empty-cart state. Legal disclaimer footer. Metadata cleaned. Helper `src/lib/checkout/order.ts`. Old CheckoutPreview deleted.

### Phase 4 — Order Confirmed page ✅ DONE
- [x] New `OrderConfirmation.tsx`: checkmark, ORDER CONFIRMED (orange), order #, email note, receipt, disclaimer, CONTINUE SHOPPING. Suspense-wrapped useSearchParams. Metadata cleaned. Old CheckoutConfirmationPreview deleted. tsc clean.

### Phase 5 — Vendors page overhaul (`/vendor-delivery`)
- [x] Hero banner wide+short, creative image, professional text.
- [x] Second hero banner introducing content below.
- [x] Professional concise statement + email button -> contact@greenwaymarijuana.com.
- [x] Vendor cards (HomeBrands style) from vendors.json: logo + name only; click -> seamless expand overlay with description (placeholder for now).
- [x] Remove preview cruft. Sexy desktop. Nav label -> Vendors & Partners (route kept).

### Phase 6 — Verify + ship
- [x] tsc, eslint, build clean (2366 routes).
- [x] Browser-verified: vendor cards+expand, cart, checkout, place order, confirmation, cart cleared, inventory ledger decremented.
- [x] Committed + pushed feature/checkout-vendors-overhaul + PR #21 (Vercel auto-deploys).

### Phase 7 — Full-site review report
- [x] Full review written to SITE_REVIEW.md (UX, design, content, compliance, performance, a11y, SEO, code health, conversion) + TLDR.

## NOTES
- Tax est: label "Taxes (Est.)" with a sane Port Orchard rate note; honest, not "preview". Final tax confirmed in-store.
- Inventory decrement is runtime/client only; fresh spreadsheet upload resets (matches user plan).
