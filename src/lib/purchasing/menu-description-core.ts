/**
 * src/lib/purchasing/menu-description-core.ts
 *
 * SLICE 85 — resolve the description to SHOW and SAVE for a vendor-menu
 * product: the product's OWN description always wins; when it has none, the
 * category / product-line description stands in and is FLAGGED as a fallback
 * (exactly mirroring the image-fallback pattern: effectiveImageUrl +
 * imageIsFallback + the gold "placeholder image" badge).
 *
 * The flag matters twice:
 *   • UI — a gold "category description" badge tells the buyer the prose is
 *     generic, so a product-specific description should be sourced later.
 *   • KB — the write-back is gap-fill (empty -> value, never clobber), so a
 *     human's curated KB description is never overwritten by a stand-in; the
 *     badge tells the buyer a product-specific description should still be
 *     sourced (the audit trail records how many saves were stand-ins).
 *
 * 100% pure (no I/O, no Date.now, no DOM). Self-tested in the pure runner
 * and mirrored in vitest.
 */

import {
  classifyDescriptionQuality,
  type DescriptionVerdict,
} from "./description-quality-core";

/** Why the category stand-in was (or wasn't) used. */
export type DescriptionFallbackReason =
  /** No fallback happened — the product's own description was used. */
  | "none"
  /** The product had no description of its own. */
  | "empty_own"
  /** The product's own "description" was just its name / a variant of it. */
  | "name_echo"
  /** The product's own description was too short to be useful. */
  | "low_value";

/** The resolved description for one menu product. */
export type ResolvedMenuDescription = {
  /** The text to show/save — own first, else the category stand-in, else null. */
  text: string | null;
  /** True when `text` came from the category/product-line fallback. */
  isFallback: boolean;
  /**
   * PR-D2 — WHY the fallback was chosen (or "none"). Lets the UI + audit trail
   * explain a stand-in beyond the generic badge (e.g. "own text was just the
   * name"). Always present; "none" when `isFallback` is false.
   */
  fallbackReason: DescriptionFallbackReason;
};

/** Badge label for a category-description stand-in (mirrors "placeholder image"). */
export const DESCRIPTION_FALLBACK_BADGE = "category description";

/** Hover/tooltip copy for the fallback badge — plain English, like the image badge. */
export const DESCRIPTION_FALLBACK_TITLE =
  "This product has no description of its own, so the category / product-line " +
  "description is shown as a stand-in. Source a product-specific description when you can.";

/**
 * PR-D2 — reason-aware tooltip for the "category description" badge. The badge
 * LABEL stays the same ("category description"); this explains WHY the stand-in
 * was chosen so the buyer understands (empty vs the own text was just the name
 * vs too thin). Falls back to the generic copy for "none"/unknown.
 */
export function descriptionFallbackTitle(reason: DescriptionFallbackReason): string {
  switch (reason) {
    case "name_echo":
      return (
        "This product's own description was just its name, so the category / " +
        "product-line description (which describes every product in the category) " +
        "is shown instead. Source a product-specific description when you can."
      );
    case "low_value":
      return (
        "This product's own description was too short to be useful, so the " +
        "category / product-line description is shown instead. Source a " +
        "product-specific description when you can."
      );
    case "empty_own":
    case "none":
    default:
      return DESCRIPTION_FALLBACK_TITLE;
  }
}

/**
 * Resolve which description to show/save.
 *
 * SLICE 85 behavior (unchanged when `productName` is omitted): the product's
 * OWN description always wins; when it is missing, a non-empty category/line
 * description stands in (flagged); when both are missing -> null.
 *
 * PR-D2 SMART PICKER (active only when `productName` is provided): the own
 * description must also be REAL PROSE to win. If the own "description" is just
 * the product's name (or a trivial variant) or too short to be useful, AND a
 * real category description exists, the category description stands in instead
 * (flagged, with the reason recorded). This never discards genuinely useful
 * prose — the classifier is conservative and defaults to "good". When the own
 * text is weak but there's NO category prose to fall back to, we keep the weak
 * own text (better than nothing) rather than blanking it.
 *
 * Trims all inputs; whitespace-only counts as missing.
 */
export function resolveMenuDescription(
  own: string | null | undefined,
  categoryFallback: string | null | undefined,
  productName?: string | null | undefined,
): ResolvedMenuDescription {
  const o = String(own ?? "").trim();
  const c = String(categoryFallback ?? "").trim();

  // No own text at all -> category stands in (empty_own), else null.
  if (!o) {
    if (c) return { text: c, isFallback: true, fallbackReason: "empty_own" };
    return { text: null, isFallback: false, fallbackReason: "none" };
  }

  // Own text exists. Without a productName we keep the SLICE-85 rule exactly:
  // own always wins.
  if (productName == null) {
    return { text: o, isFallback: false, fallbackReason: "none" };
  }

  // Smart pick: is the own description real prose, or just the name / too thin?
  const quality = classifyDescriptionQuality(o, productName);
  if (quality.verdict === "good") {
    return { text: o, isFallback: false, fallbackReason: "none" };
  }

  // Own text is weak (name echo or low value). Prefer a REAL category
  // description if one exists; otherwise keep the weak own text (never blank a
  // product that at least says something).
  if (c) {
    const reason: DescriptionFallbackReason =
      quality.verdict as Exclude<DescriptionVerdict, "good">;
    return { text: c, isFallback: true, fallbackReason: reason };
  }
  return { text: o, isFallback: false, fallbackReason: "none" };
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`menu-description-core self-test failed: ${msg}`);
}

