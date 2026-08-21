/**
 * tests/compliance/inventory-audit-wiring.test.ts   (slice books-23)
 *
 * THE TEST THAT WOULD HAVE CAUGHT THE DEFECT THIS SLICE EXISTS TO FIX.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG, AND WHY EVERY EXISTING TEST PASSED ANYWAY
 * ---------------------------------------------------------------------------
 * `src/lib/inventory/inventory-audit-store.ts` is 767 lines of correct,
 * mutation-tested code that turns a counted difference into a journal entry. It
 * was written in slice books-12. Between books-12 and books-23, NOTHING IN THE
 * APPLICATION IMPORTED IT. The engine had a green test file of its own and no
 * caller, so:
 *
 *   - `tsc` was happy: an exported function with no caller is not an error.
 *   - The suite was green: its own test imported it and exercised it fully.
 *   - The screen LIED: the approved-audit page told the owner the journal entry
 *     was "handled through the posting path", and there was no posting path.
 *
 * An audit could be planned, counted, reasoned, reviewed, approved and signed,
 * and the general ledger would never hear about it. Inventory shrink would sit
 * on the balance sheet as if the product were still on the shelf -- which is the
 * mechanism that let the old Sage file accumulate a $4,624,697.31 inventory plug
 * that nobody ever decided to make.
 *
 * PROPOSED STANDING RULE 50:
 *   A MODULE THAT ONLY ITS OWN TEST IMPORTS IS DEAD CODE WEARING A GREEN CHECK
 *   MARK. Coverage proves a function works. It does not prove anything CALLS it.
 *
 * So section A does not test what the engine computes -- its own test does that
 * well. Section A tests that the engine is REACHABLE from a button, by reading
 * the import graph. It is the only assertion in the suite that would have failed
 * during the eleven slices this defect survived.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE READS SOURCE TEXT
 * ---------------------------------------------------------------------------
 * These are Next.js server components and server actions. They import
 * "server-only", Supabase clients and next/navigation, so importing them into a
 * unit test is not possible. Reading their source is the available technique,
 * and it is used carefully: comments are stripped first, so a sentence ABOUT a
 * function can never satisfy an assertion that the function is CALLED. That
 * mistake is not hypothetical -- the defect above was hidden by prose.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { can, rolesForPermission, ALL_PERMISSIONS } from "@/lib/auth/roles";
import {
  inventoryAccountByCategory,
  taxonomyAgreementProblems,
} from "@/lib/inventory/audit-posting-accounts";
import { INVENTORY_CATEGORIES } from "@/lib/accounting/coa-core";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const HUB = join(SRC, "app", "admin", "inventory", "audits");
const CYCLE = join(SRC, "app", "admin", "inventory", "cycle-counts");

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

/**
 * Strip comments and string literals.
 *
 * Comments are stripped for the reason in the header. STRING LITERALS are
 * stripped too, which matters more than it looks: an error message that
 * mentions `postAuditSession` would otherwise satisfy "something calls
 * postAuditSession". The refusal messages in this slice are long and quote
 * function names, so this is a real hazard rather than a precaution.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/**
 * Strip comments but KEEP string literals.
 *
 * Two helpers are needed, and the difference between them is the difference
 * between two questions:
 *
 *   code()          "does anything CALL this?"      -- strings must go, because a
 *                                                      refusal message quoting a
 *                                                      function name is not a call.
 *   withoutComments() "is this gated on THAT permission?" -- the permission IS a
 *                                                      string literal, so strings
 *                                                      must stay.
 *
 * Using code() for the second question is a mistake I made and the suite caught:
 * `requirePermission("inventory.audit")` becomes `requirePermission("")` once
 * strings are blanked, so the assertion tested text it had itself erased and
 * failed against source that was perfectly correct.
 *
 * Comment stripping is still load-bearing for the permission questions, and not
 * hypothetically: `cycle-counts/page.tsx` carries a header explaining that the
 * page "was requirePermission(\"inventory.manage\")" and "is now
 * requirePermission(\"inventory.count\")". Read raw, that page would satisfy a
 * gate assertion for EITHER permission -- including the one it no longer uses --
 * purely from the note describing the change.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * Strip SQL comments (`--` to end of line).
 *
 * THE SAME LESSON AS code(), IN A SECOND LANGUAGE, and it was learned the same
 * way: a mutation that commented out
 *
 *     drop policy if exists cycle_counts_staff_all on public.cycle_counts;
 *
 * SURVIVED, because the assertion searched the raw file and found the statement
 * sitting inside the `--` comment that disabled it. The test proved the words
 * were present, which was never the question.
 *
 * That is this slice's own headline defect wearing different clothes: prose
 * about a thing being read as the thing itself. These migrations are heavily
 * commented on purpose -- 0194 quotes its own DDL while explaining it -- so the
 * hazard here is not hypothetical, it is guaranteed.
 *
 * String literals are NOT stripped: unlike the TypeScript case, the interesting
 * SQL identifiers are bare words, and the gate-check bodies contain quoted
 * table names that assertions legitimately look for.
 */
function sqlCode(src: string): string {
  return src.replace(/--[^\n]*/g, " ");
}

