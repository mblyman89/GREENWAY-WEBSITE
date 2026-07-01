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
  quarterKeyFromYmd,
  quarterLabel,
  capTone,
  PRODUCT_TYPE_LABELS,
  WAC_CITATION,
  type SampleProductType,
} from "@/lib/compliance/trade-samples";
import { pacificToday } from "@/lib/reports/timezone";
import { SampleRecorder, type EmployeeOption } from "@/components/admin/compliance/SampleRecorder";
import { updateSampleSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

function toneBadge(used: number, cap: number) {
  const t = capTone(used, cap);
  const map = { green: "green", amber: "orange", red: "danger" } as const;
  return <Badge tone={map[t]}>{used} / {cap}</Badge>;
}

function bar(used: number, cap: number) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const t = capTone(used, cap);
  const color = t === "red" ? "#ef4444" : t === "amber" ? "#f59e0b" : "#7ed957";
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

  const [employees, usage, recent] = await Promise.all([
    listEmployees(),
    quarterUsage(quarter, settings),
    listSampleEvents(quarter, 50),
  ]);

  const empOptions: EmployeeOption[] = employees.map((e) => ({ id: e.id, name: e.full_name }));
  const totalIncoming = usage.incomingByProcessor.reduce((s, r) => s + r.used, 0);
  const totalOutgoing = usage.outgoingByEmployee.reduce((s, r) => s + r.used, 0);
  const anyOver =
    usage.incomingByProcessor.some((r) => r.used > r.cap) || usage.outgoingByEmployee.some((r) => r.used > r.cap);

  return (
    <div>
      <AdminPageHeader
        title="Trade samples"
        subtitle={`WSLCB trade-sample limits enforced as hard blocks — ${WAC_CITATION}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Trade samples" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="trade-samples"
            title="How trade-sample limits work"
            steps={[
              "Record every sample coming IN from a processor and every sample going OUT to an employee.",
              "Incoming is capped at 120 units per processor per calendar quarter.",
              "Outgoing is capped at 30 units per employee per quarter (sample-jar leftovers count too).",
              "Each unit must be within the size caps: 3.5 g flower / 1 g concentrate / 100 mg infused (≤10 mg THC/serving).",
              "Free samples to CUSTOMERS are prohibited — there is no way to record one here.",
            ]}
          >
            <p>Over-cap events are blocked automatically. All events are logged to the audit trail. Source: {WAC_CITATION}.</p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {ok && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">Saved.</div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(error)}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Quarter" value={quarterLabel(quarter)} accent="gold" />
          <StatCard label="Incoming units" value={totalIncoming} accent="muted" />
          <StatCard label="Outgoing units" value={totalOutgoing} accent="muted" />
          <StatCard label="Enforcement" value={settings.enforce ? (settings.hardBlock ? "Hard block" : "Warn only") : "Off"} accent={settings.enforce && settings.hardBlock ? "green" : "muted"} />
        </div>

        {anyOver && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300">
            🚫 One or more caps are at or over the limit this quarter. Review below.
          </div>
        )}

        {/* No-customer notice */}
        <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-xs text-white/60">
          <strong className="text-white/80">Customers:</strong> Washington retailers may not provide free samples to customers ({WAC_CITATION}, §096(2)). This module has no customer path by design.
        </div>

        <SampleRecorder employees={empOptions} today={today} />

        {/* Insight: incoming per processor */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Incoming this quarter — cap {settings.incomingUnitsPerQuarter}/processor</h3>
          {usage.incomingByProcessor.length === 0 ? (
            <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">No incoming samples recorded this quarter.</p>
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

        {/* Insight: outgoing per employee */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Outgoing this quarter — cap {settings.outgoingUnitsPerEmployee}/employee</h3>
          {usage.outgoingByEmployee.length === 0 ? (
            <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">No outgoing samples recorded this quarter.</p>
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

        {/* Recent ledger */}
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
                    <th className="px-4 py-2">Units</th>
                    <th className="px-4 py-2">To / From</th>
                    <th className="px-4 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-4 py-2">
                        <Badge tone={e.direction === "incoming" ? "outline" : "gold"}>{e.direction}</Badge>
                      </td>
                      <td className="px-4 py-2 text-white/80">{PRODUCT_TYPE_LABELS[e.product_type as SampleProductType]}</td>
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Incoming units / quarter (per processor)">
                  <Input type="number" name="incoming_units_per_quarter" min={0} step={1} defaultValue={settings.incomingUnitsPerQuarter} />
                </Field>
                <Field label="Outgoing units / quarter (per employee)">
                  <Input type="number" name="outgoing_units_per_employee" min={0} step={1} defaultValue={settings.outgoingUnitsPerEmployee} />
                </Field>
                <Field label="Max flower grams / unit">
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
