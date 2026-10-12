# R45–R48: Website editor top-off (the "cherry on top")

**Owner request (verbatim):** "Thank you, great work! I want to move forward with R45-R48. That should be all we need to fully top off the website editor branch. I am very happy with it as it is now. So this last round will be the cherry on top. Please complete 2 slices before reporting back to me. Go above and beyond for me as you have been doing. Keep adding in as much additional value as you possibly can. Follow the standing rules and never guess, never assume. Commit work very frequently, the sandbox environment is very unstable, we must protect the work as best we can. I will do the testing, only do minimal testing to make sure everything checks out and doesn't break anything. Then let me know how to test the new features and I'll get back to you with what doesn't work. Please give me a quality summary report at the end covering everything done and what's left to build. Thank you!"

The scope source is `R44-EDITOR-STRATEGY-ROADMAP.md`, §6 and §7.

| Round | Items (roadmap rank) |
|---|---|
| R45 | #1 carousel pause/stop/mobile/swipe + fetchpriority · #6 magic-byte upload check · #4 AVIF + blur placeholders · #7 optimistic locking |
| R46 | #2 scheduled publish/unpublish + Releases |
| R47 | #3 publish-time quality + WAC lint · #5 CTA click analytics + **Reports > Website tab** (owner request, R46 round) |
| R48 | #8 Playwright + axe in CI · #9 approvals · #12 holiday hours → LocalBusiness |

## Slice log

| Slice | Contents | Status |
|---|---|---|
| R45-S1 | Carousel accessibility (WCAG 2.2.2 + Baymard) | done, awaiting owner test |
| R45-S2 | Upload hardening + AVIF + blur previews + edit-conflict protection | done, awaiting owner test (migration 0266 to apply) |
| R46-S1 | Scheduled publish/unpublish (migration + Vercel cron) | next |
| R46-S2 | Releases (group several edits, publish together) | planned |
| R47-S1 | Publish-time accessibility + WAC 314-55-155 lint | planned |
| R47-S2 | CTA click analytics (first-party + GA4 select_promotion) + Reports > Website tab | planned |
| R48-S1 | Playwright + axe in CI | planned |
| R48-S2 | Approvals + holiday hours feeding the LocalBusiness schema | planned |

## R45-S1: carousel accessibility (done)

Sources: W3C ARIA APG Carousel pattern; WCAG 2.2 SC 2.2.2 (Pause, Stop, Hide);
Baymard auto-rotating carousel research; web.dev Fetch Priority.

- `src/lib/site/carousel-autoplay-core.ts` holds the pure rules (62 self-tests):
  - a reducer, plus the rotation-on/off policy;
  - the button label, and aria-live "off" while rotating, "polite" when stopped;
  - word-count dwell: base 6 s, longer for text-heavy slides, max 10 s;
  - swipe classification, keyboard arrows, and fetch priority (slide 1 high,
    the rest low).
- `src/components/site/useCarouselAutoplay.ts` is one shared engine for the
  home hero and the Shop banner carousel:
  - Rotation pauses on hover and while the tab is hidden.
  - It stops for good when keyboard focus enters the carousel, or when the
    visitor presses the pause button.
  - It is off by default on phones and for visitors with reduced motion on.
  - Touch/pen swipe left and right (vertical page scrolling still works).
- `CarouselRotationButton`: a visible 24×24 pause/play control, placed before
  the slides in reading order, as the APG pattern specifies.
- The home hero now has exactly one `<h1>`. Slide 1 is the h1; the other
  slides are h2.

## R45-S2: upload hardening, AVIF, blur previews, edit conflicts (done)

Sources: OWASP File Upload Cheat Sheet; WHATWG MIME Sniffing §6–7; the MP4RA
brand registry; Next 16 `next/image` docs (`formats`, `placeholder`,
`blurDataURL`); Vercel image-optimization limits.

- **Magic bytes.** `src/lib/media/file-signature-core.ts` (52 self-tests)
  checks that a file's real bytes match its declared type: PNG, JPEG, GIF,
  WebP, PDF, MP4 (ISO-BMFF brands only, QuickTime refused), WebM and SVG.
  - Both upload paths check it: the small form upload, and the large direct
    upload, which reads the first 4 KB back from Storage.
  - Files that fail are deleted.
  - Video posters must be real JPEGs.
- **SVG safety.** SVGs containing script, foreignObject, `on…=` handlers,
  `javascript:` links or ENTITY declarations are refused. So are SVGs over 1 MB.
- **AVIF.** `next.config.ts` sets `images.formats` to AVIF first, with WebP
  as the fallback.
- **Blur previews.** At upload, sharp makes a ≤10px WebP preview (about 100
  characters).
  - It is stored on `media_assets.blur_data_url` (migration 0266, with a
    size/format CHECK).
  - The home hero and Shop carousel look previews up by URL in one query and
    pass `placeholder="blur"` to next/image.
  - Every step is best-effort. Before 0266 is applied, uploads and banners
    behave exactly as before.
  - Photos over 15 MB uploaded by the large-file path skip the preview.
  - Files uploaded before this change have no preview. Re-uploading creates one.
- **Edit-conflict protection.** Saving a content block is now an atomic
  compare-and-swap on `content_blocks.updated_at`, so no migration is needed.
  - If someone else saved first, nothing is overwritten.
  - An amber banner offers "Reload latest version".
  - The event is audited as `content.draft_conflict`.

## R46 round: owner request (verbatim)

"Thank you! I was thinking while you were working on the last rounds slices, if we are going to be tracking customer clicks on the website, we should add a tab to the reports page that highlights all the stats we are now tracking. I am sure you would have come to this same conclusion, but I still think it relevant to make sure we include that. Please add that to the roadmap strategy of it's not already in there. Please proceed with the next two slices. Please keep going above and beyond for me as you have been doing. Keep researching the internet for enterprise grade solutions to use and implement. Follow the standing rules and never guess, never assume. Only test a minimal amount that would satisfy committing a slice of work that doesn't break anything. I will do the bulk of the testing and get back to you with what doesn't work. At the end, please give me a thorough summary report with what to test and how to test it. Also, while you are in the editors working, please make sure all the relevant seo stuff is getting applied and used and set and such. I want to make sure we dominate the search engines. Please proceed, thank you!"

- The Reports > Website tab was added to R44 roadmap §4.5 (Step 1b), §6 and
  §7. It is built in R47-S2, alongside click tracking.
- **SEO audit finding (R46).** The SEO Editor (`/admin/content/seo`) saves
  to `seo_entries`, but no public page reads that table. Every page uses a
  hard-coded `pageMetadata(...)`, so the owner's saved titles, descriptions,
  noindex and sitemap choices had no effect on Google. R46-S2 fixes this.
