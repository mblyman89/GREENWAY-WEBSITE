/**
 * src/lib/enrichment/gap-vector-core.ts   (Round 20, slice S23)
 *
 * "Per-field gap vector; boilerplate counts as missing; 'loud' missing fields."
 *
 * Before S23 the Enrichment screens knew four yes/no gaps (computeGaps:
 * description / image / brand link / tags), and `hasDescription` was TRUE
 * whenever the menu row carried ANY text - including the house placeholder
 * every intake card is born with ("<name> from <brand>. Browse current
 * availability, package options, and pricing at Greenway Marijuana in Port
 * Orchard."). So intake products always looked "described" (F-082 / F-064).
 *
 * This module holds every S23 DECISION. It is pure: no I/O, no environment reads,
 * no server-side imports. The servers only read rows and pass them in.
 *
 * WHAT EACH FIELD IS MEASURED FROM (verified against the code, not assumed)
 *
 *   description, short_description, image, brand_link, tags
 *       the card's SERVED enrichment row (S20) + its menu row - exactly what
 *       computeGaps measures, so the list counters and the detail header can
 *       never disagree. A boilerplate description (golden-record-core
 *       isBoilerplateDescription: the BOILERPLATE_TAIL every writer uses -
 *       transform.ts genericDescription, intake-mastering-core,
 *       draft-injection-core boilerplateDescription) is MISSING. There is no
 *       description_source column (verified), so template matching is the
 *       detection the bible allows ("via description_source or template
 *       match").
 *   effects, terpenes, aroma, flavor
 *       the KB ladder result (ProductKnowledge) - product_enrichments has no
 *       sensory columns, the ladder is the only place a card's sensory facts
 *       live.
 *   strain_type
 *       menu_items.strain_type through canonicalStrainType; 'unknown' is
 *       MISSING. Not applicable to topicals and non-cannabis items:
 *       transform.ts normalizeStrainType forces 'unknown' for them, so a
 *       "missing" there could never be fixed.
 *   lineage, category (confidence)
 *       NO menu / enrichment column carries either. The only evidence is a
 *       product_fact_provenance row (0235). With one -> filled (with its
 *       chip). Without one -> "unchecked" - this screen cannot see them, and
 *       saying "missing" would be a guess.
 *
 * PROVENANCE CHIPS ("Attached at onboarding")
 *   Only product_fact_provenance rows (written by the S07 attach door at
 *   onboarding) earn the "Attached at onboarding" wording, and only for a
 *   field that is filled NOW (a history row for a field whose value is gone
 *   must not claim anything is attached). Latest row per field wins
 *   (attach-facts-core latestByField). Stored confidence is 0..1; labels are
 *   factSourceLabel(source, confidence * 100) -> "Gemini 94%", "KB", "You".
 *   A filled field with no provenance is listed separately as "Also on file"
 *   with where it was found (Enrichment / Menu / the KB rung) - never
 *   presented as an onboarding attachment.
 */

import { isBoilerplateDescription } from "@/lib/catalog/golden-record-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { factSourceLabel } from "@/lib/catalog/fact-memory-core";
import { isFactSource, latestByField } from "@/lib/catalog/attach-facts-core";
import { isEmptyFactValue } from "@/lib/catalog/fact-attach-policy-core";

// --- 1. Vocabulary ----------------------------------------------------------------------

/**
 * Every field of the vector, in DISPLAY order (the bible S23.4 copy lists
 * "terpenes, image" and "description, effects, strain type" in this order).
 */
export const GAP_FIELDS = [
  "description",
  "short_description",
  "effects",
  "terpenes",
  "aroma",
  "flavor",
  "strain_type",
  "lineage",
  "image",
  "brand_link",
  "tags",
  "category",
] as const;
export type GapField = (typeof GAP_FIELDS)[number];

