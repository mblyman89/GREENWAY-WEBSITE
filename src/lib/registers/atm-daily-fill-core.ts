/**
 * src/lib/registers/atm-daily-fill-core.ts   (D198i - the ATM's daily fill amount)
 *
 * Owner (2026-11-07, verbatim): "I like that you included in the press to update atm balance an
 * owner set to balance. I want to add that now. it should be a simple settings page in atm page in
 * the lyman drop down menu. from there I should be able to set a daily fill amount so it always
 * starts the day off with the same amount. it should be loud on the deposit bag page that the atm
 * needs x amount to be topped off properly."
 *
 * PURE: no imports, no clock, no I/O. The caller passes "now". Unit tested by
 * __runAtmDailyFillTests (scripts/compliance/run-pure-selftests.ts).
 *
 * What lives here:
 *   - parseDailyFillDollars: the owner's typed amount -> whole $20s in cents (or "clear").
 *   - pendingSinceReading: $20s already taken for the ATM (bag pulls, till ATM drops) AFTER the
 *     last PAI reading. The reading cannot see them yet, so without this two people could each top
 *     the ATM off from one stale figure (the double-pull a thief would hide behind).
 *   - atmTopOff: what the deposit bag page shouts: how many $20s bring the ATM to the daily fill
 *     amount, given the reading, its age and what is already on its way.
 *   - fillChangeSentence: one plain line for the change history.
 */

/** One $20 bill in cents. */
export const DAILY_FILL_BILL_MINOR = 2000;
/** The smallest daily fill amount the owner can set ($20). */
export const MIN_DAILY_FILL_CENTS = 2000;
/** The largest ($100,000) - the same ceiling as MAX_ATM_FILL_TO_CENTS in atm-drop-core. */
export const MAX_DAILY_FILL_CENTS = 10_000_000;
/** A reading older than this is "old" on the banner (matches ATM_READING_FRESH_MINUTES, D198e). */
export const TOP_OFF_FRESH_MINUTES = 30;
/** Loads older than this before "now" are not counted as pending (a reading this old is useless anyway). */
export const PENDING_LOOKBACK_HOURS = 24;

function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const s = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

export type DailyFillParse = { ok: true; cents: number | null } | { ok: false; error: string };

/**
 * What the owner typed into "Daily fill amount ($)". Dollars, whole $20s only, commas allowed,
 * ".00" allowed. Blank = clear the amount (the banner then stays quiet). Never rounds: a typo is
 * refused, not "fixed", because the employees act on this number with real cash.
 */
export function parseDailyFillDollars(text: unknown): DailyFillParse {
  const t = String(text ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return { ok: true, cents: null };
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false, error: "Daily fill amount: type dollars, for example 4000. Nothing was saved." };
  const cents = Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
  if (cents < MIN_DAILY_FILL_CENTS) return { ok: false, error: "Daily fill amount: at least $20, or leave it blank. Nothing was saved." };
  if (cents > MAX_DAILY_FILL_CENTS) return { ok: false, error: `Daily fill amount: at most ${money(MAX_DAILY_FILL_CENTS)}. Nothing was saved.` };
  if (cents % DAILY_FILL_BILL_MINOR !== 0) {
    const down = Math.floor(cents / DAILY_FILL_BILL_MINOR) * DAILY_FILL_BILL_MINOR;
    return { ok: false, error: `Daily fill amount: the ATM takes $20 bills only, so use a multiple of $20 (for example ${money(down)} or ${money(down + DAILY_FILL_BILL_MINOR)}). Nothing was saved.` };
  }
  return { ok: true, cents };
}

export type PendingLoad = {
  /** When the $20s were taken (bag pull time or till drop time). */
  atIso: string;
  amountMinor: number;
  kind: "bag_pull" | "till_drop";
  /** Who took them (name), for the banner. */
  who: string | null;
};

/**
 * The $20s taken for the ATM AFTER the reading was taken (strictly later), within the lookback.
 * With no reading at all, nothing is "pending": the banner then asks for a reading first.
 */
export function pendingSinceReading(items: readonly PendingLoad[], capturedAtIso: string | null, nowIso: string): { items: PendingLoad[]; totalMinor: number } {
  const cap = capturedAtIso ? Date.parse(capturedAtIso) : NaN;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(cap) || !Number.isFinite(now)) return { items: [], totalMinor: 0 };
  const floor = now - PENDING_LOOKBACK_HOURS * 3_600_000;
  const kept = items
    .filter((i) => {
      const t = Date.parse(i.atIso);
      return Number.isFinite(t) && t > cap && t >= floor && Number.isInteger(i.amountMinor) && i.amountMinor > 0;
    })
    .sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  return { items: kept, totalMinor: kept.reduce((s, i) => s + i.amountMinor, 0) };
}

