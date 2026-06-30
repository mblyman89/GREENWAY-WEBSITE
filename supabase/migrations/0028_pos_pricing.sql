-- 0028_pos_pricing.sql
-- Slice 10: pricing with guard rails. Every price has a hard floor of 2x cost
-- (configurable per store), the AI suggests a price from sales velocity, and the
-- final approved price can never go below the floor. No employee guesswork.
--
-- Idempotent: safe to run more than once.

-- ── store-wide pricing settings (single row) ───────────────────────────────
create table if not exists public.pricing_settings (
  id                      boolean primary key default true,  -- single-row guard
  -- Minimum markup multiplier over cost (2.0 = 2x). Hard floor.
  min_markup_multiple     numeric not null default 2.0,
  -- Default tax rate applied on top (e.g. 0.376 for WA 37% excise + sales).
  -- Stored for display/estimates; the authoritative tax is computed at sale.
  default_tax_rate        numeric not null default 0,
  -- Rounding: round suggested prices to the nearest N cents (e.g. 5 => x.x5/x.x0).
  round_to_minor_units    integer not null default 5,
  updated_by              uuid references public.staff_profiles(id) on delete set null,
  updated_at              timestamptz not null default now(),
  constraint pricing_settings_singleton check (id = true)
);

insert into public.pricing_settings (id) values (true)
on conflict (id) do nothing;

drop trigger if exists pricing_settings_set_updated_at on public.pricing_settings;
create trigger pricing_settings_set_updated_at
  before update on public.pricing_settings
  for each row execute function public.set_updated_at();

alter table public.pricing_settings enable row level security;
drop policy if exists pricing_settings_staff_read on public.pricing_settings;
create policy pricing_settings_staff_read on public.pricing_settings
  for select using (public.is_staff());
drop policy if exists pricing_settings_admin_write on public.pricing_settings;
create policy pricing_settings_admin_write on public.pricing_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ── catalog_product_drafts: pricing columns ────────────────────────────────
alter table public.catalog_product_drafts
  add column if not exists unit_cost_minor_units integer;       -- vendor cost/unit

alter table public.catalog_product_drafts
  add column if not exists price_floor_minor_units integer;     -- 2x cost (computed)

alter table public.catalog_product_drafts
  add column if not exists suggested_price_minor_units integer; -- AI suggestion

alter table public.catalog_product_drafts
  add column if not exists price_minor_units integer;           -- employee-set final

alter table public.catalog_product_drafts
  add column if not exists price_rationale text;                -- why the AI suggested it
