import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import { getEndorsementConfig, medicalSummary, listExemptSales } from "@/lib/medical/store";

export const dynamic = "force-dynamic";

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function MedicalOverviewPage() {
  await requirePermission("medical.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Operations" }, { label: "Medical" }]} />
        <AdminPageHeader title="Medical cannabis" subtitle="Recognition cards & DOH compliance." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to manage medical." />
      </div>
    );
  }

  const [config, summary, exempt] = await Promise.all([
    getEndorsementConfig(),
    medicalSummary(),
    listExemptSales({ limit: 50 }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Operations" }, { label: "Medical" }]} />
      <AdminPageHeader
        title="Medical cannabis"
        subtitle="Recognition cards, DOH database (MCR) status, and excise-exempt sale records."
        action={
          <Link
            href="/admin/medical/intake"
            className="inline-flex items-center gap-2 rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            📇 New authorization intake
          </Link>
        }
        help={
          <HelpPanel
            id="medical-overview"
            title="How medical compliance works"
            steps={[
              "Verify the authorization form (complete/signed, tamper-resistant, identity, embossed seal).",
              "Issue a recognition card from the customer's profile; validate it in the MCR.",
              "Carded patients (in MCR) are sales-tax exempt on any cannabis at this endorsed store.",
              "DOH-compliant products (WAC 246-70-040) are ALSO 37% excise-exempt for carded patients.",
            ]}
          >
            <p>
              Every excise-exempt line is recorded with the unique patient identifier, card dates, SKU, and price,
              and retained five years per WAC 314-55-090(2). See the project doc for full source citations.
            </p>
          </HelpPanel>
        }
      />

      {/* Endorsement status */}
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Store medical endorsement</h2>
          {config?.isMedicallyEndorsed ? (
            <Badge tone="green">Endorsed</Badge>
          ) : (
            <Badge tone="danger">Not endorsed — exemptions disabled</Badge>
          )}
        </div>
        <p className="mt-2 text-xs text-white/50">
          {config?.endorsementNumber ? `Endorsement ${config.endorsementNumber}. ` : ""}
          37% excise exemption effective through {config?.exciseExemptionUntil ?? "2029-06-30"} (WAC
          314-55-090(6)).
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Medical patients" value={summary.patients.toLocaleString("en-US")} accent="gold" />
        <StatCard label="Active cards" value={summary.activeCards.toLocaleString("en-US")} accent="green" />
        <StatCard
          label="Excise exempted (recorded)"
          value={money(summary.exciseExemptedMinor)}
          hint="Lifetime"
          accent="muted"
        />
      </div>

      {/* Excise-exempt sale records (WAC 314-55-090(2)) */}
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">
          Excise-exempt sale records <span className="text-xs font-normal text-white/40">· WAC 314-55-090(2)</span>
        </h2>
        {exempt.length === 0 ? (
          <p className="text-sm text-white/50">No excise-exempt sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-white/40">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">UPID</th>
                  <th className="px-3 py-2 font-medium">Card dates</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Excise exempted</th>
                </tr>
              </thead>
              <tbody>
                {exempt.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--admin-border)]/50 last:border-0">
                    <td className="px-3 py-2 text-white/70">{r.sale_date}</td>
                    <td className="px-3 py-2 font-mono text-xs text-white/70">{r.unique_patient_identifier}</td>
                    <td className="px-3 py-2 text-xs text-white/50">
                      {r.card_effective_on ?? "—"} → {r.card_expires_on ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-white/70">{r.product_sku}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/70">{money(r.sales_price_minor)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--admin-green)]">
                      {money(r.excise_amount_exempt_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
