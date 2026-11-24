import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixedPxSizesCount, __runChromeImageTests } from "@/lib/site/chrome-image-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-8b: fixed-size footer images ship a 1x/2x srcSet, not 15 widths", () => {
  it("self-test passes", () => {
    expect(__runChromeImageTests().failed).toBe(0);
  });
  it.each(["src/components/site/Footer.tsx", "src/components/site/FooterLinkUnavailable.tsx"])(
    "%s has no fixed-px sizes prop and reads CHROME_IMAGE_PX",
    (file) => {
      const src = read(file);
      expect(fixedPxSizesCount(src)).toBe(0);
      expect(src).toContain("CHROME_IMAGE_PX");
    },
  );
});
