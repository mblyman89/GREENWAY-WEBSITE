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

import { RECEIPT_LOGO_WIDTH, clampLogoWidth } from "./receipt-logo-core";

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

  // -- Slice 22b additions ------------------------------------------------
  /**
   * Itemize the cannabis excise tax separately from the retail sales tax.
   *
   * Defaults ON and is deliberately the FIRST option, because unlike every
   * other toggle here this one is not a preference. RCW 69.50.535(1)(a):
   * "The tax must be separately itemized from the state and local retail
   * sales tax on the sales receipt provided to the buyer." Turning it off
   * prints a single combined Tax line — the pre-22b behaviour — which the
   * admin screen warns about rather than silently allowing.
   */
  showTaxBreakdown: boolean;
  /** Print the Greenway script wordmark at the top of the receipt. */
  showLogo: boolean;
  /** Printed width of the wordmark in printer dots (192..576). */
  logoWidth: number;
  /** Print the store's return policy near the bottom. */
  showReturnPolicy: boolean;
  /**
   * Return-policy wording. Empty string = use the wording generated from the
   * live constants in pos/returns-core, so the printed policy can never
   * contradict what the returns screen actually enforces.
   */
  returnPolicyText: string;
  /**
   * Print the per-item detail line (brand, size, strain, THC, discount name)
   * under each product. This is the "data rich" switch.
   */
  showItemDetail: boolean;
  /** Print the scannable code (QR by default) of the receipt number. */
  showBarcode: boolean;
  /** Print the item-count / savings-summary strip above the footer. */
  showSaleSummary: boolean;
  /**
   * SLICE 23 — render the receipt-number code as a QR instead of Code 128.
   * Default true: QR carries Reed-Solomon error correction (a folded, faded
   * receipt still scans), is square so it costs less paper width, and every
   * phone camera reads it. The switch exists only to fall back to Code 128 for
   * an old 1-D-only scanner.
   */
  useQrCode: boolean;
  /**
   * SLICE 23 — a custom logo printed BELOW the QR and the fun name, ABOVE the
   * footer. Stored as a 1-bit BMP data URI already prepared by
   * printing/logo-print-core (thresholded, cropped, sized). Empty = none.
   *
   * This is SEPARATE from showLogo/logoWidth, which control the built-in
   * wordmark at the TOP of the receipt. Both can be on at once.
   */
  bottomLogoDataUri: string;
  /** SLICE 23 — printed width of the bottom logo, in dots. */
  bottomLogoWidth: number;
};

/** SLICE 23 — default printed width of the bottom logo (body is 576 dots). */
export const RECEIPT_BOTTOM_LOGO_WIDTH = 220;
/** SLICE 23 — the widest the bottom logo may print (full paper width). */
export const RECEIPT_BOTTOM_LOGO_MAX = 576;
/** SLICE 23 — narrower than this and artwork stops being legible on paper. */
export const RECEIPT_BOTTOM_LOGO_MIN = 80;

/**
 * SLICE 23 — cap on the stored bottom-logo data URI, in characters.
 *
 * This is a hard practical limit, not a stylistic one: receipt-core's
 * buildPassPrntUrl percent-encodes the ENTIRE receipt HTML into a
 * starpassprnt:// URL, so anything embedded rides along inside that URL. The
 * prepared 1-bit BMPs from the owner's real logo files measured 3.7-4.8 KB, so
 * 64 KB leaves well over an order of magnitude of headroom while still
 * refusing a full-colour photograph outright.
 */
export const RECEIPT_BOTTOM_LOGO_MAX_CHARS = 64_000;

/** Clamp the bottom-logo print width into the legible, printable range. */
export function clampBottomLogoWidth(value: number): number {
  if (!Number.isFinite(value)) return RECEIPT_BOTTOM_LOGO_WIDTH;
  return Math.max(
    RECEIPT_BOTTOM_LOGO_MIN,
    Math.min(RECEIPT_BOTTOM_LOGO_MAX, Math.round(value)),
  );
}

/**
 * Accept a bottom-logo data URI only if it is a real, self-contained 1-bit
 * image. A remote URL is rejected outright: it would make a receipt depend on
 * the network at print time, and register sales must print offline.
 */
export function sanitizeBottomLogo(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  if (v.length > RECEIPT_BOTTOM_LOGO_MAX_CHARS) return "";
  return /^data:image\/(png|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : "";
}

export const RECEIPT_HEADER_MAX = 60;
export const RECEIPT_ADDRESS_MAX = 240;
export const RECEIPT_FOOTER_MAX = 400;
/** Max printed lines for the address block (paper is not infinite). */
export const RECEIPT_ADDRESS_MAX_LINES = 5;
/** Max characters of custom return-policy wording. */
export const RECEIPT_RETURN_POLICY_MAX = 400;

export const DEFAULT_POS_RECEIPT_CONFIG: PosReceiptConfig = {
  headerText: "GREENWAY MARIJUANA",
  addressText: "",
  footerText:
    "This product has intoxicating effects and may be habit forming. Keep out of reach of children. Thank you!",
  showEmployee: true,
  showSavings: true,
  showLoyalty: true,
  // Statutory itemization: on by default, everywhere, including on a cached
  // pre-22b bundle that carries no value for it (coerceBool falls back here).
  showTaxBreakdown: true,
  showLogo: true,
  logoWidth: RECEIPT_LOGO_WIDTH,
  showReturnPolicy: true,
  returnPolicyText: "",
  showItemDetail: true,
  showBarcode: true,
  showSaleSummary: true,
  // SLICE 23 — QR on by default; it error-corrects and Code 128 does not.
  useQrCode: true,
  bottomLogoDataUri: "",
  bottomLogoWidth: RECEIPT_BOTTOM_LOGO_WIDTH,
};

function clampText(v: unknown, max: number, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  if (!trimmed) return fallback;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Clamp text that is allowed to be empty. Unlike clampText there is no
 * default sentence: "" is a real, intended value the owner can choose.
 */
function clampOptionalText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Accept a number or a numeric string (form payloads post strings). */
function coerceNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
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
    showTaxBreakdown: coerceBool(o.showTaxBreakdown, d.showTaxBreakdown),
    showLogo: coerceBool(o.showLogo, d.showLogo),
    logoWidth: clampLogoWidth(coerceNumber(o.logoWidth, d.logoWidth)),
    showReturnPolicy: coerceBool(o.showReturnPolicy, d.showReturnPolicy),
    // Empty is MEANINGFUL here (= "use the wording from the live constants"),
    // so this clamps without falling back to a default sentence.
    returnPolicyText: clampOptionalText(o.returnPolicyText, RECEIPT_RETURN_POLICY_MAX),
    showItemDetail: coerceBool(o.showItemDetail, d.showItemDetail),
    showBarcode: coerceBool(o.showBarcode, d.showBarcode),
    showSaleSummary: coerceBool(o.showSaleSummary, d.showSaleSummary),
    // SLICE 23. A cached pre-23 bundle carries no value for these, so
    // coerceBool falls back to the default above (QR on) rather than to
    // `false`, which would silently downgrade every register to Code 128.
    useQrCode: coerceBool(o.useQrCode, d.useQrCode),
    bottomLogoDataUri: sanitizeBottomLogo(o.bottomLogoDataUri),
    bottomLogoWidth: clampBottomLogoWidth(coerceNumber(o.bottomLogoWidth, d.bottomLogoWidth)),
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
