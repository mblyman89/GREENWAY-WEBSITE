/**
 * SLICE 16 — THE TRUTH SURFACES.
 *
 * Steps 1–8 made the register ENFORCE the 200 mg low-THC beverage cap. This
 * file pins the places that TELL people about it, because a system that
 * enforces one number while announcing another is worse than one that does
 * neither — it makes a liar out of the budtender.
 *
 * Four surfaces are covered:
 *   1. The customer-facing AI concierge knowledge base (src/lib/ai/kb/seed.ts)
 *   2. The Regulatory Watch analyst's surface map (compliance-surface.ts)
 *   3. The public /medical purchase-limit table (covered in
 *      public-surfaces-core.test.ts; the anti-tripling guard lives there)
 *   4. The repo's own written authority (docs/*.md)
 *
 * THE SPECIFIC TRAP THIS FILE EXISTS TO CATCH
 * -------------------------------------------
 * src/lib/ai/compliance-patterns.json contains a BLOCKING pattern for
 * `\d+\s*mg per` labelled "dosing advice". Writing the perfectly innocent and
 * factually correct phrase "4 mg per unit" into the KB would cause the
 * concierge's own compliance gate to refuse to surface the rule — silently.
 * The customer would then be told the 72 oz limit and nothing else.
 *
 * That failure is invisible without a test: the code compiles, the seed loads,
 * nothing throws. So we run the REAL gate over the REAL seed text here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SEED_COMPLIANCE_RULES } from "@/lib/ai/kb/seed";
import { checkCompliance } from "@/lib/ai/compliance";
import {
  COMPLIANCE_SURFACE,
  areasForCitations,
} from "@/lib/regulatory/compliance-surface";
import {
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";

const docText = (name: string) =>
  readFileSync(join(process.cwd(), "docs", name), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// 1. The AI concierge
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the AI concierge knows about the low-THC beverage limit", () => {
  const rule = SEED_COMPLIANCE_RULES.find((r) => r.slug === "low-thc-beverage-limit");

  it("a dedicated rule exists so a customer can just ask", () => {
    expect(rule).toBeDefined();
    expect(rule!.category).toBe("purchase-limit");
    expect(rule!.citation).toContain("314-55-095");
  });

  it("it states the 200 mg cap and the 4 mg per-unit qualifier, DERIVED from the enforced constants", () => {
    // Derived, not retyped. If someone edits RECREATIONAL_LIMITS the prose moves.
    expect(rule!.rule).toContain(String(RECREATIONAL_LIMITS.low_thc_liquid));
    expect(rule!.rule).toContain(String(LOW_THC_UNIT_MAX_MG));
  });

  it("it tells the customer the truth that medical does NOT triple this one", () => {
    expect(MEDICAL_LIMITS.low_thc_liquid).toBe(RECREATIONAL_LIMITS.low_thc_liquid);
    expect(rule!.rule).toContain(String(MEDICAL_LIMITS.low_thc_liquid));
    // The whole point of the sentence. A patient who assumes 3x walks out with
    // 600 mg in their head and an over-sale in their bag.
    expect(rule!.rule.toLowerCase()).toMatch(/does not increase|not increase with a card/);
  });

  it("it explains Michael's actual counter rule: one can = one unit, container not serving", () => {
    const note = rule!.house_note!.toLowerCase();
    expect(note).toContain("one can is one unit");
    expect(note).toContain("four-pack");
    // The 16 mg "4 x 4 mg servings" bottle case, in plain customer English.
    expect(note).toMatch(/serving/);
  });

  it("it states the fail-safe: an unclassified drink is treated as a normal liquid", () => {
    expect(rule!.house_note!.toLowerCase()).toMatch(/haven't classified|hasn't been classified/);
    expect(rule!.house_note!.toLowerCase()).toContain("regular liquid");
  });

  it("the general purchase-limit and possession rules both mention the carve-out", () => {
    const purchase = SEED_COMPLIANCE_RULES.find((r) => r.slug === "purchase-limits")!;
    const possession = SEED_COMPLIANCE_RULES.find((r) => r.slug === "possession-limits")!;
    // A customer who asks the broad question must not get an answer that is
    // silently incomplete for beverages.
    expect(purchase.rule).toContain(String(RECREATIONAL_LIMITS.low_thc_liquid));
    // RCW 69.50.4013(3)(a) incorporates RCW 69.50.360(3) by reference, and
    // 69.50.360(3)(d) IS this provision — so possession carries it too.
    expect(possession.rule).toContain(String(RECREATIONAL_LIMITS.low_thc_liquid));
  });

  it("rules stay ordered, with the beverage rule adjacent to the general limits", () => {
    const purchase = SEED_COMPLIANCE_RULES.find((r) => r.slug === "purchase-limits")!;
    const possession = SEED_COMPLIANCE_RULES.find((r) => r.slug === "possession-limits")!;
    expect(rule!.sort_order).toBeGreaterThan(purchase.sort_order);
    expect(rule!.sort_order).toBeLessThan(possession.sort_order);
  });

  it("slugs remain unique after the insertion", () => {
    const slugs = SEED_COMPLIANCE_RULES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. THE DOSING-GATE TRAP — the reason this file exists
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the new KB prose survives the I-502 compliance gate", () => {
  it("every seeded compliance rule passes checkCompliance with zero blocking flags", () => {
    for (const r of SEED_COMPLIANCE_RULES) {
      for (const [field, text] of [
        ["rule", r.rule],
        ["house_note", r.house_note],
      ] as const) {
        const res = checkCompliance(String(text ?? ""));
        expect(
          res.ok,
          `${r.slug}.${field} was BLOCKED by the compliance gate: ${res.blockingFlags.join(", ")}`,
        ).toBe(true);
      }
    }
  });

  it("the gate really does block the tempting phrasing — this is not a vacuous test", () => {
    // Proof the assertion above has teeth. "N mg per <thing>" is caught as
    // dosing advice, so the honest-but-naive sentence would have been silently
    // suppressed in front of a customer.
    const naive = `Each can contains ${LOW_THC_UNIT_MAX_MG} mg per unit of active delta-9 THC.`;
    const naiveRes = checkCompliance(naive);
    expect(naiveRes.ok).toBe(false);
    expect(naiveRes.blockingFlags.join(" ")).toContain("dosing");

    // And the phrasing we actually shipped conveys the same statutory fact
    // while staying clean.
    const shipped = `packaged in individual units of ${LOW_THC_UNIT_MAX_MG} mg of active delta-9 THC or less`;
    expect(checkCompliance(shipped).ok).toBe(true);
  });

  it("the shipped beverage rule specifically does not contain the blocked construction", () => {
    const rule = SEED_COMPLIANCE_RULES.find((r) => r.slug === "low-thc-beverage-limit")!;
    for (const text of [rule.rule, rule.house_note ?? ""]) {
      expect(text).not.toMatch(/\d+\s*mg per/i);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The Regulatory Watch analyst's map
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the regulatory analyst is told what we actually enforce", () => {
  const area = COMPLIANCE_SURFACE.find((a) => a.key === "sales-limits")!;

  it("the sales-limits area mentions the 200 mg beverage bucket", () => {
    expect(area.whatWeRun).toContain("200 mg");
    expect(area.whatWeRun).toContain("4 mg");
  });

  it("it warns the analyst about the two facts that cause wrong roadmaps", () => {
    // Without these, an analyst reading a future LCB bulletin would propose
    // "scale all limits 3x for medical" and "convert mg to oz for display".
    expect(area.whatWeRun).toMatch(/MILLIGRAMS OF THC|milligrams of THC/i);
    expect(area.whatWeRun).toMatch(/does NOT triple|not triple/i);
  });

  it("the intake screen is listed as a module, because that is where the flag is set", () => {
    expect(area.modules).toContain("/admin/menu-imports/[id]/facts");
  });

  it("WAC 314-55-095 still routes to this area", () => {
    expect(areasForCitations(["WAC 314-55-095"]).map((a) => a.key)).toContain("sales-limits");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The repo's own written authority
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 16 — the docs state the rule and its three traps", () => {
  it("COMPLIANCE_BIBLE carries the fifth bucket in the limits table", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/Low-THC infused liquid/i);
    expect(bible).toContain("200 mg");
  });

  it("COMPLIANCE_BIBLE records that the allowance is exclusive, not additive", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/Exclusive, not additive/i);
    expect(bible).toMatch(/unless/i);
  });

  it("COMPLIANCE_BIBLE records the per-container (not per-serving) rule", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/per CONTAINER, not per serving/i);
    expect(bible).toContain("16 mg");
  });

  it("COMPLIANCE_BIBLE records that medical does not triple", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/NOT tripled|does not triple/i);
    expect(bible).toContain("600 mg");
  });

  it("COMPLIANCE_BIBLE distinguishes the 100 mg GIFTING figure from the retail cap", () => {
    // RCW 69.50.4013(4)(a)(iv) says 100 mg. It is a non-commercial gifting
    // allowance between adults, NOT a retail transaction limit. Confusing the
    // two would halve the legal basket.
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toContain("69.50.4013(4)(a)(iv)");
    expect(bible).toMatch(/gifting/i);
  });

  it("COMPLIANCE_BIBLE cites the statute that makes possession follow", () => {
    expect(docText("COMPLIANCE_BIBLE.md")).toContain("69.50.4013(3)(a)");
  });

  it("PRODUCT_NAMING_CONVENTION explains why the NAME cannot carry this fact", () => {
    const naming = docText("PRODUCT_NAMING_CONVENTION.md");
    expect(naming).toContain("low_thc_liquid");
    expect(naming).toContain("unit_thc_mg");
    expect(naming).toContain("0216");
  });

  it("POS_FRONTEND_RESEARCH marks the rule implemented and states the fail-safe", () => {
    const pos = docText("POS_FRONTEND_RESEARCH.md");
    expect(pos).toMatch(/Implemented in SLICE 16/i);
    // Michael's explicit instruction: "A product with no flag should be
    // treated as a normal liquid."
    expect(pos).toMatch(/unflagged liquid is treated as a normal/i);
  });
});
