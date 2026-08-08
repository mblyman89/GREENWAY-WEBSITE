/**
 * PR-D4 — Product "menu-readiness" health, PURE core.
 *
 * The D-series gave every product a great description (D2 smart pick, D3 manual
 * choice). This slice answers the next question at a glance: "which products are
 * actually READY to look beautiful on the menu, and what's the one thing to fix
 * next?" — the same idea as the vendor/brand completeness meters, tuned for what
 * makes a product card shine.
 *
 * Michael's calls (verified, not guessed):
 *   • Photo and Description matter MOST → weight 3 each.
 *   • Aroma + Flavor add richness (the colorful pills on the menu) → weight 1 each.
 *   • Category is needed for grouping → weight 1.
 *   • THC/CBD potency is auto-set at intake from the vendor JSON, so it is NOT
 *     scored here (a product can't exist without it).
 *   • "Has a description" is STRICT: a description only counts when it's a
 *     genuinely GOOD one (reusing the PR-D2 quality check). A description that is
 *     just the product's name, or too thin, reads as a gap to improve — and the
 *     helper says so.
 *
 * This module mirrors the shape of src/lib/vendors/completeness.ts on purpose
 * (percent / level / nextUp / items) so the existing meter styling and the
 * "Next up: add X" language carry over. It is PURE (no React, no I/O): the page
 * maps each item's `fixKind` to a concrete worklist link, keeping this testable.
 */

import { classifyDescriptionQuality } from "./description-quality-core";

/** Where the "Fix →" button should send the buyer for this gap. */
export type MenuReadinessFixKind = "image" | "description" | "details";

/** Strict description state for the row's helper copy. */
export type DescriptionState = "good" | "weak" | "missing";

/** One graded field on the readiness card. */
export type MenuReadinessItem = {
  /** Stable key for the field. */
  key: "photo" | "description" | "category" | "aroma" | "flavor";
  /** Plain-language label shown to staff. */
  label: string;
  /** Whether this field counts as done (for description: good ONLY). */
  done: boolean;
  /** Relative importance — higher weights count more toward the score. */
  weight: number;
  /** Where a "Fix →" for this item should route. */
  fixKind: MenuReadinessFixKind;
  /**
   * Optional short reason shown when the item is NOT done, e.g. for a weak
   * description: "it's just the product's name" / "it's too short". Empty
   * otherwise.
   */
  note: string;
};

export type MenuReadinessResult = {
  /** 0–100 rounded, weighted percentage. */
  percent: number;
  /** Number of completed items. */
  completed: number;
  /** Total tracked items. */
  total: number;
  /** Every tracked field with its done/not-done state. */
  items: MenuReadinessItem[];
  /** The highest-weight unfinished item, or null when fully ready. */
  nextUp: MenuReadinessItem | null;
  /** Friendly status word for the meter. */
  level: "empty" | "started" | "good" | "complete";
  /** Strict description state (drives the honest "improve it" nudge). */
  descriptionState: DescriptionState;
};

/** The minimal, structural product shape this scorer reads. */
export type MenuReadinessInput = {
  /** True when the product has a primary image saved. */
  hasImage: boolean;
  /** The saved description (raw). */
  description: string | null | undefined;
  /** The product name — needed for the STRICT (name-echo) description check. */
  productName: string | null | undefined;
  /** The saved category. */
  category: string | null | undefined;
  /** Aroma notes (the colorful pills). */
  aromaNotes: string[] | null | undefined;
  /** Flavor notes (the colorful pills). */
  flavorNotes: string[] | null | undefined;
};

function filledStr(v: string | null | undefined): boolean {
  return Boolean(v && v.trim().length > 0);
}

function filledArr(v: string[] | null | undefined): boolean {
  return Array.isArray(v) && v.some((x) => filledStr(x));
}

/**
 * Grade a product's description STRICTLY:
 *   • missing  → no text at all.
 *   • weak     → text exists but is just the product's name (name_echo) or too
 *                thin (low_value) — reads as a gap to improve.
 *   • good     → genuine, useful prose.
 * Returns the state plus a plain-English note for the weak/missing cases.
 */
