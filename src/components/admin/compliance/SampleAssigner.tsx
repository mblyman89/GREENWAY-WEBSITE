"use client";

/**
 * SampleAssigner — Task K (WAC 314-55-096, retailer TRADE samples)
 *
 * The owner's spec, verbatim: "There should be a table with the available
 * samples to select. I don't want a drop down to select the product. A table
 * will be easier to look at and select from. Assign the selected sample to the
 * employee, if the system says they are allowed to have it, mark/record it out
 * of the system in whatever way is the CCRS required way."
 *
 * So: a TABLE of accepted sample lots still on hand (radio row selection), and
 * a minimal form with ONLY what compliance requires:
 *   • employee (current paid — the list is active employees only)
 *   • units (validated against on-hand here; 30/qtr cap hard-enforced server-side)
 *   • date (drives the quarter key)
 *   • from-sample-jar flag (jar leftovers count toward the 30 [096(4)(d)(i)])
 *   • optional note
 * Product identity (name / lot / type / per-unit size) comes from the selected
 * row — nothing to re-type. A manual size field appears ONLY when the lot has
 * no unit weight on file (the 096(1)(e) size caps still must be checked).
 *
 * On success the server records the outgoing ledger row AND posts the negative
 * `employee_sample` inventory adjustment (CCRS reason "Other" + employee-named
 * detail — the LCB-confirmed reporting shape).
 */
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Field, Input, Select } from "@/components/admin/ui";
import { EmptyState, useToast } from "@/components/admin/ux";
import { assignSampleAction, type AssignSampleResult } from "@/app/admin/compliance/samples/actions";
import { PRODUCT_TYPE_LABELS } from "@/lib/compliance/trade-samples-core";
import type { AvailableSampleRow } from "@/lib/compliance/employee-sample-core";

export type EmployeeAllowanceOption = {
  id: string;
  name: string;
  /** Trade units already given to this employee this quarter. */
  used: number;
};

function unitSizeLabel(r: AvailableSampleRow): string {
  if (r.productType === "infused") return r.unitSizeMg != null ? `${r.unitSizeMg} mg` : "—";
  return r.unitSizeGrams != null ? `${r.unitSizeGrams} g` : "—";
}

