/**
 * src/lib/pos/return-policy-core.ts  (Fix Phase 6F, G-67 / G-68)
 *
 * The owner's CUSTOMER RETURN POLICY as a setting, not code. PURE: no I/O,
 * safe on the iPad register, the back office and the server.
 *
 * Owner message 9 (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 *   "Right now we require they be a loyalty member. But after discussing the
 *    matter with my team, it would be better if this were changed to allow
 *    anyone to return products so long as they have the original packaging
 *    and the receipt to go with it and it falls within the 7 day return
 *    period. But because we are an enterprise grade platform, we shouldn't
 *    just change the behavior in code, we should allow it to be a setting in
 *    the register activity page, so we can toggle it on and off if we want
 *    to. I also want to have a setting for choosing a return window as well
 *    as the types of products we allow to be returned."
 *
 * What is a setting and what is not:
 *   - loyaltyRequired  (toggle)  - owner: "toggle it on and off". Default OFF
 *                                  (anyone may return), per the message.
 *   - windowDays       (number)  - owner: "choosing a return window". Default
 *                                  7. Purchase day = day 0, Pacific days.
 *   - excludedCategories         - owner: "the types of products we allow to
 *                                  be returned". Stored as the types NOT
 *                                  allowed, so a category added later is
 *                                  returnable until the owner unticks it
 *                                  (the "non-returnable item" pattern).
 *   - The ORIGINAL RECEIPT and ORIGINAL PACKAGING are NOT settings. The sale
 *     is found only by its printed receipt number, and WAC 314-55-079(12)
 *     allows a cannabis return only "in their original packaging with the
 *     lot, batch, or inventory ID number fully legible". The owner's message
 *     keeps both.
 */

export type PosReturnPolicyConfig = {
  /** true = only sales with a loyalty member attached may be returned. */
  loyaltyRequired: boolean;
  /** Whole Pacific days after the purchase day (purchase day = day 0). */
  windowDays: number;
  /** Category values (order_lines.category) that may NOT be returned. */
  excludedCategories: string[];
};

/** Owner message 9: "it falls within the 7 day return period". */
export const DEFAULT_RETURN_WINDOW_DAYS = 7;
export const MIN_RETURN_WINDOW_DAYS = 1;
export const MAX_RETURN_WINDOW_DAYS = 60;

/** The owner's new policy (message 9): anyone, 7 days, every product type. */
export const DEFAULT_POS_RETURN_POLICY: PosReturnPolicyConfig = {
  loyaltyRequired: false,
  windowDays: DEFAULT_RETURN_WINDOW_DAYS,
  excludedCategories: [],
};

/** Days of sales the receipt lookup and history panel scan: window + 2 days of slack. */
export const RETURN_LOOKUP_SLACK_DAYS = 2;

function cleanSlug(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * Normalize an untrusted value (site_settings JSON, cached menu bundle, form
 * payload). A missing row means the owner's message-9 default. A window
 * outside 1-60 is clamped; a non-number falls back to 7.
 */
export function normalizePosReturnPolicy(raw: unknown): PosReturnPolicyConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_POS_RETURN_POLICY, excludedCategories: [] };
  }
  const o = raw as Record<string, unknown>;
  const n = Number(o.windowDays);
  const windowDays = Number.isFinite(n)
    ? Math.min(MAX_RETURN_WINDOW_DAYS, Math.max(MIN_RETURN_WINDOW_DAYS, Math.floor(n)))
    : DEFAULT_RETURN_WINDOW_DAYS;
  const excluded = Array.isArray(o.excludedCategories)
    ? [...new Set(o.excludedCategories.map(cleanSlug).filter(Boolean))].sort()
    : [];
  return { loyaltyRequired: o.loyaltyRequired === true, windowDays, excludedCategories: excluded };
}

