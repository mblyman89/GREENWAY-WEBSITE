import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { readCutoverStatus } from "@/lib/pos/cutover-guard";
import {
  CUTOVER_HOLD_COPY,
  CUTOVER_RUNBOOK_DOC,
  CUTOVER_RUNBOOK_STEPS,
} from "@/lib/inventory/cutover-guard-core";
import { rebuildCutoverDeliveryAction } from "../actions";

/**
 * S18 - the Cultivera cutover runbook, in the app (bible 7.3 / 7.4). Linked
 * from the Menu Imports page. The long form is docs/CULTIVERA_CUTOVER_RUNBOOK.md.
 *
 * Reads (all bounded, named columns, skipped when the flag is off): the
 * staged real Cultivera uploads, whether cutover is done, and the deliveries
 * still to rebuild. Rendering only; the one write is the Rebuild button.
 */
export const dynamic = "force-dynamic";
// Each Rebuild press is one staging run; inherit a generous ceiling (server
// actions inherit the page's segment config).
export const maxDuration = 300;

export default async function CutoverRunbookPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const sp = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");
  const status = isSupabaseServiceConfigured
    ? await readCutoverStatus()
    : { enabled: false, blocking: null, done: false, pending: [] };
  const blocking = status.blocking !== null && status.blocking !== "unknown" ? status.blocking : null;

  return (
    <div>
      <AdminPageHeader
        title="Cultivera cutover runbook"
        subtitle="The one-time switch from Cultivera to receiving: publish Cultivera first, then receive."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Menu Imports", href: "/admin/menu-imports" }, { label: "Cutover runbook" }]} />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.notice && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]">
            {decodeURIComponent(sp.notice)}
          </div>
        )}

        {/* Where you are right now */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Where you are</h2>
          {!status.enabled ? (
            <p className="mt-2 text-sm text-white/60">
              The cutover guard is switched off (INTAKE_CUTOVER_GUARD). The steps below still apply, but the app
              will not hold or refuse anything for you.
            </p>
          ) : blocking ? (
            <div className="mt-2 space-y-2 text-sm">
              <p className="text-[var(--admin-orange)]">{CUTOVER_HOLD_COPY}</p>
              <ul className="list-disc pl-5 text-white/70">
                {blocking.versionIds.map((id) => (
                  <li key={id}>
                    <Link href={`/admin/menu-imports/version/${id}`} className="text-[var(--admin-accent)] hover:underline">
                      Open the waiting Cultivera upload
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : status.done ? (
            <p className="mt-2 text-sm text-[var(--admin-accent)]">
              Cutover is done: the Cultivera menu is live and receiving has published on top of it. A second real
              upload is refused.
            </p>
          ) : (
            <p className="mt-2 text-sm text-white/60">
              No real Cultivera upload is waiting. Start at step 2 when you are ready.
            </p>
          )}
        </section>

        {/* Still to rebuild */}
        {status.enabled && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">Still to rebuild</h2>
            {status.pending.length === 0 ? (
              <p className="mt-2 text-sm text-white/60">None. Every delivery that waited has been rebuilt.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {status.pending.map((p) => (
                  <li key={p.versionId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm">
                    <Link href={`/admin/inventory/intake/${p.manifestId}`} className="text-white/80 hover:underline">
                      Delivery {p.manifestId.slice(0, 8)}
                    </Link>
                    {canPublish && !blocking ? (
                      <form action={rebuildCutoverDeliveryAction}>
                        <input type="hidden" name="manifestId" value={p.manifestId} />
                        <input type="hidden" name="versionId" value={p.versionId} />
                        <Button type="submit" variant="primary" size="sm">
                          Rebuild on the live menu
                        </Button>
                      </form>
                    ) : (
                      <span className="text-xs text-white/40">
                        {blocking ? "Publish the Cultivera upload first" : "A manager can rebuild this"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* The checklist */}
        <section className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-5">
          <h2 className="text-sm font-semibold text-white">The steps, in order</h2>
          <ol className="mt-3 space-y-3">
            {CUTOVER_RUNBOOK_STEPS.map((st, i) => (
              <li key={st.title} className="text-sm">
                <p className="font-semibold text-white">
                  {i + 1}. {st.title}
                </p>
                <p className="text-white/60">{st.detail}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-white/40">
            The long form (why, what not to do, and the evidence) is in the repo at{" "}
            <code className="rounded bg-black/40 px-1">{CUTOVER_RUNBOOK_DOC}</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
