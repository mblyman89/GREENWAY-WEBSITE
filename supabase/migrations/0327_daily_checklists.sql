-- 0327_daily_checklists.sql  (Fix Phase 4.4b · G-38 · F-06-12 · owner D57, D51)
--
-- WHY. The owner, verbatim:
--   SOP-06 catalog  "Checklists for daily tasks like cycle counts I initiate via
--                    the inventory audit feature."
--   D51             "the cycle counts and daily checklists are for all employees,
--                    admin, manger, sales."
--   D57             "Tasks should include cleaning, organizing, stocking,
--                    marketing content like website banners, flyers, newsletters,
--                    blog posts, social media posts, in store content, yard
--                    banners, inventory management like product enrichment,
--                    making sure products get heavily discounted before expiring.
--                    Plus any other small retail business daily duties that you
--                    think ought to be included as well."
-- The app had no checklist feature (F-06-12, F-00-9); the store used paper forms
-- 8.5-8.8 of SOP-06. This file is the record the new Daily Checklists screen
-- writes. Gap G-38 requirements (05-GAP-REGISTER.md): opening / mid-shift /
-- closing / weekly / monthly lists seeded from forms 8.5-8.8, owner-editable,
-- each task linked to its SOP, initials and time per task, a live "counts
-- waiting on Cycle Counts" line, manager sign-off, history kept five years
-- (WAC 314-55-087), visible to inventory.count roles.
--
-- WHAT.
--   checklist_tasks  the catalog. One row per line on a form. kind = opening |
--                    during | closing | weekly | monthly | yearly. The owner can
--                    change the wording, section, SOP reference and order, add a
--                    task, or retire one (active = false). A task is never
--                    deleted, so old runs still name it. seed_key marks the
--                    rows seeded from SOP-06 forms 8.5-8.8 (re-running this file
--                    never overwrites an owner edit: insert ... on conflict do
--                    nothing).
--   checklist_runs   one sheet: one kind for one period (a Pacific business day
--                    for opening / during / closing, the Monday of the week for
--                    weekly, the first of the month for monthly, 1 January for
--                    yearly). Created by the first initialled task. Signed off
--                    once by a manager (owner, admin or manager), with a note
--                    when any task was left undone.
--   checklist_ticks  one initialled task on one sheet: who (sign-in), their
--                    initials, the time, an optional note, and a copy of the
--                    task's wording at that moment (so an owner edit later does
--                    not rewrite history). One tick per task per sheet.
--
-- GUARDS (triggers). Tasks: no DELETE; seed_key and kind fixed. Runs: no DELETE;
-- kind, period, opened_* fixed; the sign-off is filled once and never changed.
-- Ticks: no UPDATE, no DELETE (a paper initial is not erased either); no new
-- tick on a signed-off sheet. The factory reset hatch (gl_factory_reset_active(),
-- 0209) is let through, as in 0318.
--
-- FACTORY RESET. All three tables are KEEP (factory-reset-core.ts): a five-year
-- store record (WAC 314-55-087), and the pinned 139-table WIPE list is not
-- reopened. Their only links are to staff_profiles (KEEP) and to each other.
--
-- SAFE / IDEMPOTENT: create ... if not exists; constraints and policies dropped
-- and re-made by name; create or replace for the functions; seed with
-- on conflict do nothing. Row level security: every active staff sign-in reads
-- (public.is_staff()); no write policy, so every write goes through the server,
-- which checks the permission (inventory.count to initial a daily task,
-- inventory.manage for the weekly / monthly / year-end tasks and the sign-off,
-- inventory.audit = owner to edit the catalog) and records an audit_logs row.
-- Apply MANUALLY in the Supabase SQL editor after 0326. Before it is applied the
-- Daily Checklists screen says the migration is pending and saves nothing; use
-- paper forms 8.5-8.8 (SOP-06 §4.23).

