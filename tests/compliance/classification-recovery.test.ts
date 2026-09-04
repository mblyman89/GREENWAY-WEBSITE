/**
 * tests/compliance/classification-recovery.test.ts
 *
 * SLICE 18G — proving the DEFECT 3 recovery plan is earned, not guessed.
 *
 * The recovery module writes nothing; it proposes. That makes these tests the
 * only thing standing between a plausible-looking proposal and a bulk edit of
 * the columns the register enforces from. So they assert behaviour on real
 * values, never the presence of words.
 *
 * The four rules under test, in order of how much damage breaking them does:
 *
 *   1. Never overwrite an answer that exists today.
 *   2. Never invent one where history has none.
 *   3. `false` is an answer and must be recovered like any other.
 *   4. The newest answer wins, and disagreement is reported, not hidden.
 */
import { describe, expect, it } from "vitest";
import {
  planClassificationRecovery,
  renderRecoverySql,
  RECOVERABLE_COLUMNS,
  type HistoricalRow,
} from "@/lib/pos/classification-recovery-core";

/** A row with every enforcement column explicitly null unless overridden. */
function row(
  source_item_id: string,
  menu_version_id: string,
  version_created_at: string,
  over: Partial<HistoricalRow> = {},
): HistoricalRow {
  return {
    source_item_id,
    menu_version_id,
    version_created_at,
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    ...over,
  };
}

function find(
  plan: ReturnType<typeof planClassificationRecovery>,
  key: string,
  column: string,
) {
  return plan.recovered.find((r) => r.source_item_id === key && r.column === column);
}

describe("SLICE 18G recovery: it fills blanks and nothing else", () => {
  it("restores a value the re-stage erased", () => {
    // The exact shape of the damage: today's row is blank, an older version
    // still holds the answer a human gave.
    const current = [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")];
    const history = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", {
        otherwise_taken: true,
        units_per_package: 6,
      }),
    ];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "otherwise_taken")?.value).toBe(true);
    expect(find(plan, "SUPP-1", "units_per_package")?.value).toBe(6);
    expect(find(plan, "SUPP-1", "otherwise_taken")?.fromVersionId).toBe("v1");
  });

  it("never overwrites an answer that exists today", () => {
    // If the current row already says something, that is the standing answer,
    // even when history disagrees. Someone may have re-classified deliberately;
    // "restoring" over the top of them would undo a human decision.
    const current = [row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { otherwise_taken: false })];
    const history = [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true })];

    const plan = planClassificationRecovery(current, history);

    expect(
      find(plan, "SUPP-1", "otherwise_taken"),
      "a live answer was overwritten from history",
    ).toBeUndefined();
    expect(plan.untouchedCount).toBeGreaterThan(0);
  });

  it("recovers false exactly as readily as true", () => {
    // THE TRUTHINESS TRAP. `if (value)` would skip this row and silently
    // report it as unrecoverable. false is a human saying "I checked, it is
    // not" — it is what stops the receiving dock asking again, so losing it
    // reintroduces the nagging SLICE 18E removed.
    const current = [row("BEV-1", "v2", "2026-02-01T00:00:00Z")];
    const history = [
      row("BEV-1", "v1", "2026-01-01T00:00:00Z", {
        otherwise_taken: false,
        low_thc_liquid: false,
      }),
    ];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "BEV-1", "otherwise_taken")?.value).toBe(false);
    expect(find(plan, "BEV-1", "low_thc_liquid")?.value).toBe(false);

    // Precisely: the two columns that HELD false must not be reported as gaps.
    // The other two genuinely were null in history and are correctly gaps —
    // an earlier draft of this test asserted "no gaps for BEV-1" at all, which
    // was a wrong claim about the fixture rather than a fault in the code.
    for (const column of ["otherwise_taken", "low_thc_liquid"]) {
      expect(
        plan.gaps.some((g) => g.source_item_id === "BEV-1" && g.column === column),
        `${column} held false and was written off as unrecoverable; false is an answer`,
      ).toBe(false);
    }
  });

  it("recovers a measured zero rather than treating it as missing", () => {
    // Same trap, numeric edge. 0 mg is a measurement, not an absence.
    const current = [row("BEV-2", "v2", "2026-02-01T00:00:00Z")];
    const history = [row("BEV-2", "v1", "2026-01-01T00:00:00Z", { unit_thc_mg: 0 })];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "BEV-2", "unit_thc_mg")?.value).toBe(0);
  });
});

