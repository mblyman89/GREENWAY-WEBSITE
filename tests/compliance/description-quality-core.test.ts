/**
 * PR-D2 — vitest mirror for description-quality-core (the smart picker's brain:
 * name-echo / low-value detection). Runs the embedded pure self-tests plus a
 * few explicit expectations that pin the conservative "when in doubt, good"
 * behavior so we never discard genuinely useful prose.
 */
import { describe, it, expect } from "vitest";
import {
  classifyDescriptionQuality,
  isWeakDescription,
  normalizeForCompare,
  __runDescriptionQualityCoreTests,
} from "@/lib/purchasing/description-quality-core";

describe("description-quality-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runDescriptionQualityCoreTests()).not.toThrow();
  });

  it("keeps genuinely useful prose (good)", () => {
    expect(
      classifyDescriptionQuality("A smooth, uplifting hybrid with berry and citrus notes.", "Blue Dream").verdict,
    ).toBe("good");
  });

  it("detects a bare name echo", () => {
    expect(classifyDescriptionQuality("Blue Dream", "Blue Dream").verdict).toBe("name_echo");
    expect(classifyDescriptionQuality("Blue Dream 3.5g [Indica]", "Blue Dream").verdict).toBe("name_echo");
  });

  it("detects low-value / label-only text", () => {
    expect(classifyDescriptionQuality("3.5g", "Blue Dream").verdict).toBe("low_value");
    expect(classifyDescriptionQuality("Indica hybrid flower", "Blue Dream").verdict).toBe("low_value");
  });

  it("cannot name-echo without a name; only length/emptiness apply", () => {
    expect(classifyDescriptionQuality("Blue Dream", null).verdict).toBe("low_value");
    expect(classifyDescriptionQuality("A crisp, citrus-forward daytime strain.", null).verdict).toBe("good");
  });

  it("isWeakDescription mirrors non-good verdicts", () => {
    expect(isWeakDescription("Blue Dream", "Blue Dream")).toBe(true);
    expect(isWeakDescription("A smooth, uplifting hybrid with berry notes.", "Blue Dream")).toBe(false);
  });

  it("normalizeForCompare strips bracket tags, sizes, and punctuation", () => {
    expect(normalizeForCompare("Blue Dream [3.5g] [Indica]!")).toBe("blue dream");
    expect(normalizeForCompare("Blue Dream 3.5g Indica")).toBe("blue dream indica");
    expect(normalizeForCompare(null)).toBe("");
  });
});
