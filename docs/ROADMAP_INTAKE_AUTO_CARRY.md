# Roadmap — Intake auto-carry to the menu (Option B, NOT auto-published)

Owner enhancement: products received via the **new receiving/intake system** must
reach the customer-facing website menu **and** be sellable in the front-side POS
**without** relying on the one-time Cultivera "Menu Imports" (POS-export) upload.
The Menu Imports page is a **one-time** tool for importing existing Cultivera CCRS
inventory; it will be thrown away after that single use. After that, ALL products
come in via receiving and must go straight to the website + POS as sellable.

> Standing rules (binding): record requests verbatim; never guess (verify by
> reading code); ONE slice per PR; drafts-only (human validates; machine output
> never auto-live); migrations applied MANUALLY by the owner (code must be
> no-op-safe pre-migration); money in MINOR UNITS (cents); `rm -rf .next
> tsconfig.tsbuildinfo` after every build; do NOT cut corners.

---

## Owner requests (VERBATIM)

> "the next thing I need your help with is the menu. are products brought into the
> system via receiving being added to the customer facing website menu? the enrich
> page says, no published menu yet, import and publish a menu in the menu upload
> page. the menu upload page is specifically used for a one time transfer in of my
> ccrs inventory from cultivera. after that, all products will be transferred in via
> my new system, and then added to the customer facing site as well as the ability
> to sell them on the front side pos. will you please … dig into the code to see if
> products received are able to be added to the online menu and sellable in the pos.
> please proceed, follow all standing rules, never guess and do not cut corners."

> "I like option b better, but not auto published, just auto carry on accept. for
> the second thing to confirm, the price and stock, I don't understand what you mean.
> are you referring to the one time inventory import from cultivera? that inventory
> list will have the quantity and price attached to them already and should be used
> for those items. every other item that we ever receive after that one time import,
> will use the data from the invoices and manifests and transfer logs and coa etc.
> the menu import page will be thrown away after its one time use is up. so I don't
> want to rely on a fake menu upload to get my products sellable. if that makes it
> clear for you about that issue, then please proceed with the building this
> enhancement. please finish all slices one slice at a time until all are complete,
> then report back to me with a status report. please proceed, follow the standing
> rules and never guess, do not cut corners. thank you."

