# SOP-11b — Creative Studio, the Banner Design Studio (Branding and every banner editor) and Scheduling

| | |
|---|---|
| **Version** | 2.1 (SOP-11, second half; living document. v2.0 was recon, audit and the roadmap, D233; Phase C approved D234; v2.1 = slice C-1; v2.2 = slice C-2; v2.3 = slice C-3; v2.4 = slice C-4) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Creative Studio** (`/admin/marketing/midjourney`, nav MKTG & ADV, permission `content.edit`, `src/components/admin/admin-nav-data.ts` L100). **Branding** (`/admin/settings/branding`, `content.edit`, L146). The **Banner Design Studio** wherever it opens (Shop Banner L150, home carousel slides, page sections, Loyalty hero, Specials, type cards, About side panel, Branding → Saved banners). **Schedule & Releases** (`/admin/content/schedule`, `content.edit`, L152). **Website Sync** preview and Move mode (`/admin/website-sync`, L139; Move needs `content.edit`, `src/app/admin/website-sync/page.tsx` L133) |
| **Verified against** | `main@c384a5e6` (2026-11-11). Live read-only probes of greenwaymarijuana.com on 2026-11-11 (frame heights and fonts, §9.3). The numbers in Appendix B.3 come from the same formula the site uses (`interpPx`, `src/lib/cms/banner-design-core.ts` L919–925) |
| **Program records** | Findings `F-11-19` … `F-11-32` and `F-11-C2` in `docs/sop-program/03-FINDINGS-LEDGER.md` · gaps `G-94` … `G-107` in `docs/sop-program/05-GAP-REGISTER.md` · plan rows `C-1` … `C-8` (Phase C, APPROVED D234) in `docs/sop-program/06-FIX-PHASE-PLAN.md` · owner request D233 in `00-OWNER-REQUEST-VERBATIM.md` |
| **Scope (this version)** | The owner: *"This one is for the creative studio, and the editor in the branding page and the scheduler. Recon and audit the code. Deep research the internet. Help me optimize, enhance, harden, make more powerful and easier to use, etc. it too should have significant help."* The Merch Studio is SOP-11 (v1.0 … v1.9) |

> **This SOP is a living document (owner decision D41).** Each time a Phase C slice is built, the "As built" note goes into 00, the finding gets its "Resolved" line in 03, and this SOP gets a new version row in Appendix D.

> **The one thing to know before anything else (the "it moved on the website" problem).** The owner: *"I build the banner or image, place everything where it looks good in the editor. Then I go to the website and all the overlay objects are not where I placed them exactly, so I have to go back and forth over and over till I get it right."* This is real, and it is not you. The audit found **six separate causes** (Appendix B.2). The two biggest: (1) the studio shows text in a **different font** from the website when a box is set to "Site font", so lines wrap differently and everything below shifts (F-11-19); (2) the banner's **height and text size do not grow in step with its width**, while the positions are percentages, so the picture, the text and the gaps change shape at every screen size except the two the studio shows (F-11-21, F-11-22). Until Phase C is built, follow **§4.9 "Placing overlays so they land where you put them"**. It removes most of the drift today, with no code.

> **How to use this document.** **Part 1** (§4.1) is the map. **Part 2** (§4.2–§4.4) is the Creative Studio. **Part 3** (§4.5–§4.6) is the Branding page. **Part 4** (§4.7–§4.10) is the Banner Design Studio, including the placement procedure and how to check on the real page. **Part 5** (§4.11–§4.14) is scheduling. Appendix B is the audit and the roadmap; Appendix C has the questions for you.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: The map**
   - 4.1 From an idea to a live banner: the five places involved

   **Part 2: Creative Studio**
   - 4.2 FLUX Image
   - 4.3 FLUX Video
   - 4.4 Midjourney prompt, and where the results go

   **Part 3: Branding**
   - 4.5 The six Branding tabs
   - 4.6 Saved banners and "Save as picture"

   **Part 4: The Banner Design Studio**
   - 4.7 Where the studio opens, and its nine tabs
   - 4.8 Moving, sizing, keys and undo
   - 4.9 Placing overlays so they land where you put them (interim procedure)
   - 4.10 Checking on the real page (Website Sync and Move mode)

   **Part 5: Scheduling**
   - 4.11 Which things can be scheduled, and how
   - 4.12 Schedule & Releases: one change at a time
   - 4.13 Releases: several changes together
   - 4.14 Home slides: repeats, fallback and the calendar

5. Messages you may see, and what to do
6. Exceptions & troubleshooting
7. Controls & compliance
8. Forms
9. Quick reference
10. Glossary

Appendix A: Source map and external sources · Appendix B: Findings, gaps and the roadmap strategy · Appendix C: Owner questions · Appendix D: Revision history

---

## 1. Purpose & scope

This SOP explains how to make marketing pictures and video in the **Creative Studio**, how to keep the brand in one place on the **Branding** page, how to build designed banners in the **Banner Design Studio** so they look on the website the way they look in the editor, and how to make banners and page changes go live and come down on their own with **scheduling**.

It also records the audit (14 findings), the gaps (14), the owner questions (9) and a phased build plan (Phase C, eight slices). The plan is PROPOSED until the owner approves it.

**Out of scope:** the Merch Studio and greenwaymerch.com (SOP-11), Digital Assets clean-up (SOP-12, not yet written), and the four page editors' text fields that are not designed banners.

## 2. Roles & permissions

| Who | What they can do | Pin |
|---|---|---|
| Anyone with `content.edit` (content editors, managers, admin, owner) | Creative Studio, Branding, Shop Banner, every banner editor, Schedule & Releases | `admin-nav-data.ts` L100, L146, L150, L152 |
| Anyone with `dashboard.view` | See the Website Sync preview | L139 |
| `content.edit` on Website Sync | Turn on **Move mode** and drag items on the real page (saves a draft) | `website-sync/page.tsx` L133 |
| The schedule clock (`/api/cron/content-schedule`, every 5 minutes) | Publishes or hides what you scheduled, in your name, exactly as if you pressed the button | `vercel.json` L37–40; `content-schedule-server.ts` L228–262 |

FLUX images and video are billed to the store's BFL account (helper `midjourney-builder`, notes, `src/lib/admin/page-helpers-core.ts` L305+).

