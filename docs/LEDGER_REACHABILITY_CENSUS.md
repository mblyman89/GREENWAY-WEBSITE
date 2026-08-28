# Ledger reachability census

**This file is generated.** Edit `src/lib/accounting/ledger-census-data.ts` and re-run
`npx tsx scripts/compliance/build-census-doc.ts`. A stale copy fails a test.

## What this is

Every event in the business that moves money, and an honest answer to one question
for each: does it actually reach the accounting books? Not *should* it, and not *is
there code for it* -- does a real click by a real person land a real journal entry.

The answer is measured, never assumed. Each cell cites what was checked.

## The headline

> 35 money events that should reach the books. 24 cannot reach them at all. 18 have nothing that builds the entry, so wiring alone will not fix them. 2 are proven on all six layers. 5 carry a layer this census could not measure, and say so.

| | count |
|---|---:|
| Money events catalogued | 35 |
| Proven on all six layers | 2 |
| Cannot reach the books at all | 24 |
| Have nothing that even builds the entry | 18 |
| Layers that could not be measured | 5 |

## The six layers

A thing can be broken in six different places between a click and a correct set of
books. Each is checked separately, because each fails separately.

| layer | question | why it is checked on its own |
|---|---|---|
| `exists` | Is the journal entry built anywhere? | The cheapest layer. A pure test proves the arithmetic agrees with itself, which is necessary and nowhere near sufficient. |
| `reachable` | Can a real action in the app actually reach it? | The books-69 and books-70 finding in one line: a perfect core that no screen calls posts nothing. Nothing pure can see this, because purity is the absence of the wiring in question. |
| `correct` | Is the entry balanced, with the right accounts and 280E class? | Balanced, real accounts, and the 280E cost class carried — because a balanced entry into the wrong account is still wrong, and in this industry the wrong cost class changes the tax owed. |
| `accepted` | Does the real database accept it? | Cannot be simulated. A journal with source_kind 'manual' touching control account 10300 is refused by migration 0172 and passes every pure test ever written. |
| `idempotent` | Does running it twice leave the books unchanged? | The ledger keys on entity:source_kind:source_ref. A ref that is not unique per event does not double-post, it silently MERGES two events — and the books still balance afterwards, which is what makes it dangerous. |
| `married` | Is the bank feed matched to it instead of booked again? | The same dollar arrives from two sources: the system that spent it and the bank feed that saw it leave. Booking both is an error that survives an audit, because each number is individually correct and the bank still reconciles. |

Legend: `yes` proven, `NO` missing, `part` partial, `n/a` not applicable, `?` unmeasured.

## Where the gaps are, by layer

| layer | rows missing |
|---|---:|
| `exists` | 17 of 35 |
| `reachable` | 24 of 35 |
| `correct` | 14 of 35 |
| `accepted` | 22 of 35 |
| `idempotent` | 21 of 35 |
| `married` | 13 of 35 |

## Sales, and the tax you collect on someone else's behalf

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `retail_sale` | yes | yes | part | part | part | n/a | D-31 |
| `excise_liability_split` | NO | NO | NO | NO | NO | n/a | D-32 |
| `discount_and_comp` | NO | NO | NO | NO | NO | n/a | D-31 |
| `refund_or_return` | NO | NO | NO | NO | NO | n/a | D-31 |

### `revenue_and_tax_collected.retail_sale`

A customer buys product at the counter and pays. The price on the shelf already includes both taxes.

- Accounts: `10110`, `50010`, `32000`, `32100`
- Builds the entry: `src/lib/accounting/sale-journal-core.ts#buildSaleJournal`
- Posts the entry: `src/lib/accounting/sale-posting-service.ts#postSaleForOrder`

- **exists: PRESENT** -- books-77 built sale-journal-core.ts#buildSaleJournal; grep -rn 'sourceKind: "pos_sale"' src/ -> 2 hits, both in that builder (the revenue half and the COGS half).
- **reachable: PRESENT** -- books-82 wired it. orders-store.ts#setOrderStatus calls sale-posting-service.ts#postSaleForOrder on the transition into 'completed' — the same status revenue-basis.ts pins revenue to — and that service posts the revenue half via posting-service.ts#submitJournal. tests/compliance/sale-posting-wiring.test.ts asserts the call, the completion gate and the pre-decrement ordering; each was mutation-probed and fails when broken.
- **correct: PARTIAL** -- Both halves pass the real ledger-core.ts#validateJournalDraft with zero issues, balance to the cent, and reconstitute the tax-inclusive price exactly across a sweep of all 21 categories. 8 of 8 mutants caught. books-82 closed the costing half: sale-cogs-core.ts#costSaleFromDraws now sources line cost from the actual FIFO lot draw, replanned with the decrement's own buildLotDecrementPlan. STILL PARTIAL: the draw is reconstructed rather than read back from the decrement, which persists no machine-readable per-lot draw (D-65).
- **accepted: PARTIAL** -- pos_sale is in AUTOPOSTABLE_SOURCE_KINDS (posting-core.ts:112) and the 0172 GL_CONTROL_ACCOUNT refusal is gated on source_kind='manual', so a pos_sale entry may legitimately touch 32000/32100. Never yet presented to a live gl_post_journal().
- **idempotent: PARTIAL** -- sourceRef is the POS order ref, and the COGS half uses '<ref>#cogs' so the two halves cannot collide on the natural key. Untested against a live unique index.
- **married: NOT_APPLICABLE** -- Cash and card settlement are separate events, censused below. _The sale itself has no second arrival. The DEPOSIT of its proceeds does, and that is a different row._

**If this stays broken:** This is the single largest number in the business. books-77 built the entry that records it: revenue NET of excise, and both taxes EXTRACTED from the tax-inclusive shelf price into trust liabilities rather than added on top. It is still not WIRED, so today the books remain empty of sales — the gap moved from 'nothing computes this' to 'nothing calls it'.

### `revenue_and_tax_collected.excise_liability_split`

The 37% cannabis excise inside a tax-inclusive price is separated from the retail sales tax, because they are owed to different places.

- Accounts: `32000`, `32100`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'sourceKind: "excise"' src/ -> 0 hits.
- **reachable: MISSING** -- No caller anywhere; excise has zero producers.
- **correct: MISSING** -- Blocked upstream: the `orders` table (migration 0007) has no excise column. It carries estimated_tax_minor_units, subtotal_minor_units and total_minor_units only, so 32000 and 32100 cannot be told apart from stored data.
- **accepted: MISSING** -- excise is autopostable per posting-core.ts:114; never presented.
- **idempotent: MISSING** -- No sourceRef convention defined.
- **married: NOT_APPLICABLE** -- An accrual of tax collected is not a bank movement. _The excise PAYMENT to DOR is a bank movement and is censused separately._

**If this stays broken:** 32000 is TRUST money — collected on the state's behalf, never Michael's. Booking it as revenue overstates income and understates a liability the state can audit.

### `revenue_and_tax_collected.discount_and_comp`

A discount, loyalty redemption or comped item reduces what is collected.

- Accounts: `50900`, `50000`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No pos_sale builder exists at all.
- **reachable: MISSING** -- Same as retail_sale: 0 hits.
- **correct: MISSING** -- Account 50900 Discounts & Comps is seeded (0173) and unused.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No sourceRef convention.
- **married: NOT_APPLICABLE** -- A discount never moves cash. _There is no bank line for money that was never collected._

**If this stays broken:** Without this, gross revenue and net revenue are the same number, which hides margin erosion and misstates the excise base.

### `revenue_and_tax_collected.refund_or_return`

A customer returns product, or a sale is voided after tender.

- Accounts: `50910`, `10110`, `32000`, `32100`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No pos_sale builder.
- **reachable: MISSING** -- 0 submitJournal hits under src/lib/pos/.
- **correct: MISSING** -- A refund must also reverse the two trust liabilities, not just revenue. 50910 Returns & Refunds is seeded and unused.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- Highest-risk idempotency case in the family: a retried refund that double-posts hands money back twice in the books.
- **married: NOT_APPLICABLE** -- Cash refunds leave the till, not the bank. _Card refunds appear in the settlement row, which is censused there._

**If this stays broken:** Refunds reduce the excise Michael owes. Not booking them means overpaying trust tax, and there is no record to claim it back with.

## Inventory and cost of goods sold

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `cogs_on_sale` | yes | yes | part | part | part | n/a | D-33 |
| `cutover_inventory_load` | part | NO | ? | part | NO | n/a | D-48 |
| `cultivera_manifest_import` | part | NO | part | NO | part | NO | D-49 |
| `inventory_receipt` | yes | yes | yes | yes | yes | NO | D-34 |
| `inventory_audit_adjustment` | yes | yes | yes | yes | yes | n/a | -- |
| `freight_in` | NO | NO | NO | NO | NO | NO | D-34 |

