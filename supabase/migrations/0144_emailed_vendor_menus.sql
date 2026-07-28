-- =============================================================================
-- SLICE 83 — Emailed vendor menus (vendor_menu@ mailbox)
-- =============================================================================
-- Many vendors send their menus by EMAIL rather than publishing on Cultivera or
-- GrowFlow. The owner points a dedicated mailbox (vendor_menu@, configurable via
-- VENDOR_MENU_MAILBOX) at our inbound-email webhook; every arrival is parsed as
-- hard as we can — plain-text body, HTML body, textual attachments (csv/txt),
-- and PDF attachments (text extracted server-side) — first with a deterministic
-- line parser, then with budget-guarded AI structured extraction when the
-- deterministic pass finds little. What survives lands here as a SNAPSHOT the
-- buyer can browse on /admin/purchasing/menus and hand off to the purchase-order
-- builder exactly like the Cultivera/GrowFlow menus (ids-only URLs, W11).
--
--   1. emailed_menu_snapshots — ONE row per menu email that produced items.
--      Holds sender provenance (from address/name, subject, received time),
--      parse provenance (which sources yielded items, which parser), a status,
--      an item_count, and the RAW context jsonb (body excerpt + attachment
--      names) so parsers can be revised later without the original email.
--      Junk/spam never creates a row here — it is only logged (with a
--      disposition) in inbound_email_log.
--
--   2. emailed_menu_items — the normalized line items. Money is INTEGER MINOR
--      UNITS (cents), never floats. Potency percentages are numeric with the
--      raw parsed blob preserved. media_asset_id links an emailed image
--      attachment saved to the media library when one clearly matches.
--
-- Reuses: public.vendors(id), public.media_assets(id), public.is_staff(),
--         public.set_updated_at() (earlier slices).
-- Money: INTEGER minor units (cents). Idempotent: create-if-not-exists +
--        drop-if-exists guards. APPLY MANUALLY (owner) — after 0143.
-- =============================================================================

create table if not exists public.emailed_menu_snapshots (
  id             uuid primary key default gen_random_uuid(),
  -- Optional link to our local vendor, guessed by matching the sender address
  -- against vendors.email. Set-null so deleting a vendor never drops history.
  vendor_id      uuid references public.vendors(id) on delete set null,
  -- Sender provenance (who mailed us the menu).
  from_address   text,
  from_name      text,
  subject        text,
  received_at    timestamptz not null default now(),
  -- 'parsed' (items found) | 'partial' (some sources failed) | 'error'.
  status         text not null default 'parsed',
  error_message  text,
  item_count     integer not null default 0,
  -- Where the items came from: 'body' | 'attachment' | 'pdf' | combinations
  -- like 'body+pdf' (provenance for the buyer and for future parser fixes).
  source         text,
  -- How they were parsed: 'deterministic' | 'ai' | 'deterministic+ai'.
  parse_method   text,
  -- Raw parse context (body excerpt, attachment names, parser notes) so the
  -- parsing can be revisited without the original email.
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_emailed_menu_snapshots_vendor
  on public.emailed_menu_snapshots (vendor_id);
create index if not exists idx_emailed_menu_snapshots_received
  on public.emailed_menu_snapshots (received_at desc);
create index if not exists idx_emailed_menu_snapshots_from
  on public.emailed_menu_snapshots (from_address);

drop trigger if exists trg_emailed_menu_snapshots_updated on public.emailed_menu_snapshots;
create trigger trg_emailed_menu_snapshots_updated
  before update on public.emailed_menu_snapshots
  for each row execute function public.set_updated_at();

alter table public.emailed_menu_snapshots enable row level security;

drop policy if exists emailed_menu_snapshots_staff_all on public.emailed_menu_snapshots;
create policy emailed_menu_snapshots_staff_all on public.emailed_menu_snapshots
  for all using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------

create table if not exists public.emailed_menu_items (
  id                     uuid primary key default gen_random_uuid(),
  snapshot_id            uuid not null references public.emailed_menu_snapshots(id) on delete cascade,
  name                   text,
  brand                  text,
  category               text,
  strain_type            text,
  size_label             text,
  unit_count             integer,
  -- Wholesale price in INTEGER MINOR UNITS (cents). Never a float.
  wholesale_price_minor  integer,
  available_qty          numeric,
  thc_pct                numeric,
  cbd_pct                numeric,
  -- Raw potency text/structure exactly as it appeared in the email.
  potency_raw            jsonb not null default '{}'::jsonb,
  description            text,
  image_url              text,
  -- Media library link, set when an emailed image attachment clearly matches
  -- this item (filename similarity) and is saved to the library.
  media_asset_id         uuid references public.media_assets(id) on delete set null,
  -- The raw source line/record this item was parsed from (audit + re-parse).
  raw                    jsonb not null default '{}'::jsonb,
  -- Display order within the snapshot (menu order preserved).
  position               integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_emailed_menu_items_snapshot
  on public.emailed_menu_items (snapshot_id, position);

drop trigger if exists trg_emailed_menu_items_updated on public.emailed_menu_items;
create trigger trg_emailed_menu_items_updated
  before update on public.emailed_menu_items
  for each row execute function public.set_updated_at();

alter table public.emailed_menu_items enable row level security;

drop policy if exists emailed_menu_items_staff_all on public.emailed_menu_items;
create policy emailed_menu_items_staff_all on public.emailed_menu_items
  for all using (public.is_staff()) with check (public.is_staff());