## 3. Before you start

1. **Use a computer with a normal-size window** (1280 px wide or more) for the Banner Studio. It shows a scaled copy of the 1408 px banner (`StudioCanvas.tsx` L141–144).
2. **Know which page the banner is for.** The same design shows at different widths in different places (§9.3). The Shop banner can get much wider than the home banner.
3. **Have the picture ready** at the right shape. A wide banner is wide and short; see §4.9 step 6.
4. **Nothing goes live until you Publish** (or a schedule does it). Every editor saves a draft first (helper `shop-banner-editor`, `page-helpers-core.ts` L146).

## 4. Procedures

### Part 1: The map

### 4.1 From an idea to a live banner: the five places involved

| Step | Where | What happens | Pin |
|---|---|---|---|
| 1. Make the picture | **Creative Studio** (FLUX Image, FLUX Video, Midjourney prompt) | The result is saved in Digital Assets as a **draft** | `MidjourneyBuilder.tsx` L22–40; `flux-client.ts` L181 |
| 2. Keep the brand | **Branding** | Colours, logos, fonts, wording, saved banners, social | `settings/branding/page.tsx` L34–41 |
| 3. Design the banner | **Banner Design Studio** inside the page's editor | Text, buttons, shapes, animation, picture and shade, checks | `BannerStudio.tsx` L38, L395–407 |
| 4. Check it on the real page | **Website Sync** preview, Move mode | The real page in Draft Mode, at Desktop, Tablet (834 px) or Phone (390 px) | `PreviewFrame.tsx` L21–27; `PreviewDesignDrag.tsx` L3–24 |
| 5. Make it live | **Publish**, or **Schedule & Releases** | Now, or at a set time (Pacific, 5-minute clock) | `page-helpers-core.ts` L168–185 |

What the website shows is drawn by `src/components/site/DesignedBanner.tsx`. The studio draws its copy with the **same style rules** (`StudioCanvas.tsx` L3–9), but not with the same font and tags (F-11-19, F-11-20), and only at two widths (F-11-22).

### Part 2: Creative Studio

### 4.2 FLUX Image

1. Open **MKTG & ADV → Creative Studio**. FLUX Image is the first tab (`MidjourneyBuilder.tsx` L22–30).
2. Write the prompt. In the helper's words: *"It's sent to FLUX exactly as typed, the same as the BFL Playground, with nothing added behind your back."* and *"Put the subject first, then the action, style and setting. 30-80 words is BFL's sweet spot. Describe what you want; FLUX has no negative prompts."* (`page-helpers-core.ts` L305+).
3. Optional: add reference images, up to 8 (FLUX.2) or 10 (FLUX 3). FLUX reads them as image 1, image 2…, so name them in the prompt (same helper).
4. Pick the size. Choose a **website placement** (for example "Website section banner") instead of a bare ratio, so the picture fits the banner it is for. The placements are listed in `src/lib/marketing/creative-placements-core.ts` L88+.
5. Press generate. Results appear as they finish and are **saved as drafts** in Digital Assets (helper; `flux-client.ts` L181). Each card has **Open in media (draft)**, **Download** and, for re-use, **Use as reference** and the seed (`FluxResults.tsx` L85–110).
6. To put the picture on a banner today: open the banner's editor → **Picture & shade** tab → pick it from the library. There is no "Use in a banner" button yet (F-11-28, G-104).

**You know it worked when** the card shows the image and **Open in media (draft)** opens it in Digital Assets.

### 4.3 FLUX Video

1. Creative Studio → **FLUX Video** (`MidjourneyBuilder.tsx` L32).
2. Pick text → video, image → video (keyframes), continue, edit or upscale a clip; pick a quick format (Reel, feed, 16:9…), duration, resolution and audio. *"Draft first is on by default"* (helper `midjourney-builder`).
3. When the draft looks right, press **Enhance draft → full quality** on its card (`FluxResults.tsx` L101–103). A finished clip can be **Use as source clip** for the next one (L97–98).

### 4.4 Midjourney prompt, and where the results go

1. Creative Studio → **Midjourney prompt** (`MidjourneyBuilder.tsx` L38). It builds a copy-paste prompt from a structured brief, with Greenway AI assist (`concierge-kb.ts` L284+).
2. Paste it into Midjourney, download the picture, and upload it to Digital Assets yourself.
3. **Everything AI-made is a draft.** *"Generated images and videos are DRAFTS in Digital Assets. Review them before using them on the website or in marketing."* (`concierge-kb.ts` L284+). Before you use one, run the advertising check in §7.1 yourself. The studio does not check it (F-11-29).

### Part 3: Branding

### 4.5 The six Branding tabs

Open **Website → Branding** (`/admin/settings/branding`). The tab is in the address (`?tab=`), so a link opens the right tab (`page.tsx` L100).

| Tab | What it is for | Pin |
|---|---|---|
| Colours | Presets, hex, colour wheel | `page.tsx` L35; helper `branding` L67+ |
| Logos | Header logo and the logo library with import | L36 |
| Fonts | The **Heading** font (big titles) and the **Body** font. *"Each choice is a draft, so nothing goes live yet."* | L37; helper |
| Slogans, mission & about | The wording kit | L38 |
| Saved banners | Banner designs you can re-use and export as pictures | L39; §4.6 |
| Social & guidelines | Social links and brand rules | L40 |

**Important for banners:** the Heading and Body fonts are what a banner text box set to **"Site font (default)"** uses on the website (`(site)/layout.tsx` L115–131; `banner-design-core.ts` L193–196). Today the site heading font is **System default** (live probe, §9.3). That means each visitor's device picks the font: San Francisco on an iPhone or Mac, Segoe UI on Windows, Roboto on Android (`src/lib/cms/fonts.ts` L44–54, L260–261). The same words take up a different width on each device. See §4.9 step 1 and Q-11-18.

### 4.6 Saved banners and "Save as picture"

1. Branding → **Saved banners**. Pick what the design is for (website banner, card, blog, newsletter, social, print or a custom W×H), design it, add it (helper `branding`).
2. **Save as picture** draws the same public banner off-screen and saves a PNG at the exact size into a Digital Assets folder (Merch by default) (`BrandDesignExport.tsx` L3–10; folders `brand-sizes-core.ts` L178–182).
3. From any banner editor, **Save to brand** asks for a name in a plain browser box (`BannerEditorShell.tsx` L60). Type a clear name, for example "Friday 20% off - Nov". (F-11-30 replaces this box with a proper dialog.)

