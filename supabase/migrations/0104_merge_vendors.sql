-- =============================================================================
-- 0104 — merge_vendors(): combine duplicate vendor cards into one (Task F)
-- =============================================================================
-- Many WA producer-processors hold MULTIPLE LCB licenses (a producer license
-- and a processor license), so the statewide import created 2–3 vendor cards
-- for what is really one business. This migration installs a single guarded
-- DB function that combines duplicate cards into one surviving card:
--
--   public.merge_vendors(survivor_id uuid, duplicate_ids uuid[]) returns jsonb
--
-- What it does, in order (all inside one transaction — all-or-nothing):
--   1. GUARDS — survivor must exist, duplicates must exist, survivor can't be
--      one of the duplicates, at most 4 duplicates per call (the owner's real
--      case is 1–2 duplicates, i.e. 2–3 cards total).
--   2. REPOINTS every table that references vendors(id) from the duplicates to
--      the survivor: vendor_aliases, brands, product_enrichments, kb_brands,
--      inbound_manifests, inventory_lots, vendor_returns, purchase_orders,
--      trade_sample_events, vendor_manifest_payments, kb_products, and
--      discovery_vendor_leads.matched_vendor_id.
--      (vendor_aliases' unique(source_system, source_name) does NOT include
--      vendor_id, so repointing rows can never violate it.)
--   3. REPOINTS entity-scoped rows keyed by text ids (entity_type='vendor'):
--      ai_suggestions (pending AI drafts), media_usages (logo/hero usage
--      records), seo_entries. audit_logs and ai_usage are deliberately LEFT
--      ALONE as history — their old ids still resolve because duplicates are
--      archived, never deleted.
--   4. GAP-FILLS the survivor from each duplicate (in the order given): only
--      fields that are currently EMPTY on the survivor are filled — curated
--      survivor data is NEVER overwritten (same philosophy as the vendor
--      importer's gapFillPatch). social_json is merged with survivor-wins.
--      is_active is OR'd, total_accepted_ytd_cents (minor units) is summed,
--      last_accepted_at takes the most recent, product_count is summed.
--   5. PRESERVES EVERY LICENSE NUMBER — the survivor keeps its own license (or
--      inherits the first duplicate's if it had none); every duplicate's
--      display name and license number are recorded as vendor_aliases
--      (source_system 'merge') AND appended to the survivor's Internal notes,
--      so no license is ever lost.
--   6. ARCHIVES the duplicates (status='archived', is_active=false, counts
--      zeroed, slug suffixed '-merged-<id8>' to keep slugs unique and
--      unambiguous, a "Merged into …" note stamped on Internal notes).
--      NOTHING IS DELETED — the duplicate rows remain for history/audit.
--   7. RECOMPUTES the survivor's brand_count from the brands table and returns
--      a jsonb summary with per-table repoint counts.
--
-- Idempotent: drops any prior signature then create-or-replaces. Re-running a
-- merge is harmless (repoints find zero rows; archive/notes checks avoid
-- double-suffixing slugs).
--
-- Apply MANUALLY in the Supabase SQL editor. Assumes migrations through 0103
-- are applied (uses columns from 0064, 0081, 0091, 0099, 0100).
-- =============================================================================

drop function if exists public.merge_vendors(uuid, uuid[]);

create or replace function public.merge_vendors(
  survivor_id   uuid,
  duplicate_ids uuid[]
)
returns jsonb
language plpgsql
as $$
declare
  survivor        public.vendors%rowtype;
  dup             public.vendors%rowtype;
  dup_id          uuid;
  dup_count       integer;
  counts          jsonb := '{}'::jsonb;
  n               integer;
  total           integer := 0;
  today           text := to_char(now(), 'YYYY-MM-DD');
  merge_note      text;
  new_brand_count integer;
begin
  -- ── 1. Guards ──────────────────────────────────────────────────────────────
  if survivor_id is null then
    raise exception 'merge_vendors: survivor_id is required';
  end if;
  if duplicate_ids is null or array_length(duplicate_ids, 1) is null then
    raise exception 'merge_vendors: at least one duplicate vendor id is required';
  end if;
  if survivor_id = any(duplicate_ids) then
    raise exception 'merge_vendors: the surviving vendor cannot also be listed as a duplicate';
  end if;

  duplicate_ids := (select array_agg(distinct d) from unnest(duplicate_ids) as d where d is not null);
  dup_count := coalesce(array_length(duplicate_ids, 1), 0);
  if dup_count = 0 then
    raise exception 'merge_vendors: at least one duplicate vendor id is required';
  end if;
  if dup_count > 4 then
    raise exception 'merge_vendors: merge at most 4 duplicates per call (got %)', dup_count;
  end if;

  select * into survivor from public.vendors where id = survivor_id;
  if not found then
    raise exception 'merge_vendors: surviving vendor % not found', survivor_id;
  end if;

  foreach dup_id in array duplicate_ids loop
    if not exists (select 1 from public.vendors where id = dup_id) then
      raise exception 'merge_vendors: duplicate vendor % not found', dup_id;
    end if;
  end loop;

  -- ── 2. Repoint every vendor_id foreign key from duplicates → survivor ──────
  update public.vendor_aliases set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_aliases', n); total := total + n;

  update public.brands set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('brands', n); total := total + n;

  update public.product_enrichments set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('product_enrichments', n); total := total + n;

  update public.kb_brands set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('kb_brands', n); total := total + n;

  update public.inbound_manifests set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_manifests', n); total := total + n;

  update public.inventory_lots set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_lots', n); total := total + n;

  update public.vendor_returns set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_returns', n); total := total + n;

  update public.purchase_orders set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_orders', n); total := total + n;

  update public.trade_sample_events set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('trade_sample_events', n); total := total + n;

  update public.vendor_manifest_payments set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_manifest_payments', n); total := total + n;

  update public.kb_products set vendor_id = survivor_id where vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('kb_products', n); total := total + n;

  update public.discovery_vendor_leads set matched_vendor_id = survivor_id where matched_vendor_id = any(duplicate_ids);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_vendor_leads', n); total := total + n;

  -- ── 3. Repoint entity-scoped rows keyed by text ids (entity_type='vendor') ─
  -- audit_logs and ai_usage stay untouched as history: duplicates are archived,
  -- not deleted, so their ids still resolve.
  update public.ai_suggestions set entity_id = survivor_id::text
    where entity_type = 'vendor'
      and entity_id in (select (d)::text from unnest(duplicate_ids) as d);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_suggestions', n); total := total + n;

  update public.media_usages set entity_id = survivor_id::text
    where entity_type = 'vendor'
      and entity_id in (select (d)::text from unnest(duplicate_ids) as d);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_usages', n); total := total + n;

  update public.seo_entries set entity_id = survivor_id::text
    where entity_type = 'vendor'
      and entity_id in (select (d)::text from unnest(duplicate_ids) as d);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('seo_entries', n); total := total + n;

  -- ── 4–6. Per-duplicate: gap-fill survivor, preserve licenses, archive dup ──
  foreach dup_id in array duplicate_ids loop
    select * into dup from public.vendors where id = dup_id;

    merge_note := format(
      'Merged in "%s"%s on %s. Its brands, products, purchase orders, manifests, and drafts now live on this card; the old card was archived (nothing deleted).',
      dup.display_name,
      case when nullif(dup.license_number, '') is not null
           then format(' (license %s)', dup.license_number) else '' end,
      today
    );

    -- Gap-fill: only fields EMPTY on the survivor are filled — curated data is
    -- never overwritten. All s.* references read the survivor's current values
    -- (already including fills from earlier duplicates in this loop).
    update public.vendors s set
      legal_name          = coalesce(nullif(s.legal_name, ''),          nullif(dup.legal_name, '')),
      license_number      = coalesce(nullif(s.license_number, ''),      nullif(dup.license_number, '')),
      mission_statement   = coalesce(nullif(s.mission_statement, ''),   nullif(dup.mission_statement, '')),
      about               = coalesce(nullif(s.about, ''),               nullif(dup.about, '')),
      product_philosophy  = coalesce(nullif(s.product_philosophy, ''),  nullif(dup.product_philosophy, '')),
      website             = coalesce(nullif(s.website, ''),             nullif(dup.website, '')),
      email               = coalesce(nullif(s.email, ''),               nullif(dup.email, '')),
      phone               = coalesce(nullif(s.phone, ''),               nullif(dup.phone, '')),
      vendor_day_notes    = coalesce(nullif(s.vendor_day_notes, ''),    nullif(dup.vendor_day_notes, '')),
      vendor_number       = coalesce(nullif(s.vendor_number, ''),       nullif(dup.vendor_number, '')),
      dba                 = coalesce(nullif(s.dba, ''),                 nullif(dup.dba, '')),
      external_id         = coalesce(nullif(s.external_id, ''),         nullif(dup.external_id, '')),
      shipping_address1   = coalesce(nullif(s.shipping_address1, ''),   nullif(dup.shipping_address1, '')),
      shipping_address2   = coalesce(nullif(s.shipping_address2, ''),   nullif(dup.shipping_address2, '')),
      shipping_city       = coalesce(nullif(s.shipping_city, ''),       nullif(dup.shipping_city, '')),
      shipping_state      = coalesce(nullif(s.shipping_state, ''),      nullif(dup.shipping_state, '')),
      shipping_zip        = coalesce(nullif(s.shipping_zip, ''),        nullif(dup.shipping_zip, '')),
      billing_address1    = coalesce(nullif(s.billing_address1, ''),    nullif(dup.billing_address1, '')),
      billing_address2    = coalesce(nullif(s.billing_address2, ''),    nullif(dup.billing_address2, '')),
      billing_city        = coalesce(nullif(s.billing_city, ''),        nullif(dup.billing_city, '')),
      billing_state       = coalesce(nullif(s.billing_state, ''),       nullif(dup.billing_state, '')),
      billing_zip         = coalesce(nullif(s.billing_zip, ''),         nullif(dup.billing_zip, '')),
      billing_same_as_shipping = coalesce(s.billing_same_as_shipping, dup.billing_same_as_shipping),
      sage_vendor_id      = coalesce(nullif(s.sage_vendor_id, ''),      nullif(dup.sage_vendor_id, '')),
      logo_media_id       = coalesce(s.logo_media_id, dup.logo_media_id),
      hero_media_id       = coalesce(s.hero_media_id, dup.hero_media_id),
      usual_transport     = coalesce(s.usual_transport, dup.usual_transport),
      usual_transport_updated_at = case when s.usual_transport is null
                                        then dup.usual_transport_updated_at
                                        else s.usual_transport_updated_at end,
      -- Merge social links; the survivor's existing entries always win.
      social_json         = coalesce(dup.social_json, '{}'::jsonb) || coalesce(s.social_json, '{}'::jsonb),
      -- Aggregates.
      is_active           = case when s.is_active is null and dup.is_active is null then null
                                 else (coalesce(s.is_active, false) or coalesce(dup.is_active, false)) end,
      total_accepted_ytd_cents = case
                                   when s.total_accepted_ytd_cents is null and dup.total_accepted_ytd_cents is null then null
                                   else coalesce(s.total_accepted_ytd_cents, 0) + coalesce(dup.total_accepted_ytd_cents, 0)
                                 end,
      last_accepted_at    = greatest(s.last_accepted_at, dup.last_accepted_at),
      product_count       = s.product_count + coalesce(dup.product_count, 0),
      -- Provenance: stamp the merge on Internal notes (dup's own notes stay
      -- readable on its archived card — we never mash notes together).
      internal_notes      = case when nullif(s.internal_notes, '') is null then merge_note
                                 else s.internal_notes || E'\n' || merge_note end
    where s.id = survivor_id;

    -- Preserve the duplicate's identity as aliases on the survivor so imports
    -- and lookups by the old name/license keep resolving. unique(source_system,
    -- source_name) makes this idempotent.
    insert into public.vendor_aliases (vendor_id, source_name, source_system)
    values (survivor_id, dup.display_name, 'merge')
    on conflict (source_system, source_name) do nothing;

    if nullif(dup.license_number, '') is not null then
      insert into public.vendor_aliases (vendor_id, source_name, source_system)
      values (survivor_id, 'license:' || dup.license_number, 'merge')
      on conflict (source_system, source_name) do nothing;
    end if;

    -- Archive the duplicate — soft, reversible, nothing deleted. Slug gets a
    -- '-merged-<id8>' suffix so it can never collide with a future vendor.
    update public.vendors set
      status         = 'archived',
      is_active      = false,
      product_count  = 0,
      brand_count    = 0,
      slug           = case when slug like '%-merged-%' then slug
                            else slug || '-merged-' || left(dup_id::text, 8) end,
      internal_notes = case when nullif(internal_notes, '') is null
                            then format('Merged into "%s" (%s) on %s.', survivor.display_name, survivor_id, today)
                            else internal_notes || E'\n' ||
                                 format('Merged into "%s" (%s) on %s.', survivor.display_name, survivor_id, today) end
    where id = dup_id;
  end loop;

  -- ── 7. Recompute the survivor's brand_count from reality ───────────────────
  select count(*) into new_brand_count from public.brands where vendor_id = survivor_id;
  update public.vendors set brand_count = new_brand_count where id = survivor_id;

  return jsonb_build_object(
    'ok', true,
    'merged_at', now(),
    'survivor_id', survivor_id,
    'duplicate_ids', to_jsonb(duplicate_ids),
    'tables', counts,
    'total_rows_repointed', total
  );
end;
$$;

comment on function public.merge_vendors(uuid, uuid[]) is
  '0104 (Task F): combine duplicate vendor cards (producer-processors with multiple LCB licenses) into one surviving card. Repoints all vendor_id FKs + entity-scoped rows, gap-fills only EMPTY survivor fields (never overwrites curated data), preserves every license as vendor_aliases + Internal notes, then ARCHIVES the duplicates (never deletes). Returns jsonb per-table counts.';
