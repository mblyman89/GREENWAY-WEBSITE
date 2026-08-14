-- =============================================================================
-- scripts/accounting/fixed-assets-tests.sql   (slice F5-L)
--
-- THE ADVERSARIAL SUITE FOR FIXED ASSETS AND DEPRECIATION.
--
-- Its job is to BREAK the new accounts and guards, not to confirm they work
-- (standing rule 13b). Every assertion states its SPECIFIC expectation (rule
-- 13c) so a test can never pass because something unrelated broke.
--
-- HOW TO RUN IT
--   Apply migrations 0172..0178 to a scratch database, then run this file.
--   Every check raises on failure, so ON_ERROR_STOP makes a non-zero exit a
--   real failure. The assertion COUNTER printed at the end exists so a suite
--   that silently does nothing is distinguishable from one that passes.
--
-- THE HEADLINE ATTACKS
--   #1-10   The CONTRA-FLAG BUG. 0173 seeded 10200 Bank Operating and 10300 ATM
--           Vault with is_contra = true (the 4th positional argument), making
--           them CREDIT-normal. The abnormal-balance alarm reads normal_balance,
--           so a real overdraft looked NORMAL and a healthy balance looked
--           broken -- on the very account that had already drifted to
--           -45,230.00. #10 pins the COMPLETE set of credit-normal assets, so a
--           future miskeyed flag cannot slip in unnoticed.
--   #22a-d  Inventory is STILL untypeable after 0178 narrowed the inventory
--           guard's range. Loosening a guard is dangerous; this proves it did
--           not weaken.
--   #24-26  Land and construction-in-progress can NEVER be depreciated.
--           Pub. 946: "You cannot depreciate the cost of land because land does
--           not wear out, become obsolete, or get used up."
--   #27-28d THE FALSE-POSITIVE ATTACKS, and the reason this suite exists. The
--           first version of the land guard tested for the PRESENCE of
--           accumulated depreciation next to land, which BLOCKED A LEGITIMATE
--           PROPERTY SALE -- a sale debits 21900 to unwind it. The Geiger cabin
--           has already been sold, so this was a real transaction being refused.
--           28c is the mutation check: the same entry with the sign flipped must
--           still be REFUSED, otherwise the direction test is dead code.
--           28d requires the refusal to TELL MICHAEL WHAT TO DO instead.
--   #29a    ANTI-VACUOUS GUARD. gl_submit_journal creates DRAFTS, and the
--           reporting views exclude drafts, so an earlier version of this suite
--           was asserting against an EMPTY ledger and passing for no reason.
--           29a and 32a fail loudly if there is nothing real to measure.
--   #42-43  Double entry still holds: every journal nets to exactly zero.
--
-- WHAT IS DELIBERATELY NOT WORKED AROUND
--   Posting here respects the REAL production controls -- control accounts may
--   only be moved by their subledger, and entries at or above $5,000 need a
--   genuine second approver. The suite creates a real second user and funds
--   through non-control accounts rather than lowering a threshold to go green.
--   A test that disables the control it is standing next to proves nothing.
-- =============================================================================
\set ON_ERROR_STOP on

create table if not exists public._t (n int);
delete from public._t;
insert into public._t values (0);

create or replace function public.ok(p_label text, p_cond boolean)
returns void language plpgsql as $$
begin
  update public._t set n = n + 1;
  if not p_cond then
    raise exception 'ASSERTION FAILED: %', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end $$;

create or replace function public.eqi(p_label text, p_actual bigint, p_want bigint)
returns void language plpgsql as $$
begin
  update public._t set n = n + 1;
  if p_actual is distinct from p_want then
    raise exception 'ASSERTION FAILED: % — expected %, got %', p_label, p_want, p_actual;
  end if;
  raise notice 'PASS  % (%)', p_label, p_actual;
end $$;

-- =============================================================================
-- PART 1 — THE CONTRA-FLAG CORRECTION (the bug found while building this)
-- =============================================================================
\echo ''
\echo '--- PART 1: bank contra-flag correction ---'

select public.ok(
  'ATTACK 1: 10200 Bank Operating is NOT contra after 0178',
  (select not is_contra from public.gl_accounts where code = '10200'));

select public.ok(
  'ATTACK 2: 10200 carries a DEBIT normal balance (cash is not normally overdrawn)',
  (select normal_balance = 'debit' from public.gl_accounts where code = '10200'));