### Part 4: The Banner Design Studio

### 4.7 Where the studio opens, and its nine tabs

The studio is the same everywhere. It opens from: Shop Banner (each slide), home carousel slides, page sections, the Loyalty hero, Specials, type cards, the About side panel and Branding → Saved banners (`BannerEditorShell.tsx`, used by each of those editors).

The nine tabs (`BannerStudio.tsx` L38, L395–407): **✏️ Text**, **🔘 Buttons**, **◆ Shapes & icons**, **🎞️ Lottie & Rive**, **✨ Animate**, **💨 Smoke & fog**, **☰ Layers**, **🖼 Picture & shade**, **✓ Checks** (shows **⚠️ Checks (n)** when something needs a look).

At the top: **🖥 Computer** and **📱 Phone** (`BannerStudio.tsx` L303–317). Computer lays the banner out at 1408 px wide; Phone at 390 px (`banner-design-core.ts` L39–40). On Phone the strip says *"📱 Phone layout: moves and sizes here only change how the banner looks on phones."* (L354).

### 4.8 Moving, sizing, keys and undo

The studio's own one-line guide (`BannerStudio.tsx` L395), word for word:

> Drag text and buttons to move them · double-click text to type on it (Enter = new line, Esc or click away to finish) · drag the green handle to change wrap width · drag the gold knob to rotate (Shift = 15° steps) · Shift-click to select several, then drag them together or use Arrange · Ctrl/⌘+C / V / D copy, paste (into any banner), duplicate · click an item, then arrow keys nudge it (Shift = bigger steps) · 🔒 locked items stay put · Ctrl/⌘+Z undo · hold Alt to stop snapping · Delete removes.

- Arrow keys move 0.5%; Shift moves 5% (`StudioCanvas.tsx` L19–21).
- Undo keeps the last 60 steps. Changes made within 600 ms of each other count as one step (`BannerStudio.tsx` L12, L39–40).
- Positions are saved as **percent of the banner** (left, top, wrap width) (`banner-design-core.ts` L1076–1084).
- On Phone, every move writes the phone copy only (mx/my/mw) (`StudioCanvas.tsx` L22).

### 4.9 Placing overlays so they land where you put them (interim procedure)

Use this until slices C-1 … C-3 are built. Each step names the cause it removes.

> **Since v2.1 (C-1):** the studio now draws "Site font" text in the website's Heading/Body font and with the website's tags, so causes 1 and 2 are gone inside the studio. Step 1 still matters while the site font is **System default**: each visitor's device then picks the font, and Checks shows *"… text boxes use System default …"*. Pick the site fonts in Branding → Fonts (Q-11-18), or name a font on the box.

> **Since v2.3 (C-3): use Scale mode and steps 2–4 no longer apply.** New banners start in **Scale** (Q-11-10). The banner keeps its shape and the words and buttons grow and shrink with it, like a picture, so items stay where you put them at every width. For an older banner, the studio shows **Sizing: Fixed sizes** under the width bar. Press **Switch to Scale…**, compare the before / after at Big screen, Laptop and Phone, then press **Switch to Scale** and save. **Switch back to fixed sizes** (or Ctrl+Z) undoes it exactly. You still place the Phone layout separately (step 5; Q-11-11). In Scale mode text never goes under 12 px. If Checks says *"Scale mode: … smaller than 12 px …"*, look at the 770 and 328 widths, because that text takes a little more room there (Q-11-13).

1. **Set every text box's font on purpose. Do not leave it on "Site font".** Text tab → Font. Pick a library web font (for example Inter, Montserrat, Oswald, Bebas). With a named font, the studio and the website use the same font file (both pages load all the library fonts, `admin/layout.tsx` L26 and `(site)/layout.tsx` via `fontVariablesClassName`, `fonts-loader.ts` L207+), and the box sets its own font, so the h1/h2 heading rule cannot change it (`banner-design-core.ts` L1097–1098; `globals.css` L159–160). *Removes causes 1 and 2 (F-11-19, F-11-20).* Avoid "System default" for banner text: it is a different font on each visitor's device.
2. **Leave room below the last line.** The banner's height changes with the screen width (home: 200 px on a phone up to 360 px on a big screen; §9.3), while text positions are percentages. Keep the bottom of the lowest text or button above about 85% of the height. *Reduces cause 3 (F-11-21).*
3. **Keep the text block in the left 60% and away from the right edge.** As the banner gets narrower, the text gets bigger compared with the banner (on a 1024 px laptop the headline is about 15% bigger than "in proportion", Appendix B.3), so it needs spare width.
4. **Buttons and lines do not shrink.** Buttons are a fixed height (32, 40 or 48 px; `banner-design-core.ts` L1153–1157) and line shapes are a fixed thickness (`banner-elements-core.ts` L356–357). Give buttons a little extra space, especially on the phone layout.
5. **Always finish the Phone layout separately.** Switch to 📱 Phone and place each item. Phones from 360 to 430 px wide show the banner at 328–398 px wide (the page has 16 px margins), not the 390 px the studio shows (Appendix B.3).
6. **Use a picture of the right shape and set its focus point.** The banner crops the picture to fill (`banner-design-core.ts` L1000–1023, `object-fit: cover`). The crop changes with the width, so keep the important part of the picture near the focus point, not at the top or bottom edge. The recommended upload is 1600×560 or 1920×640 (`image-spec-core.ts` L116–118). The home banner at full width is 1408×360, a wider shape, so the top and bottom of the picture are cut off (F-11-32).
7. **Check on the real page at three widths before you publish** (§4.10; v2.2: try the width stops in the studio first, then **↗ Check on the real page**). Fix the last few pixels **there**, with Move mode. Move mode saves from the real page, so what you drop is what visitors see at that width.

**You know it worked when** the banner looks the same in Website Sync at Desktop, at Tablet and with your browser window made narrower (about 1280 and 1024 px), and at Phone.

### 4.10 Checking on the real page (Website Sync and Move mode)

