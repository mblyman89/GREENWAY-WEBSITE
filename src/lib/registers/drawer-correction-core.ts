/**
 * src/lib/registers/drawer-correction-core.ts  (owner D125 / D126 / D127)
 *
 * Three guards that came out of the first real day on the new shift-end
 * flow (2026-11-01). SR2's evening drawer was closed on the iPad at $0.00
 * by mistake, the office second count found $2,678.10, and the drawer was
 * reconciled against the $0.00 anyway (-$2,778.00 instead of -$99.90).
 * Owner, verbatim: "Thank you. Please build 1-3 now."
 *
 *   D125  A $0.00 close must be confirmed. A drawer can really be empty
 *         (every dollar was dropped to the safe), so $0.00 is allowed, but
 *         only when the closer ticks "The drawer is really empty". The
 *         server refuses a $0.00 close without that tick.
 *   D126  Hold at reconcile when the two counts differ by more than $5.00.
 *         The manager chooses which count the drawer is reconciled on: the
 *         closer's, the second count, or a fresh recount they type, and
 *         writes why. Two equal counts (including two $0.00 counts) are not
 *         held.
 *   D127  Correct a reconciled drawer. Owner/admin only. The counted cash is
 *         replaced by the second count or a typed figure, over/short is
 *         worked out again against the stored expected figure, a written
 *         reason is required, and the old and new figures are kept in the
 *         drawer's notes and the audit log. Refused once the drawer is in a
 *         sealed deposit bag or already has a ledger entry (the books are
 *         not touched by a correction).
 *
 * Pure: no I/O. Money is whole cents.
 */

import { OVER_SHORT_WARN_MINOR, OVER_SHORT_REASON_MAX_LEN, overShortWords } from "@/lib/registers/over-short-warning-core";

// ---------------------------------------------------------------------------
// D125: confirm a $0.00 close
// ---------------------------------------------------------------------------

export const ZERO_CLOSE_CONFIRM_ERROR =
  "The count is $0.00. If the drawer really is empty (all the cash was dropped to the safe), tick " +
  "\u201cThe drawer is really empty\u201d and close again. Otherwise enter the bills and coins you counted. " +
  "Nothing was saved.";

/** A form/JSON flag is true only when it was deliberately set. */
export function parseConfirmFlag(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === "string") return ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
  return false;
}

export type ZeroCloseCheck = { ok: true; confirmedEmpty: boolean } | { ok: false; error: string };

/** A count above $0.00 always passes; $0.00 passes only when confirmed. */
export function checkZeroClose(countedMinor: number, confirmEmpty: unknown): ZeroCloseCheck {
  if (!Number.isFinite(countedMinor) || countedMinor > 0) return { ok: true, confirmedEmpty: false };
  if (parseConfirmFlag(confirmEmpty)) return { ok: true, confirmedEmpty: true };
  return { ok: false, error: ZERO_CLOSE_CONFIRM_ERROR };
}

// ---------------------------------------------------------------------------
// D126: hold at reconcile, choose the count
// ---------------------------------------------------------------------------

/** The two counts may differ by up to $5.00 (the same line as D7) before the drawer is held. */
export const COUNT_GAP_HOLD_MINOR = OVER_SHORT_WARN_MINOR;

export type CountBasis = "closer" | "second" | "recount";

