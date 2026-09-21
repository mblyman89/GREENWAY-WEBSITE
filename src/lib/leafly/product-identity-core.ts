/**
 * PRODUCT IDENTITY -- how a human tells one product from another.
 *
 * ###########################################################################
 * # WHY THIS FILE EXISTS                                                    #
 * #                                                                         #
 * # The owner, verbatim:                                                    #
 * #                                                                         #
 * #   "i don't understand product ids, nor are they a useful way to         #
 * #    identify products for the delete function, as well as the error      #
 * #    messages and fix messages and such, they should not be the product   #
 * #    id, but the names of the product, the barcode, vendor perhaps, just  #
 * #    far more ways to identify the products we actually need to get off   #
 * #    the menu."                                                           #
 * #                                                                         #
 * # He is right, and the reason the system speaks in ids is not that the    #
 * # human data is missing. It is that nothing ever carried it this far.     #
 * ###########################################################################
 *
 * WHAT IS ACTUALLY AVAILABLE (verified against the real schema, not assumed)
 *
 *   supabase/migrations/0002_slice2_pos_import.sql:105-138  `menu_items`
 *     source_item_id, name, product_name, brand_name, vendor_name (INDEXED,
 *     line 136), category, strain_name, price_label, hidden
 *
 *   supabase/migrations/0002_slice2_pos_import.sql:141-152  `menu_variants`
 *     source_variant_id, label, price_minor_units, inventory_level
 *
 *   supabase/migrations/0023_pos_inventory_lots.sql:85-118  `inventory_lots`
 *     lot_code, pos_product_key  -- joined on
 *     inventory_lots.pos_product_key = menu_items.source_item_id (line 95)
 *
 * THE BARCODE QUESTION, ANSWERED HONESTLY.
 *
 * There is NO barcode column on `menu_items`. `barcode` exists only on
 * `noncannabis_products` (0111_noncannabis_inventory_ops.sql:36). For cannabis
 * product the Cultivera barcode is stored as `inventory_lots.lot_code`, and
 * `src/lib/pos/import-lot-core.ts:18-21` records the verified fact from the
 * real 3,917-row export:
 *
 *   "Barcode is ALWAYS populated (e.g. "GF42802505795142") and is the
 *    identifier Cultivera (a CCRS integrator) filed with CCRS -- 3,870 unique
 *    values; 47 barcodes appear twice (same product, two received dates)."
 *
 * So a barcode IS obtainable, via a join, and this module models it as
 * OPTIONAL and POSSIBLY-PLURAL because that is what the data actually is. A
 * product with two received dates genuinely has two barcodes, and collapsing
 * them to one would be a lie told for tidiness.
 *
 * WHAT THIS MODULE REFUSES TO DO
 *
 * It never invents an identifier. A product with no vendor recorded is
 * described without a vendor, not with "Unknown Vendor" -- a fabricated
 * identifier is worse than an absent one, because the owner would search for
 * it. Absence is reported as absence (see `identityCompleteness`).
 *
 * It also never drops the id. The id is how the machine talks to Leafly, and
 * a fix link, a delete call and a support conversation all need it. The change
 * is one of ORDER and EMPHASIS: humans lead, the id becomes a parenthetical.
 *
 * PURE: no React, no DOM, no I/O, no `server-only`. Zero imports. Runs under
 * tsx directly.
 */

/* -------------------------------------------------------------------------- */
/* The identity record                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything we can honestly say about which product this is.
 *
 * Every human field is nullable BECAUSE THE COLUMN IS NULLABLE. `vendor_name`
 * and `strain_name` are `text` with no NOT NULL and no default
 * (0002_slice2_pos_import.sql:112, 118); `brand_name` is `not null default ''`
 * (line 111), so an empty string is the real "absent" value there and is
 * normalised to null on the way in.
 */
