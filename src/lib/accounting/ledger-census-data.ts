/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LEDGER REACHABILITY CENSUS — THE POPULATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, verbatim, books-70:
 *
 *   "I agree completely that the next slice should be the census build and map
 *    so nothing ever drifts while we wire everything up. I don't want to fold
 *    extra work into this slice. Just build the census and then get back to me
 *    with the first wiring slice."
 *
 *   "We need to systematically and methodically go through each function, every
 *    aspect of the system that generates a book entry to make sure it is
 *    producing a book entry and that it is correct and accurate."
 *
 * ── WHAT THIS FILE IS ─────────────────────────────────────────────────────
 *
 * The machinery lives in `ledger-census-core.ts`. This file is the DATA: one
 * row per economic event that should leave a mark in the books, each carrying a
 * MEASURED verdict on six layers, the command that produced the verdict, and
 * the defect id for every gap.
 *
 * It is code rather than a spreadsheet for exactly the reason Michael gave —
 * "so nothing ever drifts". A spreadsheet records what was true the day it was
 * typed. This file is validated on construction, asserted against the real
 * chart of accounts, and re-checked by `tests/compliance/ledger-census.test.ts`
 * against the real source tree on every run. When somebody wires an event up,
 * the census fails until the row is updated to say so.
 *
 * ── THE EVIDENCE DISCIPLINE ───────────────────────────────────────────────
 *
 * Every `evidence` string is the actual command or `file#symbol` that produced
 * the verdict, measured on 2026-08-27 against commit 5a163817. No status here
 * was remembered, inferred, or carried over from a previous session's notes.
 * Standing rule 1: never guess.
 *
 * Where a verdict could not be measured, the status is UNKNOWN and it says why.
 * Standing rule 48: a check that cannot classify must fail, never skip. An
 * UNKNOWN that is honest is worth more than a PRESENT that is optimistic.
 *
 * ── WHY `married` IS MOSTLY NOT_APPLICABLE ────────────────────────────────
 *
 * The marriage layer only applies where the SAME dollar arrives twice: once
 * from the system that spent it, once from the Plaid bank feed that saw it
 * leave. A POS sale has no second arrival, so its marriage layer is
 * NOT_APPLICABLE with a stated reason — not PRESENT. Recording a layer as
 * satisfied when it never applied is how a controls matrix flatters itself.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * It does not wire anything, post anything, or change any schema. Michael's
 * scope fence for books-70 was explicit: "I don't want to fold extra work into
 * this slice." A census that quietly started fixing things would be unable to
 * tell him what was broken before it started.
 */

/*
 * ── WHY THE FACTORY RESET IS NOT A ROW IN HERE (books-80, D-62) ────────────
 *
 * books-80 built `factory-reset-core.ts#buildResetPlan` and migration 0209
 * `gl_factory_reset(...)`, and deliberately did NOT add a census row for them.
 * This note exists so nobody later reads the absence as an oversight and
 * "fixes" it.
 *
 * The census population is defined one screen above as economic events that
 * "should leave a mark in the books". `validateCensusRow` enforces that
 * definition structurally, not stylistically: it requires a `sourceKind` drawn
 * from the ledger's own sixteen-value vocabulary, and it refuses any row naming
 * fewer than two account codes that exist in the real chart of accounts.
 *
 * A factory reset produces no journal entry. It is the deletion of journal
 * entries. There is no source kind for it — the sixteen are the sixteen — and
 * there are no two accounts it debits and credits. Forcing a row in would mean
 * inventing a source kind and naming two accounts the entry never touches,
 * which is precisely what the header above forbids: "It does not invent an
 * event."
 *
 * The reset is covered where coverage is meaningful and enforced:
 * `tests/compliance/factory-reset-core.test.ts` reads the real migrations off
 * disk and fails the build when a table exists that nobody classified, or when
 * 0209 stops deleting something the core classifies WIPE. That is a stronger
 * guarantee than a census row, because it is re-measured against the schema on
 * every run rather than re-typed by hand — which is the exact failure mode
 * (D-62) that produced the slice.
 */

import { LedgerCensus, type CensusRow } from "./ledger-census-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * THE ROWS
 * ═══════════════════════════════════════════════════════════════════════════ */

