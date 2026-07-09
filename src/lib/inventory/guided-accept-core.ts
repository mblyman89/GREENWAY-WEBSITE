/**
 * src/lib/inventory/guided-accept-core.ts
 *
 * Slice H15f — the guided accept flow for the manifest review screen:
 *
 *   ① Arrived → ② Verify counts → ③ Accept
 *
 * Three pieces, all pure (no React, no I/O — vitest-testable):
 *
 *   1. guidedProgress(status)  — maps the manifest lifecycle status onto the
 *      3-step ribbon (which step is current / done / failed).
 *   2. whatDoIDoHere(status, etaDate) — the plain-English "one action for
 *      this stage" line shown under the ribbon.
 *   3. fromManifestChips(...) — the green "from the manifest" chips: ONLY
 *      values genuinely staged from the source document appear. Transport
 *      values are only chipped when the H15a auto-fill audit event is present
 *      (we never guess whether a value was typed by a human or seeded).
 *   4. CONCIERGE_HINTS — one-line "where this came from / what it means"
 *      hover hints for the dense fields on the review screen.
 *
 * The owner's legal point, respected: the manifest is a validated fact for
 * CCRS — the human's job is the one thing only a human can do: confirm the
 * physical count matches, then accept. The copy keeps saying exactly that.
 */

export type GuidedStepState = "done" | "current" | "todo" | "failed";

export type GuidedProgress = {
  /** 1 = Arrived, 2 = Verify counts, 3 = Accept. */
  current: 1 | 2 | 3;
  /** The three steps in order: [Arrived, Verify counts, Accept]. */
  steps: [GuidedStepState, GuidedStepState, GuidedStepState];
  /** Terminal: accepted / partially_accepted. */
  finished: boolean;
  /** Terminal: whole manifest refused at the dock. */
  rejected: boolean;
};

/**
 * Map the manifest lifecycle status onto the ①②③ ribbon.
 *
 *   pending / in_transit → step ① (it hasn't physically arrived yet)
 *   received             → step ② (it's here — count it)
 *   accepted / partially_accepted → step ③ done
 *   rejected             → step ③ failed (refused at the dock)
 *
 * Unknown statuses degrade to step ① rather than guessing.
 */
export function guidedProgress(status: string): GuidedProgress {
  switch (status) {
    case "received":
      return { current: 2, steps: ["done", "current", "todo"], finished: false, rejected: false };
    case "accepted":
    case "partially_accepted":
      return { current: 3, steps: ["done", "done", "done"], finished: true, rejected: false };
    case "rejected":
      return { current: 3, steps: ["done", "done", "failed"], finished: true, rejected: true };
    case "pending":
    case "in_transit":
    default:
      return { current: 1, steps: ["current", "todo", "todo"], finished: false, rejected: false };
  }
}

export const GUIDED_STEP_LABELS = ["Arrived", "Verify counts", "Accept"] as const;

/**
 * The plain-English "What do I do here?" line for the current stage. One
 * action, no jargon. The ETA (when known) is woven into the in-transit copy
 * so the staffer knows when to expect the truck.
 */
export function whatDoIDoHere(status: string, etaDate?: string | null): string {
  switch (status) {
    case "pending":
      return "This manifest is staged as a draft. Nothing to do until the truck is on its way — click “Mark in transit” when the vendor dispatches it.";
    case "in_transit":
      return etaDate
        ? `This truck is in transit — expected ${etaDate}. When it arrives, click “Mark received,” then check the counts.`
        : "This truck is in transit. When it arrives, click “Mark received,” then check the counts.";
    case "received":
      return "It's here. Count each line against the manifest — the counts are the ONE thing only you can verify. Refuse any short or wrong line at the dock (mark it Reject), then click “Finalize intake.”";
    case "accepted":
      return "Done — this manifest is accepted and its lots are active. Nothing left to do here.";
    case "partially_accepted":
      return "Partially accepted — some lots went active, some were refused at the dock or held in quarantine. Fix any held lots (add the CCRS id / passing COA) and finalize again.";
    case "rejected":
      return "This whole manifest was refused at the dock — the product left with the driver and never entered inventory. Ask the vendor to Update/Delete their CCRS manifest.";
    default:
      return "Review the manifest below and move it along the pipeline.";
  }
}

