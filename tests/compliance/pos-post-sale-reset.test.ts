/**
 * tests/compliance/pos-post-sale-reset.test.ts  (SLICE 14)
 *
 * The owner's second report: "after completing a sale, the register locks as
 * it should. When I enter my pin to open it back up, it bypasses the age gate
 * and loads the same products in the cart for the same customer."
 *
 * Recon (docs/slice-13-recon-stock-and-reset.md §2) proved the chain:
 *
 *   1. SaleFlow never clears cart/verdict when a sale completes, and its
 *      onSnapshot effect keeps reporting the finished customer upward.
 *   2. The 2-minute idle timer is gated on `screen !== "home"`, but `screen`
 *      STAYS "home" during a sale (the SaleFlow branch keys off `saleActive`),
 *      so the timer is live on the "Sale complete" screen.
 *   3. If staff walk away instead of tapping "Done — lock register", the idle
 *      timer fires lock() — not onComplete — and lock() calls parkActiveSale()
 *      FIRST, re-persisting the completed sale.
 *   4. The next unlock re-validates the (still perfectly valid) ID and
 *      restores it; a present verdict starts SaleFlow at "cart", not "idgate".
 *
 * The fix is three independent defences. These tests assert all three are
 * actually WIRED, because the defect was never in the pure logic — the pure
 * resume core behaved exactly as designed. It was in how the components were
 * connected, which is precisely the kind of thing unit tests on a pure module
 * cannot catch, and which is why this file reads the wiring directly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateResume, snapshotFromSale, type ActiveSaleLine, type ResumableVerdict } from "@/lib/pos/active-sale-resume-core";

const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
const saleFlow = readFileSync(join(process.cwd(), "src/app/pos/SaleFlow.tsx"), "utf8");

/** Collapse whitespace so assertions survive reformatting. */
const flat = (s: string) => s.replace(/\s+/g, " ");
const shellFlat = flat(shell);
const saleFlowFlat = flat(saleFlow);

/**
 * Drop whole-line `//` comments before any ORDERING assertion.
 *
 * This is not cosmetic. The first draft of the "latches before lock()" test
 * used indexOf("lock();") and matched the COMMENT on RegisterShell.tsx:1492
 * ("...must never be re-parked by lock();") rather than the real call on
 * :1506 — reporting a false failure against correct code. Prose that quotes
 * code must never be mistaken for code. Only lines that START with `//` are
 * dropped, so a `https://` inside a string literal is untouched.
 */
const stripLineComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const shellCode = stripLineComments(shell);

// ---------------------------------------------------------------------------
// Why the pure core could never have caught this
// ---------------------------------------------------------------------------

describe("the pure resume core was never the bug", () => {
  const verdict: ResumableVerdict = {
    allowed: true,
    method: "scan",
    age: 34,
    dateOfBirth: "1992-01-15",
    expirationDate: "2030-01-15",
    idType: "drivers_license",
  };
  const lines: ActiveSaleLine[] = [{ variantId: "v1", quantity: 2 }];

  it("correctly resumes a still-valid parked sale — which is the RIGHT behaviour", () => {
    const snap = snapshotFromSale({
      verdict,
      lines,
      medicalCard: null,
      member: null,
      savedByName: "Sam",
      nowIso: "2026-07-19T17:59:00Z",
    });
    const decision = evaluateResume(snap, "2026-07-19", Date.parse("2026-07-19T18:00:00Z"));
    expect(decision.resume).toBe(true);
  });

  it("has no concept of 'already completed' — so the fix MUST live upstream", () => {
    // A completed sale's ID is still a perfectly valid ID. Nothing in the
    // snapshot distinguishes "parked mid-sale" from "already rung up", which
    // is exactly why the snapshot must never be WRITTEN for a finished sale.
    const snap = snapshotFromSale({
      verdict,
      lines,
      medicalCard: null,
      member: null,
      savedByName: "Sam",
      nowIso: "2026-07-19T17:59:00Z",
    });
    expect(snap).not.toBeNull();
    expect(Object.keys(snap!)).not.toContain("completed");
  });
});

// ---------------------------------------------------------------------------
// Defence 1 — SaleFlow stops advertising a completed sale
// ---------------------------------------------------------------------------

