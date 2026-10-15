# R52: Home Carousel Banner Editor — Recon, Audit, Research, Strategy Roadmap

*No-code round. Branch `docs/r52-banner-studio-recon`. Work in progress — committed often.*

## 0. Owner request (verbatim, R52)

> "thank you. i want to now move on to the website editor. we need to enhance it further to make it even better and optimize it so there is no limits to what i can create. the home page editor is the best one out of all the website page editors that have and use banners. so first, we will tune up, enhance and optimize the home page editor first, then copy and paste that solution to all the other page editors. the page/ banner editor i am speaking about specifically is the home page carousel editor. i want the basic mode with its advanced features moved under the custom design studio. basic mode should be collapsed, opened by clicking it. custom design studio should be enabled and expanded open. i want the image upload in the custom design studio mode to be used for both computer and phone, no dual uploading for the two options. i want to be able to double click in the text field on the banner to edit the text. i want to be able to press the enter button when editing text in the box on the banner, that it moves the text to the next line, without needing to rely on resizing the length of the text box to force it to wrap. if the "use custom design for this banner" is checked, the design studio should auto open. i want to be able to add simple elements and change their color and border and other such effects. i want to be able to upload my own fonts. i want more font features, creative font features, font effects. i want to be able to set objects and elements in front or behind things. plus any other text, font, element, object, advanced and expert tool and method for allowing the absolute most creative freedom to build anything. read agents.md and then begin auditing the code and researching the internet for enterprise grade solutions that are professional and expert level. Please go above and beyond for me. Follow the standing rules and never guess, never assume. this is a no code editing round. i want recon, audit, research, report, strategy roadmap. please give me your expert professional opinion on how we can make the home page carousel banner editor supreme and top notch. Commit work often, the sandbox is very unstable. Protect the work as best you can. Thank you!"


## 1. Audit — what the home carousel editor does today (verified at `b03636ee`)

Every statement below was read from the file named; nothing is inferred.

### 1.1 Where the editor lives
- `src/app/admin/content/carousel/page.tsx` only redirects to `/admin/pages/home?tab=carousel`; each slide is edited by `src/components/admin/CarouselSlideCard.tsx` (756 lines).
- Save path: hidden input `advanced` → `src/app/admin/content/carousel/actions.ts:104` → `normalizeHomeSlideAdvanced` → `home_carousel_slides.draft_advanced` (jsonb, migration 0268, publish copies to `advanced`).
- Public render: `src/components/home/Hero.tsx:371` — when `adv.design?.enabled` the slide renders through `src/components/site/DesignedBanner.tsx` with `imageSrc={slide.image || adv.imageMobile}`; otherwise the legacy layout (with a separate `<picture>`-style phone image at Hero.tsx:402).

### 1.2 Card order today (top → bottom) vs. owner wish
| Today (CarouselSlideCard) | Owner wants |
|---|---|
| 1. Background image (`ContentImageField`, video allowed) + alt | Custom Design Studio **first, enabled, expanded** |
| 2. Image focus, text side, eyebrow, title, description, 2 CTA fieldsets | Basic mode **collapsed**, click to open, placed **under** the studio |
| 3. "✨ Advanced options" collapsible (`advOpen = !!initialAdv`) containing LineStyleEditors, **Phone picture** upload, focus pills, align, schedule, **DesignCard "Custom design (optional)"**, reset | Studio not buried; schedule & alt text still reachable |
| 4. Enable checkbox, Save draft, Publish | unchanged |

Finding A1 — the studio is nested two levels deep (Advanced → Custom design → Open studio). 

### 1.3 Studio opening behaviour
`src/components/admin/specials/SpecialsR41Panels.tsx` `DesignCard` (≈ lines 224–300): `useState(false)` for `open`. Ticking "Use custom design" calls `designFromLegacy(...)` **and** `setOpen(true)`, but on every later page load an already-enabled design starts **collapsed**. Finding A2 — the owner's "if checked, auto open" rule only holds at the moment of ticking. Fix is one line (`useState(!!design?.enabled)`) plus persisting the user's last choice; DesignCard is shared by Specials/Shop/Loyalty/Section editors so the fix propagates.