export type ProductIdentity = {
  /** `menu_items.source_item_id` -- the `pos-...` key. Never omitted. */
  id: string;
  /** `menu_items.name` -- the card name shown on our own menu. */
  name: string | null;
  /**
   * `menu_items.product_name` -- the RAW Cultivera product cell.
   *
   * Kept separate from `name` deliberately. `name` has been cleaned and
   * grouped by the transform; `product_name` is what the owner will actually
   * recognise from Cultivera, junk and all. When the two differ, showing both
   * is how somebody matches our card back to their POS.
   */
  productName: string | null;
  brand: string | null;
  vendor: string | null;
  category: string | null;
  strainName: string | null;
  /**
   * Cultivera barcodes for this product, from `inventory_lots.lot_code`.
   *
   * Plural and possibly empty. Empty means no lot has been recorded against
   * this product key -- NOT that the product has no barcode. Those are
   * different facts and the wording downstream must not conflate them.
   */
  barcodes: string[];
};

/** One size of a product, in human terms. */
export type VariantIdentity = {
  /** `menu_variants.source_variant_id` -- the `pos-...-...` key. */
  id: string;
  /**
   * `menu_variants.label` -- e.g. "1g", "3.5g", "10pk", "each".
   *
   * THIS IS THE FIELD THE OWNER HAS NEVER BEEN SHOWN. It exists on every
   * variant, it is what distinguishes one size from another in our system, and
   * it is not part of the Leafly variant schema, so it never appeared in a
   * Leafly error. FINDING J-1 turns on it: the labels behind the 124 errors
   * were "1g", "3g" and "5g" -- clean data, invisible to the owner.
   */
  label: string | null;
  priceMinorUnits: number | null;
};

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Trim, collapse inner whitespace, and treat blank as absent.
 *
 * Blank-as-absent matters because `brand_name` defaults to `''`. Rendering
 * "Brand: " with nothing after it looks like a rendering bug and sends the
 * owner looking for a problem that is not there.
 */
export function cleanIdentityField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/**
 * Normalise a list of barcodes: clean each, drop blanks, de-duplicate,
 * preserve first-seen order.
 *
 * Order is preserved rather than sorted because the caller supplies them in
 * received-date order, and the first one is the oldest lot -- which is the one
 * a FIFO shop is most likely to be holding.
 */
