/**
 * tests/compliance/classification-memory.test.ts  (SLICE 18F)
 *
 * ═══ WHAT THIS FILE IS DEFENDING ═══
 *
 * SLICE 18-0 made the `otherwise_taken` question REQUIRED at Product
 * Onboarding, because its failure direction is the dangerous one: an
 * unclassified suppository is silently treated as an ordinary topical and the
 * ten-unit limit of WAC 314-55-095(1)(d)(i)(D) never engages.
 *
 * A required question with NO MEMORY is a question answered under time
 * pressure at a receiving dock, every single week, for the same product. This
 * slice gives the gate a memory.
 *
 * ═══ THE MEASURED DEFECT (docs/slice-18f-recon.md §4b) ═══
 *
 * `intake-parser.ts:414` is, verbatim:
 *
 *     pos_product_key: sku ?? lot_code,
 *
 * When a WCIA/CCRS manifest line carries no SKU, the product key BECOMES THE
 * LOT CODE -- and a lot code is unique to one physical delivery. So for that
 * population every delivery presents a brand-new key, `planDraftSeeding()`
 * cannot match it against the published menu, a fresh draft is seeded, and the
 * gate fires again on a product that was already classified. The prior answer
 * is unreachable because it is filed under a key that will never recur.
 *
 * That is why the memory CANNOT key on `pos_product_key` alone: for the
 * affected population, that key is precisely the thing that changes.
 *
 * ═══ THE OWNER'S DECISION (verbatim) ═══
 *
 *   "Let's go with option b, pre fill + remembered provenance."
 *
 * Option B = the answer is PRE-FILLED but the human still confirms, and the
 * result is recorded under a THIRD provenance value (`remembered`) so an
 * auditor can always tell "confirmed from memory" from "freshly asserted".
 * Recording a remembered answer as plain `human` would be a small lie in a
 * compliance audit trail; recording it as `machine_default` would be a
 * different lie. Neither is acceptable, hence the third value.
 *
 * ═══ TESTING DOCTRINE ═══
 *
 * Text matching proves a word exists, never that a value is right. Everything
 * here is proven BEHAVIOURALLY: we call the function and assert on returned
 * values. The two source-reading tests at the end are explicitly guarding a
 * CLASS OF BUG (a future edit re-introducing an unstable key or a silent
 * auto-apply), and they say so.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  CLASSIFICATION_MEMORY_PROVENANCE,
  classificationMemoryKey,
  recallClassification,
  prefillFromMemory,
  describeMemory,
  type PriorClassification,
} from "@/lib/inventory/classification-memory-core";

import { RECEIVING_CLASSIFICATION_PROVENANCE } from "@/lib/inventory/receiving-classification-core";

// ---------------------------------------------------------------------------
// Fixtures. Deliberately NOT all-defaults: a fixture whose every field is the
// value under test proves nothing.
// ---------------------------------------------------------------------------

function prior(over: Partial<PriorClassification> = {}): PriorClassification {
  return {
    vendorName: over.vendorName !== undefined ? over.vendorName : "Fairwinds",
    brandName: over.brandName !== undefined ? over.brandName : "Fairwinds",
    productName: over.productName !== undefined ? over.productName : "Releaf Suppository 100mg",
    category: over.category !== undefined ? over.category : "topical",
    otherwiseTaken: over.otherwiseTaken !== undefined ? over.otherwiseTaken : true,
    unitsPerPackage: over.unitsPerPackage !== undefined ? over.unitsPerPackage : 6,
    lowThcLiquid: over.lowThcLiquid !== undefined ? over.lowThcLiquid : null,
    unitThcMg: over.unitThcMg !== undefined ? over.unitThcMg : null,
    decidedAt: over.decidedAt !== undefined ? over.decidedAt : "2026-08-12T17:04:00.000Z",
    decidedBy: over.decidedBy !== undefined ? over.decidedBy : "michael",
    provenance: over.provenance !== undefined ? over.provenance : "human",
  };
}

// ===========================================================================
describe("SLICE 18F: the memory key survives a new lot code", () => {
  it("gives the SAME key to the same product received under two different lot codes", () => {
    // This is the measured defect. Same product, same vendor, two deliveries.
    const august = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository 100mg",
      category: "topical",
    });
    const september = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository 100mg",
      category: "topical",
    });
    expect(august).toBe(september);
    expect(august).not.toBe("");
  });

  it("ignores pack-size noise, so a 6-pack and a 12-pack of the same product agree", () => {
    const six = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository 6pk",
      category: "topical",
    });
    const twelve = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository 12pk",
      category: "topical",
    });
    expect(six).toBe(twelve);
  });

  it("does NOT merge two different products from the same vendor", () => {
    const supp = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository",
      category: "topical",
    });
    const lotion = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Flow Cream Lotion",
      category: "topical",
    });
    expect(supp).not.toBe(lotion);
  });

  it("does NOT merge the same product name from two different vendors", () => {
    // Two producers can ship a product with the same name and DIFFERENT
    // formulations. Merging them would apply one vendor's answer to another
    // vendor's product -- inventing a fact.
    const a = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository",
      category: "topical",
    });
    const b = classificationMemoryKey({
      vendorName: "Green Revolution",
      brandName: "Green Revolution",
      productName: "Releaf Suppository",
      category: "topical",
    });
    expect(a).not.toBe(b);
  });

  it("refuses to build a key from nothing (no name = no memory)", () => {
    // A blank key would collide with every other blank key and hand one
    // product's classification to an unrelated one.
    expect(
      classificationMemoryKey({
        vendorName: "",
        brandName: "",
        productName: "",
        category: "",
      }),
    ).toBe("");
    expect(
      classificationMemoryKey({
        vendorName: null,
        brandName: null,
        productName: null,
        category: null,
      }),
    ).toBe("");
  });

  it("refuses a name that LOOKS present but collapses to nothing", () => {
    // MUTATION-TESTING NOTE (18F). classificationMemoryKey() has TWO refusals,
    // and the test above only exercised the first (`name === ""`). A name of
    // "---" passes that check and is only stopped by the SECOND guard
    // (`familyPart === ""`), so a mutant defeating the second guard survived.
    //
    // This matters in the real world: manifest name fields arrive with
    // placeholder junk. If such a row produced a key, it would be a key shared
    // by every other junk-named product from that vendor and category -- and
    // one product's compliance answer would be handed to an unrelated one.
    // Verified by execution, not assumption: "---" and " -- .. " both reach
    // the second guard, while "6pk" and "100" legitimately do not.
    for (const junk of ["---", " -- .. ", "  ", "..."]) {
      expect(
        classificationMemoryKey({
          vendorName: "Fairwinds",
          brandName: "Fairwinds",
          productName: junk,
          category: "topical",
        }),
        `a product named ${JSON.stringify(junk)} has no identity; building a ` +
          `key from it would let unrelated products share one memory.`,
      ).toBe("");
    }
  });

  it("a junk-named product is never handed another product's answer", () => {
    // The behavioural consequence of the guard above, stated end to end.
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "---",
        category: "topical",
      },
      history: [prior()],
    });
    expect(hit).toBeNull();
  });

  it("is case- and whitespace-insensitive (dock typing is not tidy)", () => {
    const tidy = classificationMemoryKey({
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository",
      category: "topical",
    });
    const messy = classificationMemoryKey({
      vendorName: "  FAIRWINDS ",
      brandName: "fairwinds",
      productName: "  releaf   SUPPOSITORY  ",
      category: " Topical ",
    });
    expect(messy).toBe(tidy);
  });
});

// ===========================================================================
describe("SLICE 18F: recall returns a SUGGESTION, never a silent value", () => {
  it("finds the newest prior answer for a matching product", () => {
    const older = prior({ decidedAt: "2026-06-01T00:00:00.000Z", unitsPerPackage: 4 });
    const newer = prior({ decidedAt: "2026-08-12T00:00:00.000Z", unitsPerPackage: 6 });
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Releaf Suppository 100mg",
        category: "topical",
      },
      // Deliberately oldest-first so a naive "take the first" implementation fails.
      history: [older, newer],
    });
    expect(hit).not.toBeNull();
    expect(hit?.unitsPerPackage).toBe(6);
    expect(hit?.decidedAt).toBe("2026-08-12T00:00:00.000Z");
  });

  it("is order-independent: newest wins regardless of input order", () => {
    const older = prior({ decidedAt: "2026-06-01T00:00:00.000Z", unitsPerPackage: 4 });
    const newer = prior({ decidedAt: "2026-08-12T00:00:00.000Z", unitsPerPackage: 6 });
    const candidate = {
      vendorName: "Fairwinds",
      brandName: "Fairwinds",
      productName: "Releaf Suppository 100mg",
      category: "topical",
    };
    const a = recallClassification({ candidate, history: [older, newer] });
    const b = recallClassification({ candidate, history: [newer, older] });
    expect(a?.unitsPerPackage).toBe(6);
    expect(b?.unitsPerPackage).toBe(6);
  });

  it("returns null when nothing matches -- it never invents a memory", () => {
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Something Never Seen Before",
        category: "topical",
      },
      history: [prior()],
    });
    expect(hit).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(
      recallClassification({
        candidate: {
          vendorName: "Fairwinds",
          brandName: "Fairwinds",
          productName: "Releaf Suppository",
          category: "topical",
        },
        history: [],
      }),
    ).toBeNull();
  });

  it("REMEMBERS A LITERAL FALSE -- 'a person said no' is a real answer", () => {
    // The load-bearing null/false distinction. `false` means a human
    // considered the question and said no. If recall used `||` anywhere, this
    // false would evaporate and the product would be re-asked forever.
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Flow Cream Lotion",
        category: "topical",
      },
      history: [
        prior({
          productName: "Flow Cream Lotion",
          otherwiseTaken: false,
          unitsPerPackage: null,
        }),
      ],
    });
    expect(hit).not.toBeNull();
    expect(hit?.otherwiseTaken).toBe(false);
    expect(hit?.otherwiseTaken).not.toBeNull();
  });

  it("never recalls an answer nobody made (machine_default is not a memory)", () => {
    // A machine default is the gate NOT having been asked. Replaying it as a
    // remembered human answer would launder a non-answer into an answer.
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Blue Dream Flower",
        category: "flower",
      },
      history: [
        prior({
          productName: "Blue Dream Flower",
          category: "flower",
          otherwiseTaken: false,
          provenance: RECEIVING_CLASSIFICATION_PROVENANCE.machine,
        }),
      ],
    });
    expect(hit).toBeNull();
  });

  it("does recall a previously REMEMBERED answer (memory is not single-use)", () => {
    // Week 3 must be able to remember week 2's confirmation, which was itself
    // remembered from week 1. Otherwise the memory dies after one cycle.
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Releaf Suppository 100mg",
        category: "topical",
      },
      history: [prior({ provenance: CLASSIFICATION_MEMORY_PROVENANCE.remembered })],
    });
    expect(hit).not.toBeNull();
    expect(hit?.otherwiseTaken).toBe(true);
  });

  it("ignores an 'unanswered' prior -- silence is not a memory", () => {
    // MUTATION-TESTING NOTE (18F). This test originally passed `otherwiseTaken:
    // null` alongside the `unanswered` provenance, which is the realistic row
    // shape but made the test USELESS as a guard: isRecallable() rejects it at
    // the value check and never reaches the provenance gate. A mutant that
    // added `unanswered` to RECALLABLE_PROVENANCE therefore SURVIVED.
    //
    // The row below is deliberately CONTRADICTORY -- provenance says nobody
    // answered, yet a value is present -- precisely so the ONLY thing that can
    // reject it is the provenance gate. Defence in depth is the point: if a
    // stale value is ever written next to an `unanswered` provenance, it must
    // still never be replayed to an operator as though a person had decided it.
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Releaf Suppository 100mg",
        category: "topical",
      },
      history: [
        prior({
          otherwiseTaken: true,
          unitsPerPackage: 6,
          provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
        }),
      ],
    });
    expect(
      hit,
      "an 'unanswered' provenance must never be recalled even when a value " +
        "sits beside it; replaying it would present a machine's silence to " +
        "the operator as a human decision.",
    ).toBeNull();
  });

  it("ignores an 'unanswered' prior even when it is the NEWEST row", () => {
    // Recency must not be able to promote a non-answer over a real one.
    const hit = recallClassification({
      candidate: {
        vendorName: "Fairwinds",
        brandName: "Fairwinds",
        productName: "Releaf Suppository 100mg",
        category: "topical",
      },
      history: [
        prior({
          otherwiseTaken: true,
          decidedAt: "2026-01-01T00:00:00.000Z",
          provenance: RECEIVING_CLASSIFICATION_PROVENANCE.human,
        }),
        prior({
          otherwiseTaken: false,
          decidedAt: "2026-09-01T00:00:00.000Z",
          provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
        }),
      ],
    });
    expect(hit).not.toBeNull();
    // The older HUMAN answer wins over the newer non-answer.
    expect(hit?.otherwiseTaken).toBe(true);
  });
});

// ===========================================================================
describe("SLICE 18F: OPTION B -- pre-fill, and label it honestly", () => {
  it("pre-fills the picker with the remembered answer", () => {
    const fill = prefillFromMemory(prior());
    expect(fill.otherwiseTaken).toBe("yes");
    expect(fill.unitsPerPackage).toBe("6");
  });

  it("pre-fills a remembered NO as 'no', not as blank", () => {
    // Blank would re-open a question that was already answered -- the whole
    // defect. And `false` must not be coalesced into absence.
    const fill = prefillFromMemory(prior({ otherwiseTaken: false, unitsPerPackage: null }));
    expect(fill.otherwiseTaken).toBe("no");
    expect(fill.unitsPerPackage).toBe("");
  });

  it("STILL REQUIRES THE HUMAN TO CONFIRM (Option B, not Option C)", () => {
    // The pre-fill saves typing, NOT the decision. If this ever returns false
    // the fail-permissive gate has been quietly weakened.
    const fill = prefillFromMemory(prior());
    expect(fill.stillRequiresConfirmation).toBe(true);
  });

  it("marks the pre-fill as remembered so the UI can label it", () => {
    const fill = prefillFromMemory(prior());
    expect(fill.isRemembered).toBe(true);
  });

  it("an empty memory pre-fills NOTHING and claims nothing", () => {
    const fill = prefillFromMemory(null);
    expect(fill.otherwiseTaken).toBe("");
    expect(fill.unitsPerPackage).toBe("");
    expect(fill.isRemembered).toBe(false);
    expect(fill.stillRequiresConfirmation).toBe(true);
  });

  it("describes the memory with WHO and WHEN, not just 'remembered'", () => {
    // An operator asked to confirm an answer deserves to know whose answer it
    // is and how old it is. "Remembered" alone is an appeal to authority.
    const text = describeMemory(prior());
    expect(text).toContain("michael");
    expect(text).toContain("2026-08-12");
    expect(text.length).toBeGreaterThan(20);
  });

  it("describes a remembered NO as a no (never mislabels the direction)", () => {
    const text = describeMemory(prior({ otherwiseTaken: false }));
    expect(text.toLowerCase()).toContain("no");
    expect(text.toLowerCase()).not.toContain("suppository (10-unit");
  });

  it("says nothing at all when there is no memory", () => {
    expect(describeMemory(null)).toBe("");
  });
});

// ===========================================================================
describe("SLICE 18F: the `remembered` provenance is a THIRD value, not a relabel", () => {
  it("exposes a distinct `remembered` value", () => {
    expect(CLASSIFICATION_MEMORY_PROVENANCE.remembered).toBe("remembered");
  });

  it("is NOT equal to human and NOT equal to machine_default", () => {
    // The entire audit value of Option B rests on this inequality.
    expect(CLASSIFICATION_MEMORY_PROVENANCE.remembered).not.toBe(
      RECEIVING_CLASSIFICATION_PROVENANCE.human,
    );
    expect(CLASSIFICATION_MEMORY_PROVENANCE.remembered).not.toBe(
      RECEIVING_CLASSIFICATION_PROVENANCE.machine,
    );
    expect(CLASSIFICATION_MEMORY_PROVENANCE.remembered).not.toBe(
      RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
    );
  });

  it("does not disturb the three values 18-0 already ratified", () => {
    // 0218's column comment enumerates this vocabulary. Renaming an existing
    // value would silently reinterpret every row already written.
    expect(RECEIVING_CLASSIFICATION_PROVENANCE.human).toBe("human");
    expect(RECEIVING_CLASSIFICATION_PROVENANCE.machine).toBe("machine_default");
    expect(RECEIVING_CLASSIFICATION_PROVENANCE.unanswered).toBe("unanswered");
  });
});

// ===========================================================================
// CLASS-OF-BUG GUARDS. These read source deliberately -- they are guarding
// against a FUTURE edit, which no behavioural test on today's code can do.
// ===========================================================================
describe("SLICE 18F: guards against a future edit re-breaking this", () => {
  it("the memory core never coalesces a classification with || (false would die)", () => {
    const src = readFileSync("src/lib/inventory/classification-memory-core.ts", "utf8");
    const executable = src
      .split("\n")
      .filter((ln) => !ln.trim().startsWith("*") && !ln.trim().startsWith("//"))
      .join("\n");
    for (const field of ["otherwiseTaken", "lowThcLiquid"]) {
      expect(
        executable.includes(`${field} ||`),
        `${field} must never be coalesced with || -- a human's literal false ` +
          `would collapse into "unanswered" and the product would be re-asked ` +
          `forever. Use ?? instead.`,
      ).toBe(false);
    }
  });

  it("the memory core is PURE: no database, no network, no fs", () => {
    // A pre-fill that quietly queries at render time would make the receiving
    // dock's approval card depend on network health.
    const src = readFileSync("src/lib/inventory/classification-memory-core.ts", "utf8");
    for (const forbidden of ["supabase", "server-only", "node:fs", "fetch("]) {
      expect(src.includes(forbidden), `memory core must not reference ${forbidden}`).toBe(false);
    }
  });
});
