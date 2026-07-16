/**
 * tests/compliance/menu-live-step-core.test.ts
 *
 * Intake auto-publish (owner-approved Option 1) — pins the ribbon's ④ "On
 * menu" step so it never misrepresents the record:
 *   - Before accept there is no menu story — the step must sit neutral.
 *   - Unreadable counts must NEVER render as "done" (no blind green checks).
 *   - Unpriced drafts outrank a stuck staged version (price first, publish
 *     fallback second) and each state deep-links to the ONE page that
 *     advances it.
 *   - The done states celebrate only what actually happened (approved counts
 *     woven in; "nothing needed" when the delivery added no menu products).
 */

import { describe, it, expect } from "vitest";
import {
  menuStep,
  MENU_STEP_LABEL,
  DRAFTS_PATH,
  MENU_IMPORTS_PATH,
  __runMenuLiveStepCoreTests,
  type MenuStepInput,
} from "@/lib/inventory/menu-live-step-core";

const counts = (p: number, a: number, s = false): MenuStepInput => ({
  pendingDrafts: p,
  approvedDrafts: a,
  stagedWaiting: s,
});

describe("menu-live-step-core: pre-accept lifecycle", () => {
  it("every non-accepted status renders a neutral todo (no line, no link)", () => {
    for (const s of ["pending", "in_transit", "received", "rejected", "???", ""]) {
      const v = menuStep(s, counts(3, 2, true));
      expect(v.state).toBe("todo");
      expect(v.line).toBeNull();
      expect(v.href).toBeNull();
      expect(v.linkLabel).toBeNull();
    }
  });

  it("accepted with unreadable counts never claims done", () => {
    const v = menuStep("accepted", null);
    expect(v.state).toBe("todo");
    expect(v.line).toBeNull();
  });
});

describe("menu-live-step-core: work remaining", () => {
  it("unpriced drafts → current, deep-links to Product Onboarding", () => {
    const v = menuStep("accepted", counts(2, 1));
    expect(v.state).toBe("current");
    expect(v.line).toContain("2 products");
    expect(v.line).toContain("Approve");
    expect(v.href).toBe(DRAFTS_PATH);
    expect(v.linkLabel).toBe("Price & approve");
  });

  it("singular copy for one pending draft", () => {
    const v = menuStep("partially_accepted", counts(1, 0));
    expect(v.line).toContain("1 product from this delivery still needs");
  });

  it("pending drafts outrank a stuck staged version", () => {
    expect(menuStep("accepted", counts(1, 0, true)).href).toBe(DRAFTS_PATH);
  });

  it("stuck staged version (publish fallback) → current, deep-links to Menu Imports", () => {
    const v = menuStep("accepted", counts(0, 2, true));
    expect(v.state).toBe("current");
    expect(v.line).toContain("Publish");
    expect(v.href).toBe(MENU_IMPORTS_PATH);
    expect(v.linkLabel).toBe("Publish now");
  });
});

describe("menu-live-step-core: done states", () => {
  it("approved products live → done with the count woven in, no link", () => {
    const v = menuStep("accepted", counts(0, 3));
    expect(v.state).toBe("done");
    expect(v.line).toContain("3 approved products went live");
    expect(v.href).toBeNull();
  });

  it("singular done copy", () => {
    expect(menuStep("accepted", counts(0, 1)).line).toContain("1 approved product went");
  });

  it("no drafts at all → done, nothing-was-needed copy", () => {
    const v = menuStep("accepted", counts(0, 0));
    expect(v.state).toBe("done");
    expect(v.line).toContain("needed no new menu products");
  });

  it("garbage counts sanitize to zero rather than misrendering", () => {
    const v = menuStep("accepted", {
      pendingDrafts: Number.NaN,
      approvedDrafts: -4,
      stagedWaiting: false,
    });
    expect(v.state).toBe("done");
    expect(v.line).toContain("needed no new");
  });
});

describe("menu-live-step-core: constants + self-tests", () => {
  it("step label is stable (rendered verbatim on the ribbon)", () => {
    expect(MENU_STEP_LABEL).toBe("On menu");
  });

  it("bundled self-tests pass", () => {
    expect(() => __runMenuLiveStepCoreTests()).not.toThrow();
  });
});
