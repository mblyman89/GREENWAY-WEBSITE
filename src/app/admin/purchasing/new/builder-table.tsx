"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input, Field, Select, Textarea } from "@/components/admin/ui";
import {
  classifyUrgency,
  builderRowKey,
  filterRowsByQuery,
  sortRows,
  presetRowKeys,
  countVendorMismatches,
  URGENCY_LABEL,
  BUILDER_SORT_OPTIONS,
  type BuilderSortKey,
  type SelectionPreset,
  type UrgencyLevel,
} from "@/lib/purchasing/po-builder-core";

/**
 * The PO command center's work surface (client island, Task J rewrite).
 *
 * Receives the REAL reorder suggestions from the server and lets the manager
 * search, re-sort, bulk-select by urgency, edit quantities and unit costs,
 * pick a vendor, then SAVE the draft or SAVE & EMAIL it in one step.
 *
 * Contract-critical (unchanged from the original builder):
 *   - hidden `lines` field: JSON array of {posProductKey, productName, brand,
 *     category, onHandQty, avgDailySales, reorderPoint, orderQty, unit,
 *     unitCostMinor} — exactly what createPurchaseOrderAction parses.
 *   - hidden `origin`, `from_lead`, `vendor_id/name/email`, `expected_date`,
 *     `note` fields — same names, same semantics.
 *
 * What changed:
 *   - per-row edit state is keyed by a STABLE row key (pos product key or a
 *     normalized name key — the store's own dedupe identity), never by array
 *     index, so client-side sorting/filtering can't corrupt quantities.
 *   - urgency badges (stockout / critical / below reorder) computed by the
 *     PURE po-builder-core module from real velocity + the store's lead time.
 *   - quick-select presets, live search, and sort — buyer muscle-memory tools.
 *   - sticky order bar: running total, category mix, and the save buttons stay
 *     in view while scrolling a long table.
 *   - vendor sanity check: warns when selected lines' inventory vendor differs
 *     from the PO's vendor (a PO goes to ONE licensed vendor).
 *
 * Drafts-only rule: every quantity/cost here is an editable DEFAULT the
 * manager confirms — nothing is ordered until they save.
 */
