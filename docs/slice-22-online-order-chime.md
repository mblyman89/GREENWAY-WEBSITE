# Slice 22 — Why the online-order chime never rang

## What the owner asked

Michael, verbatim:

> "the second slice is regarding online orders chime sound when an order is placed. the online orders dashboard in the back office has a feature that makes a noise when an online order is placed. I can test the sound to confirm it works, but it does not make noise when I complete an online order. Is this a bug or is it because I am placing the order on the same computer the back office is open on? Or something else? please try and resolve this issue and fix it so I can hear the chime when an order is placed online. follow the standing rules and never guess, never assume. go above and beyond for me. test everything including the tests."

And in the message that set this slice's scope:

> "Please work on the chime fix and receipt engine while I think more about the receipt pool feature."

The standing rule governs all of it — *do not guess, do not assume; we build from fact, not memory.*

## The short answer

It is a bug. It is three bugs, actually, stacked on top of each other, and any one of them alone would have been enough to produce the silence you heard.

The same-computer theory is not the cause, and it is worth explaining why before anything else, because it is a reasonable thing to suspect. The dashboard does not listen to your browser. It asks the **server** every fifteen seconds whether anything new has arrived, by fetching `/api/admin/orders/count`. That is a round trip out to the database and back. Whether the order was placed on the same machine, a different machine, or a customer's phone three miles away makes no difference at all to what that endpoint returns. So placing the test order on the back-office computer was never the problem, and you can stop working around it.

What follows is what actually was.

## Bug one: we were watching a level, not arrivals

The old watcher did this, at `src/components/admin/orders/NewOrderAlert.tsx:86` as it stood before this slice:

```
const diff = data.counts.new - baseline.current;
```

and chimed only when that `diff` exceeded its own previous value.

`counts.new` comes from `getOrderStatusCounts()` in `src/lib/orders/orders-store.ts:432`, and it is the number of orders **currently sitting** in status `new`. That is a level, like the water in a sink, not a counter of things that have arrived. And a level goes **down**. Every time a staffer acknowledges an order, it drops by one.

Follow the arithmetic through a perfectly ordinary sequence. An order arrives, so the level goes from zero to one and the chime fires correctly. A staffer acknowledges it, so the level falls back to zero. A second order arrives, so the level rises to one again — which is exactly where it already was when the first order chimed. The comparison finds nothing new to report, and the second order lands in total silence.

The busier the shop, the more reliably this failed. When nobody is touching the queue, the level only ever rises and the chime looks like it works. The moment staff start clearing orders as they come in, which is the entire point of the page, it goes deaf. That is very likely why it seemed intermittent rather than simply broken.

There was a second defect sitting inside the first. `baseline` was captured with `useRef(initialNew)` at first render and — verified, not assumed, by grepping for `baseline.current =` and getting **zero** matches — was never reassigned. So when you pressed the refresh button, the server re-rendered with a fresh count while the ref quietly held on to the stale one, and the arithmetic drifted further from what was actually on your screen the longer the page stayed open.

The fix is to watch something that can only ever move **forward**. Every order row carries `placed_at timestamptz not null default now()`, created in `supabase/migrations/0007_slice7_orders.sql:90`. The **database** writes that value at the moment of insert, and nothing in the application ever touches it again — acknowledging, preparing, completing, cancelling or refunding an order all change `status`, and none of them can move `placed_at`. So "the newest `placed_at` I have already told the user about" is a true high-water mark. Staff activity is physically incapable of dragging it backwards.

That required the count endpoint to actually report arrivals, so `getRecentOrderArrivals()` was added to `src/lib/orders/orders-store.ts` and `/api/admin/orders/count` now returns an `arrivals` list alongside the counts. The existing `counts` object is returned **exactly** as it was, so nothing else that reads this endpoint is affected.

## Bug two: the browser was swallowing the sound

This is the one that explains the specific thing you noticed — that **Test sound works but a real order does not**. That detail turned out to be the most useful clue in the whole investigation, because it rules out speakers, volume, mute settings and the audio code itself. All of those are shared by both paths. Something had to differ between a click and a timer, and exactly one thing does.

Chrome's autoplay policy has covered the Web Audio API since Chrome 71. The rule, quoted verbatim from Google's own documentation at `developer.chrome.com/blog/autoplay`:

> "If an `AudioContext` is created before the document receives a user gesture, it will be created in the 'suspended' state, and you will need to call `resume()` after the user gesture."

The old `chime()` function built a **brand new** `AudioContext` on every single call and closed it 1.2 seconds later. Put that rule and that code side by side:

When you press **Test sound**, the context is constructed *inside the click handler*. The document is receiving a user gesture at that exact instant, so the context is born `running` and the notes play. It works, every time, which is precisely why testing it was reassuring and misleading in equal measure.

When an order arrives, the context is constructed *inside a `setInterval` callback*. There is no gesture anywhere near that moment. Per the rule above, the context is born **suspended** — its clock is not advancing — so the two notes get scheduled against a timeline that never moves, and then the whole context is closed a second later before anything can be heard. No error is thrown. No exception reaches the `try/catch`. The sound simply never happens, silently, which is the worst possible failure mode because there is nothing to find.

