/**
 * src/components/admin/reports/NewsletterStatsSection.tsx  (Slice 50)
 *
 * The dedicated newsletter statistics suite rendered inside the Customers
 * report tab: KPI cards (sent, delivered, opened/read, clicked, return-to-
 * sender, rejected-as-spam, unsubscribed) with rates, a per-campaign table
 * with CSV/XLSX export, and an open-rate bar across campaigns.
 *
 * Provider-agnostic: the numbers come from newsletter_email_events, which is
 * fed by BOTH the Resend and SendGrid webhooks. A short note explains where the
 * data comes from + how to enable it if no events have arrived yet.
 */
import { StatCard } from "@/components/admin/StatCard";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { BarList, REPORT_COLORS } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import type { NewsletterStats, CampaignStats } from "@/lib/reports/newsletter-stats";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const CAMPAIGN_COLUMNS: ReportColumn<CampaignTableRow>[] = [
  { key: "subject", header: "Newsletter", align: "left" },
  { key: "sentDate", header: "Sent", align: "left" },
  { key: "recipients", header: "Audience", align: "right" },
  { key: "delivered", header: "Delivered", align: "right" },
  { key: "openedDisplay", header: "Opened", align: "right" },
  { key: "clickedDisplay", header: "Clicked", align: "right" },
  { key: "returnToSender", header: "Return to sender", align: "right" },
  { key: "complained", header: "Rejected", align: "right" },
  { key: "unsubscribed", header: "Unsub", align: "right" },
];

type CampaignTableRow = CampaignStats &
  Record<string, unknown> & {
    sentDate: string;
    openedDisplay: string;
    clickedDisplay: string;
  };

function Section({
  title,
  subtitle,
  exportHref,
  children,
}: {
  title: string;
  subtitle?: string;
  exportHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-white/45">{subtitle}</p> : null}
        </div>
        {exportHref ? <ExportButtons baseHref={exportHref} /> : null}
      </div>
      {children}
    </section>
  );
}

export function NewsletterStatsSection({
  stats,
  exportHref,
}: {
  stats: NewsletterStats;
  exportHref: string;
}) {
  const t = stats.totals;
  const hasData = t.campaigns > 0 && (t.delivered > 0 || t.opened > 0 || t.recipients > 0);

  const rows: CampaignTableRow[] = stats.campaigns.map((c) => ({
    ...c,
    sentDate: c.sentAt ? new Date(c.sentAt).toLocaleDateString("en-US") : "—",
    openedDisplay: `${c.opened.toLocaleString()} (${pct(c.openRate)})`,
    clickedDisplay: `${c.clicked.toLocaleString()} (${pct(c.clickRate)})`,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-base">📨</span>
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-white/80">
          Newsletter statistics
        </h2>
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/55">
          <p className="font-bold text-white/75">No newsletter engagement data yet for this range.</p>
          <p className="mt-2 text-xs leading-relaxed text-white/45">
            Stats appear here once your email provider reports opens, clicks and bounces. This is
            powered by a signature-verified webhook that accepts events from <strong>Resend</strong>{" "}
            (your current sender) and <strong>SendGrid</strong>. To enable: add the webhook endpoint{" "}
            <code className="rounded bg-black/30 px-1">/api/webhooks/resend</code> (and/or{" "}
            <code className="rounded bg-black/30 px-1">/api/webhooks/sendgrid</code>) in the provider
            dashboard, enable open &amp; click tracking, and set the signing secret env var. New
            broadcasts are automatically tagged so their stats land here.
          </p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Delivered"
              value={t.delivered.toLocaleString()}
              hint={`${t.recipients.toLocaleString()} sent across ${t.campaigns} campaign${t.campaigns === 1 ? "" : "s"}`}
              accent="green"
            />
            <StatCard
              label="Opened (read)"
              value={pct(t.openRate)}
              hint={`${t.opened.toLocaleString()} unique opens`}
              accent="gold"
            />
            <StatCard
              label="Clicked"
              value={pct(t.clickRate)}
              hint={`${t.clicked.toLocaleString()} clicks · ${pct(t.clickToOpenRate)} of opens`}
              accent="gold"
            />
            <StatCard
              label="Return to sender"
              value={t.returnToSender.toLocaleString()}
              hint={`${pct(t.bounceRate)} bounce rate · ${t.bounced.toLocaleString()} hard`}
              accent="orange"
            />
            <StatCard
              label="Rejected (spam)"
              value={t.complained.toLocaleString()}
              hint={`${pct(t.complaintRate)} complaint rate`}
              accent="orange"
            />
            <StatCard
              label="Unsubscribed"
              value={t.unsubscribed.toLocaleString()}
              hint={`${pct(t.unsubscribeRate)} of delivered`}
              accent="muted"
            />
            <StatCard
              label="Failed to send"
              value={t.failed.toLocaleString()}
              hint="Dropped before delivery"
              accent="muted"
            />
            <StatCard
              label="Opens incl. machine"
              value={t.openedIncludingMachine.toLocaleString()}
              hint="Apple Mail / proxy opens included"
              accent="muted"
            />
          </div>

          {/* Open rate per campaign */}
          <Section
            title="Open rate by campaign"
            subtitle="Unique human opens ÷ delivered. Machine (Apple Mail Privacy) opens excluded."
          >
            <BarList
              data={stats.campaigns.map((c) => ({ label: c.subject, value: c.openRate }))}
              valueFormatter={(n) => pct(n)}
              color={REPORT_COLORS.GOLD}
              emptyLabel="No campaigns in range."
            />
          </Section>

          {/* Per-campaign table */}
          <Section
            title="Per-campaign breakdown"
            subtitle="Each broadcast with delivery, engagement and deliverability."
            exportHref={exportHref}
          >
            <ReportTable columns={CAMPAIGN_COLUMNS} rows={rows} emptyLabel="No campaigns in range." />
          </Section>
        </>
      )}
    </div>
  );
}