**In the studio first (v2.2, C-2).** Under 🖥 Computer / 📱 Phone, the **Banner width** bar lays the canvas out at any width (320 … 1920 px) with the website's own sizing. Tap a stop: **1408** (home and Shop, full width), **1344** (Specials and Loyalty), **1216** (1280 laptop), **960** (1024 laptop), **770** (tablet), **398 / 358 / 328** (phones 430 / 390 / 360). Below 768 the phone layout shows and your moves change the phone layout. **Reference** goes back to the usual 1408 / 390 view. **↗ Check on the real page** (same bar) opens the steps below for you at the right page and size with Move mode on. Save draft first: it shows the saved draft.

1. Save the banner (draft).
2. Open **Website → Website Sync**. Pick the page (home, Shop, Specials, Loyalty…).
3. Switch between **Desktop** (the whole pane), **Tablet** (834 px) and **Phone** (390 px) (`PreviewFrame.tsx` L21–27). Also make your browser window narrower on Desktop to see a laptop.
4. To fine-tune, turn on **Move mode**. Every text box, button and shape on a designed banner gets a dashed green outline. Drag it, or Tab to it and use the arrows (0.5%, Shift = 5%), Enter saves, Escape cancels (`PreviewDesignDrag.tsx` L11–21). Each drop saves a **draft** and reloads the preview (L17–19).
5. Move mode saves the **phone** copy when the banner on screen is narrower than 768 px, and the **computer** copy otherwise (`design-drag-core.ts` L20–23). So a move at Tablet (834 px) changes the computer layout.
6. Publish (or schedule) from the editor.

### Part 5: Scheduling

### 4.11 Which things can be scheduled, and how

| What | How it is scheduled | Repeats (days/hours) | Fallback | Pin |
|---|---|---|---|---|
| Home carousel slides | Start/end, **repeat days and hours**, fallback slide, month calendar | Yes | Yes | `home-slide-advanced-core.ts` L76–77; `banner-schedule-core.ts` L65–93, L110; `pages/[slug]/page.tsx` L454 |
| Shop banner slides | Start/end only, on the slide ("Schedule (optional)") | No | No | `ShopBannerEditor.tsx` L642; `shop-carousel-core.ts` L372–378 |
| Type cards | Start/end only | No | No | `TypeCardImagesEditor.tsx` L548–557; `type-cards-core.ts` L197–203 |
| Home slide, Shop slide, page section, FAQ question, page wording | **Schedule & Releases**: Go live / Come down at a time | — | — | `content-schedule-core.ts` L32–38 |

Times are **Pacific** (`banner-schedule-core.ts` L19) and the clock runs every 5 minutes (`vercel.json` L37–40). Pages refresh at most 60 seconds later (`(site)/page.tsx` L84; `(site)/menu/page.tsx` L59).

### 4.12 Schedule & Releases: one change at a time

The helper's steps (`page-helpers-core.ts` L168–185), word for word:

1. *"Edit and SAVE the draft as usual (home slide, Shop banner slide, page section, FAQ question or page wording)."*
2. *"Pick "Go live" or "Come down" and a time. Times are Pacific and run on a 5-minute clock."*
3. *"At that time the website publishes the saved draft, exactly as if you had pressed Publish, or hides the item."*
4. *"For a sale: schedule the banner to go live Friday morning and to come down Sunday night."*

Note: *"If something cannot be published (for example the item was deleted), it is tried up to three times and then shows here as failed, with the reason."* Page wording can only be published, not hidden (`content-schedule-core.ts` L61–62).

### 4.13 Releases: several changes together

*"For a launch with several changes, make a Release, add the items, and give the release one time (or press Publish now)."* (helper L168–185; `schedule/page.tsx` L22; `content-release-server.ts` L56–135).

There is no "show me the site as it will look on Friday" preview yet (F-11-27, G-103). Today, check each item's draft in Website Sync before you add it.

### 4.14 Home slides: repeats, fallback and the calendar

1. On a home slide, set start/end, and optionally the **days** and **from/to hours** (for example Fri–Sun, 4 pm – 9 pm) (`banner-schedule-core.ts` L65–93).
2. Tick **fallback** on one slide. It shows only when no other slide is live (`home-slide-advanced-core.ts` L76–77; `banner-schedule-core.ts` L110).
3. The month calendar shows this month and next, and ⚠️ marks days where 2 or more banners start (`BannerScheduleCalendar.tsx` L1–5). It is only on the home carousel page today (F-11-26).

## 5. Messages you may see, and what to do

The Checks tab messages (`banner-design-core.ts` L1334–1385), word for word. They **warn only** and never block (L1330).

| Message | What to do |
|---|---|
| "Use only one headline per banner — it tells people (and Google) the one main message." | Change the extra headline box to a subhead. |
| "Headlines read best under ~8 words (this one is N characters)." | Shorten it. Long headlines wrap differently at each width (§4.9). |
| "More than two buttons dilutes the action. Consider keeping the best two." | Remove one. |
| "Button "…": …" | The link has a problem; fix the button's link. |
| "Hard to read (estimate): N : 1 on …" | Darken the shade or change the text colour. |
| "A text box ran past the edge of the banner — it was pulled back inside." | Check the box's place; narrow it. |
| "The … box is empty — add text or hide it." | Type text or hide the box. |
| "This small-print box is under 10% of your biggest text. You don't need warnings on banners (your age-gated site shows them in the footer on every page), but if you add one here, WAC 314-55-155(7) wants it at least 10% of the largest text." | Make the small print bigger, or remove it. |
| "Scale mode: N text boxes get smaller than 12 px on a tablet (770 px banner) or a 360 phone (328 px banner) …" (v2.3) | That text is held at 12 px there so it stays readable, and it takes more room than in your design. Check the 770 and 328 width stops, or make the words bigger (computer about 22 px or more, phone about 15 px or more). |
| "N text boxes use System default. Each visitor's device picks that font …" (v2.1) | Pick a web font for the box (Text → Font), or set the site's Heading and Body fonts in Branding → Fonts (Q-11-18). |
| "The … and … boxes might overlap." | Move one. This one is checked on the Computer layout at the reference size, by estimate (L1368–1380). Since v2.4 the next message covers every other width, Phone included. |
| "The … runs past the bottom (or right edge) of the banner at 398, 358, 328 px wide …" / "The … and the … might overlap at … px wide." (v2.4) | Press each named stop on the **Banner width** bar and fix it there: move the item up or left, narrow it or make it smaller. The height of text is an estimate, so if it looks fine at that stop, it is fine. |

