/**
 * tests/compliance/timesheet-wiring.test.ts   (slice books-32)
 *
 * The gate over the TIMESHEET SCREEN - the page, the two server actions, the
 * workbench view, and the nav entry that makes them reachable.
 *
 * WHY A SOURCE-LEVEL GATE AT ALL
 *
 * Standing rule 50: dead code wearing a green check. An engine can be perfect
 * and a screen can still fail to call it, fail to show its warnings, or fail to
 * gate its writes. None of that is visible to a unit test of the engine. These
 * assertions read the actual wiring.
 *
 * THE MISTAKE THIS FILE MADE, AND HOW IT WAS CAUGHT (standing rule 43)
 *
 * An earlier version of this file asserted the partial-workweek warning was
 * wired by checking that `partialWeekWarning` appeared in the view. The
 * mutation run then rewrote the guard to `false ? ... : null` - permanently
 * hiding a warning whose entire job is to stop overtime being under-reported
 * across a period boundary - AND THE TEST STILL PASSED, because the identifier
 * survived inside the branch that could no longer be reached.
 *
 * The test was decoration. It would have reported green forever while the
 * protection it guarded was switched off.
 *
 * Every conditional block below is therefore pinned TWICE and separately:
 *   - the GUARD  (`{x ?`)  - proving the condition is the real value, and
 *   - the RENDER (`{x}`)   - proving the value reaches the screen.
 * Deleting either one, or replacing the condition with a constant, now fails.
 *
 * THE STAKES
 * This screen decides which hours are approved for payment. Michael, verbatim:
 * "We can not mess up payroll and its reporting and payments. This one will
 * bankrupt me if we aren't careful."
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";

/* ─────────────────────────────────────────────────────────────────────────
 * Sources under test
 * ───────────────────────────────────────────────────────────────────────── */

const ROOT = join(__dirname, "..", "..");

const PAGE_PATH = join(ROOT, "src", "app", "admin", "books", "timesheets", "page.tsx");
const ACTIONS_PATH = join(ROOT, "src", "app", "admin", "books", "timesheets", "actions.ts");
const VIEW_PATH = join(ROOT, "src", "components", "admin", "books", "TimesheetWorkbench.tsx");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const actionsSrc = readFileSync(ACTIONS_PATH, "utf8");
const viewSrc = readFileSync(VIEW_PATH, "utf8");

