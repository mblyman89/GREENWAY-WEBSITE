import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Card, Field, Input, Textarea, Badge } from "@/components/admin/ui";
import { listEmployees } from "@/lib/staffing/store";
import {
  getSampleSettings,
  quarterUsage,
  listSampleEvents,
  listAvailableSampleLots,
  quarterKeyFromYmd,
  quarterLabel,
  capTone,
  PRODUCT_TYPE_LABELS,
  WAC_CITATION,
  type SampleProductType,
} from "@/lib/compliance/trade-samples";
import { buildAvailableSampleRows } from "@/lib/compliance/employee-sample-core";
import { pacificToday } from "@/lib/reports/timezone";
import { SampleAssigner, type EmployeeAllowanceOption } from "@/components/admin/compliance/SampleAssigner";
import { updateSampleSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Employee Samples — Task K rebuild (WAC 314-55-096, WSR 25-08-032).
 *
 * Exactly what a WA retailer needs to stay compliant, and nothing else:
 *   • INCOMING (processor → retailer, ≤120 units/qtr/processor) is handled at
 *     RECEIVING: manifest sample lines are hard-capped at finalize and
 *     auto-recorded to the ledger. This page shows that intake usage READ-ONLY —
 *     there is nothing to type here.
 *   • OUTGOING (retailer → current paid employee, ≤30 units/qtr/employee) is
 *     THIS page's job: pick an accepted sample from the table, assign it, and
 *     the system logs amount + product type + employee name [096(1)(j)(iv)-(v)],
 *     hard-blocks over-cap, and marks the units out of inventory via an
 *     `employee_sample` adjustment that exports to CCRS as reason "Other" with
 *     a detail naming the employee (the LCB-confirmed reporting shape).
 *   • The JSON upload is gone — samples flow in via email-intake receiving.
 */
function toneBadge(used: number, cap: number) {
  const t = capTone(used, cap);
  const map = { green: "green", amber: "orange", red: "danger" } as const;
  return <Badge tone={map[t]}>{used} / {cap}</Badge>;
}

function bar(used: number, cap: number) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const t = capTone(used, cap);
  const color = t === "red" ? "#ef4444" : t === "amber" ? "#f59e0b" : "var(--admin-accent)";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requirePermission("settings.manage");
  const isOwner = isOwnerRole(session.profile.role);
  const { ok, error } = await searchParams;

  const today = pacificToday();
  const quarter = quarterKeyFromYmd(today);
  const settings = await getSampleSettings();

  const [employees, usage, recent, lots] = await Promise.all([
    listEmployees(),
    quarterUsage(quarter, settings),
    listSampleEvents({ quarterKey: quarter, limit: 50 }),
    listAvailableSampleLots(),
  ]);

  const { rows: availableRows } = buildAvailableSampleRows(lots);
  const availableUnits = availableRows.reduce((s, r) => s + r.onHandQty, 0);

  // Active employees with their quarter usage (drives the remaining-allowance
  // display in the assigner; the server re-checks and hard-blocks regardless).
  const usedByEmployee = new Map(
    usage.outgoingByEmployee.filter((r) => r.employeeId).map((r) => [r.employeeId as string, r.used]),
  );
  const empOptions: EmployeeAllowanceOption[] = employees.map((e) => ({
    id: e.id,
    name: e.full_name,
    used: usedByEmployee.get(e.id) ?? 0,
  }));

  const totalOutgoing = usage.outgoingByEmployee.reduce((s, r) => s + r.used, 0);
  const anyOver =
    usage.incomingByProcessor.some((r) => r.used > r.cap) ||
    usage.outgoingByEmployee.some((r) => r.used > r.cap);

  return (
    <div>
      <AdminPageHeader
        title="Employee samples"
        subtitle={`Assign trade samples to paid employees — limits enforced automatically (${WAC_CITATION})`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Employee samples" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="trade-samples"
            title="How employee samples work"
            steps={[
              "Samples ARRIVE through Receiving: accept a vendor manifest with sample lines and they appear in the table below. Intake is capped at 120 units per processor per quarter and blocked automatically at receiving — nothing to record here.",
              "To GIVE a sample: select it in the table, pick the employee, and assign. The system logs the amount, product type, and employee name, and marks the units out of inventory the CCRS-required way (an inventory adjustment naming the employee).",
              "Each employee may receive at most 30 units per calendar quarter — over-cap assignments are hard-blocked. Sample-jar leftovers count toward the 30.",
              "Per-unit sizes are enforced from the lot: 3.5 g useable / 1 g concentrate / 100 mg infused (≤10 mg THC per serving).",
              "Samples go only to CURRENT PAID employees — never to customers, and never as compensation or a reward. There is no way to record a customer sample by design.",
            ]}
          >
            <p>
              Every assignment is written to the sample ledger and the audit trail, and the inventory adjustment
              exports to CCRS InventoryAdjustment.csv. Source: {WAC_CITATION}.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {ok && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">Saved.</div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(error)}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Quarter" value={quarterLabel(quarter)} accent="gold" />
          <StatCard label="Samples on hand" value={availableUnits} accent="green" />
          <StatCard label="Given to employees" value={totalOutgoing} accent="muted" />
          <StatCard
            label="Enforcement"
            value={settings.enforce ? (settings.hardBlock ? "Hard block" : "Warn only") : "Off"}
            accent={settings.enforce && settings.hardBlock ? "green" : "muted"}
          />
        </div>

        {anyOver && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
            🚫 One or more caps are at or over the limit this quarter. Review below.
          </div>
        )}

        {/* THE page: table of available samples + minimal compliant assignment form */}
        <SampleAssigner
          rows={availableRows}
          employees={empOptions}
          tradeCap={settings.outgoingUnitsPerEmployee}
          today={today}
        />

        {/* Per-employee usage vs the 30-cap (the "not more than they're allowed" check) */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Given out this quarter — cap {settings.outgoingUnitsPerEmployee}/employee
            </h3>
            <Link
              href="/admin/compliance/samples/history"
              className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
            >
              Full sample history →
            </Link>
          </div>
          {usage.outgoingByEmployee.length === 0 ? (
            <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">
              No samples given to employees yet this quarter.
            </p>
          ) : (
            <div className="space-y-3">
              {usage.outgoingByEmployee.map((r) => (
                <div key={r.employeeId ?? r.name} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold text-white">{r.name}</span>
                    {toneBadge(r.used, r.cap)}
                  </div>
                  {bar(r.used, r.cap)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* READ-ONLY intake usage (the "not more than we're allowed to take in" check).
            Recording happens automatically at Receiving; the 120/qtr cap is hard-blocked there. */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-white">
            Received this quarter — cap {settings.incomingUnitsPerQuarter}/processor
          </h3>
          <p className="mb-3 text-xs text-white/40">
            Tracked automatically when you accept a manifest with sample lines in{" "}
            <Link href="/admin/inventory/intake" className="text-[var(--admin-accent)] hover:underline">
              Receiving
            </Link>{" "}
            — deliveries that would exceed a processor&apos;s quarterly cap are blocked there. Nothing to record here.
          </p>
          {usage.incomingByProcessor.length === 0 ? (
            <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">
              No samples received this quarter.
            </p>
          ) : (
            <div className="space-y-3">
              {usage.incomingByProcessor.map((r) => (
                <div key={r.name} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold text-white">{r.name}</span>
                    {toneBadge(r.used, r.cap)}
                  </div>
                  {bar(r.used, r.cap)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent ledger (this quarter) */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Recent events this quarter</h3>
          {recent.length === 0 ? (
            <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">No events yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--admin-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-4 py-2">Direction</th>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Sample product / lot</th>
                    <th className="px-4 py-2">Units</th>
                    <th className="px-4 py-2">To / From</th>
                    <th className="px-4 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-4 py-2">
                        <Badge tone={e.direction === "incoming" ? "outline" : "gold"}>
                          {e.direction === "incoming" ? "received" : "given out"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-white/80">{PRODUCT_TYPE_LABELS[e.product_type as SampleProductType]}</td>
                      <td className="px-4 py-2 text-white/60">
                        {e.direction === "outgoing"
                          ? e.source_product_name
                            ? `${e.source_product_name}${e.source_lot_ref ? ` — lot ${e.source_lot_ref}` : ""}`
                            : "—"
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-white/80">{e.unit_count}{e.from_sample_jar ? " (jar)" : ""}</td>
                      <td className="px-4 py-2 text-white/60">{e.direction === "incoming" ? e.processor_name ?? "—" : e.employee_name ?? "—"}</td>
                      <td className="px-4 py-2 text-white/40">{new Date(e.created_at).toLocaleDateString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Owner settings */}
        {isOwner && (
          <Card>
            <h3 className="mb-1 text-sm font-semibold text-white">Sample settings (owner)</h3>
            <p className="mb-4 text-xs text-white/40">Defaults match {WAC_CITATION}. Only lower these below the statutory maximums; do not raise them above the law.</p>
            <form action={updateSampleSettingsAction} className="space-y-4">
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" name="enforce" defaultChecked={settings.enforce} /> Enforce limits
                </label>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" name="hard_block" defaultChecked={settings.hardBlock} /> Hard block over-cap events
                </label>
              </div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Trade samples</h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Incoming units / quarter (per processor)">
                  <Input type="number" name="incoming_units_per_quarter" min={0} step={1} defaultValue={settings.incomingUnitsPerQuarter} />
                </Field>
                <Field label="Outgoing units / quarter (per employee)">
                  <Input type="number" name="outgoing_units_per_employee" min={0} step={1} defaultValue={settings.outgoingUnitsPerEmployee} />
                </Field>
                <Field label="Max flower/useable grams / unit">
                  <Input type="number" name="max_flower_grams" min={0} step="any" defaultValue={settings.maxFlowerGrams} />
                </Field>
                <Field label="Max concentrate grams / unit">
                  <Input type="number" name="max_concentrate_grams" min={0} step="any" defaultValue={settings.maxConcentrateGrams} />
                </Field>
                <Field label="Max infused mg / unit">
                  <Input type="number" name="max_infused_mg" min={0} step="any" defaultValue={settings.maxInfusedMg} />
                </Field>
                <Field label="Max THC mg / serving">
                  <Input type="number" name="max_thc_mg_per_serving" min={0} step="any" defaultValue={settings.maxThcMgPerServing} />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea name="notes" rows={2} defaultValue={settings.notes ?? ""} />
              </Field>
              <Button type="submit">Save settings</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
