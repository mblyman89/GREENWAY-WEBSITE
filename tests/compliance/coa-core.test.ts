/**
 * tests/compliance/coa-core.test.ts
 *
 * Vitest mirror for the chart-of-accounts pure core: the five-digit numbering
 * rule, the block/type firewall that makes it impossible to credit cannabis
 * excise to a revenue account, the inventory -> revenue -> COGS mirror across
 * all 21 house categories, the 280E cost-class rules, and the classifier
 * confidence gate that never, at any confidence, posts by itself.
 *
 * These rules live in two places on purpose: here, for fast feedback in the UI,
 * and in supabase/migrations/0173_chart_of_accounts.sql, which is the real
 * authority. The SQL side has its own adversarial suite
 * (scripts/accounting/coa-schema-tests.sql), which replays the actual
 * $4,624,697.31 plug from the old Sage file and asserts the database refuses it.
 *
 * Several of the assertions below exist ONLY because executing the migration
 * against real PostgreSQL caught something that reading the code had not.
 */
import { describe, it, expect } from "vitest";
import {
  COA_BLOCKS,
  ENTITY_CODES,
  INVENTORY_CATEGORIES,
  isValidAccountCode,
  blockOf,
  blockAllowsType,
  expectedNormalBalance,
  inventoryAccountCode,
  revenueAccountCode,
  cogsAccountCode,
  categoryCodesAreMirrored,
  validateAccount,
  scoreConfidence,
  confidenceBand,
  mayAutoPost,
  suggestionAllowedForAccount,
  normalizeMerchant,
  __runCoaCoreTests,
} from "../../src/lib/accounting/coa-core";

describe("coa-core self-tests", () => {
  it("passes its own embedded suite", () => {
    expect(() => __runCoaCoreTests()).not.toThrow();
  });
});

describe("account numbering", () => {
  it("accepts a five-digit code and rejects Sage entity suffixes", () => {
    expect(isValidAccountCode("20140")).toBe(true);
    // The old chart encoded entity in the code, which is how one business ended
    // up with four different "Accounts Payable" accounts nobody could compare.
    expect(isValidAccountCode("20140-GRNWY")).toBe(false);
    expect(isValidAccountCode("20140-GRWNY")).toBe(false);
  });

  it("rejects lengths, leading zeros and letters that look like digits", () => {
    expect(isValidAccountCode("2014")).toBe(false);
    expect(isValidAccountCode("201400")).toBe(false);
    expect(isValidAccountCode("01234")).toBe(false);
    expect(isValidAccountCode("2O140")).toBe(false); // letter O
    expect(isValidAccountCode("")).toBe(false);
  });

  it("reads the block from the first digit", () => {
    expect(blockOf("20140")).toBe(2);
    expect(blockOf("60140")).toBe(6);
    expect(blockOf("nope")).toBeNull();
  });

  it("has a name for every block", () => {
    for (let b = 1; b <= 9; b += 1) {
      expect(COA_BLOCKS[b as keyof typeof COA_BLOCKS].name.length).toBeGreaterThan(0);
    }
  });
});

describe("the block/type firewall", () => {
  it("keeps excise out of the revenue block", () => {
    // RCW 69.50.535(4): the 37% is "deemed to be held in trust by the seller".
    // Trust money is a liability. The old chart had "50009 EXCISE TAX
    // ADJUSTMENTS" sitting in revenue, and twelve years of mis-computed excise
    // were cleared through it.
    expect(blockAllowsType("50009", "liability")).toBe(false);
    expect(blockAllowsType("32000", "liability")).toBe(true);
  });

  it("keeps revenue out of the liability block", () => {
    expect(blockAllowsType("32900", "income")).toBe(false);
    expect(blockAllowsType("50010", "income")).toBe(true);
  });

  it("keeps COGS in its own block, apart from operating expenses", () => {
    expect(blockAllowsType("60140", "cogs")).toBe(true);
    expect(blockAllowsType("70000", "cogs")).toBe(false);
  });
});

