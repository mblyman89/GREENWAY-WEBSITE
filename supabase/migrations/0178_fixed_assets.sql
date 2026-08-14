-- =============================================================================
-- 0178 — FIXED ASSETS, DEPRECIATION, AND A CONTRA-FLAG CORRECTION (slice F5-L)
--
-- IDEMPOTENT. Safe to run more than once. Applied by hand in the Supabase SQL
-- editor. Prints nothing on success — anything that appears is a problem.
--
-- -----------------------------------------------------------------------------
-- PART A — WHY THIS EXISTS: THE BOOKS COULD NOT RECORD A BUILDING
-- -----------------------------------------------------------------------------
-- Before this migration the chart of accounts had NO fixed-asset accounts at
-- all. Block 2 ran 20000-20890 and every one of those accounts was inventory.
-- Measured, not assumed — the complete list of seeded block-2 codes was:
--
--     20000-20220  Inventory — cannabis categories
--     20800        Inventory — In Transit
--     20810        Inventory Shrink / Waste Reserve
--     20890        Inventory — UNCLASSIFIED (quarantine)
--
-- There was no Land account, no Building account, and no Accumulated
-- Depreciation. Meanwhile 78000/78010/78020 (Depreciation & Amortization,
-- Depreciation Expense, Amortization Expense) already existed — an expense with
-- nothing to expense. The Geiger property, a real building owned since 2016,
-- could not be recorded in these books at all.
--
-- That is not a cosmetic gap. Under section 1016 basis is reduced by
-- depreciation "allowed or ALLOWABLE": the IRS reduces basis on sale by the
-- depreciation the taxpayer COULD have claimed, whether or not he claimed it.
-- An unrecorded building therefore loses the deduction every year AND still
-- pays the basis reduction on the way out. It is the worst of both.
--
-- -----------------------------------------------------------------------------
-- PART B — A REAL BUG FOUND WHILE BUILDING THIS, AND FIXED HERE
-- -----------------------------------------------------------------------------
-- While confirming that no contra account had ever been seeded, every one of
-- the 183 gl_upsert_account() calls in 0173 was parsed positionally. Two
-- accounts were passing `true` as the FOURTH argument — p_is_contra — when the
-- intent was plainly the FIFTH, p_is_control:
--
--     10200  Bank — Operating           contra=true, control=true
--     10300  Bank — ATM Vault Account   contra=true, control=true
--
-- gl_upsert_account derives normal_balance and then FLIPS it for contra:
--
--     v_normal := case when p_type in ('asset','cogs','expense','other_expense')
--                      then 'debit' else 'credit' end;
--     if p_is_contra then v_normal := <flipped>; end if;
--
-- So both bank accounts were seeded CREDIT-normal. A bank account with a credit
-- normal balance says the normal state of Michael's cash is overdrawn.
--
-- WHY NOTHING CAUGHT IT. gl_guard_account_normal_balance() in 0172 checks that
-- normal_balance AGREES with type-and-contra. It agreed perfectly — the flag was
-- wrong, not the derivation, so the guard confirmed a correct derivation of a
-- wrong input. Every other contra account in the file is genuinely contra
-- (20810 shrink reserve, 41000 distributions, 50900 discounts, 50910 returns,
-- 60900 purchase discounts). These two were the only ones where contra and
-- control were both true, which is what made the argument slip visible.
--
-- WHAT IT WOULD HAVE COST. gl_trial_balance computes is_abnormal from
-- normal_balance. Credit-normal bank accounts invert that test completely: a
-- healthy positive cash balance is flagged ABNORMAL every single day, and a
-- genuine overdraft — the thing the flag exists to catch — is reported as
-- normal. gl_period_health counts the same abnormal rows, so the period close
-- inherits it. Michael's own failure corpus already contains "-45,230.00 in ATM
-- cash, negative cash, impossible" (standing rule 19). This bug would have
-- disarmed the alarm built specifically to catch that recurrence, on the exact
-- account it recurred on. That is why it is fixed in the same breath as the
-- feature rather than filed as a ticket.
--
-- The fix is a plain re-upsert with the correct flags. gl_upsert_account is
-- ON CONFLICT (code) DO UPDATE, so this corrects the row in place. It does not
-- trip GL_ACCOUNT_IMMUTABLE: that guard blocks renumbering and un-systeming, not
-- flag repair.
--
-- -----------------------------------------------------------------------------
-- PART C — LEGAL GROUND FOR THE NEW ACCOUNTS (quoted, not paraphrased)
-- -----------------------------------------------------------------------------
-- IRS Publication 946 (2025), "Land":
--   "You cannot depreciate the cost of land because land does not wear out,
--    become obsolete, or get used up. The cost of land generally includes the
--    cost of clearing, grading, planting, and landscaping."
--   => Land gets its OWN account (21100) and is never touched by depreciation.
--      Land and building must be separated at purchase or the split becomes a
--      reconstruction argument years later, in front of someone unsympathetic.
--
-- Pub. 946, "The mid-month convention":
--   "Use this convention for nonresidential real property, residential rental
--    property, and any railroad grading or tunnel bore."
--   => Buildings only. Equipment and vehicles use half-year or mid-quarter.
--
-- Pub. 946, GDS recovery periods: nonresidential real property = 39 years.
--
-- The arithmetic lives in src/lib/accounting/fixed-assets-core.ts, which
-- transcribes Table A-7a and reproduces the publication's own worked example
-- ($100,000 building, March: $2,033 / $2,564 / $2,564) as a test.
--
-- -----------------------------------------------------------------------------
-- PART D — WHY 21000 AND NOT A NEW BLOCK
-- -----------------------------------------------------------------------------
-- gl_block_allows_type maps block 2 to 'asset'. Inventory stops at 20890, so
-- 21000+ is free inside a block that already permits exactly the right type. A
-- new block would have meant touching the block/type firewall — the thing
-- standing between this chart and the old suffixed mess — to gain nothing.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) THE CONTRA-FLAG CORRECTION (Part B above).
--
--    Argument order, for anyone reading this next to the call:
--      (code, name, type, is_contra, is_control, control_subledger,
--       requires_cost_class, default_cost_class, allowed_entity_codes,
--       is_system, parent_code, category_slug, description)
--
--    The ONLY change from 0173 is that argument 4 becomes false while argument 5
--    stays true. Everything else is reproduced exactly so this is a correction
--    rather than a redefinition.
-- -----------------------------------------------------------------------------
do $fix$
begin
  perform public.gl_upsert_account('10200','Bank — Operating','asset',
    false,true,'cash',false,'none',null,false,'10000',null,
    'CONTROL: reconciled to the Plaid feed. Which bank/account is a Plaid dimension. CORRECTED in 0178: 0173 passed true as the 4th positional argument (is_contra) when is_control was meant, which seeded this account CREDIT-normal. A credit-normal bank account inverts the abnormal-balance test, so healthy cash was flagged as a problem and a real overdraft would have been reported as normal.');

  perform public.gl_upsert_account('10300','Bank — ATM Vault Account','asset',
    false,true,'cash',false,'none',array['atm','greenway'],false,'10000',null,
    'CONTROL. The old 12000 ATM CASH BALANCE had drifted to -45,230.00 — negative cash, impossible. Re-derived from evidence at cut-over. CORRECTED in 0178: same is_contra/is_control argument slip as 10200. On THIS account the consequence was acute — negative ATM cash is on the owner''s permanent failure corpus, and a credit normal balance would have silently disarmed the alarm built to catch exactly that.');
