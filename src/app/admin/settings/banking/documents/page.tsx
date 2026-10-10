import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listAchDocuments } from "@/lib/payments/ach-document-store";
import { DOC_KIND_LABELS, INTAKE_LABELS } from "@/lib/payments/ach-document-intake-core";

export const dynamic = "force-dynamic";

/** R39 S5 — the vault's review queue for dropped ACH documents (owner/admin). */
export default async function AchDocumentQueuePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const q = await listAchDocuments({ queue: true });
  const names = new Map<string, string>();
  if (isSupabaseServiceConfigured && q.documents.length) {
    const admin = createSupabaseAdminClient();
    const empIds = [...new Set(q.documents.map((d) => d.employee_id).filter((x): x is string => Boolean(x)))];
    const venIds = [...new Set(q.documents.map((d) => d.vendor_id).filter((x): x is string => Boolean(x)))];
    if (empIds.length) {
      const { data } = await admin.from("employees").select("id, full_name").in("id", empIds);
      for (const e of (data ?? []) as { id: string; full_name: string }[]) names.set(e.id, e.full_name);
    }
    if (venIds.length) {
      const { data } = await admin.from("vendors").select("id, display_name").in("id", venIds);
      for (const v of (data ?? []) as { id: string; display_name: string }[]) names.set(v.id, v.display_name);
    }
  }
  return (
    <div>
      <AdminPageHeader
        title="ACH documents to review"
        subtitle="Signed forms and supporting documents dropped by managers. Open each one, enter the bank details blind, and accept or reject it."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Banking", href: "/admin/settings/banking" }, { label: "Documents" }]} />
        }
      />
      <div className="px-5 py-6 sm:px-8">
        {sp.ok ? <p className="mb-4 rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-3 py-2 text-sm text-[var(--admin-accent)]">{sp.ok}</p> : null}
        {sp.error ? <p role="alert" className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{sp.error}</p> : null}
        {!q.tableReady ? (
          <p role="alert" className="text-sm text-[var(--admin-orange)]">One-time setup needed: apply migration 0258 (docs/MIGRATIONS_TO_RUN.md).</p>
        ) : q.error ? (
          <p role="alert" className="text-sm text-[var(--admin-orange)]">The queue could not be read: {q.error}</p>
        ) : q.documents.length === 0 ? (
          <p className="text-sm text-white/50">Nothing waiting. Managers drop documents from the employee file or the vendor page.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-white/40">
              <tr>
                <th className="py-2 pr-3 font-medium">Payee</th>
                <th className="py-2 pr-3 font-medium">Document</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Dropped</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="text-white/80">
              {q.documents.map((d) => {
                const pid = (d.employee_id ?? d.vendor_id) as string;
                return (
                  <tr key={d.id} className="border-t border-white/5">
                    <td className="py-2 pr-3">
                      <Badge tone="neutral">{d.payee_type}</Badge> {names.get(pid) ?? "Unknown"}
                    </td>
                    <td className="py-2 pr-3">{DOC_KIND_LABELS[d.kind]}<span className="text-white/40"> · {d.original_filename}</span></td>
                    <td className="py-2 pr-3 text-xs">{INTAKE_LABELS[d.intake_status]}</td>
                    <td className="py-2 pr-3 text-xs">{d.uploaded_at.slice(0, 10)}</td>
                    <td className="py-2">
                      <Link href={`/admin/settings/banking/documents/${d.id}`} className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">Review →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
