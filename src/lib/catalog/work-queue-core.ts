/**
 * src/lib/catalog/work-queue-core.ts
 *
 * W2 — the Command Center work queue. PURE module (no server-only, no DB):
 * takes VERIFIED counts gathered by the server assembler and returns the
 * priority-ordered list of "do these in order" rows for the Catalog Hub.
 *
 * Design rule (from the audit strategy): an employee who only ever opens the
 * hub and presses the top button is doing the job correctly. So:
 *  - rows appear ONLY when there is real work (count > 0) — an empty queue is
 *    a genuine "all clear", never padding;
 *  - order is fixed by operational priority, not by count size;
 *  - each row has exactly ONE action (label + href).
 *
 * Priority order (audited rationale):
 *  1. Overdue in-transit trucks — a compliance/vendor-follow-up fire.
 *  2. Awaiting intake — product is physically here and not sellable yet.
 *  3. Held lots — accepted but quarantined-dirty (missing CCRS id / COA):
 *     inventory you own but cannot sell until fixed.
 *  4. Onboarding drafts — new products blocked from the menu until reviewed.
 *  5. POs to send — draft/submitted orders the vendor hasn't seen yet.
 *  6. Mastering suggestions — menu quality, lowest urgency.
 *
 * "POs to pay" is deliberately ABSENT until the paid-stamp exists (W9) —
 * we refuse to show a queue row we cannot verify.
 */

export type WorkQueueInputs = {
  /** In-transit manifests whose ETA is strictly past. */
  overdueInTransit: number;
  /** Manifests physically received, awaiting verify & accept. */
  awaitingIntake: number;
  /** Accepted-but-held lots (status=quarantine, disposition=accepted). */
  heldLots: number;
  /** Product-onboarding drafts awaiting review. */
  onboardingDrafts: number;
  /** Purchase orders still draft/submitted (vendor hasn't received them). */
  posToSend: number;
  /** Pending product-mastering suggestions. */
  masteringSuggestions: number;
};

export type WorkQueueRowKey =
  | "overdue_in_transit"
  | "awaiting_intake"
  | "held_lots"
  | "onboarding_drafts"
  | "pos_to_send"
  | "mastering_suggestions";

