/**
 * tests/compliance/leave-inbox-screen.test.ts   (slice books-35)
 *
 * THE GATE OVER THE SICK-LEAVE APPROVAL INBOX - the page, the single server
 * action, the workbench view, the store that writes, and the nav entry that
 * makes all of it reachable.
 *
 * WHAT MICHAEL DECIDED, VERBATIM (standing rule 1)
 *
 *   "Thank you. I like option 1 as well. It should reach me in accounting
 *    somewhere logical."
 *
 * Option 1 was: a sick-leave request must be APPROVED BEFORE it appears on the
 * timesheet. This file is what stops that decision quietly rotting.
 *
 * WHY A SOURCE-LEVEL GATE AT ALL
 *
 * Standing rule 50: dead code wearing a green check. `sick-leave-core.ts` has
 * 8,000-odd lines of test behind it and none of that notices if the screen
 * forgets to call it, forgets to show its refusals, or lets an approval through
 * with the deciding staff id taken off a form. These assertions read the actual
 * wiring on disk.
 *
 * THE MISTAKE THE TIMESHEET GATE MADE, INHERITED HERE ON PURPOSE (rule 43)
 *
 * `tests/compliance/timesheet-wiring.test.ts` records it in its own words:
 *
 *   "An earlier version of this file asserted the partial-workweek warning was
 *    wired by checking that `partialWeekWarning` appeared in the view. The
 *    mutation run then rewrote the guard to `false ? ... : null` ... AND THE
 *    TEST STILL PASSED, because the identifier survived inside the branch that
 *    could no longer be reached."
 *
 * So every conditional block below is pinned TWICE and separately:
 *   - the GUARD  (`{x ?`)  - proving the condition is the real value, and
 *   - the RENDER (`{x}`)   - proving the value reaches the screen.
 * Switching a guard to a constant now fails even though the identifier is still
 * in the file.
 *
 * A DEBT THIS FILE IS HERE TO PAY
 *
 * `LeaveInboxWorkbench.tsx` contains this promise, written before this file
 * existed:
 *
 *   "The ids are checked at build time by tests/compliance/leave-inbox-screen.test.ts
 *    against the real registry, so a typo here cannot render a blank card."
 *
 * A comment claiming a guard that does not exist is rule 50 in its purest form.
 * Section 7 below makes the promise true, and it extracts the ids FROM THE
 * SOURCE rather than restating them here, so adding a fifth bogus id later
 * still goes red.
 *
 * THE STAKES
 *
 * An approval on this screen spends an employee's statutory sick-leave balance
 * and creates a wage payable. Getting it wrong in the generous direction costs
 * money; getting it wrong in the stingy direction is a WAC 296-128-770
 * retaliation exposure with the employee's own record as the evidence.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adminNav } from "@/components/admin/admin-nav-data";
import { SICK_LEAVE_AUTHORITIES } from "@/lib/payroll/sick-leave-authorities";
import {
  SICK_LEAVE_REFUSAL_LESSONS,
  SICK_LEAVE_REVIEW_CHECKS,
} from "@/lib/payroll/sick-leave-mentor";

/* ─────────────────────────────────────────────────────────────────────────────
 * Sources under test
 * ───────────────────────────────────────────────────────────────────────────── */

const ROOT = join(__dirname, "..", "..");

const PAGE_PATH = join(ROOT, "src", "app", "admin", "books", "leave", "page.tsx");
const ACTIONS_PATH = join(ROOT, "src", "app", "admin", "books", "leave", "actions.ts");
const VIEW_PATH = join(
  ROOT,
  "src",
  "components",
  "admin",
  "books",
  "LeaveInboxWorkbench.tsx",
);
const STORE_PATH = join(ROOT, "src", "lib", "payroll", "sick-leave-store.ts");
const MIGRATION_PATH = join(
  ROOT,
  "supabase",
  "migrations",
  "0198_sick_leave_and_garnishments.sql",
);

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const actionsSrc = readFileSync(ACTIONS_PATH, "utf8");
const viewSrc = readFileSync(VIEW_PATH, "utf8");
const storeSrc = readFileSync(STORE_PATH, "utf8");
const migrationSrc = readFileSync(MIGRATION_PATH, "utf8");

