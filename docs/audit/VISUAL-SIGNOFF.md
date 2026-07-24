# VISUAL-SIGNOFF — personal render-and-inspect pass (SLICE 34B)

**Date:** 2026-07-24
**Method:** every renderable route was served by the real Next.js app
(`npm run dev`), captured headless at 1440x900 desktop width with Playwright,
and personally inspected image-by-image. The shipped admin design-system
furniture was additionally rendered on a token-accurate harness sheet
(`docs/audit/lens4-visuals/harness/sheet4.html`) and inspected the same way.

## Honest scope note (read this first)

The inspection sandbox has **no Supabase environment**, so:

- Every `/admin/*` page behind `requireStaff` redirects to `/admin/login`
  and cannot be data-rendered here. Those screens are covered by the owner's
  manual walkthrough tests **T-140 through T-188** in
  `docs/audit/TEST-PLAN.md`, which exercise them against live data.
- `/pos` renders its device-provisioning ("Register setup") state, which is
  the correct behavior without device credentials; the transactional POS
  screens are likewise covered by the manual test plan.
- The design-system harness sheet closes most of that gap for *visual* risk:
  it reproduces, class-for-class against the real `globals.css` tokens, the
  exact Button/Badge/StatusPill/StatCard/chip/table/select/StickyActionBar/
  ConfirmDialog rules the admin pages are built from.

## Defect found and fixed during this pass

- **Home page crashed to the error boundary when Supabase env is absent.**
  `StaffShortcut` (the staff-only "Back office" pill on the home page) called
  `createSupabaseBrowserClient()` unconditionally in its effect;
  `@supabase/ssr` throws when the URL/anon key are empty, which tripped the
  route error boundary and replaced the whole home page with the
  "Greenway preview error" screen. Fixed by guarding the effect with
  `isSupabaseConfigured` — the shortcut silently skips when unconfigured
  (production, which has env vars, is unaffected; unconfigured previews now
  render the full home page). Re-shot and re-inspected after the fix: clean.

## Per-page verdicts — public site (17 pages)

| Route | Screenshot | Verdict |
| --- | --- | --- |
| `/` (home) | `home.png` | CLEAN after StaffShortcut fix — hero carousel, Today's Deal rail, product cards, nav/address/hours/phone banners all correct |
| `/menu` | `menu.png` | CLEAN — filter sidebar, search/sort, product grid |
| `/specials` | `specials.png` | CLEAN — daily deals laid out per day, consistent branding |
| `/about` | `about.png` | CLEAN |
| `/locations` | `locations.png` | CLEAN — store info, hours, map block |
| `/loyalty` | `loyalty.png` | CLEAN — program explainer + signup |
| `/medical` | `medical.png` | CLEAN — medical endorsement info |
| `/blog` | `blog.png` | CLEAN — post grid |
| `/faq` | `faq.png` | CLEAN — accordion list |
| `/vendor-delivery` | `vendor-delivery.png` | CLEAN — "Grow with Greenway" vendor page |
| `/checkout` | `checkout.png` | CLEAN — empty-cart state + RCW 69.50 compliance warning footer |
| `/price-match` | `price-match.png` | CLEAN — policy page |
| `/privacy-policy` | `privacy-policy.png` | CLEAN — legal page |
| `/terms-of-use` | `terms-of-use.png` | CLEAN — legal page |
| `/consumer-health-data` | `consumer-health-data.png` | CLEAN — WA My Health My Data policy |
| `/unsubscribe` | `unsubscribe.png` | CLEAN — proper guidance for a missing token, compliance footer intact |
| Age gate | (dismissed on every page) | CLEAN — "Yes, I am 21+" gate appears before content on first visit |

## Per-page verdicts — staff entry points

| Route | Screenshot | Verdict |
| --- | --- | --- |
| `/admin/login` | `admin_login.png` | CLEAN — renders the intentional "Back office — setup required" instructions when Supabase env is absent (correct unconfigured behavior; with env it renders the login form, covered by T-140+) |
| `/pos` | `pos.png` | CLEAN — "Register setup" device id/key provisioning card, correct behavior without device credentials |

## Design-system harness verdicts (sheet4.html)

| Section | Screenshot | Verdict |
| --- | --- | --- |
| Button — 6 variants x 3 sizes + disabled | `harness_sheet4_top.png` | CLEAN — orange/green/gold/red/purple solid pills + soft-orange neutral all render with black ink and correct pill shape; disabled states properly dimmed |
| CHIP_ACTION / CHIP_NEUTRAL | `harness_sheet4_top.png`, `harness_sheet4_statcards.png` | CLEAN — tinted ring chips readable at row density |
| Badge tones + StatusPill tones | `harness_sheet4_statcards.png` | CLEAN — all six badge tones and six pill tones legible on both surface levels |
| StatCard (4 accents) | `harness_sheet4_statcards.png` | CLEAN — label/value/hint hierarchy and soft icon wells correct |
| Table pattern + dark select/input | `harness_sheet4_statcards.png`, `harness_sheet4_mid.png` | CLEAN — surface-2 header, row dividers, hover surface, dark select and dark input (no white-on-white) |
| ConfirmDialog (danger, type-to-confirm) | `harness_sheet4_mid.png` | CLEAN — scrim, dialog surface, CONFIRM word input, disabled confirm button |
| ConfirmDialog tone buttons | `harness_sheet4_bottom.png` | CLEAN — danger/warning/primary footer buttons |
| StickyActionBar (both status tones) | `harness_sheet4_bottom.png` | CLEAN — success and warning status dots + text, actions right-aligned, bar pins to viewport bottom |

## Sign-off

I personally rendered and inspected all 19 route screenshots and all 4
harness captures listed above. One real defect was found (StaffShortcut
crash without Supabase env) and fixed in this same slice. Everything else
rendered clean, uncluttered, and on-brand (black canvas, Greenway green,
gold, orange accents, compliant footers). Data-gated admin/POS screens
remain the owner's to verify with live data via T-140 through T-188.

Signed: SuperNinja (automated visual pass, SLICE 34B)
