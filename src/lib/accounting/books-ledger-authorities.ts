/**
 * src/lib/accounting/books-ledger-authorities.ts   (slice books-08)
 *
 * THE PRIMARY SOURCES INTRODUCED BY THE LEDGER / CHART SLICE.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY THAT IS NOT FUSSINESS
 * ---------------------------------------------------------------------------
 * These authorities have to be merged into the ONE shared registry in
 * books-guidance-core, because a citation must mean the same thing on every
 * screen — that single-registry rule is the whole reason that module exists.
 *
 * But books-ledger-guidance-core needs to CALL back into books-guidance-core
 * (`findGuidanceAuthority`) to check that the ids it cites still resolve. If
 * the authorities lived in that same file, the two modules would import each
 * other at runtime, and `GUIDANCE_AUTHORITIES` is built by an IIFE that runs at
 * module-evaluation time. A circular import around an eagerly-evaluated
 * top-level constant is the kind of thing that works on every machine until it
 * doesn't, and then fails as `undefined is not iterable` in production with no
 * useful stack.
 *
 * So the data lives HERE, in a leaf module that imports nothing at runtime (the
 * one import below is `import type`, which TypeScript erases entirely). Both
 * modules import from this file; neither imports the other. No cycle exists to
 * reason about.
 *
 * EVERY QUOTE BELOW WAS FETCHED FROM ITS PRIMARY SOURCE DURING THIS SLICE and
 * extracted from that text mechanically, never from memory:
 *   - 26 CFR §1.471-2  : eCFR XML API, title-26, 2026-01-01 snapshot
 *   - 26 CFR §1.446-1  : eCFR XML API, title-26, 2026-01-01 snapshot
 *   - 26 CFR §1.6001-1 : eCFR XML API, title-26, 2026-01-01 snapshot
 */

import type { GuidanceAuthority } from "./books-guidance-core";

export const LEDGER_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  {
    id: "REG_1_471_2_D_VERIFY_BY_COUNT",
    kind: "regulation",
    cite: "26 C.F.R. §1.471-2(d)",
    quote:
      "Where the taxpayer maintains book inventories in accordance with a sound accounting system in which " +
      "the respective inventory accounts are charged with the actual cost of the goods purchased or produced " +
      "and credited with the value of goods used, transferred, or sold, calculated upon the basis of the actual " +
      "cost of the goods acquired during the taxable year (including the inventory at the beginning of the year), " +
      "the net value as shown by such inventory accounts will be deemed to be the cost of the goods on hand. " +
      "The balances shown by such book inventories should be verified by physical inventories at reasonable " +
      "intervals and adjusted to conform therewith.",
    soWhat:
      "This is the rule that makes a negative inventory balance a real problem rather than an untidy one. The " +
      "regulation lets the number in your inventory account BE your cost of goods on hand — but only if that " +
      "account is charged with real purchases, credited with real sales, and checked against an actual count. " +
      "Your Sage books carried eight inventory accounts with impossible credit balances. Under this rule those " +
      "balances stop being deemed to be anything, and cost of goods sold becomes whatever an examiner decides " +
      "it is — which in a §280E business is the number that matters most.",
    source: "eCFR, title 26, §1.471-2, 2026-01-01 snapshot (ecfr.gov API)",
  },
  {
    id: "REG_1_446_1_A_4_II_CAPITAL_VS_EXPENSE",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(a)(4)(ii)",
    quote:
      "Expenditures made during the year shall be properly classified as between capital and expense. For " +
      "example, expenditures for such items as plant and equipment, which have a useful life extending " +
      "substantially beyond the taxable year, shall be charged to a capital account and not to an expense account.",
    soWhat:
      "This is the chart of accounts stated as law. Choosing an account is not filing — it IS the classification " +
      "the regulation requires you to make. Putting a new display case in Repairs instead of Equipment is not a " +
      "tidiness problem: it takes a deduction this year that belongs spread over several. It is also the easiest " +
      "mistake in the world to make when you are picking from a list of 183 accounts at eleven at night.",
    source: "eCFR, title 26, §1.446-1, 2026-01-01 snapshot (ecfr.gov API)",
  },
  {
    id: "REG_1_6001_1_A_PERMANENT_BOOKS",
    kind: "regulation",
    cite: "26 C.F.R. §1.6001-1(a)",
    quote:
      "any person subject to tax under subtitle A of the Code (including a qualified State individual income tax " +
      "which is treated pursuant to section 6361(a) as if it were imposed by chapter 1 of subtitle A), or any " +
      "person required to file a return of information with respect to income, shall keep such permanent books " +
      "of account or records, including inventories, as are sufficient to establish the amount of gross income, " +
      "deductions, credits, or other matters required to be shown by such person in any return of such tax or " +
      "information.",
    soWhat:
      "The word doing the work here is SUFFICIENT. The law does not ask whether you kept books; it asks whether " +
      "what you kept establishes the numbers on your return. That is the standard this general ledger is built " +
      "to meet — every figure on a return traceable back through the ledger to a document. When you click an " +
      "account on the trial balance and land on the lines behind it, that is this test being satisfied in real time.",
    source: "eCFR, title 26, §1.6001-1, 2026-01-01 snapshot (ecfr.gov API)",
  },
];
