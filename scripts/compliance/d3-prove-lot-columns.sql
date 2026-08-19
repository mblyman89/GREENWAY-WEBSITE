-- ===========================================================================
-- DEFECT D3 PROOF — does inventory_lots actually have category_slug / vendor_name?
--
-- Built by replaying the REAL migration chain that touches inventory_lots:
--   0023 (create) → 0024 → 0059 → 0138 → 0191
-- If the column list below is faithful, then the select used by BOTH
-- inventory-audit-store.ts:353 and audit-hub-store.ts HUB_LOT_COLUMNS must
-- fail with a specific, quotable PostgreSQL error.
-- ===========================================================================

drop table if exists lots_d3 cascade;

-- 0023_pos_inventory_lots.sql — the create
create table lots_d3 (
  id                  uuid primary key default gen_random_uuid(),
  lot_code            text,
  vendor_id           uuid,
  brand_id            uuid,
  manifest_id         uuid,
  lab_result_id       uuid,
  pos_product_key     text,
  product_name        text,
  received_qty        numeric not null default 0,
  on_hand_qty         numeric not null default 0,
  unit                text not null default 'each',
  unit_cost_minor_units integer,
  expires_on          date,
  status              text not null default 'active',
  notes               text,
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 0024_pos_coa_potency.sql
alter table lots_d3 add column if not exists strain_name    text;
alter table lots_d3 add column if not exists category       text;
alter table lots_d3 add column if not exists inventory_type text;
alter table lots_d3 add column if not exists unit_weight    numeric;
alter table lots_d3 add column if not exists unit_weight_uom text;
alter table lots_d3 add column if not exists is_sample      boolean not null default false;
alter table lots_d3 add column if not exists is_medical     boolean not null default false;

-- 0138_structured_product_facts.sql
alter table lots_d3 add column if not exists strain_type       text;
alter table lots_d3 add column if not exists servings_per_pack numeric;
alter table lots_d3 add column if not exists mg_per_serving    numeric;
alter table lots_d3 add column if not exists package_thc_mg    numeric;
alter table lots_d3 add column if not exists package_cbd_mg    numeric;

-- 0191_inventory_audit.sql — the count memory
alter table lots_d3 add column if not exists last_counted_at   timestamptz;
alter table lots_d3 add column if not exists last_counted_by   uuid;
alter table lots_d3 add column if not exists count_times_total integer not null default 0;

insert into lots_d3 (lot_code, product_name, on_hand_qty, unit_cost_minor_units)
values ('LOT-D3-001', 'Blue Dream 3.5g', 42, 1200);

-- ---------------------------------------------------------------------------
-- CONTROL: the columns that DO exist must round-trip cleanly.
-- ---------------------------------------------------------------------------
\echo '--- CONTROL (must return one row) ---'
select id, lot_code, pos_product_key, product_name, vendor_id,
       on_hand_qty, unit_cost_minor_units, last_counted_at, status
from lots_d3;

-- ---------------------------------------------------------------------------
-- THE ACCUSATION: exactly what HUB_LOT_COLUMNS asks PostgREST for.
-- ---------------------------------------------------------------------------
\echo '--- ACCUSATION: category_slug (expect ERROR) ---'
select category_slug from lots_d3;

\echo '--- ACCUSATION: vendor_name (expect ERROR) ---'
select vendor_name from lots_d3;
