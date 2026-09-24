# SLICE L-33 — ESTABLISHED FACTS (gathered before any code was written)

Spec: `docs/leafly-specs/order-api-v1.openapi.json`, md5
`daab7bcf6f77177de85425adf7f805f1` — re-verified unchanged at the start of this
slice. Every quote below is from that file. Nothing here is inferred.

---

## A1/A2 — DOES LEAFLY PERMIT AUTOMATED ACKNOWLEDGEMENT?

**Yes — and the spec's own wording assigns the job to a system, not a person.**

From `info.description`, section "Expectations":

> "Orders are acknowledged as having been retrieved in whole **by your system**
> within fifteen minutes of receiving an order submission webhook. Any orders
> not acknowledged by this deadline will be auto canceled."

The subject of the sentence is *your system*. The operation itself
(`acknowledgeOrder`) takes **no body, no actor, no staff id, and no
confirmation parameter** — there is nothing in the request that could even
express "a human pressed this". Leafly cannot distinguish an automated
acknowledgement from a manual one, because the API has no field in which the
difference could be stated.

Requiring a human to press it within fifteen minutes was **our** design choice,
never Leafly's requirement. This is the same discovery as L-30, where the
confirmation dialog turned out to be ours rather than Leafly's.

## A3 — WHAT ACKNOWLEDGEMENT DESTROYS

From the `acknowledgeOrder` description:

> "This endpoint confirms that your system has retrieved all necessary details
> regarding an order, including any associated media (e.g., government and
> medical id images)"
> - "Once an order has been acknowledged, access to an order's associated media
>   is revoked."

And from "Limitations":

> "Media associated with an order (e.g., government and medical id images) are
> only accessible before order acknowledgement and when the order is in pending
> status."

**We do not store these images.** `src/app/api/admin/leafly-id-image/route.ts`
relays them live from Leafly to an `<img>` and states plainly: *"Nothing is
written to disk."* So acknowledgement permanently destroys our only access.

### THE OWNER'S RULING — this is NOT a blocker

I raised this as the one hard blocker. The owner answered it directly, and it is
a **business fact about how the store operates that could not be derived from
any source code or specification**:

> "The destroys id issue isn't a problem, Leafly states that an id is required
> to purchase in store anyways, at least that's the message I see in the details
> when I look at past orders. So the point is, this isn't an issue. The id will
> be checked at the counter, scanned in fact. So don't worry about the id issue,
> it's not an issue."

This is decisive and it is recorded as HIS ruling, not as my finding. The store
already scans a physical ID at the counter (the POS has a dedicated ID-scan
path — `src/lib/pos/id-scan-core.ts`, with its own compliance tests). The Leafly
image was therefore a **duplicate** of a check that happens anyway, at the
moment that actually matters legally: handover.

Searching the spec for shopper-facing in-store ID wording returns nothing — that
text lives in Leafly's consumer UI, which is where the owner saw it. Recorded as
his observation of the product, not as a specification quote, because it is not
one.

**Consequence for this slice: NO MEDIA GATE IS BUILT.** Planned section C2 is
deliberately deleted rather than quietly dropped. Building a gate the owner
ruled unnecessary would have delayed every order by an invented precondition.

## A4 — THE DEADLINE IS GIVEN TO US, NOT COMPUTED

The `order_submit` webhook carries **`acknowledgeBy`** — Leafly's own deadline —
and `0225_leafly_order_webhooks.sql` already stores it verbatim in
`leafly_orders.acknowledge_by`. The existing route comments the rule:

> "The deadline is STORED AS LEAFLY SENT IT and never recomputed locally as
> 'now + 15 minutes'. Our clock and theirs will differ, and any error we
> introduce lands in the direction that loses a real customer's order."

So the auto-acknowledger never needs to know the number fifteen. It is told.

## A5 — THE L-14 COUPLING (what the owner has forbidden)

`acknowledgeLeaflyOrder()` in `order-ack-server.ts` pushes `status=confirmed`
immediately after a successful acknowledgement, inside a try/catch that is never
allowed to fail the acknowledgement. The block is titled *"SLICE L-14: TELL
LEAFLY WE ARE MAKING IT"* and its stated justification is:

> "WHY HERE: this is the point where a HUMAN pressed Accept. That is the
> business decision, and it is the moment the order becomes floor-visible."

**That justification evaporates the moment acknowledgement is automatic.**
Nobody pressed anything. Under auto-acknowledge the coupling would have the
machine make the store's business decision — confirming orders the store has not
looked at, at 3am, while closed.

The owner ruled on this before I could raise it:

> "It can't be acknowledge and confirm in the same step though. Just auto
> acknowledge."

**L-33 severs the coupling.** Note the happy consequence: that coupling is the
exact origin of the L-32 stale row — the comment on line ~615 literally says
*"THIS LINE IS WHERE THE STALE ROW IS BORN"*. Removing it removes the source of
the 400 rather than only handling it.

## A6 — HOW ORDERS ARRIVE, AND WHAT ALREADY HAPPENS

`order_submit` webhook → `handleLeaflyWebhook()` in `webhook-server.ts`:

1. Upserts the row, storing `acknowledge_by` exactly as sent.
2. `collectLeaflyOrder()` — fetches the REAL order (submit carries only
   metadata: no cart, no customer, no totals).
3. `onLeaflyOrderArrived()` — **announces over the speaker and prints the
   ticket**, idempotently, guarded by `announced_at` / `printed_at` which are
   stamped BEFORE the side effect so a crash cannot double-print.
