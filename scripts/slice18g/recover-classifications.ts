/**
 * scripts/slice18g/recover-classifications.ts
 *
 * SLICE 18G — READ-ONLY report on the classifications DEFECT 3 erased.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS SCRIPT NEVER WRITES. NOT ONCE. NOT EVEN "SAFELY".
 * ─────────────────────────────────────────────────────────────────────────
 * There is no update, insert, upsert or delete anywhere in this file, and the
 * `--check-readonly` mode below proves that by inspecting this file's own
 * source. What it produces is a report and a block of SQL for a human to read.
 *
 * That restraint is the point. These four columns are what the register
 * enforces a statutory sales limit from. A bulk rewrite of them, executed by a
 * script, at a moment nobody chose, against rows nobody looked at, is a worse
 * failure mode than the blank it repairs — a wrong non-null value fails
 * CLOSED-looking and silently: the limit engages on the wrong products and
 * nobody sees a blank to investigate. The owner applies migrations by hand in
 * the Supabase SQL editor for exactly this reason, and this follows the same
 * discipline.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────
 *   # Prove the logic with no database and no credentials:
 *   npx tsx scripts/slice18g/recover-classifications.ts --demo
 *
 *   # Prove this file contains no write operation:
 *   npx tsx scripts/slice18g/recover-classifications.ts --check-readonly
 *
 *   # Against the real database (reads only):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/slice18g/recover-classifications.ts
 *
 * The recovery logic itself lives in src/lib/pos/classification-recovery-core.ts
 * and is covered behaviourally by tests/compliance/classification-recovery.test.ts.
 * This file is only the plumbing and the presentation.
 */
import { readFileSync } from "node:fs";
import {
  planClassificationRecovery,
  renderRecoverySql,
  type HistoricalRow,
  type RecoveryPlan,
} from "../../src/lib/pos/classification-recovery-core";

const args = new Set(process.argv.slice(2));

function summarise(plan: RecoveryPlan, targetVersionId: string): void {
  console.log("");
  console.log("=============================================================");
  console.log(" SLICE 18G - classification recovery report (READ ONLY)");
  console.log("=============================================================");
  console.log(`  recoverable values : ${plan.recovered.length}`);
  console.log(`  unrecoverable gaps : ${plan.gaps.length}`);
  console.log(`  left alone (already answered) : ${plan.untouchedCount}`);

  const conflicts = plan.recovered.filter((r) => r.hadConflictingHistory);
  console.log(`  values whose history disagreed : ${conflicts.length}`);

  const noHistory = plan.gaps.filter((g) => g.reason === "no-history").length;
  const neverSet = plan.gaps.filter((g) => g.reason === "history-all-null").length;
  console.log("");
  console.log("  Gaps break down as:");
  console.log(`    ${noHistory} column(s) on products with no earlier version at all`);
  console.log(`    ${neverSet} column(s) on products that were simply never classified`);
  console.log("");
  console.log("  Neither kind can be recovered, and neither should be guessed.");
  console.log("  They are the products a human still has to classify at the dock.");

  if (conflicts.length > 0) {
    console.log("");
    console.log("  CONFLICTS (older versions disagreed; newest answer proposed):");
    for (const c of conflicts.slice(0, 20)) {
      console.log(`    ${c.source_item_id}  ${c.column} = ${String(c.value)}  (from ${c.fromVersionCreatedAt})`);
    }
    if (conflicts.length > 20) console.log(`    ... and ${conflicts.length - 20} more`);
  }

  console.log("");
  console.log("-------------------------------------------------------------");
  console.log(" PROPOSED SQL - review before running any of it");
  console.log("-------------------------------------------------------------");
  console.log(renderRecoverySql(plan, targetVersionId));
}

/**
 * --check-readonly : assert, from this file's own text, that it cannot write.
 *
 * A promise in a comment is worth nothing. This makes the promise checkable,
 * and it is scoped to the executable lines so the very words being forbidden
 * can still be discussed in the prose above.
 */
