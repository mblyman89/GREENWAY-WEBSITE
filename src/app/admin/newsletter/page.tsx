import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
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
import { testSendNewsletterAction, broadcastNewsletterAction } from "./actions";
import { Button } from "@/components/admin/ui/Button";
import { Input } from "@/components/admin/ui/Field";
import { StatusPill, EmptyState } from "@/components/admin/ux";

export const dynamic = "force-dynamic";

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
  }>;
}) {
  await requirePermission("blog.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Newsletter Send Center" subtitle="Email a published newsletter to your loyalty list." />
        <div className="px-5 py-6 text-sm text-[var(--admin-gold)] sm:px-8">
          Supabase is not configured yet. Connect the database and apply migrations through 0016.
        </div>
      </div>
    );
  }

  const cfg = newsletterSendConfig();
  const [newsletters, recipients, history] = await Promise.all([
    listSendableNewsletters(),
    getRecipientStats(),
    listSendHistory(20),
  ]);

  const sendable = newsletters.filter((n) => n.status === "published" && n.pdfUrl);
  const selected: SendableNewsletter | null =
    sendable.find((n) => n.id === sp.selected) ?? sendable[0] ?? null;

  return (
    <div>
      <AdminPageHeader
        title="Newsletter Send Center"
        subtitle="Pick a published newsletter and email a branded announcement to your loyalty members."
        breadcrumbs={<Breadcrumbs items={[{ label: "Newsletter Send" }]} />}
        help={
          <HelpPanel
            id="newsletter-send"
            title="How sending works"
            steps={[
              "Design your newsletter in Canva and export a PDF.",
              "Upload it under Blog & Newsletter (set type = Newsletter) and Publish.",
              "Come here, pick it, and send a Test to yourself first.",
              "Happy? Tick the confirm box and Send to the loyalty list.",
            ]}
          >
            <p>
              Members receive a branded email with a “Read the newsletter” button.
              Only members who gave email consent are included, and each person
              gets their own private copy.
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
                    <Button type="submit" variant="subtle" disabled={!cfg.configured}>
                      Send test
                    </Button>
                  </div>
                </form>

                {/* Broadcast */}
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
                </form>
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
                    <th className="py-2 font-medium">By</th>
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
                      <td className="py-2 text-[var(--admin-text-faint)]">{h.sent_by_email ?? "—"}</td>
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