describe("SLICE 18G recovery: it refuses to invent an answer", () => {
  it("reports a product with no history as an unrecoverable gap", () => {
    const plan = planClassificationRecovery([row("NEW-1", "v2", "2026-02-01T00:00:00Z")], []);

    expect(plan.recovered).toHaveLength(0);
    for (const column of RECOVERABLE_COLUMNS) {
      expect(
        plan.gaps.some((g) => g.source_item_id === "NEW-1" && g.column === column),
        `${column} was neither recovered nor reported as a gap`,
      ).toBe(true);
    }
  });

  it("reports history that was itself never classified as a gap", () => {
    // The product is old, but nobody ever answered. Recovery must not turn
    // "never asked" into "answered no".
    const current = [row("OLD-1", "v2", "2026-02-01T00:00:00Z")];
    const history = [row("OLD-1", "v1", "2026-01-01T00:00:00Z")];

    const plan = planClassificationRecovery(current, history);

    expect(plan.recovered).toHaveLength(0);
    expect(
      plan.gaps.every((g) => g.reason === "history-all-null"),
      "a never-classified product must be distinguishable from an unknown one",
    ).toBe(true);
  });

  it("distinguishes the two kinds of gap, because they need different actions", () => {
    // no-history: the product is new, classify it at the dock.
    // history-all-null: the product predates the classification feature.
    // Collapsing them would hide which products a human still has to visit.
    const plan = planClassificationRecovery(
      [row("NEW-1", "v2", "2026-02-01T00:00:00Z"), row("OLD-1", "v2", "2026-02-01T00:00:00Z")],
      [row("OLD-1", "v1", "2026-01-01T00:00:00Z")],
    );

    const reasons = new Map(plan.gaps.map((g) => [`${g.source_item_id}:${g.column}`, g.reason]));
    expect(reasons.get("NEW-1:otherwise_taken")).toBe("no-history");
    expect(reasons.get("OLD-1:otherwise_taken")).toBe("history-all-null");
  });
});

