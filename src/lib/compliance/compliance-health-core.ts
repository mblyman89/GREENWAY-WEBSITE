/**
 * src/lib/compliance/compliance-health-core.ts  (Slice 110)
 *
 * PURE aggregator for the read-only "Compliance Health" panel — one screen that
 * runs every gate built in Slices 105–109 and answers "am I safe right now?".
 *
 * It does NO I/O: the server reader gathers the facts from each subsystem and
 * passes them in; this module turns them into a prioritized, colour-coded
 * report. Keeping it pure means the whole scoring is tsx-testable and can never
 * silently drift from the individual gate cores.
 *
 * Severity model:
 *   • "critical" — an active violation risk (a red gate is tripped).
 *   • "warning"  — needs attention soon (a due-soon deadline, pending items).
 *   • "ok"       — the check passed.
 *   • "unknown"  — we couldn't read the data (service not configured / error);
 *                  surfaced honestly rather than shown as green.
 */

export type HealthLevel = "critical" | "warning" | "ok" | "unknown";

export type HealthCheck = {
  key: string;
  title: string;
  level: HealthLevel;
  /** One-line status summary. */
  summary: string;
  /** Optional supporting detail lines. */
  details?: string[];
};

export type ComplianceHealthReport = {
  /** Worst level across all checks (critical > warning > unknown > ok). */
  overall: HealthLevel;
  checks: HealthCheck[];
  criticalCount: number;
  warningCount: number;
};

/** Facts the server reader supplies, one field per gate. */
export type ComplianceHealthFacts = {
  ccrsBatch?: {
    available: boolean;
    /** Days since the most recent CCRS export was generated (null if never). */
    daysSinceLastExport: number | null;
    /** The weekly upload cadence in days used to judge staleness (default 7). */
    weeklyWindowDays: number;
    /** ISO date of the most recent export (informational). */
    lastExportDate?: string;
  };
  deadline?: {
    available: boolean;
    anyOverdue: boolean;
    mostUrgent?: {
      periodLabel: string;
      dueDate: string;
      status: string;
      daysUntilDue: number;
    } | null;
  };
  dirtyLots?: {
    available: boolean;
    /** Lots stuck in quarantine that cannot go live (missing id/COA/failed). */
    heldCount: number;
  };
  medicalCards?: {
    available: boolean;
    activeCards: number;
    /** Active cards expiring within the look-ahead window. */
    expiringSoon: number;
    /** Cards already expired but still marked active. */
    expired: number;
  };
  exemptRecords?: {
    available: boolean;
    /** Exempt sale records missing a required field (incomplete). */
    incomplete: number;
    checked: number;
  };
  salesLimit?: {
    available: boolean;
    enforce: boolean;
    hardBlock: boolean;
    /** Over-limit overrides authorized in the recent window. */
    recentOverrides: number;
  };
};

const RANK: Record<HealthLevel, number> = { critical: 3, warning: 2, unknown: 1, ok: 0 };

function worst(levels: HealthLevel[]): HealthLevel {
  return levels.reduce<HealthLevel>((acc, l) => (RANK[l] > RANK[acc] ? l : acc), "ok");
}

