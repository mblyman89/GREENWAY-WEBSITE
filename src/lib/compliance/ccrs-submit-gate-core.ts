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

export type GateSeverity = "error" | "warning";

/** A minimal issue shape both sync issues and verifier problems satisfy. */
export type GateIssueInput = {
  severity: GateSeverity;
  file: string;
  message: string;
  count?: number;
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
  /** where this issue came from, for the report. */
  source: "sync" | "verifier" | "file-warning";
};

export type CcrsSubmitVerdict = {
  submittable: boolean;
  errorCount: number;
  warningCount: number;
  errors: GateIssue[];
  warnings: GateIssue[];
  /** All issues (errors first) for a single ordered report. */
  issues: GateIssue[];
};

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
      source: "sync",
    });
  }
  for (const p of input.verifierProblems) {
    collected.push({
      severity: p.severity,
      file: String(p.file),
      message: p.message,
      count: p.count,
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

  // De-duplicate identical (severity+file+message) lines.
  const seen = new Set<string>();
  const deduped = collected.filter((i) => {
    const k = `${i.severity}|${i.file}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const errors = deduped.filter((i) => i.severity === "error");
  const warnings = deduped.filter((i) => i.severity === "warning");

  return {
    submittable: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    issues: [...errors, ...warnings],
  };
}

/** A short human summary line for banners/logs. PURE. */
export function verdictSummary(v: CcrsSubmitVerdict): string {
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

  if (failed === 0) console.log(`ccrs-submit-gate-core: all ${passed} tests passed`);
  return { passed, failed };
}
