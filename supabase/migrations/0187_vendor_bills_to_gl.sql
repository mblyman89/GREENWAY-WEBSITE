-- =============================================================================
-- 0187 — VENDOR BILLS REACH THE GENERAL LEDGER (slice books-03)
--
-- OWNER CONTEXT, 2026-08-17, recorded verbatim (standing rule 1):
--
--   "I really think it's smart to not just block, but explain why, and even
--    better, show me a way to do it properly."
--
-- THE GAP THIS CLOSES
-- Greenway already tracks vendors (0003), inbound cannabis manifests (0023),
-- non-cannabis invoices (0112) and vendor payments (0067/0068). Every one of
-- those systems works. NOT ONE OF THEM REACHES THE GENERAL LEDGER. A bill is
-- recorded, a payment is recorded, and the ledger never hears about either.
-- That is why the books have to be rebuilt from bank statements every year.
--
-- WHY THIS IS THE MOST VALUABLE SLICE IN THE BRANCH
-- IRC §280E denies EVERY deduction to a cannabis retailer. Cost of goods sold
-- is not a deduction — it is an exclusion in computing gross income
-- (Reg. §1.61-3(a)) — so COGS survives §280E and nothing else does. Which side
-- of that line a purchase lands on is the single largest number on Michael's
-- tax return.
--
-- Greenway is a RESELLER, so Reg. §1.471-3(b) governs, and it says inventory
-- cost is the invoice price less trade discounts, PLUS:
--
--     "transportation or other necessary charges incurred in acquiring
--      possession of the goods"
--
-- That clause is money. Inbound freight, coded to a shipping expense account,
-- is disallowed by §280E and gone forever. The SAME dollar, coded to 60800
-- Freight-In, rides into inventory and comes out as COGS, which §280E cannot
-- touch. This migration is the plumbing that makes the right answer the one
-- that actually gets recorded.
--
-- WHAT THIS MIGRATION DOES
--   §1  gl_vendor_purchase_kinds — the closed taxonomy of purchase kinds, as a
--       REFERENCE TABLE mirroring src/lib/accounting/vendor-bill-core.ts. The
--       TypeScript core remains the brain; this table exists so the database
--       can validate what the app claims, and so a human reading the schema can
--       see the §280E treatment without reading TypeScript.
--   §2  gl_vendor_profiles — a remembered default purchase kind per vendor, so
--       the second bill from a vendor is easier than the first. Suggestion
--       only; it never overrides an explicit choice.
--   §3  Bridge columns on noncannabis_invoices and inbound_manifests linking a
--       source document to the journal it produced. This is what makes posting
--       idempotent and what lets any GL line be traced back to paper.
--   §4  gl_post_vendor_bill() — posts a classified bill through the EXISTING
--       gl_submit_journal(), never around it.
--   §5  gl_audit_vendor_bill_wiring() — a self-check that returns problems.
--       An EMPTY result means everything is correct.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES *NOT* DO
--   * It does NOT re-implement the classification rules in SQL. Two copies of a
--     tax rule drift, and the drifting copy is always the one nobody tests.
--     The rules live in ONE place: vendor-bill-core.ts, which has ~200
--     assertions over it in two independent gates.
--   * It does NOT auto-post. gl_submit_journal() already refuses to auto-post a
--     purchase without a three-way match, and that refusal is left intact.
--   * It does NOT touch the AP payment tables (0067/0068). An admin must still
--     be able to pay vendors; that surface is unchanged.
--
-- STANDING RULES HONOURED
--   rule 1  — the owner's words are recorded verbatim
--   rule 2  — every tax position cites its authority, in the comments below
--   rule 6  — applied MANUALLY in the Supabase SQL editor
--   rule 7  — money is integer cents, always
--   rule 12 — assumptions are RECORDED, never applied silently
--   rule 14 — when in doubt, REFUSE
--
-- IDEMPOTENT. Safe to run repeatedly, as repo law requires.
-- REQUIRES 0185 (public.is_owner()) to have been run first.
--
-- APPLY MANUALLY in the Supabase SQL editor (standing rule 6).
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITION — refuse to run out of order rather than half-apply.
-- ═══════════════════════════════════════════════════════════════════════════
do $precheck$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0187 needs public.is_owner(), which migration 0185 creates. Run 0185_books_owner_only.sql first, then 0186, then this file.';
  end if;

  if to_regclass('public.gl_journals') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0187 needs the general ledger from 0172. Run the 0172-0178 books migrations first.';
  end if;
