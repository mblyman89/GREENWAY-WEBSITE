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
  { slug: "myrcene", name: "Myrcene", aroma_notes: ["earthy", "musky", "herbal", "ripe-fruit"], flavor_notes: ["earthy", "mango", "clove"], also_found_in: "mango, hops, thyme, lemongrass" },
  { slug: "limonene", name: "Limonene", aroma_notes: ["citrus", "lemon", "orange", "bright"], flavor_notes: ["citrus", "lemon", "tangy"], also_found_in: "citrus rind, juniper, peppermint" },
  { slug: "caryophyllene", name: "Caryophyllene", aroma_notes: ["peppery", "spicy", "woody"], flavor_notes: ["pepper", "spice", "clove"], also_found_in: "black pepper, cloves, cinnamon" },
  { slug: "pinene", name: "Pinene", aroma_notes: ["pine", "fresh", "forest", "herbal"], flavor_notes: ["pine", "rosemary", "sharp"], also_found_in: "pine needles, rosemary, basil, dill" },
  { slug: "linalool", name: "Linalool", aroma_notes: ["floral", "lavender", "sweet"], flavor_notes: ["floral", "lavender", "citrus"], also_found_in: "lavender, coriander, birch" },
  { slug: "terpinolene", name: "Terpinolene", aroma_notes: ["fresh", "piney", "floral", "herbal"], flavor_notes: ["citrus", "apple", "cumin"], also_found_in: "apples, nutmeg, tea tree, lilac" },
  { slug: "humulene", name: "Humulene", aroma_notes: ["earthy", "woody", "hoppy"], flavor_notes: ["hops", "wood", "herbal"], also_found_in: "hops, sage, ginseng, coriander" },
  { slug: "ocimene", name: "Ocimene", aroma_notes: ["sweet", "herbal", "woody"], flavor_notes: ["sweet", "citrus", "herbal"], also_found_in: "mint, parsley, basil, mango" },
  { slug: "bisabolol", name: "Bisabolol", aroma_notes: ["floral", "chamomile", "sweet", "nutty"], flavor_notes: ["floral", "honey", "soft"], also_found_in: "chamomile, candeia tree" },
  { slug: "nerolidol", name: "Nerolidol", aroma_notes: ["floral", "woody", "citrus", "apple"], flavor_notes: ["floral", "woody", "citrus"], also_found_in: "jasmine, tea tree, lemongrass, ginger" },
  { slug: "geraniol", name: "Geraniol", aroma_notes: ["floral", "rose", "sweet", "fruity"], flavor_notes: ["rose", "peach", "sweet"], also_found_in: "roses, geraniums, lemons" },
  { slug: "valencene", name: "Valencene", aroma_notes: ["citrus", "orange", "sweet", "fresh"], flavor_notes: ["orange", "citrus", "sweet"], also_found_in: "valencia oranges, grapefruit" },
  { slug: "eucalyptol", name: "Eucalyptol", aroma_notes: ["minty", "cooling", "eucalyptus", "fresh"], flavor_notes: ["mint", "menthol", "cooling"], also_found_in: "eucalyptus, rosemary, tea tree, bay leaves" },
  { slug: "camphene", name: "Camphene", aroma_notes: ["pine", "damp-woods", "fir", "musky"], flavor_notes: ["pine", "earthy", "herbal"], also_found_in: "fir needles, cypress, nutmeg, ginger" },
  { slug: "terpineol", name: "Terpineol", aroma_notes: ["floral", "lilac", "pine", "clove"], flavor_notes: ["floral", "citrus", "sweet"], also_found_in: "lilac, pine, lime blossoms" },
  { slug: "borneol", name: "Borneol", aroma_notes: ["minty", "camphor", "herbal", "earthy"], flavor_notes: ["mint", "menthol", "herbal"], also_found_in: "rosemary, mint, camphor, wormwood" },
  { slug: "fenchol", name: "Fenchol", aroma_notes: ["earthy", "camphor", "lemon", "pine"], flavor_notes: ["earthy", "citrus", "herbal"], also_found_in: "basil, nutmeg, pine" },
  { slug: "sabinene", name: "Sabinene", aroma_notes: ["spicy", "peppery", "citrus", "woody"], flavor_notes: ["spice", "citrus", "herbal"], also_found_in: "black pepper, nutmeg, tea tree, oak" },
  { slug: "phellandrene", name: "Phellandrene", aroma_notes: ["minty", "citrus", "peppery", "woody"], flavor_notes: ["mint", "citrus", "herbal"], also_found_in: "mint, dill, eucalyptus, ginger" },
  { slug: "carene", name: "Carene", aroma_notes: ["sweet", "pine", "citrus", "earthy"], flavor_notes: ["sweet", "pine", "citrus"], also_found_in: "pine, cedar, rosemary, basil, citrus" },
  { slug: "pulegone", name: "Pulegone", aroma_notes: ["minty", "camphor", "herbal", "sweet"], flavor_notes: ["mint", "menthol", "herbal"], also_found_in: "peppermint, catnip, rosemary" },
  { slug: "guaiol", name: "Guaiol", aroma_notes: ["pine", "woody", "rose", "earthy"], flavor_notes: ["pine", "woody", "floral"], also_found_in: "cypress pine, guaiacum" },
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