/** Validate a form save; plain-English errors, never a silent clamp on save. */
export function validateReturnPolicyDraft(input: {
  loyaltyRequired: unknown;
  windowDays: unknown;
  excludedCategories: unknown;
}): { ok: true; config: PosReturnPolicyConfig } | { ok: false; error: string } {
  const raw = typeof input.windowDays === "string" ? input.windowDays.trim() : input.windowDays;
  const n = Number(raw);
  if (raw === "" || raw == null || !Number.isInteger(n)) {
    return { ok: false, error: "Return window must be a whole number of days." };
  }
  if (n < MIN_RETURN_WINDOW_DAYS || n > MAX_RETURN_WINDOW_DAYS) {
    return { ok: false, error: `Return window must be between ${MIN_RETURN_WINDOW_DAYS} and ${MAX_RETURN_WINDOW_DAYS} days.` };
  }
  return {
    ok: true,
    config: normalizePosReturnPolicy({
      loyaltyRequired: input.loyaltyRequired === true,
      windowDays: n,
      excludedCategories: Array.isArray(input.excludedCategories) ? input.excludedCategories : [],
    }),
  };
}

/**
 * May a line of this category come back? A line with no category on record
 * (sales from before categories were stamped) cannot be classified, so it is
 * NOT blocked by the product-type setting; the window, the receipt and the
 * packaging checks still apply.
 */
export function categoryReturnable(policy: PosReturnPolicyConfig, category: string | null | undefined): boolean {
  const slug = cleanSlug(category);
  if (!slug) return true;
  return !policy.excludedCategories.includes(slug);
}

/** Why a line cannot be returned under the product-type setting, or null. */
export function lineNotReturnableReason(
  policy: PosReturnPolicyConfig,
  category: string | null | undefined,
  categoryLabel?: string | null,
): string | null {
  if (categoryReturnable(policy, category)) return null;
  const name = (categoryLabel ?? "").trim() || cleanSlug(category);
  return `${name} is not a returnable product type (store return policy, Register Activity \u2192 Return policy). Refuse the return of this item.`;
}

/** Days the receipt lookup and the history panel scan back. */
export function lookupWindowDays(policy: PosReturnPolicyConfig): number {
  return policy.windowDays + RETURN_LOOKUP_SLACK_DAYS;
}

function dayWord(n: number): string {
  return n === 1 ? "day" : "days";
}

/** One sentence for the Returns desk and the register's Return screen. */
export function returnPolicySummary(policy: PosReturnPolicyConfig, labelFor?: (v: string) => string): string {
  const who = policy.loyaltyRequired ? "Loyalty members only" : "Anyone";
  const base = `Store policy: ${who}, original receipt in hand, original packaging with the lot ID legible, within ${policy.windowDays} ${dayWord(policy.windowDays)} of purchase.`;
  if (policy.excludedCategories.length === 0) return `${base} All product types may be returned.`;
  const names = policy.excludedCategories.map((v) => (labelFor ? labelFor(v) : v));
  return `${base} Not returnable: ${names.join(", ")}.`;
}

/** The small grey line under "Return an item" on the register's More menu. */
export function returnPolicyShortLabel(policy: PosReturnPolicyConfig): string {
  const who = policy.loyaltyRequired ? "Loyalty members" : "Anyone with the receipt";
  return `${who}, ${policy.windowDays}-day window \u2014 manager PIN`;
}

