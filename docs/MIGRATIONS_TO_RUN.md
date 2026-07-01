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

---

### How to run
1. Open the Supabase project → **SQL editor**.
2. Paste the full contents of the migration file.
3. Run. Because every statement uses `if not exists` / `on conflict do nothing`
   / `drop ... if exists` before `create`, re-running is harmless.
4. Check the box above.
