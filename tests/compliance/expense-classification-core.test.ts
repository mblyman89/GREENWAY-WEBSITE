/**
 * expense-classification-core -- THE SECOND GATE (books-75)
 *
 * `expense-classification-core.ts` is a zero-import leaf, which means it RESTATES
 * facts that really live in `supabase/migrations/0173_chart_of_accounts.sql`:
 * which account codes exist, which are CONTROL accounts, and which are pinned to
 * a single entity. Restating is a deliberate choice -- it keeps the classifier
 * pure and testable without a database -- but a restated fact is a fact that can
 * DRIFT. Someone renumbers an account in the migration, the classifier keeps
 * happily assigning the old code, and every report still balances while pointing
 * at an account that no longer exists.
 *
 * So this file's most important job is not testing behaviour. It is reading the
 * migration and proving the restatement still matches. That is the difference
 * between a comment claiming two things agree and a test that fails when they
 * stop agreeing.
 *
 * The behavioural half concentrates on the properties a sample cannot show:
 * that exact beats contains at every priority, that refusal is total (there is
 * no fallback account), and that the reseller bar holds for EVERY barred account
 * rather than for one example.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_EXPENSE_REFUSAL_CODES,
  CLASSIFIABLE_ACCOUNTS,
  CONTROL_ACCOUNTS,
  ACCOUNT_ENTITY_RESTRICTIONS,
  AMBIGUOUS_VENDORS,
  SEED_EXPENSE_RULES,
  RESELLER_COGS_BARRED_ACCOUNTS,
  MEASURED_DISTINCT_VENDORS,
  MEASURED_UNAMBIGUOUS_VENDORS,
  MEASURED_AMBIGUOUS_VENDORS,
  normalizeMerchant,
  expenseCostClassFor,
  classifyExpense,
  classifyIn,
  seedRuleTargetAccounts,
  __runExpenseClassificationCoreTests,
  type ExpenseRule,
  type ExpenseCostClass,
  type ExpenseEntity,
} from "../../src/lib/accounting/expense-classification-core";

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATION = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "0173_chart_of_accounts.sql",
);
const SOURCE = join(
  REPO_ROOT,
  "src",
  "lib",
  "accounting",
  "expense-classification-core.ts",
);

const migrationSql = readFileSync(MIGRATION, "utf8");
const sourceText = readFileSync(SOURCE, "utf8");

/**
 * Strip comments and string literals before scanning source for forbidden
 * constructs. Without this, the long prose header -- which legitimately
 * discusses imports, regexes and COGS -- would trip every guard below. Same
 * helper shape as `cutover-core.test.ts`.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  let inBlock = false;
  let inLine = false;
  let quote = "";
  while (i < n) {
    const ch = source.charAt(i);
    const next = i + 1 < n ? source.charAt(i + 1) : "";
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (quote !== "") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = "";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Every account code migration 0173 actually upserts. */
function migrationAccountCodes(): Set<string> {
  const found = new Set<string>();
  const re = /gl_upsert_account\(\s*'(\d{5})'/g;
  let m = re.exec(migrationSql);
  while (m !== null) {
    found.add(m[1]);
    m = re.exec(migrationSql);
  }
  return found;
}

/** Entity restrictions the migration declares, as code -> sorted entity list. */
function migrationEntityRestrictions(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /gl_upsert_account\(\s*'(\d{5})'([^;]*?)\)\s*;/g;
  let m = re.exec(migrationSql);
  while (m !== null) {
    const code = m[1];
    const rest = m[2];
    const arr = /array\[([^\]]*)\]/.exec(rest);
    if (arr !== null) {
      const codes: string[] = [];
      const inner = /'([a-z_]+)'/g;
      let e = inner.exec(arr[1]);
      while (e !== null) {
        codes.push(e[1]);
        e = inner.exec(arr[1]);
      }
      if (codes.length > 0) out.set(code, codes.sort());
    }
    m = re.exec(migrationSql);
  }
  return out;
}

