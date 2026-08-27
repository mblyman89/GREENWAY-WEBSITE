/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LEDGER CENSUS — ANTI-DRIFT SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, books-70, verbatim: "the census build and map so nothing ever
 * drifts while we wire everything up."
 *
 * A census is a measurement of the repository at a moment in time. The moment
 * it stops being re-measured it becomes a rumour. This suite exists so that
 * every claim in `ledger-census-data.ts` is re-derived from the REAL source
 * tree, the REAL migration files and the REAL chart of accounts on every run.
 *
 * Three kinds of test live here, and the second is the one that matters:
 *
 *   1. STRUCTURE   — the census is internally coherent (the core's own gates).
 *   2. GROUND TRUTH — every claim is re-measured against source. If somebody
 *                     wires up POS sales and forgets to update the census, the
 *                     row that still says MISSING fails HERE. If somebody
 *                     softens a row to MISSING that is actually wired, that
 *                     fails here too. Drift is caught in both directions.
 *   3. HONESTY     — the validator actually refuses the contradictions it
 *                     claims to refuse (standing rule 43: a refusal code that
 *                     no code path emits is decoration, and it reviews as
 *                     protection).
 *
 * WHY THIS FILE READS SOURCE WITH readFileSync RATHER THAN IMPORTING:
 * most of the modules under audit are `server-only` or pull in the Supabase
 * client, so importing them from a pure vitest run is not possible. Reading the
 * text is also strictly stronger for the question being asked, which is not
 * "does this function work?" but "does any code path actually reach it?"
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CENSUS_LAYERS,
  EVENT_FAMILIES,
  LAYER_STATUSES,
  LAYER_TITLES,
  LAYER_RATIONALE,
  FAMILY_TITLES,
  LedgerCensus,
  validateCensusRow,
  validateLayerVerdict,
  findDuplicateKeys,
  summariseCensus,
  censusMessage,
  type CensusRow,
  type LayerVerdict,
} from "@/lib/accounting/ledger-census-core";
import {
  LEDGER_CENSUS_ROWS,
  buildLedgerCensus,
} from "@/lib/accounting/ledger-census-data";
import { SOURCE_KINDS } from "@/lib/accounting/posting-core";

const REPO = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

function exists(rel: string): boolean {
  try {
    statSync(join(REPO, rel));
    return true;
  } catch {
    return false;
  }
}

/** Every .ts/.tsx file under a directory, recursively. */
function walk(rel: string): string[] {
  const out: string[] = [];
  const abs = join(REPO, rel);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const e of entries) {
    const child = `${rel}/${e}`;
    const st = statSync(join(REPO, child));
    if (st.isDirectory()) out.push(...walk(child));
    else if (e.endsWith(".ts") || e.endsWith(".tsx")) out.push(child);
  }
  return out;
}

/** Concatenated text of a whole subtree — for "does ANYTHING here post?". */
function subtreeText(rel: string): string {
  return walk(rel)
    .map((f) => read(f))
    .join("\n");
}

/**
 * All of `src/` EXCEPT the named basenames and the census's own two files.
 *
 * WHY THE CENSUS EXCLUDES ITSELF: `ledger-census-data.ts` documents its
 * findings by quoting the very symbols it reports as uncalled — for example the
 * string "buildPayrollJournal has no caller". A naive grep over all of `src/`
 * therefore finds the symbol and concludes it IS called, which made the first
 * run of this suite fail on five tests for the wrong reason. Excluding the
 * census's own text is not weakening the check; the census contains no
 * executable call to anything it describes.
 */
function srcExcept(basenames: readonly string[]): string {
  const skip = [
    ...basenames,
    "ledger-census-data.ts",
    "ledger-census-core.ts",
  ];
  return walk("src")
    .filter((f) => !skip.some((b) => f.endsWith(`/${b}`)))
    .map((f) => read(f))
    .join("\n");
}

/* ═════════════════════════ 1. THE REAL CHART OF ACCOUNTS ═════════════════ */

/**
 * Scraped from EVERY migration, NOT from a TypeScript copy of the chart. The
 * database is the authority on which accounts exist.
 *
 * WHY ALL OF THEM: the first draft of this suite read only
 * 0173_chart_of_accounts.sql and concluded that the entire fixed-asset block
 * (21000-21900) was missing. It is not — 0178_fixed_assets.sql seeds it with
 * `gl_upsert_account`, and 0189 adds one more. Reading a single migration
 * produced a confident, well-evidenced, WRONG finding. The chart is the sum of
 * every migration that ever touched it, so that is what gets read.
 */
