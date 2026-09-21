/**
 * SENDABILITY TRIAGE -- decide what can go to Leafly, and explain the rest
 * in words the owner can act on.
 *
 * ###########################################################################
 * # WHY THIS MODULE EXISTS                                                  #
 * #                                                                        #
 * # The owner reported three separate failures that are really one missing #
 * # capability:                                                            #
 * #                                                                        #
 * #   (ask 4) "i want the ability to send the products that do pass        #
 * #            leafly's contract skipping the bad ones ... listing them    #
 * #            with the button that directs me to the area to fix it."     #
 * #                                                                        #
 * #   (ask 7) "i tried doing a full menu push, and i get another error     #
 * #            ... it did not give me the option to send the good products #
 * #            and withhold the bad ones. nor does it let me fix the bad   #
 * #            ones."                                                      #
 * #                                                                        #
 * #   (ask 5) "i don't understand product ids, nor are they a useful way   #
 * #            to identify products ... they should not be the product id, #
 * #            but the names of the product, the barcode, vendor perhaps"  #
 * #                                                                        #
 * # Today a push is all-or-nothing and the failure is reported as a wall   #
 * # of opaque ids. 124 errors arrive as 124 hex strings. This module turns #
 * # a validation result into a DECISION (what may be sent now) plus a      #
 * # WORK LIST (what is held back, named in human terms, each with the      #
 * # address of the page that fixes it).                                    #
 * ###########################################################################
 *
 * DESIGN RULES, each of which exists because breaking it caused a real bug:
 *
 *   1. NEVER silently drop a product. Anything withheld appears in `blocked`
 *      with a reason. A push that quietly sends 2,438 of 2,562 products and
 *      says "success" is worse than one that fails loudly.
 *
 *   2. NEVER lead with an id. The id is a parenthetical at the END of a
 *      sentence that begins with the product's name. Ids remain present
 *      because support and logs need them -- they are just demoted.
 *
 *   3. NEVER offer a fix link that might be wrong. A link to the wrong
 *      product is worse than no link, because the owner will edit the wrong
 *      product and believe the job is done. When the target cannot be
 *      determined the entry carries `fixHref: null` and says so.
 *
 *   4. Repeated defects are ONE line of work, not N. The owner asked: "if
 *      the fix is something simple, that could be blanket applied to many
 *      products, please build that into the system". Blocked products are
 *      therefore grouped by defect signature.
 *
 * AUTHORITATIVE ANCHOR
 *   Whether a product is sendable is decided by Leafly's published schema,
 *   vendored at `docs/leafly-specs/schemas/v2-items.json` (md5 recorded in
 *   `docs/leafly-specs/SOURCES.md`). This module does not re-implement that
 *   schema -- it CONSUMES the findings produced by
 *   `payload-validate-core.ts`, which validates against it. Keeping exactly
 *   one validator is deliberate: two would drift, and the one the push uses
 *   would win while the one the UI shows would lie.
 *
 * PURE: no React, no DOM, no I/O, no `server-only`. Zero imports. Runs under
 * the pure self-test runner in `scripts/compliance/run-pure-selftests.ts`.
 */

/* ========================================================================== */
/* Inputs                                                                     */
/* ========================================================================== */

/**
 * A validation finding, structurally compatible with
 * `LeaflyValidationIssue` from `payload-validate-core.ts`.
 *
 * Declared structurally rather than imported because this file is a pure
 * core and pure cores take zero imports. The compatibility is enforced by
 * the compliance suite, not by a type import, so that a drift in the shape
 * fails a test rather than silently compiling.
 */
export type SendabilityIssue = {
  severity: "error" | "warning";
  code: string;
  path: string;
  itemId: string | null;
  message: string;
};

/**
 * The human-facing handle for a product. Structurally compatible with
 * `ProductIdentity` from `product-identity-core.ts`.
 */
export type SendabilityIdentity = {
  id: string;
  productName: string | null;
  brand: string | null;
  vendor: string | null;
  barcodes: string[];
  category: string | null;
  size: string | null;
};

/* ========================================================================== */
/* Outputs                                                                    */
/* ========================================================================== */

/**
 * How a defect should be repaired. This drives which button the UI offers.
 *
 * - `bulk_safe`   -- a deterministic, spec-legal transformation exists that
 *                    needs no new information from anybody. Offerable as a
 *                    blanket fix. (The 1g/3g/5g collapse is this.)
 * - `needs_data`  -- a human must supply something that is genuinely absent
 *                    (a missing name, an absent category). No blanket fix is
 *                    possible, because inventing the value is forbidden.
 * - `system_defect` -- the payload BUILDER is at fault, not the product data.
 *                    Sending the owner to a product page to fix a duplicate
 *                    item id or a forbidden v1 field would waste his time:
 *                    there is nothing on that page to change. These say so.
 * - `unknown`     -- we did not recognise the defect. Never guess a remedy;
 *                    send the owner to the product page and say plainly that
 *                    this one needs eyes.
 */
export type FixClass = "bulk_safe" | "needs_data" | "system_defect" | "unknown";