export function gradeDescription(
  description: string | null | undefined,
  productName: string | null | undefined,
): { state: DescriptionState; note: string } {
  if (!filledStr(description)) return { state: "missing", note: "no description saved" };
  const verdict = classifyDescriptionQuality(description!, productName ?? null).verdict;
  if (verdict === "name_echo") return { state: "weak", note: "it's just the product's name — write a real one" };
  if (verdict === "low_value") return { state: "weak", note: "it's too short — add a bit more" };
  return { state: "good", note: "" };
}

/**
 * Score a product's menu-readiness. Deterministic and pure. The item order is
 * stable (photo, description, category, aroma, flavor) so the UI checklist and
 * `nextUp` are predictable.
 */
export function scoreMenuReadiness(input: MenuReadinessInput): MenuReadinessResult {
  const desc = gradeDescription(input.description, input.productName);

  const items: MenuReadinessItem[] = [
    {
      key: "photo",
      label: "Product photo",
      done: input.hasImage,
      weight: 3,
      fixKind: "image",
      note: input.hasImage ? "" : "no photo saved",
    },
    {
      key: "description",
      label: "Good description",
      done: desc.state === "good",
      weight: 3,
      fixKind: "description",
      note: desc.state === "good" ? "" : desc.note,
    },
    {
      key: "category",
      label: "Category",
      done: filledStr(input.category),
      weight: 1,
      fixKind: "details",
      note: filledStr(input.category) ? "" : "no category set",
    },
    {
      key: "aroma",
      label: "Aroma notes",
      done: filledArr(input.aromaNotes),
      weight: 1,
      fixKind: "details",
      note: filledArr(input.aromaNotes) ? "" : "add aroma pills",
    },
    {
      key: "flavor",
      label: "Flavor notes",
      done: filledArr(input.flavorNotes),
      weight: 1,
      fixKind: "details",
      note: filledArr(input.flavorNotes) ? "" : "add flavor pills",
    },
  ];

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const doneWeight = items.reduce((s, i) => (i.done ? s + i.weight : s), 0);
  const percent = totalWeight === 0 ? 0 : Math.round((doneWeight / totalWeight) * 100);
  const completed = items.filter((i) => i.done).length;

  // The most valuable thing still missing (highest weight; stable order breaks ties).
  const nextUp = items.filter((i) => !i.done).sort((a, b) => b.weight - a.weight)[0] ?? null;

  const level: MenuReadinessResult["level"] =
    percent >= 100 ? "complete" : percent >= 70 ? "good" : percent > 0 ? "started" : "empty";

  return { percent, completed, total: items.length, items, nextUp, level, descriptionState: desc.state };
}

/**
 * "Is this product ready to look great on the menu?" — the single boolean the
 * list uses for the Menu-ready filter + the headline count. A product is
 * menu-ready when it has BOTH a photo and a genuinely good description (the two
 * things Michael said matter most). Aroma/flavor/category add polish but do not
 * block "ready".
 */
export function isMenuReady(result: MenuReadinessResult): boolean {
  const photo = result.items.find((i) => i.key === "photo");
  return Boolean(photo?.done) && result.descriptionState === "good";
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`menu-readiness-core self-test failed: ${msg}`);
}

