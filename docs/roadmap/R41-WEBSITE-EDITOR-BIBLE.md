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

---

## PART 5 — ARCHITECTURE: ONE DESIGN MODEL FOR EVERY BANNER

### 5.1 Principles

P-1 ONE pure core (`src/lib/cms/banner-design-core.ts`) defines the design
document, its defaults, normalization, validation/warnings, contrast math and
the conversion from today's legacy fields. Every banner editor and every
banner renderer uses it. No editor invents its own styling vocabulary again
(today there are three: SectionBanner fixed classes, the loyalty/shop
`HeroTextBlock`, and the specials hero classes — F-04, F-24, F-15).

P-2 BYTE-IDENTICAL BY DEFAULT. A banner with no design (or `design.enabled ===
false`) renders through the exact legacy code path. The owner opts a banner
into "Custom design" in its editor. This protects every pinned test (F-35) and
the live site.

P-3 NO MIGRATION for design data. Storage per banner family:
| Banner family | Where the design lives | Draft/publish |
| --- | --- | --- |
| page_sections (home.category, home.brand, home extras, vendors.*, extras on specials/menu) | `settings.design` / `draft_settings.design` (jsonb, F-07) | existing section Save draft → Publish |
| Specials TOP hero | `specials.deals.presentation` JSON → `heroDesign`, `heroButtons` (F-16) | existing Specials Save draft → Publish (+ revisions) |
| Specials Today's Deal banner | same JSON → `todaysDealsDesign` | same |
| Loyalty hero / Shop carousel | already rich (F-24); S6 adds optional `design` to their JSON | their existing flows |
| Home Type Cards (not a banner) | `home.category` settings `typeCards` | publishes immediately like `laneImages` today (F-07 `saveHomeSectionSettings`) |
Only the loyalty consent VERSION recording needs a migration (0264, S5), and
the code works before it is applied.

P-4 Positions are PERCENT of the banner frame; sizes are PX at two reference
widths (desktop 1408 px = the `max-w-[88rem]` container, mobile 390 px = the
PreviewFrame phone width F-25) and interpolate smoothly between them with CSS
container units, so a design looks the same at every width without JS.

P-5 Every drag has a keyboard / numeric alternative (WCAG 2.5.7, PART 3.7).

P-6 Warnings, not walls. The only hard blocks: unsafe link schemes
(`javascript:` etc.), an empty consent text, and out-of-range numbers (which
are clamped silently by normalization, never rejected).

P-7 AI output = draft suggestions shown beside the editor with Apply / Ignore
(rule 3). Nothing auto-saves from AI.

### 5.2 The design document (version 1)

TypeScript (authoritative definition lives in the core; this is the contract):

```ts
export type DesignRole = "eyebrow" | "headline" | "subhead" | "body" | "badge" | "legal";
export type DesignAlign = "left" | "center" | "right" | "justify";
export type DesignTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type DesignShadow = "none" | "soft" | "strong" | "glow";
export type DesignBackdrop = "none" | "box" | "blur" | "pill";
export type DesignWrap = "normal" | "balance" | "nowrap";
export type DesignBind = "eyebrow" | "title" | "subtitle" | null;

export type DesignTextBox = {
  id: string;            // stable, [a-z0-9-], ≤ 24 chars
  role: DesignRole;
  bind: DesignBind;      // when set, the text comes from the banner's own
                         // eyebrow/title/subtitle field (keeps legacy fields,
                         // SEO and content blocks in sync); else `text`
  text: string;          // ≤ 600 chars; "\n" = hard line break (Q8)
  x: number; y: number;  // 0–100 % of frame (top-left of the box)
  w: number;             // 5–100 % of frame width (wrap width, Q7)
  mx: number | null; my: number | null; mw: number | null; // mobile overrides
  align: DesignAlign;
  font: string;          // a FONT_OPTIONS id (F-34)
  size: number;          // px at desktop reference (8–160)
  sizeMobile: number;    // px at mobile reference (6–96)
  weight: number;        // 100–900, step 100
  italic: boolean; underline: boolean; strike: boolean; // Q14
  transform: DesignTransform;
  color: string;         // #rrggbb (Q18)
  opacity: number;       // 10–100 %
  letterSpacing: number; // em, -0.1 … 0.5
  lineHeight: number;    // 0.7 … 3
  shadow: DesignShadow;
  outline: boolean;      // 1px text stroke in backdropColor
  backdrop: DesignBackdrop;
  backdropColor: string; // #rrggbb
  backdropOpacity: number; // 0–100 %
  wrap: DesignWrap;
  hidden: boolean;
  hideOnMobile: boolean;
};

export type DesignButtonSize = "sm" | "md" | "lg";
export type DesignButtonShape = "pill" | "rounded" | "square";
export type DesignButtonStyle = "solid" | "outline" | "ghost";

export type DesignButton = {
  id: string;
  label: string;         // ≤ 40 chars
  href: string;          // validated by link-target-core (S1)
  x: number; y: number;  // 0–100 %
  mx: number | null; my: number | null;
  size: DesignButtonSize; shape: DesignButtonShape; style: DesignButtonStyle;
  bg: string; fg: string; border: string; // #rrggbb
  font: string; uppercase: boolean;
  newTab: boolean; enabled: boolean; hideOnMobile: boolean;
};

export type DesignOverlayKind = "none" | "full" | "gradient" | "floor" | "radial";
export type DesignOverlay = {
  kind: DesignOverlayKind;
  color: string;         // #rrggbb (usually black)
  opacity: number;       // 0–100 % at the darkest point
  direction: "left" | "right" | "top" | "bottom"; // gradient: where it is darkest
};

export type DesignImage = {
  focusX: number; focusY: number;          // 0–100 (object-position %)
  focusXMobile: number | null; focusYMobile: number | null;
  zoom: number;          // 100–250 %
  brightness: number;    // 50–150 %
  saturation: number;    // 0–200 %
  blur: number;          // 0–12 px
  flip: boolean;         // horizontal mirror
};

export type DesignFrame = {
  height: number;        // px at desktop reference (80–720)
  heightMobile: number;  // px at mobile reference (80–720)
  radius: number;        // 0–48 px corner radius
};

export type BannerDesign = {
  v: 1;
  enabled: boolean;
  frame: DesignFrame;
  image: DesignImage;
  overlay: DesignOverlay;
  boxes: DesignTextBox[];     // ≤ 8
  buttons: DesignButton[];    // ≤ 4
};
```

### 5.3 Rendering math (pure, server-safe)