export type TopOffTone = "danger" | "warn" | "ok" | "muted";

export type AtmTopOff = {
  kind: "no_target" | "no_reading" | "full" | "needs";
  tone: TopOffTone;
  /** Short and loud: the first line of the banner. */
  headline: string;
  /** The working, in plain words: reading, its time, what is on its way. */
  detail: string;
  fillToCents: number | null;
  balanceCents: number | null;
  pendingMinor: number;
  /** balance + pending: what the ATM should hold once the pending $20s are loaded. */
  projectedCents: number | null;
  needTwenties: number;
  needMinor: number;
  ageMinutes: number | null;
  stale: boolean;
  /** The need is more than one load may carry (the owner's max $20s per drop / pull). */
  overLoadCap: boolean;
};

/**
 * The deposit bag page banner. Rounds DOWN to whole $20s (never over the daily fill amount).
 * A stale or missing reading never hides the need: it is shown, louder, with "check first".
 */
export function atmTopOff(input: {
  fillToCents: number | null;
  reading: { balanceCents: number | null; capturedAt: string | null } | null;
  pending: readonly PendingLoad[];
  nowIso: string;
  maxTwentiesPerLoad: number;
  terminalId: string;
}): AtmTopOff {
  const fill = input.fillToCents !== null && Number.isInteger(input.fillToCents) && input.fillToCents > 0 ? input.fillToCents : null;
  const bal = input.reading && input.reading.balanceCents !== null && Number.isFinite(input.reading.balanceCents) ? Math.max(0, Math.trunc(input.reading.balanceCents)) : null;
  const capturedAt = bal !== null && input.reading ? input.reading.capturedAt : null;
  const capMs = capturedAt ? Date.parse(capturedAt) : NaN;
  const nowMs = Date.parse(input.nowIso);
  const ageMinutes = Number.isFinite(capMs) && Number.isFinite(nowMs) ? Math.round((nowMs - capMs) / 60_000) : null;
  const stale = ageMinutes === null || ageMinutes > TOP_OFF_FRESH_MINUTES || ageMinutes < -5;
  const pend = pendingSinceReading(input.pending, capturedAt, input.nowIso);
  const base = {
    fillToCents: fill,
    balanceCents: bal,
    pendingMinor: pend.totalMinor,
    projectedCents: bal === null ? null : bal + pend.totalMinor,
    ageMinutes,
    stale,
  };
  const ageText = ageMinutes === null ? "never" : ageMinutes <= 0 ? "just now" : ageMinutes < 90 ? `${ageMinutes} min ago` : `${Math.round(ageMinutes / 60)} h ago`;
  const pendText =
    pend.items.length === 0
      ? ""
      : ` Already taken for the ATM since that reading: ${money(pend.totalMinor)} (${pend.items
          .map((i) => `${money(i.amountMinor)} ${i.kind === "bag_pull" ? "from the deposit bag" : "till drop"}${i.who ? ` by ${i.who}` : ""}`)
          .join("; ")}), counted as loaded.`;

  if (fill === null) {
    return {
      ...base,
      kind: "no_target",
      tone: "muted",
      headline: "No daily fill amount is set for the ATM.",
      detail: "The owner sets it on Lyman \u2192 ATM Settings. Until then this page cannot say how much the ATM needs.",
      needTwenties: 0,
      needMinor: 0,
      overLoadCap: false,
    };
  }
  if (bal === null) {
    return {
      ...base,
      kind: "no_reading",
      tone: "warn",
      headline: `Check the ATM before building the bag: no reading of the cash in ATM ${input.terminalId} yet.`,
      detail: `Press \u201cCash in the ATM\u201d to read it from PAI. The daily fill amount is ${money(fill)}.`,
      needTwenties: 0,
      needMinor: 0,
      overLoadCap: false,
    };
  }
  const projected = bal + pend.totalMinor;
  const gap = fill - projected;
  const twenties = gap > 0 ? Math.floor(gap / DAILY_FILL_BILL_MINOR) : 0;
  const reading = `The ATM had ${money(bal)} at the last reading (${ageText}).${pendText}`;
  if (twenties <= 0) {
    return {
      ...base,
      kind: "full",
      tone: stale ? "warn" : "ok",
      headline: stale
        ? `The ATM looked full for the day at the last reading (${ageText}). Press \u201cCash in the ATM\u201d to check before taking any $20s.`
        : `The ATM is full for the day: no $20s are needed from the deposit.`,
      detail: `${reading} Daily fill amount: ${money(fill)}.`,
      needTwenties: 0,
      needMinor: 0,
      overLoadCap: false,
    };
  }
  const needMinor = twenties * DAILY_FILL_BILL_MINOR;
  const cap = Math.max(1, Math.trunc(Number.isFinite(input.maxTwentiesPerLoad) ? input.maxTwentiesPerLoad : 1));
  const overLoadCap = twenties > cap;
  return {
    ...base,
    kind: "needs",
    tone: "danger",
    headline: `The ATM needs ${money(needMinor)} (${twenties} x $20) to start the day at ${money(fill)}.${stale ? " Check it first: the reading is old." : ""}`,
    detail: `${reading} ${money(fill)} \u2212 ${money(projected)} = ${money(fill - projected)}, rounded down to whole $20s.${
      overLoadCap ? ` That is more than one load may carry (${cap} x $20, the owner\u2019s limit): take ${cap} x $20 and tell the owner.` : ""
    } Take them out with \u201cTake $20s out of this deposit for the ATM\u201d below, with a witness.`,
    needTwenties: twenties,
    needMinor,
    overLoadCap,
  };
}