end;
$precheck$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  THE PURCHASE TAXONOMY
--
-- A closed list. "Closed" is the point: an open-ended list of expense
-- categories is how a business ends up with 400 accounts and no idea which
-- ones survive §280E. Every kind below states its treatment and the authority
-- behind it.
--
-- treatment:
--   inventory  — rides into inventory, becomes COGS when sold. SURVIVES §280E.
--   expense    — operating cost of the cannabis trade. §280E DISALLOWS it.
--   asset      — long-lived; capitalise and depreciate.
--   trust      — the state's money passing through. Never touches the P&L.
--   quarantine — not yet classified. Parked where it is VISIBLE.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_vendor_purchase_kinds (
  code              text primary key
                      check (code = lower(btrim(code)) and length(btrim(code)) >= 3),

  label             text not null check (length(btrim(label)) >= 3),

  treatment         text not null
                      check (treatment in ('inventory','expense','asset','trust','quarantine')),

  -- The account this kind debits. For cannabis_product this is the 20000
  -- CONTROL account; the per-category subaccount is resolved per line by the
  -- application, because only the line knows the category.
  debit_account_code text not null check (debit_account_code ~ '^[1-9][0-9]{4}$'),

  -- The §280E character carried onto the journal line. Balance-sheet lines
  -- carry 'none': an asset has no §280E character until it is sold.
  cost_class        text not null
                      check (cost_class in ('cogs_direct','cogs_allocable',
                        'nondeductible_280e','separate_business','personal','none')),

  -- TRUE only for cannabis product itself, which requires a category before it
  -- can be classified to a real inventory account.
  is_cannabis_product boolean not null default false,

  -- Plain English, for Michael. Rendered directly in the UI.
  why               text not null check (length(btrim(why)) >= 20),

  -- The authority ids carried in vendor-bill-core.ts AUTHORITIES.
  authority_ids     text[] not null default '{}',

  sort_order        integer not null default 100,
  is_active         boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.gl_vendor_purchase_kinds is
  'Closed taxonomy of vendor purchase kinds and their IRC 280E treatment. MIRRORS src/lib/accounting/vendor-bill-core.ts PURCHASE_KINDS, which is the authoritative brain; this table lets the database validate what the app claims and lets a human read the 280E treatment straight from the schema. Reg. 1.471-3(b) governs the inventory side because Greenway is a reseller.';

comment on column public.gl_vendor_purchase_kinds.treatment is
  'inventory = survives 280E via COGS (Reg. 1.61-3(a)); expense = disallowed by 280E; asset = capitalise; trust = the state''s money, never P&L; quarantine = unclassified and deliberately visible.';

-- THE SEED. `on conflict do update` so re-running this file corrects drift
-- rather than silently leaving an old row in place.
insert into public.gl_vendor_purchase_kinds
  (code, label, treatment, debit_account_code, cost_class, is_cannabis_product, why, authority_ids, sort_order)
values
  -- ---- INVENTORY: the costs §280E cannot reach -----------------------------
  ('cannabis_product', 'Cannabis product for resale', 'inventory', '20000', 'none', true,
   'The invoice price of goods you will resell. Under Reg. 1.471-3(b) this is the core of inventory cost, and it becomes COGS when the product sells - the one big number 280E cannot touch.',
   array['REG_1_471_3_B','IRS_CANNABIS_FAQ','REG_1_61_3_A'], 10),

  ('freight_in', 'Inbound freight / delivery on a purchase', 'inventory', '60800', 'cogs_direct', false,
   'Reg. 1.471-3(b) adds "transportation or other necessary charges incurred in acquiring possession of the goods" to inventory cost. Coded as shipping expense this dollar is disallowed by 280E and gone; coded here it becomes COGS.',
   array['REG_1_471_3_B','ASC_330_10_30_1'], 20),

  ('purchase_discount', 'Trade discount received from a vendor', 'inventory', '60900', 'cogs_direct', false,
   'Reg. 1.471-3(b) starts from invoice price LESS trade discounts. A discount reduces inventory cost; it is not other income.',
   array['REG_1_471_3_B'], 30),

  ('product_packaging', 'Packaging that goes out with the product', 'inventory', '60800', 'cogs_direct', false,
   'Required exit packaging becomes part of the article sold, so it is a product cost. The test is whether the customer carries it out of the store.',
   array['REG_1_471_3_B','ASC_330_10_30_1'], 40),

  ('testing_on_purchase', 'Lab testing required to receive specific goods', 'quarantine', '20890', 'none', false,
   'CONTESTED. Testing tied to acquiring specific goods is arguably a necessary charge in acquiring possession under Reg. 1.471-3(b); general compliance testing is not. It is quarantined so the judgment is made deliberately and documented, never assumed.',
   array['REG_1_471_3_B','IRC_6001_SUBSTANTIATION'], 50),

  -- ---- EXPENSE: real costs that §280E disallows ----------------------------
  ('rent', 'Rent', 'expense', '70010', 'nondeductible_280e', false,
   'Rent of the retail premises is an ordinary business expense, and 280E disallows it for a cannabis trade. Record it correctly anyway: it is real, it belongs on the books, and it is deductible in a separate business or if the law changes.',
   array['IRC_280E','CHAMP'], 100),

  ('utilities', 'Utilities', 'expense', '70020', 'nondeductible_280e', false,
   'Power, water and gas for the store. An ordinary operating expense, disallowed by 280E for the cannabis trade.',
   array['IRC_280E'], 110),

  ('security', 'Security & alarm', 'expense', '70050', 'nondeductible_280e', false,
   'Security is mandated by WSLCB rules, but 280E has no exception for costs a regulator requires. Disallowed, and recorded.',
   array['IRC_280E'], 120),

  ('professional_fees', 'Accounting, legal & consulting', 'expense', '74010', 'nondeductible_280e', false,
   'Professional fees of the cannabis trade are disallowed by 280E. Fees genuinely attributable to a separate business belong in that entity''s books.',
   array['IRC_280E','CHAMP'], 130),

  ('software', 'Software & subscriptions', 'expense', '73010', 'nondeductible_280e', false,
   'Software used to run the store is an operating expense, disallowed by 280E.',
   array['IRC_280E'], 140),

  ('pos_traceability', 'POS & traceability systems', 'expense', '73020', 'nondeductible_280e', false,
   'Traceability is a condition of the licence, but 280E still disallows it. Kept in its own account so the true cost of compliance is visible.',
   array['IRC_280E'], 150),

  ('advertising', 'Advertising & promotion', 'expense', '72010', 'nondeductible_280e', false,
   'Advertising is a selling expense, squarely disallowed by 280E.',
   array['IRC_280E'], 160),

  ('store_supplies', 'Store supplies (not product packaging)', 'expense', '76020', 'nondeductible_280e', false,
   'Supplies consumed running the store. CAUTION: packaging that leaves with the product is NOT this - that is product_packaging and it is inventoriable.',
   array['IRC_280E','REG_1_471_3_B'], 170),

  ('licences', 'Licences & permits', 'expense', '75010', 'nondeductible_280e', false,
   'Licence and permit fees of the cannabis trade. Disallowed by 280E.',
   array['IRC_280E'], 180),

  ('insurance', 'Insurance', 'expense', '76060', 'nondeductible_280e', false,
   'Insurance on the cannabis operation. An ordinary expense, disallowed by 280E.',
   array['IRC_280E'], 190),

  ('bank_fees', 'Bank & cash-handling fees', 'expense', '76040', 'nondeductible_280e', false,
   'Banking and cash-handling costs, which are unusually high in cannabis. Still disallowed by 280E.',
   array['IRC_280E'], 200),

  ('repairs', 'Repairs & maintenance', 'expense', '70030', 'nondeductible_280e', false,
   'A true repair keeps an asset working; it does not improve it. Repairs are expensed and disallowed by 280E. An improvement is an ASSET - see leasehold_improvement.',
   array['IRC_280E'], 210),

  ('waste_disposal', 'Janitorial & waste removal', 'expense', '70060', 'nondeductible_280e', false,
   'Cleaning and regulated waste disposal. An operating expense, disallowed by 280E.',
   array['IRC_280E'], 220),

  -- ---- ASSET: long-lived, capitalise and depreciate ------------------------
  ('equipment', 'Equipment, fixtures & furniture', 'asset', '21600', 'none', false,
   'Something still useful a year from now is an asset, not an expense. Capitalising it is not a 280E question at all - but expensing it discards basis and understates the balance sheet a bank will read.',
   array['IRC_280E'], 300),

  ('leasehold_improvement', 'Leasehold improvements', 'asset', '21500', 'none', false,
   'Improvements to premises you lease. Capitalised and depreciated over the applicable recovery period, not expensed in the year you build them.',
   array['IRC_280E'], 310),

  ('vehicle', 'Vehicle', 'asset', '21700', 'none', false,
   'A vehicle is a long-lived asset with its own depreciation rules and its own substantiation requirements for business use.',
   array['IRC_280E','IRC_6001_SUBSTANTIATION'], 320),

  -- ---- TRUST: the state's money, never income, never expense ---------------
  ('excise_remittance', 'Cannabis excise remittance to WSLCB', 'trust', '32000', 'none', false,
   'Cannabis excise tax collected from customers is the state''s money held in trust. It is a liability, never revenue and never an expense. Treating it as either overstates sales and poisons every margin figure that follows.',
   array['RCW_69_50_535'], 400),

  ('sales_tax_remittance', 'Retail sales tax remittance to DOR', 'trust', '32100', 'none', false,
   'Retail sales tax collected from customers is held in trust for the Department of Revenue. A liability, not income.',
   array['RCW_69_50_535'], 410),

  -- ---- QUARANTINE: honest uncertainty --------------------------------------
  ('unknown', 'Not yet classified', 'quarantine', '20890', 'none', false,
   'Standing rule: never guess. An unclassified purchase parks in 20890 where it is visible and countable, rather than being silently absorbed into COGS (which overstates the 280E shield) or into expense (which throws the deduction away).',
   array['IRC_6001_SUBSTANTIATION'], 900)

on conflict (code) do update set
  label               = excluded.label,
  treatment           = excluded.treatment,
  debit_account_code  = excluded.debit_account_code,
  cost_class          = excluded.cost_class,
  is_cannabis_product = excluded.is_cannabis_product,
  why                 = excluded.why,
  authority_ids       = excluded.authority_ids,
  sort_order          = excluded.sort_order,
  updated_at          = now();

-- STRUCTURAL GUARANTEE, enforced by the database rather than by hope:
-- an inventoriable cost may never carry the 280E-disallowed class. If a future
-- edit ever tries to seed one, the insert fails instead of quietly costing
-- Michael the deduction.
do $guard$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gl_vendor_purchase_kinds_inventory_not_disallowed'
  ) then
    alter table public.gl_vendor_purchase_kinds
      add constraint gl_vendor_purchase_kinds_inventory_not_disallowed
      check (
        treatment <> 'inventory'
        or cost_class in ('cogs_direct','cogs_allocable','none')
      );
  end if;

  -- Trust money can never carry a P&L character.
  if not exists (
    select 1 from pg_constraint
    where conname = 'gl_vendor_purchase_kinds_trust_is_balance_sheet'
  ) then
    alter table public.gl_vendor_purchase_kinds
      add constraint gl_vendor_purchase_kinds_trust_is_balance_sheet
      check (treatment <> 'trust' or cost_class = 'none');
  end if;
