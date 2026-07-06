-- =============================================================================
-- 0095 — Internal Quality Control (IQC) samples + sample JSON import
-- =============================================================================
-- Owner's request (verbatim, item 4): "Samples come to us like regular products
-- do. With its own json to upload. I need you to add to the trade samples the
-- ability to assign samples to employees while also respecting any and all CCRS
-- compliance related requirements. It should be very easy for my manager and I
-- to assign samples and see how close we are to going over the limit. With
-- warnings and guardrails in place for protection. Also, there is a specific
-- type of sample that I believe has no limit, that are meant specifically for
-- the purchase manager. Please look into this and add a method for us to assign
-- him his samples in a way that is CCRS compliant."
--
-- COMPLIANCE FINDING (verified against verbatim WAC 314-55-096, WSR 25-08-032,
-- and Foster Garvey legal alert): there is NO unlimited sample category and NO
-- job-title exemption. A RETAILER's employee gets TWO SEPARATE quarterly
-- buckets per calendar quarter:
--   1. TRADE samples          — ≤ 30 units / employee / quarter  [096(1)(j)(vi)]
--   2. INTERNAL QUALITY CONTROL (IQC) — ≤ 50 units / employee / quarter, with a
--      sub-cap of ≤ 25 CONCENTRATE units / employee / quarter     [096(3)(c)]
-- The purchasing manager's product-evaluation samples are the IQC bucket — a
-- SECOND, LARGER 50-unit allowance, NOT unlimited. Building "unlimited" would be
-- a violation, so this migration models IQC as a capped second bucket.
--
-- IQC per-unit sizes DIFFER from trade samples [096(3)(a)]:
--   1 g cannabis flower · 1 g useable · 1 g concentrate · 10 mg THC infused.
-- IQC is exempt from ch.314-55 packaging/labeling, may NOT be consumed on the
-- licensed premises, and must record amount + employee in traceability (CCRS).
--
-- This migration:
--   1. adds a `category` column ('trade' | 'iqc') to trade_sample_events and
--      relaxes the product_type check to add 'flower' (IQC flower is distinct
--      from 'useable' with a 1 g cap).
--   2. adds IQC settings columns to trade_sample_settings.
--   3. adds sample_json_imports (the uploaded "samples-as-products" JSON).
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor AFTER 0094.
-- =============================================================================

-- ── trade_sample_settings: IQC caps + unit sizes ────────────────────────────
alter table public.trade_sample_settings
  -- IQC quarterly cap per employee (statute: 50) and concentrate sub-cap (25).
  add column if not exists iqc_units_per_employee        integer       not null default 50,
  add column if not exists iqc_concentrate_subcap        integer       not null default 25,
  -- IQC per-unit sizes (statute: 1 g flower / 1 g useable / 1 g concentrate /
  -- 10 mg THC infused). Stored so the owner can only lower them, never raise.
  add column if not exists iqc_max_flower_grams          numeric(10,3) not null default 1,
  add column if not exists iqc_max_useable_grams         numeric(10,3) not null default 1,
  add column if not exists iqc_max_concentrate_grams     numeric(10,3) not null default 1,
  add column if not exists iqc_max_infused_thc_mg        numeric(10,3) not null default 10;

-- ── trade_sample_events: category + expanded product_type ───────────────────
alter table public.trade_sample_events
  add column if not exists category text not null default 'trade'
        check (category in ('trade', 'iqc'));

-- Relax the product_type check to include 'flower' (IQC flower, 1 g cap).
-- Drop the old constraint if present, then add the widened one.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'trade_sample_events_product_type_check'
      and conrelid = 'public.trade_sample_events'::regclass
  ) then
    alter table public.trade_sample_events
      drop constraint trade_sample_events_product_type_check;
  end if;
end $$;

alter table public.trade_sample_events
  add constraint trade_sample_events_product_type_check
    check (product_type in ('useable', 'concentrate', 'infused', 'flower'));

create index if not exists trade_sample_events_category_idx
  on public.trade_sample_events (category);

-- ── sample_json_imports (samples arrive "like regular products, with its own json") ─
-- One row per uploaded JSON batch of incoming sample lots. The parsed rows can
-- then be recorded into the ledger and assigned out to employees.
create table if not exists public.sample_json_imports (
  id             uuid primary key default gen_random_uuid(),
  file_name      text,
  -- Raw uploaded JSON (jsonb) + a content hash so the same file is recognised.
  raw            jsonb,
  content_sha256 text,
  -- Summary of what parsed: how many lots / units the file described.
  lot_count      integer not null default 0,
  unit_count     integer not null default 0,
  notes          text,
  uploaded_by    uuid references public.staff_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sample_json_imports_created_idx
  on public.sample_json_imports (created_at desc);
create index if not exists sample_json_imports_hash_idx
  on public.sample_json_imports (content_sha256);

-- Optional link from an event to the import it came from.
alter table public.trade_sample_events
  add column if not exists import_id uuid
        references public.sample_json_imports(id) on delete set null;

drop trigger if exists sample_json_imports_set_updated_at on public.sample_json_imports;
create trigger sample_json_imports_set_updated_at
  before update on public.sample_json_imports
  for each row execute function public.set_updated_at();

-- ── RLS (match trade_sample_events: staff read/write) ───────────────────────
alter table public.sample_json_imports enable row level security;
drop policy if exists sample_json_imports_staff_all on public.sample_json_imports;
create policy sample_json_imports_staff_all on public.sample_json_imports
  for all using (public.is_staff()) with check (public.is_staff());

-- ── comments ────────────────────────────────────────────────────────────────
comment on column public.trade_sample_events.category is
  'trade = ≤30 units/employee/qtr [096(1)(j)(vi)]; iqc = ≤50 units/employee/qtr with ≤25 concentrate sub-cap [096(3)(c)]. Two separate buckets.';
comment on column public.trade_sample_settings.iqc_units_per_employee is
  'Internal quality control cap per employee per calendar quarter (statute 50). Owner may only lower it.';
comment on column public.trade_sample_settings.iqc_concentrate_subcap is
  'IQC concentrate sub-cap per employee per calendar quarter (statute 25).';