/** Plain-English names (the attach receipt's words where they exist). */
export const GAP_FIELD_LABEL: Readonly<Record<GapField, string>> = Object.freeze({
  description: "description",
  short_description: "short line",
  effects: "effects",
  terpenes: "terpenes",
  aroma: "aroma",
  flavor: "flavor",
  strain_type: "strain type",
  lineage: "lineage",
  image: "image",
  brand_link: "brand link",
  tags: "tags",
  category: "category confidence",
});

/**
 * The product_fact_provenance.field each vector field is recorded under
 * (attach-plan-core ATTACH_FIELDS / FIELD_POLICY names). brand_link and tags
 * are never written by the attach door, so they have no provenance field.
 */
export const PROVENANCE_FIELD_FOR: Readonly<Record<GapField, string | null>> = Object.freeze({
  description: "description",
  short_description: "short_description",
  effects: "effects",
  terpenes: "terpenes",
  aroma: "aroma",
  flavor: "flavor",
  strain_type: "strain_type",
  lineage: "lineage",
  image: "images",
  brand_link: null,
  tags: null,
  category: "category",
});

/** The provenance fields the server reads (named, de-duplicated, never "*"). */
export const GAP_PROVENANCE_FIELDS: readonly string[] = Object.freeze(
  [...new Set(GAP_FIELDS.map((f) => PROVENANCE_FIELD_FOR[f]).filter((f): f is string => f !== null))],
);

/** Bounded read: newest rows first; a product has at most a few per field. */
export const GAP_PROVENANCE_LIMIT = 200;

/** Named select for the provenance read (a subset of PROVENANCE_SELECT). */
export const GAP_PROVENANCE_SELECT = "field, value_json, source, confidence, created_at";

/** Categories with no cannabis facts at all (sample-product-type-core NON_CANNABIS_CATEGORIES). */
const NON_CANNABIS: ReadonlySet<string> = new Set(["paraphernalia", "accessories", "merch"]);
/** Categories transform.ts normalizeStrainType forces to 'unknown'. */
const NO_STRAIN_TYPE: ReadonlySet<string> = new Set(["topical", "paraphernalia", "accessories", "merch"]);

// --- 2. Shapes --------------------------------------------------------------------------

export type GapState = "filled" | "missing" | "not_applicable" | "unchecked";

/** Where a filled value was seen when no provenance row explains it. */
export type GapSeenIn = "enrichment" | "menu" | "kb" | "provenance" | null;

export interface GapEntry {
  field: GapField;
  label: string;
  state: GapState;
  /** The onboarding chip ("Gemini 94%") - set only from a provenance row on a filled field. */
  attachedBy: string | null;
  /** Where a filled value without provenance was found ("Enrichment", "Menu", "KB"). */
  seenIn: string | null;
  /**
   * A MISSING description the live menu still covers at display time from
   * the KB ladder (product-knowledge-display: KB copy is spliced in at
   * render). The card's own record is still missing it - it stays in the red
   * list - but the header says what customers see. null otherwise.
   */
  borrowedFrom: string | null;
}

export interface GapVector {
  entries: GapEntry[];
  missing: GapField[];
  /** Was the provenance trail read? false = chips unavailable (pre-0235, error, no identity). */
  provenanceRead: boolean;
}

/** The menu-row facts the vector needs (MenuItemRow subset). */
export interface GapItemInput {
  description: string | null;
  strain_type: string | null;
  category: string | null;
}

/** The served enrichment facts (ProductEnrichment subset). */
export interface GapEnrichmentInput {
  description: string | null;
  short_description: string | null;
  primary_media_id: string | null;
  image_media_ids: readonly string[] | null;
  brand_id: string | null;
  tags: readonly string[] | null;
}

/** The KB ladder facts (ProductKnowledge subset). */
export interface GapKnowledgeInput {
  source: string;
  /** The ladder's long copy (only used to say a missing description is borrowed). */
  description?: string | null;
  effects: readonly string[] | null;
  terpenes: readonly string[] | null;
  aromaNotes: readonly string[] | null;
  flavorNotes: readonly string[] | null;
}

