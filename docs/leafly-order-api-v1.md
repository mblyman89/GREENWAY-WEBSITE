# Leafly Order API v1.0 — what it is, and the one rule that is invisible in code

> **Why this document exists.** Slice L-1 found that `docs/leafly-menu-api-v2.md` contained a
> single false sentence — "camelCase convention for all fields" — and that **eight** field-level
> defects descended from it. A markdown file cannot fail CI, which is exactly how it rotted for
> months. So this document does not hold the contract. The contract lives in
> `src/lib/leafly/order-contract-core.ts` as constants, asserted against Leafly's vendored spec
> by `tests/compliance/leafly-order-contract.test.ts`. This file is the explanation; the code is
> the truth.

**Ground truth:** `docs/leafly-specs/order-api-v1.openapi.json` (OpenAPI 3.1.0, `info.version`
`1.0`). Provenance, URLs and md5 checksums: `docs/leafly-specs/SOURCES.md`.

---

## 1. The shape of the thing

The Order API is two halves, and it is worth being precise about which direction each one
travels, because the names are confusingly similar.

**Leafly calls us** — six webhooks. Leafly's own `EventType` enum names them
`order_activate`, `order_deactivate`, `order_submit`, `order_preview`, `order_cancel`,
`order_status`. These are the URLs Ben Scott asked for. The owner approved one route per event
(Q2), served at `/api/webhooks/leafly/order-<event>` on `greenwaywebsite1.vercel.app` (Q1).

**We call Leafly** — six REST endpoints, all rooted at
`https://reservations-api-sandbox.leafly.io/v1/order_integration` in sandbox and
`https://reservations-api.leafly.com/v1/order_integration` in production. Note the sandbox is
on `leafly.io` and production is on `leafly.com`; these are different top-level domains, and a
fat-fingered constant would point a test at real customer orders. The operations are
`getOrder`, `getGovernmentId`, `getMedicalId`, `acknowledgeOrder`, `updateOrder` (status), and
`updateCartItems`.

Of the six webhooks, only `order_submit` and `order_cancel` are marked **Required** for
production graduation. `order_preview` and `order_status` are Recommended; the two
activation webhooks are Optional. We are building all six (owner, Q3), but the distinction
matters when something breaks at 9am: a dead `order_submit` blocks certification and loses
orders, a dead `order_activate` does not.

`order_preview` is the odd one out in a way that is easy to get wrong. It is the **only**
webhook that must answer with a populated JSON body — Leafly calls it mid-checkout to ask "is
this cart still valid at these prices?", and our reply becomes what the shopper sees. Every
other webhook answers `200` with an empty body.

## 2. Three traps that are not obvious from the endpoint list

**Never answer a webhook with a 4xx.** The spec is explicit: "Unless Leafly's outbound HMAC
keys fails your validation, webhook requests should only be responded to with status codes 200
or 201. These webhook events are not the place to apply business rules or validations on the
order lifecycle." The instinct — a cart line looks wrong, so reject the request — is actively
harmful here. Leafly retries, then auto-cancels the customer's order. Business complaints
belong in the order record and the staff alert, not in the HTTP status.

**Fetch the ID images BEFORE acknowledging.** "Media associated with an order (e.g.,
government and medical id images) are only accessible before order acknowledgement and when
the order is in pending status." There is also a fifteen-minute clock: an order not
acknowledged within fifteen minutes of the submission webhook is **auto-cancelled**. The two
rules pull in opposite directions. Acknowledge first to beat the clock and the ID images are
gone forever; fetch first and be slow and the order dies. They must happen in the same handler,
media first, and the acknowledgement must be done by the *system* on receipt — never by a
budtender noticing a screen.

**Flipping the integration on makes Leafly's dashboard read-only.** Leafly documents this for
every POS partner it publishes a guide for. Cova's guide states: "once you enable the Cova
order integration, your Leafly order dashboard will become read-only. While the order
integration is active, order fulfillment will take place within Cova." The Dutchie guide says
the same. Greenway becomes the source of truth for order status and cart totals, and the manual
fallback disappears. This is why the webhooks cannot ship half-built.

## 3. Question 6, explained properly

The owner asked: *"I'm not sure, please explain this one more for me, I don't understand what
you are asking… What is the professional industry standard. What would Cultivera or the other
pos providers doing with regard to this question."* This section is the answer.

### 3.1 What I was actually asking

Greenway's website already sends order emails. When a customer orders on
`greenwaymarijuana.com`, two emails go out: one to the **customer** ("we got your order") and
one to **staff** ("an order came in, go pack it"). That machinery exists and works today
(`src/lib/orders/notify-*`).

Leafly orders are different, because they do not start on our website. A shopper browses
`leafly.com`, adds to cart there, and checks out there. **Leafly already emails them.** The
question is what *our* system should do when that order lands in our software — and it is not
one question but two, because there are two audiences:

- Should Greenway email the **customer**? Leafly has already done it.
- Should Greenway email the **staff**? Leafly has no way to; that alert is ours or nobody's.

Answering "yes" to both looks harmless and is not. Answering "no" to both is worse.

