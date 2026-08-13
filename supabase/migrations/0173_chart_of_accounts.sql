-- =============================================================================
-- 0173_chart_of_accounts.sql  (Slice F2)
--
-- Fills the empty gl_accounts table created by 0172, and adds the machinery that
-- lets the bank/card feeds DRAFT a classification for the owner to approve.
--
-- WHY THIS CHART LOOKS THE WAY IT DOES
-- ------------------------------------
-- Measured from Michael's own Sage exports (not assumed):
--   * 8 of 11 inventory accounts held CREDIT balances — impossible for an asset —
--     summing to -4,388,348.06.
--   * "20009 LAZY INVENTORY ENTRY" held +4,624,697.31: 105.4% of that hole.
--   * 511 of 595 purchase lines (86%, $479,303.51) posted to that one account.
--   * 164 of 492 vendors defaulted to it; 145 had no default account at all.
--   * 18 accounts were tagged "GRWNY" — a typo of "GRNWY" — which silently
--     dropped the whole payroll-expense block out of suffix-filtered reports.
--
-- Root cause (confirmed by the owner): Sage demanded an inventory ITEM per lot
-- code before goods could be received. Cannabis has no UPCs and every intake
-- carries its own lot code, so per-SKU setup was impossible at volume. And
-- twelve years of mis-computed 37% excise were cleared by debiting A/P and
-- crediting REVENUE, because there was nowhere else to put it. The plug was the
-- single number that hid both problems. It was software failure, not negligence.
--
-- DESIGN RULES
--   1. The code answers WHAT. Dimensions answer WHO/WHERE/WHICH. Entity,
--      employee, vendor, card, ticker, lot and month are dimensions — never
--      codes. (Deloitte: a derivable segment must not be its own segment.)
--   2. Inventory is split across all 21 house categories, mirrored into revenue
--      and COGS on the same last-four digits, so margin by category is a
--      subtraction. Lot/strain/vendor/SKU live in the subledger: intake creates
--      a LOT, not an account, so the chart stops growing.
--   3. Nothing classifies itself. Suggestions are drafts; proposed accounts
--      cannot be posted to. Owner directive: "block everything, gate everything."
--
-- LEGAL GROUNDING
--   * RCW 69.50.535(1)(a): 37% cannabis excise, "not part of the total retail
--     price" for state/local sales tax.
--   * RCW 69.50.535(4): the tax "must be paid by the buyer to the seller" and is
--     "deemed to be held IN TRUST by the seller until paid to the board."
--     => Excise is NEVER revenue and NEVER an expense. It is a trust liability.
--   * WA DOR (Cannabis retailers): the 37% is excluded from the selling price
--     for B&O and retail sales tax.
--   * Regs. 1.471-3(b) (resellers): inventoriable cost = invoice price less
--     trade discounts, plus freight-in and costs of acquiring/preparing goods.
--   * CCA 201504011: a 280E taxpayer may capitalize only costs includible under
--     Sec. 471 as it existed in 1982; §263A cannot change a cost's character.
--
-- Money: integer CENTS. Rates/confidence: integer MILLI-PERCENT (85% = 85000).
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- Applied MANUALLY by the owner.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Extend gl_accounts with the two columns F2 needs.
--    0172 shipped gl_accounts deliberately EMPTY; these are additive and safe.
-- -----------------------------------------------------------------------------

-- The default 280E character for lines hitting this account, so the owner is not
-- re-deciding the tax nature of a dollar on every single transaction.
alter table public.gl_accounts
  add column if not exists default_cost_class text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gl_accounts_default_cost_class_chk'
  ) then
    alter table public.gl_accounts
      add constraint gl_accounts_default_cost_class_chk
      check (default_cost_class in ('cogs_direct','cogs_allocable','nondeductible_280e',
                                    'separate_business','personal','none'));
  end if;
end $$;

-- Links an inventory/revenue/COGS account to the house product category it
-- represents, so the POS and the subledger can resolve an account WITHOUT
-- anyone hand-typing a code (the "GRWNY" class of bug).
alter table public.gl_accounts
  add column if not exists category_slug text;

create index if not exists gl_accounts_category_slug_idx
  on public.gl_accounts (category_slug) where category_slug is not null;

create index if not exists gl_accounts_parent_code_idx
  on public.gl_accounts (parent_code) where parent_code is not null;

-- -----------------------------------------------------------------------------
-- 1) STRUCTURAL GUARDS on gl_accounts.
--    These make whole classes of Michael's historical mistakes unrepresentable.
-- -----------------------------------------------------------------------------