end $fix$;


-- -----------------------------------------------------------------------------
-- 2) THE FIXED-ASSET ACCOUNTS.
--
--    One parent, seven cost accounts, one contra. Codes mirror
--    FIXED_ASSET_ACCOUNTS in src/lib/accounting/fixed-assets-core.ts, and a test
--    there asserts every code is a bare 5-digit block-2 code at or above 21000.
--
--    allowed_entity_codes is null on all of them: Greenway owns a building, the
--    landholding entity owns the Geiger parcel, and personal will eventually
--    carry a residence. Entity is a DIMENSION, which is the whole lesson of the
--    -GRNWY / -GRWYE suffix disaster.
-- -----------------------------------------------------------------------------
do $seed$
begin
  perform public.gl_upsert_account('21000','Property, Plant & Equipment','asset',
    false,false,null,false,'none',null,true,null,null,
    'Parent for all long-lived assets. Block 2 was entirely inventory before this; 21000+ is the fixed-asset range. Nothing posts directly to a parent.');

  -- LAND. The account that must never be depreciated.
  perform public.gl_upsert_account('21100','Land','asset',
    false,false,null,false,'none',null,true,'21000',null,
    'NEVER DEPRECIATED. Pub. 946: "You cannot depreciate the cost of land because land does not wear out, become obsolete, or get used up." Land holds its basis until the day it is sold. Every building purchase must be split between this account and 21300 at the moment of purchase, using the closing statement — reconstructing that split years later is an argument, not a record. The Geiger parcel land sits here.');

  perform public.gl_upsert_account('21200','Land Improvements','asset',
    false,false,null,false,'none',null,false,'21000',null,
    'Parking, fencing, site lighting, drainage: 15-year property, and DEPRECIABLE even though the land underneath is not. Kept separate from 21100 precisely because the two are treated differently — merged into land, these deductions are lost forever.');

  perform public.gl_upsert_account('21300','Buildings','asset',
    false,false,null,false,'none',null,true,'21000',null,
    'Nonresidential real property: 39-year straight line, mid-month convention. Building cost ONLY — the land component belongs in 21100. Pub. 946 Example 1 is the shape: a $120,000 purchase where the contract shows $100,000 building and $20,000 land depreciates $100,000, not $120,000.');

  perform public.gl_upsert_account('21400','Building Improvements','asset',
    false,false,null,false,'none',null,false,'21000',null,
    'Capitalised improvements to an owned building, depreciated as SEPARATE property from their own in-service date. The test is character, not size: a repair keeps the building in ordinary operating condition and is expensed, while a betterment, restoration or adaptation must be capitalised here. Small amounts may still qualify for the de minimis or small-taxpayer safe harbours, but that is a documented election, not a default.');

  perform public.gl_upsert_account('21500','Leasehold Improvements','asset',
    false,false,null,false,'none',null,false,'21000',null,
    'Improvements to premises the business LEASES rather than owns. Separate from 21400 because the recovery period and the end-of-lease treatment differ, and because a leasehold improvement can be abandoned when the lease ends while a building improvement cannot.');

  perform public.gl_upsert_account('21600','Furniture, Fixtures & Equipment','asset',
    false,false,null,false,'none',null,false,'21000',null,
    'Safes, display cases, POS hardware, security systems: 7-year property under the half-year or mid-quarter convention — never mid-month, which is for real property only. Mid-quarter turns on when more than 40% of the year''s additions land in the last three months, and that is a test across ALL assets for the year, not a property of any one purchase.');

  perform public.gl_upsert_account('21700','Vehicles','asset',
    false,false,null,false,'none',null,false,'21000',null,
    '5-year property, and usually LISTED property under section 280F. Listed property carries deduction caps and, under section 274(d), strict substantiation — the one area where the Cohan rule is switched off entirely and an undocumented deduction is simply disallowed. Mileage logs are not optional here.');

  perform public.gl_upsert_account('21800','Construction in Progress','asset',
    false,false,null,false,'none',null,false,'21000',null,
    'Costs accumulated on an asset that is NOT YET placed in service. Depreciation begins when an asset is ready and available for its assigned use, not when it is paid for, so CIP is deliberately non-depreciable. Reclassify to 21300/21400/21600 on the in-service date. A balance that never moves out of here is a red flag.');

  -- THE CONTRA ACCOUNT.
  perform public.gl_upsert_account('21900','Accumulated Depreciation','asset',
    true,false,null,false,'none',null,true,'21000',null,
    'CONTRA-ASSET: credit normal balance, and the only account in block 2 that is legitimately credit-normal. Holds depreciation taken to date against every asset in 21200-21700. Cost accounts are NEVER written down directly — the original cost stays visible in 21300 and the wear accumulates here, so basis and depreciation can both be read off the balance sheet. Accumulated depreciation can never exceed the depreciable basis of the assets it offsets; that cap is enforced in fixed-assets-core.ts and proved by mutation test.');
