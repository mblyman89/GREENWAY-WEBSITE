# L-25 — THE ACKNOWLEDGE HANG, THIRD ATTEMPT, AND THE BLANK ORDER DETAIL

Working investigation log. Everything here is MEASURED, not assumed. Where a
claim came from a probe, the probe's output is quoted.

---

## 1. WHAT WAS ALREADY TRIED, AND WHY IT DID NOT WORK

| Slice | Diagnosis | Fix shipped | Result |
|---|---|---|---|
| L-17 | Every Leafly fetch was unbounded | `leaflyFetchWithDeadline` — bounds the CONNECTION | hang persisted |
| L-23 | The deadline covered headers, not the BODY | body read moved inside the budget | hang persisted |

Both diagnoses were CORRECT and both fixes are genuinely load-bearing. They
were simply not the whole cause. Re-diagnosing "unbounded fetch" a third time
would be repeating work that is already done.

---

## 2. WHAT THE RECON ELIMINATED (so nobody re-treads it)

A static import-graph probe (`scripts/recon/import-graph-fetch.mjs`) walked
every module reachable from both entry points and reported every bare `fetch(`:

```
ENTRY: src/app/admin/orders/leafly-actions.ts
modules reached: 52
modules containing a bare fetch(): 1
  depth  3  BOUNDED   x1  src/lib/leafly/deadline-fetch.ts

ENTRY: src/app/admin/orders/page.tsx
modules reached: 210
modules containing a bare fetch(): 2
  depth  1  UNBOUNDED  x1  src/components/admin/orders/NewOrderAlert.tsx  (client component — browser, not render)
  depth  5  BOUNDED   x1  src/lib/leafly/deadline-fetch.ts
```

ELIMINATED:
- The redirect target `/admin/orders` does **not** make an outbound Leafly
  call during render. `describeLeaflyReadinessAsync()` — the prime suspect —
  is `refreshLeaflyConfig()` + synchronous getters. DB only.
- The acknowledge path has exactly ONE network surface and it is bounded.
- Base URLs match the vendored spec's `servers` block exactly, for both the
  acknowledge host and the fetch host.
- Token URLs are right, including the sandbox host `sso-sandbox.leafly.io`
  which appears only in the spec's prose, not in its `tokenUrl` field.

---

## 3. THE OWNER'S NEW REPORT — AND WHAT IT PROVES

> "when I open an order, everything is completely blank. There is no info at
>  all. Is this why we can't acknowledge an order? Are we not getting the
>  proper data from Leafly to acknowledge in the first place?"

He is reading the evidence correctly.

### The measurement

`scripts/recon/blank-detail-probe.ts` runs the **spec's own** `order_submit`
webhook body through the **real production** `readOrderDetail`:

```
=== readOrderDetail(order_submit webhook) ===
  BLANK  leaflyOrderId = null
  BLANK  status = null
  ... (all 18)
BLANK FIELDS: 18 / 18

=== readLeaflyOrderPayload (the receipt / local-order builder) ===
  {"ok":false,"reason":"the stored Leafly payload has no order id"}

=== CONTROL: readOrderDetail(real Order payload) ===
  customerName = "Jane Doe"
  lines        = 1
  total        = 4803
```

The reader is NOT broken — the control proves it parses a real Order fine.

### What that means

`leafly_orders.raw_order` is written TWICE in an order's life:

1. `upsertLeaflyOrderFromWebhook()` stores the **five-field** submission
   webhook (`eventTime`, `eventType`, `orderId`, `orderIntegrationKey`,
   `acknowledgeBy`). No cart. No customer. No totals.
2. `collectLeaflyOrder()` performs `GET /{key}/orders/{id}` and **overwrites**
   `raw_order` with the real Order payload.

A completely blank detail view is therefore *positive evidence that step 2
never succeeded* for the orders he is looking at.

### Why this matters far beyond a cosmetic blank screen

Leafly's rule, verbatim from the spec:

> "Orders are acknowledged as having been retrieved **in whole** by your
>  system within fifteen minutes of receiving an order submission webhook."

If the GET failed, we never retrieved the order in whole — so pressing
acknowledge asserts something untrue to a third party, destroys our access to
the customer's ID images, and leaves staff with no cart to build from.

---

## 4. THE REMAINING UNBOUNDED SURFACE — THE DATABASE

Every Leafly *network* call is bounded. **Not one database call is.**

`createSupabaseAdminClient()` builds a plain client with no timeout, and
`abortSignal()` — which postgrest-js has supported all along —

```
node_modules/@supabase/postgrest-js/dist/index.d.cts:1389:  abortSignal(signal: AbortSignal): this;
```

appears **zero times** anywhere in `src/`.

### Proven against a real socket

`scripts/recon/supabase-hang-probe.mjs` stands up a real `node:http` server
that accepts the connection and then answers nothing — which is what a
saturated connection pooler looks like from the outside — and runs the exact
query shape `getIntegrationCredentialsRow()` uses:

```
[probe] black-hole server on http://127.0.0.1:44687

[probe 1] UNBOUNDED (today's code): after 8006ms settled=false -> STILL HANGING

[probe 2] BOUNDED (abortSignal 1500ms): after 1505ms -> returned an error value:
          TimeoutError: The operation was aborted due to timeout
```

Two facts established, neither of them guessed:

1. Today's code hangs **indefinitely** on a black-holed database connection.
   On Vercel it hangs until the platform kills the function — "about five
   minutes", which is precisely what the owner keeps reporting.
2. `abortSignal` bounds it, and crucially returns the timeout as an **error
   value** rather than throwing. Every existing `if (error)` branch therefore
   handles it already; no call site has to learn a new failure mode.

Inventory of blocking awaits for ONE acknowledge click:

```
 1. requirePermission             DB   UNBOUNDED
 2. getLeaflyBoardOrder           DB   UNBOUNDED
 3. acknowledgeLeaflyOrder:
    3a. refreshLeaflyConfig       DB   UNBOUNDED   (credentials row, read 1)
    3b. loadLeaflyOrderIntegrationKey DB UNBOUNDED (same row, read 2)
    3c. getLeaflyAccessToken      NET  8s   BOUNDED
    3d. POST acknowledge          NET  12s  BOUNDED  (x2 on 401 => +8s mint)
    3e. markLeaflyOrderAcknowledged DB UNBOUNDED
    3f. onLeaflyOrderAccepted     DB   UNBOUNDED  (load + insert order + lines + events + link)
    3g. setLeaflyOrderStatus("confirmed")   <-- NESTED. Doubles the network budget.
        - refreshLeaflyConfig     DB   UNBOUNDED   (read 3)
        - loadLeaflyOrderIntegrationKey DB UNBOUNDED (read 4)
        - getLeaflyAccessToken    NET  8s
        - POST status             NET  12s (x2 => +8s)
        - recordAttempt           DB   UNBOUNDED
    3h. recordAttempt             DB   UNBOUNDED
 4. recordAudit                   DB   UNBOUNDED
 5. revalidatePath + redirect -> /admin/orders renders ~10 MORE DB reads
```

**NETWORK worst case = 2*(12+8) + 2*(12+8) = 80 seconds.**

Note that `worstCaseMs("acknowledge")` returns 40s, because it models one
operation. The real click runs acknowledge AND a nested status push, so the
operator's true network worst case is double what the core advertises.

**DATABASE worst case = unbounded.** That is the hole L-17 and L-23 never
covered, and it is the only remaining way to reach the platform's 300s kill —
which is exactly the "about 5 minutes" the owner keeps reporting.

---

## 5. THE PLATFORM CEILING

`/admin/orders/page.tsx` declares `dynamic = "force-dynamic"` but **no
`maxDuration`**. Ten other routes in the repo set it explicitly (60 or 300).
Because `useFormStatus().pending` stays true until the navigation *resolves* —
which includes rendering the redirect target — a slow `/admin/orders` render
keeps the button spinning even after a perfectly successful acknowledge.

