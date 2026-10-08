# Migrations to run manually (Supabase SQL editor)

> Per the standing rule, migrations are applied **manually by the owner** in the
> Supabase SQL editor. Every migration below is **idempotent** — safe to paste
> and re-run. Run them in numeric order. Check each off after running.

## Command Center Enhancements (Batch 2+)

- [ ] **`supabase/migrations/0054_trade_samples.sql`** — Slice 71 (item 6).
  Adds `public.trade_sample_settings` (singleton: enforce/hard_block + WAC
  314-55-096 quarterly caps and per-unit size caps) and
  `public.trade_sample_events` (the incoming/outgoing sample ledger). RLS:
  staff read; admin write settings; staff all on events. No data backfill
  needed — the settings row is seeded with statutory defaults on insert.
  **Until this is run, `/admin/compliance/samples` will show default caps and
  cannot persist events.**

- [ ] **`supabase/migrations/0055_flux_credentials.sql`** — Slice A (item 19).
- [ ] **`supabase/migrations/0056_kb_notes.sql`** — Slice 75 (item 14): owner-uploaded KB reference notes.
- [ ] **`supabase/migrations/0057_payroll_ach.sql`** — Slice B (item 20): manual-entry
  payroll → NACHA ACH. Adds `bank_routing` / `bank_account_number` /
  `bank_account_type` to `public.employees`; a singleton
  `public.ach_company_settings` (destination routing/name, immediate origin,
  company name/id, originating DFI, entry description default `PAYROLL`);
  `public.payroll_runs` (label, pay_date, status, total_*_cents, entry_count,
  nacha_filename, file_id_modifier, generated_at, notes); and
  `public.payroll_run_lines` (per-employee net/gross/taxes/deductions cents +
  banking snapshot). RLS: `ach_company_settings` staff-read/admin-write;
  `payroll_runs` + `payroll_run_lines` admin-only. No data backfill.
  **Until this is run, `/admin/payroll` cannot save the ACH company block, any
  employee banking, or generate a NACHA file.**
- [ ] **`supabase/migrations/0058_webauthn_passkeys.sql`** — Slice D (item 22):
  biometric (Face ID / Touch ID) sign-in. Adds `public.webauthn_credentials`
  (passkey bound to an `auth.users` id: Base64URL id, COSE public key bytea,
  counter, device_type, backed_up, transports CSV, label, last_used_at) and a
  short-lived `public.webauthn_challenges` table (service-role only). RLS:
  credentials owner-read/rename/delete (inserts via verified service-role only);
  challenges have NO policies (service-role only). No data backfill.
  **Until this is run, the "Add passkey" button on Settings → Security and the
  "Sign in with Face ID / Touch ID" button on the login screen will error.**
  Adds three columns to the existing `public.integration_credentials` singleton
  (`flux_api_key`, `flux_endpoint` default `flux-2-max`, `flux_base_url`) for the
  Black Forest Labs FLUX 2 image pipeline. RLS is inherited from migration 0053
  (admin read/write). No data backfill — the empty row already exists.
  **Until this is run, the FLUX API-key field on Settings → Integrations has
  nowhere to save, so "Generate with FLUX 2" stays disabled.**