export function cleanBarcodes(values: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const cleaned = cleanIdentityField(raw);
    if (cleaned === null) continue;
    const key = cleaned.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** Build a `ProductIdentity` from raw row values, normalising as it goes. */
export function makeProductIdentity(input: {
  id: string;
  name?: string | null;
  productName?: string | null;
  brand?: string | null;
  vendor?: string | null;
  category?: string | null;
  strainName?: string | null;
  barcodes?: readonly (string | null | undefined)[] | null;
}): ProductIdentity {
  return {
    id: String(input.id ?? "").trim(),
    name: cleanIdentityField(input.name),
    productName: cleanIdentityField(input.productName),
    brand: cleanIdentityField(input.brand),
    vendor: cleanIdentityField(input.vendor),
    category: cleanIdentityField(input.category),
    strainName: cleanIdentityField(input.strainName),
    barcodes: cleanBarcodes(input.barcodes),
  };
}

/* -------------------------------------------------------------------------- */
/* Describing a product to a human                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shortest phrase that identifies this product to the owner.
 *
 * Order is chosen for RECOGNITION, not for completeness:
 *   brand first (he buys by brand), then the product name, then the size.
 *
 * Falls back through productName -> id, so this NEVER returns an empty string.
 * A message that renders as "" is worse than one that renders as an id.
 */
export function shortProductLabel(identity: ProductIdentity): string {
  const name = identity.name ?? identity.productName;
  if (name === null) return identity.id.length > 0 ? identity.id : "(unidentified product)";
  return identity.brand !== null ? `${identity.brand} ${name}` : name;
}

/**
 * The full human description, with the id demoted to a parenthetical.
 *
 * This is the shape every owner-facing message should use. The id stays
 * because a fix link and a delete call both need it and because the owner may
 * have to quote it to Leafly support -- but it is now the LAST thing read, not
 * the first and only.
 *
 * Example output:
 *   Ceres Dragon Balm CBD RED - 3g - vendor Ceres Garden - barcode GF42802505795142 (pos-45c6...)
 */
export function describeProductIdentity(
  identity: ProductIdentity,
  opts?: { size?: string | null; includeId?: boolean; maxBarcodes?: number },
): string {
  const parts: string[] = [];

  const headline = shortProductLabel(identity);
  parts.push(headline);

  const size = cleanIdentityField(opts?.size);
  if (size !== null) parts.push(size);

  // Only show the raw Cultivera cell when it actually differs from the cleaned
  // name. Showing "Blue Dream / Blue Dream" is noise, and noise is how a
  // message stops being read.
  if (
    identity.productName !== null &&
    identity.name !== null &&
    identity.productName.toLowerCase() !== identity.name.toLowerCase()
  ) {
    parts.push(`Cultivera name "${identity.productName}"`);
  }

  if (identity.vendor !== null) parts.push(`vendor ${identity.vendor}`);
  if (identity.strainName !== null) parts.push(`strain ${identity.strainName}`);

  const maxBarcodes = Math.max(0, Math.floor(opts?.maxBarcodes ?? 2));
  if (identity.barcodes.length > 0 && maxBarcodes > 0) {
    const shown = identity.barcodes.slice(0, maxBarcodes);
    const more = identity.barcodes.length - shown.length;
    const word = shown.length === 1 ? "barcode" : "barcodes";
    parts.push(more > 0 ? `${word} ${shown.join(", ")} +${more} more` : `${word} ${shown.join(", ")}`);
  }

  const includeId = opts?.includeId ?? true;
  const body = parts.join(" - ");
  return includeId && identity.id.length > 0 ? `${body} (${identity.id})` : body;
}

/* -------------------------------------------------------------------------- */
/* Searching by anything a human knows                                        */
/* -------------------------------------------------------------------------- */

/** Lower-cased, whitespace-collapsed, for comparison only. */
function comparable(value: string | null): string {
  return value === null ? "" : value.toLowerCase();
}

/**
 * Every string a human might type to find this product.
 *
 * Includes the id on purpose: a searchable id costs nothing and someone
 * pasting one from a Leafly error should still find the row. What changes is
 * that the id is no longer the ONLY way in.
 */
export function identitySearchTerms(identity: ProductIdentity): string[] {
  const terms = [
    identity.id,
    identity.name,
    identity.productName,
    identity.brand,
    identity.vendor,
    identity.category,
    identity.strainName,
    ...identity.barcodes,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    const c = comparable(cleanIdentityField(t));
    if (c.length === 0 || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * Does this product match a free-text query?
 *
 * EVERY whitespace-separated token must match somewhere (AND, not OR). "ceres
 * balm" should find the Ceres Dragon Balm and NOT every product from Ceres
 * plus every balm in the shop. OR-matching on a 400-product menu returns
 * everything, which is the same as returning nothing.
 *
 * Substring rather than prefix, because a barcode is most often recognised by
 * its last digits and a product by a word in the middle of its name.
 *
 * An empty query matches everything -- an unfiltered list is the honest answer
 * to "no filter", and returning zero rows for an empty box reads as a bug.
 */
export function identityMatchesQuery(identity: ProductIdentity, query: string | null | undefined): boolean {
  const q = cleanIdentityField(query);
  if (q === null) return true;
  const tokens = q.toLowerCase().split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return true;
  const haystack = identitySearchTerms(identity);
  return tokens.every((token) => haystack.some((term) => term.includes(token)));
}

/* -------------------------------------------------------------------------- */
/* Honesty about what we do NOT know                                          */
/* -------------------------------------------------------------------------- */

export type IdentityCompleteness = {
  /** Fields we hold, from the set a human actually uses to recognise a product. */
  present: string[];
  /** Fields that are absent in the source data. */
  missing: string[];
  /** present / (present + missing), 0..100, rounded. */
  percent: number;
};

/**
 * Which human identifiers this product actually has.
 *
 * WHY THIS IS A FEATURE AND NOT A DIAGNOSTIC. The owner's stated goal is to
 * identify products without ids. When a product genuinely has no vendor and no
 * barcode, the honest answer is "we can only offer you the name" -- and saying
 * so tells him something true about his Cultivera data rather than leaving him
 * wondering why one row looks thinner than the others.
 *
 * `name` is deliberately excluded from the scored set: `menu_items.name` is
 * NOT NULL (0002_slice2_pos_import.sql:109), so scoring it would inflate every
 * product's score by a constant and measure nothing.
 */
export function identityCompleteness(identity: ProductIdentity): IdentityCompleteness {
  const checks: ReadonlyArray<[string, boolean]> = [
    ["brand", identity.brand !== null],
    ["vendor", identity.vendor !== null],
    ["category", identity.category !== null],
    ["strain", identity.strainName !== null],
    ["barcode", identity.barcodes.length > 0],
  ];
  const present: string[] = [];
  const missing: string[] = [];
  for (const [label, ok] of checks) (ok ? present : missing).push(label);
  const total = checks.length;
  return { present, missing, percent: total === 0 ? 0 : Math.round((present.length / total) * 100) };
}

/**
 * Plain-English note about missing identifiers, or `null` when nothing is
 * missing.
 *
 * Returning `null` rather than "nothing missing" is deliberate: a note that
 * appears on every row is furniture, and furniture is not read.
 */
export function describeIdentityGaps(identity: ProductIdentity): string | null {
  const { missing } = identityCompleteness(identity);
  if (missing.length === 0) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `No ${list} recorded for this product, so it can only be identified by name here.`;
}

/* -------------------------------------------------------------------------- */
/* The fix link                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The back-office page where this product can actually be corrected.
 *
 * VERIFIED, NOT GUESSED. `src/app/admin/products/[key]/page.tsx:53-66` takes
 * `params: Promise<{ key: string }>`, decodes it, and looks the product up with
 * `getItemBySourceKey(published.id, key)` -- i.e. the route segment IS
 * `menu_items.source_item_id`, which is exactly the id Leafly errors carry.
 *
 * Encoded because a POS key is free-form text from a third-party export and a
 * stray `/` or `#` would silently produce a 404 or a wrong page.
 */
export function productFixHref(productId: string): string | null {
  const id = String(productId ?? "").trim();
  if (id.length === 0) return null;
  return `/admin/products/${encodeURIComponent(id)}`;
}

/**
 * A variant id is `"<itemId>-<12 hex>"` (src/lib/pos/transform.ts:1044) and an
 * item id is `"pos-<12 hex>"` (transform.ts:1015). The fix page is keyed on the
 * ITEM, so a variant id must be reduced to its item before it can be linked.
 *
 * THE TRAP, AND WHY THE PATTERN LOOKS OVER-SPECIFIED.
 *
 * The obvious implementation -- strip a trailing `-[0-9a-f]{12}` -- is WRONG,
 * and the self-test below is what caught it. An ITEM id is *itself* `pos-` plus
 * twelve hex characters, so the obvious pattern happily reduces the perfectly
 * good item id `pos-45c6e282e0e8` to `pos`, and the owner's "fix this product"
 * button lands on a product that does not exist. That is precisely the
 * "link to the wrong product is worse than no link" failure this function was
 * written to avoid, committed by the function itself.
 *
 * So the suffix is stripped only when what REMAINS still has the shape of an
 * item id -- something, a hyphen, and twelve hex characters. A one-group id is
 * already an item id and is returned untouched.
 */
export function itemIdFromVariantId(variantId: string): string {
  const id = String(variantId ?? "").trim();
  const m = /^(.+-[0-9a-f]{12})-[0-9a-f]{12}$/.exec(id);
  return m !== null ? m[1] : id;
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflyProductIdentityTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  // ---- cleanIdentityField ----
  ok("clean trims", cleanIdentityField("  Blue Dream  ") === "Blue Dream");
  ok("clean collapses inner whitespace", cleanIdentityField("Blue   Dream") === "Blue Dream");
  ok("clean blank -> null", cleanIdentityField("   ") === null);
  ok("clean empty -> null", cleanIdentityField("") === null);
  ok("clean null -> null", cleanIdentityField(null) === null);
  ok("clean undefined -> null", cleanIdentityField(undefined) === null);
  ok("clean newlines collapse", cleanIdentityField("a\n\nb") === "a b");
  ok("clean tabs collapse", cleanIdentityField("a\t\tb") === "a b");
  ok("clean keeps interior punctuation", cleanIdentityField("1:1 Ratio") === "1:1 Ratio");

  // ---- cleanBarcodes ----
  ok("barcodes basic", cleanBarcodes(["GF1", "GF2"]).join(",") === "GF1,GF2");
  ok("barcodes drop blanks", cleanBarcodes(["GF1", "  ", null, undefined]).join(",") === "GF1");
  ok("barcodes dedupe", cleanBarcodes(["GF1", "GF1"]).join(",") === "GF1");
  ok("barcodes dedupe case-insensitively", cleanBarcodes(["gf1", "GF1"]).length === 1);
  ok("barcodes keep first-seen casing", cleanBarcodes(["gf1", "GF1"])[0] === "gf1");
  ok("barcodes preserve order (oldest lot first)", cleanBarcodes(["B", "A"]).join(",") === "B,A");
  ok("barcodes null input -> []", cleanBarcodes(null).length === 0);
  ok("barcodes undefined input -> []", cleanBarcodes(undefined).length === 0);
  ok("barcodes empty -> []", cleanBarcodes([]).length === 0);
  ok("barcodes trim each", cleanBarcodes([" GF1 "])[0] === "GF1");

  // ---- makeProductIdentity ----
  const full = makeProductIdentity({
    id: "pos-45c6e282e0e8",
    name: "Dragon Balm CBD RED",
    productName: "CERES DRAGON BALM CBD RED 3G",
    brand: "Ceres",
    vendor: "Ceres Garden",
    category: "topical",
    strainName: null,
    barcodes: ["GF42802505795142"],
  });
  ok("identity keeps id", full.id === "pos-45c6e282e0e8");
  ok("identity cleans name", full.name === "Dragon Balm CBD RED");
  ok("identity keeps raw cultivera name", full.productName === "CERES DRAGON BALM CBD RED 3G");
  ok("identity vendor", full.vendor === "Ceres Garden");
  ok("identity barcode carried", full.barcodes[0] === "GF42802505795142");
  ok("identity absent strain stays null", full.strainName === null);

  // brand_name is `not null default ''` -- blank must normalise to null.
  const blankBrand = makeProductIdentity({ id: "p1", name: "X", brand: "" });
  ok("empty brand becomes null (schema default is '')", blankBrand.brand === null);

  const bare = makeProductIdentity({ id: "p2" });
  ok("bare identity has null name", bare.name === null);
  ok("bare identity has empty barcodes", bare.barcodes.length === 0);

  // ---- shortProductLabel ----
  ok("short label leads with brand", shortProductLabel(full) === "Ceres Dragon Balm CBD RED");
  ok(
    "short label without brand is just the name",
    shortProductLabel(makeProductIdentity({ id: "p", name: "Blue Dream" })) === "Blue Dream",
  );
  ok(
    "short label falls back to cultivera name",
    shortProductLabel(makeProductIdentity({ id: "p", productName: "RAW CELL" })) === "RAW CELL",
  );
  ok("short label falls back to id", shortProductLabel(makeProductIdentity({ id: "pos-9" })) === "pos-9");
  ok(
    "short label never returns empty string",
    shortProductLabel(makeProductIdentity({ id: "" })).length > 0,
  );

  // ---- describeProductIdentity ----
  const desc = describeProductIdentity(full, { size: "3g" });
  ok("describe leads with a human name, not the id", desc.startsWith("Ceres Dragon Balm CBD RED"));
  ok("describe includes the size", desc.includes("3g"));
  ok("describe includes the vendor", desc.includes("vendor Ceres Garden"));
  ok("describe includes the barcode", desc.includes("GF42802505795142"));
  ok("describe still carries the id in parentheses", desc.includes("(pos-45c6e282e0e8)"));
  ok("describe puts the id LAST", desc.trim().endsWith("(pos-45c6e282e0e8)"));
  ok(
    "describe shows the raw cultivera name when it differs",
    desc.includes('Cultivera name "CERES DRAGON BALM CBD RED 3G"'),
  );

  const same = makeProductIdentity({ id: "p", name: "Blue Dream", productName: "blue dream" });
  ok(
    "describe omits the cultivera name when it only differs in case",
    !describeProductIdentity(same).includes("Cultivera name"),
  );

  ok(
    "describe can omit the id",
    !describeProductIdentity(full, { includeId: false }).includes("pos-45c6e282e0e8"),
  );
  ok(
    "describe with no size omits the size cleanly",
    !describeProductIdentity(full, { size: "  " }).includes(" -  - "),
  );

  const many = makeProductIdentity({ id: "p", name: "N", barcodes: ["A", "B", "C", "D"] });
  const manyText = describeProductIdentity(many, { maxBarcodes: 2 });
  ok("describe caps the barcode list", manyText.includes("A, B"));
  ok("describe reports how many more barcodes exist", manyText.includes("+2 more"));
  ok("describe pluralises barcodes", manyText.includes("barcodes A, B"));
  ok(
    "describe singularises one barcode",
    describeProductIdentity(makeProductIdentity({ id: "p", name: "N", barcodes: ["A"] })).includes("barcode A"),
  );
  ok(
    "describe maxBarcodes 0 shows none",
    !describeProductIdentity(many, { maxBarcodes: 0 }).includes("barcode"),
  );

  // ---- identitySearchTerms ----
  const terms = identitySearchTerms(full);
  ok("search terms include the vendor", terms.includes("ceres garden"));
  ok("search terms include the barcode", terms.includes("gf42802505795142"));
  ok("search terms include the id", terms.includes("pos-45c6e282e0e8"));
  ok("search terms are lower-cased", terms.every((t) => t === t.toLowerCase()));
  ok("search terms are de-duplicated", new Set(terms).size === terms.length);
  ok("search terms drop absent fields", !terms.includes(""));

  // ---- identityMatchesQuery ----
  ok("match by product name", identityMatchesQuery(full, "dragon"));
  ok("match by vendor", identityMatchesQuery(full, "ceres garden"));
  ok("match by barcode", identityMatchesQuery(full, "GF42802505795142"));
  ok("match by barcode tail (how humans read them)", identityMatchesQuery(full, "795142"));
  ok("match by id still works", identityMatchesQuery(full, "pos-45c6e282e0e8"));
  ok("match is case-insensitive", identityMatchesQuery(full, "DRAGON"));
  ok("empty query matches everything", identityMatchesQuery(full, ""));
  ok("whitespace query matches everything", identityMatchesQuery(full, "   "));
  ok("null query matches everything", identityMatchesQuery(full, null));
  ok("non-matching query does not match", !identityMatchesQuery(full, "zkittlez"));

  // The AND-vs-OR decision, stated as a test because it is the whole point.
  const balmOther = makeProductIdentity({ id: "p9", name: "Healing Balm", brand: "Other Co" });
  ok("multi-token query requires ALL tokens (AND)", identityMatchesQuery(full, "ceres balm"));
  ok(
    "multi-token query does NOT match on one token alone (not OR)",
    !identityMatchesQuery(balmOther, "ceres balm"),
  );
  ok("tokens may match different fields", identityMatchesQuery(full, "ceres topical"));

  // ---- identityCompleteness ----
  const complete = identityCompleteness(full);
  ok("completeness finds vendor present", complete.present.includes("vendor"));
  ok("completeness finds strain missing", complete.missing.includes("strain"));
  ok("completeness percent is 4 of 5", complete.percent === 80);
  const nothing = identityCompleteness(makeProductIdentity({ id: "p", name: "N" }));
  ok("completeness of a bare product is 0", nothing.percent === 0);
  ok("completeness of a bare product lists all five as missing", nothing.missing.length === 5);
  ok(
    "name is NOT scored (it is NOT NULL, so it would measure nothing)",
    !complete.present.includes("name") && !complete.missing.includes("name"),
  );
  const everything = identityCompleteness(
    makeProductIdentity({ id: "p", name: "N", brand: "B", vendor: "V", category: "C", strainName: "S", barcodes: ["X"] }),
  );
  ok("completeness of a full product is 100", everything.percent === 100);
  ok("completeness of a full product has nothing missing", everything.missing.length === 0);

  // ---- describeIdentityGaps ----
  ok("gaps returns null when nothing is missing", describeIdentityGaps(
    makeProductIdentity({ id: "p", name: "N", brand: "B", vendor: "V", category: "C", strainName: "S", barcodes: ["X"] }),
  ) === null);
  const gapText = describeIdentityGaps(full);
  ok("gaps names the missing field", gapText !== null && gapText.includes("strain"));
  ok("gaps does not name a present field", gapText !== null && !gapText.includes("vendor"));
  const twoGaps = describeIdentityGaps(makeProductIdentity({ id: "p", name: "N", brand: "B", category: "C" }));
  ok("gaps joins two missing fields with 'and'", twoGaps !== null && twoGaps.includes("strain and barcode"));
  const oneGap = describeIdentityGaps(
    makeProductIdentity({ id: "p", name: "N", brand: "B", vendor: "V", category: "C", barcodes: ["X"] }),
  );
  // NOTE: the sentence itself contains a comma ("...this product, so..."), so
  // asserting "no comma anywhere" is a test bug, not a code requirement. What
  // actually matters is that a single missing field is not joined with "and".
  ok("gaps with one missing field names it", oneGap !== null && oneGap.startsWith("No strain recorded"));
  ok("gaps with one missing field does not use 'and'", oneGap !== null && !oneGap.includes(" and "));

  // ---- productFixHref ----
  ok("fix href points at the real route", productFixHref("pos-abc") === "/admin/products/pos-abc");
  ok("fix href encodes a slash", productFixHref("a/b") === "/admin/products/a%2Fb");
  ok("fix href encodes a hash", productFixHref("a#b") === "/admin/products/a%23b");
  ok("fix href of a blank id is null", productFixHref("   ") === null);
  ok("fix href of an empty id is null", productFixHref("") === null);

  // ---- itemIdFromVariantId ----
  // Real ids from the owner's own 124-error message.
  ok(
    "variant id reduces to its item id",
    itemIdFromVariantId("pos-45c6e282e0e8-cca24072824d") === "pos-45c6e282e0e8",
  );
  ok(
    "second real variant id reduces to the same item",
    itemIdFromVariantId("pos-45c6e282e0e8-00de6c9e8f2c") === "pos-45c6e282e0e8",
  );
  ok(
    "an item id passes through unchanged",
    itemIdFromVariantId("pos-45c6e282e0e8") === "pos-45c6e282e0e8",
  );
  ok(
    "a non-hex suffix is NOT stripped (never link to the wrong product)",
    itemIdFromVariantId("pos-abc-zzzzzzzzzzzz") === "pos-abc-zzzzzzzzzzzz",
  );
  ok(
    "a short suffix is NOT stripped",
    itemIdFromVariantId("pos-abc-cca240") === "pos-abc-cca240",
  );
  ok(
    "a 13-char suffix is NOT stripped",
    itemIdFromVariantId("pos-abc-cca24072824de") === "pos-abc-cca24072824de",
  );
  ok("uppercase hex is not stripped (transform emits lowercase)", itemIdFromVariantId("pos-abc-CCA24072824D") === "pos-abc-CCA24072824D");
  ok("blank variant id yields blank", itemIdFromVariantId("  ") === "");

  console.log(`leafly-product-identity: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
