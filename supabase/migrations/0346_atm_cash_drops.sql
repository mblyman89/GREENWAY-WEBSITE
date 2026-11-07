-- supabase/migrations/0346_atm_cash_drops.sql  (D198 S1 - ATM cash drops from the tills)
--
-- Owner request (verbatim, D198): "the employees put the money directly into the atm after removing
-- it from their till. anyone can do a refill. the ipad should only accept whole 20 dollar amounts. i
-- want the number of 20s taken from the till to be entered on the register. ... the atm drops count
-- toward the 2k drop. any register can do an atm drop. ... i definitely want the plaid atm bank
-- account connection to be reconciled against the atm drops from the tills. ... it is a lot of money
-- and is easy to steal. so matching is essential."
--
-- A drop now says WHERE the cash went:
--   1. drawer_drops.destination   'safe' (every drop before this file, and the default) | 'atm'.
--   2. drawer_drops.twenties_count the number of $20 bills taken from the till for an ATM drop. The
--      ATM holds $20s only, so an ATM drop's amount_minor is ALWAYS twenties_count x 2000 (a CHECK,
--      not a hope). A safe drop never carries a twenties count.
--   3. drawer_drops.atm_terminal_id the ATM the cash went into (e.g. HG26499), for matching against
--      the PAI cash-load report (atm_cash_loads.terminal_id).
--   4. drawer_drops.device_id / recorded_via  which iPad and which path (register / offline replay /
--      back office) recorded it. Before this the device lived in the audit log only.
--   5. Trigger drawer_drops_money_immutable: once written, a drop's session, amount, destination,
--      twenties count, terminal and time can never change. A mistake is explained by the owner on
--      /admin/atm/drops (atm_drop_reviews), never by editing the money. notes / witnessed_by /
--      dropped_by stay writable (an employee deletion sets dropped_by to NULL through the FK).
--   6. atm_drop_reviews: the owner's append-only sign-off on the ATM drop match (accepted /
--      explained / investigating / escalated / linked). The newest row for a subject wins; nothing is
--      ever updated or deleted, so the history of who signed off on what is permanent. No foreign key
--      on purpose: the factory reset empties drawer_drops and atm_cash_loads (0240's pinned list) and
--      refuses if a KEPT table points into them; a review whose drop is gone is simply ignored.
--
-- Factory reset: drawer_drops is WIPE (0240, truncate - no row trigger fires). atm_drop_reviews is
-- KEEP (owner sign-off history; the pinned 0240 list is not reopened).
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied the registers keep working: an ATM drop is saved as a plain drop with the
-- destination and the $20 count in its notes and in the audit log, and the owner page says
-- "run migration 0346".

alter table public.drawer_drops add column if not exists destination text not null default 'safe';
alter table public.drawer_drops add column if not exists twenties_count integer;
alter table public.drawer_drops add column if not exists atm_terminal_id text;
alter table public.drawer_drops add column if not exists device_id text;
alter table public.drawer_drops add column if not exists recorded_via text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_destination_known') then
    alter table public.drawer_drops
      add constraint drawer_drops_destination_known
      check (destination in ('safe', 'atm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_atm_twenties') then
    alter table public.drawer_drops
      add constraint drawer_drops_atm_twenties
      check (
        (destination = 'safe' and twenties_count is null)
        or (destination = 'atm'
            and twenties_count is not null
            and twenties_count between 1 and 2500
            and amount_minor = twenties_count * 2000)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_atm_terminal_shape') then
    alter table public.drawer_drops
      add constraint drawer_drops_atm_terminal_shape
      check (atm_terminal_id is null or (destination = 'atm' and char_length(atm_terminal_id) between 1 and 64));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_device_id_len') then
    alter table public.drawer_drops
      add constraint drawer_drops_device_id_len
      check (device_id is null or char_length(device_id) between 1 and 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_recorded_via_known') then
    alter table public.drawer_drops
      add constraint drawer_drops_recorded_via_known
      check (recorded_via is null or recorded_via in ('register', 'offline', 'back_office'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_amount_positive') then
    alter table public.drawer_drops
      add constraint drawer_drops_amount_positive
      check (amount_minor > 0) not valid;
  end if;
end
$$;

comment on column public.drawer_drops.destination is
  'D198 (0346): where the dropped cash went: safe (the store safe, every drop before 0346) or atm (loaded straight into the ATM). Both count toward the $2,000 drop-due figure; only safe drops are in the deposit / EOD.';
comment on column public.drawer_drops.twenties_count is
  'D198 (0346): number of $20 bills taken from the till for an ATM drop. amount_minor = twenties_count x 2000 always (CHECK drawer_drops_atm_twenties). NULL for a safe drop.';
comment on column public.drawer_drops.atm_terminal_id is
  'D198 (0346): the ATM terminal the cash was loaded into (matches atm_cash_loads.terminal_id). ATM drops only.';
comment on column public.drawer_drops.device_id is
  'D198 (0346): the register device (iPad) that recorded the drop. NULL for drops recorded before 0346.';
comment on column public.drawer_drops.recorded_via is
  'D198 (0346): register (iPad online), offline (replayed from the iPad offline queue) or back_office. NULL before 0346.';

create index if not exists drawer_drops_atm_dropped_at_idx
  on public.drawer_drops (dropped_at desc)
  where destination = 'atm';

-- 5. The money on a drop is write-once.
create or replace function public.drawer_drops_money_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.session_id is distinct from old.session_id
     or new.amount_minor is distinct from old.amount_minor
     or new.destination is distinct from old.destination
     or new.twenties_count is distinct from old.twenties_count
     or new.atm_terminal_id is distinct from old.atm_terminal_id
     or new.dropped_at is distinct from old.dropped_at then
    raise exception 'DROP_MONEY_IMMUTABLE: a cash drop''s drawer, amount, destination, $20 count, terminal and time are never changed (D198). Explain a mistake on /admin/atm/drops instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists drawer_drops_money_immutable on public.drawer_drops;
create trigger drawer_drops_money_immutable
  before update on public.drawer_drops
  for each row execute function public.drawer_drops_money_immutable();

revoke all on function public.drawer_drops_money_immutable() from public, anon, authenticated;

-- 6. The owner's append-only sign-off.
create table if not exists public.atm_drop_reviews (
  id                uuid primary key default gen_random_uuid(),
  subject_kind      text not null check (subject_kind in ('drop', 'load', 'day')),
  subject_id        text not null check (char_length(subject_id) between 1 and 64),
  decision          text not null check (decision in ('accepted', 'explained', 'investigating', 'escalated', 'linked')),
  link_load_id      uuid null,
  note              text not null check (char_length(btrim(note)) between 3 and 2000),
  signal_codes      text[] not null default '{}' check (cardinality(signal_codes) <= 40),
  reviewed_by       uuid null,
  reviewed_by_email text null check (reviewed_by_email is null or char_length(reviewed_by_email) <= 320),
  reviewed_at       timestamptz not null default now(),
  constraint atm_drop_reviews_link_shape check (
    (decision = 'linked' and subject_kind = 'drop' and link_load_id is not null)
    or (decision <> 'linked' and link_load_id is null)
  )
);

comment on table public.atm_drop_reviews is
  'D198 (0346): the owner''s append-only sign-off on the ATM drop match (/admin/atm/drops). Newest row per (subject_kind, subject_id) wins; never updated or deleted. No FK on purpose (factory reset). KEPT by the reset.';

create index if not exists atm_drop_reviews_subject_idx
  on public.atm_drop_reviews (subject_kind, subject_id, reviewed_at desc);

alter table public.atm_drop_reviews enable row level security;
revoke all on table public.atm_drop_reviews from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.atm_drop_reviews from service_role;
grant select, insert on table public.atm_drop_reviews to service_role;

notify pgrst, 'reload schema';
