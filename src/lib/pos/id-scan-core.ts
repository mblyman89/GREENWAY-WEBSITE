/**
 * src/lib/pos/id-scan-core.ts  (POS Slice B3)
 *
 * PURE ID-verification core for the register's mandatory ID gate. No React,
 * no DB, no server-only — runs on the iPad (Capacitor) and anywhere else the
 * gate is needed.
 *
 * Two paths, both ending in the same verdict shape:
 *   1. SCAN — parse the AAMVA PDF417 barcode on US/Canada driver licenses and
 *      ID cards (AAMVA DL/ID Card Design Standard: "@\n\x1e\rANSI " header,
 *      subfile directory, DL/ID subfile with 3-letter data element IDs).
 *   2. MANUAL — for acceptable IDs without a PDF417 (passports, Global Entry,
 *      tribal cards) or unreadable barcodes. Requires the WAC 314-55-150 ID
 *      type + DOB + expiry and ALWAYS produces an audit record (owner rule:
 *      "a manual process included just in case with an audit trail attached
 *      any time one is done manually").
 *
 * Age/expiry math is done against the store's Pacific wall-clock date, passed
 * in as a YYYY-MM-DD string (same discipline as timeclock-core: the caller
 * resolves "today in America/Los_Angeles"; this core stays pure).
 *
 * WAC 314-55-150 (as amended WSR 25-21-035, eff. 11/8/2025) acceptable IDs —
 * verified list, expired documents are NOT acceptable.
 */

// ---------------------------------------------------------------------------
// WAC 314-55-150 acceptable identification types
// ---------------------------------------------------------------------------

export const ACCEPTABLE_ID_TYPES = [
  { key: "drivers_license", label: "Driver's license / instruction permit / ID card (any US state/territory, DC, or Canadian province)", scannable: true },
  { key: "wa_identicard", label: "Washington identicard", scannable: true },
  { key: "us_armed_forces", label: "United States armed forces ID", scannable: false },
  { key: "passport", label: "Passport or passport card", scannable: false },
  { key: "nexus", label: "NEXUS card", scannable: false },
  { key: "global_entry", label: "Global Entry card (acceptable eff. 11/8/2025)", scannable: false },
  { key: "permanent_resident", label: "Permanent Resident card (acceptable eff. 11/8/2025)", scannable: false },
  { key: "merchant_marine", label: "Merchant Marine ID", scannable: false },
  { key: "tribal_enrollment", label: "Tribal enrollment card", scannable: false },
] as const;

export type AcceptableIdType = (typeof ACCEPTABLE_ID_TYPES)[number]["key"];

export function isAcceptableIdType(v: unknown): v is AcceptableIdType {
  return typeof v === "string" && ACCEPTABLE_ID_TYPES.some((t) => t.key === v);
}

/** Statutory minimum age for recreational cannabis sales (RCW 69.50.357). */
export const MINIMUM_AGE_YEARS = 21;

// ---------------------------------------------------------------------------
// Date helpers (pure; dates as YYYY-MM-DD wall-clock strings)
// ---------------------------------------------------------------------------

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = YMD_RE.exec(v);
  if (!m) return false;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through Date (UTC) to reject impossible dates like 02-30.
  const dt = new Date(Date.UTC(Number(y), month - 1, day));
  return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/** AAMVA dates are MMDDCCYY (US) or CCYYMMDD (Canada). Normalize to YYYY-MM-DD. */
export function parseAamvaDate(raw: string, country: "USA" | "CAN"): string | null {
  const s = (raw ?? "").trim();
  if (!/^\d{8}$/.test(s)) return null;
  const ymd = country === "CAN"
    ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    : `${s.slice(4, 8)}-${s.slice(0, 2)}-${s.slice(2, 4)}`;
  return isYmd(ymd) ? ymd : null;
}

