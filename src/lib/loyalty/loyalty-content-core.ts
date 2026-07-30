/**
 * src/lib/loyalty/loyalty-content-core.ts
 *
 * SLICE 108 — the PURE single source of truth for the EDITABLE friendly copy
 * on the public /loyalty page.
 *
 * DESIGN (grounded in src/components/loyalty/LoyaltySignupForm.tsx and
 * src/components/loyalty/LoyaltyProgramTerms.tsx, plus the audit in
 * slice108_audit.md):
 *
 *   - Only PRESENTATIONAL copy is editable — the birthday-perk helper line,
 *     the submit-button label, the post-signup thank-you heading, and the
 *     three friendly headings on the "Program terms" section (eyebrow, title,
 *     "Member tiers"). Every fallback below is BYTE-FOR-BYTE identical to what
 *     the page ships today, so seeding produces zero visible change until a
 *     staff member edits and publishes a block (same live-look-safe contract
 *     as SLICE 105/106/107).
 *
 *   - COMPLIANCE / LEGAL text stays FIXED in the component and is NEVER
 *     editable:
 *       * The marketing-consent disclosure (TCPA: STOP opt-out, ATDS, "Consent
 *         is not a condition of purchase", legal-age affirmation) lives in
 *         LoyaltySignupForm as `consentText`.
 *       * The register-mechanics paragraph on the terms card ("Points accrue on
 *         the pre-tax subtotal after discounts. Discounts never stack …") states
 *         how the register actually pays and must not drift.
 *       * The form field labels + required markers (form integrity).
 *
 *   - REGISTER-TRUTH numbers stay LIVE and are NEVER editable text: every
 *     figure on the terms card (earn / value / redeem / signup bonus / expiry
 *     lines and the tier ladder) derives from the SAME loyalty_config + tiers
 *     the register pays with (src/lib/loyalty/program-terms-core.ts +
 *     loyalty-store). An editable block can therefore never advertise terms
 *     that differ from what the POS actually pays.
 *
 * Storage: content_blocks rows only — field_type / draft_value /
 * published_value are plain unconstrained text columns
 * (supabase/migrations/0005_slice5_cms.sql L100-102) and field_type has NO
 * CHECK, so the new "plain" blocks need NO migration — the same basis as
 * SLICE 105 "select", 106 "richjson", and 107 "plain".
 */

// ---------------------------------------------------------------------------
// Editable copy registry (each entry is a plain content block).
// ---------------------------------------------------------------------------

/**
 * One editable copy block on the Loyalty page. `fallback` MUST be byte-for-byte
 * identical to the copy currently rendered by the loyalty components.
 */
export type LoyaltyContentBlock = {
  /** content_blocks.block_key */
  key: string;
  /** Which part of the page this block lives in (for the admin editor groups). */
  section: "signup" | "terms";
  /** Friendly label shown in the admin editor. */
  label: string;
  /** Optional helper line under the field in the admin editor. */
  help?: string;
  /** Byte-identical live copy — the seed default and public fallback. */
  fallback: string;
};

/**
 * The curated list of editable Loyalty copy blocks, in the order they appear
 * on the page. Every `fallback` is copied verbatim from the components
 * (SLICE 108 audit F2/F3).
 */
export const LOYALTY_CONTENT_BLOCKS: readonly LoyaltyContentBlock[] = [
  // ---- Signup form (client component; copy arrives via props) --------------
  {
    key: "loyalty.form.birthday_help",
    section: "signup",
    label: "Birthday field — helper line",
    help: "The small note under the Birthday field on the signup form.",
    fallback: "Get special discounts and offers on your birthday!",
  },
  {
    key: "loyalty.form.submit_label",
    section: "signup",
    label: "Sign-up button label",
    help: "The big button customers tap to submit the form.",
    fallback: "Sign Up",
  },
  {
    key: "loyalty.form.success_title",
    section: "signup",
    label: "After sign-up — thank-you heading",
    help: "Shown once a signup is submitted successfully.",
    fallback: "Thank you — your signup was submitted.",
  },
  // ---- Program terms card (server component) -------------------------------
  {
    key: "loyalty.terms.eyebrow",
    section: "terms",
    label: "Program terms — eyebrow",
    help: "The small gold label above the “Program terms” title.",
    fallback: "How Greenway Points work",
  },
  {
    key: "loyalty.terms.title",
    section: "terms",
    label: "Program terms — title",
    fallback: "Program terms",
  },
  {
    key: "loyalty.terms.tiers_heading",
    section: "terms",
    label: "Member tiers — heading",
    help: "The heading above the member-tier table (the numbers below stay live).",
    fallback: "Member tiers",
  },
] as const;

/** Every editable Loyalty block key (for a one-shot getContentValues fetch). */
export const LOYALTY_CONTENT_KEYS: readonly string[] = LOYALTY_CONTENT_BLOCKS.map(
  (b) => b.key,
);

/** Fast lookup: block_key -> byte-identical fallback copy. */
const LOYALTY_FALLBACKS: Record<string, string> = Object.fromEntries(
  LOYALTY_CONTENT_BLOCKS.map((b) => [b.key, b.fallback]),
);

