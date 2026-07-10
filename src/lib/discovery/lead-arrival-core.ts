/**
 * src/lib/discovery/lead-arrival-core.ts
 *
 * W14 — lead loop-closure (audit gap G10).
 *
 * Problem: `promoted_po_id` stamps the PO onto a product lead when it's
 * promoted, but nothing closes the loop when that PO is received — the lead
 * sits at "ordered" forever and nobody reviews whether the bet paid off.
 *
 * Fix (no migration, no writes): arrival is DERIVED at read time. A lead is
 * "arrived" exactly when:
 *   - its status is "ordered" (the promote flow set that), AND
 *   - it carries a promoted_po_id, AND
 *   - that purchase order's status is "received" (terminal receive state).
 *
 * The UI surfaces those leads as "Arrived — review outcome"; the human then
 * records the outcome with the existing status controls (e.g. dismiss a dud,
 * or leave it ordered as a keeper note). Nothing changes in the database
 * until the human acts — drafts-first, even for bookkeeping.
 *
 * PURE module: no `server-only`, no DB, no React.
 */

import type { DiscoveryProductLead } from "@/lib/discovery/types";

/** The minimal PO facts arrival needs (fetched server-side, best-effort). */
export type LeadArrivalPoFact = {
  id: string;
  status: string;
  received_at: string | null;
};

export type LeadArrival = {
  /** True only for ordered leads whose promoted PO is fully received. */
  arrived: boolean;
  /** ISO timestamp the PO was received (when the PO recorded one). */
  receivedAt: string | null;
};

/** The badge label the UI shows for an arrived lead. */
export const LEAD_ARRIVED_LABEL = "Arrived — review outcome";

/** The lead fields arrival derivation actually reads (narrow on purpose). */
export type LeadArrivalLeadFacts = Pick<DiscoveryProductLead, "status" | "promoted_po_id">;

/**
 * Derive one lead's arrival state from its own facts + the PO facts map.
 * Missing PO facts (PO deleted, fetch failed, not received yet) → not arrived.
 */
export function resolveLeadArrival(
  lead: LeadArrivalLeadFacts,
  poFactsById: ReadonlyMap<string, LeadArrivalPoFact>,
): LeadArrival {
  if (lead.status !== "ordered" || !lead.promoted_po_id) {
    return { arrived: false, receivedAt: null };
  }
  const po = poFactsById.get(lead.promoted_po_id);
  if (!po || po.status !== "received") {
    return { arrived: false, receivedAt: null };
  }
  return { arrived: true, receivedAt: po.received_at ?? null };
}

/**
 * The de-duplicated PO ids worth fetching facts for: only ordered leads with
 * a promoted PO can ever arrive, so the server fetches exactly those.
 */
export function arrivalPoIds(leads: readonly LeadArrivalLeadFacts[]): string[] {
  const ids = leads
    .filter((l) => l.status === "ordered" && l.promoted_po_id)
    .map((l) => l.promoted_po_id as string);
  return [...new Set(ids)];
}

/** How many of the given leads have arrived (for the review-outcome notice). */
export function countArrivedLeads(
  leads: readonly LeadArrivalLeadFacts[],
  poFactsById: ReadonlyMap<string, LeadArrivalPoFact>,
): number {
  return leads.filter((l) => resolveLeadArrival(l, poFactsById).arrived).length;
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runLeadArrivalCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lead-arrival-core: " + msg);
    passed += 1;
  };

  const facts = new Map<string, LeadArrivalPoFact>([
    ["po-recv", { id: "po-recv", status: "received", received_at: "2026-01-05T10:00:00Z" }],
    ["po-recv-nostamp", { id: "po-recv-nostamp", status: "received", received_at: null }],
    ["po-partial", { id: "po-partial", status: "partial", received_at: null }],
    ["po-sent", { id: "po-sent", status: "sent", received_at: null }],
    ["po-cancelled", { id: "po-cancelled", status: "cancelled", received_at: null }],
  ]);

  // The happy path: ordered lead + received PO → arrived, timestamp carried.
  const hit = resolveLeadArrival({ status: "ordered", promoted_po_id: "po-recv" }, facts);
  assert(hit.arrived, "ordered + received PO arrives");
  assert(hit.receivedAt === "2026-01-05T10:00:00Z", "received_at carried through");

  // Received PO without a stamp still arrives (status is the source of truth).
  const noStamp = resolveLeadArrival({ status: "ordered", promoted_po_id: "po-recv-nostamp" }, facts);
  assert(noStamp.arrived && noStamp.receivedAt === null, "received PO without stamp still arrives");

  // Not-received PO states never arrive.
  for (const poId of ["po-partial", "po-sent", "po-cancelled"]) {
    assert(
      !resolveLeadArrival({ status: "ordered", promoted_po_id: poId }, facts).arrived,
      `PO status gate holds for ${poId}`,
    );
  }

  // Lead-side gates: only "ordered" leads with a promoted PO can arrive.
  assert(
    !resolveLeadArrival({ status: "ordered", promoted_po_id: null }, facts).arrived,
    "no promoted PO → not arrived",
  );
  assert(
    !resolveLeadArrival({ status: "shortlisted", promoted_po_id: "po-recv" }, facts).arrived,
    "non-ordered status → not arrived",
  );
  assert(
    !resolveLeadArrival({ status: "dismissed", promoted_po_id: "po-recv" }, facts).arrived,
    "dismissed → not arrived (human already closed it)",
  );

  // Missing PO facts (deleted PO / failed fetch) fail SAFE: not arrived.
  assert(
    !resolveLeadArrival({ status: "ordered", promoted_po_id: "po-gone" }, facts).arrived,
    "unknown PO id → not arrived",
  );
  assert(
    !resolveLeadArrival({ status: "ordered", promoted_po_id: "po-recv" }, new Map()).arrived,
    "empty facts map → not arrived",
  );

  // arrivalPoIds: only ordered leads with a PO, de-duplicated.
  const ids = arrivalPoIds([
    { status: "ordered", promoted_po_id: "a" },
    { status: "ordered", promoted_po_id: "a" },
    { status: "ordered", promoted_po_id: null },
    { status: "new", promoted_po_id: "b" },
    { status: "ordered", promoted_po_id: "c" },
  ]);
  assert(ids.join(",") === "a,c", "arrivalPoIds filters and de-dupes");
  assert(arrivalPoIds([]).length === 0, "arrivalPoIds empty-safe");

  // countArrivedLeads matches per-lead derivation.
  const n = countArrivedLeads(
    [
      { status: "ordered", promoted_po_id: "po-recv" },
      { status: "ordered", promoted_po_id: "po-partial" },
      { status: "dismissed", promoted_po_id: "po-recv" },
    ],
    facts,
  );
  assert(n === 1, "countArrivedLeads counts only true arrivals");

  return { passed };
}