describe("normal balance is derived, never typed", () => {
  it("follows the account type", () => {
    expect(expectedNormalBalance("asset")).toBe("debit");
    expect(expectedNormalBalance("liability")).toBe("credit");
    expect(expectedNormalBalance("income")).toBe("credit");
    expect(expectedNormalBalance("cogs")).toBe("debit");
  });

  it("flips for contra accounts", () => {
    expect(expectedNormalBalance("income", true)).toBe("debit");
    expect(expectedNormalBalance("asset", true)).toBe("credit");
  });
});

describe("the inventory / revenue / COGS mirror", () => {
  it("builds codes on the same last four digits", () => {
    // This is what makes margin by category a subtraction rather than a project.
    expect(inventoryAccountCode(140)).toBe("20140");
    expect(revenueAccountCode(140)).toBe("50140");
    expect(cogsAccountCode(140)).toBe("60140");
    expect(categoryCodesAreMirrored("20140", "50140", "60140")).toBe(true);
    expect(categoryCodesAreMirrored("20140", "50150", "60140")).toBe(false);
  });

  it("handles the boundaries of the slot range", () => {
    // A regression guard: an earlier build produced "21400" for slot 140,
    // because it padded to three digits and appended a trailing zero. Reading
    // the code did not catch it. Running it did.
    expect(inventoryAccountCode(0)).toBe("20000");
    expect(inventoryAccountCode(9999)).toBe("29999");
    expect(() => inventoryAccountCode(-1)).toThrow();
    expect(() => inventoryAccountCode(10000)).toThrow();
    expect(() => inventoryAccountCode(1.5)).toThrow();
    expect(() => inventoryAccountCode(NaN)).toThrow();
  });

  it("covers all 21 house categories with unique slots", () => {
    expect(INVENTORY_CATEGORIES.length).toBe(21);
    const slots = new Set(INVENTORY_CATEGORIES.map((c) => c.slot));
    expect(slots.size).toBe(21);
    const slugs = new Set(INVENTORY_CATEGORIES.map((c) => c.slug));
    expect(slugs.size).toBe(21);
  });

  it("separates cannabis from non-cannabis product", () => {
    // Accessories, paraphernalia and merch are not cannabis and must not be
    // swept into cannabis COGS.
    const nonCannabis = INVENTORY_CATEGORIES.filter((c) => !c.isCannabis);
    expect(nonCannabis.length).toBe(3);
    expect(INVENTORY_CATEGORIES.filter((c) => c.isCannabis).length).toBe(18);
  });
});

describe("280E discipline", () => {
  it("refuses a revenue account that carries a 280E cost class", () => {
    // Sec. 280E denies "any deduction or credit". Revenue is not a deduction.
    // The first cut of migration 0173 set requires_cost_class on all 27 revenue
    // accounts; it was caught only by posting a real sale against PostgreSQL.
    const issues = validateAccount({
      code: "50010",
      name: "Sales — Flower",
      type: "income",
      normalBalance: "credit",
      requiresCostClass: true,
    });
    expect(issues.some((i) => i.field === "requiresCostClass")).toBe(true);
  });

  it("refuses a COGS account declared non-deductible", () => {
    // A cost is either includible in inventory under Sec. 471 as it stood in
    // 1982 (CCA 201504011), or it is a deduction disallowed by 280E. Never both.
    const issues = validateAccount({
      code: "60010",
      name: "COGS — Flower",
      type: "cogs",
      normalBalance: "debit",
      defaultCostClass: "nondeductible_280e",
    });
    expect(issues.some((i) => i.field === "defaultCostClass")).toBe(true);
  });

  it("accepts a properly tagged COGS account", () => {
    expect(
      validateAccount({
        code: "60010",
        name: "COGS — Flower",
        type: "cogs",
        normalBalance: "debit",
        defaultCostClass: "cogs_direct",
      }),
    ).toHaveLength(0);
  });

  it("refuses a 280E cost class on a balance-sheet account", () => {
    const issues = validateAccount({
      code: "10200",
      name: "Bank — Operating",
      type: "asset",
      normalBalance: "debit",
      defaultCostClass: "cogs_direct",
    });
    expect(issues.some((i) => i.field === "defaultCostClass")).toBe(true);
  });
});

