-- =============================================================================
-- scripts/accounting/sql-editor-context-tests.sql
--
-- THE TEST THAT WOULD HAVE CAUGHT THE 0175 FAILURE.
--
-- Michael applies every migration BY HAND in the Supabase SQL editor. That
-- context has one property our test harness did not reproduce: THERE IS NO
-- LOGGED-IN END USER. auth.uid() is null, so is_admin() is false.
--
-- 0175 shipped with a DO block that called its own admin-guarded function
-- gl_open_fiscal_year(). Under the old harness -- which defaulted is_admin() to
-- TRUE purely so seeding would work -- that passed three times in a row. In the
-- real SQL editor it failed instantly:
--
--     ERROR: GL_FORBIDDEN: only an admin may open a fiscal year.
--
-- This file exists so that can never happen silently again (standing rule 19:
-- a real-world failure becomes a permanent test).
--
-- WHAT IT ASSERTS
--   1. With NO admin -- the honest SQL-editor picture -- the fiscal periods that
--      0175 is responsible for seeding actually EXIST. If someone reintroduces a
--      guarded call in migration context, the seed will not have happened and
--      this fails.
--   2. The runtime guard is STILL STRICT: a non-admin calling the user-facing
--      gl_open_fiscal_year() is still refused. The fix must not have been
--      "loosen the guard".
--
-- Run by: scripts/accounting/verify-trial-balance.sh (final phase, non-admin).
-- =============================================================================

\set ON_ERROR_STOP on

-- Become nobody. This is the SQL editor.
select set_config('harness.is_admin', 'false', false);
select set_config('harness.user_id', '', false);

do $$
declare
  v_admin     boolean;
  v_years     integer;
  v_periods   integer;
  v_refused   boolean := false;
  v_entities  integer;
begin
  raise notice '';
  raise notice '===========================================================================';
  raise notice 'SQL EDITOR CONTEXT — applying migrations as nobody (auth.uid() is null)';
  raise notice '===========================================================================';

  -- ---------------------------------------------------------------- precondition
  select public.is_admin() into v_admin;
  if v_admin then
    raise exception 'VACUITY GUARD: this suite is meaningless unless is_admin() is false. Got true.';
  end if;
  raise notice '   PASS  context confirmed: is_admin() is false, as in the SQL editor';

  select count(*) into v_entities from public.gl_entities;
  if v_entities = 0 then
    raise exception 'VACUITY GUARD: no entities exist, so "periods per entity" would pass trivially.';
  end if;

  -- ------------------------------------------------------- 1. the seed happened
  -- 0175 must have opened 2026..2030 for every entity WITHOUT needing an admin.
  select count(distinct fiscal_year) into v_years
  from public.gl_periods
  where fiscal_year between 2026 and 2030;

  if v_years <> 5 then
    raise exception 'FAIL  expected 5 seeded fiscal years (2026-2030), found %. '
                    'A guarded function called from migration context would leave these unseeded.', v_years;
  end if;
  raise notice '   PASS  all 5 fiscal years 2026-2030 were seeded without an admin session';

  select count(*) into v_periods
  from public.gl_periods
  where fiscal_year between 2026 and 2030;

  if v_periods <> v_entities * 60 then
    raise exception 'FAIL  expected % periods (% entities x 5 years x 12 months), found %',
      v_entities * 60, v_entities, v_periods;
  end if;
  raise notice '   PASS  % periods present = % entities x 5 years x 12 months',
    v_periods, v_entities;

  -- --------------------------------------------- 2. the runtime guard still bites
  -- The fix must be "do not call the guarded function from a migration", NOT
  -- "make the guard weaker". Prove the guard still refuses a real non-admin.
  begin
    perform public.gl_open_fiscal_year(2031);
  exception
    when insufficient_privilege then
      v_refused := true;
  end;

  if not v_refused then
    raise exception 'FAIL  gl_open_fiscal_year() did NOT refuse a non-admin. '
                    'The guard was weakened -- that is not the fix.';
  end if;
  raise notice '   PASS  gl_open_fiscal_year() still refuses a non-admin (guard intact)';

  -- and it really did not create anything
  if exists (select 1 from public.gl_periods where fiscal_year = 2031) then
    raise exception 'FAIL  the refused call still created 2031 periods.';
  end if;
  raise notice '   PASS  the refused call created nothing (2031 has no periods)';

  raise notice '';
  raise notice 'SQL EDITOR CONTEXT CHECKS PASSED';
  raise notice '===========================================================================';
end $$;
