/**
 * tests/compliance/owner-gate-core.test.ts
 *
 * SLICE books-06 — THE OWNER GATE OVER THE MONEY PAGES.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * Migration 0190 re-gates 25 tables (bank feed, ATM vault, crypto treasury,
 * loans) from is_staff() -- true for ANY active staff member of ANY role --
 * to is_owner(). The application pages in front of those tables moved from
 * "settings.manage" (owner+admin) to "finances.view" (owner alone).
 *
 * Two gates now guard the same data. THE ONLY FAILURE MODE THAT MATTERS IS
 * THEM DISAGREEING:
 *
 *   - Page gate looser than the DB gate  -> a user sees the menu item, clicks
 *     it, and gets a raw database refusal. The "fix" someone reaches for is
 *     LOOSENING THE DATABASE, which hands over everything.
 *   - DB gate looser than the page gate  -> the page hides the link, and
 *     everyone assumes the data is protected. It is not. Anyone with an API
 *     token reads it directly.
 *
 * So these tests read the ACTUAL migration file and the ACTUAL roles matrix off
 * disk and assert they say the same thing. A test that only checked the
 * TypeScript would pass while the database sat wide open.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FINANCIAL_TABLES,
  GATE_EXCLUSIONS,
  GATE_AUTHORITIES,
  FINANCE_ROUTES,
  DELIBERATELY_NOT_OWNER_ONLY,
  canViewFinances,
  DB_IS_OWNER_ROLES,
  __runOwnerGateCoreTests,
} from "@/lib/auth/owner-gate-core";
import { can, rolesForPermission, ALL_ROLES, ALL_PERMISSIONS, PERMISSION_LABELS } from "@/lib/auth/roles";

const REPO = join(__dirname, "..", "..");
const MIGRATION = readFileSync(
  join(REPO, "supabase", "migrations", "0190_owner_only_financial_tables.sql"),
  "utf8",
);
const NAV = readFileSync(join(REPO, "src", "components", "admin", "admin-nav-data.ts"), "utf8");

describe("owner-gate-core self-tests", () => {
  it("passes its own embedded suite", () => {
    expect(() => __runOwnerGateCoreTests()).not.toThrow();
  });
});

describe("the permission itself", () => {
  it("finances.view is OWNER ONLY", () => {
    expect(rolesForPermission("finances.view")).toEqual(["owner"]);
  });

  it("every non-owner role is refused", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "finances.view")).toBe(role === "owner");
    }
  });

  it("admin specifically cannot view finances (this is the whole slice)", () => {
    expect(can("admin", "finances.view")).toBe(false);
  });

  it("admin KEEPS the two jobs the owner left with admin", () => {
    // Owner, verbatim: "The only thing an admin can do is pay vendors and pay
    // employees." If this ever fails, the lockdown went too far and took away
    // something the owner explicitly wanted kept.
    expect(can("admin", "payables.manage")).toBe(true);
    expect(can("admin", "staffing.manage")).toBe(true);
  });

  it("is wired into the admin permission matrix UI", () => {
    expect(ALL_PERMISSIONS).toContain("finances.view");
    expect(PERMISSION_LABELS["finances.view"]).toMatch(/bank|money|atm|crypto|loan/i);
  });

  it("canViewFinances agrees with the matrix for every role", () => {
    for (const role of ALL_ROLES) {
      expect(canViewFinances(role)).toBe(can(role, "finances.view"));
    }
  });

  it("refuses null / undefined / unknown callers", () => {
    expect(canViewFinances(null)).toBe(false);
    expect(canViewFinances(undefined)).toBe(false);
  });
});

describe("the page gate and the database gate agree", () => {
  it("the TS owner list matches the DB is_owner() role list", () => {
    expect([...DB_IS_OWNER_ROLES]).toEqual(rolesForPermission("finances.view"));
  });

  it("every table in the TS inventory is in the migration's allow-list", () => {
    // §1 of the migration carries the list that actually gets re-gated. If a
    // table is described in TypeScript but missing from the SQL array, the app
    // claims a protection the database never applied.
    for (const t of FINANCIAL_TABLES) {
      expect(MIGRATION).toContain(`'${t.table}'`);
    }
  });

  it("every table in the TS inventory is in the audit function's list too", () => {
    // The migration has the list TWICE on purpose: once to re-gate (§1) and
    // once to audit (§3). A table present in the first and missing from the
    // second would be locked but never verified -- so a later regression on it
    // would go unreported. Count the occurrences to prove it is in both.
    for (const t of FINANCIAL_TABLES) {
      const hits = MIGRATION.split(`'${t.table}'`).length - 1;
      expect(hits, `${t.table} must appear in BOTH the re-gate list and the audit list`).toBeGreaterThanOrEqual(2);
    }
  });

  it("the migration re-gates is_staff() to is_owner(), not something weaker", () => {
    expect(MIGRATION).toContain("replace(coalesce(r.qual,      ''), 'is_staff()', 'is_owner()')");
    expect(MIGRATION).toContain("is_owner()");
    // It must NOT settle for is_admin(), which would still include admin.
    expect(MIGRATION).not.toMatch(/'is_staff\(\)',\s*'is_admin\(\)'/);
  });

  it("the deliberate exclusions are NOT in the re-gate list", () => {
    // tax_settings / tax_category_rules are POS pricing config. Locking them
    // stops the register. They must be documented but never swept in.
    for (const x of GATE_EXCLUSIONS) {
      const inAllowList = FINANCIAL_TABLES.some((t) => t.table === x.table);
      expect(inAllowList, `${x.table} must never be in the owner-only list`).toBe(false);
    }
  });

  it("the migration explains the exclusions in writing", () => {
    for (const x of GATE_EXCLUSIONS) {
      expect(MIGRATION).toContain(x.table);
    }
    expect(MIGRATION).toMatch(/DELIBERATELY \*NOT\* CHANGED/i);
  });
});

describe("out-of-order protection (the D15 pattern)", () => {
  it("refuses to run before its prerequisites exist", () => {
    expect(MIGRATION).toContain("MIGRATION_OUT_OF_ORDER");
  });

  it("names the exact file to run for each prerequisite", () => {
    // A guard that says "something is missing" sends the owner hunting. A
    // guard that names the file tells him what to do next.
    for (const f of [
      "0185_books_owner_only.sql",
      "0157_plaid_foundation.sql",
      "0156_atm_pai_foundation.sql",
      "0160_crypto_foundation.sql",
      "0171_manual_loans.sql",
    ]) {
      expect(MIGRATION, `the guard must name ${f}`).toContain(f);
    }
  });

  it("reassures the owner that nothing was changed", () => {
    const guards = MIGRATION.match(/MIGRATION_OUT_OF_ORDER[^']*/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(5);
    for (const g of guards) {
      expect(g).toMatch(/Nothing was changed/i);
    }
  });

  it("the guard runs BEFORE anything is modified", () => {
    const guardAt = MIGRATION.indexOf("MIGRATION_OUT_OF_ORDER");
    const firstWrite = MIGRATION.search(/\$regate\$|create or replace function/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstWrite);
  });
});

