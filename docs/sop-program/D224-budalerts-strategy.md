# D224 — Budalerts in the Vendor Menus feature: research, code recon and strategy (read-only round, 2026-11-13)

Owner request (verbatim, also in 00-OWNER-REQUEST-VERBATIM.md): "I have found another great resource for us to include in our vendor menu feature. please go to this website and gather everything you need to include it in our menu builder. please first visit the site, get what you need, then recon the code, document your findings in a strategy roadmap report. report back with your strategy for including them in the vendor menu. no code edits yet please, just research, recon and reporting." — https://budalerts.com/brands

Status: research only. No code, migrations or settings were changed. This report is the only file this round adds.

---

## 1. What Budalerts is (verified on the site 2026-11-13)

Budalerts is a consumer price-alert site. Its home page says it checks dispensary menus and pings shoppers when a price drops or an item comes back in stock. It lists "Weedmaps + Leafly" as its menu sources, and the product images it shows are hosted on `product-assets.iheartjane.com` and `leafly-public.imgix.net`.

**The key finding: Budalerts prices are RETAIL shelf prices at dispensaries, not WHOLESALE vendor menus.** It is a different kind of source from Cultivera, GrowFlow, LeafLink and emailed menus. Those four answer "what can I buy from this vendor, and at what cost?" Budalerts answers "where is this brand on shelves in Washington, at what retail price, and how many stores carry it?" That is why section 4 adds it as a *retail market* layer beside the wholesale menus, not as a fifth wholesale menu.

### 1.1 Scale
| Item | Count (as seen) |
|---|---|
| Brands, all states (`/brands`) | 6,087 brands, 153,395 listings |
| Brand URLs in `sitemaps/brands-washington.xml` | 1,099 URLs = **541 distinct WA brand slugs** |
| URLs in `sitemaps/stores-washington.xml` | 236 URLs, 151 dispensary pages |
| Example brand: Phat Panda in WA | 744 in-stock listings, 12 dispensaries, lowest $10.00, "Checked 3 days ago" |

Kitsap and nearby dispensaries in the WA store sitemap:
- **Port Orchard:** Greenway Marijuana (us), Pot Zone.
- **Bremerton:** Fillabong, The Novel Tree, The Reef.
- **Gig Harbor:** Sweet Jane, The Gallery.

### 1.2 Page types and what each one gives us
All pages are rendered on the server. A plain HTTP GET with no JavaScript already has the data, so we need no browser and no login. A 21+ age overlay is client-side only and does not block the HTML.

**1. Brand index `/brands`.** Brand name, slug and listing count, A–Z. The complete list is in `sitemaps/brands.xml` (12,425 URLs) and, for Washington only, `sitemaps/brands-washington.xml`.

**2. Brand in a state `/brands/{slug}/washington`, plus `/brands/{slug}/washington/{category}`.**
- Header facts:
  - in-stock listing count
  - dispensary count
  - lowest listed price, and which product
  - "best deal vs. similar" %
  - "Checked N days ago"
  - per-state counts
  - per-category counts (Pre-Rolls 241, Flower 193, Vaporizers 185, Edibles 74, Concentrates 24, Accessories 2)
- The `<meta name="description">` repeats the counts in a steady sentence: "Compare 744 in-stock Phat Panda listings from 12 dispensaries in Washington."
- A schema.org `ItemList` JSON-LD block holds the 24 best-priced listings. Each listing has:
  - product name and Budalerts product URL
  - category
  - price in USD
  - availability (`InStock`)
  - seller (the dispensary name)
  - brand
  - image URL
- The visible card adds:
  - size ("1/4oz", "1oz")
  - $/g ("$4.23/g")
  - "NN% below similar listings"
- The page also links to "Strains from this brand".

**3. Product page `/products/{id}`.**
- JSON-LD `Product`: name, category, price, availability, seller, brand, image.
- Visible facts:
  - brand, category, weight, strain
  - dispensary name and street address
  - "Seen N days ago"
- No THC %, no COA and no description were shown.