---

## 6. CONCLUSIONS DRIVING THE FIX

1. The acknowledge path's **database** calls must be bounded, exactly as its
   network calls already are.
2. The action needs **one overall deadline** so it can never outlive the
   platform's limit; whatever happens, the operator must get a sentence.
3. The redirect target needs an explicit `maxDuration`.
4. A blank detail must **say** it is blank and why, and offer to collect the
   order now — never render as an empty form.
5. Acknowledging an order whose payload we never retrieved contradicts
   Leafly's own "in whole" requirement and must be surfaced.

---

## 7. THE THIRD DEFECT, FOUND BY A CONTROL ASSERTION: MONEY

This one was not on the list. It was found because a test written from the
authoritative spec disagreed with the code, and the disagreement was
investigated instead of edited away.

While building the regression test for the blank detail screen, a CONTROL was
needed: a **real** Leafly order that parses correctly, to prove the reader was
innocent of the blankness and that the blankness came from the stored webhook
envelope. That control was written from
`docs/leafly-specs/order-api-v1.openapi.json`. It expected a $48.03 order to
report `totalMinorUnits === 4803`. It got **480300**.

One of the two was wrong, and money is not a thing to settle by argument, so
`scripts/recon/detail-money-probe.ts` settled it against the vendored spec and
against `order-fetch-core`, which reads the *same* payload with `intOrNull`
and takes the values as given. The detail reader was the outlier.

### What the spec actually says

    Order.subtotal            "order total before taxes and fees in minor units"
    Order.total               "order grand total in minor units, ..."
    Order.deliveryFee         "order delivery fee in minor units..."
    Order.totalDiscounts      "total of discounts applied to the order in minor units"
    TaxComponent.amountCents  "tax amount in minor units"
    CartItemOutgoing.priceCents / .discountedPriceCents / .packagePrice
                              "...in minor units"

Every money field on an Order is **already cents**. And `Order.taxes` is not a
number at all: it resolves to `Taxes`, an **array** of `TaxComponent`
"broken out by tax type".

### What the operator was shown, measured

    Subtotal: $4,000.00   (truth: $40.00)
    Taxes:    —           (truth: $8.03)
    Total:    $4,803.00   (truth: $48.03)
    Line:     —           (truth: $40.00)

Four defects on the one screen a staff member reads before handing a bag to a
customer inside a fifteen-minute window. A total wrong by 100x is not
cosmetic: it is the figure somebody reconciles a till against.

### Why 17,716 passing tests never noticed

Because the fixture was **invented rather than derived**. It sent
`subtotal: 40, taxes: 14.8, total: 54.8` and cart items keyed `totalPrice` /
`total`. None of those is a real Leafly shape — `CartItemOutgoing` has no
`totalPrice`, no `total` and no `price` at all. The fixture asserted dollars,
so the reader was built to convert dollars, and the suite went green over a
screen that was wrong by a factor of a hundred.

**A fixture is an authority claim.** This one was never checked against the
spec it claimed to model. That is the real lesson of this defect, and it is
why `tests/compliance/leafly-l25-order-money-units.test.ts` asserts against
the vendored spec file *read at run time*, including Leafly's own published
example order, so the expectations cannot drift back into fiction.

### The fix

`readMinorUnits()` (takes integers as given, refuses fractions rather than
rounding them) and `readTaxesMinorUnits()` (sums `amountCents`, distinguishes
a missing array from an empty one, refuses to understate a tax when one
component is unreadable). `toMinorUnits` is **retained unchanged** — it is the
correct reader for decimal currency and is cross-validated against
`reportMoneyToMinor`; it was simply pointed at a payload with no decimals in
it.

---

## 8. THE 30 "UNBOUNDED" QUERIES ON THE CLICK PATH — RESOLVED

`scripts/recon/db-call-inventory.mjs` walks the **import** graph and reports
30 unbounded queries reachable from the acknowledge action. The number is
alarming and also misleading, so it was traced rather than trusted.

They live in the announcer and printer stores, reached because
`order-ack-server` dynamically imports `bridge-server`, which imports both at
module scope. An import graph cannot tell which *function* pulls them in.

Traced per function:

    onLeaflyOrderArrived   announce=true  print=true    <- the WEBHOOK path
    onLeaflyOrderAccepted  announce=false print=false   <- the CLICK path
    onLeaflyOrderCanceled  announce=false print=false

The acknowledge button calls `onLeaflyOrderAccepted`. Announcing and printing
happen when an order **arrives**, so somebody walks over and sees it — not
when it is accepted. **No unbounded query runs on the click.**

Pinned permanently in section 7 of `leafly-l25-db-deadline.test.ts`, with a
CONTROL asserting the arrival path *does* still announce and print (otherwise
the guard would pass just as happily if announcing were deleted outright).

---

## 9. "TEST THE TESTS" — MUTATION RESULTS

`scripts/recon/l25-mutation-probe.mjs`. Every mutant reverted from an
in-memory copy of the original bytes, with a final byte-for-byte
restoration check.

    killed: 10   survived: 1 (the CONTROL)   total: 11

    KILLED  subtotal is scaled again (the 100x defect returns)
    KILLED  total is scaled again ($48.03 -> $4,803.00)
    KILLED  the taxes array is read as a scalar again
    KILLED  cart line prices read the ghost keys again
    KILLED  readMinorUnits silently rounds a fraction
    KILLED  a missing taxes array reports $0.00 instead of unknown
    KILLED  one unreadable tax component is skipped
    KILLED  a fired deadline is no longer recognised by name
    KILLED  isDbDeadlineError always says yes
    KILLED  THE ROOT CAUSE: the credentials read loses its deadline
    SURVIVED (required) CONTROL — a comment is reworded

Three further mutants against the section-7 invariants, run separately:

    KILLED  an unbounded query added to the accept path
    KILLED  announce added to the accept path
    KILLED  a deadline removed from the accept path

The CONTROL surviving is what makes the other results meaningful: a harness
that reports "all killed" is otherwise indistinguishable from one that edits
the wrong file or runs no tests.

---

## 10. A LANDMINE LEFT FOR THE NEXT PERSON (DELIBERATELY NOT DEFUSED)

Bounding the media read broke `tests/compliance/leafly-id-image-runtime.test.ts`
— **13 failures, all in the mock, none in the code**. Its fake Supabase
builder had no `abortSignal`, so the real chain threw "abortSignal is not a
function", the route's catch turned it into a 502, and assertions expecting
200/409 failed. A hand-rolled fake is a claim about the real client's
interface, and that fake had always been a lie; it had simply never been
caught out.

Nine other test files mock a Supabase client with no `abortSignal`:

    announcer-enqueue-safety, bank-expense-service-books-door,
    blocked-stock-fix-links, cockpit-comparisons-and-refunds,
    deposit-clearing, register-availability, restore-to-sale,
    slice5a-recall-gate-runtime, transaction-history

They are green today only because the queries on *their* paths are not bounded
yet. **The moment anyone adds a deadline to those paths, those suites will
fail in the mock and the failure will look like a code bug.** They were left
untouched because this slice's sole purpose was the acknowledge hang, and
editing nine unrelated suites would have been scope the owner did not ask for.
Adding `abortSignal: () => builder` to the fake is the whole fix.

---

## 11. THE BUILD FAILURE THIS SLICE CAUSED, AND WHY NO LOCAL GATE SAW IT

The first L-25 push failed Vercel. Worth recording in full, because the
mistake was made in good faith, was invisible to every gate available
locally, and would be easy to repeat.

### The error

```
The export loadLeaflyOrderDetailAction was not found in module
  [project]/src/app/admin/orders/leafly-actions.ts [app-rsc] (ecmascript).
The module has no exports at all.
Export setLeaflyOrderStatusAction doesn't exist in target module
```

