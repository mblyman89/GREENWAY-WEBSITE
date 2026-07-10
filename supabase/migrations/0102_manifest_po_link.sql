-- =============================================================================
-- Migration 0102 — W5: link an inbound manifest to the purchase order it fulfills
-- =============================================================================
-- Closes audit gap G1 (report-intake-pipeline-audit-strategy): the ordering
-- chain (purchase_orders) and the receiving chain (inbound_manifests) had no
-- connection, so "did we get what we ordered?" was unanswerable in-system.
--
-- Design (owner decision, Q3): vendors almost never reference our PO numbers
-- on their manifests, so this is a SUGGEST-AND-CONFIRM human link — the app
-- proposes likely matches (same vendor + open PO) and an employee confirms.
-- Nothing is linked automatically.
--
-- Nullable by design: manifests can legitimately arrive with no PO (samples,
-- walk-in deals, historical imports). on delete set null: deleting a draft PO
-- never breaks a received manifest's record.
--
-- Idempotent. Apply manually in the Supabase SQL editor (standing rule).
-- Code ships no-op-safe: before this is applied, the link UI simply hides.
-- =============================================================================

alter table public.inbound_manifests
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;

create index if not exists inbound_manifests_po_idx
  on public.inbound_manifests (purchase_order_id);

comment on column public.inbound_manifests.purchase_order_id is
  'W5: the purchase order this delivery fulfills. Human-confirmed (suggest-and-confirm), never auto-linked. Null = no PO (samples, walk-ins, pre-link history).';