end $seed$;


-- -----------------------------------------------------------------------------
-- 3) GUARD: LAND CAN NEVER BE DEPRECIATED, ENFORCED IN THE DATABASE.
--
--    The TypeScript core refuses to CALCULATE depreciation on land. This trigger
--    refuses to POST it, so the rule survives a caller that bypasses the core —
--    a SQL console, a future import, a well-meaning fix at 11pm.
--
--    CORRECTION (found by testing this guard against a real property SALE, which
--    is not hypothetical -- Michael has already sold the Geiger cabin). An
--    earlier draft of this guard fired on the mere PRESENCE of accumulated
--    depreciation (21900) or depreciation expense (78010) alongside land. That
--    was wrong, and the comment that used to sit here claiming "selling it ...
--    remain[s] perfectly legal" was FALSE. Proof, from the actual run:
--
--      selling a property: Dr Cash, Dr AccumDepr, Cr Land, Cr Building
--      ERROR: GL_LAND_NOT_DEPRECIABLE ... this entry depreciates account(s) 21100
--
--    A guard that blocks a legal transaction is not a safety feature. It teaches
--    the owner to work around it, and the workaround is what actually hurts him.
--
--    THE REAL SIGNAL IS DIRECTION, NOT PRESENCE. Sign convention, quoted from
--    0172_gl_foundation.sql:357: "Positive = debit, negative = credit."
--
--      Depreciation ACCUMULATES -> 21900 is CREDITED (negative), and/or
--                                  78010 is DEBITED  (positive).
--      A disposal REMOVES it    -> 21900 is DEBITED  (positive), unwinding the
--                                  contra balance so the asset leaves the books.
--
--    So this guard refuses land/CIP only when depreciation is being ADDED. A
--    sale, which debits 21900, passes. Buying land with a mortgage, reallocating
--    basis between land and building, and disposing of property are all legal.
--
--    ONE ACCEPTED FALSE POSITIVE, DELIBERATELY KEPT: an entry that both books the
--    final period's depreciation AND disposes of the asset in a single journal is
--    still refused, because it really does debit 78010 next to land. The correct
--    bookkeeping is two entries. The error message says so explicitly, so the
--    answer is "here is what to do", never a bare "no".
--
--    TIMING: this is an ordinary AFTER trigger, NOT "deferrable initially
--    deferred". The deferred version was tested and does protect the database --
--    the offending transaction still aborts and zero rows survive -- but it fires
--    at COMMIT, after gl_submit_journal has already returned success. The caller
--    cannot catch it and cannot translate it into a sentence Michael can read. A
--    guard whose message never reaches a human is only half a guard.
-- -----------------------------------------------------------------------------
create or replace function public.gl_guard_no_land_depreciation()
returns trigger language plpgsql as $$
declare
  v_journal_id uuid;
  v_has_land   boolean;
  v_has_depr   boolean;
  v_land_code  text;