**4. Dispensary page `/dispensaries/washington/{city}/{slug-id}`.** Name, address, in-stock count, a "View the menu on Weedmaps" link, and up to 24 best-priced listings.

**5. Strain, category and price pages:** `/strains`, `/cannabis/{category}/washington/{size}`.

### 1.3 Limits found (verified, not assumed)
- **24 listings per page, with no paging.** `?page=2`, `?offset=24` and `?sort=newest` all returned the same 24 products, and the canonical link drops the query. The per-category pages give different sets: for Phat Panda, all + flower + pre-rolls + vaporizers = **80 distinct products**.
  - **Exact listings:** a brand's full 744 are not reachable from public pages, only the best-priced slice per category.
  - **Totals:** the header counts are complete.
- **Coverage is uneven, and it grows from shoppers' alerts** (their own wording: "Our catalog grows from your alerts").
  - Greenway Marijuana and Pot Zone (Port Orchard) and The Reef (Bremerton) all show **0 in-stock listings** today.
  - Sweet Jane Gig Harbor shows 1,804.
  - The Phat Panda listings came mostly from The Herbery (Vancouver) and Fire Cannabis Co. (Yakima).
- **Freshness is days, not hours:** "Checked 3 days ago", "Seen 3 days ago".
- **Product sitemaps are mostly empty.** The index lists 3,976 `products-*.xml` files. A sample of 6 gave 0, 0, 0, 9, 0 and 0 URLs. Product discovery has to start from the brand and category pages.
- **The images are not Budalerts'.** They come from Jane and Leafly, and some "product" images are really the brand logo.

### 1.4 Rules of use (verified)
- **`robots.txt`:** `Allow: /`. `Disallow: /alerts, /favorites, /settings, /compare, /browse, /buy-again, /api/, /config.js`. So `/brands`, `/dispensaries`, `/products`, `/strains`, `/cannabis` and the sitemaps are open to polite crawling.
- **Terms of service:** `/terms` and `/privacy` render "Not Found", and I found no terms, about, contact or API link. **There is no published permission or license for reuse.**
- **There is no public API.** The page config exposes a private Convex backend URL (`budalerts-convex.fly.dev`). It is their app's backend, it is not offered for outside use, and `/api/` is disallowed. **We should not call it.**
- **Disclaimer on every page:** "Prices and stock come from public dispensary menus and can change at any time. Always confirm with the dispensary before you visit."

---

## 2. Code recon: where it would plug in

| Area | What exists today | Relevance |
|---|---|---|
| Vendor Menus page `src/app/admin/purchasing/menus/page.tsx` (810 lines) | "Find a vendor" (unified search), "Still need a menu", "Menus on file", "Emailed vendor menus" | Main place to show Budalerts facts per vendor |
| Unified search `unified-search-core.ts` / `unified-search.ts` | `ALL_PLATFORMS = ["cultivera","growflow","leaflink"]`, remembered in `vendor_platform_map` (migration 0125) | **Do not** add Budalerts here: it is not a place to buy from |
| Coverage `vendor-menu-coverage-core.ts` (1,658 lines) | `MenuSource = cultivera \| growflow \| leaflink \| email`. The "Still need a menu" table counts a vendor as covered once it has a usable wholesale menu | **Do not** add Budalerts as a MenuSource, or vendors would wrongly look "covered" |
| Vendor matching `buildVendorMatcher` (same file) | Snapshot link → WA license → name/DBA/legal/alias/brand identity. Ambiguous matches nothing (rule 3) | **Reuse it** to tie Budalerts brand names to our vendors |
| Link button `link-vendor-button.tsx` + `vendor-menu-link-store.ts` (alias `source_system = "menu"`) | A person links an unmatched menu name to a vendor | Same pattern for "link this Budalerts brand to a vendor" |
| Snapshot tables (e.g. `leaflink_menu_snapshots` / `leaflink_menu_items`, migration 0145) | Snapshot + items, money in integer minor units, a `raw jsonb` column so parsers can change without re-fetching | Template for `budalerts_brand_snapshots` / `budalerts_listings` |
| Market context: `po-market-context-core.ts`, `PoMarketContextCard.tsx`, `src/lib/discovery/*` (CCRS rollups, migration 0106, WSLCB competitor roster) | Already shows "retail price band" per PO line from state CCRS data, and already labels "retail vs wholesale = different bases" | Budalerts can add a **second, fresher, public** retail source next to CCRS, using the same honest labelling |
| Crawler service (`CRAWLER_BASE_URL`, `CRAWLER_SHARED_SECRET`, D219 hardening) | Long-running worker with timeouts, cancel and polite delays | Option for the refresh job. A plain server `fetch` also works, because the pages need no JavaScript |
| Media library (`media_assets.platform` check: cultivera/growflow/leaflink/email/website/upload/ai/other) | Provenance on every image | **Do not** import Budalerts images (they belong to Jane/Leafly/brands). Show them as links at most |