const COA_CODES: readonly string[] = (() => {
  const dir = join(REPO, "supabase", "migrations");
  const codes = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    // Two seeding shapes are in use: a VALUES tuple and gl_upsert_account().
    for (const m of sql.matchAll(/\('(\d{5})',/g)) codes.add(m[1]);
    for (const m of sql.matchAll(/gl_upsert_account\(\s*'(\d{5})'/g)) codes.add(m[1]);
  }
  return [...codes];
})();

describe("the chart of accounts the census is measured against", () => {
  it("is scraped from migration 0173 and is not empty", () => {
    expect(COA_CODES.length).toBeGreaterThan(150);
  });

  it("contains the accounts this business cannot operate without", () => {
    for (const code of [
      "10110", // tills
      "20000", // inventory control
      "30000", // accounts payable
      "32000", // excise trust
      "32100", // sales tax trust
      "32200", // B&O
      "50000", // sales
      "60000", // COGS
      "61000", // allocable inventory labour (280E)
    ]) {
      expect(COA_CODES, `account ${code} must exist`).toContain(code);
    }
  });

  it(
    "DOES contain the fixed-asset block, seeded by 0178 rather than 0173 — the " +
      "correction recorded in D-43",
    () => {
      for (const code of [
        "21000",
        "21100",
        "21200",
        "21300",
        "21400",
        "21500",
        "21600",
        "21700",
        "21800",
        "21900",
      ]) {
        expect(COA_CODES, `${code} must be seeded by 0178`).toContain(code);
      }
    },
  );

  it("is the sum of several migrations, which is why all of them are read", () => {
    const only0173 = new Set(
      [
        ...read("supabase/migrations/0173_chart_of_accounts.sql").matchAll(
          /\('(\d{5})',/g,
        ),
      ].map((m) => m[1]),
    );
    expect(COA_CODES.length).toBeGreaterThan(only0173.size);
    expect(only0173.has("21900")).toBe(false);
    expect(COA_CODES).toContain("21900");
  });
});

/* ═════════════════════════ 2. STRUCTURE ══════════════════════════════════ */

/**
 * LAZY on purpose.
 *
 * `const census = buildLedgerCensus(...)` inside a describe body runs at
 * COLLECTION time. If a change makes construction throw, vitest reports "no
 * tests found" rather than a named failure — which during mutation testing is
 * indistinguishable from a surviving mutant, and to a reviewer looks like a
 * configuration problem rather than a caught defect. Building inside each test
 * means an invalid census fails a test with a name.
 */
function census() {
  return buildLedgerCensus(COA_CODES);
}

describe("the census is structurally sound", () => {

  it("builds against the real chart of accounts without throwing", () => {
    expect(() => buildLedgerCensus(COA_CODES)).not.toThrow();
  });

  it("covers every event family, so no family was silently skipped", () => {
    const c = census();
    for (const f of EVENT_FAMILIES) {
      expect(c.byFamily(f).length, `family ${f} has no rows`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate keys", () => {
    expect(findDuplicateKeys(LEDGER_CENSUS_ROWS)).toEqual([]);
  });

  it("gives every row a verdict on all six layers", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      for (const l of CENSUS_LAYERS) {
        expect(r.layers[l], `${r.key} missing layer ${l}`).toBeDefined();
        expect(LAYER_STATUSES).toContain(r.layers[l].status);
      }
    }
  });

  it("uses only real ledger source kinds", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      expect(SOURCE_KINDS, `${r.key} has a fake source kind`).toContain(r.sourceKind);
    }
  });

  it("names only accounts that exist in the real chart", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      for (const code of r.accountCodes) {
        expect(COA_CODES, `${r.key} cites missing account ${code}`).toContain(code);
      }
    }
  });

  it("gives every row at least two accounts, because entries have two sides", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      expect(r.accountCodes.length, `${r.key}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("backs every single verdict with evidence", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      for (const l of CENSUS_LAYERS) {
        expect(r.layers[l].evidence.trim().length, `${r.key}.${l}`).toBeGreaterThan(0);
      }
    }
  });

  it("records a defect id for every row that has a gap", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      const gap = CENSUS_LAYERS.some(
        (l) => r.layers[l].status === "MISSING" || r.layers[l].status === "PARTIAL",
      );
      if (gap) {
        expect(r.defectId, `${r.key} has a gap but no defect id`).not.toBeNull();
      }
    }
  });

  it("states a consequence for every row, so wiring can be prioritised", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      expect(r.consequence.trim().length, `${r.key}`).toBeGreaterThan(20);
    }
  });

  it("keys every row to its own family", () => {
    for (const r of LEDGER_CENSUS_ROWS) {
      expect(r.key.startsWith(`${r.family}.`), `${r.key}`).toBe(true);
    }
  });

  it("titles every layer and every family", () => {
    for (const l of CENSUS_LAYERS) {
      expect(LAYER_TITLES[l].length).toBeGreaterThan(0);
      expect(LAYER_RATIONALE[l].length).toBeGreaterThan(0);
    }
    for (const f of EVENT_FAMILIES) expect(FAMILY_TITLES[f].length).toBeGreaterThan(0);
  });
});

/* ═════════════════════════ 3. GROUND TRUTH ═══════════════════════════════ */

/**
 * The anti-drift core. Each test below re-measures the repository. When a
 * wiring slice lands, the corresponding test FAILS and forces the census to be
 * updated in the same commit. That is the whole design.
 */
describe("every file#symbol the census names actually exists", () => {
  const claims: Array<{ key: string; role: string; ref: string }> = [];
  for (const r of LEDGER_CENSUS_ROWS) {
    if (r.builder !== null) claims.push({ key: r.key, role: "builder", ref: r.builder });
    if (r.poster !== null) claims.push({ key: r.key, role: "poster", ref: r.poster });
  }

  it("names at least one builder and one poster somewhere", () => {
    expect(claims.some((c) => c.role === "builder")).toBe(true);
    expect(claims.some((c) => c.role === "poster")).toBe(true);
  });

  for (const c of claims) {
    it(`${c.key} ${c.role} ${c.ref} resolves to a real symbol`, () => {
      const [file, symbol] = c.ref.split("#");
      expect(exists(file), `${file} does not exist`).toBe(true);
      const txt = read(file);
      const found =
        new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${symbol}\\b`).test(txt) ||
        new RegExp(`\\bexport\\s+const\\s+${symbol}\\b`).test(txt) ||
        new RegExp(`\\bfunction\\s+${symbol}\\b`).test(txt);
      expect(found, `${symbol} not defined in ${file}`).toBe(true);
    });
  }
});

