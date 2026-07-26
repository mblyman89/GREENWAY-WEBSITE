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
  with the acknowledgement — WAC 314-55-087 requires three-year record
  retention, so post-go-live data can't be destroyed by accident. The delete
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
  **Until this is run, "Reset operational data" still works but leaves
  test activity behind in those newer tables — run it BEFORE your final
  pre-go-live reset so the November 1st start is truly clean.**
