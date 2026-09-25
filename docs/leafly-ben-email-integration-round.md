# Ben (Leafly) — answers to our integration questions

**Status: BEING IMPLEMENTED, one slice at a time.** Each item carries an
`IMPLEMENTED` line once its slice has shipped. The plan for the remaining items
is in `docs/leafly-integration-finish-roadmap.md`.

This file exists so that the integration round starts from a written record
rather than from memory.

Received during the dashboard slice round. Recorded verbatim in substance.

---

## 1. Signature format

`X-Leafly-Signature` is **lowercase hex**, HMAC-SHA-256 computed over the **raw
request body only**. No timestamp component, no prefix, no versioning scheme.

**When a webhook has an empty body, the header is not sent at all.** A missing
signature header on an empty body is EXPECTED, not a failure. Any verification
code must not treat that case as a rejection.

> ROADMAP IMPACT: none on slices 2–8. This is an inbound-webhook concern.
> ACTION LATER: check `hmac-core.ts` / `webhook-parse-core.ts` for whether an
> empty body with no header is currently classified as a bad signature. If it
> is, that is a live false-rejection bug, because a false rejection returns
> non-2xx, which Leafly counts as a delivery failure (see item 4).
>
> **IMPLEMENTED in SLICE L-43.** It WAS a live false-rejection bug: a missing
> header was refused with 401 before the body was ever looked at.
> - Now only lowercase or upper-case hex verifies, and base64 is refused.
> - An empty body with no header gets 200. Nothing is recorded or processed.
> - A body with no header is still 401.
> - See `hmac-core.ts` (`planLeaflyWebhookAdmission`) and
>   `tests/compliance/leafly-l43-hmac.test.ts`.

## 2. orderIntegrationKey

`orderIntegrationKey` is the **same value as the Dispensary Menu Key** we already
hold. It is one per-retailer key, and that same key appears in the
`orderIntegrationKey` field on every webhook.