Import traces named `LeaflyOrdersPanel.tsx` -> `page.tsx`, and also the
financial-statements page. So the orders board **and** an unrelated accounting
page both went down.

### The cause

This, added to bound the acknowledge action:

```ts
export const maxDuration = 300;   // in a "use server" file
```

A file carrying the `"use server"` directive may export **async functions and
nothing else**. The non-function export was not ignored — it invalidated the
**entire module**, which is why the error is "no exports at all" rather than
anything mentioning `maxDuration`. Every server action in the file vanished
at once.

### Where the ceiling actually belongs

On the route segment. Next.js documents it plainly:

> Server Actions inherit the Route Segment Config from the page or layout they
> are used on, including fields like `maxDuration`.

`src/app/admin/orders/page.tsx` already declared `maxDuration = 300`, so
**nothing was lost by removing it from the action file** — the ceiling was
already in the only place that works. The page-level declaration also matters
independently: with a real `<form>`, `useFormStatus().pending` stays true
until the navigation resolves, which includes rendering the redirect target,
so the board's render time is part of how long the button spins.

### Why every local gate missed it

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| pure self-tests | all passed |
| vitest (17,720) | all passed |
| CI `compliance` job | **passed** |
| CI `build` job (`next build`) | **FAILED in 1m8s** |

The rule is enforced by the **Next.js bundler and by nothing else**. It is not
a type error and not a lint rule. And this repo cannot run `next build`
locally — it OOMs — so CI was the first place it could possibly surface.

### The fix, and the guard

The export was removed and replaced with a comment explaining where the
ceiling lives and why. Then the *test* was fixed, because it had asserted the
**opposite** of the truth: it demanded `export const maxDuration` in the
action file, so it was actively enforcing the bug. It now asserts the action
file does **not** carry it, and a second test walks **all of `src/`** and
fails if any `"use server"` file exports a non-function — the general form of
the mistake, since `revalidate` and `dynamic` are equally tempting to put next
to the code they govern.

Mutation-checked by reintroducing the exact breaking line:

```
MUTANT (reintroduce the exact Vercel-breaking export): KILLED (as required)
```

Verified against the real bundler by running `next build` in the background
and reading the log:

```
✓ Compiled successfully in 78s
grep -c "has no exports at all"      -> 0
grep -c "was not found in module"    -> 0
```

The build later dies with `SIGKILL` during `Running TypeScript` — that is the
sandbox running out of memory in a stage CI has the headroom for, and
`tsc --noEmit` already covers it. The **bundler stage that failed on Vercel
now passes.**

### The lesson

The compliance job passing is not the same as the build passing. For anything
touching a route segment, a server action, or module-level exports in
`src/app/`, the only authority is `next build`, and it can be run here in the
background even though it cannot finish: reaching
`✓ Compiled successfully` is enough to clear this entire class of failure.

---

# SLICE L-26 — the fourth attempt, and the half of the work nobody had bounded

> *"its still not letting me acknowledge the order... because it doesnt stop
> spinning, i am unable to record an error message."*

Three shipped fixes, three times the spinner came back:

| slice | what it bounded | result |
|-------|-----------------|--------|
| L-17  | the outbound fetch **connection** | hang persisted |
| L-23  | the response **body** read | hang persisted |
| L-25  | every **database call on the action path** | hang persisted |

Every one of them was correct. Every one of them bounded the same half of the
work, because every one of them assumed the spinner was waiting on the
**action**.

## 1. What the spinner is actually waiting for

From the Next.js documentation, verbatim:

> "When a Server Action triggers an immediate revalidation, Next.js does the
> work inside one HTTP request: it runs the action, then re-renders the
> current route server-side."

> "Calls `redirect`. The response navigates the router and streams the
> destination's RSC Payload."

> "The mutation, the cache invalidation, and the page re-render all complete
> in a single roundtrip."

`acknowledgeLeaflyOrderAction` calls **both** `revalidatePath("/admin/orders")`
**and** `redirect(...)`. So the one HTTP response the browser is waiting on
contains the acknowledge **plus a complete server render of `/admin/orders`**.

`useFormStatus().pending` clears when **that response** completes — not when
the acknowledge completes.

**The spinner is the render.** And the render was entirely unbounded.

`scripts/recon/db-call-inventory.mjs`, run against `main@28e9b22c`, put a
number on it. Every module the ACTION reaches: bounded by L-25. Every module
the PAGE RENDER reaches: unbounded.

```
announcer-store           12 unbounded queries
printer-store             13
orders-store              30
announcer-sounds-store    11
order-name-pool-store     11
announcer-admin-store      6
order-readiness-server     3   <-- a Leafly file L-25 missed: it is on the
                                   PAGE path, not the action path
```

This is why the acknowledge itself always "worked". It did. The order was
acknowledged in the database. The browser just never got told, because the
render that had to finish first never finished.

## 2. The fix that would have been the fourth failure

The plan was a global floor composed with `AbortSignal.any([...])`, so a
per-client deadline could combine with any caller's own shorter signal.

A probe was written to prove it worked before shipping it. It proved the
opposite (`scripts/recon/l26-signal-gc.mjs`, run with `--expose-gc`):

```
[G1 any(), no gc           ] TimeoutError after 904ms
[G2 any(), FORCED GC       ] HUNG (>6000ms)   <-- DEADLINE NEVER FIRED
[G3 any(), sources pinned  ] TimeoutError after 901ms
[G4 bare timeout, FORCED GC] TimeoutError after 900ms
[G5 bare timeout, pinned   ] TimeoutError after 900ms
```

`AbortSignal.any()` holds its source signals **weakly**. Once a GC cycle
collects the sources, their timers never fire and the composite can never
abort. Confirmed upstream, not inferred:

- `nodejs/node#57736` — "AbortSignal.any() is unreliable and breaks timeouts",
  label `confirmed-bug`, PR #57867
- `nodejs/node#55428` — "Request signal isn't aborted after garbage
  collection", label `confirmed-bug`, still open

A timeout that works until the garbage collector runs is the **worst possible
shape** for this particular bug: it passes every test, passes code review,
passes a smoke test, and then hangs in production under memory pressure —
which is precisely the report, four times over.

It is now banned by a test, with a CONTROL proving the detector works.

## 3. The mechanism that was shipped instead

supabase-js's own `db: { timeout }` option. postgrest-js implements it with a
plain `AbortController` + `setTimeout` (`dist/index.mjs:4888`) — **not**
`AbortSignal.any` — and a pending `setTimeout` is a **GC root**, so it cannot
be collected out from under the request.

Proven end-to-end against a real black-hole socket
(`scripts/recon/l26-db-timeout-proof.mjs`):

```
[P1 CONTROL no timeout   ] HUNG (>9000ms)
[P2 timeout 1200         ] settled after 1205ms -> "AbortError: This operation was aborted"
[P3 timeout + FORCED GC  ] survived GC, settled after 1202ms
[P4 floor 30s + query 800] settled after 802ms   <-- the tighter deadline wins
[P5 error channel        ] arrives as an ERROR VALUE, not a throw
[P6 healthy query        ] settled after 8ms -> data intact
```

P4 is what makes this safe to apply globally: it **bridges** a caller's own
signal rather than replacing it, so L-25's tighter per-operation budgets keep
winning. P5 is what makes it cheap: a timeout arrives through the ordinary
`{ data, error }` channel, so all ~300 existing `if (error)` branches handle it
unmodified. P6 is the control — healthy queries are untouched.

Installed in **both** client factories, because missing either leaves a whole
class of queries unbounded:

- `src/lib/supabase/admin.ts` — the service-role client, used by every store
- `src/lib/supabase/server.ts` — the cookie-bound client, which resolves the
  staff session on every render **and** every action

## 4. Why the floor alone is not enough

The floor caps **one request**. It does not cap a **sum**. Several page
readers are internally sequential — `loadLeaflyOrderSetupState` alone awaits
two full `Promise.all` passes — and not everything on the render path is even
PostgREST (storage, `auth.getUser()`).

