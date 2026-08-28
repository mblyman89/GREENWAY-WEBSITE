/**
 * tests/compliance/posting-services-are-reachable.test.ts   (slice books-88)
 *
 * THE GATE THAT SHOULD HAVE CAUGHT D-70.
 *
 * Michael, verbatim, after using the system:
 *
 *   "I did refresh the atm connection to bring in new atm fees, but those
 *    didn't land in the pending page."
 *
 * He was right, and the reason is the point of this file. `bank-expense-
 * service.ts` shipped in books-84 complete: 24 tests, 12 of 12 mutants killed,
 * a real classifier, a balanced entry, a draft submitted. It was called by
 * nothing. Not one line in `src/` invoked it. The ATM fees arrived in
 * `plaid_transactions` and stopped there, forever, silently.
 *
 * WHY THE EXISTING TEST DID NOT NOTICE
 *
 * tests/compliance/bank-expense-core.test.ts asserts:
 *
 *     expect(service).toContain("await submitJournal(")
 *
 * which proves the SERVICE calls the ledger. It never proves anything calls
 * the SERVICE. Reachability was measured one link too early, and the census
 * then recorded `reachable: PRESENT` on the strength of it. Both statements
 * were individually true and the feature was still dead.
 *
 * Standing rule 50: when a finished feature turns out to be unreachable, do
 * not delete the gate that missed it -- INVERT it. This file is that
 * inversion, widened deliberately from the one service that failed to ALL FOUR
 * posting services, because the defect shape is not "bank expenses were
 * forgotten", it is "a poster can be finished and unreachable and every test
 * still passes".
 *
 * WHY THE CENSUS FILE IS EXCLUDED
 *
 * `ledger-census-data.ts` names every builder and poster in the system as
 * strings, in `builder:` / `poster:` fields. If it counted as a caller, every
 * poster would be permanently "reachable" by virtue of the document that
 * claims they are reachable. That is precisely the circle D-70 hid inside, so
 * the census is excluded by name and the exclusion is itself asserted below --
 * an exclusion that stops matching the real filename is an exclusion that
 * silently stops excluding.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The four services that turn a real-world event into a journal entry.
//
// `entry` is the exported function an outside caller is expected to invoke.
// `door` names, in plain English, the thing that triggers it, because that is
// the column that explains D-70: three of these hang off an event the system
// already raises, and the fourth had nothing to hang off.
// ---------------------------------------------------------------------------
const POSTING_SERVICES = [
  {
    file: "src/lib/accounting/sale-posting-service.ts",
    entry: "postSaleForOrder",
    door: "a completed order",
  },
  {
    file: "src/lib/accounting/vendor-bill-service.ts",
    entry: "postManifestVendorBill",
    door: "a received inventory manifest",
  },
  {
    file: "src/lib/inventory/inventory-audit-store.ts",
    entry: "postAuditSession",
    door: "a closed audit session",
  },
  {
    file: "src/lib/accounting/bank-expense-service.ts",
    entry: "recordBankExpenses",
    door: "the owner pressing a button on /admin/books/bank (books-88, D-70)",
  },
  {
    file: "src/lib/atm/atm-settlement-service.ts",
    entry: "postAtmSettlements",
    door: "the owner pressing a button on /admin/atm?tab=transactions (books-89, D-40)",
  },
] as const;

/**
 * The census DESCRIBES the system; it does not run it. A mention there is a
 * claim, not a call. See the header.
 */
const NOT_A_CALLER = "src/lib/accounting/ledger-census-data.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const ALL_SOURCE = walk("src");

