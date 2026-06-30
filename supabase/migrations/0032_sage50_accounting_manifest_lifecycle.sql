-- =============================================================================
-- 0032_sage50_accounting_manifest_lifecycle.sql  (Run 4 / Slice 18)
--
-- Two back-office capabilities:
--
--  A. SAGE 50 (US) ACCOUNTING EXPORT
--     Sage 50 imports a General Journal CSV (no desktop API). A daily journal
--     entry needs a chart-of-accounts (GL) mapping. accounting_settings holds a
--     single editable mapping of our money buckets → Sage 50 GL account ids.
--
--  B. MANIFEST LIFECYCLE (Cultivera-style visibility)
--     The owner wants to see a vendor manifest progress pending → in transit →
--     received → accepted (or rejected), like Cultivera. We extend
--     inbound_manifests with lifecycle timestamps and add manifest_events for a
--     timeline. The existing status column already supports
--     pending/accepted/rejected; we add 'in_transit' and 'received' as valid
--     interim states (enforced in app logic, column stays text).
--
-- All idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- A) Accounting settings (Sage 50 GL mapping) --------------------------------
create table if not exists public.accounting_settings (
  id                          boolean primary key default true,
  -- Sage 50 GL account ids (text — Sage account ids may have leading zeros).
  gl_cash_clearing            text not null default '',     -- DR: cash/card clearing
  gl_sales_cannabis           text not null default '',     -- CR: cannabis sales (pre-tax)
  gl_sales_non_cannabis       text not null default '',     -- CR: non-cannabis sales (pre-tax)
  gl_sales_tax_payable        text not null default '',     -- CR: state+local sales tax payable
  gl_excise_tax_payable       text not null default '',     -- CR: cannabis excise tax payable
  gl_cogs                     text not null default '',     -- DR: cost of goods sold
  gl_inventory                text not null default '',     -- CR: inventory asset
  gl_discounts                text not null default '',     -- DR: sales discounts (contra-revenue)
  -- Reference number prefix for journal entries (Sage requires unique numbers).
  journal_ref_prefix          text not null default 'GW',
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint accounting_settings_singleton check (id = true)
);

drop trigger if exists trg_accounting_settings_updated on public.accounting_settings;
create trigger trg_accounting_settings_updated
  before update on public.accounting_settings
  for each row execute function public.set_updated_at();

insert into public.accounting_settings (id) values (true)
on conflict (id) do nothing;

-- B) Manifest lifecycle -------------------------------------------------------
alter table public.inbound_manifests
  add column if not exists in_transit_at  timestamptz,
  add column if not exists received_at    timestamptz,
  add column if not exists accepted_at    timestamptz,
  add column if not exists rejected_at    timestamptz,
  -- Expected arrival (from the vendor manifest, when present).
  add column if not exists eta_date       date;

-- Timeline of lifecycle events for a manifest.
create table if not exists public.manifest_events (
  id            uuid primary key default gen_random_uuid(),
  manifest_id   uuid not null references public.inbound_manifests(id) on delete cascade,
  -- pending | in_transit | received | accepted | rejected | note
  event_type    text not null,
  note          text,
  actor_id      uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_manifest_events_manifest
  on public.manifest_events(manifest_id, created_at);

-- RLS -------------------------------------------------------------------------
alter table public.accounting_settings enable row level security;
alter table public.manifest_events enable row level security;

drop policy if exists "accounting_settings staff read" on public.accounting_settings;
create policy "accounting_settings staff read" on public.accounting_settings
  for select using (public.is_staff());

drop policy if exists "accounting_settings admin write" on public.accounting_settings;
create policy "accounting_settings admin write" on public.accounting_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "manifest_events staff read" on public.manifest_events;
create policy "manifest_events staff read" on public.manifest_events
  for select using (public.is_staff());

drop policy if exists "manifest_events staff write" on public.manifest_events;
create policy "manifest_events staff write" on public.manifest_events
  for all using (public.is_staff()) with check (public.is_staff());
