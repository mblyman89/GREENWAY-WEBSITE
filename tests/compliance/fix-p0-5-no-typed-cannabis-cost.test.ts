/**
 * Phase 0.5 (G-27, F-05a-11) - no typed cannabis unit cost.
 *
 * Owner decision D38 (Q-05a-3), verbatim: "absolutely not. That's illegal.
 * Cost comes from the state CCRS manifest created by the vendor."
 *
 * Requirement 1: Bulk fill no longer offers or writes unit_cost_minor_units.
 * Requirement 2: a compliance guard - no code path writes an inventory lot's
 *   unit cost except the manifest / import intake paths (allow-list below).
 * Requirement 3: a lot with no cost says "Cost missing - correct from the
 *   manifest" on Issues instead of inviting a typed value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  BULK_FILLABLE_FIELDS,
  BULK_FORBIDDEN_FIELDS,
  CANNABIS_COST_FROM_MANIFEST,
  planBulkFill,
} from "@/lib/inventory/bulk-fill-core";
import { buildInventoryIssues, GAP_BULK_FILL_FIELD, gapBulkFillHref } from "@/lib/admin/issues-core";
import { migrationLotCallout } from "@/lib/inventory/migration-lot-fix-core";
import { MIGRATION_MARKER } from "@/lib/inventory/bulk-fill-core";
import { UNKNOWN_COST_BULK_HREF } from "@/lib/pos/pos-import-fix-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Text of the balanced (...) argument starting at `open` (index of "("). */
function balancedArg(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/**
 * Every place that writes inventory_lots with a payload that carries a unit
 * cost. When the payload is a variable, its declaration (and any later
 * `<var>.unit_cost...` assignment) is inspected.
 */
function inventoryLotCostWriters(): { file: string; line: number }[] {
  const hits: { file: string; line: number }[] = [];
  for (const abs of walk(join(root, "src"))) {
    const src = readFileSync(abs, "utf8");
    const re = /\.from\(\s*["']inventory_lots["']\s*\)\s*\.(update|insert|upsert)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const arg = balancedArg(src, m.index + m[0].length - 1).trim();
      let carriesCost = /unit_cost_minor_units|unit_cost_source/.test(arg);
      const ident = /^([A-Za-z_$][\w$]*)(\s+as\s+[\w<>[\]]+)?$/.exec(arg);
      if (!carriesCost && ident) {
        const v = ident[1];
        const before = src.slice(0, m.index);
        const decl = before.lastIndexOf(`${v} =`) >= 0 ? before.lastIndexOf(`${v} =`) : before.lastIndexOf(`${v}:`);
        if (decl >= 0) {
          const body = before.slice(decl);
          carriesCost =
            new RegExp(`${v}\\.unit_cost_minor_units\\s*=`).test(body) ||
            /\bunit_cost_minor_units\s*:/.test(body.slice(0, 4000));
        }
      }
      if (carriesCost) hits.push({ file: relative(root, abs), line: src.slice(0, m.index).split("\n").length });
    }
  }
  return hits;
}

// The ONLY places allowed to write a lot's unit cost. Each reads it from a
// document, never from a person typing a number.
const ALLOWED_COST_WRITERS = new Set([
  "src/lib/inventory/intake-store.ts", // manifest intake: line price / qty from the CCRS manifest
  "src/lib/accounting/receipt-service.ts", // manifest receipt: stamps the cost the ledger capitalised from the manifest
  "src/lib/pos/import-service.ts", // one-time Cultivera POS import: cost read from the export file
  "src/lib/inventory/invoice-adjustments-store.ts", // Fix 3.4 re-read: price read from the vendor's emailed invoice PDF by lot id, NULL costs only (never typed)
]);

describe("G-27 req. 1: Bulk fill never offers or writes a unit cost", () => {
  it("unit cost is not a fillable field and is explicitly forbidden", () => {
    expect((BULK_FILLABLE_FIELDS as readonly string[]).includes("unit_cost_minor_units")).toBe(false);
    expect(BULK_FORBIDDEN_FIELDS).toContain("unit_cost_minor_units");
  });
  it("the planner refuses a cost fill with the D38 message", () => {
    const plan = planBulkFill({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      field: "unit_cost_minor_units" as any,
      rawValue: "8.25",
      lots: [{ id: "a", notes: MIGRATION_MARKER, status: "active", expires_on: null, unit_cost_minor_units: null, pos_product_key: null, product_name: "x" }],
      todayPacific: "2026-09-01",
    });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error).toBe(CANNABIS_COST_FROM_MANIFEST);
  });
  it("the server action refuses a hand-crafted cost post; the store writes no cost", () => {
    const action = read("src/app/admin/inventory/actions.ts");
    expect(action).toMatch(/\(field as string\) === "unit_cost_minor_units"/);
    expect(action).toMatch(/CANNABIS_COST_FROM_MANIFEST/);
    const store = read("src/lib/inventory/store.ts");
    const fn = store.slice(store.indexOf("export async function applyBulkFill"), store.indexOf("export async function listLotsMissingReceivedDate"));
    expect(fn).not.toMatch(/patch\.unit_cost_minor_units/);
    expect(fn).not.toMatch(/unit_cost_source/);
  });
  it("the panel has no unit-cost hint", () => {
    expect(read("src/components/admin/inventory/BulkFillPanel.tsx")).not.toMatch(/unit_cost_minor_units/);
  });
});

describe("G-27 req. 2: compliance guard - only manifest/import paths write a lot's cost", () => {
  it("every inventory_lots write carrying unit cost is on the allow-list", () => {
    const writers = inventoryLotCostWriters();
    const offenders = writers.filter((w) => !ALLOWED_COST_WRITERS.has(w.file));
    expect(offenders).toEqual([]);
    // and the scanner does see the real intake paths (so it is not vacuous)
    expect(writers.some((w) => w.file === "src/lib/inventory/intake-store.ts")).toBe(true);
    expect(writers.some((w) => w.file === "src/lib/accounting/receipt-service.ts")).toBe(true);
  });
  it("no server action file (app/**/actions.ts) writes a lot's cost", () => {
    const writers = inventoryLotCostWriters();
    expect(writers.filter((w) => w.file.startsWith("src/app/"))).toEqual([]);
  });
});

describe("G-27 req. 3: cost missing - correct from the manifest", () => {
  it("the Issues row says so and offers no Bulk fill", () => {
    expect(GAP_BULK_FILL_FIELD.unknownCost).toBeUndefined();
    expect(gapBulkFillHref("unknownCost", "/admin/inventory?unknownCost=1")).toBeNull();
    const issues = buildInventoryIssues({
      receivedDateFlag: null,
      receivedMissingWithStock: 0,
      gaps: [{ key: "unknownCost", label: "no cost", count: 2, href: "/admin/inventory?status=active&unknownCost=1", weight: 2 }],
      blockedByCause: null,
      restorableCount: 0,
      intelExpiredRows: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const row = issues.find((i) => i.code === "gap_unknownCost");
    expect(row?.meaning).toMatch(/^Cost missing \u2014 correct from the manifest/);
    expect(row?.extra).toBeUndefined();
  });
  it("the lot-page callout names the missing cost with no fill link", () => {
    const c = migrationLotCallout({
      id: "l", notes: MIGRATION_MARKER, status: "active", lot_code: "WA1", pos_product_key: "k",
      expires_on: "2027-01-01", unit_cost_minor_units: null, lab_result_id: "lr", product_name: "x",
    })!;
    expect(c.costMissing).toBe(true);
    expect(c.links).toEqual([]);
    expect(read("src/app/admin/inventory/[id]/page.tsx")).toMatch(/migration-lot-cost-missing/);
  });
  it("the POS-import diagnostic no longer sends anyone to type a cost", () => {
    expect(UNKNOWN_COST_BULK_HREF).not.toMatch(/bulkField=unit_cost/);
    expect(read("src/lib/pos/pos-import-fix-core.ts")).not.toMatch(/Type the costs in Bulk fill/);
  });
});