### `cost_of_goods_sold.cogs_on_sale`

Product leaves the shelf, so its cost has to move from asset to expense.

- Accounts: `60010`, `20010`
- Builds the entry: `src/lib/accounting/sale-journal-core.ts#buildSaleJournal`
- Posts the entry: `src/lib/accounting/sale-posting-service.ts#postSaleForOrder`

- **exists: PRESENT** -- books-77: buildSaleJournal returns cogsJournal alongside revenueJournal and there is no way to ask for the revenue half alone. Re-measured the old 'cogs-position-core -> 0 importers' claim: 5 files mention the name but grep for a real 'from ".../cogs-position-core"' -> 0, so the original 0 was right and is now stated precisely.
- **reachable: PRESENT** -- books-82 wired it with retail_sale, as predicted — the two shipped together. postSaleForOrder posts the COGS half under sourceRef 'order:<id>#cogs', distinct from the revenue half's '#revenue' so the ledger's own (entity, kind, ref) idempotency cannot collapse them.
- **correct: PARTIAL** -- Debits 6xxxx and credits the mirrored 2xxxx on the same category slug via coa-core helpers, carries cost_class 'cogs_direct' as 0173 requires (GL_COST_CLASS_REQUIRED), and refuses with UNIT_COST_UNKNOWN rather than booking a sale at zero cost. books-82 supplied the missing half: sale-cogs-core.ts extends the FIFO lot draw by inventory_lots.unit_cost_minor_units and REFUSES (LOT_COST_MISSING) rather than averaging over an uncosted lot. Split costs were measured exact across 500 three-way splits. STILL PARTIAL for the D-65 reconstruction gap.
- **accepted: PARTIAL** -- Passes validateJournalDraft against 0173-shaped accounts with zero issues. Not yet presented to a live gl_post_journal().
- **idempotent: PARTIAL** -- sourceRef '<orderRef>#cogs'. Untested against a live unique index.
- **married: NOT_APPLICABLE** -- COGS is an internal reclass. _No cash moves, so no bank line can duplicate it._

**If this stays broken:** Under IRC 280E, COGS is the ONLY deduction a cannabis retailer gets. An unbooked COGS is tax paid on gross receipts instead of gross profit — the most expensive single gap in this census. books-77 closed the arithmetic and bound it to the sale so it cannot be forgotten; the wiring remains.

### `cost_of_goods_sold.cutover_inventory_load`

THE CUT-OVER. Inventory is counted on 2026-10-31 after close and loaded into this platform on 2026-11-01 before open, carrying its value from Cultivera. This is the single largest asset number the books will ever receive, and it arrives once.

- Accounts: `20000`, `20010`, `20890`, `40400`
- Builds the entry: `src/lib/accounting/cutover-inventory-core.ts#buildCutoverInventoryPlan`
- Posts the entry: **nothing**

- **exists: PARTIAL** -- books-72 WROTE THE BUILDER: cutover-inventory-core.ts, a pure leaf with zero imports. buildCutoverInventoryPlan() turns a counted lot list into a balanced opening-balance line set — per-category 200xx debits and ONE 40400 credit — and returns a refusal rather than a half-usable result. Gated twice: __runCutoverInventoryCoreTests() in run-pure-selftests.ts, plus 45 vitest assertions in tests/compliance/cutover-inventory-core.test.ts that check parity against coa-core.INVENTORY_CATEGORIES, vendor-bill-core.CATEGORY_SLOTS and the real 0173 seed text. PARTIAL, not COMPLETE, because the builder is only the ENTRY: no migration, no UI, no server action and no posting call exist, so nothing can present its output to gl_opening_balances yet. inventoryAccountForCategory (vendor-bill-core.ts:966) already solved the ACCOUNT side; books-71 measured the CATEGORY side solved too (transform.ts CATEGORY_MAP covers 52 of 52 Cultivera categories, 100.00% of value, $0.00 to 20890 quarantine). books-73 THEN GAVE THE LEDGER ITS OWN MAP on Michael's decision: 'the ledger should use its own accounts and not the website map.' ledger-category-map-core.ts is a second pure leaf (zero imports) mapping 53 Cultivera categories to 16 block-2 accounts, with the four D-50 overrides applied (RSO 20150, Tincture 20180, Infused Blunt 20100, Blunt 20070 = $6,900.07 re-routed), NO fallback account, and CATEGORY_UNKNOWN naming anything it has not seen. Gated twice (self-tests + 42 vitest assertions) and hardened by 39 mutants, 39 dead, 0 survivors.
- **reachable: MISSING** -- STILL MISSING ON PURPOSE after books-72. The builder exists but NOTHING CALLS IT: grep -rn 'buildCutoverInventoryPlan' src/ finds only its own definition, and the only other references are the test and the self-test runner. src/app/admin/books/conversion/page.tsx is 361 lines and deliberately read-only: grep for 'rpc(' in it -> 0 hits, and its own header says 'Nothing here posts anything.' No src/ file inserts into gl_opening_balances; ledger-store.ts:458 only SELECTs from it. Writing a builder does not make a path reachable, and recording otherwise would be the exact overstatement this census was built to prevent. books-73: this is now a DELIBERATE DEFERRAL with an owner quote behind it, not an unmeasured gap. Michael: 'we are not ready to migrate inventory over yet.' It must not be marked reachable until he asks for the wiring.
- **correct: UNKNOWN** -- The account side is determined: 0173 seeds 21 per-category inventory accounts under control account 20000, and gl_guard_inventory_manual (0173:316) REFUSES any source_kind='manual' line touching a 2xxxx asset, so this load must be source_kind 'opening_balance', 'inventory' or 'purchase' by database law, never a typed journal. _Michael's Cultivera export has now been MEASURED (books-71 recon, scripts/recon/cultivera-measure.py): INVENTORIES.xlsx carries a usable non-zero Cost on 3,917 of 3,917 rows, zero blanks, zero zeros, zero negatives, extending to $176,824.62 and cross-verified by parsing the raw sheet XML. So per-unit cost EXISTS. THE LANDED-VS-INVOICE QUESTION IS NOW CLOSED by the owner directly: 'The cost from Cultivera is the invoice cost. There isn't any other cost associated with inventory purchases unfortunately... All that matters is the cost from the spreadsheet is the all inclusive cost for that product.' So the builder adds nothing to it. ONE unknown remains and it is not a code question: the 2026-10-31 physical count has not happened, so the actual quantities do not exist yet. Rule 1: the census will not invent the largest asset figure on the balance sheet. (Employee hours capitalised into COGS were explicitly excluded from this slice by the owner and are NOT modelled.) books-73 CLOSED THE BARCODE QUESTION: 41 barcodes repeat, 6 groups at DIFFERENT costs, and Michael said 'keep both layers.' So the builder keys on Id (3,917 distinct, 0 duplicates), never Barcode, and no cost is averaged. It already behaved this way, so the answer confirms the build rather than changing it._
- **accepted: PARTIAL** -- Migration 0186 already moves the opening-balance date to 2026-10-31, matching Michael's stated cut-over, and records that the old hard-coded 2025-12-31 would have stamped it TEN MONTHS EARLY while balancing. 0176:76 lists 'inventory_count' as a valid evidence_kind, so the worksheet is designed to accept exactly this row. Nothing has presented one.
- **idempotent: MISSING** -- Loading the cut-over count twice would double the largest asset on the balance sheet. gl_ob_guard_frozen (0176:162) freezes rows once blessed, which protects the WORKSHEET, but no ref convention protects the load itself because no load path exists.
- **married: NOT_APPLICABLE** -- No bank row corresponds to a cut-over count. _This product was already bought and paid for under Cultivera and Sage. Its cash left the bank before this platform existed, so there is no second arrival to reconcile against._

**If this stays broken:** This is the number every subsequent COGS figure is measured from. Book it as a PURCHASE and the books invent an accounts-payable balance to vendors who were already paid, overstating liabilities and understating equity by the entire value of the shelf. Book it at the wrong value and every 280E cost-of-goods deduction for the life of the business inherits the error, and the balance sheet balances either way.

### `cost_of_goods_sold.cultivera_manifest_import`

AFTER cut-over: a Cultivera / WCIA transfer data link (or a batch of hundreds) is imported, staging a manifest whose lots later go on the shelf.

