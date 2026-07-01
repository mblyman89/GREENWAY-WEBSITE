# Handoff-Ready Roadmap — Back-Office Enhancements (first) → POS Front End (after)

Status: PLAN ONLY. No build authorized yet. Sequenced per owner's rule: finish the enhancement
section before starting the POS front end. Grounded in an actual file-tree walk (state noted per item).
Standing rules apply: never guess, compliance-safe, money in cents, idempotent migrations applied
manually by owner, branch + PR + squash-merge, drafts-only from AI, ask if unsure.

Legend: [BUILT]=already exists, [PARTIAL]=some pieces exist, [MISSING]=needs building.
Each slice = one branch + one PR.

---

## SECTION 1 — BACK-OFFICE / WEBSITE ENHANCEMENTS (do these first, in this order)

### E1 — Marketing & Advertising page + GPT-4o compliant-strategy assistant  [MISSING page]
Ground truth: `src/app/admin/marketing/` exists but only contains `midjourney/`. No marketing landing page.
Nav has an "Insights" group (3 items) — owner said "probably in insights."
- Add nav item **"Marketing"** (place in Insights group) in `src/components/admin/admin-nav-data.ts`.
- New page `src/app/admin/marketing/page.tsx`: cannabis marketing/advertising hub.
- **AI button → GPT-4o** action that returns WA/DOH-compliant marketing & advertising strategies.
  Must ground answers with web research (server action scrapes/searches reputable sources) and must
  encode DOH advertising restrictions (no youth appeal, required warnings, no false health claims, etc.)
  as guardrails in the prompt. AI output is **draft-only** — clearly labeled.
- **Save-idea** capability: a table `marketing_ideas` (idempotent migration; owner applies) to log/star
  good AI suggestions with text, created_by, created_at, tags. Simple list UI to review saved ideas.
- Acceptance: page renders under Insights; AI returns compliant strategies with cited sources; ideas save
  and reload; DOH ad rules enforced in the prompt; no compliance claims stated as fact without a source.

### E2 — Back-office menu dropdown hover behavior  [PARTIAL — bug]
Ground truth: top-nav dropdown "disappears immediately / hard to use."
- Fix the hover/close timing on the header tab dropdown (add hover-intent / small close delay, keep open
  while pointer is between trigger and menu, close on outside-click/Escape). Keyboard accessible.
- Acceptance: dropdown stays open long enough to click items; works with mouse + keyboard; no flicker.

### E3 — Image prompt builder: Flux multi-image (up to 8) upload + pro features  [PARTIAL]
Ground truth: `src/components/admin/marketing/MidjourneyBuilder.tsx` + `src/app/admin/marketing/midjourney/`.
- Add a Flux section (or extend builder) allowing **up to 8 reference/target images uploaded
  simultaneously** for generation. Validate count (≤8), type, size; upload to Supabase Storage.
- Pro/expert features: per-image weight/role labels, aspect ratio, seed, negative prompt, style presets,
  batch count, reuse-last-settings. All optional, sensible defaults.
- Acceptance: 8 images upload and preview; generation request includes them; guardrails on count/type/size;
  settings persisted per session.

