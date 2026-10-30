/**
 * src/lib/registers/shift-end-core.ts  (Fix Phase 6 · Fix E · G-61 … G-65)
 *
 * PURE rules for the shift-end and end-of-day cash flow the owner chose in
 * his answers to the strategy paper (00-OWNER-REQUEST-VERBATIM.md, owner
 * message 8, decisions D81–D90). Zero I/O; every function here is checked
 * by __runShiftEndCoreTests (scripts/compliance/run-pure-selftests.ts).
 *
 *   1. Clock-out guard (D84, Q-E-6 "Block"): an employee who still owns an
 *      OPEN drawer cannot clock out. Closing the drawer does NOT clock them
 *      out ("I don't want to clock out on the register change out step").
 *   2. Float check at count-in (D85, Q-E-7 "Warn please"): a count-in that is
 *      not the register's standard float warns, never blocks.
 *   3. Crew tip pool (D89, Q-E-10): the crew's pooled tips are split evenly
 *      at shift change; each cashier's own share is what goes on their own
 *      close (drawer_sessions.tips_minor). Whole cents only; the odd cents
 *      that cannot be split stay in the jar for the next pool.
 *   4. Night deposit "assembled and verified" (D82, Q-E-4): at night the
 *      closer assembles each till's stack and checks it against the screen;
 *      no denomination count. The morning blind recount is unchanged.
 *   5. Reconcile timing (D87, Q-E-8, the professional call): either manager
 *      may reconcile; the window closes when the bag is sealed. The seal
 *      warns about unreconciled drawers in the bag and the EOD report says
 *      "awaiting reconcile" until every drawer is reconciled.
 */
import { formatCents } from "@/lib/registers/cash";

// ---------------------------------------------------------------------------
// 1. Clock-out guard (D84)
// ---------------------------------------------------------------------------

/** An open drawer session this employee counted in (drawer_sessions.opened_by). */
export type OwnedDrawer = { sessionId: string; registerName: string };

/** Words shown when a clock-out is refused. Kept here so every path says the same thing. */
export function clockOutBlockedMessage(owned: readonly OwnedDrawer[]): string | null {
  if (owned.length === 0) return null;
  const names = [...new Set(owned.map((o) => o.registerName || "a register"))];
  const where = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    `You still have an open drawer on ${where}. Close your drawer first (blind count and second count), ` +
    "then clock out. Closing the drawer does not clock you out (owner rule D84)."
  );
}

/**
 * Should this punch be refused? Only a clock-OUT is ever refused, and only
 * while the employee owns an open drawer. A clock-in is never refused here,
 * and a manager's timesheet edit is not a punch at the till.
 */
export function clockOutBlocked(input: {
  isClockOut: boolean;
  source: string;
  owned: readonly OwnedDrawer[];
}): { blocked: false } | { blocked: true; message: string } {
  if (!input.isClockOut || input.source === "manager_edit") return { blocked: false };
  const message = clockOutBlockedMessage(input.owned);
  return message ? { blocked: true, message } : { blocked: false };
}

// ---------------------------------------------------------------------------
// 2. Float check at count-in (D85)
// ---------------------------------------------------------------------------

export type FloatCheck = {
  state: "match" | "over" | "short" | "unknown";
  /** counted − standard, cents. 0 when it matches or the standard is unknown. */
  diffMinor: number;
  /** One sentence for the screen. Empty when it matches. */
  sentence: string;
};

/**
 * Compare a count-in with the register's standard float
 * (registers.default_float_minor). A warning only: the count-in is saved
 * either way, because the counted figure IS the float the drawer is
 * measured against at close (a wrong standard must not stop the store).
 */
export function floatCheck(countedMinor: number, standardMinor: number | null | undefined): FloatCheck {
  if (!Number.isInteger(standardMinor) || (standardMinor as number) <= 0) {
    return { state: "unknown", diffMinor: 0, sentence: "" };
  }
  const std = standardMinor as number;
  const diff = countedMinor - std;
  if (diff === 0) return { state: "match", diffMinor: 0, sentence: "" };
  const over = diff > 0;
  return {
    state: over ? "over" : "short",
    diffMinor: diff,
    sentence:
      `This count-in is ${formatCents(Math.abs(diff))} ${over ? "over" : "short of"} the standard float of ${formatCents(std)} ` +
      `(counted ${formatCents(countedMinor)}). Count it again. If it is right, you can still open: the drawer is ` +
      "measured against what you counted, and a manager sees this warning.",
  };
}

// ---------------------------------------------------------------------------
// 3. Crew tip pool (D89)
// ---------------------------------------------------------------------------

