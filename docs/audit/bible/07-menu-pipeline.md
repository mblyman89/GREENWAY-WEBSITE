# Bible Chapter 07 — The Menu Pipeline (Back Office → Website → Register)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9a63c8b1` (every file:line anchor re-checked on
> that tree — if a line looks off, the file changed after this chapter was
> written; re-verify before trusting).
> **Plain-English promise of this chapter:** there is exactly ONE live menu at
> a time. Everything customers see on the website and everything budtenders can
> ring at the register comes from that single published snapshot — and the two
> ways a snapshot goes live (a Cultivera file upload, or intake auto-carry)
> both end at the same atomic "publish" switch in the database.

---

## 1. The big idea in one paragraph

The menu is stored as immutable SNAPSHOTS called menu versions. A version is
born `staged` (a draft nobody sees), and exactly one version is `published` at
any moment — the database function that flips the switch archives the old one
in the same transaction, so there is never zero and never two. The website
reads the published version. The register downloads a "bundle" built from the
published version plus every rule it needs to sell offline (promotions, legal
limits, hours, medical config, loyalty math, barcodes, receipt/rounding/scan
policies). Two pipelines create new versions: the **Menu Imports** upload
(Cultivera PRODUCTS.xlsx + INVENTORIES.xlsx → transform → staged → a human
presses Publish) and **intake auto-carry** (accepting a delivery manifest
stages live-menu + newly approved products and auto-publishes, because the
human review already happened item-by-item at draft approval).

---

## 2. Menu versions — the snapshot model

**Files:** `src/lib/pos/menu-version.ts` (readers), migration
`supabase/migrations/0002_slice2_pos_import.sql` (schema + publish function).

- `getPublishedVersion` (`menu-version.ts:20`) — `menu_versions` where
  `status = 'published'`, limit 1. The whole system's pivot point.
- `getVersionItems` (`:169`) — a version's `menu_items` + `menu_variants`.
- `listVersions` (`:59`), `listImports` (`:105`), `getImportDiagnostics`
  (`:143`) — history for the review screens.
- `diffVersions` (`:270`) — new / price-changed / removed products between a
  staged version and the live one, shown to the manager before publish.
- `listIntakeStagedVersions` (`:84`) — staged versions with `import_id IS
  NULL` (intake-origin, see §5).

**The atomic publish switch** — `publish_menu_version(p_version_id, p_actor)`
in migration 0002 at `:242` (`security definer` plpgsql):

1. Archive any currently-published version (`status='archived'`) — `:247–250`.
2. Promote the target to `published`, stamping `published_at`/`published_by` —
   `:252–256`.
