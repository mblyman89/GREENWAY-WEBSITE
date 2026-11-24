import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __runFooterGlyphTests } from "@/lib/site/footer-glyph-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-9e: footer glyphs do not resend the class + default message 14 times", () => {
  it("self-test passes", () => {
    expect(__runFooterGlyphTests().failed).toBe(0);
  });
  it("Footer passes no glyph className and only a non-default message", () => {
    const footer = read("src/components/site/Footer.tsx");
    expect(footer).not.toContain("GLYPH_CLASS =");
    expect(footer).not.toContain("className={GLYPH_CLASS}");
    expect(footer.match(/unavailableMessage=\{unavailableMessageProp\(unavailable\)\}/g)?.length).toBe(2);
  });
  it("the client component defaults to the same class and message", () => {
    const c = read("src/components/site/FooterLinkUnavailable.tsx");
    expect(c).toContain("className = FOOTER_GLYPH_CLASS");
    expect(c).toContain("resolvedUnavailableMessage(unavailableMessage)");
  });
});
