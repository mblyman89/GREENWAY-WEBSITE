# R44: Website Editor Strategy Roadmap

*Greenway Marijuana: research-backed comparison and upgrade plan for the website editor*

Prepared at the end of build round R44 (main at `8e79a465`, 11 Oct 2026).

**Owner request (verbatim, R44):** "then at the end of this build round, deep recon and then deep research to look for all the ways you can add value to the website editor. equip and empower yourself with the knowledge of the professional academic scholarly peer review journals worth of knowledge so you can compare it with what we have and then use that comparison report to create a thorough an all inclusive strategy roadmap report for me if there are ways we can enhance it, upgrade it, harden it, etc. as well as the difficulty, the risk level, if its worth the time effort and money to build more and such. follow the standing rules and never guess, never assume."

**Ground rules for this document**

- Every statement about *our* code comes from reading the repository during R44 recon. File paths are given so they can be checked.
- Every statement about the *outside world* (research, standards, laws, vendors, prices) cites a source that was fetched and read during R44. The full list is in §9.
- Where something could not be verified, the text says so. Nothing is assumed.
- Dollar figures are hosting and vendor costs only, taken from the cited price pages. Build effort is given in rounds, where one round is about one R4x-sized build like R43 or R44.

---

## 0. The one-page summary

The Greenway editor is already ahead of most small-business site builders in four areas:

- **Real drafts.** There is a draft and published version of every block, with revision history, restore, publish-all and discard-all.
- **Preview.** The site can be viewed as staff before anything goes live (Next.js Draft Mode).
- **Roles.** There are six permission levels.
- **Compliance guardrails built into the tools.** The banner contrast checks and the WAC 314-55-155(7) warning-size check are examples. The footer warning text cannot be changed.

As of R44, uploads up to 200 MB are resumable and MP4 banners are accessible.

The research points to **five gaps that matter most to customers and to the business.** In priority order:

1. **Carousel accessibility and behaviour (quick, low risk, high value).**
   - The home-page hero carousel moves on its own every 6 seconds. It offers no way to pause it except hovering a mouse over it. It ignores the "reduce motion" setting on phones and computers, and it can't be swiped.
   - WCAG 2.2.2 requires a pause mechanism for content like this. Baymard's carousel research says stop auto-rotating on mobile, and stop for good once the shopper interacts.
   - This is the highest-value, lowest-cost item in the whole report.
2. **Scheduled publishing (medium effort, low risk, high value).**
   - Today every banner, slide and text change goes live the moment someone presses Publish. Nothing can be set to "go live Friday 6 am, come down Sunday midnight".
   - Holiday sales, 4/20 and daily deals all need this. The site already runs Vercel cron jobs, so the scheduling engine is mostly there.
3. **Image speed (medium effort, low risk, high value).**
   - Banner images don't use blur placeholders.
   - The site uses the default image optimizer without a tuned format list.
   - Only the first visible slide should be fetched at high priority. That needs checking per renderer (see §4.3).
   - Research ties faster pages to more sales. One example: 0.1 s faster gave +8.4% retail conversions in the Deloitte/Google study.
4. **Publish-time quality checks (medium effort, low risk, high value).**
   - Before content goes live, warn about:
     - missing or useless alt text
     - low colour contrast
     - broken links
     - missing "21+" text on ads
     - wording the WSLCB forbids (therapeutic claims, youth appeal)
   - WebAIM's 2026 study found errors on 95.9% of home pages. Shopping sites averaged 71 errors per page.
5. **Measuring what works (medium effort, medium risk, high value once traffic allows).**
   - Track which banners and buttons customers actually click.
   - Show real-visitor speed scores (Core Web Vitals) in the admin.
   - Later, carefully A/B test banners using Vercel Flags, which is included on every plan.

**Lower priority, but worth knowing about:**

- Approval workflow (editor submits, manager approves).
- Edit-conflict warnings when two people edit the same block.
- Autosave everywhere.
- Upload hardening (file-signature checks, stripping photo location data).
- Video captions and transcoding.
- A "where is this image used" view.
- An editable Google business profile (hours, holiday hours).
- Automated accessibility tests in CI.

**Not recommended right now:**

- Real-time multi-user co-editing, Google-Docs style. The cost is high and so is the risk, and the payoff is low for a team this size.
- Personalisation by visitor. The legal risk under WAC 314-55-155(2)(d) is unclear, the privacy cost is real, and A/B tests can't reach statistical power at single-store traffic.
- Replacing the editor with a hosted headless CMS. It would mean a migration, and Greenway's compliance rules are built into the current tools.

The full ranked list is in §6 and the round-by-round plan is in §7.

---

## 1. Method

