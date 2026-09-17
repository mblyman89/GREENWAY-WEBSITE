import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { previewLeaflyPush } from "@/lib/leafly/push";
import { assessMenuCertificationReadiness } from "@/lib/leafly/certification-core";
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

/**
 * SLICE L-4. Is there an automatic, scheduled Leafly menu sync?
 *
 * No. Verified against `vercel.json`, which declares three crons
 * (compliance-reminders, regulatory-watch, atm-sync) and no Leafly sync. Leafly's menu
 * certification checklist grades sync cadence, so this is a real blocker and it is stated
 * as a named constant instead of being buried in a boolean expression.
 *
 * Flip this to `true` in the same commit that adds the cron -- not before.
 * `tests/compliance/leafly-certification.test.ts` reads `vercel.json` and fails if this
 * constant and reality disagree in either direction.
 */
const LEAFLY_SCHEDULED_SYNC_EXISTS = false;

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

  // SLICE L-4 -- grade Leafly's five published menu-certification criteria.
  //
  // Every input below is DERIVED FROM RECORDED FACTS. Nothing is defaulted
  // optimistically, and the two questions this page cannot answer are passed as
  // `null` so the gate reports them as untested/needs-confirmation rather than
  // inventing a pass (rule 3).
  const livePushes = logs
    .filter((log) => log.mode === "live" && log.status !== "skipped")
    .slice()
    // listSyndicationLogs returns newest-first; the criterion about errors being
    // "corrected on subsequent requests" depends on chronological order, so this
    // reversal is load-bearing rather than cosmetic.
    .reverse();

  // The HTTP status is not a column on syndication_logs, so it is read from the
  // recorded status field rather than guessed: "ok" means Leafly returned a
  // 200-level response (that is what pushLeaflyMenu sets it from), anything else
  // was a failure. Using 200/0 as stand-ins keeps the gate honest about success
  // and failure without pretending to know an exact code we did not store.
  const recentPushStatuses = livePushes.map((log) => (log.status === "ok" ? 200 : 0));

  // A successful live push proves the token exchange worked. No live push at all
  // means untested -- NOT failed.
  const authSucceeded =
    livePushes.length === 0 ? null : livePushes.some((log) => log.status === "ok");

  const variantCount = preview.payload.items.reduce((n, item) => n + item.variants.length, 0);
  const inStockVariantCount = preview.payload.items.reduce(
    (n, item) => n + item.variants.filter((v) => v.inventoryLevel > 0).length,
    0,
  );
  // FINDING L-20 -- Leafly grades "most ITEMS are in stock", not most variants, and one
  // in-stock size is enough to publish an item. Counting variants here would have failed
  // a shop that has every product available in at least one size. See
  // certification-core's header for the spec quote.
  const inStockItemCount = preview.payload.items.filter((item) =>
    item.variants.some((v) => v.inventoryLevel > 0),
  ).length;

  const certification = assessMenuCertificationReadiness({
    credentialsConfigured: preview.readiness.configured,
    environment: preview.readiness.environment,
    authSucceeded,
    recentPushStatuses,
    // The reconcile result lives in the read-back button's client state, not on the
    // server. Passing null is the truthful value for a page render: nobody has
    // reconciled *as of this page load*, and the gate correctly refuses to call data
    // quality proven until they do.
    reconcile: null,
    itemCount: preview.itemCount,
    variantCount,
    inStockVariantCount,
    inStockItemCount,
    // Only the owner can answer the manual-tools question, and it is retroactive.
    ownerAttestsNoManualTools: null,
    // FALSE, and verified rather than assumed. `vercel.json` declares exactly three
    // crons -- compliance-reminders, regulatory-watch and atm-sync -- and NONE of them
    // syncs Leafly. `settings.syncMode` only chooses POST vs PUT for a push someone
    // triggers by hand; it does not schedule anything, so deriving this from syncMode
    // would have produced a permanent, meaningless "pass".
    //
    // This is a genuine certification gap that the roadmap did not call out: Leafly
    // grades sync CADENCE, and a handful of hand-pressed buttons is the request pattern
    // that criterion 3 disqualifies. `tests/compliance/leafly-certification.test.ts`
    // asserts vercel.json still has no Leafly cron, so the day somebody adds one that
    // test fails and points here.
    scheduledSyncEnabled: LEAFLY_SCHEDULED_SYNC_EXISTS,
  });

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
        // SLICE L-3: was `false`, on the disproven premise that Leafly v2 has
        // no image field. The vendored live schema declares `imageUrl` on every
        // item, we emit it (payload-core.ts), and the owner's sendImages toggle
        // now controls it -- so a missing photo is a genuine Leafly menu gap and
        // must be reported, not hidden.
        imageRelevant
      />

      <LeaflyPushClient
        configured={preview.readiness.configured}
        itemCount={preview.itemCount}
        sandbox={preview.readiness.environment === "sandbox"}
      />

      {/*
        SLICE L-4 -- certification readiness.

        The roadmap step for this slice ends "request menu certification", which sounds
        like a button and is not. Leafly requires two business days' notice and a HUMAN
        reviews the retailer's logged request activity, so a premature request costs the
        better part of a week. Until now the only way to decide was to guess. This card
        grades Leafly's five published criteria (readiness report section 7) and, for
        each one, either shows the evidence or says what to do about it.

        The third criterion cannot be answered by software -- the app cannot see which
        tool made a past request, and the rule is retroactive -- so it is presented as an
        attestation the owner makes, never as an automatic pass.
      */}
      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-[var(--admin-text)]">
            Leafly menu certification
          </h2>
          <Badge tone={certification.readyToRequest ? "green" : "orange"}>
            {
              certification.criteria.filter((c) => c.status === "pass").length
            }{" "}
            of {certification.criteria.length} criteria met
          </Badge>
        </div>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">{certification.headline}</p>

        <ul className="space-y-3">
          {certification.criteria.map((c) => (
            <li key={c.id} className="border-t border-[var(--admin-border)] pt-2">
              <div className="mb-1 flex items-center gap-2">
                <Badge
                  tone={
                    c.status === "pass"
                      ? "green"
                      : c.status === "attest"
                        ? // gold, not danger: an unanswered question is not a failure.
                          // It still blocks the request, which the copy says plainly.
                          "gold"
                        : c.status === "unknown"
                          ? "neutral"
                          : "danger"
                  }
                >
                  {c.status === "pass"
                    ? "Met"
                    : c.status === "attest"
                      ? "Needs your confirmation"
                      : c.status === "unknown"
                        ? "Untested"
                        : "Not met"}
                </Badge>
              </div>
              <p className="text-xs italic text-[var(--admin-text-muted)]">
                Leafly requires: &ldquo;{c.leaflyRequirement}&rdquo;
              </p>
              <p className="mt-1 text-xs text-[var(--admin-text)]">{c.finding}</p>
              {c.remedy ? (
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                  <strong>To fix:</strong> {c.remedy}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-3 border-t border-[var(--admin-border)] pt-2 text-xs text-[var(--admin-text-muted)]">
          Leafly requires <strong>{certification.noticeBusinessDays} business days&rsquo;</strong>{" "}
          notice for a certification request, and menu and order certification are two
          separate submissions.
        </p>
      </Card>

      <SyncSettingsPanel
        channel="leafly"
        settings={settings}
        saveAction={saveLeaflySettingsAction}
        resetStateAction={resetLeaflySyncStateAction}
      />

      {/*
        SLICE L-3 -- Leafly ordering, made visible.

        `availableForPickup` decides whether Leafly will take an order for an
        item at all, and before this panel existed its value was invisible: the
        owner could enable ordering, push successfully, see Leafly accept every
        item, and still receive nothing -- with the only explanation buried in
        the payload JSON. This reports the same decision the wire carries,
        grouped by cause, naming the actual products.
      */}
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-bold text-[var(--admin-text)]">Leafly ordering</h2>
          <Badge tone={preview.orderability.orderable > 0 ? "green" : "neutral"}>
            {preview.orderability.orderable} of {preview.orderability.total} orderable
          </Badge>
        </div>
        {settings.sendPickupAvailability ? (
          <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
            Ordering is <strong>on</strong>. Leafly may take pickup orders for the items
            counted above. Remember the <strong>15-minute</strong> acknowledgement window
            &mdash; an order not accepted in time is cancelled by Leafly automatically.
          </p>
        ) : (
          <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
            Ordering is <strong>off</strong>, so every item is sent as not orderable and
            Leafly will not take orders. Turn it on in <strong>Sync settings</strong> below
            when you are ready to receive them.
          </p>
        )}

        {preview.orderability.blocked.length === 0 ? (
          <p className="text-xs text-[var(--admin-text-muted)]">
            {preview.orderability.total === 0
              ? "No items in the published feed yet."
              : "Every item in the feed is offered for ordering."}
          </p>
        ) : (
          <div className="space-y-2">
            {preview.orderability.blocked.map((group) => (
              <div
                key={group.reason}
                className="rounded-md border border-[var(--admin-border)] px-3 py-2 text-xs"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={group.reason === "doh_restricted" ? "danger" : "orange"}>
                    {group.count} item{group.count === 1 ? "" : "s"}
                  </Badge>
                  <span className="text-[var(--admin-text-muted)]">{group.label}</span>
                </div>
                {group.examples.length > 0 ? (
                  <p className="text-[11px] text-[var(--admin-text-faint)]">
                    For example: {group.examples.join(", ")}
                    {group.count > group.examples.length
                      ? ` (and ${group.count - group.examples.length} more)`
                      : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

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
