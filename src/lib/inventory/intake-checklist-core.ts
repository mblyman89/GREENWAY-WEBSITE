/**
 * src/lib/inventory/intake-checklist-core.ts
 *
 * Slice AO — the intake command-center CHECKLIST for the manifest review
 * screen: one honest, state-derived list of everything that must happen on
 * that page (and everything the system does automatically), so the reviewer
 * always knows what is done, what is theirs to do next, and what will happen
 * on its own.
 *
 * PURE module: no React, no I/O, no `server-only` — vitest/tsx testable.
 *
 * Every done/todo state is derived from REAL recorded facts (never guessed):
 *   - manifest lifecycle status  (pending → in_transit → received → accepted/
 *     partially_accepted/rejected) — the same field the timeline renders;
 *   - per-lot dispositions from inventory_lots.disposition (accepted /
 *     rejected_at_dock / null=pending);
 *   - the transport fields on the manifest row (hasTransport, exactly the
 *     page's existing 6-field check);
 *   - the manifest_events audit trail: `kb_writeback` is the event
 *     manifest-kb-bridge writes on every successful KB promotion (verified),
 *     so "Promote to KB" is only shown done when the audit trail proves it.
 *
 * Automation facts (verified in intake-store.finalizeManifestDispositions):
 * finalizing an accepted intake AUTOMATICALLY derives + stamps the manifest
 * status ("mark accepted" needs no button) and AUTOMATICALLY runs the KB
 * promotion, draft seeding, COA archiving, PO auto-receive and menu carry.
 * The checklist therefore renders those two as "auto" until the facts say
 * they happened.
 */

export type IntakeChecklistState = "done" | "todo" | "auto" | "blocked";

export type IntakeChecklistItemId =
  | "arrive"
  | "decide_lines"
  | "verify_transport"
  | "finalize"
  | "mark_accepted"
  | "promote_kb";

export type IntakeChecklistItem = {
  id: IntakeChecklistItemId;
  /** Short imperative label shown on the checklist row. */
  label: string;
  state: IntakeChecklistState;
  /** One-line plain-English "what this means / what to do". */
  hint: string;
  /** Optional live detail (counts, derived status) under the hint. */
  detail: string | null;
  /** In-page anchor of the section where this item's work happens. */
  anchor: string | null;
};

export type IntakeChecklist = {
  items: IntakeChecklistItem[];
  /** Items in the "done" state. */
  doneCount: number;
  /** Total items (stable — the list shape never changes). */
  total: number;
  /** The FIRST human-actionable item (todo), or null when nothing is. */
  nextAction: IntakeChecklistItem | null;
  /** True once the manifest reached a terminal status. */
  finished: boolean;
};

/** The audit event manifest-kb-bridge writes on every successful promotion. */
export const KB_WRITEBACK_EVENT = "kb_writeback";

const TERMINAL = new Set(["accepted", "partially_accepted", "rejected"]);

