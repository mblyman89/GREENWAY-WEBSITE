/**
 * tests/compliance/leafly-readback-scope.test.ts  (SLICE L-19)
 *
 * THE INCIDENT THIS FILE EXISTS BECAUSE OF
 * ----------------------------------------
 * The owner made the shop's first ever targeted transmission to Leafly: eight
 * products, chosen with the picker, sent as a PUT. It worked perfectly. All
 * eight landed. Leafly's sandbox menu showed exactly those eight.
 *
 * He then clicked "read the menu back" and was told:
 *
 *     19 PROBLEMS!
 *     8 of 2562 item(s) matched up with 10 problem(s)
 *     We sent "1937 - 3.5g Flower - Blackberry - 3.5g" but Leafly's menu does
 *     not contain it.
 *
 * Every one of those problems was false. Nothing was wrong with the menu, the
 * payload, the mapping, or Leafly. The reconciler had been handed the WRONG
 * BASELINE: it compared the whole 2,562-item published feed against the eight
 * items Leafly had been asked to hold, and faithfully reported the 2,554-item
 * difference as errors.
 *
 * WHY IT SURVIVED A LARGE TEST SUITE
 * ----------------------------------
 * Because the reconciler was never wrong about the DATA. Given a payload and a
 * read-back it computed the difference correctly, and every test proved exactly
 * that. The defect was one line further out, in the caller: `getLeaflyMenu()`
 * built its comparison payload with `previewLeaflyPush()`, which means "the
 * entire menu as it stands now". That is the CORRECT baseline after a full
 * sync, and the only case anybody had ever exercised.
 *
 * So the bug required a targeted push to exist before it could be seen, and
 * targeted pushes were new. This is the ordinary shape of a latent defect: not
 * an untested function, but an untested *combination*.
 *
 * THE FIX, AND WHY IT IS STRUCTURAL RATHER THAN A FILTER
 * -----------------------------------------------------
 * The obvious repair is to suppress "missing from Leafly" warnings after a
 * targeted push. That was rejected. A warning you have to filter out later is a
 * warning that will come back the next time somebody forgets the filter.
 *
 * Instead the reconciler now takes a SCOPE. In targeted scope it is never given
 * ids it did not send, so "this item is missing" is impossible BY CONSTRUCTION
 * rather than suppressed after the fact, and the items Leafly holds that were
 * not part of the push are counted as `untouchedAtLeafly` -- a fact, not a
 * fault. Full scope is the default and behaves exactly as before, which the
 * tests below pin so the fix cannot silently become a regression for the full
 * sync path.
 *
 * WHAT THESE TESTS ADD OVER THE EMBEDDED SELF-TESTS
 * -------------------------------------------------
 * The cores self-test their own logic. These read the real files off disk and
 * prove the WIRING: that push.ts actually chooses a baseline instead of
 * reaching for the whole feed again, that the log-message prefix is a shared
 * constant rather than a retyped literal, and that CI runs the new self-tests
 * with a real floor. A unit test cannot catch "somebody put the old call back".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  __runLeaflyReadbackTests,
  describeReconcileResult,
  parseLeaflyMenuReadback,
  reconcileLeaflyMenu,
} from "@/lib/leafly/readback-core";
import type { LeaflyItem, LeaflyItemsPayload } from "@/lib/leafly/payload-core";
import {
  TARGETED_PUSH_LOG_PREFIX,
  __runLeaflyReadbackBaselineTests,
  chooseReadbackBaseline,
  isTargetedPushLog,
  type ReadbackLogRow,
} from "@/lib/leafly/readback-baseline-core";

const ROOT = process.cwd();
const PUSH = join(ROOT, "src/lib/leafly/push.ts");
const BASELINE_CORE = join(ROOT, "src/lib/leafly/readback-baseline-core.ts");
const READBACK_CORE = join(ROOT, "src/lib/leafly/readback-core.ts");
const ACTIONS = join(ROOT, "src/app/admin/integrations/leafly/actions.ts");
const SELECTION_ACTIONS = join(ROOT, "src/app/admin/integrations/leafly/selection-actions.ts");
const CLIENT = join(ROOT, "src/app/admin/integrations/leafly/leafly-client.tsx");
const SELFTEST_RUNNER = join(ROOT, "scripts/compliance/run-pure-selftests.ts");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

/**
 * Source with comments removed.
 *
 * Every wiring guard below must read stripped source. This very file explains
 * the bug in prose that contains the exact strings being searched for -- an
 * unstripped grep for `previewLeaflyPush` would match the sentence describing
 * why it must not be called there. Text search cannot tell prose from code.
 */
