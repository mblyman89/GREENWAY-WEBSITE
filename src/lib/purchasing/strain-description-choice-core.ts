/**
 * PR-D3 — Manual description choice (product vs category), PURE core.
 *
 * PR-D2 taught the system to AUTO-pick the best description when a vendor's own
 * product text is really just its name (or too thin). PR-D3 lets a human make
 * that call explicitly, per strain, right before saving to the Knowledge Base.
 *
 * This module is the pure brain behind that choice. It has NO React, NO
 * network, NO database — just deterministic functions the UI and the save
 * action both call, so what the buyer SEES is exactly what gets SAVED.
 *
 * Two ideas:
 *   1. buildStrainDescriptionChoices() — for each DISTINCT strain on a Cultivera
 *      detail page, surface BOTH candidate descriptions (the strain's OWN text
 *      and the product-line/category text), plus the PR-D2 recommendation
 *      (pre-selected in the UI) and a plain reason. This is what the chooser
 *      renders and what the header preview reflects.
 *   2. resolveChosenDescription() — given the two candidates and the user's
 *      explicit choice, return the exact text to persist. If the chosen source
 *      turns out to be empty, we fall back safely to the other (never save a
 *      blank when we have something useful), so a click can never make things
 *      worse than the smart default.
 *
 * The recommendation intentionally mirrors resolveMenuDescription() exactly, so
 * "leave it on Recommended and click Save" reproduces PR-D2 behavior precisely.
 */

import { classifyDescriptionQuality } from "./description-quality-core";
import { resolveMenuDescription } from "./menu-description-core";
import type { StrainVariantLike } from "./cultivera-kb-link-core";
import { normalizeStrainKey } from "./cultivera-kb-link-core";

/** Which description source a buyer picked (or the smart default recommends). */
export type StrainDescriptionSource = "product" | "category";

/** One selectable candidate shown as a card in the chooser. */
export type StrainDescriptionOption = {
  /** The description text for this source (trimmed), or null when there is none. */
  text: string | null;
  /** False when this source has nothing to offer — the card is shown disabled. */
  available: boolean;
  /**
   * A short, plain-English tag for THIS card when relevant:
   *   product card: "" (good) | "just its name" | "too short" | "no description"
   *   category card: "" (present) | "no category description"
   * Empty string = no tag needed.
   */
  note: string;
};

/** Everything the chooser needs to render one strain's choice. */
export type StrainDescriptionChoice = {
  /** Normalized de-dupe key (matches strainImagesToSave grouping). */
  strainKey: string;
  /** Display strain name (first variant's clean name). */
  strainName: string;
  /** The strain's OWN description candidate (from its size variants). */
  productOption: StrainDescriptionOption;
  /** The product-line / category description candidate. */
  categoryOption: StrainDescriptionOption;
  /** The PR-D2 recommendation — pre-selected in the UI. */
  recommended: StrainDescriptionSource;
  /** The text that the recommendation resolves to (what a plain Save would store). */
  recommendedText: string | null;
  /**
   * Plain reason the recommendation went the way it did, for a subtle helper
   * line under the cards. Examples:
   *   "The product description looks good, so it's recommended."
   *   "The product description is just its name, so the category description is recommended."
   *   "The product description is too short, so the category description is recommended."
   *   "This product has no description of its own, so the category description is recommended."
   *   "Only the product description is available."
   */
  reason: string;
};

const PRODUCT_NOTE_NAME_ECHO = "just its name";
const PRODUCT_NOTE_TOO_SHORT = "too short";
const PRODUCT_NOTE_EMPTY = "no description";
const CATEGORY_NOTE_EMPTY = "no category description";

