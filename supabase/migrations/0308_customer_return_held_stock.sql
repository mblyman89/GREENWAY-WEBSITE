-- 0308_customer_return_held_stock.sql  (Fix Phase 1.4 · G-44 · F-15-6, F-15-7)
--
-- WHY. A customer-returned unit marked Destroy was added back to an Active
-- lot and counted as sellable stock: the register could sell it before the
-- destruction was completed (F-15-6, S1). The add-back, the destruction event
-- and the return record were also three separate writes (F-15-7).
--
-- WHAT.
--   inventory_lots.held_qty            units on hand that may NOT be sold
--                                      (sellable = on_hand_qty - held_qty).
--                                      Still on hand: CCRS Inventory, counts
--                                      and valuation keep using on_hand_qty.
--   destruction_events.held_qty_reserved  the held units this event will
--                                      destroy (customer-return Destroy).
--   destruction_events.lot_status_touched  (same column as 0307; repeated
--                                      here, if not exists, so 0308 works
--                                      even if 0307 is applied later).
--   record_customer_return(...)        ONE transaction: the CCRS Other
--                                      add-back adjustment, on hand (+ held
--                                      for Destroy), the destruction event,
--                                      and the customer_returns row. All or
--                                      nothing.
--   consume_lot_hold(...)              completing a held destruction takes
--                                      on hand and held down together.
--   release_lot_hold(...)              the owner's cancel releases the hold.
--
-- SAFE / IDEMPOTENT: add column if not exists, guarded constraints, create or
-- replace functions. Existing lots get held_qty = 0 (nothing changes for
-- them). Apply MANUALLY in the SQL editor. Before it is applied the app
-- still works the old way and says so on the return.

begin;

alter table public.inventory_lots
  add column if not exists held_qty numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_held_nonneg') then
    alter table public.inventory_lots
      add constraint inventory_lots_held_nonneg check (held_qty >= 0);
  end if;
end $$;

comment on column public.inventory_lots.held_qty is
  'Units on hand that may not be sold (customer-return Destroy waiting for destruction). Sellable = on_hand_qty - held_qty. Phase 1.4 (G-44).';

alter table public.destruction_events
  add column if not exists held_qty_reserved  numeric not null default 0,
  add column if not exists lot_status_touched boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'destruction_events_held_nonneg') then
    alter table public.destruction_events
      add constraint destruction_events_held_nonneg check (held_qty_reserved >= 0);
  end if;
end $$;

comment on column public.destruction_events.held_qty_reserved is
  'Held units (inventory_lots.held_qty) this event will destroy; completion consumes them, an owner cancel releases them. Phase 1.4 (G-44).';

