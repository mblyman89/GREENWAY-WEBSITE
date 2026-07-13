import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { previewLeaflyPush } from "@/lib/leafly/push";
import { listSyndicationLogs } from "@/lib/syndication/store";
import { getLeaflySyncSettings, getSyncState } from "@/lib/syndication/engine-store";
import { classifyHealth, scoreRichness } from "@/lib/syndication/richness-core";
import { runPreflight } from "@/lib/syndication/preflight-core";
import {
  LEAFLY_CONNECT_STEPS,
  SYNDICATION_CONTACTS,
  practicesFor,
  runbookFor,
} from "@/lib/integrations/syndication-playbook";
import {
  ConnectionHealthPanel,
  ConnectionWizard,
  DataQualityPanel,
} from "@/components/admin/syndication/panels";
import { SyncSettingsPanel } from "@/components/admin/syndication/SyncSettingsPanel";
import { saveLeaflySettingsAction, resetLeaflySyncStateAction } from "./actions";
import { LeaflyPushClient } from "./leafly-client";

export const dynamic = "force-dynamic";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default async function LeaflyIntegrationPage() {
  await requirePermission("settings.manage");

  const [preview, logs, settings, syncState] = await Promise.all([
    previewLeaflyPush(),
    listSyndicationLogs("leafly", 40),
    getLeaflySyncSettings(),
    getSyncState("leafly"),
  ]);

  // Health is classified from LIVE attempts that actually contacted Leafly.
  // "skipped" logs (no changes to send / preflight-blocked) transmit nothing,
  // so they are neither a success nor a channel failure.
  const healthEntries = logs
    .filter((log) => log.mode === "live" && log.status !== "skipped")
    .map((log) => ({
      status: log.status === "ok" ? "success" : "error",
      at: log.created_at,
    }));
  const health = classifyHealth(healthEntries, new Date());

  const preflight = runPreflight(preview.items);
  const richness = scoreRichness(preview.items);

  const recentLogs = logs.slice(0, 15);
  const sample = preview.payload.items.slice(0, 3);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Integrations", href: "/admin/integrations" },
          { label: "Leafly" },
        ]}
      />
      <AdminPageHeader
        title="Leafly menu sync"
        subtitle="Build and push the live Menu API v2.0 feed from the published menu."
        help={
          <HelpPanel id="leafly-help" title="How Leafly sync works">
            <p>
              This builds the exact Leafly Menu Integration API v2.0 payload from the
              currently <strong>published</strong> menu version. Hidden items are excluded.
            </p>
            <p>
              <strong>Preview</strong> is a dry-run &mdash; it shows precisely what would be sent and
              never contacts Leafly. <strong>Live push</strong> (POST) is a full sync that
              replaces the Leafly menu and requires credentials plus explicit confirmation.
              Preflight errors block live pushes; the engine skips syncs when nothing changed.
            </p>
            <p>
              AI description drafts are <strong>drafts only</strong> &mdash; review and approve before
              attaching them to a product. Leafly descriptions must be plain text.
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
              ? "Key + OAuth set"
              : "Set key + OAuth to enable live push"
          }
          accent={preview.readiness.configured ? "green" : "orange"}
        />
      </div>

      <ConnectionWizard
        channelLabel="Leafly"
        connectSteps={LEAFLY_CONNECT_STEPS}
        practices={practicesFor("leafly")}
        runbook={runbookFor("leafly")}
        contacts={SYNDICATION_CONTACTS}
        configured={preview.readiness.configured}
      />

      <ConnectionHealthPanel health={health} lastSyncedAt={syncState.lastSyncedAt} />

      <DataQualityPanel
        richness={richness}
        preflight={preflight}
        channelLabel="Leafly"
        imageRelevant={false}
      />

      <LeaflyPushClient
        configured={preview.readiness.configured}
        itemCount={preview.itemCount}
      />

      <SyncSettingsPanel
        channel="leafly"
        settings={settings}
        saveAction={saveLeaflySettingsAction}
        resetStateAction={resetLeaflySyncStateAction}
      />

      <Card>
        <h2 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
          Payload preview (first {sample.length} of {preview.itemCount})
        </h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          This is the exact JSON that would be sent to{" "}
          <span className="font-mono">{preview.readiness.baseUrl}/.../menu/items</span>.
        </p>
        <pre className="max-h-96 overflow-auto rounded-md bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-text)]">
          {JSON.stringify({ items: sample }, null, 2)}
        </pre>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Recent sync activity</h2>
        {recentLogs.length === 0 ? (
          <p className="text-xs text-[var(--admin-text-muted)]">
            No Leafly sync activity recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {recentLogs.map((log) => (
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
