/**
 * SLICE 16 — FEATURE PARITY.
 *
 * Michael's instruction, verbatim:
 *
 *   "Please make sure you add the limit settings and whatever else the system
 *    already has built so it lives with the other limits and has all the same
 *    features the other limits have if any."
 *
 * The four original buckets did not just get enforced — over the previous
 * slices they accumulated a whole support structure: owner-editable settings
 * with clamping, a hard-block gate with a permission-gated override ledger, a
 * compliance-health posture, an evidence trail on the sale event, and a
 * customer-facing meter.
 *
 * It is easy to add a fifth bucket to the ENGINE and quietly leave it out of
 * half of that structure. The result would be a limit that blocks a sale but
 * cannot be adjusted by the owner, cannot be overridden by a manager, and
 * leaves no evidence — which in practice means someone turns enforcement off
 * entirely.
 *
 * So this file walks the feature list and asserts the new bucket is a
 * first-class citizen of each one, rather than trusting that it is.
 *
 * Where a mechanism is bucket-AGNOSTIC (the gate, the health read), the test
 * proves that agnosticism holds for an mg-denominated bucket specifically —
 * because "it iterates over all buckets" is only true until someone writes
 * `usedGrams` in a formatter.
 */
import { describe, it, expect } from "vitest";

import {
  LIMIT_BUCKETS,
  LIMIT_BUCKET_LABELS,
  LIMIT_BUCKET_UNITS,
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
  evaluateCart,
  formatLimitAmount,
  isThcBucket,
  type LimitBucket,
} from "@/lib/compliance/sales-limits-core";
import { DEFAULT_SALES_LIMIT_SETTINGS } from "@/lib/compliance/sales-limits";
import { decideSalesLimitGate } from "@/lib/compliance/sales-limit-gate-core";

const BUCKET: LimitBucket = "low_thc_liquid";

/** A basket of qualifying 4 mg cans. 51 cans = 204 mg = over the 200 mg cap. */
const cans = (quantity: number) => [
  { category: "edible-liquid", quantity, lowThcLiquid: true, unitThcMg: 4 } as never,
];

// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the new bucket is a first-class member of the bucket list", () => {
  it("appears in LIMIT_BUCKETS, so anything that iterates buckets includes it", () => {
    expect(LIMIT_BUCKETS).toContain(BUCKET);
  });

  it("has a human label, like every other bucket", () => {
    expect(LIMIT_BUCKET_LABELS[BUCKET]).toBeTruthy();
    // The label must carry the qualifier, otherwise the settings screen reads
    // "Low-THC beverages: 200" with no hint of what makes one qualify.
    expect(LIMIT_BUCKET_LABELS[BUCKET]).toContain(String(LOW_THC_UNIT_MAX_MG));
  });

  it("every bucket in the list has a unit, a label and both profile figures", () => {
    for (const b of LIMIT_BUCKETS) {
      expect(LIMIT_BUCKET_UNITS[b], b).toBeTruthy();
      expect(LIMIT_BUCKET_LABELS[b], b).toBeTruthy();
      expect(typeof RECREATIONAL_LIMITS[b], b).toBe("number");
      expect(typeof MEDICAL_LIMITS[b], b).toBe("number");
    }
  });

  it("no bucket is missing from the list (the list IS the contract)", () => {
    expect(LIMIT_BUCKETS.length).toBe(Object.keys(LIMIT_BUCKET_UNITS).length);
    expect(new Set(LIMIT_BUCKETS).size).toBe(LIMIT_BUCKETS.length);
  });
});

describe("SLICE 16 — owner settings cover the new limit like the other four", () => {
  it("ships in the default settings for BOTH profiles", () => {
    expect(DEFAULT_SALES_LIMIT_SETTINGS.rec[BUCKET]).toBe(RECREATIONAL_LIMITS[BUCKET]);
    expect(DEFAULT_SALES_LIMIT_SETTINGS.med[BUCKET]).toBe(MEDICAL_LIMITS[BUCKET]);
  });

  it("the medical default is NOT tripled, unlike the GRAM buckets", () => {
    // Guard rail against a well-meaning "consistency" fix.
    expect(DEFAULT_SALES_LIMIT_SETTINGS.med[BUCKET]).toBe(DEFAULT_SALES_LIMIT_SETTINGS.rec[BUCKET]);
    // SLICE 17 STRENGTHENED: rather than "every OTHER bucket triples" (which
    // silently became false when otherwise_taken arrived), pin the exact SET
    // on each side. Adding a seventh bucket now forces a deliberate decision
    // about which side it belongs on instead of quietly breaking a loop.
    const triples = LIMIT_BUCKETS.filter(
      (b) => DEFAULT_SALES_LIMIT_SETTINGS.med[b] > DEFAULT_SALES_LIMIT_SETTINGS.rec[b],
    );
    const flat = LIMIT_BUCKETS.filter(
      (b) => DEFAULT_SALES_LIMIT_SETTINGS.med[b] === DEFAULT_SALES_LIMIT_SETTINGS.rec[b],
    );
    expect([...triples].sort()).toEqual([
      "concentrate",
      "liquid_edible",
      "solid_edible",
      "usable",
    ]);
    // low_thc_liquid: WAC 314-55-095(2)(d) says "up to 200 mg" — same figure.
    // otherwise_taken: WAC 314-55-095(2)(d) does not list the category at all.
    expect([...flat].sort()).toEqual(["low_thc_liquid", "otherwise_taken"]);
    // And every tripling bucket triples EXACTLY, not merely "more".
    for (const b of triples) {
      expect(DEFAULT_SALES_LIMIT_SETTINGS.med[b] / DEFAULT_SALES_LIMIT_SETTINGS.rec[b], b).toBe(3);
    }
  });
});

