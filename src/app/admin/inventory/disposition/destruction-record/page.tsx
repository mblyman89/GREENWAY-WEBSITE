/**
 * /admin/inventory/disposition/destruction-record?id=<destruction event id>
 *
 * Fix Phase 1.7a (G-43 req 6 "per event" and req 7): the printable record of
 * ONE destruction (form 8.3 in the app) with its photo and video evidence.
 * Owner (message 4): "please build the photo upload (G-43), as well as a
 * video upload just in case." Kept five years (WAC 314-55-097). Photos print
 * as images; each video prints as its file name, size, type and who uploaded
 * it (a video cannot be printed). Viewing links are short-lived (private
 * bucket). Requires inventory.manage. Times are Pacific (F-15-5).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { getDestructionRecordForPrint } from "@/lib/inventory/disposition";
import { RENDERING_METHOD_LABELS, type RenderingMethod } from "@/lib/inventory/disposition-core";
import { cameraCell, formatDestructionPacific } from "@/lib/inventory/destruction-record-core";
import { listEvidenceForEvents, signEvidenceUrls } from "@/lib/inventory/destruction-evidence-store";
import {
  EVIDENCE_VIEW_SECONDS,
  evidenceInline,
  evidenceLabel,
  evidenceSummary,
  formatEvidenceBytes,
  isUuid,
} from "@/lib/inventory/destruction-evidence-core";
import { PrintButton } from "@/components/admin/orders/PrintButton";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-b border-black/20 align-top">
      <th className="w-56 p-1 text-left font-semibold">{label}</th>
      <td className="p-1">{value || "\u2014"}</td>
    </tr>
  );
}

export default async function DestructionRecordPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const id = isUuid(sp.id) ? sp.id : null;
  const r = id ? await getDestructionRecordForPrint(id) : null;
  if (!r) {
    return (
      <div className="min-h-screen bg-white p-6 text-black">
        <Link href="/admin/inventory/disposition" className="text-xs underline">
          Back to Returns &amp; Destruction
        </Link>
        <p className="mt-4 text-sm" data-testid="destruction-record-missing">
          That destruction event was not found. Open it from the Destruction events list.
        </p>
      </div>
    );
  }
  const ev = await listEvidenceForEvents([r.id]);
  const items = ev.byEvent.get(r.id) ?? [];
  const urls = await signEvidenceUrls(items.map((i) => i.storage_key));
  const downloads = await signEvidenceUrls(items.map((i) => i.storage_key), true);
  const method = r.rendering_method
    ? (RENDERING_METHOD_LABELS[r.rendering_method as RenderingMethod] ?? r.rendering_method)
    : (r.method ?? "");

  return (
    <div className="min-h-screen bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/admin/inventory/disposition" className="text-xs underline">
          Back to Returns &amp; Destruction
        </Link>
        <PrintButton />
      </div>
      <h1 className="text-lg font-black">Greenway Marijuana: Destruction record</h1>
      <p className="mb-3 text-xs">
        WSLCB license 413541. One destruction event (form 8.3 in the app), Pacific time. Rendered unusable on the premises,
        witnessed by a second person and recorded on camera (owner decision D64; WAC 314-55-097, WAC 314-55-083(3)(a)). Keep
        five years.
      </p>
      <table className="w-full border-collapse text-[12px]" data-testid="destruction-record-table">
        <tbody>
          <Row label="Status" value={r.status.replace(/_/g, " ")} />
          <Row label="Product / lot" value={`${r.product_name ?? "\u2014"} \u00b7 ${r.lot_code ?? r.lot_id.slice(0, 8)}`} />
          <Row label="Quantity" value={`${r.quantity} ${r.unit ?? ""}`} />
          <Row label="Reason" value={`${r.reason.replace(/_/g, " ")}${r.detail ? ` \u00b7 ${r.detail}` : ""}`} />
          <Row label="Scheduled" value={`${formatDestructionPacific(r.created_at)}${r.created_by_name ? ` by ${r.created_by_name}` : ""}`} />
          <Row label="Hold ended" value={formatDestructionPacific(r.earliest_destroy_at)} />
          {r.status === "cancelled" ? (
            <Row
              label="Cancelled"
              value={`${formatDestructionPacific(r.cancelled_at)}${r.cancelled_by_name ? ` by ${r.cancelled_by_name}` : ""}${r.cancel_reason ? ` \u00b7 why: ${r.cancel_reason}` : ""}`}
            />
          ) : null}
          <Row label="Destroyed" value={formatDestructionPacific(r.completed_at)} />
          <Row label="Completed by" value={r.completed_by_name} />
          <Row
            label="Method and mix"
            value={`${method}${r.mix_material ? ` \u00b7 mixed with ${r.mix_material}` : ""}${r.other_method_approval_ref ? ` \u00b7 LCB approval ${r.other_method_approval_ref}${r.other_method_approval_date ? ` (${r.other_method_approval_date})` : ""}` : ""}`}
          />
          <Row label="Destination / facility" value={[r.final_destination, r.disposal_facility].filter(Boolean).join(" / ")} />
          <Row label="Witness" value={r.witness_name ?? r.witnessed_by ?? (r.status === "completed" ? "not recorded" : "")} />
          <Row label="Camera" value={r.status === "completed" ? cameraCell(r) : ""} />
          <Row label="Photo and video evidence" value={ev.pending ? "migration 0312 not applied yet" : ev.error ? `could not be read: ${ev.error}` : evidenceSummary(items)} />
        </tbody>
      </table>

      {items.length ? (
        <section className="mt-5" data-testid="destruction-record-evidence">
          <h2 className="text-sm font-black">Evidence</h2>
          <p className="mb-2 text-[11px] print:hidden">
            Viewing links last {Math.round(EVIDENCE_VIEW_SECONDS / 60)} minutes; reload the page for fresh ones.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {items.map((it) => {
              const url = urls.get(it.storage_key);
              const dl = downloads.get(it.storage_key);
              const inline = evidenceInline(it.mime);
              return (
                <figure key={it.id} className="break-inside-avoid border border-black/30 p-2">
                  {url && inline === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket
                    <img src={url} alt={`Destruction evidence ${it.filename}`} className="max-h-72 w-full object-contain" />
                  ) : url && inline === "video" ? (
                    <video src={url} controls preload="metadata" className="max-h-72 w-full print:hidden" />
                  ) : (
                    <p className="text-[11px] italic">{url ? "Preview not available in this browser; use Download." : "File not found in storage."}</p>
                  )}
                  <figcaption className="mt-1 text-[11px]">
                    {`${it.kind === "video" ? "Video" : "Photo"}: ${it.filename} \u00b7 ${evidenceLabel(it.mime)} \u00b7 ${formatEvidenceBytes(it.size_bytes)}`}
                    <br />
                    Uploaded {formatDestructionPacific(it.uploaded_at)}
                    {it.uploaded_by_name ? ` by ${it.uploaded_by_name}` : ""}
                    {it.note ? ` \u00b7 ${it.note}` : ""}
                    {dl ? (
                      <>
                        {" "}
                        <a href={dl} className="underline print:hidden">
                          Download
                        </a>
                      </>
                    ) : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <p>Performed by: ______________________</p>
        <p>Witness: ______________________</p>
        <p>Reviewed by (owner): ______________________</p>
        <p>Date: ______________________</p>
      </div>
    </div>
  );
}
