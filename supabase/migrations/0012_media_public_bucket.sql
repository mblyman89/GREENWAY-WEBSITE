-- ===========================================================================
-- Greenway Back Office — Migration 0012: media delivery (split model)
--
-- Problem this fixes (reported bug): uploaded images show a BLANK thumbnail in
-- the Media Library. Root cause: the `media` storage bucket was created with
-- public = false (migration 0001), but the app serves images via the public
-- CDN endpoint  …/storage/v1/object/public/media/<key>. Supabase only serves
-- that endpoint when the bucket's `public` flag is TRUE — RLS policies on
-- storage.objects do NOT enable the public endpoint. So every image URL 400s.
--
-- Professional / industry-standard solution (split model — matches Wix /
-- Squarespace / Shopify):
--   • PUBLIC `media` bucket  → website-facing imagery (logos, banners, hero /
--     carousel, blog covers, product images). Public + CDN-cacheable + stable
--     URLs = fast pages. This is the correct mechanism for content meant to be
--     displayed publicly.
--   • PRIVATE `media-private` bucket → restricted documents (newsletter PDFs and
--     any future private files). Served only through short-lived SIGNED URLs.
--
-- Idempotent: safe to run more than once.
-- ===========================================================================

-- 1) Flip the existing `media` bucket to PUBLIC so the public CDN endpoint works
--    for the imagery the site displays. (Writes are still staff-gated by the
--    RLS policies from migrations 0001/0003; this only affects READ delivery.)
update storage.buckets
   set public = true
 where id = 'media';

-- In case the bucket row somehow doesn't exist yet, create it public.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- 2) Create a PRIVATE bucket for restricted documents (newsletter PDFs, etc.).
--    No public endpoint — the app mints short-lived signed URLs on demand.
insert into storage.buckets (id, name, public)
values ('media-private', 'media-private', false)
on conflict (id) do nothing;

-- 2a) Staff-only read of the private bucket (signed URLs are minted server-side
--     with the service role, but this keeps direct API access staff-only too).
drop policy if exists media_private_staff_read on storage.objects;
create policy media_private_staff_read on storage.objects
  for select using (bucket_id = 'media-private' and public.is_staff());

-- 2b) Staff-only write of the private bucket.
drop policy if exists media_private_staff_write on storage.objects;
create policy media_private_staff_write on storage.objects
  for all using (bucket_id = 'media-private' and public.is_staff())
  with check (bucket_id = 'media-private' and public.is_staff());
