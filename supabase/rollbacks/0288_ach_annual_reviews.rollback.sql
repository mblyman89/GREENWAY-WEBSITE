-- Rollback for 0288_ach_annual_reviews.sql (R41 S14).
--
-- REFUSES once a yearly review has been recorded: each row is Greenway's
-- record that the Nacha Phase 2 yearly review was done, kept forever. Export
-- the rows first and decide with the owner. Do not drop.
--
-- Otherwise it drops the table and its two trigger functions. Nothing else
-- changed in 0288. Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_annual_reviews') is not null then
    execute 'select exists (select 1 from public.ach_annual_reviews)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_annual_reviews holds yearly review records. Export them first; do not drop.';
    end if;
  end if;
end $$;

drop table if exists public.ach_annual_reviews;
drop function if exists public.ach_annual_reviews_guard();
drop function if exists public.ach_annual_reviews_no_truncate();
