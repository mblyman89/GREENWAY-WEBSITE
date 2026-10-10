-- =============================================================================
-- Migration 0258 - R39 S2: ACH authorizations (employees and vendors)
-- =============================================================================
-- Owner request R39 (docs/roadmap/R39-ACH-INTEGRATION.md). What this adds, and
-- which owner answer each piece carries out:
--
--   ach_authorizations            one signed authorization per payee at a time
--                                 (employee OR vendor). States mirror
--                                 AUTHORIZATION_STATES in
--                                 src/lib/payments/ach-authorization-core.ts.
--                                 Never deleted while retention runs (Q7, Q8).
--   ach_authorization_accounts    up to 3 deposit accounts per authorization,
--                                 fixed / percent / remainder (Q4, Q11).
--                                 Routing and account must be encv1 ciphertext.
--   ach_authorization_documents   the signed form, voided check, bank letter or
--                                 e-sign certificate, in the private ach-docs
--                                 bucket, with its sha256 (Q2, Q5, Q6, Q10).
--                                 Managers may DROP files in; they can never
--                                 read them back (Q2 enterprise uploads).
--   ach_authorization_events      append-only audit log. No update, no delete.
--   ach_verifications             prenote or test credit (micro-entry) per
--                                 account (Q3).
--   ach_return_notices            returns and notifications of change (NOC)
--                                 received from Timberland (Q9 notify).
--   payee_contacts                phone and email on file WITH the date each
--                                 was first on file, so a callback can be held
--                                 to the look-back window (Q13). A contact is
--                                 never edited in place: retire it and add a
--                                 new one, so the date cannot be reset.
--   vendors.ach_*                 needs-bank-info flag and opted-out checkbox
--                                 for the vendor detail page.
--   vendor_bank_details.status    widened to admit revoked and archived, so
--                                 "delete" in the vault can become archive (Q7).
--
-- Security model (same as 0143): RLS on, admin-only (is_admin = owner/admin,
-- i.e. Michael and Stephen, Q1) for every read and write, plus two narrow
-- manager INSERT policies for drop-only uploads. Direct table grants are
-- revoked from anon; authenticated keeps only what RLS then narrows.
--
-- Retention (Q8): rows are protected by triggers that refuse DELETE until the
-- latest of 6 years after the authorization ended and 6 years after it was
-- signed has passed, and never while a legal hold is set. Those two dates
-- always cover Nacha (2 years after end) and WAC 314-55-087 (5 years). This
-- mirrors retentionVerdict() in the core; a test compares them.
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule). No data is backfilled.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Authorizations
-- -----------------------------------------------------------------------------
create table if not exists public.ach_authorizations (
  id                    uuid primary key default gen_random_uuid(),
  payee_type            text not null check (payee_type in ('employee', 'vendor')),
  -- restrict, not cascade: removing a person or vendor must never erase the
  -- record that they authorized payments (Q7: delete becomes archive).
  employee_id           uuid references public.employees (id) on delete restrict,
  vendor_id             uuid references public.vendors (id) on delete restrict,
  payee_name            text not null default '',
  state                 text not null default 'draft'
                          check (state in ('draft', 'signed', 'verifying', 'active',
                                           'on_hold', 'revoked', 'archived')),
  signature_method      text
                          check (signature_method is null
                                 or signature_method in ('wet_ink_upload', 'esign')),
  signed_on             date,
  ended_on              date,
  ended_reason          text,
  hold_reason           text,
  legal_hold            boolean not null default false,
  legal_hold_reason     text,
  annual_review_due_on  date,
  created_by            uuid references public.staff_profiles (id) on delete set null,
  updated_by            uuid references public.staff_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ach_auth_payee_matches_type check (
    (payee_type = 'employee' and employee_id is not null and vendor_id is null)
    or (payee_type = 'vendor' and vendor_id is not null and employee_id is null)
  ),
  constraint ach_auth_signed_has_date check (state = 'draft' or signed_on is not null),
  constraint ach_auth_signed_has_method check (state = 'draft' or signature_method is not null),
  constraint ach_auth_ended_has_date check (state not in ('revoked', 'archived') or ended_on is not null),
  constraint ach_auth_end_after_sign check (ended_on is null or signed_on is null or ended_on >= signed_on),
  constraint ach_auth_hold_has_reason check (state <> 'on_hold' or coalesce(length(trim(hold_reason)), 0) > 0),
  constraint ach_auth_legal_hold_reason check (not legal_hold or coalesce(length(trim(legal_hold_reason)), 0) > 0)
);

