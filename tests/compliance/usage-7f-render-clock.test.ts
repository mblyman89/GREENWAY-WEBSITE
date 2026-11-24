/**
 * USAGE-7f · public renders read a bucketed (store-day) clock.
 *
 * Owner request (2026-11-24, verbatim in docs/USAGE-BLEED-ROADMAP.md §USAGE-7):
 * "please begin fixing all issues, one slice at a time."
 *
 * Pins: the core self-test (PST/PDT/DST edges, constant within a day), the
 * sitemap and the "New" tag overlay use it, and neither stamps the raw
 * render instant any more.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runRenderClockTests, pacificDayStartMs } from "@/lib/site/render-clock-core";
import { attachTags } from "@/lib/menu/product-tags-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("USAGE-7f core", () => {
  it("self-test passes", () => {
    const r = __runRenderClockTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(12);
  });
});

describe("USAGE-7f wiring", () => {
  it("sitemap stamps the store-day start, never new Date()", () => {
    const s = read("src/app/sitemap.ts");
    expect(s).toContain("const now = pacificDayStart();");
    expect(s).not.toMatch(/const now = new Date\(\)/);
    expect(s).not.toMatch(/lastModified:\s*new Date\(/);
  });
  it("the New-tag overlay reads the store-day start", () => {
    const s = read("src/lib/menu/product-tags-server.ts");
    expect(s).toContain("nowMs: pacificDayStartMs(Date.now())");
    expect(s).not.toContain("new Date().getTime()");
  });
});

describe("USAGE-7f behaviour: same data, same tags all day", () => {
  it("tags computed at 09:00 and 21:00 Pacific on the same day are identical", () => {
    const defs = [{ id: "d1", slug: "new", label: "New", color: "#00ff00", sortOrder: 0, autoRule: "new_window", windowDays: 14 }];
    const firstSeen = new Map([["p1", "2026-11-10T20:00:00Z"]]);
    const items = [{ id: "p1" }];
    const morning = pacificDayStartMs(Date.parse("2026-11-24T17:00:00Z"));
    const evening = pacificDayStartMs(Date.parse("2026-11-25T05:00:00Z"));
    expect(morning).toBe(evening);
    const inputs = (nowMs: number) =>
      ({ defs, manual: new Map(), firstSeen, nowMs }) as unknown as Parameters<typeof attachTags>[1];
    expect(JSON.stringify(attachTags(items, inputs(morning)))).toBe(JSON.stringify(attachTags(items, inputs(evening))));
  });
});
