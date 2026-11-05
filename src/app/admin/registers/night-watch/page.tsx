/**
 * /admin/registers/night-watch  (D182, round slice S5)
 *
 * The night watch's morning report in full, plus (owner only) the switches
 * for the email and text versions. Owner (2026-11-04): "Nudges by admin
 * screens only for now, it build the email and text options so I can use it
 * if needed." So both channels start OFF and this page is where they turn on.
 *
 * Any staff login sees the crew's list (requirePermission orders.manage);
 * the owner sees everything plus the settings.
 */
import { requirePermission } from "@/lib/auth/session";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card } from "@/components/admin/ui";
import { PendingSubmit } from "@/components/admin/compliance/PendingSubmit";
import { MorningReportPanel } from "@/components/admin/registers/MorningReportPanel";
import { channelReadiness, getNotifySettings, morningReportNow } from "@/lib/registers/night-watch-store";
import { saveNightWatchNotifyAction, sendNightWatchTestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NightWatchPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; sent?: string }> }) {
  const session = await requirePermission("orders.manage");
  const isOwner = canReadBooks(session.profile.role);
  const sp = await searchParams;
  const [report, settings] = await Promise.all([morningReportNow(), isOwner ? getNotifySettings() : Promise.resolve(null)]);
  const readiness = settings ? channelReadiness(settings) : null;

  return (
    <div>
      <AdminPageHeader
        title="Night watch"
        subtitle="Every morning: what was left undone last night, who owes it, and where to fix it."
        breadcrumbs={<Breadcrumbs items={[{ label: "Register Activity", href: "/admin/registers" }, { label: "Night watch" }]} />}
        action={
          <Button href="/admin/registers" variant="neutral" size="sm">
            Back to Register Activity
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            {sp.error}
          </div>
        ) : null}
        {sp.saved ? (
          <div role="status" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            Saved.
          </div>
        ) : null}
        {sp.sent ? (
          <div role="status" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.sent}
          </div>
        ) : null}

        <MorningReportPanel isOwner={isOwner} report={report} />

        <HelpPanel
          id="night-watch"
          title="How the night watch works"
          steps={[
            "Every morning before opening it checks: drawers left open, second counts and reconciles not done, a missing or mismatched deposit bag, register sales waiting for a decision, second counts that look copied, over/shorts with no reason, people still on the clock, and the database health check.",
            "Urgent items are first, and the crew's jobs come before Michael's (the crew is in the building first).",
            "It never locks anyone out. It names the gap and who owes it, every morning, until it is fixed.",
            "It shows on the admin home page and here. Email and text are built but OFF until Michael turns them on below.",
          ]}
        />

        {isOwner && settings && readiness ? (
          <Card>
            <form action={saveNightWatchNotifyAction} className="space-y-4 p-5" data-testid="night-watch-settings">
              <h2 className="text-base font-bold text-[var(--admin-text)]">Send the morning report to phones (Michael only)</h2>
              <p className="text-sm text-[var(--admin-text-muted)]">
                Off by default: the report shows on the admin screens only. Turn on email and/or text when you want the crew nagged on their phones. One message per
                morning, sent with the database health check (about 6:30 am).
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" name="emailEnabled" defaultChecked={settings.emailEnabled} data-testid="nw-email-on" /> Email the report
                  </label>
                  <label className="block text-xs text-[var(--admin-text-muted)]">
                    Email addresses (one per line). Empty = the staff alert list.
                    <textarea name="emailTo" rows={3} defaultValue={settings.emailTo.join("\n")} className="mt-1 w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 text-sm" />
                  </label>
                  <p className={`text-xs ${readiness.ready.emailProvider ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>
                    {readiness.ready.emailProvider
                      ? `Email service is set up. Would send to ${readiness.emailTo.length} address(es).`
                      : "Email service is not set up (RESEND_API_KEY and ORDER_EMAIL_FROM on Vercel)."}
                  </p>
                </fieldset>
                <fieldset className="space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" name="smsEnabled" defaultChecked={settings.smsEnabled} data-testid="nw-sms-on" /> Text the report
                  </label>
                  <label className="block text-xs text-[var(--admin-text-muted)]">
                    Phone numbers (one per line, e.g. 360-555-0123)
                    <textarea name="smsTo" rows={3} defaultValue={settings.smsTo.join("\n")} className="mt-1 w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 text-sm" />
                  </label>
                  <p className={`text-xs ${readiness.ready.smsProvider ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>
                    {readiness.ready.smsProvider
                      ? "Text service is set up."
                      : "Text service is not set up yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM on Vercel (a Twilio account, about $0.01 a text)."}
                  </p>
                </fieldset>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sendAllClear" defaultChecked={settings.sendAllClear} /> Also send on mornings when everything is clear
              </label>
              <PendingSubmit busy="Saving…" testId="nw-save" className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white">
                Save
              </PendingSubmit>
            </form>
            <form action={sendNightWatchTestAction} className="border-t border-[var(--admin-border)] px-5 py-4">
              <PendingSubmit busy="Sending…" testId="nw-test" className="rounded-lg border border-[var(--admin-border-strong)] px-4 py-2 text-sm font-semibold">
                Send this morning&apos;s report now (test)
              </PendingSubmit>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">Uses the channels switched on above. Does not count as the daily message.</p>
            </form>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
