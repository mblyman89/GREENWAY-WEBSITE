-- ===========================================================================
-- 0269_product_tags.sql
--
-- R49-S5 (owner request: "a tag system ... a New tag that is automatically
-- applied when a product is first put on the menu and removed 14 days later,
-- with a Tag Settings page where I can create tags, pick colours and add or
-- remove them by hand").
--
-- THREE TABLES, all keyed by the stable product key the whole app already
-- uses (menu_items.source_item_id = inventory_lots.pos_product_key), and NONE
-- of them references menu_versions / menu_items (those are WIPE in the
-- factory reset; these are KEEP, and a KEEP table may not point into a WIPE
-- table):
--
--   tag_definitions          the owner's tags: label, colour, order, on/off,
--                            and an optional automatic rule. One built-in
--                            row, slug 'new', rule 'new_window', 14 days.
--   product_tag_assignments  the tags the owner applied BY HAND to a product.
--   product_first_seen       the first time each product key was on a
--                            PUBLISHED menu. The "New" tag is a pure time
--                            window over this (now - first_published_at <
--                            window_days), so nothing has to run at midnight
--                            to take the tag off: it simply stops matching.
--
-- product_first_seen is BACKFILLED here from every menu version that was
-- ever actually published (published_at is not null) and is not a test
-- version, so products already on the menu do not all light up as "New" the
-- day this is applied. After that the app stamps new keys right after each
-- successful publish (insert ... on conflict do nothing: the first stamp
-- wins forever).
--
-- The website works BEFORE this is applied: no tags show, the Tags filter is
-- hidden, and Inventory > Tags says "apply migration 0269".
--
-- FACTORY RESET: all three are KEEP in factory-reset-core.ts (owner
-- configuration / product history, like product_enrichments); the reset
-- function's pinned WIPE list from 0240 is deliberately not reopened.
-- IDEMPOTENT (create if not exists, guarded constraints, drop/create
-- policies, on conflict do nothing). APPLY MANUALLY in the Supabase SQL
-- editor.
-- ROLLBACK: supabase/rollbacks/0269_product_tags.rollback.sql
-- ===========================================================================

do $precheck$
begin
  if to_regprocedure('public.is_staff()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0269 depends on is_staff() from 0001';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0269 depends on is_admin() from 0001';
  end if;
  if to_regclass('public.staff_profiles') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0269 depends on staff_profiles from 0001';
  end if;
  if to_regclass('public.menu_versions') is null or to_regclass('public.menu_items') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0269 backfill reads menu_versions / menu_items from 0002';
  end if;
end
$precheck$;

-- ---------------------------------------------------------------------------
-- tag_definitions
-- ---------------------------------------------------------------------------
create table if not exists public.tag_definitions (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  label       text not null,
  -- '#rrggbb' background; the text colour is chosen for contrast in the app
  color       text not null default '#2f6b3a',
  -- 'none' = applied by hand only; 'new_window' = on for window_days after
  -- the product was first published
  auto_rule   text not null default 'none',
  window_days integer not null default 14,
  sort_order  integer not null default 100,
  enabled     boolean not null default true,
  -- false hides the tag from the public menu (staff-only label)
  show_on_menu boolean not null default true,
  created_by  uuid references public.staff_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tag_definitions is
  'R49-S5: owner product tags (label, colour, order). auto_rule new_window = shown for window_days after product_first_seen.first_published_at.';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'tag_definitions_slug_chk'
                   and conrelid = 'public.tag_definitions'::regclass) then
    alter table public.tag_definitions add constraint tag_definitions_slug_chk
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tag_definitions_label_chk'
                   and conrelid = 'public.tag_definitions'::regclass) then
    alter table public.tag_definitions add constraint tag_definitions_label_chk
      check (char_length(btrim(label)) between 1 and 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tag_definitions_color_chk'
                   and conrelid = 'public.tag_definitions'::regclass) then
    alter table public.tag_definitions add constraint tag_definitions_color_chk
      check (color ~ '^#[0-9a-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tag_definitions_rule_chk'
                   and conrelid = 'public.tag_definitions'::regclass) then
    alter table public.tag_definitions add constraint tag_definitions_rule_chk
      check (auto_rule in ('none', 'new_window'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tag_definitions_window_chk'
                   and conrelid = 'public.tag_definitions'::regclass) then
    alter table public.tag_definitions add constraint tag_definitions_window_chk
      check (window_days between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tag_definitions_sort_chk'
                   and conrelid = 'public.tag_definitions'::regclass) then
    alter table public.tag_definitions add constraint tag_definitions_sort_chk
      check (sort_order between 0 and 10000);
  end if;
end
$c$;

create unique index if not exists tag_definitions_slug_uq on public.tag_definitions (slug);

drop trigger if exists tag_definitions_set_updated_at on public.tag_definitions;
create trigger tag_definitions_set_updated_at
  before update on public.tag_definitions
  for each row execute function public.set_updated_at();

-- The built-in "New" tag (the owner can rename, recolour, change the window
-- or turn it off; the app will not let it be deleted).
insert into public.tag_definitions (slug, label, color, auto_rule, window_days, sort_order)
values ('new', 'New', '#c2410c', 'new_window', 14, 0)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- product_tag_assignments (hand-applied tags)
-- ---------------------------------------------------------------------------
create table if not exists public.product_tag_assignments (
  id              uuid primary key default gen_random_uuid(),
  tag_id          uuid not null references public.tag_definitions(id) on delete cascade,
  pos_product_key text not null,
  applied_by      uuid references public.staff_profiles(id) on delete set null,
  applied_at      timestamptz not null default now()
);

comment on table public.product_tag_assignments is
  'R49-S5: tags the owner applied by hand to a product (pos_product_key = menu_items.source_item_id). No FK to menu tables on purpose (they are WIPE in the factory reset).';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_tag_assignments_key_chk'
                   and conrelid = 'public.product_tag_assignments'::regclass) then
    alter table public.product_tag_assignments add constraint product_tag_assignments_key_chk
      check (char_length(pos_product_key) between 1 and 200);
  end if;
end
$c$;

create unique index if not exists product_tag_assignments_uq
  on public.product_tag_assignments (tag_id, pos_product_key);
create index if not exists product_tag_assignments_key_idx
  on public.product_tag_assignments (pos_product_key);

-- ---------------------------------------------------------------------------
-- product_first_seen
-- ---------------------------------------------------------------------------
create table if not exists public.product_first_seen (
  pos_product_key    text primary key,
  first_published_at timestamptz not null,
  -- 'backfill' (from menu history when 0269 was applied) or 'publish'
  source             text not null default 'publish',
  created_at         timestamptz not null default now()
);

comment on table public.product_first_seen is
  'R49-S5: first time each product key appeared on a PUBLISHED menu. First stamp wins (insert on conflict do nothing). Drives the automatic New tag.';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_first_seen_source_chk'
                   and conrelid = 'public.product_first_seen'::regclass) then
    alter table public.product_first_seen add constraint product_first_seen_source_chk
      check (source in ('backfill', 'publish', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_first_seen_key_chk'
                   and conrelid = 'public.product_first_seen'::regclass) then
    alter table public.product_first_seen add constraint product_first_seen_key_chk
      check (char_length(pos_product_key) between 1 and 200);
  end if;
end
$c$;

create index if not exists product_first_seen_time_idx
  on public.product_first_seen (first_published_at desc);

-- Backfill from menu history: only versions that were really published and
-- are not test versions. Archived versions keep their published_at, so a
-- product that was on last month's menu keeps last month's date.
insert into public.product_first_seen (pos_product_key, first_published_at, source)
select mi.source_item_id, min(mv.published_at), 'backfill'
  from public.menu_items mi
  join public.menu_versions mv on mv.id = mi.menu_version_id
 where mv.published_at is not null
   and coalesce(mv.is_test, false) = false
   and mi.source_item_id is not null
   and char_length(mi.source_item_id) between 1 and 200
 group by mi.source_item_id
on conflict (pos_product_key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: staff read, admin write (the app writes with the service role)
-- ---------------------------------------------------------------------------
alter table public.tag_definitions enable row level security;
drop policy if exists "tag_definitions staff read" on public.tag_definitions;
create policy "tag_definitions staff read" on public.tag_definitions
  for select using (public.is_staff());
drop policy if exists "tag_definitions admin write" on public.tag_definitions;
create policy "tag_definitions admin write" on public.tag_definitions
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.tag_definitions to service_role;

alter table public.product_tag_assignments enable row level security;
drop policy if exists "product_tag_assignments staff read" on public.product_tag_assignments;
create policy "product_tag_assignments staff read" on public.product_tag_assignments
  for select using (public.is_staff());
drop policy if exists "product_tag_assignments admin write" on public.product_tag_assignments;
create policy "product_tag_assignments admin write" on public.product_tag_assignments
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.product_tag_assignments to service_role;

alter table public.product_first_seen enable row level security;
drop policy if exists "product_first_seen staff read" on public.product_first_seen;
create policy "product_first_seen staff read" on public.product_first_seen
  for select using (public.is_staff());
drop policy if exists "product_first_seen admin write" on public.product_first_seen;
create policy "product_first_seen admin write" on public.product_first_seen
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.product_first_seen to service_role;

notify pgrst, 'reload schema';