-- 1a. The code must be exactly five digits. No entity suffixes, ever: the suffix
--     WAS the bug (four "ACCOUNTS PAYABLE" accounts, 18 typo'd to "GRWNY").
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_accounts_code_shape_chk') then
    alter table public.gl_accounts
      add constraint gl_accounts_code_shape_chk check (code ~ '^[1-9][0-9]{4}$');
  end if;
end $$;

-- 1b. THE BLOCK/TYPE FIREWALL.
--     Block 1-2 = assets, 3 = liabilities, 4 = equity, 5 = revenue, 6 = COGS,
--     7 = expenses, 8 = other income/expense, 9 = statistical.
--     This is the rule that makes "credit the excise true-up to REVENUE"
--     impossible rather than merely discouraged: a liability cannot wear a
--     5xxxx code, and 5xxxx is the only place revenue can live.
create or replace function public.gl_block_allows_type(p_code text, p_type text)
returns boolean language sql immutable as $$
  select case left(p_code, 1)
    when '1' then p_type = 'asset'
    when '2' then p_type = 'asset'
    when '3' then p_type = 'liability'
    when '4' then p_type = 'equity'
    when '5' then p_type = 'income'
    when '6' then p_type = 'cogs'
    when '7' then p_type = 'expense'
    when '8' then p_type in ('other_income','other_expense')
    when '9' then p_type = 'expense'
    else false
  end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_accounts_block_type_chk') then
    alter table public.gl_accounts
      add constraint gl_accounts_block_type_chk
      check (public.gl_block_allows_type(code, type));
  end if;
end $$;

-- 1c. A balance-sheet account may not carry a 280E default. Mirrors the
--     GL_COST_CLASS_NOT_ALLOWED rule that 0172 enforces at post time.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_accounts_bs_no_cost_class_chk') then
    alter table public.gl_accounts
      add constraint gl_accounts_bs_no_cost_class_chk
      check ( type not in ('asset','liability','equity') or default_cost_class = 'none' );
  end if;
end $$;

-- 1c-2. A COGS ACCOUNT MAY NOT BE DECLARED NON-DEDUCTIBLE.
--    Under Sec. 280E a cannabis seller gets no deductions, but COGS is not a
--    deduction at all -- it is an adjustment in arriving at gross income
--    (Regs. 1.61-3(a); *Rodriguez*). So the two ideas are mutually exclusive: a
--    cost is either includible in inventory under Sec. 471 as it stood in 1982
--    (CCA 201504011), or it is a disallowed deduction. It cannot be both.
--
--    An account carrying both labels is the single most dangerous row that could
--    exist in this chart: it invites a return that claims a 280E-disallowed cost
--    inside cost of goods sold, which is precisely the position the IRS attacks
--    and wins. The database refuses to let that row exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_accounts_cogs_cost_class_chk') then
    alter table public.gl_accounts
      add constraint gl_accounts_cogs_cost_class_chk
      check (
        type <> 'cogs'
        or default_cost_class in ('cogs_direct','cogs_allocable')
      );
  end if;
end $$;

-- 1c-1. AN ACCOUNT MUST HAVE A REAL NAME.
--    A blank or whitespace-only name produces a chart with an unlabelled row in
--    it, and an unlabelled row is where money goes to hide. Two characters is a
--    deliberately low bar: the point is to refuse nothing, not to police style.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_accounts_name_not_blank_chk') then
    alter table public.gl_accounts
      add constraint gl_accounts_name_not_blank_chk
      check (length(btrim(name)) >= 2);
  end if;
end $$;

-- 1c-3. REVENUE IS NOT A DEDUCTION, SO IT CARRIES NO 280E CHARACTER.
--    Sec. 280E denies "any deduction or credit". It says nothing about income,
--    because income is not deducted -- it is the thing deductions are subtracted
--    FROM. Requiring a 280E class on a sales account would force the owner to
--    answer a meaningless question on every single sale, and a meaningless
--    question answered a thousand times a day becomes a meaningless answer.
--
--    (This constraint was added because the first cut of this migration DID set
--    requires_cost_class on all 27 revenue accounts. It survived review and was
--    caught only by executing a real sale against real PostgreSQL.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gl_accounts_income_no_cost_class_chk') then
    alter table public.gl_accounts
      add constraint gl_accounts_income_no_cost_class_chk
      check (
        type not in ('income','other_income')
        or (requires_cost_class = false and default_cost_class = 'none')
      );
  end if;
end $$;

-- 1d. A child must roll up inside its own block, so number ranges really are the
--     report hierarchy.
create or replace function public.gl_guard_account_parent()
returns trigger language plpgsql as $$
begin
  if new.parent_code is not null then
    if new.parent_code = new.code then
      raise exception 'GL_ACCOUNT_PARENT: account % cannot be its own parent', new.code
        using errcode = 'raise_exception';
    end if;
    if left(new.parent_code, 1) <> left(new.code, 1) then
      raise exception 'GL_ACCOUNT_PARENT: account % cannot roll up to % — a child must live in its parent''s block', new.code, new.parent_code
        using errcode = 'raise_exception';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists gl_accounts_guard_parent on public.gl_accounts;
create trigger gl_accounts_guard_parent
  before insert or update on public.gl_accounts
  for each row execute function public.gl_guard_account_parent();

-- 1e. RENUMBERING GUARD. Once an account carries posted history its code is
--     frozen. Deloitte's rule: never renumber a live chart. Retire instead.
create or replace function public.gl_guard_account_recode()
returns trigger language plpgsql as $$
begin
  if new.code is distinct from old.code then
    if exists (
      select 1 from public.gl_journal_lines l
      join public.gl_journals j on j.id = l.journal_id
      where l.account_id = old.id and j.status = 'posted'
    ) then
      raise exception 'GL_ACCOUNT_IMMUTABLE: account % has posted history and cannot be renumbered — deactivate it and create a new account instead', old.code
        using errcode = 'raise_exception';
    end if;
  end if;

  -- A system account is structural; it may not be renamed or deleted by a user.
  if old.is_system and (new.is_system is distinct from old.is_system) then
    raise exception 'GL_ACCOUNT_IMMUTABLE: account % is a system account; is_system cannot be cleared', old.code
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_accounts_guard_recode on public.gl_accounts;
create trigger gl_accounts_guard_recode
  before update on public.gl_accounts
  for each row execute function public.gl_guard_account_recode();

-- 1d-2. THE "GRWNY" GUARD. Every entity code an account is restricted to must
--    actually name a real ledger entity.
--
--    THIS IS NOT HYPOTHETICAL. In the live Sage chart, 18 accounts were tagged
--    "GRWNY" -- a transposition of "GRNWY" -- and among them was the entire
--    payroll-expense block. Nothing errored. Nothing turned red. Those accounts
--    simply stopped appearing in any report filtered by entity, and stayed
--    invisible for years. A silent wrong answer is worse than a loud failure,
--    because nobody goes looking for it.
--
--    allowed_entity_codes is a text array, so a plain foreign key cannot cover
--    it. A trigger can, and does: an unknown code is now refused at write time,
--    naming the entities that do exist so the fix is obvious.
create or replace function public.gl_guard_account_entity_codes()
returns trigger language plpgsql as $$
declare
  v_bad   text;
  v_known text;
begin
  if new.allowed_entity_codes is null then
    return new;
  end if;

  if array_length(new.allowed_entity_codes, 1) is null then
    raise exception 'GL_ENTITY_UNKNOWN: account % has an empty entity restriction. Use NULL to mean "any entity", never an empty list, which would forbid every entity and silently hide the account.', new.code
      using errcode = 'raise_exception';
  end if;

  select c into v_bad
  from unnest(new.allowed_entity_codes) as c
  where not exists (select 1 from public.gl_entities e where e.code = c)
  limit 1;

  if v_bad is not null then
    select string_agg(code, ', ' order by code) into v_known from public.gl_entities;
    raise exception 'GL_ENTITY_UNKNOWN: account % is restricted to entity "%" which does not exist. Known entities: %. (This is the "GRWNY" class of bug: a mistyped entity code silently removes an account from every filtered report.)', new.code, v_bad, v_known
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_accounts_guard_entity_codes on public.gl_accounts;
create trigger gl_accounts_guard_entity_codes
  before insert or update on public.gl_accounts
  for each row execute function public.gl_guard_account_entity_codes();

-- 1e-2. INVENTORY MAY NOT BE TYPED. Only evidenced subledger activity moves it.
--
--    0172 already refuses manual entries into CONTROL accounts, which protects
--    the 20000 parent. But the 21 per-category accounts beneath it are ordinary
--    postable accounts, and that is a back door wide enough to drive the entire
--    original problem through: "LAZY INVENTORY ENTRY" was a hand-typed number.
--    Splitting one anonymous bucket into 21 named buckets is worthless if all 21
--    can still be plugged by hand.
--
--    So: a journal whose source_kind is 'manual' may not touch ANY inventory
--    account. Inventory moves when goods move -- a receipt, a sale, a documented
--    count adjustment, or the cut-over opening balance -- and each of those
--    arrives with its own source_kind and its own evidence.
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

  select a.code into v_code
  from public.gl_accounts a
  where a.id = new.account_id
    and a.code like '2%'
    and a.type = 'asset';

  if v_code is not null then
    raise exception 'GL_INVENTORY_MANUAL: account % is inventory and cannot be adjusted by a typed journal entry. Inventory moves only with goods: post the receipt, the sale, or a counted adjustment (source_kind inventory/purchase/pos_sale/opening_balance) so the number has evidence behind it.', v_code
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_journal_lines_guard_inventory on public.gl_journal_lines;
create trigger gl_journal_lines_guard_inventory
  before insert or update on public.gl_journal_lines
  for each row execute function public.gl_guard_inventory_manual();

-- 1f. An account that has ever been posted to may not be DELETED. Deactivate.
create or replace function public.gl_guard_account_delete()
returns trigger language plpgsql as $$
begin
  if old.is_system then
    raise exception 'GL_ACCOUNT_IMMUTABLE: account % is a system account and cannot be deleted', old.code
      using errcode = 'raise_exception';
  end if;
  if exists (select 1 from public.gl_journal_lines l where l.account_id = old.id) then
    raise exception 'GL_ACCOUNT_IN_USE: account % has journal history and cannot be deleted — set active = false instead', old.code
      using errcode = 'raise_exception';
  end if;
  return old;
end $$;

drop trigger if exists gl_accounts_guard_delete on public.gl_accounts;
create trigger gl_accounts_guard_delete
  before delete on public.gl_accounts
  for each row execute function public.gl_guard_account_delete();

-- -----------------------------------------------------------------------------
-- 2) THE CHART.
--    Seeded via a helper so every row goes through the same validation, and so
--    re-running the migration updates descriptions without disturbing history.
-- -----------------------------------------------------------------------------

create or replace function public.gl_upsert_account(
  p_code text, p_name text, p_type text,
  p_is_contra boolean default false,
  p_is_control boolean default false,
  p_control_subledger text default null,
  p_requires_cost_class boolean default false,
  p_default_cost_class text default 'none',
  p_allowed_entity_codes text[] default null,
  p_is_system boolean default false,
  p_parent_code text default null,
  p_category_slug text default null,
  p_description text default null
) returns uuid language plpgsql as $$
declare
  v_normal text;
  v_id     uuid;
begin
  -- Normal balance is DERIVED, never hand-typed, then flipped for contra.
  v_normal := case when p_type in ('asset','cogs','expense','other_expense') then 'debit' else 'credit' end;
  if p_is_contra then
    v_normal := case when v_normal = 'debit' then 'credit' else 'debit' end;
  end if;

  insert into public.gl_accounts (
    code, name, type, normal_balance, is_contra, is_control, control_subledger,
    requires_cost_class, default_cost_class, allowed_entity_codes, is_system,
    parent_code, category_slug, description
  ) values (
    p_code, p_name, p_type, v_normal, p_is_contra, p_is_control, p_control_subledger,
    p_requires_cost_class, p_default_cost_class, p_allowed_entity_codes, p_is_system,
    p_parent_code, p_category_slug, p_description
  )
  on conflict (code) do update set
    name                 = excluded.name,
    type                 = excluded.type,
    normal_balance       = excluded.normal_balance,
    is_contra            = excluded.is_contra,
    is_control           = excluded.is_control,
    control_subledger    = excluded.control_subledger,
    requires_cost_class  = excluded.requires_cost_class,
    default_cost_class   = excluded.default_cost_class,
    allowed_entity_codes = excluded.allowed_entity_codes,
    is_system            = excluded.is_system,
    parent_code          = excluded.parent_code,
    category_slug        = excluded.category_slug,
    description          = excluded.description,
    updated_at           = now()
  returning id into v_id;

  return v_id;
end $$;

-- The 183 seed rows run inside a single DO block so the migration prints NOTHING
-- on success. Emitting 183 UUID result sets into the Supabase SQL editor would
-- bury a genuine error in the middle of a wall of noise, and this file is pasted
-- in by hand. Silence on success is a feature: anything that appears is a problem.
do $seed$
begin
  -- ============================ BLOCK 1 — CASH & CURRENT ASSETS ================
  perform public.gl_upsert_account('10000','Cash & Cash Equivalents','asset',
    false,false,null,false,'none',null,true,null,null,
    'Parent. Cash is a CONTROL family: balances come from the connected bank feeds, not from typing.');
  perform public.gl_upsert_account('10100','Cash on Hand — Vault','asset',
    false,false,null,false,'none',array['greenway'],false,'10000',null,
    'Physical currency in the safe. Counted, not asserted.');
  perform public.gl_upsert_account('10110','Cash on Hand — Tills','asset',
    false,false,null,false,'none',array['greenway'],false,'10000',null,
    'All register tills. WHICH till is a dimension — the old chart had one account per till.');
  perform public.gl_upsert_account('10200','Bank — Operating','asset',
    true,true,'cash',false,'none',null,false,'10000',null,
    'CONTROL: reconciled to the Plaid feed. Which bank/account is a Plaid dimension.');
  perform public.gl_upsert_account('10300','Bank — ATM Vault Account','asset',
    true,true,'cash',false,'none',array['atm','greenway'],false,'10000',null,
    'CONTROL. The old 12000 ATM CASH BALANCE had drifted to -45,230.00 — negative cash, impossible. Re-derived from evidence at cut-over.');
  perform public.gl_upsert_account('10400','Undeposited Funds','asset',
    false,false,null,false,'none',null,false,'10000',null,
    'Money collected but not yet in the bank. Kept honest by the feed.');
  perform public.gl_upsert_account('10900','Cash — Clearing / In Transit','asset',
    false,false,null,false,'none',null,false,'10000',null,
    'Transfers in flight between own accounts. Must clear to zero at close.');

  perform public.gl_upsert_account('12000','Other Current Assets','asset',
    false,false,null,false,'none',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('12100','Employee Advances Receivable','asset',
    false,false,null,false,'none',null,false,'12000',null,
    'Governed home for employee advances. Opens at ZERO: the old 11001 ISANA - LOAN was repaid in full. Owner policy going forward is no informal lending without counsel and proper recording.');
  perform public.gl_upsert_account('12200','Prepaid Expenses','asset',
    false,false,null,false,'none',null,false,'12000',null,'Prepaid insurance, licences, subscriptions.');
  perform public.gl_upsert_account('12300','Excise Tax Receivable / Overpayment','asset',
    false,false,null,false,'none',array['greenway'],false,'12000',null,
    'Where a genuine LCB overpayment lives. Twelve years of mis-computed excise had nowhere to go and ended up credited to revenue; this is the honest home.');

  -- ============================ BLOCK 2 — INVENTORY ============================
  -- 20000 is a CONTROL account. Under 0172 check (6), a manual journal touching a
  -- control account raises GL_CONTROL_ACCOUNT. THIS IS WHAT MAKES THE $4.62M PLUG
  -- STRUCTURALLY IMPOSSIBLE — not discouraged, impossible.
  perform public.gl_upsert_account('20000','Inventory — Cannabis (control)','asset',
    false,true,'inventory',false,'none',array['greenway'],true,null,null,
    'CONTROL. Only the inventory subledger may move this. Manual entry raises GL_CONTROL_ACCOUNT. Replaces 20009 LAZY INVENTORY ENTRY (+4,624,697.31), which existed only to offset -4,388,348.06 of impossible negative category balances.');

  -- The 21 house categories, from src/lib/pos/category-taxonomy.ts — the taxonomy
  -- that already drives the POS, the menu and intake. Not invented here.
  -- Owner: "I want every category to be mapped and recorded separately."
  perform public.gl_upsert_account('20010','Inventory — Flower','asset',false,false,null,false,'none',array['greenway'],false,'20000','flower',null);
  perform public.gl_upsert_account('20020','Inventory — Popcorn Bud','asset',false,false,null,false,'none',array['greenway'],false,'20000','popcorn-bud',null);
  perform public.gl_upsert_account('20030','Inventory — Infused Flower','asset',false,false,null,false,'none',array['greenway'],false,'20000','infused-flower',null);
  perform public.gl_upsert_account('20040','Inventory — Trim','asset',false,false,null,false,'none',array['greenway'],false,'20000','trim',null);
  perform public.gl_upsert_account('20050','Inventory — Preroll','asset',false,false,null,false,'none',array['greenway'],false,'20000','preroll',null);
  perform public.gl_upsert_account('20060','Inventory — Preroll Pack','asset',false,false,null,false,'none',array['greenway'],false,'20000','preroll-pack',null);
  perform public.gl_upsert_account('20070','Inventory — Blunt','asset',false,false,null,false,'none',array['greenway'],false,'20000','blunt',null);
  perform public.gl_upsert_account('20080','Inventory — Infused Preroll','asset',false,false,null,false,'none',array['greenway'],false,'20000','infused-preroll',null);
  perform public.gl_upsert_account('20090','Inventory — Infused Preroll Pack','asset',false,false,null,false,'none',array['greenway'],false,'20000','infused-preroll-pack',null);
  perform public.gl_upsert_account('20100','Inventory — Infused Blunt','asset',false,false,null,false,'none',array['greenway'],false,'20000','infused-blunt',null);
  perform public.gl_upsert_account('20120','Inventory — Cartridge','asset',false,false,null,false,'none',array['greenway'],false,'20000','cartridge',null);
  perform public.gl_upsert_account('20130','Inventory — Disposable Cartridge','asset',false,false,null,false,'none',array['greenway'],false,'20000','disposable-cartridge',null);
  perform public.gl_upsert_account('20140','Inventory — Concentrate','asset',false,false,null,false,'none',array['greenway'],false,'20000','concentrate',null);
  perform public.gl_upsert_account('20150','Inventory — RSO','asset',false,false,null,false,'none',array['greenway'],false,'20000','rso',null);
  perform public.gl_upsert_account('20160','Inventory — Edible (Solid)','asset',false,false,null,false,'none',array['greenway'],false,'20000','edible-solid',null);
  perform public.gl_upsert_account('20170','Inventory — Edible (Liquid)','asset',false,false,null,false,'none',array['greenway'],false,'20000','edible-liquid',null);
  perform public.gl_upsert_account('20180','Inventory — Tincture','asset',false,false,null,false,'none',array['greenway'],false,'20000','tincture',null);
  perform public.gl_upsert_account('20190','Inventory — Topical','asset',false,false,null,false,'none',array['greenway'],false,'20000','topical',null);

  -- Non-cannabis inventory. Separate because it is NOT 280E product.
  perform public.gl_upsert_account('20200','Inventory — Accessories','asset',false,false,null,false,'none',array['greenway'],false,'20000','accessories',
    'Not cannabis: costs and margin behave differently and 280E does not reach this trade the same way.');
  perform public.gl_upsert_account('20210','Inventory — Paraphernalia','asset',false,false,null,false,'none',array['greenway'],false,'20000','paraphernalia',null);
  perform public.gl_upsert_account('20220','Inventory — Greenway Merch','asset',false,false,null,false,'none',array['greenway'],false,'20000','merch',null);

  perform public.gl_upsert_account('20800','Inventory — In Transit','asset',
    false,false,null,false,'none',array['greenway'],false,'20000',null,
    'Received not invoiced, or invoiced not received. Visible instead of absorbed.');
  perform public.gl_upsert_account('20810','Inventory Shrink / Waste Reserve','asset',
    true,false,null,false,'none',array['greenway'],false,'20000',null,
    'Contra-asset for shrink and destruction. A reserve is an estimate that gets DOCUMENTED, not a plug.');
  perform public.gl_upsert_account('20890','Inventory — UNCLASSIFIED (quarantine)','asset',
    false,false,null,false,'none',array['greenway'],false,'20000',null,
    'Intake that cannot be mapped to a category lands here VISIBLY and nags until resolved. Replaces both 20010 NO CATEGORY and, in spirit, the plug: a number the owner watches rather than a number that hides things. A non-zero balance is a to-do list.');

  -- ============================ BLOCK 3 — LIABILITIES ==========================
  perform public.gl_upsert_account('30000','Accounts Payable','liability',
    false,true,'ap',false,'none',null,true,null,null,
    'CONTROL, entity-agnostic. Replaces 30000-GRNWY / 34000-GRWYE / 35000-LYMAN: entity is a dimension, so one A/P serves all four sets of books and can finally be compared.');

  perform public.gl_upsert_account('31000','Accrued Payroll','liability',
    false,true,'payroll',false,'none',null,true,null,null,
    'CONTROL. Replaces all 23 per-employee payable accounts (30001-30022). Employee is a payroll-subledger dimension; the GL does not grow when staff change, and names stay out of the financials.');
  perform public.gl_upsert_account('31100','Payroll Taxes Payable — Employee Withheld','liability',
    false,true,'payroll',false,'none',null,false,'31000',null,'Trust money withheld from employees.');
  perform public.gl_upsert_account('31200','Payroll Taxes Payable — Employer','liability',
    false,true,'payroll',false,'none',null,false,'31000',null,'Employer FICA, FUTA, SUTA, L&I, PFML, WA Cares.');
  perform public.gl_upsert_account('31300','Garnishments & Child Support Payable','liability',
    false,false,null,false,'none',null,false,'31000',null,'Court-ordered withholding held for remittance.');

  -- TRUST-FUND TAXES. RCW 69.50.535(4): excise is "deemed to be held in trust by
  -- the seller until paid to the board." It is not revenue and not an expense.
  perform public.gl_upsert_account('32000','Cannabis Excise Tax Payable (37%) — TRUST','liability',
    false,true,'excise',false,'none',array['greenway'],true,null,null,
    'CONTROL + TRUST. RCW 69.50.535(4): paid by the buyer to the seller and held IN TRUST until paid to the LCB. Never revenue, never an expense. Booking it as revenue overstates gross receipts by 37% and then needs a deduction that 280E disallows. The old 50009 EXCISE TAX ADJUSTMENTS sat in the revenue block; it is retired.');
  perform public.gl_upsert_account('32100','Retail Sales Tax Payable — TRUST','liability',
    false,true,'excise',false,'none',null,true,null,null,
    'CONTROL + TRUST. Collected for the Department of Revenue. Per WA DOR the 37% excise is excluded from the selling price this is computed on.');
  perform public.gl_upsert_account('32200','B&O Tax Payable','liability',
    false,false,null,false,'none',null,false,null,null,
    'A real tax ON Greenway (Retailing classification), not trust money — so it is a liability with an expense side, unlike excise and sales tax.');

  perform public.gl_upsert_account('33000','Credit Cards Payable','liability',
    false,true,'cash',false,'none',null,true,null,null,
    'CONTROL, reconciled to the Plaid feed. WHICH card is a dimension. The owner has been de-banked repeatedly, so cards change often — exactly why per-card accounts must not proliferate.');
  perform public.gl_upsert_account('34000','Notes & Loans Payable','liability',
    false,true,'loans',false,'none',null,true,null,null,
    'CONTROL, driven by the loan subledger and its amortization schedule.');
  perform public.gl_upsert_account('35000','Accrued Liabilities','liability',
    false,false,null,false,'none',null,false,null,null,'Accrued but unbilled obligations.');
  perform public.gl_upsert_account('36000','Due To / From Related Entity','liability',
    false,false,null,false,'none',null,true,null,null,
    'Intercompany between greenway / atm / landholding / personal. Must net to ZERO across all four on consolidation — a standing close check.');

  -- ============================ BLOCK 4 — EQUITY ===============================
  perform public.gl_upsert_account('40000','Owner Equity','equity',
    false,false,null,false,'none',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('40100','Common Stock / Members Capital','equity',
    false,false,null,false,'none',null,true,'40000',null,null);
  perform public.gl_upsert_account('40200','Additional Paid-In Capital','equity',
    false,false,null,false,'none',null,false,'40000',null,null);
  perform public.gl_upsert_account('40300','Retained Earnings','equity',
    false,false,null,false,'none',null,true,'40000',null,
    'ONE retained earnings account. The old chart had 40000/40001/40002/40003 split by shareholder name (LYMAN / MULLAN / BECKER); shareholder is now a dimension on the journal line (gl_shareholders), verified 85/10/5 against K-1 transcripts.');
  perform public.gl_upsert_account('40400','Opening Balance Equity','equity',
    false,false,null,false,'none',null,true,'40000',null,
    'SYSTEM. Holds the cut-over opening entry only, and must return to ZERO once every opening balance is evidenced. A permanent balance here means the cut-over is unfinished.');
  perform public.gl_upsert_account('41000','Shareholder Distributions','equity',
    true,false,null,false,'none',null,true,'40000',null,
    'Contra-equity. WHICH shareholder is a dimension (shareholder_id), not an account. Note his mother is allocated income but takes no distributions.');
  perform public.gl_upsert_account('41100','Shareholder Contributions','equity',
    false,false,null,false,'none',null,true,'40000',null,
    'Capital in. Replaces 42000 BUEHLER - CONTRIBUTIONS, which was personal (an aunt, tied to a lake cabin the owner no longer holds) and never belonged in the business books.');

  -- ============================ BLOCK 5 — REVENUE ==============================
  -- Mirrors block 2 on the same last four digits: 20140 / 50140 / 60140.
  perform public.gl_upsert_account('50000','Sales — Cannabis','income',
    false,false,null,false,'none',array['greenway'],true,null,null,
    'Parent. Revenue is recognised NET of the 37% excise, which is trust money and never passes through here.');
  perform public.gl_upsert_account('50010','Sales — Flower','income',false,false,null,false,'none',array['greenway'],false,'50000','flower',null);
  perform public.gl_upsert_account('50020','Sales — Popcorn Bud','income',false,false,null,false,'none',array['greenway'],false,'50000','popcorn-bud',null);
  perform public.gl_upsert_account('50030','Sales — Infused Flower','income',false,false,null,false,'none',array['greenway'],false,'50000','infused-flower',null);
  perform public.gl_upsert_account('50040','Sales — Trim','income',false,false,null,false,'none',array['greenway'],false,'50000','trim',null);
  perform public.gl_upsert_account('50050','Sales — Preroll','income',false,false,null,false,'none',array['greenway'],false,'50000','preroll',null);
  perform public.gl_upsert_account('50060','Sales — Preroll Pack','income',false,false,null,false,'none',array['greenway'],false,'50000','preroll-pack',null);
  perform public.gl_upsert_account('50070','Sales — Blunt','income',false,false,null,false,'none',array['greenway'],false,'50000','blunt',null);
  perform public.gl_upsert_account('50080','Sales — Infused Preroll','income',false,false,null,false,'none',array['greenway'],false,'50000','infused-preroll',null);
  perform public.gl_upsert_account('50090','Sales — Infused Preroll Pack','income',false,false,null,false,'none',array['greenway'],false,'50000','infused-preroll-pack',null);
  perform public.gl_upsert_account('50100','Sales — Infused Blunt','income',false,false,null,false,'none',array['greenway'],false,'50000','infused-blunt',null);
  perform public.gl_upsert_account('50120','Sales — Cartridge','income',false,false,null,false,'none',array['greenway'],false,'50000','cartridge',null);
  perform public.gl_upsert_account('50130','Sales — Disposable Cartridge','income',false,false,null,false,'none',array['greenway'],false,'50000','disposable-cartridge',null);
  perform public.gl_upsert_account('50140','Sales — Concentrate','income',false,false,null,false,'none',array['greenway'],false,'50000','concentrate',null);
  perform public.gl_upsert_account('50150','Sales — RSO','income',false,false,null,false,'none',array['greenway'],false,'50000','rso',null);
  perform public.gl_upsert_account('50160','Sales — Edible (Solid)','income',false,false,null,false,'none',array['greenway'],false,'50000','edible-solid',null);
  perform public.gl_upsert_account('50170','Sales — Edible (Liquid)','income',false,false,null,false,'none',array['greenway'],false,'50000','edible-liquid',null);
  perform public.gl_upsert_account('50180','Sales — Tincture','income',false,false,null,false,'none',array['greenway'],false,'50000','tincture',null);
  perform public.gl_upsert_account('50190','Sales — Topical','income',false,false,null,false,'none',array['greenway'],false,'50000','topical',null);
  perform public.gl_upsert_account('50200','Sales — Accessories','income',false,false,null,false,'none',array['greenway'],false,'50000','accessories',null);
  perform public.gl_upsert_account('50210','Sales — Paraphernalia','income',false,false,null,false,'none',array['greenway'],false,'50000','paraphernalia',null);
  perform public.gl_upsert_account('50220','Sales — Greenway Merch','income',false,false,null,false,'none',array['greenway'],false,'50000','merch',null);

  perform public.gl_upsert_account('50900','Discounts & Comps','income',
    true,false,null,false,'none',array['greenway'],false,'50000',null,
    'Contra-revenue. Discounts REDUCE revenue; they are not an expense.');
  perform public.gl_upsert_account('50910','Returns & Refunds','income',
    true,false,null,false,'none',array['greenway'],false,'50000',null,'Contra-revenue.');
  perform public.gl_upsert_account('50920','Cash Over / (Short)','income',
    false,false,null,false,'none',array['greenway'],false,'50000',null,
    'Till variance, faced honestly and watched, rather than absorbed into a plug.');

  perform public.gl_upsert_account('51000','ATM Surcharge Income','income',
    false,false,null,false,'none',array['atm'],false,null,null,
    'Separate trade or business (CHAMP). Not cannabis revenue.');
  perform public.gl_upsert_account('52000','Rental Income','income',
    false,false,null,false,'none',array['landholding'],false,null,null,
    'Geiger property. Rents to the store and to the ATM operation — related-party, so it must be at arm''s length and documented.');

  -- ============================ BLOCK 6 — COGS =================================
  -- Under 280E, COGS is an adjustment to gross income, not a deduction, so this
  -- block is the firewall. Nothing belongs here unless Sec. 471 (as of 1982) says
  -- it is inventoriable — per CCA 201504011 and Regs. 1.471-3(b) for resellers.
  perform public.gl_upsert_account('60000','COGS — Cannabis','cogs',
    false,false,null,true,'cogs_direct',array['greenway'],true,null,null,
    'Parent. Reg. 1.471-3(b) reseller cost: invoice price less trade discounts, plus freight-in and the costs of acquiring and preparing goods for sale.');
  perform public.gl_upsert_account('60010','COGS — Flower','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','flower',null);
  perform public.gl_upsert_account('60020','COGS — Popcorn Bud','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','popcorn-bud',null);
  perform public.gl_upsert_account('60030','COGS — Infused Flower','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','infused-flower',null);
  perform public.gl_upsert_account('60040','COGS — Trim','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','trim',null);
  perform public.gl_upsert_account('60050','COGS — Preroll','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','preroll',null);
  perform public.gl_upsert_account('60060','COGS — Preroll Pack','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','preroll-pack',null);
  perform public.gl_upsert_account('60070','COGS — Blunt','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','blunt',null);
  perform public.gl_upsert_account('60080','COGS — Infused Preroll','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','infused-preroll',null);
  perform public.gl_upsert_account('60090','COGS — Infused Preroll Pack','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','infused-preroll-pack',null);
  perform public.gl_upsert_account('60100','COGS — Infused Blunt','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','infused-blunt',null);
  perform public.gl_upsert_account('60120','COGS — Cartridge','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','cartridge',null);
  perform public.gl_upsert_account('60130','COGS — Disposable Cartridge','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','disposable-cartridge',null);
  perform public.gl_upsert_account('60140','COGS — Concentrate','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','concentrate',null);
  perform public.gl_upsert_account('60150','COGS — RSO','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','rso',null);
  perform public.gl_upsert_account('60160','COGS — Edible (Solid)','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','edible-solid',null);
  perform public.gl_upsert_account('60170','COGS — Edible (Liquid)','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','edible-liquid',null);
  perform public.gl_upsert_account('60180','COGS — Tincture','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','tincture',null);
  perform public.gl_upsert_account('60190','COGS — Topical','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','topical',null);
  perform public.gl_upsert_account('60200','COGS — Accessories','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','accessories',null);
  perform public.gl_upsert_account('60210','COGS — Paraphernalia','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','paraphernalia',null);
  perform public.gl_upsert_account('60220','COGS — Greenway Merch','cogs',false,false,null,true,'cogs_direct',array['greenway'],false,'60000','merch',null);

  perform public.gl_upsert_account('60800','Freight-In / Inbound Delivery','cogs',
    false,false,null,true,'cogs_direct',array['greenway'],false,'60000',null,
    'Explicitly inventoriable under Reg. 1.471-3(b). Delivery fees on a PURCHASE capitalise; they are not an operating expense.');
  perform public.gl_upsert_account('60810','Inventory Shrink & Destruction','cogs',
    false,false,null,true,'cogs_direct',array['greenway'],false,'60000',null,
    'Documented destruction and shrink, tied to the CCRS disposition record.');
  perform public.gl_upsert_account('60900','Purchase Discounts Received','cogs',
    true,false,null,true,'cogs_direct',array['greenway'],false,'60000',null,
    'Contra-COGS. Trade discounts REDUCE inventoriable cost (Reg. 1.471-3(b)).');

  -- OWNER DECISION (Aug 2026): payroll currently classed into COGS stays there for
  -- now — the grandfather's method, pending federal rescheduling — but tagged
  -- cogs_allocable, never cogs_direct. For a RESELLER, Reg. 1.471-3(b) does not
  -- obviously reach retail salaries, so the position is kept VISIBLE and
  -- switchable rather than silently baked in. Standing rule 8: 280E relief must be
  -- a switch, not a rebuild.
  perform public.gl_upsert_account('61000','Payroll — Inventory Handling (allocable)','cogs',
    false,false,null,true,'cogs_allocable',array['greenway'],false,'60000',null,
    'REVIEW ITEM for the owner''s CPA. Tagged cogs_allocable so it can be reclassified with a query if the analysis or the law changes. Requires a documented allocation study (gl_allocation_configs) to justify the portion treated as inventoriable.');

  -- ============================ BLOCK 7 — OPERATING EXPENSES ===================
  -- Default 280E class is nondeductible_280e because these are greenway-facing.
  -- The ATM and landholding entities post to the SAME accounts and pick up
  -- separate_business via their entity; personal picks up personal.
  perform public.gl_upsert_account('70000','Occupancy','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('70010','Rent','expense',false,false,null,true,'nondeductible_280e',null,false,'70000',null,
    'ONE rent account for all four entities. The old chart had 70000-GRNWY, 80000-GRWYE and a LYMAN variant that could never be compared.');
  perform public.gl_upsert_account('70020','Utilities','expense',false,false,null,true,'nondeductible_280e',null,false,'70000',null,null);
  perform public.gl_upsert_account('70030','Repairs & Maintenance','expense',false,false,null,true,'nondeductible_280e',null,false,'70000',null,null);
  perform public.gl_upsert_account('70040','Property Tax','expense',false,false,null,true,'nondeductible_280e',null,false,'70000',null,null);
  perform public.gl_upsert_account('70050','Security & Alarm','expense',false,false,null,true,'nondeductible_280e',null,false,'70000',null,'Required by WA I-502; still non-deductible under 280E.');
  perform public.gl_upsert_account('70060','Janitorial & Waste Removal','expense',false,false,null,true,'nondeductible_280e',null,false,'70000',null,null);

  perform public.gl_upsert_account('71000','Personnel','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent. Employee identity is a payroll-subledger dimension, never an account.');
  perform public.gl_upsert_account('71010','Wages & Salaries','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,null);
  perform public.gl_upsert_account('71020','Overtime','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,null);
  perform public.gl_upsert_account('71030','Paid Sick & Leave','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,null);
  perform public.gl_upsert_account('71040','Employer Payroll Taxes','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,'FICA, FUTA, SUTA.');
  perform public.gl_upsert_account('71050','L&I / Workers Compensation','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,null);
  perform public.gl_upsert_account('71060','PFML & WA Cares','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,null);
  perform public.gl_upsert_account('71070','Employee Benefits & Insurance','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,
    'Includes the HSA plan. The mother''s premium arrangement ended when she moved to Medicare; 73002 PAYROLL - THERESA BECKER is retired.');
  perform public.gl_upsert_account('71080','Payroll Service Fees','expense',false,false,null,true,'nondeductible_280e',null,false,'71000',null,null);

  perform public.gl_upsert_account('72000','Selling & Marketing','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('72010','Advertising & Promotion','expense',false,false,null,true,'nondeductible_280e',null,false,'72000',null,'WA advertising rules are strict; keep evidence of compliance with the spend.');
  perform public.gl_upsert_account('72020','Menu & Website Listings','expense',false,false,null,true,'nondeductible_280e',null,false,'72000',null,null);
  perform public.gl_upsert_account('72030','Customer Loyalty & Comps','expense',false,false,null,true,'nondeductible_280e',null,false,'72000',null,null);

  perform public.gl_upsert_account('73000','Technology','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('73010','Software Subscriptions','expense',false,false,null,true,'nondeductible_280e',null,false,'73000',null,null);
  perform public.gl_upsert_account('73020','POS & Traceability Systems','expense',false,false,null,true,'nondeductible_280e',null,false,'73000',null,null);
  perform public.gl_upsert_account('73030','Hardware & Equipment','expense',false,false,null,true,'nondeductible_280e',null,false,'73000',null,null);
  perform public.gl_upsert_account('73040','Internet & Telephone','expense',false,false,null,true,'nondeductible_280e',null,false,'73000',null,null);

  perform public.gl_upsert_account('74000','Professional Services','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('74010','Accounting & Bookkeeping','expense',false,false,null,true,'nondeductible_280e',null,false,'74000',null,null);
  perform public.gl_upsert_account('74020','Legal','expense',false,false,null,true,'nondeductible_280e',null,false,'74000',null,null);
  perform public.gl_upsert_account('74030','Consulting & Advisory','expense',false,false,null,true,'nondeductible_280e',null,false,'74000',null,null);

  perform public.gl_upsert_account('75000','Compliance & Licensing','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('75010','Licences & Permits','expense',false,false,null,true,'nondeductible_280e',null,false,'75000',null,null);
  perform public.gl_upsert_account('75020','Product Testing','expense',false,false,null,true,'nondeductible_280e',null,false,'75000',null,null);
  perform public.gl_upsert_account('75030','Background Checks & Fingerprinting','expense',false,false,null,true,'nondeductible_280e',null,false,'75000',null,null);
  perform public.gl_upsert_account('75040','B&O Tax Expense','expense',false,false,null,true,'nondeductible_280e',null,false,'75000',null,
    'B&O is a real tax on Greenway, so it has an expense side — unlike excise and sales tax, which are trust money and never touch the P&L.');
  perform public.gl_upsert_account('75050','Regulatory Fines & Penalties','expense',false,false,null,true,'nondeductible_280e',null,false,'75000',null,'Never deductible, in any regime.');

  perform public.gl_upsert_account('76000','Office & Administration','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('76010','Office Supplies','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,null);
  perform public.gl_upsert_account('76020','Packaging & Store Supplies','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,
    'CAUTION: packaging that becomes part of the product sold may be inventoriable under Reg. 1.471-3(b). Route those to 60800/60000 instead.');
  perform public.gl_upsert_account('76030','Postage & Shipping (outbound)','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,'Outbound only. Inbound freight is 60800 and capitalises.');
  perform public.gl_upsert_account('76040','Bank Fees','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,null);
  perform public.gl_upsert_account('76050','Merchant & Payment Processing Fees','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,null);
  perform public.gl_upsert_account('76060','Insurance','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,
    'ONE insurance account. The old chart had 70019 and 70022 both named INSURANCE — classic ungoverned drift.');
  perform public.gl_upsert_account('76070','Dues & Subscriptions','expense',false,false,null,true,'nondeductible_280e',null,false,'76000',null,null);

  perform public.gl_upsert_account('77000','Vehicle & Travel','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent. WHICH vehicle is a dimension.');
  perform public.gl_upsert_account('77010','Fuel','expense',false,false,null,true,'nondeductible_280e',null,false,'77000',null,null);
  perform public.gl_upsert_account('77020','Vehicle Maintenance & Repair','expense',false,false,null,true,'nondeductible_280e',null,false,'77000',null,null);
  perform public.gl_upsert_account('77030','Travel','expense',false,false,null,true,'nondeductible_280e',null,false,'77000',null,null);
  perform public.gl_upsert_account('77040','Meals','expense',false,false,null,true,'nondeductible_280e',null,false,'77000',null,'Subject to its own limitation before 280E even applies.');

  perform public.gl_upsert_account('78000','Depreciation & Amortization','expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent.');
  perform public.gl_upsert_account('78010','Depreciation Expense','expense',false,false,null,true,'nondeductible_280e',null,false,'78000',null,null);
  perform public.gl_upsert_account('78020','Amortization Expense','expense',false,false,null,true,'nondeductible_280e',null,false,'78000',null,null);

  -- Personal living expenses. Never a business deduction; kept in the books
  -- because the owner wants one honest picture of his whole financial life.
  perform public.gl_upsert_account('79000','Personal — Living Expenses','expense',false,false,null,true,'personal',array['personal'],true,null,null,'Parent. Personal entity only.');
  perform public.gl_upsert_account('79010','Personal — Housing & Utilities','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79020','Personal — Groceries','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79030','Personal — Restaurants & Coffee','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79040','Personal — Medical & Health','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79050','Personal — Insurance','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79060','Personal — Vehicle & Fuel','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79070','Personal — Childcare & Family','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79080','Personal — Pets','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79090','Personal — Entertainment & Travel','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79100','Personal — Clothing & Personal Care','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79110','Personal — Gifts & Charity','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79120','Personal — Fees & Interest','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,null);
  perform public.gl_upsert_account('79900','Personal — Uncategorized (review)','expense',false,false,null,true,'personal',array['personal'],false,'79000',null,
    'Visible parking spot for personal spend awaiting classification. Watched, not hidden.');

  -- ============================ BLOCK 8 — OTHER INCOME & EXPENSE ===============
  perform public.gl_upsert_account('80000','Other Income','other_income',false,false,null,false,'none',null,true,null,null,'Parent. Non-operating.');
  perform public.gl_upsert_account('80010','Interest Income','other_income',false,false,null,false,'none',null,false,'80000',null,null);
  perform public.gl_upsert_account('80020','Dividend Income','other_income',false,false,null,false,'none',null,false,'80000',null,'WHICH security is a holdings dimension. The old chart had ~45 accounts, one per ticker.');
  perform public.gl_upsert_account('80030','Realized Investment Gain / (Loss)','other_income',false,false,null,false,'none',null,false,'80000',null,null);
  perform public.gl_upsert_account('80040','Unrealized Investment Gain / (Loss)','other_income',false,false,null,false,'none',null,false,'80000',null,null);
  perform public.gl_upsert_account('80050','Gain / (Loss) on Asset Disposal','other_income',false,false,null,false,'none',null,false,'80000',null,null);

  perform public.gl_upsert_account('85000','Other Expense','other_expense',false,false,null,true,'nondeductible_280e',null,true,null,null,'Parent. Non-operating.');
  perform public.gl_upsert_account('85010','Interest Expense','other_expense',false,false,null,true,'nondeductible_280e',null,false,'85000',null,null);
  perform public.gl_upsert_account('85020','Theft & Casualty Loss','other_expense',false,false,null,true,'nondeductible_280e',null,false,'85000',null,
    'ONE account. The old chart encoded the MONTH into the code (80003 THEFT/LOSS - OCTOBER, 80004 - DECEMBER). Date is the most derivable dimension there is — it is on every journal.');
  perform public.gl_upsert_account('85030','Bad Debt Expense','other_expense',false,false,null,true,'nondeductible_280e',null,false,'85000',null,null);

end $seed$;
-- =============================================================================
-- 3) THE CLASSIFIER — "draft it for me, I'll validate and audit."
-- =============================================================================

-- 3a. Learned + owner-authored rules. This is the system's MEMORY.
create table if not exists public.gl_account_rules (
  id            uuid primary key default gen_random_uuid(),

  match_kind    text not null
                  check (match_kind in ('merchant_exact','merchant_contains',
                                        'pfc_detailed','vendor','amount_recurring')),
  -- Normalized match key (upper-cased, punctuation stripped) so "Clarity Farms",
  -- "CLARITY FARMS #1234" and "clarity  farms" are one rule, not three.
  match_value   text not null check (length(btrim(match_value)) >= 2),

  account_id    uuid not null references public.gl_accounts(id) on delete restrict,
  entity_id     uuid references public.gl_entities(id) on delete restrict,
  cost_class    text not null default 'none'
                  check (cost_class in ('cogs_direct','cogs_allocable','nondeductible_280e',
                                        'separate_business','personal','none')),

  -- Lower number wins when several rules match.
  priority      integer not null default 100 check (priority >= 1),
  source        text not null default 'learned'
                  check (source in ('owner','learned','seed')),

  times_applied   bigint not null default 0 check (times_applied >= 0),
  last_applied_at timestamptz,

  active        boolean not null default true,
  note          text,

  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One rule per (kind, value, entity). This is a unique INDEX rather than an
-- inline UNIQUE table constraint because PostgreSQL does not permit expressions
-- inside a table constraint, and NULL entity_id must collapse to a single row:
-- under plain UNIQUE semantics every NULL is distinct, so "no entity" rules
-- would silently duplicate and quietly fight each other on priority.
create unique index if not exists gl_account_rules_unique_idx
  on public.gl_account_rules (
    match_kind,
    match_value,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists gl_account_rules_lookup_idx
  on public.gl_account_rules (match_kind, match_value) where active;

-- A rule may never aim at a control account: those belong to their subledger.
-- This is the "even at 100% confidence, still refused" guarantee, in the schema.
create or replace function public.gl_guard_rule_target()
returns trigger language plpgsql as $$
declare
  v_control boolean;
  v_code    text;
begin
  select a.is_control, a.code into v_control, v_code
  from public.gl_accounts a where a.id = new.account_id;

  if v_control then
    raise exception 'GL_CONTROL_ACCOUNT: rule cannot target control account % — control accounts are moved only by their subledger', v_code
      using errcode = 'raise_exception';
  end if;
  return new;
end $$;

drop trigger if exists gl_account_rules_guard_target on public.gl_account_rules;
create trigger gl_account_rules_guard_target
  before insert or update on public.gl_account_rules
  for each row execute function public.gl_guard_rule_target();

drop trigger if exists gl_account_rules_set_updated_at on public.gl_account_rules;
create trigger gl_account_rules_set_updated_at
  before update on public.gl_account_rules
  for each row execute function public.set_updated_at();

-- 3b. One suggestion per unclassified bank/card transaction.
create table if not exists public.gl_classification_suggestions (
  id                    uuid primary key default gen_random_uuid(),

  plaid_transaction_id  text not null,

  suggested_account_id  uuid references public.gl_accounts(id) on delete restrict,
  suggested_entity_id   uuid references public.gl_entities(id) on delete restrict,
  suggested_cost_class  text not null default 'none'
                          check (suggested_cost_class in ('cogs_direct','cogs_allocable',
                                 'nondeductible_280e','separate_business','personal','none')),

  -- INTEGER milli-percent. Floats are forbidden here: in F1 a floating-point
  -- division silently moved a penny between shareholders, and that class of bug
  -- survives code review. 0..100000.
  confidence_milli_pct  integer not null default 0
                          check (confidence_milli_pct between 0 and 100000),

  -- Which signals fired and what each contributed, so "why?" always has an
  -- answer the owner and his CPA can audit. Never a black box.
  reasons               jsonb not null default '[]'::jsonb,

  status                text not null default 'draft'
                          check (status in ('draft','approved','rejected','superseded')),

  decided_by            uuid,
  decided_at            timestamptz,
  -- Set only when an APPROVED suggestion has produced a journal.
  journal_id            uuid references public.gl_journals(id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- A bank transaction may have at most ONE live draft and at most ONE approved
-- suggestion. Rejected and superseded rows are HISTORY and are deliberately
-- unlimited: the audit trail of "the machine guessed X and Michael said no" is
-- the most valuable data in this table and must never be capped.
--
-- These are PARTIAL unique indexes. A plain unique(txn, status) would have
-- allowed only one rejection per transaction ever, so the second time a draft
-- was rejected for the same charge the write would fail and the reviewer would
-- be stuck. Two partial indexes say what is actually meant.
create unique index if not exists gl_class_sugg_one_draft_idx
  on public.gl_classification_suggestions (plaid_transaction_id)
  where status = 'draft';

create unique index if not exists gl_class_sugg_one_approved_idx
  on public.gl_classification_suggestions (plaid_transaction_id)
  where status = 'approved';

create index if not exists gl_class_sugg_status_idx
  on public.gl_classification_suggestions (status, confidence_milli_pct desc);
create index if not exists gl_class_sugg_txn_idx
  on public.gl_classification_suggestions (plaid_transaction_id);

-- THE GATE. A draft may not carry a journal; only an approved-and-decided
-- suggestion may. No confidence level short-circuits this — there is no
-- auto-post path anywhere in the schema.
create or replace function public.gl_guard_suggestion()
returns trigger language plpgsql as $$
declare
  v_control boolean;
  v_code    text;
begin
  if new.suggested_account_id is not null then
    select a.is_control, a.code into v_control, v_code
    from public.gl_accounts a where a.id = new.suggested_account_id;
    if v_control then
      raise exception 'GL_CONTROL_ACCOUNT: suggestion cannot target control account % at any confidence level', v_code
        using errcode = 'raise_exception';
    end if;
  end if;

  if new.status = 'draft' and new.journal_id is not null then
    raise exception 'GL_NOT_APPROVED: a draft suggestion may not be attached to a journal — it must be approved by the owner first'
      using errcode = 'raise_exception';
  end if;

  if new.status in ('approved','rejected') then
    if new.decided_by is null or new.decided_at is null then
      raise exception 'GL_DECISION_REQUIRED: marking a suggestion % requires decided_by and decided_at — the books record WHO decided', new.status
        using errcode = 'raise_exception';
    end if;
  end if;

  if new.journal_id is not null and new.status <> 'approved' then
    raise exception 'GL_NOT_APPROVED: only an approved suggestion may reference a journal (status is %)', new.status
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_class_sugg_guard on public.gl_classification_suggestions;
create trigger gl_class_sugg_guard
  before insert or update on public.gl_classification_suggestions
  for each row execute function public.gl_guard_suggestion();

drop trigger if exists gl_class_sugg_set_updated_at on public.gl_classification_suggestions;
create trigger gl_class_sugg_set_updated_at
  before update on public.gl_classification_suggestions
  for each row execute function public.set_updated_at();

-- 3c. Auto-created accounts are born as PROPOSALS, not accounts.
--     Owner: "That was something I hated about sage, it was difficult to
--     constantly have to set up new accounts manually before being able to make
--     transactions." The system drafts it; the owner approves it; only then does
--     a real gl_accounts row exist. An unsupervised system inventing its own
--     chart of accounts would be a catastrophe, so approval is the only path.
create table if not exists public.gl_account_proposals (
  id                 uuid primary key default gen_random_uuid(),

  proposed_code      text not null check (proposed_code ~ '^[1-9][0-9]{4}$'),
  proposed_name      text not null check (length(btrim(proposed_name)) >= 3),
  proposed_type      text not null
                       check (proposed_type in ('asset','liability','equity','income',
                                                'cogs','expense','other_income','other_expense')),
  proposed_parent_code text,
  proposed_cost_class  text not null default 'none'
                       check (proposed_cost_class in ('cogs_direct','cogs_allocable',
                              'nondeductible_280e','separate_business','personal','none')),

  -- MANDATORY. An account nobody can justify is an account nobody can audit.
  rationale          text not null check (length(btrim(rationale)) >= 10),
  -- The transactions that triggered it, so the evidence is one hop from the ask.
  evidence           jsonb not null default '[]'::jsonb,

  status             text not null default 'proposed'
                       check (status in ('proposed','approved','rejected')),

  approved_by        uuid,
  approved_at        timestamptz,
  created_account_id uuid references public.gl_accounts(id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists gl_account_proposals_open_code_idx
  on public.gl_account_proposals (proposed_code) where status = 'proposed';

-- A proposal must be internally valid BEFORE it is ever offered, and cannot
-- claim an account until it is actually approved.
create or replace function public.gl_guard_account_proposal()
returns trigger language plpgsql as $$
begin
  if not public.gl_block_allows_type(new.proposed_code, new.proposed_type) then
    raise exception 'GL_ACCOUNT_BLOCK: proposed code % cannot hold type % — the numbering block decides what an account may be', new.proposed_code, new.proposed_type
      using errcode = 'raise_exception';
  end if;

  if exists (select 1 from public.gl_accounts a where a.code = new.proposed_code) then
    raise exception 'GL_ACCOUNT_EXISTS: account % already exists; propose a different code', new.proposed_code
      using errcode = 'raise_exception';
  end if;

  if new.status = 'approved' then
    if new.approved_by is null or new.approved_at is null then
      raise exception 'GL_APPROVAL_REQUIRED: approving a proposed account requires approved_by and approved_at'
        using errcode = 'raise_exception';
    end if;
  end if;

  if new.created_account_id is not null and new.status <> 'approved' then
    raise exception 'GL_NOT_APPROVED: a proposal may only create an account once approved (status is %)', new.status
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_account_proposals_guard on public.gl_account_proposals;
create trigger gl_account_proposals_guard
  before insert or update on public.gl_account_proposals
  for each row execute function public.gl_guard_account_proposal();

drop trigger if exists gl_account_proposals_set_updated_at on public.gl_account_proposals;
create trigger gl_account_proposals_set_updated_at
  before update on public.gl_account_proposals
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 4) OLD -> NEW MAPPING. Every one of the 287 Sage accounts is accounted for.
--    The owner must approve this before any balance moves.
-- =============================================================================
create table if not exists public.gl_account_migration_map (
  id             uuid primary key default gen_random_uuid(),

  old_code       text not null unique,          -- e.g. '20009-GRNWY'
  old_name       text not null,
  old_balance_cents bigint,                     -- integer cents, as exported

  new_code       text references public.gl_accounts(code) on update cascade,
  disposition    text not null
                   check (disposition in ('rename','merge','split','retire','quarantine')),
  -- MANDATORY: why this account is being treated this way.
  rationale      text not null check (length(btrim(rationale)) >= 10),

  -- Does a BALANCE move at cut-over? Almost always false: standing rule 11 says
  -- opening balances come from EVIDENCE, never from the drifted Sage GL.
  carries_balance boolean not null default false,

  approved_by    uuid,
  approved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists gl_acct_migration_disposition_idx
  on public.gl_account_migration_map (disposition);

-- A mapping that moves a balance must name a destination and be approved.
create or replace function public.gl_guard_migration_map()
returns trigger language plpgsql as $$
begin
  if new.disposition in ('rename','merge','split') and new.new_code is null then
    raise exception 'GL_MAPPING_INCOMPLETE: disposition % on % requires a destination account', new.disposition, new.old_code
      using errcode = 'raise_exception';
  end if;

  if new.disposition in ('retire','quarantine') and new.carries_balance then
    raise exception 'GL_MAPPING_INVALID: % on % cannot carry a balance forward', new.disposition, new.old_code
      using errcode = 'raise_exception';
  end if;

  if new.carries_balance and (new.approved_by is null or new.approved_at is null) then
    raise exception 'GL_APPROVAL_REQUIRED: moving a balance for % requires the owner''s approval', new.old_code
      using errcode = 'raise_exception';
  end if;

  -- THE DESTINATION MUST EXIST. Without this, a mapping could name a target
  -- account that was never created -- a typo in a code, or a chart edit made
  -- after the map was written -- and the old balance would be carried "forward"
  -- into nothing. That is not a rounding error; that is a balance silently
  -- disappearing on cut-over day, which is the single worst thing that could
  -- happen during this migration. Checked at write time, while the person who
  -- wrote the mapping is still looking at it.
  if new.new_code is not null
     and not exists (select 1 from public.gl_accounts a where a.code = new.new_code) then
    raise exception 'GL_MAP_TARGET: mapping for % points at destination account % which does not exist in the chart. A balance mapped to a non-existent account would vanish at cut-over.', new.old_code, new.new_code
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_account_migration_map_guard on public.gl_account_migration_map;
create trigger gl_account_migration_map_guard
  before insert or update on public.gl_account_migration_map
  for each row execute function public.gl_guard_migration_map();

drop trigger if exists gl_account_migration_map_set_updated_at on public.gl_account_migration_map;
create trigger gl_account_migration_map_set_updated_at
  before update on public.gl_account_migration_map
  for each row execute function public.set_updated_at();

-- The headline mappings. The full 287 rows are loaded from the Sage export by a
-- separate, reviewable script; these are the ones that carry the story.
insert into public.gl_account_migration_map
  (old_code, old_name, old_balance_cents, new_code, disposition, rationale, carries_balance)
values
  ('20009-GRNWY','LAZY INVENTORY ENTRY', 462469731, null, 'retire',
   'The plug. Held +4,624,697.31 to offset -4,388,348.06 of impossible negative category balances (105.4% of the hole). Caused by Sage requiring an inventory item per lot code, which is impossible with no UPCs and per-lot intake. Opening inventory is rebuilt from the October 31 physical count and vendor invoices; this balance does NOT carry.', false),
  ('20000-GRNWY','CONCENTRATE', -180402270, '20140','split',
   'Ran -1,804,022.70: a credit balance on an asset, which is impossible. Purchases were never capitalised into the category. Rebuilt from evidence at cut-over.', false),
  ('20002-GRNWY','FLOWER', -146114784, '20010','split',
   'Ran -1,461,147.84 for the same reason as concentrate. Rebuilt from the physical count.', false),
  ('20010-GRNWY','NO CATEGORY', 10090840, '20890','rename',
   'Becomes the visible quarantine account rather than a silent bucket; balance rebuilt from evidence.', false),
  ('50009-GRNWY','EXCISE TAX ADJUSTMENTS', 0, '32000','rename',
   'Excise sat in the REVENUE block. RCW 69.50.535(4) makes it trust money held for the LCB, so it moves to a trust liability. This is where twelve years of mis-computed excise were cleared by crediting revenue.', false),
  ('11001-GRNWY','ISANA - LOAN', 363002, '12100','retire',
   'Interest-free employee loan, confirmed by the owner as repaid in full. The balance is stale drift and does not carry. 12100 exists as the governed home if lending ever recurs.', false),
  ('42000-OTHER','BUEHLER - CONTRIBUTIONS', -501102, null, 'retire',
   'Personal: the owner''s aunt, tied to a lake cabin he no longer owns. Never belonged in the business equity block.', false),
  ('73002-GRNWY','PAYROLL - THERESA BECKER', 0, null, 'retire',
   'An HSA/health-premium arrangement for the owner''s mother that ended when she moved to Medicare. She is a 10% shareholder, which is a dimension, not a payroll account.', false),
  ('12000-GRWYE','ATM CASH BALANCE', -4523000, '10300','quarantine',
   'Drifted to -45,230.00 — negative cash, impossible. Owner: "I have no idea how to fix it." Re-derived from evidence at cut-over per standing rule 11.', false),
  ('80003-GRWYE','THEFT / LOSS - OCTOBER', 0, '85020','merge',
   'The MONTH was encoded into the account code. Date is a dimension present on every journal line.', false),
  ('80004-GRWYE','THEFT / LOSS - DECEMBER', 0, '85020','merge',
   'Same as October: merged into a single theft and casualty loss account.', false),
  ('70022-GRNWY','INSURANCE', 0, '76060','merge',
   'Duplicate of 70019 INSURANCE. Ungoverned charts grow duplicates; this is the governance fix.', false),
  ('34000-GRWYE','ACCOUNTS PAYABLE', 0, '30000','merge',
   'Entity was encoded in the account code, producing payables that could never be compared. Entity is now a column on every line.', false),
  ('35000-LYMAN','ACCOUNTS PAYABLE', 0, '30000','merge',
   'Same as the ATM payable: merged into the single A/P control account.', false)
on conflict (old_code) do nothing;

-- =============================================================================
-- 5) ROW-LEVEL SECURITY — the books are ADMIN-ONLY, same as 0172.
-- =============================================================================
alter table public.gl_account_rules             enable row level security;
alter table public.gl_classification_suggestions enable row level security;
alter table public.gl_account_proposals         enable row level security;
alter table public.gl_account_migration_map     enable row level security;

drop policy if exists gl_account_rules_admin_all on public.gl_account_rules;
create policy gl_account_rules_admin_all on public.gl_account_rules
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_class_sugg_admin_all on public.gl_classification_suggestions;
create policy gl_class_sugg_admin_all on public.gl_classification_suggestions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_account_proposals_admin_all on public.gl_account_proposals;
create policy gl_account_proposals_admin_all on public.gl_account_proposals
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_acct_migration_admin_all on public.gl_account_migration_map;
create policy gl_acct_migration_admin_all on public.gl_account_migration_map
  for all using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- END 0173_chart_of_accounts.sql
--
-- The chart now exists. What used to be possible, and no longer is:
--   * A manual journal into inventory  -> GL_CONTROL_ACCOUNT (the plug).
--   * Excise credited to revenue       -> gl_accounts_block_type_chk.
--   * An asset with a credit normal    -> gl_guard_account_normal_balance.
--   * Entity typo'd into a code        -> gl_accounts_code_shape_chk.
--   * An account invented unsupervised -> gl_account_proposals + approval.
--   * A suggestion posting itself      -> gl_guard_suggestion, at any confidence.
--   * Renumbering a live account       -> GL_ACCOUNT_IMMUTABLE.
--   * A balance moved without sign-off -> GL_APPROVAL_REQUIRED.
-- =============================================================================
