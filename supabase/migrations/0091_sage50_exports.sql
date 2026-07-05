-- ============================================================================
-- 0091_sage50_exports.sql — Sage 50 export pipeline (Slice: Sage 50 assistant)
--
-- WHY: the owner keys daily sales/COGS/purchases/payments into Sage 50 Quantum
-- by hand. The back office already holds the source data (orders, lots, costs,
-- manifests, vendor payments). This migration adds the OWNER-EDITABLE mapping
-- the export builders need to emit Sage-importable CSVs that match the store's
-- REAL books (verified from the owner's own Sage exports: CHART_OF_ACCOUNTS,
-- CUSTOMERS, RECEIPTS_JOURNAL, PURCHASE_JOURNAL, PAYMENTS_JOURNAL, VENDORS).
--
-- Seeded values below are NOT guesses — every account id / customer id / tax
-- agency id is copied verbatim from the owner's uploaded Sage company exports.
-- Seeds are gap-fill only (insert .. on conflict do nothing / update only when
-- blank) so curated data is never overwritten.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) sage_category_accounts — one row per Sage "category bucket".
--    The owner's Sage books each product category through a category customer
--    (01-FLOWER … for sales receipts, 07-FLOWER … for COGS receipts) and a
--    per-category G/L trio (sales 5000x, COGS 6000x, inventory 2000x).
-- ----------------------------------------------------------------------------
create table if not exists public.sage_category_accounts (
  id                 uuid primary key default gen_random_uuid(),
  -- Stable bucket key used by the export builders.
  bucket             text not null unique
                       check (bucket in ('concentrate','edible','flower','liquid','non_cannabis','preroll','topical')),
  -- Human label as it appears in the owner's Sage company.
  label              text not null default '',
  -- Sage "customer" ids used on receipts (verified from CUSTOMERS.CSV).
  sales_customer_id  text not null default '',
  cogs_customer_id   text not null default '',
  -- Sage G/L accounts (verified from CHART_OF_ACCOUNTS.CSV).
  gl_sales           text not null default '',
  gl_cogs            text not null default '',
  gl_inventory       text not null default '',
  -- Cannabis buckets get the 37% excise line; non-cannabis does not.
  is_cannabis        boolean not null default true,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_sage_category_accounts_updated on public.sage_category_accounts;
create trigger trg_sage_category_accounts_updated
  before update on public.sage_category_accounts
  for each row execute function public.set_updated_at();

alter table public.sage_category_accounts enable row level security;
drop policy if exists sage_category_accounts_staff_all on public.sage_category_accounts;
create policy sage_category_accounts_staff_all on public.sage_category_accounts
  for all using (public.is_staff()) with check (public.is_staff());

-- Seed the seven buckets with the owner's verified Sage ids (gap-fill only).
insert into public.sage_category_accounts
  (bucket, label, sales_customer_id, cogs_customer_id, gl_sales, gl_cogs, gl_inventory, is_cannabis)
values
  ('concentrate',  'CONCENTRATE',  '01-CONCENTRATE',  '07-CONCENTRATE',  '50000-GRNWY', '60000-GRNWY', '20000-GRNWY', true),
  ('edible',       'EDIBLE',       '01-EDIBLE',       '07-EDIBLE',       '50001-GRNWY', '60001-GRNWY', '20001-GRNWY', true),
  ('flower',       'FLOWER',       '01-FLOWER',       '07-FLOWER',       '50002-GRNWY', '60002-GRNWY', '20002-GRNWY', true),
  ('liquid',       'LIQUID',       '01-LIQUID',       '07-LIQUID',       '50003-GRNWY', '60003-GRNWY', '20003-GRNWY', true),
  ('non_cannabis', 'NON-CANNABIS', '01-NON CANNABIS', '07-NON CANNABIS', '50004-GRNWY', '60004-GRNWY', '20004-GRNWY', false),
  ('preroll',      'PRE-ROLL',     '01-PREROLL',      '07-PREROLL',      '50005-GRNWY', '60005-GRNWY', '20005-GRNWY', true),
  ('topical',      'TOPICAL',      '01-TOPICAL',      '07-TOPICAL',      '50006-GRNWY', '60006-GRNWY', '20006-GRNWY', true)
on conflict (bucket) do nothing;

-- ----------------------------------------------------------------------------
-- 2) sage_category_map — back-office menu category → Sage bucket.
--    Only obvious identity matches are seeded; anything else surfaces as an
--    "unmapped category" warning in the UI so the OWNER decides (never guess).
-- ----------------------------------------------------------------------------
create table if not exists public.sage_category_map (
  source_category  text primary key,          -- normalized (lowercase, trimmed)
  bucket           text not null
                     check (bucket in ('concentrate','edible','flower','liquid','non_cannabis','preroll','topical')),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_sage_category_map_updated on public.sage_category_map;
create trigger trg_sage_category_map_updated
  before update on public.sage_category_map
  for each row execute function public.set_updated_at();

alter table public.sage_category_map enable row level security;
drop policy if exists sage_category_map_staff_all on public.sage_category_map;
create policy sage_category_map_staff_all on public.sage_category_map
  for all using (public.is_staff()) with check (public.is_staff());

insert into public.sage_category_map (source_category, bucket) values
  ('concentrate',  'concentrate'),
  ('concentrates', 'concentrate'),
  ('edible',       'edible'),
  ('edibles',      'edible'),
  ('flower',       'flower'),
  ('preroll',      'preroll'),
  ('pre-roll',     'preroll'),
  ('prerolls',     'preroll'),
  ('topical',      'topical'),
  ('topicals',     'topical')
on conflict (source_category) do nothing;

-- ----------------------------------------------------------------------------
-- 3) accounting_settings — extra Sage export settings (singleton row).
--    Values seeded only when blank, verbatim from the owner's Sage exports:
--      AP account 30000-GRNWY, checking 10005-GRNWY, default purchases G/L
--      20009-GRNWY ("LAZY INVENTORY ENTRY"), excise 31000-GRNWY,
--      sales tax 31001-GRNWY, cash on hand 10000-GRNWY,
--      Sales Tax IDs WA_LCB01 (cannabis) / WA_DOR01 (non-cannabis).
-- ----------------------------------------------------------------------------
alter table public.accounting_settings add column if not exists gl_ap_account          text not null default '';
alter table public.accounting_settings add column if not exists gl_bank_account        text not null default '';
alter table public.accounting_settings add column if not exists gl_purchases_default   text not null default '';
alter table public.accounting_settings add column if not exists gl_cash_on_hand        text not null default '';
alter table public.accounting_settings add column if not exists sales_tax_id_cannabis  text not null default '';
alter table public.accounting_settings add column if not exists sales_tax_id_other     text not null default '';

