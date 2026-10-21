/**
 * src/lib/compliance/ccrs-transfer-core.ts — Round 6 / Slice R6-2 (PURE).
 *
 * InventoryTransfer.csv rows from received intake lots (Part 09 S-05, Part 04
 * E14). Until R6-2 the batch emitted this file EMPTY with a note that retail
 * intake is covered by Inventory.csv; the LCB says otherwise.
 *
 * LCB lines this module rests on (verbatim, re-checked by
 * tests/compliance/r6-2-inventory-transfer.test.ts against Part 02):
 *   - "InventoryTransfer.CSV is required weekly by any licensed facility that
 *     receives inventory." [G L1162]
 *   - "Only the receiving licensee should submit an inventory transfer report"
 *     [G L0124-L0128]; retailer: "The retailer uploads a product to create a
 *     product, inventory and inventory transfer files." [G L0143-L0144]
 *   - "Duplicate InventoryTransfer for Licensee" [G L1190]
 *   - "Invalid FromInventoryExternalIdentifier" [G L1191]; the From id "is
 *     assigned as the original ID by the producer or processor" [FAQ L0059]
 *   - "ToLicense cannot be the same license number as FromLicense" [G L1205]
 *   - "FromLicenseNumber must be numeric" [G L1189]
 *   - "No negative entries allowed" [G L1238]
 *   - TransferDate "date (MM/DD/YYYY)" [G L1243]
 *   - "Invalid ToInventoryExternalIdentifier ... ensure the inventory has been
 *     reported through the inventory.CSV." [G L1207-L1209]
 *
 * Rules (each one tested in the self-test below and in the vitest file):
 *   1. Only ACCEPTED lots of a real delivery. A lot refused at the dock was
 *      never received. A Cultivera migration lot is skipped: Cultivera filed
 *      its transfer while it was the integrator.
 *   2. Window: received on or before the range end, and on or after the range
 *      start; with catch-up (prod + loaded ledger) any earlier lot never
 *      reported is included too. `notBefore` (the Greenway start date in prod)
 *      is a hard floor: transfers before it belong to the integrator's uploads.
 *   3. One row per lot: From = vendor license, To = our license, From id = the
 *      vendor's id EXACTLY as captured, To id = our lot id, Quantity =
 *      received quantity, TransferDate = received day, ExternalIdentifier =
 *      "TR-" + our lot id, Operation Insert.
 *   4. A vendor id is sent only when machine-read from the vendor's own data
 *      (WCIA JSON, CCRS manifest CSV) or typed by a person. A PDF guess may be
 *      a batch number: E14_TRANSFER_VENDOR_ID_UNKNOWN until confirmed.
 *   5. Ledger: a transfer CCRS holds is never re-Inserted (rule [G L1190]);
 *      uncertain / unknown -> withheld, never guessed; not held -> sent.
 *   6. The To lot must be held by CCRS or reported in this emission's
 *      Inventory.csv [G L1207-L1209]; otherwise the row is withheld.
 */
import { CCRS_COLUMNS } from "./ccrs-batch-core";
import { LEDGER_STATES, type LedgerEntry, type LedgerEnv, type LedgerState } from "./ccrs-ledger-core";
import { isMissingDbFunctionError, type RpcErrorLike } from "@/lib/db/rpc-fallback-core";

export const TRANSFER_SLICE_RPC = "ccrs_transfer_slice";
export const TRANSFER_ID_PREFIX = "TR-";

export const VENDOR_ID_SOURCES = ["wcia_json", "ccrs_csv", "pdf_guess", "owner_entered", "unknown"] as const;
export type VendorIdSource = (typeof VENDOR_ID_SOURCES)[number];
/** Sources whose id is the vendor's own filed id (rule 4). */
export const TRUSTED_VENDOR_ID_SOURCES: readonly VendorIdSource[] = ["wcia_json", "ccrs_csv", "owner_entered"];

export type TransferIssueCode =
  | "E14_TRANSFER_FIELD_MISSING"
  | "E14_TRANSFER_VENDOR_ID_UNKNOWN"
  | "E14_TRANSFER_SAME_LICENSE"
  | "E14_TRANSFER_QUANTITY"
  | "E14_TRANSFER_LEDGER_WITHHELD"
  | "E14_TRANSFER_LOT_NOT_REPORTED";

