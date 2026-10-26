/**
 * tests/compliance/r5-reset-proof.test.ts — Round 5 / Slice R5-2.
 *
 * The owner's "Clean Slate" plan: rehearse receiving, sales, customer returns,
 * destructions and vendor returns on real manifests, then factory-reset, then
 * go live. These tests prove, by EXECUTION against the real rule set, the real
 * schema snapshot and the real 0240 SQL, that:
 *   1. every table that rehearsal writes is emptied (WIPE, and in 0240's list);
 *   2. every knowledge-base table (kb_*) and every CCRS ledger table is KEPT,
 *      and never in 0240's list;
 *   3. the action checks the database's OWN per-table report after a reset
 *      (verifyResetSummary) instead of trusting "ok: true";
 *   4. the reset screen names CCRS files still waiting for an answer, because
 *      the reset keeps the CCRS ledger (those files are the State's, not ours).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildResetPlan } from "@/lib/accounting/factory-reset-core";
import { listSchemaTables } from "@/lib/admin/schema-tables";
import {
  CCRS_LEDGER_KEEP,
  REHEARSAL_ACTIVITY_TABLES,
  __runResetProofTests,
  summariseOpenCcrsFiles,
  verifyResetSummary,
  type OpenCcrsFileRow,
} from "@/lib/accounting/reset-proof-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const plan = buildResetPlan(listSchemaTables());
if (!plan.ok) throw new Error("reset plan must build for these tests");
const wipe = new Set(plan.wipe.map((c) => c.table));
const keep = new Set(plan.keep.map((c) => c.table));

/** The 0240 wipe array, parsed from the real migration. */
function wipe0240(): string[] {
  const sql = read("supabase/migrations/0240_factory_reset_scales.sql");
  const m = /wipe\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i.exec(sql);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}
const sqlList = new Set(wipe0240());

/** A summary exactly like the one the DB returns for the current plan. */
const fullSummary = (): Record<string, number> => Object.fromEntries([...wipe].map((t) => [t, 0]));

describe("1. everything the Clean Slate rehearsal writes is emptied", () => {
  it("the 0240 list was parsed (139 tables)", () => {
    expect(sqlList.size).toBe(139);
  });
  it("every rehearsal table is classified WIPE and is in the 0240 truncate list", () => {
    for (const t of REHEARSAL_ACTIVITY_TABLES) {
      expect(wipe.has(t), `${t} must be WIPE`).toBe(true);
      expect(sqlList.has(t), `${t} must be in 0240`).toBe(true);
    }
  });
  it("names the owner's specific worries: destructions, vendor returns, customer returns, manifests, CCRS batches", () => {
    for (const t of [
      "destruction_events",
      "vendor_returns",
      "customer_returns",
      "inbound_manifests",
      "inventory_lots",
      "inventory_adjustments",
      "orders",
      "order_lines",
      "ccrs_export_batches",
      "ccrs_adjustment_batches",
      "trade_sample_events",
    ]) {
      expect(REHEARSAL_ACTIVITY_TABLES).toContain(t);
    }
  });
  it("lists each table once and only tables that exist", () => {
    expect(new Set(REHEARSAL_ACTIVITY_TABLES).size).toBe(REHEARSAL_ACTIVITY_TABLES.length);
    const schema = new Set(listSchemaTables());
    for (const t of REHEARSAL_ACTIVITY_TABLES) expect(schema.has(t), t).toBe(true);
  });
});

describe("2. the knowledge base and the CCRS ledger survive", () => {
  const kb = listSchemaTables().filter((t) => t.startsWith("kb_"));
  it("there are 16 kb_ tables and every one is KEEP and absent from 0240", () => {
    expect(kb.length).toBe(16);
    for (const t of kb) {
      expect(keep.has(t), `${t} must be KEEP`).toBe(true);
      expect(sqlList.has(t), `${t} must not be truncated`).toBe(false);
    }
  });
  it("every CCRS ledger table is KEEP and absent from 0240", () => {
    expect([...CCRS_LEDGER_KEEP].sort()).toEqual(
      ["ccrs_file_contents", "ccrs_file_issues", "ccrs_file_rows", "ccrs_filed_entities", "ccrs_files", "ccrs_mail_messages", "ccrs_product_ids"],
    );
    for (const t of CCRS_LEDGER_KEEP) {
      expect(keep.has(t), t).toBe(true);
      expect(sqlList.has(t), t).toBe(false);
    }
  });
});

