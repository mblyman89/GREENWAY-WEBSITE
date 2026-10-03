/**
 * src/lib/catalog/kb-slug-input-core.ts  (R25 B)
 *
 * Owner (R25, verbatim): "I also would like you to build the brand form use
 * dashes and other types of things like using dashes."
 *
 * ONE rule for every slug a person TYPES (or leaves blank) in a Knowledge
 * Base form whose table is keyed by the DASHED convention: kb_brands,
 * kb_product_categories, kb_faqs. Before this, the brand form built a SPACED
 * slug ("phat panda") while the intake writer looks kb_brands up by the dashed
 * one ("phat-panda"), so a multi-word brand typed into the form became a
 * second row the writer never finds (R24 S20 finding). The product-type form
 * and the FAQ form stored a typed slug as-is (only trimmed / lowercased).
 *
 * The rule (pure; the store does the one existence read):
 *   1. A typed slug that EXACTLY matches an existing row is kept verbatim.
 *      Editing a legacy row (one saved before this rule, e.g. "phat panda")
 *      keeps updating THAT row instead of silently forking a new dashed one.
 *      Repairing legacy rows is a separate, owner-reviewed step (report:
 *      scripts/recon/kb-slug-drift-report.sql).
 *   2. Otherwise the slug is dashedSlug(typed || fallback name): the same
 *      function the writer, retrieval and the identity core use.
 *   3. Nothing usable (blank, or only punctuation) -> refused with a reason;
 *      never a guessed slug.
 *
 * kb_strains is deliberately NOT here: its slug is SPACED by design
 * (slug-core strainSlug; F-031/F-044/F-053), and the strain form already
 * uses strainSlug.
 *
 * Pure: imports only slug-core. Embedded self-tests at the bottom
 * (registered in scripts/compliance/run-pure-selftests.ts with an exact floor).
 */
import { dashedSlug } from "@/lib/catalog/slug-core";

/** The tables this rule governs (all dashed-keyed). */
export const DASHED_KB_SLUG_TABLES = ["kb_brands", "kb_product_categories", "kb_faqs"] as const;
export type DashedKbSlugTable = (typeof DASHED_KB_SLUG_TABLES)[number];

export type KbSlugPlan =
  | { ok: true; slug: string; via: "existing_exact" | "typed_dashed" | "name_dashed"; changed: boolean }
  | { ok: false; reason: string };

/** The trimmed text a person typed into the slug box ("" when blank). */
export function typedSlugText(typed: string | null | undefined): string {
  return String(typed ?? "").trim();
}

/**
 * Plan the slug to WRITE. `existingExact` = a row already exists whose slug
 * equals typedSlugText(typed) exactly (the store reads this; false when
 * nothing was typed).
 */
export function planKbSlug(input: {
  typed: string | null | undefined;
  fallbackName?: string | null | undefined;
  existingExact: boolean;
}): KbSlugPlan {
  const typed = typedSlugText(input.typed);
  if (typed && input.existingExact) {
    return { ok: true, slug: typed, via: "existing_exact", changed: false };
  }
  if (typed) {
    const slug = dashedSlug(typed);
    if (!slug) {
      return { ok: false, reason: `The slug "${typed}" has no letters or numbers in it. Use letters, numbers and dashes, like "phat-panda".` };
    }
    return { ok: true, slug, via: "typed_dashed", changed: slug !== typed };
  }
  const slug = dashedSlug(input.fallbackName);
  if (!slug) {
    return { ok: false, reason: "Please enter a name with at least one letter or number." };
  }
  return { ok: true, slug, via: "name_dashed", changed: false };
}

