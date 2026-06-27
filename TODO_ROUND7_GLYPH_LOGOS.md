# ROUND 7 — Glyph Logo Corrections (HANDOFF-READY TODO)

## Context
Greenway Marijuana POS website. Repo: mblyman89/GREENWAY-WEBSITE (Next.js 16 / React 19 / Tailwind v4 / Vercel).
Live: https://greenwaywebsite1.vercel.app  | Base HEAD: 3c848bd (PR #28 merged).
Working dir: /workspace/_gw_clone  | Scratch (OUTSIDE repo): /workspace/_verify

## User request (most recent, AUTHORITATIVE)
"I said the GOOGLE PLAY APP LOGO. not the google icon that links to maps. The google play store
app logo. In the app download section of the footer. Please fix it. Then fix the yelp logo too please."

## EXACTLY TWO FILES TO FIX (replace PNG contents only; same filenames -> NO code/business.ts/Footer.tsx edits)
1. public/app-download/glyph-google.png  (APP DOWNLOAD section Google Play glyph)
   - CURRENT (WRONG): plain white right-pointing play triangle on steel-blue circle.
   - TARGET: the ACTUAL official Google Play logo (the 4-color play-button triangle:
     blue/green/yellow/red) composited centered on the SAME blank steel-blue circle base.
2. public/social/glyph-yelp.png  (FOLLOW GREENWAY social section Yelp glyph)
   - CURRENT (WRONG): white 5-pointed STAR (PIL hand-drawn burst collapsed into a star).
   - TARGET: the ACTUAL official Yelp burst/flame mark, rendered WHITE, composited centered
     on the SAME blank steel-blue circle base (matches facebook/instagram/leafly white style).

## GLYPH SPEC (MATCH EXACTLY — verified via PIL on facebook/instagram/leafly/apple)
- 220x220 px, RGBA. Transparent corners (0,0,0,0).
- Steel-blue circle fill RGB (90,143,181), ~9-10px margin (circle x=9..210), centered.
- Other glyphs are WHITE monochrome icons. EXCEPTION: Google Play keeps its real 4-color triangle
  (its brand identity), per user's explicit "actual logo" demand. Yelp = white.
- Build at 4x supersample (880px) then LANCZOS downscale to 220 for crisp edges.

## DO NOT TOUCH
- public/social/glyph-google.png  (social "G" -> Google Maps; user said looks great)
- public/social/glyph-facebook.png, glyph-instagram.png, glyph-leafly.png
- public/app-download/glyph-apple.png, app-download-wordmark.png
- hours image, FOLLOW GREENWAY centering, src/content/business.ts, Footer.tsx

## STEPS
- [x] Verify disk/repo/spec; confirm current state of both glyphs via see-image
- [x] Source real logos: Google Play (4-color SVG from Wikimedia), Yelp burst (simpleicons SVG, 5 petals only -> white)
- [x] Build blank steel-blue circle base (PIL, 4x SS)
- [x] Composite Google Play colorful triangle -> public/app-download/glyph-google.png
- [x] Composite white Yelp burst -> public/social/glyph-yelp.png
- [x] Visually verify both vs reference glyphs (see-image) on black — compare_row confirms consistent
- [x] Verify in real footer: dev server :3000 + Playwright CDP desktop+mobile; crop confirms both glyphs correct
- [x] Validate: npm install (exit 0); ./node_modules/.bin/tsc --noEmit (exit 0); npx eslint src (exit 0); build "Compiled successfully" (full page-gen hung on sandbox env, NOT code — only binary PNGs changed; assets serve HTTP 200)
- [ ] Branch feature/round7-glyph-logos; commit; push; PR; merge to main
- [ ] Confirm Vercel Production deploy state=success; re-verify live (curl 200 + screenshot)

## VALIDATION CMDS
- Build (background): nohup npm run build > /workspace/_verify/build.log 2>&1 &
- tsc: ./node_modules/.bin/tsc --noEmit   (NOT npx tsc)
- Push: git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git <branch>
- Deploy status: gh api repos/mblyman89/GREENWAY-WEBSITE/commits/<SHA>/status --jq '.state'