describe("3. verifyResetSummary: the database's own report is checked, not trusted", () => {
  it("the exact report for the current plan is clean", () => {
    expect(verifyResetSummary(fullSummary(), plan)).toEqual([]);
  });
  it("a rehearsal table missing from the report is named (it was not emptied)", () => {
    const s = fullSummary();
    delete s.destruction_events;
    const p = verifyResetSummary(s, plan);
    expect(p.map((x) => x.problem)).toContain("REHEARSAL_TABLE_NOT_EMPTIED");
    expect(p.find((x) => x.problem === "REHEARSAL_TABLE_NOT_EMPTIED")!.detail).toContain("destruction_events");
  });
  it("any other WIPE table missing is named too (the DB list drifted from the rules)", () => {
    const s = fullSummary();
    delete s.ai_usage;
    expect(verifyResetSummary(s, plan).map((x) => x.problem)).toEqual(["WIPE_TABLE_NOT_EMPTIED"]);
  });
  it("a kb_ table in the report is KNOWLEDGE_BASE_EMPTIED", () => {
    const s = { ...fullSummary(), kb_strains: 12 };
    const p = verifyResetSummary(s, plan);
    expect(p.map((x) => x.problem)).toEqual(["KNOWLEDGE_BASE_EMPTIED"]);
    expect(p[0].detail).toContain("kb_strains");
  });
  it("a CCRS ledger table in the report is CCRS_LEDGER_EMPTIED", () => {
    const p = verifyResetSummary({ ...fullSummary(), ccrs_filed_entities: 3 }, plan);
    expect(p.map((x) => x.problem)).toEqual(["CCRS_LEDGER_EMPTIED"]);
  });
  it("any other KEEP table in the report is KEEP_TABLE_EMPTIED; an unknown one is UNCLASSIFIED_TABLE_EMPTIED", () => {
    expect(verifyResetSummary({ ...fullSummary(), vendors: 1 }, plan).map((x) => x.problem)).toEqual(["KEEP_TABLE_EMPTIED"]);
    expect(verifyResetSummary({ ...fullSummary(), mystery_table: 1 }, plan).map((x) => x.problem)).toEqual(["UNCLASSIFIED_TABLE_EMPTIED"]);
  });
  it("an empty report (old engine, or nothing returned) is one REPORT_EMPTY problem, never silence", () => {
    expect(verifyResetSummary({}, plan).map((x) => x.problem)).toEqual(["REPORT_EMPTY"]);
  });
  it("a plan that refused cannot be verified against and says so", () => {
    const bad = buildResetPlan(["orders", "new_unknown_table"]);
    expect(verifyResetSummary(fullSummary(), bad).map((x) => x.problem)).toEqual(["PLAN_REFUSED"]);
  });
  it("problems come out in a fixed order (stable audit rows)", () => {
    const s: Record<string, number> = { ...fullSummary(), kb_terpenes: 1, vendors: 1 };
    delete s.orders;
    delete s.ai_usage;
    expect(verifyResetSummary(s, plan).map((x) => x.problem)).toEqual([
      "REHEARSAL_TABLE_NOT_EMPTIED",
      "WIPE_TABLE_NOT_EMPTIED",
      "KNOWLEDGE_BASE_EMPTIED",
      "KEEP_TABLE_EMPTIED",
    ]);
  });
});

describe("4. summariseOpenCcrsFiles: what the kept CCRS ledger still waits for", () => {
  const row = (env: "preprod" | "prod", state: string, name: string): OpenCcrsFileRow => ({ env, state, file_name: name, file_type: "Sale" });
  it("terminal (closed / abandoned) files are ignored; nothing open -> null", () => {
    expect(summariseOpenCcrsFiles([row("preprod", "closed", "a"), row("prod", "abandoned", "b")])).toBeNull();
    expect(summariseOpenCcrsFiles([])).toBeNull();
  });
  it("counts open files per env and lists them by name, sorted", () => {
    const s = summariseOpenCcrsFiles([
      row("preprod", "uploaded", "Sale_413541_2.csv"),
      row("preprod", "emitted", "Sale_413541_1.csv"),
      row("prod", "errored", "Inventory_413541_9.csv"),
      row("preprod", "closed", "old.csv"),
    ])!;
    expect(s.total).toBe(3);
    expect(s.byEnv).toEqual({ preprod: 2, prod: 1 });
    expect(s.files.map((f) => f.fileName)).toEqual(["Inventory_413541_9.csv", "Sale_413541_1.csv", "Sale_413541_2.csv"]);
    expect(s.message).toContain("3 CCRS file(s)");
    expect(s.message).toContain("PREprod 2");
    expect(s.message).toContain("production 1");
    expect(s.message).toMatch(/keeps the CCRS ledger/);
  });
  it("an unknown state is treated as OPEN (never assumed finished)", () => {
    expect(summariseOpenCcrsFiles([row("prod", "weird", "x.csv")])!.total).toBe(1);
  });
});

