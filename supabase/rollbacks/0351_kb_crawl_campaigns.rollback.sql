-- Rollback for 0351_kb_crawl_campaigns.sql (D220).
-- Drops the crawl campaign / page / image catalog and the website candidates
-- (crawler reference data only — re-crawlable), and restores the 1..50 tier caps
-- (values above 50 are clamped to 50 first so the old constraint can be added).
-- Run MANUALLY only if needed.
drop table if exists public.kb_crawl_images;
drop table if exists public.kb_crawl_pages;
drop table if exists public.kb_crawl_sites;
drop table if exists public.kb_crawl_campaigns;
drop table if exists public.vendor_website_candidates;

do $$
begin
  if to_regclass('public.kb_harvest_settings') is not null then
    update public.kb_harvest_settings set
      tier1_max_pages = least(tier1_max_pages, 50),
      tier2_max_pages = least(tier2_max_pages, 50),
      tier3_max_pages = least(tier3_max_pages, 50);
    alter table public.kb_harvest_settings drop constraint if exists kb_hs_t1_range;
    alter table public.kb_harvest_settings drop constraint if exists kb_hs_t2_range;
    alter table public.kb_harvest_settings drop constraint if exists kb_hs_t3_range;
    alter table public.kb_harvest_settings
      add constraint kb_hs_t1_range check (tier1_max_pages >= 1 and tier1_max_pages <= 50);
    alter table public.kb_harvest_settings
      add constraint kb_hs_t2_range check (tier2_max_pages >= 1 and tier2_max_pages <= 50);
    alter table public.kb_harvest_settings
      add constraint kb_hs_t3_range check (tier3_max_pages >= 1 and tier3_max_pages <= 50);
  end if;
end
$$;
