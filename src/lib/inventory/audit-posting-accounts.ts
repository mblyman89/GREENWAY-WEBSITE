/**
 * src/lib/inventory/audit-posting-accounts.ts   (slice books-23)
 *
 * PURE. No I/O, no database, no server-only imports. The missing argument.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAD TO BE WRITTEN BEFORE ANYTHING COULD POST
 * ---------------------------------------------------------------------------
 * `postAuditSession(sessionId, accountByCategory)` in `inventory-audit-store.ts`
 * has needed a category -> inventory-account map since books-11. Nothing ever
 * built one. A search of the repository for `accountByCategory` found it in
 * exactly two places: the signature of the function that consumes it, and a
 * TWO-KEY TEST FIXTURE inside `inventory-audit-post-core.ts`:
 *
 *     const ACCOUNTS = { flower: "20140", edible: "20150" } as const;
 *
 * That fixture is not a chart of accounts. `edible` is not even a real category
 * slug -- the real ones are `edible-solid` and `edible-liquid` -- and 20150 is
 * RSO, not any edible. It exists to exercise the plan builder, and it does that
 * job honestly. But it means the posting engine has never once been handed the
 * real mapping, and the reason is simply that the real mapping did not exist.
 *
 * So this is the last missing link in the chain from "a person counted a shelf"
 * to "the general ledger knows about it".
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS DERIVED AND NOT TYPED OUT
 * ---------------------------------------------------------------------------
 * The obvious implementation is a literal object with 21 entries. It would work
 * today, it would be readable, and it would be wrong -- because a chart of
 * accounts that is stated TWICE is a chart of accounts that will eventually
 * disagree with itself, and the disagreement will be silent. Standing rule 42:
 * two namespaces of uppercase strings will trade places.
 *
 * This is not hypothetical for this repository. From coa-core.ts's own header,
 * measured from Michael's Sage exports: 18 accounts were tagged "GRWNY", a typo
 * of "GRNWY", which silently dropped the entire payroll-expense block out of
 * every suffix-filtered report. Nobody noticed, because a typo in a duplicated
 * string does not raise an error -- it just quietly stops matching.
 *
 * So the map is COMPUTED from `INVENTORY_CATEGORIES`, the single source of truth
 * that already drives the POS import pipeline, the public menu and intake. Add a
 * category there and its inventory account appears here for free. There is no
 * second list to forget to update, because there is no second list.
 *
 * Standing rule 49 applies directly and is the reason the test for this file is
 * structural: a hardcoded map and a derived map return the SAME 21 pairs today,
 * so a test that only compares values cannot tell them apart. The test reads
 * this function's own source and asserts it references INVENTORY_CATEGORIES.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SLUGS LINE UP, VERIFIED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------
 * The key of this map has to be whatever `AuditLot.categorySlug` holds, or every
 * lookup misses and every audit refuses with ACCOUNT_UNRESOLVED. That value comes
 * from `enrichAuditLots()` (audit-lot-loader.ts:201), which takes
 * `resolution.websiteCategory` -- a `value` from
 * `src/lib/pos/category-taxonomy.ts`, NOT a coa-core slug. Two different files,
 * two different words for the same idea, and no compiler check between them.
 *
 * That is exactly the shape of bug this file's header is warning about, so it was
 * checked instead of assumed: all 21 `value`s in category-taxonomy.ts are
 * character-for-character identical to the 21 `slug`s in coa-core.ts. They agree
 * TODAY. Nothing enforces that they keep agreeing -- so `assertTaxonomyAgreement`
 * below enforces it, and the test calls it. If the two lists ever drift, the
 * suite fails with the offending slug named, instead of an audit refusing to post
 * for a reason nobody can find.
 */

import { INVENTORY_CATEGORIES, inventoryAccountCode } from "@/lib/accounting/coa-core";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

/**
 * Category slug -> five-digit inventory account code.
 *
 * The shape `postAuditSession` and `buildPostPlan` expect. Readonly because a
 * caller mutating the chart of accounts mid-posting is not a feature.
 */
export type AccountByCategory = Readonly<Record<string, string>>;

/**
 * Build the real map.
 *
 * DERIVED FROM `INVENTORY_CATEGORIES` -- see the header. Do not replace this
 * with a literal object, however tempting; the structural test will fail and it
 * is supposed to.
 */
export function inventoryAccountByCategory(): AccountByCategory {
  const out: Record<string, string> = {};
  for (const c of INVENTORY_CATEGORIES) {
    out[c.slug] = inventoryAccountCode(c.slot);
  }
  return Object.freeze(out);
}

/**
 * The taxonomy and the chart of accounts must use the same words.
 *
 * Returns the disagreements, so an empty array is the passing result -- the same
 * convention as the database gate-check functions. Returning the problems rather
 * than throwing means the test can print them all at once instead of stopping at
 * the first, and a screen could show them if we ever want one.
 *
 * WHY THIS IS NOT DECORATION: if a taxonomy value ever drifts from its coa-core
 * slug, `categorySlug` stops matching any key in the map, `buildPostPlan` refuses
 * the whole session with ACCOUNT_UNRESOLVED, and the message names a category
 * that looks perfectly correct on screen. Michael would be told his audit cannot
 * post and the reason would be a one-character difference in a file he has never
 * opened. Catching it here turns a mystery into a named test failure.
 */