export const TRANSFER_PINS: Record<TransferIssueCode, string> = {
  E14_TRANSFER_FIELD_MISSING: "[G L1182-L1246]",
  E14_TRANSFER_VENDOR_ID_UNKNOWN: "[G L1191]",
  E14_TRANSFER_SAME_LICENSE: "[G L1205]",
  E14_TRANSFER_QUANTITY: "[G L1238]",
  E14_TRANSFER_LEDGER_WITHHELD: "[G L1190]",
  E14_TRANSFER_LOT_NOT_REPORTED: "[G L1207-L1209]",
};

/** Blocking codes: the row cannot be built correctly until a person fixes the lot. */
export const TRANSFER_BLOCKING: ReadonlySet<TransferIssueCode> = new Set([
  "E14_TRANSFER_FIELD_MISSING",
  "E14_TRANSFER_VENDOR_ID_UNKNOWN",
  "E14_TRANSFER_SAME_LICENSE",
  "E14_TRANSFER_QUANTITY",
]);

export type TransferLot = {
  lotId: string;
  manifestId: string | null;
  label: string;
  /** Our CCRS InventoryExternalIdentifier (ToInventoryExternalIdentifier). */
  ourId: string | null;
  vendorId: string | null;
  vendorIdSource: string | null;
  vendorLicense: string | null;
  receivedQty: number | null;
  /** YYYY-MM-DD (Pacific calendar day) or null when unknown. */
  receivedOn: string | null;
  disposition: string | null;
  /** Came over in the Cultivera migration (cultivera-received-flag-core). */
  isCultivera: boolean;
};

/**
 * What the ledger knows about one transfer id. `state` null + `inFlight` true:
 * an emitted / uploaded file names it but no answer is recorded yet.
 */
export type TransferHeld = { state: LedgerState | null; inFlight: boolean };

export type TransferIssue = { code: TransferIssueCode; lotId: string; manifestId: string | null; label: string; detail: string };

export type TransferPlan = {
  rows: string[][];
  issues: TransferIssue[];
  /** Transfer ids CCRS already holds: not re-sent (rule 5). */
  alreadyHeld: string[];
  /** Lots outside the rules (not accepted, Cultivera, out of window): counted, not errors. */
  skipped: { notAccepted: number; cultivera: number; outOfWindow: number };
};

export type TransferInput = {
  lots: readonly TransferLot[];
  licenseNumber: string;
  createdBy: string;
  fromDay: string;
  toDay: string;
  /** Hard floor (prod: the Greenway start date). Null = none. */
  notBefore: string | null;
  /** Include earlier never-reported lots (prod with a loaded transfer ledger). */
  catchUp: boolean;
  /** Transfer ledger slice; null = legacy (no ledger), window only. */
  held: ReadonlyMap<string, TransferHeld | null> | null;
  /** Our lot ids CCRS holds or this emission's Inventory.csv reports (rule 6). */
  reportable: ReadonlySet<string>;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed", "closed"]);

/** YYYY-MM-DD -> MM/DD/YYYY without any time-zone shift (it is already a calendar day). */
export function transferDate(day: string): string {
  if (!DAY.test(day)) throw new Error(`transferDate: not a YYYY-MM-DD day: ${day}`);
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
}

export function transferExternalId(ourId: string): string {
  return `${TRANSFER_ID_PREFIX}${ourId}`;
}

/**
 * A license as CCRS wants it: digits only ("FromLicenseNumber must be numeric"
 * [G L1189]). The common written forms ("WA417068", "417-068", "417 068") are
 * normalized; anything else is left as typed so the numeric check refuses it.
 */
const digits = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  const n = t.replace(/^wa\s*/i, "").replace(/[\s-]/g, "");
  return /^\d+$/.test(n) ? n : t;
};

