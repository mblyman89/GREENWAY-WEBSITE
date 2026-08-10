/**
 * src/lib/payments/vendor-reconcile-ui-core.ts — PURE presentation helpers for
 * the P7-a vendor payment ↔ bank reconciliation view. No I/O, no React — just
 * the plain-English status chips and summary headline the page renders. Mirrors
 * payroll-ui-core / atm-ui-core.
 */

export type VendorReconcileStatus = "matched" | "mismatch" | "awaiting" | "unmatched";

export type VendorReconcileChip = {
  label: string;
  tone: "neutral" | "green" | "orange";
  /** True when this row needs the owner's attention. */
  needsAttention: boolean;
};

/** Plain-English chip for one vendor payment's reconciliation status. */
export function vendorReconcileChip(status: VendorReconcileStatus): VendorReconcileChip {
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

/** Friendly label for a payment method (used in the "paid another way" bucket). */
export function vendorMethodLabel(method: string): string {
  switch (method) {
    case "ach":
      return "ACH";
    case "wire":
      return "Wire";
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "other":
    default:
      return "Other";
  }
}

/**
 * Headline for the summary banner: green when every bank-clearing vendor payment
 * that CAN have cleared has cleared (no mismatch, no unmatched), otherwise a call
 * to action. Pure.
 */
export function vendorReconcileHeadline(input: {
  allClear: boolean;
  paymentCount: number;
  mismatch: number;
  unmatched: number;
  awaiting: number;
}): { tone: "green" | "orange" | "neutral"; title: string; detail: string } {
  if (input.paymentCount === 0) {
    return {
      tone: "neutral",
      title: "Nothing to reconcile yet",
      detail:
        "Once you record a vendor payment by ACH or wire and your Main operating bank account is connected, each withdrawal will match up here. Payments made by cash or check show in a separate list below.",
    };
  }
  if (input.allClear) {
    const waiting =
      input.awaiting > 0
        ? ` ${input.awaiting} payment${input.awaiting === 1 ? "" : "s"} still clearing — that's normal for a day or two.`
        : "";
    return {
      tone: "green",
      title: "Every vendor payment cleared ✓",
      detail: `Each ACH/wire payment you recorded has posted to the bank and matches the amount you paid.${waiting}`,
    };
  }
  const parts: string[] = [];
  if (input.unmatched > 0)
    parts.push(
      `${input.unmatched} payment${input.unmatched === 1 ? "" : "s"} never cleared the bank`,
    );
  if (input.mismatch > 0)
    parts.push(
      `${input.mismatch} withdrawal${input.mismatch === 1 ? "" : "s"} posted for a different amount`,
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

export function __runVendorReconcileUiCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`vendor-reconcile-ui-core self-test FAILED: ${msg}`);
  };

  ok(vendorReconcileChip("matched").tone === "green" && !vendorReconcileChip("matched").needsAttention, "chip: matched is green, no attention");
  ok(vendorReconcileChip("mismatch").needsAttention === true && vendorReconcileChip("mismatch").tone === "orange", "chip: mismatch needs attention");
  ok(vendorReconcileChip("awaiting").tone === "neutral" && !vendorReconcileChip("awaiting").needsAttention, "chip: awaiting is neutral, no attention");
  ok(vendorReconcileChip("unmatched").needsAttention === true, "chip: unmatched needs attention");
  ok(vendorReconcileChip("matched").label === "Cleared", "chip: matched label is Cleared");

  ok(vendorMethodLabel("ach") === "ACH", "methodLabel: ach");
  ok(vendorMethodLabel("wire") === "Wire", "methodLabel: wire");
  ok(vendorMethodLabel("check") === "Check", "methodLabel: check");
  ok(vendorMethodLabel("cash") === "Cash", "methodLabel: cash");
  ok(vendorMethodLabel("other") === "Other", "methodLabel: other");
  ok(vendorMethodLabel("weird") === "Other", "methodLabel: unknown falls back to Other");

  {
    const h = vendorReconcileHeadline({ allClear: true, paymentCount: 0, mismatch: 0, unmatched: 0, awaiting: 0 });
    ok(h.tone === "neutral" && h.title === "Nothing to reconcile yet", "headline: empty state");
  }
  {
    const h = vendorReconcileHeadline({ allClear: true, paymentCount: 3, mismatch: 0, unmatched: 0, awaiting: 0 });
    ok(h.tone === "green" && h.title === "Every vendor payment cleared ✓", "headline: all clear");
    ok(!h.detail.includes("still clearing"), "headline: no awaiting note when none awaiting");
  }
  {
    const h = vendorReconcileHeadline({ allClear: true, paymentCount: 3, mismatch: 0, unmatched: 0, awaiting: 1 });
    ok(h.tone === "green" && h.detail.includes("1 payment still clearing"), "headline: singular awaiting note");
  }
  {
    const h = vendorReconcileHeadline({ allClear: false, paymentCount: 3, mismatch: 1, unmatched: 2, awaiting: 0 });
    ok(h.tone === "orange" && h.title === "Needs your attention", "headline: attention tone");
    ok(h.detail.includes("2 payments never cleared") && h.detail.includes("1 withdrawal posted for a different amount"), "headline: enumerates both problems");
  }
}
