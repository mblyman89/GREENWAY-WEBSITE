/**
 * src/lib/registers/guided-cash-core.ts   (D181, round slice S4)
 *
 * PURE. Guided cash: the owner's cash rules turned into plain, loud steps.
 *
 * OWNER, verbatim (2026-11-04):
 *   "Cash rules, 167.5 for employees, 300 for manager ... Cash should be
 *    dropped if over 2k in sales for their register. Either of the morning
 *    employees may build the deposit bag. I am making all of my employees
 *    manager types ... we need a system that is very good at beating the fraud
 *    triangle. I am the only one to seal the bag and take it to the bank.
 *    There should be a deposit bag for every single day."
 *
 * What lives here (no I/O, so every rule is proven by the self-test):
 *   1. STANDARD_FLOAT_MINOR and standardFloatNotice: the two floats, and a
 *      sentence when a register's configured float drifts from them.
 *   2. dropStatus: when a drawer has taken more than $2,000 in cash that has
 *      not gone to the safe, a drop is DUE (loud). From $1,500 it is SOON.
 *   3. morningDuties: the morning crew's ordered checklist for last night's
 *      drawers and bag, ending with the owner's seal and bank run.
 *   4. missingBagDays: every business day that had drawers but no bag.
 *   5. sealerCheck: only the owner seals (the PIN must be the owner's own
 *      employee record when one is linked).
 *
 * Nothing here blocks a sale or a count. Loud, never in the way (D27).
 */

import { formatCents } from "./cash";

// ---------------------------------------------------------------------------
// 1. Floats (owner: 167.50 sales registers, 300.00 manager till)
// ---------------------------------------------------------------------------

export type RegisterKind = "sales" | "manager_till";

export const STANDARD_FLOAT_MINOR: Readonly<Record<RegisterKind, number>> = Object.freeze({
  sales: 16750,
  manager_till: 30000,
});

/** A sentence when a register's configured float is not the owner's standard. Null when it matches. */
export function standardFloatNotice(name: string, kind: RegisterKind, configuredMinor: number | null | undefined): string | null {
  const std = STANDARD_FLOAT_MINOR[kind];
  if (configuredMinor === std) return null;
  const had = Number.isInteger(configuredMinor) ? formatCents(configuredMinor as number) : "no float";
  return (
    `${name} is set to start with ${had}, but the store's rule is ${formatCents(std)} for ` +
    `${kind === "manager_till" ? "the manager till" : "a sales register"} (D181). Fix it in Registers setup.`
  );
}

// ---------------------------------------------------------------------------
// 2. Drops (owner: drop when a register's cash sales pass $2,000)
// ---------------------------------------------------------------------------

/** A drop is due once undropped cash sales pass this (cents). */
export const DROP_THRESHOLD_MINOR = 200000;
/** From here the screen says a drop is coming (cents). */
export const DROP_SOON_MINOR = 150000;
/**
 * Suggested drops are rounded down to a $20 step so the figure can be made
 * from big bills ($100s, $50s, $20s) and the float's small bills stay put.
 * D217: this is a rounding step only. It does NOT mean "drop only twenties";
 * safe drops are entered bill by bill (drop-bills-core).
 */
export const DROP_BILL_MINOR = 2000;

export type DropState = "ok" | "soon" | "due" | "unknown";

export type DropStatus = {
  state: DropState;
  /** Cash sales minus cash refunds minus drops already made: cash above the float. */
  undroppedMinor: number;
  /** What to drop now (rounded down to $20, big bills, leaving the float). 0 unless due. */
  suggestedDropMinor: number;
  /** One plain sentence for the screen; empty when ok. */
  sentence: string;
};

/**
 * Whether a drawer owes the safe a drop. "Over 2k in sales for their
 * register" is read as cash taken since the last drop: cash sales, less cash
 * refunds paid from the drawer, less drops already made. Card and tab sales
 * put no paper in the drawer, so they do not count.
 *
 * `readsComplete=false` (a figure built on a partial read) gives "unknown",
 * never a confident "ok": rule 135, missing is a question, not zero.
 */
