-- ===========================================================================
-- 0257_delivery_brand.sql
--
-- R37 S5 (owner-requested). ONE BRAND FOR A WHOLE DELIVERY, REMEMBERED PER
-- VENDOR.
--
-- Owner (verbatim, abridged): "add a brand field at the top of the page in
-- the ai section that lets me set a brand for the whole manifest, or to set
-- them individually in the product rows bellow. This feature should update
-- the vendor record in the vendors page. This field should be auto filled
-- after the first time the manifest comes in so we only have to set it the
-- one time."
--
-- WHAT THIS ADDS - two nullable columns, nothing else:
--   vendors.default_brand_id  -> brands(id)  the brand remembered for this
--       vendor. Intake fills it into a manifest line that carries NO brand
--       label (a line whose label named some other brand is never
--       overwritten - delivery-brand-core intakeBrandForLine). Set from
--       Inventory -> Product onboarding (delivery brand field) or Admin ->
--       Vendors.
--   inbound_manifests.brand_id -> brands(id)  the brand chosen for this
--       delivery (the field's own value).
-- Both are ON DELETE SET NULL: deleting or merging a brand never deletes a
-- vendor or a delivery, it only forgets the default.
--
-- No backfill: nothing is guessed for existing vendors. The first delivery
-- the owner brands sets it.
--
-- IDEMPOTENT (add column if not exists, create index if not exists).
-- APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0257_delivery_brand.rollback.sql
-- FACTORY RESET: no new table. vendors (KEEP) keeps its default brand;
-- inbound_manifests (WIPE) takes its brand_id with it.
-- ===========================================================================

alter table public.vendors
  add column if not exists default_brand_id uuid references public.brands(id) on delete set null;

alter table public.inbound_manifests
  add column if not exists brand_id uuid references public.brands(id) on delete set null;

create index if not exists vendors_default_brand_idx on public.vendors (default_brand_id);
create index if not exists inbound_manifests_brand_idx on public.inbound_manifests (brand_id);

comment on column public.vendors.default_brand_id is
  'R37 S5: the brand remembered for this vendor. Intake fills it into manifest lines with NO brand label (never over a label that named another brand). Set from Product onboarding or Admin -> Vendors.';
comment on column public.inbound_manifests.brand_id is
  'R37 S5: the brand chosen for this whole delivery on Product onboarding (rows may override one by one).';

notify pgrst, 'reload schema';
