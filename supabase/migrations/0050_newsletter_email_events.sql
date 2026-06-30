-- =============================================================================
-- Migration 0050 — Newsletter email engagement events (Slice 50)
-- =============================================================================
-- Slice 50 adds a dedicated newsletter STATISTICS suite to the Customers report
-- tab: how many recipients opened, read, clicked, bounced (return-to-sender),
-- were rejected as spam, unsubscribed, etc.
--
-- Newsletters are delivered through Resend today; the architecture is built to
-- ALSO accept SendGrid so the owner can use either (or both) providers without
-- changing the stats layer. Each email provider posts engagement events to a
-- signature-verified webhook; we normalize every event into ONE provider-
-- agnostic table here. Per-campaign + aggregate stats are computed from this
-- table, correlated back to a specific send via newsletter_send_id (carried as
-- a provider "tag"/"custom_arg" on the outgoing message) plus recipient_email.
--
-- Idempotent — safe to re-run. Apply manually in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.newsletter_email_events (
  id                  uuid primary key default gen_random_uuid(),

  -- Which provider emitted the event. Provider-agnostic stats; both supported.
  provider            text not null,                 -- 'resend' | 'sendgrid'

  -- The provider's own unique id for THIS event. Used to dedup retries: a
  -- provider may deliver the same event more than once, and we must count it
  -- exactly once. Unique per provider.
  provider_event_id   text not null,

  -- The provider's message id (Resend email_id / SendGrid sg_message_id). Lets
  -- us group every event for a single delivered message.
  provider_message_id text,

  -- Correlation back to the campaign (newsletter_sends.id). Carried on the
  -- outgoing message as a Resend tag / SendGrid custom_arg, so it round-trips
  -- in the event. May be null for events we cannot correlate (legacy sends).
  newsletter_send_id  uuid references public.newsletter_sends(id) on delete set null,

  -- The recipient this event is about (lowercased). Always present.
  recipient_email     text not null,

  -- Normalized event type (provider-specific names mapped to these):
  --   sent | delivered | opened | clicked | bounced | complained
  --   | unsubscribed | delivery_delayed | failed | other
  event_type          text not null,

  -- When the event happened (provider timestamp), not when we stored it.
  occurred_at         timestamptz not null default now(),

  -- Bounce/return-to-sender detail. 'hard' = permanent (never retry),
  -- 'soft' = transient (provider retries). Null for non-bounce events.
  bounce_kind         text,                          -- 'hard' | 'soft' | null

  -- Human-readable reason / classification (bounce reason, drop reason, etc.).
  reason              text,

  -- For clicked events: the URL that was clicked.
  url                 text,

  -- Apple Mail Privacy Protection (and similar) fire automated opens that are
  -- NOT a human reading the email. true => exclude from "real" open rates.
  machine_open        boolean not null default false,

  -- The raw provider payload for this event (audit + future-proofing).
  raw                 jsonb,

  created_at          timestamptz not null default now()
);

-- Dedup: one row per (provider, provider_event_id). Re-posted events upsert.
create unique index if not exists newsletter_email_events_provider_event_uq
  on public.newsletter_email_events (provider, provider_event_id);

-- Stats are grouped by campaign + type, and filtered by time.
create index if not exists newsletter_email_events_send_idx
  on public.newsletter_email_events (newsletter_send_id);
create index if not exists newsletter_email_events_type_idx
  on public.newsletter_email_events (event_type);
create index if not exists newsletter_email_events_occurred_idx
  on public.newsletter_email_events (occurred_at desc);
create index if not exists newsletter_email_events_recipient_idx
  on public.newsletter_email_events (recipient_email);

-- Constrain provider / event_type / bounce_kind to known values.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'newsletter_email_events_provider_chk'
  ) then
    alter table public.newsletter_email_events
      add constraint newsletter_email_events_provider_chk
      check (provider in ('resend', 'sendgrid'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'newsletter_email_events_type_chk'
  ) then
    alter table public.newsletter_email_events
      add constraint newsletter_email_events_type_chk
      check (event_type in (
        'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained',
        'unsubscribed', 'delivery_delayed', 'failed', 'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'newsletter_email_events_bounce_chk'
  ) then
    alter table public.newsletter_email_events
      add constraint newsletter_email_events_bounce_chk
      check (bounce_kind is null or bounce_kind in ('hard', 'soft'));
  end if;
end $$;

-- RLS: staff-only reads. Writes happen via the service-role webhook ingest
-- (which bypasses RLS), so no public/insert policy is needed.
alter table public.newsletter_email_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'newsletter_email_events'
      and policyname = 'newsletter_email_events_staff_read'
  ) then
    create policy newsletter_email_events_staff_read
      on public.newsletter_email_events
      for select
      using (public.is_staff());
  end if;
end $$;
