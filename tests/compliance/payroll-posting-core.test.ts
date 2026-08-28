/**
 * tests/compliance/payroll-posting-core.test.ts   (slice books-86)
 *
 * Tests for the payroll → ledger wiring that closes D-38.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY BEING PROVED HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Not "the code runs". Three specific claims, each of which was false before
 * this slice and each of which costs real money if it silently becomes false
 * again:
 *
 *   1. A payroll journal reaches the database with its §280E labels intact.
 *      Migration 0188's own comment explains the stakes: a payroll entry posted
 *      without cost classes "BALANCES PERFECTLY and is silently wrong."
 *
 *   2. The mapping between the payroll engine and the ledger engine cannot
 *      quietly substitute a zero for a figure that was never computed.
 *
 *   3. The four things that genuinely cannot be decided from the data are
 *      REFUSED rather than guessed — and each refusal is reachable, which is
 *      the difference between a guard and a decoration (standing rule 43).
 *
 * The anti-drift block at the end reads migration 0188 and payroll-cogs-core.ts
 * directly, so that a future edit to either one which invalidates an assumption
 * made here fails HERE, loudly, rather than in the ledger months later.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PAYROLL_POSTING_REFUSAL_CODES,
  __runPayrollPostingCoreTests,
  debitTotal,
  mapPaycheck,
  planPayrollPosting,
  resolveAllocations,
  toPostingLines,
  type AllocationFacts,
  type EmployeeRoleFacts,
  type PaycheckFacts,
  type PayRunFacts,
} from "@/lib/accounting/payroll-posting-core";
import {
  buildPayrollJournal,
  evaluatePayrollRun,
  type PayrollRunInput,
} from "@/lib/accounting/payroll-cogs-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const CORE = "src/lib/accounting/payroll-posting-core.ts";
const SERVICE = "src/lib/accounting/payroll-posting-service.ts";
const PAGE = "src/app/admin/books/pay-run/page.tsx";
const ACTIONS = "src/app/admin/books/pay-run/actions.ts";

const ACTIVITIES = ["receive_manifest", "display_sell"] as const;

const LINE: PaycheckFacts = {
  employeeId: "e1",
  employeeName: "Budtender",
  computed: true,
  grossWagesCents: 200_000,
  employeeWithholdingCents: 40_000,
  employerTaxCents: 18_000,
  garnishmentCents: 0,
  voluntaryDeductionCents: 0,
  netPayCents: 160_000,
  hundredthHours: 8_000,
};

const RUN: PayRunFacts = {
  entityCode: "greenway",
  periodStartDate: "2027-01-01",
  periodEndDate: "2027-01-14",
  payDateIso: "2027-01-15",
  canPay: true,
  lines: [LINE],
};

const ROLE: EmployeeRoleFacts = {
  employeeId: "e1",
  laborRoleCode: "budtender",
  cogsSplitBasisPoints: 0,
};

const plan = (
  run: PayRunFacts = RUN,
  allocations: readonly AllocationFacts[] = [],
  roles: readonly EmployeeRoleFacts[] = [ROLE],
  isOwner = true,
) => planPayrollPosting(run, allocations, roles, ACTIVITIES, isOwner, 1_666);

/* ═════════════════════════════════════════════════════════════════════════ */

describe("payroll posting — the self-tests run under vitest too", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runPayrollPostingCoreTests()).not.toThrow();
  });
});

