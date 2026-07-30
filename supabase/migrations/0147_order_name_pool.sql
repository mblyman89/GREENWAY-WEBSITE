-- ============================================================================
-- 0147_order_name_pool.sql  (SLICE 113)
--
-- Order-NAME pool: a small, owner-maintained recycling list of custom,
-- personality-filled names ("Nugs4Thugs", "High Life", …) that the system
-- assigns to online orders and reuses. The unique GWY-XXXXXX order_number
-- (migration 0007) stays exactly as-is — it remains the internal, always-unique
-- reference and the search/receipt backstop. The pool name is a SEPARATE,
-- customer-facing display label.
--
-- Two changes:
--   1. orders.display_name  — nullable, NON-unique (so a name can recycle).
--      When null/blank the app shows order_number (never lies).
--   2. order_name_pool       — the recyclable list + LRU metadata.
--
-- The application ships fully working BEFORE this migration is applied: the
-- orders store uses a missing-column / missing-table fallback ladder, so until
-- Michael runs this, every order simply keeps its GWY-XXXXXX number.
--
-- SAFE TO RE-RUN (idempotent). Existing orders are never renumbered.
-- ============================================================================

-- 1) Customer-facing display label on orders (recyclable, so NOT unique). ------
alter table public.orders
  add column if not exists display_name text;

comment on column public.orders.display_name is
  'SLICE 113: optional friendly pool name shown to the customer (email, '
  'confirmation, receipt) in place of order_number. Nullable + NON-unique so a '
  'short pool of names can recycle. When null/blank the app falls back to the '
  'unique order_number (GWY-XXXXXX).';

-- 2) The recyclable name pool. ------------------------------------------------
create table if not exists public.order_name_pool (
  id               uuid primary key default gen_random_uuid(),
  -- The name exactly as Michael typed it (capitalization preserved). A
  -- case/space-insensitive UNIQUE guard is enforced via the functional index
  -- below so "High Life" and "high  life" cannot both exist.
  name             text not null,
  -- Disabled names stay in the list (history/toggle) but are never assigned.
  enabled          boolean not null default true,
  -- Manual ordering for the admin list + LRU tie-break.
  sort_order       integer not null default 0,
  -- LRU recycle metadata: the picker chooses the enabled name with the OLDEST
  -- last_assigned_at (null = never used = oldest), so a short list cycles fairly.
  last_assigned_at timestamptz,
  assigned_count   integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Case/space-insensitive uniqueness (a duplicate name is meaningless in a pool).
create unique index if not exists order_name_pool_name_key
  on public.order_name_pool (lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));

-- The picker reads enabled names ordered by LRU; index the hot path.
create index if not exists order_name_pool_recycle_idx
  on public.order_name_pool (enabled, last_assigned_at nulls first, sort_order);

-- Keep updated_at fresh (reuses the shared trigger fn from earlier migrations).
drop trigger if exists order_name_pool_set_updated_at on public.order_name_pool;
create trigger order_name_pool_set_updated_at
  before update on public.order_name_pool
  for each row execute function public.set_updated_at();

-- 3) RLS — staff read, admin write. (The app uses the service-role client, which
--    bypasses RLS; these policies are defense-in-depth for any anon/authed path.)
alter table public.order_name_pool enable row level security;

drop policy if exists order_name_pool_read on public.order_name_pool;
create policy order_name_pool_read
  on public.order_name_pool for select
  using (public.is_staff());

drop policy if exists order_name_pool_write on public.order_name_pool;
create policy order_name_pool_write
  on public.order_name_pool for all
  using (public.is_admin())
  with check (public.is_admin());
