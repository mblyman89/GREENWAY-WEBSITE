/**
 * tests/compliance/wage-order-entry-form.test.ts   (books-38)
 *
 * THE GATE OVER THE ENTRY FORM AND THE PAGE THAT HOSTS IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CAN GO WRONG ON A SCREEN, THAT NO ENGINE TEST WILL EVER CATCH
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `wage-order-entry-core.ts` refuses correctly, and every refusal is
 * mutation-tested. That proof covers none of the following, all of which are
 * screen-level and all of which are silent:
 *
 *   - A FIELD THAT IS NOT ON THE FORM. The engine can refuse on `servedDate`
 *     all it likes; if there is no served-date input, Michael can never satisfy
 *     it, and the order can never be entered. A missing input is invisible -
 *     nothing errors, the field simply is not there.
 *
 *   - THE FORM VALIDATING BY ITS OWN RULES. A second copy of the rules in the
 *     browser will eventually disagree with the server's, and the disagreement
 *     shows up either as a form that blocks a valid order or one that accepts
 *     an invalid one.
 *
 *   - A CHECKBOX WHERE A TRI-STATE BELONGS. This is the expensive one. An
 *     unticked checkbox sends `false`, which on a support order means "does not
 *     support a second family" - and that is a ten percentage point difference
 *     in the ceiling. The engine can only refuse an unknown answer if the form
 *     is capable of SENDING an unknown answer.
 *
 *   - A DISABLED SAVE BUTTON. A button disabled by client-side validation that
 *     is wrong leaves somebody unable to enter a valid court order with no
 *     explanation - the exact Sage behaviour Michael objected to.
 *
 *   - node:fs REACHING A CLIENT BUNDLE (rule 65b). This broke every deployment
 *     in books-33 while CI stayed green.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SOURCE-LEVEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There is no DOM renderer in this suite and adding one to check that an input
 * exists would test the renderer. The properties above are structural. Comments
 * are stripped first, so prose describing a rule cannot satisfy a test looking
 * for the rule implemented.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EMPTY_WAGE_ORDER_DRAFT } from "@/lib/payroll/wage-order-entry-core";
import { JUDGEMENT_FIELD_LESSONS } from "@/lib/payroll/wage-order-entry-mentor";

const ROOT = join(__dirname, "..", "..");
const FORM_PATH = join(ROOT, "src", "components", "admin", "books", "WageOrderEntryForm.tsx");
const PAGE_PATH = join(ROOT, "src", "app", "admin", "books", "garnishments", "page.tsx");

const formSrc = readFileSync(FORM_PATH, "utf8");
const pageSrc = readFileSync(PAGE_PATH, "utf8");

function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const formCode = stripComments(formSrc);
const pageCode = stripComments(pageSrc);

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD THE GUARD (rule 39)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the comment stripper works on TSX", () => {
  it("removes prose, including JSX comment blocks, and keeps the markup", () => {
    expect(formCode.length).toBeGreaterThan(2000);
    expect(formSrc).toContain("WHY THE SUPPORT BOOLEANS ARE THREE RADIO BUTTONS");
    expect(formCode).not.toContain("WHY THE SUPPORT BOOLEANS ARE THREE RADIO BUTTONS");
    expect(formCode).toContain("export function WageOrderEntryForm");

    // A JSX comment is a different syntax and the stripper must handle it, or
    // the "button is never disabled" test below would pass off the comment
    // that explains why it is never disabled.
    expect(formSrc).toContain("The button is NEVER disabled on validation");
    expect(formCode).not.toContain("The button is NEVER disabled on validation");
  });

  it("strips the page without emptying it", () => {
    expect(pageCode).toContain("export default async function GarnishmentsPage");
    expect(pageSrc).toContain("dead code wearing a green check");
    expect(pageCode).not.toContain("dead code wearing a green check");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * EVERY FIELD THE ENGINE NEEDS IS ACTUALLY ON THE FORM
 * ══════════════════════════════════════════════════════════════════════════ */

