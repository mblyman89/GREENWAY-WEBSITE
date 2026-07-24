-- ============================================================================
-- 0137_regulatory_watch.sql  (SLICE 37)
--
-- Regulatory Watch — the future-compliance command center. Four tables:
--
--   * regulatory_sources       — the watch registry (LCB GovDelivery widget
--                                feed, Current/Recent Rulemaking Activity,
--                                enforcement bulletins, interim policies,
--                                policy statements). Seeded below. Tracks the
--                                last check + a content hash so the daily cron
--                                can detect page changes cheaply.
--   * regulatory_items         — one row per bulletin / notice / document that
--                                enters the funnel (cron poll of the widget
--                                JSON, forwarded LCB emails, or manual
--                                paste/URL on the page). Unique on
--                                (source_key, external_id) so cron re-runs and
--                                the email + poll overlap dedupe cleanly.
--   * regulatory_analyses      — the AI analyst's read of an item: plain-
--                                English summary, rulemaking stage, impact,
--                                affected compliance areas, deadlines,
--                                strategy, and proposed roadmap steps. Model
--                                id recorded for provenance. ADVISORY ONLY.
--   * regulatory_roadmap_items — the actionable task list. AI proposals the
--                                owner accepts become trackable tasks
--                                (proposed -> accepted -> in_progress ->
--                                done / dismissed).
--
-- Nothing here changes store behavior automatically (standing DRAFTS-ONLY
-- rule): analyses and roadmaps are advisory surfaces a human reviews.
--
-- APPLY MANUALLY in the Supabase SQL editor (standing owner rule).
-- ============================================================================

-- ── 1. Sources registry ─────────────────────────────────────────────────────
create table if not exists public.regulatory_sources (
  id             uuid primary key default gen_random_uuid(),
  -- Stable machine key ('govdelivery-widget', 'current-rulemaking', ...).
  source_key     text not null unique,
  label          text not null,
  url            text not null,
  -- 'feed' = machine-readable poll target; 'page' = HTML watched for changes;
  -- 'email' = arrives via the inbound funnel; 'manual' = paste/URL on the page.
  kind           text not null default 'page'
                   check (kind in ('feed', 'page', 'email', 'manual')),
  enabled        boolean not null default true,
  last_checked_at timestamptz,
  -- Hash of the last fetched content (change detection for 'page' sources).
  last_hash      text,
  notes          text,
  created_at     timestamptz not null default now()
);

comment on table public.regulatory_sources is
  'Regulatory Watch registry: the WA LCB publication channels the daily cron polls (SLICE 37). Seeded with the GovDelivery bulletin feed + the LCB rulemaking pages.';

-- ── 2. Items (the funnel) ───────────────────────────────────────────────────
create table if not exists public.regulatory_items (
  id             uuid primary key default gen_random_uuid(),
  source_key     text not null,
  -- Stable id within the source: GovDelivery bulletin id (e.g. 'WALCB-41ea476'),
  -- a URL, or an email Message-Id. Dedupe anchor.
  external_id    text not null,
  title          text not null,
  url            text,
  -- Where it came from: 'cron' | 'email' | 'manual'.
  ingested_via   text not null default 'manual'
                   check (ingested_via in ('cron', 'email', 'manual')),
  published_at   timestamptz,
  -- Full plain text of the bulletin/notice (what the AI reads).
  body_text      text,
  -- Deterministic extraction (regulatory-core.ts): citations, links, dates.
  -- Shape: { citations: [...], links: [...], dates: [...], stage: '...' }.
  extracted      jsonb not null default '{}'::jsonb,
  -- Triage state: new -> analyzed -> reviewed | archived.
  status         text not null default 'new'
                   check (status in ('new', 'analyzed', 'reviewed', 'archived')),
  created_at     timestamptz not null default now(),
  unique (source_key, external_id)
);

create index if not exists regulatory_items_status_idx
  on public.regulatory_items (status, published_at desc);

comment on table public.regulatory_items is
  'Every LCB bulletin/notice that enters the Regulatory Watch funnel (cron poll, forwarded email, or manual paste). Deterministic citation/date extraction lives in extracted; the AI read lives in regulatory_analyses (SLICE 37).';

-- ── 3. AI analyses (advisory only) ──────────────────────────────────────────
create table if not exists public.regulatory_analyses (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.regulatory_items(id) on delete cascade,
  -- Plain-English briefing for a non-lawyer owner.
  summary        text not null,
  -- Rulemaking stage the analyst identified:
  -- cr101 | cr102 | cr103 | cr103e | cr105 | petition | enforcement |
  -- policy | legislation | info | unknown.
  stage          text not null default 'unknown',
  -- none | low | medium | high | critical (critical = emergency rules /
  -- effective immediately / direct retailer obligations).
  impact         text not null default 'none'
                   check (impact in ('none', 'low', 'medium', 'high', 'critical')),
  -- Compliance-surface areas affected (keys from compliance-surface.ts).
  areas          jsonb not null default '[]'::jsonb,
  -- Deadlines the analyst confirmed: [{ kind, date, note }].
  deadlines      jsonb not null default '[]'::jsonb,
  -- What Greenway should do about it, in order (strings).
  strategy       jsonb not null default '[]'::jsonb,
  -- Proposed codebase roadmap steps: [{ title, detail, area }].
  roadmap        jsonb not null default '[]'::jsonb,
  -- Provenance: which model produced this read.
  model_id       text,
  created_at     timestamptz not null default now()
);