export function SampleAssigner({
  rows,
  employees,
  tradeCap,
  today,
}: {
  rows: AvailableSampleRow[];
  employees: EmployeeAllowanceOption[];
  tradeCap: number;
  today: string; // Pacific YMD
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [unitCount, setUnitCount] = useState("1");
  const [ymd, setYmd] = useState(today);
  const [fromJar, setFromJar] = useState(false);
  const [note, setNote] = useState("");
  const [manualGrams, setManualGrams] = useState("");
  const [manualMg, setManualMg] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => rows.find((r) => r.lotId === selectedLotId) ?? null,
    [rows, selectedLotId],
  );
  const employee = useMemo(
    () => employees.find((e) => e.id === employeeId) ?? null,
    [employees, employeeId],
  );
  const remaining = employee ? Math.max(0, tradeCap - employee.used) : null;

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.productName.toLowerCase().includes(q) ||
        (r.strainName ?? "").toLowerCase().includes(q) ||
        (r.lotCode ?? "").toLowerCase().includes(q) ||
        (r.vendorLabel ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const needsManualSize =
    selected != null &&
    ((selected.productType === "infused" && selected.unitSizeMg == null) ||
      (selected.productType !== "infused" && selected.unitSizeGrams == null));

  function submit() {
    setErrors([]);
    setBlocked(null);
    if (!selected) {
      setErrors(["Select a sample from the table above."]);
      return;
    }
    start(async () => {
      const res: AssignSampleResult = await assignSampleAction({
        lotId: selected.lotId,
        employeeId,
        unitCount,
        ymd,
        fromSampleJar: fromJar,
        note,
        unitSizeGrams: needsManualSize && selected.productType !== "infused" ? manualGrams : undefined,
        unitSizeMg: needsManualSize && selected.productType === "infused" ? manualMg : undefined,
      });
      if (res.ok) {
        toast({ tone: "success", message: res.message || "Sample assigned and marked out of inventory." });
        if (res.adjustmentWarning) toast({ tone: "warning", message: res.adjustmentWarning, duration: 12000 });
        setSelectedLotId(null);
        setUnitCount("1");
        setFromJar(false);
        setNote("");
        setManualGrams("");
        setManualMg("");
      } else if (res.blocked) {
        setBlocked(res.error ?? "Blocked by the quarterly cap.");
      } else {
        setErrors(res.errors ?? [res.error ?? "Could not assign the sample."]);
      }
    });
  }

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Assign a sample to an employee</h3>
          <p className="text-xs text-white/40">
            Pick a sample from the table, choose the employee, and the system records it and marks it out of
            inventory the CCRS-required way. The 30 units/employee/quarter cap is enforced automatically.
          </p>
        </div>
        {rows.length > 5 ? (
          <div className="w-56">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search samples…"
              aria-label="Search available samples"
            />
          </div>
        ) : null}
      </div>

      {/* Available samples — TABLE selection (owner: no dropdown) */}
      {rows.length === 0 ? (
        <EmptyState
          title="No samples available to assign"
          description="Samples arrive through Receiving: accept a vendor manifest with sample lines and they will appear here, ready to hand to an employee."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--admin-border)]">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-white/50">
              <tr>
                <th className="w-10 px-3 py-2" aria-label="Select" />
                <th className="px-4 py-2">Sample product</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2 text-right">Unit size</th>
                <th className="px-4 py-2 text-right">On hand</th>
                <th className="px-4 py-2">Lot</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-white/40">
                    No samples match “{search}”.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const isSel = r.lotId === selectedLotId;
                  return (
                    <tr
                      key={r.lotId}
                      onClick={() => setSelectedLotId(r.lotId)}
                      className={`cursor-pointer border-t border-[var(--admin-border)] transition-colors ${
                        isSel ? "bg-[var(--admin-accent)]/10" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          name="sample-lot"
                          checked={isSel}
                          onChange={() => setSelectedLotId(r.lotId)}
                          aria-label={`Select ${r.productName}`}
                        />
                      </td>
                      <td className="px-4 py-2 text-white/90">
                        {r.productName}
                        {r.strainName ? <span className="text-white/40"> · {r.strainName}</span> : null}
                      </td>
                      <td className="px-4 py-2 text-white/60">{r.vendorLabel ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge tone="outline">{PRODUCT_TYPE_LABELS[r.productType]}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-white/70">{unitSizeLabel(r)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-white/90">
                        {r.onHandQty} {r.unit}
                      </td>
                      <td className="px-4 py-2 text-white/40">{r.lotCode ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Minimal assignment form — only what compliance requires */}
      {rows.length > 0 && (
        <div className="mt-4 space-y-4">
          {selected ? (
            <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
              Selected: <strong>{selected.productName}</strong>
              {selected.lotCode ? ` (lot ${selected.lotCode})` : ""} — {selected.onHandQty} unit(s) on hand.
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-white/40">
              Select a sample from the table to assign it.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee (current paid staff)">
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {Math.max(0, tradeCap - e.used)} of {tradeCap} left
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Units">
              <Input
                type="number"
                min={1}
                step={1}
                max={selected?.onHandQty}
                value={unitCount}
                onChange={(e) => setUnitCount(e.target.value)}
              />
            </Field>
            <Field label="Date given">
              <Input type="date" value={ymd} onChange={(e) => setYmd(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
            </Field>
          </div>

          {needsManualSize && selected ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {selected.productType === "infused" ? (
                <Field label="Per-unit size (mg) — this lot has no unit weight on file">
                  <Input type="number" min={0} step="any" value={manualMg} onChange={(e) => setManualMg(e.target.value)} />
                </Field>
              ) : (
                <Field label="Per-unit weight (g) — this lot has no unit weight on file">
                  <Input type="number" min={0} step="any" value={manualGrams} onChange={(e) => setManualGrams(e.target.value)} />
                </Field>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={fromJar} onChange={(e) => setFromJar(e.target.checked)} />
              From a sample jar (leftovers still count toward the 30-unit cap)
            </label>
          </div>

          {employee && remaining != null ? (
            <p className="text-xs text-white/40">
              {employee.name} has received <strong className="text-white/70">{employee.used}</strong> of{" "}
              {tradeCap} trade units this quarter — <strong className="text-white/70">{remaining}</strong>{" "}
              remaining. Over-cap assignments are blocked automatically.
            </p>
          ) : null}

          {blocked ? (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
              🚫 {blocked}
            </div>
          ) : null}
          {errors.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}

          <Button onClick={submit} disabled={pending || !selected}>
            {pending ? "Assigning…" : "Assign sample & mark out of inventory"}
          </Button>
        </div>
      )}
    </section>
  );
}