/** The most people one crew pool is ever split between. */
export const MAX_TIP_POOL_PEOPLE = 10;
/** Two cashiers per shift (owner Q-E-1), so the form starts at 2. */
export const DEFAULT_TIP_POOL_PEOPLE = 2;

export type TipPoolSplit = {
  ok: true;
  poolMinor: number;
  people: number;
  /** Each person's share, whole cents. */
  shareMinor: number;
  /** Cents that cannot be split evenly (fewer than `people`). They stay in the jar for the next pool. */
  leftoverMinor: number;
};

/**
 * Split the crew's pooled tips evenly. Integer cents only: each share is the
 * pool divided by the people, rounded DOWN, and the odd cents (always fewer
 * than the number of people) stay in the jar. That way every person in the
 * crew records exactly the same share no matter who closes first, and the
 * shares never add up to more than the pool.
 */
export function splitTipPool(poolMinor: number, people: number): TipPoolSplit | { ok: false; error: string } {
  if (!Number.isInteger(poolMinor) || poolMinor < 0) {
    return { ok: false, error: "The crew tip pool must be zero or more, in dollars and cents." };
  }
  if (!Number.isInteger(people) || people < 1 || people > MAX_TIP_POOL_PEOPLE) {
    return { ok: false, error: `The number of people sharing the tips must be between 1 and ${MAX_TIP_POOL_PEOPLE}.` };
  }
  const shareMinor = Math.floor(poolMinor / people);
  return { ok: true, poolMinor, people, shareMinor, leftoverMinor: poolMinor - shareMinor * people };
}

/** One sentence describing a split, for the close screen and the till summary. */
export function tipPoolSentence(split: TipPoolSplit): string {
  const base =
    split.people === 1
      ? `Crew tip pool ${formatCents(split.poolMinor)}, not shared: your tips are ${formatCents(split.shareMinor)}.`
      : `Crew tip pool ${formatCents(split.poolMinor)} split evenly between ${split.people}: your share is ${formatCents(split.shareMinor)}.`;
  return split.leftoverMinor > 0
    ? `${base} ${formatCents(split.leftoverMinor)} cannot be split evenly; leave it in the jar for the next pool.`
    : base;
}

// ---------------------------------------------------------------------------
// 4. Night deposit, assembled and verified (D82)
// ---------------------------------------------------------------------------

export type AssembleLine = { sessionId: string; registerName: string; toBagMinor: number };

export type AssembleCheck =
  | { ok: true; countMinor: number; confirmed: string[] }
  | { ok: false; error: string };

/**
 * The closer confirms each till's stack against the screen's line. Every
 * line with money for the bag must be ticked; nothing else is accepted. The
 * bag's night figure is then the sum of those lines (the expected deposit),
 * which the morning blind recount checks independently (D24 unchanged).
 *
 * Refused when the expected deposit cannot be worked out (an open drawer, a
 * missing count): then the closer counts the bag by denomination instead.
 */
export function checkAssembledDeposit(input: {
  expectedMinor: number | null;
  problems: readonly string[];
  lines: readonly AssembleLine[];
  confirmedIds: readonly string[];
}): AssembleCheck {
  if (input.expectedMinor === null || input.problems.length > 0) {
    return {
      ok: false,
      error:
        "The screen cannot work out the expected deposit yet, so there is nothing to check the stacks against. " +
        `${input.problems.join(" ")} Fix that first, or count the bag by denomination instead. Nothing was saved.`.trim(),
    };
  }
  const due = input.lines.filter((l) => l.toBagMinor > 0);
  if (due.length === 0) {
    return { ok: false, error: "No till has money for the bag, so there is nothing to assemble. Nothing was saved." };
  }
  const ticked = new Set(input.confirmedIds);
  const missing = due.filter((l) => !ticked.has(l.sessionId));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `Tick every till once its stack matches the screen. Not ticked: ${missing.map((l) => `${l.registerName} (${formatCents(l.toBagMinor)})`).join(", ")}. ` +
        "If a stack does not match, do not change it: count the bag by denomination instead and write what you found. Nothing was saved.",
    };
  }
  const stray = input.confirmedIds.filter((id) => !due.some((l) => l.sessionId === id));
  if (stray.length > 0) {
    return { ok: false, error: "The screen changed while you were checking (a till was closed or reopened). Reload the page and check again. Nothing was saved." };
  }
  const countMinor = due.reduce((s, l) => s + l.toBagMinor, 0);
  if (countMinor !== input.expectedMinor) {
    return { ok: false, error: "The till lines do not add up to the expected deposit. Reload the page and check again. Nothing was saved." };
  }
  return { ok: true, countMinor, confirmed: due.map((l) => l.sessionId) };
}