describe("SLICE 18G recovery: the newest answer wins, disagreement is surfaced", () => {
  it("prefers the most recent non-null answer", () => {
    // Classification is revisable. If a manager corrected 6 to 4, the
    // correction is the standing answer.
    const current = [row("SUPP-1", "v3", "2026-03-01T00:00:00Z")];
    const history = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 6 }),
      row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { units_per_package: 4 }),
    ];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "units_per_package")?.value).toBe(4);
    expect(find(plan, "SUPP-1", "units_per_package")?.fromVersionId).toBe("v2");
  });

  it("orders by version date, not by the order rows were handed in", () => {
    // A caller must not be able to change a compliance outcome by sorting its
    // query differently. Same data, reversed input: same answer.
    const current = [row("SUPP-1", "v3", "2026-03-01T00:00:00Z")];
    const forwards = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 6 }),
      row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { units_per_package: 4 }),
    ];
    const backwards = [...forwards].reverse();

    expect(find(planClassificationRecovery(current, forwards), "SUPP-1", "units_per_package")?.value)
      .toBe(4);
    expect(find(planClassificationRecovery(current, backwards), "SUPP-1", "units_per_package")?.value)
      .toBe(4);
  });

  it("skips a newer null to reach an older real answer", () => {
    // The lossy re-stage wrote nulls INTO history too, so the most recent row
    // is often blank. Recovery has to look past it, or it recovers nothing in
    // exactly the case it was built for.
    const current = [row("SUPP-1", "v3", "2026-03-01T00:00:00Z")];
    const history = [
      // units_per_package is carried alongside the flag because the database
      // will not accept otherwise_taken=true without it; see the paired-CHECK
      // block below. A fixture that set the flag alone would be testing a row
      // Postgres would reject.
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true, units_per_package: 6 }),
      row("SUPP-1", "v2", "2026-02-01T00:00:00Z"), // the lossy re-stage
    ];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "otherwise_taken")?.value).toBe(true);
    expect(find(plan, "SUPP-1", "otherwise_taken")?.fromVersionId).toBe("v1");
  });

  it("flags conflicting history instead of hiding it", () => {
    const current = [row("SUPP-1", "v3", "2026-03-01T00:00:00Z")];
    const history = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 6 }),
      row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { units_per_package: 4 }),
    ];

    const plan = planClassificationRecovery(current, history);
    expect(find(plan, "SUPP-1", "units_per_package")?.hadConflictingHistory).toBe(true);
  });

  it("does not cry conflict when history simply agrees with itself", () => {
    // A flag that is always on is ignored. If every recovery were marked
    // conflicting, the owner would learn to skip the warning.
    const current = [row("SUPP-1", "v3", "2026-03-01T00:00:00Z")];
    const history = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 6 }),
      row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { units_per_package: 6 }),
    ];

    const plan = planClassificationRecovery(current, history);
    expect(find(plan, "SUPP-1", "units_per_package")?.hadConflictingHistory).toBe(false);
  });

  it("keeps two products' recoveries separate", () => {
    const current = [
      row("SUPP-1", "v2", "2026-02-01T00:00:00Z"),
      row("BEV-1", "v2", "2026-02-01T00:00:00Z"),
    ];
    const history = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 6 }),
      row("BEV-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 2 }),
    ];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "units_per_package")?.value).toBe(6);
    expect(find(plan, "BEV-1", "units_per_package")?.value).toBe(2);
  });
});

describe("SLICE 18G recovery: it respects the database's paired CHECK constraints", () => {
  /**
   * Found by running the proposed SQL against a real PostgreSQL 15, which
   * rejected it. menu_items enforces two pairings:
   *
   *   otherwise_taken IS NOT TRUE OR units_per_package IS NOT NULL
   *   low_thc_liquid  IS NOT TRUE OR unit_thc_mg IN (0, 4]
   *
   * A recovery that restores only the flag proposes a row the database will
   * refuse — and it is right to refuse, because a units_per_package of NULL
   * would let the register count a box of six as one unit against a ten-unit
   * statutory maximum.
   */
  it("does not propose otherwise_taken=true without its unit count", () => {
    const current = [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")];
    // History kept the flag but lost the multiplier.
    const history = [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true })];

    const plan = planClassificationRecovery(current, history);

    expect(
      find(plan, "SUPP-1", "otherwise_taken"),
      "proposed a flag the database would reject, breaking the owner's transaction",
    ).toBeUndefined();
    const blocked = plan.blocked.find((b) => b.column === "otherwise_taken");
    expect(blocked?.requires).toBe("units_per_package");
  });

  it("does propose it when the unit count comes back in the same plan", () => {
    const current = [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")];
    const history = [
      row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true, units_per_package: 6 }),
    ];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "otherwise_taken")?.value).toBe(true);
    expect(find(plan, "SUPP-1", "units_per_package")?.value).toBe(6);
    expect(plan.blocked).toHaveLength(0);
  });

  it("does propose it when the unit count is already on the live row", () => {
    // Only the flag was erased. The partner is present, so the row stays legal.
    const current = [row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { units_per_package: 6 })];
    const history = [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true })];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "otherwise_taken")?.value).toBe(true);
    expect(plan.blocked).toHaveLength(0);
  });

  it("never blocks a false, because false is always legal", () => {
    // The constraints only bite on TRUE. Blocking false would refuse a safe
    // recovery and leave the dock asking a question already answered.
    const current = [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")];
    const history = [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: false })];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "SUPP-1", "otherwise_taken")?.value).toBe(false);
    expect(plan.blocked).toHaveLength(0);
  });

  it("applies the same rule to low_thc_liquid and its per-unit ceiling", () => {
    const current = [row("BEV-1", "v2", "2026-02-01T00:00:00Z")];
    const history = [row("BEV-1", "v1", "2026-01-01T00:00:00Z", { low_thc_liquid: true })];

    const plan = planClassificationRecovery(current, history);

    expect(find(plan, "BEV-1", "low_thc_liquid")).toBeUndefined();
    expect(plan.blocked.find((b) => b.column === "low_thc_liquid")?.requires).toBe("unit_thc_mg");
  });

  it("sets paired columns in ONE statement, never two", () => {
    // Two statements = the row is briefly illegal between them, and Postgres
    // rejects the first one. This is the assertion that would have caught the
    // original SQL before it was ever handed to the owner.
    const plan = planClassificationRecovery(
      [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")],
      [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true, units_per_package: 6 })],
    );
    const sql = renderRecoverySql(plan, "v2");

    expect((sql.match(/^update /gm) ?? []).length).toBe(1);
    // Both columns in the single SET clause.
    const setLine = (sql.match(/^update .*$/m) ?? [""])[0];
    expect(setLine).toContain("otherwise_taken = true");
    expect(setLine).toContain("units_per_package = 6");
  });

  it("tells the owner about blocked recoveries instead of hiding them", () => {
    const plan = planClassificationRecovery(
      [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")],
      [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true })],
    );
    const sql = renderRecoverySql(plan, "v2");

    expect(sql).toContain("NOT PROPOSED");
    expect(sql).toContain("units_per_package");
  });
});

