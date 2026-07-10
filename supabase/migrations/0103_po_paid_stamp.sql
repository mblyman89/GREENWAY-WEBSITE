-- =============================================================================
-- Migration 0103 — W9: "paid" stamp on purchase orders
-- =============================================================================
-- Closes audit gap G3 (report-intake-pipeline-audit-strategy, Pillar D3):
-- Accounts Payable knew a vendor invoice (accepted manifest) was paid, but
-- Purchasing had no idea — "which received POs are still unpaid?" was
-- unanswerable without cross-referencing two pages by hand.
--
-- Design: when a payment recorded in AP settles EVERY manifest linked to a
-- purchase order (W5 link, migration 0102), the app stamps `paid_at` and a
-- human-readable `payment_reference` (check #, wire memo, or NACHA batch ref)
-- on the PO. First settle wins; the stamp is never overwritten. Purchasing
-- shows the badge. Drafts-only ethos unchanged: nothing is sent anywhere —
-- this is a bookkeeping stamp written AFTER a human records the payment.
--
-- Nullable by design: POs predating this migration, POs with no linked
-- manifests, and unpaid POs simply have null paid_at.
--
-- Idempotent. Apply manually in the Supabase SQL editor (standing rule).
-- Code ships no-op-safe: before this is applied, the stamp silently sleeps
-- and the Purchasing UI simply never shows a paid badge.
-- =============================================================================

alter table public.purchase_orders
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reference text;

create index if not exists purchase_orders_paid_idx
  on public.purchase_orders (paid_at);

comment on column public.purchase_orders.paid_at is
  'W9: set when AP payments settle every manifest linked to this PO. First settle wins; never overwritten. Null = not (fully) paid or pre-migration.';
comment on column public.purchase_orders.payment_reference is
  'W9: human-readable reference for the settling payment (check #, wire memo, or NACHA batch ref).';