export type SuggestionRow = {
  posProductKey: string | null;
  productName: string;
  brand: string | null;
  category: string | null;
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

type VendorOption = { id: string; name: string; email: string | null };

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const URGENCY_TONE: Record<UrgencyLevel, "danger" | "orange" | "gold" | "neutral"> = {
  stockout: "danger",
  critical: "orange",
  low: "gold",
  healthy: "neutral",
};

export function BuilderTable({
  rows: rowsProp,
  vendors,
  origin,
  planSummary,
  prefill,
  fromLeadId,
  leadTimeDays,
  createAction,
  sendAction,
}: {
  rows: SuggestionRow[];
  vendors: VendorOption[];
  origin: string;
  planSummary?: string;
  prefill?: SuggestionRow;
  fromLeadId?: string;
  /** The store's real lead-time setting (drives urgency classification). */
  leadTimeDays: number;
  createAction: (formData: FormData) => void | Promise<void>;
  sendAction: (formData: FormData) => void | Promise<void>;
}) {
  // When promoting a discovery lead, prepend its draft line so it's first and
  // pre-selected. Memoized so the row list is stable across renders.
  const rows = useMemo(
    () => (prefill ? [prefill, ...rowsProp] : rowsProp),
    [prefill, rowsProp],
  );

  // Stable keys — the store dedupes on exactly this identity, so it's unique
  // within one suggestion set. The prefill lead has no pos key; its name key
  // is namespaced so it can never collide with a real suggestion.
  const keyOf = useMemo(() => {
    const prefillKey = prefill ? `lead:${builderRowKey(prefill)}` : null;
    return (r: SuggestionRow) => (prefill && r === prefill ? (prefillKey as string) : builderRowKey(r));
  }, [prefill]);

  // Pre-select rows that need attention (below reorder with a suggested qty);
  // a prefilled lead row is always pre-selected.
  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.belowReorderPoint && r.suggestedQty > 0) set.add(keyOf(r));
    });
    if (prefill) set.add(keyOf(prefill));
    return set;
  }, [rows, prefill, keyOf]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    rows.forEach((r) => (o[keyOf(r)] = Math.max(0, Math.round(r.suggestedQty))));
    return o;
  });
  const [costs, setCosts] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    rows.forEach((r) => (o[keyOf(r)] = r.unitCostMinor));
    return o;
  });
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<BuilderSortKey>("urgency");
  const [vendorId, setVendorId] = useState<string>(() => {
    // Prefer the RECONCILED vendor id threaded from Discovery (verified against
    // real vendors), then a vendor matched by the lead's display name, then any
    // suggestion row's vendor id. The human still confirms before saving.
    if (prefill?.vendorId && vendors.some((v) => v.id === prefill.vendorId)) {
      return prefill.vendorId;
    }
    if (prefill?.vendorName) {
      const match = vendors.find(
        (v) => v.name.toLowerCase() === prefill.vendorName!.toLowerCase(),
      );
      if (match) return match.id;
    }
    const first = rows.find((r) => r.vendorId)?.vendorId;
    return first ?? "";
  });

  // Visible rows: search, then sort. The prefill lead (when present) is always
  // pinned to the top so a promoted product can never be "lost" to a filter.
  const visible = useMemo(() => {
    const body = rows.filter((r) => !(prefill && r === prefill));
    const searched = filterRowsByQuery(body, query);
    const sorted = sortRows(searched, sortKey, leadTimeDays);
    return prefill ? [prefill, ...sorted] : sorted;
  }, [rows, prefill, query, sortKey, leadTimeDays]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Presets act on the VISIBLE (searched) rows so "Stockouts" respects an
  // active search; the prefill lead stays selected through every preset
  // except an explicit "None".
  function applyPreset(preset: SelectionPreset) {
    const body = visible.filter((r) => !(prefill && r === prefill));
    const keys = new Set(
      presetRowKeys(body, preset, leadTimeDays).map((k) => k), // core keys == keyOf for body rows
    );
    if (prefill && preset !== "none") keys.add(keyOf(prefill));
    setSelected(keys);
  }

  const chosen = rows
    .map((r) => ({ r, key: keyOf(r) }))
    .filter(({ key }) => selected.has(key) && (qtys[key] ?? 0) > 0);

  const total = chosen.reduce((sum, { key }) => sum + (qtys[key] ?? 0) * (costs[key] ?? 0), 0);
  const totalUnits = chosen.reduce((sum, { key }) => sum + (qtys[key] ?? 0), 0);

  // Category breakdown of the chosen lines (cannabis-first summary).
  const byCategory = (() => {
    const map = new Map<string, { units: number; minor: number }>();
    chosen.forEach(({ r, key }) => {
      const cat = (r.category || "uncategorized").toLowerCase();
      const cur = map.get(cat) ?? { units: 0, minor: 0 };
      cur.units += qtys[key] ?? 0;
      cur.minor += (qtys[key] ?? 0) * (costs[key] ?? 0);
      map.set(cat, cur);
    });
    return [...map.entries()].sort((a, b) => b[1].minor - a[1].minor);
  })();

  const linesJson = JSON.stringify(
    chosen.map(({ r, key }) => ({
      posProductKey: r.posProductKey,
      productName: r.productName,
      brand: r.brand,
      category: r.category,
      onHandQty: r.onHand,
      avgDailySales: r.avgDaily,
      reorderPoint: r.reorderPoint,
      orderQty: qtys[key] ?? 0,
      unit: r.unit,
      unitCostMinor: costs[key] ?? 0,
    })),
  );

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const vendorEmail = selectedVendor?.email ?? "";
  const canEmail = chosen.length > 0 && Boolean(vendorId) && Boolean(vendorEmail);

  // Sanity check: lines whose INVENTORY vendor differs from the PO's vendor.
  const mismatchCount = countVendorMismatches(
    chosen.map(({ r }) => ({ vendorName: r.vendorName })),
    selectedVendor?.name ?? null,
  );

  const hiddenBySearch = rows.length - visible.length;

  return (
    <form className="space-y-5">
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
        <>
          {/* Command bar: search, sort, quick-select presets */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search product, brand, vendor, category…"
              aria-label="Search products"
              className="w-full sm:w-64"
            />
            <Select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as BuilderSortKey)}
              aria-label="Sort rows"
              className="w-full sm:w-auto"
            >
              {BUILDER_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  Sort: {o.label}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <Button type="button" variant="neutral" size="sm" onClick={() => applyPreset("stockouts")}>
                Stockouts
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => applyPreset("critical")}>
                Order today
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => applyPreset("needs_action")}>
                Needs action
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => applyPreset("all")}>
                All
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => applyPreset("none")}>
                None
              </Button>
            </div>
          </div>

          <div className="text-xs text-[var(--admin-text-muted)]">
            {visible.length} of {rows.length} product{rows.length === 1 ? "" : "s"} shown
            {hiddenBySearch > 0 ? ` · ${hiddenBySearch} hidden by search` : ""} · rows below the
            reorder point are pre-ticked · quick-select applies to the rows shown
          </div>

          <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-3 py-3">Product</th>
                  <th className="px-3 py-3">Status</th>
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
                {visible.map((r) => {
                  const key = keyOf(r);
                  const isSel = selected.has(key);
                  const isLead = Boolean(prefill && r === prefill);
                  const urgency = classifyUrgency(r, leadTimeDays);
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
                          onChange={() => toggle(key)}
                          aria-label={`Select ${r.productName}`}
                          className="h-4 w-4 accent-[var(--admin-accent)]"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-[var(--admin-text)]">{r.productName}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--admin-text-muted)]">
                          {[r.brand, r.vendorName].filter(Boolean).join(" · ") || "—"}
                          {r.category ? <Badge tone="neutral">{titleCase(r.category)}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {isLead ? (
                          <Badge tone="green">from lead</Badge>
                        ) : urgency !== "healthy" ? (
                          <Badge tone={URGENCY_TONE[urgency]}>{URGENCY_LABEL[urgency]}</Badge>
                        ) : (
                          <span className="text-xs text-[var(--admin-text-faint)]">—</span>
                        )}
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
        </>
      )}

      {/* Vendor + delivery + note */}
      <div className="grid gap-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 sm:grid-cols-2">
        <Field label="Vendor (for this PO)" help="Licensed producer/processor this order goes to">
          <Select name="vendor_id" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— Select vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.email ? "" : "  (no email on file)"}
              </option>
            ))}
          </Select>
          <input type="hidden" name="vendor_name" value={selectedVendor?.name ?? ""} />
          <input type="hidden" name="vendor_email" value={vendorEmail} />
          {vendorId ? (
            vendorEmail ? (
              <p className="mt-1.5 text-xs text-[var(--admin-text-muted)]">
                Emails to <span className="font-medium text-[var(--admin-text)]">{vendorEmail}</span>
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-[var(--admin-orange)]">
                No email on file for this vendor — add one on the vendor record to email the PO.
              </p>
            )
          ) : null}
          {mismatchCount > 0 ? (
            <p className="mt-1.5 text-xs text-[var(--admin-orange)]">
              Heads up: {mismatchCount} selected line{mismatchCount === 1 ? "" : "s"} last came from a
              different vendor. A PO goes to one licensed vendor — split the order or confirm this
              vendor also carries {mismatchCount === 1 ? "it" : "them"}.
            </p>
          ) : null}
        </Field>
        <Field label="Expected delivery (optional)">
          <Input type="date" name="expected_date" />
        </Field>
        <Field label="Note to vendor (optional)" className="sm:col-span-2">
          <Textarea name="note" rows={2} placeholder="e.g. Please confirm availability and ship by Friday." />
        </Field>
      </div>

      <input type="hidden" name="lines" value={linesJson} />
      <input type="hidden" name="origin" value={origin} />
      {fromLeadId ? <input type="hidden" name="from_lead" value={fromLeadId} /> : null}

      {/* Sticky order bar: totals + category mix + actions stay in view */}
      <div className="sticky bottom-0 z-10 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] p-5 shadow-[var(--admin-shadow-lg)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[var(--admin-text-muted)]">
            <span className="font-semibold text-[var(--admin-text)]">{chosen.length}</span> line
            {chosen.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold text-[var(--admin-text)]">{totalUnits}</span> unit
            {totalUnits === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold text-[var(--admin-text)]">{money(total)}</span> total
          </div>
          {byCategory.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {byCategory.map(([cat, v]) => (
                <Badge key={cat} tone="neutral">
                  {titleCase(cat)}: {v.units} · {money(v.minor)}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" variant="neutral" formAction={createAction} disabled={chosen.length === 0}>
            Save as draft
          </Button>
          <Button
            type="submit"
            variant="save"
            formAction={sendAction}
            disabled={!canEmail}
            title={
              canEmail
                ? undefined
                : chosen.length === 0
                  ? "Add at least one line"
                  : !vendorId
                    ? "Select a vendor"
                    : "This vendor has no email on file"
            }
          >
            Save &amp; send to vendor
          </Button>
        </div>
      </div>
    </form>
  );
}