### E4 — Two new strain types: "indica leaning hybrid" & "sativa leaning hybrid"  [MISSING]
Ground truth (verified canonical set): `src/lib/syndication/menu-feed-core.ts`
`const VALID_STRAIN = new Set(["indica","sativa","hybrid","cbd"]);` + `normalizeStrainType()`.
This is a CCRS-adjacent classification — confirm the two new values are acceptable in our own data model
(CCRS strain semantics: keep the CCRS export mapping valid — map both new values to the closest
CCRS-accepted category if CCRS doesn't accept the leaning labels; store the granular label ourselves).
Propagate the two new values through EVERY place strain_type is validated / stored / displayed / filtered:
- `VALID_STRAIN` + `normalizeStrainType` (add both, with normalization of spacing/casing/synonyms).
- Inventory intake product form field (add options).
- Website shop-page filter options (add two filters).
- Menu rendering/labels.
- Any DB check constraint / enum on `strain_type` (idempotent migration; owner applies).
- CCRS export mapping: ensure the export still emits a CCRS-valid value (map leaning→base if required),
  while retaining the granular label internally. **Verify against CCRS before finalizing the mapping.**
- Acceptance: both new types selectable at intake, filterable on shop page, render on menu, pass syndication
  validation, and produce a CCRS-valid export. Grep confirms no remaining hardcoded 3/4-value strain lists.

### E5 — Global AI chatbot (baby-steps guide to the whole system)  [PARTIAL — extend concierge]
Ground truth: `src/lib/admin/ai-setup-assistant.ts` → `answerSetupQuestion()` grounded by SETUP_GUIDE;
`src/components/admin/GettingStartedWizard.tsx`.
- Extend the concierge into a **global assistant** available across back office, website admin, and
  (later) the POS. Grounded knowledge base covering back-office features, website, and POS operations.
- "Baby steps" mode: walks a user through any feature step by step. Draft-only for anything actionable.
- Reuse `isAiConfigured`; keep answers grounded (retrieve from a curated feature guide, not free hallucination).
- Acceptance: assistant reachable from every admin screen; answers operational questions with grounded,
  step-by-step guidance; clearly labels AI output; degrades gracefully if AI not configured.

### E6 — Newsletter engagement stats surfacing  [PARTIAL — tracking BUILT, surfacing TBD]
Ground truth: engagement tracking EXISTS — `src/lib/reports/newsletter-stats(-core).ts`,
`src/lib/cms/email-events/` (normalize-core, ingest-store, verify-core; Resend/SendGrid webhooks).
`src/app/admin/newsletter/page.tsx` shows Published/Recipients/From but NOT open/click engagement.
- Surface existing delivered/opened/clicked stats as StatCards + a small per-newsletter breakdown on the
  newsletter page. No new tracking needed unless verification shows gaps.
- Acceptance: newsletter page shows open rate, click rate, delivered counts sourced from existing stats;
  numbers reconcile with `newsletter-stats-core.ts` output.

### E7 — Inventory intake auto-fills manifest fields from Vendors  [PARTIAL — schema BUILT]
Ground truth (verified, WAC 314-55-085): migration `supabase/migrations/0044_manifest_transport.sql`
already adds to `inbound_manifests`: transporter_name, transporter_license, driver_name,
driver_license_number, vehicle_description, vehicle_plate, vehicle_vin, departed_at, arrived_at,
route_notes, transport_recorded_by, transport_recorded_at.
- Verify the intake FORM surfaces ALL manifest fields (date, vendor license #, origin license NAME,
  all driver info) and **auto-fills them from data saved on the Vendors page** where available.
- Confirm this is a CCRS/DOH requirement (it is — manifest/transport recordkeeping) and label accordingly.
- Add any missing form fields; wire vendor→intake autofill; keep manual override.
- Acceptance: selecting a saved vendor pre-populates license#, origin name, and driver/vehicle fields;
  all fields persist to `inbound_manifests`; Manifest.CSV export contains them; matches WAC 314-55-085.

### E8 — Menu-imports hardening + "clean slate" test-data reset  [PARTIAL]
Ground truth: `src/lib/pos/` has preview-menu, import-service, menu-version, transform, etc.
- Harden the menu-imports page for the **Cultivera → website final transition** data transfer. Research
  CCRS-safest best practices (validate before commit, dry-run/preview, reconciliation report, keep
  validated knowledge base intact). Tie into the cutover plan in `CCRS_SELF_REPORTING_GUIDE.md` Part B.
- Add a **"Clean Slate" button** that erases ONLY TEST DATA — a specific test menu upload, accepted test
  JSONs, and **test sales** — **WITHOUT touching the validated knowledge base**. Must be explicit,
  confirm-gated, scoped by a test-data flag/tag, logged, and reversible-by-design (soft delete or export
  first). NEVER deletes validated/live records.
- Acceptance: import supports dry-run + reconciliation; clean-slate removes only flagged test artifacts,
  leaves validated data untouched, requires confirmation, and writes an audit log entry.

### E9 — Vendor ACH payment portal UI  [MISSING UI — core BUILT]
Ground truth (verified): `src/lib/payments/vendor-ach-core.ts` exports `validateVendorPayments`,
`vendorPaymentsToNacha`, `__runVendorAchTests`; `nacha-core.ts` exists. NO UI page (grep of `src/app`
for those exports returned nothing). Payroll ACH page exists as a template.
- Tell owner: the vendor ACH **logic exists but the UI page was skipped.**
- Build the vendor ACH portal UI **using the payroll ACH page as the template**, wired to the existing
  `validateVendorPayments` + `vendorPaymentsToNacha` cores. Money in **cents**. Show validation problems
  before generating the NACHA file; downloadable NACHA output; audit log.
- Acceptance: page lists vendor payments, validates, surfaces problems, generates a correct NACHA file
  via the existing core, mirrors payroll ACH UX; amounts handled in minor units.

### E10 — Preview banner → glowing bottom-right preview BADGE  [PARTIAL]
Ground truth: `src/components/site/PreviewEditOverlay.tsx` (111 lines) renders preview hotspots + a slim
top banner during Draft Mode; talks to admin `PreviewFrame` via postMessage.
- Explain the green preview bar to owner (it indicates Draft/Preview mode; it currently overlaps the top
  header tabs).
- Convert the top banner into a **badge fixed to the bottom-right corner** that **glows** (animate between
  green and green-glow) to signal preview mode. Must NOT block the top header tabs.
- Provide a clear way to **re-enter preview mode** after exiting.
- Acceptance: no top overlap; bottom-right glowing badge shows when in preview; header tabs fully clickable;
  a control re-enters preview mode; postMessage behavior preserved.

### E11 — Reorganize top header tabs into logical buckets  [PARTIAL]
Ground truth: `admin-nav-data.ts` groups today: Operations(15), Catalog(10), Content(5), Pages(9),
Insights(3), Admin(9). 15 in Operations is crowded.
- Reorganize/rebalance groups like a pro; add any new tabs needed (Marketing from E1 → Insights). Propose
  a clean grouping (e.g., split Operations into Operations vs Compliance vs Finance if it clarifies).
- Keep permissions/icons intact; no dead links; preserve `comingSoon` flags.
- Acceptance: groups are balanced and intuitive; every item keeps its permission + working href; owner
  approves the proposed grouping before merge.

### E12 — Quick-search button: remove text label (circle only)  [PARTIAL]
Ground truth: `src/components/admin/HelpLauncher.tsx`, `src/components/admin/CommandPalette.tsx`.
- Remove the visible "quick search" text so the bottom-left control is just the circle (it currently
  covers things). Keep an aria-label/tooltip for accessibility.
- Acceptance: only the circle shows; nothing is obscured; still keyboard/screen-reader accessible; opens
  the command palette as before.

### E13 — Integrations page: extensive helpers + AI assistance  [PARTIAL]
Ground truth: `src/app/admin/integrations/` has page.tsx, CredentialsEditor.tsx, credential-actions.ts,
`leafly/`, `weedmaps/`.
- Add step-by-step helpers for connecting each integration (Leafly, Weedmaps, and any others), plus AI
  assistance (reuse the global assistant from E5, scoped to integration setup). Grounded, draft-only.
- Acceptance: each integration has a guided setup with prerequisites, where to get credentials, and a
  test-connection check; AI helper answers integration questions with grounded steps.

---
(continued in ROADMAP_ENHANCEMENTS_AND_POS_PART2.md — POS build + sequencing + questions)
