/**
 * src/lib/registers/deposit-bag-atm-pull-core.ts   (D198e - $20s out of the deposit bag for the ATM)
 *
 * The owner asked (verbatim, D198e):
 *
 *   "I need a way for the morning employees to exclude 20s from the daily deposit for use in the atm.
 *    This should be an option while building the deposit bag, so it can reconcile what was taken out,
 *    by who, and then the daily sync will match the money to the cash loaded into the machine. There
 *    should be a small current cash in atm card on the deposit bag page that acts like a button, when
 *    pressed, it updates the card to show the current amount, so they know how much, if any is needed
 *    from that days deposit bag. ... Same level of scrutiny, thinking about the fraud triangle as this
 *    is a highly vulnerable cash handling activity."
 *
 * PURE: no server imports, unit tested by __runDepositBagAtmPullTests (run-pure-selftests.ts).
 *
 * What lives here (every money decision, so none of it hides in a page or an action):
 *   1. parseBagAtmPull     - the pull typed while building the bag: a NUMBER of $20 bills (never
 *                            dollars), within the owner's per-drop cap, leaving money in the bag, a
 *                            witness who is a different person, and the review flags the server
 *                            raises at that moment (the fraud triangle's "opportunity" leg).
 *   2. bagTotalAfterPull   - the bag holds the expected deposit MINUS the pull. The bag's expected
 *                            figure, the morning blind recount and the end-of-day sheet all use it.
 *   3. atmCashNeed         - the "current cash in ATM" card: how many $20s, if any, the ATM needs to
 *                            reach the owner's fill-to level, from a reading that says how old it is.
 *   4. pullPattern         - the same person pulling day after day, alone (pressure / rationalization
 *                            legs; the match page carries the load side).
 *   5. bagPullDrop         - the pull as a till-style ATM drop, so /admin/atm/drops matches it to the
 *                            PAI cash load exactly like a till drop (the daily sync brings the loads).
 */

/** The ATM holds $20 bills only (same constant as atm-drop-core; repeated so this file stays leaf-pure). */
export const BAG_PULL_BILL_MINOR = 2000;
/** The hard ceiling the database also enforces (0347 CHECK): 2,500 bills = $50,000. */
export const BAG_PULL_MAX_TWENTIES = 2500;
/** A PAI reading older than this is not "fresh" for deciding how much the ATM needs. */
export const ATM_READING_FRESH_MINUTES = 30;
/** The card may hit PAI at most this often; a press inside the window shows the last reading. */
export const ATM_REFRESH_MIN_SECONDS = 60;
/** A pull above this share of the day's deposit is flagged for the owner (never refused). */
export const MOST_OF_DEPOSIT_PCT = 50;
export const BAG_PULL_REASON_MAX_LEN = 500;

export type BagPullFlag =
  /** Nobody else typed a PIN to watch the $20s come out. */
  | "NO_WITNESS"
  /** No PAI reading of the ATM in the last 30 minutes: nobody knew how much the machine needed. */
  | "NO_FRESH_READING"
  /** More $20s than the ATM needed to reach the owner's fill-to level, per the reading. */
  | "OVER_NEED"
  /** The ATM was already at or above the fill-to level and $20s were still taken. */
  | "ATM_ALREADY_FULL"
  /** More than half of the day's deposit went to the ATM. */
  | "MOST_OF_DEPOSIT";

export const BAG_PULL_FLAG_TEXT: Record<BagPullFlag, string> = {
  NO_WITNESS: "No witness typed a PIN.",
  NO_FRESH_READING: "Nobody refreshed the ATM's cash in the last 30 minutes.",
  OVER_NEED: "More $20s than the ATM needed to reach its fill-to level.",
  ATM_ALREADY_FULL: "The ATM was already at its fill-to level.",
  MOST_OF_DEPOSIT: "More than half of the day's deposit went to the ATM.",
};

/** Flags that need the builder's written reason before the bag is saved (D21 style: write it, then go). */
const NEEDS_REASON: ReadonlySet<BagPullFlag> = new Set<BagPullFlag>(["NO_FRESH_READING", "OVER_NEED", "ATM_ALREADY_FULL"]);

