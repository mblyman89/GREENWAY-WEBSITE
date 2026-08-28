/**
 * tests/compliance/logins-are-not-employees.test.ts
 *
 * A LOGIN IS NOT A JOB.
 *
 * books-87. Michael, verbatim:
 *
 *     "right now the system is using the users who have access to the back
 *      office app, which is not how I would like the system to behave. I want
 *      to be able to allow certain people to view or have access in some way
 *      with the back office, people who aren't necessarily employees. I would
 *      rather users be people who have access to the system, and be separate
 *      from employees. I want to create the employee in payroll/ W-4 setup,
 *      then I will give them access to the back office if they need access
 *      to it."
 *
 * WHAT THIS FILE IS DEFENDING, AND WHY IT IS NOT OBVIOUS
 *
 * The bug was not in the payroll code. It was poured in ONCE by
 * 0037_staffing_timeclock.sql:125-132, which copied every active row of
 * `staff_profiles` into `employees` so the new time clock would have people in
 * it on day one. Reasonable for a time clock. Wrong the moment those same rows
 * started answering "who do we pay?" (D-69).
 *
 * That shape - a one-line convenience in an old migration that silently becomes
 * a policy - is exactly the kind of thing that comes back, because the person
 * who reintroduces it will be solving the same day-one problem 0037 was. So the
 * tests below are not only "does the new code work". Several of them are
 * TRAPS: they read every migration and every server action on disk and fail if
 * the coupling is recreated anywhere, including in files that do not exist yet.
 *
 * Standing rule 13c: a test that cannot fail is worse than no test. Each block
 * below states what change would make it fail.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { normalisePersonName } from "@/lib/payroll/payroll-onboarding-store";

const REPO = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(REPO, "supabase/migrations");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

const M0210 = read("supabase/migrations/0210_separate_logins_from_employees.sql");
const STORE = read("src/lib/payroll/payroll-onboarding-store.ts");
const PAGE = read("src/app/admin/books/payroll-setup/page.tsx");
const FORM = read("src/components/admin/payroll/AddPersonToPayrollForm.tsx");
const SETUP_ACTIONS = read("src/app/admin/books/payroll-setup/actions.ts");
const STAFFING_ACTIONS = read("src/app/admin/staffing/actions.ts");
const USER_ACTIONS = read("src/app/admin/users/actions.ts");

/** Source with comments stripped, for claims about what the CODE does. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/^\s*--.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const STORE_CODE = codeOnly(STORE);
const M0210_CODE = codeOnly(M0210);

// ===========================================================================
describe("the comment strippers actually strip, or every scan below reads prose", () => {
  // Without this, a test asserting "the code does not contain X" would pass
  // merely because X was only ever mentioned in a comment - or worse, PASS a
  // "must contain" check on the strength of a comment that documents the
  // opposite of what the code does. This is the guard on the guards.
  it("strips, and leaves something behind", () => {
    expect(STORE_CODE.length).toBeLessThan(STORE.length);
    expect(STORE_CODE).not.toContain("/*");
    expect(STORE_CODE.trim().length).toBeGreaterThan(2000);

    expect(M0210_CODE.length).toBeLessThan(M0210.length);
    expect(M0210_CODE).toContain("create table if not exists public.employee_provisioning_policy");
    // The long "WHERE THE BEHAVIOUR ACTUALLY CAME FROM" header is gone.
    expect(M0210_CODE).not.toContain("STOP THE BLEEDING");
  });
});

// ===========================================================================
describe("normalisePersonName - the only pure thing on this path", () => {
  // It is small, but it is what decides whether "Jane  Doe" and "Jane Doe" are
  // the same person for the duplicate check below. Getting it wrong means two
  // W-2s for one human.
  it("collapses runs of whitespace and trims", () => {
    expect(normalisePersonName("  Jane   Q.  Doe ")).toBe("Jane Q. Doe");
    expect(normalisePersonName("Michael Lyman")).toBe("Michael Lyman");
  });

  it("treats tabs and newlines as whitespace, because a paste carries them", () => {
    expect(normalisePersonName("Jane\tDoe")).toBe("Jane Doe");
    expect(normalisePersonName("Jane\n Doe")).toBe("Jane Doe");
  });

  it("reduces a blank submission to the empty string, which is what the refusal keys on", () => {
    expect(normalisePersonName("   ")).toBe("");
    expect(normalisePersonName("")).toBe("");
    expect(normalisePersonName("\t\n ")).toBe("");
  });

  it("does NOT case-fold or strip punctuation, because a name is not a slug", () => {
    // "O'Brien-Smith, Jr." must survive intact: this string is printed on a W-2.
    expect(normalisePersonName("  O'Brien-Smith, Jr. ")).toBe("O'Brien-Smith, Jr.");
    expect(normalisePersonName("JANE DOE")).toBe("JANE DOE");
  });
});

// ===========================================================================
describe("addPersonToPayroll creates a person, and only a person", () => {
  // These are structural reads. The store imports the service-role client, so
  // exercising it live would mean mocking Supabase so completely that the test
  // asserted against my own mock (standing rule 39). What CAN be proved by
  // reading is the thing most likely to go wrong here: that the insert does not
  // quietly acquire a staff_id, and that every refusal says nothing was saved.
  const fnStart = STORE_CODE.indexOf("export async function addPersonToPayroll");
  const fnEnd = STORE_CODE.indexOf("\n}", STORE_CODE.indexOf("return { ok: true, employeeId }"));
  const FN = STORE_CODE.slice(fnStart, fnEnd);

  it("the function was actually located, or every assertion below is vacuous", () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    expect(FN).toContain('.from("employees")');
    expect(FN.length).toBeGreaterThan(400);
  });

  it("NEVER writes staff_id - this is the whole slice in one assertion", () => {
    // If someone 'helpfully' links the new employee to the creating user's
    // account, 0037's behaviour is back, just spelled differently.
    expect(FN).not.toContain("staff_id");
  });

  it("inserts an active, non-terminated person so they appear on the roster it just filtered", () => {
    expect(FN).toContain("active: true");
    expect(FN).toContain('employment_status: "active"');
  });

  it("refuses a blank name, a duplicate, an unconfigured database and a failed write", () => {
    for (const code of ["no_name", "duplicate", "not_configured", "write_failed"]) {
      expect(FN, `missing refusal: ${code}`).toContain(`code: "${code}"`);
    }
  });

  it("each refusal is reachable - the branch tests something, not `if (false)`", () => {
    // The mutation probe walked straight through the first draft of this file
    // by changing the blank-name guard to `if (false)`. The refusal text was
    // still there, so a "does the code contain no_name" test stayed green while
    // an empty name sailed into the employees table. Standing rule 43: an
    // unreachable refusal is decoration. Assert the CONDITION, not the message.
    expect(FN).toContain("const fullName = normalisePersonName(input.fullName);");
    expect(FN).toContain("if (fullName.length === 0)");
    expect(FN).not.toMatch(/if\s*\(\s*(false|0)\s*\)/);

    // ...and the name that is checked is the name that is inserted, or the
    // check guards a different string from the one that gets saved.
    const insert = FN.slice(FN.indexOf('.insert({'));
    expect(insert).toContain("full_name: fullName,");

    // The guard runs BEFORE the database is touched.
    expect(FN.indexOf("if (fullName.length === 0)")).toBeLessThan(
      FN.indexOf("createSupabaseAdminClient"),
    );
  });

  it("every refusal states that nothing happened, rather than going quiet", () => {
    // A refusal the user cannot distinguish from success is worse than a crash.
    const refusals = FN.split("ok: false,").slice(1);
    expect(refusals.length).toBe(4);
    for (const r of refusals) {
      const message = r.slice(0, 600).toLowerCase();
      expect(
        /nobody was added|nothing was saved/.test(message),
        `a refusal does not say nothing happened: ${r.slice(0, 120)}`,
      ).toBe(true);
    }
  });

  it("checks the database is configured BEFORE building a client", () => {
    const guard = FN.indexOf("isSupabaseServiceConfigured");
    const client = FN.indexOf("createSupabaseAdminClient");
    expect(guard).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(guard);
  });

  it("writes an audit row naming where the person came from", () => {
    expect(FN).toContain("recordAudit");
    expect(FN).toContain("employee.created.from_payroll_setup");
    // ...and only after the insert succeeded, so a failed write leaves no trace
    // claiming somebody was hired.
    expect(FN.indexOf("recordAudit")).toBeGreaterThan(FN.indexOf('code: "write_failed"'));
  });

  it("the duplicate check looks only at people currently on payroll", () => {
    // Otherwise re-hiring someone who left is impossible, and a quarantined
    // 0037 row would block a real person with the same name.
    const dup = FN.slice(0, FN.indexOf('code: "duplicate"'));
    expect(dup).toContain('.eq("active", true)');
    expect(dup).toContain('.neq("employment_status", "terminated")');
  });
});

// ===========================================================================
describe("the payroll roster and the SQL view state the same rule", () => {
  // This is the pin that stops drift. listEmployeeSetup writes the filter out
  // in longhand rather than selecting from the view, because it must keep
  // working on a database where 0210 has not been applied - selecting from a
  // missing view fails the entire read. Two copies of a rule need a test
  // holding them together, or they are two rules.
  it("migration 0210 defines employees_on_payroll as active and not terminated", () => {
    expect(M0210_CODE).toContain("create or replace view public.employees_on_payroll");
    const view = M0210_CODE.slice(M0210_CODE.indexOf("create or replace view public.employees_on_payroll"));
    expect(view).toContain("e.active = true");
    expect(view).toContain("coalesce(e.employment_status, 'active') <> 'terminated'");
  });

  it("listEmployeeSetup applies exactly that filter, in the same two clauses", () => {
    const fn = STORE_CODE.slice(
      STORE_CODE.indexOf("export async function listEmployeeSetup"),
      STORE_CODE.indexOf("export async function", STORE_CODE.indexOf("export async function listEmployeeSetup") + 10),
    );
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toContain('.eq("active", true)');
    expect(fn).toContain('.neq("employment_status", "terminated")');
  });
});

// ===========================================================================
describe("migration 0210 repairs without destroying", () => {
  it("deactivates rather than deletes, because employees.id is referenced by history", () => {
    // 0037 cascades shifts and time_punches on delete, and audit rows point at
    // employee ids. Tidying a roster is not worth destroying evidence.
    expect(M0210_CODE).toContain("update public.employees");
    expect(M0210_CODE).not.toMatch(/delete\s+from\s+public\.employees/i);
    expect(M0210_CODE).not.toMatch(/drop\s+table\s+public\.employees/i);
  });

  // 0210's quarantine has TWO branches: one for a database where 0195 has been
  // applied (and the payroll tables exist to check) and one for a database
  // where it has not. The first draft of these tests used `toContain` on the
  // whole file, and the mutation probe walked through three of them: breaking
  // ONE branch left the string present in the other, so the test stayed green
  // while half the migration was wrong. Both branches are now extracted and
  // asserted individually. This is the D-62 staleness shape - a check that
  // looks thorough but is satisfied by a copy of the thing it is checking.
  const UPDATES = (() => {
    const out: string[] = [];
    let at = M0210_CODE.indexOf("update public.employees");
    while (at !== -1) {
      out.push(M0210_CODE.slice(at, M0210_CODE.indexOf(";", at)));
      at = M0210_CODE.indexOf("update public.employees", at + 1);
    }
    return out;
  })();

  it("both quarantine branches were found, or the loop below asserts on nothing", () => {
    expect(UPDATES.length).toBe(2);
    for (const u of UPDATES) expect(u.length).toBeGreaterThan(300);
    // One branch checks the payroll tables; the other cannot, and says so.
    expect(UPDATES.filter((u) => u.includes("employee_w4")).length).toBe(1);
    expect(M0210_CODE).toContain("to_regclass('public.employee_w4')");
  });

  it("EVERY branch spells out its full discriminator", () => {
    // Each clause is a reason to KEEP a person. Dropping any of them widens the
    // update - and Michael himself is an employee WITH a login, so a
    // discriminator of merely 'has a staff_id' would terminate the owner.
    const always = ["e.staff_id is not null", "e.active = true", "e.hire_date is null", "time_punches", "shifts"];
    for (const u of UPDATES) {
      for (const clause of always) {
        expect(u, `a quarantine branch lost: ${clause}`).toContain(clause);
      }
    }
    // The payroll-aware branch additionally proves the person has no paperwork.
    const withPayroll = UPDATES.find((u) => u.includes("employee_w4"))!;
    for (const t of ["employee_w4", "employee_i9", "employee_pay"]) {
      expect(withPayroll, `discriminator lost its ${t} check`).toContain(t);
    }
  });

  it("EVERY branch fails safe: clauses are ANDed, never ORed", () => {
    // An OR here would quarantine anyone matching a SINGLE condition. The
    // difference between `and` and `or` in this one statement is the difference
    // between retiring a few stale rows and terminating the whole workforce.
    for (const u of UPDATES) {
      const where = u.slice(u.indexOf("where e.staff_id is not null"));
      expect(where.length).toBeGreaterThan(100);
      expect(where, "a quarantine branch contains an OR").not.toMatch(/\bor\b/i);
      expect((where.match(/\band\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
    }
  });

  it("EVERY branch says why, in the row itself, in words Michael can read later", () => {
    for (const u of UPDATES) {
      expect(u).toContain("termination_reason");
      expect(u).toContain("Not an employee.");
      // It must not overwrite a reason a human already wrote.
      expect(u, "a branch clobbers an existing termination reason").toContain(
        "coalesce(\n             nullif(e.termination_reason, ''),",
      );
    }
  });

  it("EVERY branch clears the clock PIN, so a retired row cannot punch in", () => {
    for (const u of UPDATES) {
      expect(u, "a quarantine branch leaves the clock PIN live").toContain("clock_pin          = null");
    }
  });

  it("EVERY branch retires the row rather than hiding it half-way", () => {
    for (const u of UPDATES) {
      expect(u).toContain("active             = false");
      expect(u).toContain("employment_status  = 'terminated'");
    }
  });

  it("BOTH ordering guards raise, rather than warn and carry on", () => {
    // Same trap as the branches above: there are two preconditions, and the
    // probe removed one while the other kept the test green.
    const guards = M0210_CODE.match(/raise exception[\s\S]*?;/g) ?? [];
    expect(guards.length).toBe(2);
    for (const g of guards) {
      expect(g).toContain("MIGRATION_OUT_OF_ORDER");
      expect(g).toContain("Nothing was changed.");
    }
    // One guard is about the table, the other about the column 0117 added.
    expect(guards.filter((g) => g.includes("employment_status")).length).toBe(1);
    expect(M0210_CODE).not.toMatch(/raise notice[\s\S]{0,80}MIGRATION_OUT_OF_ORDER/);

    // And it is inside a transaction, so a failure anywhere leaves nothing.
    expect(M0210_CODE).toContain("begin;");
    expect(M0210_CODE.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("records the retired policy so a fresh database cannot repeat 0037's seed", () => {
    expect(M0210_CODE).toContain("public.employee_provisioning_policy");
    expect(M0210_CODE).toContain("logins_create_employees boolean not null default false");
  });

  it("locks that record down: readable by managers, writable by nobody", () => {
    // A decision that can be flipped through the public API is a suggestion.
    expect(M0210_CODE).toContain("alter table public.employee_provisioning_policy enable row level security");
    expect(M0210_CODE).toContain("for select using (public.is_manager())");
    const policies = M0210_CODE.match(/create policy [\s\S]*?;/g) ?? [];
    expect(policies.length).toBe(1);
    expect(policies[0]).not.toMatch(/for (insert|update|delete|all)/i);
  });

  it("does not edit 0037, because a migration that has run is history", () => {
    const m0037 = read("supabase/migrations/0037_staffing_timeclock.sql");
    // The seed is still there, unchanged. If someone 'fixes' it in place, the
    // production database and a fresh one stop agreeing about what ran.
    expect(m0037).toContain("insert into public.employees (full_name, staff_id, job_role)");
  });
});

// ===========================================================================
describe("THE TRAP: nothing may recreate the coupling", () => {
  // These read the whole tree, so they cover files that do not exist yet. This
  // is the part that has to survive the next person solving 0037's problem.
  it("no migration after 0037 inserts into employees from staff_profiles", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      if (f.startsWith("0037_")) continue; // history, quarantined by 0210
      const body = codeOnly(readFileSync(path.join(MIGRATIONS, f), "utf8")).toLowerCase();
      const at = body.indexOf("insert into public.employees");
      if (at === -1) continue;
      // A seed is an insert that READS staff_profiles in the same statement.
      const stmt = body.slice(at, body.indexOf(";", at) + 1);
      if (stmt.includes("staff_profiles")) offenders.push(f);
    }
    expect(
      offenders,
      `these migrations seed employees from logins, which is D-69 returning: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("granting a back-office login still touches staff_profiles only", () => {
    const invite = USER_ACTIONS.slice(USER_ACTIONS.indexOf("export async function inviteUser"));
    expect(invite.length).toBeGreaterThan(300);
    expect(invite).toContain("staff_profiles");
    expect(invite).not.toContain('from("employees")');
  });

  it("creating an employee in staffing still leaves staff_id unset", () => {
    const create = STAFFING_ACTIONS.slice(
      STAFFING_ACTIONS.indexOf("export async function createEmployeeAction"),
    );
    const insert = create.slice(create.indexOf('.from("employees")'), create.indexOf(".select("));
    expect(insert.length).toBeGreaterThan(40);
    expect(insert).not.toContain("staff_id");
  });

  it("no code anywhere writes employees.staff_id", () => {
    // Reads are fine and expected - staff_id is how a punch is attributed to a
    // login when one happens to exist. WRITES are the coupling.
    //
    // The first draft of this test scanned for `staff_id:` anywhere in a file
    // that also contained `.insert(`, and reported five offenders. All five
    // were false: push.ts writes push_subscriptions, handbook-ack-store.ts
    // writes handbook_acknowledgments, sick-leave-store and
    // wage-order-write-store write created_by_staff_id on their OWN tables, and
    // staffing/store.ts merely declares `staff_id` in a TypeScript type. A test
    // that cries wolf gets edited until it is silent, so it is scoped properly
    // here: statements that write the `employees` table, and nothing else.
    //
    // Payload objects built in a variable are resolved, because
    // `.update(update)` hides its contents from a textual scan and three of the
    // eight write sites in the tree are written that way.
    const offenders: string[] = [];
    let writeSites = 0;

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) inspect(full);
      }
    };

    const inspect = (full: string) => {
      const body = codeOnly(readFileSync(full, "utf8"));
      const rel = path.relative(REPO, full);
      let at = body.indexOf('.from("employees")');
      while (at !== -1) {
        const end = body.indexOf(";", at);
        const stmt = body.slice(at, end === -1 ? at + 1500 : end);
        const verb = /\.(insert|update|upsert)\(([\s\S]*)/.exec(stmt);
        if (verb) {
          writeSites += 1;
          const payload = verb[2];
          if (/staff_id/.test(payload)) offenders.push(`${rel} (inline)`);
          // `.update(someVar)` - go and read someVar.
          const varName = /^\s*([A-Za-z_$][\w$]*)\s*\)/.exec(payload)?.[1];
          if (varName) {
            const decl = new RegExp(`(?:const|let)\\s+${varName}\\b[\\s\\S]{0,900}`);
            const declared = decl.exec(body)?.[0] ?? "";
            const assigns = new RegExp(`\\b${varName}\\.staff_id\\s*=`);
            if (/staff_id\s*:/.test(declared) || assigns.test(body)) {
              offenders.push(`${rel} (via ${varName})`);
            }
          }
        }
        at = body.indexOf('.from("employees")', at + 1);
      }
    };

    walk(path.join(REPO, "src"));

    // Measured on the tree as it stands: eight statements write `employees`.
    // Asserting the count is what stops this becoming a test that passes because
    // it found nothing to look at (standing rule 13c). If a legitimate ninth
    // write site is added, update this number AFTER reading the new code.
    expect(writeSites, "the employees-write scan found nothing; it has gone blind").toBe(8);
    expect(
      offenders,
      `these write employees.staff_id, which is D-69 returning: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
describe("the screen does what Michael asked for", () => {
  it("payroll setup can create a person, instead of sending him to Staffing", () => {
    // Verbatim: "I want to create the employee in payroll/ W-4 setup".
    //
    // Checking for the string "AddPersonToPayrollForm" is not enough and the
    // mutation probe proved it: replacing the rendered element with
    // `<p>Coming soon.</p>` left the IMPORT untouched, so the name was still in
    // the file and the test passed on a page that could no longer add anybody.
    // Assert the element is RENDERED.
    expect(PAGE).toMatch(/<AddPersonToPayrollForm\s*\/>/);
    expect(PAGE).toContain("Add someone to payroll");
    // The old dead end is gone.
    expect(PAGE).not.toContain("Add them under Staffing first");
  });

  it("the form takes a name and nothing that grants access", () => {
    // Verbatim: "then I will give them access to the back office if they need
    // access to it" - a separate, deliberate act, not a checkbox here.
    expect(FORM).toContain("fullName");
    expect(FORM).not.toMatch(/\brole\b\s*[:=]/);
    expect(FORM).not.toContain("staff_profiles");
    expect(FORM).not.toContain("invite");
  });

  it("the form says out loud that it does not create a login", () => {
    expect(FORM.toLowerCase()).toContain("login");
    expect(FORM).toMatch(/does not|not grant|separately/i);
  });

  it("the action is owner-gated and refreshes both rosters", () => {
    const action = SETUP_ACTIONS.slice(SETUP_ACTIONS.indexOf("export async function addPersonAction"));
    expect(action).toContain("requireBooksAccess");
    expect(action).toContain('revalidatePath("/admin/books/payroll-setup")');
    expect(action).toContain('revalidatePath("/admin/staffing/employees")');
    // The gate comes before the write.
    expect(action.indexOf("requireBooksAccess")).toBeLessThan(action.indexOf("addPersonToPayroll("));
  });
});
