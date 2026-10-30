/**
 * src/lib/compliance/ccrs-submit-gate-core.ts  (Slice 105)
 *
 * PURE, authoritative "is this CCRS batch safe to submit to the LCB?" gate. This
 * is the single decision point that BLOCKS a malformed batch from being exported
 * — turning compliance from "validates on demand" into "refuses the dangerous
 * action." No I/O, no `server-only`; tsx-testable.
 *
 * It consolidates every problem source into one severity-classified verdict:
 *   1. builder sync issues       (CcrsSyncIssue[] from ccrs-batch.ts)
 *   2. offline verifier problems (verifyCcrsBatch problems from ccrs-batch-core)
 *   3. per-file warnings         (each CcrsFile.warnings[]) — classified with
 *      the SAME classifyWarning() the app already trusts, so an ERROR-prefixed
 *      warning (e.g. a bad product classification) is treated as blocking, not
 *      buried as advisory. This closes the Slice 93 concern at the gate.
 *
 * Verdict: `submittable` is true ONLY when there are zero blocking errors. The
 * export route MUST refuse to emit CSVs when submittable === false.
 *
 * Grounded: WA LCB CCRS retailer file spec — the LCB validates files in
 * dependency order (Strain/Area/Product → Inventory → Adjustment/Transfer/Sale)
 * and rejects the batch and every dependent file on any structural error.
 */

import { mergeRows, type DisplayRow } from "./ccrs-issue-display-core";

export type GateSeverity = "error" | "warning";

/** A minimal issue shape both sync issues and verifier problems satisfy. */
export type GateIssueInput = {
  severity: GateSeverity;
  file: string;
  message: string;
  count?: number;
  /** S-17a: coded issue id (CCRS_ISSUE_CODES) — carried, never dropped. */
  code?: string;
  /** S-17a: spec pin for the code. */
  specPin?: string;
  /** S-17a: EVERY affected row with its reason. Never capped (Part 05 §H). */
  rows?: readonly DisplayRow[];
};

/** A CCRS file carrying its own advisory/blocking warning strings. */
export type GateFileInput = {
  type: string;
  warnings: readonly string[];
  recordCount?: number;
  empty?: boolean;
};

export type GateIssue = {
  severity: GateSeverity;
  file: string;
  message: string;
  count?: number;
  code?: string;
  specPin?: string;
  /** S-17a: every affected row (Part 17 §C.4 defect 1 — these used to be dropped here). */
  rows?: DisplayRow[];
  /** where this issue came from, for the report. */
  source: "sync" | "verifier" | "file-warning";
};

export type CcrsSubmitVerdict = {
  submittable: boolean;
  errorCount: number;
  warningCount: number;
  errors: GateIssue[];
  warnings: GateIssue[];
  /**
   * R74 S39: records HELD BACK. Their rows were left out of the files (so the
   * files are correct without them); they wait until fixed and are reported
   * by a later batch. They never block the good records.
   */
  held: GateIssue[];
  heldCount: number;
  /** All issues (errors, then held, then warnings) for a single ordered report. */
  issues: GateIssue[];
};

/**
 * R74 S39 (owner, Round 19): "we can not be blocked from reporting to the
 * state ... we cant block good records from being uploaded". Each code below
 * is raised ONLY for rows the builder already LEFT OUT of every file, so the
 * files are complete and correct without them; CCRS accepts row by row
 * (U-17 CLOSED FALSE). Every other error still blocks: it means a row IN a
 * file would be rejected, or the whole batch is unsafe (license, E53).
 * R74 S42: E9, E11, an unknown type (E57), ledger duplicates (E59) and rows
 * the verifier / ledger self-check refuse (E60) are held back too.
 */
