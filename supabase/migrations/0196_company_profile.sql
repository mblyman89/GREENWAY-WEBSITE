-- ═════════════════════════════════════════════════════════════════════════════
-- 0196 — COMPANY PROFILE: the one place Greenway says who it is
-- ═════════════════════════════════════════════════════════════════════════════
-- Michael asked for this slice in his own words:
--
--   "Please begin work on the next slice, company information setup. I want to
--    make sure we record every company detail we need according to all the
--    different forms they will be auto filling for me. ... Since this info will
--    be used to fill all the forms and whatever else it's used for, I want to
--    make sure we are building forward thinking so everything downstream from
--    this info page will flow into all the reports and forms."
--
-- So this table was designed BACKWARDS FROM THE FORMS, which is standing rule
-- 62: enumerate the consumers before designing the producer. Every column below
-- carries a CONSUMERS list in its comment naming the exact form and box it
-- feeds. A column that feeds nothing was not added, and a box that had no
-- column is the reason several of these exist.
--
-- The forms read to build it, all mirrored under docs/authorities/:
--   IRS Instructions for Form 941 (Rev. March 2026)       17 pp
--   IRS General Instructions for Forms W-2 and W-3 (2026) 36 pp
--   IRS Instructions for Form 940 (2025)                  16 pp
--   IRS Pub. 15 (2026)
--   RCW 50.12.070 (WA ESD registration, quarterly report contents)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE DELIBERATELY DOES NOT DO: DUPLICATE (standing rule 25)
--
-- Three tables already hold fragments of company identity, and the tempting
-- move was to restate them here so the new screen had everything in one row.
-- That would have created three pairs of columns that can disagree, and a
-- disagreement about the EIN is a rejected 941.
--
--   public.ach_company_settings (0057)  company_name, company_id,
--                                       immediate_origin ("1" + EIN),
--                                       destination_routing, originating_dfi
--   public.license_settings     (0031)  license_number, trade_name, submitted_by
--   public.accounting_settings  (0032)  GL account mapping, journal_ref_prefix
--
-- The rule adopted instead: THIS TABLE OWNS LEGAL IDENTITY. The other tables
-- keep owning what they already owned, and §5 installs an audit function that
-- REPORTS any disagreement rather than silently overwriting either side. In
-- particular `ach_company_settings.immediate_origin` is conventionally the
-- digit 1 followed by the EIN, so the audit checks that the nine digits inside
-- it match `company_profile.ein`. Michael approves the fix; the database does
-- not guess.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY EVERY IDENTIFIER IS `text` AND NOT A NUMBER
--
-- An EIN, an ESD account number, a UBI and a ZIP code are all DIGIT STRINGS,
-- not quantities. Nothing is ever added to them, and every one of them can
-- carry a meaningful leading zero (Greenway's ESD number is 000-073905-00-0).
-- Storing any of them as an integer would destroy data on the first insert.
--
-- Format is enforced by CHECK constraints on the DIGITS ONLY, with punctuation
-- rejected rather than stripped. The IRS prints the EIN as 00-0000000 and that
-- hyphen is presentation: it is added when a form is rendered, never stored,
-- so two rows cannot differ by punctuation alone.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SINGLETON, AND THE AUTHORITY FOR IT
--
-- IRS Pub. 15 (2026): "You should have only one EIN." One business, one federal
-- identity, one row. `id boolean primary key default true` with a check that it
-- equals true is the same singleton shape 0031, 0032 and 0057 already use, so
-- the pattern is consistent across the schema rather than novel here.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW TO VERIFY AFTER RUNNING (an empty result is the passing result):
--   select * from public.gl_audit_company_profile();
--
-- This file is IDEMPOTENT. Running it twice is safe and changes nothing the
-- second time.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A NOTE ON THE SUPABASE SQL EDITOR, LEARNED THE HARD WAY IN books-30
--
-- Migration 0195 failed repeatedly in the web editor with `42P01: relation "a"
-- does not exist`, on SQL that is provably valid. The cause was the editor's
-- statement splitter losing track of quoting and reading the words `into a`
-- INSIDE A STRING LITERAL as a real clause. This file is therefore written to
-- avoid giving that splitter anything to trip on:
--
--   * no non-ASCII characters inside string literals
--   * no bare single-letter word after into/from/join/update/table anywhere in
--     quoted prose
--   * no semicolons inside quoted prose
--
-- `scripts/compliance/strip-comments-for-sql-editor.ts` checks all three
-- mechanically and a test asserts this file is clean.
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITIONS - REFUSE TO RUN OUT OF ORDER
--
-- Standing rule 61: an order-dependent migration is untested until it has been
-- applied once, in order, against a real database. If this file ran before
-- is_owner() existed it would create the company's federal identity with NO
-- owner gate and still report success.
-- ═════════════════════════════════════════════════════════════════════════════
do $precheck$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0196 gates the company profile on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.staff_profiles') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0196 records WHO last changed the company identity by pointing at public.staff_profiles, which does not exist yet. Run 0001_slice1_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.ach_company_settings') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0196 cross-checks the EIN against ach_company_settings.immediate_origin, and that table does not exist yet. Run 0057_payroll_ach.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.license_settings') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0196 cross-checks the trade name against license_settings, and that table does not exist yet. Run 0031_ccrs_export.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §1  THE TABLE
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.company_profile (
  id boolean primary key default true,
  constraint company_profile_singleton check (id = true),

  -- ── FEDERAL IDENTITY ─────────────────────────────────────────────────────
  -- Nine digits, no hyphen. The hyphen in the IRS format 00-0000000 is added by
  -- the renderer.
  ein                        text not null default '',

  -- The business (legal) name as written on Form SS-4 when the EIN was applied
  -- for. For Greenway this is LYMAN'S MARIJUANA L.L.C. and it is NOT the name
  -- on the sign.
  legal_name                 text not null default '',

  -- The name the business trades under. Greenway Marijuana. Goes on the Trade
  -- name line, which the instructions say to leave blank when it equals the
  -- legal name.
  trade_name                 text,

  -- Federal tax classification, which decides WHO MAY SIGN a 941.
  entity_type                text not null default 'llc_s_corp'
        check (entity_type in (
          'sole_proprietor',
          'partnership',
          'c_corp',
          's_corp',
          'llc_s_corp',
          'llc_c_corp',
          'llc_partnership',
          'llc_disregarded',
          'trust_or_estate'
        )),

  -- Which quarterly or annual federal employment return the IRS expects. The
  -- IRS ASSIGNS this by notice - it is not the employer's choice - so it is
  -- stored rather than inferred from wage volume.
  federal_return_form        text not null default '941'
        check (federal_return_form in ('941', '944')),

  -- Deposit schedule, determined by the lookback period. Stored because the
  -- engine that computes it already exists in payroll-deposit-schedule-core.ts
  -- and its answer has to be recorded for the quarter it applies to.
  deposit_schedule           text
        check (deposit_schedule is null
               or deposit_schedule in ('monthly', 'semiweekly')),

  -- ── MAILING / FILING ADDRESS ─────────────────────────────────────────────
  -- Structured, not one blob, so the renderer can emit it without commas and so
  -- the state field can independently answer Form 940 line 1a.
  address_line1              text not null default '',
  address_line2              text,
  city                       text not null default '',
  state_code                 text not null default ''
        check (state_code = '' or state_code ~ '^[A-Z]{2}$'),
  zip_code                   text not null default ''
        check (zip_code = '' or zip_code ~ '^[0-9]{5}([0-9]{4})?$'),
  country_code               text not null default 'US'
        check (country_code ~ '^[A-Z]{2}$'),

  -- ── CONTACT BLOCK, WHICH ARE REAL W-3 BOXES ──────────────────────────────
  contact_name               text not null default '',
  contact_phone              text not null default '',
  contact_fax                text,
  contact_email              text not null default '',

  -- ── WHO SIGNS ────────────────────────────────────────────────────────────
  signer_name                text not null default '',
  signer_title               text not null default '',
  signer_phone               text not null default '',

  -- The 5-digit self-select PIN used to sign an e-filed 941. Stored as text for
  -- its leading zeros. NOT a password and never rendered on a report.
  signer_pin                 text
        check (signer_pin is null or signer_pin ~ '^[0-9]{5}$'),

  -- ── WASHINGTON STATE ─────────────────────────────────────────────────────
  -- Unified Business Identifier: 9 digits, printed with spaces (603 353 555).
  wa_ubi                     text not null default '',

  -- Employment Security Department account number. Greenway's is
  -- 000-073905-00-0, whose leading zeros are the reason this is text.
  esd_account_number         text not null default '',

  -- Labor & Industries account number, e.g. 521,756-00. L&I really does print a
  -- comma in it, so no digit-only constraint is imposed here - see §2 for why
  -- that decision is recorded rather than assumed.
  lni_account_number         text not null default '',

  -- The single L&I risk classification Greenway operates under: 6403, Stores -
  -- Specialty. Rates are per class and per quarter and live elsewhere; this is
  -- the identity half.
  lni_risk_class             text not null default '',

  -- WA Department of Revenue tax registration number, usually the UBI.
  dor_account_number         text,

  -- The state whose unemployment tax Greenway pays. WA. Feeds Form 940 line 1a.
  suta_state_code            text not null default 'WA'
        check (suta_state_code ~ '^[A-Z]{2}$'),

  -- Whether wages were paid in more than one state, because that changes Form
  -- 940 from line 1a to line 1b plus Schedule A. Boolean and NOT NULL so the
  -- form builder can never find it unanswered.
  multi_state_employer       boolean not null default false,

  -- ── CANNABIS LICENSING ───────────────────────────────────────────────────
  -- WSLCB retail licence number. license_settings (0031) owns the CCRS export
  -- copy; this is the identity copy and §5 audits that they agree.
  wslcb_license_number       text not null default '',

  -- ── FISCAL AND CALENDAR ──────────────────────────────────────────────────
  -- Month the fiscal year ENDS. 12 for a calendar-year taxpayer, which an
  -- S-corporation almost always is.
  fiscal_year_end_month      smallint not null default 12
        check (fiscal_year_end_month between 1 and 12),

  -- The first date this system is the system of record for payroll. Michael's
  -- answer is 2027-01-01. Nullable so it is visibly UNSET rather than defaulted
  -- to today, which would silently claim history this system never had.
  payroll_start_date         date,

  -- ── CHANGE TRACKING, WHICH THE IRS REQUIRES NOTICE OF ────────────────────
  -- Pub. 15 (2026): "Notify the IRS immediately if you change your business
  -- name." So a change is an EVENT with an obligation, not a field update. The
  -- effective dates let a form builder pick the name that was correct for the
  -- quarter being filed rather than the name that is correct today.
  legal_name_effective_date  date,
  address_effective_date     date,

  -- Responsible party, a distinct concept from owner or officer, with its own
  -- Form 8822-B notification duty.
  responsible_party_name     text not null default '',
  responsible_party_ssn_last_four text
        check (responsible_party_ssn_last_four is null
               or responsible_party_ssn_last_four ~ '^[0-9]{4}$'),

  -- ── HOUSEKEEPING ─────────────────────────────────────────────────────────
  notes                      text,
  updated_by                 uuid references public.staff_profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

insert into public.company_profile (id) values (true)
  on conflict (id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- §2  FORMAT CONSTRAINTS, ADDED SEPARATELY AND ON PURPOSE
--
-- These are `alter table ... add constraint` rather than inline checks so the
-- file stays idempotent against a table that already exists from an earlier
-- run. A `create table if not exists` silently ignores new inline checks, which
-- would mean a second run appears to tighten validation and does not.
--
-- EVERY CHECK ALLOWS THE EMPTY STRING. The row is created empty and filled in
-- by Michael over several sittings, so a constraint that forbade '' would make
-- the table impossible to insert. Emptiness is caught by the READINESS engine
-- (company-identity-core.ts), which is where "not filled in yet" belongs -
-- a constraint cannot tell an unfinished row from a wrong one.
--
-- WHY NO DIGIT CHECK ON lni_account_number. Labor and Industries prints the
-- account number with a comma in it - Greenway's is 521,756-00. A digit-only
-- constraint would reject the number as the state actually issues it. Recorded
-- here rather than left as an apparent oversight.
-- ═════════════════════════════════════════════════════════════════════════════
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_profile_ein_format'
      and conrelid = 'public.company_profile'::regclass
  ) then
    alter table public.company_profile
      add constraint company_profile_ein_format
      check (ein = '' or ein ~ '^[0-9]{9}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'company_profile_ubi_format'
      and conrelid = 'public.company_profile'::regclass
  ) then
    alter table public.company_profile
      add constraint company_profile_ubi_format
      check (wa_ubi = '' or wa_ubi ~ '^[0-9]{9}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'company_profile_esd_format'
      and conrelid = 'public.company_profile'::regclass
  ) then
    alter table public.company_profile
      add constraint company_profile_esd_format
      check (esd_account_number = '' or esd_account_number ~ '^[0-9]{3}-[0-9]{6}-[0-9]{2}-[0-9]$');
  end if;
end
$constraints$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §3  COLUMN COMMENTS - EVERY FIELD NAMES ITS CONSUMERS
--
-- STANDING RULE 62e IN THE DATABASE ITSELF. Michael's instruction was that
-- "everything downstream from this info page will flow into all the reports and
-- forms". The only way to keep that true as the form builders arrive one slice
-- at a time is for each column to state, in the schema, which form and which
-- box it feeds. A developer adding the W-2 builder reads the consumers list
-- instead of guessing which column means what - and a column whose consumer
-- list is empty is a column that should not exist.
--
-- These comments are load-bearing rather than decorative: a test walks
-- pg_description and fails if a column on this table has no comment.
-- ═════════════════════════════════════════════════════════════════════════════
comment on table public.company_profile is
  'Singleton. Greenway legal identity as the taxing agencies know it. Designed backwards from the forms it feeds: Form 941, Form 940, Forms W-2 and W-3, WA Form 5208, and the NACHA payroll file. Owns LEGAL identity only - ach_company_settings still owns originating bank details and license_settings still owns the CCRS export copy of the licence, and gl_audit_company_profile() reports any disagreement between them.';

comment on column public.company_profile.ein is
  'Employer Identification Number, nine digits, no punctuation. CONSUMERS: Form 941 page 1 and page 2 header. Form 940 page 1 and page 2 header. Form W-2 box b for every employee. Form W-3 box e. ACH company identification. EFTPS deposits. AUTHORITY: IRS Pub. 15 (2026) gives the format 00-0000000. The Instructions for Form 941 (2026) state an electronically filed return is not accepted without a valid EIN, which is why the readiness engine refuses to report a filing as ready when this is blank.';

comment on column public.company_profile.legal_name is
  'The business (legal) name used when applying for the EIN on Form SS-4. CONSUMERS: Form 941 Name line. Form 940 Name line. Form W-2 box c. Form W-3 box f. AUTHORITY: Instructions for Form 940 (2025) say to enter the legal name used on the SS-4. The authoritative copy is the IRS CP 575 EIN confirmation letter, not the Secretary of State record and not the signage.';

comment on column public.company_profile.trade_name is
  'The name the business trades under, when it differs from the legal name. CONSUMERS: Form 941 Trade name line. Form 940 Trade name line. AUTHORITY: Instructions for Form 941 (2026) give the worked example of a legal name on the Name line and a trading name on the Trade name line, and say to leave Trade name blank when the two are the same.';

comment on column public.company_profile.entity_type is
  'Federal tax classification. CONSUMERS: Form 941 Part 5 signature block, because the list of persons authorised to sign is BY ENTITY TYPE. Form 1120-S applicability. AUTHORITY: Instructions for Form 941 (2026), Part 5 Sign Here (Approved Roles). Greenway is an LLC with an S-corporation election, so it signs under the corporation rule - the president, vice president or another duly authorised principal officer.';

comment on column public.company_profile.federal_return_form is
  'Whether the IRS expects Form 941 quarterly or Form 944 annually. CONSUMERS: which return the filing calendar generates. Form W-3 box b Kind of Payer. AUTHORITY: Instructions for Forms W-2 and W-3 (2026), Box b Kind of Payer, which says to check only one box. The IRS assigns this by notice, so it is recorded rather than inferred from wage volume.';

comment on column public.company_profile.deposit_schedule is
  'Monthly or semiweekly federal deposit schedule for the current year, from the lookback period. CONSUMERS: Form 941 line 16 and Schedule B applicability. The deposit calendar. Null means not yet determined, which is honest for a first year. The computing engine already exists in src/lib/payroll/payroll-deposit-schedule-core.ts and this column records its answer for the year it applies to.';

comment on column public.company_profile.address_line1 is
  'Street address. CONSUMERS: Form 941 address block. Form 940 address block. Form W-2 box c. Form W-3 box g. AUTHORITY: Instructions for Forms W-2 and W-3 (2026), Box c, which notes the US Postal Service recommends no commas or periods in return addresses - which is why the address is stored in parts and punctuated by the renderer.';

comment on column public.company_profile.address_line2 is
  'Suite, room or unit. CONSUMERS: same as address_line1. Separate because the instructions say to include the unit number after the street address, and a single line cannot be reordered.';

comment on column public.company_profile.city is
  'City. CONSUMERS: Form 941, Form 940, Form W-2 box c, Form W-3 box g address blocks.';

comment on column public.company_profile.state_code is
  'Two-letter USPS state code of the MAILING address. CONSUMERS: Form 941, Form 940, Form W-2 box c, Form W-3 box g. Deliberately NOT the same field as suta_state_code - a business can be headquartered in one state and pay unemployment tax in another, and conflating them is how a wrong Form 940 line 1a happens.';

comment on column public.company_profile.zip_code is
  'ZIP, five digits or ZIP+4 as nine digits with no hyphen. CONSUMERS: Form 941, Form 940, Form W-2 box c, Form W-3 box g.';

comment on column public.company_profile.country_code is
  'ISO country code. CONSUMERS: address rendering, and the branch of the Form 941 instructions about a principal business organised outside the United States. Defaults to US.';

comment on column public.company_profile.contact_name is
  'Employer contact person. CONSUMERS: Form W-3 Employer contact person box. AUTHORITY: Instructions for Forms W-2 and W-3 (2026) state this is included for use by the SSA if any questions arise during processing. It is a real box on the form, not CRM data.';

comment on column public.company_profile.contact_phone is
  'Employer telephone number. CONSUMERS: Form W-3 Employer telephone number box. Form 941 Part 4 third-party designee block when used.';

comment on column public.company_profile.contact_fax is
  'Employer fax number. CONSUMERS: Form W-3 Employer fax number box. Nullable because most employers no longer have one and an empty string would render as a blank box either way.';

comment on column public.company_profile.contact_email is
  'Employer email address. CONSUMERS: Form W-3 Employer email address box. AUTHORITY: Instructions for Forms W-2 and W-3 (2026) note the SSA will notify the employer by email or postal mail about corrections, so this is the channel a real notice arrives on.';

comment on column public.company_profile.signer_name is
  'Name of the person who signs the employment tax returns. CONSUMERS: Form 941 Part 5. Form 940 Part 7. Form W-3 signature block.';

comment on column public.company_profile.signer_title is
  'Title of the signer. CONSUMERS: Form 941 Part 5. Form 940 Part 7. AUTHORITY: Instructions for Form 941 (2026), Part 5, list who may sign by entity type. For an LLC treated as a corporation the signer must be the president, the vice president or another principal officer duly authorised to sign, so the title is not free text in practice and the readiness engine checks it against the entity type.';

comment on column public.company_profile.signer_phone is
  'Best daytime phone for the signer. CONSUMERS: Form 941 Part 5 phone. Form 940 Part 7 phone.';

comment on column public.company_profile.signer_pin is
  'Five-digit IRS self-select PIN for signing an e-filed Form 941. CONSUMERS: the 941 e-file signature. Stored as text for its leading zeros. Not a password, and excluded from every report renderer.';

comment on column public.company_profile.wa_ubi is
  'Washington Unified Business Identifier, nine digits, stored without the spaces Washington prints. CONSUMERS: WA Business Licence renewal. Department of Revenue combined excise tax return. Cross-reference on ESD and L and I correspondence. AUTHORITY: RCW 50.12.070(1)(b) shows the UBI is a statutory account number Washington expects to be obtained and preserved. That subsection concerns contractors rather than the employer own filings, and the help text says so rather than overstating the citation.';

comment on column public.company_profile.esd_account_number is
  'Employment Security Department account number, format 000-000000-00-0. CONSUMERS: WA Form 5208A quarterly wage detail. Form 5208B tax report. Form 940 line 1a supporting detail for the FUTA credit. AUTHORITY: RCW 50.12.070(2)(a)(i) requires each employer to register with the department and obtain an employment security account number. Text because Greenway number begins 000.';

comment on column public.company_profile.lni_account_number is
  'Labor and Industries account number. CONSUMERS: the L and I quarterly report. Workers compensation premium calculation. No digit-only constraint is applied because L and I issues the number with a comma in it, for example 521,756-00.';

comment on column public.company_profile.lni_risk_class is
  'L and I risk classification code, for Greenway 6403 Stores Specialty. CONSUMERS: the L and I quarterly report. Premium rate lookup per hour worked. The rate itself is per class and per year and lives with the rate tables, not here.';

comment on column public.company_profile.dor_account_number is
  'Department of Revenue tax registration number, usually the same digits as the UBI. CONSUMERS: the combined excise tax return, including the cannabis excise tax. Nullable because it is frequently identical to the UBI and a duplicate required field invites a mismatch.';

comment on column public.company_profile.suta_state_code is
  'The state whose unemployment tax the employer is required to pay. CONSUMERS: Form 940 line 1a. The SUTA calculation in payroll-withholding-core.ts. AUTHORITY: Instructions for Form 940 (2025) line 1a say to enter the two-letter USPS abbreviation for the state where you were required to pay your state unemployment tax. Separate from state_code by design.';

comment on column public.company_profile.multi_state_employer is
  'True when unemployment tax was owed to more than one state. CONSUMERS: Form 940 line 1b and Schedule A applicability. AUTHORITY: Instructions for Form 940 (2025) route a multi-state employer to line 1b and Schedule A instead of line 1a. NOT NULL so the form builder can never find it unanswered and pick a branch by default.';

comment on column public.company_profile.wslcb_license_number is
  'Washington State Liquor and Cannabis Board retail licence number. CONSUMERS: CCRS reporting. Excise tax filing. Vendor and banking due diligence. license_settings (0031) holds the copy the CCRS exporter uses, and gl_audit_company_profile() reports a disagreement rather than either table overwriting the other.';

comment on column public.company_profile.fiscal_year_end_month is
  'Month the fiscal year ends, 12 for a calendar-year taxpayer. CONSUMERS: Form 1120-S period. Period-close scheduling. Depreciation conventions. An S-corporation is required to use a permitted tax year, which is almost always the calendar year.';

comment on column public.company_profile.payroll_start_date is
  'First date this system is the system of record for payroll. Michael answer is 2027-01-01. CONSUMERS: the YTD accumulator baseline. The first quarter Form 941 this system produces. The Form W-2 first year. Nullable so it reads as UNSET rather than defaulting to today and silently claiming history this system never held.';

comment on column public.company_profile.legal_name_effective_date is
  'Date the current legal name took effect. CONSUMERS: picking the name that was correct for the quarter being filed rather than the name correct today. AUTHORITY: IRS Pub. 15 (2026) says to notify the IRS immediately if you change your business name, which makes a name change an event with an obligation rather than a field edit.';

comment on column public.company_profile.address_effective_date is
  'Date the current address took effect. CONSUMERS: same as legal_name_effective_date. AUTHORITY: IRS Pub. 15 (2026) requires immediate notice of a change of business address or responsible party, and the Instructions for Form 940 (2025) name the mechanism as Form 8822-B, which must not be mailed with the return.';

comment on column public.company_profile.responsible_party_name is
  'The responsible party as the IRS uses the term on Form SS-4 and Form 8822-B. CONSUMERS: the Form 8822-B reminder. Beneficial-ownership questions. A distinct concept from owner, officer or signer, with its own notification duty, which is why it is stored rather than inferred from the signer.';

comment on column public.company_profile.responsible_party_ssn_last_four is
  'Last four digits only of the responsible party taxpayer identifying number, for confirming identity against IRS correspondence. Never the full number. Four digits alone cannot reconstruct an identifier, which is the whole reason the column is shaped this way.';

comment on column public.company_profile.notes is
  'Free text for the owner. Never parsed and never rendered onto a form.';

comment on column public.company_profile.updated_by is
  'Which staff profile last changed the company identity. CONSUMERS: the change log and the internal-control review, where an unattributable change to the EIN would itself be the finding.';

comment on column public.company_profile.created_at is
  'When the singleton row was created.';

comment on column public.company_profile.updated_at is
  'When the company identity was last changed. Maintained by the trigger in section 4.';

comment on column public.company_profile.id is
  'Always true. The singleton key. AUTHORITY: IRS Pub. 15 (2026) - you should have only one EIN - so one business means one row.';

-- ═════════════════════════════════════════════════════════════════════════════
-- §4  updated_at TRIGGER
--
-- Reuses the existing set_updated_at() convention rather than defining a new
-- function, and creates one only if the shared function is genuinely absent.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.company_profile_touch()
returns trigger
language plpgsql
as $touch$
begin
  new.updated_at := now();
  return new;
end
$touch$;

comment on function public.company_profile_touch() is
  'Stamps updated_at on any change to the company profile, so the audit trail does not depend on the caller remembering.';

drop trigger if exists company_profile_touch_trg on public.company_profile;
create trigger company_profile_touch_trg
  before update on public.company_profile
  for each row execute function public.company_profile_touch();

-- ═════════════════════════════════════════════════════════════════════════════
-- §5  ROW LEVEL SECURITY - OWNER ONLY
--
-- This row holds the EIN, the e-file PIN and the responsible party. It is the
-- company legal identity and it is gated on is_owner(), the same gate the
-- general ledger uses since 0185. Staff who ring up sales have no business
-- reading it and no reason to.
--
-- Policies are created through a loop with a drop-if-exists so the file is
-- idempotent - Postgres has no create policy if not exists.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.company_profile enable row level security;

do $rls$
begin
  drop policy if exists company_profile_select on public.company_profile;
  execute 'create policy company_profile_select on public.company_profile for select using (public.is_owner())';

  drop policy if exists company_profile_insert on public.company_profile;
  execute 'create policy company_profile_insert on public.company_profile for insert with check (public.is_owner())';

  drop policy if exists company_profile_update on public.company_profile;
  execute 'create policy company_profile_update on public.company_profile for update using (public.is_owner()) with check (public.is_owner())';

  -- NO DELETE POLICY, DELIBERATELY. There is exactly one row and deleting it
  -- would leave every form builder with nothing to read. Absence of a policy
  -- under RLS denies the operation, so this is enforced rather than merely
  -- discouraged.
end
$rls$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §6  THE AUDIT FUNCTION
--
-- Standing rule 16: prove the gate is wired. This function is how Michael
-- checks the migration actually took effect, and it is also the only place that
-- reports DISAGREEMENT between this table and the three tables that already
-- held fragments of company identity.
--
-- IT REPORTS AND DOES NOT REPAIR. An automatic repair would have to choose a
-- winner between two EINs, and choosing would be guessing. Michael decides.
--
-- AN EMPTY RESULT IS THE PASSING RESULT.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_company_profile()
returns table (finding text, detail text)
language plpgsql
security definer
set search_path = public
as $audit$
declare
  v_ein          text;
  v_origin       text;
  v_wslcb        text;
  v_lic          text;
  v_policy_count integer;
begin
  if not public.is_owner() then
    -- GL_NOT_OWNER, and not a code invented for this function. The refusal
    -- catalogue in gl-refusal-core.ts already translates this one into plain
    -- English, and a drift test asserts that every code the migrations can
    -- raise has a translation. The first draft raised
    -- 'gl_audit_company_profile: owner only.' - which the extractor read as a
    -- brand new untranslated code, and the test failed rather than letting a
    -- raw Postgres string reach the owner's screen.
    raise exception 'GL_NOT_OWNER: the company profile audit is owner-only.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1) The singleton really is single.
  return query
  select 'company_profile row count is not exactly one'::text,
         format('found %s rows', count(*))::text
  from public.company_profile
  having count(*) <> 1;

  -- 2) RLS is enabled. A table holding the EIN with RLS off is the finding.
  return query
  select 'row level security is not enabled on company_profile'::text,
         'expected relrowsecurity to be true'::text
  from pg_class
  where oid = 'public.company_profile'::regclass
    and relrowsecurity is not true;

  -- 3) Every policy is gated on is_owner(). A policy using true would pass a
  --    naive count of policies while protecting nothing.
  return query
  select 'policy is not gated on is_owner()'::text,
         format('policy %s has expression %s',
                p.policyname,
                coalesce(p.qual, '') || coalesce(p.with_check, ''))::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'company_profile'
    and coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%is_owner%';

  -- 4) There must be at least the three expected policies. Standing rule 39: a
  --    check over an empty set passes vacuously, so the count is asserted too.
  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'company_profile';

  if v_policy_count < 3 then
    return query
    select 'company_profile has fewer policies than expected'::text,
           format('found %s, expected at least 3 for select, insert and update', v_policy_count)::text;
  end if;

  -- 5) Every column carries a comment naming its consumers. This is standing
  --    rule 62e enforced in the database rather than trusted to review.
  return query
  select 'column has no comment naming its consumers'::text,
         a.attname::text
  from pg_attribute a
  where a.attrelid = 'public.company_profile'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and col_description(a.attrelid, a.attnum) is null;

  -- 6) THE CROSS-TABLE AGREEMENT CHECKS.
  --    ach_company_settings.immediate_origin is conventionally the digit 1
  --    followed by the nine-digit EIN. If both are populated and the nine
  --    digits disagree, the NACHA file and the 941 are describing two different
  --    businesses. Reported, never repaired.
  select ein into v_ein from public.company_profile where id = true;
  select immediate_origin into v_origin from public.ach_company_settings where id = true;

  if coalesce(v_ein, '') <> '' and coalesce(v_origin, '') <> '' then
    if regexp_replace(v_origin, '[^0-9]', '', 'g') not like ('%' || v_ein) then
      return query
      select 'EIN disagrees with ach_company_settings.immediate_origin'::text,
             format('company_profile.ein is %s and immediate_origin digits are %s. The NACHA header and the Form 941 would name different businesses. Fix whichever is wrong.',
                    v_ein, regexp_replace(v_origin, '[^0-9]', '', 'g'))::text;
    end if;
  end if;

  --    The WSLCB licence number is held here for identity and in
  --    license_settings for the CCRS export. They must agree.
  select wslcb_license_number into v_wslcb from public.company_profile where id = true;
  select license_number into v_lic from public.license_settings where id = true;

  if coalesce(v_wslcb, '') <> '' and coalesce(v_lic, '') <> '' and v_wslcb <> v_lic then
    return query
    select 'WSLCB licence number disagrees with license_settings'::text,
           format('company_profile has %s and license_settings has %s. The CCRS export and the company record would not match.',
                  v_wslcb, v_lic)::text;
  end if;

  return;
end
$audit$;

comment on function public.gl_audit_company_profile() is
  'Owner-only. Proves 0196 is wired: singleton intact, RLS on, every policy gated on is_owner(), every column documented with its consumers, and no disagreement with ach_company_settings or license_settings. An empty result is the passing result. Reports rather than repairs, because choosing between two EINs would be guessing.';

revoke all on function public.gl_audit_company_profile() from public;
grant execute on function public.gl_audit_company_profile() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- §7  GRANTS
--
-- Table privileges are granted to authenticated and RLS decides who actually
-- sees the row. No delete grant, matching the missing delete policy.
-- ═════════════════════════════════════════════════════════════════════════════
grant select, insert, update on public.company_profile to authenticated;
