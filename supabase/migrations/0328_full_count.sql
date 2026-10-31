-- 0328_full_count.sql  (Fix Phase 4.4d · G-41 · owner D58, D56, D54)
--
-- WHY. The owner, verbatim (Q-06-5, D58):
--   "we do a full inventory audit once per year at the end of the year."
-- Gap G-41 (05-GAP-REGISTER.md): a full-count audit type with no cap; split
-- into counter-sized sections each claimed by one employee (D56); one release,
-- one combined review, one work paper; per-lot capture at first count (G-35,
-- built in 0326) so the store can stay open; the work paper suitable for the
-- accountant. Before this file the year-end count was several audits made the
-- same day with "Show every active lot instead", which stops at 400 lots.
--
-- WHAT. No new table. A full count is a GROUP of ordinary audit sessions, one
-- per section, so every section keeps everything 0191 / 0192 / 0326 already
-- enforce (blind count, one counter, I'm done, cut-off capture, recount rule,
-- reasons, posting). Four columns on inventory_audit_sessions mark the group:
--   full_count_id    the id shared by every section of one full count
--   full_count_year  the year-end the count is for (e.g. 2026)
--   section_no       1 .. section_count
--   section_count    how many sections the count was split into
-- All four are filled together or not at all.
--
-- GUARDS.
--   * inventory_audit_sessions_full_count_ck: all four or none; section_no in
--     1..section_count; a sensible year.
--   * unique (full_count_id, section_no): a section number is used once.
--   * trigger inventory_audit_sessions_full_count_guard:
--       - the four columns never change after insert (a section cannot be
--         moved to another count or another year);
--       - ONE FULL COUNT PER YEAR: a new section is refused when another full
--         count for the same year has a section that is not cancelled
--         (FULL_COUNT_ONE_PER_YEAR).
--     The factory reset hatch (gl_factory_reset_active(), 0209) is let through.
--
-- FACTORY RESET. Nothing new to classify: the columns live on
-- inventory_audit_sessions, which is already WIPE (factory-reset-core.ts), so
-- rehearsal full counts are emptied with the other practice audits and the
-- pinned 139-table WIPE list (0240) is not reopened.
--
-- RLS. Unchanged: sessions are owner-only to write (0191
-- inventory_audit_sessions_owner_all), staff read (inventory_audit_sessions_staff_read).
-- Counting still goes only through the 0326 functions.
--
-- SAFE / IDEMPOTENT: add column if not exists; constraint and index dropped
-- and re-made by name; create or replace for the function. Apply MANUALLY in
-- the Supabase SQL editor after 0327. Before it is applied the Year-end full
-- count screen says the migration is pending and creates nothing; use SOP-06
-- §4.24 part 1 (several audits the same day).

do $precheck$
begin
  if to_regclass('public.inventory_audit_sessions') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0328 depends on inventory_audit_sessions from 0191_inventory_audit.sql';
  end if;
  if to_regprocedure('public.inventory_audit_claim(uuid)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: apply 0326_audit_count_integrity.sql before 0328';
  end if;
  if to_regclass('public.checklist_tasks') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: apply 0327_daily_checklists.sql before 0328';
  end if;
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0328 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
end
$precheck$;

-- ═══ 1. Columns ═════════════════════════════════════════════════════════════
alter table public.inventory_audit_sessions
  add column if not exists full_count_id   uuid,
  add column if not exists full_count_year integer,
  add column if not exists section_no      integer,
  add column if not exists section_count   integer;

alter table public.inventory_audit_sessions
  drop constraint if exists inventory_audit_sessions_full_count_ck;
alter table public.inventory_audit_sessions
  add constraint inventory_audit_sessions_full_count_ck check (
    (full_count_id is null and full_count_year is null and section_no is null and section_count is null)
    or (
      full_count_id is not null and full_count_year is not null
      and section_no is not null and section_count is not null
      and section_count >= 1 and section_no between 1 and section_count
      and full_count_year between 2020 and 2100
    )
  );

drop index if exists public.inventory_audit_sessions_full_count_section_uq;
create unique index inventory_audit_sessions_full_count_section_uq
  on public.inventory_audit_sessions (full_count_id, section_no)
  where full_count_id is not null;

create index if not exists inventory_audit_sessions_full_count_year_idx
  on public.inventory_audit_sessions (full_count_year)
  where full_count_id is not null;

-- ═══ 2. Guard ═══════════════════════════════════════════════════════════════
create or replace function public.inventory_audit_sessions_full_count_guard()
returns trigger
language plpgsql
as $$
begin
  if public.gl_factory_reset_active() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.full_count_id   is distinct from old.full_count_id
    or new.full_count_year is distinct from old.full_count_year
    or new.section_no      is distinct from old.section_no
    or new.section_count   is distinct from old.section_count then
      raise exception 'FULL_COUNT_FIXED: a section of a full count cannot be moved to another count, year or section number.';
    end if;
    return new;
  end if;

  -- INSERT
  if new.full_count_id is not null then
    if exists (
      select 1 from public.inventory_audit_sessions s
       where s.full_count_year = new.full_count_year
         and s.full_count_id <> new.full_count_id
         and s.status <> 'cancelled'
    ) then
      raise exception 'FULL_COUNT_ONE_PER_YEAR: there is already a full count for % that is not cancelled. One full count a year (D58): finish it, or cancel it first.', new.full_count_year;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inventory_audit_sessions_full_count_guard on public.inventory_audit_sessions;
create trigger inventory_audit_sessions_full_count_guard
  before insert or update on public.inventory_audit_sessions
  for each row execute function public.inventory_audit_sessions_full_count_guard();

comment on column public.inventory_audit_sessions.full_count_id is
  '0328 (G-41): the id shared by every section of one year-end full count. Null for an ordinary count.';
comment on column public.inventory_audit_sessions.full_count_year is
  '0328 (G-41): the year-end this full count is for. One full count a year (D58).';
comment on column public.inventory_audit_sessions.section_no is
  '0328 (G-41): this section''s number, 1 .. section_count. One employee counts one section (D56).';
comment on column public.inventory_audit_sessions.section_count is
  '0328 (G-41): how many sections the full count was split into.';
