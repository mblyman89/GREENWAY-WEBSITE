/**
 * src/lib/pos/classification-recovery-core.ts
 *
 * SLICE 18G — recovering the classifications DEFECT 3 already erased.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 * ─────────────────────────────────────────────────────────────────────────
 * Fixing the code stops the bleeding. It does not give back what was already
 * lost. Every product that was carried through an intake re-stage while the
 * defect was live reached the live menu with all four sales-limit columns
 * NULL, and NULL is the fail-open value: the register simply stops applying
 * that limit. A ten-unit statutory bucket that no longer engages does not look
 * broken from behind the counter. It looks like a normal sale.
 *
 * So the erased data has to be recovered, and the recovery has to be earned
 * from evidence rather than guessed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY RECOVERY IS POSSIBLE AT ALL
 * ─────────────────────────────────────────────────────────────────────────
 * Verified from source, not assumed: nothing in this repo ever deletes a
 * menu_version or its menu_items. A grep across src/ for a delete against
 * either table returns nothing; versions only ever change status. Every
 * superseded version is therefore still sitting in the database with its rows
 * intact — including the rows written BEFORE the lossy re-stage, which still
 * carry the classification a human actually set.
 *
 * That is the whole basis of this module. The answer was never destroyed, only
 * dropped on the way forward. It can be read back out of history.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THIS MODULE OBEYS
 * ─────────────────────────────────────────────────────────────────────────
 * A recovery that guesses is worse than no recovery, because it manufactures a
 * compliance answer nobody gave and stamps it onto the register. So:
 *
 *   - Only a NULL on the current row is ever a candidate. A value that is
 *     present today is never touched, even to "correct" it. If today's row
 *     disagrees with history, history is stale — someone answered again.
 *   - Only a NON-NULL value from history can fill it. Carrying a null forward
 *     is not recovery, it is noise.
 *   - The MOST RECENT non-null answer wins, because classification is a human
 *     decision that can be revised, and the newest revision is the standing
 *     one.
 *   - `false` is a real answer and must be recovered exactly like `true`.
 *     "I looked, it is not a suppository" is what silences the receiving
 *     dock's question. Treating false as absent would resurrect the nagging
 *     SLICE 18E existed to stop, and would also make this module lie about
 *     what it recovered. This is why every internal test below uses `=== null`
 *     and never a truthiness check.
 *   - Conflicts are REPORTED, never resolved silently.
 *
 * This module is PURE. It computes a plan and returns it. It does not write.
 * The decision to apply anything belongs to the owner, which is why
 * scripts/slice18g/recover-classifications.ts prints SQL for review instead of
 * executing it.
 */

/** The four columns migration 0219 labels the ENFORCEMENT SOURCE OF TRUTH. */
export const RECOVERABLE_COLUMNS = [
  "low_thc_liquid",
  "unit_thc_mg",
  "otherwise_taken",
  "units_per_package",
] as const;

export type RecoverableColumn = (typeof RECOVERABLE_COLUMNS)[number];

/** A menu_items row as this module needs to see it. */
export type HistoricalRow = {
  /** The stable product key. Rows across versions are matched on this. */
  source_item_id: string;
  /** Which menu_version this row belongs to. */
  menu_version_id: string;
  /**
   * When that version was created. Ordering is by this, NOT by array position,
   * so a caller cannot change the outcome by sorting its query differently.
   */
  version_created_at: string;
  low_thc_liquid?: boolean | null;
  unit_thc_mg?: number | null;
  otherwise_taken?: boolean | null;
  units_per_package?: number | null;
};

/** One column of one product that can be filled from history. */
export type RecoveredValue = {
  source_item_id: string;
  column: RecoverableColumn;
  /** The value to restore. Never null — a null is not a recovery. */
  value: boolean | number;
  /** The version the value was read from, so the owner can audit it. */
  fromVersionId: string;
  fromVersionCreatedAt: string;
  /**
   * True when older versions disagreed with the value chosen. Not an error:
   * a human is allowed to change their mind. It is surfaced so a genuine
   * mis-classification is visible rather than buried.
   */
  hadConflictingHistory: boolean;
};

/** A product column that is NULL today and cannot be recovered. */
export type UnrecoverableGap = {
  source_item_id: string;
  column: RecoverableColumn;
  /** Why no value could be earned. */
  reason: "no-history" | "history-all-null";
};

