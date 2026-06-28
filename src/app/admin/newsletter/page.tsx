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
        <div className="px-5 py-6 text-sm text-[#ffd700] sm:px-8">
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
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        ) : null}
        {sp.tested ? (
          <div className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            Test email sent to {decodeURIComponent(sp.tested)} — check your inbox.
          </div>
        ) : null}
        {sp.sent !== undefined ? (
          <div className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            Sent to {sp.sent} member(s)
            {sp.failed && sp.failed !== "0" ? ` · ${sp.failed} failed` : ""}.
          </div>
        ) : null}

        {/* Config banner */}
        {!cfg.configured ? (
          <div className="rounded-lg border border-[#ffd700]/30 bg-[#ffd700]/5 px-4 py-3 text-sm text-[#ffd700]">
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
          <div className="rounded-2xl border border-dashed border-white/15 bg-[#0f0f0f] p-10 text-center text-sm text-white/70">
            No sendable newsletters yet. Create one under{" "}
            <Link href="/admin/blog" className="text-[#7ed957] hover:underline">
              Blog &amp; Newsletter
            </Link>
            , upload its PDF, and publish it.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            {/* Newsletter picker */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-white/40">Choose a newsletter</p>
              {sendable.map((n) => {
                const active = selected?.id === n.id;
                return (
                  <Link
                    key={n.id}
                    href={`/admin/newsletter?selected=${n.id}`}
                    className={`block rounded-xl border px-4 py-3 text-sm transition ${
                      active
                        ? "border-[#7ed957] bg-[#7ed957]/10 text-white"
                        : "border-white/10 bg-[#0a0a0a] text-white/70 hover:border-white/25"
                    }`}
                  >
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-0.5 text-[11px] text-white/40">
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
                <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
                  <p className="text-sm font-semibold text-white">{selected.title}</p>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-white/50">
                    <a href={selected.publicUrl} target="_blank" rel="noreferrer" className="text-[#7ed957] hover:underline">
                      View public page ↗
                    </a>
                    {selected.pdfUrl ? (
                      <a href={selected.pdfUrl} target="_blank" rel="noreferrer" className="text-[#7ed957] hover:underline">
                        Open PDF ↗
                      </a>
                    ) : null}
                    {selected.lastSentAt ? (
                      <span className="text-[#ffd700]">Already broadcast on {fmtDate(selected.lastSentAt)}</span>
                    ) : null}
                  </div>
                </div>

                {/* Test send */}
                <form
                  action={testSendNewsletterAction}
                  className="space-y-3 rounded-2xl border border-white/10 bg-[#0a0a0a] p-5"
                >
                  <input type="hidden" name="newsletter_id" value={selected.id} />
                  <p className="text-sm font-semibold text-white">1 · Send yourself a test</p>
                  <p className="text-xs text-white/50">Always preview in a real inbox before sending to everyone.</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      name="test_email"
                      type="email"
                      placeholder="you@example.com"
                      className="min-w-56 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                    />
                    <button
                      type="submit"
                      disabled={!cfg.configured}
                      className="rounded-full border border-[#7ed957]/40 px-5 py-2 text-sm font-semibold text-[#7ed957] hover:bg-[#7ed957]/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send test
                    </button>
                  </div>
                </form>

                {/* Broadcast */}
                <form
                  action={broadcastNewsletterAction}
                  className="space-y-3 rounded-2xl border border-[#ff7f00]/25 bg-[#ff7f00]/5 p-5"
                >
                  <input type="hidden" name="newsletter_id" value={selected.id} />
                  <p className="text-sm font-semibold text-[#ff7f00]">2 · Send to the loyalty list</p>
                  <p className="text-xs text-white/60">
                    This emails all <strong>{recipients.total}</strong> loyalty member(s) who gave email consent. Each
                    person gets their own private copy. This can&apos;t be undone.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    <input type="checkbox" name="confirm" className="h-4 w-4 accent-[#7ed957]" />
                    Yes, send “{selected.title}” to {recipients.total} member(s).
                  </label>
                  <button
                    type="submit"
                    disabled={!cfg.configured || recipients.total === 0}
                    className="rounded-full bg-[#ff7f00] px-5 py-2 text-sm font-semibold text-black hover:bg-[#ff941f] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Send to {recipients.total} member(s)
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        )}

        {/* History */}
        {history.length > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-sm font-semibold text-white">Send history</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-white/40">
                  <tr>
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Newsletter</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Sent / Failed</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium">By</th>
                  </tr>
                </thead>
                <tbody className="text-white/70">
                  {history.map((h) => (
                    <tr key={h.id} className="border-t border-white/5">
                      <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(h.completed_at ?? h.created_at)}</td>
                      <td className="py-2 pr-4">{h.subject}</td>
                      <td className="py-2 pr-4">{h.send_kind === "test" ? "Test" : "Broadcast"}</td>
                      <td className="py-2 pr-4">
                        {h.delivered_count}
                        {h.failed_count > 0 ? <span className="text-[#ff7f00]"> / {h.failed_count}</span> : ""}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            h.status === "sent"
                              ? "text-[#7ed957]"
                              : h.status === "failed"
                                ? "text-red-400"
                                : "text-[#ffd700]"
                          }
                        >
                          {h.status}
                        </span>
                      </td>
                      <td className="py-2 text-white/40">{h.sent_by_email ?? "—"}</td>
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
