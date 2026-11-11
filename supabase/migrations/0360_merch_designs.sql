-- ============================================================================
-- 0360 - MERCH DESIGNS ON THE SERVER + THE SAMPLE GATE  (D232, SOP-11 M-4)
--
-- WHY. Merch Studio designs lived in ONE browser only (localStorage + the
-- browser's IndexedDB for artwork). Clearing the browser or changing computers
-- lost them, and design.json could not be loaded back (F-11-2, G-79). The
-- sample checklist was ticked on one device and Publish never checked it
-- (F-11-6, G-81). Owner, verbatim (D232): "Q2: yes, owner only and reason."
--
-- WHAT.
--   1. public.merch_designs: one row per design. `design` is the same JSON the
--      Studio saves (small: no pictures). `rev` goes up by one on every save,
--      so two computers saving the same design cannot silently overwrite each
--      other (the app saves only when rev is still the one it loaded).
--      Archive, never delete (archived_at).
--   2. The sample approval lives on the same row: who, when, which checklist
--      items were ticked, the photo's storage key, and the design_hash it was
--      approved for. Publish is refused unless sample_status is approved or
--      overridden AND sample_design_hash equals the current design_hash (a
--      changed design needs a new sample). An override is owner-only and
--      needs a typed reason (sample_reason), enforced by the app and checked
--      here (an override row must carry a reason of 5+ characters).
--   3. The private merch-files bucket (0281) also accepts the design's own
--      artwork (JPEG, WebP, SVG) and the sample photo, not only print PNGs.
--      Keys: art/<asset id> and sample/<design id>/<nonce>.<ext>.
--
-- No foreign keys (people are recorded by e-mail, like the merch catalog),
-- so the factory reset and the reset guards are not touched. Service role
-- only, RLS on. Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0360_merch_designs.rollback.sql
-- ============================================================================

create table if not exists public.merch_designs (
  id                 text primary key,
  name               text not null,
  blank_id           text not null,
  design             jsonb not null,
  design_hash        text not null,
  rev                integer not null default 1,
  created_by_email   text,
  updated_by_email   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  sample_status      text not null default 'none',
  sample_design_hash text,
  sample_checklist   jsonb not null default '[]'::jsonb,
  sample_photo_key   text,
  sample_by_email    text,
  sample_at          timestamptz,
  sample_reason      text,
  constraint merch_designs_id_chk check (id ~ '^[A-Za-z0-9_-]{1,60}$'),
  constraint merch_designs_name_chk check (length(btrim(name)) between 1 and 80),
  constraint merch_designs_size_chk check (octet_length(design::text) <= 1000000),
  constraint merch_designs_rev_chk check (rev >= 1),
  constraint merch_designs_sample_status_chk check (sample_status in ('none', 'approved', 'overridden')),
  constraint merch_designs_sample_reason_chk check (sample_status <> 'overridden' or length(btrim(coalesce(sample_reason, ''))) >= 5),
  constraint merch_designs_sample_photo_chk check (sample_photo_key is null or sample_photo_key ~ '^sample/[A-Za-z0-9_-]{1,60}/[a-f0-9]{12}\.(png|jpg|webp)$')
);

create index if not exists idx_merch_designs_live_updated
  on public.merch_designs (updated_at desc) where archived_at is null;

alter table public.merch_designs enable row level security;
revoke all on table public.merch_designs from public, anon, authenticated;
grant select, insert, update, delete on table public.merch_designs to service_role;

comment on table public.merch_designs is
  'D232 M-4 (0360): Merch Studio designs saved on the server (any computer) and the per-design sample approval that gates Publish. Archive, never delete. Service role only.';

do $m$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute 'update storage.buckets set allowed_mime_types = array[''image/png'', ''image/jpeg'', ''image/webp'', ''image/svg+xml''] where id = ''merch-files''';
  end if;
end
$m$;

notify pgrst, 'reload schema';
