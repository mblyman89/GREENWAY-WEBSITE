/**
 * tests/compliance/company-information-wiring.test.ts   (slice books-31)
 *
 * PROVES THE COMPANY INFORMATION SCREEN IS REACHABLE, GATED, AND COMPLETE.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ENGINE TESTS
 *
 * `company-identity-core.test.ts` proves the engine computes the right answers.
 * It does not prove that anything CALLS the engine. Standing rule 50, learned
 * the hard way in books-23: a module that only its own test imports is dead
 * code wearing a green check mark. The inventory audit store was 767 lines of
 * mutation-tested, entirely unreachable code for eleven slices, and every test
 * was green the whole time.
 *
 * So this file asks different questions. Is the page in the navigation? Does it
 * call the access gate? Does the form render every field the engine declares,
 * or does a field silently exist with no input attached to it? Does the save
 * path go through the store rather than touching the table directly?
 *
 * WHY IT READS SOURCE TEXT RATHER THAN IMPORTING
 *
 * These are Next.js server components and server actions. They import
 * "server-only", the Supabase admin client and next/cache, so importing them
 * into a node unit test is not possible. Reading their source is the available
 * technique, and it is the same one the inventory-audit wiring test uses.
 *
 * Standing rules exercised: 16 (prove the gate is WIRED), 39 (guard vacuous
 * reads), 50 (unreachable code is dead code), 62 (build for the slice after
 * next).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMPANY_FIELDS } from "@/lib/accounting/company-identity-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const REPO = process.cwd();

const PAGE = join(REPO, "src", "app", "admin", "books", "company", "page.tsx");
const ACTIONS = join(REPO, "src", "app", "admin", "books", "company", "actions.ts");
const FORM = join(REPO, "src", "components", "admin", "books", "CompanyInformationForm.tsx");
const STORE = join(REPO, "src", "lib", "accounting", "company-profile-store.ts");

function read(p: string): string {
  const text = readFileSync(p, "utf8");
  // Rule 39: every assertion below is a substring search, and every substring
  // search succeeds trivially against a file that failed to load.
  if (text.length < 500) throw new Error(`${p} is suspiciously small (${text.length} bytes)`);
  return text;
}

describe("the screen exists and can be reached", () => {
  it("is registered in the admin navigation", () => {
    const item = adminNav.find((i) => i.href === "/admin/books/company");
    expect(item, "the company information page must be in adminNav or nobody can find it").toBeDefined();
    expect(item?.group).toBe("Accounting");
  });

  it("is gated on books.view like every other books screen", () => {
    // Not reports.view. That permission also grants manager and readonly, who
    // would see the link and then hit a raw database refusal.
    const item = adminNav.find((i) => i.href === "/admin/books/company");
    expect(item?.permission).toBe("books.view");
  });

  it("has a page, an action, a form and a store", () => {
    for (const p of [PAGE, ACTIONS, FORM, STORE]) {
      expect(() => read(p), `${p} must exist`).not.toThrow();
    }
  });
});

describe("the owner-only gate is called on every path in", () => {
  /**
   * THE GATE THAT MATTERS HERE IS CODE, NOT SQL. The store uses
   * createSupabaseAdminClient(), which runs as the service role and ignores
   * both the RLS policies and the column privileges that migration 0196
   * carefully sets up. So `requireBooksAccess()` is the entire protection on
   * this path, and it has to be called in both places.
   */
  it("the page calls requireBooksAccess before reading anything", () => {
    const src = read(PAGE);
    expect(src).toContain("requireBooksAccess");
    const gateAt = src.indexOf("await requireBooksAccess()");
    const loadAt = src.indexOf("loadCompanyProfile(");
    expect(gateAt).toBeGreaterThan(-1);
    // The gate must come first in the function body, not after the read.
    expect(gateAt).toBeLessThan(loadAt);
  });

  it("the server action calls requireBooksAccess as well", () => {
    // The action is reachable without the page. A gate on the page alone would
    // be a lock on the front door of a building with an open loading dock.
    const src = read(ACTIONS);
    expect(src).toContain("await requireBooksAccess()");
    const gateAt = src.indexOf("await requireBooksAccess()");
    const saveAt = src.indexOf("saveCompanyProfile(");
    expect(gateAt).toBeLessThan(saveAt);
  });

  it("nothing in this slice writes company_profile outside the store", () => {
    // Rule 25: one door into the table. A second writer is how two screens
    // start disagreeing about the same company.
    for (const p of [PAGE, ACTIONS, FORM]) {
      const src = read(p);
      expect(src, `${p} must not query company_profile directly`).not.toContain('from("company_profile")');
    }
    expect(read(STORE)).toContain('from("company_profile")');
  });
});

