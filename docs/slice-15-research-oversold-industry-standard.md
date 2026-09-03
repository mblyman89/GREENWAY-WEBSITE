# Slice 15 Research — What Should a Register Do After an Override (Oversold) Sale?

**Question asked by the owner:** when a sale completes that used the "Sell anyway" stock
override, what is the enterprise industry standard for what the register should do? The
instruction was explicit: find a definitive, authoritative-backed answer and build from it,
rather than inventing a behaviour.

This document records what the research found, with the source for every claim, and then
states the design that was built from it. Nothing in the build section was decided by
intuition; every element traces to a cited source or to a Washington regulation.

## 1. The sources consulted

Four independent authoritative sources were consulted, chosen because each is either a
vendor's own product documentation for a shipping enterprise point-of-sale system, or the
binding regulation that governs this specific store.

The first is Lightspeed Retail POS (R-Series), via its own support documentation on
"Understanding the Negative inventory report" and "Correcting negative inventory." The
second is Shopify, via its Help Center article "Selling out of stock products" and the
companion Shopify POS inventory management documentation. The third is Oracle NetSuite, via
its published guidance "Inventory Cycle Counting 101: Best Practices & Benefits." The fourth
is the Washington Administrative Code itself, specifically WAC 314-55-083 and WAC 314-55-087,
which are binding on a Washington cannabis retail licensee and therefore outrank any vendor
convention where the two disagree.

## 2. Finding one — the sale is never blocked, and the warning comes *before* completion

Shopify states the position about as plainly as a vendor can. Its documentation says that
the "Continue selling when out of stock" setting "doesn't apply to orders placed from
Shopify POS. Staff can continue selling products when available inventory reaches zero and
below. POS warns staff before they sell an item that's not available."

Two things are established by that sentence. The first is that in-person retail is treated
differently from e-commerce on purpose: the online store may refuse an out-of-stock order,
but the register does not, because the customer is standing at the counter holding the
product. The second is the placement of the warning. It is *before* the sale, at the moment
of adding the item. It is not a post-sale artifact.

Lightspeed independently arrives at the same placement. Its documentation describes an alert
on the Sell screen warning that stock is insufficient and that completing the sale will drive
inventory negative — again, shown at the point of sale, before the transaction is finalised.

The practical conclusion is that a register should warn at the moment of the override and
should then get out of the way. Neither vendor interrupts the completion of the sale, and
neither vendor puts anything about the stock discrepancy on the customer's receipt. That
last point deserves emphasis because it was one of the candidate designs considered: no
source examined places the oversold notice on the customer-facing receipt. The discrepancy
is an internal inventory-control record, not information the customer needs or should be
handed.

## 3. Finding two — the variance is recorded with full attribution, and surfaced in a back-office working list

This is where the industry standard is most specific, and Lightspeed's implementation is the
most detailed of those examined. Lightspeed ships a dedicated Negative Inventory report,
reached under Reports, which lists every item whose quantity on hand has gone negative. The
report's columns are worth listing in full because they define what the industry considers
the minimum useful record of an oversold event: the item ID, the item name, the quantity on
hand, the inventory adjustment reason (distinguishing a *Sale* from *Removed for transfer* or
*Returned to vendor*), the source — meaning the specific sale that caused it — the quantity
removed, the unit cost, the employee who processed the transaction, the date and time, the
shop, and whether stock is already incoming on a purchase order or transfer.

The report is filterable by item, date range, shop, vendor, and reason, and it can be printed
or exported to CSV.

The design lesson is that recording an oversold event is not the same as merely logging it.
The event has to be *attributed* — who did it, at which register, in which sale, on which
product, at what time, and by how much — and it has to be *aggregated into a working list*
that a manager opens and works through. A line buried in a log that nobody reads is not a
control. The columns also show that the item stays on the list until the count is corrected;
the report is a live queue of unresolved discrepancies, not a historical archive.

## 4. Finding three — an oversell is an event that *triggers* a count, and the trigger is named

NetSuite's cycle-counting guidance supplies the vocabulary for the pattern and confirms it is
an established method rather than an improvisation. Among the recognised methods of cycle
counting it lists "Opportunity-based," which it defines as "a form of cycle counting based on
opportunities, such as critical points of the inventory management process, like when an item
is ordered or put away. These can be exception-based cycle counts, such as when the stock
goes below its predetermined threshold, or when short-picks occur."

An oversell at a register is exactly a short-pick: the system believed there were fewer units
than were physically present, or a unit left the shelf without being recorded. NetSuite's
guidance is that this class of event should itself generate a count task.

The same document also describes the closely related "zero count" practice, quoting NetSuite
practice director Bill Conway: "If warehouse processes cause an empty bin by a picking order,
then a command is given to the warehouse worker to have them count the bin and confirm it is
empty. This action quickly verifies that the bin is empty and will help the facility confirm
that the count completion of the item warehouse location level was correct."

That is the authoritative basis for prompting staff at the end of an override sale. The
prompt is not a scolding and not a blocker; it is a count command issued at the moment the
discrepancy is discovered, while the person who can resolve it is standing in front of the
product.

