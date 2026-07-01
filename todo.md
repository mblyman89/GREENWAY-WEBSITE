# Command Center Enhancements — Slices 65–80 (build 6 at a time)

Full verbatim list, owner decisions, deep-research log, and finalized roadmap:
see `docs/COMMAND_CENTER_ENHANCEMENTS_TASKLIST.md`.

## BATCH 1 — foundation & high-value UI (existing tables; no external accounts)

### Slice 65 — Nav → top tabs w/ dropdowns [item 16]
- [x] Ground: AdminSidebar + admin-nav-data + layout + permission gating + current mobile hamburger
- [x] Core: pure grouping/active-tab logic + tests (admin-nav-core, 16 assertions)
- [x] Build: AdminTopNav top tab bar w/ grouped dropdowns + mobile accordion; layout switched to column; deleted dead AdminSidebar
- [x] Verify: tsc 0, eslint 0, next build ok (all /admin routes present)
- [x] Commit → push → PR → merge → sync main

### Slice 66 — Site Content page: all pages [item 9] ✅ PR #171
- [x] Ground: /admin/content hub lists pages derived from content-block `page` values; legal/info pages had no editable blocks
- [x] Build: new `page:"legal"` group w/ editable hero titles for Privacy Policy, Terms of Use, Consumer Health Data (legal bodies untouched); wired via `<SiteText>`; per-block "View on site" links; label + subtitle updated
- [x] Verify (tsc 0, eslint 0, build OK) + Commit → push → PR #171 → merge --squash --admin → sync main

### Slice 67 — Loyalty customizer [item 2] ✅ PR #172
- [x] Ground: loyalty_config/tiers/promotions tables (mig 0039) + read-only /admin/loyalty
- [x] Build: pure core (validation + conversions + preview, tsx-tested), store write helpers, audited server actions, full editor UI (earn rate, point value, min redeem, signup bonus, code expiry, tiers, promotions) + live earn preview; read-only fallback for non-managers
- [x] Verify (core tests, tsc 0, eslint 0, build OK) + Commit → push → PR #172 → merge → sync main

### Slice 68 — Cycle counts barcode + hardening [item 3] ✅ PR #173
- [x] Ground: cycle_counts/lines (mig 0041) + inventory_lots (lot_code, pos_product_key; no UPC col) + detail page
- [x] Build: pure scan core (normalize + match exact/fuzzy/ambiguous/none, tallies; tsx-tested), store getCycleCountScanLines + bumpLineCount (open-session + not-applied guards), scanBumpLineAction (JSON, audited), scanner UI (USB wedge + phone camera BarcodeDetector, live log, progress, ambiguity warnings) on open sessions
- [x] Verify (core tests, tsc 0, eslint 0, build OK) + Commit → push → PR #173 → merge → sync main

### Slice 69 — Schedule builder [item 4] ✅ PR #174
- [x] Ground: shifts table (mig 0037, status scheduled/open/closed) + staffing page + pacificWallTimeToUtcISO
- [x] Build: pure schedule core (week math, time parse, duration, coverage; tsx-tested), store week list + create/update/delete/copy-week (UTC-correct), audited actions, week-grid UI (employees×days, inline add/edit, coverage totals, week nav, copy-to-next) at /admin/staffing/schedule, linked from Time Clock
- [x] Verify (core tests, tsc 0, eslint 0, build OK) + Commit → push → PR #174 → merge → sync main

### Slice 70 — Phone clock-in + hour adjustments [item 8]
- [x] Ground: employees/time_punches + staffing actions (source col free text → no migration for "phone")
- [x] Build: mobile PIN clock-in page /admin/staffing/clock (source "phone") + owner/manager Adjust Hours UI /admin/staffing/hours (edit/add punch w/ REQUIRED reason, Pacific wall-time → UTC, minutes recompute, audited)
- [x] Verify (core tests OK, tsc 0, eslint 0, build OK — both new routes present) + Commit → push → PR #TBD → merge → sync main
- [x] BATCH 1 COMPLETE (Slices 65–70)

