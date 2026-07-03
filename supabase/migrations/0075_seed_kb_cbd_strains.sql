-- 0075_seed_kb_cbd_strains.sql
-- Seed of CBD-relevant strains grounded in VERIFIED WA state lab data
-- (DoltHub dolthub/cannabis-testing-wa), cross-referenced with the Cannabis
-- API for factual flavor tags. FACTS ONLY — no verbatim descriptions.
--
-- CBD relevance = modal strain chemotype 2 (balanced Type II) or 3
-- (CBD-dominant Type III), >= 5 lab tests (drops one-off outliers).
-- Idempotent: INSERT new by slug; ON CONFLICT only fills NULL/empty fields
-- (coalesce + deduped array append) so owner edits are never overwritten.
-- Drafts-only for data-steward review. Apply MANUALLY.
--
-- 40 strains (9 CBD-dominant, 31 balanced).

begin;

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('yummy', 'Yummy', 'hybrid', 'cbd', 'WA lab avg ~46.4% CBD / ~7.3% THC (45 tests, CBD-dominant (Type III))', '{"sweet","earthy","pungent"}'::text[], 'CBD-relevant strain — WA lab data shows ~46.4% CBD and ~7.3% THC across 45 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('acdc', 'ACDC', 'hybrid', 'cbd', 'WA lab avg ~28.5% CBD / ~7.7% THC (733 tests, CBD-dominant (Type III))', '{"earthy","pine","woody"}'::text[], 'CBD-relevant strain — WA lab data shows ~28.5% CBD and ~7.7% THC across 733 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('dancehall', 'Dancehall', 'hybrid', 'cbd', 'WA lab avg ~28.5% CBD / ~6.6% THC (35 tests, CBD-dominant (Type III))', '{"earthy","citrus","flowery"}'::text[], 'CBD-relevant strain — WA lab data shows ~28.5% CBD and ~6.6% THC across 35 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('sour tsunami', 'Sour Tsunami', 'hybrid', 'cbd', 'WA lab avg ~22.1% CBD / ~5.5% THC (346 tests, CBD-dominant (Type III))', '{"citrus","diesel","sweet"}'::text[], 'CBD-relevant strain — WA lab data shows ~22.1% CBD and ~5.5% THC across 346 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('suzy q', 'Suzy Q', 'hybrid', 'cbd', 'WA lab avg ~21.4% CBD / ~1.7% THC (21 tests, CBD-dominant (Type III))', '{"pine","earthy","spicy","herbal"}'::text[], 'CBD-relevant strain — WA lab data shows ~21.4% CBD and ~1.7% THC across 21 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('swiss tsunami', 'Swiss Tsunami', 'sativa', 'cbd', 'WA lab avg ~18.7% CBD / ~12% THC (12 tests, CBD-dominant (Type III))', '{"earthy","citrus","orange"}'::text[], 'CBD-relevant strain — WA lab data shows ~18.7% CBD and ~12% THC across 12 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('ringos gift', 'Ringos Gift', 'hybrid', 'cbd', 'WA lab avg ~15.7% CBD / ~8.4% THC (36 tests, CBD-dominant (Type III))', '{"earthy","pine","citrus"}'::text[], 'CBD-relevant strain — WA lab data shows ~15.7% CBD and ~8.4% THC across 36 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('charlottes web', 'Charlottes Web', 'sativa', 'cbd', 'WA lab avg ~14.4% CBD / ~10.5% THC (191 tests, CBD-dominant (Type III))', '{"earthy","flowery","sweet"}'::text[], 'CBD-relevant strain — WA lab data shows ~14.4% CBD and ~10.5% THC across 191 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('harle tsu', 'Harle Tsu', 'hybrid', 'cbd', 'WA lab avg ~13.5% CBD / ~9.2% THC (116 tests, CBD-dominant (Type III))', '{"earthy","woody","spicy","herbal"}'::text[], 'CBD-relevant strain — WA lab data shows ~13.5% CBD and ~9.2% THC across 116 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('frida', 'Frida', 'indica', 'balanced', 'WA lab avg ~27% CBD / ~13.7% THC (16 tests, balanced (Type II))', '{"lemon","earthy","pine"}'::text[], 'CBD-relevant strain — WA lab data shows ~27% CBD and ~13.7% THC across 16 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('swiss gold', 'Swiss Gold', 'sativa', 'balanced', 'WA lab avg ~25.7% CBD / ~20.3% THC (10 tests, balanced (Type II))', '{"diesel","citrus","berry"}'::text[], 'CBD-relevant strain — WA lab data shows ~25.7% CBD and ~20.3% THC across 10 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('haze wreck', 'Haze Wreck', 'sativa', 'balanced', 'WA lab avg ~21.2% CBD / ~20.3% THC (10 tests, balanced (Type II))', '{"citrus","pine","woody"}'::text[], 'CBD-relevant strain — WA lab data shows ~21.2% CBD and ~20.3% THC across 10 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('shurman 7', 'Shurman 7', 'hybrid', 'balanced', 'WA lab avg ~21% CBD / ~15.1% THC (12 tests, balanced (Type II))', '{"earthy","sweet","pine"}'::text[], 'CBD-relevant strain — WA lab data shows ~21% CBD and ~15.1% THC across 12 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('remedy', 'Remedy', 'indica', 'balanced', 'WA lab avg ~19.3% CBD / ~9.7% THC (189 tests, balanced (Type II))', '{"woody","earthy","citrus"}'::text[], 'CBD-relevant strain — WA lab data shows ~19.3% CBD and ~9.7% THC across 189 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('canna tsu', 'Canna Tsu', 'hybrid', 'balanced', 'WA lab avg ~18.9% CBD / ~8.4% THC (33 tests, balanced (Type II))', '{"woody","earthy","grapefruit"}'::text[], 'CBD-relevant strain — WA lab data shows ~18.9% CBD and ~8.4% THC across 33 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('treasure island', 'Treasure Island', 'hybrid', 'balanced', 'WA lab avg ~18.9% CBD / ~6.8% THC (13 tests, balanced (Type II))', '{"pepper","spicy","herbal","flowery"}'::text[], 'CBD-relevant strain — WA lab data shows ~18.9% CBD and ~6.8% THC across 13 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('aliens on moonshine', 'Aliens On Moonshine', 'indica', 'balanced', 'WA lab avg ~18.8% CBD / ~14% THC (163 tests, balanced (Type II))', '{"citrus","sage","grapefruit"}'::text[], 'CBD-relevant strain — WA lab data shows ~18.8% CBD and ~14% THC across 163 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('blue dynamite', 'Blue Dynamite', 'indica', 'balanced', 'WA lab avg ~17.5% CBD / ~12.7% THC (33 tests, balanced (Type II))', '{"berry","spicy","herbal","pine"}'::text[], 'CBD-relevant strain — WA lab data shows ~17.5% CBD and ~12.7% THC across 33 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('medihaze', 'Medihaze', 'sativa', 'balanced', 'WA lab avg ~16.2% CBD / ~12.1% THC (60 tests, balanced (Type II))', '{"earthy","sweet","spicy","herbal"}'::text[], 'CBD-relevant strain — WA lab data shows ~16.2% CBD and ~12.1% THC across 60 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('cbd kush', 'CBD Kush', 'hybrid', 'balanced', 'WA lab avg ~14.7% CBD / ~14.5% THC (18 tests, balanced (Type II))', '{"earthy","woody","spicy","herbal"}'::text[], 'CBD-relevant strain — WA lab data shows ~14.7% CBD and ~14.5% THC across 18 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('cannatonic', 'Cannatonic', 'hybrid', 'balanced', 'WA lab avg ~14.5% CBD / ~16.8% THC (271 tests, balanced (Type II))', '{"earthy","woody","sweet"}'::text[], 'CBD-relevant strain — WA lab data shows ~14.5% CBD and ~16.8% THC across 271 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('dance world', 'Dance World', 'sativa', 'balanced', 'WA lab avg ~13.7% CBD / ~24.9% THC (38 tests, balanced (Type II))', '{"earthy","citrus","spicy","herbal"}'::text[], 'CBD-relevant strain — WA lab data shows ~13.7% CBD and ~24.9% THC across 38 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('franks gift', 'Franks Gift', 'hybrid', 'balanced', 'WA lab avg ~13.6% CBD / ~11.1% THC (5 tests, balanced (Type II))', '{"skunk","woody","tobacco"}'::text[], 'CBD-relevant strain — WA lab data shows ~13.6% CBD and ~11.1% THC across 5 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('sweet and sour widow', 'Sweet And Sour Widow', 'indica', 'balanced', 'WA lab avg ~13.5% CBD / ~11.9% THC (87 tests, balanced (Type II))', '{"earthy","sweet","woody"}'::text[], 'CBD-relevant strain — WA lab data shows ~13.5% CBD and ~11.9% THC across 87 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('white dream', 'White Dream', 'hybrid', 'balanced', 'WA lab avg ~12% CBD / ~19.1% THC (8 tests, balanced (Type II))', '{"earthy","sweet","citrus"}'::text[], 'CBD-relevant strain — WA lab data shows ~12% CBD and ~19.1% THC across 8 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('hawaiian dream', 'Hawaiian Dream', 'sativa', 'balanced', 'WA lab avg ~11.6% CBD / ~8.8% THC (73 tests, balanced (Type II))', '{"sweet","tropical","pineapple"}'::text[], 'CBD-relevant strain — WA lab data shows ~11.6% CBD and ~8.8% THC across 73 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('stephen hawking kush', 'Stephen Hawking Kush', 'indica', 'balanced', 'WA lab avg ~11.5% CBD / ~16.7% THC (74 tests, balanced (Type II))', '{"earthy","woody","berry"}'::text[], 'CBD-relevant strain — WA lab data shows ~11.5% CBD and ~16.7% THC across 74 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('pennywise', 'Pennywise', 'indica', 'balanced', 'WA lab avg ~11.1% CBD / ~15.1% THC (158 tests, balanced (Type II))', '{"earthy","woody","sweet"}'::text[], 'CBD-relevant strain — WA lab data shows ~11.1% CBD and ~15.1% THC across 158 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('harlequin', 'Harlequin', 'sativa', 'balanced', 'WA lab avg ~10.8% CBD / ~18.2% THC (846 tests, balanced (Type II))', '{"earthy","sweet","woody"}'::text[], 'CBD-relevant strain — WA lab data shows ~10.8% CBD and ~18.2% THC across 846 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('grape krush', 'Grape Krush', 'indica', 'balanced', 'WA lab avg ~10.3% CBD / ~21.9% THC (12 tests, balanced (Type II))', '{"grape","sweet","berry"}'::text[], 'CBD-relevant strain — WA lab data shows ~10.3% CBD and ~21.9% THC across 12 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('nordle', 'Nordle', 'indica', 'balanced', 'WA lab avg ~9.8% CBD / ~12.2% THC (57 tests, balanced (Type II))', '{"sweet","citrus","pungent"}'::text[], 'CBD-relevant strain — WA lab data shows ~9.8% CBD and ~12.2% THC across 57 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('bubblegun', 'Bubblegun', 'hybrid', 'balanced', 'WA lab avg ~9.1% CBD / ~5.1% THC (15 tests, balanced (Type II))', '{"pepper","mint","blueberry"}'::text[], 'CBD-relevant strain — WA lab data shows ~9.1% CBD and ~5.1% THC across 15 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('cbd mango haze', 'CBD Mango Haze', 'sativa', 'balanced', 'WA lab avg ~8.4% CBD / ~21.8% THC (8 tests, balanced (Type II))', '{"mango","tropical","flowery"}'::text[], 'CBD-relevant strain — WA lab data shows ~8.4% CBD and ~21.8% THC across 8 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('cbd shark', 'CBD Shark', 'indica', 'balanced', 'WA lab avg ~8.3% CBD / ~22.3% THC (5 tests, balanced (Type II))', '{"pungent","nutty","earthy"}'::text[], 'CBD-relevant strain — WA lab data shows ~8.3% CBD and ~22.3% THC across 5 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('raw diesel', 'Raw Diesel', 'hybrid', 'balanced', 'WA lab avg ~8% CBD / ~9.6% THC (14 tests, balanced (Type II))', '{"earthy","diesel","citrus"}'::text[], 'CBD-relevant strain — WA lab data shows ~8% CBD and ~9.6% THC across 14 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('skunk haze', 'Skunk Haze', 'hybrid', 'balanced', 'WA lab avg ~7.3% CBD / ~16% THC (225 tests, balanced (Type II))', '{"earthy","woody","skunk"}'::text[], 'CBD-relevant strain — WA lab data shows ~7.3% CBD and ~16% THC across 225 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.75, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('cbd critical cure', 'CBD Critical Cure', 'indica', 'balanced', 'WA lab avg ~7.1% CBD / ~11.2% THC (26 tests, balanced (Type II))', '{"sweet","earthy","berry"}'::text[], 'CBD-relevant strain — WA lab data shows ~7.1% CBD and ~11.2% THC across 26 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('jamaican lion', 'Jamaican Lion', 'sativa', 'balanced', 'WA lab avg ~7% CBD / ~19.7% THC (15 tests, balanced (Type II))', '{"earthy","lime","tropical"}'::text[], 'CBD-relevant strain — WA lab data shows ~7% CBD and ~19.7% THC across 15 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('tesla', 'Tesla', 'hybrid', 'balanced', 'WA lab avg ~6.8% CBD / ~7.6% THC (6 tests, balanced (Type II))', '{"tropical","pepper","sweet"}'::text[], 'CBD-relevant strain — WA lab data shows ~6.8% CBD and ~7.6% THC across 6 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.55, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

insert into public.kb_strains (slug, name, strain_type, dominant_cannabinoid, potency_note, flavor_notes, summary, sources, confidence, active)
values ('super sour skunk', 'Super Sour Skunk', 'hybrid', 'balanced', 'WA lab avg ~5.9% CBD / ~11% THC (28 tests, balanced (Type II))', '{"citrus","earthy","diesel"}'::text[], 'CBD-relevant strain — WA lab data shows ~5.9% CBD and ~11% THC across 28 tests.', '{"dolthub/cannabis-testing-wa (WA state lab tests)"}'::text[], 0.65, true)
on conflict (slug) do update set
  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),
  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),
  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),
  flavor_notes = array(
    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e
  ),
  summary = coalesce(public.kb_strains.summary, excluded.summary),
  sources = array(
    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e
  ),
  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),
  updated_at = now();

commit;
