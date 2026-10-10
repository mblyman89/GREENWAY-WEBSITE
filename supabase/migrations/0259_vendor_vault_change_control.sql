-- =============================================================================
-- Migration 0259 - R39 S3: vendor banking vault change control
-- =============================================================================
-- Owner request R39 (docs/roadmap/R39-ACH-INTEGRATION.md). 0143 made the vault;
-- 0258 let its status say revoked / archived. This migration makes the
-- database itself enforce the change controls, so they hold even if a future
-- screen, script or SQL editor session forgets them:
--
--   1. New banking, and any change to routing, account number or account
--      type, lands ON HOLD, and the row remembers who entered it and when
--      (ach-fraud-phase-2-change-controls). The app compares DECRYPTED values
--      and only rewrites those columns on a real change, because encv1
--      ciphertext is different on every save (random IV).
--   2. Releasing a hold needs a fresh release record: who released it, how
--      the payee confirmed (phone or in person), and a written note. If the
--      person releasing is the person who entered the change, or nobody knows
--      who entered it, the release is "solo" and needs a written reason of 20+
--      characters. A "dual" release by the same person is refused. Same rule
--      as releaseVerdict() in src/lib/payments/ach-authorization-core.ts.
--   3. Rows are never deleted (owner answer Q7: delete becomes archive). This
--      also stops "on delete cascade" from 0143 erasing banking history if a
--      vendor row were ever deleted.
--   4. Status moves: archived and revoked rows can only come back through ON
--      HOLD (re-enrolment is verified like new banking).
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0258.
-- =============================================================================

alter table public.vendor_bank_details add column if not exists hold_reason text;
alter table public.vendor_bank_details add column if not exists change_entered_by uuid references public.staff_profiles (id) on delete set null;
alter table public.vendor_bank_details add column if not exists change_entered_at timestamptz;
alter table public.vendor_bank_details add column if not exists released_by uuid references public.staff_profiles (id) on delete set null;
alter table public.vendor_bank_details add column if not exists released_at timestamptz;
alter table public.vendor_bank_details add column if not exists release_mode text;
alter table public.vendor_bank_details add column if not exists release_callback_method text;
alter table public.vendor_bank_details add column if not exists release_callback_note text;
alter table public.vendor_bank_details add column if not exists release_reason text;
alter table public.vendor_bank_details add column if not exists archived_at timestamptz;
alter table public.vendor_bank_details add column if not exists archived_by uuid references public.staff_profiles (id) on delete set null;
alter table public.vendor_bank_details add column if not exists archive_reason text;

-- Existing rows: give holds and archives the facts the new checks require.
-- Wording says plainly that the fact was not recorded, rather than inventing one.
update public.vendor_bank_details
   set hold_reason = 'On hold before migration 0259 (no reason was recorded)'
 where status = 'on_hold' and coalesce(length(trim(hold_reason)), 0) = 0;
update public.vendor_bank_details
   set archived_at = coalesce(archived_at, updated_at),
       archive_reason = coalesce(nullif(trim(archive_reason), ''), 'Archived before migration 0259 (no reason was recorded)')
 where status = 'archived' and (archived_at is null or coalesce(length(trim(archive_reason)), 0) = 0);

alter table public.vendor_bank_details drop constraint if exists vbd_release_mode_shape;
alter table public.vendor_bank_details add constraint vbd_release_mode_shape
  check (release_mode is null or release_mode in ('dual', 'solo'));
alter table public.vendor_bank_details drop constraint if exists vbd_release_method_shape;
alter table public.vendor_bank_details add constraint vbd_release_method_shape
  check (release_callback_method is null or release_callback_method in ('phone', 'in_person'));
alter table public.vendor_bank_details drop constraint if exists vbd_hold_has_reason;
alter table public.vendor_bank_details add constraint vbd_hold_has_reason
  check (status <> 'on_hold' or coalesce(length(trim(hold_reason)), 0) > 0);
alter table public.vendor_bank_details drop constraint if exists vbd_archived_shape;
alter table public.vendor_bank_details add constraint vbd_archived_shape
  check (status <> 'archived' or (archived_at is not null and coalesce(length(trim(archive_reason)), 0) > 0));

