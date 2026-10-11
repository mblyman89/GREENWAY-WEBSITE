# R41 — WEBSITE EDITOR BIBLE

> This document is the binding plan for round R41. It is written for the agent
> doing the work, not for marketing. Read it before every slice, and re-read the
> slice section before every commit. If code and this bible disagree, STOP,
> re-verify the code, then fix the bible in the same PR before writing code.

Branch for this document: `r41-editor-bible`, started from main `eafcbffd`
("R40: record merge and production verification").

---

## PART 0 — HOW TO USE THIS BIBLE

0.1 Every slice section has: Goal, Owner words it answers, Grounding (file:line
anchors verified at `eafcbffd`), Design, Data shape, Files to touch, Pure core +
tests, UI, Acceptance criteria, Owner test steps, Risks, Rollback.

0.2 Anchors are written `path:Lstart-Lend` and were read at commit `eafcbffd`.
Before editing a file named in an anchor, run `git diff eafcbffd -- <path>` (or
`git log --oneline eafcbffd..HEAD -- <path>`). If the file moved, re-read it and
update the anchor in this bible in the same commit.

0.3 The status checklist (PART 12) is the single place progress is recorded.
Tick a box only with concrete evidence (commit SHA, PR number, prod status).

0.4 Commit cadence: the owner said the sandbox is unstable. Commit and push the
branch after every meaningful file (never hold more than ~1 file of unpushed
work). A WIP commit message prefix `R41 WIP:` is fine on a branch; the PR is
rebase-merged, so WIP commits land as-is — keep them buildable when possible,
and always make the LAST commit of a PR buildable (tsc/eslint/build green).

0.5 No self-testing beyond build gates. The owner said: "You don't need to do any
of your own testing, built it the best you can, tell me how to test it." The
build gates (tsc 0, eslint 0, next build ok, pure self-tests) are still
mandatory because AGENTS.md rule 5 makes them the merge gate; they are not
"testing the feature", they are proving the code compiles and the pure logic
holds. Do NOT click through the site, do NOT run Playwright, do NOT run vitest
suites beyond the pure self-test runner unless a build gate requires it.

---

## PART 1 — THE OWNER'S REQUEST, VERBATIM (AGENTS.md rule 1)

Recorded word-for-word from the owner's message that opened R41:

> This round is meant to enhance the website editor. All of it. Starting with
> the Home page website editor, the type cards, I need the ability to edit the
> names of the cards. As well as the ability to create and delete additional
> cards. Home sections text alignment does not work. I need much better more
> powerful text alignment options. Is there a way to manually drag the text
> boxes around… better control of text wrapping, the ability to press enter to
> create a new line, etc. Loyalty signup page legal wording editing. The website
> editor says I can't edit it, but it's mine to edit, please let me edit it.
> Specials page editor does work. It needs a lot of work to make it fully
> editable and functional. It has a button in the banner but I can't edit it,
> remove it or add one. Nor can I repoint the buttons. I want all the banners
> from every page to allow me to move the text around in many more ways…
> control text size and font and things like bold and italics and underlines
> and strike throughs… The editor in the back office should have one preview
> window in the hub. Every page in that window should allow me to grab the text
> box and move it. In the actual pages editors, I should have a plethora of
> options… text color too… Image options too. Deep research… enterprise
> grade… Maybe add ai to help me focus the image just right and to place the
> text boxes properly. Give me the ability to create new text boxes, but with
> purpose. Research what the different text boxes are and their purpose and the
> dos and dont's of combining text with images in website banners… Let me be
> able to move the buttons around. Change the size and style and color of them.
> Make it easy for me to link a redirect in the button, specifically… menu
> filtered for something. Or… blog and newsletter page, to link a specific page
> or blog… Follow the standing rules (agents.md) and never guess, never assume.
> You don't need to do any of your own testing, built it the best you can, tell
> me how to test it… Please create a very comprehensive roadmap strategy. It
> needs to be a several thousand line document that you will follow
> religiously… pin and anchor code lines… document findings based on code
> audits and recon… Make sure to break it up into multiple slices. Make sure to
> commit work very frequently, the sandbox environment is very unstable…
> Please give me very detailed summary reports so I know what to test and how
> to test it…

(The "…" marks are the owner's own elisions as captured in the session
transcript summary; the full message is preserved in the session transcript.)

### 1.1 The request decomposed into numbered requirements

Each requirement gets an ID used everywhere else in this bible.

