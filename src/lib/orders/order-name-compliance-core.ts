/**
 * src/lib/orders/order-name-compliance-core.ts
 *
 * SLICE 113 — a light I-502 sanity nudge for order-pool names (pure, no imports).
 *
 * Order names are PUBLIC-FACING text (they show on the customer's confirmation
 * page, in the confirmation email, and on the printed pickup ticket). WA I-502
 * marketing rules (WAC 314-55-155) prohibit anything that is especially
 * appealing to minors, and a professional public-facing surface should avoid
 * profanity. This module gives the admin a friendly, NON-BLOCKING heads-up —
 * Michael always decides. It never prevents a save; it only surfaces a caution.
 *
 * Deliberately conservative + explainable: whole-word matching against small,
 * transparent lists (no opaque model), so a false positive is obvious and easy
 * to dismiss. Imported by client + server, so no server-only code.
 */

/** Terms that read as appealing to minors (cartoon/candy/kid cues). WAC 314-55-155. */
const APPEAL_TO_MINORS_TERMS = [
  "cartoon",
  "candy",
  "candyland",
  "gummy",
  "gummies",
  "lollipop",
  "cookie monster",
  "spongebob",
  "pokemon",
  "unicorn",
  "kiddie",
  "kids",
  "kid",
  "child",
  "children",
  "toddler",
  "juicebox",
  "juice box",
  "cereal",
  "playground",
  "recess",
  "cutie",
  "clown",
  "mascot",
  "sponge bob",
];

/** Mild profanity to keep public receipts/emails professional. */
const MILD_PROFANITY_TERMS = [
  "damn",
  "hell",
  "crap",
  "ass",
  "arse",
  "bitch",
  "bastard",
  "piss",
  "dick",
  "shit",
  "fuck",
  "thug", // "Nugs4Thugs" example — flag as a tone nudge, not a block
  "thugs",
];

export type OrderNameReviewLevel = "ok" | "caution";

export type OrderNameReview = {
  level: OrderNameReviewLevel;
  /** Human-readable reasons (empty when ok). */
  reasons: string[];
  /** The specific matched terms, for highlighting in the UI. */
  matches: string[];
};

/**
 * Lowercase + strip everything but letters/numbers/spaces, then split on digit
 * runs so "leetspeak" style names ("Nugs4Thugs") separate into real words
 * ("nugs 4 thugs") the whole-word matcher can see — WITHOUT reintroducing the
 * substring false positives ("class"→"ass") that plain includes() would cause.
 */
function scrub(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/(\d+)/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whole-word / phrase presence: pads with spaces so "ass" matches "ass" and
 * "bad ass" but NOT "class" or "assortment". Multi-word terms match as phrases.
 */
function containsTerm(padded: string, term: string): boolean {
  return padded.includes(` ${term} `);
}

/**
 * Review an order-pool name for I-502 public-facing appropriateness. Returns a
 * NON-BLOCKING caution when it trips a heuristic; otherwise "ok". Never throws.
 */
export function reviewOrderName(name: string): OrderNameReview {
  const padded = ` ${scrub(name)} `;
  const matches: string[] = [];
  const reasons: string[] = [];

  const minorHits = APPEAL_TO_MINORS_TERMS.filter((t) => containsTerm(padded, t));
  if (minorHits.length > 0) {
    matches.push(...minorHits);
    reasons.push(
      "May read as appealing to minors (WA I-502 / WAC 314-55-155 marketing rules).",
    );
  }

  const profanityHits = MILD_PROFANITY_TERMS.filter((t) => containsTerm(padded, t));
  if (profanityHits.length > 0) {
    matches.push(...profanityHits);
    reasons.push("Contains language that may read as unprofessional on a public receipt.");
  }

  return {
    level: reasons.length > 0 ? "caution" : "ok",
    reasons,
    matches: Array.from(new Set(matches)),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runOrderNameComplianceTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[order-name-compliance] FAIL: ${msg}`);
    }
  };

  ok(reviewOrderName("High Life").level === "ok", "clean name → ok");
  ok(reviewOrderName("Green Dream").level === "ok", "another clean name → ok");
  ok(reviewOrderName("").level === "ok", "empty → ok");

  const minor = reviewOrderName("Candy Land Gummies");
  ok(minor.level === "caution", "candy/gummies → caution");
  ok(minor.matches.includes("candy") && minor.matches.includes("gummies"), "reports the matched terms");
  ok(
    minor.reasons.some((r) => r.toLowerCase().includes("minor")),
    "explains the appeal-to-minors concern",
  );

  ok(reviewOrderName("Nugs4Thugs").level === "caution", "thug tone → caution");
  ok(reviewOrderName("Damn Good Weed").level === "caution", "mild profanity → caution");

  // Whole-word guard: no false positives on innocent substrings
  ok(reviewOrderName("Classy Order").level === "ok", "'class' does not match 'ass'");
  ok(reviewOrderName("Assortment Pack").level === "ok", "'assortment' does not match 'ass'");
  ok(reviewOrderName("Shell Beach").level === "ok", "'shell' does not match 'hell'");

  // Punctuation is scrubbed so it can't hide a term
  ok(reviewOrderName("C.a.n.d.y").level === "ok", "dotted letters do not form 'candy' (scrubbed to words)");
  ok(reviewOrderName("candy!!!").level === "caution", "trailing punctuation still flags 'candy'");

  return { passed, failed };
}
