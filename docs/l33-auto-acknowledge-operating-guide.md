# AUTO-ACKNOWLEDGE — OPERATING GUIDE

**Slice L-33. Written for the owner, not for a developer.**

This is the document you reach for when you want to know what the feature does,
how to switch it off, and what to do if something looks wrong. Every statement
in it was read out of the shipped code rather than remembered, and the file or
function it came from is named so you can check any line of it yourself.

---

## 1. WHAT CHANGED, IN ONE PARAGRAPH

When a Leafly order arrives, our system now presses the Acknowledge button for
you, by itself, within about a second of the order landing. It does **not**
confirm the order. Confirm is still yours, still a separate press, still the
first thing the shopper ever hears about. The receipt still prints and the
speaker still makes noise exactly as they did before — in fact they happen
*before* the automatic acknowledgement, deliberately, so that the noise is
never waiting on Leafly's network. Nothing else about your day changes: you
walk over when you are ready, press Confirm, fill it, complete it.

The fifteen-minute clock is no longer something you can lose.

---

## 2. WHY THIS IS ALLOWED — IT IS NOT A WORKAROUND

Leafly's own specification, in the section titled "Expectations", says:

> "Orders are acknowledged as having been retrieved in whole **by your system**
> within fifteen minutes of receiving an order submission webhook. Any orders
> not acknowledged by this deadline will be auto canceled."

The subject of that sentence is *your system*. Not *your staff*. And the
acknowledge call itself sends no body, no staff name and no actor — there is no
field in the request in which "a human pressed this" could even be written
down. Leafly could not tell the difference if it wanted to.

The rule that a person had to press it within fifteen minutes was **ours**, not
Leafly's. This is the second time that has turned out to be true; in L-30 the
confirmation pop-up turned out to be ours as well.

---

## 3. THE ONE THING IT WILL NEVER DO

**Acknowledge will never confirm in the same step.** You asked for that
explicitly and it is enforced in three independent places, any one of which
would catch a future change that broke it:

1. The automatic path calls the acknowledge function and nothing else — there
   is no status push anywhere in it.
2. A compliance test (`tests/compliance/leafly-l33-auto-acknowledge.test.ts`,
   section 1) reads the shipped source of the automatic path and **fails the
   build** if the words that would push a confirmed status ever appear in it.
3. The mutation sweep (`scripts/recon/l33-mutation-sweep.mts`) deliberately
   breaks that rule in a scratch copy of the code and checks that the test
   suite notices. It does. If it ever stopped noticing, the sweep reports a
   survivor and I would have to fix the test, not the code.

In plain terms: it is not enough that the code is right today. There is a test
that fails if it stops being right, and a check that fails if that test stops
working.

---

## 4. HOW TO TURN IT OFF

One environment variable in Vercel:

```
LEAFLY_AUTO_ACKNOWLEDGE = off
```

Any of `off`, `no`, `false`, or `0` works — upper case, lower case, or with
stray spaces around it, all the same. I did not want you hunting for the one
magic spelling while something was going wrong. Redeploy (or let the next
deploy pick it up) and the automatic acknowledgement stops immediately; the
Acknowledge button on the board behaves exactly as it did before this slice.

**Leaving the variable unset means the feature is ON.** That was a deliberate
choice and it deserves an explanation, because the cautious-looking option is
the opposite one.

There is no safe default here, only two different ways to be unsafe:

- *Default OFF* — you deploy, you believe the feature you asked for is live,
  you walk away from the office, and Leafly auto-cancels a real customer's
  order fifteen minutes later. The failure is **silent**, it costs you a paying
  customer, and it looks exactly like the bug you have been reporting for
  three slices.
- *Default ON* — orders are acknowledged on arrival, which is precisely what
  you asked for in writing, and one variable stops it.

A default that quietly does nothing while appearing to be installed is not
safe, it is deceptive. So the default does what you asked, and the off switch
is blunt.

*(Source: `src/lib/leafly/auto-ack-core.ts`, `isAutoAcknowledgeEnabled`.)*

---

## 5. HOW TO TELL, LOOKING AT THE BOARD, THAT IT WORKED

An order the machine handled now carries a small grey badge reading
**"Accepted automatically"**. Hover it and you get the full sentence: that the
clock has been stopped, that the shopper has **not** been told anything yet,
and that Confirm is still waiting for you.

An order a person acknowledged carries no such badge. Orders from before this
slice carry no badge either — not because they were manual, but because we
genuinely do not know, and I was not willing to stamp "human" across your
history and invent an audit trail that had never existed.

---

## 6. THE SAFETY NET, AND ITS HONEST LIMITATION

