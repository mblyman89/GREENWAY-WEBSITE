/**
 * tests/compliance/inventory-audit-core.test.ts   (slice books-10)
 *
 * The SECOND gate over the inventory auditor.
 *
 * `inventory-audit-core.ts` carries its own `__runInventoryAuditCoreTests()`,
 * which the pure self-test runner calls. This file re-runs that suite under
 * vitest AND adds assertions that do not exist inside the module.
 *
 * WHY TWO GATES OVER THE SAME CODE
 * A self-test that lives inside the module it tests can be weakened by the very
 * same edit that breaks the module. Delete a branch and its neighbouring
 * assertion and the internal suite still says PASS. The mutation campaign for
 * this slice requires every real mutant to die on BOTH gates; a mutant that dies
 * on only one is a warning that one gate is decorative.
 *
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 *   • SOURCE-LEVEL drift checks that read both the module and migration 0191
 *     from disk, so a future edit that deletes the NULL-is-not-zero comment,
 *     removes a constraint, or backfills the coverage column fails HERE.
 *   • PROPERTY SWEEPS over generated inventories, which catch classes of bug
 *     that hand-written examples miss — most importantly that the lot holding
 *     the most money is class A no matter how the value is distributed.
 *   • CROSS-MODULE parity against the shared authority registry, proving every
 *     citation this slice emits actually resolves.
 *
 * THE STAKES
 * This module decides which physical items a human is told to go and touch, and
 * what happens to the money when the shelf disagrees with the computer. If it
 * silently mis-ranks a lot, the most valuable stock in the building goes
 * uncounted. If it silently averages two disagreeing counts, it invents a
 * quantity nobody ever observed. If it treats "nobody counted this" as "this is
 * empty", it writes off inventory that is sitting on the shelf — which
 * 26 C.F.R. §1.471-2(f)(3) forbids and which an LCB enforcement officer would
 * read as missing product.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ABC_CUTOFF_MILLI_PCT,
  CADENCE_DAYS,
  DEFAULT_MATERIALITY,
  MAX_PERMITTED_CADENCE_DAYS,
  RISK_WEIGHTS,
  assertCadencePolicySound,
  assessLine,
  assessRisk,
  buildAuditPlan,
  buildCountChecklist,
  buildCoverageReport,
  detectLotMergeSignature,
  draftVarianceJournal,
  extendCostCents,
  formatCents,
  groupLotsByProduct,
  permittedAuthorityIds,
  readinessOf,
  resolveAuditAuthorities,
  stratifyLots,
  __runInventoryAuditCoreTests,
  type AuditCountLine,
  type AuditLot,
} from "@/lib/inventory/inventory-audit-core";

import {
  INVENTORY_AUDIT_AUTHORITIES_NEW,
  INVENTORY_AUDIT_AUTHORITY_IDS,
  INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS,
  __runInventoryAuditAuthoritiesTests,
} from "@/lib/inventory/inventory-audit-authorities";

const NOW = new Date("2026-08-19T12:00:00.000Z");

function lot(over: Partial<AuditLot> = {}): AuditLot {
  return {
    lotId: "L1",
    lotCode: "LC-1",
    posProductKey: "P1",
    productName: "Blue Dream 3.5g",
    categorySlug: "flower",
    vendorId: "V1",
    vendorName: "Acme Farms",
    onHandQty: 10,
    unitCostMinorUnits: 1_000,
    lastCountedAt: "2026-08-01T12:00:00.000Z",
    priorVarianceCount: 0,
    status: "active",
    ...over,
  };
}

function line(over: Partial<AuditCountLine> = {}): AuditCountLine {
  return {
    lotId: "L1",
    systemQty: 10,
    countedQty: null,
    recountQty: null,
    reason: null,
    note: null,
    ...over,
  };
}

const moduleSrc = readFileSync(
  join(__dirname, "..", "..", "src", "lib", "inventory", "inventory-audit-core.ts"),
  "utf8",
);
const migrationSrc = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "0191_inventory_audit.sql"),
  "utf8",
);

// ═══════════════════════════════════════════════════════════════════════════
describe("inventory-audit-core — the embedded suites still pass", () => {
  it("the module's own self-tests pass", () => {
    expect(() => __runInventoryAuditCoreTests()).not.toThrow();
  });

  it("the authority self-tests pass", () => {
    expect(() => __runInventoryAuditAuthoritiesTests()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("ABC stratification — the dominant-lot trap, swept as a property", () => {
  /**
   * The bug this sweep exists for: classifying on the cumulative share reached
   * AFTER a lot meant a lot holding 100% of the value scored 100% and was
   * labelled C — the long tail — dropping the most valuable thing in the shop
   * to the slowest cadence. A single hand-written example fixed that once. This
   * sweep proves it for every shape of inventory.
   */
  it("the single most valuable lot is ALWAYS class A, for any value distribution", () => {
    const shapes: number[][] = [
      [100],
      [100, 1],
      [90, 10],
      [80, 20],
      [50, 50],
      [1, 1, 1, 1, 1],
      [1000, 1, 1, 1, 1, 1, 1, 1],
      [5, 4, 3, 2, 1],
      [999_999, 1],
    ];

    for (const shape of shapes) {
      const lots = shape.map((units, i) =>
        lot({ lotId: `L${i}`, posProductKey: `P${i}`, onHandQty: units, unitCostMinorUnits: 100 }),
      );
      const strat = stratifyLots(lots);
      const richest = [...strat]
        .filter((s) => s.extendedCostCents !== null)
        .sort((a, b) => (b.extendedCostCents ?? 0) - (a.extendedCostCents ?? 0))[0];

      expect(
        richest.abc,
        `shape ${JSON.stringify(shape)}: the richest lot must be class A, got ${richest.abc}`,
      ).toBe("A");
    }
  });

  it("an unvalued lot is class U and never silently valued at zero", () => {
    const strat = stratifyLots([
      lot({ lotId: "a", onHandQty: 100, unitCostMinorUnits: 5_000 }),
      lot({ lotId: "u", unitCostMinorUnits: null }),
    ]);
    const u = strat.find((s) => s.lot.lotId === "u")!;
    expect(u.abc).toBe("U");
    expect(u.extendedCostCents).toBeNull();
  });

  it("an unvalued lot is counted at least as often as the most valuable one", () => {
    // An unknown value is not a small value. This is the whole reason U exists.
    expect(CADENCE_DAYS.U).toBeLessThanOrEqual(CADENCE_DAYS.A);
  });

  it("every class is reachable inside a year, as AS 2510.11 requires", () => {
    for (const [cls, days] of Object.entries(CADENCE_DAYS)) {
      expect(days, `${cls} cadence`).toBeLessThanOrEqual(MAX_PERMITTED_CADENCE_DAYS);
    }
    expect(() => assertCadencePolicySound()).not.toThrow();
  });

  it("the cutoffs are ordered and inside 100%", () => {
    expect(ABC_CUTOFF_MILLI_PCT.A).toBeLessThan(ABC_CUTOFF_MILLI_PCT.B);
    expect(ABC_CUTOFF_MILLI_PCT.B).toBeLessThan(100_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// SURVIVORS FROM THE MUTATION CAMPAIGN
//
// Each test below exists because a deliberately introduced defect SURVIVED the
// suite. A survivor is not a curiosity; it is a guarantee nobody was checking.
// ══════════════════════════════════════════════════════════════════════
describe("closed mutation survivors", () => {
  it("stratification is deterministic when two lots are worth exactly the same", () => {
    // SURVIVOR: removing the lotId tie-break let equal-value lots swap places
    // between runs. The same inventory would produce two different count lists,
    // and a report that reshuffles is a report nobody trusts.
    const build = () =>
      stratifyLots([
        lot({ lotId: "zzz", posProductKey: "Z", onHandQty: 10, unitCostMinorUnits: 1_000 }),
        lot({ lotId: "aaa", posProductKey: "A", onHandQty: 10, unitCostMinorUnits: 1_000 }),
        lot({ lotId: "mmm", posProductKey: "M", onHandQty: 10, unitCostMinorUnits: 1_000 }),
      ]).map((x) => x.lot.lotId);

    // Ties must break on lotId, ascending — a stable, explainable order.
    expect(build()).toEqual(["aaa", "mmm", "zzz"]);
    // And it must be the SAME order every time it is asked.
    expect(build()).toEqual(build());
  });

  it("the cadence soundness check actually throws when the policy is unsound", () => {
    // SURVIVOR: neutering the assertion left the "structural guarantee" as a
    // comment. The guarantee is only real if the check can fire, so this proves
    // the checking FUNCTION works rather than trusting the shipped constants.
    // The REAL function is exercised against a broken policy, not a local
    // re-implementation of it. Re-implementing the rule in the test would prove
    // only that the test can do arithmetic.
    expect(
      () => assertCadencePolicySound({ A: 30, B: 60, C: 400, U: 14 }),
      "an over-a-year cadence must be rejected",
    ).toThrow(/exceeds/i);
    expect(() => assertCadencePolicySound({ A: 0 }), "a zero cadence is nonsense").toThrow();
    expect(() => assertCadencePolicySound({ A: 30.5 }), "a fractional cadence is nonsense").toThrow();

    // NEGATIVE CONTROL: a sound custom policy passes, so the guard is selective.
    expect(() => assertCadencePolicySound({ A: 30, B: 60, C: 365, U: 7 })).not.toThrow();
    // The shipped policy must itself be sound, checked by the real function.
    expect(() => assertCadencePolicySound()).not.toThrow();
    for (const days of Object.values(CADENCE_DAYS)) {
      expect(days).toBeLessThanOrEqual(MAX_PERMITTED_CADENCE_DAYS);
    }
  });

  it("a detected lot merge BLOCKS posting — it is never merely advisory", () => {
    // SURVIVOR: downgrading the merge signature from blocker to warning let a
    // session showing the owner's exact historical failure be posted anyway.
    // Detecting the failure and then allowing it is worse than not detecting it,
    // because it looks like the control worked.
    const lots = [
      lot({ lotId: "s1", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s2", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s3", posProductKey: "G", onHandQty: 10 }),
    ];
    const lines = [
      line({ lotId: "s1", systemQty: 10, countedQty: 30 }),
      line({ lotId: "s2", systemQty: 10, countedQty: 0 }),
      line({ lotId: "s3", systemQty: 10, countedQty: 0 }),
    ];

    const r = readinessOf(lots, lines);
    expect(r.mergeSignatures.length, "the pattern must be detected").toBeGreaterThan(0);
    expect(r.canPost, "and detection must STOP the session").toBe(false);
    expect(
      r.blockers.some((b) => /consolidat|package by package|lot/i.test(b)),
      "the blocker must name the lot-consolidation problem",
    ).toBe(true);

    // NEGATIVE CONTROL: without the merge pattern, an otherwise clean session
    // of the same shape posts fine — so the block above is caused by the merge,
    // not by something incidental.
    const cleanLines = [
      line({ lotId: "s1", systemQty: 10, countedQty: 10 }),
      line({ lotId: "s2", systemQty: 10, countedQty: 10 }),
      line({ lotId: "s3", systemQty: 10, countedQty: 10 }),
    ];
    const clean = readinessOf(lots, cleanLines);
    expect(clean.mergeSignatures).toHaveLength(0);
    expect(clean.canPost).toBe(true);
  });
});

describe("money never drifts", () => {
  it("rounds symmetrically so shrink and overage are treated identically", () => {
    for (const q of [0.005, 0.015, 0.125, 1.005, 7.5, 0.333]) {
      expect(extendCostCents(-q, 100)).toBe(-extendCostCents(q, 100));
    }
  });

  it("refuses a non-integer unit cost rather than silently rounding it", () => {
    expect(() => extendCostCents(1, 10.5)).toThrow();
  });

  it("formats cents without losing a penny", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(-1_234_56)).toBe("-$1,234.56");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("THE LOT-CODE TRAP — the failure that is now permanent corpus", () => {
  /**
   * Recorded from the owner: staff read the lot code off the FIRST unit they
   * pulled and wrote it on everything else, collapsing distinct lots into one.
   * Quantities still tied. Traceability was destroyed.
   */
  it("lots of the same product are planned together, never split across sessions", () => {
    const lots = [
      lot({ lotId: "a1", posProductKey: "SAME", lastCountedAt: null }),
      lot({ lotId: "a2", posProductKey: "SAME", lastCountedAt: null }),
      lot({ lotId: "a3", posProductKey: "SAME", lastCountedAt: null }),
    ];
    // A budget of one lot must NOT be allowed to split the family.
    const plan = buildAuditPlan(lots, NOW, { maxLots: 1 });
    const group = plan.groups.find((g) => g.productKey === "SAME");
    expect(group, "the group must be present").toBeTruthy();
    expect(group!.lots).toHaveLength(3);
    expect(plan.budgetOverriddenForCohesion).toBe(true);
  });

  it("a multi-lot group is flagged so the counter is warned", () => {
    const plan = buildAuditPlan(
      [
        lot({ lotId: "m1", posProductKey: "MULTI", lastCountedAt: null }),
        lot({ lotId: "m2", posProductKey: "MULTI", lastCountedAt: null }),
      ],
      NOW,
      { maxLots: 50 },
    );
    const g = plan.groups.find((x) => x.productKey === "MULTI")!;
    expect(g.isMultiLot).toBe(true);
    expect(plan.multiLotGroupCount).toBeGreaterThanOrEqual(1);
  });

  it("a lot with no product key gets its own group and is never merged with another", () => {
    const groups = groupLotsByProduct([
      lot({ lotId: "x", posProductKey: null }),
      lot({ lotId: "y", posProductKey: null }),
    ]);
    // Two keyless lots are two different physical things. They must not collapse.
    expect(groups.size).toBe(2);
  });

  it("the merge signature fires when one lot absorbs its siblings", () => {
    const lots = [
      lot({ lotId: "s1", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s2", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s3", posProductKey: "G", onHandQty: 10 }),
    ];
    const lines = [
      line({ lotId: "s1", systemQty: 10, countedQty: 30 }), // absorbed everything
      line({ lotId: "s2", systemQty: 10, countedQty: 0 }),
      line({ lotId: "s3", systemQty: 10, countedQty: 0 }),
    ];
    const sigs = detectLotMergeSignature(lots, lines);
    expect(sigs.length).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: ordinary sell-through does NOT look like a merge", () => {
    const lots = [
      lot({ lotId: "s1", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s2", posProductKey: "G", onHandQty: 10 }),
    ];
    // Both lots simply sold down. Nothing was absorbed by anything.
    const lines = [
      line({ lotId: "s1", systemQty: 10, countedQty: 8 }),
      line({ lotId: "s2", systemQty: 10, countedQty: 7 }),
    ];
    expect(detectLotMergeSignature(lots, lines)).toHaveLength(0);
  });

  it("NEGATIVE CONTROL: a single-lot product can never produce a merge signature", () => {
    const lots = [lot({ lotId: "solo", posProductKey: "ONLY", onHandQty: 10 })];
    const lines = [line({ lotId: "solo", systemQty: 10, countedQty: 30 })];
    expect(detectLotMergeSignature(lots, lines)).toHaveLength(0);
  });

  it("a merge signature blocks the session rather than merely warning", () => {
    const lots = [
      lot({ lotId: "s1", posProductKey: "G", onHandQty: 10 }),
      lot({ lotId: "s2", posProductKey: "G", onHandQty: 10 }),
    ];
    const lines = [
      line({ lotId: "s1", systemQty: 10, countedQty: 20 }),
      line({ lotId: "s2", systemQty: 10, countedQty: 0 }),
    ];
    const r = readinessOf(lots, lines);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.canPost).toBe(false);
  });

  it("the multi-lot risk signal is weighted near the top of the risk model", () => {
    const weights = Object.values(RISK_WEIGHTS);
    const max = Math.max(...weights);
    // It need not be first, but it must not be a rounding error either.
    expect(RISK_WEIGHTS.multi_lot_product).toBeGreaterThanOrEqual(max * 0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("NULL IS NOT ZERO", () => {
  it("an uncounted line is 'uncounted', never a variance", () => {
    const a = assessLine(lot(), line({ countedQty: null }), DEFAULT_MATERIALITY);
    expect(a.status).toBe("uncounted");
    expect(a.varianceQty ?? 0).toBe(0);
  });

  it("a line counted as zero IS a real variance and is not ignored", () => {
    const a = assessLine(
      lot({ onHandQty: 10, unitCostMinorUnits: 100_000 }),
      line({ systemQty: 10, countedQty: 0 }),
      DEFAULT_MATERIALITY,
    );
    expect(a.status).not.toBe("uncounted");
    expect(a.varianceQty).toBe(-10);
  });

  it("uncounted lots are never treated as empty when the session is judged", () => {
    // §1.471-2(f)(3): omitting stock is not a permitted basis of valuation.
    const lots = [lot({ lotId: "a" }), lot({ lotId: "b", posProductKey: "P2" })];
    const lines = [line({ lotId: "a", countedQty: 10 })]; // "b" never counted
    const r = readinessOf(lots, lines);
    expect(r.canPost).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the recount rule — two disagreeing counts are never averaged", () => {
  it("a material variance demands a recount before it can be accepted", () => {
    const a = assessLine(
      lot({ onHandQty: 100, unitCostMinorUnits: 100_000 }),
      line({ systemQty: 100, countedQty: 50, reason: "shrink", note: "checked twice" }),
      DEFAULT_MATERIALITY,
    );
    expect(["needs_recount", "material"]).toContain(a.status);
  });

  it("when the two counts disagree the system refuses to pick a number", () => {
    const a = assessLine(
      lot({ onHandQty: 100, unitCostMinorUnits: 100_000 }),
      line({ systemQty: 100, countedQty: 50, recountQty: 60, reason: "shrink", note: "n" }),
      DEFAULT_MATERIALITY,
    );
    expect(a.status).toBe("recount_disagrees");
    // The average would be 55 — a quantity nobody ever observed. The system must
    // not invent it, and must not quietly pick one of the two either.
    expect(a.effectiveCountedQty).not.toBe(55);
    expect(a.blocksPosting, "a disagreement must stop the session, not be noted").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("gross variance is reported, not just net (the D8 lesson)", () => {
  it("two offsetting errors do not read as a clean session", () => {
    const lots = [
      lot({ lotId: "a", posProductKey: "PA", onHandQty: 10, unitCostMinorUnits: 10_000 }),
      lot({ lotId: "b", posProductKey: "PB", onHandQty: 10, unitCostMinorUnits: 10_000 }),
    ];
    const lines = [
      line({ lotId: "a", systemQty: 10, countedQty: 15 }), // +5
      line({ lotId: "b", systemQty: 10, countedQty: 5 }),  // -5
    ];
    const r = readinessOf(lots, lines);
    expect(r.netVarianceCents).toBe(0);
    // Net zero, gross emphatically not zero. A system that reported only the net
    // would teach the owner that two offsetting mistakes are the same as none.
    expect(r.grossVarianceCents).not.toBeNull();
    expect(Math.abs(r.grossVarianceCents ?? 0)).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the draft journal never posts itself", () => {
  const ACCTS = { inventoryAccountCode: "20140", cogsAccountCode: "60140" };

  it("is always a draft, whatever the numbers say", () => {
    for (const varianceCents of [-1_000_000, -500, 0, 500, 1_000_000]) {
      const d = draftVarianceJournal({
        ...ACCTS,
        varianceCents,
        documented: true,
        reason: "breakage",
        lotLabel: "Blue Dream 3.5g",
      });
      expect(d.disposition, `variance ${varianceCents}`).toBe("draft");
      expect(d.entity).toBe("greenway");
      expect(d.sourceKind).toBe("inventory");
    }
  });

  it("an undocumented shrink is escalated to the owner, never auto-classified", () => {
    const d = draftVarianceJournal({
      ...ACCTS,
      varianceCents: -600_000,
      documented: false,
      reason: null,
      lotLabel: "Blue Dream 3.5g",
    });
    // WAC 314-55-089(4)(c) makes an unexplained disappearance a DEEMED SALE at
    // 37%. A machine must not quietly decide that on the owner's behalf.
    expect(d.treatment).toBe("owner_must_decide");
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("routine DOCUMENTED shrink is allowed to draft to COGS", () => {
    // The negative control for the test above: if everything escalated, the
    // escalation would carry no information.
    const d = draftVarianceJournal({
      ...ACCTS,
      varianceCents: -500,
      documented: true,
      reason: "breakage",
      lotLabel: "Blue Dream 3.5g",
    });
    expect(d.treatment).toBe("cogs");
  });

  it("the drafted lines balance — debits equal credits", () => {
    for (const varianceCents of [-250_000, -1, 1, 250_000]) {
      const d = draftVarianceJournal({
        ...ACCTS,
        varianceCents,
        documented: true,
        reason: "breakage",
        lotLabel: "Blue Dream 3.5g",
      });
      const sum = d.lines.reduce((acc, l) => acc + l.amountCents, 0);
      expect(sum, `a journal that does not balance is not a journal (${varianceCents})`).toBe(0);
      expect(d.balanced).toBe(true);
      expect(d.totalDebitCents).toBe(d.totalCreditCents);
    }
  });

  it("a zero variance produces no journal at all", () => {
    const d = draftVarianceJournal({
      ...ACCTS,
      varianceCents: 0,
      documented: true,
      reason: null,
      lotLabel: "Blue Dream 3.5g",
    });
    expect(d.lines).toHaveLength(0);
    expect(d.balanced).toBe(true);
  });

  it("refuses a fractional cent rather than silently rounding it", () => {
    expect(() =>
      draftVarianceJournal({
        ...ACCTS,
        varianceCents: 10.5,
        documented: true,
        reason: "breakage",
        lotLabel: "x",
      }),
    ).toThrow();
  });

  it("THE SIGN WALL: a shortage credits inventory and debits COGS", () => {
    // Positive amount_cents means DEBIT in this codebase. Product that vanished
    // must REDUCE the asset, so the inventory line must be negative (a credit).
    const d = draftVarianceJournal({
      ...ACCTS,
      varianceCents: -100_000,
      documented: true,
      reason: "breakage",
      lotLabel: "Blue Dream 3.5g",
    });
    const inv = d.lines.find((l) => l.accountCode === ACCTS.inventoryAccountCode)!;
    expect(inv, "the inventory line must exist").toBeTruthy();
    expect(inv.amountCents, "a shortage must CREDIT (reduce) inventory").toBeLessThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the staff count sheet is written for humans who are not accountants", () => {
  it("uses no accounting jargon", () => {
    const plan = buildAuditPlan(
      [
        lot({ lotId: "c1", posProductKey: "CK", lastCountedAt: null }),
        lot({ lotId: "c2", posProductKey: "CK", lastCountedAt: null }),
      ],
      NOW,
      { maxLots: 20 },
    );
    const steps = buildCountChecklist(plan.groups[0]);
    const text = steps.map((s) => `${s.title} ${s.detail}`).join(" ").toLowerCase();

    for (const banned of [
      "materiality",
      "variance",
      "stratification",
      "abc class",
      "shrinkage accrual",
      "gaap",
      "journal entry",
      "debit",
      "credit",
      "§280e",
      "pcaob",
    ]) {
      expect(text, `staff sheet must not say "${banned}"`).not.toContain(banned);
    }
  });

  it("warns loudly when a product has more than one lot", () => {
    const plan = buildAuditPlan(
      [
        lot({ lotId: "c1", posProductKey: "CK", lastCountedAt: null }),
        lot({ lotId: "c2", posProductKey: "CK", lastCountedAt: null }),
      ],
      NOW,
      { maxLots: 20 },
    );
    const steps = buildCountChecklist(plan.groups[0]);
    const text = steps.map((s) => `${s.title} ${s.detail}`).join(" ").toLowerCase();
    expect(text).toMatch(/different batch|each package|one at a time|do not read one label/);
  });

  it("teaches the difference between zero and blank, because it is load-bearing", () => {
    const plan = buildAuditPlan([lot({ lotId: "z", lastCountedAt: null })], NOW, { maxLots: 20 });
    const steps = buildCountChecklist(plan.groups[0]);
    const text = steps.map((s) => `${s.title} ${s.detail}`).join(" ").toLowerCase();
    expect(text).toMatch(/blank|empty|zero/);
  });

  it("every step is numbered and none is empty", () => {
    const plan = buildAuditPlan([lot({ lotId: "z", lastCountedAt: null })], NOW, { maxLots: 20 });
    const steps = buildCountChecklist(plan.groups[0]);
    expect(steps.length).toBeGreaterThan(0);
    steps.forEach((s, i) => {
      expect(s.n).toBe(i + 1);
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.detail.trim().length).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("coverage is honest — AS 1105.27", () => {
  it("never asserts the shop IS accurate", () => {
    const reports = [
      buildCoverageReport([lot({ lotId: "a", lastCountedAt: "2026-08-01T12:00:00.000Z" })], NOW),
      buildCoverageReport([lot({ lotId: "b", lastCountedAt: null })], NOW),
      buildCoverageReport([], NOW),
    ];
    for (const r of reports) {
      expect(r.verdict).not.toMatch(/\b(?:is|are|was|were)\s+accurate\b/i);
      expect(r.verdict).not.toMatch(/\baccuracy\s+(?:rate|score|percentage|level)\b/i);
      expect(r.verdict).not.toMatch(/\d+(?:\.\d+)?%\s+accurate/i);
    }
  });

  it("a never-counted lot breaks the annual standard and is named", () => {
    const r = buildCoverageReport([lot({ lotId: "never", lastCountedAt: null })], NOW);
    expect(r.meetsAnnualStandard).toBe(false);
    expect(r.neverCounted).toBe(1);
    expect(r.staleLotIds).toContain("never");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("authorities resolve and cannot drift", () => {
  it("every id this slice can emit resolves to a real authority", () => {
    const ids = permittedAuthorityIds();
    expect(ids.length).toBeGreaterThan(0);
    const resolved = resolveAuditAuthorities(ids);
    expect(resolved).toHaveLength(ids.length);
    for (const a of resolved) {
      expect(a.cite.trim().length).toBeGreaterThan(0);
      expect(a.quote.trim().length).toBeGreaterThan(0);
      // `source` is a provenance string. Some entries name an eCFR snapshot
      // rather than a bare URL, which is MORE precise, not less — so this asserts
      // substance, not shape.
      expect(a.source.trim().length).toBeGreaterThan(10);
    }
  });

  it("the risk reasons emitted by the planner are all describable in plain English", () => {
    const risks = assessRisk(
      [
        lot({ lotId: "r1", posProductKey: "RP", lastCountedAt: null, priorVarianceCount: 3 }),
        lot({ lotId: "r2", posProductKey: "RP", unitCostMinorUnits: null }),
      ],
      NOW,
    );
    expect(risks.length).toBe(2);
    for (const r of risks) {
      for (const reason of r.reasons) {
        expect(RISK_WEIGHTS[reason], `weight for ${reason}`).toBeGreaterThan(0);
      }
    }
  });

  it("a borrowed authority is reused by id and never redefined locally", () => {
    const newIds = new Set(INVENTORY_AUDIT_AUTHORITIES_NEW.map((a) => a.id));
    for (const borrowed of INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS) {
      expect(newIds.has(borrowed), `${borrowed} must not be redefined`).toBe(false);
    }
  });

  it("the declared id list and the authority objects agree in both directions", () => {
    const declared = new Set<string>(INVENTORY_AUDIT_AUTHORITY_IDS);
    const borrowed = new Set<string>(INVENTORY_AUDIT_BORROWED_AUTHORITY_IDS);
    for (const a of INVENTORY_AUDIT_AUTHORITIES_NEW) expect(declared.has(a.id)).toBe(true);
    const newIds = new Set(INVENTORY_AUDIT_AUTHORITIES_NEW.map((a) => a.id));
    for (const id of declared) expect(newIds.has(id) || borrowed.has(id)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SOURCE DRIFT GUARDS — a future edit cannot silently weaken this slice", () => {
  it("the module still documents the lot-code trap it was built around", () => {
    expect(moduleSrc).toMatch(/lot[- ]code/i);
    expect(moduleSrc.toLowerCase()).toContain("null");
  });

  it("the cadence policy is still asserted at module load, not merely defined", () => {
    // If this call is deleted, an unreachable cadence could ship silently.
    expect(moduleSrc).toMatch(/assertCadencePolicySound\(\)\s*;/);
  });

  it("the draft disposition is still hard-coded, never computed from a condition", () => {
    expect(moduleSrc).toMatch(/disposition:\s*"draft"/);
    expect(moduleSrc).not.toMatch(/disposition:\s*\w+\s*\?\s*"draft"/);
  });

  it("migration 0191 still stores NULL rather than defaulting the count to zero", () => {
    // `counted_qty numeric,` with no DEFAULT 0 is the whole promise.
    expect(migrationSrc).toMatch(/counted_qty\s+numeric\s*,/);
    expect(migrationSrc).not.toMatch(/counted_qty\s+numeric[^,]*default\s+0/i);
  });

  it("migration 0191 still refuses a negative physical count", () => {
    expect(migrationSrc).toContain("inventory_audit_lines_counted_nonneg_ck");
    expect(migrationSrc).toContain("inventory_audit_lines_recount_nonneg_ck");
  });

  it("migration 0191 still requires a recount to follow a first count", () => {
    expect(migrationSrc).toContain("inventory_audit_lines_recount_order_ck");
  });

  it("migration 0191 still requires an approved session to name its approver", () => {
    expect(migrationSrc).toContain("inventory_audit_sessions_approval_ck");
  });

  it("migration 0191 never backfills the coverage column", () => {
    // Backfilling last_counted_at would tell an auditor that thousands of lots
    // were verified on a day nobody counted anything.
    expect(migrationSrc).not.toMatch(/update\s+public\.inventory_lots\s+set\s+last_counted_at/i);
    expect(migrationSrc).not.toMatch(/last_counted_at\s+timestamptz\s+not\s+null\s+default/i);
  });

  it("migration 0191 keeps the decision tables owner-only and the count sheet staff-writable", () => {
    expect(migrationSrc).toContain("inventory_audit_sessions_owner_all");
    expect(migrationSrc).toContain("inventory_audit_history_owner_all");
    expect(migrationSrc).toContain("inventory_audit_lines_staff_all");
  });

  it("migration 0191 still refuses to run out of order", () => {
    expect(migrationSrc).toContain("MIGRATION_OUT_OF_ORDER");
  });

  it("migration 0191 still ships a gate check the owner can run", () => {
    expect(migrationSrc).toContain("inventory_audit_gate_check");
  });
});
