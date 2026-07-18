# Roadmap — Cultivera Vendor Menus Command Center (CV-1 .. CV-6)

> Standing rules honored throughout: request recorded VERBATIM; never guess —
> every endpoint, field name, and contract below was verified against the live
> Cultivera app bundle, real probes, or this repo's own code; ONE slice per PR;
> money in minor units (integer cents, never floats); migrations applied
> MANUALLY by the owner in the Supabase SQL editor; every pure core carries
> embedded self-tests registered in `scripts/compliance/run-pure-selftests.ts`
> (import AND call) plus a vitest mirror in `tests/compliance/`.

## Owner's request (verbatim)

> "Thank you. I haven't gotten the credentials yet, let's build slice 2-6 now
> and then report back with what's been done and what is left still to build.
> Follow the standing rules and never guess. Deep research the internet if you
> need to. Go slow and make sure you get everything done properly and correct.
> Thank you."

Context: the owner is an **authenticated Cultivera POS / Cultivera Market
buyer** whose rep blessed pulling vendor menus into the back office this way.
The feature logs into Cultivera's marketplace (`https://wa.cultiveramarket.com/`)
with the owner's OWN credentials, searches vendors, fetches a vendor's LIVE
menu (products, descriptions, images, COA/potency, logos), lets the buyer
browse + select items for the purchase-order builder, and saves ALL collected
media to the media library with tags/labels. **Polite mode, NOT stealth** —
slow, human-paced requests, one login cached and reused.

## Verified Cultivera facts (from the live app bundle + unauthenticated probes)

- App is an Angular SPA at `https://wa.cultiveramarket.com/` (region-specific).
- API base `https://api-p85k4etz.cultiveramarket.com/` (auto-sniffed at runtime;
  overridable via `CULTIVERA_API_BASE`).
- Auth: `POST auth/login` → JWT via `Authorization` + `x-refresh-token`
  headers; the SPA stores `accessToken` / `hasAccess` / `locationId` in
  localStorage. `GET business/get-business-details-by-token` bootstraps the
  session. No 2FA/MFA/captcha observed.
- All data endpoints return 401 without a token. Candidate paths observed in
  the bundle: `markets/available`, `markets/connected`, `markets/slug/{slug}`,
  `listings/market/{...}`, `public/listings/market/{...}`,
  `markets/featured-listings`, `manage/buyer/profile`, `business/my-locations`.
- **Pinning rule (never guess):** exact response field names CANNOT be trusted
  until a real authenticated probe runs with the owner's credentials. Every
  parser therefore normalizes DEFENSIVELY (tolerant of shape), and the crawler
  returns the RAW payload alongside its tolerant record extraction so the
  field names can be pinned later without re-fetching.

---

## CV-1 — Data model + pure normalizer core  [SHIPPED — PR #575, main `8d1ccca4`]

- `supabase/migrations/0124_cultivera_menus.sql` — two tables, money in cents:
  - `cultivera_menu_snapshots` — ONE row per fetch of one vendor's menu:
    provenance (market id/slug, seller name, fetched_by/at), optional
    `vendor_id → public.vendors` link, status, item_count, RAW payload jsonb.
  - `cultivera_menu_items` — one row per menu line: name, brand, category,
    inventory/strain type, size_label, unit_count, `wholesale_price_minor`
    (integer cents), available_qty, thc/cbd/total pct, potency_raw jsonb,
    description, image_url, coa_url, `media_asset_id` / `coa_media_asset_id`
    links, RAW jsonb, position.
  - **⚠ Owner action: this migration is still to be run manually in the
    Supabase SQL editor.**
- `src/lib/purchasing/cultivera-menu-core.ts` — pure, tolerant normalizers
  (raw payload → snapshot/item shapes) with embedded self-tests.
- `src/lib/purchasing/cultivera-store.ts` — persistence helpers
  (`saveSnapshot`, `getSnapshot`, `getSnapshotItems`, `linkItemMedia`, …).
- Registered in the pure runner + vitest mirror
  `tests/compliance/cultivera-menu-core.test.ts`.

