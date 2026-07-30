/**
 * content-select-core — pure helpers for "select" content blocks.
 *
 * A "select" content block stores a single short string chosen from a fixed,
 * curated set of options (defined here, keyed by block_key — the same pattern
 * as image-spec-core.ts and the font library). This lets staff pick from a
 * safe dropdown (e.g. a text SIZE) without typing raw CSS that could break the
 * layout. `field_type: "select"` needs NO migration because content_blocks
 * .field_type is a plain text column with no CHECK constraint (verified in
 * supabase/migrations/0005_slice5_cms.sql).
 *
 * Each option maps a stored VALUE (e.g. "lg") to:
 *   - a friendly LABEL shown in the dropdown, and
 *   - a CSS CLASS applied on the public site to realise the choice.
 *
 * The public render helper resolves a block's stored value to its CSS class
 * with a guaranteed fallback, so an unseeded/blank/unknown value always yields
 * the safe default — the site can never render a broken size.
 */

export type SelectOption = {
  /** Stored value (kept short + stable; this is what lives in the DB). */
  value: string;
  /** Friendly dropdown label for staff. */
  label: string;
  /** CSS class applied on the public site for this choice. */
  className: string;
};

export type SelectSpec = {
  /** The choices, in dropdown order. The FIRST option is the default. */
  options: SelectOption[];
  /** Short helper line shown under the dropdown. */
  note?: string;
};

/**
 * Header hours text SIZE options (SecondaryBar — the green bar under the nav).
 *
 * The bar keeps a matching size across mobile + desktop. "Normal" reproduces
 * the exact sizes the bar shipped with, so choosing it (or leaving the block
 * unseeded) changes nothing. Larger steps bump the responsive clamp for both
 * the stacked mobile hours and the one-line desktop hours together.
 */
export const HOURS_SIZE_OPTIONS: SelectOption[] = [
  {
    value: "normal",
    label: "Normal (default)",
    className:
      "gw-hours-mobile-normal md:gw-hours-desktop-normal",
  },
  {
    value: "large",
    label: "Large",
    className: "gw-hours-mobile-large md:gw-hours-desktop-large",
  },
  {
    value: "xl",
    label: "Extra large",
    className: "gw-hours-mobile-xl md:gw-hours-desktop-xl",
  },
  {
    value: "xxl",
    label: "Huge",
    className: "gw-hours-mobile-xxl md:gw-hours-desktop-xxl",
  },
];

/**
 * Medical page visibility (SLICE 107). "no" = Visible (default, first) and
 * "yes" = Hidden. When Hidden, /medical returns notFound() and the Medical nav
 * link is filtered out. The class is empty for both — this select drives page
 * routing/nav logic, not a CSS class. The options mirror the medical core's
 * MEDICAL_HIDE_OPTIONS so there is a single source of truth for the labels.
 */
export const MEDICAL_HIDE_SELECT_OPTIONS: SelectOption[] = [
  { value: "no", label: "Visible (default)", className: "" },
  { value: "yes", label: "Hidden", className: "" },
];

/** Registry of every select block, keyed by block_key. */
const SELECT_SPECS: Record<string, SelectSpec> = {
  "header.hours.size": {
    options: HOURS_SIZE_OPTIONS,
    note: "How big the store-hours text is in the top green bar. Larger steps grow both the phone-size and desktop hours together.",
  },
  "medical.page.hidden": {
    options: MEDICAL_HIDE_SELECT_OPTIONS,
    note: "Hide the whole Medical page. When Hidden, the page and its menu link disappear from the public site (staff pages are unaffected).",
  },
};

/**
 * The default (first) option value for a select block, or "" if the block
 * isn't a known select block.
 */
export function selectDefaultValue(blockKey: string | null | undefined): string {
  const spec = blockKey ? SELECT_SPECS[blockKey] : undefined;
  return spec?.options[0]?.value ?? "";
}

/** Resolve a select block's spec (options + note), or null if unknown. */
export function resolveSelectSpec(
  blockKey: string | null | undefined,
): SelectSpec | null {
  if (!blockKey) return null;
  return SELECT_SPECS[blockKey] ?? null;
}

/**
 * Resolve a stored select VALUE to its public CSS class, with a safe fallback
 * to the first option's class. Unknown block / blank / unknown value → default.
 */
export function selectClassName(
  blockKey: string | null | undefined,
  value: string | null | undefined,
): string {
  const spec = blockKey ? SELECT_SPECS[blockKey] : undefined;
  if (!spec || spec.options.length === 0) return "";
  const v = (value ?? "").trim();
  const match = spec.options.find((o) => o.value === v);
  return (match ?? spec.options[0]).className;
}

/** Is this block_key a known "select" block? */
export function isSelectBlock(blockKey: string | null | undefined): boolean {
  return !!blockKey && blockKey in SELECT_SPECS;
}

// ---------------------------------------------------------------------------
// Pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runContentSelectCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("content-select-core: " + msg);
    passed += 1;
  };

  // Registry basics
  ok(isSelectBlock("header.hours.size"), "header.hours.size is a select block");
  ok(!isSelectBlock("footer.social.facebook.url"), "url block is not a select block");
  ok(!isSelectBlock(""), "empty key is not a select block");
  ok(!isSelectBlock(null), "null key is not a select block");

  // Default value = first option
  ok(selectDefaultValue("header.hours.size") === "normal", "default hours size = normal");
  ok(selectDefaultValue("nope") === "", "unknown block default = ''");

  // Spec resolution
  const spec = resolveSelectSpec("header.hours.size");
  ok(!!spec && spec.options.length === 4, "hours size has 4 options");
  ok(resolveSelectSpec("nope") === null, "unknown block spec = null");

  // Class resolution + fallback safety
  const normalCls = selectClassName("header.hours.size", "normal");
  ok(normalCls.includes("gw-hours-mobile-normal"), "normal maps to normal class");
  ok(
    selectClassName("header.hours.size", "large").includes("gw-hours-mobile-large"),
    "large maps to large class",
  );
  ok(
    selectClassName("header.hours.size", "") === normalCls,
    "blank value falls back to the default class",
  );
  ok(
    selectClassName("header.hours.size", "bogus") === normalCls,
    "unknown value falls back to the default class",
  );
  ok(selectClassName("header.hours.size", null) === normalCls, "null value → default class");
  ok(selectClassName("nope", "large") === "", "unknown block → empty class");

  // Every hours option's class is non-empty (so a choice always does something).
  for (const o of HOURS_SIZE_OPTIONS) {
    ok(o.className.trim().length > 0, `option ${o.value} has a class`);
    ok(o.label.trim().length > 0, `option ${o.value} has a label`);
  }

  // Medical visibility select (SLICE 107) — drives routing/nav, not CSS, so an
  // empty className is valid. Default (first) is "no" = Visible, so a blank /
  // unseeded value can never hide the page.
  ok(isSelectBlock("medical.page.hidden"), "medical.page.hidden is a select block");
  ok(selectDefaultValue("medical.page.hidden") === "no", "medical default = 'no' (Visible)");
  const medSpec = resolveSelectSpec("medical.page.hidden");
  ok(!!medSpec && medSpec.options.length === 2, "medical select has 2 options");
  ok(medSpec!.options[0]!.value === "no", "medical first option is 'no'");
  ok(medSpec!.options[1]!.value === "yes", "medical second option is 'yes'");
  for (const o of MEDICAL_HIDE_SELECT_OPTIONS) {
    ok(o.label.trim().length > 0, `medical option ${o.value} has a label`);
  }

  return { passed };
}
