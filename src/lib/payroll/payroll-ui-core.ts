/**
 * src/lib/payroll/payroll-ui-core.ts — PURE presentation helpers for the P6b
 * payroll bank-reconciliation view. No I/O, no React — just the plain-English
 * status chips and summary headline the page renders. Mirrors atm-ui-core.
 */

export type PayrollReconcileStatus = "matched" | "mismatch" | "awaiting" | "unmatched";

export type PayrollReconcileChip = {
  label: string;
  tone: "neutral" | "green" | "orange";
  /** True when this row needs the owner's attention. */
  needsAttention: boolean;
};

/** Plain-English chip for one payroll run's reconciliation status. */
export function payrollReconcileChip(status: PayrollReconcileStatus): PayrollReconcileChip {
  switch (status) {
    case "matched":
      return { label: "Cleared", tone: "green", needsAttention: false };
    case "mismatch":
      return { label: "Amount off", tone: "orange", needsAttention: true };
    case "awaiting":
      return { label: "Awaiting clearing", tone: "neutral", needsAttention: false };
    case "unmatched":
    default:
      return { label: "Not cleared", tone: "orange", needsAttention: true };
  }
}

/**
 * Headline for the summary banner: green when every payroll that CAN have
 * cleared has cleared (no mismatch, no unmatched), otherwise a call to action.
 * Pure.
 */
export function payrollReconcileHeadline(input: {
  allClear: boolean;
  runCount: number;
  mismatch: number;
  unmatched: number;
  awaiting: number;
}): { tone: "green" | "orange" | "neutral"; title: string; detail: string } {
  if (input.runCount === 0) {
    return {
      tone: "neutral",
      title: "Nothing to reconcile yet",
      detail:
        "Once you generate a payroll ACH file and your Main operating bank account is connected, each run's withdrawal will match up here.",
    };
  }
  if (input.allClear) {
    const waiting =
      input.awaiting > 0
        ? ` ${input.awaiting} payroll${input.awaiting === 1 ? "" : "s"} still clearing — that's normal for a day or two.`
        : "";
    return {
      tone: "green",
      title: "Every payroll cleared ✓",
      detail: `Each completed run's ACH withdrawal has posted and matches your net-pay total.${waiting}`,
    };
  }
  const parts: string[] = [];
  if (input.unmatched > 0)
    parts.push(
      `${input.unmatched} payroll${input.unmatched === 1 ? "" : "s"} never cleared the bank`,
    );
  if (input.mismatch > 0)
    parts.push(
      `${input.mismatch} withdrawal${input.mismatch === 1 ? "" : "s"} posted for the wrong amount`,
    );
  return {
    tone: "orange",
    title: "Needs your attention",
    detail: `${parts.join(" · ")}. Review the highlighted rows below.`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure) — mirrored in the vitest suite.
// ---------------------------------------------------------------------------

export function __runPayrollUiCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`payroll-ui-core self-test FAILED: ${msg}`);
  };

  ok(payrollReconcileChip("matched").tone === "green" && !payrollReconcileChip("matched").needsAttention, "chip: matched is green, no attention");
  ok(payrollReconcileChip("mismatch").needsAttention === true && payrollReconcileChip("mismatch").tone === "orange", "chip: mismatch needs attention");
  ok(payrollReconcileChip("awaiting").tone === "neutral" && !payrollReconcileChip("awaiting").needsAttention, "chip: awaiting is neutral, no attention");
  ok(payrollReconcileChip("unmatched").needsAttention === true, "chip: unmatched needs attention");
  ok(payrollReconcileChip("matched").label === "Cleared", "chip: matched label is Cleared");

  {
    const h = payrollReconcileHeadline({ allClear: true, runCount: 0, mismatch: 0, unmatched: 0, awaiting: 0 });
    ok(h.tone === "neutral" && h.title === "Nothing to reconcile yet", "headline: empty state");
  }
  {
    const h = payrollReconcileHeadline({ allClear: true, runCount: 3, mismatch: 0, unmatched: 0, awaiting: 0 });
    ok(h.tone === "green" && h.title === "Every payroll cleared ✓", "headline: all clear");
    ok(!h.detail.includes("still clearing"), "headline: no awaiting note when none awaiting");
  }
  {
    const h = payrollReconcileHeadline({ allClear: true, runCount: 3, mismatch: 0, unmatched: 0, awaiting: 1 });
    ok(h.tone === "green" && h.detail.includes("1 payroll still clearing"), "headline: singular awaiting note");
  }
  {
    const h = payrollReconcileHeadline({ allClear: false, runCount: 3, mismatch: 1, unmatched: 2, awaiting: 0 });
    ok(h.tone === "orange" && h.title === "Needs your attention", "headline: attention tone");
    ok(h.detail.includes("2 payrolls never cleared") && h.detail.includes("1 withdrawal posted for the wrong amount"), "headline: enumerates both problems");
  }
}