| ID | Requirement (owner's words, condensed) | Slice |
| --- | --- | --- |
| Q1 | Home Type Cards: edit the NAMES of the cards | S3 |
| Q2 | Home Type Cards: CREATE additional cards | S3 |
| Q3 | Home Type Cards: DELETE cards | S3 |
| Q4 | Home sections text alignment "does not work" — fix it | S2 |
| Q5 | Much more powerful text alignment options | S1, S2 |
| Q6 | Manually DRAG text boxes around | S2 (editor canvas), S7 (hub preview) |
| Q7 | Better control of text WRAPPING | S1, S2 |
| Q8 | Press ENTER to create a new line | S1, S2 |
| Q9 | Loyalty signup legal wording — "it's mine to edit, please let me edit it" | S5 |
| Q10 | Specials editor: make it fully editable and functional | S4 |
| Q11 | Specials banner button: edit / remove / add / repoint | S4 |
| Q12 | ALL banners on EVERY page: move text in many more ways | S1, S2, S4, S6 |
| Q13 | Text SIZE and FONT control | S1, S2 |
| Q14 | Bold / italic / underline / strikethrough | S1, S2 |
| Q15 | One preview window in the HUB | S7 |
| Q16 | Every page in that hub window: grab a text box and move it | S7 |
| Q17 | "Plethora of options" in the page editors | S2 |
| Q18 | Text COLOR | S1, S2 |
| Q19 | IMAGE options too | S1, S2 |
| Q20 | Deep research, enterprise grade | PART 3, all slices |
| Q21 | AI to help focus the image and place text boxes | S8 |
| Q22 | Create NEW text boxes, "with purpose" (roles + dos/don'ts) | S1, S2 |
| Q23 | Move buttons around | S1, S2 |
| Q24 | Change button size / style / color | S1, S2 |
| Q25 | Easy link picker: menu filtered for something | S1 (link core), S2 (picker UI) |
| Q26 | Easy link picker: a specific blog post / newsletter page | S1, S2 |
| Q27 | Follow AGENTS.md; never guess, never assume | all |
| Q28 | No self-testing; detailed "how to test" reports | PART 11 + final report |
| Q29 | Several-thousand-line roadmap with code anchors + audit findings, multiple slices | this file |
| Q30 | Commit very frequently | PART 0.4 |

---

## PART 2 — STANDING RULES THAT BIND THIS ROUND (from AGENTS.md)

Copied in substance from `AGENTS.md` (188 lines at `eafcbffd`). The file is
authoritative; this is a working reminder.

2.1 Rule 1 — record every request verbatim (PART 1 above).

2.2 Rule 2 — deep-research, cite authoritative sources, never guess. If unsure,
STOP and ask. PART 3 holds the research with URLs.

2.3 Rule 3 — AI / machine output is DRAFTS-ONLY. S8 (AI focus/placement) must
write suggestions into the editor's unsaved state or into a draft, never publish.
The owner must press Save/Publish.

2.4 Rule 4 — walk the file tree; reuse verified work. Specifically reuse:
- `src/lib/cms/fonts.ts` `FONT_OPTIONS` / `fontStack()` (do NOT add a second font
  system).
- `src/lib/loyalty/loyalty-hero-core.ts` HERO_FONTS / HERO_COLORS vocabulary
  where it fits (the new design core must stay compatible, not fork the meaning
  of an existing id).
- `src/components/admin/ContentImageField.tsx` (Media Library picker).
- `src/components/admin/PreviewFrame.tsx` + `src/components/site/PreviewEditOverlay.tsx`
  postMessage plumbing (origin-checked) for S7.
- `src/lib/ai/provider.ts` `generateVision` for S8.
- `src/lib/cms/content-store.ts` draft → publish → revision machinery.

2.5 Rule 5 — each slice: ground → PURE `*-core.ts` + `__run…Tests()` → verify
(tsc 0, eslint 0, next build ok) → branch → PR → rebase-merge → sync main.
Pure self-tests are registered in `scripts/compliance/run-pure-selftests.ts`
with `assertRan("<name>", __runX(), <minAssertions>)`. The runner's
`assertRan` (scripts/compliance/run-pure-selftests.ts:L1038-L1053) requires the
result shape `{ passed: number; failed: number }` and a floor of assertions.

2.6 Rule 6 — `main` is protected; rebase merge only:
`gh pr merge <n> --rebase --delete-branch --admin`. NEVER squash (squash rewrites
author to `superninja-app[bot]` → Vercel BLOCKED). After merge:
`git fetch origin && git reset --hard origin/main`.

2.7 Rule 7 — every commit authored `Greenway Dev <dev@greenwaymarijuana.com>`.
Set at the start of each session:
```
git config user.name  "Greenway Dev"
git config user.email "dev@greenwaymarijuana.com"
```

2.8 Push URL:
`git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git <branch>`

2.9 Migrations: idempotent; owner applies manually in the Supabase SQL editor.
Latest at `eafcbffd`: `0263_ach_operations.sql`. Any R41 migration is `0264_…`.

2.10 Rule 13 — staging paused; ignore `greenway-staging` and "Supabase Preview".
Merge gate = CI `build`, `compliance`, `migrations` green. After merge verify
prod:
```
gh api repos/mblyman89/GREENWAY-WEBSITE/commits/<sha>/status \
  --jq '.statuses[]|select(.context=="Vercel – greenway_website")|.state'
```
until `success`.

2.11 Next.js here is 16.2.9 (non-standard). Read `node_modules/next/dist/docs/`
before using an API you are not sure of. Known facts used in this round:
`draftMode()` is async (`(await draftMode()).isEnabled`, used at
`src/lib/cms/page-sections-store.ts:L158-L163`); `"use server"` files may only
export async functions (constants must live in plain modules — the pattern used
by `LOYALTY_HERO_PRESENTATION_BLOCK` in `src/lib/loyalty/loyalty-hero-core.ts:L48`).

2.12 Money rule (cents) and Pacific clock (rules 8, 9) are not expected to apply
to this round; if any slice touches dates (e.g. consent timestamp), anchor to
Pacific for display, store ISO UTC as today.

2.13 Cannabis advertising law applies to banner CONTENT (WAC 314-55-155, PART 3.5).
The editor must not remove existing legally required text and should warn, not
block, when an owner composes content that triggers a known rule.

---

## PART 3 — RESEARCH (authoritative sources, quoted where it matters)

### 3.1 WCAG contrast (W3C)

Source: WCAG 2.2 SC 1.4.3 Contrast (Minimum), https://www.w3.org/TR/WCAG22/#contrast-minimum
(cited by NN/g below). Facts used:
- Normal text: contrast ratio at least **4.5:1**.
- Large text: at least **3:1**. "Large" = at least 18 point, or 14 point bold.
  In CSS pixels: 18pt = 24px; 14pt = 18.66px (≈ 18.67px).
- Relative luminance formula (WCAG definition): for each sRGB channel c in
  [0,1]: c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4 (WCAG 2.2 text uses
  0.04045; older text said 0.03928 — the difference never changes a result at
  8-bit precision). L = 0.2126 R + 0.7152 G + 0.0722 B.
  Contrast = (L1 + 0.05) / (L2 + 0.05), L1 the lighter.
- Implementation note for banners: the background under text over a PHOTO is
  not a single color. The pure core can only compute contrast against a known
  color: (a) the text box's own backdrop color (strip/box) composited over the
  overlay color, or (b) the overlay color at its opacity composited over a
  worst-case image pixel (white for light text failing, black for dark text).
  We compute the WORST CASE: overlay composited over white (for light text) and
  over black (for dark text), and warn when the worst case fails. This matches
  NN/g's instruction to "provide a high enough contrast for the worst-case
  background image and text placement".

### 3.2 Nielsen Norman Group — "Ensure High Contrast for Text Over Images"

Source: https://www.nngroup.com/articles/text-over-images (Aurora Harley,
2015, last reviewed Jan. 13, 2026). Verbatim quotes used for in-editor tips:
- "text that is not purely decorative or part of a logo should have a contrast
  ratio of at least 4.5:1 (or 3:1 for large characters, defined as an 18-point
  font or a 14-point bold font)."
- "Light-colored or faded backgrounds are not well-suited to white text because
  the colors are too similar."
- "The lower portion of photos tends to lend itself well to added effects such
  as a blur, a darkening-gradient overlay (AKA "floor fade"), or a
  semitransparent colored background for that area of text."
- REI example: increasing a box's opacity "to 50% instead of 30%" made white
  text pass 3:1.
- "If both dark and light images are included in a design, ensure that the
  chosen method will provide a high enough contrast for the worst-case
  background image and text placement."
- Conclusion techniques: "a semiopaque overlay (either covering the entire image
  or just the text portion), a blur, a text shadow or outline, or a combination".