> ROADMAP IMPACT: none. Confirms our existing configuration is correct rather
> than requiring a second secret. Worth surfacing in the credentials editor copy
> so nobody goes hunting for a key that does not exist separately — this touches
> the same misleading text already flagged at `CredentialsEditor.tsx:135`
> ("Leave them blank until Leafly sends them"), which remains an open offer.
>
> **IMPLEMENTED in SLICE L-45.** "ROADMAP IMPACT: none" turned out to be wrong.
> It WAS a live blocking bug: the code read ONLY the Order integration key box.
> With that box blank (the owner's screenshot showed "NOT SET"), every collect,
> acknowledge and status push refused with "fix your credentials". This was
> true even though the Menu key, which is the same value, was saved and
> working.
> - Now a blank Order box falls back to the Menu key. An explicitly filled
>   Order box still wins, so no working setup changes.
> - Every verified webhook's `orderIntegrationKey` is now compared with ours
>   using a constant-time comparison. On a mismatch the delivery is **still
>   processed**, never dropped: Greenway is the only retailer behind this
>   HMAC key, so a mismatch can only be a typo on our side. The log line says
>   so loudly, and the setup panel names the box to fix. Key values are never
>   logged or rendered.
> - The credentials page says whether the two boxes agree. The copy now reads
>   "Leafly uses your Menu Integration Key as the order integration key; leave
>   blank to use it."
> - The misleading "NOT interchangeable" comment in the credentials core is
>   corrected.
> - See `src/lib/leafly/retailer-key-core.ts` and
>   `tests/compliance/leafly-l45-retailer-key.test.ts`.

## 3. Webhook egress IPs

Leafly's webhook egress IPs **rotate**; there is no stable range to allowlist.
Rely on signature verification for authenticity, not on network origin.

> ROADMAP IMPACT: none. Confirms we should NOT build IP allowlisting.
>
> **IMPLEMENTED in SLICE L-43** as a pin: no Leafly file reads a client IP
> (`x-forwarded-for`, `x-real-ip`, `request.ip`, `remoteAddress`). The HMAC is
> the only authentication.

## 4. Retries and the response deadline  ← MOST OPERATIONALLY IMPORTANT

- `order_submit`, `order_status`, `order_cancel` are retried up to **3 times
  after the initial attempt — 4 deliveries total**.
- Backoff is roughly 15–25s, then 15–35s, then 30–60s. Full sequence ≈ 2 minutes.
- **Any non-2xx counts as a failure, AND SO DOES TAKING LONGER THAN 9 SECONDS
  TO RESPOND.**
- `order_preview` is **NOT** retried — it runs inline in the shopper's cart
  update, so a slow or failed preview is visible to the shopper immediately.
- **Unacknowledged orders auto-cancel at 15 minutes.** That deadline is the
  `acknowledgeBy` value in the submit payload.

> ROADMAP IMPACT: **the 9-second rule is new information and it is load-bearing.**
> Slice 1 gave every OUTBOUND Leafly call a hard deadline. This item is about the
> INBOUND direction: our webhook handlers must respond within 9 seconds or the
> delivery is counted as failed even if we did the work correctly.
>
> This does NOT change slices 2–8, but it creates a NEW candidate slice for the
> integration round: an inbound response-budget guard, mirroring
> `deadline-core.ts` but for the receive side. Specifically worth checking:
> `webhook-server.ts:447` awaits `onLeaflyOrderArrived` BEFORE responding, and
> that function queues a receipt and an announcement. If the printer or the
> announcer is slow, we could blow the 9-second budget and be marked failed on
> an order we actually accepted. The 15-minute auto-cancel already recorded in
> `deadline-core.ts` (`LEAFLY_AUTO_CANCEL_MS`) is confirmed correct.

> **IMPLEMENTED in SLICE L-46.** All of a verified delivery's work is one
> promise, raced against a 6 s budget. Signature verification (capped at 5 s)
> is the only thing awaited before it. A slow delivery answers 200 and
> finishes the same work in `after()`, with `maxDuration = 300` on every
> route. The 2-minute ack sweep remains the safety net. Ben's retry policy is
> encoded in `inbound-budget-core.ts`: activate and deactivate are recorded as
> "not stated". See the roadmap, "L-46: what shipped".

## 5. medical: false

`medical: false` on every variant is **correct**. The sandbox store is
recreational only, so the per-variant flag has no effect until the store config
changes. Tell Leafly when the medical endorsement lands so they can switch the
store to a dual licence.

> ROADMAP IMPACT: none. Confirms current behaviour is right; removes a suspected
> defect from the list.

## 6. Test orders

The owner can place test orders himself from the sandbox storefront. No need to
ask Leafly to place them.

> ROADMAP IMPACT: none, but operationally useful — it means slices 2–8 can be
> validated against real sandbox orders whenever the owner wants.

## 7. Delivery lifecycle

Delivery lifecycle support is **not** a certification blocker. Pickup-only is
fine.

> ROADMAP IMPACT: none. Removes `out_for_delivery` / `arrived_at_customer` from
> scope. (Those remain required only for the optional UberEats programme.)

## 8. Tax presentation  ← SECOND MOST IMPORTANT

**Send the tax-inclusive shelf price as `packagePrice`, with an EMPTY taxes
array.** The store is configured as "tax included in menu".

If we send `TaxComponent` lines, they will **not** be added to the shopper's
total — so what we send and what the shopper sees would disagree. What we send
and the store setting must stay aligned.

> ROADMAP IMPACT: none on slices 2–8 (those are dashboard work), but this is a
> CORRECTNESS requirement for the order-preview and menu paths. Candidate slice
> for the integration round: assert in a pure core that the taxes array is empty
> whenever the store is in tax-inclusive mode, so the two can never drift. This
> is exactly the kind of invariant that belongs in a self-tested core rather
> than in a comment.

> **IMPLEMENTED in SLICE L-44.** This was NOT a live bug. The preview was
> already tax-inclusive with an empty `taxes` array, because decision D-2 chose
> the reading that cannot overcharge. What changed:
> - The unconfirmed flag is down. The answer is recorded in code as
>   `LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE`, and the old open question is gone.
> - The webhook now calls a builder that has no tax option at all
>   (`buildLeaflyWebhookPreviewResponse`). That builder checks its own output
>   before sending it (`checkTaxInclusivePreview`):
>   - `taxes` must be empty;
>   - every `packagePrice` must equal the price our menu push sent Leafly, to
>     the cent;
>   - the lines must add up to the out-the-door total.
>
>   If that check ever fails, the shopper gets their cart echoed back unchanged
>   (still tax-inclusive, still no tax lines) instead of a wrong price.
> - Byte-for-byte, the body Leafly receives is the same as before.

## 9. Sandbox destination URLs

Sandbox destination URLs are not locking anything in. A separate production
instance is set up later with production webhook URLs. Sandbox URLs can be
changed on request.

> ROADMAP IMPACT: none. Removes the worry that our sandbox URLs are permanent.

## 10. Manual tools

Nothing to clear regarding manual tools. Manual sandbox requests are not
prohibited, and nothing in the logs counts against certification.

> ROADMAP IMPACT: none. Our manual push/readback buttons are safe to keep.

## 11. Certification window and log retention

Development traffic does **not** count against certification. Certification is
assessed against a **time window the owner provides**. **Sandbox logs are
retained for two weeks.**

> ROADMAP IMPACT: none on slices 2–8. Two operational consequences worth
> remembering: (a) we choose when the assessed window starts, so we should
> perfect the integration first and nominate the window afterwards; (b) any
> evidence we want to keep from a sandbox session must be captured within two
> weeks or it is gone.

## 12. Production credentials

Production credentials are issued separately and share **no values** with
sandbox. Sandbox is a separate deployment. Read-once destructive notes are
covered at production setup.

> ROADMAP IMPACT: none now. Confirms the credentials UI must support a clean
> second set rather than assuming sandbox values carry over.

---

## SUMMARY FOR THE ROADMAP

**Ben's email does not change slices 2–8.** Every one of those slices is
dashboard and notification work inside our own application, and nothing Ben
wrote touches them.

It adds **two new candidate slices for the later integration round**, both of
which are correctness issues rather than cosmetic ones:

1. **Inbound 9-second response budget.** Non-2xx *or* >9s is counted as a failed
   delivery, 4 attempts over ~2 minutes, then the order auto-cancels at 15
   minutes. Our `order_submit` handler currently awaits printing and announcing
   before responding.
2. **Tax presentation invariant.** Tax-inclusive `packagePrice` with an empty
   taxes array, enforced by a self-tested core so it cannot drift from the store
   setting.

And one **defensive check**: an empty webhook body arrives with no signature
header at all, and must not be classified as a bad signature.
