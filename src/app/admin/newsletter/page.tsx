import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { BROADCAST_GATE_MESSAGE } from "@/lib/cms/newsletter-email-core";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import {
  listSendableNewsletters,
  getRecipientStats,
  newsletterSendConfig,
  listSendHistory,
  type SendableNewsletter,
} from "@/lib/cms/newsletter-send-store";
import {
  testSendNewsletterAction,
  broadcastNewsletterAction,
  retryFailedNewsletterAction,
  markNewsletterReadyAction,
  approveNewsletterAction,
  newsletterBackToDraftAction,
  saveNewsletterCadenceAction,
} from "./actions";
import { getCadence, listApprovals, CADENCE_MIGRATION_HINT } from "@/lib/cms/newsletter-cadence-server";
import { stageOf, STAGE_LABEL, WEEKDAYS, formatHhmm, nextSundaySendUtc } from "@/lib/cms/newsletter-cadence-core";
import { utcToPacificLocal } from "@/lib/cms/content-schedule-core";
import { listOpenSendProgress } from "@/lib/cms/newsletter-queue-server";
import { progressLine } from "@/lib/cms/newsletter-batch-core";
import { NewsletterSendAutoRefresh } from "@/components/admin/marketing/NewsletterSendAutoRefresh";
import { getNewsletterStats } from "@/lib/reports/newsletter-stats";
import { NewsletterStatsSection } from "@/components/admin/reports/NewsletterStatsSection";
import { Button } from "@/components/admin/ui/Button";
import { Input } from "@/components/admin/ui/Field";
import { StatusPill, EmptyState } from "@/components/admin/ux";
import { CanvaButton } from "@/components/admin/marketing/CanvaButton";

export const dynamic = "force-dynamic";

/**
 * Trailing-90-day engagement window (repo pattern: Date.now() inside a helper,
 * so the render body itself stays pure). Both ends are derived from ONE clock
 * read, so the window can never straddle a millisecond boundary.
 */
function engagementWindow(): { fromISO: string; toISO: string } {
  const nowMs = Date.now();
  return {
    fromISO: new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString(),
    toISO: new Date(nowMs).toISOString(),
  };
}

