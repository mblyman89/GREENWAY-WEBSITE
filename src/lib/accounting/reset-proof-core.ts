/**
 * src/lib/accounting/reset-proof-core.ts — Round 5 / Slice R5-2 (PURE).
 *
 * The owner's "Clean Slate" plan: rehearse receiving, sales, customer returns,
 * destructions and vendor returns on real manifests, then run the factory
 * reset, then go live. This module PROVES the reset did that, from the
 * database's own answer, instead of trusting `ok: true`:
 *
 *   - verifyResetSummary(tables, plan): gl_factory_reset (0240) returns
 *     `tables` = { table -> rows it counted and then truncated }. Every WIPE
 *     table of the plan must be in it; no KEEP table (the knowledge base, the
 *     CCRS ledger, settings, people) may be. Anything else is a named problem
 *     that the action records in the audit row and shows the owner.
 *   - summariseOpenCcrsFiles(rows): the reset KEEPS the CCRS ledger
 *     (ccrs_files and friends: those files are the State's, not ours), so a
 *     file the State has not answered yet is still open after the reset. The
 *     reset screen names them so the owner answers or abandons them first.
 *
 * This does not change what the reset deletes (0240 and factory-reset-core.ts
 * own that, guarded by d82-factory-reset-scales.test.ts). It only checks it.
 */
import type { ResetPlan } from "./factory-reset-core";

/**
 * The tables the Clean Slate rehearsal writes. Each must be WIPE and in the
 * 0240 truncate list (tests/compliance/r5-reset-proof.test.ts checks both
 * against the real files). Grouped the way the rehearsal touches them.
 */
export const REHEARSAL_ACTIVITY_TABLES: readonly string[] = [
  // receiving a manifest
  "inbound_manifests",
  "manifest_events",
  "manifest_documents",
  "vendor_manifest_payments",
  "inventory_lots",
  "lab_results",
  "purchase_orders",
  "purchase_order_lines",
  // selling (register and online)
  "orders",
  "order_lines",
  "order_events",
  "pos_sale_events",
  "receipt_print_jobs",
  "sales_limit_events",
  "medical_exempt_sales",
  "special_discount_uses",
  "drawer_sessions",
  "drawer_counts",
  // customer returns, destructions, vendor returns, samples, counts
  "customer_returns",
  "destruction_events",
  "vendor_returns",
  "trade_sample_events",
  "inventory_adjustments",
  "cycle_counts",
  "cycle_count_lines",
  // CCRS export records made by the rehearsal (the ledger itself is KEPT)
  "ccrs_export_batches",
  "ccrs_adjustment_batches",
  "ccrs_week_submissions",
  // customers and loyalty created at the register
  "customers",
  "loyalty_accounts",
  "loyalty_ledger",
  "loyalty_redemptions",
  // the books the rehearsal posted to
  "gl_journals",
  "gl_journal_lines",
  "excise_return_drafts",
  "excise_return_batches",
];

/**
 * The CCRS ledger: what the State already holds. KEPT by the reset
 * (factory-reset-core.ts) because wiping it would make the next export
 * re-Insert ids CCRS already has.
 */
export const CCRS_LEDGER_KEEP: readonly string[] = [
  "ccrs_files",
  "ccrs_filed_entities",
  "ccrs_file_rows",
  "ccrs_file_issues",
  "ccrs_file_contents",
  "ccrs_mail_messages",
  "ccrs_product_ids",
];

export type ResetProofProblemCode =
  | "PLAN_REFUSED"
  | "REPORT_EMPTY"
  | "REHEARSAL_TABLE_NOT_EMPTIED"
  | "WIPE_TABLE_NOT_EMPTIED"
  | "KNOWLEDGE_BASE_EMPTIED"
  | "CCRS_LEDGER_EMPTIED"
  | "KEEP_TABLE_EMPTIED"
  | "UNCLASSIFIED_TABLE_EMPTIED";

export type ResetProofProblem = { problem: ResetProofProblemCode; detail: string };

const list = (xs: string[]) => [...xs].sort().join(", ");

/**
 * Check the database's own per-table report against the plan. Empty array =
 * the reset emptied exactly the WIPE set. Problems come out in a fixed order.
 */
export function verifyResetSummary(tables: Readonly<Record<string, unknown>>, plan: ResetPlan): ResetProofProblem[] {
  if (!plan.ok) {
    return [{ problem: "PLAN_REFUSED", detail: "the reset rules do not match the schema, so the report cannot be checked against them" }];
  }
  const reported = new Set(Object.keys(tables ?? {}).map((t) => t.trim().toLowerCase()));
  if (reported.size === 0) {
    return [{ problem: "REPORT_EMPTY", detail: "the database reported no tables emptied; the reset result cannot be confirmed" }];
  }
  const wipe = new Set(plan.wipe.map((c) => c.table));
  const keep = new Set(plan.keep.map((c) => c.table));
  const out: ResetProofProblem[] = [];

  const rehearsalMissing = REHEARSAL_ACTIVITY_TABLES.filter((t) => !reported.has(t));
  if (rehearsalMissing.length > 0) {
    out.push({ problem: "REHEARSAL_TABLE_NOT_EMPTIED", detail: `test activity may remain in: ${list(rehearsalMissing)}` });
  }
  const rehearsal = new Set(REHEARSAL_ACTIVITY_TABLES);
  const wipeMissing = [...wipe].filter((t) => !reported.has(t) && !rehearsal.has(t));
  if (wipeMissing.length > 0) {
    out.push({ problem: "WIPE_TABLE_NOT_EMPTIED", detail: `the database did not report emptying: ${list(wipeMissing)}` });
  }
  const extra = [...reported].filter((t) => !wipe.has(t));
  const kb = extra.filter((t) => t.startsWith("kb_"));
  const ccrs = extra.filter((t) => CCRS_LEDGER_KEEP.includes(t));
  const otherKeep = extra.filter((t) => keep.has(t) && !kb.includes(t) && !ccrs.includes(t));
  const unknown = extra.filter((t) => !keep.has(t) && !kb.includes(t) && !ccrs.includes(t));
  if (kb.length > 0) out.push({ problem: "KNOWLEDGE_BASE_EMPTIED", detail: `knowledge-base tables were emptied: ${list(kb)}` });
  if (ccrs.length > 0) out.push({ problem: "CCRS_LEDGER_EMPTIED", detail: `CCRS ledger tables were emptied (the next export may re-Insert ids the State holds): ${list(ccrs)}` });
  if (otherKeep.length > 0) out.push({ problem: "KEEP_TABLE_EMPTIED", detail: `tables that should be kept were emptied: ${list(otherKeep)}` });
  if (unknown.length > 0) out.push({ problem: "UNCLASSIFIED_TABLE_EMPTIED", detail: `tables with no reset rule were emptied: ${list(unknown)}` });
  return out;
}

