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
  listSampleImports,
  quarterKeyFromYmd,
  quarterLabel,
  capTone,
  PRODUCT_TYPE_LABELS,
  CATEGORY_LABELS,
  WAC_CITATION,
  type SampleCategory,
  type SampleProductType,
} from "@/lib/compliance/trade-samples";
import { pacificToday } from "@/lib/reports/timezone";
import { SampleRecorder, type EmployeeOption } from "@/components/admin/compliance/SampleRecorder";
import { SampleImportUploader } from "@/components/admin/compliance/SampleImportUploader";
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

  const [employees, usage, recent, imports] = await Promise.all([
    listEmployees(),
    quarterUsage(quarter, settings),
    listSampleEvents({ quarterKey: quarter, limit: 50 }),
    listSampleImports(10),
  ]);

  const empOptions: EmployeeOption[] = employees.map((e) => ({ id: e.id, name: e.full_name }));
  const totalIncoming = usage.incomingByProcessor.reduce((s, r) => s + r.used, 0);
  const totalOutgoing = usage.outgoingByEmployee.reduce((s, r) => s + r.used, 0);
  const totalIqc = usage.iqcByEmployee.reduce((s, r) => s + r.used, 0);
  const anyOver =
    usage.incomingByProcessor.some((r) => r.used > r.cap) ||
    usage.outgoingByEmployee.some((r) => r.used > r.cap) ||
    usage.iqcByEmployee.some((r) => r.used > r.cap || r.concentrate > r.concentrateCap);

  return (
    <div>
      <AdminPageHeader
        title="Trade & IQC samples"
        subtitle={`WSLCB sample limits enforced as hard blocks — ${WAC_CITATION}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Samples" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="trade-samples"
            title="How sample limits work"
            steps={[
              "TRADE: record every sample coming IN from a processor and every sample going OUT to an employee.",
              "TRADE incoming is capped at 120 units per processor per calendar quarter; outgoing at 30 units per employee (sample-jar leftovers count).",
              "IQC (internal quality control) is a SEPARATE per-employee bucket: 50 units/quarter with a 25 concentrate sub-cap. This is where the purchasing manager's product-evaluation samples go — it is not unlimited.",
              "Per-unit sizes: TRADE 3.5 g useable / 1 g concentrate / 100 mg infused (≤10 mg THC); IQC 1 g flower / 1 g useable / 1 g concentrate / 10 mg THC infused.",
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Quarter" value={quarterLabel(quarter)} accent="gold" />
          <StatCard label="Trade in" value={totalIncoming} accent="muted" />
          <StatCard label="Trade out" value={totalOutgoing} accent="muted" />
          <StatCard label="IQC assigned" value={totalIqc} accent="muted" />
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
          <br />
          <strong className="text-white/80">Purchasing manager:</strong> there is no unlimited sample category and no job-title exemption. His product-evaluation samples are the IQC bucket — a larger (50-unit) but still-capped allowance, assigned to him below like any other employee.
        </div>

        <SampleRecorder employees={empOptions} today={today} />

        <SampleImportUploader />

        {/* Recent imports */}
        {imports.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">Recent JSON imports</h3>
            <div className="overflow-x-auto rounded-lg border border-[var(--admin-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-4 py-2">File</th>
                    <th className="px-4 py-2">Lots</th>
                    <th className="px-4 py-2">Units</th>
                    <th className="px-4 py-2">Notes</th>
                    <th className="px-4 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((im) => (
                    <tr key={im.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-4 py-2 text-white/80">{im.file_name ?? "(pasted)"}</td>
                      <td className="px-4 py-2 text-white/60">{im.lot_count}</td>
                      <td className="px-4 py-2 text-white/60">{im.unit_count}</td>
                      <td className="px-4 py-2 text-white/40">{im.notes ?? "—"}</td>
                      <td className="px-4 py-2 text-white/40">{new Date(im.created_at).toLocaleDateString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Insight: incoming per processor */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Trade incoming this quarter — cap {settings.incomingUnitsPerQuarter}/processor</h3>
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

        {/* Insight: TRADE outgoing per employee */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Trade outgoing this quarter — cap {settings.outgoingUnitsPerEmployee}/employee</h3>
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

        {/* Insight: IQC per employee (dual bucket: total + concentrate sub-cap) */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-white">IQC this quarter — cap {settings.iqcUnitsPerEmployee}/employee ({settings.iqcConcentrateSubcap} concentrate)</h3>
          <p className="mb-3 text-xs text-white/40">Internal quality control — the purchasing manager&apos;s (and any employee&apos;s) product-evaluation bucket. Blocks at 50 total or 25 concentrate. §096(3).</p>
          {usage.iqcByEmployee.length === 0 ? (
            <p className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-white/40">No IQC samples assigned this quarter.</p>
          ) : (
            <div className="space-y-3">
              {usage.iqcByEmployee.map((r) => (
                <div key={r.employeeId ?? r.name} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold text-white">{r.name}</span>
                    {toneBadge(r.used, r.cap)}
                  </div>
                  {bar(r.used, r.cap)}
                  <div className="mt-2 flex items-center justify-between text-xs text-white/50">
                    <span>Concentrate sub-cap</span>
                    {toneBadge(r.concentrate, r.concentrateCap)}
                  </div>
                  <div className="mt-1">{bar(r.concentrate, r.concentrateCap)}</div>
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
                    <th className="px-4 py-2">Category</th>
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
                        <Badge tone={e.category === "iqc" ? "gold" : "neutral"}>{CATEGORY_LABELS[e.category as SampleCategory] ?? e.category}</Badge>
                      </td>
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
            <p className="mb-4 text-xs text-white/40">Defaults match {WAC_CITATION}. Only lower these below the statutory maximums; do not raise them above the law. IQC caps are clamped to the statutory 50 / 25 ceilings.</p>
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
              <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">Internal quality control (IQC)</h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="IQC units / quarter (per employee, ≤ 50)">
                  <Input type="number" name="iqc_units_per_employee" min={0} max={50} step={1} defaultValue={settings.iqcUnitsPerEmployee} />
                </Field>
                <Field label="IQC concentrate sub-cap (≤ 25)">
                  <Input type="number" name="iqc_concentrate_subcap" min={0} max={25} step={1} defaultValue={settings.iqcConcentrateSubcap} />
                </Field>
                <Field label="IQC max flower g / unit (≤ 1)">
                  <Input type="number" name="iqc_max_flower_grams" min={0} max={1} step="any" defaultValue={settings.iqcMaxFlowerGrams} />
                </Field>
                <Field label="IQC max useable g / unit (≤ 1)">
                  <Input type="number" name="iqc_max_useable_grams" min={0} max={1} step="any" defaultValue={settings.iqcMaxUseableGrams} />
                </Field>
                <Field label="IQC max concentrate g / unit (≤ 1)">
                  <Input type="number" name="iqc_max_concentrate_grams" min={0} max={1} step="any" defaultValue={settings.iqcMaxConcentrateGrams} />
                </Field>
                <Field label="IQC max THC mg infused / unit (≤ 10)">
                  <Input type="number" name="iqc_max_infused_thc_mg" min={0} max={10} step="any" defaultValue={settings.iqcMaxInfusedThcMg} />
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
