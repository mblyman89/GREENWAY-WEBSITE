/**
 * tests/compliance/lifecycle.test.ts
 *
 * S-15 lifecycle integrity — the PURE transition matrices for orders and
 * purchase orders. These pin the rules the stores enforce:
 *
 *  ORDERS: forward-only chain new→acknowledged→preparing→ready→completed;
 *  closures from any active status; completed/cancelled/no_show terminal
 *  except an explicit reasoned reversal to a designated reopen target;
 *  backward active moves also need a reason.
 *
 *  POs: forward-only draft→submitted→sent→partial→received; cancel from any
 *  non-terminal status; received/cancelled terminal; never backward.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateOrderTransition,
  isTerminalOrderStatus,
  ORDER_REVERSAL_TARGETS,
  MIN_REVERSAL_REASON_LENGTH,
} from "@/lib/orders/order-lifecycle-core";
import type { OrderStatus } from "@/lib/orders/types";
import {
  evaluatePoTransition,
  isValidPoStatus,
  parsePoNumberSeq,
  makePoNumber,
  type PoStatus,
} from "@/lib/purchasing/po-core";

// ---------------------------------------------------------------------------
// Order lifecycle
// ---------------------------------------------------------------------------
describe("evaluateOrderTransition — forward chain", () => {
  const forward: [OrderStatus, OrderStatus][] = [
    ["new", "acknowledged"],
    ["acknowledged", "preparing"],
    ["preparing", "ready"],
    ["ready", "completed"],
    // skipping ahead is allowed (walk-in completed in one step)
    ["new", "ready"],
    ["new", "completed"],
    ["acknowledged", "completed"],
  ];
  it.each(forward)("%s → %s is allowed without a reason", (from, to) => {
    const v = evaluateOrderTransition(from, to);
    expect(v.allowed).toBe(true);
  });

  it("same-status is an allowed no-op", () => {
    const v = evaluateOrderTransition("preparing", "preparing");
    expect(v.allowed).toBe(true);
    expect(v.kind).toBe("noop");
  });
});

describe("evaluateOrderTransition — closures", () => {
  const closures: [OrderStatus, OrderStatus][] = [
    ["new", "cancelled"],
    ["acknowledged", "cancelled"],
    ["preparing", "no_show"],
    ["ready", "cancelled"],
    ["ready", "no_show"],
  ];
  it.each(closures)("%s → %s is allowed", (from, to) => {
    expect(evaluateOrderTransition(from, to).allowed).toBe(true);
  });
});

describe("evaluateOrderTransition — terminal statuses (the completed→new bug)", () => {
  it("completed → new is BLOCKED even with a reason (must reopen to ready)", () => {
    const v = evaluateOrderTransition("completed", "new", { reversalReason: "typo at register" });
    expect(v.allowed).toBe(false);
  });

  it("completed → ready without a reason is BLOCKED", () => {
    expect(evaluateOrderTransition("completed", "ready").allowed).toBe(false);
  });

  it("completed → ready WITH a reason is an allowed reversal", () => {
    const v = evaluateOrderTransition("completed", "ready", {
      reversalReason: "completed the wrong ticket",
    });
    expect(v.allowed).toBe(true);
    expect(v.kind).toBe("reversal");
  });

  it("cancelled → new requires a reason and reopens to new", () => {
    expect(ORDER_REVERSAL_TARGETS.cancelled).toBe("new");
    expect(evaluateOrderTransition("cancelled", "new").allowed).toBe(false);
    expect(
      evaluateOrderTransition("cancelled", "new", { reversalReason: "customer called back" })
        .allowed,
    ).toBe(true);
  });

  it("no_show → new requires a reason", () => {
    expect(evaluateOrderTransition("no_show", "new").allowed).toBe(false);
    expect(
      evaluateOrderTransition("no_show", "new", { reversalReason: "customer arrived late" })
        .allowed,
    ).toBe(true);
  });

  it("closed → closed cross-moves are blocked (cancelled → completed)", () => {
    expect(
      evaluateOrderTransition("cancelled", "completed", { reversalReason: "some reason" }).allowed,
    ).toBe(false);
  });

  it("short reasons (< MIN) are rejected", () => {
    const short = "x".repeat(MIN_REVERSAL_REASON_LENGTH - 1);
    expect(evaluateOrderTransition("completed", "ready", { reversalReason: short }).allowed).toBe(
      false,
    );
  });
});

describe("evaluateOrderTransition — backward active moves", () => {
  it("ready → preparing without a reason is BLOCKED", () => {
    expect(evaluateOrderTransition("ready", "preparing").allowed).toBe(false);
  });
  it("ready → preparing with a reason is an allowed reversal", () => {
    const v = evaluateOrderTransition("ready", "preparing", {
      reversalReason: "bagged the wrong items",
    });
    expect(v.allowed).toBe(true);
    expect(v.kind).toBe("reversal");
  });
});

describe("isTerminalOrderStatus", () => {
  it("flags completed/cancelled/no_show and not active statuses", () => {
    expect(isTerminalOrderStatus("completed")).toBe(true);
    expect(isTerminalOrderStatus("cancelled")).toBe(true);
    expect(isTerminalOrderStatus("no_show")).toBe(true);
    expect(isTerminalOrderStatus("new")).toBe(false);
    expect(isTerminalOrderStatus("ready")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PO lifecycle
// ---------------------------------------------------------------------------
describe("evaluatePoTransition", () => {
  const allowed: [PoStatus, PoStatus][] = [
    ["draft", "submitted"],
    ["submitted", "sent"],
    ["sent", "partial"],
    ["partial", "received"],
    ["draft", "sent"], // skip ahead: emailed outside the app
    ["sent", "received"], // everything arrived at once
    ["draft", "cancelled"],
    ["submitted", "cancelled"],
    ["sent", "cancelled"],
    ["partial", "cancelled"],
  ];
  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(evaluatePoTransition(from, to).allowed).toBe(true);
  });

  const blocked: [PoStatus, PoStatus][] = [
    ["received", "draft"],
    ["received", "sent"],
    ["received", "cancelled"], // terminal — a received PO cannot be cancelled
    ["cancelled", "draft"],
    ["cancelled", "sent"],
    ["sent", "draft"], // backward
    ["partial", "sent"], // backward
    ["submitted", "draft"], // backward
  ];
  it.each(blocked)("%s → %s is blocked with a reason", (from, to) => {
    const v = evaluatePoTransition(from, to);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBeTruthy();
  });

  it("same-status is an allowed no-op", () => {
    expect(evaluatePoTransition("sent", "sent").allowed).toBe(true);
  });
});

describe("isValidPoStatus", () => {
  it("accepts the six real statuses and rejects junk", () => {
    for (const s of ["draft", "submitted", "sent", "partial", "received", "cancelled"]) {
      expect(isValidPoStatus(s)).toBe(true);
    }
    expect(isValidPoStatus("deleted")).toBe(false);
    expect(isValidPoStatus("")).toBe(false);
    expect(isValidPoStatus("DRAFT")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PO numbering (race fix): max(seq)+1 instead of row count
// ---------------------------------------------------------------------------
describe("parsePoNumberSeq / makePoNumber round-trip", () => {
  it("parses the sequence back out of a generated number", () => {
    const d = new Date(Date.UTC(2026, 1, 10)); // Feb 2026
    expect(parsePoNumberSeq(makePoNumber(7, d))).toBe(7);
    expect(parsePoNumberSeq(makePoNumber(1234, d))).toBe(1234);
  });

  it("parses across months/years (sequence is global, prefix is cosmetic)", () => {
    expect(parsePoNumberSeq("PO-202501-0003")).toBe(3);
    expect(parsePoNumberSeq("PO-202612-0042")).toBe(42);
  });

  it("returns 0 for junk so max() is safe", () => {
    expect(parsePoNumberSeq(null)).toBe(0);
    expect(parsePoNumberSeq(undefined)).toBe(0);
    expect(parsePoNumberSeq("")).toBe(0);
    expect(parsePoNumberSeq("PO-abc-def")).toBe(0);
    expect(parsePoNumberSeq("INV-202501-0003")).toBe(0);
  });

  it("max(seq)+1 survives deletions (the count-based bug)", () => {
    // Simulate: 3 POs created, #2 deleted. count=2 would regenerate seq 3 (dup).
    const surviving = ["PO-202601-0001", "PO-202601-0003"];
    const maxSeq = surviving.reduce((m, n) => Math.max(m, parsePoNumberSeq(n)), 0);
    expect(maxSeq + 1).toBe(4); // never collides with the burned 0003
  });
});
