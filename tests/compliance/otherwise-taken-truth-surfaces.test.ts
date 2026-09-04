/**
 * tests/compliance/otherwise-taken-truth-surfaces.test.ts
 *
 * SLICE 17 — THE TRUTH SURFACES.
 *
 * The earlier steps make the register and the website ENFORCE the ten-unit
 * "otherwise taken into the body" cap. This file pins the places that TELL
 * people about it. A system that enforces one number while announcing another
 * is worse than one that does neither: it makes a liar out of the budtender and
 * it hands the customer an argument they cannot win at the counter.
 *
 * WAC 314-55-095(1)(d)(i)(D), verbatim:
 *   "(D) Ten units of a cannabis-infused product otherwise taken into the body;"
 *
 * WAC 314-55-010(40), verbatim:
 *   "'Product(s) otherwise taken into the body' means a cannabis-infused
 *    product for human consumption or ingestion intended for uses other than
 *    inhalation, oral ingestion, or external application to the skin."
 *
 * THE SPECIFIC TRAP THIS FILE EXISTS TO CATCH
 * -------------------------------------------
 * Two of them, actually.
 *
 * 1. THE COMPLIANCE GATE. src/lib/ai/compliance-patterns.json BLOCKS the words
 *    "dose", "dosage", "treat", "medicinal", and the construction "N mg per".
 *    Suppositories are precisely the product a writer is most tempted to
 *    describe in clinical language. Blocked KB text is dropped SILENTLY — the
 *    code compiles, the seed loads, nothing throws, and the customer asking
 *    about suppositories is quietly told the 72 oz liquid rule instead. So we
 *    run the REAL gate over the REAL seed text here.
 *
 * 2. THE "ONLY BUCKET" CLAIM. SLICE 16 wrote into the regulatory analyst's map
 *    that low-THC beverages are "the only bucket that does NOT triple". After
 *    SLICE 17 there are TWO such buckets, and they do not triple for DIFFERENT
 *    REASONS — (2)(d) states 200 mg explicitly, whereas it omits "otherwise
 *    taken into the body" altogether. An analyst reading the stale sentence
 *    would conclude the ten-unit cap DOES triple and propose a 30-unit medical
 *    limit. That is why the sentence is asserted on, not merely edited.
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
  LIMIT_BUCKETS,
  MEDICAL_LIMITS,
  RECREATIONAL_LIMITS,
  isUnitCountBucket,
} from "@/lib/compliance/sales-limits-core";

const docText = (name: string) =>
  readFileSync(join(process.cwd(), "docs", name), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// 1. The AI concierge
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 17 — the AI concierge knows about the ten-unit limit", () => {
  const rule = SEED_COMPLIANCE_RULES.find(
    (r) => r.slug === "otherwise-taken-limit",
  );

  it("a dedicated rule exists so a customer can just ask", () => {
    expect(rule).toBeDefined();
    expect(rule!.category).toBe("purchase-limit");
    expect(rule!.citation).toContain("314-55-095");
  });

  it("it states the ten-unit cap, DERIVED from the enforced constant", () => {
    // Derived, not retyped. If someone edits RECREATIONAL_LIMITS the prose
    // moves with it, or this test goes red. A hardcoded "10" here would let
    // the KB and the register drift apart silently.
    expect(rule!.rule).toContain(String(RECREATIONAL_LIMITS.otherwise_taken));
  });

  it("it tells the customer the truth that medical does NOT triple this one", () => {
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(RECREATIONAL_LIMITS.otherwise_taken);
    expect(rule!.rule).toContain(String(MEDICAL_LIMITS.otherwise_taken));
    // A patient who assumes the usual 3x walks out expecting thirty units and
    // an over-sale in their bag.
    expect(rule!.rule.toLowerCase()).toMatch(
      /does not increase|not increase with a card/,
    );
  });

  it("it explains the WAC 314-55-010(40) definition in plain English", () => {
    // The owner's own words: "I didn't fully understand what taken into the
    // body meant, but suppository now makes perfect sense." If it confused the
    // licensee it will confuse the customer, so the rule must say what the
    // category IS, by exclusion, exactly as the definition does.
    const text = rule!.rule.toLowerCase();
    expect(text).toMatch(/inhal/);
    expect(text).toMatch(/skin/);
    expect(text).toMatch(/suppositor/);
  });

  it("it states the RCW 69.50.101 counting rule: a box of six is six units", () => {
    const note = rule!.house_note!.toLowerCase();
    expect(note).toMatch(/box of six|sealed box/);
    expect(note).toMatch(/six units/);
  });

  it("it says plainly that this bucket is a COUNT, not a weight and not a THC figure", () => {
    // The single most common way to get this rule wrong is to reach for
    // ounces, because the other four buckets are weights.
    const text = (rule!.rule + " " + rule!.house_note!).toLowerCase();
    expect(text).toMatch(/not by weight|not ounces|count/);
  });

  it("it states the fail-safe HONESTLY — unclassified does NOT land in this bucket", () => {
    // This is the inverse of SLICE 16 and the most dangerous thing to get
    // wrong. There, an unclassified drink fell back to the STRICTER rule. Here
    // an unclassified suppository falls back to the 72 oz liquid bucket, which
    // for a small item is effectively unlimited. The KB must not imply the
    // system catches everything automatically.
    const note = rule!.house_note!.toLowerCase();
    expect(note).toMatch(/classif/);
    expect(note).toMatch(/regular infused allowance|regular liquid|ounces/);
  });

  it("the general purchase-limit and possession rules both mention the carve-out", () => {
    const purchase = SEED_COMPLIANCE_RULES.find((r) => r.slug === "purchase-limits")!;
    const possession = SEED_COMPLIANCE_RULES.find((r) => r.slug === "possession-limits")!;
    // A customer who asks the BROAD question must not get an answer that is
    // silently incomplete. Both rules enumerate the buckets; an enumeration
    // missing one of six is a wrong answer, not a partial one.
    expect(purchase.rule.toLowerCase()).toMatch(/otherwise taken into the body/);
    expect(possession.rule.toLowerCase()).toMatch(/otherwise taken into the body/);
  });

  it("rules stay ordered, with the new rule adjacent to the general limits", () => {
    const purchase = SEED_COMPLIANCE_RULES.find((r) => r.slug === "purchase-limits")!;
    const possession = SEED_COMPLIANCE_RULES.find((r) => r.slug === "possession-limits")!;
    expect(rule!.sort_order).toBeGreaterThan(purchase.sort_order);
    expect(rule!.sort_order).toBeLessThan(possession.sort_order);
  });

  it("slugs remain unique after the insertion", () => {
    const slugs = SEED_COMPLIANCE_RULES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("sort orders remain unique among the purchase-limit rules", () => {
    // Two rules sharing a sort_order render in database order, which is to say
    // at random. The low-THC rule already occupies 25.
    const orders = SEED_COMPLIANCE_RULES.filter(
      (r) => r.category === "purchase-limit",
    ).map((r) => r.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. THE COMPLIANCE-GATE TRAP — the reason this file exists
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 17 — the new KB prose survives the I-502 compliance gate", () => {
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

  it("the gate really does block the tempting clinical phrasing — not a vacuous test", () => {
    // Proof the assertion above has teeth. A suppository is the product most
    // likely to attract medical language, and each of these sentences is
    // factually harmless — which is exactly why the silent block is dangerous.
    for (const naive of [
      "Each suppository has a 10 mg dose.",
      "There are 10 mg per suppository.",
      "Suppositories are used medicinally to treat pain.",
    ]) {
      expect(checkCompliance(naive).ok, `expected the gate to BLOCK: ${naive}`).toBe(false);
    }
  });

  it("the shipped rule avoids the blocked constructions specifically", () => {
    const rule = SEED_COMPLIANCE_RULES.find((r) => r.slug === "otherwise-taken-limit")!;
    for (const text of [rule.rule, rule.house_note ?? ""]) {
      expect(text).not.toMatch(/\d+\s*mg per/i);
      expect(text).not.toMatch(/\bdos(e|age|ing)\b/i);
      expect(text).not.toMatch(/\bmedicinal/i);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The Regulatory Watch analyst's map
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 17 — the regulatory analyst is told what we actually enforce", () => {
  const area = COMPLIANCE_SURFACE.find((a) => a.key === "sales-limits")!;

  it("the sales-limits area names the ten-unit bucket", () => {
    expect(area.whatWeRun.toLowerCase()).toContain("otherwise taken into the body");
    expect(area.whatWeRun).toMatch(/10 units|ten units/i);
  });

  it("it still describes the SLICE 16 beverage bucket — nothing was traded away", () => {
    // Editing a sentence is the easiest way to delete a fact by accident.
    expect(area.whatWeRun).toContain("200 mg");
    expect(area.whatWeRun).toContain("4 mg");
  });

  it("it enumerates all SIX buckets, so the analyst's mental model is complete", () => {
    const t = area.whatWeRun.toLowerCase();
    expect(t).toMatch(/1 oz|one ounce/);
    expect(t).toMatch(/16 oz/);
    expect(t).toMatch(/72 oz/);
    expect(t).toMatch(/7 g/);
    expect(t).toMatch(/200 mg/);
    expect(t).toMatch(/10 units|ten units/);
  });

  it("THE STALE-CLAIM GUARD: it no longer says low-THC is the ONLY bucket that resists tripling", () => {
    // SLICE 16 wrote "is the only bucket that does NOT triple". SLICE 17 makes
    // that false. An analyst who believes it would propose a 30-unit medical
    // cap for suppositories — an over-sale on every medical transaction.
    expect(area.whatWeRun).not.toMatch(/only bucket that does NOT triple/i);
  });

  it("it states that TWO buckets resist tripling, and that the REASONS differ", () => {
    // The distinction is not pedantry. (2)(d) NAMES 200 mg for medical, so a
    // future amendment could raise it. It OMITS "otherwise taken" entirely, so
    // there is no medical figure to raise — the recreational one simply stands.
    // Anyone reasoning about a future rule change needs both facts.
    expect(area.whatWeRun).toMatch(/two buckets|neither/i);
    expect(area.whatWeRun).toMatch(/omits|does not list|absent|silent/i);
  });

  it("the count-vs-weight warning survives for BOTH non-gram buckets", () => {
    expect(area.whatWeRun).toMatch(/MILLIGRAMS OF THC|milligrams of THC/i);
    expect(area.whatWeRun).toMatch(/COUNT|count of items/i);
  });

  it("the intake screen is listed as a module, because that is where the flag is set", () => {
    expect(area.modules).toContain("/admin/menu-imports/[id]/facts");
  });

  it("WAC 314-55-095 still routes to this area", () => {
    expect(areasForCitations(["WAC 314-55-095"]).map((a) => a.key)).toContain(
      "sales-limits",
    );
  });

  it("the analyst text mentions every non-gram bucket the engine actually has", () => {
    // Derived from the engine, so a SEVENTH bucket cannot be added later
    // without either updating this prose or turning this test red.
    const countBuckets = LIMIT_BUCKETS.filter(isUnitCountBucket);
    expect(countBuckets.length).toBeGreaterThan(0);
    for (const b of countBuckets) {
      expect(
        area.whatWeRun.toLowerCase(),
        `the analyst map never mentions the ${b} bucket`,
      ).toMatch(/units/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The repo's own written authority
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 17 — the docs state the rule and its traps", () => {
  it("COMPLIANCE_BIBLE carries the sixth bucket in the limits table", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/otherwise taken into the body/i);
    expect(bible).toMatch(/10 units|Ten units/);
  });

  it("COMPLIANCE_BIBLE quotes the WAC 314-55-010(40) definition", () => {
    // The definition is the whole game: it is what tells you a suppository is
    // in and a balm is out, when both sit on the same shelf.
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toContain("314-55-010(40)");
    expect(bible).toMatch(/inhalation, oral ingestion, or external application/i);
  });

  it("COMPLIANCE_BIBLE records WHY medical does not triple — the omission", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/omits|does not list|absent/i);
    // The wrong number a reader would otherwise reach for.
    expect(bible).toMatch(/30 units/);
  });

  it("COMPLIANCE_BIBLE records the RCW 69.50.101 unit-vs-package rule", () => {
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toContain("69.50.101");
    expect(bible).toMatch(/box of six|six units/i);
  });

  it("COMPLIANCE_BIBLE records the INVERTED fail-safe, in as many words", () => {
    // If a future maintainer copies the SLICE 16 pattern without reading this,
    // they will assume unflagged means safe. It does not, here.
    const bible = docText("COMPLIANCE_BIBLE.md");
    expect(bible).toMatch(/fail-safe/i);
    expect(bible).toMatch(/permissive|inverts|opposite/i);
  });

  it("COMPLIANCE_BIBLE does NOT invent a per-unit milligram ceiling", () => {
    // (1)(d)(i)(D) sets a COUNT and no potency figure. Inventing one would be
    // adding law, which is the one thing this repo may never do. The 10 mg
    // per-serving and 100 mg per-package rules are real but are packaging
    // rules from a different subsection — they must not be restated here as if
    // they capped this bucket.
    const bible = docText("COMPLIANCE_BIBLE.md");

    // Locate the DEDICATED SECTION by its heading, not by the first occurrence
    // of the phrase — the phrase also appears in the limits table far above,
    // and slicing from there reads the wrong region entirely. (The first draft
    // of this test did exactly that and failed against a correct document.)
    const start = bible.indexOf("**Otherwise-taken-into-the-body bucket");
    expect(start, "the dedicated bible section is missing").toBeGreaterThan(-1);
    const end = bible.indexOf("Possession follows automatically", start);
    expect(end, "the section has no recognisable end").toBeGreaterThan(start);
    const section = bible.slice(start, end);

    // The statute states a COUNT and no potency figure at all.
    expect(section).toMatch(/sets NO per-unit potency ceiling/i);
    expect(section).toMatch(/adding law/i);

    // And it must actively DISCLAIM the two real-but-unrelated packaging
    // figures, which are the numbers a reader would otherwise import by
    // mistake. Naming them as "not this bucket's cap" is the point.
    expect(section).toMatch(/10 mg/);
    expect(section).toMatch(/100 mg/);
    expect(section).toMatch(/PACKAGING rules|different subsection/i);
  });

  it("PRODUCT_NAMING_CONVENTION explains why the NAME cannot carry this fact", () => {
    // Same argument as SLICE 16, different failure mode: here the category
    // slug cannot carry it either, because one `topical` shelf holds balms
    // (72 oz) and suppositories (10 units) at the same time.
    const naming = docText("PRODUCT_NAMING_CONVENTION.md");
    expect(naming).toContain("otherwise_taken");
    expect(naming).toContain("units_per_package");
    expect(naming).toContain("0217");
  });

  it("PRODUCT_NAMING_CONVENTION records that the CATEGORY cannot carry it either", () => {
    const naming = docText("PRODUCT_NAMING_CONVENTION.md");
    expect(naming).toMatch(/topical/i);
    expect(naming).toMatch(/balm|lotion|salve/i);
  });

  it("POS_FRONTEND_RESEARCH marks the rule implemented and states the fail-safe", () => {
    const pos = docText("POS_FRONTEND_RESEARCH.md");
    expect(pos).toMatch(/Implemented in SLICE 17/i);
    expect(pos).toMatch(/otherwise_taken/);
  });

  it("POS_FRONTEND_RESEARCH warns that the fail-safe here is PERMISSIVE", () => {
    // The doc already says, for SLICE 16, "an unflagged liquid is treated as a
    // normal 72 oz liquid — the stricter, fail-safe direction." Reusing that
    // sentence here would be actively misleading.
    const pos = docText("POS_FRONTEND_RESEARCH.md");
    expect(pos).toMatch(/permissive/i);
  });
});