/** One product that may not be sent, and everything needed to act on it. */
export type BlockedProduct = {
  /** Machine id. Present for logs and support; never the headline. */
  id: string;
  /** Human sentence leading with the name. Rule 2. */
  label: string;
  identity: SendabilityIdentity | null;
  /** Every error that blocks this product, in discovery order. */
  reasons: string[];
  /** Distinct error codes, sorted, used for grouping. */
  codes: string[];
  /** Back-office address that repairs it, or null when undeterminable. */
  fixHref: string | null;
  fixClass: FixClass;
  /** Stable key identifying "this same defect on other products". */
  defectSignature: string;
};

/** A repeated defect, gathered so it can be fixed once. */
export type DefectGroup = {
  signature: string;
  code: string;
  fixClass: FixClass;
  /** Human summary of what is wrong with all of these. */
  summary: string;
  /** Product ids in this group, in the order encountered. */
  productIds: string[];
  count: number;
  /** True when a blanket fix may be offered for the whole group. */
  blanketFixAvailable: boolean;
};

export type SendabilityTriage = {
  /** Ids that passed and may be transmitted right now. */
  sendableIds: string[];
  /** Products held back, each explained and addressed. */
  blocked: BlockedProduct[];
  /** Repeated defects, largest group first. */
  groups: DefectGroup[];
  totalConsidered: number;
  sendableCount: number;
  blockedCount: number;
  /** True when something can be sent despite the failures. */
  partialSendPossible: boolean;
  /** Warnings that block nothing, carried so they are not lost. */
  warningCount: number;
  /**
   * Errors that name no product.
   *
   * Carried explicitly because a count of zero blocked products does NOT
   * mean the payload is clean. A payload-level error ("items must be an
   * array") blames nobody, so it blocks nothing and would otherwise let the
   * summary announce "all products are ready to send" about a payload that
   * cannot possibly succeed. Reporting a reassuring lie at the exact moment
   * the owner is deciding whether to press Send is the worst available
   * outcome, so this number gets its own field and its own sentence.
   */
  unattributedErrorCount: number;
  /** Messages for those errors, so they are actionable rather than a count. */
  unattributedErrors: string[];
};

/* ========================================================================== */
/* Defect classification                                                      */
/* ========================================================================== */

/**
 * Error codes we recognise and can repair mechanically.
 *
 * `variant_size_indistinguishable` is FINDING J-1: several genuinely different sizes
 * of one product all reduced to "1 each" because the product's Leafly type
 * forbids grams. The source labels are clean (`1g`, `3g`, `5g` -- decoded
 * from the owner's own error message by inverting the variant-id hash), so a
 * deterministic remedy exists and needs no new data. See
 * `collision-remedy-core.ts`, which computes the actual plan.
 */
const BULK_SAFE_CODES: readonly string[] = [
  // FINDING J-1, the owner's 124 errors. THIS EXACT STRING is the code that
  // `payload-validate-core.ts` emits -- it was read out of the validator, not
  // invented. An earlier draft of this file guessed "variant_size_collision",
  // which does not exist anywhere in the codebase; had it shipped, every one
  // of the owner's 124 errors would have fallen through to "unknown" and the
  // blanket fix would never once have been offered. The compliance suite now
  // asserts every entry in these lists against the validator's real output.
  "variant_size_indistinguishable",
  // Several sizes reduced to one unit the type does not allow. Same root
  // cause as the above and the same deterministic remedy.
  "variant_unit_wrong_for_item_type",
  "unit_wrong_for_item_type",
];

/**
 * Codes where a value is genuinely missing. A blanket fix is IMPOSSIBLE here,
 * not merely unimplemented: the only way to satisfy the schema is to invent
 * data, and inventing product data is prohibited by the standing constraints
 * in `docs/LEAFLY_CULTIVERA_REMEDIATION_ROADMAP.md`.
 */
const NEEDS_DATA_CODES: readonly string[] = [
  // Verified against the validator's emitted codes.
  "item_name_invalid",
  "item_type_missing",
  "item_type_not_funnel_target",
  "item_strain_empty",
  "item_strain_placeholder",
  "item_strain_type",
  "item_variants_empty",
  "item_image_not_url",
  "content_missing",
  "content_negative",
  "content_percent_over_100",
  "compound_type_missing",
  "compound_type_unknown",
  "variant_field_missing",
  "variant_amount_not_positive",
  "variant_price_below_minimum",
  "variant_inventory_invalid",
  "unit_missing",
];

/**
 * Codes that indicate OUR builder is wrong, not the owner's product data.
 *
 * Routing these to a product page would be a small cruelty: the owner would
 * open the page, find nothing wrong with the product, and conclude the fix
 * button is broken. A duplicate item id or a leftover v1 field is a defect in
 * this application and must be reported as one.
 */
const SYSTEM_DEFECT_CODES: readonly string[] = [
  "payload_not_object",
  "payload_items_missing",
  "payload_unknown_key",
  "item_not_object",
  "item_id_invalid",
  "item_id_duplicate",
  "item_field_type",
  "item_null_in_non_nullable",
  "item_variants_not_array",
  "item_compounds_not_array",
  "item_image_type",
  "item_pickup_not_boolean",
  "variant_not_object",
  "variant_id_invalid",
  "variant_id_duplicate",
  "variant_amount_not_number",
  "variant_price_not_number",
  "variant_price_not_integer",
  "variant_inventory_not_number",
  "variant_medical_not_boolean",
  "variant_unit_out_of_enum",
  "unit_out_of_enum",
  "compound_not_object",
  "compound_type_duplicate",
  "content_not_number",
  "total_has_type",
  "total_null",
  "unknown_field",
  "forbidden_field_alias",
  "v1_field_removed_in_v2",
];