## CV-2 — Crawler auth + polite API client  [SHIPPED — PR #576, main `779edf22`]

- `crawler/app/config.py` — `CULTIVERA_*` settings + derived props
  (`cultivera_enabled` / site / api / session_path).
- `crawler/app/cultivera_auth.py` — Playwright login ONCE with the owner's
  credentials, captures tokens from localStorage, persists the session file,
  proactive re-login when stale and forced re-login on 401. Pure helpers:
  `decode_jwt_exp`, `session_from_local_storage`, `is_session_stale`,
  `auth_headers`, `sniff_api_base`, `resolve_api_base`.
- `crawler/app/cultivera_api.py` — polite JSON client (market search /
  by-slug + one-vendor menu): `polite_delay_seconds` (jittered pause BEFORE
  every authenticated request), `join_url`, tolerant `extract_records`,
  `matches_query`, single re-login retry on 401, candidate-path fallback, and
  RAW json returned for downstream normalizers — field names never guessed.
- `crawler/.env.example` — labeled `CULTIVERA_*` block (see "What the owner
  still needs to do" below); session file lives under gitignored `.cache/`.
- 38 pure-logic pytest tests (no network, no browser).

## CV-3 — Crawler endpoints + Next client  [SHIPPED — PR #577, main `f5181a2b`]

- `crawler/app/main.py` — `POST /cultivera/markets` + `POST /cultivera/menu`:
  `X-Crawler-Secret` auth, 503 when credentials are absent, 422 on missing
  id/slug, 502 on login failure; returns RAW payload + tolerant records.
  Persistence deliberately stays in Next's `cultivera-store.ts`.
- `src/lib/purchasing/cultivera-client.ts` — mirrors `crawler-client.ts`:
  same `CRAWLER_BASE_URL` / `CRAWLER_SHARED_SECRET` env pair, tunnel-safe
  timeouts, and graceful `configured:false` degradation when the worker
  answers 503 (so the UI can explain instead of erroring).
- 9 TestClient tests with a fake CultiveraClient (no network).

## CV-4 — Command center page  [SHIPPED — PR #578, main `27d9f8fc`]

- `/admin/purchasing/menus` — vendor search against the crawler, "fetch live
  menu" action (saves a snapshot + audit event), list of saved snapshots.
- `/admin/purchasing/menus/[id]` — the snapshot browser: product grid with
  image, name, brand, category, size, strain, potency badge, description,
  wholesale price (cents, formatted), availability, and a COA link; URL-driven
  search + category filters (GET form, pure server component).
- Purchasing header link + help panel; pure UI core
  `cultivera-menus-ui-core.ts` (44 self-tests) + vitest mirror (20 tests).

## CV-5 — Save to media library  [SHIPPED — PR #579, main `daf830a5`]

- Per-item "Save image" / "Save COA" buttons + snapshot-wide bulk save
  (chunked, `BULK_MEDIA_LIMIT = 20` per run so a big menu can't blow the
  action timeout; the button shows what's left and is re-run to completion).
- `src/lib/purchasing/cultivera-media-core.ts` — pure planner/labels
  (39 self-tests): `planMediaSaves`, `remainingMediaCount`, `isHttpUrl`,
  `vendorTag`, `cultiveraMediaTags` ("cultivera" + kind + vendor kebab tag),
  `mediaTitleForItem`, `mediaAltForItem`, `bulkSaveSummary`.
- `src/lib/media/harvest.ts` — new `importDocumentFromUrl` (PDF-only, 10 MB
  cap, same rails as `importImageFromUrl`: http(s)-only, forbidden-host guard,
  timeout, sha256 dedupe, draft status, `crawl:<url>` provenance, license
  pending-review). Images reuse `importImageFromUrl` unchanged.
- Saved assets link back to their menu item (`media_asset_id` /
  `coa_media_asset_id`) and record a `media_usages` row, so the browser shows
  "image in library" / "COA in library" badges instead of duplicate saves.

## CV-6 — PO hand-off  [SHIPPED — PR #580, main `4b0bcfa9`]

- Snapshot browser: each product card gets a checkbox; the grid is a GET form
  posting to `/admin/purchasing/new` with `fromMenu=<snapshotId>` plus one
  `item=<id>` per ticked card — **IDs ONLY in the URL (W11: never trust a raw
  URL param)**. The builder page reloads the snapshot + items from OUR OWN
  database, honors only ids that exist in that snapshot, and accepts the
  snapshot's `vendor_id` only when it matches a real vendor record.
- `src/lib/purchasing/cultivera-po-core.ts` — pure mapper (44 self-tests):
  `parseMenuItemIds` (single/repeated/CSV params, trim, dedupe, cap 60),
  `menuItemDisplayName` (size-aware), `prefillCostMinor` (cents clamp),
  `menuItemToPoPrefill` (qty 1 draft line, unit "each", no POS identity),
  `buildMenuPrefills` (menu order kept, unknown ids ignored),
  `menuPrefillBanner`. Vitest mirror: 11 tests.
- `BuilderTable` gained a `menuPrefills` prop: menu lines are namespaced
  (`menu:<i>:` keys), pinned to the top, pre-selected, survive quick-select
  presets (except explicit "None"), show a "from menu" badge, and auto-pick
  the verified vendor. The existing single-lead Discovery prefill and the
  contract-critical hidden `lines` JSON field are unchanged.

---

## What the owner still needs to do (everything else is merged)

1. **Run migration `supabase/migrations/0124_cultivera_menus.sql`** manually
   in the Supabase SQL editor (outstanding since CV-1 — nothing Cultivera can
   persist until this exists).
2. **Crawler worker env (`crawler/.env`):** set `CULTIVERA_EMAIL` +
   `CULTIVERA_PASSWORD` (your own marketplace login — NOT an API key).
   Optional tuning already documented in `crawler/.env.example`:
   `CULTIVERA_SITE_URL` (default `https://wa.cultiveramarket.com`),
   `CULTIVERA_API_BASE` (empty = auto-detect), `CULTIVERA_MIN_DELAY_SECONDS`
   (default 3, jittered), `CULTIVERA_SESSION_TTL_SECONDS` (default 2700),
   `CULTIVERA_SESSION_FILE` (default `.cache/cultivera_session.json`).
3. **Site env:** `CRAWLER_BASE_URL` + `CRAWLER_SHARED_SECRET` must point the
   Next app at the running crawler worker (same pair the existing crawler
   features use; the Vendor Menus page degrades gracefully until then).

## Deferred until credentials arrive (by design — never guess)

- **Pin the real response shapes.** Once `CULTIVERA_EMAIL`/`PASSWORD` exist,
  run one live authenticated probe, capture the RAW payloads the endpoints
  actually return, and pin exact endpoint paths + field names in
  `cultivera_api.py` / `cultivera-menu-core.ts`. Until then the tolerant
  candidate-path fallback + defensive normalizers carry the load, and every
  snapshot keeps its RAW jsonb so nothing has to be re-fetched to re-parse.
- **`next/image` allow-listing** for Cultivera's CDN domains (unknowable until
  real image URLs are seen); the snapshot browser intentionally uses plain
  `<img>` until then, matching the media-library detail page pattern.

## Merge history

| Slice | PR | Squash commit | Verification at merge |
| ----- | -- | ------------- | --------------------- |
| CV-1 | #575 | `8d1ccca4` | pure runner PASS, tsc 0, eslint clean, vitest 1801 |
| CV-2 | #576 | `779edf22` | 38 new pytest, crawler suite 266 pass, ruff clean |
| CV-3 | #577 | `f5181a2b` | crawler 275 pass, tsc 0, vitest 1801 |
| CV-4 | #578 | `27d9f8fc` | pure runner green, vitest 1821, crawler 275 |
| CV-5 | #579 | `daf830a5` | pure runner green (media-core 39), vitest 1832, crawler 275 |
| CV-6 | #580 | `4b0bcfa9` | pure runner green (po-core 44), vitest 1843, crawler 275 |