/**
 * A value that WAS found in history but must not be proposed, because applying
 * it would leave the row violating a CHECK constraint on menu_items.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FOUND BY RUNNING THE SQL AGAINST A REAL POSTGRES, NOT BY READING THE CODE
 * ─────────────────────────────────────────────────────────────────────────
 * Two of the four columns are HALVES OF A PAIR, enforced in the database:
 *
 *   menu_items_otherwise_taken_needs_units
 *     CHECK (otherwise_taken IS NOT TRUE OR units_per_package IS NOT NULL)
 *
 *   menu_items_low_thc_unit_ceiling
 *     CHECK (low_thc_liquid IS NOT TRUE OR
 *            (unit_thc_mg IS NOT NULL AND unit_thc_mg > 0 AND unit_thc_mg <= 4))
 *
 * The constraints are right, and they encode real statute: an
 * `otherwise_taken` product with no unit count would let the register treat a
 * box of six as ONE unit against a ten-unit maximum, under-counting sixfold
 * (RCW 69.50.101 / WAC 314-55-095(1)(d)(i)(D)).
 *
 * So `otherwise_taken = true` is not a value that can be restored on its own.
 * If history lost the multiplier, restoring only the flag is not a partial
 * repair — it is a statement the database will refuse, and it SHOULD refuse.
 * Those cases are surfaced here so a human can supply the missing half, rather
 * than being silently dropped or, worse, emitted as SQL that errors halfway
 * through the owner's transaction.
 */
export type BlockedRecovery = {
  source_item_id: string;
  column: RecoverableColumn;
  value: boolean | number;
  /** The column whose absence blocks it. */
  requires: RecoverableColumn;
  /** Plain-language explanation for the report the owner reads. */
  reason: string;
};

export type RecoveryPlan = {
  recovered: RecoveredValue[];
  gaps: UnrecoverableGap[];
  /** Found in history, but not safely applicable on its own. Needs a human. */
  blocked: BlockedRecovery[];
  /** Columns already populated on the current row and therefore left alone. */
  untouchedCount: number;
};

function valueAt(row: HistoricalRow, column: RecoverableColumn): boolean | number | null {
  const raw = row[column];
  // `?? null` and not `|| null`: false and 0 are real answers. `0` matters for
  // unit_thc_mg, where a measured zero is a fact, not a missing value.
  return raw ?? null;
}

/**
 * Build a recovery plan.
 *
 * @param currentRows  The rows on the CURRENT published version, one per product.
 * @param historyRows  Rows for those products on any OTHER version. Order does
 *                     not matter; this function sorts by version_created_at.
 */
