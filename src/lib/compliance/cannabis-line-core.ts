/**
 * Phase 0.4 (G-31, F-05b-9) - the cannabis line.
 *
 * Owner decision D48 (Q05b-4), verbatim: "refused outright, non cannabis should
 * also be refused outright moving them into a cannabis type."
 *
 * The non-cannabis set (merch, accessories, accessory, paraphernalia) drives
 * tax (no 37% excise), purchase limits (none), scan-required (off) and the
 * price floor (x1.093). A category change that crosses that line therefore
 * changes what the state is owed and what a customer may buy. So a crossing is
 * refused outright, in BOTH directions, for EVERYONE - there is no override.
 *
 * One pure check shared by the three entry points:
 *   - the lot-page classification override (inventory/actions.ts),
 *   - Move products (settings/types reassignCategoryAction),
 *   - the inventory-type mapping save (create / update / adopt).
 *
 * Every inventory_lots row is cannabis: it came from a CCRS manifest (the
 * Cultivera gate drops non-cannabis rows; non-cannabis goods live in
 * noncannabis_products). So a lot can never be filed under a non-cannabis
 * category, and a non-cannabis category / type can never become cannabis.
 *
 * Pure: no I/O.
 */
import { NON_CANNABIS_TAX_CATEGORIES } from "@/lib/orders/order-pricing-core";
import type { Issue } from "@/lib/admin/issues-core";
import { lotPageHref } from "@/lib/pos/issue-fix-link-core";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** True when the website category is on the non-cannabis side of the line. */
export function isNonCannabisSide(category: string | null | undefined): boolean {
  return NON_CANNABIS_TAX_CATEGORIES.has(norm(category));
}

/**
 * True when moving from `fromCategory` to `toCategory` crosses the cannabis
 * line in either direction. A blank side is "unknown" and never counts as a
 * crossing by itself (callers that know the product is cannabis use
 * `cannabisLotTargetRefusal`).
 */
export function crossesCannabisLine(
  fromCategory: string | null | undefined,
  toCategory: string | null | undefined,
): boolean {
  if (!norm(fromCategory) || !norm(toCategory)) return false;
  return isNonCannabisSide(fromCategory) !== isNonCannabisSide(toCategory);
}

export const CANNABIS_LINE_RULE =
  "Cannabis and non-cannabis never cross (owner rule D48: refused outright, both directions, no override). The non-cannabis categories (merch, accessories, paraphernalia) carry no cannabis excise, no purchase limit and no scan, so a cannabis product can never be filed there, and a non-cannabis item can never be made cannabis.";

export function crossingMessage(from: string, to: string): string {
  return `Refused: "${from}" to "${to}" crosses the cannabis line. ${CANNABIS_LINE_RULE}`;
}

/**
 * A cannabis lot (every inventory_lots row) may only be filed under a cannabis
 * category. Returns the refusal message, or null when the target is allowed.
 */
export function cannabisLotTargetRefusal(targetCategory: string | null | undefined): string | null {
  if (!norm(targetCategory)) return null;
  if (!isNonCannabisSide(targetCategory)) return null;
  return `Refused: this lot came from a CCRS manifest, so it is cannabis and cannot be filed under "${targetCategory}". ${CANNABIS_LINE_RULE}`;
}

/**
 * The inventory-type mapping (type -> website category). `currentMapping` is
 * the stored mapping (null for a new type); `cannabisLotCount` is how many
 * inventory lots carry the type (they are all cannabis).
 */
export function inventoryTypeMappingRefusal(input: {
  typeLabel: string;
  currentMapping: string | null | undefined;
  nextMapping: string | null | undefined;
  cannabisLotCount: number;
}): string | null {
  const next = norm(input.nextMapping);
  const cur = norm(input.currentMapping);
  if (!next) return null; // unmapping falls back to the name heuristic; not a crossing
  if (isNonCannabisSide(next)) {
    if (input.cannabisLotCount > 0 || (cur && !isNonCannabisSide(cur))) {
      return `Refused: the type "${input.typeLabel}" is cannabis (${
        input.cannabisLotCount > 0 ? `${input.cannabisLotCount} cannabis lot(s) carry it` : `it maps to "${input.currentMapping}"`
      }) and cannot be mapped to "${input.nextMapping}". ${CANNABIS_LINE_RULE}`;
    }
    return null;
  }
  if (cur && isNonCannabisSide(cur)) {
    return crossingMessage(String(input.currentMapping), String(input.nextMapping));
  }
  return null;
}