describe("the two working paths really are wired (positive control)", () => {
  it("the inventory audit really does call submitJournal", () => {
    const txt = read("src/lib/inventory/inventory-audit-store.ts");
    expect(txt).toContain("submitJournal(");
    expect(txt).toContain('sourceKind: "inventory"');
  });

  it("the inventory audit really does key its journal per session", () => {
    const txt = read("src/lib/inventory/inventory-audit-store.ts");
    expect(txt).toContain("audit:${sessionId}");
  });

  it("the manual journal screen really does reach the ledger", () => {
    const txt = read("src/app/admin/books/journal/actions.ts");
    expect(txt).toContain("submitManualJournal");
  });

  it("exactly these two rows are marked fully proven", () => {
    const keys = census()
      .fullyProven()
      .map((r) => r.key)
      .sort();
    expect(keys).toEqual([
      "cost_of_goods_sold.inventory_audit_adjustment",
      "periodic_and_other.manual_journal",
    ]);
  });
});

describe("the unreachable subsystems really are unreachable (negative control)", () => {
  /**
   * These greps are the evidence strings in the census, executed. If a wiring
   * slice connects one of these subtrees, the test fails and the census must be
   * corrected before the build goes green again.
   */
  const LEDGER_CALL = /\bsubmitJournal\s*\(|\bgl_post_|\bgl_submit_/;

  const subtrees: Array<[string, string]> = [
    ["src/lib/pos", "point of sale"],
    ["src/lib/payroll", "payroll"],
    ["src/lib/purchasing", "purchasing"],
    ["src/lib/plaid", "the bank feed"],
    ["src/lib/crypto", "crypto"],
    ["src/lib/registers", "cash registers"],
    ["src/lib/payments", "vendor payments"],
  ];

  for (const [dir, label] of subtrees) {
    it(`nothing under ${dir} (${label}) writes to the ledger`, () => {
      const files = walk(dir);
      expect(files.length, `${dir} has no files — check the path`).toBeGreaterThan(0);
      const offenders = files.filter((f) => {
        // Strip line comments and block comments so a MENTION in prose (see
        // F-16: cycle-counts.ts names submitJournal in a comment) is not
        // mistaken for a call.
        const stripped = read(f)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        return LEDGER_CALL.test(stripped);
      });
      expect(
        offenders,
        `these files now reach the ledger — the census must be updated`,
      ).toEqual([]);
    });
  }

  it("buildPayrollJournal has no caller in the application", () => {
    const others = srcExcept(["payroll-cogs-core.ts"]);
    expect(others.includes("buildPayrollJournal")).toBe(false);
  });

  it("the B&O journal builders have no caller anywhere in src", () => {
    const others = srcExcept(["bo-tax-core.ts"]);
    expect(others.includes("boAccrualEntry")).toBe(false);
    expect(others.includes("boPaymentEntry")).toBe(false);
  });

  it("fixed-assets-core has no real importer, only prose that mentions it", () => {
    // MEASURED, and this is why the assertion is import-shaped rather than a
    // bare substring search: five files under src/lib/accounting MENTION these
    // modules. Every mention is a comment explaining where a constant lives, or
    // period-close-mentor-gates.ts reading period-close-core.ts as TEXT to gate
    // its own teaching content. None is an import, and none posts. A substring
    // grep reported "has importers" and was wrong in the direction that would
    // have quietly marked the census WIRED.
    const importers = walk("src")
      .filter((f) => !f.endsWith("/fixed-assets-core.ts"))
      .filter((f) => !f.endsWith("/ledger-census-data.ts"))
      .filter((f) => /^\s*import[^;]*fixed-assets-core/m.test(read(f)));
    expect(importers).toEqual([]);
  });

  it("period-close-core is imported for a constant, and nothing posts a close", () => {
    const importers = walk("src")
      .filter((f) => !f.endsWith("/period-close-core.ts"))
      .filter((f) => !f.endsWith("/ledger-census-data.ts"))
      .filter((f) => /^\s*import[^;]*period-close-core/m.test(read(f)));
    // Whatever imports it must NOT be posting a close journal.
    for (const f of importers) {
      expect(read(f).includes('sourceKind: "close"'), `${f} posts a close`).toBe(false);
    }
  });

  it("no module builds a POS sale, excise, loan, close or reversal journal", () => {
    const all = srcExcept([]);
    for (const kind of ["pos_sale", "excise", "loan", "close", "reversal"]) {
      expect(
        all.includes(`sourceKind: "${kind}"`),
        `something now produces ${kind} — update the census`,
      ).toBe(false);
    }
  });

  it("the vendor bill screen still has no server action", () => {
    expect(exists("src/app/admin/books/bills/actions.ts")).toBe(false);
  });

  it(
    "the only ledger WRITE doors any code actually calls are gl_submit_journal, " +
      "gl_submit_intercompany_pair and gl_approve_journal",
    () => {
      const all = srcExcept([]);
      const called = new Set(
        [...all.matchAll(/\.rpc\(\s*"(gl_[a-z0-9_]+)"/g)].map((m) => m[1]),
      );
      // The write doors that exist in SQL but nothing invokes. Each one is a
      // finished database feature with no wire attached.
      for (const door of [
        "gl_post_journal",
        "gl_post_payroll_run",
        "gl_post_vendor_bill",
        "gl_post_bank_match",
        "gl_unmatch_bank_row",
        "gl_bless_opening_balances",
        "gl_close_opening_balance_equity",
        "gl_reverse_journal",
      ]) {
        expect(called.has(door), `${door} now has a caller — update the census`).toBe(
          false,
        );
      }
      // And the ones that genuinely are wired, as a positive control.
      expect(called.has("gl_submit_journal")).toBe(true);
      expect(called.has("gl_submit_intercompany_pair")).toBe(true);
    },
  );
});

describe("the marriage logic exists but does not post (F-13)", () => {
  it("the vendor reconciler matches payments to bank withdrawals", () => {
    const txt = read("src/lib/payments/vendor-reconcile-core.ts");
    expect(txt).toContain("export function reconcileVendorPayments");
    expect(txt).toContain("toleranceCentsFor");
  });

  it("the payroll reconciler matches runs to bank withdrawals", () => {
    const txt = read("src/lib/payroll/payroll-reconcile-core.ts");
    expect(txt).toContain("export function reconcilePayroll");
  });

  it("neither reconciler posts anything", () => {
    for (const f of [
      "src/lib/payments/vendor-reconcile-core.ts",
      "src/lib/payroll/payroll-reconcile-core.ts",
    ]) {
      const txt = read(f);
      expect(txt.includes("submitJournal(")).toBe(false);
    }
  });

  it("the census records both as PARTIAL rather than MISSING, so the work is not rebuilt", () => {
    const vendor = census().byKey("vendor_cycle.vendor_paid_by_ach");
    const payroll = census().byKey("payroll_cycle.net_pay_disbursed");
    expect(vendor?.layers.married.status).toBe("PARTIAL");
    expect(payroll?.layers.married.status).toBe("PARTIAL");
  });
});

describe("tax-inclusive pricing is why excise must be extracted (F-11)", () => {
  it("the excise rate is 3700 basis points", () => {
    const all = subtreeText("src");
    expect(all).toContain("CANNABIS_EXCISE_TAX_BPS");
    expect(all).toContain("3700");
  });

  it("the orders table has no excise column, so 32000 and 32100 cannot be split", () => {
    const sql = read("supabase/migrations/0007_slice7_orders.sql");
    expect(sql).toContain("estimated_tax_minor_units");
    expect(sql.toLowerCase().includes("excise")).toBe(false);
  });
});

describe("the ledger's own vocabulary bounds the census", () => {
  it("the census does not invent a source kind the database would refuse", () => {
    const migration = read("supabase/migrations/0172_gl_foundation.sql");
    for (const r of LEDGER_CENSUS_ROWS) {
      expect(
        migration.includes(`'${r.sourceKind}'`),
        `${r.sourceKind} is not in the 0172 CHECK constraint`,
      ).toBe(true);
    }
  });
});

describe("every defect the census cites is recorded, and vice versa", () => {
  const defectsMd = read("docs/DEFECTS.md");

  /**
   * Derived from the ROWS, not from the built census, and deliberately so.
   *
   * This loop generates one test per defect id, which means it runs at
   * COLLECTION time. Mutation testing caught the consequence: when a mutant
   * introduced a row-level contradiction, `census()` threw here, vitest
   * reported "no tests found", and the harness could not tell a caught defect
   * from a broken config. LEDGER_CENSUS_ROWS is a plain data import that
   * cannot throw, so collection always succeeds and failures are always named.
   *
   * The class's own defectIds() is still checked, inside a real test below.
   */
  const citedIds = [...new Set(
    LEDGER_CENSUS_ROWS.map((r) => r.defectId).filter((d): d is string => d !== null),
  )].sort();

  for (const id of citedIds) {
    it(`${id} has an entry in DEFECTS.md`, () => {
      expect(
        new RegExp(`^##+\\s*${id}\\b`, "m").test(defectsMd),
        `${id} is cited by the census but not recorded`,
      ).toBe(true);
    });
  }

  it("the class agrees with the rows about which defects are cited", () => {
    expect([...census().defectIds()].sort()).toEqual(citedIds);
  });

  it("cites a contiguous block starting at D-31", () => {
    const nums = census()
      .defectIds()
      .map((d) => Number(d.slice(2)))
      .sort((a, b) => a - b);
    expect(nums[0]).toBe(31);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i], "defect ids must not skip").toBe(nums[i - 1] + 1);
    }
  });
});

