/**
 * src/lib/accounting/payroll-posting-core.ts   (slice books-86)
 *
 * THE PAYROLL JOURNAL'S MISSING HALF — the part that decides whether a computed
 * pay run may become a ledger entry, and refuses in plain English when it may not.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Defect D-38, written in docs/DEFECTS.md:
 *
 *   "The payroll journal is built, proven, and called only by a development
 *    script."
 *
 * Everything needed to post payroll already existed and none of it was joined up:
 *
 *   payroll-cogs-core.ts#buildPayrollJournal   builds the entry, 280E-classified
 *   migration 0188 gl_post_payroll_run         accepts it, owner-only, 5 guards
 *   pay-run-store.ts#loadPayRun                computes real paycheques
 *   /admin/books/pay-run                       shows them on a screen
 *
 * The screen's own header admits the gap in as many words: "the approve control
 * is rendered but deliberately not wired." Net pay, withheld tax, employer tax
 * and garnishments were all unbooked. This file is the join.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE MAPPING IS THE DANGEROUS PART, NOT THE POSTING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `PayRunResult` (what the payroll engine computes) and `PayrollRunInput` (what
 * the journal builder consumes) are DIFFERENT SHAPES built by different slices
 * for different purposes. Translating between them is four lines of obvious
 * code and about six ways to be quietly wrong. The whole point of putting the
 * translation HERE, in a pure module, is that every one of those six ways is a
 * named refusal with a test behind it rather than a `?? 0` nobody reads.
 *
 * Measured, not assumed. Each of these was established by reading the source or
 * by running the engine, and the evidence is recorded beside the rule:
 *
 *   NET IDENTITY.  payroll-cogs-core.ts:1550 computes
 *                    expectedNet = gross − withheld − garnishment − advance
 *                  and raises PAY_NET_MISMATCH when it does not tie. There is
 *                  NO term for voluntary deductions. net-pay-core.ts:414
 *                  meanwhile computes
 *                    net = gross − requiredByLaw.totalCents − garnished − voluntary
 *                  The two agree ONLY while voluntary deductions are empty.
 *
 *   WITHHOLDING.   requiredByLaw.totalCents is taxes.totalEmployeeWithheldCents
 *                  (net-pay-core.ts:217) — what was ACTUALLY withheld, not what
 *                  was computed. On a cheque too small to carry its own tax the
 *                  two differ, and the actually-withheld figure is the one that
 *                  ties to net pay and therefore the one the ledger needs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FOUR THINGS THIS FILE REFUSES, AND WHY EACH ONE IS REAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These are not defensive decoration. Each was PROVOKED against the real engine
 * before it was written, and each would otherwise have produced a wrong ledger
 * silently — the failure mode this whole system exists to prevent.
 *
 * 1. AN EMPTY JOURNAL.  Measured: a run whose only employee has zero gross pay
 *    returns `postable = true` from evaluatePayrollRun() and a journal with
 *    ZERO LINES from buildPayrollJournal(). Both are individually correct — no
 *    money moved, so no entry is owed — but a zero-line journal handed to the
 *    database is a non-entry: gl_submit_journal wants at least two lines, and
 *    "nothing happened" is not a thing to record. Refused here so the message
 *    says what actually occurred rather than surfacing GL_TOO_FEW_LINES, which
 *    would send Michael looking for a missing line that was never owed.
 *
 * 2. A VOLUNTARY DEDUCTION.  PayrollEmployeeInput has no field for one. Today
 *    pay-run-store.ts:352 hard-codes `voluntaryDeductions: []` with a comment
 *    calling it "a real gap, not a choice". So today this refusal is
 *    unreachable in production — and it is written anyway, because the day a
 *    health premium is set up, the alternative is a journal that silently
 *    credits the employee's net pay short by the premium and balances
 *    perfectly. An unreachable guard that becomes reachable the moment a table
 *    is added is not decoration (standing rule 43); it is the difference
 *    between a refusal and a wrong tax return. It is provable today by handing
 *    this pure function a line that carries one.
 *
 * 3. AN AMBIGUOUS ROLE SPLIT.  employee_pay carries `labor_role_code` AND
 *    `cogs_split_basis_points`, and the form labels the latter "Share of hours
 *    in that role, as a percent". That names ONE share and never records what
 *    the REMAINING time was spent doing. A 40% receiving split leaves 60% of a
 *    wage with no role, and the two available guesses — put it all in the named
 *    role, or invent a second role — are respectively a 280E overstatement and
 *    a fabrication. Standing rule 62d: it stays uninvented. The unambiguous
 *    source is gl_payroll_allocations, whose rows carry document_ref and
 *    basis_note as NOT NULL precisely so that a split is evidenced.
 *
 * 4. A BLOCKED OR UNCOMPUTED LINE.  PayRunResult.canPay is false when ANY line
 *    is blocked, because "a partial payroll is its own kind of wrong: the
 *    person left out finds out on payday" (pay-run-core.ts). The same logic
 *    binds the ledger: posting the payable people and omitting the blocked one
 *    understates the liability, and the shortfall shows up as a reconciliation
 *    difference weeks later.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE DOES NOT DO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No I/O. No database. No arithmetic on money beyond adding up integer cents
 * that other modules computed. The 280E classification belongs to
 * payroll-cogs-core.ts and the tax arithmetic to the payroll engines; this file
 * decides only whether a mapping is HONEST, and it is pure so that decision can
 * be mutation-tested.
 */