So `withRenderBudget` (`src/lib/supabase/render-budget.ts`) caps each
**secondary** reader and degrades it to an empty state rather than letting it
hold the render open.

**The primary readers are deliberately NOT wrapped.** `listOrdersPaged` and
`getOrderStatusCounts` **are** this page. A board rendered with no orders and
no counts is not a degraded board, it is a **lie** — it would tell a shop with
live orders that there is nothing to do, on a screen with a fifteen-minute
acknowledgement clock. Those two are allowed to fail loudly. This is pinned by
a test in both directions.

### The fallbacks are not allowed to invent facts

A fallback is shown to the owner as if it were fact, so it may say only what
we actually know.

The sharp case is the announcer. `summarizeShop` checks `devices.length === 0`
**before** it checks `globalEnabled`, and returns the fixed headline *"No
speakers are set up yet."* with the fix *"Press 'Add a speaker' to pair your
first Raspberry Pi."* For a genuinely empty shop that is true. For a shop
whose speakers we merely **failed to read in time**, it is a fabrication that
would send the owner to set up hardware they already own. So
`emptyAnnouncerPanelData()` hand-builds a verdict that names the real cause,
and reuses `FALLBACK_SETTINGS` rather than inventing `enabled: false` — which
would draw the visible "Announce new orders" toggle OFF and describe a setting
the owner never chose.

Same rule for the Leafly board: its degraded `problem` string is deliberately
**non-empty**, because an empty `problem` renders as a calm "no Leafly orders
yet" — the single most expensive wrong sentence this page can produce.

## 5. Testing the tests

`tests/compliance/leafly-l26-render-deadline.test.ts` — 30 tests, all green.

Because a green suite is exactly what the previous three failures also had,
the suite itself was put under test. `scripts/recon/l26-mutation-test.mjs`
applies twelve **realistic** regressions to production source, requires the
suite to go RED for each, then restores the file and verifies the restore by
SHA-256 hash:

```
baseline: GREEN
M1  remove the db floor from the admin client            caught
M2  remove the db floor from the server client           caught
M3  make the render budget infinite                      caught
M4  withRenderBudget stops guarding and just awaits      caught
M5  drop the label from the timeout log                  caught
M6  unwrap the announcer reader on the orders page       caught
M7  announcer fallback claims the shop has no speakers   caught
M8  announcer fallback claims a missing migration        caught
M9  reintroduce AbortSignal.any                          caught
M10 hard-code the floor instead of sharing the constant  caught
M11 wrap a PRIMARY reader, faking an empty board         caught
M12 Leafly setup fallback discards the problem text      caught

caught: 12/12   survived: 0/12
```

Two of this file's own tests failed on first run — and both were the **test's**
bug, not the code's:

1. `LEAFLY_DB_TIMEOUT_MS` is a `Record`, not a number, so the comparison was
   `number > object`. Now takes `Math.max(...Object.values(...))`, which also
   means a slower operation added later must push the floor rather than
   silently slipping under a stale literal.
2. `spy.mockRestore()` clears `mock.calls`, so reading the log **after**
   restoring always yielded `""` — an assertion that could never fail. Now
   read inside the `try`, before the `finally` restores.

Both are worth recording: they are the exact shape of a test that looks green
and proves nothing.

## 6. Three pre-existing compliance tests had to move

Not weakened — **re-aimed at the invariant they actually protect**:

- `leafly-l14-register-interrupt` asserted `await listInterruptsForOrders(`
  exactly once. The call is now wrapped, so the `await` sits on the wrapper.
  What the test protects is the number of **call sites**, so it now matches
  the call itself. A test that it stays **bounded** was added alongside it.
- `announcer-admin` counted `pendingPairings: []` and required exactly `1`.
  There are now two legitimate empty states. Raised to `2`, and — since that
  assertion counts empty states and would not notice the live path being
  deleted — a companion assertion pins the single `await getPendingPairings(`.
- `orders-board-order` forbids re-typing the promotion sentence in the page.
  This was a **real violation on my part**: the new Leafly fallback string had
  re-used "waiting to be acknowledged", which belongs to the core that owns
  the singular/plural and the deadline. The rule is right; the **string was
  reworded**.

## 7. The lesson

Three slices bounded the action because the action was the plausible suspect,
and nobody asked what the browser was actually waiting on. The answer was in
the framework's own documentation the whole time: with `revalidatePath` plus
`redirect`, **the render is part of the response**, so the render is part of
the spinner.

And the near-miss is worth as much as the fix: the intended solution was
disproven by measurement **before** it shipped. Had it gone out, it would have
passed every test and failed in production under GC pressure — a fourth
correct-looking fix for the same bug.

---

# CHAPTER SIX — SLICE L-27: THE HOLE UNDERNEATH THE FLOOR

## The report that finally located it

> "I tested the acknowledge button again after placing an order. it spun for
> 5 minutes then quit. it is still not working. I dont understand how this is
> so difficult. everything else about leafly connections and communications
> works and did not require this much effort to fix it."

The frustration is earned. This is the fifth attempt. But the report contains
one detail none of the previous four had, and it is the detail that solved it:
**five minutes, then quit.**

Previously the button "sat waiting forever". Now it terminates — at a specific,
reproducible time. Five minutes is not a number this codebase picks anywhere.
It is `export const maxDuration = 300` on `src/app/admin/orders/page.tsx`: the
platform's own killer.

## What that one number ruled out

The acknowledge path is held to three deadlines:

| Deadline | Value | Added |
|---|---|---|
| `LEAFLY_ACK_TOTAL_BUDGET_MS` | 240s | L-25 |
| `DB_REQUEST_FLOOR_MS` | 15s | L-26 |
| `RENDER_READER_BUDGET_MS` | 20s | L-26 |
| `maxDuration` (platform) | **300s** | — |

If any of ours had fired, the operator would have seen a sentence at 240s at
the very latest. He saw a dead page at 300s. **Not one of our three deadlines
fired.** So the blocking work was somewhere all three are blind to — and the
job was no longer "bound the database", it was "find what is not a database
query".

## Where it was

The first statement of `acknowledgeLeaflyOrderAction`:

```ts
const session = await requirePermission("orders.manage");
```

which reaches `getStaffSession()`, whose first await is:

```ts
const { data: { user } } = await supabase.auth.getUser();
```

Two properties had to hold simultaneously for this to survive four fixes:

**1. It is not a PostgREST request.** L-26's floor is a PostgREST option.
Reading `@supabase/supabase-js/dist/index.mjs`:

- line 684 — `timeout: settings.db.timeout` → handed to `PostgrestClient`
- line 813 — `_initSupabaseAuthClient(...)` → **never receives it**

and `@supabase/auth-js/dist/module/lib/fetch.js` line 109 performs the request
as `await fetcher(url, Object.assign({}, requestParams))`. There is no `signal`
anywhere in that file. The auth client has never had a timeout of any kind.

**2. It runs before the backstop.** L-25's 240s race is armed on the line
*after* the permission check. Work that hangs inside `requirePermission`
happens before the race exists, so the race cannot lose — it is never started.
L-25's comment promised a backstop that "does not depend on the enumeration
being complete". It was right about everything downstream of itself, and the
gap was upstream.

Together: a click blocks on an unbounded socket, no deadline is armed, and the
platform kills the function at 300s having rendered nothing. Exactly the
report.

## The measurement (`scripts/recon/l27-auth-hang-probe.mjs`)

Never assume. Against a local black-hole server that accepts the connection and
answers nothing for 25 seconds:

```
P1  PostgREST, db.timeout = 15000 ........ 15005ms  AbortError   BOUNDED
P2  auth.getUser(), SAME client .......... 25009ms  resolved     UNBOUNDED
P3  auth.getUser(), global.fetch bounded ..  8002ms  AbortError   BOUNDED
```

