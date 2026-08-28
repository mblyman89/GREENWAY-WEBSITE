/**
 * src/lib/accounting/factory-reset-core.ts
 *
 * THE FACTORY RESET — the decision of what dies and what lives when the owner
 * wipes his rehearsal and opens for real business.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The owner asked, in his own words:
 *
 *   "Can I test everything and every feature and then completely wipe away all
 *    testing to give me a clean slate to start business on November 1st? I
 *    don't want to have a bunch of stuff stuck on the books from all of my
 *    testing. Is there a factory reset option we can use before we go live so
 *    I can have a clean completely empty database to work with?"
 *
 * A reset already existed when he asked: `reset_operational_data()`, migration
 * 0069, guarded in 0097, extended in 0140. So the tempting answer was "yes,
 * it's already built." That answer was WRONG, and the way it was proved wrong
 * matters more than the fix:
 *
 *   • Migrations on disk run 0001..0208. The reset was last extended at 0140.
 *     It was SIXTY-EIGHT migrations stale.
 *   • The migrations create 250 real tables. The reset deleted from 66.
 *   • Among the 184 it never touched was the ENTIRE GENERAL LEDGER —
 *     gl_journals, gl_journal_lines, gl_periods, gl_audit_events,
 *     gl_opening_balances, gl_bank_matches, gl_bank_reconciliations — because
 *     the ledger was born at migration 0172, THIRTY-TWO migrations after the
 *     reset was last taught anything.
 *
 * So on the morning he asked, pressing "Reset operational data" would have
 * deleted his test sales and left every test JOURNAL ENTRY on the books. The
 * trial balance would still have shown rehearsal numbers on November 1st.
 * That is precisely the "stuff stuck on the books" he said he did not want.
 * Recorded as D-62.
 *
 * ── THE REAL LESSON: A HAND-TYPED LIST ROTS ─────────────────────────────────
 * 0140's own header says it exists because "0069 was written before many newer
 * operational tables existed." It fixed the symptom by typing more table names.
 * Then 68 more migrations landed and it rotted again — the same way, for the
 * same reason. Typing a longer list is not a fix; it is the bug on a delay.
 *
 * This module is therefore NOT another list of tables to delete. It is a
 * TOTAL FUNCTION over the schema: every table that exists must be explicitly
 * classified, and a table nobody has classified makes the reset REFUSE.
 * Standing rule 48 — a check that cannot classify must FAIL, not skip. The
 * companion test reads the real migrations off disk and asserts the
 * classification is total. The day someone adds migration 0209 with a new
 * table and does not decide its fate, that test goes red. The staleness that
 * caused D-62 becomes a build failure instead of a silent wrong number.
 *
 * ── WHAT "COMPLETELY EMPTY" HONESTLY MEANS ──────────────────────────────────
 * He asked for "a clean completely empty database." Taken literally that would
 * include the chart of accounts, the tax rates, the four entities, the
 * shareholder register and the cannabis knowledge base — and then the app would
 * not function and he would have to rebuild all of it by hand before he could
 * ring a single sale. That is not what he wants; it is what he would get from
 * a literal reading. So this module draws the line where a bookkeeper would:
 *
 *   WIPE  — everything that RECORDS AN EVENT: sales, journals, inventory,
 *           punches, payroll runs, bank rows, ATM rows, manifests, audits.
 *           After the wipe the trial balance is empty and every report reads
 *           zero. THIS is the "clean slate."
 *   KEEP  — everything that DESCRIBES THE BUSINESS rather than recording an
 *           event: the chart of accounts, entities, shareholders, tax rates,
 *           settings, licences, the knowledge base, his curated catalogue,
 *           vendors, brands, employees, registers, and his own login. Wiping
 *           these would not give him a clean slate; it would give him a broken
 *           app and days of retyping.
 *
 * Both lists are stated to him in plain English so he can overrule either one.
 * He has executive authority (rule 28); what he does not have, until someone
 * writes it down, is a way to SEE what the button will do.
 *
 * ── THE ENV VAR CONSTRAINT ──────────────────────────────────────────────────
 *   "vercel hides keys by default, and I have like 56 keys, and I don't want to
 *    go track them all down right now."
 *
 * That rules out the obvious alternative — a brand new Supabase project — since
 * a new project means new URL, new anon key, new service-role key, and hunting
 * through 56 hidden Vercel variables to find which ones to change. Everything
 * here runs INSIDE THE EXISTING PROJECT against the existing keys. No new env
 * var is introduced by this slice. That is a design constraint set by the
 * owner's circumstances, not a technical preference.
 *
 * ── WHY THE LEDGER NEEDS A DELIBERATE DOOR ──────────────────────────────────
 * Posted journals cannot simply be deleted. Measured, not assumed:
 *   0172_gl_foundation.sql:529  GL_IMMUTABLE — a posted journal cannot be deleted
 *   0172_gl_foundation.sql:569  GL_IMMUTABLE — its lines cannot be removed
 *   0172_gl_foundation.sql:585  GL_IMMUTABLE — gl_audit_events is append-only
 * Those guards are correct and stay. A factory reset is not an exception to
 * immutability during trading; it is the act of declaring that the trading
 * never happened because it was a rehearsal. So it gets its own owner-only,
 * audited, explicitly-acknowledged door (migration 0209) rather than a
 * weakening of the guards. Immutability protects real books; the reset exists
 * only to discard fake ones.
 *
 * Pure module: no imports, no I/O, no clock, no randomness.
 */

// ───────────────────────────────────────────────────────────────────────────────
// §1  WHAT A CLASSIFICATION IS
// ───────────────────────────────────────────────────────────────────────────────

/**
 * WIPE — the table records events that happened during the rehearsal. Emptying
 *        it is the point of the reset.
 * KEEP — the table describes the business or its configuration. Emptying it
 *        would break the app or destroy owner-authored work, and would not make
 *        the books any cleaner.
 */
export type ResetDisposition = "WIPE" | "KEEP";