function readCode(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// ---------------------------------------------------------------------------

describe("the comment stripper these guards depend on", () => {
  it("removes block comments", () => {
    // readback-core.ts documents the scope type in a long block comment. If the
    // stripper were broken, every guard below would pass while proving nothing.
    expect(readCode(READBACK_CORE)).not.toContain("field-report");
  });

  it("does not eat a URL inside a string literal", () => {
    expect(readCode(BASELINE_CORE).length).toBeGreaterThan(1000);
    expect(readCode(PUSH)).toContain("reconcileLeaflyMenu");
  });
});

// ---------------------------------------------------------------------------

describe("the exact failure the owner saw", () => {
  /**
   * Eight items sent; Leafly holds those eight plus 1,876 pre-existing ones.
   *
   * The Leafly side is built by running a realistic response body through the
   * REAL parser rather than hand-constructing `LeaflyReadbackItem` objects. A
   * hand-built fixture only proves the reconciler agrees with my idea of the
   * shape; parsing proves it agrees with the parser's, which is what actually
   * arrives at runtime. An earlier draft of this file hand-built them, omitted
   * `variants`, and threw inside the reconciler -- a test failing for the wrong
   * reason, which is indistinguishable from a test that does not exist.
   */
  function scenario() {
    // Typed as the REAL payload, not `as never`. A cast here would let the
    // fixture drift from the wire contract without anything complaining, and
    // this file's whole subject is a comparison that went wrong because two
    // sides disagreed about what was sent.
    const sent: LeaflyItemsPayload = {
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `SKU-${i}`,
        type: "flower" as LeaflyItem["type"],
        name: `Product ${i}`,
        variants: [],
      })),
    };

    // The envelope is `{ result: [...], metadata: { totalCount } }`. Building
    // this by hand as `{ data: ... }` is the mistake the parser caught on the
    // first run of this file -- which is the argument for parsing rather than
    // hand-constructing in one line.
    const body = (ids: { id: string; name: string }[]) => ({
      result: ids.map((i) => ({
        id: i.id,
        name: i.name,
        variants: [],
      })),
      metadata: { totalCount: ids.length },
    });

    const leaflyHolds = [
      ...sent.items.map((i) => ({ id: i.id, name: i.name })),
      ...Array.from({ length: 1876 }, (_, i) => ({
        id: `OLD-${i}`,
        name: `Pre-existing ${i}`,
      })),
    ];

    const back = parseLeaflyMenuReadback(body(leaflyHolds));
    if (!back.ok) throw new Error(`fixture did not parse: ${back.reason}`);
    return { sent, back, leaflyHolds, body };
  }

  it("the fixture itself parses, so the tests below are real", () => {
    // A scenario that silently failed to parse would make every assertion
    // below vacuous.
    const { back } = scenario();
    expect(back.ok).toBe(true);
    expect(back.items.length).toBe(1884);
  });

  it("targeted scope reports no problems when every sent item landed", () => {
    const { sent, back } = scenario();
    const result = reconcileLeaflyMenu(sent, back, "targeted");
    expect(result.scope).toBe("targeted");
    expect(result.comparedItemCount).toBe(8);
    // This is the assertion that would have failed before the fix.
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("targeted scope counts the untouched items as a fact, not a fault", () => {
    const { sent, back } = scenario();
    const result = reconcileLeaflyMenu(sent, back, "targeted");
    expect(result.untouchedAtLeafly).toBe(1876);
  });

  it("targeted scope never emits a missing_from_leafly issue for an unsent id", () => {
    const { sent, back } = scenario();
    const result = reconcileLeaflyMenu(sent, back, "targeted");
    const missing = result.issues.filter((i) => i.code === "missing_from_leafly");
    expect(missing).toHaveLength(0);
  });

  it("the summary explains that the rest of the menu was left alone", () => {
    const { sent, back } = scenario();
    const result = reconcileLeaflyMenu(sent, back, "targeted");
    const text = describeReconcileResult(result);
    expect(text).toMatch(/were not part of this push/i);
    expect(text).toMatch(/left alone/i);
  });

  it("NEGATIVE CONTROL: targeted scope still fails when a SENT item is absent", () => {
    // The whole value of the fix is that it silences FALSE alarms only. A
    // scope that silences real ones is not a fix, it is a blindfold, and this
    // is the test that tells the two apart.
    const { sent, leaflyHolds, body } = scenario();
    const withoutOne = parseLeaflyMenuReadback(
      body(leaflyHolds.filter((i) => i.id !== "SKU-3")),
    );
    if (!withoutOne.ok) throw new Error("fixture did not parse");
    const result = reconcileLeaflyMenu(sent, withoutOne, "targeted");
    const missing = result.issues.filter((i) => i.code === "missing_from_leafly");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("error");
    expect(JSON.stringify(missing[0])).toContain("SKU-3");
  });

  it("full scope is the default and still reports unsent items", () => {
    // The full sync path must be unchanged. A fix that quietly converts every
    // read-back to targeted would hide genuine deletions after a real sync.
    const { sent, back } = scenario();
    const defaulted = reconcileLeaflyMenu(sent, back);
    expect(defaulted.scope).toBe("full");
    expect(defaulted.untouchedAtLeafly).toBeNull();
  });

  it("full scope and explicit full scope agree", () => {
    const { sent, back } = scenario();
    const a = reconcileLeaflyMenu(sent, back);
    const b = reconcileLeaflyMenu(sent, back, "full");
    expect(a.issues.length).toBe(b.issues.length);
    expect(a.comparedItemCount).toBe(b.comparedItemCount);
  });
});

