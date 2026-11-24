/**
 * USAGE-7c · the (site) not-found boundary is lean.
 *
 * Owner request (2026-11-24, verbatim in docs/USAGE-BLEED-ROADMAP.md §USAGE-7):
 * "please begin fixing all issues, one slice at a time."
 *
 * Next.js embeds the segment's not-found boundary in the RSC payload of every
 * page under it; with the full Header + Footer that was ≈ 42 KB per page.
 * Pins: the core self-test, no chrome imports in the boundary, the WAC
 * warnings still render (R42), and every recovery link is a real route.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runNotFoundTests, NOT_FOUND_LINKS, notFoundImportViolations } from "@/lib/site/not-found-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("USAGE-7c core", () => {
  it("self-test passes", () => {
    const r = __runNotFoundTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });
});

describe("USAGE-7c boundary", () => {
  const src = read("src/app/(site)/not-found.tsx");
  it("does not import the full Header / Footer / mega-nav", () => {
    expect(notFoundImportViolations(src)).toEqual([]);
    expect(src).not.toContain("<Header");
    expect(src).not.toContain("<Footer");
  });
  it("still carries the WAC 314-55-155 warnings (R42) and a home link", () => {
    expect(src).toContain("<ComplianceWarningText");
    expect(src).toContain("NOT_FOUND_LINKS");
    expect(src).toContain('href="/"');
  });
  it("uses the intent-prefetch Link (USAGE-7a)", () => {
    expect(src).toContain('import Link from "@/components/site/IntentLink"');
  });
  it("every recovery link is a real (site) route", () => {
    for (const l of NOT_FOUND_LINKS) {
      const page = l.href === "/" ? "src/app/(site)/page.tsx" : `src/app/(site)${l.href}/page.tsx`;
      expect(existsSync(path.join(ROOT, page)), page).toBe(true);
    }
  });
});
