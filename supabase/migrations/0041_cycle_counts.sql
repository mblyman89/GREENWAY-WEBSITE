-- =============================================================================
-- 0041_cycle_counts.sql  (Run 6 / Slice 30)
--
-- Cycle counts (a.k.a. periodic / blind physical counts) for inventory audit &
-- cleanup (Feature C). A cycle-count session captures, per lot, the SYSTEM
-- on-hand at the moment counting started and a BLIND physical count entered by
-- the employee. The variance (counted - system) is the discrepancy. When a
-- session is "applied", each non-zero variance writes an inventory_adjustments
-- row with reason 'count' so on-hand is corrected and the change is auditable +
-- CCRS-reportable (InventoryAdjustment.csv, AdjustmentReason = Reconciliation).
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- ── cycle_counts (the session) ──────────────────────────────────────────────
create table if not exists public.cycle_counts (
  id              uuid primary key default gen_random_uuid(),
  -- Human label, e.g. "March end-of-month count" or "Flower aisle spot check".
  label           text not null,
  -- open: counting in progress · applied: variances posted · cancelled
  status          text not null default 'open',
  -- Optional scope note (which area / category was counted).
  scope_note      text,
  -- How many lots were included / how many had a variance (cached for display).
  line_count      integer not null default 0,
  variance_count  integer not null default 0,
  opened_by       uuid references public.staff_profiles(id) on delete set null,
  applied_by      uuid references public.staff_profiles(id) on delete set null,
  applied_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cycle_counts_status_idx  on public.cycle_counts (status);
create index if not exists cycle_counts_created_idx on public.cycle_counts (created_at);

drop trigger if exists cycle_counts_set_updated_at on public.cycle_counts;
create trigger cycle_counts_set_updated_at
  before update on public.cycle_counts
  for each row execute function public.set_updated_at();

-- ── cycle_count_lines (one row per lot in the session) ──────────────────────
create table if not exists public.cycle_count_lines (
  id              uuid primary key default gen_random_uuid(),
  count_id        uuid not null references public.cycle_counts(id) on delete cascade,
  lot_id          uuid not null references public.inventory_lots(id) on delete cascade,
  -- Snapshot of system on-hand at the time the line was added (blind baseline).
  system_qty      numeric not null,
  -- Employee's physical count. NULL until they enter it (blind = not shown system).
  counted_qty     numeric,
  -- variance = counted_qty - system_qty (computed when counted_qty is set).
  variance_qty    numeric,
  note            text,
  -- Set true once this line's variance has been posted as an adjustment.
  applied         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (count_id, lot_id)
);

create index if not exists cycle_count_lines_count_idx on public.cycle_count_lines (count_id);
create index if not exists cycle_count_lines_lot_idx   on public.cycle_count_lines (lot_id);

drop trigger if exists cycle_count_lines_set_updated_at on public.cycle_count_lines;
create trigger cycle_count_lines_set_updated_at
  before update on public.cycle_count_lines
  for each row execute function public.set_updated_at();

-- ── CCRS InventoryAdjustment export batches (audit log of generated files) ──
create table if not exists public.ccrs_adjustment_batches (
  id              uuid primary key default gen_random_uuid(),
  file_name       text not null,
  range_from      timestamptz,
  range_to        timestamptz,
  record_count    integer not null default 0,
  operation       text not null default 'Insert',
  generated_by    uuid references public.staff_profiles(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists ccrs_adjustment_batches_created_idx
  on public.ccrs_adjustment_batches (created_at);

-- =============================================================================
-- Row-Level Security — STAFF ONLY (internal inventory/compliance data).
-- =============================================================================
alter table public.cycle_counts            enable row level security;
alter table public.cycle_count_lines       enable row level security;
alter table public.ccrs_adjustment_batches enable row level security;

drop policy if exists cycle_counts_staff_all on public.cycle_counts;
create policy cycle_counts_staff_all on public.cycle_counts
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists cycle_count_lines_staff_all on public.cycle_count_lines;
create policy cycle_count_lines_staff_all on public.cycle_count_lines
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists ccrs_adjustment_batches_staff_all on public.ccrs_adjustment_batches;
create policy ccrs_adjustment_batches_staff_all on public.ccrs_adjustment_batches
  for all using (public.is_staff()) with check (public.is_staff());