/* ═════════════════════════ 4. HONESTY GATES ══════════════════════════════ */

/**
 * Standing rule 43: a refusal that no code path emits is decoration, and it
 * reviews as protection. Each test below feeds the validator the exact
 * contradiction it claims to catch and proves it actually refuses.
 */
describe("the census refuses to be built dishonestly", () => {
  const v = (status: LayerVerdict["status"], reason?: string): LayerVerdict =>
    reason === undefined
      ? { status, evidence: "measured" }
      : { status, evidence: "measured", reason };

  const base: CensusRow = {
    key: "cash_and_banking.test_row",
    family: "cash_and_banking",
    event: "a test event",
    sourceKind: "bank",
    entityCode: "greenway",
    accountCodes: ["10200", "76040"],
    builder: null,
    poster: null,
    layers: {
      exists: v("MISSING"),
      reachable: v("MISSING"),
      correct: v("MISSING"),
      accepted: v("MISSING"),
      idempotent: v("MISSING"),
      married: v("MISSING"),
    },
    defectId: "D-31",
    consequence: "a consequence long enough to satisfy the gate",
  };

  const row = (patch: Partial<CensusRow>): CensusRow => ({ ...base, ...patch });
  const withLayer = (layer: string, verdict: LayerVerdict): CensusRow =>
    row({ layers: { ...base.layers, [layer]: verdict } as CensusRow["layers"] });

  it("accepts the honest baseline row", () => {
    expect(validateCensusRow(base, COA_CODES)).toBeNull();
  });

  it("refuses a verdict with no evidence", () => {
    const bad = withLayer("exists", { status: "MISSING", evidence: "   " });
    expect(validateCensusRow(bad, COA_CODES)).toContain("evidence is blank");
  });

  it("refuses UNKNOWN that does not say why", () => {
    const bad = withLayer("correct", { status: "UNKNOWN", evidence: "measured" });
    expect(validateCensusRow(bad, COA_CODES)).toContain("must say why");
  });

  it("refuses NOT_APPLICABLE that does not say why", () => {
    const bad = withLayer("married", { status: "NOT_APPLICABLE", evidence: "m" });
    expect(validateCensusRow(bad, COA_CODES)).toContain("must say why");
  });

  it("refuses prose attached to a measured verdict, which could soften it", () => {
    const bad = withLayer("exists", {
      status: "MISSING",
      evidence: "measured",
      reason: "but really it is nearly done",
    });
    expect(validateCensusRow(bad, COA_CODES)).toContain("must not carry prose");
  });

  it("refuses exists=PRESENT with nothing that builds the entry", () => {
    const bad = withLayer("exists", v("PRESENT"));
    expect(validateCensusRow(bad, COA_CODES)).toContain("exists=PRESENT with no builder");
  });

  it("refuses exists=MISSING when a builder is named", () => {
    const bad = row({ builder: "src/lib/accounting/bo-tax-core.ts#boAccrualEntry" });
    expect(validateCensusRow(bad, COA_CODES)).toContain("exists=MISSING although builder");
  });

  it(
    "refuses reachable=PRESENT with no poster — the exact error a module-level " +
      "census made about payroll",
    () => {
      const bad = withLayer("reachable", v("PRESENT"));
      expect(validateCensusRow(bad, COA_CODES)).toContain(
        "reachable=PRESENT with no poster",
      );
    },
  );

  it("refuses accepted=PRESENT while unreachable, because untried is not accepted", () => {
    const bad = withLayer("accepted", v("PRESENT"));
    expect(validateCensusRow(bad, COA_CODES)).toContain("untried is not accepted");
  });

  it("refuses idempotent=PRESENT while unreachable", () => {
    const bad = withLayer("idempotent", v("PRESENT"));
    expect(validateCensusRow(bad, COA_CODES)).toContain(
      "idempotent=PRESENT although nothing can reach the ledger",
    );
  });

  it("refuses a gap with no defect id, because an unrecorded finding is forgotten", () => {
    const bad = row({ defectId: null });
    expect(validateCensusRow(bad, COA_CODES)).toContain("no defect id");
  });

  it("refuses an account that is not in the chart of accounts", () => {
    // 99999 is deliberately chosen: it is asserted absent below, so this test
    // cannot silently start passing for the wrong reason if the chart grows.
    expect(COA_CODES).not.toContain("99999");
    const bad = row({ accountCodes: ["10200", "99999"] });
    expect(validateCensusRow(bad, COA_CODES)).toContain(
      "account 99999 is not in the chart of accounts",
    );
  });

  it("refuses a one-sided entry", () => {
    const bad = row({ accountCodes: ["10200"] });
    expect(validateCensusRow(bad, COA_CODES)).toContain("fewer than two accounts");
  });

  it("refuses a builder that is not file#symbol", () => {
    const bad = row({
      builder: "somewhere in the payroll code",
      layers: { ...base.layers, exists: v("PARTIAL") },
    });
    expect(validateCensusRow(bad, COA_CODES)).toContain("is not file#symbol");
  });

  it("refuses a key that does not match its family", () => {
    const bad = row({ key: "payroll_cycle.test_row" });
    expect(validateCensusRow(bad, COA_CODES)).toContain("does not start with its family");
  });

  it("refuses a blank consequence, so nothing can be catalogued without a why", () => {
    const bad = row({ consequence: "   " });
    expect(validateCensusRow(bad, COA_CODES)).toContain("consequence is blank");
  });

  it("refuses an empty census outright", () => {
    expect(() => LedgerCensus.create([], COA_CODES)).toThrow(/empty census/);
  });

  it("refuses to validate with no chart of accounts to check against", () => {
    expect(() => LedgerCensus.create(LEDGER_CENSUS_ROWS, [])).toThrow(
      /no chart of accounts/,
    );
  });

  it("refuses duplicate keys", () => {
    expect(() => LedgerCensus.create([base, base], COA_CODES)).toThrow(/duplicate key/);
  });

  it("reports EVERY problem at once rather than stopping at the first", () => {
    const bad = row({ consequence: "  ", accountCodes: ["10200"] });
    try {
      LedgerCensus.create([bad], COA_CODES);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/problem\(s\) in the census/);
    }
  });

  it("validates a layer verdict on its own, for reuse by future tooling", () => {
    expect(validateLayerVerdict("exists", v("PRESENT"))).toBeNull();
    expect(validateLayerVerdict("exists", { status: "PRESENT", evidence: "" })).toContain(
      "evidence is blank",
    );
  });
});

