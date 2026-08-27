# Ledger reachability census

**This file is generated.** Edit `src/lib/accounting/ledger-census-data.ts` and re-run
`npx tsx scripts/compliance/build-census-doc.ts`. A stale copy fails a test.

## What this is

Every event in the business that moves money, and an honest answer to one question
for each: does it actually reach the accounting books? Not *should* it, and not *is
there code for it* -- does a real click by a real person land a real journal entry.

The answer is measured, never assumed. Each cell cites what was checked.

## The headline

> 33 money events that should reach the books. 31 cannot reach them at all. 24 have nothing that builds the entry, so wiring alone will not fix them. 2 are proven on all six layers. 5 carry a layer this census could not measure, and say so.

| | count |
|---|---:|
| Money events catalogued | 33 |
| Proven on all six layers | 2 |
| Cannot reach the books at all | 31 |
| Have nothing that even builds the entry | 24 |
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
| `exists` | 23 of 33 |
| `reachable` | 31 of 33 |
| `correct` | 18 of 33 |
| `accepted` | 29 of 33 |
| `idempotent` | 25 of 33 |
| `married` | 13 of 33 |

## Sales, and the tax you collect on someone else's behalf

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `retail_sale` | NO | NO | NO | NO | NO | n/a | D-31 |
| `excise_liability_split` | NO | NO | NO | NO | NO | n/a | D-32 |
| `discount_and_comp` | NO | NO | NO | NO | NO | n/a | D-31 |
| `refund_or_return` | NO | NO | NO | NO | NO | n/a | D-31 |

### `revenue_and_tax_collected.retail_sale`

A customer buys product at the counter and pays. The price on the shelf already includes both taxes.

- Accounts: `10110`, `50000`, `32000`, `32100`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'sourceKind: "pos_sale"' src/ -> 0 hits. No module builds a sale journal.
- **reachable: MISSING** -- 97 files under src/lib/pos/ and src/app/api/pos/; grep for submitJournal across all of them -> 0 hits.
- **correct: MISSING** -- Nothing to evaluate. Prices are tax-inclusive (CANNABIS_EXCISE_TAX_BPS = 3700, back-out divisor 1.463, RCW 69.50.535) so the entry must EXTRACT excise before it can be correct.
- **accepted: MISSING** -- pos_sale is in AUTOPOSTABLE_SOURCE_KINDS (posting-core.ts:112) so the door would accept it, but nothing has ever presented one.
- **idempotent: MISSING** -- No sourceRef convention exists for a sale; nothing to key on.
- **married: NOT_APPLICABLE** -- Cash and card settlement are separate events, censused below. _The sale itself has no second arrival. The DEPOSIT of its proceeds does, and that is a different row._

**If this stays broken:** This is the single largest number in the business and the books currently contain none of it. Revenue, excise trust liability and sales tax trust liability are all absent.

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
| `cogs_on_sale` | NO | NO | NO | NO | NO | n/a | D-33 |
| `cutover_inventory_load` | NO | NO | ? | part | NO | n/a | D-48 |
| `cultivera_manifest_import` | part | NO | part | NO | part | NO | D-49 |
| `inventory_receipt` | yes | NO | yes | NO | part | NO | D-34 |
| `inventory_audit_adjustment` | yes | yes | yes | yes | yes | n/a | -- |
| `freight_in` | NO | NO | NO | NO | NO | NO | D-34 |

### `cost_of_goods_sold.cogs_on_sale`

Product leaves the shelf, so its cost has to move from asset to expense.

- Accounts: `60000`, `20000`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'cogs-position-core' src/ -> 0 importers. The costing module exists but no journal builder consumes it.
- **reachable: MISSING** -- No COGS-on-sale path reaches submitJournal.
- **correct: MISSING** -- coa-core mirrors 20xxx inventory to 60xxx COGS per category, so the account pairs exist; nothing selects them at sale time.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No sourceRef convention.
- **married: NOT_APPLICABLE** -- COGS is an internal reclass. _No cash moves, so no bank line can duplicate it._