export function planClassificationRecovery(
  currentRows: HistoricalRow[],
  historyRows: HistoricalRow[],
): RecoveryPlan {
  const historyByProduct = new Map<string, HistoricalRow[]>();
  for (const row of historyRows) {
    const list = historyByProduct.get(row.source_item_id) ?? [];
    list.push(row);
    historyByProduct.set(row.source_item_id, list);
  }
  // Newest first. Sorting here rather than trusting the caller means the
  // "most recent answer wins" rule is enforced by this module, not by whoever
  // wrote the query.
  for (const list of historyByProduct.values()) {
    list.sort((a, b) => (a.version_created_at < b.version_created_at ? 1 : -1));
  }

  const recovered: RecoveredValue[] = [];
  const gaps: UnrecoverableGap[] = [];
  const blocked: BlockedRecovery[] = [];
  let untouchedCount = 0;

  for (const current of currentRows) {
    const history = historyByProduct.get(current.source_item_id) ?? [];

    for (const column of RECOVERABLE_COLUMNS) {
      // Present today: leave it alone. Never overwrite a live answer.
      if (valueAt(current, column) !== null) {
        untouchedCount += 1;
        continue;
      }

      if (history.length === 0) {
        gaps.push({ source_item_id: current.source_item_id, column, reason: "no-history" });
        continue;
      }

      const answers = history
        .map((row) => ({ row, value: valueAt(row, column) }))
        .filter((entry): entry is { row: HistoricalRow; value: boolean | number } =>
          entry.value !== null,
        );

      if (answers.length === 0) {
        // The product existed before, but was never classified. There is
        // nothing to restore, and inventing one is exactly what this module
        // refuses to do. It stays null so the dock keeps asking.
        gaps.push({ source_item_id: current.source_item_id, column, reason: "history-all-null" });
        continue;
      }

      const [newest, ...older] = answers;
      recovered.push({
        source_item_id: current.source_item_id,
        column,
        value: newest.value,
        fromVersionId: newest.row.menu_version_id,
        fromVersionCreatedAt: newest.row.version_created_at,
        hadConflictingHistory: older.some((entry) => entry.value !== newest.value),
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // PAIRING PASS. Enforce, in the plan, what the database enforces in CHECK
  // constraints — so the SQL handed to the owner cannot fail halfway through.
  //
  // A `true` on either gated flag is only proposable if its partner value
  // will ALSO be present on the row once the plan is applied: either it is
  // already there today, or this same plan restores it.
  // ───────────────────────────────────────────────────────────────────────
  const PAIRS: { flag: RecoverableColumn; requires: RecoverableColumn; why: string }[] = [
    {
      flag: "otherwise_taken",
      requires: "units_per_package",
      why:
        "menu_items_otherwise_taken_needs_units: a product counted in whole units " +
        "must say how many units are in the package, or the register would count a " +
        "multi-unit box as one against the ten-unit maximum",
    },
    {
      flag: "low_thc_liquid",
      requires: "unit_thc_mg",
      why:
        "menu_items_low_thc_unit_ceiling: the 200 mg carve-out only applies to a " +
        "liquid whose per-unit THC is known and is at most 4 mg",
    },
  ];

  const currentByKey = new Map(currentRows.map((r) => [r.source_item_id, r]));
  const recoveredIndex = new Map(recovered.map((r) => [`${r.source_item_id}:${r.column}`, r]));

  const survivors: RecoveredValue[] = [];
  for (const entry of recovered) {
    const pair = PAIRS.find((p) => p.flag === entry.column);
    // Only a `true` is gated. false and null are always safe.
    if (!pair || entry.value !== true) {
      survivors.push(entry);
      continue;
    }

    const current = currentByKey.get(entry.source_item_id);
    const partnerLive = current ? valueAt(current, pair.requires) !== null : false;
    const partnerRecovered = recoveredIndex.has(`${entry.source_item_id}:${pair.requires}`);

    if (partnerLive || partnerRecovered) {
      survivors.push(entry);
      continue;
    }

    blocked.push({
      source_item_id: entry.source_item_id,
      column: entry.column,
      value: entry.value,
      requires: pair.requires,
      reason: pair.why,
    });
  }

  return { recovered: survivors, gaps, blocked, untouchedCount };
}

/**
 * Render a recovery plan as SQL for a human to read, check, and run by hand.
 *
 * Deliberately NOT executed anywhere. The owner applies migrations by hand in
 * the Supabase SQL editor, and a bulk rewrite of enforcement columns is
 * exactly the kind of change that should be read before it runs. Each
 * statement is scoped to one product and one version, and carries a
 * `is null` guard so re-running it can never clobber an answer given in the
 * meantime.
 */
export function renderRecoverySql(plan: RecoveryPlan, targetVersionId: string): string {
  if (plan.recovered.length === 0 && plan.blocked.length === 0) {
    return "-- Nothing to recover: no NULL enforcement column had a non-null history.\n";
  }

  const lines: string[] = [
    "-- SLICE 18G: restore sales-limit classifications erased by DEFECT 3.",
    "-- READ THIS BEFORE RUNNING IT. Every statement is guarded with `is null`,",
    "-- so it can only ever fill a blank, never overwrite an existing answer.",
    `-- Target version: ${targetVersionId}`,
    "",
    "-- One statement PER PRODUCT, not per column. That is deliberate:",
    "-- menu_items has paired CHECK constraints (otherwise_taken needs",
    "-- units_per_package; low_thc_liquid needs unit_thc_mg), so setting one",
    "-- column at a time makes the row briefly illegal and Postgres rejects it.",
    "-- Verified against a real PostgreSQL 15, not assumed from reading.",
    "",
  ];

  // Only open a transaction if there is actually something to run. A bare
  // begin/commit around nothing invites the reader to assume work happened.
  if (plan.recovered.length > 0) {
    lines.push("begin;", "");
  }

  // Group by product so paired columns land in the same statement.
  const byProduct = new Map<string, RecoveredValue[]>();
  for (const entry of plan.recovered) {
    const list = byProduct.get(entry.source_item_id) ?? [];
    list.push(entry);
    byProduct.set(entry.source_item_id, list);
  }

  for (const [sourceItemId, entries] of byProduct) {
    for (const entry of entries) {
      if (entry.hadConflictingHistory) {
        lines.push("-- CONFLICT: older versions disagreed with this value. Newest answer used.");
      }
      lines.push(
        `-- ${entry.column} = ${String(entry.value)} from version ${entry.fromVersionId} (${entry.fromVersionCreatedAt})`,
      );
    }

    const assignments = entries.map((e) => `${e.column} = ${String(e.value)}`).join(", ");
    // The `is null` guard applies to EVERY column being set, so a re-run can
    // never overwrite an answer a human gave between report and execution.
    const guards = entries.map((e) => `${e.column} is null`).join("\n    and ");

    lines.push(
      `update public.menu_items set ${assignments}`,
      `  where menu_version_id = '${targetVersionId}'`,
      `    and source_item_id = '${sourceItemId}'`,
      `    and ${guards};`,
      "",
    );
  }

  if (plan.blocked.length > 0) {
    lines.push(
      "-- ─────────────────────────────────────────────────────────────────",
      "-- NOT PROPOSED: recoverable in principle, but not safely on its own.",
      "-- These need a human to supply the missing half of the pair. They are",
      "-- listed rather than guessed, because the database is right to refuse",
      "-- half an answer and inventing the other half would be a fabrication.",
      "-- ─────────────────────────────────────────────────────────────────",
    );
    for (const b of plan.blocked) {
      lines.push(
        `--   ${b.source_item_id}: ${b.column} = ${String(b.value)} needs ${b.requires}`,
        `--     ${b.reason}`,
      );
    }
    lines.push("");
  }

  if (plan.recovered.length > 0) {
    lines.push("-- Review the row counts above before committing.", "commit;", "");
  } else {
    lines.push(
      "-- No statement is proposed: everything recoverable is blocked above and",
      "-- needs a human to supply the missing half. Nothing to run.",
      "",
    );
  }
  return lines.join("\n");
}
