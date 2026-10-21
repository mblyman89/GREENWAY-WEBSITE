-- Rollback for 0289_ach_bank_watch.sql (R41 S16).
--
-- REFUSES once a rule or a review has been recorded: they are Greenway's
-- record of which payees were allowed and what each unexplained bank line
-- was. Export the rows first and decide with the owner. Do not drop.
--
-- Otherwise it drops the two tables and their three trigger functions.
-- Nothing else changed in 0289. Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_bank_watch_rules') is not null then
    execute 'select exists (select 1 from public.ach_bank_watch_rules)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_bank_watch_rules holds known-payee rules. Export them first; do not drop.';
    end if;
  end if;
  if to_regclass('public.ach_bank_watch_reviews') is not null then
    execute 'select exists (select 1 from public.ach_bank_watch_reviews)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_bank_watch_reviews holds bank line reviews. Export them first; do not drop.';
    end if;
  end if;
end $$;

drop table if exists public.ach_bank_watch_reviews;
drop table if exists public.ach_bank_watch_rules;
drop function if exists public.ach_bank_watch_rules_guard();
drop function if exists public.ach_bank_watch_reviews_guard();
drop function if exists public.ach_bank_watch_no_truncate();