export function dropStatus(input: {
  registerName: string;
  cashSalesMinor: number;
  refundsPaidMinor: number;
  dropsMinor: number;
  readsComplete: boolean;
}): DropStatus {
  const und = Math.max(0, Math.trunc(input.cashSalesMinor) - Math.trunc(input.refundsPaidMinor) - Math.trunc(input.dropsMinor));
  if (!input.readsComplete) {
    return {
      state: "unknown",
      undroppedMinor: und,
      suggestedDropMinor: 0,
      sentence: `${input.registerName}: the cash sales could not all be read, so whether a drop is due is unknown. Count the big bills ($100s, $50s, $20s); drop if the cash taken today is over ${formatCents(DROP_THRESHOLD_MINOR)}.`,
    };
  }
  if (und > DROP_THRESHOLD_MINOR) {
    const suggested = Math.floor(und / DROP_BILL_MINOR) * DROP_BILL_MINOR;
    return {
      state: "due",
      undroppedMinor: und,
      suggestedDropMinor: suggested,
      sentence:
        `DROP NOW: ${input.registerName} has taken ${formatCents(und)} in cash since its last drop (over ${formatCents(DROP_THRESHOLD_MINOR)}). ` +
        `Take out about ${formatCents(suggested)}: big bills first ($100s, $50s, then $20s); leave the starting cash ($10s, $5s, $1s and coins). ` +
        `Tap Drop, then enter how many of each bill you took (ATM drops: $20s only) and get a witness PIN.`,
    };
  }
  if (und >= DROP_SOON_MINOR) {
    return {
      state: "soon",
      undroppedMinor: und,
      suggestedDropMinor: 0,
      sentence: `${input.registerName} has ${formatCents(und)} in cash since its last drop. A drop is due at ${formatCents(DROP_THRESHOLD_MINOR)}.`,
    };
  }
  return { state: "ok", undroppedMinor: und, suggestedDropMinor: 0, sentence: "" };
}

// ---------------------------------------------------------------------------
// 3. Morning duties (owner: either morning employee builds the bag; only I seal)
// ---------------------------------------------------------------------------

export type DutyDrawer = {
  sessionId: string;
  registerName: string;
  status: string; // open | closed | reconciled | verified | ...
  secondCountMinor: number | null;
};

export type DutyBagStage = "none" | "night_counted" | "needs_reason" | "ready_to_seal" | "sealed_in_safe" | "banked" | "other";

export type DutyStep = {
  key: "close_drawers" | "second_counts" | "reconcile" | "build_bag" | "recount_bag" | "fix_bag" | "seal_bag" | "bank";
  /** Who does it: the morning crew, or Michael. */
  who: "morning crew" | "owner";
  done: boolean;
  text: string;
  href: string;
};

export type MorningDuties = {
  day: string;
  steps: DutyStep[];
  /** The first step not done (null when everything is done). */
  next: DutyStep | null;
  /** Morning-crew steps still open (owner steps do not nag staff). */
  crewOpen: number;
  /** Nothing happened that day (no drawers, no bag): nothing to do. */
  quietDay: boolean;
};

const REG = "/admin/registers";
const BAGS = `${REG}/deposit-bags`;

/**
 * The morning checklist for `day` (normally yesterday), in the order the cash
 * moves: every drawer closed, every drawer second-counted by someone who did
 * not close it, every drawer reconciled, the bag built, recounted blind by a
 * different person, then sealed and banked by the owner.
 */
