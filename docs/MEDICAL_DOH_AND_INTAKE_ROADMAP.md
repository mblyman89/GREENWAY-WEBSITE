# Inbound Email + Medical-DOH Hardening — Roadmap (Slices 99–104)

**Owner request (verbatim):** "Thank you. For inbound vendor_intake@ email, it will be
a google account, I have both resend set up and a send grid account. I have to get my
credentials for sendgrid still, so I'll need an easy way to plug it in. Then please
proceed with the medical authorization slice. Make sure to add to the standing rules to
respect all DOH cannabis compliance rules and requirements then proceed with the next
slices. I trust your judgement to protect me from any and all possible compliance
violations. Please do it the right way even if it's harder. Please proceed."

**Grounding.** The medical module (Slice 28 + 85) is already substantial and DOH-grounded
(`docs/medical-doh-requirements.md`): `patient_authorizations` w/ UPID, holder type,
effective/expiration, DOH 608-048 checklist, MCR validation result, private `medical-forms`
scan bucket, recognition-card printing, `medical_exempt_sales` 5-yr ledger, endorsement
config. So this round HARDENS guardrails (never re-builds) and adds the inbound-email path.

Standing rule added this round: **🔴 DOH MEDICAL CANNABIS COMPLIANCE (BINDING)** in AGENTS.md.

All work: grounded, drafts-only for crawled/parsed data, idempotent migrations (owner runs
manually), branch → PR → squash-merge, money in cents, PHI stays in the private bucket.

---

## Slice 99 — Inbound email ingestion (provider-agnostic; Resend now, SendGrid plug-in) [MED] ✅ DONE
- Mirror the EXISTING Slice-50 pattern (`email-events/verify-core.ts` + `normalize-core.ts`
  + thin webhook routes). Add PURE `inbound-normalize-core.ts` that maps a Resend Inbound
  (JSON, Svix-signed) OR SendGrid Inbound Parse (multipart form) payload → ONE
  `NormalizedInboundEmail { from, to, subject, receivedAt, attachments[] }`.
- Provider is selected by env (`INBOUND_EMAIL_PROVIDER=resend|sendgrid`), so SendGrid is a
  drop-in once credentials exist. Route: `POST /api/webhooks/inbound-email` verifies the
  signature (reuse verify-core), normalizes, and hands JSON attachments to the existing
  `intake-parser` → `summarizeIntakeForReview` (Slice 97) as a DRAFTS-ONLY review item.
- Only accept mail addressed to the configured intake mailbox (e.g. `vendor_intake@`).
- Tests: both providers normalize; wrong recipient ignored; attachment extraction.
- Owner action noted: add the webhook URL in the provider dashboard + set env + (SendGrid)
  the Inbound Parse MX record on the Google domain.

  **DELIVERED:**
  - `src/lib/inbound-email/inbound-normalize-core.ts` — PURE normalizer (22 tsx tests pass).
    Exports `NormalizedInboundEmail`, `parseRecipients`, `normalizeResendInbound`,
    `normalizeSendgridInbound`, `normalizeInboundEmail`, `isForIntakeMailbox`,
    `manifestCandidates`, `__runInboundNormalizeTests`.
  - `src/lib/inbound-email/inbound-store.ts` — `logInboundEmail` (audit),
    `parseAttachmentToManifest` (CCRS CSV or vendor JSON), `stageManifestsFromEmail`
    (stages PENDING drafts via the EXISTING `intake-store.stageManifest`, so they land in
    `/admin/inventory/intake` — the same review UI staff already use).
  - `src/app/api/webhooks/inbound-email/route.ts` — one endpoint, `INBOUND_EMAIL_PROVIDER`
    picks Resend (JSON, Svix HMAC via `verifyResendSignature`) vs SendGrid (multipart form;
    file parts extracted to keep the core pure).
  - `supabase/migrations/0062_inbound_email_log.sql` — idempotent audit table (owner runs).
  - **Auth model:** Resend uses `RESEND_INBOUND_SECRET` (falls back to `RESEND_WEBHOOK_SECRET`)
    with the Svix HMAC. SendGrid Inbound Parse cannot sign, so it authenticates with a shared
    secret `SENDGRID_INBOUND_TOKEN` passed as `?token=` (or `x-inbound-token` header) — the
    "easy plug-in" once creds arrive: set two envs, point the Parse MX + webhook URL here, no
    code change. If a secret is unset the check is skipped with a warning (wire-first).

