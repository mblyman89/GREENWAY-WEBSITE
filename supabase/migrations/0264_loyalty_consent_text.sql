-- ===========================================================================
-- 0264_loyalty_consent_text.sql
--
-- R41 S5 (owner-requested). THE LOYALTY CONSENT WORDING IS NOW EDITABLE, SO
-- EACH SIGNUP RECORDS THE EXACT WORDING THE CUSTOMER AGREED TO.
--
-- Owner (verbatim): "it's mine to edit, please let me edit it." (R41 Q9)
--
-- WHY: 47 CFR 64.1200(f)(9) defines prior express written consent as a
-- signed written agreement containing a clear and conspicuous disclosure.
-- Once the owner can change the paragraph, the record of a signup must say
-- WHICH paragraph was signed. The server (src/lib/loyalty/signup.ts) reads
-- the PUBLISHED loyalty.form.consent_text block at submit time (never the
-- browser's copy) and stores it here with its SHA-256 hex fingerprint.
--
-- WHAT THIS ADDS - two nullable text columns, nothing else:
--   loyalty_signups.consent_text         the exact wording shown.
--   loyalty_signups.consent_text_sha256  lower-case SHA-256 hex of it.
-- Rows from before this migration keep NULL (nothing is guessed for them).
-- Rows staff add by hand from Admin -> Loyalty signups also keep NULL (the
-- customer did not see an on-screen paragraph).
--
-- The website works BEFORE this is applied: the insert retries without the
-- two columns when Postgres says they do not exist (42703 / PGRST204).
--
-- FACTORY RESET: no new table. loyalty_signups is already WIPE in
-- src/lib/accounting/factory-reset-core.ts; its new columns go with it.
-- IDEMPOTENT (add column if not exists). APPLY MANUALLY in the Supabase SQL
-- editor.
-- ROLLBACK: supabase/rollbacks/0264_loyalty_consent_text.rollback.sql
-- ===========================================================================

alter table public.loyalty_signups
  add column if not exists consent_text text;

alter table public.loyalty_signups
  add column if not exists consent_text_sha256 text;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'loyalty_signups_consent_text_sha256_hex'
       and conrelid = 'public.loyalty_signups'::regclass
  ) then
    alter table public.loyalty_signups
      add constraint loyalty_signups_consent_text_sha256_hex
      check (consent_text_sha256 is null or consent_text_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end
$chk$;

comment on column public.loyalty_signups.consent_text is
  'R41 S5: the exact marketing-consent wording (published loyalty.form.consent_text) shown when the customer signed up. NULL for rows before 0264 and for staff-entered rows.';
comment on column public.loyalty_signups.consent_text_sha256 is
  'R41 S5: lower-case SHA-256 hex of consent_text, computed by the server at signup.';

notify pgrst, 'reload schema';
