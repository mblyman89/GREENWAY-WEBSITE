# R42 — Owner answers to the R41 open questions (bible)

Status: **built on branch `r42-owner-answers`** — see the status table at the end.
Companion research report: `docs/roadmap/R42-CREATIVE-STUDIO-MOTION-REPORT.md`.

## PART 1 — The owner's answers (verbatim intent)

| # | Question (R41) | Owner answer | Decision |
|---|---|---|---|
| Q1 | Are banners advertising (WAC 314-55-155 warnings)? | Yes, but the LCB enforcement officer says age-gated websites do not need the warnings inside each ad; they are in the footer. | Footer is the compliance surface. Make it verbatim-correct to the adopted rule; banner checks stop asking for warnings. |
| Q2 | Loyalty consent re-acceptance for existing members? | Not live, no members. | No change needed. |
| Q3 | Builder banners on About / FAQ / Locations / Price Match? | Some pages have no banners, just big titles — use your expert decision. | PART 2. |
| Q4 | Separate phone picture? | Expert decision. | PART 3. |
| Q5 | Preset badge styles? | No. | Nothing built. |

## PART 1A — Q1 detail

Source verified (not assumed): WAC 314-55-155(7) as amended by **WSR 26-12-082** (filed 2026-06-03, effective **2026-07-04**), read on app.leg.wa.gov and the LCB CR-103 PDF. The four statements, verbatim:

- (a) "This product has intoxicating effects and may be habit forming."
- (b) "Cannabis can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug."
- (c) "There may be health risks associated with consumption of this product."
- (d) "For use only by adults 21 and older. Keep out of the reach of children."

The live site (checked with curl at R42 start) showed the launch text: "Marijuana can impair…" and **no (c) sentence**. What was built:

1. `warning-text-core.ts` now holds the six adopted sentences, `CANONICAL_WARNING_TEXT` and `resolveWarningForRender()`.
2. **Render safety net:** `ComplianceWarningText` (server component, plain text, no HTML injection) renders the saved footer warning only if it passes the validator. Otherwise it renders the canonical text. The public site is therefore correct immediately, before the owner re-publishes.
3. The seed default is the canonical text, and the help text explains the age-gated footer approach.
4. **Admin → Header & Footer:** a gold notice appears when the saved copy uses older wording. It shows what is missing and gives the exact text to paste.
5. **Banner Studio:** the "Checks" tab now says warnings are not needed on banners because the age-gated footer carries them. A small-print box, if used, must still be ≥ 10 % of the banner.
6. Save and publish already refuse an invalid footer warning (`validateWarningBlock`); that is unchanged.

## PART 2 — Q3 decision (About / FAQ / Locations / Price Match)

**Decision.** Each page keeps its own designed top: the big title, or the photo and map on Locations. Builder banners **never replace** that top. Banners the owner adds in Admin → Pages show as an optional strip **after the page's content, right above the footer**. Vendors already uses this same pattern.

**Why this is the enterprise answer:**

1. **It removes the dead control.** "Add section" previously saved banners that never appeared anywhere.
2. **It is zero-risk.** With nothing published, `PageBuilderBanners` returns null (no markup), so all four pages are byte-identical until the owner opts in.
3. **The slot is predictable.** It is the same place on every page, and the hand-tuned tops are left alone.
4. **The pages stay static and fast.** Publishing already revalidates each page's path.

The admin page shows a "Where these show:" note on these four slugs.

## PART 3 — Q4 decision (phone picture)

**Decision.** Custom design (Banner Studio → Picture tab) gets an optional **"Phone picture"**. The default is still ONE picture with a separate phone focal point, which is enough for most banners. A second picture exists for the case where a wide picture is unreadable on a phone. This is standard art direction.

- **Data:** `design.image.srcMobile`, an optional key appended last. When it is unset the stored JSON stays byte-identical. `safeImageSrc` accepts only a site path ("/…", not "//", no backslash) or an https `*.supabase.co/storage/v1/object/public/…` URL with no credentials, and drops anything else.
- **Site:** `DesignedBanner` renders two lazy pictures only when a different phone picture is set. CSS shows exactly one, decided by the banner's own width (container query, phone below 768 px). Browsers do not download `display:none` lazy images, so each device fetches one picture.
- **Studio:** the 📱 Phone view, the canvas, the focal-point picker and AI "Suggest placement" all use the phone picture. The media library picker is wired into every Banner Studio host: Pages, Specials hero, Today's Deal, Shop banners and Loyalty hero.

Trade-off accepted: with a phone picture set, that banner's image is lazy rather than preloaded. It is still requested with high fetch priority when it is the top hero.

## PART 4 — Logs

- C1 `f8fa5823` Q1 footer warnings
- C2 `934c43c5` Q3 strip + Q4 core
- C3 Q4 UI + render
- C4 tests

**Validation (each run by the agent, before the PR):**

- **TypeScript:** scoped tsc over all changed files — 0 errors.
- **ESLint:** clean on the changed files, with one exception. `DesignedBanner.tsx` reports a `react-hooks/immutability` error on `usedH1`. It is **pre-existing on main** (reproduced on main's copy) and was not introduced here.
- **Unit tests (vitest):** the r42 ×2, r41-*, hardening, header-footer-editor, loyalty-page-editor, specials-presentation and banner/section suites — two runs, 160 + 167 tests (some files in both), all passing.
- **Self-tests:** pure runner ALL PASSED (banner-design-core floor raised 89 → 104).
- **Verifiers:** verbatim-quotes passed; commit authorship OK.

No migration was needed (next free migration is still 0265).

## PART 5 — Owner test steps

**Q1 (footer warnings):**

1. Open any public page, scroll to the footer, and confirm the warning reads "Cannabis can impair…" and includes "There may be health risks associated with consumption of this product."
2. Go to Admin → Header & Footer. The gold "older wording" notice should appear.
3. Copy the text from the box, paste it into "Footer — compliance warning", Save, then Publish. The notice should disappear.
4. Negative test: delete one sentence and Save. The save should be blocked with a message.

**Q3 (page-builder strip):**

1. Open /about, /faq, /locations and /price-match. Each should look exactly as before.
2. Go to Admin → Pages → About. The "Where these show:" note should appear. Add a section with a picture and title, then publish.
3. Reload /about. The banner should appear above the footer, with the title area unchanged.
4. Delete or unpublish the banner. The page should return to its original look.

**Q4 (phone picture):**

1. Open any Custom-design banner editor (e.g. Admin → Pages → Home, a section → Open the design studio) and go to the Picture tab.
2. Under "Phone picture (optional)", pick a different image from the media library.
3. Switch the studio to 📱 Phone. The canvas should show the phone picture. Set its focus, Save and Publish.
4. On the live site, view the page on a phone or a narrow window (below 768 px banner width). The phone picture should show; on desktop, the main picture.
5. In DevTools → Network → Img, only one of the two pictures should download per width.
6. Clear the field, then Save. The banner should be back to one picture.
7. Bad input: type `https://example.com/x.jpg`. An amber warning should appear and the value should not be kept.

## Status

| Item | State |
|---|---|
| Q1 / Q3 / Q4 code + tests | done (branch) |
| PR | see final report |
| Creative Studio motion report | `R42-CREATIVE-STUDIO-MOTION-REPORT.md` |
