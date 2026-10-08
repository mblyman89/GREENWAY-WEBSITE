/**
 * src/lib/inventory/finalize-label-core.ts
 *
 * R31: the ONE finalize button on the manifest review page.
 *
 * The owner's words: "If I don't press any of the accept/ reject buttons on
 * any of the line items, then finalize manifest should say something like
 * 'Accept All & Finalize', and if some lines were rejected then the button
 * should say something like 'Accept x Reject y & Finalize'."
 *
 * This is the "express receipt" pattern used by enterprise receiving
 * (Oracle Purchasing Express Receipts: every line is selected for receipt
 * and a manual action on a line is the exception). The rule here is the
 * one finalizeManifestDispositions ALREADY applies on the server: a line
 * that was never decided counts as ACCEPTED; only "rejected_at_dock" is a
 * refusal. The prediction of "held" lines comes from the SAME activation
 * gate (lot-activation-gate-core) and the partial-note rule from the SAME
 * deriveManifestStatus, so the label never promises something the server
 * will not do.
 *
 * Pure: no I/O, no React.
 */
import { deriveManifestStatus } from "@/lib/inventory/intake-disposition-core";
import { evaluateLotActivation, type LotGateFacts } from "@/lib/inventory/lot-activation-gate-core";

export type FinalizeLineFacts = {
  id: string;
  /** "accepted" | "rejected_at_dock" | null (undecided means accepted). */
  disposition: string | null;
  /** Facts for the activation gate; omitted means "do not predict a hold". */
  gate?: Omit<LotGateFacts, "id"> | null;
};