// ---------------------------------------------------------------------------
// "From the manifest" chips
// ---------------------------------------------------------------------------

export type ManifestChip = { label: string; value: string };

/** The audit-note fingerprint stamped by H15a's seedTransportFromParsed. */
const TRANSPORT_AUTOFILL_FINGERPRINT = "auto-filled from the";

/**
 * True when the manifest's timeline proves its transport fields were seeded
 * from the source document (H15a stamps "Transport details auto-filled from
 * the … document" as a transport event note). We check the audit trail rather
 * than guessing from the values themselves.
 */
export function transportWasAutoFilled(
  events: readonly { event_type: string; note: string | null }[],
): boolean {
  return events.some(
    (e) => typeof e.note === "string" && e.note.toLowerCase().includes(TRANSPORT_AUTOFILL_FINGERPRINT),
  );
}

/**
 * Build the green "from the manifest" chips — what the system already filled
 * in from the signed source document, so the human sees at a glance what was
 * done for them and what still needs a human touch.
 *
 * Identity fields (manifest #, vendor, transfer date) are always from the
 * parsed document — that is the only way a manifest row is ever created.
 * Transport-ish fields (ETA / departed / route / transporter) are chipped
 * ONLY when the H15a auto-fill audit event proves they were seeded; they are
 * otherwise editable by hand and we never present a human entry as machine
 * work (or vice versa).
 */
export function fromManifestChips(
  m: {
    manifest_number: string | null;
    vendor_label: string | null;
    transfer_date: string | null;
    eta_date: string | null;
    departed_at: string | null;
    route_notes: string | null;
    transporter_name: string | null;
  },
  transportAutoFilled: boolean,
): ManifestChip[] {
  const chips: ManifestChip[] = [];
  if (m.manifest_number) chips.push({ label: "Manifest #", value: m.manifest_number });
  if (m.vendor_label) chips.push({ label: "Vendor", value: m.vendor_label });
  if (m.transfer_date) chips.push({ label: "Transfer date", value: m.transfer_date });
  if (transportAutoFilled) {
    if (m.eta_date) chips.push({ label: "ETA", value: m.eta_date });
    if (m.departed_at) chips.push({ label: "Departed", value: m.departed_at.slice(0, 16).replace("T", " ") });
    if (m.transporter_name) chips.push({ label: "Carrier", value: m.transporter_name });
    if (m.route_notes) chips.push({ label: "Route", value: "captured" });
  }
  return chips;
}

// ---------------------------------------------------------------------------
// Concierge hover-hints
// ---------------------------------------------------------------------------

/**
 * One-line "where this came from / what it means" hints, rendered as title
 * attributes (native hover tooltips — zero JS). Keys are stable identifiers
 * used by the review screen.
 */
export const CONCIERGE_HINTS = {
  eta: "Estimated arrival from the vendor's transfer document. Turns red on the Receiving page if the truck is late.",
  coa: "Certificate of analysis captured from the transfer — opens the lab PDF. Every activated lot must have one on file.",
  manifest_number: "The manifest / transfer ID from the signed source document. Legally validated for CCRS — no need to re-verify it.",
  invoice_number: "The vendor's order / invoice number from the transfer (external_id) — what you'd quote on the phone.",
  qty: "Shipped quantity from the manifest. Your ONE human job: confirm the physical count matches before accepting.",
  decision: "Accept = it physically arrived correct. Reject = refuse at the dock; it leaves with the driver and never enters your inventory.",
  departed: "When the load left the vendor, from the transfer document (a draft — verify during review).",
  transporter: "Carrier that moved the load (WAC 314-55-085 chain-of-custody).",
  finalize: "Activates every accepted lot (quarantine → active) and files the intake record. Undecided lines count as accepted.",
} as const;

export type ConciergeHintKey = keyof typeof CONCIERGE_HINTS;