describe("guard: every table the rehearsal code WRITES is wiped, or deliberately kept", () => {
  // Code paths the Clean Slate rehearsal runs: register, orders, inventory,
  // receiving/intake, disposition (returns, destructions, vendor returns).
  const ROOTS = ["src/lib/pos", "src/lib/orders", "src/lib/inventory", "src/app/admin/inventory", "src/app/admin/orders", "src/app/pos", "src/app/api/pos"];
  // KEEP tables those paths legitimately write: configuration and the
  // knowledge base (facts learned while receiving are kept on purpose).
  // Exact: an entry no longer written fails too, so the list cannot rot.
  const KEEP_WRITES = [
    // R74 S41/S45: lookup_jobs + lookup_job_items are KEEP in factory-reset-core
    // (the batch product-lookup record; no money, stock or customer data) and
    // are written by the batch-lookups admin actions.
    // Register S3: pos_cart_adjustments (0301) is KEEP, written by sync-store.
    // Register S5: employee_product_loans (0302) is KEEP (wage-deduction record).
    "audit_logs", "brands", "disposition_settings", "employee_product_loans", "intake_merge_decisions", "inventory_expiry_rules", "inventory_types",
    "kb_products", "kb_strains", "lookup_job_items", "lookup_jobs", "pos_cart_adjustments", "pos_devices", "product_classification_overrides", "sample_settings", "site_settings",
    "testing_labs", "vendor_aliases", "vendors", "website_category_types",
  ];
  function written(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
      if (!existsSync(join(ROOT, dir))) return;
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name)) {
          const src = read(rel);
          for (const m of src.matchAll(/\.from\(\s*"([a-z0-9_]+)"\s*\)/g)) {
            const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
            const stop = /;|\.from\(/.exec(tail);
            const seg = stop ? tail.slice(0, stop.index) : tail;
            if (/\.(insert|update|upsert|delete)\(/.test(seg) && !out.has(m[1])) out.set(m[1], rel);
          }
        }
      }
    };
    for (const r of ROOTS) walk(r);
    return out;
  }
  const w = written();
  it("the scan finds the rehearsal's own tables (it really reads the code)", () => {
    for (const t of ["orders", "order_lines", "customer_returns", "destruction_events", "vendor_returns", "inventory_lots", "inbound_manifests"]) {
      expect(w.has(t), t).toBe(true);
    }
  });
  it("every written table is WIPE, or KEEP and on the allowlist; nothing is unclassified", () => {
    const bad: string[] = [];
    for (const [t, file] of w) {
      if (wipe.has(t)) continue;
      if (keep.has(t) && KEEP_WRITES.includes(t)) continue;
      bad.push(`${t} (written in ${file}) is ${keep.has(t) ? "KEEP but not on the allowlist" : "not classified"}`);
    }
    expect(bad).toEqual([]);
  });
  it("the allowlist is exact: each entry is KEEP and still written", () => {
    for (const t of KEEP_WRITES) {
      expect(keep.has(t), `${t} must be KEEP`).toBe(true);
      expect(w.has(t), `${t} is no longer written; remove it from the allowlist`).toBe(true);
    }
  });
});

describe("wiring (source pins)", () => {
  const action = read("src/app/admin/settings/actions.ts");
  const page = read("src/app/admin/settings/reset/page.tsx");
  it("the reset action verifies the DB's own per-table report and folds problems into the audit + message", () => {
    expect(action).toContain("verifyResetSummary(summary.tables, buildResetPlan(listSchemaTables()))");
    const runAt = action.indexOf("await runFactoryReset(");
    const verAt = action.indexOf("verifyResetSummary(");
    const auditAt = action.indexOf("await recordAudit(", runAt);
    expect(runAt).toBeGreaterThan(0);
    expect(verAt).toBeGreaterThan(runAt);
    expect(auditAt).toBeGreaterThan(verAt);
    expect(action).toContain("problems = [...problems, ...summaryProblems];");
  });
  it("the reset page shows open CCRS files from the kept ledger", () => {
    expect(page).toContain("loadOpenCcrsFiles()");
    expect(page).toContain("openCcrs.message");
  });
  it("the reset SQL is not redefined by this round", () => {
    for (const f of ["0283_ccrs_sale_slice.sql", "0284_ccrs_settle_uncertain.sql", "0285_ccrs_inventory_transfer.sql", "0286_ccrs_inventory_last_told.sql"]) {
      expect(read(`supabase/migrations/${f}`)).not.toMatch(/function\s+public\.gl_factory_reset/i);
    }
  });
});

describe("embedded self-tests", () => {
  it("pass", () => {
    const r = __runResetProofTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(8);
  });
});
