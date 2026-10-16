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
- **R11 Inline-edit precedent.** Konva's official "Editable Text" demo: double-click/double-tap → hide the drawn text → place a styled `<textarea>` exactly over it → Esc cancels, click-outside commits. Konva states canvas cannot edit text natively and lists the overlay's limits: reflow during resize, font metrics changing after a late web-font load, no per-character styling, and **keystrokes must fold into the same undo stack** [S10]. Our canvas is DOM, not `<canvas>`, so we can edit *the real element* with `plaintext-only` (R1) and avoid the reflow/metrics mismatch completely. Note: in Konva's demo plain Enter *commits*; the owner wants Enter = **new line**, so we commit on click-outside / Esc-to-keep / Ctrl+Enter, matching Canva and Figma text boxes.
- **R12 One picture vs. two.** web.dev: `srcset` = suggestions, `<picture>` = commands; use `<picture>` only when you need a genuinely *different crop/content* per screen; one `alt` must describe both [S11]. → The owner's "one upload" default is the industry-recommended default; the studio already crops one picture per device via `object-position` focus + zoom. Keep a hidden "Advanced: different phone picture" escape hatch (off by default) so no existing slide loses its art.
- **R13 Baseline status of every CSS effect we plan to use** (MDN Baseline banners, fetched this round): `clip-path` (shapes) Jan 2020; `mix-blend-mode` Jan 2020; `background-clip: text` (gradient/image-filled text) Jul 2015; `text-shadow` (multi-layer) Jul 2015; `filter` (drop-shadow, blur, hue) Sep 2016; `font-feature-settings` (ligatures, small caps, stylistic sets) Apr 2017; `text-wrap` (balance) Mar 2024; `paint-order` Mar 2024; `FontFace()` Jan 2020; `contenteditable="plaintext-only"` Mar 2025 (newly) [S6, S8, S12]. Every effect in the roadmap renders in all current browsers with **no JS on the public site** — essential for LCP on the hero.
- **R14 Font file identification** — RFC 8081 (the `font/*` media types): TrueType/OpenType start with sfnt version `0x00010000` or `'OTTO'`; WOFF's header signature MUST be `0x774F4646 'wOFF'`; WOFF2's MUST be `0x774F4632 'wOF2'` [S13, S14]. These four signatures become `isFont()` in `file-signature-core.ts`, mirroring the existing `isPng/isWebp` checks. Media types to store: `font/woff2`, `font/woff`, `font/ttf`, `font/otf`.
- **R15 Next.js 16 fonts (read from `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`).** `next/font` self-hosts at **build time** ("no requests are sent to Google by the browser"), and `next/font/local` resolves paths relative to the calling file. Both need the file present at build. **Owner-uploaded fonts therefore cannot use `next/font`** — they arrive after deploy. Correct approach: a server-rendered `<style>` with `@font-face` rules emitted only for the custom fonts the page's published designs actually reference, plus `<link rel="preload" as="font" crossorigin>` for the hero's first slide only. The repo sets **no CSP header** today (grep for `font-src` found nothing), so Supabase-hosted fonts are not blocked; if a CSP is added later it must include the Storage origin in `font-src`.

---

## 3. Gap matrix — Greenway Banner Studio vs. professional editors

Legend: ✅ have · 🟡 partial · ❌ missing. Pro column = what Canva / Figma / Polotno document (§2).

