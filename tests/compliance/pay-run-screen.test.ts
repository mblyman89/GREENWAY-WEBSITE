/**
 * tests/compliance/pay-run-screen.test.ts   (books-39 phase G)
 *
 * THE PAY RUN SCREEN — behaviour, colour, and proof that it is reachable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `pay-run-ui-core.ts` exists so that the decisions on the pay-run screen can
 * be tested. This is the file that tests them. Everything here runs the real
 * exported functions against hand-built runs; nothing is asserted by reading
 * the source of the thing it is testing, except in the two sections that are
 * explicitly about wiring and about JSX that cannot be executed here.
 *
 * Rule 16 says prove it is WIRED. A screen that renders perfectly and appears
 * in no menu is dead code with a green check on it (rule 50), so section 6
 * asserts the navigation entry exists and points at the route that exists.
 *
 * Rule 15 says every gate must be provably failable. The colour section proves
 * the three statuses map to three DIFFERENT colours, which is the assertion
 * that would actually break if somebody "simplified" the three-state design
 * back into two.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";
import {
  PAY_RUN_CHECKS,
  PAY_RUN_RECOVERIES,
} from "@/lib/payroll/pay-run-mentor";
import type {
  PayRunLine,
  PayRunLineStatus,
  PayRunResult,
} from "@/lib/payroll/pay-run-core";
import type { PayRunLoadResult, PayRunStoreFailureCode } from "@/lib/payroll/pay-run-store";
import {
  blockedNames,
  checklistFor,
  countRefusal,
  employeeCard,
  moneyRows,
  nextAction,
  statusCounts,
  statusLabel,
  statusMeaning,
  statusTone,
  storeFailureCta,
  storeFailureHeadline,
  storeFailureHref,
} from "@/lib/payroll/pay-run-ui-core";

const ROOT = join(__dirname, "..", "..");
const PAGE_PATH = join(ROOT, "src/app/admin/books/pay-run/page.tsx");
const CORE_PATH = join(ROOT, "src/lib/payroll/pay-run-ui-core.ts");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const coreSrc = readFileSync(CORE_PATH, "utf8");

/**
 * Comments stripped, so a rule merely DESCRIBED in prose cannot satisfy a test
 * looking for the rule IMPLEMENTED in code. Both files carry long headers by
 * design, and those headers name most of the identifiers asserted below.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const coreCode = stripComments(coreSrc);

/* ═══════════════════════════════════════════════════════════════════════════
 * BUILDERS — hand-built runs, so every branch can be reached on purpose
 * ═══════════════════════════════════════════════════════════════════════════ */

function line(over: Partial<PayRunLine> = {}): PayRunLine {
  return {
    employeeId: "e1",
    employeeName: "Dana Reed",
    status: "ready",
    breakdown: null,
    taxes: null,
    w4Provenance: "furnished",
    refusals: [],
    attentionNotes: [],
    engineNotes: [],
    netPayCents: 150_000,
    grossWagesCents: 200_000,
    totalGarnishedCents: 0,
    ...over,
  } as PayRunLine;
}

function result(over: Partial<PayRunResult> = {}): PayRunResult {
  const lines = over.lines ?? [line()];
  const readyCount = lines.filter((l) => l.status === "ready").length;
  const attentionCount = lines.filter((l) => l.status === "attention").length;
  const blockedCount = lines.filter((l) => l.status === "blocked").length;
  return {
    payDateIso: "2027-01-01",
    lines,
    readyCount,
    attentionCount,
    blockedCount,
    totalNetPayCents: lines.reduce((n, l) => n + (l.netPayCents ?? 0), 0),
    totalGrossWagesCents: lines.reduce((n, l) => n + (l.grossWagesCents ?? 0), 0),
    totalGarnishedCents: lines.reduce((n, l) => n + l.totalGarnishedCents, 0),
    canPay: blockedCount === 0,
    summary: "",
    ...over,
  } as PayRunResult;
}

