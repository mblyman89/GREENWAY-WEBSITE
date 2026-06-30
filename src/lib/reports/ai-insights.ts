/**
 * src/lib/reports/ai-insights.ts
 *
 * AI report narrator (PR E). Turns the structured analytics reports
 * (orders, loyalty, inventory health, promotions) into a short, plain-language
 * briefing for a non-technical owner: what's going well, what needs attention,
 * and 2-3 concrete next actions.
 *
 * It is read-only and advisory. We feed the model only AGGREGATE numbers (no
 * customer PII) and ask for grounded observations — no invented figures.
 *
 * Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import type {
  OrdersReport,
  LoyaltyReport,
  InventoryHealthReport,
  PromotionsReport,
} from "@/lib/reports/analytics";
import type { SalesReport } from "@/lib/reports/sales";
import type { CogsReport } from "@/lib/reports/cogs";
import type { WaTaxReport } from "@/lib/reports/wa-tax";
import type { CustomersReport } from "@/lib/reports/customers";
import type { EmployeeReport, MedicalReport } from "@/lib/reports/operations";

export { isAiConfigured };

const SYSTEM = [
  "You are a sharp, friendly retail analyst for a licensed Washington State cannabis dispensary (Greenway Marijuana).",
  "You are given AGGREGATE store metrics for a date range, covering sales, profitability (COGS/margin), tax, customers, loyalty, inventory, promotions, staffing, and the medical program.",
  "Write a brief, plain-language briefing for a non-technical owner that draws connections ACROSS these areas (e.g. how margin relates to category mix, how customer mix relates to revenue).",
  "Be specific and reference the actual numbers you were given — never invent figures. If a metric looks concerning (cancellations, out-of-stock, thin margins, missing COGS, missing data, expiring medical cards), call it out plainly. If things look healthy, say so without exaggeration.",
  "Do not make medical claims, do not give legal advice, and do not mention individual customers by name.",
].join("\n");

export type ReportInsights = {
  /** 1-2 sentence headline summary. */
  headline: string;
  /** What's going well (bullets). */
  wins: string[];
  /** What needs attention (bullets). */
  watchouts: string[];
  /** 2-3 concrete recommended next actions. */
  actions: string[];
  model: string;
};

type RawInsights = {
  headline?: unknown;
  wins?: unknown;
  watchouts?: unknown;
  actions?: unknown;
};

function strArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

/**
 * The full report suite the narrator can digest. Every field is optional so
 * callers can pass whichever reports they have; the digest only mentions the
 * ones present. `label` is the human range label (e.g. "Q2 2024" or
 * "2024-01-01 → 2024-03-31"); `days` is the span in days.
 */
export type InsightsInput = {
  days: number;
  label?: string;
  orders?: OrdersReport;
  loyalty?: LoyaltyReport;
  inventory?: InventoryHealthReport;
  promotions?: PromotionsReport;
  sales?: SalesReport;
  cogs?: CogsReport;
  tax?: WaTaxReport;
  customers?: CustomersReport;
  employees?: EmployeeReport;
  medical?: MedicalReport;
};

/**
 * Build a compact, PII-free metrics digest for the model. Only sections with
 * data are included so the briefing stays grounded and uncluttered.
 */
