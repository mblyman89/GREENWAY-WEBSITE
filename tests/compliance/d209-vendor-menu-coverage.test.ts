/**
 * D209 — Vendor Menus coverage command center.
 * Vitest mirror of the pure self-tests plus structural locks on the store,
 * page, and CSV route (rule 18: named columns, Suspense, cache()).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  __runVendorMenuCoverageCoreTests,
  coverageHref,
  csvCell,
  menuFreshness,
  parseCoverageParams,
  rememberedTone,
} from "@/lib/purchasing/vendor-menu-coverage-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("vendor-menu-coverage-core (D209)", () => {
  it("passes its own pure self-tests", () => {
    const r = __runVendorMenuCoverageCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(90);
  });

  it("classifies freshness", () => {
    const now = Date.parse("2026-11-08T03:00:00Z");
    expect(menuFreshness("2026-11-07T00:00:00Z", now)).toBe("fresh");
    expect(menuFreshness("2026-10-20T00:00:00Z", now)).toBe("aging");
    expect(menuFreshness("2026-01-01T00:00:00Z", now)).toBe("stale");
    expect(menuFreshness(null, now)).toBe("unknown");
  });

  it("guards CSV cells against formula injection", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });

  it("round-trips URL params and omits defaults", () => {
    const p = parseCoverageParams({ sq: "acme", nsort: "stock" });
    expect(p.sq).toBe("acme");
    const href = coverageHref("/x", p, {});
    expect(href).toContain("sq=acme");
    expect(href).not.toContain("nsort=");
    expect(rememberedTone("weird")).toBe("neutral");
  });
});

describe("D209 structure", () => {
  const store = read("src/lib/purchasing/vendor-menu-coverage-store.ts");
  const page = read("src/app/admin/purchasing/menus/page.tsx");
  const route = read("src/app/admin/purchasing/menus/csv/route.ts");

  it("store is server-only, names its columns, and is cached", () => {
    expect(store).toContain('import "server-only"');
    expect(store).not.toMatch(/select\(\s*["'`]\*["'`]/);
    expect(store).toContain("cache(");
    expect(store).toMatch(/pagedAll|chunkedIn/);
  });

  it("page streams sections and uses the coverage loader", () => {
    expect(page).toContain("<Suspense");
    expect(page).toContain("loadVendorMenuCoverage");
    expect(page).toContain('id="needed"');
    expect(page).toContain('id="searched"');
  });

  it("CSV route requires permission and refuses incomplete reads", () => {
    expect(route).toContain('requirePermission("inventory.manage")');
    expect(route).toContain("409");
  });
});