Schedule & Releases: a failed item *"is tried up to three times and then shows here as failed, with the reason"* (helper L168–185). Fix the reason (for example, the item was deleted) and schedule it again.

## 6. Exceptions & troubleshooting

### 6.1 The text is in a different place on the website than in the studio

Work through §4.9 in order. Step 1 (set the font on purpose) fixes most cases. Then check in Website Sync (§4.10) and finish with Move mode.

### 6.2 It looks right on my computer but wrong on my phone

The phone layout is separate. Open the studio, switch to 📱 Phone and place each item (§4.9 step 5), or use Website Sync → Phone → Move mode.

### 6.3 It looks right on the home page but wrong on the Shop page

The Shop banner can be up to 1920 px wide but no taller than 280 px (`ShopBannerCarousel.tsx` L331–332; `globals.css` L54; §9.3), so on a big screen it is much wider than the studio shows. Text stops growing at 1408 px, so on a 1920 px screen it is about 24% smaller than "in proportion" (Appendix B.3). Check it in Website Sync with a wide window. Q-11-12 asks how you want this fixed.

**Since v2.3 (C-3, Q-11-12):** the Shop banner is capped at **1408 px, centred**, the same as the home banner (`ShopBannerCarousel.tsx`, `max-w-[88rem]`), so one design fits both. If it still differs, switch the banner to **Scale** (§4.9 note).

### 6.4 The scheduled banner did not appear

1. Wait 5 minutes for the clock, plus up to 60 seconds for the page (§4.11).
2. Schedule & Releases: is it **failed**? Read the reason (§5).
3. A Shop slide or type card with an **end** time in the past is hidden (`shop-carousel-core.ts` L372–378).

### 6.5 The picture's subject is cut off

Move the focus point (Picture & shade) toward the subject, or use a picture with more space around it (§4.9 step 6).

## 7. Controls & compliance

### 7.1 Advertising rules (WAC 314-55-155) for every picture and banner

The website is an advertising surface (`campaign-rules-core.ts` L99–113). Nothing in the Creative Studio or the Banner Studio checks these rules today (F-11-29). Check them yourself before you publish. The rules below are copied from `campaign-rules-core.ts` L53–61:

- No false or misleading statements.
- Nothing that promotes over-consumption.
- No alcohol, tobacco/nicotine, or their use.
- No association with a motor vehicle or driving.
- No mimicking LCB or other state-agency logos or messaging.
- No curative or therapeutic claims: cannabis never treats, cures, relieves or helps any condition.
- Nothing appealing to minors: cartoons, toys, movie characters, candy/kid comparisons, youthful slang, or depicting anyone under 21. **Look at AI pictures carefully for this one.**

The four warnings (L45–50) appear in the site footer on every page, so banners do not need them (the Checks message, §5).

### 7.2 Other controls

- AI results are **drafts** in Digital Assets; nothing goes live by itself (`flux-client.ts` L181; `actions.ts` L311).
- Every scheduled change is audited in the name of the person who scheduled it (helper L168–185).
- Move mode accepts messages only from the store's own pages (`PreviewDesignDrag.tsx` L23).

## 8. Forms

### 8.1 Banner launch check (print or copy)

| Check | Done |
|---|---|
| Every text box has a named web font (not Site font, not System default) | ☐ |
| Lowest text/button above ~85% of the height | ☐ |
| Phone layout placed separately | ☐ |
| Picture focus point set; subject not near the top/bottom edge | ☐ |
| Checks tab has no ⚠️ | ☐ |
| Website Sync: Desktop ☐ narrow window ~1280 ☐ ~1024 ☐ Tablet ☐ Phone ☐ | ☐ |
| §7.1 advertising rules checked | ☐ |
| Publish, or schedule (go live and come down) | ☐ |

## 9. Quick reference

### 9.1 Where things are

| Task | Go to |
|---|---|
| Make a picture or video | MKTG & ADV → Creative Studio |
| Brand colours, logos, fonts | Website → Branding |
| Shop banner slides | Website → Shop Banner |
| Schedule or release | Website → Schedule & Releases |
| See it on the real page / Move mode | Website → Website Sync |

### 9.2 Keys in the studio

Arrows 0.5% · Shift+arrows 5% · Ctrl/⌘+Z undo · Ctrl+Shift+Z or Ctrl+Y redo · Ctrl/⌘+C / V / D copy, paste, duplicate · Alt while dragging = no snapping · Delete removes · Esc deselects (`BannerStudio.tsx` L133, L395; `StudioCanvas.tsx` L18–21).

### 9.3 How wide each banner really is (live, 2026-11-11)

| Place | Widest banner | Height on the website | Pin |
|---|---|---|---|
| Home hero and sections | 1408 px | 200 → 360 px | `Hero.tsx` L94–96; live `clamp(200px…360px)` |
| Specials | 1344 px | 200 → 260 px and 160 → 360 px | `SpecialsContent.tsx` L531 |
| Loyalty | 1344 px | 200 → 360 px | `LoyaltySignupForm.tsx` L144 |
| Shop (/menu) | **1920 px** (v2.3: **1408 px**, centred) | 200 → 280 px | `ShopBannerCarousel.tsx` L331–332; `globals.css` L54 (v2.3: `max-w-[88rem]`) |
| Phones | screen width − 32 px | phone height | `Hero.tsx` L94 (`px-4`) |

The live site's heading font on 2026-11-11 was the system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto…`), and none of the home banner's boxes set their own font.

## 10. Glossary

- **Overlay / item:** anything on top of the picture: text box, button, shape, icon, animation.
- **Computer / Phone layout:** two sets of positions. The phone set is used when the **banner** (not the screen) is narrower than 768 px (`globals.css` L708).
- **Reference width:** the width the studio lays the banner out at: 1408 px (Computer) or 390 px (Phone).
- **Fluid size:** today's rule: height and text size slide between the phone value and the computer value as the width changes, then stop (`interpPx`).
- **Scale mode (v2.3):** the banner keeps its designed shape and everything in it grows and shrinks with its width, like a picture (`frame.scale`). Text never goes below 12 px. Shown as **Sizing: Scale** in the studio.
- **Scale mode (proposed):** everything grows and shrinks together like a picture, so the layout looks the same at every width (G-96).
- **Draft Mode / Move mode:** the real page showing drafts, where you can drag items.
- **Release:** a named group of changes that go live together.
- **Fallback slide:** the slide shown when nothing else is scheduled.