> "sorry to stop you. I wanted to tell you definitively that the pos key or what ever
> you are talking about, is the lot number for that product. cultivera does have its
> own internal pos id value, but you are seeing that logic because cultiver splits
> their inventory data into two spreadsheets, with the only column that matches the
> two together is the pos key (lot #). every product has a lot number, even the ones
> on the manifest examples I have uploaded earlier. so if you are trying to figure out
> how the menu import products relate to the new ones or something like that, the
> products from the menu import are the same types of products that we have been
> working on the receiving page. they will have a product name that is very similar to
> the naming convention our new system uses. it has vendor and brand and qty and price
> and coa values and type and category and purchase date sold qty, everything. its all
> the same type of data. we arent trying to mesh some old random data to new different
> data. we are just cleaning up cultivera's mess. they are just terrible and our
> inventory has become a nightmare. so I built a solution that is far better than
> cultivera. anyways, please proceed with this new info. if you need to reference the
> menu import tables, they should be in root named PRODUCTS.xlsx and INVENTORIES.xlsx."

---

## Verified findings (read the code — no guessing)

- Customer website menu reads EXACTLY ONE `published` `menu_versions` row
  (`src/lib/pos/live-menu.ts`, per migration 0002). No published version / zero
  items → empty menu.
- Front POS/checkout SELLS from that same published version —
  `src/lib/orders/order-pricing.ts` reprices every order line server-side against
  `loadLiveMenuAll()`. So **"sellable in POS" == "on the published menu version."**
- A `menu_versions` row is CREATED only by a POS-export upload
  (`runImport` in `src/lib/pos/import-service.ts`). Publish is separate/gated
  (`publishMenuVersion` → `publish_menu_version()` RPC, atomic swap).
- **Existing bridge (W7 Decision B):** `runImport` calls
  `injectApprovedDraftsIntoVersion(version.id, posImport.id)` — appends APPROVED
  onboarding drafts (`catalog_product_drafts` status='approved') into the freshly
  STAGED version. **THE GAP:** this ONLY fires during a POS-export import; there is
  no path today to stage/publish a menu version from accepted intake ALONE.
- `menu_versions.import_id` is **NULLABLE** (migration 0002 line 79:
  `references pos_imports(id) on delete set null`). An intake-origin version with
  no POS import is legal — **NO migration needed.** `summary_json jsonb` + `notes
  text` exist for origin metadata (no schema change).
- `publishMenuVersion(versionId, actorId)` works purely off version id (no import
  required). `publish_menu_version()` guards `if v_import is not null` — publishing
  an intake-origin version is safe. (Note: the "archive sibling staged versions"
  step is inside that guard, so publishing an intake version won't archive other
  staged POS versions; acceptable — staged versions are drafts, not live.)
- **The pure planner already exists and is exactly what we need:**
  `buildDraftInjectionPlan(inputs)` in `src/lib/pos/draft-injection-core.ts`
  produces `{items, diagnostics}` keyed on `pos_product_key` (= LOT NUMBER, per
  owner), requires a positive `price_minor_units`, skips unmapped categories,
  emits a diagnostic for every decision. It is source-agnostic — it does not care
  whether the target version came from a POS import or from intake.
- `finalizeManifestDispositions` (`src/lib/inventory/intake-store.ts` ~line 618)
  is the ONLY activation path. When `activated > 0` it runs a best-effort chain:
  `seedDraftsForManifest` → `archiveCoasForManifest` → `promoteManifestToKb` →
  `rememberVendorUsualTransport` → `seedIncomingSampleEvents` →
  `autoReceiveManifestPo`. The new auto-carry step slots into this same chain.
- `seedDraftsForManifest` seeds drafts as `status='draft'` (NOT approved).
  `approveDraftWithPrice(draftId, priceMinor, actorId)` sets the price + flips to
  `status='approved'`. So auto-carry only ever carries HUMAN-APPROVED, PRICED
  products — price comes from intake (owner sets it at approval), stock/on-hand
  from `inventory_lots.on_hand_qty` (= received_qty). This matches the owner
  exactly: no fake menu upload; human still presses Publish.
- **Menu Imports UI gap:** both `/admin/menu-imports` and its `[id]` review page
  are keyed on a `pos_imports` row (`getImport(id)` → notFound if missing; version
  found via `import_id === id`). An intake-origin version (import_id NULL, no
  pos_imports row) can NOT be reviewed/published there. A separate surface is
  required.
- **Reference workbooks confirmed** (`back-office/GREENWAY WEBSITE/transformer/
  inputs/PRODUCTS.xlsx` + `INVENTORIES.xlsx`): PRODUCTS = product catalog (name,
  type, category, brand, strain, price, description). INVENTORIES = per-lot
  (Id=Cultivera internal POS id, Alias=WA lot barcode, Product name join, price,
  cost, units available/in stock, COA flags, potency, qty sold/purchased, received
  date). Same shape as the new intake system — confirms no old-vs-new data mesh.

---

## Design (Option B — auto-carry on accept, NOT auto-published)

When a manifest is accepted (lots activated + approved drafts exist for it), the
approved onboarding products are **auto-staged into an intake-origin
`menu_versions` row** (import_id = NULL, `summary_json.origin = "intake"`). The
human then reviews that staged version and presses **Publish** (unchanged gate).
NO POS-export upload is required to carry intake products to the menu/POS.

The one-time Cultivera import keeps using its own workbook qty/price (unchanged).

---

## Slice plan (ONE slice per PR)

- [x] **Slice A1 — PURE staging core.** `src/lib/pos/intake-menu-staging-core.ts`:
      pure planner `buildIntakeStagedVersionPlan(inputs)` deciding whether an
      intake accept has anything to stage, dedupe/carry-forward the current
      published menu items so a NEW staged version is a full snapshot (published
      items + newly approved intake items), and reuse `buildDraftInjectionPlan`
      for the approved-draft rows. Embedded self-tests + vitest wrapper.
- [x] **Slice A2 — server executor.** `src/lib/pos/intake-menu-staging.ts`:
      `stageIntakeMenuVersionForManifest(manifestId, actorId)` — reads published
      version items (carry-forward) + approved drafts for the manifest, gathers
      enrichment (reuse the resolver/kb/lot logic), calls the pure planner,
      creates a STAGED `menu_versions` row (import_id NULL, summary_json origin),
      persists items + variants, sets counts + diagnostics into summary_json
      (no pos_import_diagnostics dependency). Best-effort, no-op-safe.
- [x] **Slice A3 — wire into finalize.** Add the best-effort call to
      `finalizeManifestDispositions` in the `activated > 0` chain. No-op when no
      approved drafts exist. Never breaks finalize.
- [x] **Slice A4 — review/Publish surface for intake-origin versions.** A staged
      versions list + review page that finds versions by VERSION id (not
      import_id), shows the diff vs published, and offers Publish (reusing
      `publishVersion`). Handles NULL import_id (no "source files" block; reads
      diagnostics from summary_json).
- [x] **Slice A5 — enrich-page + empty-menu copy.** Update the "no published menu
      yet, import and publish a menu in the menu upload page" guidance so it points
      to the intake auto-carry flow (the Menu Imports page is the throw-away
      one-time tool), so the owner is never told to rely on a fake upload.

Each slice: branch → build (`rm -rf .next tsconfig.tsbuildinfo` after) → gates
(tsc, eslint, compliance, next build) → push → PR → CI green → squash-merge →
checkout main + fetch + reset --hard origin/main.
