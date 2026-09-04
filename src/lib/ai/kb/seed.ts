/**
 * src/lib/ai/kb/seed.ts
 *
 * Expert STARTER knowledge base for grounded cannabis copy. This is curated,
 * non-medical, WA I-502-safe reference data: strain families, the terpene →
 * aroma/flavor map, per-category vocabulary, and a small banned-phrase list.
 *
 * Two jobs:
 *  1. SEED — the admin "Seed knowledge base" action idempotently upserts these
 *     rows into the kb_* tables so the owner starts with a useful baseline and
 *     can edit/extend them.
 *  2. FALLBACK — if the kb_* tables are empty or not migrated yet, the
 *     retrieval helper falls back to this in-code data so enrichment still has
 *     grounded facts to work with on day one.
 *
 * EVERYTHING here is sensory/botanical/factual ONLY. There is deliberately no
 * effect, medical, or therapeutic content — that would violate WA advertising
 * rules and the grounding contract.
 *
 * Shared-safe (no server-only imports) so it can be used in seed scripts and
 * server code alike.
 */

// sales-limits-core is PURE (no server-only, no DB). We import the ENFORCED WA
// limit constants so the KB compliance-rule reference (Slice 3) derives its
// purchase-limit numbers from the same single source of truth checkout uses —
// the KB reference can never drift from what is actually enforced.
import {
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
  gramsToOunces,
} from "@/lib/compliance/sales-limits-core";

export type SeedStrain = {
  slug: string;
  name: string;
  aliases?: string[];
  strain_type: "indica" | "sativa" | "hybrid" | "indica-hybrid" | "sativa-hybrid";
  lineage?: string;
  aroma_notes: string[];
  flavor_notes: string[];
  terpenes: string[];
  summary: string;
};

export type SeedTerpene = {
  slug: string;
  name: string;
  aroma_notes: string[];
  flavor_notes: string[];
  also_found_in?: string;
  /**
   * Normalized aroma-family tags for the reverse cross-map (aroma word →
   * terpene). Sensory only; derived from this terpene's own aroma/flavor notes.
   * Slice 5 (migration 0089).
   */
  aroma_families?: string[];
};

export type SeedCannabinoid = {
  slug: string;
  name: string;
  full_name?: string;
  /** Factual classification (chemistry, not a medical claim). */
  intoxication: "psychoactive" | "non-psychoactive" | "mildly-psychoactive";
  is_acidic: boolean;
  /** Slug this acid decarboxylates to (e.g. 'thc'); undefined for neutral forms. */
  decarbs_to?: string;
  character_notes: string[];
  /** Full factual explanation. Compliance-gated before it surfaces. */
  description: string;
  also_found_in?: string;
  sources: string[];
  confidence: number;
};

export type SeedEffect = {
  slug: string;
  name: string;
  /** UI grouping ONLY, not a medical category: calming | uplifting | energizing | character. */
  category: "calming" | "uplifting" | "energizing" | "character";
  /** Factual, non-medical description of the SUBJECTIVE experience. Compliance-gated on surface. */
  definition: string;
  /** House-voiced budtender blurb (fun-but-professional, non-medical). Compliance-gated on surface. */
  house_note: string;
  /** Neutral synonyms / adjacent terms that map to this effect (for matching effects[] tags). */
  aliases: string[];
  sources: string[];
  confidence: number;
};

export type SeedProductFormat = {
  slug: string;
  name: string;
  /** UI grouping ONLY, not a medical category: inhaled | ingested | topical. */
  category: "inhaled" | "ingested" | "topical";
  /** Factual, non-medical definition of the physical form. Compliance-gated on surface. */
  definition: string;
  /** Factual description of HOW it's used (smoked/eaten/applied/sublingual). NOT a dosing directive. */
  consumption: string;
  /** WA-verified typical potency band (market fact). NEVER a dosing instruction. */
  potency_note: string;
  /** House-voiced budtender blurb (fun-but-professional, non-medical). Compliance-gated on surface. */
  house_note: string;
  /** Neutral synonyms / adjacent terms that map to this format (for matching category/type text). */
  aliases: string[];
  sources: string[];
  confidence: number;
};

export type SeedComplianceRule = {
  slug: string;
  title: string;
  /** UI grouping ONLY: age | purchase-limit | possession | public-use | driving | edibles-safety | storage | transport. */
  category:
    | "age"
    | "purchase-limit"
    | "possession"
    | "public-use"
    | "driving"
    | "edibles-safety"
    | "storage"
    | "transport";
  /** Factual legal/safety statement (neutral education). Compliance-gated on surface. */
  rule: string;
  /** Friendly plain-language "what that means for you" (house voice, non-medical). Compliance-gated. */
  house_note: string;
  /** UI emphasis only, not a legal grade. */
  severity: "info" | "important" | "critical";
  /** Statute/rule citation string. */
  citation: string;
  sources: string[];
  confidence: number;
  sort_order: number;
};

/**
 * Slice 4: store/brand fact card (owner-extendable). Hours, address, phone,
 * payment, delivery, mission, "about us", etc. Policy/marketing language only —
 * never a medical claim. The owner can add more of these in the admin UI.
 */
export type SeedStoreFact = {
  /** Stable slug key (unique); seed upserts on this so curated edits survive. */
  key: string;
  label: string;
  /** UI grouping ONLY: basics | payment | policies | about | other. */
  category: "basics" | "payment" | "policies" | "about" | "other";
  /** The fact itself, in Greenway voice. Compliance-gated on surface. */
  body: string;
  /** Optional lowercase tags for retrieval targeting. */
  tags: string[];
  sort_order: number;
  sources: string[];
  confidence: number;
};

/**
 * Slice 4: curated FAQ entry (owner-extendable). Question + Greenway-voice
 * answer the concierge can lean on. WA I-502 compliant; no medical claims.
 * NOTE: the loyalty FAQ deliberately carries no hard-coded earn rate — the live
 * rate is composed at runtime from loyalty_config so it can never drift.
 */
export type SeedFaq = {
  slug: string;
  question: string;
  answer: string;
  /** UI grouping ONLY: basics | buying | compliance | products | loyalty | other. */
  category: "basics" | "buying" | "compliance" | "products" | "loyalty" | "other";
  tags: string[];
  sort_order: number;
  sources: string[];
  confidence: number;
};

export type SeedCategory = {
  category: string;
  display_name: string;
  formats: string[];
  format_words: string[];
  sensory_words: string[];
  notes?: string;
};

export type SeedBannedPhrase = {
  phrase: string;
  severity: "block" | "warn";
  reason?: string;
};