/**
 * Comments stripped, so a rule merely DESCRIBED in prose cannot satisfy a test
 * looking for the rule IMPLEMENTED in code. These three files carry long
 * explanatory comments that name almost every identifier asserted below; without
 * this step most of this file would pass on the strength of its own commentary.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const actionsCode = stripComments(actionsSrc);
const viewCode = stripComments(viewSrc);

/* ═══════════════════════════════════════════════════════════════════════════
 * 0) THE STRIPPER ITSELF (standing rule 39: guard the vacuous read)
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the comment-stripping helper actually strips (rule 39)", () => {
  it("leaves real code behind and removes prose", () => {
    // If any of these produced an empty string, every source assertion below
    // would pass vacuously and this whole file would be theatre.
    expect(pageCode.length).toBeGreaterThan(500);
    expect(actionsCode.length).toBeGreaterThan(500);
    expect(viewCode.length).toBeGreaterThan(1_000);

    expect(pageCode).toContain("export default async function TimesheetsPage");
    expect(actionsCode).toContain("export async function approvePayPeriodAction");
    expect(viewCode).toContain("export function TimesheetWorkbench");
  });

  it("removes phrases that exist only inside comments", () => {
    // Michael's quote lives in the page's header comment and nowhere in code.
    expect(pageSrc).toContain("bankrupt me");
    expect(pageCode).not.toContain("bankrupt me");

    // NB: this phrase wraps across two comment lines in the source, so it is
    // matched on the fragment that sits whole on one line.
    expect(actionsSrc).toContain("button is a suggestion");
    expect(actionsCode).not.toContain("button is a suggestion");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE GATE
 *
 * The store uses the service role, which BYPASSES the owner-only RLS policies
 * migration 0197 puts on pay_periods. The database gate is inert on this path.
 * requireBooksAccess() is the entire protection, so its absence is not a
 * degradation - it is an open door.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the owner gate is on every entry point, not just the page", () => {
  it("the page awaits requireBooksAccess before reading anything", () => {
    expect(pageCode).toContain("await requireBooksAccess()");
    // Ordering: the gate must precede the first store read, or data is fetched
    // for a caller who was never authorised.
    const gateAt = pageCode.indexOf("await requireBooksAccess()");
    const readAt = pageCode.indexOf("loadWorkweekSettings(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(readAt);
  });

  it("BOTH server actions call the gate themselves", () => {
    /*
     * Rule 56: an exported server action with no caller is still a public HTTP
     * endpoint. Next.js exposes every "use server" export at a generated URL,
     * reachable with a POST and no page load at all. A gate that lives only in
     * page.tsx protects the rendering, not the action.
     */
    const compute = actionsCode.slice(
      actionsCode.indexOf("export async function computeTimesheetAction"),
      actionsCode.indexOf("export async function approvePayPeriodAction"),
    );
    const approve = actionsCode.slice(
      actionsCode.indexOf("export async function approvePayPeriodAction"),
    );

    expect(compute.length).toBeGreaterThan(100);
    expect(approve.length).toBeGreaterThan(100);
    expect(compute).toContain("requireBooksAccess()");
    expect(approve).toContain("requireBooksAccess()");
  });

  it("the file is a server-action module", () => {
    expect(actionsSrc.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("the approver's identity comes from the SESSION, never the request", () => {
    /*
     * An approval whose name comes from the form body is not an approval, it is
     * a text field. The staff id must be read off the authenticated session.
     */
    expect(actionsCode).toContain("session.profile.id");
    expect(actionsCode).toContain("approvePayPeriod(periodId, session.profile.id)");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) READ AND WRITE ARE SEPARATE ACTS (standing rule 63c)
 * ═══════════════════════════════════════════════════════════════════════ */

describe("computing hours writes nothing; approving is the only write", () => {
  const compute = actionsCode.slice(
    actionsCode.indexOf("export async function computeTimesheetAction"),
    actionsCode.indexOf("export async function approvePayPeriodAction"),
  );
  const approve = actionsCode.slice(
    actionsCode.indexOf("export async function approvePayPeriodAction"),
  );

  it("the compute action never calls the writer and never revalidates", () => {
    // revalidatePath in a read-only action is the tell that it is not read-only.
    expect(compute).not.toContain("approvePayPeriod(");
    expect(compute).not.toContain("revalidatePath");
  });

  it("the approve action calls the writer and revalidates the screen", () => {
    expect(approve).toContain("approvePayPeriod(");
    expect(approve).toContain("revalidatePath(SCREEN)");
  });

  it("the approve action RE-RUNS the engine before it writes", () => {
    /*
     * The numbers on screen may be minutes old. A punch fixed - or broken - in
     * another tab since the page rendered must be seen. Trusting the rendered
     * figures is how a bad punch becomes a paycheck.
     */
    const recomputeAt = approve.indexOf("computeTimesheetForPeriod(periodId)");
    const writeAt = approve.indexOf("approvePayPeriod(periodId");
    expect(recomputeAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(recomputeAt).toBeLessThan(writeAt);
  });

  it("the approve action REFUSES on the server when any employee is refused", () => {
    // GUARD: the real count is tested, not a constant.
    expect(approve).toMatch(/if\s*\(\s*computed\.refusedCount\s*>\s*0\s*\)/);
    // And the refusal must return BEFORE the write, not merely log.
    const guardAt = approve.search(/if\s*\(\s*computed\.refusedCount\s*>\s*0\s*\)/);
    const writeAt = approve.indexOf("approvePayPeriod(periodId");
    expect(guardAt).toBeLessThan(writeAt);
  });

  it("the server-side refusal NAMES the blocking employees", () => {
    /*
     * "Some employees have problems" sends Michael hunting. The names are the
     * difference between a message and guidance.
     */
    expect(approve).toContain("s.employee.fullName");
    expect(approve).toMatch(/refusals\.length\s*>\s*0/);
  });

  it("neither action throws; both return a readable message", () => {
    // A thrown error renders an error boundary - a blank screen where the
    // guidance used to be. That is the Sage failure mode Michael described.
    expect(actionsCode).not.toContain("throw new Error");
    expect(actionsCode).toMatch(/ok:\s*false,\s*\n?\s*message:/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE VIEW SHOWS EACH WORKWEEK BEFORE ANY PERIOD TOTAL
 *
 * This is the whole slice in one assertion. 29 CFR 778.104 forbids averaging
 * hours across weeks; a screen that leads with a fortnight total teaches the
 * averaging habit even when the engine underneath is right.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the per-workweek breakdown precedes the period total", () => {
  it("renders a row per workweek from the engine's own buckets", () => {
    expect(viewCode).toContain("sheet.hours.weeks.map");
    expect(viewCode).toContain("w.regularHundredthHours");
    expect(viewCode).toContain("w.overtimeHundredthHours");
    expect(viewCode).toContain("w.totalHundredthHours");
  });

  it("the weekly table appears BEFORE the gross figure in the markup", () => {
    const weeksAt = viewCode.indexOf("sheet.hours.weeks.map");
    const grossAt = viewCode.indexOf("sheet.hours.grossCents");
    expect(weeksAt).toBeGreaterThan(-1);
    expect(grossAt).toBeGreaterThan(-1);
    expect(weeksAt).toBeLessThan(grossAt);
  });

  it("labels a partial workweek on its own row - GUARD and RENDER pinned apart", () => {
    // GUARD: the condition must be the engine's real flag, not a constant.
    expect(viewCode).toMatch(/\{\s*w\.isPartial\s*\?/);
    // RENDER: and it must actually produce the label.
    expect(viewCode).toContain("part of a workweek that continues outside this period");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE 778.110(a) SPLIT IS SHOWN, NOT JUST THE TOTAL
 * ═══════════════════════════════════════════════════════════════════════ */

describe("gross pay is shown the way the regulation states it", () => {
  it("prints straight time, the premium, and the gross", () => {
    expect(viewCode).toContain("formatCents(sheet.hours.straightTimeCents)");
    expect(viewCode).toContain("formatCents(sheet.hours.overtimePremiumCents)");
    expect(viewCode).toContain("formatCents(sheet.hours.grossCents)");
  });

  it("the view performs NO arithmetic of its own", () => {
    /*
     * Two places computing the same money is two places to disagree. Every
     * figure on this screen is formatted by the engine's own helpers, so the
     * screen cannot drift from the numbers that get approved.
     *
     * This looks for addition/subtraction between engine money or hour fields.
     */
    const arithmeticOnEngineFields =
      /(straightTimeCents|overtimePremiumCents|grossCents|regularHundredthHours|overtimeHundredthHours|totalHundredthHours)\s*[+\-*/]\s*\w/;
    expect(viewCode).not.toMatch(arithmeticOnEngineFields);
  });

  it("uses the engine's formatters rather than toFixed on a float", () => {
    expect(viewCode).toContain("formatHundredthHours");
    expect(viewCode).toContain("formatCents");
    expect(viewCode).not.toContain("toFixed(2)");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) THE WARNINGS REACH THE SCREEN
 *
 * Each of these is pinned GUARD-then-RENDER for the reason in the file header.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the partial-workweek warning cannot be silently switched off", () => {
  it("GUARD: the condition is the engine's warning, not a constant", () => {
    expect(viewCode).toMatch(/\{\s*sheet\.hours\.partialWeekWarning\s*\?/);
  });

  it("RENDER: the warning text itself reaches the markup", () => {
    expect(viewCode).toMatch(/\{\s*sheet\.hours\.partialWeekWarning\s*\}/);
  });

  it("the guard precedes the render, i.e. they are the same block", () => {
    const guardAt = viewCode.search(/\{\s*sheet\.hours\.partialWeekWarning\s*\?/);
    const renderAt = viewCode.search(/\{\s*sheet\.hours\.partialWeekWarning\s*\}/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(guardAt);
  });
});

describe("the punch variance is printed, not reconciled (standing rule 63d)", () => {
  it("GUARD: the real variance list length is tested", () => {
    expect(viewCode).toMatch(/\{\s*sheet\.hours\.variances\.length\s*>\s*0\s*\?/);
  });

  it("RENDER: each variance prints stored, computed AND the difference", () => {
    expect(viewCode).toContain("sheet.hours.variances.map");
    expect(viewCode).toContain("v.storedMinutes");
    expect(viewCode).toContain("v.computedMinutes");
    expect(viewCode).toContain("v.varianceMinutes");
  });

  it("the screen says which side the engine used, so the reader is not left guessing", () => {
    expect(viewSrc).toContain("The engine used the clock times");
  });
});

describe("refusals are shown with their fix, not swallowed", () => {
  it("GUARD: the real refusal list drives the block", () => {
    expect(viewCode).toMatch(/sheet\.refusals\.length\s*>\s*0/);
    expect(viewCode).toContain("sheet.refusals.map");
  });

  it("RENDER: the message, the fix and the code all reach the screen", () => {
    expect(viewCode).toMatch(/\{\s*r\.message\s*\}/);
    expect(viewCode).toMatch(/\{\s*r\.fix\s*\}/);
    expect(viewCode).toMatch(/\{\s*r\.code\s*\}/);
  });

  it("a refused employee is excluded from the totals rather than counted as zero", () => {
    /*
     * Standing rule 62d in its most expensive form. An employee whose punches
     * cannot be read must not silently contribute 0.00 hours to a period total
     * that then looks complete.
     */
    expect(viewCode).toContain("not counted");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE MENTOR LAYER IS ON THIS SCREEN (standing rule 26)
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the teaching layer is wired, not merely written", () => {
  it("the view renders the verbatim quote AND the plain-English meaning", () => {
    // Rule 24: the quote is sacred, and it is worth nothing if only the
    // paraphrase is ever shown.
    expect(viewCode).toContain("authority.quote");
    expect(viewCode).toContain("authority.soWhat");
    expect(viewCode).toContain("authority.cite");
  });

  it("the refusal lessons are looked up by code and rendered with the refusal", () => {
    // The lesson is matched to the engine's own refusal code, so a new refusal
    // code with no lesson degrades to the raw message rather than to nothing.
    expect(viewCode).toContain("TIMESHEET_REFUSAL_LESSONS.find");
    expect(viewCode).toMatch(/l\.code\s*===\s*\(?\s*r\.code/);
    expect(viewCode).toContain("lesson ? lesson.headline : r.message");
  });

  it("the field and screen lessons are mounted too, not just imported", () => {
    // Rule 56: an import with no render is a lesson nobody can read.
    expect(viewCode).toContain("TIMESHEET_FIELD_LESSONS");
    expect(viewCode).toContain("TIMESHEET_SCREEN_LESSONS");
    expect(viewCode).toMatch(/TIMESHEET_FIELD_LESSONS\.map/);
    expect(viewCode).toMatch(/TIMESHEET_SCREEN_LESSONS\.map/);
  });

  it("the workweek is described in words, not left as an integer", () => {
    // "0" is not an answer to "when does my workweek start".
    expect(viewCode).toContain("describeWorkweek(");
  });

  it("the progress panel is rendered from real facts", () => {
    expect(pageCode).toContain("loadTimesheetProgress(taxYear, selectedPeriodId)");
    expect(pageCode).toContain("progress={progressRes.progress}");
    expect(viewCode).toContain("progress");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) THE PAGE DISTINGUISHES "COULD NOT READ" FROM "NOTHING THERE"
 * ═══════════════════════════════════════════════════════════════════════ */

describe("a read failure is never rendered as an empty calendar", () => {
  it("GUARD: a failure variable is computed from all three reads", () => {
    expect(pageCode).toMatch(/const\s+failure\s*=/);
    expect(pageCode).toContain("!settings.ok");
    expect(pageCode).toContain("!periodsRes.ok");
    expect(pageCode).toContain("!progressRes.ok");
  });

  it("each failing read yields ITS OWN message, not a swallowed null", () => {
    /*
     * MUTATION FINDING (W15b). The assertion above only proved the three reads
     * are TESTED. A mutant that changed
     *     !settings.ok ? settings.message : ...
     * to  !settings.ok ? null            : ...
     * SURVIVED it: the read was still checked, and the failure was still
     * detected, but the explanation was thrown away, so a workweek-settings
     * read failure rendered as a blank screen. That is precisely the Sage
     * behaviour Michael described - stopped without being told anything.
     *
     * Each branch is therefore pinned to its own message.
     */
    expect(pageCode).toMatch(/!settings\.ok\s*\?\s*settings\.message/);
    expect(pageCode).toMatch(/!periodsRes\.ok\s*\?\s*periodsRes\.message/);
    expect(pageCode).toMatch(/!progressRes\.ok\s*\?\s*progressRes\.message/);
  });

  it("RENDER: the failure message reaches the screen", () => {
    expect(pageCode).toMatch(/\{\s*failure\s*\?/);
    expect(pageCode).toMatch(/\{\s*failure\s*\}/);
  });

  it("says plainly that nothing was changed", () => {
    expect(pageSrc).toContain("nothing was changed");
  });

  it("does not hardcode a tax year", () => {
    // Michael's first payroll is 2027-01-01 and this screen outlives it.
    expect(pageCode).toContain("new Date().getUTCFullYear()");
    expect(pageCode).not.toMatch(/taxYear\s*=\s*20\d\d\b/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8) THE SCREEN IS REACHABLE (rule 50: dead code wearing a green check)
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the nav entry makes the screen reachable and gated", () => {
  const entry = adminNav.find((i) => i.href === "/admin/books/timesheets");

  it("exists in the Accounting group", () => {
    expect(entry).toBeDefined();
    expect(entry?.group).toBe("Accounting");
  });

  it("is gated on books.view, the same permission the page enforces", () => {
    expect(entry?.permission).toBe("books.view");
  });

  it("has a label a person would recognise", () => {
    expect(entry?.label).toBe("Timesheets & Overtime");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9) THE PAGE ACTUALLY MOUNTS THE VIEW AND PASSES BOTH ACTIONS
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the page hands the view everything it needs", () => {
  it("mounts the workbench", () => {
    expect(pageCode).toContain("<TimesheetWorkbench");
  });

  it("passes both server actions down", () => {
    expect(pageCode).toContain("computeAction={computeTimesheetAction}");
    expect(pageCode).toContain("approveAction={approvePayPeriodAction}");
  });

  it("passes the workweek anchor from the database, not a literal", () => {
    expect(pageCode).toContain("workweekAnchor={settings.workweekStartsOn}");
    // A hardcoded Sunday here would produce confident wrong overtime.
    expect(pageCode).not.toMatch(/workweekAnchor=\{\s*0\s*\}/);
  });

  it("computes nothing on load", () => {
    expect(pageCode).toContain("initialComputation={null}");
  });

  it("is a client component so the actions can be invoked from the browser", () => {
    expect(viewSrc.trimStart().startsWith('"use client"')).toBe(true);
  });
});