export type TableRule = {
  /** Table name in the `public` schema, exactly as the migration created it. */
  readonly table: string;
  readonly disposition: ResetDisposition;
  /**
   * WHY, in one sentence, in language the owner can check. Not decoration:
   * the reset screen shows these, and a rule whose reason does not mention
   * what the table holds is a rule nobody can audit.
   */
  readonly because: string;
};

export const RESET_REFUSAL_CODES = [
  /** A table exists in the schema that no rule classifies (rule 48). */
  "UNCLASSIFIED_TABLE",
  /** A rule names a table that does not exist — the rule set has rotted. */
  "RULE_FOR_MISSING_TABLE",
  /** Two rules claim the same table. */
  "DUPLICATE_RULE",
  /** The owner did not acknowledge the record-retention rule. */
  "RETENTION_NOT_ACKNOWLEDGED",
  /** Real trade exists; this is not a rehearsal any more. */
  "REAL_TRADE_PRESENT",
  /** Nothing would be deleted. */
  "NOTHING_TO_WIPE",
] as const;

export type ResetRefusalCode = (typeof RESET_REFUSAL_CODES)[number];

// ───────────────────────────────────────────────────────────────────────────────
// §2  PREFIX FAMILIES
//
// Some subsystems arrive as a block of a dozen tables (crypto, plaid, discovery,
// gl). Naming each one individually is how 0140 rotted: the next table in the
// family gets forgotten. A family rule covers the whole prefix, so a new
// gl_* table is classified the moment it is created. Specific rules still win
// over family rules, because within a family the answers differ — gl_journals
// is a record of events, gl_accounts is the chart itself.
// ───────────────────────────────────────────────────────────────────────────────

export type FamilyRule = {
  readonly prefix: string;
  readonly disposition: ResetDisposition;
  readonly because: string;
};

