# Slice 23 — the fun receipt name everywhere, a QR code instead of a barcode, and a logo that prints clean

## What Michael asked for

> "on the customer facing website, after an order is placed and they land on the order confirmed page, I want the fun receipt overlay to appear there as well instead of the real receipt number. the fun overlay was used for the emailed confirmation, so thats perfect... as for the fun receipt overlay for printed receipts, I think we should draw from the same pool. we rarely go without internet, and if we do, the fall back can be to just use the real receipt number instead of the overlay. if its possible to add intelligent picking and assigning and rotating so that no two of the same overlays can be used within a certain number of uses between each other would be ideal. we do not see very many online orders, and we average about 200 in store transactions per day. I have about 50 overlays in the system, I will add more as I think of them. I want the rotation to be smart. if there is enterprise grade solutions for this, use them... please make the overlay box completely collapsable it takes up way too much space right now, as well as add a bulk add feature so I can upload a list to make it easier. please add value here, its the fine details that people notice... for the receipt that prints out, I want it to have the fun overlay on it. the barcode should be the real receipt number i am guessing unless it doesn't need to be, i'll let you make the executive decision on that one, but the text bellow the barcode should definitely be the fun overlay. also... i would much rather have a nice pretty QR code instead of the ugly lines barcode. finally, I want to add to the receipt builder engine the ability to add a logo to the bottom of the receipt below the QR code and receipt overlay and above the footer message... i will need your help making sure the logo printed on the receipt will look good and only print the logo and not the background with it. i don't want to see a black box... my logos are png files, so i am not sure if we need to add a background remover... break it up into however many slices as you think you need, finish one slice after the next, then report back to me with a summary report. follow the standing rules and never guess, never assume. go above and beyond for me. test everything including the tests."

And, on budget:

> "But be conservative. We have to stay within budget, so run a few tests, break them, then move on. You don't have to feverish after each slice of you don't think it's needed to save money and tokens. Maybe do one big validation at the end?"

That shaped the delivery: one branch, one pull request, targeted checks while building, and a single full validation at the end rather than a full gate run after every piece.

## The confirmation page bug, and why it was one word long

The online half of this request turned out to be a bug rather than a feature. The name pool already existed, and the order confirmation email and the printed pickup receipt were already using it. Only the browser page disagreed.

The cause sat in `src/app/api/orders/route.ts`. At line 189 the route computes `const displayLabel = resolveOrderDisplay(result.displayName, result.orderNumber);` and hands that label to `notifyOrderPlaced` for the email and to `queueOrderReceipt` for the printed slip. But the JSON returned to the browser carried `result.orderNumber` — the raw number, not the label. One field out of step, so a customer who ordered online got a friendly name in their inbox and a bare number on screen for the same order. The fix returns `displayLabel` in the POST response, which means the page, the email and the receipt now all read from the single value that was already being computed a few lines above.

## Rotation: why the existing pool could not do what was asked

Michael asked that "no two of the same overlays can be used within a certain number of uses between each other." The pool from migration 0147 could not answer that, for two separate reasons.

The first is a race. The old picker read the least-recently-used row and then wrote a stamp back to it. Two sales landing at the same moment both read the same row and both get the same name. At two hundred transactions a day this is not theoretical.

The second is subtler and matters more. The old stamp was a wall-clock timestamp, and the question asked is about *uses*, not time. "Not within twenty-five sales" is countable; "not within twenty-five minutes" is a different promise that happens to look similar on a slow afternoon and breaks completely on a Saturday rush.

Migration `supabase/migrations/0221_order_name_rotation.sql` replaces both. It adds a monotonic `last_assigned_seq` to each pool row and a global `order_name_assignment_seq`, then moves the whole pick-and-stamp into `assign_order_name()` — a single atomic function serialised by a transaction-scoped `pg_advisory_xact_lock`. Transaction-scoped matters: the lock releases even if the caller crashes mid-sale. The function returns the chosen name *and* the gap, so a thin pool can be reported without a second query.

The pure logic lives in `src/lib/orders/order-name-rotation-core.ts` (46 assertions), which computes rotation order, gaps and capacity independently of any database.

