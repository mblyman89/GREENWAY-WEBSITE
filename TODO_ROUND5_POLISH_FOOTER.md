# Round 5 — Front-End Polish + Footer Modifications (HANDOFF-READY TODO)

Branch: `feature/round5-polish-footer` (base = `main` @ `80c69d6`)
Repo: mblyman89/GREENWAY-WEBSITE · Next.js 16 / React 19 / Tailwind v4 / Vercel
Live: https://greenwaywebsite1.vercel.app

This file is the single source of truth for the round. Mark `[x]` only with concrete evidence.

---

## PART B — Footer modifications (mobile + desktop) — uploaded reference screenshots

Reference images (in /workspace, already viewed with see-image):
- `please_use_this_for_my_store_hours.png` — "OPEN / 8am-11:45pm" white+orange-script on black → the HOURS image
- `app_download.png` — "App / DOWNLOAD" white script+sans on black → app-download graphic (goes LEFT of buttons)
- `example_of_what_I_want_my_app_download_footer_should_look_like...png` — target layout: "App DOWNLOAD" text left, then two STEEL-BLUE CIRCULAR glyphs (Apple + Google Play arrow) on right
- `social_media_glyphs_I_want_you_to_copy_exactly...png` — 4 STEEL-BLUE CIRCULAR glyphs: Facebook, X, Yelp, Google
- `My_mobile_website_footer_currently_please_change.png` — current mobile footer (reference of what to change)
- `desktop_footer_I_want_to_change_to_use_the_new_hours_image.png` — current desktop footer (reference of what to change)

### Asset generation (Image Tool — user authorized exact replicas)
- [x] B1. Generate steel-blue circular **Apple** glyph (transparent bg) → `public/app-download/glyph-apple.png`
- [x] B2. Generate steel-blue circular **Google Play** glyph (transparent bg) → `public/app-download/glyph-google.png`
- [x] B3. Generate steel-blue circular **Facebook** glyph → `public/social/glyph-facebook.png`
- [x] B4. Generate steel-blue circular **Instagram** glyph (NEW — match style exactly) → `public/social/glyph-instagram.png`
- [x] B5. Copy hours image → `public/brand/store-hours-open.png`
- [x] B6. Copy app-download image → `public/app-download/app-download-wordmark.png`
- [x] B7. Visually verify EACH generated asset with see-image; cleaned bg→transparent, trimmed white ring, resized 220px. PASS.

### Footer.tsx — MOBILE
- [x] B8. Replaced green Store-Hours box with HoursImage (no text). 
- [x] B9. App section: AppDownload (wordmark left of 2 circular glyphs); removed "coming soon" text.
- [x] B10. Social: FollowGreenway with circular IG + FB glyphs.

### Footer.tsx — DESKTOP
- [x] B11. Replaced Hours/phone text block with HoursImage (align end).
- [x] B12. AppDownload component reused (identical to mobile) in desktop spot.
- [x] B13. FollowGreenway component reused (identical to mobile) in desktop spot.
(Shared components HoursImage/AppDownload/FollowGreenway guarantee mobile≡desktop.)

---

## PART A — SCOPE CORRECTION (user direction)

User reviewed and said: do NOT change any visible page content/layout other than the footer.
KEEP only the 4 INVISIBLE plumbing items. DISCARD all visible-copy edits.

REVERTED (back to live-site state): StoreVisit.tsx, MenuCollectionShell.tsx, VendorDirectory.tsx,
PolicyContent.tsx, policy-preview-data.ts, error.tsx, not-found.tsx.

A2 (preview-copy rewrite) = DROPPED. A5 (404/error copy rewrite) = DROPPED (reverted).

### Invisible plumbing to ship this round:
- [x] A1. Analytics: GA4 component env-gated `NEXT_PUBLIC_GA_ID`, afterInteractive, no-op when unset. Wired in layout. Added `.env.example`.
- [x] A3. Accessibility plumbing: audited via _verify/a11y_audit.py — 0 `<Image>` missing alt, 0 icon-only controls without an accessible name (72 aria-labels already in place). New Footer glyph links have descriptive alt + aria-label + focus-visible greenway outline. NO visual redesign.
- [x] A4. Open Graph share images per key page. Generated 5 on-brand 1200×630 banners → `public/og/{home,menu,specials,loyalty,locations}.png`. Wired via `pageMetadata({image})` for menu/specials/loyalty/locations and `metadata.openGraph/twitter` for home. Verified served HTML has correct absolute og:image + twitter:image for all 5. Affects ONLY off-site link previews.
- [x] A6. Playwright E2E smoke test: `@playwright/test` dev dep + `playwright.config.ts` (build+serve on :3100) + `e2e/smoke.spec.ts` (age gate, menu load, add-to-cart launcher, policy links). Added `test:e2e` / `test:e2e:ui` scripts. tsc validates the test files (exit 0).
- A2 (finalize preview copy) — DROPPED per user scope correction (no visible page-copy edits).
- A5 (404/error brand copy) — DROPPED/reverted per user scope correction.

---

## VALIDATION / SHIP
- [x] V1. `npm install` then `./node_modules/.bin/tsc --noEmit` → exit 0
- [x] V2. `npx eslint src` → exit 0 (clean)
- [x] V3. Clean background build (`rm -rf .next tsconfig.tsbuildinfo && npm run build`) → "Compiled successfully"; BUILD_ID + prerender-manifest generated; 2371 static pages.
- [x] V4. `next start` on :3100; visually verified footer DESKTOP (1600×900) + MOBILE (390×844): hours image (OPEN/8am-11:45pm), app-download wordmark left of steel-blue Apple+Google glyphs, Follow-Greenway IG+FB steel-blue glyphs. Renders correctly on black footer.
- [x] V5. Served HTML verified: og:image + twitter:image absolute URLs for home/menu/specials/loyalty/locations; /og/*.png return HTTP 200.
- [ ] V6. Commit + push branch; open PR; validate; merge to main; delete branch
- [ ] V7. Confirm Vercel Production deploy state=success for merged SHA; re-verify on live prod
