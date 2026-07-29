/**
 * src/lib/inventory/vendor-goldminer-core.ts  (SLICE 102)
 *
 * PURE. The intake "gold miner": read the vendor's OWN documents that ride an
 * intake email (manifest PDF, invoice PDF, transport manifest / transfer log,
 * the email body, the sender address) and lift the vendor-profile facts they
 * already print — email, phone, WA license number, shipping address — so the
 * vendors page fills itself from the paperwork instead of hand-typing.
 *
 * NEVER-GUESS rules (owner: "be super smart about its fetching so it gives me
 * accurate info"):
 *   • Section-gated: every document also prints GREENWAY's OWN address /
 *     phone / license in its destination block, and the carrier's details in a
 *     transporter block. Each text is CUT at the first destination/transporter
 *     marker and only the ORIGIN (vendor) zone before it is mined.
 *   • Labelled facts only: Phone:, E-mail:, License #/‌: — free-floating
 *     numbers are never treated as a phone or a license.
 *   • Hard self-guards: our license (413541), our phone (3604436988) and any
 *     @greenwaymarijuana.com address are rejected even if the section cut
 *     somehow missed.
 *   • Platform/noreply senders (Cultivera, GrowFlow, OpenTHC, LeafLink,
 *     no-reply@…) are never proposed as the vendor's contact email.
 *   • Consumers gap-fill ONLY EMPTY vendor columns (vendorProfileGapFill) —
 *     an existing value is never overwritten, same rule as vendorLicensePatch.
 *
 * Grounded on the REAL checked-in fixtures (tests/compliance/fixtures/):
 * LCB manifest, Cultivera invoice + manifests, GrowFlow transport manifest,
 * GrowFlow transfer log, OpenTHC invoice header.
 */

/** Everything the miner can lift from one email's documents. */
export type MinedVendorFacts = {
  email: string | null;
  phone: string | null; // digits formatted XXX-XXX-XXXX
  licenseNumber: string | null; // 6-digit WA license, never our own
  address: {
    line1: string;
    city: string;
    state: string; // always "WA" (non-WA origins are skipped — conservative)
    zip: string; // 5 digit or ZIP+4 with dash
  } | null;
  /** field -> human provenance ("transport manifest", "invoice", ...) */
  sources: Partial<Record<"email" | "phone" | "license" | "address", string>>;
};

/** One text the miner reads, tagged with what kind of document it came from. */
export type MinerSource = {
  kind: "manifest" | "invoice" | "transport" | "email-body" | "other";
  text: string;
};

// Greenway's own identifiers — never mined as vendor facts.
const OUR_LICENSE = "413541";
const OUR_PHONE_DIGITS = "3604436988";
const OUR_DOMAIN = "greenwaymarijuana.com";

// Marketplace / platform / robot senders — never the vendor's contact email.
const PLATFORM_DOMAINS = [
  "cultivera.com",
  "growflow.com",
  "getgrowflow.com",
  "openthc.com",
  "openthc.org",
  "leaflink.com",
  "resend.dev",
  OUR_DOMAIN,
];
const ROBOT_LOCALPART = /^(no-?reply|do-?not-?reply|notifications?|mailer(-daemon)?|alerts?|noreply\+.*)$/i;

/**
 * Cut a document's flattened text down to its ORIGIN / vendor zone: everything
 * BEFORE the first destination / ship-to / transporter marker. Every supported
 * layout prints the sender first, so the prefix is the vendor's block.
 */
export function vendorZone(text: string): string {
  const markers = [
    /Ship\s*To\s*:/i, // OpenTHC invoice
    /Manifest\s*Details/i, // Cultivera invoice ("Manifest DetailsShip To")
    /Destination\s+Licensee/i, // LCB manifest + transfer log
    /Destination\s+License/i, // GrowFlow transport manifest
    /Transportation\s+License\s+Information/i, // GrowFlow transport manifest carrier block
    /Transporter\s+Signature/i, // LCB manifest (safety net)
  ];
  let cut = text.length;
  for (const m of markers) {
    const hit = text.search(m);
    if (hit >= 0 && hit < cut) cut = hit;
  }
  return text.slice(0, cut);
}