describe("the GRWNY rule", () => {
  it("refuses an account restricted to a misspelled entity", () => {
    // 18 accounts in the live Sage chart were tagged "GRWNY" instead of
    // "GRNWY" — including the entire payroll-expense block. Nothing errored.
    // They simply stopped appearing in entity-filtered reports, for years.
    const issues = validateAccount({
      code: "71010",
      name: "Wages & Salaries",
      type: "expense",
      normalBalance: "debit",
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable",
      allowedEntityCodes: ["GRWNY" as (typeof ENTITY_CODES)[number]],
    });
    expect(issues.some((i) => i.field === "allowedEntityCodes")).toBe(true);
  });

  it("refuses an empty restriction, which would hide the account entirely", () => {
    const issues = validateAccount({
      code: "71010",
      name: "Wages & Salaries",
      type: "expense",
      normalBalance: "debit",
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable",
      allowedEntityCodes: [],
    });
    expect(issues.some((i) => i.field === "allowedEntityCodes")).toBe(true);
  });

  it("accepts the correct spelling, and null for any entity", () => {
    const base = {
      code: "71010",
      name: "Wages & Salaries",
      type: "expense" as const,
      normalBalance: "debit" as const,
      requiresCostClass: true,
      defaultCostClass: "cogs_allocable" as const,
    };
    expect(validateAccount({ ...base, allowedEntityCodes: ["greenway"] })).toHaveLength(0);
    expect(validateAccount({ ...base, allowedEntityCodes: null })).toHaveLength(0);
  });

  it("knows exactly four sets of books", () => {
    expect(ENTITY_CODES.length).toBe(4);
    expect([...ENTITY_CODES].sort()).toEqual(["atm", "greenway", "landholding", "personal"]);
  });
});

describe("the classifier gate", () => {
  it("never auto-posts, at any confidence", () => {
    // The owner's directive was "gate everything, block everything". This
    // function is typed to return literal false so no future edit can make it
    // return true without changing the type.
    expect(mayAutoPost()).toBe(false);
  });

  it("scores confidence in integer milli-percent and never exceeds 100%", () => {
    const perfect = scoreConfidence([
      "owner_rule_exact",
      "prior_decision",
      "licensed_cannabis_vendor",
      "vendor_match",
      "pfc_unique_map",
      "account_role_entity",
      "recurring_amount",
    ]);
    expect(Number.isInteger(perfect)).toBe(true);
    expect(perfect).toBeLessThanOrEqual(100000);
    expect(scoreConfidence([])).toBe(0);
  });

  it("bands confidence for the review queue", () => {
    expect(confidenceBand(95000)).toBe("confident");
    expect(confidenceBand(50000)).toBe("best_guess");
    expect(confidenceBand(1000)).toBe("unknown");
  });

  it("refuses to suggest a control account even at full confidence", () => {
    expect(suggestionAllowedForAccount({ code: "20000", isControl: true }).ok).toBe(false);
    expect(suggestionAllowedForAccount({ code: "70000", isControl: false }).ok).toBe(true);
  });
});

describe("merchant normalization", () => {
  it("collapses the same vendor written many ways into one key", () => {
    expect(normalizeMerchant("  Clarity  Farms  ")).toBe("CLARITY FARMS");
    expect(normalizeMerchant("CLARITY FARMS #1234")).toBe("CLARITY FARMS 1234");
    expect(normalizeMerchant("clarity farms")).toBe(normalizeMerchant("CLARITY FARMS"));
  });

  it("neutralizes hostile input and survives empty strings", () => {
    expect(normalizeMerchant("Robert'); DROP TABLE--")).toBe("ROBERT DROP TABLE");
    expect(normalizeMerchant("")).toBe("");
  });
});
