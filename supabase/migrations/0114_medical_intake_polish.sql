-- 0114_medical_intake_polish.sql
-- Task P — guided medical intake: statutory-date + fee/photo audit columns.
--
-- Grounded in verbatim-scraped sources (docs/MEDICAL_CANNABIS_COMPLIANCE.md):
-- - RCW 69.51A.230(4)(a): recognition cards are valid ONE YEAR from the date
--   the health care professional issued the authorization (SIX MONTHS for
--   minors). We record the authorization issue date so the back office can
--   enforce the statutory maximum expiration.
-- - RCW 69.51A.230(10): the department charges a $1 fee per initial/renewal
--   card; "the cannabis retailer ... SHALL collect the fee from the qualifying
--   patient or designated provider at the time that he or she is entered into
--   the database and issued a recognition card." We record collection.
-- - RCW 69.51A.230(3)(c): a photograph taken by a store employee at
--   registration time is part of the card — uploaded INTO the MCR (not our
--   system). Compassionate-care renewals (RCW 69.51A.230(4)(b)) are exempt
--   from the photograph requirement; we record that flag too.
--
-- Idempotent. Owner applies manually in the Supabase SQL editor (after 0113).

alter table public.patient_authorizations
  -- Date the practitioner issued the authorization (from the paper form).
  -- Drives the statutory maximum expiration check (+1yr adult / +6mo minor).
  add column if not exists authorization_issued_on date,
  -- RCW 69.51A.230(10) minimum $1 card fee collected at registration.
  add column if not exists card_fee_collected boolean not null default false,
  -- Photo taken and uploaded into the MCR (RCW 69.51A.230(3)(c)).
  add column if not exists photo_uploaded_to_mcr boolean not null default false,
  -- Compassionate-care renewal by the designated provider (photo exempt).
  add column if not exists compassionate_renewal boolean not null default false;
