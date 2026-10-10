import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import { dropAchDocumentAction } from "@/app/admin/settings/banking/document-actions";
import { DOC_KIND_LABELS, INTAKE_LABELS, UPLOADABLE_DOC_KINDS, type IntakeStatus, type PayeeType } from "@/lib/payments/ach-document-intake-core";

export type DropCardDoc = {
  id: string;
  kind: keyof typeof DOC_KIND_LABELS;
  original_filename: string;
  intake_status: IntakeStatus;
  uploaded_at: string;
  archived_at: string | null;
};

const TONE: Record<IntakeStatus, "neutral" | "gold" | "green" | "danger" | "orange"> = {
  received: "gold",
  extracted: "gold",
  rekeyed: "orange",
  accepted: "green",
  rejected: "danger",
};

/**
 * R39 S5 — drop an ACH document (owner Q2: managers upload, enterprise grade).
 * Managers see only that a file was dropped and its status: never a bank
 * number, never the file itself (the bucket is admin-read only, 0258).
 * Owner/admin get a "Review" link to the intake page.
 */
export function AchDocumentDropCard({
  payeeType,
  payeeId,
  returnTo,
  documents,
  canReview,
  tableReady,
  showAll,
  toggleHref,
}: {
  payeeType: PayeeType;
  payeeId: string;
  returnTo: string;
  documents: DropCardDoc[];
  canReview: boolean;
  tableReady: boolean;
  showAll: boolean;
  toggleHref: string;
}) {
  const open = documents.filter((d) => !d.archived_at && (d.intake_status === "received" || d.intake_status === "extracted"));
  const shown = showAll ? documents : open;
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">ACH documents</h2>
        {open.length ? <Badge tone="gold">{open.length} waiting for review</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-white/50">
        {payeeType === "employee"
          ? "Drop the signed direct deposit form (and a voided check if they gave one). It goes in this file and the vault."
          : "Drop the vendor's signed ACH form (and a voided check or bank letter). New vendor banking stays on hold until a call-back."}{" "}
        PDF, JPEG, PNG or HEIC, up to 25 MB. You will not see bank details after dropping.
      </p>
      {!tableReady ? (
        <p role="alert" className="mt-2 text-xs text-[var(--admin-orange)]">
          One-time setup needed: apply migration 0258 (docs/MIGRATIONS_TO_RUN.md) before documents can be dropped.
        </p>
      ) : (
        <form action={dropAchDocumentAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="payee_type" value={payeeType} />
          <input type="hidden" name="payee_id" value={payeeId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="text-xs text-white/60">
            What is it?
            <select name="kind" required defaultValue="" className="mt-1 block rounded-md border border-[var(--admin-border)] bg-black/30 px-2 py-1 text-xs text-white">
              <option value="" disabled>Pick one</option>
              {UPLOADABLE_DOC_KINDS.map((k) => (
                <option key={k} value={k}>{DOC_KIND_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/60">
            File
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
              className="mt-1 block text-xs text-white/80"
            />
          </label>
          <button type="submit" className="rounded-md bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black">
            Drop document
          </button>
        </form>
      )}
      {shown.length ? (
        <ul className="mt-3 space-y-1 text-xs text-white/70">
          {shown.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <Badge tone={d.archived_at ? "neutral" : TONE[d.intake_status]}>{d.archived_at ? "Archived" : INTAKE_LABELS[d.intake_status]}</Badge>
              <span>{DOC_KIND_LABELS[d.kind]}</span>
              <span className="text-white/40">· {d.original_filename || "file"} · {d.uploaded_at.slice(0, 10)}</span>
              {canReview ? (
                <Link href={`/admin/settings/banking/documents/${d.id}`} className="font-semibold text-[var(--admin-accent)] hover:underline">
                  Review
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {documents.length > open.length ? (
        <Link href={toggleHref} className="mt-2 inline-block text-xs font-semibold text-white/60 hover:underline">
          {showAll ? "Hide decided documents" : `Show decided documents (${documents.length - open.length})`}
        </Link>
      ) : null}
    </div>
  );
}