**If this stays broken:** Under IRC 280E, COGS is the ONLY deduction a cannabis retailer gets. An unbooked COGS is tax paid on gross receipts instead of gross profit — the most expensive single gap in this census.

### `cost_of_goods_sold.cutover_inventory_load`

THE CUT-OVER. Inventory is counted on 2026-10-31 after close and loaded into this platform on 2026-11-01 before open, carrying its value from Cultivera. This is the single largest asset number the books will ever receive, and it arrives once.

- Accounts: `20000`, `20010`, `20890`, `40400`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'sourceKind: "opening_balance"' src/ -> 0 hits. No module converts a counted lot list into an opening inventory journal. inventoryAccountForCategory (vendor-bill-core.ts:966) maps a category slug to its 200xx account and is self-tested, so the ACCOUNT side is solved; the entry that uses it for a cut-over load is not written.
- **reachable: MISSING** -- src/app/admin/books/conversion/page.tsx is 361 lines and deliberately read-only: grep for 'rpc(' in it -> 0 hits, and its own header says 'Nothing here posts anything.' No src/ file inserts into gl_opening_balances; ledger-store.ts:458 only SELECTs from it.
- **correct: UNKNOWN** -- The account side is determined: 0173 seeds 21 per-category inventory accounts under control account 20000, and gl_guard_inventory_manual (0173:316) REFUSES any source_kind='manual' line touching a 2xxxx asset, so this load must be source_kind 'opening_balance', 'inventory' or 'purchase' by database law, never a typed journal. _Whether the counted VALUE is right cannot be measured from code. It depends on the 2026-10-31 count and on Cultivera's per-unit costs, which Michael has not yet supplied. Rule 1: the census will not invent the largest asset figure on the balance sheet._
- **accepted: PARTIAL** -- Migration 0186 already moves the opening-balance date to 2026-10-31, matching Michael's stated cut-over, and records that the old hard-coded 2025-12-31 would have stamped it TEN MONTHS EARLY while balancing. 0176:76 lists 'inventory_count' as a valid evidence_kind, so the worksheet is designed to accept exactly this row. Nothing has presented one.
- **idempotent: MISSING** -- Loading the cut-over count twice would double the largest asset on the balance sheet. gl_ob_guard_frozen (0176:162) freezes rows once blessed, which protects the WORKSHEET, but no ref convention protects the load itself because no load path exists.
- **married: NOT_APPLICABLE** -- No bank row corresponds to a cut-over count. _This product was already bought and paid for under Cultivera and Sage. Its cash left the bank before this platform existed, so there is no second arrival to reconcile against._

**If this stays broken:** This is the number every subsequent COGS figure is measured from. Book it as a PURCHASE and the books invent an accounts-payable balance to vendors who were already paid, overstating liabilities and understating equity by the entire value of the shelf. Book it at the wrong value and every 280E cost-of-goods deduction for the life of the business inherits the error, and the balance sheet balances either way.

### `cost_of_goods_sold.cultivera_manifest_import`

AFTER cut-over: a Cultivera / WCIA transfer data link (or a batch of hundreds) is imported, staging a manifest whose lots later go on the shelf.

- Accounts: `20000`, `20890`, `30000`
- Builds the entry: `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- Posts the entry: **nothing**

- **exists: PARTIAL** -- The import parses cost: intake-parser.ts:375-380 computes unit_cost_minor_units as round(linePrice / qty * 100), and 0023/0028 store it on inventory_lots. But ccrs-manifest-csv-core.ts:495 hard-codes 'unit_cost_minor_units: null' for the CCRS CSV shape, because a CCRS transfer file carries no price. So cost survives the URL/PDF path and is absent on the CSV path.
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
- Posts the entry: **nothing**

- **exists: PRESENT** -- vendor-bill-core.ts exports a journal builder with account mappings and 280E cost classes.
- **reachable: MISSING** -- src/app/admin/books/bills/ has no actions.ts; gl_post_vendor_bill is referenced nowhere outside its own migration.
- **correct: PRESENT** -- Builder balances in its own self-tests, and every account it targets (including capitalisation codes 21500/21600/21700) is seeded: 0173 for the operating chart, 0178 for the fixed-asset block.
- **accepted: MISSING** -- Migration 0187 supplies the door gl_post_vendor_bill and the checker gl_audit_vendor_bill_wiring. No supabase.rpc() call names either.
- **idempotent: PARTIAL** -- vendor-bill-core.ts#billSourceRef builds a real key: `manifest:<n>` when the bill came from an accepted manifest, else `bill:<vendor>:<invoice>`. The key exists and is sound; no app path ever calls it.
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
| `vendor_bill_recorded` | yes | NO | yes | NO | part | NO | D-34 |
| `vendor_paid_by_ach` | NO | NO | NO | NO | NO | part | D-36 |
| `operating_expense_from_bank` | NO | NO | part | NO | NO | n/a | D-37 |

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

### `vendor_cycle.vendor_bill_recorded`

An invoice arrives from a vendor and becomes a payable.

- Accounts: `30000`, `20000`
- Builds the entry: `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- Posts the entry: **nothing**

