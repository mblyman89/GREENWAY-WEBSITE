/**
 * src/lib/inventory/transport-fields-core.ts  (PR — transport gap-fill)
 *
 * PURE, dependency-free readers for transport-detail fields that the existing
 * vendor PDF parsers leave null. This is ADDITIVE ONLY: callers use it to fill
 * fields that are still blank AFTER their own extraction — it never overrides a
 * value a vendor parser already found, and it NEVER touches classification,
 * line-items, or the activate path.
 *
 * The single most-wanted missing field (owner Priority 2) is the DRIVER'S
 * LICENSE NUMBER. It is present in the real WA-State transportation manifest
 * (VMI): "Driver's Name: David Homer  Date of Birth: 03/04/1972  License #:
 * H0M3R  Vehicle Make: Ram ...". The trick is that the SAME "License #:" label
 * also appears in the ORIGIN-licensee block (a numeric WA license like 413287).
 * So we only accept the "License #:" that sits INSIDE the driver block — after
 * "Driver('s) Name:" (optionally past a "Date of Birth:") and BEFORE the first
 * "Vehicle" label. Anything that looks like a plain WA origin license (6 digits)
 * standing alone is rejected to avoid mistaking the origin license for a DL.
 *
 * WHY PURE: no I/O, no imports — unit-testable with tsx and mirrored in vitest.
 */

/** The subset of transport fields this helper can recover. All optional. */
export type ExtractedTransportFields = {
  driver_license_number?: string | null;
};

/** Collapse whitespace so label/value adjacency survives PDF line wrapping. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Read the driver's license number from a transportation-manifest text, anchored
 * strictly to the driver block so the origin-licensee "License #:" can't match.
 *
 * Accepts the value that follows a "Driver('s) Name:" ... "License #:" sequence
 * (optionally with a "Date of Birth:" in between), stopping before the first
 * "Vehicle" label. Returns null when no driver-scoped license is present.
 */
export function readDriverLicenseNumber(text: string): string | null {
  if (!text) return null;
  const flat = flatten(text);

  // Window: from the driver-name label up to (but not including) the first
  // "Vehicle" label. The DL "License #:" lives in this window; the origin
  // "License #:" lives OUTSIDE it (in the origin-licensee block).
  const driverBlock = flat.match(
    /Driver(?:'|\u2019)?s?\s*Name\s*:.*?(?=\bVehicle\b|$)/i,
  );
  if (!driverBlock) return null;
  const block = driverBlock[0];

  // Within the driver block, the license label may be "License #:", "License
  // No:", "License Number:", "DL #:", "Driver License #:". Value is an
  // alphanumeric token (H0M3R, WA123456, 1234567) — 3..20 chars, must not be a
  // date and must contain at least one alnum. We do NOT require a digit because
  // a real DL can be mostly letters.
  const m = block.match(
    /((?:Driver\s+)?\b(?:License|Lic|DL)\b\s*(?:#|No\.?|Number)?\s*:)\s*([A-Za-z0-9][A-Za-z0-9-]{2,19})/i,
  );
  if (!m) return null;
  const labelText = m[1]; // the matched label, e.g. "License #:" or "Driver License #:"
  const val = m[2].trim();

  // Reject date-like or "Not Applicable"/"None"/"N/A" placeholders. The value
  // token may capture just the first word ("Not" of "Not Applicable"), so we
  // reject "not"/"applicable"/"none"/"n/a" as standalone captures too.
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(val)) return null;
  if (/^(?:not|n\/?a|none|na|applicable|unknown|tbd)$/i.test(val)) return null;
  // Also reject when the matched value is the start of a "Not Applicable" phrase.
  if (/^Not$/i.test(val) && /Not\s+Applicable/i.test(block)) return null;
  // Reject a bare 6-digit token that is far more likely a WA origin license than
  // a DL, UNLESS the label explicitly said "Driver License"/"DL".
  const labelWasDriverExplicit = /(?:Driver\s+License|\bDL\b)/i.test(labelText);
  if (!labelWasDriverExplicit && /^\d{6}$/.test(val)) return null;

  return val.toUpperCase();
}

/**
 * Recover the transport fields the vendor parsers commonly leave null. Currently
 * just the driver license number; kept as a struct so future additive fields
 * (e.g. an alternate vehicle-plate anchor) can join without changing callers.
 */
export function extractTransportFields(text: string): ExtractedTransportFields {
  return {
    driver_license_number: readDriverLicenseNumber(text),
  };
}

/** tsx / vitest self-test bundle. Returns a summary string; throws on failure. */
export function __runTransportFieldsCoreTests(): string {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    n += 1;
    if (!cond) throw new Error(`transport-fields-core self-test FAILED: ${msg}`);
  };

  // 1) Real VMI WA-State manifest shape: DL is "H0M3R" in the driver block; the
  //    origin license 413287 must NOT win.
  const vmi =
    "Origin License Name: Grow Op Farms License #: 413287 Licensee Phone: 5098791221 " +
    "Driver's Name: David Homer Date of Birth: 03/04/1972 License #: H0M3R " +
    "Vehicle Make: Ram Vehicle Model: Promaster 3500 159 EXT Vehicle Color: White";
  ok(readDriverLicenseNumber(vmi) === "H0M3R", `VMI DL should be H0M3R, got ${readDriverLicenseNumber(vmi)}`);

  // 2) No driver block at all -> null (never grabs the origin license).
  const originOnly = "Origin License Name: FIRETREE LLC License #: 418524 Licensee Phone: 2063513719";
  ok(readDriverLicenseNumber(originOnly) === null, "origin-only text should yield null");

  // 3) "Not Applicable" placeholder (contingency manifest) -> null.
  const na = "Driver's Name: Not Applicable License #: Not Applicable Vehicle Make: Not Applicable";
  ok(readDriverLicenseNumber(na) === null, "Not Applicable DL should be null");

  // 4) Explicit "Driver License #:" with a 6-digit value IS accepted (explicit
  //    label overrides the bare-6-digit origin-license guard).
  const explicit = "Driver Name: Jane Q Driver License #: 123456 Vehicle Make: Ford";
  ok(readDriverLicenseNumber(explicit) === "123456", `explicit DL 123456, got ${readDriverLicenseNumber(explicit)}`);

  // 5) A bare 6-digit "License #:" in the driver block (ambiguous, non-explicit
  //    label) is REJECTED so we never mistake an origin license for a DL.
  const ambiguous = "Driver's Name: Sam Hauler License #: 654321 Vehicle Make: Ram";
  ok(readDriverLicenseNumber(ambiguous) === null, "ambiguous bare-6-digit DL should be rejected");

  // 6) Alphanumeric WA-style DL is accepted.
  const wa = "Driver's Name: Kim Lane License #: WA1234ABC Vehicle Color: Blue";
  ok(readDriverLicenseNumber(wa) === "WA1234ABC", `WA DL, got ${readDriverLicenseNumber(wa)}`);

  // 7) Date value in the license slot is rejected.
  const dated = "Driver's Name: A B License #: 03/04/1972 Vehicle Make: X";
  ok(readDriverLicenseNumber(dated) === null, "date-shaped DL should be rejected");

  // 8) empty / junk input -> null, no throw.
  ok(readDriverLicenseNumber("") === null, "empty -> null");
  ok(extractTransportFields("").driver_license_number === null, "struct empty -> null");

  // 9) The struct returns the same value the direct reader does.
  ok(extractTransportFields(vmi).driver_license_number === "H0M3R", "struct matches reader");

  return `transport-fields-core: ${n} assertions passed`;
}