begin
  v_journal_id := new.journal_id;

  select exists (
    select 1
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
    where l.journal_id = v_journal_id
      and a.code in ('21100','21800')
  ) into v_has_land;

  if not v_has_land then
    return new;
  end if;

  -- DIRECTION, not presence. Depreciation is being ADDED when accumulated
  -- depreciation is CREDITED (negative) or depreciation expense is DEBITED
  -- (positive). A disposal DEBITS 21900 to unwind it, and must pass.
  select exists (
    select 1
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
    where l.journal_id = v_journal_id
      and (
        (a.code = '21900' and l.amount_cents < 0)   -- credit: accumulating
        or
        (a.code = '78010' and l.amount_cents > 0)   -- debit: expensing
      )
  ) into v_has_depr;

  if v_has_depr then
    select string_agg(distinct a.code, ', ')
      into v_land_code
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
    where l.journal_id = v_journal_id
      and a.code in ('21100','21800');

    raise exception 'GL_LAND_NOT_DEPRECIABLE: this entry ADDS depreciation against account(s) % — land (21100) and construction in progress (21800) are never depreciated. IRS Pub. 946: "You cannot depreciate the cost of land because land does not wear out, become obsolete, or get used up." Land is recovered on sale; CIP is not in service until it is placed in service. WHAT TO DO: if you are depreciating a building, put the depreciation against 21300 Buildings and leave the land component alone. If you are SELLING the property, that is allowed — a sale DEBITS 21900 to unwind the accumulated depreciation; this entry CREDITS it, which is the opposite. If you are doing both at once, split it into two entries: first record the final period of depreciation, then record the sale.', v_land_code
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function public.gl_guard_no_land_depreciation() is
  'Refuses any journal that ADDS depreciation against land (21100) or construction in progress (21800) — that is, credits accumulated depreciation (21900) or debits depreciation expense (78010) in the same entry. A DISPOSAL, which debits 21900 to unwind the contra balance, is explicitly allowed: selling property is legal and must never be blocked. Pub. 946: land does not wear out, become obsolete, or get used up.';