/** How the night figure was made. A bag with no night denominations was assembled (D82). */
export function nightMethod(b: { nightCountMinor: number | null; nightDenoms: unknown }): "counted" | "assembled" | "none" {
  if (b.nightCountMinor === null) return "none";
  return b.nightDenoms === null || b.nightDenoms === undefined ? "assembled" : "counted";
}

// ---------------------------------------------------------------------------
// 5. Reconcile timing (D87)
// ---------------------------------------------------------------------------

export type BagDrawer = { sessionId: string; registerName: string; status: string };

/** Drawers in the bag that no manager has reconciled yet. */
export function unreconciledInBag(drawers: readonly BagDrawer[]): BagDrawer[] {
  return drawers.filter((d) => d.status === "open" || d.status === "closed");
}

/** The seal warning (never a block, D87): which drawers still need a manager's reconcile. */
export function sealReconcileWarning(drawers: readonly BagDrawer[]): string | null {
  const left = unreconciledInBag(drawers);
  if (left.length === 0) return null;
  return (
    `Warning: ${left.length} drawer${left.length === 1 ? "" : "s"} in this bag ${left.length === 1 ? "has" : "have"} not been reconciled yet ` +
    `(${left.map((d) => d.registerName).join(", ")}). The bag is sealed; a manager reconciles ${left.length === 1 ? "it" : "them"} on Register Activity ` +
    "today (SOP-03 §4.11). The owner sees this on the audit log."
  );
}

