import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isAiConfigured } from "@/lib/ai/provider";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { humanizeAction, TONE_BADGE } from "@/lib/admin/audit-humanize";
import { AuditTimeline, type AuditEntry } from "@/components/admin/AuditTimeline";
import { AuditAnomalyPanel, type AnomalyPanelReport } from "@/components/admin/AuditAnomalyPanel";
import { getAuditAnomalyReport } from "@/lib/admin/audit-anomaly";
import { categorize, isSensitive } from "@/lib/admin/audit-anomaly-core";
import type { AuditLog } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// Load a wider window than before so the timeline filters (date range,
// category, sensitive-only) and the anomaly review have real depth to work
// with. The anomaly detector reads the same window size (see audit-anomaly.ts).
const WINDOW = 500;

async function loadAudit(): Promise<AuditLog[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(WINDOW);
  return (data as AuditLog[]) ?? [];
}

function dayLabel(value: string): string {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(d);
  } catch {
    return value.slice(0, 10);
  }
}

function timeLabel(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function AuditLogPage() {
  await requirePermission("users.manage");
  const logs = await loadAudit();

  // Humanize + classify once on the server; the client timeline filters/searches these.
  const entries: AuditEntry[] = logs.map((log) => {
    const h = humanizeAction(log.action);
    return {
      id: log.id,
      actorEmail: log.actor_email ?? null,
      phrase: h.phrase,
      icon: h.icon,
      tone: h.tone,
      toneBadge: TONE_BADGE[h.tone],
      entityType: log.entity_type ?? null,
      entityId: log.entity_id ? String(log.entity_id) : null,
      createdAt: log.created_at,
      dayLabel: dayLabel(log.created_at),
      timeLabel: timeLabel(log.created_at),
      category: categorize(log.action),
      sensitive: isSensitive(log.action),
    };
  });

  // Deterministic anomaly review over the same window (drafts-only AI summary
  // is fetched on demand from the client via the server action).
  const full = await getAuditAnomalyReport(WINDOW);
  const report: AnomalyPanelReport = {
    windowCount: full.windowCount,
    actorCount: full.actorCount,
    sensitiveCount: full.sensitiveCount,
    counts: full.counts,
    anomalies: full.anomalies.map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      evidenceCount: a.evidenceIds.length,
      actor: a.actor ?? null,
      category: a.category,
    })),
  };

  return (
    <div>
      <AdminPageHeader
        title="Activity Log"
        subtitle="A plain-language history of every change made across the back office."
        breadcrumbs={<Breadcrumbs items={[{ label: "Activity Log" }]} />}
        help={
          <HelpPanel
            id="audit"
            title="How the activity log works"
            steps={[
              "Every change anyone makes is recorded automatically.",
              "The security review at the top flags anything unusual for you.",
              "Filter by date, person, category, record type, or 'sensitive only'.",
              "Each line says who did what and when.",
            ]}
          >
            <p>This is a read-only record — nothing here can be edited or deleted, so it&apos;s always trustworthy.</p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {entries.length === 0 ? (
          <EmptyState
            icon="📜"
            title="No activity yet"
            description="As soon as anyone makes a change — publishing a vendor, moving an order, inviting a teammate — it'll show up here as a clear, time-stamped entry."
          />
        ) : (
          <>
            <AuditAnomalyPanel report={report} aiEnabled={isAiConfigured} />
            <AuditTimeline entries={entries} />
          </>
        )}
      </div>
    </div>
  );
}
