/**
 * S33-NC — key a MISSING non-cannabis unit cost (owner decision D-R3-1).
 *
 * Owner (Round 6, verbatim): "owner and admin can add cost if missing. … It can
 * only be used for non cannabis inventory. … So let's not build this for the
 * cannabis inventory, but we should for non cannabis inventory."
 *
 * Pinned here:
 *   - the pure rules (fill only a 0, refuse a 0 fill, archived refused, parse
 *     through the shared bulk-fill parser);
 *   - the permission is owner + admin only (manager excluded);
 *   - the store write is race-guarded on cost = 0 and not archived;
 *   - the action is gated, audits before/after, and redirects to a banner the
 *     page renders;
 *   - the UI shows the chip, the filter and the cost box only while cost is 0,
 *     and only offers the box to roles that hold the permission;
 *   - the settings (ops) action still cannot touch cost;
 *   - no cannabis surface gained cost entry.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COST_FILL_COPY,
  __runCostFillCoreTests,
  countCostMissing,
  isCostMissing,
  planCostFill,
} from "@/lib/noncannabis/cost-fill-core";
import { ALL_PERMISSIONS, ALL_ROLES, PERMISSION_LABELS, can, rolesForPermission } from "@/lib/auth/roles";

const read = (p: string) => readFileSync(p, "utf8");
const ACTIONS = "src/app/admin/inventory/noncannabis/actions.ts";
const STORE = "src/lib/noncannabis/store.ts";
const PAGE = "src/app/admin/inventory/noncannabis/page.tsx";
const CATALOG = "src/app/admin/inventory/noncannabis/MerchCatalog.tsx";

function fnBody(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("cost-fill-core", () => {
  it("self-tests pass (exact count pinned)", () => {
    const r = __runCostFillCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(24);
  });

  it("fills only a missing cost and never overwrites a keyed one", () => {
    expect(planCostFill({ cost_minor_units: 0, status: "active" }, "4.99")).toEqual({
      ok: true,
      costMinorUnits: 499,
    });
    expect(planCostFill({ cost_minor_units: 250, status: "active" }, "4.99")).toMatchObject({
      ok: false,
      reason: "already-has-cost",
    });
    expect(planCostFill({ cost_minor_units: 0, status: "archived" }, "4.99")).toMatchObject({
      ok: false,
      reason: "archived",
    });
    expect(planCostFill({ cost_minor_units: 0, status: "active" }, "0.00")).toMatchObject({
      ok: false,
      reason: "zero-cost",
    });
    expect(planCostFill({ cost_minor_units: 0, status: "active" }, "abc")).toMatchObject({
      ok: false,
      reason: "invalid-cost",
      message: "Enter a dollar amount like 12.50 (no negative costs).",
    });
  });

  it("missing = 0 or absent, never archived", () => {
    expect(isCostMissing({ cost_minor_units: 0, status: "draft" })).toBe(true);
    expect(isCostMissing({ cost_minor_units: 0, status: "archived" })).toBe(false);
    expect(isCostMissing({ cost_minor_units: 7, status: "active" })).toBe(false);
    expect(
      countCostMissing([
        { cost_minor_units: 0, status: "active" },
        { cost_minor_units: 3, status: "active" },
        { cost_minor_units: 0, status: "archived" },
      ]),
    ).toBe(1);
  });

  it("reuses the shared bulk-fill cost parser rather than a new one", () => {
    const src = read("src/lib/noncannabis/cost-fill-core.ts");
    expect(src).toContain('import { parseCostInput } from "@/lib/inventory/bulk-fill-core";');
    expect(src).toContain("const parsed = parseCostInput(raw);");
  });
});

describe("permission: owner and admin only (D-R3-1)", () => {
  it("inventory.cost.fill is exactly owner + admin", () => {
    expect(rolesForPermission("inventory.cost.fill")).toEqual(["owner", "admin"]);
    expect(can("owner", "inventory.cost.fill")).toBe(true);
    expect(can("admin", "inventory.cost.fill")).toBe(true);
    expect(can("manager", "inventory.cost.fill")).toBe(false);
    expect(ALL_ROLES.filter((r) => can(r, "inventory.cost.fill"))).toEqual(["owner", "admin"]);
    expect(can(null, "inventory.cost.fill")).toBe(false);
  });

  it("is listed and labelled once", () => {
    expect(ALL_PERMISSIONS.filter((p) => p === "inventory.cost.fill")).toHaveLength(1);
    expect(PERMISSION_LABELS["inventory.cost.fill"]).toBe(
      "Key a missing non-cannabis unit cost (owner & admin)",
    );
  });
});

describe("store: race-guarded fill", () => {
  it("only writes while the row still reads cost 0 and not archived", () => {
    const body = fnBody(read(STORE), "export async function fillNonCannabisCost(");
    expect(body).toContain('.update({ cost_minor_units: costMinorUnits, updated_by: actorId })');
    expect(body).toContain('.eq("id", id)');
    expect(body).toContain('.eq("cost_minor_units", 0)');
    expect(body).toContain('.neq("status", "archived")');
    expect(body).toContain("filled: Array.isArray(data) && data.length === 1");
    expect(body).toContain("if (!Number.isSafeInteger(costMinorUnits) || costMinorUnits <= 0)");
  });
});

describe("action: gated, planned, audited", () => {
  const body = fnBody(read(ACTIONS), "export async function fillNonCannabisCostAction(");

  it("is gated by inventory.cost.fill (not inventory.manage)", () => {
    expect(body).toContain('await requirePermission("inventory.cost.fill")');
    expect(body).not.toContain('requirePermission("inventory.manage")');
  });

  it("plans from the fresh DB row, writes, reports a lost race, then audits", () => {
    expect(body).toContain('const plan = planCostFill(product, String(formData.get("cost") ?? ""));');
    expect(body).toContain("fillNonCannabisCost(productId, plan.costMinorUnits, session.userId)");
    expect(body).toContain("if (!res.filled) {");
    expect(body).toContain("COST_FILL_COPY.raced");
    expect(body).toContain('action: "noncannabis.cost_fill"');
    expect(body).toContain("before: { cost_minor_units: product.cost_minor_units }");
    expect(body).toContain("after: { cost_minor_units: plan.costMinorUnits }");
    expect(body.indexOf("if (!res.filled)")).toBeLessThan(body.indexOf("recordAudit("));
    expect(body).toContain("?costFilled=${encodeURIComponent(product.sku)}");
  });

  it("the settings (ops) action still cannot touch cost", () => {
    const ops = fnBody(read(ACTIONS), "export async function updateNonCannabisOpsAction");
    expect(ops).not.toMatch(/cost_minor_units/);
  });
});

describe("page + catalog wiring", () => {
  const page = read(PAGE);
  const cat = read(CATALOG);

  it("the page computes the permission and passes it down", () => {
    expect(page).toContain('const canFillCost = can(session.profile.role, "inventory.cost.fill");');
    expect(page).toContain("canFillCost={canFillCost}");
    const rowsBlock = page.slice(
      page.indexOf("const catalogRows: CatalogRow[] = active.map((p) => ({"),
      page.indexOf("const recentAdjustments"),
    );
    expect(rowsBlock).toContain("costMinorUnits: p.cost_minor_units ?? 0,");
    expect(page).toContain('initialCostMissingOnly={sp.costMissing === "1"}');
  });

  it("the page declares and renders the costFilled banner and the cost-missing banner", () => {
    expect(page).toContain("costFilled?: string;");
    expect(page).toContain("costMissing?: string;");
    expect(page).toContain("{sp.costFilled ? (");
    expect(page).toContain('id="cost-missing"');
    expect(page).toContain('id="catalog"');
    expect(page).toContain('href="/admin/inventory/noncannabis?costMissing=1#catalog"');
  });

  it("draft rows get the chip and the cost box when cost is 0", () => {
    const drafts = page.slice(page.indexOf("{drafts.map((p) => ("));
    expect(drafts).toContain("{isCostMissing(p) ? (");
    expect(drafts).toContain("<CostFillForm productId={p.id} />");
  });

  it("the catalog shows the chip, a filter, and the box only while cost is 0 and only with the permission", () => {
    expect(cat).toContain("<form action={fillNonCannabisCostAction}");
    expect(cat).toContain('name="cost"');
    expect(cat).toContain("{costMissing ? (");
    expect(cat).toContain('<Badge tone="orange">{COST_FILL_COPY.chip}</Badge>');
    expect(cat).toContain("{canFillCost ? (\n                    <CostFillForm productId={row.id} />");
    expect(cat).toContain("if (costMissingOnly && !rowCostMissing(r)) return false;");
    expect(cat).toContain("}, [rows, q, typeFilter, costMissingOnly]);");
    expect(cat).toContain("return isCostMissing({ cost_minor_units: row.costMinorUnits, status: row.status });");
  });
});

describe("scope: cannabis cost entry is NOT built", () => {
  it("only the non-cannabis actions import the fill", () => {
    const intake = read("src/app/admin/inventory/intake/actions.ts");
    expect(intake).not.toContain("fillNonCannabisCost");
    expect(intake).not.toContain("inventory.cost.fill");
  });

  it("copy is plain", () => {
    expect(COST_FILL_COPY.chip).toBe("Cost missing");
    expect(COST_FILL_COPY.roleNote).toBe("Only the owner or an admin can key a missing cost.");
  });
});