/** D237 N-3: the default "Approve and schedule" time = next Sunday at the set time. */
function defaultSendLocal(sendTime: string | null): string {
  const iso = nextSundaySendUtc(new Date().toISOString(), sendTime);
  return iso ? utcToPacificLocal(iso) : "";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function NewsletterSendPage({
  searchParams,
}: {
  searchParams: Promise<{
    selected?: string;
    tested?: string;
    sent?: string;
    failed?: string;
    error?: string;
    queued?: string;
    notice?: string;
  }>;
}) {
  const session = await requirePermission("blog.manage");
  // D237 N-1 (Q-22-3): only owner/admin see the send-to-everyone button.
  const canBroadcast = can(session.profile.role, "newsletter.broadcast");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Newsletter Send Center" subtitle="Email a published newsletter to your loyalty list." />
        <div className="px-5 py-6 text-sm text-[var(--admin-gold)] sm:px-8">
          The database isn’t fully set up yet. Once your administrator finishes the one-time setup, the newsletter send center turns on automatically.
        </div>
      </div>
    );
  }

  const cfg = newsletterSendConfig();
  // Engagement window: trailing 90 days. Reuses the same stats engine that
  // powers Reports → Customers → Newsletter Statistics (no new tracking).
  const { fromISO: engagementFromISO, toISO: engagementToISO } = engagementWindow();
  const [newsletters, recipients, history, engagement, openSendsAll, cadence, approvals] = await Promise.all([
    listSendableNewsletters(),
    getRecipientStats(),
    listSendHistory(20),
    getNewsletterStats(engagementFromISO, engagementToISO),
    listOpenSendProgress(),
    getCadence(),
    listApprovals(),
  ]);
  // D237 N-3: newsletters that can go through the Sunday approval (a PDF is
  // uploaded and it is not archived). Approving covers publishing it.
  const sundayCandidates = newsletters.filter((n) => n.pdfUrl && n.status !== "archived").slice(0, 8);
  const defaultSendAt = defaultSendLocal(cadence.sendTime);
  // D237 N-2: only queued broadcasts (rows in newsletter_send_recipients) have a bar.
  const openSends = openSendsAll.filter((o) => o.pending + o.sent + o.failed > 0);

  const sendable = newsletters.filter((n) => n.status === "published" && n.pdfUrl);
  const selected: SendableNewsletter | null =
    sendable.find((n) => n.id === sp.selected) ?? sendable[0] ?? null;

  return (
    <div>
      <AdminPageHeader
        title="Newsletter Send Center"
        subtitle="Pick a published newsletter and email a branded announcement to your loyalty members."
        breadcrumbs={<Breadcrumbs items={[{ label: "Newsletter Send" }]} />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* SLICE 115: jump straight to Canva to design the newsletter. */}
            <CanvaButton />
            <Button href="/admin/blog" variant="neutral">
              Blog &amp; posts
            </Button>
          </div>
        }
        help={
          <HelpPanel
            id="newsletter-send"
            title="How sending works"
            steps={[
              "Design your newsletter in Canva and export a PDF.",
              "Upload it under Blog & Newsletter (set type = Newsletter) and Publish.",
              "Come here, pick it, and send a Test to yourself first.",
              "Happy? The owner or an admin ticks the confirm box and sends it to the loyalty list.",
              "It goes out in batches of 100. A bar shows how many are sent; you can leave this page and it keeps going.",
              "If some addresses failed, the owner or an admin can press Retry failed on that send. Only those addresses get it again.",
              "Sunday newsletter: when it is finished, press Ready for approval. The owner or an admin presses Approve and schedule and picks the time. It publishes and sends by itself at that time.",
              "Editing an approved newsletter takes the approval back. It must be approved again.",
            ]}
          >
            <p className="mb-2">
              Members receive a branded email with a “Read the newsletter” button.
              Only members who gave email consent are included, and each person
              gets their own private copy.
            </p>
            <p>
              <strong>About email setup:</strong> your site is configured to <em>send</em> email
              (newsletters, order &amp; loyalty notices). You do <strong>not</strong> need to turn on
              “Enable Receiving” in Resend — that’s only for processing inbound mail and can disrupt
              your normal inbox. Replies route to your store inbox automatically.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Flash */}
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            {decodeURIComponent(sp.error)}
          </div>
        ) : null}
        {sp.tested ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            Test email sent to {decodeURIComponent(sp.tested)} — check your inbox.
          </div>
        ) : null}
        {sp.queued !== undefined ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            Queued for {sp.queued} member(s). It goes out in batches of 100; you can leave this page and it keeps going.
          </div>
        ) : null}
        {sp.notice ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            {decodeURIComponent(sp.notice)}
          </div>
        ) : null}
        {openSends.length > 0 ? (
          <div className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5" data-testid="newsletter-send-progress">
            {openSends.map((o) => (
              <div key={o.sendId}>
                <p className="text-sm font-semibold text-[var(--admin-text)]">{o.subject}</p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-[var(--admin-border)]" role="progressbar" aria-valuenow={o.percent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-[var(--admin-accent)]" style={{ width: `${o.percent}%` }} />
                </div>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{progressLine(o)}</p>
              </div>
            ))}
            <NewsletterSendAutoRefresh active />
          </div>
        ) : null}
        {sp.sent !== undefined ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            Sent to {sp.sent} member(s)
            {sp.failed && sp.failed !== "0" ? ` · ${sp.failed} failed` : ""}.
          </div>
        ) : null}

        {/* Config banner */}
        {!cfg.configured ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Email sending isn&apos;t configured yet. Add <code className="rounded bg-black/40 px-1">RESEND_API_KEY</code> and{" "}
            <code className="rounded bg-black/40 px-1">NEWSLETTER_FROM_EMAIL</code> (a verified Resend address). You can still
            pick newsletters and preview the audience below.
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Published newsletters" value={sendable.length} accent="green" />
          <StatCard label="Loyalty recipients" value={recipients.total} accent="muted" />
          <StatCard label="From address" value={cfg.from ? "Set" : "Not set"} accent={cfg.from ? "green" : "orange"} />
        </div>

        {/* Engagement (last 90 days). Same data as Reports → Customers →
            Newsletter Statistics, surfaced here where you send from. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-white">Engagement · last 90 days</h2>
            <Link
              href="/admin/reports/customers"
              className="text-xs font-medium text-[var(--admin-accent)] hover:underline"
            >
              Full report →
            </Link>
          </div>
          <NewsletterStatsSection
            stats={engagement}
            exportHref="/admin/reports/customers/newsletter-export"
          />
        </section>


        {/* D237 N-3 (G-113, Q-22-4): the Sunday newsletter. */}
        <section id="sunday" className="space-y-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5" data-testid="newsletter-sunday-cadence">
          <div>
            <p className="text-sm font-semibold text-[var(--admin-text)]">Sunday newsletter</p>
            <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
              {cadence.sendTime
                ? `Approved newsletters send on Sunday at ${formatHhmm(cadence.sendTime)} Pacific unless you pick another time.`
                : "No Sunday send time is set yet. Nothing sends by itself until the owner sets a time below or picks one when approving."}
            </p>
          </div>
          {!approvals.ready ? (
            <p className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]">
              {CADENCE_MIGRATION_HINT}
            </p>
          ) : sundayCandidates.length === 0 ? (
            <p className="text-xs text-[var(--admin-text-muted)]">No newsletter with a PDF yet. Upload one under Blog &amp; Newsletter.</p>
          ) : (
            <div className="space-y-3">
              {sundayCandidates.map((n) => {
                const a = approvals.byPost[n.id] ?? null;
                const stage = stageOf(a);
                return (
                  <div key={n.id} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3 text-xs text-[var(--admin-text-muted)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--admin-text)]">{n.title}</span>
                      <StatusPill status={stage}>{STAGE_LABEL[stage]}</StatusPill>
                      {n.status !== "published" ? <span className="text-[var(--admin-text-faint)]">(not published yet; approving publishes it when it sends)</span> : null}
                    </div>
                    {a?.send_at && (stage === "scheduled" || stage === "sending") ? (
                      <p className="mt-1">Sends {fmtDate(a.send_at)} (Pacific).</p>
                    ) : null}
                    {a?.error ? <p className="mt-1 text-[var(--admin-orange)]">Last try failed: {a.error}</p> : null}
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {stage === "draft" || stage === "sent" ? (
                        <form action={markNewsletterReadyAction}>
                          <input type="hidden" name="post_id" value={n.id} />
                          <Button type="submit" variant="neutral" size="sm">Ready for approval</Button>
                        </form>
                      ) : null}
                      {canBroadcast && (stage === "ready" || stage === "approved" || stage === "scheduled") ? (
                        <form action={approveNewsletterAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="post_id" value={n.id} />
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-[var(--admin-text-faint)]">Send at (Pacific)</span>
                            <Input type="datetime-local" name="send_at" step={300} defaultValue={a?.send_at ? utcToPacificLocal(a.send_at) : defaultSendAt} required />
                          </label>
                          <Button type="submit" size="sm">{stage === "ready" ? "Approve and schedule" : "Change send time"}</Button>
                        </form>
                      ) : null}
                      {stage === "ready" || stage === "approved" || stage === "scheduled" ? (
                        <form action={newsletterBackToDraftAction}>
                          <input type="hidden" name="post_id" value={n.id} />
                          <Button type="submit" variant="neutral" size="sm">Back to draft</Button>
                        </form>
                      ) : null}
                    </div>
                    {!canBroadcast && stage === "ready" ? <p className="mt-1">Waiting for the owner or an admin to approve.</p> : null}
                  </div>
                );
              })}
            </div>
          )}
          {canBroadcast ? (
            <form action={saveNewsletterCadenceAction} className="grid gap-3 border-t border-[var(--admin-border)] pt-4 text-xs text-[var(--admin-text-muted)] sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span>Sunday send time (Pacific). Leave empty for none.</span>
                <Input type="time" name="send_time" step={300} defaultValue={cadence.sendTime ?? ""} />
              </label>
              <label className="flex items-center gap-2 self-end">
                <input type="checkbox" name="remind_enabled" defaultChecked={cadence.remindEnabled} className="h-4 w-4 accent-[var(--admin-accent)]" />
                Email a reminder when nothing is ready
              </label>
              <label className="flex flex-col gap-1">
                <span>Reminder day</span>
                <select name="remind_day" defaultValue={String(cadence.remindDay)} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]">
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span>Reminder time (Pacific)</span>
                <Input type="time" name="remind_time" step={300} defaultValue={cadence.remindTime} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span>Reminder goes to (comma separated). Empty = the store staff list.</span>
                <Input name="remind_emails" defaultValue={cadence.remindEmails.join(", ")} placeholder="owner@example.com" />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" variant="neutral" size="sm">Save Sunday settings</Button>
              </div>
            </form>
          ) : null}
        </section>

        {sendable.length === 0 ? (
          <EmptyState
            icon="✉️"
            title="No sendable newsletters yet"
            description="Create one under Blog & Newsletter, upload its PDF, and publish it — then it'll be ready to send here."
            action={
              <Button href="/admin/blog" variant="primary">
                Go to Blog & Newsletter
              </Button>
            }
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            {/* Newsletter picker */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Choose a newsletter</p>
              {sendable.map((n) => {
                const active = selected?.id === n.id;
                return (
                  <Link
                    key={n.id}
                    href={`/admin/newsletter?selected=${n.id}`}
                    className={`block rounded-[var(--admin-radius-lg)] border px-4 py-3 text-sm transition ${
                      active
                        ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-text)]"
                        : "border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text-muted)] hover:border-[var(--admin-border-strong)]"
                    }`}
                  >
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--admin-text-faint)]">
                      {n.publishDate ? fmtDate(n.publishDate) : "—"}
                      {n.lastSentAt ? ` · last sent ${fmtDate(n.lastSentAt)}` : ""}
                    </p>
                  </Link>
                );
              })}
            </div>

            {/* Send panel */}
            {selected ? (
              <div className="space-y-5">
                <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
                  <p className="text-sm font-semibold text-[var(--admin-text)]">{selected.title}</p>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--admin-text-faint)]">
                    <a href={selected.publicUrl} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">
                      View public page ↗
                    </a>
                    {selected.pdfUrl ? (
                      <a href={selected.pdfUrl} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">
                        Open PDF ↗
                      </a>
                    ) : null}
                    {selected.lastSentAt ? (
                      <span className="text-[var(--admin-gold)]">Already broadcast on {fmtDate(selected.lastSentAt)}</span>
                    ) : null}
                  </div>
                </div>

                {/* Test send */}
                <form
                  action={testSendNewsletterAction}
                  className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
                >
                  <input type="hidden" name="newsletter_id" value={selected.id} />
                  <p className="text-sm font-semibold text-[var(--admin-text)]">1 · Send yourself a test</p>
                  <p className="text-xs text-[var(--admin-text-faint)]">Always preview in a real inbox before sending to everyone.</p>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      name="test_email"
                      type="email"
                      placeholder="you@example.com"
                      className="min-w-56 flex-1"
                    />
                    <Button type="submit" variant="neutral" disabled={!cfg.configured}>
                      Send test
                    </Button>
                  </div>
                </form>

                {/* Broadcast (owner/admin only, D237 N-1) */}
                {canBroadcast ? (
                <form
                  action={broadcastNewsletterAction}
                  className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/25 bg-[var(--admin-orange-soft)] p-5"
                >
                  <input type="hidden" name="newsletter_id" value={selected.id} />
                  <p className="text-sm font-semibold text-[var(--admin-orange)]">2 · Send to the loyalty list</p>
                  <p className="text-xs text-[var(--admin-text-muted)]">
                    This emails all <strong>{recipients.total}</strong> loyalty member(s) who gave email consent. Each
                    person gets their own private copy. This can&apos;t be undone.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
                    <input type="checkbox" name="confirm" className="h-4 w-4 accent-[var(--admin-accent)]" />
                    Yes, send “{selected.title}” to {recipients.total} member(s).
                  </label>
                  <Button
                    type="submit"
                    disabled={!cfg.configured || recipients.total === 0}
                    className="bg-[var(--admin-orange)] hover:brightness-110"
                  >
                    Send to {recipients.total} member(s)
                  </Button>
                  <p className="text-[11px] text-[var(--admin-text-faint)]">
                    Every email carries the four required warnings (WAC 314-55-155(7)), a one-click
                    unsubscribe, and skips anyone who bounced or marked a past email as spam.
                  </p>
                </form>
                ) : (
                  <p className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 text-xs text-[var(--admin-text-muted)]">
                    {BROADCAST_GATE_MESSAGE}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* History */}
        {history.length > 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <p className="text-sm font-semibold text-[var(--admin-text)]">Send history</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Newsletter</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Sent / Failed</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">By</th>
                    {canBroadcast ? <th className="py-2 font-medium"><span className="sr-only">Actions</span></th> : null}
                  </tr>
                </thead>
                <tbody className="text-[var(--admin-text-muted)]">
                  {history.map((h) => (
                    <tr key={h.id} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(h.completed_at ?? h.created_at)}</td>
                      <td className="py-2 pr-4">{h.subject}</td>
                      <td className="py-2 pr-4">{h.send_kind === "test" ? "Test" : "Broadcast"}</td>
                      <td className="py-2 pr-4">
                        {h.delivered_count}
                        {h.failed_count > 0 ? <span className="text-[var(--admin-orange)]"> / {h.failed_count}</span> : ""}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusPill status={h.status} />
                      </td>
                      <td className="py-2 pr-4 text-[var(--admin-text-faint)]">{h.sent_by_email ?? "—"}</td>
                      {canBroadcast ? (
                        <td className="py-2">
                          {h.send_kind === "broadcast" && h.failed_count > 0 && h.status !== "sending" ? (
                            <form action={retryFailedNewsletterAction}>
                              <input type="hidden" name="send_id" value={h.id} />
                              <input type="hidden" name="newsletter_id" value={selected?.id ?? ""} />
                              <Button type="submit" variant="neutral" size="sm">
                                Retry failed
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