/**
 * Every code this module claims to recognise.
 *
 * Exported so the compliance suite can prove each one is really emitted by
 * `payload-validate-core.ts`. That test is the guard against the exact
 * mistake made while writing this file: classifying an invented code, which
 * compiles, passes a naive unit test, and silently never matches in
 * production.
 */
export const RECOGNISED_DEFECT_CODES: readonly string[] = [
  ...BULK_SAFE_CODES,
  ...NEEDS_DATA_CODES,
  ...SYSTEM_DEFECT_CODES,
];

/** Classify a defect so the UI can offer the right button. */
export function classifyFix(code: string): FixClass {
  const c = String(code ?? "").trim().toLowerCase();
  if (c.length === 0) return "unknown";
  if (BULK_SAFE_CODES.includes(c)) return "bulk_safe";
  if (NEEDS_DATA_CODES.includes(c)) return "needs_data";
  if (SYSTEM_DEFECT_CODES.includes(c)) return "system_defect";
  // An unrecognised code becomes "unknown" -- never a guessed remedy.
  //
  // There is deliberately NO substring fallback here. An earlier draft
  // matched on `includes("collision")` and `includes("duplicate")`, which
  // would have classified `variant_id_duplicate` (a defect in OUR builder)
  // as a bulk-safe product-data fix, and offered the owner a blanket "fix"
  // for something no product page can change. Guessing a remedy from a
  // substring is exactly the kind of assumption that produces confident
  // wrong answers, so unrecognised codes are reported as unrecognised.
  return "unknown";
}

/**
 * Whether a whole group may be blanket-fixed.
 *
 * Only `bulk_safe` qualifies. Note this is a separate function from
 * `classifyFix` on purpose: the decision to EXPOSE a destructive-looking bulk
 * action deserves its own test surface, and a future policy (say, a size cap)
 * belongs here rather than tangled into classification.
 */
export function blanketFixAvailable(fixClass: FixClass): boolean {
  return fixClass === "bulk_safe";
}

/* ========================================================================== */
/* Identity helpers (local, to keep this core import-free)                    */
/* ========================================================================== */

const trim = (v: string | null | undefined): string => String(v ?? "").trim();

/**
 * Human label for a product, leading with the name. Rule 2.
 *
 * Falls back through brand and vendor before, as a last resort, admitting
 * that only an id is known. That last case is reported honestly -- "Unnamed
 * product (id abc)" -- rather than dressed up, because a product with no name
 * is itself a data problem the owner should see.
 */
export function humanLabel(identity: SendabilityIdentity | null, fallbackId: string): string {
  const id = trim(fallbackId);
  if (identity === null) {
    return id.length > 0 ? `Unnamed product (id ${id})` : "Unnamed product";
  }
  const parts: string[] = [];
  const name = trim(identity.productName);
  const brand = trim(identity.brand);
  const vendor = trim(identity.vendor);
  const size = trim(identity.size);
  const barcode = identity.barcodes.map(trim).filter((b) => b.length > 0)[0] ?? "";

  if (name.length > 0) parts.push(name);
  else parts.push("Unnamed product");

  if (size.length > 0) parts.push(`(${size})`);
  if (brand.length > 0) parts.push(`by ${brand}`);
  if (vendor.length > 0 && vendor !== brand) parts.push(`from ${vendor}`);
  if (barcode.length > 0) parts.push(`barcode ${barcode}`);

  const known = trim(identity.id).length > 0 ? trim(identity.id) : id;
  if (known.length > 0) parts.push(`[id ${known}]`);
  return parts.join(" ");
}

/**
 * Back-office address that repairs a product.
 *
 * Mirrors `productFixHref` in `product-identity-core.ts`. Verified to exist:
 * `src/app/admin/products/[key]/page.tsx` resolves its route parameter via
 * `getItemBySourceKey(published.id, key)`, i.e. it is keyed by
 * `source_item_id` -- which is the id carried here.
 *
 * Returns null rather than a guess when there is no id. Rule 3.
 */
export function fixHrefFor(productId: string | null | undefined): string | null {
  const id = trim(productId);
  if (id.length === 0) return null;
  return `/admin/products/${encodeURIComponent(id)}`;
}

/* ========================================================================== */
/* Triage                                                                     */
/* ========================================================================== */

/**
 * Build the signature that gathers "the same problem on other products".
 *
 * The code alone is the signature. Deliberately NOT the message: messages
 * embed product names and ids, so grouping by message would produce 124
 * groups of one and defeat the entire purpose of the blanket fix.
 */
function signatureFor(code: string): string {
  const c = trim(code).toLowerCase();
  return c.length > 0 ? c : "unknown";
}

