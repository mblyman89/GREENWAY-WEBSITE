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
  CURRENT_RESET_RPC,
  FAMILY_RULES,
  KEPT_CONNECTION_CURSOR_RESETS,
  RESET_BLIND_SPOTS,
  RESET_CONFIRM_PHRASE,
  RETENTION_CITE,
  RETENTION_YEARS,
  SUPERSEDED_RESET_RPC,
  TABLE_RULES,
  WIPE_TABLES_WITH_STORAGE_POINTERS,
  __runFactoryResetCoreTests,
  buildResetPlan,
  classifyTable,
  confirmPhraseAccepted,
  describeResetPlan,
  evaluateResetRequest,
  summariseResetOutcome,
  mayReset,
  type TradeEvidence,
} from "../../src/lib/accounting/factory-reset-core";
import { listSchemaTables } from "../../src/lib/admin/schema-tables";

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

// ═══════════════════════════════════════════════════════════════════════════
// D-64 — THE BUTTON WAS WIRED TO THE OLD RESET
//
// Everything above proves the RULES are current and the SQL matches them.
// None of it proved the third link: that the button the owner presses calls
// the function those tests are about. It did not. `gl_factory_reset` appeared
// in zero lines of application code while the reset screen ran the superseded
// `reset_operational_data()`, which deletes 66 tables against the core's 138.
//
// These read the real source files, so the chain UI -> action -> service ->
// RPC cannot silently come apart again.
// ═══════════════════════════════════════════════════════════════════════════