P1 and P2 use the **same client with the same options**. The only difference is
which sub-client serves the call. That is the entire bug, measured. P3 is the
fix, measured.

## Is there community support on this? (the owner asked directly)

Yes — and it describes our symptom almost word for word.

- **supabase/supabase#35754**, labelled `bug`: *"Client-side
  `supabase.auth.getUser()` hangs indefinitely"*. Next.js App Router, deployed
  to Vercel. Their diagnosis used the same instrument we did: *"We've confirmed
  this hang by wrapping the getUser() call in a Promise.race with a 10-second
  timeout, which consistently logs a timeout error for this specific call."*
- **supabase/supabase-js#2111**, labelled `bug` + `auth-js`: *"auth methods
  hang indefinitely due to orphaned Web Locks"*. Its first stated expectation:
  *"Auth methods should complete or fail within a reasonable timeout, not hang
  indefinitely."*

Neither is fixed upstream. Every thread converges on the same remedy: bound the
transport yourself, because the library will not.

On the Leafly side, the **POS Order Integration Connection Issue Hub**
(help.leafly.com, updated Apr 2026) is the relevant authoritative page. It
documents Partner Outages and Credential Issues, and confirms the operational
fallback: *"During an outage or credential issue, orders may not appear in your
POS system, so you'll need to monitor and manage them in the Leafly Order
Dashboard until the problem is resolved."* Leafly's developer FAQ category is
gated behind a Salesforce partner login. Nothing in Leafly's public material
describes an acknowledge endpoint that hangs — consistent with our finding that
the fault was never on Leafly's side at all, which is also why "everything else
about Leafly works": every other Leafly path is a background job or a cron,
none of which sit behind a per-request auth check the way a button press does.

## The fix

`src/lib/supabase/fetch-floor.ts` — a bounded `global.fetch`, installed on all
three Supabase factories (`admin.ts`, `server.ts`, `middleware.ts`).

`global.fetch` is the one seam every sub-client funnels through: auth,
PostgREST, Storage, Functions. Bounding it bounds all of them at once,
including sub-clients that do not exist yet. A `Promise.race` around
`getStaffSession()` would have fixed the orders page and left everything else
exposed — and "the enumeration was incomplete" is precisely the mistake that
made L-17, L-23, L-25 and L-26 each look complete and each fall short.

The floor is **20s**, chosen to sit above every tighter deadline (so those keep
winning, which is intended) and far below the platform ceiling (so a stall
still leaves room to render a sentence).

Signals are composed **by hand** with `addEventListener("abort", …)`, mirroring
what postgrest-js itself does for `db.timeout`. `AbortSignal.any()` remains
banned: nodejs/node#57736 and #55428, both `confirmed-bug`, hold source signals
weakly, so after GC the timer never fires — it would have silently recreated
this exact bug.

## Two consequences that had to be handled

A bound converts a hang into a **throw**, and an unhandled throw is a worse
outage than a slow page.

1. **Middleware** — `auth.getUser()` there now `.catch(() => undefined)`. An
   unhandled rejection in middleware fails every `/admin/*` request, turning a
   slow auth server into a total blackout of the back office. Swallowing is
   correct because that call only refreshes the cookie opportunistically; it is
   not a guard. Access is enforced downstream by `requireStaff()`.

2. **`getStaffSession()`** — wrapped in `try/catch`. The signature deliberately
   did **not** change. Widening it to
   `StaffSession | null | { unavailable: true }` was considered and rejected on
   security grounds: there are 26 call sites and the dominant shape is
   `if (session) { …allow… }`. A returned object is truthy, so widening would
   have silently flipped every one of those guards to ALLOW during an auth
   outage — converting an availability bug into an authentication bypass across
   the entire back office, with the compiler catching none of the sites that
   only test truthiness. The failure therefore stays `null`: fail closed,
   exactly as before. The distinction travels out of band via
   `authCheckUnavailable()`, backed by a request-scoped React `cache()` box (a
   module-level `let` would leak one operator's outage onto another operator's
   screen on the same warm instance), and is consumed **only** by the login
   screen for explanation — never by a guard.

## What the operator sees now

Instead of a five-minute spinner ending in a dead page, an auth stall produces
a redirect to the sign-in screen carrying a true sentence: that the failure is
ours and not their password, and — critically — that if they were mid-acknowledge
they should check the board before pressing Accept again. An acknowledge whose
outcome we never learned is the one state where a second press is genuinely
dangerous, because acknowledgement permanently revokes access to the shopper's
ID images.

## Verification

- `tsc --noEmit` — 0 errors
- `tests/compliance/leafly-l27-auth-fetch-floor.test.ts` — 27 tests, all green;
  behaviour is exercised against an injected fetch rather than asserted on the
  shape of a config object
- `scripts/recon/l27-mutation-test.mjs` — 12 realistic mutations, **12/12
  caught, 0 survived**

