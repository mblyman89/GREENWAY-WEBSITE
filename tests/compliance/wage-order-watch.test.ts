/**
 * tests/compliance/wage-order-watch.test.ts   (books-40c)
 *
 * PROVING THE WATCHMAN ACTUALLY WATCHES.
 *
 * The failure this slice exists to prevent is not "the arithmetic is wrong".
 * books-38 already got the arithmetic right. The failure is that correct
 * arithmetic was wired to nothing, so it produced a number once and then went
 * quiet forever (standing rule 50).
 *
 * That shapes what these tests must prove. It is not enough to check that
 * assessWageOrder() returns something plausible. Every rung of both ladders
 * must be shown to be REACHABLE by moving only the date, and the quiet cases
 * must be shown to be genuinely quiet - because a watchman that alerts on
 * everything is muted within a week and is then worth less than no watchman
 * at all.
 */
import { describe, it, expect } from "vitest";

import {
  ALL_WAGE_ORDER_ALERT_KINDS,
  ANSWER_CRITICAL_DAYS,
  ANSWER_INFO_DAYS,
  ANSWER_WARNING_DAYS,
  assessWageOrder,
  CREDITOR_DIARY_PROMPT_DAYS,
  EXPIRY_CRITICAL_DAYS,
  EXPIRY_WARNING_DAYS,
  GARNISHMENTS_PATH,
  hasAnswerDuty,
  MAX_NAMED_IN_BODY,
  planWageOrderReminders,
  type WageOrderAlert,
  type WageOrderAlertKind,
  type WageOrderWatchFacts,
} from "../../src/lib/payroll/wage-order-watch-core";
import {
  CREDITOR_LIEN_DAYS,
  SUPPORT_ANSWER_DAYS,
} from "../../src/lib/payroll/wage-order-entry-core";

/** A support order served 2027-01-04, so the answer is due 2027-01-24. */
function supportOrder(
  over: Partial<WageOrderWatchFacts> = {},
): WageOrderWatchFacts {
  return {
    id: "wo-support-1",
    caseNumber: "CS-2027-001",
    employeeName: "Dana Reyes",
    orderKind: "child_support",
    servedDate: "2027-01-04",
    effectiveFrom: "2027-01-04",
    status: "active",
    answerFiledAt: null,
    answerNotRequired: false,
    ...over,
  };
}

/** A creditor writ effective 2027-01-04, so the lien ends 2027-03-05. */
function creditorOrder(
  over: Partial<WageOrderWatchFacts> = {},
): WageOrderWatchFacts {
  return {
    id: "wo-creditor-1",
    caseNumber: "GW-2027-777",
    employeeName: "Sam Okafor",
    orderKind: "creditor",
    servedDate: "2027-01-04",
    effectiveFrom: "2027-01-04",
    status: "active",
    answerFiledAt: null,
    answerNotRequired: false,
    ...over,
  };
}

function kinds(alerts: readonly WageOrderAlert[]): WageOrderAlertKind[] {
  return alerts.map((a) => a.kind);
}