export function buildTransferRows(input: TransferInput): TransferPlan {
  const rows: string[][] = [];
  const issues: TransferIssue[] = [];
  const alreadyHeld: string[] = [];
  const skipped = { notAccepted: 0, cultivera: 0, outOfWindow: 0 };
  const ours = digits(input.licenseNumber);
  const lots = [...input.lots].sort((a, b) =>
    (a.receivedOn ?? "") < (b.receivedOn ?? "") ? -1 : (a.receivedOn ?? "") > (b.receivedOn ?? "") ? 1 : a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0,
  );
  const seen = new Set<string>();
  for (const l of lots) {
    const issue = (code: TransferIssueCode, detail: string) => issues.push({ code, lotId: l.lotId, manifestId: l.manifestId, label: l.label, detail });
    if (l.disposition !== "accepted") {
      skipped.notAccepted += 1;
      continue;
    }
    if (l.isCultivera) {
      skipped.cultivera += 1;
      continue;
    }
    if (!l.receivedOn || !DAY.test(l.receivedOn)) {
      // Unknown day: cannot place it in a week, and TransferDate is required.
      issue("E14_TRANSFER_FIELD_MISSING", "received date is unknown (TransferDate is required)");
      continue;
    }
    const floor = input.catchUp ? input.notBefore : input.notBefore && input.notBefore > input.fromDay ? input.notBefore : input.fromDay;
    if (l.receivedOn > input.toDay || (floor && l.receivedOn < floor) || (input.notBefore && l.receivedOn < input.notBefore)) {
      skipped.outOfWindow += 1;
      continue;
    }
    const missing: string[] = [];
    const from = digits(l.vendorLicense);
    if (!from) missing.push("vendor license (FromLicenseNumber)");
    if (!l.ourId) missing.push("our lot id (ToInventoryExternalIdentifier)");
    if (missing.length > 0) {
      issue("E14_TRANSFER_FIELD_MISSING", `missing ${missing.join(" and ")}`);
      continue;
    }
    const ourId = l.ourId as string;
    if (!/^\d+$/.test(from)) {
      issue("E14_TRANSFER_FIELD_MISSING", `vendor license "${from}" is not numeric ("FromLicenseNumber must be numeric")`);
      continue;
    }
    if (from === ours) {
      issue("E14_TRANSFER_SAME_LICENSE", `vendor license ${from} is our own license`);
      continue;
    }
    const vid = (l.vendorId ?? "").trim() === "" ? null : (l.vendorId as string);
    if (!vid || !(TRUSTED_VENDOR_ID_SOURCES as readonly string[]).includes(l.vendorIdSource ?? "")) {
      issue(
        "E14_TRANSFER_VENDOR_ID_UNKNOWN",
        vid
          ? `vendor id "${vid}" was read from a ${l.vendorIdSource ?? "unknown"} source and may be a batch number; confirm it on the manifest page`
          : "the vendor's InventoryExternalIdentifier is not recorded; enter it on the manifest page",
      );
      continue;
    }
    if (vid.length > 100) {
      issue("E14_TRANSFER_FIELD_MISSING", `vendor id is longer than 100 characters`);
      continue;
    }
    const qty = l.receivedQty;
    if (qty === null || !Number.isFinite(qty) || qty <= 0) {
      issue("E14_TRANSFER_QUANTITY", `received quantity ${String(qty)} is not a positive number`);
      continue;
    }
    const ext = transferExternalId(ourId);
    if (ext.length > 100) {
      issue("E14_TRANSFER_FIELD_MISSING", `ExternalIdentifier ${ext} is longer than 100 characters`);
      continue;
    }
    if (seen.has(ext)) {
      issue("E14_TRANSFER_FIELD_MISSING", `two received lots share our id ${ourId}; one transfer per lot`);
      continue;
    }
    seen.add(ext);
    if (input.held) {
      const h = input.held.get(ext) ?? null;
      if (h && h.state && PRESENT.has(h.state)) {
        alreadyHeld.push(ext);
        continue;
      }
      if (h && (h.state === "uncertain" || h.state === "unknown")) {
        issue("E14_TRANSFER_LEDGER_WITHHELD", `the ledger cannot say whether CCRS holds ${ext} (state ${h.state}); record that file's outcome first`);
        continue;
      }
      if (h && h.inFlight) {
        // A file already carrying this transfer is unanswered: a second Insert
        // would be "Duplicate InventoryTransfer for Licensee" [G L1190].
        issue("E14_TRANSFER_LEDGER_WITHHELD", `${ext} is in a file that is uploaded or emitted but not answered yet; record that file's outcome first`);
        continue;
      }
    }
    if (!input.reportable.has(ourId)) {
      issue("E14_TRANSFER_LOT_NOT_REPORTED", `lot ${ourId} is neither held by CCRS nor in this Inventory.csv`);
      continue;
    }
    const day = transferDate(l.receivedOn);
    rows.push([from, ours, vid, ourId, String(qty), day, ext, input.createdBy, day, "", "", "Insert"]);
  }
  return { rows, issues, alreadyHeld, skipped };
}

/* ------------------------------------------------------------------ *
 * The 0285 ccrs_transfer_slice answer
 * ------------------------------------------------------------------ */

export type TransferSliceOutcome = { kind: "absent" } | { kind: "loaded"; held: Map<string, TransferHeld | null> };

