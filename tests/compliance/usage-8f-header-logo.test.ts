import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HEADER_LOGO_PX, maxRemWidthPx, __runHeaderLogoTests } from "@/lib/site/header-logo-core";

const src = readFileSync(resolve(__dirname, "../../src/components/site/Header.tsx"), "utf8");

describe("USAGE-8f: header logo ships a 1x/2x srcSet", () => {
  it("self-test passes", () => {
    expect(__runHeaderLogoTests().failed).toBe(0);
  });
  it("uses HEADER_LOGO_PX, not the asset size, and no sizes prop", () => {
    expect(src).toContain("width={HEADER_LOGO_PX.width}");
    expect(src).not.toContain("width={5891}");
    expect(src).not.toMatch(/\bsizes=/);
    expect(src).toMatch(/\bpriority\b/);
  });
  it("the declared width covers the widest CSS box", () => {
    const cls = /className=\{`(h-auto w-\[clamp[^`]+)`\}/.exec(src)?.[1] ?? "";
    expect(maxRemWidthPx(cls)).toBe(HEADER_LOGO_PX.width);
  });
});
