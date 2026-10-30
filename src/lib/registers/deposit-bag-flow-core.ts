/**
 * src/lib/registers/deposit-bag-flow-core.ts  (Fix Phase 2.6 · G-04 · owner D23–D27)
 *
 * The rules of the deposit bag screen, as pure functions. No I/O, no clock.
 * Money is integer cents.
 *
 * THE OWNER'S FLOW (original request, and SOP-03 §4.5–4.13):
 *   night count -> morning recount -> seal the bag -> safe -> bank.
 *
 * THE OWNER'S RULES (verbatim, docs/sop-program/00-OWNER-REQUEST-VERBATIM.md L81):
 *   D23 "Q-03-3- yes, that is correct"   counted cash sits UNSEALED in the
 *                                        store safe overnight
 *   D24 "no second count at night, just the recount in the morning by any
 *        employee"                       one person at night; the morning
 *                                        recount is the second count, by a
 *                                        DIFFERENT person
 *   D25 "anyone can seal the bag, I am the only one to take cash to the bank"
 *   D26 "yes I plan on using tamper evident pre-numbered bags"
 *   D27 "Q-03-7- warning only please"    an undeclared bag WARNS, never blocks
 *   D21 "Q-03-1- only over $5"           a reason is required only over $5
 *
 * HOW THE FLOW MAPS ONTO THE 0212 LIFECYCLE (safe-bag-core.ts):
 *   night count saved            available -> undeclared   ("pull")
 *     The closer has put the cash in a bag, but nobody else has counted it,
 *     so the money is not yet the safe's. That is exactly what "undeclared"
 *     means in safe-bag-core.
 *   morning recount agrees       undeclared -> counted     ("declare")
 *     (or differs by more than $5 and a reason is written)
 *   sealed                       counted -> deposited      ("seal")
 *     Sealing posts 10400 Undeposited Funds <- 10100 Vault. The sealed bag
 *     goes back into the safe; "deposited" means committed to a deposit.
 *   owner takes it to the bank   stays deposited; banked_on is filled
 *   "return" is not used: tamper-evident bags are cut open at the bank and
 *   are not reused (D26).
 */
import { applyBagAction, checkDepositShape, normaliseBagNo, validateBagAmount, type BagStatus, type StructuringNotice } from "@/lib/accounting/safe-bag-core";
import { checkOverShortReason, isOverShortWarning, overShortWords, type ReasonCheck } from "@/lib/registers/over-short-warning-core";
import { formatCents } from "@/lib/registers/cash";

/** PIN throttle scope for the bag screen (separate from the till close pad). */
export const DEPOSIT_BAG_PIN_SCOPE = "backoffice-deposit-bag";

/** Longest bag number kept (0316 deposit_bags_text_lengths). */
export const BAG_NO_MAX_LEN = 60;
/** Longest note kept (0316). */
export const BAG_NOTE_MAX_LEN = 500;

export type Ok<T> = { ok: true } & T;
export type Refused = { ok: false; error: string };

// ---------------------------------------------------------------------------
// Business day
// ---------------------------------------------------------------------------

/**
 * A real calendar day in YYYY-MM-DD, or a plain refusal. Used by the bag
 * screen and by the end-of-day sheet (F-03-8: a bad ?day= used to show today
 * silently). Empty input means "use the fallback" (today).
 */
export function parseBusinessDay(
  raw: string | null | undefined,
  fallback: string,
): { ok: true; day: string } | { ok: false; error: string } {
  const t = (raw ?? "").trim();
  if (t === "") return { ok: true, day: fallback };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return { ok: false, error: `"${t}" is not a date. Use the date picker, or write it as YYYY-MM-DD (for example 2026-11-02).` };
  }
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: `${t} is not a real calendar day.` };
  }
  return { ok: true, day: t };
}

// ---------------------------------------------------------------------------
// Expected deposit: drops + Σ (closing count − opening float)  (SOP-03 §4.1)
// ---------------------------------------------------------------------------

export type ExpectedSessionInput = {
  id: string;
  registerName: string;
  status: string;
  openingMinor: number | null;
  closingMinor: number | null;
};

export type ExpectedSessionLine = {
  sessionId: string;
  registerName: string;
  floatMinor: number;
  closingMinor: number;
  takingsMinor: number;
  dropsMinor: number;
  /** takings + drops: what this drawer put into the bag. */
  toBagMinor: number;
};

