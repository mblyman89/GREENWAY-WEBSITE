# L-36: the register's Online Orders window, and a more detailed pick-and-bag ticket

**What you asked for:** "The online orders pop up box is small and not very descriptive… much more details… order id / name… type and category… tax breakdown… discounts… vendor and brand… easy to find the right orders… much larger… search… scanning the barcode on the receipt… newest on top, scrollable… cancel from the register and it updates the dashboard and reports." And for the printed online-order tickets: "the same break down."

Both parts shipped together in one slice.

---

## 1. The register's Online Orders window

Open it the same way as before, with the **Online orders** button on the home screen.

### The layout
- The window now takes up nearly the whole screen (about 94% of its height, up to 7xl width). Before it was a narrow column.
- **Left side:** the list of orders, **newest first**. It scrolls. Each tile shows:
  - the **order name** in big bold letters (e.g. "Purple Rain", or "LF-A1B2C3" for Leafly)
  - the customer's name and the GWY number
  - the status, the item count, the total, and how long ago it was placed
  - the **Leafly** badge when the order came from Leafly
- **Right side:** the order you picked, in full.

### Finding an order: type or scan
- The **search / scan box** at the top is already selected when the window opens.
- **Typing** filters the list as you type. It matches the order name, the GWY number, or the customer's name, and ignores spaces, dashes and capital letters. So "purple ot", "gwy 4242" and "GWY-004242" all work.
- **Pressing Enter, or scanning**, opens the order straight away **if exactly one** order has that name or GWY number.
  - If two orders share a name, it opens **neither**. It asks you to tap the right one, so you never open the wrong bag.
  - If one customer-name search narrows the list to a single order, Enter opens that order.
- Handheld scanners work both ways:
  - A scanner that "types" (keyboard mode) goes into the search box.
  - A Socket Mobile scanner in SDK mode is routed into the same search.

> **About barcodes on the ticket, please read.** The printed ticket does **not** have a barcode printed on it yet. The Pi print agent sends the ticket as plain text, and printing a real barcode needs a change to the Pi agent plus a test on the actual vretti printer. I haven't verified that on your hardware, so I didn't guess at it. What works today:
> - The ticket prints the **order name** and, when that name is a fun name, the **GWY number** right under it. You can type either one.
> - If a product barcode label with the order name or GWY number is ever stuck on a bag, scanning it opens the order the same way.
>
> If you want a real scannable barcode on the ticket, that should be its own small slice that includes a printer test.

### What the detail pane shows
For **every item**:
- quantity, product name and size
- **Brand**, **Vendor** (licence number stripped), **Type** (the detailed POS inventory type, e.g. "Usable Marijuana") and **Category** (e.g. "Flower")
- the price each, and the regular price when it was on sale ("was $X each")
- the **deal discount**, with the deal's name when there is one, and any **loyalty discount**, in dollars

For the **order as a whole**:
- **Regular price**, then **Deals & sale prices −$X**, then the loyalty line (e.g. "Loyalty code ABC123" or "Gold tier pricing")
- **Subtotal**, labelled "tax included" for website orders and "before tax" for Leafly orders
- **Tax breakdown**:
  - Website orders show **cannabis excise** and **state + local sales tax** separately.
  - Leafly orders show **Leafly's own tax lines**, exactly as Leafly charged them.
  - If the breakdown can't be proven to add up to the tax on the order to the cent, it shows one "Tax" line instead of a number it can't stand behind.
- **Customer saved**, and **Total due**
- the customer note, if any

Where the data comes from: vendor and type aren't stored on the order, so they're read from your menu using the same product id the order line has. Nothing is matched by name. If the product has since left the menu, those fields are left blank. The window never guesses them, and they never block the handover.

**Start handover — scan ID** works exactly as before. It's still the only way to complete an order, and the ID gate still runs.

### Cancelling an order from the register
1. Open the order and tap **Cancel this order…**
2. Pick the reason: **Customer asked to cancel**, **Customer never picked up**, or **We cancelled it (out of stock, etc.)**.
3. Enter a **manager or lead PIN**, then tap **Cancel order**.