select public.ok(
  'ATTACK 3: 10200 is still a CONTROL account (the fix did not drop the real flag)',
  (select is_control from public.gl_accounts where code = '10200'));

select public.ok(
  'ATTACK 4: 10200 still points at the cash subledger',
  (select control_subledger = 'cash' from public.gl_accounts where code = '10200'));

select public.ok(
  'ATTACK 5: 10300 ATM Vault is NOT contra and is debit-normal',
  (select not is_contra and normal_balance = 'debit'
     from public.gl_accounts where code = '10300'));

select public.ok(
  'ATTACK 6: 10300 kept its entity restriction to atm+greenway',
  (select allowed_entity_codes @> array['atm','greenway']
     from public.gl_accounts where code = '10300'));

-- The genuinely-contra accounts must be UNTOUCHED by the correction.
select public.ok(
  'ATTACK 7: 20810 shrink reserve is still contra (real contra untouched)',
  (select is_contra and normal_balance = 'credit'
     from public.gl_accounts where code = '20810'));

select public.ok(
  'ATTACK 8: 41000 distributions still contra-equity with a debit normal',
  (select is_contra and normal_balance = 'debit'
     from public.gl_accounts where code = '41000'));

select public.ok(
  'ATTACK 9: 50900 discounts still contra-income with a debit normal',
  (select is_contra and normal_balance = 'debit'
     from public.gl_accounts where code = '50900'));

-- THE REAL POINT: no asset account may be credit-normal except accumulated
-- depreciation and the shrink reserve, which are deliberate contra accounts.
select public.ok(
  'ATTACK 10: the ONLY credit-normal assets are the two intended contra accounts',
  (select coalesce(array_agg(code order by code), array[]::text[])
     from public.gl_accounts
    where type = 'asset' and normal_balance = 'credit')
  = array['20810','21900']);

-- =============================================================================
-- PART 2 — THE NEW FIXED-ASSET ACCOUNTS
-- =============================================================================
\echo ''
\echo '--- PART 2: fixed-asset accounts ---'

select public.eqi(
  'ATTACK 11: all ten fixed-asset accounts exist',
  (select count(*) from public.gl_accounts
    where code in ('21000','21100','21200','21300','21400',
                   '21500','21600','21700','21800','21900')), 10);

select public.ok(
  'ATTACK 12: every fixed-asset account is type=asset (block 2 firewall held)',
  (select bool_and(type = 'asset') from public.gl_accounts
    where code between '21000' and '21999'));

select public.ok(
  'ATTACK 13: 21100 Land is NOT contra and is debit-normal',
  (select not is_contra and normal_balance = 'debit'
     from public.gl_accounts where code = '21100'));

select public.ok(
  'ATTACK 14: 21900 Accumulated Depreciation IS contra with a CREDIT normal',
  (select is_contra and normal_balance = 'credit'
     from public.gl_accounts where code = '21900'));

select public.ok(
  'ATTACK 15: every fixed-asset account hangs off the 21000 parent',
  (select bool_and(parent_code = '21000') from public.gl_accounts
    where code in ('21100','21200','21300','21400','21500',
                   '21600','21700','21800','21900')));

select public.ok(
  'ATTACK 16: land/building/accum/parent are SYSTEM accounts (cannot be deleted)',
  (select bool_and(is_system) from public.gl_accounts
    where code in ('21000','21100','21300','21900')));

select public.ok(
  'ATTACK 17: no fixed-asset account collides with the inventory range',
  (select count(*) = 0 from public.gl_accounts
    where code in ('21000','21100','21200','21300','21400',
                   '21500','21600','21700','21800','21900')
      and code::int between 20000 and 20999));

select public.ok(
  'ATTACK 18: every new account carries a real explanation',
  (select bool_and(length(coalesce(description,'')) > 80) from public.gl_accounts
    where code in ('21100','21300','21900')));

-- The land account's description must actually quote the authority.
select public.ok(
  'ATTACK 19: the Land account quotes Pub. 946 on why it is never depreciated',
  (select description like '%does not wear out%' from public.gl_accounts where code = '21100'));

-- =============================================================================
-- PART 3 — SEED A REAL ENTITY AND POST REAL ENTRIES
-- =============================================================================
\echo ''
\echo '--- PART 3: posting against the new accounts ---'

