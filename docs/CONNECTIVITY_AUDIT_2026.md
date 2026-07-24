# Full-Scope Connectivity Audit — SLICE 39 (2026)

Method: automated route-graph extraction + permission-gate sweep + table/migration
cross-reference + import-graph orphan detection + manual verification of every
candidate finding (never guess — every item below was confirmed by reading the
code at the cited anchor).

Auditors' tools (kept in /workspace): audit_connectivity.py (route graph),
audit_permissions.py (gates + nav), audit_tables.py (store→migration),
audit_registries.py (lib hrefs, audit actions, env vars), audit_fetches.py
(fetch/revalidate targets), audit_api_auth.py (API gates),
audit_orphan_exports.py (import graph).

## Scope measured

- 234 routes total: 170 pages (149 admin + 21 public), 64 API handlers (38 route.ts files).
- 1,172 TS/TSX files, ~295k lines.
- 170 tables/views across migrations 0001–0137; 164 distinct `.from("…")` table refs.
- 61 nav items, 88 help links, 351 distinct audit-log action names, 57 env vars.
- 213 pure self-test suites (`__run*Tests`) exported across src.

## A. CONFIRMED BUGS (fixed in this slice)

1. **Stale revalidate target `/shop` (route does not exist).**
   - src/app/admin/menu-imports/actions.ts:121 `revalidatePath("/shop")`
   - src/lib/pos/intake-menu-staging.ts:358 `revalidatePath("/shop")`
   - The public menu lives at `/menu` (already revalidated on the lines above);
     `/shop` was never a route in this app (no page.tsx, nothing in git history).
     Fixed → `/specials` (a real menu-derived surface, harmless if already dynamic).

2. **Stale revalidate target `/vendors` (route does not exist).**
   - src/app/admin/vendors/actions.ts:166 and :1017 `revalidatePath("/vendors")`
   - The public vendor directory is `/vendor-delivery` (see src/app/vendor-delivery/page.tsx).
     Fixed → `/vendor-delivery`.

3. **Ungated exported server action `pendingProductLinks`.**
   - src/app/admin/media/actions.ts:783. The file is `"use server"`, so every
     export is a callable endpoint. Every OTHER export in the file gates with
     `requirePermission`; this read-only helper did not (it was written as a
     data loader for /admin/media/[id], which gates the page — but the action
     itself was still directly invocable). Fixed: `requirePermission("media.manage")`
     added inside the function.

## B. BUILT-BUT-DISCONNECTED (wired in this slice)

4. **41 pure self-test suites existed but ran NOWHERE** — not imported by
   scripts/compliance/run-pure-selftests.ts and not mirrored in vitest. Entire
   verified-at-CI surface was dark for: Sage 50 exports, NACHA/ACH payment
   files, payroll math + guardrails, CCRS identifiers/adjustments/submit-gate/
   manifest CSV, compliance health, excise payment, intake disposition &
   review, lot-activation gate, manifest pipeline, sample guardrails, Code 128
   barcodes, printer diagnostics, purchase orders, forecasts, newsletter stats,
   report ranges, ZIP/CRC, timeclock, WebAuthn, image specs, email-event
   normalize/verify, KB notes, strain terpenes, card cannabinoids, non-cannabis
   naming, inventory type catalog, admin nav integrity, audit anomalies,
   cockpit, mobile, store profile. ALL are now imported + executed by the pure
   runner (each verified pure — no "server-only", no Next imports). Suites that
   return `{ passed, failed }` WITHOUT throwing internally (kb-notes, webauthn,
   image-spec, ccrs-identifiers, ccrs-submit-gate, compliance-health,
   ccrs-manifest-csv, intake-disposition, intake-review, lot-activation-gate,
   manifest-pipeline, strain-terpenes, nacha, vendor-ach, payroll,
   payroll-guardrails, code128, forecast, range) are wrapped in an
   `assertNoFailures()` helper so a red suite still fails CI.
   Wiring immediately paid off: the previously-dark audit-anomaly suite FAILED
   on any UTC machine because its fixture built timestamps with local-time
   `Date#setHours` while production `hourOf()` correctly uses the store's
   Pacific wall clock (S-12). Fixture re-anchored to explicit UTC instants
   (2pm Pacific base; hour overrides applied as Pacific+8 in PST) so the test
   is deterministic in every timezone. Also: `__runStrainTerpeneTests` now
   returns `{ passed, failed }` (it previously only set `process.exitCode`,
   which the runner could not observe).

