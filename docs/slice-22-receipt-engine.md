# Slice 22b — The enterprise receipt, and the one line of law we were breaking

## What the owner asked

Michael, verbatim, in the message that opened this slice:

> "next, I want to have a much more professional enterprise grade receipt that prints out. please deep research industry best practices and standards. I want a professional enterprise grade receipt. it should conform to all ccrs, it should have our return policy on it, it should have our logo on it, it should have our fancy greenway marijuana text as the top header. I want to be able to adjust and modify and add and remove and change the receipt via settings in admin settings. please give me a superb and really great receipt feature. we are a cannabis shop and like to have fun and customize as much as possible to showcase our unique flare and style."

And then, after the CCRS research came back, in the message that set the final scope:

> "I didn't know there wasn't CCRS on receipts. I assumed the 4 advertising warnings were required. But if not then great leave them out, it's too wordy. I want a great receipt that's professional and enterprise grade. I want it to be data rich so the customer knows exactly what they got and will be impressed with how awesome the receipt is. Follow the standing rules and never guess never assume. Go above and beyond. Add value however you can."

The standing rule governs all of it — *do not guess, do not assume; we build from fact, not memory.*

## The headline: you asked for a nicer receipt and we found a legal defect

You asked me to make the receipt conform to CCRS. The research says CCRS has nothing to do with receipts. But in going looking, I found something that does — and we were failing it.

**RCW 69.50.535(1)(a)**, verbatim:

> "The tax must be separately itemized from the state and local retail sales tax on the sales receipt provided to the buyer."

Until this slice, every receipt this store printed carried exactly one combined tax row. Here is the line, as it stood in `src/lib/pos/receipt-core.ts` before this slice:

```
`<tr><td class="n">Tax</td><td class="a">${formatMoneyMinor(input.taxMinor)}</td></tr>`,
```

One row. `Tax`. The 37% cannabis excise and the 9.3% state-and-local retail sales tax fused into a single number, which is precisely the fusion that sentence of statute exists to forbid. Of everything on a cannabis receipt, the separate itemization of the excise is the one thing Washington actually legislates, and it was the one thing we were not doing.

That is now fixed, and it is the most important thing in this slice. The rest is craft.

## Setting the CCRS question straight

Because you raised it directly and because I am not going to let a wrong belief sit in your head about your own compliance posture, here is the finding stated plainly.

**CCRS does not govern receipts.** CCRS — the Cannabis Central Reporting System — is a *weekly CSV reporting* obligation. Licensees upload sale, inventory and transfer files to the LCB on a schedule. It specifies file layouts and submission deadlines. It says nothing whatsoever about what a customer's paper receipt must contain, because it never sees your receipts. There is no "CCRS-conformant receipt," and any vendor who tells you otherwise is selling something.

**The four advertising warning statements are not receipt requirements either.** Those live in **WAC 314-55-155(6)**, and that section governs *advertising* — signage, print ads, billboards, the things you buy to attract customers. A receipt handed to somebody who has already bought is not an advertisement. Your instinct that they were required was a reasonable one, and it is the kind of thing that quietly bloats a receipt for years because nobody re-reads the citation. They are left out, exactly as you asked, and now you know *why* it is safe to leave them out rather than just taking my word for it.

So the binding receipt-content rule for this store is the itemization sentence quoted above, and now we satisfy it.

## How the split is computed, and why it is harder than dividing by 1.463

The obvious approach is to take each line's inclusive price and divide by 1.463 to back out the two taxes. That approach is wrong here, twice over, and shipping it would have printed numbers that were confidently false. Two independent things break it.

**Category.** Accessories and merchandise carry only the retail sales tax. They never carry the cannabis excise, because they are not cannabis. Their divisor is 1.093, not 1.463. A basket containing a grinder and an eighth cannot be split with one shared divisor without inventing excise on the grinder that the customer never paid.

**Medical.** This is the subtle one, and it is the reason the code threads per-line flags rather than reading a single sale-level boolean. The two medical exemptions are *independent* of each other — a qualifying patient can be exempt from the sales tax, from the excise, or from both, depending on the product and their card. More than that, `applyMedicalPricing` **rebuilds** a carded line's inclusive price as base plus whatever taxes are still due. So the price sitting on that line already reflects the exemption. Dividing it by 1.463 would manufacture an excise figure for a patient who was never charged one, print it on their receipt, and make the parts disagree with the total they actually paid.

