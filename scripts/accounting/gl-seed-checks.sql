-- scripts/accounting/gl-seed-checks.sql
-- =============================================================================
-- Post-migration seed assertions. LOCAL VERIFICATION ONLY.
-- =============================================================================
-- Run AFTER migration 0172 has been applied twice, to prove the seeding is
-- idempotent: re-running the migration must never duplicate an entity, a
-- shareholder or an accounting period, and ownership must still total exactly
-- 100%. Raises an exception (and so fails the run) if anything is off.
-- =============================================================================

do $$
declare
  n integer;
begin
  select count(*) into n from gl_entities;
  if n <> 4 then
    raise exception 'expected 4 entities after two migration runs, found %', n;
  end if;

  select count(*) into n from gl_shareholders;
  if n <> 3 then
    raise exception 'expected 3 shareholders after two migration runs, found %', n;
  end if;

  select count(*) into n from gl_periods;
  if n <> 48 then
    raise exception 'expected 48 periods (12 months x 4 entities), found %', n;
  end if;

  select count(*) into n from gl_journal_sequences;
  if n <> 4 then
    raise exception 'expected 4 journal sequences, found %', n;
  end if;

  select coalesce(sum(ownership_milli_pct), 0) into n from gl_shareholders where active;
  if n <> 100000 then
    raise exception 'ownership totals % milli-percent, expected exactly 100000', n;
  end if;

  -- The chart of accounts is deliberately EMPTY at this stage: it is seeded in
  -- slice F2, account by account, with Michael's approval.
  select count(*) into n from gl_accounts;
  if n <> 0 then
    raise exception 'expected an empty chart of accounts after F1, found % accounts', n;
  end if;

  -- Nothing may have posted yet.
  select count(*) into n from gl_journals;
  if n <> 0 then
    raise exception 'expected no journals after F1, found %', n;
  end if;

  raise notice 'seed checks: entities 4, shareholders 3, periods 48, sequences 4, ownership 100%%, accounts 0, journals 0';
end $$;