export type ExpectedDeposit = {
  /** NULL when it cannot be worked out honestly (see `problems`). */
  expectedMinor: number | null;
  lines: ExpectedSessionLine[];
  totalTakingsMinor: number;
  totalDropsMinor: number;
  problems: string[];
  sessionCount: number;
};

/**
 * The deposit the drawers say should be in the bag. The float is the drawer's
 * own counted opening float, the same figure the books use when they post the
 * close (drawer-posting-service.ts, floatStaysInDrawer: true), so this sheet
 * and the books cannot disagree about what "takings" means.
 *
 * Rule 135: missing is a question, not zero. An open drawer, a missing count
 * or a close below the float makes the expected figure NULL, with the reason.
 */
export function expectedDeposit(
  sessions: readonly ExpectedSessionInput[],
  drops: readonly { sessionId: string; amountMinor: number }[],
): ExpectedDeposit {
  const problems: string[] = [];
  const lines: ExpectedSessionLine[] = [];
  const dropsBy = new Map<string, number>();
  for (const d of drops) dropsBy.set(d.sessionId, (dropsBy.get(d.sessionId) ?? 0) + d.amountMinor);
  let takings = 0;
  let dropsTotal = 0;
  for (const s of sessions) {
    const dropsMinor = dropsBy.get(s.id) ?? 0;
    if (s.status === "open") {
      problems.push(`${s.registerName} is still open. Close every drawer first (SOP-03 §4.3).`);
      dropsTotal += dropsMinor;
      continue;
    }
    if (s.openingMinor === null || s.closingMinor === null) {
      problems.push(`${s.registerName} has no ${s.openingMinor === null ? "opening float" : "closing count"} recorded.`);
      dropsTotal += dropsMinor;
      continue;
    }
    const t = s.closingMinor - s.openingMinor;
    if (t < 0) {
      problems.push(
        `${s.registerName} closed at ${formatCents(s.closingMinor)}, less than its ${formatCents(s.openingMinor)} float. ` +
          "Nothing comes out of that drawer; a manager must look at it (SOP-03 §4.1).",
      );
    }
    const take = Math.max(0, t);
    takings += take;
    dropsTotal += dropsMinor;
    lines.push({
      sessionId: s.id,
      registerName: s.registerName,
      floatMinor: s.openingMinor,
      closingMinor: s.closingMinor,
      takingsMinor: take,
      dropsMinor,
      toBagMinor: take + dropsMinor,
    });
  }
  return {
    expectedMinor: problems.length === 0 ? takings + dropsTotal : null,
    lines,
    totalTakingsMinor: takings,
    totalDropsMinor: dropsTotal,
    problems,
    sessionCount: sessions.length,
  };
}

// ---------------------------------------------------------------------------
// Night count (one person, D24)
// ---------------------------------------------------------------------------

export function cleanNote(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return t === "" ? null : t;
}

export function checkNightCount(input: {
  bagNo: string | null | undefined;
  countMinor: number;
  closerId: string | null | undefined;
  /** A bag already recorded for this business day (one day, one bag). */
  existingBagNoForDay: string | null;
  note: unknown;
}): Ok<{ bagNo: string; note: string | null }> | Refused {
  const bagNo = normaliseBagNo(input.bagNo);
  if (bagNo === null) {
    return { ok: false, error: "Write the number printed on the deposit bag (D26: pre-numbered bags). Nothing was saved." };
  }
  if (bagNo.length > BAG_NO_MAX_LEN) return { ok: false, error: `The bag number must be ${BAG_NO_MAX_LEN} characters or fewer.` };
  if (!input.closerId) return { ok: false, error: "Enter the PIN of the employee who counted the deposit. Nothing was saved." };
  if (input.existingBagNoForDay !== null) {
    return {
      ok: false,
      error:
        `Bag ${input.existingBagNoForDay} is already recorded for this business day. One day, one bag (SOP-03 §4.14). ` +
        "If one day needs two bags, write both numbers in one record (for example 1041 + 1042). Nothing was saved.",
    };
  }
  const bad = validateBagAmount(input.countMinor);
  if (bad) return { ok: false, error: `${bad.message} Nothing was saved.` };
  const note = cleanNote(input.note);
  if (note && note.length > BAG_NOTE_MAX_LEN) return { ok: false, error: `The note must be ${BAG_NOTE_MAX_LEN} characters or fewer.` };
  const pull = applyBagAction("available", "pull");
  if (!pull.ok) return { ok: false, error: pull.message };
  return { ok: true, bagNo, note };
}

