# Roadmap — GrowFlow + Unified Smart Vendor Menus (GF-1 .. GF-6)

> Standing rules honored throughout: never guess — every endpoint, GraphQL
> operation, and field name below was pinned by LIVE authenticated probes of
> the real marketplaces (owner's own buyer account, license 413541) or
> verified against this repo's own code; ONE slice per PR; money in minor
> units (integer cents, never floats); migrations applied MANUALLY by the
> owner in the Supabase SQL editor; every pure core carries embedded
> self-tests registered in `scripts/compliance/run-pure-selftests.ts` (import
> AND call) plus a vitest mirror in `tests/compliance/`. Credentials were used
> transiently for live probing only and are NEVER stored in the repo; the
> owner rotates them afterwards.

## What this feature is

The Vendor Menus command center (`/admin/purchasing/menus`) now speaks to
**two** wholesale marketplaces the owner buys from as an authenticated buyer:

- **Cultivera Market** (`wa.cultiveramarket.com`) — shipped in CV-1..CV-6
  (`docs/ROADMAP_CULTIVERA_VENDOR_MENUS.md`).
- **GrowFlow Marketplace** (`marketplace.growflow.com`) — added here.

One single search box searches BOTH platforms **sequentially and
intelligently**: the platform this vendor was last found on is searched
FIRST, and the other platform is only queried when the first finds nothing —
halving marketplace traffic while keeping results complete. A per-vendor
**smart memory** (`vendor_platform_map`) records where each vendor's menu was
last confirmed (bumping recency + hit count on every successful fetch), every
result carries a platform badge (green = Cultivera, gold = GrowFlow, orange
"locked" when a GrowFlow store restricts access), and fetched menus become
point-in-time snapshots the buyer can browse, filter, save media from, and
hand off to the purchase-order builder — identically on both platforms.

## Verified GrowFlow facts (LIVE authenticated probes)

- React/Vite SPA at `https://marketplace.growflow.com`; login is
  **Auth0-hosted** (`auth.growflow.com/u/login`), single email+password form,
  no 2FA/captcha observed for this account.
- Single **GraphQL** endpoint (discovered from the running app at runtime;
  `GROWFLOW_GRAPHQL_URL` can pin it explicitly). Requests carry
  `Authorization: Bearer <Auth0 JWT>`; the token lives in app memory (not
  localStorage), so the crawler drives the real login with Playwright and
  **intercepts** the Bearer token from the SPA's first GraphQL request, then
  reuses it (cached session, proactive TTL re-login, forced re-login on 401).
- Buyer context: op `getStoreFrontUserVendorsV2` → Greenway Marijuana =
  **BuyerVendorId 2368**, license **413541** (auto-detected at runtime;
  `GROWFLOW_BUYER_VENDOR_ID` can override).
- Vendor list: op `getStoreFrontsV2` (state WA + buyer id) → ~235 stores with
  verified keys `Id, Name, LicenseNumber, City, AccessStatus
  (Unlocked/Locked), LogoUrl, …`. Search is client-side over Name in the SPA,
  so the worker filters by name/license itself.
- Menu: op `getStoreListingV2` for one `storeFrontId` → the bare
  `getStoreListing { listings[], products[] }` node. Products carry `Id,
  Name, Description, Price, DefaultPrice, MSRP` (**dollar floats — converted
  to integer cents at the boundary, nothing downstream touches a float**),
  quantity/potency fields, and image URLs on
  `growflowweb.blob.core.windows.net` (Azure blob, public https). **The menu
  payload carries NO store identity**, so callers thread
  storeId/storeName/license from the search hit into the snapshot.
- Polite mode, NOT stealth: jittered `GROWFLOW_MIN_DELAY_SECONDS` pause
  before every authenticated request; one login cached and reused.

---

## GF-1 — Data model + pinned normalizers  [SHIPPED — PR #583, main `d5f1e330`]

- `supabase/migrations/0125_growflow_menus.sql` — money in cents:
  - `vendor_platform_map` — the smart-search memory: one row per
    (normalized vendor-name key, platform) pair with the platform's
    store/market ref + slug, license when known, optional
    `vendor_id → public.vendors` link, `last_seen_at` recency and a
    `hit_count` bumped on every confirmed menu fetch.
  - `growflow_menu_snapshots` — one row per fetch of one store's menu:
    provenance (`growflow_store_id`, `growflow_vendor_id`, `store_name`,
    `license_number`, `buyer_vendor_id`, fetched_by/at), optional
    `vendor_id → public.vendors` link, status, item_count, RAW payload jsonb.
  - `growflow_menu_items` — one row per product, mirroring 0124's
    `cultivera_menu_items` plus `msrp_minor`: name/brand/category, size,
    `wholesale_price_minor` + `msrp_minor` (integer cents), potency fields +
    potency_raw jsonb, description, image_url, coa_url,
    `media_asset_id`/`coa_media_asset_id` links, RAW jsonb, position.
  - **⚠ Owner action: run 0125 manually in the Supabase SQL editor if not
    already applied** (0124 shipped with CV-1 and must be applied first).
- `growflow-menu-core.ts` — pure normalizers pinned to the LIVE-probed shapes
  (dollar floats → integer cents, tolerant key fallbacks), self-tested.
- Cultivera product-list detail shape pinned into `cultivera-menu-core.ts`
  from the live probe (`MinPrice` → cents, `ImageUrl`, `IsDOHComplaint`, …)
  with the tolerant multi-key getters kept as a safety net.

## GF-2 — Crawler GrowFlow auth (Auth0 via Playwright)  [SHIPPED — PR #584, main `2ed7a4e5`]

- `crawler/growflow_auth.py` — Playwright login to the Auth0 form, intercepts
  the Bearer token from the SPA's first authenticated GraphQL request, caches
  the session under `.cache/growflow_session.json` (gitignored — contains a
  live token, never committed), trusts it for `GROWFLOW_SESSION_TTL_SECONDS`,
  re-logs-in proactively on staleness and always on 401. Mirrors
  `cultivera_auth.py`.
- New labeled env slots in `crawler/.env.example` (empty by default so every
  GrowFlow feature stays cleanly disabled until the owner opts in) — see the
  owner guide at the bottom of this doc.
- Pure helpers (token capture, session-file round-trip, staleness) + 33
  pytests.

## GF-3 — Crawler GraphQL client + worker endpoints  [SHIPPED — PR #585, main `edadb40a`]

- `crawler/growflow_api.py` — `getStoreFrontsV2` (vendor list, name/license
  filtering worker-side) and `getStoreListingV2` (one store's menu), polite
  jittered delay before each call, tolerant record extraction alongside the
  RAW payload (so field names can be re-pinned later without re-fetching).
- Worker endpoints: `POST /growflow/stores` (body `{query}`) and
  `POST /growflow/menu` (body `{store_front_id}`) — both return
  `{ok, url, status, raw, records, count, error}`, and 503 with a clear
  reason when the GrowFlow env is missing.
- `src/lib/purchasing/growflow-client.ts` — Next-side client behind the SAME
  `CRAWLER_BASE_URL` + `CRAWLER_SHARED_SECRET` pair as every other crawler
  feature; degrades to `configured:false` (setup hint in the UI, never a
  crash). 26 new pytests; crawler suite 334.

## GF-4 — Unified smart-search backend + platform memory  [SHIPPED — PR #586, main `5794ec9b`]

- `unified-search-core.ts` (pure, self-tested): `normalizeVendorKey`
  (lowercase/trim/collapse — punctuation KEPT, so "B&B Farms" ≠ "BB Farms"),
  `choosePreferredPlatform` (most recent `last_seen_at` wins, `hit_count`
  breaks ties), `searchOrder` (preferred platform first; default Cultivera
  first), platform-tagged `UnifiedVendorHit` mappers (GrowFlow hits carry
  `locked` from the store's `AccessStatus`), and `buildMemoryUpsert` for the
  post-fetch memory write.
- `vendor-platform-store.ts` — `rememberPlatform` (upsert bumping
  recency/hit_count) + lookup over `vendor_platform_map`, service-role
  guarded, degrades to null.
- `unified-search.ts` — `unifiedVendorSearch(query)`: sequential search
  honoring the memory; the second platform is only queried when the first
  found nothing.

## GF-5 — Unified menus UI (one search box, platform badges)  [SHIPPED — PR #587, main `03270255`]

- `vendor-search.tsx` rewritten as the unified island: ONE input →
  `unifiedVendorSearchAction`; results table shows Vendor · Platform badge
  (green Cultivera / gold GrowFlow via `platformTone`, orange "locked" badge
  for restricted GrowFlow stores) · License/City · Fetch menu. Fetching
  routes per platform and lands on the right snapshot page.
- `growflow-store.ts` — snapshot/item persistence mirroring
  `cultivera-store.ts` (normalize → header insert → bulk item insert, error
  rollback, `linkGrowflowItemMedia`).
- New actions: `unifiedVendorSearchAction` and `fetchGrowflowMenuAction`
  (worker fetch → `saveGrowflowSnapshot` → memory write → audit
  `growflow.menu.fetched` → revalidate); `fetchCultiveraMenuAction` now also
  writes the platform memory.
- `menus/page.tsx` rewritten as the unified command center:
  both platforms' snapshots merged newest-first (`mergeSnapshotRows`) into
  one table with platform badges; KPIs via platform-scoped
  `distinctVendorCount`.
- New GrowFlow snapshot browser `/admin/purchasing/menus/growflow/[id]`
  reusing the STRUCTURAL display helpers from `cultivera-menus-ui-core`
  (priceLabel from cents, potencyLabel, filters, agoLabel) over GrowFlow
  rows, plus MSRP line and COA link.
- `unified-menus-ui-core.ts` (pure) registered in the runner + vitest mirror.

## GF-6 — GrowFlow media saves + PO hand-off parity  [SHIPPED — PR #588, main `468b3468`]

- `growflow-media-core.ts` (pure, 15 self-tests + vitest mirror):
  `growflowMediaTags` (["growflow", "product-image"|"coa", vendor-kebab]),
  `growflowMediaTitleForItem` ("Blue Dream — Acme (GrowFlow)"),
  `growflowMediaAltForItem`, `growflowMenuPrefillBanner`. The planning
  machinery (`planMediaSaves`, `remainingMediaCount`, `isHttpUrl`,
  `bulkSaveSummary`) is STRUCTURAL in `cultivera-media-core` and reused as-is
  over GrowFlow rows — same for the PO mappers in `cultivera-po-core`
  (`parseMenuItemIds`, `buildMenuPrefills` over `MenuPrefillItemLike`).
- `growflow-media.ts` — `saveGrowflowItemMedia` mirrors
  `cultivera-media.ts`: `importImageFromUrl` / `importDocumentFromUrl`
  harvest rails (http(s)-only, size caps, MIME checks, sha256 dedupe, drafts
  with license pending review; GrowFlow's Azure-blob hosts are public https),
  `recordUsage` entity `growflow_menu_item`, `linkGrowflowItemMedia`
  back-link, dedupe short-circuit when already linked.
- `menus/actions.ts`: `saveGrowflowItemMediaAction` +
  `saveAllGrowflowSnapshotMediaAction` (inventory.manage, chunked
  `BULK_MEDIA_LIMIT`=20 runs, audits `growflow.media.saved` /
  `growflow.media.bulk_saved`, revalidates
  `/admin/purchasing/menus/growflow/[id]`).
- GrowFlow snapshot browser: media banner + "Save all to library" + per-item
  Save image / Save COA buttons with "in library" badges (new
  `media-buttons.tsx` island), and the PO checkbox form — GET to
  `/admin/purchasing/new` with `fromGrowflowMenu=<snapshotId>` + `item=<id>`
  checkboxes (the URL carries IDS ONLY — W11: never trust raw URL params).
- PO builder (`purchasing/new/page.tsx`): honors `fromGrowflowMenu` exactly
  like CV-6's `fromMenu` — reloads every line from OUR saved growflow
  snapshot rows via the shared structural `buildMenuPrefills`, verifies
  `vendor_id` against the real vendors list, vendor label from
  `store_name ?? license_number`, GrowFlow-branded banner, lines threaded
  into the Port Orchard market check and the BuilderTable prefills.

---

## Owner setup — APPEND to your EXISTING .env files (never replace them)

Your current `.env` files are working — do **NOT** recreate or overwrite
them. Open each file and append ONLY the lines you're missing. Everything
stays dormant (graceful "not configured" hints, never a crash) until these
values exist.

### 1. Crawler worker — append to your existing `crawler/.env`

Only the two credentials are required; everything else has safe defaults:

```bash
# --- GrowFlow marketplace ---
GROWFLOW_EMAIL=your-growflow-login-email
GROWFLOW_PASSWORD=your-growflow-password
```

Optional overrides (defaults shown — omit unless you need to change them):

```bash
GROWFLOW_SITE_URL=https://marketplace.growflow.com
GROWFLOW_GRAPHQL_URL=          # empty = auto-detect from the app
GROWFLOW_STATE=WA
GROWFLOW_BUYER_VENDOR_ID=      # empty = auto-detect (Greenway = 2368)
GROWFLOW_MIN_DELAY_SECONDS=3
GROWFLOW_SESSION_TTL_SECONDS=2700
GROWFLOW_SESSION_FILE=.cache/growflow_session.json
```

Then restart the crawler worker so it picks the new variables up. Since the
probe-session password is being rotated, put the NEW password here.

### 2. Site (Next app) — verify, likely nothing to add

The GrowFlow client reuses the SAME two variables the Cultivera vendor-menus
feature already uses:

```bash
CRAWLER_BASE_URL=       # e.g. http://localhost:8200 or your worker's URL
CRAWLER_SHARED_SECRET=  # must match the worker's CRAWLER_SHARED_SECRET
```

If Cultivera menus already work in your deployment, these are already set and
**no site-side change is needed**. If not, append those two lines to the
site's existing env (Vercel project settings or `.env.local`) — again,
append, never replace.

### 3. Database migration (if not yet applied)

Run `supabase/migrations/0125_growflow_menus.sql` manually in the Supabase
SQL editor (creates `vendor_platform_map`, `growflow_menu_snapshots`,
`growflow_menu_items`). `0124_cultivera_menus.sql` must already be applied.

## Deferred by design

- **`next/image` allow-listing** for `growflowweb.blob.core.windows.net` and
  Cultivera's CDN — both snapshot browsers intentionally use plain `<img>`
  (media-library detail page pattern) until the owner wants the domains
  pinned in `next.config`.
- **Credential rotation** — the owner rotates the marketplace passwords used
  during probing; the new values only ever live in the crawler's local
  `.env` (gitignored), never in the repo.

## Merge history

| Slice | PR | Squash commit | Verification at merge |
| ----- | -- | ------------- | --------------------- |
| GF-1 | #583 | `d5f1e330` | pure runner PASS, tsc 0, eslint clean, vitest green |
| GF-2 | #584 | `2ed7a4e5` | crawler pytest 308, pure ALL PASS, tsc 0 |
| GF-3 | #585 | `edadb40a` | crawler 334, vitest 1843, pure ALL PASS, tsc 0, eslint clean |
| GF-4 | #586 | `5794ec9b` | tsc 0, pure ALL PASS, eslint clean, vitest 1843/141, pytest 334 |
| GF-5 | #587 | `03270255` | tsc 0, pure ALL PASS, eslint clean, vitest 1851/142, pytest 334 |
| GF-6 | #588 | `468b3468` | tsc 0, pure ALL PASS (growflow-media-core 15), eslint clean, vitest 1864/143, pytest 334 |