// ---------------------------------------------------------------------------
// Terpenes — aroma/flavor only (NO effects). The model uses these to translate
// "dominant terpene: limonene" into legal sensory language.
// ---------------------------------------------------------------------------
export const SEED_TERPENES: SeedTerpene[] = [
  { slug: "myrcene", name: "Myrcene", aroma_notes: ["earthy", "musky", "herbal", "ripe-fruit"], flavor_notes: ["earthy", "mango", "clove"], also_found_in: "mango, hops, thyme, lemongrass", aroma_families: ["earthy", "herbal", "sweet", "hoppy"] },
  { slug: "limonene", name: "Limonene", aroma_notes: ["citrus", "lemon", "orange", "bright"], flavor_notes: ["citrus", "lemon", "tangy"], also_found_in: "citrus rind, juniper, peppermint", aroma_families: ["citrus"] },
  { slug: "caryophyllene", name: "Caryophyllene", aroma_notes: ["peppery", "spicy", "woody"], flavor_notes: ["pepper", "spice", "clove"], also_found_in: "black pepper, cloves, cinnamon", aroma_families: ["spicy", "woody"] },
  { slug: "pinene", name: "Pinene", aroma_notes: ["pine", "fresh", "forest", "herbal"], flavor_notes: ["pine", "rosemary", "sharp"], also_found_in: "pine needles, rosemary, basil, dill", aroma_families: ["pine", "herbal"] },
  { slug: "linalool", name: "Linalool", aroma_notes: ["floral", "lavender", "sweet"], flavor_notes: ["floral", "lavender", "citrus"], also_found_in: "lavender, coriander, birch", aroma_families: ["floral", "sweet"] },
  { slug: "terpinolene", name: "Terpinolene", aroma_notes: ["fresh", "piney", "floral", "herbal"], flavor_notes: ["citrus", "apple", "cumin"], also_found_in: "apples, nutmeg, tea tree, lilac", aroma_families: ["pine", "floral", "herbal", "citrus"] },
  { slug: "humulene", name: "Humulene", aroma_notes: ["earthy", "woody", "hoppy"], flavor_notes: ["hops", "wood", "herbal"], also_found_in: "hops, sage, ginseng, coriander", aroma_families: ["earthy", "woody", "hoppy", "herbal"] },
  { slug: "ocimene", name: "Ocimene", aroma_notes: ["sweet", "herbal", "woody"], flavor_notes: ["sweet", "citrus", "herbal"], also_found_in: "mint, parsley, basil, mango", aroma_families: ["sweet", "herbal", "woody", "citrus"] },
  { slug: "bisabolol", name: "Bisabolol", aroma_notes: ["floral", "chamomile", "sweet", "nutty"], flavor_notes: ["floral", "honey", "soft"], also_found_in: "chamomile, candeia tree", aroma_families: ["floral", "sweet"] },
  { slug: "nerolidol", name: "Nerolidol", aroma_notes: ["floral", "woody", "citrus", "apple"], flavor_notes: ["floral", "woody", "citrus"], also_found_in: "jasmine, tea tree, lemongrass, ginger", aroma_families: ["floral", "woody", "citrus"] },
  { slug: "geraniol", name: "Geraniol", aroma_notes: ["floral", "rose", "sweet", "fruity"], flavor_notes: ["rose", "peach", "sweet"], also_found_in: "roses, geraniums, lemons", aroma_families: ["floral", "sweet"] },
  { slug: "valencene", name: "Valencene", aroma_notes: ["citrus", "orange", "sweet", "fresh"], flavor_notes: ["orange", "citrus", "sweet"], also_found_in: "valencia oranges, grapefruit", aroma_families: ["citrus", "sweet"] },
  { slug: "eucalyptol", name: "Eucalyptol", aroma_notes: ["minty", "cooling", "eucalyptus", "fresh"], flavor_notes: ["mint", "menthol", "cooling"], also_found_in: "eucalyptus, rosemary, tea tree, bay leaves", aroma_families: ["minty"] },
  { slug: "camphene", name: "Camphene", aroma_notes: ["pine", "damp-woods", "fir", "musky"], flavor_notes: ["pine", "earthy", "herbal"], also_found_in: "fir needles, cypress, nutmeg, ginger", aroma_families: ["pine", "woody", "earthy"] },
  { slug: "terpineol", name: "Terpineol", aroma_notes: ["floral", "lilac", "pine", "clove"], flavor_notes: ["floral", "citrus", "sweet"], also_found_in: "lilac, pine, lime blossoms", aroma_families: ["floral", "pine"] },
  { slug: "borneol", name: "Borneol", aroma_notes: ["minty", "camphor", "herbal", "earthy"], flavor_notes: ["mint", "menthol", "herbal"], also_found_in: "rosemary, mint, camphor, wormwood", aroma_families: ["minty", "herbal", "earthy"] },
  { slug: "fenchol", name: "Fenchol", aroma_notes: ["earthy", "camphor", "lemon", "pine"], flavor_notes: ["earthy", "citrus", "herbal"], also_found_in: "basil, nutmeg, pine", aroma_families: ["earthy", "citrus", "pine", "herbal"] },
  { slug: "sabinene", name: "Sabinene", aroma_notes: ["spicy", "peppery", "citrus", "woody"], flavor_notes: ["spice", "citrus", "herbal"], also_found_in: "black pepper, nutmeg, tea tree, oak", aroma_families: ["spicy", "citrus", "woody"] },
  { slug: "phellandrene", name: "Phellandrene", aroma_notes: ["minty", "citrus", "peppery", "woody"], flavor_notes: ["mint", "citrus", "herbal"], also_found_in: "mint, dill, eucalyptus, ginger", aroma_families: ["minty", "citrus", "spicy", "woody"] },
  { slug: "carene", name: "Carene", aroma_notes: ["sweet", "pine", "citrus", "earthy"], flavor_notes: ["sweet", "pine", "citrus"], also_found_in: "pine, cedar, rosemary, basil, citrus", aroma_families: ["sweet", "pine", "citrus", "earthy"] },
  { slug: "pulegone", name: "Pulegone", aroma_notes: ["minty", "camphor", "herbal", "sweet"], flavor_notes: ["mint", "menthol", "herbal"], also_found_in: "peppermint, catnip, rosemary", aroma_families: ["minty", "herbal", "sweet"] },
  { slug: "guaiol", name: "Guaiol", aroma_notes: ["pine", "woody", "rose", "earthy"], flavor_notes: ["pine", "woody", "floral"], also_found_in: "cypress pine, guaiacum", aroma_families: ["pine", "woody", "floral", "earthy"] },
];