- Accounts: `20000`, `20890`, `30000`
- Builds the entry: `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- Posts the entry: **nothing**

- **exists: PARTIAL** -- The import parses cost: intake-parser.ts:375-380 computes unit_cost_minor_units as round(linePrice / qty * 100), and 0023/0028 store it on inventory_lots. But ccrs-manifest-csv-core.ts:495 hard-codes 'unit_cost_minor_units: null' for the CCRS CSV shape, because a CCRS transfer file carries no price. So cost survives the URL/PDF path and is absent on the CSV path. books-71 recon adds a second measured source of this hole: PRODUCTS.xlsx, the Cultivera catalog export, has Vendor Price BLANK on 3,311 of 3,311 rows, so the catalog side carries no cost either. Cost can only come from the INVENTORIES export or from purchase history.
- **reachable: MISSING** -- grep -n 'submitJournal|gl_' on src/app/admin/inventory/intake/actions.ts (821 lines, 21 exported actions incl. importManifestAction and finalizeManifestAction) -> 0 posting calls. BatchTransferImport.tsx states 'DRAFTS-ONLY'. Product reaches the shelf; value reaches nothing.
- **correct: PARTIAL** -- buildBillJournal resolves cannabis lines to the CATEGORY subaccount via inventoryAccountForCategory and falls back to 20890 quarantine on an unknown category rather than guessing (vendor-bill-core.ts:1140-1146). That is the right shape. Untested against a manifest, because no manifest has ever been handed to it.
- **accepted: MISSING** -- 'purchase' is a permitted source_kind in the 0172:277 CHECK and gl_guard_inventory_manual explicitly names it as a legitimate way for inventory to move. Never presented.
- **idempotent: PARTIAL** -- billSourceRef yields 'manifest:<n>', which is the correct key for a manifest-derived entry. The import itself de-duplicates URLs client-side and reports 'already imported', so the STAGING side is idempotent; the posting side has never run.
- **married: MISSING** -- The vendor is paid later by ACH and that payment arrives again through Plaid; 0067_vendor_manifest_payments.sql computes the owed total as SUM(received_qty * unit_cost_minor_units) but nothing books either side.

**If this stays broken:** Every post-cut-over delivery puts sellable product on the shelf with no corresponding asset or liability in the books. Inventory on hand grows, the ledger does not, and the gap is invisible because both systems are internally consistent. On the CCRS CSV path the cost is NULL, so even once wired that path would post a zero-value receipt unless it refuses instead.

### `cost_of_goods_sold.inventory_receipt`

A vendor delivery is received and the product goes on the shelf.

- Accounts: `20000`, `30000`
- Builds the entry: `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- Posts the entry: `src/lib/accounting/vendor-bill-service.ts#postManifestVendorBill`

- **exists: PRESENT** -- vendor-bill-core.ts exports a journal builder with account mappings and 280E cost classes.
- **reachable: PRESENT** -- books-83 wired it. finalizeManifestAction (src/app/admin/inventory/intake/actions.ts) calls vendor-bill-service.ts#postManifestVendorBill when a finalize activates at least one lot; that service reads the manifest's non-rejected lots, builds via buildBillJournal and posts through posting-service.ts#submitJournal. There is no separate bill-entry screen by design: vendor-payments/actions.ts records that an accepted manifest IS the WCIA invoice. tests/compliance/vendor-bill-wiring.test.ts asserts the call, the activated>0 gate and the rendered refusal; 8 mutations, 8 caught.
- **correct: PRESENT** -- Builder balances in its own self-tests, and every account it targets (including capitalisation codes 21500/21600/21700) is seeded: 0173 for the operating chart, 0178 for the fixed-asset block.
- **accepted: PRESENT** -- books-83: postManifestVendorBill posts through submitJournal, which calls the gl_submit_journal door and returns its refusal verbatim. Migration 0187's gl_post_vendor_bill remains uncalled; the entry reaches the ledger through the same door every other slice uses, so the 0187 door is redundant rather than missing.
- **idempotent: PRESENT** -- vendor-bill-core.ts#billSourceRef builds a real key: `manifest:<n>` when the bill came from an accepted manifest, else `bill:<vendor>:<invoice>`. books-83 made it live: re-finalizing a manifest returns outcome 'duplicate' and writes nothing. The ref differs from the receipt's `<n>#receipt`, so the two events cannot be mistaken for each other.
- **married: MISSING** -- Receiving goods creates a payable; paying it later is the bank event. No link exists between the two.

**If this stays broken:** Inventory purchases are the input to COGS. If receipts are not booked, the 20000 control account stays at zero and no COGS figure can be trusted.

### `cost_of_goods_sold.inventory_audit_adjustment`

A physical count finds more or less product than the system expected.

- Accounts: `20000`, `20810`, `60810`
- Builds the entry: `src/lib/inventory/inventory-audit-store.ts#postAuditSession`
- Posts the entry: `src/lib/inventory/inventory-audit-store.ts#postAuditSession`

- **exists: PRESENT** -- inventory-audit-store.ts:458 calls submitJournal with sourceKind 'inventory'.
- **reachable: PRESENT** -- One of only two live ledger writers in the whole platform, reached from the inventory audit screen.
- **correct: PRESENT** -- audit-posting-accounts.ts derives account codes from INVENTORY_CATEGORIES rather than a literal map, and a structural test enforces that.
- **accepted: PRESENT** -- Posts through submitJournal, which is the door migration 0174 governs.
- **idempotent: PRESENT** -- sourceRef is `audit:${sessionId}`, unique per session.
- **married: NOT_APPLICABLE** -- A count adjustment moves no money. _Nothing in the bank feed can correspond to a shrink write-off._

**If this stays broken:** This is the one path that already works end to end. It is the template the wiring slices should copy.

### `cost_of_goods_sold.freight_in`

An inbound delivery charge that belongs in the cost of the product.

- Accounts: `60800`, `30000`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder targets 60800.
- **reachable: MISSING** -- No purchase path posts.
- **correct: MISSING** -- 60800 Freight-In is seeded (0173) and never referenced in src/.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No sourceRef convention.
- **married: MISSING** -- Freight is usually paid by ACH and would arrive twice.

**If this stays broken:** Freight-in is 280E-deductible as part of inventory cost. Booked as an operating expense instead, it becomes non-deductible and raises tax owed.

## Buying from vendors, and paying them

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `purchase_order_commitment` | NO | NO | n/a | n/a | n/a | n/a | D-35 |
| `goods_received` | yes | yes | part | yes | part | NO | D-61 |
| `vendor_bill_recorded` | yes | yes | yes | yes | yes | NO | D-34 |
| `expense_classified_to_account_and_entity` | yes | yes | part | part | ? | n/a | D-56 |
| `vendor_paid_by_ach` | NO | NO | NO | NO | NO | part | D-36 |
| `operating_expense_from_bank` | yes | yes | yes | part | yes | n/a | D-37 |

### `vendor_cycle.purchase_order_commitment`

A purchase order is approved and sent to a vendor.

- Accounts: `20800`, `30000`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- 12 po-* modules under src/lib/purchasing/; grep for submitJournal or gl_post across all of them -> 0 hits.
- **reachable: MISSING** -- Zero ledger references in purchasing/.
- **correct: NOT_APPLICABLE** -- GAAP: an unfulfilled PO is a commitment, not a transaction. _A plain PO should NOT hit the ledger. Michael asked whether POs are 'properly booked' — the correct answer is that the RECEIPT is booked, not the order. This row exists so that answer is recorded rather than rediscovered._
- **accepted: NOT_APPLICABLE** -- Nothing should be presented. _No entry is due at commitment._
- **idempotent: NOT_APPLICABLE** -- No entry, no ref. _No entry is due at commitment._
- **married: NOT_APPLICABLE** -- No money has moved. _No entry is due at commitment._

**If this stays broken:** The gap is not the missing entry — it is that nothing connects an approved PO to the receipt that SHOULD post. In-transit inventory (20800) is the account that would carry it if goods ship before they arrive.

### `vendor_cycle.goods_received`

A delivery physically arrives and its cost becomes inventory.

- Accounts: `20010`, `20800`, `20890`
- Builds the entry: `src/lib/accounting/receipt-journal-core.ts#buildReceiptJournal`
- Posts the entry: `src/lib/accounting/receipt-service.ts#postManifestReceipt`