create or replace function public.vendor_bank_guard()
returns trigger language plpgsql as $$
declare
  bank_changed boolean;
  is_solo boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'VAULT_ARCHIVE_ONLY: vendor banking % is never deleted. Archive it instead.', old.id;
  end if;

  if tg_op = 'INSERT' then
    bank_changed := true;
  else
    bank_changed := new.bank_routing is distinct from old.bank_routing
                 or new.bank_account_number is distinct from old.bank_account_number
                 or new.bank_account_type is distinct from old.bank_account_type;
  end if;

  -- 1. New or changed banking always lands on hold, stamped with its author.
  if bank_changed then
    new.status := 'on_hold';
    new.change_entered_by := coalesce(new.updated_by, new.created_by);
    new.change_entered_at := now();
    if coalesce(length(trim(new.hold_reason)), 0) = 0
       or (tg_op = 'UPDATE' and new.hold_reason is not distinct from old.hold_reason) then
      new.hold_reason := case when tg_op = 'INSERT' then 'New banking added' else 'Bank details changed' end;
    end if;
    new.released_by := null;
    new.released_at := null;
    new.release_mode := null;
    new.release_callback_method := null;
    new.release_callback_note := null;
    new.release_reason := null;
    new.verified_at := null;
    new.verified_note := null;
    return new;
  end if;

  if tg_op = 'INSERT' or new.status is not distinct from old.status then
    return new;
  end if;
  -- Unknown status values fall through to vendor_bank_details_status_check.
  if new.status not in ('active', 'on_hold', 'revoked', 'archived') then
    return new;
  end if;

  -- 4. Archived / revoked come back only through on_hold.
  if old.status = 'archived' and new.status <> 'on_hold' then
    raise exception 'VAULT_TRANSITION: archived banking can only be re-opened on hold (% -> %).', old.status, new.status;
  end if;
  if old.status = 'revoked' and new.status not in ('on_hold', 'archived') then
    raise exception 'VAULT_TRANSITION: revoked banking can only be re-opened on hold or archived (% -> %).', old.status, new.status;
  end if;

  -- 2. Going active needs a fresh, complete release record.
  if new.status = 'active' then
    if new.released_by is null or new.released_at is null
       or (old.released_at is not null and new.released_at <= old.released_at) then
      raise exception 'VAULT_RELEASE: record who released the hold and when.';
    end if;
    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 10 then
      raise exception 'VAULT_RELEASE: record how the payee confirmed the details (phone or in person) and a note of 10+ characters.';
    end if;
    is_solo := new.change_entered_by is null or new.change_entered_by = new.released_by;
    if is_solo and new.release_mode is distinct from 'solo' then
      raise exception 'VAULT_RELEASE: the person who entered the change (or an unknown author) releasing it is a SOLO release.';
    end if;
    if not is_solo and new.release_mode is distinct from 'dual' then
      raise exception 'VAULT_RELEASE: a release by a different person is a DUAL release.';
    end if;
    if is_solo and coalesce(length(trim(new.release_reason)), 0) < 20 then
      raise exception 'VAULT_RELEASE: a solo release needs a written reason of 20+ characters.';
    end if;
  end if;

  if new.status = 'on_hold' and new.hold_reason is not distinct from old.hold_reason then
    raise exception 'VAULT_HOLD: putting banking on hold needs a new reason.';
  end if;

  if new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_vendor_bank_guard on public.vendor_bank_details;
create trigger trg_vendor_bank_guard
  before insert or update or delete on public.vendor_bank_details
  for each row execute function public.vendor_bank_guard();

comment on function public.vendor_bank_guard() is
  'R39 0259: vendor vault change control. New/changed banking -> on_hold with author; release needs callback method + note, solo needs 20+ char reason, dual must be a different person; no deletes (archive); archived/revoked re-open only on hold. Mirrors releaseVerdict() in ach-authorization-core.ts.';

notify pgrst, 'reload schema';
