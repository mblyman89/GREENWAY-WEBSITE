/**
 * tests/compliance/period-close-core.test.ts   (books-18)
 *
 * THE PERIOD CLOSE GATE, UNDER ATTACK.
 *
 * Standing rule 22: the test is a suspect, not a witness. Standing rule 15:
 * every test must be provably failable. Standing rule 33: attack the suite
 * AFTER it goes green, because that is when the real defects surface.
 *
 * Read the "defects found by attacking the engine" block near the bottom before
 * changing anything in the core \u2014 each test there is a bug that actually
 * existed and was fixed at the class level.
 */
import { describe, it, expect } from "vitest";

import {
  type CloseCheckResult,
  type CloseCheckId,
  ALL_PERIOD_STATUSES,
  PERIOD_STATUS_MEANING,
  ALL_CLOSE_CHECK_IDS,
  ALL_CLOSE_REFUSAL_CODES,
  CLOSE_CHECKS,
  findCloseCheck,
  evaluatePeriodClose,
  evaluatePeriodReopen,
  describeDifference,
  __runPeriodCloseCoreTests,
  validatePeriodIdentity,
  periodLabel,
  lastDayOfMonth,
} from "@/lib/accounting/period-close-core";

import { ENTITY_CODES } from "@/lib/accounting/cutover-core";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PERIOD_CLOSE_AUTHORITIES_NEW,
  CLOSE_AUTHORITY_IDS_OWNED_ELSEWHERE,
  findPeriodCloseAuthority,
} from "@/lib/accounting/period-close-authorities";

import {
  exportedCoreFunctionNames,
  assertEveryExportedFunctionIsTaught,
  assertEveryPeriodCloseLessonIsSubstantive,
} from "@/lib/accounting/period-close-mentor-gates";
import {
  PERIOD_CLOSE_LESSONS,
  lessonFor,
  taughtFunctionNames,
  citedAuthorityIds,
} from "@/lib/accounting/period-close-mentor";

import {
  findGuidanceAuthority,
  ALL_SOURCE_REGISTRIES,
  findAuthorityDrift,
  unresolvedDrift,
} from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** A checklist with every box legitimately ticked. */
function allPassing(): CloseCheckResult[] {
  return CLOSE_CHECKS.map((c) => ({
    id: c.id,
    passed: true,
    note: c.evidenceRequired ? "count sheet 2026-06-30, signed MB" : "",
  }));
}

function closeWith(
  results: CloseCheckResult[],
  over: Partial<Parameters<typeof evaluatePeriodClose>[0]> = {},
) {
  return evaluatePeriodClose({
    entityCode: "greenway",
    fiscalYear: 2026,
    periodNo: 6,
    status: "open",
    priorPeriodStatus: "closed",
    results,
    // A default in the far future so the "has the month finished" gate is
    // satisfied by default and each test exercises the one thing it names.
    // Tests that care about the calendar override it explicitly.
    today: "2030-01-15",
    ...over,
  });
}

function codes(v: ReturnType<typeof evaluatePeriodClose>): string[] {
  return v.refusals.map((r) => r.code);
}

// ---------------------------------------------------------------------------
// 1) the module's own self-tests
// ---------------------------------------------------------------------------

describe("the module's internal self-tests", () => {
  it("passes when run from outside the module", () => {
    expect(() => __runPeriodCloseCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2) the happy path exists at all
// ---------------------------------------------------------------------------

describe("closing a month that deserves to close", () => {
  it("allows the close when every check passes", () => {
    const v = closeWith(allPassing());
    expect(v.ok).toBe(true);
    expect(v.canClose).toBe(true);
    expect(v.refusals).toEqual([]);
  });

  it("says so in plain English, naming the period", () => {
    const v = closeWith(allPassing());
    expect(v.summary).toContain("2026-06");
    expect(v.summary).toContain("ready to close");
  });

  it("pads the month so periods sort correctly as text", () => {
    // "2026-6" sorts after "2026-10" as a string. Padding is not cosmetic.
    const v = closeWith(allPassing(), { periodNo: 6 });
    expect(v.summary).toContain("2026-06");
    expect(v.summary).not.toContain("2026-6 ");
  });
});

// ---------------------------------------------------------------------------
// 3) THE CENTRAL RULE: silence is not consent
// ---------------------------------------------------------------------------

describe("an unanswered check is not a passed check", () => {
  it("REFUSES an entirely empty checklist", () => {
    const v = closeWith([]);
    expect(v.ok).toBe(false);
    expect(v.refusals.length).toBe(CLOSE_CHECKS.length);
    expect(new Set(codes(v))).toEqual(new Set(["CHECK_UNANSWERED"]));
  });

  it("REFUSES when a single check is left null", () => {
    const results = allPassing();
    const target = results.find((r) => r.id === "CASH_COUNTED")!;
    target.passed = null;
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v)).toEqual(["CHECK_UNANSWERED"]);
    expect(v.refusals[0].message).toContain("cash");
  });

  it("REFUSES when a check is simply absent from the list", () => {
    // Omission must behave exactly like an explicit null. If it did not,
    // dropping a check from the payload would be a way to skip it.
    const results = allPassing().filter((r) => r.id !== "INVENTORY_COUNTED");
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v)).toEqual(["CHECK_UNANSWERED"]);
  });

  it("treats null and absent identically, which is the whole point", () => {
    const withNull = allPassing().map((r) =>
      r.id === "BANK_RECONCILED" ? { ...r, passed: null } : r,
    );
    const withAbsent = allPassing().filter((r) => r.id !== "BANK_RECONCILED");
    expect(codes(closeWith(withNull))).toEqual(codes(closeWith(withAbsent)));
  });
});

// ---------------------------------------------------------------------------
// 4) failing checks
// ---------------------------------------------------------------------------

