/**
 * PoMarketContextCard — grounded local-market context for a purchase order's
 * lines (Task I, I6). Server component, shared by the PO DETAIL page (every
 * line of the saved PO) and the BUILDER (candidate rows with market evidence).
 *
 * Owner's ask: "the purchase order detail page, where my purchase manager
 * actually builds the p.o.'s. I need this to be a super easy super clean super
 * helpful page for my manager to build the best p.o.'s possible that focus on
 * port orchard and local competitor insights from ai."
 *
 * Each line is crossed against the latest monthly CCRS drop by the PURE
 * po-market-context-core module: exact product-name match first, brand-level
 * fallback, never fuzzy. Port Orchard evidence (tracked-roster stores only) is
 * shown separately from statewide evidence.
 *
 * HONESTY: PO unit costs are WHOLESALE; the observed prices here are RETAIL at
 * other stores — different bases, labeled as such. The retail÷cost column is
 * plain arithmetic (only when both sides are known), never a margin claim.
 * Missing data renders as "—". Best-effort: any failure (tables not migrated,
 * no dataset, no service key) hides the card — the page never breaks on this.
 */
import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { getLatestTransformerDataset, listMarketSignals } from "@/lib/discovery/market-rollups";
import { listCompetitors, areaLabel } from "@/lib/discovery/competitors";
import {
  buildPoMarketContext,
  type PoLineLike,
  type PoLineMarketContext,
  type PoMarketContext,
} from "@/lib/purchasing/po-market-context-core";

function money(minor: number | null): string {
  return minor == null ? "—" : formatMinorCurrency(minor);
}

