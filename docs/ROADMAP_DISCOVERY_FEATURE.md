# Roadmap & Task List — Product & Vendor Discovery (hand-off ready)

> **Owner's directive (this session):** *"put together a comprehensive research-backed
> roadmap and task list and todo list for building all of this new discovery feature,
> that is hand off ready ... we don't need the web crawler for this, so lets just do it
> the more direct way ... if there are six slices worth of work to be done, please do all
> six ... don't stop until it is done."*
>
> **Compliance note (owner-stated):** the owner's enforcement officer has said it's fine
> to proceed for now; we build it so it can be cleanly removed later if needed. The
> RCW 42.56.070(8) "no commercial use" caveat on WSLCB PRA lists is documented in
> `docs/RESEARCH_CRAWL4AI_DISCOVERY.md` — this feature keeps a per-source note field and
> a global on/off so it's easy to disable.
>
> **Approach (per owner):** DIRECT route, no web crawler. Discovery is a curated
> **leads funnel** that (a) reconciles the authoritative WA licensed-vendor universe
> against the vendors we already buy from, (b) lets staff capture/track product & vendor
> leads (manual + file import), and (c) promotes a lead straight into the existing
> Purchasing pipeline (`/admin/purchasing/new`).

---

## 1. Vision

A **Product Discovery** surface at the top of the Product Intake funnel that answers
"what products & vendors should we pursue?" and flows leads into POs:

```
Discovery (leads)  →  shortlist / qualify  →  New Purchase Order  →  send  →  receive  →  onboard  →  enrich
   [THIS FEATURE]                                [already built ...................................................]
```

Grounded in `docs/RESEARCH_CANNABIS_PURCHASING.md` (category economics: flower turns
fastest & highest revenue share; edibles/topicals slow; GMROI) and
`docs/RESEARCH_CRAWL4AI_DISCOVERY.md` (source-led, not crawler-led).

## 2. Design principles (standing rules)

- **Drafts-only / human-in-the-loop.** Every lead is a candidate a human qualifies and
  promotes. Nothing auto-inserts into vendors, catalog, or POs.
- **Never guess.** Reconciliation matches on real license numbers / normalized names;
  when uncertain it flags "needs review", never auto-merges.
- **Money in minor units (cents).** Any estimated cost/price stored as integers.
- **Idempotent migrations, applied manually by owner.** Follow the 0048 template
  (is_staff RLS, set_updated_at trigger, `create ... if not exists`).
- **Removable.** One `discovery.enabled` settings flag + self-contained tables/routes so
  the whole feature can be turned off or dropped without touching purchasing.
- **On the admin design system.** Tokens only; Card/Section/StatCard/Badge/Button/Field;
  Breadcrumbs + HelpPanel; stage-strip-style hand-offs.

## 3. Data model (new, self-contained)

Migration `0078_discovery.sql` (idempotent). Tables:

- **`discovery_settings`** (singleton id=1): `enabled boolean`, `default_market text`,
  planning knobs, `updated_at`. Global kill-switch + defaults.
- **`discovery_sources`**: catalog of where a lead can come from
  (`kind`: `wslcb_license_list` | `market_data` | `vendor_site` | `manual` | `trade_show` | `other`),
  `name`, `url`, `commercial_use_ok boolean`, `notes` (holds the RCW caveat per source),
  `active boolean`. Seeded with the WSLCB list + "Manual entry".
- **`discovery_vendor_leads`**: candidate VENDORS to pursue. `source_id`, `legal_name`,
  `display_name`, `license_number`, `city`, `status` (`new`|`reviewing`|`contacted`|
  `qualified`|`onboarded`|`dismissed`), `matched_vendor_id` (FK vendors, nullable),
  `match_state` (`unmatched`|`possible`|`existing`), `priority` (`high`|`med`|`low`),
  `note`, `dedupe_key` (unique — normalized license_number or slug of legal_name).