/* ═════════════════════════ 5. THE OWNER-FACING SENTENCE ══════════════════ */

describe("the summary tells Michael the truth and leads with the bad news", () => {

  it("counts are computed from the rows, not maintained by hand", () => {
    const c = census();
    const s = summariseCensus(c);
    expect(s.total).toBe(LEDGER_CENSUS_ROWS.length);
    expect(s.unreachable).toBe(c.unreachable().length);
    expect(s.fullyProven).toBe(c.fullyProven().length);
  });

  it("reports that the overwhelming majority cannot reach the books", () => {
    const s = summariseCensus(census());
    expect(s.unreachable / s.total).toBeGreaterThan(0.8);
  });

  it("leads with what cannot post rather than with how much was catalogued", () => {
    const s = summariseCensus(census());
    const msg = censusMessage(s);
    expect(msg).toMatch(/^\d+ money events/);
    expect(msg).toContain("cannot reach them at all");
  });

  it("names the count of rows nothing even builds", () => {
    const s = summariseCensus(census());
    expect(censusMessage(s)).toContain("nothing that builds the entry");
  });

  it("admits the layers it could not measure", () => {
    const s = summariseCensus(census());
    expect(s.unknown).toBeGreaterThan(0);
    expect(censusMessage(s)).toContain("could not measure");
  });

  it("says something honest about an empty census rather than nothing", () => {
    expect(
      censusMessage({
        total: 0,
        fullyProven: 0,
        unreachable: 0,
        noBuilder: 0,
        unknown: 0,
        byLayer: {
          exists: 0,
          reachable: 0,
          correct: 0,
          accepted: 0,
          idempotent: 0,
          married: 0,
        },
      }),
    ).toContain("cannot be right");
  });

  it("counts missing rows per layer so a wiring slice can be scoped by layer", () => {
    const c = census();
    const s = summariseCensus(c);
    for (const l of CENSUS_LAYERS) {
      expect(s.byLayer[l]).toBe(c.missingAt(l).length);
    }
  });
});