- **exists: PRESENT** -- receipt-journal-core.ts debits the category inventory account (or 20890 for an unmapped line) and credits 20800, balanced.
- **reachable: PRESENT** -- books-81 wired it. setManifestLifecycleAction (src/app/admin/inventory/intake/actions.ts) calls receipt-service.ts#postManifestReceipt when status flips to 'received'; that service translates lots, calls buildReceiptJournal, and posts via posting-service.ts#submitJournal. tests/compliance/receipt-wiring.test.ts asserts the call, the 'received' gate and the ordering, and all three were mutation-probed to confirm they fail when broken.
- **correct: PARTIAL** -- Balanced and integer-only; the receipt and the bill were added together and measured to net 20800 to 0 with inventory debited once (books-79). NOT PRESENT: the bill's goodsAlreadyReceived flag defaults false, so D-61 is still reachable by omission until a caller passes it. Also D-64: inventory_lots.category is free text, so receipt-category-core.ts refuses the whole delivery rather than guess an account, which is safe but blocks receiving on any spelling it does not know.
- **accepted: PRESENT** -- The receipt does not need a bespoke SQL door: postManifestReceipt posts through posting-service.ts#submitJournal, which calls the generic rpc('gl_submit_journal') door from migration 0174.
- **idempotent: PARTIAL** -- sourceRef is `${receiptRef}#receipt`, deterministic and distinct from the bill's manifest:/bill: keys, and it is now genuinely supplied by postManifestReceipt. NOT PRESENT: re-flipping a manifest to 'received' has not been measured end-to-end against gl_submit_journal's duplicate handling, so the guarantee is designed but unproven.
- **married: MISSING** -- receivedCentsForMatch feeds vendor-bill-core.ts#threeWayMatch, but nothing calls either, so the receipt and the invoice remain unlinked.

**If this stays broken:** This is where cost is born. Until it runs, inventory_lots.unit_cost_minor_units stays null and buildSaleJournal refuses with UNIT_COST_UNKNOWN, so no sale can post at all — and under 280E an unknown cost eventually becomes a lost deduction.

### `vendor_cycle.vendor_bill_recorded`

An invoice arrives from a vendor and becomes a payable.

- Accounts: `30000`, `20000`
- Builds the entry: `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- Posts the entry: `src/lib/accounting/vendor-bill-service.ts#postManifestVendorBill`

- **exists: PRESENT** -- vendor-bill-core.ts builds a full bill journal with cost classes.
- **reachable: PRESENT** -- books-83 wired it into finalizeManifestAction (src/app/admin/inventory/intake/actions.ts), gated on a finalize that activated at least one lot so a wholly rejected manifest never invents a payable.
- **correct: PRESENT** -- Balanced, every account seeded across 0173/0178, and books-83 closed D-61 on the live path: vendor-bill-service derives goodsAlreadyReceived from the LEDGER via receipt-evidence.ts, and REFUSES (BILL_RECEIPT_EVIDENCE_UNKNOWN) when the ledger cannot be read rather than defaulting to false. The builder's own default is still false, which is why the D-61 entry stays open as a builder-level trap for any future caller that bypasses this service.
- **accepted: PRESENT** -- Posts through posting-service.ts#submitJournal, i.e. the gl_submit_journal door, and surfaces its refusal to the screen. 0187's gl_post_vendor_bill stays uncalled and is now redundant.
- **idempotent: PRESENT** -- billSourceRef prefers the manifest number as the strongest external key and falls back to vendor+invoice. Live since books-83: a second finalize returns 'duplicate' and writes nothing.
- **married: MISSING** -- The bill and its later ACH payment are two events; nothing links them.

**If this stays broken:** Without payables, the balance sheet shows no money owed and cash-basis and accrual-basis results diverge silently.

### `vendor_cycle.expense_classified_to_account_and_entity`

A card swipe or bank debit at a named vendor has to become a specific account, on a specific entity's books, with a specific tax character.

- Accounts: `70010`, `70020`, `70030`, `70040`, `71010`, `76010`
- Builds the entry: `src/lib/accounting/expense-classification-core.ts#classifyExpense`
- Posts the entry: `src/lib/accounting/bank-expense-service.ts#recordBankExpenseLines`

- **exists: PRESENT** -- expense-classification-core.ts exports classifyExpense and the parameterized classifyIn; 50 tests in tests/compliance/expense-classification-core.test.ts plus a registered self-test in scripts/compliance/run-pure-selftests.ts.
- **reachable: PRESENT** -- books-88 finished this. It was claimed PRESENT in books-84 on the strength of recordBankExpenseLines calling classifyExpense({ merchant }) on every settled row -- true, but one link short of the owner: NOTHING CALLED THE SERVICE, so no merchant was ever classified in practice (D-70, found by Michael refreshing his ATM feed and getting no drafts). The full chain is now bank/page.tsx -> RecordBankExpensesPanel -> bank/actions.ts#recordBankExpensesAction -> recordBankExpenses -> recordBankExpenseLines -> classifyExpense -> submitJournal. Asserted by a reachability trap that walks src/ for a caller of the SERVICE and excludes this census file, because citing yourself is how a poster counts as reached while being dead. Note the seeded gl_account_rules table still has no TypeScript reader: the live rules are SEED_EXPENSE_RULES in the module, which is what the classifier's own tests measure (D-30 is unchanged).
- **correct: PARTIAL** -- MEASURED from Michael's five Sage exports (550 rows, $368,276.34; 60 distinct vendors). PARTIAL is itself the measurement: 54 of 60 vendors map to exactly one G/L account and are seeded; the other 6 hit two or three accounts in his own history (LIQUOR & CANNABIS BOARD, MICHAEL LYMAN, OFFICE DEPOT, SECRETARY OF THE STATE, STAPLES, VENTURE LIFE AND HEALTH) and are REFUSED as MERCHANT_AMBIGUOUS, so the classifier cannot finish 6/60 of vendors alone. Any vendor outside the seeded 54 returns MERCHANT_UNKNOWN: there is no fallback account, because a silent 76010 would be indistinguishable from a correct answer in every report (rule 48). Entity assignment is read from Michael's own account suffixes -- 81001/81002/81003-LYMAN utilities, maintenance and property tax, 121 rows / $61,109.02 -- not from judgement. Chart facts are drift-tested against migration 0173; the reseller COGS bar is mutation-verified across all 14 barred accounts (6/6 mutants caught, D-58).
- **accepted: PARTIAL** -- A door now accepts the decision: the classified account becomes the debit line of a 'bank' journal. The entry lands as a DRAFT, and books-85 built the path that drains drafts -- /admin/books/drafts plus approveAndPostJournal(), which calls gl_post_journal (D-67, closed). Still PARTIAL rather than PRESENT for one honest reason: no entry from this wire has been posted against a live database yet. The logic is swept and mutation-tested; the round trip is not proven. This reaches PRESENT on the first real post, not before.
- **idempotent: UNKNOWN** -- The module is pure and deterministic -- no clock, no randomness, no I/O, all asserted by test; normalizeMerchant is idempotent and first-match-wins is pinned, so the same vendor text always yields the same account, entity, cost class and provenance across repeated runs. _Deterministic is NOT the same as idempotent, and recording it as PRESENT here would conflate them. Idempotence is a property of POSTING -- classify the same bank line twice and the ledger still shows one entry -- and this module never posts, so the property is untested rather than satisfied. It resolves when a caller carries the decision through a door with a source_ref; the ref will have to come from the bank transaction id, because merchant text repeats every month._
- **married: NOT_APPLICABLE** -- classifyExpense takes merchant text and returns a decision; it never sees a bank feed and has no second arrival to reconcile against. _Classification decides how ONE arrival is characterised. The same dollar arriving twice -- once from the system that spent it, once from the Plaid debit that saw it leave -- is the payment event's problem, and it is already tracked on vendor_cycle.vendor_paid_by_ach. Marking this layer PRESENT here would double-count a control that lives elsewhere._

**If this stays broken:** This is the row that decides which entity's books a cost lands on and whether it is COGS or 280E-disallowed -- the two facts that set Michael's taxable income. A wrong cogs_direct on store rent or wages is the line an auditor pulls first: Reg. 1.471-3(b) allows a reseller only invoice price plus the cost of acquiring possession, and 263A(a)(2) bars capitalising anything 280E disallows. The classifier refuses that combination outright rather than letting it balance.

### `vendor_cycle.vendor_paid_by_ach`

Greenway pays a vendor by ACH through the system, and days later the bank debit shows up in Plaid.