-- ── One transaction for a customer return ─────────────────────────────────
-- p_return is the customer_returns row as JSON (the app builds every column);
-- p_destruction is null for Restock, or {quantity, reason, detail,
-- earliest_destroy_at} for Destroy. Returns {return_id, adjustment_id,
-- destruction_event_id}. Any error rolls the whole thing back.
create or replace function public.record_customer_return(
  p_lot_id      uuid,
  p_qty         numeric,
  p_note        text,
  p_actor       uuid,
  p_hold        boolean,
  p_destruction jsonb,
  p_return      jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_adj    uuid;
  v_evt    uuid := null;
  v_ret    uuid;
  v_found  uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'record_customer_return: quantity must be greater than zero';
  end if;

  insert into public.inventory_adjustments (lot_id, qty_delta, reason, note, actor_id)
  values (p_lot_id, p_qty, 'return', p_note, p_actor)
  returning id into v_adj;

  update public.inventory_lots
     set on_hand_qty = on_hand_qty + p_qty,
         held_qty    = held_qty + case when p_hold then p_qty else 0 end,
         updated_by  = coalesce(p_actor, updated_by)
   where id = p_lot_id
   returning id into v_found;
  if v_found is null then
    raise exception 'record_customer_return: lot % not found', p_lot_id;
  end if;

  if p_destruction is not null then
    insert into public.destruction_events (
      lot_id, quantity, reason, detail, status, quarantine_start,
      earliest_destroy_at, created_by, lot_status_touched, held_qty_reserved
    ) values (
      p_lot_id,
      p_qty,
      coalesce(p_destruction->>'reason', 'other'),
      p_destruction->>'detail',
      'pending_quarantine',
      now(),
      (p_destruction->>'earliest_destroy_at')::timestamptz,
      p_actor,
      false,
      case when p_hold then p_qty else 0 end
    )
    returning id into v_evt;
  end if;

  insert into public.customer_returns (
    order_id, order_line_id, sale_external_id, sale_detail_external_id,
    product_name, inventory_external_id, sale_type, sale_date,
    unit_price_minor, discount_minor, sales_tax_minor, excise_minor,
    lot_id, quantity, original_quantity, original_packaging, lot_id_legible,
    disposition, reason, detail, refund_minor_units, correction_operation,
    correction_status, adjustment_id, destruction_event_id, created_by
  ) values (
    (p_return->>'order_id')::uuid,
    (p_return->>'order_line_id')::uuid,
    p_return->>'sale_external_id',
    p_return->>'sale_detail_external_id',
    p_return->>'product_name',
    p_return->>'inventory_external_id',
    p_return->>'sale_type',
    (p_return->>'sale_date')::date,
    (p_return->>'unit_price_minor')::integer,
    (p_return->>'discount_minor')::integer,
    (p_return->>'sales_tax_minor')::integer,
    (p_return->>'excise_minor')::integer,
    p_lot_id,
    p_qty,
    (p_return->>'original_quantity')::numeric,
    coalesce((p_return->>'original_packaging')::boolean, false),
    coalesce((p_return->>'lot_id_legible')::boolean, false),
    p_return->>'disposition',
    coalesce(p_return->>'reason', 'other'),
    p_return->>'detail',
    coalesce((p_return->>'refund_minor_units')::integer, 0),
    coalesce(p_return->>'correction_operation', 'Delete'),
    coalesce(p_return->>'correction_status', 'pending'),
    v_adj,
    v_evt,
    p_actor
  )
  returning id into v_ret;

  return jsonb_build_object('return_id', v_ret, 'adjustment_id', v_adj, 'destruction_event_id', v_evt);
end;
$$;

-- ── Complete a held destruction: on hand and held come down together ──────
-- Returns the new on hand, or null (refused: not enough held or on hand).
create or replace function public.consume_lot_hold(
  p_lot_id uuid,
  p_qty    numeric,
  p_actor  uuid default null
) returns numeric
language plpgsql
as $$
declare
  v_new numeric;
begin
  update public.inventory_lots
     set on_hand_qty = on_hand_qty - p_qty,
         held_qty    = held_qty - p_qty,
         updated_by  = coalesce(p_actor, updated_by)
   where id = p_lot_id
     and p_qty > 0
     and held_qty >= p_qty
     and on_hand_qty >= p_qty
   returning on_hand_qty into v_new;
  return v_new;
end;
$$;

-- ── Release a hold (owner cancel): on hand unchanged ──────────────────────
-- Returns the new held quantity, or null when the lot is missing.
create or replace function public.release_lot_hold(
  p_lot_id uuid,
  p_qty    numeric,
  p_actor  uuid default null
) returns numeric
language plpgsql
as $$
declare
  v_new numeric;
begin
  update public.inventory_lots
     set held_qty   = greatest(held_qty - greatest(p_qty, 0), 0),
         updated_by = coalesce(p_actor, updated_by)
   where id = p_lot_id
   returning held_qty into v_new;
  return v_new;
end;
$$;

revoke execute on function public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.consume_lot_hold(uuid, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.release_lot_hold(uuid, numeric, uuid) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