/** Whole years between a YYYY-MM-DD birth date and a YYYY-MM-DD "today". */
export function ageOn(dobYmd: string, todayYmd: string): number | null {
  if (!isYmd(dobYmd) || !isYmd(todayYmd)) return null;
  const [by, bm, bd] = dobYmd.split("-").map(Number);
  const [ty, tm, td] = todayYmd.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Expired = expiry date is strictly BEFORE today (a card is valid through its expiry date). */
export function isExpired(expiryYmd: string, todayYmd: string): boolean | null {
  if (!isYmd(expiryYmd) || !isYmd(todayYmd)) return null;
  return expiryYmd < todayYmd; // lexicographic works for zero-padded YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// AAMVA PDF417 parsing
// ---------------------------------------------------------------------------

/** Parsed identity fields (element IDs per the AAMVA DL/ID standard). */
export type AamvaLicense = {
  /** DAQ — customer/license number. */
  licenseNumber: string | null;
  /** DCS — family name. */
  lastName: string | null;
  /** DAC — first name. */
  firstName: string | null;
  /** DBB — date of birth, normalized YYYY-MM-DD. */
  dateOfBirth: string | null;
  /** DBA — expiration date, normalized YYYY-MM-DD. */
  expirationDate: string | null;
  /** DBD — issue date, normalized YYYY-MM-DD. */
  issueDate: string | null;
  /** DAJ — jurisdiction (state/province) code. */
  jurisdiction: string | null;
  /** DCG — country (USA | CAN). */
  country: "USA" | "CAN";
  /** AAMVA spec version from the header (e.g. 8, 9, 10). */
  aamvaVersion: number | null;
};

export type AamvaParseResult =
  | { ok: true; license: AamvaLicense }
  | { ok: false; error: string };

/**
 * Parse raw PDF417 barcode text from a US/Canada DL/ID into identity fields.
 *
 * Format (AAMVA DL/ID Card Design Standard): compliance indicator "@",
 * data element separator LF, record separator RS (\x1e), segment terminator
 * CR, then "ANSI " + IIN(6) + version(2) + ... and one or more subfiles.
 * We locate the DL or ID subfile and read LF-separated elements, each a
 * 3-letter ID followed by its value. Tolerant of CRLF variants produced by
 * real scanners in keyboard-wedge mode.
 */
export function parseAamvaPdf417(raw: string): AamvaParseResult {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { ok: false, error: "Empty scan." };
  const ansiAt = text.indexOf("ANSI ");
  if (!text.startsWith("@") || ansiAt === -1) {
    return { ok: false, error: "Not an AAMVA DL/ID barcode (missing @/ANSI header)." };
  }

  // Header: ANSI + IIN(6) + AAMVA version (2 digits).
  const versionRaw = text.slice(ansiAt + 5 + 6, ansiAt + 5 + 6 + 2);
  const aamvaVersion = /^\d{2}$/.test(versionRaw) ? Number(versionRaw) : null;

  // Find the DL/ID subfile body. Elements begin right after the "DL"/"ID"
  // subfile designator that is FOLLOWED by element data (the directory entry
  // also says "DL" but is followed by offset DIGITS — the body's designator
  // is immediately followed by a 3-letter element ID starting with "D").
  // First match wins: the body designator precedes all data elements.
  const bodyMatch = /(?:DL|ID)(D[A-Z]{2}[\s\S]*)$/.exec(text);
  let body: string;
  if (bodyMatch) {
    body = bodyMatch[1];
  } else {
    // Fallback: some scanners strip subfile designators — take everything
    // after the header line and parse element-shaped lines directly.
    const afterHeader = text.slice(ansiAt);
    const firstElem = afterHeader.search(/D[A-Z]{2}/);
    if (firstElem === -1) return { ok: false, error: "No DL/ID data elements found in scan." };
    body = afterHeader.slice(firstElem);
  }

  // Split on LF / CR / RS; each field is <3-letter ID><value>.
  const fields = new Map<string, string>();
  for (const chunk of body.split(/[\n\r\x1e]+/)) {
    const line = chunk.trim();
    if (line.length < 3) continue;
    const id = line.slice(0, 3);
    if (!/^[A-Z]{3}$/.test(id)) continue;
    if (!fields.has(id)) fields.set(id, line.slice(3).trim());
  }
  if (fields.size === 0) return { ok: false, error: "No DL/ID data elements found in scan." };

  const countryRaw = (fields.get("DCG") ?? "USA").toUpperCase();
  const country: "USA" | "CAN" = countryRaw === "CAN" ? "CAN" : "USA";

  const license: AamvaLicense = {
    licenseNumber: fields.get("DAQ") ?? null,
    lastName: fields.get("DCS") ?? null,
    firstName: fields.get("DAC") ?? fields.get("DCT") ?? null, // DCT = older (pre-2009) versions
    dateOfBirth: fields.has("DBB") ? parseAamvaDate(fields.get("DBB")!, country) : null,
    expirationDate: fields.has("DBA") ? parseAamvaDate(fields.get("DBA")!, country) : null,
    issueDate: fields.has("DBD") ? parseAamvaDate(fields.get("DBD")!, country) : null,
    jurisdiction: fields.get("DAJ") ?? null,
    country,
    aamvaVersion,
  };

  if (!license.dateOfBirth) {
    return { ok: false, error: "Scan is missing a readable date of birth (DBB) — use manual verification." };
  }
  return { ok: true, license };
}

// ---------------------------------------------------------------------------
// The ID gate verdict — one shape for both paths
// ---------------------------------------------------------------------------

export type IdGateVerdict =
  | {
      allowed: true;
      method: "scan" | "manual";
      age: number;
      dateOfBirth: string;
      expirationDate: string | null;
      /** For manual verifies: the WAC-acceptable ID type selected. */
      idType: AcceptableIdType | null;
    }
  | { allowed: false; method: "scan" | "manual"; reason: string };

/**
 * Evaluate a SCANNED license against the gate: readable DOB, 21+, not expired.
 * `todayYmd` = today's date on the store's Pacific wall clock.
 */
export function evaluateScannedId(license: AamvaLicense, todayYmd: string): IdGateVerdict {
  if (!isYmd(todayYmd)) return { allowed: false, method: "scan", reason: "Internal error: invalid store date." };
  if (!license.dateOfBirth || !isYmd(license.dateOfBirth)) {
    return { allowed: false, method: "scan", reason: "Scan has no readable date of birth — use manual verification." };
  }
  const age = ageOn(license.dateOfBirth, todayYmd);
  if (age === null || age < MINIMUM_AGE_YEARS) {
    return { allowed: false, method: "scan", reason: `Customer is under ${MINIMUM_AGE_YEARS} (age ${age ?? "unknown"}). Sale refused.` };
  }
  if (license.expirationDate) {
    const expired = isExpired(license.expirationDate, todayYmd);
    if (expired) {
      return { allowed: false, method: "scan", reason: `ID expired ${license.expirationDate}. Expired identification is not acceptable (WAC 314-55-150).` };
    }
  } else {
    return { allowed: false, method: "scan", reason: "Scan has no readable expiration date — use manual verification." };
  }
  return {
    allowed: true,
    method: "scan",
    age,
    dateOfBirth: license.dateOfBirth,
    expirationDate: license.expirationDate,
    idType: "drivers_license",
  };
}

// ---------------------------------------------------------------------------
// Manual verification (audited fallback)
// ---------------------------------------------------------------------------

export type ManualIdInput = {
  /** WAC 314-55-150 acceptable ID type the budtender is holding. */
  idType: string;
  /** DOB from the document, YYYY-MM-DD. */
  dateOfBirth: string;
  /** Expiry from the document, YYYY-MM-DD ("" only if document shows none). */
  expirationDate: string;
  /** Why manual instead of scan (required — audit trail). */
  reason: string;
  /** Budtender confirms the photo matches the customer. */
  photoMatchConfirmed: boolean;
};

/**
 * Validate + evaluate a manual ID check. On success the caller MUST emit a
 * `manual_id_verification` event (sale-event-core) so the audit trail exists;
 * the sale payload then references that event's UUID.
 */
export function evaluateManualId(input: ManualIdInput, todayYmd: string): IdGateVerdict {
  if (!isYmd(todayYmd)) return { allowed: false, method: "manual", reason: "Internal error: invalid store date." };
  if (!isAcceptableIdType(input.idType)) {
    return { allowed: false, method: "manual", reason: "Select an acceptable ID type from the WAC 314-55-150 list." };
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) {
    return { allowed: false, method: "manual", reason: "Enter why the ID was verified manually (3–500 characters)." };
  }
  if (!input.photoMatchConfirmed) {
    return { allowed: false, method: "manual", reason: "Confirm the photo matches the customer." };
  }
  if (!isYmd(input.dateOfBirth)) {
    return { allowed: false, method: "manual", reason: "Enter the date of birth exactly as shown on the document." };
  }
  const age = ageOn(input.dateOfBirth, todayYmd);
  if (age === null || age < MINIMUM_AGE_YEARS) {
    return { allowed: false, method: "manual", reason: `Customer is under ${MINIMUM_AGE_YEARS} (age ${age ?? "unknown"}). Sale refused.` };
  }
  const expiry = (input.expirationDate ?? "").trim();
  if (!isYmd(expiry)) {
    return { allowed: false, method: "manual", reason: "Enter the document's expiration date." };
  }
  if (isExpired(expiry, todayYmd)) {
    return { allowed: false, method: "manual", reason: `Document expired ${expiry}. Expired identification is not acceptable (WAC 314-55-150).` };
  }
  return {
    allowed: true,
    method: "manual",
    age,
    dateOfBirth: input.dateOfBirth,
    expirationDate: expiry,
    idType: input.idType,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runIdScanCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else { fail += 1; console.log("FAIL:", msg); }
  };

  // Date helpers
  ok(isYmd("2026-07-13"), "ymd ok");
  ok(!isYmd("2026-02-30"), "impossible date rejected");
  ok(!isYmd("07/13/2026"), "wrong format rejected");
  ok(parseAamvaDate("07131990", "USA") === "1990-07-13", "US MMDDCCYY");
  ok(parseAamvaDate("19900713", "CAN") === "1990-07-13", "CAN CCYYMMDD");
  ok(parseAamvaDate("13311990", "USA") === null, "impossible AAMVA date rejected");
  ok(ageOn("2005-07-13", "2026-07-13") === 21, "21st birthday counts as 21");
  ok(ageOn("2005-07-14", "2026-07-13") === 20, "day before birthday is 20");
  ok(isExpired("2026-07-12", "2026-07-13") === true, "expired yesterday");
  ok(isExpired("2026-07-13", "2026-07-13") === false, "valid through expiry date");

  // AAMVA parse — realistic WA-style payload (LF-separated, RS present)
  const wa =
    "@\n\x1e\rANSI 636045080002DL00410278ZW03190008DLDAQWDL123ABC456\n" +
    "DCSPUBLIC\nDACJOHN\nDADQ\nDBD09152023\nDBB07131990\nDBA07132028\n" +
    "DBC1\nDAYBRO\nDAU070 in\nDAG123 MAIN ST\nDAIPORT ORCHARD\nDAJWA\nDAK983660000\nDCGUSA\n";
  {
    const r = parseAamvaPdf417(wa);
    ok(r.ok, "WA payload parses");
    if (r.ok) {
      ok(r.license.licenseNumber === "WDL123ABC456", "DAQ");
      ok(r.license.lastName === "PUBLIC" && r.license.firstName === "JOHN", "name");
      ok(r.license.dateOfBirth === "1990-07-13", "DBB normalized");
      ok(r.license.expirationDate === "2028-07-13", "DBA normalized");
      ok(r.license.issueDate === "2023-09-15", "DBD normalized");
      ok(r.license.jurisdiction === "WA" && r.license.country === "USA", "DAJ/DCG");
      ok(r.license.aamvaVersion === 8, "version 08 from header");
    }
  }
  // CRLF + CAN variant
  {
    const can = "@\r\n\x1e\rANSI 636028100002DL00410200DLDAQ12345\r\nDCSROY\r\nDACAVA\r\nDBB19980215\r\nDBA20290215\r\nDAJBC\r\nDCGCAN\r\n";
    const r = parseAamvaPdf417(can);
    ok(r.ok, "CAN CRLF payload parses");
    if (r.ok) {
      ok(r.license.dateOfBirth === "1998-02-15", "CAN DBB CCYYMMDD");
      ok(r.license.expirationDate === "2029-02-15", "CAN DBA CCYYMMDD");
      ok(r.license.country === "CAN", "CAN country");
    }
  }
  ok(!parseAamvaPdf417("hello world").ok, "non-AAMVA text rejected");
  ok(!parseAamvaPdf417("").ok, "empty rejected");
  {
    const noDob = "@\n\x1e\rANSI 636045080002DL00410278DLDAQX1\nDCSDOE\n";
    ok(!parseAamvaPdf417(noDob).ok, "missing DOB rejected (forces manual path)");
  }

  // Scan gate
  {
    const r = parseAamvaPdf417(wa);
    if (r.ok) {
      const v = evaluateScannedId(r.license, "2026-07-13");
      ok(v.allowed && v.age === 36 && v.method === "scan", "adult valid scan allowed");
      const under = evaluateScannedId({ ...r.license, dateOfBirth: "2006-07-14" }, "2026-07-13");
      ok(!under.allowed && under.reason.includes("under 21"), "under-21 blocked");
      const exactly21 = evaluateScannedId({ ...r.license, dateOfBirth: "2005-07-13" }, "2026-07-13");
      ok(exactly21.allowed, "21st birthday allowed");
      const expired = evaluateScannedId({ ...r.license, expirationDate: "2026-07-12" }, "2026-07-13");
      ok(!expired.allowed && expired.reason.includes("Expired"), "expired ID blocked");
      const noExp = evaluateScannedId({ ...r.license, expirationDate: null }, "2026-07-13");
      ok(!noExp.allowed, "unreadable expiry forces manual");
    }
  }

  // Manual gate
  const manualGood: ManualIdInput = {
    idType: "passport",
    dateOfBirth: "1990-07-13",
    expirationDate: "2030-01-01",
    reason: "Customer presented a passport (no barcode).",
    photoMatchConfirmed: true,
  };
  ok(evaluateManualId(manualGood, "2026-07-13").allowed, "manual passport ok");
  ok(!evaluateManualId({ ...manualGood, idType: "library_card" }, "2026-07-13").allowed, "non-WAC ID type refused");
  ok(!evaluateManualId({ ...manualGood, reason: "x" }, "2026-07-13").allowed, "short reason refused");
  ok(!evaluateManualId({ ...manualGood, photoMatchConfirmed: false }, "2026-07-13").allowed, "photo match required");
  ok(!evaluateManualId({ ...manualGood, dateOfBirth: "2007-01-01" }, "2026-07-13").allowed, "manual under-21 blocked");
  ok(!evaluateManualId({ ...manualGood, expirationDate: "2026-07-12" }, "2026-07-13").allowed, "manual expired blocked");
  ok(!evaluateManualId({ ...manualGood, expirationDate: "" }, "2026-07-13").allowed, "manual missing expiry blocked");
  ok(evaluateManualId({ ...manualGood, idType: "global_entry" }, "2026-07-13").allowed, "Global Entry accepted (eff. 11/8/2025)");
  ok(evaluateManualId({ ...manualGood, idType: "permanent_resident" }, "2026-07-13").allowed, "Permanent Resident card accepted (eff. 11/8/2025)");

  console.log(`pos/id-scan-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/id-scan-core tests failed`);
}
