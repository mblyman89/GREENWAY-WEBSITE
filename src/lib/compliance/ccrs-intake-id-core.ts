/**
 * CCRS C1 (D-2): the CCRS InventoryExternalIdentifier a NEWLY received lot gets.
 *
 * Before C1 every new lot got OUR minted version of the vendor's id
 * (`mintExternalId`: every non-[A-Za-z0-9] run became "-"), so the vendor's
 * `WA413287.INE6AQ` was filed as `WA413287-INE6AQ`. The examiner (answer 9b):
 * the transfer ExternalIdentifier is the reported inventory id with no suffix,
 * and keeping the vendor's id is what lets returns and recalls be traced back
 * [EXAM2 L0056]. ExternalIdentifier is Text (100), required, and "must be
 * unique" for the licensee [G L0224-L0225]; nothing in the guide restricts
 * dots, so a dotted id is a valid id.
 *
 * Rules (owner-safe; never worse than before C1):
 *   1. Only a TRUSTED source passes the vendor's id through: the WCIA transfer
 *      JSON (`wcia_json`) and a CCRS-format csv (`ccrs_csv`). These carry the
 *      id the vendor filed with CCRS. A PDF read (`pdf_guess`) or an unknown
 *      parser is NOT trusted: OCR can misread a character, so it keeps
 *      today's minted id.
 *   2. The raw id must pass `validatePassThroughExternalId` (non-empty, at most
 *      100 characters, no CR/LF/comma/double quote, the four characters a CSV
 *      cell cannot carry). Anything else keeps the minted id.
 *   3. Collision guard: if ANOTHER lot already carries the raw id (or the
 *      check could not be made), keep the minted id: exactly today's
 *      behaviour, so C1 never creates a collision that did not exist before.
 *   4. This runs ONLY when a lot is created. A lot that already has an id is
 *      never renamed: renaming a lot CCRS holds would create a second lot.
 *
 * PURE: no I/O. Wired in src/lib/inventory/intake-store.ts.
 */
import { mintInventoryExternalId, passThroughExternalId, validatePassThroughExternalId } from "./ccrs-identifiers";
import { vendorIdSourceFor } from "./ccrs-transfer-core";

/** Sources whose lot code is the vendor's CCRS id as filed. */
export const TRUSTED_INTAKE_ID_SOURCES: ReadonlySet<string> = new Set(["wcia_json", "ccrs_csv"]);

export type IntakeIdBasis = "vendor-id" | "minted";

export type IntakeIdDecision = {
  externalId: string | null;
  basis: IntakeIdBasis;
  /** Why the vendor id was not used (empty when it was). Plain words for logs. */
  reason: string;
};

export type IntakeIdInput = {
  lot_code: string | null | undefined;
  pos_product_key: string | null | undefined;
  /** The manifest parser's source_format ("wcia", "ccrs-csv", "pdf-manifest", ...). */
  source_format: string | null | undefined;
  /**
   * The raw ids some OTHER lot already carries. `null` = the check could not
   * be made (read failed): the vendor id is then NOT used (rule 3).
   */
  takenIds: ReadonlySet<string> | null;
};

/** The vendor ids worth checking for collisions (trusted + valid), deduped. */
export function intakeIdCandidates(
  lines: readonly { lot_code: string | null | undefined }[],
  sourceFormat: string | null | undefined,
): string[] {
  if (!TRUSTED_INTAKE_ID_SOURCES.has(vendorIdSourceFor(sourceFormat))) return [];
  const out = new Set<string>();
  for (const l of lines) {
    const raw = passThroughExternalId(l.lot_code);
    if (raw && validatePassThroughExternalId(raw).length === 0) out.add(raw);
  }
  return [...out];
}

export function intakeInventoryExternalId(input: IntakeIdInput): IntakeIdDecision {
  const minted = mintInventoryExternalId({ lot_code: input.lot_code, pos_product_key: input.pos_product_key });
  const source = vendorIdSourceFor(input.source_format);
  if (!TRUSTED_INTAKE_ID_SOURCES.has(source)) {
    return { externalId: minted, basis: "minted", reason: `source ${source} is not trusted for the vendor id` };
  }
  const raw = passThroughExternalId(input.lot_code);
  const errs = validatePassThroughExternalId(raw);
  if (errs.length > 0) {
    return { externalId: minted, basis: "minted", reason: `vendor id ${errs.join(", ")}` };
  }
  if (input.takenIds === null) {
    return { externalId: minted, basis: "minted", reason: "could not check whether another lot already has this id" };
  }
  if (input.takenIds.has(raw)) {
    return { externalId: minted, basis: "minted", reason: "another lot already has this id" };
  }
  return { externalId: raw, basis: "vendor-id", reason: "" };
}

