/**
 * src/lib/payments/timberland-originator-core.ts  (R41 S2)
 *
 * The originator block of every ACH file Greenway builds, checked against
 * what Timberland set up. PURE: no I/O, no clock, no server-only imports.
 *
 * Brenda (Timberland Cash Management) said three things must match her side
 * (docs/authorities/ach/timberland-brenda-2026-10.txt, Email 1):
 *   "There are 3 parameters I need to have match my side. Company Name /
 *    Company ID / Make sure that it's an unbalanced batch"
 * and then answered them (Email 2): "1. GREENWAY MARIJUA (that is all that
 * will fit in this section)", "2. 1 + EIN", "3. Routing number - 325170754".
 * The signed agreement allows only CCD and PPD (section 1) and lists the
 * restricted codes in Schedule E: "IAT, CTX, TEL, POP, BOC, ARC, RCK".
 *
 * Every value used here comes from timberland-profile-core.ts (S1), where it
 * is pinned to its quote. Nothing is typed twice.
 *
 * What this file decides (all strict; a refusal names the field and the fix):
 *   - validateOriginator(): routing 325170754, Originating DFI 32517075,
 *     Immediate Origin = Company ID = "1" + the 9-digit EIN from the company
 *     profile (blank EIN refused, a 9-digit ID refused, any other ID refused),
 *     the batch name cuts to exactly GREENWAY MARIJUA, the bank name is not
 *     blank.
 *   - checkSecCode(): PPD or CCD only. A Schedule E code is refused with the
 *     schedule named.
 *   - checkBuiltFileShape(): the builder re-reads its OWN output: SCC 220,
 *     debit totals zero, only credit codes 22/23/32/33, the originator fields
 *     where Timberland reads them, every record 94 wide.
 *   - originatorReadiness(): the ONE readiness answer every page and file
 *     path uses (it replaced five different 3/5/6-field checks).
 *
 * The file header's Immediate Origin Name (positions 64-86) keeps the full
 * trade name "GREENWAY MARIJUANA" until Brenda answers Q11 (plan section 3.1).
 */

import type { AchOriginator } from "./nacha-core";
import { alpha, sanitizeAlpha } from "./nacha-fields-core";
import {
  ACCOUNT_LAST4,
  ALLOWED_SEC,
  BATCH_COMPANY_NAME,
  COMPANY_ID_PREFIX,
  RESTRICTED_SEC,
  TIMBERLAND_ODFI,
  TIMBERLAND_ROUTING,
} from "./timberland-profile-core";

// ─────────────────────────────────────────────────────────────────────────────
// 1. The rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two spellings of the company name the settings may hold. Both cut to
 * Brenda's 16-character batch name. The full one is what the file header
 * carries until Q11 is answered; the short one is Brenda's own text.
 */
export const ACCEPTED_COMPANY_NAMES: readonly string[] = ["GREENWAY MARIJUANA", BATCH_COMPANY_NAME];

/** Credit transaction codes the builder may write (live 22/32, prenote 23/33). */
export const CREDIT_TRANSACTION_CODES: readonly string[] = ["22", "23", "32", "33"];

export type OriginatorField =
  | "destinationRouting"
  | "destinationName"
  | "originatingDfi"
  | "companyEin"
  | "companyId"
  | "immediateOrigin"
  | "companyName";

export type OriginatorProblem = { field: OriginatorField; message: string };

const FIELD_LABEL: Record<OriginatorField, string> = {
  destinationRouting: "Bank routing number",
  destinationName: "Bank name",
  originatingDfi: "Originating DFI",
  companyEin: "Company EIN",
  companyId: "Company ID",
  immediateOrigin: "Immediate Origin",
  companyName: "Company name",
};

export function originatorFieldLabel(f: OriginatorField): string {
  return FIELD_LABEL[f];
}

