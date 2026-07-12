"use client";

/**
 * SampleHistoryClient — WAC 314-55-096
 *
 * Read-only, POS-grade view of every employee TRADE sample RECEIPT (outgoing to
 * a paid employee). All filtering / sorting / CSV happen client-side in the pure
 * `sample-history-core` layer, so the page fetches once and stays snappy.
 *
 * IQC is producer/processor-only [096(3)] and is not available to a retailer,
 * so it has been fully retired from this view.
 *
 * Nothing here mutates data or the ledger — it is a reporting surface only.
 */
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, Field, Input, Select, Badge } from "@/components/admin/ui";
import { EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import {
  queryHistory,
  summarizeHistory,
  rollupByEmployeeQuarter,
  distinctQuarters,
  historyToCsv,
  quarterLabel,
  PRODUCT_TYPE_LABELS,
  type HistoryEvent,
  type HistorySort,
  type HistoryFilters,
} from "@/lib/compliance/sample-history-core";
import type { SampleProductType } from "@/lib/compliance/trade-samples-core";

export type SampleHistoryCaps = {
  tradeCap: number;
};

const SORT_OPTIONS: { value: HistorySort; label: string }[] = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "units_desc", label: "Most units" },
  { value: "units_asc", label: "Fewest units" },
  { value: "employee_asc", label: "Employee (A–Z)" },
  { value: "type_asc", label: "Type" },
];

const PRODUCT_TYPES: SampleProductType[] = ["useable", "concentrate", "infused"];

function toneForRatio(used: number, cap: number): "green" | "orange" | "danger" {
  if (cap <= 0) return "green";
  const pct = used / cap;
  if (pct >= 1) return "danger";
  if (pct >= 0.8) return "orange";
  return "green";
}