export function buildIntakeChecklist(input: {
  /** inbound_manifests.status */
  status: string;
  /** inventory_lots.disposition for every line (null/"pending" = undecided). */
  lotDispositions: readonly (string | null)[];
  /** The page's existing 6-field transport check (any field recorded). */
  hasTransport: boolean;
  /** manifest_events rows (event_type is enough). */
  events: readonly { event_type: string }[];
}): IntakeChecklist {
  const { status, lotDispositions, hasTransport, events } = input;
  const finished = TERMINAL.has(status);
  const rejectedWhole = status === "rejected";
  const received = status === "received";
  const arrived = received || finished;

  const total = lotDispositions.length;
  const undecided = lotDispositions.filter(
    (d) => d == null || d === "pending",
  ).length;
  const decided = total - undecided;

  const kbPromoted = events.some((e) => e.event_type === KB_WRITEBACK_EVENT);

  const items: IntakeChecklistItem[] = [];

  // ① Physical arrival (pending → in transit → received).
  items.push({
    id: "arrive",
    label: "Mark the delivery received",
    state: arrived ? "done" : "todo",
    hint: arrived
      ? "The truck arrived and this manifest is marked received."
      : status === "in_transit"
        ? "The truck is on its way — click “Mark received” when it arrives."
        : "Click “Mark in transit” when the vendor dispatches, then “Mark received” when it arrives.",
    detail: null,
    anchor: "#manifest-timeline",
  });

  // ② Accept the products — count every line, decide accept/reject.
  items.push({
    id: "decide_lines",
    label: "Verify counts & accept each product",
    state: finished
      ? "done"
      : !arrived
        ? "blocked"
        : undecided === 0
          ? "done"
          : "todo",
    hint: finished
      ? "Every line was decided and the intake is finalized."
      : !arrived
        ? "Waiting on the truck — you can only verify counts once it's physically here."
        : undecided === 0
          ? "Every line is decided — you're clear to finalize."
          : "Count each line against the manifest, then Accept it (or Reject short/wrong lines at the dock).",
    detail:
      total === 0
        ? "No lines parsed on this manifest."
        : finished || !arrived
          ? `${total} line${total === 1 ? "" : "s"} on this manifest.`
          : `${decided} of ${total} line${total === 1 ? "" : "s"} decided${
              undecided > 0
                ? ` — ${undecided} undecided (undecided lines count as ACCEPTED when you finalize)`
                : ""
            }.`,
    anchor: "#manifest-lines",
  });

  // ③ Verify / record the transport details (WAC 314-55-085 chain of custody).
  items.push({
    id: "verify_transport",
    label: "Verify transport details",
    state: hasTransport ? "done" : "todo",
    hint: hasTransport
      ? "Chain-of-custody transport details are on file with this manifest."
      : "Record who delivered the load (carrier, driver, vehicle) — usually auto-filled from the manifest; just confirm and Save.",
    detail: null,
    anchor: "#manifest-transport",
  });

  // ④ Finalize the intake — the ONE button that closes it out.
  items.push({
    id: "finalize",
    label: "Finalize intake",
    state: finished ? "done" : arrived ? "todo" : "blocked",
    hint: finished
      ? rejectedWhole
        ? "Finalized — this manifest was refused at the dock."
        : "Finalized — accepted lots are active and everything downstream ran."
      : arrived
        ? "When every line is decided, click Finalize intake — it activates accepted lots and runs every automatic step below."
        : "Unlocks once the delivery is marked received and the counts are verified.",
    detail: null,
    anchor: "#manifest-finalize",
  });

  // ⑤ Mark accepted — AUTOMATIC: finalize derives + stamps the status.
  items.push({
    id: "mark_accepted",
    label: "Mark manifest accepted",
    state: finished ? "done" : "auto",
    hint: finished
      ? `Stamped automatically at finalize — status: ${status.replace(/_/g, " ")}.`
      : "Automatic — finalizing stamps the manifest accepted / partially accepted / rejected from your per-line decisions. No button needed.",
    detail: null,
    anchor: null,
  });

  // ⑥ Promote to KB — AUTOMATIC on finalize; proven by the kb_writeback event.
  items.push({
    id: "promote_kb",
    label: "Promote facts to Knowledge Base",
    state: kbPromoted ? "done" : finished && !rejectedWhole ? "todo" : "auto",
    hint: kbPromoted
      ? "Done — this manifest's verified product facts were written to KB drafts (audited on the timeline)."
      : finished && !rejectedWhole
        ? "Runs automatically at finalize, but no KB write-back is on this manifest's timeline yet — click “⚡ Promote to KB drafts” to run it now (safe to repeat)."
        : "Automatic at finalize — pushes the manifest's verified facts (name, strain, category, vendor, COA potency) into KB drafts for enrichment. Drafts only; nothing publishes.",
    detail: null,
    anchor: "#manifest-kb",
  });

  const doneCount = items.filter((i) => i.state === "done").length;
  const nextAction = items.find((i) => i.state === "todo") ?? null;

  return { items, doneCount, total: items.length, nextAction, finished };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (pure) — run via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runIntakeChecklistCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };
  const by = (c: IntakeChecklist, id: IntakeChecklistItemId) => {
    const item = c.items.find((i) => i.id === id);
    if (!item) throw new Error(`missing checklist item ${id}`);
    return item;
  };

  // Fresh pending manifest: nothing arrived, lines blocked, finalize blocked,
  // automation advertised as auto.
  let c = buildIntakeChecklist({
    status: "pending",
    lotDispositions: [null, null],
    hasTransport: false,
    events: [],
  });
  ok(c.items.length === 6 && c.total === 6, "always six items");
  ok(by(c, "arrive").state === "todo", "pending: arrive todo");
  ok(by(c, "decide_lines").state === "blocked", "pending: lines blocked");
  ok(by(c, "verify_transport").state === "todo", "pending: transport todo");
  ok(by(c, "finalize").state === "blocked", "pending: finalize blocked");
  ok(by(c, "mark_accepted").state === "auto", "pending: mark accepted auto");
  ok(by(c, "promote_kb").state === "auto", "pending: kb auto");
  ok(c.nextAction?.id === "arrive", "pending: next action is arrival");
  ok(c.doneCount === 0 && c.finished === false, "pending: none done");

  // In transit: arrival copy changes but stays todo.
  c = buildIntakeChecklist({
    status: "in_transit",
    lotDispositions: [null],
    hasTransport: true,
    events: [],
  });
  ok(by(c, "arrive").state === "todo", "in_transit: arrive todo");
  ok(by(c, "arrive").hint.includes("Mark received"), "in_transit: hint says mark received");
  ok(by(c, "verify_transport").state === "done", "in_transit: transport done when recorded");

  // Received with undecided lines: counting is THE job; undecided detail warns
  // that undecided lines finalize as accepted.
  c = buildIntakeChecklist({
    status: "received",
    lotDispositions: ["accepted", null, "pending"],
    hasTransport: false,
    events: [],
  });
  ok(by(c, "arrive").state === "done", "received: arrive done");
  ok(by(c, "decide_lines").state === "todo", "received: lines todo");
  ok(
    (by(c, "decide_lines").detail ?? "").includes("1 of 3"),
    "received: decided count 1 of 3",
  );
  ok(
    (by(c, "decide_lines").detail ?? "").includes("ACCEPTED when you finalize"),
    "received: undecided-accepted warning present",
  );
  ok(by(c, "finalize").state === "todo", "received: finalize todo");
  ok(c.nextAction?.id === "decide_lines", "received: next action is deciding lines");

  // Received, all decided: lines done, finalize is the next action.
  c = buildIntakeChecklist({
    status: "received",
    lotDispositions: ["accepted", "rejected_at_dock"],
    hasTransport: true,
    events: [],
  });
  ok(by(c, "decide_lines").state === "done", "all decided: lines done");
  ok(c.nextAction?.id === "finalize", "all decided: next is finalize");

  // Accepted + kb_writeback audited: everything done, no next action.
  c = buildIntakeChecklist({
    status: "accepted",
    lotDispositions: ["accepted", "accepted"],
    hasTransport: true,
    events: [{ event_type: "received" }, { event_type: KB_WRITEBACK_EVENT }],
  });
  ok(c.doneCount === 6, "accepted+kb: all six done");
  ok(c.nextAction === null, "accepted+kb: no next action");
  ok(c.finished === true, "accepted: finished");
  ok(by(c, "mark_accepted").hint.includes("accepted"), "accepted: status in hint");

  // Finalized accepted but NO kb_writeback event (older manifest / KB hiccup):
  // promote_kb becomes a real TODO pointing at the manual button.
  c = buildIntakeChecklist({
    status: "partially_accepted",
    lotDispositions: ["accepted", "rejected_at_dock"],
    hasTransport: true,
    events: [{ event_type: "partially_accepted" }],
  });
  ok(by(c, "promote_kb").state === "todo", "finalized w/o writeback: kb todo");
  ok(
    by(c, "promote_kb").hint.includes("Promote to KB drafts"),
    "finalized w/o writeback: hint names the manual button",
  );
  ok(c.nextAction?.id === "promote_kb", "finalized w/o writeback: kb is next");

  // Whole-manifest rejection: nothing entered inventory → KB stays auto (a
  // refused load has no accepted facts to promote), finalize done.
  c = buildIntakeChecklist({
    status: "rejected",
    lotDispositions: ["rejected_at_dock"],
    hasTransport: false,
    events: [{ event_type: "rejected" }],
  });
  ok(by(c, "finalize").state === "done", "rejected: finalize done");
  ok(by(c, "finalize").hint.includes("refused at the dock"), "rejected: finalize hint");
  ok(by(c, "promote_kb").state === "auto", "rejected: kb not a todo");
  ok(by(c, "verify_transport").state === "todo", "rejected: transport still recordable");

  // Zero-line manifest: stable shape, honest detail.
  c = buildIntakeChecklist({
    status: "received",
    lotDispositions: [],
    hasTransport: false,
    events: [],
  });
  ok(by(c, "decide_lines").state === "done", "zero lines: nothing to decide");
  ok(
    (by(c, "decide_lines").detail ?? "").includes("No lines"),
    "zero lines: detail says so",
  );

  if (fail > 0) {
    throw new Error(`intake-checklist-core self-tests failed: ${fail} failing, ${pass} passing`);
  }
  console.log(`intake-checklist-core: ${pass} self-tests passed`);
}