- **exists: PRESENT** -- vendor-bill-core.ts builds a full bill journal with cost classes.
- **reachable: MISSING** -- No actions.ts under src/app/admin/books/bills/. The SQL door gl_post_vendor_bill has no caller outside its migration.
- **correct: PRESENT** -- Balanced in self-tests; every account it names is seeded across 0173 and 0178.
- **accepted: MISSING** -- gl_post_vendor_bill exists (0187); no supabase.rpc() call names it.
- **idempotent: PARTIAL** -- billSourceRef prefers the manifest number as the strongest external key and falls back to vendor+invoice. Sound, and never invoked.
- **married: MISSING** -- The bill and its later ACH payment are two events; nothing links them.

**If this stays broken:** Without payables, the balance sheet shows no money owed and cash-basis and accrual-basis results diverge silently.

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
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- 16 files under src/lib/plaid/; grep for submitJournal -> 0 hits. Migration 0189_bank_matching.sql supplies gl_post_bank_match, gl_unmatch_bank_row, gl_bank_reconcile and gl_sign_off_bank_reconciliation: a complete SQL-side reconciliation suite with no supabase.rpc() caller.
- **reachable: MISSING** -- No Plaid path reaches the ledger.
- **correct: PARTIAL** -- gl_account_rules exists to map a description to an account, but it is empty and no code reads or writes it (D-30).
- **accepted: MISSING** -- bank is autopostable per posting-core.ts:116; never presented.
- **idempotent: MISSING** -- The natural ref is the Plaid transaction id, which is stable — but no code uses it as a sourceRef.
- **married: NOT_APPLICABLE** -- The bank feed IS the only source for this event. _There is no in-system counterpart to marry, which is what makes this family safe to auto-post and the right place to start wiring._

**If this stays broken:** These are the expenses Michael's CPA needs categorised for the return. It is also the lowest-risk wiring target, because nothing else can duplicate it.

## Paying people, and the taxes that go with it

| event | exists | reachable | correct | accepted | idempotent | married | defect |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `payroll_run_accrued` | yes | NO | yes | NO | ? | NO | D-38 |
| `net_pay_disbursed` | NO | NO | NO | NO | NO | part | D-38 |
| `payroll_tax_remitted` | NO | NO | NO | NO | NO | NO | D-38 |
| `garnishment_remitted` | NO | NO | NO | NO | NO | NO | D-38 |

### `payroll_cycle.payroll_run_accrued`

A payroll run is calculated: gross wages, employee withholding, employer taxes, and the split between shop labour and inventory-handling labour.

- Accounts: `71010`, `61000`, `31000`, `31100`, `31200`
- Builds the entry: `src/lib/accounting/payroll-cogs-core.ts#buildPayrollJournal`
- Posts the entry: **nothing**

