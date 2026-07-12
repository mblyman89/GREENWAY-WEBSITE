# Equipment Hub — consolidation plan

**Goal (owner):** one clean, organized, decluttered page where *everything equipment-related* lives.

## Grounded findings (from the file tree, not assumed)

| Piece | Where it lives today | Notes |
| --- | --- | --- |
| Asset registry (schema) | `supabase/migrations/0046_equipment_assets.sql` | `equipment_assets` + `equipment_service_events`; categories, status, calibration, warranty, register map, cost (minor units). |
| Registry store | `src/lib/equipment/store.ts` | list/get/create/update, service events, `summarizeEquipment`, calibration `due`/`soon` decoration. |
| Equipment page | `src/app/admin/equipment/page.tsx` | list + filters + **hardcoded** "integrated hardware" card + add-asset form (one long screen). |
| Asset detail | `src/app/admin/equipment/[id]/page.tsx` | edit + service log (good; keep, light polish). |
| Owner hardware seed | `supabase/migrations/0061_seed_owner_hardware.sql` | seeds the SAME 4 devices into the table as draft rows → duplicates the hardcoded card. |
| Receipt printer | `src/app/admin/settings/receipt-printer/*` + `src/lib/printing/*` | full CloudPRNT subsystem: settings, job queue, live online status, AI diagnostics. Lives in **Admin** nav group. |
| Label printing | `src/app/admin/inventory/noncannabis/[id]/label` + `.../lots/[id]/label` | Rollo, browser print dialog. |
| Scanner + laminator | referenced from the guided intake on `src/app/admin/medical` | scan-to-file then upload; laminate cards. |
| Registers & drawers | `src/app/admin/registers` | cash drawers; assets map to a `register_id`. |
| Nav | `src/components/admin/admin-nav-data.ts` | "Equipment" under Inventory; "Receipt Printer" under Admin (split). |

**Integrated-device ground truth (4), from migration 0061:**
- Star Micronics TSP143IV — receipt printer (CloudPRNT) → `/admin/settings/receipt-printer`
- Rollo Wireless X1040 — 4×6 label printer → prints from intake/label pages
- Canon PIXMA TS3522 — medical scanner → `/admin/medical` (guided intake)
- Scotch Thermal Laminator — recognition-card laminator → `/admin/medical` (guided intake)

## The declutter decision

1. **Single source of truth = the registry table.** Stop hardcoding the 4 devices. Instead, tag the integrated ones (they already carry stable `asset_tag`s: `PRN-RECEIPT-01`, `PRN-LABEL-01`, `SCAN-MEDICAL-01`, `LAMINATOR-01`) and render a "Integrated hardware" section *from the data*, each linking to the page it drives. This removes the duplicate and stays correct whether or not the row exists yet (graceful fallback describing the device + its link).
2. **One page, clearly sectioned** (top → bottom):
   - **Header** with a primary "Add asset" action (opens the form section / anchor) — no giant always-open form.
   - **At-a-glance stats** (total / active / calibration due / warranty expiring / mapped to register).
   - **Attention needed** — only shows when something is due: calibration due/soon + warranty expiring in 60 days. Actionable, dismissible-by-emptiness.
   - **Integrated hardware** — data-driven cards for the 4 wired devices with live status where we have it (receipt printer online/offline from `isPrinterOnline`) and a deep link to configure/use each.
   - **All assets** — filterable table (search/status/category), grouped by category for scannability.
   - **Add asset** — a collapsible `<details>` form (declutters; expands on demand or via the header action anchor).
3. **Cross-links, not duplication.** The hub links out to Receipt Printer, Registers, Label printing, Medical intake — one obvious place to find equipment, without copying those subsystems.
4. **Warranty surfacing** — add `warranty expiring` to the summary + attention list (data already exists; never shown today).

## Scope guardrails
- No schema changes required (all data exists). If a tiny, *idempotent* helper index/view is genuinely needed it will be proposed as a migration for the owner to apply manually — but the plan avoids it.
- Keep the `[id]` detail page & server actions; only light polish.
- AI output = draft. Deep-researched device facts already live in migration 0061 (grounded); reuse them.
- Reuse the existing design system (`AdminPageHeader`, `Card`, `Section`, `StatCard`, `Badge`, `Button`, `HelpPanel`, `EmptyState`). No new visual language.

## Implementation status — DONE

Delivered on branch `feat/equipment-hub`:

- **`src/lib/equipment/store.ts`** — added the integrated-device catalog (`INTEGRATED_DEVICES`, `INTEGRATED_ASSET_TAGS`, `IntegratedDevice`/`IntegratedDeviceView` types), `resolveIntegratedDevices(assets)` (pairs catalog with registry rows by `asset_tag`; graceful when a row is absent), `warrantyExpiringSoon(asset)` + `WARRANTY_SOON_DAYS = 60`, and extended `EquipmentSummary`/`summarizeEquipment` with `warrantyExpiringSoon`.
- **`src/app/admin/equipment/page.tsx`** — rebuilt into one sectioned hub: header + "Add asset" action → At a glance (5 stats incl. warranty) → Needs attention (only when actionable) → Integrated hardware (data-driven cards, receipt-printer live online/offline via `isPrinterOnline`, deep links to each workflow) → All assets (filter + grouped-by-category tables, Clear filters) → collapsible Add-asset form. Removed the hardcoded 4-device list (no more duplication).
- **`src/app/admin/equipment/[id]/page.tsx`** — light polish: added a Warranty stat card (5-up grid).
- **`src/lib/admin/help-content.ts`** — refreshed the Equipment help copy to describe the hub (integrated hardware, Needs attention, receipt-printer status).

Verification: `tsc --noEmit` clean, `eslint` clean on all changed files, full `next build` compiled successfully (both equipment routes present). Graceful when Supabase unconfigured / migration 0061 not applied (stores return `[]`/`null`; integrated cards still render from the catalog with a "Not yet in registry" note). No schema changes.