/** Add days to an ISO date, for building "today" in each test. */
function iso(base: string, plusDays: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

// ===========================================================================
describe("the twenty-day answer ladder", () => {
  const SERVED = "2027-01-04";
  const DUE = iso(SERVED, SUPPORT_ANSWER_DAYS); // 2027-01-24

  it("the fixture really is the statutory twenty days (rule 39: not vacuous)", () => {
    // If this drifted, every "days remaining" assertion below would be
    // measuring a deadline this suite invented rather than the statutory one.
    expect(SUPPORT_ANSWER_DAYS).toBe(20);
    expect(DUE).toBe("2027-01-24");
  });

  it("says NOTHING in the quiet zone, which is what makes the noise credible", () => {
    // Day of service, and every day up to T-11. Eleven consecutive silent
    // days: proven by iteration, not by sampling one lucky date.
    for (let d = 0; d <= SUPPORT_ANSWER_DAYS - ANSWER_INFO_DAYS - 1; d++) {
      const today = iso(SERVED, d);
      expect(assessWageOrder(supportOrder(), today)).toEqual([]);
    }
  });

  it("opens with INFO at T-10, not earlier", () => {
    const dayBefore = iso(DUE, -(ANSWER_INFO_DAYS + 1));
    expect(assessWageOrder(supportOrder(), dayBefore)).toEqual([]);

    const at = assessWageOrder(supportOrder(), iso(DUE, -ANSWER_INFO_DAYS));
    expect(kinds(at)).toEqual(["answer_due_soon"]);
    expect(at[0].severity).toBe("info");
    expect(at[0].daysRemaining).toBe(ANSWER_INFO_DAYS);
  });

  it("climbs to WARNING at T-5 and CRITICAL at T-2", () => {
    const warn = assessWageOrder(supportOrder(), iso(DUE, -ANSWER_WARNING_DAYS));
    expect(warn[0].severity).toBe("warning");

    // The day before the warning rung must still be info, or the boundary is
    // not where the constant says it is.
    const stillInfo = assessWageOrder(
      supportOrder(),
      iso(DUE, -(ANSWER_WARNING_DAYS + 1)),
    );
    expect(stillInfo[0].severity).toBe("info");

    const crit = assessWageOrder(supportOrder(), iso(DUE, -ANSWER_CRITICAL_DAYS));
    expect(crit[0].severity).toBe("critical");

    const stillWarn = assessWageOrder(
      supportOrder(),
      iso(DUE, -(ANSWER_CRITICAL_DAYS + 1)),
    );
    expect(stillWarn[0].severity).toBe("warning");
  });

  it("says TODAY on the due date, and it is critical", () => {
    const a = assessWageOrder(supportOrder(), DUE);
    expect(kinds(a)).toEqual(["answer_due_today"]);
    expect(a[0].severity).toBe("critical");
    expect(a[0].daysRemaining).toBe(0);
    expect(a[0].headline).toContain("TODAY");
  });

  it("goes overdue the very next day and NEVER stops", () => {
    const first = assessWageOrder(supportOrder(), iso(DUE, 1));
    expect(kinds(first)).toEqual(["answer_overdue"]);
    expect(first[0].severity).toBe("critical");
    expect(first[0].daysRemaining).toBe(-1);
    expect(first[0].headline).toContain("OVERDUE by 1 day");

    // Two years later it is still shouting. RCW 26.18.110(6)(b) liability is
    // the whole support debt and does not lapse, so neither does this.
    const muchLater = assessWageOrder(supportOrder(), iso(DUE, 730));
    expect(kinds(muchLater)).toEqual(["answer_overdue"]);
    expect(muchLater[0].severity).toBe("critical");
    expect(muchLater[0].headline).toContain("OVERDUE by 730 days");
  });

  it("pluralises honestly at exactly one day", () => {
    const one = assessWageOrder(supportOrder(), iso(DUE, -1));
    expect(one[0].headline).toContain("1 day left");
    expect(one[0].headline).not.toContain("1 days");
  });

  it("names the RCW 26.18.110(6)(b) consequence, not just a date", () => {
    // A deadline without a consequence is a date. The whole point of these
    // alerts is that Michael can see what it costs to ignore them.
    const a = assessWageOrder(supportOrder(), DUE);
    expect(a[0].consequence).toContain("RCW 26.18.110(6)(b)");
    expect(a[0].consequence).toContain("100%");
    expect(a[0].whatToDoNow.length).toBeGreaterThan(40);
  });
});

// ===========================================================================
describe("the OFF switch - what migration 0202 bought", () => {
  const DUE = "2027-01-24";

  it("goes silent the moment the answer is recorded", () => {
    // Same order, same overdue date, one field different.
    const nagging = assessWageOrder(supportOrder(), iso(DUE, 5));
    expect(nagging.length).toBeGreaterThan(0);

    const answered = assessWageOrder(
      supportOrder({ answerFiledAt: "2027-01-20" }),
      iso(DUE, 5),
    );
    expect(answered).toEqual([]);
  });

  it("goes silent when the order is genuinely exempt", () => {
    const exempt = assessWageOrder(
      supportOrder({ answerNotRequired: true }),
      iso(DUE, 5),
    );
    expect(exempt).toEqual([]);
  });

  it("goes silent once the order is terminated", () => {
    const done = assessWageOrder(
      supportOrder({ status: "terminated" }),
      iso(DUE, 5),
    );
    expect(done).toEqual([]);
  });
});

// ===========================================================================
describe("creditor writs: refusing to guess is not the same as staying silent", () => {
  it("never invents a due date (rule 62d)", () => {
    const a = assessWageOrder(creditorOrder(), iso("2027-01-04", 10));
    const answerAlerts = a.filter((x) => x.kind.startsWith("answer_"));
    expect(answerAlerts).toHaveLength(1);
    expect(answerAlerts[0].kind).toBe("answer_deadline_unknown");
    // The critical property: no fabricated date, and no fabricated countdown.
    expect(answerAlerts[0].dueDate).toBeNull();
    expect(answerAlerts[0].daysRemaining).toBeNull();
  });

  it("still tells him to go and read the writ, and quotes the statute", () => {
    const a = assessWageOrder(creditorOrder(), iso("2027-01-04", 10));
    const unknown = a.find((x) => x.kind === "answer_deadline_unknown")!;
    expect(unknown.whatToDoNow).toContain("RCW 6.27.200");
    expect(unknown.whatToDoNow).toContain("time prescribed in the writ");
  });

  it("waits CREDITOR_DIARY_PROMPT_DAYS before prompting, then prompts", () => {
    const early = assessWageOrder(
      creditorOrder(),
      iso("2027-01-04", CREDITOR_DIARY_PROMPT_DAYS - 1),
    );
    expect(kinds(early)).not.toContain("answer_deadline_unknown");

    const due = assessWageOrder(
      creditorOrder(),
      iso("2027-01-04", CREDITOR_DIARY_PROMPT_DAYS),
    );
    expect(kinds(due)).toContain("answer_deadline_unknown");
  });
});

// ===========================================================================
describe("the sixty-day lien - the mistake that runs the other way", () => {
  const EFFECTIVE = "2027-01-04";
  const END = iso(EFFECTIVE, CREDITOR_LIEN_DAYS); // 2027-03-05

  it("the fixture really is the statutory sixty days (rule 39)", () => {
    expect(CREDITOR_LIEN_DAYS).toBe(60);
    expect(END).toBe("2027-03-05");
  });

  it("is quiet in the middle of the lien", () => {
    const mid = assessWageOrder(creditorOrder(), iso(EFFECTIVE, 20));
    expect(kinds(mid)).not.toContain("lien_expiring");
    expect(kinds(mid)).not.toContain("lien_expired");
  });

  it("warns at T-10 and escalates at T-3", () => {
    const quiet = assessWageOrder(
      creditorOrder(),
      iso(END, -(EXPIRY_WARNING_DAYS + 1)),
    );
    expect(kinds(quiet)).not.toContain("lien_expiring");

    const warn = assessWageOrder(creditorOrder(), iso(END, -EXPIRY_WARNING_DAYS));
    const w = warn.find((x) => x.kind === "lien_expiring")!;
    expect(w.severity).toBe("warning");

    const crit = assessWageOrder(creditorOrder(), iso(END, -EXPIRY_CRITICAL_DAYS));
    const c = crit.find((x) => x.kind === "lien_expiring")!;
    expect(c.severity).toBe("critical");
  });

  it("screams STOP WITHHOLDING once the lien has passed", () => {
    const a = assessWageOrder(creditorOrder(), iso(END, 1));
    const exp = a.find((x) => x.kind === "lien_expired")!;
    expect(exp.severity).toBe("critical");
    expect(exp.headline).toContain("EXPIRED 1 day ago");
    // Double damages is the fact that makes this urgent, and it must be said.
    expect(exp.consequence).toContain("RCW 49.52.070");
    expect(exp.consequence).toContain("TWICE");
    expect(exp.whatToDoNow).toContain("return it to the employee");
  });

  it("does NOT expire a support order, which is the classic error", () => {
    // Stopping a support order because "it has been a while" is the mirror
    // image of the creditor mistake, and it is just as expensive.
    const far = assessWageOrder(supportOrder({ answerFiledAt: "2027-01-05" }), "2028-06-01");
    expect(kinds(far)).not.toContain("lien_expiring");
    expect(kinds(far)).not.toContain("lien_expired");
    expect(far).toEqual([]);
  });

  it("does not police expiry on a suspended order", () => {
    const susp = assessWageOrder(
      creditorOrder({ status: "suspended", answerFiledAt: "2027-01-05" }),
      iso(END, 5),
    );
    expect(kinds(susp)).not.toContain("lien_expired");
  });
});

// ===========================================================================
describe("missing facts are surfaced, never filled in", () => {
  it("flags a support order with no service date instead of guessing one", () => {
    const a = assessWageOrder(supportOrder({ servedDate: null }), "2027-02-01");
    expect(kinds(a)).toEqual(["answer_deadline_unknown"]);
    expect(a[0].dueDate).toBeNull();
    expect(a[0].severity).toBe("warning");
    expect(a[0].whatToDoNow).toContain("delivery receipt");
  });

  it("treats a malformed service date as missing, not as a date", () => {
    const a = assessWageOrder(
      supportOrder({ servedDate: "8/22/2026" as string }),
      "2027-02-01",
    );
    expect(kinds(a)).toEqual(["answer_deadline_unknown"]);
  });

  it("refuses to plan at all when TODAY is malformed", () => {
    // A broken clock must produce silence, not alerts measured from nonsense.
    expect(assessWageOrder(supportOrder(), "not-a-date")).toEqual([]);
    expect(planWageOrderReminders("nope", [supportOrder()])).toEqual([]);
  });
});

// ===========================================================================
describe("hasAnswerDuty draws the line where the statutes do", () => {
  it("support and creditor writs carry a duty; tax levies do not", () => {
    expect(hasAnswerDuty("child_support")).toBe(true);
    expect(hasAnswerDuty("spousal_support")).toBe(true);
    expect(hasAnswerDuty("creditor")).toBe(true);
    expect(hasAnswerDuty("consumer_debt")).toBe(true);
    // An IRS 668-W is answered by returning the exemption certificate and
    // withholding, not by a sworn affidavit to a Washington court.
    expect(hasAnswerDuty("federal_tax_levy")).toBe(false);
    expect(hasAnswerDuty("state_tax_levy")).toBe(false);
    expect(hasAnswerDuty("student_loan")).toBe(false);
  });

  it("a federal tax levy therefore raises no answer alert at all", () => {
    const a = assessWageOrder(
      supportOrder({ orderKind: "federal_tax_levy" }),
      "2027-06-01",
    );
    expect(kinds(a)).not.toContain("answer_overdue");
  });
});

// ===========================================================================
describe("the planner the reminder engine consumes", () => {
  it("plans nothing when there is nothing wrong", () => {
    expect(planWageOrderReminders("2027-01-06", [supportOrder()])).toEqual([]);
    expect(planWageOrderReminders("2027-01-06", [])).toEqual([]);
  });

  it("batches criticals into ONE daily message rather than one per order", () => {
    const many = [
      supportOrder({ id: "a", caseNumber: "CS-A" }),
      supportOrder({ id: "b", caseNumber: "CS-B" }),
      supportOrder({ id: "c", caseNumber: "CS-C" }),
    ];
    const plans = planWageOrderReminders("2027-01-30", many);
    const crit = plans.filter((p) => p.urgency === "critical");
    expect(crit).toHaveLength(1);
    expect(crit[0].subject).toContain("3 wage-order deadlines");
    expect(crit[0].body).toContain("CS-A");
    expect(crit[0].body).toContain("CS-C");
  });

  it("re-fires criticals DAILY, because the key carries the date", () => {
    const day1 = planWageOrderReminders("2027-01-30", [supportOrder()]);
    const day2 = planWageOrderReminders("2027-01-31", [supportOrder()]);
    expect(day1[0].dedupeKey).not.toBe(day2[0].dedupeKey);
    expect(day1[0].dedupeKey).toContain("2027-01-30");
    expect(day2[0].dedupeKey).toContain("2027-01-31");
  });

  it("does NOT re-fire a warning every day - one message per rung", () => {
    // T-5 and T-4 are both "warning" for the same order. If these produced
    // different keys, Michael would get the same warning five mornings in a
    // row and would filter the whole channel to trash.
    const t5 = planWageOrderReminders("2027-01-19", [supportOrder()]);
    const t4 = planWageOrderReminders("2027-01-20", [supportOrder()]);
    expect(t5[0].urgency).toBe("warning");
    expect(t4[0].urgency).toBe("warning");
    expect(t5[0].dedupeKey).toBe(t4[0].dedupeKey);
  });

  it("DOES fire again when the rung changes, because the message changed", () => {
    const info = planWageOrderReminders("2027-01-14", [supportOrder()]);
    const warn = planWageOrderReminders("2027-01-19", [supportOrder()]);
    expect(info[0].urgency).toBe("info");
    expect(warn[0].urgency).toBe("warning");
    expect(info[0].dedupeKey).not.toBe(warn[0].dedupeKey);
  });

  it("caps how many cases it names, then says how many more there are", () => {
    const lots = Array.from({ length: MAX_NAMED_IN_BODY + 3 }, (_, i) =>
      supportOrder({ id: `id-${i}`, caseNumber: `CS-${i}` }),
    );
    const plans = planWageOrderReminders("2027-01-30", lots);
    const crit = plans.find((p) => p.urgency === "critical")!;
    expect(crit.body).toContain("and 3 more");
    expect(crit.body).toContain("CS-0");
    expect(crit.body).not.toContain("CS-7");
  });

  it("every reminder deep-links to the garnishments page", () => {
    const plans = planWageOrderReminders("2027-01-30", [supportOrder()]);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.linkPath).toBe(GARNISHMENTS_PATH);
      expect(p.linkLabel.length).toBeGreaterThan(0);
      expect(p.weekKey).toBeNull();
      expect(p.stage.startsWith("wage_order_watch")).toBe(true);
    }
  });

  it("warns in the footnote that criticals repeat daily, so it is not a bug", () => {
    const crit = planWageOrderReminders("2027-01-30", [supportOrder()])[0];
    expect(crit.footnote).toContain("EVERY DAY");
    const warn = planWageOrderReminders("2027-01-19", [supportOrder()])[0];
    expect(warn.footnote).toContain("not one every day");
  });

  it("puts the action in the body - an alert with no next step is noise", () => {
    const crit = planWageOrderReminders("2027-01-30", [supportOrder()])[0];
    expect(crit.body).toContain("WHAT TO DO NOW:");
  });
});