/** Night count against what the drawers say. Warning only: the closer writes what they checked. */
export function nightVsExpected(nightMinor: number, expectedMinor: number | null): { diffMinor: number | null; sentence: string } {
  if (expectedMinor === null) return { diffMinor: null, sentence: "Expected could not be worked out (see the reasons above)." };
  const diff = nightMinor - expectedMinor;
  if (diff === 0) return { diffMinor: 0, sentence: "The night count matches what the drawers say." };
  return {
    diffMinor: diff,
    sentence: `The night count is ${overShortWords(diff).toLowerCase()} against what the drawers say (${formatCents(expectedMinor)}). Do not fix it from other cash (SOP-03 §4.1); write what you checked.`,
  };
}

// ---------------------------------------------------------------------------
// Morning recount (a DIFFERENT employee, D24)
// ---------------------------------------------------------------------------

export const RECOUNT_SAME_PERSON_ERROR =
  "The morning recount must be done by a different employee from the one who counted last night (owner rule D24). Nothing was saved.";

export function checkMorningRecount(input: {
  status: BagStatus;
  sealed: boolean;
  nightCounterId: string | null;
  recounterId: string | null | undefined;
  countMinor: number;
}): Ok<Record<never, never>> | Refused {
  if (input.sealed) return { ok: false, error: "This bag is already sealed. A sealed bag cannot be recounted in the app; tell the owner (SOP-03 §6)." };
  if (input.status !== "undeclared" && input.status !== "counted") {
    return { ok: false, error: `This bag is "${input.status}", so it cannot be recounted.` };
  }
  if (!input.recounterId) return { ok: false, error: "Enter the PIN of the employee doing the morning recount. Nothing was saved." };
  if (input.nightCounterId && input.nightCounterId === input.recounterId) return { ok: false, error: RECOUNT_SAME_PERSON_ERROR };
  const bad = validateBagAmount(input.countMinor);
  if (bad) return { ok: false, error: `${bad.message} Nothing was saved.` };
  return { ok: true };
}

export type NightMorningCompare = {
  diffMinor: number;
  /** More than $5.00 either way (D7, D21): a reason is required before the seal. */
  needsReason: boolean;
  sentence: string;
};

/** Morning minus night. Positive = the morning found more. */
export function compareNightMorning(nightMinor: number, morningMinor: number): NightMorningCompare {
  const diff = morningMinor - nightMinor;
  const needsReason = isOverShortWarning(diff);
  let sentence: string;
  if (diff === 0) sentence = "The morning recount agrees with the night count.";
  else
    sentence =
      `The morning recount is ${formatCents(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than last night's count ` +
      `(${formatCents(nightMinor)} at night, ${formatCents(morningMinor)} this morning). Both counts are kept.`;
  return { diffMinor: diff, needsReason, sentence };
}

/** The status the bag moves to after a recount (declare only when it agrees or a reason is written). */
export function statusAfterRecount(cmp: NightMorningCompare, reason: string | null): BagStatus {
  if (!cmp.needsReason || (reason !== null && reason !== "")) {
    const d = applyBagAction("undeclared", "declare");
    return d.ok ? d.to : "undeclared";
  }
  return "undeclared";
}

/** The reason for a night/morning difference (D7 style, required only over $5, D21). */
export function checkRecountReason(diffMinor: number, raw: unknown): ReasonCheck {
  return checkOverShortReason(diffMinor, raw, "The morning recount");
}

// ---------------------------------------------------------------------------
// Seal (anyone, D25)
// ---------------------------------------------------------------------------

export type SealableBag = {
  bagNo: string;
  status: BagStatus;
  sealedAt: string | null;
  nightCountMinor: number | null;
  nightCountedBy: string | null;
  morningCountMinor: number | null;
  morningCountedBy: string | null;
  varianceReason: string | null;
};

