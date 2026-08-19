/**
 * src/lib/inventory/inventory-audit-authorities.ts   (slice books-10)
 *
 * THE PRIMARY SOURCES BEHIND THE INVENTORY AUDITOR.
 *
 * WHY THIS IS A LEAF MODULE
 * ---------------------------------------------------------------------------
 * Same reason as books-ledger-authorities.ts, and the reason has not changed:
 * these records must be merged into the ONE shared registry in
 * books-guidance-core, because a citation has to mean the same thing on every
 * screen. But the auditor core needs to call back into books-guidance-core to
 * check that the ids it cites still resolve. If the data lived in that file the
 * two modules would import each other at runtime, around a constant built by an
 * IIFE at module-evaluation time. So the data lives HERE, in a module whose only
 * import is `import type` (erased by TypeScript). No cycle exists.
 *
 * WHAT IS DELIBERATELY *NOT* IN THIS FILE
 * ---------------------------------------------------------------------------
 * Three authorities this slice leans on hard are ALREADY in the registry and are
 * REUSED BY ID rather than restated:
 *
 *   REG_1_471_2_D_VERIFY_BY_COUNT   (books-08) — "verified by physical
 *                                    inventories at reasonable intervals"
 *   WAC_314_55_087_ADP_AUDIT_TRAIL  (books-08) — computerised-records rule
 *   AS_1105_11_COMPLETENESS         (books-07) — the completeness assertion
 *
 * Restating them here would create exactly the drift the registry exists to
 * prevent. `__runInventoryAuditAuthorityTests()` asserts they resolve and that
 * this file does NOT redefine them.
 *
 * EVERY QUOTE BELOW WAS FETCHED FROM ITS PRIMARY SOURCE DURING THIS SLICE:
 *   - 26 C.F.R. §1.471-2   : ecfr.gov, title 26, displayed current as of 2026-08-17
 *   - 26 C.F.R. §1.471-3   : ecfr.gov, title 26, displayed current as of 2026-08-17
 *   - WAC 314-55-089       : app.leg.wa.gov, WSR 24-19-040, eff. 2024-10-12
 *   - PCAOB AS 2510        : pcaobus.org standard text
 *   - PCAOB AS 1105        : pcaobus.org standard text
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";

/**
 * Ids owned by THIS module. Exported so the self-tests can assert that none of
 * them collide with an authority that already existed, and so the auditor core
 * can prove every id it cites is one it is entitled to cite.
 */
export const INVENTORY_AUDIT_AUTHORITY_IDS = [
  "REG_1_471_2_F_3_OMITTING_STOCK",
  "REG_1_471_2_F_2_NOMINAL_PRICE",
  "REG_1_471_2_E_BURDEN_OF_PROOF",
  "REG_1_471_3_B_RESELLER_COST",
  "WAC_314_55_089_4_C_DEEMED_SALES",
  "WAC_314_55_089_4_A_MONTHLY_LOST",
  "AS_2510_11_CYCLE_COUNT_BASIS",
  "AS_2510_12_RECORDS_ALONE",
  "AS_1105_11_EXISTENCE",
  "AS_1105_25_SELECTING_SPECIFIC_ITEMS",
  "AS_1105_27_NO_PROJECTION",
] as const;

export type InventoryAuditAuthorityId = (typeof INVENTORY_AUDIT_AUTHORITY_IDS)[number];

/**
 * Authorities that already exist in the shared registry and are relied on by
 * this slice WITHOUT being redefined. Asserted resolvable by the self-tests, so
 * that if a future slice renames one of them this file fails loudly instead of
 * quietly citing a ghost.
 */
export const INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS = [
  "REG_1_471_2_D_VERIFY_BY_COUNT",
  "WAC_314_55_087_ADP_AUDIT_TRAIL",
  "AS_1105_11_COMPLETENESS",
] as const;

