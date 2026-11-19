/**
 * D256 S2 - CCRS stale-lot clean-up (Part 17 §E). The equalize script's rules
 * on one page: plan a wave, store it, upload it from the hub, apply its
 * email, then store its Reconciliation file. Owner/admin only.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { CcrsCleanupPanel } from "@/components/admin/compliance/CcrsCleanupPanel";
import { listCleanupFiles } from "@/lib/compliance/ccrs-equalize-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function CcrsCleanupPage() {
  const session = await requirePermission("reports.view");
  const canEdit = can(session.profile.role, "settings.manage");
  const files = await listCleanupFiles().catch(() => []);
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 text-white">
      <Link href="/admin/compliance/ccrs" className="text-sm text-emerald-300 hover:underline">← CCRS hub</Link>
      <h1 className="text-2xl font-bold">Stale-lot clean-up (production)</h1>
      <div className="space-y-1 text-sm text-white/70">
        <p>Zeroes, in waves of up to 10,000, the old Cultivera lots CCRS still shows open that we no longer have, as the examiner directed: an Inventory Update to 0, then a Reconciliation adjustment.</p>
        <p>Never touched: any lot in our system, any lot our own files sent, any barcode scanned in the 10/30 count, any lot created on or after today, and lots already at 0. Brian&apos;s answers are used: cost 0.01 where CCRS shows 0, the strain already filed, separate files.</p>
        <p>Do one wave at a time, on a day without the weekly upload. Upload each stored file from the CCRS hub and apply its email before the next step.</p>
      </div>
      {canEdit ? <CcrsCleanupPanel /> : <p className="text-sm text-white/60">Only an owner or admin can run the clean-up.</p>}
      <div>
        <h2 className="mb-2 font-bold">Clean-up files so far</h2>
        {files.length === 0 ? <p className="text-sm text-white/60">None yet.</p> : (
          <ul className="space-y-1 text-sm text-white/80">{files.map((f) => <li key={f.file_name}>{f.wave ?? "?"} · {f.file_type} · {f.file_name} · {f.state}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