## Slice 100 — Medical authorization issuance guardrails (DOH 608-048 + data) [HIGH]
- PURE `medical-authorization-core.ts` `validateAuthorizationIssuance(input)`: enforces
  all four 608-048 checks (already gated) PLUS — UPID REQUIRED when `inDohDatabase`;
  effective ≤ expiration; expiration not already past (no issuing an expired card);
  holder type valid. Returns precise errors. Wire into `createAuthorization` (server).
- Tests: each rule; a fully-valid input passes.

## Slice 101 — Card validity + expiry safety for exemptions [HIGH]
- PURE `authorizationValidityAt(card, onDate)` → { valid, reason, expiringSoon }. An
  expired/inactive/not-yet-effective card is NOT valid → grants NO tax exemption. Wire
  into the medical-status / exempt-sale path so an expired card can never exempt a sale.
- Tests: active/expired/future/inactive; expiring-soon window.

## Slice 102 — Carded purchase-limit reference (WAC 314-55-095 3×) [MED]
- PURE helper exposing the 3× carded limits (3 oz usable, 48 oz solid, 216 oz infused
  liquid, 21 g concentrate) and a check the POS can call for carded patients. Grounded in
  the existing `sales-limits-core.ts`; extend, don't fork.

## Slice 103 — Medical audit/exempt-sale report completeness [MED]
- Verify the exempt-sale export carries ALL WAC 314-55-090(2) fields; add a PURE
  `verifyExemptSaleRecord` that flags any record missing date/UPID/effective/expiration/
  SKU/price BEFORE it's relied on for an audit. Surface in the medical report.

## Slice 104 — Intake-email → vendor review queue surfacing [MED]
- Persist normalized inbound intake items to a drafts queue the employee validates
  (reusing summarizeIntakeForReview output); nothing auto-commits to inventory/CCRS.

---

## STATUS
- [x] Slice 99 — Inbound email ingestion (Resend + SendGrid plug-in) — MED — merged PR #207
- [x] Slice 100 — Medical authorization issuance guardrails — HIGH
- [x] Slice 101 — Card validity + expiry safety — HIGH
- [x] Slice 102 — Carded purchase-limit reference — MED (already correct in sales-limits-core; documented)
- [x] Slice 103 — Exempt-sale record completeness — MED
- [x] Slice 104 — Intake-email review queue surfacing — MED

## DELIVERED — Slice 104
- `inbound-store.listInboundEmails(limit)` — read-only recent inbound_email_log rows.
- `/admin/inventory/intake` now shows an **Inbound email (vendor_intake@)** panel:
  received time, from, subject (links to the staged draft), attachment count, and a
  result badge (Staged draft / Parse failed / No manifest / Ignored). Staged drafts
  still live in the existing pipeline queues — drafts-only, nothing auto-commits.

## DELIVERED — Slices 100/101/103
- `src/lib/medical/medical-authorization-core.ts` (16 tsx tests):
  - `validateAuthorizationIssuance(input, now)` — 608-048 four checks + UPID-required-
    when-in-MCR + effective≤expiration + not-already-expired + valid holder type.
    Wired into `store.createAuthorization` (replaced the sole `canIssueCard` gate).
  - `authorizationValidityAt(card, onDate, soonDays)` — layered on `tax.cardValidity`
    (the exemption source of truth), adds `expiringSoon` + `daysUntilExpiry`. The exempt
    path already used `cardValidity`, so an expired/inactive/not-in-MCR/no-UPID card
    already grants NO exemption; this adds the staff early-warning signal.
- Slice 102 — `sales-limits-core.MEDICAL_LIMITS` ALREADY encodes the WAC 314-55-095(2)(d)
  3× carded limits (84 g usable / 1360.8 g solid / 6048 g liquid / 21 g concentrate) and
  `evaluateCart(lines, "medical", …)` applies them. Verified correct — not forked.
- `src/lib/medical/exempt-sale-record-core.ts` (11 tsx tests):
  `verifyExemptSaleRecord` / `verifyExemptSaleRecords` — flag any excise-exempt record
  missing a WAC 314-55-090(2) field (date/UPID/card effective/card expiration/product/
  price). Wired into `store.recordExemptSale` so an incomplete excise-exempt row is
  BLOCKED before insert (sales-tax-only rows are exempt from this ledger standard).
