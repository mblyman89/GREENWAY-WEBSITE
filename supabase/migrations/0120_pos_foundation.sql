-- =============================================================================
-- 0120_pos_foundation.sql  (POS Slice B2)
--
-- Foundation tables for the iPad register (offline-first, event-sourced):
--   * pos_devices     -- provisioned iPads (bound to a register; revocable)
--   * pos_sale_events -- the append-only ingest ledger. UNIQUE client_uuid is
--                        the idempotency key: a retried offline flush can
--                        never double-post (POS_FRONTEND_RESEARCH §4.2).
--   * drawer_sessions.device_id      -- which iPad served the session
--   * time_punches.source 'register' -- punches made at the till
--   * equipment seed: the store's ACTUAL front-counter Bluetooth receipt
--     printer (owner-verified from the device sticker): Star Micronics
--     TSP143IIIBi (TSP100III series), serial 2550923021300119.
--
-- Money: minor units (cents). Idempotent: safe to re-run in the SQL editor.
-- APPLIED MANUALLY BY THE OWNER (standing rule).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- pos_devices: provisioned register iPads
-- ---------------------------------------------------------------------------
create table if not exists public.pos_devices (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                     -- e.g. "Register 1 iPad"
  register_id    uuid references public.registers(id) on delete set null,
  status         text not null default 'active'
                   check (status in ('active','revoked')),
  -- Rotating provisioning secret HASH (scrypt, same discipline as clock PINs;
  -- plaintext never stored). Set during manager provisioning.
  provision_hash text,
  last_seen_at   timestamptz,
  last_synced_at timestamptz,
  notes          text,
  created_by     uuid references public.staff_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists pos_devices_register_idx on public.pos_devices (register_id);

drop trigger if exists pos_devices_set_updated_at on public.pos_devices;
create trigger pos_devices_set_updated_at before update on public.pos_devices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pos_sale_events: append-only ingest ledger for ALL register events
-- ---------------------------------------------------------------------------
create table if not exists public.pos_sale_events (
  id              uuid primary key default gen_random_uuid(),
  -- THE idempotency key. Client-generated v4 UUID; unique forever.
  client_uuid     uuid not null unique,
  device_id       uuid not null references public.pos_devices(id) on delete restrict,
  register_id     uuid not null references public.registers(id) on delete restrict,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  -- Monotonic per-device sequence (offline ordering preserved on replay).
  sequence        bigint not null,
  occurred_at     timestamptz not null,             -- device wall clock
  received_at     timestamptz not null default now(),
  event_type      text not null
                    check (event_type in ('sale','punch','no_sale','manual_id_verification')),
  -- The full validated envelope payload (schema enforced in app cores).
  payload         jsonb not null,
  -- Ingest outcome. pending → processed | exception. Exceptions carry a
  -- reason and surface in the manager exception queue — NEVER silently dropped.
  status          text not null default 'pending'
                    check (status in ('pending','processed','exception')),
  exception_reason text,
  -- Set when a 'sale' event materializes an order (the compliance-gated path).
  order_id        uuid references public.orders(id) on delete set null,
  processed_at    timestamptz,
  -- Manager resolution trail for exceptions.
  resolved_by     uuid references public.staff_profiles(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text
);

create index if not exists pos_sale_events_device_seq_idx
  on public.pos_sale_events (device_id, sequence);
create index if not exists pos_sale_events_status_idx
  on public.pos_sale_events (status) where status <> 'processed';
create index if not exists pos_sale_events_occurred_idx
  on public.pos_sale_events (occurred_at desc);
create index if not exists pos_sale_events_order_idx
  on public.pos_sale_events (order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- drawer_sessions.device_id — which iPad served the session (Seam 3 gap)
-- ---------------------------------------------------------------------------
alter table public.drawer_sessions
  add column if not exists device_id uuid references public.pos_devices(id) on delete set null;

-- ---------------------------------------------------------------------------
-- time_punches.source — allow 'register' (Seam 4 gap). The original 0037
-- column has no CHECK constraint (verified: comment-only enumeration), so no
-- constraint change is required; this comment documents the new legal value.
-- ---------------------------------------------------------------------------
comment on column public.time_punches.source is
  'web | station | phone | manager_edit | register (register = punched at a POS till)';

-- ---------------------------------------------------------------------------
-- Equipment seed: the REAL front-counter receipt printer (owner decision §14,
-- model verified from the device label photo: TSP100III / TSP143IIIBI2,
-- serial 2550923021300119). Bluetooth; kicks the cash drawer via its DK port.
-- ---------------------------------------------------------------------------
insert into public.equipment_assets
  (asset_tag, name, category, manufacturer, model, serial_number, location, status, notes)
select
  'PRN-COUNTER-01',
  'Front-counter receipt printer (register sales)',
  'printer',
  'Star Micronics',
  'TSP143IIIBi (TSP100III series)',
  '2550923021300119',
  'Sales floor — front counter',
  'active',
  'Bluetooth thermal receipt printer paired with the register iPad Pros. Kicks the cash drawer via its DK peripheral port after each sale. POS app drives it with the Star StarPRNT/StarXpand SDK. Distinct from PRN-RECEIPT-01 (TSP143IV), which auto-prints ONLINE orders via CloudPRNT.'
where not exists (
  select 1 from public.equipment_assets where asset_tag = 'PRN-COUNTER-01'
);

-- ---------------------------------------------------------------------------
-- RLS: staff read/write (app gates by permission); no public access.
-- ---------------------------------------------------------------------------
alter table public.pos_devices     enable row level security;
alter table public.pos_sale_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pos_devices','pos_sale_events']
  loop
    execute format('drop policy if exists %1$s_staff_read on public.%1$s;', t);
    execute format('create policy %1$s_staff_read on public.%1$s for select using (public.is_staff());', t);
    execute format('drop policy if exists %1$s_staff_write on public.%1$s;', t);
    execute format('create policy %1$s_staff_write on public.%1$s for all using (public.is_staff()) with check (public.is_staff());', t);
  end loop;
end $$;