One deliberate honesty constraint is worth calling out. `rotationCapacity()` reports the arithmetic ceiling — with a pool of size *n*, the largest gap achievable is *n − 1*, full stop. With about fifty names and two hundred sales a day, a name necessarily recurs roughly every fifty sales, which is around four times a day. The code says so rather than implying a guarantee it cannot keep. Michael's plan to grow the pool is exactly the right lever, and the admin screen now shows a rotation-health banner so the effect of adding names is visible.

The store, `src/lib/orders/order-name-pool-store.ts`, descends a three-rung ladder: the atomic `assign_order_name()` RPC first; the older 0147 read-then-write path *only* when a schema object is genuinely missing (Postgres codes 42703/42883, PostgREST PGRST202); and otherwise no name at all. That middle condition is the important one. A transient database error does not silently degrade to the racy path — it returns no name, and the receipt prints the real number, which is always correct if less charming. Zero rows from the RPC is treated as a real answer meaning "the pool is empty", not as a failure to retry.

## Walk-in receipts: where the name is stored, and a correction

The register half required finding where a walk-in sale actually lives, and this is where an assumption had to be caught and thrown away.

The natural guess is that register sales live in their own table — something like `pos_sales` — which would need its own `display_name` column. An earlier draft of migration 0221 contained exactly that, wrapped in an existence guard. Grounding disproved it:

```
grep -rn "pos_sales" supabase/migrations/*.sql   -> no matches
grep -rn "pos_sales" src/ --include=*.ts --include=*.tsx -> no matches
```

There is no such table. What actually happens is that a register sale is enqueued on the device as a `pos_sale_events` row, and at sync time `src/lib/pos/sync-store.ts` *materializes a real order* from it — an ordinary insert into `public.orders` with status `ready` and `customer_first_name` set to `Walk-in` (sync-store.ts:769-789). Walk-in sales and website sales converge on the same table.

So `orders.display_name`, added by 0147 and already nullable and non-unique so names can recycle, was already the right home for both channels. The guarded block was deleted. Because it was guarded, it would never have errored — it would have quietly done nothing forever, which is precisely the kind of dead code that misleads the next reader. The migration now carries that reasoning in place of the column, so the next person to have this idea finds the answer instead of repeating the work.

The plumbing:

- `src/app/api/pos/order-name/route.ts` — a new device-authenticated endpoint following the established `reprint/route.ts` pattern. It is a `POST`, not a `GET`, because every call *consumes* a name from the rotation; a `GET` would invite proxies, prefetchers and retries to burn names and pull repeats forward.
- `src/app/pos/RegisterShell.tsx` — the `onOrderName` implementation. Every failure path returns `null`, and `null` is not an error: it is Michael's stated fallback. Offline, a down server, a 500, malformed JSON, an endpoint missing on an un-deployed build — all mean the receipt prints the real number and the sale is untouched. There is no error string to build and nothing to show the cashier.
- `src/app/pos/SaleFlow.tsx` — the name is drawn *early*, when the tender screen opens and the customer is still counting out cash, and parked in a ref.

That last decision deserves its reasoning. The name has to be in hand at the instant the sale is enqueued, because that is when the receipt snapshot is frozen and the payload handed to the queue — and that path is synchronous on purpose. Making it `async` so it could await a name would put a network round trip between "customer handed over cash" and "drawer opens", and would let a slow server stall a completed sale. A flourish must never be able to do that. A ref rather than state, because re-rendering the tender screen when a decorative name arrives is pure noise, and because the enqueue path needs to read the current value synchronously rather than a value captured in a closure. A second ref guards against drawing a *second* name if the cashier steps back to the cart and returns, since every draw consumes a name and an abandoned draw is a name burned for nothing.

The name is then read exactly once into `funNameForSale` and used for both the payload and the frozen receipt. Reading the ref twice could pick up a late arrival in between and print one name while recording another — the one way this feature could genuinely mislead somebody, because the slip in the customer's hand would disagree with the reprint.