/** The byte-identical fallback for a Loyalty block key ("" if unknown). */
export function loyaltyContentFallback(key: string): string {
  return LOYALTY_FALLBACKS[key] ?? "";
}

/**
 * Resolve a Loyalty block's display value from a fetched values record, with a
 * guaranteed byte-identical fallback. A blank/whitespace-only stored value
 * falls back to the shipped copy so the page can never render an empty line.
 */
export function resolveLoyaltyValue(
  key: string,
  values: Record<string, string> | null | undefined,
): string {
  const fallback = loyaltyContentFallback(key);
  const raw = values?.[key];
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed.length ? raw : fallback;
}

/** Is this block_key one of the editable Loyalty copy blocks? */
export function isLoyaltyContentBlock(key: string | null | undefined): boolean {
  return !!key && key in LOYALTY_FALLBACKS;
}

// ---------------------------------------------------------------------------
// Pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runLoyaltyContentCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("loyalty-content-core: " + msg);
    passed += 1;
  };

  // ---- Registry shape ------------------------------------------------------
  ok(LOYALTY_CONTENT_BLOCKS.length === 6, "6 editable Loyalty copy blocks");
  ok(LOYALTY_CONTENT_KEYS.length === LOYALTY_CONTENT_BLOCKS.length, "keys mirror blocks");

  // Keys are unique + well-formed; sections are one of the two known groups.
  const seen = new Set<string>();
  for (const b of LOYALTY_CONTENT_BLOCKS) {
    ok(!seen.has(b.key), `duplicate key: ${b.key}`);
    seen.add(b.key);
    ok(b.key.startsWith("loyalty."), `${b.key} is namespaced under loyalty.`);
    ok(b.section === "signup" || b.section === "terms", `${b.key} has a known section`);
    ok(b.label.trim().length > 0, `${b.key} has a label`);
    ok(b.fallback.trim().length > 0, `${b.key} has non-empty byte-identical copy`);
  }

  // Section membership is exactly as designed (3 signup + 3 terms).
  ok(
    LOYALTY_CONTENT_BLOCKS.filter((b) => b.section === "signup").length === 3,
    "3 signup-form copy blocks",
  );
  ok(
    LOYALTY_CONTENT_BLOCKS.filter((b) => b.section === "terms").length === 3,
    "3 program-terms copy blocks",
  );

  // ---- Byte-identical fallbacks (verbatim from the components) -------------
  ok(
    loyaltyContentFallback("loyalty.form.birthday_help") ===
      "Get special discounts and offers on your birthday!",
    "birthday_help fallback exact",
  );
  ok(loyaltyContentFallback("loyalty.form.submit_label") === "Sign Up", "submit_label fallback exact");
  ok(
    loyaltyContentFallback("loyalty.form.success_title") ===
      "Thank you — your signup was submitted.",
    "success_title fallback exact",
  );
  ok(
    loyaltyContentFallback("loyalty.terms.eyebrow") === "How Greenway Points work",
    "terms.eyebrow fallback exact",
  );
  ok(loyaltyContentFallback("loyalty.terms.title") === "Program terms", "terms.title fallback exact");
  ok(
    loyaltyContentFallback("loyalty.terms.tiers_heading") === "Member tiers",
    "tiers_heading fallback exact",
  );
  ok(loyaltyContentFallback("nope") === "", "unknown key fallback = ''");

  // ---- isLoyaltyContentBlock ----------------------------------------------
  ok(isLoyaltyContentBlock("loyalty.form.submit_label"), "submit_label is a copy block");
  ok(isLoyaltyContentBlock("loyalty.terms.title"), "terms.title is a copy block");
  // The pre-existing hero blocks (SiteText / section builder) are NOT in this
  // registry — they have their own editors.
  ok(!isLoyaltyContentBlock("loyalty.hero.title"), "hero.title is not in this registry");
  ok(!isLoyaltyContentBlock("loyalty.hero.image"), "hero.image is not in this registry");
  ok(!isLoyaltyContentBlock(""), "empty key is not a copy block");
  ok(!isLoyaltyContentBlock(null), "null key is not a copy block");

  // ---- resolveLoyaltyValue safety -----------------------------------------
  ok(
    resolveLoyaltyValue("loyalty.form.submit_label", null) === "Sign Up",
    "null values -> fallback",
  );
  ok(
    resolveLoyaltyValue("loyalty.form.submit_label", {}) === "Sign Up",
    "missing key -> fallback",
  );
  ok(
    resolveLoyaltyValue("loyalty.form.submit_label", { "loyalty.form.submit_label": "   " }) ===
      "Sign Up",
    "blank stored value -> fallback",
  );
  // A real edit is honoured verbatim.
  ok(
    resolveLoyaltyValue("loyalty.form.submit_label", {
      "loyalty.form.submit_label": "Join now",
    }) === "Join now",
    "real edit is honoured verbatim",
  );

  return { passed };
}