describe("the audit helper", () => {
  it("exists and is documented as empty-means-pass", () => {
    expect(MIGRATION).toContain("gl_audit_financial_tables_gate()");
    expect(MIGRATION).toMatch(/EMPTY RESULT/i);
  });

  it("reports BOTH failure shapes, not just one", () => {
    // "still on is_staff()" and "has no owner policy at all" are different
    // problems. A helper that only checked the first would call a table with
    // zero policies a pass.
    //
    // MUTATION-HARDENED (mutant M7 survived the first version of this test).
    // The first version asserted /no is_owner\(\) policy/i, which the migration
    // satisfies TWICE: once in an explanatory COMMENT and once in the actual
    // SQL string the function returns. Breaking the SQL left the comment
    // behind, the regex still matched, and the test reported green while the
    // audit had genuinely lost half its job.
    //
    // A test that a COMMENT can satisfy is not testing behaviour. So this
    // asserts the executable pieces specifically: the returned detail string,
    // the second branch of the UNION, and the NOT EXISTS sub-query that
    // actually looks for an owner policy.
    expect(MIGRATION).toContain("still references is_staff()");
    expect(MIGRATION).toContain("'exists but has no is_owner() policy");
    expect(MIGRATION).toMatch(/union all/i);
    expect(MIGRATION).toMatch(/not exists\s*\(/i);
    // ...and the sub-query must hunt for is_owner(), not merely mention it.
    const notExistsBlock = MIGRATION.slice(MIGRATION.indexOf("not exists"));
    expect(notExistsBlock).toContain("is_owner()");
  });

  it("does NOT copy the 0185 self-exclusion, and says why", () => {
    // gl_audit_owner_only_gate() had to exclude itself because it searched
    // FUNCTION BODIES and matched its own source. This one searches pg_policy,
    // so it cannot report itself -- and adding an exclusion "to be safe" would
    // hide real findings. The reasoning must stay written down.
    expect(MIGRATION).not.toMatch(/proname not like 'gl\\_audit\\_%'/);
    expect(MIGRATION).toMatch(/self-exclusion/i);
  });
});

describe("the routes", () => {
  it("covers all four money pages", () => {
    const routes = FINANCE_ROUTES.map((r) => r.route).sort();
    expect(routes).toEqual(["/admin/atm", "/admin/crypto", "/admin/loans", "/admin/plaid"]);
  });

  it("every money page in the nav uses finances.view", () => {
    for (const r of FINANCE_ROUTES) {
      const line = NAV.split("\n").find((l) => l.includes(`href: "${r.route}"`));
      expect(line, `nav entry for ${r.route}`).toBeTruthy();
      expect(line, `${r.route} nav must be finances.view`).toContain('permission: "finances.view"');
    }
  });

  it("the page guard and the nav guard agree for every role", () => {
    // If the nav shows a link the page then refuses, the owner gets a support
    // ticket and someone "fixes" it by loosening the gate.
    for (const r of FINANCE_ROUTES) {
      for (const role of ALL_ROLES) {
        const navAllows = can(role, "finances.view");
        const pageAllows = can(role, r.permission as "finances.view");
        expect(navAllows, `${r.route} @ ${role}`).toBe(pageAllows);
      }
    }
  });

  it("the payee vault deliberately stays owner+admin", () => {
    const vault = DELIBERATELY_NOT_OWNER_ONLY.find(
      (r) => r.route === "/admin/settings/banking",
    );
    expect(vault).toBeTruthy();
    expect(vault!.permission).toBe("settings.manage");
    expect(can("admin", "settings.manage")).toBe(true);
    const navLine = NAV.split("\n").find((l) => l.includes('href: "/admin/settings/banking"'));
    expect(navLine).toContain('permission: "settings.manage"');
  });
});

describe("the authorities are real and verbatim", () => {
  it("carries at least eight authorities", () => {
    expect(GATE_AUTHORITIES.length).toBeGreaterThanOrEqual(8);
  });

  it("every authority has a citation, a quote and a source URL", () => {
    for (const a of GATE_AUTHORITIES) {
      expect(a.cite.length, a.id).toBeGreaterThan(5);
      expect(a.quote.length, a.id).toBeGreaterThan(40);
      expect(a.soWhat.length, a.id).toBeGreaterThan(30);
      expect(a.source, a.id).toMatch(/^https?:\/\//);
    }
  });

  it("no authority is a paraphrase placeholder", () => {
    for (const a of GATE_AUTHORITIES) {
      expect(a.quote, a.id).not.toMatch(/\b(TODO|TBD|paraphrase|roughly|something like)\b/i);
      expect(a.quote, a.id).not.toMatch(/\.\.\.$/);
    }
  });

  it("the migration quotes the SAME text as the application", () => {
    // The database and the app must not drift into two different explanations
    // of the same rule. Compare a distinctive fragment of each quote.
    for (const a of GATE_AUTHORITIES) {
      const fragment = a.quote.split(/\s+/).slice(0, 6).join(" ");
      const normalisedMigration = MIGRATION.replace(/\s*--\s*/g, " ").replace(/\s+/g, " ");
      expect(normalisedMigration, `${a.id} must be quoted in the migration too`).toContain(
        fragment,
      );
    }
  });

  it("names the specific regulations the owner is being kept safe from", () => {
    const all = GATE_AUTHORITIES.map((a) => a.cite).join(" | ");
    expect(all).toMatch(/16 CFR 314\.4/);
    expect(all).toMatch(/15 U\.S\.C\. 6801/);
    expect(all).toMatch(/4557/);
    expect(all).toMatch(/314-55-087/);
    expect(all).toMatch(/1\.6001-1/);
  });
});

describe("the inventory is complete and honest", () => {
  it("holds exactly the 25 tables the migration re-gates", () => {
    expect(FINANCIAL_TABLES.length).toBe(25);
  });

  it("flags the Plaid access token as a credential, not a report", () => {
    const item = FINANCIAL_TABLES.find((t) => t.table === "plaid_items");
    expect(item).toBeTruthy();
    expect(item!.exposure).toBe("credential");
    expect(item!.whatItReveals).toMatch(/token/i);
  });

  it("every entry explains what it reveals in plain English", () => {
    for (const t of FINANCIAL_TABLES) {
      expect(t.whatItReveals.length, t.table).toBeGreaterThanOrEqual(30);
      expect(t.whatItReveals, t.table).not.toMatch(/^(todo|tbd|n\/a)\b/i);
    }
  });

  it("has no duplicates", () => {
    const names = FINANCIAL_TABLES.map((t) => t.table);
    expect(new Set(names).size).toBe(names.length);
  });
});
