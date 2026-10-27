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
