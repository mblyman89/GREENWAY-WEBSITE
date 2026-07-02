import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button, Badge } from "@/components/admin/ui";
import {
  getCycleCount,
  getCycleCountLines,
  getCycleCountScanLines,
  getCycleCountSheetLines,
  type CycleCountLineWithLot,
} from "@/lib/inventory/cycle-counts";
import { CycleCountScanner } from "@/components/admin/inventory/CycleCountScanner";
import { CycleCountSheetTools } from "@/components/admin/inventory/CycleCountSheetTools";
import {
  filterLines as filterSheetLines,
  sortLines as sortSheetLines,
  distinctValues,
  type SheetFilter,
  type SheetSort,
  type SheetSortKey,
} from "@/lib/inventory/cycle-count-sheet-core";
import {
  recordLineCountAction,
  applyCycleCountAction,
  cancelCycleCountAction,
} from "../actions";

const SHEET_SORT_KEYS: SheetSortKey[] = ["product", "lot", "category", "vendor", "brand", "system", "counted", "variance"];

export const dynamic = "force-dynamic";

function fmtQty(qty: number | null, unit: string | null): string {
  if (qty == null) return "—";
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n}${unit ? ` ${unit}` : ""}`;
}

function VarianceBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-[var(--admin-text-faint)]">—</span>;
  if (v === 0) return <Badge tone="green">match</Badge>;
  return <Badge tone={v > 0 ? "gold" : "danger"}>{v > 0 ? `+${v}` : v}</Badge>;
}

export default async function CycleCountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    ok?: string;
    q?: string;
    category?: string;
    lcbcategory?: string;
    type?: string;
    vendor?: string;
    brand?: string;
    counted?: string;
    sample?: string;
    medical?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;

  const session = await getCycleCount(id);
  if (!session) notFound();
  const allLines = await getCycleCountLines(id);
  const scanLines = session.status === "open" ? await getCycleCountScanLines(id) : [];

  const isOpen = session.status === "open";

  // Enriched lines drive the filter/sort tools + the export sheet.
  const sheetLines = await getCycleCountSheetLines(id);
  const filter: SheetFilter = {
    q: sp.q,
    // PRIMARY filter is OUR website category (Request B). Raw LCB category/type
    // remain available via rawCategory/inventoryType ("replace but keep old").
    category: sp.category || null,
    rawCategory: sp.lcbcategory || null,
    inventoryType: sp.type || null,
    vendorName: sp.vendor || null,
    brandName: sp.brand || null,
    counted: (sp.counted as SheetFilter["counted"]) ?? "all",
    sample: (sp.sample as SheetFilter["sample"]) ?? "all",
    medical: (sp.medical as SheetFilter["medical"]) ?? "all",
  };
  const sort: SheetSort = {
    key: (SHEET_SORT_KEYS.includes((sp.sort ?? "") as SheetSortKey) ? sp.sort : "product") as SheetSortKey,
    dir: sp.dir === "desc" ? "desc" : "asc",
  };
  // Resolved category (our convention) + raw LCB, keyed by line id for the table.
  const catByLine = new Map(
    sheetLines.map((l) => [
      l.lineId,
      {
        label: l.websiteCategoryLabel,
        raw: l.category,
        rawType: l.inventoryType,
        unmapped: l.categoryUnmapped,
      },
    ] as const),
  );
  const orderedSheet = sortSheetLines(filterSheetLines(sheetLines, filter), sort);
  const orderedIds = orderedSheet.map((l) => l.lineId);
  const orderIndex = new Map(orderedIds.map((lineId, i) => [lineId, i] as const));
  // Show the display rows in the filtered/sorted order; drop rows filtered out.
  const lines = allLines
    .filter((l) => orderIndex.has(l.id))
    .sort((a, b) => (orderIndex.get(a.id)! - orderIndex.get(b.id)!));

  const filterOptions = {
    // PRIMARY category dropdown = OUR website category labels (converted).
    categories: distinctValues(sheetLines, (l) => l.websiteCategoryLabel),
    // RAW LCB values kept available for reference filtering.
    lcbCategories: distinctValues(sheetLines, (l) => l.category),
    types: distinctValues(sheetLines, (l) => l.inventoryType),
    vendors: distinctValues(sheetLines, (l) => l.vendorName),
    brands: distinctValues(sheetLines, (l) => l.brandName),
  };

  const counted = lines.filter((l) => l.counted_qty != null).length;
  const variances = lines.filter((l) => (l.variance_qty ?? 0) !== 0).length;
  // Blind: only reveal system_qty + variance once a session is applied OR the
  // line has been counted (so the employee doesn't see the target up front).
  const reveal = !isOpen;

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Cycle Counts", href: "/admin/inventory/cycle-counts" },
          { label: session.label },
        ]}
      />
      <AdminPageHeader
        title={session.label}
        subtitle={session.scope_note ?? "Blind physical count"}
        action={
          isOpen ? (
            <div className="flex gap-2">
              <form action={applyCycleCountAction.bind(null, id)}>
                <Button type="submit" disabled={counted === 0}>
                  Apply variances
                </Button>
              </form>
              <form action={cancelCycleCountAction.bind(null, id)}>
                <Button type="submit" variant="neutral">
                  Cancel
                </Button>
              </form>
            </div>
          ) : undefined
        }
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {sp.ok === "applied"
            ? "Variances applied — on-hand corrected and adjustments posted."
            : "Count recorded."}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Status" value={session.status} accent={isOpen ? "gold" : "green"} />
        <StatCard label="Lots" value={allLines.length.toLocaleString()} accent="muted" />
        <StatCard
          label="Counted"
          value={`${allLines.filter((l) => l.counted_qty != null).length}/${allLines.length}`}
          accent="muted"
        />
        <StatCard
          label="Variances"
          value={allLines.filter((l) => (l.variance_qty ?? 0) !== 0).length.toLocaleString()}
          accent={allLines.some((l) => (l.variance_qty ?? 0) !== 0) ? "orange" : "green"}
        />
      </div>

      {isOpen ? (
        <HelpPanel
          id="cycle-count-blind"
          title="Blind count"
          steps={[
            "Count the physical quantity of each lot and enter it. The system figure is hidden until you apply.",
            "Once every lot is counted, click Apply variances to post corrections.",
            "Cancelling discards the session without changing on-hand.",
          ]}
        />
      ) : null}

      {isOpen ? <CycleCountScanner countId={id} lines={scanLines} /> : null}

      {isOpen ? (
        <CycleCountSheetTools
          countId={id}
          options={filterOptions}
          totalLines={allLines.length}
          shownLines={lines.length}
        />
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--admin-border)] text-left text-[11px] uppercase tracking-wider text-[var(--admin-text-faint)]">
              <th className="px-4 py-3">Lot</th>
              {reveal ? <th className="px-4 py-3 text-right">System</th> : null}
              <th className="px-4 py-3 text-right">Counted</th>
              {reveal ? <th className="px-4 py-3 text-right">Variance</th> : null}
              {isOpen ? <th className="px-4 py-3 text-right">Enter count</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--admin-text-faint)]">
                  No lots match your filters.
                </td>
              </tr>
            ) : null}
            {lines.map((line: CycleCountLineWithLot) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--admin-text)]">{line.product_name ?? "—"}</div>
                  <div className="font-mono text-[11px] text-[var(--admin-text-faint)]">{line.lot_code ?? line.lot_id.slice(0, 8)}</div>
                  {(() => {
                    const cat = catByLine.get(line.id);
                    if (!cat) return null;
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {cat.unmapped ? (
                          <Badge tone="gold">
                            Unmapped category
                          </Badge>
                        ) : (
                          <Badge tone="neutral">{cat.label}</Badge>
                        )}
                        {cat.raw ? (
                          <span
                            className="text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]"
                            title={`LCB inventory type: ${cat.rawType ?? "—"}`}
                          >
                            LCB: {cat.raw}
                          </span>
                        ) : null}
                        {cat.unmapped ? (
                          <Link
                            href="/admin/settings/types"
                            className="text-[10px] text-[var(--admin-accent)] hover:underline"
                          >
                            Map it →
                          </Link>
                        ) : null}
                      </div>
                    );
                  })()}
                </td>
                {reveal ? (
                  <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{fmtQty(line.system_qty, line.unit)}</td>
                ) : null}
                <td className="px-4 py-3 text-right text-[var(--admin-text)]">{fmtQty(line.counted_qty, line.unit)}</td>
                {reveal ? (
                  <td className="px-4 py-3 text-right">
                    <VarianceBadge v={line.variance_qty} />
                  </td>
                ) : null}
                {isOpen ? (
                  <td className="px-4 py-3">
                    <form
                      action={recordLineCountAction.bind(null, id, line.id)}
                      className="flex items-center justify-end gap-2"
                    >
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        name="counted_qty"
                        defaultValue={line.counted_qty ?? undefined}
                        className="w-24 text-right"
                        placeholder={line.counted_qty != null ? undefined : "qty"}
                      />
                      <Button type="submit" variant="confirm">
                        {line.counted_qty != null ? "Update" : "Save"}
                      </Button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-[var(--admin-text-faint)]">
        Variance corrections post as <code className="text-[var(--admin-text-muted)]">count</code> inventory adjustments, which export to
        the{" "}
        <Link href="/admin/reports/compliance" className="text-[var(--admin-accent)] hover:underline">
          CCRS InventoryAdjustment.csv
        </Link>
        .
      </p>
    </div>
  );
}
