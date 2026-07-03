import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { getKbCounts, listKbBanned } from "@/lib/ai/kb/store";
import {
  addBannedPhraseAction,
  toggleBannedAction,
  seedMedicalBlocklistAction,
} from "../actions";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

export default async function KbCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [counts, banned] = await Promise.all([getKbCounts(), listKbBanned(200)]);

  return (
    <div>
      <AdminPageHeader
        title="Compliance guardrails"
        subtitle="Extra words the AI must never use — checked on top of the built-in WA rules"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Compliance" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Banned phrases ({counts.banned})</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            A <strong>block</strong> phrase means a draft must be edited before it can be accepted; a{" "}
            <strong>warn</strong> is just a heads-up.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <form action={seedMedicalBlocklistAction}>
              <Button type="submit" variant="neutral" disabled={!counts.migrated}>
                Sync medical-claim blocklist
              </Button>
            </form>
          </div>
          <form action={addBannedPhraseAction} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Phrase</span>
              <input name="phrase" required className="mt-1 w-64 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="e.g. couch lock" />
            </label>
            <label className="text-sm">
              <span className="block text-[var(--admin-text-muted)]">Severity</span>
              <select name="severity" className="mt-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]">
                <option value="block">Block</option>
                <option value="warn">Warn</option>
              </select>
            </label>
            <label className="text-sm flex-1 min-w-[12rem]">
              <span className="block text-[var(--admin-text-muted)]">Reason (optional)</span>
              <input name="reason" className="mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-[var(--admin-text)]" placeholder="why it's banned" />
            </label>
            <Button type="submit" variant="neutral" disabled={!counts.migrated}>Add phrase</Button>
          </form>

          {banned.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--admin-text-muted)]">
                    <th className="py-2 pr-4 font-medium">Phrase</th>
                    <th className="py-2 pr-4 font-medium">Severity</th>
                    <th className="py-2 pr-4 font-medium">Reason</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {banned.map((b) => (
                    <tr key={b.id} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-4 text-[var(--admin-text)]">{b.phrase}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)] capitalize">{b.severity}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{b.reason ?? "—"}</td>
                      <td className="py-2 pr-4 text-[var(--admin-text-muted)]">{b.active ? "Active" : "Disabled"}</td>
                      <td className="py-2 pr-4">
                        <form action={toggleBannedAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="active" value={(!b.active).toString()} />
                          <button type="submit" className="text-xs text-[var(--admin-accent)] hover:underline">
                            {b.active ? "Disable" : "Enable"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
