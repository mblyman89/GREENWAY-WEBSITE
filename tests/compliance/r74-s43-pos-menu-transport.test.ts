import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runPosMenuTransportTests } from "@/lib/pos/pos-menu-transport-core";

describe("R74 S43 - register menu fits Vercel's response cap", () => {
  it("self-tests pass", () => {
    expect(__runPosMenuTransportTests()).toEqual({ passed: 11, failed: 0 });
  });
  it("menu route gzips and the register reports failed downloads", () => {
    const route = readFileSync("src/app/api/pos/menu/route.ts", "utf8");
    expect(route).toContain('"content-encoding": "gzip"');
    expect(route).toContain("export const maxDuration = 60;");
    const shell = readFileSync("src/app/(site)/pos/RegisterShell.tsx", "utf8");
    expect(shell).toContain("menuRefreshFailureMessage(res.status");
    expect(shell).toContain('d.endsWith("(no longer on the menu)")');
  });
});

// D264: Next >= 16.4.5 strips a route handler's own Content-Encoding (and
// 16.4.6 gzips again), so the self-gzipped register menu arrived unreadable
// and every iPad fell back to its old saved menu. Keep Next below 16.4.5
// until /api/pos/menu fits the cap without its own gzip.
describe("D264 - Next version cannot break the register menu download", () => {
  it("next stays below 16.4.5 while /api/pos/menu gzips its own body", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    const [maj, min, pat] = pkg.dependencies.next.replace(/^[^\d]*/, "").split(".").map(Number);
    const route = readFileSync("src/app/api/pos/menu/route.ts", "utf8");
    if (route.includes('"content-encoding": "gzip"')) {
      expect(maj * 1e6 + min * 1e3 + pat).toBeLessThan(16 * 1e6 + 4 * 1e3 + 5);
    }
  });
});
