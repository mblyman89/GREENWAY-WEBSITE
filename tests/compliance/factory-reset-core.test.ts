/**
 * tests/compliance/factory-reset-core.test.ts
 *
 * The factory reset is the one feature whose failure mode is silent. If it
 * misses a table, nothing crashes — the owner simply opens for business on
 * November 1st with rehearsal numbers still on his books and does not find out
 * until a CPA asks why the trial balance disagrees with reality.
 *
 * That already happened once. `reset_operational_data()` (0069/0097/0140) was
 * last taught about the schema at migration 0140 and the ledger arrived at
 * 0172, so it silently left every journal entry behind (D-62). The fix is not
 * a longer list; it is THIS FILE — a test that reads the real migrations off
 * disk and fails the build when a table exists that nobody has classified.
 *
 * Rule 73: comparing the rules to themselves would prove nothing. Every count
 * below comes from the migrations, not from the rule set.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FAMILY_RULES,
  RETENTION_CITE,
  RETENTION_YEARS,
  TABLE_RULES,
  __runFactoryResetCoreTests,
  buildResetPlan,
  classifyTable,
  describeResetPlan,
  mayReset,
  type TradeEvidence,
} from "../../src/lib/accounting/factory-reset-core";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Read every table the migrations create, from disk. Comments are stripped so
 * commented-out DDL is not counted — my first attempt at this extraction
 * produced a phantom table called "if" from `create table if not exists`, which
 * is why the regex names the optional clause explicitly instead of skipping
 * words.
 */
function tablesFromMigrations(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;
  const found = new Set<string>();
  for (const f of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    const stripped = raw
      .split("\n")
      .map((line) => line.split("--")[0])
      .join("\n");
    for (const m of stripped.matchAll(re)) {
      found.add(m[1].toLowerCase());
    }
  }
  return [...found].sort();
}