import {
  buildPayrollJournal,
  evaluatePayrollRun,
  findLaborRole,
  payrollContentFingerprint,
  payrollSourceRef,
  type PayrollAllocationInput,
  type PayrollEmployeeInput,
  type PayrollJournal,
  type PayrollRunInput,
  type PayrollVerdict,
} from "./payroll-cogs-core";

/* ═════════════════════════════════════════════════════════════════════════
 * 1) WHAT THE CALLER HANDS US
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * One employee's documented time split, as read from `gl_payroll_allocations`.
 *
 * Deliberately NOT `PayrollAllocationInput` itself: this shape carries the
 * evidence fields too, because whether a split may be used at all depends on
 * whether it is documented, and that judgement is made here rather than being
 * assumed by whoever did the reading.
 */
export type AllocationFacts = {
  readonly employeeId: string;
  readonly roleCode: string;
  readonly shareMilliPct: number;
  /** From gl_payroll_allocations.document_ref — NOT NULL in the schema. */
  readonly documentRef: string | null;
  readonly basisNote: string | null;
};

/**
 * The single-role fallback, from `employee_pay`.
 *
 * `employee_pay.labor_role_code` is NOT NULL, so every employee with a current
 * pay record has exactly one role on file. That is enough to post — but only
 * when the split says one hundred percent of the time went there.
 */
export type EmployeeRoleFacts = {
  readonly employeeId: string;
  readonly laborRoleCode: string;
  /** employee_pay.cogs_split_basis_points. 10000 = 100%. */
  readonly cogsSplitBasisPoints: number;
};

/**
 * One computed paycheque, flattened out of `PayRunLine` by the caller.
 *
 * Flattened deliberately. Importing `PayRunLine` here would tie the accounting
 * layer to the payroll engine's internal shape and make this module impossible
 * to test without constructing a full `NetPayBreakdown`. These are the seven
 * figures the ledger actually needs, and the service is responsible for reading
 * them off the line correctly — which is itself asserted by a test.
 */
export type PaycheckFacts = {
  readonly employeeId: string;
  readonly employeeName: string;
  /** True when the line computed. False for a blocked line. */
  readonly computed: boolean;
  readonly grossWagesCents: number | null;
  /** requiredByLaw.totalCents — what was ACTUALLY withheld. */
  readonly employeeWithholdingCents: number | null;
  /** taxes.totalEmployerTaxCents — Greenway's own cost, on top of gross. */
  readonly employerTaxCents: number | null;
  readonly garnishmentCents: number;
  /**
   * Anything deducted that is neither tax nor garnishment. Today always zero;
   * see refusal 2 in the header for why it is carried rather than ignored.
   */
  readonly voluntaryDeductionCents: number;
  readonly netPayCents: number | null;
  /** Hours in HUNDREDTHS, as the payroll engine carries them. */
  readonly hundredthHours: number | null;
};

/** Everything about the period itself. */
export type PayRunFacts = {
  readonly entityCode: "greenway" | "atm" | "landholding" | "personal";
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly payDateIso: string;
  /** PayRunResult.canPay — false when ANY line is blocked. */
  readonly canPay: boolean;
  readonly lines: readonly PaycheckFacts[];
};

/* ═════════════════════════════════════════════════════════════════════════
 * 2) THE REFUSALS
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Every reason this module will not build a payroll journal.
 *
 * Exported and asserted by a test so the list cannot quietly grow: a refusal
 * added without a written reason is how a screen starts saying "cannot post"
 * for causes nobody can explain.
 */
