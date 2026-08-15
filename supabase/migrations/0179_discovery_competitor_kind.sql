-- =============================================================================
-- 0179_discovery_competitor_kind.sql
-- Owner-managed competitor roster: add the `kind` classification.
--
-- OWNER REQUEST (verbatim, standing rule 1):
--   "I have the a list of competitors, is their a way for me to give the system
--    a competitor specifically like I did to get the curated list, baked into
--    the back office, so we don't have to make code edits to find other
--    specific retailers and producer processors? I think that would be
--    fantastic!"
--
-- WHY `kind` IS REQUIRED
-- ---------------------
-- The CCRS Licensee table carries NO license-type / privilege / tier column.
-- Verified against the real Licensee header captured in
-- tests/compliance/fixtures/ccrs-zip-fixture.ts:
--   LicenseStatus, LicenseeId, UBI, LicenseNumber, Name, DBA, LicenseIssueDate,
--   LicenseExpirationDate, ExternalIdentifier, IsDeleted, Address1, Address2,
--   City, State, ZipCode, County, EmailAddress, PhoneNumber, CreatedBy,
--   CreatedDate, UpdatedBy, UpdatedDate
-- and against every template in docs/ccrs-templates/ (zero occurrences of
-- licensetype / privilege / tier). The system therefore CANNOT derive whether a
-- license is a retailer or a producer/processor. A human declares it; that
-- declaration is this column.
--
-- This is not cosmetic. `area` benchmarks are RETAIL price comparisons. Folding
-- a producer/processor's wholesale rows into a retail median would silently
-- corrupt the benchmark, so the application filters on `kind`
-- (src/lib/discovery/competitor-roster-core.ts: retailRoster/supplyRoster).
--
-- DEFAULT IS 'unknown', NOT 'retailer' (standing rule 2 - never guess).
-- Every pre-existing row was seeded from the WSLCB "Retailers 6-30-2026" sheet,
-- so those specific rows ARE verified retailers and are backfilled as such by
-- license number. Any row NOT in that verified list stays 'unknown' and is
-- deliberately excluded from both typed views until a human classifies it.
--
-- ALSO FIXES A REAL DEFECT IN 0080
-- --------------------------------
-- 0080's seed ends with `on conflict ... set is_active = true`. Re-running that
-- migration would RESURRECT every competitor the owner had deactivated. This
-- migration does not repeat that mistake and does not re-run the seed.
--
-- STANDING RULES honored:
--   * Idempotent: guarded enum, add column if not exists, guarded backfill.
--   * Owner applies this MANUALLY in the Supabase SQL editor (rule 6).
--   * Depends on: 0080_discovery_competitors.sql.
-- Next migration after this is 0180.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum: what the licensee IS (a human declaration; CCRS cannot tell us)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discovery_competitor_kind') then
    create type public.discovery_competitor_kind as enum
      ('retailer', 'producer_processor', 'unknown');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
alter table public.discovery_competitors
  add column if not exists kind public.discovery_competitor_kind not null default 'unknown';

create index if not exists idx_disc_competitors_kind
  on public.discovery_competitors (kind);

-- Keep the active-roster lookups fast now that they filter on two columns.
create index if not exists idx_disc_competitors_active_kind
  on public.discovery_competitors (is_active, kind);

-- ---------------------------------------------------------------------------
-- Backfill ONLY the licenses verified as retailers.
--
-- Source of truth: WSLCB "Frequently Requested Lists" -> Cannabis License
-- Applicants, "Retailers 6-30-2026" sheet - the same verified extract that
-- seeded 0080. These 39 license numbers are exactly the rows 0080 inserted,
-- every one of them from the RETAILERS sheet, so classifying them as
-- 'retailer' is a verified fact, not an inference.
--
-- Guarded by `where kind = 'unknown'` so it never overwrites an owner's later
-- reclassification. Safe to re-run.
-- ---------------------------------------------------------------------------
update public.discovery_competitors
   set kind = 'retailer'
 where kind = 'unknown'
   and license_number in (
     '414550','414103','420661','413358','421877','439182','423372','441109',
     '414503','413374','445189','437875','434372','445745','446441','081400',
     '413541','427457','434402','413427','437434','435420','417880','442174',
     '420785','424311','415229','434030','423829','436145','413258','423634',
     '434494','434843','413870','414449','358302','362816','435728'
   );

-- ---------------------------------------------------------------------------
-- Integrity: at most ONE row may be our own store.
--
-- Two `is_self` rows would make every us-vs-them comparison ambiguous. The
-- application blocks it, but the database is the last line of defense.
-- A partial unique index enforces "at most one true" while allowing many false.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_disc_competitors_single_self
  on public.discovery_competitors ((true))
  where is_self;

-- ---------------------------------------------------------------------------
-- Verification (run manually after applying; expect retailer = 39, unknown = 0
-- on a database that only ever received the 0080 seed):
--
--   select kind, count(*) from public.discovery_competitors group by kind;
--   select count(*) from public.discovery_competitors where is_self;  -- 1
-- ---------------------------------------------------------------------------
