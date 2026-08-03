/**
 * src/lib/inventory/lot-website-classification-core.ts
 *
 * PURE gatekeeper for editing ONE product's website Type + Category from the
 * Inventory Detail "corrections" section (Option A: universal per-product
 * override). Mirrors the onboarding approval card's contract:
 *
 *   - website_category : a VALUE from the live website_category_types registry,
 *                        OR the sentinel "__new__" (create-on-the-fly), OR "" /
 *                        "__keep__" meaning "leave the category override as-is".
 *   - house_type       : a LABEL from the live inventory_types registry, OR the
 *                        sentinel "__new_type__", OR "" / "__keep__".
 *
 * This module NEVER touches the CCRS/LCB columns. It only decides, from a raw
 * form submission, WHICH of the two override fields the human intends to set /
 * clear / create, refusing anything not in the live vocabularies. The server
 * action layers on the "__new__" creation (same tables the Types & Categories
 * page manages) and the DB upsert; the form is never trusted.
 */

/** Sentinels shared with the corrections UI. */
export const NEW_CATEGORY_SENTINEL = "__new__";
export const NEW_TYPE_SENTINEL = "__new_type__";
/** "leave this override exactly as it is" (the prefilled current value). */
export const KEEP_SENTINEL = "__keep__";
/** explicit "remove any override for this field, fall back to auto". */
export const CLEAR_SENTINEL = "__clear__";

const MAX_NEW_LABEL = 60;

export type ClassificationEditRaw = {
  website_category?: string | null;
  house_type?: string | null;
  new_category_label?: string | null;
  new_type_label?: string | null;
};

/**
 * One field's decision:
 *   - kind "keep"   : do not change the stored override for this field.
 *   - kind "clear"  : remove the override (fall back to auto-resolution).
 *   - kind "set"    : set the override to `value` (an EXISTING registry entry).
 *   - kind "create" : create a new registry entry named `newLabel`, then set it.
 */
export type FieldDecision =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "set"; value: string }
  | { kind: "create"; newLabel: string };

export type ClassificationEditParse =
  | { ok: true; category: FieldDecision; type: FieldDecision }
  | { ok: false; error: string };

/**
 * Parse a raw corrections-form submission into two safe field decisions.
 * `validCategoryValues` / `validTypeLabels` are the LIVE registries (passed in
 * by the server so this stays pure). Unknown values and malformed "create"
 * requests are refused with plain-English errors.
 */
export function parseClassificationEdit(
  raw: ClassificationEditRaw,
  vocab: { validCategoryValues: readonly string[]; validTypeLabels: readonly string[] },
): ClassificationEditParse {
  const catValues = new Set(vocab.validCategoryValues.map((v) => v.trim()).filter(Boolean));
  const typeLabels = new Set(vocab.validTypeLabels.map((v) => v.trim()).filter(Boolean));

  const category = decideField(
    String(raw.website_category ?? "").trim(),
    String(raw.new_category_label ?? "").trim(),
    catValues,
    "category",
  );
  if (!category.ok) return { ok: false, error: category.error };

  const type = decideField(
    String(raw.house_type ?? "").trim(),
    String(raw.new_type_label ?? "").trim(),
    typeLabels,
    "type",
  );
  if (!type.ok) return { ok: false, error: type.error };

  return { ok: true, category: category.decision, type: type.decision };
}

function decideField(
  picked: string,
  newLabel: string,
  valid: Set<string>,
  what: "category" | "type",
): { ok: true; decision: FieldDecision } | { ok: false; error: string } {
  const human = what === "category" ? "category" : "type";

  // Blank or explicit keep → leave the override untouched.
  if (picked === "" || picked === KEEP_SENTINEL) {
    return { ok: true, decision: { kind: "keep" } };
  }
  if (picked === CLEAR_SENTINEL) {
    return { ok: true, decision: { kind: "clear" } };
  }
  // Create-on-the-fly.
  const sentinel = what === "category" ? NEW_CATEGORY_SENTINEL : NEW_TYPE_SENTINEL;
  if (picked === sentinel) {
    if (!newLabel) {
      return { ok: false, error: `Type a name for the new ${human}, or pick an existing one.` };
    }
    if (newLabel.length > MAX_NEW_LABEL) {
      return { ok: false, error: `That ${human} name is too long (max ${MAX_NEW_LABEL} characters).` };
    }
    return { ok: true, decision: { kind: "create", newLabel } };
  }
  // Set to an existing registry entry — must be a real vocabulary member.
  if (!valid.has(picked)) {
    return {
      ok: false,
      error: `Pick a ${human} from the list — “${picked}” isn’t one of your ${human === "category" ? "website categories" : "product types"}.`,
    };
  }
  return { ok: true, decision: { kind: "set", value: picked } };
}

/**
 * Apply a parsed field decision against the CURRENTLY stored override value to
 * compute the new stored override value. `created` is the value the server
 * minted for a "create" decision (an existing/created registry entry); it must
 * be supplied whenever the decision kind is "create".
 *
 *   keep   → unchanged (return current)
 *   clear  → null (fall back to auto-resolution)
 *   set    → the chosen existing value
 *   create → the freshly created value (server passes it in)
 */