/** Lots (all cannabis) whose effective website category is non-cannabis. */
export function cannabisLotsOnNonCannabisSide<L extends { id: string; website_category_value?: string | null }>(
  lots: readonly L[],
): L[] {
  return lots.filter((l) => isNonCannabisSide(l.website_category_value ?? null));
}

export const CANNABIS_LINE_ISSUE_CODE = "cannabis_on_non_cannabis_category";

/**
 * G-31 requirement 4: the daily Issues list names every cannabis lot whose
 * effective website category is non-cannabis (data that pre-dates the guard,
 * or arrived through a path the guard does not see). Blocking: it changes the
 * tax and the purchase limit at the register. Null when there are none.
 */
export function buildCannabisLineIssue<L extends { id: string; product_name?: string | null; website_category_value?: string | null }>(
  lots: readonly L[],
): Issue | null {
  const crossed = cannabisLotsOnNonCannabisSide(lots);
  if (crossed.length === 0) return null;
  const first = crossed[0];
  const names = crossed
    .slice(0, 5)
    .map((l) => `${l.product_name || l.id} (${l.website_category_value})`)
    .join("; ");
  return {
    severity: "blocking",
    code: CANNABIS_LINE_ISSUE_CODE,
    title: `${crossed.length} cannabis lot${crossed.length === 1 ? "" : "s"} filed under a non-cannabis category`,
    meaning:
      "These lots came from a CCRS manifest, so they are cannabis, but their website category is merch / accessories / paraphernalia. That category skips the 37% excise and the purchase limit. " +
      CANNABIS_LINE_RULE,
    fix: { href: lotPageHref(first.id, "website-category"), label: "Fix the first lot's category" },
    fixText: "Open each lot and set its website category to the cannabis category it belongs in (or clear the override).",
    detail: names + (crossed.length > 5 ? ` and ${crossed.length - 5} more` : ""),
  };
}

export function __runCannabisLineCoreTests(): number {
  let n = 0;
  const t = (ok: boolean, label: string) => {
    if (!ok) throw new Error(`cannabis-line-core: ${label}`);
    n++;
  };
  t(isNonCannabisSide("merch") && isNonCannabisSide(" Accessories ") && isNonCannabisSide("paraphernalia"), "non-cannabis set");
  t(!isNonCannabisSide("flower") && !isNonCannabisSide(""), "cannabis / blank");
  t(crossesCannabisLine("flower", "paraphernalia"), "cannabis -> non crosses");
  t(crossesCannabisLine("merch", "edible-solid"), "non -> cannabis crosses");
  t(!crossesCannabisLine("flower", "preroll"), "cannabis -> cannabis ok");
  t(!crossesCannabisLine("merch", "accessories"), "non -> non ok");
  t(!crossesCannabisLine("", "merch"), "unknown side not a crossing");
  t(cannabisLotTargetRefusal("accessories") !== null, "lot to accessories refused");
  t(cannabisLotTargetRefusal("flower") === null, "lot to flower ok");
  t(cannabisLotTargetRefusal(null) === null, "keep/clear ok");
  t(inventoryTypeMappingRefusal({ typeLabel: "Flower", currentMapping: "flower", nextMapping: "paraphernalia", cannabisLotCount: 0 }) !== null, "type cannabis->non refused");
  t(inventoryTypeMappingRefusal({ typeLabel: "Pipe", currentMapping: null, nextMapping: "paraphernalia", cannabisLotCount: 3 }) !== null, "type with lots -> non refused");
  t(inventoryTypeMappingRefusal({ typeLabel: "Pipe", currentMapping: null, nextMapping: "paraphernalia", cannabisLotCount: 0 }) === null, "new non-cannabis type ok");
  t(inventoryTypeMappingRefusal({ typeLabel: "Pipe", currentMapping: "paraphernalia", nextMapping: "flower", cannabisLotCount: 0 }) !== null, "type non->cannabis refused");
  t(inventoryTypeMappingRefusal({ typeLabel: "Flower", currentMapping: "flower", nextMapping: "preroll", cannabisLotCount: 9 }) === null, "type cannabis->cannabis ok");
  t(buildCannabisLineIssue([{ id: "a", website_category_value: "flower" }]) === null, "no issue when clean");
  {
    const iss = buildCannabisLineIssue([{ id: "a", website_category_value: "flower" }, { id: "b", product_name: "OG", website_category_value: "merch" }]);
    t(!!iss && iss.severity === "blocking" && iss.code === CANNABIS_LINE_ISSUE_CODE && !!iss.fix && iss.fix.href.includes("b"), "issue names the crossed lot");
  }
  t(cannabisLotsOnNonCannabisSide([{ id: "a", website_category_value: "merch" }, { id: "b", website_category_value: "flower" }]).length === 1, "issues filter");
  return n;
}
