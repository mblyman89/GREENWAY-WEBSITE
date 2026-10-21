-- scripts/recon/ach-annual-reviews-0288-pg-check.sql  (R41 S14 - migration 0288)
--
-- Scenario check for 0288_ach_annual_reviews.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-annual-reviews-0288-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0288 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  u_m    uuid := gen_random_uuid();   -- "Michael", owner
  u_s    uuid := gen_random_uuid();   -- "Stephen", admin
  u_x    uuid := gen_random_uuid();   -- a former owner, inactive
  today  date := (now() at time zone 'America/Los_Angeles')::date;
  yr     int  := extract(year from (now() at time zone 'America/Los_Angeles'))::int;
  fp     text := repeat('ab', 32);
  r_orig uuid;
  r_corr uuid;
  n      int;
  ins    text;
begin
  insert into auth.users (id, email) values (u_m, 'm0288@x.test'), (u_s, 's0288@x.test'), (u_x, 'x0288@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0288@x.test', 'owner', true), (u_s, 's0288@x.test', 'admin', true), (u_x, 'x0288@x.test', 'owner', false)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the app path)

  ins := $q$insert into public.ach_annual_reviews (review_year, reviewed_on, outcome, summary, procedure_sha256, corrects_id, created_by)
    values (%L, %L, %L, %L, %L, %L, %L) returning id$q$;

  -- 0. shape: guard not security definer; least privilege
  select count(*) into n from pg_proc where proname in ('ach_annual_reviews_guard', 'ach_annual_reviews_no_truncate') and prosecdef;
  assert n = 0, 'the guards are not security definer';
  assert has_table_privilege('service_role', 'public.ach_annual_reviews', 'INSERT'), 'the server can add reviews';
  assert not has_table_privilege('service_role', 'public.ach_annual_reviews', 'UPDATE'), 'the server cannot update';
  assert not has_table_privilege('service_role', 'public.ach_annual_reviews', 'DELETE'), 'the server cannot delete';
  assert not has_table_privilege('authenticated', 'public.ach_annual_reviews', 'INSERT'), 'a browser session cannot add';
  assert not has_table_privilege('anon', 'public.ach_annual_reviews', 'SELECT'), 'anon reads nothing';
  select count(*) into n from pg_policies where tablename = 'ach_annual_reviews' and qual like '%is_admin()%';
  assert n = 1, 'RLS read is admin-only';

  -- 1. owner only: an admin stamp, an inactive owner and an admin JWT are refused
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Read the procedure; nothing changed.', fp, null, u_s), 'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Read the procedure; nothing changed.', fp, null, u_x), 'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Admin JWT with an owner stamp here.', fp, null, u_m), 'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', '', true);

  -- 2. dates: never backdated, never future; the year is this year (or last)
  perform pg_temp.must_fail(format(ins, yr, today - 2, 'no_changes', 'Read the procedure; nothing changed.', fp, null, u_m), 'ACH_YEARLY_DATE');
  perform pg_temp.must_fail(format(ins, yr, today + 1, 'no_changes', 'Read the procedure; nothing changed.', fp, null, u_m), 'ACH_YEARLY_DATE');
  perform pg_temp.must_fail(format(ins, yr + 1, today, 'no_changes', 'Read the procedure; nothing changed.', fp, null, u_m), 'ACH_YEARLY_YEAR');
  -- before 2026 (the rule's first year): the CHECK in 2026, the trigger's year rule later
  perform pg_temp.must_fail(format(ins, 2025, today, 'no_changes', 'Read the procedure; nothing changed.', fp, null, u_m),
                            case when yr = 2026 then 'ach_annual_reviews_review_year_check' else 'ACH_YEARLY_YEAR' end);

  -- 3. field checks
  perform pg_temp.must_fail(format(ins, yr, today, 'fine', 'Read the procedure; nothing changed.', fp, null, u_m), 'ach_annual_reviews_outcome_check');
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'too short', fp, null, u_m), 'ach_annual_reviews_summary_check');
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Paid account 123456789 and it was fine.', fp, null, u_m), 'ach_annual_reviews_summary_check');
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Read the procedure; nothing changed.', 'ABC', null, u_m), 'ach_annual_reviews_procedure_sha256_check');

  -- 4. the owner records the year's review (the bank phone is fine in a summary)
  execute format(ins, yr, today, 'no_changes', 'Read all items; called 1-800-562-8761 to confirm limits.', fp, null, u_m) into r_orig;
  assert r_orig is not null, 'the owner records the review';

  -- 5. one original per year; corrections point at the original of the same year
  perform pg_temp.must_fail(format(ins, yr, today, 'changes_made', 'A second original for the same year.', fp, null, u_m), 'aar_one_per_year');
  execute format(ins, yr, today, 'changes_made', 'Correction: item 3 now says 90 days on file.', fp, r_orig, u_m) into r_corr;
  execute format(ins, yr, today, 'changes_needed', 'Second correction: still need a new vendor step.', fp, r_orig, u_m);
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Correcting a correction is not allowed.', fp, r_corr, u_m), 'ACH_YEARLY_CORRECTS: correct the original');
  perform pg_temp.must_fail(format(ins, yr, today, 'no_changes', 'Correcting a review that is not there.', fp, gen_random_uuid(), u_m), 'ACH_YEARLY_CORRECTS: the review to correct was not found');
  perform pg_temp.must_fail(format(ins, yr - 1, today, 'no_changes', 'Correction for another year than the original.', fp, r_orig, u_m), 'ACH_YEARLY');

  -- 6. append-only: no update, no delete, no truncate
  perform pg_temp.must_fail(format($q$update public.ach_annual_reviews set summary = 'changed the summary text here' where id = %L$q$, r_orig), 'ACH_YEARLY_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_annual_reviews where id = %L$q$, r_corr), 'ACH_YEARLY_APPEND_ONLY');
  perform pg_temp.must_fail('truncate public.ach_annual_reviews', 'ACH_YEARLY_APPEND_ONLY');
  select count(*) into n from public.ach_annual_reviews where review_year = yr;
  assert n = 3, 'all three rows still there';

  raise notice 'ACH 0288 CHECK PASSED';
end $$;

rollback;
