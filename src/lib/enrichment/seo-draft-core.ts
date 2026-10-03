/**
 * src/lib/enrichment/seo-draft-core.ts - Round 23 (fix 4).
 *
 * Owner: "I would like an ai suggestion for the seo title and the seo meta
 * description in the product enrichment page."
 *
 * Pure rules for the product SEO draft: how long each part may be, how a
 * model reply is cleaned, how the pair is stored on ONE ai_suggestions row
 * (field_key "seo", compact JSON) and read back on accept, and which title /
 * description the public product page finally serves.
 *
 * Length rules (researched, not guessed):
 *  - Google Search Central ("Influencing title links"): there is no hard
 *    limit, but title links are truncated to fit the device width; write
 *    descriptive, concise, non-boilerplate titles, brand them concisely, and
 *    do not repeat the site name (Google may drop a duplicated site name).
 *    Common practice is <= ~60 characters (~600 px) for the WHOLE title.
 *  - The root layout applies `title.template = "%s | Greenway Marijuana"`,
 *    so the product part must leave room for that 21-character suffix:
 *    60 - 21 = 39 characters. A model that appends the site name itself is
 *    cleaned (otherwise the tab would read "... | Greenway Marijuana |
 *    Greenway Marijuana").
 *  - Meta descriptions: Google truncates snippets as needed; the widely used
 *    window is ~120-160 characters. We clamp to 160 at a word boundary and
 *    report a length hint so the person can see when a draft is short.
 */

export const SEO_SITE_SUFFIX = " | Greenway Marijuana";
export const SEO_FULL_TITLE_MAX = 60;
/** The part staff (or the model) writes; the layout appends the suffix. */
export const SEO_TITLE_MAX = SEO_FULL_TITLE_MAX - SEO_SITE_SUFFIX.length; // 39
export const SEO_META_MIN = 120;
export const SEO_META_MAX = 160;
export const SEO_FIELD_KEY = "seo";

const SITE_NAME_RE = /\s*[|\-\u2013\u2014:\u00b7]\s*greenway(?:\s+marijuana)?\s*$/i;

function squash(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** Cut to `max` at the last word boundary (never mid-word unless one word is longer than max). */
export function clampAtWord(value: string, max: number): string {
  const v = squash(value);
  if (v.length <= max) return v;
  const slice = v.slice(0, max + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : v.slice(0, max);
  return cut.replace(/[\s,;:\-\u2013\u2014|]+$/, "").trim();
}

/**
 * Clean a model (or typed) SEO title: collapse whitespace, strip wrapping
 * quotes, a trailing site name (the layout adds it) and a trailing period,
 * then clamp to the 39-character product part.
 */
export function cleanSeoTitle(raw: unknown): string {
  let t = squash(raw).replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "").trim();
  // Strip the site name repeatedly ("X | Greenway | Greenway Marijuana").
  for (let i = 0; i < 3 && SITE_NAME_RE.test(t); i++) t = t.replace(SITE_NAME_RE, "").trim();
  t = t.replace(/\.+$/, "").trim();
  return clampAtWord(t, SEO_TITLE_MAX);
}

/** Clean a meta description: collapse whitespace, strip wrapping quotes, clamp to 160 at a word. */
export function cleanSeoMeta(raw: unknown): string {
  const t = squash(raw).replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "").trim();
  if (t.length <= SEO_META_MAX) return t;
  const cut = clampAtWord(t, SEO_META_MAX - 1);
  return /[.!?]$/.test(cut) ? cut : `${cut}\u2026`;
}

export type SeoLengthHint = "empty" | "short" | "good" | "long";

/** Plain length hint for the meta description (120-160 is the target window). */
export function seoMetaHint(meta: string): SeoLengthHint {
  const n = squash(meta).length;
  if (n === 0) return "empty";
  if (n < SEO_META_MIN) return "short";
  if (n > SEO_META_MAX) return "long";
  return "good";
}

/** Plain words for each hint (the SEO field help line on the enrichment page). */
export const SEO_HINT_TEXT: Readonly<Record<SeoLengthHint, string>> = Object.freeze({
  empty: "empty",
  short: "a little short",
  good: "good",
  long: "Google will cut it",
});

/** The full title a browser tab / Google will see, given the product part. */
export function fullSeoTitle(part: string): string {
  const p = squash(part);
  return p ? `${p}${SEO_SITE_SUFFIX}` : "";
}

export interface SeoDraft {
  title: string;
  description: string;
}

/** Serialize the pair onto ONE suggestion row (field_key "seo"). null when either part is empty. */
export function seoSuggestionValue(draft: { title: unknown; description: unknown }): string | null {
  const title = cleanSeoTitle(draft.title);
  const description = cleanSeoMeta(draft.description);
  if (!title || !description) return null;
  return JSON.stringify({ seo_title: title, seo_description: description });
}