describe("payroll posting — a clean run", () => {
  it("produces a balanced entry", () => {
    const p = plan();
    expect(p.kind).toBe("post");
    if (p.kind !== "post") return;
    expect(p.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(0);
  });

  it("gives every line a §280E cost class, because the reports read the class and not the account", () => {
    const p = plan();
    if (p.kind !== "post") throw new Error("expected a post plan");
    for (const l of p.lines) {
      expect(l.cost_class.trim().length).toBeGreaterThan(0);
    }
  });

  it("never labels a line as direct labor, because a reseller has none", () => {
    const p = plan();
    if (p.kind !== "post") throw new Error("expected a post plan");
    // Reg. §1.471-3(b) has no direct-labor clause. 0188 raises
    // GL_PAYROLL_DIRECT_LABOR_CLAIMED on one, so producing one would be a
    // guaranteed refusal at the database.
    expect(p.lines.some((l) => l.cost_class === "cogs_direct")).toBe(false);
  });

  it("keeps budtender wages out of cost of goods sold", () => {
    const p = plan();
    if (p.kind !== "post") throw new Error("expected a post plan");
    expect(p.lines.some((l) => l.account_code === "61000")).toBe(false);
    expect(
      p.lines.some(
        (l) => l.account_code === "71010" && l.cost_class === "nondeductible_280e",
      ),
    ).toBe(true);
  });

  it("books the withheld tax as a liability, not as a cost", () => {
    const p = plan();
    if (p.kind !== "post") throw new Error("expected a post plan");
    const withheld = p.lines.find((l) => l.account_code === "31100");
    expect(withheld).toBeDefined();
    // Negative is a credit. Withholding is trust money owed to the government
    // (§7501), so it must never sit in an expense account.
    expect(withheld!.amount_cents).toBeLessThan(0);
  });

  it("states the debit total so the database can check the payload independently", () => {
    const p = plan();
    if (p.kind !== "post") throw new Error("expected a post plan");
    const debits = p.lines.reduce((s, l) => (l.amount_cents > 0 ? s + l.amount_cents : s), 0);
    expect(p.expectedCents).toBe(debits);
    expect(p.expectedCents).toBeGreaterThan(0);
  });

  it("keys the source ref on entity and period so a double click cannot post twice", () => {
    const p = plan();
    if (p.kind !== "post") throw new Error("expected a post plan");
    expect(p.sourceRef).toBe("payroll:greenway:2027-01-01:2027-01-14:2027-01-15");
  });

  it("carries a content fingerprint so a CHANGED run is distinguishable from a duplicate", () => {
    const a = plan();
    const b = plan({
      ...RUN,
      lines: [{ ...LINE, grossWagesCents: 200_001, netPayCents: 160_001 }],
    });
    if (a.kind !== "post" || b.kind !== "post") throw new Error("expected post plans");
    // Same period, same pay date, DIFFERENT money. The ref is identical by
    // design; only the fingerprint separates them.
    expect(a.sourceRef).toBe(b.sourceRef);
    expect(a.contentFingerprint).not.toBe(b.contentFingerprint);
  });
});

describe("payroll posting — the refusals, each one reachable", () => {
  it("refuses a non-owner", () => {
    const p = plan(RUN, [], [ROLE], false);
    expect(p.kind).toBe("refuse");
    if (p.kind !== "refuse") return;
    expect(p.refusals[0].code).toBe("PAYROLL_NOT_OWNER");
  });

  it("refuses a run with a blocked paycheque, rather than posting a partial payroll", () => {
    const p = plan({ ...RUN, canPay: false });
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_RUN_BLOCKED");
  });

  it("refuses an empty period", () => {
    const p = plan({ ...RUN, lines: [] }, [], []);
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_NO_EMPLOYEES");
  });

  /**
   * MEASURED AGAINST THE REAL ENGINE, NOT IMAGINED.
   *
   * evaluatePayrollRun() returns postable = true for a run in which nobody
   * earned anything, and buildPayrollJournal() then returns a journal with ZERO
   * lines. Both are individually right. Together they would hand the database a
   * non-entry. This test pins the measurement as well as the refusal, so if the
   * engine ever changes its mind the reason for this branch is re-examined
   * rather than silently obsolete.
   */
  it("refuses when nobody earned anything, because there is no entry to make", () => {
    const zeroRun: PayrollRunInput = {
      entityCode: "greenway",
      payDate: "2027-01-15",
      periodStart: "2027-01-01",
      periodEnd: "2027-01-14",
      activityCodes: [...ACTIVITIES],
      substantiation: null,
      employees: [
        {
          employeeId: "e1",
          employeeName: "Budtender",
          grossWagesCents: 0,
          employeeWithholdingCents: 0,
          employerTaxCents: 0,
          netPayCents: 0,
          allocations: [{ roleCode: "budtender", shareMilliPct: 100_000 }],
        },
      ],
    };
    const verdict = evaluatePayrollRun(zeroRun);
    expect(verdict.postable).toBe(true);
    expect(buildPayrollJournal(zeroRun, verdict)!.lines.length).toBe(0);

    const p = plan({
      ...RUN,
      lines: [
        {
          ...LINE,
          grossWagesCents: 0,
          employeeWithholdingCents: 0,
          employerTaxCents: 0,
          netPayCents: 0,
        },
      ],
    });
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_NOTHING_TO_POST");
  });

  it("refuses a voluntary deduction rather than dropping it and balancing anyway", () => {
    const p = plan({
      ...RUN,
      lines: [{ ...LINE, voluntaryDeductionCents: 5_000, netPayCents: 155_000 }],
    });
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_VOLUNTARY_DEDUCTION_UNMAPPED");
  });

  it("refuses a partial split, because nothing records what the rest of the time was", () => {
    const p = plan(RUN, [], [
      { ...ROLE, laborRoleCode: "receiving", cogsSplitBasisPoints: 4_000 },
    ]);
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_SPLIT_AMBIGUOUS");
  });

  it("refuses an employee with no labor role on file", () => {
    const p = plan(RUN, [], []);
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_NO_ROLE_ON_FILE");
  });

  it("refuses an allocation with no written basis", () => {
    const p = plan(RUN, [
      {
        employeeId: "e1",
        roleCode: "receiving",
        shareMilliPct: 100_000,
        documentRef: null,
        basisNote: null,
      },
    ]);
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_ALLOCATION_UNDOCUMENTED");
  });

  it("refuses a role the taxonomy does not know, rather than passing it through", () => {
    const p = plan(RUN, [], [{ ...ROLE, laborRoleCode: "warehouse_associate" }]);
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_UNKNOWN_ROLE");
  });

  // The test above reaches the check on the SINGLE-ROLE FALLBACK. A documented
  // allocation is validated by a different loop, and a mutation probe proved
  // that loop had no test of its own: an unknown role smuggled in on an
  // allocation row went straight through. This is the same refusal reached by
  // the other door, and it is the door that puts wages into inventory.
  it("refuses an unknown role on a documented allocation, not just on the pay record", () => {
    const p = plan(RUN, [
      {
        employeeId: "e1",
        roleCode: "warehouse_associate",
        shareMilliPct: 100_000,
        documentRef: "TIME-STUDY-2027-01",
        basisNote: "Measured over two weeks of clock-in data.",
      },
    ]);
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_UNKNOWN_ROLE");
    expect(p.refusals[0].message).toContain("warehouse_associate");
  });

  // PAYROLL_LINE_NOT_COMPUTED has two guards behind it, and each needs its own
  // test. This one is the uncalculated cheque. It sets canPay true on purpose:
  // with canPay false the run is refused earlier and this guard is never
  // reached, which is exactly how it went untested.
  it("refuses an uncalculated paycheque even when the run claims it is payable", () => {
    const p = plan({
      ...RUN,
      canPay: true,
      lines: [{ ...LINE, computed: false }],
    });
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_LINE_NOT_COMPUTED");
    expect(p.refusals[0].message).toContain("could not be calculated");
  });

  it("refuses a line whose figures are missing, instead of substituting zero", () => {
    const p = plan({
      ...RUN,
      lines: [{ ...LINE, employerTaxCents: null }],
    });
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_LINE_NOT_COMPUTED");
    expect(p.refusals[0].message).toContain("missing one of its figures");
  });

  // Each figure in the missing-figures guard is a separate term, and a test
  // that only ever nulls one of them cannot notice another being dropped.
  // Gross wages is the term that matters most: a run posted with gross missing
  // would book the tax and the net pay and nothing to hang them on.
  it.each([
    ["grossWagesCents", { grossWagesCents: null }],
    ["employeeWithholdingCents", { employeeWithholdingCents: null }],
    ["employerTaxCents", { employerTaxCents: null }],
    ["netPayCents", { netPayCents: null }],
  ] as const)("refuses when %s is missing", (_name, patch) => {
    const p = plan({ ...RUN, lines: [{ ...LINE, ...patch }] });
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    expect(p.refusals[0].code).toBe("PAYROLL_LINE_NOT_COMPUTED");
    expect(p.refusals[0].message).toContain("missing one of its figures");
  });

  it("reports EVERY problem at once, not just the first", () => {
    const p = plan(
      {
        ...RUN,
        lines: [
          { ...LINE, employeeId: "e1", employeeName: "A" },
          { ...LINE, employeeId: "e2", employeeName: "B" },
        ],
      },
      [],
      [],
    );
    if (p.kind !== "refuse") throw new Error("expected a refusal");
    // Both people lack a role. Reporting one would make Michael fix it, re-run,
    // and be told about the other.
    expect(p.refusals.length).toBe(2);
  });

  it("every refusal code in the exported list is spelled consistently", () => {
    expect(new Set(PAYROLL_POSTING_REFUSAL_CODES).size).toBe(
      PAYROLL_POSTING_REFUSAL_CODES.length,
    );
    for (const c of PAYROLL_POSTING_REFUSAL_CODES) {
      expect(c).toMatch(/^PAYROLL_[A-Z_]+$/);
    }
  });

  it("every refusal carries a next step, never just a 'no'", () => {
    const cases = [
      plan(RUN, [], [ROLE], false),
      plan({ ...RUN, canPay: false }),
      plan({ ...RUN, lines: [] }, [], []),
      plan(RUN, [], []),
      plan(RUN, [], [{ ...ROLE, laborRoleCode: "receiving", cogsSplitBasisPoints: 4_000 }]),
    ];
    for (const c of cases) {
      if (c.kind !== "refuse") throw new Error("expected a refusal");
      for (const r of c.refusals) {
        expect(r.message.trim().length).toBeGreaterThan(20);
        expect(r.whatToDo.trim().length).toBeGreaterThan(20);
      }
    }
  });
});

describe("payroll posting — a documented split is honoured", () => {
  it("uses the documented allocation over the single role on the pay record", () => {
    const documented: AllocationFacts[] = [
      {
        employeeId: "e1",
        roleCode: "receiving",
        shareMilliPct: 40_000,
        documentRef: "STUDY-2027-01",
        basisNote: "Task-tagged punches tied to numbered manifests.",
      },
      {
        employeeId: "e1",
        roleCode: "budtender",
        shareMilliPct: 60_000,
        documentRef: "STUDY-2027-01",
        basisNote: "Task-tagged punches tied to numbered manifests.",
      },
    ];
    const resolved = resolveAllocations("e1", "Budtender", documented, ROLE);
    expect("allocations" in resolved).toBe(true);
    if (!("allocations" in resolved)) return;
    expect(resolved.allocations.map((a) => a.roleCode).sort()).toEqual([
      "budtender",
      "receiving",
    ]);
  });

  it("falls back to the single role only when it covers all of the time", () => {
    const resolved = resolveAllocations("e1", "Budtender", [], ROLE);
    if (!("allocations" in resolved)) throw new Error("expected allocations");
    expect(resolved.allocations).toEqual([
      { roleCode: "budtender", shareMilliPct: 100_000 },
    ]);
  });

  it("treats a full 100% split as unambiguous", () => {
    const resolved = resolveAllocations("e1", "Receiver", [], {
      ...ROLE,
      laborRoleCode: "receiving",
      cogsSplitBasisPoints: 10_000,
    });
    expect("allocations" in resolved).toBe(true);
  });
});

describe("payroll posting — hours are converted, not assumed", () => {
  it("turns hundredth-hours into whole hours for the wage-floor check", () => {
    const mapped = mapPaycheck(LINE, [{ roleCode: "budtender", shareMilliPct: 100_000 }]);
    if (!("employee" in mapped)) throw new Error("expected a mapping");
    // 8000 hundredths = 80 hours. Getting this wrong by a factor of 100 would
    // make an $18/hour wage look like 18 cents and fire a false minimum-wage
    // block on every single paycheque.
    expect(mapped.employee.hoursWorked).toBe(80);
  });

  it("keeps unknown hours as null rather than zero", () => {
    const mapped = mapPaycheck({ ...LINE, hundredthHours: null }, [
      { roleCode: "budtender", shareMilliPct: 100_000 },
    ]);
    if (!("employee" in mapped)) throw new Error("expected a mapping");
    // "Not known" and "zero hours" are different claims. A zero would make the
    // wage-floor check divide gross by nothing.
    expect(mapped.employee.hoursWorked).toBeNull();
  });
});

describe("payroll posting — serialisation matches what the database parses", () => {
  it("emits the snake_case keys migration 0188 reads", () => {
    const run: PayrollRunInput = {
      entityCode: "greenway",
      payDate: "2027-01-15",
      periodStart: "2027-01-01",
      periodEnd: "2027-01-14",
      activityCodes: [...ACTIVITIES],
      substantiation: null,
      employees: [
        {
          employeeId: "e1",
          employeeName: "Budtender",
          grossWagesCents: 200_000,
          employeeWithholdingCents: 40_000,
          employerTaxCents: 18_000,
          netPayCents: 160_000,
          allocations: [{ roleCode: "budtender", shareMilliPct: 100_000 }],
        },
      ],
    };
    const journal = buildPayrollJournal(run, evaluatePayrollRun(run))!;
    const lines = toPostingLines(journal);
    for (const l of lines) {
      expect(Object.keys(l).sort()).toEqual([
        "account_code",
        "amount_cents",
        "cost_class",
        "description",
      ]);
    }
    expect(debitTotal(journal)).toBeGreaterThan(0);
  });

  it("passes the cost class through untouched, with no default", () => {
    // gl_submit_journal defaults a missing class to 'none', and 0188's comment
    // explains what that costs. A `?? "none"` here would re-create exactly that
    // failure while looking like defensive programming.
    const src = read(CORE);
    const fn = src.slice(src.indexOf("export function toPostingLines"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).not.toContain('"none"');
    expect(body).toContain("cost_class: l.costClass");
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * THE WIRE — both ends of it
 * ═════════════════════════════════════════════════════════════════════════
 *
 * books-85 learned this the hard way: a mutation that deleted `export` from a
 * service function left the suite green, because the page still MENTIONED the
 * name. Mentioning is not importing. So both ends are asserted.
 */

describe("payroll posting — the wire is connected at both ends", () => {
  it("the service exports the functions the screen needs", () => {
    const src = read(SERVICE);
    expect(src).toMatch(/export async function postPayrollRun\b/);
    expect(src).toMatch(/export async function previewPayrollPosting\b/);
  });

  it("the action imports the service and calls it", () => {
    const src = read(ACTIONS);
    expect(src).toContain("@/lib/accounting/payroll-posting-service");
    expect(src).toContain("postPayrollRun(");
  });

  it("the page imports the preview and renders the button", () => {
    const src = read(PAGE);
    expect(src).toContain("@/lib/accounting/payroll-posting-service");
    expect(src).toContain("PostPayrollButton");
    expect(src).toContain("previewPayrollPosting(");
  });

  it("the page no longer claims the control is unwired", () => {
    // The exact sentence this slice exists to delete.
    expect(read(PAGE)).not.toContain("Not connected yet");
  });

  it("the service actually calls the database function", () => {
    expect(read(SERVICE)).toContain('rpc("gl_post_payroll_run"');
  });

  // The fingerprint is the ONLY thing that lets the database tell a duplicate
  // click apart from a run whose money changed. gl_post_payroll_run raises
  // GL_PAYROLL_RUN_CHANGED off it. A mutation probe showed the service could
  // stop sending it and every other test stayed green, so it is pinned here:
  // the computed value must be what is sent, not a literal and not a blank.
  it("sends the computed fingerprint to the database, so a CHANGED run is detectable", () => {
    const src = read(SERVICE);
    expect(src).toContain("p_content_fingerprint: plan.contentFingerprint,");
    expect(src).not.toMatch(/p_content_fingerprint:\s*""/);
    expect(src).not.toMatch(/p_content_fingerprint:\s*null/);
  });

  // p_run_id is null today for a measured reason (nothing links a pay period to
  // a payroll_runs row), which is logged as a defect. That makes the assumption
  // note the only surviving record of WHICH run produced the entry, so the
  // fingerprint must reach it too.
  it("carries the fingerprint into the assumption note as well, because p_run_id is null", () => {
    const src = read(SERVICE);
    expect(src).toContain("p_assumption_note: assumptionNote(plan.contentFingerprint),");
    expect(src).toContain("p_run_id: null,");
  });
});

describe("payroll posting — identity, because posting writes who did it", () => {
  it("uses the session-bound books client and never the admin client for the write", () => {
    const src = read(SERVICE);
    const imports = src
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import"))
      .join("\n");
    expect(imports).toContain("books-client");

    // The admin client IS imported here, deliberately, for reference-data
    // reads. What must never happen is the RPC travelling that way: under the
    // service key auth.uid() is null, is_owner() is false, and 0188 refuses.
    const rpcCall = src.slice(src.indexOf('rpc("gl_post_payroll_run"'));
    const before = src.slice(0, src.indexOf('rpc("gl_post_payroll_run"'));
    const lastClient = before.lastIndexOf("const supabase =");
    expect(before.slice(lastClient)).toContain("createBooksClient()");
    expect(rpcCall.length).toBeGreaterThan(0);
  });

  it("the write is owner-gated before it reaches the database", () => {
    const src = read(SERVICE);
    const fn = src.slice(src.indexOf("export async function postPayrollRun"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("ownerSession()");
    // The gate must come BEFORE the RPC, not merely exist somewhere in the file.
    expect(body.indexOf("ownerSession()")).toBeLessThan(
      body.indexOf("gl_post_payroll_run"),
    );
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * ANTI-DRIFT — pinned to the sources this code depends on
 * ═════════════════════════════════════════════════════════════════════════ */

describe("payroll posting — assumptions pinned to migration 0188", () => {
  const sql = read("supabase/migrations/0188_payroll_to_gl.sql");

  it("the database still parses the two keys this code emits", () => {
    expect(sql).toContain("v_line->>'account_code'");
    expect(sql).toContain("v_line->>'cost_class'");
  });

  it("the database still gates on is_owner(), which is why the session client is required", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.gl_post_payroll_run"));
    expect(fn.slice(0, fn.indexOf("$$;"))).toContain("if not public.is_owner()");
  });

  it("payroll is still never auto-posted", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.gl_post_payroll_run"));
    expect(fn.slice(0, fn.indexOf("$$;"))).toContain("p_auto_post         => false");
  });

  it("the RPC still accepts the nine parameters this service sends", () => {
    for (const p of [
      "p_entity_code",
      "p_pay_date",
      "p_source_ref",
      "p_memo",
      "p_lines",
      "p_expected_cents",
      "p_assumption_note",
      "p_run_id",
      "p_content_fingerprint",
    ]) {
      expect(sql).toContain(p);
    }
  });
});

describe("payroll posting — assumptions pinned to the §280E engine", () => {
  const src = read("src/lib/accounting/payroll-cogs-core.ts");

  it("the net-pay identity still has no term for voluntary deductions", () => {
    // The refusal PAYROLL_VOLUNTARY_DEDUCTION_UNMAPPED exists precisely because
    // of this line. If a term is ever added, that refusal becomes wrong and
    // must be revisited rather than left to reject valid payrolls.
    expect(src).toContain("const expectedNet = gross - withheld - garnish - advance;");
  });

  it("the account constants this test asserts on are still what they were", () => {
    expect(src).toContain('export const WAGE_EXPENSE_ACCOUNT = "71010"');
    expect(src).toContain('export const PAYROLL_COGS_ACCOUNT = "61000"');
    expect(src).toContain('export const WITHHELD_TAX_ACCOUNT = "31100"');
  });

  it("buildPayrollJournal still returns null when the verdict refuses", () => {
    const run: PayrollRunInput = {
      entityCode: "greenway",
      payDate: "2027-01-15",
      periodStart: "2027-01-01",
      periodEnd: "2027-01-14",
      activityCodes: [...ACTIVITIES],
      substantiation: null,
      employees: [
        {
          employeeId: "e1",
          employeeName: "X",
          grossWagesCents: 100_000,
          employeeWithholdingCents: 20_000,
          employerTaxCents: 9_000,
          netPayCents: 80_000,
          allocations: [{ roleCode: "nonesuch", shareMilliPct: 100_000 }],
        },
      ],
    };
    expect(buildPayrollJournal(run, evaluatePayrollRun(run))).toBeNull();
  });
});