export function morningDuties(input: { day: string; drawers: readonly DutyDrawer[]; bagStage: DutyBagStage }): MorningDuties {
  const { day, drawers, bagStage } = input;
  const open = drawers.filter((d) => d.status === "open");
  const blind = drawers.filter((d) => d.status === "closed" && d.secondCountMinor === null);
  const unrec = drawers.filter((d) => d.status === "closed");
  const names = (ds: readonly DutyDrawer[]) => ds.map((d) => d.registerName).join(", ");
  const bagBuilt = bagStage !== "none";
  const recounted = bagStage === "ready_to_seal" || bagStage === "sealed_in_safe" || bagStage === "banked";
  const sealed = bagStage === "sealed_in_safe" || bagStage === "banked";

  const steps: DutyStep[] = [];
  steps.push({
    key: "close_drawers",
    who: "morning crew",
    done: open.length === 0,
    text: open.length === 0 ? `Every drawer from ${day} is closed.` : `Close ${names(open)} from ${day} (count it blind).`,
    href: REG,
  });
  steps.push({
    key: "second_counts",
    who: "morning crew",
    done: blind.length === 0 && open.length === 0,
    text:
      blind.length === 0
        ? `Every drawer from ${day} has its second count.`
        : `Second-count ${names(blind)} from ${day}. Someone who did not close it counts it, without looking at the first count.`,
    href: REG,
  });
  steps.push({
    key: "reconcile",
    who: "morning crew",
    done: unrec.length === 0 && open.length === 0,
    text: unrec.length === 0 ? `Every drawer from ${day} is reconciled.` : `Reconcile ${names(unrec)} from ${day}.`,
    href: REG,
  });
  if (bagStage === "needs_reason") {
    steps.push({
      key: "fix_bag",
      who: "morning crew",
      done: false,
      text: `The two counts of the ${day} bag differ. Count it again together and write the reason. Do not seal.`,
      href: BAGS,
    });
  }
  steps.push({
    key: "build_bag",
    who: "morning crew",
    done: bagBuilt,
    text: bagBuilt ? `The ${day} deposit bag is built.` : `Build the ${day} deposit bag from the drawers' takings (either morning employee).`,
    href: `${BAGS}?day=${day}`,
  });
  steps.push({
    key: "recount_bag",
    who: "morning crew",
    done: recounted,
    text: recounted
      ? `The ${day} bag has its blind recount.`
      : `Recount the ${day} bag blind. It must be a different person from whoever built it.`,
    href: BAGS,
  });
  steps.push({
    key: "seal_bag",
    who: "owner",
    done: sealed,
    text: sealed ? `The ${day} bag is sealed.` : `Michael seals the ${day} bag. Leave it unsealed in the safe until then.`,
    href: BAGS,
  });
  steps.push({
    key: "bank",
    who: "owner",
    done: bagStage === "banked",
    text: bagStage === "banked" ? `The ${day} bag is at the bank.` : `Michael takes the ${day} bag to the bank.`,
    href: BAGS,
  });

  const quietDay = drawers.length === 0 && bagStage === "none";
  const effective = quietDay ? steps.map((s) => ({ ...s, done: true })) : steps;
  const next = effective.find((s) => !s.done) ?? null;
  return {
    day,
    steps: effective,
    next,
    crewOpen: effective.filter((s) => !s.done && s.who === "morning crew").length,
    quietDay,
  };
}

// ---------------------------------------------------------------------------
// 4. A bag for every day
// ---------------------------------------------------------------------------

/**
 * Business days (before today) that had at least one drawer but have no bag.
 * Sorted oldest first. A day with no drawers had no cash, so no bag is owed.
 */
export function missingBagDays(input: { drawerDays: readonly string[]; bagDays: readonly string[]; today: string }): string[] {
  const bags = new Set(input.bagDays);
  return [...new Set(input.drawerDays)].filter((d) => d < input.today && !bags.has(d)).sort();
}