- **exists: PRESENT** -- payroll-cogs-core.ts#buildPayrollJournal builds a complete payroll journal including the 61000 allocable-labour split.
- **reachable: MISSING** -- grep -rn 'buildPayrollJournal' -> matches ONLY inside payroll-cogs-core.ts itself (its own self-tests). The single external caller is scripts/compliance/e2e-payroll-journal.ts, whose own header says 'Not part of the app. Development verification only.'
- **correct: PRESENT** -- Balanced and 280E-classed in its own self-tests, which are registered in run-pure-selftests.ts.
- **accepted: MISSING** -- Migration 0188_payroll_to_gl.sql supplies gl_post_payroll_run and the guard gl_payroll_allocation_guard. The only mention in src/ is a comment in books/payroll/page.tsx; no supabase.rpc() call names it.
- **idempotent: UNKNOWN** -- No app path generates a ref for a payroll run. _The builder is pure and takes no ref. Whether two clicks of a future Post Payroll button would double-post is a property of the button._
- **married: MISSING** -- src/lib/payroll/payroll-reconcile-core.ts#reconcilePayroll matches runs to bank withdrawals and posts nothing.

**If this stays broken:** Wages are the largest expense after product. The 61000 split is also a 280E matter: labour that handles inventory is deductible through COGS, and labour that sells is not. The logic to do this correctly already exists and is unreachable, which is the most frustrating finding in the census.

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
| `atm_surcharge_income` | NO | NO | NO | NO | NO | NO | D-40 |
| `intercompany_transfer` | yes | NO | ? | NO | ? | NO | D-41 |

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
- **reachable: MISSING** -- store.ts#listAtmClassificationProposals returns proposals for review and posts nothing, by design.
- **correct: PARTIAL** -- The classifier is effective-dated, proven by 80 tests, and 18/18 mutants were killed. Classification is proven; the journal is not built.
- **accepted: MISSING** -- 10300 is a control account; migration 0172 REFUSES a 'manual' journal touching it, so this must post as sourceKind 'atm'.
- **idempotent: MISSING** -- The Plaid transaction id is available but unused as a ref.
- **married: PARTIAL** -- The classifier reads the Plaid feed directly, so there is one arrival rather than two. Vault-load pairing across two accounts is not modelled.

**If this stays broken:** The ATM is a separate entity with its own tax position. Michael's own $5,242.50 personal transfer is the case that proves classification matters: misclassified, it becomes a deduction that is not real.

### `cash_and_banking.atm_surcharge_income`

A customer pays the ATM fee, which is income to the ATM entity.

- Accounts: `51000`, `10300`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- No builder targets 51000.
- **reachable: MISSING** -- No ATM path posts.
- **correct: MISSING** -- 51000 ATM Surcharge Income is seeded. Note ledger-core.ts:770 uses code 70100 named 'ATM Fee Income' in a self-test fixture, which is NOT the seeded account — a fixture, not a production mapping.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- Surcharge settlement arrives in the bank feed; nothing links it.

**If this stays broken:** This is real taxable income in a non-cannabis entity, so it is NOT subject to 280E and is the ATM entity's B&O base at the .015 service rate.

### `cash_and_banking.intercompany_transfer`

Money moves between Michael's entities — for example the vendor payment made out of account 6228.

- Accounts: `36000`, `10200`
- Builds the entry: `src/lib/accounting/posting-service.ts#submitIntercompanyPair`
- Posts the entry: **nothing**

- **exists: PRESENT** -- submitIntercompanyPair exists and gl_submit_intercompany_pair exists in SQL.
- **reachable: MISSING** -- grep -rn 'submitIntercompanyPair' src/app -> 0 callers.
- **correct: UNKNOWN** -- 36000 Due To / From Related Entity is seeded and the paired door enforces both sides. _Whether the 6228 vendor payment is intercompany (36000) or a capital contribution (41100) is Michael's decision, not a measurable fact. It changes his basis, so the census refuses to guess._
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
| `loan_activity` | NO | NO | NO | NO | NO | NO | D-44 |
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

- Accounts: `34000`, `85010`, `10200`
- Builds the entry: **nothing**
- Posts the entry: **nothing**