export type WorkQueueRow = {
  key: WorkQueueRowKey;
  /** 1-based priority (1 = do first). Stable regardless of which rows show. */
  priority: number;
  severity: "critical" | "warning" | "info";
  icon: string;
  count: number;
  /** e.g. "2 in-transit manifests past ETA" */
  text: string;
  /** ONE action. */
  actionLabel: string;
  actionHref: string;
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function buildWorkQueue(input: WorkQueueInputs): WorkQueueRow[] {
  const rows: WorkQueueRow[] = [];

  if (input.overdueInTransit > 0) {
    rows.push({
      key: "overdue_in_transit",
      priority: 1,
      severity: "critical",
      icon: "🚨",
      count: input.overdueInTransit,
      text: `${input.overdueInTransit} in-transit ${plural(input.overdueInTransit, "manifest is", "manifests are")} past ETA — follow up with the transporter.`,
      actionLabel: "Chase it",
      actionHref: "/admin/inventory/intake",
    });
  }

  if (input.awaitingIntake > 0) {
    rows.push({
      key: "awaiting_intake",
      priority: 2,
      severity: "warning",
      icon: "📦",
      count: input.awaitingIntake,
      text: `${input.awaitingIntake} ${plural(input.awaitingIntake, "delivery is", "deliveries are")} physically here — verify counts and accept.`,
      actionLabel: "Receive it",
      actionHref: "/admin/inventory/intake",
    });
  }

  if (input.heldLots > 0) {
    rows.push({
      key: "held_lots",
      priority: 3,
      severity: "warning",
      icon: "⛔",
      count: input.heldLots,
      text: `${input.heldLots} accepted ${plural(input.heldLots, "lot is", "lots are")} held in quarantine (missing CCRS id or passing COA) — fix and finalize again.`,
      actionLabel: "Fix it",
      actionHref: "/admin/inventory?status=quarantine",
    });
  }

  if (input.onboardingDrafts > 0) {
    rows.push({
      key: "onboarding_drafts",
      priority: 4,
      severity: "warning",
      icon: "🆕",
      count: input.onboardingDrafts,
      text: `${input.onboardingDrafts} new ${plural(input.onboardingDrafts, "product draft", "product drafts")} awaiting review — set a price and approve onto the menu.`,
      actionLabel: "Review it",
      actionHref: "/admin/inventory/drafts",
    });
  }

  if (input.posToSend > 0) {
    rows.push({
      key: "pos_to_send",
      priority: 5,
      severity: "info",
      icon: "🧾",
      count: input.posToSend,
      text: `${input.posToSend} purchase ${plural(input.posToSend, "order hasn't", "orders haven't")} been sent to the vendor yet.`,
      actionLabel: "Send it",
      actionHref: "/admin/purchasing",
    });
  }

  if (input.masteringSuggestions > 0) {
    rows.push({
      key: "mastering_suggestions",
      priority: 6,
      severity: "info",
      icon: "🧬",
      count: input.masteringSuggestions,
      text: `${input.masteringSuggestions} product-mastering ${plural(input.masteringSuggestions, "suggestion", "suggestions")} to accept or reject.`,
      actionLabel: "Review it",
      actionHref: "/admin/products/masters?tab=suggestions",
    });
  }

  // Priority order is already guaranteed by construction; sort defensively so
  // a future edit can't silently reorder the queue.
  rows.sort((a, b) => a.priority - b.priority);
  return rows;
}

/**
 * W3 — the dashboard's "Needs your attention" flags reuse THE work queue.
 * Same verified counts, same priority order, same copy; shaped to match the
 * cockpit's AttentionFlag ({severity, text, href}) so the dashboard renders
 * intake work exactly like drawer/order/stock flags.
 */
export type IntakeAttentionFlag = {
  severity: "critical" | "warning" | "info";
  text: string;
  href: string;
};

export function workQueueAttentionFlags(input: WorkQueueInputs): IntakeAttentionFlag[] {
  return buildWorkQueue(input).map((row) => ({
    severity: row.severity,
    text: row.text,
    href: row.actionHref,
  }));
}

export function emptyWorkQueueInputs(): WorkQueueInputs {
  return {
    overdueInTransit: 0,
    awaitingIntake: 0,
    heldLots: 0,
    onboardingDrafts: 0,
    posToSend: 0,
    masteringSuggestions: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runWorkQueueCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL work-queue-core: " + msg);
    passed += 1;
  };

  // All-zero → genuinely empty queue.
  assert(buildWorkQueue(emptyWorkQueueInputs()).length === 0, "all clear = empty");

  // Full house → 6 rows in strict priority order.
  const full = buildWorkQueue({
    overdueInTransit: 2,
    awaitingIntake: 3,
    heldLots: 1,
    onboardingDrafts: 4,
    posToSend: 5,
    masteringSuggestions: 6,
  });
  assert(full.length === 6, "six rows when all present");
  assert(
    full.map((r) => r.key).join(",") ===
      "overdue_in_transit,awaiting_intake,held_lots,onboarding_drafts,pos_to_send,mastering_suggestions",
    "priority order fixed",
  );
  assert(full[0].severity === "critical", "overdue is critical");
  assert(full.every((r) => r.count > 0), "no zero-count rows");
  assert(full.every((r) => r.actionHref.startsWith("/admin/")), "actions rooted");

  // Sparse input keeps relative order and skips zeros.
  const sparse = buildWorkQueue({
    ...emptyWorkQueueInputs(),
    heldLots: 1,
    posToSend: 2,
  });
  assert(sparse.length === 2, "sparse two rows");
  assert(sparse[0].key === "held_lots" && sparse[1].key === "pos_to_send", "sparse order");

  // Singular/plural copy.
  const one = buildWorkQueue({ ...emptyWorkQueueInputs(), awaitingIntake: 1 });
  assert(one[0].text.includes("delivery is"), "singular copy");
  const many = buildWorkQueue({ ...emptyWorkQueueInputs(), awaitingIntake: 2 });
  assert(many[0].text.includes("deliveries are"), "plural copy");

  return { passed };
}