## BATCH 2 — AI enrichment, compliance, marketing, seeds, mobile
- [x] Slice 71 — Sample compliance WAC 314-55-096 (hard blocks) [item 6] — migration 0054 (trade_sample_settings + trade_sample_events, idempotent); PURE core (quarter keys, per-unit size caps, cap eval) tsx-tested; store w/ hard-block enforcement; /admin/compliance/samples (recorder + per-processor/per-employee insight bars, ledger, owner settings, no-customer notice); nav entry; verify OK; PR #TBD merged
- [x] Slice 72 — Midjourney prompt builder + media overhaul [items 7+17] — PURE core (correct MJ syntax: subject-first comma groups, params at end w/ one space, punctuation stripped, clamped stylize/chaos/weird, niji, --sref/--sw/--oref/--no/--tile/--seed) + 5 cannabis-retail presets + compliance note, tsx-tested; grounded AI assist (real store+vendor context, drafts-only, no-op safe); /admin/marketing/midjourney (preset picker, brief fields, param sliders, media-library reference picker, live prompt + copy); media page already had AI alt/caption + tags/search/dropzone → added cross-link both ways; nav; verify OK; PR #TBD merged
- [x] Slice 73 — Sage 50 KB enrichment + Chart of Accounts upload [items 1+13] — VERIFIED Sage 50 CoA import fields from official help (Account ID ≤15, Description ≤30, Account Type code 0..24, Inactive; default CHART.CSV). Enriched SAGE50_KNOWLEDGE (KB doc + prompt) with CoA import facts. PURE core: SAGE_ACCOUNT_TYPES map, parseChartOfAccounts (header-aware + positional fallback, dedupe, inactive), validateGlMappingAgainstCoa (missing/inactive) — 44 assertions tsx-tested. Store: glMappingsFromSettings + validateChartOfAccounts (downloads CoA upload, cross-checks real AccountingSettings). New "Sage Chart of Accounts (CHART.CSV)" report kind; validateChartOfAccountsAction (audited sage.coa_validated); ChartOfAccountsValidator client component on the uploads list. Verify: tsc 0, eslint 0, next build OK. PR #TBD merged.
- [x] Slice 74 — Manifest pipeline pending/in-transit/awaiting-intake [item 10] (PR #180). RESEARCH-GROUNDED: CCRS has NO inbound feed (origin-uploaded CSV + email confirmations); receiving-side visibility = peer WCIA JSON hand-off + manual entry. Enhanced EXISTING lifecycle → Inbound pipeline dashboard: manifest-pipeline-core.ts (39 tsx assertions), full StageCounts, priority queues (awaiting-intake→in-transit→pending→accepted→rejected), ETA + overdue surfacing, factual "no CCRS feed" help note, ETA field on detail. No new migration (0032 cols reused).
- [ ] Slice 75 — KB seed coverage + owner uploads [item 14]
- [~] Slice 76 — Mobile-friendly pass [item 15] — **DEFERRED / BACK BURNER** (owner: not critical; wants a strategy session first to scope only the most useful phone features rather than porting ~70% of desktop. Revisit after strategy chat.)

## BATCH 2b — NEW owner tasks (added verbatim; replace mobile pass for now)
> Owner (verbatim):
> - "I want to pivot from mid journey to using flux 2 max. I will setup an account and fund it. On the same page as the mid journey ai prompt builder, please include a complete api pipeline implementation for using for our website and other marketing strategies. It should also have the same prompt builder as the mid journey ai. So it should be a seamless transition from using mid journey to this more powerful, fully integratabtle image generator baked directly into our workflow for easy content generation."
> - "I want to revisit the ach payments to my employees. Now that you have more info from me about my bank account with timberland. I want to process ach for my employees through my timberland account. I will run payroll in sage 50, i pay for the payroll service so it's super easy. I'll run payroll, export the data and upload it to the back office for ach processing. Please enhance the sage 50 reporting section to allow all of the available import export functions. I now have the ability to upload export sample data to help you help me with configuring the link between the two apps. That way the ai can assist me with filling out the fields properly and correctly."

- [x] Slice A (NEW) — FLUX 2 MAX image generation pipeline [new item 19] — VERIFIED BFL API (POST {base}/v1/{endpoint} x-key → {id,polling_url}; poll until Ready → result.sample signed URL; download+re-serve). Migration 0055 adds flux_api_key/flux_endpoint(default flux-2-max)/flux_base_url to integration_credentials (idempotent, RLS inherited from 0053). PURE flux-core (aspect→dims mult of 32, natural-language prompt from SAME CreativeBrief w/ MJ flags stripped + exclude→"Avoid:", submit/poll parsers, submit-url + filename; 34 assertions tsx-tested). Server flux-client (submit→poll 2min budget→download→uploadMedia as DRAFT; no-op-safe; 429/402/moderation/timeout handled). generateFluxAction (content.edit, audited flux.image_generated). "Generate with FLUX 2 Max" panel baked into MidjourneyBuilder on the SAME page (same brief; format PNG/JPEG; inline preview + Open in Media). Credential core+store extended (mask/merge/fold + getFluxOverrides; 42 assertions). FluxCredentialsForm added to Settings→Integrations. Verify: tsc 0, eslint 0, next build OK (both routes present). PR #TBD merged.
- [ ] Slice B (REVISED per owner clarification) — Employee payroll ACH via Timberland [new item 20; supersedes former OUT-OF-SCOPE item 12].
> Owner clarification (verbatim): "I will take the time card info and manually input the totals into my sage software. It will produce a paystub for me to give to the employee and one for me. I will then manually input into the back office the amounts owed to the employee. So I will need input fields for all the totals and the routing and accounting info plus whatever other manual input field I will need for this. I don't need to make it full auto, but enhancing the process so it's more efficient and quicker."
  → NOT auto-import from Sage. MANUAL-ENTRY payroll run: owner enters, per employee, net pay + gross/earnings/tax/deduction totals + bank routing/account/account-type; store employee banking (entered once, reused). Generate a NACHA PPD .ach batch for Timberland (Jack Henry) using the SAME NACHA engine as vendor ACH. Efficiency helpers (prefill last banking, running totals, validation). Light Sage 50 import/export section enhancements where quick.

## BATCH 2c — NEW owner tasks (added verbatim)
> Owner (verbatim):
> - "Update all of the websites page editor pages so that all of the image uploads for all of the various editable images, to add a helper to let us know the aspect ratio, or size, or pixel count/ ratio, etc. I want it to be super easy to create content to fill those spaces by being able to first create the proper size and dimensions for use in canva. We use canva for a lot of our marketing strategy so having useful helpers and such will be a really handy thing to have."
> - "Add biometrics so we can login via facial recognition or touch."

- [ ] Slice C (NEW) — Image-upload size/aspect helpers across all page-editor image uploads [new item 21] — a reusable helper that shows the recommended aspect ratio / dimensions / pixel size (and a Canva-ready spec) next to every editable-image upload, so content is created at the right size the first time. Ground in the actual image slots the editors use.
- [ ] Slice D (NEW) — Biometric login (Face ID / Touch ID) [new item 22] — WebAuthn/passkey platform-authenticator login on top of the existing Supabase email/password auth (register a passkey while signed in; sign in with biometrics thereafter). Ground in the real auth flow; do not weaken existing security.

## BATCH 3 — money movement & customer AI
- [ ] Slice 77 — Vendor ACH: banking + approval model [items 5/11]
- [ ] Slice 78 — Vendor ACH: NACHA batch generation [items 5/11]
- [ ] Slice 79 — Customer-facing AI concierge [item 18]
- [ ] Slice 80 — Customer AI knowledge seeding [item 18 cont.]

- NOTE: former OUT-OF-SCOPE item 12 (employee ACH payroll) is now IN SCOPE as Slice B per owner's new instruction.

## Remaining 6 slices to complete this run (owner-directed): 73, 74, 75, B, C, D
- [x] Slice A — FLUX 2 pipeline (PR #178) ✅