4. `maybeSendLeaflyStaffAlert({ stage: "arrival" })` — silent unless the bell
   AND the paper both failed.

### THEREFORE: TWO OF THE OWNER'S FOUR ASKS ALREADY EXIST

He asked for: auto-acknowledge · print a receipt · make noise · then confirm
when ready.

**Printing and noise were built in L-28 and already fire on arrival.** They are
not rebuilt here. Rebuilding them would have produced a second printer path and
a second chime — the double-print the existing idempotency guard exists to
prevent.

The genuine gap is **one step: the acknowledge itself**, which this slice adds
immediately after collection succeeds, in the same webhook, before the bridge.

---

## B1 — THE INTERACTION NOBODY ASKED ABOUT

This is the finding that would have silently broken the board, and it was not in
the owner's request.

L-32 (shipped last slice) treats **"acknowledged AND still pending"** as a
*contradictory* state — proof that the confirm push was lost — and replaces every
button with "Check this order with Leafly":

```ts
const currentStatus = (input.leaflyStatus ?? "").trim();
if (currentStatus === "pending") { return { actions: [reconcile], ... }; }
```

**After L-33 that state becomes the NORMAL, CORRECT, INTENDED resting state of
every single order.** Auto-acknowledged, deliberately not confirmed, waiting for
a human. The rule was written when the only way to be acknowledged-and-pending
was a failure.

Left alone, the board would offer "Check this order with Leafly" on *every*
arriving order and offer the Confirm button on *none* — replacing the owner's
normal workflow with a diagnostic for a failure that did not occur. The feature
would have shipped green and broken the thing he actually does all day.

**The fix must distinguish the two states by RECORDED FACT, not by inference.**
"Acknowledged + pending" can no longer tell them apart, because it is now both.
The honest discriminator is whether a confirm push was *attempted and failed* —
which the outbound attempt ledger already records. Never guessed.

---

## B5 — THE SECOND BOARD INTERACTION, AND WHY IT IS *NOT* A DEFECT

B1 was found by executing the planner. The same question had to be asked of the
*other* two screens that read the same two columns, because auto-acknowledge
changes `acknowledged_at` for every order and both of them branch on it. Asking
was not optional: assuming "the planner was the only reader" is exactly the kind
of guess the standing rules forbid.

### `placeLeaflyOrder()` — which bucket the card sits in

Executed, not read (`scripts/recon/l33-bucket-probe.mts`):

```
BEFORE L-33: fresh, unacknowledged
  bucket : accept_now     "Accept this order now, before Leafly cancels it."

AFTER  L-33: auto-ack, pending, local order CREATED
  bucket : to_build       "Pick and bag this order, then mark it ready."

AFTER  L-33: auto-ack, pending, NO local order
  bucket : needs_attention
  action : "Accepted at Leafly but it never reached the register..."
  warn   : "No register order was created for this..."
```

**The `accept_now` bucket empties out.** That is not a bug — it is precisely
what the owner asked for. He no longer has to run to the office to press
Accept, so no order should ever be sitting in a bucket whose entire purpose is
to shout that a human must press Accept before Leafly cancels. The countdown
bucket exists to prevent an auto-cancel; auto-acknowledge prevents the
auto-cancel directly, at the source.

**The third row is the one that matters**, and it is the reason the local-order
creation must stay coupled to acknowledgement. `onLeaflyOrderAccepted()` runs
*inside* `acknowledgeLeaflyOrder()` and creates the register order. It sits
BEFORE the L-14 confirm block, so the Slice L-33 gate (`if (actor === "human")`)
does **not** touch it — verified by `git diff -w`, which shows the gate opening
immediately after the bridge's closing brace. Auto-acknowledge therefore still
creates the register order, and the healthy result is the SECOND row,
`to_build`, not the third.

Had the gate been placed one block earlier, every auto-acknowledged order would
have landed in `needs_attention` with "it never reached the register" — a board
full of red warnings about a failure that never happened. The exact placement of
that one `if` is load-bearing, which is why it is asserted by test rather than
left to the next reader's care.

### `lifecycleView()` — the "what do I do next" strip

Executed:

```
AFTER : auto-acked, pending
  phase   : in_progress
  headline: "Accepted here, but Leafly has not been told you are making it yet."
  next    : Confirm order -> confirmed
  progress: 0.25
  steps   : Accepted=done | Confirmed=current | Ready=todo | Picked up=todo
```

**This already describes Slice L-33 exactly, and it was written before it.**
L-31 separated "what is LEGAL" from "what is NEXT", and in doing so it modelled
acknowledged-but-not-confirmed as a legitimate waypoint with its own honest
sentence. Nothing here needs changing. It is recorded because *verifying that a
thing already works is a result*, and because a future reader who changes that
headline needs to know an entire feature depends on it.

`STEP_CUSTOMER_EFFECT.acknowledged` is `null` — the acknowledgement sends the
shopper nothing — which independently corroborates the owner's premise:

> "Since an email doesn't go to the customer after pressing acknowledge,
>  messages start getting sent after that step."

He is right, and the codebase already said so in a comment written for a
different slice. The first customer-visible message is `confirmed`, which
remains a deliberate human act.

### Consequence for the build

Three readers of `acknowledged_at` were examined. **One needed fixing** (the
planner, B1). **Two were already correct** (`placeLeaflyOrder`, `lifecycleView`)
and were deliberately left alone. Changing either would have been an unforced
regression dressed up as thoroughness.