export function checkSeal(
  bag: SealableBag,
  input: { bagNo: string | null | undefined; sealerId: string | null | undefined },
): Ok<{ bagNo: string; amountMinor: number }> | Refused {
  if (bag.sealedAt !== null) return { ok: false, error: `Bag ${bag.bagNo} is already sealed. Nothing was written twice.` };
  if (bag.morningCountMinor === null || bag.morningCountedBy === null) {
    return { ok: false, error: "The morning recount comes first (SOP-03 §4.10). The bag cannot be sealed until a different employee has recounted it." };
  }
  if (bag.nightCountMinor !== null) {
    const cmp = compareNightMorning(bag.nightCountMinor, bag.morningCountMinor);
    if (cmp.needsReason && !bag.varianceReason) {
      return { ok: false, error: `${cmp.sentence} Do not seal. Recount with the manager, then recount again or write the reason first (SOP-03 §4.10).` };
    }
  }
  const seal = applyBagAction(bag.status, "seal");
  if (!seal.ok) return { ok: false, error: seal.message };
  if (!input.sealerId) return { ok: false, error: "Enter the PIN of the employee sealing the bag. Nothing was saved." };
  const bagNo = normaliseBagNo(input.bagNo) ?? bag.bagNo;
  if (bagNo.length > BAG_NO_MAX_LEN) return { ok: false, error: `The bag number must be ${BAG_NO_MAX_LEN} characters or fewer.` };
  const bad = validateBagAmount(bag.morningCountMinor);
  if (bad) return { ok: false, error: bad.message };
  return { ok: true, bagNo, amountMinor: bag.morningCountMinor };
}

/** The books entry's source ref: one entry per bag, ever (idempotent). */
export function sealSourceRef(bagId: string): string {
  return `seal-bag:${bagId}`;
}

// ---------------------------------------------------------------------------
// Stages, the safe, the $10,000 shape (F-03-10), the D27 warning
// ---------------------------------------------------------------------------

export type BagRow = {
  id: string;
  bagNo: string;
  businessDay: string;
  status: BagStatus;
  amountMinor: number | null;
  nightCountMinor: number | null;
  nightCountedBy: string | null;
  nightCountedAt: string | null;
  expectedMinor: number | null;
  nightNote: string | null;
  morningCountMinor: number | null;
  morningCountedBy: string | null;
  morningCountedAt: string | null;
  varianceReason: string | null;
  sealedAt: string | null;
  sealedBy: string | null;
  sealJournalId: string | null;
  bankedOn: string | null;
  bankedBy: string | null;
  bankNote: string | null;
  depositConfirmedOn: string | null;
  /** Fix Phase 6 (D82): night total saved as assembled and verified (no night denominations). Only set by the list reads. */
  nightAssembled?: boolean;
};

export type BagStage = "night_counted" | "needs_reason" | "ready_to_seal" | "sealed_in_safe" | "banked" | "other";

export function bagStage(b: BagRow): BagStage {
  if (b.bankedOn) return "banked";
  if (b.sealedAt) return "sealed_in_safe";
  if (b.status === "counted") return "ready_to_seal";
  if (b.status === "undeclared") {
    if (b.morningCountMinor !== null && b.nightCountMinor !== null && compareNightMorning(b.nightCountMinor, b.morningCountMinor).needsReason && !b.varianceReason) {
      return "needs_reason";
    }
    return "night_counted";
  }
  return "other";
}

export const STAGE_LABEL: Record<BagStage, string> = {
  night_counted: "Waiting for the morning recount",
  needs_reason: "Counts differ: do not seal",
  ready_to_seal: "Recounted: ready to seal",
  sealed_in_safe: "Sealed: in the safe for the bank",
  banked: "Taken to the bank",
  other: "Not in the flow",
};

/** The cash a bag stands for right now: the morning count, else the night count. */
export function bagCashMinor(b: Pick<BagRow, "amountMinor" | "morningCountMinor" | "nightCountMinor">): number {
  return b.amountMinor ?? b.morningCountMinor ?? b.nightCountMinor ?? 0;
}

/** Deposit cash still in the store safe: every bag not yet taken to the bank, except `excludeIds`. */
export function depositCashInSafeMinor(bags: readonly BagRow[], excludeIds: readonly string[] = []): number {
  const skip = new Set(excludeIds);
  return bags.filter((b) => !b.bankedOn && !skip.has(b.id) && b.status !== "available").reduce((s, b) => s + bagCashMinor(b), 0);
}