- **`discovery_product_leads`**: candidate PRODUCTS to pursue. `source_id`,
  `vendor_lead_id?`, `product_name`, `brand`, `category`, `pack_size`,
  `est_unit_cost_minor_units`, `est_retail_minor_units`, `demand_signal text`
  (why it's interesting — e.g. "rising category"), `status`
  (`new`|`reviewing`|`shortlisted`|`ordered`|`dismissed`), `priority`, `note`,
  `promoted_po_id?` (FK purchase_orders when it becomes a PO line), `dedupe_key`.

All tables: RLS `is_staff()` read/write, `set_updated_at` triggers, indexes on
status/priority/source. FKs use `on delete set null` so dropping a lead never cascades
into vendors/POs.

## 4. Server layer

- `src/lib/discovery/types.ts` — the TS types mirroring the tables.
- `src/lib/discovery/store.ts` — CRUD + queries (guarded by `isSupabaseServiceConfigured`,
  returns empty/null when off), counts for the hub, and the **reconciliation** helper
  `reconcileVendorLead()` that matches a lead to an existing vendor by normalized
  license number first, then normalized name, setting `match_state`.
- `src/lib/discovery/reconcile.ts` — pure, unit-testable normalize + match functions.
- `src/lib/discovery/import.ts` — parse a pasted CSV/TSV (vendor or product leads) into
  draft rows (no network; the "direct way"). Uses the same normalize helpers.

## 5. UI / routes

- `src/app/admin/discovery/page.tsx` — **Discovery hub**: KPIs (open leads by status,
  licensed vendors we don't buy from yet, shortlisted products), two lead lists
  (vendors, products), Breadcrumbs + HelpPanel + back-to-Catalog-Hub, kill-switch banner
  when disabled.
- `src/app/admin/discovery/actions.ts` — server actions: add/update/dismiss lead, change
  status/priority, run reconciliation, import CSV, **promote product lead → PO** (prefill
  `/admin/purchasing/new`), promote vendor lead → create draft vendor (drafts-only).
- `src/app/admin/discovery/import/page.tsx` — paste-CSV import screen (vendor/product).
- Client islands as needed (lead tables with inline status/priority controls).
- Wire into `admin-nav-data.ts` (Product Intake, first item) + Catalog Hub card + the
  purchasing "New PO" flow (accept `?fromLead=` prefill).

## 6. The six slices (execute all)

- **Slice 1 — Foundation & data model.** `0078_discovery.sql` (idempotent), `types.ts`,
  `store.ts` skeleton with guards + counts. Kill-switch (`discovery_settings.enabled`).
- **Slice 2 — Discovery hub page + nav.** Route, KPIs from `store.ts`, empty states,
  Breadcrumbs/HelpPanel/back-link, nav entry, Catalog-Hub card. Read-only first.
- **Slice 3 — Vendor leads + reconciliation.** `reconcile.ts` (normalize/match),
  `reconcileVendorLead()`, vendor-lead list with match badges ("already a vendor" /
  "possible match" / "new"), status/priority controls, add-lead action.
- **Slice 4 — Product leads + promote-to-PO.** Product-lead list, add/edit, category
  guidance from research, **"Start PO from lead"** → prefill `/admin/purchasing/new`
  with product+vendor; mark lead `ordered` + store `promoted_po_id`.
- **Slice 5 — Direct import (CSV/TSV paste).** `import.ts` parser + import screen; map
  columns → vendor or product leads as drafts; dedupe via `dedupe_key`; source tracking
  with the commercial-use note surfaced.
- **Slice 6 — Polish, compliance guardrails, docs & tests.** Kill-switch enforced on
  all routes/actions; per-source commercial-use note shown; unit tests for
  reconcile/import/dedupe; update this roadmap's checklist; verify tsc/eslint/build;
  ship behind one PR.

## 7. Hand-off checklist / TODO

Slice 1 — Foundation
- [x] `supabase/migrations/0078_discovery.sql` (idempotent; is_staff RLS; triggers; seeds)
- [x] `src/lib/discovery/types.ts`
- [x] `src/lib/discovery/store.ts` (guards, counts, CRUD)
- [x] Kill-switch: `discovery_settings.enabled` + `isDiscoveryEnabled()`

Slice 2 — Hub + nav
- [x] `src/app/admin/discovery/page.tsx` (KPIs, empty states, breadcrumbs, help, back-link)
- [x] `admin-nav-data.ts` — add "Product Discovery" as first Product Intake item
- [x] Catalog Hub — add a Discovery card ("0 · Product Discovery")

Slice 3 — Vendor leads + reconciliation
- [x] `src/lib/discovery/reconcile.ts` (normalizeLicense, normalizeName, matchVendorLead)
- [x] `reconcileAllVendorLeads()` in store; batch "reconcile all" + auto-reconcile on create
- [x] Vendor-lead list UI + match badges + status/priority + add-lead action

Slice 4 — Product leads + promote
- [x] Product-lead list UI + add/edit + category guidance
- [x] `promoteProductLeadAction` → prefill `/admin/purchasing/new?fromLead=…`
- [x] `/admin/purchasing/new` accepts a single prefilled lead line + vendor; PO id written back to lead (`promoted_po_id`) on save via `markProductLeadPromoted`

Slice 5 — Direct import
- [x] `src/lib/discovery/import.ts` (CSV/TSV parse → draft leads, flexible headers, dedupe)
- [x] `src/app/admin/discovery/import/page.tsx` (+ `importLeadsAction`)
- [x] Source tracking + commercial-use note surfaced (hub + import screens)

Slice 6 — Polish/compliance/tests/docs
- [x] Kill-switch enforced on every discovery route (hub + import) & write action (`ensureEnabled()`)
- [x] Per-source commercial-use caveat visible in UI (hub + import)
- [x] Unit tests: reconcile, import, dedupe (`scripts/discovery/test_discovery_pure.ts`, 36 assertions, run with `npx tsx`)
- [x] tsc clean · eslint clean · next build clean · dev smoke 200 (`/admin/discovery`, `/admin/discovery/import`, `/admin/purchasing/new?fromLead=`)
- [x] Roadmap checklist ticked; PR opened & merged

## 8. Verification protocol (every slice)

`npx tsc --noEmit -p tsconfig.json` → `npx eslint <changed>` → `npx next build` →
`rm -rf .next`; dev-server smoke (`curl` 200 + grep no error strings). Migrations are
applied MANUALLY by the owner in the Supabase SQL editor (idempotent), never by the app.

## 9. How to disable / remove (removability guarantee)

1. Set `discovery_settings.enabled = false` → routes show a disabled notice; nav item can
   be hidden. No effect on purchasing/vendors/catalog.
2. To fully remove: delete the `src/app/admin/discovery/*` routes, `src/lib/discovery/*`,
   the nav entry + hub card, and drop the `discovery_*` tables. Because all FKs into
   `vendors`/`purchase_orders` are `on delete set null` and Discovery only *reads* them,
   nothing else breaks.