- [ ] **`supabase/migrations/0059_intake_lot_disposition.sql`** — Slice 81
  (Batch 2d #1 + #4): CCRS-compliant partial acceptance / reject-at-dock. Adds to
  `public.inventory_lots`: `disposition` (`pending|accepted|rejected_at_dock`,
  CHECK-guarded), `reject_reason`, `reject_reason_code`, `dispositioned_by`,
  `dispositioned_at`; backfills existing active/sold/recalled lots to
  `disposition = 'accepted'`. Adds to `public.inbound_manifests`:
  `accepted_lot_count`, `rejected_lot_count` (both default 0). No CHECK on
  `inbound_manifests.status`, so the new `partially_accepted` value needs no
  schema change. **Until this is run, the per-line Accept/Reject controls,
  Finalize intake, and the "Partially Accepted" badge on the intake page will
  error (missing columns).** Note: this deliberately CHANGES old behavior — a
  reject no longer marks lots `destroyed`; refused product is `rejected` (never
  received), per docs/ccrs-rejection-and-returns.md.

- [ ] **`supabase/migrations/0060_medical_form_scans.sql`** — Slice 85
  (efficient medical authorization intake): stores the SCANNED authorization form
  (from the Canon PIXMA TS3522 flatbed) with each authorization so the DOH 608-048
  record is complete and auditable (5-year retention, WAC 314-55-090(2)). Creates
  a PRIVATE `medical-forms` storage bucket with staff-only read/write policies on
  `storage.objects`. Adds to `public.patient_authorizations`: `form_scan_path`,
  `form_scan_filename`, `form_scan_bytes` (int), `form_scan_uploaded_at`
  (timestamptz), `form_scan_uploaded_by` (FK `staff_profiles`), and `card_printed_at`
  (timestamptz); plus index `patient_auth_scan_uploaded_idx`. No data backfill.
  **Until this is run, guided-intake scan uploads on `/admin/medical` and the
  "mark printed" action will error (missing bucket/columns).**

- [ ] **`supabase/migrations/0061_seed_owner_hardware.sql`** — Slice 86: seeds the
  owner's integrated hardware into the EXISTING equipment registry
  (`public.equipment_assets`, 0046) so it shows on `/admin/equipment`: Star
  Micronics TSP143IV (receipt printer, `PRN-RECEIPT-01`), Rollo Wireless X1040
  (label printer, `PRN-LABEL-01`), Canon PIXMA TS3522 (scanner, `SCAN-MEDICAL-01`),
  and Scotch Thermal Laminator (`LAMINATOR-01`). Data-only INSERT with
  `on conflict (asset_tag) do nothing` (uses the 0046 partial unique index), so
  re-running does nothing and never overwrites owner edits. **Optional** — the
  "Your integrated hardware" card on `/admin/equipment` links to each device even
  before this runs; this just adds them as editable registry rows.

- [ ] **`supabase/migrations/0062_inbound_email_log.sql`** — Slice 99: audit trail
  for the inbound `vendor_intake@` mailbox. Adds `public.inbound_email_log`
  (provider, from/to, subject, received_at, signature_ok, to_intake,
  attachment_count, disposition `received|ignored|no_manifest|staged|parse_failed`,
  `manifest_id` FK → `inbound_manifests` on delete set null, note, raw_headers) with
  two indexes. RLS: authenticated staff **read-only** (the service-role webhook does
  all writes). No data backfill. **Optional but recommended** — inbound email still
  stages draft manifests without it, but you lose the arrival audit log rows.

---

## Phase A — Sale-path integrity (compliance blockers)

- [ ] **`supabase/migrations/0096_sale_path_gates.sql`** — Phase A (GAP H-1/H-2):
  adds `order_lines.category` (placement-time category snapshot used by the
  completion limit gate + tax math), `orders.limit_flag` + `orders.limit_reasons`
  (placement-time WAC 314-55-095 soft-check annotation), and **DROPS the
  anonymous INSERT RLS policies** on `orders` / `order_lines` / `order_events`
  (placement now runs exclusively through the service-role `POST /api/orders`
  route, which reprices every line server-side). No data backfill; legacy order
  lines without a category are resolved from the live menu (or conservatively
  counted as useable cannabis) by the completion gate. **Until this is run, the
  code falls back to the legacy insert shape (orders still work), but the
  limit-flag banner and the anon-insert lockdown are not active.**

---

### How to run
1. Open the Supabase project → **SQL editor**.
2. Paste the full contents of the migration file.
3. Run. Because every statement uses `if not exists` / `on conflict do nothing`
   / `drop ... if exists` before `create`, re-running is harmless.
4. Check the box above.

---

## Phase C — compliance roadmap S-6 (retention guard)

- [ ] **`supabase/migrations/0097_reset_retention_guard.sql`** — S-6 (GAP M-3):
  replaces `reset_operational_data()` with a guarded version taking
  `acknowledge_wac_314_55_087 boolean default false`. When completed orders or
  recorded CCRS export/adjustment batches exist, the wipe REFUSES unless called
  with the acknowledgement — WAC 314-55-087 requires FIVE-year record
  retention (three years until WSR 24-19-040, effective 10/12/2024), so
  post-go-live data can't be destroyed by accident. The delete
  body is byte-for-byte the 0069 set (same tables, same child→parent order).
  Drops the old zero-arg signature first so the PostgREST rpc name stays
  unambiguous; idempotent to re-run. **The Danger Zone page now requires an
  export-first attestation checkbox + the escalated phrase
  `RESET OPERATIONAL DATA (WAC 314-55-087)`; until this migration is applied
  the app falls back to the legacy zero-arg call, so nothing breaks.**

---

## Task P — medical guided intake polish

- [ ] **`supabase/migrations/0114_medical_intake_polish.sql`** — Task P (run
  AFTER `0113_medical_pipeline.sql`): adds to `public.patient_authorizations`:
  `authorization_issued_on` (date — the day the health care professional
  issued the authorization, the anchor for the RCW 69.51A.230(4) statutory
  expiration maximum), `card_fee_collected` (boolean, default false — the
  minimum $1 registration fee, RCW 69.51A.230(10)), `photo_uploaded_to_mcr`
  (boolean, default false), and `compassionate_renewal` (boolean, default
  false — photo-exempt renewals per RCW 69.51A.230(4)(b)). Idempotent; no
  data backfill. **Until this is run, the guided intake wizard still works —
  `createAuthorization` detects the missing columns (error 42703) and
  gracefully retries the insert without them, so only the four new audit
  fields go unrecorded.**

---

## Task Q — returns & destruction command center

- [ ] **`supabase/migrations/0115_disposition_command_center.sql`** — Task Q:
  1. **`public.customer_returns`** (new table) — one row per accepted
     customer return: the original order/line, the CCRS Sale-row snapshot
     (Sale/SaleDetail external identifiers, inventory external identifier,
     sale type/date, unit price / discount / sales tax / excise in MINOR
     UNITS), the WAC 314-55-079(12) attestations (original packaging +
     legible lot ID), disposition (restock|destroy), the refund, and the
     queued CCRS Sale correction (`correction_operation` Delete|Update,
     `correction_status` pending|exported). RLS: staff all.
  2. **`public.destruction_events`** — adds the WAC 314-55-097 waste-record
     columns: `rendering_method`, `mix_material`, `final_destination`,
     `disposal_facility`, plus the WAC 314-55-225 recall-coordination fields
     `lcb_coordinated`, `lcb_officer`, `lcb_contact_date`.
  3. **`public.vendor_returns`** — adds the WAC 314-55-085 manifest workflow
     columns: `manifest_number`, `manifest_status`
     (none|requested|submitted|confirmed|picked_up), `pickup_at`,
     `processor_license`.
  4. **`public.disposition_settings`** (new singleton) — `hold_hours`
     (default 72, 0–336): the pre-destruction hold is now a configurable
     STORE POLICY (the old 72-hour LCB notice was removed from
     WAC 314-55-097 by WSR 22-14-111). RLS: staff read, admin write.

  Idempotent; no data backfill. **Until this is run, the page still works —
  the store detects the missing schema and degrades gracefully: destruction
  scheduling/completion and vendor returns use the legacy columns, the hold
  defaults to 72h, and customer returns tell you to apply 0115 first (any
  posted adjustment is called out for manual reversal).**

## Fix slice — GW-018 (login page could create staff accounts)

- [ ] **`supabase/migrations/0127_staff_profiles_inactive_by_default.sql`** —
  GW-018 (database half): the `handle_new_auth_user` trigger now provisions
  new auth users as **inactive** staff profiles, and the `staff_profiles.active`
  column default flips to `false`. Invites are unaffected (the invite action
  sets role + active=true explicitly), and so is the bootstrap-owner path.
  Idempotent; no data backfill — existing rows are untouched. The file ends
  with an optional read-only review query: run it once and confirm every
  ACTIVE profile is someone you actually invited; deactivate strangers from
  `/admin/users`. **Until this is run, the code half (`shouldCreateUser: false`
  on the login form) already blocks the public door on its own — this
  migration is the belt-and-braces layer underneath it.**

## Fix slice — GW-023 (a crashed sync could silently lose a sale)

- [ ] **`supabase/migrations/0128_pos_pending_recovery.sql`** — GW-023
  (database half): two columns that make the stranded-sale recovery loop safe.
  (1) `pos_sale_events.recovery_attempts` — counts automatic recovery re-runs
  so a poison event escalates to the manager exception queue after 3 tries
  instead of retrying forever. (2) `orders.pos_client_uuid` + a UNIQUE index —
  the database itself now refuses to create TWO orders for the same register
  event, no matter how the code crashes; existing POS orders are backfilled
  from the breadcrumb in their staff note. Idempotent; safe to re-run. The
  file ends with two read-only review queries — run each once: (a) lists any
  register events currently stranded mid-processing (healthy = zero rows),
  (b) checks whether any PAST crash already double-created an order
  (healthy = zero rows). **Until this is run, the code half already recovers
  stranded sales on the register's next flush and via the daily sweeper —
  this migration adds the attempts cap and the absolute double-order
  guarantee underneath it.**

## Fix slice — GW-011 + GW-012 (completion races and lost inventory updates)

- [ ] **`supabase/migrations/0129_concurrency_guards.sql`** — GW-011 + GW-012
  (database half): the concurrency guards under the code fix. (1) Partial
  UNIQUE indexes so the "have I already run?" markers for the inventory
  decrement, the void restock, and the loyalty EARN are enforced by the
  database itself — two requests completing the same order at the same
  instant can no longer decrement stock twice or pay points twice (any
  pre-existing double markers/earns are deduped first, keeping the oldest,
  and cached loyalty balances are recomputed from the ledger). (2) Two tiny
  atomic-delta functions (`apply_lot_delta`, `apply_variant_delta`) so every
  quantity change is computed BY the database under its own row lock —
  two overlapping sales of the same product can no longer silently lose a
  unit — plus a `check (on_hand_qty >= 0)` constraint so a lot can never go
  negative. Idempotent; safe to re-run. The file ends with three read-only
  review queries — run each once: (A) confirms both unique guards exist,
  (B) confirms no order ever earned points twice (healthy = zero rows),
  (C) confirms no lot is negative (healthy = zero rows). **Until this is
  run, the code half already prevents the same-order race on its own (the
  status flip is now compare-and-swap) and falls back to the old quantity
  writes — this migration adds the database-enforced guarantees underneath
  it.**

## Fix slice — GW-019 + GW-020 (security / insider-threat hardening)

- [ ] **`supabase/migrations/0130_security_rls_hardening.sql`** — GW-019 +
  GW-020: makes the database itself the last line of defense against anyone
  holding the public browser key or a staff login token. (1) The four tables
  that had NO row-level security (glassware products with wholesale costs,
  their adjustment ledger, the SKU counters, the KB category taxonomy) are
  locked down — anonymous read/write dies, managers keep read where they
  need it, all writes go through the app. (2) The employee roster tightens
  to manager+ read with NO direct write path, and the PIN hash + bank
  account columns become unreadable to every login token — only the app's
  own payroll path can reach them. (3) Every change to the roster is now
  recorded by the database itself (values redacted) so no code path can
  skip the audit trail, and the audit log becomes append-only — history
  cannot be rewritten even with the server's own key. Idempotent; safe to
  re-run. The file ends with five read-only review queries — run each once:
  (A) zero tables without RLS, (B) the roster's only policy is manager
  read, (C) zero sensitive-column grants, (D) the audit trigger is armed,
  (E) the audit log is append-only. **Until this is run, the app works
  normally but the database-level protections are not active — the old
  broad policies remain in force.**

## Fix slice — GW-009 (Pacific-day medical dates)

- [ ] **`supabase/migrations/0131_pacific_sale_date_default.sql`** — GW-009:
  the medical exempt-sale ledger's `sale_date` column defaulted to the
  DATABASE server's calendar day, which on Supabase is UTC — so an evening
  exempt sale (after 4/5 PM Pacific) on the last day of the month was
  stamped with NEXT month's date in the WAC 314-55-090(2) ledger, the
  LIQ-1295 excise return, and the CCRS RecreationalMedical period. The app
  code now writes the store's Pacific day explicitly on every insert; this
  migration also re-points the column default at the Pacific calendar day
  (`now() at time zone 'America/Los_Angeles'`) so any future insert path
  that forgets the column still gets the correct store-local date.
  DST-aware; idempotent; safe to re-run. No backfill needed. The file ends
  with one read-only review query — run it and expect the default to show
  `America/Los_Angeles`. **Until this is run, the app still stamps the
  correct Pacific date itself — the database default is just the backstop.**

## Fix slice — GW-027 (rejected rows visible to the back office)

- [ ] **`supabase/migrations/0132_pos_device_rejected_report.sql`** — GW-027:
  when the server REJECTS a register event (refused before it ever enters
  the ledger — malformed envelope, foreign device), that row lives only on
  the register iPad itself. The old register copy claimed a manager would
  see those rows in the back office, which was not true. The registers now
  report their rejected-row count and a short summary with every sync, and
  this migration adds the three columns that store the report on each
  device row (`rejected_count`, `rejected_note`, `rejected_reported_at`).
  Idempotent (`add column if not exists`); safe to re-run; no backfill
  needed. **Until this is run, the app works normally — the register keeps
  and shows its rejected rows locally, and the server simply skips storing
  the report (best-effort write). Once run, Admin → Register Activity and
  the POS devices page start showing "N rejected events held on this
  device" automatically.**

## Feature slice — special discounts (employee / industry / veteran)

- [ ] **`supabase/migrations/0133_special_discounts.sql`** — the three special
  discount programs, kept deliberately OUT of the promotions engine. Creates
  `special_discount_settings` (one row per program, percent in basis points)
  seeded with your rates — employee 35% on, veteran 15% on, industry off at
  0% until you pick a rate — and `special_discount_uses`, the tracking ledger
  that records every single use: which cashier gave it, on which register,
  which employee bought (plus the OTHER employee who approved by PIN), the
  visitor's company name for industry, the military-ID-checked confirmation
  for veterans, and the exact cents saved. Row-level security matches 0130:
  managers can read, and only the app's server code can write. Idempotent
  (`create table if not exists`, seed via `on conflict do nothing` so it
  never overwrites rates you've changed); safe to re-run. **Until this is
  run, the new Admin → Settings → Special Discounts page shows the built-in
  defaults and saving is politely refused with a note to run this migration
  — nothing else in the app is affected.**

## Feature slice — tips in the end-of-shift count-out

- [ ] **`supabase/migrations/0134_drawer_tips.sql`** — one new column,
  `drawer_sessions.tips_minor`, recording the tips counted out at the end
  of a shift (in cents). Tips are the employee's money, not store cash, so
  this figure deliberately stays OUT of the drawer math: expected close is
  still opening float + cash sales − safe drops, and over/short still
  compares the blind drawer count against that. A blank value means tips
  simply weren't recorded (every close from before this feature), and 0
  means the cashier explicitly counted a zero tip jar. Idempotent
  (`add column if not exists`); safe to re-run; no backfill needed.
  **Until this is run, the app works normally — the close screen shows the
  new Tips box and the close always succeeds, but the tip amount is quietly
  skipped when saving (best-effort write, same pattern as 0120's device
  stamp). Once run, tips start appearing on the reconcile cards and in
  Admin → Register Activity → Cash drawer reports automatically.**

## Feature slice — master till / safe

- [ ] **`supabase/migrations/0135_safe_counts_swaps.sql`** — the store safe
  (your $1,000 master change fund) becomes a tracked, audited thing. Two
  new tables: `safe_counts` records each manager count of the safe —
  twice a day, morning and evening — with the full bill-and-coin
  breakdown, the counted total, the expected $1,000, and the variance
  (safe counts are open, not blind: the target is known policy, so the
  manager sees the variance live while counting). `safe_swaps` records
  every change swap between a register and the safe — the cashier puts
  big bills in and takes the exact same value out in change, so no money
  moves on net, but every trip into the safe now leaves a record with
  the cashier's PIN and a manager's approval PIN. Read access is
  manager-and-up; all writes go through the app's server code only
  (same hardened security posture as the special-discounts tables).
  Idempotent; safe to re-run. **Until this is run, the new Safe page in
  the back office politely says to run this migration, and the swap
  button on the register returns a clear "run migration 0135" message —
  a swap can't be best-effort, because an untracked trip into the safe
  is exactly what this feature exists to prevent. Nothing else in the
  app is affected.**

## Feature slice — employee handbook acknowledgment gate

- [ ] **`supabase/migrations/0136_handbook_acknowledgments.sql`** — one new
  table, `handbook_acknowledgments`: every staff member must READ the
  employee handbook and check the acknowledgment box (typing their full
  name) before the back office or a register will let them in. One row
  per person per handbook version — when you update the handbook and
  bump its version, everyone re-reads and re-acknowledges. Rows are
  evidence: staff can record only their OWN acknowledgment, and nobody
  can edit or delete one afterwards. Owners are exempt (you wrote the
  policies — you can never be locked out of your own store). Idempotent;
  safe to re-run. **Until this is run, the app works normally and the
  gate stays OPEN for everyone — a missing table must never lock your
  whole staff out. The Employees roster shows a gold notice reminding
  you to run it; once run, unacknowledged staff see the handbook (with
  the checkbox at the bottom) instead of the back office, and a PIN
  unlock at the register is politely refused until they acknowledge —
  either digitally, or by you marking their signed paper copy in their
  employee file.**

## Feature slice — regulatory compliance command center (rule-change radar)

- [ ] **`supabase/migrations/0137_regulatory_watch.sql`** — four new
  tables behind the Regulatory Watch page (CCRS — command center —
  Regulatory Watch): `regulatory_sources` (the watched LCB feeds and
  pages, pre-seeded — including the LCB's GovDelivery bulletin feed
  that the daily cron polls), `regulatory_items` (every bulletin,
  forwarded LCB email, or pasted notice — deduplicated so the same
  bulletin never appears twice), `regulatory_analyses` (the AI's
  plain-English briefing for an item: rulemaking stage, impact,
  affected areas, deadlines, strategy), and `regulatory_roadmap_items`
  (the task list the AI proposes and you accept/start/finish/dismiss).
  Staff can read; only the server writes. Idempotent; safe to re-run.
  **Until this is run, the app works normally — the Regulatory Watch
  page shows a friendly setup notice instead of data, and the daily
  cron quietly does nothing. Once run, the radar goes live: bulletins
  flow in daily, deadlines land on the timeline, and the AI (when
  configured) writes briefings and proposes roadmap tasks.**

## PROGRAM 3 / SLICE 54 — golden-record groundwork (structured product facts)

- [ ] **`supabase/migrations/0138_structured_product_facts.sql`** — adds the
  dedicated "boxes" for facts that were previously trapped inside product
  names (docs/data-governance.md, Rules 1.3/1.4): `strain_type` on
  `inventory_lots`, plus structured dose/measure columns on BOTH
  `inventory_lots` and `menu_items` (`servings_per_pack`, `mg_per_serving`,
  `package_thc_mg`, `package_cbd_mg`, `minor_cannabinoids_json`,
  `ratio_label`, `net_weight_grams`, `net_volume_ml`, `fact_provenance`),
  with indexes on strain type and ratio. It ALSO runs the owner-approved
  strain-name cleanup: bare "Indica"/"Sativa"/"Hybrid" strain values move
  into the strain-type box (name goes empty), and embedded type words
  ("Chocolate Turtle Sativa", "Cinnamon (Sativa)") are stripped from the
  name with the type captured — "CBD" is deliberately NOT treated as a type
  word so real strain names like "Xtra Dragon CBD" stay intact. Idempotent:
  safe to re-run.
  **IMPORTANT — run this BEFORE receiving your next manifest or running the
  Cultivera import: intake and import now write the `strain_type` column, and
  Supabase REJECTS inserts that name a column that does not exist yet, so
  receiving will fail with a database error until this migration is applied.
  The inventory-table Strain Type column simply shows an em-dash until then.**

## PROGRAM 3 / SLICE 57 — golden-record fact-review queue

- [ ] **`supabase/migrations/0139_fact_review_queue.sql`** — creates
  `pos_fact_reviews`, the decision log for the new import Fact Review
  screen (Menu Imports → open an import → “Open fact review”). Each row
  records ONE human decision per flagged product: approve as staged, fix
  (with the corrected values, applied to the staged menu item with
  provenance “reviewer”), or reject (hides the item with a documented
  reason). Staff can read; only the server writes. RLS enabled.
  Idempotent; safe to re-run.
  **Until this is run, the Fact Review screen still works for LOOKING —
  buckets, notes, and the CSV export all render from existing data — but
  saving an approve/fix/reject decision fails with a friendly database
  error message. Run it before you start working the exception queue.**

## SLICE 60 — reset coverage sweep

- [ ] **`supabase/migrations/0140_reset_coverage_sweep.sql`** — replaces
  `reset_operational_data()` with the same guarded wipe (identical S-6 /
  WAC 314-55-087 retention guard from 0097) extended to the newer
  operational tables the old version missed: register sale events,
  receipt print jobs, safe counts & swaps, special-discount uses,
  customer returns, non-cannabis invoices/lines/adjustments, CCRS week
  submissions & compliance reminder log, sample JSON imports, payroll
  source documents, and the fact-review decision log. Deletion order is
  verified child→parent. Still keeps everything you curate: settings,
  knowledge base, media, site content, product masters/enrichments,
  brands & vendors, non-cannabis products, promotions, people/hardware,
  and the audit log. Idempotent; safe to re-run.
  **SUPERSEDED for go-live purposes — see D-62.** This file was measured in
  books-80 and it is sixty-eight migrations stale. It deletes from 66 of the
  250 tables that now exist, and the 184 it never touches include the ENTIRE
  general ledger (`gl_journals`, `gl_journal_lines`, `gl_periods`,
  `gl_audit_events`), because the ledger was born at migration 0172 — thirty-two
  migrations AFTER this sweep was written. It also leaves
  `payroll_ytd_accumulators` and `sick_leave_ledger` behind, either of which
  would corrupt the first real W-2. Running it before go-live would delete your
  test SALES and keep every test JOURNAL ENTRY. Still apply it in numeric order
  (it is harmless and keeps the numbering intact), but **do not rely on it for a
  clean November 1st start.** Use `0209_factory_reset.sql` for that.

## SLICE 64 — manual classification at draft approval

- [ ] **`supabase/migrations/0141_draft_classification_choice.sql`** — adds
  two columns to `catalog_product_drafts`: `chosen_website_category` and
  `chosen_house_type`. These record the category/type YOU pick on the
  Product Onboarding approval card whenever the system can't classify a
  product at 90% confidence or better — your pick then outranks the
  machine when the product is placed on the menu, and the raw LCB/CCRS
  values stay untouched under the hood. Idempotent; safe to re-run.
  **Until this is run, approving a product that needs no picks keeps
  working exactly as before — but approving one where the form asked you
  to pick a category or type fails with a friendly message pointing at
  this migration. Run it before your next intake session.**

## SLICE 69 — exhaustive email harvest + document archive

- [ ] **`supabase/migrations/0142_intake_docs_archive.sql`** — creates the
  private `intake-docs` storage bucket (staff-only read/write) and the
  `public.manifest_documents` table that records every document harvested
  from a vendor intake email — the transfer JSON, the transportation
  manifest PDF, the invoice, the COA, and any extra PDFs — tied to the
  staged manifest, so the email intake table can offer OUR OWN archived
  downloads for every row instead of the vendor's expiring links.
  Idempotent; safe to re-run.
  **Until this is run, emails still stage manifests and the harvest
  checklist still runs, but nothing is archived — the Docs column keeps
  falling back to the vendor's short-lived links. Run it before your next
  intake email arrives.**

## SLICE 80 — payee banking vault

- [ ] **`supabase/migrations/0143_payee_banking_vault.sql`** — creates the
  `public.vendor_bank_details` table: one bank record per vendor (routing
  and account numbers encrypted at rest when `DATA_ENCRYPTION_KEY` is set),
  with an active/on-hold status and an out-of-band verification stamp.
  Owner/admin-only at the database level (RLS uses `is_admin()` for both
  read and write, plus explicit revokes) — managers and budtenders can
  never read a bank number even with a direct database connection. This is
  the tamper-proof source of truth: vendor ACH payments pull banking from
  this vault instead of hand-typed form fields, per WA State Auditor
  vendor-master-file fraud guidance. Idempotent; safe to re-run.
  **Until this is run, the Payee Banking page shows a friendly banner and
  the vendor payments page keeps the old manual bank-entry fields. Run it
  before paying your next vendor so the vault protections switch on.**

## SLICE 83 — emailed vendor menus

- [ ] **`supabase/migrations/0144_emailed_vendor_menus.sql`** — creates the
  `public.emailed_menu_snapshots` and `public.emailed_menu_items` tables:
  every menu a vendor emails to the `vendor_menu@` inbox is parsed (from the
  message body, HTML, or PDF/text attachments — with an AI assist when the
  deterministic parser can't read it) and saved here as a browsable snapshot
  with items priced in integer cents, potency, quantities, and any product
  images matched from the email. The Vendor menus page lists these snapshots
  next to the Cultivera and GrowFlow ones, and each snapshot's detail page
  hands selected items straight into the purchase-order builder. Staff-only
  RLS (`is_staff()`); idempotent; safe to re-run. Run it AFTER 0143.
  **Until this is run, emails to `vendor_menu@` are still logged in the
  inbound email log, but menu parsing fails with a friendly note and no
  snapshots appear on the Vendor menus page.**

## SLICE 84 — LeafLink vendor menus

- [ ] **`supabase/migrations/0145_leaflink_menus.sql`** — creates the
  `public.leaflink_menu_snapshots` and `public.leaflink_menu_items` tables:
  LeafLink becomes the THIRD marketplace in the unified vendor-menu search
  (next to Cultivera and GrowFlow). A brand's live LeafLink menu is fetched
  through the crawler worker with your own buyer login and saved here as a
  browsable snapshot — items priced in integer cents, potency, quantities,
  images, product lines, descriptions. The Vendor menus page lists these
  snapshots with an orange LeafLink badge, each snapshot's detail page can
  save product photos/COAs into the media library, and ticked items hand off
  straight into the purchase-order builder. Staff-only RLS (`is_staff()`);
  idempotent; safe to re-run. Run it AFTER 0144. No `vendor_platform_map`
  change is needed (the platform column is free text).
  **Until this is run, LeafLink search results still appear in the unified
  search, but fetching a brand's menu fails with a friendly note and no
  LeafLink snapshots appear on the Vendor menus page.**

## SLICE 93 — strain type at draft approval

- [ ] **`supabase/migrations/0146_draft_strain_type_choice.sql`** — adds one
  nullable `chosen_strain_type` column to `catalog_product_drafts`: the HUMAN
  strain-type decision made on the Product Onboarding approval card (our
  canonical strain-taxonomy value, e.g. `indica`, `sativa-hybrid`). The name
  parser + strain library + manifest fact auto-suggest at ≥90% confidence;
  this column only records an actual pick by the approver, which then outranks
  every machine signal at menu injection. Validated server-side against the
  closed taxonomy before any write, so no CHECK constraint is needed.
  Idempotent; safe to re-run.
  **Until this is run, everything else on the onboarding page keeps working —
  auto-detected strain types still flow to the menu and the strain library —
  but making a manual strain-type PICK shows a friendly banner naming this
  migration instead of saving.**

---

## BOOKKEEPING BRANCH — the general ledger (slices books-01 → books-04)

> **Plain-English walkthrough of how to actually run these:**
> see **`docs/HOW_TO_RUN_A_MIGRATION.md`**. It is written for the owner, step by
> step, with what success looks like and what to do when it goes red.
>
> **⚠️ READ THIS FIRST IF YOU ALREADY TRIED TO RUN 0185 (fixed 2026-08-17):**
> `0185_books_owner_only.sql` had a real bug that would have stopped it dead on
> the very first paste, and it was found the only way it could be found — by
> building a throwaway PostgreSQL database and actually running all 188
> migrations against it. The migration rewrites the accounting security policies,
> and to do that it first reads the list of roles each policy applies to. A
> policy written "to public" stores that as role number 0, and PostgreSQL renders
> role 0 as the literal text `unknown (OID=0)` rather than as `public`. That text
> was then pasted back into the rebuilt policy, producing
> `ERROR: syntax error at or near "("`.
>
> **Why it mattered so much:** the migration DROPS the old policies before it
> rebuilds them. Failing in the middle would have left the accounting tables with
> their old doors removed and the new ones not yet hung. (A migration runs inside
> a transaction, so the failure would have rolled back cleanly — but you would
> have been staring at a red error on step one of the books with no idea why.)
>
> **What to do:** nothing special. Just run the current file. The fix is one
> line — role 0 is now filtered out — and 0185 is idempotent, so running it now
> is correct whether or not you tried before.
>
> **⚠️ SECOND 0185 BUG, ALSO FIXED (2026-08-17):** rebuilding the database from
> scratch a second time exposed a separate defect, this time in the verification
> step rather than the migration body. `gl_audit_owner_only_gate()` finds
> problems by scanning every function in the database for the text `is_admin()`
> together with `GL_FORBIDDEN`. Because the audit function must quote those two
> strings in order to search for them, it matched **itself** and returned one row
> on a completely healthy database — directly contradicting the instruction
> "expect zero rows" printed below. Fixed by excluding `gl_audit_%` functions as
> a class (they are STABLE reporters that never gate anything, so excluding them
> cannot mask a real hole). **Verified both directions against live PostgreSQL
> 15:** zero rows on a clean database, and a deliberately planted function still
> gated on `is_admin()` is still detected. Pinned by
> `tests/compliance/journal-advisor-core.test.ts`.
>
> **✅ FULL-STACK VERIFICATION (2026-08-17):** all **188** migrations were applied
> in order to a fresh PostgreSQL 15 database — **0 failures** — and then the
> payroll stack was exercised end to end against that live database:
> `gl_audit_payroll_wiring()` returned **zero rows**; all **13** labor roles
> matched the TypeScript taxonomy exactly; the journal produced by
> `buildPayrollJournal()` was posted through the real `gl_post_payroll_run()` and
> the ledger came back **balanced to the cent (sum = 0)** with cost classes
> intact (`cogs_allocable` 120000, `nondeductible_280e` 779954); re-posting the
> same run was correctly ignored as a duplicate; re-posting *changed* numbers was
> **refused** (`GL_PAYROLL_RUN_CHANGED`); posting lines with the cost classes
> stripped was **refused** (`GL_PAYROLL_NO_COST_CLASS`); and under row-level
> security a manager saw **0** payroll rows while the owner saw all **13**.
>
> **NOTE ON NUMBERING (2026-08-17):** two files were renumbered because the same
> number had been used twice, and these are run by hand in numeric order by
> reading file names — a duplicate number means one file silently gets skipped.
> `0179_books_owner_only.sql` → **`0185`**; `0184_cutover_config.sql` →
> **`0186`**; and a second, older duplicate (`0158`, from PR #898) moved to
> **`0184_plaid_account_custom_name.sql`**. Same SQL inside, and all of them are
> idempotent, so if you already ran one under its old name there is nothing to
> undo. `tests/compliance/migration-numbering.test.ts` now fails the build if a
> duplicate or a gap is ever introduced again.

- [ ] **`supabase/migrations/0185_books_owner_only.sql`** — books-01: locks the
  general ledger, the trial balance and the accounting reports to the OWNER
  alone (not admins). Creates `public.is_owner()`, which every later books
  migration depends on, and re-points the accounting RLS policies at it.
  Idempotent. Ends with a review function — run
  `select * from gl_audit_owner_only_gate();` and expect **zero rows** (it lists
  only problems, so empty means every door is locked).
  **Until this is run, `/admin/reports/accounting` and its two CSV download
  links are still readable by managers.**

- [ ] **`supabase/migrations/0186_cutover_config.sql`** — books-02: sets the real
  cut-over from Cultivera/Sage to this system as **2026-11-01**, with opening
  balances dated **2026-10-31** (the day before, so the opening figures land in
  the prior period and never overlap live activity). Replaces the wrong seeded
  date of 2025-12-31. Requires `is_owner()` from 0185, so run 0185 first.
  Idempotent. Then run `select * from gl_audit_cutover_date();` and expect
  **zero rows**.
  **Until this is run, the Conversion screen reports its settings row missing.**

- [ ] **`supabase/migrations/0187_vendor_bills_to_gl.sql`** — books-03: connects
  vendor bills to the ledger, which is the gap that mattered most — `vendors`,
  `inbound_manifests`, `noncannabis_invoices` and `vendor_manifest_payments` all
  existed, and **none of them reached the general ledger**. This migration adds:
  1. **`gl_vendor_purchase_kinds`** — the closed list of **24** purchase kinds,
     each seeded with its treatment (inventory / expense / asset / trust /
     quarantine), its debit account, and its §280E cost class. This table is a
     MIRROR of `src/lib/accounting/vendor-bill-core.ts`, which is the single
     brain; a test parses this SQL and compares all 24 rows against the
     TypeScript in both directions, so the two can never drift apart. Two CHECK
     constraints make the dangerous states unrepresentable: an inventoriable
     kind can never carry a disallowed cost class, and trust money must post to
     a balance-sheet account.
  2. **`gl_vendor_profiles`** — per-vendor defaults, so a vendor you buy the
     same thing from every week stops asking the same question every week.
  3. **Bridge columns** `gl_journal_id` + `gl_posted_at` on
     `noncannabis_invoices` and `inbound_manifests` — the thread from the paper
     to the journal and back.
  4. **`gl_post_vendor_bill(...)`** — the only route from a bill to the ledger.
     It refuses anyone who is not the owner (`GL_NOT_OWNER`) and refuses a bill
     with no idempotency reference (`GL_NO_SOURCE_REF`), then delegates to
     `gl_submit_journal` so every existing guarantee — balance, period status,
     control accounts, cost-class rules — applies unchanged. Both refusals have
     plain-English translations in `gl-refusal-core.ts`.
  5. Owner-only RLS on the new tables.

  Requires `is_owner()` (0185) and `gl_journals` (0172). Its **§0 precondition
  guard** checks for both and stops with `MIGRATION_OUT_OF_ORDER` rather than
  half-building itself. Idempotent — the 24 seed rows use
  `on conflict (code) do update`, so re-running refreshes them in place. Then
  run `select * from gl_audit_vendor_bill_wiring();` and expect **zero rows**.
  **Until this is run, the new `/admin/books/bills` page still explains §280E,
  still walks the decision tree and still does all the math on screen (the
  engine is pure TypeScript and needs no database), but no bill can post.**

- [ ] **`supabase/migrations/0188_payroll_to_gl.sql`** — books-04: payroll, and
  the answer to the question you asked directly — *"I would like the ability to
  assign employees as cogs so I can write them off."*

  **The short answer, before the details: mostly no, and the reason is not a
  limitation of this software.** Greenway is an I-502 RETAILER, which in tax
  language makes it a **reseller**. The rule that governs a reseller's inventory
  cost is Reg. §1.471-3(b), and it lets you add to the invoice price only
  *"transportation or other necessary charges incurred in acquiring possession
  of the goods."* It contains **no direct-labor clause at all**. The paragraph
  that does allow *"expenditures for direct labor"* is §1.471-3(c), and it
  applies only to merchandise *"produced by the taxpayer"* — and even that
  paragraph excludes *"any cost of selling."* Three Tax Court cases (Patients
  Mutual/Harborside 151 T.C. 176; Alternative Health Care Advocates 151 T.C.
  225; Richmond Patients Group T.C. Memo 2020-52) held dispensaries doing far
  more hands-on work than Greenway to be resellers. Richmond even trimmed and
  dried product and was still a reseller.

  **So a budtender's hour can never become cost of goods sold. There is one
  narrow door, and this migration builds it properly:** time spent *acquiring
  possession* — meeting the transporter, checking the manifest against the
  cases, moving product into the vault — rides the same clause inbound freight
  rides. That time, and only that time, can go to account **61000 Payroll —
  Inventory Handling**, and only when you can prove the minutes.

  What the migration adds:
  1. **`gl_payroll_labor_roles`** — the closed list of **13** labor roles, each
     seeded with its treatment, its account and its §280E cost class. It mirrors
     `src/lib/accounting/payroll-cogs-core.ts`, and a test parses this SQL and
     compares every row against the TypeScript in both directions so the two can
     never drift. **Three CHECK constraints make the dangerous states literally
     unrepresentable in the database:** a never-inventoriable role can never
     point at a COGS account; a COGS-account role must carry a COGS class; and
     `cogs_direct` — the producer-only class — is refused outright.
  2. **Task attribution on the time clock** — `time_punches` gains
     `labor_role_code`, `inbound_manifest_id` and `task_note`. This is the piece
     that was genuinely missing: the clock recorded *that* somebody worked, never
     *what they worked on*, and without that there is no evidence to support any
     allocation. Purely additive — existing punches and the existing CHECK
     constraint are untouched.
  3. **`gl_payroll_allocations`** — allocations in integer milli-percent, with
     `document_ref` and `basis_note` **NOT NULL**, plus a trigger that refuses an
     allocation that is not supported. An allocation you cannot document is an
     allocation you do not have; that is the Harborside fact pattern in one line.
  4. **`gl_post_payroll_run(...)`** — the only route from payroll to the ledger.
     Owner-only. It **never auto-posts** — payroll always lands as a DRAFT for
     you to review — and it validates the §280E cost class on every single line
     before delegating to `gl_submit_journal`. A fingerprint guard
     (`GL_PAYROLL_RUN_CHANGED`) catches the nastiest case of all: a run that is
     corrected and re-submitted for the same period, where the reference matches
     and the money does not, so the correction would otherwise be silently
     discarded and the original wrong numbers kept.
  5. Owner-only RLS on everything new.

  Requires `is_owner()` (0185), `gl_journals`/`gl_submit_journal` (0172/0174) and
  `payroll_runs` (0057). Its **§0 precondition guard** checks for all of them and
  stops with `MIGRATION_OUT_OF_ORDER` rather than half-building itself.
  Idempotent — verified by applying it three times in a row against a real
  PostgreSQL 15 database. Then run:

  ```sql
  select * from gl_audit_payroll_wiring();
  ```

  and expect **zero rows**. That function checks eleven separate things and
  lists only problems, so an empty result is the all-clear. It was tested by
  deliberately stripping every CHECK constraint off the table and confirming it
  still catches selling labor sitting in a COGS account — it is a real smoke
  alarm, not a decorative one.

  **Until this is run, payroll keeps working exactly as it does today (admins
  can still pay employees) and the new payroll screen still teaches and still
  does all the arithmetic on screen, but no payroll run can reach the ledger.**

- [ ] **`supabase/migrations/0189_bank_matching.sql`** — books-05: connecting the
  bank feed to the books, and stopping the two mistakes that do not look like
  mistakes.

  **Why this one matters more than it sounds like it should.** Everywhere else
  in the books, an error announces itself: an unbalanced entry will not post, a
  bill with no vendor will not post. Bank matching is the exception, in the two
  worst possible ways.

  **The first is the sign wall.** Your bank feed and your ledger use exactly
  opposite conventions. In the Plaid feed a POSITIVE number means money **left**
  your account. In the ledger a POSITIVE number means a **debit**. Money leaving
  the bank has to *credit* the bank account — a negative — so for the cash line
  the two systems are precise mirror images. Get that crossing backwards and
  **both lines of the entry flip together**: debits still equal credits, the
  journal still balances, nothing turns red, no report complains. The only
  symptom is a wrong tax return. This is not hypothetical for you — *backwards
  card signs* is already in the old books.

  This migration puts a `check` constraint in the database itself requiring
  `ledger_cash_cents = -plaid_amount_cents` on every stored match, so a
  backwards match cannot be written even if something bypassed the screen
  entirely. A screen can be bypassed; a constraint cannot.

  **The second is worse, because it looks like success.** Suppose the bank took
  a $77 service charge and your books never heard of it. That fee is *already
  inside* the closing balance the bank sent you. When the reconciliation brings
  it across to compare like with like, **it cancels itself out** — the
  difference comes to exactly `$0.00` while the expense is missing from your
  profit and loss entirely. A reconciliation that congratulates you at that
  moment is worse than one that fails, because you would stop looking.

  So this migration stores **two separate answers**, not one: `ties` (did the
  arithmetic close?) and `complete` (is anything still unrecorded?). And it
  carries a `check (signed_off_at is null or complete)`, meaning **the database
  physically refuses to let a month be signed off while a settled bank line
  still has no entry.** The Washington State Auditor's BARS Manual §3.1.9.15(4)
  is the authority, in its own words: *"Identifying transactions from the bank
  accounts need to be recorded in the accounting records. For example, some of
  these items could include interest earned, bank fees or charges, NSF checks,
  and unrecorded deposits ... Accounting records should be updated for all such
  transactions identified in the bank statements."*

  What else it builds:
  1. The match tables, storing the evidence in **both directions** — bank row to
     journal and journal back to bank row. WAC 314-55-087(2)(b) requires the
     ability to *"trace any transaction back to the original source or forward
     to a final total"*, and a one-way link satisfies neither half of that. A
     match is never deleted when you change your mind; it is **superseded**, and
     the supersession is itself a record, because the retention period is five
     years.
  2. **Double-match protection** in both directions, so one bank line cannot be
     matched twice and one journal cannot absorb two bank lines.
  3. The **cut-over guard** — nothing can be matched into a period before
     `2026-01-01`, refused by the database rather than by a screen.
  4. **`gl_sign_off_bank_reconciliation(...)`** — owner-only, and it revokes a
     stale signature automatically: re-run a reconciliation after signing it and
     the signature clears, because a signature given to one set of numbers must
     not survive onto a different set.
  5. Owner-only RLS on everything new.

  Requires `is_owner()` (0185), `gl_journals`/`gl_submit_journal` (0172/0174) and
  the Plaid tables (0157). Its **§0 precondition guard** checks for all of them
  and stops with `MIGRATION_OUT_OF_ORDER` rather than half-building itself.
  Idempotent — verified by applying it repeatedly against a real PostgreSQL
  database, exit code 0 and zero errors every time.

  **Then run this one line and expect ZERO ROWS back:**

  ```sql
  select * from gl_audit_bank_wiring();
  ```

  If you are not sure what that means in practice, it is spelled out step by
  step in `docs/HOW_TO_RUN_A_MIGRATION.md`. The short version: that function
  checks the controls above and **lists only problems**, so an empty result —
  the words `(0 rows)` — is the all-clear. Anything printed is a problem
  described in plain English.

  **Until this is run, the new `/admin/books/bank` page still teaches
  everything, and every number on it is still computed live by the real engine
  (it is pure TypeScript and needs no database), but no bank match can be
  stored.**

- [ ] **`supabase/migrations/0190_owner_only_financial_tables.sql`** — books-06:
  closing the last hole in the owner lock.

  **What was wrong.** Back in `0185` we locked **the books** — every `gl_*`
  table — so that only you can open them. That was the right move and it worked.
  But it locked the *ledger*, and it did not lock **the accounts the ledger is
  built from**.

  Twenty-five tables were still set to `is_staff()`. That check means "is this
  person an active staff member?" — and nothing else. It does not ask what role
  they have. It says yes to a manager, yes to a content editor, yes to a
  read-only analyst. Any one of them could read:

  - **`plaid_transactions`** — every dollar in and out of every connected
    account, with merchant names and dates;
  - **`plaid_accounts`** — every account, its last four digits, and its balance;
  - **`manual_loans`** — every loan, the balance, the rate, the payment;
  - **`atm_cash_loads`** — how much cash went into the machine and when, which
    is not really an accounting fact at all. It tells someone when the most
    money is sitting in your building.

  Put those four together and a person who cannot open your books can rebuild
  your financial statements anyway. The lock on the front door was real; the
  window beside it was open.

  **And one of them was worse than a report.** `plaid_items` holds the Plaid
  **access token**. That is not a page of numbers, it is a **key**. Anyone
  holding it can pull your entire banking history from *outside* this
  application — where none of our gates apply and none of our logging sees it.
  A read-only analyst could read that row.

  **What this migration does.** It rewrites all twenty-five of those tables from
  `is_staff()` to `is_owner()`. Same lock that is already on your books, now on
  your bank feed, your ATM, your crypto, and your loans. Your own decision,
  applied where it was missing:

  > *"there is no reason anyone else needs to see my books or my financials
  > ever, so I want strict controls over all of those things. The only thing an
  > admin can do is pay vendors and pay employees."*

  **What it does NOT break, and why you can run it without worrying.**

  1. **Your syncs keep running.** Before writing this, every single place in the
     app that writes to these tables was checked one by one — all 78 of them.
     Every one uses the *service role*, which is not subject to these rules at
     all. Plaid, the crypto wallets, the ATM poller and the loan store are
     untouched.
  2. **Your admin can still do their job.** Paying vendors and paying employees
     live on different permissions (`payables.manage`, `staffing.manage`), and
     both still include admin. The **Banking** page — the payee vault where
     vendor and employee bank details live — deliberately stays where it was,
     because that *is* the pay-vendors tool.
  3. **The register keeps ringing.** `tax_settings` and `tax_category_rules`
     look like they belong in this list, and they were deliberately left out.
     They are the **sales tax and excise rates the point of sale reads to price
     a basket** — published state rates, nothing about your money. Lock those
     and every budtender is denied the rate needed to price a cart, and the
     store stops. That decision is written into the migration itself so nobody
     "tidies it up" later.

  It refuses to run out of order, like the last few have. If a prerequisite is
  missing it stops with `MIGRATION_OUT_OF_ORDER` and **names the exact file to
  run first** — and nothing is changed when it stops. Idempotent: verified by
  applying it twice against a real PostgreSQL database, exit code 0 both times,
  with the second run reporting `re-gated 0` because there was nothing left to
  do.

  **Then run this one line and expect ZERO ROWS back:**

  ```sql
  select * from gl_audit_financial_tables_gate();
  ```

  Same rule as always: this function **lists only problems**, so an empty
  result — the words `(0 rows)` — is the all-clear. It checks two different
  things, because they are two different failures: a table still readable by
  any staff member, and a table with no owner lock on it at all.

  That check was itself tested by deliberately breaking the lock on a table in a
  scratch database and confirming the function noticed, then restoring it and
  confirming it went quiet. A checker that says "all clear" on a broken lock
  would be the most dangerous thing in this repository, because it is the thing
  you would trust.

  **Until this is run**, the four money pages (`/admin/plaid`, `/admin/atm`,
  `/admin/crypto`, `/admin/loans`) already hide themselves from everyone but
  you — that half ships with the code. But the tables underneath stay readable
  by any active staff member until this file is applied.

## BOOKKEEPING BRANCH — books-80 — the factory reset (D-62, D-63)

- [ ] **`supabase/migrations/0209_factory_reset.sql`** — the clean-slate button
  for November 1st. This is the answer to "can I test everything and then
  completely wipe away all testing?" The answer is yes, but **only after this
  file is applied**, because the reset that existed before it (0069 → 0097 →
  0140) was sixty-eight migrations stale and would have left every test journal
  entry sitting on the books. See D-62.

  It runs **entirely inside your existing Supabase project.** No new project, no
  new environment variables, nothing to re-enter in Vercel — `integration_credentials`
  is deliberately on the KEEP list for exactly that reason.

  What it adds:

  1. `gl_factory_reset_preview()` — **read-only.** Owner-only. Tells you what is
     in the database before you touch anything: completed orders, CCRS batches,
     excise returns filed, posted journals. Run this first, every time.
  2. `gl_factory_reset(confirm_phrase, acknowledge_wac_314_55_087)` — the wipe.
     Owner-only. Refuses unless you type the phrase **`ERASE ALL TEST DATA`**
     exactly, and refuses again unless you pass `true` to acknowledge the
     five-year retention rule. Deletes from **134** tables in verified
     child→parent order and KEEPS **116** — your chart of accounts, your four
     entities, the shareholder register, staff, passkeys, the knowledge base,
     product masters, brands, vendors, site content, and the audit log.
  3. `gl_audit_factory_reset()` — the proof. **Returns only problems, so zero
     rows is the all-clear.**

  It temporarily lifts the ledger immutability triggers, and it does so through
  a **transaction-local** setting rather than `alter table ... disable trigger` —
  so if anything fails halfway, the exemption rolls back with the transaction and
  the ledger locks itself again automatically. There is no window in which the
  books are unprotected and nobody is looking.

  The reset **logs itself** into `audit_logs` as `ops.factory_reset`, and
  `audit_logs` is on the KEEP list. Your clean slate is clean, but it is not
  amnesiac: there is a permanent record that a reset happened, who did it, and
  when.

  **Run in this order, on or before October 31st:**

  ```sql
  select * from gl_factory_reset_preview();                       -- 1. look
  select * from gl_factory_reset('ERASE ALL TEST DATA', true);    -- 2. wipe
  select * from gl_audit_factory_reset();                         -- 3. expect ZERO ROWS
  ```

  **Until this is run**, there is no safe way to clear test data — the old
  "Reset operational data" button leaves the entire general ledger behind.

  Also fixes **D-63**: the retention guard inherited from 0097 told you the
  retention period was **three years**. WAC 314-55-087(1) has said **five years**
  since 10/12/2024 (WSR 24-19-040). The stale number was in the exact sentence
  shown to you at the moment of destruction. 0209 says five.

## SLICE 3 (customers) — 0232 — live customer visits and spend

- **`0232_customer_rollups.sql`** — fixes customers showing **0 visits / $0 spend**
  even though they have purchases. Nothing ever kept `visit_count`,
  `lifetime_spend_minor_units` or `last_visit_at` up to date, and the Cultivera
  import had written the OLD POS's lifetime spend into `lifetime_spend_minor_units`.

  What it does:

  1. Adds `customers.imported_spend_minor_units` and — **only in the run that
     creates the column** — copies the Cultivera figure into it for imported
     customers. A re-run never copies again, so the old-POS number is preserved
     exactly once and never overwritten by live figures.
  2. Adds `customers.first_visit_at`.
  3. Installs `customer_rollup_compute(uuid)` / `customer_rollup_recompute(uuid)`
     and triggers on `orders` (insert, delete, and updates of status /
     customer_id / total / completed_at / placed_at) and on `customer_returns`.
     A visit is a **completed** order linked to the customer (the same revenue
     basis as every report); spend is what they paid **less refunds**, never
     below zero. Voids, cancellations and online orders collected at the
     register (the register sale is the sale of record) are never double counted.
  4. Back-fills every customer once.
  5. Adds `customer_rollup_audit()` — returns only customers whose stored
     figures disagree with a fresh recompute. **Zero rows is the all-clear.**
  6. Locks the functions to `service_role`, adds three indexes, reloads the API schema.

  Safe to re-run (verified: all 232 migrations apply on a clean database and
  0232 re-applies cleanly; 20 trigger scenarios checked in
  `scripts/recon/customer-rollups-pg-check.sql`).

  **Run it, then check:**

  ```sql
  select * from customer_rollup_audit();   -- expect ZERO ROWS
  ```

  **Until it is run**, the customer pages still show correct numbers — they
  calculate them straight from orders and display a note saying 0232 is pending —
  but sorting the customer list by visits / spend / recent visit uses the old
  (empty) columns.

## USAGE-3 — 0233 — one round-trip for the Orders board poll

- [ ] `0233_orders_board_snapshot.sql` — adds the read-only function
  `orders_board_snapshot(p_arrivals_limit, p_exclude_origins)` returning one
  small jsonb document: per-status counts (every status present, zero when
  empty), the newest arrivals, and the latest `orders` / `leafly_orders`
  change stamps.

  **Why:** the Orders dashboard polls `/api/admin/orders/count` every 15 s
  while the tab is open (that cadence is pinned — the chime must land within
  15 s). Each poll used to cost **ten** PostgREST requests (seven
  `count(*)`, one arrivals list, two `max(updated_at)`), i.e. ~2,400
  requests an hour per open tab, all counted against Supabase egress and
  Vercel function time. After this migration it is **one**. The board page's
  stat cards and the owner cockpit also drop from seven count queries to one.

  **Until it is run** everything works exactly as before — the code calls the
  function, sees PostgREST's "function not found", and runs the old ten
  queries. Only the saving waits.

  Safe to re-run (drop + create; verified: all 233 migrations apply on a
  clean Postgres 15 and 0233 re-applies cleanly; scenario script
  `scripts/recon/orders-board-snapshot-pg-check.sql` passed).

  **Run it, then check:**

  ```sql
  select public.orders_board_snapshot();   -- one jsonb row with counts / arrivals / stamps
  ```

## S04 — 0234 — product identity columns (one key per product)

- [ ] `0234_product_identity.sql` — adds nullable `identity_key` (the S03
  product identity: vendor + brand + product + canonical size + website
  category) and `kb_product_id` (link to the knowledge-base product) to
  `catalog_product_drafts`, `inventory_lots`, `menu_items`,
  `product_enrichments`, and `identity_key` to `kb_products`. Drafts also gain
  `brand_id`, `vendor_id`, `lot_code`, `sku`, `strain_type` and
  `restock_of_card_key` (a restock hint for the approval card). Enrichments gain
  `first_manifest_id`, `last_manifest_id`, `last_received_at`. Every new column
  is empty until later slices fill it; each lookup column gets a small partial
  index that only covers filled rows.

  **Why:** today the same product is recognized by four different keys in four
  places (POS key on drafts, lowercase name string in the KB bridge, spaced
  slugs in classification memory, dashed slugs in the KB). S03 built ONE key in
  code; this migration gives it a home in the database so S05 can stamp it the
  moment a manifest is received and the approval card can say "this looks like
  a restock of X" and "linked to a known product". The identity key is extra
  evidence only — the POS product key is still what matches a draft to a menu
  card, so nothing can be merged or hidden by this.

  **Until it is run** everything works exactly as before. The menu does not ask
  for the new columns, and every writer that uses them (S05 onward) notices the
  column is missing and writes the row without them.

  Safe to re-run (`add column if not exists` / `create index if not exists`;
  the foreign keys are declared inline with their column, so a re-run adds
  nothing; verified: all 234 migrations apply on a
  clean Postgres 15 and 0234 re-applies cleanly; scenario script
  `scripts/recon/product-identity-pg-check.sql` passed). Deleting a knowledge
  base product clears the link (`on delete set null`), it never deletes a lot
  or draft.

  **Run it, then check:**

  ```sql
  select table_name, column_name, data_type
    from information_schema.columns
   where table_schema = 'public'
     and column_name in ('identity_key', 'kb_product_id', 'restock_of_card_key')
   order by table_name, column_name;
  -- expect 10 rows: identity_key on 5 tables, kb_product_id on 4, restock_of_card_key on drafts
  ```

## S05 — no new migration — identity stamped at receiving (uses 0234)

S05 adds **no SQL**. It starts FILLING the 0234 columns: each received lot
gets `identity_key`, each onboarding draft copies `identity_key`, `brand_id`,
`vendor_id`, `lot_code`, `strain_type` (plus `restock_of_card_key` when the
product matches exactly one live menu card), and after finalize the lots and
drafts get `kb_product_id` when a knowledge-base product exists.

**Before 0234 is run** nothing breaks: every writer notices the missing column,
writes the row without it once, and stops sending it for the rest of that
manifest. The manifest timeline says the knowledge-base link was skipped
because 0234 is not applied yet.

**Rollback without a deploy:** set `INTAKE_IDENTITY_STAMP=off` in Vercel.

**After 0234 is run and the next manifest is finalized, check:**

```sql
select count(*) filter (where identity_key is not null)   as lots_with_identity,
       count(*) filter (where kb_product_id is not null)  as lots_linked_to_kb
  from public.inventory_lots
 where created_at > now() - interval '1 day';

select event_type, note, created_at
  from public.manifest_events
 where event_type in ('kb_link', 'kb_writeback_error')
 order by created_at desc
 limit 5;
```

## S06 — no new migration — field-by-field AI lookup

S06 adds **no SQL**. The AI Lookup panels (Product Onboarding and Enrichment)
now show a "Field-by-field evidence" table and, when Gemini answered, Google
Search Suggestions. Rollback without a migration: set `LOOKUP_SCHEMA_V2=off`
in Vercel.

## S08 — 0235 — attached facts + append-only fact history

- [ ] `0235_attached_facts.sql` — **Run 0234 first** (the file refuses with
  `MIGRATION_OUT_OF_ORDER` if 0234 is missing). Adds two empty jsonb columns
  to `catalog_product_drafts`, `attached_facts` and `attached_facts_provenance`,
  to hold the facts married to a draft (description, effects, terpenes…) and
  who or what supplied each one. It also adds one new table,
  `product_fact_provenance`: a permanent, **append-only** history of every
  product fact written, with its source, its confidence (0 to 1) and the
  links it came from.

  **Why:** today a draft has nowhere to keep what Gemini, the knowledge base
  or you said about a product, and nothing records who set a fact or when.
  This is the storage the next slices build on: S07 (one write door with a
  receipt), S09 (remember a product before paying for a Gemini call) and S11
  (source chips per field on the onboarding row).

  **Until it is run** nothing changes. No code reads or writes these yet (a
  test enforces that), so running it early is safe, and so is running it
  late.

  **Rules the database now enforces for you:**

  - A fact's source must be one of: manifest, coa, kb_published, kb_draft,
    gemini, human, remembered, cultivera. Anything else is refused.
  - A history row can never be edited, deleted or truncated. A correction is
    a new row, and the newest one wins.
  - A confidence of 95 is refused, because the scale is 0 to 1, so it must be
    0.95.
  - Only the server can read the table (row-level security on, no policy).
  - The factory reset **keeps** this history, like the knowledge base.

  Safe to re-run (`add column if not exists`, `create table/index if not
  exists`, `create or replace function`, `drop trigger if exists` before each
  `create trigger`). Verified: all 235 migrations apply on a clean Postgres 15,
  0235 re-applies cleanly, and the scenario script
  `scripts/recon/attached-facts-pg-check.sql` passed.

  **Run it, then check:**

  ```sql
  select column_name, data_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'catalog_product_drafts'
     and column_name in ('attached_facts', 'attached_facts_provenance');
  -- expect 2 rows, both jsonb

  select count(*) as columns
    from information_schema.columns
   where table_schema = 'public' and table_name = 'product_fact_provenance';
  -- expect 13

  select tgname from pg_trigger
   where tgrelid = 'public.product_fact_provenance'::regclass and not tgisinternal
   order by tgname;
  -- expect 2 rows: trg_pfp_append_only, trg_pfp_no_truncate
  ```

## S15 — 0236 — one archival rule for every publish

- [ ] `0236_publish_archive_rule.sql` — replaces two database functions,
  `publish_menu_version` and `clean_slate_test_data`. No tables or columns
  change. It does not depend on 0234 or 0235, but running them in number
  order (0234, 0235, 0236) is the simplest habit.

  **Why:** until now there were three different rules for which waiting menu
  updates get archived when a menu goes live (bible S15, findings F-057,
  F-058, F-042). The database only archived after a POS spreadsheet publish,
  and never touched updates built from receiving (a `NULL <> x` test is never
  true in SQL). The two app paths each covered a different half. So a
  Cultivera upload that was not published, followed by an approval that
  published itself, stayed on the Publish page forever with a red "Outdated"
  chip, and publishing it by mistake would have taken every received product
  off the menu.

  **What it does:** one rule for every publish. Every *staged* update of any
  origin created **before** the one just published is archived, and the row
  records why in `summary_json` (`archived_reason` =
  `superseded_by_publish:<id>`, `archived_at`). Newer staged updates are left
  alone. Publishing an id that does not exist now fails loudly
  (`PUBLISH_VERSION_NOT_FOUND`) instead of silently taking the live menu
  down. The factory reset (`clean_slate_test_data`) now restores the most
  recently **live** menu, never an update that was only ever staged.
  Execute rights are narrowed to the server (`service_role`) only.

  **Until it is run** nothing breaks. The app already applies exactly the
  same rule right after every publish (S15 `archiveSupersededStaged`), so
  you get the fix today. Once 0236 is in, the app pass simply finds nothing
  left to archive.

  Safe to re-run (`create or replace function`, grants are idempotent).
  Verified: all 236 migrations apply on a clean Postgres 15, 0236 re-applies
  cleanly, and the scenario script
  `scripts/recon/publish-archive-rule-pg-check.sql` passed (including a proof
  that the old functions had the bug, via the rollback file). 12 deliberate
  sabotages of the SQL were each caught by that script.

  **Run it, then check:**

  ```sql
  select obj_description('public.publish_menu_version(uuid,uuid)'::regprocedure, 'pg_proc')
         like '0236 / S15%' as publish_ok,
         obj_description('public.clean_slate_test_data()'::regprocedure, 'pg_proc')
         like '0236 / S15%' as clean_slate_ok;
  -- expect true, true

  select has_function_privilege('anon', 'public.publish_menu_version(uuid,uuid)', 'execute') as anon_can_publish,
         has_function_privilege('authenticated', 'public.publish_menu_version(uuid,uuid)', 'execute') as users_can_publish;
  -- expect false, false
  ```

  **Rollback (only if needed):** paste
  `supabase/rollbacks/0236_publish_archive_rule.rollback.sql` into the SQL
  editor. It restores the previous function bodies (0002 and 0152) word for
  word, with their previous grants. The app keeps applying the one rule
  either way.

## S30 — 0237 — fact review for products that arrive by receiving

- [ ] `0237_fact_review_for_versions.sql` — changes one table,
  `pos_fact_reviews` (the fact-review decision log from 0139). Additive
  only: existing rows are untouched. Depends on 0139, 0023 and 0026 (all long
  applied); the file refuses to run, by name, if any is missing.

  **Why:** when the extraction engine could not verify a fact on an
  mg-dosed product that came in on a delivery (for example a name that says
  "100mg THC" with empty potency columns), the menu update was held. The only
  place to answer a flagged fact was the Menu Imports review page, and that
  page needs a POS spreadsheet import (`import_id` was NOT NULL). A received
  product never has one, so the hold had no exit except publishing by hand
  (bible S30, findings F-094, F-095, F-118).

  **What it does:** `import_id` becomes nullable. Three columns are added:
  `manifest_id` (the delivery; the decision is deleted with it),
  `draft_id` (the Product Onboarding row it was made on; set null if that
  draft is ever deleted) and `flag_signature` (which flagged facts you looked
  at). If the facts change later, the old answer no longer counts and you are
  asked again. Every row must have exactly one scope, an import or a delivery
  (`pos_fact_reviews_one_scope`). There is one decision per delivery + lot
  (`pos_fact_reviews_manifest_item_key`), so pressing a button twice updates
  the same row.

  **What you will see after it is run:** on Product Onboarding → Approved,
  a product whose delivery is held shows "A fact on this product needs your
  eyes" with three buttons: **The facts are right**, **Fix the facts…** (the
  same fields and compliance questions as the Menu Imports review) and
  **Keep it off the menu**. One click saves your answer (with your name, in
  the audit log) and rebuilds the delivery's menu update. When nothing else is
  flagged, the update publishes itself.

  **Until it is run** nothing breaks. A held update stays held, exactly as
  today, and can still be published by hand under Admin → Publish Menu.
  Product Onboarding says this migration is what turns the buttons on, and a
  click reports "needs database migration 0237" instead of failing.

  Safe to re-run (`if not exists`, constraints dropped and re-added by name).
  Verified: all 237 migrations apply on a clean Postgres 15, 0237 re-applies
  cleanly, and the scenario script
  `scripts/recon/fact-review-for-versions-pg-check.sql` passed. It covers
  receiving rows accepted, latest-wins upsert, both/neither scope refused by
  name, import rows unchanged, cascade + set null, idempotence, and rollback
  then re-apply. 3 deliberate sabotages of the SQL were each caught by that
  script.

  **Run it, then check:**

  ```sql
  select count(*) filter (where column_name in ('manifest_id', 'draft_id', 'flag_signature')) as new_columns,
         bool_or(column_name = 'import_id' and is_nullable = 'YES') as import_id_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'pos_fact_reviews';
  -- expect 3, true

  select conname
    from pg_constraint
   where conrelid = 'public.pos_fact_reviews'::regclass
     and conname in ('pos_fact_reviews_one_scope', 'pos_fact_reviews_manifest_item_key')
   order by conname;
  -- expect both names
  ```

  **Rollback (only if needed):** paste
  `supabase/rollbacks/0237_fact_review_for_versions.rollback.sql` into the SQL
  editor. It deletes the receiving-scoped decisions (they cannot exist without
  a delivery), drops the two constraints and three columns, and restores
  `import_id NOT NULL`. Held receiving updates then go back to
  publish-by-hand.

## D-81 — 0238 — the factory reset can finish

- [ ] `0238_factory_reset_reaches_every_guard.sql` — replaces four database
  functions (the guards on `gl_template_changes`, `gl_opening_balances`,
  `gl_override_log` and `gl_audit_events`). It does not change any table and
  does not touch any row. It depends on 0172, 0174, 0176, 0177 and 0209 (all
  long applied). If any is missing, the file refuses to run and names it.

  **Why:** Admin → Settings → Reset ("Reset all test data") said
  "Reset failed" even with the retention box ticked and `ERASE ALL TEST DATA`
  typed. The reset (0209) empties everything in one transaction. When
  it reached a table whose guard refuses deletes, the whole reset was undone.
  0209 opened a door in three guards for the reset only. It missed four
  places (D-81):
  `gl_template_changes` (a posting template was ever edited),
  `gl_override_log` (a journal was ever self-approved under the owner override),
  posted `gl_opening_balances`, and `gl_audit_events`. The last one blocks as
  soon as ONE journal was posted or approved through the app. Deleting that
  journal makes Postgres blank the journal link on its audit rows, and the
  audit guard refused that change.

  **What it does:** each of the four guards gets the same door 0209 uses,
  checked first. It is open only inside the transaction the reset itself runs
  in, and it closes by itself when that transaction ends. Outside a reset
  every guard refuses exactly as before. Editing is still refused always. The
  audit guard lets through only the one change the database makes itself
  (a link going blank, every other column identical), and only during a reset.

  **Until it is run** the reset keeps failing, and nothing else changes.

  Safe to re-run (`create or replace` only). Verified: all 238 migrations
  apply on a clean Postgres 15, 0238 re-applies cleanly, and the scenario
  script `scripts/recon/factory-reset-guards-pg-check.sql` passed. It makes
  real test data through the app functions (template edit, a 6,000 dollar
  journal approved and posted, a posted opening balance). It then shows every
  guard still refusing outside a reset, runs the real `gl_factory_reset`
  (succeeds, every wiped table empty, templates kept) and proves the door is
  shut afterwards. It restores the rollback (the reset fails again), then
  re-applies 0238 twice (it works again). All of it in a rolled-back
  transaction.

  **Run it, then check:**

  ```sql
  select p.proname,
         pg_get_functiondef(p.oid) like '%gl_factory_reset_active%' as reset_can_pass
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('gl_guard_template_changes_append_only', 'gl_ob_guard_frozen',
                       'gl_override_log_is_append_only', 'gl_guard_audit_append_only')
   order by p.proname;
  -- expect 4 rows, every one true

  select pg_get_functiondef('public.gl_guard_audit_append_only()'::regprocedure)
         like '%to_jsonb(new)%' as audit_fk_rewrite_allowed;
  -- expect true (false means 0238 did not run: the audit guard still has only the 0209 door)
  ```

  Then run the reset again: Admin → Settings → Reset, tick the retention
  box, type `ERASE ALL TEST DATA`. The "looks like real trade" warning is
  expected after testing with real data. The box is how you confirm it.

  **Rollback (only if needed):** paste
  `supabase/rollbacks/0238_factory_reset_reaches_every_guard.rollback.sql`
  into the SQL editor. It puts back the 0174, 0176, 0177 and 0209 guard
  bodies. The reset then fails again as described above.

## S32 — 0239 — remember where a look-alike product belongs

- [ ] `0239_intake_merge_decisions.sql` — creates one new table,
  `intake_merge_decisions`. It changes no existing table and touches no row.
  Its only link is `decided_by` → `staff_profiles` (set null if that staff
  row is ever deleted).

  **Why:** when a delivered product looks like two or more cards already on
  your menu (same vendor, category and product family), the store never
  guesses. It adds the product as its own card and warns "Matched more than
  one live card". Until now there was nowhere to save your answer, so the
  same warning came back on every delivery of that product (bible S32,
  findings F-123, F-096, F-066).

  **What it does:** one row per product identity holds your answer:
  **Join this card** (the lots go on the card you picked) or **Keep
  separate** (it is a different product). The answer is used only while the
  cards it matches are the same cards you compared. If a card is hidden,
  added or removed, the answer is ignored and you are asked again. Every row
  must be a valid answer: a join always names a card, keep-separate never
  does, and at least two cards were compared. Row-level security is on with
  no policy, so only the server can read or write it.

  **What you will see after it is run:** on a menu update (Menu Imports →
  the receiving version) the warning's button **Compare & choose** opens
  "This product looks like more than one card on your menu" with the cards
  side by side. One click saves your answer (with your name, on the
  delivery's timeline and in the audit log) and rebuilds that delivery's menu
  update. **Forget my choice** deletes the answer.

  **Until it is run** nothing breaks. The warning and the comparison page
  work, and the buttons say this migration is what saves the answer. The
  menu is built exactly as before.

  Safe to re-run (`create table if not exists`). Verified: all 239
  migrations apply on a clean Postgres 15, 0239 re-applies cleanly, each
  check refused a bad row (a join with no card, keep-separate naming a card,
  an unknown answer, fewer than two cards), an answer saved twice kept one
  row, and the rollback dropped the table.

  **Run it, then check:**

  ```sql
  select c.relrowsecurity as rls_on,
         (select count(*) from pg_policies p where p.tablename = 'intake_merge_decisions') as policies
    from pg_class c
   where c.oid = 'public.intake_merge_decisions'::regclass;
  -- expect true, 0

  select conname
    from pg_constraint
   where conrelid = 'public.intake_merge_decisions'::regclass
     and contype = 'c'
   order by conname;
  -- expect intake_merge_decisions_decision_check,
  --        intake_merge_decisions_target_matches_decision,
  --        intake_merge_decisions_two_or_more_candidates
  ```

  **Rollback (only if needed):** "Revert code; the table can stay (unused).
  Or drop the table — the planner treats a missing table as 'no decisions'."
  To drop it, paste `supabase/rollbacks/0239_intake_merge_decisions.rollback.sql`
  into the SQL editor. Every saved answer is forgotten, and the warning returns
  on the next delivery of each of those products.

## D-82 — 0240 — the factory reset no longer times out

- [ ] `0240_factory_reset_scales.sql` — replaces the factory reset function
  (and gives the preview and the post-reset check the same time limits). It
  changes no table and touches no row. It depends on 0209. If 0209 is missing,
  the file refuses to run and names it.

  **Easiest way to run it:** open **Admin → Settings → Factory reset**. A
  yellow box has a **Copy the upgrade** button and a link to the Supabase SQL
  editor. Paste, click **Run**. When Supabase warns *Potential issue
  detected / This query includes destructive operations*, click **Run query**.
  The warning is expected because the new reset uses the word `truncate`.
  Installing it deletes nothing. You should see `Success. No rows returned`.
  Refresh the reset page and the yellow box is gone. Every click is written
  out in `docs/MICHAEL-0240-fix-the-reset-button.md`.

  **Why:** pressing the reset showed
  `Reset failed: canceling statement due to statement timeout`. Supabase stops
  website requests after 8 seconds. The 0209 reset deleted 139 tables row by
  row and fired every row trigger (the worst is the 0232 customer-totals
  trigger on orders), so with the CCRS and Cultivera uploads it could not
  finish in time. Nothing was deleted. The whole reset was undone each time.

  **What it does:** the same owner check, typed phrase, retention guard,
  audit line and result as before. It checks first that every table exists and
  that no kept table points at a wiped one. Then it locks the 139 tables,
  counts each one (so the per-table numbers are still exact), and empties all
  of them with one `TRUNCATE`. The time this takes does not grow with the
  number of rows. It declares its own limits (55 s statement, 20 s lock wait),
  but it needs well under 1 s.

  Safe to re-run (`create or replace` and `alter function` only). Verified on
  Postgres 15 with all 240 migrations and 40,000 orders plus 2.4 million CCRS
  rows, under the same 8 s limit Supabase uses: the 0209 reset was canceled
  at 8.0 s, and the 0240 reset finished in 0.39 s with all 139 tables empty,
  exact counts and a clean post-reset check.
  `scripts/recon/factory-reset-scales-pg-check.sql` passed, and it failed on
  each of 3 deliberate sabotages. The D-81 guards script still passes.

  **Run it, then check (optional; the yellow box disappearing is the check):**

  ```sql
  select p.proname, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('gl_factory_reset', 'gl_factory_reset_preview', 'gl_audit_factory_reset')
   order by p.proname;
  -- expect 3 rows, each {search_path=public,statement_timeout=55s,lock_timeout=20s}
  ```

  **Rollback (only if needed):** paste
  `supabase/rollbacks/0240_factory_reset_scales.rollback.sql` into the SQL
  editor. It puts back the 0209 row-by-row reset, and the button times out
  again on realistic data.

## R15a — 0241 — Cultivera THC/CBD reach the inventory table

- [ ] `0241_inventory_lot_pos_potency.sql` — adds six empty (nullable) columns
  to `inventory_lots`: `pos_thc`, `pos_thca`, `pos_cbd`, `pos_cbda`,
  `pos_potency_unit`, `pos_potency_set_at`, plus two guarded checks (the unit
  is `%` or `mg`, and no value is below 0). It changes no existing row.

  **How to run it:** open the Supabase SQL editor, paste the whole file, and
  click **Run**. You should see `Success. No rows returned`. Safe to re-run
  (`add column if not exists`, and each check is added only if missing).

  **Why:** the Cultivera INVENTORIES spreadsheet carries THC and CBD for every
  lot, but the inventory table only read lab certificates (`lab_results`).
  Writing the spreadsheet numbers as a lab result would make the COA column
  claim a certificate that does not exist, so they get their own columns. The
  app shows COA numbers first and the spreadsheet numbers second, labelled as
  not-a-COA (`src/lib/pos/lot-potency-core.ts`). CBN and CBC are not columns
  in the Cultivera export. When a product name states them, they go into the
  existing `minor_cannabinoids_json` (0138).

  **After running it (for lots that were already uploaded, with no re-upload
  needed):** open **Admin → Menu imports → the Cultivera upload** and press
  **Fill received dates & cannabinoids from the spreadsheet**. It only fills
  blanks, never overwrites, and is safe to press again. Before 0241 is applied,
  that button fills only the received dates and the name-stated minor
  cannabinoids, and the importer retries without the six columns.

  Verified on Postgres 15: applied twice cleanly in a rolled-back transaction,
  with all six columns and both checks present after the second run.

  **Run it, then check (optional):**

  ```sql
  select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'inventory_lots'
     and column_name in ('pos_thc','pos_thca','pos_cbd','pos_cbda','pos_potency_unit','pos_potency_set_at')
   order by column_name;
  -- expect 6 rows: pos_cbd, pos_cbda, pos_potency_set_at, pos_potency_unit, pos_thc, pos_thca
  ```

  **Rollback (only if needed):** "Revert code; the columns can stay (unused)."
  The app reads them only when present.

## S13 — 0242 — look up a whole manifest with one button

- [ ] `0242_lookup_jobs.sql` — creates two new tables, `lookup_jobs` and
  `lookup_job_items`. It changes no existing table and touches no row. The
  only link is `lookup_job_items.job_id` → `lookup_jobs` (the items go with
  their job). `manifest_id` and `draft_id` are plain stamps with no link, so
  the factory reset can still empty manifests and drafts.

  **Why:** Product Onboarding looks a product up one row at a time. For a
  40-line manifest that is 40 clicks, and a browser tab held open for up to
  five minutes per product (bible S13, finding F-017).

  **What it does:** each press of **Look up all N products on this manifest**
  makes one job row plus one item row per product in Needs review. A
  once-a-minute server job (`/api/cron/lookup-jobs`) does the work, so you
  can close the tab. At most one job per manifest can be active at a time (a
  partial unique index), so pressing the button twice gives you the same
  job. Each product is claimed with a compare-and-swap, so a doubled cron
  tick never looks a product up twice. A product that fails is marked failed
  with a plain reason and the job carries on. Every item records how many
  paid AI web lookups it used, so the job shows its cost. Row-level security
  is on with no policy, so only the server can read or write these tables.

  **What you will see after it is run:** on **Product Onboarding**, with one
  delivery picked, the **Look up all N products on this manifest** button,
  then a progress line such as "9 of 14 looked up · 31 facts attached ·
  6 need your eye" with the cost underneath, and each row shows its own
  result.

  **Until it is run** nothing breaks. The button explains that this
  migration is what turns it on, the cron finds no table and does nothing,
  and the per-row AI Lookup works exactly as before.

  Safe to re-run (`create table if not exists`, `create index if not
  exists`). Verified on Postgres 15 with `scripts/recon/lookup-jobs-pg-check.sql`:
  0242 applied twice in one rolled-back transaction; a second active job for
  the same manifest was refused and a new job after the first finished was
  accepted; bad statuses, a duplicate product in one job and a negative
  `ai_calls` were refused; items cascaded with their job; RLS was on with no
  policy; and the rollback dropped both tables. With the unique index made
  non-unique on purpose, the check failed ("second active job was accepted").

  **Run it, then check:**

  ```sql
  select c.relname, c.relrowsecurity as rls_on,
         (select count(*) from pg_policies p where p.tablename = c.relname) as policies
    from pg_class c
   where c.relname in ('lookup_jobs', 'lookup_job_items')
     and c.relkind = 'r'
   order by c.relname;
  -- expect 2 rows: lookup_job_items true 0, lookup_jobs true 0

  select indexname from pg_indexes
   where tablename = 'lookup_jobs' and indexname = 'lookup_jobs_one_active_per_manifest';
  -- expect 1 row
  ```

  **Rollback (only if needed):** set `MANIFEST_BATCH_LOOKUP=off` in Vercel.
  The button and progress panel disappear, the cron does nothing, and the
  per-row lookup stays. To remove the tables as well, paste
  `supabase/rollbacks/0242_lookup_jobs.rollback.sql` into the SQL editor.
  Every batch record is forgotten. Facts a batch attached stay where they
  landed, because they were written by the normal save path.

## S36 — 0243 — suggestions explain themselves, and a "Reject" sticks

- [ ] `0243_master_suggestions_v2.sql` — adds one empty column,
  `product_master_suggestions.evidence_json`, and creates one new table,
  `product_master_pair_decisions`. It changes no existing row. The only link
  is `decided_by` → `staff_profiles` (cleared, not deleted, if a staff member
  is removed).

  **Why:** the Suggestions tab on **Product Mastering** gave every match the
  same score and the same reason, never counted evidence *against* a match,
  and a rejected suggestion came straight back the next time you pressed
  **Generate suggestions** (bible S36, findings F-129 and F-130).

  **What it does:** every suggestion now saves its field-by-field reasons
  (same vendor, same strain, same size twice, and so on) in `evidence_json`.
  When you press **Reject**, one row per pair of cards in that suggestion is
  saved with a fingerprint of both cards' vendor, brand, strain, market and
  sizes. That pair is then left out of every future suggestion until one of
  the two cards changes one of those things. Row-level security is on with
  no policy, so only the server can read or write the table.

  **Before it is run** the new code still works: suggestions are scored and
  shown with a Strong / Likely / Review badge, but their reasons are not
  saved (the card shows a one-line reason instead), and **Reject** rejects
  without remembering. An orange banner on the page says the migration is
  missing.

  **What you will see after it is run:** each suggestion shows a badge such
  as "Strong · 99%" and a row of green plus lines and orange minus lines.
  After **Reject**, the banner says "Suggestion rejected. 3 pair(s) will stay
  hidden until one of the products changes." Pressing **Generate
  suggestions** again does not bring them back, and the banner says how many
  rejected pairs stayed hidden.

  Safe to re-run (`add column if not exists`, `create table if not exists`).
  Verified on Postgres 15 with `scripts/recon/master-suggestions-v2-pg-check.sql`:
  0243 applied twice in one rolled-back transaction; an ordered pair was
  accepted; a reversed pair, a self pair, a duplicate pair, a decision other
  than `not_a_match` and a missing fingerprint were refused; an upsert
  replaced the fingerprint; removing the staff member kept the row; RLS was on
  with no policy; and the rollback removed the table and the column without
  losing any suggestion. With the ordering check removed on purpose, the
  check failed ("reversed pair was accepted").

  **Run it, then check:**

  ```sql
  select column_name, data_type from information_schema.columns
   where table_name = 'product_master_suggestions' and column_name = 'evidence_json';
  -- expect 1 row: evidence_json jsonb

  select c.relname, c.relrowsecurity as rls_on,
         (select count(*) from pg_policies p where p.tablename = c.relname) as policies
    from pg_class c
   where c.relname = 'product_master_pair_decisions' and c.relkind = 'r';
  -- expect 1 row: product_master_pair_decisions true 0
  ```

  **Rollback (only if needed):** revert the code; the column and table can
  stay unused. To remove them as well, paste
  `supabase/rollbacks/0243_master_suggestions_v2.rollback.sql` into the SQL
  editor (this forgets every remembered rejection).

## R25 A — 0244 — intake lots get their received date and strain type

- [ ] `0244_intake_lot_received_date_strain_type_backfill.sql` — DATA ONLY
  (no new columns; needs 0214's `received_on` columns, which you already
  have). It fills two facts on lots that came in through intake:

  1. **Received date** = the Pacific day the manifest was accepted in
     Receiving (the earlier of the manifest's accepted time and the lot's
     first "Accepted from vendor manifest intake" stock entry, so a
     re-finalize cannot move it later). Only for lots that were accepted
     (sellable or held), only where the date is still blank — a date you
     typed or the POS import gave is never touched. The Cultivera import's
     synthetic manifest (`POS-IMPORT-…`) is skipped.
  2. **Strain type** = the type you picked on the approved Product
     Onboarding draft for that lot (latest approval wins), marked as coming
     from a reviewer. A lot you hand-edited after approving is left alone.

  Every change writes one `audit_logs` row (`actor_email = 'migration:0244'`).
  New intakes do this by themselves from now on (the finalize stamps the date;
  approval copies the strain type), so this only catches up existing lots.

  Safe to re-run (it only fills what is still missing). Verified on Postgres
  15 with `scripts/recon/intake-lot-facts-pg-check.sql`: applied twice in one
  rolled-back transaction with every edge case asserted, an exact rollback,
  and 19 deliberate SQL mutations all caught (`scripts/r25/mutate_a_sql.py`).

  **Run it, then check:**

  ```sql
  select action, count(*) from public.audit_logs
   where actor_email = 'migration:0244' group by action;
  -- received_on_backfill = lots that got a date; strain_type_backfill = lots
  -- that got your pick

  select count(*) as intake_lots_still_without_date
    from public.inventory_lots l join public.inbound_manifests m on m.id = l.manifest_id
   where l.received_on is null and l.disposition = 'accepted' and m.accepted_at is not null
     and coalesce(m.manifest_number, '') not like 'POS-IMPORT-%';
  -- expect 0
  ```

  **Rollback (only if needed):** paste
  `supabase/rollbacks/0244_intake_lot_received_date_strain_type_backfill.rollback.sql`
  into the SQL editor. It restores exactly what 0244 changed, except where a
  person has since changed the value again (those are kept).

## R26 — 0245 — the Invoice # found in the documents is saved

- [ ] `0245_manifest_invoice_number_detected.sql` — two new empty columns on
  `inbound_manifests`: `invoice_number_detected` (the invoice / order # the
  intake found by reading ALL of a delivery's documents — the transfer JSON,
  the vendor's invoice PDF, the manifest PDF, the email) and
  `invoice_number_source` (which document it came from, e.g.
  `invoice:vision+layer:QGT_FreddysFuego_INVOICE.pdf`). Nothing is filled in
  by the migration; new deliveries and the **Run AI extract** button fill it.
  The Invoice # column shows: your own correction first, then this found
  number, then the old one-document scan, then the manifest number.

  Until you run it, the app keeps working exactly as before (the save quietly
  skips). Safe to re-run. Verified on Postgres 15: all 245 migrations applied
  in order on a fresh database, 0245 re-applied cleanly, and
  `scripts/recon/invoice-number-detected-pg-check.sql` passed (6 deliberate
  SQL mutations all caught).

  **Run it, then check:**

  ```sql
  select column_name, data_type, is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'inbound_manifests'
     and column_name in ('invoice_number_detected', 'invoice_number_source');
  -- expect 2 rows: text, YES
  ```

  **Rollback (only if needed):** revert the code; the columns can stay unused.
  To remove them as well, paste
  `supabase/rollbacks/0245_manifest_invoice_number_detected.rollback.sql`
  into the SQL editor (this forgets the numbers that were found).

## R27 — 0251 — total THC/CBD follow the Washington rule

- [ ] `0251_wa_total_thc_cbd_repair.sql` — no new tables or columns. It
  repairs THC numbers already saved. Until now the transfer reader saved the
  lab's **total cannabinoids** (THC + CBD + everything else) as "total THC".
  Your Apple Cardamom showed 0.7045% THC, but the lab's own total THC is
  0.2456%. Washington's rule (WAC 314-55-102) is total THC = THC + 0.877 ×
  THCA, and total CBD works the same way. That is the number the lab itself
  reports as `total-thc` / `total-cbd`.

  The migration copies the lab's own reported totals into `lab_results`. It
  only does this where the lab reported them as a number of 0 or more, and
  only where the saved value is different. A lab result with no reported
  total is left alone: no formula is applied and nothing is guessed. Product
  Onboarding drafts and Knowledge Base products that were copied from that
  lab result are corrected too, but only while they still hold the old
  copied number. Anything a person has changed since then is kept. Menu cards
  are not touched; they pick up the right number the next time they are
  built. Every change gets an audit row (`migration:0251`) that keeps the old
  value.

  The code fix in the same release stops new deliveries from getting it
  wrong, whether or not you run this. Safe to re-run: the second run changes
  nothing. Verified on Postgres 15: all 251 migrations applied in order on a
  fresh database, 0251 re-applied cleanly, and
  `scripts/recon/wa-total-thc-repair-pg-check.sql` passed (19 deliberate SQL
  mutations, all caught by `scripts/r27/mutate_0251_sql.py`).

  **Run it, then check:**

  ```sql
  select action, count(*) from public.audit_logs
   where actor_email = 'migration:0251' group by action;
  -- one row per kind of repair (lab_total_repair / draft_total_repair /
  -- kb_total_repair) with how many were corrected; no rows = nothing needed it
  ```

  **Rollback (only if needed):** paste
  `supabase/rollbacks/0251_wa_total_thc_cbd_repair.rollback.sql` into the SQL
  editor. It puts back exactly the old values, except where a person has
  changed the value again since (those are kept), and removes the 0251 audit
  rows.