- Accounts: `30000`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- nacha-core, vendor-ach-core, payee-banking-store and vendor-payables-store exist; grep for submitJournal across them -> 0 hits.
- **reachable: MISSING** -- Zero ledger references in the ACH stack.
- **correct: MISSING** -- No entry is built, so correctness cannot be measured.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No sourceRef convention for an ACH batch.
- **married: PARTIAL** -- src/lib/payments/vendor-reconcile-core.ts#reconcileVendorPayments already matches system payments to bank withdrawals with a tolerance. It returns matches and posts nothing.

**If this stays broken:** This is the exact double-booking risk Michael described. Both the system payment and the Plaid debit are individually correct, so booking both balances the books and doubles the expense.

### `vendor_cycle.operating_expense_from_bank`

A card or bank charge appears in the Plaid feed with no corresponding event inside the system.

- Accounts: `76040`, `10200`
- Builds the entry: `src/lib/accounting/bank-expense-core.ts#planBankExpense`
- Posts the entry: `src/lib/accounting/bank-expense-service.ts#recordBankExpenses`

- **exists: PRESENT** -- books-84. bank-expense-core.ts turns one settled Plaid row plus the owner-set account role into a balanced two-line entry; bank-expense-service.ts reads the feed and submits it. 24 tests, 12/12 mutants killed. Migration 0189's reconciliation suite (gl_post_bank_match et al) remains uncalled and is REDUNDANT here rather than missing: matching means 'this bank row and this EXISTING journal are the same money', and this family has no in-system counterpart to match to, so the entry must be created first.
- **reachable: PRESENT** -- books-88 built the door. recordBankExpenses(plaidAccountId) reads plaid_accounts + plaid_transactions and calls submitJournal, and that much was true in books-84 -- but the books-84 test asserted only that the SERVICE calls submitJournal, never that anything calls the service, and nothing did (D-70). The other three posters survived because each hangs off an event the system already raises (a sale, an intake, an audit); a bank feed raises none, which is precisely why this one was forgotten. The door is deliberately a button the owner presses on /admin/books/bank, not a background job: classification refuses unknown and ambiguous merchants by name, and a refusal nobody is looking at is a refusal nobody acts on. Asserted by a reachability trap covering all four posting services that walks src/ and excludes this census file.
- **correct: PRESENT** -- The two failure modes that still BALANCE are both gated. SIGN: plaid-money-core.ts:18-20 defines POSITIVE amount_cents as money LEAVING, so the expense is debited +amountCents and the funding account credited -amountCents; mutants M1/M2 invert this and are caught. 280E: migration 0172 check (7) demands a real cost class on the expense line and 'none' on the balance-sheet line, so the two lines deliberately differ; mutant M5 unifies them and is caught.
- **accepted: PARTIAL** -- Entries are created as DRAFTS. 'bank' is in AUTOPOSTABLE_SOURCE_KINDS, but auto-post also requires an approved template and no template rows are seeded, so nothing auto-posts in practice. The draft is no longer stranded: books-85 shipped the review screen and the approve/post service (D-67, closed), and 'bank' is one of the source kinds gl_guard_journal_approval exempts from a second signature, so it posts on one click. PARTIAL and not PRESENT because no bank entry has yet made that round trip against a live database.
- **idempotent: PRESENT** -- sourceRef is the Plaid transaction_id, unique in plaid_transactions and stable for a settled row, so submitJournal's (entity, sourceKind, sourceRef) key makes a re-run return outcome 'duplicate'. Pending rows are refused precisely because their id is NOT stable: Plaid replaces them on settlement. Mutant M10 makes the ref date-dependent, caught.
- **married: NOT_APPLICABLE** -- The bank feed IS the only source for this event. _There is no in-system counterpart to marry, which is what makes this family safe to auto-post and the right place to start wiring._

**If this stays broken:** These are the expenses Michael's CPA needs categorised for the return. It is also the lowest-risk wiring target, because nothing else can duplicate it.

## Paying people, and the taxes that go with it

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `payroll_run_accrued` | yes | yes | yes | yes | part | NO | D-68 |
| `net_pay_disbursed` | NO | NO | NO | NO | NO | part | D-38 |
| `payroll_tax_remitted` | NO | NO | NO | NO | NO | NO | D-38 |
| `garnishment_remitted` | NO | NO | NO | NO | NO | NO | D-38 |

### `payroll_cycle.payroll_run_accrued`

A payroll run is calculated: gross wages, employee withholding, employer taxes, and the split between shop labour and inventory-handling labour.

- Accounts: `71010`, `71040`, `61000`, `31000`, `31100`, `31200`, `31300`
- Builds the entry: `src/lib/accounting/payroll-cogs-core.ts#buildPayrollJournal`
- Posts the entry: `src/lib/accounting/payroll-posting-service.ts#postPayrollRun`

- **exists: PRESENT** -- payroll-cogs-core.ts#buildPayrollJournal builds a complete payroll journal including the 61000 allocable-labour split.
- **reachable: PRESENT** -- books-86 wired it. The chain is payroll-posting-core.ts#planPayrollPosting -> payroll-posting-service.ts#postPayrollRun -> app/admin/books/pay-run/actions.ts#postPayrollAction, rendered by PostPayrollButton.tsx on /admin/books/pay-run. A test in ledger-census.test.ts re-derives this chain from disk and asserts the builder has exactly ONE caller, so a cut wire fails a gate.
- **correct: PRESENT** -- Balanced and 280E-classed in its own self-tests, which are registered in run-pure-selftests.ts. payroll-posting-core.ts adds 51 tests and a 16-mutation probe (mutate-slice-books-86.py, 16/16 caught).
- **accepted: PRESENT** -- postPayrollRun calls supabase.rpc('gl_post_payroll_run') on a createBooksClient() session, so auth.uid() is the signed-in human and is_owner() can pass. Refusals are translated by gl-refusal-core.ts#explainGlRefusal, which already carries plain-English text for GL_NOT_OWNER and every GL_PAYROLL_* code.
- **idempotent: PARTIAL** -- payrollSourceRef gives a stable key (payroll:entity:start:end:paydate), so a second click is refused as a duplicate. But p_run_id is sent as null, because nothing links a pay PERIOD to a payroll_runs row, so the database cannot raise GL_PAYROLL_RUN_CHANGED when the money behind an already-posted run changes. The fingerprint travels in the assumption note so the change is at least visible on the entry. Double-posting is prevented; a CHANGED run is not yet detected by the database, and that missing link is recorded as D-68 rather than guessed at.
- **married: MISSING** -- src/lib/payroll/payroll-reconcile-core.ts#reconcilePayroll matches runs to bank withdrawals and posts nothing. Accruing payroll and clearing it against the ACH debit are two different slices; this row is the accrual.

**If this stays broken:** Wages are the largest expense after product. The 61000 split is also a 280E matter: labour that handles inventory is deductible through COGS, and labour that sells is not. That logic is now reachable from the screen. What remains is the run link (D-68) and clearing the accrual against the bank.

### `payroll_cycle.net_pay_disbursed`

Net pay leaves the operating account by ACH, then the debit appears in the Plaid feed.

- Accounts: `31000`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder clears 31000 Accrued Payroll against cash.
- **reachable: MISSING** -- No payroll path reaches the ledger.
- **correct: MISSING** -- Nothing to evaluate.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention for an ACH batch.
- **married: PARTIAL** -- payroll-reconcile-core.ts (P6b) matches the run to the withdrawal with a tolerance. Match logic present, posting absent.

**If this stays broken:** Exactly the workflow Michael described: 'tracked through the system, paid via ACH through the system, then the expense will show up in the system via Plaid.' Booking both arrivals would double payroll expense.

### `payroll_cycle.payroll_tax_remitted`

Withheld and employer payroll taxes are paid to the IRS, ESD and L&I.

- Accounts: `31100`, `31200`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder clears 31100 or 31200 against cash.
- **reachable: MISSING** -- No remittance path posts.
- **correct: MISSING** -- The 941/940/5208A calculators exist and are proven, but they compute form figures rather than journal entries.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- The remittance also arrives as a Plaid debit; nothing links them.

**If this stays broken:** Withheld tax is trust money. If the liability is never relieved, 31100 grows forever and the balance sheet shows tax owed that was in fact paid.

### `payroll_cycle.garnishment_remitted`

A child-support or garnishment withholding is forwarded to the agency.

- Accounts: `31300`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder targets 31300.
- **reachable: MISSING** -- src/app/admin/books/garnishments/actions.ts exists but contains no ledger call.
- **correct: MISSING** -- 31300 is seeded (0173) and never referenced in src/.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- Arrives again as a bank debit.

**If this stays broken:** Garnishments carry legal exposure separate from tax. A missing remittance record is the hardest kind of gap to defend to a court.