R-1 Frame: a `div` with `container-type: inline-size; container-name: gwb`,
`position: relative`, height = `clamp(min, interp, max)` between
`heightMobile` @390 and `height` @1408 (container units `cqw` are relative to
the frame's own width, so it works inside any page column).

R-2 Interpolation helper (pure):
```
interp(m, d) = `clamp(${min(m,d)}px, calc(${m}px + ${(d-m)/1018} * (100cqw - 390px)), ${max(m,d)}px)`
```
(1018 = 1408 − 390.) Used for frame height and font size. Rounded to 4
decimals for stable output.

R-3 Text box: `position: absolute; left: var(--gx); top: var(--gy); width:
var(--gw)` with mobile overrides via one global CSS rule
`@container gwb (max-width: 767px) { .gw-dbox { left: var(--gmx, var(--gx)); top: var(--gmy, var(--gy)); width: var(--gmw, var(--gw)); } }`
and `.gw-hide-sm` hiding below 768. Inline styles can't contain container
queries, so these few rules go into `src/app/globals.css` (one small block,
added in S2).

R-4 Text: `white-space: pre-line` (honors "\n", Q8), `overflow-wrap:
anywhere` for `normal`, `text-wrap: balance` for `balance`, `white-space: pre`
for `nowrap`. `text-decoration-line` combines underline + line-through (Q14).

R-5 Image: `object-fit: cover; object-position: X% Y%`; zoom via `transform:
scale(z) ` with `transform-origin: X% Y%` (zooms toward the focal point);
`filter: brightness() saturate() blur()`; flip via `scaleX(-1)`. Mobile focal
override via CSS vars + the same container rule.

R-6 Overlay: `full` = solid rgba; `gradient` = linear-gradient from the
direction side (opacity → 35% of opacity at 50% → 0 at 100%); `floor` =
gradient from bottom; `radial` = radial-gradient centered at the headline
box. `none` = nothing.

R-7 Buttons: absolutely positioned like boxes; size map sm/md/lg → height
32/40/48 px desktop (28/34/40 mobile) and font 11/13/15 px; shapes → radius
999/10/0; styles: solid bg+fg, outline transparent bg + border, ghost no bg +
underline on hover.

R-8 Semantics: the first `headline` box renders `h1` when the banner is the
page's top hero (caller passes `headingLevel`), else `h2`; others `p`; badge
`span`. Buttons are `next/link` for internal hrefs, `a` with `rel="noopener
noreferrer"` for external/newTab.

R-9 Preview hooks: in Draft Mode (`editable`), frame gets
`data-gw-design-frame` + `data-gw-design-owner="<owner>"`; each box
`data-gw-design-box="<id>"`; each button `data-gw-design-button="<id>"`.
These are inert attributes outside the hub (no JS on public pages).

### 5.4 Contrast warning algorithm (pure)

C-1 Parse hex → sRGB → relative luminance (PART 3.1).
C-2 Effective background for a box:
- backdrop `box`/`pill`/`blur` with opacity ≥ 1: composite backdropColor at
  backdropOpacity over the overlay-composited worst case (below).
- else the overlay composited over the WORST-CASE image pixel: for a light
  text color (L > 0.5) the worst case is white (#ffffff); for dark text, black.
  Overlay alpha at the box location: `full` = opacity; `gradient`/`floor` =
  opacity × (1 − distance along the gradient axis from the dark side, using
  the box CENTER in %); `radial` = opacity × 0.8 (approximation, labeled as
  such); `none` = 0.
C-3 Ratio vs threshold: large text (size ≥ 24 px, or ≥ 18.67 px with weight ≥
700) → 3:1, else 4.5:1 — evaluated at BOTH desktop size and mobile size
(mobile usually smaller → stricter).
C-4 Output: `{ boxId, ratio, needed, device, ok }`; the editor shows "Hard to
read: 2.1 : 1 (needs 4.5 : 1 on phones). Try: darker overlay, a text box
backdrop, or a different color." This is a worst-case estimate and is labeled
"estimate" in UI because the real photo is unknown to pure code (S8 can sample
the real image with AI, optional).

### 5.5 Legacy → design conversion (pure)

`designFromLegacy({ eyebrow, title, subtitle, textAlign, verticalAlign,
imageFocus, buttons, preset })` builds a design that looks like today's banner:
- frame 200/160 px (`preset: "section"`), 260/200 (`preset: "hero"`).
- image focus from `imageFocus` (center 50/50, top 50/0, bottom 50/100, left
  0/50, right 100/50); when no imageFocus, the legacy opposite-side rule
  (textAlign left → right 100/50; right → left 0/50; center → 50/50).
- overlay `gradient` 94% black from the text side (left/right) or `full` 65%
  for center — matching F-04 `:L95-L100` within rounding.
- boxes bound to eyebrow/title/subtitle (`bind`), x = 4% (left) / 50% − w/2
  (center) / 96% − w (right); y stacked from `verticalAlign`; sizes from the
  legacy classes: eyebrow 12/10 px weight 900 uppercase tracking 0.22em color
  #7ed957 (`--greenway`); headline 48/24 px weight 900 uppercase line-height 1
  white; subhead 14/11.5 px weight 600 color #d4d4d8 (zinc-300).
- buttons from legacy buttons: solid → bg #7ed957 fg #000; outline → bg
  transparent border #ffffff4d fg #fff; ghost → fg #7ed957; positions in a row
  under the subhead.

### 5.6 Link target model (pure, `src/lib/cms/link-target-core.ts`)

L-1 Kinds: `page` (public route list F-32), `menu` (filters F-29), `category`
(`/menu/<category>` F-30), `blog` (`/blog/<slug>` F-31), `special`
(`/menu?special=<key>`), `external` (`https://…`), `contact` (`tel:` /
`mailto:`), `anchor` (`#id` on the same page).
L-2 `buildMenuHref(filters)` → canonical `/menu?…` with a FIXED param order
(categories, strains, brands, vendors, weights, special, sort, maxPrice,
maxThc, maxCbd, search), comma-joined lists, dropping empties, URL-encoding
values (`encodeURIComponent`, but keep commas literal as separators exactly
like the menu's own `parsePersistedList` expects).
L-3 `describeHref(href, ctx)` → plain English ("Shop menu · Flower +
Prerolls · Indica · Price low→high", "Blog post: <title>", "Outside website:
example.com"). Used under each button in the editor so the owner can see
where it goes without reading a URL.
L-4 `checkHref(href)` → `{ ok, level: "ok"|"warn"|"block", message }`: block
`javascript:`, `data:`, `vbscript:`, protocol-relative `//`, whitespace/control
chars; warn `http://` (not https), unknown internal path (not in the public
route list and not `/menu…`/`/blog/…`), unknown menu param or value.
L-5 `parseMenuHref(href)` → filters object (round-trip with L-2) so the picker
re-opens with the owner's previous choices.

### 5.7 Hub "Move mode" protocol (S7)

M-1 Parent → iframe: `{ type: "gw-move-mode", on: boolean }` (origin-checked).
M-2 iframe → parent on drop: `{ type: "gw-design-move", owner, target: "box"
| "button", id, x, y, device: "desktop" | "mobile" }` where device = iframe
viewport < 768 px ? "mobile" : "desktop"; x/y are % of the frame rounded to
0.5.
M-3 Parent validates with the pure `parseMoveMessage()` (S1), then calls the
server action `saveDesignMoveAction(owner, …)` which loads the owner's DRAFT
design, applies `applyMove()` (pure), saves the draft, and returns
`{ ok, message }`. Parent shows a toast "Moved — saved as a draft. Publish it
in <editor link>." and reloads the iframe.
M-4 Owners: `section:<uuid>` (page_sections), `specials:hero`,
`specials:todays`. Unknown owner → refused with a message.
M-5 Banners without a custom design are NOT draggable; in Move mode they show
a small badge "Turn on Custom design in the editor to move text here" with
the editor link (owner request Q16 is satisfied for every designed banner, and
the path to enable it is one click away).

---

## PART 6 — SLICE PLAN (binding order)

| Slice | Name | Answers | PR branch |
| --- | --- | --- | --- |
| S0 | This bible | Q29, Q30 | `r41-editor-bible` |
| S1 | Pure cores: banner design + link targets | Q5, Q7, Q8, Q13, Q14, Q18, Q19, Q22–Q26 (logic) | `r41-s1-design-cores` |
| S2 | Designed banner renderer + Home sections fix + Section editor "Custom design" studio + link picker | Q4–Q8, Q12–Q14, Q17–Q19, Q22–Q26 | `r41-s2-banner-studio` |
| S3 | Home Type Cards: rename / add / delete / reorder / relink | Q1–Q3 | `r41-s3-type-cards` |
| S4 | Specials: hero buttons + hero & Today's Deal custom design | Q10–Q12 | `r41-s4-specials` |
| S5 | Loyalty consent wording editable + TCPA warnings + consent version | Q9 | `r41-s5-loyalty-consent` |
| S6 | Design on the remaining banners (vendors, extras on specials/menu, BannerData) | Q12 | `r41-s6-all-banners` |
| S7 | Hub preview "Move mode" (drag text/buttons in the one preview window) | Q6, Q15, Q16 | `r41-s7-hub-move` |
| S8 | AI focal point + text placement suggestions (drafts only) | Q21 | `r41-s8-ai-assist` |
| S9 | Final owner test report + bible status | Q28 | (in S8 PR or own) |

Slices may be grouped into fewer PRs if the sandbox is slow, but each slice
keeps its own commits and its own bible status line.

---

### SLICE S1 — Pure cores (banner design + link targets)

**Goal.** Ship the two pure modules every other slice depends on, with
embedded self-tests registered in the runner. No UI, no behavior change.

**Files to create.**
- `src/lib/cms/banner-design-core.ts`
- `src/lib/cms/link-target-core.ts`

**Files to edit.**
- `scripts/compliance/run-pure-selftests.ts` — import both
  `__runBannerDesignCoreTests`, `__runLinkTargetCoreTests`; register with
  `assertRan("banner-design-core", …, N)` and `assertRan("link-target-core",
  …, M)` right after the R40 lines (`assertRan("ach-guide-core", …)` near the
  end of `main()`), comment `// R41 S1: …`. Set N/M to the exact passed count
  produced by the first green run (floor = actual count, the runner's
  convention).

**banner-design-core.ts — exports (contract).**
- Constants: `DESIGN_VERSION = 1`, `MAX_TEXT_BOXES = 8`,
  `MAX_DESIGN_BUTTONS = 4`, `DESKTOP_REF_PX = 1408`, `MOBILE_REF_PX = 390`,
  `MOBILE_BREAKPOINT_PX = 768`, `DESIGN_ROLES` (with label, purpose, dos,
  donts, html, default sizes — PART 3.4 table verbatim in data),
  `DESIGN_ALIGNS`, `DESIGN_TRANSFORMS`, `DESIGN_SHADOWS`, `DESIGN_BACKDROPS`,
  `DESIGN_WRAPS`, `BUTTON_SIZES`, `BUTTON_SHAPES`, `BUTTON_STYLES`,
  `OVERLAY_KINDS`, `BRAND_SWATCHES` (named hex colors: white #ffffff,
  black #000000, greenway #7ed957, gold #ffd700, orange (read the real token
  from `src/app/globals.css` — do NOT guess; grep `--orange`), zinc-300
  #d4d4d8, charcoal (grep `--charcoal`)).
- Types: everything in PART 5.2.
- `defaultTextBox(role, overrides?)`, `defaultButton(overrides?)`,
  `defaultDesign(preset)`.
- `normalizeDesign(raw: unknown): BannerDesign | null` — returns null when raw
  is not an object; clamps every number, validates every enum, drops boxes
  past 8 and buttons past 4, drops buttons whose href fails `checkHref` with
  level "block", de-duplicates ids, coerces colors to lowercase `#rrggbb`
  (accepts `#rgb`; anything else → default for that field).
- `readDesign(settings: unknown, key = "design")` → `BannerDesign | null`
  (reads `settings.design`; null when absent/invalid/`enabled === false`
  is still returned as an object so the editor can toggle back on —
  renderers check `enabled`).
- `writeDesign(settings, design | null)` → new settings object (never mutates;
  preserves sibling keys like `lanes`, `cardCount`, `laneImages`,
  `typeCards`).
- `designFromLegacy(input)` (PART 5.5).
- `resolveBoxText(box, legacy: { eyebrow, title, subtitle })` → string.
- `interpPx(mobilePx, desktopPx)` → CSS clamp string (PART 5.3 R-2).
- `frameStyle(design)`, `imageStyle(design)`, `overlayStyle(design,
  headlineCenter)`, `boxStyle(box)`, `buttonStyle(button)` → plain
  `Record<string, string>` style objects (React-compatible keys, CSS custom
  properties as `"--gx"` etc.). Pure, deterministic, unit-testable strings.
- `contrastRatio(hexA, hexB)`, `relativeLuminance(hex)`, `compositeOver(fg,
  alpha, bg)`, `checkDesignContrast(design)` (PART 5.4).
- `checkDesign(design, legacy?)` → `DesignWarning[]` with codes:
  `MULTI_HEADLINE`, `LONG_HEADLINE`, `TOO_MANY_BUTTONS`, `LOW_CONTRAST`,
  `OUT_OF_FRAME`, `EMPTY_BOX`, `LEGAL_TOO_SMALL` (WAC 314-55-155(7) 10% rule as
  a warning), `OVERLAP` (two visible boxes' rectangles overlap > 30% of the
  smaller — estimated using an approximate line count from text length ×
  size; labeled "might overlap").
- `applyMove(design, { target, id, x, y, device })` → new design (clamped;
  device "mobile" writes mx/my; keeps the box inside the frame using its
  width).
- `parseMoveMessage(data: unknown)` → validated move or null (PART 5.7 M-2).
- `snapPercent(v, guides = [0, 50, 100], threshold = 2)`.
- `nudge(design, target, id, dx, dy, device)` (keyboard alternative).
- `__runBannerDesignCoreTests(): { passed: number; failed: number }`.

**Self-test list (minimum; each is one `ok()`):**
1. defaultDesign("section") normalizes to itself (idempotent).
2. normalizeDesign(null/123/"x"/[]) → null.
3. Clamp x/y below 0 and above 100.
4. Clamp w below 5.
5. size clamps 8–160, sizeMobile 6–96.
6. weight rounds to nearest 100 and clamps 100–900.
7. Unknown role → "body"; unknown align → "left".
8. Color "#ABC" → "#aabbcc"; "red" → field default.
9. 9 boxes in → 8 out; 5 buttons in → 4 out.
10. Duplicate ids → second renamed (`-2`).
11. Button with `javascript:alert(1)` dropped; `/menu?categories=flower` kept.
12. writeDesign preserves `lanes`, `cardCount`, `laneImages`.
13. writeDesign does not mutate input.
14. readDesign on `{}` → null; on `{design: valid}` → design.
15. designFromLegacy left/center/right box x positions.
16. designFromLegacy imageFocus mapping (5 values) + legacy opposite rule.
17. designFromLegacy buttons map variants to colors.
18. resolveBoxText with bind "title" returns legacy title; with null returns text.
19. interpPx(10, 20) contains "clamp(10px" and "20px)".
20. interpPx(20, 10) (mobile larger) still min/max ordered.
21. relativeLuminance("#ffffff") = 1, ("#000000") = 0.
22. contrastRatio white/black = 21 (±0.01).
23. contrastRatio("#777777", "#ffffff") ≈ 4.48 (known WCAG example; ±0.02).
24. Large-text threshold: 24px → 3:1; 18.67px bold → 3:1; 18px normal → 4.5.
25. White text, overlay none → LOW_CONTRAST warning (worst case white bg).
26. White text, overlay full 70% black → passes 4.5 (compute & assert).
27. White text with box backdrop black 50% → ratio computed over white worst
    case (REI example direction: 50% passes 3:1 for large text).
28. MULTI_HEADLINE when two headline boxes visible; hidden one ignored.
29. LONG_HEADLINE at 61 chars.
30. TOO_MANY_BUTTONS at 3 enabled.
31. LEGAL_TOO_SMALL when legal size < 10% of largest size.
32. OUT_OF_FRAME when x + w > 100 (before clamp) — checkDesign on raw.
33. applyMove desktop sets x/y; mobile sets mx/my; clamps so x + w ≤ 100.
34. applyMove unknown id → design unchanged (same JSON).
35. parseMoveMessage rejects wrong type, NaN, missing id, unknown device.
36. snapPercent(49, …) → 50; (45) → 45.
37. nudge with Shift step.
38. boxStyle includes `white-space: pre-line` for wrap normal (key
    `whiteSpace`), `textDecorationLine: "underline line-through"` when both.
39. imageStyle uses `objectPosition: "30% 70%"` and transformOrigin same.
40. overlayStyle gradient direction left contains "to right" (dark on left).
41. frameStyle contains containerType "inline-size".
42. Round-trip: JSON.stringify(normalizeDesign(JSON.parse(JSON.stringify(d))))
    equals JSON.stringify(d) for a fully-populated design.

**link-target-core.ts — exports (contract).**
- `PUBLIC_PAGES: { path, label }[]` — from F-32 (verify dirs at S1 time with
  `ls src/app`; include `/`, `/menu`, `/specials`, `/loyalty`, `/medical`,
  `/vendor-delivery`, `/blog`, `/about`, `/faq`, `/locations`,
  `/price-match`, `/privacy-policy`, `/terms-of-use`,
  `/consumer-health-data`).
- `MENU_SORTS` (F-29 six values + labels), `MENU_STRAINS` (six + labels),
  `MENU_SPECIALS` (keys from `previewSpecialCollections`, verify at S1 time;
  labels from the same object) — NOTE: `InteractiveMenuBrowser.tsx` is a
  client component; do NOT import it into a pure core (it would drag React +
  the whole menu into the self-test runner). Copy the key list into the core
  and add a vitest source-text test (S1) that reads
  `InteractiveMenuBrowser.tsx` and asserts every key in the core exists in
  `previewSpecialCollections` and every sort value exists in
  `SORT_OPTION_VALUES` (drift guard).
- Categories: import `websiteCategoryDefinitions` from
  `src/lib/pos/category-taxonomy.ts` IF that module is pure (verify its
  imports at S1 time: at `eafcbffd` line 1 is `import type { GreenwayCategory }
  from "@/lib/leafly/types";` — type-only, so it is safe). The runner uses
  `tsx` with path aliases? VERIFY: other cores registered in the runner import
  with `@/` aliases (e.g. `loyalty-hero-core` imports `@/lib/cms/fonts`) — if
  the runner resolves `@/`, use it; else use relative imports.
- `MenuFilters = { categories: string[]; strains: string[]; brands: string[];
  vendors: string[]; weights: string[]; special: string | null; sort: string |
  null; maxPrice: number | null; maxThc: number | null; maxCbd: number | null;
  search: string }`.
- `buildMenuHref(f)`, `parseMenuHref(href)`, `buildCategoryHref(cat)`,
  `buildBlogHref(slug)`, `checkHref(href)`, `describeHref(href, ctx?: {
  blogTitles?: Record<string,string>; categoryLabels?: Record<string,string> })`,
  `linkKindOf(href)`.
- `__runLinkTargetCoreTests()`.

**Self-test list (minimum):**
1. buildMenuHref({categories:[flower,preroll]}) === "/menu?categories=flower,preroll".
2. Param order fixed (categories before strains before sort).
3. Empty filters → "/menu".
4. search with spaces/ampersand encoded; commas in a brand name encoded as
   %2C (a brand containing a comma must not split).
5. parseMenuHref round-trips 1–4.
6. parseMenuHref ignores unknown params but reports them via checkHref warn.
7. buildCategoryHref("flower") === "/menu/flower"; unknown category → warn in checkHref.
8. buildBlogHref("my-post") === "/blog/my-post"; slug sanitized.
9. checkHref blocks javascript:, JAVASCRIPT:, " javascript:", data:, vbscript:, "//evil.com".
10. checkHref warns http://; ok https://.
11. checkHref ok tel:+13605550123, mailto:a@b.co; blocks "tel:" empty.
12. checkHref ok "#shop-by-category"; warns "#" alone.
13. checkHref warns unknown internal path "/nope".
14. describeHref menu summary contains category labels and sort label.
15. describeHref blog uses provided title; falls back to slug.
16. describeHref external shows hostname.
17. linkKindOf for each kind.
18. maxPrice non-number dropped; negative dropped.
19. special key unknown → warn.
20. strains unknown value → warn.

**Vitest added in S1:** `tests/compliance/r41-design-cores.test.ts`
- mirrors a handful of core assertions (so `npm run test:compliance` covers the
  core even if the runner line is ever removed — repo convention, e.g. R40);
- the drift guard for menu special keys / sort values (reads
  `src/components/menu/InteractiveMenuBrowser.tsx` as text);
- asserts the runner registers both suites (reads
  `scripts/compliance/run-pure-selftests.ts` text for
  `assertRan("banner-design-core"` and `assertRan("link-target-core"`).

**Acceptance.** tsc 0, eslint 0, build ok, runner prints both suites with
counts, vitest file green.

**Owner test steps (S1).** Nothing visible. The owner can skip S1; it is
verified by CI ("compliance" job shows `banner-design-core: N assertions` in
the log).

**Risks.** Over-large core → keep under ~1200 lines; split render-style
helpers into `banner-design-style-core.ts` if needed (both pure).

**Rollback.** Revert the S1 commits; nothing depends on them until S2.

---

### SLICE S2 — Designed banner renderer + Home fix + Banner Studio editor

**Goal.** (a) Fix home alignment (F-01 root cause) immediately for the simple
controls the owner already has; (b) add the "Custom design" studio to the
section editor with drag-to-move, text boxes with roles, fonts, sizes, styles,
colors, wrapping, Enter for new lines, image focal point/zoom/filters,
overlays, buttons with position/size/shape/style/colors and the link picker;
(c) render designed banners on the public site.

**Part (a) — the quick fix (do FIRST, commit alone).**
- `src/components/home/PromoGrid.tsx`: extend `PromoBannerContent` with
  optional `categoryTextAlign`, `categoryImageFocus`, `categoryButtons`,
  `categoryDesign`, `brandTextAlign`, `brandImageFocus`, `brandButtons`,
  `brandDesign`, `extraSections` (BannerData-like list). Pass `textAlign`,
  `imageFocus`, `buttons` to the category `SectionBanner`.
- `src/components/home/HomeBrands.tsx`: same for the brand banner.
- `src/app/page.tsx`: pass `category?.textAlign`, `category?.imageFocus`,
  `category?.buttons`, and the brand equivalents.
- Behavior change note: before this fix, home banners ignored the editor's
  imageFocus (they used the legacy opposite-side rule). After the fix, the
  editor's image focus is honored. The seed for home.category/home.brand has
  `image_focus: "center"` (F-09: verify `page-sections-seed.ts:L58`, `:L74`)
  — so the LIVE look of the home banner image may shift from "right" (legacy,
  because textAlign left) to "center". To keep the live look byte-identical
  until the owner touches it, pass `imageFocus` ONLY when the section's
  stored `image_focus` differs from the seed default "center" OR when the
  owner has saved the section since R41 (not knowable) → DECISION: pass
  imageFocus only when it is not "center"; "center" keeps legacy behavior.
  Document this in the S2 owner report: "Image focus 'Center' on home
  banners keeps the classic look (image hugs the side opposite the text);
  pick Top/Bottom/Left/Right to pin it, or use Custom design for exact
  control." This is honest and avoids a surprise live change.
- textAlign: the seed is "left" = legacy default, so passing it is
  byte-identical for un-edited banners. Buttons: seed `[]` for home.category
  (verify), so passing is byte-identical.

**Part (b) — renderer.**
- New `src/components/site/DesignedBanner.tsx` (server-compatible, no
  "use client"): props `{ design: BannerDesign; imageSrc; imageAlt; legacy:
  { eyebrow, title, subtitle }; headingLevel?: 1 | 2; priority?; editable?;
  owner?: string }`. Renders frame/image/overlay/boxes/buttons with the pure
  style helpers. Uses `next/image` with `fill` + style from `imageStyle`.
- `SectionBanner.tsx`: add optional prop `design?: BannerDesign | null` and
  `designOwner?: string`; at the top of the component: `if (design?.enabled)
  return <DesignedBanner … />;` — everything else unchanged (keeps pinned
  strings, F-04).
- `src/app/globals.css`: add the container-query block (PART 5.3 R-3) under a
  comment `/* R41 S2: designed banners */`.
- `page.tsx` / PromoGrid / HomeBrands: pass `design={readDesign(section.settings)}`.
- Home extras: in `page.tsx`, `const homeExtras = sections.filter((s) => s.kind
  === "banner" && !["home.category","home.brand","home.settings"].includes(s.key))`
  → render after `PromoGrid` via a small `HomeExtraBanners` list of
  `SectionBanner` (nothing renders when empty → byte-identical). VERIFY kinds
  in `page-sections-types.ts` first (`kind` values) and that `getSectionsForRender`
  already filters disabled rows (it does, F-07 `:L176-L178`).

**Part (c) — the editor ("Banner Studio").**
- New client component `src/components/admin/banner-studio/BannerStudio.tsx`
  with sub-components (keep each file < ~500 lines):
  - `StudioCanvas.tsx` — renders a live `DesignedBanner`-equivalent preview at
    the chosen device width (Desktop 1408→scaled to fit / Phone 390), with
    pointer-event drag for boxes and buttons (setPointerCapture), snap guides
    at 0/50/100 (visual lines while dragging), selection outline, arrow-key
    nudge on the selected item (1%, Shift 5%), Delete key removes the selected
    box (with confirm), Escape deselects. Device toggle: editing on "Phone"
    writes mobile overrides (mx/my/mw/sizeMobile/focus mobile) and shows a
    "Phone layout (overrides)" badge with "Reset phone layout" button.
  - `TextBoxPanel.tsx` — list of boxes with role icon + first words; "＋ Add
    text box" menu listing roles with their PURPOSE line and dos/don'ts
    (PART 3.4) — this is "create new text boxes, but with purpose" (Q22).
    Selected box controls: textarea (Enter = new line, Q8) or "Uses the
    banner's Title/Eyebrow/Subtitle field" toggle for bound boxes; font
    select (FONT_OPTIONS labels, preview in its own font); size slider +
    number (desktop and phone); weight select; B / I / U / S toggle buttons
    (Q14); case transform; alignment L/C/R/Justify (Q5); wrap width slider
    (Q7) + wrap mode (Normal / Balanced / No wrap); color picker (native
    `<input type="color">` + brand swatches + hex input) (Q18); opacity;
    letter spacing; line height; shadow; outline; backdrop (none / box /
    blur / pill) + color + opacity; X/Y numeric inputs (keyboard alternative
    for drag, WCAG 2.5.7); hide / hide on phone; move up/down (z-order);
    duplicate; delete.
  - `ButtonPanel.tsx` — up to 4 buttons: label, link (LinkPicker), size,
    shape, style, colors (bg/fg/border with swatches), font, uppercase, open
    in new tab, X/Y numeric, show/hide, hide on phone, delete, "＋ Add
    button" (Q23, Q24).
  - `ImagePanel.tsx` — focal point picker (click on a thumbnail to set
    focusX/Y; crosshair marker), phone focal override, zoom slider,
    brightness, saturation, blur, flip, frame height desktop/phone, corner
    radius (Q19). Overlay: kind (None / Full tint / Side fade / Floor fade /
    Spotlight), color, strength, direction.
  - `WarningsPanel.tsx` — live `checkDesign` results with plain-English fixes
    and the WAC tip (PART 3.5) and NN/g tips (PART 3.2).
  - `LinkPicker.tsx` — modal/popover with tabs: Menu filter (category chips,
    strain chips, special select, sort select, max price, search box; live
    preview of the resulting URL + plain-English description from
    `describeHref`), Category page, Blog post / newsletter (searchable list of
    published posts passed from the server; 📰 marks posts with a newsletter),
    Website page (PUBLIC_PAGES), Phone/Email, Outside link (https only warn),
    Section on this page (#anchor). Shows `checkHref` result (block disables
    Save in the picker).
  - Serialization: the studio writes its design JSON into the parent form's
    `settings_json` merge (SectionCard already merges settings — F-11) via
    `writeDesign`. No new server action needed for sections:
    `saveSectionAction` already accepts `settings_json` (F-10 `parseSettings`).
    SERVER-SIDE: in `saveSectionAction`, after `parseSettings`, run
    `normalizeDesign` on `settings.design` if present (never trust the
    client) and re-write it (or drop it if invalid).
- `SectionCard.tsx` changes:
  - Eyebrow / title / subtitle inputs → `<textarea rows={2}>` with
    auto-grow, so Enter makes a new line (Q8). The public legacy renderer
    gets `whitespace-pre-line` on eyebrow/title/subtitle so line breaks show
    — BYTE-IDENTICAL for existing text without "\n" (pre-line collapses
    spaces exactly like normal). CHECK pinned strings before editing the
    classes (none of the pinned strings in F-04 include the eyebrow/title/
    subtitle class lists — verify at S2 time).
  - Button href input gets a "Pick a link…" button opening `LinkPicker`, and a
    plain-English description line under it (Q25/Q26) — this helps even
    without Custom design.
  - New collapsible "🎨 Custom design (advanced)" section with a toggle
    "Use custom design for this banner". When turned on the first time, the
    design is created with `designFromLegacy` from the current fields so the
    banner starts looking exactly like it does now; then the studio opens.
    Turning it off keeps the design stored but `enabled: false` (the banner
    returns to the classic look; turning on again restores the design).
- Blog posts for the picker: `src/app/admin/pages/[slug]/page.tsx` loads
  `getPublicPosts()` (F-31) once and passes `{ slug, title, hasNewsletter }[]`
  down to SectionCard → LinkPicker. Wrap in try/catch → [] on error.

**Acceptance (S2).**
- tsc/eslint/build green; pinned tests green (F-35 list for home + specials
  SectionBanner).
- Home banner with textAlign center in editor → public home banner text
  centered after publish (Q4 fixed).
- Custom design on → banner renders from design; off → classic.
- Enter in title textarea → saved with "\n" → public shows two lines.

**Owner test steps (S2)** — see PART 11 §S2 (written in plain English).

**Risks.**
- `next/image` with `fill` inside an absolutely positioned frame needs the
  parent `position: relative` + explicit height — provided by frameStyle.
- Container query units (`cqw`) need a modern browser (Chrome 105+, Safari
  16+, Firefox 110+). Fallback: the `clamp()` min value applies if `cqw` is
  unsupported? NO — an unsupported unit invalidates the whole declaration.
  Mitigation: emit a plain px declaration FIRST, then the clamp() declaration
  (React inline styles cannot hold two values for one property) → instead put
  the size into a CSS custom property and use a class rule in globals.css:
  `.gw-dbox { font-size: var(--gfs-fallback); font-size: var(--gfs); }` — the
  browser keeps the fallback when `--gfs` uses an unsupported unit? No: custom
  properties are validated at computed-value time; an invalid value makes the
  property "invalid at computed-value time" → falls back to `unset`, not to
  the previous declaration. FINAL DECISION: container query units are
  supported by all browsers the site targets (caniuse: container query
  length units are Baseline since Feb 2023). Accept; document in risks.
- SectionCard is large (512 lines); keep the studio in its own files and
  mount it lazily (`next/dynamic` with `ssr: false` is fine in a client
  component) to keep the admin bundle reasonable. Check
  `client-bundle-cjs-guard.test.ts` rules before importing anything new into
  SectionCard.

---

### SLICE S3 — Home Type Cards: rename, add, delete, reorder, relink

**Goal.** The owner can edit card names, add cards, delete cards, reorder,
choose where each card links (link picker incl. menu filters), keep/choose
each card's image, and edit the small "Shop now →" line per card.

**Data.** `home.category` `settings.typeCards`:
```ts
type TypeCard = {
  id: string;          // stable; defaults use the lane key (flower, …)
  label: string;       // ≤ 40 chars; "\n" allowed (2 lines)
  href: string;        // checkHref must not block
  image: string;       // "" = text-only tile (legacy)
  cta: string;         // default "Shop now →"; ≤ 30 chars
  enabled: boolean;
};
// settings.typeCards: TypeCard[] (≤ 12) ; absent = defaults
```
Pure core: extend `src/lib/cms/home-section-settings-core.ts` (it already has
lane helpers and self-tests? VERIFY whether it has `__run…Tests`; if it does,
add tests there; if not, create `src/lib/cms/type-cards-core.ts` with its own
tests and register it).
- `TYPE_CARDS_KEY = "typeCards"`, `MAX_TYPE_CARDS = 12`, `MIN_TYPE_CARDS = 0`.
- `defaultTypeCards(laneImages)` — from `categoryLanes` (F-05) in order, ids
  = lane keys, labels/hrefs identical, image from `laneImages[key]`, cta
  "Shop now →", enabled true. NOTE: `categoryLanes` lives in
  `src/lib/specials/daily-deal-presentation.ts` — verify that module is pure
  enough to import into a core (it imports `GreenwayMenuItem` types and maybe
  runtime helpers). If it imports anything with I/O, copy the six
  definitions into the core and add a vitest drift guard comparing them.
- `readTypeCards(settings)` — when `typeCards` is an array → normalized list
  (may be empty = owner deleted all; the grid then hides); else defaults
  (with `laneImages` carried in).
- `normalizeTypeCards(raw)` — clamp lengths, drop blocked hrefs (keep card,
  blank href → card renders as non-link? DECISION: a card must link; a
  blocked/blank href falls back to "/menu"), de-dupe ids, cap 12.
- `writeTypeCards(settings, cards)` — preserves sibling keys.
- Self-tests: defaults equal categoryLanes; laneImages carried; empty array
  respected; cap; id de-dupe; javascript: href replaced by /menu; label
  trimming; "\n" kept; writeTypeCards preserves `lanes` + `laneImages`.

**Render.** `PromoGrid.tsx` takes `typeCards?: TypeCard[]`; when provided it
maps them instead of `categoryLanes` (same markup, label via
`whitespace-pre-line`, cta text from card). `page.tsx` passes
`readTypeCards(category?.settings)`. Grid columns: today `grid-cols-2
md:grid-cols-3 lg:grid-cols-6`; with N ≠ 6 cards use `lg:grid-cols-${…}`?
Tailwind v4 cannot see dynamic class names → use a fixed lookup map
{1..6 → explicit class strings} and for N > 6 keep `lg:grid-cols-6` (wraps
to a second row). For N = 6 the class string must be EXACTLY the current one
(byte-identical).

**Editor.** Replace `TypeCardImagesEditor.tsx` content (keep the file name and
export to avoid churn) with a list editor: each card row = drag handle /
up-down buttons, name textarea (Enter → 2 lines), "Shop now" line input, link
(LinkPicker from S2), image (ContentImageField), show/hide toggle, delete
(confirm). "＋ Add card" (disabled at 12) → new card `{ label: "New card",
href: "/menu", … }`. "Reset to the original six" button (confirm). Hidden
input `type_cards_json`.
**Action.** `saveTypeCardImagesAction` (keep name, F-10) → read
`type_cards_json` when present: normalize, `saveHomeSectionSettings(
"home.category", { typeCards, laneImages })` (also mirror images back into
`laneImages` for the six default ids so nothing that still reads laneImages
breaks). Audit action `page_section.type_cards`. Fallback: if the form has no
`type_cards_json` (old form), keep the existing lane-image loop.

**Acceptance (S3).** Rename "Liquids" → "Drinks" and save → home tile shows
"Drinks"; add a 7th card → appears; delete one → gone; reorder → order
changes; relink a card to "Flower · Indica · price low→high" → tile link
matches; untouched site = byte-identical.

**Owner test steps** — PART 11 §S3.

**Risks.** The Type Cards save publishes immediately (like images today) —
say so in the editor ("Changes go live when you press Save").

---

### SLICE S4 — Specials: hero buttons + full design

**Goal.** Owner can add / edit / remove / repoint the Specials hero buttons
(Q11) and use Custom design on the Specials hero and on the Today's Deal
banner (Q10, Q12).

**Data (specials presentation JSON, F-16).** Add:
- `heroButtons: SectionButton[]` (≤ 4; same shape as page_sections buttons)
- `heroButtonsSet: boolean` (false until the owner saves buttons once; while
  false the page keeps using the legacy `specials.hero` row buttons so the
  live page is byte-identical)
- `heroDesign: BannerDesign | null`
- `todaysDealsDesign: BannerDesign | null`
Normalize in `normalizeSpecialsPresentation` (`:L237-L330`) with
`normalizeDesign` and a buttons normalizer that runs `checkHref` (block →
drop). Add self-tests to the specials presentation core's existing test
function (VERIFY its name: grep `__run` in that file) incl. "absent fields →
defaults (heroButtonsSet false, designs null)".

**Render.** `src/app/specials/page.tsx`: `buttons: presentation.heroButtonsSet
? presentation.heroButtons : hero?.buttons` (F-14 `:L99`). Pass
`heroDesign` and `todaysDealsDesign` through `presentation` (already passed
whole). `SpecialsContent.tsx`: if `pres.heroDesign?.enabled`, render
`<DesignedBanner headingLevel={1} legacy={{eyebrow,title,subtitle}} owner=
"specials:hero" …/>` inside the same outer section wrapper instead of the
legacy hero block (legacy block stays verbatim in the else-branch — pinned
strings F-15). `SpecialsDailyDeals.tsx`: accept optional `design` and pass to
`SectionBanner` (`design={design}`).

**Editor.** `SpecialsPresentationEditor.tsx` hero tab: new "Buttons" card
(add/edit/remove/reorder up to 4, label, LinkPicker, style, show) — when the
owner first opens it and `heroButtonsSet` is false, pre-fill with the legacy
row buttons (passed from `admin/specials/page.tsx` by reading the
`specials.hero` row through the store — VERIFY a getter exists:
`getSectionsForRender` is preview-dependent; better read directly with
`listSections("specials")` from page-sections-store and pick
`specials.hero`; buttons = draft ?? live). Saving sets `heroButtonsSet:
true`. Plus "🎨 Custom design" toggle + BannerStudio for the hero (legacy
text = the specials hero copy blocks) and for the Today's Deal banner
(legacy text = eyebrow "Today's Deal", title/subtitle = today's deal
presentation; bind boxes to those so the daily title still changes by day).
Keep pinned strings (F-17: `type TabKey = "hero" | "cards" | "banner"`,
`useState<TabKey>("hero")`, `setGlobal("heroBannerImage"`,
`setGlobal("heroBannerTextAlign"`, etc.).

**Acceptance (S4).** Remove the hero button → gone after publish; add two →
both show; repoint to a filtered menu → link matches; design on → hero
renders designed; Today's Deal design binds daily title.

**Owner test steps** — PART 11 §S4.

---

### SLICE S5 — Loyalty consent wording editable

**Goal.** "Loyalty signup page legal wording editing … it's mine to edit,
please let me edit it." (Q9).

**Step 0 (research gate).** Scrape the eCFR 64.1200 page; paste the verbatim
(f)(9) definition into this section (5.0 below) before coding. If the page
cannot be fetched, use the Cornell LII mirror
(https://www.law.cornell.edu/cfr/text/47/64.1200) and note the source.

**5.0 Verbatim (f)(9)** — fetched at S5 time from the Cornell LII mirror
(https://www.law.cornell.edu/cfr/text/47/64.1200, current through amendment
90 FR 42138, Aug. 29, 2025):

> (9) The term prior express written consent means an agreement, in writing,
> bearing the signature of the person called that clearly authorizes the
> seller to deliver or cause to be delivered to the person called
> advertisements or telemarketing messages using an automatic telephone
> dialing system or an artificial or prerecorded voice, and the telephone
> number to which the signatory authorizes such advertisements or
> telemarketing messages to be delivered.
> (i) The written agreement shall include a clear and conspicuous disclosure
> informing the person signing that:
> (A) By executing the agreement, such person authorizes the seller to deliver
> or cause to be delivered to the signatory telemarketing calls using an
> automatic telephone dialing system or an artificial or prerecorded voice;
> and
> (B) The person is not required to sign the agreement (directly or
> indirectly), or agree to enter into such an agreement as a condition of
> purchasing any property, goods, or services.
> (ii) The term "signature" shall include an electronic or digital form of
> signature, to the extent that such form of signature is recognized as a
> valid signature under applicable federal law or state contract law.

Related text from the same section (same fetch):
- (f)(3): "The term clear and conspicuous means a notice that would be
  apparent to the reasonable consumer, separate and distinguishable from the
  advertising copy or other disclosures."
- (a)(10) (revocation): consent may be revoked by any reasonable method; the
  words "stop," "quit," "end," "revoke," "opt out," "cancel," or
  "unsubscribe" sent in reply to a text are per se valid; requests must be
  honored within 10 business days; a seller may not designate an exclusive
  means of revocation. → The checker's STOP item therefore says "tell people
  they can reply STOP" and never implies STOP is the ONLY way to opt out.

Mapping to the checker (S5 core): W-ATDS ← (9) + (i)(A); W-SELLER ← "authorizes
the seller"; W-NOT-CONDITION ← (i)(B); W-STOP ← (a)(10) + CTIA practice;
W-RATES ← CTIA practice; W-AGE ← business rule (21+ store); W-EMPTY (blocking)
← (i) requires a disclosure at all.

**Core.** `src/lib/loyalty/loyalty-consent-core.ts` (pure):
- `LOYALTY_CONSENT_BLOCK = "loyalty.form.consent_text"`.
- `DEFAULT_CONSENT_TEXT` = byte-identical to F-19 (move the string here; the
  form imports it — keep `const consentText =` in the form as
  `const consentText = DEFAULT_CONSENT_TEXT;`? The pinned test expects the
  literal phrases `replying \"STOP\"` and "Consent is not a condition of
  purchase" IN THE FORM FILE (F-19). DECISION: update that test on purpose to
  read the core file for the phrases, with the R41 Q9 reason in a comment;
  keep `const consentText =` in the form as the resolved value.)
- `checkConsentText(text)` → `{ blocking: boolean; items: { code, ok, level:
  "law" | "practice", label, explain, source }[] }` per PART 3.6 (W-ATDS,
  W-NOT-CONDITION, W-SELLER = law-derived; W-STOP, W-RATES = practice;
  W-AGE = business; W-EMPTY = blocking). Matching is case-insensitive on
  normalized whitespace with synonym sets (e.g. ATDS: "automatic telephone
  dialing system", "autodialer", "automated technology", "artificial or
  prerecorded voice"; not-condition: "not a condition of purchase", "not
  required to … as a condition", "not a condition of buying").
- `consentFingerprint(text)` → sync SHA-256 hex? Pure + sync SHA-256 requires
  an implementation; the repo has `src/lib/...keyed-hash` (R39) — VERIFY
  whether a pure SHA-256 exists (grep "sha256" in src/lib). If only
  node:crypto exists, compute the hash in the SERVER route (not the core) and
  keep the core free of crypto.
- Self-tests: default text passes all law+practice checks; removing "STOP"
  sentence flags W-STOP only; removing "Consent is not a condition of
  purchase." flags W-NOT-CONDITION; empty → blocking; whitespace-only →
  blocking; synonyms accepted.

**Registry.** Add to `LOYALTY_CONTENT_BLOCKS` a 9th block `{ key:
"loyalty.form.consent_text", section: "signup", label: "Marketing consent
wording (legal)", help: "The paragraph next to the consent checkbox. You own
this wording. Keep the required parts — the checker below tells you if one is
missing.", fallback: DEFAULT_CONSENT_TEXT }`. Update self-test counts 8 → 9,
signup 3 → 4 (F-19a) and the vitest mirror. Seed auto-derives (F-21) — check
the seed's `field_type` for this long text (prefer "textarea" or whatever the
editor uses for long text; VERIFY the editor component supports multi-line —
LoyaltyPageEditor renders fields; check how it chooses input vs textarea).

**Render.** `src/app/loyalty/page.tsx` already fetches LOYALTY_CONTENT_KEYS
(F-21) → pass `consentText: resolveLoyaltyValue(LOYALTY_CONSENT_BLOCK,
values)` into the form's content props. `LoyaltySignupForm.tsx` uses
`content.consentText ?? DEFAULT_CONSENT_TEXT`, renders with
`whitespace-pre-line`, and posts `consentText` (the exact text shown) with the
form.

**Record.** API route (`src/app/api/loyalty-signup/route.ts`) → `parseLoyaltySignup`
accepts optional `consentText` (≤ 4000 chars) → `storeLoyaltySignup` computes
SHA-256 (node:crypto) → `createLoyaltySignup` inserts `consent_text` +
`consent_text_sha256`; on Postgres error code `42703` (undefined_column) or a
message containing "consent_text", retry without the two fields. The
notification email adds "Consent wording version: <first 12 hex>".
SECURITY: the server must not trust the posted text blindly — compare it with
the CURRENT published consent text (server-side resolve) and record a flag
`consent_text_matches_published` (boolean) in the JSONL + DB? Keep it simple:
store what the server resolved as published (authoritative) and, if the
posted text differs, store the posted one too in JSONL only for audit. 
DECISION: server records the PUBLISHED text it resolves at submit time (the
customer saw the published text unless the page was cached during a publish;
revalidate 60 s). Do not accept client text at all → simpler, no spoofing.

**Migration 0264** `supabase/migrations/0264_loyalty_consent_text.sql`:
```sql
alter table public.loyalty_signups add column if not exists consent_text text;
alter table public.loyalty_signups add column if not exists consent_text_sha256 text;
comment on column public.loyalty_signups.consent_text is 'R41 S5: exact marketing-consent wording shown when the customer signed up';
```
Check `scripts/compliance/verify-migrations-execute.ts` expectations (CI runs
every migration in order against a scratch DB) and any migration index file
(grep for `0263_ach_operations` across the repo to find registries).

**Editor.** `LoyaltyPageEditor.tsx` + `admin/loyalty-page/page.tsx`: remove
"locked" wording for consent (F-22), keep the program-numbers lock. Show the
consent field as a large textarea with the live checklist (`checkConsentText`)
under it: green ✓ / amber ⚠ per item with "Why" text and source link; publish
disabled only when blocking. Show "Customers who signed up before you change
this keep the wording they agreed to (saved with their signup)" — TRUE only
after migration 0264 is applied; until then say "Apply migration 0264 so each
signup records the exact wording" (detect via a cheap select of the column
with `.limit(0)` in the page loader; on error show the notice).
`isLoyaltyContentBlock` already gates save/publish → the new key works.

**Acceptance (S5).** Edit consent → preview shows new text → publish → live
form shows it; delete "STOP" sentence → amber warning, still publishable;
empty → cannot publish; signup after 0264 → row has consent_text.

---

### SLICE S6 — Design on every remaining banner

**Scope (verify each at S6 time).**
- `BannerData` (+ `toBannerData`): add `textAlign`, `design` (from
  `settings.design`). Additive.
- Vendors page: `VendorDirectory.tsx` grow / brands / extras → pass `design`,
  `textAlign`, `imageFocus` (currently grow/brands pass only text+buttons —
  F-?? `:L176-L189`, `:L259-L268`). Keep `titleClassName` for grow when no
  design.
- Specials extras (`SpecialsContent.tsx:L608-L621`) and Shop extras
  (`ShopPage.tsx:L113-L124`; menu is retired from the builder so extras are
  legacy-only — still pass design for completeness).
- Loyalty hero + Shop carousel: they already have rich per-block styling
  (F-24). Adding the full studio there is LARGE; S6 adds ONLY: Enter→new
  line already supported (loyalty hero honors hard breaks per its header);
  verify Shop carousel too; and records OQ-4 for the owner ("Do you want the
  full Banner Studio on the Loyalty hero and Shop carousel too?"). If time
  permits, add `design` to `ShopHeroPresentation` + `LoyaltyHeroPresentation`
  the same way (optional field, enabled flag, legacy fallback).
- About / FAQ / Locations / Price Match: builder sections are not rendered
  (F-08a). These pages are static (no `revalidate`/draftMode). Adding
  `getPageBanners` makes them dynamic-on-draft and may break
  `usage-5-public-page-revalidate.test.ts` expectations. DECISION: do NOT add
  in R41; instead the builder page for those slugs shows an info banner "Banners
  you add here don't show on the public page yet" — wait, that is a visible
  defect today. Record OQ-3 and ask the owner in the final report whether he
  wants them rendered (with revalidate 60) in the next round.

---

### SLICE S7 — Hub preview "Move mode"

**Goal.** In Website Sync → Preview (the one hub preview window, F-27), the
owner turns on "✋ Move text" and drags any text box or button on any page's
designed banner; on drop it saves to that banner's DRAFT.

**Iframe side.** New client component `src/components/site/PreviewDesignDrag.tsx`
mounted by `PreviewEditOverlay` (already rendered in preview mode on public
pages — VERIFY where PreviewEditOverlay is mounted; grep). It listens for
`gw-move-mode` from the parent (origin check), and when on: adds a CSS class
to `<html>` that outlines `[data-gw-design-box]` / `[data-gw-design-button]`
elements (dashed, 2px, accent), attaches pointer handlers to
`[data-gw-design-frame]` descendants, moves the element visually during drag
(CSS transform only, no React state on the server component), computes the
new x/y % relative to its frame on drop, posts `gw-design-move` (PART 5.7
M-2). Non-designed banners: overlay badge per `SectionBanner` root? Simpler:
the parent shows the help text; skip per-banner badges (OQ-5).

**Parent side.** `PreviewFrame.tsx` gains optional props `moveMode?: boolean`
and `onDesignMove?: (m) => void`; posts `gw-move-mode` to
`iframe.contentWindow` on load and when moveMode toggles. Validates incoming
messages with `parseMoveMessage`. `WebsiteSyncPreviewPanel.tsx` gets the
toggle, calls the server action, toasts, refreshes the frame (bump nonce),
and supports `?path=` deep link (pre-select page from the URL search param —
VERIFY how website-sync page passes searchParams to the panel; the panel is
a client component, so use `useSearchParams()` within a Suspense boundary or
pass from the server page).

**Server.** New `src/app/admin/website-sync/design-actions.ts` ("use server"):
`saveDesignMoveAction(input)` → `requirePermission("content.edit")`;
`parseMoveMessage` again server-side; route by owner:
- `section:<uuid>` → `getSection(id)`; design = readDesign(draft_settings ??
  settings); `applyMove`; `saveSectionDraft(id, { settings:
  writeDesign(draft_settings ?? settings, moved) })`; audit
  `page_section.design_move`; revalidate the page path.
- `specials:hero` / `specials:todays` → load the specials presentation DRAFT
  (content block draft_value ?? published_value), normalize, applyMove on
  `heroDesign` / `todaysDealsDesign`, `saveContentDraft`; audit.
Returns `{ ok: true, message }` / `{ ok: false, message }` (no redirect).
**Important:** the preview iframe shows DRAFTS (Draft Mode), so the moved
position is visible after reload even before publish. The toast says
"Saved as a draft — open <editor> and press Publish to make it live."

**Acceptance (S7).** Toggle Move → outlines appear on designed banners; drag
headline → reload shows new place; Phone device → move saves phone layout
only; keyboard: the editor (S2) provides the non-drag alternative (state in
the help text).

---

### SLICE S8 — AI focus + placement assistant (drafts only)

**Goal.** "Maybe add ai to help me focus the image just right and to place the
text boxes properly." (Q21)

**Core.** `src/lib/cms/banner-ai-core.ts` (pure): `buildPlacementPrompt({
roles, textLengths, device })` → system/user strings (asks for STRICT JSON:
`{ "focusX": 0-100, "focusY": 0-100, "textZone": { "x","y","w","h" },
"overlay": "none|full|gradient|floor|radial", "overlayDirection":
"left|right|top|bottom", "textColor": "light|dark", "reason": "<=200 chars" }`),
`parsePlacementReply(raw)` → validated suggestion or null (strip code fences,
JSON.parse, clamp, enums), `applySuggestion(design, s)` → new design
(focus + boxes laid out top-down inside textZone with role sizes + overlay +
color light #ffffff / dark #111111). Self-tests on parser (fences, garbage,
clamping, enums) and applySuggestion (boxes within zone, unchanged ids).

**Action.** `suggestBannerPlacementAction({ imageSrc, design })` in a "use
server" file under `src/app/admin/pages/[slug]/` (or a shared
`src/app/admin/banner-ai-actions.ts`): `requirePermission("content.edit")`;
if `!isAiConfigured` → `{ ok: false, message: "AI isn't set up yet" }`;
absolute image URL (relative → `publicSiteOrigin(process.env)` + path,
F-33/PART 3.9); `generateVision({ system: COMPLIANCE_SYSTEM + placement
instructions, user, imageUrl, maxTokens: 300, temperature: 0.2, context: {
feature: "banner.placement", … } })`; parse; return suggestion (NO save).

**UI.** Banner Studio "✨ AI suggest" button → shows the suggestion as a
ghost overlay on the canvas + reason text, with "Apply" (updates unsaved
studio state only) / "Dismiss". Owner still presses Save draft / Publish.

**Acceptance.** AI off → friendly message; AI on → suggestion appears; Apply
moves focus/boxes in the editor only; nothing is saved until Save.

---

## PART 7 — FILE INVENTORY (what each slice creates or touches)

Legend: **N** = new file, **M** = modified, **T** = test file. Every M entry
must be re-read at slice time before editing (never edit from memory).

### S1
- N `src/lib/cms/banner-design-core.ts` — types, defaults, `normalizeDesign`,
  `designFromLegacy`, `boxStyleVars`, `buttonStyleVars`, contrast helpers,
  `__runBannerDesignTests`.
- N `src/lib/cms/link-target-core.ts` — `LinkTarget`, `buildMenuHref`,
  `parseMenuHref`, `checkHref`, `describeHref`, `__runLinkTargetTests`.
- M `scripts/compliance/run-pure-selftests.ts` — two `assertRan` lines after R40.
- T `tests/compliance/r41-design-cores.test.ts` — drift guard: special keys /
  sorts copied into link core must match `InteractiveMenuBrowser.tsx`.

### S2
- M `src/app/page.tsx` — pass `textAlign`, `buttons`, non-center `imageFocus`,
  `design` through to PromoGrid / HomeBrands; render home extras.
- M `src/components/home/PromoGrid.tsx` (+ HomeBrands) — accept and forward props.
- N `src/components/banners/DesignedBanner.tsx` — server-safe renderer.
- M `src/components/SectionBanner.tsx` — when `design?.enabled`, delegate to
  DesignedBanner; else legacy path byte-identical.
- M `src/app/globals.css` — `.gw-banner` container-query rules only.
- N `src/components/admin/banner-studio/BannerStudio.tsx` (client) — canvas,
  box list, inspector, buttons panel, device toggle, contrast badges.
- N `src/components/admin/banner-studio/LinkPicker.tsx` (client).
- M `src/app/admin/pages/[slug]/SectionCard.tsx` — "Custom design" tab;
  headline/subhead inputs become textareas (Enter = new line).
- M `src/app/admin/pages/[slug]/actions.ts` — accept + normalize `design`
  into `settings.design` / `draft_settings.design`.
- M `src/lib/cms/page-sections-store.ts` — expose `design` on read models.
- N `src/app/admin/pages/[slug]/link-options.ts` (server helper) — blog posts,
  specials, categories for the picker.

### S3
- M `src/lib/cms/daily-deal-presentation.ts` — `typeCards` list reader with
  defaults derived from `categoryLanes` and existing `laneImages`.
- N `src/lib/cms/type-cards-core.ts` + self-test.
- M `src/components/admin/TypeCardImagesEditor.tsx` → becomes Type Cards
  editor (name, image, link, add, delete, reorder; max 12).
- M home category render component (anchor at S3 time).

### S4
- M `src/lib/cms/specials-presentation-core.ts` — `heroButtons`,
  `heroButtonsSet`, `heroDesign`, `todaysDealsDesign` + self-test additions.
- M `src/app/specials/page.tsx`, `src/components/specials/SpecialsContent.tsx`.
- M `src/app/admin/specials/actions.ts` + specials editor UI.
- T update `specials-presentation.test.ts` / `specials-editor-upgrade.test.ts`
  only additively.

### S5
- N `supabase/migrations/0264_loyalty_consent_text.sql`.
- N `src/lib/loyalty/loyalty-consent-core.ts` + self-test.
- M `src/lib/cms/loyalty-content-core.ts` (9th block), `LoyaltyPageEditor.tsx`,
  `admin/loyalty-page/page.tsx`, `LoyaltySignupForm.tsx`, `signup.ts`,
  `signups-store.ts`.
- T `loyalty-page-editor.test.ts` updated (8→9, consent-key rule replaced with
  "consent block must exist and fall back to the exact legacy text").

### S6
- M `src/lib/cms/page-sections-store.ts` (`BannerData`), `VendorDirectory.tsx`,
  `SpecialsContent.tsx` extras, `ShopPage.tsx` extras.

### S7
- M `src/components/admin/PreviewFrame.tsx`, `WebsiteSyncPreviewPanel.tsx`.
- N `src/components/banners/MoveModeClient.tsx` (client, only mounted in
  draft mode).
- N `src/app/admin/banner-move-actions.ts` ("use server").

### S8
- N `src/lib/cms/banner-ai-core.ts` + self-test.
- N `src/app/admin/banner-ai-actions.ts`.
- M `BannerStudio.tsx` (AI button).

---

## PART 8 — TEST GATES PER SLICE (all must pass before PR merge)

Each slice runs, in this order, and records the result in Part 12:

1. `npx tsc --noEmit` → 0 errors.
2. `npx eslint <changed files>` → 0 errors (warnings allowed only if
   pre-existing).
3. `npx tsx scripts/compliance/run-pure-selftests.ts` → all pass; new
   `assertRan` floors met.
4. `npm run test:compliance` → all pass (pinned tests listed in Part 2).
5. `npx next build` → succeeds (run in background, poll log).
6. Authorship: `git log --format='%an <%ae>' origin/main..HEAD | sort -u` →
   only `Greenway Dev <dev@greenwaymarijuana.com>`.
7. After merge: prod status `success` for the merge sha (Vercel context).

Slice-specific extra gates:
- S1: self-test floors ≥ 40 (design) and ≥ 30 (links).
- S2: legacy byte-identity — the vitest snapshot of `SectionBanner` source
  path for `design` undefined still contains the old JSX branch; manual
  statement in PR that no default visuals change.
- S5: `scripts/compliance/check-migrations-execute` (CI) passes on 0264;
  migration is idempotent (`add column if not exists`).
- S7: postMessage handler checks `event.origin === window.location.origin`.
- S8: action returns without saving; vitest asserts no `upsert`/`update` in
  the action file.

---

## PART 9 — RISK REGISTER

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R-1 | Designed banner changes look of existing banners | Low | High | Opt-in `design.enabled`; legacy path untouched |
| R-2 | Container queries unsupported on old browsers | Low | Low | Fallback `font-size` px from desktop value set before `cqw` rule |
| R-3 | Pinned compliance tests break on edits | Med | Med | Re-read pinned tests before each slice; edit additively; any test change states its reason in the commit |
| R-4 | Consent text edited into a non-compliant state | Med | High | Warnings for missing TCPA elements; empty blocks publish; signup stores exact text + SHA-256 as proof |
| R-5 | Migration 0264 not yet applied when code ships | High | Med | Insert retries without new columns on 42703; owner told to apply |
| R-6 | Drag in iframe conflicts with links/scroll | Med | Low | Move mode is an explicit toggle; links disabled while on; `touch-action:none` on handles only |
| R-7 | Cross-origin message spoofing | Low | Med | Origin check both directions; owner id whitelist pattern |
| R-8 | AI suggests bad placement | Med | Low | Drafts only, ghost preview, Apply/Dismiss, nothing saved |
| R-9 | Unsafe hrefs from link picker | Low | High | `checkHref` blocks `javascript:`/`data:`/`vbscript:`/`//`; server re-checks |
| R-10 | Type card defaults differ from today | Med | Med | Defaults derived from `categoryLanes` + carried `laneImages`; unchanged until owner saves |
| R-11 | Sandbox build timeouts | High | Low | Run build in background, poll; commit before long steps |
| R-12 | WAC 314-55-155 warnings misread as legal advice | Low | Med | Wording: "reminder, not legal advice"; never blocks |

---

## PART 10 — OPEN QUESTIONS FOR THE OWNER (asked in final report, not guessed)

- **OQ-1** WAC 314-55-155(7) warnings apply to "advertising"; does Michael
  treat on-site banners as advertising? Editor only reminds; no auto-insert.
- **OQ-2** (resolved in design) consent stored per signup — confirm he is
  happy that edited wording only applies to new signups.
- **OQ-3** About / FAQ / Locations / Price Match builder banners don't render
  publicly today. Render them next round (makes pages revalidate every 60s)?
- **OQ-4** (ANSWERED BY BUILDING, S6) Full Banner Studio on the Loyalty hero
  and every Shop carousel slide is now an OPTIONAL tick-box ("Custom design")
  beside their existing styling editors. Ask: is one desktop picture enough
  for a designed banner? (A designed banner uses the desktop picture on both
  sizes, with its own phone focus/height; the classic look keeps two pictures.)
- **OQ-5** Per-banner badges (e.g., "NEW", "TODAY ONLY") as a box role is
  shipped; does he want preset badge styles?

---

## PART 11 — OWNER TEST STEPS (plain English, per slice)

These steps are repeated, with final details, in the end-of-round report.
"Hub" = the back-office Website editor. Always test on a phone too.

### S1 (cores) — nothing visible
1. Nothing to click. Confirm the website looks exactly as before.

### S2 (Home sections + Banner Studio)
1. Hub → Pages → Home → open any banner section (e.g. Promo).
2. Set text alignment to Left, then Center, then Right; Save draft; open the
   preview. Text must follow the setting. (Before this round it did not.)
3. In the headline box, press Enter between two words. Preview shows two lines.
4. Open the "Custom design" tab → turn on "Use custom design". The canvas
   shows the banner with your current text, unchanged.
5. Drag the headline box somewhere else. Also try typing X/Y numbers and
   using arrow keys (Shift+arrow moves faster).
6. Change font, size, bold, italic, underline, strike-through, color. Watch
   the contrast badge: green = readable, amber/red = hard to read.
7. Image: move the focus point, zoom, brightness, overlay (gradient/floor/
   full/radial). Switch to Phone view and adjust positions just for phone.
8. Add a text box: pick a role (Eyebrow, Headline, Sub-headline, Body,
   Badge, Legal). Delete one. Max 8.
9. Buttons: add, drag, resize (S/M/L), shape, style, colors. Click "Link":
   choose Menu → pick a category and filter (e.g. On sale, Flower, sort by
   price) → Save. Also try Blog post and Newsletter, and an outside link.
10. Save draft → preview shows it. Publish → live site shows it. Turn
    "Use custom design" off → banner returns to the old look.

### S3 (Type Cards)
1. Hub → Home → Type Cards. Rename a card, change its image, change its link.
2. Add a new card; delete one; reorder with the up/down arrows.
3. Publish; the home page shows the new set. Max 12 cards.

### S4 (Specials)
1. Hub → Specials → Hero. The banner button now appears in the editor:
   change its text, repoint it with the link picker, remove it, add a second.
2. Turn on custom design for the hero and Today's Deals and repeat S2 steps.
3. Publish; check /specials on desktop and phone.

### S5 (Loyalty consent)
(Rewritten at build time to match what was built. The draft mentioned a
HELP check, which was not built because nothing in the (f)(9) text or the CTIA
section we cited requires it.)
1. Apply migration `0264_loyalty_consent_text.sql` in the Supabase SQL editor,
   then run the Check query in docs/MIGRATIONS_TO_RUN.md (expect `2`).
2. Go to Admin → Website → Loyalty page → "Signup form" → **Marketing consent
   wording (legal)**. It shows today's wording, the 7-line checklist (all ✓),
   and a preview.
3. Delete the sentence `I understand that I may opt-out … replying "STOP".` →
   only the STOP line turns ⚠, and Publish stays allowed after Save draft.
4. Clear the box → the first line turns ✕. Save draft → Publish is greyed out.
   (If forced, the server shows "The consent paragraph is empty …".)
5. Type your wording with an Enter between two sentences → Save draft →
   Publish → open /loyalty (wait up to 60 s or refresh) → the new wording shows
   next to the checkbox, with the line break.
6. Send a test signup → Supabase `loyalty_signups` newest row has
   `consent_text` = your wording, and `consent_text_sha256` is 64 hex
   characters. The staff email says "Consent wording version: <12 chars>".
7. "Put back the original wording" restores the shipped text → Save → Publish.

### S6 (remaining banners) — as built
1. **Text align / Image focus now work on every page.** Admin → Pages →
   Vendors → open "Grow With Greenway" → set Text align to Center and Image
   focus to Left → Save → Publish → open /vendor-delivery: the words sit in
   the middle and the picture hugs the left. Do the same on a Specials or Shop
   extra banner if you have one. (Banners left on "Center" focus keep the
   exact look they have today.)
2. **Custom design on Vendors / Specials / Shop extra banners:** open the
   banner → tick "Use custom design" → drag text → Save → Publish → check
   the live page.
3. **Home big carousel, new lines:** Admin → Home carousel → a slide's Title
   or Description → press Enter between words → Save → Publish → the home
   page shows two lines.
4. **Loyalty hero:** Admin → Loyalty page → hero section. The Eyebrow and
   Subtitle boxes now take Enter for a new line too. Scroll to "Custom design
   (optional)" → tick "Use custom design" → "Open design studio" → drag the
   headline, add a button (the link picker can point at a filtered menu or a
   blog post) → Save draft → Publish → /loyalty shows the designed hero.
   Untick it → Save → Publish → the classic hero is back exactly as before.
5. **Shop carousel slides:** Admin → Shop banner → open a slide → same
   "Custom design (optional)" box. Your two slide buttons are copied in as
   starting buttons. Save draft → Publish slide → /menu shows it.

### S7 (Move mode in hub preview)
1. Hub → preview window → click "Move mode".
2. Grab any text box or button on Home or Specials and drag it. Release.
3. It saves to the draft only. Publish to make it live. Toggle off to
   click links normally again.

### S8 (AI assist)
1. In Banner Studio, click "✨ AI suggest". A dotted ghost layout appears
   with a short reason.
2. Apply → boxes and focus move in the editor; nothing is saved until you
   press Save draft. Dismiss → nothing changes.
3. If AI isn't configured you see "AI isn't set up yet".

---

## PART 12 — STATUS CHECKLIST (updated after every merge)

| Slice | Status | PR | Merge sha | Prod |
| --- | --- | --- | --- | --- |
| S0 bible | done | (in S1 PR) | — | — |
| S1 cores | merged | #1321 | see git log | ready |
| S2 studio | merged | #1322 | 2973a447 | success |
| S3 type cards | merged | #1323 | 5392544d | deploying at merge time |
| S4 specials | merged | #1324 | 94d64f5a | success |
| S5 consent | merged | #1325 | d419775f | success |
| S6 all banners | PR open (branch r41-s6-banners) | — | — | — |
| S7 move mode | not started | — | — | — |
| S8 AI | not started | — | — | — |
| S9 report | not started | — | — | — |

---

## PART 13 — IMPLEMENTATION LOG (deviations found while building)

- **S1 (PR #1321).** Cores shipped as specified. Self-test floors set to the
  first green counts: banner-design-core 89, link-target-core 58. Full `tsc`
  is OOM-killed in the 3 GB sandbox (exit 134/137); new files were typechecked
  with a scoped tsconfig extending the repo config, and the full typecheck runs
  in CI (`npm run typecheck`).
- **S2(a) verification of a PART 6 S2 assumption.** The bible said "verify seed
  `[]` buttons for home.category". VERIFIED FALSE: `page-sections-seed.ts`
  seeds `home.category` with "Browse the menu" → /menu and `home.brand` with
  "See all brands" → /vendor-delivery (both enabled). Those never rendered
  because page.tsx dropped `buttons`. Decision: pass them, because the editor
  shows them as live and the owner asked for working buttons (what you see in
  the editor is what you get). The owner report must say: "Your home banners
  now show the buttons listed in the editor (by default 'Browse the menu' and
  'See all brands'). Untick 'Show' on a button to hide it."
- **S2(b) renderer.** `SectionBanner` renders a `BannerDesign` when
  `design.enabled` is true, otherwise the legacy markup byte-for-byte.
  Container queries (`containerStyle()` → cqw units, `@container gwb` rules in
  globals.css) keep the layout proportional at every width, so what the owner
  sees in the studio is a scaled copy of the live banner.
- **S2(c) editor (Banner Studio).** Files: `src/components/admin/banner-studio/`
  (controls, LinkPicker, StudioCanvas, TextBoxPanel, ButtonPanel, ImagePanel,
  WarningsPanel, BannerStudio). Loaded with `next/dynamic({ssr:false})` from
  the client `SectionCard`, so pages that never open it don't pay for it.
  Choices backed by research:
  - WCAG 2.2 SC 2.5.7 (dragging movements): every drag has a number box and an
    arrow-key alternative.
  - Snapping at 0/50/100 % with orange guides, Alt to turn it off (the common
    Figma/Canva habit).
  - Undo/redo keeps 60 steps and groups edits made within 600 ms, so one slider
    drag is one undo step.
  - The link picker opens in a portal on document.body, so Enter inside it
    can't submit the outer page form.
- **S2(c) deviation: Enter = new line.** Eyebrow/title/subtitle became
  auto-growing textareas. The server action now turns CRLF into "\n"
  (`multiline()`), so `white-space: pre-line` shows exactly one break per Enter.
- **S2(c) deviation: unsafe links dropped on save.** `parseButtons` skips
  `javascript:`/`data:`/`vbscript:`/backslash hrefs (`isDangerousHref`) as a
  second guard after the client-side `checkHref`.
- **S2(c) reach (verified by grep of `<SectionBanner` usages).** Custom design
  takes effect on: Home category + brand banners, Home extra banners, Vendors
  "grow" (rendered as h1, the page's only h1) + "brands" banners, and extra
  banners on Specials, Menu and Vendors. NOT yet: the Specials top hero (its
  own component → S4), the Loyalty hero (image-led, its own editor → S6) and
  menu.hero (retired). The toggle shows on every SectionCard; the owner report
  must list where it applies.
- **S2 picker data.** `listPublishedPostLinks()` reads only slug/title/kind,
  with no media lookups, and falls back to the static post list on error.
- **S3 verification of PART 6 S3 assumptions.**
  - `home-section-settings-core` DOES have `__runHomeSectionSettingsTests`, but
    Type Cards went into a new `type-cards-core.ts`, because it imports
    `link-target-core` (for checkHref) and the existing core must stay
    import-free.
  - `daily-deal-presentation.ts` imports runtime code (`./daily-deals` →
    promotions seed/brand-match), so the six lanes were COPIED into
    `DEFAULT_TYPE_LANES`. The vitest drift guard in r41-type-cards.test.ts
    compares the copy to `categoryLanes`.
  - `saveHomeSectionSettings` shallow-merges, so the action always writes BOTH
    `typeCards` and a full `laneImages` mirror (default ids only, `{}` when
    none). This way, stale lane images can't come back.
- **S3 decisions.**
  - Byte-identical default: page.tsx passes `typeCards` only when the
    `typeCards` key exists. Until then, PromoGrid maps `categoryLanes` exactly
    as before, and six tiles keep the exact shipped grid class string (pinned
    by tests).
  - Grid column classes are a fixed literal lookup (Tailwind v4 can't see
    dynamic class names). More than 6 cards wrap at 6 per row on computers.
  - Card images accept only site paths (`/…`, not `//…`) and http(s) URLs
    without quotes.
  - Reorder uses ▲/▼ buttons rather than drag, so it works with a keyboard and
    screen reader (WCAG 2.2 SC 2.5.7).
  - Deleting every card (or hiding them all) hides the tile row, but the banner
    stays.
- **S4 verification of PART 6 S4 assumptions.**
  - The specials core's test function is `__runSpecialsPresentationCoreTests`.
    It throws on failure, and the runner requires `passed ≥ 1`. S4 adds 18
    assertions, for 97 in total.
  - The hero's legacy buttons are read from `listSections("specials")` →
    `specials.hero`, using `buttons` (PUBLISHED, which is what customers see).
- **S4 decision: byte-identical JSON.** `serializeSpecialsPresentation`
  writes `heroButtonsSet` / `heroButtons` / `heroDesign` / `todaysDealsDesign`
  only when they're set. An untouched block serializes exactly as before. The
  existing round-trip tests pin the key order (`heroButtons` sits before
  `heroButtonsSet` in both default and normalize).
- **S4 decision: legacy buttons until the first edit.** Before the owner
  touches the Hero buttons card, it shows the legacy row buttons. The first
  edit copies them in and sets `heroButtonsSet`, and Publish makes it live.
  "Go back to the old buttons" clears the flag. A saved empty list means NO
  buttons.
- **S4 layout.** Both design studios sit full-width under their tab's
  two-column grid, since Banner Studio needs the width. The Today's Deal
  design binds eyebrow/title/subtitle, so the weekday copy still flows in
  (the studio preview uses TODAY's wording from `dealPresentationFor`).
- **S5 research gate done.** (f)(9) was pasted verbatim from Cornell LII
  (eCFR wasn't fetched). CTIA Messaging Principles (May 2023 PDF) was
  downloaded and read. §5.1.1 says the Call-to-Action must disclose "any
  associated fees or charges" and how to opt out. §5.1.3 says "Standardized
  'STOP' wording should be used for opt-out instructions". The checklist cites
  these exact sections.
- **S5 verified facts.**
  - `getContentValues` honours Draft Mode, so the server CANNOT use it to pick
    the recorded wording. `signup.ts` reads `content_blocks` directly for
    `published_value` + `status`, through `publishedConsentFromRow`, which uses
    the published value only and the default when blank.
  - `publishContentBlock` promotes `draft ?? published ?? ""`, so the
    empty-guard checks that same expression.
  - No pure SHA-256 exists in src/lib. node:crypto `createHash` is used in
    `signup.ts`, which is imported only by the API route, as
    `ach-esign-store.ts` does.
  - Seeds derive from the registry (`field_type: "plain"`). The editor picks a
    textarea from `MULTILINE_KEYS`, which now includes the consent key, and the
    consent block uses its own `ConsentBlock` (rows=9).
  - `loyalty_signups` is already WIPE in factory-reset-core, so adding columns
    needs no reset change.
  - The migration tail pin was moved to 0264 with an honest note: no Postgres
    in the sandbox, and CI's migrations job executes it.
  - `assertRan` needs `{passed, failed}`. The full-repo tsc in CI would have
    caught the first version, and the scoped tsc on the runner caught it here.
- **S5 decision: no client text accepted.** The API route is unchanged, and
  the browser never sends the wording. The recorded wording is what was
  PUBLISHED at submit time. If the owner publishes during the 60 s revalidate
  window, a customer may have seen the previous wording. This is the bible's
  accepted trade-off, written down here, not hidden.
- **S5 decision: staff-entered signups** (Admin → Loyalty signups → add) keep
  `consent_text` NULL. The customer saw no on-screen paragraph.
- **S5 pinned-test change ON PURPOSE.**
  `loyalty-page-editor.test.ts` "consent stays FIXED" became "owner-editable
  with a safe default (R41 S5)". The R41 Q9 reason is in the comment. The
  counts changed 8→9, signup 3→4, and loyalty seeds 11→12.
- **S6 recon (verified, not assumed).**
  - `BannerData`/`toBannerData` ALREADY carried `textAlign`, `design` and
    `designOwner` (done in S2). But `imageFocus`/`textAlign` were NOT passed
    on to `<SectionBanner>` for the Specials extras, Shop extras, or Vendors
    grow/brands/extras, so the builder's "Text align" and "Image focus" did
    nothing on those pages. FIXED: a shared `pinnedImageFocus` (moved out of
    `src/app/page.tsx` into `page-sections-types.ts`) keeps today's look when
    the focus is "center" (the seed default). All Vendors seeds are text
    "left" + focus "right", which the classic rule already renders with the
    picture on the right, so no live banner moves.
  - The Home `Hero.tsx` carousel collapsed Enter in the title and description
    (no `whitespace-pre-line`). FIXED. The save action keeps newlines (it only
    `.trim()`s).
  - The Loyalty hero and Shop carousel already split hard line breaks
    (`heroTextLines`), but their Eyebrow and Subtitle editors were single-line
    `<input>`s, so Enter could not be typed (Q8). FIXED: all three lines are
    textareas.
- **S6 decision: optional design on the Loyalty hero and Shop slides.**
  `design?` is appended LAST in both JSON shapes and ONLY when set, so every
  existing stored row serializes byte-identically (pinned by self-tests and
  vitest). Reuses the S4 `DesignCard` and the `preset "hero"`. Headline stays
  h2: the /loyalty h1 is on the signup card, and /menu has its own h1.
- **S6 decision: Move-mode owners.** `loyalty:hero` and
  `shop-slide:<uuid>` were added to `parseMoveMessage`. The Shop slide owner
  is only emitted in Draft Mode, so public HTML never carries row ids or edit
  hooks. The S7 save action must handle both owners.
- **S6 not done (by the bible's own decision):** About/FAQ/Locations/Price
  Match still do not render builder banners (OQ-3, unchanged).
