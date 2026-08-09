/**
 * src/lib/enrichment/lookup-query-core.ts
 *
 * PURE helper for the enrichment-page AI look-up (Gemini). Builds the sharpened
 * default search query from what we ALREADY know about a POS product — name,
 * brand, category, and (when present) the strain name. A more specific query
 * gets a better first hit from Google `google_search` grounding, so we fold in
 * the safe, always-string facts instead of just the bare name+brand the
 * onboarding panel uses.
 *
 * Deterministic + dependency-free so it can be self-tested without a network,
 * a database, or the AI provider.
 */

/** The known product facts we can safely fold into a search query. */
export type EnrichmentLookupFacts = {
  name: string | null | undefined;
  brand: string | null | undefined;
  category: string | null | undefined;
  strainName?: string | null | undefined;
};

function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Build the pre-filled look-up query. Order: brand → name → strain → category,
 * skipping blanks and de-duplicating case-insensitively (so a strain that
 * repeats the name, or a category already implied by the name, doesn't bloat
 * the query). Never returns an empty string — falls back to a safe generic.
 */
export function buildEnrichmentLookupQuery(facts: EnrichmentLookupFacts): string {
  const parts = [clean(facts.brand), clean(facts.name), clean(facts.strainName), clean(facts.category)];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const low = p.toLowerCase();
    // Skip a token that's already fully contained in what we've kept so far
    // (e.g. strain "Blue Dream" when the name is "Blue Dream 3.5g").
    const already = kept.some(
      (k) => k.toLowerCase() === low || k.toLowerCase().includes(low),
    );
    if (already || seen.has(low)) continue;
    seen.add(low);
    kept.push(p);
  }
  const q = kept.join(" ").trim();
  return q || "cannabis product";
}

/** Self-tests. Bare console.log is allowed in these self-test core files. */
export function __runEnrichmentLookupQueryCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`FAIL lookup-query-core: ${label}`);
    }
  };

  ok(
    buildEnrichmentLookupQuery({ name: "Grape Gas 3.5g", brand: "Phat Panda", category: "Flower" }) ===
      "Phat Panda Grape Gas 3.5g Flower",
    "brand + name + category, in order",
  );
  ok(
    buildEnrichmentLookupQuery({ name: "Blue Dream", brand: "", category: "" }) === "Blue Dream",
    "name only when brand/category blank",
  );
  ok(
    buildEnrichmentLookupQuery({
      name: "Blue Dream 3.5g",
      brand: "Acme",
      category: "Flower",
      strainName: "Blue Dream",
    }) === "Acme Blue Dream 3.5g Flower",
    "strain already inside name is dropped (no dup)",
  );
  ok(
    buildEnrichmentLookupQuery({ name: "", brand: "", category: "" }) === "cannabis product",
    "blank everything → safe generic",
  );
  ok(
    buildEnrichmentLookupQuery({ name: "  Gelato  ", brand: "  ", category: " Flower " }) ===
      "Gelato Flower",
    "whitespace collapsed / trimmed",
  );
  ok(
    buildEnrichmentLookupQuery({
      name: "Gummies",
      brand: "Wyld",
      category: "Edible",
      strainName: "Marionberry",
    }) === "Wyld Gummies Marionberry Edible",
    "edible with distinct strain keeps all four",
  );

  if (fail > 0) throw new Error(`lookup-query-core self-tests: ${fail} failed, ${pass} passed`);
  console.log(`lookup-query-core self-tests: ${pass} passed`);
}