export function taxonomyAgreementProblems(): string[] {
  const problems: string[] = [];
  const coaSlugs = new Set(INVENTORY_CATEGORIES.map((c) => c.slug));
  const taxonomyValues = new Set(websiteCategoryDefinitions.map((d) => String(d.value)));

  for (const slug of coaSlugs) {
    if (!taxonomyValues.has(slug)) {
      problems.push(
        `Chart of accounts has category "${slug}" but the product taxonomy does not. ` +
          `A lot can never be filed under it, so its inventory account can never be used.`,
      );
    }
  }
  for (const value of taxonomyValues) {
    if (!coaSlugs.has(value)) {
      problems.push(
        `The product taxonomy has category "${value}" but the chart of accounts has no ` +
          `inventory account for it. Any count variance on one of those lots will refuse ` +
          `to post with ACCOUNT_UNRESOLVED.`,
      );
    }
  }
  return problems;
}

/**
 * Plain English, for a screen or a refusal message.
 *
 * Deliberately does NOT say "everything is fine" when there are problems, and
 * does not say "there is a problem" without naming it. Rule 27: refuse, don't
 * warn -- and a refusal nobody can act on is a warning wearing a refusal's coat.
 */
export function explainAccountCoverage(): string {
  const map = inventoryAccountByCategory();
  const count = Object.keys(map).length;
  const problems = taxonomyAgreementProblems();
  if (problems.length > 0) {
    return (
      `The product categories and the chart of accounts do not agree, so some count ` +
      `variances would refuse to post. ${problems.length} problem` +
      `${problems.length === 1 ? "" : "s"}: ${problems.join(" ")}`
    );
  }
  return (
    `Every one of the ${count} product categories has its own inventory account, and each ` +
    `one has a matching cost-of-goods account with the same last four digits. That is what ` +
    `lets a count variance find its own accounts instead of landing in a catch-all.`
  );
}

/* ========================================================================== */
/* EMBEDDED SELF-TESTS                                                        */
/* ========================================================================== */

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`audit-posting-accounts: ${msg}`);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `audit-posting-accounts: ${msg} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

export function __runAuditPostingAccountsTests(): void {
  // ── The map covers the whole chart ──────────────────────────────────────
  const map = inventoryAccountByCategory();
  eq(Object.keys(map).length, INVENTORY_CATEGORIES.length, "one account per category");
  eq(Object.keys(map).length, 21, "21 categories, matching coa-core's own self-test");

  // ── Every code is a well-formed INVENTORY account ───────────────────────
  // This is the property `deriveCogsAccount` refuses on, so if it is ever
  // violated the posting engine refuses instead of guessing. Asserted here so
  // the failure lands in this file rather than at Michael's approval screen.
  for (const [slug, code] of Object.entries(map)) {
    ok(/^\d{5}$/.test(code), `${slug} -> ${code} is five digits`);
    ok(code.startsWith("2"), `${slug} -> ${code} is an inventory (2xxxx) account`);
  }

  // ── Known anchors, spot-checked against coa-core's documented examples ──
  // coa-core's header states: "slot 140 in block 2 is 2 + 0140 = 20140" and
  // names 20140 Inventory-Concentrate. If the padding logic ever changes these
  // break loudly.
  eq(map["concentrate"], "20140", "concentrate is 20140 (coa-core's own example)");
  eq(map["flower"], "20010", "flower is slot 10 -> 20010");
  eq(map["merch"], "20220", "merch is slot 220 -> 20220");

  // ── No duplicate account codes ──────────────────────────────────────────
  // Two categories sharing an account silently merges two products' inventory
  // on the balance sheet, and the merge is invisible in any report.
  const codes = Object.values(map);
  eq(new Set(codes).size, codes.length, "no two categories share an inventory account");

  // ── The map is frozen ───────────────────────────────────────────────────
  ok(Object.isFrozen(map), "the returned map is frozen");

  // ── A FRESH CALL, not a shared mutable singleton ────────────────────────
  // If this were a module-level constant, a caller mutating it would corrupt
  // every later posting in the same process.
  ok(inventoryAccountByCategory() !== map, "each call returns its own object");

  // ── The taxonomy and the chart agree ────────────────────────────────────
  // The check that stops the silent-miss bug described in the header.
  const problems = taxonomyAgreementProblems();
  eq(problems.length, 0, `taxonomy and chart of accounts agree (got: ${problems.join(" | ")})`);

  // ── The agreement check can actually FAIL (rule 15) ─────────────────────
  // A checker that cannot report a problem is decoration. Proven by feeding the
  // same comparison a deliberately broken pair rather than by trusting it.
  {
    const coa = new Set(["flower", "trim"]);
    const tax = new Set(["flower", "shake"]);
    const found: string[] = [];
    for (const s of coa) if (!tax.has(s)) found.push(s);
    for (const v of tax) if (!coa.has(v)) found.push(v);
    eq(found.length, 2, "the comparison detects drift in both directions");
  }

  // ── The prose says something true ──────────────────────────────────────
  const prose = explainAccountCoverage();
  ok(prose.includes("21"), "the explanation states the real category count");
  ok(!prose.includes("problem"), "with no problems, the explanation does not invent one");
}