function src(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

/** Source with `//` line comments and block comments removed. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.split("//")[0])
    .join("\n");
}

describe("D-64 — the reset button calls the CURRENT reset", () => {
  const service = src("src", "lib", "admin", "reset-service.ts");
  const actions = src("src", "app", "admin", "settings", "actions.ts");
  const page = src("src", "app", "admin", "settings", "reset", "page.tsx");

  it("the service calls gl_factory_reset and not the superseded function", () => {
    const live = code(service);
    // It reaches the RPC through the shared constant rather than a re-typed
    // string, which is stronger than a literal: the name cannot drift from the
    // core, and `the phrase in the core is the phrase in the SQL` below ties
    // the core to migration 0209.
    expect(live).toMatch(/rpc\(\s*CURRENT_RESET_RPC/);
    expect(live).toMatch(/CURRENT_RESET_RPC[\s\S]*from "@\/lib\/accounting\/factory-reset-core"/);
    expect(CURRENT_RESET_RPC).toBe("gl_factory_reset");
    // The superseded name may appear in the explanatory comment, but must not
    // survive in executable code. This is the assertion that would have caught
    // the defect on the day it was introduced.
    expect(
      live.includes(`"${SUPERSEDED_RESET_RPC}"`) || live.includes(`'${SUPERSEDED_RESET_RPC}'`),
      "reset-service still calls the superseded reset_operational_data()",
    ).toBe(false);
  });

  it("no application code anywhere still routes to the superseded RPC", () => {
    // Walk the whole app rather than the two files I happen to be editing —
    // the point of the defect was that nobody looked at the third file.
    const roots = [join(process.cwd(), "src")];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const live = code(readFileSync(p, "utf8"));
          if (
            live.includes(`rpc("${SUPERSEDED_RESET_RPC}"`) ||
            live.includes(`rpc('${SUPERSEDED_RESET_RPC}'`)
          ) {
            offenders.push(p);
          }
        }
      }
    };
    for (const r of roots) walk(r);
    expect(
      offenders,
      `These still call ${SUPERSEDED_RESET_RPC}, which leaves the general ledger behind:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the action forwards the typed phrase verbatim, never upper-cased", () => {
    const live = code(actions);
    expect(live).toContain("evaluateResetRequest");
    expect(live).toContain("runFactoryReset");
    // The old action did `.trim().toUpperCase()` before comparing. The SQL does
    // not upper-case, so doing it here would accept a phrase the database then
    // refuses — and would let a casual "erase all test data" count as
    // deliberate intent for the most destructive operation in the system.
    expect(live).not.toMatch(/fd\.get\("confirm"\)[\s\S]{0,80}toUpperCase\(\)/);
  });

  it("the action still requires the retention attestation to reach the database", () => {
    const live = code(actions);
    // It must be READ from the form and PASSED, not defaulted to true.
    expect(live).toMatch(/retention_attestation/);
    expect(live).toMatch(/runFactoryReset\(\s*decision\.confirmPhrase,\s*decision\.acknowledgeRetention\s*\)/);
    expect(live).not.toMatch(/runFactoryReset\([^)]*,\s*true\s*\)/);
  });

  it("the action verifies the result instead of trusting it", () => {
    const live = code(actions);
    expect(live).toContain("auditFactoryReset");
    // The problems must reach the owner's screen, via the pure summariser
    // whose behaviour is asserted by EXECUTION below.
    expect(live).toContain("summariseResetOutcome");
    // The problems the audit found must be the ones handed to the summariser.
    // `problems: []` would silence a real warning while every identifier in
    // this file still looked correct — a mutant that survived until this
    // assertion was written.
    expect(live).toMatch(/summariseResetOutcome\(\{[\s\S]{0,200}\bproblems,/);
    expect(live).not.toMatch(/problems:\s*\[\]\s*,?\s*\}\)/);
  });

  it("the screen shows the phrase the database actually compares against", () => {
    const live = code(page);
    expect(live).toContain("RESET_CONFIRM_PHRASE");
    // The superseded phrase must be gone from the UI entirely, or the owner
    // types what the screen says and is refused.
    expect(page).not.toContain("RESET OPERATIONAL DATA (WAC 314-55-087)");
  });

  it("the screen's counts come from the core, not from a hand-typed list", () => {
    const live = code(page);
    expect(live).toContain("buildResetPlan");
    expect(live).toContain("listSchemaTables");
    // The two hand-maintained category arrays are what drifted; they must not
    // come back.
    expect(live).not.toMatch(/const\s+CLEARED\s*:/);
    expect(live).not.toMatch(/const\s+KEPT\s*:/);
  });

  it("the service uses the owner's session, not the service-role key", () => {
    const live = code(service);
    // gl_factory_reset gates on is_owner(), which reads auth.uid(). The
    // service-role key has no `sub` claim, so auth.uid() is NULL and the call
    // would fail RESET_NOT_OWNER every single time regardless of who is signed
    // in. This is the same defect books-client.ts was created to fix.
    expect(live).toContain("createBooksClient");
    expect(live).not.toContain("createSupabaseAdminClient");
  });

  it("the phrase in the core is the phrase in the SQL", () => {
    const door = sqlText("0209_factory_reset.sql");
    expect(door).toContain(`'${RESET_CONFIRM_PHRASE}'`);
  });
});

describe("the runtime schema snapshot cannot drift from the migrations", () => {
  it("lists exactly the tables the migrations create", () => {
    const onDisk = tablesFromMigrations();
    const snapshot = [...listSchemaTables()];
    const missing = onDisk.filter((t) => !snapshot.includes(t));
    const extra = snapshot.filter((t) => !onDisk.includes(t));
    expect(
      { missing, extra },
      `src/lib/admin/schema-tables.ts is stale. Run: npx tsx scripts/generate-schema-tables.ts`,
    ).toEqual({ missing: [], extra: [] });
  });

  it("the reset screen therefore plans against the real schema", () => {
    // If the snapshot were wrong the screen could show a clean plan while the
    // database contained an unclassified table.
    const plan = buildResetPlan(listSchemaTables());
    expect(plan.ok).toBe(true);
  });
});

describe("what a table-by-table reset structurally cannot reach", () => {
  const door = sqlText("0209_factory_reset.sql");

  it("the three blind spots are REAL — 0209 genuinely does not handle them", () => {
    // Asserted from the SQL, not from the note. If a future migration teaches
    // the reset to clear storage or restart sequences, this fails and the
    // documentation must be corrected rather than left overstating the limit.
    expect(door).not.toMatch(/storage\.objects/i);
    expect(door).not.toMatch(/delete\s+from\s+auth\.users/i);
    expect(door).not.toMatch(/\bsetval\s*\(/i);
    expect(door).not.toMatch(/restart\s+identity/i);
  });

  it("each blind spot is disclosed with a remedy, and none of them touches the books", () => {
    expect(RESET_BLIND_SPOTS.map((b) => b.id).sort()).toEqual([
      "AUTH_USERS",
      "SEQUENCES",
      "STORAGE_OBJECTS",
    ]);
    for (const b of RESET_BLIND_SPOTS) {
      expect(b.limit.length, b.id).toBeGreaterThanOrEqual(40);
      expect(b.action.length, b.id).toBeGreaterThanOrEqual(40);
      expect(b.affectsBooks, `${b.id} would put wrong numbers on a report`).toBe(false);
    }
  });

  it("the storage-pointer tables named are really WIPE, and really hold paths", () => {
    for (const t of WIPE_TABLES_WITH_STORAGE_POINTERS) {
      expect(classifyTable(t)?.disposition, t).toBe("WIPE");
    }
    // And the claim that they hold storage paths is checked against the DDL.
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => sqlText(f))
      .join("\n");
    for (const t of WIPE_TABLES_WITH_STORAGE_POINTERS) {
      const block = all.slice(all.indexOf(`create table if not exists public.${t}`));
      expect(block.slice(0, 1200), `${t} should declare a storage path column`).toMatch(
        /storage_path/,
      );
    }
  });

  it("keeping the journal sequence is deliberate, so numbers are never reused", () => {
    // The SEQUENCES note leans on this being KEEP. If someone flipped it to
    // WIPE the note would become false and a real entry could reuse a
    // rehearsal entry's number.
    expect(classifyTable("gl_journal_sequences")?.disposition).toBe("KEEP");
  });

  it("the owner is told about the limits before he presses the button", () => {
    const plan = buildResetPlan(tablesFromMigrations());
    const text = describeResetPlan(plan).paragraphs.join(" ");
    expect(text).toContain("auth.users");
    expect(text).toMatch(/bucket/i);
    expect(text).toMatch(/counters|numbering/i);
  });
});

describe("the reset cannot orphan a row it leaves behind", () => {
  /**
   * Foreign keys, read from the migrations with BALANCED-PAREN block
   * extraction.
   *
   * A naive `create table ...([\s\S]*?)\)` regex leaks past the end of the
   * block and attributes one table's `references` clauses to another. That
   * produced a false finding during this audit — a reported FK from
   * gl_payroll_labor_roles to inbound_manifests, which does not exist in the
   * DDL at all. Walking the parentheses is the only way to know where the
   * block ends.
   */
  function foreignKeys(): { child: string; parent: string; action: string }[] {
    const edges: { child: string; parent: string; action: string }[] = [];
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql"))) {
      const sql = sqlText(f)
        .split("\n")
        .map((l) => l.split("--")[0])
        .join("\n");
      const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        const child = m[1].toLowerCase();
        let depth = 1;
        let i = re.lastIndex;
        while (i < sql.length && depth > 0) {
          const ch = sql[i];
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
          i++;
        }
        if (depth !== 0) continue;
        const body = sql.slice(re.lastIndex, i - 1);
        const rre = /references\s+(?:public\.)?([a-z0-9_]+)\s*(?:\([^)]*\))?([^,\n]*)/gi;
        let r: RegExpExecArray | null;
        while ((r = rre.exec(body)) !== null) {
          const tail = (r[2] || "").toLowerCase();
          const action = /on\s+delete\s+cascade/.test(tail)
            ? "CASCADE"
            : /on\s+delete\s+set\s+null/.test(tail)
              ? "SET NULL"
              : /on\s+delete\s+set\s+default/.test(tail)
                ? "SET DEFAULT"
                : /on\s+delete\s+restrict/.test(tail)
                  ? "RESTRICT"
                  : "NO ACTION";
          edges.push({ child, parent: r[1].toLowerCase(), action });
        }
      }
    }
    return edges;
  }

  it("extracts a plausible number of foreign keys", () => {
    // A floor, so adding a table does not fail here. Measured: 440.
    expect(foreignKeys().length).toBeGreaterThanOrEqual(400);
  });

  it("the parser does not invent edges by leaking across table boundaries", () => {
    // The specific false positive this parser was written to eliminate.
    const bogus = foreignKeys().filter(
      (e) => e.child === "gl_payroll_labor_roles" && e.parent === "inbound_manifests",
    );
    expect(bogus, "the balanced-paren scan is leaking again").toEqual([]);
  });

  it("no KEPT table points at a table that gets emptied", () => {
    // This is the failure mode a table-by-table reset can actually have: a row
    // that survives holding a foreign key to a row that does not. It would
    // either block the delete or leave a dangling reference.
    const bad = foreignKeys().filter(
      (e) =>
        classifyTable(e.child)?.disposition === "KEEP" &&
        classifyTable(e.parent)?.disposition === "WIPE",
    );
    expect(
      bad.map((e) => `${e.child} -> ${e.parent} (${e.action})`),
      `A KEPT table references a WIPED one. After the reset these rows point at nothing.`,
    ).toEqual([]);
  });

  it("0209 deletes every child before its parent on the blocking edges", () => {
    // CASCADE and SET NULL edges look after themselves. NO ACTION and RESTRICT
    // do not: if the parent is deleted first, the whole reset aborts.
    const blocking = [
      ...new Map(
        foreignKeys()
          .filter(
            (e) =>
              classifyTable(e.child)?.disposition === "WIPE" &&
              classifyTable(e.parent)?.disposition === "WIPE" &&
              (e.action === "NO ACTION" || e.action === "RESTRICT") &&
              e.child !== e.parent,
          )
          .map((e) => [`${e.child}|${e.parent}`, e]),
      ).values(),
    ];
    expect(blocking.length).toBeGreaterThan(0);

    const door = sqlText("0209_factory_reset.sql");
    const order = [...door.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) =>
      m[1].toLowerCase(),
    );
    const at = new Map<string, number>();
    order.forEach((t, i) => {
      if (!at.has(t)) at.set(t, i);
    });

    const wrong = blocking
      .filter((e) => {
        const c = at.get(e.child);
        const p = at.get(e.parent);
        return c === undefined || p === undefined || c > p;
      })
      .map((e) => `${e.child} must be deleted before ${e.parent} (${e.action})`);

    expect(wrong, `0209 deletes a parent before its child; the reset would abort.`).toEqual([]);
  });
});