The fix is a per-line divisor that honours both facts, in `src/lib/pos/receipt-tax-core.ts`:

```ts
const cannabis = !isNonCannabisCategory(line.category);
const exciseApplies = cannabis && line.exciseExempt !== true;
const salesApplies = line.salesExempt !== true;
const exciseRate = exciseApplies ? CANNABIS_EXCISE_TAX_RATE : 0;
const salesRate = salesApplies ? LOCAL_SALES_TAX_RATE : 0;
const divisor = 1 + exciseRate + salesRate;
const base = lineTotal / divisor;
```

Only the taxes a line actually carries are backed out of that line's own price.

Every rate is **imported** from `src/lib/orders/order-pricing-core.ts`, never retyped. That file's own header calls itself the "SINGLE SOURCE OF TRUTH for the statutory tax rates," and it earned that title in an earlier slice when two hardcoded copies of the rates were found to have drifted apart. Typing `0.37` into the receipt file would have recreated exactly that bug in a place where it prints on paper. So the labels are generated too — "WA Cannabis Excise (37%)" is derived from `CANNABIS_EXCISE_TAX_BPS`, not typed. Change the rate constant and the printed percentage follows automatically. It is not possible for the label to lie about the rate that was charged.

### The printed parts always sum to what you charged

Backing out taxes involves division, and division involves rounding. Two independently rounded numbers do not reliably add back up to the number you started from, and a receipt whose parts do not sum to its total is worse than one that never split them at all — it looks like an error to the customer and it *is* an error to an auditor.

So the reconciliation is explicit. The authoritative tax figure is the one the drawer actually charged; it is never recomputed. The two components are derived, and the rounding residual is absorbed into the **larger** of the two, so the printed parts sum *exactly* to the amount charged, every time.

And when the numbers cannot be explained, the engine **refuses to guess**. `splitReceiptTax` returns `null` — which prints the honest single combined `Tax` row — when any line lacks a category, when the residual exceeds five cents, when the tax is negative or non-finite, or when a component would go negative. This is the standing rule expressed as control flow. A receipt that says "Tax" is merely less informative. A receipt that confidently prints a wrong excise figure is a compliance problem. When we do not know, we say less rather than inventing more.

This also means **older sales still print correctly.** A receipt reprinted from a payload that predates the rich fields simply falls back to the combined row and shows its correct total. Nothing that worked before this slice stopped working.

One happy discovery: `sale-event-core.ts:351` already *requires* a category snapshot on every stored sale line. That means historical reprints carry enough information to produce the statutory split too — your archive is not stuck with the old format.

## The logo prints when the internet is down

You asked for the logo and the Greenway Marijuana wordmark on the receipt. Getting that right required understanding how the printer actually renders, and the answer changed the implementation completely.

`ios/App/App/StarPrinterPlugin.swift:330` does this:

```swift
webView.loadHTMLString(html, baseURL: nil)
```

That `baseURL: nil` is decisive. With a nil base URL, a relative path like `/brand/logo.png` **has nothing to resolve against**. The natural implementation — reference the existing logo file by URL — would have produced a broken-image box on every printed receipt. Not sometimes. Always.

There is a second constraint stacked on top. The plugin renders the HTML in an offscreen WKWebView, reads `document.body.scrollHeight`, and snapshots at `:389-408`. If an image carries no explicit dimensions, the height is measured before the image has laid out, and **the receipt gets clipped**. So every image must carry explicit `width` and `height` attributes.

And a third: `buildPassPrntUrl` at `src/lib/pos/receipt-core.ts:380` percent-encodes the *entire* HTML document into a `starpassprnt://` URL. That is a hard size ceiling on the whole receipt.

So the logo is embedded as a base64 data URI, in `src/lib/pos/receipt-logo-core.ts`, with explicit dimensions. Measured, not estimated: the colour PNG base64 came to **197,252 bytes**, far too large to survive that URL. Converted to a 1-bit, 576-dot-wide bitmap — which is exactly what a thermal printer can physically reproduce, since it prints black dots and nothing else — it is **2,632 bytes**. About 1.3% of the naive version, with no visible loss, because the printer was never going to render the greyscale anyway.