1. **Recon (our side).** I read the editor, renderer and data code. The main files:
   - `src/lib/cms/content-store.ts`
   - `src/lib/auth/roles.ts`
   - `src/components/home/Hero.tsx`
   - `src/components/menu/ShopBannerCarousel.tsx`
   - `src/lib/seo/seo.ts`
   - `next.config.ts`
   - `vercel.json`
   - `e2e/smoke.spec.ts`
   - `.github/workflows/compliance-tests.yml`
   - the banner studio
   - the R44 upload stack
2. **Research (their side), drawn from:**
   - peer-reviewed HCI and experimentation literature
   - W3C accessibility standards
   - large-sample industry studies: WebAIM Million 2026, Baymard, Web Almanac
   - Google and web.dev performance guidance
   - OWASP security guidance
   - the Washington Administrative Code
   - vendor documentation: Sanity, Supabase, Vercel
3. **Comparison.** For each capability I set what Greenway has against what the research says works and what enterprise CMSs ship (§3).
4. **Scoring.** Each roadmap item is rated on five things:
   - **Difficulty:** S = under ½ round, M = about 1 round, L = 2+ rounds.
   - **Risk:** Low, Med or High. Covers breaking something, legal exposure, or ongoing cost.
   - **Customer value**
   - **Business value**
   - **Running cost:** taken from the cited price pages.

   These combine into a verdict: **Build now**, **Build next**, **Build later**, or **Skip for now**.

---

## 2. What the research says (the evidence base)

### 2.1 Speed is money, and it is measured with real visitors

- **Google's thresholds.** Google's Core Web Vitals define a "good" experience as:
  - Largest Contentful Paint (LCP) ≤ 2.5 s
  - Interaction to Next Paint (INP) ≤ 200 ms
  - Cumulative Layout Shift (CLS) ≤ 0.1

  Each is measured at the 75th percentile of real page loads (web.dev, *Web Vitals*). Google recommends real-user monitoring (RUM) over lab tests for knowing how real visitors experience a site.
- **Business evidence,** compiled by Machina from the original studies:
  - Deloitte and Google, *Milliseconds Make Millions* (2020): a 0.1 s mobile speed gain gave +8.4% retail conversions and +9.2% average order value.
  - Vodafone's A/B test: 31% better LCP gave +8% sales.
  - Rakuten 24's A/B test: +53.37% revenue per visitor.
  - Akamai (2017): 100 ms of delay cut conversions by 7%.
  - Portent (2022): the gains are steepest in the first few seconds.
  - Web Almanac 2025: only 48% of sites pass Core Web Vitals on mobile.
- **The banner is usually the largest element,** so LCP depends on it. web.dev's *Fetch Priority* article recommends:
  - `fetchpriority="high"` on the LCP image. In their Google Flights test, LCP improved from 2.6 s to 1.9 s.
  - `fetchpriority="low"` on carousel slides that aren't visible. In their Oodle demo this cut load time by about 2 s.
- **Perception.** First impressions of a page form in about 50 ms (Lindgaard et al., 2006, *Behaviour & IT* 25:115–126). Perceived visual aesthetics strongly shape how users judge a site (Lavie & Tractinsky, 2004, *IJHCS*). Fast, polished banners do measurable work.

### 2.2 Accessibility failures are the norm, and carousels are a hotspot

- **WebAIM Million 2026** (1,000,000 home pages, February 2026 data):
  - 95.9% had detected WCAG failures, averaging 56.1 errors per page.
  - The top failures:
    - low-contrast text: 83.9% of pages
    - missing alt text: 53.1%
    - missing form labels: 51%
    - empty links: 46.3%
    - empty buttons: 30.6%
  - Of all images, 16.2% had no alt text and 10.8% had questionable alt text.
  - 18.1% of pages had more than one `<h1>`, and 41.8% skipped heading levels.
  - Shopping sites averaged 71.0 errors (+26.6%). Next.js sites averaged 40.9.
- **W3C, Understanding SC 2.2.2 (Pause, Stop, Hide).** Moving content that starts automatically, lasts more than 5 seconds and is shown alongside other content must offer a way to pause, stop or hide it. Hover-only pausing does not serve keyboard or touch users. Best practice is a single control that pauses all motion.
- **Baymard, *10 UX Requirements for Homepage Carousels*** (updated 3 April 2025):
  - 46% of carousels have UX issues; 33% of sites use one.
  - Requirements:
    - choose the first slide carefully
    - never make slides the only path to content
    - prominent controls
    - auto-rotate every 5–7 s (up to 10 s for text-heavy slides)
    - pause on hover
    - **stop permanently after the user interacts**
    - **no auto-rotation on mobile**
    - support swipe
    - slide text should be real HTML text, not baked into the image
    - load fast
- **NN/g banner blindness** (Nielsen, 2007). Users tend not to look at things that look like ads. A banner that looks like an ad is a wasted banner.

### 2.3 Editor usability: how tools help or hurt the people using them