/* ------------------------------------------------------------------ */

export function __runCcrsIntakeIdTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  ✗ ccrs-intake-id: ${name}`);
    }
  };
  const none = new Set<string>();
  const d = (lot: string | null, fmt: string | null, taken: ReadonlySet<string> | null = none, key: string | null = null) =>
    intakeInventoryExternalId({ lot_code: lot, pos_product_key: key, source_format: fmt, takenIds: taken });

  // Rule 1: trusted sources pass the vendor id through byte for byte.
  ok(d("WA413287.INE6AQ", "wcia").externalId === "WA413287.INE6AQ", "wcia keeps the dotted vendor id [EXAM2 L0056]");
  ok(d("WA413287.INE6AQ", "wcia").basis === "vendor-id", "wcia basis = vendor-id");
  ok(d("WA413287.INE6AQ", "ccrs-csv").externalId === "WA413287.INE6AQ", "ccrs csv keeps the dotted vendor id");
  ok(d("  WAR413541.IN132IB0 ", "wcia").externalId === "WAR413541.IN132IB0", "trim only");
  ok(d("000123", "wcia").externalId === "000123", "leading zeros kept");
  ok(d("wa1.abc", "wcia").externalId === "wa1.abc", "case kept");
  // Untrusted sources keep today's minted id.
  ok(d("WA413287.INE6AQ", "pdf-manifest").externalId === "WA413287-INE6AQ", "pdf read is minted (OCR may misread)");
  ok(d("WA413287.INE6AQ", "pdf-manifest").basis === "minted", "pdf basis = minted");
  ok(d("WA413287.INE6AQ", null).externalId === "WA413287-INE6AQ", "unknown source is minted");
  ok(d("WA413287.INE6AQ", "something-new").basis === "minted", "an unlisted parser is minted");
  // Rule 2: invalid raw ids fall back.
  ok(d("A,B", "wcia").externalId === "A-B" && d("A,B", "wcia").basis === "minted", "comma falls back to minted");
  ok(d('A"B', "wcia").basis === "minted", "double quote falls back");
  ok(d("x".repeat(101), "wcia").basis === "minted", "over 100 falls back");
  ok(d("x".repeat(100), "wcia").basis === "vendor-id", "exactly 100 passes");
  ok(d("", "wcia", none, "KEY.9").externalId === "KEY-9", "blank lot code falls to the minted product key");
  ok(d(null, "wcia").externalId === null, "nothing usable = null");
  // Rule 3: collisions and unknown checks keep the minted id.
  ok(d("WA1.X", "wcia", new Set(["WA1.X"])).externalId === "WA1-X", "taken raw id falls back to minted");
  ok(d("WA1.X", "wcia", new Set(["WA1.X"])).reason.includes("another lot"), "the collision says why");
  ok(d("WA1.X", "wcia", null).basis === "minted", "an unreadable check is never a pass");
  ok(d("WA1.X", "wcia", new Set(["WA1-X"])).externalId === "WA1.X", "a different (minted) id is not a collision");
  // Candidates.
  const c = intakeIdCandidates([{ lot_code: "A.1" }, { lot_code: " A.1 " }, { lot_code: "B,2" }, { lot_code: "" }, { lot_code: "C3" }], "wcia");
  ok(c.length === 2 && c.includes("A.1") && c.includes("C3"), "candidates: trusted, valid, deduped");
  ok(intakeIdCandidates([{ lot_code: "A.1" }], "pdf-manifest").length === 0, "no candidates for an untrusted source");
  ok(TRUSTED_INTAKE_ID_SOURCES.size === 2 && !TRUSTED_INTAKE_ID_SOURCES.has("pdf_guess"), "trusted list is exactly wcia_json + ccrs_csv");
  return { passed, failed };
}
