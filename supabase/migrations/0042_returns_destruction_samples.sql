-- =============================================================================
-- 0042_returns_destruction_samples.sql  (Run 6 / Slice 31)
--
-- Vendor returns (D), destruction events (E), and sample-pricing guardrails (F).
--
-- Both vendor returns and destruction events REDUCE on-hand. Rather than mutate
-- on-hand directly, the store posts a signed inventory_adjustments row (reason
-- 'other' for vendor returns, 'destruction' for destructions) so every quantity
-- change stays in the single auditable adjustments ledger that also feeds the
-- CCRS InventoryAdjustment.csv. These tables capture the *business* record
-- (who/why/when/quantity, references) above that ledger.
--
-- Sample guardrails: WSLCB-compliant vendor/QA samples must never be sold at a
-- normal price. We store a configurable nominal sample price (default $0.01 =
-- 1 minor unit) and a flag to require it. The pure guardrail logic lives in
-- src/lib/inventory/sample-guardrails.ts.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- ── vendor_returns ──────────────────────────────────────────────────────────
create table if not exists public.vendor_returns (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references public.inventory_lots(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete set null,
  -- Quantity returned (positive magnitude; the posted adjustment is negative).
  quantity        numeric not null check (quantity > 0),
  -- Why: defective | recall | overstock | mislabeled | expired | other
  reason          text not null default 'other',
  -- Free-form details (RMA #, contact, manifest ref).
  detail          text,
  rma_number      text,
  -- The inventory_adjustments row this return posted (for traceability).
  adjustment_id   uuid references public.inventory_adjustments(id) on delete set null,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists vendor_returns_lot_idx     on public.vendor_returns (lot_id);
create index if not exists vendor_returns_vendor_idx  on public.vendor_returns (vendor_id);
create index if not exists vendor_returns_created_idx on public.vendor_returns (created_at);

-- ── destruction_events ──────────────────────────────────────────────────────
-- WSLCB requires a quarantine + notice period before destruction. We record the
-- intended destruction, the quarantine start, the earliest legal destroy date,
-- and the completion. Status: pending_quarantine | ready | completed | cancelled.
create table if not exists public.destruction_events (
  id                 uuid primary key default gen_random_uuid(),
  lot_id             uuid not null references public.inventory_lots(id) on delete cascade,
  quantity           numeric not null check (quantity > 0),
  -- Why: expired | failed_qa | recall | damaged | contaminated | other
  reason             text not null default 'other',
  detail             text,
  status             text not null default 'pending_quarantine',
  -- WSLCB notice/quarantine: 72h hold before destruction is permitted.
  quarantine_start   timestamptz not null default now(),
  earliest_destroy_at timestamptz,
  method             text,                    -- e.g. "rendered unusable; mixed 50/50 with soil"
  witnessed_by       text,                    -- name(s) of witnesses
  completed_at       timestamptz,
  adjustment_id      uuid references public.inventory_adjustments(id) on delete set null,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  completed_by       uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists destruction_events_lot_idx     on public.destruction_events (lot_id);
create index if not exists destruction_events_status_idx  on public.destruction_events (status);
create index if not exists destruction_events_created_idx on public.destruction_events (created_at);

drop trigger if exists destruction_events_set_updated_at on public.destruction_events;
create trigger destruction_events_set_updated_at
  before update on public.destruction_events
  for each row execute function public.set_updated_at();

-- ── sample_settings (single row, id = true) ─────────────────────────────────
create table if not exists public.sample_settings (
  id                     boolean primary key default true check (id = true),
  -- Nominal price (minor units) samples must be sold at. WSLCB: nominal value.
  nominal_price_minor    integer not null default 1,     -- $0.01
  -- Enforce the nominal price (block selling samples at full price).
  require_nominal_price  boolean not null default true,
  -- Block selling samples to the public entirely (QA/employee only).
  block_public_sale      boolean not null default true,
  updated_by             uuid references public.staff_profiles(id) on delete set null,
  updated_at             timestamptz not null default now()
);

insert into public.sample_settings (id, nominal_price_minor, require_nominal_price, block_public_sale)
values (true, 1, true, true)
on conflict (id) do nothing;

drop trigger if exists sample_settings_set_updated_at on public.sample_settings;
create trigger sample_settings_set_updated_at
  before update on public.sample_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security — STAFF ONLY.
-- =============================================================================
alter table public.vendor_returns     enable row level security;
alter table public.destruction_events enable row level security;
alter table public.sample_settings    enable row level security;

drop policy if exists vendor_returns_staff_all on public.vendor_returns;
create policy vendor_returns_staff_all on public.vendor_returns
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists destruction_events_staff_all on public.destruction_events;
create policy destruction_events_staff_all on public.destruction_events
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists sample_settings_staff_read on public.sample_settings;
create policy sample_settings_staff_read on public.sample_settings
  for select using (public.is_staff());

drop policy if exists sample_settings_admin_write on public.sample_settings;
create policy sample_settings_admin_write on public.sample_settings
  for all using (public.is_admin()) with check (public.is_admin());
