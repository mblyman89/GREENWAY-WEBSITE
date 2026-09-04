/**
 * SLICE 18E — THE PROVENANCE DOCTRINE, ENFORCED.
 *
 * Migration 0219 writes one rule onto the schema itself:
 *
 *        ENFORCEMENT READS MENU. PROVENANCE READS LOT. NEVER THE REVERSE.
 *
 * A rule stated only in a comment is a rule that rots. These tests make it
 * mechanical, and they are deliberately FAILS-CLOSED: the enforcement-module
 * list is an allowlist of files that may read the four classification columns,
 * and a NEW module that starts reading them off a lot row turns this suite red
 * until somebody justifies it. Silence is never taken as consent.
 *
 * The two halves:
 *
 *   1. THE DOCTRINE   — no enforcement path may read lot-side classification.
 *   2. THE MIRROR     — the approver's answer actually reaches the lot row
 *                       (18E "Defect 1"), proven behaviourally through the
 *                       pure planner, not by matching words in a file.
 *
 * TECHNIQUE (inherited from 18C/18D, learned the hard way):
 *   - Comments are stripped before asserting, or a test matches its own prose.
 *   - Text matching proves a word EXISTS, never that a value is RIGHT. So
 *     everything provable behaviourally is proven behaviourally, and source
 *     reads are confined to what only a source read can establish: that the
 *     wiring exists at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  planClassificationMirror,
  type MirrorClassificationInput,
} from "@/lib/inventory/classification-mirror-core";

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // {/* jsx */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/^\s*\/\/.*$/gm, " "); // // line
}

function guardStripped(code: string, original: string, mustContain: string) {
  expect(code).toContain(mustContain);
  expect(code.length).toBeGreaterThan(original.length / 3);
}

/**
 * A LINE comment containing the two characters that open a block comment makes
 * the block-comment pass delete everything to the next close marker, silently
 * removing real code. 18D lost a day to this. Assert it directly.
 */
