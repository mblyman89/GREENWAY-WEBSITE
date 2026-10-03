/**
 * src/lib/catalog/slug-core.ts  (R24 follow-up: S20 / finding F-053)
 *
 * Owner (R24, verbatim): "Please build S36 as one pr, then build the three
 * small follow ups, each as their own pr."  Bible F-053: "add a shared
 * `slug-core.ts` with `strainSlug()` and `dashedSlug()` to eliminate the 6+
 * inline copies (drift risk)."
 *
 * The ONE home of the two KB slug rules. Every former private copy now
 * imports from here, so the rule can only change in one place - and the
 * byte-for-byte oracle test (tests/compliance/r24-s20-slug-core-brand.test.ts)
 * fails if it ever changes at all.
 *
 * TWO CONVENTIONS, BOTH DELIBERATE - NEVER "UNIFY" THEM:
 *
 *   dashedSlug   kb_products.brand_slug / product_slug, kb_brands.slug,
 *                kb_product_categories.slug.
 *                trim -> lowercase -> every run of [^a-z0-9] -> "-" ->
 *                strip leading/trailing dashes.   "Blue Dream 3.5g" ->
 *                "blue-dream-3-5g". The composite (brand_slug, product_slug,
 *                variant_label) is UNIQUE (0071 uq_kb_products_identity), so
 *                drift here silently loses rows.
 *
 *   strainSlug   kb_strains.slug.
 *                trim -> lowercase -> every whitespace run -> ONE space.
 *                NOT dashed.  "Blue  Dream" -> "blue dream". Every existing
 *                strain row is keyed this way; "fixing" it to dashed would
 *                orphan them all (bible S03 risk note, F-031/F-044/F-053).
 *
 * Pure: no I/O, no imports. Embedded self-tests at the bottom (registered in
 * scripts/compliance/run-pure-selftests.ts with an exact floor).
 */

/** kb_products / kb_brands / kb_product_categories slug (dashed). */
export function dashedSlug(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** kb_strains slug: lowercase, single-spaced, NOT dashed. */
export function strainSlug(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Self-tests (pure, no I/O)
// ---------------------------------------------------------------------------
export function __runSlugCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (got: unknown, want: unknown, msg: string) => {
    if (got === want) passed += 1;
    else {
      failed += 1;
      console.error(`slug-core FAIL: ${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
    }
  };

  // dashedSlug
  eq(dashedSlug("Phat Panda"), "phat-panda", "dashed: brand");
  eq(dashedSlug("Blue Dream 3.5g"), "blue-dream-3-5g", "dashed: size punctuation becomes a dash");
  eq(dashedSlug("  Blue  Dream  "), "blue-dream", "dashed: trimmed, runs collapse");
  eq(dashedSlug("Sweet & Sour"), "sweet-sour", "dashed: ampersand is a separator, never the word 'and'");
  eq(dashedSlug("---x---"), "x", "dashed: leading/trailing dashes stripped");
  eq(dashedSlug("a___b---c"), "a-b-c", "dashed: mixed runs collapse to one dash");
  eq(dashedSlug("!!!"), "", "dashed: only punctuation -> empty (callers supply 'product')");
  eq(dashedSlug(""), "", "dashed: empty");
  eq(dashedSlug(null), "", "dashed: null");
  eq(dashedSlug(undefined), "", "dashed: undefined");
  eq(dashedSlug("ÄÖÜ strain"), "strain", "dashed: non-ASCII letters are separators (byte-identical to the old copies)");
  eq(dashedSlug("100% Pure!"), "100-pure", "dashed: digits kept");
  eq(dashedSlug("CERES - 435011"), "ceres-435011", "dashed: license digits kept");

  // strainSlug
  eq(strainSlug("Blue Dream"), "blue dream", "spaced: lowercase");
  eq(strainSlug("  Blue \t Dream \n"), "blue dream", "spaced: trimmed, any whitespace run -> one space");
  eq(strainSlug("Girl Scout Cookies #4"), "girl scout cookies #4", "spaced: punctuation KEPT (never dashed)");
  eq(strainSlug("Blue-Dream"), "blue-dream", "spaced: an existing dash is kept as typed");
  eq(strainSlug(""), "", "spaced: empty");
  eq(strainSlug(null), "", "spaced: null");
  eq(strainSlug(undefined), "", "spaced: undefined");

  // The two conventions stay distinct for the same words.
  eq(strainSlug("Blue  Dream") === dashedSlug("Blue  Dream"), false, "spaced and dashed differ for the same words");
  eq(dashedSlug(strainSlug("Blue  Dream")), dashedSlug("Blue  Dream"), "dashing a strain slug gives the product slug");

  // Idempotent: a slug is a fixed point of its own rule.
  for (const s of ["Phat Panda", "Blue Dream 3.5g", "  a__b  c ", "100% Pure!"]) {
    eq(dashedSlug(dashedSlug(s)), dashedSlug(s), `dashed idempotent: ${s}`);
    eq(strainSlug(strainSlug(s)), strainSlug(s), `spaced idempotent: ${s}`);
  }

  return { passed, failed };
}
