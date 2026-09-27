-- ============================================================================
-- 0234 - PRODUCT IDENTITY COLUMNS (bible slice S04, Phase 1, Ring 0)
--
-- WHY THIS EXISTS
-- ---------------
-- `pos_product_key` is `sku ?? lot_code` (src/lib/inventory/intake-parser.ts
-- :414). It is a LOT key, and the owner wants it to stay that way: it is the
-- CCRS lineage key that follows one physical batch. It is NOT a product
-- identity - a restock of the same product from the same vendor arrives with
-- a new lot code and therefore a new pos_product_key.
--
-- S03 (src/lib/catalog/product-identity-core.ts) named the product identity
-- once: `vendor|categoryAxis|family`, e.g. "releaf|topical|suppository",
-- built by productIdentityKey() (which delegates to classificationMemoryKey so
-- memory and identity can never fork). Today nothing persists it, so every
-- "have we seen this product before?" question is answered by re-deriving it
-- over a 1000-row scan of approved drafts. This migration gives the identity
-- a home on every row that describes a product, with an index, so recall
-- becomes an indexed lookup and rows can point at their golden record
-- (kb_products).
--
-- WHAT THIS DOES - NULLABLE COLUMNS AND PARTIAL INDEXES ONLY
-- ----------------------------------------------------------
--   catalog_product_drafts  identity_key, kb_product_id (FK), brand_id (FK),
--                           vendor_id (FK), lot_code, sku, strain_type,
--                           restock_of_card_key
--   inventory_lots          identity_key, kb_product_id (FK)
--   menu_items              identity_key, kb_product_id   (no FK - see below)
--   product_enrichments     identity_key, kb_product_id, first_manifest_id,
--                           last_manifest_id, last_received_at (no FKs)
--   kb_products             identity_key
--
-- No backfill, no trigger, no function, no constraint on existing data. Every
-- column is nullable with no default, so on Postgres 11+ each `add column` is
-- a catalog-only change (no table rewrite). Nothing reads or writes these
-- columns until slice S05. The app is byte-for-byte unchanged before and
-- after this file runs.
--
-- DOCTRINE (repeated on every column comment so it survives in the catalog)
-- -------------------------------------------------------------------------
--   * identity_key is ADDITIVE to pos_product_key. pos_product_key is never
--     rewritten, repurposed or derived from identity_key.
--   * identity_key NULL means "not enough identity to be safe" (no vendor and
--     no brand, or no product name). It is NEVER a wildcard: no code may treat
--     two NULLs - or two empty strings - as the same product. Writers store
--     NULL, never ''.
--   * identity_key carries NO size. Two sizes of one product share an
--     identity_key. The size lives in kb_products.variant_label. So none of
--     the identity indexes are UNIQUE - they cannot be.
--
-- DECISIONS THAT DIFFER FROM THE WORDING OF THE S04 SPEC (all deliberate)
-- -----------------------------------------------------------------------
--   1. catalog_product_drafts.restock_of_card_key is added HERE. S05 seeds a
--      "restock of live card X" hint on a draft (bible S05, read by S11/S19),
--      and the S04 column list had nowhere to keep it. Putting it in `notes`
--      would mix machine data into a human field. One migration now means the
--      owner runs one file for the whole identity phase instead of two.
--   2. drafts.brand_id / drafts.vendor_id carry the SAME foreign keys
--      inventory_lots already has (0023: references brands / vendors, on
--      delete set null). The values are copied from the lot, which already
--      satisfies those keys, so the FK can never reject a write the lot
--      accepted. Vendors are archived on merge, never deleted (0104).
--   3. menu_items is indexed on (menu_version_id, identity_key), not
--      identity_key alone. Every menu_items lookup in this codebase is scoped
--      to one version (see idx_menu_items_source in 0002). A bare identity
--      index would have to wade through every historical version copy.
--   4. drafts and lots also get a partial index on kb_product_id. They are the
--      two tables with a real FK to kb_products. Without an index, deleting a
--      kb_products row would sequentially scan both to apply ON DELETE SET
--      NULL. Partial (where not null) so it costs nothing until S05 writes.
--
-- WHY SOME kb_product_id / manifest columns HAVE NO FOREIGN KEY
-- -------------------------------------------------------------
--   * menu_items.kb_product_id: menu_items is a versioned snapshot, inserted
--     ~4,500 rows at a time on every import/intake publish, and wiped by the
--     factory reset. An FK would add a lookup per inserted row and couple the
--     snapshot to the curated KB. The S04 spec leaves it plain. So do we.
--   * product_enrichments.first_manifest_id / last_manifest_id: enrichments
--     are KEPT by the factory reset (src/lib/accounting/factory-reset-core.ts)
--     while inbound_manifests are WIPED. An FK from a kept table to a wiped one
--     is exactly what tests/compliance/factory-reset-core.test.ts ("no KEPT
--     table points at a table that gets emptied") forbids. These are
--     provenance stamps, not links: after a reset they simply name a manifest
--     that no longer exists, which is true.
--   * product_enrichments.kb_product_id: plain, as the spec says. Both tables
--     are kept, so an FK would be legal. It is left for the slice that first
--     writes it (S20) to decide with real data in hand.
--
-- UNTIL IT IS APPLIED
-- -------------------
-- Every TypeScript field for these columns is OPTIONAL, and the explicit
-- public-menu column list (src/lib/pos/menu-columns-core.ts) deliberately does
-- NOT fetch menu_items.identity_key / kb_product_id - selecting a column that
-- does not exist yet would fail the whole menu read. Writers (S05) detect the
-- missing column with isMissingIdentityColumnError()
-- (src/lib/catalog/identity-columns-core.ts) and retry without it.
--
-- APPLIED BY HAND (AGENTS rule 6). Safe to re-run: add column if not exists,
-- create index if not exists, comment on column (idempotent by nature).
-- ============================================================================

-- -- 0. Refuse politely if an earlier migration is missing ------------------
do $precheck$
begin
  if to_regclass('public.catalog_product_drafts') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0234 alters public.catalog_product_drafts, created by 0026_pos_catalog_drafts.sql. Run the earlier migrations first.';
  end if;
  if to_regclass('public.inventory_lots') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0234 alters public.inventory_lots, created by 0023_pos_inventory_lots.sql. Run the earlier migrations first.';
  end if;
  if to_regclass('public.menu_items') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0234 alters public.menu_items, created by 0002_slice2_pos_import.sql. Run the earlier migrations first.';
  end if;
  if to_regclass('public.product_enrichments') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0234 alters public.product_enrichments, created by 0004_slice4_enrichment_ai.sql. Run the earlier migrations first.';
  end if;
  if to_regclass('public.kb_products') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0234 alters and references public.kb_products, created by 0071_kb_products_and_effects.sql. Run 0071 first.';
  end if;
  if to_regclass('public.vendors') is null or to_regclass('public.brands') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0234 references public.vendors and public.brands (the vendor/brand registry). Run the earlier migrations first.';
  end if;
end
$precheck$;

-- -- 1. catalog_product_drafts ----------------------------------------------
alter table public.catalog_product_drafts
  add column if not exists identity_key        text,
  add column if not exists kb_product_id       uuid references public.kb_products(id) on delete set null,
  add column if not exists brand_id            uuid references public.brands(id) on delete set null,
  add column if not exists vendor_id           uuid references public.vendors(id) on delete set null,
  add column if not exists lot_code            text,
  add column if not exists sku                 text,
  add column if not exists strain_type         text,
  add column if not exists restock_of_card_key text;

-- -- 2. inventory_lots ------------------------------------------------------
alter table public.inventory_lots
  add column if not exists identity_key  text,
  add column if not exists kb_product_id uuid references public.kb_products(id) on delete set null;

-- -- 3. menu_items ----------------------------------------------------------
alter table public.menu_items
  add column if not exists identity_key  text,
  add column if not exists kb_product_id uuid;

-- -- 4. product_enrichments -------------------------------------------------
alter table public.product_enrichments
  add column if not exists identity_key      text,
  add column if not exists kb_product_id     uuid,
  add column if not exists first_manifest_id uuid,
  add column if not exists last_manifest_id  uuid,
  add column if not exists last_received_at  timestamptz;

-- -- 5. kb_products ---------------------------------------------------------
alter table public.kb_products
  add column if not exists identity_key text;

-- -- 6. Indexes (partial: free until S05 writes the first value) ------------
create index if not exists idx_cpd_identity
  on public.catalog_product_drafts (identity_key) where identity_key is not null;
create index if not exists idx_cpd_kb_product
  on public.catalog_product_drafts (kb_product_id) where kb_product_id is not null;
create index if not exists idx_inventory_lots_identity
  on public.inventory_lots (identity_key) where identity_key is not null;
create index if not exists idx_inventory_lots_kb_product
  on public.inventory_lots (kb_product_id) where kb_product_id is not null;
create index if not exists idx_menu_items_identity
  on public.menu_items (menu_version_id, identity_key) where identity_key is not null;
create index if not exists idx_prod_enrich_identity
  on public.product_enrichments (identity_key) where identity_key is not null;
create index if not exists idx_kb_products_identity
  on public.kb_products (identity_key) where identity_key is not null;

-- -- 7. Doctrine, in the catalog --------------------------------------------
comment on column public.catalog_product_drafts.identity_key is
  '0234 / S04: product identity vendor|categoryAxis|family from productIdentityKey() in src/lib/catalog/product-identity-core.ts (same algorithm as classificationMemoryKey). ADDITIVE to pos_product_key, which stays the lot/CCRS lineage key per the owner and is never rewritten. NULL = not enough identity to be safe (no vendor and no brand, or no name) and is NEVER a wildcard. Writers store NULL, never the empty string. Carries no size, so it is not unique.';
comment on column public.catalog_product_drafts.kb_product_id is
  '0234 / S04: the golden record (kb_products) this draft describes, when the manifest bridge created or matched one. Set by S05 at finalize by kb natural key (brand_slug, product_slug, variant_label). NULL = not linked yet, never "no such product".';
comment on column public.catalog_product_drafts.brand_id is
  '0234 / S04: copied from the source lot (inventory_lots.brand_id) at draft seeding. Same FK as the lot. The brand_name column stays the display text.';
comment on column public.catalog_product_drafts.vendor_id is
  '0234 / S04: copied from the source lot (inventory_lots.vendor_id) at draft seeding. Same FK as the lot. The vendor_name column stays the display text. Lets S19 match restocks by vendor id instead of by spelling.';
comment on column public.catalog_product_drafts.lot_code is
  '0234 / S04: copied from the source lot at draft seeding (the manifest inventory id). Lineage only. Not identity.';
comment on column public.catalog_product_drafts.sku is
  '0234 / S04: the vendor product SKU when the manifest carried one (WCIA product_sku). NULL when the manifest had none. Never derived from lot_code (pos_product_key already records sku ?? lot_code).';
comment on column public.catalog_product_drafts.strain_type is
  '0234 / S04: the MANIFEST strain type (indica | sativa | hybrid | NULL) copied from inventory_lots.strain_type (0138, split at the parser door). A fact from the document, distinct from chosen_strain_type (0146), which is the human pick.';
comment on column public.catalog_product_drafts.restock_of_card_key is
  '0234 / S04 (for S05): hint only. The source_item_id of a LIVE menu card whose product identity matches this draft, i.e. this delivery looks like a restock of that card. It ANNOTATES the draft. It never suppresses it, never merges anything and never changes what approval does. NULL = no live card with the same identity.';

comment on column public.inventory_lots.identity_key is
  '0234 / S04: product identity vendor|categoryAxis|family (productIdentityKey, src/lib/catalog/product-identity-core.ts), stamped at receiving by S05. ADDITIVE to pos_product_key, which stays the lot/CCRS lineage key and is never rewritten. NULL = not enough identity. NEVER a wildcard. Not unique: many lots, and every size, share one identity.';
comment on column public.inventory_lots.kb_product_id is
  '0234 / S04: the kb_products golden record this lot is an instance of, linked by S05 at finalize by kb natural key. NULL = not linked yet.';

comment on column public.menu_items.identity_key is
  '0234 / S04: product identity of this card (productIdentityKey via identityForMenuItem). ADDITIVE to source_item_id / pos_product_key. NULL = not stamped or not enough identity. NEVER a wildcard. Not fetched by the full-menu loader (src/lib/pos/menu-columns-core.ts) until a reader needs it.';
comment on column public.menu_items.kb_product_id is
  '0234 / S04: the kb_products golden record for this card. Deliberately NO foreign key: menu_items is a versioned snapshot inserted thousands of rows at a time and wiped by the factory reset.';

comment on column public.product_enrichments.identity_key is
  '0234 / S04: product identity for this enrichment, so marketing copy can follow the product across lot keys (S20). ADDITIVE: pos_product_key stays the unique key of this table. NULL = not stamped. NEVER a wildcard.';
comment on column public.product_enrichments.kb_product_id is
  '0234 / S04: the kb_products golden record this enrichment describes. Plain uuid for now. The first writer (S20) decides on a foreign key with real data in hand.';
comment on column public.product_enrichments.first_manifest_id is
  '0234 / S04: provenance stamp, the first inbound manifest that delivered this product. Deliberately NO foreign key: enrichments are KEPT by the factory reset while inbound_manifests are WIPED, so an FK would be a kept row pointing at an emptied table.';
comment on column public.product_enrichments.last_manifest_id is
  '0234 / S04: provenance stamp, the most recent inbound manifest that delivered this product. No foreign key, for the same reason as first_manifest_id.';
comment on column public.product_enrichments.last_received_at is
  '0234 / S04: when the most recent delivery of this product was received. NULL = unknown, never backfilled from created_at.';

comment on column public.kb_products.identity_key is
  '0234 / S04: product identity vendor|categoryAxis|family shared by every size of this product. The golden record natural key stays (brand_slug, product_slug, variant_label) (0071 uq_kb_products_identity) and is untouched. The identity_key is ADDITIVE, an extra NON-unique handle so a size-less identity can find its records. NULL = not stamped. NEVER a wildcard.';