-- One OPEN authorization per payee. Ended ones (revoked, archived) stay as
-- history and do not count.
create unique index if not exists ach_auth_one_open_per_employee
  on public.ach_authorizations (employee_id)
  where employee_id is not null and state not in ('revoked', 'archived');
create unique index if not exists ach_auth_one_open_per_vendor
  on public.ach_authorizations (vendor_id)
  where vendor_id is not null and state not in ('revoked', 'archived');
create index if not exists ach_auth_state_idx on public.ach_authorizations (state);

drop trigger if exists set_updated_at_ach_authorizations on public.ach_authorizations;
create trigger set_updated_at_ach_authorizations
  before update on public.ach_authorizations
  for each row execute function public.set_updated_at();

-- Lifecycle guard. Same edges as TRANSITIONS in ach-authorization-core.ts; a
-- test parses both and compares them, so they cannot drift.
create or replace function public.ach_auth_guard_transition()
returns trigger language plpgsql as $$
declare
  allowed text[];
begin
  if new.state is not distinct from old.state then
    if old.state = 'archived' and (
         new.payee_type  is distinct from old.payee_type
      or new.employee_id is distinct from old.employee_id
      or new.vendor_id   is distinct from old.vendor_id
      or new.signed_on   is distinct from old.signed_on
      or new.ended_on    is distinct from old.ended_on) then
      raise exception 'ACH_AUTH_ARCHIVED: archived authorization % is read-only (legal hold may still change).', old.id;
    end if;
    return new;
  end if;
  allowed := case old.state
    when 'draft'     then array['signed', 'archived']
    when 'signed'    then array['verifying', 'active', 'on_hold', 'revoked', 'archived']
    when 'verifying' then array['active', 'on_hold', 'revoked', 'archived']
    when 'active'    then array['on_hold', 'revoked', 'archived']
    when 'on_hold'   then array['verifying', 'active', 'revoked', 'archived']
    when 'revoked'   then array['archived']
    else array[]::text[]
  end;
  if not (new.state = any (allowed)) then
    raise exception 'ACH_AUTH_TRANSITION: % -> % is not allowed.', old.state, new.state;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_auth_guard_transition on public.ach_authorizations;
create trigger trg_ach_auth_guard_transition
  before update on public.ach_authorizations
  for each row execute function public.ach_auth_guard_transition();

-- Retention guard (Q8). The earliest a row may be deleted.
create or replace function public.ach_retention_may_dispose(
  p_signed_on date, p_ended_on date, p_legal_hold boolean, p_today date
) returns boolean language sql immutable as $$
  select p_legal_hold is not true
     and p_ended_on is not null
     and p_today > greatest(
           (p_ended_on + interval '6 years')::date,
           coalesce((p_signed_on + interval '6 years')::date, (p_ended_on + interval '6 years')::date)
         );
$$;

create or replace function public.ach_auth_guard_delete()
returns trigger language plpgsql as $$
begin
  if not public.ach_retention_may_dispose(old.signed_on, old.ended_on, old.legal_hold, current_date) then
    raise exception 'ACH_RETENTION: authorization % must be kept (in effect, on legal hold, or inside the 6-year retention window). Archive it instead.', old.id;
  end if;
  return old;
end $$;

drop trigger if exists trg_ach_auth_guard_delete on public.ach_authorizations;
create trigger trg_ach_auth_guard_delete
  before delete on public.ach_authorizations
  for each row execute function public.ach_auth_guard_delete();