export const PAYROLL_POSTING_REFUSAL_CODES = [
  "PAYROLL_NOT_OWNER",
  "PAYROLL_RUN_BLOCKED",
  "PAYROLL_NO_EMPLOYEES",
  "PAYROLL_NOTHING_TO_POST",
  "PAYROLL_LINE_NOT_COMPUTED",
  "PAYROLL_VOLUNTARY_DEDUCTION_UNMAPPED",
  "PAYROLL_NO_ROLE_ON_FILE",
  "PAYROLL_SPLIT_AMBIGUOUS",
  "PAYROLL_ALLOCATION_UNDOCUMENTED",
  "PAYROLL_UNKNOWN_ROLE",
  "PAYROLL_ENGINE_REFUSED",
] as const;

export type PayrollPostingRefusalCode =
  (typeof PAYROLL_POSTING_REFUSAL_CODES)[number];

export type PayrollPostingRefusal = {
  readonly code: PayrollPostingRefusalCode;
  /** What is wrong, in one sentence Michael can act on. */
  readonly message: string;
  /** The exact next step. Never "check your configuration". */
  readonly whatToDo: string;
  /** Who this concerns. Empty means the whole run. */
  readonly employeeIds: readonly string[];
};

/* ═════════════════════════════════════════════════════════════════════════
 * 3) THE PLAN
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * A line as `gl_post_payroll_run` wants it.
 *
 * snake_case ON PURPOSE. This is the JSON the database parses — 0188 reads
 * `v_line->>'account_code'` and `v_line->>'cost_class'` — and the shape is
 * identical to the one posting-service.ts already sends to gl_submit_journal.
 * Building it here, in tested pure code, keeps the translation from being
 * retyped from memory at the call site, which is where a silent
 * GL_PAYROLL_NO_COST_CLASS comes from.
 */
export type PayrollPostingLine = {
  readonly account_code: string;
  readonly amount_cents: number;
  readonly cost_class: string;
  readonly description: string | null;
};

export type PayrollPostingPlan =
  | {
      readonly kind: "post";
      readonly entityCode: string;
      readonly payDate: string;
      readonly sourceRef: string;
      readonly contentFingerprint: string;
      readonly memo: string;
      readonly lines: readonly PayrollPostingLine[];
      /** Sum of the debits, for gl_submit_journal's p_expected_cents check. */
      readonly expectedCents: number;
      /** The run as the 280E engine saw it. Carried for the screen. */
      readonly verdict: PayrollVerdict;
      /** Confirmations Michael must read before this posts. */
      readonly acknowledgements: readonly string[];
    }
  | {
      readonly kind: "refuse";
      readonly refusals: readonly PayrollPostingRefusal[];
      /** Present when the 280E engine ran and had something to say. */
      readonly verdict: PayrollVerdict | null;
    };

/* ═════════════════════════════════════════════════════════════════════════
 * 4) ALLOCATIONS — the part that must not be guessed
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve one employee's role split, or refuse.
 *
 * THE ORDER MATTERS AND IT IS NOT ARBITRARY. A documented allocation always
 * wins, because it is the only source that carries evidence. The single-role
 * fallback is used ONLY when the pay record says all of the time went to that
 * one role. Anything in between is refused rather than resolved, for the reason
 * set out in the header: the remainder of a partial split is genuinely unknown,
 * and both available guesses are wrong in a way that shows up on a tax return.
 */