if (args.has("--check-readonly")) {
  const src = readFileSync(new URL(import.meta.url).pathname, "utf8");
  const code = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");

  // The needles are ASSEMBLED at runtime rather than written out as literals.
  //
  // Written literally, this list would match itself: the check reported five
  // write operations on its very first run, against a file that writes
  // nothing. The fix is to stop the guard tripping over its own definition,
  // NOT to loosen what it forbids -- the same five operations are still
  // rejected, and a real `.update(` call anywhere in the executable lines
  // still fails the check (proved in restage-plumbing.test.ts).
  const forbidden = ["update", "insert", "upsert", "delete", "rpc"].map((op) => `.${op}(`);
  const found = forbidden.filter((op) => code.includes(op));
  if (found.length > 0) {
    console.error(`FAIL: this script contains write operations: ${found.join(", ")}`);
    process.exit(1);
  }
  console.log("OK: no write operation appears in the executable lines of this script.");
  process.exit(0);
}

/**
 * --demo : run the planner on a worked example, with no database.
 *
 * This exists so the report can be reviewed and trusted before it is ever
 * pointed at production, and so the output format can be checked by eye.
 */
if (args.has("--demo")) {
  const current: HistoricalRow[] = [
    { source_item_id: "SUPP-1", menu_version_id: "v3", version_created_at: "2026-03-01T00:00:00Z" },
    { source_item_id: "BEV-1", menu_version_id: "v3", version_created_at: "2026-03-01T00:00:00Z" },
    {
      source_item_id: "ALREADY-OK",
      menu_version_id: "v3",
      version_created_at: "2026-03-01T00:00:00Z",
      otherwise_taken: true,
      units_per_package: 2,
      low_thc_liquid: false,
      unit_thc_mg: 5,
    },
  ];
  const history: HistoricalRow[] = [
    {
      source_item_id: "SUPP-1",
      menu_version_id: "v1",
      version_created_at: "2026-01-01T00:00:00Z",
      otherwise_taken: true,
      units_per_package: 6,
    },
    {
      source_item_id: "SUPP-1",
      menu_version_id: "v2",
      version_created_at: "2026-02-01T00:00:00Z",
      otherwise_taken: true,
      units_per_package: 4,
    },
    {
      source_item_id: "BEV-1",
      menu_version_id: "v1",
      version_created_at: "2026-01-01T00:00:00Z",
      low_thc_liquid: false,
    },
  ];

  console.log("DEMO MODE - worked example, no database was contacted.");
  summarise(planClassificationRecovery(current, history), "v3");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode. Reads only.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Run with --demo to see the report format without a database, or\n" +
        "--check-readonly to verify this script cannot write.",
    );
    process.exit(2);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: versions, error: vErr } = await db
    .from("menu_versions")
    .select("id, status, created_at")
    .order("created_at", { ascending: false });
  if (vErr || !versions) {
    console.error("Could not read menu_versions:", vErr?.message);
    process.exit(1);
  }

  const published = (versions as { id: string; status: string; created_at: string }[]).find(
    (v) => v.status === "published",
  );
  if (!published) {
    console.error("There is no published menu version, so there is nothing to repair.");
    process.exit(1);
  }

  const createdAtById = new Map(
    (versions as { id: string; created_at: string }[]).map((v) => [v.id, v.created_at]),
  );

  const COLS = "source_item_id, menu_version_id, low_thc_liquid, unit_thc_mg, otherwise_taken, units_per_package";

  const { data: currentRaw, error: cErr } = await db
    .from("menu_items")
    .select(COLS)
    .eq("menu_version_id", published.id);
  if (cErr || !currentRaw) {
    console.error("Could not read the published rows:", cErr?.message);
    process.exit(1);
  }

  const { data: historyRaw, error: hErr } = await db
    .from("menu_items")
    .select(COLS)
    .neq("menu_version_id", published.id);
  if (hErr || !historyRaw) {
    console.error("Could not read historical rows:", hErr?.message);
    process.exit(1);
  }

  const withDate = (rows: unknown[]): HistoricalRow[] =>
    (rows as Omit<HistoricalRow, "version_created_at">[]).map((r) => ({
      ...r,
      version_created_at: createdAtById.get(r.menu_version_id) ?? "",
    }));

  console.log(`Published version ${published.id} (${published.created_at})`);
  console.log(`  ${currentRaw.length} live row(s), ${historyRaw.length} historical row(s).`);

  summarise(planClassificationRecovery(withDate(currentRaw), withDate(historyRaw)), published.id);
}

void main();
