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
  strain_type: "indica" | "sativa" | "hybrid";
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