// ===========================================================================
describe("every declared alert kind is actually reachable (rule 43)", () => {
  it("no kind is declared but unproducible", () => {
    // A union member that no input can produce is dead code, and dead code in
    // an alerting system is a promise of protection that will never be kept.
    const produced = new Set<WageOrderAlertKind>();

    const scenarios: Array<[WageOrderWatchFacts, string]> = [
      [supportOrder(), "2027-01-14"], // due_soon
      [supportOrder(), "2027-01-24"], // due_today
      [supportOrder(), "2027-02-24"], // overdue
      [supportOrder({ servedDate: null }), "2027-02-01"], // unknown
      [creditorOrder({ answerFiledAt: "2027-01-05" }), "2027-02-28"], // expiring
      [creditorOrder({ answerFiledAt: "2027-01-05" }), "2027-03-10"], // expired
    ];
    for (const [facts, today] of scenarios) {
      for (const a of assessWageOrder(facts, today)) produced.add(a.kind);
    }

    for (const k of ALL_WAGE_ORDER_ALERT_KINDS) {
      expect(Array.from(produced)).toContain(k);
    }
    // And the list itself is not silently empty.
    expect(ALL_WAGE_ORDER_ALERT_KINDS.length).toBe(6);
  });

  it("every alert carries a statute id, a consequence and an action", () => {
    const all: WageOrderAlert[] = [
      ...assessWageOrder(supportOrder(), "2027-01-14"),
      ...assessWageOrder(supportOrder(), "2027-02-24"),
      ...assessWageOrder(supportOrder({ servedDate: null }), "2027-02-01"),
      ...assessWageOrder(creditorOrder({ answerFiledAt: "2027-01-05" }), "2027-03-10"),
    ];
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const a of all) {
      expect(a.authorityId.length).toBeGreaterThan(10);
      expect(a.consequence.length).toBeGreaterThan(60);
      expect(a.whatToDoNow.length).toBeGreaterThan(40);
      expect(a.headline).toContain(a.caseNumber);
    }
  });
});

// ===========================================================================
describe("ordering: the worst thing must be at the top", () => {
  it("sorts critical above warning above info", () => {
    // A creditor writ that is both unanswered (warning) and past its lien
    // (critical) must lead with the critical one.
    const both = assessWageOrder(creditorOrder(), "2027-03-10");
    expect(both.length).toBeGreaterThanOrEqual(2);
    expect(both[0].severity).toBe("critical");
    const severities = both.map((a) => a.severity);
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i - 1]]).toBeLessThanOrEqual(rank[severities[i]]);
    }
  });
});
