-- =============================================================================
-- Slice 6 — Promotions / Specials manager
-- =============================================================================
-- Tables: promotions, promotion_targets, promotion_exclusions,
--         promotion_audit_snapshots
--
-- promotions               : one row per deal/special. Database-backed
--                            replacement for the hardcoded Mon–Sun rules +
--                            Thursday brands in src/lib/specials/daily-deals.ts.
--                            Draft/scheduled/published/archived lifecycle (reuses
--                            post_status), a discount_type, recurrence (weekly
--                            day-of-week for the daily deals, or a date window),
--                            and a per_item_sale flag controlling whether the
--                            front end shows an honest struck per-item price or
--                            an informational note (weight/spend/basket tiers).
-- promotion_targets        : what a promotion applies to — a category, a brand,
--                            a specific product key, or 'all' (storewide).
-- promotion_exclusions     : products/categories/brands explicitly excluded.
-- promotion_audit_snapshots: immutable JSON snapshot of a promotion at publish
--                            time (rules + the list of affected product keys
--                            previewed) for the audit trail / "what changed".
--
-- Reuses: post_status enum, public.set_updated_at(), public.is_staff(),
--         public.media_assets (all from earlier slices).
-- Idempotent: create if not exists + drop policy/trigger if exists.
-- =============================================================================

-- Discount math types the cart engine + card preview understand.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'discount_type') then
    create type public.discount_type as enum (
      'percent',        -- flat % off targeted items
      'fixed',          -- fixed amount off (minor units)
      'bogo',           -- buy-one-get-one (config in JSON)
      'threshold_spend',-- % off once basket spend >= threshold
      'multi_item_tier',-- qty-tiered % (e.g. 2+ = 15%, 4+ = 25%)
      'weight_tier',    -- weight-based % (e.g. oz/half/quarter)
      'basket'          -- basket-level deal (e.g. buy 3 for 2)
    );
  end if;
end$$;

-- How a target/exclusion is scoped.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'promo_scope') then
    create type public.promo_scope as enum ('all', 'category', 'brand', 'product');
  end if;
end$$;

-- ---------- promotions -------------------------------------------------------
create table if not exists public.promotions (
  id                 uuid primary key default gen_random_uuid(),
  -- Stable machine key for the migrated daily deals (e.g. 'daily.monday'); null
  -- for ad-hoc promos. Lets the seed be idempotent and the public reader map a
  -- weekday → its row without guessing by title.
  promo_key          text unique,
  title              text not null,                       -- e.g. "Munchie Monday"
  description        text,
  status             public.post_status not null default 'draft',
  discount_type      public.discount_type not null default 'percent',
  -- Headline percentage (for percent / tiered / weight deals). 0–100.
  discount_percent   numeric(5,2) not null default 0,
  -- Fixed amount off in MINOR UNITS (cents) for discount_type='fixed'.
  discount_fixed     integer not null default 0,
  -- Secondary % for multi-item tiers (e.g. 4+ get this %).
  multi_item_percent numeric(5,2),
  -- Free-form structured config for bogo/basket/tier specifics the cart reads.
  config             jsonb not null default '{}'::jsonb,
  -- When true the front-end CARD shows an honest struck per-item price; when
  -- false the deal is weight/spend/basket-based and the card shows an
  -- informational NOTE only (cart engine remains the source of truth).
  per_item_sale      boolean not null default true,
  -- Short note shown on the card/badge (e.g. "buy 2+ to save", "up to 30% off").
  bonus_note         text,
  -- Recurrence: weekly day-of-week (0=Sun..6=Sat) for the daily deals, OR a
  -- one-off/seasonal window via starts_at/ends_at. weekday null + a window =
  -- date-ranged promo; weekday set = recurring weekly.
  weekday            smallint check (weekday between 0 and 6),
  starts_at          timestamptz,
  ends_at            timestamptz,
  -- Display priority when multiple promos could match (higher wins for badge).
  priority           integer not null default 0,
  published_at       timestamptz,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  updated_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists promotions_status_idx  on public.promotions (status);
create index if not exists promotions_weekday_idx on public.promotions (weekday);

-- ---------- promotion_targets ------------------------------------------------
create table if not exists public.promotion_targets (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references public.promotions(id) on delete cascade,
  scope         public.promo_scope not null,
  -- For scope='category' a GreenwayCategory; 'brand' a brand name; 'product' a
  -- POS product key; 'all' → value null (storewide).
  value         text,
  created_at    timestamptz not null default now()
);

create index if not exists promotion_targets_promo_idx on public.promotion_targets (promotion_id);

-- ---------- promotion_exclusions ---------------------------------------------
create table if not exists public.promotion_exclusions (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references public.promotions(id) on delete cascade,
  scope         public.promo_scope not null,
  value         text,
  created_at    timestamptz not null default now()
);

create index if not exists promotion_exclusions_promo_idx on public.promotion_exclusions (promotion_id);

-- ---------- promotion_audit_snapshots ----------------------------------------
create table if not exists public.promotion_audit_snapshots (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references public.promotions(id) on delete cascade,
  -- Full JSON of the promotion + targets/exclusions + previewed affected product
  -- keys at the moment of publish. Immutable record for "what changed".
  snapshot      jsonb not null,
  affected_count integer not null default 0,
  taken_by      uuid references public.staff_profiles(id) on delete set null,
  taken_at      timestamptz not null default now()
);

create index if not exists promotion_audit_snapshots_promo_idx
  on public.promotion_audit_snapshots (promotion_id);

-- ---------- updated_at triggers ----------------------------------------------
drop trigger if exists promotions_set_updated_at on public.promotions;
create trigger promotions_set_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.promotions               enable row level security;
alter table public.promotion_targets         enable row level security;
alter table public.promotion_exclusions      enable row level security;
alter table public.promotion_audit_snapshots enable row level security;

-- promotions: staff read/write all; PUBLIC reads only PUBLISHED.
drop policy if exists promotions_staff_all on public.promotions;
create policy promotions_staff_all on public.promotions
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists promotions_public_read_published on public.promotions;
create policy promotions_public_read_published on public.promotions
  for select using (status = 'published');

-- targets: staff all; public reads targets of published promotions.
drop policy if exists promotion_targets_staff_all on public.promotion_targets;
create policy promotion_targets_staff_all on public.promotion_targets
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists promotion_targets_public_read on public.promotion_targets;
create policy promotion_targets_public_read on public.promotion_targets
  for select using (
    exists (
      select 1 from public.promotions p
      where p.id = promotion_targets.promotion_id and p.status = 'published'
    )
  );

-- exclusions: staff all; public reads exclusions of published promotions.
drop policy if exists promotion_exclusions_staff_all on public.promotion_exclusions;
create policy promotion_exclusions_staff_all on public.promotion_exclusions
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists promotion_exclusions_public_read on public.promotion_exclusions;
create policy promotion_exclusions_public_read on public.promotion_exclusions
  for select using (
    exists (
      select 1 from public.promotions p
      where p.id = promotion_exclusions.promotion_id and p.status = 'published'
    )
  );

-- audit snapshots: staff only (no public read).
drop policy if exists promotion_audit_snapshots_staff_all on public.promotion_audit_snapshots;
create policy promotion_audit_snapshots_staff_all on public.promotion_audit_snapshots
  for all using (public.is_staff()) with check (public.is_staff());
