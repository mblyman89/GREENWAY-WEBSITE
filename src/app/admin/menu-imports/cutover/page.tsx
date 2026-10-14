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
import { rebuildCutoverDeliveryAction, sendCutoverTestAlertAction } from "../actions";
import { readRecentWatchAlerts, readWatchChannels } from "@/lib/pos/cutover-watch";
import { WATCH_TEXT_NOTE, channelSummary } from "@/lib/pos/cutover-watch-core";
import { formatDateTime } from "@/lib/pos/format";
import {
  CUTOVER_DOC,
  WEEKEND_DAY_LABEL,
  WEEKEND_ROLLBACK,
  WEEKEND_STEPS,
  weekendNow,
  type WeekendDay,
} from "@/lib/pos/cutover-weekend-core";

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

/** "You are here" from the server clock (repo pattern: Date.now() inside a helper). */
function weekendNowFromClock() {
  return weekendNow(Date.now());
}

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
  // R50 A4: the failure-alert channels and the alerts already sent.
  const [channels, recent] = await Promise.all([readWatchChannels(), readRecentWatchAlerts(20)]);
  const chan = channelSummary(channels);
  // R50 A5: the dated weekend plan; "you are here" from the clock only (never claims a step is done).
  const now = weekendNowFromClock();
  const days: WeekendDay[] = ["before", "2026-10-30", "2026-10-31", "2026-11-01", "after"];

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

        {/* R50 A5: the weekend on one page (dated, timed, Pacific) */}
        <section id="cutover-weekend" className="rounded-xl border border-[var(--admin-accent)]/40 bg-[#0a0a0a] p-5" data-testid="cutover-weekend">
          <h2 className="text-sm font-semibold text-white">The cutover weekend, on one page</h2>
          <p className="mt-1 text-sm text-[var(--admin-accent)]" data-testid="cutover-weekend-now">{now.headline}</p>
          <p className="mt-1 text-xs text-white/40">
            All times are Pacific. This page knows the clock, not what you have done, so tick things off yourself.
          </p>
          {days.map((d) => (
            <div key={d} className="mt-4">
              <h3 className={d === now.day ? "text-xs font-semibold uppercase tracking-wide text-[var(--admin-accent)]" : "text-xs font-semibold uppercase tracking-wide text-white/50"}>
                {WEEKEND_DAY_LABEL[d]}
                {d === now.day ? " (today)" : ""}
              </h3>
              <ol className="mt-2 space-y-2">
                {WEEKEND_STEPS.filter((st) => st.day === d).map((st) => (
                  <li
                    key={st.key}
                    data-step={st.key}
                    className={st.key === now.nextTimedKey ? "rounded-lg border border-[var(--admin-accent)]/60 px-3 py-2 text-sm" : "rounded-lg border border-white/10 px-3 py-2 text-sm"}
                  >
                    <p className="font-semibold text-white">
                      {st.at ? <span className="mr-2 font-mono text-[var(--admin-gold)]">{st.at}</span> : null}
                      {st.title}
                      {st.key === now.nextTimedKey ? <span className="ml-2 text-xs text-[var(--admin-accent)]">next</span> : null}
                    </p>
                    <p className="text-white/60">{st.detail}</p>
                    <p className="text-xs text-white/40">
                      Check: {st.check}
                      {st.href && st.linkLabel ? (
                        <>
                          {" \u00b7 "}
                          <Link href={st.href} className="text-[var(--admin-accent)] hover:underline">
                            {st.linkLabel}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-white/50">If something goes wrong</h3>
          <ul className="mt-2 space-y-1 text-sm" data-testid="cutover-weekend-rollback">
            {WEEKEND_ROLLBACK.map((r) => (
              <li key={r.when} className="text-white/70">
                <span className="font-semibold text-white">{r.when}:</span> {r.what}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-white/40">
            The printable copy is in the repo at <code className="rounded bg-black/40 px-1">{CUTOVER_DOC}</code>.
          </p>
        </section>

        {/* R50 A2: the go / no-go units check */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="cutover-reconcile">
          <h2 className="text-sm font-semibold text-white">Do the units balance?</h2>
          <p className="mt-2 text-sm text-white/60">
            After you publish the Cultivera import (and again after rebuilding deliveries), check that every unit in
            Cultivera&apos;s file became a unit on a lot. Green means go.{" "}
            <Link href="/admin/menu-imports/reconcile" className="text-[var(--admin-accent)] hover:underline">
              Open the go / no-go check
            </Link>
          </p>
        </section>

        {/* R50 A6: the daily drift check, first week only */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="cutover-drift">
          <h2 className="text-sm font-semibold text-white">Did anything drift today? (11/02 to 11/08)</h2>
          <p className="mt-2 text-sm text-white/60">
            Once a day for the first week: on hand must equal Cultivera&apos;s units plus every count, adjustment, sale and
            void. Red names the product to count. It switches itself off after 11/08.{" "}
            <Link href="/admin/menu-imports/drift" className="text-[var(--admin-accent)] hover:underline">
              Open the daily drift check
            </Link>
          </p>
        </section>

        {/* R50 A4: failure alerts */}
        <section id="cutover-alerts" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="cutover-alerts">
          <h2 className="text-sm font-semibold text-white">Failure alerts (email and phone)</h2>
          <p className="mt-2 text-sm text-white/60">
            Every 5 minutes the site checks the Cultivera harvest and the imports. If a harvest fails, runs too long or
            cannot be reached, or an import fails or gets stuck, you get one email and one phone notification for it.
            You also get one when a harvest finishes, so you know it is ready to import. You do not have to keep this
            page open.
          </p>
          <div className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-sm" data-testid="cutover-alerts-channels">
            <p className={chan.ok ? "font-semibold text-[var(--admin-accent)]" : "font-semibold text-[var(--admin-orange)]"}>
              {chan.ok ? "Alerts can reach you." : "Alerts cannot reach you yet."}
            </p>
            <ul className="mt-1 list-disc pl-5 text-white/70">
              {chan.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-white/40">{WATCH_TEXT_NOTE}</p>
          </div>
          <form action={sendCutoverTestAlertAction} className="mt-3">
            <Button type="submit" variant="neutral" size="sm" data-testid="cutover-alerts-test">
              Send a test alert
            </Button>
            <span className="ml-3 text-xs text-white/40">Do this once before the cutover night, on the phone you will carry.</span>
          </form>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/50">Alerts sent (newest first)</h3>
          {recent.error ? (
            <p className="mt-2 text-sm text-[var(--admin-orange)]">The alert list could not be read: {recent.error}</p>
          ) : recent.rows.length === 0 ? (
            <p className="mt-2 text-sm text-white/60">None yet.</p>
          ) : (
            <ul className="mt-2 space-y-2" data-testid="cutover-alerts-log">
              {recent.rows.map((r) => {
                const v = r.view;
                const tone = v.tone === "ok" ? "text-[var(--admin-accent)]" : v.tone === "bad" ? "text-red-300" : "text-white/60";
                return (
                  <li key={r.dedupe_key} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                    <p className="text-white/80">
                      <span className="font-semibold text-white">{v.what}</span>
                      {v.isTest ? <span className="ml-2 text-xs text-white/40">(test)</span> : null}
                      <span className="ml-2 text-xs text-white/40">{formatDateTime(r.sent_at)}</span>
                    </p>
                    {r.subject ? <p className="text-white/60">{r.subject}</p> : null}
                    <p className={`text-xs ${tone}`}>{v.label}</p>
                  </li>
                );
              })}
            </ul>
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
