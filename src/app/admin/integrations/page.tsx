import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { describeLeaflyRuntimeAsync } from "@/lib/leafly/client";
import { describeWeedmapsRuntimeAsync } from "@/lib/weedmaps/client";
import { getAccountingSettings, missingGlAccounts } from "@/lib/accounting/sage50";
import { getIntegrationCredentialsView } from "@/lib/integrations/integration-credentials-store";
import { LeaflyCredentialsForm, WeedmapsCredentialsForm } from "./CredentialsEditor";

export const dynamic = "force-dynamic";

type Row = { label: string; ok: boolean; detail: string };

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <Badge tone={ok ? "green" : "orange"}>{label ?? (ok ? "Configured" : "Not configured")}</Badge>
  );
}

function CredRow({ label, ok, detail }: Row) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--admin-border)] py-2 first:border-t-0">
      <div>
        <div className="text-sm text-[var(--admin-text)]">{label}</div>
        <div className="text-xs text-[var(--admin-text-faint)]">{detail}</div>
      </div>
      <StatusBadge ok={ok} />
    </div>
  );
}

export default async function IntegrationsPage() {
  await requirePermission("settings.manage");

  const leafly = await describeLeaflyRuntimeAsync();
  const weedmaps = await describeWeedmapsRuntimeAsync();
  const credentials = await getIntegrationCredentialsView();
  const accounting = await getAccountingSettings();
  const missingGl = missingGlAccounts(accounting);
  const sageReady = missingGl.length === 0;

  return (
    <div>
      <AdminPageHeader
        title="Integrations"
        subtitle="Menu syndication, accounting export, and external service status"
        breadcrumbs={<Breadcrumbs items={[{ label: "Integrations" }]} />}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="integrations"
          title="How integrations work here"
          steps={[
            "Menu syndication (Leafly, WeedMaps) reads our published menu and is drafts-only until certification is confirmed.",
            "Accounting export builds a Sage 50 General Journal CSV you import into Sage — no live API needed.",
            "Enter API keys/credentials right here in the Credentials section below — a value saved here overrides the server environment variable. Secrets are stored securely and shown masked.",
          ]}
        >
          Standing rule: nothing is pushed to a third party automatically. Menu pushes wait for the
          owner&apos;s go-ahead and Leafly/WeedMaps certification.
        </HelpPanel>

        {/* Credentials — enter API keys directly from the back office */}
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-[var(--admin-text)]">Credentials</h2>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Enter the keys from your Leafly business login and WeedMaps back office. Anything
              you save here takes priority over the matching server environment variable. Nothing
              is sent to Leafly or WeedMaps just by saving credentials.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <LeaflyCredentialsForm view={credentials.leafly} />
            <WeedmapsCredentialsForm view={credentials.weedmaps} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Leafly */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">🍃 Leafly menu integration</h2>
              <StatusBadge
                ok={leafly.hasMenuIntegrationKey || leafly.hasOAuthCredentials}
                label={leafly.environment}
              />
            </div>
            <CredRow
              label="Menu integration key"
              ok={leafly.hasMenuIntegrationKey}
              detail="LEAFLY_MENU_INTEGRATION_KEY"
            />
            <CredRow
              label="OAuth client credentials"
              ok={leafly.hasOAuthCredentials}
              detail="LEAFLY_CLIENT_ID / LEAFLY_CLIENT_SECRET"
            />
            <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
              Base URL: <span className="font-mono">{leafly.baseUrl}</span>. Builds the real Menu
              API v2.0 payload from the published menu. Preview (dry-run) is always safe; live
              pushes require credentials and explicit confirmation.
            </p>
            <a
              href="/admin/integrations/leafly"
              className="mt-3 inline-block rounded-md bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Open Leafly push &amp; preview →
            </a>
          </Card>

          {/* WeedMaps */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">🗺️ WeedMaps menu integration</h2>
              <StatusBadge ok={weedmaps.hasAuth && weedmaps.hasMenuId} label={weedmaps.environment} />
            </div>
            <CredRow label="Menu id" ok={weedmaps.hasMenuId} detail="WEEDMAPS_MENU_ID" />
            <CredRow
              label="OAuth client credentials"
              ok={weedmaps.hasOAuthCredentials || weedmaps.hasAccessToken}
              detail="WEEDMAPS_CLIENT_ID / WEEDMAPS_CLIENT_SECRET (or WEEDMAPS_ACCESS_TOKEN)"
            />
            <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
              Base URL: <span className="font-mono">{weedmaps.baseUrl}</span>. Token endpoint is
              the verified Weedmaps URL (no extra config). Builds the Menu API (2025-07) payload
              from the published menu. Preview (dry-run) is always safe; live pushes require
              credentials and explicit confirmation.
            </p>
            <a
              href="/admin/integrations/weedmaps"
              className="mt-3 inline-block rounded-md bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Open WeedMaps push &amp; preview →
            </a>
          </Card>

          {/* Sage 50 */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">📒 Sage 50 accounting export</h2>
              <StatusBadge ok={sageReady} label={sageReady ? "Ready" : "Needs GL mapping"} />
            </div>
            <p className="mb-2 text-xs text-[var(--admin-text-muted)]">
              Builds a balanced General Journal CSV (debits +, credits −) for direct import into
              Sage 50. No API required.
            </p>
            {missingGl.length > 0 ? (
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-3 py-2 text-xs text-[var(--admin-orange)]">
                Map these GL accounts before exporting: {missingGl.join(", ")}.
              </div>
            ) : (
              <p className="text-xs text-[var(--admin-text-muted)]">
                Cash, cannabis-sales, and sales-tax-payable accounts are mapped.
              </p>
            )}
            <div className="mt-3 flex gap-3 text-sm">
              <Link href="/admin/reports/accounting" className="text-[var(--admin-accent)] hover:underline">
                Open accounting export →
              </Link>
            </div>
          </Card>

          {/* Cultivera */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">🌱 Cultivera (legacy POS)</h2>
              <Badge tone="neutral">Researched</Badge>
            </div>
            <p className="text-xs text-[var(--admin-text-muted)]">
              This back office replaces Cultivera&apos;s limited tooling. Cultivera is a WCIA-format
              vendor — incoming transfer manifests in WCIA JSON are already supported under Vendor
              Intake, so partner orders from Cultivera-using vendors import the same way. No outbound
              Cultivera API is required; CCRS remains the system of record via the compliance exports.
            </p>
            <div className="mt-3 flex gap-3 text-sm">
              <Link href="/admin/inventory/intake" className="text-[var(--admin-accent)] hover:underline">
                Open vendor intake →
              </Link>
              <Link
                href="/admin/reports/compliance"
                className="text-[var(--admin-accent)] hover:underline"
              >
                CCRS exports →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