const MIGRATION_CODES = migrationAccountCodes();
const MIGRATION_RESTRICTIONS = migrationEntityRestrictions();

describe("expense-classification-core: the migration is the source of truth", () => {
  it("the migration parsed at all (guards against a silent empty scan)", () => {
    // A regex that matches nothing would make every drift test below pass
    // vacuously. That is the classic way a drift test becomes decoration.
    expect(MIGRATION_CODES.size).toBeGreaterThan(100);
    expect(MIGRATION_RESTRICTIONS.size).toBeGreaterThan(10);
  });

  it("every CLASSIFIABLE_ACCOUNTS code exists in migration 0173", () => {
    const missing = CLASSIFIABLE_ACCOUNTS.filter(
      (c) => !MIGRATION_CODES.has(c),
    );
    expect(missing).toEqual([]);
  });

  it("every CONTROL_ACCOUNTS code exists in migration 0173", () => {
    const missing = CONTROL_ACCOUNTS.filter((c) => !MIGRATION_CODES.has(c));
    expect(missing).toEqual([]);
  });

  it("every RESELLER_COGS_BARRED_ACCOUNTS code exists and is classifiable", () => {
    for (const code of RESELLER_COGS_BARRED_ACCOUNTS) {
      expect(MIGRATION_CODES.has(code)).toBe(true);
      expect(CLASSIFIABLE_ACCOUNTS.indexOf(code)).toBeGreaterThanOrEqual(0);
    }
  });

  it("every restated entity restriction matches the migration exactly", () => {
    for (const code of Object.keys(ACCOUNT_ENTITY_RESTRICTIONS)) {
      expect(MIGRATION_CODES.has(code)).toBe(true);
      const fromSql = MIGRATION_RESTRICTIONS.get(code);
      expect(fromSql, `account ${code} must be entity-restricted in SQL`).toBeDefined();
      const restated = ACCOUNT_ENTITY_RESTRICTIONS[code]
        .slice()
        .sort()
        .join(",");
      expect(fromSql!.join(","), `account ${code}`).toBe(restated);
    }
  });

  it("no CLASSIFIABLE account is secretly entity-restricted in SQL", () => {
    // THE DRIFT THAT WOULD HURT MOST. If someone pins, say, 70010 to one entity
    // in the migration, the classifier would keep assigning it to another and
    // gl_guard_account_entity_codes() would reject the posting at runtime --
    // after the books looked fine. Catch it here instead.
    for (const code of CLASSIFIABLE_ACCOUNTS) {
      const sqlRestriction = MIGRATION_RESTRICTIONS.get(code);
      if (sqlRestriction !== undefined) {
        const restated = ACCOUNT_ENTITY_RESTRICTIONS[code];
        expect(
          restated,
          `account ${code} is entity-restricted in SQL but the classifier treats it as unrestricted`,
        ).toBeDefined();
      }
    }
  });

  it("no seed rule targets an account absent from the migration", () => {
    for (const r of SEED_EXPENSE_RULES) {
      expect(MIGRATION_CODES.has(r.account), `rule ${r.matchValue}`).toBe(true);
    }
  });

  it("the SQL cost_class vocabulary still matches the TS union", () => {
    // ExpenseCostClass restates the CHECK constraint. If SQL grows a seventh
    // class, the classifier must learn about it rather than silently narrow it.
    const check = /cost_class in \(([^)]*)\)/.exec(migrationSql);
    expect(check).not.toBeNull();
    const sqlClasses: string[] = [];
    const re = /'([a-z_0-9]+)'/g;
    let m = re.exec(check![1]);
    while (m !== null) {
      sqlClasses.push(m[1]);
      m = re.exec(check![1]);
    }
    expect(sqlClasses.sort()).toEqual(
      [
        "cogs_allocable",
        "cogs_direct",
        "none",
        "nondeductible_280e",
        "personal",
        "separate_business",
      ].sort(),
    );
  });

  it("gl_account_rules really stores cost_class, which is why ExpenseRule carries it", () => {
    // The whole reason RESELLER_COGS_FORBIDDEN is reachable. If cost_class ever
    // became derived in SQL, this test should be revisited, not deleted.
    expect(migrationSql).toContain("cost_class    text not null default 'none'");
  });
});

