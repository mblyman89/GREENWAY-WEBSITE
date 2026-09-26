# Leafly orders loading an empty register cart — what was wrong and what changed

## What you saw

You loaded a Leafly order into the register cart and the cart came up empty. When the register logged itself out, a message said the items were "no longer on the menu". But the products were on the menu and for sale, and our own website orders loaded fine.

## Why it happened

When you load an online order, the register doesn't copy the old prices. It looks up each item on its **current** menu so prices and deals are fresh, and it matches each item by its **menu size id**, the same id the register uses for every product and size.

- **Website orders** save that id on every line, so the register finds every item.
- **Leafly orders** did not. When a Leafly order was accepted, our copy saved only the name, size, quantity and price. It saved no menu id. The same was true when an order's items were changed with "Update Order's Cart" (L-48).

With no id, the register couldn't find any of the items. It set them all aside and said they were "no longer on the menu". That message was wrong: the items were on the menu, they just couldn't be looked up.

The id was there all along. Leafly sends it back on every item as `integratorVariantId`, and it is the exact id **we** gave that size when we sent our menu to Leafly. It's the same id the register uses, and I checked this in the code for every kind of id we send: normal sizes, single-price items, and products we had to split for Leafly. We just weren't saving it.

## What changed

1. **Leafly orders already in the system now load correctly.** When a Leafly order is loaded into the register, the item list now comes from Leafly's own stored copy of the order. That copy has the ids, and it's the same copy the register's order detail already shows you. Orders that are waiting right now are fixed too, with no database change or clean-up job.
2. **New Leafly orders save the ids.** Lines created when an order is accepted, and lines rebuilt after "Update Order's Cart", now save the menu id, just like website orders.
3. **The message tells the truth.** If an item ever reaches the register with no menu id at all, it now says "not linked to a menu item - add it by hand", not "no longer on the menu". "No longer on the menu" now only appears when the item really has been taken off the menu. "Out of stock" is unchanged.

Nothing changes for website orders.

## What still works the way it did

- Prices are still taken fresh from the register's live menu and deals.
- An item that really is sold out or taken off the menu is still set aside and named on screen.
- Nothing is ever matched by product name. Names can be alike, so matching on them would be a guess.

## How to check it

Load the same Leafly order into the register again. Every item should now be in the cart, and the banner should list nothing as dropped. No migration is needed.
