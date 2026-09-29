/**
 * src/lib/syndication/strain-placeholder-core.ts  (SLICE L-52)
 *
 * ONE LIST OF "THIS IS NOT A STRAIN" WORDS, SHARED BY EVERY WRITER.
 *
 * FIELD EVIDENCE. The owner's Leafly sandbox menu, read back on 2026-09-29,
 * held thirteen products whose strain Leafly had stored as a placeholder:
 *
 *     "No Strain"      x7   (Just The Tip, Greenway Pipe $8, Pastime Brand
 *                            Battery, royal blunt wrap horchata, Cone Filler,
 *                            Glass Tip, Lookah Load)
 *     "Paraphernalia"  x5   (High Hemp Blunt Wrap, RAW Roll Caddy, Greenway
 *                            Marijuana Pipe $5, ~EO Vapes Butter Knife,
 *                            Karma Hemp Wraps)
 *     "Mixed"          x1   (A.C. Topical Drops ... Trade Sample)
 *
 * Leafly's certification checklist grades exactly this. Verbatim from
 * docs/leafly-specs/menu-integration-v2.openapi.json (info.description):
 *
 *     "Strains: If strain information is absent the value `null` should be
 *      submitted rather than "NA" or other placeholder value ..."
 *     "Item Field Validation: ... Strain values are set to `null` when absent"
 *
 * The Leafly builder (`payload-core.ts`) sent the POS text through untouched,
 * because its only test was "is the string non-empty". A placeholder is
 * non-empty. So "No Strain" went out as a strain, and Leafly's strain matcher
 * is free to link it to whatever strain page it likes.
 *
 * WHY A SHARED CORE AND NOT A SECOND COPY
 * ---------------------------------------
 * The repo ALREADY knew this list. `src/lib/pos/missing-product-master-core.ts`
 * had it as a private constant, grounded in docs/CULTIVERA_PRODUCT_UPLOAD.md
 * ("generic placeholders (`No Strain`, `Mixed`, `Assorted`, `Paraphernalia`)
 * are stripped"). The Leafly builder simply never used it. Retyping the list
 * in payload-core would create two lists that drift; the next placeholder the
 * POS invents would get added to one and not the other. So the list moves
 * here, both callers import it, and a compliance test asserts neither of them
 * carries its own copy.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not "fix" a strain, guess one from the product name, or map a
 * nickname to a canonical name. A placeholder becomes null -- the value
 * Leafly asks for -- and nothing else changes. Real strain names, however
 * odd ("Watermelon Yuzu Dragon fruit", "Carbon Fiber"), pass through exactly.
 *
 * Pure: no I/O, no server-only import, so both a server module and a client
 * bundle can use it and CI can prove it without a database.
 */

/**
 * Lower-cased, trimmed placeholder values. The first nine are the list that
 * already existed in missing-product-master-core (byte-for-byte, so moving it
 * changes nothing for that caller). The remainder are spelling variants of
 * the SAME placeholders -- "N/A" written with a space or a period, "No
 * Strains", "Not Applicable" -- each of which carries no strain information
 * by definition. No real strain on Leafly's strain database is spelled like
 * any of these.
 */
export const PLACEHOLDER_STRAINS: ReadonlySet<string> = new Set([
  // --- the pre-existing list (missing-product-master-core.ts, unchanged) ---
  "",
  "n/a",
  "na",
  "none",
  "no strain",
  "mixed",
  "assorted",
  "paraphernalia",
  "unknown",
  // --- spelling variants of the same placeholders ---------------------------
  "n.a.",
  "n / a",
  "no strains",
  "not applicable",
  "-",
  "--",
]);

/**
 * Is this strain text really "no strain"?
 *
 * Case- and whitespace-insensitive, because the POS types these by hand and
 * "No Strain", "NO STRAIN" and " no strain " are the same statement. Internal
 * runs of whitespace are collapsed for the same reason. `null`/`undefined`
 * count as placeholders: there is nothing there either.
 */
export function isPlaceholderStrain(value: string | null | undefined): boolean {
  if (value == null) return true;
  const key = String(value).trim().replace(/\s+/g, " ").toLowerCase();
  return PLACEHOLDER_STRAINS.has(key);
}

/**
 * The strain to publish: the trimmed text, or null when it is absent or a
 * placeholder. This is what Leafly's `strain` field should receive.
 */
export function meaningfulStrainOrNull(value: string | null | undefined): string | null {
  if (isPlaceholderStrain(value)) return null;
  return String(value).trim();
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runStrainPlaceholderTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[strain-placeholder] FAIL: ${name}`);
    }
  };

  // The exact strings found on the owner's live Leafly menu.
  check("'No Strain' is a placeholder (7 live items)", meaningfulStrainOrNull("No Strain") === null);
  check("'Paraphernalia' is a placeholder (5 live items)", meaningfulStrainOrNull("Paraphernalia") === null);
  check("'Mixed' is a placeholder (1 live item)", meaningfulStrainOrNull("Mixed") === null);

  // The rest of the pre-existing list.
  for (const s of ["N/A", "NA", "None", "Assorted", "Unknown", "", "   "]) {
    check(`'${s}' is a placeholder`, isPlaceholderStrain(s));
  }
  // Variants.
  for (const s of ["n.a.", "N / A", "No Strains", "Not Applicable", "-", "--", "NO   STRAIN", " no strain "]) {
    check(`variant '${s}' is a placeholder`, isPlaceholderStrain(s));
  }
  check("null is a placeholder", isPlaceholderStrain(null));
  check("undefined is a placeholder", isPlaceholderStrain(undefined));
  check("null yields null", meaningfulStrainOrNull(null) === null);

  // NEGATIVE CONTROLS -- real strain names from the same live menu must pass
  // through byte-for-byte. A placeholder filter that eats real strains is
  // worse than the bug: it would null out the whole menu's strain links.
  for (const s of [
    "Blue Dream",
    "Watermelon Yuzu Dragon fruit",
    "Carbon Fiber",
    "Guava",
    "Lemon Meringue",
    "GG4",
    "Original Glue",
    "The Glue",
    "Mixed Berry", // contains a placeholder word, is not one
    "Unknown Kush", // same
    "NA Haze", // same
  ]) {
    check(`real strain '${s}' passes through`, meaningfulStrainOrNull(s) === s);
  }
  check("real strains are trimmed, not altered", meaningfulStrainOrNull("  Blue Dream  ") === "Blue Dream");
  check("internal spacing of a real strain is preserved", meaningfulStrainOrNull("Blue  Dream") === "Blue  Dream");

  // The pre-existing nine must all still be present (the move must not drop one).
  for (const s of ["", "n/a", "na", "none", "no strain", "mixed", "assorted", "paraphernalia", "unknown"]) {
    check(`pre-existing entry '${s}' retained`, PLACEHOLDER_STRAINS.has(s));
  }

  return { passed, failed };
}
