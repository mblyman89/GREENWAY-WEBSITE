/**
 * SLICE I — the age gate is the storefront's largest contentful paint.
 *
 * MEASURED on greenwaywebsite1.vercel.app/menu (mobile, 4x CPU, 1.6 Mbps — the
 * profile PageSpeed uses):
 *
 *     LCP candidate 1 .. t=3896ms  IMG   header wordmark
 *     LCP candidate 2 .. t=4292ms  SPAN  "Browse our full selection..."
 *     LCP candidate 3 .. t=4804ms  P     "you must be 21 years of age or older"  <- FINAL
 *
 *     served HTML contains "21 years of age"?  false
 *     served HTML contains "Age Verification"? false
 *
 * The element defining LCP was not in the HTML at all — it could only appear
 * after React hydrated a 3.3 MB payload (domInteractive 5695ms).
 *
 * The pure invariants (fail-closed bootstrap, exempt paths, key stability) live
 * in `age-gate-core.ts` self-tests. THIS file guards the WIRING, which a pure
 * core cannot see: that the server snapshot still renders the gate, that the
 * bootstrap is still synchronous and still in <head>, and that the CSS rule
 * that prevents the flash still exists. Each of these can be silently undone by
 * an unrelated refactor, and each failure mode is invisible in development —
 * where localStorage is already set and the network is instant.
 *
 * Every assertion below was verified to FAIL against a deliberate mutation
 * (17 mutations, 17 caught) rather than assumed to be meaningful.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGE_CONFIRMED_ATTRIBUTE,
  AGE_GATE_ELEMENT_ATTRIBUTE,
  AGE_STORAGE_KEY,
  ageGateBootstrapScript,
  isAgeGateExemptPath,
} from "../../src/lib/age-gate/age-gate-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const AGE_GATE = read("src/components/age-gate/AgeGate.tsx");
const LAYOUT = read("src/app/layout.tsx");
const GLOBALS = read("src/app/globals.css");
const SELFTESTS = read("scripts/compliance/run-pure-selftests.ts");

/**
 * Strip comments before asserting on code. Without this, a test can pass purely
 * because a word appears in prose — which is how an earlier slice's assertion
 * false-positived on a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("SLICE I — the age gate must be in the server HTML", () => {
  const code = stripComments(AGE_GATE);

  it("reports UNCONFIRMED from the server snapshot so the gate is server-rendered", () => {
    // This is the whole fix. If it returns true again, the gate vanishes from
    // the served HTML and LCP goes back to waiting on hydration.
    const snapshot = code.match(
      /function getServerAgeConfirmationSnapshot\(\)\s*\{([\s\S]*?)\}/,
    );
    expect(snapshot, "getServerAgeConfirmationSnapshot must exist").toBeTruthy();
    expect(snapshot![1]).toMatch(/return\s+false\s*;/);
    expect(snapshot![1]).not.toMatch(/return\s+true\s*;/);
  });

  it("still passes the server snapshot to useSyncExternalStore", () => {
    // A three-argument useSyncExternalStore is what makes SSR render the gate.
    // Drop the third argument and React throws during SSR instead.
    expect(code).toMatch(
      /useSyncExternalStore\(\s*subscribeToAgeConfirmation\s*,\s*getAgeConfirmationSnapshot\s*,\s*getServerAgeConfirmationSnapshot\s*,?\s*\)/,
    );
  });

  it("marks the gate root with the attribute the pre-paint CSS targets", () => {
    // Without this hook the CSS cannot hide the gate, and every returning
    // customer sees the modal flash on every page load.
    //
    // This assertion originally read `expect(code).toContain(
    // "AGE_GATE_ELEMENT_ATTRIBUTE")`, which mutation testing proved was a
    // rubber stamp: deleting the attribute from the JSX still left the IMPORT
    // line, so the test passed while the flash bug shipped. Assert the
    // attribute is actually SPREAD ONTO the rendered root, not merely imported.
    expect(AGE_GATE_ELEMENT_ATTRIBUTE).toBe("data-age-gate");

    const jsx = code.slice(code.indexOf("return ("));
    expect(jsx, "the component must render something").toBeTruthy();
    expect(jsx).toMatch(/\{\.\.\.\{\s*\[AGE_GATE_ELEMENT_ATTRIBUTE\]\s*:\s*["']["']\s*\}\}/);

    // ...and that it lands on the FIXED, FULL-SCREEN overlay element — the one
    // that must disappear — rather than some inner decoration.
    const root = jsx.slice(0, jsx.indexOf("</div>"));
    expect(root).toContain("AGE_GATE_ELEMENT_ATTRIBUTE");
    expect(root).toContain("fixed inset-0");
    expect(root).toContain('role="dialog"');
  });

  it("reads the storage key from the shared core, not a private copy", () => {
    // The bootstrap script and the component MUST agree on the key. A local
    // duplicate is how they drift.
    expect(code).toContain("AGE_STORAGE_KEY");
    expect(code).not.toMatch(/["']greenway-age-confirmed-v1["']/);
  });

  it("treats a throwing localStorage as unconfirmed (Safari private browsing)", () => {
    // localStorage ACCESS throws there — it does not return null. Fail-closed.
    const snapshot = code.match(/function getAgeConfirmationSnapshot\(\)\s*\{([\s\S]*?)\n\}/);
    expect(snapshot, "getAgeConfirmationSnapshot must exist").toBeTruthy();
    expect(snapshot![1]).toMatch(/try\s*\{/);
    expect(snapshot![1]).toMatch(/catch/);
    expect(snapshot![1]).toMatch(/return\s+false/);
  });

  it("stamps the attribute on confirm so no flash occurs on client navigation", () => {
    // The pre-paint bootstrap only runs on a full document load. Without this,
    // a visitor who just confirmed could see the gate again on a soft nav.
    const confirm = code.match(/function confirmAge\(\)\s*\{([\s\S]*?)\n  \}/);
    expect(confirm, "confirmAge must exist").toBeTruthy();
    expect(confirm![1]).toContain("setAttribute");
    expect(confirm![1]).toContain(AGE_CONFIRMED_ATTRIBUTE);
  });

  it("survives storage being denied when confirming", () => {
    const confirm = code.match(/function confirmAge\(\)\s*\{([\s\S]*?)\n  \}/);
    expect(confirm![1]).toMatch(/try\s*\{/);
    expect(confirm![1]).toMatch(/catch/);
  });

  it("uses the shared exempt-path helper rather than a bare startsWith", () => {
    // A bare startsWith("/pos") also exempts "/posters", a customer page.
    expect(code).toContain("isAgeGateExemptPath");
    expect(code).not.toMatch(/pathname\?\.startsWith\(/);
  });

  it("still renders the compliance copy the state requires", () => {
    expect(AGE_GATE).toContain("21 years of age or older");
    expect(AGE_GATE).toContain("Age Verification");
    expect(AGE_GATE).toContain("Yes, I am 21+");
    expect(AGE_GATE).toContain("No, I am under 21");
  });

  it("keeps the dialog semantics that make it a real modal", () => {
    expect(code).toContain('role="dialog"');
    expect(code).toContain('aria-modal="true"');
    expect(code).toContain('aria-labelledby="age-gate-title"');
  });
});

describe("SLICE I — the pre-paint bootstrap must stay pre-paint", () => {
  const code = stripComments(LAYOUT);

  it("injects the bootstrap from the shared core", () => {
    expect(code).toContain("ageGateBootstrapScript");
  });

  it("places the bootstrap inside <head>", () => {
    // In <body> it would run after the gate markup has already been parsed and
    // possibly painted — which is precisely the flash we are preventing.
    const head = code.match(/<head>([\s\S]*?)<\/head>/);
    expect(head, "layout must render a <head>").toBeTruthy();
    expect(head![1]).toContain("ageGateBootstrapScript");
  });

  it("keeps the bootstrap SYNCHRONOUS", () => {
    // defer/async both push execution past first paint and reintroduce the flash.
    // [\s\S] rather than the `s` dotAll flag: the repo's tsconfig target
    // predates es2018, so `/s` is a compile error here.
    const tag = code.match(/<script[\s\S]{0,200}?ageGateBootstrapScript[\s\S]{0,80}?\/>/);
    expect(tag, "bootstrap script tag must be found").toBeTruthy();
    expect(tag![0]).not.toMatch(/\bdefer\b/);
    expect(tag![0]).not.toMatch(/\basync\b/);
    expect(tag![0]).not.toMatch(/next\/script/);
  });

  it("does not route the bootstrap through next/script", () => {
    // next/script's default strategy is afterInteractive — far too late.
    expect(code).not.toMatch(/from\s+["']next\/script["']/);
  });

  it("still mounts the age gate itself", () => {
    expect(code).toContain("<AgeGate />");
  });

  it("renders the bootstrap before the gate is mounted in the document order", () => {
    expect(code.indexOf("ageGateBootstrapScript")).toBeLessThan(code.indexOf("<AgeGate />"));
  });
});

describe("SLICE I — the CSS rule that prevents the flash", () => {
  it("hides the gate for confirmed visitors", () => {
    expect(GLOBALS).toMatch(
      new RegExp(
        `\\[${AGE_CONFIRMED_ATTRIBUTE}="true"\\]\\s+\\[${AGE_GATE_ELEMENT_ATTRIBUTE}\\]`,
      ),
    );
  });

  it("removes the gate from layout rather than merely hiding it visually", () => {
    // opacity/visibility would still paint, still be an LCP candidate, and
    // still trap focus.
    const rule = GLOBALS.match(
      new RegExp(
        `\\[${AGE_CONFIRMED_ATTRIBUTE}="true"\\]\\s+\\[${AGE_GATE_ELEMENT_ATTRIBUTE}\\]\\s*\\{([^}]*)\\}`,
      ),
    );
    expect(rule, "the hide rule must exist in globals.css").toBeTruthy();
    expect(rule![1]).toMatch(/display:\s*none/);
    expect(rule![1]).toContain("!important");
  });

  it("requires the POSITIVE confirmed value, so a bare attribute cannot open the gate", () => {
    expect(GLOBALS).not.toMatch(
      new RegExp(`\\[${AGE_CONFIRMED_ATTRIBUTE}\\]\\s+\\[${AGE_GATE_ELEMENT_ATTRIBUTE}\\]`),
    );
  });
});

describe("SLICE I — fail-closed posture is not negotiable", () => {
  const script = ageGateBootstrapScript();

  it("only ever ADDS the confirmed attribute", () => {
    expect(script).not.toContain("removeAttribute");
    expect(script.split("setAttribute").length - 1).toBe(1);
  });

  it("cannot throw out of the bootstrap", () => {
    expect(script).toMatch(/try\{/);
    expect(script).toMatch(/catch\(/);
  });

  it("reads the confirmation before stamping anything", () => {
    expect(script.indexOf("getItem")).toBeLessThan(script.indexOf("setAttribute"));
  });

  it("cannot terminate its own inline script element", () => {
    expect(script.toLowerCase()).not.toContain("</script");
  });

  it("uses the same storage key the component reads", () => {
    expect(script).toContain(AGE_STORAGE_KEY);
  });

  it("never gates staff surfaces", () => {
    for (const path of ["/admin", "/admin/reports", "/pos", "/pos/register/2"]) {
      expect(isAgeGateExemptPath(path)).toBe(true);
    }
  });

  it("gates every customer surface, including look-alike routes", () => {
    for (const path of ["/", "/menu", "/menu/flower", "/specials", "/posters", "/administrivia"]) {
      expect(isAgeGateExemptPath(path)).toBe(false);
    }
  });

  it("runs the pure self-tests in CI", () => {
    // If this registration is dropped, every invariant above stops being
    // enforced on push.
    expect(SELFTESTS).toContain("__runAgeGateTests");
    expect(SELFTESTS).toContain('assertNoFailures("age-gate-core", __runAgeGateTests())');
  });
});