`src/lib/pos/sale-event-core.ts` gains an optional `displayName` on the payload with a bounded, non-empty validation rule, and `src/lib/pos/sale-flow-core.ts` drops anything that rule would reject rather than forwarding it. That asymmetry is deliberate and is stated in the code: a rejected payload is not a plain receipt, it is a *failed sale* with a customer at the counter, over a decoration. A missing flourish is invisible; a blocked sale is not.

Reprints read the name from the stored payload (`src/lib/pos/receipt-reprint-core.ts`) rather than drawing a fresh one. Drawing again would hand the customer a second slip for the same purchase bearing a different name — two receipts that look like two sales.

## The executive decision on the barcode

Michael delegated this one: "the barcode should be the real receipt number i am guessing unless it doesn't need to be, i'll let you make the executive decision on that one."

The QR encodes the **real receipt number**. A scan has to resolve to exactly one sale, and fun names recycle by design — that recycling is the entire point of the rotation. Encoding a name that will legitimately reappear roughly every fifty sales would make the code ambiguous and useless at the returns desk. The text *beneath* the code is the fun name, exactly as asked.

## The QR encoder, and three bugs that self-tests could not see

`src/lib/printing/qr-core.ts` is a dependency-free QR Model 2 encoder: Reed-Solomon over GF(256), BCH format and version information, all eight mask patterns with the four penalty rules, byte mode, versions 1 through 10. It carries 111 assertions including a round-trip decoder.

Three bugs are worth recording because of *how* they were found.

The first — blanking modules at (6,8) and (8,6), which destroyed the timing pattern — was caught by a structural self-test.

The other two were invisible to every self-test written. The format word was being placed least-significant-bit first when the specification requires most-significant-bit first, and the two-copy format split used `i < 8` where the correct boundary is `i < 7`, which wrote a bit onto the mandatory dark module. Both produced symbols that were internally consistent and passed the round-trip decoder — because the decoder shared the encoder's misunderstanding.

They were found by comparing module-for-module against the independent Python `qrcode` library. That comparison covered 192 payloads across versions 1–10, all four error-correction levels and all eight masks: **249,352 modules, every one matching**. Four of those symbols are now pinned as golden vectors in the self-tests, which is what makes the mutation check below meaningful.

(One false alarm during that work is worth noting: the Python library auto-selects alphanumeric mode for uppercase-and-digit strings, so the comparison had to force `MODE_8BIT_BYTE` to compare like with like.)

The receipt renderer sizes the QR at a fixed 200 px rather than 100% width. Stretching a QR breaks scannability, and a receipt that looks right and scans wrong is worse than no code at all.

## The logo, and the black box

Michael was specific: "i will need your help making sure the logo printed on the receipt will look good and only print the logo and not the background with it. i don't want to see a black box."

A thermal printer has exactly two states per dot: burn, or do not burn. Handing it a PNG with transparency means the transparent region has to become *something*, and the naive answer makes it black — which is the black box.

`src/lib/printing/logo-print-core.ts` (73 assertions) composites onto white, converts using Rec. 601 luminance, and picks the threshold with Otsu's method — maximising between-class variance rather than trusting a fixed constant. Polarity is detected by sampling the border, so black-on-white and white-on-black artwork both come out right.

One convention is documented in the code because it caused twenty-six failures at once: Otsu returns a threshold that is *inclusive* of the dark class, so the comparison must be `lum[i] <= threshold`. Using `<` classified nothing as dark for black-on-white artwork and printed blank paper.

Measured on Michael's four real PNG files, run through the actual TypeScript core:

| file | naive burn | after fix |
|---|---|---|
| BLACK_&_WHITE | 92.9% | 17.2% |
| BLACK_&_GREEN | 93.3% | 16.1% |
| BLACK_&_GOLD | 92.7% | 17.3% |
| cloud_logo | 75.8% | 41.8% |

All four auto-detected as light-background artwork, with Otsu thresholds of 112, 45, 76 and 100 respectively — four different values, which is the proof that no fixed constant would have worked. The output bitmaps were rendered and visually confirmed clean, not merely measured.

Per Michael's decision the black-on-white logo is the one in use: *"I forgot the cloud logo had issues... Let's go with the black on white version for now."*