---

## Appendix A: Source map and external sources

### A.1 Code (all at `main@c384a5e6`)

| Area | File and lines |
|---|---|
| Back-office root page, no site fonts | `src/app/admin/layout.tsx` L24–29 |
| Website root, site fonts | `src/app/(site)/layout.tsx` L93–131 |
| Body and heading font rules | `src/app/globals.css` L136, L159–160 |
| Phone container rule | `src/app/globals.css` L700–731 |
| Design model, constants | `src/lib/cms/banner-design-core.ts` L36–47 (DESKTOP_REF_PX 1408 L39, MOBILE_REF_PX 390 L40, CARD_REF_PX 320 L43) |
| Font of a box ("site" = inherit) | `banner-design-core.ts` L183–196 |
| Default frame heights | `banner-design-core.ts` L478–492 |
| Fluid size formula | `banner-design-core.ts` L919–925 |
| Card proportional units | `banner-design-core.ts` L954–957 |
| Frame size and style | `banner-design-core.ts` L977–998 |
| Picture crop | `banner-design-core.ts` L1000–1023 |
| Text box style (% positions) | `banner-design-core.ts` L1076–1135 |
| Button sizes (fixed px) | `banner-design-core.ts` L1153–1200 |
| Checks | `banner-design-core.ts` L1303–1385 |
| Shape/line style | `src/lib/cms/banner-elements-core.ts` L339–370 |
| Studio canvas | `src/components/admin/banner-studio/StudioCanvas.tsx` L3–26, L141–144, L361–368, L452–505 |
| Studio shell | `src/components/admin/banner-studio/BannerStudio.tsx` L12, L38–40, L63, L133, L303–354, L395–407 |
| Editor shell, Save to brand | `src/components/admin/banner-studio/BannerEditorShell.tsx` L56–62 |
| Control hint | `src/components/admin/banner-studio/controls.tsx` L15–20 |
| Website banner | `src/components/site/DesignedBanner.tsx` L96–109, L215 |
| Mount widths | `Hero.tsx` L94–96; `SpecialsContent.tsx` L531; `LoyaltySignupForm.tsx` L144; `ShopBannerCarousel.tsx` L331–332 |
| Preview and Move mode | `PreviewFrame.tsx` L21–27; `PreviewDesignDrag.tsx` L3–24; `design-drag-core.ts` L20–23; `WebsiteSyncPreviewPanel.tsx` L29–46 |
| Picture size advice | `src/lib/cms/image-spec-core.ts` L116–120, L202 |
| Creative Studio | `MidjourneyBuilder.tsx` L22–40; `flux/FluxResults.tsx` L62–110; `creative-placements-core.ts` L42–51, L88+; `midjourney/actions.ts` L182–200, L305–311; `flux-client.ts` L136, L181 |
| Branding | `settings/branding/page.tsx` L34–41, L100, L192; `BrandDesignExport.tsx` L3–10; `brand-sizes-core.ts` L49–50, L178–182 |
| Scheduling | `content-schedule-core.ts` L32–38, L61–62; `content-schedule-server.ts` L228–262; `vercel.json` L37–40; `banner-schedule-core.ts` L19–170; `BannerScheduleCalendar.tsx` L1–23; `shop-carousel-core.ts` L372–378; `type-cards-core.ts` L197–203; `home-slide-advanced-core.ts` L76–77; `schedule/page.tsx` L16–22, L62 |
| Ad rules | `src/lib/marketing/campaign-rules-core.ts` L1–8, L45–61, L99–113 |
| Help | `page-helpers-core.ts` L67 (branding), L134 (shop-banner-editor), L168 (content-schedule), L305 (midjourney-builder); `concierge-kb.ts` L284 (image-generator) |
| End-to-end test runner (present) | `package.json` L20, L56 (Playwright 1.64.1) |

### A.2 External sources (read 2026-11-11)

| Source | What we took from it |
|---|---|
| Figma, "Apply constraints to define how layers resize" — https://help.figma.com/hc/en-us/articles/360039957734-Apply-constraints-to-define-how-layers-resize | *"**Scale** will define the layer's size and position as a percentage of the frame's dimensions. It will then maintain those proportions as you resize it."* Designers expect a "Scale" choice; that is G-96. Also Left / Right / Center pins (G-96 option b). |
| MDN, "Container queries" — https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries | Container units (`cqw`) size things as a percent of the container width. The site already uses them for cards (`cardPx`), so Scale mode re-uses a proven path. |
| Nielsen Norman Group, "Onboarding Tutorials vs. Contextual Help" — https://www.nngroup.com/articles/onboarding-tutorials/ | Prefer help that appears when you reach the feature ("pull" over "push"); make it easy to dismiss and to bring back; don't make people memorize. Basis for G-106. |
| NN/g, "Tooltip Guidelines" — https://www.nngroup.com/articles/tooltip-guidelines/ | Short, on hover **and** keyboard focus, never the only place for essential information. Basis for the tooltip part of G-106. |
| NN/g, "Instructional Overlays" — https://www.nngroup.com/articles/mobile-instructional-overlay/ | Coach marks are easily forgotten; keep them few and re-openable. |
| Contentful, "Preview a release" — https://www.contentful.com/help/timeline/preview-a-release/ | Preview the site as it will look at a release time, including earlier releases. Basis for G-103. |
| Sanity, "Scheduled publishing" — https://www.sanity.io/docs/studio/scheduled-publishing | A schedule list plus a calendar, per document. Basis for G-102. |
| WAC 314-55-155 (as built into `campaign-rules-core.ts`, current text WSR 26-12-082, effective 7/4/26) — https://app.leg.wa.gov/wac/default.aspx?cite=314-55-155 | The universal content bans in §7.1. Basis for G-105. |

## Appendix B: Findings, gaps and the roadmap strategy

