-- 0048_purchase_orders.sql
-- Slice 38 — AI-baked Purchase Order builder for the purchasing manager.
--
-- Sources of truth this builds on (already in the DB):
--   * inventory_lots   — on_hand_qty, unit_cost_minor_units, vendor_id, brand_id,
--                        pos_product_key, product_name  (migration 0023)
--   * vendors          — display_name, email, etc.                  (migration 0003)
--   * order_lines      — quantity, product_id, brand               (migration 0007)
--                        → used to estimate sales velocity for reorder math.
--
-- Reorder math is grounded in the standard formula (inFlow / industry):
--   reorder point  = (avg daily unit sales × lead time days) + safety stock
--   safety stock   = (max daily sales × max lead time) − (avg daily sales × avg lead time)
--   suggested qty  = target days of supply × avg daily sales − on_hand − on_order,
--                    rounded up to vendor MOQ.
-- (Computed in app code; this migration only stores the inputs + the PO docs.)
--
-- Idempotent: safe to re-run in the Supabase SQL editor.
-- Money in MINOR UNITS (cents).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'purchase_order_status') then
    create type public.purchase_order_status as enum (
      'draft',       -- being built (AI suggestions land here as a draft)
      'submitted',   -- approved internally, ready to send
      'sent',        -- emailed/exported to the vendor
      'partial',     -- some lines received
      'received',    -- fully received
      'cancelled'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Reorder settings: small singleton holding the default planning parameters
-- the purchasing manager tunes once (lead time, target days of supply, etc.).
-- Per-vendor overrides live on the vendors-side via purchase_order rows; this
-- is the global default used when nothing more specific is set.
-- ---------------------------------------------------------------------------
create table if not exists public.reorder_settings (
  id                       smallint primary key default 1,
  -- velocity window: how many days of order history to average over.
  velocity_window_days     smallint not null default 30,
  -- default supplier lead time in days when a vendor has no measured value.
  default_lead_time_days   smallint not null default 7,
  -- target days of supply to cover when suggesting an order quantity.
  target_days_of_supply    smallint not null default 21,
  -- default safety-stock days when max/avg cannot be derived from history.
  default_safety_days      smallint not null default 7,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint reorder_settings_singleton check (id = 1)
);

insert into public.reorder_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- purchase_orders: one PO document, addressed to one vendor.
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id                 uuid primary key default gen_random_uuid(),
  po_number          text unique,
  vendor_id          uuid references public.vendors (id) on delete set null,
  -- Snapshot of vendor display details at creation (durable if vendor changes).
  vendor_name        text,
  vendor_email       text,
  status             public.purchase_order_status not null default 'draft',
  -- planning parameters used for THIS po (snapshot of reorder_settings + edits).
  lead_time_days     smallint,
  target_days_supply smallint,
  -- free-text note printed on the PO, plus internal-only note.
  note               text,
  internal_note      text,
  expected_date      date,
  -- rolled-up totals (kept in sync by the app when lines change).
  subtotal_minor_units integer not null default 0,
  line_count         integer not null default 0,
  -- how this PO was originated, for analytics: manual | ai_suggested
  origin             text not null default 'manual'
                       check (origin in ('manual', 'ai_suggested')),
  submitted_at       timestamptz,
  sent_at            timestamptz,
  received_at        timestamptz,
  created_by         uuid references public.staff_profiles (id) on delete set null,
  updated_by         uuid references public.staff_profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists purchase_orders_vendor_idx on public.purchase_orders (vendor_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status, created_at);

-- ---------------------------------------------------------------------------
-- purchase_order_lines: a requested product on a PO.
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders (id) on delete cascade,
  -- catalog linkage (snapshot key, not FK — survives re-imports like lots do).
  pos_product_key     text,
  product_name        text not null,
  brand               text,
  category            text,
  -- planning context captured when the suggestion was generated (for transparency).
  on_hand_qty         numeric not null default 0,
  avg_daily_sales     numeric not null default 0,
  reorder_point       numeric,
  -- the quantity requested, and the unit cost in MINOR UNITS.
  order_qty           numeric not null default 0,
  unit                text not null default 'each',
  unit_cost_minor_units integer not null default 0,
  line_total_minor_units integer not null default 0,
  -- how many have been received against this line so far (receiving tie-in).
  received_qty        numeric not null default 0,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse shared helper)
-- ---------------------------------------------------------------------------
drop trigger if exists set_updated_at_reorder_settings on public.reorder_settings;
create trigger set_updated_at_reorder_settings
  before update on public.reorder_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_purchase_orders on public.purchase_orders;
create trigger set_updated_at_purchase_orders
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_purchase_order_lines on public.purchase_order_lines;
create trigger set_updated_at_purchase_order_lines
  before update on public.purchase_order_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — staff read, inventory.manage write (purchasing is inventory-side).
-- ---------------------------------------------------------------------------
alter table public.reorder_settings        enable row level security;
alter table public.purchase_orders         enable row level security;
alter table public.purchase_order_lines    enable row level security;

drop policy if exists reorder_settings_read on public.reorder_settings;
create policy reorder_settings_read on public.reorder_settings
  for select using (public.is_staff());
drop policy if exists reorder_settings_write on public.reorder_settings;
create policy reorder_settings_write on public.reorder_settings
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders
  for select using (public.is_staff());
drop policy if exists purchase_orders_write on public.purchase_orders;
create policy purchase_orders_write on public.purchase_orders
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists purchase_order_lines_read on public.purchase_order_lines;
create policy purchase_order_lines_read on public.purchase_order_lines
  for select using (public.is_staff());
drop policy if exists purchase_order_lines_write on public.purchase_order_lines;
create policy purchase_order_lines_write on public.purchase_order_lines
  for all using (public.is_staff()) with check (public.is_staff());