/* ------------------------------------------------------------------ *
 * Open CCRS files (the kept ledger)
 * ------------------------------------------------------------------ */

export type OpenCcrsFileRow = { env: string; state: string; file_name: string; file_type: string };
export type OpenCcrsSummary = {
  total: number;
  byEnv: { preprod: number; prod: number };
  files: { env: string; state: string; fileName: string; fileType: string }[];
  message: string;
};

/** ccrs-file-state-core CCRS_FILE_TERMINAL; anything else (unknown included) is open. */
const TERMINAL = new Set(["closed", "abandoned"]);

export function summariseOpenCcrsFiles(rows: readonly OpenCcrsFileRow[]): OpenCcrsSummary | null {
  const open = rows.filter((r) => !TERMINAL.has(r.state));
  if (open.length === 0) return null;
  const files = open
    .map((r) => ({ env: r.env, state: r.state, fileName: r.file_name, fileType: r.file_type }))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  const byEnv = { preprod: open.filter((r) => r.env === "preprod").length, prod: open.filter((r) => r.env === "prod").length };
  return {
    total: open.length,
    byEnv,
    files,
    message:
      `${open.length} CCRS file(s) still wait for an answer (PREprod ${byEnv.preprod}, production ${byEnv.prod}). ` +
      `The reset keeps the CCRS ledger (those files are the State's record, not test data), so these stay open afterwards. ` +
      `Record each one's outcome in the CCRS hub, or abandon a file you never uploaded, before or after the reset.`,
  };
}

/* ------------------------------------------------------------------ *
 * Self-tests (PURE)
 * ------------------------------------------------------------------ */

export function __runResetProofTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`reset-proof-core FAIL: ${name}`);
    }
  };
  const c = (table: string, disposition: "WIPE" | "KEEP") => ({ table, disposition, because: "t", source: "table" as const });
  const plan: ResetPlan = {
    ok: true,
    wipe: [...REHEARSAL_ACTIVITY_TABLES, "ai_usage"].map((t) => c(t, "WIPE")),
    keep: ["kb_strains", "ccrs_files", "vendors"].map((t) => c(t, "KEEP")),
  };
  const full = Object.fromEntries(plan.wipe.map((x) => [x.table, 0]));
  ok(verifyResetSummary(full, plan).length === 0, "exact report is clean");
  ok(verifyResetSummary({}, plan)[0]?.problem === "REPORT_EMPTY", "empty report named");
  const { vendor_returns: _v, ...noVr } = full;
  void _v;
  ok(verifyResetSummary(noVr, plan)[0]?.problem === "REHEARSAL_TABLE_NOT_EMPTIED", "missing rehearsal table named");
  const { ai_usage: _a, ...noAi } = full;
  void _a;
  ok(verifyResetSummary(noAi, plan)[0]?.problem === "WIPE_TABLE_NOT_EMPTIED", "missing wipe table named");
  ok(verifyResetSummary({ ...full, kb_strains: 1 }, plan)[0]?.problem === "KNOWLEDGE_BASE_EMPTIED", "kb emptied named");
  ok(verifyResetSummary({ ...full, ccrs_files: 1 }, plan)[0]?.problem === "CCRS_LEDGER_EMPTIED", "ccrs emptied named");
  ok(verifyResetSummary({ ...full, vendors: 1 }, plan)[0]?.problem === "KEEP_TABLE_EMPTIED", "keep emptied named");
  ok(verifyResetSummary({ ...full, zzz: 1 }, plan)[0]?.problem === "UNCLASSIFIED_TABLE_EMPTIED", "unknown emptied named");
  ok(verifyResetSummary(full, { ok: false, refusals: [] })[0]?.problem === "PLAN_REFUSED", "refused plan named");
  ok(summariseOpenCcrsFiles([{ env: "prod", state: "closed", file_name: "a", file_type: "Sale" }]) === null, "closed ignored");
  const s = summariseOpenCcrsFiles([
    { env: "prod", state: "uploaded", file_name: "b", file_type: "Sale" },
    { env: "preprod", state: "nonsense", file_name: "a", file_type: "Sale" },
  ]);
  ok(s?.total === 2 && s.byEnv.prod === 1 && s.byEnv.preprod === 1 && s.files[0].fileName === "a", "open counted, unknown open, sorted");
  return { passed, failed };
}