-- Become an admin actor with a real auth user.
--
-- The shared harness (scripts/accounting/gl-schema-harness.sql) reads the actor
-- from session settings and DEFAULTS is_admin TO FALSE on purpose, because that
-- is what Michael's Supabase SQL editor actually looks like. Admin is therefore
-- requested explicitly here, exactly as the other accounting suites do.
do $$
declare v_uid uuid;
begin
  insert into auth.users (email) values ('michael@test.local') returning id into v_uid;
  perform set_config('harness.user_id', v_uid::text, false);
end $$;
select set_config('harness.is_admin', 'true', false);

select public.ok('ATTACK 20: actor is admin',  public.is_admin());
select public.ok('ATTACK 21: actor has a uid', auth.uid() is not null);

-- Buy the Geiger property: land + building, funded by a note.
-- $525,000 total, split $355,000 land / $170,000 building.
do $$
declare
  v_j jsonb;
begin
  v_j := public.gl_submit_journal(
    'landholding', date '2026-03-15', 'manual', null,
    'Geiger property purchase — land and building split per closing statement',
    jsonb_build_array(
      jsonb_build_object('account_code','21100','amount_cents', 35500000, 'description','Land — never depreciated'),
      jsonb_build_object('account_code','21300','amount_cents', 17000000, 'description','Building — 39yr MM'),
      jsonb_build_object('account_code','36000','amount_cents',-52500000, 'description','Funded via related entity (34000 Notes Payable is a CONTROL account driven by the loan subledger, so a manual journal may not touch it)')
    ));
  raise notice 'purchase journal %', v_j;
end $$;

select public.ok(
  'ATTACK 22: land and building both posted',
  (select count(*) = 2 from public.gl_journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code in ('21100','21300')));

-- Depreciation: DEBIT 78010 expense, CREDIT 21900 accumulated. LEGAL.
do $$
declare v_j jsonb;
begin
  v_j := public.gl_submit_journal(
    'landholding', date '2026-12-31', 'manual', null,
    'Depreciation 2026 — Geiger building, 39yr MM',
    jsonb_build_array(
      jsonb_build_object('account_code','78010','amount_cents', 358400,
                         'description','Building depreciation', 'cost_class','separate_business'),
      jsonb_build_object('account_code','21900','amount_cents',-358400,
                         'description','Accumulated depreciation')
    ));
  raise notice 'depreciation journal %', v_j;
end $$;

select public.ok(
  'ATTACK 23: a LEGAL building depreciation entry posts fine',
  (select count(*) > 0 from public.gl_journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '21900'));

-- =============================================================================
-- PART 3b — THE INVENTORY GUARD IS NARROWED, NOT WEAKENED.
--
-- 0178 changed gl_guard_inventory_manual()'s test from "any block-2 asset" to
-- "20000-20999" so that fixed assets can be hand-keyed from a closing
-- statement. That is a loosening, and a loosening has to be proved safe: every
-- inventory account must STILL refuse a typed journal.
-- =============================================================================
\echo ''
\echo '--- PART 3b: inventory is still untypeable ---'

do $$
declare v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'greenway', date '2026-06-10', 'manual', null,
      'ILLEGAL: hand-typing an inventory category',
      jsonb_build_array(
        jsonb_build_object('account_code','20140','amount_cents', 500000, 'description','plug'),
        jsonb_build_object('account_code','10200','amount_cents',-500000, 'description','cash')
      ));
    raise exception 'GUARD DID NOT FIRE — inventory was hand-typed!';
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like 'GL_INVENTORY_MANUAL%' then
    raise exception 'ASSERTION FAILED: ATTACK 22a — expected GL_INVENTORY_MANUAL, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 22a: an inventory CATEGORY account still refuses a typed journal';
end $$;

do $$
declare v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'greenway', date '2026-06-10', 'manual', null,
      'ILLEGAL: hand-typing the quarantine account',
      jsonb_build_array(
        jsonb_build_object('account_code','20890','amount_cents', 500000, 'description','plug'),
        jsonb_build_object('account_code','10200','amount_cents',-500000, 'description','cash')
      ));
    raise exception 'GUARD DID NOT FIRE — 20890 was hand-typed!';
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like 'GL_INVENTORY_MANUAL%' then
    raise exception 'ASSERTION FAILED: ATTACK 22b — expected GL_INVENTORY_MANUAL, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 22b: the quarantine account 20890 still refuses a typed journal';