/**
 * The $10,000 shape check (F-03-10), at seal and at the bank: this deposit
 * against the deposit cash left behind in the safe. A mirror, never a block
 * (safe-bag-core.ts L262–328).
 */
export function depositShapeNotice(depositMinor: number, leftInSafeMinor: number): StructuringNotice | null {
  return checkDepositShape(depositMinor, leftInSafeMinor);
}

/**
 * Owner-only bank record (D25): which bags, which day.
 */
export function checkBankRecord(
  bags: readonly BagRow[],
  selectedIds: readonly string[],
  bankedOn: string,
  note: unknown,
): Ok<{ bags: BagRow[]; totalMinor: number; note: string | null }> | Refused {
  if (selectedIds.length === 0) return { ok: false, error: "Tick the sealed bags you took to the bank. Nothing was saved." };
  const byId = new Map(bags.map((b) => [b.id, b]));
  const chosen: BagRow[] = [];
  for (const id of selectedIds) {
    const b = byId.get(id);
    if (!b) return { ok: false, error: "A ticked bag could not be found. Reload the page. Nothing was saved." };
    if (!b.sealedAt) return { ok: false, error: `Bag ${b.bagNo} is not sealed. Only sealed bags go to the bank (SOP-03 §4.13). Nothing was saved.` };
    if (b.bankedOn) return { ok: false, error: `Bag ${b.bagNo} is already recorded as taken to the bank on ${b.bankedOn}. Nothing was saved.` };
    chosen.push(b);
  }
  const day = parseBusinessDay(bankedOn, "");
  if (!day.ok || day.day === "") return { ok: false, error: "Pick the day you took the bags to the bank. Nothing was saved." };
  for (const b of chosen) {
    if (day.day < b.businessDay) return { ok: false, error: `Bag ${b.bagNo} is for ${b.businessDay}; it cannot have gone to the bank on ${day.day}. Nothing was saved.` };
  }
  const n = cleanNote(note);
  if (n && n.length > BAG_NOTE_MAX_LEN) return { ok: false, error: `The note must be ${BAG_NOTE_MAX_LEN} characters or fewer.` };
  return { ok: true, bags: chosen, totalMinor: chosen.reduce((s, b) => s + bagCashMinor(b), 0), note: n };
}

/** Sealed bags not ticked for this bank run (SOP-03 §4.14: take ALL sealed bags). */
export function sealedLeftBehind(bags: readonly BagRow[], selectedIds: readonly string[]): BagRow[] {
  const s = new Set(selectedIds);
  return bags.filter((b) => b.sealedAt && !b.bankedOn && !s.has(b.id));
}

/**
 * SOP-03 §4.10 step 2: the morning employee counts "Without looking at part
 * A's figures". So the bag screen shows the night count to the morning
 * recounter only AFTER the recount is saved. Before that, the screen shows
 * the bag number, the day and who counted, never the amount. (The owner and
 * managers still see it on the printable log, which is a separate page.)
 */
export function showNightFigure(b: Pick<BagRow, "morningCountMinor" | "sealedAt" | "bankedOn">): boolean {
  return b.morningCountMinor !== null || b.sealedAt !== null || b.bankedOn !== null;
}

// ---------------------------------------------------------------------------
// The bag log (print and CSV, G-04 requirement 7)
// ---------------------------------------------------------------------------

export const BAG_LOG_HEADERS = [
  "Business day",
  "Bag #",
  "Stage",
  "Expected (drawers)",
  "Night count",
  "Night counted by",
  "Night counted at",
  "Night note",
  "Morning recount",
  "Recounted by",
  "Recounted at",
  "Night vs morning",
  "Reason",
  "Sealed amount",
  "Sealed by",
  "Sealed at",
  "Books entry",
  "To bank (date)",
  "Banked by",
  "Bank note",
  "Bank confirmed",
] as const;

function cents(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2);
}