## Cash, banks and the ATM

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `cash_deposit_to_bank` | NO | NO | NO | NO | NO | NO | D-39 |
| `till_over_short` | NO | NO | NO | NO | NO | n/a | D-39 |
| `atm_vault_load` | NO | NO | part | NO | NO | part | D-40 |
| `atm_surcharge_income` | yes | yes | yes | part | yes | part | D-40 |
| `intercompany_transfer` | yes | NO | part | NO | ? | NO | D-41 |

### `cash_and_banking.cash_deposit_to_bank`

Till cash is counted, moved to the vault, and deposited at the bank.

- Accounts: `10200`, `10400`, `10100`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder moves cash between 101xx and 10200.
- **reachable: MISSING** -- 7 files under src/lib/registers/; 0 submitJournal hits.
- **correct: MISSING** -- 10400 Undeposited Funds and 10900 Cash Clearing are seeded precisely for this and are unused.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- The deposit appears in Plaid as a credit; the count exists in the register system. Nothing links them.

**If this stays broken:** In a cash business this is the reconciliation regulators look at first. Without it there is no audit trail from till to bank.

### `cash_and_banking.till_over_short`

A till count does not match what the system says it should be.

- Accounts: `50920`, `10110`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder targets 50920.
- **reachable: MISSING** -- 0 ledger hits under src/lib/registers/.
- **correct: MISSING** -- 50920 Cash Over / (Short) is seeded and never referenced in src/.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: NOT_APPLICABLE** -- A shortage never reaches a bank. _There is no second arrival for money that went missing._

**If this stays broken:** Over/short is the earliest signal of both honest error and theft. Unbooked, the difference silently distorts revenue instead.

### `cash_and_banking.atm_vault_load`

Cash is loaded into the ATM from the vault account.

- Accounts: `10300`, `10100`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- books-69 built src/lib/atm/atm-classification-core.ts, which CLASSIFIES debits. It does not build journals.
- **reachable: MISSING** -- store.ts#listAtmClassificationProposals returns proposals for review and posts nothing. books-89 closed the SETTLEMENT half of D-40 and deliberately did NOT close this one: settlements had a finished builder waiting for a door, whereas a vault load has no builder at all — atm-classification-core.ts decides what a debit IS and does not construct a journal. Wiring a door to nothing would be theatre. Stated out loud per standing rule 133(f) rather than left to look like an oversight.
- **correct: PARTIAL** -- The classifier is effective-dated, proven by 80 tests, and 18/18 mutants were killed. Classification is proven; the journal is not built.
- **accepted: MISSING** -- 10300 is a control account; migration 0172 REFUSES a 'manual' journal touching it, so this must post as sourceKind 'atm'.
- **idempotent: MISSING** -- The Plaid transaction id is available but unused as a ref.
- **married: PARTIAL** -- The classifier reads the Plaid feed directly, so there is one arrival rather than two. Vault-load pairing across two accounts is not modelled.

**If this stays broken:** The ATM is a separate entity with its own tax position. Michael's own $5,242.50 personal transfer is the case that proves classification matters: misclassified, it becomes a deduction that is not real.

### `cash_and_banking.atm_surcharge_income`

A customer pays the ATM fee, which is income to the ATM entity.

- Accounts: `51000`, `10300`
- Builds the entry: `src/lib/atm/atm-posting-core.ts#buildAtmSettlementProposal`
- Posts the entry: `src/lib/atm/atm-settlement-service.ts#postAtmSettlements`

- **exists: PRESENT** -- books-69 built buildAtmSettlementProposal, which debits 10300 for the money that arrived and credits 51000 for the fee portion. The previous verdict here said 'No builder targets 51000', which was wrong from the moment books-69 shipped: the builder existed and the census had not been re-read. Corrected in books-89 by measuring the file rather than trusting the row.
- **reachable: PRESENT** -- books-89 built the door (D-40). The chain, stated link by link per standing rule 133: /admin/atm?tab=transactions -> components/admin/atm/PostAtmSettlementsPanel.tsx -> app/admin/atm/actions.ts#postAtmSettlementsAction (gated on requireBooksAccess, not the page's finances.view, because this writes to the ledger) -> atm-settlement-service.ts#postAtmSettlements -> buildAtmSettlementProposals -> posting-service.ts#submitJournal. Asserted by the reachability trap in tests/compliance/posting-services-are-reachable.test.ts, which walks src/ for a real caller and excludes this census file, because a poster: string is a claim and not a call.
- **correct: PRESENT** -- The fee is credited to 51000 in the ATM entity, so it is NOT cannabis revenue and not subject to 280E, and it is the .015 service-rate B&O base. The dispensed-cash leg debits and credits 10300 for the same figure deliberately: netting them would still balance and would destroy the only record of how much cash the machine handed out, which is the failure mode that announces itself to nobody. A test asserts the service passes the core's lines through unchanged in sign, count and description. Note ledger-core.ts:770 uses code 70100 named 'ATM Fee Income' in a self-test FIXTURE; the seeded account is 51000 and the fixture is not a production mapping.
- **accepted: PARTIAL** -- Entries are created as DRAFTS and appear on /admin/books/drafts. autoPost is never requested, because every proposal carries postable: false — 'ATM cash movements are reconciled against a physical count, by a person.' PARTIAL and not PRESENT because no ATM settlement has yet made the round trip against a live database.
- **idempotent: PRESENT** -- sourceRef is atm-settle:<TERMINAL>:<date>, built from the pair migration 0156 already declares unique for atm_settlements, and the terminal is upper-cased and trimmed so one machine on one day cannot produce two keys. PAI reports overlap by design, so this button WILL be pressed twice; a test proves the second press returns duplicate rather than doubling a separate entity's revenue.
- **married: PARTIAL** -- The entry is built from the PAI settlement report. The same money also arrives in the Timberland feed as a deposit, and nothing links the two yet — that is bank matching, which exists (migration 0189) but has no caller for this source. Recorded rather than claimed.

**If this stays broken:** This is real taxable income in a non-cannabis entity, so it is NOT subject to 280E and is the ATM entity's B&O base at the .015 service rate.

### `cash_and_banking.intercompany_transfer`

Money moves between Michael's entities — for example the vendor payment made out of account 6228.

- Accounts: `36000`, `10200`
- Builds the entry: `src/lib/accounting/posting-service.ts#submitIntercompanyPair`
- Posts the entry: **nothing**

- **exists: PRESENT** -- submitIntercompanyPair exists and gl_submit_intercompany_pair exists in SQL.
- **reachable: MISSING** -- grep -rn 'submitIntercompanyPair' src/app -> 0 callers.
- **correct: PARTIAL** -- 36000 Due To / From Related Entity is seeded and the paired door enforces both sides. books-76 CLOSES the question this row was waiting on. It asked whether the money is expected to be repaid, and Michael answered: 'I want to classify the cash in the atm as a loan.' So the account is decided -- 36000, not 41100 -- and the target is no longer UNKNOWN. It is PARTIAL rather than PRESENT because deciding the label is not the same as earning it: 26 C.F.R. 1.482-2(a)(1)(ii)(B) says the regime 'does not apply to so much of an alleged indebtedness which is not in fact a bona fide indebtedness, even if the stated rate of interest thereon would be within the safe haven rates', and names the two substitutes as a contribution to capital or a distribution -- exactly the 41100/41000 pair this row was choosing between. related-party-loan-core.ts#assessBonaFide sorts the facts and returns UNDETERMINED on Michael's stated terms, because two facts (is the balance tracked, was demand ever made) have never been put to him. Two facts DO favour him and were measured, not assumed: cash goes back, and the balance cycles both ways, which is the books-74 measuring-instrument test passing. Michael also offered to write a contract; CONTRACT_REQUIREMENTS states what it must contain, and the highest-value item is stating the rate as a FORMULA (the applicable Federal short-term rate) so it stays inside the 100-130% safe haven automatically. See D-59, D-60, D-55 and docs/ENTITY-STRUCTURE-AND-280E.md.
- **accepted: MISSING** -- No app path presents a pair.
- **idempotent: UNKNOWN** -- The paired door is designed to be atomic. _Never exercised from the app, so the ref behaviour is unobserved._
- **married: MISSING** -- Both sides appear in two Plaid feeds; nothing links them.

**If this stays broken:** Intercompany errors move taxable income between entities with different rates and different 280E exposure. This is also the one row that needs a decision from Michael before it can be wired.