5. **Intake review checklist core never rendered** (src/lib/inventory/intake-review-core.ts,
   built Slice 97: COA / lot-code / failed-lab / sample / zero-qty flags per
   WAC 314-55-102). No page imported it. Now connected to the Receiving detail
   page via a new pure adapter that builds the same summary from the STAGED
   manifest + lot rows (honest data — no re-parse of raw payloads).

6. **AI mechanics drafter never reachable** (src/lib/promotions/engine-ai.ts
   `draftEngineConfig` — translates "buy 2 get 15%, 4+ get 25%" into engine
   tiers; drafts-only by design). No action/UI called it. Now wired: a
   permission-gated server action + a "Draft mechanics with AI" panel in the
   promotion form that fills the tier inputs for the manager to review/edit.

7. **Help system blind spots**: 18 of 61 nav destinations had no Help coverage
   (samples ×2, CCRS command center, compliance health, regulatory watch,
   compliance calendar, website sync, page editors ×6 (home/menu/specials/
   vendors/about/locations), banking, schedule, handbook, payroll,
   non-cannabis inventory). Help entries added so the "?" launcher and
   /admin/help cover every nav destination.

## C. DEAD CODE REMOVED (verified: zero imports anywhere in src/scripts/tests)

Superseded components (replacement in parentheses, each verified live):
- src/components/admin/media/MediaAltField.tsx (MediaMetaEditor)
- src/components/admin/registers/DenomFields.tsx (CountGrid)
- src/components/blog/BlogFeatured.tsx, BlogSidebar.tsx (blog page renders its own cards)
- src/components/home/StoreVisit.tsx (home sections from CMS)
- src/components/location/LocationCard.tsx, StoreHours.tsx (locations page inline)
- src/components/menu/MenuCollectionShell.tsx, ProductOrderIntent.tsx (InteractiveMenuBrowser)
- src/components/policies/PolicyContent.tsx (policy pages render markdown directly)
- src/components/site/LocationSelector.tsx (components/site/SecondaryBar)

NOT removed (intentional keep):
- src/lib/pos/auto-discount.ts — parity reference read by
  /workspace/verify_store_favorable_discounts.py (store-favorable guarantees).

## D. VERIFIED-OK (audited, no action needed — documented so nobody re-chases)

- Route graph: 0 dead links after resolving withBackParam/`${BASE}`/sopHref
  indirection. 0 orphan admin pages — /admin/account/set-password is reached by
  invite EMAIL links (users/actions.ts:221), by design.
- Nav permissions: all 61 nav items match their target page's gate (or the
  page uses requireStaff, which is broader on purpose: /admin, help, sop,
  website-sync, mobile, security).
- API gates: all /api/pos/* use authenticateDevice; crons check CRON_SECRET;
  webhooks verify svix/SendGrid signatures; cloudprnt uses timingSafeEqual
  token. Four intentionally public: /api/estimator (config-only, no PII —
  documented in file header), /api/loyalty-signup (public form, rate-limited),
  /api/admin/preview/disable (only turns preview OFF), /api/pos/version
  (build SHA probe, documented).
- Store→schema: every `.from("table")` in src maps to a migration-created
  table (the lone "123456789" hit is a CRC-32 test vector in reports/zip.ts).
  All `.rpc()` names exist in migrations. Unreferenced tables are intentional:
  sample_json_imports (retired by 0101), noncannabis_sku_sequences (used by
  SQL trigger/sequence logic), kb_noncannabis_catalog (view, RLS-hardened in
  0130), syndication_sync_state/settings (read via engine-store), brand_aliases
  (KB retrieval), integration_credentials (credential store).
- revalidatePath: 56 targets — all real except the two fixed above.
- fetch(): all 30 in-app fetch targets resolve to real API routes.
- Registries (journey-core, work-queue-core, hub, help-content, sop-core,
  ReportTabs, settings index): every href resolves to a real route.
