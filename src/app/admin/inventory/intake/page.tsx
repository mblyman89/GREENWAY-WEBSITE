import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Button, Badge } from "@/components/admin/ui";
import { listManifests, countManifestsByStatus } from "@/lib/inventory/intake-store";
import { listInboundEmails, type InboundEmailLogRow } from "@/lib/inbound-email/inbound-store";
import type { InboundManifest } from "@/lib/inventory/types";
import {
  groupPipeline,
  normalizeStage,
  STAGE_META,
  classifyEta,
  INBOUND_SOURCE_NOTE,
  type ManifestStage,
} from "@/lib/inventory/manifest-pipeline-core";
import {
  importManifestAction,
  importManifestFromUrlAction,
  importManifestCsvAction,
} from "./actions";

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

/**
 * Slice 104 — surface the inbound vendor_intake@ email log so staff can see
 * which drafts arrived by email and, importantly, chase down anything that
 * failed to parse. Read-only; the staged drafts themselves live in the queues
 * below (drafts-only — nothing auto-commits).
 */
function InboundEmailPanel({ rows }: { rows: InboundEmailLogRow[] }) {
  if (rows.length === 0) return null;
  const tone = (d: string): "green" | "danger" | "neutral" | "gold" =>
    d === "staged" ? "green" : d === "parse_failed" ? "danger" : d === "ignored" ? "neutral" : "gold";
  const label = (d: string) =>
    d === "staged"
      ? "Staged draft"
      : d === "parse_failed"
        ? "Parse failed"
        : d === "no_manifest"
          ? "No manifest"
          : d === "ignored"
            ? "Ignored"
            : "Received";
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
      <div className="border-b border-[var(--admin-border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">Inbound email (vendor_intake@)</h3>
        <p className="text-xs text-[var(--admin-text-muted)]">
          Emails received at the intake mailbox. Attachments that parse become staged drafts in the queues
          below. Rows marked <span className="font-medium">Parse failed</span> need a human to import manually.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <th className="px-4 py-2">Received</th>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Attach</th>
              <th className="px-4 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--admin-border)]">
                <td className="px-4 py-2 text-[var(--admin-text-muted)]">{r.received_at.slice(0, 16).replace("T", " ")}</td>
                <td className="px-4 py-2 text-[var(--admin-text-muted)]">{r.from_address ?? "—"}</td>
                <td className="px-4 py-2 text-[var(--admin-text)]">
                  {r.manifest_id ? (
                    <Link
                      href={`/admin/inventory/intake/${r.manifest_id}`}
                      className="hover:text-[var(--admin-accent)]"
                    >
                      {r.subject ?? "(no subject)"}
                    </Link>
                  ) : (
                    (r.subject ?? "(no subject)")
                  )}
                </td>
                <td className="px-4 py-2 text-[var(--admin-text-muted)]">{r.attachment_count}</td>
                <td className="px-4 py-2">
                  <Badge tone={tone(r.disposition)}>{label(r.disposition)}</Badge>
                </td>
              </tr>
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

  const [manifests, counts, inboundEmails] = await Promise.all([
    listManifests(),
    countManifestsByStatus(),
    listInboundEmails(15),
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
              ? "No line items were found in that file."
              : error === "emptycsv"
                ? "Paste the CCRS manifest.csv before importing."
                : error === "csvparse"
                  ? "That text isn't a valid CCRS manifest.csv (no item header row found)."
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

        {/* Export: full intake picture (manifests + every lot line) */}
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm">
          <span className="font-semibold text-[var(--admin-text)]">Export intake</span>
          <span className="text-xs text-[var(--admin-text-faint)]">
            Two sheets — every manifest and every lot line, with all fields.
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Link
              href="/admin/inventory/intake/export?format=xlsx"
              className="rounded border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-accent)] hover:brightness-105"
              title="Download Excel (.xlsx)"
            >
              ⬇ Excel (.xlsx)
            </Link>
            <Link
              href="/admin/inventory/intake/export?format=csv"
              className="rounded border border-[var(--admin-border)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
              title="Download CSV"
            >
              ⬇ CSV
            </Link>
          </span>
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

        {/* Import the official CCRS manifest.csv (state format) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">
            Or paste the CCRS manifest.csv
          </h2>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            Paste the official Washington CCRS Transportation Manifest CSV (the file the sending
            licensee uploads to CCRS). We read the manifest header + item rows and seed the transport
            details and ETA. Note: the CCRS manifest carries only identifiers, quantities, UOM,
            weight, and lab-test IDs — <strong>no product names, prices, or COAs</strong> — so each
            staged line is a sparse draft you enrich during review.
          </p>
          <form action={importManifestCsvAction} className="space-y-4">
            <Field
              label="CCRS manifest.csv"
              help="Paste the full contents of the manifest_*.csv (header block + item table)."
              htmlFor="csv_text"
              required
            >
              <Textarea
                id="csv_text"
                name="csv_text"
                rows={10}
                placeholder={
                  "SubmittedBy,...\nExternalManifestIdentifier,MAN-1001,...\n...\nInventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,...\nINV-A,,10,Each,..."
                }
              />
            </Field>
            <Button type="submit" variant="save" size="sm">
              Parse CSV & stage for review
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

        <div className="mt-6">
          <InboundEmailPanel rows={inboundEmails} />
        </div>
      </div>
    </div>
  );
}
