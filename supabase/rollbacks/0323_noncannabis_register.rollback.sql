-- supabase/rollbacks/0323_noncannabis_register.rollback.sql  (Fix Phase 4)
-- Drops the three functions and the new columns. Sale / void / return ledger
-- rows keep their quantities but LOSE the order link and cost snapshot, and
-- non-cannabis returns lose the product link. Only if needed.
begin;
drop function if exists public.record_noncannabis_return(uuid, integer, boolean, text, uuid, jsonb);
drop function if exists public.record_noncannabis_invoice(jsonb, jsonb, uuid);
drop function if exists public.apply_noncannabis_delta(uuid, integer, text, text, uuid, boolean, uuid, uuid);
drop index if exists public.idx_noncannabis_adjustments_line_once;
drop index if exists public.idx_noncannabis_adjustments_order;
alter table public.customer_returns drop column if exists noncannabis_product_id;
alter table public.noncannabis_adjustments
  drop column if exists unit_cost_minor_units,
  drop column if exists order_line_id,
  drop column if exists order_id;
commit;
notify pgrst, 'reload schema';
