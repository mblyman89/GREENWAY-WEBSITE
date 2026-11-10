-- D221 (M3+M4) post-apply scenario check for 0353_media_library_m3_m4.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario:
--   * a merged vendor card: a seller name that matches it resolves to the survivor;
--   * a Cultivera seller folder code used by one seller -> vendor;
--   * a code shared by two different sellers -> left alone (never guess);
--   * a long seller name tag (kebab, 40 chars) -> vendor;
--   * a "<Name> (harvested)" website logo whose name is a brand -> brand's vendor;
--   * a brand that lives under the placeholder vendor -> left alone;
--   * a picture that already has a vendor -> never overwritten;
--   * the run ledger lease columns exist and the health counters answer.
\set ON_ERROR_STOP on
begin;

insert into public.vendors (id, display_name, slug, license_number) values
  ('00000000-0000-4000-8000-0000000353a1', 'Survivor Farms', 'survivor-farms', '419001'),
  ('00000000-0000-4000-8000-0000000353a2', 'OLD FARMS - 419002', 'old-farms-merged', '419002'),
  ('00000000-0000-4000-8000-0000000353a3', 'Folder Seller Co', 'folder-seller-co', '419003'),
  ('00000000-0000-4000-8000-0000000353a4', 'Other Seller Co', 'other-seller-co', '419004'),
  ('00000000-0000-4000-8000-0000000353a5', 'Northwest Mega Holdings', 'northwest-mega-holdings', '419005'),
  ('00000000-0000-4000-8000-0000000353a6', 'Brand Owner LLC', 'brand-owner-llc', '419006'),
  ('00000000-0000-4000-8000-0000000353a7', 'INDEPENDENT / UNLISTED VENDOR', 'independent-unlisted-vendor', null)
on conflict do nothing;
update public.vendors set merged_into_id = '00000000-0000-4000-8000-0000000353a1'
 where id = '00000000-0000-4000-8000-0000000353a2';

insert into public.brands (id, display_name, slug, vendor_id) values
  ('00000000-0000-4000-8000-0000000353b1', 'Zappy Pops', 'zappy-pops', '00000000-0000-4000-8000-0000000353a6'),
  ('00000000-0000-4000-8000-0000000353b2', 'Lonely Brand', 'lonely-brand', '00000000-0000-4000-8000-0000000353a7');

insert into public.cultivera_menu_snapshots (id, vendor_id, cultivera_market_slug, seller_name) values
  ('00000000-0000-4000-8000-0000000353c1', null, 'old-farms', 'OLD FARMS - 419002'),
  ('00000000-0000-4000-8000-0000000353c2', null, 'folder-seller', 'Folder Seller Co'),
  ('00000000-0000-4000-8000-0000000353c3', null, 'other-seller', 'Other Seller Co'),
  ('00000000-0000-4000-8000-0000000353c4', '00000000-0000-4000-8000-0000000353a5', 'nw-mega',
   'Northwest Mega Holdings, Hard Hat Extracts, Candy Company and Friends');

insert into public.cultivera_menu_items (snapshot_id, name, image_url) values
  ('00000000-0000-4000-8000-0000000353c2', 'A', 'https://files.cultivera.com/435553542D57AAAA/ProductImages/1/a.png'),
  ('00000000-0000-4000-8000-0000000353c2', 'B', 'https://files.cultivera.com/435553542D57BBBB/ProductImages/1/b.png'),
  ('00000000-0000-4000-8000-0000000353c3', 'C', 'https://files.cultivera.com/435553542D57BBBB/ProductImages/1/c.png');

insert into public.media_assets (id, storage_key, filename, mime_type, tags, status, source, usage_type, title) values
  -- j: one-seller code
  ('00000000-0000-4000-8000-000000035301', 'product/1111111111111111-a.png', 'a.png', 'image/png',
   array['harvested','cultivera','product-image'], 'draft',
   'crawl:https://files.cultivera.com/435553542D57AAAA/ProductImages/9/zz.png', 'product', 'A'),
  -- j: shared code -> untouched
  ('00000000-0000-4000-8000-000000035302', 'product/2222222222222222-b.png', 'b.png', 'image/png',
   array['harvested','cultivera','product-image'], 'draft',
   'crawl:https://files.cultivera.com/435553542D57BBBB/ProductImages/9/yy.png', 'product', 'B'),
  -- k: long seller tag (vendorTag of the seller name, 40 chars)
  ('00000000-0000-4000-8000-000000035303', 'product/3333333333333333-c.png', 'c.png', 'image/png',
   array['harvested','cultivera','product-image', 'northwest-mega-holdings-hard-hat-extract'],
   'draft', 'crawl:https://files.cultivera.com/wam/ProductImage/01/c.png', 'product', 'C'),
  -- k: merged seller tag -> survivor
  ('00000000-0000-4000-8000-000000035304', 'product/4444444444444444-d.png', 'd.png', 'image/png',
   array['harvested','cultivera','product-image','old-farms-419002'], 'draft',
   'crawl:https://files.cultivera.com/wam/ProductImage/01/d.png', 'product', 'D'),
  -- l: website logo titled with a brand name
  ('00000000-0000-4000-8000-000000035305', 'vendor-logo/5555555555555555-e.png', 'e.png', 'image/png',
   array['harvested','vendor-logo'], 'draft',
   'crawl:https://images.squarespace-cdn.com/content/v1/x/e.png', 'vendor-logo', 'Zappy Pops (harvested)'),
  -- l: brand under the placeholder vendor -> untouched
  ('00000000-0000-4000-8000-000000035306', 'vendor-logo/6666666666666666-f.png', 'f.png', 'image/png',
   array['harvested','vendor-logo'], 'draft',
   'crawl:https://images.squarespace-cdn.com/content/v1/x/f.png', 'vendor-logo', 'Lonely Brand (harvested)'),
  -- never overwrite a vendor already set
  ('00000000-0000-4000-8000-000000035307', 'product/7777777777777777-g.png', 'g.png', 'image/png',
   array['harvested','cultivera','product-image'], 'draft',
   'crawl:https://files.cultivera.com/435553542D57AAAA/ProductImages/9/gg.png', 'product', 'G');