describe("SLICE 16 — the hard-block gate treats it exactly like any other bucket", () => {
  const over = evaluateCart(cans(51), "recreational"); // 204 mg vs 200 mg

  it("an over-cap beverage basket is genuinely over-limit", () => {
    expect(over.blocked).toBe(true);
    expect(over.reasons.join(" ")).toContain("mg THC");
  });

  it("it HARD BLOCKS by default, same as flower going over", () => {
    const verdict = decideSalesLimitGate({
      blocked: over.blocked,
      enforce: true,
      hardBlock: true,
      reasons: over.reasons,
      override: null,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.decision).toBe("block");
  });

  it("a permitted manager override unblocks it, same as any other bucket", () => {
    const verdict = decideSalesLimitGate({
      blocked: over.blocked,
      enforce: true,
      hardBlock: true,
      reasons: over.reasons,
      override: { permitted: true, actorId: "mgr-1", reason: "Owner-approved, verified on invoice" },
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.overrideApplied).toBe(true);
  });

  it("the override path is OFFERED rather than being a dead end", () => {
    const verdict = decideSalesLimitGate({
      blocked: over.blocked,
      enforce: true,
      hardBlock: true,
      reasons: over.reasons,
      override: null,
    });
    expect(verdict.overrideAvailable).toBe(true);
  });

  it("the over-limit REASON survives into the gate for the audit ledger", () => {
    const verdict = decideSalesLimitGate({
      blocked: over.blocked,
      enforce: true,
      hardBlock: true,
      reasons: over.reasons,
      override: null,
    });
    // An override ledger entry that says only "over limit" is useless to an
    // inspector. The mg figures have to travel.
    expect(verdict.reasons.join(" ")).toContain("mg THC");
  });

  it("turning enforcement off releases it, same as the other buckets", () => {
    const verdict = decideSalesLimitGate({
      blocked: over.blocked,
      enforce: false,
      hardBlock: true,
      reasons: over.reasons,
      override: null,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe("SLICE 16 — usage reporting carries the mg unit through, not grams", () => {
  it("every bucket in the usage report states its own unit", () => {
    const usage = evaluateCart(cans(10), "recreational");
    for (const b of usage.buckets) {
      expect(b.unit, b.bucket).toBe(LIMIT_BUCKET_UNITS[b.bucket]);
      // The label must never contradict the unit \u2014 this is the "7.143 oz" trap.
      if (isThcBucket(b.bucket)) {
        expect(b.usedLabel, b.bucket).toContain("mg THC");
        expect(b.maxLabel, b.bucket).toContain("mg THC");
      } else {
        expect(b.usedLabel, b.bucket).not.toContain("mg THC");
      }
    }
  });

  it("40 cans of 4 mg reads as 160 mg used against a 200 mg max", () => {
    const usage = evaluateCart(cans(40), "recreational");
    const b = usage.buckets.find((x) => x.bucket === BUCKET)!;
    expect(b.used).toBe(160);
    expect(b.max).toBe(200);
    expect(b.usedLabel).toBe("160 mg THC");
    expect(b.maxLabel).toBe("200 mg THC");
  });

  it("formatLimitAmount never renders a THC bucket as a weight", () => {
    for (const b of LIMIT_BUCKETS) {
      const s = formatLimitAmount(b, RECREATIONAL_LIMITS[b]);
      if (isThcBucket(b)) {
        expect(s, b).toContain("mg THC");
        expect(s, b).not.toMatch(/\boz\b/);
      } else {
        expect(s, b).not.toContain("mg THC");
      }
    }
  });
});

describe("SLICE 16 — the practical can-count the owner asked to see", () => {
  it("200 mg at 4 mg per can is 50 cans, derived not retyped", () => {
    // Michael asked for BOTH presentations on the settings screen: the
    // statutory milligram figure AND the practical count a budtender can use.
    expect(Math.floor(RECREATIONAL_LIMITS[BUCKET] / LOW_THC_UNIT_MAX_MG)).toBe(50);
  });

  it("the 51st can is the one that breaks the cap", () => {
    expect(evaluateCart(cans(50), "recreational").blocked).toBe(false);
    expect(evaluateCart(cans(51), "recreational").blocked).toBe(true);
  });

  it("a medical patient gets the SAME 50 cans, not 150", () => {
    expect(evaluateCart(cans(50), "medical").blocked).toBe(false);
    expect(evaluateCart(cans(51), "medical").blocked).toBe(true);
  });
});
