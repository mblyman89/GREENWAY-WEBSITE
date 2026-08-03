-- =============================================================================
-- INVENTORY / per-product website Type + Category OVERRIDE  (owner: run by hand)
--
-- Lets the owner re-file ONE product's website Type and/or Category from the
-- Inventory Detail "corrections" section -- exactly like the onboarding
-- approval card, but for ANY product regardless of origin (Cultivera one-time
-- import + transformer OR natively onboarded). It is a READ-TIME overlay:
-- nothing about the versioned menu build, the POS import, staging or publishing
-- changes. The override simply WINS at the moment the website category is read
-- (menu render + back-office resolver), keyed by the stable POS product key
-- (menu_items.source_item_id === inventory_lots.pos_product_key).
--
-- It NEVER touches the CCRS/LCB source-of-truth columns
-- (inventory_lots.category / inventory_lots.inventory_type stay verbatim).
--
--   pos_product_key  : the stable product key this override applies to (PK).
--   website_category : OUR website category VALUE (website_category_types.value),
--                      e.g. 'concentrate'. Null = no category override.
--   house_type       : OUR product-type LABEL (inventory_types.label),
--                      e.g. 'Live Resin'. Null = no type override.
--   note             : optional free-text reason for the audit-minded owner.
--   updated_by       : the admin who last set it (auth.users.id), nullable.
--
-- The server validates every write against the LIVE registries
-- (website_category_types / inventory_types) before it lands here, so no CHECK
-- constraint is needed and new owner-created values are always legal picks.
--
-- Depends on nothing beyond auth.users. Apply manually (owner).
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.product_classification_overrides (
  pos_product_key  text primary key,
  website_category text,
  house_type       text,
  note             text,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.product_classification_overrides is
  '0150: per-product website Type/Category override set from the Inventory Detail corrections section. Read-time overlay only; never touches CCRS/LCB columns or the versioned menu build. Keyed by pos_product_key (= menu_items.source_item_id).';
comment on column public.product_classification_overrides.website_category is
  'OUR website category VALUE (website_category_types.value). Null = no category override.';
comment on column public.product_classification_overrides.house_type is
  'OUR product-type LABEL (inventory_types.label). Null = no type override.';

-- ---------------------------------------------------------------------------
-- Row-Level Security: staff may read; only admins may write.
-- (Mirrors the website_category_types / inventory_types convention from 0035.)
-- ---------------------------------------------------------------------------
alter table public.product_classification_overrides enable row level security;

drop policy if exists product_classification_overrides_read on public.product_classification_overrides;
create policy product_classification_overrides_read on public.product_classification_overrides
  for select using (public.is_staff());

drop policy if exists product_classification_overrides_write on public.product_classification_overrides;
create policy product_classification_overrides_write on public.product_classification_overrides
  for all using (public.is_admin()) with check (public.is_admin());