update public.media_assets set vendor_id = '00000000-0000-4000-8000-0000000353a4'
 where id = '00000000-0000-4000-8000-000000035307';

\ir ../../supabase/migrations/0353_media_library_m3_m4.sql

do $$
declare
  v uuid;
  h jsonb;
begin
  -- merge-following resolver
  if public.media_resolve_vendor('OLD FARMS - 419002', null) is distinct from '00000000-0000-4000-8000-0000000353a1' then
    raise exception 'resolver did not follow the merge (license)';
  end if;
  if public.media_resolve_vendor('old farms merged', null) is distinct from '00000000-0000-4000-8000-0000000353a1' then
    raise exception 'resolver did not follow the merge (slug)';
  end if;
  if public.media_vendor_tag('  Fine & Dandy!  ') <> 'fine-dandy' then raise exception 'vendor tag shape'; end if;
  if length(public.media_vendor_tag(repeat('a', 60))) <> 40 then raise exception 'vendor tag length'; end if;

  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035301';
  if v is distinct from '00000000-0000-4000-8000-0000000353a3' then raise exception 'seller code not resolved: %', v; end if;
  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035302';
  if v is not null then raise exception 'shared seller code guessed: %', v; end if;
  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035303';
  if v is distinct from '00000000-0000-4000-8000-0000000353a5' then raise exception 'long seller tag not resolved: %', v; end if;
  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035304';
  if v is distinct from '00000000-0000-4000-8000-0000000353a1' then raise exception 'merged seller tag not on survivor: %', v; end if;
  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035305';
  if v is distinct from '00000000-0000-4000-8000-0000000353a6' then raise exception 'harvested title not resolved via brand: %', v; end if;
  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035306';
  if v is not null then raise exception 'placeholder vendor was used: %', v; end if;
  select vendor_id into v from public.media_assets where id = '00000000-0000-4000-8000-000000035307';
  if v is distinct from '00000000-0000-4000-8000-0000000353a4' then raise exception 'an existing vendor was overwritten: %', v; end if;

  -- resolved vendor-sourced rows are auto-published (0352 rules), the others stay drafts
  if (select status::text from public.media_assets where id = '00000000-0000-4000-8000-000000035301') <> 'published' then
    raise exception 'resolved menu picture not auto-published';
  end if;
  if (select status::text from public.media_assets where id = '00000000-0000-4000-8000-000000035302') <> 'draft' then
    raise exception 'unresolved picture published';
  end if;
  if (select credit_text from public.media_assets where id = '00000000-0000-4000-8000-000000035301') is distinct from 'Folder Seller Co' then
    raise exception 'credit text not filled';
  end if;

  -- idempotent: a second run changes nothing
  h := public.media_backfill_vendor_links();
  if (h->>'seller_code')::int + (h->>'seller_tag')::int + (h->>'title')::int <> 0 then
    raise exception 'second run was not a no-op: %', h;
  end if;

  h := public.media_library_health();
  if not (h ? 'rejected' and h ? 'ai_failed' and h ? 'ai_spend_usd') then raise exception 'health keys: %', h; end if;

  -- the run ledger lease
  insert into public.media_ai_runs (kind, status, lease_token, lease_until, follow_new)
  values ('full', 'running', 'tok', now() + interval '5 minutes', true);
  if (select count(*) from public.media_ai_runs where lease_token = 'tok' and follow_new) <> 1 then
    raise exception 'lease columns';
  end if;
  if (select count(*) from information_schema.columns where table_name = 'media_assets' and column_name in ('reviewed_by', 'reviewed_at')) <> 2 then
    raise exception 'review columns';
  end if;
end $$;

-- service role only
do $$
begin
  if has_function_privilege('anon', 'public.media_backfill_vendor_links()', 'execute') then
    raise exception 'anon can run media_backfill_vendor_links';
  end if;
  if not has_function_privilege('service_role', 'public.media_backfill_vendor_links()', 'execute') then
    raise exception 'service_role cannot run media_backfill_vendor_links';
  end if;
end $$;

-- Rollback then re-apply, so both files are proven.
\ir ../../supabase/rollbacks/0353_media_library_m3_m4.rollback.sql
do $$
begin
  if to_regprocedure('public.media_backfill_vendor_links()') is not null then raise exception 'rollback left the function'; end if;
end $$;
\ir ../../supabase/migrations/0353_media_library_m3_m4.sql

\echo MEDIA LIBRARY M3 0353 CHECK PASSED
rollback;