/* ═════════════════════════ 6. THE WIRING BACKLOG IS ORDERED ══════════════ */

describe("the census can order the work by economic weight", () => {

  it("puts revenue and COGS in the backlog, because they are the largest numbers", () => {
    const unreachable = census().unreachable().map((r) => r.key);
    expect(unreachable).toContain("revenue_and_tax_collected.retail_sale");
    expect(unreachable).toContain("cost_of_goods_sold.cogs_on_sale");
  });

  it("does NOT put the two working paths in the backlog", () => {
    const unreachable = census().unreachable().map((r) => r.key);
    expect(unreachable).not.toContain("cost_of_goods_sold.inventory_audit_adjustment");
    expect(unreachable).not.toContain("periodic_and_other.manual_journal");
  });

  it("identifies the rows where a builder already exists, which are the cheap wins", () => {
    const cheap = census()
      .all()
      .filter((r) => r.builder !== null && r.layers.reachable.status === "MISSING")
      .map((r) => r.key);
    expect(cheap).toContain("payroll_cycle.payroll_run_accrued");
    expect(cheap).toContain("periodic_and_other.bo_tax_accrual");
    expect(cheap).toContain("vendor_cycle.vendor_bill_recorded");
  });

  it("flags that a purchase order should NOT post, so nobody wires it by mistake", () => {
    const po = census().byKey("vendor_cycle.purchase_order_commitment");
    expect(po?.layers.correct.status).toBe("NOT_APPLICABLE");
    expect(po?.layers.correct.reason).toContain("RECEIPT is booked");
  });

  it("records that the fixed-asset rows are blocked by the chart, not by wiring", () => {
    const asset = census().byKey("periodic_and_other.fixed_asset_acquired");
    expect(asset?.defectId).toBe("D-43");
    expect(asset?.layers.correct.evidence).toContain("MEASURED");
  });
});

/* ══════════════════ 7. THE EVIDENCE ITSELF IS GATED ═══════════════════ */

/**
 * Sections 1-6 assert the census's VERDICTS. Mutation testing showed that was
 * not enough: two mutants survived.
 *
 *  - One softened a row's evidence string while leaving its status alone. The
 *    verdict stayed MISSING, every test stayed green, and the census silently
 *    lost the measurement that justifies the verdict. A census whose evidence
 *    can rot is a census that will be argued with later and cannot defend
 *    itself.
 *
 *  - One made fullyProven() count UNKNOWN as proven. That mutant made the
 *    report look BETTER than the repository, which is the single most
 *    dangerous direction for this file to drift.
 *
 * So this section gates the evidence, and it does it by re-deriving the
 * underlying fact from the repository rather than by comparing the evidence
 * string to a copy of itself. A test that only checks that a string equals a
 * string it also owns proves nothing.
 */

