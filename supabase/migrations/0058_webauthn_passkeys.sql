-- 0058_webauthn_passkeys.sql — biometric (Face ID / Touch ID) sign-in via WebAuthn passkeys.
--
-- Adds passkey CREDENTIAL storage bound to a Supabase auth user, plus a short-
-- lived CHALLENGE table used to hold the per-ceremony challenge between the two
-- WebAuthn steps (options -> verify). All server-side flows use the service-role
-- client, so RLS here is deliberately restrictive:
--   * webauthn_credentials: a user may read/delete THEIR OWN passkeys (to manage
--     them in Settings); inserts happen via service-role after verification.
--   * webauthn_challenges: no client access at all — service-role only.
--
-- Idempotent (safe to re-run). Run manually in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------
create table if not exists public.webauthn_credentials (
  -- The credential ID as a Base64URL string (unique per passkey).
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The WebAuthn user handle we generated at registration (Base64URL).
  webauthn_user_id text not null,
  -- COSE public key bytes (stored as bytea).
  public_key bytea not null,
  -- Signature counter (some authenticators like Touch ID always return 0).
  counter bigint not null default 0,
  -- 'singleDevice' | 'multiDevice'
  device_type text,
  backed_up boolean not null default false,
  -- CSV of transports: 'internal','hybrid','usb','nfc','ble','cable','smart-card'
  transports text,
  -- Friendly label the user can set (e.g. "MacBook Touch ID", "iPhone Face ID").
  label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_webauthn_credentials_user
  on public.webauthn_credentials (user_id);
create index if not exists idx_webauthn_credentials_webauthn_user
  on public.webauthn_credentials (webauthn_user_id);

drop trigger if exists trg_webauthn_credentials_updated on public.webauthn_credentials;
create trigger trg_webauthn_credentials_updated
  before update on public.webauthn_credentials
  for each row execute function public.set_updated_at();

alter table public.webauthn_credentials enable row level security;

-- Owner may read their own passkeys (to list/rename/remove them in Settings).
drop policy if exists webauthn_credentials_owner_select on public.webauthn_credentials;
create policy webauthn_credentials_owner_select on public.webauthn_credentials
  for select using (user_id = auth.uid());

-- Owner may delete their own passkeys.
drop policy if exists webauthn_credentials_owner_delete on public.webauthn_credentials;
create policy webauthn_credentials_owner_delete on public.webauthn_credentials
  for delete using (user_id = auth.uid());

-- Owner may rename their own passkeys (label / last_used_at housekeeping).
drop policy if exists webauthn_credentials_owner_update on public.webauthn_credentials;
create policy webauthn_credentials_owner_update on public.webauthn_credentials
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- NOTE: inserts are performed by the service-role client only (after the
-- registration response is cryptographically verified server-side), so there
-- is intentionally no INSERT policy for regular users.

-- ---------------------------------------------------------------------------
-- Challenges (short-lived, service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.webauthn_challenges (
  -- Random opaque handle we hand to the browser and echo back on verify.
  id uuid primary key default gen_random_uuid(),
  -- 'registration' | 'authentication'
  kind text not null,
  -- The challenge string that must match on verification.
  challenge text not null,
  -- For registration: the signed-in user. For authentication: the resolved
  -- candidate user (looked up by the email the person typed), if any.
  user_id uuid,
  -- The email typed at the login screen (authentication only), for auditing.
  email text,
  -- The WebAuthn user handle used for registration options.
  webauthn_user_id text,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists idx_webauthn_challenges_expires
  on public.webauthn_challenges (expires_at);

alter table public.webauthn_challenges enable row level security;
-- No policies at all => only the service-role client (which bypasses RLS) can
-- touch this table. Challenges are never exposed to the browser directly.