MDN's user-activation reference confirms that Web Audio autoplay is gated on **sticky** activation, which it describes as a state where the user "has at some time in the session pressed a button... It is not reset after it has been set initially." Sticky activation belongs to the **window**, not to any particular callback. So one genuine click anywhere on the page is enough to unlock audio for the rest of the session — but only if you keep the context you unlocked, rather than throwing it away and building a fresh locked one every time.

So the chime now keeps **one** shared `AudioContext` for the life of the page and calls `resume()` on it when the browser has parked it, instead of constructing a disposable one per chime. The decision logic lives in `audioGateAction` in the pure core, where it can be tested without a browser.

There was one more piece of this worth naming. The old code tracked whether audio was unlocked in a `localStorage` flag called `gw_orders_sound_armed`. That cannot work, and the reason is subtle: sticky activation does **not** survive a page load. A flag written yesterday says "armed" on a page that has received no gesture at all today, so the component believed it could play when it could not, and hid the hint that would have told you otherwise. Worse, the state defaulted to `true` before hydration, so the hint was hidden on first paint — exactly when it was most needed. The component now reads `navigator.userActivation.hasBeenActive`, which is the browser's own live answer for *this* page load, and it reports honestly when audio is blocked rather than failing quietly.

## Bug three: a background tab was throttled to a crawl

The back office realistically lives on a second monitor or in a background tab while staff do other things. Chrome 88 and later apply what Google calls "intensive throttling" to chained timers — and `setInterval` qualifies — once a page has been hidden for more than five minutes. The documentation at `developer.chrome.com/blog/timer-throttling-in-chrome-88` is explicit that in that state "the browser will check timers in this group once per **minute**."

So the fifteen-second poll silently became a roughly sixty-second poll whenever the tab was not in front, and an order could sit unannounced for a full minute.

This one cannot be switched off, and honestly it should not be — it is why laptops still have battery at four in the afternoon. What can be done is to stop pretending. A hidden tab now polls on a slower cadence deliberately, rather than asking for something the browser will not grant, and the component listens for `visibilitychange` so that the moment you click back to the tab it polls **immediately** instead of waiting out a throttled tick. Coming back to the dashboard is now instant.

## One more thing, fixed on the way past

The poll effect declared `[muted, volume]` as its dependencies. That meant every single nudge of the volume slider tore down the interval and built a new one, resetting the countdown to the next poll from scratch. Sliding the volume around for a few seconds could postpone the next check indefinitely. Those values now travel through refs, and the interval is created once.

## What it does now

The banner tells you **which** orders arrived, not just how many — it lists the friendly pool names, using the same `resolveOrderDisplay` rule (`src/lib/orders/order-name-pool-core.ts:156`) that the rest of the admin already uses, so a name on the banner matches the name on the ticket. It polls once immediately on mount rather than waiting a full interval, so an order placed three seconds after you open the page is still caught. Muting withholds the sound but keeps tracking underneath, so un-muting does not unleash a backlog of chimes for orders that arrived while it was quiet. And a volume of zero read back out of storage falls back to the default rather than to silence, because a stored zero would look exactly like the bug we just spent this slice fixing.

## How this was verified

Everything above is from the code, the migrations, or the browser vendors' own published specifications. Nothing is from memory.

The three root causes were each traced to a specific line: the level-watching arithmetic at `NewOrderAlert.tsx:86`, the per-call context construction in the old `chime()`, and the `[muted, volume]` dependency array. The claim that `baseline` was never reassigned is a grep result, not an impression. The claim that `placed_at` is immune to status changes comes from reading migration `0007_slice7_orders.sql:90` and confirming the insert path at `orders-store.ts:86`. The autoplay behaviour is quoted verbatim from Google's documentation and cross-checked against MDN's sticky-activation reference; the throttling behaviour is quoted verbatim from Google's Chrome 88 announcement.

The decision logic is isolated in `src/lib/orders/new-order-watch-core.ts`, which is pure — no React, no I/O, no `server-only` import — so it can be exercised directly. It carries 61 self-test assertions wired into `scripts/compliance/run-pure-selftests.ts`, and `tests/compliance/new-order-watch.test.ts` adds 36 tests covering the behaviours you would actually notice at the counter, including the exact acknowledge-then-arrive sequence that used to be silent and a simulated busy shift where staff clear the queue between every order.

Then the tests themselves were tested. Twenty-seven mutations were introduced into the core one at a time — inverting the comparison, letting the water mark rewind, rebuilding the audio context instead of resuming it, letting a hidden tab poll faster, and so on — and the suite had to go red for each. **Twenty-six did. One did not**, and that is the part worth reporting: changing the freshness test from `>` to `>=` left every test passing.

That is not a theoretical nit. The seen-id memory is capped, so on a busy day the id of the order that set the water mark can be evicted while the mark itself persists. Under `>=`, that order would then match as fresh on every subsequent poll — a chime every fifteen seconds, forever, for an order you had already seen. Three tests were added to close the hole, the mutation now fails correctly, and the source was confirmed byte-identical after the harness ran.

The full suite stands at **572 files and 14,484 tests, all passing**, up from 571 and 14,448. TypeScript reports zero errors and ESLint reports zero errors across the repository.

## What is still open

The fun receipt-number pool for walk-in sales is **paused at your request** while you decide how you want it to work, and the enterprise receipt engine is the other half of this slice. Neither is touched here. This change is confined to the orders dashboard, its count endpoint, and the new pure core.
