-- 0309_vendor_return_staged.sql  (Fix Phase 1.5 · G-42 · F-15-1, F-15-2, F-15-3, F-15-19)
--
-- WHY. Logging a vendor return took the units off on-hand and posted the CCRS
-- Other adjustment at once (F-15-1, S1), while the product was still in our
-- vault waiting for the processor and the LCB's manifest. The owner (D63):
-- "I want to follow the states requirements." Logging now RESERVES the units
-- (out of sale, still on hand and in CCRS); on-hand comes off and the CCRS
-- Other adjustment posts only at departure. Steps are checked on the server
-- and stamped with who and when (F-15-3).
--
-- WHAT.
--   vendor_returns.reserved_qty          units held (inventory_lots.held_qty)
--                                        for this return until it departs.
--   vendor_returns.vendor/step columns   who and when for every step, the
--                                        manifest's transport details (and the
--                                        item's WeightPerUnit / ServingsPerUnit
--                                        when the lot does not carry them), the LCB
--                                        email date, the departure, the cancel.
--   manifest_status                      adds 'cancelled' (owner cancel).
--   reserve_vendor_return(...)           ONE transaction: check free units,
--                                        hold them, insert the return.
--   depart_vendor_return(...)            ONE transaction: the CCRS Other
--                                        adjustment, on hand and held down
--                                        together, the return marked departed.
--   release_vendor_return(...)           owner cancel: release the hold.
--
-- Needs 0308 (inventory_lots.held_qty). SAFE / IDEMPOTENT: add column if not
-- exists, the status check is dropped and recreated, create or replace
-- functions. Apply MANUALLY in the SQL editor. Before it is applied the app
-- refuses to log a new vendor return and says so (it never falls back to the
-- old reduce-at-logging behaviour).

begin;

alter table public.inventory_lots
  add column if not exists held_qty numeric not null default 0;

alter table public.vendor_returns
  add column if not exists reserved_qty          numeric not null default 0,
  add column if not exists recall_officer        text,
  add column if not exists recall_contact_date   date,
  add column if not exists requested_by          uuid references public.staff_profiles(id) on delete set null,
  add column if not exists requested_at          timestamptz,
  add column if not exists transportation_type   text,
  add column if not exists transporter_license   text,
  add column if not exists driver_name           text,
  add column if not exists vehicle_vin           text,
  add column if not exists vehicle_plate         text,
  add column if not exists vehicle_make          text,
  add column if not exists vehicle_model         text,
  add column if not exists vehicle_color         text,
  add column if not exists est_departure_at      timestamptz,
  add column if not exists est_arrival_at        timestamptz,
  add column if not exists weight_per_unit_g     numeric,
  add column if not exists servings_per_unit     numeric,
  add column if not exists submitted_by          uuid references public.staff_profiles(id) on delete set null,
  add column if not exists submitted_at          timestamptz,
  add column if not exists lcb_email_date        date,
  add column if not exists confirmed_by          uuid references public.staff_profiles(id) on delete set null,
  add column if not exists confirmed_at          timestamptz,
  add column if not exists departed_by           uuid references public.staff_profiles(id) on delete set null,
  add column if not exists departed_at           timestamptz,
  add column if not exists cancelled_by          uuid references public.staff_profiles(id) on delete set null,
  add column if not exists cancelled_at          timestamptz,
  add column if not exists cancel_reason         text,
  add column if not exists manifest_number       text,
  add column if not exists manifest_status       text not null default 'none',
  add column if not exists pickup_at             timestamptz,
  add column if not exists processor_license     text;

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.vendor_returns'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%manifest_status%'
  loop
    execute format('alter table public.vendor_returns drop constraint %I', c);
  end loop;
  alter table public.vendor_returns
    add constraint vendor_returns_manifest_status_check
    check (manifest_status in ('none','requested','submitted','confirmed','picked_up','cancelled'));
  if not exists (select 1 from pg_constraint where conname = 'vendor_returns_reserved_nonneg') then
    alter table public.vendor_returns
      add constraint vendor_returns_reserved_nonneg check (reserved_qty >= 0);
  end if;
end $$;

comment on column public.vendor_returns.reserved_qty is
  'Units held on the lot (inventory_lots.held_qty) for this return until it departs; 0 after departure or cancel, and 0 for a return logged before Phase 1.5 (those reduced on-hand at logging). G-42.';

