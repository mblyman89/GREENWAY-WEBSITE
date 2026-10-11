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