3. Stamp the owning `pos_imports` row `published` and archive sibling staged
   versions from OTHER imports ("only the newly published snapshot is live;
   older staged drafts remain for history") — `:258–268`.

Because steps run inside one function call, a reader can never observe two
published versions or none.

---

## 3. Pipeline A — the Cultivera upload (Menu Imports)

**Files:** `src/app/admin/menu-imports/actions.ts` (server actions),
`src/lib/pos/import-service.ts` (orchestration), `src/lib/pos/transform.ts`
(the transform), `src/lib/pos/draft-injection.ts` (W7 draft append).

### 3.1 Upload guardrails (actions.ts)

`uploadAndStageImport` (`:22`) requires the `menu.import` permission (`:23`),
then refuses: missing files, empty files, files over the 25 MB cap
(`MAX_BYTES` `:11`), and non-.xlsx files (with the friendly tip "don't rename
a .csv to .xlsx", `:41`). Identical re-uploads are detected by SHA-256
(`findDuplicateImport`) but ALLOWED — "POS can re-export identical files; the
manager decides" (`:52–54`). Everything is wrapped so any failure lands as a
readable message on the imports page, and success writes a
`pos_import.staged` audit row with item/variant/error counts (`:69–83`).

### 3.2 Orchestration (import-service.ts — `runImport` at `:66`)

The header comment (`:4–11`) lists the six steps verbatim; verified in the
body:

1. Raw workbooks stored in the private `pos-raw` bucket, keyed by
   timestamp + hash + sanitized filename (`:71–83`).
2. A `pos_imports` row created as `processing`, carrying both file hashes for
   dedup (`:85–103`).
3. The shared transform runs (`transformWorkbooks`, `:110–116`).
4. A STAGED `menu_versions` row is created with item/variant/vendor/hidden
   counts and `error_count`/`warning_count` from the transform diagnostics
   (`:118–139`).
5. Items + variants persisted in batches (ITEM_BATCH 250 / VARIANT_BATCH 500,
   `:186–188`; `persistMenuItems` snapshots every field including
   `source_item_id` — the stable product key the whole system joins on).
6. Diagnostics persisted (DIAG_BATCH 500), then **6b (W7, owner Decision B):**
   `injectApprovedDraftsIntoVersion` appends APPROVED onboarding drafts to the
   staged version — best-effort, "a failure here never fails the import"
   (`:147–156`).
7. The import row flips to `staged` (`:158–166`). Any thrown error flips it
   to `failed` with the message preserved (`:177–182`).

Test-mode imports (`is_test`) exist so the owner can rehearse: `countTestData`
(`:310`) feeds the UI badge and `cleanSlateTestData` (`:324`) calls the
migration-0066 DB function that deletes ONLY test-flagged rows. The server
action (`actions.ts:132`) is confirm-gated — you must type exactly
"DELETE TEST DATA" — and audit-logged.

### 3.3 The transform (transform.ts)

The module header (`:4–19`) states the discipline: this is "the SINGLE SOURCE
OF TRUTH for turning Cultivera/POS workbook exports into Greenway menu items,"
deliberately free of filesystem I/O so the EXACT same code runs in the CLI
script AND the server import. Required columns are declared at `:1162`
(products) and `:1165` (inventories); `transformWorkbooks` (`:1179`) returns
items + diagnostics + a summary. Items the transform can't stand behind are
HIDDEN with a machine-readable reason, not dropped — `hiddenReason:
"no_product_master"` (`:807`) and `"no_inventory"` (`:864`) — and the summary
counts hidden items by reason (`:1079`).

### 3.4 The publish button (actions.ts — `publishVersion` at `:95`)

Requires the `menu.publish` permission (`:96`). Calls `publishMenuVersion`
(import-service `:284`), which enforces the error guard SERVER-side before the
RPC: "Cannot publish: this version has blocking errors" when
`error_count > 0` (`:293–296`), then calls the atomic
`publish_menu_version` RPC (`:298–302`). On success the action writes a
`menu_version.published` audit row (`:108`) and revalidates the public menu
surfaces (`/menu`, `/shop`, `/`) so the website reads the new snapshot
immediately (`:119–122`).

---

## 4. Pipeline B — intake auto-carry + auto-publish

**Files:** `src/lib/pos/intake-menu-staging.ts` (server executor),
`src/lib/pos/intake-menu-staging-core.ts` (pure planner, self-tested at
`:364`), `src/lib/pos/draft-injection.ts` (the W7 sibling used by Pipeline A).

When a delivery manifest is accepted, `stageIntakeMenuVersionForManifest`
(`intake-menu-staging.ts:70`) builds a NEW version out of:
**every currently-published item (carried forward) + the manifest's APPROVED
onboarding products** — no Cultivera upload involved. Key behaviors, all
verbatim from the header (`:4–31`) and confirmed in the body:

- The pure planner `buildIntakeStagedVersionPlan` (core `:276`) makes every
  carry/add/merge/skip decision; the server module only gathers rows and
  writes results.
- **Origin marking:** the new version has `import_id = NULL` and
  `summary_json.origin = "intake"` with the manifest id + planner diagnostics
  (`:215–237`) — the review surface can explain what happened with no
  `pos_imports` row.
- **No redundant versions:** if every approved draft was superseded/skipped,
  no version is created at all (`:205–208`, "no-new-items").
- **AUTO-PUBLISH (owner-approved Option 1):** "the item-by-item human review
  already happened at draft approval … that IS the go-live decision"
  (`:17–20`). `autoPublishIntakeVersion` (`:280`) calls the SAME
  `publish_menu_version` RPC as the Menu Imports button — same atomic swap,
  same archive of the old version. The freshly-staged version always has
  `error_count = 0` "so the Menu Imports error guard is satisfied by
  construction" (`:276–278`).
- **Failure posture:** best-effort everywhere. A publish hiccup leaves the
  STAGED version on Menu Imports as the manual fallback ("nothing can be
  silently lost", `:21–23`); a `menu_auto_publish_failed` timeline event is
  written to the manifest. The whole function must NEVER fail the manifest
  finalize or the draft approval (`:27–31`).
- **Housekeeping:** after a successful publish, STALE intake-origin staged
  siblings are archived (`:322–330`) — each was built from an older live
  snapshot, and "publishing one would DROP newer products."

**Draft injection (Pipeline A's version of the same idea):**
`injectApprovedDraftsIntoVersion` (`draft-injection.ts:39`) reads
`catalog_product_drafts` where `status='approved'`, skips any POS key the
export already staged ("the POS row wins", header `:11`), enriches with the
house website-category resolver + curated `kb_strains` strain types + the
source lot's on-hand/package label, and appends after the highest existing
sort order. All read failures collapse to "inject nothing" — never a failed
import.

---

## 5. Who reads the published snapshot

### 5.1 The website — `src/lib/pos/live-menu.ts`

The header (`:4–23`) documents the fallback policy verbatim:

- Supabase NOT configured (build/preview contexts) → the committed JSON
  snapshot, so builds still render.
- Supabase configured but NO published version (or zero items) → **[] — an
  empty menu.** "An empty back office = no product cards on the site." This
  is deliberate: clearing the back office must actually clear the website.

Loaders: `loadLiveMenuAll` (`:107`, includes hidden — used by pricing so a
just-hidden item can still be priced during an in-flight order),
`loadLiveMenuItems` (`:119`, hidden excluded — the standard site menu),
`getLiveMenuItemById` (`:125`). `menuRowToGreenwayItem` (`:73`) converts DB
rows to the site's shape.

**Server-authoritative checkout pricing** (`src/lib/orders/order-pricing.ts`)
resolves EVERY checkout line against this same published snapshot
(`loadLiveMenuAll` at `:117`) — category, variant label, and TRUE regular
price come from the DB, never the client; discounts are recomputed with the
same engine the register uses; the RCW 69.50.357 price floor is applied
(header `:4–24`). Client totals are only a cross-check. (Full treatment in
chapter 02.)

### 5.2 The register — GET `/api/pos/menu` (Slice B6)

**File:** `src/app/api/pos/menu/route.ts` (247 lines, read in full).

Auth is the same device-header scheme as `/api/pos/sync` (§4 of chapter 04);
`authenticateDevice` at `:56–59`. The bundle is assembled from eleven parallel
loads (`:59–72`): published menu, active promotion rules, product costs,
WAC 314-55-095 limit settings, WAC 314-55-147 hours, medical tax settings +
endorsement config, the DOH medical registry (limit 2000), receipt config,
cash-rounding config, and scan-required config — plus loyalty config (`:73`).

The header comment (`:9–19`) states the safety property that makes a cached
bundle acceptable: "a synced sale is ALWAYS re-priced and re-gated
server-side (B4), so a stale device bundle can never make an illegal sale
stick."

**Product filtering — what can even appear on a register:**

- `item.hidden` → skipped (`:99`).
- `item.inventoryStatus === "unavailable"` → skipped (`:101`).
- **AN-7 recall hold** → skipped (`:103`), and per-VARIANT: a variant whose
  encoded lot key is recalled is dropped even when the card survives
  ("mastered cards would otherwise sell a recalled size", `:129–131`).
  `recalledProductKeys()` (`recall-hold-store.ts:29`) is called here in
  best-effort mode — the header (`:7–15`) documents the ASYMMETRIC fail
  posture: the menu filter is advisory (a read failure ships an UNFILTERED
  menu, "an outage must never blank every register"), while the completion
  gate calls `recalledProductKeys({ failClosed: true })` and REFUSES the sale
  if recall status can't be verified. Advisory layer + statutory stop.
- Items without real variants get a synthetic default variant whose
  `inventoryLevel: 0` is a placeholder flagged as unknown, "NOT a real count"
  (`:108–123`).

**Per-product payload highlights** (`:133–166`): display-name cleanup (Bug 2,
`cleanCardDisplayName`), per-unit grams parsed from the package label (AN-1,
`gramsFromVariantLabel` — mg/ml/pack/each → null → the limit engine keeps its
category default), variant-level `unitsLeft` for B32 low-stock badges
("Warnings only; never blocks a sale"), weighted-average cost for the CCRS
cost floor, and trimmed B42 product-info facts.

**Barcode index (B23, `:168–207`):** built from ACTIVE lots with positive
on-hand, restricted to keys actually sellable in THIS bundle (card keys PLUS
each variant's encoded lot key — without the union, mastered cards' barcodes
"would be dropped as 'delisted'", `:189–193`). Best-effort: a lot-read failure
ships an EMPTY index ("scanning degrades to product-key matches"), never a
failed menu download.

**The bundle** (`PosMenuBundle`, declared in `sale-flow-core.ts:113`; built at
`:209–244`): products, rules, limits, hours, medical config (endorsed flag +
`exciseExemptionUntil` fallback `2029-06-30` + the DOH registry keyed by
`pos_product_key`, `:82–95` — "IDENTICAL inputs the server completion gate
re-derives at sync"), receipt, loyalty earn/redeem math, barcodes, rounding,
scanRequired, and `fetchedAt` (`:243`).

**Device-side caching:** RegisterShell caches the bundle under `gw-pos-menu`
(`RegisterShell.tsx:100`, refresh at `:500–523`); offline sales price from the
cache until a refresh succeeds. The server's AN-5 price-drift NOTICE
(chapter 04 §6 item 14) audits any sale rung from stale prices.

### 5.3 Register-initiated menu changes — "86 it" (B43)

**File:** `src/app/api/pos/stock-flag/route.ts`. A budtender can flip a
published item to `inventory_status = "unavailable"` so it leaves every
register's next download AND the website. The header (`:4–14`) states the
crucial asymmetry: **"ONE-WAY by design — the register can kill a phantom
listing but can never invent inventory; bringing an item back is a
back-office action."** It writes the SAME field the B19 sale-decrement flips
when a sale empties an item, so every downstream consumer already honors it.
Device-authenticated + audited. On the device, the action requires being
ONLINE ("it changes the shared menu", `RegisterShell.tsx:903–905`), and on
success the local cached bundle is patched immediately via
`applyLocalStockFlag` (`stock-flag-core.ts:67`) so the just-flagged item
disappears from THIS register without waiting for a refresh.

### 5.4 Build-staleness probe

`GET /api/pos/version` (`src/app/api/pos/version/route.ts`) returns the
deploy's short commit SHA — the same value baked into the service-worker
cache names — so a locked register can detect "Update available" without
relying on the iPad PWA's unreliable SW update check. Unauthenticated on
purpose: "the SHA of a public deployment is not a secret" (header `:12–14`).

---

## 6. What SHOULD never happen (the watchlist)

1. **Two published menu versions at once, or none after a publish** — the
   atomic `publish_menu_version` RPC (migration 0002 `:242`) archives-then-
   promotes in one transaction.
2. **A version with blocking transform errors going live** — server-side
   guard in `publishMenuVersion` (import-service `:293–296`); intake versions
   are error-free by construction.
3. **The website showing products after the back office is cleared** — no
   published version (or zero items) → empty menu, never the committed JSON
   (live-menu `:17–23`); the JSON fallback exists ONLY when Supabase isn't
   configured.
4. **A hidden, unavailable, or recalled product ringable at a register** —
   the three skips at menu route `:99/:101/:103` plus the per-variant recall
   skip at `:131`; and even if a stale cached bundle still shows it, the
   completion gate's fail-closed recall check refuses the sale at sync.
5. **Every register going blank because a recall-status read failed** — the
   advisory menu filter is best-effort by design (recall-hold-store `:7–15`);
   the fail-closed layer is the gate, not the menu.
6. **A register "un-86ing" an item or inventing stock** — stock-flag is
   one-way (route header `:6–8`); restoration is back-office only.
7. **A stale register bundle making an illegal or mispriced sale STICK** —
   every synced sale is re-priced and re-gated server-side (menu route
   `:16–19`); price drift is audited (AN-5), not silently accepted.
8. **An approved onboarding product silently missing from the next publish**
   — Pipeline A appends approved drafts at import (W7, import-service
   `:147–156`); Pipeline B carries them at manifest accept with auto-publish;
   both skip only when the POS export already carries the key (POS wins).
9. **Intake auto-publish losing work on failure** — the staged version
   remains on Menu Imports as the manual fallback + a
   `menu_auto_publish_failed` timeline event (intake-menu-staging `:280+`).
10. **An older intake-origin staged version being published later and
    DROPPING newer products** — stale intake siblings are archived after a
    successful publish (`:322–330`).
11. **Clean Slate deleting real data** — it calls the migration-0066 DB
    function (`0066_test_data_clean_slate.sql`) that touches ONLY test-flagged
    rows, behind a typed confirmation phrase + audit (actions.ts `:133–161`).
12. **A transform silently dropping a product it can't verify** — items are
    HIDDEN with machine-readable reasons (`no_product_master`,
    `no_inventory`) and counted in the summary, never vanished.
13. **The register and website pricing from different engines** — both use
    `loadActiveRules` + the same pure promotion engine; the bundle ships the
    rules so the device prices "with the IDENTICAL engine the website
    checkout and the server-side completion gate use (no drift possible)"
    (menu route `:10–13`).
14. **A menu publish nobody can trace** — `menu_version.published` /
    `pos_import.staged` audit rows + `published_by`/`published_at` stamps +
    manifest timeline events for intake publishes.

---

## 7. Findings from this pass

No new findings. Two design postures worth restating for future auditors
(both deliberate, both documented in code comments):

- The recall-hold MENU filter fails OPEN (unfiltered menu) while the
  completion gate fails CLOSED — the pair is intentional (AN-7); do not
  "fix" the menu filter to fail closed without understanding that an outage
  would blank every register.
- Intake auto-publish skips the human publish button by explicit owner
  decision (Option 1) — the review happens at draft approval. If the owner
  ever wants a second gate, the manual-publish fallback path already exists.