/** Normalize a possibly pdf-glued email ("stephen@greenwaymarijuan a.com"). */
function cleanEmail(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

/** True when an email is safe to propose as the VENDOR's contact address. */
export function isUsableVendorEmail(raw: string | null | undefined): boolean {
  const email = cleanEmail(String(raw ?? ""));
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  if (PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  if (ROBOT_LOCALPART.test(local)) return false;
  return true;
}

/** Pull the bare address out of a From header ("Name <a@b.com>" or "a@b.com"). */
export function senderAddress(from: string | null | undefined): string | null {
  const s = String(from ?? "").trim();
  if (!s) return null;
  const angled = s.match(/<([^<>]+@[^<>]+)>/);
  const raw = angled ? angled[1] : s;
  const m = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? cleanEmail(m[0]) : null;
}

/** Format 10 digits as XXX-XXX-XXXX; strips a leading US "1". */
function formatPhone(digits: string): string | null {
  let d = digits.replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (d === OUR_PHONE_DIGITS) return null;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Labelled phone in the vendor zone ("Licensee Phone:", "Phone: +1 …").
 * Flattened PDFs glue unrelated digits right after the number (the real LCB
 * layout prints "Licensee Phone: 3605720840 2021 WHITE Nissan…"), so the raw
 * capture is walked TOKEN by token and accepted only when a whole number of
 * tokens lands exactly on 10 digits (11 with a leading US "1") — a partial
 * token is never split, so a 12-digit glue can't be trimmed into a fake phone.
 */
function minePhone(zone: string): string | null {
  const re = /(?:Licensee\s+)?Phone\s*:?\s*(\+?[\d\s.()+-]{7,24})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(zone)) !== null) {
    const tokens = m[1].trim().split(/\s+/);
    let digits = "";
    for (const t of tokens) {
      digits += t.replace(/\D+/g, "");
      if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) {
        const formatted = formatPhone(digits);
        if (formatted) return formatted;
        break;
      }
      if (digits.length > 11) break; // glue — not a phone
    }
  }
  return null;
}

/** Labelled email in the vendor zone (tolerates pdf-glued spaces). */
function mineEmail(zone: string): string | null {
  const re =
    /E-?mail(?:\s+Address)?\s*:?\s*([A-Za-z0-9._%+-]+(?:\s?[A-Za-z0-9._%+-]+)*@\s?[A-Za-z0-9.-]+(?:\s[A-Za-z0-9.-]+)?\.[A-Za-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(zone)) !== null) {
    const email = cleanEmail(m[1]);
    if (isUsableVendorEmail(email)) return email;
  }
  // Bare labelled "Email:" missing? Try any address printed in the zone —
  // still zone-gated, still guard-checked (OpenTHC prints "Email: …" which the
  // labelled pass catches; this fallback covers e.g. a signature line).
  const bare = zone.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (bare && isUsableVendorEmail(bare[0])) return cleanEmail(bare[0]);
  return null;
}

/**
 * Labelled WA license in the vendor zone: "License: 417068", "License # 415820",
 * or the OpenTHC header suffix "HIGH END FARMS #415771". Six digits, never ours.
 */
function mineLicense(zone: string): string | null {
  const labelled = /Licen[cs]e\s*#?\s*:?\s*(\d{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = labelled.exec(zone)) !== null) {
    if (m[1] !== OUR_LICENSE) return m[1];
  }
  const headerSuffix = zone.match(/#\s?(\d{6})\b/);
  if (headerSuffix && headerSuffix[1] !== OUR_LICENSE) return headerSuffix[1];
  return null;
}

/**
 * Heal a pdf-glued zip ("9933 7" → "99337"). STRICT length: exactly 5 or
 * exactly 9 digits. A 10-digit run after "WA" is a glued PHONE number (the
 * real Cultivera manifest prints "OAKVILLE, WA 3604808813" with no zip at
 * all) — never trimmed into a fake ZIP+4. Returning null skips the match.
 */
function cleanZip(raw: string): string | null {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (digits.length === 5) return digits;
  return null;
}

/** The ", WA <zip>"-anchored street matcher shared by both address passes. */
const ADDRESS_RE =
  /([0-9]{2,6}\s[^,]{3,70}(?:,\s*[^,]{0,40}?)*?)\s*,{1,2}\s*WA\b[,\s]*(\d[\d\s-]{3,10})/g;