describe("defence 1: SaleFlow reports null once the sale is done", () => {
  it("the snapshot effect short-circuits on step === done", () => {
    expect(saleFlowFlat).toMatch(/if \(step === "done"\) \{ onSnapshotRef\.current\?\.\(null\); return; \}/);
  });

  it("step is a dependency of the snapshot effect, or it would never re-fire", () => {
    // Without `step` in the dep array the effect would not re-run when the
    // sale completes, and the guard above would be dead code.
    expect(saleFlowFlat).toMatch(/\}, \[verdict, cart, medicalCard, member, step\]\);/);
  });

  it("the onSnapshot prop type actually permits null", () => {
    // The doc comment always promised "Called with null when the sale is not
    // resumable", but the TYPE did not permit it — so a completed sale had no
    // way to say so and defence 1 would not have compiled.
    //
    // Asserted structurally rather than with one regex: the state object type
    // contains a NESTED brace (Extract<IdGateVerdict, { allowed: true }>), so
    // a `[^}]*` body match cannot span it. Slice the exact declaration and
    // check its closing shape.
    const decl = saleFlow.slice(saleFlow.indexOf("onSnapshot?: ("));
    const body = decl.slice(0, decl.indexOf(") => void;") + ") => void;".length);

    // Every field the shell needs to rebuild a resumable sale.
    expect(body).toMatch(/verdict: Extract<IdGateVerdict, \{ allowed: true \}> \| null;/);
    expect(body).toMatch(/cart: PosCartEntry\[\];/);
    expect(body).toMatch(/medicalCard: PosCardCapture \| null;/);
    expect(body).toMatch(/member: PosMemberHit \| null;/);

    // ...and the whole object may be null. This is the SLICE 14 widening.
    expect(flat(body)).toMatch(/\} \| null, \) => void;$/);
  });

  it("the shell's onSnapshot handler is typed to accept that null", () => {
    // Defence 1 is inert if the shell's handler narrows the parameter back to
    // non-null: SaleFlow would call it with null and the shell would ignore it.
    // Comment-stripped: the prose above this handler explains the SLICE 14
    // change in words, which would otherwise fill the whole search window.
    const handler = shellCode.slice(shellCode.indexOf("onSnapshot={(state) => {"));
    const body = handler.slice(0, handler.indexOf("onHold={"));
    // The null branch must come FIRST — before anything dereferences `state`.
    const nullAt = body.indexOf("if (state === null)");
    const derefAt = body.indexOf("state.verdict");
    expect(nullAt).toBeGreaterThan(-1);
    if (derefAt > -1) expect(nullAt).toBeLessThan(derefAt);
  });
});

// ---------------------------------------------------------------------------
// Defence 2 — parkActiveSale refuses to park a completed sale
// ---------------------------------------------------------------------------

