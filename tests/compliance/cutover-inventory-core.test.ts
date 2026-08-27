/**
 * tests/compliance/cutover-inventory-core.test.ts   (slice books-72)
 *
 * The SECOND gate over the cut-over inventory opening-balance builder.
 * `cutover-inventory-core.ts` carries its own `__runCutoverInventoryCoreTests()`,
 * which the pure self-test runner calls; this file re-runs that suite under
 * vitest AND adds assertions that cannot live inside the module.
 *
 * WHY TWO GATES OVER THE SAME CODE
 * A self-test that lives inside the module it tests can be weakened by the same
 * edit that breaks the module. The mutation campaign for this slice requires
 * every real mutant to die on BOTH gates; a mutant that dies only in one is a
 * warning that one gate is decorative.
 *
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 *   • CROSS-MODULE parity against the real chart of accounts (coa-core) and
 *     against vendor-bill-core's copy of the same slot table. The module
 *     hard-codes its table for purity; this proves the codes it emits are the
 *     ones actually seeded by migration 0173.
 *   • PARITY WITH THE REAL POS CATEGORY MAP (pos/transform.ts CATEGORY_MAP),
 *     which books-71 measured as covering 52 of 52 of Michael's real Cultivera
 *     categories. Every slug that map can produce must resolve to an account
 *     here, or a real product would be dropped on cut-over night.
 *   • SOURCE-LEVEL drift checks that read the file from disk, so a future edit
 *     that flips the credit to accounts payable, re-labels the entry as a
 *     purchase, or deletes the reasoning comments fails HERE.
 *   • The DATABASE CONTRACT from migration 0176, asserted against the real SQL
 *     text: no zero lines, evidence_kind in the allowed list, evidence_ref
 *     length, and never the parent account 20000.
 *   • The two guards that are unreachable through the public input surface
 *     (CONTROL_ACCOUNT_EMITTED, UNBALANCED) — reached by mutating a plan
 *     directly, so rule 43 is satisfied by execution rather than by comment.
 *   • Property-style sweeps over generated counts.
 *
 * THE STAKES
 * This entry is the FOUNDATION. Every §280E cost-of-goods number for the rest
 * of Michael's life on this platform is measured from the opening inventory
 * balance this builder produces. If it credits accounts payable instead of
 * equity, his liabilities are overstated by the entire value of his shelf, his
 * equity understated by the same amount, AND THE TRIAL BALANCE STILL BALANCES.
 * Every report renders. Nothing looks wrong. That is the class of error this
 * file exists to make impossible.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  __runCutoverInventoryCoreTests,
  buildCutoverInventoryPlan,
  cutoverAccountForSlug,
  cutoverPlanIsBalanced,
  describeCutoverPlan,
  findCutoverLineSetDefect,
  extendLotCents,
  CUTOVER_CATEGORY_SLOTS,
  OPENING_BALANCE_EQUITY_CODE,
  INVENTORY_CONTROL_CODE,
  type CutoverLot,
  type CutoverPlan,
  type CutoverLine,
} from "../../src/lib/accounting/cutover-inventory-core";

import { INVENTORY_CATEGORIES } from "../../src/lib/accounting/coa-core";
import { CATEGORY_SLOTS } from "../../src/lib/accounting/vendor-bill-core";

const REPO_ROOT = join(__dirname, "..", "..");
const MODULE_PATH = join(REPO_ROOT, "src/lib/accounting/cutover-inventory-core.ts");
const MODULE_SRC = readFileSync(MODULE_PATH, "utf8");

/** A lot with sensible defaults, overridable per test. */
function lot(over: Partial<CutoverLot> = {}): CutoverLot {
  return {
    id: over.id ?? "1",
    category: over.category ?? "Flower",
    categorySlug: over.categorySlug === undefined ? "flower" : over.categorySlug,
    costCents: over.costCents ?? 500,
    quantity: over.quantity ?? 2,
    barcode: over.barcode,
    productName: over.productName,
  };
}