describe("evidence cannot be softened without a test failing", () => {

  it("the payroll row still names the dev-only script, and that script still says so", () => {
    const row = census().byKey("payroll_cycle.payroll_run_accrued");
    expect(row, "the payroll row must exist").toBeDefined();

    // The claim the census makes.
    const ev = row!.layers.reachable.evidence;
    expect(ev).toContain("scripts/compliance/e2e-payroll-journal.ts");
    expect(ev).toContain("Development verification only");

    // The same claim, re-derived from disk. If the script is ever promoted
    // into the app, or its header changes, this fails and the census must be
    // re-measured rather than quietly kept.
    const script = "scripts/compliance/e2e-payroll-journal.ts";
    expect(exists(script), `${script} is cited as evidence but does not exist`).toBe(true);
    expect(read(script)).toContain("Development verification only");
  });

  it("buildPayrollJournal is called only by its own module, which is what MISSING means", () => {
    // The measurement behind the payroll verdict, re-derived here.
    //
    // The first version of this test asserted that NO file under src/ mentions
    // the symbol. That was wrong: payroll-cogs-core.ts calls its own builder
    // five times in its own self-tests, which is precisely what the census
    // evidence says ("matches ONLY inside payroll-cogs-core.ts itself"). The
    // honest gate is therefore that no OTHER file calls it - a stronger claim,
    // because it is the one that makes the builder unreachable from the app.
    const callers = walk("src")
      .filter((f) => !f.endsWith("/ledger-census-data.ts"))
      .filter((f) => !f.endsWith("/ledger-census-core.ts"))
      .filter((f) => !f.endsWith("/payroll-cogs-core.ts"))
      .filter((f) => read(f).includes("buildPayrollJournal"));
    expect(callers, "buildPayrollJournal now has a caller - re-measure the census").toEqual([]);

    // And the module itself really does contain it, so this test cannot pass
    // just because the symbol was renamed out from under the census.
    expect(read("src/lib/accounting/payroll-cogs-core.ts")).toContain(
      "export function buildPayrollJournal(",
    );

    const row = census().byKey("payroll_cycle.payroll_run_accrued");
    expect(row!.layers.reachable.status).toBe("MISSING");
  });

  it("gap evidence cannot be reworded to imply the work is already done", () => {
    // The mutant this kills reworded a measured 0-hit grep into "wired up in a
    // previous slice" and left the status at MISSING. Every verdict stayed
    // correct, every other test stayed green, and the census quietly lost the
    // measurement that justifies the verdict - the exact drift this file
    // exists to prevent.
    //
    // Measured before adding: 0 occurrences across all 186 evidence strings,
    // so this gate starts clean rather than grandfathering anything.
    const SOFTENING = [
      "wired up",
      "already wired",
      "now wired",
      "hooked up",
      "already posts",
      "previous slice",
      "fixed in",
      "resolved in",
    ];

    let checked = 0;
    for (const r of LEDGER_CENSUS_ROWS) {
      for (const l of CENSUS_LAYERS) {
        const v = r.layers[l];
        if (v.status !== "MISSING" && v.status !== "PARTIAL") continue;
        checked++;
        const text = v.evidence.toLowerCase();
        for (const w of SOFTENING) {
          expect(
            text.includes(w),
            `${r.key}.${l} is a ${v.status} verdict but its evidence says "${w}": ${v.evidence}`,
          ).toBe(false);
        }
      }
    }
    // Guard against this test passing because it examined nothing.
    expect(checked, "no gap verdicts were examined - the filter is broken").toBeGreaterThan(60);
  });

  it("the payroll reachable evidence still reports a grep, not a conclusion", () => {
    // Narrow companion to the gate above, aimed at the single most misread row
    // in the census: the payroll builder that is finished and unreachable.
    const ev = census().byKey("payroll_cycle.payroll_run_accrued")!.layers.reachable.evidence;
    expect(ev).toContain("grep -rn");
    expect(ev).toContain("buildPayrollJournal");
    expect(ev).toContain("ONLY inside payroll-cogs-core.ts");
    expect(ev.toLowerCase()).not.toContain("wired");
  });

  it("the rows that drive the backlog cite a concrete artifact, not an opinion", () => {
    // Scoped deliberately.
    //
    // A first attempt required every gap verdict to exceed a character count.
    // That was an arbitrary number and it was wrong: 74 of the census's 186
    // evidence strings are legitimately short, because on the accepted and
    // idempotent layers of a row that cannot post at all there is genuinely
    // nothing to measure, and manufacturing a measurement there would be
    // guessing.
    //
    // The rows that actually carry weight are the ones that will be worked
    // next: a builder already exists, but nothing reaches it. For those, the
    // reachable evidence must point at something a reader can go check - a
    // file, a SQL door, or a grep that was really run.
    const ARTIFACT = /[A-Za-z0-9_-]+\.(?:ts|tsx|sql)|\bgl_[a-z0-9_]+|\bgrep\b/;

    const drivers = census()
      .all()
      .filter((r) => r.builder !== null && r.layers.reachable.status === "MISSING");

    // Guard against this test passing on an empty set.
    expect(drivers.length, "no backlog drivers found - the filter is broken").toBe(6);

    for (const r of drivers) {
      expect(
        ARTIFACT.test(r.layers.reachable.evidence),
        `${r.key} reachable evidence cites no checkable artifact: ${r.layers.reachable.evidence}`,
      ).toBe(true);
    }
  });

  it("every file the census cites actually exists in the repository", () => {
    // Catches the failure mode that already bit this slice: a plausible path or
    // symbol written from memory instead of measured. Two passes, because the
    // census cites files both ways.
    const evidence = LEDGER_CENSUS_ROWS.flatMap((r) =>
      CENSUS_LAYERS.map((l) => r.layers[l].evidence),
    ).join("\n");

    // Pass 1: fully-qualified paths must resolve exactly.
    const fullPaths = new Set(
      [
        ...evidence.matchAll(
          /\b((?:src|scripts|supabase)\/[A-Za-z0-9_\-./]+\.(?:ts|tsx|sql))/g,
        ),
      ].map((m) => m[1]),
    );
    expect(fullPaths.size, "no full paths found - the extractor is broken").toBeGreaterThan(5);
    for (const p of fullPaths) {
      expect(exists(p), `census cites ${p}, which does not exist`).toBe(true);
    }

    // Pass 2: bare basenames must resolve to at least one real file. This is
    // the wider net - the census names far more files by basename than by path.
    const tracked = walk("src").concat(walk("scripts"), walk("supabase"));
    const sqlFiles = readdirSync(join(REPO, "supabase", "migrations"));
    const known = new Set<string>([
      ...tracked.map((f) => f.slice(f.lastIndexOf("/") + 1)),
      ...sqlFiles,
    ]);

    const basenames = new Set(
      [...evidence.matchAll(/\b([A-Za-z0-9_-]+\.(?:ts|tsx|sql))\b/g)].map((m) => m[1]),
    );
    expect(basenames.size, "no basenames found - the extractor is broken").toBeGreaterThan(15);
    for (const b of basenames) {
      expect(known.has(b), `census cites ${b}, which is not a file in this repo`).toBe(true);
    }
  });
});

