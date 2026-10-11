/**
 * src/lib/loyalty/loyalty-consent-core.ts
 *
 * R41 S5 — the marketing-consent wording on the /loyalty signup form is now
 * EDITABLE by the owner (owner directive R41 Q9: "it's mine to edit, please let
 * me edit it"). This PURE core holds:
 *
 *   - the content block key and the byte-identical default wording (moved here
 *     verbatim from LoyaltySignupForm.tsx, which keeps `const consentText =` as
 *     the resolved value);
 *   - `checkConsentText()` — a plain-English checklist the editor shows under
 *     the textarea. It NEVER blocks a publish except for an empty paragraph (an
 *     empty label next to the checkbox is never a valid disclosure). Every other
 *     item is a warning the owner may accept.
 *   - `publishedConsentFromRow()` — how the SERVER picks the authoritative
 *     wording to record with a signup (published value only, never a draft).
 *
 * Source for the law-derived items: 47 CFR 64.1200(f)(9) "prior express written
 * consent" (pasted verbatim in docs/roadmap/R41-WEBSITE-EDITOR-BIBLE.md, S5
 * 5.0), (f)(3) "clear and conspicuous", and (a)(10) revocation. The STOP and
 * "rates may apply" items are INDUSTRY PRACTICE (CTIA messaging principles),
 * labelled as practice, not law. The age item is a store rule (21+).
 *
 * This file has no crypto: the SHA-256 fingerprint is computed in the server
 * write path with node:crypto (src/lib/loyalty/signup.ts), the same pattern as
 * src/lib/payments/ach-esign-store.ts.
 *
 * This is not legal advice; the checklist says so in the editor.
 */

/** content_blocks.block_key for the consent paragraph. */
export const LOYALTY_CONSENT_BLOCK = "loyalty.form.consent_text";

/** Longest consent paragraph the server will record (characters). */
export const MAX_CONSENT_TEXT = 4000;

/**
 * The shipped wording, BYTE-FOR-BYTE identical to the literal that lived in
 * src/components/loyalty/LoyaltySignupForm.tsx (L9-L10) before R41 S5.
 */
export const DEFAULT_CONSENT_TEXT =
  "By signing up, I consent to enroll in the member list, understanding that I will receive marketing communications, including, but not limited to, advertisements, through text messages, calls either through an automatic telephone dialing system or artificial or prerecorded voice call, emails, or other outreach channels. By doing so, I understand that I am allowing Greenway Marijuana to retain my personal contact details and engagement history for use in personalized marketing communications. I understand that I may opt-out of text messages at any time by replying \"STOP\". Standard messaging and calling rates may apply. I affirm that I am of legal age to receive communications related to the services and products being advertised. Consent is not a condition of purchase.";

export const CFR_64_1200_URL = "https://www.law.cornell.edu/cfr/text/47/64.1200";
export const CTIA_PRINCIPLES_URL =
  "https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf";

export type ConsentCheckCode =
  | "W-EMPTY"
  | "W-ATDS"
  | "W-SELLER"
  | "W-NOT-CONDITION"
  | "W-STOP"
  | "W-RATES"
  | "W-AGE";

export type ConsentCheckItem = {
  code: ConsentCheckCode;
  ok: boolean;
  /** law = from the CFR text; practice = industry practice; store = Greenway rule. */
  level: "law" | "practice" | "store";
  /** Short checklist line. */
  label: string;
  /** Plain-English "why" shown under the line. */
  explain: string;
  /** Where the rule comes from (link). */
  source: string;
};

export type ConsentCheck = {
  /** True only when the paragraph cannot be published (empty). */
  blocking: boolean;
  items: ConsentCheckItem[];
  /** How many non-blocking items are missing. */
  warnings: number;
};

