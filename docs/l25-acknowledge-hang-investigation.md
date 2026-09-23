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