Lightspeed closes the same loop from the other end. Its remediation guidance for negative
inventory is to identify the cause and then correct it, either by refunding or voiding an
erroneous sale, by receiving quantities that are genuinely still sitting on an open purchase
order or transfer, by adjusting the quantity on hand directly from the report, or by running
a named inventory count — it recommends naming the count for the occasion, for example
"Negative Inventory - May 22, 2019" — sorting by the "Should have" column so the negative
items rise to the top, and then reconciling.

Cova, writing specifically about cannabis retail, corroborates the general shape for this
industry: it advises reconciling counts with system data, flagging any discrepancy, and using
a point-of-sale system that logs adjustments and captures a reason for each discrepancy so it
can be investigated later.

## 5. Finding four — for this store the record is not optional, it is required by rule

Vendor convention explains what good systems do. Washington law states what this particular
store must do, and it is the stricter of the two.

WAC 314-55-083(4) requires that a cannabis licensee track cannabis from seed to sale and that
the required information be "kept completely up-to-date," and subsection (g) of that rule
names among the required information "a complete inventory of all cannabis, seeds, plant
tissue, seedlings, clones, all plants, lots of useable cannabis or trim, leaves, and other
plant matter, batches of extract, cannabis concentrates, cannabis-infused products, and
cannabis waste." Subsection (i) separately requires all point-of-sale records.

WAC 314-55-087(1) requires that records be kept and maintained on the licensed premises for
a five-year period and made available for inspection on request by an LCB employee, and
subsection (k) of that list names "Inventory records" explicitly.

Most directly on point, WAC 314-55-087(2) addresses the situation where a licensee keeps
records inside a point-of-sale system, which is precisely what this software is. It requires
that such a system "include a method for producing legible records that will provide the same
information required of that type of record," and it sets two tests the system must satisfy.
Subsection (a) requires that it "provides an audit trail so that details (invoices and
vouchers) underlying the summary accounting data may be identified and made available upon
request." Subsection (b) requires that it "provides the opportunity to trace any transaction
back to the original source or forward to a final total."

An oversold sale is the exact circumstance in which a naive system loses that trail. The
physical count and the recorded count diverge, and if the divergence is not captured with its
originating transaction, there is no longer a path from the inventory number back to the sale
that changed it. Recording the oversell with its sale, its register, its operator, and its
timestamp is therefore not a nicety layered on top of the industry standard; for this
licensee it is how the system stays inside WAC 314-55-087(2)(a) and (b).

This regulatory finding also settles a question the vendor sources leave open. Lightspeed
lets quantity on hand go negative and reports on it. A cannabis system reporting into state
traceability cannot send a negative on-hand figure, which is why the existing code in this
repository clamps the stored level at zero. The clamp is correct and must stay. But the clamp
destroys information — once the level is pinned at zero, the size of the discrepancy is no
longer recoverable from the level alone. That is the strongest argument for capturing the
variance as its own attributed record at the moment of the sale, which is what the industry
does anyway.

## 6. The definitive answer, and the design built from it

Drawing the four sources together, the enterprise standard for a register at the end of an
override sale has five parts, and they are consistent across every source examined.

The sale completes normally and is never blocked, because the warning already happened at the
point of adding the item. Nothing about the stock discrepancy appears on the customer's
receipt. The variance is written as an attributed record naming the product, the expected
count, the quantity sold, the shortfall, the sale, the register, the operator, and the
timestamp. The affected product is placed on a persistent back-office working list that keeps
listing it until someone reconciles the count. And the staff member at the counter is issued
a count command at the moment of discovery — NetSuite's zero-count pattern — asking them to
verify the physical count of the product they just sold past zero.

The build follows that answer exactly. At the end of a sale that used the override, the
register shows a non-blocking count prompt naming the specific products to recount, the sale
still completes and still locks as it does today, the receipt is untouched, the variance is
recorded with full attribution, and the product carries a recount flag that persists until it
is cleared, mirroring Lightspeed's report behaviour and satisfying the audit-trail tests in
WAC 314-55-087(2).

## 7. Sources

Lightspeed Retail POS (R-Series), "Understanding the Negative inventory report,"
https://retail-support.lightspeedhq.com/hc/en-us/articles/220357367

Lightspeed Retail POS (R-Series), "Correcting negative inventory,"
https://retail-support.lightspeedhq.com/hc/en-us/articles/229128108

Shopify Help Center, "Selling out of stock products,"
https://help.shopify.com/en/manual/products/inventory/setup/selling-when-out-of-stock

Shopify Help Center, "Inventory management" (Shopify POS),
https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management

Oracle NetSuite, "Inventory Cycle Counting 101: Best Practices & Benefits,"
https://www.netsuite.com/portal/resource/articles/inventory-management/using-inventory-control-software-for-cycle-counting.shtml

Cova, "Cannabis Inventory Management: The Complete Guide for Dispensary Operators,"
https://www.covasoftware.com/cannabis-inventory-management

WAC 314-55-083, "Security and traceability requirements for cannabis licensees,"
https://apps.leg.wa.gov/Wac/default.aspx?cite=314-55-083

WAC 314-55-087, "Recordkeeping requirements for cannabis licensees,"
https://apps.leg.wa.gov/Wac/default.aspx?cite=314-55-087