export class CcrsTransferSliceError extends Error {}
const bad = (m: string): never => {
  throw new CcrsTransferSliceError(`ccrs_transfer_slice: ${m}`);
};

export function decodeTransferSlice(env: LedgerEnv, data: unknown, error: RpcErrorLike | null | undefined): TransferSliceOutcome {
  if (error) {
    if (isMissingDbFunctionError(error)) return { kind: "absent" };
    bad(`${error.code ?? "?"} ${error.message ?? ""}`.trim());
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("answer is not an object");
  const d = data as Record<string, unknown>;
  if (d.env !== env) bad(`answer is for env ${String(d.env)}, asked for ${env}`);
  if (!Array.isArray(d.entries)) bad("`entries` is not an array");
  const held = new Map<string, TransferHeld | null>();
  (d.entries as unknown[]).forEach((x, i) => {
    if (!Array.isArray(x) || x.length !== 3) bad(`entry ${i} is not [id,state,in_flight]`);
    const [id, state, inFlight] = x as unknown[];
    if (typeof id !== "string" || id === "") bad(`entry ${i}: id`);
    if (state !== null && (typeof state !== "string" || !(LEDGER_STATES as readonly string[]).includes(state))) bad(`entry ${i}: state ${String(state)}`);
    if (typeof inFlight !== "boolean") bad(`entry ${i}: in_flight is not a boolean`);
    if (held.has(id as string)) bad(`entry ${i}: ${String(id)} appears twice`);
    held.set(id as string, state === null && !inFlight ? null : { state: state as LedgerState | null, inFlight: inFlight as boolean });
  });
  return { kind: "loaded", held };
}

export function transferLedgerEntries(held: ReadonlyMap<string, TransferHeld | null>): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const [externalId, h] of held) if (h && h.state) out.push({ fileType: "InventoryTransfer", externalId, filedName: null, state: h.state, productExternalId: null });
  return out;
}

/** The vendor-id provenance stamp for a newly received lot, from the manifest's parser. */
export function vendorIdSourceFor(sourceFormat: string | null | undefined): VendorIdSource {
  switch (sourceFormat) {
    case "wcia":
      return "wcia_json";
    case "ccrs-csv":
      return "ccrs_csv";
    case "pdf-manifest":
      return "pdf_guess";
    default:
      return "unknown";
  }
}

