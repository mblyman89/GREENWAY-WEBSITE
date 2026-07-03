-- 0073_kb_strain_leaning_ratio.sql
-- ---------------------------------------------------------------------------
-- Slice 8g — capture the sativa/indica RATIO and the leaning designation on
-- kb_strains, so a customer can see HOW a hybrid leans (e.g. "70% Sativa /
-- 30% Indica", a sativa-leaning hybrid).
--
-- Grounded in verified sources (docs/STRAIN_DATA_SOURCES.md): the owner-provided
-- cannabis_strains.csv `type_ratio` column ("30% Indica / 70% Sativa"), plus the
-- ratio wording mined from The Cannabis API descriptions. WEBSITE + BACK-OFFICE
-- ONLY — CCRS is hard-set (Indica/Sativa/Hybrid) and is NOT touched here.
--
-- Standing rules: idempotent (safe to re-run), applied MANUALLY by owner, never
-- guesses (columns are additive + nullable; existing data untouched).
-- ---------------------------------------------------------------------------

-- Numeric split (0-100). NULL = unknown. When present, indica + sativa (+ any
-- ruderalis) is expected to sum ~100, but we don't hard-constrain the sum so a
-- rare source oddity never blocks an idempotent re-run.
alter table public.kb_strains add column if not exists indica_pct    smallint;
alter table public.kb_strains add column if not exists sativa_pct    smallint;
alter table public.kb_strains add column if not exists ruderalis_pct smallint;

-- Derived leaning designation, kept alongside the base strain_type so the app can
-- show "Sativa-Leaning Hybrid" without re-deriving. Canonical tokens match
-- src/lib/menu/strain-taxonomy.ts: indica | sativa | hybrid | indica-hybrid |
-- sativa-hybrid | cbd | unknown.
alter table public.kb_strains add column if not exists leaning text;

-- Provenance for the ratio (which source produced it), for the data-steward.
alter table public.kb_strains add column if not exists ratio_source text;

-- Sanity bounds (idempotent): only add each constraint if it isn't already there.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kb_strains_indica_pct_range'
  ) then
    alter table public.kb_strains
      add constraint kb_strains_indica_pct_range
      check (indica_pct is null or (indica_pct >= 0 and indica_pct <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kb_strains_sativa_pct_range'
  ) then
    alter table public.kb_strains
      add constraint kb_strains_sativa_pct_range
      check (sativa_pct is null or (sativa_pct >= 0 and sativa_pct <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kb_strains_ruderalis_pct_range'
  ) then
    alter table public.kb_strains
      add constraint kb_strains_ruderalis_pct_range
      check (ruderalis_pct is null or (ruderalis_pct >= 0 and ruderalis_pct <= 100));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'kb_strains_leaning_values'
  ) then
    alter table public.kb_strains
      add constraint kb_strains_leaning_values
      check (leaning is null or leaning in (
        'indica','sativa','hybrid','indica-hybrid','sativa-hybrid','cbd','unknown'
      ));
  end if;
end $$;

comment on column public.kb_strains.indica_pct    is 'Indica share 0-100 (website/back-office only; NOT CCRS).';
comment on column public.kb_strains.sativa_pct    is 'Sativa share 0-100 (website/back-office only; NOT CCRS).';
comment on column public.kb_strains.ruderalis_pct is 'Ruderalis share 0-100 (autoflower genetics), usually null.';
comment on column public.kb_strains.leaning       is 'Derived leaning designation token (matches strain-taxonomy.ts).';
comment on column public.kb_strains.ratio_source  is 'Provenance of the ratio (e.g. cannabis_strains.csv type_ratio).';
