-- Rollback for 0328_full_count.sql.
-- Removes the full-count guard, index, constraint and the four columns. Every
-- section stays as an ordinary audit (nothing is cancelled or deleted); only
-- the grouping into one year-end full count is lost. SOP-06 §4.24 part 1
-- (several audits the same day) takes over again.
drop trigger if exists inventory_audit_sessions_full_count_guard on public.inventory_audit_sessions;
drop function if exists public.inventory_audit_sessions_full_count_guard();
drop index if exists public.inventory_audit_sessions_full_count_section_uq;
drop index if exists public.inventory_audit_sessions_full_count_year_idx;
alter table public.inventory_audit_sessions drop constraint if exists inventory_audit_sessions_full_count_ck;
alter table public.inventory_audit_sessions
  drop column if exists full_count_id,
  drop column if exists full_count_year,
  drop column if exists section_no,
  drop column if exists section_count;
