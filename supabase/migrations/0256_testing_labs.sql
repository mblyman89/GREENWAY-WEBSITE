-- ===========================================================================
-- 0256_testing_labs.sql
--
-- R36 #4 (owner-requested). WASHINGTON TESTING LABS + CERTIFICATE HOSTS.
--
-- Owner (verbatim, abridged): "research online all of the different testing
-- labs in washington, so we can add them to the known list. I got an error
-- telling me that cultivera is not on the known list for lab testers so it
-- didnt read the coa ... add a button at the top of the inventory page that
-- opens a simple page listing the labs, and the ability to add one if needed."
--
-- WHAT THIS ADDS - ONE table, public.testing_labs:
--   * every lab on the WSLCB Lab List of 2026-08-04 (4 active) and the
--     2021-08-02 list (7 no longer listed = historical), seeded verbatim
--     (docs/research/wa-testing-labs.md + the two xlsx files);
--   * one 'platform' row for Cultivera - NOT a lab, the vendor seed-to-sale
--     platform that re-hosts lab certificates on files.cultivera.com (70 of 70
--     lab links in the owner's sample transfers point there);
--   * coa_hosts text[] - the hosts that lab's certificates may be fetched
--     from. The COA reader ALWAYS allows its three built-in hosts
--     (certs.conflabs.com, gglabs-j.github.io, files.cultivera.com -
--     testing-labs-core BUILT_IN_COA_HOSTS); hosts here are ADDED to those,
--     never replace them. Each host is checked by a constraint (lower-case DNS
--     name, no IP, no port, no wildcard) and the app checks again, plus a DNS
--     check that every address is public, before fetching (OWASP SSRF guard).
--
-- One table (not two) on purpose: the factory-reset guard requires most of
-- the schema to be wiped, and this is reference data that is KEPT.
--
-- IDEMPOTENT: create-if-not-exists, guarded constraints, insert ... on
-- conflict do nothing. APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0256_testing_labs.rollback.sql
-- FACTORY RESET: KEEP (reference data / configuration).
-- ===========================================================================

-- Every element must be a lower-case DNS name of 2+ labels: no scheme, path,
-- port, @, wildcard, IPv4 literal (all-numeric last label) or IPv6 (colon).
create or replace function public.testing_lab_hosts_valid(p_hosts text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(
    h is not null
    and length(h) between 4 and 253
    and h ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
  ), true)
  from unnest(p_hosts) as h
$$;

create table if not exists public.testing_labs (
  id                 uuid primary key default gen_random_uuid(),
  lab_number         integer,
  name               text not null,
  address            text,
  city               text,
  zip                text,
  phone              text,
  website            text,
  status             text not null default 'owner_added',
  cert_start         text,
  cert_current       text,
  cert_valid_through text,
  source             text,
  notes              text,
  coa_hosts          text[] not null default '{}',
  created_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.testing_labs is
  'R36: Washington cannabis testing labs (WSLCB Lab Lists 2026-08-04 active, 2021-08-02 historical) + the Cultivera platform row; coa_hosts = extra certificate hosts (SSRF allow-list, added to the built-ins). Owner may add more. Reference data - KEEP on factory reset.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_status_chk') then
    alter table public.testing_labs
      add constraint testing_labs_status_chk check (status in ('active', 'historical', 'owner_added', 'platform'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_name_chk') then
    alter table public.testing_labs
      add constraint testing_labs_name_chk check (name = btrim(name) and length(name) between 2 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_number_chk') then
    alter table public.testing_labs
      add constraint testing_labs_number_chk check (lab_number is null or lab_number between 1 and 9999);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_platform_chk') then
    alter table public.testing_labs
      add constraint testing_labs_platform_chk check (status <> 'platform' or lab_number is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_text_len_chk') then
    alter table public.testing_labs
      add constraint testing_labs_text_len_chk check (
        coalesce(length(address), 0) <= 300 and coalesce(length(city), 0) <= 100 and coalesce(length(zip), 0) <= 20
        and coalesce(length(phone), 0) <= 40 and coalesce(length(website), 0) <= 300 and coalesce(length(notes), 0) <= 1000
        and coalesce(length(source), 0) <= 300
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_website_chk') then
    alter table public.testing_labs
      add constraint testing_labs_website_chk check (website is null or website ~ '^https?://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'testing_labs_hosts_chk') then
    alter table public.testing_labs
      add constraint testing_labs_hosts_chk check (
        cardinality(coa_hosts) <= 20 and public.testing_lab_hosts_valid(coa_hosts)
      );
  end if;
end$$;

create unique index if not exists testing_labs_number_uq on public.testing_labs (lab_number) where lab_number is not null;
create unique index if not exists testing_labs_name_uq on public.testing_labs (lower(name));

drop trigger if exists testing_labs_set_updated_at on public.testing_labs;
create trigger testing_labs_set_updated_at
  before update on public.testing_labs
  for each row execute function public.set_updated_at();

alter table public.testing_labs enable row level security;
drop policy if exists "testing_labs staff read" on public.testing_labs;
create policy "testing_labs staff read" on public.testing_labs for select using (public.is_staff());
drop policy if exists "testing_labs admin write" on public.testing_labs;
create policy "testing_labs admin write" on public.testing_labs
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.testing_labs to service_role;

-- ---------------------------------------------------------------------------
-- Seed (values verbatim from the WSLCB lists; testing-labs-core WA_TESTING_LABS
-- is the same data and a test pins the two together).
-- ---------------------------------------------------------------------------
insert into public.testing_labs (lab_number, name, address, city, zip, phone, website, status, cert_start, cert_current, cert_valid_through, source, coa_hosts)
values
  (3,  'Confidence Analytics',          '14797 NE 95th St',              'Redmond',    '98052', '206-743-8843', 'https://conflabs.com',               'active',     'June 18, 2014', 'July 23, 2026', 'July 2027', 'WSLCB Lab List 2026-08-04 (lcb.wa.gov/records/frequently-requested-lists)', '{certs.conflabs.com}'),
  (9,  'Integrity Labs, LLC',           '2747 Pacific Ave SE Ste B21',   'Olympia',    '98501', '360-951-3220', null,                                 'active',     'Aug 19, 2014',  'Oct 29, 2025',  'Oct 2026',  'WSLCB Lab List 2026-08-04 (lcb.wa.gov/records/frequently-requested-lists)', '{}'),
  (12, 'Green Grower Labs',             '124 E. Rowan Ave Ste B',        'Spokane',    '99207', '509-981-2266', null,                                 'active',     'Sept 23, 2014', 'Nov 21, 2025',  'Nov 2026',  'WSLCB Lab List 2026-08-04 (lcb.wa.gov/records/frequently-requested-lists)', '{gglabs-j.github.io}'),
  (18, 'Medicine Creek Analytics',      '3700 Pacific Hwy E Ste 400',    'Fife',       '98424', '253-382-6900', 'https://medicinecreekanalytics.com', 'active',     'May 25, 2016',  'July 21, 2026', 'July 2027', 'WSLCB Lab List 2026-08-04 (lcb.wa.gov/records/frequently-requested-lists)', '{}'),
  (4,  'Analytical 360, LLC',           '31 N 1st Avenue',               'Yakima',     '98902', '509-571-1102', null, 'historical', '2014-05-27', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (6,  'True Northwest, Inc.',          '4139 Libby Rd. NE',             'Olympia',    '98506', '360-352-8688', null, 'historical', '2014-07-10', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (7,  'Testing Technologies, Inc.',    '19834 Viking Ave NW Ste B',     'Poulsbo',    '98370', '360-340-1251', null, 'historical', '2016-10-26', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (8,  'G.O.A.T. Labs',                 '5501 NE 109th Ct Ste N',        'Vancouver',  '98662', '360-513-9377', null, 'historical', '2014-07-23', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (21, 'Treeline Analytics, LLC',       '5373 Guide Meridian Ste F-201', 'Bellingham', '98226', '360-306-3601', null, 'historical', '2018-08-17', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (22, 'Capitol Analysis',              '3011 Pacific Ave SE',           'Olympia',    '98501', '360-918-8795', null, 'historical', '2016-11-09', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (25, 'Pacific Botanicals Laboratory', '3927 Aurora Ave N',             'Seattle',    '98103', '206-566-3526', null, 'historical', '2020-03-23', null, null, 'WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)', '{}'),
  (null, 'Cultivera (vendor platform, not a lab)', null, null, null, null, 'https://cultivera.com', 'platform', null, null, null,
   'R36: 70 of 70 lab links in the owner''s sample transfers are on files.cultivera.com (35 certificates read live)', '{files.cultivera.com}')
on conflict do nothing;

notify pgrst, 'reload schema';
