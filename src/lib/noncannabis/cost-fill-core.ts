/**
 * S33-NC — fill a MISSING non-cannabis unit cost (pure core).
 *
 * OWNER DECISION D-R3-1 (docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md), verbatim:
 *   "owner and admin can add cost if missing. … It can only be used for non
 *    cannabis inventory. … So let's not build this for the cannabis inventory,
 *    but we should for non cannabis inventory."
 *
 * Why "missing" means 0: `noncannabis_products.cost_minor_units` is
 * `integer not null default 0` (0076:43) and the create action turns a blank
 * cost into 0 (`dollarsToMinor`, actions.ts). So 0 is the only value that can
 * mean "nobody keyed it". This core only FILLS a 0 — it never overwrites a cost
 * someone already keyed (that would silently rewrite margin history), and it
 * refuses to "fill" with 0 (that would record a fill that changed nothing).
 *
 * Parsing reuses the bulk-fill `parseCostInput` (bulk-fill-core.ts) so the
 * same "12.50" rules apply everywhere a cost is typed.
 */
import { parseCostInput } from "@/lib/inventory/bulk-fill-core";

export type CostFillProduct = {
  cost_minor_units: number | null | undefined;
  status: "draft" | "active" | "archived";
};

/** True when the product has no cost keyed yet (0 / absent) and is not archived. */
export function isCostMissing(p: CostFillProduct): boolean {
  if (p.status === "archived") return false;
  const c = p.cost_minor_units;
  return c == null || c === 0;
}

export type CostFillRefusal =
  | "archived"
  | "already-has-cost"
  | "invalid-cost"
  | "zero-cost";

export type CostFillPlan =
  | { ok: true; costMinorUnits: number }
  | { ok: false; reason: CostFillRefusal; message: string };

export const COST_FILL_COPY = {
  chip: "Cost missing",
  archived: "This item is archived — restore it before keying a cost.",
  alreadyHasCost:
    "This item already has a cost. Filling only works when the cost is $0.00, so a keyed cost is never overwritten.",
  zeroCost: "Enter a cost above $0.00 — $0.00 is what \u201cmissing\u201d already looks like.",
  roleNote: "Only the owner or an admin can key a missing cost.",
  filled: "Cost saved for",
  raced: "Someone else keyed this cost first — nothing was changed.",
} as const;

/** Decide whether a typed cost may fill this product. Pure; no I/O. */
export function planCostFill(product: CostFillProduct, raw: string | null): CostFillPlan {
  if (product.status === "archived") {
    return { ok: false, reason: "archived", message: COST_FILL_COPY.archived };
  }
  if (!isCostMissing(product)) {
    return { ok: false, reason: "already-has-cost", message: COST_FILL_COPY.alreadyHasCost };
  }
  const parsed = parseCostInput(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid-cost", message: parsed.error };
  const value = parsed.value as number;
  if (value <= 0) return { ok: false, reason: "zero-cost", message: COST_FILL_COPY.zeroCost };
  return { ok: true, costMinorUnits: value };
}

/** Count products whose cost is missing (for the KPI / filter). */
export function countCostMissing(products: readonly CostFillProduct[]): number {
  let n = 0;
  for (const p of products) if (isCostMissing(p)) n += 1;
  return n;
}

export function __runCostFillCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("cost-fill-core FAIL:", msg);
    }
  };
  const active0: CostFillProduct = { cost_minor_units: 0, status: "active" };
  const draft0: CostFillProduct = { cost_minor_units: 0, status: "draft" };
  const arch0: CostFillProduct = { cost_minor_units: 0, status: "archived" };
  const priced: CostFillProduct = { cost_minor_units: 1, status: "active" };

  check(isCostMissing(active0), "active $0 is missing");
  check(isCostMissing(draft0), "draft $0 is missing");
  check(isCostMissing({ cost_minor_units: null, status: "active" }), "null is missing");
  check(isCostMissing({ cost_minor_units: undefined, status: "active" }), "undefined is missing");
  check(!isCostMissing(arch0), "archived is never missing");
  check(!isCostMissing(priced), "1 cent is not missing");

  const ok = planCostFill(active0, "12.50");
  check(ok.ok && ok.costMinorUnits === 1250, "12.50 → 1250");
  const ok2 = planCostFill(draft0, "$1,000");
  check(ok2.ok && ok2.costMinorUnits === 100000, "$1,000 → 100000 on a draft");
  const one = planCostFill(active0, "0.01");
  check(one.ok && one.costMinorUnits === 1, "0.01 → 1 (smallest fill)");

  const a = planCostFill(arch0, "5");
  check(!a.ok && a.reason === "archived", "archived refused");
  check(!a.ok && a.message === COST_FILL_COPY.archived, "archived copy");
  const h = planCostFill(priced, "5");
  check(!h.ok && h.reason === "already-has-cost", "keyed cost never overwritten");
  check(!h.ok && h.message === COST_FILL_COPY.alreadyHasCost, "already-has-cost copy");
  const z = planCostFill(active0, "0.00");
  check(!z.ok && z.reason === "zero-cost", "0.00 refused as a fill");
  check(!z.ok && z.message === COST_FILL_COPY.zeroCost, "zero copy");
  const z2 = planCostFill(active0, "0");
  check(!z2.ok && z2.reason === "zero-cost", "0 refused as a fill");
  const bad = planCostFill(active0, "-3");
  check(!bad.ok && bad.reason === "invalid-cost", "negative refused by parseCostInput");
  const blank = planCostFill(active0, "");
  check(!blank.ok && blank.reason === "invalid-cost" && blank.message === "Enter a unit cost.", "blank refused");
  const nul = planCostFill(active0, null);
  check(!nul.ok && nul.reason === "invalid-cost", "null refused");
  const big = planCostFill(active0, "21474836.48");
  check(!big.ok && big.reason === "invalid-cost", "over int max refused");
  const max = planCostFill(active0, "21474836.47");
  check(max.ok && max.costMinorUnits === 2147483647, "int max accepted");

  check(countCostMissing([active0, draft0, arch0, priced]) === 2, "count skips archived and priced");
  check(countCostMissing([]) === 0, "empty count");
  check(COST_FILL_COPY.chip === "Cost missing", "chip label");

  return { passed, failed };
}
