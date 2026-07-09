-- =============================================================================
-- 0101 — Retire IQC (internal quality control) samples entirely
-- =============================================================================
-- Owner's request (verbatim, H16b Samples Slice C): "for slice c, lets retire
-- it entirely. I will not be a producer processor and there is no chance we
-- will be allowed to sample our own inventory so lets kill it."
--
-- COMPLIANCE FINDING (verified against WAC 314-55-096 as amended by
-- WSR 25-08-032, eff. 4/26/25, and CIB 132): IQC (internal quality control) is
-- EXPLICITLY a producer/processor allowance [096(3)]. A RETAILER has exactly
-- ONE sample category — the TRADE sample. There is no lawful path for a
-- retailer to sample its own inventory, so IQC is retired everywhere:
--   • trade_sample_events.category is narrowed back to 'trade'-only.
--   • product_type drops 'flower' (the IQC-only 1 g flower unit); a retailer's
--     flower sample is recorded as 'useable'.
--   • the six IQC settings columns are dropped from trade_sample_settings.
--
-- This REVERSES the IQC portions of migration 0095. The sample_json_imports
-- table and trade_sample_events.import_id from 0095 are LEFT IN PLACE — they
-- are trade-sample intake plumbing, not IQC.
--
-- SAFETY: this migration first HARD-STOPS if any 'iqc'-category events exist, so
-- narrowing the CHECK constraint can never orphan or silently drop live data.
-- If it raises, the owner must reclassify or remove those rows first.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor AFTER 0100.
-- =============================================================================

-- ── 0. Safety guard: refuse to run if any IQC events exist ───────────────────
do $$
declare
  n_iqc      bigint := 0;
  n_flower   bigint := 0;
begin
  -- category column may already be narrowed on a re-run; guard on existence.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'trade_sample_events'
      and column_name  = 'category'
  ) then
    execute 'select count(*) from public.trade_sample_events where category = ''iqc'''
      into n_iqc;
  end if;

  execute 'select count(*) from public.trade_sample_events where product_type = ''flower'''
    into n_flower;

  if n_iqc > 0 then
    raise exception
      'Cannot retire IQC: % trade_sample_events row(s) still have category = ''iqc''. Reclassify or remove them first.',
      n_iqc;
  end if;

  if n_flower > 0 then
    raise exception
      'Cannot retire IQC: % trade_sample_events row(s) still have product_type = ''flower''. Reclassify them to ''useable'' first.',
      n_flower;
  end if;
end $$;

-- ── 1. Narrow trade_sample_events.category back to 'trade'-only ──────────────
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'trade_sample_events_category_check'
      and conrelid = 'public.trade_sample_events'::regclass
  ) then
    alter table public.trade_sample_events
      drop constraint trade_sample_events_category_check;
  end if;
end $$;

alter table public.trade_sample_events
  alter column category set default 'trade';

alter table public.trade_sample_events
  add constraint trade_sample_events_category_check
    check (category in ('trade'));

-- ── 2. Drop 'flower' from the product_type CHECK ────────────────────────────
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
    check (product_type in ('useable', 'concentrate', 'infused'));

-- ── 3. Drop the IQC settings columns from trade_sample_settings ─────────────
alter table public.trade_sample_settings
  drop column if exists iqc_units_per_employee,
  drop column if exists iqc_concentrate_subcap,
  drop column if exists iqc_max_flower_grams,
  drop column if exists iqc_max_useable_grams,
  drop column if exists iqc_max_concentrate_grams,
  drop column if exists iqc_max_infused_thc_mg;

-- ── 4. comments ─────────────────────────────────────────────────────────────
comment on column public.trade_sample_events.category is
  'A WA retailer has exactly one sample category: trade [WAC 314-55-096(1)]. IQC is producer/processor-only [096(3)] and was retired in migration 0101. Column retained (single-value) for explicitness.';
