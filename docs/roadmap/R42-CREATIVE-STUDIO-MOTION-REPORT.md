# R42 — Creative Studio "Motion" upgrade (GPT-4o → FLUX → Runway): research & recommendation

Prepared 2026-10-11. Every fact below was read from the source cited next to it, either the repo code or the vendor's live documentation on that date. Anything that is my professional estimate rather than a published fact is labelled **(estimate)**. Anything I could not verify is labelled **(unverified)**, together with how to verify it.

---

## 1. The short answer

**Do not build the full Runway integration yet.** Run a cheap pilot first (about $10–$30 and roughly an hour of your time; no code). Then build in two separate, reversible stages, and only as far as the pilot justifies:

1. **Pilot (no code).** Generate 10–20 test clips of the exact subjects you want (melting dab, flowing rosin, joint being rolled, smoke) in Runway's own web app or API playground. The pilot answers the three questions nobody can answer from documentation:
   - Does Runway's moderation let these cannabis subjects through?
   - Is the quality good enough?
   - How big are the files?
2. **Stage A, "Motion-ready website" (build only if the pilot passes).** Teach the media library and every banner to show a short looping video, safely: poster image first, pause button, reduced-motion respect and phone-friendly loading. This is needed whatever tool makes the video, so it is never wasted work.
3. **Stage B, "Animate in the Creative Studio" (build only if you'll use it regularly).** Add an "Animate this image" button next to each FLUX result: GPT-4o writes a compliant motion prompt, Runway animates the FLUX still, and the clip lands in the media library as a draft.

Why this order: the website will rarely be edited. The integration's main benefit is saving the few minutes it takes to download a clip from Runway's app and upload it to the media library, and with rare use that saving is small. Its main risk (Runway moderation and possible account suspension on cannabis subjects) is unknown and can only be measured by trying. A $10–$30 pilot removes the biggest unknown before any engineering money is spent.

---

## 2. What exists today (recon of the repo)

| Piece | Where | What it does |
|---|---|---|
| Creative Studio page | `/admin/marketing/midjourney` (`page.tsx`, `actions.ts`, `MidjourneyBuilder.tsx`) | Two tabs. FLUX (default) generates at the exact placement size; the Midjourney tab builds a copy-paste prompt. |
| AI "creative director" | `src/lib/marketing/creative-ai.ts` | GPT-4o family drafts a structured brief: subject, environment, composition, lighting, style, colour mood, exclusions, rationale. It is grounded in real store data and live promotions, and every suggestion is scanned by `checkCompliance`. |
| Model routing | `src/lib/ai/router.ts` | Light tasks use `gpt-4o-mini`; heavy tasks use `gpt-4o` (sprint mode). A monthly budget cap applies. |
| FLUX pipeline | `src/lib/marketing/flux-client.ts` + `flux-core.ts` | Submits to Black Forest Labs, polls every 1.5 s for up to 2 min, downloads the result and saves it to the media library as a **draft**. It handles the "busy", "out of credits", moderation and timeout cases. |
| Placements registry | `creative-placements-core.ts` | Exact sizes per destination. Examples: website banner 1600×560, social square 1080×1080, story 1080×1920, in-store display 1920×1080, window banner 2560×1280. |
| Media library | `src/lib/media/store.ts`, `src/app/admin/media/actions.ts` | Public Supabase bucket `media`. Uploads are **limited to PNG, JPG, WEBP, GIF, SVG and PDF, at 10 MB or less**. **No video types are accepted today.** |
| Website banners | `DesignedBanner.tsx`, `SectionBanner`, Specials, Shop and Loyalty heroes | All are `next/image` pictures. **No component on the public site renders `<video>`** (repo-wide search: the only `<video>` is the staff barcode scanner). |
| Server limits | `next.config` (`bodySizeLimit: 50mb`), `vercel.json` | Long-running pages already use `maxDuration = 300`. Server-action files cannot export it: it must live on the page (lesson L-25 in `leafly-actions.ts`). |

The current pipeline is therefore one step short of "GPT-4o → FLUX → Runway", and the **website side cannot display motion at all**. Both halves would need work.

---

## 3. Runway: verified facts

Sources: docs.dev.runwayml.com (pricing, models, API reference, inputs, outputs, usage tiers, moderation), runway.com/pricing, runway.com/terms-of-use (last updated September 15, 2026) and runway.com/safety/usage-policy (last updated March 6, 2026).

### 3.1 How it works

- **Image-to-video is supported.** `POST /v1/image_to_video` with `promptImage` (used as the **first frame**), `promptText` (up to 1,000 characters for Gen-4.5 / Gen-4 Turbo), `ratio` and `duration`.
- **Durations and shapes.** Gen-4.5 and Gen-4 Turbo take a whole number of seconds from **2 to 10**. Ratios are 1280:720, 720:1280, 1104:832, 832:1104, 960:960 and 1584:672.
- **It is asynchronous.** You get a task id and poll `GET /v1/tasks/{id}` until the status is SUCCEEDED or FAILED. Statuses include PENDING, THROTTLED and RUNNING. This is the same pattern our FLUX client already uses.
- **The output is an MP4 link that expires in 24–48 hours.** Runway says to download it to your own storage and never show its links directly. Our FLUX pipeline already does exactly this for images.
- **Inputs.** JPEG, PNG or WebP by HTTPS URL (up to 16 MB). The server must answer HEAD requests with a correct Content-Type, and redirects are not followed. Alternatively, a base64 data URI (up to 5 MB encoded, about 3.3 MB of real file). **GIF input is not supported.**
- **Fit with FLUX.** FLUX saves PNG/JPEG/WebP files into Supabase, so the pieces fit. **(Unverified:** whether Supabase's public URLs answer HEAD the way Runway requires. **Fallback:** send the image as a data URI, which avoids the question entirely.)
- **SDK.** An official Node SDK (`@runwayml/sdk`) exists. We would call the REST API directly, matching the FLUX client's style, so there is no new dependency.

### 3.2 Prices (Runway Dev API, $0.01 per credit)

| Model | Rate | 5-second clip | 10-second clip |
|---|---|---|---|
| Gen-4 Turbo | 5 credits/s | **$0.25** | $0.50 |
| Gen-4.5 (newest Runway model) | 12 credits/s | **$0.60** | $1.20 |
| Veo 3.1 Fast (no audio), also sold through Runway | 10 credits/s | $0.50 (it only offers 4, 6 or 8 s) | — |

- **Moderated generations are charged in full** (moderation docs). A blocked attempt costs the same as a successful one.
- **Limits that matter.** Tier 1 allows 1–2 videos at once and 50–200 generations per day depending on the model, with a $100/month spending ceiling. Buying $50 of credits moves you to Tier 2 automatically. Either tier is far more than a rarely edited site needs.
- **Web-app alternative (no integration).** Standard is $12/month billed yearly ($15 monthly) for 625 credits, which Runway says is about 104 s of Gen-4 Turbo or 52 s of Gen-4.5. Pro is $28/month yearly ($35 monthly) for 2,250 credits. Monthly credits don't roll over on these plans; credits you buy separately never expire.

### 3.3 Terms that affect us

- **You own your outputs, and commercial use is allowed.** The Terms say "the Company does not restrict your commercial use of your Outputs" (subject to compliance).
- **Training.** Your inputs and outputs **may be used to train Runway's models**. That's fine for marketing art; just never upload anything confidential.
- **API attribution.** Apps built on the API must "prominently display 'Powered by Runway' and link to runway.com on applicable user interfaces". The Creative Studio is a staff-only screen, and the public website only shows finished clips. I would show the "Powered by Runway" line inside the Studio's Animate tab, which costs nothing and fully satisfies the clause. **(Unverified:** whether Runway considers the public site an "applicable" interface; ask Runway support if you want certainty.)
- **Content rules.** The Usage Policy (March 6, 2026) does **not** list drugs or cannabis as a banned category. Its bans are child safety, violence/gore, sexual content, hate/harassment/self-harm, rights violations and deception. The Terms of Use, however, say content may not contain "dangerous … illegal … subject matter … as determined by Company in its sole discretion". Cannabis is legal in Washington but federally controlled, so this is a judgement call that Runway makes, not us.
- **Moderation cannot be switched off or allow-listed.** Runway's help centre says it is "unable to allowlist specific accounts or subject matters". The API docs add: "If your account makes too many requests that get moderated, we will suspend your account."

**This is the single biggest risk in the whole project, and only a pilot can measure it.** If "smoke rising from a joint" is blocked 3 times out of 4, the feature is commercially dead no matter how well it is built. Prompts framed as product cinematography (e.g. "macro of amber rosin slowly flowing on parchment", "wisps of soft vapor") may pass where "person smoking a joint" does not. **(Unverified until the pilot.)**

---

## 4. GIFs vs video (what the website should actually use)

- **GIF is the wrong format for a website.**
  - web.dev's measured example: the same animation was **3.7 MB as a GIF vs 551 KB as MP4 vs 341 KB as WebM**, so the GIF was about 6.7× larger than MP4.
  - Google's guidance is to replace animated GIFs with `<video autoplay loop muted playsinline>`.
  - Lighthouse flags GIFs ("Use video formats for animated content").
- **Runway outputs MP4 anyway.** Making a GIF would be an extra conversion step that produces a worse, bigger file.
- **Next.js doesn't optimise GIFs.** Its docs say animated images are served as-is (no resizing or format conversion), so a GIF banner would ship its full size to every phone.
- **Where GIFs still make sense: email.** Most email clients don't play video. If you want motion in newsletters, a small GIF exported from the MP4 is the standard approach. That needs a video-conversion tool (ffmpeg) on the server. **(Unverified:** whether an ffmpeg binary fits within Vercel's function size limits; I would test before promising it.) I've kept this optional and last.
- **Social platforms accept MP4 natively**, so no GIF is needed there.

**Website requirements for motion done properly:**

- **Reduced motion.** Honour the `prefers-reduced-motion` setting (web.dev; supported by all modern browsers). People who turn off motion see the still poster instead.
- **Pause control.** WCAG 2.2 success criterion 2.2.2 (Pause, Stop, Hide) requires a way to pause any motion that starts automatically, lasts more than 5 seconds and sits alongside other content. A looping clip lasts more than 5 seconds, so every motion banner needs a visible pause button.
- **Poster first.** The FLUX still the clip was made from is literally its first frame, so it doubles as a perfect poster. It shows instantly, works as the fallback, and is what search engines and LCP measurements see.
- **Bandwidth.** Video bytes come straight from Supabase (Next.js doesn't re-encode video).
  - Supabase egress: Free plan 5 GB; Pro plan 250 GB included, then $0.09/GB uncached or $0.03/GB cached (Supabase docs).
  - Example **(estimate):** a 2.5 MB clip shown 10,000 times a month is about 24 GB, which is free on Pro.
  - **(Unverified:** which Supabase plan Greenway is on; check Supabase → Billing.)
  - Mitigation built into the design: the video loads only when the banner is on screen, and never on reduced-motion or data-saver devices.
- **Upload limits.** The media library needs to accept `video/mp4` (and optionally `video/webm`). Our 10 MB cap fits short clips **(estimate:** a 5–10 s 720p clip is typically a few MB; the pilot measures real sizes). Supabase Free allows files up to 50 MB.
- **Shape.** Runway's widest ratio is 1584:672 (about 2.36:1), while our desktop banner is 1600×560 (about 2.86:1). The banner crops to fill, as pictures already do, so roughly 9 % of the height is trimmed top and bottom. The existing focal-point control would steer that crop. Phone banners can use a separate 720:1280 or 960:960 clip, using the same phone-picture idea built in R42 Q4.

---

## 5. Washington compliance for animated ads (WAC 314-55-155, verified on app.leg.wa.gov)

Motion doesn't change the rules, but your example subjects sit close to several of them.

| Rule | Text (verbatim excerpt) | What it means for motion |
|---|---|---|
| (2)(a)(ii) | must not contain any statement, or illustration that "Promotes over consumption" | Avoid giant clouds, stacks of dabs, "massive hit" moments. Keep it slow, elegant and product-focused. |
| (2)(a)(iv) | "Portrays tobacco or nicotine or its use" | A rolled joint must not look like a tobacco cigarette, and no tobacco packaging should appear. |
| (2)(a)(v) | "any association with a motor vehicle or operation of a motor vehicle" | No cars in scenes. |
| (2)(a)(vii) | "curative or therapeutic effects" | No "relief" or "healing" framing in motion prompts. |
| (2)(a)(viii)(A)/(B) | no "cartoon characters …", nothing "especially appealing to children or other persons under 21" | No cartoonish or candy styles. Runway's own policy is stricter still on anything depicting minors. |
| (2)(c) | advertising must state that products are only for persons 21+ | Already covered on the website by the footer ("For use only by adults 21 and older"). Social and email clips must carry their own "21+". |
| (3) + (3)(a)(iv)(B) | outdoor signs may not depict a cannabis product, and a depiction includes "an image that indicates the presence of a product, such as smoke" | **Smoke, dab or rosin clips must never play on screens or signs that count as outdoor advertising**, such as a TV facing out of a window (signs "hanging in the window" fall under (3)(a)). The `print-instore-display` and `print-window-banner` placements would be blocked from motion in the build. |
| (7) | the four warnings at 10 % of the largest type | On the age-gated website your enforcement officer says the footer covers this (R42 Q1). Off-site uses (social, email) would need the warnings in the creative itself. |

**What I would build:**

- The Studio's motion-prompt writer and its compliance scan would gain a cannabis-motion pattern set (over-consumption, tobacco look-alike, vehicles, youth appeal, therapeutic claims).
- Every clip stays a **draft** until a person approves it, exactly like FLUX images today.

This is a guardrail, not legal advice; your enforcement officer remains the authority.

---

## 6. What it would take to build

Effort is in the same "slice" units as R41 (one slice ≈ one focused, fully tested PR). The calendar time is mine to build; testing is yours. **(Estimate.)**

### Stage A — Motion-ready website (needed for ANY animated content)

- **Media library:** accept MP4/WebM, check the file's real type from its bytes (not just its name), and show a video thumbnail and preview.
- **New `motion` option on banner designs** (video address + poster + loop, appended only when set so existing banners stay byte-identical). It renders as a muted, inline, looping video over the poster, which loads only when on screen, includes a pause button, and swaps to the poster for reduced motion. It also supports a separate phone clip, as in R42 Q4.
- **Banner Studio:** a "Motion" option in the Picture tab with a live preview. The existing focal point applies to the video.
- **Checks:** motion is refused on outdoor/window placements; a warning appears for clips over 10 MB.
- **Tests, self-tests and the bible.**

**Size:** about 3 slices, medium difficulty. The risk is the number of banner types touched; the R41 byte-identical rule contains it. No new monthly cost. Migration: probably none (the design is stored as JSON already). **(Estimate.)**

### Stage B — "Animate" in the Creative Studio

- **Runway key.** Store it in Settings → Integrations using the same encrypted-credential pattern as FLUX, with a "configured?" check and cost display.
- **Pure core** (`runway-core.ts`, fully unit-tested): request building per model, ratio choice per placement, duration limits, status parsing, and refusal reasons.
- **Background job** (migration 0265: a `creative_motion_jobs` table). A 5–10 s video can take minutes, so the Studio submits the job, then checks it every few seconds from the screen. No single server call runs long, which avoids the Vercel time-limit trap recorded in L-25.
- **On success:** download the MP4 immediately (links expire), save it as a **draft** video with the FLUX still as its poster, and link the two in the library.
- **GPT-4o "motion director":** turns the brief into a short, camera-and-motion prompt within Runway's 1,000-character limit, steered toward product cinematography that is less likely to be moderated. It runs through the compliance scan.
- **Safety and money guards:** a monthly spend cap in the app, plus a "moderation strike" counter that pauses the feature after repeated blocks so the Runway account isn't suspended. The cost of each clip is shown before you press Go.
- **"Powered by Runway"** in the Studio tab.
- **Tests, self-tests and the bible.**

**Size:** about 3 slices, medium difficulty. The background-job pattern is the main new piece. Ongoing cost is only the clips you make.

### Optional Stage C — GIF export for email

- An ffmpeg conversion step, Vercel feasibility to be confirmed. About 1 slice, medium-to-high difficulty because of packaging. Only worth it if you send motion newsletters.

### Your time

- About 1 hour for the pilot.
- About 15 minutes to create the Runway developer account and buy credits.
- Testing after each stage, using the same kind of step-by-step lists as R42.

---

## 7. What it would cost to run (estimate, from the verified prices)

Assume 3–5 attempts per clip you keep **(estimate)**, 5-second clips.

| Usage | Gen-4 Turbo ($0.25/try) | Gen-4.5 ($0.60/try) |
|---|---|---|
| One kept clip (4 tries) | ~$1 | ~$2.40 |
| 12 kept clips a year (rare editing) | ~$12/yr | ~$29/yr |
| 48 kept clips a year (monthly refresh, website + social) | ~$48/yr | ~$115/yr |

- Hosting adds **$0 on Supabase Pro at realistic traffic** (see §4). GPT-4o prompt writing is cents per clip and sits under the existing AI budget cap.
- **Running cost is not the issue.** The real cost is the build (Stage A plus Stage B, about 6 slices) and keeping it working as Runway updates models. Their own docs point to "Model Routers" so that apps don't break on deprecations, and the API is version-pinned through the `X-Runway-Version` header.

---

## 8. Difficulty and risk summary

| Risk | Level | Mitigation |
|---|---|---|
| Runway moderation blocks cannabis subjects, or the account is suspended for repeated blocks | **High, unknown** | Pilot first; product-cinematography prompts; strike counter in Stage B. |
| Animated ad crosses a WA rule (over-consumption, tobacco look, outdoor smoke) | Medium | Prompt guardrails, compliance scan, drafts-only approval, outdoor placements blocked. |
| Page speed and phone data | Low–medium | Poster first, load only on screen, reduced-motion fallback, size warnings. |
| Accessibility (WCAG 2.2.2) | Low | Pause button and reduced-motion support built in. |
| Long jobs vs server time limits | Low | Background job plus screen-side polling (Stage B). |
| Vendor change (model retired, prices change) | Low–medium | Model chosen in Settings, pure core isolates API shape. |
| Training use of uploads | Low | Marketing art only; nothing confidential. |

---

## 9. Recommendation, weighed against "the website will rarely be edited"

1. **Now:** run the pilot. I can write you a pilot sheet: 12 prompts (3 each for dab melt, rosin flow, joint rolling and vapor/smoke), worded for compliance and for Runway's moderation, plus a simple pass/fail table (blocked? quality 1–5? file size?). Use Runway's web app (one month of Standard at $15) or the API playground with $10 of credits.
2. **If at least 2 of the 4 subjects pass with good quality:** build **Stage A**. It is the part that gives the website its animated look, it works with clips made anywhere (Runway's app, an agency, your own phone), and it has no running cost.
3. **Build Stage B only if you expect regular use**, roughly monthly or more for social plus website. With rare edits, downloading from Runway's app and uploading to the media library takes a couple of minutes. That doesn't repay about 3 slices of build plus maintenance. If your social calendar makes it frequent, Stage B is worthwhile, and the design above is ready.
4. **Skip Stage C (GIF)** unless you start sending motion newsletters.

**If you'd rather go straight to building:** the professional order is still **A, then B**. A works without B; B without A would produce clips the website can't show.

---

## 10. Sources (read 2026-10-11)

- Runway Dev pricing: https://docs.dev.runwayml.com/guides/pricing
- Runway Dev models: https://docs.dev.runwayml.com/guides/models
- Runway API reference (image_to_video, tasks): https://docs.dev.runwayml.com/api (Markdown: /api.md)
- Runway inputs: https://docs.dev.runwayml.com/assets/inputs
- Runway outputs: https://docs.dev.runwayml.com/assets/outputs
- Runway usage tiers: https://docs.dev.runwayml.com/usage/tiers
- Runway moderation (API): https://docs.dev.runwayml.com/api-details/moderation
- Runway moderation (help): https://help.runwayml.com/hc/en-us/articles/21745792516371
- Runway Usage Policy: https://runway.com/safety/usage-policy
- Runway Terms of Use: https://runway.com/terms-of-use
- Runway plans: https://runway.com/pricing
- web.dev, "Replace animated GIFs with video": https://web.dev/articles/replace-gifs-with-videos
- web.dev, "prefers-reduced-motion": https://web.dev/articles/prefers-reduced-motion
- W3C, Understanding WCAG 2.2 SC 2.2.2: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Supabase file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Next.js Image docs (animated images served as-is): `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`
- WAC 314-55-155: https://app.leg.wa.gov/wac/default.aspx?cite=314-55-155 (WSR 26-12-082)