-- -----------------------------------------------------------------------------
-- 2. Accounts (up to 3 per authorization, Q11; credit splits, Q4)
-- -----------------------------------------------------------------------------
create table if not exists public.ach_authorization_accounts (
  id                    uuid primary key default gen_random_uuid(),
  authorization_id      uuid not null references public.ach_authorizations (id) on delete restrict,
  priority              smallint not null check (priority between 1 and 3),
  rule_kind             text not null check (rule_kind in ('fixed', 'percent', 'remainder')),
  fixed_cents           bigint,
  basis_points          integer,
  bank_name             text not null default '',
  -- encv1 ciphertext only (src/lib/security/at-rest-crypto.ts). Plaintext is
  -- refused here, so a missing DATA_ENCRYPTION_KEY fails loudly, not silently.
  routing_enc           text not null check (routing_enc like 'encv1:%'),
  account_enc           text not null check (account_enc like 'encv1:%'),
  account_type          text not null check (account_type in ('checking', 'savings')),
  account_last4         text not null check (account_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  routing_last4         text not null check (routing_last4 ~ '^[0-9]{4}$'),
  -- keyed hash of normalizeAccountKey(); lets the app spot the same account
  -- reused across payees (a fraud signal) without decrypting anything.
  account_key_hmac      text not null check (account_key_hmac ~ '^[0-9a-f]{64}$'),
  verification_status   text not null default 'unverified'
                          check (verification_status in ('unverified', 'pending', 'verified', 'failed')),
  verification_method   text
                          check (verification_method is null
                                 or verification_method in ('prenote', 'micro_entry', 'voided_check_callback')),
  verified_at           timestamptz,
  verified_by           uuid references public.staff_profiles (id) on delete set null,
  archived_at           timestamptz,
  created_by            uuid references public.staff_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ach_acct_rule_shape check (
    (rule_kind = 'fixed'     and fixed_cents is not null and fixed_cents > 0 and basis_points is null)
    or (rule_kind = 'percent'   and basis_points is not null and basis_points between 1 and 9999 and fixed_cents is null)
    or (rule_kind = 'remainder' and fixed_cents is null and basis_points is null)
  ),
  constraint ach_acct_verified_shape check (
    (verification_status = 'verified') = (verified_at is not null and verification_method is not null)
  )
);

create unique index if not exists ach_acct_priority_unique
  on public.ach_authorization_accounts (authorization_id, priority) where archived_at is null;
create unique index if not exists ach_acct_one_remainder
  on public.ach_authorization_accounts (authorization_id) where archived_at is null and rule_kind = 'remainder';
create unique index if not exists ach_acct_no_duplicate_account
  on public.ach_authorization_accounts (authorization_id, account_key_hmac) where archived_at is null;
create index if not exists ach_acct_key_idx on public.ach_authorization_accounts (account_key_hmac);

drop trigger if exists set_updated_at_ach_authorization_accounts on public.ach_authorization_accounts;
create trigger set_updated_at_ach_authorization_accounts
  before update on public.ach_authorization_accounts
  for each row execute function public.set_updated_at();

-- Bank details are never edited in place: a change archives the row and adds
-- a new one (which puts the authorization on hold in the app). Only status,
-- verification and archived_at may change.
create or replace function public.ach_acct_guard_update()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ACH_ACCOUNT_IMMUTABLE: accounts are archived, never deleted (%).', old.id;
  end if;
  if old.archived_at is not null then
    raise exception 'ACH_ACCOUNT_IMMUTABLE: account % is archived.', old.id;
  end if;
  if new.authorization_id is distinct from old.authorization_id
     or new.routing_enc   is distinct from old.routing_enc
     or new.account_enc   is distinct from old.account_enc
     or new.account_type  is distinct from old.account_type
     or new.account_key_hmac is distinct from old.account_key_hmac
     or new.account_last4 is distinct from old.account_last4
     or new.routing_last4 is distinct from old.routing_last4 then
    raise exception 'ACH_ACCOUNT_IMMUTABLE: change bank details by archiving account % and adding a new one.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_acct_guard_update on public.ach_authorization_accounts;
create trigger trg_ach_acct_guard_update
  before update or delete on public.ach_authorization_accounts
  for each row execute function public.ach_acct_guard_update();

-- At most 3 live accounts per authorization (MAX_ACCOUNTS_PER_PAYEE).
create or replace function public.ach_acct_guard_count()
returns trigger language plpgsql as $$
begin
  if new.archived_at is null and (
    select count(*) from public.ach_authorization_accounts
    where authorization_id = new.authorization_id and archived_at is null and id <> new.id
  ) >= 3 then
    raise exception 'ACH_ACCOUNT_LIMIT: an authorization may have at most 3 accounts.';
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_acct_guard_count on public.ach_authorization_accounts;
create trigger trg_ach_acct_guard_count
  before insert or update on public.ach_authorization_accounts
  for each row execute function public.ach_acct_guard_count();

-- -----------------------------------------------------------------------------
-- 3. Documents (private bucket ach-docs; managers drop, admins read)
-- -----------------------------------------------------------------------------
create table if not exists public.ach_authorization_documents (
  id                    uuid primary key default gen_random_uuid(),
  authorization_id      uuid references public.ach_authorizations (id) on delete restrict,
  payee_type            text not null check (payee_type in ('employee', 'vendor')),
  employee_id           uuid references public.employees (id) on delete restrict,
  vendor_id             uuid references public.vendors (id) on delete restrict,
  kind                  text not null
                          check (kind in ('signed_form', 'voided_check', 'bank_letter',
                                          'esign_certificate', 'other')),
  storage_path          text not null unique check (storage_path like 'ach-docs/%'),
  sha256                text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size             bigint not null check (byte_size > 0 and byte_size <= 26214400),
  mime_type             text not null
                          check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  original_filename     text not null default '',
  intake_status         text not null default 'received'
                          check (intake_status in ('received', 'extracted', 'rekeyed', 'accepted', 'rejected')),
  intake_note           text,
  uploaded_by           uuid references public.staff_profiles (id) on delete set null,
  uploaded_at           timestamptz not null default now(),
  archived_at           timestamptz,
  constraint ach_doc_payee_matches_type check (
    (payee_type = 'employee' and employee_id is not null and vendor_id is null)
    or (payee_type = 'vendor' and vendor_id is not null and employee_id is null)
  )
);

create unique index if not exists ach_doc_sha_per_payee
  on public.ach_authorization_documents (payee_type, coalesce(employee_id, vendor_id), sha256);
create index if not exists ach_doc_auth_idx on public.ach_authorization_documents (authorization_id);

-- The file itself is evidence: its path, hash and size are fixed at upload.
create or replace function public.ach_doc_guard()
returns trigger language plpgsql as $$
declare
  a record;
begin
  if tg_op = 'DELETE' then
    select signed_on, ended_on, legal_hold into a
      from public.ach_authorizations where id = old.authorization_id;
    if old.authorization_id is null or not found
       or not public.ach_retention_may_dispose(a.signed_on, a.ended_on, a.legal_hold, current_date) then
      raise exception 'ACH_RETENTION: document % must be kept. Archive it instead.', old.id;
    end if;
    return old;
  end if;
  if new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.byte_size is distinct from old.byte_size
     or new.uploaded_at is distinct from old.uploaded_at
     or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'ACH_DOC_IMMUTABLE: the stored file of document % cannot be swapped.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ach_doc_guard on public.ach_authorization_documents;
create trigger trg_ach_doc_guard
  before update or delete on public.ach_authorization_documents
  for each row execute function public.ach_doc_guard();

insert into storage.buckets (id, name, public)
values ('ach-docs', 'ach-docs', false)
on conflict (id) do nothing;

drop policy if exists ach_docs_admin_read on storage.objects;
create policy ach_docs_admin_read on storage.objects
  for select using (bucket_id = 'ach-docs' and public.is_admin());

-- Drop-only: managers (and admins) can put a file in, nobody reads it back
-- except admins, and nobody can overwrite or delete it through the API.
drop policy if exists ach_docs_manager_drop on storage.objects;
create policy ach_docs_manager_drop on storage.objects
  for insert with check (bucket_id = 'ach-docs' and public.is_manager());

-- -----------------------------------------------------------------------------
-- 4. Events (append-only audit log)
-- -----------------------------------------------------------------------------
create table if not exists public.ach_authorization_events (
  id                    bigserial primary key,
  authorization_id      uuid references public.ach_authorizations (id) on delete restrict,
  payee_type            text not null check (payee_type in ('employee', 'vendor')),
  employee_id           uuid references public.employees (id) on delete restrict,
  vendor_id             uuid references public.vendors (id) on delete restrict,
  event_kind            text not null check (event_kind ~ '^[a-z][a-z_]{2,48}$'),
  actor_id              uuid references public.staff_profiles (id) on delete set null,
  detail                jsonb not null default '{}'::jsonb,
  occurred_at           timestamptz not null default now()
);

create index if not exists ach_events_auth_idx on public.ach_authorization_events (authorization_id, occurred_at);

create or replace function public.ach_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'ACH_EVENTS_APPEND_ONLY: ach_authorization_events cannot be changed or deleted.';
end $$;

drop trigger if exists trg_ach_events_append_only on public.ach_authorization_events;
create trigger trg_ach_events_append_only
  before update or delete on public.ach_authorization_events
  for each row execute function public.ach_events_append_only();

-- -----------------------------------------------------------------------------
-- 5. Verifications (prenote or test credit), Q3
-- -----------------------------------------------------------------------------
create table if not exists public.ach_verifications (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.ach_authorization_accounts (id) on delete restrict,
  method                text not null check (method in ('prenote', 'micro_entry', 'voided_check_callback')),
  status                text not null default 'planned'
                          check (status in ('planned', 'sent', 'passed', 'failed', 'cancelled')),
  micro_amount_cents    integer check (micro_amount_cents is null or micro_amount_cents between 1 and 99),
  effective_date        date,
  settlement_date       date,
  eligible_on           date,
  result_code           text check (result_code is null or result_code ~ '^[RC][0-9]{2}$'),
  payee_confirmed_cents integer check (payee_confirmed_cents is null or payee_confirmed_cents between 1 and 99),
  note                  text,
  created_by            uuid references public.staff_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ach_ver_micro_amount check ((method = 'micro_entry') = (micro_amount_cents is not null))
);

create index if not exists ach_ver_account_idx on public.ach_verifications (account_id);

drop trigger if exists set_updated_at_ach_verifications on public.ach_verifications;
create trigger set_updated_at_ach_verifications
  before update on public.ach_verifications
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Returns and notifications of change
-- -----------------------------------------------------------------------------
create table if not exists public.ach_return_notices (
  id                    uuid primary key default gen_random_uuid(),
  authorization_id      uuid references public.ach_authorizations (id) on delete restrict,
  account_id            uuid references public.ach_authorization_accounts (id) on delete restrict,
  notice_kind           text not null check (notice_kind in ('return', 'noc')),
  code                  text not null check (code ~ '^[RC][0-9]{2}$'),
  received_on           date not null,
  entry_settlement_date date,
  amount_cents          bigint check (amount_cents is null or amount_cents >= 0),
  trace_number          text check (trace_number is null or trace_number ~ '^[0-9]{15}$'),
  corrected_data_enc    text check (corrected_data_enc is null or corrected_data_enc like 'encv1:%'),
  apply_by              date,
  resolved_at           timestamptz,
  resolved_by           uuid references public.staff_profiles (id) on delete set null,
  resolution_note       text,
  created_by            uuid references public.staff_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint ach_notice_code_matches_kind check (
    (notice_kind = 'return' and code like 'R%') or (notice_kind = 'noc' and code like 'C%')
  ),
  constraint ach_notice_resolved_shape check (
    (resolved_at is null) = (resolved_by is null and resolution_note is null)
  )
);

create index if not exists ach_notice_open_idx on public.ach_return_notices (received_on) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- 7. Payee contacts with on-file dates (Q13 look-back)
-- -----------------------------------------------------------------------------
create table if not exists public.payee_contacts (
  id                    uuid primary key default gen_random_uuid(),
  payee_type            text not null check (payee_type in ('employee', 'vendor')),
  employee_id           uuid references public.employees (id) on delete restrict,
  vendor_id             uuid references public.vendors (id) on delete restrict,
  contact_kind          text not null check (contact_kind in ('phone', 'email')),
  value                 text not null check (length(trim(value)) > 0),
  on_file_since         date not null,
  source                text not null
                          check (source in ('existing_record', 'signed_form', 'in_person', 'onboarding')),
  retired_at            timestamptz,
  created_by            uuid references public.staff_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint payee_contact_payee_matches_type check (
    (payee_type = 'employee' and employee_id is not null and vendor_id is null)
    or (payee_type = 'vendor' and vendor_id is not null and employee_id is null)
  ),
  constraint payee_contact_phone_shape check (contact_kind <> 'phone' or value ~ '^[0-9]{3}-[0-9]{3}-[0-9]{4}$'),
  constraint payee_contact_email_shape check (contact_kind <> 'email' or value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint payee_contact_not_future check (on_file_since <= (created_at at time zone 'America/Los_Angeles')::date)
);

create unique index if not exists payee_contact_live_unique
  on public.payee_contacts (payee_type, coalesce(employee_id, vendor_id), contact_kind, lower(value))
  where retired_at is null;

-- The value and its on-file date can never be rewritten: that is exactly the
-- callback manipulation the look-back exists to defeat. Retire and re-add.
create or replace function public.payee_contacts_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYEE_CONTACT_IMMUTABLE: retire contact % instead of deleting it.', old.id;
  end if;
  if old.retired_at is not null then
    raise exception 'PAYEE_CONTACT_IMMUTABLE: contact % is retired.', old.id;
  end if;
  if new.value is distinct from old.value
     or new.on_file_since is distinct from old.on_file_since
     or new.contact_kind is distinct from old.contact_kind
     or new.payee_type is distinct from old.payee_type
     or new.employee_id is distinct from old.employee_id
     or new.vendor_id is distinct from old.vendor_id then
    raise exception 'PAYEE_CONTACT_IMMUTABLE: retire contact % and add the new value.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_payee_contacts_guard on public.payee_contacts;
create trigger trg_payee_contacts_guard
  before update or delete on public.payee_contacts
  for each row execute function public.payee_contacts_guard();

-- -----------------------------------------------------------------------------
-- 8. Vendor ACH enrollment fields (vendor detail page)
-- -----------------------------------------------------------------------------
alter table public.vendors add column if not exists ach_needs_bank_info boolean not null default false;
alter table public.vendors add column if not exists ach_opted_out boolean not null default false;
alter table public.vendors add column if not exists ach_opted_out_reason text;
alter table public.vendors add column if not exists ach_opted_out_by uuid references public.staff_profiles (id) on delete set null;
alter table public.vendors add column if not exists ach_opted_out_at timestamptz;

alter table public.vendors drop constraint if exists vendors_ach_opt_out_shape;
alter table public.vendors add constraint vendors_ach_opt_out_shape check (
  (ach_opted_out and coalesce(length(trim(ach_opted_out_reason)), 0) > 0 and ach_opted_out_at is not null)
  or (not ach_opted_out and ach_opted_out_at is null)
);
alter table public.vendors drop constraint if exists vendors_ach_flags_exclusive;
alter table public.vendors add constraint vendors_ach_flags_exclusive check (not (ach_opted_out and ach_needs_bank_info));

-- -----------------------------------------------------------------------------
-- 9. vendor_bank_details: admit revoked / archived (Q7)
-- -----------------------------------------------------------------------------
alter table public.vendor_bank_details drop constraint if exists vendor_bank_details_status_check;
alter table public.vendor_bank_details add constraint vendor_bank_details_status_check
  check (status in ('active', 'on_hold', 'revoked', 'archived'));

-- -----------------------------------------------------------------------------
-- 10. RLS: admin-only; managers may only INSERT documents and their events.
-- -----------------------------------------------------------------------------
alter table public.ach_authorizations          enable row level security;
alter table public.ach_authorization_accounts  enable row level security;
alter table public.ach_authorization_documents enable row level security;
alter table public.ach_authorization_events    enable row level security;
alter table public.ach_verifications           enable row level security;
alter table public.ach_return_notices          enable row level security;
alter table public.payee_contacts              enable row level security;

drop policy if exists ach_authorizations_admin on public.ach_authorizations;
create policy ach_authorizations_admin on public.ach_authorizations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ach_accounts_admin on public.ach_authorization_accounts;
create policy ach_accounts_admin on public.ach_authorization_accounts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ach_documents_admin on public.ach_authorization_documents;
create policy ach_documents_admin on public.ach_authorization_documents
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ach_documents_manager_drop on public.ach_authorization_documents;
create policy ach_documents_manager_drop on public.ach_authorization_documents
  for insert with check (
    public.is_manager()
    and intake_status = 'received'
    and authorization_id is null
    and archived_at is null
    and uploaded_by = auth.uid()
  );

drop policy if exists ach_events_admin_read on public.ach_authorization_events;
create policy ach_events_admin_read on public.ach_authorization_events
  for select using (public.is_admin());

drop policy if exists ach_events_insert on public.ach_authorization_events;
create policy ach_events_insert on public.ach_authorization_events
  for insert with check (
    public.is_admin()
    or (public.is_manager() and event_kind = 'document_dropped' and actor_id = auth.uid())
  );

drop policy if exists ach_verifications_admin on public.ach_verifications;
create policy ach_verifications_admin on public.ach_verifications
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ach_return_notices_admin on public.ach_return_notices;
create policy ach_return_notices_admin on public.ach_return_notices
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists payee_contacts_admin on public.payee_contacts;
create policy payee_contacts_admin on public.payee_contacts
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on table public.ach_authorizations          from anon;
revoke all on table public.ach_authorization_accounts  from anon;
revoke all on table public.ach_authorization_documents from anon;
revoke all on table public.ach_authorization_events    from anon;
revoke all on table public.ach_verifications           from anon;
revoke all on table public.ach_return_notices          from anon;
revoke all on table public.payee_contacts              from anon;

comment on table public.ach_authorizations is
  'R39: one ACH credit authorization per payee (employee or vendor). States mirror ach-authorization-core.ts; deletes refused inside the retention window (6y after end and after signing; Nacha 2y, WAC 314-55-087 5y).';
comment on table public.ach_authorization_accounts is
  'R39: up to 3 deposit accounts per authorization (fixed/percent/remainder). encv1 ciphertext only; bank details immutable - archive and add.';
comment on table public.ach_authorization_documents is
  'R39: signed forms, voided checks, bank letters, e-sign certificates in private bucket ach-docs, sha256-pinned. Managers drop-only.';
comment on table public.ach_authorization_events is 'R39: append-only ACH audit log.';
comment on table public.ach_verifications is 'R39: prenote / test credit (micro-entry, 1-99 cents) per account.';
comment on table public.ach_return_notices is 'R39: returns (R..) and notifications of change (C..) received from the ODFI.';
comment on table public.payee_contacts is
  'R39: payee phone/email with the date first on file; immutable values so the callback look-back cannot be reset.';

notify pgrst, 'reload schema';