function matchAddress(text: string): MinedVendorFacts["address"] {
  ADDRESS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADDRESS_RE.exec(text)) !== null) {
    const zip = cleanZip(m[2]);
    if (!zip) continue;
    const before = m[1].replace(/[\s,]+$/, "").trim();
    let line1: string;
    let city: string;
    const lastComma = before.lastIndexOf(",");
    if (lastComma > 0) {
      city = before.slice(lastComma + 1).trim();
      line1 = before.slice(0, lastComma).replace(/[\s,]+$/, "").trim();
    } else {
      // No comma before ", WA": peel the trailing ALL-CAPS words as the city
      // (LCB glue "…Bldg 16A ARLINGTON, WA").
      const capRun = before.match(/((?:[A-Z]{3,}\s)*[A-Z]{3,})$/);
      if (!capRun) continue;
      city = capRun[1].trim();
      line1 = before.slice(0, before.length - capRun[1].length).trim();
    }
    // A "city" that still contains digits is glue noise, not a city.
    if (!city || /\d/.test(city) || !line1) continue;
    return { line1, city, state: "WA", zip };
  }
  return null;
}

/**
 * WA street address in the vendor zone. PASS 1 looks only in a short window
 * right after each "Address:" label — that keeps UBI / barcode glue printed
 * BEFORE the label (real transfer log: "License UBI: 603353015 GF41582…
 * Licensee Address: 30320 Old 99 N…") out of the street line. PASS 2 falls
 * back to the whole zone for layouts that print the address without a label.
 */
function mineAddress(zone: string): MinedVendorFacts["address"] {
  const labelRe = /Address\s*:?\s*/gi;
  let lm: RegExpExecArray | null;
  while ((lm = labelRe.exec(zone)) !== null) {
    const window = zone.slice(lm.index + lm[0].length, lm.index + lm[0].length + 140);
    const hit = matchAddress(window);
    if (hit) return hit;
  }
  return matchAddress(zone);
}

/**
 * Map an attachment's filename ROLE (inbound-normalize-core) + its extracted
 * text to a miner kind. Transport documents are recognized by their own
 * headers (real GrowFlow "Transportation Type: Transporter …"; real transfer
 * log "Transfer Log (This document is NOT a manifest)") so they rank first.
 */