/** Build the full report from facts. PURE. Missing facts → an "unknown" check. */
export function buildComplianceHealth(facts: ComplianceHealthFacts): ComplianceHealthReport {
  const checks: HealthCheck[] = [];

  // 1) CCRS upload cadence (Slices 105 + 106 context).
  //    CCRS inventory/transfer/adjustment files are a WEEKLY upload obligation
  //    (LCB CCRS Upload User Guide; WAC 314-55-083(4) "kept completely up to
  //    date"). We judge staleness by how long it has been since the operator
  //    last GENERATED an export from this back office. A stale log (older than
  //    the weekly window) is a real "you may be behind on uploads" warning; a
  //    log that has NEVER produced an export is surfaced as a warning too, not
  //    as a falsely-green all-clear. The Slice-105 hard gate at export time is
  //    what guarantees any batch that IS produced is well-formed.
  {
    const f = facts.ccrsBatch;
    if (!f || !f.available) {
      checks.push({
        key: "ccrs_batch",
        title: "CCRS upload cadence (weekly)",
        level: "unknown",
        summary: "Could not read the CCRS export log.",
      });
    } else if (f.daysSinceLastExport === null) {
      checks.push({
        key: "ccrs_batch",
        title: "CCRS upload cadence (weekly)",
        level: "warning",
        summary: "No CCRS export has ever been generated from this back office.",
        details: ["CCRS inventory files are a weekly upload obligation — generate and upload an export."],
      });
    } else if (f.daysSinceLastExport > f.weeklyWindowDays) {
      checks.push({
        key: "ccrs_batch",
        title: "CCRS upload cadence (weekly)",
        level: "warning",
        summary: `Last CCRS export was ${f.daysSinceLastExport} day(s) ago — past the weekly cadence.`,
        details: f.lastExportDate ? [`Most recent export: ${f.lastExportDate}.`] : undefined,
      });
    } else {
      checks.push({
        key: "ccrs_batch",
        title: "CCRS upload cadence (weekly)",
        level: "ok",
        summary: `Last CCRS export was ${f.daysSinceLastExport} day(s) ago — within the weekly cadence.`,
        details: f.lastExportDate ? [`Most recent export: ${f.lastExportDate}.`] : undefined,
      });
    }
  }

  // 2) Monthly reporting deadline (Slice 106).
  {
    const f = facts.deadline;
    if (!f || !f.available) {
      checks.push({
        key: "deadline",
        title: "Monthly report deadline (LIQ-1295)",
        level: "unknown",
        summary: "Could not evaluate the reporting-deadline status.",
      });
    } else if (f.anyOverdue) {
      const u = f.mostUrgent;
      checks.push({
        key: "deadline",
        title: "Monthly report deadline (LIQ-1295)",
        level: "critical",
        summary: u
          ? `OVERDUE — ${u.periodLabel} was due ${u.dueDate} (${Math.abs(u.daysUntilDue)} day(s) ago).`
          : "A monthly report is overdue.",
      });
    } else if (f.mostUrgent && (f.mostUrgent.status === "due_soon" || f.mostUrgent.status === "due_today")) {
      const u = f.mostUrgent;
      checks.push({
        key: "deadline",
        title: "Monthly report deadline (LIQ-1295)",
        level: "warning",
        summary:
          u.status === "due_today"
            ? `${u.periodLabel} is DUE TODAY (${u.dueDate}).`
            : `${u.periodLabel} is due in ${u.daysUntilDue} day(s) (${u.dueDate}).`,
      });
    } else {
      checks.push({
        key: "deadline",
        title: "Monthly report deadline (LIQ-1295)",
        level: "ok",
        summary: "No monthly report is overdue or due soon.",
      });
    }
  }

  // 3) Dirty inventory lots held in quarantine (Slice 107).
  {
    const f = facts.dirtyLots;
    if (!f || !f.available) {
      checks.push({
        key: "dirty_lots",
        title: "Inventory can-go-live gate",
        level: "unknown",
        summary: "Could not evaluate held inventory lots.",
      });
    } else if (f.heldCount > 0) {
      checks.push({
        key: "dirty_lots",
        title: "Inventory can-go-live gate",
        level: "warning",
        summary: `${f.heldCount} lot(s) held in quarantine — missing CCRS id, COA, or a failed lab result.`,
      });
    } else {
      checks.push({
        key: "dirty_lots",
        title: "Inventory can-go-live gate",
        level: "ok",
        summary: "No dirty lots are stuck in quarantine.",
      });
    }
  }

  // 4) Medical recognition cards (expiry).
  {
    const f = facts.medicalCards;
    if (!f || !f.available) {
      checks.push({
        key: "medical_cards",
        title: "Medical recognition cards",
        level: "unknown",
        summary: "Could not evaluate medical card validity.",
      });
    } else if (f.expired > 0) {
      checks.push({
        key: "medical_cards",
        title: "Medical recognition cards",
        level: "critical",
        summary: `${f.expired} active card(s) are EXPIRED — they must not grant a tax exemption.`,
        details: [`${f.activeCards} active card(s) total.`],
      });
    } else if (f.expiringSoon > 0) {
      checks.push({
        key: "medical_cards",
        title: "Medical recognition cards",
        level: "warning",
        summary: `${f.expiringSoon} active card(s) expire soon.`,
        details: [`${f.activeCards} active card(s) total.`],
      });
    } else {
      checks.push({
        key: "medical_cards",
        title: "Medical recognition cards",
        level: "ok",
        summary: `${f.activeCards} active card(s), none expired or expiring soon.`,
      });
    }
  }

  // 5) Exempt sale record completeness.
  {
    const f = facts.exemptRecords;
    if (!f || !f.available) {
      checks.push({
        key: "exempt_records",
        title: "Medical exempt-sale records",
        level: "unknown",
        summary: "Could not evaluate exempt-sale record completeness.",
      });
    } else if (f.incomplete > 0) {
      checks.push({
        key: "exempt_records",
        title: "Medical exempt-sale records",
        level: "critical",
        summary: `${f.incomplete} of ${f.checked} exempt-sale record(s) are INCOMPLETE — a missing field risks the exemption.`,
      });
    } else {
      checks.push({
        key: "exempt_records",
        title: "Medical exempt-sale records",
        level: "ok",
        summary:
          f.checked > 0 ? `All ${f.checked} exempt-sale record(s) are complete.` : "No exempt-sale records to check.",
      });
    }
  }

  // 6) Sales-limit enforcement posture (Slice 109).
  {
    const f = facts.salesLimit;
    if (!f || !f.available) {
      checks.push({
        key: "sales_limit",
        title: "Sales-limit enforcement",
        level: "unknown",
        summary: "Could not read sales-limit settings.",
      });
    } else if (!f.enforce) {
      checks.push({
        key: "sales_limit",
        title: "Sales-limit enforcement",
        level: "warning",
        summary: "Sales-limit enforcement is OFF — over-limit carts are not being blocked.",
      });
    } else {
      checks.push({
        key: "sales_limit",
        title: "Sales-limit enforcement",
        level: f.recentOverrides > 0 ? "warning" : "ok",
        summary: f.hardBlock
          ? f.recentOverrides > 0
            ? `Hard-block ON; ${f.recentOverrides} over-limit override(s) logged recently — review the audit trail.`
            : "Hard-block ON; no recent over-limit overrides."
          : "Enforcement ON but in advisory (soft) mode — over-limit carts are flagged, not blocked.",
      });
    }
  }

  const overall = worst(checks.map((c) => c.level));
  return {
    overall,
    checks,
    criticalCount: checks.filter((c) => c.level === "critical").length,
    warningCount: checks.filter((c) => c.level === "warning").length,
  };
}

