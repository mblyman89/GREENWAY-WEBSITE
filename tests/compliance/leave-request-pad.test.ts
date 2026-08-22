/**
 * tests/compliance/leave-request-pad.test.ts   (slice books-35, phase F)
 *
 * THE GATE OVER THE EMPLOYEE'S HALF OF OPTION 1 — the sick-leave request pad
 * at the clock, its PIN-authenticated server action, and the store function
 * that writes the row.
 *
 * WHY THE ASKING NEEDS A GATE OF ITS OWN
 *
 * The approval inbox (books-35 phase E) is worthless if nothing can reach it.
 * Migration 0198 sets the INSERT policy on `sick_leave_requests` to
 * `auth.role() = 'authenticated'` rather than `is_owner()`, and it explains
 * why in its own words:
 *
 *   "employees.staff_id is nullable 'for floor-only staff who just clock in at
 *    a shared station'. Most of Greenway's employees have no back-office login
 *    at all. If requesting sick leave required is_owner(), or even required a
 *    staff profile, then the people the statute is written to protect would be
 *    structurally unable to ask. The request would have to travel by text
 *    message to Michael, which is precisely the undocumented channel this
 *    migration exists to replace."
 *
 * That deliberate loosening is the most security-sensitive decision in the
 * slice, so the compensating controls — PIN authentication, the shared
 * brute-force throttle, and taking the employee id from the PIN lookup rather
 * than the form — are each pinned here.
 *
 * THE STAKES, IN ONE SENTENCE
 *
 * If the employee id came off the form, anyone standing at a shared station
 * could file a sick day in a colleague's name, and the colleague would be the
 * one recorded as absent.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* ─────────────────────────────────────────────────────────────────────────────
 * Sources under test
 * ───────────────────────────────────────────────────────────────────────────── */

const ROOT = join(__dirname, "..", "..");

const PAD_PATH = join(
  ROOT,
  "src",
  "components",
  "admin",
  "staffing",
  "SickLeaveRequestPad.tsx",
);
const ACTION_PATH = join(ROOT, "src", "app", "admin", "staffing", "leave-actions.ts");
const CLOCK_PATH = join(ROOT, "src", "app", "admin", "staffing", "clock", "page.tsx");
const STORE_PATH = join(ROOT, "src", "lib", "payroll", "sick-leave-store.ts");
const MIGRATION_PATH = join(
  ROOT,
  "supabase",
  "migrations",
  "0198_sick_leave_and_garnishments.sql",
);

const padSrc = readFileSync(PAD_PATH, "utf8");
const actionSrc = readFileSync(ACTION_PATH, "utf8");
const clockSrc = readFileSync(CLOCK_PATH, "utf8");
const storeSrc = readFileSync(STORE_PATH, "utf8");
const migrationSrc = readFileSync(MIGRATION_PATH, "utf8");

/** Comments stripped, so prose describing a rule cannot satisfy a test for it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const padCode = stripComments(padSrc);
const actionCode = stripComments(actionSrc);
const clockCode = stripComments(clockSrc);
const storeCode = stripComments(storeSrc);

/** Only the phase-F addition, so phase E's code cannot satisfy these tests. */
const submitFn = storeCode.slice(storeCode.indexOf("export async function submitLeaveRequest"));

