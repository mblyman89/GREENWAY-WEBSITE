/**
 * src/lib/pos/receipt-config-core.ts  (POS Slice B13)
 *
 * PURE receipt-customization config (no I/O, no server-only imports) — the
 * owner-editable pieces of the register receipt, the way the big POS players
 * (Square, Toast, Clover) expose them: header, address/contact block, footer
 * message, and display toggles.
 *
 * The config is stored as a site_settings JSON value (no migration), shipped
 * to the register inside the /api/pos/menu bundle so OFFLINE sales print the
 * owner's customized receipt, and consumed by the pure receipt builder
 * (pos/receipt-core), so the admin live preview and the paper output can
 * never drift — they run the IDENTICAL builder.
 *
 * Normalization is deliberately foolproof: unknown/garbage input degrades to
 * safe defaults, lengths are clamped so a runaway paste can't produce a
 * meter-long receipt, and toggles coerce to booleans.
 */

export type PosReceiptConfig = {
  /** Big centered store name at the top. */
  headerText: string;
  /**
   * Address / phone / license block under the header — newline-separated,
   * printed one centered line each (e.g. street, city, phone, license #).
   */
  addressText: string;
  /** Footer message (warning + thank-you). Printed centered at the bottom. */
  footerText: string;
  /** Print "Served by <first name>" under the register line. */
  showEmployee: boolean;
  /** Print the "You saved" promo-savings line when savings > 0. */
  showSavings: boolean;
  /** Print the loyalty points block when the sale has a member attached. */
  showLoyalty: boolean;
};

export const RECEIPT_HEADER_MAX = 60;
export const RECEIPT_ADDRESS_MAX = 240;
export const RECEIPT_FOOTER_MAX = 400;
/** Max printed lines for the address block (paper is not infinite). */
export const RECEIPT_ADDRESS_MAX_LINES = 5;

export const DEFAULT_POS_RECEIPT_CONFIG: PosReceiptConfig = {
  headerText: "GREENWAY MARIJUANA",
  addressText: "",
  footerText:
    "This product has intoxicating effects and may be habit forming. Keep out of reach of children. Thank you!",
  showEmployee: true,
  showSavings: true,
  showLoyalty: true,
};

function clampText(v: unknown, max: number, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  if (!trimmed) return fallback;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/**
 * Normalize an untrusted value (site_settings JSON, form payload, cached
 * bundle) into a safe PosReceiptConfig. Never throws.
 */
export function normalizePosReceiptConfig(raw: unknown): PosReceiptConfig {
  const d = DEFAULT_POS_RECEIPT_CONFIG;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const o = raw as Record<string, unknown>;
  // Address may be legitimately EMPTY (owner clears it) — clamp separately.
  const rawAddress = typeof o.addressText === "string" ? o.addressText : "";
  const addressLines = rawAddress
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, RECEIPT_ADDRESS_MAX_LINES);
  const addressText = addressLines.join("\n").slice(0, RECEIPT_ADDRESS_MAX);
  return {
    headerText: clampText(o.headerText, RECEIPT_HEADER_MAX, d.headerText),
    addressText,
    footerText: clampText(o.footerText, RECEIPT_FOOTER_MAX, d.footerText),
    showEmployee: coerceBool(o.showEmployee, d.showEmployee),
    showSavings: coerceBool(o.showSavings, d.showSavings),
    showLoyalty: coerceBool(o.showLoyalty, d.showLoyalty),
  };
}

/** Split the address block into its printable lines (already normalized). */
export function receiptAddressLines(config: Pick<PosReceiptConfig, "addressText">): string[] {
  return config.addressText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, RECEIPT_ADDRESS_MAX_LINES);
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReceiptConfigCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL receipt-config-core: ${label}`);
    }
  };

  // Defaults on garbage input
  ok(normalizePosReceiptConfig(null).headerText === "GREENWAY MARIJUANA", "null → default header");
  ok(normalizePosReceiptConfig("junk").footerText.includes("intoxicating"), "string → default footer");
  ok(normalizePosReceiptConfig([1, 2]).showSavings === true, "array → default toggles");
  ok(normalizePosReceiptConfig(undefined).showEmployee === true, "undefined → default showEmployee");
  ok(normalizePosReceiptConfig({}).showLoyalty === true, "empty object → default showLoyalty");

  // Round-trip of a valid config
  const cfg = normalizePosReceiptConfig({
    headerText: "  Greenway Marijuana  ",
    addressText: "9107 SW State Hwy 3\nPort Orchard, WA 98367\n(360) 616-0700\nLicense 413541",
    footerText: "Thanks!",
    showEmployee: false,
    showSavings: false,
    showLoyalty: false,
  });
  ok(cfg.headerText === "Greenway Marijuana", "header trimmed");
  ok(receiptAddressLines(cfg).length === 4, "four address lines survive");
  ok(receiptAddressLines(cfg)[3] === "License 413541", "license line preserved");
  ok(cfg.footerText === "Thanks!", "footer kept");
  ok(!cfg.showEmployee && !cfg.showSavings && !cfg.showLoyalty, "toggles off round-trip");

  // Clamps
  const long = normalizePosReceiptConfig({ headerText: "H".repeat(500) });
  ok(long.headerText.length === RECEIPT_HEADER_MAX, "header clamped to max");
  const manyLines = normalizePosReceiptConfig({
    addressText: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"),
  });
  ok(receiptAddressLines(manyLines).length === RECEIPT_ADDRESS_MAX_LINES, "address lines clamped");
  const blanks = normalizePosReceiptConfig({ addressText: "  \n\n one \n  \n two " });
  ok(receiptAddressLines(blanks).join("|") === "one|two", "blank address lines dropped");

  // Empty strings fall back for header/footer but NOT address (clearable)
  const empty = normalizePosReceiptConfig({ headerText: "   ", footerText: "", addressText: "" });
  ok(empty.headerText === "GREENWAY MARIJUANA", "blank header → default");
  ok(empty.footerText.includes("intoxicating"), "blank footer → default");
  ok(empty.addressText === "", "blank address stays empty (owner cleared it)");

  // String booleans (form payloads)
  const strBools = normalizePosReceiptConfig({ showEmployee: "false", showSavings: "true", showLoyalty: 42 });
  ok(strBools.showEmployee === false, '"false" coerces to false');
  ok(strBools.showSavings === true, '"true" coerces to true');
  ok(strBools.showLoyalty === true, "non-bool falls back to default");

  console.log(`receipt-config-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`receipt-config-core: ${fail} failure(s)`);
}
