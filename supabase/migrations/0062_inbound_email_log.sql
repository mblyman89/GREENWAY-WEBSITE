-- 0062_inbound_email_log.sql  (Slice 99)
--
-- Inbound vendor_intake@ email audit trail. Every email delivered to our webhook
-- (Resend Inbound now; SendGrid Inbound Parse as a drop-in later) is recorded
-- here BEFORE any parsing, so the owner always has a tamper-evident record of
-- what arrived, from whom, and what we did with it. This is drafts-only support
-- infrastructure: a manifest that parses becomes a PENDING inbound_manifest that
-- a human validates in /admin/inventory/intake. Nothing here auto-commits stock.
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor.

create table if not exists public.inbound_email_log (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (provider in ('resend', 'sendgrid')),
  from_address   text,
  to_addresses   text[] not null default '{}',
  subject        text,
  received_at    timestamptz not null default now(),
  -- verification + routing outcome for the audit trail
  signature_ok   boolean,           -- null = not checked (no secret configured)
  to_intake      boolean not null default false,
  attachment_count integer not null default 0,
  -- what we did: 'ignored' (not intake), 'no_manifest', 'staged', 'parse_failed'
  disposition    text not null default 'received',
  -- link to the staged draft manifest when one was created (drafts-only)
  manifest_id    uuid references public.inbound_manifests(id) on delete set null,
  note           text,
  raw_headers    jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists inbound_email_log_received_idx
  on public.inbound_email_log (received_at desc);
create index if not exists inbound_email_log_manifest_idx
  on public.inbound_email_log (manifest_id);

alter table public.inbound_email_log enable row level security;

-- Staff may read the log (review queue surfacing). Writes happen via the
-- service-role webhook only, so no INSERT/UPDATE policy is granted to users.
drop policy if exists inbound_email_log_read on public.inbound_email_log;
create policy inbound_email_log_read
  on public.inbound_email_log
  for select
  using (auth.role() = 'authenticated');
