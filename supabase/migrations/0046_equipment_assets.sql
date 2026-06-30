-- =============================================================================
-- 0046_equipment_assets.sql  (Run 6 / Slice 35, Feature R)
--
-- Equipment asset registry. Owner scope (Q5): "asset registry only." Tracks the
-- store's physical equipment — POS terminals, scales, safes, cameras, printers,
-- label printers, etc. — and optionally MAPS an asset to a register so staff can
-- see which hardware is tied to which till.
--
-- WA note: NIST/WSLCB require commercial scales used to weigh cannabis to be
-- legal-for-trade and periodically inspected; the registry captures the next
-- calibration/inspection date so the back office can surface what's due.
--
-- Money: purchase_cost_minor in cents.  Rates: n/a.
-- Idempotent: safe to re-run in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.equipment_assets (
  id                  uuid primary key default gen_random_uuid(),
  -- Short human asset tag (e.g. "POS-01", "SCALE-A"). Unique when present.
  asset_tag           text,
  name                text not null,
  -- Broad category so the list can group hardware.
  category            text not null default 'other'
                        check (category in (
                          'pos_terminal','scale','safe','camera','printer',
                          'label_printer','network','display','sensor','vehicle','other'
                        )),
  manufacturer        text,
  model               text,
  serial_number       text,
  -- Optional mapping to a register (POS terminal / scale tied to a till).
  register_id         uuid references public.registers(id) on delete set null,
  location            text,                       -- e.g. "Sales floor", "Vault"
  status              text not null default 'active'
                        check (status in ('active','maintenance','retired','lost')),
  purchase_date       date,
  purchase_cost_minor integer,                    -- cents
  warranty_expires    date,
  -- For scales / metered equipment that must be calibrated or inspected.
  requires_calibration boolean not null default false,
  last_calibrated_on   date,
  next_calibration_due date,
  notes               text,
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists equipment_assets_tag_uniq
  on public.equipment_assets (asset_tag)
  where asset_tag is not null;

create index if not exists equipment_assets_register_idx
  on public.equipment_assets (register_id);
create index if not exists equipment_assets_status_idx
  on public.equipment_assets (status);
create index if not exists equipment_assets_cal_due_idx
  on public.equipment_assets (next_calibration_due)
  where next_calibration_due is not null;

drop trigger if exists equipment_assets_set_updated_at on public.equipment_assets;
create trigger equipment_assets_set_updated_at
  before update on public.equipment_assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lightweight service / maintenance log per asset.
-- ---------------------------------------------------------------------------
create table if not exists public.equipment_service_events (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.equipment_assets(id) on delete cascade,
  event_type   text not null default 'service'
                 check (event_type in ('service','calibration','repair','inspection','note','retire')),
  performed_on date not null default current_date,
  performed_by text,                              -- vendor / technician / staff name
  cost_minor   integer,
  note         text,
  actor_id     uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists equipment_service_events_asset_idx
  on public.equipment_service_events (asset_id, performed_on desc);

-- =============================================================================
-- Row-Level Security — STAFF ONLY.
-- =============================================================================
alter table public.equipment_assets         enable row level security;
alter table public.equipment_service_events enable row level security;

drop policy if exists equipment_assets_staff_all on public.equipment_assets;
create policy equipment_assets_staff_all on public.equipment_assets
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists equipment_service_events_staff_all on public.equipment_service_events;
create policy equipment_service_events_staff_all on public.equipment_service_events
  for all using (public.is_staff()) with check (public.is_staff());
