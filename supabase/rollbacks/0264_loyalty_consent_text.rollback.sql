-- Rollback for 0264_loyalty_consent_text.sql (R41 S5).
-- WARNING: this forgets which consent wording each signup agreed to. Export
-- Admin -> Loyalty signups first if any row has consent_text filled in.
-- The website keeps working after rollback (the insert retries without the
-- columns).
alter table public.loyalty_signups drop constraint if exists loyalty_signups_consent_text_sha256_hex;
alter table public.loyalty_signups drop column if exists consent_text_sha256;
alter table public.loyalty_signups drop column if exists consent_text;
notify pgrst, 'reload schema';