Almost all of the time, the acknowledgement happens because the order arrived
and the arrival hook fired. But a webhook can be missed — if our site is down
for a few minutes exactly when an order lands, Leafly retries, and if the
retries also fail the order can reach the deadline unacknowledged.

So there is a second, independent path: a sweeper that asks *"is anything still
unacknowledged with a deadline coming up?"* and acknowledges it. It looks at
the oldest deadlines first, waits a two-minute grace period so it never races
the normal arrival path, stops thirty seconds short of a deadline it cannot
safely beat, and handles at most ten orders per run so a backlog can never turn
one run into a runaway.

**Here is the limitation, stated plainly rather than buried.** Our Vercel plan
(Hobby) permits **one cron run per day**. I measured this; a more frequent
schedule is rejected at deploy time and would have taken the whole site down
with it. So as shipped, the sweeper runs once a day at 13:00 UTC. That is
**not** a real-time net for a fifteen-minute window, and I am not going to
describe it as one.

What it genuinely is, today, is a **detector**. Once a day it tells you the
truth about whether the arrival path is working:

- **HTTP 200, `acknowledged: 0`** — everything is fine. Every webhook arrived
  and was handled on arrival. A quiet sweep is a successful sweep.
- **HTTP 502** — something is wrong upstream. Either an order passed its
  deadline unacknowledged (a customer's order was cancelled) or Leafly refused
  an acknowledgement. The status code itself is the alarm, so an uptime monitor
  can catch it without anybody reading the response body.
- **`arrivalPathSuspect: true`** — the sweeper had to step in. The order is
  saved, but the arrival path did not do its job and that is worth
  investigating.

### Three ways to make it a real net, with zero code changes

The sweeper is already built to run as often as you like. Only the schedule is
constrained. Any one of these upgrades it:

1. **Upgrade the Vercel plan to Pro.** Change the one schedule line in
   `vercel.json` from `0 13 * * *` to `*/5 * * * *` and it runs every five
   minutes. No other change anywhere.
2. **Point a free external scheduler at it.** The route accepts `POST` as well
   as `GET` for exactly this reason. Anything that can call a URL on a timer —
   cron-job.org, an UptimeRobot monitor, a Pi in the shop — sends a request
   with the `Authorization: Bearer <CRON_SECRET>` header every few minutes and
   you have the same result on the current plan, for nothing.
3. **Press it yourself.** Logged in as staff, visiting the route in a browser
   runs a sweep on the spot, because a valid staff session is accepted as
   authorisation. Useful if you ever want to check by hand.

*(Route: `src/app/api/cron/leafly-ack-sweep/route.ts`. Decision rules:
`src/lib/leafly/auto-ack-sweep-core.ts`.)*

---

## 7. ONE THING YOU NEED TO DO BY HAND

`supabase/migrations/0230_leafly_auto_acknowledge.sql` needs to be run in the
Supabase SQL editor, the way you run all of them. Every statement in it is
`if not exists`, so running it twice is harmless.

**Auto-acknowledge works without it.** The feature depends only on the flag.
What the migration adds is the board's ability to tell two look-alike states
apart, and here is why that matters:

L-32 shipped a rule that treats "acknowledged but still pending" as proof that
a confirm push was lost, and replaces every button on such an order with a
single repair action, *"Check this order with Leafly"*. After L-33, that exact
state is the **normal** resting state of every order — acknowledged by the
machine, deliberately not confirmed, waiting for you. Without the migration the
two cases are indistinguishable from the status columns alone.

I found this by running the real board planner against the real row shape
before writing the feature. It printed one button, *"Check this order with
Leafly"*, on every order — your whole workflow replaced by a diagnostic for a
failure that had not happened. The migration records the genuine failure as a
fact at the moment it occurs (`confirm_push_failed_at`) instead of inferring it
afterwards, so the board can stop guessing.

Until you run it, the board behaves exactly as it does today; the missing
column is detected and treated as "no recorded failure", and that degradation
is itself covered by tests.

---

## 8. IF SOMETHING LOOKS WRONG

| What you see | What it means | What to do |
|---|---|---|
| Order shows "Accepted automatically" but no Confirm button | The confirm-failed column has been stamped, or 0230 has not been applied | Run 0230; if already applied, use *Check this order with Leafly* |
| No badge on a brand-new order | The flag is off, or the arrival webhook did not fire | Check `LEAFLY_AUTO_ACKNOWLEDGE` in Vercel; the next sweep will report it |
| Sweeper returns 502 | An order expired, or Leafly refused an acknowledgement | Read `details` in the response; an expired order is already cancelled at Leafly |
| You want everything back the way it was | — | Set `LEAFLY_AUTO_ACKNOWLEDGE=off`. Nothing else in the slice activates without it |

Turning the flag off is always safe and always reversible. Nothing else in this
slice changes behaviour on its own.