-- ── Log: reserve the units and save the return, in one step ─────────────────
-- p_return: the vendor_returns row as JSON (the app builds every column).
-- Returns the new return id. Refuses (raises) when the lot lacks free units.
create or replace function public.reserve_vendor_return(
  p_lot_id uuid,
  p_qty    numeric,
  p_actor  uuid,
  p_return jsonb
) returns uuid
language plpgsql
as $$
declare
  v_found uuid;
  v_ret   uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'reserve_vendor_return: quantity must be greater than zero';
  end if;
  update public.inventory_lots
     set held_qty   = held_qty + p_qty,
         updated_by = coalesce(p_actor, updated_by)
   where id = p_lot_id
     and on_hand_qty - held_qty >= p_qty
   returning id into v_found;
  if v_found is null then
    raise exception 'reserve_vendor_return: the lot does not have % free unit(s) (held units cannot be returned)', p_qty;
  end if;
  insert into public.vendor_returns (
    lot_id, vendor_id, quantity, reason, detail, rma_number, processor_license,
    manifest_status, reserved_qty, recall_officer, recall_contact_date,
    requested_by, requested_at, created_by
  ) values (
    p_lot_id,
    (p_return->>'vendor_id')::uuid,
    p_qty,
    coalesce(p_return->>'reason', 'other'),
    p_return->>'detail',
    p_return->>'rma_number',
    p_return->>'processor_license',
    'requested',
    p_qty,
    p_return->>'recall_officer',
    (p_return->>'recall_contact_date')::date,
    p_actor,
    now(),
    p_actor
  )
  returning id into v_ret;
  return v_ret;
end;
$$;

-- ── Departure: CCRS Other adjustment + on hand and held down, in one step ───
-- Only from 'confirmed' (the LCB's success email and PDF received). Returns
-- the adjustment id. Raises on any refusal; nothing is written then.
create or replace function public.depart_vendor_return(
  p_return_id uuid,
  p_note      text,
  p_pickup_at timestamptz,
  p_driver    text,
  p_actor     uuid
) returns uuid
language plpgsql
as $$
declare
  r      public.vendor_returns%rowtype;
  v_adj  uuid;
  v_lot  uuid;
begin
  select * into r from public.vendor_returns where id = p_return_id for update;
  if not found then
    raise exception 'depart_vendor_return: return % not found', p_return_id;
  end if;
  if r.manifest_status <> 'confirmed' then
    raise exception 'depart_vendor_return: the return is %, not "LCB success email and PDF received"', r.manifest_status;
  end if;
  if r.reserved_qty <= 0 then
    raise exception 'depart_vendor_return: nothing is reserved on this return';
  end if;

  insert into public.inventory_adjustments (lot_id, qty_delta, reason, note, actor_id)
  values (r.lot_id, -r.reserved_qty, 'other', p_note, p_actor)
  returning id into v_adj;

  update public.inventory_lots
     set on_hand_qty = on_hand_qty - r.reserved_qty,
         held_qty    = held_qty - r.reserved_qty,
         updated_by  = coalesce(p_actor, updated_by)
   where id = r.lot_id
     and held_qty >= r.reserved_qty
     and on_hand_qty >= r.reserved_qty
   returning id into v_lot;
  if v_lot is null then
    raise exception 'depart_vendor_return: the lot no longer holds the % reserved unit(s)', r.reserved_qty;
  end if;

  update public.vendor_returns
     set manifest_status = 'picked_up',
         pickup_at       = p_pickup_at,
         driver_name     = coalesce(nullif(p_driver, ''), driver_name),
         departed_by     = p_actor,
         departed_at     = now(),
         adjustment_id   = v_adj,
         reserved_qty    = 0
   where id = p_return_id;
  return v_adj;
end;
$$;

-- ── Owner cancel: release the hold (on hand unchanged) ─────────────────────
create or replace function public.release_vendor_return(
  p_return_id uuid,
  p_reason    text,
  p_actor     uuid
) returns numeric
language plpgsql
as $$
declare
  r public.vendor_returns%rowtype;
begin
  select * into r from public.vendor_returns where id = p_return_id for update;
  if not found then
    raise exception 'release_vendor_return: return % not found', p_return_id;
  end if;
  if r.manifest_status in ('picked_up', 'cancelled') then
    raise exception 'release_vendor_return: the return is already %', r.manifest_status;
  end if;
  update public.inventory_lots
     set held_qty   = greatest(held_qty - r.reserved_qty, 0),
         updated_by = coalesce(p_actor, updated_by)
   where id = r.lot_id;
  update public.vendor_returns
     set manifest_status = 'cancelled',
         cancelled_by    = p_actor,
         cancelled_at    = now(),
         cancel_reason   = p_reason,
         reserved_qty    = 0
   where id = p_return_id;
  return r.reserved_qty;
end;
$$;

revoke execute on function public.reserve_vendor_return(uuid, numeric, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.depart_vendor_return(uuid, text, timestamptz, text, uuid) from public, anon, authenticated;
revoke execute on function public.release_vendor_return(uuid, text, uuid) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