/**
 * Turn validation findings into a send decision plus an actionable work list.
 *
 * @param candidateIds Every product that was offered for sending. Supplying
 *   this (rather than inferring it from the issues) is what allows the
 *   function to report `sendableIds` -- you cannot know what passed if you
 *   only ever see what failed.
 * @param issues Findings from `validateLeaflyPayload`.
 * @param identities Human identifiers, keyed by product id. Missing entries
 *   degrade to an id-only label rather than throwing: a triage that crashes
 *   because one product lacks a name is useless exactly when it is needed.
 */
export function triageSendability(input: {
  candidateIds: readonly string[];
  issues: readonly SendabilityIssue[];
  identities?: readonly SendabilityIdentity[];
}): SendabilityTriage {
  const candidateIds = (input.candidateIds ?? []).map(trim).filter((id) => id.length > 0);
  const issues = input.issues ?? [];
  const identityById = new Map<string, SendabilityIdentity>();
  for (const identity of input.identities ?? []) {
    const id = trim(identity?.id);
    if (id.length > 0) identityById.set(id, identity);
  }

  // Deduplicate candidates while preserving the caller's order. Order is not
  // cosmetic: the owner reads this list top to bottom.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  const errorsByItem = new Map<string, SendabilityIssue[]>();
  let warningCount = 0;
  // Errors with no attributable item cannot be blamed on a product, so they
  // cannot be skipped past either. They are surfaced separately below.
  const unattributedErrors: SendabilityIssue[] = [];

  for (const issue of issues) {
    if (issue.severity === "warning") {
      warningCount += 1;
      continue;
    }
    const itemId = trim(issue.itemId);
    if (itemId.length === 0) {
      unattributedErrors.push(issue);
      continue;
    }
    const bucket = errorsByItem.get(itemId);
    if (bucket === undefined) errorsByItem.set(itemId, [issue]);
    else bucket.push(issue);
  }

  const blocked: BlockedProduct[] = [];
  const sendableIds: string[] = [];

  // Any product carrying an error is blocked, even if it also appears clean
  // elsewhere. Considering only candidates keeps the triage honest about
  // scope: an error against a product nobody asked to send is handled below.
  for (const id of ordered) {
    const errs = errorsByItem.get(id);
    if (errs === undefined || errs.length === 0) {
      sendableIds.push(id);
      continue;
    }
    const identity = identityById.get(id) ?? null;
    const codes = Array.from(new Set(errs.map((e) => signatureFor(e.code)))).sort();
    // The primary code decides the remedy. Sorting first makes the choice
    // deterministic rather than dependent on validator iteration order.
    const primary = codes[0] ?? "unknown";
    const fixClass = classifyFix(primary);
    blocked.push({
      id,
      label: humanLabel(identity, id),
      identity,
      reasons: errs.map((e) => e.message),
      codes,
      // A system defect is not repairable from a product page, so no link is
      // offered. Sending the owner somewhere that cannot help him is worse
      // than telling him plainly that this one is ours to fix.
      fixHref: fixClass === "system_defect" ? null : fixHrefFor(id),
      fixClass,
      defectSignature: primary,
    });
  }

  // Errors attributed to products outside the candidate set. These must not
  // vanish: a validator complaining about something we are not sending is
  // either a bug or a sign the caller passed the wrong candidate list, and
  // both deserve to be visible rather than swallowed.
  for (const [itemId, errs] of errorsByItem) {
    if (seen.has(itemId)) continue;
    const identity = identityById.get(itemId) ?? null;
    const codes = Array.from(new Set(errs.map((e) => signatureFor(e.code)))).sort();
    const primary = codes[0] ?? "unknown";
    blocked.push({
      id: itemId,
      label: humanLabel(identity, itemId),
      identity,
      reasons: errs.map((e) => e.message),
      codes,
      fixHref: classifyFix(primary) === "system_defect" ? null : fixHrefFor(itemId),
      fixClass: classifyFix(primary),
      defectSignature: primary,
    });
  }

  // Group repeated defects. Rule 4.
  const groupMap = new Map<string, DefectGroup>();
  for (const b of blocked) {
    const existing = groupMap.get(b.defectSignature);
    if (existing === undefined) {
      const fixClass = b.fixClass;
      groupMap.set(b.defectSignature, {
        signature: b.defectSignature,
        code: b.defectSignature,
        fixClass,
        summary: b.reasons[0] ?? "This product does not meet Leafly's contract.",
        productIds: [b.id],
        count: 1,
        blanketFixAvailable: blanketFixAvailable(fixClass),
      });
    } else {
      existing.productIds.push(b.id);
      existing.count += 1;
    }
  }

  // Largest group first: the biggest pile of identical work is the one worth
  // showing at the top, because fixing it clears the most products.
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.signature.localeCompare(b.signature);
  });

  // An unattributed error means we cannot prove which product is at fault, so
  // we cannot promise that skipping the named ones makes the push safe.
  const safeToPartialSend = unattributedErrors.length === 0 && sendableIds.length > 0;

  return {
    sendableIds,
    blocked,
    groups,
    totalConsidered: ordered.length,
    sendableCount: sendableIds.length,
    blockedCount: blocked.length,
    partialSendPossible: safeToPartialSend,
    warningCount,
    unattributedErrorCount: unattributedErrors.length,
    unattributedErrors: unattributedErrors.map((e) => e.message),
  };
}

