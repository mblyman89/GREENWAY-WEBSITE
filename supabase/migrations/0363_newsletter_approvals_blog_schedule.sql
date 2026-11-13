-- ============================================================================
-- 0363 - NEWSLETTER APPROVALS + BLOG POST SCHEDULING  (D237, SOP-22 N-3, G-113)
--
-- WHY. A blog post set to "Scheduled" never published: blog_post was not a
-- schedule target (F-22-5). There was no Sunday cadence: no "ready for
-- approval" state, no approved send time, no reminder (F-22-9).
-- Owner, verbatim (D237): "I approve all from serious to small along with
-- your recommendations". Q-22-4 (a): "AI drafts by Thursday; you approve; it
-- sends automatically at a fixed Sunday time". The time is not named yet, so
-- it is a setting (site_settings key newsletter_cadence, no migration).
--
-- WHAT.
--   1. content_schedule may now hold target_kind 'blog_post' (publish and
--      unpublish). The same 5-minute cron (R46) runs it, audited.
--   2. public.newsletter_approvals: one row per newsletter post.
--        state ready     = someone marked it ready for approval;
--        state approved  = the owner or an admin approved it, with send_at;
--        state sending / sent = the cron sent it at send_at.
--      No row = draft. Editing an approved newsletter moves it back to ready.
--
-- RESET. post_id references blog_posts (KEEP) on delete cascade, so a kept
-- table only points at a kept table. KEEP in the factory reset core.
--
-- Service role only, RLS on. Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0363_newsletter_approvals_blog_schedule.rollback.sql
-- ============================================================================

-- 1. blog_post as a schedule target -----------------------------------------
alter table public.content_schedule drop constraint if exists content_schedule_kind_chk;
alter table public.content_schedule
  add constraint content_schedule_kind_chk
  check (target_kind in ('carousel_slide', 'shop_slide', 'page_section', 'faq_item', 'content_block', 'blog_post'));

-- 2. newsletter approvals ----------------------------------------------------
create table if not exists public.newsletter_approvals (
  post_id          uuid primary key references public.blog_posts(id) on delete cascade,
  state            text not null default 'ready',
  send_at          timestamptz,
  ready_by         uuid,
  ready_at         timestamptz,
  approved_by      uuid,
  approved_at      timestamptz,
  send_id          uuid,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint newsletter_approvals_state_chk check (state in ('ready', 'approved', 'sending', 'sent')),
  constraint newsletter_approvals_approved_chk check (state <> 'approved' or approved_at is not null),
  constraint newsletter_approvals_error_chk check (error is null or length(error) <= 500)
);

create index if not exists idx_newsletter_approvals_due
  on public.newsletter_approvals (send_at) where state = 'approved' and send_at is not null;

alter table public.newsletter_approvals enable row level security;
revoke all on table public.newsletter_approvals from public, anon, authenticated;
grant select, insert, update, delete on table public.newsletter_approvals to service_role;

comment on table public.newsletter_approvals is
  'D237 N-3 (0363): the Sunday newsletter states per newsletter post (ready, approved with send_at, sending, sent). No row = draft. The 5-minute content-schedule cron sends approved ones at send_at. Service role only.';

notify pgrst, 'reload schema';
