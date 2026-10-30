-- 0323_noncannabis_register.sql  (Fix Phase 4 · plan rows 5.1/5.2 · G-29, G-30, G-32 · F-05b-1, F-05b-3, F-05b-7, F-05b-15)
--
-- WHY. The owner, verbatim (D45):
--   "Q-05b-1- yes, and any other upgrade, enhancement and such needed to fully
--    utilize non cannabis goods in the system and on the register and on the
--    menu."
-- Other Inventory (noncannabis_products) was not connected to the register:
-- its SKU and UPC did not scan and a sale never lowered On hand (F-05b-1, S1).
-- Adjustments were read-then-write (F-05b-3) and a failed paper-invoice save
-- could leave stock moved with no invoice (F-05b-7).
--
-- WHAT (no new tables; the factory reset 0240 already wipes every table here).
--   noncannabis_adjustments  + order_id, order_line_id, unit_cost_minor_units
--                              (sale / void rows name the order; the cost
--                              snapshot is what the unit cost was then).
--                              Unique (order_line_id, reason) for 'sale' and
--                              'void' rows: a retried sync or void can never
--                              move the same line twice.
--   customer_returns         + noncannabis_product_id (a counter return of an
--                              Other Inventory line; lot_id stays null and the
--                              row is never a CCRS Sale correction).
--   apply_noncannabis_delta  ONE statement moves On hand and writes the ledger
--                              row. p_strict refuses going below zero (manual
--                              adjustments); otherwise floors at zero (a sale).
--   record_noncannabis_invoice  the paper invoice in ONE transaction: header,
--                              new drafts, restocks (On hand + weighted-average
--                              cost), lines. All or nothing.
--   record_noncannabis_return   the return row + the restock in ONE transaction.
--
-- SAFE / IDEMPOTENT: add column if not exists, create index if not exists,
-- create or replace function. Nothing existing is changed. Apply MANUALLY in
-- the Supabase SQL editor. Before it is applied the register still sells
-- Other Inventory and lowers On hand the old two-step way, and the page says
-- the update is needed.
-- Rollback: supabase/rollbacks/0323_noncannabis_register.rollback.sql.

do $$
begin
  if to_regclass('public.noncannabis_adjustments') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0323 needs public.noncannabis_adjustments (0111)';
  end if;
  if to_regclass('public.noncannabis_invoices') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0323 needs public.noncannabis_invoices (0112)';
  end if;
  if to_regclass('public.customer_returns') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0323 needs public.customer_returns (0115)';
  end if;
end $$;

begin;

alter table public.noncannabis_adjustments
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists order_line_id uuid references public.order_lines(id) on delete set null,
  add column if not exists unit_cost_minor_units integer;

create unique index if not exists idx_noncannabis_adjustments_line_once
  on public.noncannabis_adjustments(order_line_id, reason)
  where order_line_id is not null and reason in ('sale', 'void');

create index if not exists idx_noncannabis_adjustments_order
  on public.noncannabis_adjustments(order_id)
  where order_id is not null;

alter table public.customer_returns
  add column if not exists noncannabis_product_id uuid references public.noncannabis_products(id) on delete set null;

comment on column public.customer_returns.noncannabis_product_id is
  'Set for a counter return of an Other Inventory (non-cannabis) line. lot_id is null; the row is never a CCRS Sale correction (sale_type NonCannabis). Phase 4 (G-29).';

