import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { getImport } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCoverage } from "@/lib/pos/cultivera-coverage-store";
import { COVERAGE_SOURCES, COVERAGE_SOURCE_TEXT, coverageFilterFromParams, filterCoverage } from "@/lib/pos/cultivera-coverage-core";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rows shown on the page; the spreadsheet always has every (filtered) row. */
const SHOW = 300;

/**
 * R74 S8 — where each Cultivera lot's manifest comes from, lot by lot, BEFORE anything moves:
 * a real Cultivera transfer, a manifest found in the stephen@ email harvest, or the one
 * "Unmatched Cultivera stock" manifest; and whether Cultivera's Received date is blank (owner #5:
 * "does not exist", CCRS clean-up). Read-only.
 */
export default async function ImportCoveragePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string; vendor?: string; undated?: string; back?: string }>;
}) {
  await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await getImport(id);
  if (!imp) notFound();

  const load = await loadCoverage(createSupabaseAdminClient(), id);
  const filter = coverageFilterFromParams((k) => (sp as Record<string, string | undefined>)[k] ?? null);
  const rows = load.ok ? filterCoverage(load.report.rows, filter) : [];
  const qs = new URLSearchParams();
  if (filter.source) qs.set("source", filter.source);
  if (filter.vendor) qs.set("vendor", filter.vendor);
  if (filter.undatedOnly) qs.set("undated", "1");
  const csvHref = `/admin/menu-imports/${id}/coverage/csv${qs.toString() ? `?${qs}` : ""}`;
  const href = (p: Partial<{ source: string | null; vendor: string | null; undated: boolean }>) => {
    const q = new URLSearchParams();
    const source = p.source !== undefined ? p.source : filter.source;
    const vendor = p.vendor !== undefined ? p.vendor : filter.vendor;
    const undated = p.undated !== undefined ? p.undated : filter.undatedOnly;
    if (source) q.set("source", source);
    if (vendor) q.set("vendor", vendor);
    if (undated) q.set("undated", "1");
    return `/admin/menu-imports/${id}/coverage${q.toString() ? `?${q}` : ""}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Where each lot's manifest comes from"
        subtitle={`Import ${formatDateTime(imp.created_at)} · Cultivera transfer, email, or the unmatched manifest`}
        action={
          <BackLink
            fallback={`/admin/menu-imports/${id}/manifests`}
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Rebuild manifests
          </BackLink>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <p className="max-w-3xl text-xs text-white/50">
          Every Cultivera lot of this import, and the manifest it will sit on. First Cultivera&apos;s own transfer records
          are used. For the lots they cannot place, the vendor files kept by the email harvest (Menu imports → Vendor
          mailbox) are matched by barcode. A lot on two or more emailed manifests is never guessed. Whatever neither finds
          goes on the one &quot;Unmatched Cultivera stock&quot; manifest. Nothing on this page changes anything.
        </p>
        {!load.ok && <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200" data-testid="coverage-error">{load.error}</div>}
        {load.ok && (
          <>
            <p
              className={`rounded-lg border px-4 py-3 text-sm ${load.report.complete ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]" : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]"}`}
              data-testid="coverage-line"
            >
              {load.report.line}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Cultivera transfer" value={load.report.counts.transfer} hint="real manifest number from Cultivera" accent="green" />
              <StatCard label="Found in email" value={load.report.counts.email} hint={`${load.report.documentsUsed} of ${load.report.documents} harvested documents used`} accent="orange" />
              <StatCard label="Unmatched" value={load.report.counts.unmatched + load.report.counts.several_emails} hint={`${load.report.counts.several_emails} on several emails (not guessed)`} accent="gold" />
              <StatCard label="No received date" value={load.report.counts.noReceivedDate} hint="CCRS clean-up (owner rule)" accent="muted" />
            </div>

            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="coverage-vendors">
              <h2 className="text-sm font-semibold text-white">By vendor (most unmatched first)</h2>
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-white/40">
                  <tr>
                    <th className="py-1">Vendor</th>
                    <th className="py-1 text-right">Lots</th>
                    <th className="py-1 text-right">Transfer</th>
                    <th className="py-1 text-right">Email</th>
                    <th className="py-1 text-right">Several</th>
                    <th className="py-1 text-right">Unmatched</th>
                    <th className="py-1 text-right">No received date</th>
                  </tr>
                </thead>
                <tbody>
                  {load.report.byVendor.slice(0, 60).map((v) => (
                    <tr key={v.vendor} className="border-t border-white/5 text-white/80">
                      <td className="py-1">
                        <Link href={href({ vendor: v.vendor })} className="underline">{v.vendor}</Link>
                      </td>
                      <td className="py-1 text-right">{v.lots}</td>
                      <td className="py-1 text-right">{v.transfer}</td>
                      <td className="py-1 text-right">{v.email}</td>
                      <td className="py-1 text-right">{v.several_emails}</td>
                      <td className="py-1 text-right">{v.unmatched}</td>
                      <td className="py-1 text-right">{v.noReceivedDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {load.report.byVendor.length > 60 && <p className="mt-1 text-xs text-white/40">{load.report.byVendor.length - 60} more vendors in the spreadsheet.</p>}
            </section>

            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="coverage-lots">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-white/50">Show:</span>
                <Link href={href({ source: null })} className={!filter.source ? "font-semibold text-white" : "text-white/60 underline"}>All</Link>
                {COVERAGE_SOURCES.map((s) => (
                  <Link key={s} href={href({ source: s })} className={filter.source === s ? "font-semibold text-white" : "text-white/60 underline"}>
                    {COVERAGE_SOURCE_TEXT[s]}
                  </Link>
                ))}
                <Link href={href({ undated: !filter.undatedOnly })} className={filter.undatedOnly ? "font-semibold text-white" : "text-white/60 underline"}>
                  {filter.undatedOnly ? "✓ " : ""}No received date only
                </Link>
                {filter.vendor && (
                  <Link href={href({ vendor: null })} className="text-white/60 underline">Vendor: {filter.vendor} ✕</Link>
                )}
                <a href={csvHref} className="ml-auto rounded-full border border-white/15 px-3 py-1 text-white/80 hover:border-[var(--admin-accent)]" data-testid="coverage-csv">
                  Download spreadsheet ({rows.length})
                </a>
              </div>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="text-white/40">
                  <tr>
                    <th className="py-1">Barcode</th>
                    <th className="py-1">Vendor</th>
                    <th className="py-1">Product</th>
                    <th className="py-1 text-right">Units</th>
                    <th className="py-1">Manifest</th>
                    <th className="py-1">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, SHOW).map((r) => (
                    <tr key={r.barcode} className="border-t border-white/5 align-top text-white/80">
                      <td className="py-1 font-mono">{r.barcode}</td>
                      <td className="py-1">{r.vendor}</td>
                      <td className="py-1">{r.product || "—"}</td>
                      <td className="py-1 text-right">{r.units}</td>
                      <td className="py-1">
                        {COVERAGE_SOURCE_TEXT[r.source]}
                        {r.manifestNumber ? <span className="block font-mono text-white/50">{r.manifestNumber}</span> : null}
                        {r.noReceivedDate ? <span className="block text-[var(--admin-gold)]">no received date</span> : null}
                      </td>
                      <td className="py-1 text-white/50">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > SHOW && <p className="mt-2 text-xs text-white/40">Showing {SHOW} of {rows.length}. The spreadsheet has every row.</p>}
              {rows.length === 0 && <p className="mt-2 text-xs text-white/40">No lots match this filter.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
