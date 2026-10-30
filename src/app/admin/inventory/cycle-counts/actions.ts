"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createCycleCount, applyCycleCount } from "@/lib/inventory/cycle-counts";
/*
 * Fix Phase 4.4a (G-39): the line-writing actions are GONE, not hidden.
 * recordLineCountAction, scanBumpLineAction, cancelCycleCountAction,
 * previewCountSheetAction and applyCountSheetAction used to live here. Each was
 * an exported "use server" function, which means a stable action id reachable
 * by a direct POST whether or not a button pointed at it. Deleting them removes
 * the endpoint; the library functions behind them also refuse
 * (CYCLE_COUNT_READ_ONLY) in case anything new ever calls them. Counting
 * happens on the audit count sheet (migration 0326).
 */
// classifyAbc / summarizeOverdueCounts / loadIntelLots are deliberately no longer
// imported here. The overdue-cadence action that used them now refuses, and an
// import left behind would make re-enabling a count-creating path look like a
// one-line change with no new dependencies.

/**
 * REFUSED at the action layer too (slice books-23).
 *
 * Both create actions below lost their buttons when the counting screen became a
 * work queue instead of a place counts are born. Losing a button is not losing a
 * capability: an exported `"use server"` function keeps a stable action id and
 * remains reachable by a direct HTTP POST. These wrappers therefore call the
 * library, which refuses, and report the library's own words.
 *
 * The message is NOT written a second time here. `createCycleCount` owns the
 * refusal text; copying it into this file would create two strings that mean the
 * same thing until the day somebody edits one of them (standing rule 42).
 *
 * The attempt is recorded in the audit trail rather than dropped, because "who
 * tried to start a count outside the approval flow" is exactly the question the
 * Security Log exists to answer.
 */
async function refuseCycleCountCreation(kind: "manual" | "overdue"): Promise<never> {
  const session = await requirePermission("inventory.manage");

  // Call the real function so the message shown is the one it produced. Both
  // arguments are placeholders: it refuses before reading either of them.
  const result = await createCycleCount({ label: "", scopeNote: null }, session.userId);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.create_refused",
    entityType: "cycle_counts",
    entityId: null,
    after: { refused: true, kind, reason: result.ok ? "unexpectedly allowed" : result.error },
  });

  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts?error=${encodeURIComponent(result.error)}`);
  }

  // Unreachable while createCycleCount refuses. Kept and kept loud: if this is
  // ever reached, something re-enabled a path that creates count sessions
  // without the owner approving the scope (standing rule 40).
  redirect(
    "/admin/inventory/cycle-counts?error=" +
      encodeURIComponent(
        "A count was created outside the approval flow, which should be impossible. " +
          "Do not count against it. Use Inventory Auditing, and tell someone that this " +
          "message appeared.",
      ),
  );
}

/**
 * Task L, retired. This used to open a count scoped to the lots overdue under the
 * ABC cadence (A 30d / B 90d / C 180d). The cadence maths was the useful part and
 * it did not die with this action: Inventory Auditing proposes scope to the owner,
 * who approves it. What changed is who decides, not whether the system suggests.
 */
export async function createOverdueCycleCountAction() {
  await refuseCycleCountCreation("overdue");
}

export async function createCycleCountAction(formData: FormData) {
  void formData;
  await refuseCycleCountCreation("manual");
}

/**
 * REFUSED at the action layer too (slice books-23).
 *
 * `applyCycleCount()` itself now refuses — that is the real lock, because this
 * path used the service-role key and no database policy could stop it. This
 * layer exists so the refusal is reported to whoever clicked, in plain English,
 * BEFORE the shelf-moving code is even reached, and so it lands in the audit
 * trail as an attempt rather than as silence.
 *
 * `recordAudit` is called on the REFUSAL. That is deliberate: an attempt to
 * apply a count the old way is exactly the event the owner would want to see in
 * the Security Log, and a refusal that leaves no trace teaches nobody anything.
 */
export async function applyCycleCountAction(countId: string) {
  const session = await requirePermission("inventory.manage");

  const result = await applyCycleCount(countId, session.userId);

  // This is unconditional in practice — applyCycleCount always refuses now. It
  // is written as a branch rather than a hardcoded redirect so that the message
  // shown is the one the library actually produced, instead of a second copy of
  // it here that could drift out of step (standing rule 42).
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "cycle_count.apply_refused",
    entityType: "cycle_counts",
    entityId: countId,
    after: { refused: true, reason: result.ok ? "unexpectedly allowed" : result.error },
  });

  if (!result.ok) {
    redirect(`/admin/inventory/cycle-counts/${countId}?error=${encodeURIComponent(result.error)}`);
  }

  // Unreachable while applyCycleCount refuses. Kept, and kept honest, because a
  // guard that assumes it can never be wrong is standing rule 40: if this line
  // is ever reached, something re-enabled the old path and the owner should be
  // told loudly rather than quietly succeed.
  redirect(
    `/admin/inventory/cycle-counts/${countId}?error=` +
      encodeURIComponent(
        "The old apply-a-cycle-count path reported success, which should be impossible. " +
          "Nothing has been trusted. Do not use this screen to correct inventory — use " +
          "Inventory Auditing, and tell someone that this message appeared.",
      ),
  );
}