/** Owner-typed vendor id: trimmed, 1-100 chars, no comma / line break (CCRS splits on every comma). */
export function normalizeOwnerVendorId(raw: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "") return { ok: false, reason: "Enter the vendor's inventory id exactly as it appears on their manifest." };
  if (v.length > 100) return { ok: false, reason: "The id is longer than 100 characters." };
  if (/[,\r\n"]/.test(v)) return { ok: false, reason: "The id cannot contain a comma, a quote or a line break." };
  return { ok: true, value: v };
}

/** Owner-facing summary line for the hub. */
export function transferSummaryText(p: TransferPlan): string {
  const blocking = p.issues.filter((i) => TRANSFER_BLOCKING.has(i.code)).length;
  const parts = [`${p.rows.length} transfer row(s)`];
  if (p.alreadyHeld.length) parts.push(`${p.alreadyHeld.length} already reported`);
  if (blocking) parts.push(`${blocking} lot(s) need fixing`);
  if (p.skipped.cultivera) parts.push(`${p.skipped.cultivera} Cultivera lot(s) skipped (Cultivera filed them)`);
  return parts.join(", ") + ".";
}

/* ------------------------------------------------------------------ *
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCcrsTransferTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`ccrs-transfer-core: ${m}`);
    passed += 1;
  };
  const lot = (o: Partial<TransferLot> = {}): TransferLot => ({
    lotId: "L1",
    manifestId: "M1",
    label: "Lot 1",
    ourId: "WA417068-ABC",
    vendorId: "WA417068-ABC",
    vendorIdSource: "wcia_json",
    vendorLicense: "417068",
    receivedQty: 24,
    receivedOn: "2026-11-03",
    disposition: "accepted",
    isCultivera: false,
    ...o,
  });
  const base = (o: Partial<TransferInput> = {}): TransferInput => ({
    lots: [lot()],
    licenseNumber: "413541",
    createdBy: "Greenway",
    fromDay: "2026-11-01",
    toDay: "2026-11-07",
    notBefore: "2026-11-01",
    catchUp: false,
    held: null,
    reportable: new Set(["WA417068-ABC"]),
    ...o,
  });
  ok(CCRS_COLUMNS.InventoryTransfer.length === 12, "12 columns");
  const p = buildTransferRows(base());
  ok(p.rows.length === 1, "one row");
  ok(
    p.rows[0].join(",") === "417068,413541,WA417068-ABC,WA417068-ABC,24,11/03/2026,TR-WA417068-ABC,Greenway,11/03/2026,,,Insert",
    `row bytes ${p.rows[0].join(",")}`,
  );
  ok(buildTransferRows(base({ lots: [lot({ disposition: "rejected_at_dock" })] })).skipped.notAccepted === 1, "refused lot skipped");
  ok(buildTransferRows(base({ lots: [lot({ isCultivera: true })] })).skipped.cultivera === 1, "Cultivera lot skipped");
  ok(buildTransferRows(base({ lots: [lot({ vendorLicense: "413541" })] })).issues[0]?.code === "E14_TRANSFER_SAME_LICENSE", "same license");
  ok(buildTransferRows(base({ lots: [lot({ vendorLicense: null })] })).issues[0]?.code === "E14_TRANSFER_FIELD_MISSING", "no license");
  ok(buildTransferRows(base({ lots: [lot({ vendorLicense: "WA 417-068" })] })).rows[0]?.[0] === "417068", "written license forms normalized");
  ok(buildTransferRows(base({ lots: [lot({ vendorLicense: "41X068" })] })).issues[0]?.code === "E14_TRANSFER_FIELD_MISSING", "non-numeric license refused");
  ok(buildTransferRows(base({ lots: [lot({ vendorIdSource: "pdf_guess" })] })).issues[0]?.code === "E14_TRANSFER_VENDOR_ID_UNKNOWN", "pdf guess not sent");
  ok(buildTransferRows(base({ lots: [lot({ vendorIdSource: "owner_entered" })] })).rows.length === 1, "owner-entered sent");
  ok(buildTransferRows(base({ lots: [lot({ receivedQty: 0 })] })).issues[0]?.code === "E14_TRANSFER_QUANTITY", "zero qty");
  ok(buildTransferRows(base({ lots: [lot({ receivedOn: "2026-10-30" })] })).skipped.outOfWindow === 1, "before window");
  ok(buildTransferRows(base({ lots: [lot({ receivedOn: "2026-10-30" })], catchUp: true, notBefore: null })).rows.length === 1, "catch-up");
  ok(buildTransferRows(base({ lots: [lot({ receivedOn: "2026-10-30" })], catchUp: true })).skipped.outOfWindow === 1, "floor holds under catch-up");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: "filed", inFlight: false }]]) })).alreadyHeld.length === 1, "held not re-sent");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: "uncertain", inFlight: false }]]) })).issues[0]?.code === "E14_TRANSFER_LEDGER_WITHHELD", "uncertain withheld");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", null]]) })).rows.length === 1, "not held -> sent");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: null, inFlight: true }]]) })).issues[0]?.code === "E14_TRANSFER_LEDGER_WITHHELD", "in flight withheld");
  const dIn = decodeTransferSlice("prod", { env: "prod", entries: [["TR-2", null, true]] }, null);
  ok(dIn.kind === "loaded" && dIn.held.get("TR-2")?.inFlight === true && transferLedgerEntries(dIn.held).length === 0, "in-flight decoded, not a ledger entry");
  ok(buildTransferRows(base({ reportable: new Set() })).issues[0]?.code === "E14_TRANSFER_LOT_NOT_REPORTED", "To lot must be reported");
  ok(transferDate("2026-11-03") === "11/03/2026", "date has no tz shift");
  ok(vendorIdSourceFor("wcia") === "wcia_json" && vendorIdSourceFor("pdf-manifest") === "pdf_guess", "source stamp");
  ok(!normalizeOwnerVendorId("a,b").ok && normalizeOwnerVendorId(" X1 ").ok, "owner id normalize");
  const dec = decodeTransferSlice("prod", { env: "prod", entries: [["TR-1", "filed", false]] }, null);
  ok(dec.kind === "loaded" && dec.held.get("TR-1")?.state === "filed", "decode");
  ok(decodeTransferSlice("prod", null, { code: "42883", message: "" }).kind === "absent", "missing fn -> absent");
  let threw = false;
  try {
    decodeTransferSlice("prod", { env: "preprod", entries: [] }, null);
  } catch {
    threw = true;
  }
  ok(threw, "env mismatch throws");
  return { passed, failed: 0 };
}
