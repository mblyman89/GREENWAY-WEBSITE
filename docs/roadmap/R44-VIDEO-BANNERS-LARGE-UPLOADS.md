# R44 — MP4/video banners + uploads bigger than 4.5 MB

Branch `r44-video-banners-large-uploads`, started from main after R43 (PR #1332, `15c3216c`).

**Status: MERGED** as PR #1333 (rebase). Commits on main: `7fe94c19`, `4f170802`, `1002c944`, `8e79a465`. CI checks (build, compliance, migrations) were green and `Vercel – greenway_website` reported success on `8e79a465`.
The strategy roadmap that follows on from this round is `R44-EDITOR-STRATEGY-ROADMAP.md`.
The R41 bible (`R41-WEBSITE-EDITOR-BIBLE.md`) still governs editor conventions.

**Owner request (verbatim, R44):** "now that you mention it, i want to add the mp4/ video banners
feature, as well as the uploads bigger than 4.5 MB feature. it probably does not matter, but i will
mention it anyways, i am on vercel pro now, and supabase pro too. so if that allows extra wiggle room
or unlocks extra features, lets utilize those."

---

## 1. What Pro does and does not change (verified, not assumed)

| Question | Answer | Source |
|---|---|---|
| Does Vercel Pro raise the 4.5 MB request-body limit? | **No.** 4.5 MB on every plan, Pro included. Vercel's own advice is to upload directly from the browser to storage. | Vercel docs: Functions limits ("Request body size: 4.5 MB"); KB "How to bypass the 4.5MB body size limit" |
| Does Supabase Pro raise the file-size limit? | **Yes.** Free: 50 MB global maximum. Pro: the global limit can be raised up to 500 GB (Dashboard → Storage → Settings). | Supabase docs: Storage → Uploads → File limits |
| Bucket limit vs global limit | A bucket's `file_size_limit` can never exceed the global limit. The smaller one wins. | Supabase docs: Storage → Buckets → Restricting uploads |
| How to send large files | Standard upload is fine up to about 6 MB. Above that, use TUS resumable uploads with chunkSize **exactly 6 MB**, on the direct host `<ref>.storage.supabase.co`. | Supabase docs: Storage → Uploads → Standard / Resumable uploads |
| Overwriting a file path | Avoid it. The CDN can keep serving the stale copy, so upload to a new path instead. | Supabase docs: Storage → CDN → Smart CDN / "Avoid overwriting files" |
| Signed upload tokens | `createSignedUploadUrl(path)` gives a token valid for 2 h. The browser PUTs to `/object/upload/sign/<bucket>/<path>?token=`. TUS uses `/upload/resumable/sign` with header `x-signature`. | storage-js 2.108.2 source (node_modules); supabase/storage server source (`SIGNED_URL_SUFFIX`) |

## 2. Large uploads — how it works now

The file bytes **never pass through Vercel.**

1. **Browser** (`MediaDropzone`) runs `checkUpload()`, which gives a plain-English refusal for MOV, HEIC, wrong extension, or oversize. For a video, it also captures a poster frame and reads the size and duration.
2. **Server action `startDirectUploadAction`** (`src/app/admin/media/direct-upload-actions.ts`):
   - Requires the `media.manage` permission and re-runs `checkUpload`.
   - Builds a **fresh, never-reused key**, `<folder>/<16-hex nonce>[p]-<name>.<ext>`, with no overwriting (per the Supabase CDN advice).
   - Mints a signed upload token, plus a second token for the video poster.
3. **Browser upload** (`src/lib/media/direct-upload-client.ts`):
   - Files of 6 MB or less: one signed PUT, using the same request storage-js makes, sent via XHR for a live progress bar.
   - Files over 6 MB: `tus-js-client` sends 6 MB chunks to the signed resumable endpoint. Retries resume from the last chunk.
4. **Server action `finishDirectUploadAction`** never trusts the browser:
   - Calls `storage.info(key)` and checks that the object exists, that its size matches exactly, that it is within the type's cap, and that its type matches the key's extension.
   - If any check fails, the object is **removed**.
   - Then it inserts the `media_assets` row (`source = "upload:direct"`) and the `media.uploaded` audit entry.

**Limits** (`src/lib/media/upload-policy-core.ts`, 109 self-tests):

| File type | Cap | Advisory shown above |
|---|---|---|
| Images | 50 MB | 2 MB (larger GIFs get a tip to use MP4) |
| PDFs | 50 MB | — |
| Videos | 200 MB | 8 MB or 20 s |

The media bucket is set to 200 MB by migration 0265.

The other upload paths (product photo, blog hero, vendor logo, Flux reference) still use the R43 4 MB server-action cap. They are small images by nature, so they were left alone.

**Owner one-time setup:**
1. Supabase → Storage → Settings → Global file size limit: set it to **at least 200 MB**.
2. Run `supabase/migrations/0265_media_bucket_video_large_uploads.sql` (idempotent; rollback in `supabase/rollbacks/`).

## 3. Video banners — how it works now

- **`BannerVideo`** (client component):
  - Renders `<video muted loop playsinline>` with a `<source type>`. Autoplay is started from code *after* the reduced-motion and Save-Data checks.
  - With reduced motion or Save-Data on, the shopper sees the still poster and a Play button.
  - It downloads nothing until it is near the screen (`preload="none"` until then).
  - It pauses offscreen, and pauses on hidden carousel slides (`data-gw-slide`).
  - A visible pause/play button covers WCAG 2.2.2.
  - The video is decorative (`aria-hidden`); the banner text stays real HTML.
  - The hero banner preloads its poster at high priority, because for video the LCP is the poster or first frame (web.dev).
- **`BannerMedia`** (server-safe switch): a video src renders `BannerVideo`; anything else renders exactly the old `next/image`.
- **Wired into:**
  - DesignedBanner (desktop, phone and single variants)
  - SectionBanner (home category/brand, page-builder banners, Specials "Today's Deals")
  - Home Hero carousel
  - Shop banner carousel
  - Loyalty hero (both variants)
  - Loyalty signup form hero
  - Specials classic hero
- **Left image-only on purpose:**
  - Type-card tiles (small product photos)
  - Day-card images
  - Locations, price-match and footer-hours images
  - In these slots the picker hides videos (`allowVideo` off). If a video URL gets pasted there anyway, the picker shows an amber warning.
- **Pickers:**
  - `MediaChoice.mimeType` is now set by all 8 choice builders.
  - `ContentImageField allowVideo` shows video thumbnails with a 🎬 badge and a live preview.
  - Content-block slots use `blockAcceptsVideo(block_key)` (allow-list `VIDEO_CAPABLE_BLOCK_KEYS`).
  - The Banner Studio canvas plays the video with the same focus, zoom and filters.
- **Media Library:** video thumbnails in the grid (with a 🎬 VIDEO badge); a player with controls on the detail page.

**Canva guidance (shown in the uploader):** Share → Download → **MP4 Video**, 1080p, a 5–15 s loop, no important words in the motion, aim for under 8 MB.

## 4. Files

- **New:**
  - `src/lib/media/upload-policy-core.ts`
  - `src/lib/media/direct-upload-client.ts`
  - `src/app/admin/media/direct-upload-actions.ts`
  - `src/components/site/BannerVideo.tsx`
  - `src/components/site/BannerMedia.tsx`
  - migration 0265 plus its rollback
- **Changed:**
  - `MediaDropzone` (rewrite) and `store.ts` (`registerUploadedMedia`)
  - the 7 banner renderers
  - `ContentImageField`, the 8 choice builders and 8 picker call sites
  - StudioCanvas, MediaGrid and the media detail page
  - the migration tripwire test
- **Dependency:** `tus-js-client@^4.3.1` (MIT), the client Supabase's docs use for resumable uploads.

## 5. Owner test plan

See the R44 completion message (section "How to test").