Behind the scenes:
- The PIN is checked the same way as the no-sale approval, with the same lock-out after too many wrong tries. A budtender PIN is refused.
- **Website order:** it's cancelled, the order history records who cancelled it, why, and at which register, and any loyalty code on it is released.
- **Leafly order:** it's cancelled **at Leafly first**, with the reason you picked, so Leafly notifies the customer and the **Online Orders report** records it.
  - **If Leafly refuses, nothing changes on our side**, and the register tells you why. You never end up with an order cancelled here but still live on Leafly.
  - If Leafly already shows it cancelled or expired, we just close our copy.
- Every cancel, and every failed Leafly cancel, is written to the audit log with the manager's name, the budtender's name and the register.
- **Orders board and Reports:** both read live from the database, so the cancelled order drops off the Orders board and shows as cancelled in Reports the next time either page loads. Nothing needs refreshing by hand.
- The home-screen online-order count updates immediately.
- A register sale, or an order that's already finished or cancelled, can't be cancelled here. Use Returns / Void for a sale.

---

## 2. The printed online-order ticket

Both the **website** ticket and the **Leafly arrival** ticket now print:

- **Receipt # <order name>**, plus **Order # GWY-XXXXXX** under it when the name is a fun name, so the picker can search either one at the register
- for each item:
  - the brand, size, THC and deal name, as before
  - a new line with **Vendor: … · Type: … · Category: …**
  - a **"Discount −$X"** line with the dollars taken off that item
  - the "was $X each" line when it's on sale
- **Tax breakdown**:
  - website tickets itemize cannabis excise and state + local sales tax, as before
  - Leafly tickets now print **Leafly's own tax lines**, only when they add up to the order's tax to the cent
- **You saved** on Leafly tickets too. Before, it was always $0 there.

**Safety rules:**
- Anything the menu doesn't know, like a vendor for a product that's gone, prints nothing. It never prints "null" or a guess.
- A Leafly ticket uses the detailed version **only if** its item totals match the ticket that has always printed, to the cent. Otherwise it prints the simpler ticket exactly as before, so a print is never lost.
- Every new piece of text goes through the same printer-safe character cleanup, so the columns stay lined up.

---

## 3. What was tested
- **Type-check and lint:** clean. The only lint notes are 2 warnings that were already on main.
- **Pure self-tests** (the whole suite passes):
  - the detail breakdown: discounts, vendor cleanup, Leafly cart reading, search and exact-match rules, and splitting an uneven Leafly line for the printer without losing a cent
  - the ticket: vendor, type and category lines, the discount line, the GWY line, Leafly tax lines, ignoring tax lines that don't add up, printing nothing when facts are missing, and no line wider than the paper
- **The cancel route:**
  - a manager PIN cancels, credited to the right people and register
  - a budtender PIN gets 403 and never reaches the cancel
  - a wrong PIN counts toward the lock-out
  - a locked pad gets 429
  - a bad reason gets 400
  - a Leafly refusal comes back as a failure, never a success
- **Wiring checks:** the register window really calls the search, the exact match, the cancel and the breakdown.
- **Testing the tests:** I broke the code on purpose four times, and each time the tests caught it:
  - letting any role cancel
  - letting an ambiguous name open an order (this one first exposed a gap in the tests, which I then filled)
  - dropping the ticket's discount line
  - putting the oldest orders first

- **The full suite, run once:** 18,070 of 18,071 passed. The one failure was an older register rule that says "no form element in the register shell, handle Enter explicitly", which my first version of the search box broke. I fixed the search box to follow that rule and the test now passes.

## Files
- `src/lib/pos/pickup-detail-core.ts` (new, pure): the breakdown, Leafly cart reader, search rules, cancel reasons, and ticket-line conversion
- `src/lib/pos/pickup-menu-facts.ts` (new): vendor, brand, type and category from the menu
- `src/lib/pos/pickup-store.ts`: the detailed order view, and `cancelPickupAtRegister`
- `src/lib/pos/pickup-core.ts`: newest-first sort, and the order name on each queue tile
- `src/app/api/pos/pickup/route.ts`: the cancel request, with manager PIN
- `src/app/pos/RegisterShell.tsx`: the new window
- `src/lib/printing/receipt-escpos-core.ts`, `printer-store.ts`, `src/app/api/orders/route.ts`, `src/lib/leafly/bridge-server.ts`: the detailed ticket
- Tests: `tests/compliance/pickup-register-cancel.test.ts` (new), `pickup-core.test.ts`, and the self-test runner