export const FAMILY_RULES: readonly FamilyRule[] = [
  {
    prefix: "gl_",
    disposition: "WIPE",
    because:
      "General ledger activity: journals, lines, periods, reconciliations and the audit trail of postings. This is the 'stuff stuck on the books' the reset exists to remove.",
  },
  {
    prefix: "atm_",
    disposition: "WIPE",
    because:
      "ATM settlements, cash loads, terminal status and surcharge transactions pulled while testing the ATM feed.",
  },
  {
    prefix: "plaid_",
    disposition: "WIPE",
    because:
      "Bank and card rows, holdings, mortgages and webhook events pulled from Plaid during testing.",
  },
  {
    prefix: "crypto_",
    disposition: "WIPE",
    because:
      "Wallet balances, transactions, price snapshots and classification results fetched while testing the crypto side.",
  },
  {
    prefix: "discovery_",
    disposition: "WIPE",
    because:
      "Market-research scrapes and competitor rollups; they are re-fetched from public sources on demand and are not your records.",
  },
  {
    prefix: "kb_",
    disposition: "KEEP",
    because:
      "The cannabis knowledge base — strains, terpenes, effects, formats, store voice. Hand-validated reference material that took real work and describes product, not events.",
  },
  {
    prefix: "regulatory_",
    disposition: "KEEP",
    because:
      "The regulatory watch list and its analyses — rule citations and roadmap items, which are reference material, not test activity.",
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// §3  THE RULES, TABLE BY TABLE
//
// Ordered the way a bookkeeper would read them, not alphabetically, so the
// reasoning is reviewable. Every table returned by the schema must land here or
// in a family above, or the reset refuses.
// ───────────────────────────────────────────────────────────────────────────────

export const TABLE_RULES: readonly TableRule[] = [
  // ── THE LEDGER'S STRUCTURE, carved out of the gl_ family ──────────────────
  //
  // The gl_ family rule says WIPE, and for journals and periods that is right.
  // But a dozen gl_ tables are the ledger's SKELETON, not its activity, and the
  // family default swept them all up on the first real run of this module. Each
  // one below was opened and read before being carved out. Wiping any of them
  // would leave the owner with an app that cannot post an entry at all — the
  // opposite of a usable clean slate.
  {
    table: "gl_accounts",
    disposition: "KEEP",
    because:
      "The chart of accounts itself — all 300-odd account codes seeded by migration 0173. This is the skeleton every journal entry hangs on; empty it and nothing can be posted.",
  },
  {
    table: "gl_entities",
    disposition: "KEEP",
    because:
      "The four entities the books are kept for. Wiping them would orphan the entire chart of accounts and the shareholder register.",
  },
  {
    table: "gl_shareholders",
    disposition: "KEEP",
    because:
      "The shareholder register and each holder's percentage. This is the record corrected in books-50 after a three-holder version was found wrong; it is ownership, not activity.",
  },
  {
    table: "gl_journal_sequences",
    disposition: "KEEP",
    because:
      "The next journal number per entity. Resetting it to 1 is harmless only if every journal is also gone — which the reset does ensure — but keeping the counter means a real entry can never reuse a number a test entry already printed on a report you saved.",
  },
  {
    table: "gl_account_rules",
    disposition: "KEEP",
    because:
      "The rules that map a description or vendor onto an account code — owner-authored automation that must keep working after the wipe.",
  },
  {
    table: "gl_account_migration_map",
    disposition: "KEEP",
    because:
      "How each old Sage account code maps to the new chart. Needed for the parallel run with Sage that continues to year end.",
  },
  {
    table: "gl_posting_templates",
    disposition: "KEEP",
    because:
      "The reusable posting recipes the app uses to build journal entries — configuration, not entries.",
  },
  {
    table: "gl_approval_policy",
    disposition: "KEEP",
    because:
      "The dollar threshold above which an entry needs a second pair of eyes — an internal control setting.",
  },
  {
    table: "gl_allocation_configs",
    disposition: "KEEP",
    because:
      "How shared costs are split between the entities — a standing policy decision.",
  },
  {
    table: "gl_payroll_labor_roles",
    disposition: "KEEP",
    because:
      "Which job roles count as direct labour for 280E cost of goods — a classification policy that took real research.",
  },
  {
    table: "gl_conversion_config",
    disposition: "KEEP",
    because:
      "Your cut-over date, opening balance date and the Sage parallel-run window. This single row defines when the real books begin and must survive the wipe that precedes them.",
  },
  {
    table: "gl_vendor_purchase_kinds",
    disposition: "KEEP",
    because:
      "The catalogue of what a vendor line can be — product, freight, packaging, rent — and which account each hits. Reference data seeded by migration 0187.",
  },
  {
    table: "gl_vendor_profiles",
    disposition: "KEEP",
    because:
      "Per-vendor defaults, such as whether a vendor is a licensed producer whose goods are product for resale. Owner-curated.",
  },
  // ...and these gl_ tables genuinely ARE activity, named explicitly so the
  // reasoning is on the record rather than resting on a prefix.
  {
    table: "gl_journals",
    disposition: "WIPE",
    because:
      "Every journal entry on the books. This is the table that made you ask the question — after this, the trial balance is blank.",
  },
  {
    table: "gl_journal_lines",
    disposition: "WIPE",
    because: "The debit and credit lines of those entries.",
  },
  {
    table: "gl_periods",
    disposition: "WIPE",
    because:
      "The accounting periods opened and closed during testing, including any you closed to practise a month end.",
  },
  {
    table: "gl_audit_events",
    disposition: "WIPE",
    because:
      "The ledger's own append-only trail of postings, approvals and reversals from testing. It is normally impossible to delete; the factory reset is the only door.",
  },
  {
    table: "gl_opening_balances",
    disposition: "WIPE",
    because:
      "Practice opening balances. The real one is built from the October 31st count, so a rehearsal version left behind would double your starting inventory.",
  },
  {
    table: "gl_override_log",
    disposition: "WIPE",
    because: "The log of times you overrode a refusal while testing.",
  },
  {
    table: "gl_template_changes",
    disposition: "WIPE",
    because: "The history of edits to posting templates during testing.",
  },
  {
    table: "gl_bank_reconciliations",
    disposition: "WIPE",
    because: "Practice bank reconciliations.",
  },
  {
    table: "gl_bank_matches",
    disposition: "WIPE",
    because: "Which test bank row was matched to which test journal entry.",
  },
  {
    table: "gl_classification_suggestions",
    disposition: "WIPE",
    because: "Suggested account codes generated for test bank transactions.",
  },
  {
    table: "gl_account_proposals",
    disposition: "WIPE",
    because:
      "Requests to add a new account code, raised while testing. Any you approved are already in the chart of accounts, which is kept.",
  },
  {
    table: "gl_payroll_allocations",
    disposition: "WIPE",
    because:
      "How each test payroll run was split across entities and cost classes.",
  },

  // ── Other family carve-outs ───────────────────────────────────────────────
  {
    table: "discovery_settings",
    disposition: "KEEP",
    because:
      "The on/off switch and default market for market research — a single settings row, not a scrape.",
  },
  {
    table: "discovery_sources",
    disposition: "KEEP",
    because:
      "Which data sources you have approved, including whether each is cleared for commercial use. That clearance is a legal judgement you made and must not be lost.",
  },
  {
    table: "crypto_wallets",
    disposition: "KEEP",
    because:
      "The wallet addresses you are tracking. Real addresses you own; re-entering them by hand invites a typo that would point at a stranger's wallet.",
  },
  {
    table: "crypto_assets",
    disposition: "KEEP",
    because:
      "The catalogue of coins and tokens with their chains and decimals — reference data.",
  },
  {
    table: "crypto_classification_rules",
    disposition: "KEEP",
    because:
      "Your rules for how a crypto transaction is taxed, such as treating an FTSO reward as income. Tax positions you decided.",
  },
  {
    table: "crypto_asset_migrations",
    disposition: "KEEP",
    because:
      "Token migration ratios, such as one coin redenominating into another. Historical facts about the assets, not your activity.",
  },
  {
    table: "crypto_owner_wallet_confirmations",
    disposition: "KEEP",
    because:
      "Your confirmations that a discovered address is or is not yours. Each one is a judgement you made about an address, and losing them would re-ask every question.",
  },

  // ── Sales and the register ────────────────────────────────────────────────
  { table: "orders", disposition: "WIPE", because: "Every test sale you rang." },
  { table: "order_lines", disposition: "WIPE", because: "The line items on those test sales." },
  { table: "order_events", disposition: "WIPE", because: "The lifecycle history of test sales." },
  { table: "order_name_pool", disposition: "KEEP", because: "The pool of friendly order names — configuration the app draws from, not a record of a sale." },
  { table: "pos_sale_events", disposition: "WIPE", because: "Register-level events recorded by the point of sale during testing." },
  { table: "customer_returns", disposition: "WIPE", because: "Test customer returns rung during the rehearsal." },
  { table: "medical_exempt_sales", disposition: "WIPE", because: "Test medical tax-exempt sales." },
  { table: "sales_limit_events", disposition: "WIPE", because: "Daily purchase-limit checks recorded against test customers." },
  { table: "special_discount_uses", disposition: "WIPE", because: "Test uses of employee and special discounts." },
  { table: "receipt_print_jobs", disposition: "WIPE", because: "Test receipts queued to the printer." },
  { table: "till_verifications", disposition: "WIPE", because: "Till verification counts recorded while testing the register." },
  { table: "drawer_sessions", disposition: "WIPE", because: "Test drawer open/close sessions." },
  { table: "drawer_counts", disposition: "WIPE", because: "Drawer counts recorded while testing the register." },
  { table: "drawer_drops", disposition: "WIPE", because: "Test cash drops to the safe." },
  { table: "safe_counts", disposition: "WIPE", because: "Safe counts recorded while testing cash handling." },
  { table: "safe_swaps", disposition: "WIPE", because: "Test till/safe swaps." },
  { table: "registers", disposition: "KEEP", because: "Your physical registers. Hardware you own; deleting them would stop the POS from opening." },
  { table: "pos_devices", disposition: "KEEP", because: "The tablets and terminals you have paired." },
  { table: "receipt_printer_settings", disposition: "KEEP", because: "Printer configuration." },

  // ── Inventory ─────────────────────────────────────────────────────────────
  { table: "inventory_lots", disposition: "WIPE", because: "Every test lot, with its cost and quantity. After the wipe your inventory is empty and ready for the real October 31st count." },
  { table: "inventory_adjustments", disposition: "WIPE", because: "Test shrink, waste and correction entries." },
  { table: "lab_results", disposition: "WIPE", because: "Lab COAs attached to test lots." },
  { table: "inbound_manifests", disposition: "WIPE", because: "Test deliveries from vendors." },
  { table: "manifest_events", disposition: "WIPE", because: "The lifecycle of those test deliveries." },
  { table: "manifest_documents", disposition: "WIPE", because: "Scanned manifests and invoices archived against test deliveries." },
  { table: "vendor_manifest_payments", disposition: "WIPE", because: "Test payments recorded against test deliveries." },
  { table: "cycle_counts", disposition: "WIPE", because: "Practice cycle counts of inventory on the shelf." },
  { table: "cycle_count_lines", disposition: "WIPE", because: "The lines of those test counts." },
  { table: "destruction_events", disposition: "WIPE", because: "Test destruction records." },
  { table: "vendor_returns", disposition: "WIPE", because: "Test returns to vendors." },
  { table: "trade_sample_events", disposition: "WIPE", because: "Test trade-sample movements." },
  { table: "sample_json_imports", disposition: "WIPE", because: "Sample files uploaded while testing the importer." },
  { table: "inventory_audit_sessions", disposition: "WIPE", because: "Practice inventory audits. The real one is October 31st and must start from nothing." },
  { table: "inventory_audit_lines", disposition: "WIPE", because: "The counted lines of practice audits." },
  { table: "inventory_audit_postings", disposition: "WIPE", because: "Journal entries produced by practice audits." },
  { table: "inventory_audit_history", disposition: "WIPE", because: "The history of practice audits." },
  { table: "noncannabis_adjustments", disposition: "WIPE", because: "Test adjustments to non-cannabis stock." },
  { table: "inventory_types", disposition: "KEEP", because: "Your category definitions — configuration that the chart of accounts is built on." },
  { table: "website_category_types", disposition: "KEEP", because: "How categories appear on the website." },

  // ── Purchasing and vendor bills ───────────────────────────────────────────
  { table: "purchase_orders", disposition: "WIPE", because: "Test purchase orders." },
  { table: "purchase_order_lines", disposition: "WIPE", because: "The lines on those test orders." },
  { table: "noncannabis_invoices", disposition: "WIPE", because: "Test vendor bills for non-cannabis goods." },
  { table: "noncannabis_invoice_lines", disposition: "WIPE", because: "The lines on those test bills." },
  { table: "reorder_settings", disposition: "KEEP", because: "Your reorder thresholds — settings, not events." },
  { table: "vendors", disposition: "KEEP", because: "Your vendor list. Real suppliers you will buy from on November 1st." },
  { table: "vendor_aliases", disposition: "KEEP", because: "The alternate spellings that let imports match your vendors." },
  { table: "vendor_bank_details", disposition: "KEEP", because: "Vendor banking for ACH — real payment instructions." },
  { table: "vendor_platform_map", disposition: "KEEP", because: "Which vendor corresponds to which menu platform." },
  { table: "brands", disposition: "KEEP", because: "Your brand list, used to match products on every vendor menu." },
  { table: "brand_aliases", disposition: "KEEP", because: "Alternate brand spellings for matching." },

  // ── Vendor menus (fetched, not authored) ──────────────────────────────────
  { table: "cultivera_menu_snapshots", disposition: "WIPE", because: "Vendor menus fetched from Cultivera while testing; they are re-fetched on demand." },
  { table: "cultivera_menu_items", disposition: "WIPE", because: "The items on those fetched menus." },
  { table: "growflow_menu_snapshots", disposition: "WIPE", because: "Vendor menus fetched from GrowFlow while testing." },
  { table: "growflow_menu_items", disposition: "WIPE", because: "The items on those fetched menus." },
  { table: "leaflink_menu_snapshots", disposition: "WIPE", because: "Vendor menus fetched from LeafLink while testing." },
  { table: "leaflink_menu_items", disposition: "WIPE", because: "The items on those fetched menus." },
  { table: "emailed_menu_snapshots", disposition: "WIPE", because: "Vendor menus parsed out of email while testing." },
  { table: "emailed_menu_items", disposition: "WIPE", because: "The items on those parsed menus." },

  // ── Product imports and the catalogue ─────────────────────────────────────
  { table: "pos_imports", disposition: "WIPE", because: "Test spreadsheet imports." },
  { table: "pos_import_diagnostics", disposition: "WIPE", because: "Warnings from those test imports." },
  { table: "pos_fact_reviews", disposition: "WIPE", because: "Decisions you made reviewing test import facts." },
  { table: "menu_versions", disposition: "WIPE", because: "Menu versions created by test imports." },
  { table: "menu_items", disposition: "WIPE", because: "Products loaded by test imports." },
  { table: "menu_variants", disposition: "WIPE", because: "The size and price variants of those products." },
  { table: "catalog_product_drafts", disposition: "WIPE", because: "Draft products awaiting approval from test imports." },
  { table: "ai_suggestions", disposition: "WIPE", because: "AI copy suggestions generated during testing." },
  { table: "product_master_suggestions", disposition: "WIPE", because: "Proposed product groupings from test imports." },
  { table: "product_masters", disposition: "KEEP", because: "Your curated product groupings — hand-authored work that survives a wipe." },
  { table: "product_master_members", disposition: "KEEP", because: "Which products belong to which curated grouping." },
  { table: "product_enrichments", disposition: "KEEP", because: "Descriptions and images you approved." },
  { table: "product_classification_overrides", disposition: "KEEP", because: "Your manual corrections to how a product is classified — decisions, and they must keep applying after the wipe." },
  { table: "noncannabis_products", disposition: "KEEP", because: "Your curated non-cannabis catalogue." },
  { table: "noncannabis_sku_sequences", disposition: "KEEP", because: "SKU counters. Resetting them would re-issue SKUs you have already printed on labels." },
  { table: "medical_product_registry", disposition: "KEEP", because: "DOH-compliant product registry — reference data." },

  // ── Customers and loyalty ─────────────────────────────────────────────────
  { table: "customers", disposition: "WIPE", because: "Test customers. Real ones sign up from November 1st." },
  { table: "patient_authorizations", disposition: "WIPE", because: "Test medical authorizations." },
  { table: "loyalty_signups", disposition: "WIPE", because: "Test loyalty signups." },
  { table: "loyalty_accounts", disposition: "WIPE", because: "Test loyalty balances." },
  { table: "loyalty_ledger", disposition: "WIPE", because: "Test points earned and spent." },
  { table: "loyalty_redemptions", disposition: "WIPE", because: "Loyalty rewards redeemed by test customers." },
  { table: "loyalty_config", disposition: "KEEP", because: "How your loyalty programme works — settings." },
  { table: "loyalty_tiers", disposition: "KEEP", because: "Your loyalty tier definitions." },
  { table: "loyalty_promotions", disposition: "KEEP", because: "Loyalty promotions you authored." },

  // ── Payroll, time and people ──────────────────────────────────────────────
  { table: "time_punches", disposition: "WIPE", because: "Test clock-ins and clock-outs." },
  { table: "shifts", disposition: "WIPE", because: "Test scheduled shifts." },
  { table: "pay_periods", disposition: "WIPE", because: "Test pay periods. Real payroll starts January 1st 2027." },
  { table: "payroll_runs", disposition: "WIPE", because: "Payroll runs processed during the rehearsal." },
  { table: "payroll_run_lines", disposition: "WIPE", because: "The per-employee lines of test payroll runs." },
  { table: "payroll_source_documents", disposition: "WIPE", because: "Payroll files uploaded while testing." },
  { table: "payroll_ytd_accumulators", disposition: "WIPE", because: "Year-to-date wage and tax totals. These MUST go: leaving test year-to-date figures behind would corrupt the first real W-2 and the first real 941." },
  { table: "filed_form_941_totals", disposition: "WIPE", because: "Totals recorded from test 941 filings; a stale one would misstate a real quarter." },
  { table: "sick_leave_ledger", disposition: "WIPE", because: "Paid-sick-leave hours accrued and used in testing. Washington law tracks these per employee; test balances must not carry into real employment." },
  { table: "sick_leave_requests", disposition: "WIPE", because: "Test sick-leave requests." },
  { table: "wage_orders", disposition: "WIPE", because: "Test garnishment and wage orders." },
  { table: "employee_ssn_reveals", disposition: "WIPE", because: "The log of who viewed a Social Security number while testing." },
  { table: "employees", disposition: "KEEP", because: "Your people. Deleting them would mean re-entering every hire, W-4 and I-9." },
  { table: "staff_profiles", disposition: "KEEP", because: "Login accounts — including yours. Wiping this would lock you out of the app." },
  { table: "employee_pay", disposition: "KEEP", because: "Each employee's pay rate — a standing term of employment, not a test event." },
  { table: "employee_w4", disposition: "KEEP", because: "Signed W-4 elections." },
  { table: "employee_i9", disposition: "KEEP", because: "I-9 verification records, which federal law requires you to retain." },
  { table: "employee_documents", disposition: "KEEP", because: "Employee documents you uploaded." },
  { table: "employee_onboarding_tasks", disposition: "KEEP", because: "Onboarding checklists per employee." },
  { table: "employee_training_log", disposition: "KEEP", because: "Training records — required for LCB compliance." },
  { table: "employee_scorp_health_premiums", disposition: "KEEP", because: "S-corp health premium elections that belong on a W-2." },
  { table: "sick_leave_policy", disposition: "KEEP", because: "Your sick-leave policy — configuration." },
  { table: "handbook_acknowledgments", disposition: "KEEP", because: "Signed handbook acknowledgments — real signatures." },
  { table: "ach_company_settings", disposition: "KEEP", because: "Your ACH originator details for paying people." },
  { table: "webauthn_credentials", disposition: "KEEP", because: "Registered passkeys. Wiping them could lock you out." },
  { table: "webauthn_challenges", disposition: "KEEP", because: "Short-lived passkey challenges; harmless either way, kept with their parent table so login is never disturbed by a reset." },
  { table: "pin_throttle", disposition: "KEEP", because: "Failed-PIN lockout state. Wiping it would hand an attacker a fresh set of attempts, so a reset must not clear it." },
  { table: "push_subscriptions", disposition: "KEEP", because: "Devices registered for compliance alerts." },

  // ── Money in and out ──────────────────────────────────────────────────────
  { table: "manual_loans", disposition: "WIPE", because: "Test loans entered by hand." },
  { table: "manual_loan_payments", disposition: "WIPE", because: "Test payments against those loans." },
  // NOTE: there is deliberately NO rule for `secret_ledger`. An early draft of
  // this file had one, because my first table extraction used a grep that did
  // not strip SQL comments, and 0175_gl_trial_balance.sql:425 mentions
  // `create table secret_ledger(...)` inside a COMMENT describing a manual
  // penetration test. The table has never existed. RULE_FOR_MISSING_TABLE
  // caught it on the first run of buildResetPlan against the real schema. The
  // rule was deleted rather than the refusal weakened — that refusal is the
  // only reason a phantom table did not end up in a production DELETE
  // statement, where it would have aborted the whole reset transaction.

  // ── Tax and compliance filings ────────────────────────────────────────────
  { table: "excise_return_batches", disposition: "WIPE", because: "Test excise returns." },
  { table: "excise_return_drafts", disposition: "WIPE", because: "Draft excise returns from testing." },
  { table: "ccrs_export_batches", disposition: "WIPE", because: "Test CCRS export files." },
  { table: "ccrs_adjustment_batches", disposition: "WIPE", because: "Test CCRS adjustment files." },
  { table: "ccrs_week_submissions", disposition: "WIPE", because: "Test weekly CCRS submission records." },
  { table: "compliance_reminder_log", disposition: "WIPE", because: "Reminders fired during testing." },
  { table: "syndication_logs", disposition: "WIPE", because: "Test pushes of your menu to third-party sites." },
  { table: "syndication_sync_state", disposition: "WIPE", because: "Where each syndication feed left off during testing." },
  { table: "syndication_sync_settings", disposition: "KEEP", because: "Which sites you syndicate to — settings." },
  { table: "license_settings", disposition: "KEEP", because: "Your I-502 licence number and CCRS identifiers." },
  { table: "tax_settings", disposition: "KEEP", because: "Your excise and sales tax rates." },
  { table: "tax_category_rules", disposition: "KEEP", because: "Which categories are taxed which way." },
  { table: "medical_endorsement_config", disposition: "KEEP", because: "Your medical endorsement configuration." },
  { table: "sales_limit_settings", disposition: "KEEP", because: "Daily purchase limits — settings." },
  { table: "disposition_settings", disposition: "KEEP", because: "How returns and destruction are handled — settings." },
  { table: "sample_settings", disposition: "KEEP", because: "Trade sample rules — settings." },
  { table: "trade_sample_settings", disposition: "KEEP", because: "Trade sample limits — settings." },
  { table: "special_discount_settings", disposition: "KEEP", because: "Your discount policy." },
  { table: "accounting_settings", disposition: "KEEP", because: "Accounting configuration." },
  { table: "pricing_settings", disposition: "KEEP", because: "Your pricing rules and shelf-price rounding settings." },
  { table: "company_profile", disposition: "KEEP", because: "Your legal name, EIN, UBI and address — the identity printed on every tax form." },
  { table: "site_settings", disposition: "KEEP", because: "Site-wide settings such as store hours and contact details." },
  { table: "integration_credentials", disposition: "KEEP", because: "Saved integration credentials. Wiping these would mean re-entering keys — exactly the hunt through hidden Vercel variables you asked to avoid." },
  { table: "sage_category_map", disposition: "KEEP", because: "How Sage categories map to yours — needed for the parallel run to year end." },
  { table: "sage_category_accounts", disposition: "KEEP", because: "How Sage accounts map to yours — needed for the parallel run." },

  // ── Sage helper and AI usage ──────────────────────────────────────────────
  { table: "sage_chat_messages", disposition: "WIPE", because: "Your conversations with the in-app helper during testing." },
  { table: "sage_import_uploads", disposition: "WIPE", because: "Files uploaded to the helper while testing." },
  { table: "ai_usage", disposition: "WIPE", because: "The AI spend meter for test runs." },

  // ── Website, marketing and email ──────────────────────────────────────────
  { table: "newsletter_sends", disposition: "WIPE", because: "Test newsletter sends." },
  { table: "newsletter_email_events", disposition: "WIPE", because: "Opens and clicks on test newsletters." },
  { table: "inbound_email_log", disposition: "WIPE", because: "Email received during testing." },
  { table: "content_blocks", disposition: "KEEP", because: "Website copy you wrote." },
  { table: "content_revisions", disposition: "KEEP", because: "The revision history of that copy." },
  { table: "page_sections", disposition: "KEEP", because: "How your pages are laid out." },
  { table: "blog_posts", disposition: "KEEP", because: "Blog posts you wrote for the public website." },
  { table: "faq_items", disposition: "KEEP", because: "Frequently asked questions you wrote for customers." },
  { table: "about_core_values", disposition: "KEEP", because: "Your About page values." },
  { table: "home_carousel_slides", disposition: "KEEP", because: "Home page carousel you built." },
  { table: "shop_carousel_slides", disposition: "KEEP", because: "Shop page carousel you built." },
  { table: "media_assets", disposition: "KEEP", because: "Your uploaded photographs and artwork." },
  { table: "media_usages", disposition: "KEEP", because: "Where each image is used." },
  { table: "newsletter_assets", disposition: "KEEP", because: "Artwork you uploaded for customer newsletters." },
  { table: "seo_entries", disposition: "KEEP", because: "Your titles and meta descriptions." },
  { table: "marketing_ideas", disposition: "KEEP", because: "Marketing ideas you saved." },
  { table: "promotions", disposition: "KEEP", because: "Promotions you authored." },
  { table: "promotion_targets", disposition: "KEEP", because: "What each promotion applies to." },
  { table: "promotion_exclusions", disposition: "KEEP", because: "What each promotion excludes." },
  { table: "promotion_never_discount", disposition: "KEEP", because: "Products that may never be discounted — a standing rule." },
  { table: "promotion_saved_audiences", disposition: "KEEP", because: "Saved audiences for promotions." },
  { table: "promotion_audit_snapshots", disposition: "WIPE", because: "Snapshots of promotion state captured when a test promotion ran." },

  // ── Equipment ─────────────────────────────────────────────────────────────
  { table: "equipment_assets", disposition: "KEEP", because: "Equipment you own — fixed assets that appear on the balance sheet." },
  { table: "equipment_service_events", disposition: "WIPE", because: "Test service and maintenance records." },

  // ── The audit trail ───────────────────────────────────────────────────────
  {
    table: "audit_logs",
    disposition: "KEEP",
    because:
      "The record of who did what in this app — including the reset itself. Wiping it would erase the evidence that the reset happened, which is the one thing an auditor would want to see. It is deliberately kept.",
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// §4  CLASSIFY
// ───────────────────────────────────────────────────────────────────────────────

export type Classification = {
  readonly table: string;
  readonly disposition: ResetDisposition;
  readonly because: string;
  /** "table" when a specific rule matched; "family" when a prefix rule did. */
  readonly source: "table" | "family";
};

/**
 * Classify one table name. Returns null when nothing claims it — the caller
 * must treat null as a REFUSAL, never as a default. There is deliberately no
 * fallback disposition: guessing WIPE could destroy real records, and guessing
 * KEEP is exactly the D-62 bug that left the whole ledger behind. The only
 * safe answer to "I do not know what this table is" is to stop and ask.
 */
export function classifyTable(table: string): Classification | null {
  const name = table.trim().toLowerCase();
  if (name === "") return null;

  for (const r of TABLE_RULES) {
    if (r.table === name) {
      return { table: name, disposition: r.disposition, because: r.because, source: "table" };
    }
  }
  for (const f of FAMILY_RULES) {
    if (name.startsWith(f.prefix)) {
      return { table: name, disposition: f.disposition, because: f.because, source: "family" };
    }
  }
  return null;
}

export type ResetPlan =
  | {
      readonly ok: true;
      readonly wipe: readonly Classification[];
      readonly keep: readonly Classification[];
    }
  | {
      readonly ok: false;
      readonly refusals: readonly {
        readonly code: ResetRefusalCode;
        readonly detail: string;
      }[];
    };

/**
 * Build the plan for a schema. `tablesInSchema` is the ACTUAL list of tables,
 * read from the database or from the migrations — never a copy of the rule set,
 * because comparing the rules to themselves would prove nothing (rule 73).
 */
export function buildResetPlan(tablesInSchema: readonly string[]): ResetPlan {
  const refusals: { code: ResetRefusalCode; detail: string }[] = [];

  const names = tablesInSchema.map((t) => t.trim().toLowerCase()).filter((t) => t !== "");
  const present = new Set(names);

  // A rule set with a duplicate has two answers for one question.
  const seen = new Set<string>();
  for (const r of TABLE_RULES) {
    if (seen.has(r.table)) {
      refusals.push({ code: "DUPLICATE_RULE", detail: `two rules claim '${r.table}'` });
    }
    seen.add(r.table);
  }

  // A rule for a table that no longer exists means the rule set has drifted
  // from the schema. That is the same class of rot as D-62, caught from the
  // other side, so it refuses rather than being quietly ignored.
  for (const r of TABLE_RULES) {
    if (!present.has(r.table)) {
      refusals.push({
        code: "RULE_FOR_MISSING_TABLE",
        detail: `rule names '${r.table}', which is not in the schema`,
      });
    }
  }

  const wipe: Classification[] = [];
  const keep: Classification[] = [];
  for (const name of names) {
    const c = classifyTable(name);
    if (c === null) {
      refusals.push({
        code: "UNCLASSIFIED_TABLE",
        detail: `'${name}' has no rule — decide whether a factory reset should empty it before shipping`,
      });
      continue;
    }
    if (c.disposition === "WIPE") wipe.push(c);
    else keep.push(c);
  }

  if (wipe.length === 0 && refusals.length === 0) {
    refusals.push({ code: "NOTHING_TO_WIPE", detail: "no table classified WIPE" });
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const byName = (a: Classification, b: Classification) => a.table.localeCompare(b.table);
  return { ok: true, wipe: [...wipe].sort(byName), keep: [...keep].sort(byName) };
}

// ───────────────────────────────────────────────────────────────────────────────
// §5  MAY THE RESET RUN AT ALL?
//
// Separate from WHAT it deletes: WHETHER it is allowed to. Washington requires
// records to be retained, so once real trade exists the reset must not be a
// convenience. The retention period here is FIVE years — WAC 314-55-087(1) as
// amended by WSR 24-19-040, filed 9/11/2024, effective 10/12/2024. It was three
// years before that amendment, and migrations 0097 and 0140 still say three.
// That stale citation is D-63; this module states the current period, and
// docs/COMPLIANCE_BIBLE.md §3.6 is the evidence.
// ───────────────────────────────────────────────────────────────────────────────

/** WAC 314-55-087(1) as amended by WSR 24-19-040 (eff. 10/12/2024). */
export const RETENTION_YEARS = 5;

export const RETENTION_CITE = "WAC 314-55-087(1)";

export type TradeEvidence = {
  /** Completed sales. One real sale means the rehearsal is over. */
  readonly completedOrders: number;
  /** CCRS files produced. Reported to the LCB; the state has seen them. */
  readonly ccrsBatches: number;
  /** Excise returns filed with the Department of Revenue. */
  readonly exciseReturnsFiled: number;
  /** Posted journal entries dated on or after the cut-over. */
  readonly postedJournals: number;
};

export type ResetPermission =
  | { readonly allowed: true; readonly note: string }
  | {
      readonly allowed: false;
      readonly code: ResetRefusalCode;
      readonly message: string;
    };

/**
 * Decide whether the reset may proceed.
 *
 * The retention rule is not a formality here. If Michael trades on November 1st
 * and presses this button on November 3rd, it would delete records Washington
 * requires him to keep for five years, and a Category IV violation is the
 * consequence. So the presence of ANY real trade turns the reset from a
 * convenience into an act that needs a named, recorded acknowledgement.
 *
 * `acknowledgedRetention` must come from the owner in person — a typed
 * confirmation naming the rule. It is not a default, and no code path may
 * supply it on his behalf.
 */
export function mayReset(
  evidence: TradeEvidence,
  acknowledgedRetention: boolean,
): ResetPermission {
  const bits: string[] = [];
  if (evidence.completedOrders > 0) bits.push(`${evidence.completedOrders} completed sale(s)`);
  if (evidence.ccrsBatches > 0) bits.push(`${evidence.ccrsBatches} CCRS file(s)`);
  if (evidence.exciseReturnsFiled > 0) bits.push(`${evidence.exciseReturnsFiled} filed excise return(s)`);
  if (evidence.postedJournals > 0) bits.push(`${evidence.postedJournals} posted journal entr(ies)`);

  if (bits.length === 0) {
    return {
      allowed: true,
      note: "No completed sales, no CCRS files, no filed returns and no posted journal entries. Nothing here looks like real trade, so this is still a rehearsal and the reset is safe to run.",
    };
  }

  if (!acknowledgedRetention) {
    return {
      allowed: false,
      code: "RETENTION_NOT_ACKNOWLEDGED",
      message:
        `Refusing to wipe: this database contains ${bits.join(", ")}. ` +
        `${RETENTION_CITE} requires records to be kept for a ${RETENTION_YEARS}-year period and produced ` +
        `for the LCB on request. Export everything first, then confirm you have done so and that you ` +
        `accept these records are being destroyed.`,
    };
  }

  return {
    allowed: true,
    note:
      `Proceeding with ${bits.join(", ")} present, on the owner's explicit ${RETENTION_CITE} ` +
      `acknowledgement. This is recorded in the audit log.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// §6  WHAT THE OWNER READS BEFORE HE PRESSES IT
// ───────────────────────────────────────────────────────────────────────────────

export type ResetBriefing = {
  readonly headline: string;
  readonly wipeCount: number;
  readonly keepCount: number;
  readonly paragraphs: readonly string[];
};

/**
 * The plain-English briefing. He said "I am a visual learner" and asked to see
 * what a thing does rather than be told it works, so the counts are real counts
 * taken from the plan, not prose.
 */
export function describeResetPlan(plan: ResetPlan): ResetBriefing {
  if (!plan.ok) {
    return {
      headline: "The factory reset is NOT ready to run.",
      wipeCount: 0,
      keepCount: 0,
      paragraphs: [
        "Something in the schema is not accounted for, so the reset refuses to run rather than guess. Guessing would either destroy real records or leave test numbers on your books.",
        ...plan.refusals.map((r) => `${r.code}: ${r.detail}`),
      ],
    };
  }

  return {
    headline: `This will empty ${plan.wipe.length} tables and leave ${plan.keep.length} alone.`,
    wipeCount: plan.wipe.length,
    keepCount: plan.keep.length,
    paragraphs: [
      "Emptied: everything that records something that happened — your test sales, test inventory, test deliveries, test payroll, test bank and ATM activity, and every journal entry on the books. When it finishes, your trial balance is blank and every report reads zero.",
      "Left alone: everything that describes your business rather than recording an event — your chart of accounts, the four entities, the shareholder register, tax rates, licence details, settings, saved integration keys, the cannabis knowledge base, your curated catalogue, vendors, brands, website content, your staff and your own login.",
      "Two things are kept on purpose that you might expect to be wiped. The audit log stays, because it is the record that the reset happened at all, and erasing it would erase the evidence. Your saved integration credentials stay, because wiping them would send you hunting through hidden Vercel keys — the exact job you said you did not want to do.",
      `One limit: once you have made a real sale, filed a real return, or posted a real journal entry, ${RETENTION_CITE} requires those records for a ${RETENTION_YEARS}-year period. The reset will then refuse until you export everything and confirm in writing that you accept the destruction.`,
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// §7  SELF-TESTS
// ───────────────────────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`factory-reset-core self-test: ${msg}`);
}

export function __runFactoryResetCoreTests(): void {
  // An unknown table must REFUSE, not default.
  assert(classifyTable("some_table_nobody_wrote_a_rule_for") === null, "unknown table must not classify");

  const bad = buildResetPlan(["orders", "totally_new_table"]);
  assert(bad.ok === false, "unclassified table must refuse the plan");
  if (bad.ok === false) {
    assert(
      bad.refusals.some((r) => r.code === "UNCLASSIFIED_TABLE"),
      "must refuse with UNCLASSIFIED_TABLE",
    );
    // ...and it must ALSO refuse for every rule whose table is absent, which is
    // most of them in this two-table schema.
    assert(
      bad.refusals.some((r) => r.code === "RULE_FOR_MISSING_TABLE"),
      "must refuse for rules whose tables are absent",
    );
  }

  // The ledger must be WIPE, by family, with no per-table rule needed.
  for (const t of ["gl_journals", "gl_journal_lines", "gl_periods", "gl_audit_events"]) {
    const c = classifyTable(t);
    assert(c !== null && c.disposition === "WIPE", `${t} must be WIPE`);
  }

  // The things that would break the app or lose his work must be KEEP.
  for (const t of ["gl_accounts", "gl_entities", "gl_shareholders"]) {
    const c = classifyTable(t);
    assert(c !== null, `${t} must classify`);
  }
  for (const t of ["staff_profiles", "employees", "company_profile", "audit_logs", "kb_strains"]) {
    const c = classifyTable(t);
    assert(c !== null && c.disposition === "KEEP", `${t} must be KEEP`);
  }

  // Specific rules beat family rules.
  const auditLogs = classifyTable("audit_logs");
  assert(auditLogs !== null && auditLogs.source === "table", "audit_logs must match a table rule");

  // Retention: no trade → allowed without acknowledgement.
  const quiet = mayReset(
    { completedOrders: 0, ccrsBatches: 0, exciseReturnsFiled: 0, postedJournals: 0 },
    false,
  );
  assert(quiet.allowed === true, "an untraded database may reset freely");

  // Each kind of trade evidence must independently block.
  const kinds: (keyof TradeEvidence)[] = [
    "completedOrders",
    "ccrsBatches",
    "exciseReturnsFiled",
    "postedJournals",
  ];
  for (const k of kinds) {
    const ev: TradeEvidence = {
      completedOrders: 0,
      ccrsBatches: 0,
      exciseReturnsFiled: 0,
      postedJournals: 0,
      ...{ [k]: 1 },
    };
    const blocked = mayReset(ev, false);
    assert(blocked.allowed === false, `${k} alone must block the reset`);
    if (blocked.allowed === false) {
      assert(blocked.code === "RETENTION_NOT_ACKNOWLEDGED", `${k} must refuse for retention`);
      assert(blocked.message.includes("5-year"), `${k} refusal must state the five-year period`);
    }
    const acked = mayReset(ev, true);
    assert(acked.allowed === true, `${k} must be overridable by the owner`);
  }

  // Every rule must carry a real reason.
  for (const r of TABLE_RULES) {
    assert(r.because.trim().length >= 20, `rule for ${r.table} needs a real reason`);
  }
  for (const f of FAMILY_RULES) {
    assert(f.because.trim().length >= 20, `family rule ${f.prefix} needs a real reason`);
  }

  // The briefing must never claim readiness for a refusing plan.
  const briefing = describeResetPlan(bad);
  assert(briefing.wipeCount === 0, "a refusing plan must not report a wipe count");
  assert(/NOT ready/.test(briefing.headline), "a refusing plan must say so");
}
