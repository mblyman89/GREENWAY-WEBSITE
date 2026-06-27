# Round 6 — Footer Revision (Handoff-Ready TODO)

Repo: `mblyman89/GREENWAY-WEBSITE` · Base HEAD this round: `b895ff5` (PR #27 merged)
Working dir: `/workspace/_gw_clone` · Scratch: `/workspace/_verify` (OUTSIDE repo)
Live: https://greenwaywebsite1.vercel.app

## User's explicit requests
1. **Hours image — remove background** so it matches page bg (footer is `bg-black`). Applies to BOTH desktop + mobile. User loves mobile look but "needs the background removed too."
2. **Hours image — scale to fill space** without pushing other elements. Remove oversized boxes/constraints; expert judgement on best fill technique.
3. **App Download section — DO NOT TOUCH** (perfect on mobile + desktop). No edits to `appStores` array or `AppDownload` component.
4. **Follow Greenway — add 3 glyphs:** Google + Yelp (match reference 4-glyph screenshot: steel-blue circle, white icon) AND Leafly (use uploaded `Leafly_glyph.png` as the icon). Must match existing glyphs perfectly.
5. **Center "FOLLOW GREENWAY" title** (fix desktop right-align).
6. Read all files; expert judgement; visually inspect; validate; push to git; update Vercel.

## Glyph spec (MATCH EXACTLY)
- 220×220 px, RGBA, transparent corners `(0,0,0,0)`
- Steel-blue circle fill RGB **(90,143,181)**, diameter ~201, ~9px margin, centered
- White icon centered
- Existing: `public/social/glyph-{facebook,instagram}.png`

## Hours image
- `public/brand/store-hours-open.png` = 290×180 RGBA, solid `(20,20,20,255)` bg → make transparent.

## Tasks
- [x] Re-clone repo, free disk, read Footer.tsx + business.ts, inspect assets
- [x] Create this TODO
- [x] Make hours image background transparent → `public/brand/store-hours-open-transparent.png`
- [x] Generate Google glyph → `public/social/glyph-google.png`
- [x] Generate Yelp glyph → `public/social/glyph-yelp.png`
- [x] Generate Leafly glyph → `public/social/glyph-leafly.png`
- [x] Visually verify all 3 glyphs + hours image (see-image)
- [x] Wire assets in `src/content/business.ts` (socialGlyphGoogle/Yelp/Leafly, storeHoursImage→transparent)
- [x] Update Footer.tsx: add google/yelp/leafly to `socialGlyphs`; center FOLLOW GREENWAY title; improve hours scaling; DO NOT touch AppDownload
- [x] Validate: npm install → ./node_modules/.bin/tsc --noEmit → npx eslint src → clean build
- [x] Visual inspect desktop (1600×900) + mobile (390×844) via Chromium CDP
- [ ] Branch feature/round6-footer-revision, commit, push, PR, merge
- [ ] Confirm Vercel Production deploy state=success; re-verify live
