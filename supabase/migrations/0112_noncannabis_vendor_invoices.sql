-- =============================================================================
-- 0112 — Non-cannabis vendor invoices (manual paper-invoice intake) + unified
--        AP payments ledger support.
-- =============================================================================
-- Task N (owner request, verbatim intent): "we won't be accepting non cannabis
-- products through the email intake process. It will be a manual process. The
-- glass vendor will come in with a stock of inventory, we pick out what we
-- want, then they write us up a paper invoice. So id like a way to intake non
-- cannabis products through the other inventory page. It should be a simple
-- invoice builder type of form, where we manually input the details and submit
-- the form. That way we can use it as a source document for the ach payments
-- page for vendors."
--
-- WHAT THIS ADDS
--   1. noncannabis_invoices — the paper invoice HEADER (vendor, invoice number,
--      invoice date, total). This is the payable SOURCE DOCUMENT for glass /
--      accessory vendor visits, parallel to how an ACCEPTED inbound manifest is
--      the source document for cannabis deliveries.
--   2. noncannabis_invoice_lines — what was picked out, line by line. Each line
--      references the noncannabis_products row it staged (new draft) or
--      restocked (received adjustment), so the invoice is traceable to stock.
--   3. vendor_manifest_payments becomes the UNIFIED AP payments ledger:
--        * manifest_id loses NOT NULL (it stays the link for cannabis manifests)
--        * noncannabis_invoice_id is added (the link for these paper invoices)
--        * a CHECK enforces EXACTLY ONE source document per payment row
--      Keeping ONE ledger means the Accounts Payable page, ACH batches and the
--      Sage 50 vendor-payment exports all see these payments with zero forks.
--      (Existing rows all have manifest_id set → the CHECK holds for them.)
--
-- GUARDRAILS (enforced in app logic, see noncannabis invoice-core.ts):
--   • payment must reference an OPEN (not fully paid) invoice
--   • overpay  (paid > total - already_paid)  = BLOCKED
--   • underpay (0 < paid < remaining)         = allowed WITH WARNING
--
-- MONEY IS CENTS (integer minor units) everywhere. DRAFTS-ONLY: recording a
-- payment logs intent / the generated NACHA batch; nothing is transmitted.
--
-- Idempotent: create-if-not-exists / drop-first. Apply MANUALLY in the
-- Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- noncannabis_invoices — paper invoice header (the payable source document).
-- ---------------------------------------------------------------------------
create table if not exists public.noncannabis_invoices (
  id                 uuid primary key default gen_random_uuid(),
  -- The number printed on the vendor's paper invoice (required, human key).
  invoice_number     text not null,
  -- Vendor link when the name matches a known vendor; the typed name is always
  -- kept as a snapshot so the record stands alone even if the vendor row goes.
  vendor_id          uuid references public.vendors(id) on delete set null,
  vendor_name        text not null,
  -- The date written on the paper invoice (defaults to the visit day).
  invoice_date       date not null default current_date,
  -- Grand total in CENTS — must equal SUM(qty * unit_cost) over its lines
  -- (recomputed and enforced by the application before insert).
  total_minor_units  integer not null check (total_minor_units >= 0),
  -- open = still owed money; paid = fully settled (stamped by the app when
  -- recorded payments cover the total). Remaining-owed math always derives
  -- from the payments ledger — this column is a fast filter, not the truth.
  status             text not null default 'open'
                     check (status in ('open', 'paid')),
  note               text,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Same vendor may reuse invoice numbers across years; we only require the
-- number to be unique PER vendor name so duplicates are caught at entry.
create unique index if not exists idx_noncannabis_invoices_vendor_number
  on public.noncannabis_invoices(lower(vendor_name), lower(invoice_number));

create index if not exists idx_noncannabis_invoices_status
  on public.noncannabis_invoices(status, invoice_date desc);

-- ---------------------------------------------------------------------------
-- noncannabis_invoice_lines — what was picked out, line by line.
-- ---------------------------------------------------------------------------
create table if not exists public.noncannabis_invoice_lines (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.noncannabis_invoices(id) on delete cascade,
  -- The catalog row this line staged (new draft) or restocked (received
  -- adjustment). SET NULL so deleting a product never destroys the invoice.
  product_id            uuid references public.noncannabis_products(id) on delete set null,
  -- Snapshot of what the line said, independent of the product row.
  description           text not null,
  qty                   integer not null check (qty > 0),
  unit_cost_minor_units integer not null check (unit_cost_minor_units >= 0),
  created_at            timestamptz not null default now()
);

create index if not exists idx_noncannabis_invoice_lines_invoice
  on public.noncannabis_invoice_lines(invoice_id);
create index if not exists idx_noncannabis_invoice_lines_product
  on public.noncannabis_invoice_lines(product_id);

-- ---------------------------------------------------------------------------
-- vendor_manifest_payments → unified AP ledger (manifest OR paper invoice).
-- ---------------------------------------------------------------------------
alter table public.vendor_manifest_payments
  alter column manifest_id drop not null;

alter table public.vendor_manifest_payments
  add column if not exists noncannabis_invoice_id uuid
    references public.noncannabis_invoices(id) on delete restrict;

-- Every payment row must be married to EXACTLY ONE source document.
alter table public.vendor_manifest_payments
  drop constraint if exists vendor_manifest_payments_one_source_check;
alter table public.vendor_manifest_payments
  add constraint vendor_manifest_payments_one_source_check
  check ((manifest_id is null) <> (noncannabis_invoice_id is null));

create index if not exists idx_vendor_manifest_payments_nc_invoice
  on public.vendor_manifest_payments(noncannabis_invoice_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger (mirrors 0076's guarded pattern).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_noncannabis_invoices_updated_at on public.noncannabis_invoices;
    create trigger trg_noncannabis_invoices_updated_at
      before update on public.noncannabis_invoices
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — staff read, admin write (same posture as vendor_manifest_payments).
-- ---------------------------------------------------------------------------
alter table public.noncannabis_invoices enable row level security;

drop policy if exists "noncannabis_invoices staff read" on public.noncannabis_invoices;
create policy "noncannabis_invoices staff read" on public.noncannabis_invoices
  for select using (public.is_staff());

drop policy if exists "noncannabis_invoices admin write" on public.noncannabis_invoices;
create policy "noncannabis_invoices admin write" on public.noncannabis_invoices
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.noncannabis_invoice_lines enable row level security;

drop policy if exists "noncannabis_invoice_lines staff read" on public.noncannabis_invoice_lines;
create policy "noncannabis_invoice_lines staff read" on public.noncannabis_invoice_lines
  for select using (public.is_staff());

drop policy if exists "noncannabis_invoice_lines admin write" on public.noncannabis_invoice_lines;
create policy "noncannabis_invoice_lines admin write" on public.noncannabis_invoice_lines
  for all using (public.is_admin()) with check (public.is_admin());