end $$;

do $$
declare v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'greenway', date '2026-06-10', 'manual', null,
      'ILLEGAL: hand-typing the shrink reserve',
      jsonb_build_array(
        jsonb_build_object('account_code','20810','amount_cents', 500000, 'description','plug'),
        jsonb_build_object('account_code','10200','amount_cents',-500000, 'description','cash')
      ));
    raise exception 'GUARD DID NOT FIRE — 20810 was hand-typed!';
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like 'GL_INVENTORY_MANUAL%' then
    raise exception 'ASSERTION FAILED: ATTACK 22c — expected GL_INVENTORY_MANUAL, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 22c: the shrink reserve 20810 still refuses a typed journal';
end $$;

-- Boundary: 20999 is the last inventory code, 21000 the first fixed asset.
select public.ok(
  'ATTACK 22d: the narrowed range still covers every seeded inventory account',
  (select bool_and(code >= '20000' and code <= '20999')
     from public.gl_accounts
    where type = 'asset' and code like '20%'));

-- =============================================================================
-- PART 4 — THE LAND GUARD (the whole point of the slice)
-- =============================================================================
\echo ''
\echo '--- PART 4: land can never be depreciated ---'

do $$
declare
  v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'landholding', date '2026-12-31', 'manual', null,
      'ILLEGAL: depreciating land',
      jsonb_build_array(
        jsonb_build_object('account_code','78010','amount_cents', 100000,
                           'description','depreciation', 'cost_class','separate_business'),
        jsonb_build_object('account_code','21100','amount_cents',-100000,
                           'description','writing down LAND')
      ));
    raise exception 'GUARD DID NOT FIRE — land depreciation was accepted!';
  exception
    when others then
      v_err := SQLERRM;
  end;

  update public._t set n = n + 1;
  if v_err not like 'GL_LAND_NOT_DEPRECIABLE%' then
    raise exception 'ASSERTION FAILED: ATTACK 24 — expected GL_LAND_NOT_DEPRECIABLE, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 24: depreciating LAND is refused (%)', left(v_err, 60);
end $$;

do $$
declare v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'landholding', date '2026-12-31', 'manual', null,
      'ILLEGAL: land into accumulated depreciation',
      jsonb_build_array(
        jsonb_build_object('account_code','21100','amount_cents', 100000, 'description','land'),
        jsonb_build_object('account_code','21900','amount_cents',-100000, 'description','accum depr')
      ));
    raise exception 'GUARD DID NOT FIRE — land vs accumulated depreciation accepted!';
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like 'GL_LAND_NOT_DEPRECIABLE%' then
    raise exception 'ASSERTION FAILED: ATTACK 25 — expected GL_LAND_NOT_DEPRECIABLE, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 25: land paired with accumulated depreciation is refused';
end $$;

do $$
declare v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'landholding', date '2026-12-31', 'manual', null,
      'ILLEGAL: depreciating construction in progress',
      jsonb_build_array(
        jsonb_build_object('account_code','78010','amount_cents', 50000,
                           'description','depreciation', 'cost_class','separate_business'),
        jsonb_build_object('account_code','21800','amount_cents',-50000, 'description','CIP')
      ));
    raise exception 'GUARD DID NOT FIRE — CIP depreciation accepted!';
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like 'GL_LAND_NOT_DEPRECIABLE%' then
    raise exception 'ASSERTION FAILED: ATTACK 26 — expected GL_LAND_NOT_DEPRECIABLE, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 26: depreciating construction in progress is refused';
end $$;

-- FALSE-POSITIVE CHECK. The guard must NOT block legitimate land activity.
do $$
declare v_j jsonb;
begin
  v_j := public.gl_submit_journal(
    'landholding', date '2026-06-01', 'manual', null,
    'LEGAL: buying more land with cash',
    jsonb_build_array(
      jsonb_build_object('account_code','21100','amount_cents', 1000000, 'description','more land'),
      jsonb_build_object('account_code','10900','amount_cents',-1000000, 'description','cash')
    ));
end $$;
select public.ok(
  'ATTACK 27: buying land with cash is NOT blocked (guard is narrow, not blunt)',
  true);