// ── Self-tests (tsx) ─────────────────────────────────────────────────────────

export function __runComplianceHealthTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${msg}`);
    }
  };

  // All-green facts → overall ok.
  const green: ComplianceHealthFacts = {
    ccrsBatch: { available: true, daysSinceLastExport: 2, weeklyWindowDays: 7 },
    deadline: { available: true, anyOverdue: false, mostUrgent: null },
    dirtyLots: { available: true, heldCount: 0 },
    medicalCards: { available: true, activeCards: 5, expiringSoon: 0, expired: 0 },
    exemptRecords: { available: true, incomplete: 0, checked: 3 },
    salesLimit: { available: true, enforce: true, hardBlock: true, recentOverrides: 0 },
  };
  {
    const r = buildComplianceHealth(green);
    ok(r.overall === "ok", "all-green → overall ok");
    ok(r.checks.length === 6, "six checks produced");
    ok(r.criticalCount === 0 && r.warningCount === 0, "no critical/warning when green");
  }

  // A stale export log → warning; never generated → warning.
  {
    const stale = buildComplianceHealth({ ...green, ccrsBatch: { available: true, daysSinceLastExport: 12, weeklyWindowDays: 7 } });
    ok(stale.overall === "warning", "stale CCRS export → warning");
    ok(stale.checks.find((c) => c.key === "ccrs_batch")?.level === "warning", "batch check warning when stale");
    const never = buildComplianceHealth({ ...green, ccrsBatch: { available: true, daysSinceLastExport: null, weeklyWindowDays: 7 } });
    ok(never.checks.find((c) => c.key === "ccrs_batch")?.level === "warning", "never-exported → warning");
    // exactly at the window boundary is still OK (not past it).
    const boundary = buildComplianceHealth({ ...green, ccrsBatch: { available: true, daysSinceLastExport: 7, weeklyWindowDays: 7 } });
    ok(boundary.checks.find((c) => c.key === "ccrs_batch")?.level === "ok", "at weekly boundary → ok");
  }

  // Overdue deadline → critical.
  {
    const r = buildComplianceHealth({
      ...green,
      deadline: {
        available: true,
        anyOverdue: true,
        mostUrgent: { periodLabel: "2024-06", dueDate: "2024-07-22", status: "overdue", daysUntilDue: -10 },
      },
    });
    ok(r.overall === "critical", "overdue deadline → critical");
  }

  // Due-soon deadline → warning (not critical).
  {
    const r = buildComplianceHealth({
      ...green,
      deadline: {
        available: true,
        anyOverdue: false,
        mostUrgent: { periodLabel: "2024-06", dueDate: "2024-07-22", status: "due_soon", daysUntilDue: 3 },
      },
    });
    ok(r.overall === "warning", "due-soon deadline → warning");
  }

  // Expired medical card → critical; expiring-soon → warning.
  {
    const expired = buildComplianceHealth({ ...green, medicalCards: { available: true, activeCards: 4, expiringSoon: 1, expired: 2 } });
    ok(expired.overall === "critical", "expired card → critical");
    const soon = buildComplianceHealth({ ...green, medicalCards: { available: true, activeCards: 4, expiringSoon: 1, expired: 0 } });
    ok(soon.overall === "warning", "expiring-soon card → warning");
  }

  // Incomplete exempt record → critical.
  {
    const r = buildComplianceHealth({ ...green, exemptRecords: { available: true, incomplete: 1, checked: 5 } });
    ok(r.overall === "critical", "incomplete exempt record → critical");
  }

  // Held dirty lots → warning.
  {
    const r = buildComplianceHealth({ ...green, dirtyLots: { available: true, heldCount: 2 } });
    ok(r.overall === "warning", "held lots → warning");
  }

  // Sales-limit enforcement off → warning; recent overrides → warning.
  {
    const off = buildComplianceHealth({ ...green, salesLimit: { available: true, enforce: false, hardBlock: true, recentOverrides: 0 } });
    ok(off.overall === "warning", "enforcement off → warning");
    const ovr = buildComplianceHealth({ ...green, salesLimit: { available: true, enforce: true, hardBlock: true, recentOverrides: 4 } });
    ok(ovr.overall === "warning", "recent overrides → warning");
  }

  // Missing facts → unknown, surfaced honestly (not green).
  {
    const r = buildComplianceHealth({});
    ok(r.overall === "unknown", "no facts → overall unknown");
    ok(r.checks.every((c) => c.level === "unknown"), "every check unknown when no facts");
  }

  // critical beats warning beats unknown in the overall roll-up.
  {
    const r = buildComplianceHealth({
      exemptRecords: { available: true, incomplete: 1, checked: 3 }, // critical
      dirtyLots: { available: true, heldCount: 1 }, // warning
      // others missing → unknown
    });
    ok(r.overall === "critical", "critical wins the roll-up");
  }

  if (failed === 0) console.log(`compliance-health-core: all ${passed} tests passed`);
  return { passed, failed };
}
