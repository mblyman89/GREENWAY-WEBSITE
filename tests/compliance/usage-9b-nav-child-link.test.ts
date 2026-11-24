import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inlineChildTreeCount, __runNavChildTests } from "@/lib/site/nav-child-core";
import { hasUseClientDirective } from "@/lib/site/client-loading-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-9b: dropdown category rows are client references", () => {
  it("self-test passes", () => {
    expect(__runNavChildTests().failed).toBe(0);
  });
  it("NavLink renders NavChildLink, not an inline tree", () => {
    const nav = read("src/components/site/NavLink.tsx");
    expect(inlineChildTreeCount(nav)).toBe(0);
    expect(nav).toContain("<NavChildLink");
  });
  it("NavChildLink is a client component with the same markup", () => {
    const row = read("src/components/site/NavChildLink.tsx");
    expect(hasUseClientDirective(row)).toBe(true);
    expect(inlineChildTreeCount(row)).toBe(1);
    expect(row).toContain('import Link from "@/components/site/IntentLink";');
  });
});