-- ── One statement: On hand + the ledger row ──────────────────────────────
-- Returns {new_qty, applied (bool), duplicate (bool), refused (bool)}.
create or replace function public.apply_noncannabis_delta(
  p_product_id    uuid,
  p_delta         integer,
  p_reason        text,
  p_note          text,
  p_actor         uuid,
  p_strict        boolean,
  p_order_id      uuid default null,
  p_order_line_id uuid default null
) returns jsonb
language plpgsql
as $$
declare
  v_qty  integer;
  v_cost integer;
  v_new  integer;
  v_adj  uuid;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'apply_noncannabis_delta: the change must be a non-zero whole number';
  end if;

  select qty_on_hand, cost_minor_units into v_qty, v_cost
    from public.noncannabis_products where id = p_product_id for update;
  if not found then
    raise exception 'apply_noncannabis_delta: product % not found', p_product_id;
  end if;

  if p_order_line_id is not null and exists (
    select 1 from public.noncannabis_adjustments
     where order_line_id = p_order_line_id and reason = p_reason
  ) then
    return jsonb_build_object('new_qty', v_qty, 'applied', false, 'duplicate', true, 'refused', false);
  end if;

  if p_strict and v_qty + p_delta < 0 then
    return jsonb_build_object('new_qty', v_qty, 'applied', false, 'duplicate', false, 'refused', true);
  end if;

  v_new := greatest(v_qty + p_delta, 0);

  insert into public.noncannabis_adjustments (product_id, qty_delta, reason, note, actor_id, order_id, order_line_id, unit_cost_minor_units)
  values (p_product_id, p_delta, p_reason, p_note, p_actor, p_order_id, p_order_line_id, nullif(v_cost, 0))
  returning id into v_adj;

  update public.noncannabis_products
     set qty_on_hand = v_new,
         updated_by  = coalesce(p_actor, updated_by)
   where id = p_product_id;

  return jsonb_build_object('new_qty', v_new, 'applied', true, 'duplicate', false, 'refused', false, 'adjustment_id', v_adj);
end;
$$;

-- ── The paper invoice in one transaction ─────────────────────────────────
-- p_header: {invoice_number, vendor_id, vendor_name, invoice_date, total_minor_units, note}
-- p_lines:  [{kind:'new'|'existing', product_id?, description, qty, unit_cost_minor_units,
--             new_product?: {sku, name, type, price_minor_units, notes}}]
create or replace function public.record_noncannabis_invoice(
  p_header jsonb,
  p_lines  jsonb,
  p_actor  uuid
) returns jsonb
language plpgsql
as $$
declare
  v_inv      uuid;
  v_line     jsonb;
  v_pid      uuid;
  v_qty      integer;
  v_cost     integer;
  v_old_qty  integer;
  v_old_cost integer;
  v_avg      integer;
  v_staged   integer := 0;
  v_restock  integer := 0;
  v_np       jsonb;
begin
  insert into public.noncannabis_invoices (invoice_number, vendor_id, vendor_name, invoice_date, total_minor_units, status, note, created_by)
  values (
    p_header->>'invoice_number',
    nullif(p_header->>'vendor_id', '')::uuid,
    p_header->>'vendor_name',
    coalesce(nullif(p_header->>'invoice_date', '')::date, current_date),
    (p_header->>'total_minor_units')::integer,
    'open',
    nullif(p_header->>'note', ''),
    p_actor
  )
  returning id into v_inv;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty  := (v_line->>'qty')::integer;
    v_cost := (v_line->>'unit_cost_minor_units')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'record_noncannabis_invoice: a line has no quantity';
    end if;
    if v_cost is null or v_cost < 0 then
      raise exception 'record_noncannabis_invoice: a line has no unit cost';
    end if;

    if v_line->>'kind' = 'new' then
      v_np := v_line->'new_product';
      insert into public.noncannabis_products (sku, name, type, price_minor_units, cost_minor_units, qty_on_hand, status, notes, created_by, updated_by)
      values (
        v_np->>'sku', v_np->>'name', coalesce(nullif(v_np->>'type', ''), 'other'),
        greatest(coalesce((v_np->>'price_minor_units')::integer, 0), 0),
        v_cost, v_qty, 'draft', nullif(v_np->>'notes', ''), p_actor, p_actor
      )
      returning id into v_pid;
      insert into public.noncannabis_adjustments (product_id, qty_delta, reason, note, actor_id, unit_cost_minor_units)
      values (v_pid, v_qty, 'invoice_received', 'Vendor invoice #' || (p_header->>'invoice_number') || ' (' || (p_header->>'vendor_name') || '), new draft', p_actor, nullif(v_cost, 0));
      v_staged := v_staged + 1;
    else
      v_pid := (v_line->>'product_id')::uuid;
      select qty_on_hand, cost_minor_units into v_old_qty, v_old_cost
        from public.noncannabis_products where id = v_pid for update;
      if not found then
        raise exception 'record_noncannabis_invoice: product % not found', v_pid;
      end if;
      -- Moving weighted average (same rule as pos-catalog-core weightedAverageCost).
      if v_cost <= 0 then
        v_avg := v_old_cost;
      elsif greatest(v_old_qty, 0) <= 0 or v_old_cost <= 0 then
        v_avg := v_cost;
      else
        v_avg := round((greatest(v_old_qty, 0)::numeric * v_old_cost + v_qty::numeric * v_cost) / (greatest(v_old_qty, 0) + v_qty));
      end if;
      update public.noncannabis_products
         set qty_on_hand = greatest(qty_on_hand, 0) + v_qty,
             cost_minor_units = v_avg,
             updated_by = p_actor
       where id = v_pid;
      insert into public.noncannabis_adjustments (product_id, qty_delta, reason, note, actor_id, unit_cost_minor_units)
      values (v_pid, v_qty, 'received', 'Vendor invoice #' || (p_header->>'invoice_number') || ' (' || (p_header->>'vendor_name') || ')', p_actor, nullif(v_cost, 0));
      v_restock := v_restock + 1;
    end if;

    insert into public.noncannabis_invoice_lines (invoice_id, product_id, description, qty, unit_cost_minor_units)
    values (v_inv, v_pid, v_line->>'description', v_qty, v_cost);
  end loop;

  return jsonb_build_object('invoice_id', v_inv, 'staged', v_staged, 'restocked', v_restock);
