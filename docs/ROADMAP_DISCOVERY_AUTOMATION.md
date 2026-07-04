# Discovery Automation — Roadmap (Leads Generator + Benchmark Generator)

Owner-authorized follow-on to the Discovery funnel (PR #240). The WSLCB
enforcement officer confirmed that a **retailer** using the LCB public licensee
data for its own sourcing/benchmarking is acceptable practice, so this phase
**automates** lead generation and adds a **benchmark generator** — no more
manual-only entry.

> Standing rules apply: deep-researched + grounded in **verified** sources
> (never guess), drafts-only, money in **minor units**, idempotent migrations
> (owner applies manually), removable via the existing `discovery.enabled`
> kill-switch, on the admin design system, hand-off ready.

---

## 1. What we verified (authoritative sources — no guessing)

All confirmed live during research (see `docs/RESEARCH_WA_CANNABIS_DATA.md` for
the raw findings and column dumps):

| Source | Endpoint | What it gives us | Use |
|---|---|---|---|
| **WA LCB Cannabis Renewal** | `https://data.wa.gov/resource/brpd-b6zd.json` (SODA) | `tradename, license, ubi, privdesc01–08, city, countyname, dayphone, renewaldate, applicants`. Includes **Producer T1/T2/T3, Processor, Retailer, Transporter**. ~384 rows. | Primary **automated vendor-lead feed** (fresh, filterable). |
| **WA LCB Local Authority Letters** | `https://data.wa.gov/resource/vgcw-qfjm.json` (SODA) | Same shape + `applicationdate, l_a_type` (NEW LICENSE APPLICATION, ASSUMPTION, …). | **Brand-new applicant** signal (freshest prospects). |
| **WSLCB "Cannabis License Applicants" xlsx** | `lcb.wa.gov/records/frequently-requested-lists` | Most complete roster; monthly; current export is retailers-only. Columns: `Tradename, License, UBI, Street Address, Suite Rm, City, State, county, Zip Code, Priv Desc, Privilege Status, Day Phone`. | Manual/CSV import path (already shipped). |

**SODA API facts we confirmed:** supports `$select`, `$where`, `$group`,
`$order`, `$limit`, `$offset`; JSON output; no key required for light use (an
optional `X-App-Token` raises rate limits — env-gated, never hard-coded).

**Benchmarks — honest boundary:** WA publishes **no free per-product wholesale
price feed** (Headset/LeafLink are paid). Therefore benchmarks are computed
from **our own verified data** — POS sales velocity, purchase-order unit costs,
current on-hand — plus the category turn-rate guidance already in the repo
(`docs/RESEARCH_CANNABIS_PURCHASING.md`). We NEVER fabricate market prices.

---

## 2. Feature vision

**A. Leads Generator (automated).** One click (or a scheduled pull) fetches the
LCB feeds, filters to the license types we buy from (Producers + Processors),
turns each into a **draft vendor lead**, runs the existing reconciliation
(license → existing, name → possible, else new prospect), and dedupes. The
owner sees only **new prospects** worth contacting, ranked.

**B. Benchmark Generator (from our own data).** Computes per-category and
per-brand benchmarks from POS + POs + inventory: average unit cost, retail
price, markup/margin, sell-through/velocity, days-of-supply, and an assortment
gap ("categories/brands you under-carry vs. your own mix"). Product leads and
the PO builder show a benchmark chip so the owner can price/negotiate with
confidence — all sourced numbers labeled as **our data**, never invented.

Both feed the existing funnel: Discovery → Purchasing → Receiving → Onboarding
→ Enrichment.

---

## 3. Data model (additive migration `0079_discovery_automation.sql`)

Idempotent, `is_staff()` RLS, `set_updated_at()` triggers, minor units.

- `discovery_sync_runs` — audit of each automated pull: `id, source_id,
  started_at, finished_at, status (running|ok|error), fetched, inserted,
  deduped, error, params jsonb`.
- `discovery_benchmarks` — cached computed benchmarks so pages are fast:
  `id, scope (category|brand|category_brand), scope_key, metric, value_minor
  (nullable), value_num (nullable), sample_size, computed_at`. Recomputed on
  demand + optionally on a schedule. (No external data; derived from our DB.)
- Extend `discovery_sources`: add `soda_dataset_id text`, `soda_domain text`,
  `auto_enabled boolean default false`, `last_synced_at timestamptz` — so a
  source row *is* the fetch config (removable, inspectable).
- Seed the two verified SODA sources (Renewal, Local Authority Letters) with
  `kind='wslcb_license_list'`, `commercial_use_ok=true` (officer-approved),
  `auto_enabled=true`.

---

## 4. Server layer (`src/lib/discovery/…`)

- `soda.ts` (pure-ish fetch client): builds SODA URLs (`$where/$select/$limit`),
  paginates, optional `SOCRATA_APP_TOKEN` from env, timeouts + typed errors.
  **No secrets hard-coded.**
- `wslcb.ts`: maps a raw SODA row → normalized vendor-lead draft (trim padded
  strings, title-case, keep license + UBI, derive `license_kind` from
  `privdesc01`, filter to producer/processor). Pure + unit-tested.
- `sync.ts`: `runVendorLeadSync(sourceId, opts)` — fetch → map → filter →
  `createVendorLead` (existing dedupe/reconcile) → write a `discovery_sync_runs`
  row. Guarded by `isDiscoveryEnabled()` + `source.auto_enabled`.
- `benchmarks.ts`: `computeBenchmarks()` from POS/PO/inventory stores →
  upsert `discovery_benchmarks`; `getBenchmarksSnapshot()` for the UI;
  `getBenchmarkFor(category, brand?)` for chips. Pure aggregation helpers unit-tested.

## 5. UI / routes (on the design system)

- `/admin/discovery` — add a **"Generate leads"** panel: pick source(s) +
  license types, "Fetch now" (server action → `runVendorLeadSync`), show last
  run stats + a `discovery_sync_runs` history strip.
- `/admin/discovery/benchmarks` — new page: category & brand benchmark tables
  (avg cost, retail, margin, velocity, days-of-supply, assortment gaps), a
  "Recompute" action, and clear "computed from your data on <date>" labeling.
- Benchmark **chip** on product-lead rows and the PO builder line (cost vs.
  your category average) — advisory only.
- Nav: add "Benchmarks" under Product Intake (after Product Discovery).

---

## 6. Slices (execute all; verify each: tsc → eslint → build → dev smoke)

- **Slice 1 — Verified research doc + migration `0079` + source config.**
- **Slice 2 — SODA client (`soda.ts`) + WSLCB mapper (`wslcb.ts`) + unit tests.**
- **Slice 3 — `sync.ts` + "Generate leads" action + run-history + hub panel.**
- **Slice 4 — `benchmarks.ts` (compute from POS/PO/inventory) + unit tests.**
- **Slice 5 — `/admin/discovery/benchmarks` page + nav + recompute action.**
- **Slice 6 — Benchmark chips on product leads + PO builder; polish; kill-switch
  enforced on new routes/actions; roadmap ticked; PR opened & merged.**

---

## 7. Hand-off checklist / TODO

Slice 1 — Foundation
- [ ] `docs/RESEARCH_WA_CANNABIS_DATA.md` (verified endpoints, columns, samples, legal note)
- [ ] `supabase/migrations/0079_discovery_automation.sql` (idempotent; RLS; triggers; seeds; extends discovery_sources)

Slice 2 — Fetch + map
- [ ] `src/lib/discovery/soda.ts` (SODA client, env token, pagination, timeouts)
- [ ] `src/lib/discovery/wslcb.ts` (row → vendor-lead draft; producer/processor filter; license_kind)
- [ ] Unit tests for the mapper + SODA URL builder

Slice 3 — Automated leads
- [ ] `src/lib/discovery/sync.ts` (`runVendorLeadSync`, writes `discovery_sync_runs`)
- [ ] "Generate leads" server action + hub panel + run-history strip
- [ ] Kill-switch + `auto_enabled` enforced

Slice 4 — Benchmark engine
- [ ] `src/lib/discovery/benchmarks.ts` (compute from POS/PO/inventory; upsert cache)
- [ ] Unit tests for the pure aggregation helpers

Slice 5 — Benchmark UI
- [ ] `/admin/discovery/benchmarks` page (category + brand tables, recompute, "your data" labeling)
- [ ] Nav entry "Benchmarks" under Product Intake

Slice 6 — Integration + polish
- [ ] Benchmark chip on product-lead rows + PO builder line
- [ ] Kill-switch enforced on every new route/action
- [ ] tsc clean · eslint clean · next build clean · dev smoke 200
- [ ] Roadmap checklist ticked; PR opened & merged

---

## 8. Removability guarantee
Everything is additive and gated by `discovery_settings.enabled` (+ per-source
`auto_enabled`). Disabling the kill-switch stops all fetching and hides the UI;
dropping the `0079` objects removes the feature without touching purchasing,
POS, or vendors. No secrets are committed — the optional Socrata app token is
read from env only.