/** The return-policy paragraph printed on the customer receipt by default. */
export function returnPolicyReceiptText(policy: PosReturnPolicyConfig): string {
  const days = policy.windowDays;
  return [
    `Returns accepted within ${days} ${dayWord(days)} of purchase (purchase day counts as day 0).`,
    policy.loyaltyRequired
      ? "Bring this receipt and the loyalty account used for the sale."
      : "Bring this receipt.",
    "Product must be in its original packaging with the lot/batch label legible.",
    "Refunds are issued to the original form of payment.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReturnPolicyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ return-policy-core: ${label}`);
    }
  };

  const d = normalizePosReturnPolicy(null);
  ok(d.loyaltyRequired === false && d.windowDays === 7 && d.excludedCategories.length === 0, "missing row = owner message 9: anyone, 7 days, all types");
  ok(normalizePosReturnPolicy({ loyaltyRequired: "yes" }).loyaltyRequired === false, "only a literal true turns loyalty-only on");
  ok(normalizePosReturnPolicy({ loyaltyRequired: true }).loyaltyRequired === true, "loyalty-only toggles on");
  ok(normalizePosReturnPolicy({ windowDays: 0 }).windowDays === 1, "window clamped up to 1");
  ok(normalizePosReturnPolicy({ windowDays: 999 }).windowDays === 60, "window clamped down to 60");
  ok(normalizePosReturnPolicy({ windowDays: "abc" }).windowDays === 7, "garbage window falls back to 7");
  ok(normalizePosReturnPolicy({ windowDays: 15 }).windowDays === 15, "15 days kept");
  const ex = normalizePosReturnPolicy({ excludedCategories: [" Edible-Solid ", "edible-solid", "", 4, "topical"] });
  ok(JSON.stringify(ex.excludedCategories) === JSON.stringify(["edible-solid", "topical"]), "categories trimmed, lowercased, de-duplicated, sorted");

  ok(!validateReturnPolicyDraft({ loyaltyRequired: false, windowDays: "", excludedCategories: [] }).ok, "blank window refused");
  ok(!validateReturnPolicyDraft({ loyaltyRequired: false, windowDays: "7.5", excludedCategories: [] }).ok, "fractional window refused");
  ok(!validateReturnPolicyDraft({ loyaltyRequired: false, windowDays: "0", excludedCategories: [] }).ok, "0-day window refused on save");
  ok(!validateReturnPolicyDraft({ loyaltyRequired: false, windowDays: "61", excludedCategories: [] }).ok, "61-day window refused on save");
  const v = validateReturnPolicyDraft({ loyaltyRequired: true, windowDays: " 10 ", excludedCategories: ["merch"] });
  ok(v.ok && v.config.windowDays === 10 && v.config.loyaltyRequired && v.config.excludedCategories[0] === "merch", "valid draft saved as typed");

  const p = normalizePosReturnPolicy({ excludedCategories: ["edible-solid"] });
  ok(!categoryReturnable(p, "edible-solid"), "excluded type blocked");
  ok(!categoryReturnable(p, " EDIBLE-SOLID "), "excluded type blocked regardless of case/space");
  ok(categoryReturnable(p, "flower"), "other types allowed");
  ok(categoryReturnable(p, null) && categoryReturnable(p, ""), "a line with no category is not blocked by the type setting");
  ok(lineNotReturnableReason(p, "flower") === null, "allowed line has no reason");
  const why = lineNotReturnableReason(p, "edible-solid", "Edible (Solid)") ?? "";
  ok(why.startsWith("Edible (Solid) is not a returnable product type"), "blocked line names the type");

  ok(lookupWindowDays(d) === 9, "lookup scans the window + 2 days");
  ok(returnPolicySummary(d).includes("Anyone") && returnPolicySummary(d).includes("7 days") && returnPolicySummary(d).includes("All product types"), "summary: anyone, 7 days, all types");
  ok(returnPolicySummary({ ...p, loyaltyRequired: true }, (v) => v.toUpperCase()).includes("Not returnable: EDIBLE-SOLID"), "summary names excluded types with labels");
  ok(returnPolicySummary({ ...d, windowDays: 1 }).includes("within 1 day of"), "singular day");
  ok(returnPolicyShortLabel(d) === "Anyone with the receipt, 7-day window \u2014 manager PIN", "short label (anyone)");
  ok(returnPolicyShortLabel({ ...d, loyaltyRequired: true }).startsWith("Loyalty members, 7-day"), "short label (loyalty only)");
  const paper = returnPolicyReceiptText(d);
  ok(paper.includes("within 7 days") && !paper.includes("loyalty"), "receipt paragraph: 7 days, no loyalty line when anyone may return");
  ok(returnPolicyReceiptText({ ...d, loyaltyRequired: true }).includes("loyalty account"), "receipt paragraph mentions loyalty when required");
  return { passed, failed };
}