do $precheck$
begin
  if to_regclass('public.staff_profiles') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0327 depends on staff_profiles';
  end if;
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0327 depends on is_staff() from 0001_slice1_foundation.sql';
  end if;
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0327 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
  if to_regprocedure('public.inventory_audit_claim(uuid)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: apply 0326_audit_count_integrity.sql before 0327';
  end if;
end
$precheck$;

-- ── The catalog ────────────────────────────────────────────────────────────
create table if not exists public.checklist_tasks (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  section     text not null default 'GENERAL',
  label       text not null,
  sop_ref     text,
  sort_order  integer not null default 0,
  -- 'cycle_counts': the screen shows the live Cycle Counts queue on this line.
  live_line   text,
  active      boolean not null default true,
  seed_key    text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff_profiles(id) on delete set null,
  updated_at  timestamptz,
  updated_by  uuid references public.staff_profiles(id) on delete set null
);

alter table public.checklist_tasks drop constraint if exists checklist_tasks_kind_ck;
alter table public.checklist_tasks add constraint checklist_tasks_kind_ck
  check (kind in ('opening','during','closing','weekly','monthly','yearly'));
alter table public.checklist_tasks drop constraint if exists checklist_tasks_label_len;
alter table public.checklist_tasks add constraint checklist_tasks_label_len
  check (length(btrim(label)) between 1 and 300);
alter table public.checklist_tasks drop constraint if exists checklist_tasks_section_len;
alter table public.checklist_tasks add constraint checklist_tasks_section_len
  check (length(btrim(section)) between 1 and 80);
alter table public.checklist_tasks drop constraint if exists checklist_tasks_ref_len;
alter table public.checklist_tasks add constraint checklist_tasks_ref_len
  check (sop_ref is null or length(sop_ref) <= 200);
alter table public.checklist_tasks drop constraint if exists checklist_tasks_live_ck;
alter table public.checklist_tasks add constraint checklist_tasks_live_ck
  check (live_line is null or live_line in ('cycle_counts'));

create unique index if not exists checklist_tasks_seed_key_uq
  on public.checklist_tasks (seed_key) where seed_key is not null;
create index if not exists checklist_tasks_kind_idx
  on public.checklist_tasks (kind, sort_order);

-- ── One sheet per kind per period ──────────────────────────────────────────
create table if not exists public.checklist_runs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  period_key      date not null,
  opened_at       timestamptz not null default now(),
  opened_by       uuid references public.staff_profiles(id) on delete set null,
  signed_off_at   timestamptz,
  signed_off_by   uuid references public.staff_profiles(id) on delete set null,
  signed_off_name text,
  signoff_note    text,
  open_tasks_at_signoff integer
);

alter table public.checklist_runs drop constraint if exists checklist_runs_kind_ck;
alter table public.checklist_runs add constraint checklist_runs_kind_ck
  check (kind in ('opening','during','closing','weekly','monthly','yearly'));
alter table public.checklist_runs drop constraint if exists checklist_runs_signoff_whole;
alter table public.checklist_runs add constraint checklist_runs_signoff_whole
  check (
    (signed_off_at is null and signed_off_by is null and signed_off_name is null
       and signoff_note is null and open_tasks_at_signoff is null)
    or (signed_off_at is not null and signed_off_name is not null
       and open_tasks_at_signoff is not null and open_tasks_at_signoff >= 0)
  );
-- Tasks left undone need a written reason at sign-off.
alter table public.checklist_runs drop constraint if exists checklist_runs_open_needs_note;
alter table public.checklist_runs add constraint checklist_runs_open_needs_note
  check (signed_off_at is null or open_tasks_at_signoff = 0
         or (signoff_note is not null and length(btrim(signoff_note)) >= 3));
alter table public.checklist_runs drop constraint if exists checklist_runs_note_len;
alter table public.checklist_runs add constraint checklist_runs_note_len
  check (signoff_note is null or length(signoff_note) <= 1000);

create unique index if not exists checklist_runs_kind_period_uq
  on public.checklist_runs (kind, period_key);
create index if not exists checklist_runs_period_idx
  on public.checklist_runs (period_key desc);