- **NN/g, *10 Usability Heuristics Applied to Complex Applications*** (Kaplan, 2021):
  - show system status, with progress indicators for waits over 10 s
  - give user control, such as restoring versions
  - prevent errors, for example with live preview
  - help users recover from errors
  - offer inline help
- **NN/g, *Response Times: The 3 Important Limits*** (Nielsen, 1993, updated 2014):
  - 0.1 s feels instant.
  - 1 s keeps flow.
  - Over 10 s needs a percent-done indicator and a way to cancel.

  R44's upload progress bars follow this.
- **Cognitive load theory** (Sweller, 1988, *Cognitive Science* 12:257–285). Working memory is limited. Tools that make editors remember rules (character limits, legal wording, contrast ratios) cause errors. Tools that enforce them as you type reduce errors. This is the academic basis for Greenway's "guardrails in the tool" approach.
- **Workspace awareness** (Gutwin & Greenberg, 2002, *CSCW* 11:411–446). When several people work in a shared space, knowing who else is working and what they are changing prevents conflicts. A full real-time system isn't needed. "Someone else edited this 2 minutes ago" covers most of the benefit.
- **Evolving Web, *Content Editor UX*** (2025), on modern CMS practice:
  - curated components
  - smart defaults
  - granular roles
  - a strong media library
  - accessibility guardrails, such as fixed palettes and the Editoria11y checker
  - plain language
  - inline help
  - a fast admin

### 2.4 Experimentation: powerful, but only with enough traffic

- **Kohavi, Longbotham, Sommerfield & Henne (2009)**, "Controlled Experiments on the Web: Survey and Practical Guide," *Data Mining and Knowledge Discovery* 18(1):140–181. A/B tests are the gold standard for knowing whether a change helped. They need enough users to reach statistical power, and they have pitfalls such as peeking early, novelty effects and testing too many variants. At low traffic, small effects can't be detected.
- **Vercel Flags** (docs updated 15 July 2026) is available on **all plans**. It offers boolean, string, number and JSON flags, targeting, segments, percentage splits and A/B testing, with results through Vercel Web Analytics. Vercel's KB guide on e-commerce A/B testing recommends server-side or edge assignment, because client-side test tools can hurt LCP and CLS.
- **Chevalier & Mayzlin (2006)**, *Journal of Marketing Research* 43:345–354. Online reviews measurably move sales. This is relevant to any future "reviews/testimonials" block.

### 2.5 Security of uploads

The **OWASP File Upload Cheat Sheet** recommends:

- allowlist extensions
- never trust the browser-supplied Content-Type
- validate the file signature ("magic bytes")
- generate server-side file names
- enforce size limits and authorization
- scan for malware or apply content disarm and reconstruction
- re-encode images and strip metadata

### 2.6 Compliance: Washington cannabis advertising

**WAC 314-55-155** (current version effective 4 July 2026, WSR 26-12-082):

- (2)(a) bans ads that:
  - are false or misleading
  - promote overconsumption
  - make therapeutic or health claims
  - are especially appealing to persons under 21
- (2)(c) requires that ads state the content is for persons 21 and older.
- (2)(d) bars targeting persons outside Washington.
- (7) requires four health warnings, in type at least 10% of the largest type used.

Greenway already enforces the warning size (`LEGAL_TOO_SMALL` in the banner design core) and the footer wording (`src/lib/compliance/warning-text-core.ts`). The "21+", therapeutic-claim and youth-appeal rules are **not yet checked automatically**.

### 2.7 Enterprise CMS reference point: Sanity Content Releases

Sanity's Content Releases (docs):

- group many document changes into one named release
- let you preview the whole release as one site state
- schedule it for "as soon as possible", a specific time, or "undecided"
- lock the documents while scheduled
- reverting a release is an Enterprise add-on

Sanity also offers single-document Scheduled Drafts. This is the pattern recommended for Greenway's scheduled publishing.

### 2.8 Search and images

- **Google LocalBusiness structured data** (docs updated 8 Sept 2026):
  - Required: `name` and `address`.
  - Recommended: `geo` with at least 5 decimal places, `openingHoursSpecification`, `telephone`, `url` and `priceRange`.
  - **Seasonal or holiday hours** use `validFrom` and `validThrough`. "Closed all day" is opens and closes both `00:00`.
  - Use the most specific subtype available.
- **Supabase Image Transformations** (docs): Pro plan and up, switched on in Storage → Settings.
  - Automatic WebP; endpoint `/storage/v1/render/image/public/…`; a Next.js custom loader is supported.
  - Limits: width/height 1–2500 px, images ≤ 25 MB, ≤ 50 MP.
  - Pro includes 100 origin images, then $5 per 1,000.
- **Vercel Image Optimization** (pricing docs updated 11 Aug 2026):
  - transformations $0.05–$0.0812 per 1,000
  - cache reads $0.40–$0.64 per 1M
  - cache writes $4–$6.40 per 1M
  - formats JPEG, PNG, WebP and AVIF; Pro has Spend Management

