import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Button } from "@/components/admin/ui";
import { listManifests, countManifestsByStatus } from "@/lib/inventory/intake-store";
import { importManifestAction, importManifestFromUrlAction } from "./actions";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
    accepted: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
    rejected: "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]",
  };
  const cls = map[status] ?? "bg-white/10 text-[var(--admin-text-muted)]";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { error } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Vendor intake" subtitle="Import vendor JSON manifests." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Apply migration 0023 to enable intake.
          </div>
        </div>
      </div>
    );
  }

  const [manifests, counts] = await Promise.all([
    listManifests(),
    countManifestsByStatus(),
  ]);

  const errorMsg =
    error === "empty"
      ? "Paste the vendor JSON before importing."
      : error === "emptyurl"
        ? "Paste the Transfer Data Link before importing."
        : error === "fetch"
          ? "Couldn't fetch that link — it may have expired or be unreachable. Paste the JSON directly instead."
          : error === "parse"
            ? "That text isn't valid JSON."
            : error === "nolines"
              ? "No line items were found in that JSON."
              : error === "save"
                ? "Something went wrong staging the manifest."
                : null;

  return (
    <div>
      <AdminPageHeader
        title="Vendor intake"
        subtitle="Paste a vendor JSON manifest and we'll draft the manifest, COAs, and lots for you to review. Nothing goes live until you accept it — the whole point of doing this better than everyone else."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: "Vendor intake" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="intake"
            title="How vendor intake works"
            steps={[
              "Paste the Transfer Data Link from the order email (fastest) — or paste the raw JSON.",
              "We pull every product, COA, and potency from the one transfer file. No clicking each COA link.",
              "We stage a DRAFT manifest: pending status, lots in quarantine, COAs captured to the KB.",
              "Review the parsed lines + warnings, then accept to activate or reject to discard.",
            ]}
          >
            <p>
              The order email gives each product its own &ldquo;download COA&rdquo; link, but the single
              Transfer Data Link already contains all of them. Paste that one link and we grab every
              certificate of analysis for you — no more clicking them one at a time.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Pending review" value={counts.pending} accent={counts.pending > 0 ? "gold" : "muted"} />
          <StatCard label="Accepted" value={counts.accepted} accent="green" />
          <StatCard label="Rejected" value={counts.rejected} accent="muted" />
        </div>

        {errorMsg && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {errorMsg}
          </div>
        )}

        {/* Import by Transfer Data Link (preferred) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Import from Transfer Data Link <span className="text-[var(--admin-accent)]">(recommended)</span>
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Copy the &ldquo;Transfer Data Link&rdquo; from the order email and paste it here. We fetch the
            full transfer — every product and every COA — so you never click the per-product COA links.
          </p>
          <form action={importManifestFromUrlAction} className="space-y-4">
            <Field
              label="Transfer Data Link"
              help="The single link from the vendor email that contains all products + COAs."
              htmlFor="transfer_url"
              required
            >
              <Input
                id="transfer_url"
                name="transfer_url"
                type="url"
                placeholder="https://app.cultivera.com/..."
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Fetch & stage for review
            </Button>
          </form>
        </div>

        {/* Import by pasting raw JSON (fallback) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Or paste the JSON directly</h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            If the link won&apos;t fetch, paste the raw transfer JSON from the email instead.
          </p>
          <form action={importManifestAction} className="space-y-4">
            <Field
              label="Vendor JSON"
              help="Paste the full JSON the vendor sent (product + COA/QA)."
              htmlFor="json_text"
              required
            >
              <Textarea
                id="json_text"
                name="json_text"
                rows={10}
                placeholder='{ "manifest_number": "...", "vendor": "...", "items": [ ... ] }'
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Parse & stage for review
            </Button>
          </form>
        </div>

        {/* Recent manifests */}
        <div>
          <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Recent imports</h2>
          {manifests.length === 0 ? (
            <EmptyState
              icon="📥"
              title="No imports yet"
              description="Paste a vendor JSON above to stage your first manifest."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">Manifest</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Transfer date</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {manifests.map((m) => (
                    <tr key={m.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/inventory/intake/${m.id}`}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          {m.manifest_number ?? "(no number)"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{m.vendor_label ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{m.transfer_date ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={m.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
