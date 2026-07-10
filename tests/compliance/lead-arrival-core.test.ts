import { describe, expect, it } from "vitest";
import {
  __runLeadArrivalCoreTests,
  arrivalPoIds,
  countArrivedLeads,
  LEAD_ARRIVED_LABEL,
  resolveLeadArrival,
  type LeadArrivalPoFact,
} from "@/lib/discovery/lead-arrival-core";

/**
 * W14 — lead loop-closure (audit G10). Arrival is DERIVED at read time
 * (ordered lead + received PO), never written: the human closes the loop
 * with the existing status controls. These tests pin the gates down.
 */
describe("lead-arrival-core (W14)", () => {
  const facts = new Map<string, LeadArrivalPoFact>([
    ["po-recv", { id: "po-recv", status: "received", received_at: "2026-01-05T10:00:00Z" }],
    ["po-partial", { id: "po-partial", status: "partial", received_at: null }],
  ]);

  it("passes its embedded self-tests", () => {
    const { passed } = __runLeadArrivalCoreTests();
    expect(passed).toBeGreaterThan(10);
  });

  it("arrives only for ordered leads whose promoted PO is fully received", () => {
    expect(resolveLeadArrival({ status: "ordered", promoted_po_id: "po-recv" }, facts)).toEqual({
      arrived: true,
      receivedAt: "2026-01-05T10:00:00Z",
    });
    // Partial receipt is NOT arrival — the loop closes on the terminal state.
    expect(
      resolveLeadArrival({ status: "ordered", promoted_po_id: "po-partial" }, facts).arrived,
    ).toBe(false);
    // A lead the human already resolved never re-surfaces.
    expect(
      resolveLeadArrival({ status: "dismissed", promoted_po_id: "po-recv" }, facts).arrived,
    ).toBe(false);
  });

  it("fails safe when PO facts are missing (deleted PO or failed fetch)", () => {
    expect(
      resolveLeadArrival({ status: "ordered", promoted_po_id: "po-gone" }, facts).arrived,
    ).toBe(false);
    expect(
      resolveLeadArrival({ status: "ordered", promoted_po_id: "po-recv" }, new Map()).arrived,
    ).toBe(false);
  });

  it("fetch list covers exactly the loop-closable leads, de-duplicated", () => {
    expect(
      arrivalPoIds([
        { status: "ordered", promoted_po_id: "a" },
        { status: "ordered", promoted_po_id: "a" },
        { status: "shortlisted", promoted_po_id: "b" },
        { status: "ordered", promoted_po_id: null },
      ]),
    ).toEqual(["a"]);
  });

  it("counts arrivals consistently and exposes the UI label", () => {
    expect(
      countArrivedLeads(
        [
          { status: "ordered", promoted_po_id: "po-recv" },
          { status: "ordered", promoted_po_id: "po-partial" },
        ],
        facts,
      ),
    ).toBe(1);
    expect(LEAD_ARRIVED_LABEL).toBe("Arrived — review outcome");
  });
});
