import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D144 (owner, 2026-11-03: "The iPad top menu bar with the time and such,
 * collides with our apps top menu bar."). The native app hides the status
 * bar; as a second line of defence every full-screen register surface pads
 * itself by the iPad safe-area inset so nothing can sit under the clock.
 */
const root = path.resolve(__dirname, "..", "..");
const FILES = [
  "src/app/(site)/pos/RegisterShell.tsx",
  "src/app/(site)/pos/SaleFlow.tsx",
  "src/app/(site)/pos/RegisterLoyaltySignup.tsx",
];

describe("register safe-area padding", () => {
  for (const f of FILES) {
    it(`${f}: every fixed full-screen overlay pads for the top safe area`, () => {
      const src = readFileSync(path.join(root, f), "utf8");
      const lines = src.split("\n").filter((l) => /\bfixed inset-0\b/.test(l));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l, l.trim()).toContain("safe-area-inset-top");
    });
  }

  it("the navy register header pads for the top safe area", () => {
    const src = readFileSync(path.join(root, FILES[0]), "utf8");
    expect(src).toMatch(/pt-\[env\(safe-area-inset-top\)\]/);
  });

  it("the viewport lets the page extend under the notch so env() is non-zero", () => {
    const html = readFileSync(path.join(root, "register-app/index.html"), "utf8");
    expect(html).toContain("viewport-fit=cover");
  });
});
