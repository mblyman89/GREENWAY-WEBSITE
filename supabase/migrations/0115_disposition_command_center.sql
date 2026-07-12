-- =============================================================================
-- 0115_disposition_command_center.sql  (Task Q)
--
-- Returns & Destruction command center. Grounded in docs/RETURNS_DESTRUCTION_
-- COMPLIANCE.md (current WAC 314-55-079/-097/-225/-083/-085 + CCRS Upload
-- User Guide June 2025 + CCRS FAQ):
--
--   1. customer_returns — WAC 314-55-079(12): a retailer MAY accept returns of
--      open cannabis products from customers, but ONLY in original packaging
--      with the lot/batch/inventory ID fully legible. CCRS FAQ: the sale
--      identifier is DELETED (or Updated for partial) and the inventory
--      identifier is reported on an InventoryAdjustment "as a return, with
--      details". Restock posts a POSITIVE adjustment (internal reason
--      'return' → CCRS Other + mandatory detail); destroy additionally opens
--      a destruction_events row.
--
--   2. destruction_events waste-record columns — current WAC 314-55-097:
--      waste must be rendered unusable BEFORE leaving the premises (grind +
--      mix to ≥50% non-cannabis by volume; other methods need PRIOR LCB
--      approval) and the licensee must keep records of the method and the
--      FINAL DESTINATION (3-year retention via WAC 314-55-087). Recall-reason
--      destructions are PROHIBITED until LCB coordination (WAC 314-55-225) —
--      we capture the coordination confirmation.
--
--   3. vendor_returns manifest columns — WAC 314-55-079(11)/-085: returns to
--      a processor move on a CCRS-generated manifest (48–72h lead; confirmed
--      Mon/Wed/Fri). We track the manifest number/status and pickup time.
--
--   4. disposition_settings — the old 72-hour destruction notice was REMOVED
--      from current rule (WSR 22-14-111); the pre-destruction hold is now a
--      configurable STORE POLICY (default 72h, 0–336), not a legal mandate.
--
-- Money is MINOR UNITS (cents). Idempotent. Apply MANUALLY in the Supabase
-- SQL editor.
-- =============================================================================

-- ── customer_returns ─────────────────────────────────────────────────────────
create table if not exists public.customer_returns (
  id                        uuid primary key default gen_random_uuid(),
  -- The original sale being corrected (kept even if the order row goes away).
  order_id                  uuid references public.orders(id) on delete set null,
  order_line_id             uuid references public.order_lines(id) on delete set null,
  -- Snapshots so the CCRS Sale correction (Delete/Update) can always be built.
  sale_external_id          text,          -- = order_number (SaleExternalIdentifier)
  sale_detail_external_id   text,          -- = `${order_number}-${line.id.slice(0,8)}`
  product_name              text,
  -- CCRS Sale-row snapshot captured at return time (mirrors what the original
  -- Sale.csv Insert reported) so the correction row (Delete/Update) is built
  -- deterministically even if the order/tax settings change later. Money is
  -- MINOR UNITS (cents); line-level totals like the original file.
  inventory_external_id     text,
  sale_type                 text,          -- RecreationalRetail | RecreationalMedical
  sale_date                 date,          -- Pacific business day of the original sale
  unit_price_minor          integer,       -- ONE unit, pre-discount/tax (cents)
  discount_minor            integer,       -- whole original line (cents)
  sales_tax_minor           integer,       -- whole original line (cents)
  excise_minor              integer,       -- whole original line (cents)
  -- The inventory identifier receiving the add-back.
  lot_id                    uuid references public.inventory_lots(id) on delete set null,
  quantity                  numeric not null check (quantity > 0),
  -- Original line quantity snapshot (partial vs full return ⇒ Update vs Delete).
  original_quantity         numeric,
  -- WAC 314-55-079(12) attestations — both MUST be true to accept the return.
  original_packaging        boolean not null default false,
  lot_id_legible            boolean not null default false,
  -- restock | destroy
  disposition               text not null default 'destroy'
                            check (disposition in ('restock','destroy')),
  reason                    text not null default 'other',
  detail                    text,
  -- Refund actually given, MINOR UNITS (cents).
  refund_minor_units        integer not null default 0 check (refund_minor_units >= 0),
  -- CCRS Sale correction this return requires: Delete (full) | Update (partial).
  correction_operation      text not null default 'Delete'
                            check (correction_operation in ('Delete','Update')),
  -- pending → exported (correction CSV generated/downloaded)
  correction_status         text not null default 'pending'
                            check (correction_status in ('pending','exported')),
  correction_exported_at    timestamptz,
  -- The POSITIVE add-back adjustment (internal reason 'return' → CCRS Other).
  adjustment_id             uuid references public.inventory_adjustments(id) on delete set null,
  -- If disposition = destroy, the destruction event opened for this return.
  destruction_event_id      uuid references public.destruction_events(id) on delete set null,
  created_by                uuid references public.staff_profiles(id) on delete set null,
  created_at                timestamptz not null default now()
);