## Period-end, assets, loans and everything else

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `manual_journal` | yes | yes | yes | yes | n/a | n/a | -- |
| `bo_tax_accrual` | yes | NO | yes | NO | NO | n/a | D-42 |
| `excise_tax_remitted` | NO | NO | NO | NO | NO | NO | D-32 |
| `fixed_asset_acquired` | part | NO | yes | NO | NO | NO | D-43 |
| `depreciation_booked` | NO | NO | yes | NO | NO | n/a | D-43 |
| `loan_activity` | part | NO | part | NO | NO | NO | D-44 |
| `crypto_activity` | NO | NO | NO | NO | NO | ? | D-45 |
| `period_close` | NO | NO | NO | NO | NO | n/a | D-46 |
| `reversal` | NO | NO | NO | NO | NO | n/a | D-46 |
| `opening_balance` | part | NO | ? | NO | NO | n/a | D-47 |

### `periodic_and_other.manual_journal`

Michael or the bookkeeper types a journal entry by hand.

- Accounts: `10200`, `76040`
- Builds the entry: `src/lib/accounting/journal-entry-service.ts#submitManualJournal`
- Posts the entry: `src/app/admin/books/journal/actions.ts#submitJournalAction`

- **exists: PRESENT** -- journal-entry-service.ts#submitManualJournal builds and submits.
- **reachable: PRESENT** -- src/app/admin/books/journal/actions.ts:68 calls it from the journal screen.
- **correct: PRESENT** -- Runs the advisor (evaluateJournalDraft) and refuses on ADV_BLOCKED before submitting.
- **accepted: PRESENT** -- Posts through submitJournal with autoPost false, so a human posts it.
- **idempotent: NOT_APPLICABLE** -- sourceRef is null; migration 0174 section 1 explicitly allows this for 'manual'. _A hand-keyed entry has no external event to key on. Two identical entries may be two genuine entries, so the ledger must not silently merge them._
- **married: NOT_APPLICABLE** -- A manual entry has no system-side counterpart. _Nothing automatic produced it, so nothing can duplicate it._

**If this stays broken:** The second of two working paths, and the safety valve: anything not yet wired can be entered by hand without corrupting the ledger.

### `periodic_and_other.bo_tax_accrual`

Washington B&O tax is accrued on the period's gross receipts — .00471 retailing for Greenway, .015 for the ATM service entity.

- Accounts: `75040`, `32200`
- Builds the entry: `src/lib/accounting/bo-tax-core.ts#boAccrualEntry`
- Posts the entry: **nothing**

- **exists: PRESENT** -- bo-tax-core.ts exports boAccrualEntry and boPaymentEntry.
- **reachable: MISSING** -- grep -rn 'boAccrualEntry\|boPaymentEntry' src/ -> 0 callers.
- **correct: PRESENT** -- Rates are held in MILLIONTHS to avoid the rounding drift a percentage would introduce; proven in its own self-tests.
- **accepted: MISSING** -- 'accrual' is deliberately NOT in AUTOPOSTABLE_SOURCE_KINDS, so this must always be drafted for review. Never presented.
- **idempotent: MISSING** -- The natural ref is the tax period, which would make a re-run safe. No code sets it.
- **married: NOT_APPLICABLE** -- An accrual moves no money. _The PAYMENT is the bank event, and boPaymentEntry is its builder._

**If this stays broken:** B&O is owed on gross receipts whether or not there is profit. The calculation is already correct and simply unreachable — a cheap win.

### `periodic_and_other.excise_tax_remitted`

The 37% excise held in trust is paid to the LCB.

- Accounts: `32000`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder clears 32000 against cash.
- **reachable: MISSING** -- No excise path posts.
- **correct: MISSING** -- 12300 Excise Tax Receivable / Overpayment is seeded for the case where more was remitted than collected, and is unused.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- The remittance appears in Plaid too.

**If this stays broken:** If the liability is never relieved, 32000 grows without limit and the books show trust tax outstanding that was in fact paid.

### `periodic_and_other.fixed_asset_acquired`

Equipment, a vehicle or a leasehold improvement is bought and capitalised.

- Accounts: `21600`, `30000`, `10200`
- Builds the entry: `src/lib/accounting/fixed-assets-core.ts#accountCodeForClass`
- Posts the entry: **nothing**

- **exists: PARTIAL** -- fixed-assets-core.ts maps asset classes to codes 21000-21900 and computes MACRS schedules. It resolves the ACCOUNT for an asset class; no function in it assembles a journal.
- **reachable: MISSING** -- grep -rn 'fixed-assets-core' src/ -> 0 importers.
- **correct: PRESENT** -- MEASURED: all ten target accounts 21000-21900 ARE seeded, by migration 0178_fixed_assets.sql via gl_upsert_account. 0178 also installs gl_guard_no_land_depreciation and gl_check_accumulated_depreciation, so the codes and the guards agree with the module.
- **accepted: MISSING** -- The accounts exist, so a line naming 21600 would not be refused. No app path has ever presented one.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- Asset purchases are paid by ACH or card and arrive again in Plaid.

**If this stays broken:** Capitalising an asset instead of expensing it is a GAAP requirement and, under 280E, usually the difference between a cost that is eventually recovered and one that is lost. The chart and the MACRS maths are both ready; only the wire is missing.

### `periodic_and_other.depreciation_booked`

Monthly or annual depreciation is recorded against the asset.

- Accounts: `78010`, `21900`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'sourceKind: "depreciation"' src/ -> 0 hits. fixed-assets-core computes MACRS schedules but no function assembles a journal from them.
- **reachable: MISSING** -- 0 importers of fixed-assets-core.
- **correct: PRESENT** -- Both sides exist: 78010 Depreciation Expense (0173) and 21900 Accumulated Depreciation (0178). 0178 also installs gl_guard_no_land_depreciation, so the database itself refuses to depreciate land.
- **accepted: MISSING** -- 'depreciation' is never autopostable: posting-core.ts:128 states 'Depreciation is a schedule and a judgment, not an observed event.'
- **idempotent: MISSING** -- Period-keyed ref would make re-runs safe; no code sets one.
- **married: NOT_APPLICABLE** -- Depreciation moves no money. _There is no bank line for a non-cash allocation._

**If this stays broken:** The accounts, the guards and the MACRS schedule maths are all in place. What is missing is the monthly entry that uses them, so no asset has ever been depreciated in the books.

### `periodic_and_other.loan_activity`

A loan is drawn or repaid, splitting principal from interest.

- Accounts: `34000`, `36000`, `85010`, `10200`
- Builds the entry: `src/lib/accounting/related-party-loan-core.ts#loanControlAccountFor`
- Posts the entry: **nothing**

- **exists: PARTIAL** -- grep -rn 'sourceKind: "loan"' src/ -> still 0 hits, so no loan POSTS. books-76 adds the half that had to come first: loanControlAccountFor decides WHICH control account holds a related-party balance, and imputedInterestRequirement decides what interest the law requires. A poster that did not know the answer to either would have been guessing at both.
- **reachable: MISSING** -- grep -rn 'loanControlAccountFor' src/app -> 0 callers. grep -rn 'sourceKind: "loan"' src/ -> 1 hit, and it is this census row describing itself, not a poster.
- **correct: PARTIAL** -- 34000, 36000 and 85010 are all seeded. src/lib/plaid/liabilities-core.ts reads liability data and posts nothing. books-76 settles the routing on measured grounds: 34000's chart comment in migration 0173 is 'CONTROL, driven by the loan subledger and its amortization schedule', and Michael's ATM loan has no term, hence no schedule, hence no subledger to drive it -- so it routes to 36000 and 34000 is reserved for loans that have both a maturity date and a repayment schedule. The interest leg is why this is PARTIAL and not PRESENT: D-59 measured that loan-core.ts returns ZERO schedule rows and ZERO interest for a zero-term loan, and FEDERAL_SHORT_TERM_RATES is empty on purpose, so 85010 cannot yet be given a number. imputedInterestRequirement refuses with a named code instead of inventing one.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- Loan payments arrive in Plaid as a single debit covering both parts.

**If this stays broken:** Only the interest portion is deductible, and under 280E even that depends on the entity. Booking the whole payment to either account misstates both the liability and the deduction. For a RELATED-PARTY loan the exposure is worse and runs the other way: 26 C.F.R. 1.482-2(a)(2)(iii)(B)(2) imputes interest at 100% of the AFR even when none is charged, so interest income appears in the ATM entity (taxable, B&O at the .015000 service rate) while the matching expense lands in Greenway where 280E disallows it. The imputation is not a wash. See D-59 and D-60.

### `periodic_and_other.crypto_activity`

A crypto position changes value or is disposed of.