**Rough brand overlap (a hint only, not a match):** 60 of the 168 brand folders in our local back-office vendor database have exactly the same slug as a Budalerts WA brand. Examples: agro-couture, american-hash-makers, avitas, backpack-boyz, cookies, dabstract, dungeness-dank, fire-bros, hellavated, journeyman, phat-panda. Real matching will use the vendor matcher and people's links, not slugs.

---

## 3. What Budalerts adds that we don't have

1. **Who carries a vendor's products, and at what retail price, now (days old).** CCRS is monthly and arrives later.
2. **Local shelf check:** for Kitsap competitors that Budalerts covers (today: Sweet Jane Gig Harbor), what they charge for the same brand and size.
3. **Retail ÷ wholesale multiple, per item.** A wholesale item (LeafLink/Cultivera/GrowFlow) is shown with the retail listings of the *same* product name and size. The multiple is clearly labelled as two different bases, never as a margin promise.
4. **Brand reach:** number of WA dispensaries carrying it, and the category mix. This helps pick new vendors from "Still need a menu".
5. **Discovery:** WA brands on shelves that we don't carry yet (541 WA slugs compared with our vendor list).

---

## 4. Strategy

**Principle:** wholesale menus stay exactly as they are. Budalerts becomes a separate, clearly labelled **"Retail market (Budalerts)"** layer that the menu pages and the PO pages read from. It never changes a vendor's "has a menu" status, and it never writes into the KB, the media library or prices.

### Phase B0 — permission and fixtures (before any scheduled fetching)
- **Ask Budalerts for permission.** There are no terms and no API, so reuse rights are unclear. Ask whether they offer a feed or partner access, or are fine with a low-rate crawl. Until they answer, use only owner-clicked, on-demand fetches.
- **Save fixtures from this research.** The brand page, product page, robots.txt and WA slug list were saved to `/workspace/budalerts_fixtures/` in the research sandbox, outside the repo. Commit copies to the repo in B1 so the parser can be tested offline.

### Phase B1 — PURE parser + fetcher
**`src/lib/market/budalerts-core.ts` (pure, self-tested, registered in the runner).**
- `parseBrandPage(html)` → reads:
  - the JSON-LD `ItemList` (name, url, category, price → **minor units**, availability, seller, brand, image)
  - the meta description counts (listings, dispensaries)
  - the visible header facts (lowest price, best-deal %, checked-ago, state and category counts)
  - each card's size, $/g and "% below similar"
  - Any field it cannot read is left null, never guessed.
- `parseProductPage(html)` → brand, category, weight, strain, seller, address, seen-ago.
- `parseDispensaryPage(html)` → name, city, address, in-stock count, Weedmaps link, listings.
- `parseWaBrandSitemap(xml)` → WA slugs and their category URLs.
- A guard: refuse any URL outside `budalerts.com/{brands,products,dispensaries,strains,cannabis,sitemaps}`, so robots-disallowed paths are structurally impossible.

**`src/lib/market/budalerts-fetch.ts` (server).**
- One request at a time, at least 3 s between requests.
- 20 s timeout and a 2 MB cap per page.
- A clear User-Agent.
- Cached for 24 h.
- A brand refresh is one fetch for the brand page plus one per category page, about 4–7 requests.

