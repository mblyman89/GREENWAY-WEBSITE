-- 0250_obligation_waivers.rollback.sql — undo 0250_obligation_waivers.sql.
--
-- REFUSES to run if the table holds ANY row (live or undone). Every row is a
-- written reason the owner gave for checking off a real State deadline, plus
-- its undo history; that is evidence an examiner may ask for. Export it
-- first (Supabase table editor -> obligation_waivers -> Export CSV), then
-- delete the rows by dropping the guard trigger yourself, then re-run this.
--
-- What you lose while rolled back: dismissed weeks / months nag again. The
-- START DATE (site_settings key compliance_obligation_start) is untouched
-- and keeps working: it needs no table.
do $$
begin
  -- nested + dynamic: plpgsql would otherwise plan the SELECT even when the
  -- table does not exist and fail with "relation does not exist".
  if to_regclass('public.obligation_waivers') is not null then
    if exists (select 1 from public.obligation_waivers) then
      raise exception 'ROLLBACK_REFUSED: obligation_waivers holds your written reasons; export them first';
    end if;
  end if;
end $$;

drop table if exists public.obligation_waivers;
drop function if exists public.obligation_waivers_guard();
drop function if exists public.obligation_waivers_is_sunday(text);

notify pgrst, 'reload schema';
