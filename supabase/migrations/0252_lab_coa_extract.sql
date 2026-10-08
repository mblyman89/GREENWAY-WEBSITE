-- ===========================================================================
-- 0252_lab_coa_extract.sql
--
-- R28 (owner-requested). THE LAB CERTIFICATE FILLS THE PRODUCT FACTS.
--
-- Owner request (verbatim in the PR, paraphrased here): extract the lab
-- certificate data and use it to fill the facts the transfer JSON text does
-- not give, so only the rare product the parser cannot read is filled by hand.
--
-- Every WCIA transfer item carries TWO lab links (verified with curl on the
-- owner transfer, 17 of 17 items):
--   lab_result_link      the lab certificate as JSON (application/json):
--                        every cannabinoid, every terpene, the sample id
--   lab_result_data.coa  the certificate PDF (application/pdf): the same
--                        numbers PLUS the serving weight and mg per serving
-- Before R28 only the PDF link was stored (lab_results.coa_url) and neither
-- document was ever READ. R28 reads both (src/lib/inventory/coa-extract.ts),
-- cross-checks them, and stores the result here. Staging derives edible
-- serving facts from it (src/lib/inventory/coa-facts-core.ts).
--
-- 1. lab_results gains:
--      wcia_json_url       the lab_result_link (https only)
--      coa_extract_json    the stored read: both documents parsed, the
--                          identity checks and the JSON-vs-PDF agreement
--      coa_extract_status  ok / partial / failed (null = never read)
--      coa_extracted_at    when it was read
-- 2. BACKFILL wcia_json_url for lab rows received before R28, from the
--    original transfer kept on inbound_manifests.raw_payload. A lab row is
--    matched to its transfer item by the delivery (inventory_lots.manifest_id
--    of a lot pointing at the lab row) AND the lab result id. Filled ONLY when
--    exactly one distinct https link is found and it is not a PDF. Nothing is
--    fetched or computed in SQL.
--
-- Additive and idempotent: add column if not exists, constraints dropped and
-- re-added, the backfill only fills NULLs. The app is no-op safe when this
-- migration has not been applied (42703 / PGRST204 fall back to the R27 path).
-- ===========================================================================

alter table public.lab_results
  add column if not exists wcia_json_url text,
  add column if not exists coa_extract_json jsonb,
  add column if not exists coa_extract_status text,
  add column if not exists coa_extracted_at timestamptz;

alter table public.lab_results drop constraint if exists lab_results_coa_extract_status_check;
alter table public.lab_results
  add constraint lab_results_coa_extract_status_check
  check (coa_extract_status is null or coa_extract_status in ('ok', 'partial', 'failed'));

alter table public.lab_results drop constraint if exists lab_results_coa_extract_json_object_check;
alter table public.lab_results
  add constraint lab_results_coa_extract_json_object_check
  check (coa_extract_json is null or jsonb_typeof(coa_extract_json) = 'object');

-- A stored read always says how it went, and a status always has its read.
alter table public.lab_results drop constraint if exists lab_results_coa_extract_pair_check;
alter table public.lab_results
  add constraint lab_results_coa_extract_pair_check
  check ((coa_extract_json is null) = (coa_extract_status is null));

alter table public.lab_results drop constraint if exists lab_results_wcia_json_url_https_check;
alter table public.lab_results
  add constraint lab_results_wcia_json_url_https_check
  check (wcia_json_url is null or wcia_json_url ~* '^https://');

comment on column public.lab_results.wcia_json_url is
  'R28: the WCIA lab_result_link (the lab certificate as JSON). https only.';
comment on column public.lab_results.coa_extract_json is
  'R28: both certificate documents read and cross-checked (coa-facts-core CoaExtract, version 1).';
comment on column public.lab_results.coa_extract_status is
  'R28: ok = both read and they agree; partial = one read or a check failed; failed = nothing read. Null = never read.';
comment on column public.lab_results.coa_extracted_at is
  'R28: when the certificate was last read.';

-- 2. Backfill the JSON link from the stored transfers (fill-only).
with item_links as (
  select distinct
         r.id as lab_id,
         btrim(it.value ->> 'lab_result_link') as link
    from public.lab_results r
    join public.inventory_lots l on l.lab_result_id = r.id
    join public.inbound_manifests m on m.id = l.manifest_id
    cross join lateral jsonb_array_elements(
           case when jsonb_typeof(m.raw_payload) = 'object'
                 and jsonb_typeof(m.raw_payload -> 'inventory_transfer_items') = 'array'
                then m.raw_payload -> 'inventory_transfer_items'
                else '[]'::jsonb end) as it(value)
   where r.labtest_external_identifier is not null
     and jsonb_typeof(it.value) = 'object'
     and (it.value -> 'lab_result_data' ->> 'lab_result_id') = r.labtest_external_identifier
     -- a JSON number, object or array never renders as https text
     and btrim(it.value ->> 'lab_result_link') ~* '^https://'
     and btrim(it.value ->> 'lab_result_link') !~* '[.]pdf([?#]|$)'
),
single as (
  select lab_id, min(link) as link
    from item_links
   group by lab_id
  having count(distinct link) = 1
)
update public.lab_results r
   set wcia_json_url = s.link
  from single s
 where r.id = s.lab_id
   and r.wcia_json_url is null;
