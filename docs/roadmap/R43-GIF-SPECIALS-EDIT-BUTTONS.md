# R43 — GIF banners, Specials editor wiring, green "✎ Edit" buttons

Branch `r43-gif-specials-edit-buttons`, started from main after R42 (PRs #1330, #1331).
The R41 bible (`R41-WEBSITE-EDITOR-BIBLE.md`) still governs editor conventions. This
file records the R43 decisions and the link formats, and it is the place to check
"where is X edited?" questions.

---

## 1. GIF banners — decision

**Verdict: mostly already supported. We did a small hardening pass and did NOT do a rebuild.**

What we verified in the code:

- **Uploads already accept `image/gif` everywhere images are uploaded:**
  - media library: `ALLOWED_MIME` in `src/app/admin/media/actions.ts`
  - MediaDropzone `accept`
  - media pickers (`PICKABLE_IMAGE_MIME`)
  - product, blog and vendor image actions
  - The image-dimension probe reads GIF headers too.
- **Rendering:** every banner draws through `next/image` (DesignedBanner, SectionBanner, Hero carousel, ShopBannerCarousel, LoyaltyHeroBanner, LoyaltySignupForm, PromoGrid type cards). The Specials classic hero uses a plain `<img>`. Next's optimizer cannot resize an animated GIF without losing frames, so it passes animated GIFs through unchanged. The animation therefore already played.
- **The real limit was upload size.** Uploads go through a Server Action, which is a Vercel Function, and Vercel caps a Function request body at **4.5 MB**. `next.config` `bodySizeLimit: "50mb"` cannot raise that. The app advertised "up to 10 MB" (media) and 5 MB (products, vendors, blog). Anything over 4.5 MB failed on production with a bare 413 error page before our code ran.

What R43 changed:

1. **`src/lib/media/gif-core.ts`** (pure, 21 self-tests):
   - `isGifSrc(src)`
   - `MEDIA_UPLOAD_MAX_BYTES` = 4 MB, plus `MEDIA_UPLOAD_MAX_LABEL`
   - `formatMegabytes`
   - `tooLargeMessage(name, bytes)`, which adds a GIF-specific tip
2. **Banner renderers** set `unoptimized={isGifSrc(src)}`. A GIF now loads straight from storage, with no optimizer hop and no billed transformation. The animation is guaranteed intact. Non-GIF images are unchanged.
3. **Honest upload cap of 4 MB per file:**
   - Applied to the media library, Flux reference upload, product image, blog hero and vendor/brand logo.
   - Clear messages replace "exceeds 10 MB", and the blog's raw `heroSize`/`heroType` codes.
   - MediaDropzone checks before submitting. It flags any file over 4 MB, and flags a multi-file batch whose total is over 4 MB (one upload is one request). The Upload button is disabled with a plain-English reason.
   - The dropzone text now reads "GIF (animated OK) · up to 4 MB per upload", and the Canva cheat-sheet has a GIF tip.

**Owner guidance for GIFs (Canva):**
- Build the canvas at the slot's size from the Canva cheat-sheet (Media → Upload → "Canva size cheat-sheet").
- Keep the loop short (2–6 s) and export the GIF **under 4 MB**.
- Upload it in Media, then pick it in the banner's image picker like any image.
- Keep important words out of the GIF; the banner's own headline and buttons sit on top.

**Not done, deliberately:**
- MP4/WebM video banners. A video element plus poster plus reduced-motion handling is a real feature; video is ~5–10× smaller than an equivalent GIF.
- Direct-to-storage signed uploads, which would lift the 4.5 MB ceiling.
- Revisit both if GIFs over 4 MB become routine.

**Accessibility note:** WCAG 2.2.2 (Pause, Stop, Hide) applies to motion that lasts more than 5 s. Prefer short loops or GIFs that stop. A pause control for GIFs would come with the video feature.

---

## 2. Specials editor — the text bug and the legacy preview

**Root cause:**
- `/specials` built its hero wording as `hero?.eyebrow || copy[...]`.
- `hero` is the legacy `page_sections` row. Whenever that old row had text, it beat the `specials.hero.*` content blocks the owner edits.
- So the editor saved fine, but the live page kept showing the old row.

**Fix:**
- `resolveSpecialsHeroText(copy)` in `src/lib/specials/specials-presentation-core.ts` reads ONLY the `specials.hero.eyebrow/title/subtitle` blocks.
- Both `/specials` and `/admin/specials` use it.
- The legacy row still supplies only the image, focus and button fallbacks.

**Legacy preview window:**
- `ContentEditorShell` gained `showPreview` (default true). `HeroTextCard` passes `false`.
- The card now has a "Preview in Website Hub ↗" link and an `id="hero-text"` anchor.
- The Specials presentation editor now shows the real hero words and accepts `?tab=hero|banner|cards`.

---

## 3. Green "✎ Edit" buttons — how the system works

```
public page (preview mode)                     admin
──────────────────────────                     ─────
PreviewEditOverlay measures                    /admin/edit  (server, requireStaff)
  [data-gw-block]        -> ✎ Edit               edit-target-core resolves the editor
  [data-gw-design-owner] -> ✎ Edit banner        + home section ids / section page slug
  [data-gw-edit-owner]   -> ✎ Edit banner        redirect (only if /admin/... safe)
  [data-gw-edit-area]    -> ✎ Edit slides/cards/…        │
click -> /admin/edit?block|owner|area=…&from&path        ▼
  in hub iframe: postMessage -> PreviewFrame     editor page
     -> WebsiteSyncPreviewPanel navigates top     AdminBlockFocus: scrolls + highlights
  on live site: location.assign                    #block-/#f-<key> or #<anchor>,
                                                   expands collapsed cards (gw-expand),
                                                   shows "← Back to preview" pill
```

**Files:**
- `src/lib/cms/edit-link-core.ts`: import-free, ships to the public bundle.
- `src/lib/cms/edit-target-core.ts`: 323 self-tests. Every seeded block resolves to a real editor, and each area has both a label and a destination.
- `src/app/admin/edit/page.tsx`
- `src/components/admin/ux/AdminBlockFocus.tsx`: mounted in the admin layout.
- `src/components/site/PreviewEditOverlay.tsx`
- `src/components/admin/PreviewFrame.tsx` (`onEditTarget`): validates origin, our iframe and an /admin path.
- `src/components/admin/WebsiteSyncPreviewPanel.tsx`
- `src/components/admin/EditLinksGuide.tsx`: the cheat sheet on the hub preview tab.

**Pill behaviour:**
- Pills only exist in Draft/Preview mode; customers never get them.
- They hide while Move mode is on.
- The Preview badge has an "✎ Edit buttons: On/Off" switch, remembered in localStorage `gw-edit-pills`.
- Text inside a banner that the banner pill already covers (`home.category.*`, `home.brand.*`) gets no duplicate pill.

### 3.1 Link format (type, paste or bookmark)

| Link | Opens |
|---|---|
| `/admin/edit?block=<block key>` | the editor and field for one content block, e.g. `specials.hero.title` |
| `/admin/edit?owner=specials:hero` | Specials editor → Hero tab |
| `/admin/edit?owner=specials:todays` | Specials editor → Today's banner tab |
| `/admin/edit?owner=loyalty:hero` | Loyalty page editor → hero section |
| `/admin/edit?owner=section:<uuid>` | the owning page editor scrolled to that section card |
| `/admin/edit?owner=shop-slide:<uuid>` | Shop banner editor, that slide opened |
| `/admin/edit?area=home-carousel` | Home editor → Carousel tab |
| `/admin/edit?area=home-typecards` | Home editor → Type cards tab |
| `/admin/edit?area=specials-cards` | Specials editor → Deal cards tab |
| `/admin/edit?area=shop-banner` | Shop banner editor |

- Add `&from=hub&path=/specials` (or `from=site`) to get the "← Back" pill.
- Unknown or invalid values open the Website Hub preview instead of an error.
- Hovering a pill shows its block key.

### 3.2 Button link formats (what a banner/card button may point at)

These come from `link-target-core`, which is also the source for "Pick a link…".

- Public page: `/`, `/menu`, `/specials`, `/loyalty`, `/medical`, `/vendor-delivery`, `/blog`, `/about`, `/faq`, `/locations`, `/price-match`, `/privacy-policy`, `/terms-of-use`, `/consumer-health-data`
- Category: `/menu/<category>` (e.g. `/menu/flower`)
- Filtered menu: `/menu?categories=a,b&strains=..&brands=..&vendors=..&weights=..&special=..&sort=..&maxPrice=..&maxThc=..&maxCbd=..&search=..`
  - `special` values: clearance-50, doobie-tuesday, wax-wednesday, top-shelf-thursday, super-saturday, ice-cream-sunday
  - `sort` values: featured-shuffle, best-sellers, price-low, price-high, potency-high, category
- Blog post: `/blog/<slug>`
- Contact links: `tel:+1…`, `mailto:…`
- Other sites: `https://…`
- Same page: `#anchor`

---

## 4. Status

- [x] Specials text connected (commit 1037ac80)
- [x] Legacy preview removed from HeroTextCard (1037ac80)
- [x] edit-target-core + edit-link-core (e400ef66)
- [x] /admin/edit resolver + AdminBlockFocus + editor anchors (8100ca65)
- [x] Public owner/area tagging (preview only)
- [x] Overlay pills on, hub navigation, cheat sheet
- [x] GIF pass-through + honest 4 MB cap
- [x] Self-tests registered (edit-target-core floor 300, gif-core floor 21)
- [ ] PR merged + Vercel green (recorded in PR)