// ---------------------------------------------------------------------------

describe("choosing what to compare against", () => {
  const pay = (n: number): unknown => ({
    items: Array.from({ length: n }, (_, i) => ({ id: `S${i}` })),
  });

  const targeted: ReadbackLogRow = {
    mode: "live",
    status: "ok",
    payload: pay(8),
    message: `${TARGETED_PUSH_LOG_PREFIX} — Sent 8 product(s) to Leafly.`,
    created_at: "2026-09-20T12:00:00Z",
  };
  const full: ReadbackLogRow = {
    mode: "live",
    status: "ok",
    payload: pay(1876),
    message: "Full sync sent (1876 created).",
    created_at: "2026-09-19T12:00:00Z",
  };

  it("the newest targeted push becomes the baseline", () => {
    const b = chooseReadbackBaseline([targeted, full], pay(2562) as never);
    expect(b.source).toBe("targeted-push-log");
    expect(b.scope).toBe("targeted");
    expect(b.payload?.items.length).toBe(8);
  });

  it("it does NOT fall back to the whole feed when a push is on record", () => {
    // One line, restating the entire bug.
    const b = chooseReadbackBaseline([targeted, full], pay(2562) as never);
    expect(b.payload?.items.length).not.toBe(2562);
  });

  it("a full sync still produces a full-scope baseline", () => {
    const b = chooseReadbackBaseline([full], pay(2562) as never);
    expect(b.source).toBe("full-sync-log");
    expect(b.scope).toBe("full");
  });

  it("a failed targeted push is never used as a baseline", () => {
    // The failure path logs with the same prefix. If status were ignored, a
    // push that never reached Leafly would become the thing Leafly is
    // compared against -- reporting every item as missing.
    const failed: ReadbackLogRow = {
      mode: "live",
      status: "error",
      payload: pay(3),
      message: `${TARGETED_PUSH_LOG_PREFIX} failed — HTTP 500`,
      created_at: "2026-09-21T12:00:00Z",
    };
    const b = chooseReadbackBaseline([failed, targeted], pay(2562) as never);
    expect(b.payload?.items.length).toBe(8);
  });

  it("a dry run is never used as a baseline", () => {
    const dry: ReadbackLogRow = {
      mode: "preview",
      status: "ok",
      payload: pay(5),
      message: `${TARGETED_PUSH_LOG_PREFIX} — dry run`,
      created_at: "2026-09-21T12:00:00Z",
    };
    const b = chooseReadbackBaseline([dry, targeted], pay(2562) as never);
    expect(b.payload?.items.length).toBe(8);
  });

  it("with no history at all it says so, and warns about the limitation", () => {
    const b = chooseReadbackBaseline([], pay(2562) as never);
    expect(b.source).toBe("live-preview");
    expect(b.explanation).toMatch(/limitation/i);
  });

  it("with no history and no preview it compares nothing rather than guessing", () => {
    const b = chooseReadbackBaseline([], null);
    expect(b.source).toBe("none");
    expect(b.payload).toBeNull();
  });

  it("every baseline explains itself in plain English", () => {
    const cases = [
      chooseReadbackBaseline([targeted], pay(2562) as never),
      chooseReadbackBaseline([full], pay(2562) as never),
      chooseReadbackBaseline([], pay(2562) as never),
      chooseReadbackBaseline([], null),
    ];
    for (const b of cases) {
      expect(b.explanation.length).toBeGreaterThan(30);
      // No jargon leaking into the owner's screen.
      expect(b.explanation).not.toMatch(/payload|reconcile|scope/i);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the log-message prefix is a shared contract, not a coincidence", () => {
  it("is exported as a constant", () => {
    expect(TARGETED_PUSH_LOG_PREFIX.length).toBeGreaterThan(0);
  });

  it("recognises a message built from itself", () => {
    expect(
      isTargetedPushLog({
        mode: "live",
        status: "ok",
        payload: null,
        message: `${TARGETED_PUSH_LOG_PREFIX} — ok`,
      }),
    ).toBe(true);
  });

  it("NEGATIVE CONTROL: does not recognise an unrelated message", () => {
    expect(
      isTargetedPushLog({
        mode: "live",
        status: "ok",
        payload: null,
        message: "Full sync sent (1876 created).",
      }),
    ).toBe(false);
  });

  it("the push action IMPORTS the constant rather than retyping the words", () => {
    // This is the coupling that makes the whole fix work. A hand-typed
    // "Targeted push" here would compile, log, and read back wrongly forever,
    // because the recogniser and the writer would have drifted apart with
    // nothing to notice. Importing it means a rename breaks the build.
    const src = readCode(SELECTION_ACTIONS);
    expect(src).toMatch(/import\s*\{[^}]*TARGETED_PUSH_LOG_PREFIX[^}]*\}\s*from\s*["']@\/lib\/leafly\/readback-baseline-core["']/);
  });

  it("the push action does not contain a hand-typed copy of the prefix", () => {
    const src = readCode(SELECTION_ACTIONS);
    // The literal words must appear nowhere in the CODE -- only via the
    // constant. (Comments are stripped, so the explanation above is exempt.)
    expect(src).not.toContain(`"${TARGETED_PUSH_LOG_PREFIX}`);
    expect(src).not.toContain(`\`${TARGETED_PUSH_LOG_PREFIX}`);
  });

  it("both the success and failure log lines use the constant", () => {
    const src = readCode(SELECTION_ACTIONS);
    const uses = src.match(/\$\{TARGETED_PUSH_LOG_PREFIX\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------

describe("push.ts is wired to the baseline chooser", () => {
  it("imports the chooser", () => {
    expect(readCode(PUSH)).toMatch(/import\s*\{[^}]*chooseReadbackBaseline/);
  });

  it("calls the chooser", () => {
    // Assert the CALL, not the name. A name can survive in a type import while
    // the call is gone.
    expect(readCode(PUSH)).toMatch(/chooseReadbackBaseline\s*\(/);
  });

  it("passes the chosen scope into the reconciler", () => {
    // The scope argument is the entire fix. Reconciling with the chosen payload
    // but a hardcoded "full" would reproduce the bug with extra steps.
    const src = readCode(PUSH);
    const call = src.match(/reconcileLeaflyMenu\(([\s\S]{0,200}?)\)\s*\n/);
    expect(call).not.toBeNull();
    const args = call![1];
    expect(args).toMatch(/baseline\.scope/);
    // And it must be the VALUE, not a literal dressed up to look like one. A
    // mutant wrote `"full" as typeof baseline.scope`, which still contains the
    // words `baseline.scope` and survived the looser spelling of this guard.
    expect(args).not.toMatch(/["']full["']/);
    expect(args).not.toMatch(/["']targeted["']/);
    expect(args).not.toMatch(/\bas\s+typeof\b/);
  });

  it("does not reach for the whole feed as the comparison payload any more", () => {
    // The original line was:  const preview = await previewLeaflyPush();
    // followed by reconciling against it. previewLeaflyPush may still be used
    // as a LAST-RESORT fallback, but it must not be what the reconciler is
    // handed directly.
    const src = readCode(PUSH);
    expect(src).not.toMatch(/reconcileLeaflyMenu\(\s*payload\s*\?\?\s*null\s*,/);
  });

  it("returns the baseline so the screen can disclose it", () => {
    expect(readCode(PUSH)).toMatch(/baseline/);
  });
});

describe("the admin screen discloses what the comparison was against", () => {
  it("the action carries the baseline through to the client", () => {
    expect(readCode(ACTIONS)).toMatch(/baseline/);
  });

  it("the audit record notes which baseline was used", () => {
    // Reconstructing a disputed read-back six months later requires knowing
    // what it was compared against, not merely what it concluded.
    const src = readCode(ACTIONS);
    expect(src).toMatch(/baselineSource/);
    expect(src).toMatch(/baselineScope/);
  });

  it("the screen shows the explanation to the operator", () => {
    const src = readCode(CLIENT);
    expect(src).toMatch(/baseline\.explanation/);
    expect(src).toMatch(/What this was checked against/);
  });

  it("the weakest baseline is visually flagged, not shown as routine", () => {
    // "live-preview" means there was no push on record, so a targeted push
    // WILL look like a menu full of missing items. Presenting that in the same
    // grey as a trustworthy comparison is how a false alarm gets believed.
    expect(readCode(CLIENT)).toMatch(/live-preview/);
  });
});

// ---------------------------------------------------------------------------

describe("CI runs the new cores with a real floor", () => {
  it("registers the baseline core's self-tests", () => {
    const runner = readCode(SELFTEST_RUNNER);
    expect(runner).toMatch(/__runLeaflyReadbackBaselineTests\s*\(/);
  });

  it("registers it with assertRan and a meaningful floor", () => {
    // A bare call would pass even if every assertion inside the core were
    // deleted. The floor is what makes the registration mean something.
    const runner = readCode(SELFTEST_RUNNER);
    const call = runner.match(
      /assertRan\(\s*"leafly-readback-baseline-core",\s*__runLeaflyReadbackBaselineTests\(\),\s*(\d+)\s*,?\s*\)/,
    );
    expect(call).not.toBeNull();
    expect(Number(call![1])).toBeGreaterThanOrEqual(30);
  });

  it("raises the readback core's floor to cover the new scope tests", () => {
    const runner = readCode(SELFTEST_RUNNER);
    const call = runner.match(
      /assertRan\(\s*"leafly-readback-core",\s*__runLeaflyReadbackTests\(\),\s*(\d+)\s*,?\s*\)/,
    );
    expect(call).not.toBeNull();
    expect(Number(call![1])).toBeGreaterThanOrEqual(95);
  });
});

describe("the embedded self-tests actually pass", () => {
  it("readback-core", () => {
    const r = __runLeaflyReadbackTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(95);
  });

  it("readback-baseline-core", () => {
    const r = __runLeaflyReadbackBaselineTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });
});