/** Read a stored "seo" suggestion back; re-cleans so a hand-edited row can never exceed the rules. */
export function parseSeoSuggestion(value: unknown): SeoDraft | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let o: unknown;
  try {
    o = JSON.parse(value);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const title = cleanSeoTitle(r.seo_title);
  const description = cleanSeoMeta(r.seo_description);
  if (!title || !description) return null;
  return { title, description };
}

/** How a pending "seo" suggestion reads on the page (title, then the description). */
export function seoSuggestionDisplay(value: unknown): string | null {
  const d = parseSeoSuggestion(value);
  if (!d) return null;
  return `Title: ${fullSeoTitle(d.title)}\nMeta description (${d.description.length} chars): ${d.description}`;
}

/**
 * Public product page metadata: a PUBLISHED enrichment's SEO title /
 * description win; otherwise the existing defaults stand. The title is the
 * product part only (the layout template adds the site name).
 */
export function productSeoMetadata(input: {
  enrichment: { status?: string | null; seo_title?: string | null; seo_description?: string | null } | null;
  defaultTitle: string;
  defaultDescription: string;
}): { title: string; description: string; fromEnrichment: { title: boolean; description: boolean } } {
  const e = input.enrichment && input.enrichment.status === "published" ? input.enrichment : null;
  const t = cleanSeoTitle(e?.seo_title);
  const d = squash(e?.seo_description);
  return {
    title: t || input.defaultTitle,
    description: d ? cleanSeoMeta(d) : input.defaultDescription,
    fromEnrichment: { title: Boolean(t), description: Boolean(d) },
  };
}