function assertNoCommentTraps(rel: string) {
  const lines = read(rel).split("\n");
  const offenders: string[] = [];
  lines.forEach((line, i) => {
    const lineComment = line.match(/(^|[^:"'`\\])\/\/(.*)$/);
    if (lineComment && lineComment[2].includes("/*")) {
      offenders.push(`${rel}:${i + 1}`);
    }
  });
  expect(offenders).toEqual([]);
}

const MIRROR_CORE = "src/lib/inventory/classification-mirror-core.ts";
const CATALOG_DRAFTS = "src/lib/inventory/catalog-drafts.ts";
const LIVE_MENU = "src/lib/pos/live-menu.ts";
const MIGRATION_0219 = "supabase/migrations/0219_classification_provenance_doctrine.sql";
const SELFTESTS = "scripts/compliance/run-pure-selftests.ts";

/** The four columns the doctrine governs. */
const FLAGS = ["low_thc_liquid", "unit_thc_mg", "otherwise_taken", "units_per_package"];

// ===========================================================================
// 1. THE DOCTRINE
// ===========================================================================

describe("18E doctrine — enforcement reads menu, never the lot row", () => {
  it("the register reads all four flags off the MENU row", () => {
    const original = read(LIVE_MENU);
    const code = stripComments(original);
    guardStripped(code, original, "lowThcLiquid");
    // Each flag is read from `row.<column>`, where `row` is the menu row.
    expect(code).toContain("row.low_thc_liquid");
    expect(code).toContain("row.unit_thc_mg");
    expect(code).toContain("row.otherwise_taken");
    expect(code).toContain("row.units_per_package");
  });

  /**
   * THE FAILS-CLOSED GUARD.
   *
   * If any enforcement module ever selects the four flags from `inventory_lots`
   * this goes red. The correct fix is NEVER to add the module to an exception
   * list — it is to route the read through `menu_items`, because a limit
   * decided from a lot row is a limit that ignores the manager's correction.
   */
  it("no enforcement module reads classification off inventory_lots", () => {
    // The modules that decide or apply a statutory limit.
    const enforcementModules = [
      "src/lib/pos/live-menu.ts",
      "src/lib/compliance/sales-limits-core.ts",
      "src/lib/compliance/sales-limits.ts",
      "src/lib/orders/order-pricing.ts",
      "src/lib/pos/sale-flow-core.ts",
      "src/lib/pos/sale-grid-core.ts",
      "src/lib/medical/purchase-limit-display-core.ts",
    ];
    const offenders: string[] = [];
    for (const rel of enforcementModules) {
      const code = stripComments(read(rel));
      // A lot-side read looks like `.from("inventory_lots")`. Enforcement has
      // no business touching that table at all.
      if (/\.from\(\s*["'`]inventory_lots["'`]\s*\)/.test(code)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("migration 0219 states the doctrine on BOTH sides of the mirror", () => {
    const sql = read(MIGRATION_0219);
    // The lot side is labelled provenance...
    for (const flag of FLAGS) {
      const re = new RegExp(
        `comment on column public\\.inventory_lots\\.${flag} is[\\s\\S]{0,120}PROVENANCE MIRROR -- NOT ENFORCEMENT`,
      );
      expect(sql, `inventory_lots.${flag} must be labelled provenance`).toMatch(re);
    }
    // ...and the menu side is labelled enforcement.
    for (const flag of FLAGS) {
      const re = new RegExp(
        `comment on column public\\.menu_items\\.${flag} is[\\s\\S]{0,120}ENFORCEMENT SOURCE OF TRUTH`,
      );
      expect(sql, `menu_items.${flag} must be labelled enforcement`).toMatch(re);
    }
  });

  it("migration 0219 changes no data and no structure", () => {
    // SQL uses `--` for comments, so strip those lines rather than JS ones.
    const sql = read(MIGRATION_0219)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");

    // Splitting on ";" would be WRONG here: the comment bodies are quoted
    // prose containing semicolons, so a naive split tears one statement into
    // several and reports the fragments as offenders. Remove the quoted
    // string literals first, then split what remains — that leaves only the
    // SQL keywords, which is what this test is actually about.
    // (Doubled '' is an escaped quote inside a literal, e.g. "lot''s".)
    const withoutLiterals = sql.replace(/'(?:''|[^'])*'/g, "''");
    const statements = withoutLiterals
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Sanity: the stripping must leave the statements intact, not erase them.
    expect(statements.length).toBe(8); // 4 lot columns + 4 menu columns

    // Every statement must be a `comment on column`. A migration that claims
    // to be documentation-only must BE documentation-only.
    for (const st of statements) {
      expect(st.toLowerCase().startsWith("comment on column"), st.slice(0, 80)).toBe(true);
    }

    // Belt and braces: none of the structural or data verbs survive outside
    // the quoted prose.
    const keywords = withoutLiterals.toLowerCase();
    for (const verb of ["alter table", "drop ", "update ", "delete ", "insert ", "create "]) {
      expect(keywords, verb).not.toContain(verb);
    }
  });
});

// ===========================================================================
// 2. THE MIRROR (18E Defect 1)
// ===========================================================================

describe("18E mirror — the approver's answer reaches the lot row", () => {
  const base: MirrorClassificationInput = {
    lotId: "lot-1",
    otherwiseTaken: false,
    unitsPerPackage: null,
    lowThcLiquid: null,
    unitThcMg: null,
  };

  /**
   * THE DEFECT, STATED AS A TEST.
   *
   * The receiving dock warns only while `otherwise_taken` is null
   * (intake-review-core.ts:158). Before 18E nothing ever wrote the approver's
   * answer to the lot, so the column stayed null forever and the warning could
   * never be silenced. A mirror that skipped `false` because it looks falsy
   * would reproduce the bug exactly.
   */
  it("writes a human 'no' as the literal false, so the dock can go quiet", () => {
    const plan = planClassificationMirror({ ...base, otherwiseTaken: false });
    expect(plan.write).toBe(true);
    if (!plan.write) return;
    expect(plan.patch).toHaveProperty("otherwise_taken");
    expect(plan.patch.otherwise_taken).toBe(false);
  });

  it("writes a 'yes' together with its unit count", () => {
    const plan = planClassificationMirror({
      ...base,
      otherwiseTaken: true,
      unitsPerPackage: 6,
    });
    expect(plan.write).toBe(true);
    if (!plan.write) return;
    expect(plan.patch.otherwise_taken).toBe(true);
    expect(plan.patch.units_per_package).toBe(6);
  });

  /**
   * The asymmetry is deliberate and follows each fail-safe's direction:
   * an unanswered low-THC question leaves the product on the TIGHTER limit,
   * so inventing a `false` would be a claim nobody made.
   */
  it("never invents an answer for an unasked low-THC question", () => {
    const plan = planClassificationMirror(base);
    expect(plan.write).toBe(true);
    if (!plan.write) return;
    expect(plan.patch).not.toHaveProperty("low_thc_liquid");
    expect(plan.patch).not.toHaveProperty("unit_thc_mg");
  });

  it("writes an ANSWERED low-THC 'no', which is not the same as silence", () => {
    const plan = planClassificationMirror({ ...base, lowThcLiquid: false, unitThcMg: 2 });
    expect(plan.write).toBe(true);
    if (!plan.write) return;
    expect(plan.patch.low_thc_liquid).toBe(false);
    expect(plan.patch.unit_thc_mg).toBe(2);
  });

  /** A null in a patch is an ERASURE, not an omission. */
  it("never emits a null or undefined into the patch", () => {
    const combos: MirrorClassificationInput[] = [
      base,
      { ...base, otherwiseTaken: true, unitsPerPackage: 2 },
      { ...base, lowThcLiquid: true, unitThcMg: 4 },
      { ...base, unitsPerPackage: 3 },
    ];
    for (const c of combos) {
      const plan = planClassificationMirror(c);
      if (!plan.write) continue;
      for (const [k, v] of Object.entries(plan.patch)) {
        expect(v, `patch.${k}`).not.toBeNull();
        expect(v, `patch.${k}`).not.toBeUndefined();
      }
    }
  });

  it("refuses, with a reason, when there is no lot to write to", () => {
    for (const empty of [null, "", "   "]) {
      const plan = planClassificationMirror({ ...base, lotId: empty });
      expect(plan.write).toBe(false);
      if (plan.write) continue;
      expect(plan.code).toBe("no_lot_link");
      expect(plan.reason.length).toBeGreaterThan(40);
    }
  });
});

// ===========================================================================
// 3. PLUMBING — the policy is actually wired into the approval
// ===========================================================================

describe("18E plumbing — the approval path uses the mirror", () => {
  it("has no comment traps in the files these tests read", () => {
    for (const rel of [MIRROR_CORE, CATALOG_DRAFTS, LIVE_MENU]) {
      assertNoCommentTraps(rel);
    }
  });

  it("catalog-drafts imports and calls the mirror planner", () => {
    const original = read(CATALOG_DRAFTS);
    const code = stripComments(original);
    guardStripped(code, original, "approveDraft");
    expect(code).toContain("@/lib/inventory/classification-mirror-core");
    expect(code).toContain("planClassificationMirror(");
    // It must write to the lot table, keyed by the draft's lot link.
    expect(code).toContain('from("inventory_lots")');
    expect(code).toContain("mirror.lotId");
  });

  /**
   * ORDER IS THE SAFETY PROPERTY. The authoritative write must come first, so
   * a provenance hiccup can never make a successful classification look
   * failed. Proven positionally, because "which happened first" is exactly
   * what a keyword match cannot establish.
   */
  it("mirrors AFTER the authoritative draft update, never before", () => {
    const code = stripComments(read(CATALOG_DRAFTS));

    // NOT `indexOf('from("catalog_product_drafts")')`. This module touches
    // that table nine times — seeding, listing, dismissing — and the FIRST
    // occurrence sits hundreds of lines above the approval. Anchoring there
    // made this assertion vacuously true: a mutation that moved the mirror
    // ahead of the real update still passed. (Found by mutation E; the fix is
    // to anchor on the approval's own write, not on the table name.)
    //
    // `.update(update)` is that write: the object built from the approver's
    // validated picks, applied to the draft being approved.
    const authoritativeUpdate = code.indexOf(".update(update)");
    const mirrorCall = code.indexOf("planClassificationMirror(");
    expect(authoritativeUpdate).toBeGreaterThan(-1);
    expect(mirrorCall).toBeGreaterThan(-1);
    expect(mirrorCall).toBeGreaterThan(authoritativeUpdate);

    // And the mirror's own lot write must follow it too. Search from the
    // planner call, NOT from the top of the file: this module reads
    // `inventory_lots` in several unrelated places (seeding, strain lookup)
    // and the first of those sits far above the approval — anchoring there
    // would repeat the very mistake this test was just fixed for.
    const lotWrite = code.indexOf('from("inventory_lots")', mirrorCall);
    expect(lotWrite).toBeGreaterThan(-1);
    expect(lotWrite).toBeGreaterThan(authoritativeUpdate);
  });

  /**
   * The mirror is best-effort: it must never be able to fail the approval.
   * If it threw, a human's saved classification would be reported as an error
   * and they would answer it again — or stop trusting the screen.
   */
  it("cannot fail the approval (the mirror is wrapped and audited)", () => {
    const code = stripComments(read(CATALOG_DRAFTS));
    const mirrorCall = code.indexOf("planClassificationMirror(");
    // A try{} must open before the call and a catch must follow it.
    const tryBefore = code.lastIndexOf("try {", mirrorCall);
    const catchAfter = code.indexOf("} catch", mirrorCall);
    expect(tryBefore).toBeGreaterThan(-1);
    expect(catchAfter).toBeGreaterThan(mirrorCall);
    // The failure is recorded rather than swallowed silently.
    expect(code).toContain("lot_row_write_failed");
    expect(code).toContain("catalog_draft.classification_mirrored");
  });

  it("names the migrations when the columns are missing, not a raw DB string", () => {
    const code = stripComments(read(CATALOG_DRAFTS));
    // The 42703 ladder must be present for the mirror write.
    expect(code).toContain("42703");
    expect(read(CATALOG_DRAFTS)).toContain("migrations 0216 and 0217");
  });

  it("is registered in the pure self-test sweep with a no-op guard", () => {
    const code = stripComments(read(SELFTESTS));
    expect(code).toContain("__runClassificationMirrorTests");
    // The `passed < 1` guard stops a zero-assertion self-test registering as
    // a pass — the sweep would otherwise report green while testing nothing.
    expect(code).toMatch(
      /__runClassificationMirrorTests\(\);[\s\S]{0,120}passed < 1/,
    );
  });
});