/** The 10-character Company ID Timberland expects for an EIN: "1" + EIN. */
export function expectedCompanyId(ein: string): string {
  return `${COMPANY_ID_PREFIX}${ein}`;
}

function idProblem(field: "companyId" | "immediateOrigin", raw: string, ein: string | null): OriginatorProblem | null {
  // Exact, never trimmed: the builder writes the stored value as-is, so a stray
  // space would shift every later field of the record.
  const v = raw;
  const label = FIELD_LABEL[field];
  if (!v.trim()) return { field, message: `${label} is blank. Timberland's is "1" followed by the 9-digit EIN (Brenda: "1 + EIN").` };
  if (/^\d{9}$/.test(v)) {
    return { field, message: `${label} "${v}" is only 9 digits. Timberland's is "1" followed by the 9-digit EIN: 10 digits (Brenda: "1 + EIN").` };
  }
  if (/^\s|\s$/.test(v)) return { field, message: `${label} has a space before or after it. Enter exactly 10 digits.` };
  if (!/^1\d{9}$/.test(v)) {
    return { field, message: `${label} "${v}" is not "1" followed by 9 digits (Brenda: "1 + EIN").` };
  }
  if (ein && v !== expectedCompanyId(ein)) {
    return { field, message: `${label} "${v}" does not match the company EIN on file. It must be ${expectedCompanyId(ein)} ("1" + EIN).` };
  }
  return null;
}

/**
 * Every way the originator block could make Timberland refuse the file, or
 * make a file Timberland does not expect. Empty list = matches Timberland.
 * `ein` is company_profile.ein (9 digits), never typed into the ACH form.
 */
export function validateOriginator(o: AchOriginator): OriginatorProblem[] {
  const out: OriginatorProblem[] = [];
  const routing = o.destinationRouting ?? "";
  if (routing !== TIMBERLAND_ROUTING) {
    out.push({
      field: "destinationRouting",
      message: routing
        ? `Bank routing number "${routing}" is not Timberland's. It must be ${TIMBERLAND_ROUTING} (Brenda, answer 3).`
        : `Bank routing number is blank. It must be Timberland's ${TIMBERLAND_ROUTING} (Brenda, answer 3).`,
    });
  }
  if (!sanitizeAlpha(o.destinationName ?? "").trim()) {
    out.push({ field: "destinationName", message: "Bank name is blank. Enter TIMBERLAND BANK (the name on the signed agreement)." });
  }
  const odfi = o.originatingDfi ?? "";
  if (odfi !== TIMBERLAND_ODFI) {
    out.push({
      field: "originatingDfi",
      message: `Originating DFI ${odfi ? `"${odfi}"` : "is blank; it"} must be ${TIMBERLAND_ODFI}, the first 8 digits of Timberland's routing number.`,
    });
  }
  const einRaw = (o.companyEin ?? "").trim();
  let ein: string | null = null;
  if (!einRaw) {
    out.push({
      field: "companyEin",
      message: "The company EIN is not entered (Books > Company information), so the Company ID cannot be checked. Enter the EIN there first.",
    });
  } else if (!/^\d{9}$/.test(einRaw)) {
    out.push({ field: "companyEin", message: "The company EIN on file is not 9 digits. Fix it on Books > Company information." });
  } else {
    ein = einRaw;
  }
  for (const f of ["companyId", "immediateOrigin"] as const) {
    const p = idProblem(f, o[f] ?? "", ein);
    if (p) out.push(p);
  }
  const name = sanitizeAlpha(o.companyName ?? "");
  if (alpha(name, 16) !== BATCH_COMPANY_NAME) {
    out.push({
      field: "companyName",
      message: `Company name "${name || "(blank)"}" puts "${alpha(name, 16).trimEnd()}" in the batch header. Timberland set it up as "${BATCH_COMPANY_NAME}" (Brenda, answer 1). Enter GREENWAY MARIJUANA.`,
    });
  } else if (!ACCEPTED_COMPANY_NAMES.includes(name)) {
    out.push({
      field: "companyName",
      message: `Company name "${name}" is not GREENWAY MARIJUANA. The file header keeps the full trade name until Timberland answers Q11.`,
    });
  }
  return out;
}

