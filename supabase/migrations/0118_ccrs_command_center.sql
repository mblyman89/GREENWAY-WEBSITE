-- =============================================================================
-- 0118_ccrs_command_center.sql  (Task W)
--
-- CCRS COMPLIANCE REPORTING COMMAND CENTER: weekly submission ledger,
-- reminder send-log, and web-push subscriptions.
--
-- Owner: "I want the whole process of the weekly upload to be completely
-- hardened and bullet proof... push notifications if possible, email
-- reminders, bells and whistles even so there is no way we could ever miss
-- the upload deadlines."
--
-- Regulatory ground truth (docs/CCRS_COMMAND_CENTER_RESEARCH.md, verified
-- against the WSLCB CCRS FAQ + June 2025 Upload User Guide):
--   * CCRS reporting week = SUNDAY–SATURDAY; the report is due no later than
--     the FOLLOWING SUNDAY (week end + 1 day). WAC 314-55-083(4).
--   * CCRS is CSV-upload ONLY (no API) at cannabisreporting.lcb.wa.gov — so
--     the ledger records the human act of uploading, it cannot verify it.
--   * A week with NO new activity requires NO upload ("no change" reports do
--     not exist) — so a week may be resolved as 'nothing_to_report', which is
--     a first-class, logged resolution for audit defense.
--   * Errors come back BY EMAIL to the uploader; the ledger keeps an error
--     status + notes so a bounced file is never quietly forgotten.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) ccrs_week_submissions — ONE row per resolved Sun–Sat reporting week.
-- ---------------------------------------------------------------------------
create table if not exists public.ccrs_week_submissions (
  id               uuid primary key default gen_random_uuid(),
  -- Week key 'W-YYYY-MM-DD' (the week-start SUNDAY) — same convention as the
  -- S-18 compliance calendar and ccrs-week-core.ts.
  week_key         text not null unique,
  week_start       date not null,
  week_end         date not null,
  due_date         date not null,
  -- How the week was resolved.
  resolution       text not null check (resolution in ('submitted', 'nothing_to_report')),
  -- When the human says they completed the CCRS upload (or verified no-activity).
  resolved_at      timestamptz not null default now(),
  resolved_by      uuid references public.staff_profiles(id) on delete set null,
  resolved_by_email text,
  -- Whether the resolution happened on/before due_date (computed at write time
  -- so the audit story survives later date math changes).
  on_time          boolean not null default true,
  -- For 'submitted': which files went up (JSON summary from the generated
  -- batch: [{type, fileName, recordCount}, ...]) — drafts-only evidence trail.
  files_json       jsonb,
  total_records    integer not null default 0,
  -- Error tracking: CCRS notifies failures BY EMAIL after upload. 'clean' when
  -- no error email arrived; 'errors_reported' when one did; 'resolved' after
  -- the fix was re-uploaded.
  error_status     text not null default 'clean'
                   check (error_status in ('clean', 'errors_reported', 'resolved')),
  error_notes      text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_ccrs_week_submissions_week_start
  on public.ccrs_week_submissions(week_start desc);

drop trigger if exists trg_ccrs_week_submissions_updated on public.ccrs_week_submissions;
create trigger trg_ccrs_week_submissions_updated
  before update on public.ccrs_week_submissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) compliance_reminder_log — send-once dedupe for reminder emails/pushes.
--    A cron may run repeatedly; a dedupe_key can only ever be sent once.
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_reminder_log (
  id           uuid primary key default gen_random_uuid(),
  -- e.g. 'sunday_due:W-2026-01-11' or 'overdue_daily:W-2026-01-11:2026-01-19'
  dedupe_key   text not null unique,
  stage        text not null,
  week_key     text,
  channel      text not null default 'email' check (channel in ('email', 'push', 'email+push')),
  subject      text,
  sent_at      timestamptz not null default now(),
  recipients   text
);

create index if not exists idx_compliance_reminder_log_sent
  on public.compliance_reminder_log(sent_at desc);

-- ---------------------------------------------------------------------------
-- 3) push_subscriptions — Web Push (VAPID) endpoints per staff browser.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid references public.staff_profiles(id) on delete cascade,
  -- The PushSubscription endpoint URL is unique per browser registration.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_push_subscriptions_staff
  on public.push_subscriptions(staff_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ccrs_week_submissions enable row level security;
alter table public.compliance_reminder_log enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "ccrs_week_submissions staff read" on public.ccrs_week_submissions;
create policy "ccrs_week_submissions staff read" on public.ccrs_week_submissions
  for select using (public.is_staff());

drop policy if exists "ccrs_week_submissions admin write" on public.ccrs_week_submissions;
create policy "ccrs_week_submissions admin write" on public.ccrs_week_submissions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "compliance_reminder_log staff read" on public.compliance_reminder_log;
create policy "compliance_reminder_log staff read" on public.compliance_reminder_log
  for select using (public.is_staff());

drop policy if exists "compliance_reminder_log admin write" on public.compliance_reminder_log;
create policy "compliance_reminder_log admin write" on public.compliance_reminder_log
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "push_subscriptions self" on public.push_subscriptions;
create policy "push_subscriptions self" on public.push_subscriptions
  for all using (staff_id = auth.uid()) with check (staff_id = auth.uid());

drop policy if exists "push_subscriptions admin read" on public.push_subscriptions;
create policy "push_subscriptions admin read" on public.push_subscriptions
  for select using (public.is_admin());