/* ========================================================================== */
/* Narration                                                                  */
/* ========================================================================== */

/**
 * The sentence shown at the point of failure.
 *
 * This replaces "Leafly payload failed validation with 124 error(s)" followed
 * by a wall of hex. That message told the owner a number and nothing he could
 * act on; worse, it did not mention that sending the good products was even
 * possible (ask 7: "it did not give me the option to send the good products
 * and withhold the bad ones").
 */
export function describeTriage(triage: SendabilityTriage): string {
  // Untraceable errors are reported FIRST and short-circuit every reassuring
  // sentence below. Zero blocked products does not mean zero problems: a
  // payload-level error blames no product, so it would otherwise fall through
  // to "all products are ready to send" about a payload that cannot succeed.
  if (triage.unattributedErrorCount > 0) {
    const detail = triage.unattributedErrors[0] ?? "";
    const suffix = detail.length > 0 ? ` First problem: ${detail}` : "";
    return (
      `The menu could not be validated: ${triage.unattributedErrorCount} ` +
      `problem(s) could not be traced to a specific product, so a partial send ` +
      `is not offered — sending now could still fail.${suffix}`
    );
  }

  if (triage.blockedCount === 0) {
    return triage.sendableCount === 0
      ? "There is nothing selected to send."
      : `All ${triage.sendableCount} selected products meet Leafly's contract and are ready to send.`;
  }

  const lines: string[] = [];
  lines.push(
    `${triage.blockedCount} of ${triage.totalConsidered} products cannot be sent to Leafly yet; ` +
      `${triage.sendableCount} are ready.`,
  );

  if (triage.partialSendPossible) {
    lines.push(
      `You can send the ${triage.sendableCount} that pass now and fix the rest afterwards — ` +
        `nothing that is held back is deleted or changed.`,
    );
  } else if (triage.sendableCount === 0) {
    lines.push("Nothing in this selection passes yet, so there is nothing to send.");
  } else {
    lines.push(
      "Some errors could not be traced to a specific product, so a partial send is not offered — " +
        "sending now could still fail. Review the list below.",
    );
  }

  const bulk = triage.groups.filter((g) => g.blanketFixAvailable);
  if (bulk.length > 0) {
    const fixable = bulk.reduce((sum, g) => sum + g.count, 0);
    lines.push(
      `${fixable} of them share the same repeated defect and can be corrected in one action ` +
        `rather than one at a time.`,
    );
  }

  return lines.join(" ");
}

/**
 * The work list, one line per product, each led by a name.
 *
 * `limit` exists because 124 lines is not a UI. The caller is told how many
 * were elided rather than the list simply stopping, so nothing appears to
 * have been silently dropped (rule 1).
 */
export function describeBlockedProducts(
  triage: SendabilityTriage,
  limit = 25,
): string[] {
  const cap = Math.max(0, Math.floor(limit));
  const out: string[] = [];
  const shown = cap === 0 ? triage.blocked : triage.blocked.slice(0, cap);
  for (const b of shown) {
    const reason = b.reasons[0] ?? "Does not meet Leafly's contract.";
    out.push(`${b.label} — ${reason}`);
  }
  const hidden = triage.blocked.length - shown.length;
  if (hidden > 0) {
    out.push(`…and ${hidden} more held back for the same kinds of reason.`);
  }
  return out;
}

/** Human summary of one repeated defect, for the blanket-fix panel. */
export function describeDefectGroup(group: DefectGroup): string {
  const noun = group.count === 1 ? "product" : "products";
  const head = `${group.count} ${noun}: ${group.summary}`;
  if (group.blanketFixAvailable) {
    return `${head} This can be fixed for all ${group.count} at once.`;
  }
  if (group.fixClass === "system_defect") {
    // Say whose problem it is. The owner should not go hunting through a
    // product page for a fault in our own payload builder.
    return (
      `${head} This is a fault in the menu software, not in your product ` +
      `data — there is nothing to correct on the product page. Report it.`
    );
  }
  if (group.fixClass === "unknown") {
    return `${head} This one is not recognised automatically and needs to be looked at.`;
  }
  return `${head} These need to be corrected individually.`;
}

/* ========================================================================== */
/* Embedded self-tests                                                        */
/* ========================================================================== */

