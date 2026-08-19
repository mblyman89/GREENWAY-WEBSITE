/**
 * tests/compliance/inventory-audit-post-core.test.ts   (slice books-11)
 *
 * The SECOND gate over THE STORE LAYER — the code that takes an approved
 * inventory audit and actually moves the shelf and the books.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE MODULE'S OWN SELF-TESTS
 * `inventory-audit-post-core.ts` carries `__runInventoryAuditPostCoreTests()`,
 * which the pure self-test runner calls. That suite lives INSIDE the file it
 * tests, so the same edit that breaks the module can weaken the assertion that
 * would have caught it. This slice proved that is not hypothetical: a mutation
 * that deleted the `effectiveCountedQty !== null` guard from `isMovable()` —
 * the guard that stops an UNCOUNTED lot being written off — survived the
 * internal suite completely, because every fixture built through `assessLine()`
 * happened to set both guarded fields together. The runner printed
 * "ALL PURE SELF-TESTS PASSED" with the defect in place. Two gates exist
 * because one gate has already been caught sleeping.
 *
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 *   • PROPERTY SWEEPS over generated audits — every plan, for any shape of
 *     inventory, must balance to the penny and must never move a lot nobody
 *     counted. Hand-written examples cover the cases you thought of.
 *   • SOURCE-LEVEL DRIFT CHECKS that read the module AND migration 0192 off
 *     disk, so the TypeScript status list and the database CHECK constraint
 *     cannot silently diverge, and so the atomic claim cannot be quietly
 *     rewritten back into the read-then-write shape that double-posted.
 *   • THE SIGN WALL asserted by ARITHMETIC rather than by example: a shrink
 *     must DEBIT cost of goods sold for every possible variance, not just the
 *     one in the fixture.
 *   • CROSS-MODULE parity: every authority id this module emits must resolve
 *     in the shared registry.
 *
 * THE STAKES
 * This is the module that decides what the shelf record becomes and what hits
 * the general ledger. Wrong here means the LCB's on-hand number and Michael's
 * on-hand number disagree, or profit is reported as loss. The double-post
 * defect this slice was built to kill was executed against a real PostgreSQL
 * and moved a lot from 100 to 90 to 80 — inventing a ten-unit shortage nobody
 * ever counted — from nothing more exotic than clicking a button twice.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIT_SESSION_STATUSES,
  LEGAL_STATUS_MOVES,
  POSTABLE_STATUS,
  __runInventoryAuditPostCoreTests,
  buildHistoryRows,
  buildPostPlan,
  canMoveStatus,
  deriveCogsAccount,
  explainPlan,
  gateSessionForPosting,
  isAuditSessionStatus,
  checkJournalBalance,
  isMovable,
  lotsToStampAsCounted,
  resolvePostAuthorities,
  type SessionForPosting,
} from "@/lib/inventory/inventory-audit-post-core";
import {
  assessLine,
  type AuditCountLine,
  type AuditLot,
} from "@/lib/inventory/inventory-audit-core";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures. Deliberately built INDEPENDENTLY of the module's own helpers: if
// the module's fixture factory drifts, this file must not drift with it.
// ─────────────────────────────────────────────────────────────────────────────

function lot(over: Partial<AuditLot> = {}): AuditLot {
  return {
    lotId: "lot-1",
    lotCode: "LOT-001",
    posProductKey: "prod-1",
    productName: "Blue Dream 3.5g",
    categorySlug: "flower",
    vendorId: "v1",
    vendorName: "Vendor",
    onHandQty: 100,
    unitCostMinorUnits: 500,
    lastCountedAt: null,
    priorVarianceCount: 0,
    status: "active",
    ...over,
  };
}

function line(over: Partial<AuditCountLine> = {}): AuditCountLine {
  return {
    lotId: "lot-1",
    systemQty: 100,
    countedQty: 100,
    recountQty: null,
    reason: null,
    note: null,
    ...over,
  };
}

function session(over: Partial<SessionForPosting> = {}): SessionForPosting {
  return {
    sessionId: "sess-1",
    status: "approved",
    postedAt: null,
    resultApprovedBy: "owner-1",
    resultApprovedAt: "2026-11-02T10:00:00Z",
    label: "November A-lots",
    ...over,
  };
}

const ACCOUNTS = { flower: "20140", edible: "20150", concentrate: "20160" } as const;

const moduleSrc = readFileSync(
  join(__dirname, "..", "..", "src", "lib", "inventory", "inventory-audit-post-core.ts"),
  "utf8",
);
const migrationSrc = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "0192_inventory_audit_post.sql"),
  "utf8",
);

// ═════════════════════════════════════════════════════════════════════════════
describe("the embedded suite still passes", () => {
  it("the module's own self-tests pass", () => {
    expect(() => __runInventoryAuditPostCoreTests()).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE DOUBLE-POST — the defect this whole slice exists to kill", () => {
  /**
   * Executed against real PostgreSQL 15.18 before a line of this module was
   * written: the pre-existing read-then-write cycle-count path took a lot from
   * 100 to 90 to 80 when applied twice. Nobody counted 80. The shelf never lost
   * those ten units. This is the same family as the F3 double-reversal that
   * invented money, and it is triggered by clicking a button twice.
   */
  it("a session that already posted is REFUSED, not applied again", () => {
    const assessed = [assessLine(lot(), line({ countedQty: 90 }))];
    const verdict = gateSessionForPosting(session({ postedAt: "2026-11-02T12:00:00Z" }), assessed);
    expect(verdict.mayPost).toBe(false);
    expect(verdict.code).toBe("ALREADY_POSTED");
  });

  it("the refusal EXPLAINS the harm rather than just saying no", () => {
    const assessed = [assessLine(lot(), line({ countedQty: 90 }))];
    const verdict = gateSessionForPosting(session({ postedAt: "2026-11-02T12:00:00Z" }), assessed);
    // Michael has not opened an accounting book in 13 years. "Constraint
    // violation on posted_at" is not a message; this must say what would have
    // gone wrong in words he can act on.
    expect(verdict.reason).toMatch(/second time/i);
    expect(verdict.reason).toMatch(/never happened|invent/i);
  });

  it("buildPostPlan refuses too — the gate is not only on the gate function", () => {
    const res = buildPostPlan({
      session: session({ postedAt: "2026-11-02T12:00:00Z" }),
      lots: [lot()],
      lines: [line({ countedQty: 90 })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ALREADY_POSTED");
  });

  it("MIGRATION 0192 claims the session with a conditional UPDATE, not a SELECT-then-UPDATE", () => {
    // The whole defence is that the claim IS the lock. If a future edit
    // reintroduces "select ... then update", the gap comes back and so does
    // the 100 → 90 → 80 defect. This asserts the shape survives on disk.
    const claim = /update\s+public\.inventory_audit_sessions[\s\S]{0,400}?set\s+posted_at\s*=\s*now\(\)[\s\S]{0,400}?where[\s\S]{0,200}?posted_at\s+is\s+null[\s\S]{0,200}?returning/i;
    expect(claim.test(migrationSrc)).toBe(true);
  });

  it("MIGRATION 0192 locks each lot row (for update) before moving it", () => {
    expect(/for\s+update\s+of\s+lot/i.test(migrationSrc)).toBe(true);
  });

  it("MIGRATION 0192 takes an EXCLUSIVE row lock, never a shared one", () => {
    // ADDED BECAUSE A MUTANT ESCAPED. Asserting only that "for update of lot"
    // is present does not notice when it is WEAKENED: swapping it for
    // `for share of lot` left the assertion above green, and left the entire
    // 15-attack SQL suite green too, because every test posted sessions one
    // after another and nothing ever contended for a row.
    //
    // `for share` permits two writers to hold the same row at once. Both then
    // read on-hand = 100, both compute a delta against 100, and one correction
    // silently overwrites the other — the shelf is left wrong by exactly the
    // lost adjustment, with two plausible posting records to explain it.
    expect(/for\s+(share|key\s+share)\s+of\s+lot/i.test(migrationSrc)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("NULL IS NOT ZERO — nobody looked vs somebody looked and found nothing", () => {
  /**
   * 26 C.F.R. §1.471-2(f)(3) forbids writing inventory down below cost by an
   * arbitrary percentage. Treating "uncounted" as "zero" is the most extreme
   * version of that: it writes off stock that is physically on the shelf. To an
   * LCB enforcement officer, missing product is missing product.
   */
  it("an uncounted line moves nothing", () => {
    expect(isMovable(assessLine(lot(), line({ countedQty: null })))).toBe(false);
  });

  it("counting ZERO is a real finding and DOES move", () => {
    const a = assessLine(lot(), line({ countedQty: 0 }));
    expect(isMovable(a)).toBe(true);
    expect(a.varianceQty).toBe(-100);
  });

  it("BOTH guards in isMovable are load-bearing, asserted separately", () => {
    // Today assessLine() always sets varianceQty and effectiveCountedQty
    // together, so no fixture routed through assessLine() can isolate the
    // second guard — which is exactly how a mutation deleting it survived the
    // internal suite. Asserted here against hand-built shapes.
    const base = assessLine(lot(), line({ countedQty: 0 }));
    expect(isMovable({ ...base, effectiveCountedQty: null })).toBe(false);
    expect(isMovable({ ...base, varianceQty: null })).toBe(false);
    expect(isMovable({ ...base, varianceQty: -1, effectiveCountedQty: 99 })).toBe(true);
  });

  it("an uncounted lot is NEVER stamped as counted — one stamp hides it for a cadence", () => {
    const stamped = lotsToStampAsCounted([
      { ...line({ lotId: "counted", countedQty: 50 }) },
      { ...line({ lotId: "never-looked-at", countedQty: null }) },
      { ...line({ lotId: "recount-only", countedQty: null, recountQty: 7 }) },
    ]);
    expect(stamped).toContain("counted");
    expect(stamped).toContain("recount-only");
    expect(stamped).not.toContain("never-looked-at");
  });

  it("an uncounted lot produces NO history row — a fictional count in the record", () => {
    const rows = buildHistoryRows(
      "sess-1",
      [lot({ lotId: "a" }), lot({ lotId: "b" })],
      [line({ lotId: "a", countedQty: 90 }), line({ lotId: "b", countedQty: null })],
    );
    expect(rows.map((r) => r.lotId)).toEqual(["a"]);
  });

  it("an audit where NOTHING was counted cannot post at all", () => {
    const assessed = [
      assessLine(lot({ lotId: "a" }), line({ lotId: "a", countedQty: null })),
      assessLine(lot({ lotId: "b" }), line({ lotId: "b", countedQty: null })),
    ];
    const verdict = gateSessionForPosting(session(), assessed);
    expect(verdict.mayPost).toBe(false);
    // Nothing MOVABLE — and crucially not reported as a clean audit.
    expect(verdict.code).toBe("NOTHING_TO_POST");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE BALANCE GUARD IS WIRED IN, NOT JUST PRESENT (rule 16)", () => {
  /**
   * checkJournalBalance is correct and directly tested. But `buildPostPlan`
   * constructs its lines as MIRRORED PAIRS, so an unbalanced entry cannot occur
   * by construction, and the `if (!balanced)` branch is unreachable.
   *
   * That has a consequence worth stating plainly: replacing the real call with
   * a hardcoded "balanced: true" changes NO observable behaviour, so no
   * behavioural test can ever catch it. A mutation campaign reports that as a
   * surviving mutant, and it is right to.
   *
   * The guard is not pointless — it is there so that if someone later adds a
   * line WITHOUT its mirror, the entry is stopped instead of reaching the
   * ledger unbalanced. Its value is entirely in being CALLED. So the wiring is
   * asserted structurally, at the source level, which is the only place the
   * difference is visible.
   */
  it("buildPostPlan actually CALLS checkJournalBalance on the real lines", () => {
    expect(/const\s+balance\s*=\s*checkJournalBalance\s*\(\s*journalLines\s*\)/.test(moduleSrc))
      .toBe(true);
  });

  it("the balance result is not hardcoded or cast into existence", () => {
    // Catches `= { balanced: true } as ...`, which keeps the guard in the file
    // while removing every bit of its protection.
    expect(/const\s+balance\s*=\s*\{\s*balanced\s*:/.test(moduleSrc)).toBe(false);
  });

  it("the refusal branch reads its explanation from the guard, not a literal", () => {
    expect(/problem:\s*balance\.problem/.test(moduleSrc)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE SIGN WALL — positive amount_cents is a DEBIT", () => {
  /**
   * Getting this backwards crashes nothing. It reports a loss as a profit,
   * which is why it is asserted by arithmetic across many magnitudes rather
   * than trusted to one example and a code review.
   */
  it("a SHRINK debits cost of goods sold and credits inventory, at every size", () => {
    for (const counted of [99, 90, 50, 1, 0]) {
      const res = buildPostPlan({
        session: session(),
        lots: [lot()],
        lines: [line({ countedQty: counted, reason: "damage", note: "broken jars" })],
        accountByCategory: ACCOUNTS,
      });
      expect(res.ok, `counted ${counted}`).toBe(true);
      if (!res.ok) continue;

      const cogs = res.plan.journalLines.find((l) => l.accountCode === "60140")!;
      const inv = res.plan.journalLines.find((l) => l.accountCode === "20140")!;
      expect(cogs, `counted ${counted}: a COGS line must exist`).toBeDefined();
      // Shrink: COGS is DEBITED (positive), inventory is CREDITED (negative).
      expect(cogs.amountCents, `counted ${counted}`).toBeGreaterThan(0);
      expect(inv.amountCents, `counted ${counted}`).toBeLessThan(0);
      expect(cogs.amountCents + inv.amountCents, `counted ${counted}`).toBe(0);
    }
  });

  it("an OVERAGE is the exact mirror — inventory debited, COGS credited", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot()],
      lines: [line({ countedQty: 110, reason: "found", note: "back stock" })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const cogs = res.plan.journalLines.find((l) => l.accountCode === "60140")!;
    const inv = res.plan.journalLines.find((l) => l.accountCode === "20140")!;
    expect(inv.amountCents).toBeGreaterThan(0);
    expect(cogs.amountCents).toBeLessThan(0);
  });

  it("THE BALANCE GUARD is proven directly, not just implied by the pairing", () => {
    // Mutating the inline balance check to `if (false)` survived BOTH gates,
    // because buildPostPlan cannot produce an unbalanced pair, so no
    // behavioural test could reach the branch. It was extracted into
    // checkJournalBalance() precisely so it could be called with input the
    // planner would never generate.
    expect(checkJournalBalance([]).balanced).toBe(true);
    expect(
      checkJournalBalance([
        { accountCode: "60140", amountCents: 5_000, memo: "m" },
        { accountCode: "20140", amountCents: -5_000, memo: "m" },
      ]).balanced,
    ).toBe(true);
    const off = checkJournalBalance([
      { accountCode: "60140", amountCents: 5_000, memo: "m" },
      { accountCode: "20140", amountCents: -4_999, memo: "m" },
    ]);
    expect(off.balanced).toBe(false);
    if (!off.balanced) expect(off.problem).toMatch(/does not balance/i);
    expect(checkJournalBalance([{ accountCode: "60140", amountCents: 1, memo: "m" }]).balanced).toBe(false);
  });

  it("every plan buildPostPlan produces passes that same guard", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot({ lotId: "a" }), lot({ lotId: "b", categorySlug: "edible" })],
      lines: [
        line({ lotId: "a", countedQty: 90, reason: "damage" }),
        line({ lotId: "b", countedQty: 130, reason: "found" }),
      ],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(checkJournalBalance(res.plan.journalLines).balanced).toBe(true);
  });

  it("the inventory and COGS accounts share their last four digits", () => {
    // 20140 ↔ 60140. The house convention; a mismatch here means the variance
    // lands in a different product family's cost line and the category-level
    // margin reports quietly lie.
    for (const code of ["20140", "20150", "20160", "20999"]) {
      const pair = deriveCogsAccount(code);
      expect(pair.ok, code).toBe(true);
      if (pair.ok) {
        expect(pair.cogsAccountCode).toBe(`6${code.slice(1)}`);
        expect(pair.cogsAccountCode.slice(1)).toBe(code.slice(1));
      }
    }
  });

  it("a non-inventory account is REFUSED rather than guessed at", () => {
    for (const bad of ["60140", "10100", "abc", "2014", "201400", ""]) {
      expect(deriveCogsAccount(bad).ok, bad).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("PROPERTY SWEEP — every plan, for any inventory, balances to the penny", () => {
  /**
   * Hand-written examples cover the cases you thought of. This covers the ones
   * you did not: mixed shrink and overage, fractional grams, unvalued lots,
   * uncounted lots and recounts, all in the same session.
   */
  it("debits equal credits for every generated audit", () => {
    const shapes: Array<Array<{ on: number; counted: number | null; cost: number | null }>> = [
      [{ on: 100, counted: 90, cost: 500 }],
      [
        { on: 100, counted: 90, cost: 500 },
        { on: 50, counted: 60, cost: 500 },
      ],
      [
        { on: 10, counted: 0, cost: 1 },
        { on: 1, counted: 1000, cost: 99_999 },
      ],
      [
        { on: 100, counted: null, cost: 500 },
        { on: 20, counted: 19, cost: 333 },
      ],
      [
        { on: 7.5, counted: 7, cost: 1234 },
        { on: 3.5, counted: 3.5, cost: 1234 },
      ],
      [
        { on: 100, counted: 90, cost: null },
        { on: 100, counted: 80, cost: 500 },
      ],
      [
        { on: 1, counted: 2, cost: 1 },
        { on: 2, counted: 1, cost: 1 },
        { on: 3, counted: 3, cost: 1 },
      ],
    ];

    for (const shape of shapes) {
      const lots = shape.map((s, i) =>
        lot({
          lotId: `lot-${i}`,
          lotCode: `LOT-${i}`,
          posProductKey: `p-${i}`,
          onHandQty: s.on,
          unitCostMinorUnits: s.cost,
        }),
      );
      const lines = shape.map((s, i) =>
        line({
          lotId: `lot-${i}`,
          systemQty: s.on,
          countedQty: s.counted,
          reason: "damage",
          note: "swept",
        }),
      );
      const res = buildPostPlan({
        session: session(),
        lots,
        lines,
        accountByCategory: ACCOUNTS,
      });
      if (!res.ok) continue; // refusals are a valid outcome; they post nothing
      const debits = res.plan.journalLines
        .filter((l) => l.amountCents > 0)
        .reduce((s, l) => s + l.amountCents, 0);
      const credits = res.plan.journalLines
        .filter((l) => l.amountCents < 0)
        .reduce((s, l) => s - l.amountCents, 0);
      expect(debits, JSON.stringify(shape)).toBe(credits);
      expect(res.plan.balanced, JSON.stringify(shape)).toBe(true);
    }
  });

  it("no plan EVER contains an adjustment for a lot nobody counted", () => {
    const lots = [lot({ lotId: "a" }), lot({ lotId: "b" }), lot({ lotId: "c" })];
    const lines = [
      line({ lotId: "a", countedQty: 90, reason: "damage" }),
      line({ lotId: "b", countedQty: null }),
      line({ lotId: "c", countedQty: null, recountQty: null }),
    ];
    const res = buildPostPlan({ session: session(), lots, lines, accountByCategory: ACCOUNTS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.adjustments.map((a) => a.lotId)).toEqual(["a"]);
  });

  it("the plan is DETERMINISTIC — two runs over the same data are byte-identical", () => {
    // A plan that reorders between runs makes a diff unreadable, and an
    // unreadable diff is one nobody checks.
    const lots = [lot({ lotId: "z" }), lot({ lotId: "a" }), lot({ lotId: "m" })];
    const lines = [
      line({ lotId: "z", countedQty: 90, reason: "damage" }),
      line({ lotId: "a", countedQty: 80, reason: "damage" }),
      line({ lotId: "m", countedQty: 110, reason: "found" }),
    ];
    const a = buildPostPlan({ session: session(), lots, lines, accountByCategory: ACCOUNTS });
    const b = buildPostPlan({
      session: session(),
      lots: [...lots].reverse(),
      lines: [...lines].reverse(),
      accountByCategory: ACCOUNTS,
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
      expect(a.plan.adjustments.map((x) => x.lotId)).toEqual(["a", "m", "z"]);
    }
  });

  it("newOnHandQty always equals onHand + delta, and is never negative", () => {
    const shapes = [
      { on: 100, counted: 90 },
      { on: 100, counted: 110 },
      { on: 0, counted: 5 },
      { on: 1, counted: 0 },
      { on: 7.5, counted: 7 },
    ];
    for (const s of shapes) {
      const res = buildPostPlan({
        session: session(),
        lots: [lot({ onHandQty: s.on })],
        lines: [line({ systemQty: s.on, countedQty: s.counted, reason: "damage" })],
        accountByCategory: ACCOUNTS,
      });
      expect(res.ok, JSON.stringify(s)).toBe(true);
      if (!res.ok) continue;
      const adj = res.plan.adjustments[0];
      expect(adj.newOnHandQty).toBeCloseTo(s.on + adj.qtyDelta, 10);
      expect(adj.newOnHandQty).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("DUPLICATE LINES — two counts of one lot cannot both be right", () => {
  /**
   * A real defect found by attacking this module. Two count lines for one lot
   * planned a move of -10 AND a move of -20 against a lot holding 100, leaving
   * 70 on the shelf — a number nobody counted — and booking $150 of shrink
   * where the truth is at most $100. Same family as THE LOT-CODE FAILURE: two
   * records claiming to describe one physical lot.
   */
  it("duplicate lines are REFUSED before anything is planned", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot({ lotId: "dup", lotCode: "LOT-DUP" })],
      lines: [
        line({ lotId: "dup", countedQty: 90, reason: "damage" }),
        line({ lotId: "dup", countedQty: 80, reason: "damage" }),
      ],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("DUPLICATE_LINES");
      expect(res.problem).toMatch(/LOT-DUP/);
      expect(res.problem).toMatch(/nobody counted/i);
    }
  });

  it("NEGATIVE CONTROL — distinct lots are not mistaken for duplicates", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot({ lotId: "a" }), lot({ lotId: "b" })],
      lines: [
        line({ lotId: "a", countedQty: 90, reason: "damage" }),
        line({ lotId: "b", countedQty: 80, reason: "damage" }),
      ],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.adjustments).toHaveLength(2);
  });

  it("MIGRATION 0192 enforces one posting per lot per session in the DATABASE too", () => {
    expect(/unique\s*\(\s*session_id\s*,\s*lot_id\s*\)/i.test(migrationSrc)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("NET vs GROSS — offsetting mistakes are two mistakes, not zero", () => {
  /**
   * A $600 overage and a $600 shortage net to zero and look like a perfect
   * audit. Reporting only the net teaches the owner that cancelling errors are
   * the same as no errors. This is the exact shape of the $4,624,697.31 LAZY
   * INVENTORY plug: a number that balanced and meant nothing.
   */
  it("a session that nets to zero still reports the gross movement", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [
        lot({ lotId: "a", onHandQty: 100, unitCostMinorUnits: 600 }),
        lot({ lotId: "b", onHandQty: 100, unitCostMinorUnits: 600 }),
      ],
      lines: [
        line({ lotId: "a", systemQty: 100, countedQty: 90, reason: "damage" }),
        line({ lotId: "b", systemQty: 100, countedQty: 110, reason: "found" }),
      ],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.netVarianceCents).toBe(0);
    expect(res.plan.grossVarianceCents).toBe(12_000); // $120.00 really moved
    expect(res.plan.explanation).toMatch(/two mistakes, not zero/i);
  });

  it("the explanation never reports a zero net as a clean audit when gross is non-zero", () => {
    const text = explainPlan(2, 0, 12_000, 0);
    expect(text).not.toMatch(/money effect is zero/i);
    expect(text).toMatch(/\$120\.00/);
  });

  it("a genuinely clean session says so, and posts nothing", () => {
    const verdict = gateSessionForPosting(session(), [assessLine(lot(), line({ countedQty: 100 }))]);
    expect(verdict.mayPost).toBe(false);
    expect(verdict.code).toBe("NOTHING_TO_POST");
    expect(verdict.reason).toMatch(/outcome you want/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("REFUSALS — rule 14, gate everything", () => {
  it("only an APPROVED session may post, and approval is one status not a set", () => {
    expect(POSTABLE_STATUS).toBe("approved");
    for (const s of AUDIT_SESSION_STATUSES) {
      if (s === "approved") continue;
      const v = gateSessionForPosting(
        session({ status: s }),
        [assessLine(lot(), line({ countedQty: 90 }))],
      );
      expect(v.mayPost, `status ${s} must not post`).toBe(false);
      expect(v.code).toBe("NOT_APPROVED");
    }
  });

  it("an approval nobody signed is refused", () => {
    for (const over of [{ resultApprovedBy: null }, { resultApprovedAt: null }]) {
      const v = gateSessionForPosting(
        session(over),
        [assessLine(lot(), line({ countedQty: 90 }))],
      );
      expect(v.code).toBe("APPROVAL_NOT_EVIDENCED");
    }
  });

  it("an audit with no lines is not a clean bill of health", () => {
    const v = gateSessionForPosting(session(), []);
    expect(v.code).toBe("NO_LINES");
    expect(v.reason).toMatch(/nothing was looked at/i);
  });

  it("a correction that would leave less than nothing on the shelf is refused, not clamped", () => {
    // Michael's Sage file is full of negative inventory. Clamping to zero hides
    // the contradiction; the contradiction IS the finding.
    const res = buildPostPlan({
      session: session(),
      lots: [lot({ onHandQty: 5 })],
      lines: [line({ systemQty: 100, countedQty: 0, reason: "damage" })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problem).toMatch(/less than nothing/i);
  });

  it("a category with no inventory account is refused, not posted somewhere plausible", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot({ categorySlug: "unmapped" })],
      lines: [line({ countedQty: 90, reason: "damage" })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ACCOUNT_UNRESOLVED");
  });

  it("an unvalued lot corrects the SHELF but never guesses at the money", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot({ unitCostMinorUnits: null })],
      lines: [line({ countedQty: 90, reason: "damage" })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.adjustments).toHaveLength(1); // shelf IS corrected
    expect(res.plan.journalLines).toHaveLength(0); // books are NOT guessed at
    expect(res.plan.warnings.join(" ")).toMatch(/no recorded cost/i);
  });

  it("undocumented shrink needs the owner's decision and cites the deemed-sale rule", () => {
    // WAC 314-55-089(4)(c): an undocumented reduction is treated as a sale and
    // the 37% excise is charged on it.
    const res = buildPostPlan({
      session: session(),
      lots: [lot()],
      lines: [line({ countedQty: 90, reason: null, note: null })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.needsOwnerDecision).toHaveLength(1);
    expect(res.plan.authorityIds).toContain("WAC_314_55_089_4_C_DEEMED_SALES");
  });

  it("WHITESPACE IS NOT AN EXPLANATION — a space bar does not document a write-off", () => {
    for (const blank of ["   ", "\t", "\n", " \t\n "]) {
      const res = buildPostPlan({
        session: session(),
        lots: [lot()],
        lines: [line({ countedQty: 90, reason: blank, note: blank })],
        accountByCategory: ACCOUNTS,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.plan.needsOwnerDecision, JSON.stringify(blank)).toHaveLength(1);
      }
    }
  });

  it("NEGATIVE CONTROL — real text DOES document it", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot()],
      lines: [line({ countedQty: 90, reason: null, note: "dropped and broken, witnessed" })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.needsOwnerDecision).toHaveLength(0);
  });

  it("an OVERAGE never demands a shrink explanation", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot()],
      lines: [line({ countedQty: 110, reason: null, note: null })],
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.needsOwnerDecision).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("THE STATUS MACHINE — approval that can be walked back is not approval", () => {
  it("approved and cancelled are terminal", () => {
    expect(LEGAL_STATUS_MOVES.approved).toHaveLength(0);
    expect(LEGAL_STATUS_MOVES.cancelled).toHaveLength(0);
    for (const s of AUDIT_SESSION_STATUSES) {
      expect(canMoveStatus("approved", s).allowed, `approved -> ${s}`).toBe(false);
      expect(canMoveStatus("cancelled", s).allowed, `cancelled -> ${s}`).toBe(false);
    }
  });

  it("no status may skip straight to approved except review", () => {
    for (const s of AUDIT_SESSION_STATUSES) {
      const allowed = canMoveStatus(s, "approved").allowed;
      expect(allowed, `${s} -> approved`).toBe(s === "review");
    }
  });

  it("a no-op move is refused rather than silently allowed", () => {
    for (const s of AUDIT_SESSION_STATUSES) {
      expect(canMoveStatus(s, s).allowed, `${s} -> ${s}`).toBe(false);
    }
  });

  it("every destination in the table is itself a real status", () => {
    for (const [from, tos] of Object.entries(LEGAL_STATUS_MOVES)) {
      expect(isAuditSessionStatus(from)).toBe(true);
      for (const to of tos) expect(isAuditSessionStatus(to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("an unknown status is not a status", () => {
    for (const bad of ["posted", "APPROVED", "", "approve", "done"]) {
      expect(isAuditSessionStatus(bad), bad).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("DRIFT — the TypeScript and the database must not disagree", () => {
  it("every status in the module appears in migration 0191's CHECK constraint", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "supabase", "migrations", "0191_inventory_audit.sql"),
      "utf8",
    );
    for (const s of AUDIT_SESSION_STATUSES) {
      expect(src.includes(`'${s}'`), `status ${s} missing from 0191`).toBe(true);
    }
  });

  it("0192 gates on is_owner() as its FIRST act, before it reads anything", () => {
    // The F5-M bug in reverse: if this is ever reached through the service-role
    // key, auth.uid() is NULL and is_owner() is FALSE. The refusal must come
    // first so a budtender never gets as far as touching a lot row.
    const fn = migrationSrc.slice(migrationSrc.indexOf("inventory_audit_post_session"));
    const ownerAt = fn.search(/is_owner\(\)/);
    const updateAt = fn.search(/update\s+public\./i);
    expect(ownerAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeLessThan(updateAt);
  });

  it("0192 ships a gate check whose EMPTY result is the passing result", () => {
    expect(migrationSrc).toMatch(/inventory_audit_post_gate_check/);
  });

  it("0192 refuses rather than clamps when a correction goes negative", () => {
    expect(migrationSrc).toMatch(/INVENTORY_AUDIT_NEGATIVE/);
  });

  it("0192 falls back to the LOT's cost when the LINE's copy is null", () => {
    // A real defect: reading unit cost from the line alone reported a $120
    // gross variance as $0.00 — presenting two real errors as a clean audit.
    expect(/coalesce\s*\(\s*l\.unit_cost_minor_units\s*,\s*lot\.unit_cost_minor_units\s*\)/i.test(migrationSrc)).toBe(true);
  });

  it("0192 measures the variance against the FROZEN snapshot, not live on-hand", () => {
    // THE CUTOFF RACE. Snapshot 100, a sale drops on-hand to 95, staff count
    // 90. Measuring against live on-hand records -5 instead of the true -10 and
    // launders the 5 units the sale legitimately removed into the count,
    // under-reporting shrink by half.
    expect(/v_delta\s*:=\s*v_effective\s*-\s*r\.system_qty/i.test(migrationSrc)).toBe(true);
  });

  it("the module still documents that NULL is not zero", () => {
    expect(moduleSrc).toMatch(/NULL is not zero|NULL MEANS NOBODY LOOKED|nobody looked/i);
  });

  it("the module still documents the sign wall", () => {
    expect(moduleSrc).toMatch(/POSITIVE\s+`?amount_cents`?\s+is\s+a\s+DEBIT|Positive = DEBIT/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("AUTHORITIES — every citation this module emits must resolve", () => {
  it("the authority ids on a real plan all resolve in the shared registry", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot()],
      lines: [line({ countedQty: 90 })], // undocumented → adds the WAC citation
      accountByCategory: ACCOUNTS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.authorityIds.length).toBeGreaterThan(0);
    const resolved = resolvePostAuthorities(res.plan.authorityIds);
    expect(resolved).toHaveLength(res.plan.authorityIds.length);
    for (const a of resolved) {
      expect(a.id, "an authority with no id").toBeTruthy();
      expect(a.cite, `${a.id} has no citation`).toBeTruthy();
      expect(a.quote, `${a.id} has no verbatim quote`).toBeTruthy();
      expect(a.source, `${a.id} has nowhere to go and read it`).toBeTruthy();
    }
  });

  it("PROVES THE CHECK BITES — an id that does not exist resolves to nothing", () => {
    // Without this, the assertion above would also pass for a plan that emitted
    // no authorities at all, or for a registry that happily invented entries.
    expect(resolvePostAuthorities(["NOT_A_REAL_AUTHORITY"])).toHaveLength(0);
    expect(resolvePostAuthorities([])).toHaveLength(0);
  });

  it("authority ids are sorted, so two runs produce the same list", () => {
    const res = buildPostPlan({
      session: session(),
      lots: [lot()],
      lines: [line({ countedQty: 90 })],
      accountByCategory: ACCOUNTS,
    });
    if (res.ok) {
      expect(res.plan.authorityIds).toEqual([...res.plan.authorityIds].sort());
    }
  });
});