### 3.2 Leafly's answer is a rule, not a preference

Leafly does not leave this to integrator taste. From `info.description` of the Order API spec,
verbatim:

> "Leafly will be the sole originator of automated consumer facing communications related to
> orders placed on the Leafly platform. That is, Leafly shoppers should receive _no_ automated
> emails or text messages from a partner system with regard to order confirmation, status
> updates, etc."

Note the exact words: **"consumer facing"** and **"from a partner system"**. Greenway's
software is the partner system. The rule covers the customer and says nothing about staff.
That is not a loophole — it is the scope of the rule, and it is the whole reason the
suppression in our code is audience-scoped rather than a blanket switch.

Why Leafly cares: they own the shopper relationship for orders placed on their platform, and a
second confirmation from us is not a harmless duplicate. The two messages are generated at
different moments from different state — ours at webhook receipt, Leafly's at its own status
change — so they can disagree. The concrete failure is a customer who gets "your order is
ready" from Greenway before the bag is actually packed, drives over, and waits. The brand
damage lands on both companies and the confused customer calls whoever emailed last.

### 3.3 What Cultivera does

The owner asked specifically about Cultivera. This is worth stating plainly, because the answer
is not "Cultivera does X" — it is that **Cultivera does not do this at all.**

Cultivera's own support library documents exactly one Leafly integration: *"POS -
Administration: Integrations — Leafly Online Menu."* It covers pasting a Leafly API key,
right-clicking products to "List On Leafly", and category mapping. It notes that "Product
edits, additions, and removals from the Leafly menu update every 20 minutes. There are full
menu updates every 24 hours." That is a **menu** integration — one-way, product data outbound.
There is no Cultivera order-integration article, and Leafly publishes no Cultivera Order
Integration Guide (it publishes them for Cova, Dutchie, Treez, Sweed and Greenline). Cultivera
has a Weedmaps *online ordering* integration guide but not a Leafly one.

So the honest answer to "what would Cultivera do" is: **under Cultivera, Leafly orders never
reach the POS.** They sit in the Leafly Biz order dashboard and a human works them there,
which is why the Leafly dashboard is read-write in that configuration. Leafly emails the
customer; staff get alerted by Leafly Biz's own notification settings; the POS is not in the
loop. What Greenway is building in slices L-5 and L-6 is a capability Cultivera does not have —
which also means there is no Cultivera behaviour to copy, and no Cultivera precedent to hide
behind if we get it wrong.

### 3.4 What the POS providers that DO have order integrations do

Every one of them lands in the same place, and the pattern is consistent enough to call it the
industry standard.

**POSaBIT** — a Washington company, Seattle-based, so the closest analogue to Greenway's
situation. Their support article on accepting a Leafly order is unambiguous about who emails
the customer: *"Once the Accept button has been clicked, the customer will automatically
receive a email from Leafly, letting them know their order has been received."* The POS does
not send it. The POS changes a status, and **Leafly** sends the message. Meanwhile POSaBIT's
own contribution is a loud in-POS staff alert — "online order notifications pinned in the top
left corner of every screen of the POS, you'll never miss or forget to fulfill an order
again!" That is precisely the split: consumer messaging is Leafly's, staff alerting is the
POS's.

**Dutchie** — the most instructive case, because Dutchie runs two completely different
products and treats them oppositely. In **Dutchie E-Commerce** (Dutchie's own storefront,
where Dutchie is the originator), Dutchie sends the customer everything: order-status emails
for Submitted, Confirmed, Ready for Pickup and Out for Delivery, plus SMS and push, from
`noreply@dutchie.com`. But in the **Leafly order integration**, Dutchie sends the customer
nothing. Leafly's Dutchie guide describes the mechanism: the "Notify" button "changes the order
status in Dutchie to 'fulfilled' which notifies Leafly of the status change **for customer
notification** that the order is either ready for pickup or en route if delivery." Dutchie's
job is to report status to Leafly; Leafly's job is to tell the customer. Same vendor, same
customer, opposite behaviour — decided entirely by who owns the storefront.

**Cova** — the order guide walks through toggling the integration on, then covers "Order
Notifications" by linking to *Leafly's* article on enabling email notifications. The ordering
flow describes moving the cart through "Order Placed, In Progress, Ready for Pickup" and then
"Confirm & Tender". The only customer-facing email Cova originates is the **receipt** at the
point of sale, after payment: "Customers can have their receipt emailed or printed." A receipt
for a completed transaction is not an order-status notification, and nothing in the Cova flow
emails the customer about order progress.

And the "email notifications" in Leafly Biz that all these guides link to? They are **staff**
notifications, not customer ones. Leafly's own article is explicit: you "select the 'add
employee' button", "input the email address of the recipient who will receive order
notifications", and tick "New Order". It ends with "For detailed order information and to
process the order, please go to your Order Dashboard." Those emails go to employees. This is
easy to misread as "Leafly lets you email customers" and it is the opposite.