---

## 3. Side-by-side: what Greenway has vs. what the evidence recommends

Legend: ✅ have it · 🟡 partial · ❌ missing. Every "Greenway today" cell comes from R44 recon.

| # | Capability | Greenway today | Research / enterprise benchmark | Gap |
|---|---|---|---|---|
| 1 | Draft vs. published | ✅ `draft_value`/`published_value`/`status` per block; publish-all, discard-all, pending count (`content-store.ts`) | Standard in Sanity, Contentful, Storyblok, WordPress | none |
| 2 | Revision history and restore | ✅ revisions with restore-to-draft | NN/g heuristic "user control & freedom" | none |
| 3 | Preview before publish | ✅ Next.js Draft Mode (`/api/admin/preview/enable`), green ✎ edit buttons (R43) | NN/g "error prevention: live preview" | none |
| 4 | **Scheduled publish / unpublish** | ❌ Blocks, banners and slides have no start or end times. Only blog posts have `publish_date` and a `'scheduled'` status (migration 0005). | Sanity Content Releases and Scheduled Drafts; standard in Contentful, Storyblok, WordPress | **large** |
| 5 | Grouped releases ("Black Friday" bundle) | 🟡 publish-all exists, but there are no named groups | Sanity Content Releases | medium |
| 6 | Roles and permissions | ✅ 6 roles; `content.edit` and `media.manage` for owner, admin, manager, content_editor (`roles.ts`) | Evolving Web "granular roles" | none |
| 7 | **Approval workflow** | 🟡 only menu publishing has approvals; content goes live without review | Enterprise CMS review states; WAC 314-55-155 makes a second pair of eyes valuable | medium |
| 8 | Edit-conflict protection | ❌ no optimistic locking found | Gutwin & Greenberg workspace awareness | small–medium (small team) |
| 9 | Autosave | 🟡 only purchasing and SEO editor; elsewhere `beforeunload` guards (SectionCard, ContentBlockEditor, AboutCoreValuesCard, CarouselSlideCard, FaqItemCard) | NN/g error recovery | medium |
| 10 | Undo/redo | 🟡 banner studio only | NN/g user control | small |
| 11 | **Carousel pause control (WCAG 2.2.2)** | 🟡 Home hero (`Hero.tsx`): 6 s autoplay, pauses on **mouse hover only**, no pause button, no focus pause, no reduced-motion check. Shop carousel (`ShopBannerCarousel.tsx`): 6.5 s, pauses on hover and focus, respects reduced-motion, no visible pause button. Video banners (R44): ✅ pause button. | W3C SC 2.2.2: a pause mechanism is required; one control for all motion is best practice | **large (compliance)** |
| 12 | **Carousel behaviour (Baymard)** | 🟡 5–7 s interval ✅; hover pause ✅; stop-after-interaction ❌; no-autoplay-on-mobile ❌; swipe ❌; HTML text ✅ (designed banners use real text boxes) | Baymard's 10 requirements | medium |
| 13 | Image formats and optimizer | 🟡 `next/image` with the default Vercel optimizer (`next.config.ts` remotePatterns for Supabase); no `formats` list (so no AVIF); no `blurDataURL` placeholders | web.dev, Vercel AVIF support, Supabase transforms | medium |
| 14 | LCP priority | 🟡 `priority`/`fetchPriority` appears in BannerMedia, BannerVideo, DesignedBanner, Header, Footer. A per-slide "first slide high, rest low" audit is not done. | web.dev Fetch Priority (2.6 s → 1.9 s) | small |
| 15 | Real-user speed monitoring | 🟡 `@vercel/speed-insights` is installed (layout) and collects data in Vercel's dashboard. It is not shown inside the Greenway admin. | web.dev: real-user monitoring is preferred | small |
| 16 | Content/CTA click analytics | 🟡 GA4 loads only if `NEXT_PUBLIC_GA_ID` is set (`Analytics.tsx`). Only page-view config was found; no banner or CTA events. | Kohavi: measure before you decide | medium |
| 17 | A/B testing | ❌ none | Vercel Flags (all plans), Kohavi caveats | medium (traffic-limited) |
| 18 | **Publish-time accessibility checks** | 🟡 banner contrast check and legal size warning ✅; alt-text quality, heading order and single h1 are not checked | WebAIM top failures; Editoria11y | medium |
| 19 | **WAC 314-55-155 text linting** | 🟡 warning size and footer wording ✅; "21+", therapeutic-claim and youth-appeal checks ❌ | WAC 314-55-155(2)(a), (2)(c) | medium |
| 20 | Upload security | 🟡 R44: MIME/extension allowlist, size caps, server-side names, post-upload size verification, audit log. Magic-byte check ❌, EXIF stripping ❌, malware scan ❌. | OWASP File Upload Cheat Sheet | medium |
| 21 | Video | ✅ R44: MP4 ≤ 200 MB, auto poster frame, muted, loop, playsinline, reduced-motion, Save-Data, offscreen pause, WCAG pause button. Transcoding to smaller sizes ❌; captions ❌ (decorative banners usually don't need them). | WCAG 1.2.x for videos with speech | small |
| 22 | Media "where used" and orphan cleanup | ❌ not found | Evolving Web "strong media library" | medium |
| 23 | Link checker | ❌ not found | WebAIM "empty links" 46.3% | small |
| 24 | Structured data (LocalBusiness) | ✅ `storeSchema()` emits `["Store","LocalBusiness"]` with address, geo (7 dp), hours, phone (`seo.ts`). Holiday hours (`validFrom`/`validThrough`) are not editable in the admin. | Google LocalBusiness docs | small |
| 25 | Automated tests in CI | 🟡 core self-tests ✅; Playwright exists (`e2e/smoke.spec.ts`, 97 lines) but is **not in CI** (only `compliance-tests.yml`); no axe accessibility scan | Industry practice; WebAIM | medium |
| 26 | Inline help and onboarding | 🟡 helper text in many editors; no guided tours or "why is this blocked" links to the WAC | NN/g "help and documentation" | small |
| 27 | Large uploads and resumable | ✅ R44: TUS 6 MB chunks, 200 MB video, 50 MB image | Supabase docs | none |

---

## 4. Deep dives on the top five

### 4.1 Carousel accessibility and behaviour: **Build now**

**What's wrong today (verified):**

- `src/components/home/Hero.tsx`: `AUTOPLAY_MS = 6000`. Its `setInterval` pauses only on `onMouseEnter` and resumes on `onMouseLeave`. The buttons are "Previous slide", "Next slide" and "Go to slide N". There is no pause/play control, no focus pause and no `prefers-reduced-motion` check.
- `src/components/menu/ShopBannerCarousel.tsx`: `SHOP_CAROUSEL_AUTOPLAY_MS = 6500` (`shop-carousel-core.ts`). It pauses on hover and focus and turns off for reduced-motion. There is no visible pause control.

**Why it matters:**

- W3C SC 2.2.2 (§2.2). Keyboard users can tab into the home carousel, but it keeps moving. Phone users can't hover at all.
- Baymard: auto-rotation on mobile and rotation that continues after interaction both hurt users.

**Build:**

- one shared `useCarouselAutoplay` hook in a `*-core.ts`, with self-tests
- a visible ⏸/▶ button on every auto-rotating carousel, linked to the R44 video pause so one control pauses everything
- pause on focus
- respect reduced-motion
- stop for good after any manual navigation
- no autoplay below the `md` breakpoint (a setting, default off on mobile)
- swipe support (pointer events)
- `fetchpriority="high"` on slide 1 only and `low` on the others (web.dev)

| Difficulty | Risk | Customer value | Business value | Running cost |
|---|---|---|---|---|
| S (½ round) | Low (presentation only) | High | High: legal-risk reduction (ADA/WCAG) plus Baymard UX | $0 |

### 4.2 Scheduled publishing and Releases: **Build next**

**Today:** Publishing is immediate. Blog posts are the only content type with a date.

**Design** (modelled on Sanity Content Releases, §2.7):

- **Data.** A new `content_schedule` table, with an idempotent migration: `id`, `target_kind` (block, carousel_slide, shop_banner, …), `target_key`, `action` (publish | unpublish), `run_at timestamptz`, `release_id` (optional group), `created_by`, `status` (pending, done, failed, cancelled), `error`.
- **Engine.** A new Vercel cron, for example every 5 minutes. It joins the existing six in `vercel.json`. It calls a protected route that runs due rows in a transaction, writes revisions and audit entries, and revalidates the affected pages.
- **UI.** A "Schedule…" button beside Publish:
  - a date/time picker in Pacific time
  - optional "take down at…"
  - a "Scheduled" badge
  - a calendar list of upcoming changes
  - preview of "the site as it will look at time T"
- **Safety.**
  - Lock scheduled blocks against edits, or warn, as Sanity does.
  - A failed run alerts the owner.
  - Every run is idempotent.

**Value:** 4/20, holiday hours, daily deals and new-product drops go live on time without someone at a keyboard at midnight.

| Difficulty | Risk | Customer value | Business value | Running cost |
|---|---|---|---|---|
| M–L (1–1½ rounds) | Low–Med (time zones, cache revalidation; mitigated by self-tests) | High: fresh, accurate promos | High: saves staff time and stops expired deals showing | $0 extra; cron jobs are part of Vercel Pro (exact cron limits were not re-verified this round) |

### 4.3 Image speed: **Build next**

**Today:**

- default Vercel optimizer
- no `images.formats`, so no AVIF
- no blur placeholders
- R44 videos already have posters

**Build:**

1. Add `images.formats: ['image/avif','image/webp']`. Vercel supports AVIF. AVIF files are generally smaller, but they cost more transformations. **Pro Spend Management can cap this.**
2. Generate a tiny blur placeholder at upload time and store it with the media row. Then render `placeholder="blur"`, so the banner never pops in from blank.
3. Run a `fetchpriority` audit per renderer (§4.1).
4. **Optional:** a Supabase Image Transformations loader. Supabase charges **$5 per 1,000 origin images after the first 100**. Vercel bills per transformation and cache read or write. Which is cheaper depends on traffic. Recommendation: stay on Vercel's optimizer and turn on Spend Management. Revisit only if the bill shows image costs rising.

| Difficulty | Risk | Customer value | Business value | Running cost |
|---|---|---|---|---|
| S–M | Low | High (LCP) | High (Deloitte/Google: +8.4% conversions per 0.1 s) | Small; set a Vercel spend cap |

### 4.4 Publish-time quality and compliance checks: **Build next**

**Build a pure `content-lint-core.ts` with self-tests,** run when someone presses Publish and shown as a checklist. Each item has a severity: **block** (legal) or **warn**. A manager can override a warning with a typed reason, which is recorded in the audit log.

- **Accessibility** (from WebAIM's top failures):
  - alt text missing, or useless ("image", "banner", the file name, over 150 characters)
  - contrast below 4.5:1 (reuses the banner core)
  - empty link or button text
  - more than one H1 on a page
  - skipped heading levels
- **WAC 314-55-155:**
  - (2)(c) ad lacks "21+"/"21 and older" text: **block**
  - (2)(a) therapeutic or health words ("cure", "treat", "anxiety", "pain relief", "medical"…): warn, with a link to the WAC
  - (2)(a) youth-appeal words ("candy", cartoon names…): warn
  - (7) warning size: already done ✅

  The word lists are owner-editable. **They are not legal advice.** The tool only highlights; staff make the call.
- **Links:** internal links that 404 and dead external links. The external check is a cron job, so publishing isn't slowed.

| Difficulty | Risk | Customer value | Business value | Running cost |
|---|---|---|---|---|
| M (1 round) | Low (warnings are advisory except "21+") | Med–High | High: lowers WSLCB and ADA risk | $0 |

### 4.5 Measuring what works: **Build next (analytics); Build later (A/B)**

**Step 1: click analytics.** Add `data-gw-cta` attributes and a tiny tracker. It sends GA4 events (`select_promotion` is a GA4-recommended e-commerce event; the exact event naming should be checked against current GA4 docs before the build) and respects `NoTrackGate`. Then show "Top banners by clicks, last 30 days" in the admin. Cost is $0 because GA4 is already wired in.

**Step 2: show speed in the admin.** Speed Insights data already exists in the Vercel dashboard. Add a link and a short explainer card. Pulling it into the admin via the API is optional; API availability was not verified this round.

**Step 3: A/B tests (later).** Use Vercel Flags, which is on all plans, with server-side assignment so CLS isn't hurt.

- **Kohavi's caveat:** at single-store traffic, only *large* differences will show up.
- **Recommendation:** run at most one test at a time, on the home hero. Fix the sample size in advance, and don't peek.

| Step | Difficulty | Risk | Value | Running cost |
|---|---|---|---|---|
| Click analytics | S–M | Low | High (you learn what sells) | $0 |

**Step 1b: a "Website" tab on Reports (owner request, R46 round).** The
owner asked (verbatim): "if we are going to be tracking customer clicks on
the website, we should add a tab to the reports page that highlights all the
stats we are now tracking." Design:

- **Own the numbers.** Clicks are recorded first-party in our own Supabase
  table, as well as in GA4. GA4 reports need a Google login, run behind on
  processing, and the Data API has per-property token quotas (Google
  "Data API limits and quotas"). Our table answers instantly, covers every
  slide and button by name, and keeps working if GA is not set up.
- **Privacy.** No cookies and no IP addresses are stored. A row is: when,
  which page, which banner or slide, which button, the target link, and
  phone or desktop. `NoTrackGate` and Global Privacy Control are honoured.
- **Reports > Website tab, last 7/30/90 days:**
  - total banner and button clicks;
  - top slides and top buttons;
  - clicks by page;
  - phone vs desktop split;
  - a daily trend;
  - "dead" banners (shown but never clicked);
  - which scheduled or released changes went live in the period, from
    R46's history.
- **GA4.** The same click also sends GA4's recommended `select_promotion`
  event, with `creative_name`, `creative_slot`, `promotion_id` and
  `promotion_name` (verified against the GA4 "Recommended events"
  reference), so GA4's Promotions report works too.
- **Later.** Vercel Speed Insights already exists, so the tab links to it
  with a plain-English card.

| Step | Difficulty | Risk | Value | Running cost |
|---|---|---|---|---|
| Reports > Website tab | S–M | Low | High (one place for every site stat) | $0 (one small table) |

| Speed card | S | Low | Med | $0 |
| A/B testing | M | Med (stats misuse) | Med now, High as traffic grows | Vercel Flags request pricing; see Vercel docs "Limits and Pricing" (not quoted here; check before building) |

---

## 5. Hardening items

| Item | What and why | Difficulty | Risk | Verdict |
|---|---|---|---|---|
| Magic-byte check on upload | After the upload finishes, read the first bytes server-side and confirm they match JPEG, PNG, GIF, WebP, MP4 or PDF signatures; reject otherwise (OWASP) | S | Low | **Build next** |
| Strip EXIF/GPS from photos | Phone photos can carry GPS coordinates. Re-encode on upload, or rely on the optimizer (which removes metadata on its output only, not on the original) (OWASP "re-encode") | M | Low | Build later |
| Malware scan | OWASP recommends it. Uploaders are authenticated staff only, so the risk is lower. A third-party service would add cost and complexity. | M | Med | Skip for now |
| Optimistic locking | Store `updated_at` with each edit and refuse a save if it changed since the page loaded ("Someone else saved this 2 min ago. Reload?") (Gutwin & Greenberg) | S–M | Low | **Build next** |
| Autosave drafts | Debounced draft save on block editors, with a "Saved ✓" status (NN/g) | M | Low–Med (more writes; drafts are not live, so safe) | Build later |
| Approval workflow | Content editor → "Submit for review"; manager or owner approves → publish (with scheduling). Useful because of WAC exposure. | M | Low | Build later (now if non-owner staff will edit ads) |
| Playwright and axe in CI | Run `e2e/smoke.spec.ts` plus `@axe-core/playwright` on key pages in GitHub Actions | M | Low (CI only) | **Build next** |
| Media where-used | Index which blocks reference each media URL; warn before deleting a media item that's in use; list unused files | M | Low | Build later |
| Video transcoding | Make a smaller mobile rendition of each MP4. Needs an external service (not priced this round). | L | Med | Skip for now; use the R44 size guidance |
| Holiday hours editor | Edit `validFrom`/`validThrough` special hours in the admin, which feed `storeSchema()` (Google LocalBusiness docs) | S–M | Low | Build later |
| Inline help | "Why was this blocked?" links to the exact WAC section; short first-use tips | S | Low | Build later |

---

## 6. Master ranked list

Ranked by (customer value + business value) ÷ (difficulty × risk).

| Rank | Item | Diff. | Risk | Verdict |
|---|---|---|---|---|
| 1 | Carousel pause/stop/mobile/swipe and fetchpriority (§4.1) | S | Low | **Build now** |
| 2 | Scheduled publish/unpublish and Releases (§4.2) | M–L | Low–Med | **Build next** |
| 3 | Publish-time quality and WAC lint (§4.4) | M | Low | **Build next** |
| 4 | Image speed: AVIF, blur placeholders, spend cap (§4.3) | S–M | Low | **Build next** |
| 5 | CTA/banner click analytics plus the Reports > Website tab (§4.5, owner request) | S–M | Low | **Build next** |
| 6 | Magic-byte upload check (§5) | S | Low | **Build next** |
| 7 | Optimistic locking (§5) | S–M | Low | **Build next** |
| 8 | Playwright and axe in CI (§5) | M | Low | **Build next** |
| 9 | Approval workflow | M | Low | Build later |
| 10 | Autosave everywhere | M | Low–Med | Build later |
| 11 | Media where-used and orphan cleanup | M | Low | Build later |
| 12 | Holiday-hours editor → LocalBusiness schema | S–M | Low | Build later |
| 13 | Link checker cron | S | Low | Build later (or fold into #3) |
| 14 | EXIF/GPS stripping | M | Low | Build later |
| 15 | Inline help and WAC links | S | Low | Build later |
| 16 | A/B testing with Vercel Flags | M | Med | Build later |
| 17 | Video transcoding | L | Med | Skip for now |
| 18 | Malware scanning | M | Med | Skip for now |
| 19 | Real-time co-editing | L | High | Skip |
| 20 | Visitor personalisation | L | High (legal/privacy) | Skip |
| 21 | Move to a hosted headless CMS | L | High | Skip |

---

## 7. Suggested build sequence

| Round | Contents | Why this order |
|---|---|---|
| **R45** | #1 carousel accessibility, #6 magic-byte check, #4 AVIF and blur placeholders, #7 optimistic locking | All small and low-risk; immediate customer-visible gains and legal-risk reduction |
| **R46** | #2 scheduled publishing and Releases (migration, cron, UI) | The biggest workflow win; needs a full round |
| **R47** | #3 publish-time lint (accessibility, WAC, links), #5 click analytics **plus the Reports > Website tab** (owner request) | The guardrails and measurement layer |
| **R48** | #8 Playwright and axe in CI, #9 approvals, #12 holiday hours | Hardening and process |
| Later | #10, #11, #14, #15, #16 as needs arise | |

---

## 8. Costs at a glance

| Item | Extra money | Source |
|---|---|---|
| Carousel, lint, scheduling, locking, analytics, CI | $0 (our code; existing Vercel, Supabase and GA4) | recon |
| AVIF via Vercel optimizer | Per-transformation pricing $0.05–$0.0812 per 1K, plus cache costs. Cap it with Pro Spend Management. | Vercel Image Optimization pricing |
| Supabase image transforms (optional) | First 100 origin images included, then $5 per 1,000 | Supabase Image Transformations docs |
| Vercel Flags (A/B) | Request-based; see Vercel "Limits and Pricing" before building | Vercel Flags docs |
| Larger storage from video | Supabase Pro storage overage applies; not re-quoted this round | (not verified; check the Supabase usage page) |

---

## 9. Sources

**Peer-reviewed and academic**

1. Kohavi, R., Longbotham, R., Sommerfield, D., & Henne, R. M. (2009). Controlled experiments on the web: survey and practical guide. *Data Mining and Knowledge Discovery*, 18(1), 140–181. https://doi.org/10.1007/s10618-008-0114-1
2. Gutwin, C., & Greenberg, S. (2002). A descriptive framework of workspace awareness for real-time groupware. *Computer Supported Cooperative Work*, 11, 411–446. https://doi.org/10.1023/A:1021271517844
3. Sweller, J. (1988). Cognitive load during problem solving: Effects on learning. *Cognitive Science*, 12(2), 257–285. https://doi.org/10.1207/s15516709cog1202_4
4. Lindgaard, G., Fernandes, G., Dudek, C., & Brown, J. (2006). Attention web designers: You have 50 milliseconds to make a good first impression! *Behaviour & Information Technology*, 25(2), 115–126. https://doi.org/10.1080/01449290500330448
5. Lavie, T., & Tractinsky, N. (2004). Assessing dimensions of perceived visual aesthetics of web sites. *International Journal of Human-Computer Studies*, 60(3), 269–298. https://doi.org/10.1016/j.ijhcs.2003.09.002
6. Chevalier, J. A., & Mayzlin, D. (2006). The effect of word of mouth on sales: Online book reviews. *Journal of Marketing Research*, 43(3), 345–354. https://doi.org/10.1509/jmkr.43.3.345

**Standards, law and research organisations**

7. W3C. Understanding Success Criterion 2.2.2: Pause, Stop, Hide. https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html
8. WebAIM. The WebAIM Million (2026). https://webaim.org/projects/million/
9. Baymard Institute. 10 UX Requirements for Homepage Carousels (updated 3 April 2025). https://baymard.com/research-articles/homepage-carousel
10. Washington State Legislature. WAC 314-55-155, Advertising requirements. https://apps.leg.wa.gov/wac/default.aspx?cite=314-55-155
11. OWASP. File Upload Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
12. Nielsen, J. (1993/2014). Response Times: The 3 Important Limits. NN/g. https://www.nngroup.com/articles/response-times-3-important-limits/
13. Kaplan, K. (2021). 10 Usability Heuristics Applied to Complex Applications. NN/g. https://www.nngroup.com/articles/usability-heuristics-complex-applications/
14. Nielsen, J. (2007). Banner Blindness: The Original Eyetracking Research. NN/g. https://www.nngroup.com/articles/banner-blindness-original-eyetracking/

**Performance and search**

15. web.dev. Web Vitals. https://web.dev/articles/vitals
16. Osmani, A., Sohoni, L., Meenan, P., & Pollard, B. Optimize resource loading with the Fetch Priority API. web.dev. https://web.dev/articles/fetch-priority
17. Machina (n.d.). The business case for website speed (summarising Deloitte/Google 2020, Vodafone, Rakuten 24, Akamai 2017, Portent 2022, Web Almanac 2025). https://wearemachina.com/insights/business-case-for-website-speed
18. Google Search Central. Local business (LocalBusiness) structured data (updated 8 Sept 2026). https://developers.google.com/search/docs/appearance/structured-data/local-business

**Vendor documentation**

19. Sanity. Content Releases. https://www.sanity.io/docs/user-guides/content-releases (and Scheduled Drafts: https://www.sanity.io/blog/scheduled-drafts)
20. Supabase. Storage Image Transformations. https://supabase.com/docs/guides/storage/serving/image-transformations
21. Vercel. Image Optimization limits and pricing (updated 11 Aug 2026). https://vercel.com/docs/image-optimization/limits-and-pricing
22. Vercel. Vercel Flags (updated 15 July 2026). https://vercel.com/docs/flags/vercel-flags
23. Evolving Web (2025). Content Editor UX. https://evolvingweb.com/blog/content-editor-ux-why-cms-usability-tough

*Items marked "not verified" in this document were deliberately left unquoted rather than guessed.*