function build(lots: readonly CutoverLot[]) {
  return buildCutoverInventoryPlan({
    entityCode: "greenway",
    asOfDate: "2026-10-31",
    evidenceRef: "Cultivera INVENTORIES export 2026-10-31",
    lots,
  });
}

describe("cutover-inventory-core :: the module's own self-tests", () => {
  it("passes its embedded suite under vitest as well as under the runner", () => {
    expect(() => __runCutoverInventoryCoreTests()).not.toThrow();
  });
});

describe("cutover-inventory-core :: parity with the real chart of accounts", () => {
  it("mirrors coa-core.INVENTORY_CATEGORIES exactly, slug and slot", () => {
    // The module duplicates the slot table to stay a pure leaf. Duplication is
    // only safe if drift FAILS, so this is the test that makes it safe.
    const mine = CUTOVER_CATEGORY_SLOTS.map((c) => `${c.slug}:${c.slot}`).join("|");
    const real = INVENTORY_CATEGORIES.map((c) => `${c.slug}:${c.slot}`).join("|");
    expect(mine).toBe(real);
  });

  it("mirrors vendor-bill-core.CATEGORY_SLOTS exactly", () => {
    // Both modules keep their own copy. If one is edited and the other is not,
    // a vendor bill and the cut-over would file the same product in different
    // accounts, and inventory would never tie out again.
    const mine = CUTOVER_CATEGORY_SLOTS.map((c) => `${c.slug}:${c.slot}`).join("|");
    const theirs = CATEGORY_SLOTS.map((c) => `${c.slug}:${c.slot}`).join("|");
    expect(mine).toBe(theirs);
  });

  it("emits only account codes that migration 0173 actually seeds", () => {
    const sql = readFileSync(
      join(REPO_ROOT, "supabase/migrations/0173_chart_of_accounts.sql"),
      "utf8",
    );
    for (const c of CUTOVER_CATEGORY_SLOTS) {
      const code = cutoverAccountForSlug(c.slug);
      expect(code, `slug ${c.slug} must resolve`).not.toBeNull();
      // The seed call is gl_upsert_account('20010','Inventory — Flower',...)
      expect(sql.includes(`'${code}','Inventory`), `${code} seeded in 0173`).toBe(true);
    }
  });

  it("credits an account that 0173 seeds as equity, so 0176 cannot refuse it", () => {
    const sql = readFileSync(
      join(REPO_ROOT, "supabase/migrations/0173_chart_of_accounts.sql"),
      "utf8",
    );
    // GL_OB_NOT_BALANCE_SHEET refuses income/expense/cogs. Equity is legal.
    expect(
      sql.includes(`'${OPENING_BALANCE_EQUITY_CODE}','Opening Balance Equity','equity'`),
    ).toBe(true);
  });

  it("never resolves any slug to the parent account 20000", () => {
    // 0176 GL_OB_PARENT_ACCOUNT refuses an account that has children, and 20000
    // is the parent of every 200xx inventory account.
    for (const c of CUTOVER_CATEGORY_SLOTS) {
      expect(cutoverAccountForSlug(c.slug)).not.toBe(INVENTORY_CONTROL_CODE);
    }
  });
});

