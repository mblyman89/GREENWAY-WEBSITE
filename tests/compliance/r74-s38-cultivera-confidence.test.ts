import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CULTIVERA_AUTO_ATTACH_MIN, __runCultiveraConfidenceCoreTests } from "@/lib/catalog/cultivera-confidence-core";

describe("R74 S38 Cultivera vendor confidence", () => {
  it("pure core passes (27)", () => {
    const r = __runCultiveraConfidenceCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(27);
    expect(CULTIVERA_AUTO_ATTACH_MIN).toBe(85);
  });
  it("server is Cultivera-gated and writes only through the existing doors", () => {
    const s = readFileSync("src/lib/catalog/cultivera-confidence-server.ts", "utf8");
    expect(s).toContain("loadRebuiltManifestIds");
    expect(s).toContain("attachProductFacts(");
    expect(s).toContain("approveDraftWithPrice(");
    expect(s).not.toMatch(/\.from\("[a-z_]+"\)\s*\.(insert|update|upsert|delete)/);
  });
});