/** One plain line for the change history. */
export function fillChangeSentence(beforeCents: number | null, afterCents: number | null): string {
  if (beforeCents === afterCents) return "Daily fill amount unchanged.";
  if (afterCents === null) return `Daily fill amount cleared (was ${beforeCents === null ? "not set" : money(beforeCents)}).`;
  if (beforeCents === null) return `Daily fill amount set to ${money(afterCents)}.`;
  return `Daily fill amount changed from ${money(beforeCents)} to ${money(afterCents)}.`;
}

/* ------------------------------------------------------------------------------------------------ */

export function __runAtmDailyFillTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`atm-daily-fill-core FAIL: ${msg}`);
    }
  };

  // 1. parseDailyFillDollars
  const p = (t: string) => parseDailyFillDollars(t);
  ok((() => { const r = p("4000"); return r.ok && r.cents === 400000; })(), "4000 -> $4,000");
  ok((() => { const r = p("$4,000.00"); return r.ok && r.cents === 400000; })(), "$4,000.00 accepted");
  ok((() => { const r = p("  "); return r.ok && r.cents === null; })(), "blank clears");
  ok(!p("4010").ok, "not whole $20s refused");
  ok((() => { const r = p("4010"); return !r.ok && r.error.includes("$4,000.00") && r.error.includes("$4,020.00"); })(), "refusal suggests both neighbours");
  ok(!p("4000.50").ok, "cents refused");
  ok(!p("10").ok, "under $20 refused");
  ok(!p("0").ok, "zero refused");
  ok(!p("-2000").ok, "negative refused");
  ok(!p("100020").ok, "over $100,000 refused");
  ok(p("100000").ok, "exactly $100,000 ok");
  ok(!p("4e3").ok, "exponent refused");
  ok(!p("four thousand").ok, "words refused");
  ok(p("20").ok, "$20 ok");
  ok(parseDailyFillDollars(null).ok, "null is blank");

  // 2. pendingSinceReading
  const now = "2026-11-07T16:00:00.000Z";
  const at = (min: number) => new Date(Date.parse(now) - min * 60_000).toISOString();
  const items: PendingLoad[] = [
    { atIso: at(10), amountMinor: 40000, kind: "bag_pull", who: "Ana" },
    { atIso: at(50), amountMinor: 20000, kind: "till_drop", who: "Bo" },
    { atIso: at(5), amountMinor: 0, kind: "till_drop", who: null },
    { atIso: "garbage", amountMinor: 2000, kind: "till_drop", who: null },
  ];
  const pe = pendingSinceReading(items, at(30), now);
  ok(pe.totalMinor === 40000 && pe.items.length === 1, "only loads strictly after the reading count");
  ok(pendingSinceReading(items, null, now).totalMinor === 0, "no reading -> nothing pending");
  ok(pendingSinceReading(items, at(60), now).totalMinor === 60000, "both after an older reading");
  ok(pendingSinceReading([{ atIso: at(30), amountMinor: 2000, kind: "till_drop", who: null }], at(30), now).totalMinor === 0, "same instant as the reading is not pending");
  ok(pendingSinceReading([{ atIso: at(60 * 25), amountMinor: 2000, kind: "till_drop", who: null }], at(60 * 26), now).totalMinor === 0, "older than the lookback ignored");

  // 3. atmTopOff
  const base = { fillToCents: 400000, reading: { balanceCents: 120000, capturedAt: at(5) }, pending: [] as PendingLoad[], nowIso: now, maxTwentiesPerLoad: 250, terminalId: "HG26499" };
  const n = atmTopOff(base);
  ok(n.kind === "needs" && n.needTwenties === 140 && n.needMinor === 280000 && n.tone === "danger", "needs 140 x $20");
  ok(n.headline.includes("$2,800.00") && n.headline.includes("140 x $20") && n.headline.includes("$4,000.00"), "headline names amount, bills and fill");
  ok(!n.stale && !n.headline.includes("old"), "fresh reading is not called old");
  const odd = atmTopOff({ ...base, reading: { balanceCents: 120050, capturedAt: at(5) } });
  ok(odd.needTwenties === 139, "rounds DOWN to whole $20s (never over the fill)");
  const st = atmTopOff({ ...base, reading: { balanceCents: 120000, capturedAt: at(45) } });
  ok(st.kind === "needs" && st.stale && st.headline.includes("old"), "stale reading still shows the need, louder");
  const withPend = atmTopOff({ ...base, pending: [{ atIso: at(2), amountMinor: 200000, kind: "bag_pull", who: "Ana" }] });
  ok(withPend.needTwenties === 40 && withPend.pendingMinor === 200000 && withPend.projectedCents === 320000, "a pull after the reading lowers the need (no double top-off)");
  ok(withPend.detail.includes("Ana") && withPend.detail.includes("from the deposit bag"), "pending pull named in the detail");
  const full = atmTopOff({ ...base, reading: { balanceCents: 400000, capturedAt: at(5) } });
  ok(full.kind === "full" && full.tone === "ok" && full.needTwenties === 0, "at the fill amount: full");
  const over = atmTopOff({ ...base, reading: { balanceCents: 410000, capturedAt: at(5) } });
  ok(over.kind === "full", "above the fill amount: full");
  const nearly = atmTopOff({ ...base, reading: { balanceCents: 399000, capturedAt: at(5) } });
  ok(nearly.kind === "full", "less than one $20 short: full");
  const fullStale = atmTopOff({ ...base, reading: { balanceCents: 400000, capturedAt: at(90) } });
  ok(fullStale.kind === "full" && fullStale.tone === "warn" && fullStale.headline.includes("check"), "full but stale: warn, check first");
  const noT = atmTopOff({ ...base, fillToCents: null });
  ok(noT.kind === "no_target" && noT.tone === "muted" && noT.headline.includes("No daily fill amount"), "no target: quiet, says so");
  const noR = atmTopOff({ ...base, reading: null });
  ok(noR.kind === "no_reading" && noR.tone === "warn" && noR.needTwenties === 0, "no reading: warn, invents no number");
  const noBal = atmTopOff({ ...base, reading: { balanceCents: null, capturedAt: at(1) } });
  ok(noBal.kind === "no_reading", "reading without a balance is no reading");
  const capped = atmTopOff({ ...base, maxTwentiesPerLoad: 100 });
  ok(capped.overLoadCap && capped.detail.includes("100 x $20"), "need over the per-load limit is called out");
  ok(!n.overLoadCap, "under the limit: no call-out");
  const future = atmTopOff({ ...base, reading: { balanceCents: 120000, capturedAt: at(-30) } });
  ok(future.stale, "a reading from the future is not trusted as fresh");
  const neg = atmTopOff({ ...base, reading: { balanceCents: -500, capturedAt: at(5) } });
  ok(neg.balanceCents === 0 && neg.needTwenties === 200, "negative balance read as 0");
  const badFill = atmTopOff({ ...base, fillToCents: 0 });
  ok(badFill.kind === "no_target", "zero fill is no target");

  // 4. fillChangeSentence
  ok(fillChangeSentence(null, 400000) === "Daily fill amount set to $4,000.00.", "set");
  ok(fillChangeSentence(400000, 500000) === "Daily fill amount changed from $4,000.00 to $5,000.00.", "changed");
  ok(fillChangeSentence(400000, null).includes("cleared"), "cleared");
  ok(fillChangeSentence(400000, 400000).includes("unchanged"), "unchanged");

  return { passed, failed };
}
