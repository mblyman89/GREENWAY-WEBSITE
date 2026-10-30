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
 *      our lot id ITSELF, Operation Insert. C1 (examiner, 2026-10-29): "The
 *      Inventory transfer file has to be the exact same as the inventory
 *      reported ID, you can not have a suffix on this file." [EXAM2 L0056].
 *      Until C1 the id was "TR-" + our lot id; a transfer CCRS already holds
 *      under that legacy id is still recognised (never Inserted again).
 *   4. A vendor id is sent only when machine-read from the vendor's own data
 *      (WCIA JSON, CCRS manifest CSV) or typed by a person. A PDF guess may be
 *      a batch number: E14_TRANSFER_VENDOR_ID_UNKNOWN until confirmed.
 *   5. Ledger: a transfer CCRS holds is never re-Inserted (rule [G L1190]);
 *      uncertain / unknown -> withheld, never guessed; not held -> sent.
 *   6. The To lot must be held by CCRS or reported in this emission's
 *      Inventory.csv [G L1207-L1209]; otherwise the row is withheld.
 *   7. C1 correction path: "Yes, the update path is the correct way to make
 *      corrections." [EXAM2 L0058]. A transfer CCRS holds whose facts changed
 *      since CCRS last ACCEPTED it (0325 ccrs_transfer_last_told) becomes an
 *      Update with the SAME ExternalIdentifier [G L0247], keeping the original
 *      CreatedBy/CreatedDate and filling UpdatedBy/UpdatedDate [G L0234-L0242],
 *      but only once the owner approved exactly these new values (like a sale
 *      correction). Unapproved: E63_TRANSFER_CORRECTION_PENDING (held back,
 *      owed). Never a second Insert. A legacy "TR-" transfer is never
 *      corrected automatically: its id breaks the no-suffix rule.
 */
import { CCRS_COLUMNS } from "./ccrs-batch-core";
import { LEDGER_STATES, type LedgerEntry, type LedgerEnv, type LedgerState } from "./ccrs-ledger-core";
import { isMissingDbFunctionError, type RpcErrorLike } from "@/lib/db/rpc-fallback-core";

export const TRANSFER_SLICE_RPC = "ccrs_transfer_slice";
/**
 * C1: the prefix R6-2 used before the examiner's answer [EXAM2 L0056]. Only
 * READ now: a transfer CCRS holds under "TR-" + lot id is already reported and
 * must never be Inserted again under the plain id. Never written.
 */
export const LEGACY_TRANSFER_ID_PREFIX = "TR-";
export const TRANSFER_TOLD_RPC = "ccrs_transfer_last_told";

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
  | "E14_TRANSFER_LOT_NOT_REPORTED"
  | "E63_TRANSFER_CORRECTION_PENDING";

export const TRANSFER_PINS: Record<TransferIssueCode, string> = {
  E14_TRANSFER_FIELD_MISSING: "[G L1182-L1246]",
  E14_TRANSFER_VENDOR_ID_UNKNOWN: "[G L1191]",
  E14_TRANSFER_SAME_LICENSE: "[G L1205]",
  E14_TRANSFER_QUANTITY: "[G L1238]",
  E14_TRANSFER_LEDGER_WITHHELD: "[G L1190]",
  E14_TRANSFER_LOT_NOT_REPORTED: "[G L1207-L1209]",
  // C1: the LCB FAQ Q/A "how will they correct this? ... They would perform an
  // \"Update\" operation" (the issue-code contract takes G/FAQ pins only); the
  // examiner confirmed it for transfers [EXAM2 L0058].
  E63_TRANSFER_CORRECTION_PENDING: "[FAQ L0058-L0059]",
};

