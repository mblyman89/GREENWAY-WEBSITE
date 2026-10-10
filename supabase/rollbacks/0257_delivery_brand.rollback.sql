-- Rollback for 0257_delivery_brand.sql (R37 S5).
-- Drops only what 0257 added. Brands already written onto lots, drafts and
-- menu cards stay (they live in columns that existed before 0257); only the
-- per-vendor memory and the per-delivery choice are forgotten.
drop index if exists public.inbound_manifests_brand_idx;
drop index if exists public.vendors_default_brand_idx;
alter table public.inbound_manifests drop column if exists brand_id;
alter table public.vendors drop column if exists default_brand_id;
notify pgrst, 'reload schema';