function money(minor: number): string {
  const abs = Math.abs(Math.round(minor));
  return `${minor < 0 ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** True when both counts exist and differ by MORE than $5.00. */
export function countBasisNeeded(closingMinor: number | null | undefined, secondMinor: number | null | undefined): boolean {
  if (closingMinor == null || secondMinor == null) return false;
  if (!Number.isFinite(closingMinor) || !Number.isFinite(secondMinor)) return false;
  return Math.abs(secondMinor - closingMinor) > COUNT_GAP_HOLD_MINOR;
}

/** "$12.34" as typed -> cents. Blank, negative, junk or more than 2 decimals -> null. */
export function parseCountDollars(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim().replace(/[$,\s]/g, "") : typeof raw === "number" ? String(raw) : "";
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > 100_000_000) return null;
  return minor;
}

function cleanReason(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

export type CountBasisResult =
  | { ok: true; basis: CountBasis; countedMinor: number; reason: string; note: string }
  | { ok: false; error: string };

/**
 * The manager's choice when the counts are more than $5.00 apart.
 * `recountRaw` is the typed dollars for "recount".
 */
export function resolveCountBasis(input: {
  closingMinor: number;
  secondMinor: number;
  basis: unknown;
  recountRaw?: unknown;
  reason: unknown;
}): CountBasisResult {
  const gap = input.secondMinor - input.closingMinor;
  const basis = String(input.basis ?? "").trim();
  if (basis !== "closer" && basis !== "second" && basis !== "recount") {
    return {
      ok: false,
      error:
        `The closer counted ${money(input.closingMinor)} and the second count is ${money(input.secondMinor)} ` +
        `(${money(Math.abs(gap))} apart, more than $5.00). Choose which count to reconcile on and write why. Nothing was saved.`,
    };
  }
  const reason = cleanReason(input.reason);
  if (reason === "") {
    return { ok: false, error: "Write why you chose that count (for example: \u201cthe closer entered $0 by mistake\u201d). Nothing was saved." };
  }
  if (reason.length > OVER_SHORT_REASON_MAX_LEN) {
    return { ok: false, error: `The reason must be ${OVER_SHORT_REASON_MAX_LEN} characters or fewer.` };
  }
  let countedMinor: number;
  if (basis === "closer") countedMinor = input.closingMinor;
  else if (basis === "second") countedMinor = input.secondMinor;
  else {
    const typed = parseCountDollars(input.recountRaw);
    if (typed === null) return { ok: false, error: "Type the recount in dollars and cents (for example 2678.10). Nothing was saved." };
    countedMinor = typed;
  }
  const label = basis === "closer" ? "the closer's count" : basis === "second" ? "the second count" : "a manager recount";
  const note =
    `Counts differed by ${money(Math.abs(gap))} (closer ${money(input.closingMinor)}, second ${money(input.secondMinor)}). ` +
    `Reconciled on ${label}: ${money(countedMinor)}. Reason: ${reason}`;
  return { ok: true, basis, countedMinor, reason, note };
}

// ---------------------------------------------------------------------------
// D127: correct a reconciled drawer
// ---------------------------------------------------------------------------

export type CorrectionBasis = "second" | "typed";

export type CorrectionCheck =
  | {
      ok: true;
      newCountMinor: number;
      oldOverShortMinor: number;
      newOverShortMinor: number;
      reason: string;
    }
  | { ok: false; error: string };

export function checkCorrection(input: {
  status: string;
  currentCountMinor: number | null;
  expectedMinor: number | null;
  secondMinor: number | null;
  basis: unknown;
  typedRaw?: unknown;
  reason: unknown;
  /** True when the drawer is in a sealed deposit bag. */
  sealed: boolean;
  /** True when a ledger entry already stands for this drawer. */
  journalExists: boolean;
}): CorrectionCheck {
  if (input.status !== "reconciled") {
    return { ok: false, error: "Only a reconciled drawer can be corrected. Reconcile it first. Nothing was changed." };
  }
  if (input.sealed) {
    return { ok: false, error: "This drawer's cash is in a sealed deposit bag, so its count can no longer be corrected here. Nothing was changed." };
  }
  if (input.journalExists) {
    return {
      ok: false,
      error: "This drawer already has an entry in the books. A correction would make the books disagree, so it is refused. Nothing was changed.",
    };
  }
  if (input.expectedMinor == null || input.currentCountMinor == null) {
    return { ok: false, error: "This drawer is missing its expected or counted figure, so it cannot be corrected. Nothing was changed." };
  }
  const basis = String(input.basis ?? "").trim();
  let newCountMinor: number;
  if (basis === "second") {
    if (input.secondMinor == null) return { ok: false, error: "This drawer has no second count to use. Type the correct count instead. Nothing was changed." };
    newCountMinor = input.secondMinor;
  } else if (basis === "typed") {
    const typed = parseCountDollars(input.typedRaw);
    if (typed === null) return { ok: false, error: "Type the correct count in dollars and cents (for example 2678.10). Nothing was changed." };
    newCountMinor = typed;
  } else {
    return { ok: false, error: "Choose the count to use: the second count, or type the correct count. Nothing was changed." };
  }
  if (newCountMinor === input.currentCountMinor) {
    return { ok: false, error: `The drawer is already reconciled on ${money(newCountMinor)}. Nothing was changed.` };
  }
  const reason = cleanReason(input.reason);
  if (reason === "") return { ok: false, error: "Write the reason for the correction. Nothing was changed." };
  if (reason.length > OVER_SHORT_REASON_MAX_LEN) {
    return { ok: false, error: `The reason must be ${OVER_SHORT_REASON_MAX_LEN} characters or fewer.` };
  }
  return {
    ok: true,
    newCountMinor,
    oldOverShortMinor: input.currentCountMinor - input.expectedMinor,
    newOverShortMinor: newCountMinor - input.expectedMinor,
    reason,
  };
}

/** The line appended to the drawer's notes (who, when, from, to, why). */
export function correctionNote(input: {
  whenLabel: string;
  who: string;
  oldCountMinor: number;
  newCountMinor: number;
  oldOverShortMinor: number;
  newOverShortMinor: number;
  reason: string;
}): string {
  return (
    `Corrected ${input.whenLabel} by ${input.who}: counted cash ${money(input.oldCountMinor)} -> ${money(input.newCountMinor)}; ` +
    `${overShortWords(input.oldOverShortMinor).toLowerCase()} -> ${overShortWords(input.newOverShortMinor).toLowerCase()}. ` +
    `Reason: ${input.reason}`
  );
}

/** Append a line to existing notes (newest last). */
export function appendNote(existing: string | null | undefined, line: string): string {
  const prev = (existing ?? "").trim();
  return prev ? `${prev}\n${line}` : line;
}

/** The over/short reason after a correction, kept within the 500-character column check. */
export function correctedReason(oldReason: string | null | undefined, reason: string): string {
  const next = `Corrected: ${reason}${oldReason ? ` (was: ${oldReason})` : ""}`;
  return next.length <= OVER_SHORT_REASON_MAX_LEN ? next : `${next.slice(0, OVER_SHORT_REASON_MAX_LEN - 1)}\u2026`;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDrawerCorrectionCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`drawer-correction-core FAIL: ${msg}`);
    }
  };

  // D125
  ok(checkZeroClose(100, undefined).ok, "a count above $0 needs no confirm");
  const z = checkZeroClose(0, undefined);
  ok(!z.ok && z.error === ZERO_CLOSE_CONFIRM_ERROR, "a $0 close without the tick is refused");
  ok(!checkZeroClose(0, false).ok, "confirm false is refused");
  ok(!checkZeroClose(0, "no").ok, "confirm 'no' is refused");
  const zc = checkZeroClose(0, true);
  ok(zc.ok && zc.confirmedEmpty, "a $0 close with the tick passes and is marked confirmed");
  ok(checkZeroClose(0, "on").ok, "a ticked form checkbox ('on') passes");
  ok(parseConfirmFlag("1") && parseConfirmFlag("TRUE") && !parseConfirmFlag("") && !parseConfirmFlag(1), "flag parsing is strict");
  const pos = checkZeroClose(5, true);
  ok(pos.ok && !pos.confirmedEmpty, "a non-zero count is never marked 'confirmed empty'");

  // D126: when to hold
  ok(!countBasisNeeded(1000, 1500), "exactly $5.00 apart is not held");
  ok(countBasisNeeded(1000, 1501), "$5.01 apart is held");
  ok(countBasisNeeded(0, 267810), "the SR2 case ($0 vs $2,678.10) is held");
  ok(!countBasisNeeded(0, 0), "two $0 counts (all cash dropped) are not held");
  ok(!countBasisNeeded(222000, 222000), "two equal counts are not held");
  ok(!countBasisNeeded(null, 100) && !countBasisNeeded(100, null), "a missing count is not a hold (the second-count gate handles it)");
  ok(countBasisNeeded(5000, 0), "second lower by more than $5 is held too");

  // parseCountDollars
  ok(parseCountDollars("2678.10") === 267810, "2678.10 -> 267810");
  ok(parseCountDollars("$2,678.1") === 267810, "$2,678.1 -> 267810");
  ok(parseCountDollars("0") === 0, "0 is a real count");
  ok(parseCountDollars("") === null && parseCountDollars("-5") === null && parseCountDollars("1.234") === null && parseCountDollars("abc") === null,
    "blank, negative, 3 decimals and junk are refused");

  // resolveCountBasis
  const nb = resolveCountBasis({ closingMinor: 0, secondMinor: 267810, basis: "", reason: "x" });
  ok(!nb.ok && /\$0\.00/.test(nb.error) && /\$2,678\.10/.test(nb.error), "no choice -> refused, both counts in plain words");
  ok(!resolveCountBasis({ closingMinor: 0, secondMinor: 267810, basis: "second", reason: "  " }).ok, "blank reason refused");
  ok(!resolveCountBasis({ closingMinor: 0, secondMinor: 267810, basis: "second", reason: "x".repeat(501) }).ok, "over-long reason refused");
  const s = resolveCountBasis({ closingMinor: 0, secondMinor: 267810, basis: "second", reason: "closer entered $0 by mistake" });
  ok(s.ok && s.countedMinor === 267810 && s.basis === "second", "second -> the second count is used");
  ok(s.ok && /closer \$0\.00, second \$2,678\.10/.test(s.note) && /the second count: \$2,678\.10/.test(s.note), "note names both counts and the one used");
  const c = resolveCountBasis({ closingMinor: 10000, secondMinor: 9000, basis: "closer", reason: "second counter miscounted" });
  ok(c.ok && c.countedMinor === 10000, "closer -> the closer's count is used");
  const r = resolveCountBasis({ closingMinor: 10000, secondMinor: 9000, basis: "recount", recountRaw: "95.50", reason: "recounted it myself" });
  ok(r.ok && r.countedMinor === 9550 && /manager recount: \$95\.50/.test(r.note), "recount -> the typed figure is used");
  ok(!resolveCountBasis({ closingMinor: 10000, secondMinor: 9000, basis: "recount", recountRaw: "", reason: "x" }).ok, "recount without a figure refused");

  // D127: checkCorrection
  const base = {
    status: "reconciled",
    currentCountMinor: 0,
    expectedMinor: 277800,
    secondMinor: 267810,
    basis: "second",
    reason: "closer entered $0 by mistake; Alyssa's second count is right",
    sealed: false,
    journalExists: false,
  };
  const fix = checkCorrection(base);
  ok(fix.ok && fix.newCountMinor === 267810 && fix.newOverShortMinor === -9990 && fix.oldOverShortMinor === -277800,
    "SR2: $0 -> $2,678.10 turns short $2,778.00 into short $99.90");
  ok(!checkCorrection({ ...base, status: "closed" }).ok, "a drawer not yet reconciled cannot be corrected");
  ok(!checkCorrection({ ...base, sealed: true }).ok, "a drawer in a sealed bag cannot be corrected");
  ok(!checkCorrection({ ...base, journalExists: true }).ok, "a drawer with a ledger entry cannot be corrected");
  ok(!checkCorrection({ ...base, expectedMinor: null }).ok, "no expected figure -> refused");
  ok(!checkCorrection({ ...base, reason: "" }).ok, "blank reason refused");
  ok(!checkCorrection({ ...base, basis: "" }).ok, "no basis refused");
  ok(!checkCorrection({ ...base, secondMinor: null }).ok, "'use second count' without a second count refused");
  const typed = checkCorrection({ ...base, basis: "typed", typedRaw: "2700" });
  ok(typed.ok && typed.newCountMinor === 270000 && typed.newOverShortMinor === -7800, "typed count is used");
  ok(!checkCorrection({ ...base, basis: "typed", typedRaw: "x" }).ok, "typed junk refused");
  ok(!checkCorrection({ ...base, currentCountMinor: 267810 }).ok, "correcting to the same figure is refused");

  // notes and reason
  const note = correctionNote({ whenLabel: "Nov 2, 9:00 AM", who: "owner@x", oldCountMinor: 0, newCountMinor: 267810, oldOverShortMinor: -277800, newOverShortMinor: -9990, reason: "r" });
  ok(/\$0\.00 -> \$2,678\.10/.test(note) && /short by \$2,778\.00 -> short by \$99\.90/.test(note) && /by owner@x/.test(note), "the note carries from, to, who");
  ok(appendNote(null, "a") === "a" && appendNote("x", "a") === "x\na", "notes are appended, never replaced");
  ok(correctedReason("not sure", "fixed") === "Corrected: fixed (was: not sure)", "the old reason is kept");
  ok(correctedReason("y".repeat(400), "z".repeat(300)).length === OVER_SHORT_REASON_MAX_LEN, "the reason stays within 500 characters");

  return { passed, failed };
}
