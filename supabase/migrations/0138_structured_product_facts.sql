-- 0138_structured_product_facts.sql  (PROGRAM 3 / SLICE 54)
--
-- Golden-record groundwork (docs/data-governance.md, Rules 1.3 + 1.4):
-- "Fields before contents" — add the dedicated boxes for facts that today
-- are trapped in product names, and move strain TYPE words out of the
-- strain NAME field (owner-approved cleanup).
--
-- 1) inventory_lots: strain_type + structured dose/measure facts + provenance.
-- 2) menu_items:     structured dose/measure facts + provenance.
-- 3) Data fix:       strip Indica/Sativa/Hybrid words out of strain_name,
--                    setting strain_type where it was unknown. CBD is
--                    deliberately NOT treated as a strain-type word here:
--                    real strain names carry it ("Xtra Dragon CBD"), so a
--                    blanket strip would corrupt genuine names (never guess).
--
-- Apply manually (owner). Idempotent: add column if not exists + re-runnable
-- updates (the regex predicates no longer match once cleaned).

-- ── 1) inventory_lots ─────────────────────────────────────────────────────
alter table public.inventory_lots add column if not exists strain_type            text;      -- indica | sativa | hybrid | null
alter table public.inventory_lots add column if not exists servings_per_pack      numeric;   -- e.g. 10
alter table public.inventory_lots add column if not exists mg_per_serving         numeric;   -- e.g. 10 (mg THC per serving)
alter table public.inventory_lots add column if not exists package_thc_mg         numeric;   -- package-TOTAL THC mg (distinct fact from per-serving)
alter table public.inventory_lots add column if not exists package_cbd_mg         numeric;   -- package-TOTAL CBD mg
alter table public.inventory_lots add column if not exists minor_cannabinoids_json jsonb not null default '[]'::jsonb; -- [{"type":"cbn","value":"100","unit":"mg"}]
alter table public.inventory_lots add column if not exists ratio_label            text;      -- "1:1", "4:1", "1:1:1" — sortable/filterable
alter table public.inventory_lots add column if not exists net_weight_grams       numeric;   -- solid net weight, normalized to grams
alter table public.inventory_lots add column if not exists net_volume_ml          numeric;   -- liquid net volume, normalized to ml
alter table public.inventory_lots add column if not exists fact_provenance        jsonb not null default '{}'::jsonb; -- {"package_thc_mg":"name","strain_type":"column"}

create index if not exists inventory_lots_strain_type_idx on public.inventory_lots (strain_type);
create index if not exists inventory_lots_ratio_idx       on public.inventory_lots (ratio_label);

-- ── 2) menu_items ─────────────────────────────────────────────────────────
alter table public.menu_items add column if not exists servings_per_pack      numeric;
alter table public.menu_items add column if not exists mg_per_serving         numeric;
alter table public.menu_items add column if not exists package_thc_mg         numeric;
alter table public.menu_items add column if not exists package_cbd_mg         numeric;
alter table public.menu_items add column if not exists ratio_label            text;
alter table public.menu_items add column if not exists net_weight_grams       numeric;
alter table public.menu_items add column if not exists net_volume_ml          numeric;
alter table public.menu_items add column if not exists fact_provenance        jsonb not null default '{}'::jsonb;

create index if not exists idx_menu_items_ratio on public.menu_items (menu_version_id, ratio_label);

-- ── 3) strain-name cleanup (owner-approved) ───────────────────────────────
-- 3a. Bare type-only strain names ("Hybrid", "Sativa", "Indica"):
--     the whole value IS the type — move it and null the name.
update public.inventory_lots
set strain_type = lower(btrim(strain_name)),
    strain_name = null
where btrim(strain_name) ~* '^(indica|sativa|hybrid)$'
  and strain_type is null;

update public.menu_items
set strain_type = lower(btrim(strain_name)),
    strain_name = null
where btrim(strain_name) ~* '^(indica|sativa|hybrid)$'
  and strain_type in ('unknown', '');

-- 3b. Embedded type words ("Chocolate Turtle Sativa", "Cinnamon (Sativa)",
--     "Sativa Dragon Balls"): capture the FIRST type word into strain_type
--     (only when type was unset), strip ALL occurrences (parenthesized or
--     bare, word-bounded) from the name, collapse whitespace, trim leftover
--     separators. Deterministic rule — no guessing.
update public.inventory_lots
set strain_type = coalesce(strain_type,
      lower((regexp_match(strain_name, '(indica|sativa|hybrid)', 'i'))[1])),
    strain_name = nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
      strain_name,
      '\(\s*(indica|sativa|hybrid)\s*\)', ' ', 'gi'),
      '\m(indica|sativa|hybrid)\M',       ' ', 'gi'),
      '\s+',                              ' ', 'g'),
      ' -–—(),'), '')
where strain_name ~* '\m(indica|sativa|hybrid)\M';

update public.menu_items
set strain_type = case when strain_type in ('unknown', '')
      then lower((regexp_match(strain_name, '(indica|sativa|hybrid)', 'i'))[1])
      else strain_type end,
    strain_name = nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
      strain_name,
      '\(\s*(indica|sativa|hybrid)\s*\)', ' ', 'gi'),
      '\m(indica|sativa|hybrid)\M',       ' ', 'gi'),
      '\s+',                              ' ', 'g'),
      ' -–—(),'), '')
where strain_name ~* '\m(indica|sativa|hybrid)\M';