create index if not exists regulatory_analyses_item_idx
  on public.regulatory_analyses (item_id, created_at desc);

comment on table public.regulatory_analyses is
  'AI analyst briefings for Regulatory Watch items — summary, stage, impact, deadlines, strategy, proposed roadmap. ADVISORY ONLY; never changes store behavior (SLICE 37).';

-- ── 4. Roadmap tasks ────────────────────────────────────────────────────────
create table if not exists public.regulatory_roadmap_items (
  id             uuid primary key default gen_random_uuid(),
  -- The item that spawned the task (kept even if analysis is superseded).
  item_id        uuid references public.regulatory_items(id) on delete set null,
  title          text not null,
  detail         text,
  -- Compliance-surface area key (advertising, sales-limits, ccrs, ...).
  area           text,
  -- Rule's effective date, when known — drives the deadline timeline.
  due_at         timestamptz,
  status         text not null default 'proposed'
                   check (status in ('proposed', 'accepted', 'in_progress', 'done', 'dismissed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists regulatory_roadmap_status_idx
  on public.regulatory_roadmap_items (status, due_at);

comment on table public.regulatory_roadmap_items is
  'The Regulatory Watch task list: AI-proposed codebase/ops changes the owner accepts and tracks to done. This is the "strategy and roadmap" surface the owner hands back to the AI to build (SLICE 37).';

-- ── RLS (GW-019 discipline: every table gets RLS + explicit policies) ───────
-- Staff read everything (the page is gated behind reports.view in the app);
-- ALL writes go through server actions / the cron using the service role,
-- which bypasses RLS. No client-side writes.
alter table public.regulatory_sources enable row level security;
alter table public.regulatory_items enable row level security;
alter table public.regulatory_analyses enable row level security;
alter table public.regulatory_roadmap_items enable row level security;

drop policy if exists regulatory_sources_staff_read on public.regulatory_sources;
create policy regulatory_sources_staff_read on public.regulatory_sources
  for select using (public.is_staff());

drop policy if exists regulatory_items_staff_read on public.regulatory_items;
create policy regulatory_items_staff_read on public.regulatory_items
  for select using (public.is_staff());

drop policy if exists regulatory_analyses_staff_read on public.regulatory_analyses;
create policy regulatory_analyses_staff_read on public.regulatory_analyses
  for select using (public.is_staff());

drop policy if exists regulatory_roadmap_staff_read on public.regulatory_roadmap_items;
create policy regulatory_roadmap_staff_read on public.regulatory_roadmap_items
  for select using (public.is_staff());

-- ── Seed the watch registry (verified live during SLICE 37 research) ────────
insert into public.regulatory_sources (source_key, label, url, kind, notes) values
  ('govdelivery-widget',
   'LCB GovDelivery bulletins (feed)',
   'https://content.govdelivery.com/accounts/WALCB/widgets/WALCB_WIDGET_1/0.json',
   'feed',
   'Machine-readable list of the most recent LCB email bulletins (subject, date, link). The daily cron polls this — it catches every bulletin even without email forwarding.'),
  ('current-rulemaking',
   'Current Rulemaking Activity',
   'https://lcb.wa.gov/laws/current-rulemaking-activity',
   'page',
   'Per-project inventory of open LCB rulemaking (stage, WSR numbers, comment deadlines, documents).'),
  ('recent-rulemaking',
   'Recent Rulemaking Activity',
   'https://lcb.wa.gov/rules/recent-rulemaking-activity',
   'page',
   'Chronological board actions: CR-101/102/103 approvals, petitions granted/denied.'),
  ('enforcement-bulletins',
   'Enforcement Bulletins',
   'https://lcb.wa.gov/enforcement/enforcement_bulletins',
   'page',
   'Enforcement guidance to licensees (e.g. Bulletin 26-01 on minimum orders / volume discounts).'),
  ('interim-policies',
   'Board Interim Policies',
   'https://lcb.wa.gov/board/interim-policies',
   'page',
   'Board interim policies that apply before formal rules land.'),
  ('policy-statements',
   'Interpretive and Policy Statements',
   'https://lcb.wa.gov/laws/statements',
   'page',
   'How the LCB interprets existing rules — changes signal enforcement posture shifts.'),
  ('lcb-email',
   'Forwarded LCB bulletin emails',
   'mailto:rules@lcb.wa.gov',
   'email',
   'LCB GovDelivery emails forwarded to the inbound funnel (REGULATORY_MAILBOX). Comments on proposed rules go to rules@lcb.wa.gov.')
on conflict (source_key) do nothing;