describe("no field the engine requires is missing from the form", () => {
  /**
   * Derived from `EMPTY_WAGE_ORDER_DRAFT` - the real runtime object - not from
   * a list typed here. A field added to the draft without an input is exactly
   * the defect this catches, and a hand-typed list would pass forever
   * afterwards (rule 50).
   */
  it("every draft field is bound to a control", () => {
    const fields = Object.keys(EMPTY_WAGE_ORDER_DRAFT);
    expect(fields.length).toBeGreaterThan(15);

    const missing = fields.filter((f) => !formCode.includes(`draft.${f}`));
    expect(missing).toEqual([]);
  });

  it("every draft field is WRITABLE, not just displayed", () => {
    // Reading `draft.x` into a value prop while never calling `set("x", ...)`
    // produces a control that renders, accepts keystrokes visually, and
    // discards every one of them.
    const fields = Object.keys(EMPTY_WAGE_ORDER_DRAFT);
    const unwritable = fields.filter((f) => !formCode.includes(`set("${f}"`));
    expect(unwritable).toEqual([]);
  });

  it("servedDate specifically has its own input, separate from orderDate", () => {
    // The whole reason migration 0201 exists. These are two different dates and
    // a form with one box for both makes every deadline wrong.
    expect(formCode).toContain('draft.servedDate');
    expect(formCode).toContain('draft.orderDate');
    expect(formCode).toContain('set("servedDate"');
    expect(formCode).toContain('set("orderDate"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE TRI-STATE IS A TRI-STATE
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the two ceiling questions can express 'not established yet'", () => {
  it("they are radio groups, not checkboxes", () => {
    // A checkbox cannot send null. An unticked one sends false, which means
    // "no second family" and moves the ceiling by ten points.
    expect(formCode).toContain("function TriState");
    expect(formCode).toMatch(/type="radio"/);

    const triBlock = formCode.slice(
      formCode.indexOf("function TriState"),
      formCode.indexOf("function FieldErrors"),
    );
    expect(triBlock.length).toBeGreaterThan(200);
    expect(triBlock).not.toMatch(/type="checkbox"/);
  });

  it("null is one of the three options and carries a real label", () => {
    expect(formCode).toContain("{ v: null,");
    expect(formCode).toContain("Not established yet");
  });

  it("the control's value type is boolean|null, so a string can never be sent", () => {
    expect(formCode).toMatch(/value:\s*boolean\s*\|\s*null;/);
    expect(formCode).toMatch(/onChange:\s*\(v:\s*boolean\s*\|\s*null\)/);
  });

  it("the draft starts with both answers unset", () => {
    // If the initial state said false, the form would be sending a confident
    // wrong answer for every order until somebody happened to change it.
    expect(EMPTY_WAGE_ORDER_DRAFT.supportsSecondFamily).toBeNull();
    expect(EMPTY_WAGE_ORDER_DRAFT.arrearsOverTwelveWeeks).toBeNull();
  });

  it("neither answer is coerced anywhere in the form", () => {
    expect(formCode).not.toMatch(/supportsSecondFamily[^,\n]*(\?\?|\|\|)\s*false/);
    expect(formCode).not.toMatch(/arrearsOverTwelveWeeks[^,\n]*(\?\?|\|\|)\s*false/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ONE SET OF RULES
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the form does not invent validation of its own", () => {
  it("it calls the same pure validator the server calls", () => {
    expect(formCode).toContain("validateWageOrderDraft");
  });

  it("it does not reimplement the parsing rules", () => {
    // Any of these in the component means a second, untested copy of a rule
    // that already exists in the engine.
    expect(formCode).not.toContain("parseMoneyToCents(");
    expect(formCode).not.toContain("parsePercentToBasisPoints(");
    expect(formCode).not.toMatch(/\*\s*100\b/);
    expect(formCode).not.toMatch(/\/\s*26\b/);
  });

  it("the save button is NEVER disabled by client-side validation", () => {
    // Disabled only while a submit is in flight, which prevents a double POST.
    // Disabling it on validation would mean a wrong client rule silently
    // prevents a real court order from being recorded.
    expect(formCode).toContain("disabled={submitting}");
    expect(formCode).not.toMatch(/disabled=\{[^}]*validation/);
    expect(formCode).not.toMatch(/disabled=\{[^}]*!validation\.ok/);
  });

  it("the client duplicate list is empty and the server reads the real one", () => {
    // The browser has no trustworthy duplicate list. Pretending otherwise
    // would either block a valid order or approve a duplicate.
    expect(formCode).toMatch(/validateWageOrderDraft\(draft,\s*\[\]\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE TEACHING IS ON THE SCREEN
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the mentor content actually reaches the form", () => {
  it("the form renders the field lessons, not a copy of them", () => {
    expect(formCode).toContain("JUDGEMENT_FIELD_LESSONS");
    expect(formCode).toContain("whereOnThePaper");
    expect(formCode).toContain("theTrap");
    expect(formCode).toContain("lesson.example");
  });

  it("the refusal lessons are shown beside the refusal, not just the code", () => {
    // Rule 64a. A refusal that names what is missing is detection; the lesson
    // is the explanation, and this is the one domain where the employer is
    // personally liable for working around a refusal.
    expect(formCode).toContain("WAGE_ORDER_ENTRY_REFUSAL_LESSONS");
    expect(formCode).toContain("whatToDo");
  });

  it("the ten-step walkthrough is reachable from the form", () => {
    expect(formCode).toContain("WAGE_ORDER_ENTRY_WALKTHROUGH");
  });

  it("the two silent-money lessons are open by default", () => {
    // Both mistakes look reasonable on screen and are expensive: a monthly
    // figure in a per-period box, and 25 where 2500 belongs.
    expect(formCode).toContain("LESSONS_OPEN_BY_DEFAULT");
    expect(formCode).toMatch(/LESSONS_OPEN_BY_DEFAULT[\s\S]{0,120}fixedAmountText/);
    expect(formCode).toMatch(/LESSONS_OPEN_BY_DEFAULT[\s\S]{0,120}percentText/);
  });

  it("every field with a lesson has that lesson wired to a control", () => {
    // A lesson that exists but is never rendered is rule 50 again, at the
    // screen layer.
    const taught = JUDGEMENT_FIELD_LESSONS.map((l) => l.draftField);
    expect(taught.length).toBeGreaterThan(10);
    const unrendered = taught.filter((f) => !formCode.includes(`field="${f}"`));
    expect(unrendered).toEqual([]);
  });

  it("the answer deadline is computed by the engine and shown", () => {
    // The single most useful thing on the screen, and the reason the served
    // date is asked for at all.
    expect(formCode).toContain("answerDeadlineFor");
    expect(formCode).toContain("deadline.explanation");
  });

  it("the deadline uses PACIFIC today, not UTC", () => {
    // Greenway is in Port Orchard. A UTC "today" is tomorrow for the last
    // sixteen hours of every day here, which reports every deadline as one day
    // nearer than it is.
    expect(formCode).toContain("pacificDayKey");
    expect(formCode).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 65b - NOTHING NODE-ONLY REACHES THE BROWSER
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the client component pulls nothing node-only into the bundle", () => {
  /*
   * WHY THESE CHECKS RUN ON STRIPPED CODE AND NOT ON RAW SOURCE
   *
   * The first version of this gate read the raw file. It then failed on the
   * entry core and on the form itself - both of which merely MENTION the words
   * `import "server-only"` inside a comment explaining why the shared type is
   * not allowed to live in the server module.
   *
   * That is a false positive, and a false positive in a safety gate is worse
   * than no gate: the next person makes it pass by deleting the explanation.
   * A comment cannot make a module server-only, and equally a comment saying
   * "we never import node:fs" must never be able to SATISFY the check. Both
   * directions are wrong for the same reason, so the check looks at code only.
   */
  const nodeOnly = (code: string) => /from\s+"node:/.test(code) || /require\(\s*"node:/.test(code);
  const serverOnly = (code: string) => /import\s+"server-only"/.test(code);

  it("the stripper does not defang the check itself (rule 39)", () => {
    // If stripComments were over-eager it would delete real imports and every
    // assertion below would pass vacuously. Prove it removes prose and keeps
    // code, on strings whose answer is known.
    expect(nodeOnly(stripComments('import { x } from "node:fs";'))).toBe(true);
    expect(nodeOnly(stripComments('// we never import from "node:fs" here'))).toBe(false);
    expect(serverOnly(stripComments('import "server-only";'))).toBe(true);
    expect(serverOnly(stripComments('/* the store is `import "server-only"` */'))).toBe(false);
  });

  it("the form itself imports no node module and no server-only module", () => {
    expect(formSrc).toMatch(/^"use client";/);
    expect(nodeOnly(formCode)).toBe(false);
    expect(serverOnly(formCode)).toBe(false);
    // These two are checked as CODE as well: importing the write store would
    // drag the Supabase service key into the browser, and importing the
    // mentor-gates module would drag node:fs in behind it.
    expect(formCode).not.toContain("wage-order-write-store");
    expect(formCode).not.toContain("mentor-gates");
  });

  it("every module the form imports is itself node-free, transitively checked", () => {
    // Checking the form alone is not enough - books-33's outage came from a
    // module the client imported which imported node:fs two levels down.
    const imports = [...formCode.matchAll(/from\s+"@\/([^"]+)"/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(2);

    const resolve = (rel: string) => {
      const candidates = [
        join(ROOT, "src", `${rel}.ts`),
        join(ROOT, "src", `${rel}.tsx`),
        join(ROOT, "src", rel, "index.ts"),
        join(ROOT, "src", rel, "index.tsx"),
      ];
      for (const p of candidates) {
        try {
          return { path: p, src: readFileSync(p, "utf8") };
        } catch {
          /* try the next candidate */
        }
      }
      return null;
    };

    // Walk the whole reachable graph, not just one level. The comment on the
    // old version promised "transitively" and the loop only ever went one
    // deep, which is standing rule 64a: the claim outran the check.
    const seen = new Set<string>();
    const queue = [...imports];
    let visited = 0;

    while (queue.length > 0) {
      const rel = queue.shift()!;
      if (seen.has(rel)) continue;
      seen.add(rel);

      const found = resolve(rel);
      expect(found, `could not resolve import @/${rel}`).toBeTruthy();
      const code = stripComments(found!.src);
      visited += 1;

      expect(nodeOnly(code), `@/${rel} imports a node module`).toBe(false);
      expect(serverOnly(code), `@/${rel} is server-only`).toBe(false);

      for (const next of [...code.matchAll(/from\s+"@\/([^"]+)"/g)].map((m) => m[1])) {
        if (!seen.has(next)) queue.push(next);
      }
    }

    // The walk must have actually walked. A resolver that silently returned
    // nothing would make every assertion above vacuous.
    expect(visited).toBeGreaterThanOrEqual(imports.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE PAGE WIRING (rule 16 - prove the thing is REACHABLE)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the form is actually on the page a human can reach", () => {
  it("the existing garnishments page renders it - no new route was created", () => {
    // Rule 25. Entering an order and seeing the orders that exist are the same
    // job. Splitting them across two screens is how a duplicate gets entered:
    // you cannot see the order is already there from the page where you are
    // typing it in.
    //
    // ── WHY THIS ASSERTS ON THE JSX TAG AND NOT ON THE NAME ────────────────
    //
    // The first version of this test was `expect(pageCode).toContain(
    // "WageOrderEntryForm")`. Mutation 4 of the phase F battery deleted the
    // rendered element from the page - leaving Michael with no way to enter an
    // order, which is the entire defect this slice exists to fix - and this
    // test STAYED GREEN. The bare `import { WageOrderEntryForm }` line at the
    // top of the file was enough to satisfy `toContain`.
    //
    // An import is not a render. That is standing rule 50 in one line: the
    // most important gate in the slice was dead code wearing a green check.
    // The check now requires the component to be USED as an element, and to
    // be handed both of the things it cannot work without.
    expect(pageCode, "the component must be RENDERED, not merely imported")
      .toMatch(/<WageOrderEntryForm[\s>]/);
    expect(pageCode).toMatch(/employees=\{/);
    expect(pageCode).toMatch(/onSubmit=\{createWageOrderAction\}/);
  });

  it("the render check cannot be satisfied by an import alone (rule 39)", () => {
    // Guard the guard. If the regex above were loose enough to match the
    // import statement again, the previous test would silently go back to
    // proving nothing. These are the two strings whose answers are known.
    const tag = /<WageOrderEntryForm[\s>]/;
    expect(tag.test('import { WageOrderEntryForm } from "@/components/x";')).toBe(false);
    expect(tag.test("<WageOrderEntryForm employees={x} />")).toBe(true);
  });

  it("the page supplies a real employee list, read on the server", () => {
    expect(pageCode).toContain("listEmployeesForOrderEntry");
  });

  it("a failed employee read is reported as a failure, not an empty dropdown", () => {
    // An empty dropdown says "this employer has no employees", which is a
    // different and untrue statement (rule 39).
    expect(pageCode).toMatch(/!employees\.ok/);
    expect(pageCode).toContain("employees.message");
  });

  it("a board failure does not suppress the entry form", () => {
    // A court order that has been served must be recordable whether or not the
    // list is rendering. The two reads are independent.
    const formAt = pageCode.indexOf("WageOrderEntryForm");
    const boardFailAt = pageCode.indexOf("!board.ok");
    expect(formAt).toBeGreaterThan(-1);
    expect(boardFailAt).toBeGreaterThan(-1);
    // The form is rendered BEFORE the board's success/failure branch, so it is
    // outside it.
    expect(formAt).toBeLessThan(boardFailAt);
  });

  it("the page still gates on requireBooksAccess before reading anything", () => {
    const gateAt = pageCode.indexOf("requireBooksAccess()");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(pageCode.indexOf("loadGarnishmentBoard()"));
    expect(gateAt).toBeLessThan(pageCode.indexOf("listEmployeesForOrderEntry()"));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE THREE DEFECTS THIS SUITE MISSED THE FIRST TIME
 *
 * Everything above passed on the first run. Three real defects were sitting
 * underneath a green suite anyway, which is standing rule 50 in its purest
 * form - dead certainty wearing a green check. Each is now gated, because a
 * defect that was found by reading and fixed without a gate will come back.
 * ═══════════════════════════════════════════════════════════════════════════ */

const STORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-write-store.ts");
const CORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-entry-core.ts");
const GLOBALS_PATH = join(ROOT, "src", "app", "globals.css");

const storeSrc = readFileSync(STORE_PATH, "utf8");
const coreSrc = readFileSync(CORE_PATH, "utf8");
const storeCode = stripComments(storeSrc);
const coreCode = stripComments(coreSrc);

describe("DEFECT 1: EmployeeChoice was declared in two places at once", () => {
  /*
   * The form declared `export type EmployeeChoice = {id, name}` and the store
   * declared an identical one. Both compiled. Neither imported the other, so
   * adding a field to one would leave the other silently meaning something
   * different - the exact drift standing rule 25 exists to prevent, and it
   * cannot be caught by tsc because structural typing says the two match.
   */
  it("exactly one module DECLARES EmployeeChoice, and it is the pure core", () => {
    const declares = (src: string) => /(?:^|\n)\s*export type EmployeeChoice\s*=\s*\{/.test(src);
    expect(declares(coreCode), "the pure core must declare it").toBe(true);
    expect(declares(storeCode), "the store must re-export, not redeclare").toBe(false);
    expect(declares(formCode), "the form must import, not redeclare").toBe(false);
  });

  it("the form and the store both get the type from that one place", () => {
    expect(formCode).toMatch(/type EmployeeChoice/);
    expect(formCode).toContain("wage-order-entry-core");
    expect(storeCode).toMatch(/type EmployeeChoice/);
    expect(storeCode).toContain("./wage-order-entry-core");
  });

  it("the declaration is in a module the CLIENT can legally import (rule 65b)", () => {
    // This is why it cannot live in the store. If somebody "tidies" the type
    // back into wage-order-write-store.ts, the form's import drags the
    // server-only marker and the Supabase admin client into the browser bundle
    // and the build dies.
    //
    // Checked against stripped CODE, not raw source: this very file explains
    // the hazard in prose, and prose naming a forbidden import must not be
    // able to fail a gate (see the rule-65b block above for the full reason).
    expect(coreCode).not.toMatch(/import\s+"server-only"/);
    expect(coreCode).not.toMatch(/from\s+"node:/);
    // ...and the store genuinely IS server-only, which is the other half of
    // why the type had to move. Without this the test above could pass simply
    // because nothing anywhere is server-only.
    expect(stripComments(storeSrc)).toMatch(/import\s+"server-only"/);
  });
});

describe("DEFECT 2: former employees must be selectable, not filtered away", () => {
  /*
   * The picker read `select("id, full_name")` with no `active` handling. The
   * obvious "improvement" is `.eq("active", true)`. That is a LEGAL defect:
   *
   *   RCW 26.18.110(1) - the sworn answer must state "whether the obligor is
   *   employed by or receives earnings or other remuneration from the
   *   employer". The statute contemplates the answer being NO.
   *
   *   RCW 6.27.200 - a writ that goes unanswered can produce judgment against
   *   GREENWAY for the employee's entire underlying debt.
   *
   * If the name is not in the dropdown, the natural reading is "not our
   * problem" and the writ goes unanswered. Plus a former employee may still
   * have a final paycheck, and those earned wages ARE subject to the order.
   */
  it("the employee query never filters on active", () => {
    const picker = storeCode.slice(storeCode.indexOf("listEmployeesForOrderEntry"));
    const body = picker.slice(0, picker.indexOf("\n}"));
    expect(body).toContain('from("employees")');
    expect(body, "filtering out former employees hides writs that must be answered")
      .not.toMatch(/\.eq\(\s*["']active["']\s*,\s*true\s*\)/);
    expect(body).not.toMatch(/\.filter\([^)]*active/);
    expect(body).not.toMatch(/\.is\(\s*["']active["']/);
  });

  it("the query actually reads the active column so the form can label it", () => {
    // Rule 64a: detecting that we must not filter is not the same as carrying
    // the fact through to where Michael can see it.
    expect(storeCode).toMatch(/select\(\s*["']id,\s*full_name,\s*active["']\s*\)/);
    expect(storeCode).toMatch(/active:\s*r\.active !== false/);
  });

  it("the form labels an inactive employee in the dropdown", () => {
    expect(formCode).toContain("no longer employed");
    expect(formCode).toMatch(/emp\.active\s*\?/);
  });

  it("choosing a former employee explains what to put on the sworn answer", () => {
    expect(formCode).toMatch(/chosen\s*&&\s*!chosen\.active/);
    // The advice must survive; a bare "this person left" label is not guidance.
    expect(formSrc).toContain("26.18.110(1)");
    expect(formSrc).toContain("6.27.200");
    // Collapsed whitespace: this sentence is JSX prose and the line breaks
    // fall wherever the formatter puts them. Asserting on the raw text made
    // the gate a hostage to line wrapping rather than to meaning.
    const flat = formSrc.replace(/\s+/g, " ");
    expect(flat).toContain("final paycheck");
    expect(flat).toContain("earned wages ARE subject to the order");
  });

  it("the store records WHY the obvious filter is absent", () => {
    // Rule 63d: the next person to read this will want to add `.eq("active",
    // true)` as a tidy-up. The reason it is missing has to be at the site.
    const why = storeSrc.slice(
      storeSrc.indexOf("WHY INACTIVE EMPLOYEES ARE LISTED"),
      storeSrc.indexOf("export async function listEmployeesForOrderEntry"),
    );
    expect(why.length).toBeGreaterThan(400);
    expect(why).toContain("26.18.110(1)");
    expect(why).toContain("6.27.200");
  });
});

describe("DEFECT 3: a CSS variable that does not exist renders as nothing", () => {
  /*
   * The former-employee warning was first written with
   * `border-[var(--admin-warning)] bg-[var(--admin-warning-bg)]`. Neither
   * token exists. Tailwind emits the class, the browser cannot resolve the
   * variable, and the result is an unstyled block - a legal warning rendered
   * invisible. tsc cannot see this and no test was looking, so it would have
   * shipped.
   *
   * Rule 23: gate the CLASS. Every --admin-* token used anywhere in this
   * feature's files must be defined in globals.css.
   */
  const declared = new Set(
    [...readFileSync(GLOBALS_PATH, "utf8").matchAll(/(--admin-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );

  it("globals.css was actually parsed (rule 39 - guard the vacuous read)", () => {
    expect(declared.size).toBeGreaterThan(10);
    expect(declared.has("--admin-orange")).toBe(true);
  });

  for (const [label, src] of [
    ["the entry form", formSrc],
    ["the garnishments page", pageSrc],
  ] as const) {
    it(`every --admin-* token used by ${label} is defined in globals.css`, () => {
      const used = [...src.matchAll(/var\((--admin-[a-z0-9-]+)\)/g)].map((m) => m[1]);
      expect(used.length, `${label} uses no design tokens at all - check the regex`)
        .toBeGreaterThan(3);
      const undefinedTokens = [...new Set(used)].filter((t) => !declared.has(t));
      expect(undefinedTokens, `${label} uses tokens that do not exist`).toEqual([]);
    });
  }
});