describe("the good news cannot be inflated", () => {

  it("fullyProven counts only PRESENT and NOT_APPLICABLE, never UNKNOWN", () => {
    for (const r of census().fullyProven()) {
      for (const l of CENSUS_LAYERS) {
        const s = r.layers[l].status;
        expect(
          s === "PRESENT" || s === "NOT_APPLICABLE",
          `${r.key} is reported fully proven but layer ${l} is ${s}`,
        ).toBe(true);
      }
    }
  });

  it("a row whose ONLY unproven layer is UNKNOWN still does not count as proven", () => {
    // Built by hand, and that is the whole point.
    //
    // A first version of this test filtered the real population for rows with
    // an UNKNOWN layer and asserted none were proven. It passed, and it was
    // vacuous: measurement showed that ZERO rows in the population have
    // UNKNOWN as their only unproven layer - every one of them is also MISSING
    // somewhere, so they fail fullyProven() for the other reason regardless.
    // The mutant that counts UNKNOWN as proof therefore survived.
    //
    // This fixture isolates the property: five PRESENT layers, one UNKNOWN.
    // Only a fullyProven() that treats UNKNOWN as proof will include it.
    const ev = (status: LayerVerdict["status"], reason?: string): LayerVerdict =>
      reason === undefined
        ? { status, evidence: "measured for this fixture" }
        : { status, evidence: "measured for this fixture", reason };

    const almost: CensusRow = {
      key: "cash_and_banking.unknown_probe",
      family: "cash_and_banking",
      event: "a fixture row used to prove UNKNOWN is never counted as proof",
      sourceKind: "bank",
      entityCode: "greenway",
      accountCodes: ["10200", "76040"],
      builder: "src/lib/accounting/bo-tax-core.ts#boAccrualEntry",
      poster: "src/app/admin/books/journal/actions.ts#submitJournalAction",
      layers: {
        exists: ev("PRESENT"),
        reachable: ev("PRESENT"),
        correct: ev("PRESENT"),
        accepted: ev("PRESENT"),
        idempotent: ev("UNKNOWN", "no ref convention exists for this fixture"),
        married: ev("NOT_APPLICABLE", "no bank side for this fixture"),
      },
      defectId: null,
      consequence: "none; this row exists only to exercise fullyProven",
    };

    // Prove the fixture is itself legal, so a failure below is about
    // fullyProven and not about a malformed row.
    expect(validateCensusRow(almost, COA_CODES)).toBeNull();

    const c = LedgerCensus.create([almost], COA_CODES);
    expect(
      c.fullyProven().map((r) => r.key),
      "a layer that could not be measured is being reported as proof",
    ).toEqual([]);

    // And the positive control: flip the UNKNOWN to PRESENT and it counts.
    const proven: CensusRow = {
      ...almost,
      layers: { ...almost.layers, idempotent: ev("PRESENT") },
    };
    expect(LedgerCensus.create([proven], COA_CODES).fullyProven().length).toBe(1);
  });

  it("the proven count is small, and the two proven rows are the ones measured", () => {
    // If this ever rises, it is either real progress or a broken measurement.
    // Either way it must be looked at rather than absorbed.
    const proven = census().fullyProven().map((r) => r.key).sort();
    expect(proven).toEqual([
      "cost_of_goods_sold.inventory_audit_adjustment",
      "periodic_and_other.manual_journal",
    ]);
  });

  it("summariseCensus agrees with the class, so the report cannot drift from the data", () => {
    const c = census();
    const s = summariseCensus(c);
    expect(s.fullyProven).toBe(c.fullyProven().length);
    expect(s.fullyProven).toBeLessThan(s.total / 2);
    expect(s.noBuilder).toBe(c.all().filter((r) => r.builder === null).length);
  });
});

/* ════════════════ 8. THE GENERATED MAP CANNOT GO STALE ════════════════ */

/**
 * docs/LEDGER_REACHABILITY_CENSUS.md is Michael's readable copy of this census:
 * every event, every verdict, every piece of evidence, in tables he can scan
 * without opening a TypeScript file.
 *
 * It is GENERATED from the same data the tests above check, and this section
 * proves the copy on disk is current. A hand-maintained map drifts from the
 * data within a slice or two, and a map that disagrees with the territory is
 * worse than having no map: it gets trusted.
 */
describe("the readable census map is present and current", () => {

  it("exists on disk", () => {
    expect(
      exists("docs/LEDGER_REACHABILITY_CENSUS.md"),
      "run: npx tsx scripts/compliance/build-census-doc.ts",
    ).toBe(true);
  });

  it("matches the census data exactly, so a stale copy cannot ship", () => {
    const doc = read("docs/LEDGER_REACHABILITY_CENSUS.md");
    const c = census();
    const s = summariseCensus(c);

    // The headline sentence, byte for byte.
    expect(doc).toContain(censusMessage(s));

    // Every count.
    expect(doc).toContain(`| Money events catalogued | ${s.total} |`);
    expect(doc).toContain(`| Proven on all six layers | ${s.fullyProven} |`);
    expect(doc).toContain(`| Cannot reach the books at all | ${s.unreachable} |`);
    expect(doc).toContain(`| Have nothing that even builds the entry | ${s.noBuilder} |`);

    // Every per-layer gap count.
    for (const l of CENSUS_LAYERS) {
      expect(doc, `layer ${l} count is stale in the map`).toContain(
        `| \`${l}\` | ${s.byLayer[l]} of ${s.total} |`,
      );
    }
  });

  it("gives every single row its own section, so nothing is summarised away", () => {
    const doc = read("docs/LEDGER_REACHABILITY_CENSUS.md");
    for (const r of LEDGER_CENSUS_ROWS) {
      expect(doc, `${r.key} is missing from the map`).toContain(`### \`${r.key}\``);
      expect(doc, `${r.key} consequence is missing from the map`).toContain(r.consequence);
    }
  });

  it("reproduces every piece of evidence, because evidence is the point", () => {
    const doc = read("docs/LEDGER_REACHABILITY_CENSUS.md");
    for (const r of LEDGER_CENSUS_ROWS) {
      for (const l of CENSUS_LAYERS) {
        expect(doc, `${r.key}.${l} evidence is missing from the map`).toContain(
          r.layers[l].evidence,
        );
      }
    }
  });

  it("says out loud that it is generated, so nobody edits it by hand", () => {
    const doc = read("docs/LEDGER_REACHABILITY_CENSUS.md");
    expect(doc).toContain("**This file is generated.**");
    expect(doc).toContain("scripts/compliance/build-census-doc.ts");
  });

  it("the generator it names really exists and supports --check", () => {
    const gen = "scripts/compliance/build-census-doc.ts";
    expect(exists(gen)).toBe(true);
    expect(read(gen)).toContain("--check");
  });
});