do $$
declare v_j jsonb;
begin
  v_j := public.gl_submit_journal(
    'landholding', date '2026-06-02', 'manual', null,
    'LEGAL: reallocating basis between land and building',
    jsonb_build_array(
      jsonb_build_object('account_code','21100','amount_cents', -500000, 'description','reduce land'),
      jsonb_build_object('account_code','21300','amount_cents',  500000, 'description','increase building')
    ));
end $$;
select public.ok(
  'ATTACK 28: reallocating basis between land and building is NOT blocked',
  true);

-- -----------------------------------------------------------------------------
-- ATTACKS 28a-28d: THE DISPOSAL FALSE POSITIVE.
--
-- These exist because the first version of this guard BLOCKED A LEGITIMATE
-- PROPERTY SALE. That is not hypothetical: the Geiger cabin has already been
-- sold. The guard tested for the PRESENCE of 21900/78010 next to land; a sale
-- necessarily DEBITS 21900 to unwind accumulated depreciation, so a perfectly
-- legal entry was refused. Rule 19: the failure becomes a permanent test.
-- -----------------------------------------------------------------------------
-- First BUY the property that ATTACK 28a/28b will sell, and accumulate some
-- depreciation on it. A disposal test that sells an asset the books never owned
-- proves nothing and produces a negative cost balance -- which is exactly the
-- impossible state gl_check_accumulated_depreciation exists to catch.
do $$
begin
  perform public.gl_submit_journal(
    'personal', date '2026-01-05', 'manual', null,
    'Buying the property that will be sold in ATTACK 28a',
    jsonb_build_array(
      jsonb_build_object('account_code','21100','amount_cents',  6000000, 'description','Land at cost'),
      jsonb_build_object('account_code','21300','amount_cents',  9000000, 'description','Building at cost'),
      jsonb_build_object('account_code','36000','amount_cents',-15000000, 'description','funded via related entity')
    ));
  perform public.gl_submit_journal(
    'personal', date '2026-06-30', 'manual', null,
    'Accumulating depreciation on that building before it is sold',
    jsonb_build_array(
      jsonb_build_object('account_code','78010','amount_cents', 500000,
                         'description','depreciation expense', 'cost_class','separate_business'),
      jsonb_build_object('account_code','21900','amount_cents',-500000,
                         'description','CREDIT accumulating depreciation (building only)')
    ));
end $$;

do $$
declare v_err text := 'NO ERROR';
begin
  begin
    perform public.gl_submit_journal(
      -- These disposals run in the PERSONAL books on purpose. The land guard
      -- inspects the SHAPE of a journal, not which entity owns it, so the test
      -- is exactly as strong here -- and it leaves the landholding books holding
      -- a real, still-owned property for PART 5 to measure.
      -- Sized to a property that was actually bought first (below), so the
      -- ledger stays economically possible.
      'personal', date '2026-07-01', 'manual', null,
      'LEGAL: selling the property (land + building + accumulated depreciation)',
      jsonb_build_array(
        jsonb_build_object('account_code','10900','amount_cents', 13000000,
                           'description','sale proceeds to the bank'),
        jsonb_build_object('account_code','21900','amount_cents',   400000,
                           'description','DEBIT to clear accumulated depreciation'),
        jsonb_build_object('account_code','21100','amount_cents', -4000000,
                           'description','removing LAND at cost'),
        jsonb_build_object('account_code','21300','amount_cents', -9000000,
                           'description','removing BUILDING at cost'),
        jsonb_build_object('account_code','36000','amount_cents',  -400000,
                           'description','gain on sale (parked; gain/loss accounts arrive in a later slice)')
      ));
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err <> 'NO ERROR' then
    raise exception 'ASSERTION FAILED: ATTACK 28a — a LEGAL property sale was blocked: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 28a: selling land+building (debiting 21900) is ALLOWED';
end $$;

-- The same sale with a gain line present must also pass.
do $$
declare v_err text := 'NO ERROR';
begin
  begin
    perform public.gl_submit_journal(
      'personal', date '2026-07-03', 'manual', null,
      'LEGAL: selling land only, at a gain',
      jsonb_build_array(
        jsonb_build_object('account_code','10900','amount_cents', 2100000,
                           'description','proceeds'),
        jsonb_build_object('account_code','21900','amount_cents',  100000,
                           'description','DEBIT clearing accumulated depreciation'),
        jsonb_build_object('account_code','21100','amount_cents',-2000000,
                           'description','removing LAND at cost'),
        jsonb_build_object('account_code','36000','amount_cents', -200000,
                           'description','gain on sale (parked)')
      ));
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err <> 'NO ERROR' then
    raise exception 'ASSERTION FAILED: ATTACK 28b — a land disposal was blocked: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 28b: disposing of land while unwinding 21900 is ALLOWED';
