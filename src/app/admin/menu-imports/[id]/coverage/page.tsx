import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { getImport } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCoverage } from "@/lib/pos/cultivera-coverage-store";
import { loadRehomeSources, previewMailApply, type MailApplyPreview } from "@/lib/pos/cultivera-mail-apply-store";
import { MAIL_APPLY_EXCEPTION_TEXT, mailApplyStage, type MailApplyExceptionCode } from "@/lib/pos/cultivera-mail-apply-core";
import { applyMailPlanAction, rollbackMailPlanAction } from "../../mail-apply-actions";
import { CultiveraAutoStartPanel } from "@/components/admin/inventory/CultiveraAutoStartPanel";
import { COVERAGE_SOURCES, COVERAGE_SOURCE_TEXT, coverageFilterFromParams, filterCoverage } from "@/lib/pos/cultivera-coverage-core";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rows shown on the page; the spreadsheet always has every (filtered) row. */
const SHOW = 300;

/**
 * R74 S8 — where each Cultivera lot's manifest comes from, lot by lot, BEFORE anything moves:
 * a real Cultivera transfer, a manifest found in the stephen@ email harvest, or the one
 * "Unmatched Cultivera stock" manifest; and whether Cultivera's Received date is blank (owner #5:
 * "does not exist", CCRS clean-up). The report is read-only; R74 S10 adds the Apply that writes it.
 */