create index if not exists customer_returns_order_idx   on public.customer_returns (order_id);
create index if not exists customer_returns_lot_idx     on public.customer_returns (lot_id);
create index if not exists customer_returns_created_idx on public.customer_returns (created_at);
create index if not exists customer_returns_corr_idx    on public.customer_returns (correction_status);

-- ── destruction_events: waste-record + recall-coordination columns ──────────
alter table public.destruction_events
  add column if not exists rendering_method   text,     -- grind_mix_compostable | grind_mix_noncompostable | lcb_approved_other
  add column if not exists mix_material       text,     -- e.g. "food waste", "cardboard"
  add column if not exists final_destination  text,     -- WAC 314-55-097 record: where the waste went
  add column if not exists disposal_facility  text,     -- permitted solid-waste / compost facility
  add column if not exists lcb_coordinated    boolean not null default false,  -- WAC 314-55-225 (recall path)
  add column if not exists lcb_officer        text,     -- who at LCB coordinated the recall destruction
  add column if not exists lcb_contact_date   date;     -- when LCB was notified/coordinated

-- ── vendor_returns: manifest workflow columns (WAC 314-55-085) ──────────────
alter table public.vendor_returns
  add column if not exists manifest_number    text,
  add column if not exists manifest_status    text not null default 'none'
    check (manifest_status in ('none','requested','submitted','confirmed','picked_up')),
  add column if not exists pickup_at          timestamptz,
  add column if not exists processor_license  text;

-- ── disposition_settings (single row, id = true) ────────────────────────────
create table if not exists public.disposition_settings (
  id            boolean primary key default true check (id = true),
  -- Pre-destruction hold in HOURS. STORE POLICY, not current-rule law (the old
  -- 72h WSLCB notice was removed by WSR 22-14-111). 0 disables the hold.
  hold_hours    integer not null default 72 check (hold_hours between 0 and 336),
  updated_by    uuid references public.staff_profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);

insert into public.disposition_settings (id, hold_hours)
values (true, 72)
on conflict (id) do nothing;

drop trigger if exists disposition_settings_set_updated_at on public.disposition_settings;
create trigger disposition_settings_set_updated_at
  before update on public.disposition_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security — STAFF ONLY (app layer enforces inventory.manage).
-- =============================================================================
alter table public.customer_returns     enable row level security;
alter table public.disposition_settings enable row level security;

drop policy if exists customer_returns_staff_all on public.customer_returns;
create policy customer_returns_staff_all on public.customer_returns
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists disposition_settings_staff_read on public.disposition_settings;
create policy disposition_settings_staff_read on public.disposition_settings
  for select using (public.is_staff());

drop policy if exists disposition_settings_admin_write on public.disposition_settings;
create policy disposition_settings_admin_write on public.disposition_settings
  for all using (public.is_admin()) with check (public.is_admin());