export const HELD_BACK_CODES: ReadonlySet<string> = new Set([
  "E3_EXTERNAL_ID_UNASSIGNED",
  "E7_TOTALCOST_ZERO",
  "E8_ONHAND_GT_INITIAL",
  "E38_FIELD_HAS_LINE_BREAK",
  "E42_FIELD_HAS_COMMA",
  "E41_LEDGER_WITHHELD",
  "E49_SALE_LINE_ALREADY_HELD",
  "E52_CULTIVERA_LOT_NOT_ON_RECORD",
  "E56_EVENT_ROW_LOT_HELD",
  "E14_TRANSFER_FIELD_MISSING",
  "E14_TRANSFER_VENDOR_ID_UNKNOWN",
  "E14_TRANSFER_SAME_LICENSE",
  "E14_TRANSFER_QUANTITY",
  // R74 S42 (owner, Round 22): "remove all blockers ... the records we have
  // that are factual are able to be uploaded no matter what". Each of these
  // now LEAVES its rows (and every row that would name them) out of the files.
  "E9_UNITWEIGHT_ZERO_USABLE",
  "E11_STRAIN_NAME_RESERVED",
  "E57_PRODUCT_TYPE_UNKNOWN",
  "E46_AREA_LEDGER",
  "E59_LEDGER_DUPLICATE_HELD",
  "E60_ROW_REFUSED_HELD",
  // W-3: an adjustment whose CCRS state is unproven (or the ledger could not
  // be read) is left out of InventoryAdjustment.csv and owed. (E61 in-flight
  // holds are advisory warnings: those rows were sent, they are not owed.)
  "E62_ADJUSTMENT_LEDGER",
  // C1: a transfer correction waiting for the owner's approval is left out of
  // InventoryTransfer.csv (CCRS keeps the accepted values) and owed.
  "E63_TRANSFER_CORRECTION_PENDING",
]);

/** True when an error-severity issue only describes rows left out of the files. */
export function isHeldBack(i: { severity: GateSeverity; code?: string }): boolean {
  return i.severity === "error" && !!i.code && HELD_BACK_CODES.has(i.code);
}

/**
 * S-17a: the ONE mapping from a builder sync issue to gate input. Every caller
 * (hub page, compliance report, batch-export route) uses this instead of a
 * hand-written `{severity, file, message, count}` literal — that literal is
 * exactly how the 2026-10-19 hub lost the rows of "17 lot(s) were left out"
 * (Part 17 §C.4 defect 1). A source test pins that no caller maps by hand.
 */
export function toGateInput(s: {
  severity: GateSeverity;
  file: string;
  message: string;
  count?: number;
  code?: string;
  specPin?: string;
  rows?: readonly DisplayRow[];
}): GateIssueInput {
  return {
    severity: s.severity,
    file: String(s.file),
    message: s.message,
    count: s.count,
    code: s.code,
    specPin: s.specPin,
    rows: s.rows,
  };
}

/**
 * The default warning classifier. A warning whose message begins with "ERROR"
 * (case-insensitive) is BLOCKING; everything else is advisory. This mirrors the
 * app's existing `classifyWarning` in ccrs-batch-core. Injectable for testing
 * and so callers can pass the real one to stay perfectly in sync.
 */
export function defaultClassifyWarning(message: string | null | undefined): GateSeverity {
  const m = (message ?? "").trim().toLowerCase();
  return m.startsWith("error") ? "error" : "warning";
}

/**
 * Compute the submit verdict. PURE. Pass the real `classifyWarning` from
 * ccrs-batch-core to keep classification identical to the rest of the app.
 */
