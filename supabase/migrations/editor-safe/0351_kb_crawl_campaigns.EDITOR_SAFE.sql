create table if not exists public.kb_crawl_campaigns (
  id                uuid primary key default gen_random_uuid(),
  label             text not null default '',
  scope             text not null default 'custom',
  status            text not null default 'queued',
  cancel_requested  boolean not null default false,
  options           jsonb not null default '{}'::jsonb,
  totals            jsonb not null default '{}'::jsonb,
  ai_usage          jsonb not null default '{}'::jsonb,
  last_error        text,
  worker_heartbeat_at timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint kb_crawl_campaigns_status_chk
    check (status in ('queued', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  constraint kb_crawl_campaigns_scope_chk
    check (scope in ('current_vendors', 'all_vendors', 'custom', 'single')),
  constraint kb_crawl_campaigns_label_len check (char_length(label) <= 200)
);
create index if not exists kb_crawl_campaigns_status_idx
  on public.kb_crawl_campaigns (status, created_at desc);

create table if not exists public.kb_crawl_sites (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.kb_crawl_campaigns(id) on delete cascade,
  entity_type       text not null default 'vendor',
  entity_id         uuid not null,
  vendor_id         uuid references public.vendors(id) on delete set null,
  display_name      text not null default '',
  entry_url         text not null,
  host              text not null default '',
  status            text not null default 'queued',
  platform          text,
  frontier_pending  jsonb not null default '[]'::jsonb,
  frontier_visited  jsonb not null default '[]'::jsonb,
  pages_read        integer not null default 0,
  pages_failed      integer not null default 0,
  pages_pending     integer not null default 0,
  images_found      integer not null default 0,
  images_tagged     integer not null default 0,
  images_matched    integer not null default 0,
  products_found    integer not null default 0,
  drafts_written    integer not null default 0,
  products_written  integer not null default 0,
  slices            integer not null default 0,
  attempts          integer not null default 0,
  coverage_assessment text,
  stopped_reason    text,
  last_error        text,
  current_url       text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint kb_crawl_sites_status_chk
    check (status in ('queued', 'running', 'analyzing', 'complete', 'partial', 'failed', 'skipped', 'cancelled')),
  constraint kb_crawl_sites_entity_chk check (entity_type in ('vendor', 'brand')),
  constraint kb_crawl_sites_url_chk check (entry_url ~* '^https?://'),
  constraint kb_crawl_sites_counts_chk
    check (pages_read >= 0 and pages_failed >= 0 and pages_pending >= 0 and images_found >= 0
           and slices >= 0 and attempts >= 0)
);
create unique index if not exists kb_crawl_sites_campaign_entity_uq
  on public.kb_crawl_sites (campaign_id, entity_type, entity_id, host);
create index if not exists kb_crawl_sites_status_idx on public.kb_crawl_sites (campaign_id, status);
create index if not exists kb_crawl_sites_vendor_idx on public.kb_crawl_sites (vendor_id);

create table if not exists public.kb_crawl_pages (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.kb_crawl_sites(id) on delete cascade,
  campaign_id       uuid not null references public.kb_crawl_campaigns(id) on delete cascade,
  vendor_id         uuid references public.vendors(id) on delete set null,
  url               text not null,
  page_type         text not null default 'other',
  title             text,
  h1                text,
  text_excerpt      text,
  word_count        integer not null default 0,
  product_names     text[] not null default '{}',
  image_count       integer not null default 0,
  status_code       integer,
  from_cache        boolean not null default false,
  source            text not null default 'crawl',
  ai_facts          jsonb,
  content_hash      text,
  fetched_at        timestamptz not null default now(),
  constraint kb_crawl_pages_type_chk
    check (page_type in ('home', 'about', 'product', 'product_list', 'strain', 'contact', 'blog',
                         'faq', 'lab_results', 'where_to_buy', 'legal', 'careers', 'other')),
  constraint kb_crawl_pages_source_chk check (source in ('crawl', 'shopify', 'woocommerce', 'wordpress', 'sitemap')),
  constraint kb_crawl_pages_excerpt_len check (text_excerpt is null or char_length(text_excerpt) <= 6000)
);
create unique index if not exists kb_crawl_pages_site_url_uq on public.kb_crawl_pages (site_id, url);
create index if not exists kb_crawl_pages_vendor_type_idx on public.kb_crawl_pages (vendor_id, page_type);

create table if not exists public.kb_crawl_images (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.kb_crawl_sites(id) on delete cascade,
  campaign_id       uuid not null references public.kb_crawl_campaigns(id) on delete cascade,
  vendor_id         uuid references public.vendors(id) on delete set null,
  page_url          text not null,
  image_url         text not null,
  alt               text,
  caption           text,
  heading           text,
  nearby_text       text,
  jsonld_name       text,
  context           text,
  source            text not null default 'crawl',
  role              text not null default 'unknown',
  product_name      text,
  brand_name        text,
  strain_name       text,
  category          text,
  variant_label     text,
  packaging_text    text,
  tags              text[] not null default '{}',
  colors            text[] not null default '{}',
  role_confidence   numeric(3,2),
  vision_model      text,
  vision_at         timestamptz,
  matched_kb_product_id uuid references public.kb_products(id) on delete set null,
  match_score       numeric(4,3),
  match_reason      text,
  match_candidates  jsonb not null default '[]'::jsonb,
  match_status      text not null default 'unmatched',
  media_asset_id    uuid references public.media_assets(id) on delete set null,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  seen_count        integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint kb_crawl_images_role_chk
    check (role in ('product', 'packaging', 'flower_closeup', 'lifestyle', 'logo', 'banner', 'team',
                    'facility', 'lab_result', 'icon', 'other', 'unknown')),
  constraint kb_crawl_images_match_chk
    check (match_status in ('unmatched', 'suggested', 'confirmed', 'rejected')),
  constraint kb_crawl_images_source_chk check (source in ('crawl', 'shopify', 'woocommerce', 'jsonld')),
  constraint kb_crawl_images_score_chk check (match_score is null or (match_score >= 0 and match_score <= 1)),
  constraint kb_crawl_images_url_chk check (image_url ~* '^https?://')
);
create unique index if not exists kb_crawl_images_site_url_uq on public.kb_crawl_images (site_id, image_url);
create index if not exists kb_crawl_images_vendor_role_idx on public.kb_crawl_images (vendor_id, role);
create index if not exists kb_crawl_images_match_idx
  on public.kb_crawl_images (matched_kb_product_id) where matched_kb_product_id is not null;
create index if not exists kb_crawl_images_review_idx on public.kb_crawl_images (vendor_id, match_status);

create table if not exists public.vendor_website_candidates (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null references public.vendors(id) on delete cascade,
  url               text not null,
  host              text not null,
  source            text not null default 'openai_web_search',
  confidence        numeric(3,2) not null default 0,
  verify_status     text not null default 'unverified',
  evidence          jsonb not null default '{}'::jsonb,
  status            text not null default 'pending',
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vendor_website_candidates_source_chk
    check (source in ('openai_web_search', 'duckduckgo', 'brand', 'social', 'manual')),
  constraint vendor_website_candidates_verify_chk
    check (verify_status in ('unverified', 'verified', 'likely', 'mismatch', 'unreachable', 'marketplace')),
  constraint vendor_website_candidates_status_chk
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  constraint vendor_website_candidates_conf_chk check (confidence >= 0 and confidence <= 1),
  constraint vendor_website_candidates_url_chk check (url ~* '^https?://')
);
create unique index if not exists vendor_website_candidates_vendor_host_uq
  on public.vendor_website_candidates (vendor_id, host);
create index if not exists vendor_website_candidates_status_idx
  on public.vendor_website_candidates (status, confidence desc);

drop trigger if exists set_updated_at_kb_crawl_campaigns on public.kb_crawl_campaigns;
create trigger set_updated_at_kb_crawl_campaigns
  before update on public.kb_crawl_campaigns
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_kb_crawl_sites on public.kb_crawl_sites;
create trigger set_updated_at_kb_crawl_sites
  before update on public.kb_crawl_sites
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_kb_crawl_images on public.kb_crawl_images;
create trigger set_updated_at_kb_crawl_images
  before update on public.kb_crawl_images
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at_vendor_website_candidates on public.vendor_website_candidates;
create trigger set_updated_at_vendor_website_candidates
  before update on public.vendor_website_candidates
  for each row execute function public.set_updated_at();

alter table public.kb_crawl_campaigns enable row level security;
alter table public.kb_crawl_sites enable row level security;
alter table public.kb_crawl_pages enable row level security;
alter table public.kb_crawl_images enable row level security;
alter table public.vendor_website_candidates enable row level security;

revoke all on table public.kb_crawl_campaigns from public, anon, authenticated;
revoke all on table public.kb_crawl_sites from public, anon, authenticated;
revoke all on table public.kb_crawl_pages from public, anon, authenticated;
revoke all on table public.kb_crawl_images from public, anon, authenticated;
revoke all on table public.vendor_website_candidates from public, anon, authenticated;

grant select, insert, update, delete on table public.kb_crawl_campaigns to service_role;
grant select, insert, update, delete on table public.kb_crawl_sites to service_role;
grant select, insert, update, delete on table public.kb_crawl_pages to service_role;
grant select, insert, update, delete on table public.kb_crawl_images to service_role;
grant select, insert, update, delete on table public.vendor_website_candidates to service_role;

do $$begin
  if to_regclass('public.kb_harvest_settings') is not null then
    alter table public.kb_harvest_settings drop constraint if exists kb_hs_t1_range;
    alter table public.kb_harvest_settings drop constraint if exists kb_hs_t2_range;
    alter table public.kb_harvest_settings drop constraint if exists kb_hs_t3_range;
    alter table public.kb_harvest_settings
      add constraint kb_hs_t1_range check (tier1_max_pages >= 1 and tier1_max_pages <= 120);
    alter table public.kb_harvest_settings
      add constraint kb_hs_t2_range check (tier2_max_pages >= 1 and tier2_max_pages <= 120);
    alter table public.kb_harvest_settings
      add constraint kb_hs_t3_range check (tier3_max_pages >= 1 and tier3_max_pages <= 120);
  end if;
end
$$;
