-- scripts/recon/kb-crawl-campaigns-0351-pg-check.sql  (D220 - migration 0351)
--
-- Scenario check for 0351_kb_crawl_campaigns.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0351 applies twice (idempotent);
--   * a campaign -> site -> pages / images chain inserts; one row per (site, url) for pages and images;
--   * CHECKs refuse a bad status / role / score / non-http url;
--   * an image can point at a kb_products row (match) and the match clears when the product is deleted;
--   * deleting a campaign cascades its sites, pages and images;
--   * a website candidate is unique per (vendor, host);
--   * anon / authenticated have no access; service_role has CRUD; RLS is on;
--   * tier caps accept 120 and refuse 121;
--   * the rollback drops everything and restores the 1..50 caps; 0351 applies again after it.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/kb-crawl-campaigns-0351-pg-check.sql
--
-- "KB CRAWL CAMPAIGNS 0351 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0351_kb_crawl_campaigns.sql
\i supabase/migrations/0351_kb_crawl_campaigns.sql

do $$
declare
  v uuid; c uuid; s uuid; p uuid; ok boolean;
begin
  insert into public.vendors (display_name, slug) values ('__0351 Vendor', '__0351-v') returning id into v;
  insert into public.kb_crawl_campaigns (label, scope) values ('t', 'current_vendors') returning id into c;
  insert into public.kb_crawl_sites (campaign_id, entity_type, entity_id, vendor_id, entry_url, host)
    values (c, 'vendor', v, v, 'https://example.com/', 'example.com') returning id into s;
  insert into public.kb_crawl_pages (site_id, campaign_id, vendor_id, url, page_type, product_names)
    values (s, c, v, 'https://example.com/p/1', 'product', array['GG4 Rosin']);
  -- upsert on (site_id, url)
  insert into public.kb_crawl_pages (site_id, campaign_id, url, page_type)
    values (s, c, 'https://example.com/p/1', 'product')
    on conflict (site_id, url) do update set title = 'again';
  assert (select count(*) from public.kb_crawl_pages where site_id = s) = 1, 'one page row per url';

  insert into public.kb_products (brand_slug, product_slug, variant_label, display_name, status)
    values ('__0351', 'gg4-rosin', '', 'GG4 Rosin', 'draft') returning id into p;
  insert into public.kb_crawl_images (site_id, campaign_id, vendor_id, page_url, image_url, role,
                                      product_name, tags, matched_kb_product_id, match_score, match_status)
    values (s, c, v, 'https://example.com/p/1', 'https://example.com/i/gg4.jpg', 'packaging',
            'GG4 Rosin', array['rosin','jar'], p, 0.91, 'suggested');
  begin
    insert into public.kb_crawl_images (site_id, campaign_id, page_url, image_url)
      values (s, c, 'https://example.com/p/1', 'https://example.com/i/gg4.jpg');
    raise exception 'duplicate image allowed';
  exception when unique_violation then null;
  end;

  ok := false;
  begin
    insert into public.kb_crawl_images (site_id, campaign_id, page_url, image_url, role)
      values (s, c, 'x', 'https://example.com/i/2.jpg', 'selfie');
  exception when check_violation then ok := true;
  end;
  assert ok, 'bad role refused';
  ok := false;
  begin
    insert into public.kb_crawl_images (site_id, campaign_id, page_url, image_url, match_score)
      values (s, c, 'x', 'https://example.com/i/3.jpg', 1.5);
  exception when check_violation then ok := true;
  end;
  assert ok, 'score > 1 refused';
  ok := false;
  begin
    insert into public.kb_crawl_sites (campaign_id, entity_id, entry_url) values (c, v, 'javascript:alert(1)');
  exception when check_violation then ok := true;
  end;
  assert ok, 'non-http entry url refused';
  ok := false;
  begin
    update public.kb_crawl_campaigns set status = 'bogus' where id = c;
  exception when check_violation then ok := true;
  end;
  assert ok, 'bad campaign status refused';

  delete from public.kb_products where id = p;
  assert (select matched_kb_product_id from public.kb_crawl_images where site_id = s and role = 'packaging') is null,
    'deleting the product clears the match';

  insert into public.vendor_website_candidates (vendor_id, url, host, confidence)
    values (v, 'https://example.com/', 'example.com', 0.8);
  ok := false;
  begin
    insert into public.vendor_website_candidates (vendor_id, url, host) values (v, 'https://example.com/x', 'example.com');
  exception when unique_violation then ok := true;
  end;
  assert ok, 'one candidate per vendor+host';

  delete from public.kb_crawl_campaigns where id = c;
  assert not exists (select 1 from public.kb_crawl_sites where campaign_id = c), 'sites cascade';
  assert not exists (select 1 from public.kb_crawl_pages where campaign_id = c), 'pages cascade';
  assert not exists (select 1 from public.kb_crawl_images where campaign_id = c), 'images cascade';

  -- privileges
  assert not has_table_privilege('anon', 'public.kb_crawl_images', 'select'), 'anon cannot read images';
  assert not has_table_privilege('authenticated', 'public.kb_crawl_pages', 'select'), 'authenticated cannot read pages';
  assert not has_table_privilege('anon', 'public.vendor_website_candidates', 'select'), 'anon cannot read candidates';
  assert has_table_privilege('service_role', 'public.kb_crawl_sites', 'update'), 'service_role updates sites';
  assert has_table_privilege('service_role', 'public.kb_crawl_campaigns', 'insert'), 'service_role inserts campaigns';
  assert (select bool_and(relrowsecurity) from pg_class
          where oid in ('public.kb_crawl_campaigns'::regclass, 'public.kb_crawl_sites'::regclass,
                        'public.kb_crawl_pages'::regclass, 'public.kb_crawl_images'::regclass,
                        'public.vendor_website_candidates'::regclass)), 'RLS on everywhere';

  -- tier caps
  update public.kb_harvest_settings set tier1_max_pages = 120 where id = 1;
  ok := false;
  begin
    update public.kb_harvest_settings set tier1_max_pages = 121 where id = 1;
  exception when check_violation then ok := true;
  end;
  assert ok, 'tier cap 121 refused';
  update public.kb_harvest_settings set tier1_max_pages = 80 where id = 1;
end
$$;

\i supabase/rollbacks/0351_kb_crawl_campaigns.rollback.sql
do $$
begin
  assert to_regclass('public.kb_crawl_images') is null, 'rollback drops kb_crawl_images';
  assert to_regclass('public.vendor_website_candidates') is null, 'rollback drops candidates';
  assert (select tier1_max_pages from public.kb_harvest_settings where id = 1) = 50, 'rollback clamps 80 -> 50';
end
$$;
\i supabase/migrations/0351_kb_crawl_campaigns.sql
do $$
begin
  assert to_regclass('public.kb_crawl_campaigns') is not null, 're-apply after rollback';
  raise notice 'KB CRAWL CAMPAIGNS 0351 CHECK PASSED';
end
$$;

rollback;