/** The first problem as one sentence for a file builder's refusal, or null. */
export function checkOriginatorForFile(o: AchOriginator): string | null {
  const p = validateOriginator(o);
  if (!p.length) return null;
  return `The company ACH settings do not match Timberland's setup: ${p.map((x) => x.message).join(" ")} Fix them on Banking > My banking.`;
}

/** PPD and CCD only (agreement section 1). A Schedule E code is refused by name. */
export function checkSecCode(sec: string): string | null {
  if (ALLOWED_SEC.includes(sec)) return null;
  if (RESTRICTED_SEC.includes(sec)) {
    return `${sec} entries are restricted by Timberland's agreement (Schedule E, restricted entries: ${RESTRICTED_SEC.join(", ")}). Greenway may send only ${ALLOWED_SEC.join(" and ")}.`;
  }
  return `"${sec}" is not an entry type on Timberland's agreement. Greenway may send only ${ALLOWED_SEC.join(" and ")} (section 1).`;
}

/**
 * The builder re-reads its own output before handing it over. Each line is
 * a reason the file is NOT what Timberland agreed to. Empty = fine.
 */
export function checkBuiltFileShape(file: string, o: AchOriginator): string[] {
  const bad: string[] = [];
  const rows = file.split("\n").filter((r) => r.length > 0);
  if (!rows.length) return ["the file is empty"];
  if (!rows.every((r) => r.length === 94)) bad.push("a record is not 94 characters");
  if (rows.length % 10 !== 0) bad.push("the record count is not a multiple of 10");
  const one = rows[0] ?? "";
  if (!one.startsWith("101")) bad.push("the first record is not a file header");
  if (one.slice(3, 13) !== ` ${TIMBERLAND_ROUTING}`) bad.push("the file header does not name Timberland's routing number");
  if (one.slice(13, 23) !== o.immediateOrigin) bad.push("the file header Immediate Origin is not the Company ID");
  const fives = rows.filter((r) => r[0] === "5");
  const eights = rows.filter((r) => r[0] === "8");
  if (!fives.length || fives.length !== eights.length) bad.push("batch header and batch control records do not pair up");
  for (const b of fives) {
    if (b.slice(1, 4) !== "220") bad.push("a batch is not credits-only (service class 220)");
    if (b.slice(4, 20) !== BATCH_COMPANY_NAME) bad.push(`a batch Company Name is not "${BATCH_COMPANY_NAME}"`);
    if (b.slice(40, 50) !== o.companyId) bad.push("a batch Company ID is not the Company ID");
    if (!ALLOWED_SEC.includes(b.slice(50, 53))) bad.push(`a batch has entry type "${b.slice(50, 53)}"`);
    if (b.slice(79, 87) !== TIMBERLAND_ODFI) bad.push("a batch Originating DFI is not Timberland's");
  }
  for (const c of eights) {
    if (c.slice(1, 4) !== "220") bad.push("a batch control is not service class 220");
    if (c.slice(20, 32) !== "0".repeat(12)) bad.push("a batch has a debit total");
  }
  for (const e of rows.filter((r) => r[0] === "6")) {
    if (!CREDIT_TRANSACTION_CODES.includes(e.slice(1, 3))) bad.push(`an entry has transaction code ${e.slice(1, 3)} (credits only)`);
  }
  const nine = rows.find((r) => r[0] === "9" && r !== "9".repeat(94));
  if (!nine) bad.push("there is no file control record");
  else if (nine.slice(31, 43) !== "0".repeat(12)) bad.push("the file has a debit total");
  return [...new Set(bad)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. One readiness answer for every page and every file path
// ─────────────────────────────────────────────────────────────────────────────

/** The stored ach_company_settings row (snake_case), as the store returns it. */
export type CompanySettingsLike = {
  destination_routing: string;
  destination_name: string;
  immediate_origin: string;
  company_name: string;
  company_id: string;
  originating_dfi: string;
  company_account_number?: string | null;
};

export function originatorFromSettings(s: CompanySettingsLike, ein: string | null | undefined): AchOriginator {
  return {
    destinationRouting: s.destination_routing ?? "",
    destinationName: s.destination_name ?? "",
    immediateOrigin: s.immediate_origin ?? "",
    companyName: s.company_name ?? "",
    companyId: s.company_id ?? "",
    originatingDfi: s.originating_dfi ?? "",
    companyEin: (ein ?? "").trim(),
  };
}

/** Last four of the funding account, never more (the repo and the page are not a vault). */
export function accountLast4(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/[^0-9A-Za-z]/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

export type OriginatorReadiness = {
  /** True when an ACH file may be built (the originator matches Timberland). */
  ready: boolean;
  /** ready AND the funding account on file is the one in the agreement. */
  complete: boolean;
  fileProblems: OriginatorProblem[];
  accountProblems: string[];
  /** Every problem as a sentence, file problems first. */
  problems: string[];
  originator: AchOriginator | null;
};

/**
 * `settings` null = the settings could not be read (never "all clear").
 * The funding account is not written into the file, so it only affects
 * `complete`; the agreement names one account, ending ACCOUNT_LAST4.
 */
export function originatorReadiness(settings: CompanySettingsLike | null, ein: string | null | undefined): OriginatorReadiness {
  if (!settings) {
    const msg = "The company ACH settings could not be read, so no file can be made.";
    return { ready: false, complete: false, fileProblems: [], accountProblems: [], problems: [msg], originator: null };
  }
  const originator = originatorFromSettings(settings, ein);
  const fileProblems = validateOriginator(originator);
  const accountProblems: string[] = [];
  const last4 = accountLast4(settings.company_account_number);
  if (!last4) accountProblems.push(`Greenway's Timberland account number is not entered (the agreement names the account ending ${ACCOUNT_LAST4}).`);
  else if (last4 !== ACCOUNT_LAST4) accountProblems.push(`The account on file ends in ${last4}. The signed agreement names the account ending ${ACCOUNT_LAST4}.`);
  const ready = fileProblems.length === 0;
  return {
    ready,
    complete: ready && accountProblems.length === 0,
    fileProblems,
    accountProblems,
    problems: [...fileProblems.map((p) => p.message), ...accountProblems],
    originator: ready ? originator : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The "Timberland confirmed on ___" stamp (migration 0272)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum words of evidence for a confirmation (who at Timberland, how, when). */
export const MIN_CONFIRM_NOTE_CHARS = 10;

export type TimberlandStamp = {
  confirmedAt: string | null;
  confirmedBy: string | null;
  note: string | null;
  clearedAt: string | null;
};

export type StampView =
  | { state: "confirmed"; tone: "green"; text: string }
  | { state: "cleared"; tone: "gold"; text: string }
  | { state: "never"; tone: "gold"; text: string }
  | { state: "unknown"; tone: "gold"; text: string };

/** Pacific calendar date of an ISO time (the stamp is shown as a date). */
export function pacificDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** columnsReady=false before migration 0272 is applied. */
export function timberlandStampView(stamp: TimberlandStamp | null, columnsReady: boolean, confirmerName?: string | null): StampView {
  if (!columnsReady || !stamp) {
    return { state: "unknown", tone: "gold", text: "The confirmation stamp needs migration 0272. Until it is applied, nothing records that Timberland confirmed these values." };
  }
  if (stamp.confirmedAt) {
    return {
      state: "confirmed",
      tone: "green",
      text: `Timberland confirmed on ${pacificDate(stamp.confirmedAt)}${confirmerName ? ` (recorded by ${confirmerName})` : ""}${stamp.note ? `: ${stamp.note}` : "."}`,
    };
  }
  if (stamp.clearedAt) {
    return {
      state: "cleared",
      tone: "gold",
      text: `Re-confirm with Timberland: a bank-matched field changed on ${pacificDate(stamp.clearedAt)}, which cleared the earlier confirmation.`,
    };
  }
  return { state: "never", tone: "gold", text: "Not yet confirmed with Timberland. Ask Brenda to confirm the Company Name and Company ID below match her setup, then record it here." };
}

/** Refusal for the confirm action, or null when it may be stamped. */
export function confirmStampProblem(readiness: OriginatorReadiness, note: string): string | null {
  if (!readiness.ready) return `Fix the settings first; a setup that does not match Timberland cannot be confirmed. ${readiness.problems.join(" ")}`;
  if (note.trim().length < MIN_CONFIRM_NOTE_CHARS) {
    return `Say who at Timberland confirmed it and how (at least ${MIN_CONFIRM_NOTE_CHARS} characters), for example "Brenda, email of 10/16".`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** A test EIN (not Greenway's). The real one lives only in company_profile. */
export const TEST_EIN = "911234567";

export function greenwayTestOriginator(over: Partial<AchOriginator> = {}): AchOriginator {
  return {
    destinationRouting: TIMBERLAND_ROUTING,
    destinationName: "TIMBERLAND BANK",
    immediateOrigin: `1${TEST_EIN}`,
    companyName: "Greenway Marijuana",
    companyId: `1${TEST_EIN}`,
    originatingDfi: TIMBERLAND_ODFI,
    companyEin: TEST_EIN,
    ...over,
  };
}

export function __runTimberlandOriginatorCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL timberland-originator-core:", msg);
    }
  };
  const fields = (o: AchOriginator) => validateOriginator(o).map((p) => p.field);
  const only = (o: AchOriginator, f: OriginatorField) => JSON.stringify(fields(o)) === JSON.stringify([f]);

  ok(validateOriginator(greenwayTestOriginator()).length === 0, "the real Greenway shape passes");
  ok(validateOriginator(greenwayTestOriginator({ companyName: "GREENWAY MARIJUA" })).length === 0, "Brenda's 16-char name passes");
  ok(validateOriginator(greenwayTestOriginator({ companyName: "greenway   marijuana " })).length === 0, "case, inner and trailing spacing are normalised like the file");
  // The builder keeps a LEADING space (sanitizeAlpha only trims the end), so the
  // batch name would print " GREENWAY MARIJU" -- the validator must refuse it.
  ok(only(greenwayTestOriginator({ companyName: "  greenway marijuana" }), "companyName"), "a leading space in the name is refused (it would shift the batch name)");
  // routing
  ok(only(greenwayTestOriginator({ destinationRouting: "325170835" }), "destinationRouting"), "another valid ABA is refused");
  ok(only(greenwayTestOriginator({ destinationRouting: "" }), "destinationRouting"), "blank routing refused");
  ok(only(greenwayTestOriginator({ destinationRouting: "32517075" }), "destinationRouting"), "8-digit routing refused");
  ok(only(greenwayTestOriginator({ destinationRouting: "325-170-754" }), "destinationRouting"), "formatted routing refused (store digits only)");
  // ODFI
  ok(only(greenwayTestOriginator({ originatingDfi: "325170754" }), "originatingDfi"), "9-digit ODFI refused");
  ok(only(greenwayTestOriginator({ originatingDfi: "32517083" }), "originatingDfi"), "another ODFI refused");
  ok(only(greenwayTestOriginator({ originatingDfi: "" }), "originatingDfi"), "blank ODFI refused");
  // bank name
  ok(only(greenwayTestOriginator({ destinationName: "   " }), "destinationName"), "blank bank name refused");
  ok(only(greenwayTestOriginator({ destinationName: "###" }), "destinationName"), "a bank name that sanitises to nothing refused");
  // EIN
  const noEin = fields(greenwayTestOriginator({ companyEin: "" }));
  ok(noEin.length === 1 && noEin[0] === "companyEin", "blank EIN refused (the IDs keep their shape check)");
  ok(fields(greenwayTestOriginator({ companyEin: "91123456" })).includes("companyEin"), "8-digit EIN refused");
  ok(fields(greenwayTestOriginator({ companyEin: "91-1234567" })).includes("companyEin"), "dashed EIN refused (company_profile stores 9 digits)");
  // Company ID / Immediate Origin
  ok(only(greenwayTestOriginator({ companyId: TEST_EIN }), "companyId"), "9-digit Company ID (EIN alone) refused");
  ok(only(greenwayTestOriginator({ immediateOrigin: TEST_EIN }), "immediateOrigin"), "9-digit Immediate Origin refused");
  ok(only(greenwayTestOriginator({ companyId: "1911234568" }), "companyId"), "Company ID for a different EIN refused");
  ok(only(greenwayTestOriginator({ immediateOrigin: "1911234568" }), "immediateOrigin"), "Immediate Origin for a different EIN refused");
  ok(only(greenwayTestOriginator({ companyId: "9911234567" }), "companyId"), "a 10-digit ID with the wrong prefix refused");
  ok(only(greenwayTestOriginator({ companyId: "" }), "companyId"), "blank Company ID refused");
  ok(only(greenwayTestOriginator({ companyId: " 1911234567" }), "companyId"), "a leading space is refused (it would shift the batch header)");
  ok(only(greenwayTestOriginator({ immediateOrigin: "1911234567 " }), "immediateOrigin"), "a trailing space is refused");
  ok(only(greenwayTestOriginator({ destinationRouting: " 325170754" }), "destinationRouting"), "a spaced routing number is refused");
  ok(only(greenwayTestOriginator({ companyId: "1 911234567" }), "companyId"), "inner space refused");
  ok(fields(greenwayTestOriginator({ companyEin: "", companyId: TEST_EIN })).includes("companyId"), "with no EIN, a 9-digit ID is still refused");
  ok(fields(greenwayTestOriginator({ companyEin: "", companyId: "1911234567" })).join() === "companyEin", "with no EIN, a well-shaped ID is held only by the EIN refusal");
  ok(validateOriginator(greenwayTestOriginator({ companyId: TEST_EIN }))[0]!.message.includes("only 9 digits"), "the 9-digit refusal says so");
  ok(validateOriginator(greenwayTestOriginator({ companyId: "1911234568" }))[0]!.message.includes(`1${TEST_EIN}`), "the mismatch refusal names the right ID");
  // name
  ok(only(greenwayTestOriginator({ companyName: "Lymans Marijuana LLC" }), "companyName"), "the contract legal name is refused for the batch");
  ok(only(greenwayTestOriginator({ companyName: "GREENWAY" }), "companyName"), "a short name refused");
  ok(only(greenwayTestOriginator({ companyName: "GREENWAY MARIJUANA LLC" }), "companyName"), "a longer name with the right first 16 is refused");
  ok(only(greenwayTestOriginator({ companyName: "GREENWAY MARIJUAN" }), "companyName"), "17 characters refused");
  ok(only(greenwayTestOriginator({ companyName: "" }), "companyName"), "blank name refused");
  ok(validateOriginator(greenwayTestOriginator({ companyName: "Greenway Cannabis" }))[0]!.message.includes(BATCH_COMPANY_NAME), "the name refusal quotes Brenda's name");
  ok(ACCEPTED_COMPANY_NAMES.every((n) => alpha(n, 16) === BATCH_COMPANY_NAME), "both accepted names cut to Brenda's 16");
  // all wrong at once
  ok(validateOriginator({ destinationRouting: "", destinationName: "", immediateOrigin: "", companyName: "", companyId: "", originatingDfi: "", companyEin: "" }).length === 7, "an empty originator reports all seven fields");
  ok(checkOriginatorForFile(greenwayTestOriginator()) === null, "file check passes a good originator");
  ok(/Banking > My banking/.test(checkOriginatorForFile(greenwayTestOriginator({ companyId: TEST_EIN })) ?? ""), "file check says where to fix it");

  // SEC
  ok(checkSecCode("PPD") === null && checkSecCode("CCD") === null, "PPD and CCD allowed");
  for (const c of ["IAT", "CTX", "TEL", "POP", "BOC", "ARC", "RCK"]) ok(/Schedule E/.test(checkSecCode(c) ?? ""), `${c} refused, citing Schedule E`);
  ok(/section 1/.test(checkSecCode("WEB") ?? ""), "WEB refused as not on the agreement");
  ok(checkSecCode("ppd") !== null, "lower-case is not silently accepted");

  // readiness
  const S = { destination_routing: TIMBERLAND_ROUTING, destination_name: "TIMBERLAND BANK", immediate_origin: `1${TEST_EIN}`, company_name: "GREENWAY MARIJUANA", company_id: `1${TEST_EIN}`, originating_dfi: TIMBERLAND_ODFI, company_account_number: `000000${ACCOUNT_LAST4}` };
  const r = originatorReadiness(S, TEST_EIN);
  ok(r.ready && r.complete && r.problems.length === 0 && r.originator?.companyEin === TEST_EIN, "a full, matching setup is ready and complete");
  const r2 = originatorReadiness({ ...S, company_account_number: "0000001234" }, TEST_EIN);
  ok(r2.ready && !r2.complete && /ends in 1234/.test(r2.problems.join()), "a different funding account: files OK, setup not complete");
  ok(!r2.problems.join().includes("0000001234"), "the account refusal shows the last four only");
  const r3 = originatorReadiness({ ...S, company_account_number: "" }, TEST_EIN);
  ok(r3.ready && !r3.complete, "missing funding account: not complete");
  const r4 = originatorReadiness(S, "");
  ok(!r4.ready && !r4.complete && r4.originator === null, "no EIN: not ready, no originator handed out");
  const r5 = originatorReadiness(null, TEST_EIN);
  ok(!r5.ready && /could not be read/.test(r5.problems[0] ?? ""), "an unread settings row is never all clear");
  ok(accountLast4("12-34 5678") === "5678" && accountLast4("12") === "", "last four");

  // stamp
  ok(timberlandStampView(null, false).state === "unknown", "before 0272: unknown, gold");
  const conf = timberlandStampView({ confirmedAt: "2026-10-16T22:30:00Z", confirmedBy: "u", note: "Brenda, email", clearedAt: null }, true, "Michael");
  ok(conf.state === "confirmed" && conf.text.includes("2026-10-16") && conf.text.includes("Michael"), "confirmed shows the Pacific date and who recorded it");
  ok(timberlandStampView({ confirmedAt: "2026-10-17T05:30:00Z", confirmedBy: "u", note: null, clearedAt: null }, true).text.includes("2026-10-16"), "the date is Pacific, not UTC");
  ok(timberlandStampView({ confirmedAt: null, confirmedBy: null, note: null, clearedAt: "2026-10-20T18:00:00Z" }, true).state === "cleared", "a cleared stamp asks to re-confirm");
  ok(timberlandStampView({ confirmedAt: null, confirmedBy: null, note: null, clearedAt: null }, true).state === "never", "never confirmed");
  ok(confirmStampProblem(r, "Brenda, email of 10/16") === null, "a ready setup with a note may be stamped");
  ok(confirmStampProblem(r, "ok") !== null, "a short note refused");
  ok(confirmStampProblem(r4, "Brenda, email of 10/16") !== null, "a setup that does not match cannot be confirmed");

  console.log(`timberland-originator-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