-- ── One initialled task on one sheet ───────────────────────────────────────
create table if not exists public.checklist_ticks (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.checklist_runs(id) on delete restrict,
  task_id       uuid not null references public.checklist_tasks(id) on delete restrict,
  -- The task as it read when it was initialled.
  task_label    text not null,
  task_section  text not null,
  task_sop_ref  text,
  done_by       uuid references public.staff_profiles(id) on delete set null,
  done_by_name  text not null,
  initials      text not null,
  done_at       timestamptz not null default now(),
  note          text
);

alter table public.checklist_ticks drop constraint if exists checklist_ticks_initials_ck;
alter table public.checklist_ticks add constraint checklist_ticks_initials_ck
  check (initials ~ '^[A-Z]{1,4}$');
alter table public.checklist_ticks drop constraint if exists checklist_ticks_note_len;
alter table public.checklist_ticks add constraint checklist_ticks_note_len
  check (note is null or length(note) <= 500);

create unique index if not exists checklist_ticks_run_task_uq
  on public.checklist_ticks (run_id, task_id);

-- ── Guards ────────────────────────────────────────────────────────────────
create or replace function public.checklist_tasks_guard()
returns trigger
language plpgsql
as $$
begin
  if public.gl_factory_reset_active() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'CHECKLIST_TASK_PERMANENT: checklist task % cannot be deleted. Retire it instead (untick Active); old sheets still name it.', old.id;
  end if;
  if new.kind is distinct from old.kind or new.seed_key is distinct from old.seed_key
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'CHECKLIST_TASK_FIXED: checklist task % keeps its list and origin. Add a new task on the other list instead.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_checklist_tasks_guard on public.checklist_tasks;
create trigger trg_checklist_tasks_guard
  before update or delete on public.checklist_tasks
  for each row execute function public.checklist_tasks_guard();

create or replace function public.checklist_runs_guard()
returns trigger
language plpgsql
as $$
begin
  if public.gl_factory_reset_active() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'CHECKLIST_RUN_PERMANENT: checklist sheet % cannot be deleted. Checklists are kept five years (WAC 314-55-087).', old.id;
  end if;
  if new.kind is distinct from old.kind or new.period_key is distinct from old.period_key
     or new.opened_at is distinct from old.opened_at or new.opened_by is distinct from old.opened_by then
    raise exception 'CHECKLIST_RUN_FIXED: checklist sheet % keeps its list, date and opener.', old.id;
  end if;
  if old.signed_off_at is not null and (
       new.signed_off_at is distinct from old.signed_off_at
       or new.signed_off_by is distinct from old.signed_off_by
       or new.signed_off_name is distinct from old.signed_off_name
       or new.signoff_note is distinct from old.signoff_note
       or new.open_tasks_at_signoff is distinct from old.open_tasks_at_signoff) then
    raise exception 'CHECKLIST_SIGNED_OFF: checklist sheet % is already signed off. The sign-off cannot be changed.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_checklist_runs_guard on public.checklist_runs;
create trigger trg_checklist_runs_guard
  before update or delete on public.checklist_runs
  for each row execute function public.checklist_runs_guard();

create or replace function public.checklist_ticks_guard()
returns trigger
language plpgsql
as $$
declare
  v_signed timestamptz;
  v_run_kind text;
  v_task_kind text;
begin
  if public.gl_factory_reset_active() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'CHECKLIST_TICK_PERMANENT: an initialled task cannot be removed. Write what happened in the sign-off note.';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'CHECKLIST_TICK_PERMANENT: an initialled task cannot be changed. Write what happened in the sign-off note.';
  end if;
  select signed_off_at, kind into v_signed, v_run_kind from public.checklist_runs where id = new.run_id;
  if v_signed is not null then
    raise exception 'CHECKLIST_SIGNED_OFF: this sheet was signed off at %. Nothing more can be initialled on it.', v_signed;
  end if;
  select kind into v_task_kind from public.checklist_tasks where id = new.task_id;
  if v_task_kind is distinct from v_run_kind then
    raise exception 'CHECKLIST_WRONG_LIST: that task belongs to the % list, not the % list.', v_task_kind, v_run_kind;
  end if;
  return new;
end $$;

