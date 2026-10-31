-- Rollback for 0327_daily_checklists.sql.
-- Drops the three checklist tables, their guards and policies. THIS DELETES
-- every initialled checklist sheet; export them first (the five-year record,
-- WAC 314-55-087). The paper forms 8.5-8.8 (SOP-06 §8) take over again.
drop trigger if exists trg_checklist_ticks_guard on public.checklist_ticks;
drop trigger if exists trg_checklist_runs_guard on public.checklist_runs;
drop trigger if exists trg_checklist_tasks_guard on public.checklist_tasks;
drop table if exists public.checklist_ticks;
drop table if exists public.checklist_runs;
drop table if exists public.checklist_tasks;
drop function if exists public.checklist_ticks_guard();
drop function if exists public.checklist_runs_guard();
drop function if exists public.checklist_tasks_guard();
