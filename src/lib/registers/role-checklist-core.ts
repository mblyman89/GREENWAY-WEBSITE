/**
 * src/lib/registers/role-checklist-core.ts   (D185, round slice S8)
 *
 * "My Day": the daily role checklist, so each shift knows exactly what it
 * owes. Owner (2026-11-05): "Cash handling, sop, opening and closing tills,
 * daily employee tasks and obligations ... spelled out on screen. This is the
 * step you are on ... do this, do this, do that, done. Validate us when we
 * are done ... If there is a step to be done, make it loud ... we need
 * nudging."
 *
 * PURE. Builds one ordered list per shift from facts the store has already
 * read (the morning cash duties, live drop status, the opening / during /
 * closing sheets, today's drawers, days with no bag). Nothing here writes,
 * and nothing blocks anyone: every step links to the screen where it is done.
 *
 * Rule 135: a fact that could not be read is never shown as done. It becomes
 * an "unknown" step that says what to check by hand, and the shift is not
 * validated as done while any step is unknown.
 */
import type { DropState, MorningDuties } from "@/lib/registers/guided-cash-core";

export const MY_DAY_PAGE = "/admin/registers/my-day";
const REG = "/admin/registers";
const BAGS = `${REG}/deposit-bags`;
const SHEETS = "/admin/inventory/checklists";

export const SHIFTS = ["opening", "during", "closing", "owner"] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  opening: "Opening (morning crew)",
  during: "During the shift",
  closing: "Closing",
  owner: "Michael only",
};

/** Hours (Pacific, 0-23) at which the screen moves to the next shift. */
export const DURING_FROM_HOUR = 11;
export const CLOSING_FROM_HOUR = 20;

/** Which shift "now" is. The owner's list is shown to everyone but never "now" for staff. */
export function shiftForHour(hour: number): Exclude<Shift, "owner"> {
  const h = Number.isFinite(hour) ? Math.trunc(hour) : 0;
  if (h < DURING_FROM_HOUR) return "opening";
  if (h < CLOSING_FROM_HOUR) return "during";
  return "closing";
}

export type StepState = "done" | "todo" | "loud" | "unknown";

export type RoleStep = {
  key: string;
  shift: Shift;
  state: StepState;
  text: string;
  href: string;
};

/** One checklist sheet's progress, or the reason it could not be read. */
export type SheetFact =
  | { ok: true; total: number; ticked: number; signedOff: boolean }
  | { ok: false; error: string };

export type DropFact = { registerName: string; state: DropState; sentence: string };

export type MyDayFacts = {
  today: string;
  yesterday: string;
  hour: number;
  /** Yesterday's morning cash jobs (close, second count, reconcile, bag, seal, bank). */
  yesterdayDuties: { ok: true; duties: MorningDuties } | { ok: false; error: string };
  /** Today's drawers, for the closing "close every drawer" step. */
  todayDuties: { ok: true; duties: MorningDuties } | { ok: false; error: string };
  drops: { ok: true; drops: DropFact[] } | { ok: false; error: string };
  /** Business days (before yesterday) that had drawers and no bag. */
  missingBagDays: { ok: true; days: string[] } | { ok: false; error: string };
  sheets: Record<"opening" | "during" | "closing", SheetFact>;
};

export type ShiftBlock = {
  shift: Shift;
  label: string;
  steps: RoleStep[];
  /** Steps not done (todo + loud + unknown). */
  open: number;
  /** Validated: every step done, none unknown. */
  done: boolean;
};

export type MyDay = {
  today: string;
  now: Exclude<Shift, "owner">;
  blocks: ShiftBlock[];
  /** Loud steps from any staff shift (drop due, a missing bag, unfinished morning cash). */
  loud: RoleStep[];
  /** The one step to do next: the first loud step, else the first open step of the current shift, else of an earlier shift. */
  next: RoleStep | null;
  /** "You're done" for the current shift and everything before it (staff shifts only). */
  shiftDone: boolean;
  /** One sentence for the top of the screen. */
  headline: string;
};

