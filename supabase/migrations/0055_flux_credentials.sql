-- =============================================================================
-- 0055_flux_credentials.sql  (Slice A / item 19)
--
-- Adds Black Forest Labs FLUX 2 image-generation credentials to the existing
-- singleton public.integration_credentials row (migration 0053). The owner is
-- pivoting from Midjourney (copy/paste prompts) to FLUX 2 [max] as a fully
-- integrated API pipeline baked into the marketing workflow: build a prompt,
-- generate the image via the BFL API, and save the result straight into the
-- media library for use on the website and other marketing.
--
-- VERIFIED against docs.bfl.ai (BFL API):
--   * Auth header:  x-key: <BFL_API_KEY>
--   * Submit:       POST {base}/v1/{endpoint}  (e.g. /v1/flux-2-max)  -> { id, polling_url }
--   * Poll:         GET  polling_url  until status == "Ready" -> result.sample (signed URL, ~10 min)
--   * Global base:  https://api.bfl.ai   (regional: api.us.bfl.ai / api.eu.bfl.ai)
--   * Default model endpoint for this owner: flux-2-max (highest fidelity).
--
-- These are SECRETS. They live on the same admin-only, RLS-restricted row as the
-- Leafly / WeedMaps credentials, so no new table or policy is needed. Only new
-- columns are added (idempotent). Empty api key = "not configured" (no-op).
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

alter table public.integration_credentials
  add column if not exists flux_api_key   text not null default '';

-- Which model endpoint to hit under {base}/v1/<endpoint>.
-- Default flux-2-max per the owner's choice. Non-preview => reproducible.
alter table public.integration_credentials
  add column if not exists flux_endpoint  text not null default 'flux-2-max';

-- API base URL. Empty => application default (https://api.bfl.ai). Lets the
-- owner pin a regional endpoint (api.us.bfl.ai / api.eu.bfl.ai) if desired.
alter table public.integration_credentials
  add column if not exists flux_base_url  text not null default '';

-- No values are seeded; the empty row already exists from 0053. RLS (admin
-- read/write) from 0053 already covers these columns. Nothing is pushed to any
-- third party by this migration.
