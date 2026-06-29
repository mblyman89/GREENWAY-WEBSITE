-- =============================================================================
-- Migration 0017 — Email unsubscribe / opt-out for loyalty members (Slice B)
-- =============================================================================
-- CAN-SPAM compliance for the Newsletter Send Center: every marketing email
-- must include a working one-click unsubscribe. We add a per-member opt-out
-- flag plus a stable secret token used in the unsubscribe link.
--
--   email_opt_out      — true once the member unsubscribes (excluded from sends)
--   unsubscribe_token  — random secret in the unsubscribe URL (no login needed)
--   unsubscribed_at    — timestamp of opt-out (audit)
--
-- Idempotent — safe to re-run. Apply manually in the Supabase SQL editor.
-- =============================================================================

alter table public.loyalty_signups
  add column if not exists email_opt_out boolean not null default false;

alter table public.loyalty_signups
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

alter table public.loyalty_signups
  add column if not exists unsubscribed_at timestamptz;

-- Fast lookup by token for the public /unsubscribe route.
create unique index if not exists loyalty_signups_unsub_token_idx
  on public.loyalty_signups (unsubscribe_token);

-- Backfill: ensure any pre-existing rows have a token (the default covers new
-- rows; this is belt-and-suspenders for rows created before the default).
update public.loyalty_signups
  set unsubscribe_token = gen_random_uuid()
  where unsubscribe_token is null;
