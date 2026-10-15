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
`banner-design-core`, `BannerStudio`, `StudioCanvas`, `DesignedBanner`, `DesignCard` are already shared by: ShopBannerEditor, LoyaltyHeroEditor, SectionCard (home sections), Specials presentation editor, and rendered by SectionBanner, ShopBannerCarousel, LoyaltyHeroBanner, SpecialsContent, plus the `/admin/edit` hub Move mode. **Good news: building once in the shared studio upgrades every page**; the per-page work is only the card wrapper (order/collapse/picture rules). Verified mount points: `DesignCard` is used by CarouselSlideCard, ShopBannerEditor, LoyaltyHeroEditor, SpecialsPresentationEditor; `SectionCard` mounts `<BannerStudio>` directly (so its open/collapse rule is fixed separately).

## 2. Research log (sources read this round; quotes paraphrased, links in §9)

- **R1 Inline text editing.** `contenteditable="plaintext-only"` lets a user edit text but blocks rich formatting (paste of bold/links/styles). It is Baseline "Newly available" since 2025-03-04 (Chrome 51, Edge 12, Safari 5.1, iOS 5, Firefox 136) [S1]. That exactly fits our model (`text` is a plain string, `\n` = line break, rendered with `white-space: pre-line`): double-click → element becomes `plaintext-only` editable → Enter inserts a newline natively → on blur/Esc we read `innerText` back. No rich-text library is needed for v1. Firefox < 136 fallback: an absolutely positioned `<textarea>` overlay sized to the box (the Konva/Polotno pattern).
- **R2 Loading uploaded fonts.** The CSS Font Loading API `new FontFace(family, source, descriptors)` accepts a URL or an ArrayBuffer and descriptors incl. `weight`, `style`, `display`, `featureSettings`, `variationSettings`, `unicodeRange`, ascent/descent/line-gap overrides; "Baseline widely available since January 2020" [S2]. Editor: load from the storage URL then `document.fonts.add()`. Public site: emit `@font-face` with `font-display: swap` for only the fonts a published banner actually uses.
- **R3 Industry font-upload norms.** Canva accepts OTF, TTF, WOFF; requires the font licence to allow embedding; caps 500 fonts per Brand Kit; upload is a paid-tier feature [S3]. → We accept WOFF2/WOFF/TTF/OTF, ask the uploader to tick "I own a web/embedding licence", and store the licence note with the font.
- **R4 Layer order conventions.** Figma: right-click → Bring forward / Bring to front / Send backward / Send to back; shortcuts Ctrl/⌘+] (forward), ] (front), Ctrl/⌘+[ (backward), [ (back). Also Shift-click multi-select, marquee select, group, align (6 ways), tidy up/distribute, lock (locked objects are skipped by marquee) [S4]. → We copy these names and shortcuts verbatim so the owner's muscle memory transfers.
- **R5 Accessibility of drag.** WCAG 2.2 SC 2.5.7 (AA): anything done by dragging must also be doable with a single pointer without dragging; keyboard alone does not satisfy it; numeric text inputs are an acceptable alternative [S5]. Our X/Y/width number inputs already satisfy this for move; every new drag (rotate, corner-resize, layer reorder in the Layers list) must ship with a click alternative (number field or ▲▼ buttons).
- **R6 Stroke behind fill.** `paint-order` is Baseline widely available since March 2024; in HTML, combine `-webkit-text-stroke-width/-color` with `paint-order: stroke fill` so a thick outline sits *behind* the letters instead of eating into them [S6]. → Real outline controls (width 0–12 px, colour, "outside" mode) become safe; today's 1-px hard-coded outline (A12) can go.
- **R7 Font safety.** The OpenType Sanitizer (OTS) parses and re-serialises OTF/TTF/WOFF/WOFF2 and "is integrated into Chromium and Firefox", because font renderers are attack surface [S7]. Browsers already sanitise every web font, so the risk from an owner-uploaded font is mostly in **our server** (we never parse it server-side) and **licensing**. Server rule: magic-byte check only (`wOF2`, `wOFF`, `\0\1\0\0`, `OTTO`, `true`), size cap 2 MB, served from Supabase Storage with `Content-Type: font/woff2` etc. Never run fonts through Node parsers on the request path.
- **R8 Variable fonts.** One file holds a range of weight/width/slant/optical size; registered axes are `wght wdth slnt ital opsz`, custom axes are UPPER-case (e.g. `GRAD`); prefer `font-weight`/`font-stretch`/`font-style: oblique Ndeg` over `font-variation-settings`; `font-synthesis: none` stops fake bold/italic [S8]. → Weight becomes a 1–1000 slider when the font is variable; "Width" and "Slant" sliders appear only when the font file has those axes (read with the FontFace once loaded, or declared by the uploader).
- **R9 Professional SDK baseline (Polotno, a commercial Canva-style SDK).** Inline on-canvas editing; numeric weight; per-span rich formatting; rotation; curved text; strokes with line-join; shadows; gradient fills; "highlight" backgrounds per line; text-box border; fit modes (grow box / shrink font / ellipsis); RTL; super/subscript; lists [S9]. → This is the feature bar for "top notch". We match most of it with CSS; per-span rich text and curved text are deliberately later phases (§6).
- **R10 Canva/Figma layer naming** (from R3/R4) and Polotno's "unified schema for text, image, shapes" (R9) all point to the same architecture: **one ordered list of layers**, each with a `type`. That is the core recommendation in §4.
