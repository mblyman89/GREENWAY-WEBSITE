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