describe("cutover-inventory-core :: parity with the real POS category map", () => {
  it("resolves every slug the live CATEGORY_MAP can produce", () => {
    // books-71 measured pos/transform.ts CATEGORY_MAP against Michael's real
    // export: 52 of 52 categories covered, 100.00% of value, $0 quarantine.
    // That map is what will feed this builder, so every slug it can emit MUST
    // land in an inventory account here. A gap means a real product on a real
    // shelf silently dropped on cut-over night.
    const src = readFileSync(join(REPO_ROOT, "src/lib/pos/transform.ts"), "utf8");
    const block = /const CATEGORY_MAP: Record<string, GreenwayCategory> = \{([\S\s]*?)\n\};/.exec(
      src,
    );
    expect(block, "CATEGORY_MAP must still be findable in pos/transform.ts").not.toBeNull();
    if (block === null) return;

    // Values are the right-hand side of each `"key": "value",` pair.
    const slugs = new Set<string>();
    const pair = /:\s*"([a-z0-9-]+)"/g;
    let m: RegExpExecArray | null = pair.exec(block[1]);
    while (m !== null) {
      slugs.add(m[1]);
      m = pair.exec(block[1]);
    }

    // MEASURED 2026-08-27, not assumed: the map has 53 source keys and produces
    // 12 DISTINCT target slugs. Pinned exactly rather than as a loose ">10"
    // threshold, because a loose threshold would still pass if the regex broke
    // and matched only a handful. Rule 89: a count change is stated, not absorbed.
    expect(slugs.size).toBe(12);

    const unresolved = [...slugs].filter((s) => cutoverAccountForSlug(s) === null);
    expect(unresolved, `these POS slugs have no inventory account: ${unresolved.join(", ")}`)
      .toEqual([]);
  });

  it("records that the POS map reaches only 12 of the 21 inventory accounts", () => {
    // THIS IS NOT A BUG IN THIS MODULE, it is a documented open question (D-50).
    // The live CATEGORY_MAP collapses four specific product kinds into less
    // specific accounts than the chart of accounts provides:
    //     RSO           -> concentrate        (20140, not 20150)
    //     Tincture      -> edible-liquid      (20170, not 20180)
    //     Infused Blunt -> infused-preroll    (20080, not 20100)
    //     Blunt         -> preroll            (20050, not 20070)
    // books-71 measured the value affected at $6,900.07. Michael has been asked
    // which he wants and has not yet answered, so NOTHING IS INVENTED HERE
    // (rule 1). The builder can already file all 21 accounts correctly; it is
    // the upstream map that does not distinguish them.
    //
    // This test exists so that when Michael answers and the map gains the four
    // finer slugs, the count changes and this test FAILS, forcing the change to
    // be acknowledged rather than absorbed silently.
    const src = readFileSync(join(REPO_ROOT, "src/lib/pos/transform.ts"), "utf8");
    const block = /const CATEGORY_MAP: Record<string, GreenwayCategory> = \{([\S\s]*?)\n\};/.exec(
      src,
    );
    expect(block).not.toBeNull();
    if (block === null) return;

    const keys = new Set<string>();
    const slugs = new Set<string>();
    const pair = /"([^"]+)":\s*"([a-z0-9-]+)"/g;
    let m: RegExpExecArray | null = pair.exec(block[1]);
    while (m !== null) {
      keys.add(m[1]);
      slugs.add(m[2]);
      m = pair.exec(block[1]);
    }

    expect(keys.size).toBe(53);
    expect(slugs.size).toBe(12);

    // The nine accounts the map cannot currently reach, measured.
    const reachable = new Set([...slugs]);
    const unreachable = CUTOVER_CATEGORY_SLOTS.map((c) => c.slug).filter(
      (s) => !reachable.has(s),
    );
    expect(unreachable.sort()).toEqual(
      [
        "accessories",
        "blunt",
        "infused-blunt",
        "infused-preroll-pack",
        "merch",
        "paraphernalia",
        "preroll-pack",
        "rso",
        "tincture",
      ].sort(),
    );
  });
});