export const LEDGER_CENSUS_ROWS: readonly CensusRow[] = [
  /* ── FAMILY 1: REVENUE AND THE TAX YOU COLLECT FOR SOMEBODY ELSE ─────── */

  {
    key: "revenue_and_tax_collected.retail_sale",
    family: "revenue_and_tax_collected",
    event:
      "A customer buys product at the counter and pays. The price on the shelf " +
      "already includes both taxes.",
    sourceKind: "pos_sale",
    entityCode: "greenway",
    accountCodes: ["10110", "50010", "32000", "32100"],
    builder: "src/lib/accounting/sale-journal-core.ts#buildSaleJournal",
    poster: "src/lib/accounting/sale-posting-service.ts#postSaleForOrder",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-77 built sale-journal-core.ts#buildSaleJournal; grep -rn " +
          "'sourceKind: \"pos_sale\"' src/ -> 2 hits, both in that builder (the " +
          "revenue half and the COGS half).",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-82 wired it. orders-store.ts#setOrderStatus calls " +
          "sale-posting-service.ts#postSaleForOrder on the transition into " +
          "'completed' \u2014 the same status revenue-basis.ts pins revenue to \u2014 " +
          "and that service posts the revenue half via posting-service.ts#" +
          "submitJournal. tests/compliance/sale-posting-wiring.test.ts asserts " +
          "the call, the completion gate and the pre-decrement ordering; each " +
          "was mutation-probed and fails when broken.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "Both halves pass the real ledger-core.ts#validateJournalDraft with zero " +
          "issues, balance to the cent, and reconstitute the tax-inclusive price " +
          "exactly across a sweep of all 21 categories. 8 of 8 mutants caught. " +
          "books-82 closed the costing half: sale-cogs-core.ts#costSaleFromDraws " +
          "now sources line cost from the actual FIFO lot draw, replanned with " +
          "the decrement's own buildLotDecrementPlan. STILL PARTIAL: the draw is " +
          "reconstructed rather than read back from the decrement, which persists " +
          "no machine-readable per-lot draw (D-65).",
      },
      accepted: {
        status: "PARTIAL",
        evidence:
          "pos_sale is in AUTOPOSTABLE_SOURCE_KINDS (posting-core.ts:112) and the " +
          "0172 GL_CONTROL_ACCOUNT refusal is gated on source_kind='manual', so a " +
          "pos_sale entry may legitimately touch 32000/32100. Never yet presented " +
          "to a live gl_post_journal().",
      },
      idempotent: {
        status: "PARTIAL",
        evidence:
          "sourceRef is the POS order ref, and the COGS half uses '<ref>#cogs' so " +
          "the two halves cannot collide on the natural key. Untested against a " +
          "live unique index.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "Cash and card settlement are separate events, censused below.",
        reason:
          "The sale itself has no second arrival. The DEPOSIT of its proceeds does, " +
          "and that is a different row.",
      },
    },
    defectId: "D-31",
    consequence:
      "This is the single largest number in the business. books-77 built the " +
      "entry that records it: revenue NET of excise, and both taxes EXTRACTED " +
      "from the tax-inclusive shelf price into trust liabilities rather than " +
      "added on top. It is still not WIRED, so today the books remain empty of " +
      "sales — the gap moved from 'nothing computes this' to 'nothing calls it'.",
  },

  {
    key: "revenue_and_tax_collected.excise_liability_split",
    family: "revenue_and_tax_collected",
    event:
      "The 37% cannabis excise inside a tax-inclusive price is separated from the " +
      "retail sales tax, because they are owed to different places.",
    sourceKind: "excise",
    entityCode: "greenway",
    accountCodes: ["32000", "32100"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence: "grep -rn 'sourceKind: \"excise\"' src/ -> 0 hits.",
      },
      reachable: {
        status: "MISSING",
        evidence: "No caller anywhere; excise has zero producers.",
      },
      correct: {
        status: "MISSING",
        evidence:
          "Blocked upstream: the `orders` table (migration 0007) has no excise " +
          "column. It carries estimated_tax_minor_units, subtotal_minor_units and " +
          "total_minor_units only, so 32000 and 32100 cannot be told apart from " +
          "stored data.",
      },
      accepted: {
        status: "MISSING",
        evidence: "excise is autopostable per posting-core.ts:114; never presented.",
      },
      idempotent: {
        status: "MISSING",
        evidence: "No sourceRef convention defined.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "An accrual of tax collected is not a bank movement.",
        reason:
          "The excise PAYMENT to DOR is a bank movement and is censused separately.",
      },
    },
    defectId: "D-32",
    consequence:
      "32000 is TRUST money — collected on the state's behalf, never Michael's. " +
      "Booking it as revenue overstates income and understates a liability the " +
      "state can audit.",
  },

  {
    key: "revenue_and_tax_collected.discount_and_comp",
    family: "revenue_and_tax_collected",
    event: "A discount, loyalty redemption or comped item reduces what is collected.",
    sourceKind: "pos_sale",
    entityCode: "greenway",
    accountCodes: ["50900", "50000"],
    builder: null,
    poster: null,
    layers: {
      exists: { status: "MISSING", evidence: "No pos_sale builder exists at all." },
      reachable: { status: "MISSING", evidence: "Same as retail_sale: 0 hits." },
      correct: {
        status: "MISSING",
        evidence: "Account 50900 Discounts & Comps is seeded (0173) and unused.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No sourceRef convention." },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "A discount never moves cash.",
        reason: "There is no bank line for money that was never collected.",
      },
    },
    defectId: "D-31",
    consequence:
      "Without this, gross revenue and net revenue are the same number, which " +
      "hides margin erosion and misstates the excise base.",
  },

  {
    key: "revenue_and_tax_collected.refund_or_return",
    family: "revenue_and_tax_collected",
    event: "A customer returns product, or a sale is voided after tender.",
    sourceKind: "pos_sale",
    entityCode: "greenway",
    accountCodes: ["50910", "10110", "32000", "32100"],
    builder: null,
    poster: null,
    layers: {
      exists: { status: "MISSING", evidence: "No pos_sale builder." },
      reachable: { status: "MISSING", evidence: "0 submitJournal hits under src/lib/pos/." },
      correct: {
        status: "MISSING",
        evidence:
          "A refund must also reverse the two trust liabilities, not just revenue. " +
          "50910 Returns & Refunds is seeded and unused.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "MISSING",
        evidence:
          "Highest-risk idempotency case in the family: a retried refund that " +
          "double-posts hands money back twice in the books.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "Cash refunds leave the till, not the bank.",
        reason: "Card refunds appear in the settlement row, which is censused there.",
      },
    },
    defectId: "D-31",
    consequence:
      "Refunds reduce the excise Michael owes. Not booking them means overpaying " +
      "trust tax, and there is no record to claim it back with.",
  },

  /* ── FAMILY 2: INVENTORY AND COST OF GOODS SOLD ──────────────────────── */

  {
    key: "cost_of_goods_sold.cogs_on_sale",
    family: "cost_of_goods_sold",
    event: "Product leaves the shelf, so its cost has to move from asset to expense.",
    sourceKind: "inventory",
    entityCode: "greenway",
    accountCodes: ["60010", "20010"],
    builder: "src/lib/accounting/sale-journal-core.ts#buildSaleJournal",
    poster: "src/lib/accounting/sale-posting-service.ts#postSaleForOrder",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-77: buildSaleJournal returns cogsJournal alongside revenueJournal " +
          "and there is no way to ask for the revenue half alone. Re-measured the " +
          "old 'cogs-position-core -> 0 importers' claim: 5 files mention the name " +
          "but grep for a real 'from \".../cogs-position-core\"' -> 0, so the " +
          "original 0 was right and is now stated precisely.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-82 wired it with retail_sale, as predicted \u2014 the two shipped " +
          "together. postSaleForOrder posts the COGS half under sourceRef " +
          "'order:<id>#cogs', distinct from the revenue half's '#revenue' so the " +
          "ledger's own (entity, kind, ref) idempotency cannot collapse them.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "Debits 6xxxx and credits the mirrored 2xxxx on the same category slug " +
          "via coa-core helpers, carries cost_class 'cogs_direct' as 0173 requires " +
          "(GL_COST_CLASS_REQUIRED), and refuses with UNIT_COST_UNKNOWN rather than " +
          "booking a sale at zero cost. books-82 supplied the missing half: " +
          "sale-cogs-core.ts extends the FIFO lot draw by inventory_lots." +
          "unit_cost_minor_units and REFUSES (LOT_COST_MISSING) rather than " +
          "averaging over an uncosted lot. Split costs were measured exact across " +
          "500 three-way splits. STILL PARTIAL for the D-65 reconstruction gap.",
      },
      accepted: {
        status: "PARTIAL",
        evidence:
          "Passes validateJournalDraft against 0173-shaped accounts with zero " +
          "issues. Not yet presented to a live gl_post_journal().",
      },
      idempotent: {
        status: "PARTIAL",
        evidence: "sourceRef '<orderRef>#cogs'. Untested against a live unique index.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "COGS is an internal reclass.",
        reason: "No cash moves, so no bank line can duplicate it.",
      },
    },
    defectId: "D-33",
    consequence:
      "Under IRC 280E, COGS is the ONLY deduction a cannabis retailer gets. An " +
      "unbooked COGS is tax paid on gross receipts instead of gross profit — the " +
      "most expensive single gap in this census. books-77 closed the arithmetic " +
      "and bound it to the sale so it cannot be forgotten; the wiring remains.",
  },

  {
    key: "cost_of_goods_sold.cutover_inventory_load",
    family: "cost_of_goods_sold",
    event:
      "THE CUT-OVER. Inventory is counted on 2026-10-31 after close and loaded " +
      "into this platform on 2026-11-01 before open, carrying its value from " +
      "Cultivera. This is the single largest asset number the books will ever " +
      "receive, and it arrives once.",
    sourceKind: "opening_balance",
    entityCode: "greenway",
    accountCodes: ["20000", "20010", "20890", "40400"],
    builder: "src/lib/accounting/cutover-inventory-core.ts#buildCutoverInventoryPlan",
    poster: null,
    layers: {
      exists: {
        status: "PARTIAL",
        evidence:
          "books-72 WROTE THE BUILDER: cutover-inventory-core.ts, a pure leaf " +
          "with zero imports. buildCutoverInventoryPlan() turns a counted lot " +
          "list into a balanced opening-balance line set \u2014 per-category 200xx " +
          "debits and ONE 40400 credit \u2014 and returns a refusal rather than a " +
          "half-usable result. Gated twice: __runCutoverInventoryCoreTests() in " +
          "run-pure-selftests.ts, plus 45 vitest assertions in " +
          "tests/compliance/cutover-inventory-core.test.ts that check parity " +
          "against coa-core.INVENTORY_CATEGORIES, vendor-bill-core.CATEGORY_SLOTS " +
          "and the real 0173 seed text. PARTIAL, not COMPLETE, because the " +
          "builder is only the ENTRY: no migration, no UI, no server action and " +
          "no posting call exist, so nothing can present its output to " +
          "gl_opening_balances yet. inventoryAccountForCategory " +
          "(vendor-bill-core.ts:966) already solved the ACCOUNT side; books-71 " +
          "measured the CATEGORY side solved too (transform.ts CATEGORY_MAP " +
          "covers 52 of 52 Cultivera categories, 100.00% of value, $0.00 to " +
          "20890 quarantine). books-73 THEN GAVE THE LEDGER ITS OWN MAP on " +
          "Michael's decision: 'the ledger should use its own accounts and not " +
          "the website map.' ledger-category-map-core.ts is a second pure leaf " +
          "(zero imports) mapping 53 Cultivera categories to 16 block-2 " +
          "accounts, with the four D-50 overrides applied (RSO 20150, Tincture " +
          "20180, Infused Blunt 20100, Blunt 20070 = $6,900.07 re-routed), NO " +
          "fallback account, and CATEGORY_UNKNOWN naming anything it has not " +
          "seen. Gated twice (self-tests + 42 vitest assertions) and hardened " +
          "by 39 mutants, 39 dead, 0 survivors.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "STILL MISSING ON PURPOSE after books-72. The builder exists but " +
          "NOTHING CALLS IT: grep -rn 'buildCutoverInventoryPlan' src/ finds " +
          "only its own definition, and the only other references are the test " +
          "and the self-test runner. src/app/admin/books/conversion/page.tsx is " +
          "361 lines and deliberately read-only: grep for 'rpc(' in it -> 0 " +
          "hits, and its own header says 'Nothing here posts anything.' No src/ " +
          "file inserts into gl_opening_balances; ledger-store.ts:458 only " +
          "SELECTs from it. Writing a builder does not make a path reachable, " +
          "and recording otherwise would be the exact overstatement this census " +
          "was built to prevent. books-73: this is now a DELIBERATE DEFERRAL " +
          "with an owner quote behind it, not an unmeasured gap. Michael: 'we " +
          "are not ready to migrate inventory over yet.' It must not be marked " +
          "reachable until he asks for the wiring.",
      },
      correct: {
        status: "UNKNOWN",
        evidence:
          "The account side is determined: 0173 seeds 21 per-category inventory " +
          "accounts under control account 20000, and gl_guard_inventory_manual " +
          "(0173:316) REFUSES any source_kind='manual' line touching a 2xxxx asset, " +
          "so this load must be source_kind 'opening_balance', 'inventory' or " +
          "'purchase' by database law, never a typed journal.",
        reason:
          "Michael's Cultivera export has now been MEASURED (books-71 recon, " +
          "scripts/recon/cultivera-measure.py): INVENTORIES.xlsx carries a usable " +
          "non-zero Cost on 3,917 of 3,917 rows, zero blanks, zero zeros, zero " +
          "negatives, extending to $176,824.62 and cross-verified by parsing the " +
          "raw sheet XML. So per-unit cost EXISTS. THE LANDED-VS-INVOICE " +
          "QUESTION IS NOW CLOSED by the owner directly: 'The cost from Cultivera " +
          "is the invoice cost. There isn't any other cost associated with " +
          "inventory purchases unfortunately... All that matters is the cost from " +
          "the spreadsheet is the all inclusive cost for that product.' So the " +
          "builder adds nothing to it. ONE unknown remains and it is not a code " +
          "question: the 2026-10-31 physical count has not happened, so the " +
          "actual quantities do not exist yet. Rule 1: the census will not invent " +
          "the largest asset figure on the balance sheet. (Employee hours " +
          "capitalised into COGS were explicitly excluded from this slice by the " +
          "owner and are NOT modelled.) books-73 CLOSED THE BARCODE QUESTION: " +
          "41 barcodes repeat, 6 groups at DIFFERENT costs, and Michael said " +
          "'keep both layers.' So the builder keys on Id (3,917 distinct, 0 " +
          "duplicates), never Barcode, and no cost is averaged. It already " +
          "behaved this way, so the answer confirms the build rather than " +
          "changing it.",
      },
      accepted: {
        status: "PARTIAL",
        evidence:
          "Migration 0186 already moves the opening-balance date to 2026-10-31, " +
          "matching Michael's stated cut-over, and records that the old hard-coded " +
          "2025-12-31 would have stamped it TEN MONTHS EARLY while balancing. " +
          "0176:76 lists 'inventory_count' as a valid evidence_kind, so the " +
          "worksheet is designed to accept exactly this row. Nothing has presented " +
          "one.",
      },
      idempotent: {
        status: "MISSING",
        evidence:
          "Loading the cut-over count twice would double the largest asset on the " +
          "balance sheet. gl_ob_guard_frozen (0176:162) freezes rows once blessed, " +
          "which protects the WORKSHEET, but no ref convention protects the load " +
          "itself because no load path exists.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "No bank row corresponds to a cut-over count.",
        reason:
          "This product was already bought and paid for under Cultivera and Sage. " +
          "Its cash left the bank before this platform existed, so there is no " +
          "second arrival to reconcile against.",
      },
    },
    defectId: "D-48",
    consequence:
      "This is the number every subsequent COGS figure is measured from. Book it " +
      "as a PURCHASE and the books invent an accounts-payable balance to vendors " +
      "who were already paid, overstating liabilities and understating equity by " +
      "the entire value of the shelf. Book it at the wrong value and every 280E " +
      "cost-of-goods deduction for the life of the business inherits the error, " +
      "and the balance sheet balances either way.",
  },
  {
    key: "cost_of_goods_sold.cultivera_manifest_import",
    family: "cost_of_goods_sold",
    event:
      "AFTER cut-over: a Cultivera / WCIA transfer data link (or a batch of " +
      "hundreds) is imported, staging a manifest whose lots later go on the shelf.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["20000", "20890", "30000"],
    builder: "src/lib/accounting/vendor-bill-core.ts#buildBillJournal",
    poster: null,
    layers: {
      exists: {
        status: "PARTIAL",
        evidence:
          "The import parses cost: intake-parser.ts:375-380 computes " +
          "unit_cost_minor_units as round(linePrice / qty * 100), and 0023/0028 " +
          "store it on inventory_lots. But ccrs-manifest-csv-core.ts:495 " +
          "hard-codes 'unit_cost_minor_units: null' for the CCRS CSV shape, " +
          "because a CCRS transfer file carries no price. So cost survives the " +
          "URL/PDF path and is absent on the CSV path. books-71 recon adds a " +
          "second measured source of this hole: PRODUCTS.xlsx, the Cultivera " +
          "catalog export, has Vendor Price BLANK on 3,311 of 3,311 rows, so the " +
          "catalog side carries no cost either. Cost can only come from the " +
          "INVENTORIES export or from purchase history.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "books-91 RE-MEASURED this row, which was STALE: it still claimed " +
          "'0 posting calls' after books-83 had wired one. The call exists -- " +
          "finalizeManifestAction (src/app/admin/inventory/intake/actions.ts) " +
          "invokes vendor-bill-service.ts#postManifestVendorBill. This row stays " +
          "MISSING for a DIFFERENT and still-true reason: the CCRS CSV import " +
          "path hard-codes unit_cost_minor_units: null " +
          "(ccrs-manifest-csv-core.ts:495, a CCRS transfer file carries no " +
          "price), translateLotsToBillLines skips any line whose extended amount " +
          "is zero, and a delivery of only zero-cost lots therefore refuses with " +
          "BILL_NO_BILLABLE_LOTS. Value still reaches nothing on that path -- but " +
          "it now refuses in writing on the manifest timeline (D-71) instead of " +
          "silently.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "buildBillJournal resolves cannabis lines to the CATEGORY subaccount via " +
          "inventoryAccountForCategory and falls back to 20890 quarantine on an " +
          "unknown category rather than guessing (vendor-bill-core.ts:1140-1146). " +
          "That is the right shape. Untested against a manifest, because no " +
          "manifest has ever been handed to it.",
      },
      accepted: {
        status: "MISSING",
        evidence:
          "'purchase' is a permitted source_kind in the 0172:277 CHECK and " +
          "gl_guard_inventory_manual explicitly names it as a legitimate way for " +
          "inventory to move. Never presented.",
      },
      idempotent: {
        status: "PARTIAL",
        evidence:
          "billSourceRef yields 'manifest:<n>', which is the correct key for a " +
          "manifest-derived entry. The import itself de-duplicates URLs " +
          "client-side and reports 'already imported', so the STAGING side is " +
          "idempotent; the posting side has never run.",
      },
      married: {
        status: "MISSING",
        evidence:
          "The vendor is paid later by ACH and that payment arrives again through " +
          "Plaid; 0067_vendor_manifest_payments.sql computes the owed total as " +
          "SUM(received_qty * unit_cost_minor_units) but nothing books either side.",
      },
    },
    defectId: "D-49",
    consequence:
      "Every post-cut-over delivery puts sellable product on the shelf with no " +
      "corresponding asset or liability in the books. Inventory on hand grows, " +
      "the ledger does not, and the gap is invisible because both systems are " +
      "internally consistent. On the CCRS CSV path the cost is NULL, so even once " +
      "wired that path would post a zero-value receipt unless it refuses instead.",
  },
  {
    key: "cost_of_goods_sold.inventory_receipt",
    family: "cost_of_goods_sold",
    event: "A vendor delivery is received and the product goes on the shelf.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["20000", "30000"],
    builder: "src/lib/accounting/vendor-bill-core.ts#buildBillJournal",
    poster: "src/lib/accounting/vendor-bill-service.ts#postManifestVendorBill",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "vendor-bill-core.ts exports a journal builder with account mappings " +
          "and 280E cost classes.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-83 wired it. finalizeManifestAction (src/app/admin/inventory/" +
          "intake/actions.ts) calls vendor-bill-service.ts#" +
          "postManifestVendorBill when a finalize activates at least one lot; " +
          "that service reads the manifest's non-rejected lots, builds via " +
          "buildBillJournal and posts through posting-service.ts#submitJournal. " +
          "There is no separate bill-entry screen by design: vendor-payments/" +
          "actions.ts records that an accepted manifest IS the WCIA invoice. " +
          "tests/compliance/vendor-bill-wiring.test.ts asserts the call, the " +
          "activated>0 gate and the rendered refusal; 8 mutations, 8 caught.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "Builder balances in its own self-tests, and every account it targets " +
          "(including capitalisation codes 21500/21600/21700) is seeded: 0173 " +
          "for the operating chart, 0178 for the fixed-asset block.",
      },
      accepted: {
        status: "PRESENT",
        evidence:
          "books-83: postManifestVendorBill posts through submitJournal, which " +
          "calls the gl_submit_journal door and returns its refusal verbatim. " +
          "Migration 0187's gl_post_vendor_bill remains uncalled; the entry " +
          "reaches the ledger through the same door every other slice uses, so " +
          "the 0187 door is redundant rather than missing.",
      },
      idempotent: {
        status: "PRESENT",
        evidence:
          "vendor-bill-core.ts#billSourceRef builds a real key: `manifest:<n>` when " +
          "the bill came from an accepted manifest, else `bill:<vendor>:<invoice>`. " +
          "books-83 made it live: re-finalizing a manifest returns outcome " +
          "'duplicate' and writes nothing. The ref differs from the receipt's " +
          "`<n>#receipt`, so the two events cannot be mistaken for each other.",
      },
      married: {
        status: "MISSING",
        evidence:
          "Receiving goods creates a payable; paying it later is the bank event. " +
          "No link exists between the two.",
      },
    },
    defectId: "D-34",
    consequence:
      "Inventory purchases are the input to COGS. If receipts are not booked, the " +
      "20000 control account stays at zero and no COGS figure can be trusted.",
  },

  {
    key: "cost_of_goods_sold.inventory_audit_adjustment",
    family: "cost_of_goods_sold",
    event: "A physical count finds more or less product than the system expected.",
    sourceKind: "inventory",
    entityCode: "greenway",
    accountCodes: ["20000", "20810", "60810"],
    builder: "src/lib/inventory/inventory-audit-store.ts#postAuditSession",
    poster: "src/lib/inventory/inventory-audit-store.ts#postAuditSession",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "inventory-audit-store.ts:458 calls submitJournal with sourceKind " +
          "'inventory'.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "One of only two live ledger writers in the whole platform, reached from " +
          "the inventory audit screen.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "audit-posting-accounts.ts derives account codes from INVENTORY_CATEGORIES " +
          "rather than a literal map, and a structural test enforces that.",
      },
      accepted: {
        status: "PRESENT",
        evidence:
          "Posts through submitJournal, which is the door migration 0174 governs.",
      },
      idempotent: {
        status: "PRESENT",
        evidence: "sourceRef is `audit:${sessionId}`, unique per session.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "A count adjustment moves no money.",
        reason: "Nothing in the bank feed can correspond to a shrink write-off.",
      },
    },
    defectId: null,
    consequence:
      "This is the one path that already works end to end. It is the template the " +
      "wiring slices should copy.",
  },

  {
    key: "cost_of_goods_sold.freight_in",
    family: "cost_of_goods_sold",
    event: "An inbound delivery charge that belongs in the cost of the product.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["60800", "30000"],
    builder: null,
    poster: null,
    layers: {
      exists: { status: "MISSING", evidence: "No builder targets 60800." },
      reachable: { status: "MISSING", evidence: "No purchase path posts." },
      correct: {
        status: "MISSING",
        evidence: "60800 Freight-In is seeded (0173) and never referenced in src/.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No sourceRef convention." },
      married: {
        status: "MISSING",
        evidence: "Freight is usually paid by ACH and would arrive twice.",
      },
    },
    defectId: "D-34",
    consequence:
      "Freight-in is 280E-deductible as part of inventory cost. Booked as an " +
      "operating expense instead, it becomes non-deductible and raises tax owed.",
  },

  /* ── FAMILY 3: BUYING FROM VENDORS AND PAYING THEM ───────────────────── */

  {
    key: "vendor_cycle.purchase_order_commitment",
    family: "vendor_cycle",
    event: "A purchase order is approved and sent to a vendor.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["20800", "30000"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence:
          "12 po-* modules under src/lib/purchasing/; grep for submitJournal or " +
          "gl_post across all of them -> 0 hits.",
      },
      reachable: { status: "MISSING", evidence: "Zero ledger references in purchasing/." },
      correct: {
        status: "NOT_APPLICABLE",
        evidence: "GAAP: an unfulfilled PO is a commitment, not a transaction.",
        reason:
          "A plain PO should NOT hit the ledger. Michael asked whether POs are " +
          "'properly booked' — the correct answer is that the RECEIPT is booked, " +
          "not the order. This row exists so that answer is recorded rather than " +
          "rediscovered.",
      },
      accepted: {
        status: "NOT_APPLICABLE",
        evidence: "Nothing should be presented.",
        reason: "No entry is due at commitment.",
      },
      idempotent: {
        status: "NOT_APPLICABLE",
        evidence: "No entry, no ref.",
        reason: "No entry is due at commitment.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "No money has moved.",
        reason: "No entry is due at commitment.",
      },
    },
    defectId: "D-35",
    consequence:
      "The gap is not the missing entry — it is that nothing connects an approved " +
      "PO to the receipt that SHOULD post. In-transit inventory (20800) is the " +
      "account that would carry it if goods ship before they arrive.",
  },

  {
    key: "vendor_cycle.goods_received",
    family: "vendor_cycle",
    event: "A delivery physically arrives and its cost becomes inventory.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["20010", "20800", "20890"],
    builder: "src/lib/accounting/receipt-journal-core.ts#buildReceiptJournal",
    poster: "src/lib/accounting/receipt-service.ts#postManifestReceipt",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "receipt-journal-core.ts debits the category inventory account (or " +
          "20890 for an unmapped line) and credits 20800, balanced.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-81 wired it. setManifestLifecycleAction (src/app/admin/" +
          "inventory/intake/actions.ts) calls receipt-service.ts#" +
          "postManifestReceipt when status flips to 'received'; that service " +
          "translates lots, calls buildReceiptJournal, and posts via " +
          "posting-service.ts#submitJournal. tests/compliance/receipt-wiring." +
          "test.ts asserts the call, the 'received' gate and the ordering, and " +
          "all three were mutation-probed to confirm they fail when broken.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "Balanced and integer-only; the receipt and the bill were added " +
          "together and measured to net 20800 to 0 with inventory debited once " +
          "(books-79). NOT PRESENT: the bill's goodsAlreadyReceived flag " +
          "defaults false, so D-61 is still reachable by omission until a " +
          "caller passes it. Also D-64: inventory_lots.category is free text, " +
          "so receipt-category-core.ts refuses the whole delivery rather than " +
          "guess an account, which is safe but blocks receiving on any " +
          "spelling it does not know.",
      },
      accepted: {
        status: "PRESENT",
        evidence:
          "The receipt does not need a bespoke SQL door: postManifestReceipt " +
          "posts through posting-service.ts#submitJournal, which calls the " +
          "generic rpc('gl_submit_journal') door from migration 0174.",
      },
      idempotent: {
        status: "PARTIAL",
        evidence:
          "sourceRef is `${receiptRef}#receipt`, deterministic and distinct " +
          "from the bill's manifest:/bill: keys, and it is now genuinely " +
          "supplied by postManifestReceipt. NOT PRESENT: re-flipping a " +
          "manifest to 'received' has not been measured end-to-end against " +
          "gl_submit_journal's duplicate handling, so the guarantee is " +
          "designed but unproven.",
      },
      married: {
        status: "MISSING",
        evidence:
          "receivedCentsForMatch feeds vendor-bill-core.ts#threeWayMatch, but " +
          "nothing calls either, so the receipt and the invoice remain unlinked.",
      },
    },
    defectId: "D-61",
    consequence:
      "This is where cost is born. Until it runs, inventory_lots.unit_cost_" +
      "minor_units stays null and buildSaleJournal refuses with " +
      "UNIT_COST_UNKNOWN, so no sale can post at all \u2014 and under 280E an " +
      "unknown cost eventually becomes a lost deduction.",
  },

  {
    key: "vendor_cycle.vendor_bill_recorded",
    family: "vendor_cycle",
    event: "An invoice arrives from a vendor and becomes a payable.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["30000", "20000"],
    builder: "src/lib/accounting/vendor-bill-core.ts#buildBillJournal",
    poster: "src/lib/accounting/vendor-bill-service.ts#postManifestVendorBill",
    layers: {
      exists: {
        status: "PRESENT",
        evidence: "vendor-bill-core.ts builds a full bill journal with cost classes.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-83 wired it into finalizeManifestAction (src/app/admin/" +
          "inventory/intake/actions.ts), gated on a finalize that activated at " +
          "least one lot so a wholly rejected manifest never invents a payable.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "Balanced, every account seeded across 0173/0178, and books-83 closed " +
          "D-61 on the live path: vendor-bill-service derives " +
          "goodsAlreadyReceived from the LEDGER via receipt-evidence.ts, and " +
          "REFUSES (BILL_RECEIPT_EVIDENCE_UNKNOWN) when the ledger cannot be " +
          "read rather than defaulting to false. The builder's own default is " +
          "still false, which is why the D-61 entry stays open as a builder-" +
          "level trap for any future caller that bypasses this service.",
      },
      accepted: {
        status: "PRESENT",
        evidence:
          "Posts through posting-service.ts#submitJournal, i.e. the " +
          "gl_submit_journal door, and surfaces its refusal to the screen. " +
          "0187's gl_post_vendor_bill stays uncalled and is now redundant.",
      },
      idempotent: {
        status: "PRESENT",
        evidence:
          "billSourceRef prefers the manifest number as the strongest external " +
          "key and falls back to vendor+invoice. Live since books-83: a second " +
          "finalize returns 'duplicate' and writes nothing.",
      },
      married: {
        status: "MISSING",
        evidence:
          "The bill and its later ACH payment are two events; nothing links them.",
      },
    },
    defectId: "D-34",
    consequence:
      "Without payables, the balance sheet shows no money owed and cash-basis and " +
      "accrual-basis results diverge silently.",
  },

  {
    key: "vendor_cycle.expense_classified_to_account_and_entity",
    family: "vendor_cycle",
    event:
      "A card swipe or bank debit at a named vendor has to become a specific " +
      "account, on a specific entity's books, with a specific tax character.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["70010", "70020", "70030", "70040", "71010", "76010"],
    builder:
      "src/lib/accounting/expense-classification-core.ts#classifyExpense",
    poster:
      "src/lib/accounting/bank-expense-service.ts#recordBankExpenseLines",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "expense-classification-core.ts exports classifyExpense and the " +
          "parameterized classifyIn; 50 tests in " +
          "tests/compliance/expense-classification-core.test.ts plus a registered " +
          "self-test in scripts/compliance/run-pure-selftests.ts.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-88 finished this. It was claimed PRESENT in books-84 on the " +
          "strength of recordBankExpenseLines calling classifyExpense({ merchant }) " +
          "on every settled row -- true, but one link short of the owner: NOTHING " +
          "CALLED THE SERVICE, so no merchant was ever classified in practice " +
          "(D-70, found by Michael refreshing his ATM feed and getting no drafts). " +
          "The full chain is now bank/page.tsx -> RecordBankExpensesPanel -> " +
          "bank/actions.ts#recordBankExpensesAction -> recordBankExpenses -> " +
          "recordBankExpenseLines -> classifyExpense -> submitJournal. Asserted " +
          "by a reachability trap that walks src/ for a caller of the SERVICE and " +
          "excludes this census file, because citing yourself is how a poster " +
          "counts as reached while being dead. Note the seeded gl_account_rules " +
          "table still has no TypeScript reader: the live rules are " +
          "SEED_EXPENSE_RULES in the module, which is what the classifier's own " +
          "tests measure (D-30 is unchanged).",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "MEASURED from Michael's five Sage exports (550 rows, $368,276.34; 60 " +
          "distinct vendors). PARTIAL is itself the measurement: 54 of 60 vendors " +
          "map to exactly one G/L account and are seeded; the other 6 hit two or " +
          "three accounts in his own history (LIQUOR & CANNABIS BOARD, MICHAEL " +
          "LYMAN, OFFICE DEPOT, SECRETARY OF THE STATE, STAPLES, VENTURE LIFE AND " +
          "HEALTH) and are REFUSED as MERCHANT_AMBIGUOUS, so the classifier " +
          "cannot finish 6/60 of vendors alone. Any vendor outside the seeded 54 " +
          "returns MERCHANT_UNKNOWN: there is no fallback account, because a " +
          "silent 76010 would be indistinguishable from a correct answer in every " +
          "report (rule 48). Entity assignment is read from Michael's own account " +
          "suffixes -- 81001/81002/81003-LYMAN utilities, maintenance and property " +
          "tax, 121 rows / $61,109.02 -- not from judgement. Chart facts are " +
          "drift-tested against migration 0173; the reseller COGS bar is " +
          "mutation-verified across all 14 barred accounts (6/6 mutants caught, " +
          "D-58).",
      },
      accepted: {
        status: "PARTIAL",
        evidence:
          "A door now accepts the decision: the classified account becomes the " +
          "debit line of a 'bank' journal. The entry lands as a DRAFT, and " +
          "books-85 built the path that drains drafts -- /admin/books/drafts " +
          "plus approveAndPostJournal(), which calls gl_post_journal (D-67, " +
          "closed). Still PARTIAL rather than PRESENT for one honest reason: no " +
          "entry from this wire has been posted against a live database yet. " +
          "The logic is swept and mutation-tested; the round trip is not " +
          "proven. This reaches PRESENT on the first real post, not before.",
      },
      idempotent: {
        status: "UNKNOWN",
        evidence:
          "The module is pure and deterministic -- no clock, no randomness, no " +
          "I/O, all asserted by test; normalizeMerchant is idempotent and " +
          "first-match-wins is pinned, so the same vendor text always yields the " +
          "same account, entity, cost class and provenance across repeated runs.",
        reason:
          "Deterministic is NOT the same as idempotent, and recording it as " +
          "PRESENT here would conflate them. Idempotence is a property of " +
          "POSTING -- classify the same bank line twice and the ledger still shows " +
          "one entry -- and this module never posts, so the property is untested " +
          "rather than satisfied. It resolves when a caller carries the decision " +
          "through a door with a source_ref; the ref will have to come from the " +
          "bank transaction id, because merchant text repeats every month.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence:
          "classifyExpense takes merchant text and returns a decision; it never " +
          "sees a bank feed and has no second arrival to reconcile against.",
        reason:
          "Classification decides how ONE arrival is characterised. The same " +
          "dollar arriving twice -- once from the system that spent it, once from " +
          "the Plaid debit that saw it leave -- is the payment event's problem, " +
          "and it is already tracked on vendor_cycle.vendor_paid_by_ach. Marking " +
          "this layer PRESENT here would double-count a control that lives " +
          "elsewhere.",
      },
    },
    defectId: "D-56",
    consequence:
      "This is the row that decides which entity's books a cost lands on and " +
      "whether it is COGS or 280E-disallowed -- the two facts that set Michael's " +
      "taxable income. A wrong cogs_direct on store rent or wages is the line an " +
      "auditor pulls first: Reg. 1.471-3(b) allows a reseller only invoice price " +
      "plus the cost of acquiring possession, and 263A(a)(2) bars capitalising " +
      "anything 280E disallows. The classifier refuses that combination outright " +
      "rather than letting it balance.",
  },

  {
    key: "vendor_cycle.vendor_paid_by_ach",
    family: "vendor_cycle",
    event:
      "Greenway pays a vendor by ACH through the system, and days later the bank " +
      "debit shows up in Plaid.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["30000", "10200"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence:
          "nacha-core, vendor-ach-core, payee-banking-store and vendor-payables-store " +
          "exist; grep for submitJournal across them -> 0 hits.",
      },
      reachable: { status: "MISSING", evidence: "Zero ledger references in the ACH stack." },
      correct: {
        status: "MISSING",
        evidence: "No entry is built, so correctness cannot be measured.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No sourceRef convention for an ACH batch." },
      married: {
        status: "PARTIAL",
        evidence:
          "src/lib/payments/vendor-reconcile-core.ts#reconcileVendorPayments already " +
          "matches system payments to bank withdrawals with a tolerance. It returns " +
          "matches and posts nothing.",
      },
      // NOTE: `married: PARTIAL` with `reachable: MISSING` is deliberate and
      // permitted. The matching LOGIC genuinely exists and is tested; what is
      // missing is the posting. Recording this as MISSING would erase real work
      // and would send a future wiring slice off to rebuild it.
    },
    defectId: "D-36",
    consequence:
      "This is the exact double-booking risk Michael described. Both the system " +
      "payment and the Plaid debit are individually correct, so booking both " +
      "balances the books and doubles the expense.",
  },

  {
    key: "vendor_cycle.operating_expense_from_bank",
    family: "vendor_cycle",
    event:
      "A card or bank charge appears in the Plaid feed with no corresponding event " +
      "inside the system.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["76040", "10200"],
    builder: "src/lib/accounting/bank-expense-core.ts#planBankExpense",
    poster: "src/lib/accounting/bank-expense-service.ts#recordBankExpenses",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-84. bank-expense-core.ts turns one settled Plaid row plus the " +
          "owner-set account role into a balanced two-line entry; " +
          "bank-expense-service.ts reads the feed and submits it. 24 tests, " +
          "12/12 mutants killed. Migration 0189's reconciliation suite " +
          "(gl_post_bank_match et al) remains uncalled and is REDUNDANT here " +
          "rather than missing: matching means 'this bank row and this EXISTING " +
          "journal are the same money', and this family has no in-system " +
          "counterpart to match to, so the entry must be created first.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-88 built the door. recordBankExpenses(plaidAccountId) reads " +
          "plaid_accounts + plaid_transactions and calls submitJournal, and that " +
          "much was true in books-84 -- but the books-84 test asserted only that " +
          "the SERVICE calls submitJournal, never that anything calls the service, " +
          "and nothing did (D-70). The other three posters survived because each " +
          "hangs off an event the system already raises (a sale, an intake, an " +
          "audit); a bank feed raises none, which is precisely why this one was " +
          "forgotten. The door is deliberately a button the owner presses on " +
          "/admin/books/bank, not a background job: classification refuses " +
          "unknown and ambiguous merchants by name, and a refusal nobody is " +
          "looking at is a refusal nobody acts on. Asserted by a reachability " +
          "trap covering all four posting services that walks src/ and excludes " +
          "this census file.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "The two failure modes that still BALANCE are both gated. SIGN: " +
          "plaid-money-core.ts:18-20 defines POSITIVE amount_cents as money " +
          "LEAVING, so the expense is debited +amountCents and the funding " +
          "account credited -amountCents; mutants M1/M2 invert this and are " +
          "caught. 280E: migration 0172 check (7) demands a real cost class on " +
          "the expense line and 'none' on the balance-sheet line, so the two " +
          "lines deliberately differ; mutant M5 unifies them and is caught.",
      },
      accepted: {
        status: "PARTIAL",
        evidence:
          "Entries are created as DRAFTS. 'bank' is in AUTOPOSTABLE_SOURCE_KINDS, " +
          "but auto-post also requires an approved template and no template rows " +
          "are seeded, so nothing auto-posts in practice. The draft is no longer " +
          "stranded: books-85 shipped the review screen and the approve/post " +
          "service (D-67, closed), and 'bank' is one of the source kinds " +
          "gl_guard_journal_approval exempts from a second signature, so it " +
          "posts on one click. PARTIAL and not PRESENT because no bank entry " +
          "has yet made that round trip against a live database.",
      },
      idempotent: {
        status: "PRESENT",
        evidence:
          "sourceRef is the Plaid transaction_id, unique in plaid_transactions " +
          "and stable for a settled row, so submitJournal's (entity, sourceKind, " +
          "sourceRef) key makes a re-run return outcome 'duplicate'. Pending rows " +
          "are refused precisely because their id is NOT stable: Plaid replaces " +
          "them on settlement. Mutant M10 makes the ref date-dependent, caught.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "The bank feed IS the only source for this event.",
        reason:
          "There is no in-system counterpart to marry, which is what makes this " +
          "family safe to auto-post and the right place to start wiring.",
      },
    },
    defectId: "D-37",
    consequence:
      "These are the expenses Michael's CPA needs categorised for the return. It " +
      "is also the lowest-risk wiring target, because nothing else can duplicate it.",
  },

  /* ── FAMILY 4: PAYROLL ───────────────────────────────────────────────── */

  {
    key: "payroll_cycle.payroll_run_accrued",
    family: "payroll_cycle",
    event:
      "A payroll run is calculated: gross wages, employee withholding, employer " +
      "taxes, and the split between shop labour and inventory-handling labour.",
    sourceKind: "payroll",
    entityCode: "greenway",
    // 71040 and 31300 were ADDED in books-86. They were missing, and the
    // omission was found by reading a real journal rather than by reading this
    // row: buildPayrollJournal emits employer tax expense (71040) and
    // garnishments payable (31300) whenever either is non-zero. A census that
    // under-states the accounts an entry touches is a census that cannot be
    // used to check a trial balance, which is the job it exists to do.
    accountCodes: ["71010", "71040", "61000", "31000", "31100", "31200", "31300"],
    builder: "src/lib/accounting/payroll-cogs-core.ts#buildPayrollJournal",
    poster: "src/lib/accounting/payroll-posting-service.ts#postPayrollRun",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "payroll-cogs-core.ts#buildPayrollJournal builds a complete payroll " +
          "journal including the 61000 allocable-labour split.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-86 wired it. The chain is payroll-posting-core.ts#planPayrollPosting " +
          "-> payroll-posting-service.ts#postPayrollRun -> " +
          "app/admin/books/pay-run/actions.ts#postPayrollAction, rendered by " +
          "PostPayrollButton.tsx on /admin/books/pay-run. A test in " +
          "ledger-census.test.ts re-derives this chain from disk and asserts the " +
          "builder has exactly ONE caller, so a cut wire fails a gate.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "Balanced and 280E-classed in its own self-tests, which are registered " +
          "in run-pure-selftests.ts. payroll-posting-core.ts adds 51 tests and a " +
          "16-mutation probe (mutate-slice-books-86.py, 16/16 caught).",
      },
      accepted: {
        status: "PRESENT",
        evidence:
          "postPayrollRun calls supabase.rpc('gl_post_payroll_run') on a " +
          "createBooksClient() session, so auth.uid() is the signed-in human and " +
          "is_owner() can pass. Refusals are translated by " +
          "gl-refusal-core.ts#explainGlRefusal, which already carries plain-English " +
          "text for GL_NOT_OWNER and every GL_PAYROLL_* code.",
      },
      idempotent: {
        status: "PARTIAL",
        evidence:
          "payrollSourceRef gives a stable key (payroll:entity:start:end:paydate), " +
          "so a second click is refused as a duplicate. But p_run_id is sent as " +
          "null, because nothing links a pay PERIOD to a payroll_runs row, so the " +
          "database cannot raise GL_PAYROLL_RUN_CHANGED when the money behind an " +
          "already-posted run changes. The fingerprint travels in the assumption " +
          "note so the change is at least visible on the entry. Double-posting is " +
          "prevented; a CHANGED run is not yet detected by the database, and that " +
          "missing link is recorded as D-68 rather than guessed at.",
      },
      married: {
        status: "MISSING",
        evidence:
          "src/lib/payroll/payroll-reconcile-core.ts#reconcilePayroll matches runs " +
          "to bank withdrawals and posts nothing. Accruing payroll and clearing it " +
          "against the ACH debit are two different slices; this row is the accrual.",
      },
    },
    defectId: "D-68",
    consequence:
      "Wages are the largest expense after product. The 61000 split is also a 280E " +
      "matter: labour that handles inventory is deductible through COGS, and labour " +
      "that sells is not. That logic is now reachable from the screen. What remains " +
      "is the run link (D-68) and clearing the accrual against the bank.",
  },

  {
    key: "payroll_cycle.net_pay_disbursed",
    family: "payroll_cycle",
    event:
      "Net pay leaves the operating account by ACH, then the debit appears in the " +
      "Plaid feed.",
    sourceKind: "payroll",
    entityCode: "greenway",
    accountCodes: ["31000", "10200"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence: "No builder clears 31000 Accrued Payroll against cash.",
      },
      reachable: { status: "MISSING", evidence: "No payroll path reaches the ledger." },
      correct: { status: "MISSING", evidence: "Nothing to evaluate." },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No ref convention for an ACH batch." },
      married: {
        status: "PARTIAL",
        evidence:
          "payroll-reconcile-core.ts (P6b) matches the run to the withdrawal with a " +
          "tolerance. Match logic present, posting absent.",
      },
    },
    defectId: "D-38",
    consequence:
      "Exactly the workflow Michael described: 'tracked through the system, paid " +
      "via ACH through the system, then the expense will show up in the system via " +
      "Plaid.' Booking both arrivals would double payroll expense.",
  },

  {
    key: "payroll_cycle.payroll_tax_remitted",
    family: "payroll_cycle",
    event:
      "Withheld and employer payroll taxes are paid to the IRS, ESD and L&I.",
    sourceKind: "payroll",
    entityCode: "greenway",
    accountCodes: ["31100", "31200", "10200"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence: "No builder clears 31100 or 31200 against cash.",
      },
      reachable: { status: "MISSING", evidence: "No remittance path posts." },
      correct: {
        status: "MISSING",
        evidence:
          "The 941/940/5208A calculators exist and are proven, but they compute " +
          "form figures rather than journal entries.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No ref convention." },
      married: {
        status: "MISSING",
        evidence: "The remittance also arrives as a Plaid debit; nothing links them.",
      },
    },
    defectId: "D-38",
    consequence:
      "Withheld tax is trust money. If the liability is never relieved, 31100 grows " +
      "forever and the balance sheet shows tax owed that was in fact paid.",
  },

  {
    key: "payroll_cycle.garnishment_remitted",
    family: "payroll_cycle",
    event: "A child-support or garnishment withholding is forwarded to the agency.",
    sourceKind: "payroll",
    entityCode: "greenway",
    accountCodes: ["31300", "10200"],
    builder: null,
    poster: null,
    layers: {
      exists: { status: "MISSING", evidence: "No builder targets 31300." },
      reachable: {
        status: "MISSING",
        evidence:
          "src/app/admin/books/garnishments/actions.ts exists but contains no " +
          "ledger call.",
      },
      correct: {
        status: "MISSING",
        evidence: "31300 is seeded (0173) and never referenced in src/.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No ref convention." },
      married: { status: "MISSING", evidence: "Arrives again as a bank debit." },
    },
    defectId: "D-38",
    consequence:
      "Garnishments carry legal exposure separate from tax. A missing remittance " +
      "record is the hardest kind of gap to defend to a court.",
  },

  /* ── FAMILY 5: CASH, BANKS AND THE ATM ───────────────────────────────── */

  {
    key: "cash_and_banking.till_open_from_vault",
    family: "cash_and_banking",
    event: "A shift starts: the float moves from the vault into a drawer.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["10110", "10100"],
    builder: "src/lib/accounting/register-cash-journal-core.ts#buildTillOpenJournal",
    poster: null,
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-93 built buildTillOpenJournal: 10110 debited, 10100 credited, " +
          "two lines, sums to zero. A transfer, never income.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "STILL MISSING after books-94, deliberately. That slice wired the CLOSE " +
          "only: grep submitJournal under src/lib/registers/ now finds " +
          "drawer-posting-service.ts, but nothing calls buildTillOpenJournal. " +
          "openDrawer in store.ts records the float it counted and NOT where that " +
          "cash came from, so whether the vault was drawn down is unknown - and " +
          "guessing it would credit 10100 for money that may never have moved.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "Michael's stated float of 5 tens, 10 fives, 50 ones and one roll each " +
          "of quarters/dimes/nickels/pennies reconciles to $167.50 exactly, and a " +
          "denomination count that disagrees with the stated float is REFUSED " +
          "rather than averaged.",
      },
      accepted: {
        status: "NOT_APPLICABLE",
        evidence: "Cash moving between two accounts Michael already owns.",
        reason:
          "APPROVAL_EXEMPT_SOURCE_KINDS includes bank. A vault-to-till transfer " +
          "changes no total and creates no obligation, so there is nothing for an " +
          "approver to weigh.",
      },
      idempotent: {
        status: "MISSING",
        evidence: "sourceRef is accepted but no shift-scoped convention is fixed yet.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "The money never leaves the building.",
        reason: "There is no bank record of cash moving from a safe to a drawer.",
      },
    },
    defectId: "D-39",
    consequence:
      "Without it the $1,502.50 of float on hand is invisible to the balance " +
      "sheet, so cash on hand reads low by that amount every single day.",
  },

  {
    key: "cash_and_banking.till_close_to_safe",
    family: "cash_and_banking",
    event: "A shift ends: the drawer is counted and its takings go to the safe.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["10100", "10110", "50920"],
    builder: "src/lib/accounting/register-cash-journal-core.ts#buildTillCloseJournal",
    poster: "src/lib/registers/drawer-posting-service.ts#postDrawerCloseForSession",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-98 fixed D-77: the close debits 10100 Vault - the SAFE - not " +
          "10400. Its own line always said \"to safe\"; the account did not " +
          "agree until now. 10400 is reached only by sealing a numbered bag. " +
          "books-93 built buildTillCloseJournal: the safe debited what physically " +
          "left the drawer, 10110 relieved, the difference to 50920.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-94: reconcileDrawerAction in actions.ts calls " +
          "postDrawerCloseForSession, which submits with autoPost. grep " +
          "submitJournal under src/lib/registers/ now finds it. The post is " +
          "placed AFTER the reconcile succeeded and its outcome is written to " +
          "the audit log and shown on /admin/registers.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "The close does NOT re-book cash sales - sale-journal-core already " +
          "debits 10110 once per sale - so the two cannot double-count. A drawer " +
          "counted below its own float is refused and escalated to a manager " +
          "instead of posted. 43 of 43 mutations caught.",
      },
      accepted: {
        status: "NOT_APPLICABLE",
        evidence: "sourceKind bank is approval-exempt.",
        reason:
          "The drawer count is itself the human act. A second approval would " +
          "delay the deposit without adding a second pair of eyes to the cash.",
      },
      idempotent: {
        status: "PRESENT",
        evidence:
          "sourceRef is till-close:<sessionId>, keyed on the SHIFT and not on " +
          "the register-plus-date, because two shifts on one register in one " +
          "day is normal and a date key would silently merge them. A replay " +
          "returns outcome duplicate and writes nothing twice.",
      },
      married: {
        status: "MISSING",
        evidence:
          "The safe is where the deposit is built from. books-98 added the " +
          "numbered bag that will carry a day's cash to the bank, but the " +
          "bank-side match on bag id is not wired yet.",
      },
    },
    defectId: "D-39",
    consequence:
      "This is the entry that keeps 10110 honest. Every cash sale debits the " +
      "till; if nothing ever credits it, the books claim the drawers hold more " +
      "money every day forever.",
  },

  {
    key: "cash_and_banking.cash_deposit_to_bank",
    family: "cash_and_banking",
    event: "Till cash is counted, moved to the vault, and deposited at the bank.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["10200", "10400", "10100"],
    builder: "src/lib/accounting/deposit-clearing-core.ts#buildDepositClearingJournal",
    poster: "src/lib/accounting/deposit-clearing-service.ts#clearDepositForBankRow",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-93 built the first leg - the drawer count into 10400 Undeposited " +
          "Funds. books-95 built the second: buildDepositClearingJournal debits " +
          "10200 and credits 10400 when the bank confirms the money arrived.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-95: clearDepositForBankRow reads the real 10400 balance and calls " +
          "submitJournal with autoPost. books-96: the end-of-day panel lists the " +
          "open days one by one with what each is worth, so a manager can check " +
          "the list against the bags in the safe instead of reading one total.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "The sign is delegated to plaidToLedgerCashCents, the one sanctioned " +
          "crossing. books-96 fixed D-76, so a banked day retires and the pool " +
          "ages honestly; 36/36 books-95 mutations and 36/36 books-96 mutations " +
          "are caught. 10900 Cash Clearing is still seeded and unused.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "PRESENT",
        evidence:
          "sourceRef deposit-clear:<transactionId>, so a second attempt on the " +
          "same bank row returns duplicate and writes nothing. The builder also " +
          "refuses a row the caller already knows is matched.",
      },
      married: {
        status: "PARTIAL",
        evidence:
          "books-96: the deposit is attributed to the BUSINESS DAYS it banked, " +
          "oldest first, with one credit line per day naming that day - so one " +
          "bank credit ties to named Z-reports. It is still NOT attributed to " +
          "named register SESSIONS: two tills on one day are folded together " +
          "because the feed does not say how the bag was composed. Cash older " +
          "than 30 days now POSTS with a warning rather than being refused, by " +
          "the owner's decision.",
      },
    },
    defectId: "D-39",
    consequence:
      "In a cash business this is the reconciliation regulators look at first. " +
      "Without it there is no audit trail from till to bank.",
  },

  {
    key: "cash_and_banking.seal_deposit_bag",
    family: "cash_and_banking",
    event: "Safe cash is counted into a numbered deposit bag and sealed.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["10400", "10100"],
    builder: "src/lib/accounting/register-cash-journal-core.ts#buildSealBagJournal",
    poster: null,
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-98 built buildSealBagJournal: 10400 Undeposited Funds debited, " +
          "10100 Vault credited, with the bag number written onto both lines " +
          "and the memo. safe-bag-core enforces the lifecycle around it.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "No screen seals a bag yet. The builder and the deposit_bags table " +
          "in 0212_deposit_bags.sql exist; grep buildSealBagJournal under " +
          "src/app finds nothing. Rule 50: a finished feature nobody can reach.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "20/20 books-98 mutations caught, including both DOOR probes that " +
          "strip the bag number from the memo and from the lines. A bag with " +
          "no id, a zero bag and a fractional bag are all refused.",
      },
      accepted: {
        status: "NOT_APPLICABLE",
        evidence: "sourceKind bank is approval-exempt.",
        reason:
          "Counting the bag IS the human act, and it is witnessed. A second " +
          "approval would delay the bank run without adding a second pair of " +
          "eyes to the cash.",
      },
      idempotent: {
        status: "MISSING",
        evidence:
          "The source ref will be seal-bag:<bagId>, but there is no poster yet " +
          "to key it on.",
      },
      married: {
        status: "MISSING",
        evidence:
          "This is the entry that will END the guesswork: the bag number is " +
          "also on the bank's deposit slip, so a Plaid credit can be matched " +
          "to counted cash by evidence rather than by date. Not wired yet.",
      },
    },
    defectId: "D-77",
    consequence:
      "Without the bag layer a deposit is matched to the cash it came from by " +
      "FIFO on date alone. That is a convention, not a fact: two bags sealed " +
      "on one day, or a bag held over a weekend, cannot be told apart.",
  },

  {
    key: "cash_and_banking.employee_supply_advance",
    family: "cash_and_banking",
    event:
      "An employee takes cash from the master till for supplies and later " +
      "returns a receipt and the change.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["12100", "10100"],
    builder:
      "src/lib/accounting/register-cash-journal-core.ts#buildSupplyAdvanceJournal",
    poster: null,
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-98 built both halves. buildSupplyAdvanceJournal debits 12100 " +
          "Employee Advances Receivable and credits 10100 - NOT an expense, " +
          "because nothing has been bought yet. buildSupplySettleJournal books " +
          "the expense at the receipt amount, returns the change to the safe, " +
          "and clears 12100 to zero.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "No screen records a supply run yet: grep buildSupplyAdvanceJournal " +
          "under src/app finds nothing. Rule 50: finished, unreachable.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "An advance with no employee name is refused - the balance is a " +
          "claim on a person, so an unnamed one is meaningless. A receipt " +
          "larger than the advance is refused rather than sign-flipped, " +
          "because that is a reimbursement owed TO the employee.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "MISSING",
        evidence: "No poster yet, so no source ref to key on.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "The cash never touches the bank.",
        reason:
          "Money moves from the safe to a person and back. There is no bank " +
          "record of either leg.",
      },
    },
    defectId: "D-77",
    consequence:
      "Expensing the cash as it leaves the till records a purchase that has " +
      "not happened, against an account nobody chose, for an amount that " +
      "changes when the change comes back - and nothing ever asks for the " +
      "receipt, because no account is left carrying the employee's name.",
  },

  {
    key: "cash_and_banking.till_over_short",
    family: "cash_and_banking",
    event: "A till count does not match what the system says it should be.",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["50920", "10110"],
    builder: "src/lib/accounting/register-cash-journal-core.ts#buildTillCloseJournal",
    poster: "src/lib/registers/drawer-posting-service.ts#postDrawerCloseForSession",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-93: the close builder emits a 50920 line whenever the count " +
          "differs from expectation, and omits it entirely when it does not.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-94: the over/short line rides on the same posted close entry. " +
          "postDrawerCloseForSession fires at RECONCILE, not at blind close, " +
          "because over/short is genuinely unknown until a manager supplies the " +
          "expected figure - see reconcileDrawerAction in actions.ts.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "50920 is seeded as an INCOME account, so an over is a credit and a " +
          "short is a debit; both the amount and the wording are asserted, because " +
          "a correct number under a backwards word is worse than a wrong one.",
      },
      accepted: {
        status: "NOT_APPLICABLE",
        evidence: "sourceKind bank is approval-exempt; it rides the close entry.",
        reason:
          "The manager's reconcile IS the acceptance. Asking the same person to " +
          "approve the entry their own count produced adds a click, not a check.",
      },
      idempotent: {
        status: "PRESENT",
        evidence:
          "Same till-close:<sessionId> ref as the close entry it rides on, so " +
          "the shortage cannot be booked twice by a double-submitted form.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "A shortage never reaches a bank.",
        reason: "There is no second arrival for money that went missing.",
      },
    },
    defectId: "D-39",
    consequence:
      "Over/short is the earliest signal of both honest error and theft. " +
      "Unbooked, the difference silently distorts revenue instead.",
  },

  {
    key: "cash_and_banking.atm_vault_load",
    family: "cash_and_banking",
    event: "Cash is loaded into the ATM from the vault account.",
    sourceKind: "atm",
    entityCode: "atm",
    accountCodes: ["10300", "10100"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence:
          "books-69 built src/lib/atm/atm-classification-core.ts, which CLASSIFIES " +
          "debits. It does not build journals.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "store.ts#listAtmClassificationProposals returns proposals for review " +
          "and posts nothing. books-89 closed the SETTLEMENT half of D-40 and " +
          "deliberately did NOT close this one: settlements had a finished " +
          "builder waiting for a door, whereas a vault load has no builder at " +
          "all — atm-classification-core.ts decides what a debit IS and does not " +
          "construct a journal. Wiring a door to nothing would be theatre. " +
          "Stated out loud per standing rule 133(f) rather than left to look " +
          "like an oversight.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "The classifier is effective-dated, proven by 80 tests, and 18/18 mutants " +
          "were killed. Classification is proven; the journal is not built.",
      },
      accepted: {
        status: "MISSING",
        evidence:
          "10300 is a control account; migration 0172 REFUSES a 'manual' journal " +
          "touching it, so this must post as sourceKind 'atm'.",
      },
      idempotent: {
        status: "MISSING",
        evidence: "The Plaid transaction id is available but unused as a ref.",
      },
      married: {
        status: "PARTIAL",
        evidence:
          "The classifier reads the Plaid feed directly, so there is one arrival " +
          "rather than two. Vault-load pairing across two accounts is not modelled.",
      },
    },
    defectId: "D-40",
    consequence:
      "The ATM is a separate entity with its own tax position. Michael's own " +
      "$5,242.50 personal transfer is the case that proves classification matters: " +
      "misclassified, it becomes a deduction that is not real.",
  },

  {
    key: "cash_and_banking.atm_surcharge_income",
    family: "cash_and_banking",
    event: "A customer pays the ATM fee, which is income to the ATM entity.",
    sourceKind: "atm",
    entityCode: "atm",
    accountCodes: ["51000", "10300"],
    builder: "src/lib/atm/atm-posting-core.ts#buildAtmSettlementProposal",
    poster: "src/lib/atm/atm-settlement-service.ts#postAtmSettlements",
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "books-69 built buildAtmSettlementProposal, which debits 10300 for the " +
          "money that arrived and credits 51000 for the fee portion. The previous " +
          "verdict here said 'No builder targets 51000', which was wrong from the " +
          "moment books-69 shipped: the builder existed and the census had not " +
          "been re-read. Corrected in books-89 by measuring the file rather than " +
          "trusting the row.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "books-89 built the door (D-40). The chain, stated link by link per " +
          "standing rule 133: /admin/atm?tab=transactions -> " +
          "components/admin/atm/PostAtmSettlementsPanel.tsx -> " +
          "app/admin/atm/actions.ts#postAtmSettlementsAction (gated on " +
          "requireBooksAccess, not the page's finances.view, because this writes " +
          "to the ledger) -> atm-settlement-service.ts#postAtmSettlements -> " +
          "buildAtmSettlementProposals -> posting-service.ts#submitJournal. " +
          "Asserted by the reachability trap in " +
          "tests/compliance/posting-services-are-reachable.test.ts, which walks " +
          "src/ for a real caller and excludes this census file, because a " +
          "poster: string is a claim and not a call.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "The fee is credited to 51000 in the ATM entity, so it is NOT cannabis " +
          "revenue and not subject to 280E, and it is the .015 service-rate B&O " +
          "base. The dispensed-cash leg debits and credits 10300 for the same " +
          "figure deliberately: netting them would still balance and would " +
          "destroy the only record of how much cash the machine handed out, which " +
          "is the failure mode that announces itself to nobody. A test asserts " +
          "the service passes the core's lines through unchanged in sign, count " +
          "and description. Note ledger-core.ts:770 uses code 70100 named 'ATM " +
          "Fee Income' in a self-test FIXTURE; the seeded account is 51000 and " +
          "the fixture is not a production mapping.",
      },
      accepted: {
        status: "PARTIAL",
        evidence:
          "Entries are created as DRAFTS and appear on /admin/books/drafts. " +
          "autoPost is never requested, because every proposal carries " +
          "postable: false — 'ATM cash movements are reconciled against a " +
          "physical count, by a person.' PARTIAL and not PRESENT because no ATM " +
          "settlement has yet made the round trip against a live database.",
      },
      idempotent: {
        status: "PRESENT",
        evidence:
          "sourceRef is atm-settle:<TERMINAL>:<date>, built from the pair " +
          "migration 0156 already declares unique for atm_settlements, and the " +
          "terminal is upper-cased and trimmed so one machine on one day cannot " +
          "produce two keys. PAI reports overlap by design, so this button WILL " +
          "be pressed twice; a test proves the second press returns duplicate " +
          "rather than doubling a separate entity's revenue.",
      },
      married: {
        status: "PARTIAL",
        evidence:
          "The entry is built from the PAI settlement report. The same money " +
          "also arrives in the Timberland feed as a deposit, and nothing links " +
          "the two yet — that is bank matching, which exists (migration 0189) " +
          "but has no caller for this source. Recorded rather than claimed.",
      },
    },
    defectId: "D-40",
    consequence:
      "This is real taxable income in a non-cannabis entity, so it is NOT subject " +
      "to 280E and is the ATM entity's B&O base at the .015 service rate.",
  },

  {
    key: "cash_and_banking.intercompany_transfer",
    family: "cash_and_banking",
    event:
      "Money moves between Michael's entities — for example the vendor payment made " +
      "out of account 6228.",
    sourceKind: "intercompany",
    entityCode: "greenway",
    accountCodes: ["36000", "10200"],
    builder: "src/lib/accounting/posting-service.ts#submitIntercompanyPair",
    poster: null,
    layers: {
      exists: {
        status: "PRESENT",
        evidence:
          "submitIntercompanyPair exists and gl_submit_intercompany_pair exists in SQL.",
      },
      reachable: {
        status: "MISSING",
        evidence: "grep -rn 'submitIntercompanyPair' src/app -> 0 callers.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "36000 Due To / From Related Entity is seeded and the paired door " +
          "enforces both sides. books-76 CLOSES the question this row was waiting " +
          "on. It asked whether the money is expected to be repaid, and Michael " +
          "answered: 'I want to classify the cash in the atm as a loan.' So the " +
          "account is decided -- 36000, not 41100 -- and the target is no longer " +
          "UNKNOWN. It is PARTIAL rather than PRESENT because deciding the label " +
          "is not the same as earning it: 26 C.F.R. 1.482-2(a)(1)(ii)(B) says the " +
          "regime 'does not apply to so much of an alleged indebtedness which is " +
          "not in fact a bona fide indebtedness, even if the stated rate of " +
          "interest thereon would be within the safe haven rates', and names the " +
          "two substitutes as a contribution to capital or a distribution -- " +
          "exactly the 41100/41000 pair this row was choosing between. " +
          "related-party-loan-core.ts#assessBonaFide sorts the facts and returns " +
          "UNDETERMINED on Michael's stated terms, because two facts (is the " +
          "balance tracked, was demand ever made) have never been put to him. " +
          "Two facts DO favour him and were measured, not assumed: cash goes back, " +
          "and the balance cycles both ways, which is the books-74 measuring-" +
          "instrument test passing. Michael also offered to write a contract; " +
          "CONTRACT_REQUIREMENTS states what it must contain, and the " +
          "highest-value item is stating the rate as a FORMULA (the applicable " +
          "Federal short-term rate) so it stays inside the 100-130% safe haven " +
          "automatically. See D-59, D-60, D-55 and docs/ENTITY-STRUCTURE-AND-280E.md.",
      },
      accepted: { status: "MISSING", evidence: "No app path presents a pair." },
      idempotent: {
        status: "UNKNOWN",
        evidence: "The paired door is designed to be atomic.",
        reason: "Never exercised from the app, so the ref behaviour is unobserved.",
      },
      married: {
        status: "MISSING",
        evidence: "Both sides appear in two Plaid feeds; nothing links them.",
      },
    },
    defectId: "D-41",
    consequence:
      "Intercompany errors move taxable income between entities with different " +
      "rates and different 280E exposure. This is also the one row that needs a " +
      "decision from Michael before it can be wired.",
  },

  /* ── FAMILY 6: PERIOD-END, TAX ACCRUALS, ASSETS AND EVERYTHING ELSE ──── */

  {
    key: "periodic_and_other.manual_journal",
    family: "periodic_and_other",
    event: "Michael or the bookkeeper types a journal entry by hand.",
    sourceKind: "manual",
    entityCode: "greenway",
    accountCodes: ["10200", "76040"],
    builder: "src/lib/accounting/journal-entry-service.ts#submitManualJournal",
    poster: "src/app/admin/books/journal/actions.ts#submitJournalAction",
    layers: {
      exists: {
        status: "PRESENT",
        evidence: "journal-entry-service.ts#submitManualJournal builds and submits.",
      },
      reachable: {
        status: "PRESENT",
        evidence:
          "src/app/admin/books/journal/actions.ts:68 calls it from the journal screen.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "Runs the advisor (evaluateJournalDraft) and refuses on ADV_BLOCKED before " +
          "submitting.",
      },
      accepted: {
        status: "PRESENT",
        evidence:
          "Posts through submitJournal with autoPost false, so a human posts it.",
      },
      idempotent: {
        status: "NOT_APPLICABLE",
        evidence:
          "sourceRef is null; migration 0174 section 1 explicitly allows this for " +
          "'manual'.",
        reason:
          "A hand-keyed entry has no external event to key on. Two identical entries " +
          "may be two genuine entries, so the ledger must not silently merge them.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "A manual entry has no system-side counterpart.",
        reason: "Nothing automatic produced it, so nothing can duplicate it.",
      },
    },
    defectId: null,
    consequence:
      "The second of two working paths, and the safety valve: anything not yet " +
      "wired can be entered by hand without corrupting the ledger.",
  },

  {
    key: "periodic_and_other.bo_tax_accrual",
    family: "periodic_and_other",
    event:
      "Washington B&O tax is accrued on the period's gross receipts — .00471 " +
      "retailing for Greenway, .015 for the ATM service entity.",
    sourceKind: "accrual",
    entityCode: "greenway",
    accountCodes: ["75040", "32200"],
    builder: "src/lib/accounting/bo-tax-core.ts#boAccrualEntry",
    poster: null,
    layers: {
      exists: {
        status: "PRESENT",
        evidence: "bo-tax-core.ts exports boAccrualEntry and boPaymentEntry.",
      },
      reachable: {
        status: "MISSING",
        evidence: "grep -rn 'boAccrualEntry\\|boPaymentEntry' src/ -> 0 callers.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "Rates are held in MILLIONTHS to avoid the rounding drift a percentage " +
          "would introduce; proven in its own self-tests.",
      },
      accepted: {
        status: "MISSING",
        evidence:
          "'accrual' is deliberately NOT in AUTOPOSTABLE_SOURCE_KINDS, so this must " +
          "always be drafted for review. Never presented.",
      },
      idempotent: {
        status: "MISSING",
        evidence:
          "The natural ref is the tax period, which would make a re-run safe. No " +
          "code sets it.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "An accrual moves no money.",
        reason: "The PAYMENT is the bank event, and boPaymentEntry is its builder.",
      },
    },
    defectId: "D-42",
    consequence:
      "B&O is owed on gross receipts whether or not there is profit. The " +
      "calculation is already correct and simply unreachable — a cheap win.",
  },

  {
    key: "periodic_and_other.excise_tax_remitted",
    family: "periodic_and_other",
    event: "The 37% excise held in trust is paid to the LCB.",
    sourceKind: "excise",
    entityCode: "greenway",
    accountCodes: ["32000", "10200"],
    builder: null,
    poster: null,
    layers: {
      exists: { status: "MISSING", evidence: "No builder clears 32000 against cash." },
      reachable: { status: "MISSING", evidence: "No excise path posts." },
      correct: {
        status: "MISSING",
        evidence:
          "12300 Excise Tax Receivable / Overpayment is seeded for the case where " +
          "more was remitted than collected, and is unused.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No ref convention." },
      married: { status: "MISSING", evidence: "The remittance appears in Plaid too." },
    },
    defectId: "D-32",
    consequence:
      "If the liability is never relieved, 32000 grows without limit and the books " +
      "show trust tax outstanding that was in fact paid.",
  },

  {
    key: "periodic_and_other.fixed_asset_acquired",
    family: "periodic_and_other",
    event: "Equipment, a vehicle or a leasehold improvement is bought and capitalised.",
    sourceKind: "purchase",
    entityCode: "greenway",
    accountCodes: ["21600", "30000", "10200"],
    builder: "src/lib/accounting/fixed-assets-core.ts#accountCodeForClass",
    poster: null,
    layers: {
      exists: {
        status: "PARTIAL",
        evidence:
          "fixed-assets-core.ts maps asset classes to codes 21000-21900 and computes " +
          "MACRS schedules. It resolves the ACCOUNT for an asset class; no function " +
          "in it assembles a journal.",
      },
      reachable: {
        status: "MISSING",
        evidence: "grep -rn 'fixed-assets-core' src/ -> 0 importers.",
      },
      correct: {
        status: "PRESENT",
        evidence:
          "MEASURED: all ten target accounts 21000-21900 ARE seeded, by migration " +
          "0178_fixed_assets.sql via gl_upsert_account. 0178 also installs " +
          "gl_guard_no_land_depreciation and gl_check_accumulated_depreciation, so " +
          "the codes and the guards agree with the module.",
      },
      accepted: {
        status: "MISSING",
        evidence:
          "The accounts exist, so a line naming 21600 would not be refused. No app " +
          "path has ever presented one.",
      },
      idempotent: { status: "MISSING", evidence: "No ref convention." },
      married: {
        status: "MISSING",
        evidence: "Asset purchases are paid by ACH or card and arrive again in Plaid.",
      },
    },
    defectId: "D-43",
    consequence:
      "Capitalising an asset instead of expensing it is a GAAP requirement and, " +
      "under 280E, usually the difference between a cost that is eventually " +
      "recovered and one that is lost. The chart and the MACRS maths are both " +
      "ready; only the wire is missing.",
  },

  {
    key: "periodic_and_other.depreciation_booked",
    family: "periodic_and_other",
    event: "Monthly or annual depreciation is recorded against the asset.",
    sourceKind: "depreciation",
    entityCode: "greenway",
    accountCodes: ["78010", "21900"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence:
          "grep -rn 'sourceKind: \"depreciation\"' src/ -> 0 hits. fixed-assets-core " +
          "computes MACRS schedules but no function assembles a journal from them.",
      },
      reachable: { status: "MISSING", evidence: "0 importers of fixed-assets-core." },
      correct: {
        status: "PRESENT",
        evidence:
          "Both sides exist: 78010 Depreciation Expense (0173) and 21900 Accumulated " +
          "Depreciation (0178). 0178 also installs gl_guard_no_land_depreciation, so " +
          "the database itself refuses to depreciate land.",
      },
      accepted: {
        status: "MISSING",
        evidence:
          "'depreciation' is never autopostable: posting-core.ts:128 states " +
          "'Depreciation is a schedule and a judgment, not an observed event.'",
      },
      idempotent: {
        status: "MISSING",
        evidence: "Period-keyed ref would make re-runs safe; no code sets one.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "Depreciation moves no money.",
        reason: "There is no bank line for a non-cash allocation.",
      },
    },
    defectId: "D-43",
    consequence:
      "The accounts, the guards and the MACRS schedule maths are all in place. What " +
      "is missing is the monthly entry that uses them, so no asset has ever been " +
      "depreciated in the books.",
  },

  {
    key: "periodic_and_other.loan_activity",
    family: "periodic_and_other",
    event: "A loan is drawn or repaid, splitting principal from interest.",
    sourceKind: "loan",
    entityCode: "greenway",
    accountCodes: ["34000", "36000", "85010", "10200"],
    builder:
      "src/lib/accounting/related-party-loan-core.ts#loanControlAccountFor",
    poster: null,
    layers: {
      exists: {
        status: "PARTIAL",
        evidence:
          "grep -rn 'sourceKind: \"loan\"' src/ -> still 0 hits, so no loan POSTS. " +
          "books-76 adds the half that had to come first: loanControlAccountFor " +
          "decides WHICH control account holds a related-party balance, and " +
          "imputedInterestRequirement decides what interest the law requires. " +
          "A poster that did not know the answer to either would have been " +
          "guessing at both.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "grep -rn 'loanControlAccountFor' src/app -> 0 callers. " +
          "grep -rn 'sourceKind: \"loan\"' src/ -> 1 hit, and it is this census " +
          "row describing itself, not a poster.",
      },
      correct: {
        status: "PARTIAL",
        evidence:
          "34000, 36000 and 85010 are all seeded. src/lib/plaid/liabilities-core.ts " +
          "reads liability data and posts nothing. books-76 settles the routing on " +
          "measured grounds: 34000's chart comment in migration 0173 is 'CONTROL, " +
          "driven by the loan subledger and its amortization schedule', and " +
          "Michael's ATM loan has no term, hence no schedule, hence no subledger " +
          "to drive it -- so it routes to 36000 and 34000 is reserved for loans " +
          "that have both a maturity date and a repayment schedule. The interest " +
          "leg is why this is PARTIAL and not PRESENT: D-59 measured that " +
          "loan-core.ts returns ZERO schedule rows and ZERO interest for a " +
          "zero-term loan, and FEDERAL_SHORT_TERM_RATES is empty on purpose, so " +
          "85010 cannot yet be given a number. imputedInterestRequirement refuses " +
          "with a named code instead of inventing one.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: { status: "MISSING", evidence: "No ref convention." },
      married: {
        status: "MISSING",
        evidence: "Loan payments arrive in Plaid as a single debit covering both parts.",
      },
    },
    defectId: "D-44",
    consequence:
      "Only the interest portion is deductible, and under 280E even that depends on " +
      "the entity. Booking the whole payment to either account misstates both the " +
      "liability and the deduction. For a RELATED-PARTY loan the exposure is worse " +
      "and runs the other way: 26 C.F.R. 1.482-2(a)(2)(iii)(B)(2) imputes interest " +
      "at 100% of the AFR even when none is charged, so interest income appears in " +
      "the ATM entity (taxable, B&O at the .015000 service rate) while the matching " +
      "expense lands in Greenway where 280E disallows it. The imputation is not a " +
      "wash. See D-59 and D-60.",
  },

  {
    key: "periodic_and_other.crypto_activity",
    family: "periodic_and_other",
    event: "A crypto position changes value or is disposed of.",
    sourceKind: "crypto",
    entityCode: "personal",
    accountCodes: ["80030", "80040"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence:
          "35 files under src/lib/crypto/; grep -rn 'sourceKind: \"crypto\"' -> 0 hits.",
      },
      reachable: { status: "MISSING", evidence: "No crypto path reaches the ledger." },
      correct: {
        status: "MISSING",
        evidence:
          "80030 Realized and 80040 Unrealized Investment Gain/(Loss) are seeded " +
          "and unused.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "MISSING",
        evidence: "An on-chain transaction hash is a perfect natural ref and is unused.",
      },
      married: {
        status: "UNKNOWN",
        evidence: "Whether fiat on/off-ramps appear in a connected Plaid account.",
        reason:
          "Depends on which exchange accounts Michael has linked. Not measurable " +
          "from the source tree.",
      },
    },
    defectId: "D-45",
    consequence:
      "Personal-entity activity that affects the 1040 rather than the business " +
      "return. Lowest priority of anything in this census, and recorded so it is " +
      "not mistaken for an oversight.",
  },

  {
    key: "periodic_and_other.period_close",
    family: "periodic_and_other",
    event: "A month or year is closed and locked so figures can no longer move.",
    sourceKind: "close",
    entityCode: "greenway",
    accountCodes: ["40300", "40400"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence:
          "grep -rn 'period-close-core' src/ -> 0 importers; " +
          "grep -rn 'sourceKind: \"close\"' -> 0 hits.",
      },
      reachable: { status: "MISSING", evidence: "period-close-core has no importers." },
      correct: {
        status: "MISSING",
        evidence: "40300 Retained Earnings and 40400 Opening Balance Equity are unused.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "MISSING",
        evidence: "Closing the same period twice must be a no-op; untested.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "A close moves no money.",
        reason: "It is a reclass within equity.",
      },
    },
    defectId: "D-46",
    consequence:
      "Without a close, a prior period can silently change after the CPA has filed " +
      "from it. That is the difference between books and a spreadsheet.",
  },

  {
    key: "periodic_and_other.reversal",
    family: "periodic_and_other",
    event: "A posted entry is found to be wrong and must be reversed, not deleted.",
    sourceKind: "reversal",
    entityCode: "greenway",
    accountCodes: ["10200", "76040"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "MISSING",
        evidence: "grep -rn 'sourceKind: \"reversal\"' src/ -> 0 hits.",
      },
      reachable: { status: "MISSING", evidence: "No reversal path exists in the app." },
      correct: {
        status: "MISSING",
        evidence:
          "A reversal must mirror the original exactly with opposite signs and " +
          "preserve the original's cost class.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "MISSING",
        evidence:
          "Highest-consequence idempotency case in the census: reversing twice " +
          "re-creates the error it was cancelling, and the books still balance.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "A reversal is an internal correction.",
        reason: "No bank line corresponds to a correction of a prior entry.",
      },
    },
    defectId: "D-46",
    consequence:
      "Once real posting begins, the first mistake will need reversing. There is " +
      "currently no way to correct a posted entry except by hand-keying the " +
      "opposite, with no link between the two.",
  },

  {
    key: "periodic_and_other.opening_balance",
    family: "periodic_and_other",
    event: "Historical balances are loaded when the books are first stood up.",
    sourceKind: "opening_balance",
    entityCode: "greenway",
    accountCodes: ["40400", "10200"],
    builder: null,
    poster: null,
    layers: {
      exists: {
        status: "PARTIAL",
        evidence:
          "Migration 0176_opening_balances.sql supplies a staging table with " +
          "gl_ob_validate_row, gl_bless_opening_balances and " +
          "gl_close_opening_balance_equity. gl_opening_balance_summary IS called " +
          "from the app, so the staging side is reachable read-only; " +
          "grep -rn 'sourceKind: \"opening_balance\"' -> 0 hits.",
      },
      reachable: {
        status: "MISSING",
        evidence:
          "gl_bless_opening_balances and gl_close_opening_balance_equity have no " +
          "supabase.rpc() caller, so nothing turns staged balances into journals.",
      },
      correct: {
        status: "UNKNOWN",
        evidence: "40400 Opening Balance Equity is seeded for exactly this purpose.",
        reason:
          "Michael has not yet supplied the Sage COA-tagged spreadsheets, so the " +
          "opening figures themselves are not yet known. Standing rule 1: the census " +
          "will not invent them.",
      },
      accepted: { status: "MISSING", evidence: "Never presented." },
      idempotent: {
        status: "MISSING",
        evidence: "Loading opening balances twice would double the balance sheet.",
      },
      married: {
        status: "NOT_APPLICABLE",
        evidence: "Opening balances predate the bank feed.",
        reason: "There is no Plaid history for a balance carried in from Sage.",
      },
    },
    defectId: "D-47",
    consequence:
      "Everything else in the census assumes a starting point. Until opening " +
      "balances are loaded, even perfectly wired activity produces a balance sheet " +
      "that starts from zero.",
  },

] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * CONSTRUCTION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the validated census.
 *
 * The chart of accounts is a PARAMETER rather than an import, so the test can
 * pass the codes it scraped out of migration 0173 itself. That is the point:
 * the census is checked against the chart the database actually has, not
 * against a second copy of the chart kept in TypeScript that could drift from
 * it. If an account is removed from the migration, this throws.
 */
export function buildLedgerCensus(knownAccountCodes: readonly string[]): LedgerCensus {
  return LedgerCensus.create(LEDGER_CENSUS_ROWS, knownAccountCodes);
}
