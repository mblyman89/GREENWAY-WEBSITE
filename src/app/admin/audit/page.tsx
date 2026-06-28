import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
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

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function AuditLogPage() {
  await requirePermission("users.manage");
  const logs = await loadAudit();

  return (
    <div>
      <AdminPageHeader
        title="Audit Log"
        subtitle="Every write action across the back office is recorded here."
        breadcrumbs={<Breadcrumbs items={[{ label: "Audit Log" }]} />}
      />
      <div className="px-5 py-6 sm:px-8">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {logs.map((log) => (
                <tr key={log.id} className="text-white/80">
                  <td className="px-4 py-3 text-xs text-white/50">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-xs">{log.actor_email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-[#7ed957]">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/50">
                    {log.entity_type ? `${log.entity_type}:${log.entity_id}` : "—"}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-white/50">
                    No audit entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