export type AtmReading = { balanceCents: number | null; capturedAt: string | null };

export type BagAtmPull = {
  twenties: number;
  amountMinor: number;
  terminalId: string;
  pulledBy: string;
  witnessedBy: string | null;
  flags: BagPullFlag[];
  reason: string | null;
  balanceSeenCents: number | null;
  balanceSeenAt: string | null;
};

export type BagPullParse =
  | { ok: true; pull: null }
  | { ok: true; pull: BagAtmPull }
  | { ok: false; error: string; code: "BAD_COUNT" | "OVER_CAP" | "EMPTIES_BAG" | "NO_EXPECTED" | "WITNESS_SAME" | "WITNESS_REQUIRED" | "REASON_REQUIRED" | "BAD_TERMINAL" };

function money(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  return `${neg ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Minutes between two ISO instants (b - a), or null if either is unreadable. */
export function minutesBetween(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 60000;
}

/** True when the reading has a balance and was captured within ATM_READING_FRESH_MINUTES of now (and not in the future by more than 5 min). */
export function isFreshReading(r: AtmReading | null, nowIso: string): boolean {
  if (!r || r.balanceCents === null || !Number.isFinite(r.balanceCents)) return false;
  const age = minutesBetween(r.capturedAt, nowIso);
  return age !== null && age >= -5 && age <= ATM_READING_FRESH_MINUTES;
}

export type AtmNeed =
  | { kind: "no_reading"; sentence: string }
  | { kind: "no_target"; balanceCents: number; sentence: string }
  | { kind: "full"; balanceCents: number; fillToCents: number; sentence: string }
  | { kind: "needs"; balanceCents: number; fillToCents: number; twenties: number; amountMinor: number; sentence: string };

/**
 * How many $20s the ATM needs to reach the owner's fill-to level. Rounded DOWN to whole bills (never
 * over the target). With no fill-to level set, the card only shows the cash - it never invents a need.
 */
export function atmCashNeed(balanceCents: number | null, fillToCents: number | null): AtmNeed {
  if (balanceCents === null || !Number.isFinite(balanceCents)) {
    return { kind: "no_reading", sentence: "No reading yet. Press the card to ask PAI how much cash is in the ATM." };
  }
  const bal = Math.max(0, Math.trunc(balanceCents));
  if (fillToCents === null || !Number.isFinite(fillToCents) || fillToCents <= 0) {
    return { kind: "no_target", balanceCents: bal, sentence: "The owner has not set a fill-to level, so the screen cannot say how much is needed." };
  }
  const gap = Math.trunc(fillToCents) - bal;
  const twenties = gap > 0 ? Math.floor(gap / BAG_PULL_BILL_MINOR) : 0;
  if (twenties <= 0) {
    return { kind: "full", balanceCents: bal, fillToCents: Math.trunc(fillToCents), sentence: `The ATM is at its fill-to level (${money(fillToCents)}). No $20s are needed from the bag.` };
  }
  const amountMinor = twenties * BAG_PULL_BILL_MINOR;
  return {
    kind: "needs",
    balanceCents: bal,
    fillToCents: Math.trunc(fillToCents),
    twenties,
    amountMinor,
    sentence: `Up to ${twenties} x $20 (${money(amountMinor)}) brings the ATM to its fill-to level of ${money(fillToCents)}.`,
  };
}

/**
 * Validate the ATM pull typed while building the bag. The SERVER calls this with the expected deposit
 * it worked out itself, the reading it read itself and the people behind the PINs it checked itself;
 * nothing the browser says about money is trusted.
 */
export function parseBagAtmPull(input: {
  /** The "Take $20s out for the ATM" box was ticked. */
  wanted: boolean;
  twentiesText: string;
  /** The owner's per-drop cap (AtmDropSettings.maxTwentiesPerDrop). */
  maxTwenties: number;
  /** What the drawers say the deposit is BEFORE the pull (null = cannot be worked out). */
  expectedDepositMinor: number | null;
  terminalId: string;
  builderId: string;
  witnessId: string | null;
  witnessPolicy: "required" | "recommended" | "off";
  reading: AtmReading | null;
  fillToCents: number | null;
  reason: string;
  nowIso: string;
  /**
   * D198i: $20s already taken for the ATM (bag pulls, till ATM drops) AFTER the reading was captured.
   * The reading cannot see them yet; they count as loaded so one stale reading cannot justify two
   * top-offs. Optional: omitted = 0 (the D198e behaviour).
   */
  pendingSinceReadingMinor?: number;
}): BagPullParse {
  const t = String(input.twentiesText ?? "").trim();
  if (!input.wanted) {
    // A count typed without the box ticked is a mistake worth stopping: the person meant to pull.
    if (t !== "" && t !== "0") return { ok: false, code: "BAD_COUNT", error: "You typed a number of $20s but did not tick \u201cTake $20s out for the ATM\u201d. Tick it, or clear the number. Nothing was saved." };
    return { ok: true, pull: null };
  }
  if (!t) return { ok: false, code: "BAD_COUNT", error: "Enter how many $20 bills you are taking out for the ATM. Nothing was saved." };
  if (/[$.,]/.test(t)) return { ok: false, code: "BAD_COUNT", error: "Enter the NUMBER of $20 bills (e.g. 40), not a dollar amount. Nothing was saved." };
  if (!/^\d+$/.test(t)) return { ok: false, code: "BAD_COUNT", error: "Whole $20 bills only: type a number like 40. Nothing was saved." };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false, code: "BAD_COUNT", error: "At least one $20 bill, or untick the ATM box. Nothing was saved." };
  const cap = Math.min(Math.max(1, Math.trunc(Number.isFinite(input.maxTwenties) ? input.maxTwenties : 1)), BAG_PULL_MAX_TWENTIES);
  if (n > cap) return { ok: false, code: "OVER_CAP", error: `That is more than ${cap} bills (${money(cap * BAG_PULL_BILL_MINOR)}), the owner's limit for one ATM load. Check the count. Nothing was saved.` };
  const terminal = String(input.terminalId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(terminal)) return { ok: false, code: "BAD_TERMINAL", error: "The ATM terminal is not set on Admin \u2192 ATM Drops. Nothing was saved." };
  const amountMinor = n * BAG_PULL_BILL_MINOR;
  if (input.expectedDepositMinor === null || !Number.isFinite(input.expectedDepositMinor)) {
    return { ok: false, code: "NO_EXPECTED", error: "The screen cannot work out the day's deposit, so $20s cannot be taken out of it. Build the bag without the ATM pull. Nothing was saved." };
  }
  if (amountMinor >= input.expectedDepositMinor) {
    return {
      ok: false,
      code: "EMPTIES_BAG",
      error: `${n} x $20 (${money(amountMinor)}) is the whole deposit of ${money(input.expectedDepositMinor)} or more. The bag must still hold money for the bank. Nothing was saved.`,
    };
  }
  const witness = input.witnessId && input.witnessId.trim() ? input.witnessId.trim() : null;
  if (witness !== null && witness === input.builderId) {
    return { ok: false, code: "WITNESS_SAME", error: "The witness must be a different employee from the person building the bag. Nothing was saved." };
  }
  if (witness === null && input.witnessPolicy === "required") {
    return { ok: false, code: "WITNESS_REQUIRED", error: "Taking $20s out for the ATM needs a second employee's PIN as witness (owner setting). Nothing was saved." };
  }

  const flags: BagPullFlag[] = [];
  if (witness === null && input.witnessPolicy !== "off") flags.push("NO_WITNESS");
  const fresh = isFreshReading(input.reading, input.nowIso);
  if (!fresh) flags.push("NO_FRESH_READING");
  else {
    const pendingRaw = Number(input.pendingSinceReadingMinor ?? 0);
    const pending = Number.isInteger(pendingRaw) && pendingRaw > 0 ? pendingRaw : 0;
    const need = atmCashNeed((input.reading!.balanceCents as number) + pending, input.fillToCents);
    if (need.kind === "full") flags.push("ATM_ALREADY_FULL");
    else if (need.kind === "needs" && n > need.twenties) flags.push("OVER_NEED");
  }
  if (amountMinor * 100 > input.expectedDepositMinor * MOST_OF_DEPOSIT_PCT) flags.push("MOST_OF_DEPOSIT");

  const reasonRaw = String(input.reason ?? "").replace(/\s+/g, " ").trim();
  const reason = reasonRaw === "" ? null : reasonRaw;
  const asks = flags.filter((f) => NEEDS_REASON.has(f));
  if (asks.length > 0 && (reason === null || reason.length < 3)) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      error: `Write why in \u201cReason for the ATM pull\u201d: ${asks.map((f) => BAG_PULL_FLAG_TEXT[f]).join(" ")} Nothing was saved.`,
    };
  }
  if (reason !== null && reason.length > BAG_PULL_REASON_MAX_LEN) {
    return { ok: false, code: "REASON_REQUIRED", error: `The reason must be ${BAG_PULL_REASON_MAX_LEN} characters or fewer. Nothing was saved.` };
  }
  if (reason !== null && reason.length < 3) {
    return { ok: false, code: "REASON_REQUIRED", error: "Write a few words for the reason, or leave it empty. Nothing was saved." };
  }
  return {
    ok: true,
    pull: {
      twenties: n,
      amountMinor,
      terminalId: terminal.toUpperCase(),
      pulledBy: input.builderId,
      witnessedBy: witness,
      flags,
      reason,
      balanceSeenCents: input.reading && input.reading.balanceCents !== null && Number.isFinite(input.reading.balanceCents) ? Math.max(0, Math.trunc(input.reading.balanceCents)) : null,
      balanceSeenAt: input.reading && input.reading.balanceCents !== null ? input.reading.capturedAt : null,
    },
  };
}

