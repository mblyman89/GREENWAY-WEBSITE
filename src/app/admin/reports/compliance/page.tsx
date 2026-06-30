/**
 * src/app/admin/reports/compliance/page.tsx  (Run 4 / Slice 17)
 *
 * The "Compliance (CCRS)" tab. Generate the WSLCB CCRS Sale.csv for a date
 * range, with the license identity editor and a pre-flight preview (record
 * count + validation warnings) before download.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { LicenseSettingsForm } from "@/components/admin/reports/LicenseSettingsForm";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsSaleCsv, getCcrsLicenseSettings } from "@/lib/compliance/ccrs-sales";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}) {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const sp = await searchParams;
  const range = resolveRange(sp);
  const qs = `from=${range.fromISO.slice(0, 10)}&to=${range.toISO.slice(0, 10)}`;

  const license = await getCcrsLicenseSettings();
  const preview = isSupabaseServiceConfigured
    ? await buildCcrsSaleCsv(range.fromISO, range.toISO)
    : null;

  // Recent export batches.
  let recentBatches: { file_name: string; record_count: number; created_at: string }[] = [];
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from("ccrs_export_batches")
        .select("file_name, record_count, created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      recentBatches = (data as typeof recentBatches | null) ?? [];
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-5">
      <DateRangePicker />

      {/* What is this */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-3 text-xs leading-relaxed text-white/50">
        CCRS is the WSLCB Cannabis Central Reporting System. It accepts a weekly{" "}
        <span className="font-bold text-white/80">Sale.csv</span> upload (no API). This tool builds that file from your
        completed orders with the required fields — 37% cannabis excise, combined 9.3% retail sales tax, per-line sale
        identifiers, and the <code className="text-white/70">Insert</code> operation. Reporting weeks run Sun–Sat and
        are due the following Sunday. Always review the draft figures before uploading.
      </div>

      {/* Preview KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Sale lines in range" value={(preview?.recordCount ?? 0).toLocaleString()} accent="green" />
        <StatCard
          label="License number"
          value={license.licenseNumber || "Not set"}
          accent={license.licenseNumber ? "muted" : "orange"}
        />
        <StatCard label="Skipped lines" value={(preview?.skipped ?? 0).toLocaleString()} accent="muted" />
      </div>

      {/* Warnings */}
      {preview && preview.warnings.length > 0 ? (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-4">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-orange-300">Review before uploading</p>
          <ul className="space-y-1 text-xs text-orange-100/80">
            {preview.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Generate */}
      <Section title="Generate CCRS Sale.csv" subtitle="Downloads the exact file CCRS expects for the selected range.">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/reports/compliance/export?${qs}`}
              prefetch={false}
              className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
            >
              ⬇ Download CCRS Sale.csv
            </Link>
            <span className="text-xs text-white/40">
              File name will be <code className="text-white/60">{preview?.fileName ?? "sale_LICENSE_…csv"}</code>
            </span>
          </div>
        ) : (
          <p className="text-xs text-white/40">
            Generating the regulatory file requires the “Change settings” permission. Ask an admin to download it.
          </p>
        )}
      </Section>

      {/* License identity */}
      <Section
        title="License identity"
        subtitle="Used in the file header (SubmittedBy) and on every row (LicenseNumber / CreatedBy)."
      >
        <LicenseSettingsForm
          licenseNumber={license.licenseNumber}
          submittedBy={license.submittedBy}
          tradeName=""
          canEdit={canEdit}
        />
      </Section>

      {/* Recent exports */}
      {recentBatches.length > 0 ? (
        <Section title="Recent CCRS exports">
          <ul className="divide-y divide-white/5 text-sm">
            {recentBatches.map((b) => (
              <li key={b.file_name + b.created_at} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs text-white/70">{b.file_name}</span>
                <span className="text-xs text-white/40">
                  {b.record_count} lines · {new Date(b.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
