import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { humanizeAction, TONE_BADGE } from "@/lib/admin/audit-humanize";
import type { AuditLog } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

async function loadAudit(): Promise<AuditLog[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
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

function initials(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0];
  const parts = name.split(/[.\-_]/).filter(Boolean);
  return (parts[0]?.[0] ?? name[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export default async function AuditLogPage() {
  await requirePermission("users.manage");
  const logs = await loadAudit();

  // Group by day for the timeline.
  const groups: { day: string; items: AuditLog[] }[] = [];
  for (const log of logs) {
    const day = dayLabel(log.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(log);
    else groups.push({ day, items: [log] });
  }

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
              "Entries are grouped by day, newest first.",
              "Each line says who did what and when.",
              "Use this to answer 'who changed this?' with confidence.",
            ]}
          >
            <p>This is a read-only record — nothing here can be edited or deleted, so it&apos;s always trustworthy.</p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {logs.length === 0 ? (
          <EmptyState
            icon="📜"
            title="No activity yet"
            description="As soon as anyone makes a change — publishing a vendor, moving an order, inviting a teammate — it'll show up here as a clear, time-stamped entry."
          />
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group.day}>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white/40">{group.day}</h2>
                <div className="relative space-y-3 border-l border-white/10 pl-5">
                  {group.items.map((log) => {
                    const h = humanizeAction(log.action);
                    return (
                      <div key={log.id} className="relative">
                        {/* timeline dot */}
                        <span className="absolute -left-[1.45rem] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-[#0a0a0a] text-[10px]">
                          {h.icon}
                        </span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7ed957]/15 text-[10px] font-bold text-[#7ed957]">
                            {initials(log.actor_email)}
                          </span>
                          <span className="text-sm text-white/85">
                            <strong className="font-semibold text-white">{log.actor_email ?? "Someone"}</strong>{" "}
                            {h.phrase}
                          </span>
                          {log.entity_type && (
                            <span className="text-xs text-white/35">
                              ({log.entity_type}
                              {log.entity_id ? `:${String(log.entity_id).slice(0, 8)}` : ""})
                            </span>
                          )}
                          <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONE_BADGE[h.tone]}`}>
                            {timeLabel(log.created_at)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