export default async function ImportCoveragePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string; vendor?: string; undated?: string; back?: string; done?: string; error?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const canApply = can(session.profile.role, "inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await getImport(id);
  if (!imp) notFound();

  const admin = createSupabaseAdminClient();
  // The import's workbooks are read ONCE for both the report and the email step's preview.
  let sources: Awaited<ReturnType<typeof loadRehomeSources>> | null = null;
  let sourcesError: string | null = null;
  try {
    sources = await loadRehomeSources(admin, id);
  } catch (err) {
    sourcesError = err instanceof Error ? err.message : String(err);
  }
  const load = sources ? await loadCoverage(admin, id, sources) : ({ ok: false, error: sourcesError ?? "Could not read the import." } as const);
  // R74 S10: the email step's own preview (same plan as the report, plus where each lot sits now).
  let apply: MailApplyPreview | null = null;
  let applyError: string | null = null;
  if (load.ok && sources) {
    try {
      apply = await previewMailApply(admin, id, sources, { actorId: session.userId });
    } catch (err) {
      applyError = err instanceof Error ? err.message : "Could not build the email step's plan.";
    }
  }
  const ap = apply?.plan ?? null;
  const stage = ap ? mailApplyStage(ap) : null;
  const exCodes = ap ? (Object.keys(ap.summary.exceptionCounts) as MailApplyExceptionCode[]).filter((c) => ap.summary.exceptionCounts[c] > 0) : [];
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
          goes on the one &quot;Unmatched Cultivera stock&quot; manifest. The report changes nothing; only the Apply button below (inventory managers, after a tick) moves lots.
        </p>
        {sp.done && <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]" data-testid="mail-apply-done">{sp.done}</div>}
        {sp.error && <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200" data-testid="mail-apply-error">{sp.error}</div>}
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

            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="mail-apply">
              <h2 className="text-sm font-semibold text-white">Put the email-found lots on their manifests</h2>
              <p className="mt-1 max-w-3xl text-xs text-white/50">
                Creates one manifest per emailed manifest above (its real number, vendor and the name, type and cost from the
                manifest line kept for onboarding) and the one &ldquo;Unmatched Cultivera stock&rdquo; manifest, then moves each lot
                onto it. Only the lot&apos;s manifest changes: quantity, cost, category, menu and register are untouched, and it is
                migration stock (no bills, no Sage). Works before or after Rebuild manifests; run it again after more harvesting
                and lots move off the unmatched manifest onto the manifest that was found.
              </p>
              {applyError && <p className="mt-2 text-xs text-red-300" data-testid="mail-apply-load-error">{applyError}</p>}
              {ap && (
                <div className="mt-3 space-y-2 text-xs text-white/70">
                  <p data-testid="mail-apply-summary">
                    {ap.summary.emailManifests} emailed manifest(s){ap.summary.unmatchedManifest ? " + the unmatched manifest" : ""} ·{" "}
                    {ap.summary.manifestsToCreate} to create · {ap.summary.lotsToMove} lot(s) to move ({ap.summary.lotsToEmail} onto emailed manifests,{" "}
                    {ap.summary.lotsToUnmatched} onto &ldquo;Unmatched Cultivera stock&rdquo;) · {ap.summary.lotsAlreadyHome} already home
                    {ap.summary.movesFromRebuilt > 0 ? ` · ${ap.summary.movesFromRebuilt} come off received-date manifests` : ""}
                    {ap.summary.movesFromUnmatched > 0 ? ` · ${ap.summary.movesFromUnmatched} upgraded off the unmatched manifest` : ""}
                  </p>
                  {ap.refusals.length > 0 && (
                    <ul className="list-disc pl-5 text-red-300" data-testid="mail-apply-refusals">
                      {ap.refusals.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {ap.warnings.map((w) => (
                    <p key={w} className="text-[var(--admin-gold)]">{w}</p>
                  ))}
                  {exCodes.map((c) => (
                    <p key={c} className="text-white/50">
                      <span className="text-white/80">{MAIL_APPLY_EXCEPTION_TEXT[c].title} · {ap.summary.exceptionCounts[c]}</span> — {MAIL_APPLY_EXCEPTION_TEXT[c].action}
                    </p>
                  ))}
                  {canApply && apply && (stage === "ready" || stage === "partial") && (
                    <form action={applyMailPlanAction} className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <input type="hidden" name="importId" value={id} />
                      <input type="hidden" name="digest" value={apply.digest} />
                      <label className="flex max-w-2xl items-center gap-2">
                        <input type="checkbox" name="attest" value="1" />
                        I reviewed this: {ap.summary.manifestsToCreate} manifest(s) to create and {ap.summary.lotsToMove} lot(s) to move. Only the lots&apos; manifest changes.
                      </label>
                      <button type="submit" className={CHIP_ACTION} data-testid="mail-apply-run">
                        {stage === "partial" ? "Apply the rest" : "Apply"}
                      </button>
                    </form>
                  )}
                  {stage === "done" && <p className="text-[var(--admin-accent)]" data-testid="mail-apply-complete">Every lot left for email is on its emailed manifest or on &ldquo;Unmatched Cultivera stock&rdquo;.</p>}
                  {stage === "nothing" && <p className="text-white/50">No lots are waiting for the email step.</p>}
                  {!canApply && (stage === "ready" || stage === "partial") && <p className="text-white/40">Applying needs the inventory manager permission.</p>}
                  {canApply && ap.summary.manifestsAlreadyCreated > 0 && (
                    <form action={rollbackMailPlanAction} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-2" data-testid="mail-apply-rollback">
                      <input type="hidden" name="importId" value={id} />
                      <label className="flex max-w-2xl items-center gap-2 text-white/60">
                        <input type="checkbox" name="attest" value="1" />
                        Undo the email step: move these lots back to the import manifest and remove the emailed and unmatched manifests (any with onboarding work or a hand-placed lot is kept).
                      </label>
                      <button type="submit" className={CHIP_NEUTRAL}>
                        Roll back
                      </button>
                    </form>
                  )}
                </div>
              )}
            </section>

            {/* R74 S13: emailed + unmatched manifests start onboarding automatically after Apply. */}
            {ap && ap.summary.manifestsAlreadyCreated > 0 && <CultiveraAutoStartPanel importId={id} page="coverage" canApply={canApply} />}

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
