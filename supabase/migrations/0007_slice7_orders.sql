-- =============================================================================
-- Slice 7 — Real order management
-- =============================================================================
-- Tables: orders, order_lines, order_events
--
-- orders       : one row per customer pickup order. Replaces the client-side
--                sessionStorage order. DB-generated GWY-XXXXXX order number +
--                a private uuid `public_token` so the guest confirmation page
--                can read its own order without authentication. Status lifecycle
--                (new -> acknowledged -> preparing -> ready -> completed, plus
--                cancelled / no_show). NO online payment is captured — this is a
--                pickup reservation; final price/tax/limits confirmed in store.
-- order_lines  : the items in an order. Snapshots name/brand/variant + the
--                authoritative engine-discounted unit price at order time so the
--                ticket never drifts if the menu/promo later changes.
-- order_events : append-only status/notes timeline for the audit trail and the
--                staff dashboard ("acknowledged 2m ago by Jane").
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles
--         (all from earlier slices).
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

-- Order status lifecycle understood by the staff dashboard + storefront.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum (
      'new',          -- just placed by the customer
      'acknowledged', -- staff has seen it
      'preparing',    -- being picked / bagged
      'ready',        -- ready for pickup
      'completed',    -- handed off
      'cancelled',    -- cancelled by staff/customer
      'no_show'       -- customer never picked up
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Order number generator: GWY-XXXXXX using an unambiguous alphabet
-- (no 0/O/1/I). Loops until it finds an unused number (collisions are rare).
-- ---------------------------------------------------------------------------
create or replace function public.generate_order_number()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
begin
  loop
    candidate := 'GWY-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.orders o where o.order_number = candidate);
  end loop;
  return candidate;
end$$;

-- ---------- orders -----------------------------------------------------------
create table if not exists public.orders (
  id                       uuid primary key default gen_random_uuid(),
  -- Customer-facing number, e.g. GWY-4F9C2A. Defaulted by trigger below so it
  -- is always DB-generated and unique even for guest (anon) inserts.
  order_number             text unique not null default '',
  -- Private token the guest confirmation page uses to fetch its own order
  -- without authentication (never shown publicly other than in its own URL).
  public_token             uuid not null default gen_random_uuid(),
  status                   public.order_status not null default 'new',
  -- Customer contact (provided at checkout; private — staff-only read).
  customer_first_name      text not null,
  customer_last_name       text,
  customer_email           text,
  customer_phone           text,
  customer_birthday        text,                       -- mm/dd/yyyy string as entered
  -- Money snapshot in MINOR UNITS (cents), tax-inclusive where noted.
  subtotal_minor_units     integer not null default 0,
  estimated_tax_minor_units integer not null default 0,
  savings_minor_units      integer not null default 0,
  total_minor_units        integer not null default 0,
  item_count               integer not null default 0,
  -- Optional free-form customer note + staff-only internal note.
  customer_note            text,
  staff_note               text,
  -- Soft inventory reservation expiry (advisory; cart engine/POS remain truth).
  reservation_expires_at   timestamptz,
  placed_at                timestamptz not null default now(),
  acknowledged_at          timestamptz,
  ready_at                 timestamptz,
  completed_at             timestamptz,
  -- Who last touched it (staff). Null for the original guest placement.
  handled_by               uuid references public.staff_profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists orders_status_idx     on public.orders (status);
create index if not exists orders_placed_at_idx   on public.orders (placed_at desc);
create index if not exists orders_phone_idx       on public.orders (customer_phone);
create index if not exists orders_token_idx        on public.orders (public_token);

-- Assign a unique GWY number on insert when one was not explicitly supplied.
create or replace function public.orders_assign_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := public.generate_order_number();
  end if;
  return new;
end$$;

drop trigger if exists orders_assign_number on public.orders;
create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.orders_assign_number();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------- order_lines ------------------------------------------------------
create table if not exists public.order_lines (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid not null references public.orders(id) on delete cascade,
  -- POS / catalog identifiers (snapshot; not FKs so deleted products keep history).
  product_id                text,
  variant_id                text,
  product_name              text not null,
  brand                     text,
  variant_label             text,
  quantity                  integer not null default 1,
  -- Authoritative engine-discounted unit price (tax-inclusive) at order time.
  price_minor_units         integer not null default 0,
  -- Pre-discount unit price (equals price when no sale).
  regular_price_minor_units integer,
  created_at                timestamptz not null default now()
);

create index if not exists order_lines_order_idx on public.order_lines (order_id);

-- ---------- order_events -----------------------------------------------------
create table if not exists public.order_events (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  -- e.g. 'placed', 'status_changed', 'note'. For status_changed, from/to set.
  event_type   text not null,
  from_status  public.order_status,
  to_status    public.order_status,
  note         text,
  actor_id     uuid references public.staff_profiles(id) on delete set null,
  actor_label  text,                                  -- 'customer' or staff name/email
  created_at   timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.orders        enable row level security;
alter table public.order_lines    enable row level security;
alter table public.order_events   enable row level security;

-- orders: staff read/write all. Public (anon) may INSERT a new order (place it)
-- but may NOT read/update arbitrary orders — guest confirmation reads go through
-- the service role bounded by public_token in app code, never via broad RLS.
drop policy if exists orders_staff_all on public.orders;
create policy orders_staff_all on public.orders
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists orders_public_insert on public.orders;
create policy orders_public_insert on public.orders
  for insert with check (status = 'new');

-- order_lines: staff all; public may insert lines (during placement).
drop policy if exists order_lines_staff_all on public.order_lines;
create policy order_lines_staff_all on public.order_lines
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists order_lines_public_insert on public.order_lines;
create policy order_lines_public_insert on public.order_lines
  for insert with check (true);

-- order_events: staff all; public may insert the initial 'placed' event.
drop policy if exists order_events_staff_all on public.order_events;
create policy order_events_staff_all on public.order_events
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists order_events_public_insert on public.order_events;
create policy order_events_public_insert on public.order_events
  for insert with check (event_type = 'placed');
