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
- [ ] Slice 73 — Sage 50 KB enrichment + Chart of Accounts upload [items 1+13]
- [ ] Slice 74 — Manifest pipeline pending/in-transit/awaiting-intake [item 10]
- [ ] Slice 75 — KB seed coverage + owner uploads [item 14]
- [~] Slice 76 — Mobile-friendly pass [item 15] — **DEFERRED / BACK BURNER** (owner: not critical; wants a strategy session first to scope only the most useful phone features rather than porting ~70% of desktop. Revisit after strategy chat.)

## BATCH 2b — NEW owner tasks (added verbatim; replace mobile pass for now)
> Owner (verbatim):
> - "I want to pivot from mid journey to using flux 2 max. I will setup an account and fund it. On the same page as the mid journey ai prompt builder, please include a complete api pipeline implementation for using for our website and other marketing strategies. It should also have the same prompt builder as the mid journey ai. So it should be a seamless transition from using mid journey to this more powerful, fully integratabtle image generator baked directly into our workflow for easy content generation."
> - "I want to revisit the ach payments to my employees. Now that you have more info from me about my bank account with timberland. I want to process ach for my employees through my timberland account. I will run payroll in sage 50, i pay for the payroll service so it's super easy. I'll run payroll, export the data and upload it to the back office for ach processing. Please enhance the sage 50 reporting section to allow all of the available import export functions. I now have the ability to upload export sample data to help you help me with configuring the link between the two apps. That way the ai can assist me with filling out the fields properly and correctly."

- [ ] Slice A (NEW) — FLUX 2 MAX image generation pipeline [new item 19] — full API pipeline baked into the SAME page as the Midjourney builder; reuse the existing prompt builder; generate → save into media library → usable on website & marketing. Deep-research FLUX 2 MAX API (provider/endpoint/params) before building; credentials entry-gated; drafts-only.
- [ ] Slice B (NEW) — Employee payroll ACH via Timberland + Sage 50 import/export overhaul [new item 20; supersedes former OUT-OF-SCOPE item 12] — enhance the Sage 50 reporting section with ALL available import/export functions; accept Sage 50 payroll EXPORT upload → generate employee ACH (NACHA .ach / CCD or PPD) through Timberland (Jack Henry). Owner can upload REAL export sample data so the AI assists in mapping fields correctly. Deep-research Sage 50 payroll export format + NACHA PPD for payroll before building.

## BATCH 3 — money movement & customer AI
- [ ] Slice 77 — Vendor ACH: banking + approval model [items 5/11]
- [ ] Slice 78 — Vendor ACH: NACHA batch generation [items 5/11]
- [ ] Slice 79 — Customer-facing AI concierge [item 18]
- [ ] Slice 80 — Customer AI knowledge seeding [item 18 cont.]

- NOTE: former OUT-OF-SCOPE item 12 (employee ACH payroll) is now IN SCOPE as Slice B per owner's new instruction.