describe("every posting service is reachable from something a human can press", () => {
  // If this file were ever renamed or moved, the exclusion below would quietly
  // stop excluding anything and the census's own `poster:` strings would start
  // counting as callers -- restoring the exact blind spot that hid D-70.
  it("the excluded census file exists at the path this test excludes", () => {
    expect(ALL_SOURCE).toContain(NOT_A_CALLER);
  });

  // A guard on the guard: if the walker ever returns a handful of files
  // because a path changed, "no caller found" would become unprovable rather
  // than false, and every assertion below would fail for the wrong reason.
  it("the source walk actually reached the codebase", () => {
    expect(ALL_SOURCE.length).toBeGreaterThan(300);
  });

  // A guard on the guard on the guard. The books-89 mutation probe deleted one
  // entry from POSTING_SERVICES and every other test in this file still passed:
  // the list shrank, coverage shrank with it, and nothing said so. That is the
  // rule 50 shape exactly -- the gate that watches for unreachable posters was
  // itself unwatched. The count is STATED per rule 89 and rises only in a commit
  // that adds the poster it counts.
  it("watches every posting service the codebase has, and the count is stated", () => {
    // STATED per rule 89: 4 -> 5 posters (books-89 adds the ATM settlement door).
    expect(POSTING_SERVICES).toHaveLength(5);

    // Names, not just a number, so a deletion cannot be papered over by an
    // unrelated addition that happens to keep the total at five.
    expect(POSTING_SERVICES.map((s) => s.entry).sort()).toEqual([
      "postAtmSettlements",
      "postAuditSession",
      "postManifestVendorBill",
      "postSaleForOrder",
      "recordBankExpenses",
    ]);
  });

  for (const svc of POSTING_SERVICES) {
    describe(`${svc.entry} (${svc.door})`, () => {
      it("is exported from the file the census names", () => {
        const src = readFileSync(svc.file, "utf8");
        expect(new RegExp(`export\\s+async\\s+function\\s+${svc.entry}\\b`).test(src)).toBe(
          true,
        );
      });

      it("is CALLED by at least one file that is not itself and not the census", () => {
        // Word-boundary, not substring: `toContain("recordBankExpenses")` is
        // satisfied by `recordBankExpensesZZZ`, which is how books-86 and
        // books-87 both nearly shipped a gate that could not fail.
        const called = new RegExp(`\\b${svc.entry}\\s*\\(`);

        const callers = ALL_SOURCE.filter(
          (f) => f !== svc.file && f !== NOT_A_CALLER && called.test(readFileSync(f, "utf8")),
        );

        expect(
          callers,
          `${svc.entry} is exported and tested but NOTHING in src/ calls it. ` +
            `A poster nobody can reach is not a feature, it is a defect with ` +
            `good test coverage -- see D-70, which is exactly this.`,
        ).not.toHaveLength(0);
      });
    });
  }
});

