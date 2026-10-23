import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { getImport } from "@/lib/pos/menu-version";
import { formatDateTime } from "@/lib/pos/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadRehomeSources, previewRehome, type RehomePreview } from "@/lib/inventory/cultivera-rehome-store";
import { REHOME_EXCEPTION_TEXT, rehomeStage, totalsLine } from "@/lib/inventory/cultivera-rehome-ui-core";
import type { RehomeExceptionCode } from "@/lib/inventory/cultivera-rehome-core";
import { applyRehomeAction, rollbackRehomeAction } from "../../rehome-actions";
import { CultiveraAutoStartPanel } from "@/components/admin/inventory/CultiveraAutoStartPanel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * R50 S2c — rebuild this Cultivera import's real manifests and move its lots
 * onto them (bible §1.3b). The preview below is computed on the server from
 * the import's own stored workbooks and the transfer index saved at import
 * time; nothing is written until Apply, and Apply runs only this exact plan
 * (digest). Only each lot's manifest changes — quantities, costs, dates,
 * menu and register visibility are untouched. Re-runnable and reversible.
 */
export default async function ImportManifestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string; back?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await getImport(id);
  if (!imp) notFound();
  const canApply = can(session.profile.role, "inventory.manage");

  let preview: RehomePreview | null = null;
  let loadError: string | null = null;
  try {
    const admin = createSupabaseAdminClient();
    preview = await previewRehome(admin, id, await loadRehomeSources(admin, id), { actorId: session.userId });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not build the manifest plan.";
  }
  const plan = preview?.plan ?? null;
  const stage = plan ? rehomeStage(plan) : null;
  const s = plan?.summary;
  const exByCode = new Map<RehomeExceptionCode, string[]>();
  for (const e of plan?.exceptions ?? []) exByCode.set(e.code, [...(exByCode.get(e.code) ?? []), e.detail]);
  const biggest = [...(plan?.manifests ?? [])].sort((a, b) => b.lotIds.length - a.lotIds.length).slice(0, 12);

  return (
    <div>
      <AdminPageHeader
        title="Rebuild Cultivera manifests"
        subtitle={`Import ${formatDateTime(imp.created_at)} · put every lot back on the real delivery it came in on`}
        action={
          <BackLink
            fallback={`/admin/menu-imports/${id}`}
            back={sp.back}
            className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white"
          >
            ← Import review
          </BackLink>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.done && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]" data-testid="rehome-done">
            {sp.done}
          </div>
        )}
        {sp.error && <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200" data-testid="rehome-error">{sp.error}</div>}
        {loadError && <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">{loadError}</div>}

        <p className="max-w-3xl text-xs text-white/50">
          Cultivera&apos;s export puts every lot on one import manifest. This rebuilds the real deliveries from Cultivera&apos;s
          own transfer records (number, vendor, acceptance time), or, where a lot has no transfer, from its Received date.
          Only each lot&apos;s manifest changes: quantities, costs, received dates and what the menu and register show stay
          exactly the same. Nothing is a purchase — this stock is already paid for, so payables and Sage never see it. The
          rebuilt manifests then start in Onboarding automatically (Automatic onboarding start, below), so these products get enriched the same way as a native delivery.
        </p>
        {/* R74 S8: lot by lot, where each manifest comes from (Cultivera transfer / email / unmatched). */}
        <p className="text-xs">
          <Link href={`/admin/menu-imports/${id}/coverage`} className="text-[var(--admin-accent)] underline" data-testid="coverage-link">
            Where each lot&apos;s manifest comes from (Cultivera transfer, email, or unmatched) →
          </Link>
        </p>

        {plan && s && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Real Cultivera transfers" value={s.transferManifests} hint="number, vendor and acceptance time from Cultivera" accent="green" />
              <StatCard label="Rebuilt from received dates" value={s.rebuiltManifests} hint="lots with no matching transfer" accent="gold" />
              <StatCard label="Lots to move" value={s.lotsToMove} hint={`${s.lotsAlreadyHome} already home · ${s.lotsStayOnSource} stay`} accent="orange" />
              <StatCard label="Vendors linked" value={s.vendorIdsSet} hint={`of ${s.manifestsPlanned} manifests (never invented)`} accent="muted" />
            </div>

            <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rehome-totals">
              <h2 className="text-sm font-semibold text-white">Control totals</h2>
              <p className="mt-1 text-xs text-white/60">{totalsLine(plan.totals)}</p>
              <p className="mt-1 text-xs text-white/40">
                Apply re-reads every lot from the database afterwards and stops if any of these numbers moved by a single unit or cent.
              </p>
            </section>

            {plan.refusals.length > 0 && (
              <section className="rounded-xl border border-red-500/40 bg-red-500/5 p-5" data-testid="rehome-refusals">
                <h2 className="text-sm font-semibold text-red-200">Apply is blocked</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-200/90">
                  {plan.refusals.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            )}

            {exByCode.size > 0 && (
              <section className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-5" data-testid="rehome-exceptions">
                <h2 className="text-sm font-semibold text-white">Exceptions ({plan.exceptions.length})</h2>
                <div className="mt-3 space-y-3">
                  {[...exByCode.entries()].map(([code, details]) => (
                    <div key={code}>
                      <p className="text-xs font-semibold text-white/80">
                        {REHOME_EXCEPTION_TEXT[code].title} · {s.exceptionCounts[code]}
                      </p>
                      <p className="text-xs text-white/50">{REHOME_EXCEPTION_TEXT[code].action}</p>
                      <p className="mt-1 font-mono text-[0.65rem] text-white/40">{details.slice(0, 20).join(" · ")}{details.length > 20 ? " …" : ""}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {biggest.length > 0 && (
              <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
                <h2 className="text-sm font-semibold text-white">Largest manifests in the plan</h2>
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-white/40">
                    <tr>
                      <th className="py-1">Manifest</th>
                      <th className="py-1">From</th>
                      <th className="py-1">Accepted</th>
                      <th className="py-1">Source</th>
                      <th className="py-1 text-right">Lots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {biggest.map((m) => (
                      <tr key={m.dedupeKey} className="border-t border-white/5 text-white/80">
                        <td className="py-1 font-mono">{m.row.manifest_number}</td>
                        <td className="py-1">{m.row.vendor_label ?? "—"}</td>
                        <td className="py-1">{m.row.accepted_at ? formatDateTime(m.row.accepted_at) : m.row.transfer_date ?? "unknown"}</td>
                        <td className="py-1">{m.source === "transfer" ? "Cultivera transfer" : `Received dates (${m.source})`}</td>
                        <td className="py-1 text-right">{m.lotIds.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {canApply && preview && (stage === "ready" || stage === "partial") && (
              <section className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/5 p-5" data-testid="rehome-apply">
                <form action={applyRehomeAction} className="flex flex-wrap items-center justify-between gap-3">
                  <input type="hidden" name="importId" value={id} />
                  <input type="hidden" name="digest" value={preview.digest} />
                  <label className="flex max-w-2xl items-center gap-2 text-xs text-white/70">
                    <input type="checkbox" name="attest" value="1" />
                    I reviewed this plan: {s.manifestsToCreate} manifest(s) to create and {s.lotsToMove} lot(s) to move. Only the
                    lots&apos; manifest changes.
                  </label>
                  <button type="submit" className={CHIP_ACTION}>
                    {stage === "partial" ? "Resume rebuild" : "Apply rebuild"}
                  </button>
                </form>
                {stage === "partial" && <p className="mt-2 text-xs text-white/50">A previous run stopped part-way. Resuming creates only what is missing; nothing is duplicated.</p>}
              </section>
            )}
            {stage === "done" && (
              <p className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-center text-sm text-white/70" data-testid="rehome-complete">
                Every lot is on its rebuilt manifest. Onboarding starts for each of them automatically (see Automatic onboarding start).
              </p>
            )}
            {stage === "nothing" && <p className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-center text-sm text-white/70">This import has no lots to rebuild manifests for.</p>}
          </>
        )}

        {/* R74 S13: rebuilt manifests start onboarding automatically after Apply. */}
        {(s?.manifestsAlreadyCreated ?? 0) > 0 && <CultiveraAutoStartPanel importId={id} page="manifests" canApply={canApply} />}

        {canApply && (s?.manifestsAlreadyCreated ?? 0) > 0 && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rehome-rollback">
            <h2 className="text-sm font-semibold text-white">Undo</h2>
            <form action={rollbackRehomeAction} className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <input type="hidden" name="importId" value={id} />
              <label className="flex max-w-2xl items-center gap-2 text-xs text-white/70">
                <input type="checkbox" name="attest" value="1" />
                Move this import&apos;s lots back to the import manifest and remove the rebuilt manifests. Any manifest with a draft,
                fact review, document, payment or a lot someone placed there by hand is kept.
              </label>
              <button type="submit" className={CHIP_NEUTRAL}>
                Roll back
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