export type FinalizePlan = {
  /** Lines on the manifest. */
  total: number;
  /** Lines that will be accepted (decided accepted + undecided). */
  accept: number;
  /** Lines refused at the dock. */
  reject: number;
  /** Accepted lines the safety gate will hold in quarantine (subset of accept). */
  held: number;
  /** Lines nobody has touched (they ride along as accepted). */
  undecided: number;
  /** The button text. */
  label: string;
  /** One plain sentence for the sticky bar. */
  status: string;
  /** Same rule as the server: a partial finalize needs the why-note. */
  noteRequired: boolean;
  /** "warning" when a note is needed or lines will be held, else "info". */
  tone: "info" | "warning";
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function planFinalize(lines: FinalizeLineFacts[]): FinalizePlan {
  const total = lines.length;
  let reject = 0;
  let undecided = 0;
  let held = 0;
  for (const l of lines) {
    if (l.disposition === "rejected_at_dock") {
      reject += 1;
      continue;
    }
    if (l.disposition !== "accepted") undecided += 1;
    if (l.gate) {
      const v = evaluateLotActivation({ id: l.id, ...l.gate });
      if (!v.canActivate) held += 1;
    }
  }
  const accept = total - reject;
  const willActivate = accept - held;
  const noteRequired =
    total > 0 && deriveManifestStatus(willActivate, reject, held) === "partially_accepted";

  let label: string;
  if (total === 0) label = "Finalize (no lines)";
  else if (reject === 0) label = total === 1 ? "Accept & Finalize" : "Accept All & Finalize";
  else if (accept === 0) label = total === 1 ? "Reject & Finalize" : "Reject All & Finalize";
  else label = `Accept ${accept} · Reject ${reject} & Finalize`;

  const parts: string[] = [];
  if (total === 0) {
    parts.push("This manifest has no lines to receive.");
  } else if (reject === 0) {
    parts.push(
      total === 1
        ? "The line will be accepted."
        : `All ${total} lines will be accepted.`,
    );
  } else if (accept === 0) {
    parts.push(`All ${plural(total, "line", "lines")} will be refused at the dock.`);
  } else {
    parts.push(
      `${plural(accept, "line", "lines")} will be accepted and ${plural(reject, "line", "lines")} refused at the dock.`,
    );
  }
  if (held > 0) {
    parts.push(
      `${plural(held, "accepted line is", "accepted lines are")} missing a CCRS id or a passing COA, so ${held === 1 ? "it stays" : "they stay"} in quarantine (not sellable) until fixed.`,
    );
  }
  if (noteRequired) parts.push("This is a partial acceptance, so the note explaining why is required.");

  return {
    total,
    accept,
    reject,
    held,
    undecided,
    label,
    status: parts.join(" "),
    noteRequired,
    tone: noteRequired || held > 0 ? "warning" : "info",
  };
}

/**
 * R31: does finalize need to stamp the delivery "received" first? Only while it
 * is still pending / in transit. A delivery already received keeps its
 * original received_at (the dock-to-shelf clock starts there), and a delivery
 * already finalized (accepted / partially_accepted / rejected) is never walked
 * back to received. Unknown statuses are left alone (never guess).
 */
export function shouldMarkArrivedOnFinalize(status: string | null | undefined): boolean {
  return status === "pending" || status === "in_transit";
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runFinalizeLabelCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`finalize-label-core self-test FAILED: ${what}`);
    }
  };
  const clean = { ccrsExternalId: "X1", hasLabResult: true, labPassed: true };
  const line = (id: string, disposition: string | null, gate: FinalizeLineFacts["gate"] = clean): FinalizeLineFacts => ({
    id,
    disposition,
    gate,
  });

  // 1. Nobody touched anything: Accept All.
  const a = planFinalize([line("1", null), line("2", null), line("3", null)]);
  ok(a.label === "Accept All & Finalize", "untouched -> Accept All & Finalize");
  ok(a.accept === 3 && a.reject === 0 && a.undecided === 3, "untouched counts");
  ok(!a.noteRequired && a.tone === "info", "untouched needs no note");
  ok(a.status === "All 3 lines will be accepted.", "untouched status");

  // 2. Explicit accepts are the same as untouched.
  const b = planFinalize([line("1", "accepted"), line("2", null)]);
  ok(b.label === "Accept All & Finalize" && b.undecided === 1, "explicit accept == untouched");

  // 3. Some rejected: Accept x · Reject y.
  const c = planFinalize([line("1", null), line("2", "rejected_at_dock"), line("3", null), line("4", "rejected_at_dock")]);
  ok(c.label === "Accept 2 · Reject 2 & Finalize", "mixed label");
  ok(c.noteRequired && c.tone === "warning", "mixed requires the note (server rule)");
  ok(c.status.includes("2 lines will be accepted and 2 lines refused"), "mixed status");

  // 4. All rejected.
  const d = planFinalize([line("1", "rejected_at_dock"), line("2", "rejected_at_dock")]);
  ok(d.label === "Reject All & Finalize" && d.accept === 0, "all rejected label");
  ok(!d.noteRequired, "all rejected is a clean rejection, not partial (deriveManifestStatus)");

  // 5. Single-line wording.
  ok(planFinalize([line("1", null)]).label === "Accept & Finalize", "single accept");
  ok(planFinalize([line("1", "rejected_at_dock")]).label === "Reject & Finalize", "single reject");
  ok(planFinalize([line("1", null)]).status === "The line will be accepted.", "single status");

  // 6. Zero lines.
  const z = planFinalize([]);
  ok(z.label === "Finalize (no lines)" && !z.noteRequired && z.total === 0, "zero lines");

  // 7. A dirty accepted line is predicted HELD; mixed with clean -> partial.
  const e = planFinalize([line("1", null), line("2", null, { ccrsExternalId: null, hasLabResult: true, labPassed: true })]);
  ok(e.held === 1 && e.accept === 2, "dirty line predicted held, still counted as accepted");
  ok(e.label === "Accept All & Finalize", "held lines do not change the button");
  ok(e.noteRequired, "clean + held is partial -> note required (server parity)");
  ok(e.status.includes("1 accepted line is missing"), "held sentence singular");
  ok(e.tone === "warning", "held is a warning");

  // 8. Every accepted line dirty -> server derives partially_accepted (blocked>0).
  const f = planFinalize([line("1", null, { ccrsExternalId: "X", hasLabResult: false })]);
  ok(f.held === 1 && f.noteRequired, "all held -> partial -> note required");

  // 9. Failed lab is held.
  const g = planFinalize([line("1", null, { ccrsExternalId: "X", hasLabResult: true, labPassed: false }), line("2", null)]);
  ok(g.held === 1, "failed lab is held");

  // 10. No gate facts -> never predict a hold (do not guess).
  const h = planFinalize([line("1", null, null), line("2", null, null)]);
  ok(h.held === 0 && !h.noteRequired, "no gate facts -> no hold prediction");

  // 11. Rejected dirty lines are not 'held' (they are refused).
  const i = planFinalize([line("1", "rejected_at_dock", { ccrsExternalId: null, hasLabResult: false }), line("2", null)]);
  ok(i.held === 0 && i.reject === 1, "rejected dirty line is not held");

  // 12. Unknown disposition strings count as accepted (server: anything not rejected_at_dock).
  const j = planFinalize([line("1", "weird"), line("2", null)]);
  ok(j.accept === 2 && j.reject === 0 && j.undecided === 2, "unknown disposition == accepted");

  // 13. Pending lab (present, unknown) activates, so not held.
  const k = planFinalize([line("1", null, { ccrsExternalId: "X", hasLabResult: true, labPassed: null })]);
  ok(k.held === 0, "pending lab is not a hold");

  // 14. Plural held sentence.
  const m = planFinalize([
    line("1", null, { ccrsExternalId: null, hasLabResult: true }),
    line("2", null, { ccrsExternalId: null, hasLabResult: true }),
    line("3", null),
  ]);
  ok(m.status.includes("2 accepted lines are missing") && m.status.includes("they stay"), "held sentence plural");

  // 15. R31 receive-on-finalize gate.
  ok(shouldMarkArrivedOnFinalize("pending") && shouldMarkArrivedOnFinalize("in_transit"), "pending/in_transit are stamped received");
  ok(!shouldMarkArrivedOnFinalize("received"), "already received keeps its received_at");
  ok(
    !["accepted", "partially_accepted", "rejected", "", null, undefined, "weird"].some((s) => shouldMarkArrivedOnFinalize(s)),
    "finalized / unknown statuses are never walked back",
  );

  return { passed, failed };
}