export function assertCcrsBatchSubmittable(input: {
  syncIssues: readonly GateIssueInput[];
  verifierProblems: readonly GateIssueInput[];
  files: readonly GateFileInput[];
  classifyWarning?: (message: string | null | undefined) => GateSeverity;
}): CcrsSubmitVerdict {
  const classify = input.classifyWarning ?? defaultClassifyWarning;
  const collected: GateIssue[] = [];

  for (const s of input.syncIssues) {
    collected.push({
      severity: s.severity,
      file: String(s.file),
      message: s.message,
      count: s.count,
      code: s.code,
      specPin: s.specPin,
      rows: s.rows ? [...s.rows] : undefined,
      source: "sync",
    });
  }
  for (const p of input.verifierProblems) {
    collected.push({
      severity: p.severity,
      file: String(p.file),
      message: p.message,
      count: p.count,
      code: p.code,
      specPin: p.specPin,
      rows: p.rows ? [...p.rows] : undefined,
      source: "verifier",
    });
  }
  for (const f of input.files) {
    for (const w of f.warnings) {
      collected.push({
        severity: classify(w),
        file: String(f.type),
        message: w,
        source: "file-warning",
      });
    }
  }

  // De-duplicate identical (severity+file+message) lines. S-17a: a dropped
  // duplicate's rows are MERGED into the kept issue, never lost.
  const kept = new Map<string, GateIssue>();
  const deduped: GateIssue[] = [];
  for (const i of collected) {
    const k = `${i.severity}|${i.file}|${i.message}`;
    const prev = kept.get(k);
    if (prev) {
      prev.rows = mergeRows(prev.rows, i.rows);
      continue;
    }
    kept.set(k, i);
    deduped.push(i);
  }

  const held = deduped.filter((i) => isHeldBack(i));
  const errors = deduped.filter((i) => i.severity === "error" && !isHeldBack(i));
  const warnings = deduped.filter((i) => i.severity === "warning");

  return {
    submittable: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    held,
    heldCount: held.length,
    issues: [...errors, ...held, ...warnings],
  };
}

/** A short human summary line for banners/logs. PURE. */
export function verdictSummary(v: CcrsSubmitVerdict): string {
  if (v.submittable && v.heldCount > 0) {
    return `Safe to submit the good records — ${v.heldCount} group(s) of records are held back (left out of the files) until fixed${v.warningCount > 0 ? `; ${v.warningCount} advisory warning(s)` : ""}.`;
  }
  if (v.submittable) {
    return v.warningCount > 0
      ? `Safe to submit — ${v.warningCount} advisory warning(s) to review.`
      : "Safe to submit — no problems detected.";
  }
  return `DO NOT UPLOAD — ${v.errorCount} blocking error(s) must be fixed first.`;
}

// ── Self-tests (tsx) ────────────────────────────────────────────────────────