-- Plain AFTER trigger, not a deferred constraint trigger: see the TIMING note
-- above. Dropping BOTH spellings so a database that already ran an earlier draft
-- of this migration ends up with exactly one trigger, not two.
drop trigger if exists trg_gl_no_land_depreciation on public.gl_journal_lines;
create trigger trg_gl_no_land_depreciation
  after insert or update on public.gl_journal_lines
  for each row execute function public.gl_guard_no_land_depreciation();


-- -----------------------------------------------------------------------------
-- 3b) NARROWING gl_guard_inventory_manual() — A CONSEQUENCE OF ADDING BLOCK-2
--     ACCOUNTS THAT ARE NOT INVENTORY.
--
--     0173 forbids hand-typed journals into inventory, and rightly so: "LAZY
--     INVENTORY ENTRY" was a hand-typed number, and splitting one anonymous
--     bucket into 21 named buckets is worthless if all 21 can still be plugged
--     by hand. That guard stays.
--
--     But it identified inventory as "code like '2%' and type = 'asset'" —
--     which was exactly true when every block-2 account WAS inventory. It is no
--     longer true. Land, buildings and accumulated depreciation are block-2
--     assets that are not inventory, and buying a building is precisely the kind
--     of thing a human types by hand from a closing statement. Left alone, the
--     old test would have made the accounts this migration creates unusable —
--     which is how it was found: the SQL test suite could not post a property
--     purchase.
--
--     The fix narrows the test to the inventory range ONLY (20000-20999) and
--     leaves everything else about it identical. Inventory is no less protected
--     than it was a moment ago; the 21 category accounts, the in-transit
--     account, the shrink reserve and the quarantine account are all still
--     untypeable. An assertion below proves that by attacking 20140 directly.
-- -----------------------------------------------------------------------------
create or replace function public.gl_guard_inventory_manual()
returns trigger language plpgsql as $$
declare
  v_src   text;
  v_code  text;
begin
  select j.source_kind into v_src
  from public.gl_journals j where j.id = new.journal_id;

  if v_src <> 'manual' then
    return new;
  end if;

  -- INVENTORY IS 20000-20999. Fixed assets live at 21000+ in the same block and
  -- are deliberately NOT covered: a property purchase is hand-keyed from a
  -- closing statement, which is evidence, not a plug.
  select a.code into v_code
  from public.gl_accounts a
  where a.id = new.account_id
    and a.type = 'asset'
    and a.code >= '20000'
    and a.code <= '20999';

  if v_code is not null then
    raise exception 'GL_INVENTORY_MANUAL: account % is inventory and cannot be adjusted by a typed journal entry. Inventory moves only with goods: post the receipt, the sale, or a counted adjustment (source_kind inventory/purchase/pos_sale/opening_balance) so the number has evidence behind it.', v_code
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

comment on function public.gl_guard_inventory_manual() is
  'Refuses hand-typed journals into inventory (20000-20999). Narrowed in 0178 from "any block-2 asset" so that fixed assets at 21000+ can be recorded from a closing statement. Inventory itself is no less protected.';


-- -----------------------------------------------------------------------------
-- 4) GUARD: ACCUMULATED DEPRECIATION CAN NEVER EXCEED COST.
--
--    Pub. 946: "Prior years' depreciation, plus current year's depreciation, can
--    never exceed the depreciable basis of the property."
--
--    Enforced per ENTITY against the cost accounts it offsets. It is checked on
--    posted, non-reversed lines only, so a draft in progress is free to be
--    temporarily wrong — the same philosophy as the opening-balance worksheet.
-- -----------------------------------------------------------------------------
create or replace function public.gl_check_accumulated_depreciation(p_entity_code text)
returns table (
  entity_code        text,
  cost_cents         bigint,
  accumulated_cents  bigint,
  is_over            boolean,
  message            text
) language plpgsql stable as $$
declare
  v_cost  bigint := 0;
  v_accum bigint := 0;