function clean(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * Collapse a Cultivera product-detail's variants into the SAME distinct-strain
 * grouping strainImagesToSave() uses (first-seen menu order; first non-empty
 * own description wins per strain), then attach both description candidates and
 * the PR-D2 recommendation. Strains with NO description on either side are
 * omitted — there is nothing to choose. Deterministic.
 */
export function buildStrainDescriptionChoices(
  variants: StrainVariantLike[],
  line: { lineDescription?: string | null },
): StrainDescriptionChoice[] {
  const categoryText = clean(line.lineDescription);
  const order: string[] = [];
  const byKey = new Map<string, { strainName: string; ownDescription: string | null }>();

  for (const v of variants) {
    const rawName = String(v.cleanName ?? v.name ?? "").trim();
    const key = normalizeStrainKey(rawName) || "(unnamed strain)";
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, { strainName: rawName || "(unnamed strain)", ownDescription: null });
    }
    const entry = byKey.get(key)!;
    if (!entry.ownDescription) {
      const desc = clean(v.description);
      if (desc) entry.ownDescription = desc;
    }
  }

  const out: StrainDescriptionChoice[] = [];
  for (const key of order) {
    const entry = byKey.get(key)!;
    const productText = entry.ownDescription;

    // Nothing to choose if BOTH sources are empty.
    if (!productText && !categoryText) continue;

    // PR-D2 recommendation — the SAME call the auto-save makes, so the default
    // reproduces PR-D2 exactly.
    const resolved = resolveMenuDescription(productText, categoryText, entry.strainName);
    const recommended: StrainDescriptionSource = resolved.isFallback ? "category" : "product";

    // Per-card notes + the helper reason.
    let productNote = "";
    let reason = "";
    if (!productText) {
      productNote = PRODUCT_NOTE_EMPTY;
    } else {
      const quality = classifyDescriptionQuality(productText, entry.strainName);
      if (quality.verdict === "name_echo") productNote = PRODUCT_NOTE_NAME_ECHO;
      else if (quality.verdict === "low_value") productNote = PRODUCT_NOTE_TOO_SHORT;
    }
    const categoryNote = categoryText ? "" : CATEGORY_NOTE_EMPTY;

    if (recommended === "product") {
      reason = categoryText
        ? "The product description looks good, so it's recommended."
        : "Only the product description is available.";
    } else {
      // recommended === "category"
      if (!productText) {
        reason = "This product has no description of its own, so the category description is recommended.";
      } else if (productNote === PRODUCT_NOTE_NAME_ECHO) {
        reason = "The product description is just its name, so the category description is recommended.";
      } else if (productNote === PRODUCT_NOTE_TOO_SHORT) {
        reason = "The product description is too short, so the category description is recommended.";
      } else {
        reason = "The category description is recommended.";
      }
    }

    out.push({
      strainKey: key,
      strainName: entry.strainName,
      productOption: { text: productText, available: !!productText, note: productNote },
      categoryOption: { text: categoryText, available: !!categoryText, note: categoryNote },
      recommended,
      recommendedText: resolved.text,
      reason,
    });
  }
  return out;
}

/**
 * Given the two candidate texts and the buyer's explicit choice, return the
 * text to actually SAVE. Safety net: if the chosen source is empty, fall back
 * to the other source (a click must never blank out a description we have).
 * When no explicit choice is given, this defers to the PR-D2 smart pick so the
 * save path is 100% backward compatible.
 */
export function resolveChosenDescription(
  productText: string | null,
  categoryText: string | null,
  choice: StrainDescriptionSource | null | undefined,
  strainName?: string | null,
): string | null {
  const product = clean(productText);
  const category = clean(categoryText);

  if (choice === "product") return product ?? category;
  if (choice === "category") return category ?? product;

  // No explicit choice — reproduce PR-D2 exactly.
  return resolveMenuDescription(product, category, strainName ?? null).text;
}

/**
 * Parse the compact choices payload the client sends (strainKey -> source).
 * Tolerant: ignores unknown sources and non-string values, never throws.
 * Returns a Map for O(1) lookup in the save loop.
 */
export function parseStrainChoices(raw: unknown): Map<string, StrainDescriptionSource> {
  const map = new Map<string, StrainDescriptionSource>();
  if (!raw || typeof raw !== "object") return map;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    if (!key) continue;
    if (v === "product" || v === "category") map.set(key, v);
  }
  return map;
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`strain-description-choice-core self-test failed: ${msg}`);
}

export function __runStrainDescriptionChoiceCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  const V = (
    name: string,
    description: string | null,
  ): StrainVariantLike => ({ cleanName: name, name, description });

  // --- buildStrainDescriptionChoices -------------------------------------

  // Good product description -> recommend product.
  {
    const c = buildStrainDescriptionChoices(
      [V("Blue Dream", "A smooth sativa-leaning hybrid with berry and herbal notes.")],
      { lineDescription: "Our signature flower line." },
    );
    ok(c.length === 1, "one strain built");
    ok(c[0].recommended === "product", "good product -> recommend product");
    ok(c[0].productOption.note === "", "good product has no note");
    ok(c[0].categoryOption.available === true, "category available");
    ok(c[0].reason.includes("looks good"), "reason mentions looks good");
  }

  // Product description is just the name -> recommend category, note name-echo.
  {
    const c = buildStrainDescriptionChoices(
      [V("Blue Dream 3.5g", "Blue Dream 3.5g")],
      { lineDescription: "Small-batch indoor flower, hand-trimmed and slow-cured." },
    );
    ok(c[0].recommended === "category", "name-echo -> recommend category");
    ok(c[0].productOption.note === "just its name", "name-echo product note");
    ok(c[0].reason.includes("just its name"), "reason mentions just its name");
    ok(c[0].recommendedText === "Small-batch indoor flower, hand-trimmed and slow-cured.", "recommendedText is category");
  }

  // Product description too short -> recommend category, note too short.
  {
    const c = buildStrainDescriptionChoices(
      [V("Gelato", "Tasty.")],
      { lineDescription: "Premium craft cannabis grown in living soil." },
    );
    ok(c[0].recommended === "category", "too-short -> recommend category");
    ok(c[0].productOption.note === "too short", "too-short product note");
    ok(c[0].reason.includes("too short"), "reason mentions too short");
  }

  // No own description, category present -> recommend category, product empty note.
  {
    const c = buildStrainDescriptionChoices(
      [V("Wedding Cake", null)],
      { lineDescription: "House flower line." },
    );
    ok(c[0].recommended === "category", "no own -> recommend category");
    ok(c[0].productOption.available === false, "product unavailable");
    ok(c[0].productOption.note === "no description", "empty product note");
    ok(c[0].categoryOption.available === true, "category available");
    ok(c[0].reason.includes("no description of its own"), "reason mentions no own description");
  }

  // Good product but NO category -> recommend product, category disabled note.
  {
    const c = buildStrainDescriptionChoices(
      [V("Runtz", "A sweet, candy-forward hybrid with a heavy resin coat.")],
      { lineDescription: null },
    );
    ok(c[0].recommended === "product", "no category -> recommend product");
    ok(c[0].categoryOption.available === false, "category unavailable");
    ok(c[0].categoryOption.note === "no category description", "empty category note");
    ok(c[0].reason.includes("Only the product description"), "reason mentions only product");
  }

  // Both empty -> omitted (nothing to choose).
  {
    const c = buildStrainDescriptionChoices([V("Mystery", null)], { lineDescription: null });
    ok(c.length === 0, "both empty -> omitted");
  }

  // De-dupe: two sizes of the same strain collapse to ONE choice; first non-empty own wins.
  {
    const c = buildStrainDescriptionChoices(
      [V("Zkittlez", null), V("Zkittlez", "Loud tropical candy nose, dense colas.")],
      { lineDescription: "Line." },
    );
    ok(c.length === 1, "same strain collapses to one");
    ok(c[0].productOption.text === "Loud tropical candy nose, dense colas.", "first non-empty own wins");
    ok(c[0].recommended === "product", "collapsed good product -> product");
  }

  // Menu order preserved across distinct strains.
  {
    const c = buildStrainDescriptionChoices(
      [V("Alpha", "Good long enough description here."), V("Bravo", "Another good long description here.")],
      { lineDescription: "Line." },
    );
    ok(c.length === 2, "two distinct strains");
    ok(c[0].strainName === "Alpha" && c[1].strainName === "Bravo", "menu order preserved");
  }

  // --- resolveChosenDescription ------------------------------------------

  // Explicit product wins even when smart pick would prefer category.
  ok(
    resolveChosenDescription("Blue Dream", "A rich category description here.", "product", "Blue Dream") === "Blue Dream",
    "explicit product overrides smart pick",
  );
  // Explicit category wins even when product is good.
  ok(
    resolveChosenDescription("A genuinely good product description.", "Category text.", "category", "X") === "Category text.",
    "explicit category chosen",
  );
  // Choosing product when product empty falls back to category (never blank).
  ok(
    resolveChosenDescription(null, "Category text.", "product", "X") === "Category text.",
    "product empty -> falls back to category",
  );
  // Choosing category when category empty falls back to product.
  ok(
    resolveChosenDescription("Product text.", null, "category", "X") === "Product text.",
    "category empty -> falls back to product",
  );
  // No choice -> PR-D2 smart pick (name-echo -> category).
  ok(
    resolveChosenDescription("Gelato", "A proper category description here.", null, "Gelato") === "A proper category description here.",
    "no choice -> smart pick (name-echo)",
  );
  // No choice, good product -> product.
  ok(
    resolveChosenDescription("A proper, useful product description.", "Category.", null, "Gelato") === "A proper, useful product description.",
    "no choice -> smart pick (good product)",
  );

  // --- parseStrainChoices ------------------------------------------------
  {
    const m = parseStrainChoices({ "blue dream": "product", gelato: "category", junk: "nope", "": "product" });
    ok(m.size === 2, "parse keeps only valid entries");
    ok(m.get("blue dream") === "product", "parse product");
    ok(m.get("gelato") === "category", "parse category");
    ok(parseStrainChoices(null).size === 0, "parse null -> empty");
    ok(parseStrainChoices("str").size === 0, "parse non-object -> empty");
  }

  console.log(`strain-description-choice-core: ${n} self-tests passed`);
}