function CapBar({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const tone = toneForRatio(used, cap);
  const color = tone === "danger" ? "#ef4444" : tone === "orange" ? "#f59e0b" : "#7ed957";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function fmtDate(iso: string): string {
  // Render as Pacific-agnostic calendar date (event date is stored as created_at).
  return iso.slice(0, 10);
}

function unitSize(e: HistoryEvent): string {
  if (e.unitSizeGrams != null) return `${e.unitSizeGrams} g`;
  if (e.unitSizeMg != null) return `${e.unitSizeMg} mg`;
  return "—";
}

export function SampleHistoryClient({
  events,
  employees,
  caps,
}: {
  events: HistoryEvent[];
  employees: { id: string; name: string }[];
  caps: SampleHistoryCaps;
}) {
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [quarterKey, setQuarterKey] = useState<string>("all");
  const [productType, setProductType] = useState<SampleProductType | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<HistorySort>("date_desc");

  const quarters = useMemo(() => distinctQuarters(events), [events]);

  const filters: HistoryFilters = useMemo(
    () => ({
      employeeId: employeeId === "all" ? null : employeeId,
      quarterKey: quarterKey === "all" ? null : quarterKey,
      productType,
      search,
    }),
    [employeeId, quarterKey, productType, search],
  );

  const rows = useMemo(() => queryHistory(events, filters, sort), [events, filters, sort]);
  const totals = useMemo(() => summarizeHistory(rows), [rows]);
  const rollups = useMemo(
    () =>
      rollupByEmployeeQuarter(rows, {
        tradeCap: caps.tradeCap,
      }),
    [rows, caps],
  );

  const filtersActive =
    employeeId !== "all" ||
    quarterKey !== "all" ||
    productType !== "all" ||
    search.trim() !== "";

  function resetFilters() {
    setEmployeeId("all");
    setQuarterKey("all");
    setProductType("all");
    setSearch("");
    setSort("date_desc");
  }

  function downloadCsv() {
    const csv = historyToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `employee-sample-history-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Events shown" value={totals.events} accent="muted" />
        <StatCard label="Total units" value={totals.totalUnits} accent="gold" />
        <StatCard label="Trade units" value={totals.tradeUnits} accent="green" />
        <StatCard label="From sample jar" value={totals.fromJarUnits} accent="muted" />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader
          title="Filters"
          subtitle="Narrow the history by employee, quarter, product type, or free-text search."
          action={
            <div className="flex gap-2">
              {filtersActive ? (
                <Button variant="neutral" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : null}
              <Button variant="save" size="sm" onClick={downloadCsv} disabled={rows.length === 0}>
                Export CSV
              </Button>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="all">All employees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quarter">
            <Select value={quarterKey} onChange={(e) => setQuarterKey(e.target.value)}>
              <option value="all">All quarters</option>
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {quarterLabel(q)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Product type">
            <Select
              value={productType}
              onChange={(e) => setProductType(e.target.value as SampleProductType | "all")}
            >
              <option value="all">All product types</option>
              {PRODUCT_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {PRODUCT_TYPE_LABELS[pt]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort by">
            <Select value={sort} onChange={(e) => setSort(e.target.value as HistorySort)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search (employee / note)">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search…"
            />
          </Field>
        </div>
      </Card>

      {/* Per-employee / per-quarter roll-up vs statutory caps */}
      {rollups.length > 0 ? (
        <Card>
          <CardHeader
            title="Per-employee quarter usage"
            subtitle="Units given to each employee vs the WAC 314-55-096 quarterly caps (matches the current filters)."
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rollups.map((r) => (
              <div
                key={`${r.employeeId ?? r.employeeName}-${r.quarterKey}`}
                className="rounded-[var(--admin-radius-sm)] border border-white/10 bg-[var(--admin-surface-2)] p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[var(--admin-text)]">
                      {r.employeeName}
                    </div>
                    <div className="text-xs text-[var(--admin-text-muted)]">
                      {quarterLabel(r.quarterKey)}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-[var(--admin-text-muted)]">Trade</span>
                      <Badge tone={toneForRatio(r.tradeUnits, r.tradeCap)}>
                        {r.tradeUnits} / {r.tradeCap}
                      </Badge>
                    </div>
                    <CapBar used={r.tradeUnits} cap={r.tradeCap} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Detail table */}
      <Card padding="none">
        <div className="border-b border-white/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">
            Sample receipts{" "}
            <span className="text-[var(--admin-text-muted)]">({rows.length})</span>
          </h3>
        </div>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={filtersActive ? "No matching sample receipts" : "No sample receipts yet"}
              description={
                filtersActive
                  ? "Try clearing or loosening the filters above."
                  : "Once you assign samples to employees from the Employee Samples page, they will appear here."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Employee</th>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Sample product / lot</th>
                  <th className="px-5 py-3 text-right font-medium">Units</th>
                  <th className="px-5 py-3 text-right font-medium">Unit size</th>
                  <th className="px-5 py-3 font-medium">Quarter</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-white/5 text-[var(--admin-text)] last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{fmtDate(e.createdAt)}</td>
                    <td className="px-5 py-3">{e.employeeName ?? "—"}</td>
                    <td className="px-5 py-3">{PRODUCT_TYPE_LABELS[e.productType]}</td>
                    <td className="px-5 py-3">
                      {e.sourceProductName ? (
                        <span>
                          {e.sourceProductName}
                          {e.sourceLotRef ? (
                            <span className="text-[var(--admin-text-muted)]"> — lot {e.sourceLotRef}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-[var(--admin-text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{e.unitCount}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                      {unitSize(e)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-[var(--admin-text-muted)]">
                      {quarterLabel(e.quarterKey)}
                    </td>
                    <td className="px-5 py-3">
                      {e.fromSampleJar ? (
                        <Badge tone="neutral">Sample jar</Badge>
                      ) : (
                        <span className="text-[var(--admin-text-muted)]">Direct</span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate px-5 py-3 text-[var(--admin-text-muted)]" title={e.note ?? ""}>
                      {e.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
