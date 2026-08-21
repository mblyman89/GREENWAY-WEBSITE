/**
 * tests/compliance/audit-hub-wiring.test.ts   (slice books-12)
 *
 * PROVING THE HUB IS WIRED, NOT MERELY WRITTEN.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * books-10 and books-11 built roughly 207KB of thoroughly tested inventory-audit
 * engine. Every self-test passed. `grep -rn "inventory-audit" src/app` returned
 * NOTHING. The engine had no consumers at all, and no test noticed, because
 * every test asked "does the logic work" and none asked "is the logic reachable".
 *
 * That is the failure this file exists to prevent from recurring. It asserts
 * the boring structural facts that are invisible to a type checker and to a
 * unit test:
 *
 *   - the routes exist at the paths the navigation points at
 *   - every page gates on a permission
 *   - the write path re-gates inside each server action
 *   - the count sheet cannot leak the expected quantity
 *   - the navigation entry is present and does not collide with /admin/audit
 *
 * These are source-text assertions on purpose. A rendering test would need a
 * database and a session; these facts can be proven from the files themselves,
 * and a cheap test that runs on every commit beats an expensive one that gets
 * skipped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { can } from "@/lib/auth/roles";

const ROOT = process.cwd();
const HUB_DIR = join(ROOT, "src", "app", "admin", "inventory", "audits");

function read(rel: string): string {
  return readFileSync(join(HUB_DIR, rel), "utf8");
}

/** Strip comments so a prose mention can never satisfy a code assertion. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PAGES = [
  "page.tsx",
  "new/page.tsx",
  "[id]/page.tsx",
  "[id]/count/page.tsx",
  "[id]/export/page.tsx",
] as const;

describe("the auditing hub is reachable", () => {
  it("every route file the navigation implies actually exists", () => {
    for (const p of PAGES) {
      expect(existsSync(join(HUB_DIR, p)), `${p} is missing`).toBe(true);
    }
  });

  it("the navigation registers the hub, so it is not an orphan route", () => {
    const nav = readFileSync(
      join(ROOT, "src", "components", "admin", "admin-nav-data.ts"),
      "utf8",
    );
    expect(nav).toContain('href: "/admin/inventory/audits"');
    expect(nav).toContain('group: "Inventory"');
    // books-23: the hub is owner-only (inventory.audit). Counting moved to
    // Cycle Counts, which is gated on inventory.count.
    expect(nav).toContain('permission: "inventory.audit"');
  });

  it("the hub does NOT squat on /admin/audit, which is the security log", () => {
    // Two different meanings of the word "audit" sharing a URL is a trap for
    // whoever reads it next. The inventory auditor lives under the thing it
    // audits. This asserts the hub's own files never point at /admin/audit.
    for (const p of PAGES) {
      const src = code(read(p));
      // Deliberately NOT anchored on a closing quote. The first version of
      // this regex required /admin/audit to be immediately followed by a
      // quote, so a link to "/admin/audit/new" - squarely inside the security
      // log's namespace - sailed straight through. The (?!s) is what keeps
      // this hub's own /admin/inventory/audits paths from self-matching.
      expect(src).not.toMatch(/\/admin\/audit(?!s)/);
    }
  });
});

describe("every page is gated", () => {
  it("each route calls requirePermission with the RIGHT permission", () => {
    // books-23: this used to accept one permission for all five routes. That
    // could not express the split the owner asked for -- "any employee can
    // count", but "I am the only one that can approve an audit" -- so each route
    // now names the gate it is supposed to have. Asserting merely that SOME gate
    // exists would let the count sheet be tightened to owner-only (silently
    // breaking counting) or the posting screen be loosened to staff, and this
    // test would pass either way.
    const EXPECTED: Record<(typeof PAGES)[number], string> = {
      "page.tsx": "inventory.audit",
      "new/page.tsx": "inventory.audit",
      "[id]/page.tsx": "inventory.audit",
      "[id]/count/page.tsx": "inventory.count",
      "[id]/export/page.tsx": "inventory.audit",
    };
    for (const p of PAGES) {
      const src = code(read(p));
      expect(src, `${p} does not gate`).toContain(
        `requirePermission("${EXPECTED[p]}")`,
      );
      // ...and does not ALSO carry the other gate, which would make the real
      // one ambiguous.
      const other =
        EXPECTED[p] === "inventory.audit" ? "inventory.count" : "inventory.audit";
      expect(src, `${p} carries two different gates`).not.toContain(
        `requirePermission("${other}")`,
      );
    }
  });

  it("the count sheet is the ONLY route in the hub a non-manager can open", () => {
    // The whole point of the split, stated as a fact about roles rather than
    // about strings. Runs in both directions (standing rule 34).
    expect(can("staff", "inventory.count")).toBe(true);
    expect(can("staff", "inventory.audit")).toBe(false);
    expect(can("manager", "inventory.audit")).toBe(false);
    expect(can("admin", "inventory.audit")).toBe(false);
    expect(can("owner", "inventory.audit")).toBe(true);
    // readonly is an analyst role; it must not be able to write a count.
    expect(can("readonly", "inventory.count")).toBe(false);
  });

  it("no page uses requireBooksAccess, which is the wrong gate here", () => {
    // requireBooksAccess is owner-only and books-scoped. Inventory counting is
    // done by staff. Using the books gate would lock out the very people who
    // hold the scanner.
    for (const p of PAGES) {
      expect(code(read(p))).not.toContain("requireBooksAccess");
    }
  });

  it("each route is force-dynamic, so a count is never served from cache", () => {
    // A cached count sheet would show a stale set of outstanding lines and
    // invite somebody to re-count a lot that was already done.
    for (const p of PAGES) {
      expect(code(read(p)), `${p} is cacheable`).toContain('export const dynamic = "force-dynamic"');
    }
  });
});

describe("the write path re-gates", () => {
  const actions = code(read("actions.ts"));

  it("every exported server action calls requirePermission with the RIGHT one", () => {
    // A server action is a public HTTP endpoint. The page rendering a button
    // behind a permission check does NOT protect the action behind it.
    //
    // books-23: saveCountAction is the one action a budtender may reach. Every
    // other action in this file decides something -- what to count, what a
    // difference means, whether it is approved -- and is owner-only. Naming the
    // expected gate per action is what makes "the counter cannot approve"
    // testable rather than merely intended.
    const ACTION_GATE: Record<string, string> = {
      createAuditAction: "inventory.audit",
      saveCountAction: "inventory.count",
      saveReasonAction: "inventory.audit",
      moveStatusAction: "inventory.audit",
    };

    const names = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);

    // Every action must be listed above. A new action added without a decision
    // about who may call it fails here instead of defaulting to whatever the
    // author pasted.
    const unlisted = names.filter((n) => !(n in ACTION_GATE));
    expect(
      unlisted,
      `server actions with no declared permission: ${unlisted.join(", ")}`,
    ).toEqual([]);

    // Split the file at each export so each body is checked in isolation
    // rather than trusting one gate somewhere in the file to cover all of them.
    const bodies = actions.split(/export async function /).slice(1);
    expect(bodies.length).toBe(names.length);
    for (let i = 0; i < bodies.length; i++) {
      const name = names[i];
      const want = ACTION_GATE[name];
      expect(bodies[i], `${name} must gate on ${want}`).toContain(
        `requirePermission("${want}")`,
      );
    }

    // Exactly one action is reachable by staff, and it is the counting one.
    const staffReachable = names.filter((n) => can("staff", ACTION_GATE[n] as "inventory.count"));
    expect(staffReachable).toEqual(["saveCountAction"]);
  });

  it("the approver is taken from the session, never from the form", () => {
    // A client-supplied approver id would let the browser name somebody else as
    // the person who approved an inventory adjustment.
    expect(actions).toContain("approvedBy: session.profile.id");
    expect(actions).not.toMatch(/approvedBy:\s*(requiredField|form\.get)/);
  });

  it("refusals are redirected with their own message, never replaced", () => {
    expect(actions).toContain("result.refusal.message");
    // The single least useful sentence in software.
    expect(actions.toLowerCase()).not.toContain("something went wrong");
  });

  it("a blank quantity is refused rather than treated as zero", () => {
    // Blank means nobody looked; zero means somebody looked and found nothing.
    // Collapsing them writes off stock that is sitting on the shelf.
    expect(actions).toContain("BLANK_IS_NOT_ZERO");
  });
});

describe("the blind count cannot leak", () => {
  it("the count sheet component never references a system or expected quantity", () => {
    const src = code(read("AuditCountSheet.tsx"));
    // The type has no such field, so this would not compile -- but the type
    // could be widened by a future edit, and this test is what would object.
    expect(src).not.toMatch(/\bsystemQty\b/);
    expect(src).not.toMatch(/\bexpectedQty\b/);
    expect(src).not.toMatch(/\bonHandQty\b/);
  });

  it("the count ROUTE never references a system quantity either", () => {
    expect(code(read("[id]/count/page.tsx"))).not.toMatch(/\bsystemQty\b/);
  });

  it("the review page DOES show the system quantity, because the count is over", () => {
    // NEGATIVE CONTROL. If this failed, the two assertions above would be
    // passing for the trivial reason that nothing anywhere shows a quantity --
    // which would make them worthless as evidence about the blind count.
    expect(code(read("AuditVarianceReview.tsx"))).toMatch(/\bsystemQty\b/);
  });

  it("the count sheet records HOW a number arrived, and does not always claim 'scan'", () => {
    const src = code(read("AuditCountSheet.tsx"));
    expect(src).toContain('setCaptureMethod("manual")');
    expect(src).toContain('setCaptureMethod("scan")');
    // A hardcoded scan would put a false quality stamp on hand-typed records.
    expect(src).not.toContain('name="captureMethod" value="scan"');
  });
});

describe("the guidance is real, not decorative", () => {
  it("the blocked panel pairs the engine's sentence with a documented remedy", () => {
    const src = code(read("WhyBlockedPanel.tsx"));
    expect(src).toContain("remediesForBlocker");
    // The engine's own sentence must be rendered as well as the remedy, because
    // it carries the specifics (which lot, how much) a template cannot know.
    expect(src).toContain("{blocker}");
  });

  it("the variance reason list comes from the guidance core, not from the component", () => {
    const src = code(read("AuditVarianceReview.tsx"));
    // Assert the vocabulary is RENDERED, not merely imported. Checking for the
    // bare identifier was satisfied by the import statement, so a component
    // that imported VARIANCE_REASONS and then mapped over its own hardcoded
    // array passed cleanly.
    expect(src).toMatch(/\{\s*VARIANCE_REASONS\.map\(/);
    // A vocabulary hardcoded in JSX gets edited by whoever is restyling the
    // page. reason_code is a TAX field: an unexplained disappearance is a
    // deemed sale under WAC 314-55-089(4)(c).
    expect(src).not.toMatch(/<option value="(damaged|expired|theft|unknown)"/);
  });

  it("the reason picker has no pre-selected default", () => {
    const src = code(read("AuditVarianceReview.tsx"));
    // A default would be accepted by pressing save, and the most convenient
    // default would quietly become the most common recorded explanation for
    // missing regulated product.
    // Order-independent. The first version required name="reasonCode" to come
    // BEFORE the default, so simply writing defaultChecked earlier in the tag
    // pre-selected a reason with the test still green. JSX attribute order is
    // not a safety property.
    const radios = [...src.matchAll(/<input\b[^>]*type="radio"[^>]*\/?>/g)].map((m) => m[0]);
    expect(radios.length).toBeGreaterThan(0);
    for (const tag of radios) {
      expect(tag).toContain('name="reasonCode"');
      expect(tag).not.toMatch(/\bdefaultChecked\b/);
      expect(tag).not.toMatch(/\bdefaultValue\b/);
      expect(tag).not.toMatch(/\bchecked\b/);
    }
  });

  it("the work paper prints what the count does NOT prove", () => {
    const src = code(read("[id]/export/page.tsx"));
    expect(src).toContain("PROVES_AND_DOES_NOT");
    expect(src).toContain("doesNotProve");
  });

  it("the work paper spells the entity name correctly", () => {
    // GRWNY / GRNWY transpositions are a documented historical error in these
    // books, and a work paper carrying a misspelled entity is one somebody can
    // argue belongs to a different business.
    //
    // This reads code() rather than raw source on purpose. The page carries a
    // comment that NAMES the two bad spellings so the next reader understands
    // why the constant is written out longhand. Documenting a typo is not
    // committing one, and a test that cannot tell those apart would push the
    // next author to delete the explanation in order to get to green.
    const src = code(read("[id]/export/page.tsx"));
    expect(src).not.toMatch(/GRWNY|GRNWY/);

    // Pin the exact registered entity rather than a loose substring, and prove
    // the rendered heading actually uses it. A correctly spelled constant that
    // nothing renders would satisfy a contains-check while printing nothing.
    expect(src).toContain(`const ENTITY = "LYMAN'S MARIJUANA, Inc. dba Greenway Marijuana"`);
    expect(src).toContain("{ENTITY}");
  });
});

describe("gross variance is not allowed to hide behind net", () => {
  it("the hub list and the detail page both surface the gross figure", () => {
    // A $600 overage and a $600 shortage net to zero and look flawless. Gross
    // shows $1,200 of error, and offsetting differences are the signature of
    // two batches of one product counted as a single pile.
    // Assert the gross figure is FORMATTED FOR DISPLAY, not just mentioned.
    // Checking for the bare identifier was satisfied by a className conditional
    // that used gross only to pick a text colour while printing net.
    expect(code(read("page.tsx"))).toMatch(/formatCents\(\s*s\.grossVarianceCents\s*\)/);
    expect(code(read("[id]/page.tsx"))).toMatch(/grossVarianceCents/);
  });

  it("the work paper reports gross before net", () => {
    const src = code(read("[id]/export/page.tsx"));
    const gross = src.indexOf("grossVarianceCents");
    const net = src.indexOf("netVarianceCents");
    expect(gross).toBeGreaterThan(-1);
    expect(net).toBeGreaterThan(-1);
    expect(gross).toBeLessThan(net);
  });
});
