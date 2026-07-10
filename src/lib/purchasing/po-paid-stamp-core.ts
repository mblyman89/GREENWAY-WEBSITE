/**
 * src/lib/purchasing/po-paid-stamp-core.ts
 *
 * W9 — PURE settlement math for the "Mark PO paid" stamp (audit gap G3).
 *
 * A purchase order counts as PAID when every invoice linked to it — i.e.
 * every inbound manifest carrying its purchase_order_id (W5 link) — has been
 * fully settled in Accounts Payable (paid >= owed on each). The stamp is
 * bookkeeping only: it is written AFTER a human records a payment (manual or
 * NACHA draft) and never triggers anything. First settle wins; the server
 * layer never overwrites an existing paid_at.
 *
 * NEVER GUESS: a PO with no linked manifests, or whose linked manifests have
 * no cost basis yet (owed = 0), is NOT stamped — we refuse to declare
 * something paid when we can't compute what was owed.
 *
 * Money is CENTS (minor units) end to end, per the standing rule.
 */

/** Per-manifest settlement facts (CENTS). */
export type ManifestSettlementFacts = {
  manifestId: string;
  /** Cost basis: SUM(received_qty × unit_cost) over non-rejected lots. */
  owedMinorUnits: number;
  /** SUM of payments recorded against this manifest. */
  paidMinorUnits: number;
};

export type PoSettlementVerdict = {
  settled: boolean;
  /** Plain-English why (for logs/diagnostics; never guessy). */
  reason: string;
  /** Total still outstanding across all linked manifests, CENTS (>= 0). */
  outstandingMinorUnits: number;
};

/**
 * Decide whether a PO's linked invoices are fully settled. Pure and
 * deterministic.
 */
export function evaluatePoSettlement(
  manifests: ManifestSettlementFacts[],
): PoSettlementVerdict {
  if (manifests.length === 0) {
    return {
      settled: false,
      reason: "No manifests are linked to this PO — nothing to settle against.",
      outstandingMinorUnits: 0,
    };
  }
  const totalOwed = manifests.reduce((s, m) => s + Math.max(0, m.owedMinorUnits), 0);
  if (totalOwed <= 0) {
    return {
      settled: false,
      reason:
        "Linked manifests have no cost basis yet (owed $0.00) — refusing to declare a PO paid on unknown amounts.",
      outstandingMinorUnits: 0,
    };
  }
  let outstanding = 0;
  for (const m of manifests) {
    outstanding += Math.max(0, m.owedMinorUnits - m.paidMinorUnits);
  }
  if (outstanding > 0) {
    return {
      settled: false,
      reason: `${usd(outstanding)} still outstanding across ${manifests.length} linked manifest(s).`,
      outstandingMinorUnits: outstanding,
    };
  }
  return {
    settled: true,
    reason: `All ${manifests.length} linked manifest(s) fully paid (${usd(totalOwed)} total).`,
    outstandingMinorUnits: 0,
  };
}

/**
 * Build the human-readable payment reference stamped onto the PO. Preference
 * order: the explicit reference the human typed (check #, wire memo) → the
 * NACHA batch ref → a plain method label. Never invents identifiers.
 */
export function paymentReferenceLabel(input: {
  reference?: string | null;
  achBatchRef?: string | null;
  paymentMethod?: string | null;
}): string {
  const ref = (input.reference ?? "").trim();
  if (ref) return ref;
  const batch = (input.achBatchRef ?? "").trim();
  if (batch) return batch;
  const method = (input.paymentMethod ?? "").trim();
  return method ? `${method} payment` : "payment";
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runPoPaidStampCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL po-paid-stamp-core: " + msg);
    passed += 1;
  };

  const m = (owed: number, paid: number, id = "m1"): ManifestSettlementFacts => ({
    manifestId: id,
    owedMinorUnits: owed,
    paidMinorUnits: paid,
  });

  // No linked manifests → never stamped.
  {
    const v = evaluatePoSettlement([]);
    assert(!v.settled, "empty → not settled");
    assert(/no manifests/i.test(v.reason), "empty reason honest");
  }

  // Zero cost basis → refuse to guess.
  {
    const v = evaluatePoSettlement([m(0, 0)]);
    assert(!v.settled, "zero owed → not settled");
    assert(/refusing/i.test(v.reason), "zero-owed reason refuses to guess");
  }

  // Partially paid → outstanding surfaces in cents and dollars.
  {
    const v = evaluatePoSettlement([m(250000, 100000)]);
    assert(!v.settled, "partial → not settled");
    assert(v.outstandingMinorUnits === 150000, "outstanding = 150000c");
    assert(v.reason.includes("$1,500.00"), "outstanding in dollars");
  }

  // Fully paid single manifest → settled.
  {
    const v = evaluatePoSettlement([m(250000, 250000)]);
    assert(v.settled, "exact pay → settled");
    assert(v.outstandingMinorUnits === 0, "settled outstanding 0");
  }

  // Overpay on one does NOT cover a shortfall on another (per-manifest math).
  {
    const v = evaluatePoSettlement([m(100000, 150000, "a"), m(100000, 50000, "b")]);
    assert(!v.settled, "cross-manifest overpay does not settle");
    assert(v.outstandingMinorUnits === 50000, "shortfall counted per-manifest");
  }

  // Multiple manifests, all settled (overpay tolerated as settled).
  {
    const v = evaluatePoSettlement([m(100000, 100000, "a"), m(50000, 60000, "b")]);
    assert(v.settled, "all settled → settled");
  }

  // Reference preference: explicit > batch > method label; never invented.
  {
    assert(
      paymentReferenceLabel({ reference: "check #1042", achBatchRef: "x", paymentMethod: "check" }) ===
        "check #1042",
      "explicit reference wins",
    );
    assert(
      paymentReferenceLabel({ reference: "  ", achBatchRef: "vendor-ach-2026-01-07-abc" }) ===
        "vendor-ach-2026-01-07-abc",
      "batch ref second",
    );
    assert(paymentReferenceLabel({ paymentMethod: "wire" }) === "wire payment", "method label fallback");
    assert(paymentReferenceLabel({}) === "payment", "bare fallback");
  }

  return { passed };
}