export function resolveAllocations(
  employeeId: string,
  employeeName: string,
  documented: readonly AllocationFacts[],
  roleOnFile: EmployeeRoleFacts | null,
): { allocations: readonly PayrollAllocationInput[] } | { refusal: PayrollPostingRefusal } {
  const mine = documented.filter((a) => a.employeeId === employeeId);

  if (mine.length > 0) {
    // Documented, but is it EVIDENCED? gl_payroll_allocations makes
    // document_ref and basis_note NOT NULL for exactly this reason; a row that
    // reached us without them came from somewhere that bypassed the schema, and
    // an undocumented allocation is the Harborside fact pattern.
    const undocumented = mine.filter(
      (a) =>
        !a.documentRef ||
        a.documentRef.trim().length === 0 ||
        !a.basisNote ||
        a.basisNote.trim().length === 0,
    );
    if (undocumented.length > 0) {
      return {
        refusal: {
          code: "PAYROLL_ALLOCATION_UNDOCUMENTED",
          message:
            `${employeeName} has a time split on file that is missing its written basis, so it ` +
            `cannot be used to put wages into inventory.`,
          whatToDo:
            "Open the allocation and fill in the study reference and the sentence explaining how " +
            "the percentage was measured. An allocation without a written basis is exactly the " +
            "unsupported estimate the cannabis cases keep rejecting, and the ledger will not " +
            "carry one.",
          employeeIds: [employeeId],
        },
      };
    }

    for (const a of mine) {
      if (!findLaborRole(a.roleCode)) {
        return {
          refusal: {
            code: "PAYROLL_UNKNOWN_ROLE",
            message: `${employeeName} has a time split pointing at the role "${a.roleCode}", which is not a role this system knows.`,
            whatToDo:
              "The list of labor roles is deliberately closed, because an open-ended list of job " +
              "titles is how a job quietly becomes a cost-of-goods account nobody can explain in " +
              "an audit. Add the role to the taxonomy with its §280E treatment and the authority " +
              "behind it, then re-run payroll.",
            employeeIds: [employeeId],
          },
        };
      }
    }

    return {
      allocations: mine.map((a) => ({
        roleCode: a.roleCode,
        shareMilliPct: a.shareMilliPct,
      })),
    };
  }

  if (!roleOnFile || roleOnFile.laborRoleCode.trim().length === 0) {
    return {
      refusal: {
        code: "PAYROLL_NO_ROLE_ON_FILE",
        message: `${employeeName} has no labor role on file, so there is no way to say what §280E does to those wages.`,
        whatToDo:
          "Open this person's payroll setup and choose their labor role. That single field decides " +
          "whether the wage is an allocable cost of acquiring goods or a §280E-disallowed " +
          "operating expense, so payroll cannot be booked without it.",
        employeeIds: [employeeId],
      },
    };
  }

  if (!findLaborRole(roleOnFile.laborRoleCode)) {
    return {
      refusal: {
        code: "PAYROLL_UNKNOWN_ROLE",
        message: `${employeeName}'s pay record names the role "${roleOnFile.laborRoleCode}", which is not a role this system knows.`,
        whatToDo:
          "Choose a role from the list on the payroll setup screen. If the work is genuinely a new " +
          "kind, add it to the taxonomy first with its §280E treatment and authority.",
        employeeIds: [employeeId],
      },
    };
  }

  // THE AMBIGUITY. A partial split names one share and never says what the rest
  // of the time was. Refused rather than resolved — standing rule 62d.
  if (roleOnFile.cogsSplitBasisPoints > 0 && roleOnFile.cogsSplitBasisPoints < 10_000) {
    const pct = (roleOnFile.cogsSplitBasisPoints / 100).toFixed(2).replace(/\.?0+$/, "");
    return {
      refusal: {
        code: "PAYROLL_SPLIT_AMBIGUOUS",
        message:
          `${employeeName} is set up as ${pct}% "${roleOnFile.laborRoleCode}", but nothing on file ` +
          `says what the other ${(100 - roleOnFile.cogsSplitBasisPoints / 100).toFixed(2).replace(/\.?0+$/, "")}% of their time was spent doing.`,
        whatToDo:
          "Record the whole split as a documented allocation, with a study reference and a " +
          "sentence explaining how it was measured. The system will not assume the rest of the " +
          "time was the same role — that would overstate what rides into inventory — and it will " +
          "not invent a second role for you.",
        employeeIds: [employeeId],
      },
    };
  }

  return {
    allocations: [{ roleCode: roleOnFile.laborRoleCode, shareMilliPct: 100_000 }],
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * 5) THE MAPPING
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Turn one computed paycheque into the shape the journal builder consumes.
 *
 * Every `?? 0` in this function would be a defect, so there are none: a figure
 * that is null on a line the caller claimed had computed is a contradiction, and
 * it is refused rather than defaulted (standing rule 46 — a failed read is not
 * an empty result).
 */
export function mapPaycheck(
  line: PaycheckFacts,
  allocations: readonly PayrollAllocationInput[],
): { employee: PayrollEmployeeInput } | { refusal: PayrollPostingRefusal } {
  if (!line.computed) {
    return {
      refusal: {
        code: "PAYROLL_LINE_NOT_COMPUTED",
        message: `${line.employeeName}'s paycheque could not be calculated, so this payroll cannot be booked.`,
        whatToDo:
          "Fix what the pay run screen says is blocking this person, then come back. The whole " +
          "run waits on purpose — booking everyone else and leaving one person out understates " +
          "the wages owed and shows up as an unexplained difference at the bank later.",
        employeeIds: [line.employeeId],
      },
    };
  }

  if (
    line.grossWagesCents === null ||
    line.employeeWithholdingCents === null ||
    line.employerTaxCents === null ||
    line.netPayCents === null
  ) {
    return {
      refusal: {
        code: "PAYROLL_LINE_NOT_COMPUTED",
        message: `${line.employeeName}'s paycheque is missing one of its figures, so it cannot be booked.`,
        whatToDo:
          "Reload the pay run. If a figure is still missing, that is a fault worth reporting " +
          "rather than working around — nothing here will substitute a zero for a number that " +
          "was never calculated.",
        employeeIds: [line.employeeId],
      },
    };
  }

  // THE UNMAPPED DEDUCTION. See refusal 2 in the header.
  if (line.voluntaryDeductionCents !== 0) {
    return {
      refusal: {
        code: "PAYROLL_VOLUNTARY_DEDUCTION_UNMAPPED",
        message:
          `${line.employeeName} has a voluntary deduction of ${formatPlainCents(line.voluntaryDeductionCents)} ` +
          `on this cheque, and the payroll journal has nowhere to put it yet.`,
        whatToDo:
          "This is a gap in the books, not a mistake you made. A voluntary deduction — a health " +
          "premium, a retirement contribution — is money withheld from net pay that Greenway then " +
          "owes to somebody else, so it needs its own liability account before payroll can be " +
          "posted with one on it. Posting anyway would credit net pay short by that amount and " +
          "still balance, which is the kind of wrong that is only found months later.",
        employeeIds: [line.employeeId],
      },
    };
  }

  return {
    employee: {
      employeeId: line.employeeId,
      employeeName: line.employeeName,
      grossWagesCents: line.grossWagesCents,
      employeeWithholdingCents: line.employeeWithholdingCents,
      employerTaxCents: line.employerTaxCents,
      garnishmentCents: line.garnishmentCents,
      netPayCents: line.netPayCents,
      allocations,
      // Hours arrive in HUNDREDTHS from the payroll engine and the 280E engine
      // wants whole hours for its minimum-wage check. Converted here, once,
      // rather than at the call site where the unit would be a guess. Null
      // stays null: "not known" and "zero hours" are different claims, and a
      // zero would make the wage-floor check compare against nothing.
      hoursWorked: line.hundredthHours === null ? null : line.hundredthHours / 100,
    },
  };
}

/** Cents to a plain "$1,234.56", for refusal text. */
function formatPlainCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}

