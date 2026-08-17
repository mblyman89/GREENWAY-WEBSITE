/**
 * tests/compliance/journal-advisor-core.test.ts   (slice books-01)
 *
 * The SECOND gate over the journal advisor. `journal-advisor-core.ts` carries its
 * own `__runJournalAdvisorCoreTests()`, which the pure self-test runner calls;
 * this file re-runs that suite under vitest AND adds independent assertions that
 * do not exist inside the module.
 *
 * WHY TWO GATES OVER THE SAME CODE
 * Because a self-test that lives inside the module it tests can be weakened by
 * the same edit that breaks the module. The mutation campaign for this slice
 * requires every real mutant to die on BOTH gates; a mutant that dies only in
 * one is a warning that one gate is decorative.
 *
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 *   • The advisor's central promise, asserted structurally rather than by
 *     example: nothing outside HARD_BLOCK_REASONS may ever be un-overridable.
 *   • Source-level drift checks that read the file from disk, so a future edit
 *     that quietly re-widens the books gate or adds a fourth hard block fails
 *     here rather than in production.
 *   • Property-style sweeps over generated drafts, which catch classes of bug
 *     that hand-written examples miss.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  __runJournalAdvisorCoreTests,
  evaluateJournalDraft,
  canSubmit,
  buildAssumptionNote,
  isBalanced,
  sumDebits,
  sumCredits,
  formatCents,
  isValidIsoDate,
  findPattern,
  ADVISOR_PATTERNS,
  ADVISOR_COST_CLASSES,
  HARD_BLOCK_REASONS,
  SECTION_7872_DE_MINIMIS_CENTS,
  DE_MINIMIS_CAPITALISATION_CENTS,
  type AdvisorAccount,
  type AdvisorContext,
  type AdvisorDraft,
} from "@/lib/accounting/journal-advisor-core";

import { canReadBooks, DB_IS_OWNER_ROLES, DB_IS_ADMIN_ROLES } from "@/lib/accounting/books-view-core";
import { can, rolesForPermission, ALL_ROLES } from "@/lib/auth/roles";
import { toCents } from "@/app/admin/books/journal/JournalEntryForm";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function acct(over: Partial<AdvisorAccount> & { code: string }): AdvisorAccount {
  return {
    name: over.name ?? `Account ${over.code}`,
    type: over.type ?? "expense",
    normalBalance: over.normalBalance ?? "debit",
    requiresCostClass: over.requiresCostClass ?? false,
    isControl: over.isControl ?? false,
    isActive: over.isActive ?? true,
    allowedEntities: over.allowedEntities,
    code: over.code,
  };
}

const SIMPLE_CTX: AdvisorContext = {
  accounts: {
    "60100": acct({ code: "60100", name: "Shop supplies", type: "expense" }),
    "10100": acct({ code: "10100", name: "Bank — operating", type: "asset" }),
  },
};

function draft(over: Partial<AdvisorDraft> = {}): AdvisorDraft {
  return {
    entityCode: over.entityCode ?? "greenway",
    journalDate: over.journalDate ?? "2026-11-15",
    memo: over.memo ?? "Cash purchase of shop supplies, receipt in the drawer",
    lines:
      over.lines ?? [
        { accountCode: "60100", amountCents: 4523 },
        { accountCode: "10100", amountCents: -4523 },
      ],
  };
}

const SRC_DIR = resolve(__dirname, "../../src/lib/accounting");
function readSrc(name: string): string {
  return readFileSync(resolve(SRC_DIR, name), "utf8");
}

// ---------------------------------------------------------------------------

describe("journal-advisor-core: the module's own self-tests", () => {
  it("passes its embedded suite", () => {
    expect(() => __runJournalAdvisorCoreTests()).not.toThrow();
  });

  it("is deterministic — running the suite twice changes nothing", () => {
    expect(() => __runJournalAdvisorCoreTests()).not.toThrow();
    expect(() => __runJournalAdvisorCoreTests()).not.toThrow();
  });
});

describe("the central promise: pushback yields, law does not", () => {
  it("refuses ONLY for a hard block, never for advice", () => {
    // A draft that trips a confirm-level finding must still be postable.
    const v = evaluateJournalDraft(
      draft({
        memo: "Loaned employee Dave money for his truck",
        lines: [
          { accountCode: "60100", amountCents: 50000 },
          { accountCode: "10100", amountCents: -50000 },
        ],
      }),
      SIMPLE_CTX,
    );
    expect(v.postable).toBe(true);
    expect(v.needsAcknowledgement).toBe(true);
    expect(canSubmit(v, []).ok).toBe(false);
    // ...and acknowledging yields.
    const codes = v.findings.filter((f) => f.severity === "confirm").map((f) => f.code);
    expect(canSubmit(v, codes).ok).toBe(true);
  });

  it("EVERY confirm-level finding in the pattern library can be acknowledged away", () => {
    // This is the structural version of the promise. Rather than testing one
    // example, assert that no confirm finding is ever a veto.
    const cases: Array<{ d: AdvisorDraft; c: AdvisorContext }> = [
      // control account
      {
        d: draft({
          memo: "Hand adjusting accounts payable for a vendor credit note",
          lines: [
            { accountCode: "20100", amountCents: 25000 },
            { accountCode: "60100", amountCents: -25000 },
          ],
        }),
        c: {
          accounts: {
            "20100": acct({ code: "20100", type: "liability", normalBalance: "credit", isControl: true }),
            "60100": acct({ code: "60100", type: "expense" }),
          },
        },
      },
      // missing cost class
      {
        d: draft({
          memo: "Cash purchase of flower from a farm, invoice 4471",
          lines: [
            { accountCode: "50100", amountCents: 123456 },
            { accountCode: "10100", amountCents: -123456 },
          ],
        }),
        c: {
          accounts: {
            "50100": acct({ code: "50100", type: "cogs", requiresCostClass: true }),
            "10100": acct({ code: "10100", type: "asset" }),
          },
        },
      },
      // capitalisable
      {
        d: draft({
          memo: "Bought a walk-in safe for the back room, invoice 88120",
          lines: [
            { accountCode: "60100", amountCents: 900000 },
            { accountCode: "10100", amountCents: -900000 },
          ],
        }),
        c: SIMPLE_CTX,
      },
      // inactive account
      {
        d: draft({
          memo: "Posted to a retired account by mistake this morning",
          lines: [
            { accountCode: "69999", amountCents: 1000 },
            { accountCode: "10100", amountCents: -1000 },
          ],
        }),
        c: {
          accounts: {
            "69999": acct({ code: "69999", type: "expense", isActive: false }),
            "10100": acct({ code: "10100", type: "asset" }),
          },
        },
      },
      // wrong entity
      {
        d: draft({
          memo: "Posting the ATM vault account into the store books",
          lines: [
            { accountCode: "10300", amountCents: 1000 },
            { accountCode: "10100", amountCents: -1000 },
          ],
        }),
        c: {
          accounts: {
            "10300": acct({ code: "10300", type: "asset", allowedEntities: ["atm"] }),
            "10100": acct({ code: "10100", type: "asset" }),
          },
        },
      },
      // personal in business
      {
        d: draft({
          memo: "Bought a birthday gift, this was not a business cost",
          lines: [
            { accountCode: "60100", amountCents: 5000, costClass: "personal" },
            { accountCode: "10100", amountCents: -5000 },
          ],
        }),
        c: SIMPLE_CTX,
      },
      // intercompany
      {
        d: draft({
          memo: "Monthly rent paid to landholding for the Geiger building",
          lines: [
            { accountCode: "60100", amountCents: 200000 },
            { accountCode: "10100", amountCents: -200000 },
          ],
        }),
        c: SIMPLE_CTX,
      },
    ];

    for (const { d, c } of cases) {
      const v = evaluateJournalDraft(d, c);
      const confirms = v.findings.filter((f) => f.severity === "confirm").map((f) => f.code);
      expect(confirms.length).toBeGreaterThan(0);
      expect(v.postable).toBe(true);
      // The yield: acknowledging every confirm lets it through.
      expect(canSubmit(v, confirms).ok).toBe(true);
    }
  });

  it("a hard block can NEVER be acknowledged away, no matter what is passed", () => {
    const blockers: AdvisorDraft[] = [
      // unbalanced
      draft({
        lines: [
          { accountCode: "60100", amountCents: 5000 },
          { accountCode: "10100", amountCents: -4523 },
        ],
      }),
      // impossible date
      draft({ journalDate: "2026-02-30" }),
      // memo too short
      draft({ memo: "x" }),
    ];
    for (const d of blockers) {
      const v = evaluateJournalDraft(d, SIMPLE_CTX);
      expect(v.postable).toBe(false);
      // Throw the kitchen sink at it: every known code, acknowledged.
      const everything = [
        ...HARD_BLOCK_REASONS,
        ...ADVISOR_PATTERNS.map((p) => p.code),
        "ADV_BAD_DATE",
        "ADV_MEMO_TOO_SHORT",
        "ADV_UNKNOWN_ACCOUNT",
        "ADV_NON_INTEGER_AMOUNT",
      ];
      expect(canSubmit(v, everything).ok).toBe(false);
    }
  });

  it("no pattern in the library is phrased as a refusal", () => {
    // The tone IS the feature. A suggestion that says "cannot" teaches the owner
    // the system is an obstacle.
    for (const p of ADVISOR_PATTERNS) {
      expect(p.suggestion).not.toMatch(/\bcannot be posted\b|\brefused\b|\bnot allowed\b/i);
      expect(p.suggestion.length).toBeGreaterThan(40);
      expect(p.concern.length).toBeGreaterThan(40);
    }
  });
});

describe("hard blocks are exactly three, and each is arithmetic or statute", () => {
  it("the policy list has not grown", () => {
    expect(HARD_BLOCK_REASONS).toHaveLength(3);
    expect([...HARD_BLOCK_REASONS].sort()).toEqual([
      "ADV_EXCISE_MISCODED",
      "ADV_PERIOD_CLOSED",
      "ADV_UNBALANCED",
    ]);
  });

  it("the excise block cites RCW 69.50.535 and points at the line", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Recording November excise as if it were our revenue",
        lines: [
          { accountCode: "40100", amountCents: 100000 },
          { accountCode: "10100", amountCents: -100000 },
        ],
      }),
      {
        accounts: {
          "40100": acct({ code: "40100", type: "revenue", normalBalance: "credit" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
        exciseAccountCodes: ["40100"],
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_EXCISE_MISCODED");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("block");
    expect(f!.authority).toContain("69.50.535");
    expect(f!.lines).toEqual([1]);
  });

  it("excise correctly parked in a liability is not blocked (negative control)", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Accruing November cannabis excise to the payable account",
        lines: [
          { accountCode: "10100", amountCents: 100000 },
          { accountCode: "20500", amountCents: -100000 },
        ],
      }),
      {
        accounts: {
          "10100": acct({ code: "10100", type: "asset" }),
          "20500": acct({ code: "20500", type: "liability", normalBalance: "credit" }),
        },
        exciseAccountCodes: ["20500"],
      },
    );
    expect(v.findings.some((f) => f.code === "ADV_EXCISE_MISCODED")).toBe(false);
  });

  it("a closed period blocks and names the date", () => {
    const v = evaluateJournalDraft(draft({ journalDate: "2026-11-15" }), {
      ...SIMPLE_CTX,
      periodClosed: true,
    });
    const f = v.findings.find((x) => x.code === "ADV_PERIOD_CLOSED");
    expect(f!.severity).toBe("block");
    expect(f!.concern).toContain("2026-11-15");
    expect(f!.authority).toContain("ASC 250");
  });
});

describe("arithmetic is exact — there is no tolerance on a hand-keyed entry", () => {
  it("one cent out is refused, in both directions", () => {
    for (const delta of [1, -1]) {
      const v = evaluateJournalDraft(
        draft({
          lines: [
            { accountCode: "60100", amountCents: 4523 + delta },
            { accountCode: "10100", amountCents: -4523 },
          ],
        }),
        SIMPLE_CTX,
      );
      expect(v.postable).toBe(false);
      expect(v.differenceCents).toBe(delta);
    }
  });

  it("a many-line entry that nets to zero balances", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Split cash purchase across three expense categories today",
        lines: [
          { accountCode: "60100", amountCents: 1000 },
          { accountCode: "60100", amountCents: 2000 },
          { accountCode: "60100", amountCents: 3007 },
          { accountCode: "10100", amountCents: -6007 },
        ],
      }),
      SIMPLE_CTX,
    );
    expect(v.differenceCents).toBe(0);
    expect(v.findings.some((f) => f.code === "ADV_UNBALANCED")).toBe(false);
  });

  it("the suggested fix always names the exact shortfall", () => {
    const v = evaluateJournalDraft(
      draft({
        lines: [
          { accountCode: "60100", amountCents: 10000 },
          { accountCode: "10100", amountCents: -9999 },
        ],
      }),
      SIMPLE_CTX,
    );
    const f = v.findings.find((x) => x.code === "ADV_UNBALANCED")!;
    expect(f.suggestion).toContain("$0.01");
  });

  it("property sweep: for random balanced drafts, ADV_UNBALANCED never fires", () => {
    // Deterministic pseudo-random so a failure is reproducible.
    let seed = 987654321;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 400; i += 1) {
      const a = (next() % 5_000_000) + 1;
      const b = (next() % 5_000_000) + 1;
      const v = evaluateJournalDraft(
        draft({
          memo: "A perfectly ordinary split entry for the property sweep",
          lines: [
            { accountCode: "60100", amountCents: a },
            { accountCode: "60100", amountCents: b },
            { accountCode: "10100", amountCents: -(a + b) },
          ],
        }),
        SIMPLE_CTX,
      );
      expect(v.differenceCents).toBe(0);
      expect(v.findings.some((f) => f.code === "ADV_UNBALANCED")).toBe(false);
    }
  });

  it("property sweep: for random UNbalanced drafts, ADV_UNBALANCED always fires", () => {
    let seed = 24681357;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 400; i += 1) {
      const a = (next() % 5_000_000) + 1;
      const skew = (next() % 999) + 1; // never zero
      const v = evaluateJournalDraft(
        draft({
          memo: "A deliberately lopsided entry for the property sweep test",
          lines: [
            { accountCode: "60100", amountCents: a },
            { accountCode: "10100", amountCents: -(a + skew) },
          ],
        }),
        SIMPLE_CTX,
      );
      expect(v.postable).toBe(false);
      expect(v.findings.some((f) => f.code === "ADV_UNBALANCED" && f.severity === "block")).toBe(true);
    }
  });
});

describe("the employee loan — the owner's own worked example", () => {
  it("under $10,000 it explains there is nothing extra to do", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Loaned employee Dave $500 against his next cheque",
        lines: [
          { accountCode: "60100", amountCents: 50000 },
          { accountCode: "10100", amountCents: -50000 },
        ],
      }),
      SIMPLE_CTX,
    );
    const f = v.findings.find((x) => x.code === "ADV_EMPLOYEE_LOAN")!;
    expect(f.severity).toBe("confirm");
    expect(f.authority).toContain("7872");
    expect(f.suggestion).toContain("under the $10,000 threshold");
  });

  it("over $10,000 it warns about imputed interest", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Loan to employee Dave to cover his truck repair bill",
        lines: [
          { accountCode: "60100", amountCents: SECTION_7872_DE_MINIMIS_CENTS + 1 },
          { accountCode: "10100", amountCents: -(SECTION_7872_DE_MINIMIS_CENTS + 1) },
        ],
      }),
      SIMPLE_CTX,
    );
    const f = v.findings.find((x) => x.code === "ADV_EMPLOYEE_LOAN")!;
    expect(f.suggestion).toContain("above the $10,000 threshold");
    expect(f.suggestion.toLowerCase()).toContain("impute");
  });

  it("EXACTLY $10,000 is still under — §7872(c)(3)(A) says 'does not exceed'", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Loan to employee Dave, exactly ten thousand dollars even",
        lines: [
          { accountCode: "60100", amountCents: SECTION_7872_DE_MINIMIS_CENTS },
          { accountCode: "10100", amountCents: -SECTION_7872_DE_MINIMIS_CENTS },
        ],
      }),
      SIMPLE_CTX,
    );
    const f = v.findings.find((x) => x.code === "ADV_EMPLOYEE_LOAN")!;
    expect(f.suggestion).toContain("under the $10,000 threshold");
  });

  it("does not nag when the loan is already coded to a receivable", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Loaned employee Dave $500 against his next cheque",
        lines: [
          { accountCode: "11800", amountCents: 50000 },
          { accountCode: "10100", amountCents: -50000 },
        ],
      }),
      {
        accounts: {
          "11800": acct({ code: "11800", name: "Employee advances", type: "asset" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
        employeeAdvanceAccountCodes: ["11800"],
      },
    );
    expect(v.findings.some((f) => f.code === "ADV_EMPLOYEE_LOAN")).toBe(false);
  });

  it("needs BOTH an employee word and a loan word — one alone is not enough", () => {
    const employeeOnly = evaluateJournalDraft(
      draft({ memo: "Employee lunch for the whole crew on Friday afternoon" }),
      SIMPLE_CTX,
    );
    expect(employeeOnly.findings.some((f) => f.code === "ADV_EMPLOYEE_LOAN")).toBe(false);

    const loanOnly = evaluateJournalDraft(
      draft({ memo: "Loan payment made to Timberland Bank this morning" }),
      SIMPLE_CTX,
    );
    expect(loanOnly.findings.some((f) => f.code === "ADV_EMPLOYEE_LOAN")).toBe(false);
  });
});

describe("280E cost-class tagging — the highest-value column in the ledger", () => {
  const CTX: AdvisorContext = {
    accounts: {
      "50100": acct({ code: "50100", name: "Cannabis COGS", type: "cogs", requiresCostClass: true }),
      "10100": acct({ code: "10100", type: "asset" }),
    },
  };

  it("asks when a requiring account has no tag", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Cash purchase of flower from a farm, invoice 4471",
        lines: [
          { accountCode: "50100", amountCents: 123456 },
          { accountCode: "10100", amountCents: -123456 },
        ],
      }),
      CTX,
    );
    const f = v.findings.find((x) => x.code === "ADV_MISSING_COST_CLASS")!;
    expect(f.severity).toBe("confirm");
    expect(f.authority).toContain("280E");
    expect(f.authority).toContain("471");
  });

  it("treats 'none' on a requiring account as no answer", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Cash purchase of flower from a farm, invoice 4471",
        lines: [
          { accountCode: "50100", amountCents: 123456, costClass: "none" },
          { accountCode: "10100", amountCents: -123456 },
        ],
      }),
      CTX,
    );
    expect(v.findings.some((f) => f.code === "ADV_MISSING_COST_CLASS")).toBe(true);
  });

  it("accepts every real cost class without complaint", () => {
    for (const cc of ADVISOR_COST_CLASSES) {
      if (cc === "none") continue;
      const v = evaluateJournalDraft(
        draft({
          entityCode: cc === "personal" ? "personal" : "greenway",
          memo: "Cash purchase of flower from a farm, invoice 4471",
          lines: [
            { accountCode: "50100", amountCents: 123456, costClass: cc },
            { accountCode: "10100", amountCents: -123456 },
          ],
        }),
        CTX,
      );
      expect(v.findings.some((f) => f.code === "ADV_MISSING_COST_CLASS")).toBe(false);
    }
  });

  it("the cost-class vocabulary matches the database enum exactly", () => {
    // Drift guard: read the enum out of migration 0172 and compare.
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/migrations/0172_gl_foundation.sql"),
      "utf8",
    );
    for (const cc of ADVISOR_COST_CLASSES) {
      expect(sql).toContain(`'${cc}'`);
    }
    expect(ADVISOR_COST_CLASSES).toHaveLength(6);
  });
});

describe("capitalisation safe harbour boundaries", () => {
  it("fires at the threshold and not one cent below", () => {
    const below = evaluateJournalDraft(
      draft({
        memo: "Bought a printer for the back office, invoice 88121",
        lines: [
          { accountCode: "60100", amountCents: DE_MINIMIS_CAPITALISATION_CENTS - 1 },
          { accountCode: "10100", amountCents: -(DE_MINIMIS_CAPITALISATION_CENTS - 1) },
        ],
      }),
      SIMPLE_CTX,
    );
    expect(below.findings.some((f) => f.code === "ADV_CAPITALISABLE")).toBe(false);

    const at = evaluateJournalDraft(
      draft({
        memo: "Bought a display case for the sales floor, invoice 88122",
        lines: [
          { accountCode: "60100", amountCents: DE_MINIMIS_CAPITALISATION_CENTS },
          { accountCode: "10100", amountCents: -DE_MINIMIS_CAPITALISATION_CENTS },
        ],
      }),
      SIMPLE_CTX,
    );
    expect(at.findings.some((f) => f.code === "ADV_CAPITALISABLE")).toBe(true);
  });

  it("a refund credit to an expense is not a capitalisation question", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Refund received on the returned display case, credit note 91",
        lines: [
          { accountCode: "60100", amountCents: -900000 },
          { accountCode: "10100", amountCents: 900000 },
        ],
      }),
      SIMPLE_CTX,
    );
    expect(v.findings.some((f) => f.code === "ADV_CAPITALISABLE")).toBe(false);
  });

  it("the constant is the verified §1.263(a)-1(f) amount", () => {
    expect(DE_MINIMIS_CAPITALISATION_CENTS).toBe(250000);
  });
});

describe("the assumption note preserves the judgement call", () => {
  it("is null when nothing was overridden", () => {
    const v = evaluateJournalDraft(draft(), SIMPLE_CTX);
    expect(buildAssumptionNote(v, [])).toBeNull();
  });

  it("names every overridden warning and records the confirmation", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Loaned employee Dave money and hand-keyed the payable too",
        lines: [
          { accountCode: "60100", amountCents: 25000 },
          { accountCode: "20100", amountCents: -25000 },
        ],
      }),
      {
        accounts: {
          "60100": acct({ code: "60100", type: "expense" }),
          "20100": acct({ code: "20100", type: "liability", normalBalance: "credit", isControl: true }),
        },
      },
    );
    const confirms = v.findings.filter((f) => f.severity === "confirm").map((f) => f.code);
    expect(confirms.length).toBeGreaterThanOrEqual(2);
    const note = buildAssumptionNote(v, confirms)!;
    for (const c of confirms) expect(note).toContain(c);
    expect(note).toContain("owner confirmed");
  });

  it("ignores advisory findings — they are not overrides", () => {
    const v = evaluateJournalDraft(
      draft({
        memo: "Transferred cash between the two operating bank accounts",
        lines: [
          { accountCode: "60100", amountCents: 500000 },
          { accountCode: "10100", amountCents: -500000 },
        ],
      }),
      SIMPLE_CTX,
    );
    // The round-number finding is advisory; acknowledging it must not produce a note.
    expect(buildAssumptionNote(v, ["ADV_ROUND_NUMBER"])).toBeNull();
  });
});

describe("small helpers behave under abuse", () => {
  it("sums cope with empty and single-sided input", () => {
    expect(sumDebits([])).toBe(0);
    expect(sumCredits([])).toBe(0);
    expect(sumDebits([{ accountCode: "a", amountCents: -5 }])).toBe(0);
    expect(sumCredits([{ accountCode: "a", amountCents: 5 }])).toBe(0);
  });

  it("isBalanced is exact", () => {
    expect(isBalanced([{ accountCode: "a", amountCents: 1 }, { accountCode: "b", amountCents: -1 }])).toBe(true);
    expect(isBalanced([])).toBe(true); // nothing is trivially balanced; length is checked separately
    expect(isBalanced([{ accountCode: "a", amountCents: 1 }])).toBe(false);
  });

  it("formatCents handles the awkward cases", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(10)).toBe("$0.10");
    expect(formatCents(99)).toBe("$0.99");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(-1)).toBe("-$0.01");
    expect(formatCents(1000000)).toBe("$10,000.00");
  });

  it("isValidIsoDate rejects everything that is not a real ISO day", () => {
    for (const bad of [
      "", "2026", "2026-1-1", "26-01-01", "2026-01-1", "2026/01/01",
      "2026-00-10", "2026-13-10", "2026-01-00", "2026-01-32",
      "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31",
      "2026-02-29", "1900-02-29", "abcd-ef-gh",
    ]) {
      expect(isValidIsoDate(bad)).toBe(false);
    }
    for (const good of ["2026-01-01", "2026-11-01", "2026-10-31", "2026-12-31", "2024-02-29", "2000-02-29"]) {
      expect(isValidIsoDate(good)).toBe(true);
    }
  });

  it("findPattern is total", () => {
    expect(findPattern("ADV_EMPLOYEE_LOAN")).toBeDefined();
    expect(findPattern("")).toBeUndefined();
    expect(findPattern("ADV_NOT_REAL")).toBeUndefined();
  });

  it("survives a completely empty draft without throwing", () => {
    const v = evaluateJournalDraft(
      { entityCode: "greenway", journalDate: "", memo: "", lines: [] },
      { accounts: {} },
    );
    expect(v.postable).toBe(false);
    expect(v.findings.length).toBeGreaterThan(0);
  });

  it("survives unknown accounts everywhere without throwing", () => {
    const v = evaluateJournalDraft(
      draft({
        lines: [
          { accountCode: "nope", amountCents: 100 },
          { accountCode: "also-nope", amountCents: -100 },
        ],
      }),
      { accounts: {} },
    );
    expect(v.postable).toBe(false);
    expect(v.findings.some((f) => f.code === "ADV_UNKNOWN_ACCOUNT")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OWNER-ONLY LOCKDOWN — the other half of this slice
// ---------------------------------------------------------------------------

describe("the books are owner-only (owner decision 2026-08-17)", () => {
  it("only the owner may read the books", () => {
    expect(canReadBooks("owner")).toBe(true);
    for (const role of ["admin", "manager", "content_editor", "staff", "readonly"] as const) {
      expect(canReadBooks(role)).toBe(false);
    }
    expect(canReadBooks(null)).toBe(false);
    expect(canReadBooks(undefined)).toBe(false);
  });

  it("the app gate matches the database gate for EVERY role", () => {
    for (const role of ALL_ROLES) {
      expect(canReadBooks(role)).toBe(DB_IS_OWNER_ROLES.includes(role));
    }
  });

  it("the books gate is a STRICT subset of is_admin()", () => {
    expect(DB_IS_OWNER_ROLES.length).toBeLessThan(DB_IS_ADMIN_ROLES.length);
    for (const r of DB_IS_OWNER_ROLES) expect(DB_IS_ADMIN_ROLES).toContain(r);
    expect(DB_IS_ADMIN_ROLES).toContain("admin");
    expect(DB_IS_OWNER_ROLES).not.toContain("admin");
  });

  it("books.view and financials.view are owner-only in the permission matrix", () => {
    expect(rolesForPermission("books.view")).toEqual(["owner"]);
    expect(rolesForPermission("financials.view")).toEqual(["owner"]);
    for (const role of ALL_ROLES) {
      if (role === "owner") continue;
      expect(can(role, "books.view")).toBe(false);
      expect(can(role, "financials.view")).toBe(false);
    }
  });

  it("the nav permission and the page gate agree for every role", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "books.view")).toBe(canReadBooks(role));
    }
  });

  it("admin KEEPS the two things the owner said it may do", () => {
    // "The only thing an admin can do is pay vendors and pay employees."
    // payables.manage is how an admin pays vendors; taking it away would break
    // the one workflow the owner explicitly preserved.
    expect(can("admin", "payables.manage")).toBe(true);
    expect(can("admin", "staffing.manage")).toBe(true);
    // ...and still cannot see the money.
    expect(can("admin", "books.view")).toBe(false);
    expect(can("admin", "financials.view")).toBe(false);
  });
});

describe("source-level drift guards", () => {
  it("the accounting reports page is gated on financials.view, not reports.view", () => {
    const page = readFileSync(
      resolve(__dirname, "../../src/app/admin/reports/accounting/page.tsx"),
      "utf8",
    );
    expect(page).toContain('requirePermission("financials.view")');
    expect(page).not.toContain('requirePermission("reports.view")');
  });

  it("every accounting action + export route is owner-gated", () => {
    const files = [
      "../../src/app/admin/reports/accounting/actions.ts",
      "../../src/app/admin/reports/accounting/sage-actions.ts",
      "../../src/app/admin/reports/accounting/sage-mapping-actions.ts",
      "../../src/app/admin/reports/accounting/export/route.ts",
      "../../src/app/admin/reports/accounting/sage-export/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src).not.toContain('requirePermission("reports.view")');
      expect(src).not.toContain('requirePermission("settings.manage")');
      expect(src).toContain('requirePermission("financials.view")');
    }
  });

  it("canReadBooks is literally owner-only in source, not merely by accident", () => {
    const src = readSrc("books-view-core.ts");
    // The function body must not mention admin.
    const fn = src.slice(src.indexOf("export function canReadBooks"));
    const body = fn.slice(0, fn.indexOf("}"));
    expect(body).toContain('role === "owner"');
    expect(body).not.toContain('"admin"');
  });

  it("migration 0185 exists, defines is_owner(), and re-gates the gl_* surface", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/migrations/0185_books_owner_only.sql"),
      "utf8",
    );
    expect(sql).toContain("create or replace function public.is_owner()");
    expect(sql).toContain("role = 'owner'");
    // It must actually rewrite policies and functions, not just declare a helper.
    expect(sql).toContain("is_admin()");
    expect(sql).toContain("is_owner()");
    expect(sql).toContain("gl_audit_owner_only_gate");
    // Standing rule 6: idempotent.
    expect(sql.toLowerCase()).toContain("idempotent");
  });

  it("gl_audit_owner_only_gate() EXCLUDES ITSELF, or it reports a false alarm forever", () => {
    // FOUND BY RUNNING IT (slice books-04), not by reading it.
    //
    // The audit searches every function body for the literal strings
    // 'is_admin()' and 'GL_FORBIDDEN'. Its OWN body necessarily contains both
    // -- they are the patterns it hunts for -- so without a self-exclusion it
    // matches itself and returns one row on a perfectly healthy database.
    //
    // The documentation the owner follows says "AN EMPTY RESULT MEANS THE
    // BOOKS ARE OWNER-ONLY." So a self-match teaches him that the very first
    // migration he applies did not work. Verified against live PostgreSQL 15:
    // one row before the fix, zero rows after, and a deliberately planted
    // is_admin()/GL_FORBIDDEN function is still caught.
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/migrations/0185_books_owner_only.sql"),
      "utf8",
    );
    expect(sql).toContain("not like 'gl\\_audit\\_%'");
  });

  it("the journal write path goes through gl_submit_journal, never a raw insert", () => {
    const src = readSrc("journal-entry-service.ts");
    expect(src).toContain("submitJournal");
    // The one thing that must never appear: a direct write to the ledger tables.
    expect(src).not.toMatch(/from\(["']gl_journals["']\)[\s\S]{0,80}\.insert/);
    expect(src).not.toMatch(/from\(["']gl_journal_lines["']\)[\s\S]{0,80}\.insert/);
    // And it must be owner-gated.
    expect(src).toContain("canReadBooks");
  });

  it("the advisor core is PURE — no database, network, clock or randomness", () => {
    const src = readSrc("journal-advisor-core.ts");
    for (const forbidden of [
      "supabase",
      "createClient",
      "fetch(",
      "Date.now",
      "new Date",
      "Math.random",
      "process.env",
      "server-only",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("the advisor core contains no BigInt literals (tsconfig target forbids them)", () => {
    const src = readSrc("journal-advisor-core.ts");
    expect(src).not.toMatch(/\b\d+n\b/);
  });
});

// ===========================================================================
// toCents -- the boundary where a typed dollar amount becomes integer cents.
//
// This is the single most dangerous line of arithmetic on the screen. Money is
// held in MINOR UNITS everywhere in this codebase, and a rounding bug here does
// not throw, does not log, and does not show up until a trial balance is a
// penny out with 4,000 entries to search.
// ===========================================================================
describe("toCents: typed dollars to integer cents", () => {
  it("converts ordinary amounts", () => {
    expect(toCents("0")).toBe(0);
    expect(toCents("1")).toBe(100);
    expect(toCents("45.23")).toBe(4523);
    expect(toCents("0.01")).toBe(1);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("100")).toBe(10000);
    expect(toCents("1234.56")).toBe(123456);
  });

  it("does NOT lose a penny to floating point", () => {
    // Math.round(1.005 * 100) === 100 in IEEE 754, stealing a cent. String
    // arithmetic gets 100 -> 100.5 -> the correct 100 or 101 depending on the
    // rule; what matters is that .005 is not silently absorbed into .00.
    expect(toCents("1.01")).toBe(101);
    expect(toCents("2.02")).toBe(202);
    expect(toCents("8.29")).toBe(829);
    expect(toCents("1.10")).toBe(110);
    expect(toCents("0.29")).toBe(29);
    // A sweep: every cent value from 0..999 must round-trip exactly.
    for (let c = 0; c < 1000; c += 1) {
      const dollars = Math.floor(c / 100);
      const cents = c % 100;
      const typed = `${dollars}.${String(cents).padStart(2, "0")}`;
      expect(toCents(typed), `typed=${typed}`).toBe(c);
    }
  });

  it("accepts the shapes a human actually types", () => {
    expect(toCents("$45.23")).toBe(4523);
    expect(toCents(" 45.23 ")).toBe(4523);
    expect(toCents("1,234.56")).toBe(123456);
    expect(toCents("45.")).toBe(4500);
    expect(toCents(".50")).toBe(50);
  });

  it("refuses anything that is not a clean amount, rather than guessing", () => {
    // NEGATIVE CONTROLS. Each of these must be null, not 0 -- returning 0 for
    // garbage would silently post a zero line instead of asking.
    expect(toCents("")).toBeNull();
    expect(toCents("   ")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents("-5")).toBeNull();
    expect(toCents("4.567")).toBeNull();
    expect(toCents("1.2.3")).toBeNull();
    expect(toCents("1e5")).toBeNull();
    expect(toCents("NaN")).toBeNull();
    expect(toCents("Infinity")).toBeNull();
    expect(toCents(".")).toBeNull();
  });

  it("never returns a non-integer or an unsafe integer", () => {
    const samples = ["0", "0.01", "9.99", "12345.67", "999999.99", "$1,000.00"];
    for (const s of samples) {
      const v = toCents(s);
      expect(v).not.toBeNull();
      expect(Number.isInteger(v as number), `typed=${s}`).toBe(true);
      expect(Number.isSafeInteger(v as number), `typed=${s}`).toBe(true);
    }
  });
});

// ===========================================================================
// The General Journal SCREEN -- source-level guards.
//
// These read the page and the form as text. They cannot prove the UI renders,
// but they CAN prove the two mistakes that would matter most: a books screen
// that forgot its owner gate, and a form that writes to the ledger directly
// instead of going through gl_submit_journal.
// ===========================================================================
describe("the General Journal screen: structural guards", () => {
  const APP_DIR = resolve(__dirname, "../../src/app/admin/books/journal");
  const readApp = (name: string) => readFileSync(resolve(APP_DIR, name), "utf8");

  it("the page is owner-gated through requireBooksAccess", () => {
    const src = readApp("page.tsx");
    expect(src).toContain("requireBooksAccess");
    // and NOT on a permission that admits manager or readonly
    expect(src).not.toContain('requirePermission("reports.view")');
    expect(src).not.toContain('requirePermission("settings.manage")');
  });

  it("the page uses PACIFIC time for 'today', not the server's timezone", () => {
    const src = readApp("page.tsx");
    expect(src).toContain("America/Los_Angeles");
  });

  it("the server actions never touch gl_journals directly", () => {
    const src = readApp("actions.ts");
    // The one door into the ledger is gl_submit_journal, via the service.
    expect(src).not.toMatch(/from\(["']gl_journals["']\)/);
    expect(src).not.toMatch(/from\(["']gl_journal_lines["']\)/);
    expect(src).not.toContain("createSupabaseAdminClient");
    expect(src).toContain("submitManualJournal");
    expect(src).toContain("previewManualJournal");
  });

  it("the form cannot post while a hard block stands", () => {
    const src = readApp("JournalEntryForm.tsx");
    // The submit button's enablement must depend on there being no blocks AND
    // every confirm acknowledged. If either clause is dropped, this fails.
    expect(src).toContain("blocks.length === 0");
    expect(src).toContain("allConfirmed");
  });

  it("editing a line clears any prior acknowledgement", () => {
    // Otherwise: acknowledge a harmless draft, then edit it into a harmful one
    // and post with a stale tick. The reset is the whole safety property.
    const src = readApp("JournalEntryForm.tsx");
    expect(src).toContain("setAcknowledged({})");
  });

  it("the form renders the authority and the suggestion, not just the concern", () => {
    // Michael asked for push-back that HELPS rather than rejects. A finding
    // rendered without its suggestion is a rejection wearing a nicer colour.
    const src = readApp("JournalEntryForm.tsx");
    expect(src).toContain("f.suggestion");
    expect(src).toContain("f.authority");
    expect(src).toContain("f.concern");
  });
});
