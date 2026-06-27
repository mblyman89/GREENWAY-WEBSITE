-- =============================================================================
-- Greenway Back Office — Slice 2: POS Upload / Import / Staged Publish
-- Tables: pos_imports, pos_import_diagnostics, menu_versions, menu_items,
--         menu_variants. Plus RLS, enums, indexes, triggers.
--
-- Money is stored as integer minor units (cents). Timestamps are UTC.
-- Depends on Slice 1 (0001): staff_profiles, helper fns is_staff()/is_admin()/
-- current_staff_role(), set_updated_at(), and the private `media` storage bucket.
--
-- Flow: staff uploads PRODUCTS.xlsx + INVENTORIES.xlsx to the private `pos-raw`
-- bucket -> a pos_imports row is created (status uploaded) -> the transform runs
-- server-side and writes a STAGED menu_version + its menu_items/menu_variants +
-- diagnostics -> a manager reviews + publishes (status published), which marks
-- exactly one menu_version as published. The public site reads the single
-- published menu_version snapshot.
-- =============================================================================

-- ---------- enums ------------------------------------------------------------
do $$ begin
  create type pos_import_status as enum ('uploaded','processing','staged','published','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type menu_version_status as enum ('staged','published','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type diagnostic_severity as enum ('error','warning','info');
exception when duplicate_object then null; end $$;

-- ---------- pos_imports ------------------------------------------------------
-- One row per upload attempt. Stores raw-file hashes + storage keys so we can
-- detect duplicate uploads and trace any staged menu back to its source files.
create table if not exists public.pos_imports (
  id                     uuid primary key default gen_random_uuid(),
  uploaded_by            uuid references public.staff_profiles(id) on delete set null,
  products_storage_key   text,
  inventories_storage_key text,
  products_filename      text,
  inventories_filename   text,
  products_file_hash     text,
  inventories_file_hash  text,
  products_size_bytes    bigint,
  inventories_size_bytes bigint,
  status                 pos_import_status not null default 'uploaded',
  summary_json           jsonb,
  error_message          text,
  started_at             timestamptz,
  completed_at           timestamptz,
  published_at           timestamptz,
  published_by           uuid references public.staff_profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_pos_imports_status on public.pos_imports(status);
create index if not exists idx_pos_imports_created on public.pos_imports(created_at desc);
create index if not exists idx_pos_imports_hashes on public.pos_imports(products_file_hash, inventories_file_hash);

-- ---------- pos_import_diagnostics -------------------------------------------
-- Flattened diagnostics emitted by the transformer for one import run.
create table if not exists public.pos_import_diagnostics (
  id           uuid primary key default gen_random_uuid(),
  import_id    uuid not null references public.pos_imports(id) on delete cascade,
  severity     diagnostic_severity not null,
  code         text not null,
  message      text not null,
  context_json jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pos_diag_import on public.pos_import_diagnostics(import_id);
create index if not exists idx_pos_diag_severity on public.pos_import_diagnostics(severity);
create index if not exists idx_pos_diag_code on public.pos_import_diagnostics(code);

-- ---------- menu_versions ----------------------------------------------------
-- A staged or published snapshot of the menu produced by one import. At most one
-- row may be status='published' at a time (enforced by a partial unique index).
create table if not exists public.menu_versions (
  id            uuid primary key default gen_random_uuid(),
  import_id     uuid references public.pos_imports(id) on delete set null,
  status        menu_version_status not null default 'staged',
  item_count    integer not null default 0,
  variant_count integer not null default 0,
  vendor_count  integer not null default 0,
  hidden_count  integer not null default 0,
  error_count   integer not null default 0,
  warning_count integer not null default 0,
  summary_json  jsonb,
  notes         text,
  created_by    uuid references public.staff_profiles(id) on delete set null,
  published_at  timestamptz,
  published_by  uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_menu_versions_status on public.menu_versions(status);
create index if not exists idx_menu_versions_import on public.menu_versions(import_id);
create index if not exists idx_menu_versions_created on public.menu_versions(created_at desc);
-- Only one published version at any time.
create unique index if not exists uniq_menu_version_published
  on public.menu_versions((status = 'published')) where status = 'published';

-- ---------- menu_items -------------------------------------------------------
-- One row per menu card within a version. Mirrors GreenwayMenuItem from the
-- transformer (compounds + totalThc/totalCbd kept as jsonb for fidelity).
create table if not exists public.menu_items (
  id                    uuid primary key default gen_random_uuid(),
  menu_version_id       uuid not null references public.menu_versions(id) on delete cascade,
  source_item_id        text not null,
  name                  text not null,
  product_name          text,
  brand_name            text not null default '',
  vendor_name           text,
  category              text not null,
  filter_categories     text[] not null default '{}',
  pos_inventory_type    text,
  pos_inventory_category text,
  strain_type           text not null default 'unknown',
  strain_name           text,
  thc                   text,
  cbd                   text,
  total_thc_json        jsonb,
  total_cbd_json        jsonb,
  compounds_json        jsonb not null default '[]'::jsonb,
  description           text not null default '',
  price_label           text not null default '',
  price_minor_units     integer not null default 0,
  inventory_status      text not null default 'in-stock',
  hidden                boolean not null default false,
  hidden_reason         text,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_menu_items_version on public.menu_items(menu_version_id);
create index if not exists idx_menu_items_category on public.menu_items(menu_version_id, category);
create index if not exists idx_menu_items_brand on public.menu_items(menu_version_id, brand_name);
create index if not exists idx_menu_items_vendor on public.menu_items(menu_version_id, vendor_name);
create index if not exists idx_menu_items_hidden on public.menu_items(menu_version_id, hidden);
create index if not exists idx_menu_items_source on public.menu_items(menu_version_id, source_item_id);

-- ---------- menu_variants ----------------------------------------------------
create table if not exists public.menu_variants (
  id                uuid primary key default gen_random_uuid(),
  menu_item_id      uuid not null references public.menu_items(id) on delete cascade,
  source_variant_id text not null,
  label             text not null,
  price_minor_units integer not null default 0,
  inventory_level   integer not null default 0,
  medical           boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_menu_variants_item on public.menu_variants(menu_item_id);

-- ---------- updated_at triggers (reuse Slice 1 set_updated_at) ---------------
drop trigger if exists trg_pos_imports_updated on public.pos_imports;
create trigger trg_pos_imports_updated before update on public.pos_imports
  for each row execute function public.set_updated_at();

drop trigger if exists trg_menu_versions_updated on public.menu_versions;
create trigger trg_menu_versions_updated before update on public.menu_versions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.pos_imports             enable row level security;
alter table public.pos_import_diagnostics  enable row level security;
alter table public.menu_versions           enable row level security;
alter table public.menu_items              enable row level security;
alter table public.menu_variants           enable row level security;

-- pos_imports: active staff read; writes go through service role (server actions
-- that gate on permissions in the app layer), but allow staff insert/update so
-- the upload flow can also work with the anon/auth client if needed.
drop policy if exists pos_imports_staff_read on public.pos_imports;
create policy pos_imports_staff_read on public.pos_imports
  for select using (public.is_staff());
drop policy if exists pos_imports_staff_write on public.pos_imports;
create policy pos_imports_staff_write on public.pos_imports
  for all using (public.is_staff()) with check (public.is_staff());

-- diagnostics: staff read; inserts via service role during transform.
drop policy if exists pos_diag_staff_read on public.pos_import_diagnostics;
create policy pos_diag_staff_read on public.pos_import_diagnostics
  for select using (public.is_staff());

-- menu_versions: staff read all (staged + published); writes via service role.
drop policy if exists menu_versions_staff_read on public.menu_versions;
create policy menu_versions_staff_read on public.menu_versions
  for select using (public.is_staff());

-- menu_items: staff read all; PUBLIC may read items that belong to the single
-- published version (this is what powers the public /menu). No public write.
drop policy if exists menu_items_staff_read on public.menu_items;
create policy menu_items_staff_read on public.menu_items
  for select using (public.is_staff());
drop policy if exists menu_items_public_read_published on public.menu_items;
create policy menu_items_public_read_published on public.menu_items
  for select using (
    exists (
      select 1 from public.menu_versions mv
      where mv.id = menu_items.menu_version_id and mv.status = 'published'
    )
  );

-- menu_variants: same visibility rules as their parent item.
drop policy if exists menu_variants_staff_read on public.menu_variants;
create policy menu_variants_staff_read on public.menu_variants
  for select using (public.is_staff());
drop policy if exists menu_variants_public_read_published on public.menu_variants;
create policy menu_variants_public_read_published on public.menu_variants
  for select using (
    exists (
      select 1
      from public.menu_items mi
      join public.menu_versions mv on mv.id = mi.menu_version_id
      where mi.id = menu_variants.menu_item_id and mv.status = 'published'
    )
  );

-- =============================================================================
-- Private storage bucket for raw POS workbook uploads (signed-URL access only)
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('pos-raw', 'pos-raw', false)
on conflict (id) do nothing;

drop policy if exists pos_raw_staff_read on storage.objects;
create policy pos_raw_staff_read on storage.objects
  for select using (bucket_id = 'pos-raw' and public.is_staff());

drop policy if exists pos_raw_staff_write on storage.objects;
create policy pos_raw_staff_write on storage.objects
  for all using (bucket_id = 'pos-raw' and public.is_staff())
  with check (bucket_id = 'pos-raw' and public.is_staff());

-- =============================================================================
-- publish_menu_version(version_id): atomically promote a staged version to
-- published. Archives the previously-published version and stamps the import.
-- Called by the server action (service role) after manager approval + no errors.
-- =============================================================================
create or replace function public.publish_menu_version(p_version_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_import uuid;
begin
  -- Archive any currently published version.
  update public.menu_versions
    set status = 'archived', updated_at = now()
    where status = 'published' and id <> p_version_id;

  -- Promote the target version.
  update public.menu_versions
    set status = 'published', published_at = now(), published_by = p_actor, updated_at = now()
    where id = p_version_id
    returning import_id into v_import;

  if v_import is not null then
    update public.pos_imports
      set status = 'published', published_at = now(), published_by = p_actor, updated_at = now()
      where id = v_import;

    -- Mark sibling imports' staged versions as superseded (archived) so only the
    -- newly published snapshot is live; older staged drafts remain for history.
    update public.menu_versions
      set status = 'archived', updated_at = now()
      where status = 'staged' and import_id <> v_import;
  end if;
end $$;
