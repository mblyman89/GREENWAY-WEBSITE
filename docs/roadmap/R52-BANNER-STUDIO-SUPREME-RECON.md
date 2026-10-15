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
