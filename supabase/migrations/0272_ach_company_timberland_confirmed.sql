-- 0272_ach_company_timberland_confirmed.sql  (R41 S2)
--
-- WHAT THIS ADDS
--   The "Timberland confirmed on ___" stamp on the company ACH settings
--   (plan R41 v4, slice S2): four add-only columns on the singleton
--   public.ach_company_settings, and one BEFORE UPDATE trigger that clears the
--   stamp the moment a value Timberland matches against changes.
--
-- WHY
--   Brenda (Timberland Cash Management) wrote: "There are 3 parameters I need
--   to have match my side. Company Name / Company ID / Make sure that it's an
--   unbalanced batch" (docs/authorities/ach/timberland-brenda-2026-10.txt).
--   The app now refuses any file whose originator does not match her answers
--   (timberland-originator-core.ts). The stamp records that a person checked
--   the stored values WITH Timberland, who, when and how; a stale stamp would
--   claim a check that never covered the current values, so any change to a
--   matched field clears it and records when.
--
-- MATCHED FIELDS (a change to any of these clears the stamp)
--   destination_routing, immediate_origin, company_name, company_id,
--   originating_dfi. The funding account number is NOT one: it is stored
--   envelope-encrypted with a random IV, so its ciphertext changes on every
--   save even when the number does not (S-10), and it is not written in the
--   file. Its last four are checked by originatorReadiness() instead.
--
-- WHO MAY STAMP
--   Only the owner. 0271's ach_company_settings_owner_guard already refuses
--   any change to this row (every column except updated_at/updated_by) unless
--   updated_by is the active owner, so these new columns are owner-only with
--   no new policy. This file adds: the stamp must name the same person as
--   updated_by, carry a note of at least 10 characters, and not be in the
--   future.
--
-- SAFE TO RE-RUN: add column if not exists, drop constraint if exists,
-- create or replace function, drop trigger if exists. Nothing is deleted.
-- Rollback: supabase/rollbacks/0272_ach_company_timberland_confirmed.rollback.sql
-- Scenario check: scripts/recon/ach-timberland-confirm-0272-pg-check.sql

do $$
begin
  if to_regclass('public.ach_company_settings') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0272 adds columns to ach_company_settings (0057). Run 0057 first. Nothing was changed.';
  end if;
  if to_regprocedure('public.ach_company_settings_owner_guard()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0272 relies on the 0271 owner guard for who may stamp. Run 0271_ach_owner_authority.sql first. Nothing was changed.';
  end if;
end $$;

alter table public.ach_company_settings
  add column if not exists timberland_confirmed_at       timestamptz,
  add column if not exists timberland_confirmed_by       uuid references public.staff_profiles(id) on delete set null,
  add column if not exists timberland_confirm_note       text,
  add column if not exists timberland_confirm_cleared_at timestamptz;

alter table public.ach_company_settings drop constraint if exists ach_timberland_stamp_shape;
alter table public.ach_company_settings add constraint ach_timberland_stamp_shape check (
  (timberland_confirmed_at is null and timberland_confirm_note is null)
  or (timberland_confirmed_at is not null
      and timberland_confirm_note is not null
      and length(btrim(timberland_confirm_note)) between 10 and 500)
);

comment on column public.ach_company_settings.timberland_confirmed_at is
  'R41 S2 (0272): when the owner recorded that Timberland confirmed the matched fields. Cleared by trg_ach_company_settings_timberland_stamp when a matched field changes.';
comment on column public.ach_company_settings.timberland_confirmed_by is
  'R41 S2 (0272): who recorded the confirmation (must equal updated_by on the stamping write: the owner, per the 0271 guard).';
comment on column public.ach_company_settings.timberland_confirm_note is
  'R41 S2 (0272): who at Timberland confirmed and how, 10-500 characters, e.g. "Brenda, email of 10/16".';
comment on column public.ach_company_settings.timberland_confirm_cleared_at is
  'R41 S2 (0272): when a matched-field change last cleared a confirmation (null if never cleared).';

create or replace function public.ach_company_timberland_stamp()
returns trigger language plpgsql as $$
begin
  -- 1. A matched field changed: the old confirmation no longer covers the row.
  if new.destination_routing is distinct from old.destination_routing
     or new.immediate_origin is distinct from old.immediate_origin
     or new.company_name is distinct from old.company_name
     or new.company_id is distinct from old.company_id
     or new.originating_dfi is distinct from old.originating_dfi then
    if old.timberland_confirmed_at is not null or new.timberland_confirmed_at is not null then
      new.timberland_confirm_cleared_at := now();
    end if;
    new.timberland_confirmed_at := null;
    new.timberland_confirmed_by := null;
    new.timberland_confirm_note := null;
    return new;
  end if;
  -- 2. A new or changed stamp must be the stamping person's own, and now.
  if new.timberland_confirmed_at is not null
     and (new.timberland_confirmed_at is distinct from old.timberland_confirmed_at
          or new.timberland_confirmed_by is distinct from old.timberland_confirmed_by
          or new.timberland_confirm_note is distinct from old.timberland_confirm_note) then
    if new.timberland_confirmed_by is null or new.timberland_confirmed_by is distinct from new.updated_by then
      raise exception 'TIMBERLAND_STAMP_SELF: the confirmation must name the person saving it (timberland_confirmed_by = updated_by).';
    end if;
    if new.timberland_confirmed_at > now() + interval '5 minutes' then
      raise exception 'TIMBERLAND_STAMP_FUTURE: a confirmation cannot be dated in the future.';
    end if;
  end if;
  return new;
end $$;

comment on function public.ach_company_timberland_stamp() is
  'R41 S2 (0272): clears the Timberland confirmation when destination_routing, immediate_origin, company_name, company_id or originating_dfi change; a new stamp must name updated_by and not be future-dated.';

drop trigger if exists trg_ach_company_settings_timberland_stamp on public.ach_company_settings;
create trigger trg_ach_company_settings_timberland_stamp
  before update on public.ach_company_settings
  for each row execute function public.ach_company_timberland_stamp();