These five techniques become the OVERLAY / TEXT-BACKDROP options in S1:
`none`, `full` (whole-image tint), `gradient` (side/floor fade toward the text),
`box` (semi-opaque box behind ONE text box), `blur` (backdrop blur behind a box),
plus per-text `shadow` and `outline`.

### 3.3 Smashing Magazine — Designing Accessible Text Over Images (Parts 1, 2)

Sources: https://www.smashingmagazine.com/2023/08/designing-accessible-text-over-images-part1
and …part2. Used only as corroboration for the same technique list (overlay,
gradient scrim, text box/highlight, blur, text shadow, choosing images with
"copy space"). No numbers taken from it that are not already in 3.1/3.2.

### 3.4 Text box ROLES ("with purpose") — what each box is for

The owner asked: "Give me the ability to create new text boxes, but with
purpose. Research what the different text boxes are and their purpose".
Roles adopted (industry-standard banner hierarchy; each role maps to a semantic
HTML element so screen readers and SEO get the right outline):

| Role | Purpose | HTML | Default size (desktop/mobile px) | Dos | Don'ts |
| --- | --- | --- | --- | --- | --- |
| eyebrow (kicker) | Short label that sets context above the headline ("Today's Deal") | `p` | 12 / 10 | 1–4 words, uppercase ok, accent color | Don't make it bigger than the headline |
| headline | The one main message | `h2` (or `h1` for a page's top hero) | 48 / 24 | ≤ 8 words, strongest contrast | Only ONE headline per banner |
| subhead | Supports the headline with a benefit | `p` | 16 / 12 | ≤ 20 words | Don't repeat the headline |
| body | Longer supporting copy | `p` | 14 / 12 | ≤ 2 short sentences on a banner | Don't put paragraphs on photos without a box |
| badge | A sticker/price/limited-time callout ("20% OFF") | `span` in a pill | 14 / 12 | High-contrast pill | No more than one or two |
| legal | Fine print / required notices (e.g. "21+") | `p` (small) | 11 / 10 | Must remain readable (contrast) | Never hide required text; never below the WAC size rule when it is a required warning (3.5) |
| button (CTA) | The action | `a` styled as button | 14 / 12 | Verb-first label ("Shop flower") | Max 2 primary actions; don't use for non-links |

Validation rules derived (warnings, not blocks):
- More than one `headline` → warn "Use only one headline per banner."
- A text box with role `headline` whose text exceeds 60 characters → warn
  "Headlines read best under ~8 words."
- More than 2 enabled buttons → warn "More than two buttons dilutes the
  action." (hard cap stays 4, matching `parseButtons` cap at
  `src/app/admin/pages/[slug]/actions.ts:L50-L72`).
- Any text failing worst-case contrast (3.1) → warn with the measured ratio.
- A text box that would extend outside the banner (x + width > 100) → clamp
  and warn.

### 3.5 Washington cannabis advertising — WAC 314-55-155 (fetched live)

Source: https://apps.leg.wa.gov/wac/default.aspx?cite=314-55-155 (current text
shows "WSR 26-12-082 … filed 6/3/26, effective 7/4/26"). Verbatim excerpts that
can touch banner CONTENT:
- (2)(a): advertising "must not contain any statement, or illustration that:
  (i) Is false or misleading; (ii) Promotes over consumption; … (vii) Represents
  that the use of cannabis has curative or therapeutic effects; (viii) Depicts a
  child … or (B) Is designed in any manner that would be especially appealing to
  children or other persons under 21 years of age."
- (2)(c): "All advertising for cannabis businesses or cannabis products,
  regardless of what medium is used, except for trade name signs, must contain
  text that is clearly visible during business hours stating that cannabis
  products may be purchased or possessed only by persons 21 years of age or
  older. Examples of language that conforms to this requirement include, but are
  not limited to: "21+," "for use by persons 21 and over only," etc."
- (7): "Except for outdoor advertising under subsection (3) of this section, all
  advertising must contain the following warnings that must be in type size at
  least 10 percent of the largest type used in the advertisement: (a) "This
  product has intoxicating effects and may be habit forming."; (b) "Cannabis can
  impair concentration, coordination, and judgment. Do not operate a vehicle or
  machinery under the influence of this drug."; (c) "There may be health risks
  associated with consumption of this product."; and (d) "For use only by adults
  21 and older. Keep out of the reach of children.""

How the site currently satisfies this: the site-wide footer carries 21+/warning
text (`grep` found matches in `src/components/site/Footer.tsx` and
`src/components/site/navigation-data.ts`). R41 does NOT change the footer. R41
does NOT decide whether each individual banner is an "advertisement" needing its
own warnings — that is a legal judgment (rule 2: if unsure, do not guess). The
editor will:
- never delete any existing text automatically;
- show an informational tip in the text-box panel: "Washington ad rules (WAC
  314-55-155) apply to banner words: no health/cure claims, nothing appealing to
  kids, and 21+ notices must stay readable." with the source link;
- add a `legal` role text box option so the owner can put "21+" or warnings on a
  banner if he chooses, and enforce (warn) that a legal box's size is at least
  10% of the largest type in that banner — this mirrors WAC 314-55-155(7) type
  size rule as a WARNING (the owner decides applicability).
- Recorded as open question OQ-1 (PART 10) for the owner/his counsel.

### 3.6 TCPA — consent wording (Loyalty signup)

Source: 47 CFR 64.1200(f)(9) (eCFR, https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200).
Definition of "prior express written consent" (substance, quoted in the R41
recon): an agreement in writing bearing the signature of the person called that
clearly authorizes the seller to deliver or cause to be delivered to the person
called advertisements or telemarketing messages using an automatic telephone
dialing system or an artificial or prerecorded voice, and the telephone number
to which the signatory authorizes such advertisements or telemarketing messages
to be delivered; and the written agreement shall include a clear and
conspicuous disclosure informing the person signing that (A) by executing the
agreement, such person authorizes the seller to deliver or cause to be
delivered to the signatory telemarketing calls using an automatic telephone
dialing system or an artificial or prerecorded voice; and (B) the person is not
required to sign the agreement (directly or indirectly), or agree to enter into
such an agreement as a condition of purchasing any property, goods, or
services. E-SIGN signatures count.

Re-verify the exact eCFR wording at the start of S5 (scrape the eCFR URL) and
paste the verbatim paragraph into the S5 section before coding the checker.

Current consent text (hardcoded) at
`src/components/loyalty/LoyaltySignupForm.tsx:L9-L10`, verbatim:

> By signing up, I consent to enroll in the member list, understanding that I
> will receive marketing communications, including, but not limited to,
> advertisements, through text messages, calls either through an automatic
> telephone dialing system or artificial or prerecorded voice call, emails, or
> other outreach channels. By doing so, I understand that I am allowing
> Greenway Marijuana to retain my personal contact details and engagement
> history for use in personalized marketing communications. I understand that I
> may opt-out of text messages at any time by replying "STOP". Standard
> messaging and calling rates may apply. I affirm that I am of legal age to
> receive communications related to the services and products being
> advertised. Consent is not a condition of purchase.