The result: the logo prints from the device's own memory. No network request, no CDN, no DNS. **If your internet goes down mid-transaction, the receipt still prints with the logo on it.**

## The return policy cannot contradict the returns desk

You asked for the return policy on the receipt. The obvious implementation is to type the policy into a settings box. The failure mode of that implementation is that somebody changes the enforced return window in code and the paper keeps promising the old one — and the customer standing at your counter holding that paper is, quite reasonably, going to hold you to what it says.

So the default policy text is **generated** from `RETURN_WINDOW_DAYS`, the same constant `returns-core.ts:49` uses to actually enforce returns:

```ts
`Returns accepted within ${days} days of purchase (purchase day counts as day 0).`
```

Change the window and the printed policy follows it. The paper and the register cannot drift apart, because they are reading the same number. You can still override the wording entirely from admin settings when you want your own voice — that is your call to make — but the *default* is incapable of lying.

The generated text also states the conditions the code genuinely enforces: bring the receipt and the loyalty account used for the sale, product in original packaging with the lot/batch label legible (the **WAC 314-55-079(12)** condition), refunds to the original form of payment.

## Data rich: what the customer actually gets

You asked for a receipt that shows the customer exactly what they got. Concretely, each line can now print brand, size, THC potency and the deal that saved them money, and the sale gets a summary strip — item count, total weight, total saved.

Every one of those fields is **optional and omitted when unknown**. There are no `null`, `undefined` or `NaN` placeholders, and no empty labels sitting on the paper where a fact should be; a test asserts exactly that. A receipt that prints "Brand: undefined" looks worse than one that never promised a brand.

Small details that matter on a document a customer keeps:

- The variant is not repeated when it is already in the product name — no "Blue Dream (3.5g) · 3.5g".
- The per-unit price appears only when more than one unit was bought, because "1 @ $35.00 each" is noise.
- It says "1 item", not "1 items".
- The item count counts **units**, not distinct products: three grinders is three items.
- The total weight multiplies by quantity, and totals only the weights it actually knows.
- Weights round **up** at the half-cent-of-a-gram rather than truncating, so a printed weight never reads light. This one is not theoretical — see the mutation testing section below.

There is also a scannable **Code 128 barcode** of the receipt number. The returns desk currently looks a sale up by a number a manager retypes from paper; now it can be scanned. It is rendered as SVG by a dependency-free encoder — no image asset, no network — and a test asserts it encodes the *same* number `returns-core` looks up by, because a barcode that scans to the wrong identifier is worse than no barcode at all.

## Everything is yours to change

Admin → Registers → Receipt now controls all of it: the header and footer text, the address block, the logo and its width, the return policy wording, per-item detail, the sale summary, the barcode, and the tax itemization. The live preview renders through the **real** builder, not a mock-up, so what you see is what prints.

One control is deliberately different. The tax itemization toggle sits in its own bordered block, and switching it off raises a **red warning naming RCW 69.50.535(1)(a)**. It remains switchable, because it is your store and there may be a diagnostic reason to want the old behaviour for a moment. But it defaults ON, and it will never let you turn it off believing it is a cosmetic preference. Every other switch on that page is taste. That one is law, and the interface says so.

A reprinted receipt now also *looks* like the original. It previously fell back to bare defaults — no header, no address, no logo — because the reprint path never loaded your configuration. It does now. That was a pre-existing gap this slice closed on the way past.

## How this was verified

Nothing in this document is asserted from memory. Here is the evidence trail.

**Static gates.** `tsc --noEmit` reports **0 errors**. `eslint` reports **0 problems** across all twelve touched files.

**The full suite.** **573 test files, 14,548 tests, 0 failures.** The baseline before this slice was 572 files and 14,484 tests, so nothing was broken to make room for anything new.

**Pure self-tests.** Every core is self-testing and registered in the compliance sweep: receipt-core 63 assertions, receipt-tax-core 45, receipt-logo-core 21, receipt-config-core 19, returns-core all passed. The sweep ends with `ALL PURE SELF-TESTS PASSED`.

