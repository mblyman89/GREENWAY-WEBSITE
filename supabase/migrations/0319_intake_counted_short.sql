-- 0319_intake_counted_short.sql  (Fix Phase 3.1 · G-16 · F-04-1 · owner D29)
--
-- WHY. The owner, verbatim:
--   "So we need the ability to tell the system that we are only accepting a
--    part of the manifest and the rest was rejected. There are several
--    instances where the vendor forgot to send an item, or it broke in
--    transit, etc." (docs/ccrs-rejection-and-returns.md L15-21)
--   D29 "Q-04-1- we need a way to accept less than what came in, please add
--        this to the list of serious issues to fix"
--        (docs/sop-program/00-OWNER-REQUEST-VERBATIM.md L108)
--   Owner message 6: "please begin work on phase 3, receiving: accept "18 of 20""
-- Until now a line was accepted whole or refused whole (F-04-1, S1).
--
-- WHAT. Five columns on inventory_lots, written only while the line is still
-- staged (quarantine / pending) on an open delivery, by a manager (D30):
--   shipped_qty        the manifest's quantity, kept when the dock count is
--                      lower. NULL = the line was never counted short, and
--                      received_qty is the manifest quantity as before.
--   short_reason_code  why the difference was refused (the dock reasons less
--                      "overage": receiving MORE than the manifest is refused).
--   short_reason       the reason in words (label, plus the person's text).
--   counted_by / counted_at  who entered the count and when.
-- received_qty and on_hand_qty become the COUNTED quantity, so everything
-- that already reads received_qty follows the count with no other change:
-- the receive adjustment at Finalize, the weekly CCRS InventoryTransfer
-- Quantity (ccrs-transfer-core.ts rule 3), Inventory.csv, the goods receipt,
-- the vendor bill, the PO auto-receive and the trade-sample unit count.
-- The refused units never entered inventory: they go back with the driver
-- and the vendor corrects their manifest in CCRS (Update). We file nothing
-- for them (docs/ccrs-rejection-and-returns.md L30-50).
--
-- SAFE / IDEMPOTENT: add column if not exists and guarded checks only.
-- Nothing is written. Apply MANUALLY in the Supabase SQL editor. Before it is
-- applied the receiving page hides Count short, a stray count is refused
-- with "migration 0319 is not applied" and nothing is changed (the received
-- quantity is never rewritten without the manifest quantity being kept), and
-- Finalize works exactly as before.
-- Rollback: supabase/rollbacks/0319_intake_counted_short.rollback.sql (read
-- its warning first: a short-counted line still staged must be put back to
-- the manifest quantity, or refused, before the columns are dropped).

begin;

alter table public.inventory_lots
  add column if not exists shipped_qty       numeric,
  add column if not exists short_reason_code text,
  add column if not exists short_reason      text,
  add column if not exists counted_by        uuid references public.staff_profiles(id) on delete set null,
  add column if not exists counted_at        timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_shipped_qty_chk') then
    alter table public.inventory_lots
      add constraint inventory_lots_shipped_qty_chk
      check (shipped_qty is null or (shipped_qty > 0 and received_qty >= 0 and received_qty < shipped_qty));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_short_reason_code_chk') then
    alter table public.inventory_lots
      add constraint inventory_lots_short_reason_code_chk
      check (
        (shipped_qty is null and short_reason_code is null)
        or (shipped_qty is not null and short_reason_code in
            ('short_shipment', 'damaged_in_transit', 'wrong_product', 'failed_coa', 'expired', 'other'))
      );
  end if;
end $$;

comment on column public.inventory_lots.shipped_qty is
  'Manifest quantity when the dock count was lower (received_qty = counted). NULL = not counted short. Fix Phase 3.1 (G-16, owner D29).';
comment on column public.inventory_lots.short_reason_code is
  'Why the difference between shipped_qty and received_qty was refused at the dock. Fix Phase 3.1 (G-16).';

commit;