drop trigger if exists trg_checklist_ticks_guard on public.checklist_ticks;
create trigger trg_checklist_ticks_guard
  before insert or update or delete on public.checklist_ticks
  for each row execute function public.checklist_ticks_guard();

-- ── Row level security: staff read; writes only through the server ─────────
alter table public.checklist_tasks enable row level security;
alter table public.checklist_runs  enable row level security;
alter table public.checklist_ticks enable row level security;

drop policy if exists checklist_tasks_staff_read on public.checklist_tasks;
create policy checklist_tasks_staff_read on public.checklist_tasks
  for select using (public.is_staff());
drop policy if exists checklist_runs_staff_read on public.checklist_runs;
create policy checklist_runs_staff_read on public.checklist_runs
  for select using (public.is_staff());
drop policy if exists checklist_ticks_staff_read on public.checklist_ticks;
create policy checklist_ticks_staff_read on public.checklist_ticks
  for select using (public.is_staff());

comment on table public.checklist_tasks is
  '0327 (G-38, owner D57): the daily / weekly / monthly / year-end checklist catalog, seeded from SOP-06 forms 8.5-8.8. Owner-editable; retired, never deleted. KEEP in the factory reset.';
comment on table public.checklist_runs is
  '0327 (G-38): one checklist sheet (kind + period). Signed off once by a manager; a note is required when tasks were left undone. Kept five years (WAC 314-55-087); no delete. KEEP.';
comment on table public.checklist_ticks is
  '0327 (G-38): one initialled task (initials, time, who, the task wording at that moment). Append-only; none after sign-off. KEEP.';

