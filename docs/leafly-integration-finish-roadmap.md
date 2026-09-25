# Leafly integration — finish roadmap (after Ben's 12 answers)

Owner: Michael Lyman · Maintainer notes for every slice that remains.
Source of Ben's answers: `docs/leafly-ben-email-integration-round.md`.

Every slice below follows the standing rules: its own branch, the pinned logic
goes in a pure self-tested core (registered with `assertRan` in
`scripts/compliance/run-pure-selftests.ts`), a compliance test pins the wiring,
a mutation script proves the tests can fail, and the slice is merged only after
CI and both Vercel checks pass and production reports success.

---

## Where things stand

| Slice | What | State |
|---|---|---|
| L-41 | Automatic sync actually turns on (the saved schedule was read as OFF) and actually sends (uses the "hold back only the bad ones" build, not the all-or-nothing push) | **Merged, live** (`4ea82512`) |
| L-42 | Leafly page reorganised: AI drafter removed; method dropdown and failing Push POST/PUT removed; **new simple "Replace my whole Leafly menu (POST)"** for certification; GET/PUT/POST/DELETE explained in plain English; copy fixed across the page | **Merged, live** (`ef2ee943`) |
| L-43 | Webhook signature: hex only; empty body with no header | **Merged, live** (`f0420f3a`); see "L-43: what shipped" below |
| L-44 | Order preview tax: tax-inclusive `packagePrice`, empty `taxes` | **Done** (PR #1224); see "L-44: what shipped" below |
| L-45 | `orderIntegrationKey` = Dispensary Menu Key cross-check | Next |
| L-46 | 9-second inbound response budget | Next (most operationally important) |
| L-47 | Certification "prove every action" evidence panel | Next |

---

## Why L-42 needed a POST button

Leafly's certification requires a successful call for every action.
**Automatic syncing only POSTs on a daily run where nothing is held back.**
That rule is invariant A1 in `src/lib/leafly/auto-sync-core.ts`. It exists so
the schedule can never delete a product by itself. On any day with even one
refused product it sends PUT plus safe DELETEs instead (`postDowngraded: true`).
So automation alone cannot be relied on to prove POST, and a manual POST is
required.

`tests/compliance/leafly-l42-page.test.ts` pins this: with one product held
back the automatic plan does not POST, and with none held back it does.

### How the POST card works (`replace-menu-panel.tsx`)

1. **Check what a POST would do.** This builds the menu with the same code as
   "Send my whole menu, hold back only the bad ones"
   (`full-menu-server.__internals.buildFullMenuDecision`). Nothing is sent.
2. The card names every held-back product, because POST deletes whatever it
   does not send.
3. If anything is held back, the owner ticks "I understand these N held-back
   products will be removed". The server receives the number N, not a yes.
4. **Send POST…** then **Yes, replace the menu.** The request goes through
   the shared transport (`sendLeaflyMenuRequest`, method POST, operation
   `full_menu_push`), so it carries the same deadline, retries and request
   logging as everything else.
5. The run is recorded as a manual run with method POST, plus a syndication
   log entry with the full payload and an audit row
   (`leafly.push.replace.success/error`).

Pure rules, in `src/lib/leafly/replace-menu-core.ts` (39 self-test assertions,
floor 37):

- **R1.** POST all passing products and no held-back ones.
- **R2.** Never send an empty POST.
- **R3.** Explicit confirmation is required.
- **R4.** If the build plan refuses, nothing is sent.
- **R5.** When anything is held back, the acknowledged count must equal the
  current held-back count exactly. A stale approval is refused.
- **R6.** Removed = previously sent minus sent now.
- **R7.** The removed-and-held-back list is named, including split-size
  families.

Mutation check: `scripts/recon/l42-mutation-check.sh`. All 9 mutations were
killed.

---

## L-43 — webhook signature: hex only, and the empty-body case

**Ben's answers 1 and 3.**
- The signature is lowercase hex HMAC-SHA-256 over the raw body.
- An empty body arrives with NO signature header.
- Webhook IPs rotate, so an IP allowlist is not possible.

**Anchor lines:** `src/lib/leafly/hmac-core.ts`
- `LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED = true` (line ~116).
- `verifyLeaflySignature` checks `missing_header` (line ~309) before
  `empty_body` (line ~339).
- It also accepts base64 (`looksLikeSha256Digest`).

**Change:**
1. Accept hex only, case-insensitive on input, and compare in constant time.
   Base64 becomes `malformed_header`.
2. Reorder the checks so that an empty body with no header is classified as
   `empty_body_no_header` rather than a "bad signature". The route answers it
   with 2xx and does nothing: no order is created, and it does not count
   toward the auth-failure evidence. Anything with a body and no header stays
   refused.
3. Flip `LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED` to `false` and cite Ben in the
   comment.
4. Remove any wording that implies IP allowlisting. Rotation means the HMAC
   is the only authentication.

**Pins:**
- A hex digest passes.
- The same digest in base64 fails.
- An empty body with no header gets 2xx and is not logged as an auth failure.
- A non-empty body with no header is still refused.

**Mutation:**
- Re-enabling base64 must fail a test.
- Swapping the check order must fail a test.

### L-43: what shipped

- `hmac-core.ts` now accepts only 64 hex characters, compared in constant time and
  case-insensitively. The correct digest sent as base64 (padded, unpadded, or
  base64url) is refused as `malformed_header`. `LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED`
  is `false`, and `LEAFLY_HMAC_ENCODING_SOURCE` cites Ben.
- Every verdict now has an `outcome`: `verified`, `refused` or `empty_unsigned`.
  `empty_unsigned` means exactly `""` for the body and no header. It is checked
  first, before the key, so a missing key cannot turn it into a refusal.
- A new pure function, `planLeaflyWebhookAdmission`, turns the verdict into what
  the route does:
  - **verified**: record, process, answer 200.
  - **empty_unsigned**: answer 200 and do nothing else. No event row is written,
    so it never shows up as a refused signature. No order is touched and nothing
    rings.
  - **anything else**: record the refusal, answer 401. Anything unrecognised also
    lands here, so the plan fails closed.
- `handleLeaflyWebhook` goes through that plan. The old `if (!verdict.ok) -> 401`
  line is the one that refused Leafly's expected delivery, and it is gone. The
  preview route answers `empty_unsigned` with `{cartItems:[],taxes:[]}` and never
  looks up the menu.
- A signed empty body is now checked like any other body instead of being
  refused without reading it. `empty_body` stays in the vocabulary so rows
  written by older builds still classify.
- The advice text no longer tells the owner to ask Leafly "hex or base64", and
  the refusal wording now says "a body with no signature".
- Tests:
  - Self-tests went from 82 to 133 (floor 130).
  - `tests/compliance/leafly-l43-hmac.test.ts` has 29 tests. They run the six
    real routes with real node HMAC.
  - A spec pin proves the vendored spec still does not name the encoding, so the
    authority is Ben's answer.
  - A pin proves nothing reads client IPs, because Leafly's IPs rotate.
- `scripts/recon/l43-mutation-check.sh` kills all 15 mutations.
- The older L-5 harness (`scripts/compliance/mutate-leafly-l5.py`) had five HMAC
  patterns that no longer existed after the hex-only change, plus one label that
  had become the opposite of true. They were refreshed by
  `scripts/recon/l43-refresh-l5-harness.py`. Its HMAC section now catches
  25/25 mutations.
- Full compliance suite: 677 files, 18,210 tests, all green.

---

## L-44 — order preview tax presentation

**Ben's answer 8.** Send the tax-inclusive `packagePrice` with an EMPTY taxes
array.

**Anchor lines:** `src/lib/leafly/preview-core.ts`
- `LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION = "tax_inclusive_no_tax_lines"`
  is already the default.
- `LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = true` (line ~119).

**Change:**
1. Flip the flag to `false` and record Ben's answer.
2. Make `tax_exclusive_with_tax_lines` unreachable from the webhook path (or
   delete it). A self-tested invariant pins that every preview response has
   `taxes: []` and a `packagePrice` equal to the price in our menu feed for
   that variant.
3. Remove the open question from the certification-readiness report.

**Pins:**
- Every preview has an empty `taxes` array.
- `packagePrice` equals the feed price to the cent.
- The out-the-door total is unchanged from today.

### L-44: what shipped

- **No money changed.** The preview was already tax-inclusive with `taxes: []`
  under decision D-2. A test proves the new webhook body is byte-identical to
  the old default body.
- `preview-core.ts`:
  - `LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED` is now `false`.
  - `LEAFLY_PREVIEW_OPEN_QUESTION` was removed. Nothing consumed it; grep
    confirmed that.
  - `LEAFLY_PREVIEW_TAX_PRESENTATION_SOURCE` records Ben's answer.
  - `LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION` is pinned to
    `tax_inclusive_no_tax_lines`.
- New pure invariant `checkTaxInclusivePreview(built, lookup)`. It reports five
  violation kinds:
  - `tax_lines_present`
  - `wrong_presentation`
  - `price_not_feed_price`
  - `unknown_variant_in_body`
  - `total_mismatch`
- New `buildLeaflyWebhookPreviewResponse({lines, lookup})`:
  - It has **no** presentation parameter.
  - It builds tax-inclusive, runs the check, and throws
    `LeaflyPreviewTaxInvariantError` rather than return a violating body.
  - The route's existing catch then echoes the cart, which is also
    tax-inclusive with `taxes: []`.
- The route calls only that builder. Source pins prove:
  - no file under `src/` other than preview-core names the tax-exclusive
    presentation or calls `buildLeaflyPreviewResponse`;
  - every `NextResponse.json` in the route sends `taxes: []`.
- Self-tests: 73 → 98 (floor 71 → 95).
- `tests/compliance/leafly-l44-preview-tax.test.ts` has 20 tests. It runs the
  **real** menu-push builder, the **real** preview lookup and the **real** route
  with a real HMAC over **one** fake feed, which includes fractional prices that
  round. It checks:
  - packagePrice equals the pushed menu price to the cent;
  - `taxes: []` on the priced, echo, empty-menu, all-removed and empty-unsigned
    paths;
  - a stale 3418 (the old pre-tax figure) is corrected to 5000;
  - a 20-case sweep.
- `scripts/recon/l44-mutation-check.sh` covers the route, the builder, the
  checker, the core, and the lookup's rounding. The L-5 harness pattern for the
  flag was refreshed, so it now mutates `false → true`. **21/21 killed.**
- Full compliance suite: 678 files, 18,230 tests, all green. tsc exit 0.

---

## L-45 — `orderIntegrationKey` is the Dispensary Menu Key

**Ben's answer 2.**

**Anchor lines:**
- `src/lib/leafly/webhook-server.ts` → `loadLeaflyOrderIntegrationKey()`
  (line ~96).
- The credentials test (L5) in `tests/compliance/` (around line 583) assumes
  two separate keys.

**Change:**
1. When a webhook body carries `orderIntegrationKey`, compare it
   (constant-time, trimmed) with the saved Menu Integration Key. Fall back to
   a separately saved order key only if one exists.
2. On a mismatch, answer 2xx, record evidence, and do not create the order.
   This is not an auth failure, because the HMAC already proved it is Leafly;
   it means the order is for a different store.
3. The Credentials page says in plain words: "Leafly uses your Menu
   Integration Key as the order integration key."

---

## L-46 — the 9-second inbound budget (most important)

**Ben's answer 4.**
- submit, status and cancel get 3 retries (4 deliveries) with backoff of
  15–25 s, 15–35 s and 30–60 s, about 2 minutes in total.
- Any non-2xx response, or any response slower than 9 s, counts as a failure.
- Preview is not retried.
- Orders auto-cancel at 15 minutes (`acknowledgeBy`).

**Anchor lines:** in `src/lib/leafly/webhook-server.ts`, the `order_submit`
path awaits all of these before answering:
- `collectLeaflyOrder` (line ~469)
- `onLeaflyOrderArrived` (the bridge, line ~478)
- `autoAcknowledgeOnArrival` (line ~573)
- `maybeSendLeaflyStaffAlert` (line ~604)

**Change:**
1. Answer as soon as the verified order row is saved: 2xx inside a hard
   budget of about 6 s, leaving headroom under Leafly's 9.
2. Move collect, bridge, auto-acknowledge and alert into Next's `after()`, in
   the same order, with the same "a failure still announces" rules.
3. A pure core decides "respond now" versus "must finish first". It pins that
   only the DB write sits before the response.
4. Keep retries idempotent. A retried delivery for an order we already saved
   must answer 2xx without creating a second order, announcing twice or
   printing twice. Much of this exists already; pin it against Ben's 4
   deliveries.
5. Preview is not retried, so it must stay fast and synchronous.

**Pins:**
- A static test that nothing slow is awaited before the response.
- Runtime tests with a slow bridge showing the response still returns under
  budget.
- A test showing a duplicate delivery does not create or announce twice.

---

## L-47 — "prove every action" certification evidence

**Ben's answers 6, 9, 10, 11 and 12.**
- We place our own sandbox test orders.
- The production instance comes later.
- There is nothing to clear for manual tools.
- Certification uses a window we give Leafly.
- Sandbox logs are kept for 2 weeks.
- Production credentials are separate.

**Change:** on the certification card, add a checklist that turns green from
recorded runs only, never from a claim:

| Action | Proven by |
|---|---|
| Menu POST | a successful POST run (automatic daily or "Replace my whole Leafly menu (POST)") |
| Menu PUT | a successful whole-menu, picked or automatic PUT |
| Menu DELETE | a successful removal (browser, ID box, or automatic safe delete) |
| GET status | "Check integration status" 2xx |
| GET menu | "Read the menu back" 2xx (sandbox only) |
| Order webhooks | a verified submit, preview, status and cancel from a sandbox test order |
| Order acknowledge / status updates | successful outbound calls |

Each row shows the date of the proof. Proof older than 14 days is marked "may
have expired from Leafly's sandbox logs; run again inside your certification
window". The card also suggests a window: pick two business days, run each
action once inside them, then email Leafly the window.

---

## Questions still open for Ben

1. **Is a manual POST enough?** Certification requires a successful POST.
   Does one owner-initiated POST count, or does Leafly want to see POSTs from
   the automatic schedule? The schedule only POSTs on days with nothing held
   back.
2. **Is a daily PUT acceptable when products are held back?** On those days
   our schedule sends PUT plus explicit DELETEs instead of POST, so a refused
   product is never deleted by a robot. Is that acceptable for cadence
   grading?
3. **How is the certification window requested?** To whom, how much notice,
   and does it have to fall inside the 2-week sandbox log retention?
4. **`isReservable` vs `availableForPickup`:** which field drives "orderable"
   in Leafly's storefront for a pickup-only shop?
5. **Readback `packagePrice` units:** are they cents or dollars in the GET
   /menu response? Our read-back currently leaves this unverified rather than
   guessing.

---

## Status of Ben's 12 answers

| # | Answer | Where it lands |
|---|---|---|
| 1 | Hex HMAC-SHA-256, raw body; empty body has no header | L-43 |
| 2 | orderIntegrationKey = Menu Key | L-45 |
| 3 | IPs rotate | L-43 (HMAC is the only authentication) |
| 4 | Retries and the 9-second deadline | L-46 |
| 5 | `medical:false` correct | No change. Tell Leafly when the medical endorsement lands. |
| 6 | We can place sandbox test orders | L-47 (the "Order webhooks" row) |
| 7 | Pickup-only fine | No change |
| 8 | Tax-inclusive packagePrice, empty taxes | L-44 |
| 9 | Production instance later | L-47 note; no code |
| 10 | Nothing to clear for manual tools | L-47 note; the attestation stays honest |
| 11 | Certification window; 2-week sandbox logs | L-47 |
| 12 | Separate production credentials | Already supported (environment-scoped keys) |