- **exists: MISSING** -- grep -rn 'sourceKind: "loan"' src/ -> 0 hits.
- **reachable: MISSING** -- No loan path posts.
- **correct: MISSING** -- 34000 Notes & Loans Payable and 85010 Interest Expense are both seeded and unused. src/lib/plaid/liabilities-core.ts reads liability data and posts nothing.
- **accepted: MISSING** -- Never presented.
- **idempotent: MISSING** -- No ref convention.
- **married: MISSING** -- Loan payments arrive in Plaid as a single debit covering both parts.

**If this stays broken:** Only the interest portion is deductible, and under 280E even that depends on the entity. Booking the whole payment to either account misstates both the liability and the deduction.

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

- `revenue_and_tax_collected.retail_sale` (D-31)
- `revenue_and_tax_collected.excise_liability_split` (D-32)
- `revenue_and_tax_collected.discount_and_comp` (D-31)
- `revenue_and_tax_collected.refund_or_return` (D-31)
- `cost_of_goods_sold.cogs_on_sale` (D-33)
- `cost_of_goods_sold.cutover_inventory_load` (D-48)
- `cost_of_goods_sold.freight_in` (D-34)
- `vendor_cycle.purchase_order_commitment` (D-35)
- `vendor_cycle.vendor_paid_by_ach` (D-36)
- `vendor_cycle.operating_expense_from_bank` (D-37)
- `payroll_cycle.net_pay_disbursed` (D-38)
- `payroll_cycle.payroll_tax_remitted` (D-38)
- `payroll_cycle.garnishment_remitted` (D-38)
- `cash_and_banking.cash_deposit_to_bank` (D-39)
- `cash_and_banking.till_over_short` (D-39)
- `cash_and_banking.atm_vault_load` (D-40)
- `cash_and_banking.atm_surcharge_income` (D-40)
- `periodic_and_other.excise_tax_remitted` (D-32)
- `periodic_and_other.depreciation_booked` (D-43)
- `periodic_and_other.loan_activity` (D-44)
- `periodic_and_other.crypto_activity` (D-45)
- `periodic_and_other.period_close` (D-46)
- `periodic_and_other.reversal` (D-46)
- `periodic_and_other.opening_balance` (D-47)

## Where a builder already exists and nothing calls it

The cheapest real progress available. The accounting logic is written and tested; only
the path from the screen to the ledger is absent.

- `cost_of_goods_sold.cultivera_manifest_import` (D-49) -- `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- `cost_of_goods_sold.inventory_receipt` (D-34) -- `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- `vendor_cycle.vendor_bill_recorded` (D-34) -- `src/lib/accounting/vendor-bill-core.ts#buildBillJournal`
- `payroll_cycle.payroll_run_accrued` (D-38) -- `src/lib/accounting/payroll-cogs-core.ts#buildPayrollJournal`
- `cash_and_banking.intercompany_transfer` (D-41) -- `src/lib/accounting/posting-service.ts#submitIntercompanyPair`
- `periodic_and_other.bo_tax_accrual` (D-42) -- `src/lib/accounting/bo-tax-core.ts#boAccrualEntry`
- `periodic_and_other.fixed_asset_acquired` (D-43) -- `src/lib/accounting/fixed-assets-core.ts#accountCodeForClass`

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
- `vendor_cycle.operating_expense_from_bank` / `married`: There is no in-system counterpart to marry, which is what makes this family safe to auto-post and the right place to start wiring.
- `cash_and_banking.till_over_short` / `married`: There is no second arrival for money that went missing.
- `periodic_and_other.manual_journal` / `idempotent`: A hand-keyed entry has no external event to key on. Two identical entries may be two genuine entries, so the ledger must not silently merge them.
- `periodic_and_other.manual_journal` / `married`: Nothing automatic produced it, so nothing can duplicate it.
- `periodic_and_other.bo_tax_accrual` / `married`: The PAYMENT is the bank event, and boPaymentEntry is its builder.
- `periodic_and_other.depreciation_booked` / `married`: There is no bank line for a non-cash allocation.
- `periodic_and_other.period_close` / `married`: It is a reclass within equity.
- `periodic_and_other.reversal` / `married`: No bank line corresponds to a correction of a prior entry.
- `periodic_and_other.opening_balance` / `married`: There is no Plaid history for a balance carried in from Sage.

