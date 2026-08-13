-- scripts/accounting/coa-seed-checks.sql
-- =============================================================================
-- SEED INTEGRITY CHECKS FOR MIGRATION 0173. NOT A MIGRATION.
-- =============================================================================
-- Runs AFTER 0173 has been applied twice. Proves the chart seeded exactly once
-- (no duplicate rows from the second run) and that every structural invariant
-- the design depends on actually holds in the seeded data.
--
-- These are not tests of the guards (that is coa-schema-tests.sql). These are
-- tests of the DATA: the chart Michael will actually look at every morning.
-- =============================================================================

do $$
declare
  v_n           int;
  v_dupes       int;
  v_bad         text;
  v_missing     text;
begin
  ------------------------------------------------------------------------------
  -- 1. The chart exists and did not double up on the idempotency re-run.
  ------------------------------------------------------------------------------
  select count(*) into v_n from public.gl_accounts;
  if v_n = 0 then
    raise exception 'SEED CHECK FAILED: gl_accounts is empty; 0173 seeded nothing';
  end if;

  select count(*) into v_dupes
  from (select code from public.gl_accounts group by code having count(*) > 1) d;
  if v_dupes <> 0 then
    raise exception 'SEED CHECK FAILED: % duplicated account codes after re-run', v_dupes;
  end if;
  raise notice 'seed: % accounts, no duplicate codes after applying twice', v_n;

  ------------------------------------------------------------------------------
  -- 2. Every code is exactly 5 digits and never starts with 0.
  --    Leading zeros are how a chart silently grows two accounts that look
  --    identical in a printed report.
  ------------------------------------------------------------------------------
  select string_agg(code, ', ') into v_bad
  from public.gl_accounts where code !~ '^[1-9][0-9]{4}$';
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: malformed account codes: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 3. Every account's block agrees with its type. This is the firewall that
  --    stops "50009 EXCISE TAX ADJUSTMENTS" living in the revenue block.
  ------------------------------------------------------------------------------
  select string_agg(code || '=' || type, ', ') into v_bad
  from public.gl_accounts where not public.gl_block_allows_type(code, type);
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: block/type mismatches: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 4. Normal balance is derived, never typed. Re-derive it and compare.
  ------------------------------------------------------------------------------
  select string_agg(code || ' has ' || normal_balance, ', ') into v_bad
  from public.gl_accounts a
  where a.normal_balance <> (
    case
      when a.type in ('asset','cogs','expense','other_expense')
        then case when a.is_contra then 'credit' else 'debit' end
      else case when a.is_contra then 'debit' else 'credit' end
    end
  );
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: wrong normal balance: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 5. Every parent_code points at an account that exists.
  ------------------------------------------------------------------------------
  select string_agg(a.code || '->' || a.parent_code, ', ') into v_bad
  from public.gl_accounts a
  where a.parent_code is not null
    and not exists (select 1 from public.gl_accounts p where p.code = a.parent_code);
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: dangling parent_code: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 6. THE MIRROR. Every cannabis inventory category must have a revenue twin
  --    and a COGS twin on the SAME last four digits. This is what makes margin
  --    by category a subtraction instead of a project.
  ------------------------------------------------------------------------------
  select string_agg(i.code || ' (' || i.category_slug || ')', ', ') into v_missing
  from public.gl_accounts i
  where i.code like '2%'
    and i.category_slug is not null
    and (
      not exists (select 1 from public.gl_accounts r
                  where r.code = '5' || right(i.code, 4) and r.type = 'income')
      or
      not exists (select 1 from public.gl_accounts c
                  where c.code = '6' || right(i.code, 4) and c.type = 'cogs')
    );
  if v_missing is not null then
    raise exception 'SEED CHECK FAILED: inventory categories with no revenue/COGS mirror: %', v_missing;
  end if;

  select count(*) into v_n
  from public.gl_accounts where code like '2%' and category_slug is not null;
  raise notice 'seed: % inventory categories, each mirrored into revenue and COGS', v_n;

  ------------------------------------------------------------------------------
  -- 7. The mirror in reverse: no orphan revenue or COGS category account
  --    pointing at an inventory category that does not exist.
  ------------------------------------------------------------------------------
  select string_agg(x.code, ', ') into v_bad
  from public.gl_accounts x
  where x.category_slug is not null
    and (x.code like '5%' or x.code like '6%')
    and not exists (select 1 from public.gl_accounts i
                    where i.code = '2' || right(x.code, 4));
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: orphan revenue/COGS category accounts: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 8. Category slugs must agree across the three mirrored blocks. A revenue
  --    account tagged with a different category than its inventory twin would
  --    quietly report the wrong margin forever.
  ------------------------------------------------------------------------------
  select string_agg(i.code || '=' || i.category_slug || ' vs ' || x.code || '=' || x.category_slug, ', ')
    into v_bad
  from public.gl_accounts i
  join public.gl_accounts x
    on right(x.code, 4) = right(i.code, 4)
   and (x.code like '5%' or x.code like '6%')
  where i.code like '2%'
    and i.category_slug is not null
    and x.category_slug is distinct from i.category_slug;
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: category slug drift across mirror: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 9. THE EXCISE RULE. RCW 69.50.535(4) makes the 37% trust money. It must
  --    exist as a LIABILITY, and no account anywhere in the revenue or expense
  --    blocks may be named for cannabis excise. This is the check that would
  --    have caught the old "50009 EXCISE TAX ADJUSTMENTS".
  ------------------------------------------------------------------------------
  if not exists (
    select 1 from public.gl_accounts
    where type = 'liability' and lower(name) like '%excise%'
  ) then
    raise exception 'SEED CHECK FAILED: no excise liability account; the 37%% has nowhere lawful to sit';
  end if;

  select string_agg(code || ' ' || name, ', ') into v_bad
  from public.gl_accounts
  where lower(name) like '%excise%'
    and type in ('income','expense','cogs','other_income','other_expense');
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: excise treated as revenue/expense: %', v_bad;
  end if;
  raise notice 'seed: excise is a trust liability only, never revenue and never an expense';

  ------------------------------------------------------------------------------
  -- 10. 280E. Every COGS account must carry a cost class, and none of them may
  --     be classified as non-deductible: a cost that is 280E-disallowed is by
  --     definition not cost of goods sold.
  ------------------------------------------------------------------------------
  select string_agg(code, ', ') into v_bad
  from public.gl_accounts
  where type = 'cogs'
    and (default_cost_class is null or default_cost_class not in ('cogs_direct','cogs_allocable'));
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: COGS accounts with a non-COGS cost class: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 11. Balance-sheet accounts must NOT carry a 280E cost class. 280E is about
  --     the character of a deduction; a balance in an asset is not a deduction.
  ------------------------------------------------------------------------------
  select string_agg(code || '=' || default_cost_class, ', ') into v_bad
  from public.gl_accounts
  where type in ('asset','liability','equity')
    and coalesce(default_cost_class, 'none') <> 'none';
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: balance-sheet accounts carrying a cost class: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 12. The inventory control account must actually be a control account. If
  --     this flag is off, F1's gl_post_journal() will happily accept a manual
  --     $4.6M plug straight into inventory, which is exactly how we got here.
  ------------------------------------------------------------------------------
  if not exists (
    select 1 from public.gl_accounts
    where code = '20000' and is_control and control_subledger = 'inventory'
  ) then
    raise exception 'SEED CHECK FAILED: 20000 is not flagged as an inventory control account';
  end if;
  raise notice 'seed: 20000 is a control account; manual journal lines into it are refused by 0172';

  ------------------------------------------------------------------------------
  -- 13. Control accounts must never be leaves that also carry a category. A
  --     control account that is itself a category account can be posted to
  --     through the back door of its own subledger.
  ------------------------------------------------------------------------------
  select string_agg(code, ', ') into v_bad
  from public.gl_accounts where is_control and category_slug is not null;
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: control accounts doubling as category accounts: %', v_bad;
  end if;

  ------------------------------------------------------------------------------
  -- 14. Entity restrictions must reference entities that actually exist in the
  --     ledger. This is the check that catches the real "GRWNY" typo class of
  --     bug: 18 live accounts were tagged with a code that matched nothing.
  ------------------------------------------------------------------------------
  select string_agg(a.code || ' -> ' || e.bad, ', ') into v_bad
  from public.gl_accounts a
  cross join lateral unnest(a.allowed_entity_codes) as e(bad)
  where a.allowed_entity_codes is not null
    and not exists (select 1 from public.gl_entities g where g.code = e.bad);
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: accounts restricted to non-existent entities (the GRWNY bug): %', v_bad;
  end if;
  raise notice 'seed: every entity restriction resolves to a real ledger entity (no GRWNY typos)';

  ------------------------------------------------------------------------------
  -- 15. No account may be its own parent, and no parent chain may loop.
  ------------------------------------------------------------------------------
  if exists (select 1 from public.gl_accounts where parent_code = code) then
    raise exception 'SEED CHECK FAILED: an account is its own parent';
  end if;

  with recursive walk(code, root, depth) as (
    select code, code, 0 from public.gl_accounts
    union all
    select a.parent_code, w.root, w.depth + 1
    from walk w join public.gl_accounts a on a.code = w.code
    where a.parent_code is not null and w.depth < 12
  )
  select string_agg(distinct root, ', ') into v_bad from walk where depth >= 12;
  if v_bad is not null then
    raise exception 'SEED CHECK FAILED: parent chain loops or is absurdly deep from: %', v_bad;
  end if;

  raise notice 'seed: all 15 chart integrity checks passed';
end $$;