describe("expense-classification-core: purity", () => {
  it("imports nothing (it is a leaf)", () => {
    const code = stripComments(sourceText);
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it("uses no /s regex flag (tsconfig targets ES2017)", () => {
    const code = stripComments(sourceText);
    expect(code).not.toMatch(/\/[a-z]*s[a-z]*;/);
    expect(code).not.toContain("dotAll");
  });

  it("is deterministic: no clock, no randomness", () => {
    const code = stripComments(sourceText);
    expect(code).not.toContain("Math.random");
    expect(code).not.toContain("Date.now");
    expect(code).not.toContain("new Date");
  });

  it("has no fallback account anywhere in its text", () => {
    // Rule 48. A "misc expense" default is the single most damaging thing that
    // could be added to this file, because its output is indistinguishable from
    // a correct answer in every report.
    const code = stripComments(sourceText);
    expect(code).not.toContain("76000");
    expect(code.toLowerCase()).not.toContain("fallbackaccount");
  });
});

describe("expense-classification-core: the measured facts", () => {
  it("the vendor census adds up", () => {
    expect(MEASURED_UNAMBIGUOUS_VENDORS + MEASURED_AMBIGUOUS_VENDORS).toBe(
      MEASURED_DISTINCT_VENDORS,
    );
    expect(MEASURED_DISTINCT_VENDORS).toBe(60);
    expect(AMBIGUOUS_VENDORS.length).toBe(MEASURED_AMBIGUOUS_VENDORS);
  });

  it("every ambiguous vendor is genuinely ambiguous and explained", () => {
    for (const v of AMBIGUOUS_VENDORS) {
      // "Ambiguous" must mean more than one account. A single-account entry
      // would be a refusal with no justification.
      expect(v.sageAccounts.length, v.merchant).toBeGreaterThan(1);
      expect(v.why.length, v.merchant).toBeGreaterThan(30);
      expect(normalizeMerchant(v.merchant)).toBe(v.merchant);
    }
  });

  it("no ambiguous vendor also has a seed rule", () => {
    // Belt and braces: if a vendor were both seeded and ambiguous, whichever
    // check ran first would decide, and the answer would be arbitrary.
    const seeded = SEED_EXPENSE_RULES.map((r) => r.matchValue);
    for (const v of AMBIGUOUS_VENDORS) {
      expect(seeded, `${v.merchant} must not be both seeded and ambiguous`).not.toContain(
        v.merchant,
      );
    }
  });

  it("refuses all six ambiguous vendors rather than guessing", () => {
    for (const v of AMBIGUOUS_VENDORS) {
      const got = classifyExpense({ merchant: v.merchant });
      expect(got.ok, v.merchant).toBe(false);
      if (!got.ok) expect(got.code).toBe("MERCHANT_AMBIGUOUS");
    }
  });
});

describe("expense-classification-core: normalization", () => {
  it("collapses the real-world spellings of one vendor onto one key", () => {
    const forms = [
      "Puget Sound Energy",
      "PUGET SOUND ENERGY",
      "puget  sound   energy",
      "Puget Sound Energy.",
      "  PUGET SOUND ENERGY  ",
    ];
    for (const f of forms) {
      expect(normalizeMerchant(f)).toBe("PUGET SOUND ENERGY");
    }
  });

  it("is idempotent", () => {
    const samples = [
      "Office Depot #1234",
      "A/B  C",
      "",
      "   ",
      "123-456",
      "Wave Cable!!!",
    ];
    for (const s of samples) {
      const once = normalizeMerchant(s);
      expect(normalizeMerchant(once)).toBe(once);
    }
  });

  it("treats null, undefined and blank alike", () => {
    expect(normalizeMerchant(null)).toBe("");
    expect(normalizeMerchant(undefined)).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
    expect(normalizeMerchant("...")).toBe("");
  });

  it("never emits leading, trailing or doubled spaces", () => {
    const samples = ["  a  b  ", "!!x!!y!!", "-- z --", "a---b"];
    for (const s of samples) {
      const out = normalizeMerchant(s);
      expect(out).toBe(out.trim());
      expect(out).not.toContain("  ");
    }
  });
});

describe("expense-classification-core: refusal is total", () => {
  it("refuses missing merchant text", () => {
    for (const line of [{ merchant: "" }, { merchant: "   " }, { merchant: "!!!" }]) {
      const got = classifyExpense(line);
      expect(got.ok).toBe(false);
      if (!got.ok) expect(got.code).toBe("MERCHANT_MISSING");
    }
  });

  it("refuses an unknown vendor instead of bucketing it", () => {
    const got = classifyExpense({ merchant: "SOME VENDOR THAT DOES NOT EXIST" });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("MERCHANT_UNKNOWN");
  });

  it("every refusal carries a message long enough to act on", () => {
    const probes: ExpenseLineProbe[] = [
      { rules: SEED_EXPENSE_RULES, line: { merchant: "" } },
      { rules: SEED_EXPENSE_RULES, line: { merchant: "NOPE VENDOR" } },
      { rules: SEED_EXPENSE_RULES, line: { merchant: "STAPLES" } },
    ];
    for (const p of probes) {
      const got = classifyIn(p.rules, p.line);
      expect(got.ok).toBe(false);
      if (!got.ok) {
        expect(got.message.length).toBeGreaterThan(40);
        expect(got.normalized).toBeDefined();
      }
    }
  });

  it("declares exactly eight codes, with no duplicates", () => {
    expect(ALL_EXPENSE_REFUSAL_CODES.length).toBe(8);
    expect(new Set(ALL_EXPENSE_REFUSAL_CODES).size).toBe(8);
  });
});

type ExpenseLineProbe = {
  rules: readonly ExpenseRule[];
  line: { merchant: string | null | undefined };
};

describe("expense-classification-core: precedence", () => {
  it("an exact match beats a contains match that also fits", () => {
    const rules: ExpenseRule[] = [
      { matchValue: "ACME", matchKind: "merchant_contains", account: "76010", entity: "greenway", priority: 50 },
      { matchValue: "ACME SUPPLY", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 10 },
    ];
    const got = classifyIn(rules, { merchant: "Acme Supply" });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.account).toBe("73010");
      expect(got.matchKind).toBe("merchant_exact");
    }
  });

  it("exact-beats-contains holds no matter the array order", () => {
    // Guards the books-73 M15b failure mode: first-hit and last-hit agreeing on
    // a sample while disagreeing in general.
    const a: ExpenseRule = { matchValue: "ACME", matchKind: "merchant_contains", account: "76010", entity: "greenway", priority: 50 };
    const b: ExpenseRule = { matchValue: "ACME SUPPLY", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 10 };
    for (const rules of [[a, b], [b, a]]) {
      const got = classifyIn(rules, { merchant: "ACME SUPPLY" });
      expect(got.ok).toBe(true);
      if (got.ok) expect(got.account).toBe("73010");
    }
  });

  it("every seed rule keeps exact below 50 and contains at or above 50", () => {
    for (const r of SEED_EXPENSE_RULES) {
      if (r.matchKind === "merchant_exact") {
        expect(r.priority, r.matchValue).toBeLessThan(50);
      } else {
        expect(r.priority, r.matchValue).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it("same-priority rules that DISAGREE tie; ones that agree do not", () => {
    const disagree: ExpenseRule[] = [
      { matchValue: "X", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
      { matchValue: "X", matchKind: "merchant_exact", account: "73010", entity: "greenway", priority: 10 },
    ];
    const tie = classifyIn(disagree, { merchant: "X" });
    expect(tie.ok).toBe(false);
    if (!tie.ok) expect(tie.code).toBe("RULE_TIE");

    const agree: ExpenseRule[] = [
      { matchValue: "X", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
      { matchValue: "X", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
    ];
    expect(classifyIn(agree, { merchant: "X" }).ok).toBe(true);
  });

  it("pins WHICH rule wins at equal priority, not just the amount", () => {
    // MUTATION M4. Changing `<` to `<=` in the winner scan survived the whole
    // suite, because two same-priority rules pointing at the SAME account and
    // entity do not trip RULE_TIE -- the accounting answer is identical either
    // way. What changes is `matchedValue` and `matchKind`: the record of WHICH
    // rule fired.
    //
    // That is provenance, and provenance is not cosmetic here. It is what tells
    // Michael why a line landed where it did, and it is what
    // gl_account_rules.times_applied / last_applied_at count in SQL. If it
    // flipped with array order, two runs over the same data would disagree about
    // which rules are earning their keep, and an unused rule could look busy.
    // First match at a given priority wins. Pinned.
    const exact: ExpenseRule = { matchValue: "ACME SUPPLY", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 };
    const contains: ExpenseRule = { matchValue: "ACME", matchKind: "merchant_contains", account: "76010", entity: "greenway", priority: 10 };

    const first = classifyIn([exact, contains], { merchant: "ACME SUPPLY" });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.matchedValue).toBe("ACME SUPPLY");
      expect(first.matchKind).toBe("merchant_exact");
    }

    const second = classifyIn([contains, exact], { merchant: "ACME SUPPLY" });
    expect(second.ok).toBe(true);
    if (second.ok) {
      // First match wins, so reordering DOES change provenance. Documenting the
      // real behaviour rather than asserting a symmetry the code does not have:
      // the guarantee is that a GIVEN rule array always yields a GIVEN answer.
      expect(second.matchedValue).toBe("ACME");
      expect(second.matchKind).toBe("merchant_contains");
    }

    // The accounting answer is order-independent even though provenance is not.
    if (first.ok && second.ok) {
      expect(first.account).toBe(second.account);
      expect(first.entity).toBe(second.entity);
      expect(first.costClass).toBe(second.costClass);
    }
  });

  it("is stable across repeated scans of the same rule array", () => {
    const rules: ExpenseRule[] = [
      { matchValue: "ACME SUPPLY", matchKind: "merchant_exact", account: "76010", entity: "greenway", priority: 10 },
      { matchValue: "ACME", matchKind: "merchant_contains", account: "76010", entity: "greenway", priority: 10 },
    ];
    const runs: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      runs.push(JSON.stringify(classifyIn(rules, { merchant: "ACME SUPPLY" })));
    }
    expect(new Set(runs).size).toBe(1);
  });

  it("a differing ENTITY at equal priority is also a tie", () => {
    // Same account, different entity, is the subtler half of the same bug: the
    // amount lands in the right row of the P&L on the wrong set of books.
    const rules: ExpenseRule[] = [
      { matchValue: "X", matchKind: "merchant_exact", account: "70020", entity: "greenway", priority: 10 },
      { matchValue: "X", matchKind: "merchant_exact", account: "70020", entity: "landholding", priority: 10 },
    ];
    const got = classifyIn(rules, { merchant: "X" });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("RULE_TIE");
  });
});

describe("expense-classification-core: guards on the target account", () => {
  it("refuses every control account", () => {
    for (const acct of CONTROL_ACCOUNTS) {
      const got = classifyIn(
        [{ matchValue: "V", matchKind: "merchant_exact", account: acct, entity: "greenway", priority: 10 }],
        { merchant: "V" },
      );
      expect(got.ok, acct).toBe(false);
      if (!got.ok) expect(got.code).toBe("CONTROL_ACCOUNT_TARGET");
    }
  });

  it("refuses an account that is not in the chart", () => {
    for (const acct of ["99999", "12345", "00000"]) {
      const got = classifyIn(
        [{ matchValue: "V", matchKind: "merchant_exact", account: acct, entity: "greenway", priority: 10 }],
        { merchant: "V" },
      );
      expect(got.ok, acct).toBe(false);
      if (!got.ok) expect(got.code).toBe("ACCOUNT_NOT_IN_CHART");
    }
  });

  it("names the ENTITY problem, not the vaguer chart problem", () => {
    // The ordering fix. 79030 is a real account restricted to ['personal'], so
    // pointing a business entity at it must say so precisely.
    const businessEntities: ExpenseEntity[] = ["greenway", "atm", "landholding"];
    for (const ent of businessEntities) {
      const got = classifyIn(
        [{ matchValue: "V", matchKind: "merchant_exact", account: "79030", entity: ent, priority: 10 }],
        { merchant: "V" },
      );
      expect(got.ok, ent).toBe(false);
      if (!got.ok) expect(got.code, ent).toBe("ENTITY_NOT_PERMITTED");
    }
  });
});

describe("expense-classification-core: the reseller bar", () => {
  it("refuses a COGS class on EVERY barred account, for both COGS classes", () => {
    const classes: ExpenseCostClass[] = ["cogs_direct", "cogs_allocable"];
    for (const acct of RESELLER_COGS_BARRED_ACCOUNTS) {
      for (const cc of classes) {
        const got = classifyIn(
          [{
            matchValue: "V",
            matchKind: "merchant_exact",
            account: acct,
            entity: "greenway",
            priority: 10,
            costClass: cc,
          }],
          { merchant: "V" },
        );
        expect(got.ok, `${acct}/${cc}`).toBe(false);
        if (!got.ok) expect(got.code, `${acct}/${cc}`).toBe("RESELLER_COGS_FORBIDDEN");
      }
    }
  });

  it("cites the authority, because the refusal has to survive a CPA reading it", () => {
    const got = classifyIn(
      [{
        matchValue: "V",
        matchKind: "merchant_exact",
        account: "70010",
        entity: "greenway",
        priority: 10,
        costClass: "cogs_direct",
      }],
      { merchant: "V" },
    );
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.message).toContain("1.471-3(b)");
      expect(got.message).toContain("263A");
      expect(got.message).toContain("Richmond Patients Group");
    }
  });

  it("still lets the same account carry ordinary 280E-disallowed spend", () => {
    for (const acct of RESELLER_COGS_BARRED_ACCOUNTS) {
      const got = classifyIn(
        [{ matchValue: "V", matchKind: "merchant_exact", account: acct, entity: "greenway", priority: 10 }],
        { merchant: "V" },
      );
      expect(got.ok, acct).toBe(true);
      if (got.ok) expect(got.costClass).toBe("nondeductible_280e");
    }
  });

  it("does NOT bar the same accounts for the separate businesses", () => {
    // Rent paid BY the landholding entity is that entity's ordinary expense.
    // 280E does not reach it. Over-blocking would be its own error.
    for (const ent of ["atm", "landholding"] as ExpenseEntity[]) {
      const got = classifyIn(
        [{ matchValue: "V", matchKind: "merchant_exact", account: "70010", entity: ent, priority: 10 }],
        { merchant: "V" },
      );
      expect(got.ok, ent).toBe(true);
      if (got.ok) expect(got.costClass).toBe("separate_business");
    }
  });

  it("bars 14 accounts: six occupancy and eight personnel", () => {
    expect(RESELLER_COGS_BARRED_ACCOUNTS.length).toBe(14);
    const occupancy = RESELLER_COGS_BARRED_ACCOUNTS.filter((c) => c.charAt(1) === "0");
    const personnel = RESELLER_COGS_BARRED_ACCOUNTS.filter((c) => c.charAt(1) === "1");
    expect(occupancy.length).toBe(6);
    expect(personnel.length).toBe(8);
  });
});

describe("expense-classification-core: cost class by entity", () => {
  it("only greenway is exposed to 280E", () => {
    expect(expenseCostClassFor("greenway")).toBe("nondeductible_280e");
    expect(expenseCostClassFor("atm")).toBe("separate_business");
    expect(expenseCostClassFor("landholding")).toBe("separate_business");
    expect(expenseCostClassFor("personal")).toBe("personal");
  });

  it("never derives a COGS class for anyone", () => {
    // The derived path must never produce COGS. COGS for a reseller comes from
    // invoice cost through the inventory subledger, never from an expense rule.
    const all: ExpenseEntity[] = ["greenway", "atm", "landholding", "personal"];
    for (const e of all) {
      const cc = expenseCostClassFor(e);
      expect(cc).not.toBe("cogs_direct");
      expect(cc).not.toBe("cogs_allocable");
    }
  });
});

describe("expense-classification-core: the shipped rule set", () => {
  it("classifies every seeded vendor without refusing", () => {
    for (const r of SEED_EXPENSE_RULES) {
      if (r.matchKind !== "merchant_exact") continue;
      const got = classifyExpense({ merchant: r.matchValue });
      expect(got.ok, r.matchValue).toBe(true);
    }
  });

  it("assigns the landholding utilities Michael actually pays", () => {
    // Measured from the 81001-LYMAN / 81002-LYMAN / 81003-LYMAN Sage suffixes,
    // not chosen. These are the property's costs, so they sit on the property's
    // books -- which is also what makes the rent deduction defensible.
    for (const m of ["PUGET SOUND ENERGY", "CITY OF PORT ORCHARD WATER UTILITY", "WAVE CABLE"]) {
      const got = classifyExpense({ merchant: m });
      expect(got.ok, m).toBe(true);
      if (got.ok) {
        expect(got.entity, m).toBe("landholding");
        expect(got.costClass, m).toBe("separate_business");
      }
    }
  });

  it("has no duplicate (matchKind, matchValue) pair", () => {
    // Mirrors gl_account_rules_unique_idx. A duplicate here would be a rule that
    // silently fights another on priority.
    const seen = new Set<string>();
    for (const r of SEED_EXPENSE_RULES) {
      const key = `${r.matchKind}|${r.matchValue}|${r.entity}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("stores every matchValue already normalized", () => {
    for (const r of SEED_EXPENSE_RULES) {
      expect(normalizeMerchant(r.matchValue), r.matchValue).toBe(r.matchValue);
    }
  });

  it("no seed rule carries an explicit COGS class", () => {
    for (const r of SEED_EXPENSE_RULES) {
      if (r.costClass !== undefined) {
        expect(r.costClass, r.matchValue).not.toBe("cogs_direct");
        expect(r.costClass, r.matchValue).not.toBe("cogs_allocable");
      }
    }
  });

  it("reports the accounts it targets, all of them classifiable", () => {
    const targets = seedRuleTargetAccounts();
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(CLASSIFIABLE_ACCOUNTS.indexOf(t)).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic across repeated calls", () => {
    for (const m of ["PUGET SOUND ENERGY", "STAPLES", "UNKNOWN THING", ""]) {
      const a = JSON.stringify(classifyExpense({ merchant: m }));
      const b = JSON.stringify(classifyExpense({ merchant: m }));
      expect(a).toBe(b);
    }
  });
});

describe("expense-classification-core: the module self-test runs here too", () => {
  it("passes", () => {
    expect(() => __runExpenseClassificationCoreTests()).not.toThrow();
  });
});
