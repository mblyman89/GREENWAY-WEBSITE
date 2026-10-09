-- ===========================================================================
-- 0255_inbound_dedupe.sql
--
-- R36 #2 (owner-requested). ONE EMAIL, ONE MANIFEST ROW.
--
-- Owner report (verbatim, abridged): "I emailed the vendor_intake@ address as
-- usual, I waited, then two identical rows appeared in the receiving table,
-- one broke, the other not ... give me a manual button to dismiss a
-- duplicate rather than rejecting it."
--
-- ROOT CAUSE (researched, sourced in docs/research + the R36 bible section):
--   * Resend delivers webhooks through Svix. Svix counts an attempt as FAILED
--     when no 2xx arrives within ~15 seconds, and retries on the schedule
--     "immediately, 5s, 5m, 30m, 2h, 5h, 10h, 10h"
--     (resend.com/docs/webhooks/retries-and-replays, docs.svix.com).
--   * Our inbound webhook ran LlamaParse on every PDF BEFORE answering, which
--     is well past 15 s. So the retry arrived while the first call was still
--     working, and the manifest dedupe was check-then-insert (not atomic):
--     both calls saw "no row yet" and both inserted.
--
-- WHAT THIS ADDS (no new table, nothing dropped)
--   inbound_email_log.delivery_key  text, UNIQUE when not null.
--        The provider's message identity ("resend:email:<email_id>", else
--        "svix:<svix-id>"). The webhook CLAIMS it with an insert before any
--        work; a second delivery of the same message hits the unique index
--        and is answered without staging anything: 200 "already received"
--        when the first delivery finished, 409 "still working" while it is
--        in flight (so Svix retries later instead of giving up), and a
--        delivery whose claim is older than 6 minutes (a crashed run; the
--        route's maxDuration is 300 s) may take the claim over.
--   inbound_email_log.claimed_at    timestamptz - when the claim was taken.
--   inbound_manifests.dedupe_key    text, UNIQUE when not null.
--        "<MANIFEST #>|<VENDOR>" (normalized exactly like
--        manifest-dedupe-core.buildManifestIdentity) while the row is LIVE.
--        Two concurrent stagings of the same manifest can no longer both
--        insert: the loser gets a unique violation and is treated as the
--        duplicate it is. Released (set null) when the row is rejected or
--        dismissed, so a corrected re-send can still stage.
--   inbound_manifests.dismissed_at / dismissed_reason / duplicate_of
--        The new "dismissed" status (a duplicate the owner dismissed - NOT a
--        rejection: nothing was refused at the dock and no lot was received).
--        duplicate_of points at the row that was kept.
--
-- WHAT IT NEVER DOES
--   * No backfill of dedupe_key: existing rows may already contain the
--     owner's duplicate pair, and a backfill would fail on the unique index.
--     Existing rows are still guarded by the app's read-then-check, which
--     is enough for non-concurrent re-sends; the key closes the race for
--     every NEW row.
--   * No status CHECK is added (inbound_manifests never had one; the app's
--     manifest-pipeline-core is the single list of stages).
--
-- IDEMPOTENT (standing rule 6): add-column-if-not-exists, create index if
-- not exists. Before it is applied the app behaves exactly as before: the
-- claim and the key are skipped on a narrow 42703 / PGRST204 "column does
-- not exist" answer (inbound-dedupe-core.isMissingColumnError).
-- APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0255_inbound_dedupe.rollback.sql
-- FACTORY RESET: no new table (inbound_email_log and inbound_manifests are
-- already WIPE; duplicate_of is a self-reference, ON DELETE SET NULL, and
-- inbound_manifests has no raising UPDATE trigger).
-- ===========================================================================

alter table public.inbound_email_log
  add column if not exists delivery_key text,
  add column if not exists claimed_at timestamptz;

create unique index if not exists inbound_email_log_delivery_key_uidx
  on public.inbound_email_log (delivery_key)
  where delivery_key is not null;

alter table public.inbound_manifests
  add column if not exists dedupe_key text,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_reason text,
  add column if not exists duplicate_of uuid references public.inbound_manifests(id) on delete set null;

create unique index if not exists inbound_manifests_dedupe_key_uidx
  on public.inbound_manifests (dedupe_key)
  where dedupe_key is not null;

create index if not exists inbound_manifests_duplicate_of_idx
  on public.inbound_manifests (duplicate_of)
  where duplicate_of is not null;

-- ---------------------------------------------------------------------------
-- DISMISS DUPLICATE (R36 #2) - one transaction, both rows locked.
--
-- The owner: "give me a manual button to dismiss a duplicate rather than
-- rejecting it ... I dont want clutter in [inventory] for erroneous products
-- from duplicate manifests ... it found the right one [invoice #], it just
-- gave it to the wrong duplicated manifest."
--
-- public.dismiss_duplicate_manifest(p_dup, p_keep, p_actor, p_reason) does,
-- atomically (any failure rolls ALL of it back):
--   1. locks both manifests (FOR UPDATE, in id order - no deadlock between
--      two people dismissing the same pair from opposite ends);
--   2. refuses unless: different rows; same transfer (normalized manifest #
--      + vendor, the app's buildManifestIdentity rule); the duplicate is
--      pending / in_transit / received / rejected (never accepted - live
--      stock is a real receipt); the kept row is live; no vendor payment is
--      recorded against the duplicate; and none of the duplicate's lots is
--      active / sold out or has ANY inventory history (adjustment, count,
--      audit, return, destruction, sample). A refusal raises with a
--      plain-English message and changes nothing;
--   3. carries to the KEPT row, fill-only-empty: the detected invoice # (+
--      source), the owner's invoice # correction, purchase order link, and
--      each transport field (arrived_at never - it is a dock fact);
--   4. moves the duplicate's archived documents to the kept row ONLY when
--      the kept row has none (no doubled downloads), and re-points the
--      inbound email log rows;
--   5. dismisses the duplicate's open onboarding drafts, deletes its never-
--      received lots (quarantine / refused - they never entered inventory, so
--      nothing is reported to CCRS and nothing reaches the Inventory page),
--      and deletes lab rows that ONLY those lots used and that hold no
--      archived certificate;
--   6. marks the duplicate status 'dismissed' (dismissed_at, reason,
--      duplicate_of), releases its dedupe_key and hands it to the kept row
--      when the kept row has none (so a later re-send is guarded);
--   7. writes a manifest_events row on BOTH manifests.
-- Returns jsonb counts the app turns into the banner. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.inbound_manifest_identity(p_number text, p_vendor text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(regexp_replace(coalesce(p_number, ''), '\s+', ' ', 'g')), '') is null then null
    else upper(btrim(regexp_replace(coalesce(p_number, ''), '\s+', ' ', 'g')))
         || '|' || upper(btrim(regexp_replace(coalesce(p_vendor, ''), '\s+', ' ', 'g')))
  end
$$;

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
revoke all on function public.inbound_manifest_identity(text, text) from public, anon, authenticated;
grant execute on function public.inbound_manifest_identity(text, text) to service_role;