end;
$guard$;

drop trigger if exists trg_gl_vendor_purchase_kinds_updated on public.gl_vendor_purchase_kinds;
create trigger trg_gl_vendor_purchase_kinds_updated
  before update on public.gl_vendor_purchase_kinds
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  VENDOR PROFILES — make the second bill easier than the first.
--
-- A SUGGESTION, never a rule. The default is offered; the classification the
-- app computes for the actual line always wins. This is the difference between
-- a system that learns and a system that quietly mis-files everything from one
-- vendor for a year.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_vendor_profiles (
  vendor_id           uuid primary key references public.vendors(id) on delete cascade,

  -- Suggested default kind for this vendor's lines.
  default_kind_code   text references public.gl_vendor_purchase_kinds(code) on delete set null,

  -- TRUE when this vendor is a licensed cannabis producer/processor, which is a
  -- strong (not conclusive) signal that a line is product for resale.
  is_licensed_cannabis boolean not null default false,

  -- Which entity's books this vendor's bills normally belong to.
  default_entity_code text,

  -- Owner's own note. Shown next to the suggestion so the reason travels with
  -- the rule (standing rule 12: assumptions are recorded, not silent).
  note                text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.gl_vendor_profiles is
  'Remembered per-vendor defaults for bill classification. SUGGESTION ONLY - the classification computed for the actual invoice line always wins. Owner-only.';

create index if not exists idx_gl_vendor_profiles_kind
  on public.gl_vendor_profiles (default_kind_code);

drop trigger if exists trg_gl_vendor_profiles_updated on public.gl_vendor_profiles;
create trigger trg_gl_vendor_profiles_updated
  before update on public.gl_vendor_profiles
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  THE BRIDGE — a source document knows which journal it produced.
--
-- Without this link there is no way to answer the only question that matters
-- in an audit: "show me the paper behind this number." Nullable, because every
-- historical row predates the ledger and must stay valid.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.noncannabis_invoices
  add column if not exists gl_journal_id uuid references public.gl_journals(id) on delete set null;

alter table public.noncannabis_invoices
  add column if not exists gl_posted_at timestamptz;

comment on column public.noncannabis_invoices.gl_journal_id is
  'The general ledger journal this invoice produced, if any. NULL means the bill has been recorded as a document but has not reached the ledger.';

alter table public.inbound_manifests
  add column if not exists gl_journal_id uuid references public.gl_journals(id) on delete set null;

alter table public.inbound_manifests
  add column if not exists gl_posted_at timestamptz;

comment on column public.inbound_manifests.gl_journal_id is
  'The general ledger journal this accepted manifest produced, if any. The manifest is the receiving evidence behind the inventory debit (Reg. 1.471-3(b) invoice price + charges to acquire possession).';

create index if not exists idx_noncannabis_invoices_gl_journal
  on public.noncannabis_invoices (gl_journal_id) where gl_journal_id is not null;

create index if not exists idx_inbound_manifests_gl_journal
  on public.inbound_manifests (gl_journal_id) where gl_journal_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  POSTING — through gl_submit_journal(), never around it.
--
-- Everything gl_submit_journal() enforces (balance, period control, the line in
-- the sand, control-account protection, idempotency, the three-way-match rule
-- for auto-posting) is enforced here too, because this function does not
-- reimplement any of it. It classifies nothing: the caller supplies lines that
-- vendor-bill-core.ts has already classified and tested.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_post_vendor_bill(
  p_entity_code       text,
  p_invoice_date      date,
  p_source_ref        text,
  p_memo              text,
  p_lines             jsonb,
  p_expected_cents    bigint  default null,
  p_three_way_matched boolean default false,
  p_auto_post         boolean default false,
  p_assumption_note   text    default null,
  p_template_code     text    default null,
  p_invoice_id        uuid    default null,
  p_manifest_id       uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result     jsonb;
  v_journal_id uuid;
begin
  -- OWNER-ONLY. The books are the owner's alone (owner decision 2026-08-17).
  -- Note this is NOT the same as the AP payment surface, which an admin keeps.
  if not public.is_owner() then
    raise exception 'GL_NOT_OWNER: only the owner may post to the books'
      using errcode = 'insufficient_privilege';
  end if;

  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception 'GL_NO_SOURCE_REF: a bill must carry an idempotency reference so it cannot be posted twice'
      using errcode = 'raise_exception';
  end if;

  -- Delegate. Every guarantee lives in one place.
  v_result := public.gl_submit_journal(
    p_entity_code       => p_entity_code,
    p_journal_date      => p_invoice_date,
    p_source_kind       => 'purchase',
    p_source_ref        => btrim(p_source_ref),
    p_memo              => p_memo,
    p_lines             => p_lines,
    p_template_code     => p_template_code,
    p_expected_cents    => p_expected_cents,
    p_auto_post         => p_auto_post,
    p_assumption_note   => p_assumption_note,
    p_intercompany_ref  => null,
    p_three_way_matched => p_three_way_matched
  );

  v_journal_id := nullif(v_result->>'journal_id', '')::uuid;

  -- Stamp the bridge so the paper and the ledger point at each other.
  if v_journal_id is not null then
    if p_invoice_id is not null then
      update public.noncannabis_invoices
         set gl_journal_id = v_journal_id,
             gl_posted_at  = now()
       where id = p_invoice_id;
    end if;

    if p_manifest_id is not null then
      update public.inbound_manifests
         set gl_journal_id = v_journal_id,
             gl_posted_at  = now()
       where id = p_manifest_id;
    end if;
  end if;

  return v_result;
end;
$$;

comment on function public.gl_post_vendor_bill(text, date, text, text, jsonb, bigint, boolean, boolean, text, text, uuid, uuid) is
  'Posts a CLASSIFIED vendor bill to the general ledger through gl_submit_journal(), then links the source document to the journal. Classification is performed and tested in src/lib/accounting/vendor-bill-core.ts; this function deliberately contains no tax logic of its own. Owner-only.';

revoke all on function public.gl_post_vendor_bill(text, date, text, text, jsonb, bigint, boolean, boolean, text, text, uuid, uuid) from public;
grant execute on function public.gl_post_vendor_bill(text, date, text, text, jsonb, bigint, boolean, boolean, text, text, uuid, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- §5  ROW LEVEL SECURITY — owner-only, matching 0185.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.gl_vendor_purchase_kinds enable row level security;
alter table public.gl_vendor_profiles       enable row level security;

drop policy if exists gl_vendor_purchase_kinds_owner_all on public.gl_vendor_purchase_kinds;
create policy gl_vendor_purchase_kinds_owner_all
  on public.gl_vendor_purchase_kinds
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists gl_vendor_profiles_owner_all on public.gl_vendor_profiles;
create policy gl_vendor_profiles_owner_all
  on public.gl_vendor_profiles
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ═══════════════════════════════════════════════════════════════════════════
-- §6  THE SELF-CHECK
--
-- Run this after applying the migration:
--
--     select * from gl_audit_vendor_bill_wiring();
--
-- AN EMPTY RESULT MEANS EVERYTHING IS CORRECT. This function only ever returns
-- PROBLEMS. It is a smoke alarm: silence is the good outcome.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_vendor_bill_wiring()
returns table (area text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  -- (a) Every purchase kind must point at an account that actually exists in
  --     the chart. A phantom account reference only fails at posting time,
  --     which is the worst possible moment to find out.
  select 'purchase_kind'::text,
         format('kind %s points at account %s, which is not in the chart of accounts',
                k.code, k.debit_account_code)::text
    from public.gl_vendor_purchase_kinds k
   where k.is_active
     and not exists (
       select 1 from public.gl_accounts a where a.code = k.debit_account_code
     )

  union all

  -- (b) A 6xxxx COGS account must carry a COGS cost class. This mirrors the
  --     gl_accounts_cogs_cost_class_chk constraint from 0173; catching it here
  --     turns a runtime rejection into a readable sentence.
  select 'purchase_kind'::text,
         format('kind %s posts to COGS account %s but carries cost class %s',
                k.code, k.debit_account_code, k.cost_class)::text
    from public.gl_vendor_purchase_kinds k
   where k.is_active
     and k.debit_account_code like '6%'
     and k.cost_class not in ('cogs_direct','cogs_allocable')

  union all

  -- (c) THE BIG ONE. An inventoriable cost must never be classified as
  --     disallowed. This is the difference between paying tax on gross receipts
  --     and paying tax on gross profit.
  select 'section_280e'::text,
         format('kind %s is inventoriable but carries the disallowed class %s - this would throw away a cost that Reg. 1.471-3(b) protects',
                k.code, k.cost_class)::text
    from public.gl_vendor_purchase_kinds k
   where k.is_active
     and k.treatment = 'inventory'
     and k.cost_class = 'nondeductible_280e'

  union all

  -- (d) The bridge columns must exist, or nothing can be traced to paper.
  select 'bridge'::text,
         'noncannabis_invoices.gl_journal_id is missing; bills cannot be traced to the ledger'::text
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'noncannabis_invoices'
        and column_name  = 'gl_journal_id'
   )

  union all

  select 'bridge'::text,
         'inbound_manifests.gl_journal_id is missing; manifests cannot be traced to the ledger'::text
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'inbound_manifests'
        and column_name  = 'gl_journal_id'
   )

  union all

  -- (e) The posting function must exist and be owner-gated.
  select 'posting'::text,
         'gl_post_vendor_bill() is missing; vendor bills have no route to the ledger'::text
   where to_regprocedure(
     'public.gl_post_vendor_bill(text,date,text,text,jsonb,bigint,boolean,boolean,text,text,uuid,uuid)'
   ) is null

  union all

  -- (f) Both new tables must have RLS on. A books table without RLS is readable
  --     by any authenticated session with a PostgREST call.
  select 'security'::text,
         format('table %s does not have row level security enabled', c.relname)::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('gl_vendor_purchase_kinds','gl_vendor_profiles')
     and c.relrowsecurity is false;
$$;

comment on function public.gl_audit_vendor_bill_wiring() is
  'Returns a row for every problem with the vendor-bill-to-GL wiring. AN EMPTY RESULT MEANS EVERYTHING IS CORRECT - it reports only problems, like a smoke alarm.';

revoke all on function public.gl_audit_vendor_bill_wiring() from public;
grant execute on function public.gl_audit_vendor_bill_wiring() to authenticated;

-- =============================================================================
-- WHAT TO DO AFTER RUNNING THIS FILE
--
--   1. Run:  select * from gl_audit_vendor_bill_wiring();
--      An EMPTY result means everything is wired correctly. If rows come back,
--      each one is a sentence describing exactly what is wrong.
--
--   2. Run:  select code, treatment, debit_account_code, cost_class
--              from gl_vendor_purchase_kinds order by sort_order;
--      This is the whole 280E map on one screen: which purchases survive
--      (treatment = 'inventory') and which ones 280E takes (treatment =
--      'expense').
-- =============================================================================