export function __runLeaflySendabilityTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  const ident = (
    id: string,
    productName: string | null,
    brand: string | null = null,
    vendor: string | null = null,
    barcodes: string[] = [],
    size: string | null = null,
  ): SendabilityIdentity => ({
    id,
    productName,
    brand,
    vendor,
    barcodes,
    category: null,
    size,
  });

  const err = (itemId: string | null, code: string, message: string): SendabilityIssue => ({
    severity: "error",
    code,
    path: `items[0]`,
    itemId,
    message,
  });

  /* ---------------- classifyFix ---------------- */

  // THE code from the owner's 124 errors. Read out of the validator, never
  // invented -- see the comment on BULK_SAFE_CODES.
  check(
    "the REAL collision code is bulk safe",
    classifyFix("variant_size_indistinguishable") === "bulk_safe",
  );
  check(
    "wrong-unit-for-type is bulk safe",
    classifyFix("variant_unit_wrong_for_item_type") === "bulk_safe",
  );
  check("missing name needs data", classifyFix("item_name_invalid") === "needs_data");
  check("missing type needs data", classifyFix("item_type_missing") === "needs_data");
  check("empty variants needs data", classifyFix("item_variants_empty") === "needs_data");
  check(
    "duplicate variant id is OUR defect",
    classifyFix("variant_id_duplicate") === "system_defect",
  );
  check(
    "duplicate item id is OUR defect",
    classifyFix("item_id_duplicate") === "system_defect",
  );
  check(
    "a leftover v1 field is OUR defect",
    classifyFix("v1_field_removed_in_v2") === "system_defect",
  );
  check("unknown code is unknown", classifyFix("weird_new_code") === "unknown");
  check("empty code is unknown", classifyFix("") === "unknown");
  check(
    "classifyFix is case-insensitive",
    classifyFix("ITEM_NAME_INVALID") === "needs_data",
  );
  check("classifyFix trims", classifyFix("  item_name_invalid  ") === "needs_data");

  // REGRESSION. The first draft guessed a code that does not exist
  // (`variant_size_collision`) and used substring fallbacks to paper over it.
  // Both bugs are pinned here: an invented code must NOT be recognised, and
  // a substring must NOT be enough to claim a remedy.
  check(
    "REGRESSION: the invented code is not recognised",
    classifyFix("variant_size_collision") === "unknown",
  );
  check(
    "REGRESSION: no substring fallback misroutes a builder defect",
    classifyFix("variant_id_duplicate") !== "bulk_safe",
  );
  check(
    "REGRESSION: an unknown 'collision' code is not assumed bulk safe",
    classifyFix("some_future_collision_code") === "unknown",
  );
  check(
    "every recognised code is classified, never unknown",
    RECOGNISED_DEFECT_CODES.every((c) => classifyFix(c) !== "unknown"),
  );
  check("recognised codes are unique", new Set(RECOGNISED_DEFECT_CODES).size === RECOGNISED_DEFECT_CODES.length);

  check("only bulk_safe may be blanket fixed", blanketFixAvailable("bulk_safe"));
  check("needs_data may not be blanket fixed", !blanketFixAvailable("needs_data"));
  check("unknown may not be blanket fixed", !blanketFixAvailable("unknown"));
  check(
    "system_defect may not be blanket fixed",
    !blanketFixAvailable("system_defect"),
  );

  /* ---------------- humanLabel: rule 2 ---------------- */

  const full = ident(
    "pos-45c6e282e0e8",
    "Dragon Balm CBD RED",
    "Dragon Balm",
    "Fire Bros",
    ["0123456789012"],
    "3g",
  );
  const label = humanLabel(full, "pos-45c6e282e0e8");
  check("label leads with the product name", label.startsWith("Dragon Balm CBD RED"));
  check("label carries the size", label.includes("(3g)"));
  check("label carries the brand", label.includes("by Dragon Balm"));
  check("label carries the vendor", label.includes("from Fire Bros"));
  check("label carries the barcode", label.includes("barcode 0123456789012"));
  check("label still carries the id for support", label.includes("[id pos-45c6e282e0e8]"));
  // The whole point of ask 5: the id must not be the FIRST thing he reads.
  check("label does NOT lead with the id", !label.startsWith("pos-"));
  check(
    "id appears after the name",
    label.indexOf("Dragon Balm CBD RED") < label.indexOf("[id "),
  );

  const noVendor = humanLabel(ident("x1", "Blue Dream", "Acme", "Acme"), "x1");
  check(
    "vendor identical to brand is not repeated",
    (noVendor.match(/Acme/g) ?? []).length === 1,
  );

  const idOnly = humanLabel(null, "x9");
  check("missing identity is admitted, not faked", idOnly === "Unnamed product (id x9)");
  check(
    "nameless identity still says unnamed",
    humanLabel(ident("x2", null), "x2").startsWith("Unnamed product"),
  );
  check("empty fallback id degrades cleanly", humanLabel(null, "") === "Unnamed product");
  check(
    "whitespace-only name treated as absent",
    humanLabel(ident("x3", "   "), "x3").startsWith("Unnamed product"),
  );
  check(
    "blank barcodes are skipped",
    !humanLabel(ident("x4", "N", null, null, ["", "  "]), "x4").includes("barcode"),
  );

  /* ---------------- fixHrefFor: rule 3 ---------------- */

  check(
    "fix href points at the product page",
    fixHrefFor("pos-45c6e282e0e8") === "/admin/products/pos-45c6e282e0e8",
  );
  check("fix href is null without an id", fixHrefFor("") === null);
  check("fix href is null for whitespace", fixHrefFor("   ") === null);
  check("fix href is null for null", fixHrefFor(null) === null);
  check(
    "fix href encodes unsafe characters",
    fixHrefFor("a/b c") === "/admin/products/a%2Fb%20c",
  );

  /* ---------------- triage: the happy path ---------------- */

  const clean = triageSendability({ candidateIds: ["a", "b", "c"], issues: [] });
  check("clean triage sends everything", clean.sendableCount === 3);
  check("clean triage blocks nothing", clean.blockedCount === 0);
  check("clean triage has no groups", clean.groups.length === 0);
  check("clean triage counts candidates", clean.totalConsidered === 3);
  check(
    "clean triage narrates readiness",
    describeTriage(clean).includes("All 3 selected products"),
  );
  check(
    "empty selection is described honestly",
    describeTriage(triageSendability({ candidateIds: [], issues: [] })).includes(
      "nothing selected",
    ),
  );

  /* ---------------- triage: ask 4 / ask 7, skip the bad ones ---------------- */

  const mixed = triageSendability({
    candidateIds: ["good1", "bad1", "good2", "bad2"],
    issues: [
      err("bad1", "variant_size_indistinguishable", "2 sizes are all described as 1 each"),
      err("bad2", "variant_size_indistinguishable", "2 sizes are all described as 1 each"),
    ],
    identities: [
      ident("bad1", "Dragon Balm CBD RED", "Dragon Balm", "Fire Bros", [], "3g"),
      ident("bad2", "Sunset Sherbet PR", "Sunset", "Fire Bros", [], "1g"),
    ],
  });
  check("mixed triage sends the good ones", mixed.sendableCount === 2);
  check("mixed triage keeps good order", mixed.sendableIds.join(",") === "good1,good2");
  check("mixed triage blocks the bad ones", mixed.blockedCount === 2);
  check("partial send is offered", mixed.partialSendPossible);
  check(
    "narration offers the partial send",
    describeTriage(mixed).includes("send the 2 that pass now"),
  );
  check(
    "narration promises nothing is destroyed",
    describeTriage(mixed).includes("nothing that is held back is deleted"),
  );
  check("every blocked product has a fix link", mixed.blocked.every((b) => b.fixHref !== null));
  check(
    "fix link addresses the right product",
    mixed.blocked[0].fixHref === "/admin/products/bad1",
  );
  check(
    "blocked list is human-readable",
    describeBlockedProducts(mixed)[0].startsWith("Dragon Balm CBD RED"),
  );

  /* ---------------- ask 7: the blanket fix ---------------- */

  check("identical defects form ONE group", mixed.groups.length === 1);
  check("the group counts both products", mixed.groups[0].count === 2);
  check("the group offers a blanket fix", mixed.groups[0].blanketFixAvailable);
  check(
    "narration mentions the one-action fix",
    describeTriage(mixed).includes("can be corrected in one action"),
  );
  check(
    "group description offers the bulk action",
    describeDefectGroup(mixed.groups[0]).includes("fixed for all 2 at once"),
  );

  // The scale case: 124 identical defects must collapse to one line of work,
  // which is the entire point of the owner's blanket-fix request.
  const manyIds = Array.from({ length: 124 }, (_, i) => `p${i}`);
  const many = triageSendability({
    candidateIds: [...manyIds, "okay"],
    issues: manyIds.map((id) => err(id, "variant_size_indistinguishable", "sizes collapsed to 1 each")),
  });
  check("124 defects collapse to one group", many.groups.length === 1);
  check("the group holds all 124", many.groups[0].count === 124);
  check("the clean product still sends", many.sendableIds.join(",") === "okay");
  check("124 blocked are all listed", many.blockedCount === 124);
  check("the work list is capped for the UI", describeBlockedProducts(many, 25).length === 26);
  check(
    "the cap admits what it hid",
    describeBlockedProducts(many, 25)[25].includes("99 more"),
  );
  check("limit 0 means no cap", describeBlockedProducts(many, 0).length === 124);

  /* ---------------- needs_data must NOT promise a blanket fix ---------------- */

  const needs = triageSendability({
    candidateIds: ["n1", "n2"],
    issues: [
      err("n1", "item_name_invalid", "This product has no name."),
      err("n2", "item_name_invalid", "This product has no name."),
    ],
  });
  check("missing data still groups", needs.groups.length === 1);
  check("missing data refuses a blanket fix", !needs.groups[0].blanketFixAvailable);
  check(
    "missing data narration omits the one-action claim",
    !describeTriage(needs).includes("one action"),
  );
  check(
    "missing data says fix individually",
    describeDefectGroup(needs.groups[0]).includes("individually"),
  );

  /* ---------------- unattributed errors: refuse to promise safety ---------- */

  const unattributed = triageSendability({
    candidateIds: ["u1", "u2"],
    issues: [err(null, "payload_shape", "items must be an array")],
  });
  check("unattributed errors block no single product", unattributed.blockedCount === 0);
  check(
    "unattributed errors suppress the partial-send offer",
    !unattributed.partialSendPossible,
  );
  check(
    "unattributed errors are explained",
    describeTriage(unattributed).includes("could not be traced"),
  );
  // REGRESSION. Caught by this self-test during development: because an
  // untraceable error blocks no product, blockedCount was 0 and the summary
  // cheerfully announced "All 2 selected products ... are ready to send"
  // about a payload that could not possibly succeed. Telling the owner
  // everything is fine at the moment he decides whether to press Send is the
  // single most damaging thing this function could do, so the all-clear
  // sentence is now unreachable while any untraceable error exists.
  check("unattributed errors are counted", unattributed.unattributedErrorCount === 1);
  check(
    "unattributed error messages are kept",
    unattributed.unattributedErrors[0] === "items must be an array",
  );
  check(
    "REGRESSION: untraceable errors NEVER report an all-clear",
    !describeTriage(unattributed).includes("ready to send"),
  );
  check(
    "REGRESSION: untraceable errors do not claim all products pass",
    !/All \d+ selected products/.test(describeTriage(unattributed)),
  );
  check(
    "the untraceable problem itself is quoted",
    describeTriage(unattributed).includes("items must be an array"),
  );
  // A payload-level error alongside per-product errors must still dominate.
  const bothKinds = triageSendability({
    candidateIds: ["a", "b"],
    issues: [
      err(null, "payload_shape", "items must be an array"),
      err("b", "item_name_invalid", "no name"),
    ],
  });
  check("mixed error kinds still refuse a partial send", !bothKinds.partialSendPossible);
  check(
    "mixed error kinds lead with the untraceable problem",
    describeTriage(bothKinds).includes("could not be traced"),
  );
  check("clean triage reports no untraceable errors", clean.unattributedErrorCount === 0);

  /* ---------------- warnings never block ---------------- */

  const warned = triageSendability({
    candidateIds: ["w1"],
    issues: [
      { severity: "warning", code: "no_image", path: "items[0]", itemId: "w1", message: "No image" },
    ],
  });
  check("warnings do not block a product", warned.sendableCount === 1);
  check("warnings are counted, not lost", warned.warningCount === 1);
  check("warnings create no groups", warned.groups.length === 0);

  /* ---------------- rule 1: nothing vanishes ---------------- */

  const conservation = triageSendability({
    candidateIds: ["a", "b", "c", "d"],
    issues: [err("b", "item_name_invalid", "no name"), err("d", "variant_size_indistinguishable", "collapsed")],
  });
  check(
    "every candidate is either sendable or blocked",
    conservation.sendableCount + conservation.blockedCount === 4,
  );
  const accounted = new Set([
    ...conservation.sendableIds,
    ...conservation.blocked.map((b) => b.id),
  ]);
  check("no candidate disappears", accounted.size === 4);
  check(
    "grouped ids equal blocked ids",
    conservation.groups.reduce((s, g) => s + g.count, 0) === conservation.blockedCount,
  );

  // An error about a product nobody asked to send must still surface.
  const stray = triageSendability({
    candidateIds: ["a"],
    issues: [err("zzz", "item_name_invalid", "no name")],
  });
  check("stray errors are not swallowed", stray.blockedCount === 1);
  check("stray error keeps its id", stray.blocked[0].id === "zzz");
  check("stray error does not inflate candidates", stray.totalConsidered === 1);

  /* ---------------- duplicates and ordering ---------------- */

  const dupes = triageSendability({ candidateIds: ["a", "a", "b"], issues: [] });
  check("duplicate candidates are collapsed", dupes.totalConsidered === 2);
  check("duplicate collapse preserves order", dupes.sendableIds.join(",") === "a,b");

  const multiGroup = triageSendability({
    candidateIds: ["x1", "x2", "x3", "y1"],
    issues: [
      err("x1", "variant_size_indistinguishable", "c"),
      err("x2", "variant_size_indistinguishable", "c"),
      err("x3", "variant_size_indistinguishable", "c"),
      err("y1", "item_name_invalid", "n"),
    ],
  });
  check("biggest group sorts first", multiGroup.groups[0].count === 3);
  check("smaller group follows", multiGroup.groups[1].count === 1);

  // A product with several distinct errors must appear once, not once per error.
  const multiErr = triageSendability({
    candidateIds: ["m1"],
    issues: [
      err("m1", "item_name_invalid", "no name"),
      err("m1", "variant_size_indistinguishable", "collapsed"),
    ],
  });
  check("a product with two errors is listed once", multiErr.blockedCount === 1);
  check("both reasons are kept", multiErr.blocked[0].reasons.length === 2);
  check("both codes are kept", multiErr.blocked[0].codes.length === 2);
  check(
    "codes are sorted for determinism",
    multiErr.blocked[0].codes.join(",") ===
      "item_name_invalid,variant_size_indistinguishable",
  );
  check(
    "remedy is chosen deterministically from sorted codes",
    multiErr.blocked[0].fixClass === "needs_data",
  );

  /* ---------------- determinism ---------------- */

  const runA = triageSendability({
    candidateIds: ["a", "b", "c"],
    issues: [err("b", "variant_size_indistinguishable", "c")],
  });
  const runB = triageSendability({
    candidateIds: ["a", "b", "c"],
    issues: [err("b", "variant_size_indistinguishable", "c")],
  });
  check(
    "triage is deterministic",
    JSON.stringify(runA) === JSON.stringify(runB),
  );

  /* ---------------- defensive inputs ---------------- */

  const blanks = triageSendability({ candidateIds: ["", "   ", "ok"], issues: [] });
  check("blank candidate ids are dropped", blanks.totalConsidered === 1);
  check(
    "identities without ids are ignored safely",
    triageSendability({
      candidateIds: ["a"],
      issues: [err("a", "x", "m")],
      identities: [ident("", "ghost")],
    }).blocked[0].identity === null,
  );

  return { passed, failed };
}
