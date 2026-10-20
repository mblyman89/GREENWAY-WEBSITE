# 11 — WA.gov Transition (October 2026)

Owner (Part 05, Q7): start now; he believes only the login changes and the upload is identical — "if i am wrong about that, we should know sooner than later."

## A. What the LCB text says (verbatim, everything there is)

From the FAQ `[FAQ L0008-L0012]`:

- "Washington state is transitioning from SecureAccess Washington (SAW) to a new, unified WA.gov account system, providing a new way to log in to Washington state services. SAW no longer meets current technology, security, or user experience standards. …" `[FAQ L0008]`
- "Q: When is this happening?" `[FAQ L0009]` — "CCRS will be transitioning to WA.gov in October 2026. The state expects the transition to be complete by the end of 2027. Each agency is responsible for their service transitions and will coordinate those timeframes with customers and WaTech." `[FAQ L0010]`
- "Q: Will SAW accounts automatically transition to WA.gov?" `[FAQ L0011]` — "No. All users need to manually set up a new account. Create a WA.gov account here." `[FAQ L0012]` (the "here" link target is not captured in `faq.txt`; see §D item 1).

That is the entirety of the authoritative text. **Nothing in any fetched source says whether the Upload page, file formats, or the license-admin/integrator model change.** The owner's belief is plausible (SAW is only the identity provider — the login guide describes it as a redirect: "The URL https://cannabisreporting.lcb.wa.gov will redirect to Secure Access Washington (SAW) for authentication" `[LOGIN L0046-L0047]`) but it is UNVERIFIED → **U-10** (Part 12), examiner question 8 (Part 06 §G).

Prior recon (`/workspace/ccrs-notes.md` §E): the "Sign-In Guide" URL from the 08/19/2026 bulletin returned 404 — do not cite its contents.

## B. What SAW-specific text exists in our code and docs (all must become one label)

| Location | Text today |
|---|---|
| `src/components/admin/compliance/UploadWalkthrough.tsx` L178 | "cannabisreporting.lcb.wa.gov" near SAW wording (L144-L256 steps) |
| `src/app/admin/reports/compliance/batch-export/route.ts` L125 | "Upload these files at https://cannabisreporting.lcb.wa.gov/ (SAW login) in this order:" |
| `src/lib/notifications/compliance-reminders.ts` L100 | "Upload portal: … (SAW login" |
| `src/lib/compliance/ccrs-week-core.ts` L282 | "Generate, validate and upload the batch at cannabisreporting.lcb.wa.gov, then record the submission" (no SAW word; URL only) |
| `docs/CCRS_SELF_REPORTING_GUIDE.md` | SAW steps (also has the stale A5.4 — Part 04 §D.1) |
| Part 02 §4 (`[LOGIN]`) and §6 (`[SAW]`) | the LCB's own SAW guides — these stay as historical reference; a WA.gov login guide, when LCB publishes one, is added to `/workspace/lcb/` and Part 02 regenerated |

S-07 collapses the URL into `ccrs-portal-core.ts`; S-09 collapses the login label into `loginLabel(mode)` with `license_settings.portal_login_mode ∈ {saw, wagov}`.

## C. Design for the switch (S-09)

1. Setting, not code: the owner flips `portal_login_mode` in hub Step 0 the day his WA.gov account works. No deploy needed on transition day.
2. Every mention of the login method renders `loginLabel(mode)`; a guardrail test greps for the literal `SAW` outside `ccrs-portal-core.ts` and the Part 02 reference volume.
3. Hub notice (pure date function, tested at 2026-08-31 → off, 2026-09-01 → on, 2026-12-01 → on with "overdue?" wording) when mode is still `saw` and today ≥ 2026-09-01: "CCRS moves to WA.gov login in October 2026 `[FAQ L0010]`. SAW accounts do not carry over `[FAQ L0012]`. Create the WA.gov account before the first October Sunday."
4. The walkthrough's sign-in step text becomes: "Open {portalUrl}. You will be redirected to {loginLabel} to sign in. (Do not log in at the identity provider directly — `[SAW L0004-L0005]` for SAW; for WA.gov, follow LCB's guide when published.)"
5. License-admin / integrator model: `[LOGIN L0059]` "Only one SAW user can associate as the license admin" — whether the WA.gov account inherits that association is unknown (U-10). The cutover checklist in Part 07 §D (integrator removal) must be completed **before** October or re-verified after, because it depends on the admin login working.

## D. Actions the owner must take (owner-only; Part 05 OD-series)