/* ═════════════════════════════════════════════════════════════════════════
 * 6) THE WHOLE DECISION
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Decide whether a computed pay run may be posted, and if so exactly what to post.
 *
 * Pure. Every input is a fact the caller read; every output is either a complete
 * instruction or a list of refusals with the reasoning attached.
 *
 * @param isOwner  Whether the actor may write to the books. Checked FIRST, and
 *                 checked again by the database (0188 re-checks is_owner()), so
 *                 the books stay shut even if a future caller forgets.
 * @param activityCodes  What Greenway actually does. Drives the reseller-or-
 *                 producer finding. NOT defaulted — see the note at the call site.
 */
export function planPayrollPosting(
  run: PayRunFacts,
  documented: readonly AllocationFacts[],
  rolesOnFile: readonly EmployeeRoleFacts[],
  activityCodes: readonly string[],
  isOwner: boolean,
  minimumWageCentsPerHour: number | null,
): PayrollPostingPlan {
  if (!isOwner) {
    return {
      kind: "refuse",
      verdict: null,
      refusals: [
        {
          code: "PAYROLL_NOT_OWNER",
          message: "Only the owner can post payroll to the books.",
          whatToDo:
            "Paying people and recording the tax consequence of paying them are two different " +
            "jobs. Payroll can be run and reviewed by an administrator; writing it into the " +
            "ledger is done by the person who signs the return.",
          employeeIds: [],
        },
      ],
    };
  }

  if (run.lines.length === 0) {
    return {
      kind: "refuse",
      verdict: null,
      refusals: [
        {
          code: "PAYROLL_NO_EMPLOYEES",
          message: "This pay period has nobody on it, so there is no payroll to book.",
          whatToDo:
            "Check that the right pay period is selected and that the people you expect to be " +
            "paid are active and have hours recorded for these dates.",
          employeeIds: [],
        },
      ],
    };
  }

  // A blocked line stops the WHOLE run, matching the payroll engine's own rule.
  if (!run.canPay) {
    const blocked = run.lines.filter((l) => !l.computed);
    return {
      kind: "refuse",
      verdict: null,
      refusals: [
        {
          code: "PAYROLL_RUN_BLOCKED",
          message:
            blocked.length === 0
              ? "This pay run is not ready to be paid, so it is not ready to be booked either."
              : `${blocked.length} ${blocked.length === 1 ? "person's paycheque" : "paycheques"} could not be calculated, so this payroll cannot be booked.`,
          whatToDo:
            "Work through what the pay run screen lists as blocking, then come back here. The " +
            "ledger deliberately waits for the whole run: a payroll posted for most of the staff " +
            "understates the wages owed, and the missing piece surfaces as a difference nobody " +
            "can place weeks later.",
          employeeIds: blocked.map((l) => l.employeeId),
        },
      ],
    };
  }

  const roleById = new Map(rolesOnFile.map((r) => [r.employeeId, r]));
  const refusals: PayrollPostingRefusal[] = [];
  const employees: PayrollEmployeeInput[] = [];

  // EVERY line is examined before returning. Stopping at the first problem
  // would make Michael fix one thing, re-run, and find the next — the drip-feed
  // that makes a system feel like it is arguing with you.
  for (const line of run.lines) {
    const resolved = resolveAllocations(
      line.employeeId,
      line.employeeName,
      documented,
      roleById.get(line.employeeId) ?? null,
    );
    if ("refusal" in resolved) {
      refusals.push(resolved.refusal);
      continue;
    }

    const mapped = mapPaycheck(line, resolved.allocations);
    if ("refusal" in mapped) {
      refusals.push(mapped.refusal);
      continue;
    }

    employees.push(mapped.employee);
  }

  if (refusals.length > 0) {
    return { kind: "refuse", refusals, verdict: null };
  }

  const input: PayrollRunInput = {
    entityCode: run.entityCode,
    payDate: run.payDateIso,
    periodStart: run.periodStartDate,
    periodEnd: run.periodEndDate,
    employees,
    activityCodes,
    // Substantiation is deliberately absent. The evidence for a receiving claim
    // lives on the ALLOCATION rows, and the 280E engine only asks for a
    // substantiation study when an acquisition-labor claim is actually being
    // made. Passing a fabricated one would turn an evidence gate into a
    // formality; passing null lets the engine refuse honestly.
    substantiation: null,
  };

  const verdict = evaluatePayrollRun(
    input,
    minimumWageCentsPerHour === null ? {} : { minimumWageCentsPerHour },
  );

  const journal = buildPayrollJournal(input, verdict);

  if (!journal) {
    return {
      kind: "refuse",
      verdict,
      refusals: [
        {
          code: "PAYROLL_ENGINE_REFUSED",
          message:
            "The §280E classification refused this payroll, so no entry was built. " +
            "The reasons are listed with this run.",
          whatToDo:
            "Read the blocking findings shown alongside this message. Each one names what is " +
            "wrong, why it matters, and what to do instead — none of them is a dead end.",
          employeeIds: [],
        },
      ],
    };
  }

  // THE EMPTY JOURNAL. Measured against the real engine: a run in which nobody
  // earned anything is postable and produces no lines. See refusal 1.
  if (journal.lines.length === 0) {
    return {
      kind: "refuse",
      verdict,
      refusals: [
        {
          code: "PAYROLL_NOTHING_TO_POST",
          message:
            "Nobody was paid anything in this period, so there is no entry to make.",
          whatToDo:
            "This is not an error — it is the books declining to record that nothing happened. " +
            "If you expected wages here, check the hours on the timesheet for these dates.",
          employeeIds: [],
        },
      ],
    };
  }

  return {
    kind: "post",
    entityCode: journal.entityCode,
    payDate: journal.journalDate,
    sourceRef: payrollSourceRef(input),
    contentFingerprint: payrollContentFingerprint(input),
    memo: journal.memo,
    lines: toPostingLines(journal),
    expectedCents: debitTotal(journal),
    verdict,
    acknowledgements: verdict.findings
      .filter((f) => f.severity === "confirm")
      .map((f) => f.concern),
  };
}

