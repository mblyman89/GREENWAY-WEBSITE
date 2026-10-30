import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import {
  getCycleCount,
  getCycleCountLines,
  getCycleCountSheetLines,
  type CycleCountLineWithLot,
} from "@/lib/inventory/cycle-counts";
import { pacificToday } from "@/lib/reports/timezone";
import { expiryProvenance, expiryStatus } from "@/lib/inventory/expiry-rules-core";
import {
  filterLines as filterSheetLines,
  sortLines as sortSheetLines,
  type SheetFilter,
  type SheetSort,
  type SheetSortKey,
} from "@/lib/inventory/cycle-count-sheet-core";
// No action is imported. This page is READ-ONLY (Fix Phase 4.4a, G-39): the
// Cancel button, the barcode scanner, the scan-to-Excel import and the Enter
// count column were removed, and the actions behind them were deleted.
// applyCycleCountAction stays out too: restoring a shelf-moving button must
// never be a one-line change.

const SHEET_SORT_KEYS: SheetSortKey[] = ["product", "lot", "category", "vendor", "brand", "system", "counted", "variance", "expires"];
const EXPIRY_FILTERS = ["all", "expired", "soon", "none"] as const;

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
    expiry?: string;
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

  const isOpen = session.status === "open";

  // Enriched lines drive the filter/sort tools + the export sheet.
  const sheetLines = await getCycleCountSheetLines(id);
  const today = pacificToday();
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
    // R34: expired / expiring soon / no date - counted against Pacific today.
    expiry: (EXPIRY_FILTERS as readonly string[]).includes(sp.expiry ?? "") ? (sp.expiry as SheetFilter["expiry"]) : "all",
    today,
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
        expiresOn: l.expiresOn,
        expiresOnSource: l.expiresOnSource,
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

  const exportQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v && k !== "error" && k !== "ok") exportQuery.set(k, v);
  }
  const exportHref = (format: "xlsx" | "csv") => {
    const p = new URLSearchParams(exportQuery);
    p.set("format", format);
    return `/admin/inventory/cycle-counts/${id}/export?${p.toString()}`;
  };
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
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      <div
        className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text-muted)]"
        data-testid="cycle-count-read-only"
      >
        Read only. This is an old cycle count, kept for the record. Nothing on this page
        can change it. To count stock, open{" "}
        <Link href="/admin/inventory/cycle-counts" className="text-[var(--admin-accent)] hover:underline">
          Cycle Counts
        </Link>{" "}
        and press <strong>Start counting</strong> on a released count.
      </div>

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

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--admin-text-faint)]">
          Showing {lines.length.toLocaleString()} of {allLines.length.toLocaleString()} lots.
        </span>
        <a href={exportHref("xlsx")} className="text-[var(--admin-accent)] hover:underline">
          Export to Excel
        </a>
        <a href={exportHref("csv")} className="text-[var(--admin-accent)] hover:underline">
          Export CSV
        </a>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--admin-border)] text-left text-[11px] uppercase tracking-wider text-[var(--admin-text-faint)]">
              <th className="px-4 py-3">Lot</th>
              {reveal ? <th className="px-4 py-3 text-right">System</th> : null}
              <th className="px-4 py-3 text-right">Counted</th>
              {reveal ? <th className="px-4 py-3 text-right">Variance</th> : null}
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
                        {(() => {
                          // R34: expiry badge - an expired lot found during a count
                          // should be pulled (quarantine / destroy) rather than recounted.
                          const st = expiryStatus(cat.expiresOn, today);
                          if (st.tone === "none") return null;
                          const prov = expiryProvenance({ expires_on: cat.expiresOn, expires_on_source: cat.expiresOnSource });
                          return (
                            <span title={`Expiry source: ${prov.sourceLabel}`} data-testid="count-line-expiry">
                              <Badge tone={st.tone === "expired" ? "danger" : st.tone === "soon" ? "gold" : "neutral"}>
                                {prov.isRule ? "Best by " : ""}
                                {st.label}
                              </Badge>
                            </span>
                          );
                        })()}
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
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-[var(--admin-text-faint)]">
        This screen records counts only. A counted difference reaches the{" "}
        <Link href="/admin/reports/compliance" className="text-[var(--admin-accent)] hover:underline">
          CCRS InventoryAdjustment.csv
        </Link>{" "}
        when it is approved and posted in{" "}
        <Link href="/admin/inventory/audits" className="text-[var(--admin-accent)] hover:underline">
          Inventory Auditing
        </Link>
        , which writes the shelf correction and the journal entry together.
      </p>
    </div>
  );
}
