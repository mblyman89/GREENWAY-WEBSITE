-- =============================================================================
-- 0054_trade_samples.sql  (Command Center Enhancements / Slice 71, item 6)
--
-- WSLCB TRADE SAMPLE compliance tracking + HARD-ENFORCED quantity limits.
--
-- Controlling rule: WAC 314-55-096 "Trade samples, retail display samples, and
-- internal quality control samples." Current version WSR 25-08-032, filed
-- 3/26/25, effective 4/26/25.
--
-- Enforced caps (all HARD BLOCKS per owner):
--   * INCOMING (processor -> this retailer): <= 120 trade-sample units of any
--     combination per CALENDAR QUARTER, per processor.            [096(1)(f)(ii)]
--   * OUTGOING (retailer -> one employee):  <= 30 trade-sample units per
--     CALENDAR QUARTER, per employee (sample-jar leftovers count). [096(1)(j)(vi), 096(4)(d)(i)]
--   * CUSTOMERS: retailers may NOT provide free samples to customers.  [096(2)]
--     (No customer direction exists in this schema at all — enforced in code.)
--   * PER-UNIT size caps (a "unit" must be representative & not larger than the
--     smallest unit sold): <= 3.5 g cannabis; <= 1 g concentrate; <= 100 mg
--     infused (<= 10 mg active delta-9 THC / serving).             [096(1)(e)]
--
-- NOTE: separate from 0042 `sample_settings`, which governs sample *pricing*
-- (nominal price / block public sale). This migration governs sample *transfer
-- quantities* and traceability.
--
-- Money: n/a.  Grams stored as numeric grams; THC in milligrams.
-- Idempotent: safe to re-run in the Supabase SQL editor.
-- =============================================================================

-- ── trade_sample_settings (single row, id = true) ───────────────────────────
create table if not exists public.trade_sample_settings (
  id                          boolean primary key default true check (id = true),
  -- Master switch. When false the sample ledger records but does not block.
  enforce                     boolean not null default true,
  -- true = block over-cap events; false = warn only (drafts-style soft gate).
  hard_block                  boolean not null default true,
  -- Quarterly caps (units). Defaults = WAC 314-55-096 statute.
  incoming_units_per_quarter  integer not null default 120,   -- per processor, per quarter
  outgoing_units_per_employee integer not null default 30,    -- per employee, per quarter
  -- Per-unit size caps.
  max_flower_grams            numeric(10,3) not null default 3.5,   -- useable cannabis
  max_concentrate_grams       numeric(10,3) not null default 1,     -- concentrate
  max_infused_mg              numeric(10,3) not null default 100,   -- infused product weight
  max_thc_mg_per_serving      numeric(10,3) not null default 10,    -- active delta-9 THC/serving
  notes                       text,
  updated_by                  uuid references public.staff_profiles(id) on delete set null,
  updated_at                  timestamptz not null default now()
);

insert into public.trade_sample_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists trade_sample_settings_set_updated_at on public.trade_sample_settings;
create trigger trade_sample_settings_set_updated_at
  before update on public.trade_sample_settings
  for each row execute function public.set_updated_at();

-- ── trade_sample_events (the ledger) ─────────────────────────────────────────
-- One row per recorded transfer. direction:
--   'incoming'  = processor -> this retailer (counts vs 120/qtr for that processor)
--   'outgoing'  = this retailer -> a paid employee (counts vs 30/qtr for that employee)
create table if not exists public.trade_sample_events (
  id                uuid primary key default gen_random_uuid(),
  direction         text not null check (direction in ('incoming', 'outgoing')),
  -- Product type per traceability: 'useable' | 'concentrate' | 'infused'.
  product_type      text not null check (product_type in ('useable', 'concentrate', 'infused')),
  -- Number of sample UNITS in this event (each within the per-unit size cap).
  unit_count        integer not null check (unit_count > 0),
  -- Per-unit size for the record (grams for useable/concentrate; mg for infused).
  unit_size_grams   numeric(10,3),
  unit_size_mg      numeric(10,3),
  thc_mg_per_serving numeric(10,3),
  -- Calendar-quarter bucket key, e.g. '2025-Q2' (Pacific calendar).
  quarter_key       text not null,
  -- INCOMING: the supplying processor (free text name + optional vendor ref).
  processor_name    text,
  vendor_id         uuid references public.vendors(id) on delete set null,
  -- OUTGOING: the receiving paid employee.
  employee_id       uuid references public.employees(id) on delete set null,
  employee_name     text,
  -- Optional link to the sampled lot.
  lot_id            uuid references public.inventory_lots(id) on delete set null,
  -- Was this event counted from sample-jar leftovers? (still counts vs 30/qtr)
  from_sample_jar   boolean not null default false,
  note              text,
  created_by        uuid references public.staff_profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists trade_sample_events_dir_idx      on public.trade_sample_events (direction);
create index if not exists trade_sample_events_quarter_idx  on public.trade_sample_events (quarter_key);
create index if not exists trade_sample_events_employee_idx on public.trade_sample_events (employee_id);
create index if not exists trade_sample_events_vendor_idx   on public.trade_sample_events (vendor_id);
create index if not exists trade_sample_events_created_idx  on public.trade_sample_events (created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.trade_sample_settings enable row level security;
alter table public.trade_sample_events   enable row level security;

drop policy if exists trade_sample_settings_staff_read on public.trade_sample_settings;
create policy trade_sample_settings_staff_read on public.trade_sample_settings
  for select using (public.is_staff());

drop policy if exists trade_sample_settings_admin_write on public.trade_sample_settings;
create policy trade_sample_settings_admin_write on public.trade_sample_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists trade_sample_events_staff_all on public.trade_sample_events;
create policy trade_sample_events_staff_all on public.trade_sample_events
  for all using (public.is_staff()) with check (public.is_staff());