-- ── Seed: SOP-06 forms 8.5 (opening), 8.6 (during), 8.7 (closing), 8.8 ─────
-- Generated line by line from the forms. sop_ref is the form line's own
-- source note (an SOP section, a screen, or "owner-directed D57").
insert into public.checklist_tasks (seed_key, kind, section, label, sop_ref, sort_order, live_line)
values
  ('sop06-8.5-01', 'opening', 'SECURITY & SAFETY', 'Alarm disarmed; doors, back door and safe checked', 'owner-directed D57; SOP-20', 10, null),
  ('sop06-8.5-02', 'opening', 'SECURITY & SAFETY', 'Cameras recording, every view live, date/time right', 'owner-directed D57; WAC 314-55-083', 20, null),
  ('sop06-8.5-03', 'opening', 'SECURITY & SAFETY', 'Safety walk: exits clear, no trip hazards, first-aid kit stocked', 'owner-directed D57', 30, null),
  ('sop06-8.5-04', 'opening', 'CASH & REGISTERS', 'SOP-01 form 8.1 shift-open checklist done (each register)', null, 40, null),
  ('sop06-8.5-05', 'opening', 'CASH & REGISTERS', 'SOP-02 AM master till count done', null, 50, null),
  ('sop06-8.5-06', 'opening', 'CASH & REGISTERS', 'SOP-03 §4.10-4.12 morning bag recount and log (manager)', null, 60, null),
  ('sop06-8.5-07', 'opening', 'CASH & REGISTERS', 'ID scanner, label printer, card terminal, scales powered and tested', 'SOP-17', 70, null),
  ('sop06-8.5-08', 'opening', 'INVENTORY', 'SOP-05a §4.4 Inventory -> Issues worked, form 8.3 (manager)', null, 80, null),
  ('sop06-8.5-09', 'opening', 'INVENTORY', 'Expired lots checked; expired edibles/liquids/tinctures/capsules/RSO pulled', 'SOP-05a §4.16', 90, null),
  ('sop06-8.5-10', 'opening', 'INVENTORY', 'Expiring-within-30-days list read; units fronted; list given to owner for markdown', '§4.23', 100, null),
  ('sop06-8.5-11', 'opening', 'INVENTORY', 'Cycle Counts page checked; today''s count claimed and done, or handed over', null, 110, 'cycle_counts'),
  ('sop06-8.5-12', 'opening', 'INVENTORY', 'Anyone counting today knows the rule: count each lot in one go', '§4.11', 120, null),
  ('sop06-8.5-13', 'opening', 'SALES FLOOR (cleaning, organizing, stocking)', 'Display cases and counters wiped, glass cleaned', 'owner-directed D57; SOP-07', 130, null),
  ('sop06-8.5-14', 'opening', 'SALES FLOOR (cleaning, organizing, stocking)', 'Shelves faced and stocked from back stock; gaps filled or 86''d', 'SOP-05a §4.12', 140, null),
  ('sop06-8.5-15', 'opening', 'SALES FLOOR (cleaning, organizing, stocking)', 'Menu boards / screens match the register; price tags correct', 'SOP-05b', 150, null),
  ('sop06-8.5-16', 'opening', 'SALES FLOOR (cleaning, organizing, stocking)', 'Required warning and age signs posted and visible; no product visible from outside', 'owner-directed D57', 160, null),
  ('sop06-8.5-17', 'opening', 'SALES FLOOR (cleaning, organizing, stocking)', 'Restroom and entry clean and stocked', 'owner-directed D57; SOP-07', 170, null),
  ('sop06-8.5-18', 'opening', 'SALES FLOOR (cleaning, organizing, stocking)', 'Lights, music, OPEN sign on at opening time', null, 180, null),
  ('sop06-8.5-19', 'opening', 'ORDERS', 'Online Orders checked; pickups for today pulled and bagged', 'Online Orders; SOP-13', 190, null),
  ('sop06-8.6-01', 'during', 'GENERAL', 'Cycle Counts page checked at mid-shift', null, 10, 'cycle_counts'),
  ('sop06-8.6-02', 'during', 'GENERAL', 'Any product on "Stock needing recount" told to the manager', '§4.21', 20, null),
  ('sop06-8.6-03', 'during', 'GENERAL', 'No package sold from a lot while that lot is being counted', '§4.11', 30, null),
  ('sop06-8.6-04', 'during', 'GENERAL', 'Online Orders checked (every hour)', null, 40, null),
  ('sop06-8.6-05', 'during', 'GENERAL', 'Shelves re-faced and restocked after the lunch rush', null, 50, null),
  ('sop06-8.6-06', 'during', 'GENERAL', 'Counters, scale and door handles wiped', 'owner-directed D57; SOP-07', 60, null),
  ('sop06-8.6-07', 'during', 'GENERAL', 'Trash and recycling emptied if over half full', 'owner-directed D57', 70, null),
  ('sop06-8.6-08', 'during', 'GENERAL', 'Cash drops made per SOP-01 when a drawer is over its limit', null, 80, null),
  ('sop06-8.6-09', 'during', 'MARKETING (one block per day; the owner assigns which)', 'Social media post published', 'Marketing & Advertising / Creative Studio; SOP-11', 90, null),
  ('sop06-8.6-10', 'during', 'MARKETING (one block per day; the owner assigns which)', 'Website banner checked: current, not expired', 'Shop Banner; Schedule & Releases', 100, null),
  ('sop06-8.6-11', 'during', 'MARKETING (one block per day; the owner assigns which)', 'In-store content: specials board, shelf talkers, screens updated', 'owner-directed D57', 110, null),
  ('sop06-8.6-12', 'during', 'MARKETING (one block per day; the owner assigns which)', 'Flyer or handout stock checked and reprinted if low', 'owner-directed D57', 120, null),
  ('sop06-8.6-13', 'during', 'MARKETING (one block per day; the owner assigns which)', 'Yard banners / street signs out, straight and undamaged', 'owner-directed D57', 130, null),
  ('sop06-8.6-14', 'during', 'INVENTORY MANAGEMENT', 'Product enrichment: ____ products finished (photos, description, effects)', 'Product Enrichment; SOP-10', 140, null),
  ('sop06-8.6-15', 'during', 'INVENTORY MANAGEMENT', 'Expiring-soon units fronted; markdown labels match the register', null, 150, null),
  ('sop06-8.7-01', 'closing', 'GENERAL', 'SOP-01 drawers closed (blind count), SOP-03 night sheet and bag', null, 10, null),
  ('sop06-8.7-02', 'closing', 'GENERAL', 'SOP-02 PM master till count', null, 20, null),
  ('sop06-8.7-03', 'closing', 'GENERAL', 'Cycle Counts page checked; today''s count done, or handed over', null, 30, 'cycle_counts'),
  ('sop06-8.7-04', 'closing', 'GENERAL', 'A count started today is finished (I''m done) or the owner told to reassign it', '§4.13', 40, null),
  ('sop06-8.7-05', 'closing', 'GENERAL', 'All count sheets / slips (forms 8.2, 8.4) handed to the owner', null, 50, null),
  ('sop06-8.7-06', 'closing', 'GENERAL', 'Online Orders: no unfulfilled pickups left without a note', null, 60, null),
  ('sop06-8.7-07', 'closing', 'GENERAL', 'Shelves faced and restocked for the morning', 'owner-directed D57', 70, null),
  ('sop06-8.7-08', 'closing', 'GENERAL', 'Floors swept/mopped; cases and counters wiped; trash out', 'owner-directed D57; SOP-07', 80, null),
  ('sop06-8.7-09', 'closing', 'GENERAL', 'Product returned to the vault / secure storage as store policy requires', 'owner-directed D57', 90, null),
  ('sop06-8.7-10', 'closing', 'GENERAL', 'Lights, screens and music off; OPEN sign off', null, 100, null),
  ('sop06-8.7-11', 'closing', 'GENERAL', 'Doors locked, alarm armed, cameras still recording', 'owner-directed D57; SOP-20', 110, null),
  ('sop06-8.8-01', 'weekly', 'WEEKLY', 'Newsletter drafted or sent', 'Email Newsletter / Blog & Newsletter; SOP-11', 10, null),
  ('sop06-8.8-02', 'weekly', 'WEEKLY', 'Blog post published', 'Blog & Newsletter; SOP-11; SEO SOP-21', 20, null),
  ('sop06-8.8-03', 'weekly', 'WEEKLY', 'Flyers and in-store content refreshed for next week''s deals', 'owner-directed D57', 30, null),
  ('sop06-8.8-04', 'weekly', 'WEEKLY', 'Website banners and specials match next week''s promotions', 'Shop Banner, Specials', 40, null),
  ('sop06-8.8-05', 'weekly', 'WEEKLY', 'Expiration report read; markdown list agreed with the owner', 'SOP-05a §4.16', 50, null),
  ('sop06-8.8-06', 'weekly', 'WEEKLY', 'Product enrichment backlog reviewed', 'Catalog Hub; SOP-10', 60, null),
  ('sop06-8.8-07', 'weekly', 'WEEKLY', 'Deep clean: back stock room, shelves under displays, glass', 'owner-directed D57; SOP-07', 70, null),
  ('sop06-8.8-08', 'weekly', 'WEEKLY', 'Supplies ordered: bags, labels, receipt paper, cleaning', 'owner-directed D57', 80, null),
  ('sop06-8.8-09', 'weekly', 'WEEKLY', 'Vendor-of-the-day rotation on track; next week''s vendors listed', '§4.24', 90, null),
  ('sop06-8.8-10', 'weekly', 'WEEKLY', 'CCRS weekly upload done', 'SOP-16', 100, null),
  ('sop06-8.8-11', 'monthly', 'MONTHLY', 'Camera footage retention checked; recorder storage healthy', 'owner-directed D57; SOP-20', 110, null),
  ('sop06-8.8-12', 'monthly', 'MONTHLY', 'Fire extinguisher and first-aid kit checked', 'owner-directed D57', 120, null),
  ('sop06-8.8-13', 'monthly', 'MONTHLY', 'Recall plan and contact list still current', 'SOP-05a §4.13', 130, null),
  ('sop06-8.8-14', 'monthly', 'MONTHLY', 'Compliance signage re-checked against current rules', 'Regulatory Watch', 140, null),
  ('sop06-8.8-15', 'monthly', 'MONTHLY', 'Every vendor counted at least once this month', '§4.24', 150, null),
  ('sop06-8.8-16', 'yearly', 'YEAR END', 'Annual full count planned, done and posted', '§4.24; G-41', 160, null)
on conflict (seed_key) where seed_key is not null do nothing;