describe("defence 2: parkActiveSale refuses a completed sale", () => {
  it("declares the completion latch as a ref (not state)", () => {
    // A ref, because parkActiveSale runs from pagehide/visibilitychange
    // handlers where a stale closure over state would reintroduce the bug.
    expect(shellFlat).toMatch(/const saleCompletedRef = useRef\(false\);/);
  });

  it("checks the latch BEFORE reading the live sale ref", () => {
    // Comment-stripped for the same reason as the onComplete ordering test:
    // the prose above parkActiveSale explains the latch by name, and matching
    // the explanation instead of the guard would make this test meaningless.
    // Bounded to parkActiveSale itself (:884) up to the next declaration,
    // `const lock` (:924) — the old boundary was the "auto-lock on idle"
    // banner comment, which stripLineComments now removes.
    const parkBody = shellCode.slice(
      shellCode.indexOf("const parkActiveSale"),
      shellCode.indexOf("const lock = useCallback"),
    );
    const latchAt = parkBody.indexOf("saleCompletedRef.current");
    const liveAt = parkBody.indexOf("const live = activeSaleRef.current");
    expect(latchAt).toBeGreaterThan(-1);
    expect(liveAt).toBeGreaterThan(-1);
    expect(latchAt).toBeLessThan(liveAt);
  });

  it("clears stored state and returns false when latched", () => {
    expect(flat(shell.slice(shell.indexOf("const parkActiveSale")))).toMatch(
      /if \(saleCompletedRef\.current\) \{ posStorageRemove\(ACTIVE_SALE_KEY\); return false; \}/,
    );
  });

  it("onComplete latches BEFORE it calls lock()", () => {
    // Ordering matters absolutely: lock() calls parkActiveSale(), so if the
    // latch were set after lock() the completed sale would already have been
    // re-persisted by the time the guard turned on.
    //
    // Comments are stripped first — the comment above the latch quotes the
    // word "lock();" in prose, and matching THAT is what made the first draft
    // of this test fail against perfectly correct code.
    const onComplete = shellCode.slice(shellCode.indexOf("onComplete={() => {"));
    const body = onComplete.slice(0, onComplete.indexOf("onCancel={"));
    const latchAt = body.indexOf("saleCompletedRef.current = true");
    const lockAt = body.indexOf("lock();");
    expect(latchAt).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(-1);
    expect(latchAt).toBeLessThan(lockAt);
  });

  it("onComplete also drops the live ref and the stored snapshot", () => {
    // Belt and braces around the latch: even if the latch were somehow
    // bypassed, there must be nothing left to park.
    const onComplete = shellCode.slice(shellCode.indexOf("onComplete={() => {"));
    const body = onComplete.slice(0, onComplete.indexOf("onCancel={"));
    expect(body).toContain("activeSaleRef.current = null");
    expect(body).toContain("posStorageRemove(ACTIVE_SALE_KEY)");
  });

  it("releases the latch when a NEW sale starts, or resume would break forever", () => {
    // This is the safety valve. A latch that is never cleared would silently
    // destroy session-resume for every subsequent sale — trading one bug for
    // a worse one.
    expect(shellFlat).toMatch(/useEffect\(\(\) => \{ if \(saleActive\) saleCompletedRef\.current = false; \}, \[saleActive\]\);/);
  });

  it("the release is centralised, not duplicated at each setSaleActive(true)", () => {
    const starts = shell.match(/setSaleActive\(true\)/g) ?? [];
    expect(starts.length).toBeGreaterThanOrEqual(4);
    // Exactly one place assigns false — the central effect.
    const releases = shell.match(/saleCompletedRef\.current = false/g) ?? [];
    expect(releases).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Defence 3 — lock() clears the website-order cart too
// ---------------------------------------------------------------------------

describe("defence 3: lock() clears loadedCart and loadedMember", () => {
  const lockBody = (() => {
    const start = shell.indexOf("const lock = useCallback(() => {");
    return shell.slice(start, shell.indexOf("const touchIdle", start));
  })();

  it("clears the loaded website-order cart", () => {
    expect(lockBody).toMatch(/setLoadedCart\(null\);/);
  });

  it("clears the loaded website-order member", () => {
    expect(lockBody).toMatch(/setLoadedMember\(null\);/);
  });

  it("still clears the resume state it always did", () => {
    expect(lockBody).toMatch(/setResumeCart\(null\);/);
    expect(lockBody).toMatch(/setResumeSnapshot\(null\);/);
  });

  it("closes the documented fallback chain that leaked the cart", () => {
    // SaleFlow's initialCart falls back resumedCart ?? resumeCart ?? loadedCart.
    // If lock() clears only the first two, the third survives into the next
    // customer's sale. Assert the chain still exists so this test keeps
    // guarding the real mechanism rather than a coincidence.
    expect(shellFlat).toMatch(/initialCart=\{resumedCart \?\? resumeCart \?\? loadedCart \?\? undefined\}/);
    expect(shellFlat).toMatch(/initialMember=\{resumeSnapshot\?\.member \?\? loadedMember \?\? undefined\}/);
  });
});

// ---------------------------------------------------------------------------
// The shell honours a null snapshot
// ---------------------------------------------------------------------------

describe("the shell acts on a null snapshot", () => {
  it("removes the stored snapshot when SaleFlow reports null", () => {
    const handler = shell.slice(shell.indexOf("onSnapshot={(state) => {"));
    const body = handler.slice(0, handler.indexOf("onHold={"));
    expect(flat(body)).toMatch(/if \(state === null\) \{ try \{ posStorageRemove\(ACTIVE_SALE_KEY\);/);
  });
});

// ---------------------------------------------------------------------------
// The age gate itself
// ---------------------------------------------------------------------------

describe("the age gate is what a restored verdict skips", () => {
  it("a present verdict starts the sale at cart, absent starts at idgate", () => {
    // This line is not a bug in itself — it is correct for a genuine resume.
    // It is pinned here because it is the mechanism the reported symptom rode
    // in on: if a completed sale is ever parked again, THIS is what skips the
    // age gate. Any change to it must be deliberate.
    expect(saleFlowFlat).toMatch(/useState<Step>\(initialVerdict \? "cart" : "idgate"\)/);
  });
});