### Phase B2 — storage (one migration, named columns, paged reads)
**`budalerts_brand_snapshots`** — one row per brand refresh:
- brand_slug, brand_name, state
- listing_count, dispensary_count
- lowest_price_minor, lowest_price_product, best_deal_pct
- checked_ago_text, category_counts jsonb, state_counts jsonb
- fetched_at, status, error, raw jsonb

**`budalerts_listings`** — the best-priced listings captured, one row each:
- snapshot_id, budalerts_product_id, name, brand, category
- size_label, price_minor, price_per_g_minor, below_similar_pct
- seller_name, seller_city, availability
- image_url (link only), product_url, position, raw jsonb

**`budalerts_brand_links`** — our vendor_id ↔ brand_slug:
- how (auto / person)
- linked_by, created_at
- unique on (brand_slug)

Linking uses `buildVendorMatcher`. An ambiguous name links nothing, and a person confirms it with the same link-vendor button pattern.

### Phase B3 — Vendor Menus page and snapshot pages (the visible win)
**On "Menus on file", "Still need a menu" and each vendor row, a small "Retail market" chip:**
- shows "on 12 WA shelves · from $10 · checked 3 days ago"
- has a "Refresh from Budalerts" button
- links to the source page

**On each wholesale menu snapshot page (LeafLink / Cultivera / GrowFlow / email), a new column "Retail seen":**
- It is filled only on an **exact** normalized match of name + size against that brand's captured listings.
- It shows the lowest retail price, the store and how many days old it is.
- A labelled retail ÷ wholesale multiple sits next to it.
- No match shows "—".

**A "Retail market" panel per vendor:** category mix, best-priced listings and the stores carrying them, with Kitsap stores flagged first.

**Wording everywhere:** "Retail prices from public dispensary menus via Budalerts. They can be days old. Confirm before acting."

### Phase B4 — PO builder and local competitors
- Add Budalerts as a second evidence row in `PoMarketContextCard` (CCRS stays first). It uses the same "different bases" rule already in `po-market-context-core.ts`.
- **Kitsap shelf watch:** refresh the dispensary pages of the WSLCB-rostered competitors Budalerts covers, and show their price for the brands we carry. Coverage of Port Orchard is 0 today, so the page must show honestly which stores have no data.

### Phase B5 — discovery and scheduled refresh (only after permission)
- "WA brands on shelves we don't carry yet": the 541 WA slugs minus the linked brands, sorted by dispensary count. Each row has an "Add as lead" link into the existing discovery leads.
- **Nightly refresh, only after B0 permission:**
  - only the linked brands
  - budget-capped (for example, at most 300 requests a night)
  - resumable
  - a 10-minute watchdog (D219 rules)

---

## 5. What we will NOT do
- Call Budalerts' private Convex backend, or any `/api/`, `/browse` or `/compare` path.
- Save their (Jane/Leafly/brand) images into our media library, or show them on our public site.
- Count Budalerts as a vendor menu, or let it hide a vendor from "Still need a menu".
- Change our own prices, PO quantities or KB facts automatically from Budalerts.
- Fuzzy-match products. A near miss shows "—".

## 6. Open questions for the owner
1. Should we email Budalerts to ask for permission or a feed before any scheduled refresh? My recommendation is yes. On-demand clicks could ship first.
2. Do you want the retail ÷ wholesale multiple shown on the wholesale menu pages, or only on the PO builder?
3. Should Kitsap competitors be the default focus, with statewide shown second?
4. Should Greenway's own Budalerts listing be checked? It shows 0 listings today, and its "View the menu on Weedmaps" link points at our Weedmaps menu.

## 7. Suggested order of work
D225 = B0 + B1 + B2 (parser, fixtures, tables, on-demand refresh button). D226 = B3. D227 = B4. D228 = B5, after permission.

Standing rules for every phase:
- record the request verbatim
- PURE `*-core.ts` with self-tests
- tsc 0 / eslint 0
- named columns
- paged reads
- push often
- do not merge until the owner says so
