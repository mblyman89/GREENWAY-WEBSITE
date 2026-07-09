/**
 * EmailIntakeTable  (H15c)
 *
 * The "Incoming (email)" hero table the owner asked for — one calm table, one
 * row per REAL manifest (the H15b gate guarantees junk never lands here):
 *
 *   Manifest # | Invoice # | Vendor | Pulled in | ETA | Status | Downloads
 *
 *  - Invoice # is "order # or invoice #, whichever is available" (locked
 *    decision): the WCIA `external_id` read back out of the stored payload;
 *    both numbers stay stored (transfer_id → manifest_number, external_id in
 *    raw_payload).
 *  - The status badge MOVES: 🟡 In transit → 🔵 Received → 🟢 Accepted
 *    (🟠 partial, ⚪ rejected) and turns 🔴 red while in transit past its ETA.
 *  - ⬇ Manifest / ⬇ Invoice download links come from the email's fetch trail
 *    (inbound_email_log.note), joined by manifest id.
 *  - No delete button, by design — the strict gate means nothing junky can
 *    land here to need deleting.
 *
 * Presentational server component: all data is passed in; all logic lives in
 * the pure manifest-table-core module (unit-tested).
 */
import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import type { InboundManifest } from "@/lib/inventory/types";
import { classifyEta } from "@/lib/inventory/manifest-pipeline-core";
import {
  invoiceNumberForRow,
  movingBadge,
  fmtPulledIn,
} from "@/lib/inventory/manifest-table-core";
import { CONCIERGE_HINTS } from "@/lib/inventory/guided-accept-core";

export type ManifestDownloadLinks = {
  manifestUrl: string | null;
  invoiceUrl: string | null;
};

export function EmailIntakeTable({
  rows,
  linksByManifestId,
}: {
  rows: InboundManifest[];
  /** manifest id → download links pulled from the email fetch trail. */
  linksByManifestId: Map<string, ManifestDownloadLinks>;
}) {
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)]">
      <div className="border-b border-[var(--admin-border)] px-4 py-3">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">
          Incoming <span className="text-[var(--admin-accent)]">(email)</span>
        </h2>
        <p className="text-xs text-[var(--admin-text-muted)]">
          Every real manifest, newest first — the badge moves as it does (🟡 in transit → 🔵 received →
          🟢 accepted) and turns red past its ETA. Open a row to review and accept. Drafts only —
          nothing activates until you accept it.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--admin-text-faint)]">
          No manifests yet. When a vendor emails a transfer to the intake mailbox it will appear
          here automatically — or use the manual tools below.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="cursor-help px-4 py-3" title={CONCIERGE_HINTS.manifest_number}>
                  Manifest #
                </th>
                <th className="cursor-help px-4 py-3" title={CONCIERGE_HINTS.invoice_number}>
                  Invoice #
                </th>
                <th className="px-4 py-3">Vendor</th>
                <th className="cursor-help px-4 py-3" title="When the email landed in vendor_intake@ and the system staged this draft.">
                  Pulled in
                </th>
                <th className="cursor-help px-4 py-3 text-center" title={CONCIERGE_HINTS.eta}>
                  ETA
                </th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="cursor-help px-4 py-3 text-right" title="The manifest / invoice PDFs pulled from the vendor's email, plus the review screen.">
                  Docs
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {rows.map((m) => {
                const badge = movingBadge(m.status, m.eta_date);
                const invoiceNo = invoiceNumberForRow(m);
                const links = linksByManifestId.get(m.id);
                const eta = classifyEta(m.eta_date);
                return (
                  <tr
                    key={m.id}
                    className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/inventory/intake/${m.id}`}
                        className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        title="Open the review screen"
                      >
                        {m.manifest_number ?? "(no number)"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{invoiceNo ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{m.vendor_label ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{fmtPulledIn(m.created_at)}</td>
                    <td className="px-4 py-3 text-center">
                      {m.eta_date ? (
                        badge.overdue ? (
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
                      <Badge tone={badge.tone}>
                        {badge.emoji} {badge.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-3 text-xs">
                        {links?.manifestUrl && (
                          <a
                            href={links.manifestUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--admin-accent)] hover:underline"
                            title="Download the manifest PDF the vendor sent"
                          >
                            ⬇ Manifest
                          </a>
                        )}
                        {links?.invoiceUrl && (
                          <a
                            href={links.invoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--admin-accent)] hover:underline"
                            title="Download the invoice PDF the vendor sent"
                          >
                            ⬇ Invoice
                          </a>
                        )}
                        <Link
                          href={`/admin/inventory/intake/${m.id}`}
                          className="rounded border border-[var(--admin-border)] px-2 py-1 font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
                        >
                          Open
                        </Link>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