describe("the engine is actually reached from the screen", () => {
  /**
   * Standing rule 50. The whole point.
   */
  it("the form imports the core engine rather than reimplementing it", () => {
    const src = read(FORM);
    expect(src).toContain("company-identity-core");
    expect(src).toContain("allFormReadiness");
    expect(src).toContain("COMPANY_FIELDS");
  });

  it("the form imports the mentor layer, so the guidance is on screen", () => {
    // Michael asked for a mentoring CPA on this screen by name. A mentor module
    // nothing renders would be the books-23 defect repeated with prose.
    const src = read(FORM);
    expect(src).toContain("company-identity-mentor");
    expect(src).toContain("COMPANY_FIELD_LESSONS");
    expect(src).toContain("COMPANY_SCREEN_LESSONS");
    expect(src).toContain("explainFormNeeds");
  });

  it("the form renders the verbatim quote and the plain-English reading", () => {
    // Both halves of what Michael asked for: "verbatim authoritative source
    // documents to cite it as well as plain English interpretations".
    const src = read(FORM);
    expect(src).toContain("COMPANY_IDENTITY_AUTHORITIES");
    expect(src).toContain("a.quote");
    expect(src).toContain("a.soWhat");
    expect(src).toContain("a.cite");
  });

  it("the store refuses a blank required value through requireField, not by guessing", () => {
    // The store deliberately allows a partial save; the refusal lives in
    // requireField at the moment a form builder needs the value. This asserts
    // the store documents that division rather than quietly inventing a
    // default of its own.
    const src = read(STORE);
    expect(src).toContain("requireField");
    expect(src).not.toMatch(/\|\|\s*"0{9}"/);
  });
});

describe("every field the engine declares has an input on the screen", () => {
  /**
   * THE FAILURE THIS PREVENTS. A field can be declared in COMPANY_FIELDS,
   * appear in every readiness check, block a form forever - and have no input
   * anywhere on the page. Michael would see "Form 941: Blocked, EIN missing"
   * with no box to type an EIN into. The form has a runtime guard for this too,
   * but a runtime guard only helps somebody already looking at the screen.
   */
  it("renders an input for all twenty fields", () => {
    const src = read(FORM);
    const missing = COMPANY_FIELDS.filter((f) => !src.includes(`"${f.field}"`)).map((f) => f.field);
    expect(missing).toEqual([]);
    // Rule 39: prove the list being checked is not empty.
    expect(COMPANY_FIELDS.length).toBeGreaterThan(0);
  });

  it("keeps a runtime guard for a field that is declared but never grouped", () => {
    const src = read(FORM);
    expect(src).toContain("ungrouped");
  });
});

describe("the ACH pipeline is connected, not merely mentioned", () => {
  /**
   * Michael's directive: "We have an ach payment setup, we need that connected
   * properly too so the full pipeline end to end works automatically with
   * simple validation steps for me to approve everything."
   *
   * Standing rule 63b says to find the feeder before building one. The feeder
   * here is `ach_company_settings`, which already exists, so the connection is
   * a comparison rather than a new table.
   */
  it("the store can compare the company EIN against the ACH immediate origin", () => {
    const src = read(STORE);
    expect(src).toContain("verifyAchAgreement");
    expect(src).toContain('from("ach_company_settings")');
    expect(src).toContain("immediate_origin");
  });

  it("the page surfaces a disagreement instead of hiding it", () => {
    const src = read(PAGE);
    expect(src).toContain("verifyAchAgreement");
    expect(src).toContain("ach.agrees");
  });

  it("reports 'not checked' rather than 'agrees' when either side is absent", () => {
    // Rule 48. An unconfigured ACH setup is not an agreeing ACH setup, and a
    // green tick against missing data is the most dangerous output available.
    const src = read(STORE);
    expect(src).toContain("checked: false");
    expect(src).toMatch(/has not been set up yet/);
  });
});