end $$;

-- MUTATION-STYLE CHECK ON THE GUARD ITSELF. The direction test must be real:
-- flipping the sign on the 21900 line (credit instead of debit) must flip the
-- verdict from allowed to refused. If both directions pass, the guard is dead.
do $$
declare v_err text := 'NO ERROR';
begin
  begin
    perform public.gl_submit_journal(
      'personal', date '2026-07-04', 'manual', null,
      'ILLEGAL: same shape as the sale but CREDITING 21900 next to land',
      jsonb_build_array(
        jsonb_build_object('account_code','10900','amount_cents', 16500000,
                           'description','cash'),
        jsonb_build_object('account_code','21900','amount_cents', -500000,
                           'description','CREDIT accumulating depreciation'),
        jsonb_build_object('account_code','21100','amount_cents',-16000000,
                           'description','land')
      ));
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like 'GL_LAND_NOT_DEPRECIABLE%' then
    raise exception 'ASSERTION FAILED: ATTACK 28c — flipping 21900 to a CREDIT should be refused, got: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 28c: the SAME entry with 21900 credited IS refused (direction test is live)';
end $$;

-- The error message must TEACH, not merely refuse. Michael asked for a mentor.
do $$
declare v_err text := '';
begin
  begin
    perform public.gl_submit_journal(
      'landholding', date '2026-07-05', 'manual', null,
      'ILLEGAL: depreciating land, checking the message quality',
      jsonb_build_array(
        jsonb_build_object('account_code','78010','amount_cents', 100000,
                           'description','depreciation', 'cost_class','separate_business'),
        jsonb_build_object('account_code','21100','amount_cents',-100000,
                           'description','land')
      ));
  exception when others then v_err := SQLERRM;
  end;
  update public._t set n = n + 1;
  if v_err not like '%WHAT TO DO%' or v_err not like '%split it into two entries%' then
    raise exception 'ASSERTION FAILED: ATTACK 28d — the refusal does not tell Michael what to do instead: %', v_err;
  end if;
  raise notice 'PASS  ATTACK 28d: the refusal explains what to do instead, not just "no"';
end $$;

-- Depreciating a BUILDING while land merely exists elsewhere in the books is fine.
select public.ok(
  'ATTACK 29: building depreciation still posts even though land exists in these books',
  (select count(*) >= 1 from public.gl_journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '21900'));

-- =============================================================================
-- PART 5 — THE ACCUMULATED-DEPRECIATION CHECK
--
-- DEFECT FOUND WHILE WRITING THIS SUITE, RECORDED SO IT CANNOT COME BACK:
-- every journal above was created as a DRAFT. gl_check_accumulated_depreciation
-- reads gl_reportable_lines, which by design counts only posted/reversed
-- journals (0175_gl_trial_balance.sql:96). So the first version of ATTACK 30
-- was asserting "not over" against an EMPTY ledger and passing for the wrong
-- reason -- a vacuous green. The fix is to actually POST the drafts, and then
-- to PROVE the ledger is non-empty before asserting anything about it.
-- =============================================================================
\echo ''
\echo '--- PART 5: accumulated depreciation vs cost ---'

-- SECOND DEFECT FOUND HERE, AND THE CONTROLS ARE RIGHT, NOT MY TEST DATA:
--
--   GL_CONTROL_ACCOUNT   -- 10200 Bank Operating is a CONTROL account owned by
--                           the cash subledger; a manual journal may never move
--                           it (0172:738). My purchase entries funded from
--                           10200, which production would correctly refuse.
--   GL_APPROVAL_REQUIRED -- entries at or above $5,000 need a second approver,
--                           and self-approval is refused (0174:848).
--
-- I am NOT weakening either control to make my suite go green. That is exactly
-- the "work around the guard" behaviour the guards exist to prevent. Instead the
-- test data now does what Michael will really do: fund from a non-control
-- clearing account, and have a genuine SECOND person approve the large entries.
do $$
declare
  r record;
  v_posted int := 0;
  v_failed int := 0;
  v_approver uuid;
