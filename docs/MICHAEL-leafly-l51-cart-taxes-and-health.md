# Leafly: why "Change items" kept failing, what was fixed (L-51), and the health cards (AS-2)

## The short version

Every "Change items" attempt failed for one reason, and it had nothing to do with the product you picked.
Our request always sent Leafly an **empty list of tax lines** (`"taxes": []`). Leafly's cart endpoint refuses that with a bare `{"status":400,"error":"Bad Request"}` and gives no reason. That bare message is what you kept seeing.

We now send the Washington tax that is already included in the prices, split into two lines labelled "(included in price)". Leafly accepts that.

## How it was proven (live, in Leafly's sandbox, Sep 28 2026)

I made the test calls myself against real sandbox orders, changing one thing at a time:

| What was sent to `POST /orders/{id}/cart` | Leafly's answer |
|---|---|
| The order's **current** cart, unchanged, with `taxes: []` | **400** `{"status":400,"error":"Bad Request"}`, the exact error you saw |
| The same body with one tax line (`amountCents: 1`) | **200** |
| The same body with no `taxes` key at all | 400 "did not contain a required property of 'taxes'" |
| A tax line of `0` | 400 "did not have a minimum value of 1" |
| A price with decimals (42.5) | 400 "did not match the following type: integer" |
| A variant id Leafly doesn't have | 400 `{"errors":[{"title":"ActionController::BadRequest","detail":"could not find variant does-not-exist"}]}` |

Because the unchanged cart failed too, the problem was the shape of our request, not the product, the stock or the catalog.
Leafly stores the tax lines exactly as we send them and does **not** add them to the total. Subtotal and total stayed equal to the item prices. Our prices already include tax, so the lines only tell Leafly how much tax is inside the price.

Where the mistake came from: Ben's answer 8 (empty tax lines) was about the **preview webhook**, and it is still correct there. It was wrongly reused for cart changes in L-48.

## A second Leafly bug the tests turned up (worth telling Ben)

When a line is swapped the way Leafly's spec describes (same cart item id, new variant), Leafly **stores the new price multiplied by 100**:
- $25.00 was sent and $2,500.00 was stored.
- $1.01 was sent and $101.00 was stored.

Changing the quantity or price on the same product stores it correctly. Removing the old line and adding the new one (`id: null`) also stores it correctly.

What we do about it:
1. **A swap is now sent as "remove the old line + add the new line".** The customer ends up with the same order. The only difference is that Leafly's order log shows a removal and an addition instead of a "substitution".
2. **A safety net.** After every change, if Leafly's answer shows a price exactly 100× what we sent, we send one automatic correction on that line. A same-line price edit stores the price as sent. You'll see a note saying Leafly saved a price 100 times too high and we corrected it. If the correction doesn't go through, the note tells you to check the order.

Suggested email to Ben: "Sandbox: on `POST /orders/{id}/cart`, a same-id substitution stores `packagePrice` ×100 (sent 2500, stored 250000; sent 101, stored 10100). A same-variant edit and remove+add store the price correctly. Also, `taxes: []` returns a bare 400 with no reason; a non-empty array is accepted. Can you confirm both?"

## Plainer error messages

- "could not find variant X": *Leafly does not have "Gelato 3.5g" (X) on its copy of our menu… send the menu to Leafly and try again.*
- A missing tax line: *This is a problem on our side, not with the product.*
- A bare 400: *Leafly refused the change without giving a reason.*

Leafly's exact words are still shown in brackets after the plain sentence, for support. The long "Its specification says…" paragraph is gone.

One new refusal: a cart so small that it contains less than one cent of tax (for example a single $0.01 item) can't be sent. Leafly requires a tax line of at least 1 cent. We now say so instead of sending a request that would fail.

## The two health cards (AS-2)

**Why they disagreed.**
- The green "Automatic syncing" card counted a daily run that only *checked* and sent nothing. Before AS-1, a quiet daily run skipped.
- The "Connection health" card counted only real sends.
- The orange "check the most recent error" box appeared whenever the card wasn't green, even with **zero** failures.

**What changed.** Both cards now show **one** plain-English verdict, worked out in one place:

| Badge | Meaning |
|---|---|
| **Connected and syncing** (green) | Leafly received your menu in the last day, and the 15-minute checks are running. |
| **Connected, waiting for the daily send** (gold) | Nothing failed and the checks run on time, but the last real send is more than a day old. The 4am daily run now always sends, so it turns green after that. |
| **Last send failed** (red) | A real send was refused. Only in this case does the orange runbook box appear. |
| **Automatic checks have stopped** (red) | No scheduled check in 90 minutes, which means the scheduler isn't reaching the site. |
| **Automatic syncing is off / Not connected** | Says exactly that. |

"Last menu sent" is now the newest real send from every record we keep: sync state, the send log, and scheduled runs that actually sent. The Automatic syncing card says "Last daily run" instead of "Last full sync". When the connection isn't green, its badge reads "Checks running" and repeats the same verdict, instead of saying "Running" in green.
