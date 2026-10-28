-- 0311_recall_events.sql  (Fix Phase 1.6c · G-25 · F-05a-15, F-05a-16)
--
-- WHY. The app had no recall plan, coordinator or recall log (F-05a-15), and
-- WAC 314-55-225 requires a licensee to notify the local LCB enforcement
-- officer "Immediately" for a recall and "within 48 hours" for a market
-- withdrawal ((3)(b)(i)(A); (2)(b)), and to "track the total amount of
-- affected product and the amount of affected product returned", reporting
-- progress to the LCB at least once a week ((3)(f)). Form 8.5 (SOP-05a §8.5)
-- was the only record.
--
-- WHAT. Three tables, the app's copy of form 8.5:
--   recall_events         one row per recall or market withdrawal: the notice,
--                         the type, the LCB notification and the close-out
--   recall_event_lots     the affected lots (each set Recalled through the
--                         audited lot-status path, G-22)
--   recall_event_weekly   the weekly tracking rows (held, returned by
--                         customers, returned to vendor, destroyed, sold
--                         before the hold, reported to the LCB on)
-- The recall plan (form 8.4) is kept in site_settings (key 'recall_plan')
-- and needs no schema.
--
-- SAFE / IDEMPOTENT: create table if not exists only; no existing data is
-- changed. Row level security is enabled with no policies, so only the
-- server (service role) reads and writes. Apply MANUALLY in the SQL editor
-- after 0310. Before it is applied the Recalls page says the migration is
-- pending, and the website / online-order recall filter (which reads
-- inventory_lots only) already works.

create table if not exists public.recall_events (
  id                uuid primary key default gen_random_uuid(),
  event_number      bigint generated always as identity,
  type              text not null check (type in ('recall', 'market_withdrawal')),
  status            text not null default 'open' check (status in ('open', 'closed')),
  product           text not null,
  vendor_name       text,
  lot_numbers_given text,
  reason            text not null,
  recall_reference  text,
  notice_source     text not null,
  notice_method     text not null,
  received_at       timestamptz not null,
  received_by       uuid references public.staff_profiles (id) on delete set null,
  lcb_officer       text,
  lcb_notified_at   timestamptz,
  lcb_method        text,
  lcb_notified_by   uuid references public.staff_profiles (id) on delete set null,
  lcb_notes         text,
  outcome           text check (outcome in ('released', 'returned_to_vendor', 'destroyed')),
  clearance_reference text,
  plan_departures   text,
  closed_at         timestamptz,
  closed_by         uuid references public.staff_profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists recall_events_status_idx on public.recall_events (status, received_at desc);

create table if not exists public.recall_event_lots (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.recall_events (id) on delete cascade,
  -- lot_id is the inventory_lots id, deliberately WITHOUT a foreign key:
  -- the recall log is KEPT by the factory reset (factory-reset-core.ts)
  -- and inventory_lots is WIPED, and a kept table may not point at a
  -- wiped one. The app reads the lot by id; a lot that is gone shows as
  -- its id.
  lot_id          uuid not null,
  on_hand_at_add  numeric,
  previous_status text,
  added_by        uuid references public.staff_profiles (id) on delete set null,
  added_at        timestamptz not null default now(),
  unique (event_id, lot_id)
);

create index if not exists recall_event_lots_lot_idx on public.recall_event_lots (lot_id);

create table if not exists public.recall_event_weekly (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.recall_events (id) on delete cascade,
  week_of                date not null,
  held                   numeric not null default 0,
  returned_by_customers  numeric not null default 0,
  returned_to_vendor     numeric not null default 0,
  destroyed              numeric not null default 0,
  sold_before_hold       numeric not null default 0,
  reported_to_lcb_on     date,
  notes                  text,
  created_by             uuid references public.staff_profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (event_id, week_of)
);

alter table public.recall_events enable row level security;
alter table public.recall_event_lots enable row level security;
alter table public.recall_event_weekly enable row level security;

comment on table public.recall_events is
  'Fix Phase 1.6c (G-25; WAC 314-55-225): one recall or market withdrawal (form 8.5). The coordinator is the admin, no back-up (D37).';
comment on column public.recall_events.lcb_notified_at is
  'When the local LCB enforcement officer was told: immediately for a recall ((3)(b)(i)(A)), within 48 hours for a market withdrawal ((2)(b)).';
comment on table public.recall_event_weekly is
  'Fix Phase 1.6c (G-25; WAC 314-55-225(3)(f)): weekly tracking of affected and returned product, and the date progress was reported to the LCB.';