function sheetStep(kind: "opening" | "during" | "closing", shift: Shift, fact: SheetFact, label: string): RoleStep[] {
  const href = `${SHEETS}?list=${kind}`;
  if (!fact.ok) {
    return [{ key: `sheet_${kind}`, shift, state: "unknown", text: `The ${label} sheet could not be read (${fact.error}). Use the paper form.`, href }];
  }
  if (fact.total === 0) {
    return [{ key: `sheet_${kind}`, shift, state: "done", text: `The ${label} sheet has no tasks set up.`, href }];
  }
  const left = Math.max(0, fact.total - fact.ticked);
  const ticks: RoleStep = {
    key: `sheet_${kind}`,
    shift,
    state: left === 0 ? "done" : "todo",
    text: left === 0 ? `Every ${label} task is initialed (${fact.total} of ${fact.total}).` : `Initial the ${label} sheet: ${left} of ${fact.total} tasks left.`,
    href,
  };
  const sign: RoleStep = {
    key: `signoff_${kind}`,
    shift,
    state: fact.signedOff ? "done" : "todo",
    text: fact.signedOff ? `The ${label} sheet is signed off.` : `Sign off the ${label} sheet (a manager, once every task is initialed).`,
    href,
  };
  return [ticks, sign];
}

function block(shift: Shift, steps: RoleStep[]): ShiftBlock {
  const open = steps.filter((s) => s.state !== "done").length;
  return { shift, label: SHIFT_LABELS[shift], steps, open, done: open === 0 };
}