### B.1 Findings (also in `03-FINDINGS-LEDGER.md`)

| ID | Sev | Type | Title |
|---|---|---|---|
| F-11-19 | S2 | BUG | The studio shows "Site font" text in a different font from the website |
| F-11-20 | S2 | BUG | The studio draws text as plain boxes; the website draws headings (h1/h2) and paragraphs |
| F-11-21 | S2 | WEAKNESS | Height and text size do not grow in step with the width; positions do |
| F-11-22 | S2 | WEAKNESS | Only two preview widths (1408 and 390); laptops, tablets and most phones are never seen |
| F-11-23 | S3 | WEAKNESS | Banners are mounted at other widths than the studio's (Specials/Loyalty 1344, Shop up to 1920) |
| F-11-24 | S3 | GAP | No "check on the real page" from inside the studio |
| F-11-25 | S3 | WEAKNESS | Checks look at one width only, and no test guards studio = website |
| F-11-26 | S3 | GAP | Scheduling is different in each place (repeats and fallback on home slides only; calendar on one page) |
| F-11-27 | S3 | GAP | No "preview the site as of a date" |
| F-11-28 | S3 | GAP | Creative Studio results cannot be sent to a banner |
| F-11-29 | S2 | GAP | No advertising-rule check on AI pictures or banners |
| F-11-30 | S4 | WEAKNESS | Save to brand uses a browser prompt box |
| F-11-31 | S3 | GAP | Help is one long line, static hints and a few hover titles; no studio helper or concierge topic |
| F-11-32 | S3 | WEAKNESS | The recommended picture shape does not match the banner shape |
| F-11-C2 | — | STRENGTH | What already works well |

### B.2 The six causes of "it moved on the website"

| # | Cause | Size of the effect | Fix |
|---|---|---|---|
| 1 | Font: "Site font" = Arial in the studio, the system font live (F-11-19) | Every line of text; different widths mean different wraps, so boxes below move | C-1 (G-94) |
| 2 | Tags: div in the studio, h1/h2/p live (F-11-20) | Headings take the heading font live | C-1 (G-95) |
| 3 | Fluid, not proportional, sizes (F-11-21) | Shape 3.91 at 1408 → 3.42 at 1024 → 2.96 at 768; headline +15% at 1024, +34% at 768 | C-3 (G-96) |
| 4 | Two preview widths only (F-11-22) | 768–1407 px and real phone widths never seen | C-2 (G-97) |
| 5 | Mount widths differ (F-11-23) | Shop at 1856 px: shape 6.63 vs 5.03; headline −24% | C-3 (G-100) |
| 6 | Picture crop shifts with the shape (F-11-32) | Text and the picture's subject drift apart | C-5 (G-101) |

### B.3 The numbers (from the site's own formula)

Home banner (computer layout 1408×360, phone 390×200), headline 56 px computer / 32 px phone (computed with `interpPx`, `banner-design-core.ts` L919–925):

| Banner width | Height | Shape (width ÷ height) | Headline | "In proportion" | Difference |
|---|---|---|---|---|---|
| 1408 (studio) | 360 | 3.91 | 56.0 | 56.0 | 0% |
| 1376 | 355 | 3.88 | 55.2 | 54.7 | +1% |
| 1216 (1280 window) | 330 | 3.69 | 51.5 | 48.4 | +6% |
| 1100 | 312 | 3.53 | 48.7 | 43.8 | +11% |
| 1024 | 300 | 3.42 | 46.9 | 40.7 | +15% |
| 800 | 264 | 3.03 | 41.7 | 31.8 | +31% |
| 768 | 259 | 2.96 | 40.9 | 30.5 | +34% |

Phone layout (studio 390×200, ratio 1.95):

| Phone screen | Banner width | Shape | Headline vs in proportion |
|---|---|---|---|
| 360 | 328 | 1.64 | +19% |
| 375 | 343 | 1.72 | +14% |
| 390 | 358 | 1.79 | +9% |
| 414 | 382 | 1.91 | +2% |
| 430 | 398 | 1.98 | −1% |

Shop banner (1408×280 in the studio, ratio 5.03): at 1856 px wide it is 280 px high, shape 6.63, headline 56 px where 73.8 px would be in proportion (−24%).

**What this means:** a headline placed at 30% from the top with a subhead at 62% has a fixed gap in percent, but the headline itself gets relatively taller at narrower widths, so it runs into the subhead. Moving items in the studio at 1408 cannot show this.

### B.4 The strategy in one paragraph

Fix the cheap, certain causes first (fonts and tags, C-1), then let you **see** every width (a width slider with the real placement widths and a one-click real-page check, C-2), then remove the root cause with a **Scale mode** that makes a banner behave like a picture (C-3, re-using the card pattern that already works), then **guard** it with an automatic test so it can never drift again (C-4). The picture shape and safe area (C-5), help and hand-holding (C-6), scheduling (C-7) and the Creative-to-banner handoff with the advertising check (C-8) follow. Each slice is small, tested and reversible; existing banners keep their look until you switch them.

### B.5 Gaps (also in `05-GAP-REGISTER.md`)