/** What the bag holds after the pull. Null in, null out. Never negative (parseBagAtmPull refuses that first). */
export function bagTotalAfterPull(expectedDepositMinor: number | null, pullMinor: number | null | undefined): number | null {
  if (expectedDepositMinor === null) return null;
  return expectedDepositMinor - (pullMinor ?? 0);
}

/** One line for the bag record / audit / recount screen. */
export function pullSentence(p: { twenties: number; amountMinor: number; terminalId: string }, who: string, witness: string | null): string {
  return `${p.twenties} x $20 (${money(p.amountMinor)}) taken out of the deposit for ATM ${p.terminalId} by ${who}${witness ? `, witnessed by ${witness}` : ", no witness"}.`;
}

export type PullPatternBag = { businessDay: string; atmPulledBy?: string | null; atmPullMinor?: number | null; atmPullWitnessedBy?: string | null };

/**
 * The same person pulling $20s out of the deposit again and again, mostly alone. A pattern to read,
 * never an accusation: returned as plain sentences for the owner, keyed by employee id.
 */
export function pullPattern(bags: readonly PullPatternBag[], opts?: { minPulls?: number }): { employeeId: string; pulls: number; alone: number; totalMinor: number; sentence: string }[] {
  const min = opts?.minPulls ?? 3;
  const by = new Map<string, { pulls: number; alone: number; totalMinor: number }>();
  for (const b of bags) {
    if (!b.atmPulledBy || !b.atmPullMinor) continue;
    const e = by.get(b.atmPulledBy) ?? { pulls: 0, alone: 0, totalMinor: 0 };
    e.pulls += 1;
    if (!b.atmPullWitnessedBy) e.alone += 1;
    e.totalMinor += b.atmPullMinor;
    by.set(b.atmPulledBy, e);
  }
  return [...by.entries()]
    .filter(([, e]) => e.pulls >= min)
    .sort((a, b) => b[1].totalMinor - a[1].totalMinor)
    .map(([employeeId, e]) => ({
      employeeId,
      ...e,
      sentence: `${e.pulls} ATM pulls from the deposit (${money(e.totalMinor)})${e.alone > 0 ? `, ${e.alone} with no witness` : ""}. Check each one matched a cash load on Admin \u2192 ATM Drops.`,
    }));
}

