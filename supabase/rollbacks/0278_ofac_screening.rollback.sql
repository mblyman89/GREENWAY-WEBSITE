-- Rollback for 0278_ofac_screening.sql (R41 S11).
--
-- REFUSES once screening has been USED: every run, result and review is a
-- record of the sanctions screening (OFAC FAQ 5 asks for complete records).
-- Export the rows first and decide with the owner. Do not drop.
--
-- REFUSES when an owner-approval request targets a review (target_type
-- ofac_review): the 0277 list without it could not hold it.
--
-- Otherwise it drops the functions and the tables, and puts the 0277
-- ach_change_requests.target_type list back VERBATIM. Safe to re-run.
do $$
declare
  used boolean;
  t text;
begin
  foreach t in array array['ofac_match_reviews', 'ofac_screening_results', 'ofac_screening_runs'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I)', t) into used;
      if used then
        raise exception 'ROLLBACK REFUSED: % holds screening records. Export them first; do not drop.', t;
      end if;
    end if;
  end loop;
  if exists (select 1 from public.ach_change_requests where target_type = 'ofac_review') then
    raise exception 'ROLLBACK REFUSED: an owner-approval request targets a screening review; the 0277 target list cannot hold it.';
  end if;
end $$;

drop function if exists public.ofac_record_run(jsonb, jsonb);
drop table if exists public.ofac_match_reviews;
drop table if exists public.ofac_screening_results;
drop table if exists public.ofac_screening_runs;
drop function if exists public.ofac_match_reviews_guard();
drop function if exists public.ofac_screening_guard();
drop function if exists public.ofac_screening_no_truncate();

alter table public.ach_change_requests drop constraint if exists ach_change_requests_target_type_check;
alter table public.ach_change_requests add constraint ach_change_requests_target_type_check
  check (target_type in ('vendor', 'employee', 'authorization', 'account', 'verification',
                         'notice', 'document', 'contact', 'invite', 'payroll_run',
                         'company', 'vendor_payment', 'ach_file', 'timberland_comms'));