end;
$$;

-- ── A counter return of an Other Inventory line, in one transaction ──────
-- p_return: the customer_returns columns (sale snapshot, refund, reason ...).
create or replace function public.record_noncannabis_return(
  p_product_id uuid,
  p_qty        integer,
  p_restock    boolean,
  p_note       text,
  p_actor      uuid,
  p_return     jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_ret uuid;
  v_adj uuid := null;
  v_found uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'record_noncannabis_return: quantity must be greater than zero';
  end if;

  if p_restock then
    update public.noncannabis_products
       set qty_on_hand = greatest(qty_on_hand, 0) + p_qty,
           updated_by  = coalesce(p_actor, updated_by)
     where id = p_product_id
     returning id into v_found;
    if v_found is null then
      raise exception 'record_noncannabis_return: product % not found', p_product_id;
    end if;
    insert into public.noncannabis_adjustments (product_id, qty_delta, reason, note, actor_id, order_id, order_line_id)
    values (p_product_id, p_qty, 'return_restock', p_note, p_actor,
            (p_return->>'order_id')::uuid, (p_return->>'order_line_id')::uuid)
    returning id into v_adj;
  end if;

  insert into public.customer_returns (
    order_id, order_line_id, sale_external_id, sale_detail_external_id,
    product_name, inventory_external_id, sale_type, sale_date,
    unit_price_minor, discount_minor, sales_tax_minor, excise_minor,
    lot_id, quantity, original_quantity, original_packaging, lot_id_legible,
    disposition, reason, detail, refund_minor_units, correction_operation,
    correction_status, created_by, noncannabis_product_id
  ) values (
    (p_return->>'order_id')::uuid,
    (p_return->>'order_line_id')::uuid,
    p_return->>'sale_external_id',
    p_return->>'sale_detail_external_id',
    p_return->>'product_name',
    null,
    'NonCannabis',
    (p_return->>'sale_date')::date,
    (p_return->>'unit_price_minor')::integer,
    0, (p_return->>'sales_tax_minor')::integer, 0,
    null,
    p_qty,
    (p_return->>'original_quantity')::numeric,
    coalesce((p_return->>'original_packaging')::boolean, false),
    coalesce((p_return->>'lot_id_legible')::boolean, false),
    case when p_restock then 'restock' else 'destroy' end,
    coalesce(p_return->>'reason', 'other'),
    p_return->>'detail',
    coalesce((p_return->>'refund_minor_units')::integer, 0),
    coalesce(p_return->>'correction_operation', 'Delete'),
    'exported',
    p_actor,
    p_product_id
  )
  returning id into v_ret;

  return jsonb_build_object('return_id', v_ret, 'adjustment_id', v_adj);
end;
$$;

revoke execute on function public.apply_noncannabis_delta(uuid, integer, text, text, uuid, boolean, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_noncannabis_invoice(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.record_noncannabis_return(uuid, integer, boolean, text, uuid, jsonb) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