/** The pull as a till-style ATM drop for the owner's match page (the shape atm-drop-match-core reads). */
export function bagPullDrop(b: {
  id: string;
  bagNo: string;
  businessDay: string;
  atmPullTwenties: number;
  atmPullMinor: number;
  atmPulledAt: string;
  atmPullTerminalId: string;
  atmPulledBy: string | null;
  atmPullWitnessedBy: string | null;
  atmPullReason: string | null;
  atmPullFlags: readonly string[];
}, names: (id: string | null) => string | null) {
  const flagText = b.atmPullFlags.length ? ` [flags: ${b.atmPullFlags.join(", ")}]` : "";
  return {
    id: b.id,
    droppedAt: b.atmPulledAt,
    amountCents: b.atmPullMinor,
    twenties: b.atmPullTwenties,
    terminalId: b.atmPullTerminalId,
    registerName: `Deposit bag ${b.bagNo} (${b.businessDay})`,
    employeeId: b.atmPulledBy,
    employeeName: b.atmPulledBy ? (names(b.atmPulledBy) ?? "Former employee") : null,
    witnessId: b.atmPullWitnessedBy,
    witnessName: b.atmPullWitnessedBy ? (names(b.atmPullWitnessedBy) ?? "Former employee") : null,
    recordedVia: "back_office" as const,
    storedAs: "columns" as const,
    notes: `${b.atmPullReason ?? ""}${flagText}`.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDepositBagAtmPullTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`deposit-bag-atm-pull-core FAIL: ${msg}`);
    }
  };
  const now = "2026-11-07T16:00:00.000Z";
  const fresh: AtmReading = { balanceCents: 120000, capturedAt: "2026-11-07T15:50:00.000Z" };
  const stale: AtmReading = { balanceCents: 120000, capturedAt: "2026-11-07T14:00:00.000Z" };
  const base = {
    wanted: true,
    twentiesText: "40",
    maxTwenties: 250,
    expectedDepositMinor: 500000,
    terminalId: "HG26499",
    builderId: "e1",
    witnessId: "e2",
    witnessPolicy: "recommended" as const,
    reading: fresh,
    fillToCents: 300000,
    reason: "",
    nowIso: now,
  };

  // 1. the happy path: 40 x $20 out of a $5,000 deposit, witnessed, fresh reading, under the need
  const p = parseBagAtmPull(base);
  ok(p.ok && p.pull !== null && p.pull.amountMinor === 80000 && p.pull.twenties === 40, "40 x $20 = $800");
  ok(p.ok && p.pull !== null && p.pull.flags.length === 0, "clean pull has no flags");
  ok(p.ok && p.pull !== null && p.pull.balanceSeenCents === 120000 && p.pull.balanceSeenAt === fresh.capturedAt, "reading is kept with the pull");
  ok(p.ok && p.pull !== null && p.pull.terminalId === "HG26499", "terminal kept");
  // 2. no pull
  const none = parseBagAtmPull({ ...base, wanted: false, twentiesText: "" });
  ok(none.ok && none.pull === null, "unticked + empty = no pull");
  ok(!parseBagAtmPull({ ...base, wanted: false, twentiesText: "12" }).ok, "a number without the tick is refused (meant to pull)");
  ok(parseBagAtmPull({ ...base, wanted: false, twentiesText: "0" }).ok, "0 without the tick is fine");
  // 3. $20s only
  for (const bad of ["", "800.00", "$800", "1,000", "-3", "4e1", "abc", "0", "2.5"]) {
    ok(!parseBagAtmPull({ ...base, twentiesText: bad }).ok, `refused "${bad}"`);
  }
  ok(parseBagAtmPull({ ...base, twentiesText: " 007 " }).ok, "leading zeros and spaces ok");
  // 4. caps
  const over = parseBagAtmPull({ ...base, twentiesText: "251" });
  ok(!over.ok && over.code === "OVER_CAP", "owner cap enforced");
  ok(!parseBagAtmPull({ ...base, maxTwenties: 99999, twentiesText: "2501", expectedDepositMinor: 99999999 }).ok, "hard cap 2,500 enforced even if setting is wrong");
  // 5. the bag keeps money for the bank
  const all = parseBagAtmPull({ ...base, twentiesText: "250", expectedDepositMinor: 500000 });
  ok(!all.ok && all.code === "EMPTIES_BAG", "pull equal to the whole deposit refused");
  ok(!parseBagAtmPull({ ...base, twentiesText: "26", expectedDepositMinor: 50000 }).ok, "pull over the deposit refused");
  ok(parseBagAtmPull({ ...base, twentiesText: "24", expectedDepositMinor: 50000, reason: "busy weekend" }).ok, "pull just under the deposit allowed (with flag + reason)");
  const noExp = parseBagAtmPull({ ...base, expectedDepositMinor: null });
  ok(!noExp.ok && noExp.code === "NO_EXPECTED", "no expected deposit = no pull");
  // 6. witness
  const same = parseBagAtmPull({ ...base, witnessId: "e1" });
  ok(!same.ok && same.code === "WITNESS_SAME", "builder cannot witness themselves");
  const req = parseBagAtmPull({ ...base, witnessId: null, witnessPolicy: "required" });
  ok(!req.ok && req.code === "WITNESS_REQUIRED", "required witness enforced");
  const alone = parseBagAtmPull({ ...base, witnessId: null });
  ok(alone.ok && alone.pull !== null && alone.pull.flags.includes("NO_WITNESS") && alone.pull.witnessedBy === null, "recommended: allowed, flagged");
  const off = parseBagAtmPull({ ...base, witnessId: "  " , witnessPolicy: "off" });
  ok(off.ok && off.pull !== null && !off.pull.flags.includes("NO_WITNESS"), "policy off: no flag, blank witness is none");
  // 7. reading freshness + need
  const st = parseBagAtmPull({ ...base, reading: stale });
  ok(!st.ok && st.code === "REASON_REQUIRED", "stale reading needs a reason");
  const stR = parseBagAtmPull({ ...base, reading: stale, reason: "PAI down, counted cassette" });
  ok(stR.ok && stR.pull !== null && stR.pull.flags.includes("NO_FRESH_READING") && stR.pull.reason === "PAI down, counted cassette", "stale + reason saved, flagged");
  ok(!parseBagAtmPull({ ...base, reading: null }).ok, "no reading at all needs a reason");
  ok(!parseBagAtmPull({ ...base, reading: { balanceCents: null, capturedAt: now } }).ok, "reading without a balance is not fresh");
  ok(!parseBagAtmPull({ ...base, reading: { balanceCents: 1000, capturedAt: "2026-11-07T17:00:00.000Z" } }).ok, "a reading from the future is not fresh");
  // fill-to 3,000, balance 1,200 => need 90 x $20
  const need = parseBagAtmPull({ ...base, twentiesText: "90" });
  ok(need.ok && need.pull !== null && need.pull.flags.length === 0, "exactly the need: clean");
  const overNeed = parseBagAtmPull({ ...base, twentiesText: "91" });
  ok(!overNeed.ok && overNeed.code === "REASON_REQUIRED", "over the need asks for a reason");
  const overNeedR = parseBagAtmPull({ ...base, twentiesText: "91", reason: "long weekend coming" });
  ok(overNeedR.ok && overNeedR.pull !== null && overNeedR.pull.flags.includes("OVER_NEED"), "over the need flagged");
  const full = parseBagAtmPull({ ...base, reading: { balanceCents: 300000, capturedAt: fresh.capturedAt }, reason: "x" });
  ok(!full.ok, "a 1-char reason is not a reason");
  const fullR = parseBagAtmPull({ ...base, reading: { balanceCents: 310000, capturedAt: fresh.capturedAt }, reason: "owner asked" });
  ok(fullR.ok && fullR.pull !== null && fullR.pull.flags.includes("ATM_ALREADY_FULL"), "ATM already full flagged");
  // D198i: a pull already taken since the reading counts as loaded (no double top-off from one stale figure)
  const second = parseBagAtmPull({ ...base, twentiesText: "90", pendingSinceReadingMinor: 160000 });
  ok(!second.ok && second.code === "REASON_REQUIRED", "a second top-off from the same reading asks for a reason");
  const bogus = parseBagAtmPull({ ...base, twentiesText: "90", pendingSinceReadingMinor: -5 });
  ok(bogus.ok && bogus.pull !== null && bogus.pull.flags.length === 0, "a bad pending figure is ignored, never invents a flag");
  const noTarget = parseBagAtmPull({ ...base, fillToCents: null, twentiesText: "200", expectedDepositMinor: 900000 });
  ok(noTarget.ok && noTarget.pull !== null && !noTarget.pull.flags.includes("OVER_NEED"), "no fill-to level: no need flag invented");
  // 8. most of the deposit
  const most = parseBagAtmPull({ ...base, fillToCents: null, twentiesText: "126" });
  ok(most.ok && most.pull !== null && most.pull.flags.includes("MOST_OF_DEPOSIT"), "over 50% flagged");
  const half = parseBagAtmPull({ ...base, fillToCents: null, twentiesText: "125" });
  ok(half.ok && half.pull !== null && !half.pull.flags.includes("MOST_OF_DEPOSIT"), "exactly 50% not flagged");
  ok(!parseBagAtmPull({ ...base, reason: "y".repeat(501) }).ok, "reason length capped");
  ok(!parseBagAtmPull({ ...base, terminalId: "" }).ok, "no terminal refused");

  // 9. bag total
  ok(bagTotalAfterPull(500000, 80000) === 420000, "bag holds expected - pull");
  ok(bagTotalAfterPull(500000, null) === 500000 && bagTotalAfterPull(500000, undefined) === 500000, "no pull = expected");
  ok(bagTotalAfterPull(null, 80000) === null, "unknown expected stays unknown");

  // 10. the card
  const n0 = atmCashNeed(null, 300000);
  ok(n0.kind === "no_reading", "no reading");
  const n1 = atmCashNeed(120000, null);
  ok(n1.kind === "no_target", "no target never invents a need");
  const n2 = atmCashNeed(120000, 300000);
  ok(n2.kind === "needs" && n2.twenties === 90 && n2.amountMinor === 180000, "need 90 x $20");
  const n3 = atmCashNeed(121000, 300000);
  ok(n3.kind === "needs" && n3.twenties === 89, "rounds DOWN to whole bills (never over the target)");
  ok(atmCashNeed(300000, 300000).kind === "full" && atmCashNeed(299000, 300000).kind === "full", "within one bill = full");
  ok(atmCashNeed(-500, 300000).kind === "needs", "a negative balance reads as empty");
  ok(isFreshReading(fresh, now) && !isFreshReading(stale, now) && !isFreshReading(null, now), "freshness");
  ok(minutesBetween("bad", now) === null, "bad time is null");

  // 11. pattern
  const pat = pullPattern([
    { businessDay: "2026-11-01", atmPulledBy: "e1", atmPullMinor: 40000, atmPullWitnessedBy: null },
    { businessDay: "2026-11-02", atmPulledBy: "e1", atmPullMinor: 40000, atmPullWitnessedBy: "e2" },
    { businessDay: "2026-11-03", atmPulledBy: "e1", atmPullMinor: 60000, atmPullWitnessedBy: null },
    { businessDay: "2026-11-04", atmPulledBy: "e2", atmPullMinor: 40000, atmPullWitnessedBy: null },
    { businessDay: "2026-11-05", atmPulledBy: null, atmPullMinor: null },
  ]);
  ok(pat.length === 1 && pat[0].employeeId === "e1" && pat[0].pulls === 3 && pat[0].alone === 2 && pat[0].totalMinor === 140000, "pattern: e1 three pulls, two alone");
  ok(pat[0].sentence.includes("2 with no witness"), "pattern sentence names the unwitnessed pulls");

  // 12. drop shape for the match page
  const d = bagPullDrop(
    { id: "b1", bagNo: "1041", businessDay: "2026-11-06", atmPullTwenties: 40, atmPullMinor: 80000, atmPulledAt: now, atmPullTerminalId: "HG26499", atmPulledBy: "e1", atmPullWitnessedBy: null, atmPullReason: null, atmPullFlags: ["NO_WITNESS"] },
    (id) => (id === "e1" ? "Ana" : null),
  );
  ok(d.amountCents === 80000 && d.twenties === 40 && d.recordedVia === "back_office" && d.registerName === "Deposit bag 1041 (2026-11-06)", "drop shape");
  ok(d.employeeName === "Ana" && d.witnessName === null && d.notes === "[flags: NO_WITNESS]", "drop names + flags");
  ok(pullSentence({ twenties: 40, amountMinor: 80000, terminalId: "HG26499" }, "Ana", null).includes("no witness"), "sentence says no witness");
  return { passed, failed };
}