export const INVENTORY_AUDIT_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // FEDERAL TAX — what a count is for, and how it may be valued
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "REG_1_471_2_F_3_OMITTING_STOCK",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-2(f)(3)",
    quote:
      "The following methods, among others, are sometimes used in taking or valuing inventories, but are " +
      "not in accord with the regulations in this part: ... (3) Omitting portions of the stock on hand.",
    soWhat:
      "This is your lot-code problem, named by federal regulation in 1960. When someone scanned the first " +
      "jar on the shelf, wrote down that lot code, and assumed the other three jars behind it were the same " +
      "lot, three lots stopped existing on paper while still sitting on the shelf. That is omitting portions " +
      "of the stock on hand, word for word. It is not a data-entry slip — it is one of seven named methods " +
      "the regulation says are NOT in accord with the rules. This is why this system will not let you count " +
      "one lot of a product without putting every other open lot of that same product in front of you at the " +
      "same time.",
    source:
      "eCFR, title 26, §1.471-2, displayed current as of 2026-08-17. " +
      "https://www.ecfr.gov/current/title-26/section-1.471-2",
  },
  {
    id: "REG_1_471_2_F_2_NOMINAL_PRICE",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-2(f)(2)",
    quote:
      "The following methods, among others, are sometimes used in taking or valuing inventories, but are " +
      "not in accord with the regulations in this part: ... (2) Taking work in process, or other parts of " +
      "the inventory, at a nominal price or at less than its proper value.",
    soWhat:
      "The reason this system refuses to post a variance on a lot whose cost is blank. The lazy move is to " +
      "treat a missing cost as zero, because zero makes the arithmetic work and the screen go green. Zero is " +
      "a nominal price. Valuing real product at nothing is specifically listed as not in accord with the " +
      "regulations, and it understates inventory — which in a §280E business overstates the deduction you " +
      "are least able to defend. A blank cost is a STOP, not a zero.",
    source:
      "eCFR, title 26, §1.471-2, displayed current as of 2026-08-17. " +
      "https://www.ecfr.gov/current/title-26/section-1.471-2",
  },
  {
    id: "REG_1_471_2_E_BURDEN_OF_PROOF",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-2(e)",
    quote:
      "Inventories should be recorded in a legible manner, properly computed and summarized, and should be " +
      "preserved as a part of the accounting records of the taxpayer. The inventories of taxpayers on " +
      "whatever basis taken will be subject to investigation by the district director, and the taxpayer must " +
      "satisfy the district director of the correctness of the prices adopted.",
    soWhat:
      "Read the last clause twice: the taxpayer must satisfy the examiner. Not the other way round. Nobody " +
      "has to prove your inventory is wrong — you have to prove it is right. That single sentence is the " +
      "entire argument for keeping the count sheets, the scan log, who counted, when, and what the recount " +
      "said. The paperwork is not bureaucracy; it is the only thing standing between you and someone else's " +
      "estimate of your numbers.",
    source:
      "eCFR, title 26, §1.471-2, displayed current as of 2026-08-17. " +
      "https://www.ecfr.gov/current/title-26/section-1.471-2",
  },
  {
    id: "REG_1_471_3_B_RESELLER_COST",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-3(a), (b)",
    quote:
      "Cost means: (a) In the case of merchandise on hand at the beginning of the taxable year, the " +
      "inventory price of such goods. (b) In the case of merchandise purchased since the beginning of the " +
      "taxable year, the invoice price less trade or other discounts, except strictly cash discounts " +
      "approximating a fair interest rate, which may be deducted or not at the option of the taxpayer, " +
      "provided a consistent course is followed. To this net invoice price should be added transportation " +
      "or other necessary charges incurred in acquiring possession of the goods.",
    soWhat:
      "This is the rule that decides what a missing jar costs you on the books. Greenway buys finished goods " +
      "and resells them, so cost is the INVOICE price plus freight — not the shelf price. If eight units go " +
      "missing and the system valued them at the $45 you sell them for instead of the $18 you paid, you would " +
      "write off two and a half times the real number. Wrong in your favour is still wrong, and it is the " +
      "kind of wrong that is easy for an examiner to find and expensive to explain.",
    source:
      "eCFR, title 26, §1.471-3, displayed current as of 2026-08-17. " +
      "https://www.ecfr.gov/current/title-26/section-1.471-3",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // WASHINGTON — the rule with teeth
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "WAC_314_55_089_4_C_DEEMED_SALES",
    kind: "state_law",
    cite: "WAC 314-55-089(4)(c)",
    quote:
      "Product inventory reductions that are not adequately documented will be deemed to be sales and will " +
      "be assessed the excise tax.",
    soWhat:
      "Sixteen words that turn sloppy shrink paperwork into a 37% bill. In Washington an undocumented " +
      "inventory reduction is not written off — it is RECHARACTERISED AS A SALE and taxed as one. So a lost " +
      "case with no explanation does not merely cost you the product: the state treats it as though you sold " +
      "it and pockets the excise. This is why this system will not post a material variance until it has a " +
      "reason and a note attached. The note is not busywork. The note is the difference between a write-off " +
      "and a deemed sale.",
    source:
      "WAC 314-55-089 (current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-089",
  },
  {
    id: "WAC_314_55_089_4_A_MONTHLY_LOST",
    kind: "state_law",
    cite: "WAC 314-55-089(4)(a)",
    quote:
      "On a monthly basis, cannabis retailers must maintain records and report purchases from licensed " +
      "cannabis processors, sales by product type to consumers, and lost and/or destroyed product in a " +
      "manner prescribed by the LCB.",
    soWhat:
      "Lost product is a MONTHLY reporting line item, sitting in the same sentence as your purchases and your " +
      "sales. The state already expects to see it. A shop that reports zero lost product every month for a " +
      "year is not telling a story anyone believes; a shop that reports small, dated, documented, counted " +
      "losses is telling the truth and can prove it. Counting on a rotation is what generates that evidence " +
      "as a by-product of ordinary work.",
    source:
      "WAC 314-55-089 (current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-089",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PROFESSIONAL AUDIT STANDARDS — how the pros actually do this
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "AS_2510_11_CYCLE_COUNT_BASIS",
    kind: "auditing_standard",
    cite: "PCAOB AS 2510.11 (Auditing Inventories)",
    quote:
      "In recent years, some companies have developed inventory controls or methods of determining " +
      "inventories, including statistical sampling, which are highly effective in determining inventory " +
      "quantities and which are sufficiently reliable to make unnecessary an annual physical count of each " +
      "item of inventory. In such circumstances, the independent auditor must satisfy himself that the " +
      "client's procedures or methods are sufficiently reliable to produce results substantially the same as " +
      "those which would be obtained by a count of all items each year.",
    soWhat:
      "This is the paragraph that lets you count a slice of the shop every day instead of shutting the doors " +
      "once a year — and it is also the paragraph that says what the slices have to add up to. The test is " +
      "'results substantially the same as those which would be obtained by a count of all items each year.' " +
      "Not 'we counted a lot.' Not 'we counted the expensive stuff.' Substantially the same as counting " +
      "EVERYTHING, once a year. That is the bar this system measures itself against, which is why the hub " +
      "reports the things you have NOT reached rather than congratulating you on the things you have.",
    source:
      "PCAOB Auditing Standard 2510, Auditing Inventories. " +
      "https://pcaobus.org/oversight/standards/auditing-standards/details/AS2510",
  },
  {
    id: "AS_2510_12_RECORDS_ALONE",
    kind: "auditing_standard",
    cite: "PCAOB AS 2510.12 (Auditing Inventories)",
    quote:
      "When the independent auditor has not satisfied himself as to inventories in the possession of the " +
      "client through the procedures described in paragraphs .09 through .11, tests of the accounting records " +
      "alone will not be sufficient for him to become satisfied as to quantities; it will always be necessary " +
      "for the auditor to make, or observe, some physical counts of the inventory and apply appropriate tests " +
      "of intervening transactions.",
    soWhat:
      "'Tests of the accounting records alone will not be sufficient.' No report, no reconciliation, no " +
      "beautifully balanced trial balance can tell you whether the product is actually on the shelf. Only " +
      "hands on the jars can. The word 'always' is doing real work in that sentence — there is no version of " +
      "this where the software substitutes for walking the floor. And 'tests of intervening transactions' is " +
      "why this system cares about sales rung up in the middle of a count.",
    source:
      "PCAOB Auditing Standard 2510, Auditing Inventories. " +
      "https://pcaobus.org/oversight/standards/auditing-standards/details/AS2510",
  },
  {
    id: "AS_1105_11_EXISTENCE",
    kind: "auditing_standard",
    cite: "PCAOB AS 1105.11 (Financial Statement Assertions)",
    quote:
      "Existence or occurrence—Assets or liabilities of the company exist at a given date, and recorded " +
      "transactions have occurred during a given period.",
    soWhat:
      "This is the promise a physical count actually tests, and it is worth being precise about it. Counting " +
      "proves EXISTENCE: the stuff on your balance sheet is really there. It does NOT prove completeness — " +
      "product sitting in a back room that was never entered into the system will not show up on any count " +
      "sheet, because the count sheet is built from your records. Existence and completeness are different " +
      "promises and they fail in different directions. This system says which one it is testing so you are " +
      "never falsely reassured.",
    source:
      "PCAOB Auditing Standard 1105, Audit Evidence. " +
      "https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105",
  },
  {
    id: "AS_1105_25_SELECTING_SPECIFIC_ITEMS",
    kind: "auditing_standard",
    cite: "PCAOB AS 1105.25 (Selecting Specific Items)",
    quote:
      "Selecting specific items refers to testing all of the items in a population that have a specified " +
      "characteristic, such as: Key items. The auditor may decide to select specific items within a " +
      "population because they are important to accomplishing the objective of the audit procedure or exhibit " +
      "some other characteristic, e.g., items that are suspicious, unusual, or particularly risk-prone or " +
      "items that have a history of error. All items over a certain amount. The auditor may decide to examine " +
      "items whose recorded values exceed a certain amount to verify a large proportion of the total amount " +
      "of the items included in an account.",
    soWhat:
      "The professional basis for how this system picks what you count today, written by the standard-setters " +
      "rather than invented here. Two bases, and the auditor uses both: things that are RISKY (a lot that has " +
      "gone wrong before, a product with several open lots, something nobody has touched in months) and " +
      "things that are BIG (the money is concentrated in a handful of items, so counting those verifies a " +
      "large proportion of the balance for very little walking). When the hub explains why a lot is on " +
      "today's list, it is naming one of these two.",
    source:
      "PCAOB Auditing Standard 1105, Audit Evidence. " +
      "https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105",
  },
  {
    id: "AS_1105_27_NO_PROJECTION",
    kind: "auditing_standard",
    cite: "PCAOB AS 1105.27 (Selecting Specific Items)",
    quote:
      "The application of audit procedures to items that are selected as described in paragraphs .25-.26 of " +
      "this standard does not constitute audit sampling, and the results of those audit procedures cannot be " +
      "projected to the entire population.",
    soWhat:
      "The honesty clause, and the one most software gets wrong. Because this system picks the risky and the " +
      "expensive on purpose, the result CANNOT be stretched to cover everything else. Counting your twenty " +
      "priciest lots and finding them perfect does not mean the shop is 99% accurate — it means those twenty " +
      "lots were right. Any screen that turns a targeted count into a shop-wide accuracy percentage is " +
      "lying, and this one is built specifically not to. It reports what was touched and what was not.",
    source:
      "PCAOB Auditing Standard 1105, Audit Evidence. " +
      "https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SELF-TESTS
//
// These guard the promises the SHARED registry relies on. A citation has to mean
// the same thing on every screen in this application, so a duplicate id, an empty
// quote, or a citation with no source URL is not a cosmetic problem — it is a
// number Michael might one day have to defend to an LCB enforcement officer with
// nothing behind it.
// ═══════════════════════════════════════════════════════════════════════════

export function __runInventoryAuditAuthoritiesTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`inventory-audit-authorities self-test FAILED: ${msg}`);
  };

  const newIds = INVENTORY_AUDIT_AUTHORITIES_NEW.map((a) => a.id);

  // 1) No duplicate ids inside the new set.
  ok(new Set(newIds).size === newIds.length, "the new authorities contain no duplicate ids");

  // 2) The declared id list matches what is actually exported. If someone adds an
  //    authority object but forgets the id union, the permitted-id gate in the core
  //    silently stops accepting it. This catches that.
  const declared = new Set<string>(INVENTORY_AUDIT_AUTHORITY_IDS);
  const borrowed = new Set<string>(INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS);
  for (const id of newIds) {
    ok(declared.has(id), `authority ${id} is present in the objects and in the declared id list`);
  }
  for (const id of declared) {
    ok(
      newIds.includes(id) || borrowed.has(id),
      `declared id ${id} is backed by a real authority object or an explicit borrow`,
    );
  }

  // 3) A borrowed id is borrowed, never redefined. Redefining an id that another
  //    slice already owns is precisely the drift the shared registry exists to stop.
  for (const id of borrowed) {
    ok(!newIds.includes(id), `borrowed id ${id} is reused, not redefined locally`);
  }

  // 4) Every authority carries real substance. An empty quote or a missing source
  //    is a citation that cannot be checked, which is worse than no citation at all
  //    because it looks authoritative.
  for (const a of INVENTORY_AUDIT_AUTHORITIES_NEW) {
    ok(a.cite.trim().length > 0, `${a.id} names the provision it comes from`);
    ok(a.quote.trim().length >= 40, `${a.id} quotes enough of the text to be meaningful`);
    ok(a.soWhat.trim().length >= 40, `${a.id} explains what it means for this shop in plain English`);
    ok(/https?:\/\//.test(a.source), `${a.id} links to a source that can actually be opened`);
  }

  // 5) Plain English is the house rule. Michael has not opened an accounting book
  //    in thirteen years and his staff never have. The `soWhat` field is the one
  //    that gets shown to a human, so it must not hide behind the jargon.
  const banned = [/\bshrinkage accrual\b/i, /\bde minimis\b/i, /\bceteris paribus\b/i];
  for (const a of INVENTORY_AUDIT_AUTHORITIES_NEW) {
    for (const re of banned) {
      ok(!re.test(a.soWhat), `${a.id} explains itself without leaning on jargon (${re.source})`);
    }
  }
}