export function __runMenuDescriptionCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // --- SLICE 85 behavior (no productName) is unchanged. ---

  // Own description always wins — never flagged.
  const own = resolveMenuDescription("Tangy gummy, 10 pack.", "Edibles for every occasion.");
  ok(own.text === "Tangy gummy, 10 pack.", "own description wins");
  ok(own.isFallback === false, "own description is not a fallback");
  ok(own.fallbackReason === "none", "own win -> reason none");

  // Missing own -> category stand-in, FLAGGED.
  const fb = resolveMenuDescription(null, "Edibles for every occasion.");
  ok(fb.text === "Edibles for every occasion.", "category description stands in");
  ok(fb.isFallback === true, "category stand-in is flagged");
  ok(fb.fallbackReason === "empty_own", "empty own -> reason empty_own");

  // Whitespace-only own counts as missing.
  const ws = resolveMenuDescription("   ", "Line prose.");
  ok(ws.text === "Line prose." && ws.isFallback === true, "whitespace own -> fallback");

  // Both missing -> null, unflagged.
  const none = resolveMenuDescription(null, null);
  ok(none.text === null && none.isFallback === false, "both missing -> null, not flagged");
  ok(none.fallbackReason === "none", "both missing -> reason none");
  const empty = resolveMenuDescription("", "  ");
  ok(empty.text === null && empty.isFallback === false, "empty strings -> null, not flagged");

  // Trimming applies to the winning text.
  ok(resolveMenuDescription("  fresh berry gummy chews  ", null).text === "fresh berry gummy chews", "own text trimmed");
  ok(resolveMenuDescription(null, "  line  ").text === "line", "fallback text trimmed");

  // Without a productName, even a name-like own description still wins (old rule).
  const legacy = resolveMenuDescription("Blue Dream", "A smooth, uplifting hybrid.");
  ok(legacy.text === "Blue Dream" && legacy.isFallback === false, "no productName -> own always wins (legacy)");

  // --- PR-D2 SMART PICKER (productName provided). ---

  // Good own prose still wins even with a name given.
  const smartGood = resolveMenuDescription(
    "A smooth, uplifting hybrid with notes of berry and citrus.",
    "Generic flower category prose.",
    "Blue Dream",
  );
  ok(smartGood.isFallback === false && smartGood.fallbackReason === "none", "good own prose wins under smart pick");

  // Own is JUST the name -> category prose stands in, flagged name_echo.
  const smartEcho = resolveMenuDescription(
    "Blue Dream 3.5g",
    "Our flower is hang-dried and hand-trimmed for a smooth, terpene-rich smoke.",
    "Blue Dream",
  );
  ok(smartEcho.isFallback === true, "name-echo own -> category stands in");
  ok(smartEcho.fallbackReason === "name_echo", "name-echo reason recorded");
  ok((smartEcho.text ?? "").startsWith("Our flower"), "category text used for name echo");

  // Own is too thin (low value) -> category prose stands in, flagged low_value.
  const smartThin = resolveMenuDescription(
    "Indica",
    "A deeply relaxing indica-dominant selection for winding down.",
    "Northern Lights",
  );
  ok(smartThin.isFallback === true && smartThin.fallbackReason === "low_value", "low-value own -> category, low_value reason");

  // Weak own but NO category prose -> keep the weak own text (never blank it).
  const smartKeep = resolveMenuDescription("Blue Dream", null, "Blue Dream");
  ok(smartKeep.text === "Blue Dream" && smartKeep.isFallback === false, "weak own kept when no category to fall back to");
  ok(smartKeep.fallbackReason === "none", "weak-own-kept -> reason none");

  // Badge copy pinned (UI + docs reference these exact strings).
  ok(DESCRIPTION_FALLBACK_BADGE === "category description", "badge label pinned");
  ok(
    DESCRIPTION_FALLBACK_TITLE.includes("no description of its own") &&
      DESCRIPTION_FALLBACK_TITLE.includes("stand-in"),
    "badge title explains the stand-in",
  );

  // PR-D2 — reason-aware tooltips.
  ok(
    descriptionFallbackTitle("name_echo").includes("just its name"),
    "name_echo tooltip explains the name echo",
  );
  ok(
    descriptionFallbackTitle("low_value").includes("too short"),
    "low_value tooltip explains the thin description",
  );
  ok(
    descriptionFallbackTitle("empty_own") === DESCRIPTION_FALLBACK_TITLE &&
      descriptionFallbackTitle("none") === DESCRIPTION_FALLBACK_TITLE,
    "empty_own / none fall back to the generic tooltip",
  );

  console.log(`menu-description-core: ${n} self-tests passed`);
}