export function resolveOverrideValue(
  decision: FieldDecision,
  current: string | null,
  created: string | null,
): string | null {
  switch (decision.kind) {
    case "keep":
      return current;
    case "clear":
      return null;
    case "set":
      return decision.value;
    case "create":
      return created;
  }
}

/**
 * Plain-English audit summary of what actually changed. `before` holds the
 * CURRENT effective values (override or auto-resolved); `after` holds the new
 * effective values. Only changed lines are emitted.
 */
export function buildClassificationAuditSummary(
  before: { category: string | null; type: string | null },
  after: { category: string | null; type: string | null },
): string[] {
  const lines: string[] = [];
  const row = (label: string, a: string | null, b: string | null) => {
    const from = (a ?? "").trim() || "(auto)";
    const to = (b ?? "").trim() || "(auto)";
    if (from !== to) lines.push(`${label}: ${from} \u2192 ${to}`);
  };
  row("Website category", before.category, after.category);
  row("Product type", before.type, after.type);
  return lines;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runLotWebsiteClassificationCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lot-website-classification-core: " + msg);
    passed += 1;
  };

  const CATS = ["concentrate", "flower", "edible-solid"] as const;
  const TYPES = ["Live Resin", "Gummies", "Popcorn Bud"] as const;
  const vocab = { validCategoryValues: CATS, validTypeLabels: TYPES };

  // Blank / keep on both → keep both.
  const keepBoth = parseClassificationEdit({ website_category: "", house_type: KEEP_SENTINEL }, vocab);
  ok(keepBoth.ok, "blank+keep parses");
  if (keepBoth.ok) {
    ok(keepBoth.category.kind === "keep", "blank category → keep");
    ok(keepBoth.type.kind === "keep", "keep sentinel → keep");
  }

  // Clear category, set an existing type.
  const clearSet = parseClassificationEdit(
    { website_category: CLEAR_SENTINEL, house_type: "Live Resin" },
    vocab,
  );
  ok(clearSet.ok, "clear+set parses");
  if (clearSet.ok) {
    ok(clearSet.category.kind === "clear", "clear sentinel → clear");
    ok(clearSet.type.kind === "set" && clearSet.type.value === "Live Resin", "existing type set");
  }

  // Set an existing category.
  const setCat = parseClassificationEdit({ website_category: "flower", house_type: "" }, vocab);
  ok(setCat.ok && setCat.category.kind === "set", "existing category set");

  // Unknown category refused.
  ok(!parseClassificationEdit({ website_category: "not-real" }, vocab).ok, "unknown category refused");
  // Unknown type refused.
  ok(!parseClassificationEdit({ house_type: "Moon Rocks" }, vocab).ok, "unknown type refused");

  // Create-on-the-fly: category.
  const newCat = parseClassificationEdit(
    { website_category: NEW_CATEGORY_SENTINEL, new_category_label: "  Dabs  " },
    vocab,
  );
  ok(newCat.ok, "new category parses");
  if (newCat.ok) ok(newCat.category.kind === "create" && newCat.category.newLabel === "Dabs", "new category label trimmed");

  // Create-on-the-fly: type.
  const newType = parseClassificationEdit(
    { house_type: NEW_TYPE_SENTINEL, new_type_label: "Diamonds" },
    vocab,
  );
  ok(newType.ok && newType.type.kind === "create", "new type parses");

  // Create sentinel WITHOUT a name → refused.
  ok(!parseClassificationEdit({ website_category: NEW_CATEGORY_SENTINEL, new_category_label: "" }, vocab).ok, "new category with no name refused");
  ok(!parseClassificationEdit({ house_type: NEW_TYPE_SENTINEL, new_type_label: "" }, vocab).ok, "new type with no name refused");
  // Over-long new name → refused.
  ok(!parseClassificationEdit({ website_category: NEW_CATEGORY_SENTINEL, new_category_label: "x".repeat(61) }, vocab).ok, "over-long new name refused");

  // resolveOverrideValue: decisions apply against the current stored value.
  ok(resolveOverrideValue({ kind: "keep" }, "flower", null) === "flower", "keep → current value");
  ok(resolveOverrideValue({ kind: "keep" }, null, null) === null, "keep → current null");
  ok(resolveOverrideValue({ kind: "clear" }, "flower", null) === null, "clear → null");
  ok(resolveOverrideValue({ kind: "set", value: "concentrate" }, "flower", null) === "concentrate", "set → chosen value");
  ok(resolveOverrideValue({ kind: "create", newLabel: "Dabs" }, "flower", "dabs") === "dabs", "create → minted value");

  // Audit summary: only changed rows, (auto) placeholder for null.
  const sum = buildClassificationAuditSummary(
    { category: null, type: "Gummies" },
    { category: "concentrate", type: "Gummies" },
  );
  ok(sum.length === 1, "one changed row summarized");
  ok(sum[0] === "Website category: (auto) \u2192 concentrate", "category line reads plainly with (auto)");
  ok(
    buildClassificationAuditSummary(
      { category: "flower", type: "Popcorn Bud" },
      { category: "flower", type: "Popcorn Bud" },
    ).length === 0,
    "no-op edit → empty summary",
  );

  return { passed };
}