/* ═════════════════════════════════════════════════════════════════════════════
 * 0) THE STRIPPER AND THE SLICES (standing rule 39: guard the vacuous read)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the sources really were read and stripped (rule 39)", () => {
  it("leaves real code behind", () => {
    expect(padCode.length).toBeGreaterThan(2_000);
    expect(actionCode.length).toBeGreaterThan(500);
    expect(clockCode.length).toBeGreaterThan(500);
    expect(submitFn.length).toBeGreaterThan(1_500);

    expect(padCode).toContain("export function SickLeaveRequestPad");
    expect(actionCode).toContain("export async function submitSickLeaveRequestAction");
    expect(submitFn).toContain("export async function submitLeaveRequest");
  });

  it("removes phrases that exist only inside comments", () => {
    /*
      A note on why this pin is what it is, because the first version of this
      test was WRONG and it is worth recording the mistake.

      I originally pinned the phrase "travel by text message". That phrase is
      genuinely in the file - it is part of the header quoting migration 0198 -
      but the header is wrapped prose, so on disk it reads:

            *    structurally unable to ask. The request would have to travel by text
            *    message to Michael, which is precisely the undocumented channel this

      The words "travel by text" and "message" are separated by a newline, a
      star and four spaces. A toContain() for the joined phrase can therefore
      NEVER match, no matter how correct the source file is. That is a broken
      test, not a broken component: it fails on good code and would go on
      failing after any conceivable fix to the pad.

      The rule this teaches is that a source-reading assertion has to be pinned
      to something that survives the file's own line wrapping. So the pin below
      is a phrase that sits WHOLLY on one line (line 19), and the assertion
      right after it proves that phrase is comment-only by showing the stripper
      removes it.
    */
    expect(padSrc).toContain("undocumented channel this");
    expect(padCode).not.toContain("undocumented channel this");

    expect(actionSrc).toContain("unthrottled");
    expect(actionCode).not.toContain("unthrottled");
  });

  it("the store slice is the NEW function, not the whole file", () => {
    // If this slice accidentally started at the top of the file, phase E's
    // decideRequest would satisfy assertions meant for phase F.
    expect(submitFn).not.toContain("export async function loadLeaveInbox");
    expect(submitFn).not.toContain("export async function decideRequest");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 1) THE COMPENSATING CONTROLS FOR AN INTENTIONALLY OPEN RLS POLICY
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the request table really is the loosened one (read from the migration)", () => {
  it("0198 grants INSERT on sick_leave_requests to any authenticated session", () => {
    /*
     * Read from the SQL rather than asserted from memory. If a later migration
     * tightened this to is_owner(), the pad would break for every floor
     * employee - and it would break SILENTLY, as an insert that returns no
     * error under the service role but is unreachable for a real session.
     */
    expect(migrationSrc).toContain(
      "create policy sick_leave_requests_insert on public.sick_leave_requests for insert with check (auth.role() = ''authenticated'')",
    );
  });

  it("but DECIDING a request and the whole ledger stay owner-only", () => {
    expect(migrationSrc).toContain(
      "create policy sick_leave_requests_update on public.sick_leave_requests for update using (public.is_owner()) with check (public.is_owner())",
    );
    expect(migrationSrc).toContain(
      "create policy sick_leave_ledger_insert on public.sick_leave_ledger for insert with check (public.is_owner())",
    );
  });
});

