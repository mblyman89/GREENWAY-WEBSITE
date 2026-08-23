/**
 * tests/compliance/wage-order-answer-record.test.ts   (books-40c)
 *
 * PROVING THE OFF SWITCH IS REAL, CORRECT, AND REACHABLE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS SEPARATE FROM wage-order-watch.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * That file proves the watchman WATCHES. This one proves it can be made to STOP
 * - honestly. They are different obligations with different failure modes, and
 * the second is the one people skip.
 *
 * The reason it matters this much: the watchman escalates to critical every
 * single day, indefinitely, once a support order's twenty-day deadline passes.
 * That is only defensible if there is a way to satisfy it, and if that way
 * records a FACT rather than an acknowledgement. If recording the answer were
 * broken, unreachable, or too easy to fake, the whole slice would be a machine
 * for training Michael to ignore alarms - which is strictly worse than shipping
 * no alarms at all.
 *
 * So there are three things to prove, and all three are here:
 *
 *   §1  every refusal is REACHABLE and says something useful   (rules 43, 48)
 *   §2  the honest paths through the validator actually succeed
 *   §3  the whole thing is WIRED - cron to planner, screen to write,
 *       and no snooze anywhere                                  (rule 50)
 */
import { describe, it, expect } from "vitest";

import {
  ALL_ANSWER_RECORD_REFUSAL_CODES,
  ANSWER_NEVER_WAIVABLE_KINDS,
  MIN_ANSWER_WAIVER_REASON_CHARS,
  validateAnswerRecord,
  type AnswerRecordDraft,
  type AnswerRecordRefusalCode,
} from "../../src/lib/payroll/wage-order-lifecycle-core";
import {
  alertKindsInCore,
  alertKindsTaught,
  answerColumnsSelectedByBoard,
  answerControlDelegatesToCore,
  answerRefusalCodesInCore,
  answerRefusalCodesTaught,
  answerFormUsesServerDate,
  answerWriteCallCounts,
  answerWriteChain,
  boardSharesOneAssessment,
  disabledRenderBranches,
  snoozeDetectorSelfTest,
  snoozePathsInAnswerFlow,
  waiverReasonLengthByLayer,
  watchAuthorityIdsResolve,
  watchCoreReusesStatutoryDays,
  watchmanWiring,
  workbenchSurfacesAlerts,
  WATCH_GATE_PATHS,
} from "../../src/lib/payroll/wage-order-watch-mentor-gates";
import {
  ANSWER_REFUSAL_LESSONS,
  WATCH_ALERT_LESSONS,
  WATCH_CHECKS,
  WATCH_LADDER,
  WATCH_LESSONS,
  WATCH_WORKED_EXAMPLES,
} from "../../src/lib/payroll/wage-order-watch-mentor";
import { existsSync, readFileSync } from "node:fs";

/** A draft claiming the answer was filed. */
function filed(over: Partial<AnswerRecordDraft> = {}): AnswerRecordDraft {
  return { filedAt: "2027-01-18", note: null, notRequired: false, waivedReason: null, ...over };
}

/** A draft claiming the order needs no answer. */
function waived(over: Partial<AnswerRecordDraft> = {}): AnswerRecordDraft {
  return {
    filedAt: null,
    note: null,
    notRequired: true,
    waivedReason: "IRS Form 668-W levy: no ch. 26.18 answer duty",
    ...over,
  };
}

/** Served 2027-01-04. Twenty-day answer therefore due 2027-01-24. */
const SERVED = "2027-01-04";
const TODAY = "2027-01-20";