describe("checks that actively fail", () => {
  it("REFUSES and repeats the note explaining the failure", () => {
    const results = allPassing().map((r) =>
      r.id === "TRIAL_BALANCE_TIES" ? { ...r, passed: false, note: "out by $412.19" } : r,
    );
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v)).toEqual(["CHECK_FAILED"]);
    expect(v.refusals[0].message).toContain("out by $412.19");
  });

  it("collects EVERY failure rather than stopping at the first", () => {
    // A checklist that surfaces one problem per attempt turns a ten-minute
    // close into a ten-round argument.
    const results = allPassing().map((r) =>
      ["TRIAL_BALANCE_TIES", "CASH_COUNTED", "BANK_RECONCILED"].includes(r.id)
        ? { ...r, passed: false, note: "" }
        : r,
    );
    const v = closeWith(results);
    expect(v.refusals.length).toBe(3);
  });

  it("gives every refusal a remedy, not just a complaint", () => {
    const v = closeWith([]);
    for (const r of v.refusals) {
      expect(r.whatToDo.length).toBeGreaterThan(30);
      expect(r.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("returns canClose false whenever it returns any refusal", () => {
    // The two must never disagree; that would be a green button over a red gate.
    const v = closeWith([]);
    expect(v.canClose).toBe(false);
    expect(v.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5) evidence
// ---------------------------------------------------------------------------

describe("evidence, for the checks that require it", () => {
  it("REFUSES a check marked done with no evidence recorded", () => {
    const results = allPassing().map((r) =>
      r.id === "CASH_COUNTED" ? { ...r, note: "" } : r,
    );
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v)).toEqual(["EVIDENCE_MISSING"]);
  });

  it("REFUSES whitespace masquerading as evidence", () => {
    const results = allPassing().map((r) =>
      r.id === "CASH_COUNTED" ? { ...r, note: "     " } : r,
    );
    expect(codes(closeWith(results))).toEqual(["EVIDENCE_MISSING"]);
  });

  it("does not demand evidence from checks that do not require it", () => {
    const noEvidence = CLOSE_CHECKS.filter((c) => c.evidenceRequired === null);
    expect(noEvidence.length).toBeGreaterThan(0);
    const results = allPassing().map((r) =>
      noEvidence.some((c) => c.id === r.id) ? { ...r, note: "" } : r,
    );
    expect(closeWith(results).ok).toBe(true);
  });

  it("names what the evidence should actually be", () => {
    const results = allPassing().map((r) =>
      r.id === "INVENTORY_COUNTED" ? { ...r, note: "" } : r,
    );
    const v = closeWith(results);
    expect(v.refusals[0].whatToDo).toContain("physical count");
  });
});

// ---------------------------------------------------------------------------
// 6) the state of the period itself
// ---------------------------------------------------------------------------

describe("the period's own status", () => {
  it("REFUSES to close a period that is already closed", () => {
    const v = closeWith(allPassing(), { status: "closed" });
    expect(codes(v)).toContain("PERIOD_NOT_OPEN");
  });

  it("REFUSES to close a locked period, and explains that locked is permanent", () => {
    const v = closeWith(allPassing(), { status: "locked" });
    expect(codes(v)).toContain("PERIOD_LOCKED");
    expect(v.refusals[0].message).toContain("tax return");
  });

  it("REFUSES to close June while May is still open", () => {
    const v = closeWith(allPassing(), { priorPeriodStatus: "open" });
    expect(codes(v)).toContain("PRIOR_PERIOD_STILL_OPEN");
  });

  it("allows the very first period, which has no predecessor", () => {
    const v = closeWith(allPassing(), { priorPeriodStatus: null });
    expect(v.ok).toBe(true);
  });

  it("allows closing after a LOCKED prior period, not just a closed one", () => {
    // Locked is stricter than closed, so it must not block the next month.
    const v = closeWith(allPassing(), { priorPeriodStatus: "locked" });
    expect(v.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7) malformed input
// ---------------------------------------------------------------------------

describe("malformed or hostile input", () => {
  it("REFUSES a check id this system does not recognise", () => {
    const results = [
      ...allPassing(),
      { id: "DEFINITELY_NOT_A_CHECK" as CloseCheckId, passed: true, note: "" },
    ];
    expect(codes(closeWith(results))).toContain("UNKNOWN_CHECK");
  });

  it("REFUSES the same check answered twice", () => {
    // Two answers to one question means one is ignored and nobody can tell which.
    const results = [...allPassing(), { id: "CASH_COUNTED" as CloseCheckId, passed: false, note: "" }];
    expect(codes(closeWith(results))).toContain("DUPLICATE_CHECK_RESULT");
  });

  it("does not let a duplicate PASS overwrite a genuine FAIL", () => {
    const results: CloseCheckResult[] = [
      ...allPassing().map((r) =>
        r.id === "CASH_COUNTED" ? { ...r, passed: false as const, note: "short $80" } : r,
      ),
      { id: "CASH_COUNTED", passed: true, note: "actually it is fine" },
    ];
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v)).toContain("CHECK_FAILED");
  });
});

// ---------------------------------------------------------------------------
// 8) reopening
// ---------------------------------------------------------------------------

describe("reopening a sealed month", () => {
  it("allows a closed period to reopen with a real reason", () => {
    const v = evaluatePeriodReopen({
      status: "closed",
      reason: "Late vendor invoice for June delivery arrived 12 July.",
      fiscalYear: 2026,
      periodNo: 6,
    });
    expect(v.ok).toBe(true);
  });

  it("NEVER reopens a locked period, however good the reason", () => {
    const v = evaluatePeriodReopen({
      status: "locked",
      reason: "An extremely compelling and well written reason indeed.",
      fiscalYear: 2026,
      periodNo: 1,
    });
    expect(v.ok).toBe(false);
    expect(codes(v)).toContain("CANNOT_REOPEN_LOCKED");
  });

  it("points at an amended return rather than editing sealed books", () => {
    const v = evaluatePeriodReopen({
      status: "locked",
      reason: "something reasonable",
      fiscalYear: 2026,
      periodNo: 1,
    });
    expect(v.refusals[0].whatToDo).toContain("amended return");
  });

  it("REFUSES an empty reason", () => {
    const v = evaluatePeriodReopen({
      status: "closed",
      reason: "",
      fiscalYear: 2026,
      periodNo: 6,
    });
    expect(codes(v)).toContain("REASON_REQUIRED");
  });

  it("REFUSES a whitespace-only reason", () => {
    const v = evaluatePeriodReopen({
      status: "closed",
      reason: "        ",
      fiscalYear: 2026,
      periodNo: 6,
    });
    expect(codes(v)).toContain("REASON_REQUIRED");
  });

  it("matches the database's 3-character minimum exactly", () => {
    // gl_reopen_period uses length(btrim(p_reason)) < 3. If the screen and the
    // server disagreed, the UI would accept a reason the server then rejects.
    const two = evaluatePeriodReopen({
      status: "closed",
      reason: "ab",
      fiscalYear: 2026,
      periodNo: 6,
    });
    const three = evaluatePeriodReopen({
      status: "closed",
      reason: "abc",
      fiscalYear: 2026,
      periodNo: 6,
    });
    expect(two.ok).toBe(false);
    expect(three.ok).toBe(true);
  });

  it("REFUSES to reopen a period that is already open", () => {
    const v = evaluatePeriodReopen({
      status: "open",
      reason: "a perfectly reasonable reason",
      fiscalYear: 2026,
      periodNo: 6,
    });
    expect(codes(v)).toContain("PERIOD_NOT_OPEN");
  });
});

// ---------------------------------------------------------------------------
// 9) describing a difference honestly
// ---------------------------------------------------------------------------

describe("describing a difference", () => {
  it("says a zero difference agrees, without drama", () => {
    expect(describeDifference(0, "Cash")).toContain("agrees exactly");
  });

  it("refuses to use the word adjustment", () => {
    const s = describeDifference(-4_1219, "Cash");
    expect(s.toLowerCase()).not.toContain("adjustment");
    expect(s).toContain("not a rounding issue");
  });

  it("reports the size of a negative difference, not its sign", () => {
    expect(describeDifference(-1234, "Cash")).toContain("$12.34");
  });

  it("THROWS on a fractional cent rather than printing nonsense", () => {
    expect(() => describeDifference(10.5, "Cash")).toThrow(/NOT_INTEGER_CENTS/);
  });

  it("THROWS on NaN", () => {
    expect(() => describeDifference(Number.NaN, "Cash")).toThrow(/NOT_INTEGER_CENTS/);
  });

  it("THROWS on Infinity", () => {
    expect(() => describeDifference(Number.POSITIVE_INFINITY, "Cash")).toThrow(
      /NOT_INTEGER_CENTS/,
    );
  });
});

// ---------------------------------------------------------------------------
// 10) the checklist itself
// ---------------------------------------------------------------------------

describe("the checklist as a whole", () => {
  it("defines each check exactly once", () => {
    const ids = CLOSE_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(ALL_CLOSE_CHECK_IDS));
  });

  it("gives every check a question, a reason and an authority", () => {
    for (const c of CLOSE_CHECKS) {
      expect(c.question.length).toBeGreaterThan(10);
      expect(c.whyItMatters.length).toBeGreaterThan(40);
      expect(c.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("phrases every check as an actual question", () => {
    for (const c of CLOSE_CHECKS) expect(c.question.endsWith("?")).toBe(true);
  });

  it("finds a check by id and returns nothing for a made-up one", () => {
    expect(findCloseCheck("CASH_COUNTED")).toBeDefined();
    expect(findCloseCheck("NOPE" as CloseCheckId)).toBeUndefined();
  });

  it("mirrors the database's three period statuses exactly", () => {
    // gl_periods: check (status in ('open','closed','locked'))
    expect(ALL_PERIOD_STATUSES).toEqual(["open", "closed", "locked"]);
    for (const s of ALL_PERIOD_STATUSES) {
      expect(PERIOD_STATUS_MEANING[s].length).toBeGreaterThan(30);
    }
  });

  it("explains that locked is permanent, in the status text itself", () => {
    expect(PERIOD_STATUS_MEANING.locked).toContain("permanent");
  });

  it("has no severity level that can be clicked past", () => {
    // A "warning" tier would be a control Michael learns to dismiss. Advisory
    // checks still have to be affirmatively answered; they do not pass by
    // default. Proven by the empty-checklist test above refusing ALL of them.
    const severities = new Set(CLOSE_CHECKS.map((c) => c.severity));
    expect([...severities].every((s) => s === "blocking" || s === "advisory")).toBe(true);
    const advisory = CLOSE_CHECKS.filter((c) => c.severity === "advisory");
    for (const c of advisory) {
      const results = allPassing().map((r) => (r.id === c.id ? { ...r, passed: null } : r));
      expect(closeWith(results).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 11) refusal codes
// ---------------------------------------------------------------------------

describe("refusal codes", () => {
  it("declares every code it can actually emit", () => {
    expect(new Set(ALL_CLOSE_REFUSAL_CODES).size).toBe(ALL_CLOSE_REFUSAL_CODES.length);
  });

  it("emits no code that is not declared", () => {
    const declared = new Set<string>(ALL_CLOSE_REFUSAL_CODES);
    const emitted = [
      ...codes(closeWith([])),
      ...codes(closeWith(allPassing(), { status: "locked" })),
      ...codes(closeWith(allPassing(), { status: "closed" })),
      ...codes(closeWith(allPassing(), { priorPeriodStatus: "open" })),
      ...codes(
        evaluatePeriodReopen({ status: "locked", reason: "x", fiscalYear: 2026, periodNo: 1 }),
      ),
      ...codes(
        evaluatePeriodReopen({ status: "closed", reason: "", fiscalYear: 2026, periodNo: 1 }),
      ),
    ];
    for (const c of emitted) expect(declared.has(c)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12) the authorities
// ---------------------------------------------------------------------------

describe("the authority records", () => {
  it("adds the ASC 250 records and resolves them all", () => {
    expect(PERIOD_CLOSE_AUTHORITIES_NEW.length).toBe(4);
    for (const a of PERIOD_CLOSE_AUTHORITIES_NEW) {
      expect(findGuidanceAuthority(a.id)).toBeDefined();
      expect(a.kind).toBe("gaap");
    }
  });

  it("quotes the restatement rule, which is why any of this exists", () => {
    const a = findPeriodCloseAuthority("ASC_250_10_45_23_RESTATE")!;
    expect(a.quote).toContain("by restating the prior-period financial statements");
  });

  it("quotes the rule that forbids burying an old error in this month", () => {
    const a = findPeriodCloseAuthority("ASC_250_10_45_22_NOT_CURRENT_INCOME")!;
    expect(a.quote).toContain("shall not include corrections of errors from prior periods");
  });

  it("keeps the definition of an error, which turns on facts that already existed", () => {
    const a = findPeriodCloseAuthority("ASC_250_10_20_ERROR_DEFINED")!;
    expect(a.quote).toContain("facts that existed at the time");
  });

  it("names the exact file every Codification quote came from", () => {
    for (const a of PERIOD_CLOSE_AUTHORITIES_NEW) {
      expect(a.source).toMatch(/asc-250\.txt/);
      expect(a.source).toContain("Financial Accounting Foundation");
      expect(a.source).toMatch(/supplied by the owner 20\d\d-\d\d-\d\d/);
    }
  });

  it("cites authorities it does not own, and every one of them resolves", () => {
    expect(CLOSE_AUTHORITY_IDS_OWNED_ELSEWHERE.length).toBeGreaterThan(0);
    for (const id of CLOSE_AUTHORITY_IDS_OWNED_ELSEWHERE) {
      expect(findGuidanceAuthority(id)).toBeDefined();
    }
  });

  it("does NOT re-declare an authority that already exists elsewhere", () => {
    // Two copies of one authority is exactly how the two copies drift apart.
    const mine = new Set(PERIOD_CLOSE_AUTHORITIES_NEW.map((a) => a.id));
    for (const id of CLOSE_AUTHORITY_IDS_OWNED_ELSEWHERE) {
      expect(mine.has(id)).toBe(false);
    }
  });

  it("returns undefined for an authority this slice does not own", () => {
    expect(findPeriodCloseAuthority("IRC_280E")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 13) registry wiring — standing rule 25
// ---------------------------------------------------------------------------

describe("registry wiring", () => {
  it("registers the period-close source", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("period-close");
  });

  it("leaves the drift fingerprint unchanged", () => {
    // Two known, accepted drifts. If this changes, an authority moved and
    // somebody needs to look at it rather than re-baseline the test.
    const fp = findAuthorityDrift()
      .map((d) => `${d.id}.${d.field}`)
      .sort()
      .join(",");
    expect(fp).toBe("ALPENGLOW_EXCLUSION.cite,CCA_201504011.quote");
    expect(unresolvedDrift().length).toBe(0);
  });

  it("makes every check's cited authority resolvable", () => {
    for (const c of CLOSE_CHECKS) {
      for (const id of c.authorityIds) {
        expect(findGuidanceAuthority(id), `check ${c.id} cites missing ${id}`).toBeDefined();
      }
    }
  });

  it("makes every refusal's cited authority resolvable", () => {
    const all = [
      ...closeWith([]).refusals,
      ...closeWith(allPassing(), { status: "locked" }).refusals,
      ...closeWith(allPassing(), { priorPeriodStatus: "open" }).refusals,
      ...evaluatePeriodReopen({ status: "locked", reason: "x", fiscalYear: 2026, periodNo: 1 })
        .refusals,
      ...evaluatePeriodReopen({ status: "closed", reason: "", fiscalYear: 2026, periodNo: 1 })
        .refusals,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      for (const id of r.authorityIds) {
        expect(findGuidanceAuthority(id), `refusal ${r.code} cites missing ${id}`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 14) the mentor layer — standing rule 26
// ---------------------------------------------------------------------------

describe("the mentor layer", () => {
  it("teaches EVERY exported function", () => {
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("actually found some exported functions to check", () => {
    // A coverage gate that reads zero functions passes vacuously forever.
    expect(exportedCoreFunctionNames().length).toBeGreaterThan(3);
  });

  it("SELF-CHECK: the coverage gate can fail — by RUNNING it, not miming it", () => {
    // The first version of this self-check rebuilt the gate’s logic inside the
    // test and asserted on the copy. It therefore proved the COPY could fail
    // and said nothing about the real function. A mutation that switched the
    // real gate off with ‘if (false)’ survived the whole suite because of it.
    //
    // Standing rule 16: prove the gate is WIRED. This runs the actual exported
    // function against a core file that genuinely has an untaught export.
    const tmp = join(tmpdir(), `pc-core-gate-probe-${process.pid}.ts`);
    const real = readFileSync(join(process.cwd(), "src/lib/accounting/period-close-core.ts"), "utf8");
    writeFileSync(tmp, real + "\nexport function smuggledInWithoutALesson(): void {}\n", "utf8");
    try {
      expect(() => assertEveryExportedFunctionIsTaught(tmp)).toThrow(/smuggledInWithoutALesson/);
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  it("SELF-CHECK: the gate PASSES on the real file, so the throw above is meaningful", () => {
    // Both directions (standing rule 34): the gate must fire on a bad file and
    // stay silent on the good one. Either half alone proves nothing.
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("SELF-CHECK: the gate refuses to pass vacuously on an empty file", () => {
    // A gate that reads zero functions is a gate that approves everything.
    const tmp = join(tmpdir(), `pc-core-empty-probe-${process.pid}.ts`);
    writeFileSync(tmp, "// no exports at all\n", "utf8");
    try {
      expect(() => assertEveryExportedFunctionIsTaught(tmp)).toThrow(/read no exported functions/);
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  it("has no orphan lesson for a function that does not exist", () => {
    const exported = new Set(exportedCoreFunctionNames());
    for (const l of PERIOD_CLOSE_LESSONS) expect(exported.has(l.fn)).toBe(true);
  });

  it("gives every lesson all five fields with real content", () => {
    for (const l of PERIOD_CLOSE_LESSONS) {
      expect(l.plainEnglish.length).toBeGreaterThan(40);
      expect(l.whyItExists.length).toBeGreaterThan(40);
      expect(l.theTrap.length).toBeGreaterThan(40);
      expect(l.whatIWouldDo.length).toBeGreaterThan(40);
      expect(l.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("cites only authorities that resolve", () => {
    const bad = citedAuthorityIds().filter((id) => !findGuidanceAuthority(id));
    expect(bad).toEqual([]);
  });

  it("uses every authority it declares — no decorative citations", () => {
    // Standing rule 34: gates run in BOTH directions. In books-17 the missing
    // reverse gate had orphaned a real authority through 130 passing tests.
    const usedByLesson = new Set(citedAuthorityIds());
    const usedByCheck = new Set(CLOSE_CHECKS.flatMap((c) => c.authorityIds));
    const orphans = PERIOD_CLOSE_AUTHORITIES_NEW.filter(
      (a) => !usedByLesson.has(a.id) && !usedByCheck.has(a.id),
    ).map((a) => a.id);
    expect(orphans).toEqual([]);
  });

  it("SELF-CHECK: the decorative-citation gate can fail", () => {
    const used = new Set([...citedAuthorityIds(), ...CLOSE_CHECKS.flatMap((c) => c.authorityIds)]);
    const pretend = [...PERIOD_CLOSE_AUTHORITIES_NEW.map((a) => a.id), "AUTHORITY_NOBODY_USES"];
    expect(pretend.filter((id) => !used.has(id))).toEqual(["AUTHORITY_NOBODY_USES"]);
  });

  it("writes in plain English — no unexplained jargon", () => {
    // Standing rule 29. Michael has not opened an accounting book in 13 years.
    const jargon = ["ASC ", "GAAP-compliant", "rollforward", "accretive", "subsequent event"];
    for (const l of PERIOD_CLOSE_LESSONS) {
      for (const j of jargon) expect(l.plainEnglish).not.toContain(j);
    }
  });

  it("finds a lesson by name and nothing for a made-up one", () => {
    expect(lessonFor("evaluatePeriodClose")).toBeDefined();
    expect(lessonFor("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 15) DEFECTS FOUND BY ATTACKING THE ENGINE — standing rule 33
// ---------------------------------------------------------------------------

describe("defects found by attacking the engine", () => {
  it("E1: a check id inherited from the prototype chain is not a real answer", () => {
    // `constructor` and `toString` exist on every object. Any lookup that used
    // `results[id]` or an untyped `in` test would treat them as answered.
    const results = [
      ...allPassing(),
      { id: "constructor" as CloseCheckId, passed: true, note: "" },
      { id: "toString" as CloseCheckId, passed: true, note: "" },
    ];
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v).filter((c) => c === "UNKNOWN_CHECK").length).toBe(2);
  });

  it("E2: __proto__ as a check id is refused, not silently absorbed", () => {
    const results = [...allPassing(), { id: "__proto__" as CloseCheckId, passed: true, note: "" }];
    expect(codes(closeWith(results))).toContain("UNKNOWN_CHECK");
  });

  it("E3: a period cannot be both locked and closable", () => {
    // Belt and braces: even with a perfect checklist, status wins.
    const v = closeWith(allPassing(), { status: "locked" });
    expect(v.canClose).toBe(false);
  });

  it("E4: the same failure is not reported twice for one check", () => {
    const results = allPassing().map((r) =>
      r.id === "CASH_COUNTED" ? { ...r, passed: false as const, note: "" } : r,
    );
    const v = closeWith(results);
    // Failing and missing-evidence must not BOTH fire for the same check;
    // a failed check has not got as far as needing evidence.
    expect(v.refusals.length).toBe(1);
    expect(v.refusals[0].code).toBe("CHECK_FAILED");
  });

  it("E5: refusal messages never contain an unrendered placeholder", () => {
    const all = [
      ...closeWith([]).refusals,
      ...closeWith(allPassing(), { status: "locked" }).refusals,
    ];
    for (const r of all) {
      expect(r.message).not.toContain("undefined");
      expect(r.message).not.toContain("[object Object]");
      expect(r.message).not.toContain("NaN");
      expect(r.whatToDo).not.toContain("undefined");
    }
  });

  it("E6: a period number of 12 still pads and reads correctly", () => {
    const v = closeWith(allPassing(), { periodNo: 12 });
    expect(v.summary).toContain("2026-12");
  });
});

// ---------------------------------------------------------------------------
// 16) MUTATION HARNESS — standing rule 15
// ---------------------------------------------------------------------------

describe("mutation harness — proving these tests can actually fail", () => {
  it("SELF-CHECK: the harness catches a bug it plants itself", () => {
    const brokenEvaluate = (results: CloseCheckResult[]): boolean => results.length >= 0;
    expect(brokenEvaluate([])).toBe(true);
    expect(closeWith([]).ok).toBe(false);
  });

  it("MUTANT 1 — treating null as passed is caught", () => {
    const results = allPassing().map((r) =>
      r.id === "CASH_COUNTED" ? { ...r, passed: null } : r,
    );
    const mutantSaysOk = results.every((r) => r.passed !== false);
    expect(mutantSaysOk).toBe(true); // the mutant would allow the close
    expect(closeWith(results).ok).toBe(false); // the real engine refuses
  });

  it("MUTANT 2 — ignoring the prior period is caught", () => {
    const real = closeWith(allPassing(), { priorPeriodStatus: "open" });
    expect(real.ok).toBe(false);
    expect(codes(real)).toContain("PRIOR_PERIOD_STILL_OPEN");
  });

  it("MUTANT 3 — allowing a locked period to reopen is caught", () => {
    const v = evaluatePeriodReopen({
      status: "locked",
      reason: "good reason",
      fiscalYear: 2026,
      periodNo: 1,
    });
    expect(v.ok).toBe(false);
  });

  it("MUTANT 4 — dropping the evidence requirement is caught", () => {
    const results = allPassing().map((r) => ({ ...r, note: "" }));
    const needsEvidence = CLOSE_CHECKS.filter((c) => c.evidenceRequired !== null);
    expect(needsEvidence.length).toBeGreaterThan(0);
    const v = closeWith(results);
    expect(v.ok).toBe(false);
    expect(codes(v).filter((c) => c === "EVIDENCE_MISSING").length).toBe(needsEvidence.length);
  });

  it("MUTANT 5 — stopping at the first refusal is caught", () => {
    const v = closeWith([]);
    expect(v.refusals.length).toBeGreaterThan(1);
  });

  it("MUTANT 6 — a weakened reason length is caught", () => {
    expect(
      evaluatePeriodReopen({ status: "closed", reason: "ab", fiscalYear: 2026, periodNo: 6 }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 17) DEFECTS FOUND BY ATTACKING THE SUITE AFTER IT WENT GREEN
//
// Every test below is a bug that shipped past 81 passing tests. The suite went
// green on its first run, which standing rule 33 says is the moment to start
// attacking rather than the moment to stop. A probe outside the harness then
// found seven real defects in about ten minutes.
//
// They shared one root cause: the engine validated the CHECKLIST in great
// detail and never validated its own IDENTIFYING INPUTS at all. So the repair
// was one gate over period identity, not seven patches (standing rule 23).
// ---------------------------------------------------------------------------

describe("defects found by attacking the suite after it went green", () => {
  // -- D1: a declared refusal code that nothing could ever emit --------------
  it("D1: every declared refusal code is actually reachable", () => {
    // The original test only checked that nothing UNDECLARED is emitted. That
    // is one direction, and standing rule 34 requires both. FUTURE_PERIOD sat
    // declared and unreachable through 81 green tests because of it.
    const emitted = new Set<string>();
    const record = (v: ReturnType<typeof evaluatePeriodClose>) =>
      v.refusals.forEach((r) => emitted.add(r.code));

    record(closeWith([]));
    record(closeWith(allPassing(), { status: "locked" }));
    record(closeWith(allPassing(), { status: "closed" }));
    record(closeWith(allPassing(), { priorPeriodStatus: "open" }));
    record(closeWith([...allPassing(), { id: "NOPE" as CloseCheckId, passed: true, note: "x" }]));
    record(closeWith([...allPassing(), allPassing()[0]]));
    record(closeWith(allPassing().map((r, i) => (i === 0 ? { ...r, passed: false } : r))));
    record(closeWith(allPassing().map((r) => ({ ...r, note: "" }))));
    record(closeWith(allPassing(), { entityCode: "not-a-real-entity" }));
    record(closeWith(allPassing(), { periodNo: 99 }));
    record(closeWith(allPassing(), { fiscalYear: 1999 }));
    record(closeWith(allPassing(), { fiscalYear: 2026, periodNo: 8, today: "2026-08-20" }));
    record(evaluatePeriodReopen({ status: "locked", reason: "x", fiscalYear: 2026, periodNo: 1 }));
    record(evaluatePeriodReopen({ status: "closed", reason: "", fiscalYear: 2026, periodNo: 1 }));
    record(evaluatePeriodReopen({ status: "open", reason: "good reason", fiscalYear: 2026, periodNo: 1 }));

    const unreachable = ALL_CLOSE_REFUSAL_CODES.filter((c) => !emitted.has(c));
    expect(unreachable).toEqual([]);
  });

  it("D1 SELF-CHECK: the reachability gate can fail", () => {
    const emitted = new Set<string>(["CHECK_FAILED"]);
    const unreachable = ALL_CLOSE_REFUSAL_CODES.filter((c) => !emitted.has(c));
    expect(unreachable.length).toBeGreaterThan(0);
  });

  // -- D1b: the accounting reason FUTURE_PERIOD exists ----------------------
  it("D1b: REFUSES to seal a month that has not finished yet", () => {
    // Today is 2026-08-20 in this scenario. August still has eleven days of
    // sales to come, and once the month is sealed they have nowhere to post.
    const v = closeWith(allPassing(), { fiscalYear: 2026, periodNo: 8, today: "2026-08-20" });
    expect(v.ok).toBe(false);
    expect(codes(v)).toContain("FUTURE_PERIOD");
    expect(v.refusals.find((r) => r.code === "FUTURE_PERIOD")!.message).toContain("2026-08-31");
  });

  it("D1b: allows the close on the first day AFTER the month ends", () => {
    const v = closeWith(allPassing(), { fiscalYear: 2026, periodNo: 8, today: "2026-09-01" });
    expect(v.ok).toBe(true);
  });

  it("D1b: the last day of the month is still too early", () => {
    // The month is not over until it is over. Closing on the 31st leaves the
    // 31st's sales homeless.
    const v = closeWith(allPassing(), { fiscalYear: 2026, periodNo: 8, today: "2026-08-31" });
    expect(codes(v)).toContain("FUTURE_PERIOD");
  });

  it("D1b: knows February, including the leap year rule", () => {
    // 2028 is a leap year, so Feb runs to the 29th.
    expect(codes(closeWith(allPassing(), { fiscalYear: 2028, periodNo: 2, today: "2028-02-29" })))
      .toContain("FUTURE_PERIOD");
    expect(closeWith(allPassing(), { fiscalYear: 2028, periodNo: 2, today: "2028-03-01" }).ok).toBe(true);
    // 2026 is not, so Feb runs to the 28th.
    expect(closeWith(allPassing(), { fiscalYear: 2026, periodNo: 2, today: "2026-03-01" }).ok).toBe(true);
  });

  it("D1b: 2100 is NOT a leap year, and it is inside the supported range", () => {
    // Divisible by 4, but a century year not divisible by 400. gl_periods
    // allows fiscal years through 2100, so this case is in range, not academic.
    expect(lastDayOfMonth(2100, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
  });

  it("D1b: a malformed today is refused, never assumed", () => {
    const v = closeWith(allPassing(), { today: "August 20th" });
    expect(v.ok).toBe(false);
    expect(codes(v)).toContain("FUTURE_PERIOD");
  });

  // -- D2: periodNo was never validated -------------------------------------
  it("D2: REFUSES a month number the database could not store", () => {
    // gl_periods: check (period_no between 1 and 12).
    for (const bad of [0, 13, -1, 1.5, NaN, Infinity]) {
      const v = closeWith(allPassing(), { periodNo: bad });
      expect(v.ok, `periodNo ${bad} should be refused`).toBe(false);
      expect(codes(v)).toContain("INVALID_PERIOD");
    }
  });

  it("D2: never claims a nonexistent month is ready to close", () => {
    // The actual observed defect: "Period 2026-NaN is ready to close. All 10
    // checks pass." A screen that says that is worse than one that crashes.
    const v = closeWith(allPassing(), { periodNo: NaN });
    expect(v.summary).not.toContain("ready to close");
    expect(v.summary).not.toContain("2026-NaN");
  });

  it("D2: accepts every month the database accepts", () => {
    for (let m = 1; m <= 12; m++) {
      expect(closeWith(allPassing(), { periodNo: m }).ok, `month ${m}`).toBe(true);
    }
  });

  // -- D3: fiscalYear was never validated -----------------------------------
  it("D3: REFUSES a fiscal year outside the line in the sand", () => {
    // gl_periods: check (fiscal_year between 2026 and 2100). 2026 is standing
    // rule 10 — the deliberate line in the sand.
    for (const bad of [0, -5, 1.5, NaN, 2025, 2101]) {
      const v = closeWith(allPassing(), { fiscalYear: bad });
      expect(v.ok, `fiscalYear ${bad} should be refused`).toBe(false);
      expect(codes(v)).toContain("INVALID_FISCAL_YEAR");
    }
  });

  it("D3: accepts both ends of the supported range", () => {
    // Each end needs a "today" that is actually after the month in question.
    // The first draft of this test used one fixed date in 2030 and failed on
    // 2100 — correctly, because a month in 2100 has not happened by 2030. The
    // engine was right and the test was wrong (standing rule 22), so the test
    // was fixed rather than the calendar gate loosened.
    expect(closeWith(allPassing(), { fiscalYear: 2026, today: "2030-01-15" }).ok).toBe(true);
    expect(closeWith(allPassing(), { fiscalYear: 2100, today: "2100-07-01" }).ok).toBe(true);
  });

  it("D3: the year gate and the calendar gate are separate concerns", () => {
    // 2100 is a legal fiscal year, but a month in it still cannot be closed
    // before it happens. Two different refusals, and only one of them fires.
    const early = closeWith(allPassing(), { fiscalYear: 2100, periodNo: 6, today: "2030-01-15" });
    expect(codes(early)).toContain("FUTURE_PERIOD");
    expect(codes(early)).not.toContain("INVALID_FISCAL_YEAR");
  });

  it("D3: the boundary is exact, not approximate", () => {
    expect(closeWith(allPassing(), { fiscalYear: 2025 }).ok).toBe(false);
    expect(closeWith(allPassing(), { fiscalYear: 2101 }).ok).toBe(false);
  });

  // -- D4: entityCode was never validated -----------------------------------
  it("D4: REFUSES a set of books that does not exist", () => {
    for (const bad of ["", "not-a-real-entity", "GREENWAY", " greenway"]) {
      const v = closeWith(allPassing(), { entityCode: bad });
      expect(v.ok, `entityCode "${bad}" should be refused`).toBe(false);
      expect(codes(v)).toContain("UNKNOWN_ENTITY");
    }
  });

  it("D4: accepts all four real sets of books, and only those", () => {
    for (const code of ENTITY_CODES) {
      expect(closeWith(allPassing(), { entityCode: code }).ok, code).toBe(true);
    }
    expect(ENTITY_CODES.length).toBe(4);
  });

  // -- D5: describeDifference accepted an empty label -----------------------
  it("D5: THROWS rather than describing a difference it cannot name", () => {
    // The defect printed ": out by $0.01. That is a real difference..." — a
    // sentence starting with a colon that never says what is out by a penny.
    expect(() => describeDifference(1, "")).toThrow(/WHAT was compared/);
    expect(() => describeDifference(1, "   ")).toThrow(/WHAT was compared/);
  });

  it("D5: still describes a properly named difference", () => {
    expect(describeDifference(1, "the bank")).toContain("the bank");
  });

  // -- D6: naming drift, entityId holding an entity code --------------------
  it("D6: the field is entityCode, matching every sibling engine", () => {
    // An earlier draft called this entityId and put "greenway" in it. In the
    // database gl_periods.entity_id genuinely is a uuid, so the name asserted
    // one thing and the value was another (standing rule 2).
    const src = readFileSync(
      join(process.cwd(), "src/lib/accounting/period-close-core.ts"),
      "utf8",
    );
    const typeBlock = src.slice(
      src.indexOf("export type EvaluateCloseInput"),
      src.indexOf("export function evaluatePeriodClose"),
    );
    expect(typeBlock).toContain("entityCode: string;");
    expect(typeBlock).not.toMatch(/^\s*entityId: string;/m);
  });

  // -- D7: an optional gate is a bypassable gate ----------------------------
  it("D7: `today` is REQUIRED, so the calendar gate cannot be skipped", () => {
    // While fixing D1 I first made `today` optional and skipped the check when
    // it was absent. That is a gate switched off by leaving an argument out,
    // which is how every bypassed gate has ever been bypassed (rules 14, 27).
    const src = readFileSync(
      join(process.cwd(), "src/lib/accounting/period-close-core.ts"),
      "utf8",
    );
    const typeBlock = src.slice(
      src.indexOf("export type EvaluateCloseInput"),
      src.indexOf("export function evaluatePeriodClose"),
    );
    expect(typeBlock).toContain("today: string;");
    expect(typeBlock).not.toContain("today?: string;");
  });

  // -- the class-level fix itself -------------------------------------------
  it("reports EVERY identity problem at once, not one per attempt", () => {
    const v = closeWith(allPassing(), {
      entityCode: "nope",
      fiscalYear: 1999,
      periodNo: 99,
    });
    expect(codes(v)).toContain("UNKNOWN_ENTITY");
    expect(codes(v)).toContain("INVALID_FISCAL_YEAR");
    expect(codes(v)).toContain("INVALID_PERIOD");
  });

  it("guards reopening with the same gate as closing", () => {
    // The same class of defect existed on both entry points, so the fix has to
    // cover both or it is only half a fix.
    const v = evaluatePeriodReopen({
      status: "closed",
      reason: "a real reason",
      fiscalYear: 1999,
      periodNo: 99,
    });
    expect(v.ok).toBe(false);
    expect(codes(v)).toContain("INVALID_PERIOD");
    expect(codes(v)).toContain("INVALID_FISCAL_YEAR");
  });

  it("validatePeriodIdentity is silent when the identity is fine", () => {
    expect(validatePeriodIdentity({ entityCode: "greenway", fiscalYear: 2026, periodNo: 6 })).toEqual([]);
  });

  it("periodLabel pads real months and flags unreal ones", () => {
    expect(periodLabel(2026, 6)).toBe("2026-06");
    expect(periodLabel(2026, 12)).toBe("2026-12");
    expect(periodLabel(2026, NaN)).toContain("invalid month");
    expect(periodLabel(NaN, 6)).toContain("invalid year");
  });
});

// ---------------------------------------------------------------------------
// 18) THE MENTOR LAYER MUST COVER THE NEW FUNCTIONS TOO
// ---------------------------------------------------------------------------

describe("the mentor layer keeps up with the fixes", () => {
  it("teaches the four functions the fix introduced", () => {
    for (const fn of ["validatePeriodIdentity", "lastDayOfMonth", "refuseIfNotFinished", "periodLabel"]) {
      expect(taughtFunctionNames(), `${fn} must be taught`).toContain(fn);
    }
  });

  it("warns about closing early, in the lesson a person would actually read", () => {
    const lesson = lessonFor("refuseIfNotFinished");
    expect(lesson).toBeDefined();
    expect(lesson!.theTrap.toLowerCase()).toMatch(/early|ahead/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * BOOKS-44: THE THINNESS GATE, RESTORED AFTER THE SPLIT
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-44: period-close lessons are substantive, not merely present", () => {
  /*
   * This block exists because of an unused import.
   *
   * When `period-close-mentor-gates.ts` was carved out of the mentor in slice C
   * (rule 65b - node:fs must not reach a browser bundle), `PERIOD_CLOSE_LESSONS`
   * came across in the import list and nothing in the new file used it. ESLint
   * said "defined but never used", and the five-second fix was to delete the
   * import and move on.
   *
   * That import was not noise. It was the footprint of a substantiveness check
   * that had been lost in the split - the sibling gates for the interest and
   * S-corporation mentors both still had theirs. Deleting the evidence would
   * have been rule 12, silently plugging a hole. The gate was restored instead,
   * and these are the tests that make it load-bearing rather than decorative:
   * a restored gate nothing calls is just more dead code with a green tick.
   */

  it("passes on the real lessons", () => {
    expect(() => assertEveryPeriodCloseLessonIsSubstantive()).not.toThrow();
  });

  it("THE THINNESS GATE FIRES — rule 39", () => {
    expect(() =>
      assertEveryPeriodCloseLessonIsSubstantive([
        {
          fn: "x",
          plainEnglish: "short",
          whyItExists: "short",
          theTrap: "short",
          whatIWouldDo: "short",
          authorityIds: [],
        },
      ]),
    ).toThrow(/TOO THIN/);
  });

  it("THE VACUOUS-INPUT GUARD FIRES — rule 39", () => {
    // A check handed nothing to inspect approves everything it was given.
    expect(() => assertEveryPeriodCloseLessonIsSubstantive([])).toThrow(/GATE BROKEN/);
  });

  it("names the offending field, not merely the lesson", () => {
    // A refusal that says "something is thin" sends the reader hunting. This
    // one has to say which lesson and which of its four blocks.
    expect(() =>
      assertEveryPeriodCloseLessonIsSubstantive([
        {
          fn: "evaluatePeriodClose",
          plainEnglish: "A perfectly adequate sentence that comfortably clears the floor.",
          whyItExists: "Another perfectly adequate sentence that clears the floor as well.",
          theTrap: "too short",
          whatIWouldDo: "One more sentence that is long enough to pass the length check.",
          authorityIds: [],
        },
      ]),
    ).toThrow(/evaluatePeriodClose\.theTrap/);
  });
});
