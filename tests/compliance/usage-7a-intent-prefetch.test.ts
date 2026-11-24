/**
 * USAGE-7a · public links prefetch on intent, not on sight.
 *
 * Owner request (2026-11-24, verbatim in docs/USAGE-BLEED-ROADMAP.md §USAGE-7):
 * "please begin fixing all issues, one slice at a time."
 *
 * Pins:
 *   1. the pure core's own invariants (`__runIntentPrefetchTests`);
 *   2. EVERY public source file uses the IntentLink wrapper instead of
 *      importing `next/link` directly (walks the real tree, so a new public
 *      component cannot quietly bring viewport prefetch back);
 *   3. the wrapper wires all three intent events and lets an explicit
 *      `prefetch` prop win.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runIntentPrefetchTests,
  INTENT_EVENTS,
  PUBLIC_LINK_ROOTS,
  publicLinkViolation,
} from "@/lib/site/intent-prefetch-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(relDir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, relDir);
  for (const name of readdirSync(abs)) {
    const rel = `${relDir}${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(`${rel}/`, out);
    else out.push(rel);
  }
  return out;
}

describe("USAGE-7a · intent prefetch core", () => {
  it("the embedded self-test passes", () => {
    const r = __runIntentPrefetchTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(20);
  });
});

describe("USAGE-7a · no public file imports next/link directly", () => {
  const files = PUBLIC_LINK_ROOTS.flatMap((r) => walk(r));
  it("the walk actually finds the public tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("src/components/menu/ProductCardVisual.tsx");
    expect(files).toContain("src/components/site/NavLink.tsx");
  });
  it("every public file passes the guard", () => {
    const violations = files.map((f) => publicLinkViolation(f, read(f))).filter((v): v is string => v !== null);
    expect(violations).toEqual([]);
  });
  it("the product card and the mega-nav use the wrapper", () => {
    for (const f of ["src/components/menu/ProductCardVisual.tsx", "src/components/site/NavLink.tsx", "src/components/site/MobileNavigation.tsx", "src/components/site/Footer.tsx"]) {
      expect(read(f)).toContain('import Link from "@/components/site/IntentLink";');
    }
  });
});

describe("USAGE-7a · the wrapper", () => {
  const src = read("src/components/site/IntentLink.tsx");
  it("is a client component that wraps next/link", () => {
    expect(src.startsWith('"use client";')).toBe(true);
    expect(src).toContain('import NextLink from "next/link";');
  });
  it("routes the decision through the pure core", () => {
    expect(src).toContain("intentPrefetch(active)");
  });
  it("wires every intent event and still calls the caller's handler", () => {
    for (const ev of INTENT_EVENTS) {
      expect(src).toContain(`${ev}={(e) => {`);
      expect(src).toContain(`${ev}?.(e);`);
    }
  });
  it("an explicit prefetch prop from the caller wins", () => {
    expect(src).toContain("prefetch !== undefined ? prefetch : intentPrefetch(active)");
  });
});