/** Lower-case, curly quotes → straight, collapse whitespace. */
export function normalizeForMatch(text: string): string {
  return String(text ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ATDS_PATTERNS: RegExp[] = [
  /automatic telephone dialing system/,
  /automated telephone dialing system/,
  /auto-?dial(l)?er/,
  /automated (technology|means|system)/,
  /artificial or pre-?recorded voice/,
  /pre-?recorded (voice|message)/,
  /artificial voice/,
];

const NOT_CONDITION_PATTERNS: RegExp[] = [
  /not (a |any )?condition of (any )?(purchase|purchasing|buying|sale)/,
  /not required (to [^.]{0,120})?(as a )?condition of (any )?(purchase|purchasing|buying)/,
  /not required to [^.]{0,80}(purchase|buy)/,
  /no purchase (is )?(necessary|required)/,
  /(purchase|buying) is not required/,
];

const RATES_PATTERNS: RegExp[] = [
  /(msg|message|messaging|text|data|calling)[^.]{0,30}rates? (may|might|will|could) apply/,
  /rates? (may|might|will|could) apply/,
  /(fees|charges) (may|might|will|could) apply/,
];

const AGE_PATTERNS: RegExp[] = [
  /\b21\b/,
  /twenty-?one/,
  /legal age/,
  /of age\b/,
  /\badult/,
];

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * The editor checklist. `sellerName` defaults to the store's legal trade name;
 * the word "Greenway" alone also counts (the CFR requires authorizing "the
 * seller" — naming the seller makes that clear).
 */
export function checkConsentText(
  text: string | null | undefined,
  opts: { sellerName?: string } = {},
): ConsentCheck {
  const t = normalizeForMatch(text ?? "");
  const seller = normalizeForMatch(opts.sellerName ?? "Greenway Marijuana");
  const empty = t.length === 0;

  const items: ConsentCheckItem[] = [
    {
      code: "W-EMPTY",
      ok: !empty,
      level: "law",
      label: "The paragraph is not empty",
      explain:
        "The checkbox needs wording next to it. The rule asks for a clear disclosure the customer agrees to, so an empty paragraph can't be published.",
      source: CFR_64_1200_URL,
    },
    {
      code: "W-ATDS",
      ok: !empty && anyMatch(t, ATDS_PATTERNS),
      level: "law",
      label: "Says you may text or call using automated technology",
      explain:
        "The federal definition of written consent says the customer authorizes messages \u201cusing an automatic telephone dialing system or an artificial or prerecorded voice.\u201d Words like \u201cautodialer\u201d or \u201cprerecorded voice\u201d also count.",
      source: CFR_64_1200_URL,
    },
    {
      code: "W-SELLER",
      ok: !empty && (t.includes(seller) || t.includes("greenway")),
      level: "law",
      label: "Names Greenway as the sender",
      explain:
        "The consent must authorize \u201cthe seller\u201d to send the messages. Naming Greenway Marijuana makes it clear who the customer is agreeing to hear from.",
      source: CFR_64_1200_URL,
    },
    {
      code: "W-NOT-CONDITION",
      ok: !empty && anyMatch(t, NOT_CONDITION_PATTERNS),
      level: "law",
      label: "Says signing up is not required to buy anything",
      explain:
        "The rule requires telling the customer they don\u2019t have to agree \u201cas a condition of purchasing any property, goods, or services.\u201d For example: \u201cConsent is not a condition of purchase.\u201d",
      source: CFR_64_1200_URL,
    },
    {
      code: "W-STOP",
      ok: !empty && /\bstop\b/.test(t),
      level: "practice",
      label: "Tells people they can reply STOP to opt out",
      explain:
        "CTIA\u2019s Messaging Principles (section 5.1.3) say standard \u201cSTOP\u201d wording should be used for opt-out instructions, and the FCC rule treats a reply of \u201cstop\u201d as a valid way to revoke consent (47 CFR 64.1200(a)(10)). Customers may also opt out any other reasonable way, so don\u2019t say STOP is the only way.",
      source: CTIA_PRINCIPLES_URL,
    },
    {
      code: "W-RATES",
      ok: !empty && anyMatch(t, RATES_PATTERNS),
      level: "practice",
      label: "Says message and data rates may apply",
      explain:
        "CTIA\u2019s Messaging Principles (section 5.1.1) ask sign-up wording to tell customers about \u201cany associated fees or charges.\u201d The usual wording is \u201cMessage and data rates may apply.\u201d",
      source: CTIA_PRINCIPLES_URL,
    },
    {
      code: "W-AGE",
      ok: !empty && anyMatch(t, AGE_PATTERNS),
      level: "store",
      label: "Says the customer is of legal age (21+)",
      explain:
        "Greenway only markets to adults 21 and over, so the paragraph should have the customer confirm their age.",
      source: "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-155",
    },
  ];

  const warnings = items.filter((i) => i.code !== "W-EMPTY" && !i.ok).length;
  return { blocking: empty, items, warnings };
}

/**
 * Pick the wording the SERVER records with a signup: the PUBLISHED value only
 * (never a draft), falling back to the shipped default when the block is
 * missing, unpublished, or blank. Mirrors getContentForRender's non-preview
 * branch plus resolveLoyaltyValue's blank → default rule.
 */
export function publishedConsentFromRow(
  row: { published_value: string | null; status: string | null } | null | undefined,
): string {
  if (!row) return DEFAULT_CONSENT_TEXT;
  if (row.status !== "published") return DEFAULT_CONSENT_TEXT;
  const v = row.published_value;
  if (typeof v !== "string" || v.trim().length === 0) return DEFAULT_CONSENT_TEXT;
  return v.length > MAX_CONSENT_TEXT ? v.slice(0, MAX_CONSENT_TEXT) : v;
}

/** True when a Postgres/PostgREST error means "the 0264 columns aren't there yet". */
export function isMissingConsentColumnError(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  const m = String(err.message ?? "").toLowerCase();
  return m.includes("consent_text");
}

// ---------------------------------------------------------------------------
// Pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runLoyaltyConsentTests(): { passed: number; failed: number } {
  // Throws on the first failed assertion, so `failed` is always 0 when it returns.
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("loyalty-consent-core: " + msg);
    passed += 1;
  };
  const missing = (text: string) =>
    checkConsentText(text)
      .items.filter((i) => !i.ok)
      .map((i) => i.code)
      .sort()
      .join(",");

  // The shipped wording passes every item.
  const d = checkConsentText(DEFAULT_CONSENT_TEXT);
  ok(!d.blocking, "default not blocking");
  ok(d.warnings === 0, "default has 0 warnings");
  ok(d.items.length === 7, "7 checklist items");
  ok(d.items.every((i) => i.ok), "default passes every item");
  ok(DEFAULT_CONSENT_TEXT.includes('replying "STOP"'), "default keeps the STOP sentence");
  ok(DEFAULT_CONSENT_TEXT.endsWith("Consent is not a condition of purchase."), "default ends with not-a-condition");
  ok(DEFAULT_CONSENT_TEXT.length === 777, "default length pinned (777)");

  // Removing one sentence flags exactly that item.
  const noStop = DEFAULT_CONSENT_TEXT.replace(
    ' I understand that I may opt-out of text messages at any time by replying "STOP".',
    "",
  );
  ok(noStop !== DEFAULT_CONSENT_TEXT, "STOP sentence found for removal");
  ok(missing(noStop) === "W-STOP", "no STOP → only W-STOP");
  const noCond = DEFAULT_CONSENT_TEXT.replace(" Consent is not a condition of purchase.", "");
  ok(noCond !== DEFAULT_CONSENT_TEXT, "condition sentence found");
  ok(missing(noCond) === "W-NOT-CONDITION", "no condition sentence → only W-NOT-CONDITION");
  const noRates = DEFAULT_CONSENT_TEXT.replace(" Standard messaging and calling rates may apply.", "");
  ok(missing(noRates) === "W-RATES", "no rates → only W-RATES");
  const noAge = DEFAULT_CONSENT_TEXT.replace(
    " I affirm that I am of legal age to receive communications related to the services and products being advertised.",
    "",
  );
  ok(missing(noAge) === "W-AGE", "no age → only W-AGE");
  const noAtds = DEFAULT_CONSENT_TEXT.replace(
    " calls either through an automatic telephone dialing system or artificial or prerecorded voice call,",
    "",
  );
  ok(missing(noAtds) === "W-ATDS", "no ATDS → only W-ATDS");
  const noSeller = DEFAULT_CONSENT_TEXT.replace("Greenway Marijuana", "the store");
  ok(missing(noSeller) === "W-SELLER", "no seller → only W-SELLER");

  // Empty / whitespace → blocking; every other item false too.
  for (const e of ["", "   ", "\n\n\t"]) {
    const c = checkConsentText(e);
    ok(c.blocking, `blank ${JSON.stringify(e)} blocks`);
    ok(c.items.every((i) => !i.ok), "blank fails every item");
  }
  ok(checkConsentText(null).blocking, "null blocks");
  ok(checkConsentText(undefined).blocking, "undefined blocks");

  // Synonyms + case + curly quotes + line breaks.
  const alt =
    "Greenway may send TEXTS using an AUTODIALER.\nReply \u201cStop\u201d to cancel. Msg & data rates may apply.\nYou must be 21+.\nNo purchase necessary.";
  ok(missing(alt) === "", "synonym wording passes everything");
  ok(missing("Greenway uses prerecorded messages. Consent is not a condition of buying. stop. rates may apply. adults only") === "", "more synonyms pass");
  ok(missing(noRates + " Carrier fees may apply.") === "", "'fees may apply' counts as the rates line");
  ok(!checkConsentText("Greenway").blocking, "short text not blocking");
  ok(checkConsentText("Greenway").warnings === 5, "short text warns 5");
  ok(!/\bstop\b/.test(normalizeForMatch("unstoppable deals")), "'unstoppable' is not STOP");
  ok(missing("Greenway Marijuana. unstoppable. autodialer. 21. rates may apply. not a condition of purchase") === "W-STOP", "STOP is whole-word");

  // Levels: law items are the CFR ones.
  const lv = Object.fromEntries(d.items.map((i) => [i.code, i.level]));
  ok(lv["W-ATDS"] === "law" && lv["W-SELLER"] === "law" && lv["W-NOT-CONDITION"] === "law", "law items");
  ok(lv["W-STOP"] === "practice" && lv["W-RATES"] === "practice", "practice items");
  ok(lv["W-AGE"] === "store", "store item");
  ok(d.items.every((i) => /^https:\/\//.test(i.source)), "every item cites an https source");

  // publishedConsentFromRow — published only, never a draft.
  ok(publishedConsentFromRow(null) === DEFAULT_CONSENT_TEXT, "no row → default");
  ok(publishedConsentFromRow({ published_value: "X", status: "draft" }) === DEFAULT_CONSENT_TEXT, "draft status → default");
  ok(publishedConsentFromRow({ published_value: null, status: "published" }) === DEFAULT_CONSENT_TEXT, "null value → default");
  ok(publishedConsentFromRow({ published_value: "  ", status: "published" }) === DEFAULT_CONSENT_TEXT, "blank → default");
  ok(publishedConsentFromRow({ published_value: "Mine\nnew", status: "published" }) === "Mine\nnew", "published honoured verbatim (keeps line breaks)");
  ok(publishedConsentFromRow({ published_value: "a".repeat(5000), status: "published" }).length === MAX_CONSENT_TEXT, "capped at MAX");

  // Missing-column detection.
  ok(isMissingConsentColumnError({ code: "42703" }), "42703");
  ok(isMissingConsentColumnError({ code: "PGRST204", message: "x" }), "PGRST204");
  ok(isMissingConsentColumnError({ message: "Could not find the 'consent_text' column" }), "message match");
  ok(!isMissingConsentColumnError({ code: "23505", message: "duplicate" }), "other error");
  ok(!isMissingConsentColumnError(null), "null error");

  ok(LOYALTY_CONSENT_BLOCK === "loyalty.form.consent_text", "block key");
  return { passed, failed: 0 };
}