| Gap | What | Findings |
|---|---|---|
| G-94 | The studio loads the site's heading/body fonts (same CSS variables as the website), and warns when banner text uses System default | F-11-19 |
| G-95 | The studio draws the same tags as the website (h1/h2/p by role), with the same heading rule | F-11-20 |
| G-96 | **Scale mode**: a per-banner "Scale with the banner" switch (cqw units, aspect ratio, like cards); default for new banners (Q-11-10); optional Figma-style pins (left/right/centre) | F-11-21, F-11-23 |
| G-97 | **Width slider** with stops for every real placement (1408, 1344, 1216, 1024, 834, 430, 390, 360) and the Shop's 1920; a "show all widths" strip | F-11-22 |
| G-98 | **"Check on the real page"** button in every banner editor: opens Website Sync at that page and width with Move mode on | F-11-24 |
| G-99 | **Drift guard**: a Playwright test that renders a fixed set of designs in the studio and on the site at the stop widths and compares each item's box (≤1% of width); the Checks tab runs overlap/out-of-frame at every stop, phone included (**built v2.4**: the guard compares the CSS both real components emit, evaluated at each stop, because CI has no browser) | F-11-25 |
| G-100 | Each placement registers its real max width; the Shop banner either caps at 1408 or uses Scale mode (Q-11-12) | F-11-23 |
| G-101 | Picture shape advice that matches the banner (per placement), a safe-area overlay in the studio, and a "subject is near the crop edge" hint | F-11-32 |
| G-102 | One schedule everywhere: repeats and fallback for Shop slides and type cards; the calendar on Shop Banner and on Schedule & Releases; type cards, Loyalty and Specials banners on the Schedule page | F-11-26 |
| G-103 | **Preview as of** a date and time (with earlier releases applied) | F-11-27 |
| G-104 | Creative Studio → **Use in a banner** (pick the editor and slide), and placement sizes taken from the real banner | F-11-28 |
| G-105 | Advertising-rule check: words in the banner text and the AI prompt against the bans; a short "I checked the picture for minors appeal" tick before Publish or Schedule (warn, Q-11-14) | F-11-29 |
| G-106 | Help and hand-holding: a tooltip component (hover and keyboard), a **?** key shortcut sheet, a dismissible first-use tour of the studio, a "Make a banner" step strip (picture → text → phone → check → publish), a `banner-studio` helper, concierge topics `banner-studio`, `branding`, `content-schedule`, empty states that say what to do | F-11-31 |
| G-107 | A proper name dialog for Save to brand | F-11-30 |

### B.6 Proposed build order (also in `06-FIX-PHASE-PLAN.md`, all PROPOSED)

| Order | Slice | Gaps | Why this order |
|---|---|---|---|
| C-1 | Fonts and tags: studio = website | G-94, G-95 | Biggest, cheapest cause; no data change |
| C-2 | Width slider, real placement widths, "Check on the real page" | G-97, G-98 | See the problem before changing the model |
| C-3 | Scale mode (new banners), Shop width | G-96, G-100 | Removes the root cause; needs Q-11-10 … Q-11-13 |
| C-4 | Drift guard test and multi-width checks | G-99 | Locks C-1 … C-3 in |
| C-5 | Picture shape, safe area, crop hint | G-101 | Builds on C-3's fixed shape |
| C-6 | Help and hand-holding; name dialog | G-106, G-107 | Written once the studio is stable |
| C-7 | One schedule everywhere; calendar; preview as of | G-102, G-103 | Independent; Q-11-16 |
| C-8 | Creative → banner; advertising check | G-104, G-105 | Q-11-14 **Answered D234:** *warn with tick* |

Rules for every slice: pure core + self-tests; one compliance test file per slice (`tests/compliance/d233-creative-c<N>-*.test.ts`); existing banners render exactly as before unless you switch them (a test proves it); SOP-11b, 00, 03, 05, 06 updated in the same PR.

## Appendix C: Owner questions

| # | Question | Our recommendation |
|---|---|---|
| Q-11-10 | Should **new** banners use Scale mode (everything grows and shrinks together, like a picture)? Existing banners keep today's look and get a "Switch to Scale" button with a before/after. | Yes, new = Scale; existing by choice. **Answered D234:** *yes* (new = Scale; existing by choice) |
| Q-11-11 | Keep a separate **Phone layout** in Scale mode? | Yes: Scale within phones and within computers, still two layouts. **Answered D234:** *yes* |
| Q-11-12 | The Shop banner on very wide screens: cap it at 1408 px (centred, like home), or keep it full width with Scale mode (it gets taller)? | Cap at 1408 px, the same as home, so one design fits both. **Answered D234:** *yes* (cap at 1408 px) |
| Q-11-13 | In Scale mode, small text could get too small on a 360 px phone. Set a floor (for example 12 px) with a warning? | Yes, 12 px floor and a Checks warning. **Answered D234:** *yes* (12 px floor + warning) |
| Q-11-14 | Advertising check: warn only, or block Publish when a banned word is found? | Warn, plus a required tick for the picture check. |
| Q-11-15 | First-use tour: show it once automatically, or only when someone presses "Show me how"? | A small "New here? 60-second tour" strip that can be dismissed and re-opened from **?**. **Answered D234:** *I agree with your recommendation.* |
| Q-11-16 | Give Shop slides and type cards the same repeats (days/hours) and fallback as home slides? | Yes. **Answered D234:** *yes* |
| Q-11-17 | Approve Phase C (C-1 … C-8) in that order, two slices per message? | Yes. **Answered D234:** *"I approve and agree."* |
| Q-11-18 | Pick a web font for site headings (Branding → Fonts) instead of System default, so every visitor sees the same font? | Yes; any library font. This is a setting, not code. **Answered D234:** *yes, setting not code* (Branding → Fonts) |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 2.0 | 2026-11-11 | First version of the second half (recon, audit and roadmap only, no code changed, D233). Creative Studio, Branding, the Banner Design Studio and scheduling procedures; the interim placement procedure (§4.9) and the real-page check (§4.10); six drift causes with numbers; 14 findings (F-11-19 … F-11-32 + F-11-C2); 14 gaps (G-94 … G-107); Phase C (C-1 … C-8) PROPOSED; questions Q-11-10 … Q-11-18. | Greenway Dev |
| 2.1 | 2026-11-11 | Phase C approved (D234, all of Q-11-10 … Q-11-18 answered). Slice C-1 (#1764): the studio reads the website's Heading/Body fonts and draws the website's tags (h2/p/span); new Checks message for System default (§4.9 note, §5). | Greenway Dev |
| 2.2 | 2026-11-11 | Slice C-2 (#1765): Banner width slider with the site's real widths, and ↗ Check on the real page (Website Sync, page, size, Move mode on) (§4.10, §4.9 step 7). | Greenway Dev |
| 2.3 | 2026-11-11 | Slice C-3 (#1766): Scale mode (new banners start in it; Switch to Scale with a before/after for existing ones; separate Phone layout; 12 px floor + Checks message). The Shop banner is capped at 1408 px (§4.9 note, §5, §6.3, §9.3, §10). | Greenway Dev |
| 2.4 | 2026-11-11 | Slice C-4 (#PC4): drift guard (a test renders the real studio and the real website banner at every width stop; they must agree within 1% of the width) and Checks at every width, phone included (§5). | Greenway Dev |