begin
  -- A real second person, so segregation of duties is satisfied honestly.
  insert into auth.users (email) values ('second.approver@test.local')
    returning id into v_approver;

  for r in select id, created_by from public.gl_journals
            where status = 'draft' order by created_at loop
    begin
      -- approved_by and approved_at must move together
      -- (constraint gl_journals_approval_pairing, 0174:718).
      update public.gl_journals
         set approved_by = v_approver,
             approved_at = now()
       where id = r.id and approved_by is null;
      perform public.gl_post_journal(r.id);
      v_posted := v_posted + 1;
    exception when others then
      v_failed := v_failed + 1;
      raise notice '  (could not post %: %)', r.id, left(SQLERRM, 110);
    end;
  end loop;
  raise notice '  posted % draft journal(s), % refused', v_posted, v_failed;
end $$;

-- ANTI-VACUOUS GUARD. If this fails, every assertion in PART 5 is meaningless,
-- because they would all be measuring an empty ledger. Never let a suite report
-- green because it found nothing to test.
do $$
declare v_lines int; v_cost bigint;
begin
  select count(*) into v_lines from public.gl_reportable_lines
   where entity_code = 'landholding';
  select cost_cents into v_cost
    from public.gl_check_accumulated_depreciation('landholding');
  update public._t set n = n + 1;
  if v_lines = 0 then
    raise exception 'ASSERTION FAILED: ATTACK 29a — the landholding ledger is EMPTY, so PART 5 would pass vacuously';
  end if;
  if coalesce(v_cost,0) = 0 then
    raise exception 'ASSERTION FAILED: ATTACK 29a — depreciable cost is 0, so PART 5 would pass vacuously';
  end if;
  raise notice 'PASS  ATTACK 29a: the ledger is real (% reportable lines, cost %)', v_lines, v_cost;
end $$;

select public.ok(
  'ATTACK 30: the check reports NOT over when depreciation is below cost',
  (select not is_over from public.gl_check_accumulated_depreciation('landholding')));

select public.ok(
  'ATTACK 31: the check explains itself in plain English',
  (select message like '%Remaining basis to recover%'
     from public.gl_check_accumulated_depreciation('landholding')));

select public.ok(
  'ATTACK 32: cost excludes LAND (land is not depreciable basis)',
  (select cost_cents = 17000000 + 500000
     from public.gl_check_accumulated_depreciation('landholding')));

-- Now blow past cost deliberately and confirm it is DETECTED.
do $$
declare
  v_j        jsonb;
  v_id       uuid;
  v_approver uuid;
begin
  v_j := public.gl_submit_journal(
    'landholding', date '2026-12-31', 'manual', null,
    'Excessive depreciation, deliberately',
    jsonb_build_array(
      jsonb_build_object('account_code','78010','amount_cents', 99000000,
                         'description','way too much', 'cost_class','separate_business'),
      jsonb_build_object('account_code','21900','amount_cents',-99000000, 'description','accum')
    ));

  -- It must actually POST, otherwise gl_check_accumulated_depreciation cannot
  -- see it (gl_reportable_lines excludes drafts) and ATTACK 33 would be
  -- asserting against a ledger where nothing over-depreciated ever happened.
  v_id := (v_j->>'journal_id')::uuid;
  insert into auth.users (email) values ('approver.overdep@test.local')
    returning id into v_approver;
  update public.gl_journals
     set approved_by = v_approver, approved_at = now()
   where id = v_id and approved_by is null;
  perform public.gl_post_journal(v_id);
end $$;

-- Prove the over-depreciation actually landed, so ATTACK 33 cannot pass or fail
-- for the wrong reason.
do $$
declare v_cost bigint; v_accum bigint;
begin
  select cost_cents, accumulated_cents into v_cost, v_accum
    from public.gl_check_accumulated_depreciation('landholding');
  update public._t set n = n + 1;
  if v_accum <= v_cost then
    raise exception 'ASSERTION FAILED: ATTACK 32a — the excessive entry did not post (cost %, accumulated %), so ATTACK 33 would be vacuous', v_cost, v_accum;
  end if;
  raise notice 'PASS  ATTACK 32a: over-depreciation really is on the books (cost %, accumulated %)', v_cost, v_accum;
end $$;

