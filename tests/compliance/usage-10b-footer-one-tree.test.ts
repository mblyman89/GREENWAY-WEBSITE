import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const footer = readFileSync("src/components/site/Footer.tsx", "utf8");
const count = (re: RegExp) => (footer.match(re) ?? []).length;

describe("USAGE-10b — footer renders one tree", () => {
  it("the shared rows render exactly once", () => {
    expect(count(/<HoursImage\b/g)).toBe(1);
    expect(count(/<AppDownload\b/g)).toBe(1);
    expect(count(/<FollowGreenway\b/g)).toBe(1);
    expect(count(/blockKey="business\.hours\.display"/g)).toBe(1);
  });
  it("no separate mobile/desktop footer components remain", () => {
    expect(footer).not.toMatch(/function (MobileFooter|DesktopFooter)/);
  });
  it("the mandated warning still shows at each breakpoint", () => {
    expect(count(/<ComplianceWarningText/g)).toBe(2);
  });
});