/** Blocking codes: the row cannot be built correctly until a person fixes the lot. */
export const TRANSFER_BLOCKING: ReadonlySet<TransferIssueCode> = new Set([
  "E14_TRANSFER_FIELD_MISSING",
  "E14_TRANSFER_VENDOR_ID_UNKNOWN",
  "E14_TRANSFER_SAME_LICENSE",
  "E14_TRANSFER_QUANTITY",
  // C1: needs the owner's approval of the new values (rule 7).
  "E63_TRANSFER_CORRECTION_PENDING",
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

/** What CCRS last ACCEPTED for one transfer id (0325). `told` null = unknown. */
export type TransferTold = { state: LedgerState | null; told: Readonly<Record<string, string>> | null; inFlight: boolean };
export type TransferToldOutcome = { kind: "absent" } | { kind: "loaded"; byId: Map<string, TransferTold> };

/** A correction the owner approved: exactly these new values for this id. */
export type TransferCorrectionApproval = { id: string; fingerprint: string; at: string; by: string | null };

/** A held transfer whose facts differ from what CCRS last accepted (rule 7). */
export type TransferCorrection = {
  id: string;
  lotId: string;
  label: string;
  fingerprint: string;
  changed: { column: string; was: string; now: string }[];
  approved: boolean;
};

export type TransferPlan = {
  rows: string[][];
  issues: TransferIssue[];
  /** Transfer ids CCRS already holds: not re-sent (rule 5). */
  alreadyHeld: string[];
  /** C1: legacy "TR-" ids found held (subset of alreadyHeld). */
  legacyHeld: string[];
  /** C1 rule 7: corrections found (approved ones are rows; the rest E63). */
  corrections: TransferCorrection[];
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
  /** C1 rule 7: what CCRS last accepted per transfer id; absent/omitted = no corrections. */
  told?: TransferToldOutcome;
  /** C1 rule 7: owner approvals (site_settings). */
  approvals?: readonly TransferCorrectionApproval[];
  /** C1 rule 7: the batch day MM/DD/YYYY (UpdatedDate); required for an Update. */
  batchDay?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed", "closed"]);

/** YYYY-MM-DD -> MM/DD/YYYY without any time-zone shift (it is already a calendar day). */
export function transferDate(day: string): string {
  if (!DAY.test(day)) throw new Error(`transferDate: not a YYYY-MM-DD day: ${day}`);
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
}

/**
 * C1: the transfer's ExternalIdentifier IS our lot id, byte for byte: "the
 * exact same as the inventory reported ID, you can not have a suffix"
 * [EXAM2 L0056]. Kept as a function so every caller names the rule.
 */
export function transferExternalId(ourId: string): string {
  return ourId;
}

/** C1: the id R6-2 would have filed for this lot (read-only alias). */
export function legacyTransferExternalId(ourId: string): string {
  return `${LEGACY_TRANSFER_ID_PREFIX}${ourId}`;
}

/** The ids the ledger must be asked about for a set of lots: plain + legacy. */
export function transferLookupIds(ourIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ourIds) {
    if (!id) continue;
    out.add(transferExternalId(id));
    out.add(legacyTransferExternalId(id));
  }
  return [...out];
}

const TCOLS = CCRS_COLUMNS.InventoryTransfer;
/** C1 rule 7: the cells that are facts of the transfer (the row's own bookkeeping excluded). */
export const TRANSFER_COMPARED_COLUMNS: readonly string[] = [
  "FromLicenseNumber",
  "ToLicenseNumber",
  "FromInventoryExternalIdentifier",
  "ToInventoryExternalIdentifier",
  "Quantity",
  "TransferDate",
];

function sameTransferCell(column: string, ours: string, told: string | null | undefined): boolean {
  if (told === null || told === undefined) return false;
  if (column === "Quantity") {
    const a = ours.trim();
    const b = told.trim();
    if (a === "" || b === "") return a === b;
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  }
  return ours === told;
}

/** Compared columns whose cell differs from what CCRS last accepted ([] = unchanged). */
export function transferChangedColumns(row: readonly string[], told: Readonly<Record<string, string>>): { column: string; was: string; now: string }[] {
  return TRANSFER_COMPARED_COLUMNS.filter((c) => !sameTransferCell(c, row[TCOLS.indexOf(c)] ?? "", told[c])).map((c) => ({
    column: c,
    was: told[c] ?? "",
    now: row[TCOLS.indexOf(c)] ?? "",
  }));
}

/** The approval key: the id plus EXACTLY the new values (an older approval never covers a newer change). */
export function transferCorrectionFingerprint(row: readonly string[]): string {
  return [TCOLS.indexOf("ExternalIdentifier"), ...TRANSFER_COMPARED_COLUMNS.map((c) => TCOLS.indexOf(c))].map((i) => row[i] ?? "").join("|");
}

function dayNum(mmddyyyy: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mmddyyyy);
  return m ? Number(`${m[3]}${m[1]}${m[2]}`) : null;
}

/** "Updated Date cannot be prior to Created Date" [G L0242]: the batch day, clamped up. */
export function transferUpdatedDate(createdDate: string, batchDay: string): string {
  const b = dayNum(batchDay);
  if (b === null) throw new Error(`C1: batch day "${batchDay}" is not MM/DD/YYYY`);
  const c = dayNum(createdDate);
  return c !== null && c > b ? createdDate : batchDay;
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
  const legacyHeld: string[] = [];
  const corrections: TransferCorrection[] = [];
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
    if (l.receivedOn > input.toDay || (floor && l.receivedOn < floor)) {
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
    const day = transferDate(l.receivedOn);
    const fresh = [from, ours, vid, ourId, String(qty), day, ext, input.createdBy, day, "", "", "Insert"];
    if (input.held) {
      // C1: the plain id first, then the legacy "TR-" alias. A transfer CCRS
      // holds under EITHER id is already reported (rule 5).
      const legacy = legacyTransferExternalId(ourId);
      const plain = input.held.get(ext) ?? null;
      const old = input.held.get(legacy) ?? null;
      const isPresent = (x: TransferHeld | null) => !!x && !!x.state && PRESENT.has(x.state);
      if (isPresent(old)) {
        // Filed before C1 under "TR-": reported. Never Inserted again, never
        // auto-corrected (its id breaks the no-suffix rule [EXAM2 L0056]).
        alreadyHeld.push(legacy);
        legacyHeld.push(legacy);
        continue;
      }
      const [hid, h] = plain || !old ? ([ext, plain] as const) : ([legacy, old] as const);
      if (isPresent(h)) {
        // C1 rule 7: compare with what CCRS last ACCEPTED for this id.
        const t = input.told?.kind === "loaded" ? input.told.byId.get(ext) : undefined;
        const changed = t && t.told && !t.inFlight ? transferChangedColumns(fresh, t.told) : [];
        if (!t || !t.told || changed.length === 0) {
          alreadyHeld.push(ext);
          continue;
        }
        const fingerprint = transferCorrectionFingerprint(fresh);
        const approved = (input.approvals ?? []).some((a) => a.id === ext && a.fingerprint === fingerprint);
        corrections.push({ id: ext, lotId: l.lotId, label: l.label, fingerprint, changed, approved });
        if (!approved) {
          alreadyHeld.push(ext);
          issue(
            "E63_TRANSFER_CORRECTION_PENDING",
            `CCRS holds transfer ${ext} with ${changed.map((c) => `${c.column} ${c.was || "(blank)"}`).join(", ")}; ours now says ${changed.map((c) => `${c.column} ${c.now || "(blank)"}`).join(", ")}. Approve the correction to send it as an Update`,
          );
          continue;
        }
        if (!input.batchDay) throw new Error("C1: an approved transfer correction needs the batch day (UpdatedDate)");
        // Same ExternalIdentifier [G L0247]; the original CreatedBy/CreatedDate
        // as CCRS accepted them; UpdatedBy/UpdatedDate filled [G L0234-L0242].
        const createdBy = t.told.CreatedBy || input.createdBy;
        const createdDate = t.told.CreatedDate || day;
        rows.push([from, ours, vid, ourId, String(qty), day, ext, createdBy, createdDate, input.createdBy, transferUpdatedDate(createdDate, input.batchDay), "Update"]);
        continue;
      }
      if (h && (h.state === "uncertain" || h.state === "unknown")) {
        issue("E14_TRANSFER_LEDGER_WITHHELD", `the ledger cannot say whether CCRS holds ${hid} (state ${h.state}); record that file's outcome first`);
        continue;
      }
      if (h && h.inFlight) {
        // A file already carrying this transfer is unanswered: a second Insert
        // would be "Duplicate InventoryTransfer for Licensee" [G L1190].
        issue("E14_TRANSFER_LEDGER_WITHHELD", `${hid} is in a file that is uploaded or emitted but not answered yet; record that file's outcome first`);
        continue;
      }
    }
    if (!input.reportable.has(ourId)) {
      issue("E14_TRANSFER_LOT_NOT_REPORTED", `lot ${ourId} is neither held by CCRS nor in this Inventory.csv`);
      continue;
    }
    rows.push(fresh);
  }
  return { rows, issues, alreadyHeld, legacyHeld, corrections, skipped };
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

/**
 * C1: decode the 0325 ccrs_transfer_last_told answer, entries
 * [id, state, told, in_flight]. `absent` = migration not applied (no
 * corrections are proposed; nothing else changes). Anything malformed THROWS.
 */
export function decodeTransferTold(env: LedgerEnv, data: unknown, error: RpcErrorLike | null | undefined): TransferToldOutcome {
  if (error) {
    if (isMissingDbFunctionError(error)) return { kind: "absent" };
    bad(`told: ${error.code ?? "?"} ${error.message ?? ""}`.trim());
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("told: answer is not an object");
  const d = data as Record<string, unknown>;
  if (d.env !== env) bad(`told: answer is for env ${String(d.env)}, asked for ${env}`);
  if (!Array.isArray(d.entries)) bad("told: `entries` is not an array");
  const byId = new Map<string, TransferTold>();
  (d.entries as unknown[]).forEach((x, i) => {
    if (!Array.isArray(x) || x.length !== 4) bad(`told: entry ${i} is not [id,state,told,in_flight]`);
    const [id, state, told, inFlight] = x as unknown[];
    if (typeof id !== "string" || id === "") bad(`told: entry ${i}: id`);
    if (state !== null && (typeof state !== "string" || !(LEDGER_STATES as readonly string[]).includes(state))) bad(`told: entry ${i}: state ${String(state)}`);
    if (told !== null && (typeof told !== "object" || Array.isArray(told))) bad(`told: entry ${i}: told is not an object`);
    if (told !== null && Object.values(told as Record<string, unknown>).some((v) => v !== null && typeof v !== "string")) bad(`told: entry ${i}: told cells are not text`);
    if (typeof inFlight !== "boolean") bad(`told: entry ${i}: in_flight is not a boolean`);
    if (byId.has(id as string)) bad(`told: entry ${i}: ${String(id)} appears twice`);
    byId.set(id as string, { state: state as LedgerState | null, told: told as Record<string, string> | null, inFlight: inFlight as boolean });
  });
  return { kind: "loaded", byId };
}

/* ------------------------------------------------------------------ *
 * C1 rule 7: owner approvals of transfer corrections (site_settings)
 * ------------------------------------------------------------------ */

export const TRANSFER_CORRECTION_SETTING_KEY = "ccrs.transfer_corrections";
/** One list per environment: a PREprod approval never sends a production Update. */
export function transferCorrectionSettingKey(env: LedgerEnv): string {
  return `${TRANSFER_CORRECTION_SETTING_KEY}.${env}`;
}
export const TRANSFER_CORRECTION_MAX = 2000;

export function normalizeTransferApprovals(v: unknown): TransferCorrectionApproval[] {
  const arr = v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : [];
  const byId = new Map<string, TransferCorrectionApproval>();
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const fingerprint = typeof r.fingerprint === "string" ? r.fingerprint : "";
    if (!id || id.length > 100 || !fingerprint || fingerprint.length > 1000) continue;
    byId.set(id, { id, fingerprint, at: typeof r.at === "string" ? r.at : "", by: typeof r.by === "string" ? r.by : null });
  }
  return [...byId.values()].slice(-TRANSFER_CORRECTION_MAX);
}

/** One approval per id: a newer approval replaces the older one. */
export function approveTransferCorrection(list: readonly TransferCorrectionApproval[], a: TransferCorrectionApproval): TransferCorrectionApproval[] {
  const id = a.id.trim();
  if (!id || !a.fingerprint) return [...list];
  return [...list.filter((x) => x.id !== id), { ...a, id }].slice(-TRANSFER_CORRECTION_MAX);
}

export function withdrawTransferCorrection(list: readonly TransferCorrectionApproval[], id: string): TransferCorrectionApproval[] {
  return list.filter((x) => x.id !== id.trim());
}

/**
 * The correction id + fingerprint a row of an E63 issue carries, so the hub
 * button can approve EXACTLY what the owner was shown. Row id format:
 * "<transfer id>#<fingerprint>".
 */
export function e63RowId(c: { id: string; fingerprint: string }): string {
  return `${c.id}#${c.fingerprint}`;
}
export function parseE63RowId(rowId: string): { id: string; fingerprint: string } | null {
  const i = rowId.indexOf("#");
  if (i <= 0 || i === rowId.length - 1) return null;
  return { id: rowId.slice(0, i), fingerprint: rowId.slice(i + 1) };
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
  const blocking = p.issues.filter((i) => TRANSFER_BLOCKING.has(i.code) && i.code !== "E63_TRANSFER_CORRECTION_PENDING").length;
  const parts = [`${p.rows.length} transfer row(s)`];
  if (p.alreadyHeld.length) parts.push(`${p.alreadyHeld.length} already reported`);
  if (p.legacyHeld.length) parts.push(`${p.legacyHeld.length} of them under the old "TR-" id`);
  const sent = p.corrections.filter((c) => c.approved).length;
  if (sent) parts.push(`${sent} approved correction(s) sent as Update`);
  if (p.corrections.length - sent) parts.push(`${p.corrections.length - sent} correction(s) waiting for approval`);
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
  const throwsT = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
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
    p.rows[0].join(",") === "417068,413541,WA417068-ABC,WA417068-ABC,24,11/03/2026,WA417068-ABC,Greenway,11/03/2026,,,Insert",
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
  ok(buildTransferRows(base({ held: new Map([["WA417068-ABC", { state: "filed", inFlight: false }]]) })).alreadyHeld.length === 1, "held not re-sent");
  ok(buildTransferRows(base({ held: new Map([["WA417068-ABC", { state: "uncertain", inFlight: false }]]) })).issues[0]?.code === "E14_TRANSFER_LEDGER_WITHHELD", "uncertain withheld");
  ok(buildTransferRows(base({ held: new Map([["WA417068-ABC", null]]) })).rows.length === 1, "not held -> sent");
  ok(buildTransferRows(base({ held: new Map([["WA417068-ABC", { state: null, inFlight: true }]]) })).issues[0]?.code === "E14_TRANSFER_LEDGER_WITHHELD", "in flight withheld");
  // C1 D-1: the ExternalIdentifier IS the To lot id [EXAM2 L0056]; the legacy TR- alias still holds it back.
  const EXT = CCRS_COLUMNS.InventoryTransfer.indexOf("ExternalIdentifier");
  const TO = CCRS_COLUMNS.InventoryTransfer.indexOf("ToInventoryExternalIdentifier");
  ok(p.rows[0][EXT] === p.rows[0][TO] && !p.rows[0][EXT].startsWith("TR-"), "C1: ExternalIdentifier === ToInventoryExternalIdentifier, no prefix");
  ok(transferExternalId("WA1.X") === "WA1.X", "C1: id passes through byte for byte");
  ok(transferLookupIds(["A", "A", ""]).join(",") === "A,TR-A", "C1: lookup asks for plain + legacy, once each");
  const leg = buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: "filed", inFlight: false }]]) }));
  ok(leg.rows.length === 0 && leg.legacyHeld.join() === "TR-WA417068-ABC" && leg.alreadyHeld.join() === "TR-WA417068-ABC", "C1: legacy TR- held -> never re-Inserted");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: "uncertain", inFlight: false }]]) })).issues[0]?.code === "E14_TRANSFER_LEDGER_WITHHELD", "C1: legacy uncertain withheld");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: null, inFlight: true }]]) })).issues[0]?.code === "E14_TRANSFER_LEDGER_WITHHELD", "C1: legacy in flight withheld");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: "deleted", inFlight: false }]]) })).rows.length === 1, "C1: legacy deleted -> sent under the plain id");
  // C1 D-3: correction path [EXAM2 L0058].
  const held1 = new Map([["WA417068-ABC", { state: "filed" as LedgerState, inFlight: false }]]);
  const told = (cells: Record<string, string>, o: Partial<TransferTold> = {}): TransferToldOutcome => ({
    kind: "loaded",
    byId: new Map([["WA417068-ABC", { state: "filed", inFlight: false, told: { FromLicenseNumber: "417068", ToLicenseNumber: "413541", FromInventoryExternalIdentifier: "WA417068-ABC", ToInventoryExternalIdentifier: "WA417068-ABC", Quantity: "24", TransferDate: "11/03/2026", CreatedBy: "Greenway", CreatedDate: "11/03/2026", ...cells }, ...o }]]),
  });
  const same = buildTransferRows(base({ held: held1, told: told({ Quantity: "24.00" }), batchDay: "11/08/2026" }));
  ok(same.rows.length === 0 && same.corrections.length === 0 && same.alreadyHeld.length === 1, "C1: unchanged (24 = 24.00) -> nothing");
  const pend = buildTransferRows(base({ held: held1, told: told({ Quantity: "20" }), batchDay: "11/08/2026" }));
  ok(pend.rows.length === 0 && pend.issues[0]?.code === "E63_TRANSFER_CORRECTION_PENDING" && pend.corrections[0]?.changed[0]?.column === "Quantity", "C1: changed + unapproved -> E63, no row");
  const fp = pend.corrections[0].fingerprint;
  const upd = buildTransferRows(base({ held: held1, told: told({ Quantity: "20", CreatedDate: "11/03/2026" }), approvals: [{ id: "WA417068-ABC", fingerprint: fp, at: "", by: null }], batchDay: "11/08/2026" }));
  ok(upd.rows[0]?.join(",") === "417068,413541,WA417068-ABC,WA417068-ABC,24,11/03/2026,WA417068-ABC,Greenway,11/03/2026,Greenway,11/08/2026,Update", `C1: approved -> Update row ${upd.rows[0]?.join(",")}`);
  ok(upd.alreadyHeld.length === 0 && upd.issues.length === 0, "C1: an Update is not counted as already held");
  ok(buildTransferRows(base({ held: held1, told: told({ Quantity: "20" }), approvals: [{ id: "WA417068-ABC", fingerprint: fp.replace("|24|", "|25|"), at: "", by: null }], batchDay: "11/08/2026" })).issues[0]?.code === "E63_TRANSFER_CORRECTION_PENDING", "C1: stale approval does not cover new values");
  ok(buildTransferRows(base({ held: held1, told: told({ Quantity: "20" }, { inFlight: true }), batchDay: "11/08/2026" })).corrections.length === 0, "C1: in flight -> no correction yet");
  ok(buildTransferRows(base({ held: held1, told: told({ Quantity: "20" }) , approvals: [{ id: "WA417068-ABC", fingerprint: fp, at: "", by: null }], batchDay: "11/01/2026" })).rows[0]?.[10] === "11/03/2026", "C1: UpdatedDate never before CreatedDate");
  ok(buildTransferRows(base({ held: new Map([["TR-WA417068-ABC", { state: "filed", inFlight: false }]]), told: told({ Quantity: "20" }) })).corrections.length === 0, "C1: legacy id never auto-corrected");
  ok(transferChangedColumns(upd.rows[0], { FromLicenseNumber: "417068" }).length === 5, "C1: missing told cells count as changed");
  ok(parseE63RowId(e63RowId({ id: "A.1", fingerprint: "A.1|x|y" }))?.fingerprint === "A.1|x|y" && parseE63RowId("nohash") === null, "C1: E63 row id round trip");
  ok(normalizeTransferApprovals({ items: [{ id: "A", fingerprint: "f1" }, { id: "A", fingerprint: "f2" }, { id: "", fingerprint: "x" }] }).map((a) => a.fingerprint).join() === "f2", "C1: approvals normalized, one per id");
  ok(withdrawTransferCorrection(approveTransferCorrection([], { id: "A", fingerprint: "f", at: "", by: null }), "A").length === 0, "C1: approve / withdraw");
  ok(transferCorrectionSettingKey("prod") !== transferCorrectionSettingKey("preprod"), "C1: approvals are per environment");
  const dt = decodeTransferTold("prod", { env: "prod", entries: [["A", "filed", { Quantity: "2" }, false]] }, null);
  ok(dt.kind === "loaded" && dt.byId.get("A")?.told?.Quantity === "2", "C1: told decoded");
  ok(decodeTransferTold("prod", null, { code: "42883", message: "" }).kind === "absent", "C1: told missing fn -> absent");
  ok(throwsT(() => decodeTransferTold("prod", { env: "prod", entries: [["A", "filed", [], false]] }, null)), "C1: told array throws");
  ok(throwsT(() => decodeTransferTold("prod", { env: "prod", entries: [["A", null, null, false], ["A", null, null, false]] }, null)), "C1: told duplicate throws");
  const dIn = decodeTransferSlice("prod", { env: "prod", entries: [["T2", null, true]] }, null);
  ok(dIn.kind === "loaded" && dIn.held.get("T2")?.inFlight === true && transferLedgerEntries(dIn.held).length === 0, "in-flight decoded, not a ledger entry");
  ok(buildTransferRows(base({ reportable: new Set() })).issues[0]?.code === "E14_TRANSFER_LOT_NOT_REPORTED", "To lot must be reported");
  ok(transferDate("2026-11-03") === "11/03/2026", "date has no tz shift");
  ok(vendorIdSourceFor("wcia") === "wcia_json" && vendorIdSourceFor("pdf-manifest") === "pdf_guess", "source stamp");
  ok(!normalizeOwnerVendorId("a,b").ok && normalizeOwnerVendorId(" X1 ").ok, "owner id normalize");
  const dec = decodeTransferSlice("prod", { env: "prod", entries: [["T1", "filed", false]] }, null);
  ok(dec.kind === "loaded" && dec.held.get("T1")?.state === "filed", "decode");
  ok(decodeTransferSlice("prod", null, { code: "42883", message: "" }).kind === "absent", "missing fn -> absent");
  let threw = false;
  try {
    decodeTransferSlice("prod", { env: "preprod", entries: [] }, null);
  } catch {
    threw = true;
  }
  ok(threw, "env mismatch throws");
  ok(throwsT(() => decodeTransferTold("prod", { env: "preprod", entries: [] }, null)), "C1: told env mismatch throws");
  return { passed, failed: 0 };
}