// ---------------------------------------------------------------------------
// Cannabinoid compounds — FACTUAL chemistry only (molecular identity,
// psychoactive vs non-psychoactive, acidic precursor → decarboxylation,
// relative abundance, neutral receptor-affinity facts). There is deliberately
// NO medical/therapeutic content ("treats/helps/relieves") — that would violate
// WA I-502 advertising rules and the grounding contract; the compliance gate
// strips any such phrasing before it can surface.
//
// The set is exactly the 8 compounds in the code vocabulary
// (src/lib/naming/convention-core.ts CannabinoidType + src/lib/leafly/types.ts).
// Every fact is sourced — see docs/CANNABINOID_SEED_SOURCES.md.
// ---------------------------------------------------------------------------
const WIKI = "https://en.wikipedia.org/wiki/";
export const SEED_CANNABINOIDS: SeedCannabinoid[] = [
  {
    slug: "thc",
    name: "THC",
    full_name: "Delta-9-tetrahydrocannabinol",
    intoxication: "psychoactive",
    is_acidic: false,
    character_notes: ["major cannabinoid", "principal psychoactive constituent"],
    description:
      "Delta-9-tetrahydrocannabinol (molecular formula C21H30O2) is the principal " +
      "psychoactive and intoxicating constituent of cannabis. It is not the plant's " +
      "native form: it is produced when its acidic precursor THCA is decarboxylated " +
      "(loses CO2) through heat and/or time, such as smoking, vaping or cooking.",
    also_found_in: "the primary psychoactive cannabinoid in most adult-use cannabis",
    sources: [`${WIKI}Tetrahydrocannabinol`],
    confidence: 0.98,
  },
  {
    slug: "thca",
    name: "THCA",
    full_name: "Tetrahydrocannabinolic acid",
    intoxication: "non-psychoactive",
    is_acidic: true,
    decarbs_to: "thc",
    character_notes: ["acidic precursor", "dominant form in fresh flower"],
    description:
      "Tetrahydrocannabinolic acid is the acidic biosynthetic precursor of THC and the " +
      "dominant cannabinoid form actually present in fresh, un-heated cannabis. In its " +
      "acidic form it is non-psychoactive; on heating it decarboxylates to THC, which is " +
      "why raw flower is not intoxicating until it is smoked, vaped or cooked.",
    also_found_in: "fresh/un-decarboxylated flower and concentrate",
    sources: [`${WIKI}Tetrahydrocannabinolic_acid`, `${WIKI}Decarboxylation`],
    confidence: 0.96,
  },
  {
    slug: "cbd",
    name: "CBD",
    full_name: "Cannabidiol",
    intoxication: "non-psychoactive",
    is_acidic: false,
    character_notes: ["major cannabinoid", "very weak CB1/CB2 affinity"],
    description:
      "Cannabidiol (molecular formula C21H30O2) is a non-psychoactive cannabinoid. It has " +
      "very weak affinity for the CB1 and CB2 receptors, so it does not produce the CB1-driven " +
      "intoxication associated with THC. It is produced by decarboxylation of its acidic " +
      "precursor CBDA.",
    also_found_in: "high-CBD and balanced-ratio cultivars",
    sources: [`${WIKI}Cannabidiol`],
    confidence: 0.97,
  },
  {
    slug: "cbda",
    name: "CBDA",
    full_name: "Cannabidiolic acid",
    intoxication: "non-psychoactive",
    is_acidic: true,
    decarbs_to: "cbd",
    character_notes: ["acidic precursor"],
    description:
      "Cannabidiolic acid is the acidic biosynthetic precursor of CBD, present in fresh, " +
      "un-heated plant material. It is non-psychoactive and decarboxylates to CBD with heat " +
      "and time.",
    also_found_in: "fresh high-CBD plant material",
    sources: [`${WIKI}Cannabidiol`, `${WIKI}Decarboxylation`],
    confidence: 0.95,
  },
  {
    slug: "cbg",
    name: "CBG",
    full_name: "Cannabigerol",
    intoxication: "non-psychoactive",
    is_acidic: false,
    character_notes: ["mother cannabinoid", "typically minor in finished material"],
    description:
      "Cannabigerol (molecular formula C21H32O2) is a non-psychoactive cannabinoid often called " +
      "the \"mother cannabinoid\": its acidic form, CBGA, is the single common intermediate from " +
      "which the plant's enzymes biosynthesize the acidic precursors of THC (THCA), CBD (CBDA) " +
      "and CBC (CBCA). It is typically present only as a minor cannabinoid in finished material.",
    also_found_in: "small amounts in most cultivars; higher in some CBG-forward strains",
    sources: [`${WIKI}Cannabigerol`, `${WIKI}Cannabigerolic_acid`],
    confidence: 0.95,
  },
  {
    slug: "cbn",
    name: "CBN",
    full_name: "Cannabinol",
    intoxication: "mildly-psychoactive",
    is_acidic: false,
    character_notes: ["THC oxidation product", "forms in aged/stored cannabis"],
    description:
      "Cannabinol (molecular formula C21H26O2) is a mildly psychoactive cannabinoid — a " +
      "low-affinity partial agonist at the CB1 receptor, so much higher doses are required to " +
      "experience intoxicating effects than with THC. Unusually, it does not come from its own " +
      "acidic precursor: it forms mostly by oxidation of THC in aged or stored cannabis exposed " +
      "to oxygen, heat and light.",
    also_found_in: "aged flower and older concentrate",
    sources: [`${WIKI}Cannabinol`],
    confidence: 0.94,
  },
  {
    slug: "cbc",
    name: "CBC",
    full_name: "Cannabichromene",
    intoxication: "non-psychoactive",
    is_acidic: false,
    character_notes: ["minor cannabinoid", "weak CB1/CB2 binding"],
    description:
      "Cannabichromene (molecular formula C21H30O2) is a non-psychoactive minor cannabinoid that " +
      "binds only weakly to the CB1 and CB2 receptors. In the plant it occurs mainly as its " +
      "acidic precursor CBCA, which is formed from CBGA by CBCA synthase and decarboxylates to " +
      "CBC over time or when heated.",
    also_found_in: "trace to minor amounts across many cultivars",
    sources: [`${WIKI}Cannabichromene`],
    confidence: 0.93,
  },
  {
    slug: "cbdv",
    name: "CBDV",
    full_name: "Cannabidivarin",
    intoxication: "non-psychoactive",
    is_acidic: false,
    character_notes: ["propyl (varin) analog of CBD", "minor cannabinoid"],
    description:
      "Cannabidivarin is a non-psychoactive minor cannabinoid and the propyl (varin) analog of " +
      "CBD — structurally the CBD homolog with a shorter propyl side chain in place of CBD's " +
      "pentyl chain.",
    also_found_in: "trace amounts, more common in some hemp-type cultivars",
    sources: [`${WIKI}Cannabidivarin`],
    confidence: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Experiential EFFECTS vocabulary — SUBJECTIVE EXPERIENCE only (how it tends
// to feel), never a medical/therapeutic claim. Every slug is a verbatim member
// of ALLOWED_EFFECTS (src/lib/ai/compliance.ts) so the vocabulary and the
// compliance gate can never disagree. `house_note` carries the house voice:
// fun-but-professional, a sophisticated-budtender tone (owner brief). All prose
// is routed through checkCompliance + checkEffects before it can surface.
// Curated core set (quality over quantity) — see docs/KB_EFFECTS_SEED_SOURCES.md.
// ---------------------------------------------------------------------------
const LEAFLY_EFFECTS = "https://www.leafly.com/strains/lists/effect";
const AG_EFFECTS = "https://www.amsterdamgenetics.com/choosing-cannabis-effects";

export const SEED_EFFECTS: SeedEffect[] = [
  // ---- Calming / body ------------------------------------------------------
  {
    slug: "relaxed",
    name: "Relaxed",
    category: "calming",
    definition:
      "A mellow, settled, tension-melting body feeling — the classic wind-down experience most " +
      "people picture. Describes the subjective feel, not a health outcome.",
    house_note:
      "The house classic. That easy exhale where your shoulders drop, the day gets quieter, and " +
      "sinking into the couch suddenly sounds like a great idea. Slow-burn, low-key, no rush.",
    aliases: ["relaxing", "calm", "calming", "chill", "mellow", "soothing"],
    sources: [`${LEAFLY_EFFECTS}/relaxed`, AG_EFFECTS],
    confidence: 0.97,
  },
  {
    slug: "sleepy",
    name: "Sleepy",
    category: "calming",
    definition:
      "Heavy-eyed, winding-down drowsiness — the kind that shows up as the night gets late. " +
      "A subjective experience descriptor, not a sleep-aid claim.",
    house_note:
      "The nightcap end of the shelf. Heavy eyelids, cozy blanket energy, one-more-episode-becomes-zero. " +
      "Save this one for when you're already headed toward the pillow.",
    aliases: ["sedate", "sedating", "drowsy"],
    sources: [AG_EFFECTS],
    confidence: 0.95,
  },
  {
    slug: "couch-lock",
    name: "Couch-lock",
    category: "calming",
    definition:
      "That pleasantly pinned-to-the-cushions heaviness where getting up feels entirely optional. " +
      "A subjective intensity descriptor for deeply body-relaxing experiences.",
    house_note:
      "The stuff of legend. When the couch quietly becomes home base and the remote is the furthest " +
      "you plan to reach. Deeply chill — grab your snacks before you sit down.",
    aliases: ["heavy", "body high"],
    sources: [`${LEAFLY_EFFECTS}/relaxed`, AG_EFFECTS],
    confidence: 0.94,
  },
  {
    slug: "dreamy",
    name: "Dreamy",
    category: "calming",
    definition:
      "A soft, floaty, gently-in-your-head haze — relaxed but with a light, drifting quality. " +
      "Describes the subjective feel only.",
    house_note:
      "Soft-focus vibes. A little floaty, a little heady, the good kind of daydream where time gets " +
      "pleasantly loose. Great with music and zero obligations.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/relaxed`],
    confidence: 0.9,
  },
  // ---- Uplifting / social --------------------------------------------------
  {
    slug: "happy",
    name: "Happy",
    category: "uplifting",
    definition:
      "A light, good-mood lift — brighter and a little more buoyant than baseline. A subjective " +
      "mood descriptor, not a treatment claim.",
    house_note:
      "Simple and lovely: a gentle mood bump that makes the ordinary stuff a little more fun. The " +
      "kind of pleasant you don't overthink.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/euphoric`, AG_EFFECTS],
    confidence: 0.95,
  },
  {
    slug: "euphoric",
    name: "Euphoric",
    category: "uplifting",
    definition:
      "A bigger, brighter wave of feel-good — a noticeable rush of positivity. Describes the " +
      "subjective experience, not a health benefit.",
    house_note:
      "The mood-lifter with the volume turned up. A bright, buoyant wave that makes everything feel " +
      "a few shades more golden. Crowd-pleaser energy.",
    aliases: ["uplifted", "uplifting"],
    sources: [`${LEAFLY_EFFECTS}/euphoric`, AG_EFFECTS],
    confidence: 0.95,
  },
  {
    slug: "giggly",
    name: "Giggly",
    category: "uplifting",
    definition:
      "The experience where everyday things get funnier than they have any right to be. A " +
      "subjective mood descriptor only.",
    house_note:
      "Warning: dad jokes may become elite. Everything's suddenly a little funnier, and you're along " +
      "for the ride. Best enjoyed with good company and a comedy queued up.",
    aliases: [],
    sources: [AG_EFFECTS],
    confidence: 0.92,
  },
  {
    slug: "talkative",
    name: "Talkative",
    category: "uplifting",
    definition:
      "Chatty, sociable, easy-conversation energy — words flow and hangs feel effortless. A " +
      "subjective social descriptor.",
    house_note:
      "The one that turns a quiet kickback into a three-hour conversation about everything and " +
      "nothing. Great for game nights and long porch sits.",
    aliases: ["sociable", "social"],
    sources: [AG_EFFECTS],
    confidence: 0.92,
  },
  // ---- Energizing / active -------------------------------------------------
  {
    slug: "energetic",
    name: "Energetic",
    category: "energizing",
    definition:
      "Get-up-and-go, do-the-thing energy — a lively, motivated feel rather than a settled one. " +
      "Describes the subjective experience only.",
    house_note:
      "The daytime driver. A lively, let's-actually-do-stuff spark — chores, a walk, a project you've " +
      "been putting off. Sunshine-in-a-jar type of vibe.",
    aliases: ["energizing", "buzzy"],
    sources: [`${LEAFLY_EFFECTS}/energetic`, AG_EFFECTS],
    confidence: 0.93,
  },
  {
    slug: "focused",
    name: "Focused",
    category: "energizing",
    definition:
      "A dialed-in, heads-down clarity — attention feels a little easier to point at one thing. " +
      "A subjective descriptor, not a cognitive/medical claim.",
    house_note:
      "The clean, dialed-in one. Good for getting in the zone — a task, a playlist, a tidy corner of " +
      "the garage. Clear-headed, not couch-bound.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/focused`],
    confidence: 0.9,
  },
  {
    slug: "creative",
    name: "Creative",
    category: "energizing",
    definition:
      "An ideas-flowing, color-outside-the-lines headspace where connections come a little easier. " +
      "Describes the subjective feel only.",
    house_note:
      "The muse in a jar. Ideas start bouncing, the sketchbook or the studio starts calling, and the " +
      "usual filter loosens up. Makers and daydreamers, this one's for you.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/creative`, AG_EFFECTS],
    confidence: 0.9,
  },
  {
    slug: "hungry",
    name: "Hungry",
    category: "energizing",
    definition:
      "An appetite nudge — food suddenly sounds like a very good idea. A subjective experience " +
      "descriptor, affectionately known as 'the munchies'.",
    house_note:
      "Yes, the munchies. Snacks ascend to a higher plane and the fridge becomes a place of wonder. " +
      "Line up the good stuff before, not after.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/hungry`],
    confidence: 0.9,
  },
  // ---- Character / intensity ----------------------------------------------
  {
    slug: "cerebral",
    name: "Cerebral",
    category: "character",
    definition:
      "A heady, up-top experience — felt more in the mind than the body, often thoughtful or " +
      "buzzy. A subjective character descriptor.",
    house_note:
      "The head-forward one. Lives up top — thoughts get lively and a little zippy. Pairs well with " +
      "good conversation or a deep-dive rabbit hole.",
    aliases: ["head high"],
    sources: [AG_EFFECTS],
    confidence: 0.9,
  },
  {
    slug: "body high",
    name: "Body high",
    category: "character",
    definition:
      "The physical pole of the experience — felt in the limbs and shoulders rather than the head. " +
      "A subjective character descriptor.",
    house_note:
      "The opposite of heady: this one settles into the body. Loose shoulders, easy limbs, that " +
      "warm physical hum. The classic 'feel it, don't think it' lane.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/relaxed`, AG_EFFECTS],
    confidence: 0.9,
  },
  {
    slug: "potent",
    name: "Potent",
    category: "character",
    definition:
      "A heads-up that this one comes on strong — a note about intensity, not a quality or health " +
      "claim. Pace yourself and start low.",
    house_note:
      "Respect the green. This one doesn't tiptoe — a little goes a long way, so start low and go " +
      "slow. Seasoned heads know the drill; newcomers, ease in.",
    aliases: ["stoney", "strong"],
    sources: [`${LEAFLY_EFFECTS}/euphoric`],
    confidence: 0.9,
  },
  {
    slug: "tingly",
    name: "Tingly",
    category: "character",
    definition:
      "A light, pleasant physical fizz or buzz — a gentle bodily sensation. A subjective descriptor " +
      "only.",
    house_note:
      "A little sparkle in the body — that gentle, pleasant fizz some people love. Subtle, not " +
      "startling; more 'ooh, nice' than anything else.",
    aliases: [],
    sources: [`${LEAFLY_EFFECTS}/relaxed`],
    confidence: 0.88,
  },
];

// ---------------------------------------------------------------------------
// Product formats / consumption methods — FACTUAL form + use + measured
// potency band. Effects (SEED_EFFECTS) = how it FEELS; formats = what it IS and
// how you USE it. Every potency band and consumption fact is WA-verified from
// WSLCB "Types of Products", WAC 314-55-095 (edible cap), and RCW possession
// limits — see docs/KB_PRODUCT_FORMATS_SEED_SOURCES.md.
//
// COMPLIANCE (WA I-502): descriptive only. No medical/therapeutic claims, no
// dosing directives ("take X"). Onset statements ("comes on more slowly than
// inhalation") describe how ingestion differs, not a health benefit. All prose
// is compliance-gated before it can surface in retrieval.
// ---------------------------------------------------------------------------
const WSLCB_PRODUCTS = "https://lcb.wa.gov/education/types_of_products";
const WAC_EDIBLE_CAP = "https://www.networkforphl.org/resources/state-regulation-of-edible-cannabis-products/";

export const SEED_PRODUCT_FORMATS: SeedProductFormat[] = [
  // ---- Inhaled -------------------------------------------------------------
  {
    slug: "flower",
    name: "Loose Flower",
    category: "inhaled",
    definition:
      "Dried, well-aged cannabis buds — the OG format, sold loose by weight (gram, eighth, quarter, " +
      "ounce). What most people picture when they picture weed.",
    consumption:
      "Smoked in a joint, blunt, bowl/pipe, or bong, or run through a dry-flower vaporizer.",
    potency_note: "Varies by cultivar; commonly around 15–25%+ THC on the Washington shelf.",
    house_note:
      "The classic for a reason. Grind it, roll it or pack a bowl, and you're in full control of the " +
      "ritual — made for folks who love the whole hands-on experience and the full aroma of the bud.",
    aliases: ["bud", "loose flower", "dried flower", "eighth", "nugs", "herb", "smokable flower"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.97,
  },
  {
    slug: "preroll",
    name: "Pre-Roll",
    category: "inhaled",
    definition:
      "Flower already ground and rolled into a joint (sometimes a blunt) — ready to spark, no rolling " +
      "skills required.",
    consumption: "Smoked straight out of the package; light one end and go.",
    potency_note: "Tracks its flower — commonly around 15–25%+ THC unless it's an infused pre-roll.",
    house_note:
      "The grab-and-go move. Perfect when you don't feel like breaking out the grinder, or for sharing " +
      "on a walk. All the flower experience, zero prep.",
    aliases: ["pre-roll", "pre roll", "joint", "pre-rolled", "prerolls", "doobie"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.96,
  },
  {
    slug: "infused-preroll",
    name: "Infused Pre-Roll",
    category: "inhaled",
    definition:
      "A pre-roll boosted with concentrate and/or kief — coated, cored, or dusted with extract for a " +
      "stronger, more potent smoke than flower alone.",
    consumption: "Smoked like any pre-roll; light and enjoy — usually a slower, harder-hitting burn.",
    potency_note: "Runs noticeably HIGHER THC than the base flower thanks to the added concentrate (WSLCB).",
    house_note:
      "The pre-roll's turbo cousin. When a regular joint feels a little too polite, this is the one. " +
      "One for seasoned heads — it earns its keep. Heads up: because it contains concentrate, it " +
      "counts toward the 7-gram concentrate purchase limit, not the 1-ounce flower limit.",
    aliases: ["infused pre-roll", "infused joint", "infused preroll", "diamond-infused", "kief-coated"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.94,
  },
  {
    slug: "vape-cartridge",
    name: "Vape Cartridge",
    category: "inhaled",
    definition:
      "A cartridge of cannabis oil (distillate, live-resin, or full-spectrum) that screws onto a " +
      "battery. Clean, portable, and no flame required.",
    consumption: "Attach to a 510-thread battery and inhale; the coil warms the oil into vapor.",
    potency_note: "Extract-based, so typically high THC — commonly well above flower.",
    house_note:
      "The discreet everyday driver. Slips in a pocket, no smoke smell to speak of, and true-to-strain " +
      "flavor if you grab a live-resin cart. Low fuss, high reward.",
    aliases: ["cart", "cartridge", "510 cart", "vape cart", "oil cart", "vape pen cartridge"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.95,
  },
  {
    slug: "disposable-vape",
    name: "Disposable Vape",
    category: "inhaled",
    definition:
      "An all-in-one vape pen with the battery and oil built in — nothing to screw together, nothing " +
      "to recharge past its life.",
    consumption: "Inhale straight from the pen; when it's empty, it's done.",
    potency_note: "Extract-based, so typically high THC — similar band to cartridges.",
    house_note:
      "The zero-setup option. Made for travel or as a starter — pull it out of the box and you're " +
      "already going. No battery shopping, no thread mismatches.",
    aliases: ["disposable", "all-in-one", "aio", "disposable pen", "throwaway vape"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.93,
  },
  {
    slug: "kief-hash",
    name: "Kief / Hash",
    category: "inhaled",
    definition:
      "The trichome heads themselves — sifted (kief) or pressed (hash). One of the oldest concentrates " +
      "on earth and a step up in potency from flower.",
    consumption: "Sprinkled on top of a bowl, added to a joint, or pressed and smoked/vaped.",
    potency_note: "Commonly around 30–60% THC (WSLCB) — meaningfully stronger than flower.",
    house_note:
      "Old-school connoisseur territory. A little dusting on a bowl turns an ordinary session into a " +
      "special one. Respect the potency and go easy the first time.",
    aliases: ["kief", "hash", "hashish", "pollen", "dry sift", "pressed hash"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.92,
  },
  {
    slug: "concentrate",
    name: "Concentrate (Shatter / Wax / Budder)",
    category: "inhaled",
    definition:
      "Solvent- or heat-extracted cannabis concentrate — shatter, wax, budder, crumble, or dabs. The " +
      "high-octane end of the inhaled shelf.",
    consumption: "Vaporized or \u201cdabbed\u201d on a dab rig / e-rig, or added to a bowl or joint.",
    potency_note: "The strongest everyday form — commonly around 60–90% THC (WSLCB).",
    house_note:
      "Not messing around. This is the deep end of the pool — big flavor, big potency, made for " +
      "experienced dabbers with the right gear. Begin with a rice-grain dab; you can always add more.",
    aliases: ["shatter", "wax", "budder", "crumble", "dabs", "bho", "concentrates", "extract"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.94,
  },
  {
    slug: "live-resin-rosin",
    name: "Live Resin / Live Rosin",
    category: "inhaled",
    definition:
      "A terpene-forward concentrate made from fresh-frozen plants to capture more of the living aroma. " +
      "Live resin uses solvent; live rosin is solventless (heat + pressure).",
    consumption: "Dabbed/vaporized on a rig, or found inside premium live-resin vape carts.",
    potency_note: "High-THC concentrate band; prized less for raw numbers than for full-flavor terpenes.",
    house_note:
      "The flavor-chaser's pick. If terps are your thing, this is where the plant tastes most alive — " +
      "loud, bright, and true-to-strain. Solventless rosin is the connoisseur's flex.",
    aliases: ["live resin", "live rosin", "rosin", "fresh frozen", "solventless", "sauce", "diamonds"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.9,
  },
  // ---- Ingested ------------------------------------------------------------
  {
    slug: "edible",
    name: "Edible",
    category: "ingested",
    definition:
      "Cannabis-infused food — gummies, chocolate, mints, and baked goods. You eat it; your body does " +
      "the rest.",
    consumption:
      "Eaten and digested. Effects come on more slowly than inhalation and tend to last longer — a " +
      "factual difference in how ingestion works, not a health claim.",
    potency_note:
      "Washington caps infused edibles at ten milligrams of active THC in a single serving, and one " +
      "hundred milligrams total in a package (WAC 314-55-095).",
    house_note:
      "Low-key and long-lasting. No smoke, no gear — just a tasty bite. The golden rule: begin with a " +
      "single serving and give it plenty of time before reaching for more, because edibles like to " +
      "sneak up on you.",
    aliases: ["edibles", "gummies", "gummy", "chocolate", "mints", "chews", "baked goods"],
    sources: [WSLCB_PRODUCTS, WAC_EDIBLE_CAP],
    confidence: 0.96,
  },
  {
    slug: "beverage",
    name: "Beverage",
    category: "ingested",
    definition:
      "A cannabis-infused drink — sodas, seltzers, teas, elixirs, and shots. An edible you sip.",
    consumption:
      "Drunk and digested; like other edibles, onset is slower than inhalation — a factual property, " +
      "not a benefit claim.",
    potency_note:
      "Falls under the WA edible rules: up to ten milligrams of active THC in a single serving, and one " +
      "hundred milligrams total in a package (WAC 314-55-095).",
    house_note:
      "The social sipper. Great when you want something in hand that isn't a drink-drink. Same edible " +
      "wisdom applies — pace yourself and let it settle before topping off.",
    aliases: ["beverage", "drink", "seltzer", "soda", "infused drink", "elixir", "shot", "tea"],
    sources: [WSLCB_PRODUCTS, WAC_EDIBLE_CAP],
    confidence: 0.93,
  },
  {
    slug: "capsule",
    name: "Capsule / Tablet",
    category: "ingested",
    definition:
      "Cannabis in a swallowable pill or softgel — precise, familiar, and about as low-drama as a " +
      "format gets.",
    consumption: "Swallowed with water like any capsule; digested, so onset is slower than inhalation.",
    potency_note: "An ingested format; each capsule is measured, and packages follow WA edible limits.",
    house_note:
      "The no-frills, no-flavor route. If you'd rather skip smoke, sweets, and fuss entirely, a capsule " +
      "just gets it done. Predictable and pocket-friendly.",
    aliases: ["capsule", "capsules", "softgel", "softgels", "tablet", "pill", "caps"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.9,
  },
  {
    slug: "tincture",
    name: "Tincture",
    category: "ingested",
    definition:
      "A liquid cannabis extract in a dropper bottle — flavored or plain, taken drop by drop.",
    consumption:
      "Placed under the tongue (sublingual) and held, or added to food/drink. Sublingual tends to come " +
      "on faster than a food edible — a factual difference in absorption.",
    potency_note: "Measured per dropper; an ingested/sublingual format under WA rules.",
    house_note:
      "The precision tool. The dropper lets you dial things in easily, and the sublingual route is a " +
      "nice middle ground between a quick vape and a slow gummy. Clean and controllable.",
    aliases: ["tincture", "tinctures", "dropper", "sublingual", "drops", "oil dropper"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.91,
  },
  // ---- Topical -------------------------------------------------------------
  {
    slug: "topical",
    name: "Topical",
    category: "topical",
    definition:
      "Cannabis-infused lotion, balm, salve, or cream meant for the skin — a body-care format, not a " +
      "smoke-or-swallow one.",
    consumption: "Rubbed onto the skin where you want it. Applied topically, not ingested or inhaled.",
    potency_note: "A skin-applied format; not measured in the smoke/edible potency bands.",
    house_note:
      "The spa-day side of the shelf. Botanical scents, smooth textures, and a totally different vibe " +
      "from the rest of the menu. (Scent and texture only — we don't make skin or health claims.)",
    aliases: ["topical", "topicals", "lotion", "balm", "salve", "cream", "ointment", "roll-on", "bath soak"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.92,
  },
  {
    slug: "transdermal-patch",
    name: "Transdermal Patch",
    category: "topical",
    definition:
      "An adhesive patch worn on the skin that releases cannabinoids gradually over time — set-it-and-" +
      "forget-it in patch form.",
    consumption: "Applied to clean skin and worn; delivered through the skin over a stretch of time.",
    potency_note: "A skin-delivered format; measured per patch rather than in smoke/edible bands.",
    house_note:
      "The steady, hands-off option. Stick it on and go about your day — nothing to hold, sip, or " +
      "relight. A quietly clever format for folks who want simple and consistent.",
    aliases: ["transdermal", "patch", "patches", "transdermal patch", "skin patch"],
    sources: [WSLCB_PRODUCTS],
    confidence: 0.88,
  },
];

// ---------------------------------------------------------------------------
// Compliance rules — Washington safety / purchase / use FACTS, surfaced
// HELPFULLY to keep customers safe. This is a REFERENCE / EDUCATION layer, NOT
// a second enforcement mechanism (checkout enforcement lives in
// sales-limits-core.ts). The purchase & possession limit NUMBERS are derived
// from RECREATIONAL_LIMITS at eval time so the KB can never drift from what is
// enforced. Every rule is sourced from WA statute/rule — see
// docs/KB_COMPLIANCE_RULES_SEED_SOURCES.md.
//
// COMPLIANCE (WA I-502): factual legal/safety education only. No medical claims,
// no product-specific dosing directive. Milligram figures are spelled in words
// to stay clear of the compliance gate's dosing-pattern flag. All prose is
// compliance-gated before it can surface.
// ---------------------------------------------------------------------------
const WSLCB_USING = "https://lcb.wa.gov/education/using_and_having_cannabis";

// Derived from the ENFORCED constants (single source of truth).
const REC_USABLE_OZ = gramsToOunces(RECREATIONAL_LIMITS.usable); // 1
const REC_SOLID_OZ = gramsToOunces(RECREATIONAL_LIMITS.solid_edible); // 16
const REC_LIQUID_OZ = gramsToOunces(RECREATIONAL_LIMITS.liquid_edible); // 72
const REC_CONC_G = RECREATIONAL_LIMITS.concentrate; // 7
// SLICE 16 — the low-THC beverage allowance. NOT a weight: milligrams of
// active delta-9 THC. Same figure for medical (MEDICAL_LIMITS.low_thc_liquid
// is also 200 — WAC 314-55-095(2)(d) does not triple it), which is why the
// house_note below says so out loud instead of letting a patient assume 3×.
const REC_LOW_THC_MG = RECREATIONAL_LIMITS.low_thc_liquid; // 200
const MED_LOW_THC_MG = MEDICAL_LIMITS.low_thc_liquid; // 200 — identical
const LOW_THC_UNIT_MG = LOW_THC_UNIT_MAX_MG; // 4
// SLICE 17 — the "otherwise taken into the body" allowance. Not a weight and
// not a THC figure: a COUNT OF ITEMS. WAC 314-55-010(40) defines the category
// by route of administration — anything for human consumption that is NOT
// inhaled, NOT orally ingested and NOT applied to the skin — which in a retail
// shop means suppositories. Medical is the SAME ten, for a different reason
// than the beverage bucket: WAC 314-55-095(2)(d) does not list this category
// at all, so there is no enhanced medical figure to grant.
const REC_OTHERWISE_UNITS = RECREATIONAL_LIMITS.otherwise_taken; // 10
const MED_OTHERWISE_UNITS = MEDICAL_LIMITS.otherwise_taken; // 10 — identical

export const SEED_COMPLIANCE_RULES: SeedComplianceRule[] = [
  {
    slug: "age-21-plus",
    title: "Adults 21 and over only",
    category: "age",
    rule:
      "Only adults 21 and over may buy or possess recreational cannabis in Washington. A valid " +
      "government-issued photo ID is required to enter and to purchase.",
    house_note:
      "House rule and state law, same thing: bring a valid ID every single time, no exceptions — even " +
      "if we already know your face. Under 21 can't come in. It keeps our license clean and the whole " +
      "shop above board.",
    severity: "critical",
    citation: "RCW 69.50.360",
    sources: [WSLCB_USING],
    confidence: 0.99,
    sort_order: 10,
  },
  {
    slug: "purchase-limits",
    title: "Single-transaction purchase limits",
    category: "purchase-limit",
    rule:
      `Washington caps one recreational transaction at ${REC_USABLE_OZ} ounce of useable cannabis, ` +
      `${REC_CONC_G} grams of concentrate/extract for inhalation, ${REC_SOLID_OZ} ounces of solid ` +
      `infused edibles, and ${REC_LIQUID_OZ} ounces of infused liquids. Infused liquids packaged in ` +
      `individual units of ${LOW_THC_UNIT_MG} mg of active delta-9 THC or less follow a separate ` +
      `allowance instead: up to ${REC_LOW_THC_MG} mg of active delta-9 THC in one transaction. ` +
      `Products otherwise taken into the body, such as suppositories, follow a count instead: ` +
      `up to ${REC_OTHERWISE_UNITS} units in one transaction.`,
    house_note:
      "Think of it as a per-visit basket limit set by the state. Our register keeps the math honest so " +
      "you never have to — if a cart runs over, we'll help you adjust. Registered medical patients get " +
      "higher limits. Heads up: infused pre-rolls, infused blunts, and infused flower count toward the " +
      "concentrate limit, not the flower limit. For low-THC drinks, one can is one unit and a four-pack " +
      "counts as four units, so we total the THC across the cans we actually scan — and a single " +
      "bottle that holds sixteen milligrams does not qualify even if the label splits it into four " +
      "servings, because the state measures the container, not the serving.",
    severity: "important",
    citation: "WAC 314-55-095",
    sources: [WSLCB_USING],
    confidence: 0.99,
    sort_order: 20,
  },
  {
    slug: "low-thc-beverage-limit",
    title: "Low-THC drinks have their own limit",
    category: "purchase-limit",
    rule:
      `A cannabis-infused liquid packaged in individual units of ${LOW_THC_UNIT_MG} mg of active ` +
      `delta-9 THC or less is capped by TOTAL THC rather than by volume: up to ${REC_LOW_THC_MG} mg ` +
      `of active delta-9 THC in a single transaction, in place of the ${REC_LIQUID_OZ}-ounce liquid ` +
      `allowance. The ${LOW_THC_UNIT_MG} mg test applies to the sealed container, not to a serving ` +
      `printed on the label. This allowance is ${MED_LOW_THC_MG} mg for registered medical patients ` +
      `too — it is the one limit that does not increase with a card.`,
    house_note:
      "Practical version: one can is one unit, and a four-pack is four units, so a budtender scans " +
      "each can and the register adds up the THC. If a drink is packaged as a single container that " +
      "holds more than four milligrams, it isn't in this category at all — it goes back under the " +
      "regular infused-liquid allowance measured by ounces, no matter what the serving breakdown on " +
      "the label says. And if we haven't classified a drink yet, it stays under the regular liquid " +
      "allowance measured in ounces \u2014 the stricter of the two, which is the call we always make " +
      "when a fact is missing.",
    severity: "important",
    citation: "WAC 314-55-095(1)(d)(i)(F)",
    sources: [WSLCB_USING],
    confidence: 0.99,
    sort_order: 25,
  },
  {
    slug: "otherwise-taken-limit",
    title: "Suppositories are counted, not weighed",
    category: "purchase-limit",
    rule:
      `A cannabis-infused product otherwise taken into the body — one that is not inhaled, ` +
      `not swallowed, and not applied to the skin, which in practice means a suppository — is ` +
      `limited to ${REC_OTHERWISE_UNITS} units in a single transaction. This category is ` +
      `counted as a NUMBER OF ITEMS, not by weight and not by THC: a sealed box of six counts ` +
      `as six of the ${REC_OTHERWISE_UNITS}. The allowance is ${MED_OTHERWISE_UNITS} units for ` +
      `registered medical patients too — the state's higher medical amounts do not list this ` +
      `category at all, so it does not increase with a card.`,
    house_note:
      "Practical version: we count items here, not ounces and not milligrams. One suppository " +
      "is one unit and a sealed box of six is six units, so ten units is the ceiling however " +
      "they are packaged. The state sets no milligram limit on this category — the count is " +
      "the only number that matters. And a product nobody has classified yet does NOT land in " +
      "this category; it falls back to the regular infused allowance measured in ounces, which " +
      "is why our intake screen flags anything that looks like one for a person to confirm " +
      "before it reaches the shelf.",
    severity: "important",
    citation: "WAC 314-55-095(1)(d)(i)(D)",
    sources: [WSLCB_USING],
    confidence: 0.99,
    sort_order: 27,
  },
  {
    slug: "possession-limits",
    title: "How much you can carry",
    category: "possession",
    rule:
      `An adult 21+ may lawfully possess up to ${REC_USABLE_OZ} ounce of useable cannabis, ` +
      `${REC_CONC_G} grams of concentrate, ${REC_SOLID_OZ} ounces of solid edibles, and ` +
      `${REC_LIQUID_OZ} ounces of infused liquids — or ${REC_LOW_THC_MG} mg of active delta-9 THC ` +
      `in low-THC liquids packaged in units of ${LOW_THC_UNIT_MG} mg or less — plus ` +
      `${REC_OTHERWISE_UNITS} units of a product otherwise taken into the body — the same ` +
      `amounts as the transaction limit.`,
    house_note:
      "Basically: what you can buy in a trip is about what you can carry. Easy to remember, easy to stay " +
      "on the right side of.",
    severity: "important",
    citation: "RCW 69.50.4013",
    sources: [WSLCB_USING],
    confidence: 0.98,
    sort_order: 30,
  },
  {
    slug: "no-public-use",
    title: "No consuming in public",
    category: "public-use",
    rule:
      "Consuming cannabis in view of the general public or in public places is illegal in Washington. " +
      "Enjoy it at a private residence where it's allowed.",
    house_note:
      "Keep the session private — no lighting up on the sidewalk, in the car, or in the parking lot. " +
      "Save it for home. Nobody wants a ticket to cap off a good day.",
    severity: "important",
    citation: "RCW 69.50.445",
    sources: [WSLCB_USING],
    confidence: 0.98,
    sort_order: 40,
  },
  {
    slug: "no-impaired-driving",
    title: "Never drive impaired",
    category: "driving",
    rule:
      "Driving under the influence of cannabis is illegal; Washington enforces a per-se THC blood limit. " +
      "Keep product in a sealed container, ideally in the trunk, while it's in the vehicle.",
    house_note:
      "Simple one: don't drive high, full stop. Pop your purchase in the trunk sealed up, get home, then " +
      "enjoy. Plan your ride like you would for any night out.",
    severity: "critical",
    citation: "RCW 46.61.502 / RCW 69.50.445",
    sources: [WSLCB_USING],
    confidence: 0.98,
    sort_order: 50,
  },
  {
    slug: "edibles-start-low",
    title: "Edibles: start low, go slow",
    category: "edibles-safety",
    rule:
      "Washington caps infused edibles at ten milligrams of active THC in a single serving and one " +
      "hundred milligrams total per package. Edibles come on more slowly than inhalation and can last " +
      "longer, so their timing is easy to misjudge.",
    house_note:
      "The number-one thing we tell folks about edibles: begin with a single serving and give it a good " +
      "while before you even think about more. They sneak up on you — patience beats a rough night every " +
      "time. (This is a safety heads-up, not medical advice.)",
    severity: "critical",
    citation: "WAC 314-55-095",
    sources: [WSLCB_USING, WAC_EDIBLE_CAP],
    confidence: 0.98,
    sort_order: 60,
  },
  {
    slug: "store-safely",
    title: "Store it safely",
    category: "storage",
    rule:
      "Keep cannabis in its original labeled, resealable packaging and store it well out of reach of " +
      "anyone underage and of pets.",
    house_note:
      "Store it like you would anything you wouldn't want little hands or curious paws getting into — " +
      "keep it in its own packaging, up high or locked away. Peace of mind is free.",
    severity: "important",
    citation: "WSLCB safety guidance",
    sources: [WSLCB_USING],
    confidence: 0.95,
    sort_order: 70,
  },
  {
    slug: "no-crossing-state-lines",
    title: "Don't cross state lines",
    category: "transport",
    rule:
      "Cannabis remains illegal under federal law, so taking it across a state border is prohibited — " +
      "even to another state where it is legal.",
    house_note:
      "What's bought in Washington stays in Washington. Road trip? Leave it home. Crossing a border with " +
      "it — even into another legal state — is a federal no-go.",
    severity: "important",
    citation: "Federal law / WSLCB",
    sources: [WSLCB_USING],
    confidence: 0.95,
    sort_order: 80,
  },
];

// ---------------------------------------------------------------------------
// Slice 4 — Store/brand FACTS + FAQ pack.
//
// Every store fact below is OWNER-CONFIRMED or mirrored VERBATIM from the live
// customer site (src/content/faq.ts + PriceMatchContent). Nothing here is
// guessed. The owner can add more of these (mission, about-us, parking, etc.)
// in the admin UI; the seed only gap-fills on key/slug and never clobbers edits.
//
// The LIVE loyalty earn rate is intentionally NOT hard-coded here: it lives in
// loyalty_config (owner-editable) and is composed into the loyalty answer at
// grounding time by retrieval.ts, so it can never drift from the real program.
// ---------------------------------------------------------------------------

// Site sources (for provenance strings).
const SITE_FAQ = "greenwaymarijuana.com/faq";
const SITE_PRICE_MATCH = "greenwaymarijuana.com/price-match";

export const SEED_STORE_FACTS: SeedStoreFact[] = [
  {
    key: "hours",
    label: "Store hours",
    category: "basics",
    body: "We're open 8:00 AM to 11:00 PM every single day of the week — the one exception is Christmas Day, when we close so the crew can be with family.",
    tags: ["hours", "open", "closing", "time"],
    sort_order: 10,
    sources: [SITE_FAQ, "owner-confirmed"],
    confidence: 1,
  },
  {
    key: "address",
    label: "Address & location",
    category: "basics",
    body: "You'll find us at 4851 Geiger Rd SE, Port Orchard, WA 98367. Twenty-one and up, come see us.",
    tags: ["address", "location", "directions", "where"],
    sort_order: 20,
    sources: ["owner-confirmed"],
    confidence: 1,
  },
  {
    key: "phone",
    label: "Phone",
    category: "basics",
    body: "Give us a ring at 360-443-6988 — happy to answer questions before you make the trip.",
    tags: ["phone", "call", "contact", "number"],
    sort_order: 30,
    sources: ["owner-confirmed"],
    confidence: 1,
  },
  {
    key: "payment",
    label: "Payment (cash only + ATM)",
    category: "payment",
    body: "We're cash only — that's the norm in this industry. No worries if you came empty-handed: there's an ATM right in the shop, and the fee is two dollars and fifty cents. Credit and debit cards aren't accepted for cannabis purchases.",
    tags: ["payment", "cash", "atm", "debit", "credit", "card"],
    sort_order: 10,
    sources: [SITE_FAQ, "owner-confirmed"],
    confidence: 1,
  },
  {
    key: "delivery",
    label: "Delivery (not available)",
    category: "policies",
    body: "No delivery here — cannabis delivery isn't legal in Washington, so every order is an in-store pickup with a valid 21+ ID. Come on by.",
    tags: ["delivery", "deliver", "shipping", "mail"],
    sort_order: 10,
    sources: ["owner-confirmed", WSLCB_USING],
    confidence: 1,
  },
  {
    key: "price-match",
    label: "Price-match promise",
    category: "policies",
    body: "Greenway Marijuana offers a price-match promise for our Loyalty members on regularly priced products from our Port Orchard competitors. Ask your budtender and they'll walk you through how it works.",
    tags: ["price", "match", "price-match", "loyalty", "competitor"],
    sort_order: 20,
    sources: [SITE_PRICE_MATCH],
    confidence: 1,
  },
];

export const SEED_FAQS: SeedFaq[] = [
  {
    slug: "store-hours",
    question: "What are Greenway Marijuana's store hours?",
    answer:
      "We're open 8:00 AM to 11:00 PM every day of the week, closed only on Christmas Day. Roll through whenever works for you.",
    category: "basics",
    tags: ["hours", "open", "time"],
    sort_order: 10,
    sources: [SITE_FAQ, "owner-confirmed"],
    confidence: 1,
  },
  {
    slug: "location",
    question: "Where is Greenway Marijuana located?",
    answer:
      "We're at 4851 Geiger Rd SE, Port Orchard, WA 98367. You can reach us at 360-443-6988 if you need directions.",
    category: "basics",
    tags: ["address", "location", "directions", "phone"],
    sort_order: 20,
    sources: ["owner-confirmed"],
    confidence: 1,
  },
  {
    slug: "payment-methods",
    question: "What forms of payment do you accept?",
    answer:
      "Cash only, which is standard for cannabis retail. There's an ATM in the shop if you need it — the fee is two dollars and fifty cents. We can't take credit or debit for cannabis purchases.",
    category: "buying",
    tags: ["payment", "cash", "atm", "card", "debit", "credit"],
    sort_order: 30,
    sources: [SITE_FAQ, "owner-confirmed"],
    confidence: 1,
  },
  {
    slug: "who-can-buy",
    question: "Who can legally buy cannabis?",
    answer:
      "Adults 21 and older, full stop. Bring a valid, unexpired government-issued photo ID and we'll get you taken care of.",
    category: "compliance",
    tags: ["age", "21", "id", "legal"],
    sort_order: 40,
    sources: [SITE_FAQ],
    confidence: 1,
  },
  {
    slug: "acceptable-id",
    question: "What forms of ID do you accept?",
    answer:
      "We take a driver's license, instruction permit, or ID card from any U.S. state, territory, or D.C. (or any Canadian province); a valid Washington temporary driver's license; a U.S. Armed Forces ID; a Merchant Marine ID from the U.S. Coast Guard; an official passport, passport card, Global Entry card, Permanent Resident card, or NEXUS card; or a Washington State Tribal Enrollment card. It just has to be valid and 21+.",
    category: "compliance",
    tags: ["id", "identification", "age", "passport", "license"],
    sort_order: 50,
    sources: [SITE_FAQ],
    confidence: 1,
  },
  {
    slug: "out-of-state-residents",
    question: "Do I have to be a Washington resident to buy?",
    answer:
      "Nope — you don't have to live in Washington to shop with us. You just have to be 21+ with a valid ID.",
    category: "compliance",
    tags: ["resident", "out-of-state", "tourist", "visitor"],
    sort_order: 60,
    sources: [SITE_FAQ],
    confidence: 1,
  },
  {
    slug: "purchase-limits",
    question: "How much cannabis can I buy at once?",
    answer:
      "Washington sets the single-visit limits: up to one ounce (28 grams) of usable flower, sixteen ounces of solid cannabis-infused edibles, seventy-two ounces of infused liquids, or seven grams of concentrate (dabs, vape carts, infused pre-rolls). Our register keeps every basket within those limits for you.",
    category: "compliance",
    tags: ["limit", "purchase", "how-much", "ounce"],
    sort_order: 70,
    sources: [SITE_FAQ, "RCW 69.50.360"],
    confidence: 1,
  },
  {
    slug: "consume-on-site",
    question: "Can I use cannabis on the premises?",
    answer:
      "You can't open, smoke, or consume any cannabis product on our property — and public consumption isn't allowed in Washington, period. Save it for private property.",
    category: "compliance",
    tags: ["consume", "smoke", "on-site", "public"],
    sort_order: 80,
    sources: [SITE_FAQ, WSLCB_USING],
    confidence: 1,
  },
  {
    slug: "where-to-consume",
    question: "Where can I legally consume what I buy?",
    answer:
      "On private property only. Washington handles public use much like public intoxication — think a fine of around three hundred fifty dollars that can climb higher, so keep it private.",
    category: "compliance",
    tags: ["consume", "private", "public", "where"],
    sort_order: 90,
    sources: [SITE_FAQ],
    confidence: 1,
  },
  {
    slug: "cross-state-lines",
    question: "Can I take my purchase to another state?",
    answer:
      "No — cannabis bought here stays in Washington. Crossing state lines with it is a federal issue, so keep it in-state.",
    category: "compliance",
    tags: ["travel", "state-lines", "transport", "airport"],
    sort_order: 100,
    sources: [SITE_FAQ, WSLCB_USING],
    confidence: 1,
  },
  {
    slug: "see-before-buying",
    question: "Can I see the product before I buy it?",
    answer:
      "Absolutely — in all its packaged glory. You can't open or sample it on site (that's federally a no-go), but your budtender is happy to show you what we've got.",
    category: "buying",
    tags: ["see", "sample", "try", "product"],
    sort_order: 110,
    sources: [SITE_FAQ],
    confidence: 1,
  },
  {
    slug: "returns",
    question: "Can I return or exchange a product?",
    answer:
      "Yes, within limits set by WAC 314-55-079. Returns must be made within 15 days of purchase, and the item has to come back in its original packaging with the lot/batch/inventory ID fully legible, along with your receipt. That covers flower, joints, edibles, cartridges, syringes, and disposable vapes.",
    category: "buying",
    tags: ["return", "exchange", "refund", "defective"],
    sort_order: 120,
    sources: [SITE_FAQ, "WAC 314-55-079"],
    confidence: 1,
  },
  {
    slug: "price-match",
    question: "Do you offer a price match?",
    answer:
      "We do, for our Loyalty members. We'll match regularly priced menu items against other Port Orchard, Washington cannabis retailers when it's the exact same vendor/brand and size we carry. A few ground rules: the competitor's price has to be regular price (no happy hours, holidays, or daily specials), it must include all Washington and local taxes, and it needs to be verifiable via their website, menu, or a phone call. Price-matched items can't be discounted further, and every sale stays compliant. Ask your budtender to set it up.",
    category: "loyalty",
    tags: ["price", "match", "price-match", "loyalty", "competitor"],
    sort_order: 130,
    sources: [SITE_PRICE_MATCH],
    confidence: 1,
  },
  {
    slug: "delivery",
    question: "Do you deliver?",
    answer:
      "We don't — cannabis delivery isn't legal in Washington. Everything is in-store pickup with a valid 21+ ID, so come see us at the shop.",
    category: "buying",
    tags: ["delivery", "deliver", "pickup", "shipping"],
    sort_order: 140,
    sources: ["owner-confirmed", WSLCB_USING],
    confidence: 1,
  },
  {
    slug: "resell",
    question: "Can I buy products to resell?",
    answer:
      "Only if you're looking to get in serious trouble — reselling cannabis is illegal in Washington. What you buy from us is for personal, legal use.",
    category: "compliance",
    tags: ["resell", "resale", "wholesale"],
    sort_order: 150,
    sources: [SITE_FAQ],
    confidence: 1,
  },
  {
    slug: "loyalty-program",
    question: "How does your loyalty program work?",
    answer:
      "Sign up for free and you'll start earning points on your purchases that you can redeem for savings down the road — plus loyalty members get access to our price-match promise. Ask your budtender to get you enrolled and they'll walk you through the current earn rate and rewards.",
    category: "loyalty",
    tags: ["loyalty", "points", "rewards", "earn", "program"],
    sort_order: 160,
    // No hard-coded earn rate: retrieval composes the LIVE rate from loyalty_config.
    sources: ["loyalty_config (live)"],
    confidence: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Strain families — type + lineage + sensory descriptors (NO effects).
// A practical starter set covering the most common shelf strains so most
// products with a recognizable strain name in their title can be grounded.
// ---------------------------------------------------------------------------
export const SEED_STRAINS: SeedStrain[] = [
  { slug: "blue dream", name: "Blue Dream", aliases: ["bluedream"], strain_type: "hybrid", lineage: "Blueberry x Haze", aroma_notes: ["berry", "sweet", "herbal"], flavor_notes: ["blueberry", "sweet", "vanilla"], terpenes: ["myrcene", "pinene", "caryophyllene"], summary: "A West Coast classic sativa-leaning hybrid known for a sweet blueberry aroma over a soft herbal backbone." },
  { slug: "og kush", name: "OG Kush", aliases: ["ogkush", "og"], strain_type: "hybrid", lineage: "Chemdawg x Hindu Kush (reported)", aroma_notes: ["earthy", "pine", "lemon", "fuel"], flavor_notes: ["earthy", "citrus", "woody"], terpenes: ["caryophyllene", "limonene", "myrcene"], summary: "A foundational hybrid with a distinctive earthy-pine aroma and a citrus-fuel edge that has shaped countless modern crosses." },
  { slug: "girl scout cookies", name: "Girl Scout Cookies", aliases: ["gsc", "cookies"], strain_type: "hybrid", lineage: "OG Kush x Durban Poison", aroma_notes: ["sweet", "earthy", "minty", "dessert"], flavor_notes: ["sweet", "mint", "cookie-dough"], terpenes: ["caryophyllene", "limonene", "humulene"], summary: "A celebrated hybrid prized for a sweet, dessert-like aroma layered with mint and earthy spice." },
  { slug: "sour diesel", name: "Sour Diesel", aliases: ["sourd", "sour d"], strain_type: "sativa", lineage: "Chemdawg x Super Skunk (reported)", aroma_notes: ["diesel", "pungent", "citrus", "fuel"], flavor_notes: ["diesel", "lemon", "sour"], terpenes: ["caryophyllene", "limonene", "myrcene"], summary: "An iconic sativa with a famously pungent diesel-and-citrus aroma that is unmistakable on the shelf." },
  { slug: "granddaddy purple", name: "Granddaddy Purple", aliases: ["gdp", "grandaddy purple", "granddaddy purp"], strain_type: "indica", lineage: "Purple Urkle x Big Bud", aroma_notes: ["grape", "berry", "sweet", "floral"], flavor_notes: ["grape", "berry", "sweet"], terpenes: ["myrcene", "caryophyllene", "pinene"], summary: "A deep-purple indica known for a rich grape-and-berry aroma and a sweet, fruit-forward profile." },
  { slug: "gelato", name: "Gelato", aliases: ["larry bird"], strain_type: "hybrid", lineage: "Sunset Sherbet x Thin Mint GSC", aroma_notes: ["sweet", "creamy", "berry", "dessert"], flavor_notes: ["sweet", "cream", "berry", "citrus"], terpenes: ["caryophyllene", "limonene", "humulene"], summary: "A dessert-style hybrid with a sweet, creamy aroma and bright berry-citrus notes." },
  { slug: "wedding cake", name: "Wedding Cake", aliases: ["triangle mints", "pink cookies"], strain_type: "hybrid", lineage: "Triangle Kush x Animal Mints", aroma_notes: ["sweet", "vanilla", "earthy", "tangy"], flavor_notes: ["vanilla", "sweet", "earthy"], terpenes: ["caryophyllene", "limonene", "myrcene"], summary: "A rich, tangy-sweet hybrid with a vanilla-cake aroma over an earthy base." },
  { slug: "gg4", name: "GG4 (Original Glue)", aliases: ["gorilla glue", "gg #4", "original glue", "glue"], strain_type: "hybrid", lineage: "Chem's Sister x Sour Dubb x Chocolate Diesel", aroma_notes: ["earthy", "pungent", "pine", "fuel"], flavor_notes: ["earthy", "pine", "diesel", "chocolate"], terpenes: ["caryophyllene", "limonene", "myrcene"], summary: "A heavy-resin hybrid with a pungent earthy-fuel aroma and notes of pine and chocolate." },
  { slug: "jack herer", name: "Jack Herer", aliases: ["jh", "jack"], strain_type: "sativa", lineage: "Haze x Northern Lights #5 x Shiva Skunk", aroma_notes: ["pine", "spicy", "earthy", "citrus"], flavor_notes: ["pine", "pepper", "citrus", "wood"], terpenes: ["terpinolene", "caryophyllene", "pinene"], summary: "A spicy-pine sativa classic named for the cannabis advocate, with a fresh, herbal-citrus character." },
  { slug: "northern lights", name: "Northern Lights", aliases: ["nl"], strain_type: "indica", lineage: "Afghani x Thai (reported)", aroma_notes: ["earthy", "sweet", "pine", "spicy"], flavor_notes: ["sweet", "earthy", "pine"], terpenes: ["myrcene", "caryophyllene", "pinene"], summary: "A legendary indica with a sweet, earthy-pine aroma and a smooth, resinous profile." },
  { slug: "pineapple express", name: "Pineapple Express", aliases: ["pineapple-express"], strain_type: "hybrid", lineage: "Trainwreck x Hawaiian", aroma_notes: ["pineapple", "tropical", "sweet", "citrus"], flavor_notes: ["pineapple", "tropical", "cedar"], terpenes: ["caryophyllene", "limonene", "pinene"], summary: "A tropical hybrid with a bright pineapple aroma layered over sweet citrus and a hint of cedar." },
  { slug: "durban poison", name: "Durban Poison", aliases: ["durban"], strain_type: "sativa", lineage: "South African landrace", aroma_notes: ["sweet", "pine", "earthy", "anise"], flavor_notes: ["sweet", "pine", "licorice"], terpenes: ["terpinolene", "myrcene", "ocimene"], summary: "A pure South African landrace sativa with a distinctive sweet, piney aroma and a hint of anise." },
  { slug: "purple punch", name: "Purple Punch", aliases: ["purp punch"], strain_type: "indica", lineage: "Larry OG x Granddaddy Purple", aroma_notes: ["grape", "berry", "sweet", "candy"], flavor_notes: ["grape", "blueberry", "sweet"], terpenes: ["caryophyllene", "myrcene", "pinene"], summary: "A dessert indica with a sweet grape-and-berry aroma reminiscent of fruit candy." },
  { slug: "runtz", name: "Runtz", aliases: ["runts"], strain_type: "hybrid", lineage: "Zkittlez x Gelato", aroma_notes: ["sweet", "fruity", "candy", "tropical"], flavor_notes: ["sweet", "fruit", "candy", "creamy"], terpenes: ["caryophyllene", "limonene", "linalool"], summary: "A sweet, candy-like hybrid with a bright fruity aroma and a smooth, creamy finish." },
  { slug: "zkittlez", name: "Zkittlez", aliases: ["skittlez", "skittles"], strain_type: "indica", lineage: "Grape Ape x Grapefruit", aroma_notes: ["fruity", "sweet", "berry", "tropical"], flavor_notes: ["fruit", "berry", "grape", "sweet"], terpenes: ["caryophyllene", "humulene", "linalool"], summary: "An indica known for an intensely fruity, candy-sweet aroma with tropical-berry notes." },
  { slug: "do si dos", name: "Do-Si-Dos", aliases: ["dosidos", "dosi"], strain_type: "indica", lineage: "GSC x Face Off OG", aroma_notes: ["sweet", "earthy", "floral", "minty"], flavor_notes: ["sweet", "mint", "earthy"], terpenes: ["limonene", "caryophyllene", "linalool"], summary: "A frosty indica with a sweet, earthy aroma and floral-mint undertones." },
  { slug: "white widow", name: "White Widow", strain_type: "hybrid", lineage: "Brazilian sativa x South Indian indica", aroma_notes: ["earthy", "woody", "spicy", "floral"], flavor_notes: ["earthy", "pepper", "wood"], terpenes: ["myrcene", "caryophyllene", "pinene"], summary: "A balanced classic hybrid with an earthy, woody aroma and a peppery, resin-heavy character." },
  { slug: "green crack", name: "Green Crack", aliases: ["green crush", "mango crack"], strain_type: "sativa", lineage: "Skunk #1 phenotype", aroma_notes: ["citrus", "mango", "tropical", "sweet"], flavor_notes: ["mango", "citrus", "tangy"], terpenes: ["myrcene", "caryophyllene", "limonene"], summary: "A zesty sativa with a sharp citrus-mango aroma and a bright, tangy profile." },
  { slug: "blueberry", name: "Blueberry", aliases: ["bb"], strain_type: "indica", lineage: "Afghani x Thai x Purple Thai (reported)", aroma_notes: ["blueberry", "sweet", "berry", "earthy"], flavor_notes: ["blueberry", "sweet", "berry"], terpenes: ["myrcene", "caryophyllene", "pinene"], summary: "A heritage indica famous for its true-to-name sweet blueberry aroma and flavor." },
  { slug: "trainwreck", name: "Trainwreck", strain_type: "hybrid", lineage: "Mexican & Thai sativa x Afghani indica", aroma_notes: ["pine", "lemon", "spicy", "earthy"], flavor_notes: ["lemon", "pine", "pepper"], terpenes: ["terpinolene", "myrcene", "pinene"], summary: "A pungent hybrid with a sharp pine-and-lemon aroma and a spicy, herbal edge." },
];

// ---------------------------------------------------------------------------
// Category vocabulary — formats + legal sensory/format words per category.
// ---------------------------------------------------------------------------
export const SEED_CATEGORIES: SeedCategory[] = [
  { category: "flower", display_name: "Flower", formats: ["eighth", "quarter", "half", "ounce", "gram", "two-gram"], format_words: ["dense", "frosty", "sticky", "well-cured", "hand-trimmed", "resinous", "trichome-rich"], sensory_words: ["aromatic", "fresh", "pungent", "fragrant"], notes: "Describe bud structure, cure, and aroma. Strain character is fair game; effects are not." },
  { category: "vape", display_name: "Vape", formats: ["cartridge", "510 cart", "disposable", "all-in-one", "pod"], format_words: ["smooth", "clean-drawing", "potent", "distillate", "live-resin", "full-spectrum"], sensory_words: ["flavorful", "true-to-strain", "bright", "rich"], notes: "Note the extract type and flavor. Avoid dosing or consumption-amount language." },
  { category: "concentrate", display_name: "Concentrate", formats: ["gram", "half-gram", "live rosin", "live resin", "wax", "shatter", "badder", "sauce", "diamonds"], format_words: ["solventless", "terp-rich", "glossy", "stable", "sappy", "full-melt"], sensory_words: ["flavorful", "aromatic", "pungent", "robust"], notes: "Emphasize extraction method, texture, and terpene character." },
  { category: "edible", display_name: "Edible", formats: ["gummies", "chocolate", "mint", "beverage", "hard candy", "pack"], format_words: ["fruit-forward", "small-batch", "real-fruit", "rich", "balanced"], sensory_words: ["sweet", "tart", "fruity", "smooth"], notes: "Describe flavor and format only. Never give dosing, serving counts, or onset/effect language." },
  { category: "preroll", display_name: "Pre-Roll", formats: ["single", "two-pack", "five-pack", "infused", "blunt", "joint"], format_words: ["evenly-packed", "smooth-burning", "tightly-rolled", "infused", "hand-rolled"], sensory_words: ["aromatic", "flavorful", "fresh"], notes: "Note the strain, roll quality, and any infusion. Sensory and format only." },
  { category: "topical", display_name: "Topical", formats: ["balm", "lotion", "salve", "roll-on", "bath soak"], format_words: ["small-batch", "botanical", "soothing-scent"], sensory_words: ["fragrant", "herbal", "smooth"], notes: "Describe scent and texture only. NO skin/medical/relief claims whatsoever." },
  { category: "tincture", display_name: "Tincture", formats: ["bottle", "dropper", "spray"], format_words: ["fast-acting-format", "flavored", "unflavored"], sensory_words: ["mild", "herbal", "citrus"], notes: "Describe flavor and format only. No dosing or effect language." },
];

// ---------------------------------------------------------------------------
// Banned phrases — owner-editable extra blocklist (beyond the regex).
// ---------------------------------------------------------------------------
export const SEED_BANNED_PHRASES: SeedBannedPhrase[] = [
  { phrase: "couch lock", severity: "warn", reason: "implies a physical effect" },
  { phrase: "knock you out", severity: "block", reason: "implies a physical/medical effect" },
  { phrase: "melt away", severity: "warn", reason: "borders on an effect/relief claim" },
  { phrase: "perfect for sleep", severity: "block", reason: "implies a sleep/medical benefit" },
  { phrase: "anxiety relief", severity: "block", reason: "medical relief claim" },
  { phrase: "energy boost", severity: "warn", reason: "implies a physiological effect" },
  { phrase: "pain free", severity: "block", reason: "medical claim" },
  { phrase: "doctor approved", severity: "block", reason: "unsubstantiated/medical endorsement" },
];