export function csvCell(v: string): string {
  // A cell that starts with = + - @ is a formula in a spreadsheet: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function bagLogRow(b: BagRow, nameOf: (id: string | null) => string, bankerOf: (id: string | null) => string): string[] {
  const diff = b.nightCountMinor !== null && b.morningCountMinor !== null ? b.morningCountMinor - b.nightCountMinor : null;
  return [
    b.businessDay,
    b.bagNo,
    STAGE_LABEL[bagStage(b)],
    cents(b.expectedMinor),
    cents(b.nightCountMinor),
    nameOf(b.nightCountedBy),
    b.nightCountedAt ?? "",
    b.nightNote ?? "",
    cents(b.morningCountMinor),
    nameOf(b.morningCountedBy),
    b.morningCountedAt ?? "",
    cents(diff),
    b.varianceReason ?? "",
    cents(b.sealedAt ? b.amountMinor : null),
    nameOf(b.sealedBy),
    b.sealedAt ?? "",
    b.sealJournalId ? "posted" : b.sealedAt ? "NOT POSTED" : "",
    b.bankedOn ?? "",
    bankerOf(b.bankedBy),
    b.bankNote ?? "",
    b.depositConfirmedOn ?? "",
  ];
}

export function bagLogCsv(rows: readonly string[][]): string {
  return [BAG_LOG_HEADERS as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDepositBagFlowTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`deposit-bag-flow-core FAIL: ${m}`);
    }
  };

  // business day
  ok(parseBusinessDay("", "2026-11-02").ok, "blank day uses fallback");
  const pd = parseBusinessDay("2026-11-03", "x");
  ok(pd.ok && pd.day === "2026-11-03", "real day accepted");
  ok(!parseBusinessDay("2026-02-30", "x").ok, "Feb 30 refused");
  ok(!parseBusinessDay("11/02/2026", "x").ok, "wrong shape refused");
  ok(!parseBusinessDay("2026-13-01", "x").ok, "month 13 refused");

  // expected deposit: SOP-03 §4.1 worked example (script-checked there): $1,648.15
  const ex = expectedDeposit(
    [
      { id: "s1", registerName: "Sales Register 1", status: "reconciled", openingMinor: 16750, closingMinor: 61240 },
      { id: "s2", registerName: "Sales Register 2", status: "closed", openingMinor: 16750, closingMinor: 39815 },
      { id: "s3", registerName: "Manager Till", status: "verified", openingMinor: 30000, closingMinor: 52260 },
    ],
    [
      { sessionId: "s1", amountMinor: 25000 },
      { sessionId: "s1", amountMinor: 25000 },
      { sessionId: "s2", amountMinor: 25000 },
    ],
  );
  ok(ex.expectedMinor === 164815, "SOP-03 §4.1 worked example = $1,648.15");
  ok(ex.totalTakingsMinor === 89815 && ex.totalDropsMinor === 75000, "takings $898.15 + drops $750.00");
  ok(ex.lines[0].toBagMinor === 94490, "Register 1 to the bag $944.90");
  const open = expectedDeposit([{ id: "o", registerName: "R1", status: "open", openingMinor: 16750, closingMinor: null }], []);
  ok(open.expectedMinor === null && open.problems[0].includes("still open"), "an open drawer makes expected unknown");
  const below = expectedDeposit([{ id: "b", registerName: "R2", status: "closed", openingMinor: 16750, closingMinor: 10000 }], []);
  ok(below.expectedMinor === null && below.problems[0].includes("less than"), "a close below float is a problem, not a negative");
  const none = expectedDeposit([], []);
  ok(none.expectedMinor === 0 && none.sessionCount === 0, "no drawers: expected is a real zero");
  const missing = expectedDeposit([{ id: "m", registerName: "R3", status: "closed", openingMinor: null, closingMinor: 100 }], []);
  ok(missing.expectedMinor === null, "missing float is a question, not zero");

  // night count
  const n1 = checkNightCount({ bagNo: " 1041 ", countMinor: 164815, closerId: "a", existingBagNoForDay: null, note: "" });
  ok(n1.ok && n1.bagNo === "1041" && n1.note === null, "night count accepted, bag no trimmed");
  ok(!checkNightCount({ bagNo: "  ", countMinor: 1, closerId: "a", existingBagNoForDay: null, note: "" }).ok, "no bag number refused");
  ok(!checkNightCount({ bagNo: "1", countMinor: 0, closerId: "a", existingBagNoForDay: null, note: "" }).ok, "zero count refused");
  ok(!checkNightCount({ bagNo: "1", countMinor: 1, closerId: "", existingBagNoForDay: null, note: "" }).ok, "no closer refused");
  const dup = checkNightCount({ bagNo: "2", countMinor: 1, closerId: "a", existingBagNoForDay: "1041", note: "" });
  ok(!dup.ok && dup.error.includes("One day, one bag"), "second bag for the same day refused");
  ok(!checkNightCount({ bagNo: "x".repeat(61), countMinor: 1, closerId: "a", existingBagNoForDay: null, note: "" }).ok, "long bag no refused");
  ok(nightVsExpected(100, 100).diffMinor === 0, "night equals expected");
  ok(nightVsExpected(90, 100).sentence.includes("short by $0.10"), "night short sentence");
  ok(nightVsExpected(90, null).diffMinor === null, "no expected: no diff");

  // morning recount
  const same = checkMorningRecount({ status: "undeclared", sealed: false, nightCounterId: "a", recounterId: "a", countMinor: 1 });
  ok(!same.ok && same.error === RECOUNT_SAME_PERSON_ERROR, "D24: same person refused");
  ok(checkMorningRecount({ status: "undeclared", sealed: false, nightCounterId: "a", recounterId: "b", countMinor: 1 }).ok, "different person accepted");
  ok(checkMorningRecount({ status: "counted", sealed: false, nightCounterId: "a", recounterId: "b", countMinor: 1 }).ok, "a recount can be redone before the seal");
  ok(!checkMorningRecount({ status: "deposited", sealed: true, nightCounterId: "a", recounterId: "b", countMinor: 1 }).ok, "sealed bag cannot be recounted");
  ok(!checkMorningRecount({ status: "undeclared", sealed: false, nightCounterId: "a", recounterId: "", countMinor: 1 }).ok, "no recounter refused");
  ok(!checkMorningRecount({ status: "undeclared", sealed: false, nightCounterId: "a", recounterId: "b", countMinor: -1 }).ok, "negative recount refused");

  const agree = compareNightMorning(164815, 164815);
  ok(agree.diffMinor === 0 && !agree.needsReason, "agreeing counts need no reason");
  ok(statusAfterRecount(agree, null) === "counted", "agreeing recount declares the bag");
  const five = compareNightMorning(10000, 10500);
  ok(!five.needsReason, "exactly $5.00 needs no reason (D21: only over $5)");
  const six = compareNightMorning(10000, 9399);
  ok(six.needsReason && six.diffMinor === -601, "$6.01 less needs a reason");
  ok(six.sentence.includes("$6.01 less"), "sentence names the amount and direction");
  ok(statusAfterRecount(six, null) === "undeclared", "a big difference with no reason stays undeclared");
  ok(statusAfterRecount(six, "counted together, a $5 was stuck") === "counted", "with a reason it is declared");
  ok(!checkRecountReason(-601, "").ok, "reason required over $5");
  ok(checkRecountReason(-500, "").ok, "reason optional at $5");

  // seal
  const base: SealableBag = {
    bagNo: "1041",
    status: "counted",
    sealedAt: null,
    nightCountMinor: 164815,
    nightCountedBy: "a",
    morningCountMinor: 164815,
    morningCountedBy: "b",
    varianceReason: null,
  };
  const s1 = checkSeal(base, { bagNo: "", sealerId: "a" });
  ok(s1.ok && s1.bagNo === "1041" && s1.amountMinor === 164815, "D25: anyone (even the night counter) may seal; amount = morning count");
  const s2 = checkSeal(base, { bagNo: " 1050 ", sealerId: "c" });
  ok(s2.ok && s2.bagNo === "1050", "a new bag number at seal is taken (SOP-03 §4.11 step 2)");
  ok(!checkSeal({ ...base, sealedAt: "t" }, { bagNo: "", sealerId: "c" }).ok, "cannot seal twice");
  ok(!checkSeal({ ...base, morningCountMinor: null, morningCountedBy: null, status: "undeclared" }, { bagNo: "", sealerId: "c" }).ok, "no recount: no seal");
  const diffNoReason = checkSeal({ ...base, morningCountMinor: 150000, status: "undeclared" }, { bagNo: "", sealerId: "c" });
  ok(!diffNoReason.ok && diffNoReason.error.includes("Do not seal"), "a big difference without a reason cannot be sealed");
  ok(checkSeal({ ...base, morningCountMinor: 150000, varianceReason: "r" }, { bagNo: "", sealerId: "c" }).ok, "with the reason it can");
  ok(!checkSeal(base, { bagNo: "", sealerId: "" }).ok, "no sealer refused");
  ok(sealSourceRef("abc") === "seal-bag:abc", "source ref matches the census promise");

  // stages and the safe
  const row = (p: Partial<BagRow>): BagRow => ({
    id: "x", bagNo: "1", businessDay: "2026-11-02", status: "undeclared", amountMinor: null,
    nightCountMinor: 1000, nightCountedBy: "a", nightCountedAt: null, expectedMinor: null, nightNote: null,
    morningCountMinor: null, morningCountedBy: null, morningCountedAt: null, varianceReason: null,
    sealedAt: null, sealedBy: null, sealJournalId: null, bankedOn: null, bankedBy: null, bankNote: null, depositConfirmedOn: null,
    ...p,
  });
  ok(bagStage(row({})) === "night_counted", "stage: night counted");
  ok(bagStage(row({ morningCountMinor: 2000 })) === "needs_reason", "stage: needs reason");
  ok(bagStage(row({ status: "counted", morningCountMinor: 1000 })) === "ready_to_seal", "stage: ready");
  ok(bagStage(row({ status: "deposited", sealedAt: "t", amountMinor: 1000 })) === "sealed_in_safe", "stage: sealed");
  ok(bagStage(row({ status: "deposited", sealedAt: "t", bankedOn: "2026-11-04" })) === "banked", "stage: banked");
  const bags = [
    row({ id: "a", status: "deposited", sealedAt: "t", amountMinor: 600000, morningCountMinor: 600000 }),
    row({ id: "b", status: "deposited", sealedAt: "t", amountMinor: 700000, morningCountMinor: 700000 }),
    row({ id: "c", status: "undeclared", nightCountMinor: 50000 }),
    row({ id: "d", status: "deposited", sealedAt: "t", amountMinor: 9, bankedOn: "2026-11-01" }),
  ];
  ok(depositCashInSafeMinor(bags) === 1350000, "safe holds every unbanked bag");
  ok(depositCashInSafeMinor(bags, ["a"]) === 750000, "minus the excluded bag");
  ok(depositShapeNotice(600000, 750000) === null, "under $10k left behind: no notice");
  ok(depositShapeNotice(900000, 1300000) !== null, "deposit under $10k with > $10k left: notice");
  ok(depositShapeNotice(1000000, 2000000) === null, "a deposit AT the line is not under it");

  // bank record (owner)
  const br = checkBankRecord(bags, ["a", "b"], "2026-11-04", " ");
  ok(br.ok && br.totalMinor === 1300000 && br.note === null, "owner records two sealed bags");
  ok(!checkBankRecord(bags, [], "2026-11-04", "").ok, "nothing ticked refused");
  ok(!checkBankRecord(bags, ["c"], "2026-11-04", "").ok, "unsealed bag refused");
  ok(!checkBankRecord(bags, ["d"], "2026-11-04", "").ok, "already banked refused");
  ok(!checkBankRecord(bags, ["a"], "2026-11-01", "").ok, "banked before its business day refused");
  ok(!checkBankRecord(bags, ["a"], "bad", "").ok, "bad bank date refused");
  ok(sealedLeftBehind(bags, ["a"]).map((b) => b.id).join() === "b", "sealed bags left behind are named");

  // CSV
  ok(csvCell("=1+1") === "'=1+1", "formula neutralised");
  ok(csvCell('a,"b"') === '"a,""b"""', "quotes doubled");
  const line = bagLogRow(row({ status: "deposited", sealedAt: "t", amountMinor: 1000, morningCountMinor: 1000, sealJournalId: null }), () => "N", () => "O");
  ok(line.length === BAG_LOG_HEADERS.length, "row has every column");
  ok(line[16] === "NOT POSTED", "an unposted seal says so");
  ok(bagLogCsv([line]).split("\r\n")[0].startsWith("Business day,Bag #"), "csv header first");

  // blind morning recount (SOP-03 §4.10 step 2)
  ok(!showNightFigure({ morningCountMinor: null, sealedAt: null, bankedOn: null }), "night figure hidden before the recount");
  ok(showNightFigure({ morningCountMinor: 100, sealedAt: null, bankedOn: null }), "night figure shown after the recount");
  ok(showNightFigure({ morningCountMinor: null, sealedAt: "t", bankedOn: null }), "night figure shown once sealed");

  return { passed, failed };
}