export function __runMenuReadinessCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  const GOOD_DESC = "A smooth, sativa-leaning hybrid with bright citrus and pine on the nose.";

  // Fully ready: photo + good desc + category + aroma + flavor → 100 / complete.
  {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: GOOD_DESC,
      productName: "Blue Dream",
      category: "Flower",
      aromaNotes: ["citrus", "pine"],
      flavorNotes: ["berry"],
    });
    ok(r.percent === 100, "all fields → 100%");
    ok(r.level === "complete", "all fields → complete");
    ok(r.nextUp === null, "all fields → no nextUp");
    ok(r.descriptionState === "good", "good desc state");
    ok(isMenuReady(r), "all fields → menu ready");
  }

  // Empty product → 0 / empty, nextUp is the photo (weight 3, first).
  {
    const r = scoreMenuReadiness({
      hasImage: false,
      description: null,
      productName: "Mystery",
      category: null,
      aromaNotes: [],
      flavorNotes: null,
    });
    ok(r.percent === 0, "empty → 0%");
    ok(r.level === "empty", "empty → empty level");
    ok(r.completed === 0, "empty → 0 completed");
    ok(r.nextUp?.key === "photo", "empty → nextUp photo (highest weight, first)");
    ok(r.descriptionState === "missing", "empty → missing description");
    ok(!isMenuReady(r), "empty → not ready");
  }

  // STRICT description: a name-echo does NOT count and is flagged weak.
  {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: "Blue Dream 3.5g",
      productName: "Blue Dream 3.5g",
      category: "Flower",
      aromaNotes: ["citrus"],
      flavorNotes: ["berry"],
    });
    const d = r.items.find((i) => i.key === "description")!;
    ok(!d.done, "name-echo description NOT done");
    ok(r.descriptionState === "weak", "name-echo → weak state");
    ok(d.note.includes("just the product's name"), "name-echo note");
    ok(!isMenuReady(r), "photo but weak desc → not ready");
    // photo(3)+category(1)+aroma(1)+flavor(1) = 6 of 9 → 67%.
    ok(r.percent === 67, "name-echo weighted percent = 67");
    ok(r.nextUp?.key === "description", "nextUp is the weak description (weight 3)");
  }

  // STRICT description: too short → weak, "too short" note.
  {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: "Nice.",
      productName: "Gelato",
      category: "Flower",
      aromaNotes: ["sweet"],
      flavorNotes: ["cream"],
    });
    const d = r.items.find((i) => i.key === "description")!;
    ok(!d.done, "too-short description NOT done");
    ok(r.descriptionState === "weak", "too-short → weak");
    ok(d.note.includes("too short"), "too-short note");
  }

  // Photo missing, good desc → nextUp photo; not ready.
  {
    const r = scoreMenuReadiness({
      hasImage: false,
      description: GOOD_DESC,
      productName: "Runtz",
      category: "Flower",
      aromaNotes: ["candy"],
      flavorNotes: ["fruit"],
    });
    ok(r.nextUp?.key === "photo", "missing photo → nextUp photo");
    ok(r.descriptionState === "good", "good desc still good");
    ok(!isMenuReady(r), "no photo → not ready even with good desc");
    // desc(3)+category(1)+aroma(1)+flavor(1) = 6 of 9 → 67%.
    ok(r.percent === 67, "missing photo weighted percent = 67");
  }

  // Photo + good desc but nothing else → menu ready (details are polish).
  {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: GOOD_DESC,
      productName: "Wedding Cake",
      category: null,
      aromaNotes: null,
      flavorNotes: null,
    });
    ok(isMenuReady(r), "photo + good desc → menu ready");
    ok(r.percent === 67, "photo(3)+desc(3)=6 of 9 → 67%");
    ok(r.level === "started" || r.level === "good", "67% level bucket");
    ok(r.nextUp?.key === "category", "nextUp is category (first weight-1 gap)");
  }

  // fixKind mapping is stable.
  {
    const r = scoreMenuReadiness({
      hasImage: false,
      description: null,
      productName: "X",
      category: null,
      aromaNotes: null,
      flavorNotes: null,
    });
    ok(r.items.find((i) => i.key === "photo")!.fixKind === "image", "photo → image fix");
    ok(r.items.find((i) => i.key === "description")!.fixKind === "description", "description → description fix");
    ok(r.items.find((i) => i.key === "aroma")!.fixKind === "details", "aroma → details fix");
  }

  // gradeDescription standalone.
  ok(gradeDescription(null, "X").state === "missing", "gradeDescription missing");
  ok(gradeDescription("X", "X").state === "weak", "gradeDescription name-echo weak");
  ok(gradeDescription(GOOD_DESC, "Blue Dream").state === "good", "gradeDescription good");

  console.log(`menu-readiness-core: ${n} self-tests passed`);
}