update public.accounting_settings set gl_ap_account         = '30000-GRNWY' where id = true and coalesce(gl_ap_account, '')         = '';
update public.accounting_settings set gl_bank_account       = '10005-GRNWY' where id = true and coalesce(gl_bank_account, '')       = '';
update public.accounting_settings set gl_purchases_default  = '20009-GRNWY' where id = true and coalesce(gl_purchases_default, '')  = '';
update public.accounting_settings set gl_cash_on_hand       = '10000-GRNWY' where id = true and coalesce(gl_cash_on_hand, '')       = '';
update public.accounting_settings set sales_tax_id_cannabis = 'WA_LCB01'    where id = true and coalesce(sales_tax_id_cannabis, '') = '';
update public.accounting_settings set sales_tax_id_other    = 'WA_DOR01'    where id = true and coalesce(sales_tax_id_other, '')    = '';

-- Seed the store-wide excise / sales-tax payable mappings only when blank
-- (verified: 31000-GRNWY EXCISE TAX, 31001-GRNWY SALES TAX).
update public.accounting_settings set gl_excise_tax_payable = '31000-GRNWY' where id = true and coalesce(gl_excise_tax_payable, '') = '';
update public.accounting_settings set gl_sales_tax_payable  = '31001-GRNWY' where id = true and coalesce(gl_sales_tax_payable, '')  = '';

-- ----------------------------------------------------------------------------
-- 4) vendors.sage_vendor_id — the vendor's ID in the owner's Sage company
--    (e.g. "01-TWO HEADS"). Required on Purchases/Payments exports; rows
--    without it are skipped with a warning so nothing wrong is ever imported.
-- ----------------------------------------------------------------------------
alter table public.vendors add column if not exists sage_vendor_id text;
create index if not exists vendors_sage_vendor_id_idx on public.vendors (sage_vendor_id);

comment on table  public.sage_category_accounts is 'Per-category Sage 50 customer + G/L mapping (verified from the owner''s Sage exports).';
comment on table  public.sage_category_map      is 'Back-office menu category -> Sage bucket. Unmapped categories surface as warnings; the owner maps them.';
comment on column public.vendors.sage_vendor_id is 'Vendor ID in the owner''s Sage 50 company (e.g. 01-TWO HEADS). Needed for Purchases/Payments exports.';
