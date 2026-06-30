import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { previewWeedmapsPush } from "@/lib/weedmaps/push";
import { listSyndicationLogs } from "@/lib/syndication/store";
import { WeedmapsPushClient } from "./weedmaps-client";

export const dynamic = "force-dynamic";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default async function WeedmapsIntegrationPage() {
  await requirePermission("settings.manage");

  const preview = await previewWeedmapsPush();
  const logs = await listSyndicationLogs("weedmaps", 15);

  const sample = preview.payload.items.slice(0, 3);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Integrations", href: "/admin/integrations" },
          { label: "WeedMaps" },
        ]}
      />
      <AdminPageHeader
        title="WeedMaps menu sync"
        subtitle="Build and push the WeedMaps Menu API (2025-07) feed from the published menu."
        help={
          <HelpPanel id="weedmaps-help" title="How WeedMaps sync works">
            <p>
              This builds the WeedMaps Menu API payload from the currently{" "}
              <strong>published</strong> menu version. Hidden items are excluded. Each item is
              keyed by a stable <span className="font-mono">external_id</span> (our POS product
              key) so WeedMaps&rsquo; curated brand/product links survive every sync.
            </p>
            <p>
              <strong>Preview</strong> is a dry-run &mdash; it shows precisely what would be sent
              and never contacts WeedMaps. <strong>Live push</strong> requires credentials plus
              explicit confirmation, and sends each item to{" "}
              <span className="font-mono">/partners/menus/&#123;menu_id&#125;/items</span>.
            </p>
            <p>
              AI description drafts are <strong>drafts only</strong> &mdash; review and approve
              before attaching them to a product. WeedMaps descriptions are plain text.
            </p>
          </HelpPanel>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Items in feed"
          value={String(preview.itemCount)}
          hint="Published, non-hidden"
          accent="green"
        />
        <StatCard
          label="Environment"
          value={preview.readiness.environment}
          hint={preview.readiness.baseUrl}
          accent="muted"
        />
        <StatCard
          label="Credentials"
          value={preview.readiness.configured ? "Ready" : "Incomplete"}
          hint={
            preview.readiness.configured
              ? "Menu id + auth set"
              : "Set menu id + OAuth (or access token) to enable live push"
          }
          accent={preview.readiness.configured ? "green" : "orange"}
        />
      </div>

      <WeedmapsPushClient
        configured={preview.readiness.configured}
        itemCount={preview.itemCount}
      />

      <Card>
        <h2 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
          Payload preview (first {sample.length} of {preview.itemCount})
        </h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          This is the exact JSON that would be sent to{" "}
          <span className="font-mono">{preview.readiness.baseUrl}/menus/&#123;menu_id&#125;/items</span>.
        </p>
        <pre className="max-h-96 overflow-auto rounded-md bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-text)]">
          {JSON.stringify({ items: sample }, null, 2)}
        </pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-[var(--admin-text-muted)]">
          {preview.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Recent sync activity</h2>
        {logs.length === 0 ? (
          <p className="text-xs text-[var(--admin-text-muted)]">
            No WeedMaps sync activity recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-md border border-[var(--admin-border)] px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    tone={log.status === "ok" ? "green" : log.status === "error" ? "danger" : "neutral"}
                  >
                    {log.status}
                  </Badge>
                  <span className="font-medium text-[var(--admin-text)]">{log.mode}</span>
                  <span className="text-[var(--admin-text-muted)]">{log.item_count} items</span>
                  {log.message ? (
                    <span className="text-[var(--admin-text-muted)]">&mdash; {log.message}</span>
                  ) : null}
                </div>
                <span className="text-[var(--admin-text-muted)]">{fmtDate(log.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