describe("the bank expense door specifically (D-70)", () => {
  const ACTION = "src/app/admin/books/bank/actions.ts";
  const PAGE = "src/app/admin/books/bank/page.tsx";
  const PANEL = "src/components/admin/books/RecordBankExpensesPanel.tsx";

  it("the server action calls the service", () => {
    expect(/\brecordBankExpenses\s*\(/.test(readFileSync(ACTION, "utf8"))).toBe(true);
  });

  it("the server action gates on books access BEFORE reading anything", () => {
    const src = readFileSync(ACTION, "utf8");
    const gate = src.indexOf("requireBooksAccess(");
    const call = src.indexOf("recordBankExpenses(");
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    // Ordering, not mere presence: a gate that runs after the write is a gate
    // that logs the break-in.
    expect(gate).toBeLessThan(call);
  });

  it("the server action records an audit entry for the run", () => {
    expect(readFileSync(ACTION, "utf8")).toContain("books.bank_expenses.recorded");
  });

  it("refuses a blank account instead of scanning everything", () => {
    const src = readFileSync(ACTION, "utf8");
    expect(src).toContain('accountId === ""');
    expect(src).toContain("nothing was read and nothing was written");
  });

  it("the page renders the panel, not just imports it", () => {
    // An unused import is how the classifier sat finished and unreachable for
    // two slices. Assert the ELEMENT.
    expect(/<RecordBankExpensesPanel\s/.test(readFileSync(PAGE, "utf8"))).toBe(true);
  });

  it("the page computes `postable` from the engine's own map, not a copied list", () => {
    const src = readFileSync(PAGE, "utf8");
    expect(src).toContain("ROLE_TO_CASH_ACCOUNT");
    // A hand-written role list on the screen is a second source of truth that
    // drifts the moment a role is added to bank-expense-core.
    expect(src).not.toMatch(/role === "main"\s*\|\|/);
  });

  it("the panel shows refusals, and shows them before the successes", () => {
    const src = readFileSync(PANEL, "utf8");
    expect(src).toContain('o.kind === "refused"');
    const refusals = src.indexOf("Not filed \u2014 these need you");
    const filed = src.indexOf("Filed as drafts");
    expect(refusals).toBeGreaterThan(-1);
    expect(filed).toBeGreaterThan(-1);
    expect(refusals).toBeLessThan(filed);
  });

  it("the panel sends the owner to the approvals screen, because nothing posted here", () => {
    expect(readFileSync(PANEL, "utf8")).toContain("/admin/books/drafts");
  });
});

describe("the ATM settlement door specifically (D-40)", () => {
  const SERVICE = "src/lib/atm/atm-settlement-service.ts";
  const ACTION = "src/app/admin/atm/actions.ts";
  const PAGE = "src/app/admin/atm/page.tsx";
  const PANEL = "src/components/admin/atm/PostAtmSettlementsPanel.tsx";

  it("the service submits through the ledger door, not by writing rows itself", () => {
    const src = readFileSync(SERVICE, "utf8");
    expect(/\bawait submitJournal\(/.test(src)).toBe(true);
    // A direct table write would bypass every check in migration 0172.
    expect(src).not.toContain('.from("gl_journals")');
    expect(src).not.toContain('.from("gl_journal_lines")');
  });

  it("posts as sourceKind 'atm', because 10300 is a control account", () => {
    // 0172 check (6) refuses a 'manual' journal touching a control account. The
    // constant is read from the core rather than retyped, so the two cannot
    // drift into different answers.
    const src = readFileSync(SERVICE, "utf8");
    expect(src).toContain("sourceKind: ATM_SOURCE_KIND");
    expect(src).toContain('from "@/lib/atm/atm-posting-core"');
  });

  it("never auto-posts, so every settled day lands as a draft for review", () => {
    // Every proposal carries postable:false — a person reconciles the ATM
    // against a physical count. Creating the draft is the ask; posting is not.
    expect(readFileSync(SERVICE, "utf8")).not.toContain("autoPost: true");
  });

  it("invents no account codes of its own", () => {
    // All accounting judgment belongs to atm-posting-core. A literal account
    // code appearing here would be a second source of truth.
    const src = readFileSync(SERVICE, "utf8");
    const body = src.slice(src.indexOf("export type AtmPostOutcome"));
    expect(body).not.toMatch(/["']1030\d["']/);
    expect(body).not.toMatch(/["']51000["']/);
  });

  it("reports a failed read as an error, never as zero days (rule 46)", () => {
    const src = readFileSync(SERVICE, "utf8");
    expect(src).toContain("could not be read, so nothing was written");
  });

  it("the action gates on BOOKS access, not the page's finances.view", () => {
    const src = readFileSync(ACTION, "utf8");
    const gate = src.indexOf("await requireBooksAccess()");
    const call = src.indexOf("await postAtmSettlements()");
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    // Ordering, not mere presence: a gate after the write logs the break-in.
    expect(gate).toBeLessThan(call);
  });

  it("the action audits the run", () => {
    expect(readFileSync(ACTION, "utf8")).toContain("books.atm_settlements.filed");
  });

  it("the page renders the panel, not merely imports it", () => {
    expect(/<PostAtmSettlementsPanel\s*\/>/.test(readFileSync(PAGE, "utf8"))).toBe(true);
  });

  it("the panel shows refusals before successes and sends the owner to approvals", () => {
    const src = readFileSync(PANEL, "utf8");
    const refused = src.indexOf("Not filed \u2014 these need you");
    const filed = src.indexOf("Filed as drafts");
    expect(refused).toBeGreaterThan(-1);
    expect(filed).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(filed);
    expect(src).toContain("/admin/books/drafts");
  });
});