/** One product_fact_provenance row as read (GAP_PROVENANCE_SELECT). */
export interface GapProvenanceRow {
  field: string;
  value_json: unknown;
  source: string;
  /** Stored 0..1, or null. */
  confidence: number | string | null;
  created_at: string;
}

export interface GapVectorInput {
  item: GapItemInput;
  enrichment: GapEnrichmentInput | null;
  knowledge: GapKnowledgeInput | null;
  /** null = the trail was not read (pre-0235, failed, no identity). [] = read, nothing on file. */
  provenance: readonly GapProvenanceRow[] | null;
}

// --- 3. Field tests ---------------------------------------------------------------------

/** A real (non-placeholder, non-blank) description. */
export function isRealDescription(text: string | null | undefined): boolean {
  return !isBoilerplateDescription(text);
}

/**
 * Where a card's real description lives: its enrichment row first (what the
 * menu overlays), then its own menu row. null = only boilerplate or nothing.
 * computeGaps' hasDescription is exactly `describedBy(...) !== null`.
 */
export function describedBy(
  enrichmentDescription: string | null | undefined,
  itemDescription: string | null | undefined,
): "enrichment" | "menu" | null {
  if (isRealDescription(enrichmentDescription)) return "enrichment";
  if (isRealDescription(itemDescription)) return "menu";
  return null;
}

function nonEmptyList(v: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim() !== "");
}

