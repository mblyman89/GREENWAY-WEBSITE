import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Button, Badge } from "@/components/admin/ui";
import { listManifests, countManifestsByStatus } from "@/lib/inventory/intake-store";
import type { InboundManifest } from "@/lib/inventory/types";
import {
  groupPipeline,
  normalizeStage,
  STAGE_META,
  classifyEta,
  INBOUND_SOURCE_NOTE,
  type ManifestStage,
} from "@/lib/inventory/manifest-pipeline-core";
import { importManifestAction, importManifestFromUrlAction } from "./actions";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  const stage = normalizeStage(status);
  const meta = STAGE_META[stage];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return d;
}

/** A compact row in a pipeline queue with optional ETA emphasis. */
function QueueRow({ m }: { m: InboundManifest }) {
  const eta = classifyEta(m.eta_date);
  return (
    <tr className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
      <td className="px-4 py-3">
        <Link
          href={`/admin/inventory/intake/${m.id}`}
          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
        >
          {m.manifest_number ?? "(no number)"}
        </Link>
      </td>
      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{m.vendor_label ?? "—"}</td>
      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{fmtDate(m.transfer_date)}</td>
      <td className="px-4 py-3 text-center">
        {m.eta_date ? (
          eta === "overdue" ? (
            <Badge tone="danger">Overdue · {m.eta_date}</Badge>
          ) : eta === "today" ? (
            <Badge tone="gold">Today</Badge>
          ) : (
            <span className="text-[var(--admin-text-muted)]">{m.eta_date}</span>
          )
        ) : (
          <span className="text-[var(--admin-text-faint)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <StatusBadge status={m.status} />
      </td>
    </tr>
  );
}

function QueueTable({
  title,
  accent,
  blurb,
  rows,
}: {
  title: string;
  accent: string;
  blurb: string;
  rows: InboundManifest[];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-[var(--admin-text)]">
          <span style={{ color: accent }}>●</span> {title}{" "}
          <span className="text-[var(--admin-text-faint)]">({rows.length})</span>
        </h3>
        <p className="text-xs text-[var(--admin-text-faint)]">{blurb}</p>
      </div>
      <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
            <tr>
              <th className="px-4 py-3">Manifest</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Transfer date</th>
              <th className="px-4 py-3 text-center">ETA</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {rows.map((m) => (
              <QueueRow key={m.id} m={m} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

  const pipeline = groupPipeline<InboundManifest>(manifests);

  // Overdue in-transit manifests bubble up as a banner.
  const overdue = pipeline.inTransit.filter((m) => classifyEta(m.eta_date) === "overdue");

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

  const stageMeta = (s: ManifestStage) => STAGE_META[s];

  return (
    <div>
      <AdminPageHeader
        title="Inbound pipeline"
        subtitle="Every incoming transfer, grouped by where it is right now — pending, in transit, awaiting intake, accepted. Nothing goes live until you accept it."
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
            title="How inbound transfers work in Washington"
            steps={[
              "There is NO automatic CCRS inbound feed — the sending licensee uploads the manifest and everyone gets an email.",
              "So build the inbound record two ways: paste the vendor's Transfer Data Link / WCIA JSON, or enter it by hand.",
              "We stage a DRAFT: pending status, lots in quarantine, COAs captured to the KB.",
              "Move it along the pipeline (in transit → received), verify counts, then accept to activate or reject to discard.",
            ]}
          >
            <p>{INBOUND_SOURCE_NOTE}</p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Pipeline stat cards — full lifecycle, not just 3 */}
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label={stageMeta("pending").label}
            value={counts.pending}
            accent={counts.pending > 0 ? "gold" : "muted"}
          />
          <StatCard
            label={stageMeta("in_transit").label}
            value={counts.in_transit}
            accent={counts.in_transit > 0 ? "gold" : "muted"}
          />
          <StatCard
            label={stageMeta("received").label}
            value={counts.received}
            accent={counts.received > 0 ? "gold" : "muted"}
          />
          <StatCard label={stageMeta("accepted").label} value={counts.accepted} accent="green" />
          <StatCard label={stageMeta("rejected").label} value={counts.rejected} accent="muted" />
        </div>

        {overdue.length > 0 && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            🚨 {overdue.length} in-transit manifest{overdue.length === 1 ? "" : "s"} past ETA — follow up with the transporter.
          </div>
        )}

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

        {/* Pipeline queues — worked in priority order */}
        {manifests.length === 0 ? (
          <EmptyState
            icon="📥"
            title="No imports yet"
            description="Paste a vendor JSON above to stage your first manifest."
          />
        ) : (
          <div className="space-y-6">
            <QueueTable
              title="Awaiting intake"
              accent="var(--admin-gold)"
              blurb="Physically here — verify counts and accept."
              rows={pipeline.awaitingIntake}
            />
            <QueueTable
              title="In transit"
              accent="var(--admin-gold)"
              blurb="On the way — watch the ETA."
              rows={pipeline.inTransit}
            />
            <QueueTable
              title="Pending"
              accent="var(--admin-gold)"
              blurb="Imported/entered, not yet moving."
              rows={pipeline.pending}
            />
            <QueueTable
              title="Accepted"
              accent="var(--admin-accent)"
              blurb="Lots activated."
              rows={pipeline.accepted}
            />
            <QueueTable
              title="Rejected"
              accent="var(--admin-text-faint)"
              blurb="Discarded."
              rows={pipeline.rejected}
            />
          </div>
        )}
      </div>
    </div>
  );
}