Decision: the owner owns this text ("it's mine to edit"). We make it editable
and add NON-BLOCKING warnings when an edit drops an element the TCPA definition
or common carrier practice expects:
- W-ATDS: mentions an automatic telephone dialing system / autodialer, or
  artificial/prerecorded voice (definition element).
- W-NOT-CONDITION: says consent is not a condition of purchase (element B).
- W-STOP: tells how to opt out of texts (carrier/CTIA practice; not in the CFR
  definition — label it "industry practice", not "law").
- W-RATES: "message and data rates may apply" (CTIA practice — label "industry
  practice").
- W-AGE: affirms legal age (business practice; 21+ store).
- W-SELLER: names the seller (Greenway Marijuana) (definition: "authorizes the
  seller").
- W-EMPTY: blank text → BLOCK publish (an empty consent label is never valid;
  the checkbox would have no disclosure). This is the only blocking rule.
And record WHICH consent text the customer saw (version) on each signup — see
S5 (migration 0264, optional column; code must work before the owner applies it).

### 3.7 Drag-to-position — technical facts

- Pointer Events (W3C) give one API for mouse, touch and pen:
  `pointerdown` + `setPointerCapture(pointerId)` + `pointermove` + `pointerup`.
  Using capture keeps the drag alive when the pointer leaves the element.
- Position storage as PERCENT of the banner box (x%, y% of the top-left corner
  or of an anchor point) keeps layouts responsive; pixels would break across
  device widths.
- Keyboard accessibility for drag (WCAG 2.1.1 Keyboard; 2.5.7 Dragging
  Movements, WCAG 2.2): "All functionality that uses a dragging movement for
  operation can be achieved by a single pointer without dragging" → every drag
  must have a non-drag alternative: numeric X/Y inputs and arrow-key nudges
  (1% per press, 5% with Shift). This is a hard requirement for S2/S7.
- Snap: snap to 0/50/100% guides within 2% to make centering easy.

### 3.8 Cross-frame messaging (hub preview drag, S7)

- `window.postMessage(message, targetOrigin)` with an explicit origin; the
  receiver must check `event.origin === window.location.origin` (already done
  in `PreviewFrame.tsx:L45-L55`). The preview iframe is same-origin (served
  through `/api/admin/preview/enable?path=`), so the parent can also read
  `iframe.contentWindow` directly, but we keep postMessage for isolation.
- Never trust message payloads: validate type, keys and number ranges in a pure
  core before saving.

### 3.9 AI vision (S8)

- Existing function: `src/lib/ai/provider.ts` `generateVision(opts)` at
  `:L454` posts to `${AI_BASE_URL}/chat/completions` with an `image_url`
  content part; `max_tokens` default 200; throws `AiNotConfiguredError` when
  `isAiConfigured` is false. Existing callers: `src/app/admin/media/actions.ts`
  (`:L324`, `:L401`, `:L569`) — the alt-text caller passes `COMPLIANCE_SYSTEM`.
- The AI must return strict JSON (focal point x/y %, suggested text zone,
  suggested overlay). Parse with a PURE validator (clamp 0–100, reject
  anything else). The result is a DRAFT the owner can Apply or Ignore (rule 3).
- Image URL must be fetchable by the AI provider (public URL); the media helper
  `publicUrlForKey` is used in media actions. For local `/brand/...` or
  `/home/...` paths, build an absolute URL from the site origin
  (`publicSiteOrigin` in `src/lib/site/site-domain-core.ts:L29`).

---

## PART 4 — RECON FINDINGS (code audit at `eafcbffd`, verbatim where it matters)

Every finding has an ID (F-xx). Slices cite these IDs.

### 4.1 Home page render path

F-01 `src/app/page.tsx` (156 lines) — the home page server component.
- `:L72-L99` one `Promise.all` loads content, slides, deal items, vendor
  profiles and `getSectionsForRender("home")` (`:L87`).
- `:L113-L114` finds the two banner sections by key:
  ```ts
  const category = sections.find((s) => s.key === "home.category");
  const brand = sections.find((s) => s.key === "home.brand");
  ```
- `:L119` `const homeSettings = sections.find((s) => s.key === "home.settings");`
- `:L127` `const laneImages = readLaneImages(category?.settings);`
- `:L135-L151` renders `<PromoGrid vendors brandCount laneImages content={{ … }} />`
  where `content` carries ONLY: categoryImage, categoryEyebrow, categoryTitle,
  categorySubtitle, brandImage, brandEyebrow, brandTitle, brandSubtitle,
  editable. Verbatim:
  ```ts
  content={{
    categoryImage: category?.image || copy["home.category.image"],
    categoryEyebrow: category?.eyebrow || copy["home.category.eyebrow"],
    categoryTitle: category?.title || copy["home.category.title"],
    categorySubtitle:
      category?.subtitle || copy["home.category.subtitle"],
    brandImage: brand?.image || copy["home.brand.image"],
    brandEyebrow: brand?.eyebrow || copy["home.brand.eyebrow"],
    brandTitle: brand?.title || copy["home.brand.title"],
    brandSubtitle: brand?.subtitle || copy["home.brand.subtitle"],
    editable: preview,
  }}
  ```
- **ROOT CAUSE of Q4 ("Home sections text alignment does not work")**: the
  section's `textAlign`, `imageFocus` and `buttons` are resolved by the store
  (`resolveForRender`, F-07) but are NEVER passed to `PromoGrid`, so the owner's
  alignment / focus / button choices in the editor are silently dropped.
- Extra home sections (owner-added banners beyond category/brand) are not
  rendered anywhere on the home page: `page.tsx` only reads the three keys
  above. (Confirmed: no `extras` usage in `src/app/page.tsx`.) The editor caps
  home at 5 (`PAGE_SECTION_CONFIG.home.cap`), so an owner can ADD a home banner
  in the editor that never appears. → S2 renders home extras after the brand
  section (additive; nothing renders when there are none).

F-02 `src/components/home/PromoGrid.tsx` (138 lines).
- `:L22-L32` `export type PromoBannerContent` = the 9 fields above. No
  textAlign / verticalAlign / imageFocus / buttons / design.
- `:L63-L74` category `<SectionBanner … editable blockKeyPrefix="home.category" />`
  without textAlign / imageFocus / buttons.
- `:L77` iterates the fixed `categoryLanes` (F-05) — the six Type Cards.
- `:L80` `const image = laneImages?.[lane.key as HomeTypeLaneKey] || "";`
- `:L84` `href={lane.href}`; `:L118` label `{lane.label}`; `:L121` fixed
  "Shop now →".
- `:L132-L136` renders `<HomeBrands vendors content count={brandCount} />`.
- Pinned by `tests/compliance/home-editor-superpowers.test.ts:L133-L136`
  ("PromoGrid forwards brandCount to HomeBrands": `brandCount`, `count={brandCount}`).
  Keep both strings.

F-03 `src/components/home/HomeBrands.tsx` (92 lines, client).
- `:L62-L73` brand `<SectionBanner … blockKeyPrefix="home.brand" />`, same
  omission as F-02.
- Vendor cards link `/menu?vendors=<name>` (comment at `:L77-L78`).
- Pinned by `home-editor-superpowers.test.ts:L124-L130` (`count =
  HOME_CARD_COUNT_DEFAULT`, `[vendors, shuffle, LIMIT]`, no `const LIMIT = 16`).

F-04 `src/components/home/SectionBanner.tsx` (196 lines) — the shared banner.
- Props `:L48-L87`: imageSrc, imageAlt, eyebrow, title, titleClassName,
  subtitle, buttons, priority, editable, blockKeyPrefix, textAlign (default
  "left"), verticalAlign (default "center"), imageFocus (optional).
- `:L91-L100` gradient chosen by textAlign (3 hardcoded Tailwind gradients).
- `:L105-L120` image object-position: explicit `imageFocus` wins, else
  `legacyObjectClass` (opposite side of text). Comment (SLICE 117) explains this
  was a bug fix; legacy kept for byte-identical callers.
- `:L121-L124` text block flex classes from textAlign/verticalAlign.
- `:L150` text container: `relative flex min-h-[5.5rem] flex-col px-5 py-4
  md:min-h-[7.5rem] md:px-9 md:py-6 ${textBlockClass}` — the banner HEIGHT is
  driven by its text (min-height), not by an aspect ratio. Important for S1/S2:
  absolute-positioned text boxes need the banner to have its own height, so the
  design mode must set an explicit min-height / aspect ratio (see S1 `frame`).
- `:L151-L172` eyebrow `p` (0.6rem→xs, green, uppercase, tracking 0.22em),
  title `h2` (2xl→4xl→5xl, black weight, uppercase, leading-none), subtitle `p`
  (0.72rem→sm, zinc-300, max-w-md→xl). All FIXED classes; no font / size /
  style / color control (Q13, Q14, Q18 gap).
- `:L163` the `{title}` is rendered as plain text inside `h2`; a typed newline
  in the DB collapses to a space because there is no `whitespace-pre-line`
  (Q8 gap). Same for eyebrow/subtitle.
- `:L173-L191` buttons: fixed styles per variant solid/outline/ghost; no size,
  color, or position control (Q23, Q24 gap).
- Pinned by `tests/compliance/specials-editor-upgrade.test.ts:L119-L142`: must
  keep the strings `textAlign = "left"`, `verticalAlign = "center"`, the two
  union types, `items-end text-right`, `items-center text-center`,
  `items-start text-left`, `justify-start`, `justify-end`, `object-cover `,
  `object-right`, `object-left`, `imageFocus`, `legacyObjectClass`.
  → The design renderer is ADDED alongside; the legacy branch stays verbatim.

F-05 `src/lib/specials/daily-deal-presentation.ts:L100-L127` — the Type Cards
are a hardcoded constant:
```ts
const laneHref = (categories: GreenwayCategory[]) => `/menu?categories=${categories.join(",")}`;
const laneDefinitions: Omit<CategoryLane, "href">[] = [
  { key: "flower", label: "Flower", categories: ["flower", "popcorn-bud", "infused-flower"] },
  { key: "prerolls", label: "Prerolls", categories: ["preroll", "blunt", "preroll-pack", "infused-preroll", "infused-blunt", "infused-preroll-pack"] },
  { key: "concentrates", label: "Concentrates", categories: ["concentrate", "rso"] },
  { key: "edibles", label: "Edibles", categories: ["edible-solid"] },
  { key: "liquids", label: "Liquids", categories: ["edible-liquid", "tincture"] },
  { key: "topicals", label: "Topicals", categories: ["topical"] },
];
export const categoryLanes: CategoryLane[] = laneDefinitions.map(...)
```
`categoryLanes` is also used elsewhere (`representativeItemForLane` at `:L130`
and the specials page). → S3 must NOT change `categoryLanes` (other callers);
it adds an owner list in `home.category` settings whose DEFAULT is derived from
`categoryLanes` (same keys, labels, hrefs) so the live page is byte-identical
until the owner edits.

F-06 `src/lib/cms/home-section-settings-core.ts` (323 lines).
- `HOME_CARD_COUNTS` `:L23`, `HOME_CARD_COUNT_DEFAULT` `:L26`,
  `DAILY_DEALS_COUNT_KEY` `:L36`, `BRAND_COUNT_KEY` `:L39`,
  `clampHomeCardCount` `:L47`.
- `LANE_IMAGES_KEY = "laneImages"`, `HOME_TYPE_LANE_KEYS` (flower, prerolls,
  concentrates, edibles, liquids, topicals), `readLaneImages`, `writeLaneImage`.
- → S3 adds `TYPE_CARDS_KEY = "typeCards"` and keeps reading `laneImages` as a
  fallback for each default card's image (so existing owner images survive).

### 4.2 Page-sections storage + store

F-07 `src/lib/cms/page-sections-store.ts` (617 lines).
- `resolveForRender` `:L127-L147` — returns key, kind, image, imageAlt,
  imageFocus (default "center"), textAlign (default "left"), eyebrow, title,
  subtitle, body, buttons, settings. Draft values win in preview.
- `getSectionsForRender` `:L155-L183` — draft-aware visible rows.
- `getPageBanners` `:L191-L208`; `BannerData` `:L210-L226` has NO textAlign and
  NO settings; `toBannerData` `:L228-L245` drops textAlign and settings.
  → S6 adds `textAlign?` and `design?` to BannerData (optional, additive).
- `saveSectionDraft` `:L413-L438` — patches draft_* incl. `draft_settings`
  when `input.settings !== undefined`.
- `publishSection` `:L442-L473` — copies draft → live incl. `settings`.
- `getHomeSectionByKey` `:L549-L561`.
- `saveHomeSectionSettings` `:L571-L597` — shallow merge, writes BOTH
  `settings` and `draft_settings`, publishes immediately.
- Storage fact (migration `supabase/migrations/0013_*.sql`): `page_sections`
  has `settings jsonb`, `draft_settings jsonb`, `buttons jsonb`,
  `image_focus text not null default 'center'` (`:L40`) and
  `text_align text not null default 'left'` (`:L41`) with NO check constraints
  on settings → a `design` object can live inside `settings.design` with NO
  migration.

F-08 `src/lib/cms/page-sections-types.ts` (142 lines).
- `SectionImageFocus`, `SectionTextAlign`, `SectionButtonVariant`,
  `SectionButton { label, href, variant, enabled }`.
- `PAGE_SECTION_CONFIG` `:L34-L68`: home (cap 5), vendors, faq, about,
  locations, price-match (cap 4). menu, loyalty, specials RETIRED (comments
  `:L40-L62`).
- F-08a: about / faq / locations / price-match pages do NOT render
  page_sections (grep: only `src/app/page.tsx`, `src/app/specials/page.tsx`,
  `src/app/loyalty/page.tsx`, `src/app/vendor-delivery/page.tsx`,
  `src/components/menu/ShopPage.tsx` call `getSectionsForRender` /
  `getPageBanners`). So banners an owner adds to FAQ/About/Locations/Price
  Match in the builder never appear. → recorded as OQ-3; S6 adds rendering of
  extras on those four pages ONLY if a safe insertion point exists (verify
  each page file at S6 time; if not, document and leave for the owner).

F-09 `src/lib/cms/page-sections-seed.ts`: seeds home.settings (locked, kind
feature, `settings: { dailyDealsCount: 16 }`), home.category
(`settings: { lanes: "category" }`), home.brand (`settings: { lanes: "brand" }`),
specials.hero (`:L108-L123`, `image_focus: "right"`, `buttons: []`),
vendors.grow, vendors.brands, menu.*, loyalty.*.

### 4.3 Home page editor (admin)

F-10 `src/app/admin/pages/[slug]/actions.ts` (310 lines).
- `revalidateForSlug` `:L41-L47`.
- `parseButtons` `:L50-L72` (reads `buttons_json`, cap 4).
- `parseSettings` `:L80-L95` (reads `settings_json`, full object, returns
  undefined when absent/invalid).
- `saveSectionAction` `:L138-L178` — builds `SectionDraftInput` from the form
  incl. `image_focus`, `text_align`, buttons, settings; `requirePermission
  ("content.edit")`; `recordAudit` action `page_section.draft`.
- `saveTypeCardImagesAction` `:L261-L290` — loops `HOME_TYPE_LANE_KEYS`,
  `lane_image_<key>`; `saveHomeSectionSettings("home.category", {laneImages})`;
  redirects `?tab=typecards&saved=1`.

F-11 `src/components/admin/SectionCard.tsx` (512 lines, client).
- State `:L92-L104`: image, imageAlt, imageFocus, textAlign, eyebrow, title,
  subtitle, body, enabled, buttons, cardCount, confirmDelete.
- Hidden inputs `:L263-L267`: image, image_focus, text_align, buttons_json,
  settings_json.
- Focus / align selects `:L293-L324`.
- Eyebrow / title / subtitle are single-line `<input>`s → pressing Enter
  submits the form instead of a new line (Q8 root cause on the editor side).
- Buttons editor `:L373-L441`: label, href free-text input, variant, show,
  remove; MAX 4. No link picker (Q25/Q26 gap).
- Settings merge preserves existing keys (`:L115` comment).
- Pinned by tests: `home-editor-superpowers.test.ts`, `menu-render-cap.test.ts`,
  `client-bundle-cjs-guard.test.ts` → read those before editing SectionCard.

F-12 `src/app/admin/pages/[slug]/page.tsx` (511 lines): tabs incl.
`TypeCardsTab` (`:L273`) → `TypeCardImagesEditor`; media choices via
`listMedia({ status: "published", limit: 200 })` (`:L123-L124`); preview link
→ `/admin/website-sync?tab=preview` (`:L136` comment).

F-13 `src/components/admin/TypeCardImagesEditor.tsx` (122 lines): hardcoded
`LANE_LABELS` record for 6 keys; one `ContentImageField` per lane; hidden
`lane_image_<key>` inputs. No name / link / add / delete (Q1–Q3 gap).

### 4.4 Specials

F-14 `src/app/specials/page.tsx`:
- `:L60` `getPageBanners("specials", ["specials.hero"])` — specials is RETIRED
  from the builder, yet the hero still reads the old row.
- `:L82` `const hero = banners.byKey["specials.hero"];`
- `:L87-L101` content: eyebrow/title/subtitle from `hero || copy`, `image:
  presentation.heroBannerImage || hero?.image`, `imageFocus: hero?.imageFocus`,
  **`buttons: hero?.buttons`**, `extraSections: banners.extras`.
- **ROOT CAUSE of Q11**: the hero button comes from the retired
  `specials.hero` page_sections row; since `/admin/pages/specials` → notFound
  (F-08), the owner has NO screen to edit/remove/add/repoint it.

F-15 `src/components/specials/SpecialsContent.tsx`:
- Hero `:L456-L572`: placement from `pres.heroBannerTextAlign`,
  `pres.heroBannerVerticalAlign`, `pres.heroBannerImageFocus`; classes
  `heroJustifyClass`, `heroColumnItemsClass`, `heroTextItemsClass`,
  `heroGradientClass` (LEFT case keeps the exact `linear-gradient(100deg,
  rgba(0,0,0,0.96)…` string — pinned by `specials-editor-upgrade.test.ts:L325`).
- Image `<img>` with `HERO_FOCUS_OBJECT_CLASS[heroImageFocus]` (pinned `:L322`).
- Eyebrow pill / `h1` title / subtitle with fixed classes and
  `data-gw-block="specials.hero.*"` in preview.
- Buttons `:L550-L570`: `content.buttons` filtered and styled (fixed).
- Today's Deal banner via `SpecialsDailyDeals` (`:L600-L606` passes
  bannerImage, count, textAlign, verticalAlign, imageFocus).
- Extras `:L608-L621` → `<SectionBanner … buttons={s.buttons} />`.

F-16 `src/lib/specials/specials-presentation-core.ts`:
- `SPECIALS_PRESENTATION_BLOCK = "specials.deals.presentation"`.
- `SPECIALS_HERO_TEXT_BLOCKS` `:L39-L43` (eyebrow/title/subtitle content
  blocks, edited on `/admin/specials` via a text panel — `admin/specials/page.tsx:L179-L189`).
- `SpecialsPresentation` type `:L140-L191`; `defaultSpecialsPresentation`;
  `normalizeSpecialsPresentation` `:L237-L330`.
- Storage: ONE content_blocks "richjson" row; draft → publish → revisions via
  `src/app/admin/specials/actions.ts` (100 lines: `saveSpecialsDraftAction`,
  `publishSpecialsAction`, `restoreSpecialsRevisionAction`).
- → S4 adds `heroButtons` (+ `heroButtonsSet` flag so "no buttons" can be
  distinguished from "never edited → fall back to legacy row buttons") and
  `heroDesign` / `todaysDealsDesign` to this JSON. No migration.

F-17 `src/components/admin/SpecialsPresentationEditor.tsx` (980 lines): tabs
`type TabKey = "hero" | "cards" | "banner"` (pinned), hero image
`setGlobal("heroBannerImage", …)` `:L282-L283`, align `:L305-L330`, focus
`:L353-L356`, live preview `:L383-L386`, save form `:L795`, restore `:L841`.

F-18 `src/components/specials/SpecialsDailyDeals.tsx:L103-L112` — the Today's
Deal `<SectionBanner>` with textAlign / verticalAlign / imageFocus (pinned
strings `imageSrc={bannerSrc}`, `textAlign={textAlign}`,
`verticalAlign={verticalAlign}`, `imageFocus={imageFocus}`).

### 4.5 Loyalty

F-19 `src/components/loyalty/LoyaltySignupForm.tsx`:
- `:L9-L10` `const consentText = "By signing up, I consent …";` (verbatim in
  PART 3.6).
- `:L54` comment: "marketing-consent disclosure and the form field labels stay
  FIXED (legal / …)".
- `:L258-L264` checkbox label renders `{consentText}` + `<FieldError
  message={errors.consent} />`.
- Pinned by `tests/compliance/loyalty-page-editor.test.ts:L165-L185`:
  ```ts
  it("the marketing-consent disclosure stays FIXED (not an editable block)", () => {
    expect(form).toContain("const consentText =");
    expect(form).toContain('replying \\"STOP\\"');
    expect(form).toContain("Consent is not a condition of purchase");
    for (const cb of LOYALTY_CONTENT_BLOCKS) {
      expect(cb.key).not.toContain("consent");
      …
  ```
  This test encodes the OLD decision. The owner has now overruled it in
  writing ("it's mine to edit, please let me edit it"), so S5 must update this
  test ON PURPOSE with the reason (owner directive R41 Q9), keeping the
  default text byte-identical (the form keeps `const consentText =` as the
  FALLBACK constant, so the first three expectations still hold).
- F-19a The registry self-test asserts `LOYALTY_CONTENT_BLOCKS.length === 8`
  (`src/lib/loyalty/loyalty-content-core.ts` self-test) and the vitest mirror
  asserts `toBe(8)` (`tests/compliance/loyalty-page-editor.test.ts:L48`).
  S5 changes both to 9 with a comment.
- F-19b The self-test runner registers loyalty-content with a bespoke line at
  `scripts/compliance/run-pure-selftests.ts:L1621` (`if (r.passed < 1)`), not
  `assertRan`. Leave that line as is.

F-20 `src/lib/loyalty/loyalty-content-core.ts`: `LoyaltyContentBlock { key,
section: "hero"|"signup"|"terms", label, help?, fallback, seoImpact? }`;
8 blocks; `resolveLoyaltyValue(key, values)` returns fallback for blank;
`isLoyaltyContentBlock`. Header comment says consent never editable (update).

F-21 `src/lib/cms/content-blocks-seed.ts:L79-L95` `loyaltyCopyBlockSeeds()`
derives seeds from the registry → adding a block auto-seeds it (lazily by
`ensureContentBlocksSeeded()`), owner page group "loyalty" → LOYALTY_PAGE
(`src/lib/cms/content-reachability-core.ts` PAGE_GROUP_DEFAULT_OWNER). Field
type for long text: check the seed's field_type for loyalty blocks at S5 time
(the registry has no field_type; the seed function decides).

F-22 Editor locks: `src/components/admin/LoyaltyPageEditor.tsx:L14-L19`
(header comment), `:L278-L286` (UI paragraph "Two things are locked on
purpose: the marketing-consent paragraph …"); `src/app/admin/loyalty-page/page.tsx:L45-L55`
(header comment), `:L75-L80` (signup group description "The consent paragraph
and the field labels are fixed"), `:L210-L218` (help panel "The consent
paragraph and the program numbers are locked."). All must be reworded in S5.

F-23 Signup persistence: `src/lib/loyalty/signup.ts` — `LoyaltySignupInput`
`:L5-L14` (`consent: boolean`, `signature: string`), `parseLoyaltySignup`
`:L50`, consent required `:L71`, notification text `:L105` ("Consent
Accepted: Yes/No"), `storeLoyaltySignup` `:L137-L179` → `createLoyaltySignup`
in `src/lib/loyalty/signups-store.ts:L122-L139` (insert incl. `consent`). Table
`loyalty_signups` (migration 0008) has `consent boolean` only.
→ S5 records the consent text version: compute a short SHA-256 hex of the
exact consent text shown, send it with the form, store it in a NEW nullable
column `consent_text_sha256` + `consent_text` (migration 0264, idempotent).
The insert must tolerate the column not existing yet (owner applies manually):
on a "column does not exist" error, retry the insert without the new fields
(same pattern rule: never lose a signup). The JSONL fallback also records it.

F-24 Loyalty hero is already a "special" banner with fonts/colors per block:
`src/lib/loyalty/loyalty-hero-core.ts` (501 lines) — `TEXT_ALIGNS`,
`TEXT_VALIGNS`, `IMAGE_FOCUSES`, `HERO_FONTS` (9 curated, groups display/sans/
script), `heroFontStack`, `HERO_COLORS` (white, gold, green, orange, muted),
`HeroTextBlock { text, font, color, show, scriptScale }`. Rendered by
`src/components/loyalty/LoyaltyHeroBanner.tsx` (249 lines), edited by
`src/components/admin/LoyaltyHeroEditor.tsx` (528 lines).
The Shop carousel reuses the same block type (`src/lib/cms/shop-carousel-core.ts`
`normalizeBlock` `:L169-L181`, `ShopHeroPresentation` `:L189-L230`).
→ The new design core (S1) must be a SUPERSET that can represent these blocks
(font ids are site font ids; color ids map to hex), so S6 can upgrade these
banners without losing data.

### 4.6 Preview + hub

F-25 `src/components/admin/PreviewFrame.tsx` (125 lines): iframe src
`/api/admin/preview/enable?path=…&_n=<nonce>` (`:L38-L41`); devices desktop
(full) / tablet 834 / phone 390 (`:L19-L23`); listens for `gw-preview-edit`
with origin check (`:L44-L55`); calls `onEditBlock(blockKey)`.

F-26 `src/components/site/PreviewEditOverlay.tsx` (167 lines): rendered inside
preview pages; `HOTSPOTS_ENABLED = false` (`:L46`); measures
`[data-gw-block]` elements; `edit()` posts `{ type: "gw-preview-edit",
blockKey, target }` to the parent with `window.location.origin` (`:L84-L104`).
Pinned by `tests/compliance/pipeline-fix-links-connected.test.ts` — read before
editing.

F-27 `src/components/admin/WebsiteSyncPreviewPanel.tsx` (61 lines): the hub's
"Live preview" (Website Sync → Preview tab), page picker from `PREVIEW_PAGES`
(`src/components/admin/ContentPreviewPanel.tsx:L20-L35`: Homepage, Shop,
Specials, About, Location, Price Match, Loyalty, Medical, Vendors, Blog, FAQ,
Privacy, Terms, Consumer Health Data), `<PreviewFrame path height={820} />`
with NO onEditBlock (comment `:L14-L21` explains why). Mounted at
`src/app/admin/website-sync/page.tsx:L146`.
→ This IS the "one preview window in the hub" (Q15). S7 turns on a "Move
mode" here.

F-28 `ContentEditorShell.tsx:L142` also mounts `ContentPreviewPanel` (another
preview). The owner asked for ONE preview window in the hub; S7 keeps other
small editor previews (they are live in-editor previews, not hub windows) but
makes every page editor's "Preview" link go to the hub preview with the right
page pre-selected (`/admin/website-sync?tab=preview&path=/specials`).

### 4.7 Link targets (for the button link picker)

F-29 Menu URL params (client reads them at
`src/components/menu/InteractiveMenuBrowser.tsx:L630-L655`
`resolveInitialParams`): `search, category, brand, special, categories,
strains, terpenes, brands, vendors, weights, maxThc, maxCbd, maxPrice, sort,
doh, classification`. Lists are comma-separated (`parsePersistedList`
`:L602-L607`). Sort values (`SORT_OPTION_VALUES` `:L592-L599`):
`featured-shuffle, best-sellers, price-low, price-high, potency-high,
category`. Special collections (`previewSpecialCollections` `:L85-L130`):
`clearance-50, doobie-tuesday, wax-wednesday, top-shelf-thursday,
super-saturday, ice-cream-sunday` (verify the full key list at S1 time — the
object may contain more keys after `:L130`). Strain values: `indica, sativa,
hybrid, indica-hybrid, sativa-hybrid, cbd` (`GreenwayStrainType` in
`src/lib/leafly/types.ts:L28-L36`; `HIGH_CBD_VALUE = "cbd"` at
`InteractiveMenuBrowser.tsx:L64`).

F-30 Category routes: `/menu/<category>` via `categoryPath`
(`src/lib/menu/menu-facet-core.ts:L126-L128`). Website categories from
`websiteCategoryDefinitions` (`src/lib/pos/category-taxonomy.ts`): flower,
popcorn-bud, infused-flower, accessories, merch, paraphernalia, preroll,
blunt, preroll-pack, infused-preroll, infused-blunt, infused-preroll-pack,
cartridge, disposable-cartridge, concentrate, rso, edible-solid, edible-liquid,
tincture, topical, trim. (Import the definitions; never retype the list in UI.)

F-31 Blog: `src/lib/cms/blog-store.ts` `getPublicPosts()` `:L290`
(published posts, static fallback) and `getPublishedSlugs()` `:L320`; route
`/blog/[slug]`. Newsletters are attached to posts (`post.newsletter = { pdfSrc,
pages }` around `:L280`); there is NO `/newsletter` public route → "link to a
newsletter" = link to the blog post that carries it (picker labels posts that
have a newsletter with "📰").

F-32 Public routes (dirs under `src/app`): about, blog, faq, locations,
loyalty, medical, menu, price-match, privacy-policy, terms-of-use,
consumer-health-data, specials, vendor-delivery, plus `/`.

### 4.8 AI

F-33 `src/lib/ai/provider.ts`: `generate`, `generateJSON`, `generateStructured`,
`generateVision({ system, user, imageUrl, temperature, maxTokens, context })`
(`:L454`), `isAiConfigured`, `AiNotConfiguredError`. `src/lib/ai/compliance.ts`
exports `COMPLIANCE_SYSTEM`. Media actions show the call pattern incl.
`context: { entityType, entityId, actorId, actorEmail, feature }` for usage
logging.

### 4.9 Fonts

F-34 `src/lib/cms/fonts.ts` (178 lines): `FONT_OPTIONS` ids: system, inter,
poppins, montserrat, oswald, bebas, anton, playfair, merriweather, roboto-slab,
jetbrains-mono, great-vibes, dancing-script, pacifico; `resolveFont`,
`fontStack(id, fallbackId)`. All loaded through `fonts-loader.ts`
`fontVariablesClassName` on the root layout → any font id is usable on any
public page without extra loading. Design core stores font ids from this list.

### 4.10 CI gates that will see R41 changes

F-35 `.github/workflows/compliance-tests.yml`: `npm run test:compliance`
(vitest over `tests/compliance`, `:L51`), the pure self-test runner (`:L53`),
commit authorship check (`:L83`), verbatim-quote check
(`scripts/verify-verbatim-quotes.ts`, `:L104`), `npm run typecheck` (`:L144`),
migrations execute check (`:L242`), `npm run build` (`:L303`).
→ Source-text tests that pin strings in files R41 edits (must stay green):
- `specials-editor-upgrade.test.ts` (SectionBanner, SpecialsContent,
  SpecialsDailyDeals, SpecialsPresentationEditor, specials-presentation-core,
  specials/page.tsx)
- `specials-presentation.test.ts`
- `home-editor-superpowers.test.ts` (PromoGrid, HomeBrands, SectionCard,
  page-sections-store, pages actions, home-section-settings-core, page.tsx)
- `loyalty-page-editor.test.ts`, `loyalty-hero-editor.test.ts`
- `pipeline-fix-links-connected.test.ts` (PreviewEditOverlay)
- `menu-render-cap.test.ts`, `client-bundle-cjs-guard.test.ts` (SectionCard)
- `usage-5-public-page-revalidate.test.ts`, `menu-cache-policy.test.ts`,
  `r33-website-facts.test.ts`, `r23-masters-filter.test.tsx` (specials page,
  home page)
- `vendors-page.test.ts`, `vendor-directory-enrichment.test.ts`,
  `vendor-relations.test.ts` (VendorDirectory)
- Shop page tests (ShopPage) if S6 touches it.
Running `npm run test:compliance` locally is a BUILD GATE (CI runs it), not
feature self-testing, so it is allowed and required before each PR. If it is
too slow for the sandbox, run only the files listed above with
`npx vitest run <files>`.