The upload path in `src/components/admin/registers/ReceiptConfigEditor.tsx` runs entirely client-side — `createImageBitmap`, a canvas `getImageData`, then `prepareLogoForPrint`. Nothing is uploaded anywhere. The result is stored as a 1-bit BMP data URI, which is required rather than stylistic: `StarPrinterPlugin.swift` loads receipt HTML with `loadHTMLString(html, baseURL: nil)`, so a relative or remote image URL cannot resolve, and the receipt must print with no internet. `src/lib/pos/receipt-logo-core.ts` documented this constraint before this slice began, and it is why `sanitizeBottomLogo()` rejects remote URLs outright.

## The admin screen

The pool manager is collapsed by default now — Michael's "it takes up way too much space right now" — with a separate toggle for the list itself and a scroll cap so a large pool cannot run away down the page. Bulk add takes a pasted list and shows a live pre-submit report of what will be added, what will be skipped and why, naming the first five skips explicitly rather than reporting a bare count. Adding fifty names and being told "12 skipped" is not useful; being told which ones is.

## How this was verified

Every claim below was executed, not assumed.

**Migrations against real PostgreSQL 15.** All 221 migrations were applied in order to a live PostgreSQL 15 instance (`initdb` + `pg_ctl` in the sandbox), after stubbing only the Supabase-managed prerequisites vanilla Postgres lacks: the `auth` and `storage` schemas, `auth.uid()`/`auth.role()`, and the `authenticated`/`anon`/`service_role` roles. Result: **221 files, zero failures.** Migration 0221 was then re-applied a second time and produced only "already exists, skipping" notices, proving idempotency.

**Rotation behaviour against that live database.** Twelve draws from a five-name pool returned a perfect round robin — `Alpha Bravo Charlie Delta Echo Alpha Bravo Charlie Delta Echo Alpha Bravo` — the maximum spacing the arithmetic permits. The reported gap was 5 on a five-name pool. Four *concurrent* psql clients drawing twenty-five names each (one hundred draws total) landed exactly **20/20/20/20/20** across the five names, which is what the advisory lock exists to guarantee. A fully disabled pool returned zero rows, which the store reads as "no name" so the receipt prints the real number — the stated offline fallback. A pool narrowed to a single enabled name kept returning that name rather than wedging.

**QR correctness against an independent implementation.** 249,352 modules compared against the Python `qrcode` library across 192 payloads, versions 1–10, all four EC levels, all eight masks — all matching. Four symbols pinned as golden vectors.

**Logo burn rates on the real files**, as tabulated above, with output bitmaps visually inspected.

**Mutation testing — "test everything including the tests."** Each new or changed piece of logic had a deliberate defect injected to confirm the tests actually fail:

- QR format-bit order reversed → `[qr-core] FAIL: golden GWY-000001 L: every module matches the verified symbol` (6 failures, 105 passing).
- Rotation negative-gap clamp removed → `order-name-rotation-core self-tests failed: 1 (passed: 45)`.
- Logo Otsu comparison changed from `<=` to `<` → `logo-print-core self-tests failed: 26 (passed: 47)`.
- Payload length guard neutralised → `FAIL: SLICE 23: an over-long fun name never fails the sale`.
- Reprint name lookup replaced with `null` → `receipt-reprint-core: SLICE 23: the stored fun name is reprinted verbatim`.

This mattered more than usual here: the pure-selftest runner's `assertNoFailures()` is silent on success, so a core that was never registered would look identical to a core that passed. These mutations are the proof that all three new cores genuinely run.

Every mutation was reverted and the suite re-confirmed green afterwards.

**Static and full suite.** `tsc --noEmit` reports zero errors. ESLint reports zero problems on every touched file. The full suite is **573 files / 14,548 tests, all passing**, up from the Slice 22b baseline in both assertion count and coverage.

## Honest limitations

The rotation cannot promise a gap larger than the pool. With roughly fifty names and two hundred sales a day, a name will recur several times a day, and `rotationCapacity()` reports that plainly rather than dressing it up. Growing the pool is the only real fix, which is why the health banner exists.

The cloud logo is deferred at Michael's request — it has a "PORT ORHARD" typo and blue-on-white lettering that thresholds poorly. Its measured burn rate of 41.8% is materially worse than the other three for that reason.
