-- 0025_pos_manifest_source.sql
-- Slice 7: capture how a manifest was imported (pasted JSON vs. fetched Transfer
-- Data Link URL) and snapshot the COA PDF links found in the transfer so they are
-- preserved in our knowledge base even if the vendor link later expires.
--
-- Idempotent: safe to run more than once.

-- ── inbound_manifests: provenance + COA capture ────────────────────────────
alter table public.inbound_manifests
  add column if not exists source_url text;

alter table public.inbound_manifests
  add column if not exists source_format text not null default 'generic';
  -- 'wcia' | 'generic'

-- A snapshot list of the COA references found in this transfer, e.g.
--   [{ "product_name": "...", "lot_code": "...", "lab_result_id": "WA-...",
--      "coa_url": "https://...", "release_date": "...", "expire_date": "..." }]
-- Stored verbatim so we keep the certificates of analysis even if the
-- vendor's link rotates. This is our COA knowledge-base capture per manifest.
alter table public.inbound_manifests
  add column if not exists coa_links jsonb not null default '[]'::jsonb;

create index if not exists inbound_manifests_source_format_idx
  on public.inbound_manifests (source_format);
