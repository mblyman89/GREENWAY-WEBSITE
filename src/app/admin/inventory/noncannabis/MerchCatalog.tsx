"use client";

/**
 * MerchCatalog — the non-cannabis catalog workbench (Task M).
 *
 * One clean table for the whole catalog with instant search + type filter,
 * and an expandable row panel where the two everyday jobs live:
 *
 *   • ADJUST — post a quantity change (received / damaged / theft / promo /
 *     count / …) straight from the row. Plain retail rules — no CCRS hoops —
 *     but every change lands in the append-only ledger with who/why/when.
 *   • SETTINGS — manufacturer barcode (validated check digit), reorder
 *     point / order qty, shelf location.
 *
 * Scan identity column shows HOW each item gets scanned at the register:
 * manufacturer barcode when it has one, in-house SKU label when it doesn't
 * (with the print link right there).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select } from "@/components/admin/ui";
import {
  MERCH_ADJUSTMENT_REASONS,
  reorderStatusOf,
  scanIdentity,
  validateRetailBarcode,
  type AbcClass,
  type ReorderStatus,
} from "@/lib/noncannabis/merch-intel-core";
import {
  adjustNonCannabisAction,
  archiveNonCannabisAction,
  updateNonCannabisOpsAction,
} from "./actions";

export type CatalogRow = {
  id: string;
  sku: string;
  name: string;
  type: string;
  typeLabel: string;
  status: "draft" | "active" | "archived";
  qtyOnHand: number;
  priceMinorUnits: number;
  barcode: string | null;
  reorderPoint: number;
  reorderQty: number;
  location: string | null;
  abc: AbcClass | null;
};

function money(minor: number): string {
  return `$${(Math.max(0, minor) / 100).toFixed(2)}`;
}

const REORDER_TONE: Record<ReorderStatus, "danger" | "orange" | "gold" | "green" | "neutral"> = {
  out: "danger",
  below: "orange",
  near: "gold",
  ok: "green",
  untracked: "neutral",
};

function reorderBadge(row: CatalogRow) {
  const status = reorderStatusOf({ qtyOnHand: row.qtyOnHand, reorderPoint: row.reorderPoint });
  if (status === "ok" || status === "untracked") return null;
  const label = status === "out" ? "OUT" : status === "below" ? "Reorder" : "Low";
  return <Badge tone={REORDER_TONE[status]}>{label}</Badge>;
}

function AdjustForm({ row }: { row: CatalogRow }) {
  const [reason, setReason] = useState<string>("received");
  const [direction, setDirection] = useState<string>("add");
  const noteRequired = reason === "theft" || reason === "other";
  return (
    <form action={adjustNonCannabisAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="product_id" value={row.id} />
      <Field label="Reason" htmlFor={`reason-${row.id}`}>
        <Select
          id={`reason-${row.id}`}
          name="reason"
          value={reason}
          onChange={(e) => {
            const v = e.target.value;
            setReason(v);
            const meta = MERCH_ADJUSTMENT_REASONS.find((r) => r.value === v);
            if (meta && meta.sign > 0) setDirection("add");
            else if (meta && meta.sign < 0) setDirection("remove");
          }}
        >
          {MERCH_ADJUSTMENT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Direction" htmlFor={`direction-${row.id}`}>
        <Select
          id={`direction-${row.id}`}
          name="direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="add">+ Add</option>
          <option value="remove">− Remove</option>
        </Select>
      </Field>
      <Field label="Units" htmlFor={`units-${row.id}`}>
        <Input
          id={`units-${row.id}`}
          name="units"
          inputMode="numeric"
          placeholder="1"
          className="w-20"
          required
        />
      </Field>
      <Field
        label={noteRequired ? "Note (required)" : "Note (optional)"}
        htmlFor={`note-${row.id}`}
        className="min-w-[220px] flex-1"
      >
        <Input
          id={`note-${row.id}`}
          name="note"
          placeholder={noteRequired ? "Say what happened" : "Optional"}
          required={noteRequired}
        />
      </Field>
      <Button type="submit" size="sm" variant="primary">
        Post adjustment
      </Button>
    </form>
  );
}

function OpsForm({ row }: { row: CatalogRow }) {
  const [barcode, setBarcode] = useState(row.barcode ?? "");
  const barcodeCheck = useMemo(() => {
    const trimmed = barcode.trim();
    if (!trimmed) return null;
    return validateRetailBarcode(trimmed);
  }, [barcode]);
  return (
    <form action={updateNonCannabisOpsAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="product_id" value={row.id} />
      <Field
        label="Manufacturer barcode (UPC/EAN)"
        htmlFor={`barcode-${row.id}`}
        help="Blank = print the in-house SKU label instead"
        className="min-w-[220px]"
      >
        <Input
          id={`barcode-${row.id}`}
          name="barcode"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="Scan or type the code on the package"
        />
      </Field>
      <Field label="Reorder point" htmlFor={`rp-${row.id}`} help="0 = untracked">
        <Input
          id={`rp-${row.id}`}
          name="reorder_point"
          inputMode="numeric"
          defaultValue={row.reorderPoint > 0 ? String(row.reorderPoint) : ""}
          placeholder="0"
          className="w-24"
        />
      </Field>
      <Field label="Order qty" htmlFor={`rq-${row.id}`}>
        <Input
          id={`rq-${row.id}`}
          name="reorder_qty"
          inputMode="numeric"
          defaultValue={row.reorderQty > 0 ? String(row.reorderQty) : ""}
          placeholder="0"
          className="w-24"
        />
      </Field>
      <Field label="Shelf / bin" htmlFor={`loc-${row.id}`}>
        <Input
          id={`loc-${row.id}`}
          name="location"
          defaultValue={row.location ?? ""}
          placeholder="e.g. Glass wall A2"
          className="w-36"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="confirm" disabled={!!barcodeCheck && !barcodeCheck.ok}>
          Save settings
        </Button>
      </div>
      {barcodeCheck && !barcodeCheck.ok ? (
        <p className="w-full text-xs text-[var(--admin-danger)]">{barcodeCheck.error}</p>
      ) : barcodeCheck?.ok ? (
        <p className="w-full text-xs text-[var(--admin-green)]">
          Valid {barcodeCheck.kind.replace("_", "-").toUpperCase()} ✓
        </p>
      ) : null}
    </form>
  );
}

export function MerchCatalog({ rows }: { rows: CatalogRow[] }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.type)) seen.set(r.type, r.typeLabel);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.sku.toLowerCase().includes(needle) ||
        (r.barcode ?? "").includes(needle) ||
        (r.location ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, typeFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="merch-q" className="min-w-[240px] flex-1">
          <Input
            id="merch-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, SKU, barcode or shelf — scan a code to jump to the item"
          />
        </Field>
        <Field label="Type" htmlFor="merch-type">
          <Select id="merch-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {types.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="pb-2 text-xs text-[var(--admin-text-faint)]">
          {filtered.length} of {rows.length} items
        </p>
      </div>

      <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Scan identity</th>
              <th className="px-4 py-3 text-center">ABC</th>
              <th className="px-4 py-3 text-center">On hand</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3">Shelf</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--admin-text-faint)]">
                  No items match.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const scan = scanIdentity({ barcode: r.barcode, sku: r.sku });
                const isOpen = openId === r.id;
                return (
                  <FragmentRow
                    key={r.id}
                    row={r}
                    scanMode={scan.mode}
                    isOpen={isOpen}
                    onToggle={() => setOpenId(isOpen ? null : r.id)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  row,
  scanMode,
  isOpen,
  onToggle,
}: {
  row: CatalogRow;
  scanMode: "manufacturer_barcode" | "inhouse_sku_label";
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-[var(--admin-border)]">
        <td className="px-4 py-3">
          <div className="font-medium text-[var(--admin-text)]">{row.name}</div>
          <div className="font-mono text-xs text-[var(--admin-text-faint)]">
            {row.sku} · {row.typeLabel}
          </div>
        </td>
        <td className="px-4 py-3">
          {scanMode === "manufacturer_barcode" ? (
            <div>
              <Badge tone="green">UPC/EAN</Badge>
              <div className="mt-1 font-mono text-xs text-[var(--admin-text-faint)]">{row.barcode}</div>
            </div>
          ) : (
            <div>
              <Badge tone="gold">SKU label</Badge>
              <div className="mt-1">
                <Link
                  href={`/admin/inventory/noncannabis/${row.id}/label`}
                  className="text-xs text-[var(--admin-accent)] underline"
                >
                  🖨 Print label
                </Link>
              </div>
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          {row.abc ? (
            <Badge tone={row.abc === "A" ? "green" : row.abc === "B" ? "gold" : "neutral"}>{row.abc}</Badge>
          ) : (
            <span className="text-xs text-[var(--admin-text-faint)]">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <span className="font-semibold text-[var(--admin-text)]">{row.qtyOnHand}</span>
          <div className="mt-1 flex justify-center">{reorderBadge(row)}</div>
        </td>
        <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{money(row.priceMinorUnits)}</td>
        <td className="px-4 py-3 text-xs text-[var(--admin-text-muted)]">{row.location ?? "—"}</td>
        <td className="px-4 py-3 text-right">
          <Button type="button" size="sm" variant={isOpen ? "neutral" : "primary"} onClick={onToggle}>
            {isOpen ? "Close" : "Adjust"}
          </Button>
        </td>
      </tr>
      {isOpen ? (
        <tr className="border-t border-[var(--admin-border)] bg-[var(--admin-surface-2)]">
          <td colSpan={7} className="px-4 py-4">
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Adjust quantity — every change is logged (who / why / when)
                </p>
                <AdjustForm row={row} />
              </div>
              <div className="border-t border-[var(--admin-border)] pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Item settings — barcode, reorder point, shelf
                </p>
                <OpsForm row={row} />
              </div>
              <div className="flex items-center justify-between border-t border-[var(--admin-border)] pt-4">
                <Link
                  href={`/admin/inventory/noncannabis/${row.id}/label`}
                  className="text-xs text-[var(--admin-accent)] underline"
                >
                  🖨 Print SKU label
                </Link>
                <form action={archiveNonCannabisAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" size="sm" variant="neutral">
                    Archive item
                  </Button>
                </form>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