select public.ok(
  'ATTACK 33: accumulated depreciation exceeding cost is DETECTED',
  (select is_over from public.gl_check_accumulated_depreciation('landholding')));

select public.ok(
  'ATTACK 34: the over-depreciation message names the problem in plain English',
  (select message like 'PROBLEM:%never exceed what the asset cost%'
     from public.gl_check_accumulated_depreciation('landholding')));

select public.ok(
  'ATTACK 35: an entity with no fixed assets gets a calm message, not an error',
  (select message like 'No depreciable fixed assets%'
     from public.gl_check_accumulated_depreciation('atm')));

-- =============================================================================
-- PART 6 — THE SUMMARY VIEW
-- =============================================================================
\echo ''
\echo '--- PART 6: plain-English summary view ---'

select public.ok(
  'ATTACK 36: the summary view shows land as never depreciated',
  (select treatment like 'Never depreciated%' from public.gl_fixed_assets_summary
    where account_code = '21100' and entity_code = 'landholding'));

select public.ok(
  'ATTACK 37: accumulated depreciation is shown as a POSITIVE number for humans',
  (select balance_cents > 0 from public.gl_fixed_assets_summary
    where account_code = '21900' and entity_code = 'landholding'));

select public.ok(
  'ATTACK 38: the summary view flags CIP as not yet in service',
  (select count(*) = 0 from public.gl_fixed_assets_summary where account_code = '21800'));

-- =============================================================================
-- PART 7 — THE ABNORMAL-BALANCE ALARM NOW WORKS ON BANK ACCOUNTS
-- (this is what the contra bug would have broken)
-- =============================================================================
\echo ''
\echo '--- PART 7: the alarm the contra bug would have disarmed ---'

-- The cash-side activity above runs through 10900 Cash — Clearing, because
-- 10200 is a CONTROL account that a manual journal may not touch (see PART 5).
-- 10900 is an ordinary debit-normal cash account, so the alarm logic under test
-- is identical: a credit balance on a debit-normal cash account is abnormal.
--
-- This is the exact alarm the contra-flag bug in 0173 would have disarmed:
-- with is_contra wrongly true, a real overdraft reads as perfectly NORMAL.
do $$
declare v_bal bigint; v_abn boolean;
begin
  select balance_cents, is_abnormal into v_bal, v_abn
    from public.gl_trial_balance
   where account_code = '10900' and entity_code = 'landholding';

  update public._t set n = n + 1;
  if v_bal is null then
    raise exception 'ASSERTION FAILED: ATTACK 39 — 10900 has no trial-balance row, so the alarm is untested (vacuous)';
  end if;
  if v_bal >= 0 then
    raise exception 'ASSERTION FAILED: ATTACK 39 — 10900 is not negative (%), so there is no overdraft to detect', v_bal;
  end if;
  if not v_abn then
    raise exception 'ASSERTION FAILED: ATTACK 39 — a negative cash balance of % was NOT flagged abnormal (the alarm is disarmed)', v_bal;
  end if;
  raise notice 'PASS  ATTACK 39: a negative cash balance (%) is correctly flagged ABNORMAL', v_bal;
end $$;

select public.ok(
  'ATTACK 40: accumulated depreciation with a CREDIT balance is NOT flagged abnormal',
  (select not is_abnormal from public.gl_trial_balance
    where account_code = '21900' and entity_code = 'landholding'));

select public.ok(
  'ATTACK 41: land with a DEBIT balance is NOT flagged abnormal',
  (select not is_abnormal from public.gl_trial_balance
    where account_code = '21100' and entity_code = 'landholding'));

-- =============================================================================
-- PART 8 — THE BOOKS STILL BALANCE
-- =============================================================================
\echo ''
\echo '--- PART 8: double entry still holds ---'

select public.eqi(
  'ATTACK 42: every journal in these books nets to exactly zero',
  -- sum() over bigint returns numeric; cast back to bigint. Exact, no float.
  (select coalesce(sum(amount_cents), 0)::bigint from public.gl_journal_lines), 0::bigint);

select public.eqi(
  'ATTACK 43: the landholding trial balance nets to zero',
  (select coalesce(sum(balance_cents), 0)::bigint from public.gl_trial_balance
    where entity_code = 'landholding'), 0::bigint);

\echo ''
select 'ASSERTIONS EXECUTED: ' || n as summary from public._t;
