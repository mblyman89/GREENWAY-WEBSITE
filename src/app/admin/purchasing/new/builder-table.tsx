"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input, Field, Select, Textarea } from "@/components/admin/ui";

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
 *
 * THEME: fully on the dark admin tokens (no light `stone`/`white` surfaces).
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
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          <span className="font-semibold text-[var(--admin-accent)]">AI draft plan:</span> {planSummary}{" "}
          <span className="text-[var(--admin-text-muted)]">(Review and adjust below before saving.)</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-[var(--admin-text-muted)]">
          No products match the current filters, or there is no active inventory to evaluate.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <th className="w-8 px-3 py-3"></th>
                <th className="px-3 py-3">Product</th>
                <th className="px-3 py-3 text-right">On hand</th>
                <th className="px-3 py-3 text-right">Avg/day</th>
                <th className="px-3 py-3 text-right">Reorder pt</th>
                <th className="px-3 py-3 text-right">Days left</th>
                <th className="px-3 py-3 text-right">Order qty</th>
                <th className="px-3 py-3 text-right">Unit cost</th>
                <th className="px-3 py-3 text-right">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {rows.map((r, i) => {
                const key = String(i);
                const isSel = selected.has(key);
                const lineTotal = (qtys[key] ?? 0) * (costs[key] ?? 0);
                return (
                  <tr
                    key={key}
                    className={
                      isSel
                        ? "bg-[var(--admin-accent-soft)]"
                        : "bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]"
                    }
                  >
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(i)}
                        aria-label={`Select ${r.productName}`}
                        className="h-4 w-4 accent-[var(--admin-accent)]"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-[var(--admin-text)]">{r.productName}</div>
                      <div className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
                        {[r.brand, r.vendorName].filter(Boolean).join(" · ") || "—"}
                        {r.belowReorderPoint ? (
                          <Badge tone="orange" className="ml-2">below reorder</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-[var(--admin-text)]">{r.onHand}</td>
                    <td className="px-3 py-3 text-right text-[var(--admin-text-muted)]">{r.avgDaily.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right text-[var(--admin-text-muted)]">{r.reorderPoint}</td>
                    <td className="px-3 py-3 text-right text-[var(--admin-text-muted)]">
                      {Number.isFinite(r.daysOfSupplyLeft) ? Math.round(r.daysOfSupplyLeft) : "∞"}
                    </td>
                    <td className="px-3 py-3 text-right">
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
                    <td className="px-3 py-3 text-right">
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
                    <td className="px-3 py-3 text-right font-semibold text-[var(--admin-text)]">{money(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 sm:grid-cols-2">
        <Field label="Vendor (for this PO)">
          <Select name="vendor_id" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— Select vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <input type="hidden" name="vendor_name" value={selectedVendor?.name ?? ""} />
        </Field>
        <Field label="Expected delivery (optional)">
          <Input type="date" name="expected_date" />
        </Field>
        <Field label="Note to vendor (optional)" className="sm:col-span-2">
          <Textarea
            name="note"
            rows={2}
            placeholder="e.g. Please confirm availability and ship by Friday."
          />
        </Field>
      </div>

      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="origin" value={origin} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[var(--admin-text-muted)]">
          <span className="font-semibold text-[var(--admin-text)]">{chosen.length}</span> line
          {chosen.length === 1 ? "" : "s"} selected ·{" "}
          <span className="font-semibold text-[var(--admin-text)]">{money(total)}</span> total
        </div>
        <Button type="submit" variant="save" disabled={chosen.length === 0}>
          Save purchase order
        </Button>
      </div>
    </form>
  );
}