function loaded(over: Partial<Extract<PayRunLoadResult, { ok: true }>> = {}) {
  return {
    ok: true as const,
    periodLabel: "2027 period 1",
    periodStartDate: "2026-12-19",
    periodEndDate: "2027-01-01",
    payDateIso: "2027-01-01",
    periodStatus: "planned" as const,
    result: result(),
    unreadableW4EmployeeIds: [],
    ...over,
  };
}

function failure(code: PayRunStoreFailureCode): PayRunLoadResult {
  return {
    ok: false,
    code,
    message: "Something specific went wrong.",
    whatToDo: "Do this specific thing.",
    missingRates: [],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 0) THE HELPERS ARE NOT VACUOUS (rule 39)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("0 the source readers actually read something", () => {
  it("leaves real code behind after stripping comments", () => {
    // If either were empty, every source assertion below would pass vacuously.
    expect(pageCode.length).toBeGreaterThan(2000);
    expect(coreCode.length).toBeGreaterThan(2000);
  });

  it("the headers really were stripped, not merely shortened", () => {
    // Positive control: a phrase existing ONLY in prose must be gone.
    expect(pageSrc).toContain("blatantly obvious how to proceed");
    expect(pageCode).not.toContain("blatantly obvious how to proceed");
  });

  it("does not eat the // inside a URL", () => {
    expect(stripComments('const u = "https://example.com/x";')).toContain(
      "https://example.com/x",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) COLOUR — the three-state design must survive contact with the screen
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("1 colour", () => {
  const ALL: readonly PayRunLineStatus[] = ["ready", "attention", "blocked"];

  it("maps the three statuses to three DIFFERENT tones", () => {
    // THE test of this slice's design. pay-run-core.ts argues at length that
    // `attention` must not be folded into `ready`. If both were green, that
    // whole argument would have been undone by the stylesheet, silently.
    const tones = ALL.map(statusTone);
    expect(new Set(tones).size).toBe(3);
  });

  it("blocked is the danger colour and ready is the accent colour", () => {
    expect(statusTone("blocked")).toBe("danger");
    expect(statusTone("ready")).toBe("green");
  });

  it("attention is gold, NOT orange", () => {
    // Orange in this admin reads as "something is wrong with this number".
    // Nothing is wrong with this number - the paperwork is what needs work.
    expect(statusTone("attention")).toBe("gold");
  });

  it("every status has a distinct written label, so colour is never the only signal", () => {
    const labels = ALL.map(statusLabel);
    expect(new Set(labels).size).toBe(3);
    for (const l of labels) expect(l.length).toBeGreaterThan(4);
  });

  it("the attention label does not read like a failure", () => {
    // Somebody reading only the chip must not conclude the cheque is wrong.
    const l = statusLabel("attention").toLowerCase();
    expect(l).toContain("payable");
  });

  it("the attention MEANING leads with 'pay this cheque'", () => {
    // The failure mode designed against: Michael sees a coloured chip and
    // holds somebody's wages over it. That is unlawful, so the sentence has to
    // say "pay" before it says anything else.
    const m = statusMeaning("attention");
    expect(m.toLowerCase().indexOf("pay this cheque")).toBe(0);
    expect(m).toContain("legally required");
  });

  it("no status meaning is a dead end", () => {
    for (const s of ALL) {
      const m = statusMeaning(s);
      expect(m.length).toBeGreaterThan(40);
      expect(m).not.toMatch(/contact support|check your configuration|an error occurred/i);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE SINGLE NEXT ACTION — priority order
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("2 nextAction picks exactly one thing, in the right order", () => {
  it("a store failure outranks everything", () => {
    const a = nextAction(failure("RATES_NOT_ON_FILE"));
    expect(a.tone).toBe("danger");
    expect(a.canApprove).toBe(false);
    // It repeats the store's own words rather than inventing new ones.
    expect(a.detail).toContain("Do this specific thing.");
  });

  it("a locked period cannot be approved, even when everything computed", () => {
    // The double-payment guard. Everything below is green; the answer is still
    // "no", because this period has already been paid.
    const a = nextAction(loaded({ periodStatus: "locked" }));
    expect(a.canApprove).toBe(false);
    expect(a.headline.toLowerCase()).toContain("closed");
  });

  it("a blocked line stops the whole run, not just its own line", () => {
    const a = nextAction(
      loaded({
        result: result({
          lines: [line(), line({ employeeId: "e2", employeeName: "Sam Voss", status: "blocked" })],
        }),
      }),
    );
    expect(a.canApprove).toBe(false);
    expect(a.tone).toBe("danger");
    // It NAMES the person. "1 employee is blocked" makes Michael go looking.
    expect(a.detail).toContain("Sam Voss");
  });

  it("names every blocked person, not just the first", () => {
    const a = nextAction(
      loaded({
        result: result({
          lines: [
            line({ employeeId: "a", employeeName: "Ann Poe", status: "blocked" }),
            line({ employeeId: "b", employeeName: "Bo Katz", status: "blocked" }),
            line({ employeeId: "c", employeeName: "Cy Lund", status: "blocked" }),
          ],
        }),
      }),
    );
    expect(a.detail).toContain("Ann Poe");
    expect(a.detail).toContain("Bo Katz");
    expect(a.detail).toContain("Cy Lund");
  });

  it("an unreadable W-4 outranks ordinary attention, and says why it differs from a missing one", () => {
    const a = nextAction(
      loaded({
        unreadableW4EmployeeIds: ["e9"],
        result: result({ lines: [line({ status: "attention", attentionNotes: ["x"] })] }),
      }),
    );
    expect(a.tone).toBe("orange");
    expect(a.canApprove).toBe(false);
    // The distinction that stops a damaged record being treated as a new hire.
    expect(a.detail).toContain("NOT the same as having no W-4");
    expect(a.href).toBe("/admin/books/payroll-setup");
  });

  it("an empty run is never reported as success", () => {
    const a = nextAction(loaded({ result: result({ lines: [] }) }));
    expect(a.canApprove).toBe(false);
    expect(a.href).toBe("/admin/books/timesheets");
  });

  it("attention alone is approvable, and the wording is approve-THEN-fix", () => {
    const a = nextAction(
      loaded({
        result: result({
          lines: [line({ status: "attention", attentionNotes: ["No signed W-4 on file"] })],
        }),
      }),
    );
    expect(a.canApprove).toBe(true);
    expect(a.tone).toBe("gold");
    // The exact phrase from the core. Asserted verbatim because THIS is the
    // sentence that stops Michael holding somebody's wages over paperwork.
    expect(a.detail).toContain("none of them is a reason to hold anybody's pay");
  });

  it("a clean run is approvable and states the total", () => {
    const a = nextAction(loaded());
    expect(a.canApprove).toBe(true);
    expect(a.tone).toBe("green");
    expect(a.detail).toContain("$1,500.00");
    // Approving is not paying, and the sentence says so.
    expect(a.detail).toContain("does not move money");
  });

  it("every branch produces a non-empty headline, detail and cta", () => {
    const cases: PayRunLoadResult[] = [
      failure("NOT_CONFIGURED"),
      failure("READ_FAILED"),
      failure("NO_SUCH_PERIOD"),
      failure("RATES_NOT_ON_FILE"),
      loaded({ periodStatus: "locked" }),
      loaded({ result: result({ lines: [line({ status: "blocked" })] }) }),
      loaded({ unreadableW4EmployeeIds: ["x"] }),
      loaded({ result: result({ lines: [] }) }),
      loaded({ result: result({ lines: [line({ status: "attention" })] }) }),
      loaded(),
    ];
    for (const c of cases) {
      const a = nextAction(c);
      expect(a.headline.length, JSON.stringify(a)).toBeGreaterThan(10);
      expect(a.detail.length).toBeGreaterThan(40);
      expect(a.cta.length).toBeGreaterThan(3);
    }
  });

  it("no action text is a dead end", () => {
    const cases: PayRunLoadResult[] = [
      failure("RATES_NOT_ON_FILE"),
      loaded({ result: result({ lines: [line({ status: "blocked" })] }) }),
      loaded(),
    ];
    for (const c of cases) {
      expect(nextAction(c).detail).not.toMatch(
        /contact support|check your configuration|try again later/i,
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) STORE FAILURES — four codes, four different destinations
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("3 store failures are translated, not generalised", () => {
  const CODES: readonly PayRunStoreFailureCode[] = [
    "NOT_CONFIGURED",
    "READ_FAILED",
    "NO_SUCH_PERIOD",
    "RATES_NOT_ON_FILE",
  ];

  it("every code has its own headline", () => {
    // A shared "could not load" heading would send Michael to the wrong place
    // three times out of four.
    const heads = CODES.map(storeFailureHeadline);
    expect(new Set(heads).size).toBe(CODES.length);
  });

  it("every code has a non-empty cta", () => {
    for (const c of CODES) expect(storeFailureCta(c).length).toBeGreaterThan(3);
  });

  it("the two codes with a real destination point at pages that exist", () => {
    expect(storeFailureHref("NO_SUCH_PERIOD")).toBe("/admin/books/timesheets");
    expect(storeFailureHref("RATES_NOT_ON_FILE")).toBe("/admin/books/payroll-setup");
    for (const href of ["/admin/books/timesheets", "/admin/books/payroll-setup"]) {
      expect(existsSync(join(ROOT, "src/app", href, "page.tsx")), `${href} must exist`).toBe(
        true,
      );
    }
  });

  it("the two codes with nowhere to send him say null rather than inventing a link", () => {
    expect(storeFailureHref("NOT_CONFIGURED")).toBeNull();
    expect(storeFailureHref("READ_FAILED")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("4 the checklist", () => {
  it("shows every mentor check, in the mentor's order", () => {
    const rows = checklistFor(loaded());
    expect(rows.length).toBe(PAY_RUN_CHECKS.length);
    const orders = rows.map((r) => r.check.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("never leaves a row without evidence", () => {
    for (const r of checklistFor(loaded())) {
      expect(r.evidence.length, r.check.key).toBeGreaterThan(30);
    }
  });

  it("does NOT auto-tick the checks software cannot answer", () => {
    // The heart of it. A checklist that ticks itself is a checklist nobody
    // reads, and its ticks are worth nothing in an audit.
    const rows = checklistFor(loaded());
    const byKey = new Map(rows.map((r) => [r.check.key, r]));
    expect(byKey.get("read-three-cheques")?.answered).toBe("you-must-confirm");
    expect(byKey.get("ytd-carried-in")?.answered).toBe("you-must-confirm");
    expect(byKey.get("orders-current")?.answered).toBe("you-must-confirm");
  });

  it("the read-three-cheques row admits it cannot be automated", () => {
    const row = checklistFor(loaded()).find((r) => r.check.key === "read-three-cheques");
    expect(row?.evidence).toContain("will not pretend");
  });

  it("answers the checks it CAN answer from a clean run", () => {
    // Rule 39: if nothing ever answered "yes", the previous test would pass for
    // the wrong reason - because the whole checklist was stuck.
    const rows = checklistFor(loaded());
    expect(rows.some((r) => r.answered === "yes")).toBe(true);
  });

  it("goes red on the W-4 row when somebody is on the statutory default", () => {
    const rows = checklistFor(
      loaded({
        result: result({ lines: [line({ w4Provenance: "statutory_default_no_w4" })] }),
      }),
    );
    const row = rows.find((r) => r.check.key === "w4-on-file");
    expect(row?.answered).toBe("no");
    // ...and still says the cheque is correct, because it is.
    expect(row?.evidence).toContain("lawful treatment");
  });

  it("distinguishes an unreadable W-4 from a missing one on the W-4 row", () => {
    const rows = checklistFor(loaded({ unreadableW4EmployeeIds: ["z"] }));
    const row = rows.find((r) => r.check.key === "w4-on-file");
    expect(row?.evidence).toContain("damaged record");
  });

  it("goes red on punches when somebody has no hours", () => {
    const rows = checklistFor(
      loaded({
        result: result({
          lines: [
            line({
              status: "blocked",
              refusals: [{ code: "NO_HOURS", message: "m", whatToDo: "w" }],
            }),
          ],
        }),
      }),
    );
    expect(rows.find((r) => r.check.key === "punches-clean")?.answered).toBe("no");
  });

  it("answers nothing when the read itself failed, and says why", () => {
    const rows = checklistFor(failure("READ_FAILED"));
    expect(rows.every((r) => r.answered === "no")).toBe(true);
    expect(rows[0]?.evidence).toContain("cannot be answered yet");
  });

  it("tone follows the answer, and confirm-rows are gold not green", () => {
    for (const r of checklistFor(loaded())) {
      if (r.answered === "yes") expect(r.tone).toBe("green");
      if (r.answered === "no") expect(r.tone).toBe("danger");
      if (r.answered === "you-must-confirm") expect(r.tone).toBe("gold");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) EMPLOYEE CARDS AND MONEY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("5 the per-employee card", () => {
  it("shows money as a dash, never as $0.00, when the line is blocked", () => {
    // $0.00 is a number Michael could read as a real cheque for nothing.
    const c = employeeCard(
      line({ status: "blocked", netPayCents: null, grossWagesCents: null }),
    );
    expect(c.netPay).toBeNull();
    expect(c.grossWages).toBeNull();
  });

  it("formats money with a dollar sign and thousands separator", () => {
    expect(employeeCard(line()).netPay).toBe("$1,500.00");
  });

  it("puts blockers before attention notes before engine notes", () => {
    // Descending order of "will this stop me being paid". A card leading with
    // an L&I rate note and burying "no hours" would be useless.
    const c = employeeCard(
      line({
        status: "blocked",
        refusals: [{ code: "NO_HOURS", message: "m", whatToDo: "w" }],
        attentionNotes: ["attention thing"],
        engineNotes: ["engine thing"],
      }),
    );
    expect(c.problems.length).toBe(3);
    expect(c.problems[0]?.tone).toBe("danger");
    expect(c.problems[1]?.tone).toBe("gold");
    expect(c.problems[2]?.tone).toBe("neutral");
  });

  it("prefers the refusal's own whatToDo over the generic lesson", () => {
    // The refusal was built from THIS run and can name this person and period.
    const c = employeeCard(
      line({
        status: "blocked",
        refusals: [
          { code: "NO_HOURS", message: "m", whatToDo: "Fix Dana's punch on 3 January." },
        ],
      }),
    );
    expect(c.problems[0]?.whatToDo).toBe("Fix Dana's punch on 3 January.");
  });

  it("falls back to the lesson when the refusal has no instruction", () => {
    const c = employeeCard(
      line({ status: "blocked", refusals: [{ code: "NO_HOURS", message: "m", whatToDo: "" }] }),
    );
    expect(c.problems[0]?.whatToDo.length).toBeGreaterThan(20);
  });

  it("always explains how the withholding was decided, including the ordinary case", () => {
    // "A signed W-4 was used as written" is information too. Showing the line
    // only when something is wrong is what makes the default easy to miss.
    for (const p of ["furnished", "statutory_default_no_w4", "statutory_default_unsigned"] as const) {
      const c = employeeCard(line({ w4Provenance: p }));
      expect(c.w4Headline.length, p).toBeGreaterThan(10);
      expect(c.w4WhatItMeans.length, p).toBeGreaterThan(20);
    }
  });

  it("hides the garnishment figure when nothing was garnished", () => {
    expect(employeeCard(line({ totalGarnishedCents: 0 })).garnished).toBeNull();
    expect(employeeCard(line({ totalGarnishedCents: 12_345 })).garnished).toBe("$123.45");
  });

  it("counts refusals by code", () => {
    const r = result({
      lines: [
        line({ status: "blocked", refusals: [{ code: "NO_HOURS", message: "m", whatToDo: "w" }] }),
        line({ employeeId: "e2" }),
      ],
    });
    expect(countRefusal(r, "NO_HOURS")).toBe(1);
    expect(countRefusal(r, "NO_PAY_FREQUENCY")).toBe(0);
  });

  it("lists blocked people by name", () => {
    const r = result({
      lines: [line(), line({ employeeId: "e2", employeeName: "Kit Nye", status: "blocked" })],
    });
    expect(blockedNames(r)).toEqual(["Kit Nye"]);
  });
});

describe("5b the money summary", () => {
  it("warns that the net total is partial when somebody is blocked", () => {
    // The cash-planning trap: totalNetPayCents sums only payable lines, so on
    // a run with a blockage it is NOT what will leave the bank.
    const rows = moneyRows(
      result({
        lines: [line(), line({ employeeId: "e2", status: "blocked", netPayCents: null })],
      }),
    );
    const net = rows.find((r) => r.label === "Net pay");
    expect(net?.note).toContain("NOT the full cost");
    expect(net?.note).toContain("Do not plan your cash");
  });

  it("does not cry wolf when nothing is blocked", () => {
    const net = moneyRows(result()).find((r) => r.label === "Net pay");
    expect(net?.note).not.toContain("NOT the full cost");
  });

  it("every row has a label, an amount and a note", () => {
    for (const r of moneyRows(result())) {
      expect(r.label.length).toBeGreaterThan(3);
      expect(r.amount).toMatch(/^\$[\d,]+\.\d\d$/);
      expect(r.note.length).toBeGreaterThan(20);
    }
  });

  it("shows all three counts even when they are zero", () => {
    // "0 cannot be paid" is one of the most reassuring things this page says,
    // and it can only say it by being present.
    const counts = statusCounts(result());
    expect(counts.length).toBe(3);
    expect(counts.map((c) => c.status)).toEqual(["ready", "attention", "blocked"]);
    expect(counts.find((c) => c.status === "blocked")?.count).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) WIRED — rule 16, rule 50
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("6 the screen is reachable, not dead code with a green check", () => {
  it("the page file exists at the route the nav points to", () => {
    const item = adminNav.find((n) => n.href === "/admin/books/pay-run");
    expect(item, "Pay Run must be in the admin navigation").toBeDefined();
    expect(existsSync(PAGE_PATH)).toBe(true);
  });

  it("the nav entry is in Accounting and behind books.view", () => {
    const item = adminNav.find((n) => n.href === "/admin/books/pay-run");
    expect(item?.group).toBe("Accounting");
    expect(item?.permission).toBe("books.view");
  });

  it("the nav entry is not marked coming soon, because it is not", () => {
    const item = adminNav.find((n) => n.href === "/admin/books/pay-run");
    expect(item?.comingSoon).toBeFalsy();
  });

  it("its icon is not already used by another Accounting entry", () => {
    // The nav header states the house rule: every icon distinct within its
    // dropdown, so the menu can be scanned by shape.
    //
    // THIS TEST IS DELIBERATELY NARROW, AND THE FIRST DRAFT WAS NOT.
    //
    // The first version asserted that ALL Accounting icons are distinct. It
    // went red — and stashing my changes proved it went red WITHOUT them too:
    // 15 unique icons across 17 entries before this slice, 16 across 18 after.
    // So the collisions are pre-existing (🧾 is shared by "Bills & 280E" and
    // "Payroll Setup", ⚖️ by "Garnishments" and "Trial Balance") and my entry
    // is not one of them.
    //
    // Widening a new slice's test until it fails on somebody else's old work
    // is how a PR stops being one feature (rule 4). Repointing two existing
    // icons is a real fix and it is a different change; it is recorded as debt
    // rather than smuggled in here. What this slice IS responsible for is not
    // making the problem worse, and that is exactly what is asserted.
    const accounting = adminNav.filter((n) => n.group === "Accounting");
    const mine = accounting.find((n) => n.href === "/admin/books/pay-run");
    expect(mine).toBeDefined();
    const others = accounting.filter((n) => n.href !== "/admin/books/pay-run");
    expect(
      others.some((n) => n.icon === mine?.icon),
      `Pay Run's icon ${mine?.icon} is already used in Accounting`,
    ).toBe(false);
  });

  it("this slice did not increase the number of duplicate Accounting icons", () => {
    // The ratchet. Pre-existing duplicates are tolerated; new ones are not.
    // If someone adds a nineteenth entry reusing an icon, this goes red and
    // they are pointed at the house rule instead of quietly making the menu
    // harder to scan. The number is pinned rather than computed so that FIXING
    // the two old collisions also trips it — in a good way, prompting whoever
    // does it to lower the ceiling.
    const accounting = adminNav.filter((n) => n.group === "Accounting");
    const duplicates = accounting.length - new Set(accounting.map((n) => n.icon)).size;
    expect(
      duplicates,
      "Accounting nav icon collisions changed. If you FIXED one, lower this number.",
    ).toBe(2);
  });

  it("the page gates access before it reads anything", () => {
    // A page whose access check depends on what it happens to read today
    // becomes unprotected the day somebody adds a read.
    expect(pageCode).toContain("requireBooksAccess()");
    const gateAt = pageCode.indexOf("requireBooksAccess()");
    const readAt = pageCode.indexOf("loadPayRun(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("the page actually calls the pure core rather than reimplementing it", () => {
    for (const fn of ["nextAction(", "checklistFor(", "employeeCard(", "moneyRows(", "statusCounts("]) {
      expect(pageCode, `page must call ${fn}`).toContain(fn);
    }
  });

  it("the page renders the recovery ladder", () => {
    expect(pageCode).toContain("PAY_RUN_RECOVERIES");
  });

  it("the page writes nothing", () => {
    // This slice reads and computes. Any insert/update/delete here would be a
    // write with no audit trail and no confirmation.
    expect(pageCode).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("the approve button is honestly disabled rather than fake", () => {
    // Shipping a button that half-works is worse than shipping one that says
    // what it is waiting for.
    expect(pageCode).toContain("disabled");
    expect(pageSrc).toContain("Not connected yet");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) THE CORE STAYS PURE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("7 pay-run-ui-core is pure", () => {
  it("reads no clock, no filesystem and no database", () => {
    // Same reasoning as payDateReadiness: a function that calls new Date()
    // answers a different question every day and cannot be pinned by a test.
    expect(coreCode).not.toContain("new Date(");
    expect(coreCode).not.toContain("node:fs");
    expect(coreCode).not.toContain("createSupabaseAdminClient");
  });

  it("does not carry its own money formatter", () => {
    // Rule 25: extend, do not duplicate. Six formatters already exist in this
    // repo; the payroll one is formatCentsPlain and this file reuses it.
    expect(coreCode).toContain("formatCentsPlain");
    expect(coreCode).not.toMatch(/function\s+money\s*\(/);
  });

  it("is deterministic - the same input gives the same output twice", () => {
    const a = nextAction(loaded());
    const b = nextAction(loaded());
    expect(a).toEqual(b);
  });

  it("the recovery ladder it renders is the mentor's, unedited", () => {
    expect(PAY_RUN_RECOVERIES.length).toBeGreaterThanOrEqual(5);
    for (const r of PAY_RUN_RECOVERIES) {
      expect(r.theTrap.length).toBeGreaterThan(30);
      expect(r.whatToDo.length).toBeGreaterThan(30);
    }
  });
});
