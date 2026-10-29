-- supabase/rollbacks/0321_inbound_sibling_dismiss.rollback.sql  (Fix Phase 3.3)
-- Restores the 0255 dismiss guard (same manifest # + vendor only) and drops
-- the sibling function. Nothing else is touched. Only if needed.
create or replace function public.dismiss_duplicate_manifest(
  p_dup uuid,
  p_keep uuid,
  p_actor uuid,
  p_reason text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_dup  public.inbound_manifests%rowtype;
  v_keep public.inbound_manifests%rowtype;
  v_lot_ids uuid[];
  v_lab_ids uuid[];
  v_bad int;
  v_lots int := 0;
  v_labs int := 0;
  v_drafts int := 0;
  v_docs int := 0;
  v_keep_docs int := 0;
  v_tf int := 0;
  v_inv boolean := false;
  v_key text;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'Duplicate of another manifest row (same email delivered twice).'), 500);
begin
  if p_dup is null or p_keep is null then
    raise exception 'DISMISS: both manifests are required' using errcode = 'P0001';
  end if;
  if p_dup = p_keep then
    raise exception 'DISMISS: a manifest cannot be a duplicate of itself' using errcode = 'P0001';
  end if;

  -- 1. lock both rows in a stable order
  perform 1 from public.inbound_manifests
   where id in (p_dup, p_keep) order by id for update;
  select * into v_dup  from public.inbound_manifests where id = p_dup;
  select * into v_keep from public.inbound_manifests where id = p_keep;
  if v_dup.id is null then
    raise exception 'DISMISS: that manifest no longer exists' using errcode = 'P0001';
  end if;
  if v_keep.id is null then
    raise exception 'DISMISS: the manifest to keep no longer exists' using errcode = 'P0001';
  end if;

  -- 2. guards
  if lower(coalesce(v_dup.status, '')) = 'dismissed' then
    raise exception 'DISMISS: this duplicate was already dismissed' using errcode = 'P0001';
  end if;
  if lower(coalesce(v_dup.status, '')) not in ('pending', 'in_transit', 'received', 'rejected') then
    raise exception 'DISMISS: this manifest was accepted - its stock is live, so it is a real receipt, not a duplicate row' using errcode = 'P0001';
  end if;
  if lower(coalesce(v_keep.status, '')) not in ('pending', 'in_transit', 'received', 'accepted', 'partially_accepted') then
    raise exception 'DISMISS: the manifest to keep must still be live (not rejected or dismissed)' using errcode = 'P0001';
  end if;
  if public.inbound_manifest_identity(v_dup.manifest_number, v_dup.vendor_label) is null
     or public.inbound_manifest_identity(v_dup.manifest_number, v_dup.vendor_label)
        is distinct from public.inbound_manifest_identity(v_keep.manifest_number, v_keep.vendor_label) then
    raise exception 'DISMISS: these two manifests are not the same transfer (manifest # and vendor differ)' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.vendor_manifest_payments where manifest_id = p_dup) then
    raise exception 'DISMISS: a vendor payment is recorded against this manifest - move or remove the payment first' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}') into v_lot_ids
    from public.inventory_lots where manifest_id = p_dup;
  select count(*) into v_bad from public.inventory_lots
   where id = any(v_lot_ids) and status not in ('quarantine', 'rejected');
  if v_bad > 0 then
    raise exception 'DISMISS: % line(s) on this manifest are already in stock - it is a real receipt, not a duplicate row', v_bad using errcode = 'P0001';
  end if;
  if exists (select 1 from public.inventory_adjustments where lot_id = any(v_lot_ids))
     or exists (select 1 from public.cycle_count_lines where lot_id = any(v_lot_ids))
     or exists (select 1 from public.vendor_returns where lot_id = any(v_lot_ids))
     or exists (select 1 from public.destruction_events where lot_id = any(v_lot_ids))
     or exists (select 1 from public.trade_sample_events where lot_id = any(v_lot_ids))
     or exists (select 1 from public.customer_returns where lot_id = any(v_lot_ids))
     or exists (select 1 from public.inventory_audit_lines where lot_id = any(v_lot_ids) or scanned_lot_id = any(v_lot_ids))
     or exists (select 1 from public.inventory_audit_postings where lot_id = any(v_lot_ids))
     or exists (select 1 from public.inventory_audit_history where lot_id = any(v_lot_ids)) then
    raise exception 'DISMISS: a line on this manifest already has inventory history - it cannot be removed as a duplicate' using errcode = 'P0001';
  end if;

  -- 3. carry facts to the kept row (fill-only-empty)
  if nullif(btrim(coalesce(v_keep.invoice_number_detected, '')), '') is null
     and nullif(btrim(coalesce(v_dup.invoice_number_detected, '')), '') is not null then
    update public.inbound_manifests
       set invoice_number_detected = v_dup.invoice_number_detected,
           invoice_number_source = v_dup.invoice_number_source
     where id = p_keep;
    v_inv := true;
  end if;
  if nullif(btrim(coalesce(v_keep.invoice_number_override, '')), '') is null
     and nullif(btrim(coalesce(v_dup.invoice_number_override, '')), '') is not null then
    update public.inbound_manifests set invoice_number_override = v_dup.invoice_number_override where id = p_keep;
    v_inv := true;
  end if;
  if v_keep.purchase_order_id is null and v_dup.purchase_order_id is not null then
    update public.inbound_manifests set purchase_order_id = v_dup.purchase_order_id where id = p_keep;
  end if;

  v_tf := (case when nullif(btrim(coalesce(v_keep.transporter_name, '')), '') is null and nullif(btrim(coalesce(v_dup.transporter_name, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.transporter_license, '')), '') is null and nullif(btrim(coalesce(v_dup.transporter_license, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.driver_name, '')), '') is null and nullif(btrim(coalesce(v_dup.driver_name, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.driver_license_number, '')), '') is null and nullif(btrim(coalesce(v_dup.driver_license_number, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.vehicle_description, '')), '') is null and nullif(btrim(coalesce(v_dup.vehicle_description, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.vehicle_plate, '')), '') is null and nullif(btrim(coalesce(v_dup.vehicle_plate, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.vehicle_vin, '')), '') is null and nullif(btrim(coalesce(v_dup.vehicle_vin, '')), '') is not null then 1 else 0 end)
        + (case when nullif(btrim(coalesce(v_keep.route_notes, '')), '') is null and nullif(btrim(coalesce(v_dup.route_notes, '')), '') is not null then 1 else 0 end)
        + (case when v_keep.departed_at is null and v_dup.departed_at is not null then 1 else 0 end)
        + (case when v_keep.eta_date is null and v_dup.eta_date is not null then 1 else 0 end);
  if v_tf > 0 then
    update public.inbound_manifests set
      transporter_name      = coalesce(nullif(btrim(coalesce(transporter_name, '')), ''), v_dup.transporter_name),
      transporter_license   = coalesce(nullif(btrim(coalesce(transporter_license, '')), ''), v_dup.transporter_license),
      driver_name           = coalesce(nullif(btrim(coalesce(driver_name, '')), ''), v_dup.driver_name),
      driver_license_number = coalesce(nullif(btrim(coalesce(driver_license_number, '')), ''), v_dup.driver_license_number),
      vehicle_description   = coalesce(nullif(btrim(coalesce(vehicle_description, '')), ''), v_dup.vehicle_description),
      vehicle_plate         = coalesce(nullif(btrim(coalesce(vehicle_plate, '')), ''), v_dup.vehicle_plate),
      vehicle_vin           = coalesce(nullif(btrim(coalesce(vehicle_vin, '')), ''), v_dup.vehicle_vin),
      route_notes           = coalesce(nullif(btrim(coalesce(route_notes, '')), ''), v_dup.route_notes),
      departed_at           = coalesce(departed_at, v_dup.departed_at),
      eta_date              = coalesce(eta_date, v_dup.eta_date)
     where id = p_keep;
  end if;

  -- 4. documents + email log
  select count(*) into v_keep_docs from public.manifest_documents where manifest_id = p_keep;
  if v_keep_docs = 0 then
    update public.manifest_documents set manifest_id = p_keep where manifest_id = p_dup;
    get diagnostics v_docs = row_count;
  end if;
  update public.inbound_email_log set manifest_id = p_keep where manifest_id = p_dup;

  -- 5. drafts, lots, orphan labs
  update public.catalog_product_drafts set status = 'dismissed'
   where status = 'draft' and (manifest_id = p_dup or lot_id = any(v_lot_ids));
  get diagnostics v_drafts = row_count;

  select coalesce(array_agg(distinct lab_result_id), '{}') into v_lab_ids
    from public.inventory_lots where id = any(v_lot_ids) and lab_result_id is not null;
  delete from public.inventory_lots where id = any(v_lot_ids);
  get diagnostics v_lots = row_count;
  delete from public.lab_results l
   where l.id = any(v_lab_ids)
     and l.coa_storage_path is null
     and not exists (select 1 from public.inventory_lots x where x.lab_result_id = l.id)
     and not exists (select 1 from public.catalog_product_drafts d where d.lab_result_id = l.id);
  get diagnostics v_labs = row_count;

  -- 6. dismiss + hand over the dedupe key
  v_key := v_dup.dedupe_key;
  update public.inbound_manifests set
    status = 'dismissed',
    dismissed_at = now(),
    dismissed_reason = v_reason,
    duplicate_of = p_keep,
    dedupe_key = null,
    updated_by = p_actor
   where id = p_dup;
  if v_key is not null and v_keep.dedupe_key is null then
    update public.inbound_manifests set dedupe_key = v_key where id = p_keep;
  end if;
  update public.inbound_manifests set updated_by = p_actor where id = p_keep;

  -- 7. audit trail on both
  insert into public.manifest_events (manifest_id, event_type, note, actor_id) values
    (p_dup, 'dismissed_duplicate',
     left(format('Dismissed as a duplicate of manifest %s (%s). %s line(s) removed - never received, nothing reached Inventory, nothing filed with CCRS.',
       p_keep, v_reason, v_lots), 1000), p_actor),
    (p_keep, 'duplicate_merged',
     left(format('A duplicate row of this manifest (%s) was dismissed. Carried here: invoice # %s, %s document(s), %s transport field(s).',
       p_dup, case when v_inv then 'yes' else 'no' end, v_docs, v_tf), 1000), p_actor);

  return jsonb_build_object(
    'ok', true,
    'lots_removed', v_lots,
    'labs_removed', v_labs,
    'drafts_dismissed', v_drafts,
    'docs_moved', v_docs,
    'invoice_carried', v_inv,
    'transport_fields_carried', v_tf
  );
end;
$$;

revoke all on function public.dismiss_duplicate_manifest(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dismiss_duplicate_manifest(uuid, uuid, uuid, text) to service_role;
drop function if exists public.inbound_manifest_sibling(uuid, uuid);
