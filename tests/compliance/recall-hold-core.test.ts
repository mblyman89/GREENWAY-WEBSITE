/**
 * tests/compliance/recall-hold-core.test.ts (Task AN-7)
 *
 * Vitest mirror of the pure recall-hold core self-tests: the LCB recall hard
 * stop in the sale path (menu-bundle exclusion + completion-gate refusal).
 */
import { describe, expect, it } from "vitest";
import {
  HOLD_LOT_STATUS,
  buildRecallHoldIndex,
  findHeldLines,
  recallHoldRefusal,
  __runRecallHoldCoreTests,
} from "@/lib/pos/recall-hold-core";

describe("recall-hold-core (AN-7)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runRecallHoldCoreTests()).not.toThrow();
  });

  it("only 'recalled' lots hold — routine quarantine never trips the gate", () => {
    expect(HOLD_LOT_STATUS).toBe("recalled");
    const held = buildRecallHoldIndex([
      { posProductKey: "p1", status: "recalled" },
      { posProductKey: "p2", status: "quarantine" }, // intake / 72h destruction hold
      { posProductKey: "p3", status: "active" },
      { posProductKey: "p4", status: "destroyed" },
      { posProductKey: "p5", status: "sold_out" },
    ]);
    expect([...held]).toEqual(["p1"]);
  });

  it("any recalled lot holds the WHOLE product key (lines carry no lot identity)", () => {
    const held = buildRecallHoldIndex([
      { posProductKey: "p9", status: "active" },
      { posProductKey: "p9", status: "recalled" },
    ]);
    expect(held.has("p9")).toBe(true);
  });

  it("garbage rows are skipped, never guessed", () => {
    const held = buildRecallHoldIndex([
      { posProductKey: null, status: "recalled" },
      { posProductKey: "   ", status: "recalled" },
      { posProductKey: "ok", status: null },
    ]);
    expect(held.size).toBe(0);
  });

  it("findHeldLines dedupes, keeps line order, skips null product keys", () => {
    const held = new Set(["p1", "p3"]);
    const names = findHeldLines(
      [
        { productId: "p3", productName: "Gummy 10pk" },
        { productId: "p1", productName: "Blue Dream 3.5g" },
        { productId: "p1", productName: "Blue Dream 3.5g" },
        { productId: null, productName: "legacy line" },
        { productId: "p2", productName: "Fine Product" },
      ],
      held,
    );
    expect(names).toEqual(["Gummy 10pk", "Blue Dream 3.5g"]);
  });

  it("refusal message is a hard block with no override, null when clear", () => {
    expect(recallHoldRefusal([])).toBeNull();
    const one = recallHoldRefusal(["Blue Dream 3.5g"]);
    expect(one).toContain('"Blue Dream 3.5g" is under an active RECALL hold');
    expect(one).toContain("no override");
    const two = recallHoldRefusal(["A", "B"]);
    expect(two).toContain('"A", "B" are under an active RECALL hold');
  });
});
