import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __runPackedRulesTests } from "@/lib/promotions/packed-rules-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-9a: storefront rules ship default-stripped, restored exactly on the client", () => {
  it("self-test passes (round-trip incl. seeds, weekday 0, discountPercent 0)", () => {
    expect(__runPackedRulesTests().failed).toBe(0);
  });
  it("the layout packs and the provider unpacks", () => {
    expect(read("src/app/(site)/layout.tsx")).toContain("packed={packRuleSnapshots(publishedRules)}");
    const provider = read("src/components/promotions/PublishedRulesProvider.tsx");
    expect(provider).toContain("unpackRuleSnapshots(packed)");
    expect(provider).toContain("seeds()");
  });
  it("money paths never read the packed payload", () => {
    for (const f of ["src/lib/pos/auto-discount.ts", "src/lib/promotions/promo-guard.ts"]) {
      expect(read(f)).not.toContain("packed-rules-core");
    }
  });
});