function units(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const MATCH_BADGE: Record<
  PoLineMarketContext["matchType"],
  { tone: "green" | "gold" | "neutral"; label: string }
> = {
  exact: { tone: "green", label: "exact match" },
  brand: { tone: "gold", label: "brand match" },
  none: { tone: "neutral", label: "no match" },
};

function ContextRow({ line, label }: { line: PoLineMarketContext; label: string }) {
  const badge = MATCH_BADGE[line.matchType];
  const matched = line.matchType !== "none";
  return (
    <tr className="border-t border-[var(--admin-border)] align-top">
      <td className="px-2 py-2">
        <div className="font-medium text-[var(--admin-text)]">{line.productName}</div>
        <div className="text-xs text-[var(--admin-text-faint)]">
          {[line.brand, line.category].filter(Boolean).join(" · ") || "—"}
        </div>
      </td>
      <td className="px-2 py-2">
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </td>
      <td className="px-2 py-2">
        {line.areaMatch ? (
          <div>
            <div className="text-xs font-semibold text-[var(--admin-accent)]">
              {label}: {line.areaStores.join(", ")}
            </div>
            {line.statewideMatch ? (
              <div className="text-[0.65rem] text-[var(--admin-text-faint)]">+ statewide mover</div>
            ) : null}
          </div>
        ) : line.statewideMatch ? (
          <span className="text-xs text-[var(--admin-text-muted)]">statewide only</span>
        ) : (
          <span className="text-xs text-[var(--admin-text-faint)]">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right text-[var(--admin-text-muted)]">
        {matched ? units(line.totalUnits) : "—"}
      </td>
      <td className="px-2 py-2 text-right text-[var(--admin-text-muted)]">
        {matched ? money(line.totalRevenueMinor) : "—"}
      </td>
      <td className="px-2 py-2 text-right text-[var(--admin-text-muted)]">
        {money(line.medianUnitPriceMinor)}
      </td>
      <td className="px-2 py-2 text-right font-medium text-[var(--admin-text)]">
        {money(line.p25UnitPriceMinor)}
      </td>
      <td className="px-2 py-2 text-right text-[var(--admin-text-muted)]">
        {line.retailCostMultiple != null ? `${line.retailCostMultiple}×` : "—"}
      </td>
    </tr>
  );
}

export async function PoMarketContextCard({
  lines,
  onlyMatched = false,
  maxRows = 25,
  showMix = false,
}: {
  /** PO lines (detail page) or candidate rows (builder) in PoLineLike shape. */
  lines: PoLineLike[];
  /** Builder mode: hide unmatched rows so only real market evidence shows. */
  onlyMatched?: boolean;
  /** Cap rendered rows (evidence-first ordering keeps the strongest visible). */
  maxRows?: number;
  /** Detail page: also show the order's category mix by spend. */
  showMix?: boolean;
}) {
  if (lines.length === 0) return null;

  // Best-effort: any failure hides the card — the page never breaks on this.
  let dataset: Awaited<ReturnType<typeof getLatestTransformerDataset>> = null;
  try {
    dataset = await getLatestTransformerDataset();
  } catch {
    return null;
  }
  if (!dataset) return null;

  let context: PoMarketContext | null = null;
  try {
    const [signals, roster] = await Promise.all([
      listMarketSignals(dataset.id),
      listCompetitors(),
    ]);
    context = buildPoMarketContext(lines, signals, roster, { area: "port_orchard" });
  } catch {
    return null;
  }
  if (!context || context.lines.length === 0) return null;
  if (onlyMatched && context.matchedCount === 0) return null;

  const label = areaLabel(context.area);
  const period =
    dataset.period_start && dataset.period_end
      ? `${dataset.period_start} → ${dataset.period_end}`
      : null;

  // Evidence-first ordering: Port Orchard evidence, then exact matches, then
  // brand matches, then unmatched — strongest signals stay above the cap.
  const rank = (l: PoLineMarketContext) =>
    (l.areaMatch ? 0 : 4) + (l.matchType === "exact" ? 0 : l.matchType === "brand" ? 1 : 2);
  const visible = (onlyMatched ? context.lines.filter((l) => l.matchType !== "none") : context.lines)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.totalRevenueMinor - a.totalRevenueMinor)
    .slice(0, maxRows);
  const hiddenCount =
    (onlyMatched ? context.matchedCount : context.lines.length) - visible.length;

  const areaCount = context.lines.filter((l) => l.areaMatch).length;

  return (
    <Card padding="md">
      <CardHeader
        title={`${label} market check`}
        subtitle={`Each line vs the latest monthly CCRS drop${period ? ` (sales observed ${period})` : ""}: is it a proven mover — at a tracked ${label} competitor or statewide — and what retail price does it move at. Matching is conservative (exact name, then brand — never fuzzy).`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]">
        <Badge tone={areaCount > 0 ? "green" : "neutral"}>
          {areaCount} of {context.lines.length} line{context.lines.length === 1 ? "" : "s"} with {label} evidence
        </Badge>
        <Badge tone="neutral">
          {context.exactCount} exact · {context.matchedCount - context.exactCount} brand-level
        </Badge>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <th className="px-2 py-1">Line</th>
              <th className="px-2 py-1">Market match</th>
              <th className="px-2 py-1">{label} evidence</th>
              <th className="px-2 py-1 text-right">Units</th>
              <th className="px-2 py-1 text-right">Revenue</th>
              <th className="px-2 py-1 text-right">Retail median</th>
              <th className="px-2 py-1 text-right">Price to beat (p25)</th>
              <th className="px-2 py-1 text-right">Retail ÷ cost</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l, i) => (
              <ContextRow key={`${l.productName}-${i}`} line={l} label={label} />
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
          + {hiddenCount} more line{hiddenCount === 1 ? "" : "s"} not shown (evidence-first ordering
          keeps the strongest matches visible).
        </p>
      ) : null}

      {showMix && context.mix.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Order mix by spend
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {context.mix.map((m) => (
              <span
                key={m.category}
                className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2.5 py-1 text-xs text-[var(--admin-text-muted)]"
              >
                <span className="font-semibold text-[var(--admin-text)]">{m.category}</span>{" "}
                · {m.lineCount} line{m.lineCount === 1 ? "" : "s"} · {money(m.spendMinor)} (
                {Math.round(m.spendShare * 100)}%)
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[0.65rem] text-[var(--admin-text-faint)]">
        Units/revenue are what MATCHED movers did at other stores in this drop — observed RETAIL
        sale prices. Your unit costs are WHOLESALE: different bases. “Retail ÷ cost” is the plain
        arithmetic of their p25 retail over your cost — a sanity multiple, not a margin claim.
        “Price to beat” = the lowest observed p25 across matches: pricing at or below it undercuts
        ~75% of their observed sales. Greenway is structurally excluded from these rollups.
      </p>
    </Card>
  );
}
