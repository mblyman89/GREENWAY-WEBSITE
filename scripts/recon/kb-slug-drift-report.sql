-- scripts/recon/kb-slug-drift-report.sql  (R25 B)  READ-ONLY. Changes nothing.
--
-- Owner (R25, verbatim): "I also would like you to build the brand form use
-- dashes and other types of things like using dashes."
--
-- From R25 B on, every KB form writes DASHED slugs (kb-slug-input-core). Rows
-- saved BEFORE that may still carry a spaced / uppercase / edge-dash slug.
-- This report lists them, the dashed slug they would have, and whether a
-- dashed twin ALREADY exists (then the two are the same brand split in two,
-- and a person decides which survives: never merged automatically).
--
-- The dashed expression below is slug-core dashedSlug() in SQL:
--   trim -> lower -> every run of non [a-z0-9] becomes '-' -> strip edge '-'.
-- (Verified equal to dashedSlug on Postgres 15 in the build sandbox.)
--
-- Paste into the Supabase SQL editor. Empty result = nothing to repair.

with rows as (
  select 'kb_brands'::text as tbl, id, slug, name as label, active::text as state
    from public.kb_brands
  union all
  select 'kb_product_categories', id, slug, name, active::text
    from public.kb_product_categories
  union all
  select 'kb_faqs', id, slug, question, status
    from public.kb_faqs
),
dashed as (
  select r.*,
         regexp_replace(regexp_replace(lower(btrim(r.slug)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g') as dashed_slug
    from rows r
)
select d.tbl,
       d.id,
       d.slug        as current_slug,
       d.dashed_slug as dashed_slug,
       d.label,
       d.state,
       exists (
         select 1 from rows t
          where t.tbl = d.tbl and t.slug = d.dashed_slug and t.id <> d.id
       ) as dashed_twin_exists
  from dashed d
 where d.slug is distinct from d.dashed_slug
 order by d.tbl, d.slug;