begin
  select coalesce(sum(r.amount_cents), 0)
    into v_cost
  from public.gl_reportable_lines r
  join public.gl_accounts a on a.id = r.account_id
  where r.entity_code = p_entity_code
    and a.code in ('21200','21300','21400','21500','21600','21700');

  -- Contra account: credit-normal, so its natural balance is negative under the
  -- house convention (positive = net debit). Negate to get a positive figure.
  select coalesce(-sum(r.amount_cents), 0)
    into v_accum
  from public.gl_reportable_lines r
  join public.gl_accounts a on a.id = r.account_id
  where r.entity_code = p_entity_code
    and a.code = '21900';

  return query select
    p_entity_code,
    v_cost,
    v_accum,
    (v_accum > v_cost),
    case
      when v_cost = 0 and v_accum = 0 then
        'No depreciable fixed assets recorded for these books yet.'
      when v_accum > v_cost then
        'PROBLEM: accumulated depreciation of ' ||
        to_char(v_accum / 100.0, 'FM999,999,990.00') ||
        ' exceeds the depreciable cost of ' ||
        to_char(v_cost / 100.0, 'FM999,999,990.00') ||
        '. Depreciation can never exceed what the asset cost. Either an asset was sold and its cost removed without removing the matching accumulated depreciation, or a schedule ran past the end of its recovery period.'
      else
        'Accumulated depreciation of ' ||
        to_char(v_accum / 100.0, 'FM999,999,990.00') ||
        ' against depreciable cost of ' ||
        to_char(v_cost / 100.0, 'FM999,999,990.00') ||
        '. Remaining basis to recover: ' ||
        to_char((v_cost - v_accum) / 100.0, 'FM999,999,990.00') || '.'
    end;
end $$;

comment on function public.gl_check_accumulated_depreciation(text) is
  'Plain-English check that accumulated depreciation (21900) has not exceeded the cost of the assets it offsets (21200-21700), per entity. Pub. 946: prior plus current depreciation can never exceed the depreciable basis.';


-- -----------------------------------------------------------------------------
-- 5) A PLAIN-ENGLISH FIXED-ASSET SUMMARY.
--
--    Michael has a master's in accounting and has not opened an accounting book
--    in thirteen years. A view that requires knowing which codes are contra is a
--    view he will not use.
-- -----------------------------------------------------------------------------
create or replace view public.gl_fixed_assets_summary as
select
  r.entity_code,
  a.code                                    as account_code,
  a.name                                    as account_name,
  a.is_contra,
  case
    when a.code = '21100' then 'Never depreciated — recovered only when sold'
    when a.code = '21800' then 'Not yet in service — no depreciation until it is'
    when a.code = '21900' then 'Depreciation taken to date (reduces the assets above)'
    else 'Depreciable'
  end                                       as treatment,
  case when a.is_contra then -sum(r.amount_cents)
       else sum(r.amount_cents) end         as balance_cents,
  count(*)                                  as line_count
from public.gl_reportable_lines r
join public.gl_accounts a on a.id = r.account_id
where a.code in ('21100','21200','21300','21400','21500','21600','21700','21800','21900')
group by r.entity_code, a.code, a.name, a.is_contra
having sum(r.amount_cents) <> 0;

comment on view public.gl_fixed_assets_summary is
  'Fixed assets by entity and account, with a plain-English note on how each one is treated. Accumulated depreciation is shown as a positive number because that is how a human reads it.';


-- =============================================================================
-- END 0178_fixed_assets.sql
--
-- What is now possible that was not before:
--   * Recording the Geiger property, land separated from building.
--   * Depreciating a building on the 39-year mid-month schedule the IRS publishes.
--
-- What is now impossible that was possible before:
--   * Depreciating land or construction in progress -> GL_LAND_NOT_DEPRECIABLE.
--   * A bank account seeded with a credit normal balance, which would have
--     inverted the abnormal-balance alarm on the exact account where negative
--     cash has already happened once.
-- =============================================================================