The sweep earned its keep: on the first run, mutation 12 ("login page stops
explaining, blaming the operator's password") **SURVIVED**, because the test
only checked that the identifier `authCheckUnavailable` appeared somewhere in
the file. Replacing the call with a hard-coded `false` passed. The test was
tightened to pin the call itself and the branch it drives, and the sweep then
came back 12/12. That is a hole that would otherwise have shipped.

---

# CHAPTER SEVEN — SLICE L-28: THE NINTH ORDER

## The report

The owner placed a real order, saw the back office react to it, and could not
find it on the board:

> "I placed a new order, the back office is aware of it, but it is not in the
> list. there are currently 9 orders in total, 8 of which have expired, one is
> still pending. but I cannot see the 9th order, maybe the ui doesnt allow for
> more than 8?"

He asked a precise question — *is this a new bug, or the UI not allowed to
display more than 8?* — and the honest answer is that he had found the number
but not the mechanism. It was a bug, and the number 8 was the fingerprint.

## What was actually wrong

`order-board-server.ts` declared `LEAFLY_BOARD_LIMIT = 8`. The board built
itself from two queries. The first asked for orders still needing
acknowledgement, and its only filter was:

    .is("acknowledged_at", null)

That filter is wrong, and it is wrong in a way that is easy to read past for
months. **An expired order is never acknowledged — that is precisely why it
expired.** Nothing in the codebase stamps `acknowledged_at` on expiry:
`webhook-server.ts` stamps `canceled_at` on cancellation, and `acknowledged_at`
is written only when a human accepts an order or the bridge does it for them.

So every one of the eight dead orders permanently satisfied "not yet
acknowledged". The sort made it fatal:

    .order("acknowledge_by", { ascending: true, nullsFirst: true })

Oldest deadline first. The expired orders had the oldest deadlines *by
definition*, so they sorted to the very top and filled all eight slots.
`remaining` then computed to `8 - 8 = 0`, and the second query — the one that
would have shown anything else — never ran at all.

The failure therefore pointed in the worst possible direction. It did not clip
an arbitrary order off the end of a list. It clipped **the only order that
still needed a human**, and it did so reliably, every time, getting worse with
each order that expired.

## The safety net had the same blind spot

The old comment above the constant claimed a clipped list was "never silent",
because the count of everything outstanding was reported separately. That was
true of the mechanism and false of the outcome, because
`countLeaflyOrdersAwaitingAck` used the *same* filter. It counted the eight
dead orders too, and announced **"9 awaiting acknowledgement"** above a list in
which the live one was the missing one.

That is worse than no badge. The operator was told the order existed, shown a
list that refused to contain it, and left to conclude the screen was broken.
A guard that shares the blind spot of the thing it guards is not a guard.

## Proven by execution, not by reading

`scripts/recon/l28-board-overflow-probe.mjs` reconstructs his exact stated
board — nine orders, eight expired, one live — and replays it through a model
of the two real queries. The model is pinned to the source file: it reads
`LEAFLY_BOARD_LIMIT` out of the code and asserts the filter and sort clauses
still exist, so it fails loudly rather than "proving" something about code that
has since changed.

    TODAY — what the board actually returns:
       LFY-1001  expired #1
       ... (eight expired orders) ...
       (acked query got 0 leftover slots, so it NEVER RAN)

       Rows returned ............. 8
       Live order visible? ....... NO  <-- THE BUG
       "Awaiting acknowledgement" badge says: 9

    WITH THE FIX:
       LFY-1009  >>> THE NEW LIVE ORDER <<<
       Live order visible? ....... YES
       "Awaiting acknowledgement" badge says: 1  (matches the list)

## The fix, in three parts

**1. Terminal orders are not pending.** Both the list query and the count now
exclude cancelled and terminal-status orders. The vocabulary is not re-decided
here — `TERMINAL_STATUSES` is asserted in CI to be identical to
`BRIDGE_TERMINAL_STATUSES` in `bridge-core.ts`, so the query and the UI cannot
drift apart about what "over" means.

**2. The cap went from 8 to 200.** Excluding dead orders fixes the inversion;
it does not fix the clipping. Nine genuinely live orders on a busy Friday would
have clipped the newest again — and that time the badge would have been right
and the board still wrong. Not unbounded, because an unbounded select against a
forever-growing table is how a fast page becomes slow in two years.

**3. A third query, for the orders that died unacknowledged.** This one exists
because the first two would otherwise have opened a hole. After the new filter,
an expired-but-never-acknowledged order matched *neither* query — so the
owner's eight expired orders would not have moved to the bottom of his board,
they would have disappeared from it. He asked to **hide** finished orders, not
lose them. Hiding is a view decision and belongs in the UI where he can switch
it back on.

## The UI he asked for

> "I would like to upgrade the panel to hide the finished orders exposing only
> the open ones. there would need to be a filter and sort feature added to it
> as well so its easy to find an order if needed."

`board-view-core.ts` is a pure module — no database, no `server-only` — so
every decision about what is visible is provable in CI. It provides five
filters (Open, Needs accepting, Needs attention, Finished, All), three sorts
(most urgent, newest, oldest) and a substring search over both the Leafly and
local order ids, because staff quote whichever one is in front of them and
usually only the last few characters.

The controls are a plain GET form rather than a client component. The view
therefore lives in the URL: it survives the redirect after an acknowledge, it
survives a refresh, it can be bookmarked or sent to another member of staff,
and it works with scripting disabled on a tablet in battery-saver mode.

## The rule that outranks the request

A filter that can hide an order needing acknowledgement is the bug we just
fixed, rebuilt deliberately in the user interface. Leafly auto-cancels after
fifteen minutes, so "the operator could not see it" costs a real customer a
real order.

So the core enforces one invariant no filter choice may override:

**NEVER SILENTLY HIDE A LIVE ORDER.**

`hiddenLiveCount` reports how many orders needing a human fall outside the
current view, and the panel is required to render a warning whenever it is
non-zero. The count is measured against the **final** visible set, not merely
the bucket filter, because a search term hides orders just as effectively as a
filter does. The operator may choose a narrow view; he may not be kept ignorant
of what it is costing him.

The empty states are similarly specific. "Nothing has arrived yet", "nothing
matches that search" and "nothing is open right now" are three different
situations with three different remedies, and collapsing them into one vague
"no orders" is the same category of mistake as the board that showed eight
expired orders and called it a day.

## Testing the tests

The first mutation sweep came back **14 of 16**. Two mutations survived, and
both were real holes in the suite rather than quirks of the harness:

- Deleting the `canceled_at` filter from the pending query left the tests
  green, because the assertion searched the whole file and an identical line
  survived in the closed-orders query further down.
- Deleting the terminal-status filter from the count function survived for the
  same reason: the slice ran from the function name to the end of the file and
  still caught text from a query above it.

Both assertions were making a claim about *one query* while testing the *whole
file*. They were rewritten to slice out the specific function body, bounded on
both sides. The re-run came back **16 of 16, zero survivors**.

That is the second slice running in which mutation testing caught a hole that
a green suite had hidden. The lesson generalises: a source assertion must be
scoped to the construct it is making a claim about, or it degrades into
"this string appears somewhere in this file", which is not the claim.

## Testing the probe

The compliance suite was not the only thing that needed testing. The probe had
two defects of its own, and both were found by running the same treatment
against it — mutate the source, check that the probe notices.

**The first was a fuse that blows on success.** The original probe read every
number out of `order-board-server.ts`, including the board limit, and used
those values for *both* the "before" and the "after" model. That looks like
the rigorous choice. It is the opposite. The moment the fix landed and the
source said `200`, the "before" model silently became the "after" model, the
bug could no longer be reproduced, and the probe exited `1` with *"harness did
not reproduce the reported symptom — do not ship a fix on the strength of this
run."* The fix was correct and the probe was calling it unproven.

The rule that falls out of it:

> A **before** model must be pinned to **history**, which is frozen.
> An **after** model must be pinned to **source**, which moves.

So `BROKEN_LIMIT = 8` and the old single-filter pending query are now
hard-coded constants describing code that no longer exists, while the fixed
model is still read from and asserted against the live file. A reproduction
harness has to keep reproducing the original bug *after* the fix ships, or it
stops being a regression guard the day it is needed.

**The second was the whole-file scoping mistake again, in a new file.** With
the probe rebuilt, eight mutations were applied to the server to check that it
noticed. Seven were caught. One survived: deleting `.is("canceled_at", null)`
from the pending query left the probe printing *"PROVEN ABOVE BY EXECUTION."*
The pin searched the entire file, and the identical line in
`countLeaflyOrdersAwaitingAck` satisfied it.

This is the same defect, in the same slice, for the same reason — and it had
already been written up in the section above. Knowing the lesson did not
prevent repeating it, because the pins were written before the lesson was
learned and were never revisited in light of it. The probe now uses a
`bodyBetween(start, end)` helper identical in spirit to the suite's, and every
pin carries the scope it applies to: `PENDING_QUERY`, `CLOSED_QUERY`, or
`COUNT_FN`. Re-run: **8 of 8 caught, zero survivors.**

Worth stating plainly, because it is the more useful half: when a lesson is
learned mid-slice, the work already completed in that slice has to be audited
against it. Otherwise the write-up describes a standard the code does not meet.

---

# CHAPTER EIGHT — SLICE L-29: THE SPINNER THAT TIMED A HUMAN BEING

## The report

> "the acknowledge still spins forever, even longer than the 20 second limit
> and still isnt giving any errors or details why. is it the pop up dialog box
> that asks me to confirm the acknowledgement? am I clicking it too quickly? is
> this box even needed and causing problems. ... I click the acknowledge
> button, the pop up appears, the top of the page has the loading bar that
> spins forever, and I get the 'still working - big saves like finalizing a
> manifest can take awhile'. is this the problem? this pop up getting stuck?"

The screenshot settled it before a single file was opened. The confirmation
dialog is **still open and unanswered**, and above it the page reads *"Still
working — 120s."*

Nothing had been submitted. He had not answered the question yet. So what was
the page working on for two minutes?

Answer: **it was timing him reading the dialog.** It was counting his reading
time as server time.

## Defect one — capture runs before cancel

`PendingKeeper` listens for `submit` with `capture: true`, which it must, in
order to see every form in the back office from one place in the layout. But
the capture phase runs **before** the target's own bubble-phase handler, by
definition. That ordering is the whole bug.

`LeaflyOrderActions` is the only panel in the admin that *submits and then
cancels*: pressing Acknowledge fires a real submit, and its `onSubmit` calls
`preventDefault()` so it can open the confirmation instead. By the time that
cancellation happens, the keeper has already decided a save is in flight — bar
on, spinner on, and `form.dataset.gwBusy = "1"`.

Two consequences, and the second is the serious one:

1. A progress bar and a "Still working" banner for a request that does not
   exist. Because form saves carry the five-minute ceiling rather than the
   twenty-second one, the safety net never fired — hence *"spins forever, even
   longer than the 20 second limit."*
2. `gwBusy` was still `"1"` when he finally pressed **Acknowledge to Leafly**.
   The keeper's own double-submit guard swallowed the real submit with
   `stopPropagation()`. **The acknowledgement never left the browser.** That is
   the precise reason there was no error and no detail: there was no request to
   fail. Every previous slice had been hunting a hang on the wire; there was no
   wire.

Worth noting what this means about the earlier server-side work in this
document. The deadline fetch, the auth fetch floor, the bounded queries — all
of it was real and all of it was needed, but none of it could have fixed this,
because this request never reached any of it.

### Why only this button

Four other panels pair a `ConfirmDialog` with `requestSubmit()`: `SectionCard`,
`CarouselSlideCard`, `FaqItemCard`, `ContentBulkBar`. None of them are
affected, and the difference is one attribute. They open their dialog from a
`type="button"` with an `onClick`, so **no submit event is ever fired** and the
keeper never engages. Only the Leafly panel submits first and cancels second.
That is exactly why this was the one button in the whole back office that hung.

## Defect two — the one hiding behind the first

Fixing the keeper alone would have been a trap, and this is the part worth
remembering. Once the keeper stops swallowing the confirmed submit, that submit
finally reaches `ActionForm`'s own guard:

```
if (action.irreversible && !confirming) { e.preventDefault(); setConfirming(true); }
```

with

```
onConfirm={() => { setConfirming(false); Promise.resolve().then(() => requestSubmit()); }}
```

Read the order. The submit is allowed through only when `confirming` is
**true**, but `onConfirm` sets it to **false** and then submits. The whole
thing depends on React not having re-rendered yet — on the handler still being
the stale closure. The original comment says the microtask exists so React
"has applied `confirming: false`", which is the opposite of what makes the
guard pass; the code worked against its own stated reasoning.

React flushes discrete-event updates synchronously at the end of the handler,
i.e. **before** queued microtasks. `scripts/recon/l29-confirm-reentry-probe.mjs`
runs the logic under both orderings and they disagree:

```
CURRENT DESIGN (state flag through a render closure):
   React flushes before the microtask  -> submitted=0, dialog opened 2x
   React flushes after  the microtask  -> submitted=1, dialog opened 1x
```

Under the real ordering the acknowledgement is **never sent** and the dialog
**reopens**. Shipping only the keeper fix would have traded a phantom spinner
for a dialog that reopens forever — which, to the owner, is the same complaint
with a different animation. He would have been back within the hour.

The fix removes the timing dependency rather than betting on it: permission
lives in a `useRef`, granted before `requestSubmit()`, read live by the
handler, and consumed on use so a stray later submit has to ask again. Correct
under both orderings.

## Was the dialog the problem?

No, and it stays. He asked directly — *"is this box even needed and causing
problems"* — and the honest answer is that the dialog was the victim, not the
culprit. It is the only thing standing between a thumb and permanently losing
access to a customer's government ID. What made it *look* guilty is that the
longer he did the right thing and actually read it, the worse the symptom got.

And *"am I clicking it too quickly?"* — the opposite. Clicking fast would have
made it look better. Reading carefully ran the clock up. He was being punished
for being careful, which is the worst possible incentive to build into a
one-way door.

## Verification

- `scripts/recon/l29-phantom-submit-probe.mjs` — replays the click sequence
  against a DOM with real capture/bubble ordering, importing the real clearing
  rules. Reproduces the 120s phantom, the swallowed submit, and shows the fix
  resolving both.
- `scripts/recon/l29-confirm-reentry-probe.mjs` — runs the confirm guard under
  both React flush orderings and shows the state version disagreeing with
  itself while the ref version does not.
- `tests/compliance/leafly-l29-phantom-pending.test.ts` — 37 tests.
- `scripts/recon/l29-mutation-test.mjs` — 18 mutations, **18 caught, 0
  survived** on the first sweep. Both defects are pinned, including a mutation
  that reverts each one individually.

## The lesson

The generalisable one is not about React. It is this: **a UI that infers
"something is happening" from an event that has not finished happening yet
will eventually lie.** The keeper was guessing at capture time about an outcome
that is only knowable after propagation, when the browser itself will simply
tell you via `defaultPrevented`. The fix is to stop guessing and ask.

The second lesson is the one that nearly cost another round trip: **when a bug
is caused by something swallowing an event, fix it expecting to find another
bug directly behind it.** The swallow was load-bearing. It had been hiding a
broken confirm guard for as long as both have existed, and a suite that was
green throughout never noticed, because nothing ever got far enough to fail.

---

# CHAPTER NINE — L-30: THE ANSWER WAS "NO", AND THE TEST HARNESS WAS THE BUG

## The report

> *"that did not fix the problem. again, is it required by leafly to have this
> double click for acknowledging? if not, please get rid of it. the progress bar
> spins forever for it which means it spins forever after pressing confirm
> acknowledge. why is the pop up box getting stuck. I say just get rid of it.
> one click to acknowledge. why is this so difficult for you, I really dont
> understand."*

Five slices — L-17, L-23, L-25, L-27, L-29 — have each ended with a confident
claim that this button was fixed. Five times it was not. Chapter Eight closed
with a lesson ("stop guessing and ask the browser via `defaultPrevented`") that
this chapter has to retract, because it was wrong, and because the 37 tests that
certified it were structurally incapable of failing.

Start with the question he actually asked, because it has a real answer and
nobody had gone and looked.

## Is the confirmation dialog required by Leafly? No.

Answered from the vendored authoritative spec, `docs/leafly-specs/order-api-v1.openapi.json`,
re-downloaded live this slice and confirmed **byte-identical** to the copy in
the repo, md5 `daab7bcf6f77177de85425adf7f805f1`. Three facts, each read out of
the document rather than remembered:

**One.** The acknowledge operation is
`POST /{order_integration_key}/orders/{id}/acknowledge`. It has **no
`requestBody`**, **no operation-level parameters**, and its only path-level
parameters are `OrderIntegrationKey` and `OrderId` — the two values needed to
name the order. There is no confirmation token, no `confirmed=true` flag, no
two-phase handshake. There is nothing in the wire protocol that a second click
could possibly supply.

**Two.** The "Preparing for Production" requirements table lists:

    | Acknowledge Order | Endpoint | Successful requests | **_Required_** |

What is required is that the **endpoint gets called successfully**. The
requirement is about the HTTP request, not about how a human is asked to
authorise it. Leafly does not specify retailer UI at all.

**Three — and this is the one that turns the answer from "not required" to
"actively harmful".** From the Expectations section, verbatim:

> *"Orders are acknowledged as having been retrieved in whole by your system
> within fifteen minutes of receiving an order submission webhook. Any orders
> not acknowledged by this deadline will be auto canceled."*

Leafly imposes a **fifteen-minute deadline**, after which the customer's order
is **cancelled automatically**. A modal that inserts friction into the single
most time-critical action in the integration is not a safety feature. It is a
liability. The dialog was ours. We invented it, and it was working against the
one deadline Leafly actually enforces.

**So: removed. One click to acknowledge.**

The irreversibility warning was not deleted — it was *relocated*. It now renders
as a persistent `role="note"` line above the buttons (`data-testid="leafly-ack-warning"`),
so the operator reads it *before* deciding, instead of after committing. The
protection survives; the blocking step does not. Confirmation is still required
for the genuinely terminal status changes (`picked_up`, `canceled`), which have
no deadline and are true one-way doors.

## Why L-29's 37 green tests could never have caught this

This is the part that matters more than the fix, because it explains five
failed slices.

L-29's fix was: at capture time, queue a microtask; let propagation finish; if
the form cancelled the submit, `defaultPrevented` will be true and the microtask
declines to start the progress bar. Its tests drove this with
`element.dispatchEvent(new SubmitEvent(...))`, which is how essentially every
test in `tests/compliance` simulates a click.

Per the HTML spec, the **microtask checkpoint runs when the JavaScript execution
context stack becomes empty**. That single sentence is the whole bug:

- Under a **scripted `dispatchEvent()`**, the entire listener chain runs inside
  one synchronous call, in **one stack frame**. The stack does not empty until
  the last listener returns. So the queued microtask runs **after** every
  handler — exactly as L-29 assumed.
- Under a **real trusted click**, the browser dispatches from a task and invokes
  each listener as its own callback. **The stack empties between listeners.** So
  a microtask queued by the capture-phase listener runs **before** the form's
  own `onSubmit` ever gets a chance to cancel.

L-29's logic was correct in the world its tests lived in and wrong in the world
Michael lives in. No amount of additional assertions of the same shape would
ever have found it. The harness was the bug.

There was a second, independent fatal flaw in the same design. react-dom 19.2.4's
form-action plugin (`extractEvents$1`, ~line 12180 of
`react-dom-client.production.js`) calls `event.preventDefault()` **itself**, on
every *successful* server-action submit — that is the mechanism by which it
replaces the native form POST:

```js
} else
  "function" === typeof action &&
    (event.preventDefault(), ... startHostTransition(...))
```

So `defaultPrevented === true` means "the form cancelled to ask a question"
**and** it means "the submit worked perfectly". Chapter Eight's lesson — *"stop
guessing and ask the browser"* — asked the browser a question the browser cannot
answer. The signal is ambiguous by construction. It had to be abandoned, not
re-timed.

## Proven by execution, not by reading

`scripts/recon/l30-real-click-probe.mjs` bundles the **real** react-dom 19.2.4,
the **real** `pending-core.ts`, the **real** `PendingKeeper.tsx` and the **real**
`LeaflyOrderActions.tsx` with esbuild, and drives them in **real Chromium with
real trusted clicks** via Playwright. It counts server-action requests off the
wire.

The L-29 logic is not imported — it is **copied verbatim** into the probe as
`submitDidStart_L29_FROZEN`. That is the L-28 rule about "before" models: a
probe that imports the code it is modelling is a fuse that blows the moment you
fix the bug, and then tells you nothing.

Same page, same code, same click sequence. Only the dispatch mechanism differs:

| | scripted `dispatchEvent()` | **real trusted click** |
|---|---|---|
| bar shown while dialog open | `false` | **`true`** |
| microtask ran before `onSubmit` | `false` | **`true`** |
| `form.dataset.gwBusy` at confirm | `null` | **`"1"`** |
| **server action calls** | `1` | **`0`** |

**`serverActionCalls = 0`.** That number is the whole five-slice mystery,
finally measured instead of theorised. The acknowledgement **never left the
browser**. The phantom bar started while the dialog was still open, stamped the
form `gwBusy="1"`, and then the keeper's *own* double-submit guard swallowed the
real submit when Michael pressed Confirm. No request was ever made — which is
precisely why he watched a spinner forever and **never got an error**. There was
no failure to report. There was no request.

Every prior slice assumed something was slow. Nothing was slow. Nothing was
happening at all.

The same probe then runs the **live shipped source** under a real click:

    a dialog appeared .................. false
    progress bar running ............... true
    ACKNOWLEDGEMENTS SENT .............. 1

One click. One request. A bar that is spinning for something real.

## The fix

The ambiguous, timing-dependent predicate is deleted. `submitDidStart` is gone
from `pending-core.ts`, replaced by a rule whose every input is a **DOM fact**
that reads identically under a scripted dispatch and a real click:

```ts
export function submitShouldShowPending(s: SubmitStart): boolean {
  if (!s.serverAction) return false;
  if (!s.formConnected) return false;
  if (s.optedOut) return false;
  return true;
}
```

`PendingKeeper`'s submit path now decides **synchronously**, at capture time,
with no deferral and no reference to `defaultPrevented`. The file carries a
standing prohibition in its header saying so. (The *nav* listener still reads
`defaultPrevented`, and legitimately: it guards anchors, where the flag is
unambiguous. A test asserts that use is deliberate rather than an oversight.)

But a pure rule is only sound if the premise underneath it holds, and the
premise is structural:

> **NO FORM MAY SUBMIT IN ORDER TO ASK A QUESTION.**

That was the real defect, and it predates every slice in this document. A form
that fires `submit` and then cancels itself to open a modal is lying to every
listener in the page, including the browser's own. It is why five successive
attempts to *interpret* the submit event all failed — the event itself was
false. So `LeaflyOrderActions` no longer has an `onSubmit`, no
`preventDefault`, and no `confirmedRef`. Confirm-first actions render a
`type="button"` that opens the dialog directly; `onConfirm` calls
`formRef.current?.requestSubmit()`. A `submit` event now means a save is
happening, always, with no exceptions to interpret.

`SubmitButton` gained `type` (defaulting to `"submit"`) and `onClick`. The
default matters: these remain real forms that still work if the confirmation
JavaScript never hydrates.

## Testing the tests

- `tests/compliance/leafly-l30-one-click-acknowledge.test.ts` — **51 tests**,
  including the Leafly spec facts above pinned as executable assertions, the
  owner's screenshot pinned as history, and a test whose name is the lesson:
  *"the rule has no input that differs between a scripted and a real click."*
- `scripts/recon/l30-mutation-test.mjs` — **26 mutations, 26 caught, 0 survived,
  0 inert.** It detects no-op mutations and fails on them, so a mutation cannot
  be "caught" by accident. Mutation 19 is *"THE BIG ONE — the acknowledge
  confirmation dialog is put back."* Mutation 1 restores the L-29 microtask
  design. Mutation 20 restores submit-to-ask-a-question.
- `scripts/recon/l30-plain-form-regression-probe.mjs` — asks whether L-29 had
  silently disabled the bar for every ordinary admin save. It had not, but the
  probe is what produced the `preventDefault()` finding above.
- Full suite: **662 files, 17,877 tests, all green.** `tsc --noEmit` clean,
  eslint clean.

Three L-29 artefacts were **deleted**, not amended — the test file, both probes,
and the mutation script. They pinned a design that was wrong. Leaving them would
have preserved the belief that the microtask approach was sound.

One pre-existing test in `leafly-deadline.test.ts` failed correctly and was
re-aimed rather than relaxed: it counted `type="submit"` string literals to
prove every control disables while in flight, and `type` became a prop. It now
counts `type={type}` and additionally asserts the default is still `"submit"`.

## The lesson

Chapter Eight's lesson is **retracted**. It said the fix was to stop guessing and
ask the browser. The browser could not answer, and the way we asked only worked
in a simulator.

The replacement is harder and more useful:

**A test that simulates the user is not testing the user.** Scripted
`dispatchEvent()` and a real click differ in a way the HTML spec guarantees —
when the stack empties, and therefore when microtasks run. Any logic whose
correctness depends on event timing is, by construction, untestable by the
harness we use everywhere. L-29 scored 18/18 on its mutation sweep while being
completely broken, because **a mutation sweep measures whether tests pin the
code, not whether the code is correct.** Pinning is not proof.

The corollary, and the standing rule going forward: when behaviour depends on
*when* something runs rather than *what* it computes, the assertion must be
produced by **execution in a real browser**, counting real effects — here,
requests on the wire. And the surest fix is to remove the timing dependence
altogether, so that the pure rule has no input that can differ between the two
worlds.

The last lesson is the cheapest one, and it is the one that would have saved
five slices: **the owner asked a direct question — "is this required?" — and
the answer was written down in a specification already sitting in the repo.**
Nobody read it. Four slices were spent trying to make a dialog work that Leafly
never asked for and that its own fifteen-minute auto-cancel deadline argues
directly against.