export function __runCcrsSubmitGateTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // Clean batch → submittable.
  const clean = assertCcrsBatchSubmittable({
    syncIssues: [],
    verifierProblems: [],
    files: [{ type: "Product", warnings: ["Product X: name truncated"] }],
  });
  ok(clean.submittable, "clean batch submittable");
  ok(clean.errorCount === 0 && clean.warningCount === 1, "advisory warning counted, not blocking");

  // A sync ERROR blocks.
  const syncErr = assertCcrsBatchSubmittable({
    syncIssues: [{ severity: "error", file: "General", message: "Supabase not configured." }],
    verifierProblems: [],
    files: [],
  });
  ok(!syncErr.submittable && syncErr.errorCount === 1, "sync error blocks");

  // A verifier ERROR blocks.
  const verErr = assertCcrsBatchSubmittable({
    syncIssues: [],
    verifierProblems: [{ severity: "error", file: "Sale", message: "NumberRecords mismatch." }],
    files: [],
  });
  ok(!verErr.submittable, "verifier error blocks");

  // An ERROR-prefixed file warning is promoted to blocking (Slice 93 concern).
  const fileErr = assertCcrsBatchSubmittable({
    syncIssues: [],
    verifierProblems: [],
    files: [
      {
        type: "Product",
        warnings: ['ERROR — Product "Gummies": invalid category. Fix the CCRS mapping before submitting.'],
      },
    ],
  });
  ok(!fileErr.submittable && fileErr.errorCount === 1, "ERROR-prefixed file warning blocks");

  // Dedup identical lines.
  const dup = assertCcrsBatchSubmittable({
    syncIssues: [{ severity: "error", file: "Sale", message: "bad" }],
    verifierProblems: [{ severity: "error", file: "Sale", message: "bad" }],
    files: [],
  });
  ok(dup.errorCount === 1, "identical issues de-duplicated");

  // Errors sort before warnings in issues[].
  const mixed = assertCcrsBatchSubmittable({
    syncIssues: [{ severity: "warning", file: "Area", message: "advisory" }],
    verifierProblems: [{ severity: "error", file: "Sale", message: "blocking" }],
    files: [],
  });
  ok(mixed.issues[0].severity === "error", "errors first in issues[]");

  // Summary strings.
  ok(verdictSummary(clean).startsWith("Safe to submit"), "clean summary");
  ok(verdictSummary(syncErr).startsWith("DO NOT UPLOAD"), "blocked summary");

  // Injected classifier is honored.
  const custom = assertCcrsBatchSubmittable({
    syncIssues: [],
    verifierProblems: [],
    files: [{ type: "Product", warnings: ["CRITICAL bad thing"] }],
    classifyWarning: (m) => ((m ?? "").startsWith("CRITICAL") ? "error" : "warning"),
  });
  ok(!custom.submittable, "injected classifier honored");

  // S-17a: rows, code and specPin survive the gate; a duplicate's rows merge.
  const withRows = assertCcrsBatchSubmittable({
    syncIssues: [
      { severity: "error", file: "Inventory", message: "withheld", code: "E41_LEDGER_WITHHELD", specPin: "[G L0246-L0248]", rows: [{ id: "l1", label: "L1", detail: "r1" }] },
      { severity: "error", file: "Inventory", message: "withheld", rows: [{ id: "l2", label: "L2", detail: "r2" }] },
    ],
    verifierProblems: [],
    files: [],
  });
  // (E41 is a held-back code since S39, so the merged issue is in `held`.)
  ok(withRows.held.length === 1 && withRows.errors.length === 0, "duplicate collapsed");
  ok(withRows.held[0].rows?.length === 2, "duplicate's rows merged, none lost");
  ok(withRows.held[0].code === "E41_LEDGER_WITHHELD" && withRows.held[0].specPin === "[G L0246-L0248]", "code + pin carried");

  // R74 S39: held-back codes never block; a genuine error still does.
  const heldOnly = assertCcrsBatchSubmittable({
    syncIssues: [
      { severity: "error", file: "Inventory", message: "849 held", code: "E52_CULTIVERA_LOT_NOT_ON_RECORD" },
      { severity: "error", file: "Product", message: "no id", code: "E41_LEDGER_WITHHELD" },
    ],
    verifierProblems: [],
    files: [],
  });
  ok(heldOnly.submittable && heldOnly.heldCount === 2 && heldOnly.errorCount === 0, "S39: held-back issues do not block");
  ok(verdictSummary(heldOnly).includes("held back"), "S39: summary names the held records");
  const heldPlusReal = assertCcrsBatchSubmittable({
    syncIssues: [
      { severity: "error", file: "Inventory", message: "held", code: "E52_CULTIVERA_LOT_NOT_ON_RECORD" },
      { severity: "error", file: "Sale", message: "ref", code: "L_REF_INVENTORY" },
    ],
    verifierProblems: [],
    files: [],
  });
  ok(!heldPlusReal.submittable && heldPlusReal.errors[0].code === "L_REF_INVENTORY", "S39: a row IN a file that CCRS would reject still blocks");
  ok(!isHeldBack({ severity: "warning", code: "E41_LEDGER_WITHHELD" }) && !isHeldBack({ severity: "error" }), "S39: only coded errors are held");

  if (failed === 0) console.log(`ccrs-submit-gate-core: all ${passed} tests passed`);
  return { passed, failed };
}
