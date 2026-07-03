-- =============================================================================
-- 0070 — KB product-category taxonomy (edibles, liquids, concentrates, topicals,
--        pre-rolls, vapes, …) for customer-facing sort/filter in the Knowledge
--        Base.
-- =============================================================================
-- The owner asked to expand the KB beyond strains so it can also describe the
-- validated PRODUCT types the store carries, with sort/filter options. This adds
-- a dedicated taxonomy table. Every field is customer-facing and market-factual
-- ONLY — there is still no place for medical or effect claims (WA I-502).
--
-- Each category maps to the WA CCRS `inventory_type` names it corresponds to, so
-- the taxonomy stays aligned with state compliance categories. `group_key` gives
-- the top-level product family used for grouped sort/filter in the UI.
--
-- Idempotent: create table if not exists; add columns/indexes if not exists.
-- Applied MANUALLY by the owner. Safe to run more than once.
-- =============================================================================

create table if not exists public.kb_product_categories (
  id            uuid primary key default gen_random_uuid(),
  -- Lowercase, trimmed, unique lookup key (e.g. 'live-resin').
  slug          text not null unique,
  name          text not null,                         -- display name ('Live Resin')
  group_key     text not null,                         -- flower | concentrate | vape | edible | liquid | topical
  summary       text,                                  -- 1-2 sentence factual, non-medical blurb
  aliases       text[] not null default '{}',          -- alternate names ('cart','510','budder')
  -- WA CCRS inventory_type names this customer-facing category maps to. Keeps the
  -- taxonomy aligned with state compliance categories for reporting/traceability.
  wa_inventory_types text[] not null default '{}',
  sort_order    integer not null default 0,            -- stable display order
  active        boolean not null default true,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_kb_prodcat_slug   on public.kb_product_categories(slug);
create index if not exists idx_kb_prodcat_group  on public.kb_product_categories(group_key);
create index if not exists idx_kb_prodcat_active on public.kb_product_categories(active) where active;

-- keep updated_at fresh on write (reuse the shared trigger fn if present)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_kb_product_categories_updated_at'
    ) then
      create trigger trg_kb_product_categories_updated_at
        before update on public.kb_product_categories
        for each row execute function public.set_updated_at();
    end if;
  end if;
end $$;