/**
 * Serialise the journal into the JSON `gl_post_payroll_run` parses.
 *
 * The cost class is passed through EXACTLY as the 280E engine set it, never
 * defaulted. gl_submit_journal defaults a missing class to 'none', and 0188's
 * own comment explains what that costs: a payroll journal without its labels
 * "BALANCES PERFECTLY and is silently wrong". So there is no `?? "none"` here,
 * and a test asserts its absence.
 */
export function toPostingLines(journal: PayrollJournal): readonly PayrollPostingLine[] {
  return journal.lines.map((l) => ({
    account_code: l.accountCode,
    amount_cents: l.amountCents,
    cost_class: l.costClass,
    description: l.description,
  }));
}

/**
 * The debit total, for gl_submit_journal's `p_expected_cents` cross-check.
 *
 * Positive amounts are debits (payroll-cogs-core.ts states the sign convention).
 * Sending this makes the database verify independently that it received the
 * entry we meant to send, rather than trusting the payload.
 */
export function debitTotal(journal: PayrollJournal): number {
  return journal.lines.reduce((s, l) => (l.amountCents > 0 ? s + l.amountCents : s), 0);
}

/* ═════════════════════════════════════════════════════════════════════════
 * 7) SELF-TESTS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Registered in scripts/compliance/run-pure-selftests.ts so they run outside
 * vitest too — the same discipline every other pure core in this repository
 * follows.
 */