| Capability | Greenway today | Pro tools | Owner asked |
|---|---|---|---|
| Studio first & open | ❌ buried under Advanced, collapsed (A1, A2) | — | ✅ yes |
| Basic mode collapsed below studio | ❌ | — | ✅ yes |
| One picture for both devices | 🟡 core supports it; UI shows 3 uploads (A3) | `<picture>` only for real art direction (R12) | ✅ yes |
| Double-click to edit on canvas | ❌ (A4) | ✅ all (R9, R11) | ✅ yes |
| Enter = new line on canvas | ❌ (A5); model already supports `\n` | ✅ | ✅ yes |
| Shapes / simple elements | ❌ (A12) | ✅ rect, ellipse, line, polygon, star, arrow, icon | ✅ yes |
| Fill / border / radius / shadow on elements | ❌ | ✅ | ✅ yes |
| Layer order (front/back) | ❌ fixed order (A6) | ✅ 4 commands + ] [ shortcuts (R4) | ✅ yes |
| Upload own fonts | ❌ (A13) | ✅ OTF/TTF/WOFF, licence check (R3) | ✅ yes |
| Variable-font axes, OpenType features | ❌ | ✅ numeric weight (R9), axes (R8) | ✅ "more font features" |
| Text effects: stroke width, gradient fill, multi-shadow, glow, highlight, curved | 🟡 4 shadow presets, 1-px outline | ✅ (R9) | ✅ "font effects" |
| Rotation / flip of objects | ❌ (A7) | ✅ | implied |
| Corner resize, height | ❌ (A8) | ✅ | implied |
| Multi-select, group, lock, align, distribute | ❌ (A9) | ✅ (R4) | implied "expert tools" |
| Copy/paste, duplicate, Alt-drag | 🟡 duplicate button only (A10) | ✅ | implied |
| Smart guides to other objects | 🟡 frame 0/50/100 only (A11) | ✅ | implied |
| Layers panel (names, eye, lock, drag-to-reorder) | ❌ | ✅ | implied |
| Undo/redo | ✅ 60 steps | ✅ | — |
| Per-device positions | ✅ desktop + phone overrides | ✅ (responsive variants) | — |
| Contrast / accessibility checks | ✅ WCAG warnings | 🟡 rare | — (our edge) |
| AI placement suggestion | ✅ | 🟡 | — (our edge) |
| Video backgrounds | ✅ (R44) | ✅ | — |
| Blend modes / image filters on objects | 🟡 picture only | ✅ | implied |
| Rich text inside one box (bold one word) | ❌ | ✅ Polotno per-span (R9) | implied |

**Read-out:** the foundations (per-device geometry, container-query scaling, undo, contrast checks, AI, safe-URL normalisation) are already better than many SaaS editors. The gaps are about *object types*, *layering* and *direct manipulation*, which is exactly what the owner listed.

---

## 4. Architecture recommendation (the core of the plan)

### 4.1 One ordered `layers[]` list — Banner Design **v2**
Today: `boxes[]` (≤8) then `buttons[]` (≤4) — two lists, so "in front / behind" is impossible across types. Recommendation (Figma/Canva/Polotno all do this — R4, R9, R10):

```ts
type LayerBase = {
  id: string; name: string;               // shown in the Layers panel
  type: "text" | "button" | "shape" | "image" | "icon" | "group";
  x: number; y: number; w: number; h?: number;      // % of frame (h optional for text = auto)
  mx?: number; my?: number; mw?: number; mh?: number; // phone overrides (existing pattern)
  rotate: number;  rotateMobile?: number;           // degrees
  opacity: number; blend: BlendMode;                // mix-blend-mode (R13)
  locked: boolean; hidden: boolean; hideOnMobile: boolean;
  groupId?: string;
};
// Array order IS the z-order: index 0 = back, last = front (Figma's model).
design.layers: Layer[]   // cap 40 (perf-tested), replaces boxes/buttons
```

- **Text layer** = today's `DesignTextBox` fields + new: `strokeWidth`, `strokeColor`, `strokeMode: "outside"|"center"` (paint-order, R6); `fill: {kind:"solid"|"linear"|"radial", stops[], angle}` (background-clip:text, R13); `shadows: Shadow[]` (≤4 layered text-shadows, incl. glow/neon/long-shadow presets); `highlight` (per-line box-decoration-break pill); `features: {liga, dlig, smcp, onum, tnum, ss01…ss20, swsh}` (font-feature-settings, R13); `axes: Record<tag, number>` (R8); `fitMode: "grow"|"shrink"|"fixed"` (R9); `textVAlign`; `curve` (later, SVG textPath).
- **Shape layer** = `shape: "rect"|"ellipse"|"line"|"triangle"|"polygon"|"star"|"arrow"|"blob"`, `sides`, `fill` (solid/gradient/none), `border {width, color, style: solid|dashed|dotted, radius}`, `shadow` (box-shadow or `filter: drop-shadow` for non-rect clip-paths), `blur` (backdrop-filter "glass" card). Render: plain `<div>` + `clip-path: polygon()` / `border-radius` — zero JS, Baseline 2020 (R13). Lines and stars render as inline SVG.
- **Image/sticker layer** = a second picture (logo, product cut-out, badge PNG/WebP/SVG-sanitised) from the Media Library, with fit, radius, border, drop-shadow, flip, filters.
- **Icon layer** = curated icon set (note: `package.json` has **no** icon library today — verified; adding one such as lucide-react, ISC-licensed, is a P5 dependency decision for the owner) rendered as inline SVG with fill/stroke colour.
- **Button layer** = today's `DesignButton` + rotation/opacity/z-order.
- **Group** = `{type:"group", children ids}`; moving a group moves members; Layers panel shows it as a folder.

### 4.2 Back-compat (no data loss, no migration needed)
`normalizeDesign()` already returns a canonical object from any jsonb. v2 adds **`version: 2`**; when it reads a v1 object it builds `layers = [...boxes.map(toTextLayer), ...buttons.map(toButtonLayer)]` — which **reproduces today's exact paint order**, so every live banner looks identical. `DesignedBanner` renders v2 only; v1 → v2 is done in memory. Jsonb columns (`draft_advanced`, `advanced`, the shop/loyalty/section/specials equivalents) need **no SQL migration**. Byte-identical test pins (pattern from R42: "no srcMobile key unless set") extend to "v1 in → identical render tree out".

### 4.3 Custom fonts
- **Table** `custom_fonts` (migration, idempotent, owner-applied): `id, family, file_path, format, weight_range, style, is_variable, axes jsonb, licence_note, uploaded_by, created_at, archived`.
- **Upload** reuses the R44 direct-to-Storage pipeline (`upload-policy-core`): new `UploadKind "font"`, cap 2 MB, `isFont()` magic-byte check (R14), extension allow-list `.woff2 .woff .ttf .otf`, licence-confirmation checkbox (Canva norm, R3). Recommend owners upload WOFF2 (smallest); optional later: server-side TTF→WOFF2 conversion in a background job, never on the request path (R7).
- **Editor**: `FontFace(family, url)` → `document.fonts.add()` (R2); show a live sample, detected weight range, and axes.
- **Public site**: `@font-face { font-display: swap }` emitted server-side only for fonts used on that page; preload only for the first hero slide (protects LCP, which R45–R48 already optimised with `fetchPriority`).
- **Font picker**: grouped "Your fonts / Greenway curated / System", search, live preview of the actual text, recent fonts, and **Brand fonts** (owner pins heading/body fonts once → one-click on every banner).
- **Curated library growth**: add more `next/font/google` families (they cost nothing at runtime unless used, because next/font only emits CSS for imported fonts — but each still adds build-time downloads; keep ≤ 40).

### 4.4 Inline editing
DOM-native: double-click (or Enter on a selected text layer, or F2) → the rendered element gets `contenteditable="plaintext-only"`, `spellcheck`, caret at click point, selection outline changes to "editing" colour; **Enter inserts a newline**, Shift+Enter too; **Esc or click-outside commits** (Esc commits — Figma behaviour — and Ctrl+Z reverts); on commit read `innerText`, clamp to `MAX_BOX_TEXT`, push **one** undo step (R11 warning). Bound boxes (eyebrow/title/subtitle bound to basic fields) write through to the basic field so the two stay in sync. Fallback for very old Firefox: textarea overlay (R11). Accessibility: `role="textbox" aria-multiline="true"` while editing; the side-panel textarea remains as the WCAG 2.5.7 non-drag alternative (R5).

### 4.5 Canvas interaction model (expert tools)
Transformer with 8 handles + rotation knob (Shift = 15° snaps; Alt = from centre; Shift on corner = keep ratio); marquee + Shift-click multi-select; Ctrl/⌘+G group, Ctrl/⌘+Shift+G ungroup; lock (Ctrl/⌘+Shift+L); copy/paste/duplicate (Ctrl/⌘+C/V/D), Alt-drag duplicate; **z-order: Ctrl/⌘+] / [ and ] / [** (Figma, R4) plus right-click menu with the same four words; align (left/centre/right/top/middle/bottom) to frame or to selection; distribute horizontally/vertically; smart guides to every other layer's edges/centres with equal-spacing indicators; rulers + optional 12-column grid and safe-area overlay (phone notch, carousel arrows/dots area); zoom 25–400 % & fit; nudge 1 % / Shift 5 % (existing). Each drag action keeps a numeric field equivalent (WCAG 2.5.7, R5).

### 4.6 UI restructure of the slide card (owner's items 1–4, 9)
```
┌ Slide 3 ─ [Live ●] [Unsaved]                         [Save draft] [Publish] ┐
│ 🎨 Custom Design Studio  (open by default; ☑ Use custom design = checked)   │
│   ┌ Picture (ONE upload: computer + phone) · alt text · focus per device ┐ │
│   ├ Toolbar: + Text ▾ | + Shape ▾ | + Image | + Icon | + Button | Fonts │ │
│   ├ Canvas (Computer | Phone) — double-click text to type                │ │
│   └ Right rail tabs: Selected · Layers · Picture & shade · Checks       ┘ │
│ ▸ Basic mode (words, buttons, line styles)      — collapsed, click to open │
│ ▸ Schedule & visibility (start/end, enabled)    — collapsed, shows summary │
│ ▸ Advanced: different phone picture (rare)      — collapsed, off           │
└──────────────────────────────────────────────────────────────────────────┘
```
Rules: studio `open` initialises to `design?.enabled ?? true` for new slides and is *remembered per slide* in `localStorage`; ticking "Use custom design" always opens it (owner item 8); unticking keeps data (reversible) but shows the basic render; the schedule (currently inside Advanced — `home-slide-advanced-core.ts:68`) moves to its own always-reachable row so collapsing Basic never hides it.

---

## 5. Single-picture plan (owner item 3) in detail
1. Studio "Picture" panel shows **one** `ContentImageField` bound to the slide's main `image` (video allowed, R44).
2. Under it: "Focus — computer" and "Focus — phone" pickers (already exist: `focusX/Y`, `focusXMobile/YMobile`) + zoom per device (add `zoomMobile`).
3. `adv.imageMobile` and `design.image.srcMobile` stop being *offered*; existing values keep rendering (no silent change to live slides). A one-time notice on affected slides: "This slide still uses a separate phone picture. [Use main picture for both] [Keep]".
4. Public render: one `<img>`/`BannerMedia` element (not two toggled by CSS), so the markup is simpler. (Verified: DesignedBanner.tsx:96–115 only renders the two CSS-toggled media elements *when* a phone picture exists, and both are lazy so browsers skip the hidden one — R42 Q4 comment. So this is a simplification win, not a bandwidth fix.)

---

## 6. Phased roadmap (each slice = branch → PR → rebase-merge; pure cores with `__run…Tests()`)

| Phase | Slice | What ships | Risk | Value | Size |
|---|---|---|---|---|---|
| **P1 "Owner's quick wins"** | R53-1 | Card restructure §4.6; studio open by default & auto-open on tick; Basic collapsed; schedule row | Low | ★★★★★ | S |
| | R53-2 | Single-picture UI §5 (+ `zoomMobile`, notice for legacy phone pictures, one media element) | Low-Med | ★★★★★ | S-M |
| | R53-3 | Inline double-click editing §4.4 (Enter = newline, one undo step, bound-field sync) | Med | ★★★★★ | M |
| **P2 "Layers"** | R54-1 | Design v2 `layers[]` + normaliser + render parity tests (v1 ≡ v2 pixels via snapshot of style objects) | Med-High | ★★★★★ | L |
| | R54-2 | Layers panel (names, eye, lock, ▲▼ + drag reorder), z-order commands & shortcuts, right-click menu | Med | ★★★★★ | M |
| | R54-3 | Shapes: rect/ellipse/line/triangle/polygon/star/arrow; fill (solid/gradient), border, radius, shadow, opacity, blend, glass blur | Med | ★★★★★ | M |
| **P3 "Typography"** | R55-1 | Custom font upload (migration `custom_fonts`, `isFont`, Storage, licence tick, FontFace preview, server `@font-face`) | Med | ★★★★★ | M-L |
| | R55-2 | Font picker v2 (search, groups, live preview, brand fonts) + 10–20 more curated families | Low | ★★★★ | M |
| | R55-3 | Text effects: stroke width/colour/outside, gradient & image fill, multi-shadow builder + presets (neon, long shadow, 3-D, retro), highlight, OpenType features, variable axes, fit modes | Med | ★★★★★ | M-L |
| **P4 "Direct manipulation"** | R56-1 | Transformer: 8 handles, height, rotation, aspect lock | Med | ★★★★ | M |
| | R56-2 | Multi-select, marquee, group/ungroup, lock, copy/paste/duplicate, Alt-drag | Med | ★★★★ | M |
| | R56-3 | Smart guides, equal-spacing, align/distribute, rulers/grid/safe-area, canvas zoom | Low-Med | ★★★★ | M |
| **P5 "Assets"** | R57-1 | Image/sticker layers, icon layers, SVG sanitising (reuse `file-signature-core` SVG check) | Med | ★★★★ | M |
| | R57-2 | Saved styles ("Text styles", "Shape styles"), reusable **components/templates** across slides & pages, brand colour palette | Low | ★★★★ | M |
| **P6 "Rollout"** | R58 | Apply card pattern to ShopBannerEditor, LoyaltyHeroEditor, SpecialsPresentationEditor, SectionCard; lift limits per page | Low (shared code) | ★★★★★ | M |
| **P7 "Stretch"** | R59 | Per-word rich text (spans), curved text (SVG textPath), entrance animations (respecting `prefers-reduced-motion`), A/B variants fed by R47 click analytics | High | ★★★ | L |

Order rationale: P1 delivers every *explicit* owner ask that doesn't need a data-model change, inside one or two rounds. P2 must precede shapes/z-order because layering across types is impossible with two separate arrays. Fonts (P3) are independent of P2 and can run in parallel if desired.

**Performance guard-rails (all phases):** public banner stays pure CSS/HTML (no editor JS shipped to visitors); ≤ 40 layers; custom fonts preloaded only for slide 1; shapes via CSS, not images; a `checkDesign` warning when a slide uses > 3 font families or > 2 custom fonts (each is a download).

**Compliance guard-rails:** Washington WAC 314-55-155 checks already in `checkDesign` (e.g. `LEGAL_TOO_SMALL`, banner-design-core.ts:1093) and the publish-time lint planned in R44 roadmap #3 (not located in code this round — verify before relying on it) must run over **all** text layers (incl. new ones) and over alt text of sticker images; contrast checks extend to text-over-shape (compute against the shape's fill when a text layer sits above a shape in z-order).

---

## 7. Testing & safety plan
- Pure cores: `banner-layers-core.ts` (v1→v2, z-order ops, group math, align/distribute), `font-registry-core.ts` (signature, family-name sanitising, `@font-face` string building with CSS-escaping), `text-effects-core.ts` (shadow/stroke/gradient → style object), each with `__run…Tests()` registered in `scripts/compliance/run-pure-selftests.ts`.
- Pins: "v1 design renders identical style objects after v2", "no new keys unless set" (byte-identical jsonb, R42 precedent), "unsafe font URL dropped", "font family name cannot inject CSS (`}` `;` `"` stripped)".
- Manual QA script per slice for the owner (desktop + phone, keyboard-only pass).

---

## 8. Expert opinion

1. **Don't buy a canvas SDK; evolve ours.** Polotno/Konva are `<canvas>` engines: their output is a picture or must be re-exported to HTML (Konva notes export-fidelity and text-reflow problems, R11). Our banner must be live, indexable, accessible HTML with an `<h1>`, real links, container-query scaling and WCAG checks — which our DOM studio already does. Every effect the owner wants exists in Baseline CSS (R13). Building on the DOM keeps the hero fast and SEO-safe and keeps one renderer for editor and site (true WYSIWYG).
2. **The single most important change is `layers[]` (P2).** It unlocks z-order, shapes, stickers, icons, groups and future types with one model. Do it once, carefully, with parity tests, and every later feature becomes small.
3. **Ship P1 first and fast.** The four UI asks (studio first/open, basic collapsed, one picture, auto-open) plus inline editing are low risk and change the daily experience most.
4. **Custom fonts: WOFF2 + licence tick + browser-side sanitising is the professional standard** (Canva requires embedding rights; browsers run OTS on every web font — R3, R7). Never parse font files on our server request path.
5. **Keep the guard-rails as a differentiator.** Contrast warnings, WAC lint, AI placement and per-device geometry are things Canva doesn't do for a cannabis retailer's website. "No limits" in creativity should still mean "can't accidentally publish something illegible or non-compliant".
6. **Copy-to-all is cheap by design.** Because DesignCard/BannerStudio/DesignedBanner are shared (§1.10), P2–P5 automatically upgrade Shop, Loyalty, Specials and Section banners; P6 is mostly the card layout.

---

## 9. Sources (fetched this round)
- [S1] Web Platform DX — contenteditable="plaintext-only" (Baseline newly available 2025-03-04): https://web-platform-dx.github.io/web-features-explorer/features/contenteditable-plaintextonly
- [S2] MDN — FontFace() constructor: https://developer.mozilla.org/en-US/docs/Web/API/FontFace/FontFace
- [S3] Canva Help — Upload formats and requirements (fonts: OTF/TTF/WOFF, embedding licence, 500 per Brand Kit): https://www.canva.com/help/upload-formats-requirements
- [S4] Figma Learn — Select, move, and order objects (bring forward/front, send backward/back, shortcuts, group, align, lock): https://help.figma.com/hc/en-us/articles/1500004292221-Select-move-and-order-objects-in-FigJam
- [S5] W3C WAI — Understanding SC 2.5.7 Dragging Movements: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- [S6] MDN — paint-order: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/paint-order
- [S7] OpenType Sanitizer (OTS), GitHub: https://github.com/khaledhosny/ots
- [S8] MDN — Variable fonts guide: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Fonts/Variable_fonts
- [S9] Polotno SDK — Text editing features: https://polotno.com/sdk/product/features/text-editing
- [S10] Konva — Editable Text demo and limits: https://konvajs.org/docs/sandbox/Editable_Text.html
- [S11] web.dev — The picture element: https://web.dev/learn/design/picture-element
- [S12] MDN Baseline pages: clip-path, mix-blend-mode, background-clip, text-wrap, font-feature-settings, filter, text-shadow — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/{name}
- [S13] IETF RFC 8081 — The "font" Top-Level Media Type: https://www.rfc-editor.org/rfc/rfc8081
- [S14] W3C — WOFF File Format 2.0 (signature 0x774F4632 'wOF2'): https://www.w3.org/TR/WOFF2/
- Repo: `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md` (Next.js 16 font docs); prior roadmaps R41, R42, R44, R45–R48.

---

## 10. R53 addendum — owner asks of R53, what shipped, and the updated roadmap

### 10.1 Owner asks (R53 message, summarised) → status
| # | Ask | Status after R53 |
|---|-----|------------------|
| 1 | One picture per banner; dropping old phone pictures is fine | **Shipped (Slice 1).** `normalizeDesign` drops `image.srcMobile`; `normalizeHomeSlideAdvanced` drops `imageMobile`. Both pickers removed. Old phone pictures disappear the next time a draft is saved (the live value is normalized on read too). Re-attach is not needed: phones use the main picture. |
| 2 | Studio first + open; basic mode under it, collapsed | **Shipped (Slice 1)**, home carousel. The studio opens by default (`DesignCard` `open=true`). Basic mode is a native `<details>`, so closed fields still post with the form. |
| 3 | Undo / Redo button | **Already existed** (R41: `BannerStudio.tsx` ↶ Undo / ↷ Redo, 60 steps, Ctrl/⌘+Z, Ctrl+Shift+Z / Ctrl+Y). R53: shortcuts ignore keys typed while editing text on the canvas. |
| 4 | Arrow keys move the selected object | **Fixed (Slice 1).** Arrow nudge existed, but `startDrag` called `preventDefault()` on pointerdown, which blocks focus-on-click, so arrows only worked after Tab. The item now focuses itself on click. |
| 5 | Double-click to type, Enter = new line | **Shipped (Slice 2).** `contenteditable="plaintext-only"` [S1]; Esc or click-away commits as one change. Eyebrow/title/description boxes write the slide's own fields. |
| 6 | Enterprise icon library | **Installed:** `@phosphor-icons/react@2.1.10` (MIT, 9,000+ icons, 6 weights) [S15][S16]. Not used in the UI yet; the icon layer is R57. |
| 7 | More libraries (fonts, objects, elements) | Researched below (§10.2). |
| 8 | Scheduler: end date, weekly repeat, fallback banner, calendar + same-day warning | End date **already exists** (`scheduleEnd`, now in its own 🗓️ Schedule box at the top level). The rest is planned in §10.3 (new phase R55-S). |
| 9 | Reports: compare banners by clicks | Planned in §10.4 (phase R57-R). The R47 click table and page already exist. |
| 10 | One editor, one rule set for every banner | Planned in §10.5 (phase R58, made explicit). |

### 10.2 Library research (verified with `npm view` this round; licences are all commercial-use OK)
| Need | Pick | Version / licence | Why / notes |
|------|------|-------------------|-------------|
| Icons (UI + banner icon layer) | **@phosphor-icons/react** ✅ installed | 2.1.10 / MIT | 9,000+ icons in thin/light/regular/bold/fill/duotone, so one icon can match any banner weight [S15]. The Next 16 local docs say to import per icon path (`@phosphor-icons/react/dist/csr/Triangle`) to keep builds fast (`node_modules/next/dist/docs/01-app/02-guides/local-development.md` §icons). |
| Icons, alternatives | lucide-react / @tabler/icons-react | 1.57.0 ISC / 3.49.0 MIT | Lucide has 1,800+ outline icons and is on Next's `optimizePackageImports` list. Tabler has 6,200+ outline + filled icons [S15]. Not installed, so we keep one set. |
| Brand logos (Instagram, Google…) | simple-icons | 16.35.0 / CC0-1.0 | Phosphor has few brand marks. Logos stay subject to each brand's trademark rules. |
| "Everything" icon search (200k+ icons across sets) | @iconify/react + @iconify/json | 6.0.2 MIT / 2.2.543 MIT | **Do not bundle** (the JSON is very large). Only consider it later as an admin-side search that copies the picked SVG into the design. Each set inside has its own licence, which must be shown per icon. |
| Fonts library | **Fontsource** (`@fontsource/*`, `@fontsource-variable/*`) | e.g. inter 5.3.0 / OFL-1.1 | Self-hosted npm packages of the Google Fonts catalogue, no third-party requests [S17]. Next's own `next/font/google` also self-hosts at build time. The site already uses it, so new **curated** fonts are cheapest added there. Owner-uploaded fonts stay as R55 (FontFace + `@font-face`). |
| Shapes / elements | **Built in-house** (pure SVG/CSS) | — | Rectangle, rounded box, circle, pill, line/divider, badge/starburst, arrow, ribbon. These are simple SVG paths stored in the design JSON (R54), so there is no dependency and no licence risk. Canvas frameworks (Konva, Polotno) were rejected in R52 §5 [S9][S10]. |
| Calendar view | Build a light month grid in-house; fall back to react-big-calendar | — / 1.20.0 MIT | A month grid of chips is ~150 lines and fits the admin style. Take react-big-calendar only if week/day views are wanted. |
| Repeat rules | `rrule` (iCalendar RFC 5545) — **optional** | 2.8.1 / BSD-3-Clause | Owner asks are covered by a tiny pure core (days-of-week + daily time window). Only add rrule if "2nd Tuesday of the month"-style rules are wanted. |

### 10.3 Scheduler v2 (new phase **R55-S**, one slice; pure core + UI, no SQL — lives in the `advanced` JSON)
- **Model** (`schedule-core.ts`, pure + self-tests): `{ start, end, repeat: { days: ("mon"…"sun")[], from?: "HH:MM", to?: "HH:MM" } | null, tz: "America/Los_Angeles" }`. `isLiveAt(now)` = inside start–end **and** (no repeat **or** today's weekday is in `days` and the time is inside from–to). For example: every Wednesday, 7am–11pm.
- **Fallback banner:** each banner area gets one slide marked `fallback: true`. It shows **only when no other slide is live**, so an expired banner can never leave the carousel empty. The editor warns "No fallback banner set" when none exists.
- **Calendar:** a 6-week month grid on the carousel admin page with one coloured chip per slide on each live day. A ⚠️ badge shows on any day where 2+ scheduled slides **start** (and a softer note where 2+ overlap). Clicking a chip scrolls to that slide's card.
- **Reused by every banner area** through the R58 universal editor (§10.5).

### 10.4 Reports: banner comparison (new phase **R57-R**, one slice)
- The data already exists: `website_click_events` (migration 0268) and `src/app/admin/reports/website/page.tsx` (R47-S2), which lists clicks per banner and button.
- **Add:** a "Compare banners" table with one row per slide: total clicks, clicks per day live (fair across different schedule lengths), the top button, and a trend arrow against the previous period. A ⭐ marks the best performer.
- **Needed for click-through rate:** impressions (slide shown) are **not** recorded today. One option is an optional, privacy-safe `slide_view` event (same no-cookie/GPC rules as clicks) with a small idempotent migration. Without it, the report compares clicks per live-day, which is still fair.

### 10.5 One universal banner editor (phase **R58**, made explicit)
- **Goal (owner):** "one design, one set of tools and rules … for any and all banner editors". It covers home carousel, shop carousel, loyalty hero, specials, page top-hero banners and lower section banners.
- **How:** extract the R53 home card layout into `<UniversalBannerEditor area=… />`. It contains, in order: picture + alt → Design Studio (open) → Schedule v2 → Basic mode (`<details>`, collapsed) → Save/Publish.
  - Each area supplies only a small **adapter**: load/save functions, the area's preset (hero/section), and its legacy fields.
  - All rules stay in the shared pure cores (`banner-design-core`, `schedule-core`, the WAC/contrast checks). So a new rule or tool lands everywhere at once.
- **Order:** home carousel (done first, R53) → shop carousel → loyalty hero → specials → page heroes → section banners. Each move is a small, mostly delete-heavy slice, since the bespoke editors go away.
- **Single-picture rule** (R53) now applies to every area the same way. ShopBannerEditor and LoyaltyHeroEditor still have their own legacy `imageMobile` fields, which are removed when each area moves onto the universal editor.

### 10.6 Updated phase order
R53 ✅ (studio-first card, single picture, arrow-key fix, inline typing, icon library) → **R54** layers v2 + shapes → **R55** fonts/effects + **R55-S** scheduler v2 → **R56** transform/multi-select → **R57** assets/icons (Phosphor picker) + **R57-R** banner comparison report → **R58** universal editor rollout → R59 stretch.

### 10.7 R53 sources
- [S15] allsvgicons.com — Best free SVG icon libraries 2026 (counts, licences): https://allsvgicons.com/blog/best-free-svg-icon-libraries-2026
- [S16] npm — @phosphor-icons/react (import-performance note): https://www.npmjs.com/package/@phosphor-icons/react
- [S17] GitHub — fontsource/fontsource ("Self-host Open Source fonts in neatly bundled NPM packages"): https://github.com/fontsource/fontsource
- `npm view` (this round): @phosphor-icons/react 2.1.10 MIT; lucide-react 1.57.0 ISC; @tabler/icons-react 3.49.0 MIT; simple-icons 16.35.0 CC0-1.0; @iconify/react 6.0.2 MIT; @iconify/json 2.2.543 MIT; @fontsource-variable/inter 5.3.0 OFL-1.1; react-big-calendar 1.20.0 MIT; rrule 2.8.1 BSD-3-Clause.
- Repo: `node_modules/next/dist/docs/01-app/02-guides/local-development.md` (icon import guidance); `.../optimizePackageImports.md` (lucide-react listed).

---

## 11. R54 — what shipped

### 11.1 Slice A — automatic web-format conversion at upload (owner's new ask)
**Research finding (not a guess):**
- **SVG is the wrong target for photos.** SVG is a vector format for logos and icons; a photo inside an SVG is still the same pixels. Raster banners belong in WebP/AVIF.
- **Delivery was already professional.** `next.config.ts` `images.formats: ["image/avif","image/webp"]` (R45-S2) makes next/image serve AVIF (or WebP) at the right width per device.
- **What was missing was a web-ready master.** Uploads stored originals up to 50 MB. Vercel only optimises jpeg/png/webp/avif sources of at most **8192 px per side**, with a 10 MB maximum transformed output [S18]. Huge masters also make every cache-miss transform slower.

**Shipped (`image-optimize-core.ts` pure + `image-optimize-server.ts` sharp):**
- On upload, JPEG/PNG (and big WebP) are converted to **WebP**, longest side **≤ 3840 px**. 3840 is the largest default next/image `deviceSize` (Next 16 `image.md`), so 4K/retina stays sharp.
- Processing: EXIF-rotated, metadata stripped. Quality is 82 for photos and 90 for PNG graphics.
- **Kept as-is:** GIF (may be animated) and SVG (vector).
- **Safety rules:**
  - An optimised copy is kept only if it is smaller (or had to shrink).
  - `limitInputPixels` guards against decompression bombs.
  - Any failure keeps the original, so an upload is never blocked.
- **Wired in two places:**
  1. Media Library drag-and-drop (direct-to-Storage path, `finishDirectUploadAction`). It replaces the object with a `.webp` key and the dropzone shows the saving ("12.0 MB → 640 KB WebP (95% smaller)").
  2. `uploadMedia()`, the shared server path used by blog/products/vendors/AI images and others. Opt-out: `optimize:false`.
- **Not converted:** files uploaded before R54. They still get AVIF/WebP at delivery through next/image, and re-uploading one makes a web master. A one-click "optimise existing library" batch is a candidate later slice.

### 11.2 Slice B — Schedule v2 (R55-S pulled forward)
- **`banner-schedule-core.ts`** (pure, shared by every banner area for R58):
  - start/end
  - **repeat on weekdays**
  - optional **daily window** (wraps midnight; the early hours belong to the previous day's run)
  - all read in **store time, America/Los_Angeles**, because Vercel servers run in UTC
- **Fallback slide:** shows only when no regular slide is live, and its own schedule is ignored. Applied on the homepage (`carousel-store`) and in Reports' live-slot list.
- **Calendar** (Carousel tab, server-rendered, no JS):
  - this month and next, built from published slides
  - coloured chips that link to each slide, with ▶ on start days
  - **⚠️ on days where 2+ slides start** (the panel auto-opens when there's a clash)
  - a warning when no fallback is set
- **Storage:** the new fields live in the advanced JSON (`scheduleDays`, `scheduleFrom`, `scheduleTo`, `fallback`). No migration. They are only written when used, so older slides serialize byte-identically.

### 11.3 Next
R55 fonts/effects → R54 layers v2 + shapes (deferred from R54) → R56 → R57 + reports compare → R58 universal rollout.

- [S18] Vercel — Limits and Pricing for Image Optimization (8192 px source cap, 10 MB output, formats): https://vercel.com/docs/image-optimization/limits-and-pricing
- [S19] sharp — Output options (webp quality/effort): https://sharp.pixelplumbing.com/api-output

## 12. R55 — what shipped (4 slices)

### 12.1 S1: banner comparison in Reports → Website clicks
- **Where:** a new "Banner comparison" section under "Clicks per day", with one table per placement (homepage carousel, shop, specials …).
- **What each table shows:** share-of-clicks bar, clicks, clicks per day, change vs the previous period of equal length, phone %, top button, and live/off status.
- **⭐ leader:** only awarded with ≥ 5 clicks and a clear lead. Otherwise the table says "too early to call", "tied", or "only one banner".
- **Honesty note:** we record clicks, not impressions, so this is **share of clicks, not CTR**, and the page says so.
- **Code:** `banner-compare-core.ts` (22 self-tests); `readClicksSince(since, until)` reads the previous window.

### 12.2 S2: shapes + Layers v2
- **Shapes:** 8 kinds (rect, circle, line, triangle, star, burst, arrow, diamond).
  - Each has fill, fill strength, stroke, corner radius, rotation, opacity and its own phone position/size.
  - Shapes are decorative (`aria-hidden`, no pointer events).
- **Layers panel:** front-to-back list with bring-forward/back/to-front/to-back, show/hide, lock, and reset order.
  - Order is painted with z-index only. DOM/reading order stays shapes → text → buttons (WCAG 1.3.2).
  - Locked items can't be dragged or nudged; they can still be edited in the panel.
- **Code:** `banner-elements-core.ts` (36 self-tests). `elements` and `order` are written only when used.

### 12.3 S3: icon layers
- **Icons:** 45 curated Phosphor icons (MIT), each in 3 weights, with a searchable picker.
- **No icon library on the public site:** the SVG path is copied into the design, and the path data is validated (SVG path commands only, ≤ 4000 chars).
- **Code:** generated by `scripts/gen-banner-icons.tsx` into `banner-icons-data.ts`, which is admin-only.

### 12.4 S4: fonts + text effects
- **12 new faces** via next/font: Archivo Black, Alfa Slab One, Abril Fatface, Bungee, Bangers, Righteous, Rubik Mono One, Shrikhand, Lobster, Satisfy, Caveat, Permanent Marker.
  - Self-hosted, `display: swap`, **`preload: false`**: pages that don't use them don't download them.
  - The picker is grouped by vibe (Clean sans, Bold display, Serif, Script, Mono).
- **Sticker outline:** 0–8 px plus a colour. It uses `paint-order: stroke fill`, so thick outlines sit behind the letters instead of eating into them.
- **Gradient letters:** two colours plus a direction.
  - The solid colour stays as the fallback.
  - Shadows switch to `filter: drop-shadow`, because a text-shadow would paint over clipped-background text.
  - Gradients are disabled while a backdrop box is on.
- **New shadows:** 3D (hard offset) and Neon (follows the letter or gradient colour).
- **Compatibility:** all new fields are written only when used, so existing designs are byte-identical.

### 12.5 Left to build
- **R56:**
  - free transform (rotate handles on canvas)
  - multi-select / group move
  - align & distribute
  - Draft Mode in-page move for shapes (`parseMoveMessage` only takes box/button today)
- **R57:**
  - custom font upload (licence check and woff2 subset)
  - curved text
  - impressions event, for true CTR / A-B testing in the comparison report
- **R58 universal editor rollout:** shop/loyalty/specials/page heroes and home sections all use the Studio.
- **Media library:** bulk re-optimize existing uploads to WebP masters.

## 13. R56 — what shipped (4 slices)

### 13.1 S1: any colour on every object
- **Colour field:** accepts #hex, rgb(), hsl() or CSS colour names, plus an eyedropper (where the browser supports it). A "Your colours" row remembers recent picks.
- **Brand palette:** brand swatches are still offered first, but are no longer the only choice.
- **Shapes and icons:** gradient fill (two colours plus a direction) and a soft drop shadow in any colour. The drop-shadow follows the real outline of stars and icons.
- **Code:** `color-input-core.ts` (16 self-tests); `banner-elements-core.ts` (45 self-tests).

### 13.2 S2: upload any font you own
- **Formats:** .woff2, .woff, .ttf, .otf, up to 25 MB. There's an advisory note above 1 MB, but it never blocks.
- **Licence:** one checkbox, "I'm allowed to use this font". Who confirmed it and when are recorded on the media row (`license_status = owner-attested`) and in the audit log.
- **Server checks:** the server sniffs the file's real bytes (wOF2 / wOFF / OTTO / TrueType; font collections are refused) before accepting it. On failure the file is removed.
- **Serving:** files are served same-origin via the `/gw-fonts/*` rewrite, which avoids font CORS. `@font-face` uses `font-display: swap`.
- **Where fonts appear:** "Your fonts" in every Studio font picker and in the site heading/body font pickers. The public banner only loads the fonts that design uses (React 19 hoisted, deduped `<style>`).
- **Storage:** no migration. Fonts reuse `media_assets` (`usage_type = font`).
- **Code:** `custom-font-core.ts` (19 self-tests).

### 13.3 S3: direct manipulation
- **Rotate:** a gold rotate knob on text, buttons and shapes (Shift = 15° steps).
- **Groups:** Shift/Ctrl-click builds a group, which you can drag, nudge or delete together. Locked items stay put.
- **Arrange bar:**
  - align left/centre/right/top/middle/bottom (a single item aligns to the banner, a group to itself)
  - distribute across/down
  - duplicate, plus copy/paste **between banners** (Ctrl/⌘ + C / V / D)
  - an exact rotation box
- **Snapping:** moves snap to the banner centre and edges.
- **Draft Mode:** in-page move now covers shapes too.
- **Code:** `banner-arrange-core.ts` (26 self-tests).

### 13.4 S4: buttons + badge stickers
- **Button icons:** any of the 45 icons, placed before or after the text, or icon-only. Icon-only buttons keep the label for screen readers.
- **Button styling:** gradient fill (solid buttons), shadow in any colour, and custom corner rounding (0–40 px).
- **Hover effects:** Lift, Grow, Glow (follows the button colour) or Darken. These use individual `translate`/`scale` properties, so they stack with rotation.
- **Draw attention:** a gentle pulse or an occasional wiggle. Both are switched off for visitors who ask for reduced motion (WCAG 2.3.3).
- **Badge stickers:** one click adds a sale burst, % off seal, new star, hot diamond or deal tag.
  - Each sticker is a normal shape plus a centred badge text box, so every part stays editable.
  - The text is centred on the shape for **both** computer and phone sizes.
- **Code:** `button-fx-core.ts` (31 self-tests). All new fields are written only when used.

### 13.5 Where the Studio is used today
Every banner placement already embeds the same Studio, so each upgrade above reaches all of them at once:
- **Page sections:** `SectionCard`.
- **Through `DesignCard`:** specials, shop banners, loyalty hero and the homepage carousel slides.

Each one is opt-in ("custom design" toggle). The classic fields stay as the fallback and as the word source for bound boxes.

### 13.6 Left to build
- **R57 (pro tools):**
  - curved text / text on a path
  - smart guides to *other* objects plus spacing readouts
  - saved styles / Brand Kit (named text and button styles, applied everywhere)
  - template gallery ("start from" layouts)
  - image crop, masks and frames, plus one-click background removal
  - an impressions event, for true CTR and A/B testing
- **R58 (universal page editor):**
  - a layout layer for page editors that use tabs and cards: a "Card Studio" variant of the same engine (card frame, grid/stack slots, per-tab designs)
  - one shared "Design" tab pattern across every page editor
- **R59 (motion + collaboration):**
  - entrance animations (fade/slide, reduced-motion safe)
  - version history with visual diffs
  - comments / approvals

## 14. R57: what shipped, logged later work, and the smoke/fog assessment

### Shipped
- **Smart spacing guides** (`banner-guides-core.ts`, 18 self-tests):
  - Snaps the start, centre or end of a dragged item to the banner's 0/50/100 lines and to every other item's edges and centres.
  - Dashed orange lines mark the banner; solid pink lines mark other items.
  - Gap lines show the pixel distance, and turn cyan with "=" when spacing is equal (equal-spacing snap).
- **Micro-interactions** (`banner-motion-core.ts`, 32 self-tests; pure CSS, no library shipped):
  - Shapes and icons: breathe / glow / float / spin / wiggle / blob / **shape morph** (48-point clip-path tween), plus an **orbit spark** that travels the shape border (`offset-path`). Each has a slow/normal/fast speed and a hover effect (grow, lift, spin, glow).
  - Text boxes: breathe / glow / float / wiggle / neon flicker, with hover grow / lift / glow.
  - Banner **border beam**: two-colour light that travels around the banner edge.
  - Buttons: new shine and breathe attention effects, plus **click feedback** (press / pop).
  - Motion pauses on hidden carousel slides and turns off fully under `prefers-reduced-motion`.
  - Hover effects only run on hover-capable devices and never inside the Studio canvas.
  - Old designs are unchanged (optional fields are only written when used).

### Logged for later (owner asked to defer)
- Brand Kit / saved styles
- Templates gallery
- Curved text
- Image tools: crop, masks, background removal
- Impressions / CTR / A-B tests
- Entrance animations
- Version history with diffs
- Comments / approvals
- Countdown badges and auto badges (new / low stock / sale)
- Larger icon library and custom SVG upload
- **R58 Card Studio**: universal page editor, tabs and cards

### Smoke / fog library assessment (researched R57)
| Source | What it really is | Licence | Engine | Fit |
|---|---|---|---|---|
| **Shaders 103: smoke**, Brad Woods Digital Garden | A tutorial, not a package. A three.js `ShaderMaterial` on a twisted plane, scrolling a Perlin-noise texture with smoothstep remap and edge fade. | Tutorial (we write our own code) | WebGL via three.js | Thin wisps from a joint, blunt, pipe or bong. Moderate effort. |
| **shaders.com `Smoke`** (`shaders` npm v4, MIT; 4.9k★) | A real stable-fluids smoke sim with an emitter point (emitFrom, direction, spread, speed, dissipation, gravity, colorA→B, mouse push). | Code MIT; presets need Pro. Telemetry is on by default (`disableTelemetry` prop). | **WebGPU only** (typegpu compute) | The most realistic "hit blown out" look. Needs a fallback where WebGPU is missing. |
| **shadcn.io Smoke** (credit: Dov Azencot) | A volumetric GPU smoke shader component. | Repo MIT; registry download needs a shadcn.io token/account. | WebGL | Rising fog / haze. |
| **21st.dev Spooky Smoke** (Hossain Jahed / EaseMize UI) | One about-200-line WebGL2 component: fbm noise fragment shader with a `smokeColor` prop, no dependencies. | 21st.dev registry needs login; copies found on GitHub. | Raw WebGL2 | Full-banner fog / mist background. Easiest. |

**Plan (R58/R59 "Atmosphere" slice):** add one optional `design.atmosphere = {kind: "fog"|"wisp"|"plume", color, intensity, speed, origin {x,y}, direction}`.
- **Renderer:**
  - our own small WebGL2 canvas (no three.js), written in the style of the 21st.dev / Brad Woods shaders and not copied
  - client-only and lazy (`next/dynamic`)
  - paused offscreen and on hidden slides (IntersectionObserver)
  - DPR capped at 1.5 on phones
  - off under reduced-motion, with a static CSS gradient fallback
- **Optional upgrade:** the "plume" kind can use shaders.com `Smoke` when `navigator.gpu` exists, with telemetry disabled.
- **Difficulty:**
  - fog: easy (about 1 slice)
  - wisps from a point (joint / pipe / bong): medium
  - realistic exhale plume: medium-hard (WebGPU path plus fallback)
- **Risks:** mobile battery/GPU use (one shader per visible banner at most); Android WebGPU gaps; licence and telemetry, which our own WebGL avoids.

## 15. R58: what shipped (4 slices), the shadcn/21st.dev decision, and the editor restructure for next round

### R58-S1: smoke, fog, haze, bong hits and the word reveal (new **Smoke** tab)
- **One-click presets:** Joint / blunt smoke, Pipe / bowl smoke, Bong hit blown across, Psychedelic cloud (rainbow), Spooky fog (bottom), Green fog, Dreamy haze.
- **Four layer kinds, up to 4 per banner:**
  - rising fog
  - haze
  - smoke wisp (from a point you click: the joint tip, the bowl)
  - bong hit / exhale (a cloud blown across the banner)
- **Per-layer controls:** colour, second colour, rainbow, amount, size, direction, speed, front/behind text, one-time, push smoke with the mouse, phone position and hide on phones.
- **Engine:**
  - Fog, haze and wisps use our own ~6 KB WebGL2 fragment shader (domain-warped fbm). It works on phones and needs no three.js.
  - The bong hit uses shaders.com `Smoke` (a real stable-fluids simulation, WebGPU, MIT). It loads lazily, only when a banner has a hit AND the browser has WebGPU.
  - With no WebGPU, the hit falls back to our WebGL2 plume. With no WebGL2, there's no smoke and the banner is unchanged.
- **Word reveal:** with a hit or psychedelic preset, the words fade in after the cloud (`reveal` seconds).
- **Carousel:**
  - Plays only while the slide is shown, on screen, and the tab is visible.
  - One-time hits replay each time the slide comes back.
  - Reduced motion shows a still frame of fog/haze with no hit, and the words appear at once.

### R58-S2: curved text
- Any text box gets a **Curve** slider (−100 to +100) plus presets: Straight, Gentle arch, Arch, Ring, Smile, Deep smile.
- It renders as an SVG textPath with separate desktop and phone geometry, swapped by container query. No JS, SSR-safe, and the text stays readable to screen readers.
- Gradient, outline and shadow effects carry over onto the curve.

### R58-S3: countdown and auto badges
- **Countdown:**
  - "Ends tonight" counts to closing (store time, Pacific), or you count to any date/time.
  - Tokens: `{left}` `{clock}` `{ends}`.
  - You choose the expired text, or hide the badge when it ends.
- **Auto (deal) badges:**
  - `{offer}` `{deal}` `{ends}` are bound to the same published promotion rules the cart uses: today's flash deal, then the weekday deal, then always-on, by priority.
  - You can pin a specific promotion.
  - The badge hides itself when no deal is running.
- **Behaviour:**
  - Hydration-safe placeholders.
  - One shared 1-second clock that pauses in hidden tabs.
  - One-click "Live badges" presets in the Shapes tab.

### R58-S4: bigger libraries, all searchable and scrollable
- **Shapes:** 8 → **30**. New: pentagon, hexagon, octagon, sparkle star, 6-point star, seal, heart, cloud, speech bubble, ribbon, price tag, shield, plus, chevron, slant box, trapezoid, lightning, drop, moon, half circle, double arrow, ring. **17 can morph.**
- **Icons:** 45 → **242** Phosphor icons in 10 categories, with search keywords and 3 styles.
- **Objects (new):** **117** illustrations and decorative elements in 6 categories:
  - Material Design Icons (Apache-2.0), re-scaled to the icon model.
  - 13 Greenway originals: smoke puff, puff trail, smoke ring, sparkles, twinkle, sunburst, dots, wave, zig-zag, corners, brackets, underline, circle ring.
- **One shared `LibraryPicker`:**
  - Search matches name, keywords and category.
  - Category chips.
  - The grid scrolls in its own box, with a live "showing X of Y" count.
  - The button icon picker uses it too.
- Only the picked artwork is copied into the banner. The public site never imports the libraries (enforced by test).

### shadcn and 21st.dev: not needed
- **Fog, haze and wisps:** our WebGL2 shader already covers them.
- **The realistic hit:** shaders.com covers it with a real fluid simulation.
- **The 21st.dev smoke components:** basic fbm noise in a canvas, which is what we already have, and smaller.
- **Registry access:** both registries need accounts/CLI pulls that add nothing we don't own.
- **Decision:** we keep zero extra UI-kit dependencies.

### Editor restructure (owner request, scheduled for R59)
- **Home page:** replace the "Sections" tab with tabs and remove the old editors. Home gets **4 tabs**:
  1. **Main banner** (shown first)
  2. **Types banner**
  3. **Brands banner**
  4. **Types cards**
- **Exact copies everywhere:** put an exact copy of the home carousel editor everywhere a banner exists.
- **Shop page:** gets a copy of the home carousel editor, replacing the current shop banner UX.
- **Specials:** **3 tabs**:
  1. **Main banner**
  2. **Specials banner**
  3. **Specials cards**

  Both banner editors are copies of the home carousel editor.
- **Loyalty:** the carousel editor copy in its own tab.
- **No banner editor:** About, Price match, Locations, FAQ, Blog and Medical.
- **Rule:** creating and editing must be identical on every page that has a banner. One shared component, one data model, one set of controls.

## 16. R59: what shipped (4 slices)

- **S1 Pro picture tools** (`banner-image-core`, shared `BannerPicture` so Studio = site):
  - 14 one-click Looks with live thumbnails.
  - Contrast, warmth, hue, sepia, vertical flip.
  - Colour wash with 12 blend modes; duotone.
  - Vignette (any colour), film grain, edge fade with see-through over a backdrop colour.
  - Ken Burns (5 moves, speed).
  - All of it is non-destructive CSS that works on video too and is written only when used.
- **S2 Entrance animations** (`banner-enter-core`, `BannerEntrances` island; replaces R58 RevealWords):
  - 18 effects for every text box, button, shape and icon, each with delay, length and feel (4 easings).
  - New ✨ Animate tab: 11 whole-banner presets staggered in reading order, Remove all, ▶ Play, and a clickable timeline.
  - Played with WAAPI. Server HTML pre-hides entering items (`.gw-enp` + `data-gw-enter`), so there is no flash.
  - Replays each time the carousel shows the slide. Reduced motion and no-JS show the finished banner.
- **S3 Start blank, then reveal** (`design.intro`). The banner starts covered and smoke plays over the cover; the cover leaves after a hold with one of 8 exits, and words and entrances wait for it automatically.
  - Cover options: any colour or two-colour gradient, strength, frosted glass, and a logo or picture (brand files plus the media library), centred or filling the banner.
  - 7 one-click recipes, each adding the matching smoke.
  - Controls are in both the Smoke and Animate tabs.
- **S4 Real page speed:**
  - Migration **0280** `website_web_vitals` (apply manually; rollback in `supabase/rollbacks`).
  - `VitalsReporter` (next/web-vitals) sends one beacon per page view to `/api/vitals`. It never runs with GPC on, on admin or no-track pages, or in staff previews.
  - Reports > Website > Page speed shows Google p75 scoring with a pass/fail verdict, a good / needs-work / poor split per metric, phone vs tablet vs computer, the slowest site sections and a daily LCP chart.
- **Next round:** apply the §15 restructure. Replace every old page banner editor with copies of this Studio-based home-carousel editor.

## 17. R60: what shipped (2 slices)

- **S1 Pro big-cloud smoke.** This changes only the bong hit and large plume effects. Joint and bowl wisps are untouched.
  - 8 cloud looks: billowy, dense rip, slow exhale, vortex, rolling mushroom, smoke wall, puff-puff-puff, fast blast.
  - Expert sliders: how long it pours, puffs (1–5), blow power, spread (cone width), source size, swirl/turbulence, rise or sink, hang time.
  - 5 new one-click presets.
  - Fog and haze get a swirl control.
  - The WebGL plume now follows a physical emit, decelerate, rise and dissipate timeline.
- **S2 Lottie + Rive animation layers.**
  - **Data:** `banner-anim-core`. An animation is a banner element with `kind: "anim"`, so drag, resize, rotate, phone layout, layers, lock, copy/paste, entrances and hide-on-phones all work unchanged. A design holds at most 4 animations.
  - **Runtimes:** both are version-pinned and MIT-licensed. Each is loaded only when a banner has that kind of file.
    - `@lottiefiles/dotlottie-web@0.81.0` (ThorVG WASM, which runs no Lottie expressions) plays .lottie and Lottie JSON.
    - `@rive-app/webgl2@2.44.2` plays .riv.
  - **Player:** `AnimPlayer` is loaded through the `BannerAnim` next/dynamic door.
    - It plays only while it is on screen, its carousel slide is shown and the browser tab is visible.
    - "Plays by itself" animations replay each time the slide is shown again.
    - Start modes: auto (with a delay), hover (a tap on phones), click/tap, and scroll-scrub (Lottie only).
    - Reduced motion shows a still frame or hides the layer.
    - An optional alt text makes the layer role="img"; without it the layer is decorative.
  - **Studio tab "🎞️ Lottie & Rive":**
    - Add files from the Media Library or upload them in place. Uploads use the same signed direct upload, with the server checking size and type and then proving the type from the file's bytes.
    - The live preview reads the file and fills every control with what the file really contains:
      - Lottie: animations, themes, state machines, markers, frame segment, and colour/text/number slots.
      - Rive: artboards, state machines with their inputs, data-binding (view model) values, text runs, the input switched on while hovered and the trigger fired on click.
    - Common controls: speed and direction (Lottie), fit and anchor, Replace file, and links to LottieFiles, the Rive Marketplace, the Rive editor and Lottie Creator.
  - **Uploads:** a new "animation" upload kind (20 MB cap, advisory over 1 MB). It is recognised by signature: .riv files start with `RIVE`+v7, .lottie files are ZIPs whose first entry is manifest.json, and Lottie JSON is recognised by its header keys. Picture pickers never list animation files.
  - Animation files must be on our own storage (`safeAnimSrc`); files from any other host are refused.
- **No migration this round.**
- **Next round:** replace every old page banner editor with the Studio-based editor (the §15 restructure).

## 18. R61: what shipped (3 slices) — one editor everywhere

- **S1: one shared editor shell.**
  - `banner-studio/BannerEditorShell.tsx` holds `<DesignCard>` (the "Use custom design" switch plus the lazy Banner Studio) and `<BasicMode>` (the classic fields, collapsed under the Studio).
  - Every banner editor goes through it: home carousel slides, page sections (home Types and Brands banners and every extra banner), the Shop carousel, the Loyalty hero, the Specials hero, Today's Deal, and since S3 the Type cards and Specials weekday cards.
  - SectionCard's private Studio embed was removed.
  - Rule from now on: improve `BannerStudio`, the shell or `DesignedBanner` once, and every page editor changes with it.
- **S2: §15 tabs.**
  - Home tabs: Main banner | Types banner | Brands banner | Types cards | More banners & settings.
  - Specials tabs: Main banner | Specials banner | Specials cards.
  - Loyalty tabs: Main banner | Page wording & terms.
  - Old links still work: `?tab=sections`, `?tab=carousel`, `?tab=typecards`, the Specials tab keys, and ✎ Edit, which lands on the right new tab.
  - Saves send you back to the tab you were on (`return_tab`).
- **S3: Card Design Studio.**
  - New optional `frame.card {ratio, ratioMobile}`. The card keeps a shape instead of a pixel height.
  - Words, buttons and curved text scale with the card. They are laid out at `CARD_REF_PX` = 320 and use cqw units.
  - The phone layout follows the screen (below 768px). A card container is named `gwc`, so the banner `gwb` phone query never fires inside a card.
  - The Studio's Phone preview uses the `.gw-dcard-m` class.
  - Stored data:
    - Type cards: `adv.design`.
    - Specials weekday cards: `days[].design`.
    - Only card-shaped designs are kept. Nothing changes until the owner switches a design on.
  - Public cards render through the new shared `DesignedCard`. A card with no buttons is one whole-card link; a card with buttons uses its buttons as the links, so there are never links inside links.
- **No migration this round.**
- **Other card editors that could get the Card Studio next** (checked to exist):
  - About "Our Values" cards (`AboutCoreValuesCard`)
  - FAQ items (`FaqItemCard`)
  - Home "Shop by Brand" vendor tiles (`VendorGlowCard` via `HomeBrands`)
  - Medical page cards ("What to bring", "Perks", "High-CBD", "Limits")

## 19. R62: what shipped (4 slices). FLUX rebuilt to match the BFL Playground, plus FLUX 3 Video

- **Root cause of the "single cannabis bud portrait" results (verified by reading the old code):**
  - FLUX never received the owner's prompt. `buildFluxPrompt()` rebuilt it from Midjourney brief fields, joined with commas and with newlines stripped.
  - It then appended destination hints and an "Avoid: …" line. FLUX has no negative prompts, so naming a thing pulls it in.
  - Presets and AI assist were cannabis-retail oriented.
  - Safety was forced to 5.
  - Every result was re-encoded to WebP.
- **S1: core (`flux-core.ts`, `flux-client.ts`).**
  - The prompt is sent verbatim.
  - Request bodies are schema-exact per model, from the live OpenAPI:
    - FLUX.2 [max]/[pro]: `input_image…_8`, `width`/`height`, `disable_pup`, `seed`, `output_format`.
    - FLUX.2 [flex]: adds `guidance` and `steps`.
    - FLUX 3 Image: `images` ≤10, `aspect_ratio`, `resolution`, `grounding`.
  - Defaults match BFL: safety 2, JPEG, upsampling on.
  - Sizing: 15 aspect ratios, custom ratio and exact size, with 1/2/4 MP (multiples of 16, ≤4 MP).
  - 1, 2, 3, 4 or 8 images are submitted in parallel. Seeds step +1 across a batch.
  - Credit balance comes from `GET /v1/credits`.
  - Results are saved with `optimize:false`, so the chosen format is kept.
  - Polling URLs are restricted to https on `*.bfl.ai` (or the configured host), so there is no SSRF and no key leak.
- **S2: FLUX Image studio (`components/admin/marketing/flux/*`).**
  - Prompt box with general-purpose templates and snippets (`flux-presets-core.ts`, no cannabis bias) and a light lint (negative prompts, `--` flags, image N without a matching reference).
  - Reference strip labelled image 1…N, with reorder, the library picker and upload. Large files are downscaled in the browser to fit the 4.5 MB body cap.
  - Playground settings: aspect/custom, safety 0–5, format, upsampling, count. Extras that change the output: model, seed, exact size, destination sizes (size only), FLUX 3 resolution and grounding, flex guidance and steps.
  - Polling runs in the browser (`useFluxJobs`, 2 s) through `checkFluxTasksAction`, which polls once per call and saves when ready. This means 8 images (or a long video) never hit a function timeout.
  - The Midjourney builder moved to its own tab (`MidjourneyPromptBuilder.tsx`).
- **S3: FLUX 3 Video (`flux-video-core.ts`, `FluxVideoStudio.tsx`, `VideoSettings.tsx`).**
  - `/v1/flux-3-video` modes:
    - t2v.
    - i2v: 1–10 keyframes, evenly spaced or timed `[sec, img]` pairs.
    - v2v: duration 5–15.
    - draft_enhance.
  - Also `/v1/flux-tools/video-edit-v1` and `/v1/flux-tools/video-upscale-v1`.
  - Draft first is on by default: HD at about 1/3 cost, then one-click Enhance at a chosen resolution.
  - Quick formats: Reel, Story, feed, 16:9, hero loop, in-store screen.
  - Settings: duration auto or 5–20 s, resolution HD/FHD/QHD/4K, audio, safety.
  - Video prompt templates and snippets cover camera moves, shot types, looks and "Audio:" lines.
  - Results poll every 5 s and save as draft mp4. "Use as source clip" feeds continue/edit/upscale.
- **S4: copy.** Updated the Integrations FLUX card, the integration guide, help content, the concierge KB and the marketing hub links.
- **Not implemented (not in the strict OpenAPI):** the cookbook's `reference_images` for video.
- **No migration this round.**