### 1.4 Pictures — three places to upload
1. Basic `image` (CarouselSlideCard) — the main picture.
2. `adv.imageMobile` "Phone picture" (home-slide-advanced-core.ts:59) — legacy phone art.
3. Studio `design.image.srcMobile` (banner-design-core.ts:259, ImagePanel.tsx:112) — studio phone art; `mobileImageSrc()` (core:580) falls back to the main picture.
Finding A3 — "dual uploading" is real and is actually triple. The studio already supports a **single** picture with independent focus per device (`focusX/Y` + `focusXMobile/YMobile`, `zoom`) — so the owner's wish needs mostly *removal* of UI plus a migration rule, not new rendering.

### 1.5 Canvas (StudioCanvas.tsx, 420 lines)
Has: scaled WYSIWYG at 1408 px / 390 px reference widths; pointer drag with capture; snap to 0/50/100 % (1.5 %, Alt disables); right-edge handle = wrap width only; arrow nudge (Shift = bigger); Delete with confirm; Esc deselect; undo/redo 60 steps (BannerStudio.tsx).
Missing (grep for `onDoubleClick|contentEditable` in `src/components/admin` returns **zero** hits): A4 inline double-click editing; A5 Enter-for-newline on canvas (only the side textarea does it; the model already supports `\n` + `white-space: pre-line`); A6 z-order — render order is fixed: all boxes, then all buttons; A7 rotation; A8 vertical resize / corner handles; A9 multi-select, marquee, group, lock, align/distribute; A10 copy/paste/duplicate-by-Alt-drag; A11 smart guides to other objects and spacing guides.

### 1.6 Data model limits (banner-design-core.ts, 1435 lines)
`MAX_TEXT_BOXES = 8`, `MAX_DESIGN_BUTTONS = 4`, `MAX_BOX_TEXT = 600`. Only two layer kinds (text box, button). No shape, image/sticker, icon, divider, or group type. Effects: 4 shadow presets, a 1-px outline (`-webkit-text-stroke` reusing backdrop colour), 3 backdrops. No gradient fill on text, no stroke width/colour, no multiple shadows, no blend modes, no per-layer opacity on buttons, no rotation/skew, no clip/mask. Finding A12.

### 1.7 Fonts
`src/lib/cms/fonts.ts` lists 14 curated Google fonts, loaded at build time by `src/lib/cms/fonts-loader.ts` (next/font requires module-scope literal calls — file header comment). Basic mode uses a 9-font subset (`HERO_FONTS`). No upload, no variable-axis control, no OpenType features (ligatures, small caps, stylistic sets, tabular figures), no per-character styling. Finding A13.

### 1.8 Upload pipeline we can reuse
`src/lib/media/upload-policy-core.ts` (direct-to-Supabase signed uploads; resumable over 6 MB), `src/lib/media/file-signature-core.ts` (magic-byte sniffing: PNG/JPEG/GIF/WEBP/PDF/MP4/SVG check). Fonts are **not** an allowed kind yet (`UploadKind = "image" | "video" | "document"`). A font upload slice would add `"font"` with WOFF2/WOFF/TTF/OTF signatures.

### 1.9 Earlier roadmaps
Searched R41 bible, R42, R44, R45–R48 for custom fonts, layers, z-index, inline edit, contentEditable, shapes, rotation: **no prior plan exists** — all are new scope for R52. R41 PART 5 explicitly scoped the studio to text boxes + buttons.

### 1.10 Shared-code blast radius (for the "copy to all editors" phase)
`banner-design-core`, `BannerStudio`, `StudioCanvas`, `DesignedBanner`, `DesignCard` are already shared by: ShopBannerEditor, LoyaltyHeroEditor, SectionCard (home sections), Specials presentation editor, and rendered by SectionBanner, ShopBannerCarousel, LoyaltyHeroBanner, SpecialsContent, plus the `/admin/edit` hub Move mode. **Good news: building once in the shared studio upgrades every page**; the per-page work is only the card wrapper (order/collapse/picture rules).
