-- =============================================================================
-- Migration 0279 - R51: product image memory (onboarding image attach)
-- =============================================================================
-- Owner, verbatim (R51 bible section 0): "I want the image assignment to
-- happen on onboarding, which means the kb needs to remember past attachments
-- to products. It needs to be able to recommend ones from the content media
-- page, both unpublished and published images, with a confidence level."
--
--   product_image_memory   one row per (identity_key, media_asset_id): a
--                          person attached this media asset to the product
--                          with this identity key (S03 "vendor|category|family",
--                          no size) on the onboarding page. The next intake or
--                          Cultivera import of the same product recalls it
--                          first, at the remembered-pick confidence.
--     source               where the image came from when it was attached:
--                          library (picked from Content -> Media),
--                          import (a web URL imported then attached),
--                          memory (re-attached from this memory).
--     times_confirmed      +1 each time a person attaches it again.
--     last_pos_product_key the enrichment key it was last attached under.
--
-- Drafts-only (AGENTS.md): nothing here attaches an image by itself. A row is
-- written ONLY by the onboarding attach action after a person clicks Attach,
-- and it is read only to RECOMMEND.
--
-- Add-only and idempotent: one table, two indexes, RLS and grants. The app
-- reads it defensively, so recall still works (with less memory) before this
-- is applied.
-- =============================================================================

create table if not exists public.product_image_memory (
  id                    uuid primary key default gen_random_uuid(),
  identity_key          text not null check (length(identity_key) between 3 and 400),
  media_asset_id        uuid not null references public.media_assets(id) on delete cascade,
  source                text not null default 'library'
                          check (source in ('library', 'import', 'memory')),
  last_pos_product_key  text,
  times_confirmed       integer not null default 1 check (times_confirmed >= 1),
  first_confirmed_by    uuid,
  last_confirmed_by     uuid,
  first_confirmed_at    timestamptz not null default now(),
  last_confirmed_at     timestamptz not null default now(),
  constraint product_image_memory_once unique (identity_key, media_asset_id)
);

create index if not exists idx_product_image_memory_identity
  on public.product_image_memory (identity_key, last_confirmed_at desc);
create index if not exists idx_product_image_memory_asset
  on public.product_image_memory (media_asset_id);

comment on table public.product_image_memory is
  'R51: a person attached this media asset to the product with this identity key on onboarding. Read only to recommend; written only by the onboarding attach action.';

-- RLS and grants (admins read; the server writes with the service role).
alter table public.product_image_memory enable row level security;

drop policy if exists product_image_memory_admin_read on public.product_image_memory;
create policy product_image_memory_admin_read on public.product_image_memory
  for select using (public.is_admin());

revoke all on table public.product_image_memory from anon;
revoke all on table public.product_image_memory from authenticated;
grant select on table public.product_image_memory to authenticated;
grant select, insert, update, delete on table public.product_image_memory to service_role;