function buildDigest(input: InsightsInput): string {
  const { days, label, orders, loyalty, inventory, promotions, sales, cogs, tax, customers, employees, medical } =
    input;
  const lines: string[] = [];
  lines.push(`Date range: ${label ?? `last ${days} days`} (${days} days).`);

  if (orders) {
    lines.push(
      `Orders: ${orders.totalOrders} total, ${orders.completedOrders} completed, ${orders.cancelledOrders} cancelled, ${orders.noShowOrders} no-show.`,
    );
    lines.push(
      `Revenue (non-cancelled): ${money(orders.grossMinorUnits)}; average order ${money(orders.avgOrderMinorUnits)}; avg items/order ${orders.avgItemsPerOrder.toFixed(1)}.`,
    );
    if (orders.topProducts.length) {
      lines.push(
        `Top products: ${orders.topProducts.slice(0, 5).map((p) => `${p.label} (${p.value})`).join(", ")}.`,
      );
    }
    if (orders.topBrands.length) {
      lines.push(
        `Top brands: ${orders.topBrands.slice(0, 5).map((b) => `${b.label} (${b.value})`).join(", ")}.`,
      );
    }
  }

  if (sales) {
    if (sales.hasData) {
      lines.push(
        `Sales detail: ${money(sales.totalRevenueMinorUnits)} revenue across ${sales.totalUnits} units / ${sales.totalOrders} orders; avg order ${money(sales.avgOrderMinorUnits)}; total discounts ${money(sales.totalDiscountMinorUnits)}.`,
      );
      if (sales.byCategory.length) {
        lines.push(
          `Revenue by category: ${sales.byCategory
            .slice(0, 6)
            .map((c) => `${c.label} ${money(c.revenueMinorUnits)}`)
            .join(", ")}.`,
        );
      }
      if (sales.byType?.length) {
        lines.push(
          `Revenue by detailed type: ${sales.byType
            .slice(0, 8)
            .map((t) => `${t.label} ${money(t.revenueMinorUnits)}`)
            .join(", ")}.`,
        );
      }
      if (sales.byCustomerType?.length) {
        lines.push(
          `Revenue by customer type: ${sales.byCustomerType
            .map((c) => `${c.label} ${money(c.revenueMinorUnits)}`)
            .join(", ")}.`,
        );
      }
    } else {
      lines.push("Sales detail: no sales in range.");
    }
  }

  if (cogs) {
    if (cogs.hasData) {
      lines.push(
        `Profitability (COGS): revenue ${money(cogs.totalRevenueMinorUnits)}, COGS ${money(cogs.totalCogsMinorUnits)}, gross profit ${money(cogs.totalGrossProfitMinorUnits)}, overall margin ${pct(cogs.overallMargin)} on ${cogs.unitsSold} units.`,
      );
      lines.push(
        `Inventory valuation (current): ${money(cogs.inventoryCostValueMinorUnits)} at cost across ${cogs.inventoryOnHandUnits} units / ${cogs.inventoryLots} lots.`,
      );
      if (cogs.missingCostUnits > 0) {
        lines.push(
          `COGS data gap: ${cogs.missingCostUnits} sold units (${money(cogs.missingCostRevenueMinorUnits)} revenue) had NO unit cost, so margin is understated.`,
        );
      }
      if (cogs.aging.length) {
        lines.push(
          `Inventory aging buckets: ${cogs.aging.map((a) => `${a.label} ${money(a.costValueMinorUnits)}`).join(", ")}.`,
        );
      }
    } else {
      lines.push("Profitability (COGS): no costed sales in range.");
    }
  }

  if (tax) {
    if (tax.hasData) {
      lines.push(
        `Tax: taxable base ${money(tax.totalBaseMinor)} (cannabis ${money(tax.cannabisBaseMinor)}, non-cannabis ${money(tax.nonCannabisBaseMinor)}); sales tax ${money(tax.salesTaxMinor)}; cannabis excise ${money(tax.exciseTaxMinor)}; total tax ${money(tax.totalTaxMinor)} over ${tax.orders} orders.`,
      );
    } else {
      lines.push("Tax: no taxable sales in range.");
    }
  }

  if (customers) {
    if (customers.hasData) {
      lines.push(
        `Customers: ${customers.identifiedCustomers} identified (${customers.newCustomers} new, ${customers.returningCustomers} returning), ${customers.guestOrders} guest orders; repeat rate ${pct(customers.repeatRate)}; avg basket ${customers.avgBasketSize.toFixed(1)} units / ${money(customers.avgOrderMinorUnits)}.`,
      );
      if (customers.segments.length) {
        lines.push(
          `Customer segments: ${customers.segments.map((s) => `${s.label} (${s.customers})`).join(", ")}.`,
        );
      }
    } else {
      lines.push("Customers: no identifiable customer orders in range.");
    }
  }

  if (loyalty) {
    lines.push(
      `Loyalty signups: ${loyalty.total} (${loyalty.newCount} new, ${loyalty.enteredCount} entered, ${loyalty.duplicateCount} duplicate, ${loyalty.dedupeFlagged} flagged as possible duplicates).`,
    );
  }

  if (employees) {
    lines.push(
      `Staffing: ${employees.totalShifts} shifts, ${hours(employees.totalMinutes)} worked across ${employees.rows.length} employees.`,
    );
  }

  if (medical) {
    lines.push(
      `Medical program: ${medical.patients} patients, ${medical.activeCards} active authorizations, ${medical.expiringSoon} expiring within 30 days; ${medical.exemptSales} exempt sales; tax exempted ${money(medical.salesTaxExemptedMinor)} sales tax + ${money(medical.exciseExemptedMinor)} excise.`,
    );
  }

  if (inventory) {
    if (inventory.hasPublishedMenu) {
      lines.push(
        `Inventory health: ${inventory.totalItems} items / ${inventory.totalVariants} variants; ${inventory.outOfStock} out of stock; ${inventory.lowStock} low stock; ${inventory.zeroPrice} priced at $0; ${inventory.missingDescription} missing descriptions; ${inventory.missingBrand} missing brand; ${inventory.hiddenItems} hidden; ${inventory.suspiciousPotency} suspicious potency.`,
      );
    } else {
      lines.push("Inventory health: no published menu yet.");
    }
  }

  if (promotions) {
    lines.push(
      `Promotions: ${promotions.total} total (${promotions.published} live, ${promotions.draft} draft, ${promotions.scheduled} scheduled, ${promotions.archived} archived).`,
    );
  }

  return lines.join("\n");
}

/**
 * Generate an AI insights briefing from the structured reports. Throws
 * AiNotConfiguredError when no key is set.
 */
export async function generateReportInsights(
  input: InsightsInput,
  context?: Omit<AiContext, "feature">,
): Promise<ReportInsights> {
  const user = [
    buildDigest(input),
    "",
    'Return ONLY a JSON object: {"headline": string, "wins": string[], "watchouts": string[], "actions": string[]}.',
    "headline: one or two sentences. wins/watchouts: up to 4 short bullets each (omit if none). actions: 2-3 concrete, doable next steps. No prose outside the JSON.",
  ].join("\n");

  const raw = await generateJSON<RawInsights>({
    system: SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 600,
    context: {
      feature: "reports.insights",
      entityType: "report",
      ...context,
    },
  });

  return {
    headline: typeof raw?.headline === "string" ? raw.headline.trim() : "",
    wins: strArray(raw?.wins, 4),
    watchouts: strArray(raw?.watchouts, 4),
    actions: strArray(raw?.actions, 3),
    model: aiModelId,
  };
}