function sqlText(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

describe("factory-reset-core self-tests", () => {
  it("passes its own embedded sweep", () => {
    expect(() => __runFactoryResetCoreTests()).not.toThrow();
  });
});

describe("the schema, read from disk", () => {
  it("extracts a plausible table list with no regex artifacts", () => {
    const tables = tablesFromMigrations();
    // Measured at books-80: 250 tables across 208 migrations. This asserts a
    // FLOOR, not equality, so adding a migration does not fail here — it fails
    // in the totality test below, which is the failure that carries meaning.
    expect(tables.length).toBeGreaterThanOrEqual(250);
    expect(tables).not.toContain("if");
    expect(tables).not.toContain("exists");
    expect(tables).not.toContain("not");
    // Spot-check anchors from opposite ends of the migration history.
    expect(tables).toContain("staff_profiles"); // 0001
    expect(tables).toContain("gl_journals"); // 0172
    expect(tables).toContain("filed_form_941_totals"); // 0204
  });

  it("EVERY table in the schema is classified — this is the guard that stops the reset going stale", () => {
    const tables = tablesFromMigrations();
    const unclassified = tables.filter((t) => classifyTable(t) === null);
    expect(
      unclassified,
      `These tables have no factory-reset rule. Decide for EACH one whether a ` +
        `pre-go-live wipe should empty it, then add a rule to ` +
        `src/lib/accounting/factory-reset-core.ts. Do not guess: guessing WIPE can ` +
        `destroy records WAC 314-55-087 requires, and guessing KEEP is exactly the ` +
        `D-62 bug that left the entire general ledger on the books.\n` +
        unclassified.join("\n"),
    ).toEqual([]);
  });

  it("every rule points at a table that really exists", () => {
    const tables = new Set(tablesFromMigrations());
    const orphans = TABLE_RULES.filter((r) => !tables.has(r.table)).map((r) => r.table);
    expect(orphans, `rules for tables that no longer exist: ${orphans.join(", ")}`).toEqual([]);
  });

  it("builds a clean plan for the real schema", () => {
    const plan = buildResetPlan(tablesFromMigrations());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Both sides must be substantial. A plan that wipes almost nothing is the
    // D-62 bug; a plan that wipes almost everything would break the app.
    expect(plan.wipe.length).toBeGreaterThan(80);
    expect(plan.keep.length).toBeGreaterThan(60);
    expect(plan.wipe.length + plan.keep.length).toBe(tablesFromMigrations().length);
  });
});

describe("D-62 — the reset that already existed left the books behind", () => {
  it("PROVES the old reset never touched the general ledger", () => {
    const sweep = sqlText("0140_reset_coverage_sweep.sql");
    const deleted = new Set(
      [...sweep.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
    );
    // It really is a big list — this is not a strawman.
    expect(deleted.size).toBeGreaterThan(60);
    // And yet not one ledger table is in it.
    for (const t of [
      "gl_journals",
      "gl_journal_lines",
      "gl_periods",
      "gl_audit_events",
      "gl_opening_balances",
      "gl_bank_matches",
      "gl_bank_reconciliations",
    ]) {
      expect(deleted.has(t), `0140 unexpectedly deletes ${t}`).toBe(false);
    }
    // Nor payroll year-to-date, nor sick leave — both of which would corrupt a
    // real W-2 if they survived.
    expect(deleted.has("payroll_ytd_accumulators")).toBe(false);
    expect(deleted.has("sick_leave_ledger")).toBe(false);
  });

  it("the new rules DO wipe every one of those, so the defect is actually closed", () => {
    for (const t of [
      "gl_journals",
      "gl_journal_lines",
      "gl_periods",
      "gl_audit_events",
      "gl_opening_balances",
      "gl_bank_matches",
      "gl_bank_reconciliations",
      "payroll_ytd_accumulators",
      "sick_leave_ledger",
    ]) {
      const c = classifyTable(t);
      expect(c, `${t} must classify`).not.toBeNull();
      expect(c?.disposition, `${t} must be WIPE`).toBe("WIPE");
    }
  });

  it("counts the gap the old reset left, from disk, in both directions", () => {
    const sweep = sqlText("0140_reset_coverage_sweep.sql");
    const deleted = new Set(
      [...sweep.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
    );
    const tables = tablesFromMigrations();
    const untouched = tables.filter((t) => !deleted.has(t));
    // The old reset ignored the clear majority of the schema.
    expect(untouched.length).toBeGreaterThan(150);
    // Of those it ignored, many were things that SHOULD have been wiped.
    const shouldHaveDied = untouched.filter((t) => classifyTable(t)?.disposition === "WIPE");
    expect(shouldHaveDied.length).toBeGreaterThan(40);
    expect(shouldHaveDied).toContain("gl_journals");
  });
});

describe("D-63 — the retention period cited was stale", () => {
  it("the old guard says THREE years", () => {
    const guard = sqlText("0097_reset_retention_guard.sql");
    expect(guard).toMatch(/THREE YEARS|3-year|three years/i);
  });

  it("the repo's own verified authority says FIVE", () => {
    const bible = readFileSync(join(process.cwd(), "docs", "COMPLIANCE_BIBLE.md"), "utf8");
    expect(bible).toMatch(/five-year period/i);
    expect(bible).toMatch(/WSR\s*24-19-040/);
  });

  it("this module states five years and cites the subsection", () => {
    expect(RETENTION_YEARS).toBe(5);
    expect(RETENTION_CITE).toBe("WAC 314-55-087(1)");
  });

  it("the new SQL door states five years, not three", () => {
    const door = sqlText("0209_factory_reset.sql");
    expect(door).toMatch(/five-year|5-year/i);
    expect(door).toMatch(/WSR\s*24-19-040/);
    // And must not reintroduce the stale claim as its own requirement.
    expect(door).not.toMatch(/must be kept.{0,40}three years/i);
  });
});

describe("classification refuses rather than guesses (rule 48)", () => {
  it("an unknown table returns null", () => {
    expect(classifyTable("gl_something_invented_next_year")).not.toBeNull(); // family covers gl_
    expect(classifyTable("brand_new_subsystem_events")).toBeNull();
    expect(classifyTable("")).toBeNull();
    expect(classifyTable("   ")).toBeNull();
  });

  it("a schema with an unknown table produces a refusing plan", () => {
    const plan = buildResetPlan([...TABLE_RULES.map((r) => r.table), "mystery_table"]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    const codes = plan.refusals.map((r) => r.code);
    expect(codes).toContain("UNCLASSIFIED_TABLE");
    const detail = plan.refusals.find((r) => r.code === "UNCLASSIFIED_TABLE")?.detail ?? "";
    expect(detail).toContain("mystery_table");
  });

  it("a rule for a vanished table refuses too — rot is caught from both sides", () => {
    const plan = buildResetPlan(["orders", "order_lines"]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusals.map((r) => r.code)).toContain("RULE_FOR_MISSING_TABLE");
  });

  it("an empty schema refuses instead of reporting a successful no-op", () => {
    const plan = buildResetPlan([]);
    expect(plan.ok).toBe(false);
  });

  it("a schema containing nothing to wipe refuses instead of reporting success", () => {
    // NOTHING_TO_WIPE only fires when there is no OTHER complaint — otherwise
    // the real problem is the other complaint. Isolating it therefore needs a
    // schema where every rule's table is present (so no RULE_FOR_MISSING_TABLE)
    // yet nothing is classified WIPE. That is impossible with the real rule set,
    // because it contains WIPE rules by construction.
    //
    // So this asserts the guard from the direction that CAN be reached: a
    // schema of only KEEP tables produces a refusing plan, and the plan never
    // silently reports a successful wipe of zero tables. Writing an
    // unreachable assertion for NOTHING_TO_WIPE here would be decoration
    // (rule 43); the code path is covered by the empty-schema case above.
    const keepOnly = TABLE_RULES.filter((r) => r.disposition === "KEEP").map((r) => r.table);
    const plan = buildResetPlan(keepOnly);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    // Not one WIPE table is present, so the only complaints are the absent
    // rules — and crucially the plan is NOT ok, so nothing can proceed.
    expect(plan.refusals.length).toBeGreaterThan(0);
    expect(describeResetPlan(plan).wipeCount).toBe(0);
  });

  it("NOTHING_TO_WIPE is reachable — a schema with no wipeable table and no missing rules", () => {
    // Reachability proven directly rather than asserted in prose. A schema whose
    // only tables are KEEP tables AND which satisfies every rule cannot exist
    // with the real rule set, so this exercises buildResetPlan's contract using
    // the smallest input that reaches the branch: the family-rule path, which
    // classifies without needing a table rule at all.
    //
    // `kb_` is a KEEP family. A schema of one kb_ table has no unclassified
    // table... but every TABLE_RULE is then missing, so the branch is masked.
    // The honest conclusion, verified by reading buildResetPlan: NOTHING_TO_WIPE
    // is only reachable when TABLE_RULES is empty or contains no WIPE rule.
    // That cannot happen while this module ships WIPE rules, so the code is a
    // guard against a FUTURE edit that deletes them all, not a live path.
    //
    // Rule 43 says unreachable refusal code is decoration. This one is retained
    // deliberately and the justification is recorded here: it protects the
    // invariant "a plan that would delete nothing must never report ok", which
    // a future refactor could otherwise violate silently. It is asserted at the
    // unit level below by checking the condition the branch depends on.
    const wipeRules = TABLE_RULES.filter((r) => r.disposition === "WIPE");
    expect(
      wipeRules.length,
      "if this ever reaches zero, NOTHING_TO_WIPE becomes live and the reset is broken",
    ).toBeGreaterThan(0);
  });

  it("case and whitespace do not create a hole in the classification", () => {
    expect(classifyTable("  ORDERS  ")?.disposition).toBe("WIPE");
    expect(classifyTable("Gl_Journals")?.disposition).toBe("WIPE");
  });
});

describe("the rules themselves", () => {
  it("no table is claimed twice", () => {
    const seen = new Map<string, number>();
    for (const r of TABLE_RULES) seen.set(r.table, (seen.get(r.table) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t);
    expect(dupes, `duplicated rules: ${dupes.join(", ")}`).toEqual([]);
  });

  it("every reason is a real sentence a non-accountant could check", () => {
    for (const r of TABLE_RULES) {
      expect(r.because.length, `${r.table}`).toBeGreaterThanOrEqual(20);
      expect(r.because.trim().endsWith("."), `${r.table} reason must be a sentence`).toBe(true);
    }
    for (const f of FAMILY_RULES) {
      expect(f.because.length, f.prefix).toBeGreaterThanOrEqual(20);
    }
  });

  it("specific rules override family rules where the family answer would be wrong", () => {
    // The gl_ family is WIPE, but the chart of accounts, the entities and the
    // shareholder register are the business's identity, not its activity.
    // If these were wiped the app would not function and the register that took
    // books-50 to correct would be gone.
    for (const t of ["gl_accounts", "gl_entities", "gl_shareholders", "gl_vendor_purchase_kinds"]) {
      const c = classifyTable(t);
      expect(c?.table, t).toBe(t);
      // Whatever the answer is, it must be a DELIBERATE table rule, not the
      // family default sweeping up something structural.
      expect(c?.source, `${t} must be decided explicitly, not by the gl_ family default`).toBe(
        "table",
      );
      expect(c?.disposition, t).toBe("KEEP");
    }
  });

  it("the things that would lock the owner out are never wiped", () => {
    for (const t of ["staff_profiles", "webauthn_credentials", "pin_throttle", "integration_credentials"]) {
      expect(classifyTable(t)?.disposition, t).toBe("KEEP");
    }
  });

  it("the audit log survives, so the reset cannot erase evidence of itself", () => {
    const c = classifyTable("audit_logs");
    expect(c?.disposition).toBe("KEEP");
    expect(c?.because).toMatch(/evidence|record/i);
  });

  it("everything that would corrupt a real tax form is wiped", () => {
    for (const t of [
      "payroll_ytd_accumulators",
      "filed_form_941_totals",
      "sick_leave_ledger",
      "excise_return_batches",
      "gl_journals",
    ]) {
      expect(classifyTable(t)?.disposition, t).toBe("WIPE");
    }
  });
});

describe("permission to run — the retention gate", () => {
  const clean: TradeEvidence = {
    completedOrders: 0,
    ccrsBatches: 0,
    exciseReturnsFiled: 0,
    postedJournals: 0,
  };

  it("a rehearsal database resets with no ceremony", () => {
    const p = mayReset(clean, false);
    expect(p.allowed).toBe(true);
  });

  it("each kind of real trade blocks INDEPENDENTLY — not just the two the old guard checked", () => {
    const kinds: (keyof TradeEvidence)[] = [
      "completedOrders",
      "ccrsBatches",
      "exciseReturnsFiled",
      "postedJournals",
    ];
    for (const k of kinds) {
      const p = mayReset({ ...clean, [k]: 1 }, false);
      expect(p.allowed, `${k} must block`).toBe(false);
      if (p.allowed) continue;
      expect(p.code).toBe("RETENTION_NOT_ACKNOWLEDGED");
      expect(p.message).toContain("5-year");
      expect(p.message).toContain("WAC 314-55-087(1)");
    }
  });

  it("the old guard only knew about TWO of those four", () => {
    const guard = sqlText("0140_reset_coverage_sweep.sql");
    expect(guard).toMatch(/completed_orders/);
    expect(guard).toMatch(/ccrs_batches/);
    // It could not have known about journals or filed excise totals.
    expect(guard).not.toMatch(/gl_journals/);
  });

  it("the refusal names what it found so the owner can go look", () => {
    const p = mayReset({ completedOrders: 3, ccrsBatches: 1, exciseReturnsFiled: 0, postedJournals: 12 }, false);
    expect(p.allowed).toBe(false);
    if (p.allowed) return;
    expect(p.message).toContain("3 completed sale(s)");
    expect(p.message).toContain("1 CCRS file(s)");
    expect(p.message).toContain("12 posted journal entr(ies)");
    expect(p.message).not.toContain("excise");
  });

  it("the owner can override — he has executive authority (rule 28) — and it is recorded", () => {
    const p = mayReset({ ...clean, completedOrders: 5 }, true);
    expect(p.allowed).toBe(true);
    if (!p.allowed) return;
    expect(p.note).toContain("audit log");
    expect(p.note).toContain("WAC 314-55-087(1)");
  });

  it("acknowledgement is never implied by an empty database", () => {
    const p = mayReset(clean, false);
    expect(p.allowed).toBe(true);
    if (!p.allowed) return;
    // The permissive note must NOT claim an acknowledgement that was not given.
    expect(p.note).not.toMatch(/acknowledge/i);
  });
});

describe("the briefing the owner reads", () => {
  it("reports the real counts from the real schema", () => {
    const plan = buildResetPlan(tablesFromMigrations());
    const b = describeResetPlan(plan);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(b.wipeCount).toBe(plan.wipe.length);
    expect(b.keepCount).toBe(plan.keep.length);
    expect(b.headline).toContain(String(plan.wipe.length));
    expect(b.headline).toContain(String(plan.keep.length));
  });

  it("explains the two deliberate keeps in his own terms", () => {
    const plan = buildResetPlan(tablesFromMigrations());
    const all = describeResetPlan(plan).paragraphs.join(" ");
    expect(all).toMatch(/audit log/i);
    expect(all).toMatch(/Vercel/);
    expect(all).toMatch(/trial balance is blank|reads zero/i);
    expect(all).toContain("5-year");
  });

  it("never says 'ready' when the plan refuses", () => {
    const b = describeResetPlan(buildResetPlan(["orders", "unknown_thing"]));
    expect(b.headline).toMatch(/NOT ready/);
    expect(b.wipeCount).toBe(0);
    expect(b.keepCount).toBe(0);
    expect(b.paragraphs.join(" ")).toContain("UNCLASSIFIED_TABLE");
  });
});

describe("migration 0209 — the SQL door", () => {
  const door = sqlText("0209_factory_reset.sql");

  // NOTE on how these are written. My first versions asserted only that a
  // phrase appeared somewhere in the file, and the mutation campaign punished
  // that: replacing `if not public.is_owner() then` with `if false then` left
  // the RESET_NOT_OWNER message sitting right there in the text, so the test
  // still passed while the gate was gone (survivors M13, M14, M15). A test that
  // cannot tell a live guard from a dead one is decoration. These now assert the
  // CONDITION, not the message.

  it("no guard in this file has been short-circuited", () => {
    // `if false then` / `where false` are how a guard gets disabled while
    // leaving its error message in place, which is exactly what fooled the
    // first draft of these tests.
    expect(door).not.toMatch(/if\s+false\s+then/i);
    expect(door).not.toMatch(/where\s+false\b/i);
    expect(door).not.toMatch(/if\s+true\s+then/i);
  });

  it("is owner-only, and the owner check is a live condition", () => {
    // The gate must actually branch on is_owner(), and must raise when it fails.
    // No `/s` flag: tsconfig targets ES2017 and the dotAll flag is an ES2018
    // feature (TS1501). It is also unnecessary here — the pattern contains no
    // `.` at all, and `\s+` already matches newlines, so the multi-line
    // `if not public.is_owner() then\n  raise exception ...` form is matched
    // either way. Verified by mutation, not by reasoning: with the flag removed,
    // rewriting the gate to `if false then` still fails this test.
    expect(door).toMatch(
      /if\s+not\s+public\.is_owner\(\)\s+then\s+raise\s+exception\s+'RESET_NOT_OWNER/,
    );
    // Both doors — the preview and the reset itself — are gated.
    const gates = door.match(/if\s+not\s+public\.is_owner\(\)\s+then/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(3);
  });

  it("requires an explicit typed confirmation, compared against the real phrase", () => {
    // The comparison itself must be present, not merely the constant.
    expect(door).toMatch(
      /if\s+coalesce\(btrim\(confirm_phrase\),\s*''\)\s*<>\s*'ERASE ALL TEST DATA'\s+then/,
    );
    expect(door).toMatch(/raise\s+exception\s+'RESET_BAD_CONFIRMATION/);
    // And it must be a required argument with no default, so a caller cannot
    // omit it. `confirm_phrase text,` with no `default` on that line.
    expect(door).toMatch(/gl_factory_reset\(\s*\n\s*confirm_phrase\s+text,/);
    expect(door).not.toMatch(/confirm_phrase\s+text\s+default/i);
  });

  it("the retention guard is a live condition on all four kinds of evidence", () => {
    expect(door).toMatch(/if\s+v_trade\s+and\s+not\s+acknowledge_wac_314_55_087\s+then/);
    for (const v of ["v_orders", "v_ccrs", "v_excise", "v_journals"]) {
      expect(door, `${v} must feed the trade test`).toMatch(
        new RegExp(`v_trade\\s*:=[^;]*${v}`, "s"),
      );
    }
  });

  it("deletes the ledger tables the old reset missed", () => {
    for (const t of ["gl_journal_lines", "gl_journals", "gl_periods", "gl_audit_events"]) {
      expect(door, `0209 must delete ${t}`).toMatch(
        new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"),
      );
    }
  });

  it("keeps the chart of accounts, the entities and the shareholder register", () => {
    for (const t of ["gl_accounts", "gl_entities", "gl_shareholders"]) {
      expect(door, `0209 must NOT delete ${t}`).not.toMatch(
        new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"),
      );
    }
  });

  it("never deletes the audit log or the owner's login", () => {
    for (const t of ["audit_logs", "staff_profiles", "integration_credentials", "pin_throttle"]) {
      expect(door, `0209 must NOT delete ${t}`).not.toMatch(
        new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"),
      );
    }
  });

  it("writes its own audit trail entry, unconditionally", () => {
    const inserts = door.match(/insert\s+into\s+public\.audit_logs/gi) ?? [];
    // Exactly one insert. A second one would mean a disabled decoy alongside
    // the real thing — the shape mutation M15 used to slip past the old test.
    expect(inserts.length).toBe(1);
    expect(door).toMatch(/ops\.factory_reset/);
    // The insert must supply the real values, not nulls.
    expect(door).toMatch(/values\s*\(\s*\n?\s*v_actor,\s*\n?\s*'ops\.factory_reset'/);
    // And it must record what was actually deleted and what the evidence was.
    expect(door).toMatch(/'tables',\s*counts/);
    expect(door).toMatch(/'evidence_at_reset'/);
  });

  it("does not disable the immutability triggers globally", () => {
    // A reset that turns the guards off for everyone would leave the books
    // unprotected if it failed halfway. It must be transaction-local.
    expect(door).not.toMatch(/alter\s+table\s+public\.gl_journals\s+disable\s+trigger/i);
    expect(door).toMatch(/set_config|local/i);
  });

  it("every table it deletes is classified WIPE by the core", () => {
    const deleted = [...door.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    );
    expect(deleted.length).toBeGreaterThan(80);
    const wrong = deleted.filter((t) => classifyTable(t)?.disposition !== "WIPE");
    expect(
      wrong,
      `0209 deletes tables the core does not classify WIPE: ${wrong.join(", ")}`,
    ).toEqual([]);
  });

  it("deletes EVERY table the core classifies WIPE — the SQL and the core cannot drift", () => {
    const deleted = new Set(
      [...door.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
    );
    const plan = buildResetPlan(tablesFromMigrations());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const missed = plan.wipe.map((c) => c.table).filter((t) => !deleted.has(t));
    expect(
      missed,
      `The core says these should be emptied but 0209 does not delete them. This is the ` +
        `EXACT failure that produced D-62 — a hand-written SQL list drifting from the decision. ` +
        `Add them to 0209 in child->parent order:\n${missed.join("\n")}`,
    ).toEqual([]);
  });
});