/** True when a stored slug is not in the dashed form (a drift row). */
export function isDashedDrift(slug: string | null | undefined): boolean {
  const s = String(slug ?? "");
  return s !== dashedSlug(s);
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runKbSlugInputCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL kb-slug-input-core: ${msg}`);
    }
  };
  const eq = (msg: string, got: unknown, want: unknown) =>
    ok(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

  // name-derived (blank slug box)
  eq("name: multi-word brand is dashed", planKbSlug({ typed: "", fallbackName: "Phat Panda", existingExact: false }), { ok: true, slug: "phat-panda", via: "name_dashed", changed: false });
  eq("name: null typed", planKbSlug({ typed: null, fallbackName: "Phat Panda", existingExact: false }), { ok: true, slug: "phat-panda", via: "name_dashed", changed: false });
  eq("name: whitespace-only typed counts as blank", planKbSlug({ typed: "   ", fallbackName: "Phat Panda", existingExact: true }), { ok: true, slug: "phat-panda", via: "name_dashed", changed: false });
  eq("name: punctuation + ampersand", planKbSlug({ typed: "", fallbackName: "  Fifty-Fold & Co.  ", existingExact: false }), { ok: true, slug: "fifty-fold-co", via: "name_dashed", changed: false });
  eq("name: apostrophe", planKbSlug({ typed: "", fallbackName: "Mfused's Best", existingExact: false }), { ok: true, slug: "mfused-s-best", via: "name_dashed", changed: false });
  eq("name: accents become a dash (same as the writer)", planKbSlug({ typed: "", fallbackName: "Café Kush", existingExact: false }), { ok: true, slug: "caf-kush", via: "name_dashed", changed: false });
  eq("name: underscores dashed", planKbSlug({ typed: "", fallbackName: "sea_side farms", existingExact: false }), { ok: true, slug: "sea-side-farms", via: "name_dashed", changed: false });
  eq("name: digits kept", planKbSlug({ typed: "", fallbackName: "2 Blunt Bros", existingExact: false }), { ok: true, slug: "2-blunt-bros", via: "name_dashed", changed: false });
  ok(!planKbSlug({ typed: "", fallbackName: "", existingExact: false }).ok, "name: blank refused");
  ok(!planKbSlug({ typed: "", fallbackName: null, existingExact: false }).ok, "name: null refused");
  ok(!planKbSlug({ typed: "", fallbackName: " -- !! ", existingExact: false }).ok, "name: punctuation-only refused");
  ok(!planKbSlug({ typed: "", fallbackName: undefined, existingExact: false }).ok, "name: undefined refused");

  // typed slug, no existing row
  eq("typed: spaced becomes dashed", planKbSlug({ typed: "phat panda", fallbackName: "X", existingExact: false }), { ok: true, slug: "phat-panda", via: "typed_dashed", changed: true });
  eq("typed: case folded", planKbSlug({ typed: "Phat-Panda", fallbackName: "X", existingExact: false }), { ok: true, slug: "phat-panda", via: "typed_dashed", changed: true });
  eq("typed: already dashed is unchanged", planKbSlug({ typed: "phat-panda", fallbackName: "X", existingExact: false }), { ok: true, slug: "phat-panda", via: "typed_dashed", changed: false });
  eq("typed: trimmed before compare", planKbSlug({ typed: "  phat-panda  ", fallbackName: "X", existingExact: false }), { ok: true, slug: "phat-panda", via: "typed_dashed", changed: false });
  eq("typed: double dash collapsed", planKbSlug({ typed: "phat--panda", fallbackName: "X", existingExact: false }), { ok: true, slug: "phat-panda", via: "typed_dashed", changed: true });
  eq("typed: edge dashes stripped", planKbSlug({ typed: "-phat-panda-", fallbackName: "X", existingExact: false }), { ok: true, slug: "phat-panda", via: "typed_dashed", changed: true });
  eq("typed: wins over the name", planKbSlug({ typed: "pp", fallbackName: "Phat Panda", existingExact: false }), { ok: true, slug: "pp", via: "typed_dashed", changed: false });
  eq("typed: seeded category slug is a fixed point", planKbSlug({ typed: "edible-gummies", fallbackName: "Gummies", existingExact: false }), { ok: true, slug: "edible-gummies", via: "typed_dashed", changed: false });
  eq("typed: seeded faq slug is a fixed point", planKbSlug({ typed: "store-hours", existingExact: false }), { ok: true, slug: "store-hours", via: "typed_dashed", changed: false });
  ok(!planKbSlug({ typed: "!!!", fallbackName: "Phat Panda", existingExact: false }).ok, "typed: punctuation-only refused (never silently the name)");
  ok(/letters, numbers and dashes/.test((planKbSlug({ typed: "!!!", existingExact: false }) as { reason: string }).reason ?? ""), "typed: refusal explains the rule");

  // legacy exact match
  eq("legacy: exact spaced row kept verbatim", planKbSlug({ typed: "phat panda", fallbackName: "Phat Panda", existingExact: true }), { ok: true, slug: "phat panda", via: "existing_exact", changed: false });
  eq("legacy: exact trimmed match kept", planKbSlug({ typed: "  Old Brand ", existingExact: true }), { ok: true, slug: "Old Brand", via: "existing_exact", changed: false });
  eq("legacy: dashed existing is still exact", planKbSlug({ typed: "phat-panda", existingExact: true }), { ok: true, slug: "phat-panda", via: "existing_exact", changed: false });

  // drift detector
  ok(isDashedDrift("phat panda"), "drift: spaced");
  ok(isDashedDrift("Phat-Panda"), "drift: uppercase");
  ok(isDashedDrift("phat-panda-"), "drift: trailing dash");
  ok(isDashedDrift(" phat-panda"), "drift: leading space");
  ok(!isDashedDrift("phat-panda"), "drift: clean");
  ok(!isDashedDrift("2-blunt-bros"), "drift: digits clean");
  ok(!isDashedDrift(""), "drift: empty is not drift");
  ok(!isDashedDrift(null), "drift: null is not drift");

  // the governed tables
  eq("tables", [...DASHED_KB_SLUG_TABLES], ["kb_brands", "kb_product_categories", "kb_faqs"]);
  ok(!(DASHED_KB_SLUG_TABLES as readonly string[]).includes("kb_strains"), "kb_strains stays SPACED (not governed)");
  eq("typedSlugText trims", typedSlugText("  a b  "), "a b");
  eq("typedSlugText null", typedSlugText(null), "");

  return { passed, failed };
}
