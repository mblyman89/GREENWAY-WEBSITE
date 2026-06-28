-- =============================================================================
-- Slice 8 — Loyalty management
-- =============================================================================
-- Table: loyalty_signups
--
-- Database-backed replacement for storage/loyalty-signups.jsonl. Captures every
-- loyalty sign-up from the public form (name, birthday, phone, email, consent,
-- typed signature, source, notification status) and adds a staff QUEUE on top:
--   - status: new -> entered (added to POS) / duplicate / archived
--   - entered_by / entered_at: who added it to the POS and when
--   - staff_note: internal note
-- Dedupe is detected in app code by matching email or normalized phone against
-- existing rows; the matched id is stored in dedupe_of for an audit trail.
--
-- NO online payment. Private customer PII — staff-only read; public insert only.
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles.
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

-- Queue lifecycle for a loyalty sign-up.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'loyalty_status') then
    create type public.loyalty_status as enum (
      'new',        -- just submitted, awaiting staff action
      'entered',    -- added to the POS loyalty system
      'duplicate',  -- matched an existing customer; not re-entered
      'archived'    -- dismissed / no action needed
    );
  end if;
end$$;

-- Notification status mirrored from the existing JSONL record.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'loyalty_notify_status') then
    create type public.loyalty_notify_status as enum (
      'email-not-configured',
      'email-sent',
      'email-failed'
    );
  end if;
end$$;

create table if not exists public.loyalty_signups (
  id                  uuid primary key default gen_random_uuid(),
  -- Original JSONL id (text) when migrated, so re-imports are idempotent.
  legacy_id           text unique,
  status              public.loyalty_status not null default 'new',
  first_name          text not null,
  last_name           text not null,
  birthday            text,                                   -- yyyy-mm-dd as captured
  mobile_phone        text,
  -- Digits-only normalized phone for dedupe + search.
  phone_normalized    text,
  email               text,
  consent             boolean not null default false,
  signature           text,
  source              text not null default 'greenway-website',
  notification_status public.loyalty_notify_status not null default 'email-not-configured',
  -- Dedupe: when this row matched an existing signup, point at it for the trail.
  dedupe_of           uuid references public.loyalty_signups(id) on delete set null,
  staff_note          text,
  entered_by          uuid references public.staff_profiles(id) on delete set null,
  entered_at          timestamptz,
  submitted_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists loyalty_signups_status_idx       on public.loyalty_signups (status);
create index if not exists loyalty_signups_submitted_idx     on public.loyalty_signups (submitted_at desc);
create index if not exists loyalty_signups_email_idx          on public.loyalty_signups (lower(email));
create index if not exists loyalty_signups_phone_idx          on public.loyalty_signups (phone_normalized);

drop trigger if exists loyalty_signups_set_updated_at on public.loyalty_signups;
create trigger loyalty_signups_set_updated_at
  before update on public.loyalty_signups
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.loyalty_signups enable row level security;

-- staff read/write all; PUBLIC (anon) may INSERT a brand-new signup only.
drop policy if exists loyalty_signups_staff_all on public.loyalty_signups;
create policy loyalty_signups_staff_all on public.loyalty_signups
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists loyalty_signups_public_insert on public.loyalty_signups;
create policy loyalty_signups_public_insert on public.loyalty_signups
  for insert with check (status = 'new');