describe("cutover-inventory-core :: the classification that matters", () => {
  it("credits Opening Balance Equity, exactly once, for the full total", () => {
    const p = build([lot({ costCents: 1234, quantity: 7 })]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const equity = p.lines.filter((l) => l.accountCode === OPENING_BALANCE_EQUITY_CODE);
    expect(equity).toHaveLength(1);
    expect(equity[0].amountCents).toBe(-(1234 * 7));
    expect(p.totalInventoryCents).toBe(1234 * 7);
  });

  it("NEVER credits accounts payable — nobody is owed for the cut-over shelf", () => {
    // THE defect this slice exists to prevent. Booking the cut-over as a
    // purchase would state that Michael owes his vendors the entire value of
    // his shelf, money he already paid, and the trial balance would still
    // balance. Swept over many shapes so no input can produce 30000.
    for (let n = 1; n <= 40; n++) {
      const lots = Array.from({ length: n }, (_, i) =>
        lot({
          id: `L${i}`,
          costCents: 101 + i * 7,
          quantity: 1 + (i % 5),
          categorySlug: CUTOVER_CATEGORY_SLOTS[i % CUTOVER_CATEGORY_SLOTS.length].slug,
        }),
      );
      const p = build(lots);
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(p.lines.some((l) => l.accountCode === "30000")).toBe(false);
      expect(p.sourceKind).toBe("opening_balance");
    }
  });

  it("labels itself as an opening balance backed by a physical count", () => {
    const p = build([lot()]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.sourceKind).toBe("opening_balance");
    expect(p.evidenceKind).toBe("inventory_count");
  });
});

describe("cutover-inventory-core :: the database contract from 0176", () => {
  const OB_SQL = readFileSync(
    join(REPO_ROOT, "supabase/migrations/0176_opening_balances.sql"),
    "utf8",
  );

  it("uses an evidence_kind the table's CHECK constraint actually allows", () => {
    const p = build([lot()]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(OB_SQL.includes(`'${p.evidenceKind}'`)).toBe(true);
  });

  it("still faces a >= 3 character evidence_ref rule, and satisfies it", () => {
    expect(OB_SQL.includes("length(btrim(evidence_ref)) >= 3")).toBe(true);
    const p = build([lot()]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.evidenceRef.trim().length).toBeGreaterThanOrEqual(3);
  });

  it("never emits a zero amount, which the table rejects outright", () => {
    expect(OB_SQL.includes("check (amount_cents <> 0)")).toBe(true);
    // Mix of good lots and lots that must be dropped rather than zeroed.
    const p = build([
      lot({ id: "a", costCents: 500, quantity: 1 }),
      lot({ id: "z1", costCents: 0, quantity: 9 }),
      lot({ id: "z2", costCents: 900, quantity: 0 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const l of p.lines) expect(l.amountCents).not.toBe(0);
  });

  it("emits only leaf inventory accounts, never the parent 0176 would refuse", () => {
    expect(OB_SQL.includes("GL_OB_PARENT_ACCOUNT")).toBe(true);
    const lots = CUTOVER_CATEGORY_SLOTS.map((c, i) =>
      lot({ id: `s${i}`, categorySlug: c.slug, costCents: 100 + i, quantity: 1 }),
    );
    const p = build(lots);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.lines.some((l) => l.accountCode === INVENTORY_CONTROL_CODE)).toBe(false);
    // 21 category accounts plus the single equity credit.
    expect(p.lines).toHaveLength(22);
  });
});

describe("cutover-inventory-core :: reaching the structural guards (rule 43)", () => {
  // A MUTATION CAMPAIGN FOUND THESE TESTS MISSING. Deleting the builder's
  // internal balance assertion, and deleting its control-account loop, killed
  // no test at all — because neither can be reached through the builder's input
  // surface. Under rule 43 that made them decoration. The logic now lives in
  // findCutoverLineSetDefect, which takes a line set directly, so the guards can
  // be handed exactly the hostile input a future bad edit would produce.
  const line = (accountCode: string, amountCents: number): CutoverLine => ({
    accountCode,
    amountCents,
    lotCount: 1,
    description: "test line",
  });

  it("passes a sound, balanced, leaf-account line set", () => {
    expect(findCutoverLineSetDefect([])).toBeNull();
    expect(
      findCutoverLineSetDefect([line("20010", 500), line("40400", -500)]),
    ).toBeNull();
  });

  it("catches the control account 20000, which 0176 would refuse", () => {
    const d = findCutoverLineSetDefect([
      line(INVENTORY_CONTROL_CODE, 500),
      line("40400", -500),
    ]);
    expect(d).not.toBeNull();
    expect(d?.code).toBe("CONTROL_ACCOUNT_EMITTED");
    // The message must name the constraint, so whoever reads it can look it up.
    expect(d?.message).toContain("GL_OB_PARENT_ACCOUNT");
  });

  it("catches an imbalance as small as one cent", () => {
    const d = findCutoverLineSetDefect([line("20010", 500), line("40400", -499)]);
    expect(d).not.toBeNull();
    expect(d?.code).toBe("UNBALANCED");
  });

  it("reports the control account even when the set balances", () => {
    // A heading account is the more specific fault, so it takes precedence.
    const d = findCutoverLineSetDefect([
      line(INVENTORY_CONTROL_CODE, 500),
      line("40400", -500),
    ]);
    expect(d?.code).toBe("CONTROL_ACCOUNT_EMITTED");
  });

  it("is a real sum, not a hard-coded null", () => {
    // If the body were replaced with `return null`, the cases above that expect
    // null would still pass. These cannot.
    expect(findCutoverLineSetDefect([line("20010", 1)])).not.toBeNull();
    expect(findCutoverLineSetDefect([line("20010", -1)])).not.toBeNull();
    expect(findCutoverLineSetDefect([line("20010", 500), line("40400", -501)]))
      .not.toBeNull();
  });

  it("is actually called by the builder, not merely exported", () => {
    // The guard being correct is worthless if the builder stopped calling it.
    expect(MODULE_SRC).toContain("const defect = findCutoverLineSetDefect(lines);");
    expect(MODULE_SRC).toContain("return { ok: false, code: defect.code, message: defect.message };");
  });

  it("cutoverPlanIsBalanced detects a plan whose lines were tampered with", () => {
    const p = build([lot({ costCents: 500, quantity: 2 })]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(cutoverPlanIsBalanced(p)).toBe(true);

    const tampered: CutoverPlan = {
      ...p,
      lines: p.lines.map((l, i) => (i === 0 ? { ...l, amountCents: l.amountCents + 1 } : l)),
    };
    expect(cutoverPlanIsBalanced(tampered)).toBe(false);
  });

  it("the balance check is a real sum, not a hard-coded true", () => {
    const p = build([lot()]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const emptied: CutoverPlan = { ...p, lines: [{ ...p.lines[0], amountCents: 1 }] };
    expect(cutoverPlanIsBalanced(emptied)).toBe(false);
  });
});

describe("cutover-inventory-core :: measured facts from Michael's real export", () => {
  it("does NOT collapse lots that share a barcode (41 real cases)", () => {
    // books-71: Barcode is not unique — 41 barcodes span multiple rows. Keying
    // on barcode would collapse them and silently lose value.
    const p = build([
      lot({ id: "26614", barcode: "13033113612615061", costCents: 166, quantity: 12 }),
      lot({ id: "25323", barcode: "13033113612615061", costCents: 166, quantity: 9 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.lotsIncluded).toBe(2);
    expect(p.totalInventoryCents).toBe(166 * 21);
  });

  it("keeps both cost layers when one barcode has two costs (6 real cases)", () => {
    const p = build([
      lot({ id: "a", barcode: "same", costCents: 100, quantity: 1 }),
      lot({ id: "b", barcode: "same", costCents: 175, quantity: 1 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalInventoryCents).toBe(275);
  });

  it("values a shelf the size of Michael's without losing a cent", () => {
    // 3,917 lots summing to a known total, built so the expected value is
    // computed independently of the builder.
    const lots: CutoverLot[] = [];
    let expected = 0;
    for (let i = 0; i < 3917; i++) {
      const costCents = 100 + (i % 977);
      const quantity = 1 + (i % 13);
      expected += costCents * quantity;
      lots.push(
        lot({
          id: `R${i}`,
          costCents,
          quantity,
          categorySlug: CUTOVER_CATEGORY_SLOTS[i % CUTOVER_CATEGORY_SLOTS.length].slug,
        }),
      );
    }
    const p = build(lots);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalInventoryCents).toBe(expected);
    expect(p.lotsIncluded).toBe(3917);
    expect(p.dropped).toHaveLength(0);
    expect(cutoverPlanIsBalanced(p)).toBe(true);
  });
});

describe("cutover-inventory-core :: drops are named, never silent", () => {
  it("reports every dropped lot with a reason and a readable sentence", () => {
    const p = build([
      lot({ id: "keep", costCents: 500, quantity: 1 }),
      lot({ id: "d1", categorySlug: null, category: "Mystery", productName: "Odd Thing" }),
      lot({ id: "d2", costCents: 0 }),
      lot({ id: "d3", quantity: 0 }),
      lot({ id: "d4", quantity: 1.5 }),
      lot({ id: "d5", costCents: 10.5 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.dropped).toHaveLength(5);
    expect(p.lotsIncluded).toBe(1);
    expect(p.totalInventoryCents).toBe(500);
    for (const d of p.dropped) {
      expect(d.message.length).toBeGreaterThan(30);
      expect(d.id).toBeTruthy();
    }
    // The unresolved lot is named by product, so Michael can find it.
    const unresolved = p.dropped.find((d) => d.reason === "unresolved_category");
    expect(unresolved?.message).toContain("Odd Thing");
    expect(unresolved?.message).toContain("Mystery");
  });

  it("does not quarantine an unclassified lot into 20890", () => {
    // A mid-year vendor bill can be quarantined and cleaned up later. The
    // cut-over is the foundation every later number is measured from, so an
    // unclassified lot is a question to answer BEFORE posting.
    const p = build([
      lot({ id: "ok", costCents: 100, quantity: 1 }),
      lot({ id: "huh", categorySlug: null, category: "Unknown" }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.lines.some((l) => l.accountCode === "20890")).toBe(false);
  });

  it("drops a negative cost instead of netting it against a good lot", () => {
    const p = build([
      lot({ id: "good", costCents: 1000, quantity: 1 }),
      lot({ id: "bad", costCents: -1000, quantity: 1 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalInventoryCents).toBe(1000);
    expect(p.dropped).toHaveLength(1);
  });

  it("counts the drops rather than absorbing them (rule 89)", () => {
    const p = build([
      lot({ id: "a", costCents: 100, quantity: 1 }),
      lot({ id: "b", costCents: 200, quantity: 1 }),
      lot({ id: "c", categorySlug: null }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // lotsIncluded + dropped must account for EVERY input lot.
    expect(p.lotsIncluded + p.dropped.length).toBe(3);
  });
});

describe("cutover-inventory-core :: refusals", () => {
  it("refuses a non-greenway entity, because the accounts are greenway-only", () => {
    for (const entityCode of ["atm", "landholding", "personal"] as const) {
      const r = buildCutoverInventoryPlan({
        entityCode,
        asOfDate: "2026-10-31",
        evidenceRef: "count",
        lots: [lot()],
      });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe("NOT_GREENWAY");
      expect(r.message).toContain(entityCode);
    }
  });

  it("refuses an empty count", () => {
    const r = build([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NO_LOTS");
  });

  it("refuses when every lot was dropped", () => {
    const r = build([lot({ categorySlug: null }), lot({ id: "2", costCents: 0 })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOTHING_LEFT_AFTER_DROPS");
  });

  it("refuses a total too large to hold exactly, rather than approximating money", () => {
    const r = build([
      lot({ id: "a", categorySlug: "flower", costCents: 4503599627370496, quantity: 1 }),
      lot({ id: "b", categorySlug: "preroll", costCents: 4503599627370496, quantity: 1 }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("TOTAL_OUT_OF_EXACT_RANGE");
  });

  it("drops a lot whose extension leaves exact range, naming it", () => {
    const p = build([
      lot({ id: "keep", costCents: 500, quantity: 1 }),
      lot({ id: "huge", costCents: Number.MAX_SAFE_INTEGER, quantity: 2 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalInventoryCents).toBe(500);
    expect(p.dropped[0].reason).toBe("extended_value_too_large");
  });

  it("returns a refusal object rather than throwing, for every bad input", () => {
    // A caller cannot accidentally post a partial cut-over.
    const cases: CutoverLot[][] = [
      [],
      [lot({ categorySlug: null })],
      [lot({ costCents: Number.NaN })],
      [lot({ quantity: Number.NaN })],
      [lot({ costCents: Number.POSITIVE_INFINITY })],
      [lot({ quantity: Number.POSITIVE_INFINITY })],
    ];
    for (const lots of cases) {
      expect(() => build(lots)).not.toThrow();
      const r = build(lots);
      if (!r.ok) expect(typeof r.message).toBe("string");
    }
  });
});

describe("cutover-inventory-core :: arithmetic", () => {
  it("extends with exact integer multiplication, no rounding at all", () => {
    expect(extendLotCents(667, 3)).toBe(2001);
    expect(extendLotCents(1, 1)).toBe(1);
    expect(extendLotCents(0, 5)).toBe(0);
    // The classic float trap: 0.1 * 3 !== 0.3. Cents cannot hit it.
    expect(extendLotCents(10, 3)).toBe(30);
  });

  it("rolls same-category lots into one line and remembers the lot count", () => {
    const p = build([
      lot({ id: "1", costCents: 100, quantity: 1 }),
      lot({ id: "2", costCents: 200, quantity: 1 }),
      lot({ id: "3", costCents: 300, quantity: 1 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0].amountCents).toBe(600);
    expect(p.lines[0].lotCount).toBe(3);
  });

  it("orders lines by account code so two runs are byte-identical", () => {
    const forward = build([
      lot({ id: "1", categorySlug: "merch", costCents: 100, quantity: 1 }),
      lot({ id: "2", categorySlug: "flower", costCents: 100, quantity: 1 }),
      lot({ id: "3", categorySlug: "concentrate", costCents: 100, quantity: 1 }),
    ]);
    const reversed = build([
      lot({ id: "3", categorySlug: "concentrate", costCents: 100, quantity: 1 }),
      lot({ id: "2", categorySlug: "flower", costCents: 100, quantity: 1 }),
      lot({ id: "1", categorySlug: "merch", costCents: 100, quantity: 1 }),
    ]);
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(forward.lines.map((l) => l.accountCode)).toEqual(
      reversed.lines.map((l) => l.accountCode),
    );
    expect(forward.lines.map((l) => l.accountCode)).toEqual([
      "20010",
      "20140",
      "20220",
      "40400",
    ]);
  });

  it("balances to exactly zero for every generated count", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const lots = Array.from({ length: (seed % 17) + 1 }, (_, i) =>
        lot({
          id: `${seed}-${i}`,
          costCents: 1 + ((seed * 31 + i * 17) % 5000),
          quantity: 1 + ((seed + i) % 9),
          categorySlug: CUTOVER_CATEGORY_SLOTS[(seed + i) % CUTOVER_CATEGORY_SLOTS.length].slug,
        }),
      );
      const p = build(lots);
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      let sum = 0;
      for (const l of p.lines) sum += l.amountCents;
      expect(sum).toBe(0);
      expect(cutoverPlanIsBalanced(p)).toBe(true);
    }
  });

  it("keeps debits positive and the single credit negative", () => {
    const p = build([
      lot({ id: "1", categorySlug: "flower", costCents: 100, quantity: 3 }),
      lot({ id: "2", categorySlug: "trim", costCents: 200, quantity: 2 }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const l of p.lines) {
      if (l.accountCode === OPENING_BALANCE_EQUITY_CODE) expect(l.amountCents).toBeLessThan(0);
      else expect(l.amountCents).toBeGreaterThan(0);
    }
  });
});

describe("cutover-inventory-core :: the owner-facing sentence", () => {
  it("states the money, names the credit, and explains why it is equity", () => {
    const p = build([lot({ costCents: 1000, quantity: 2 })]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const s = describeCutoverPlan(p);
    expect(s).toContain("$20.00");
    expect(s).toContain("Opening Balance Equity");
    expect(s).toContain("already paid for");
  });

  it("admits the drops instead of quietly reporting a clean load", () => {
    const p = build([
      lot({ id: "ok", costCents: 100, quantity: 1 }),
      lot({ id: "no", categorySlug: null }),
    ]);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(describeCutoverPlan(p)).toContain("set aside");
  });

  it("uses singular and plural correctly, because Michael reads this", () => {
    const one = build([lot({ costCents: 100, quantity: 1 })]);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const s = describeCutoverPlan(one);
    expect(s).toContain("1 account");
    expect(s).toContain("1 lot,");
    expect(s).not.toContain("1 accounts");
    expect(s).not.toContain("1 lots");
  });
});

describe("cutover-inventory-core :: source-level drift guards", () => {
  it("still credits 40400 and never mentions accounts payable as a target", () => {
    expect(MODULE_SRC).toContain('OPENING_BALANCE_EQUITY_CODE = "40400"');
    // 30000 may appear in prose and in the self-test that forbids it, but must
    // never be pushed as a line's accountCode.
    expect(/accountCode:\s*"30000"/.test(MODULE_SRC)).toBe(false);
    expect(/accountCode:\s*"20000"/.test(MODULE_SRC)).toBe(false);
  });

  it("still classifies the entry as an opening balance, not a purchase", () => {
    expect(MODULE_SRC).toContain('sourceKind: "opening_balance"');
    expect(/sourceKind:\s*"purchase"/.test(MODULE_SRC)).toBe(false);
  });

  it("keeps Michael's own words about what the cost includes", () => {
    // Rule: the reason a decision was made lives next to the code, verbatim.
    expect(MODULE_SRC).toContain("The cost from Cultivera is the invoice cost");
    expect(MODULE_SRC).toContain("all inclusive cost for that product");
  });

  it("keeps the explanation of why this is equity rather than a purchase", () => {
    expect(MODULE_SRC).toContain("NO VENDOR IS OWED ANYTHING FOR IT");
    expect(MODULE_SRC).toContain("TRIAL BALANCE WOULD STILL BALANCE");
  });

  it("keeps the measured ground truth about barcodes not being unique", () => {
    expect(MODULE_SRC).toContain("`Barcode` is NOT unique");
    expect(MODULE_SRC).toContain("keys on `Id`");
  });

  it("performs no I/O — it is a pure leaf with no imports", () => {
    // The census records this module as unreachable on purpose. If it grows a
    // Supabase import, that claim becomes false and this test says so.
    expect(/^\s*import\s/m.test(MODULE_SRC)).toBe(false);
    expect(MODULE_SRC).not.toContain("supabase");
    expect(MODULE_SRC).not.toContain("createClient");
    expect(MODULE_SRC).not.toContain("fetch(");
  });

  it("uses Number.isSafeInteger, not the weaker Number.isInteger", () => {
    // Number.isInteger(1e300) is true. Money must stay in the exact range.
    expect(MODULE_SRC).toContain("Number.isSafeInteger(n)");
    expect(MODULE_SRC).not.toContain("Number.isInteger(n)");
  });
});
