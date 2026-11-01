# Slice: register-sell-hidden-and-held-stock

## Owner request (verbatim)

> this still isnt working. I am getting really frustrated! everything I cant sell on the register is litterally in the inventory list in the back office. unlock EVERYTHING!!!! I need to sell to my customers!!! right now!!! unlock everything. follow the standing rules. get it done quick. we are losing sales. its in the inventory list, it needs to scan on the registers, no exceptions. I dont care if it has no COA, or if its not active or whatever, I WANT TO SELL IT ANYWAYS, I DONT CARE!!! please get this done. thank you.

## What production data showed (read-only SQL, 2026-11-01)

Stocked, non-sample lots by status: active 2,127, quarantine 38, sold_out 1 (3 units).

Active stocked lots against the published menu (version c1523a47):

| Bucket | Lots | Served before this slice |
|---|---|---|
| Card visible, priced | 2,001 | yes |
| Card hidden `owner_override_hide:` (57 cards hidden from the Promotions page on 2026-10-23 and 2026-11-01) | 119 | **no** |
| Card hidden `needs_category` | 6 | **no** |
| No menu card at all (HTE HONEY Mimosa, manifest still in transit) | 1 | no |

No active stocked lot was expired, fully held, or linked to a missing or $0 size, and none sat on a visible card without a price.
**The blocker was the website "hide" switch.** PR #1626 let importer hides sell. It deliberately kept a *person's* hide off the register, and these 125 lots are exactly that.

## Change

`classifyHiddenCard` (register-coverage-core.ts) now makes every hidden card register-eligible, whatever the reason (person, importer, needs-category, unmapped Cultivera category). Two exceptions remain, because the sale itself would be wrong without them:

- **Non-cannabis card category.** It would ring with no excise and no purchase limit.
- **No priced size.** There is nothing to charge (RCW 69.50.357, never free cannabis).

The route already requires live active stock. Hidden cards stay off the **website**. The back-office sellability banner uses the same function, so it agrees automatically.

The server sale path needs no change. The sync and completion gate price from the stored lines and category snapshots, and the decrement reads lots by key, so hidden status is not consulted.

## Not unlocked, and why

- **38 quarantine lots.** These are 2 inbound manifests (0f3136be…, 91d58745…) still `in_transit`. The product has not been received, there is no menu card or price, and AGENTS.md CCRS rules forbid selling quarantined inventory. Fix: receive the manifests and finish Product Onboarding (sets price, activates). The one active lot without a card (HTE HONEY Mimosa) is on the same manifest.
- **1 sold_out lot with 3 units** (Buddies Live Resin Puck – Black Haze, lot 20194927306946379). The status is stale. Fix: set it to Active on the lot page.
- **Recalled stock, trade samples, and expired edibles/tinctures/capsules/RSO** (D36/D44) stay blocked. None of these exist in stock today.

## Tests

- tests/compliance/register-sell-all-back-office-stock.test.ts: every hide reason sells and scans; non-cannabis and unpriced hidden cards stay off; the guardrail now expects all keys.
- tests/compliance/register-availability.test.ts: a hidden stocked product sells.
- Pure self-test: register-coverage-core, 48 assertions (floor 45).