- Accounts: `80030`, `80040`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- 35 files under src/lib/crypto/; grep -rn 'sourceKind: "crypto"' -> 0 hits.
- **reachable: MISSING** -- No crypto path reaches the ledger.
- **correct: MISSING** -- 80030 Realized and 80040 Unrealized Investment Gain/(Loss) are seeded and unused.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- An on-chain transaction hash is a perfect natural ref and is unused.
- **married: UNKNOWN** -- Whether fiat on/off-ramps appear in a connected Plaid account. _Depends on which exchange accounts Michael has linked. Not measurable from the source tree._

**If this stays broken:** Personal-entity activity that affects the 1040 rather than the business return. Lowest priority of anything in this census, and recorded so it is not mistaken for an oversight.

### `periodic_and_other.period_close`

A month or year is closed and locked so figures can no longer move.

- Accounts: `40300`, `40400`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'period-close-core' src/ -> 0 importers; grep -rn 'sourceKind: "close"' -> 0 hits.
- **reachable: MISSING** -- period-close-core has no importers.
- **correct: MISSING** -- 40300 Retained Earnings and 40400 Opening Balance Equity are unused.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- Closing the same period twice must be a no-op; untested.
- **married: NOT_APPLICABLE** -- A close moves no money. _It is a reclass within equity._

**If this stays broken:** Without a close, a prior period can silently change after the CPA has filed from it. That is the difference between books and a spreadsheet.

### `periodic_and_other.reversal`

A posted entry is found to be wrong and must be reversed, not deleted.

- Accounts: `10200`, `76040`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'sourceKind: "reversal"' src/ -> 0 hits.
- **reachable: MISSING** -- No reversal path exists in the app.
- **correct: MISSING** -- A reversal must mirror the original exactly with opposite signs and preserve the original's cost class.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- Highest-consequence idempotency case in the census: reversing twice re-creates the error it was cancelling, and the books still balance.
- **married: NOT_APPLICABLE** -- A reversal is an internal correction. _No bank line corresponds to a correction of a prior entry._

**If this stays broken:** Once real posting begins, the first mistake will need reversing. There is currently no way to correct a posted entry except by hand-keying the opposite, with no link between the two.

### `periodic_and_other.opening_balance`

Historical balances are loaded when the books are first stood up.

- Accounts: `40400`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: PARTIAL** -- Migration 0176_opening_balances.sql supplies a staging table with gl_ob_validate_row, gl_bless_opening_balances and gl_close_opening_balance_equity. gl_opening_balance_summary IS called from the app, so the staging side is reachable read-only; grep -rn 'sourceKind: "opening_balance"' -> 0 hits.
- **reachable: MISSING** -- gl_bless_opening_balances and gl_close_opening_balance_equity have no supabase.rpc() caller, so nothing turns staged balances into journals.
- **correct: UNKNOWN** -- 40400 Opening Balance Equity is seeded for exactly this purpose. _Michael has not yet supplied the Sage COA-tagged spreadsheets, so the opening figures themselves are not yet known. Standing rule 1: the census will not invent them._
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- Loading opening balances twice would double the balance sheet.
- **married: NOT_APPLICABLE** -- Opening balances predate the bank feed. _There is no Plaid history for a balance carried in from Sage._

**If this stays broken:** Everything else in the census assumes a starting point. Until opening balances are loaded, even perfectly wired activity produces a balance sheet that starts from zero.

## What nothing can build yet

These rows are not a wiring job. There is no code that produces the journal entry at
all, so the work is to write it, then wire it.

- `revenue_and_tax_collected.excise_liability_split` (D-32)
- `revenue_and_tax_collected.discount_and_comp` (D-31)
- `revenue_and_tax_collected.refund_or_return` (D-31)
- `cost_of_goods_sold.freight_in` (D-34)
- `vendor_cycle.purchase_order_commitment` (D-35)
- `vendor_cycle.vendor_paid_by_ach` (D-36)
- `payroll_cycle.net_pay_disbursed` (D-38)
- `payroll_cycle.payroll_tax_remitted` (D-38)
- `payroll_cycle.garnishment_remitted` (D-38)
- `cash_and_banking.cash_deposit_to_bank` (D-39)
- `cash_and_banking.till_over_short` (D-39)
- `cash_and_banking.atm_vault_load` (D-40)
- `periodic_and_other.excise_tax_remitted` (D-32)
- `periodic_and_other.depreciation_booked` (D-43)
- `periodic_and_other.crypto_activity` (D-45)
- `periodic_and_other.period_close` (D-46)
- `periodic_and_other.reversal` (D-46)
- `periodic_and_other.opening_balance` (D-47)

## Where a builder already exists and nothing calls it

The cheapest real progress available. The accounting logic is written and tested; only
the path from the screen to the ledger is absent.

- `cost_of_goods_sold.cutover_inventory_load` (D-48) -- `src/lib/accounting/cutover-inventory-core.ts#buildCutoverInventoryPlan`
- `cost_of_goods_sold.cultivera_manifest_import` (D-49) -- `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- `cash_and_banking.intercompany_transfer` (D-41) -- `src/lib/accounting/posting-service.ts#submitIntercompanyPair`
- `periodic_and_other.bo_tax_accrual` (D-42) -- `src/lib/accounting/bo-tax-core.ts#boAccrualEntry`
- `periodic_and_other.fixed_asset_acquired` (D-43) -- `src/lib/accounting/fixed-assets-core.ts#accountCodeForClass`
- `periodic_and_other.loan_activity` (D-44) -- `src/lib/accounting/related-party-loan-core.ts#loanControlAccountFor`

## What is deliberately not posted

A `n/a` is a decision, not an omission, and it is recorded so nobody wires it by
mistake later.

- `revenue_and_tax_collected.retail_sale` / `married`: The sale itself has no second arrival. The DEPOSIT of its proceeds does, and that is a different row.
- `revenue_and_tax_collected.excise_liability_split` / `married`: The excise PAYMENT to DOR is a bank movement and is censused separately.
- `revenue_and_tax_collected.discount_and_comp` / `married`: There is no bank line for money that was never collected.
- `revenue_and_tax_collected.refund_or_return` / `married`: Card refunds appear in the settlement row, which is censused there.
- `cost_of_goods_sold.cogs_on_sale` / `married`: No cash moves, so no bank line can duplicate it.
- `cost_of_goods_sold.cutover_inventory_load` / `married`: This product was already bought and paid for under Cultivera and Sage. Its cash left the bank before this platform existed, so there is no second arrival to reconcile against.
- `cost_of_goods_sold.inventory_audit_adjustment` / `married`: Nothing in the bank feed can correspond to a shrink write-off.
- `vendor_cycle.purchase_order_commitment` / `correct`: A plain PO should NOT hit the ledger. Michael asked whether POs are 'properly booked' — the correct answer is that the RECEIPT is booked, not the order. This row exists so that answer is recorded rather than rediscovered.
- `vendor_cycle.purchase_order_commitment` / `accepted`: No entry is due at commitment.
- `vendor_cycle.purchase_order_commitment` / `idempotent`: No entry is due at commitment.
- `vendor_cycle.purchase_order_commitment` / `married`: No entry is due at commitment.
- `vendor_cycle.expense_classified_to_account_and_entity` / `married`: Classification decides how ONE arrival is characterised. The same dollar arriving twice -- once from the system that spent it, once from the Plaid debit that saw it leave -- is the payment event's problem, and it is already tracked on vendor_cycle.vendor_paid_by_ach. Marking this layer PRESENT here would double-count a control that lives elsewhere.
- `vendor_cycle.operating_expense_from_bank` / `married`: There is no in-system counterpart to marry, which is what makes this family safe to auto-post and the right place to start wiring.
- `cash_and_banking.till_over_short` / `married`: There is no second arrival for money that went missing.
- `periodic_and_other.manual_journal` / `idempotent`: A hand-keyed entry has no external event to key on. Two identical entries may be two genuine entries, so the ledger must not silently merge them.
- `periodic_and_other.manual_journal` / `married`: Nothing automatic produced it, so nothing can duplicate it.
- `periodic_and_other.bo_tax_accrual` / `married`: The PAYMENT is the bank event, and boPaymentEntry is its builder.
- `periodic_and_other.depreciation_booked` / `married`: There is no bank line for a non-cash allocation.
- `periodic_and_other.period_close` / `married`: It is a reclass within equity.
- `periodic_and_other.reversal` / `married`: No bank line corresponds to a correction of a prior entry.
- `periodic_and_other.opening_balance` / `married`: There is no Plaid history for a balance carried in from Sage.