/** The EOD banner: open drawers first, then reconcile, then final. */
export function eodStatus(input: { final: boolean; sessionCount: number; awaitingReconcile: number }): {
  state: "preliminary" | "awaiting_reconcile" | "final";
  label: string;
} {
  if (!input.final) return { state: "preliminary", label: "Preliminary — a drawer is still open" };
  if (input.awaitingReconcile > 0) {
    return {
      state: "awaiting_reconcile",
      label: `Closed — ${input.awaitingReconcile} drawer${input.awaitingReconcile === 1 ? "" : "s"} awaiting manager reconcile`,
    };
  }
  return { state: "final", label: "Final — all drawers closed and reconciled" };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runShiftEndCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ shift-end-core: ${label}`);
    }
  };

  // 1. clock-out guard
  const r1 = [{ sessionId: "s1", registerName: "Sales Register 1" }];
  ok(clockOutBlockedMessage([]) === null, "no open drawer: no message");
  ok((clockOutBlockedMessage(r1) ?? "").includes("Sales Register 1"), "message names the register");
  ok((clockOutBlockedMessage(r1) ?? "").includes("does not clock you out"), "message says closing does not clock out");
  ok(
    (clockOutBlockedMessage([...r1, { sessionId: "s2", registerName: "Sales Register 2" }]) ?? "").includes("Sales Register 1 and Sales Register 2"),
    "two registers joined with and",
  );
  ok(clockOutBlocked({ isClockOut: true, source: "register", owned: r1 }).blocked, "clock-out with an open drawer is blocked");
  ok(!clockOutBlocked({ isClockOut: false, source: "register", owned: r1 }).blocked, "clock-in is never blocked");
  ok(!clockOutBlocked({ isClockOut: true, source: "station", owned: [] }).blocked, "clock-out with no drawer is allowed");
  ok(!clockOutBlocked({ isClockOut: true, source: "manager_edit", owned: r1 }).blocked, "manager timesheet edit is not blocked");
  ok(clockOutBlocked({ isClockOut: true, source: "phone", owned: r1 }).blocked, "phone clock-out is blocked too");

  // 2. float check
  ok(floatCheck(16750, 16750).state === "match", "standard float matches");
  ok(floatCheck(16750, 16750).sentence === "", "match: no sentence");
  const short = floatCheck(16500, 16750);
  ok(short.state === "short" && short.diffMinor === -250, "short by $2.50");
  ok(short.sentence.includes("$2.50 short of the standard float of $167.50"), "short sentence");
  const over = floatCheck(30100, 30000);
  ok(over.state === "over" && over.diffMinor === 100 && over.sentence.includes("$1.00 over"), "over by $1.00");
  ok(floatCheck(100, null).state === "unknown", "no standard: unknown, no warning");
  ok(floatCheck(100, 0).state === "unknown", "zero standard: unknown");

  // 3. tip pool
  const even = splitTipPool(8500, 2);
  ok(even.ok && even.shareMinor === 4250 && even.leftoverMinor === 0, "$85.00 / 2 = $42.50 each");
  const odd = splitTipPool(4251, 2);
  ok(odd.ok && odd.shareMinor === 2125 && odd.leftoverMinor === 1, "$42.51 / 2 = $21.25 each, 1 cent stays");
  const three = splitTipPool(10000, 3);
  ok(three.ok && three.shareMinor === 3333 && three.leftoverMinor === 1, "$100 / 3 = $33.33 each, 1 cent stays");
  ok(three.ok && three.shareMinor * 3 + three.leftoverMinor === 10000, "shares + leftover = pool");
  const zero = splitTipPool(0, 2);
  ok(zero.ok && zero.shareMinor === 0, "empty jar: $0 each");
  ok(splitTipPool(5000, 1).ok && (splitTipPool(5000, 1) as TipPoolSplit).shareMinor === 5000, "one person keeps it all");
  ok(!splitTipPool(-1, 2).ok, "negative pool refused");
  ok(!splitTipPool(10.5, 2).ok, "fractional cents refused");
  ok(!splitTipPool(100, 0).ok, "zero people refused");
  ok(!splitTipPool(100, MAX_TIP_POOL_PEOPLE + 1).ok, "too many people refused");
  ok(!splitTipPool(100, 1.5).ok, "fractional people refused");
  ok(tipPoolSentence(even as TipPoolSplit).includes("your share is $42.50"), "sentence names the share");
  ok(tipPoolSentence(odd as TipPoolSplit).includes("$0.01 cannot be split evenly"), "sentence names the leftover");
  ok(tipPoolSentence(splitTipPool(5000, 1) as TipPoolSplit).includes("not shared"), "one person sentence");

  // 4. assembled deposit
  const lines = [
    { sessionId: "a", registerName: "Register 1", toBagMinor: 50000 },
    { sessionId: "b", registerName: "Register 2", toBagMinor: 30000 },
    { sessionId: "c", registerName: "Register 3", toBagMinor: 0 },
  ];
  const good = checkAssembledDeposit({ expectedMinor: 80000, problems: [], lines, confirmedIds: ["a", "b"] });
  ok(good.ok && good.countMinor === 80000, "all stacks ticked: night figure = expected");
  ok(good.ok && good.confirmed.join() === "a,b", "only lines with money are confirmed");
  const miss = checkAssembledDeposit({ expectedMinor: 80000, problems: [], lines, confirmedIds: ["a"] });
  ok(!miss.ok && miss.error.includes("Register 2"), "an unticked stack is refused and named");
  ok(!checkAssembledDeposit({ expectedMinor: null, problems: ["Register 1 is still open."], lines, confirmedIds: ["a", "b"] }).ok, "no expected: refused");
  ok(!checkAssembledDeposit({ expectedMinor: 80000, problems: [], lines, confirmedIds: ["a", "b", "zz"] }).ok, "a stray till id is refused");
  ok(!checkAssembledDeposit({ expectedMinor: 1, problems: [], lines, confirmedIds: ["a", "b"] }).ok, "lines not adding up is refused");
  ok(!checkAssembledDeposit({ expectedMinor: 0, problems: [], lines: [lines[2]], confirmedIds: [] }).ok, "nothing for the bag: refused");
  ok(nightMethod({ nightCountMinor: 100, nightDenoms: null }) === "assembled", "no denominations = assembled");
  ok(nightMethod({ nightCountMinor: 100, nightDenoms: { ones: 1 } }) === "counted", "denominations = counted");
  ok(nightMethod({ nightCountMinor: null, nightDenoms: null }) === "none", "no night figure");

  // 5. reconcile timing
  const bagDrawers = [
    { sessionId: "a", registerName: "Register 1", status: "reconciled" },
    { sessionId: "b", registerName: "Register 2", status: "closed" },
    { sessionId: "c", registerName: "Register 3", status: "verified" },
  ];
  ok(unreconciledInBag(bagDrawers).length === 1, "closed counts as unreconciled; verified does not");
  ok((sealReconcileWarning(bagDrawers) ?? "").includes("Register 2"), "seal warning names the drawer");
  ok(sealReconcileWarning(bagDrawers.filter((d) => d.status !== "closed")) === null, "all reconciled: no warning");
  ok(eodStatus({ final: false, sessionCount: 2, awaitingReconcile: 0 }).state === "preliminary", "open drawer: preliminary");
  ok(eodStatus({ final: true, sessionCount: 2, awaitingReconcile: 1 }).label.includes("1 drawer awaiting"), "closed, one awaiting reconcile");
  ok(eodStatus({ final: true, sessionCount: 2, awaitingReconcile: 0 }).state === "final", "all reconciled: final");

  return { passed, failed };
}