describe("the action authenticates with a PIN and throttles the attempts", () => {
  it("is a server-action module", () => {
    expect(actionSrc.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("requires the timeclock permission before doing anything", () => {
    expect(actionCode).toContain('await requirePermission("timeclock.use")');
    const gateAt = actionCode.indexOf('await requirePermission("timeclock.use")');
    const lookupAt = actionCode.indexOf("getEmployeeByPin(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(lookupAt).toBeGreaterThan(gateAt);
  });

  it("checks the lockout BEFORE it tests the PIN", () => {
    /*
     * Order matters: testing the PIN first and then checking the lockout would
     * let an attacker keep learning whether each guess was right while locked
     * out, which defeats the entire throttle.
     */
    const blockedAt = actionCode.indexOf("await pinPadBlocked(TIMECLOCK_THROTTLE_SCOPE)");
    const validAt = actionCode.indexOf("isValidPin(input.pin)");
    expect(blockedAt).toBeGreaterThan(-1);
    expect(validAt).toBeGreaterThan(blockedAt);
  });

  it("records a failure on a bad PIN and a success on a good one", () => {
    // A throttle that never counts failures is decoration (rule 50).
    expect(actionCode).toContain("await notePinFailure(TIMECLOCK_THROTTLE_SCOPE)");
    expect(actionCode).toContain("await notePinSuccess(TIMECLOCK_THROTTLE_SCOPE)");
  });

  it("shares the clock's throttle scope rather than inventing a second one", () => {
    /*
     * Standing rule 25. Two scopes would mean an attacker locked out of the
     * clock pad could carry on guessing on this one, and the lockout would
     * protect nothing.
     */
    expect(actionCode).toContain("TIMECLOCK_THROTTLE_SCOPE");
    expect(actionCode).not.toMatch(/THROTTLE_SCOPE\s*=\s*["']/);
  });

  it("the employee id comes from the PIN LOOKUP, never from the form", () => {
    expect(actionCode).toContain("const emp = await getEmployeeByPin(input.pin)");
    expect(actionCode).toContain("employeeId: emp.id");
    // The input type must not even offer an employee id to trust.
    const sig = actionCode.slice(
      actionCode.indexOf("export async function submitSickLeaveRequestAction"),
      actionCode.indexOf('await requirePermission("timeclock.use")'),
    );
    expect(sig.length).toBeGreaterThan(50);
    expect(sig).not.toContain("employeeId");
    expect(sig).not.toContain("employee_id");
  });

  it("never throws - a blank screen at the clock is a lost request", () => {
    expect(actionCode).not.toContain("throw new ");
  });

  it("the asking is audited as its own event", () => {
    // The entire justification for this pad is that an undocumented request is
    // worth nothing when it is questioned two years later.
    expect(actionCode).toContain('action: "sickleave.requested"');
  });

  it("submitting refreshes the approval inbox", () => {
    expect(actionCode).toContain('revalidatePath("/admin/books/leave")');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 2) THE STORE REFUSES RATHER THAN GUESSING (standing rule 62d)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("submitLeaveRequest validates every field it is given", () => {
  it("the purpose is checked against the engine's own union", () => {
    /*
     * A purpose the database CHECK rejects would otherwise reach the employee
     * as a raw Postgres constraint error - Michael's exact complaint about
     * Sage: stopped without being told why.
     */
    expect(storeCode).toContain(
      "export const SICK_LEAVE_PURPOSES: readonly SickLeavePurpose[]",
    );
    expect(submitFn).toContain("SICK_LEAVE_PURPOSES.includes(args.purpose as SickLeavePurpose)");
  });

  it("the purpose list matches migration 0198's CHECK constraint exactly", () => {
    /*
     * Read from BOTH sides and compared. A sixth purpose added to the schema
     * without being added here would be silently un-requestable; one removed
     * from the schema but left here would produce a constraint error at the
     * clock.
     */
    const m = migrationSrc.match(/check\s*\(purpose\s+in\s*\(([\s\S]*?)\)\)/);
    expect(m, "the purpose CHECK constraint in 0198 was renamed or reformatted").not.toBeNull();
    const fromSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();

    const listBlock = storeCode.slice(
      storeCode.indexOf("export const SICK_LEAVE_PURPOSES"),
      storeCode.indexOf("export type SubmittedRequest"),
    );
    const fromTs = [...listBlock.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();

    expect(fromSql.length).toBe(5);
    expect(fromTs).toEqual(fromSql);
  });

  it("the notice kind is validated, not defaulted", () => {
    expect(submitFn).toMatch(
      /args\.noticeKind\s*!==\s*"foreseeable"\s*&&\s*args\.noticeKind\s*!==\s*"unforeseeable"/,
    );
  });

  it("an unreadable date REFUSES instead of becoming today", () => {
    /*
     * A date that silently became "today" would file the request against the
     * wrong day, and the employee would be marked absent on the day they
     * actually asked for.
     */
    expect(submitFn).toContain("/^\\d{4}-\\d{2}-\\d{2}$/.test(args.leaveDate)");
  });

  it("the minutes must be a positive whole number", () => {
    expect(submitFn).toMatch(
      /!Number\.isInteger\(args\.minutes\)\s*\|\|\s*args\.minutes\s*<=\s*0/,
    );
  });

  it("a duplicate request for the same day is refused", () => {
    /*
     * Without this, a double-tap on a slow phone creates two pending rows for
     * one day. Michael approves both, planDraw spends the minutes twice, and
     * the employee loses real balance to a UI stutter.
     */
    expect(submitFn).toContain('.eq("leave_date", args.leaveDate)');
    expect(submitFn).toContain('.in("status", ["pending", "approved"])');
  });

  it("the duplicate message reassures rather than alarms", () => {
    // "Nothing was saved" on its own reads as "your request was lost".
    expect(storeSrc).toContain("the first ");
    expect(submitFn).toContain("still stands");
  });

  it("the row is written as PENDING - the pad cannot approve anything", () => {
    expect(submitFn).toContain('status: "pending"');
    // And it must never touch the ledger. Only decideRequest may do that.
    expect(submitFn).not.toContain("sick_leave_ledger");
  });

  it("requested_by_staff_id is left unset, because floor staff have no profile", () => {
    /*
     * 0037 makes employees.staff_id nullable for shared-station staff. Writing
     * an EMPLOYEE id into a STAFF column would be a foreign key pointing at
     * the wrong table - and it would fail only for the people this pad exists
     * to serve.
     */
    expect(submitFn).not.toContain("requested_by_staff_id:");
  });

  it("the confirmation says plainly that nothing has moved yet", () => {
    expect(submitFn).toContain("waiting for a ");
    expect(storeSrc).toContain("Nothing has been ");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 3) THE PAD ASKS FOR NOTHING IT IS NOT ENTITLED TO ASK FOR
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the pad respects WAC 296-128-660(4)", () => {
  it("tells the employee they need not say what is wrong", () => {
    /*
     * WAC 296-128-660(4), verbatim: "Employer-required verification may not
     * result in an unreasonable burden or expense on the employee." A required
     * free-text "reason" box is an informal way of demanding a diagnosis, so
     * the note is optional and the screen says so out loud.
     */
    expect(padCode).toContain("You do not have to say what is wrong with you");
    expect(padCode).toContain("(optional)");
  });

  it("the note is never required to submit", () => {
    // The submit button's disabled condition must not mention the note.
    const btn = padCode.slice(
      padCode.indexOf("disabled={pending || pin.length < 4}"),
      padCode.indexOf("Send this request"),
    );
    expect(btn.length).toBeGreaterThan(10);
    expect(btn).not.toContain("employeeNote");
  });

  it("every purpose the database allows is offered, in plain words", () => {
    const m = migrationSrc.match(/check\s*\(purpose\s+in\s*\(([\s\S]*?)\)\)/);
    const purposes = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    const missing = purposes.filter((p) => !padCode.includes(`value: "${p}"`));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `Migration 0198 allows these purposes but the pad does not offer them, so an ` +
            `employee cannot request qualifying leave at all: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the domestic violence option says no more detail is needed", () => {
    // Chapter 49.76 RCW leave is the one an employee is least likely to want
    // to explain to their employer at a shared terminal.
    expect(padCode).toContain("You do not have to say any more than this");
  });
});

describe("the notice question records which WAC 296-128-650 rule applied", () => {
  it("offers both kinds", () => {
    expect(padCode).toContain('setNoticeKind("unforeseeable")');
    expect(padCode).toContain('setNoticeKind("foreseeable")');
  });

  it("defaults to unforeseeable, the answer that asks less of the employee", () => {
    /*
     * (1)(a) permits a ten-day advance notice requirement for FORESEEABLE
     * leave; (1)(b) only "as soon as possible" for unforeseeable. Defaulting
     * the other way would quietly record every sudden illness as late notice.
     */
    expect(padCode).toContain('useState("unforeseeable")');
  });
});

describe("time is chosen from presets, never typed as a bare number", () => {
  it("the durations are declared in MINUTES", () => {
    /*
     * A free number box invites "8". An employee who means eight HOURS while
     * the field means eight MINUTES has asked for almost nothing, and nobody
     * finds out until Michael reads it.
     */
    expect(padCode).toContain("minutes: 480");
    expect(padCode).toContain("minutes: 240");
  });

  it("the pad does no arithmetic and never shows a decimal hour", () => {
    expect(padCode).not.toContain("toFixed(");
    expect(padCode).not.toMatch(/minutes\s*\/\s*60/);
  });

  it("no balance is displayed, because the pad does not decide entitlement", () => {
    /*
     * WAC 296-128-630(1) gives the employee the choice to REQUEST. Showing a
     * balance here invites the pad to start refusing, which would be a denial
     * with no decider and no record - the thing option 1 exists to prevent.
     */
    expect(padCode).not.toContain("totalMinutes");
    expect(padCode).not.toContain("statutoryMinutes");
    expect(padCode).not.toContain("computeBalance");
  });
});

describe("the PIN is handled safely at a SHARED station", () => {
  it("is masked on screen", () => {
    expect(padCode).toContain('type="password"');
  });

  it("is cleared after a successful submission", () => {
    /*
     * At a shared terminal a PIN left in the box lets the next person file a
     * request under the previous employee's identity by tapping once.
     */
    const okBranch = padCode.slice(padCode.indexOf("if (res.ok)"));
    expect(okBranch.length).toBeGreaterThan(20);
    expect(okBranch).toContain('setPin("")');
  });

  it("submission is blocked until a plausible PIN is entered", () => {
    expect(padCode).toMatch(/disabled=\{pending \|\| pin\.length < 4\}/);
  });
});

describe("the result of the submission is always shown", () => {
  it("GUARD and RENDER, pinned apart (the timesheet-gate lesson)", () => {
    expect(padCode).toMatch(/\{\s*result\s*\?/);
    expect(padCode).toMatch(/\{\s*result\.message\s*\}/);
    const guardAt = padCode.search(/\{\s*result\s*\?/);
    const renderAt = padCode.search(/\{\s*result\.message\s*\}/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(guardAt);
  });

  it("success and failure are visually distinguished by the REAL flag", () => {
    expect(padCode).toMatch(/result\.ok\s*\n?\s*\?/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 4) THE PAD IS ACTUALLY MOUNTED (rule 50: dead code wearing a green check)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the clock page mounts the pad", () => {
  it("renders it and passes the action", () => {
    expect(clockCode).toContain("<SickLeaveRequestPad");
    expect(clockCode).toContain("submitAction={submitSickLeaveRequestAction}");
  });

  it("today's date is computed on the SERVER, not in the browser", () => {
    /*
     * A phone with a wrong clock, or one set to a different timezone, would
     * otherwise default the request to the wrong calendar day - and Greenway
     * runs on Pacific.
     */
    expect(clockCode).toContain("todayPacific={pacificToday()}");
    expect(padCode).not.toContain("new Date()");
  });

  it("the pad is a client component and the page stays dynamic", () => {
    expect(padSrc.trimStart().startsWith('"use client"')).toBe(true);
    expect(clockCode).toContain('export const dynamic = "force-dynamic"');
  });
});