**The receipt was rendered and the arithmetic hand-checked.** The document was rendered to an image and read with human eyes — 585×1556 px. The money was verified independently of the code: excise 1644 + sales 515 = 2159 = total tax; subtotal 5541 + 2159 = 7700 = total. The parts sum to the whole on actual paper, not just in an assertion.

**The logo asset was verified byte-for-byte.** The embedded base64 round-trips to a valid 576×114 1-bit PNG. It is a real image, not a string that merely looks like one.

**The tests were themselves tested.** You said "test everything including the tests," so the test suite was attacked directly. Forty deliberate defects were introduced into the receipt engine one at a time — dropping the sales tax from the divisor, charging excise on merchandise, ignoring a medical exemption, mis-scaling the printed percentage, linking the logo by URL, dropping the explicit image dimensions, hardcoding a return window that contradicts the constant, dropping the category on reprint, and thirty-two more. **Thirty-seven of the forty were caught.**

That campaign was not a formality; it found three real holes and one real bug.

Three mutations survived on the first pass and each one exposed a genuine gap: charging sales tax on a sales-exempt patient line, leaving the rounding residual unabsorbed, and taxing one unit instead of multiplying by quantity. Each was diagnosed empirically rather than by inspection, a targeted test was added, and each now fails the mutant.

A fourth survivor was the interesting one. The mutation "let float noise into printed weights" — replacing the scale-then-round with a bare `toFixed(2)` — initially survived, and the easy conclusion was that it did not matter. It does. A 500,000-trial random probe found nothing, because random floats never land on exact decimal values. A deterministic sweep of the decimal grid found **12,549** disagreements. The question that settled it was whether such a weight is *reachable* from real inventory, and it is: `normalizeUnitGrams` rounds unit weights to three decimals and `gramsFromVariantLabel` parses a label like `0.075g` straight off the published menu. A 0.075g sample prints as **0.07g** under the mutant and **0.08g** correctly. The receipt would have read **light**. On a cannabis receipt, where the printed weight is the customer's own cross-check against their daily purchase limit, that is not a rounding curiosity. A test now pins it.

The three that still survive are **proven equivalent mutants**, not test holes, and the distinction was established by evidence rather than by argument:

- The exact-reconciliation guard and the negative-tax guard are unreachable given the guards that surround them. A 300,000-trial randomized probe fired the reconciliation guard **0 times**, and reached the negative-tax condition 6,234 times with **0 escapes** — every one was already caught by the later negative-component check.
- The escaping of the summary strip currently cannot matter, because all three producers of that strip emit only digits, `g`, `$`, `.` and spaces. A 1.2-million-case probe found **zero** HTML-significant characters.

All three are **kept**. On a tax document, a redundant guard is cheap and a missing one is expensive; and the escape becomes load-bearing the moment anyone puts a product name in that strip. All three are now commented in the source with this evidence, so that a future reader — including a future me — does not delete them as dead code and quietly reintroduce the risk.

## What is not in this slice

The fun receipt-number overlay for walk-in orders is **not** here. You said you were still thinking about it, so it waits for you. The design question that needs your answer is whether a walk-in's fun number should be *derived* from the sale's own UUID — which works offline, never runs out, and needs no server call — or *consumed* from the same pool the online orders draw from, which guarantees uniqueness across both channels but requires a round trip and therefore cannot work when the internet is down. There is a real trade-off there and it is yours to make, not mine to assume.

## Files

New: `src/lib/pos/receipt-tax-core.ts`, `src/lib/pos/receipt-logo-core.ts`, `tests/compliance/receipt-engine.test.ts`, `scripts/preview-receipt.ts`.

Extended: `src/lib/pos/receipt-core.ts`, `src/lib/pos/receipt-config-core.ts`, `src/lib/pos/receipt-reprint-core.ts`, `src/lib/pos/receipt-reprint-store.ts`, `src/lib/pos/returns-core.ts`, `src/app/pos/SaleFlow.tsx`, `src/components/admin/registers/ReceiptConfigEditor.tsx`, `src/app/admin/registers/receipt/actions.ts`, `scripts/compliance/run-pure-selftests.ts`.
