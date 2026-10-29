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
 *    land here to need deleting. R36: the ONE exception is a duplicate row
 *    (the same email delivered twice): a row with a live twin shows
 *    "Dismiss duplicate", which removes the copy WITHOUT rejecting it.
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
import type { ParseStatus } from "@/lib/inbound-email/llamaparse-status-core";
import { InvoiceNumberCell } from "@/components/admin/inventory/InvoiceNumberCell";
import { DismissDuplicateForm } from "@/components/admin/inventory/DismissDuplicateForm";
import { formatUsdCents } from "@/lib/inventory/invoice-adjustments-core";
import type { InvoiceAmountCell } from "@/lib/inventory/invoice-adjustments-store";

export type ManifestDownloadLinks = {
  manifestUrl: string | null;
  invoiceUrl: string | null;
};

/** One archived intake document with a fresh signed URL (SLICE 69). */
export type ArchivedDocLink = {
  role: "manifest" | "invoice" | "coa" | "transfer-json" | "other";
  filename: string;
  url: string;
};

const DOC_LABEL: Record<ArchivedDocLink["role"], string> = {
  manifest: "Manifest",
  invoice: "Invoice",
  coa: "COA",
  "transfer-json": "JSON",
  other: "File",
};

export function EmailIntakeTable({
  rows,
  linksByManifestId,
  docsByManifestId,
  invoiceAmountByManifestId,
  parseStatusByManifest,
  setInvoiceAction,
  view = "action",
  processedCount = 0,
  twinsById,
  dismissAction,
  filtered = false,
}: {
  rows: InboundManifest[];
  /**
   * Server action (migration 0151) to correct a row's Invoice #. Bound per-row
   * to that manifest's id inside the table. When omitted the Invoice # renders
   * read-only (e.g. an "all"/report view that shouldn't edit).
   */
  setInvoiceAction?: (manifestId: string, formData: FormData) => void | Promise<void>;
  /** manifest id → download links pulled from the email fetch trail. */
  linksByManifestId: Map<string, ManifestDownloadLinks>;
  /**
   * PR-A: manifest_number → document-AI parse status. Drives the compact "AI"
   * column ("llama" green = vision read it, "FB" amber = fell back/failed).
   */
  parseStatusByManifest?: Map<string, ParseStatus>;
  /**
   * SLICE 69: manifest id → OUR archived copies of every document the email
   * carried (signed URLs, private bucket). Preferred over the vendor's links,
   * which expire within hours.
   */
  docsByManifestId?: Map<string, ArchivedDocLink[]>;
  /** Fix 3.4: manifest id -> invoice amount after credits (cents) for the Invoice amount column. */
  invoiceAmountByManifestId?: Map<string, InvoiceAmountCell>;
  /**
   * SLICE 101 — the owner's filter: "action" (default) hides accepted +
   * partially accepted rows; "all" shows everything, open rows first. The
   * page applies the filter (applyIntakeView); this only renders the toggle.
   */
  view?: "action" | "all";
  /** How many processed rows the "action" view hides (for the toggle label). */
  processedCount?: number;
  /**
   * R36: duplicate row id -> the row that would be KEPT. Rows in this map get
   * a "Duplicate" flag and the Dismiss duplicate button.
   */
  twinsById?: Map<string, string>;
  /** R36: dismissDuplicateManifestAction (bound per row inside the table). */
  dismissAction?: (
    duplicateId: string,
    keepId: string,
    back: "list" | "detail",
    formData: FormData,
  ) => void | Promise<void>;
  /** R50 S10a: a filter is narrowing the rows (changes the empty message). */
  filtered?: boolean;
}) {
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--admin-border)] px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--admin-text)]">
            Incoming <span className="text-[var(--admin-accent)]">(email)</span>
          </h2>
          <p className="text-xs text-[var(--admin-text-muted)]">
            Every real delivery, newest first unless you sort it — the badge moves as it does (🟡 in transit → 🔵 received →
            🟢 accepted) and turns red past its ETA. Open a row to review and accept. Drafts only —
            nothing activates until you accept it.
          </p>
        </div>
        {/* SLICE 101's Needs attention / All toggle now lives in the shared
            ReceivingFilterBar above the table (R50 S10a), next to the third
            view (Cultivera manifests), the filters and the sort. */}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--admin-text-faint)]">
          {filtered
            ? "No manifests match these filters. Clear them to see the whole list."
            : view === "action" && processedCount > 0
            ? `Nothing needs attention — ${processedCount} processed manifest${
                processedCount === 1 ? " is" : "s are"
              } hidden. Switch to "All" to see them.`
            : "No manifests yet. When a vendor emails a transfer to the intake mailbox it will appear here automatically — or use the manual tools below."}
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
                <th
                  className="cursor-help px-4 py-3 text-center"
                  title="Document AI: 'llama' = LlamaParse vision read this manifest; 'FB' = it fell back to basic text or could not run (open the row for the reason)."
                >
                  AI
                </th>
                <th className="px-4 py-3">Vendor</th>
                <th
                  className="cursor-help px-4 py-3 text-right"
                  title="What the invoice comes to: every priced line, minus credits / discounts read off the invoice or added on Vendor payments."
                >
                  Invoice amount
                </th>
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
                const invoiceOverridden = Boolean((m.invoice_number_override ?? "").trim());
                const links = linksByManifestId.get(m.id);
                const eta = classifyEta(m.eta_date);
                const keepId = twinsById?.get(m.id) ?? null;
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
                      {keepId && (
                        <span
                          className="ml-2 inline-block rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--admin-gold)]"
                          title="Another row has the same manifest # and vendor - the same email was delivered twice. Use Dismiss duplicate on the copy you don't want."
                          data-testid="duplicate-flag"
                        >
                          Duplicate
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                      {setInvoiceAction ? (
                        <InvoiceNumberCell
                          displayValue={invoiceNo}
                          isOverridden={invoiceOverridden}
                          action={setInvoiceAction.bind(null, m.id)}
                        />
                      ) : (
                        (invoiceNo ?? "—")
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        const ps = m.manifest_number
                          ? parseStatusByManifest?.get(m.manifest_number)
                          : undefined;
                        if (!ps) {
                          return (
                            <span
                              className="text-[var(--admin-text-faint)]"
                              title="No document-AI parse recorded (e.g. imported by JSON/CSV)."
                            >
                              —
                            </span>
                          );
                        }
                        return ps.badge === "llama" ? (
                          <Badge tone="green">
                            <span title={ps.statement}>llama</span>
                          </Badge>
                        ) : (
                          <Badge tone="orange">
                            <span title={ps.statement}>FB · {ps.shortReason}</span>
                          </Badge>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{m.vendor_label ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text)]" data-testid="invoice-amount-cell">
                      {(() => {
                        const inv = invoiceAmountByManifestId?.get(m.id);
                        if (!inv) return <span className="text-[var(--admin-text-faint)]">—</span>;
                        const tip = [
                          `Lines ${formatUsdCents(inv.linesMinor)}`,
                          ...inv.labels,
                          inv.printedTotalMinor !== null ? `Invoice prints ${formatUsdCents(inv.printedTotalMinor)}` : "",
                          inv.unpriced > 0 ? `${inv.unpriced} line(s) have no cost yet` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <span title={tip}>
                            {formatUsdCents(inv.amountMinor)}
                            {inv.creditMinor < 0 && (
                              <span className="block text-[0.65rem] text-[var(--admin-accent)]">credit {formatUsdCents(inv.creditMinor)}</span>
                            )}
                            {inv.unpriced > 0 && (
                              <span className="block text-[0.65rem] text-[var(--admin-gold)]">{inv.unpriced} unpriced</span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
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
                        {(docsByManifestId?.get(m.id) ?? []).map((doc) => (
                          <a
                            key={doc.url}
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--admin-accent)] hover:underline"
                            title={`Download our archived copy: ${doc.filename}`}
                          >
                            ⬇ {DOC_LABEL[doc.role]}
                          </a>
                        ))}
                        {!(docsByManifestId?.get(m.id)?.length) && links?.manifestUrl && (
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
                        {!(docsByManifestId?.get(m.id)?.length) && links?.invoiceUrl && (
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
                        {keepId && dismissAction && (
                          <DismissDuplicateForm
                            compact
                            action={dismissAction.bind(null, m.id, keepId, "list")}
                            keepId={keepId}
                            keepLabel="the other copy of this manifest"
                          />
                        )}
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