1. Create a WA.gov account when LCB opens it (the FAQ's "here" link — capture the URL into Part 13 when read from the live page; `faq.txt` lost the href).
2. Confirm with the examiner (Part 06 §G Q8) whether the Upload page and templates change. Paste the reply into Part 12 U-10.
3. Confirm the license-administrator association survives (or re-do it per `[LOGIN L0053-L0062]` first-login association steps).
4. If Cultivera is still integrator in October: confirm their integrator assignment survives too (it is done by the license admin `[FAQ L0081]`).

## E. What "we should know sooner than later" translates to

The only way to *know* before October is the examiner's written answer (Q8) and, once LCB opens WA.gov login in PREprod, running Part 06 T-01 again under the new login. Add **T-02b** to Part 06 when that happens: "Log in at PREprod via WA.gov; confirm the Upload page and the seven templates are unchanged (re-download templates and md5 against Part 13)." Until then, S-09 is scaffolding only.

## F. UPDATE 2026-10-19: the switch has happened (Part 17 §F)

- CCRS moved to WA.gov login on **Monday Oct. 12, 2026**, with downtime "approximately 5 p.m. to 8 p.m." `[BUL1006 L0010]`. Every licensee needs a WA.gov account plus a one-time registration `[BUL1006 L0011]`.
- **Scope is login only.** "None. The only change in scope is the transition from SAW to WA.gov authentication. All CCRS functionality and upload processes remain the same as they are now." `[FAQ19 L0191]`. The examiner: "At this time no other impacts." `[EXAM L0560]`. **U-10 CLOSED.**
- **Two accounts:** "You will need separate WA.gov accounts for the Pre-Production environment and the live environment." `[SIGNIN L0035-L0036]`. The registration email "must already have been set up with LCB Licensing." `[SIGNIN L0062]`.
- The 08/19 bulletin's Sign-In Guide link, which returned 404 before (§A), now resolves. It is CIB154 (Part 13 §G).
- **Consequence for §C (S-09):** the date notice and the `portal_login_mode` setting are no longer needed. The switch is past and cannot be reverted. S-09 becomes slice S-17c: replace the six remaining "SAW login" strings with WA.gov wording, and add a guardrail test. The six strings are:
  - `compliance-reminders.ts:108`
  - `ccrs-outbox-core.ts:300`
  - `excise-payment-core.ts:46`
  - `UploadWalkthrough.tsx:184`
  - `ErrorTriagePanel.tsx:160`
  - `concierge-kb.ts:350`
  
  The line numbers in §B above are older.

## G. S-17c done (2026-10-19): CCRS sign-in wording is WA.gov everywhere

**Source of truth:** `src/lib/compliance/ccrs-signin-core.ts` (pure). It holds the label, the switch date, the two create-account links, WaTech help, the service desk, the per-environment sign-in steps, and the guardrail `ccrsLoginWordingIssues`.

**Grounding (all verbatim, in the repo):**
- "on Monday, Oct. 12, the Cannabis Central Reporting System (CCRS) will transition from using SecureAccess Washington (SAW) to the new WA.gov interface for login" `[BUL1006 L0010]`.
- "Other LCB applications will move to using WA.gov next year." `[BUL1006 L0013]`. So the LCB Portal (licensing requests, card payments) may still be SAW. Nothing here speaks for it.
- "You will need separate WA.gov accounts for the Pre-Production environment and the live environment." `[SIGNIN L0035-L0036]`.
- The two "here" links of `[SIGNIN L0037-L0038]` resolve, from the PDF's link annotations, to `https://manage.login.wa.gov/create` (live) and `https://test-manage.login.wa.gov/create` (Pre-Production). Evidence: `evidence/.../signin-links.txt`. Both URLs returned HTTP 200 on 2026-10-19.
- "This email address must already have been set up with LCB Licensing." `[SIGNIN L0062]`.
- "Contact the LCB ITS Service Desk (servicedesk@lcb.wa.gov) for assistance." `[SIGNIN L0069]`.
- WA.gov account problems: "Submit a WA.gov accounts help request" `[FAQ19 L0172]`, "with the WaTech Support Center." `[FAQ19 L0173]`.
- "These environments are autonomous and do not share administration or reporting data." `[FAQ19 L0369]`.

**What changed:**
- Upload README header: "(WA.gov login)" for production. PREprod gets "(WA.gov login - your PRE-PRODUCTION WA.gov account, separate from the live one)".
- Reminder email footer: "(WA.gov login)".
- Walkthrough sign-in step: per environment, with the create link, the one-time Register step and the help routes.
- Error-triage footer: "CCRS technical problems".
- Concierge fact: the CCRS portal uses a WA.gov login.
- Excise comment.
- Docs: the self-reporting guide (Step A1 + quick reference), the cutover checklist (C-010, C-011, the "SAW login" in two upload steps, and the reference table), the owner tasklist, the test plan, the audit bible, the data model, excise methods, the project guide, the compliance bible, returns/destruction, the command-center research, the roadmap and the research notes.

**What stays SAW, on purpose:**
- The DOH Medical Cannabis Registry login at the register (`saw-prefill-core.ts`, `SaleFlow.tsx`, the staffing "SAW username"). That is DOH, not CCRS. It is not verified whether DOH has moved to WA.gov, so it is not changed (see U-63).
- Part 02 §4/§6 quote the LCB's SAW-era guides verbatim. They are history.

**Guardrail:** `tests/compliance/s17c-wagov-signin-wording.test.ts` scans every `.ts/.tsx/.md` under `src/` and `docs/` (except `docs/ccrs-bible/` and the guardrail module itself). Any line naming SAW within one line of a CCRS word fails, unless it is history ("from SAW to", "left SAW", "SAW → WA.gov", "until 2026-10-12", …). The test also proves the guardrail flags each of the six old strings, and that it spares the DOH line.