describe("SLICE 18G recovery: the SQL it proposes is safe to read and run", () => {
  it("guards every update with `is null` so it can only fill a blank", () => {
    const plan = planClassificationRecovery(
      [row("SUPP-1", "v2", "2026-02-01T00:00:00Z")],
      [row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: true, units_per_package: 6 })],
    );
    const sql = renderRecoverySql(plan, "v2");

    // One guard per update, or an unguarded statement is hiding in there.
    const updates = (sql.match(/^update /gm) ?? []).length;
    const guards = (sql.match(/is null;$/gm) ?? []).length;
    expect(updates).toBeGreaterThan(0);
    expect(guards, "an UPDATE without an `is null` guard could overwrite a live answer").toBe(
      updates,
    );
  });

  it("writes false as false, not as an empty string or null", () => {
    // Rendering false wrongly would turn a recovered answer into another
    // blank, which is the very thing being repaired.
    const plan = planClassificationRecovery(
      [row("BEV-1", "v2", "2026-02-01T00:00:00Z")],
      [row("BEV-1", "v1", "2026-01-01T00:00:00Z", { otherwise_taken: false })],
    );
    const sql = renderRecoverySql(plan, "v2");

    expect(sql).toContain("set otherwise_taken = false");
    expect(sql).not.toContain("set otherwise_taken = null");
  });

  it("says plainly when there is nothing to do", () => {
    const plan = planClassificationRecovery([row("NEW-1", "v2", "2026-02-01T00:00:00Z")], []);
    const sql = renderRecoverySql(plan, "v2");

    expect(sql).toContain("Nothing to recover");
    expect(sql).not.toContain("update ");
  });

  it("marks conflicting recoveries in the SQL a human will read", () => {
    const plan = planClassificationRecovery(
      [row("SUPP-1", "v3", "2026-03-01T00:00:00Z")],
      [
        row("SUPP-1", "v1", "2026-01-01T00:00:00Z", { units_per_package: 6 }),
        row("SUPP-1", "v2", "2026-02-01T00:00:00Z", { units_per_package: 4 }),
      ],
    );
    const sql = renderRecoverySql(plan, "v3");

    expect(sql).toContain("CONFLICT");
    expect(sql).toContain("set units_per_package = 4");
  });
});