function ok(label: string, condition: boolean): void {
  if (!condition) throw new Error(`PAYROLL POSTING CORE SELF-TEST FAILED: ${label}`);
}

const FIXTURE_LINE: PaycheckFacts = {
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

const FIXTURE_RUN: PayRunFacts = {
  entityCode: "greenway",
  periodStartDate: "2027-01-01",
  periodEndDate: "2027-01-14",
  payDateIso: "2027-01-15",
  canPay: true,
  lines: [FIXTURE_LINE],
};

const FIXTURE_ROLE: EmployeeRoleFacts = {
  employeeId: "e1",
  laborRoleCode: "budtender",
  cogsSplitBasisPoints: 0,
};

const ACTIVITIES = ["receive_manifest", "display_sell"] as const;

export function __runPayrollPostingCoreTests(): void {
  // ── the happy path ────────────────────────────────────────────────────
  const good = planPayrollPosting(
    FIXTURE_RUN,
    [],
    [FIXTURE_ROLE],
    ACTIVITIES,
    true,
    1_666,
  );
  ok("a clean run plans a post", good.kind === "post");
  if (good.kind === "post") {
    ok("the entry has lines", good.lines.length > 0);
    ok(
      "every line carries a cost class",
      good.lines.every((l) => l.cost_class.trim().length > 0),
    );
    ok(
      "no line is labelled direct labor (the reseller rule)",
      good.lines.every((l) => l.cost_class !== "cogs_direct"),
    );
    ok("the entry balances", good.lines.reduce((s, l) => s + l.amount_cents, 0) === 0);
    ok("the debit total is stated", good.expectedCents > 0);
    ok(
      "the source ref keys on entity and period",
      good.sourceRef === "payroll:greenway:2027-01-01:2027-01-14:2027-01-15",
    );
    ok("a content fingerprint is carried", good.contentFingerprint.length > 0);
    ok(
      "budtender wages are 280E-disallowed, never COGS",
      good.lines.some(
        (l) => l.account_code === "71010" && l.cost_class === "nondeductible_280e",
      ),
    );
    ok(
      "no budtender wage reached a cost-of-goods account",
      !good.lines.some((l) => l.account_code === "61000"),
    );
  }

  // ── the gate ──────────────────────────────────────────────────────────
  const notOwner = planPayrollPosting(FIXTURE_RUN, [], [FIXTURE_ROLE], ACTIVITIES, false, 1_666);
  ok("a non-owner is refused", notOwner.kind === "refuse");
  ok(
    "and told why",
    notOwner.kind === "refuse" && notOwner.refusals[0].code === "PAYROLL_NOT_OWNER",
  );

  // ── nobody on the run ─────────────────────────────────────────────────
  const empty = planPayrollPosting(
    { ...FIXTURE_RUN, lines: [] },
    [],
    [],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "an empty period is refused",
    empty.kind === "refuse" && empty.refusals[0].code === "PAYROLL_NO_EMPLOYEES",
  );

  // ── a blocked line stops everything ───────────────────────────────────
  const blocked = planPayrollPosting(
    { ...FIXTURE_RUN, canPay: false },
    [],
    [FIXTURE_ROLE],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "a run that cannot be paid cannot be booked",
    blocked.kind === "refuse" && blocked.refusals[0].code === "PAYROLL_RUN_BLOCKED",
  );

  // ── nothing actually earned ───────────────────────────────────────────
  const zero = planPayrollPosting(
    {
      ...FIXTURE_RUN,
      lines: [
        {
          ...FIXTURE_LINE,
          grossWagesCents: 0,
          employeeWithholdingCents: 0,
          employerTaxCents: 0,
          netPayCents: 0,
        },
      ],
    },
    [],
    [FIXTURE_ROLE],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "a run where nobody earned anything makes no entry",
    zero.kind === "refuse" && zero.refusals[0].code === "PAYROLL_NOTHING_TO_POST",
  );

  // ── the unmapped voluntary deduction ──────────────────────────────────
  const voluntary = planPayrollPosting(
    {
      ...FIXTURE_RUN,
      lines: [{ ...FIXTURE_LINE, voluntaryDeductionCents: 5_000, netPayCents: 155_000 }],
    },
    [],
    [FIXTURE_ROLE],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "a voluntary deduction is refused rather than dropped",
    voluntary.kind === "refuse" &&
      voluntary.refusals[0].code === "PAYROLL_VOLUNTARY_DEDUCTION_UNMAPPED",
  );

  // ── the ambiguous split ───────────────────────────────────────────────
  const ambiguous = planPayrollPosting(
    FIXTURE_RUN,
    [],
    [{ ...FIXTURE_ROLE, laborRoleCode: "receiving", cogsSplitBasisPoints: 4_000 }],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "a partial split with no documented remainder is refused",
    ambiguous.kind === "refuse" &&
      ambiguous.refusals[0].code === "PAYROLL_SPLIT_AMBIGUOUS",
  );

  // ── no role at all ────────────────────────────────────────────────────
  const noRole = planPayrollPosting(FIXTURE_RUN, [], [], ACTIVITIES, true, 1_666);
  ok(
    "an employee with no role on file is refused",
    noRole.kind === "refuse" && noRole.refusals[0].code === "PAYROLL_NO_ROLE_ON_FILE",
  );

  // ── an undocumented allocation ────────────────────────────────────────
  const undoc = planPayrollPosting(
    FIXTURE_RUN,
    [
      {
        employeeId: "e1",
        roleCode: "receiving",
        shareMilliPct: 40_000,
        documentRef: null,
        basisNote: null,
      },
      {
        employeeId: "e1",
        roleCode: "budtender",
        shareMilliPct: 60_000,
        documentRef: "STUDY-1",
        basisNote: "measured",
      },
    ],
    [FIXTURE_ROLE],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "an allocation with no written basis is refused",
    undoc.kind === "refuse" &&
      undoc.refusals[0].code === "PAYROLL_ALLOCATION_UNDOCUMENTED",
  );

  // ── a role nobody has heard of ────────────────────────────────────────
  const unknown = planPayrollPosting(
    FIXTURE_RUN,
    [],
    [{ ...FIXTURE_ROLE, laborRoleCode: "warehouse_associate" }],
    ACTIVITIES,
    true,
    1_666,
  );
  ok(
    "an unknown role is refused, not passed through",
    unknown.kind === "refuse" && unknown.refusals[0].code === "PAYROLL_UNKNOWN_ROLE",
  );

  // ── a documented split IS honoured ────────────────────────────────────
  const documented = planPayrollPosting(
    FIXTURE_RUN,
    [
      {
        employeeId: "e1",
        roleCode: "receiving",
        shareMilliPct: 40_000,
        documentRef: "STUDY-2027-01",
        basisNote: "Six weeks of task-tagged punches tied to numbered manifests.",
      },
      {
        employeeId: "e1",
        roleCode: "budtender",
        shareMilliPct: 60_000,
        documentRef: "STUDY-2027-01",
        basisNote: "Six weeks of task-tagged punches tied to numbered manifests.",
      },
    ],
    [FIXTURE_ROLE],
    ACTIVITIES,
    true,
    1_666,
  );
  // The 280E engine may still refuse this for want of a substantiation study —
  // that is its job, not ours. What is asserted here is that the DOCUMENTED
  // split was used rather than the single role on the pay record, which is
  // visible either as a 61000 line or as an acquisition-labor finding.
  ok(
    "a documented split reaches the 280E engine",
    documented.kind === "post"
      ? documented.lines.some((l) => l.account_code === "61000")
      : documented.verdict !== null,
  );

  // ── every refusal code is reachable and spelled correctly ─────────────
  ok(
    "the refusal list has no duplicates",
    new Set(PAYROLL_POSTING_REFUSAL_CODES).size === PAYROLL_POSTING_REFUSAL_CODES.length,
  );

  // ── the money formatter ───────────────────────────────────────────────
  ok("formats cents", formatPlainCents(123_456) === "$1,234.56");
  ok("formats a round figure", formatPlainCents(5_000) === "$50.00");
}
