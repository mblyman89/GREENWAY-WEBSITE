/**
 * tests/compliance/intake-checklist-core.test.ts
 *
 * Slice AO — vitest mirror for the intake command-center checklist core.
 * The embedded self-tests carry the exhaustive matrix; here we run them and
 * pin the highest-value behaviors directly.
 */
import { describe, expect, it } from "vitest";
import {
  buildIntakeChecklist,
  KB_WRITEBACK_EVENT,
  __runIntakeChecklistCoreTests,
} from "@/lib/inventory/intake-checklist-core";

describe("intake-checklist-core (AO — manifest review command center)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runIntakeChecklistCoreTests()).not.toThrow();
  });

  it("received manifest with undecided lines: counting is the next action and the undecided-finalizes-as-accepted warning shows", () => {
    const c = buildIntakeChecklist({
      status: "received",
      lotDispositions: ["accepted", null],
      hasTransport: true,
      events: [],
    });
    expect(c.nextAction?.id).toBe("decide_lines");
    const lines = c.items.find((i) => i.id === "decide_lines");
    expect(lines?.state).toBe("todo");
    expect(lines?.detail).toContain("1 of 2");
    expect(lines?.detail).toContain("ACCEPTED when you finalize");
  });

  it("mark-accepted and promote-to-KB are AUTO before finalize (no buttons needed)", () => {
    const c = buildIntakeChecklist({
      status: "received",
      lotDispositions: ["accepted"],
      hasTransport: false,
      events: [],
    });
    expect(c.items.find((i) => i.id === "mark_accepted")?.state).toBe("auto");
    expect(c.items.find((i) => i.id === "promote_kb")?.state).toBe("auto");
  });

  it("kb_writeback audit event proves KB promotion done; a finalized accept without it becomes a real todo", () => {
    const promoted = buildIntakeChecklist({
      status: "accepted",
      lotDispositions: ["accepted"],
      hasTransport: true,
      events: [{ event_type: KB_WRITEBACK_EVENT }],
    });
    expect(promoted.items.find((i) => i.id === "promote_kb")?.state).toBe("done");
    expect(promoted.doneCount).toBe(6);
    expect(promoted.nextAction).toBeNull();

    const missed = buildIntakeChecklist({
      status: "accepted",
      lotDispositions: ["accepted"],
      hasTransport: true,
      events: [{ event_type: "accepted" }],
    });
    expect(missed.items.find((i) => i.id === "promote_kb")?.state).toBe("todo");
    expect(missed.nextAction?.id).toBe("promote_kb");
  });

  it("whole-manifest rejection: finalize done, KB never a todo (nothing accepted to promote)", () => {
    const c = buildIntakeChecklist({
      status: "rejected",
      lotDispositions: ["rejected_at_dock", "rejected_at_dock"],
      hasTransport: false,
      events: [{ event_type: "rejected" }],
    });
    expect(c.finished).toBe(true);
    expect(c.items.find((i) => i.id === "finalize")?.state).toBe("done");
    expect(c.items.find((i) => i.id === "promote_kb")?.state).toBe("auto");
  });
});
