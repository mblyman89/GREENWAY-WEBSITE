-- ============================================================================
-- 0361 - MERCH ALERTS INBOX  (D232, SOP-11 M-7, G-85)
--
-- WHY. greenwaymerch.com's owner alerts ("Order gm-... needs you", "Printful
-- rejected order ...", "could NOT cancel the card hold") went only to the
-- MERCH_ORDER_ALERT_EMAIL inbox, and only to the Vercel logs if Resend was
-- not set up. There was no place in the back office to see them (F-11-9).
-- Owner, verbatim (D232): "I want to build all things, serious to not
-- serious. The big to the small."
--
-- WHAT. public.merch_alerts: one row per distinct alert. The shop POSTs each
-- alert to /api/merch-alerts (Bearer MERCH_CATALOG_TOKEN, the token both
-- projects already share). `fingerprint` is a SHA-256 of the subject and
-- lines, so a retried webhook does not make a second row: the app bumps
-- repeat_count and last_seen_at instead, and re-opens it if it had been
-- acknowledged. Merch Health and Orders show the open ones with an
-- Acknowledge button (who and when are kept). Email stays a second channel.
--
-- No foreign keys (people are recorded by e-mail, like merch_designs), so the
-- factory reset and the reset guards are not touched. Service role only, RLS
-- on. Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0361_merch_alerts.rollback.sql
-- ============================================================================

create table if not exists public.merch_alerts (
  id                     uuid primary key default gen_random_uuid(),
  fingerprint            text not null,
  subject                text not null,
  lines                  jsonb not null default '[]'::jsonb,
  order_ref              text,
  repeat_count           integer not null default 1,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  acknowledged_at        timestamptz,
  acknowledged_by_email  text,
  constraint merch_alerts_fingerprint_key unique (fingerprint),
  constraint merch_alerts_fingerprint_chk check (fingerprint ~ '^[a-f0-9]{64}$'),
  constraint merch_alerts_subject_chk check (length(btrim(subject)) between 1 and 300),
  constraint merch_alerts_lines_chk check (jsonb_typeof(lines) = 'array' and octet_length(lines::text) <= 20000),
  constraint merch_alerts_ref_chk check (order_ref is null or order_ref ~ '^gm-[a-z0-9-]{3,30}$'),
  constraint merch_alerts_repeat_chk check (repeat_count >= 1)
);

create index if not exists idx_merch_alerts_open
  on public.merch_alerts (last_seen_at desc) where acknowledged_at is null;

alter table public.merch_alerts enable row level security;
revoke all on table public.merch_alerts from public, anon, authenticated;
grant select, insert, update, delete on table public.merch_alerts to service_role;

comment on table public.merch_alerts is
  'D232 M-7 (0361): greenwaymerch.com owner alerts, posted by the shop, shown on Merch Health and Orders with Acknowledge. One row per distinct alert (fingerprint). Service role only.';

notify pgrst, 'reload schema';
