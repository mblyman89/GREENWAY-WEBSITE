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

/** The resolved description for one menu product. */
export type ResolvedMenuDescription = {
  /** The text to show/save — own first, else the category stand-in, else null. */
  text: string | null;
  /** True when `text` came from the category/product-line fallback. */
  isFallback: boolean;
};

/** Badge label for a category-description stand-in (mirrors "placeholder image"). */
export const DESCRIPTION_FALLBACK_BADGE = "category description";

/** Hover/tooltip copy for the fallback badge — plain English, like the image badge. */
export const DESCRIPTION_FALLBACK_TITLE =
  "This product has no description of its own, so the category / product-line " +
  "description is shown as a stand-in. Source a product-specific description when you can.";

/**
 * Resolve which description to show/save. Trims both inputs; whitespace-only
 * counts as missing. Own description always wins (isFallback false); when it
 * is missing, a non-empty category/line description stands in (isFallback
 * true); when both are missing, {text: null, isFallback: false}.
 */
export function resolveMenuDescription(
  own: string | null | undefined,
  categoryFallback: string | null | undefined,
): ResolvedMenuDescription {
  const o = String(own ?? "").trim();
  if (o) return { text: o, isFallback: false };
  const c = String(categoryFallback ?? "").trim();
  if (c) return { text: c, isFallback: true };
  return { text: null, isFallback: false };
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

  // Own description always wins — never flagged.
  const own = resolveMenuDescription("Tangy gummy, 10 pack.", "Edibles for every occasion.");
  ok(own.text === "Tangy gummy, 10 pack.", "own description wins");
  ok(own.isFallback === false, "own description is not a fallback");

  // Missing own -> category stand-in, FLAGGED.
  const fb = resolveMenuDescription(null, "Edibles for every occasion.");
  ok(fb.text === "Edibles for every occasion.", "category description stands in");
  ok(fb.isFallback === true, "category stand-in is flagged");

  // Whitespace-only own counts as missing.
  const ws = resolveMenuDescription("   ", "Line prose.");
  ok(ws.text === "Line prose." && ws.isFallback === true, "whitespace own -> fallback");

  // Both missing -> null, unflagged.
  const none = resolveMenuDescription(null, null);
  ok(none.text === null && none.isFallback === false, "both missing -> null, not flagged");
  const empty = resolveMenuDescription("", "  ");
  ok(empty.text === null && empty.isFallback === false, "empty strings -> null, not flagged");

  // Trimming applies to the winning text.
  ok(resolveMenuDescription("  fresh  ", null).text === "fresh", "own text trimmed");
  ok(resolveMenuDescription(null, "  line  ").text === "line", "fallback text trimmed");

  // Badge copy pinned (UI + docs reference these exact strings).
  ok(DESCRIPTION_FALLBACK_BADGE === "category description", "badge label pinned");
  ok(
    DESCRIPTION_FALLBACK_TITLE.includes("no description of its own") &&
      DESCRIPTION_FALLBACK_TITLE.includes("stand-in"),
    "badge title explains the stand-in",
  );

  console.log(`menu-description-core: ${n} self-tests passed`);
}
