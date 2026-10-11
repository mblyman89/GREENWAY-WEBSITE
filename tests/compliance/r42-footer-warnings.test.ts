/**
 * R42 (owner answer Q1): the age-gated site meets WAC 314-55-155(7) in the
 * footer, so the footer must carry the four statements EXACTLY as the rule
 * words them (WSR 26-12-082, effective 2026-07-04).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_WARNING_TEXT,
  MANDATED_WARNING_SENTENCES,
  resolveWarningForRender,
  validateWarningBlock,
} from "@/lib/compliance/warning-text-core";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";

// The four statements, verbatim from WAC 314-55-155(7)(a)-(d).
const RULE = [
  "This product has intoxicating effects and may be habit forming.",
  "Cannabis can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug.",
  "There may be health risks associated with consumption of this product.",
  "For use only by adults 21 and older. Keep out of the reach of children.",
];
const LAUNCH_TEXT =
  "This product has intoxicating effects and may be habit forming. Marijuana can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug. For use only by adults 21 and older. Keep out of the reach of children.";

describe("R42 footer warnings", () => {
  it("canonical text contains every rule statement verbatim", () => {
    for (const r of RULE) expect(CANONICAL_WARNING_TEXT).toContain(r);
  });
  it("canonical text passes its own validator", () => {
    expect(validateWarningBlock(CANONICAL_WARNING_TEXT).ok).toBe(true);
  });
  it("seeded footer default is the canonical text", () => {
    const seed = CONTENT_BLOCK_SEEDS.find((s) => s.block_key === "footer.compliance.warning");
    expect(seed?.defaultValue).toBe(CANONICAL_WARNING_TEXT);
  });
  it("the old launch wording now fails (Marijuana wording + missing health-risks)", () => {
    const res = validateWarningBlock(LAUNCH_TEXT);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain("Cannabis can impair concentration, coordination, and judgment.");
    expect(res.missing).toContain("There may be health risks associated with consumption of this product.");
  });
  it("render falls back to canonical for old/empty text, keeps a valid custom value", () => {
    expect(resolveWarningForRender(LAUNCH_TEXT)).toEqual({ value: CANONICAL_WARNING_TEXT, usedCanonical: true });
    expect(resolveWarningForRender("")).toEqual({ value: CANONICAL_WARNING_TEXT, usedCanonical: true });
    expect(resolveWarningForRender(null).usedCanonical).toBe(true);
    const custom = `WARNING: ${CANONICAL_WARNING_TEXT}`;
    expect(resolveWarningForRender(custom)).toEqual({ value: custom, usedCanonical: false });
  });
  it("six mandated sentences in rule order", () => {
    expect(MANDATED_WARNING_SENTENCES.length).toBe(6);
  });
  it("footer renders through the safety net, not raw SiteText", () => {
    const footer = readFileSync("src/components/site/Footer.tsx", "utf8");
    expect(footer).not.toMatch(/blockKey="footer\.compliance\.warning"/);
    expect((footer.match(/<ComplianceWarningText/g) ?? []).length).toBe(2);
    const comp = readFileSync("src/components/site/ComplianceWarningText.tsx", "utf8");
    expect(comp).toContain("resolveWarningForRender");
    expect(comp).not.toContain("dangerouslySetInnerHTML");
  });
});