One more useful data point on why nobody in this industry leans on SMS: Leafly's own article on
text notifications says it "does not currently support native text message order
notifications" and warns that "since cannabis is illegal on the federal level and the federal
government regulates carriers, carriers are prohibiting cannabis-related messaging content,
and now cannabis-related companies." Cannabis SMS deliverability is genuinely unreliable. That
is a good independent reason not to build a parallel customer-messaging path we cannot verify
was delivered.

### 3.5 The decision, and why it is safe

**Greenway suppresses only the customer email, only for Leafly-origin orders, and always sends
the staff alert.**

That is `mayEmailAudienceForOrderOrigin()` in `src/lib/leafly/order-contract-core.ts`:

| order origin | customer email | staff email |
| --- | --- | --- |
| `greenway` (our own storefront) | **sent** — we are the originator | sent |
| `leafly` | **suppressed** — Leafly already sent it | sent |
| `uberEats` (arrives via the same API) | **suppressed** | sent |

Three properties of this design are deliberate and each one is tested:

The staff alert survives. Leafly does not notify Greenway staff through our system, and there
is a fifteen-minute auto-cancel clock on every order. Silencing the staff alert to be safe
about the Leafly rule would trade a compliance problem for a lost-order problem.

Our own storefront is untouched. This is the regression that would be easiest to ship and
hardest to notice: a blanket "stop sending order confirmation emails" would silence
`greenwaymarijuana.com` too, and nobody would find out until a customer complained that they
never got a confirmation. There is a test whose only job is to assert
`mayEmailAudienceForOrderOrigin("greenway", "customer") === true`.

UberEats is covered by the same rule. UberEats orders arrive through the same Leafly Order API
and are consumer-facing Leafly-platform orders. They also, per the spec, carry **"No email
address"** at all — so there is literally nobody to write to.

The suppression records a reason rather than failing silently.
`notify-outcome-core.ts` already treats `"skipped"` as a normal, quiet state, which is correct —
but a skip with no explanation is indistinguishable from a broken `RESEND_API_KEY` when
somebody is reading logs at 2am. So the skip carries
`"suppressed: Leafly is the sole originator of consumer order communications"`.

**If this ever needs revisiting**, it will be because Leafly changed the rule. That is why the
test asserts the sentence is still present in the vendored spec: re-downloading the spec after
a Leafly revision turns the test red, and the decision gets made deliberately instead of by
accident.

## 4. Lifecycle notes for slices L-5 and L-6

Leafly's `OrderStatus` enum is `pending`, `confirmed`, `ready`, `out_for_delivery`,
`arrived_at_customer`, `picked_up`, `canceled`, `expired`. Two of those we may never set:
"Pending and expired are valid statuses but are not valid values for the status update
endpoint." Both belong to Leafly — `pending` is the pre-acknowledgement state, and `expired` is
what Leafly sets when we blow the fifteen-minute deadline.

We also cannot shortcut the lifecycle. The spec: "Order status updates correspond to an
intuitive, smoothly progressing lifecycle. Not all statuses are required… but for example,
supporting only direct movement to `picked_up` would not be allowed." Production graduation
requires moving orders end to end for both terminal states (`picked_up`, `canceled`) and both
fulfillment mechanisms (`pickup`, `delivery`).

Authentication is HMAC over the request body, and it has to be, because "Dynamic request
metadata is not supported" — no custom or dynamic IDs, params, or HTTP headers. A shared
secret in a query string is not an option. Retailers are distinguished by
`orderIntegrationKey`, not by hostname: "Unique per-retailer URL domains are not supported."

One Greenway-specific note. Leafly's `MedicalStatus` enum allows `medical`, but Greenway is
**not yet DOH-endorsed** (owner, Q5: "we carry doh products, but we have not been certified
yet… we will only have regular non medical sales at the start"). A `medical` order is therefore
not fulfillable here today. It must be surfaced to staff, not silently accepted — and per rule
3, never silently invented away.

## 5. Sources

- `docs/leafly-specs/order-api-v1.openapi.json` — Leafly Order API v1.0, OpenAPI 3.1.0. All
  quoted requirements above are from `info.description` unless noted.
- Leafly Help Center, "Cova Order Integration Guide" — read-only dashboard; notifications
  handled via Leafly; receipt emailed at tender.
- Leafly Help Center, "Dutchie POS Ordering Integration Guide" — the "Notify" button reports
  status to Leafly "for customer notification".
- Leafly Help Center, "Enabling Email Notifications for Online Orders" — the Leafly Biz
  notification emails go to *employees*.
- Leafly Help Center, "Enabling Text Message Notifications for Leafly Online Orders" — no
  native SMS; carrier-level restrictions on cannabis messaging.
- Dutchie Help Center, "Order status notifications in Dutchie E-Commerce" — what Dutchie sends
  when Dutchie owns the storefront (`noreply@dutchie.com`).
- Dutchie Help Center, "Leafly + Dutchie POS integration guide" — menu field mapping.
- POSaBIT Support, "Accepting a New Leafly Online Order" — "the customer will automatically
  receive a email from Leafly"; in-POS staff notifications.
- Cultivera Support Library, "POS - Administration: Integrations — Leafly Online Menu" — menu
  integration only; no order integration exists.