/**
 * Comments stripped, so a rule merely DESCRIBED in prose cannot satisfy a test
 * looking for the rule IMPLEMENTED in code.
 *
 * This matters more here than almost anywhere else in the repo: these four
 * files carry very long explanatory headers, deliberately, because Michael
 * asked for "rich mentorship and expert guidance" in the code itself. Those
 * headers name nearly every identifier asserted below. Without this step most
 * of this file would pass on the strength of its own commentary, which is the
 * definition of a test that measures nothing.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const pageCode = stripComments(pageSrc);
const actionsCode = stripComments(actionsSrc);
const viewCode = stripComments(viewSrc);
const storeCode = stripComments(storeSrc);

/* ═════════════════════════════════════════════════════════════════════════════
 * 0) THE STRIPPER ITSELF (standing rule 39: guard the vacuous read)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the comment-stripping helper actually strips (rule 39)", () => {
  it("leaves real code behind", () => {
    // If any of these produced an empty string, every source assertion below
    // would pass vacuously and this whole file would be theatre.
    expect(pageCode.length).toBeGreaterThan(500);
    expect(actionsCode.length).toBeGreaterThan(500);
    expect(viewCode.length).toBeGreaterThan(4_000);
    expect(storeCode.length).toBeGreaterThan(4_000);

    expect(pageCode).toContain("export default async function LeaveApprovalsPage");
    expect(actionsCode).toContain("export async function decideLeaveRequestAction");
    expect(viewCode).toContain("export function LeaveInboxWorkbench");
    expect(storeCode).toContain("export async function loadLeaveInbox");
    expect(storeCode).toContain("export async function decideRequest");
  });

  it("removes phrases that exist only inside comments", () => {
    // One distinctive phrase per file, each of which sits whole on a single
    // comment line and appears nowhere in executable code.
    expect(pageSrc).toContain("legally fiddly");
    expect(pageCode).not.toContain("legally fiddly");

    expect(actionsSrc).toContain("defendant's own evidence");
    expect(actionsCode).not.toContain("defendant's own evidence");

    expect(viewSrc).toContain("wall of text nobody reads");
    expect(viewCode).not.toContain("wall of text nobody reads");

    expect(storeSrc).toContain("a disabled");
    expect(storeCode).not.toContain("a disabled");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 1) THE GATE IS ON EVERY ENTRY POINT, NOT JUST THE PAGE
 *
 * `sick-leave-store.ts` uses the SERVICE ROLE, which bypasses the owner-only
 * RLS that migration 0198 puts on `sick_leave_ledger` and on updating a
 * request. The database gate is INERT on this path. `requireBooksAccess()` is
 * not a second line of defence here - it is the only one.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the owner gate protects both the render and the write", () => {
  it("the page awaits the gate BEFORE it reads anything", () => {
    expect(pageCode).toContain("await requireBooksAccess()");

    const gateAt = pageCode.indexOf("await requireBooksAccess()");
    const readAt = pageCode.indexOf("loadLeaveInbox()");
    expect(gateAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(-1);
    // Data fetched before the gate is data fetched for a caller who was never
    // authorised, even if the render is later discarded.
    expect(gateAt).toBeLessThan(readAt);
  });

  it("the server action calls the gate ITSELF, first thing", () => {
    /*
     * Rule 56: an exported server action is a public HTTP endpoint. Next.js
     * publishes every "use server" export at a generated URL reachable with a
     * bare POST and no page load at all. A gate that lives only in page.tsx
     * protects the rendering, not the action.
     */
    expect(actionsCode).toContain("await requireBooksAccess()");

    const body = actionsCode.slice(
      actionsCode.indexOf("export async function decideLeaveRequestAction"),
    );
    expect(body.length).toBeGreaterThan(400);

    const gateAt = body.indexOf("await requireBooksAccess()");
    const writeAt = body.indexOf("decideRequest(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(writeAt);
  });

  it("the action module is a server-action module and the view is a client one", () => {
    expect(actionsSrc.trimStart().startsWith('"use server"')).toBe(true);
    expect(viewSrc.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("the store can never be pulled into a browser bundle", () => {
    /*
     * THREE DIFFERENT MECHANISMS, AND THEY ARE NOT INTERCHANGEABLE. This test
     * asserted the wrong one on its first run and went red, which is the
     * correct outcome and worth recording rather than quietly fixing.
     *
     *   "use client" / "use server"  are DIRECTIVES. They must be the literal
     *     first statement of the file, as a bare string expression, and Next.js
     *     reads them positionally. Hence `trimStart().startsWith(...)` above.
     *
     *   `import "server-only"` is an ordinary IMPORT of a real npm package
     *     whose browser entry point does nothing but throw at build time. It
     *     works from anywhere in the import list, so a position check is the
     *     wrong shape of assertion entirely - it would fail on correct code.
     *
     * The distinction matters because this module constructs the SERVICE-ROLE
     * Supabase client. That key bypasses every RLS policy in the database. If
     * it ever reached a browser bundle it would not be a bug, it would be a
     * total compromise of the record - so the guard is asserted on the
     * comment-stripped code, where a mention in prose cannot satisfy it.
     */
    expect(storeCode).toMatch(/^\s*import\s+["']server-only["'];?\s*$/m);
    // And the reason it matters is real: this file really does hold the key.
    expect(storeCode).toContain("createSupabaseAdminClient");
  });

  it("the page never renders a stale cache of somebody else's inbox", () => {
    expect(pageCode).toContain('export const dynamic = "force-dynamic"');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 2) THE DECIDER'S IDENTITY COMES FROM THE SESSION, NEVER THE FORM
 *
 * A decision whose name arrives in the request body is not a decision, it is a
 * text field. This particular text field would be the employer's own evidence
 * in a WAC 296-128-770 retaliation claim, so it is worth a test of its own.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("who approved it is recorded from the session", () => {
  it("the staff id is read off the authenticated session", () => {
    expect(actionsCode).toContain("const session = await requireBooksAccess()");
    expect(actionsCode).toContain("decidedByStaffId: session.profile.id");
  });

  it("the action's input type has no staff-id field at all", () => {
    /*
     * Stronger than checking it is unused: if the parameter does not exist,
     * a future edit cannot start trusting it. The whole input surface is three
     * fields, and this pins the shape rather than one line inside it.
     */
    const sig = actionsCode.slice(
      actionsCode.indexOf("export async function decideLeaveRequestAction"),
      actionsCode.indexOf("const session = await requireBooksAccess()"),
    );
    expect(sig.length).toBeGreaterThan(50);
    expect(sig).toContain("requestId: string");
    expect(sig).toContain('decision: "approve" | "deny"');
    expect(sig).toContain("note: string | null");
    expect(sig).not.toContain("StaffId");
    expect(sig).not.toContain("staffId");
  });

  it("the decision word is validated rather than defaulted (rule 62d)", () => {
    // GUARD: an unrecognised decision must REFUSE. Falling through to "deny"
    // would be a silent denial; falling through to "approve" would be worse.
    expect(actionsCode).toMatch(
      /if\s*\(\s*input\.decision\s*!==\s*"approve"\s*&&\s*input\.decision\s*!==\s*"deny"\s*\)/,
    );
    const guardAt = actionsCode.search(
      /if\s*\(\s*input\.decision\s*!==\s*"approve"\s*&&\s*input\.decision\s*!==\s*"deny"\s*\)/,
    );
    const callAt = actionsCode.indexOf("await decideRequest(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(callAt);
  });

  it("a missing request id refuses instead of deciding something arbitrary", () => {
    expect(actionsCode).toMatch(/if\s*\(\s*!input\.requestId\s*\)/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 3) THE ACTION FAILS INTO A SENTENCE, NOT A BLANK SCREEN
 *
 * Michael's standing complaint about Sage was being stopped without being told
 * why. A thrown error in a server action renders an error boundary: a blank
 * screen where the guidance used to be.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("nothing on this path throws", () => {
  it("the action never throws", () => {
    expect(actionsCode).not.toContain("throw new Error");
    expect(actionsCode).not.toContain("throw new ");
  });

  it("every failure carries a readable message", () => {
    expect(actionsCode).toMatch(/ok:\s*false,\s*\n?\s*message:/);
  });

  it("the store never throws either - it returns a typed refusal", () => {
    expect(storeCode).not.toContain("throw new Error");
    expect(storeCode).toContain("export type StoreFailure");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 4) APPROVING REVALIDATES BOTH SCREENS - THIS IS OPTION 1 IN ONE LINE
 *
 * The timesheet reads APPROVED requests. The moment one is approved, the
 * timesheet page's cached render is wrong. Forgetting this second call is the
 * failure mode where Michael approves a sick day, opens the timesheet, does not
 * see it, and approves it again.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("a successful decision refreshes the inbox AND the timesheet", () => {
  it("revalidates this screen", () => {
    expect(actionsCode).toContain('const SCREEN = "/admin/books/leave"');
    expect(actionsCode).toContain("revalidatePath(SCREEN)");
  });

  it("revalidates the timesheet, because approved leave lands there", () => {
    expect(actionsCode).toContain('revalidatePath("/admin/books/timesheets")');
  });

  it("neither revalidation happens on a failed decision", () => {
    // Revalidating after a refusal is harmless but dishonest: it implies
    // something changed. More importantly, if the revalidations sat BEFORE the
    // failure check, they would also run on the paths that changed nothing.
    const failAt = actionsCode.indexOf("if (!res.ok)");
    const revalAt = actionsCode.indexOf("revalidatePath(SCREEN)");
    expect(failAt).toBeGreaterThan(-1);
    expect(revalAt).toBeGreaterThan(-1);
    expect(failAt).toBeLessThan(revalAt);
  });

  it("the refusal list from the store is passed through to the screen", () => {
    // Rule 64a: detection is not explanation. Swallowing the refusals and
    // showing only the summary sentence would strip the per-reason guidance
    // that tells Michael what to actually do.
    expect(actionsCode).toContain("failure.refusals ?? []");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 5) THE PAGE MOUNTS THE VIEW AND TELLS THE TRUTH WHEN IT CANNOT READ
 *
 * "Nobody has requested sick leave" and "the requests could not be read" look
 * identical as an empty list and mean opposite things. One of them leaves an
 * employee waiting on a decision nobody knows they asked for.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("a read failure is reported as a read failure", () => {
  it("GUARD: the branch is the real ok flag, not a constant", () => {
    expect(pageCode).toMatch(/\{\s*!inbox\.ok\s*\?/);
  });

  it("RENDER: the store's own message reaches the screen", () => {
    expect(pageCode).toMatch(/\{\s*inbox\.message\s*\}/);
  });

  it("the guard precedes the render, i.e. they are the same block", () => {
    const guardAt = pageCode.search(/\{\s*!inbox\.ok\s*\?/);
    const renderAt = pageCode.search(/\{\s*inbox\.message\s*\}/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(guardAt);
  });

  it("it says in words that this is NOT an empty inbox", () => {
    // The sentence is the point. Without it a reader draws the wrong
    // conclusion from a red box that merely says "error".
    expect(pageCode).toContain("empty inbox");
    expect(pageCode).toContain("nothing was changed");
  });

  it("mounts the workbench on the success branch and hands it the action", () => {
    expect(pageCode).toContain("<LeaveInboxWorkbench");
    expect(pageCode).toContain("decideAction={decideLeaveRequestAction}");
    expect(pageCode).toContain("requests={inbox.requests}");
    expect(pageCode).toContain("clearCount={inbox.clearCount}");
    expect(pageCode).toContain("blockedCount={inbox.blockedCount}");
    expect(pageCode).toContain("policyRefusals={inbox.policyRefusals}");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 6) THE VIEW SHOWS EVERY REASON IT WAS GIVEN
 *
 * Each block is pinned GUARD-then-RENDER for the reason in the file header.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("policy problems are shown once, not once per employee", () => {
  it("GUARD: the real list length is tested", () => {
    expect(viewCode).toMatch(/\{\s*policyRefusals\.length\s*>\s*0\s*\?/);
  });

  it("RENDER: each policy refusal is rendered", () => {
    expect(viewCode).toContain("policyRefusals.map(");
    expect(viewCode).toContain("<RefusalBlock");
  });

  it("it says plainly that these are settings, not employee problems", () => {
    expect(viewCode).toContain("These are settings, not employee problems");
  });

  it("the store really does de-duplicate them (the claim the card makes)", () => {
    // Rule 39 again: the card promises fixing one setting clears every row.
    // That promise is only true because the store collapses repeated codes.
    expect(storeCode).toContain("const seen = new Set<string>()");
    expect(storeCode).toMatch(/POLICY_CODES\.has\(f\.code\)\s*&&\s*!seen\.has\(f\.code\)/);
  });

  it("the policy code list is TYPED, so a renamed refusal breaks the build", () => {
    /*
     * Standing rule 62d, applied to a Set of strings. An untyped
     * `new Set([...])` of codes would keep compiling after a rename and simply
     * stop matching - and a policy problem would silently start repeating
     * itself once per row again, forever, with nothing red anywhere.
     */
    expect(storeCode).toContain("new Set<SickLeaveRefusalCode>(");
  });
});

describe("a blocked request explains itself without pretending to be a refusal", () => {
  it("GUARD: the real blockedBy value is tested", () => {
    expect(viewCode).toMatch(/\{\s*req\.blockedBy\s*\?/);
  });

  it("RENDER: the sentence reaches the screen", () => {
    expect(viewCode).toMatch(/\{\s*req\.blockedBy\s*\}/);
  });

  it("it is a plain sentence, deliberately NOT an invented refusal code (rule 43)", () => {
    /*
     * A missing hire date is a DATA problem: the engine was never asked, so it
     * cannot have refused. Minting a `SickLeaveRefusal` for it would put a code
     * in the union that the engine can never emit - an unreachable refusal,
     * which is the exact thing rule 43 forbids.
     */
    expect(storeCode).toContain("blockedBy: string | null");
    expect(storeCode).toContain("no hire date on file");
    // And it must not have smuggled a fake code in anyway.
    expect(storeCode).not.toContain("NO_HIRE_DATE_ON_FILE");
  });

  it("the engine is not called at all when the hire date is missing", () => {
    // Calling reviewRequest with a guessed date is the failure this avoids:
    // "hired long ago" approves leave that is not yet usable, "hired today"
    // denies leave already earned. Both are confident and wrong.
    expect(storeCode).toMatch(/if\s*\(\s*!emp\s*\|\|\s*!emp\.hire_date\s*\)/);
  });
});

describe("engine refusals reach the row they belong to", () => {
  it("GUARD: the real refusal count is tested", () => {
    expect(viewCode).toMatch(/\{\s*req\.refusals\.length\s*>\s*0\s*\?/);
  });

  it("RENDER: they are mapped into refusal blocks", () => {
    expect(viewCode).toContain("req.refusals.map(");
  });

  it("a refusal block prints BOTH the message and the fix", () => {
    // Rule 64a: detection is not explanation. "This cannot be approved" with
    // no next step is a wall, not guidance.
    expect(viewCode).toContain("{refusal.message}");
    expect(viewCode).toContain("{refusal.fix}");
    expect(viewCode).toContain("What to do: ");
  });

  it("refused requests are still LISTED, never hidden", () => {
    /*
     * Hiding one would leave an employee waiting indefinitely on a request
     * Michael never knew existed. There must be no filter on the rendered list
     * that drops rows by refusal state.
     */
    expect(viewCode).toContain("requests.map(");
    expect(viewCode).not.toMatch(/requests\s*\.\s*filter\s*\(/);
  });
});

describe("the engine's own explanation of the approval is shown", () => {
  it("GUARD: the real review object is tested", () => {
    expect(viewCode).toMatch(/\{\s*req\.review\s*\?/);
  });

  it("RENDER: the explanation reaches the screen", () => {
    expect(viewCode).toMatch(/\{\s*req\.review\.explanation\s*\}/);
  });

  it("GUARD and RENDER for the notice shortfall note, pinned apart", () => {
    /*
     * WAC 296-128-650 lets an employer require notice, but a shortfall does NOT
     * by itself justify denying leave. This note says so. Silently dropping it
     * would leave a reader thinking "they gave no notice" is a reason to deny -
     * which is the single most common way a well-meaning employer creates a
     * retaliation claim.
     */
    expect(viewCode).toMatch(/\{\s*req\.review\.noticeShortfallNote\s*\?/);
    expect(viewCode).toMatch(/\{\s*req\.review\.noticeShortfallNote\s*\}/);
    const guardAt = viewCode.search(/\{\s*req\.review\.noticeShortfallNote\s*\?/);
    const renderAt = viewCode.search(/\{\s*req\.review\.noticeShortfallNote\s*\}/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(guardAt);
  });
});

describe("the employee's own words are shown to the person deciding", () => {
  it("GUARD and RENDER, pinned apart", () => {
    expect(viewCode).toMatch(/\{\s*req\.employeeNote\s*\?/);
    expect(viewCode).toMatch(/\{\s*req\.employeeNote\s*\}/);
  });
});

describe("the result of the last decision is always displayed", () => {
  it("GUARD and RENDER for the result banner", () => {
    expect(viewCode).toMatch(/\{\s*result\s*\?/);
    expect(viewCode).toMatch(/\{\s*result\.message\s*\}/);
  });

  it("GUARD and RENDER for the refusals attached to a failed decision", () => {
    expect(viewCode).toMatch(/\{\s*!result\.ok\s*&&\s*result\.refusals\.length\s*>\s*0\s*\?/);
    expect(viewCode).toContain("result.refusals.map(");
  });

  it("a failure banner says 'Nothing was changed' in the heading", () => {
    expect(viewCode).toContain("Nothing was changed");
  });

  it("GUARD and RENDER for the blocked-count badge", () => {
    expect(viewCode).toMatch(/\{\s*blockedCount\s*>\s*0\s*\?/);
    expect(viewCode).toContain("{blockedCount} blocked");
  });

  it("GUARD and RENDER for the empty state", () => {
    expect(viewCode).toMatch(/\{\s*requests\.length\s*===\s*0\s*\?/);
    expect(viewCode).toContain("No sick leave is waiting for a decision");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 7) THE AUTHORITY IDS RESOLVE - PAYING THE DEBT IN THE VIEW'S OWN COMMENT
 *
 * `LeaveInboxWorkbench.tsx` says these ids are "checked at build time by
 * tests/compliance/leave-inbox-screen.test.ts against the real registry, so a
 * typo here cannot render a blank card." Until this section existed, that
 * sentence was false - and the view's own `if (!a) return null` means a typo
 * fails SILENTLY, rendering nothing where a quotation should be.
 *
 * The repo's existing tripwire, `authority-id-resolution.test.ts`, does NOT
 * cover this: it extracts ids from `authorityIds: [...]` arrays and this is a
 * differently named constant.
 *
 * The ids are read OUT OF THE SOURCE, not restated here, so adding a fifth
 * bogus id later still goes red.
 * ═════════════════════════════════════════════════════════════════════════════ */

function selectedAuthorityIds(): string[] {
  const start = viewSrc.indexOf("const SELECTED_AUTHORITY_IDS = [");
  expect(start, "SELECTED_AUTHORITY_IDS was renamed or deleted").toBeGreaterThan(-1);
  const end = viewSrc.indexOf("] as const;", start);
  expect(end, "SELECTED_AUTHORITY_IDS is no longer an `as const` array").toBeGreaterThan(
    start,
  );
  const block = viewSrc.slice(start, end);
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("every authority quoted on this screen actually exists", () => {
  const ids = selectedAuthorityIds();

  it("the extractor found ids at all (rule 39: no vacuous pass)", () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it("each id resolves in SICK_LEAVE_AUTHORITIES", () => {
    const known = new Set(SICK_LEAVE_AUTHORITIES.map((a) => a.id));
    const missing = ids.filter((id) => !known.has(id));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `These ids are quoted by LeaveInboxWorkbench but do not exist in the registry, ` +
            `so the screen renders a blank card where the law should be: ${missing.join(", ")}. ` +
            `Real ids: ${[...known].sort().join(", ")}`,
    ).toEqual([]);
  });

  it("each resolved authority has a real quote and a real citation", () => {
    // A resolvable id pointing at an empty quote is the same blank card by a
    // different route.
    for (const id of ids) {
      const a = SICK_LEAVE_AUTHORITIES.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a!.quote.length, `${id} quote`).toBeGreaterThan(40);
      expect(a!.cite.length, `${id} cite`).toBeGreaterThan(5);
      expect(a!.soWhat.length, `${id} soWhat`).toBeGreaterThan(20);
    }
  });

  it("the view maps over the list and renders the quote VERBATIM", () => {
    /*
     * Michael, verbatim: "Please keep including that including the verbatim
     * source text." So the quotation is rendered from the registry field, not
     * retyped into JSX where it could drift from the regulation.
     */
    expect(viewCode).toContain("SELECTED_AUTHORITY_IDS.map(");
    expect(viewCode).toContain("{a.quote}");
    expect(viewCode).toContain("{a.cite}");
    expect(viewCode).toContain("{a.soWhat}");
    expect(viewCode).toContain("<blockquote");
  });

  it("the screen says which part is the law and which part is us", () => {
    // Mixing a paraphrase into a quotation block is how a plain-English gloss
    // ends up being read back as the regulation's actual words.
    expect(viewSrc).toContain("which is the law and which is us");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 8) THE MENTOR LAYER IS ON THE SCREEN, NOT JUST IN THE MODULE (rule 26)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the review checklist is rendered in its stated order", () => {
  it("the view sorts by the mentor's own order field", () => {
    // Relying on array position would silently reorder Michael's decision
    // process the next time someone inserts a check in the middle.
    expect(viewCode).toContain("SICK_LEAVE_REVIEW_CHECKS");
    expect(viewCode).toMatch(/\.sort\(\s*\(a,\s*b\)\s*=>\s*a\.order\s*-\s*b\.order\s*\)/);
  });

  it("each check shows the question, why it is asked there, and the failure path", () => {
    expect(viewCode).toContain("{check.question}");
    expect(viewCode).toContain("{check.whyThisOrder}");
    expect(viewCode).toContain("{check.ifItFails}");
    expect(viewCode).toContain("If it fails: ");
  });

  it("the mentor really does carry a full, gap-free ordering", () => {
    /*
     * The screen numbers the steps 1..n straight from `check.order`. A
     * duplicated or skipped order would print "1, 2, 2, 4" and quietly imply a
     * step is missing.
     */
    const orders = SICK_LEAVE_REVIEW_CHECKS.map((c) => c.order).sort((a, b) => a - b);
    expect(orders.length).toBeGreaterThanOrEqual(6);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
  });
});

describe("the selected request's refusals get the long-form lesson", () => {
  it("GUARD: the selected row's real refusal count is tested", () => {
    expect(viewCode).toMatch(
      /\{\s*selected\s*&&\s*selected\.refusals\.length\s*>\s*0\s*\?/,
    );
  });

  it("RENDER: headline, why we stop, and what to do all reach the screen", () => {
    expect(viewCode).toContain("SICK_LEAVE_REFUSAL_LESSONS.find(");
    expect(viewCode).toContain("{lesson.headline}");
    expect(viewCode).toContain("{lesson.whyWeStop}");
    expect(viewCode).toContain("{lesson.whatToDo}");
  });

  it("there is a lesson for every refusal the engine can emit", () => {
    /*
     * The view does `if (!lesson) return null`, so an untaught code renders
     * NOTHING - the most confusing possible outcome, because the row is held up
     * and the panel explaining why is blank. sick-leave-mentor.test.ts proves
     * the coverage against the engine's union type; this asserts the list this
     * screen consumes is the non-empty one.
     */
    expect(SICK_LEAVE_REFUSAL_LESSONS.length).toBeGreaterThanOrEqual(18);
    const codes = new Set(SICK_LEAVE_REFUSAL_LESSONS.map((l) => l.code));
    expect(codes.size).toBe(SICK_LEAVE_REFUSAL_LESSONS.length);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 9) THE BUTTONS ENFORCE THE RIGHT ASYMMETRY
 *
 * Approving spends a statutory balance and creates a payable. Denying spends
 * nothing. So approval is blocked while anything is unresolved, and denial
 * never is - because an employee waiting on a request that CANNOT be approved
 * and CANNOT be denied is the worst of the three outcomes.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("approve is gated, deny is always available", () => {
  const approveBtn = viewCode.slice(
    viewCode.indexOf('variant="confirm"'),
    viewCode.indexOf("Approve this day"),
  );
  const denyBtn = viewCode.slice(
    viewCode.indexOf('variant="danger"'),
    viewCode.indexOf("Deny"),
  );

  it("the two button blocks were actually located (rule 39)", () => {
    expect(approveBtn.length).toBeGreaterThan(20);
    expect(approveBtn.length).toBeLessThan(400);
    expect(denyBtn.length).toBeGreaterThan(20);
    expect(denyBtn.length).toBeLessThan(400);
  });

  it("approve is disabled while the row is blocked", () => {
    expect(approveBtn).toMatch(/disabled=\{\s*pending\s*\|\|\s*blocked\s*\}/);
  });

  it("deny is disabled ONLY while a request is in flight", () => {
    expect(denyBtn).toMatch(/disabled=\{\s*pending\s*\}/);
    expect(denyBtn).not.toContain("blocked");
  });

  it("`blocked` is the real combination of both blocking reasons", () => {
    // A row can be held up by an ENGINE refusal or by a DATA problem. Testing
    // only one of them re-enables approval for the other.
    expect(viewCode).toMatch(
      /const blocked\s*=\s*req\.refusals\.length\s*>\s*0\s*\|\|\s*req\.blockedBy\s*!==\s*null/,
    );
  });

  it("the store counts 'blocked' the same way the screen does", () => {
    /*
     * Two definitions of the same word is two numbers that eventually disagree.
     * The badge would then say "3 ready" while three buttons sat disabled.
     */
    expect(storeCode).toMatch(
      /if\s*\(refusals\.length\s*>\s*0\s*\|\|\s*blockedBy\s*!==\s*null\)\s*blocked\s*\+=\s*1/,
    );
  });

  it("the disabled button is explained rather than just greyed out", () => {
    expect(viewCode).toContain("Approving is unavailable until the point above is resolved");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 10) THE SCREEN COMPUTES NOTHING (standing rule 63d)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("no money and no balance is calculated in the browser", () => {
  it("balance and request fields are never combined arithmetically", () => {
    /*
     * Every figure here was summed from the ledger by `computeBalance`. Two
     * places computing the same balance is two places to disagree, and the
     * disagreement surfaces on somebody's pay.
     */
    const arithmeticOnEngineFields =
      /(statutoryMinutes|awardedMinutes|totalMinutes|minutesRequested)\s*[+\-*/]\s*\w/;
    expect(viewCode).not.toMatch(arithmeticOnEngineFields);
  });

  it("the view does not price the leave - that is not its job", () => {
    /*
     * WAC 296-128-670(1) requires the GREATER of normal hourly compensation and
     * the applicable minimum wage. A screen that multiplied minutes by a rate
     * would be implementing that rule a second time, in the one place nobody
     * tests numerically.
     */
    expect(viewCode).not.toContain("Cents");
    expect(viewCode).not.toContain("milliCents");
    expect(viewCode).not.toContain("toFixed(");
  });

  it("the draw is planned by the ENGINE, positionally and in the right order", () => {
    /*
     * `planDraw(balance, requestedMinutes)` is POSITIONAL. Passing an object
     * compiles - the parameters are structurally satisfied by nothing - and
     * both arguments arrive `undefined`, so every approval refuses with a
     * message about zero minutes. This pins the real call shape.
     */
    expect(storeCode).toContain("planDraw(balance, row.minutes_requested)");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 11) THE WRITE ORDER, AND THE THING THAT MUST NEVER HAPPEN
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("approval writes the ledger before it writes the decision", () => {
  const approvalPath = storeCode.slice(
    storeCode.indexOf("const draw = planDraw("),
  );

  it("the approval path was located (rule 39)", () => {
    expect(approvalPath.length).toBeGreaterThan(1_000);
  });

  it("the ledger insert precedes the status update", () => {
    /*
     * Ledger first, deliberately. If the SECOND write fails you get a request
     * still showing pending with a ledger row against it - an over-recorded
     * draw, visible immediately on the balance, and fixable. The other order
     * leaves an APPROVED request with no ledger row: it looks perfect on screen
     * and quietly pays leave nobody deducted.
     */
    const insertAt = approvalPath.indexOf('.from("sick_leave_ledger").insert(');
    const updateAt = approvalPath.indexOf('.from("sick_leave_requests")');
    expect(insertAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(updateAt);
  });

  it("the status update is conditional on the row still being pending", () => {
    // Two people in the inbox at once must not both spend the same balance.
    expect(approvalPath).toContain('.eq("status", "pending")');
  });

  it("a request already decided is refused, not silently re-decided", () => {
    expect(storeCode).toMatch(/if\s*\(row\.status\s*!==\s*"pending"\)/);
  });

  it("a half-completed approval says so LOUDLY instead of reporting a clean failure", () => {
    /*
     * If the ledger row went in and the status update failed, "nothing was
     * changed" would be a lie that gets the balance spent twice.
     */
    expect(storeSrc).toContain("do NOT approve it again");
  });

  it("the engine is re-run at the moment of the write, not trusted from the screen", () => {
    // Standing rule 63c. The rendered verdict may be minutes old: a balance can
    // have moved, a policy can have been saved, another day of the same absence
    // can have been approved in another tab.
    const reviewAt = approvalPath.indexOf("const draw = planDraw(");
    expect(storeCode.indexOf("const review = reviewRequest(")).toBeLessThan(
      storeCode.indexOf("const draw = planDraw("),
    );
    expect(reviewAt).toBeGreaterThan(-1);
    expect(approvalPath).toContain('.from("sick_leave_ledger").insert(');
  });

  it("one ledger row per bucket, so the ledger records WHERE each minute came from", () => {
    /*
     * This is what migration 0200 had to widen an index for: a lawful split
     * draw needs TWO usage rows against one request. Collapsing them into one
     * would destroy the statutory/awarded distinction the carryover cap depends
     * on.
     */
    expect(storeCode).toMatch(/if\s*\(draw\.value\.fromStatutoryMinutes\s*>\s*0\)/);
    expect(storeCode).toMatch(/if\s*\(draw\.value\.fromAwardedMinutes\s*>\s*0\)/);
    expect(storeCode).toContain('drawn_from: "statutory"');
    expect(storeCode).toContain('drawn_from: "awarded"');
  });

  it("a zero-minute draw is refused as a DEFECT, never written", () => {
    expect(storeCode).toMatch(/if\s*\(ledgerRows\.length\s*===\s*0\)/);
    expect(storeSrc).toContain("tell the developer");
  });
});

describe("a denial cannot be recorded without a reason", () => {
  it("the store refuses a short note before it touches the database", () => {
    expect(storeCode).toMatch(
      /args\.decision\s*===\s*"deny"\s*&&\s*trimmedNote\.length\s*<\s*10/,
    );
  });

  it("the application floor matches the database CHECK, so neither is decorative", () => {
    /*
     * Rule 65: CI must catch what a build system can. If the app allowed 5
     * characters the database would reject the write with a constraint error
     * Michael cannot read; if the app demanded 50 the database constraint would
     * never fire and nobody would notice when it was dropped.
     */
    expect(migrationSrc).toMatch(
      /length\(btrim\(decision_note\)\)\s*>=\s*10/,
    );
  });

  it("a denial moves no minutes", () => {
    /*
     * SLICING THIS BLOCK IS THE WHOLE DIFFICULTY, AND THE FIRST ATTEMPT GOT IT
     * WRONG - usefully so. It ran the slice from the deny branch all the way to
     * `planDraw(`, which is deep inside the APPROVAL path, so the "denial" text
     * being searched included the approval's ledger read and the assertion went
     * red against code that is perfectly correct.
     *
     * That is standing rule 39 in miniature: a badly bounded read tests the
     * wrong text, and it can fail on good code exactly as easily as it can pass
     * on bad. The boundary used now is the FIRST thing after the deny branch
     * closes - the approval path's hire-date guard - and the length assertions
     * below bracket it from both sides so silent re-bounding cannot go
     * unnoticed.
     *
     * The rule being protected: WAC 296-128-620 leave is earned by working. A
     * denial is a decision not to spend it, so the balance must be untouched.
     * A denial that decremented the balance would take earned leave away for
     * nothing - the single worst outcome this screen could produce.
     */
    const start = storeCode.indexOf('if (args.decision === "deny") {');
    const end = storeCode.indexOf("if (!emp || !emp.hire_date)", start);
    expect(start, "the deny branch was renamed").toBeGreaterThan(-1);
    expect(end, "the approval hire-date guard moved above the deny branch").toBeGreaterThan(
      start,
    );

    const denialPath = storeCode.slice(start, end);
    // Bracketed both ways: too short means the branch was gutted, too long
    // means the slice has swallowed the approval path again.
    expect(denialPath.length).toBeGreaterThan(400);
    expect(denialPath.length).toBeLessThan(2_000);

    expect(denialPath).not.toContain("sick_leave_ledger");
    expect(denialPath).not.toContain("planDraw");
    expect(denialPath).toContain("No leave was deducted from their balance");
    expect(denialPath).toContain('status: "denied"');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 12) EVERY PURPOSE THE DATABASE ALLOWS HAS WORDS ON SCREEN
 *
 * Read out of migration 0198's own CHECK constraint rather than restated here,
 * so adding a sixth purpose to the schema without wording it fails HERE, at the
 * point of the change - not in front of Michael as a blank where a reason
 * should be.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the purpose codes are all worded for a human", () => {
  const match = migrationSrc.match(/check\s*\(purpose\s+in\s*\(([\s\S]*?)\)\)/);
  const purposes = match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];

  it("the CHECK constraint was actually parsed (rule 39)", () => {
    expect(match, "the purpose CHECK constraint in 0198 was renamed or reformatted").not.toBeNull();
    expect(purposes.length).toBe(5);
  });

  it("every allowed purpose has wording in the view", () => {
    const missing = purposes.filter((p) => !viewCode.includes(`${p}:`));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `Migration 0198 allows these purposes but LeaveInboxWorkbench has no wording for ` +
            `them, so the row shows a raw database code: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("an unknown purpose falls back HONESTLY rather than inventing a label", () => {
    /*
     * Standing rule 62d - never invent a default. Showing the raw value makes
     * Michael ask what it is; showing a friendly guess makes him believe it.
     */
    expect(viewCode).toContain('Recorded as "${purpose}"');
  });

  it("foreseeable and unforeseeable notice are distinguished on the row", () => {
    // WAC 296-128-650(1)(a) permits a ten-day notice requirement for
    // FORESEEABLE leave; (1)(b) only "as soon as possible" for unforeseeable.
    // Two different rules, so the reader has to be told which one applied.
    expect(viewCode).toMatch(/req\.noticeKind\s*===\s*"unforeseeable"/);
    expect(viewCode).toContain("(foreseeable)");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 13) THE SCREEN IS REACHABLE (rule 50: dead code wearing a green check)
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("the nav entry makes the inbox reachable and gated", () => {
  const entry = adminNav.find((i) => i.href === "/admin/books/leave");

  it("exists at all", () => {
    expect(
      entry,
      "Nothing in the admin nav points at /admin/books/leave, so the approval " +
        "inbox is unreachable and every sick-leave request sits pending forever.",
    ).toBeDefined();
  });

  it("lands in ACCOUNTING, which is where Michael asked for it", () => {
    /*
     * Verbatim: "It should reach me in accounting somewhere logical." Approving
     * sick leave moves a balance, creates a payable, lands on a paycheque and
     * ends up in box 1 of a W-2. Staffing holds the schedule; accounting holds
     * the ledger, and this writes to a ledger.
     */
    expect(entry?.group).toBe("Accounting");
  });

  it("is gated on books.view, the same permission the page enforces", () => {
    expect(entry?.permission).toBe("books.view");
  });

  it("has a label a person would recognise", () => {
    expect(entry?.label).toBe("Sick Leave Approvals");
  });

  it("sits immediately after Timesheets, because both feed the same pay run", () => {
    const idx = adminNav.findIndex((i) => i.href === "/admin/books/leave");
    const tsIdx = adminNav.findIndex((i) => i.href === "/admin/books/timesheets");
    expect(tsIdx).toBeGreaterThan(-1);
    expect(idx).toBe(tsIdx + 1);
  });
});
