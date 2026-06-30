"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input } from "@/components/admin/ui";

/**
 * Editable purchase-order builder table (client island).
 *
 * Receives the reorder suggestions from the server (already filtered + sorted by
 * urgency) and lets the manager select rows, edit order quantities and unit
 * costs, and pick a vendor. On submit it serialises the chosen lines into a
 * hidden JSON field consumed by `createPurchaseOrderAction`.
 *
 * STANDING RULE: AI/auto-computed numbers are DRAFT defaults — the manager
 * confirms every quantity here before the PO is saved.
 */
export type SuggestionRow = {
  posProductKey: string | null;
  productName: string;
  brand: string | null;
  vendorId: string | null;
  vendorName: string | null;
  onHand: number;
  unit: string;
  unitCostMinor: number;
  avgDaily: number;
  reorderPoint: number;
  suggestedQty: number;
  belowReorderPoint: boolean;
  daysOfSupplyLeft: number;
};

type VendorOption = { id: string; name: string };

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export function BuilderTable({
  rows,
  vendors,
  origin,
  planSummary,
  createAction,
}: {
  rows: SuggestionRow[];
  vendors: VendorOption[];
  origin: string;
  planSummary?: string;
  createAction: (formData: FormData) => void | Promise<void>;
}) {
  // Pre-select rows that are below the reorder point (need attention).
  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r, i) => {
      if (r.belowReorderPoint && r.suggestedQty > 0) set.add(String(i));
    });
    return set;
  }, [rows]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    rows.forEach((r, i) => (o[String(i)] = Math.max(0, Math.round(r.suggestedQty))));
    return o;
  });
  const [costs, setCosts] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    rows.forEach((r, i) => (o[String(i)] = r.unitCostMinor));
    return o;
  });
  const [vendorId, setVendorId] = useState<string>(() => {
    const first = rows.find((r) => r.vendorId)?.vendorId;
    return first ?? "";
  });

  function toggle(i: number) {
    const key = String(i);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chosen = rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => selected.has(String(i)) && (qtys[String(i)] ?? 0) > 0);

  const total = chosen.reduce((sum, { i }) => sum + (qtys[String(i)] ?? 0) * (costs[String(i)] ?? 0), 0);

  const linesJson = JSON.stringify(
    chosen.map(({ r, i }) => ({
      posProductKey: r.posProductKey,
      productName: r.productName,
      brand: r.brand,
      onHandQty: r.onHand,
      avgDailySales: r.avgDaily,
      reorderPoint: r.reorderPoint,
      orderQty: qtys[String(i)] ?? 0,
      unit: r.unit,
      unitCostMinor: costs[String(i)] ?? 0,
    })),
  );

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  return (
    <form action={createAction} className="space-y-4">
      {planSummary ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-stone-700">
          <span className="font-semibold">AI draft plan:</span> {planSummary}{" "}
          <span className="text-stone-500">(Review and adjust below before saving.)</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-[var(--admin-radius)] border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
          No products match the current filters, or there is no active inventory to evaluate.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-stone-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2 text-right">On hand</th>
                <th className="px-2 py-2 text-right">Avg/day</th>
                <th className="px-2 py-2 text-right">Reorder pt</th>
                <th className="px-2 py-2 text-right">Days left</th>
                <th className="px-2 py-2 text-right">Order qty</th>
                <th className="px-2 py-2 text-right">Unit cost</th>
                <th className="px-2 py-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const key = String(i);
                const isSel = selected.has(key);
                const lineTotal = (qtys[key] ?? 0) * (costs[key] ?? 0);
                return (
                  <tr
                    key={key}
                    className={`border-t border-stone-100 ${isSel ? "bg-emerald-50/40" : "hover:bg-stone-50"}`}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(i)}
                        aria-label={`Select ${r.productName}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-medium text-stone-800">{r.productName}</div>
                      <div className="text-xs text-stone-500">
                        {[r.brand, r.vendorName].filter(Boolean).join(" · ") || "—"}
                        {r.belowReorderPoint ? (
                          <Badge tone="orange" className="ml-2">below reorder</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-stone-700">{r.onHand}</td>
                    <td className="px-2 py-2 text-right text-stone-600">{r.avgDaily.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-stone-600">{r.reorderPoint}</td>
                    <td className="px-2 py-2 text-right text-stone-600">
                      {Number.isFinite(r.daysOfSupplyLeft) ? Math.round(r.daysOfSupplyLeft) : "∞"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        value={String(qtys[key] ?? 0)}
                        onChange={(e) =>
                          setQtys((p) => ({ ...p, [key]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))
                        }
                        className="w-20 text-right"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={(((costs[key] ?? 0) / 100)).toFixed(2)}
                        onChange={(e) =>
                          setCosts((p) => ({ ...p, [key]: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) }))
                        }
                        className="w-24 text-right"
                      />
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-stone-800">{money(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 rounded-[var(--admin-radius)] border border-stone-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            Vendor (for this PO)
          </label>
          <select
            name="vendor_id"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="w-full rounded-[var(--admin-radius)] border border-stone-300 px-3 py-2 text-sm"
          >
            <option value="">— Select vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input type="hidden" name="vendor_name" value={selectedVendor?.name ?? ""} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            Expected delivery (optional)
          </label>
          <input
            type="date"
            name="expected_date"
            className="w-full rounded-[var(--admin-radius)] border border-stone-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
            Note to vendor (optional)
          </label>
          <textarea
            name="note"
            rows={2}
            className="w-full rounded-[var(--admin-radius)] border border-stone-300 px-3 py-2 text-sm"
            placeholder="e.g. Please confirm availability and ship by Friday."
          />
        </div>
      </div>

      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="origin" value={origin} />

      <div className="flex items-center justify-between">
        <div className="text-sm text-stone-600">
          <span className="font-semibold text-stone-800">{chosen.length}</span> line
          {chosen.length === 1 ? "" : "s"} selected ·{" "}
          <span className="font-semibold text-stone-800">{money(total)}</span> total
        </div>
        <Button type="submit" variant="save" disabled={chosen.length === 0}>
          Save purchase order
        </Button>
      </div>
    </form>
  );
}