/** Assert a refusal and hand it back for further inspection. */
function refusalOf(
  draft: AnswerRecordDraft,
  kind: string,
  served: string | null = SERVED,
  today: string = TODAY,
) {
  const res = validateAnswerRecord(draft, kind, served, today);
  expect(res.ok, "expected this draft to be refused, and it was accepted").toBe(false);
  if (res.ok) throw new Error("unreachable");
  return res.refusal;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  EVERY REFUSAL IS REACHABLE  (standing rule 43)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40c - every answer refusal code can actually happen", () => {
  it("NO_ANSWER_GIVEN - nothing entered at all", () => {
    const r = refusalOf(filed({ filedAt: null }), "creditor");
    expect(r.code).toBe("NO_ANSWER_GIVEN");
  });

  it("NO_ANSWER_GIVEN - a date this system will not accept", () => {
    // 01/02/2027 means January the second in one country and the first of
    // February in another. On a legal deadline that ambiguity is not tolerable,
    // so it is refused rather than parsed with a guess (standing rule 62d).
    const r = refusalOf(filed({ filedAt: "01/02/2027" }), "creditor");
    expect(r.code).toBe("NO_ANSWER_GIVEN");
    expect(r.fix).toContain("2027-01-18");
  });

  it("ANSWER_BEFORE_SERVICE - filed the day before it arrived", () => {
    const r = refusalOf(filed({ filedAt: "2027-01-03" }), "child_support");
    expect(r.code).toBe("ANSWER_BEFORE_SERVICE");
    // It must name BOTH dates. "Invalid date" would leave Michael guessing
    // which of the two to go and check (standing rule 64a).
    expect(r.message).toContain("2027-01-03");
    expect(r.message).toContain(SERVED);
  });

  it("ANSWER_IN_FUTURE - recording an intention as a fact", () => {
    const r = refusalOf(filed({ filedAt: "2027-01-25" }), "child_support");
    expect(r.code).toBe("ANSWER_IN_FUTURE");
    // This is the refusal that protects the whole design: post-dating would
    // switch the alarm off for something that has not been done.
    expect(`${r.message} ${r.fix}`.toLowerCase()).toContain("not been done");
  });

  it("BOTH_FILED_AND_WAIVED - two contradictory claims at once", () => {
    const r = refusalOf(
      { filedAt: "2027-01-18", note: null, notRequired: true, waivedReason: "a real reason" },
      "creditor",
    );
    expect(r.code).toBe("BOTH_FILED_AND_WAIVED");
  });

  it("WAIVER_REASON_TOO_SHORT - exemption ticked with no reason", () => {
    const r = refusalOf(waived({ waivedReason: null }), "federal_tax_levy");
    expect(r.code).toBe("WAIVER_REASON_TOO_SHORT");
  });

  it("WAIVER_REASON_TOO_SHORT - exemption ticked with 'n/a'", () => {
    // Proved at the boundary, not merely somewhere below it: one character
    // short must fail and the minimum itself must pass. A test that only used
    // an empty string would still pass if the rule were >= 1.
    const justUnder = "x".repeat(MIN_ANSWER_WAIVER_REASON_CHARS - 1);
    const r = refusalOf(waived({ waivedReason: justUnder }), "federal_tax_levy");
    expect(r.code).toBe("WAIVER_REASON_TOO_SHORT");

    const exactly = "x".repeat(MIN_ANSWER_WAIVER_REASON_CHARS);
    const ok = validateAnswerRecord(waived({ waivedReason: exactly }), "federal_tax_levy", SERVED, TODAY);
    expect(ok.ok, "the minimum length itself must be accepted").toBe(true);
  });

  it("WAIVER_FORBIDDEN_FOR_SUPPORT - the most important refusal in the slice", () => {
    for (const kind of ANSWER_NEVER_WAIVABLE_KINDS) {
      const r = refusalOf(waived(), kind);
      expect(r.code, `${kind} must never be waivable`).toBe("WAIVER_FORBIDDEN_FOR_SUPPORT");

      // It must explain the CONSEQUENCE, not merely refuse. The whole reason
      // this rule exists is that ticking the box looks harmless and exposes
      // Greenway to the entire support debt.
      const full = `${r.message} ${r.fix}`;
      expect(full).toContain("26.18.110");
      expect(full.toLowerCase()).toMatch(/entire support debt|100 percent|hundred percent/);
    }
  });

  it("a perfect waiver reason cannot rescue a support order", () => {
    // THE ATTACK THIS BLOCKS. Somebody worn down by daily critical reminders
    // writes a long, plausible, completely wrong justification. Length is not
    // the test; the order kind is, and no sentence can change it.
    const r = refusalOf(
      waived({
        waivedReason:
          "We are withholding the full ordered amount every period and remitting to the " +
          "registry on time, so an answer is unnecessary in substance.",
      }),
      "child_support",
    );
    expect(r.code).toBe("WAIVER_FORBIDDEN_FOR_SUPPORT");
  });

  it("every declared refusal code was exercised by the tests above", () => {
    // THE ANTI-VACUITY CHECK (standing rule 43). A refusal code that no input
    // can produce is dead law: it looks like protection in the source, it is
    // taught to Michael in the mentor, and it never fires. This re-derives the
    // set of codes actually reachable rather than trusting the list.
    const reached = new Set<AnswerRecordRefusalCode>();

    const attempts: ReadonlyArray<readonly [AnswerRecordDraft, string]> = [
      [filed({ filedAt: null }), "creditor"],
      [filed({ filedAt: "2027-01-03" }), "child_support"],
      [filed({ filedAt: "2027-01-25" }), "child_support"],
      [{ filedAt: "2027-01-18", note: null, notRequired: true, waivedReason: "reason" }, "creditor"],
      [waived({ waivedReason: null }), "federal_tax_levy"],
      [waived(), "child_support"],
    ];

    for (const [draft, kind] of attempts) {
      const res = validateAnswerRecord(draft, kind, SERVED, TODAY);
      if (!res.ok) reached.add(res.refusal.code);
    }

    for (const code of ALL_ANSWER_RECORD_REFUSAL_CODES) {
      expect(reached.has(code), `refusal code ${code} is unreachable - dead law`).toBe(true);
    }
    expect(reached.size).toBe(ALL_ANSWER_RECORD_REFUSAL_CODES.length);
  });

  it("no refusal is a bare boolean - each names a consequence and a fix", () => {
    // Standing rule 48. A refusal that only says "invalid" teaches the reader
    // to work around the machine rather than to understand it.
    const attempts: ReadonlyArray<readonly [AnswerRecordDraft, string]> = [
      [filed({ filedAt: null }), "creditor"],
      [filed({ filedAt: "2027-01-03" }), "child_support"],
      [filed({ filedAt: "2027-01-25" }), "child_support"],
      [{ filedAt: "2027-01-18", note: null, notRequired: true, waivedReason: "reason" }, "creditor"],
      [waived({ waivedReason: null }), "federal_tax_levy"],
      [waived(), "child_support"],
    ];

    for (const [draft, kind] of attempts) {
      const res = validateAnswerRecord(draft, kind, SERVED, TODAY);
      if (res.ok) continue;
      const { code, message, fix } = res.refusal;
      expect(message.length, `${code} message is too short to be an explanation`).toBeGreaterThan(60);
      expect(fix.length, `${code} fix is too short to be an instruction`).toBeGreaterThan(60);
      // Every refusal must say that nothing changed. Ambiguity about whether a
      // write landed is what makes people click a second time.
      expect(
        /nothing (was|has been) (recorded|changed)|was refused and nothing/i.test(message),
        `${code} does not say whether anything was written`,
      ).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE HONEST PATHS SUCCEED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40c - recording a real answer works", () => {
  it("accepts a filing date after service and on or before today", () => {
    const res = validateAnswerRecord(filed(), "child_support", SERVED, TODAY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.filedAt).toBe("2027-01-18");
    expect(res.notRequired).toBe(false);
    expect(res.waivedReason).toBeNull();
  });

  it("accepts filing on the day of service, and on today itself", () => {
    // Both boundaries, in both directions. Service and filing on the same day
    // is unusual but perfectly possible, and filing TODAY is the overwhelmingly
    // common case - an off-by-one here would refuse the normal path.
    expect(validateAnswerRecord(filed({ filedAt: SERVED }), "child_support", SERVED, TODAY).ok).toBe(true);
    expect(validateAnswerRecord(filed({ filedAt: TODAY }), "child_support", SERVED, TODAY).ok).toBe(true);
  });

  it("accepts a filing date when the service date was never recorded", () => {
    // NULL SERVICE MUST NOT BLOCK THE HONEST ACT. An order with no recorded
    // service date already draws a warning from the watchman; refusing to let
    // Michael record the answer as well would punish him twice for one gap and
    // leave the louder alarm running for a duty he has discharged.
    const res = validateAnswerRecord(filed(), "child_support", null, TODAY);
    expect(res.ok).toBe(true);
  });

  it("trims whitespace rather than storing it", () => {
    const res = validateAnswerRecord(
      { filedAt: "  2027-01-18  ", note: "  posted  ", notRequired: false, waivedReason: null },
      "creditor",
      SERVED,
      TODAY,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.filedAt).toBe("2027-01-18");
    expect(res.note).toBe("posted");
  });

  it("a blank note becomes null, not an empty string", () => {
    // An empty string in the database reads as "somebody wrote nothing here",
    // which is indistinguishable from "somebody wrote a note that vanished".
    const res = validateAnswerRecord(filed({ note: "   " }), "creditor", SERVED, TODAY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.note).toBeNull();
  });

  it("accepts a genuine exemption on a tax levy, and clears the date", () => {
    const res = validateAnswerRecord(waived(), "federal_tax_levy", SERVED, TODAY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.notRequired).toBe(true);
    expect(res.filedAt, "an exempt order must not also carry a filing date").toBeNull();
    expect(res.waivedReason).toContain("668-W");
  });

  it("nothing in the validator reads a clock", () => {
    // `today` is an ARGUMENT everywhere. If the function reached for
    // `new Date()` internally, this test would pass today and fail on
    // 2027-01-26 - the classic test that rots. Proved by source, not by hope.
    const src = readFileSync("src/lib/payroll/wage-order-lifecycle-core.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toContain("new Date()");
    expect(src).not.toContain("Date.now()");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  IT IS ACTUALLY WIRED  (standing rule 50)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40c - the gates report findings, so a green result means something", () => {
  it("every file the gates read exists and is substantial", () => {
    for (const p of WATCH_GATE_PATHS) {
      expect(existsSync(p), `gate path missing: ${p}`).toBe(true);
      expect(readFileSync(p, "utf8").length, `gate path is empty: ${p}`).toBeGreaterThan(500);
    }
  });

  it("the probes return non-empty answers", () => {
    // ANTI-VACUITY. If any of these came back empty, the assertions below would
    // pass for the wrong reason - a regex that matched nothing looks exactly
    // like a codebase with nothing wrong in it.
    expect(alertKindsInCore().length).toBeGreaterThan(0);
    expect(answerRefusalCodesInCore().length).toBeGreaterThan(0);
    expect(Object.keys(answerWriteCallCounts()).length).toBe(3);
    expect(watchAuthorityIdsResolve().named.length).toBeGreaterThan(0);
    expect(waiverReasonLengthByLayer().core).not.toBeNull();
    expect(waiverReasonLengthByLayer().database).not.toBeNull();
  });
});

describe("books-40c - the watchman is on duty", () => {
  it("the nightly reminder engine imports AND calls the wage order planner", () => {
    // THE DEFECT THIS PREVENTS. `planWageOrderReminders` has its own full test
    // file. Every one of those tests passes whether or not anything calls it.
    // A perfect, exhaustively tested planner wired to nothing sends zero
    // emails and breaks zero tests - which is exactly the state
    // `answerDeadlineFor()` was found in when this slice began.
    const w = watchmanWiring();
    expect(w.engineImportsPlanner, "the cron does not import the planner").toBe(true);
    expect(w.engineImportsSnapshot, "the cron cannot load wage orders").toBe(true);
    expect(w.engineCallsPlanner, "the planner is imported but never called").toBe(true);
  });

  it("the wage order planner cannot take the other reminders down with it", () => {
    // The engine runs several planners in one pass. An uncaught throw in the
    // new one would silence the CCRS upload window and the LIQ-1295 excise
    // return as collateral damage - two filings with their own penalties.
    const w = watchmanWiring();
    expect(w.plannerHasOwnTryCatch).toBe(true);
  });

  it("the engine runs four planners, not three", () => {
    // Recorded as a number so that deleting the wage order block is a test
    // failure rather than a silent reduction in coverage.
    expect(watchmanWiring().plannerCallCount).toBeGreaterThanOrEqual(4);
  });

  it("the board and the cron share ONE assessment of what is overdue", () => {
    // Two surfaces deriving "is this overdue" separately is how a board that
    // says fine and an email that says overdue land on the same desk on the
    // same morning. Both must call assessWageOrder, and the board must stamp
    // the Pacific date it measured from.
    const b = boardSharesOneAssessment();
    expect(b.boardCallsAssess).toBe(true);
    expect(b.boardUsesPacificToday).toBe(true);
    expect(b.boardExportsAsOf).toBe(true);
    expect(b.snapshotFeedsPlanner).toBe(true);
  });

  it("the reader actually selects the three columns the watchman needs", () => {
    // THE DEFECT THIS PREVENTS WAS REAL, TWICE. Migration 0201 added
    // `served_date` in books-38 and the entry form wrote it - and
    // loadGarnishmentBoard never selected it, so no deadline could be
    // computed and nothing failed, because nothing asked. Omit
    // `answer_filed_at` and the reverse happens: the watchman nags forever
    // about answers that were filed months ago.
    expect(answerColumnsSelectedByBoard()).toEqual([
      "served_date",
      "answer_filed_at",
      "answer_not_required",
    ]);
  });

  it("the watchman reuses books-38's statutory day counts instead of copying them", () => {
    // Standing rule 25. The twenty days of RCW 26.18.110(1) and the sixty of
    // RCW 6.27.350(1) are already implemented and mutation-proved next door. A
    // second copy is a second thing to keep right, and the two would drift on
    // a legal deadline.
    const r = watchCoreReusesStatutoryDays();
    expect(r.importsAnswerDeadline).toBe(true);
    expect(r.importsExpiryOutlook).toBe(true);
    expect(r.rivalTwenty, "a rival 20 appeared in the watch core").toEqual([]);
    expect(r.rivalSixty, "a rival 60 appeared in the watch core").toEqual([]);
  });
});

describe("books-40c - the off switch is reachable, and it is the only one", () => {
  it("recording an answer is callable from the screen, not just from a test", () => {
    // The same probe shape that reported 0/0/0 for three complete lifecycle
    // actions in books-38 and books-40. An unreachable off switch is worse
    // here than it was there: it would leave a daily critical alarm with no
    // way to satisfy it, which trains the reader to ignore all of them.
    const c = answerWriteCallCounts();
    expect(c.recordWageOrderAnswer).toBeGreaterThan(0);
    expect(c.recordWageOrderAnswerAction).toBeGreaterThan(0);
    expect(c.onRecordAnswer).toBeGreaterThan(0);
  });

  it("the off switch is connected at every hop, not just mentioned at each", () => {
    // WRITTEN BECAUSE A MUTATION GOT THROUGH. Severing the server action from
    // the write store left the import and the docblock in place, so the
    // name-counting test above still passed with healthy numbers while the
    // button did nothing at all. Counting a name proves somebody wrote it
    // down. It does not prove anybody calls it.
    //
    // Each boolean is one hop, so a break names the broken link rather than
    // announcing that something somewhere is wrong:
    //   page -> workbench -> control -> server action -> write store
    const chain = answerWriteChain();
    expect(chain.pageWiresAction, "page.tsx does not hand the action down").toBe(true);
    expect(chain.workbenchPassesToControl, "the workbench swallows the callback").toBe(true);
    expect(chain.controlInvokesCallback, "the control never awaits onRecord").toBe(true);
    expect(chain.actionInvokesStore, "the action never reaches the write store").toBe(true);
  });

  it("the answer form judges 'in the future' by the server's day, not the laptop's", () => {
    // A clock a day fast is ordinary, not exotic. If the browser supplies
    // `today`, such a machine renders a form that accepts a date the server
    // then refuses, and Michael watches the product contradict itself with no
    // way to tell which half is lying.
    const d = answerFormUsesServerDate();
    expect(d.boardStampsAsOf, "the board stopped stamping its Pacific date").toBe(true);
    expect(d.workbenchFeedsAsOf, "the control is not fed the server date").toBe(true);
    // `today ?? new Date()...` would look like defensive programming while
    // deleting the defence, so no clock read is tolerated in either client file.
    expect(d.clockReadsInClient, "a client file read a clock").toEqual([]);
  });

  it("the snooze detector can still detect a snooze", () => {
    // STANDING RULE 39, AND MUTATION TESTING PROVED IT WAS NEEDED HERE.
    // `snoozePathsInAnswerFlow()` returning [] is the result we want - and it
    // is also exactly what a detector that can no longer match anything
    // returns. The first version of the pattern demanded the whole word
    // `snooze`, so a mutation adding `const [snoozeUntil, setSnoozeUntil]`
    // sailed past it. That is not a contrived spelling; it is the first name
    // a React developer reaches for.
    const t = snoozeDetectorSelfTest();
    expect(t.mutantsCaught, `missed: ${t.missed.join(" | ")}`).toBe(t.mutantsTried);
    expect(t.mutantsTried).toBeGreaterThanOrEqual(7);

    // And it must not fire on this slice's own prose. A gate that cries wolf
    // gets disabled, and the tempting way to silence this one would be to
    // delete the paragraphs explaining why there is no dismiss button - the
    // exact opposite of what should happen.
    expect(t.proseFalsePositives).toEqual([]);
  });

  it("no part of the watch UI is switched off while still looking present", () => {
    // WRITTEN BECAUSE A MUTATION GOT THROUGH. Nobody deletes a feature they
    // are unsure about - they put `false &&` in front of it and mean to come
    // back. It compiles, it lints, the component is still imported, the props
    // are still passed, and `workbenchSurfacesAlerts()` still finds
    // `alerts.map(` sitting in the file, unreachable. Standing rule 50 in the
    // form it actually arrives in.
    expect(disabledRenderBranches()).toEqual([]);
  });

  it("the workbench renders the alerts and the outstanding count", () => {
    // Accepting a prop and never rendering it compiles perfectly and shows
    // nothing. TypeScript cannot tell the difference; this can.
    const w = workbenchSurfacesAlerts();
    expect(w.acceptsAlerts).toBe(true);
    expect(w.rendersAlerts).toBe(true);
    expect(w.acceptsOutstandingCount).toBe(true);
    expect(w.rendersOutstandingCount).toBe(true);
    expect(w.rendersAnswerControl).toBe(true);
  });

  it("there is no snooze, dismiss or mute anywhere in the answer path", () => {
    // THE DESIGN THIS DEFENDS IS THE WHOLE SLICE. A dismiss button collects
    // "Michael saw this message" instead of "the duty was discharged". Only
    // one of those is a defence under RCW 26.18.110(6), and the tempting one
    // is the wrong one. A future maintainer under pressure from a noisy inbox
    // will reach for it, and it will look like kindness.
    expect(snoozePathsInAnswerFlow()).toEqual([]);
  });

  it("the answer form asks the core instead of re-deciding in JSX", () => {
    // The failure guarded against passes every other test: somebody writes
    // `orderKind === "child_support" && <p>cannot waive</p>` inline. It
    // renders correctly on the day it is written, cannot be tested without a
    // browser, and drifts the first time the rule changes - at which point
    // the form and the server give different answers to the same question.
    const d = answerControlDelegatesToCore();
    expect(d.callsValidator, "the control does not call validateAnswerRecord()").toBe(true);
    expect(d.callsHasAnswerDuty, "the control does not call hasAnswerDuty()").toBe(true);
    expect(d.inlineKindComparisons, "the control re-decides order kinds in JSX").toEqual([]);
    expect(d.inlineDayArithmetic, "the control does its own date arithmetic").toEqual([]);
  });

  it("the five-character waiver rule is one number in one place", () => {
    // Three layers enforce it: the core, migration 0202's CHECK, and the form.
    // Three copies is three chances to disagree, and the disagreement shows up
    // as a form that accepts what the database then rejects - which reads to
    // Michael as the software being broken.
    const l = waiverReasonLengthByLayer();
    expect(l.core).toBe(MIN_ANSWER_WAIVER_REASON_CHARS);
    expect(l.database).toBe(MIN_ANSWER_WAIVER_REASON_CHARS);
    expect(l.controlImportsCore).toBe(true);
    expect(l.controlHasRivalLiteral, "the form declared its own copy of the number").toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  EVERYTHING VISIBLE IS TAUGHT  (standing rule 26)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-40c - Michael is never shown something nobody explained", () => {
  it("every alert kind the core can emit has a lesson", () => {
    const inCore = alertKindsInCore();
    const taught = new Set(alertKindsTaught());
    for (const k of inCore) {
      expect(taught.has(k), `alert kind "${k}" is shown to Michael with no lesson`).toBe(true);
    }
    // And the mentor teaches no phantom kinds - a lesson for an alert that
    // cannot fire is guidance about something he will never see.
    const core = new Set(inCore);
    for (const l of WATCH_ALERT_LESSONS) {
      expect(core.has(l.kind), `lesson for "${l.kind}" but the core never emits it`).toBe(true);
    }
    expect(WATCH_ALERT_LESSONS.length).toBe(inCore.length);
  });

  it("every refusal code has a lesson with a next step", () => {
    const taught = new Set(answerRefusalCodesTaught());
    for (const code of answerRefusalCodesInCore()) {
      expect(taught.has(code), `refusal "${code}" has no lesson`).toBe(true);
    }
    // The store can also refuse for reasons the pure validator never sees -
    // the row vanished, the database rejected the write, no credentials. Those
    // reach the same panel and need the same treatment.
    for (const code of ["NOT_FOUND", "READ_FAILED", "WRITE_FAILED", "NOT_CONFIGURED", "REFUSED"]) {
      expect(taught.has(code), `store refusal "${code}" has no lesson`).toBe(true);
    }
  });

  it("no lesson stops at describing the problem", () => {
    // Standing rule 64a: detection is not explanation. A refusal without a
    // next step is a dead end, and a dead end is where people start clicking
    // the same button repeatedly.
    for (const l of ANSWER_REFUSAL_LESSONS) {
      expect(l.whatItMeans.length, `${l.code}: whatItMeans too thin`).toBeGreaterThan(60);
      expect(l.whatToDo.length, `${l.code}: whatToDo too thin`).toBeGreaterThan(60);
    }
    for (const l of WATCH_ALERT_LESSONS) {
      expect(l.whatToDo.length, `${l.kind}: whatToDo too thin`).toBeGreaterThan(60);
      expect(l.ifIgnored.length, `${l.kind}: ifIgnored too thin`).toBeGreaterThan(60);
    }
  });

  it("the escalation ladder is described without hard-coded numbers drifting", () => {
    // Every rung interpolates the constant the watchman actually uses. This
    // proves the text moved with them rather than being typed once and left.
    const flat = WATCH_LADDER.map((r) => `${r.when} ${r.what} ${r.why}`).join(" ");
    expect(WATCH_LADDER.length).toBeGreaterThanOrEqual(6);
    expect(flat).toContain("10 days before the deadline");
    expect(flat).toContain("5 days before");
    expect(flat).toContain("60 days");
    // The indefinite rung is the one that must never quietly disappear.
    expect(flat.toLowerCase()).toContain("indefinitely");
  });

  it("the teaching covers the checklist, the examples and the traps", () => {
    expect(WATCH_CHECKS.length).toBeGreaterThanOrEqual(4);
    expect(WATCH_WORKED_EXAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(WATCH_LESSONS.length).toBeGreaterThanOrEqual(4);

    // The checklist must be a genuine ordering, not four items numbered 1.
    const orders = [...WATCH_CHECKS].map((c) => c.order).sort((a, b) => a - b);
    expect(new Set(orders).size).toBe(orders.length);

    // The single most valuable lesson on the screen: withholding correctly is
    // not answering. If it ever disappears, this notices.
    const flat = WATCH_LESSONS.map((l) => `${l.topic} ${l.plainEnglish} ${l.whyItMatters}`).join(" ");
    expect(flat.toLowerCase()).toContain("withholding perfectly is not answering");
  });

  it("every authority the watch screen names resolves in the real registry", () => {
    // A typo renders a blank card rather than an error, which is the worst
    // kind of failure: the screen looks finished and the law is missing.
    const { named, unresolved } = watchAuthorityIdsResolve();
    expect(named.length).toBe(4);
    expect(unresolved).toEqual([]);
  });
});
