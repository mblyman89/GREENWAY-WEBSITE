-- =============================================================================
-- Migration 0016 — Newsletter send history (Slice 7: Newsletter Send Center)
-- =============================================================================
-- The hybrid newsletter workflow: staff design the newsletter in Canva, upload
-- the PDF (existing blog_posts/newsletter_assets flow), then use the Send Center
-- to email a branded announcement to the loyalty list via Resend.
--
-- This table is the durable RECORD of each send (campaign): which newsletter,
-- how many recipients, test vs. real, status, who sent it, and when. It powers
-- the "already sent on …" guard + the history table in the admin UI.
--
-- Idempotent — safe to re-run. Apply manually in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.newsletter_sends (
  id                uuid primary key default gen_random_uuid(),
  -- The newsletter being sent (a blog_posts row with kind = 'newsletter').
  post_id           uuid references public.blog_posts(id) on delete set null,
  -- Snapshot of the subject + the PDF url at send time (so history is stable
  -- even if the post is later edited or the asset moves).
  subject           text not null,
  pdf_url           text,
  -- 'test' = single-address preview; 'broadcast' = the full loyalty list.
  send_kind         text not null default 'broadcast',
  -- Outcome.
  status            text not null default 'queued',   -- queued | sent | partial | failed
  recipient_count   integer not null default 0,
  delivered_count   integer not null default 0,
  failed_count      integer not null default 0,
  error_summary     text,
  -- Who pressed send.
  sent_by           uuid references public.staff_profiles(id) on delete set null,
  sent_by_email     text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists newsletter_sends_post_idx on public.newsletter_sends (post_id);
create index if not exists newsletter_sends_created_idx on public.newsletter_sends (created_at desc);

-- Constrain send_kind / status to known values.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'newsletter_sends_kind_chk'
  ) then
    alter table public.newsletter_sends
      add constraint newsletter_sends_kind_chk
      check (send_kind in ('test', 'broadcast'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'newsletter_sends_status_chk'
  ) then
    alter table public.newsletter_sends
      add constraint newsletter_sends_status_chk
      check (status in ('queued', 'sent', 'partial', 'failed'));
  end if;
end $$;

-- RLS: staff-only. No public read — this is an internal operations record.
alter table public.newsletter_sends enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'newsletter_sends'
      and policyname = 'newsletter_sends_staff_all'
  ) then
    create policy newsletter_sends_staff_all
      on public.newsletter_sends
      for all
      using (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;