/** Facts line for the prompt (no price, no stock: Google + WA rules). */
export function seoPromptFacts(f: {
  name: string;
  brand?: string | null;
  category?: string | null;
  strainType?: string | null;
  description?: string | null;
  aroma?: readonly string[];
  flavor?: readonly string[];
}): string[] {
  const list = (xs?: readonly string[]) => (xs ?? []).map(squash).filter(Boolean).slice(0, 4).join(", ");
  return [
    `Product: ${squash(f.name)}`,
    squash(f.brand) ? `Brand: ${squash(f.brand)}` : null,
    squash(f.category) ? `Category: ${squash(f.category)}` : null,
    squash(f.strainType) && squash(f.strainType).toLowerCase() !== "unknown" ? `Strain type: ${squash(f.strainType)}` : null,
    list(f.aroma) ? `Aroma: ${list(f.aroma)}` : null,
    list(f.flavor) ? `Flavor: ${list(f.flavor)}` : null,
    squash(f.description) ? `Our description: ${clampAtWord(squash(f.description), 400)}` : null,
  ].filter((x): x is string => Boolean(x));
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runSeoDraftCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[seo-draft-core] FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

  // constants
  eq("suffix length", SEO_SITE_SUFFIX.length, 21);
  eq("title part max = 60 - 21", SEO_TITLE_MAX, 39);
  eq("meta window", [SEO_META_MIN, SEO_META_MAX], [120, 160]);

  // clampAtWord
  eq("clamp short unchanged", clampAtWord("  Banana   Cream ", 39), "Banana Cream");
  eq("clamp at word", clampAtWord("aaaa bbbb cccc", 11), "aaaa bbbb");
  eq("clamp exact boundary keeps word", clampAtWord("aaaa bbbb cccc", 9), "aaaa bbbb");
  eq("clamp single long word hard-cuts", clampAtWord("abcdefghij", 4), "abcd");
  eq("clamp strips dangling separator", clampAtWord("Banana Cream - Easy Peasy", 14), "Banana Cream");
  ok(clampAtWord("x ".repeat(100), 39).length <= 39, "clamp never exceeds max");

  // cleanSeoTitle
  eq("title strips site name (pipe)", cleanSeoTitle("Banana Cream Pie Flower | Greenway Marijuana"), "Banana Cream Pie Flower");
  eq("title strips site name (dash)", cleanSeoTitle("Banana Cream Pie - Greenway"), "Banana Cream Pie");
  eq("title strips site name (em dash, any case)", cleanSeoTitle("Banana Cream Pie \u2014 GREENWAY MARIJUANA"), "Banana Cream Pie");
  eq("title strips repeated site names", cleanSeoTitle("Pie | Greenway | Greenway Marijuana"), "Pie");
  eq("title strips quotes + period", cleanSeoTitle("\u201cBanana Cream Pie.\u201d"), "Banana Cream Pie");
  eq("title keeps a brand that merely contains greenway mid-text", cleanSeoTitle("Greenway Grown Pie"), "Greenway Grown Pie");
  ok(cleanSeoTitle("Easy Peasy Banana Cream Pie Hybrid Flower 28g Port Orchard").length <= SEO_TITLE_MAX, "title clamped to 39");
  eq("title non-string", cleanSeoTitle(42), "");

  // cleanSeoMeta
  const long = "Sweet banana and vanilla cream notes over a soft, smooth hybrid flower from Easy Peasy, grown in Washington and ready for pickup at Greenway in Port Orchard today.";
  ok(long.length > 160, "fixture is long");
  const m = cleanSeoMeta(long);
  ok(m.length <= 160, "meta clamped to <= 160");
  ok(m.endsWith("\u2026"), "meta cut mid-sentence gets an ellipsis");
  eq("meta short unchanged", cleanSeoMeta("  Sweet   banana. "), "Sweet banana.");
  eq("meta strips quotes", cleanSeoMeta("\"Sweet banana.\""), "Sweet banana.");
  eq("meta non-string", cleanSeoMeta(undefined), "");

  // hint
  eq("hint empty", seoMetaHint("  "), "empty");
  eq("hint short", seoMetaHint("x".repeat(119)), "short");
  eq("hint good low edge", seoMetaHint("x".repeat(120)), "good");
  eq("hint good high edge", seoMetaHint("x".repeat(160)), "good");
  eq("hint long", seoMetaHint("x".repeat(161)), "long");
  eq("hint words cover every hint", Object.keys(SEO_HINT_TEXT).sort(), ["empty", "good", "long", "short"]);

  // full title
  eq("full title", fullSeoTitle("Banana Cream Pie"), "Banana Cream Pie | Greenway Marijuana");
  eq("full title empty", fullSeoTitle(" "), "");
  ok(fullSeoTitle(cleanSeoTitle("y".repeat(80))).length <= 60, "cleaned title + suffix <= 60");

  // value round trip
  const v = seoSuggestionValue({ title: "Banana Cream Pie | Greenway Marijuana", description: "Sweet banana cream hybrid flower." });
  eq("value json", v, JSON.stringify({ seo_title: "Banana Cream Pie", seo_description: "Sweet banana cream hybrid flower." }));
  eq("value null when title empty", seoSuggestionValue({ title: " ", description: "x" }), null);
  eq("value null when description empty", seoSuggestionValue({ title: "x", description: null }), null);
  eq("parse round trip", parseSeoSuggestion(v), { title: "Banana Cream Pie", description: "Sweet banana cream hybrid flower." });
  eq("parse re-cleans a hand-edited long title", (parseSeoSuggestion(JSON.stringify({ seo_title: "z ".repeat(40), seo_description: "d" }))?.title.length ?? Infinity) <= SEO_TITLE_MAX, true);
  eq("parse bad json", parseSeoSuggestion("{nope"), null);
  eq("parse array", parseSeoSuggestion("[1]"), null);
  eq("parse missing part", parseSeoSuggestion(JSON.stringify({ seo_title: "x" })), null);
  eq("parse non-string", parseSeoSuggestion(null), null);
  eq(
    "display",
    seoSuggestionDisplay(v),
    "Title: Banana Cream Pie | Greenway Marijuana\nMeta description (33 chars): Sweet banana cream hybrid flower.",
  );
  eq("display invalid", seoSuggestionDisplay("x"), null);

  // public metadata
  const defs = { defaultTitle: "Pie \u2014 Easy", defaultDescription: "Default." };
  eq(
    "published enrichment wins",
    productSeoMetadata({ enrichment: { status: "published", seo_title: "Banana Cream Pie", seo_description: "Ours." }, ...defs }),
    { title: "Banana Cream Pie", description: "Ours.", fromEnrichment: { title: true, description: true } },
  );
  eq(
    "draft enrichment never reaches Google",
    productSeoMetadata({ enrichment: { status: "draft", seo_title: "Banana", seo_description: "Ours." }, ...defs }),
    { title: "Pie \u2014 Easy", description: "Default.", fromEnrichment: { title: false, description: false } },
  );
  eq(
    "blank fields fall back per field",
    productSeoMetadata({ enrichment: { status: "published", seo_title: "  ", seo_description: "Ours." }, ...defs }).title,
    "Pie \u2014 Easy",
  );
  eq(
    "published title with site name is cleaned (no double suffix)",
    productSeoMetadata({ enrichment: { status: "published", seo_title: "Pie | Greenway Marijuana", seo_description: null }, ...defs }).title,
    "Pie",
  );
  eq("no enrichment -> defaults", productSeoMetadata({ enrichment: null, ...defs }).description, "Default.");

  // prompt facts
  eq(
    "prompt facts",
    seoPromptFacts({ name: "Banana Cream Pie", brand: "Easy Peasy", category: "flower", strainType: "unknown", aroma: ["banana", " ", "cream"], flavor: [] }),
    ["Product: Banana Cream Pie", "Brand: Easy Peasy", "Category: flower", "Aroma: banana, cream"],
  );
  ok(!seoPromptFacts({ name: "x", description: "y".repeat(900) }).join(" ").includes("y".repeat(401)), "prompt description clamped");
  eq("prompt facts include strain type when known", seoPromptFacts({ name: "x", strainType: "Hybrid" })[1], "Strain type: Hybrid");

  return { passed, failed };
}