/** Build the day. Pure and deterministic. */
export function buildMyDay(f: MyDayFacts): MyDay {
  const now = shiftForHour(f.hour);
  const opening: RoleStep[] = [];
  const during: RoleStep[] = [];
  const closing: RoleStep[] = [];
  const owner: RoleStep[] = [];

  // Opening: yesterday's cash first (it is the oldest money), then the sheet.
  if (!f.yesterdayDuties.ok) {
    opening.push({
      key: "y_cash",
      shift: "opening",
      state: "unknown",
      text: `Yesterday's drawers and bag could not be checked (${f.yesterdayDuties.error}). Check Register Activity and Deposit bags by hand.`,
      href: REG,
    });
    owner.push({ key: "y_seal_bank", shift: "owner", state: "unknown", text: `Whether yesterday's bag is sealed and banked could not be checked.`, href: BAGS });
  } else {
    const d = f.yesterdayDuties.duties;
    for (const s of d.steps) {
      const target = s.who === "owner" ? owner : opening;
      // Unfinished crew cash after the opening shift has passed is loud.
      const late = s.who !== "owner" && now !== "opening";
      target.push({
        key: `y_${s.key}`,
        shift: s.who === "owner" ? "owner" : "opening",
        state: s.done ? "done" : late ? "loud" : "todo",
        text: s.text,
        href: s.href,
      });
    }
  }
  opening.push({
    key: "float_rule",
    shift: "opening",
    state: "done",
    text: "Floats: every sales drawer starts at $167.50, the manager till at $300.00. Count it before the first sale.",
    href: REG,
  });
  opening.push(...sheetStep("opening", "opening", f.sheets.opening, "opening"));

  // During: drops are the loud ones.
  if (!f.drops.ok) {
    during.push({
      key: "drops",
      shift: "during",
      state: "unknown",
      text: `Drops could not be checked (${f.drops.error}). Count the twenties in each open drawer; drop if it is over $2,000.`,
      href: REG,
    });
  } else {
    const loud = f.drops.drops.filter((d) => d.state === "due" || d.state === "unknown");
    if (!loud.length) {
      const soon = f.drops.drops.filter((d) => d.state === "soon");
      during.push({
        key: "drops",
        shift: "during",
        state: "done",
        text: soon.length ? `No drop is due yet. ${soon.map((d) => d.sentence).join(" ")}` : "No drop is due: every open drawer is under $2,000 in cash.",
        href: REG,
      });
    }
    for (const d of loud) {
      during.push({
        key: `drop_${d.registerName}`,
        shift: "during",
        state: d.state === "due" ? "loud" : "unknown",
        text: d.sentence,
        href: REG,
      });
    }
  }
  during.push(...sheetStep("during", "during", f.sheets.during, "during-the-shift"));

  // Closing: the sheet, then every drawer of today closed (blind count).
  closing.push(...sheetStep("closing", "closing", f.sheets.closing, "closing"));
  if (!f.todayDuties.ok) {
    closing.push({ key: "t_close", shift: "closing", state: "unknown", text: `Today's drawers could not be checked (${f.todayDuties.error}).`, href: REG });
  } else {
    const c = f.todayDuties.duties.steps.find((s) => s.key === "close_drawers");
    closing.push({
      key: "t_close",
      shift: "closing",
      state: !c || c.done ? "done" : "todo",
      text: !c || c.done ? "Every drawer from today is closed." : `${c.text} Leave it in the safe for the morning second count.`,
      href: REG,
    });
  }

  // Owner: older days with no bag (a bag for every single day).
  if (!f.missingBagDays.ok) {
    opening.push({ key: "missing_bags", shift: "opening", state: "unknown", text: `Whether every day has its bag could not be checked (${f.missingBagDays.error}).`, href: BAGS });
  } else {
    const older = f.missingBagDays.days.filter((d) => d !== f.yesterday);
    if (older.length) {
      opening.push({
        key: "missing_bags",
        shift: "opening",
        state: "loud",
        text: `No deposit bag yet for ${older.join(", ")}. Every day with sales needs its own bag: build it (either morning employee).`,
        href: BAGS,
      });
    }
  }

  const blocks = [block("opening", opening), block("during", during), block("closing", closing), block("owner", owner)];
  const order: Exclude<Shift, "owner">[] = ["opening", "during", "closing"];
  const upTo = order.slice(0, order.indexOf(now) + 1);
  const staffSteps = blocks.filter((b) => b.shift !== "owner").flatMap((b) => b.steps);
  const loud = staffSteps.filter((s) => s.state === "loud");
  const currentOpen = blocks.find((b) => b.shift === now)!.steps.find((s) => s.state !== "done") ?? null;
  const earlierOpen = blocks.filter((b) => upTo.includes(b.shift as Exclude<Shift, "owner">)).flatMap((b) => b.steps).find((s) => s.state !== "done") ?? null;
  const next = loud[0] ?? currentOpen ?? earlierOpen;
  const shiftDone = blocks.filter((b) => upTo.includes(b.shift as Exclude<Shift, "owner">)).every((b) => b.done);
  const unknown = staffSteps.some((s) => s.state === "unknown");

  let headline: string;
  if (loud.length) headline = `${loud.length} urgent step${loud.length === 1 ? "" : "s"}: do ${loud.length === 1 ? "it" : "them"} first.`;
  else if (shiftDone) headline = `You're done: the ${SHIFT_LABELS[now].toLowerCase()} list is complete. Thank you.`;
  else if (unknown) headline = "Some steps could not be checked: do them by hand and look again.";
  else headline = `This is the step you are on: ${next ? next.text : "nothing left"}`;

  return { today: f.today, now, blocks, loud, next, shiftDone, headline };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runRoleChecklistTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const t = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`role-checklist-core FAIL: ${name}`);
    }
  };
  const duties = (done: boolean, ownerDone = done): MorningDuties => {
    const steps = [
      { key: "close_drawers", who: "morning crew", done, text: "Close Register 1", href: REG },
      { key: "second_counts", who: "morning crew", done, text: "Second-count", href: REG },
      { key: "build_bag", who: "morning crew", done, text: "Build bag", href: BAGS },
      { key: "seal_bag", who: "owner", done: ownerDone, text: "Michael seals", href: BAGS },
      { key: "bank", who: "owner", done: ownerDone, text: "Michael banks", href: BAGS },
    ] as MorningDuties["steps"];
    const next = steps.find((s) => !s.done) ?? null;
    return { day: "2026-11-04", steps, next, crewOpen: steps.filter((s) => !s.done && s.who === "morning crew").length, quietDay: false };
  };
  const sheet = (total: number, ticked: number, signedOff = false): SheetFact => ({ ok: true, total, ticked, signedOff });
  const base = (over: Partial<MyDayFacts> = {}): MyDayFacts => ({
    today: "2026-11-05",
    yesterday: "2026-11-04",
    hour: 9,
    yesterdayDuties: { ok: true, duties: duties(true) },
    todayDuties: { ok: true, duties: duties(true) },
    drops: { ok: true, drops: [] },
    missingBagDays: { ok: true, days: [] },
    sheets: { opening: sheet(3, 3, true), during: sheet(2, 2, true), closing: sheet(2, 2, true) },
    ...over,
  });

  // shiftForHour
  t("hour 0 opening", shiftForHour(0) === "opening");
  t("hour 10 opening", shiftForHour(10) === "opening");
  t("hour 11 during", shiftForHour(11) === "during");
  t("hour 19 during", shiftForHour(19) === "during");
  t("hour 20 closing", shiftForHour(20) === "closing");
  t("hour 23 closing", shiftForHour(23) === "closing");
  t("NaN hour opening", shiftForHour(Number.NaN) === "opening");

  // All done in the morning: validated.
  const allDone = buildMyDay(base());
  t("all done -> shiftDone", allDone.shiftDone);
  t("all done -> no loud", allDone.loud.length === 0);
  t("all done -> next null", allDone.next === null);
  t("all done headline says done", allDone.headline.startsWith("You're done"));
  t("four blocks", allDone.blocks.length === 4);
  t("now opening at 9", allDone.now === "opening");
  t("float rule shown", allDone.blocks[0].steps.some((s) => s.key === "float_rule" && s.text.includes("$167.50") && s.text.includes("$300.00")));

  // Opening sheet open: next is the sheet, not done.
  const sheetOpen = buildMyDay(base({ sheets: { opening: sheet(3, 1), during: sheet(2, 0), closing: sheet(2, 0) } }));
  t("sheet open -> not done", !sheetOpen.shiftDone);
  t("sheet open -> next is opening sheet", sheetOpen.next?.key === "sheet_opening");
  t("sheet text counts left", sheetOpen.next?.text.includes("2 of 3") === true);
  t("headline names the step", sheetOpen.headline.startsWith("This is the step you are on"));
  t("signoff step todo", sheetOpen.blocks[0].steps.some((s) => s.key === "signoff_opening" && s.state === "todo"));
  t("later shifts do not block opening validation", buildMyDay(base({ sheets: { opening: sheet(3, 3, true), during: sheet(2, 0), closing: sheet(2, 0) } })).shiftDone);

  // Yesterday's cash unfinished: todo in the morning, loud after.
  const cashMorning = buildMyDay(base({ yesterdayDuties: { ok: true, duties: duties(false) } }));
  t("unfinished cash morning is todo", cashMorning.blocks[0].steps.find((s) => s.key === "y_close_drawers")?.state === "todo");
  t("unfinished cash morning next is close", cashMorning.next?.key === "y_close_drawers");
  t("owner steps go to owner block", cashMorning.blocks[3].steps.map((s) => s.key).join(",") === "y_seal_bag,y_bank");
  t("owner steps never in opening", !cashMorning.blocks[0].steps.some((s) => s.key === "y_seal_bag"));
  const cashNoon = buildMyDay(base({ hour: 14, yesterdayDuties: { ok: true, duties: duties(false) } }));
  t("unfinished cash at noon is loud", cashNoon.loud.some((s) => s.key === "y_close_drawers"));
  t("loud first", cashNoon.next?.key === "y_close_drawers");
  t("loud headline", cashNoon.headline.includes("urgent"));
  t("loud blocks validation", !cashNoon.shiftDone);

  // Owner-only open steps never block staff validation.
  const ownerOpen = buildMyDay(base({ yesterdayDuties: { ok: true, duties: duties(true, false) } }));
  t("owner open -> staff still done", ownerOpen.shiftDone);
  t("owner block open", ownerOpen.blocks[3].open === 2 && !ownerOpen.blocks[3].done);
  t("owner steps not loud", ownerOpen.loud.length === 0);

  // Drops.
  const dropDue = buildMyDay(base({ hour: 15, drops: { ok: true, drops: [{ registerName: "Register 2", state: "due", sentence: "DROP NOW: Register 2" }] } }));
  t("drop due is loud", dropDue.loud.length === 1 && dropDue.loud[0].key === "drop_Register 2");
  t("drop due next", dropDue.next?.text === "DROP NOW: Register 2");
  t("drop due not done", !dropDue.shiftDone);
  const dropDueMorning = buildMyDay(base({ hour: 8, drops: { ok: true, drops: [{ registerName: "R1", state: "due", sentence: "DROP NOW: R1" }] } }));
  t("drop due loud even in the morning", dropDueMorning.next?.key === "drop_R1");
  const dropSoon = buildMyDay(base({ hour: 15, drops: { ok: true, drops: [{ registerName: "R1", state: "soon", sentence: "R1 has $1,600.00" }] } }));
  t("soon is not loud", dropSoon.loud.length === 0);
  t("soon text shown", dropSoon.blocks[1].steps[0].text.includes("$1,600.00"));
  t("soon still done", dropSoon.shiftDone);
  const dropUnknown = buildMyDay(base({ hour: 15, drops: { ok: true, drops: [{ registerName: "R1", state: "unknown", sentence: "R1 unknown" }] } }));
  t("unknown drop not done", !dropUnknown.shiftDone && dropUnknown.blocks[1].steps.some((s) => s.state === "unknown"));
  const dropErr = buildMyDay(base({ hour: 15, drops: { ok: false, error: "boom" } }));
  t("drop read error -> unknown", dropErr.blocks[1].steps[0].state === "unknown" && dropErr.blocks[1].steps[0].text.includes("boom"));
  t("drop read error -> not done", !dropErr.shiftDone);

  // Read errors are never all-clear (rule 135).
  const yErr = buildMyDay(base({ yesterdayDuties: { ok: false, error: "nope" } }));
  t("duties error -> unknown", yErr.blocks[0].steps[0].state === "unknown");
  t("duties error -> owner unknown", yErr.blocks[3].steps[0].state === "unknown");
  t("duties error -> not done", !yErr.shiftDone);
  t("unknown headline", yErr.headline.includes("could not be checked"));
  const sErr = buildMyDay(base({ sheets: { opening: { ok: false, error: "x" }, during: sheet(1, 1, true), closing: sheet(1, 1, true) } }));
  t("sheet error -> unknown and paper", sErr.blocks[0].steps.some((s) => s.key === "sheet_opening" && s.state === "unknown" && s.text.includes("paper")));
  const empty = buildMyDay(base({ sheets: { opening: sheet(0, 0), during: sheet(0, 0), closing: sheet(0, 0) } }));
  t("empty sheet is done, no signoff step", empty.shiftDone && !empty.blocks[0].steps.some((s) => s.key === "signoff_opening"));

  // Closing.
  const closeOpen = buildMyDay(base({ hour: 21, todayDuties: { ok: true, duties: duties(false) } }));
  t("closing now", closeOpen.now === "closing");
  t("closing drawer open -> todo", closeOpen.blocks[2].steps.find((s) => s.key === "t_close")?.state === "todo");
  t("closing next is close", closeOpen.next?.key === "t_close");
  t("closing text says safe", closeOpen.next?.text.includes("safe") === true);
  const closeErr = buildMyDay(base({ hour: 21, todayDuties: { ok: false, error: "z" } }));
  t("closing read error unknown", closeErr.blocks[2].steps.some((s) => s.key === "t_close" && s.state === "unknown"));
  t("closing open drawer does not block morning", buildMyDay(base({ hour: 9, todayDuties: { ok: true, duties: duties(false) } })).shiftDone);

  // Missing bags.
  const miss = buildMyDay(base({ missingBagDays: { ok: true, days: ["2026-11-01", "2026-11-04"] } }));
  t("older missing bag is loud", miss.loud.some((s) => s.key === "missing_bags" && s.text.includes("2026-11-01")));
  t("yesterday excluded from missing (it is in the duties)", !miss.loud[0].text.includes("2026-11-04"));
  const missOnlyY = buildMyDay(base({ missingBagDays: { ok: true, days: ["2026-11-04"] } }));
  t("only yesterday missing -> no extra step", !missOnlyY.blocks[0].steps.some((s) => s.key === "missing_bags"));
  const missErr = buildMyDay(base({ missingBagDays: { ok: false, error: "q" } }));
  t("missing read error unknown", missErr.blocks[0].steps.some((s) => s.key === "missing_bags" && s.state === "unknown"));

  // Earlier shift still open at noon is the next step after the current one is done.
  const lateOpen = buildMyDay(base({ hour: 14, sheets: { opening: sheet(3, 2), during: sheet(1, 1, true), closing: sheet(1, 0) } }));
  t("earlier open -> next is opening sheet", lateOpen.next?.key === "sheet_opening");
  t("earlier open -> not done", !lateOpen.shiftDone);

  // Deterministic.
  t("deterministic", JSON.stringify(buildMyDay(base({ hour: 14 }))) === JSON.stringify(buildMyDay(base({ hour: 14 }))));

  return { passed, failed };
}