export function missingBagSentence(days: readonly string[]): string | null {
  if (days.length === 0) return null;
  const list = days.length <= 4 ? days.join(", ") : `${days.slice(0, 3).join(", ")} and ${days.length - 3} more`;
  return (
    `No deposit bag was built for ${list}. Every business day needs its own bag (D181). ` +
    "Build it on Deposit bags (pick the day), from that day's drawers."
  );
}

// ---------------------------------------------------------------------------
// 5. Only the owner seals
// ---------------------------------------------------------------------------

export const SEAL_OWNER_ONLY_ERROR =
  "Only Michael seals the deposit bag (D181). Leave it unsealed in the safe with the night sheet. Nothing was saved.";

/**
 * The seal's identity check, after the owner-only page gate. When the
 * owner's sign-in is linked to an employee record, the PIN must be that
 * record: a borrowed owner login with someone else's PIN is refused.
 */
export function sealerCheck(input: { isOwner: boolean; ownerEmployeeId: string | null; pinEmployeeId: string }): { ok: true } | { ok: false; error: string } {
  if (!input.isOwner) return { ok: false, error: SEAL_OWNER_ONLY_ERROR };
  if (input.ownerEmployeeId && input.ownerEmployeeId !== input.pinEmployeeId) {
    return { ok: false, error: "That PIN is not Michael's. Only Michael seals the deposit bag, with his own PIN (D181). Nothing was saved." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runGuidedCashTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`guided-cash-core FAIL: ${msg}`);
    }
  };

  // 1. floats
  ok(STANDARD_FLOAT_MINOR.sales === 16750, "sales float is $167.50");
  ok(STANDARD_FLOAT_MINOR.manager_till === 30000, "manager till float is $300.00");
  ok(standardFloatNotice("R1", "sales", 16750) === null, "standard sales float: no notice");
  ok(standardFloatNotice("MT", "manager_till", 30000) === null, "standard manager float: no notice");
  ok((standardFloatNotice("R1", "sales", 20000) ?? "").includes("$167.50"), "drifted float names the rule");
  ok((standardFloatNotice("MT", "manager_till", null) ?? "").includes("no float"), "missing float is named");

  // 2. drops
  const base = { registerName: "Register 1", refundsPaidMinor: 0, dropsMinor: 0, readsComplete: true };
  ok(dropStatus({ ...base, cashSalesMinor: 0 }).state === "ok", "no sales: ok");
  ok(dropStatus({ ...base, cashSalesMinor: 149999 }).state === "ok", "just under soon: ok");
  ok(dropStatus({ ...base, cashSalesMinor: 150000 }).state === "soon", "$1,500: soon");
  ok(dropStatus({ ...base, cashSalesMinor: 200000 }).state === "soon", "exactly $2,000 is not OVER $2,000");
  const due = dropStatus({ ...base, cashSalesMinor: 200001 });
  ok(due.state === "due", "over $2,000: due");
  ok(due.suggestedDropMinor === 200000 && due.suggestedDropMinor % DROP_BILL_MINOR === 0, "suggestion rounded to a $20 step");
  ok(!/in twenties/.test(due.sentence) && /\$100s/.test(due.sentence) && /how many of each bill/.test(due.sentence), "D217: due says big bills + count each bill, not 'in twenties'");
  ok(due.sentence.startsWith("DROP NOW"), "due is loud");
  ok(dropStatus({ ...base, cashSalesMinor: 250000, dropsMinor: 100000 }).state === "soon", "a drop resets the clock");
  ok(dropStatus({ ...base, cashSalesMinor: 250000, refundsPaidMinor: 60000 }).state === "soon", "cash refunds leave the drawer");
  ok(dropStatus({ ...base, cashSalesMinor: 100000, dropsMinor: 200000 }).undroppedMinor === 0, "never negative");
  ok(dropStatus({ ...base, cashSalesMinor: 999999, readsComplete: false }).state === "unknown", "partial read: unknown, not ok");
  ok(dropStatus({ ...base, cashSalesMinor: 0, readsComplete: false }).state === "unknown", "partial read never says ok");

  // 3. morning duties
  const d = (id: string, status: string, second: number | null): DutyDrawer => ({ sessionId: id, registerName: `R${id}`, status, secondCountMinor: second });
  const fresh = morningDuties({ day: "2026-11-03", drawers: [d("1", "closed", null), d("2", "closed", null)], bagStage: "none" });
  ok(fresh.next?.key === "second_counts", "first job: second counts");
  ok(fresh.steps.find((s) => s.key === "second_counts")!.text.includes("R1, R2"), "names the drawers");
  ok(fresh.crewOpen === 4, "four crew steps open");
  const counted = morningDuties({ day: "2026-11-03", drawers: [d("1", "closed", 5000), d("2", "reconciled", 5000)], bagStage: "none" });
  ok(counted.next?.key === "reconcile", "then reconcile");
  const rec = morningDuties({ day: "2026-11-03", drawers: [d("1", "reconciled", 5000)], bagStage: "none" });
  ok(rec.next?.key === "build_bag" && rec.next.href.includes("day=2026-11-03"), "then build the bag for that day");
  const built = morningDuties({ day: "2026-11-03", drawers: [d("1", "reconciled", 5000)], bagStage: "night_counted" });
  ok(built.next?.key === "recount_bag", "then the blind recount");
  const ready = morningDuties({ day: "2026-11-03", drawers: [d("1", "reconciled", 5000)], bagStage: "ready_to_seal" });
  ok(ready.next?.key === "seal_bag" && ready.next.who === "owner", "then Michael seals");
  ok(ready.crewOpen === 0, "the crew is done once the bag is recounted");
  const banked = morningDuties({ day: "2026-11-03", drawers: [d("1", "verified", 5000)], bagStage: "banked" });
  ok(banked.next === null, "banked: all done");
  const diff = morningDuties({ day: "2026-11-03", drawers: [d("1", "reconciled", 5000)], bagStage: "needs_reason" });
  ok(diff.steps.some((s) => s.key === "fix_bag" && !s.done) && diff.next?.key === "fix_bag", "counts differ: fix first");
  const openD = morningDuties({ day: "2026-11-03", drawers: [d("1", "open", null)], bagStage: "none" });
  ok(openD.next?.key === "close_drawers", "an open drawer comes first");
  ok(!openD.steps.find((s) => s.key === "second_counts")!.done, "an open drawer is not 'counted'");
  const quiet = morningDuties({ day: "2026-11-03", drawers: [], bagStage: "none" });
  ok(quiet.quietDay && quiet.next === null && quiet.crewOpen === 0, "a quiet day owes nothing");

  // 4. a bag every day
  ok(
    JSON.stringify(missingBagDays({ drawerDays: ["2026-11-01", "2026-11-02", "2026-11-02", "2026-11-04"], bagDays: ["2026-11-01"], today: "2026-11-04" })) ===
      JSON.stringify(["2026-11-02"]),
    "only past days with drawers and no bag",
  );
  ok(missingBagSentence([]) === null, "nothing missing: no sentence");
  ok((missingBagSentence(["a", "b", "c", "d", "e"]) ?? "").includes("2 more"), "long lists are shortened");

  // 5. only the owner seals
  ok(!sealerCheck({ isOwner: false, ownerEmployeeId: null, pinEmployeeId: "e1" }).ok, "staff cannot seal");
  ok(sealerCheck({ isOwner: true, ownerEmployeeId: "o1", pinEmployeeId: "o1" }).ok, "owner with own PIN seals");
  ok(!sealerCheck({ isOwner: true, ownerEmployeeId: "o1", pinEmployeeId: "e2" }).ok, "owner login + someone else's PIN refused");
  ok(sealerCheck({ isOwner: true, ownerEmployeeId: null, pinEmployeeId: "e2" }).ok, "unlinked owner login: the PIN is recorded");

  return { passed, failed };
}