export function classifyMinerKind(
  role: "manifest" | "invoice" | "coa" | "unknown",
  text: string,
): MinerSource["kind"] {
  const head = text.slice(0, 200);
  if (/Transportation\s+Type\s*:/i.test(head) || /Transfer\s+Log\s*\(/i.test(head)) {
    return "transport";
  }
  if (role === "manifest") return "manifest";
  if (role === "invoice") return "invoice";
  return "other";
}

/** Human label for a source kind (provenance shown on the audit trail). */
function sourceLabel(kind: MinerSource["kind"]): string {
  switch (kind) {
    case "manifest":
      return "manifest PDF";
    case "invoice":
      return "invoice PDF";
    case "transport":
      return "transport manifest";
    case "email-body":
      return "email body";
    default:
      return "attached document";
  }
}

/** Reading order: shipping documents outrank the invoice outrank the body. */
const KIND_RANK: Record<MinerSource["kind"], number> = {
  transport: 0,
  manifest: 1,
  invoice: 2,
  other: 3,
  "email-body": 4,
};

/**
 * Mine every source (in trust order) and keep the FIRST hit per fact. The
 * sender address is the LAST-resort email — only when no document printed one,
 * and only when it passes the platform/robot/our-domain guards.
 */
export function mineVendorFacts(
  sources: readonly MinerSource[],
  emailFrom?: string | null,
): MinedVendorFacts {
  const out: MinedVendorFacts = {
    email: null,
    phone: null,
    licenseNumber: null,
    address: null,
    sources: {},
  };
  const ordered = [...sources]
    .filter((s) => typeof s.text === "string" && s.text.trim().length > 0)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  for (const src of ordered) {
    const zone = vendorZone(src.text);
    if (!out.phone) {
      const phone = minePhone(zone);
      if (phone) {
        out.phone = phone;
        out.sources.phone = sourceLabel(src.kind);
      }
    }
    if (!out.email) {
      const email = mineEmail(zone);
      if (email) {
        out.email = email;
        out.sources.email = sourceLabel(src.kind);
      }
    }
    if (!out.licenseNumber) {
      const license = mineLicense(zone);
      if (license) {
        out.licenseNumber = license;
        out.sources.license = sourceLabel(src.kind);
      }
    }
    if (!out.address) {
      const address = mineAddress(zone);
      if (address) {
        out.address = address;
        out.sources.address = sourceLabel(src.kind);
      }
    }
  }
  if (!out.email) {
    const sender = senderAddress(emailFrom);
    if (sender && isUsableVendorEmail(sender)) {
      out.email = sender;
      out.sources.email = "email sender";
    }
  }
  return out;
}

/** The vendor columns the gap-fill may touch (all exist since 0003/0064/0081). */
export type VendorProfileSnapshot = {
  email: string | null;
  phone: string | null;
  license_number: string | null;
  shipping_address1: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
};

export type VendorProfilePatch = Partial<VendorProfileSnapshot>;

const blank = (v: string | null | undefined): boolean => String(v ?? "").trim().length === 0;

/**
 * Fill-only-empty patch (same contract as vendorLicensePatch): a populated
 * vendor column is NEVER overwritten. The address is all-or-nothing and only
 * lands when the whole shipping block is empty — a half-filled address is a
 * human's work in progress and gets left alone. Returns the patch plus a
 * plain-English provenance list for the audit note; empty patch = nothing to do.
 */
export function vendorProfileGapFill(
  existing: VendorProfileSnapshot,
  mined: MinedVendorFacts,
): { patch: VendorProfilePatch; filled: string[] } {
  const patch: VendorProfilePatch = {};
  const filled: string[] = [];
  if (mined.email && blank(existing.email)) {
    patch.email = mined.email;
    filled.push(`email ${mined.email} (from the ${mined.sources.email ?? "documents"})`);
  }
  if (mined.phone && blank(existing.phone)) {
    patch.phone = mined.phone;
    filled.push(`phone ${mined.phone} (from the ${mined.sources.phone ?? "documents"})`);
  }
  if (mined.licenseNumber && blank(existing.license_number)) {
    patch.license_number = mined.licenseNumber;
    filled.push(
      `license # ${mined.licenseNumber} (from the ${mined.sources.license ?? "documents"})`,
    );
  }
  const addressEmpty =
    blank(existing.shipping_address1) &&
    blank(existing.shipping_city) &&
    blank(existing.shipping_zip);
  if (mined.address && addressEmpty) {
    patch.shipping_address1 = mined.address.line1;
    patch.shipping_city = mined.address.city;
    patch.shipping_state = mined.address.state;
    patch.shipping_zip = mined.address.zip;
    filled.push(
      `address ${mined.address.line1}, ${mined.address.city}, WA ${mined.address.zip} (from the ${mined.sources.address ?? "documents"})`,
    );
  }
  return { patch, filled };
}

/**
 * Safety interlock: when the vendor row ALREADY has a license number and the
 * documents name a DIFFERENT license, the whole enrichment is refused — the
 * paperwork may belong to another licensee and nothing should be guessed onto
 * this profile. Same-license (or either side unknown) passes.
 */
export function licenseConflict(
  existingLicense: string | null | undefined,
  minedLicense: string | null | undefined,
): boolean {
  const a = String(existingLicense ?? "").replace(/\D+/g, "");
  const b = String(minedLicense ?? "").replace(/\D+/g, "");
  if (!a || !b) return false;
  return a !== b;
}

/** Audit-trail note for the manifest timeline. PURE. */
export function summarizeGoldMine(filled: readonly string[]): string {
  return `Vendor gold-miner: filled ${filled.join("; ")}. Existing values were never overwritten.`;
}

// ─── self-tests (wired into scripts/compliance + vitest) ───────────────────
export function __runVendorGoldminerTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[vendor-goldminer] FAILED: ${label}`);
    }
  };

  // Real GrowFlow transport-manifest header shape (HAYAA GREEN fixture).
  const growflowTransport =
    "Transportation Type: Transporter Licensee Origin License Information Date: 06/24/2026 License #: 426127 Origin License Name: HAYAA GREEN LLC Licensee Phone: 509-581-4319 Licensee Address: 237004 E LEGACY PR SE,,KENNEWICK,WA,9933 7 Licensee E-mail Address: info@hayaalegacy.com Transportation License Information License Name: TERPENE TRANSIT License #: 426061 Licensee E-mail: TERPENETRANSIT@GMAI L.COM Destination License Information Destination License Name: GREENWAY MARIJUANA Licensee #: 413541 Licensee Phone: 3604436988 Licensee Address: 4851 GEIGER RD SE,,PORT ORCHARD,WA,98366 Licensee E-mail Address: stephen@greenwaymarijuan a.com";
  const gf = mineVendorFacts([{ kind: "transport", text: growflowTransport }]);
  ok(gf.licenseNumber === "426127", "growflow: origin license 426127");
  ok(gf.phone === "509-581-4319", "growflow: origin phone");
  ok(gf.email === "info@hayaalegacy.com", "growflow: origin email");
  ok(gf.address?.city === "KENNEWICK" && gf.address?.zip === "99337", "growflow: glued zip healed");
  ok(gf.address?.line1 === "237004 E LEGACY PR SE", "growflow: street line");

  // The carrier's license (426061) and OUR details must never leak through.
  ok(gf.licenseNumber !== "426061", "growflow: transporter license excluded");
  ok(gf.phone !== "360-443-6988", "growflow: our phone excluded");
  ok((gf.email ?? "").includes("greenwaymarijuana") === false, "growflow: our email excluded");

  // Real OpenTHC invoice header (High End Farms fixture).
  const openthc =
    "Invoice #01KQ 7GS6 EXA3 DV5M Sold By: HIGH END FARMS #415771 Address: 2515 HARTFORD DR STE B, LAKE STEVENS, WA 982580000 Phone: +1 425-789-1672 Email: highendfarms.manifests@gmail.com Ship To: GREENWAY MARIJUANA #413541 Address: 4851 GEIGER RD SE, PORT ORCHARD, WA 983669350 Phone: +1 360-443-6988";
  const ot = mineVendorFacts([{ kind: "invoice", text: openthc }]);
  ok(ot.licenseNumber === "415771", "openthc: seller license from #suffix");
  ok(ot.phone === "425-789-1672", "openthc: +1 phone normalized");
  ok(ot.email === "highendfarms.manifests@gmail.com", "openthc: labelled email");
  ok(ot.address?.city === "LAKE STEVENS" && ot.address?.zip === "98258-0000", "openthc: zip+4");

  // Guards: sender fallback obeys the platform / robot / our-domain rules.
  ok(senderAddress("Michelle <mf@sprwa.com>") === "mf@sprwa.com", "sender: angled form parsed");
  ok(isUsableVendorEmail("orders@sprwa.com"), "sender: real vendor address usable");
  ok(!isUsableVendorEmail("noreply@sprwa.com"), "sender: robot localpart rejected");
  ok(!isUsableVendorEmail("mailer@app.cultivera.com"), "sender: platform domain rejected");
  ok(!isUsableVendorEmail("stephen@greenwaymarijuana.com"), "sender: our own domain rejected");
  const viaSender = mineVendorFacts([], "SPR <orders@sprwa.com>");
  ok(viaSender.email === "orders@sprwa.com" && viaSender.sources.email === "email sender", "sender: last-resort email");

  // Gap-fill: only EMPTY columns; address is all-or-nothing.
  const gap = vendorProfileGapFill(
    {
      email: "kept@vendor.com",
      phone: null,
      license_number: "",
      shipping_address1: "1 Existing Rd",
      shipping_city: null,
      shipping_state: null,
      shipping_zip: null,
    },
    gf,
  );
  ok(gap.patch.email === undefined, "gapfill: populated email untouched");
  ok(gap.patch.phone === "509-581-4319", "gapfill: empty phone filled");
  ok(gap.patch.license_number === "426127", "gapfill: empty license filled");
  ok(gap.patch.shipping_address1 === undefined, "gapfill: half-filled address left alone");
  ok(gap.filled.some((f) => f.includes("transport manifest")), "gapfill: provenance recorded");

  // License conflict interlock.
  ok(licenseConflict("417068", "426127"), "conflict: different licenses refuse");
  ok(!licenseConflict("417068", "417068"), "conflict: same license passes");
  ok(!licenseConflict(null, "426127"), "conflict: unknown existing passes");
  ok(!licenseConflict("417068", null), "conflict: nothing mined passes");

  // Audit note.
  ok(
    summarizeGoldMine(["phone 509-581-4319 (from the transport manifest)"]).includes(
      "never overwritten",
    ),
    "summary: states the never-overwrite rule",
  );

  return { passed, failed };
}