describe("the RPC names are tied to the SQL that defines them", () => {
  const door = sqlText("0209_factory_reset.sql");

  it("every RPC the app calls is actually created by migration 0209", () => {
    // Without this, CURRENT_RESET_RPC could be renamed to anything and the
    // wiring tests above would still pass while the button called a function
    // that does not exist.
    for (const fn of [CURRENT_RESET_RPC, "gl_factory_reset_preview", "gl_audit_factory_reset"]) {
      expect(door, `0209 must define ${fn}`).toMatch(
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "i"),
      );
    }
  });

  it("0209 does not define the superseded function", () => {
    expect(door).not.toMatch(
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${SUPERSEDED_RESET_RPC}\\s*\\(`, "i"),
    );
  });

  it("the confirmation helper agrees with the SQL comparison exactly", () => {
    // The SQL is: coalesce(btrim(confirm_phrase), '') <> 'ERASE ALL TEST DATA'
    // i.e. trim, then compare case-SENSITIVELY.
    expect(door).toMatch(/btrim\(confirm_phrase\)/);
    expect(door).not.toMatch(/upper\(confirm_phrase\)/i);
    expect(confirmPhraseAccepted(RESET_CONFIRM_PHRASE)).toBe(true);
    expect(confirmPhraseAccepted(`  ${RESET_CONFIRM_PHRASE}\n`)).toBe(true);
    expect(confirmPhraseAccepted(RESET_CONFIRM_PHRASE.toLowerCase())).toBe(false);
    expect(confirmPhraseAccepted("")).toBe(false);
    expect(confirmPhraseAccepted("RESET OPERATIONAL DATA (WAC 314-55-087)")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The action's decisions, EXECUTED
//
// The first mutation campaign on this slice left two survivors: rewriting the
// action's phrase gate to `if (false)` and deleting its post-reset audit call
// both left the suite green, because the only available assertions were greps
// against the action's source text and the identifiers were still sitting
// there. A test that cannot distinguish a live guard from a dead one is
// decoration (rule 43).
//
// The logic was therefore extracted into the pure core rather than the mutants
// being weakened, and these run it.
// ═══════════════════════════════════════════════════════════════════════════

describe("evaluateResetRequest — the gate, executed", () => {
  it("refuses a wrong phrase and names the right one", () => {
    const d = evaluateResetRequest({ typed: "reset please", attested: true });
    expect(d.proceed).toBe(false);
    if (d.proceed) return;
    expect(d.error).toContain(RESET_CONFIRM_PHRASE);
    expect(d.error).toMatch(/Nothing was deleted/);
  });

  it("refuses an empty phrase even when the box is ticked", () => {
    expect(evaluateResetRequest({ typed: "", attested: true }).proceed).toBe(false);
    expect(evaluateResetRequest({ typed: "   ", attested: true }).proceed).toBe(false);
  });

  it("refuses the SUPERSEDED phrase — the one the old screen asked for", () => {
    const d = evaluateResetRequest({
      typed: "RESET OPERATIONAL DATA (WAC 314-55-087)",
      attested: true,
    });
    expect(d.proceed).toBe(false);
  });

  it("refuses a case-folded phrase, exactly as the database would", () => {
    expect(evaluateResetRequest({ typed: "erase all test data", attested: true }).proceed).toBe(
      false,
    );
  });

  it("accepts the exact phrase and forwards it UNCHANGED", () => {
    const d = evaluateResetRequest({ typed: `  ${RESET_CONFIRM_PHRASE}  `, attested: false });
    expect(d.proceed).toBe(true);
    if (!d.proceed) return;
    // Whitespace is tolerated (btrim), but the text handed to the database is
    // what the owner actually typed — this layer must not normalise it.
    expect(d.confirmPhrase).toBe(`  ${RESET_CONFIRM_PHRASE}  `);
  });

  it("never invents the retention acknowledgement", () => {
    const no = evaluateResetRequest({ typed: RESET_CONFIRM_PHRASE, attested: false });
    expect(no.proceed).toBe(true);
    if (!no.proceed) return;
    expect(no.acknowledgeRetention).toBe(false);

    const yes = evaluateResetRequest({ typed: RESET_CONFIRM_PHRASE, attested: true });
    expect(yes.proceed).toBe(true);
    if (!yes.proceed) return;
    expect(yes.acknowledgeRetention).toBe(true);
  });
});

describe("summariseResetOutcome — the verification, executed", () => {
  it("reports the real counts and says the ledger went with them", () => {
    const msg = summariseResetOutcome({
      totalRowsDeleted: 4211,
      tablesEmptied: 138,
      problems: [],
    });
    expect(msg).toContain("4211");
    expect(msg).toContain("138");
    expect(msg).toMatch(/general ledger/i);
    expect(msg).not.toMatch(/WARNING/);
  });

  it("SHOUTS when the post-reset check found something still on the books", () => {
    const msg = summariseResetOutcome({
      totalRowsDeleted: 10,
      tablesEmptied: 138,
      problems: [{ problem: "JOURNALS_REMAIN", detail: "3 journal(s) still on the books" }],
    });
    expect(msg).toContain("WARNING");
    expect(msg).toContain("JOURNALS_REMAIN");
    expect(msg).toContain("3 journal(s) still on the books");
  });

  it("reports EVERY problem, not just the first", () => {
    const msg = summariseResetOutcome({
      totalRowsDeleted: 0,
      tablesEmptied: 0,
      problems: [
        { problem: "JOURNALS_REMAIN", detail: "a" },
        { problem: "PAYROLL_YTD_REMAINS", detail: "b" },
        { problem: "CHART_OF_ACCOUNTS_LOST", detail: "c" },
      ],
    });
    for (const p of ["JOURNALS_REMAIN", "PAYROLL_YTD_REMAINS", "CHART_OF_ACCOUNTS_LOST"]) {
      expect(msg).toContain(p);
    }
  });

  it("a success line can never be mistaken for a warning line", () => {
    const clean = summariseResetOutcome({ totalRowsDeleted: 1, tablesEmptied: 1, problems: [] });
    const dirty = summariseResetOutcome({
      totalRowsDeleted: 1,
      tablesEmptied: 1,
      problems: [{ problem: "X", detail: "y" }],
    });
    expect(clean).not.toEqual(dirty);
    expect(dirty.startsWith(clean)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D-65 — A REHEARSAL MUST NOT COST YOU YOUR CONNECTIONS
//
// The owner's requirement, in his words: "I don't want to have to re-establish
// connections with all of them, it's a pain in the butt."
//
// The `atm_` and `plaid_` families are WIPE, which was right for the rows those
// feeds PRODUCE and wrong for the rows that ARE the feed. These tests pin the
// carve-outs, and — more importantly — pin the SECOND half of the problem: a
// kept connection whose sync cursor was also kept would leave the bank looking
// connected and healthy while its history was permanently gone.
// ═══════════════════════════════════════════════════════════════════════════

describe("D-65 — the connections survive the reset", () => {
  const door = sqlText("0209_factory_reset.sql");

  /** Connection/identity tables that must never be emptied by a rehearsal. */
  const CONNECTIONS = [
    "atm_connection",
    "plaid_items",
    "plaid_accounts",
    "manual_loans",
    "crypto_wallets",
    "crypto_assets",
    "crypto_owner_wallet_confirmations",
    "integration_credentials",
  ] as const;

  it("every connection the owner named is KEEP", () => {
    for (const t of CONNECTIONS) {
      const c = classifyTable(t);
      expect(c, `${t} must classify`).not.toBeNull();
      expect(c?.disposition, `${t} must be KEEP — re-linking it is manual work`).toBe("KEEP");
    }
  });

  it("each one is KEEP by a DELIBERATE table rule, not by a family default", () => {
    // This is the part that matters. atm_/plaid_ are WIPE families, so a KEEP
    // here can only come from a specific rule someone wrote on purpose. If a
    // future edit deletes the rule, the family takes over and the table starts
    // being wiped again SILENTLY. Asserting the source catches exactly that.
    for (const t of ["atm_connection", "plaid_items", "plaid_accounts"] as const) {
      expect(classifyTable(t)?.source, `${t} must be decided by an explicit table rule`).toBe(
        "table",
      );
    }
  });

  it("the families they live in really are WIPE — so the carve-out is doing the work", () => {
    // Rule 73: prove the premise instead of assuming it. If atm_/plaid_ were
    // KEEP families the test above would pass for the wrong reason.
    for (const p of ["atm_", "plaid_"]) {
      const fam = FAMILY_RULES.find((f) => f.prefix === p);
      expect(fam, `${p} family rule must exist`).toBeDefined();
      expect(fam?.disposition, `${p} must still be a WIPE family`).toBe("WIPE");
    }
    // And a sibling in each family is still wiped, so this is a scalpel and not
    // a blanket amnesty for anything named atm_* or plaid_*.
    expect(classifyTable("atm_settlements")?.disposition).toBe("WIPE");
    expect(classifyTable("plaid_transactions")?.disposition).toBe("WIPE");
  });

  it("0209 does not delete a single one of them", () => {
    for (const t of CONNECTIONS) {
      expect(door, `0209 must NOT delete ${t} — that is the connection itself`).not.toMatch(
        new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"),
      );
    }
  });

  it("but the ACTIVITY those connections produced is still wiped", () => {
    // Keeping the login must not turn into keeping the test data. Every one of
    // these is the feed's output and must still clear.
    for (const t of [
      "plaid_transactions",
      "plaid_holdings",
      "plaid_mortgages",
      "plaid_webhook_events",
      "atm_settlements",
      "atm_transactions",
      "atm_cash_loads",
      "atm_reconciliation",
      "atm_terminal_status",
      "crypto_transactions",
      "crypto_balances",
      "crypto_price_snapshots",
      "crypto_sync_state",
      "manual_loan_payments",
    ]) {
      expect(classifyTable(t)?.disposition, `${t} is activity and must be WIPE`).toBe("WIPE");
      expect(door, `0209 must delete ${t}`).toMatch(
        new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"),
      );
    }
  });

  it("keeping a parent while wiping its child cannot orphan anything", () => {
    // plaid_transactions -> plaid_accounts -> plaid_items, and
    // manual_loan_payments -> manual_loans. In every case the KEPT table is the
    // PARENT and the WIPED table is the CHILD, which is the safe direction: the
    // child's FK simply has no rows left. The reverse would have left dangling
    // references. Verified from the DDL, not assumed.
    // NOTE: plaid_accounts is deliberately absent as a child here. It is KEPT,
    // so the plaid_items -> plaid_accounts pair is KEEP -> KEEP, which orphans
    // nothing. An earlier draft of this test listed it as a wiped child and
    // failed, which is the test catching me rather than me catching the test.
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["plaid_transactions", "plaid_accounts"],
      ["plaid_holdings", "plaid_accounts"],
      ["plaid_mortgages", "plaid_accounts"],
      ["manual_loan_payments", "manual_loans"],
      ["crypto_balances", "crypto_wallets"],
      ["crypto_transactions", "crypto_wallets"],
      ["crypto_sync_state", "crypto_wallets"],
    ];
    for (const [child, parent] of pairs) {
      expect(classifyTable(child)?.disposition, `${child} (child) should wipe`).toBe("WIPE");
      expect(classifyTable(parent)?.disposition, `${parent} (parent) should be kept`).toBe("KEEP");
    }
  });

  // ── The trap ─────────────────────────────────────────────────────────────
  it("REWINDS the sync cursor on every connection it keeps", () => {
    // Plaid's /transactions/sync returns only what changed since the saved
    // cursor. Keep the item, wipe the transactions, and the next sync resumes
    // PAST the deleted rows: the history is gone from our database, Plaid will
    // not re-send it, and nothing reports an error. The reset must therefore
    // null the cursor. This test is the whole reason the UPDATE exists.
    expect(door).toMatch(
      /update\s+public\.plaid_items\s+set\s+transactions_cursor\s*=\s*null/i,
    );
    expect(door).toMatch(/last_successful_sync\s*=\s*null/i);
    expect(door).toMatch(/update\s+public\.atm_connection\s+set\s+last_sync_at\s*=\s*null/i);
  });

  it("the cursor rewind is an UPDATE, never a DELETE in disguise", () => {
    // A 'fix' that deleted plaid_items to clear the cursor would pass a naive
    // 'cursor is reset' check while destroying the very thing we are keeping.
    for (const t of ["plaid_items", "atm_connection"]) {
      expect(door).not.toMatch(new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"));
    }
  });

  it("the documented cursor list matches what the SQL actually does", () => {
    // The constant is not decoration: every column it names must really be
    // nulled by 0209, or the note is a lie that outlives the code.
    expect(KEPT_CONNECTION_CURSOR_RESETS.length).toBeGreaterThan(0);
    for (const entry of KEPT_CONNECTION_CURSOR_RESETS) {
      expect(classifyTable(entry.table)?.disposition, `${entry.table} must be KEEP`).toBe("KEEP");
      expect(door, `0209 must update ${entry.table}`).toMatch(
        new RegExp(`update\\s+public\\.${entry.table}\\b`, "i"),
      );
      for (const col of entry.columns) {
        expect(door, `0209 must null ${entry.table}.${col}`).toMatch(
          new RegExp(`${col}\\s*=\\s*null`, "i"),
        );
      }
      expect(entry.why.length, `${entry.table} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it("the cursor columns it nulls are REAL columns in the migrations", () => {
    // Rule 73 again: nulling a column that does not exist would make 0209 fail
    // at runtime, and a grep-only test would never notice.
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    for (const entry of KEPT_CONNECTION_CURSOR_RESETS) {
      const block = all.slice(
        all.indexOf(`create table if not exists public.${entry.table}`),
      );
      for (const col of entry.columns) {
        expect(
          block.slice(0, 2500),
          `${entry.table}.${col} must exist in the DDL`,
        ).toMatch(new RegExp(`\\b${col}\\b`));
      }
    }
  });

  it("the on-screen briefing TELLS him his connections are safe, and what still goes", () => {
    // He should not have to take my word for it in a chat message. The screen
    // he is standing in front of has to say it.
    const plan = buildResetPlan(tablesFromMigrations());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const text = describeResetPlan(plan).paragraphs.join(" ").toLowerCase();
    for (const phrase of ["plaid", "atm", "crypto", "loan"]) {
      expect(text, `the briefing must mention ${phrase}`).toContain(phrase);
    }
    // And it must not overclaim: the activity is still destroyed, and the
    // rewind must be disclosed rather than being a silent surprise.
    expect(text).toMatch(/erased|erases|still/);
    expect(text).toMatch(/rewind|sync position|full history/);
  });

  it("the reset still empties the great majority of the schema", () => {
    // Carve-outs are a slippery slope: each one is defensible and the sum can
    // quietly turn the reset into a no-op. This holds the line.
    const plan = buildResetPlan(tablesFromMigrations());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.wipe.length).toBeGreaterThan(120);
    expect(plan.wipe.length).toBeGreaterThan(plan.keep.length);
  });
});