/** Every .ts/.tsx file under src, so "does anything call X" can be answered. */
function allSourceFiles(dir: string = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allSourceFiles(full, acc);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

/* ══════════════════════════════════════════════════════════════════════════
   A) REACHABILITY — the defect itself
   ══════════════════════════════════════════════════════════════════════════ */

describe("A the posting engine is reachable from the application", () => {
  const files = allSourceFiles();

  it("something OTHER than the engine itself calls postAuditSession", () => {
    // THE ASSERTION THAT WAS MISSING FOR ELEVEN SLICES.
    const callers = files.filter((f) => {
      if (f.endsWith(join("lib", "inventory", "inventory-audit-store.ts"))) return false;
      return /\bpostAuditSession\s*\(/.test(code(readFileSync(f, "utf8")));
    });
    expect(
      callers,
      "postAuditSession() has no caller outside its own module. An audit can be " +
        "approved and the general ledger will never hear about it.",
    ).not.toEqual([]);
  });

  it("the caller is a server action, so it is reachable from a browser", () => {
    // A caller inside another library would still be unreachable. The chain has
    // to terminate at something a click can start.
    const actions = code(read(HUB, "actions.ts"));
    expect(actions).toMatch(/\bpostAuditSession\s*\(/);
    expect(actions).toMatch(/export\s+async\s+function\s+postAuditAction/);
    expect(read(HUB, "actions.ts").startsWith('"use server"')).toBe(true);
  });

  it("a page renders a form that submits that action", () => {
    // ...and the action is reachable from a SCREEN, not merely exported.
    const page = code(read(HUB, "[id]", "page.tsx"));
    expect(page).toMatch(/import\s*\{[^}]*postAuditAction[^}]*\}/);
    expect(page).toMatch(/action=\{postAuditAction\}/);
  });

  it("the form carries the session id the action requires", () => {
    // A form that omits the field the action reads fails at run time only, and
    // only for whoever clicks it.
    const raw = read(HUB, "[id]", "page.tsx");
    const formIdx = raw.indexOf("action={postAuditAction}");
    expect(formIdx).toBeGreaterThan(-1);
    const window = raw.slice(formIdx, formIdx + 400);
    expect(window).toContain('name="sessionId"');
    expect(code(read(HUB, "actions.ts"))).toMatch(
      /postAuditAction[\s\S]{0,900}requiredField\(\s*form\s*,/,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B) THE RETIRED PATHS REALLY REFUSE
   ══════════════════════════════════════════════════════════════════════════ */

describe("B the old cycle-count write paths refuse", () => {
  const lib = read(SRC, "lib", "inventory", "cycle-counts.ts");

  it("applyCycleCount returns a refusal and never moves a lot", () => {
    const body = lib.slice(lib.indexOf("export async function applyCycleCount"));
    const fn = body.slice(0, body.indexOf("\n}\n") + 3);
    expect(fn).toContain("CYCLE_COUNT_APPLY_RETIRED");
    expect(fn).toContain("ok: false");
    // The proof that matters is the ABSENCE of the shelf write.
    expect(code(fn)).not.toMatch(/\bapplyLotDelta\s*\(/);
    expect(code(fn)).not.toMatch(/inventory_adjustments/);
  });

  it("createCycleCount returns a refusal and never inserts a session", () => {
    const body = lib.slice(lib.indexOf("export async function createCycleCount"));
    const fn = body.slice(0, body.indexOf("\n}\n") + 3);
    expect(fn).toContain("CYCLE_COUNT_CREATE_RETIRED");
    expect(fn).toContain("ok: false");
    expect(code(fn)).not.toMatch(/\.insert\(/);
  });

  it("the shelf-moving import is GONE, not merely unused", () => {
    // Leaving `import { applyLotDelta }` in place would make re-enabling the old
    // behaviour a one-line change with no new dependency to notice in review.
    expect(code(lib)).not.toMatch(/import\s*\{[^}]*applyLotDelta[^}]*\}/);
  });

  it("both refusals are reachable from the screens that used to work", () => {
    // Rule 43: a refusal code no path emits is decoration. These are emitted by
    // library functions that the action layer still calls on purpose.
    const actions = code(read(CYCLE, "actions.ts"));
    expect(actions).toMatch(/\bapplyCycleCount\s*\(/);
    expect(actions).toMatch(/\bcreateCycleCount\s*\(/);
    // ...and the attempt is recorded rather than silently swallowed.
    const raw = read(CYCLE, "actions.ts");
    expect(raw).toContain("cycle_count.apply_refused");
    expect(raw).toContain("cycle_count.create_refused");
  });

  it("the dead Apply button is gone from the legacy detail page", () => {
    const detail = code(read(CYCLE, "[id]", "page.tsx"));
    expect(detail).not.toMatch(/\bapplyCycleCountAction\b/);
  });

  it("no create form remains on the counting queue", () => {
    const queue = code(read(CYCLE, "page.tsx"));
    expect(queue).not.toMatch(/\bcreateCycleCountAction\b/);
    expect(queue).not.toMatch(/\bcreateOverdueCycleCountAction\b/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C) NO SCREEN CLAIMS SOMETHING POSTS WHEN IT DOES NOT   (rule 44 / rule 47)
   ══════════════════════════════════════════════════════════════════════════ */

describe("C the prose does not promise a posting that cannot happen", () => {
  it("no cycle-count screen claims variances post or reach the CCRS", () => {
    // The most dangerous claim found in this slice was a COMPLIANCE one: the
    // legacy screen told the owner that variances export to the CCRS
    // InventoryAdjustment.csv. Nothing posted, so nothing exported.
    const suspects = [
      withoutComments(read(CYCLE, "page.tsx")),
      withoutComments(read(CYCLE, "[id]", "page.tsx")),
    ];
    const banned = [
      /variances?\s+(?:are\s+)?post(?:ed)?\s+as/i,
      /adjustments\s+posted/i,
      /Applying\s+posts/i,
      /click\s+Apply\s+variances\s+to\s+post/i,
    ];
    for (const src of suspects) {
      for (const re of banned) {
        expect(src, `a screen still claims posting happens here: ${re}`).not.toMatch(re);
      }
    }
  });

  it("the help text and the concierge agree that counting does not post", () => {
    const help = read(SRC, "lib", "admin", "help-content.ts");
    const kb = read(SRC, "lib", "admin", "concierge-kb.ts");
    expect(kb).not.toMatch(/variances\s+post\s+as\s+audited/i);
    // Both should send the reader to the place that DOES post.
    expect(help).toMatch(/Inventory Auditing/);
    expect(kb).toMatch(/Inventory Auditing/);
  });

  it("the approved-audit screen no longer describes a posting path that is absent", () => {
    /*
     * Read WITHOUT comments, because the page now carries a note recording that
     * this exact sentence used to be here and why it was wrong. A prose test
     * that reads raw source cannot tell a lie from the gravestone of a lie, and
     * would forbid the repository from remembering its own defects.
     */
    const shown = withoutComments(read(HUB, "[id]", "page.tsx"));
    // The exact false sentence from books-12.
    expect(shown).not.toMatch(/handled through the posting path/);
    // It has to have been replaced by the button, not merely deleted.
    expect(code(read(HUB, "[id]", "page.tsx"))).toMatch(/action=\{postAuditAction\}/);
  });

  it("the screen tells the owner the entry is a DRAFT, which is what the code does", () => {
    /*
     * Michael's Q1: "create the draft and await my approval before auto posting".
     * The claim and the mechanism are asserted together, so neither can drift
     * alone: the store must NOT pass autoPost, and the page must SAY "draft".
     *
     * READ WITH COMMENTS STRIPPED, AND THIS IS THE WHOLE POINT OF THE SLICE.
     * The first version searched the raw file, and it passed against a pre-slice
     * tree whose only occurrence of the word was in a code comment on line 63:
     *
     *     * An earlier draft of this page branched on `status === "posted"` ...
     *
     * A comment about an earlier draft of the FILE answered a question about
     * what the OWNER'S SCREEN says. That is defect D6 of this very slice --
     * prose being read as the thing it describes -- reproduced inside the test
     * written to prevent it. Only the rule-18 revert exposed it.
     */
    const store = code(read(SRC, "lib", "inventory", "inventory-audit-store.ts"));
    expect(store).not.toMatch(/autoPost/);
    const page = withoutComments(read(HUB, "[id]", "page.tsx"));
    expect(
      page.toLowerCase(),
      "the owner must be told in rendered words that posting drafts an entry",
    ).toMatch(/draft/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D) THE BLIND COUNT IS STRUCTURAL
   ══════════════════════════════════════════════════════════════════════════ */

describe("D staff can count, and cannot see what it costs", () => {
  it("counting is a permission the floor holds and the analyst does not", () => {
    expect(can("staff", "inventory.count")).toBe(true);
    expect(can("manager", "inventory.count")).toBe(true);
    expect(can("admin", "inventory.count")).toBe(true);
    expect(can("owner", "inventory.count")).toBe(true);
    // "Reporting and exports only" must not mean "may rewrite the shelf record".
    expect(can("readonly", "inventory.count")).toBe(false);
    expect(can("content_editor", "inventory.count")).toBe(false);
  });

  it("approving an audit is the owner's alone", () => {
    expect(rolesForPermission("inventory.audit")).toEqual(["owner"]);
  });

  it("both new permissions are registered, so neither is a typo", () => {
    // Two namespaces of similar strings will trade places (standing rule 42).
    // A nav entry or a page gate naming a permission that does not exist would
    // otherwise fail open or fail silently depending on the helper.
    expect(ALL_PERMISSIONS).toContain("inventory.count");
    expect(ALL_PERMISSIONS).toContain("inventory.audit");
  });

  it("the count sheet type carries no cost, variance or expected quantity", () => {
    // The count is blind because the number is ABSENT FROM THE OBJECT, not
    // because a component chose not to render it. A component's choice is one
    // edit away from being reversed; a missing field is a compile error.
    const store = read(SRC, "lib", "inventory", "audit-hub-store.ts");
    const start = store.indexOf("export type CountSheetLine");
    expect(start).toBeGreaterThan(-1);
    const decl = store.slice(start, store.indexOf("};", start));
    for (const banned of ["systemQty", "system_qty", "variance", "Cents", "unitCost"]) {
      expect(decl, `CountSheetLine must not carry ${banned}`).not.toContain(banned);
    }
  });

  it("the counting route never mentions a system quantity or a cost", () => {
    const countPage = code(read(HUB, "[id]", "count", "page.tsx"));
    for (const banned of ["systemQty", "system_qty", "grossVarianceCents", "formatCents"]) {
      expect(countPage, `the count sheet must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("the owner's review screen DOES show the cost, because that is its job", () => {
    // The mirror of the test above. Without it, "no cost anywhere" would pass by
    // deleting the owner's ability to see what the shrink is worth.
    const review = code(read(HUB, "[id]", "page.tsx"));
    expect(review).toContain("formatCents");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E) THE GATES RUN IN BOTH DIRECTIONS   (rule 34)
   ══════════════════════════════════════════════════════════════════════════ */

describe("E the gates admit the right people and refuse the rest", () => {
  it("every page under the audit hub is owner-only except the count sheet", () => {
    const expected: Record<string, string> = {
      ["page.tsx"]: "inventory.audit",
      [join("new", "page.tsx")]: "inventory.audit",
      [join("[id]", "page.tsx")]: "inventory.audit",
      [join("[id]", "count", "page.tsx")]: "inventory.count",
      [join("[id]", "export", "page.tsx")]: "inventory.audit",
    };
    for (const [rel, perm] of Object.entries(expected)) {
      const src = withoutComments(read(HUB, rel));
      expect(src, `${rel} must gate on ${perm}`).toContain(`requirePermission("${perm}")`);
    }
  });

  it("the counting queue is gated on counting, not on managing", () => {
    const queue = withoutComments(read(CYCLE, "page.tsx"));
    expect(queue).toContain('requirePermission("inventory.count")');
    // requireStaff() would also admit the readonly analyst and the content
    // editor, which is why the gate is not that. See roles.ts: dashboard.view
    // is all six roles.
    expect(queue).not.toMatch(/\brequireStaff\s*\(/);
    // And the permission it USED to hold must be gone from the gate, not merely
    // joined by the new one.
    expect(queue).not.toContain('requirePermission("inventory.manage")');
  });

  it("a manager can still do the floor job this slice did not take away", () => {
    // Tightening that breaks the work is not a win. Assert what a manager KEEPS.
    expect(can("manager", "inventory.manage")).toBe(true);
    expect(can("manager", "inventory.count")).toBe(true);
    expect(can("manager", "reports.view")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F) A BLOCKED WRITE IS COUNTED, NOT ASSUMED   (proposed rule 51)
   ══════════════════════════════════════════════════════════════════════════ */

describe("F no update in the audit store can silently affect zero rows", () => {
  const store = read(SRC, "lib", "inventory", "audit-hub-store.ts");

  it("every .update() asks for the rows it touched", () => {
    /*
     * PROPOSED STANDING RULE 51:
     *   A WRITE THAT CAN BE BLOCKED WITHOUT ERROR MUST BE COUNTED, NOT ASSUMED.
     *
     * These functions write through createBooksClient(), which is Michael's own
     * session with RLS ON. When RLS forbids an UPDATE, PostgreSQL does not
     * raise -- it matches zero rows and returns success. So the common idiom
     *
     *     const { error } = await supabase.from(X).update(...)
     *     if (error) return refused(error)
     *
     * reports SUCCESS for a write the database refused. For the status 'approved'
     * that is the difference between "the owner signed this" and "nobody signed
     * this and the system said they did".
     */
    /*
     * NOTE THE `code()`. An earlier draft of this very test split the RAW file,
     * which produced FIVE chunks for FOUR writes: the long comment above
     * `requireRowsWritten` contains the words `.update(...)`. That fifth chunk
     * passed the check only because the same comment later quotes `.select("id")`
     * -- a prose mention was being scored as a checked write. Split on stripped
     * code and the count drops to the four real statements.
     *
     * This is standing rule 49 in miniature: the right and the wrong split
     * returned the same verdict today, so the structure had to be tested rather
     * than the answer.
     */
    const chunks = code(store).split(".update(").slice(1);
    expect(
      chunks.length,
      "the four writes in this store are saveCountLine, saveLineReason, " +
        "moveSessionStatus and the cancel cleanup. If this number changed, a write " +
        "was added or removed and it needs a decision, not a passing test.",
    ).toBe(4);
    const unchecked: string[] = [];
    for (const chunk of chunks) {
      const stmt = chunk.slice(0, chunk.indexOf(";") + 1);
      if (!stmt.includes(".select(")) unchecked.push(stmt.trim().slice(0, 120));
    }
    expect(
      unchecked,
      "these updates cannot tell a refusal from a success:\n" + unchecked.join("\n"),
    ).toEqual([]);
  });

  it("the row count is actually inspected, not merely requested", () => {
    // .select() without a check is decoration. The helper is the check.
    expect(store).toContain("function requireRowsWritten");
    expect(store).toContain("WRITE_BLOCKED");
    const helper = store.slice(store.indexOf("function requireRowsWritten"));
    // The guard must actually test for emptiness, not merely receive the rows.
    expect(helper.slice(0, 700)).toMatch(/length\s*===\s*0|n\s*===\s*0/);
  });

  it("the status move — the one that matters most — uses the helper", () => {
    const fn = store.slice(store.indexOf("export async function moveSessionStatus"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("requireRowsWritten");
  });

  it("WRITE_BLOCKED reaches a human, rather than being swallowed", () => {
    /*
     * Rule 43 again: the code has to be emitted AND surfaced.
     *
     * THIS TEST WAS WRONG FIRST, AND IT IS INSTRUCTIVE. It used to assert only
     * that actions.ts mentions `result.refusal.code` and
     * `result.refusal.message`. Both were already true BEFORE this slice -- the
     * hub had eleven refusal surfacings on the day the silent no-op bug was
     * filed. So a test named "WRITE_BLOCKED reaches a human" passed against a
     * tree in which WRITE_BLOCKED did not exist at all. The rule-18 stash proof
     * is what exposed it: the test survived a full revert of the fix.
     *
     * The name made a claim the assertions never checked. What has to be true is
     * that the writes which can be BLOCKED SILENTLY under row-level security --
     * the ones that return no error and affect no rows -- are the ones routed
     * through a refusal the screen renders. So: follow WRITE_BLOCKED from the
     * place it is emitted to the place it is displayed.
     */
    const actions = read(HUB, "actions.ts");

    // 1. The store emits it (checked in full by the test above) ...
    expect(store).toContain('code: "WRITE_BLOCKED"');

    // 2. ... from the shared helper, so it cannot be emitted from one site and
    //    forgotten at the other three.
    const emitAt = store.indexOf('code: "WRITE_BLOCKED"');
    const helperAt = store.indexOf("function requireRowsWritten");
    expect(helperAt, "requireRowsWritten must exist").toBeGreaterThan(-1);
    expect(
      emitAt > helperAt,
      "WRITE_BLOCKED must be emitted from inside requireRowsWritten, not open-coded",
    ).toBe(true);

    // 3. ... and every caller of the three guarded writes hands the refusal to
    //    `refuse(...)`, which is what puts words on the owner's screen. A store
    //    that returns ok:false to an action that ignores it is a silent no-op
    //    with extra steps.
    for (const fn of ["saveCountLine", "saveLineReason", "moveSessionStatus"]) {
      expect(store, `${fn} must be guarded`).toContain(fn);
    }
    expect(actions).toContain("refuse(back, result.refusal.code, result.refusal.message)");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   G) THE CHART OF ACCOUNTS MAP IS DERIVED, NOT TYPED
   ══════════════════════════════════════════════════════════════════════════ */

describe("G every inventory category resolves to a real account", () => {
  it("covers every category the chart of accounts defines", () => {
    const map = inventoryAccountByCategory();
    expect(Object.keys(map).length).toBe(INVENTORY_CATEGORIES.length);
    for (const c of INVENTORY_CATEGORIES) {
      expect(map[c.slug], `${c.slug} has no inventory account`).toMatch(/^2\d{4}$/);
    }
  });

  it("agrees with the POS taxonomy in both directions", () => {
    // If a resolver returns a taxonomy value that the account map does not know,
    // every audit containing it refuses ACCOUNT_UNRESOLVED for a reason nobody
    // can see from the screen.
    expect(taxonomyAgreementProblems()).toEqual([]);
  });

  it("the action passes the DERIVED map, not a literal", () => {
    // The only accountByCategory that existed before books-23 was a two-entry
    // test fixture, { flower: "20140", edible: "20150" } -- in which "edible" is
    // not a real slug and 20150 is not an edible account. Eighteen accounts in
    // the old Sage file were typo'd GRWNY for GRNWY. A derived map cannot be.
    const actions = code(read(HUB, "actions.ts"));
    expect(actions).toMatch(/postAuditSession\(\s*sessionId\s*,\s*inventoryAccountByCategory\(\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   H) THE WORKFLOW HANDS OFF IN THE ORDER MICHAEL DESCRIBED
   ══════════════════════════════════════════════════════════════════════════ */

describe("H the order of operations matches what the owner asked for", () => {
  it("the queue shows only jobs whose scope the owner approved", () => {
    // "The system tells me what it thinks we should count... I approve the scope
    // and push it to the cycle counts page." A draft must not be countable.
    const hub = read(SRC, "lib", "inventory", "audit-hub-store.ts");
    const idx = hub.indexOf("export const COUNT_QUEUE_STATUSES");
    expect(idx).toBeGreaterThan(-1);
    /*
     * Slice from the `[` that opens the ARRAY, which is the one after the `=`.
     * Searching for the first `]` from the name instead lands inside the type
     * annotation `readonly AuditSessionStatus[]`, and the extracted "declaration"
     * is then the empty string between the brackets -- against which every
     * `toContain` below fails and every `not.toContain` passes, for reasons that
     * have nothing to do with the queue. A test that reads the wrong bytes does
     * not report a wrong answer; it reports a confident one.
     */
    const open = hub.indexOf("[", hub.indexOf("=", idx));
    const decl = hub.slice(open, hub.indexOf("]", open) + 1);
    expect(decl.startsWith("[")).toBe(true);
    expect(decl).toContain("scope_approved");
    expect(decl).toContain("counting");
    expect(decl).not.toContain("draft");
    expect(decl).not.toContain("review");
    // NOTE the surrounding quotes: the bare substring `approved` also occurs
    // inside `scope_approved`, so the loose form of this assertion would fail
    // against a correct list. The token is what matters, not the letters.
    expect(decl).not.toContain('"approved"');
    expect(decl).not.toContain('"posted"');
  });

  it("the queue is built by QUERY, so a finished count cannot linger", () => {
    // "When they finish the count, it should disappear from the cycle counts
    // page." Fetching everything and filtering in the component would leave the
    // finished job one forgotten condition away from staying visible.
    const queue = code(read(CYCLE, "page.tsx"));
    expect(queue).toMatch(/listAuditSessions\(\s*\{[^}]*statuses:\s*COUNT_QUEUE_STATUSES/);
  });

  it("the owner's hub surfaces the counts that are waiting for him", () => {
    // "The audit inventory page will need a table and a way for me to open up
    // the finished cycle counts."
    const hubPage = code(read(HUB, "page.tsx"));
    expect(hubPage).toMatch(/awaitingReview/);
    expect(hubPage).toMatch(/awaitingPosting/);
    // Approved-but-unposted is the group that could previously sit forever.
    expect(hubPage).toMatch(/postedAt\s*===\s*null/);
  });

  it("an empty statuses list returns nothing, rather than everything", () => {
    // The inversion that a .in() built from an empty array would cause: no
    // filter is applied, so the query returns every session. A counting queue
    // that silently shows every audit including drafts is the opposite of the
    // requirement.
    const hub = read(SRC, "lib", "inventory", "audit-hub-store.ts");
    const fn = hub.slice(hub.indexOf("export async function listAuditSessions"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/statuses[\s\S]{0,200}length\s*===\s*0/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   I) THE NAVIGATION AGREES WITH THE PAGES
   ══════════════════════════════════════════════════════════════════════════ */

describe("I the menu sends people where they are actually allowed", () => {
  const nav = read(SRC, "components", "admin", "admin-nav-data.ts");

  it("Cycle Counts is advertised to the people who can open it", () => {
    const line = nav.split("\n").find((l) => l.includes('label: "Cycle Counts"'));
    expect(line).toBeTruthy();
    expect(line!).toContain('permission: "inventory.count"');
  });

  it("Inventory Auditing is advertised as owner-only", () => {
    const line = nav.split("\n").find((l) => l.includes('label: "Inventory Auditing"'));
    expect(line).toBeTruthy();
    expect(line!).toContain('permission: "inventory.audit"');
  });

  it("counting stays in the Inventory group, where floor staff already work", () => {
    // Moving it into an owner tab would hide it from the very people who hold
    // the scanner, since neither owner tab renders for them at all.
    const line = nav.split("\n").find((l) => l.includes('label: "Cycle Counts"'))!;
    expect(line).toContain('group: "Inventory"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   J) NOBODY IS NAGGED ABOUT SOMEBODY ELSE'S FILING   (Michael's Q5)
   ═══════════════════════════════════════════════════════════════════════════

   Michael, verbatim:

     "For 5, I want it to be for me alone too, the employees should have not be
      harassed by the system for my not making a payment of filing a report etc.
      I'll keep that burden for myself."

   WHAT WAS ACTUALLY WRONG. The compliance calendar was gated on
   `settings.manage` (owner + admin) and sat in the "Admin" nav group. But the
   red "N compliance obligations are past due" banner it feeds lives on
   /admin/page.tsx behind `requireStaff()`, which is ALL SIX ROLES. So a
   budtender opening the dashboard was told, in red, that the store was late
   filing its 37% excise tax -- and the link went to a page that then refused
   them. A nag about a duty they cannot discharge, cannot see, and were never
   responsible for.

   Two guards, tested separately, because they fail differently:
     * the FETCH guard stops a query about the owner's filing history from being
       run on a budtender's page load;
     * the RENDER guard stops the card being drawn.
   Either one alone would have fixed today's symptom. Both are asserted so that
   removing either is a test failure rather than a silent regression.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("J the compliance nag is the owner's alone", () => {
  const dash = read(SRC, "app", "admin", "page.tsx");

  it("the calendar permission is the owner's, and nobody else's", () => {
    expect(ALL_PERMISSIONS).toContain("compliance.calendar");
    expect(rolesForPermission("compliance.calendar")).toEqual(["owner"]);
    // Named individually so a failure says WHO leaked in. Note the roster check
    // above: can() denies unknown permissions, so a loop of expect(false) would
    // pass for a permission that was never added.
    for (const role of ["admin", "manager", "staff", "content_editor", "readonly"] as const) {
      expect(
        can(role, "compliance.calendar"),
        `${role} must not be chased about the owner's filings`,
      ).toBe(false);
    }
  });

  it("the admin specifically loses it, which is the point of the change", () => {
    /*
     * It used to ride on settings.manage. That is the permission this change is
     * about, so assert the SEPARATION rather than just the new value: the admin
     * keeps settings.manage and still cannot open the calendar.
     *
     * THE EXISTENCE ASSERTION IS NOT DECORATION. `can()` answers false for a
     * permission it has never heard of, so "the admin cannot open the calendar"
     * is satisfied both by a correctly gated permission AND by a permission that
     * does not exist at all. This test passed against a pre-slice tree in which
     * `compliance.calendar` had not been invented yet -- standing rule 46, a
     * zero nobody computed looks like a zero somebody computed. Checking the
     * roster first is what makes the false below mean something.
     */
    expect(
      ALL_PERMISSIONS,
      "compliance.calendar must be a real permission before denying it means anything",
    ).toContain("compliance.calendar");
    expect(can("admin", "settings.manage")).toBe(true);
    expect(can("admin", "compliance.calendar")).toBe(false);
  });

  it("the overdue count is not even FETCHED for a non-owner", () => {
    // A value in scope is one careless JSX edit from being rendered again.
    const src = withoutComments(dash);
    expect(src).toMatch(
      /canSeeCompliance\s*\?\s*getOverdueComplianceCount\(\)\s*:\s*Promise\.resolve\(0\)/,
    );
    expect(src).toContain('can(session.profile.role, "compliance.calendar")');
  });

  it("there is no unconditional call left behind", () => {
    // The mistake this catches: adding the guarded call while leaving the
    // original in place, so the query runs for everyone anyway.
    const src = withoutComments(dash);
    const calls = src.match(/getOverdueComplianceCount\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src).not.toMatch(/^\s*getOverdueComplianceCount\(\),/m);
  });

  it("the banner is ALSO gated, so the render cannot drift from the fetch", () => {
    const src = withoutComments(dash);
    expect(src).toMatch(/\{canSeeCompliance\s*&&\s*overdueCompliance\s*>\s*0\s*&&/);
  });

  it("the page and the action agree, so nothing can be signed off from a refused screen", () => {
    const page = withoutComments(read(SRC, "app", "admin", "compliance", "calendar", "page.tsx"));
    const actions = withoutComments(
      read(SRC, "app", "admin", "compliance", "calendar", "actions.ts"),
    );
    expect(page).toContain('requirePermission("compliance.calendar")');
    expect(actions).toContain('requirePermission("compliance.calendar")');
    // The old gate must be GONE from both, not merely joined by the new one.
    expect(page).not.toContain('requirePermission("settings.manage")');
    expect(actions).not.toContain('requirePermission("settings.manage")');
  });

  it("the calendar sits in the owner's own menu", () => {
    const nav = read(SRC, "components", "admin", "admin-nav-data.ts");
    const line = nav.split("\n").find((l) => l.includes('label: "Compliance Calendar"'));
    expect(line).toBeTruthy();
    expect(line!).toContain('permission: "compliance.calendar"');
    expect(line!).toContain('group: "Lyman"');
  });

  it("the help catalogue does not send staff to a door that will not open", () => {
    /*
     * HelpItem has no permission field -- the catalogue is shown to everyone. So
     * an `href` to an owner-only page is the same nag arriving by a different
     * route: search "deadlines", get a link, get refused.
     *
     * Asserted structurally rather than by wording: find the entry, then require
     * that it carries no href. A test on the sentence would pass the moment
     * somebody reworded it while leaving the link in place.
     */
    const help = read(SRC, "lib", "admin", "help-content.ts");
    const i = help.indexOf("Where are my recurring licensing deadlines?");
    expect(i).toBeGreaterThan(-1);
    /*
     * SLICE THE WHOLE OBJECT, BOTH SIDES OF THE QUESTION.
     *
     * The first version of this test sliced FORWARD from the question text only,
     * and a mutation that reinstated the link survived -- because `href` is a
     * field of an object literal and may legally be written BEFORE `q`, which is
     * exactly where the mutation put it. The assertion was guarding one side of
     * the field it was named after.
     *
     * Standing rule 45: the regression test has to guard where the bug appears
     * NEXT, not where it appeared last. So walk back to the `{` that opens this
     * entry and read the entry entire.
     */
    const open = help.lastIndexOf("{", i);
    expect(open).toBeGreaterThan(-1);
    const entry = help.slice(open, help.indexOf("},", i));
    // Proof the window really contains both sides: the field order in the source
    // today is q, a -- so a window that missed the lines above `q` would still
    // contain the question and pass the assertion below for the wrong reason.
    expect(entry).toContain("Where are my recurring licensing deadlines?");
    expect(entry.indexOf("{")).toBe(0);
    expect(entry, "this help entry must not link to the owner-only calendar").not.toContain(
      "href:",
    );
    // ...and it should say whose job it is, so the answer is still useful.
    expect(entry.toLowerCase()).toMatch(/owner|michael/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   K) MIGRATION 0194 — THE RETIRED TABLES ARE SEALED, AND HONEST ABOUT IT
   ═══════════════════════════════════════════════════════════════════════════

   The application refuses to write a cycle count (section B). Migration 0194 is
   the other half: the database stops accepting writes through an ordinary
   logged-in session, which migration 0041 had granted with
   `for all using (is_staff())` -- meaning any budtender's own credentials could
   INSERT, UPDATE and DELETE cycle-count rows straight through the REST API with
   no application code involved.

   THE POINT OF TESTING THE PROSE AS WELL AS THE SQL. Every writer of these
   tables uses the SERVICE ROLE key, which bypasses row-level security entirely.
   So this migration is defence in depth, NOT the lock holding the door today. A
   migration comment claiming otherwise would be standing rule 44 exactly -- a
   guard's justifying comment is a claim about the repository, and an untested
   claim is a lie with a citation. The tests below therefore check that the file
   SAYS SO, because the next reader will believe whatever it says.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("K migration 0194 seals the retired cycle-count tables", () => {
  const MIG = join(ROOT, "supabase", "migrations", "0194_cycle_counts_read_only.sql");
  /*
   * `sql`  = executable statements only, for "does this DDL run?"
   * `prose` = the whole file, for "does the file EXPLAIN itself honestly?"
   *
   * Keeping them apart is the point. Asking a structural question of the raw
   * file lets a commented-out statement answer it, which is exactly how the K1
   * mutation survived its first run.
   */
  const prose = existsSync(MIG) ? readFileSync(MIG, "utf8") : "";
  const sql = sqlCode(prose);

  it("the migration exists", () => {
    expect(existsSync(MIG), "supabase/migrations/0194_cycle_counts_read_only.sql").toBe(true);
  });

  it("it is the NEXT number, so it cannot be applied out of order", () => {
    // Two developers each adding "the next" migration produce two 0194s, and
    // whichever is applied second is silently skipped by most tooling.
    const all = readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4));
    const duplicates = all.filter((n) => n === "0194");
    expect(duplicates, "exactly one 0194 migration may exist").toHaveLength(1);
    expect(Math.max(...all.map(Number))).toBe(194);
  });

  it("both retired tables lose their write policy and keep a read policy", () => {
    for (const t of ["cycle_counts", "cycle_count_lines"]) {
      /*
       * The 0041 policy was `for all` -- it must be dropped BY NAME.
       *
       * Matched with a whitespace-tolerant pattern rather than an exact string:
       * the migration aligns these four statements into columns for
       * readability, and the first version of this assertion demanded single
       * spaces. It failed against correct SQL. A test that breaks when someone
       * lines up a column is testing the formatter, not the guard.
       */
      expect(
        new RegExp(`drop policy if exists\\s+${t}_staff_all\\s+on public\\.${t};`).test(sql),
        `${t}: the 0041 write-all policy must be dropped by name`,
      ).toBe(true);
      // ...and replaced with SELECT only.
      expect(
        new RegExp(
          `create policy\\s+${t}_staff_read\\s+on public\\.${t}\\s+for select using \\(public\\.is_staff\\(\\)\\);`,
        ).test(sql),
        `${t}: must be replaced with a SELECT-only policy`,
      ).toBe(true);
    }
  });

  it("no policy in the file grants a write on a retired table", () => {
    // Reads the file for the mistake rather than trusting the two assertions
    // above: a THIRD policy added later, `for all` or `for insert`, would slip
    // past a test that only checks the two names it already knows.
    const creates = sql.match(/create policy[\s\S]*?;/g) ?? [];
    const writers = creates.filter(
      (c) => /cycle_count/.test(c) && !/for\s+select/i.test(c),
    );
    expect(writers, `these policies write to a retired table:\n${writers.join("\n")}`).toEqual(
      [],
    );
  });

  it("READ survives — a retention record that cannot be read is not retained", () => {
    // Standing rule 34, gates run in BOTH directions. "Nobody can write" would
    // also be satisfied by sealing the table completely, which would break the
    // three-year traceability record and the "Older counts" list.
    expect(sql).toContain("for select using (public.is_staff())");
    expect(prose).toMatch(/314-55-083/);
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/delete from public\.cycle_counts/i);
  });

  it("the write GRANTS are revoked for ordinary sessions, not just the policies", () => {
    // RLS decides which rows; grants decide whether the verb may be attempted.
    // Without the revoke, a later migration adding a policy reopens writing.
    //
    // WHITESPACE-TOLERANT FOR THE SAME REASON AS THE `drop policy` ASSERTIONS
    // ABOVE. The migration pads these two lines so `from` lines up in a column,
    // and an exact-string check therefore encodes the padding as if it were the
    // guard. It would fail the day somebody renames a table and the column no
    // longer needs padding -- reporting a security regression when nothing but
    // the alignment moved. A test that cries wolf over a space gets deleted by
    // the next person in a hurry, and then nothing checks the revoke at all.
    for (const t of ["cycle_counts", "cycle_count_lines"]) {
      expect(
        new RegExp(
          `revoke\\s+insert,\\s*update,\\s*delete\\s+on\\s+table\\s+public\\.${t}\\s+from\\s+anon,\\s*authenticated;`,
        ).test(sql),
        `${t}: ordinary sessions must lose the write GRANT, not just the policy`,
      ).toBe(true);
    }
  });

  it("it does NOT pretend to restrain the service role", () => {
    /*
     * The most important test in this section. Every writer of these tables uses
     * the service-role key, which ignores RLS. A file that revoked service_role
     * writes here would look stronger and would in fact break the nine READERS
     * that still use that key -- while the honest statement is that the library
     * refusal is the real lock on that path.
     */
    /*
     * `[\s\S]{0,120}` RATHER THAN THE `s` (dotAll) FLAG. The repository targets
     * ES2017 (tsconfig.json), where that flag is a compile error -- TS1501. The
     * test still PASSED with it, because vitest's transform is more forgiving
     * than the typechecker, so only `tsc --noEmit` caught it. Worth recording:
     * a green suite is not a compiling repository.
     *
     * The bound matters too. Unbounded `[\s\S]*` would let the words
     * "service_role" and "NOT revoked" satisfy this from opposite ends of an
     * 18KB file, which is not a sentence -- it is a coincidence. 120 characters
     * is about one wrapped comment line either side, so the two halves have to
     * actually be making the same statement.
     */
    expect(prose).toMatch(
      /service_role[\s\S]{0,120}NOT revoked|NOT revoked[\s\S]{0,120}service_role/i,
    );
    expect(prose).toMatch(/BYPASSES ROW-LEVEL SECURITY ENTIRELY|bypass(es)? RLS/i);
    expect(prose).toMatch(/CYCLE_COUNT_APPLY_RETIRED/);
  });

  it("the honest-scope claim names the client the code actually uses", () => {
    // Rule 44: the file asserts that every reader/writer uses the service role.
    // That claim is checked against the source here, so it cannot rot quietly.
    const lib = readFileSync(
      join(SRC, "lib", "inventory", "cycle-counts.ts"),
      "utf8",
    );
    expect(lib).toContain("createSupabaseAdminClient");
    expect(lib).not.toContain("createBooksClient");
    expect(prose).toMatch(/createSupabaseAdminClient/);

    /*
     * THE COUNT IS PART OF THE CLAIM. The migration says "the nine readers"
     * three separate times, and the owner's report repeats it. That is a
     * number about the repository, so it has to be checked against the
     * repository -- and it very nearly shipped wrong: grepping call SITES
     * returns twelve, because two functions build a client twice and one
     * RETIRED function still contains the text. Nine is the count of live
     * functions, which is the thing the sentence actually means.
     *
     * Counted structurally rather than by grep, for the same reason section F
     * counts stripped code: a number nobody recomputed is a number that drifts
     * the first time somebody adds a reader.
     */
    const bodies = lib
      .split(/(?=^(?:export )?(?:async )?function )/m)
      .filter((b) => /^(?:export )?(?:async )?function /.test(b));
    const live = bodies.filter(
      (b) => b.includes("createSupabaseAdminClient()") && !b.includes("RETIRED"),
    );
    expect(
      live.length,
      "the migration and the owner's report both say NINE service-role readers",
    ).toBe(9);
    expect(prose).toMatch(/\bnine\b/);
  });

  it("it refuses to run out of order, including on the REPLACEMENT flow", () => {
    // Sealing the old path on a database that never got 0191 would leave the
    // store with no way to count stock at all: old path refused in code, new
    // path's tables absent.
    expect(sql).toContain("MIGRATION_OUT_OF_ORDER");
    expect(sql).toMatch(/inventory_audit_sessions[\s\S]{0,400}MIGRATION_OUT_OF_ORDER/);
    expect(sql).toMatch(/to_regclass\('public\.cycle_counts'\) is null/);
  });

  it("it ships a gate check whose EMPTY result is the passing result", () => {
    expect(sql).toContain("create or replace function public.cycle_counts_retired_gate_check()");
    expect(prose).toMatch(/AN EMPTY RESULT IS THE PASSING RESULT/);
  });

  it("the gate check verifies the replacement still works, not only the seal", () => {
    // Four checks could pass while the store cannot count anything. The fifth is
    // what makes the gate check a verification rather than a formality.
    expect(sql).toMatch(/inventory_audit_post_session\(uuid\)/);
    expect(sql).toMatch(/relrowsecurity = false/);
    expect(sql).toMatch(/p\.cmd <> 'SELECT'/);
  });

  it("it is idempotent, so a nervous owner may run it twice", () => {
    // These are applied BY HAND. "Did that work?" followed by a second run is
    // the normal human response, and it must not be punished.
    expect(prose).toMatch(/Idempotent/i);
    const creates = (sql.match(/create policy/g) ?? []).length;
    const drops = (sql.match(/drop policy if exists/g) ?? []).length;
    expect(drops).toBeGreaterThanOrEqual(creates);
    expect(sql).toContain("create or replace function");
  });

  it("it explains WHY in money, not in jargon", () => {
    // Standing rule 29: plain English is a deliverable. The owner has to be able
    // to read this and know what it is for.
    expect(prose).toMatch(/\$4,624,697\.31/);
    expect(prose).toMatch(/understated/i);
    expect(prose).toMatch(/280E/);
  });
});
