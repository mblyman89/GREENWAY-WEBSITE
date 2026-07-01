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
import { buildCcrsInventoryAdjustmentCsv } from "@/lib/compliance/ccrs-inventory-adjustment";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";
import { verifyCcrsBatch, classifyWarning } from "@/lib/compliance/ccrs-batch-core";
import { assertCcrsBatchSubmittable } from "@/lib/compliance/ccrs-submit-gate-core";
import { isAiConfigured } from "@/lib/ai/provider";
import { CcrsAdvisorPanel } from "@/components/admin/reports/CcrsAdvisorPanel";
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
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
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
  const adjPreview = isSupabaseServiceConfigured
    ? await buildCcrsInventoryAdjustmentCsv(range.fromISO, range.toISO)
    : null;
  const batch = isSupabaseServiceConfigured ? await buildCcrsBatch(range.fromISO, range.toISO) : null;
  // Slice 95: fold the structural dry-run (verifyCcrsBatch) into the on-screen
  // report so the UI is as trustworthy as the downloaded README — a structural
  // problem (bad header, NumberRecords mismatch, invalid enum) shows as a
  // blocking error here, not just in the zip.
  const verification = batch
    ? verifyCcrsBatch(batch.files.map((f) => ({ type: f.type, csv: f.csv })))
    : null;
  // Slice 105 — use the SAME authoritative gate the export route enforces, so
  // the on-screen verdict and the download button agree exactly. This also folds
  // in per-file ERROR-prefixed warnings (classified with classifyWarning), which
  // the previous on-screen roll-up missed.
  const verdict = batch
    ? assertCcrsBatchSubmittable({
        syncIssues: batch.syncIssues.map((s) => ({
          severity: s.severity,
          file: String(s.file),
          message: s.message,
          count: s.count,
        })),
        verifierProblems: (verification?.problems ?? []).map((p) => ({
          severity: p.severity,
          file: String(p.file),
          message: p.message,
        })),
        files: batch.files.map((f) => ({ type: f.type, warnings: f.warnings, empty: f.empty })),
        classifyWarning,
      })
    : null;
  const batchErrors = verdict?.errors ?? [];
  const batchWarnings = verdict?.warnings ?? [];
  const batchSubmittable = verdict?.submittable ?? false;

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

      {/* Full batch generator + sync report (Slice 54) */}
      <Section
        title="Full CCRS batch"
        subtitle="Generates every file a retailer must report — Strain, Area, Product, Inventory, InventoryAdjustment, InventoryTransfer, Sale — in the exact upload order, as one .zip."
      >
        {batch ? (
          <>
            {/* Sync / data-integrity report */}
            {batchErrors.length > 0 ? (
              <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/[0.07] p-4">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-red-300">
                  Out of sync — fix before uploading
                </p>
                <ul className="space-y-1 text-xs text-red-100/90">
                  {batchErrors.map((s, i) => (
                    <li key={i}>
                      • <span className="font-bold">{s.file}</span>: {s.message}
                      {s.count ? ` (${s.count})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mb-3 rounded-xl border border-[#7ed957]/25 bg-[#7ed957]/[0.05] p-3 text-xs text-[#9be870]">
                ✓ No blocking sync issues detected — every file’s dependencies resolve.
              </div>
            )}

            {batchWarnings.length > 0 ? (
              <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-orange-500/25 bg-orange-500/[0.05] p-3 text-xs text-orange-100/80">
                {batchWarnings.slice(0, 30).map((s, i) => (
                  <li key={i}>
                    • <span className="font-bold">{s.file}</span>: {s.message}
                    {s.count ? ` (${s.count})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Per-file record counts, grouped by upload order */}
            <div className="mb-4 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03] text-left text-[0.68rem] font-black uppercase tracking-[0.08em] text-white/50">
                    <th className="px-4 py-2.5">Group</th>
                    <th className="px-4 py-2.5">File</th>
                    <th className="px-4 py-2.5 text-right">Records</th>
                    <th className="px-4 py-2.5 text-right">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.files.map((f) => (
                    <tr key={f.type} className="border-b border-white/5">
                      <td className="px-4 py-2 text-white/40">{f.group}</td>
                      <td className="px-4 py-2 font-mono text-xs text-white/80">{f.type}.csv</td>
                      <td className="px-4 py-2 text-right tabular-nums text-white/80">
                        {f.recordCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-white/40">
                        {f.skipped ? f.skipped.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10 bg-white/[0.02] font-bold">
                    <td className="px-4 py-2 text-white/50" colSpan={2}>
                      Total records
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-white/90">
                      {batch.totalRecords.toLocaleString()}
                    </td>
                    <td className="px-4 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                {batchSubmittable ? (
                  <>
                    <Link
                      href={`/admin/reports/compliance/batch-export?${qs}`}
                      prefetch={false}
                      className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
                    >
                      ⬇ Download full CCRS batch (.zip)
                    </Link>
                    <span className="text-xs text-white/40">
                      Files are numbered by upload group and include a README with the exact upload order.
                    </span>
                  </>
                ) : (
                  <>
                    {/* Slice 105 — the export is HARD-BLOCKED until every blocking
                        error is resolved. The button is disabled so a malformed
                        batch can't be generated by accident. */}
                    <span
                      aria-disabled="true"
                      className="cursor-not-allowed rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white/40"
                    >
                      ⛔ Download blocked — {batchErrors.length} error(s) to fix
                    </span>
                    <span className="text-xs text-[var(--admin-danger)]">
                      Fix the blocking errors listed below, then the download will unlock. The batch is not generated
                      while errors remain, so you can never upload a bad file.
                    </span>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-white/40">
                Generating the batch requires the “Change settings” permission. Ask an admin to download it.
              </p>
            )}

            <p className="mt-3 text-xs leading-relaxed text-white/40">
              Automated integrator uploads (SFTP) run under the LCB-issued integrator credentials — the same generated
              files. Until integrator credentials are configured, an authorized employee uploads the batch at{" "}
              <span className="text-white/60">cannabisreporting.lcb.wa.gov</span>. These are drafts: review the figures
              and the sync report above before uploading.
            </p>
          </>
        ) : (
          <p className="text-xs text-white/40">Connect Supabase to generate the CCRS batch.</p>
        )}
      </Section>

      {/* AI advisor (drafts-only, grounded in the batch summary + sync report) */}
      {batch ? <CcrsAdvisorPanel aiEnabled={isAiConfigured} sp={sp} /> : null}

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

      {/* InventoryAdjustment.csv */}
      <Section
        title="Generate CCRS InventoryAdjustment.csv"
        subtitle="Reports shrink, damage, destruction, recalls, samples & cycle-count reconciliations for the range."
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Adjustment lines in range"
            value={(adjPreview?.recordCount ?? 0).toLocaleString()}
            accent="green"
          />
          <StatCard label="Skipped (e.g. receives)" value={(adjPreview?.skipped ?? 0).toLocaleString()} accent="muted" />
        </div>
        {adjPreview && adjPreview.warnings.length > 0 ? (
          <ul className="mb-3 space-y-1 rounded-xl border border-orange-500/30 bg-orange-500/[0.06] p-3 text-xs text-orange-100/80">
            {adjPreview.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/reports/compliance/adjustment-export?${qs}`}
              prefetch={false}
              className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90"
            >
              ⬇ Download CCRS InventoryAdjustment.csv
            </Link>
            <span className="text-xs text-white/40">
              Reasons map to CCRS values: count→<code className="text-white/60">Reconciliation</code>, shrink/damage→
              <code className="text-white/60">Lost</code>, destruction/recall→<code className="text-white/60">Destruction</code>,
              sample→<code className="text-white/60">ReturnedLabSample</code>.
            </span>
          </div>
        ) : (
          <p className="text-xs text-white/40">
            Generating the regulatory file requires the “Change settings” permission.
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
