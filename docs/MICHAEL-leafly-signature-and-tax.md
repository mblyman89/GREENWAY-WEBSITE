# Leafly: webhook signatures (L-43) and preview tax (L-44)

**For:** Michael
**Short version:** Ben's answers 1, 3 and 8 are now built in, and each is pinned
by tests that fail if someone undoes it. L-43 fixed a real bug. L-44 changed no
money; it locks in what was already right.

---

## L-43: how we check that a webhook really came from Leafly

### What Ben told us

Leafly signs every webhook with **lowercase hex** HMAC-SHA-256 over the raw
body. There is no prefix. When a webhook has an **empty body**, Leafly sends
**no signature header**, and that is expected. Leafly also counts any non-2xx
answer as a failed delivery.

Leafly's IP addresses rotate, so we must not filter by IP.

### What was wrong before

We had built the code without knowing the encoding, so it accepted **hex or
base64**.

Worse, it treated "no signature header" as an automatic refusal before it even
looked at the body. So Leafly's expected empty, unsigned deliveries got a
**401**. Leafly would count each of those as a failed delivery.

### What happens now

| What arrives | Our answer | Recorded? | Does anything happen? |
|---|---|---|---|
| Body, correct hex signature (either case) | 200 | Yes, as verified | Yes: order saved, bell, auto-ack, and so on |
| Body, same digest but in base64 | 401 | Yes, as "malformed" | Nothing |
| Body, wrong key | 401 | Yes, as "mismatch" | Nothing |
| Body, **no** signature | 401 | Yes, as "unsigned" | Nothing |
| **Empty** body, no signature (Leafly's normal case) | **200** | **No** (so it never shows up as a scary refusal) | Nothing. The order preview answers an empty cart. |
| Whitespace-only body, no signature | 401 | Yes | Nothing. Only a truly empty body gets the pass. |

One function, `planLeaflyWebhookAdmission`, now makes the process /
acknowledge / refuse decision for all six webhook routes. Anything it doesn't
recognise is **refused**, so it fails closed.

The evidence panel no longer tells you to "ask Leafly whether it's hex or
base64". That question is settled.

### Proof

- 133 self-checks inside the signature module.
- 29 end-to-end tests through all six real routes, using real cryptography.
- 15 of 15 deliberate sabotages were caught.
- The older L-5 sabotage script was brought up to date: 25 of 25 caught.
- The full suite passed: 18,210 tests.
- Merged as `f0420f3a`.

---

## L-44: what the shopper sees for tax at Leafly checkout

### What Ben told us

Send the **tax-inclusive shelf price** as `packagePrice`, with an **empty**
`taxes` list. Your store is set to "tax included in menu" on Leafly. If we
sent separate tax lines, Leafly would **not** add them to the total, so what we
send and what the shopper sees would disagree.

### Where we already were

That is exactly what we were already doing. When this was built we did not
know the answer, so we chose the option that **cannot overcharge** a shopper.
Nothing about the money changes. A test proves that what Leafly receives is
byte-for-byte the same as before.

### What changed

- The "we don't know yet" flag is down, and Ben's answer is written into the
  code where the question used to be.
- The order-preview webhook now uses a builder that has **no tax option at
  all**. There is nothing to pick wrongly.
- That builder **checks its own answer** before sending it:
  - no tax lines;
  - every price exactly equals the price our menu push gave Leafly, to the cent;
  - the lines add up to the total.

  If that check ever fails because of some future edit, the shopper's cart is
  echoed back unchanged (still tax-inclusive, still no tax lines) instead of
  showing a wrong price.
- Tests scan the code and fail if anything outside the pricing module ever
  mentions the tax-exclusive option.

### Proof

- 98 self-checks (was 73).
- 20 end-to-end tests. They use the real menu builder, the real price lookup
  and the real webhook, all over one test menu that includes prices like
  $14.996, to prove both sides round the same way.
- One of those tests sends a stale $34.18 (the old pre-tax number for a $50
  eighth). The preview corrects it to $50.00.
- 21 of 21 deliberate sabotages were caught.

---

## Nothing for you to do

Neither slice needs a setting changed or a key re-entered.

If you ever change the Leafly store's tax setting away from "tax included in
menu", tell us first. This code is deliberately locked to that setting.

## What is left

| Slice | What |
|---|---|
| L-45 | Check that `orderIntegrationKey` on every order equals your Dispensary Menu Key (Ben, item 2). |
| L-46 | Answer every webhook inside Leafly's 9-second budget (Ben, item 4). This is the most operationally important one: a slow answer is a failed delivery, and orders auto-cancel at 15 minutes. |
| L-47 | Certification "prove every action" evidence panel. |