function text(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

function categoryOf(item: GapItemInput): string {
  return String(item.category ?? "").trim().toLowerCase();
}

/** Strain type applies to this card (cannabis, not a topical). */
export function strainTypeApplies(category: string | null | undefined): boolean {
  return !NO_STRAIN_TYPE.has(String(category ?? "").trim().toLowerCase());
}

/** A known strain type (canonicalStrainType !== 'unknown'). */
export function hasKnownStrainType(raw: string | null | undefined): boolean {
  return canonicalStrainType(raw) !== "unknown";
}

/** 0..1 stored confidence -> 0..100 for factSourceLabel; anything else -> null. */
export function confidencePct(stored: number | string | null | undefined): number | null {
  if (stored === null || stored === undefined || stored === "") return null;
  const n = typeof stored === "number" ? stored : Number(stored);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n * 100;
}

/** The latest valid provenance row per provenance field. */
export function latestProvenance(rows: readonly GapProvenanceRow[] | null | undefined): Map<string, GapProvenanceRow> {
  const valid = (rows ?? []).filter(
    (r) => r && typeof r.field === "string" && isFactSource(r.source) && !isEmptyFactValue(r.value_json),
  );
  const idx = latestByField(valid);
  const out = new Map<string, GapProvenanceRow>();
  for (const [field, i] of idx) out.set(field, valid[i]!);
  return out;
}

/** The chip for one provenance row ("Gemini 94%", "KB", "You"). */
export function provenanceChip(row: GapProvenanceRow): string {
  return factSourceLabel(row.source, confidencePct(row.confidence));
}

function kbLabel(source: string | null | undefined): string {
  const s = String(source ?? "");
  if (s === "kb-exact" || s === "kb-draft" || s === "enrichment" || s === "strain") return factSourceLabel("", null, s);
  return "KB";
}

// --- 4. The vector ----------------------------------------------------------------------

export function buildGapVector(input: GapVectorInput): GapVector {
  const { item, enrichment: e, knowledge: k } = input;
  const cat = categoryOf(item);
  const nonCannabis = NON_CANNABIS.has(cat);
  const prov = input.provenance === null ? null : latestProvenance(input.provenance);
  const provFor = (f: GapField): GapProvenanceRow | null => {
    const pf = PROVENANCE_FIELD_FOR[f];
    return pf && prov ? prov.get(pf) ?? null : null;
  };

  // [state, seenIn] per field.
  const measure = (f: GapField): [GapState, GapSeenIn] => {
    switch (f) {
      case "description": {
        const by = describedBy(e?.description, item.description);
        return by ? ["filled", by] : ["missing", null];
      }
      case "short_description":
        return text(e?.short_description) ? ["filled", "enrichment"] : ["missing", null];
      case "image": {
        // Same rule as computeGaps hasImage (the served row's own media), so
        // the list and this header agree; the live-image panel beside the
        // header already shows what the resolver serves as a fallback.
        if (e && (text(e.primary_media_id) || nonEmptyList(e.image_media_ids))) return ["filled", "enrichment"];
        return ["missing", null];
      }
      case "brand_link":
        return text(e?.brand_id) ? ["filled", "enrichment"] : ["missing", null];
      case "tags":
        return nonEmptyList(e?.tags) ? ["filled", "enrichment"] : ["missing", null];
      case "effects":
      case "terpenes":
      case "aroma":
      case "flavor": {
        if (nonCannabis) return ["not_applicable", null];
        const list =
          f === "effects" ? k?.effects : f === "terpenes" ? k?.terpenes : f === "aroma" ? k?.aromaNotes : k?.flavorNotes;
        return nonEmptyList(list ?? null) ? ["filled", "kb"] : ["missing", null];
      }
      case "strain_type":
        if (!strainTypeApplies(cat)) return ["not_applicable", null];
        return hasKnownStrainType(item.strain_type) ? ["filled", "menu"] : ["missing", null];
      case "lineage":
        if (nonCannabis) return ["not_applicable", null];
        return provFor(f) ? ["filled", "provenance"] : ["unchecked", null];
      case "category":
        return provFor(f) ? ["filled", "provenance"] : ["unchecked", null];
    }
  };

  const seenLabel = (s: GapSeenIn): string | null => {
    if (s === "enrichment") return "Enrichment";
    if (s === "menu") return "Menu";
    if (s === "kb") return kbLabel(k?.source);
    return null;
  };

  const entries: GapEntry[] = GAP_FIELDS.map((field) => {
    const [state, seen] = measure(field);
    const p = state === "filled" ? provFor(field) : null;
    return {
      field,
      label: GAP_FIELD_LABEL[field],
      state,
      attachedBy: p ? provenanceChip(p) : null,
      seenIn: state === "filled" && !p ? seenLabel(seen) : null,
      borrowedFrom:
        field === "description" && state === "missing" && k && k.source !== "none" && isRealDescription(k.description)
          ? kbLabel(k.source)
          : null,
    };
  });
  return {
    entries,
    missing: entries.filter((x) => x.state === "missing").map((x) => x.field),
    provenanceRead: input.provenance !== null,
  };
}

// --- 5. Copy (bible S23.4) --------------------------------------------------------------

function join(parts: readonly string[]): string {
  return parts.join(", ");
}

/** "terpenes, image" - the red list; "" when nothing is missing. */
export function missingList(v: GapVector): string {
  return join(v.entries.filter((x) => x.state === "missing").map((x) => x.label));
}

/** "description (Gemini 94%), effects (KB)" - "" when nothing was attached at onboarding. */
export function attachedList(v: GapVector): string {
  return join(v.entries.filter((x) => x.attachedBy !== null).map((x) => `${x.label} (${x.attachedBy})`));
}

/** "tags (Enrichment), aroma (KB)" - filled fields with no onboarding provenance. */
export function onFileList(v: GapVector): string {
  return join(v.entries.filter((x) => x.attachedBy === null && x.seenIn !== null).map((x) => `${x.label} (${x.seenIn})`));
}

/** "description (KB)" - missing on the card, covered at display time. */
export function borrowedList(v: GapVector): string {
  return join(v.entries.filter((x) => x.borrowedFrom !== null).map((x) => `${x.label} (${x.borrowedFrom})`));
}

/** "lineage, category confidence" - fields this screen cannot see. */
export function uncheckedList(v: GapVector): string {
  return join(v.entries.filter((x) => x.state === "unchecked").map((x) => x.label));
}

/**
 * The detail header sentence (bible S23.4, verbatim shape):
 *   "Still missing: terpenes, image. Attached at onboarding: description
 *    (Gemini 94%), effects (KB), strain type (You)."
 * Either half is omitted when empty; nothing missing and nothing attached ->
 * "Nothing is missing."
 */
export function gapHeadline(v: GapVector): string {
  const parts: string[] = [];
  const m = missingList(v);
  const a = attachedList(v);
  if (m) parts.push(`Still missing: ${m}.`);
  if (a) parts.push(`Attached at onboarding: ${a}.`);
  if (parts.length === 0) return "Nothing is missing.";
  return parts.join(" ");
}

/** The muted second line; "" when there is nothing to add. */
export function gapFootnote(v: GapVector): string {
  const parts: string[] = [];
  const f = onFileList(v);
  const b = borrowedList(v);
  const u = uncheckedList(v);
  if (f) parts.push(`Also on file: ${f}.`);
  if (b) parts.push(`Shown on the menu for now, but not saved on this card: ${b}.`);
  if (u) parts.push(`Not checked here (no record of it yet): ${u}.`);
  if (!v.provenanceRead) parts.push("The onboarding history could not be read, so no field shows where it came from.");
  return parts.join(" ");
}

// --- Self-tests -------------------------------------------------------------------------

export function __runGapVectorCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (name: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
    else {
      failed += 1;
      console.error(`gap-vector-core FAIL ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
    }
  };

  const BP = "Blue Dream 3.5g from Fairwinds. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.";
  const BP_NO_BRAND = "Blue Dream. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.";
  const REAL = "A bright, berry-forward sativa-leaning hybrid with a sweet finish.";

  // 1. vocabulary
  eq("12 fields", GAP_FIELDS.length, 12);
  eq("every field labelled", GAP_FIELDS.every((f) => typeof GAP_FIELD_LABEL[f] === "string" && GAP_FIELD_LABEL[f] !== ""), true);
  eq("image provenance is 'images'", PROVENANCE_FIELD_FOR.image, "images");
  eq("brand_link/tags have no provenance", [PROVENANCE_FIELD_FOR.brand_link, PROVENANCE_FIELD_FOR.tags], [null, null]);
  eq("provenance read fields", GAP_PROVENANCE_FIELDS, ["description", "short_description", "effects", "terpenes", "aroma", "flavor", "strain_type", "lineage", "images", "category"]);
  eq("select is named", GAP_PROVENANCE_SELECT.includes("*"), false);

  // 2. description / boilerplate
  eq("boilerplate is not real", isRealDescription(BP), false);
  eq("boilerplate without brand is not real", isRealDescription(BP_NO_BRAND), false);
  eq("boilerplate with trailing spaces is not real", isRealDescription(`  ${BP}  `), false);
  eq("empty is not real", isRealDescription(""), false);
  eq("whitespace is not real", isRealDescription("   "), false);
  eq("null is not real", isRealDescription(null), false);
  eq("real copy is real", isRealDescription(REAL), true);
  eq("tail text mid-sentence is real", isRealDescription(`${BP} Grown indoors.`), true);
  eq("describedBy enrichment first", describedBy(REAL, REAL), "enrichment");
  eq("describedBy menu when enrichment boilerplate", describedBy(BP, REAL), "menu");
  eq("describedBy menu when enrichment null", describedBy(null, REAL), "menu");
  eq("describedBy null when both boilerplate", describedBy(BP, BP), null);
  eq("describedBy null when enrichment blank + item boilerplate", describedBy("  ", BP), null);
  eq("describedBy enrichment over boilerplate item", describedBy(REAL, BP), "enrichment");

  // 3. strain type
  eq("hybrid known", hasKnownStrainType("Hybrid"), true);
  eq("indica leaning known", hasKnownStrainType("indica leaning hybrid"), true);
  eq("unknown unknown", hasKnownStrainType("unknown"), false);
  eq("blank unknown", hasKnownStrainType(""), false);
  eq("null unknown", hasKnownStrainType(null), false);
  eq("flower applies", strainTypeApplies("flower"), true);
  eq("topical n/a", strainTypeApplies("Topical"), false);
  eq("paraphernalia n/a", strainTypeApplies("paraphernalia"), false);

  // 4. confidence
  eq("0.94 -> 94", confidencePct(0.94), 94);
  eq("string '0.9' -> 90", confidencePct("0.9"), 90);
  eq("null -> null", confidencePct(null), null);
  eq("1.5 -> null (off scale)", confidencePct(1.5), null);
  eq("-0.1 -> null", confidencePct(-0.1), null);
  eq("NaN string -> null", confidencePct("abc"), null);
  eq("0 -> 0", confidencePct(0), 0);
  eq("1 -> 100", confidencePct(1), 100);

  // 5. latest provenance
  const rows: GapProvenanceRow[] = [
    { field: "description", value_json: "old", source: "gemini", confidence: 0.7, created_at: "2026-01-01T00:00:00Z" },
    { field: "description", value_json: REAL, source: "gemini", confidence: 0.94, created_at: "2026-02-01T00:00:00Z" },
    { field: "effects", value_json: ["calm"], source: "kb_published", confidence: null, created_at: "2026-02-01T00:00:00Z" },
    { field: "strain_type", value_json: "hybrid", source: "human", confidence: null, created_at: "2026-02-01T00:00:00Z" },
    { field: "terpenes", value_json: [], source: "gemini", confidence: 0.99, created_at: "2026-02-02T00:00:00Z" },
    { field: "aroma", value_json: ["pine"], source: "Gemini", confidence: 0.99, created_at: "2026-02-02T00:00:00Z" },
  ];
  const latest = latestProvenance(rows);
  eq("newest description wins", latest.get("description")?.confidence, 0.94);
  eq("empty value row ignored", latest.has("terpenes"), false);
  eq("unknown source ignored (case-sensitive)", latest.has("aroma"), false);
  eq("null rows -> empty", latestProvenance(null).size, 0);
  eq("chip gemini", provenanceChip(latest.get("description")!), "Gemini 94%");
  eq("chip kb", provenanceChip(latest.get("effects")!), "KB");
  eq("chip human", provenanceChip(latest.get("strain_type")!), "You");
  eq("chip gemini no confidence", provenanceChip({ field: "x", value_json: "v", source: "gemini", confidence: null, created_at: "" }), "Gemini");
  eq("chip gemini rounds", provenanceChip({ field: "x", value_json: "v", source: "gemini", confidence: 0.936, created_at: "" }), "Gemini 94%");

  // 6. the vector - the bible S23.4 example, verbatim
  const fullEnrichment: GapEnrichmentInput = {
    description: REAL,
    short_description: "Berry sativa hybrid.",
    primary_media_id: null,
    image_media_ids: [],
    brand_id: "b1",
    tags: ["staff-pick"],
  };
  const k: GapKnowledgeInput = { source: "kb-exact", effects: ["calm"], terpenes: [], aromaNotes: ["berry"], flavorNotes: ["sweet"] };
  const v = buildGapVector({
    item: { description: BP, strain_type: "Hybrid", category: "flower" },
    enrichment: fullEnrichment,
    knowledge: k,
    provenance: rows,
  });
  eq("missing = terpenes, image", v.missing, ["terpenes", "image"]);
  eq(
    "bible headline verbatim",
    gapHeadline(v),
    "Still missing: terpenes, image. Attached at onboarding: description (Gemini 94%), effects (KB), strain type (You).",
  );
  eq("on file", onFileList(v), "short line (Enrichment), aroma (KB), flavor (KB), brand link (Enrichment), tags (Enrichment)");
  eq("unchecked = lineage, category confidence", uncheckedList(v), "lineage, category confidence");
  eq(
    "footnote",
    gapFootnote(v),
    "Also on file: short line (Enrichment), aroma (KB), flavor (KB), brand link (Enrichment), tags (Enrichment). Not checked here (no record of it yet): lineage, category confidence.",
  );
  eq("provenanceRead true", v.provenanceRead, true);

  // 7. boilerplate-only intake card: description missing, loud
  const intake = buildGapVector({
    item: { description: BP, strain_type: "unknown", category: "flower" },
    enrichment: null,
    knowledge: null,
    provenance: [],
  });
  eq("intake card: everything checkable missing", intake.missing, [
    "description",
    "short_description",
    "effects",
    "terpenes",
    "aroma",
    "flavor",
    "strain_type",
    "image",
    "brand_link",
    "tags",
  ]);
  eq("intake headline", gapHeadline(intake), "Still missing: description, short line, effects, terpenes, aroma, flavor, strain type, image, brand link, tags.");
  eq("intake footnote (read, nothing on file)", gapFootnote(intake), "Not checked here (no record of it yet): lineage, category confidence.");

  // 8. provenance never claims a field that is not filled now
  const ghost = buildGapVector({
    item: { description: BP, strain_type: "Hybrid", category: "flower" },
    enrichment: null,
    knowledge: null,
    provenance: rows,
  });
  const ghostDesc = ghost.entries.find((x) => x.field === "description")!;
  eq("history row on a now-missing description -> missing, no chip", [ghostDesc.state, ghostDesc.attachedBy], ["missing", null]);
  eq("strain type still attached (filled)", ghost.entries.find((x) => x.field === "strain_type")!.attachedBy, "You");

  // 9. lineage + category filled only by provenance
  const lin = buildGapVector({
    item: { description: REAL, strain_type: "Indica", category: "flower" },
    enrichment: null,
    knowledge: null,
    provenance: [
      { field: "lineage", value_json: "Blueberry x Haze", source: "gemini", confidence: 0.91, created_at: "2026-02-01T00:00:00Z" },
      { field: "category", value_json: "flower", source: "human", confidence: null, created_at: "2026-02-01T00:00:00Z" },
    ],
  });
  eq("lineage filled by provenance", lin.entries.find((x) => x.field === "lineage")!.state, "filled");
  eq("lineage chip", lin.entries.find((x) => x.field === "lineage")!.attachedBy, "Gemini 91%");
  eq("category chip", lin.entries.find((x) => x.field === "category")!.attachedBy, "You");
  eq("menu description seen in Menu", lin.entries.find((x) => x.field === "description")!.seenIn, "Menu");
  eq("strain type seen in Menu", lin.entries.find((x) => x.field === "strain_type")!.seenIn, "Menu");
  eq("nothing unchecked", uncheckedList(lin), "");

  // 10. provenance not read -> no chips, honest footnote, lineage unchecked
  const unread = buildGapVector({
    item: { description: REAL, strain_type: "Indica", category: "flower" },
    enrichment: null,
    knowledge: null,
    provenance: null,
  });
  eq("unread: provenanceRead false", unread.provenanceRead, false);
  eq("unread: no chips", unread.entries.every((x) => x.attachedBy === null), true);
  eq("unread: footnote says so", gapFootnote(unread).endsWith("The onboarding history could not be read, so no field shows where it came from."), true);

  // 11. non-cannabis + topical
  const merch = buildGapVector({ item: { description: REAL, strain_type: "unknown", category: "merch" }, enrichment: null, knowledge: null, provenance: [] });
  eq("merch: sensory + strain + lineage n/a", merch.entries.filter((x) => x.state === "not_applicable").map((x) => x.field), ["effects", "terpenes", "aroma", "flavor", "strain_type", "lineage"]);
  eq("merch: missing only enrichment fields", merch.missing, ["short_description", "image", "brand_link", "tags"]);
  const topical = buildGapVector({ item: { description: REAL, strain_type: "unknown", category: "topical" }, enrichment: null, knowledge: null, provenance: [] });
  eq("topical: strain type n/a", topical.entries.find((x) => x.field === "strain_type")!.state, "not_applicable");
  eq("topical: effects still checked", topical.entries.find((x) => x.field === "effects")!.state, "missing");

  // 12. image sources
  const img1 = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: { ...fullEnrichment, primary_media_id: "m1" }, knowledge: null, provenance: [] });
  eq("primary media -> image filled", img1.missing.includes("image"), false);
  const img2 = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: { ...fullEnrichment, image_media_ids: ["m2"] }, knowledge: null, provenance: [] });
  eq("gallery -> image filled", img2.missing.includes("image"), false);
  const img4 = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: fullEnrichment, knowledge: null, provenance: [] });
  eq("no own media -> image missing", img4.missing.includes("image"), true);
  const img6 = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: { ...fullEnrichment, image_media_ids: null }, knowledge: null, provenance: [] });
  eq("null gallery -> image missing", img6.missing.includes("image"), true);
  const img5 = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: { ...fullEnrichment, image_media_ids: ["  "] }, knowledge: null, provenance: [] });
  eq("blank gallery id -> image missing", img5.missing.includes("image"), true);

  // 13. knowledge labels
  const strainK = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: null, knowledge: { ...k, source: "strain" }, provenance: [] });
  eq("strain rung label", strainK.entries.find((x) => x.field === "aroma")!.seenIn, "Strain library");
  const draftK = buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: null, knowledge: { ...k, source: "kb-draft" }, provenance: [] });
  eq("kb-draft rung label", draftK.entries.find((x) => x.field === "aroma")!.seenIn, "KB draft");
  eq("blank-string sensory list -> missing", buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: null, knowledge: { ...k, effects: [" "] }, provenance: [] }).missing.includes("effects"), true);

  // 14. nothing missing
  const done = buildGapVector({
    item: { description: REAL, strain_type: "Hybrid", category: "flower" },
    enrichment: { ...fullEnrichment, primary_media_id: "m1" },
    knowledge: { ...k, terpenes: ["myrcene"] },
    provenance: [],
  });
  eq("done: missing empty", done.missing, []);
  eq("done: headline", gapHeadline(done), "Nothing is missing.");
  eq("done: attached-only headline", gapHeadline(buildGapVector({
    item: { description: REAL, strain_type: "Hybrid", category: "flower" },
    enrichment: { ...fullEnrichment, primary_media_id: "m1" },
    knowledge: { ...k, terpenes: ["myrcene"] },
    provenance: rows,
  })), "Attached at onboarding: description (Gemini 94%), effects (KB), strain type (You).");
  eq("input not mutated", rows.length, 6);

  // 15. borrowed description (KB copy spliced in at render)
  const borrowed = buildGapVector({
    item: { description: BP, strain_type: "Hybrid", category: "flower" },
    enrichment: null,
    knowledge: { ...k, description: REAL },
    provenance: [],
  });
  const bd = borrowed.entries.find((x) => x.field === "description")!;
  eq("borrowed: still missing on the card", [bd.state, borrowed.missing.includes("description")], ["missing", true]);
  eq("borrowed: from KB", bd.borrowedFrom, "KB");
  eq("borrowed list", borrowedList(borrowed), "description (KB)");
  eq("borrowed footnote", gapFootnote(borrowed).includes("Shown on the menu for now, but not saved on this card: description (KB)."), true);
  eq("boilerplate KB copy is not borrowed", buildGapVector({ item: { description: BP, strain_type: "Hybrid", category: "flower" }, enrichment: null, knowledge: { ...k, description: BP }, provenance: [] }).entries[0]!.borrowedFrom, null);
  eq("source none is not borrowed", buildGapVector({ item: { description: BP, strain_type: "Hybrid", category: "flower" }, enrichment: null, knowledge: { ...k, source: "none", description: REAL }, provenance: [] }).entries[0]!.borrowedFrom, null);
  eq("filled description is never borrowed", buildGapVector({ item: { description: REAL, strain_type: "Hybrid", category: "flower" }, enrichment: null, knowledge: { ...k, description: REAL }, provenance: [] }).entries[0]!.borrowedFrom, null);
  eq("only description borrows", borrowed.entries.filter((x) => x.borrowedFrom !== null).length, 1);

  return { passed, failed };
}
