import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Field, Input, Textarea, Select } from "@/components/admin/ui";
import { getManifestById } from "@/lib/inventory/store";
import { getVendorById } from "@/lib/vendors/store";
import { listManifestLots, listManifestEvents } from "@/lib/inventory/intake-store";
import { ManifestTimeline } from "@/components/admin/inventory/ManifestTimeline";
import { ManifestLotDisposition } from "@/components/admin/inventory/ManifestLotDisposition";
import { manifestStatusBadge } from "@/lib/inventory/intake-disposition-core";
import {
  rejectManifestAction,
  archiveCoasAction,
  setManifestLifecycleAction,
  updateManifestTransportAction,
  setLotDispositionAction,
  finalizeManifestAction,
} from "../actions";

/** Format an ISO timestamp into the value a datetime-local input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // YYYY-MM-DDTHH:mm in UTC (stable, no TZ surprises for the form default).
  return d.toISOString().slice(0, 16);
}

export const dynamic = "force-dynamic";

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

export default async function ManifestReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    staged?: string;
    accepted?: string;
    drafts?: string;
    rejected?: string;
    archived?: string;
    transport?: string;
    error?: string;
    finalized?: string;
    lot?: string;
    held?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { staged, accepted, drafts, rejected, archived, transport, error, finalized, lot, held } =
    await searchParams;

  const manifest = await getManifestById(id);
  if (!manifest) notFound();

  // E7: auto-fill the manifest origin-license fields (WAC 314-55-085) from the
  // linked vendor record so staff don't retype them each delivery. The manifest's
  // own saved value always wins (manual override preserved); the vendor supplies
  // only the DEFAULT when the manifest field is still blank.
  const linkedVendor = manifest.vendor_id ? await getVendorById(manifest.vendor_id) : null;
  const originLicenseDefault =
    manifest.transporter_license ?? linkedVendor?.license_number ?? "";
  const originNameDefault =
    manifest.transporter_name ??
    linkedVendor?.legal_name ??
    linkedVendor?.display_name ??
    manifest.vendor_label ??
    "";

  const lots = await listManifestLots(id);
  const events = await listManifestEvents(id);
  const isPending = manifest.status === "pending";
  const inProgress = manifest.status === "pending" || manifest.status === "in_transit" || manifest.status === "received";

  const withCoa = lots.filter((l) => l.lab_result_id).length;
  const missingCoa = lots.length - withCoa;
  const sampleCount = lots.filter((l) => l.is_sample).length;
  const coaLinks = Array.isArray(manifest.coa_links) ? manifest.coa_links : [];

  const rejectAction = rejectManifestAction.bind(null, id);
  const finalizeAction = finalizeManifestAction.bind(null, id);
  const archiveAction = archiveCoasAction.bind(null, id);
  const markInTransitAction = setManifestLifecycleAction.bind(null, id, "in_transit");
  const markReceivedAction = setManifestLifecycleAction.bind(null, id, "received");
  const transportAction = updateManifestTransportAction.bind(null, id);
  const hasTransport = Boolean(
    manifest.transporter_name ||
      manifest.driver_name ||
      manifest.vehicle_plate ||
      manifest.vehicle_description ||
      manifest.departed_at ||
      manifest.arrived_at,
  );

  return (
    <div>
      <AdminPageHeader
        title={manifest.manifest_number ?? "Vendor manifest"}
        subtitle={`${manifest.vendor_label ?? "Unknown vendor"} · ${manifest.transfer_date ?? "no date"} · ${
          manifest.source_format === "wcia" ? "WCIA transfer" : "generic JSON"
        }${manifest.source_url ? " (fetched by link)" : ""}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: "Vendor intake", href: "/admin/inventory/intake" },
              { label: manifest.manifest_number ?? "Manifest" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {staged && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Manifest staged as a draft. Review the lines below, then accept to activate the lots.
          </div>
        )}
        {accepted && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Accepted — {accepted} lot{accepted === "1" ? "" : "s"} activated and on hand.
            {drafts && drafts !== "0" && (
              <>
                {" "}
                {drafts} product{drafts === "1" ? "" : "s"} weren&apos;t on the live menu —{" "}
                <Link href="/admin/inventory/drafts" className="font-semibold underline">
                  review {drafts === "1" ? "it" : "them"} as draft{drafts === "1" ? "" : "s"}
                </Link>
                .
              </>
            )}
          </div>
        )}
        {rejected && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Whole manifest rejected at the dock — refused product never entered inventory (nothing
            destroyed). No CCRS filing on our end; ask the vendor to Update/Delete their manifest.
          </div>
        )}
        {finalized && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Finalized as <strong>{manifestStatusBadge(finalized).label}</strong> — {accepted ?? 0}{" "}
            activated, {rejected ?? 0} refused at dock.
            {drafts && drafts !== "0" && (
              <>
                {" "}
                {drafts} new product{drafts === "1" ? "" : "s"} →{" "}
                <Link href="/admin/inventory/drafts" className="font-semibold underline">
                  review draft{drafts === "1" ? "" : "s"}
                </Link>
                .
              </>
            )}
          </div>
        )}
        {held && held !== "0" && (
          <div className="rounded-[var(--admin-radius)] border border-red-500/45 bg-red-500/[0.08] px-4 py-2 text-sm text-red-200">
            ⛔ <strong>{held}</strong> accepted lot{held === "1" ? " was" : "s were"} <strong>held in
            quarantine</strong> and could NOT go live — each is missing a CCRS identifier, missing a COA/lab
            result, or has a FAILED lab result. Fix the flagged lots (add the identifier / attach the passing
            COA) and finalize again. Nothing dirty was placed on the sales floor.
          </div>
        )}
        {lot && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            Line marked <strong>{lot === "accepted" ? "accepted" : "rejected at dock"}</strong>. When
            you&apos;ve decided every line, click <em>Finalize intake</em> below.
          </div>
        )}
        {archived && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Archived {archived} COA PDF{archived === "1" ? "" : "s"} to our records.
          </div>
        )}
        {transport && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Transport details saved to the chain-of-custody record.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            Something went wrong with that action.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-5">
          <StatCard label="Lines" value={lots.length} accent="muted" />
          <StatCard label="With COA" value={`${withCoa}/${lots.length}`} accent={missingCoa > 0 ? "orange" : "green"} />
          <StatCard
            label="COAs captured"
            value={coaLinks.length}
            accent={coaLinks.length > 0 ? "green" : "muted"}
            hint="saved to KB"
          />
          <StatCard
            label="Samples ($0)"
            value={sampleCount}
            accent={sampleCount > 0 ? "gold" : "muted"}
            hint="not for resale"
          />
          <StatCard
            label="Status"
            value={manifestStatusBadge(manifest.status).label}
            accent={
              manifest.status === "accepted"
                ? "green"
                : manifest.status === "partially_accepted"
                  ? "gold"
                  : manifest.status === "rejected"
                    ? "orange"
                    : manifest.status === "pending"
                      ? "gold"
                      : "muted"
            }
            hint={
              manifest.status === "partially_accepted"
                ? `${manifest.accepted_lot_count ?? 0} in · ${manifest.rejected_lot_count ?? 0} refused`
                : undefined
            }
          />
        </div>

        {missingCoa > 0 && isPending && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-orange)]">
            ⚠️ {missingCoa} line{missingCoa === 1 ? "" : "s"} have no COA / lab result. WA CCRS manifest
            reporting needs the COA&apos;s LabtestexternalIdentifier — add it on the lot before selling.
          </div>
        )}

        {/* Parsed lines */}
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Product / lot</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-center">COA</th>
                <th className="px-4 py-3 text-center">Catalog</th>
                <th className="px-4 py-3">Expires</th>
                {inProgress && <th className="px-4 py-3">Decision</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {lots.map((l) => (
                <tr key={l.id} className="bg-[var(--admin-surface)]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/inventory/${l.id}`}
                      className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {l.product_name ?? "(unnamed)"}
                    </Link>
                    <div className="text-xs text-[var(--admin-text-faint)]">
                      {l.lot_code ?? "no lot code"}
                      {l.strain_name && <span> · {l.strain_name}</span>}
                      {l.is_sample && (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-text-faint)]">
                          sample
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/admin/inventory/lots/${l.id}/label`}
                      target="_blank"
                      className="mt-1 inline-block text-[11px] font-semibold text-[var(--admin-accent)] underline hover:brightness-110"
                    >
                      🏷 Print 4×6 label
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{fmtQty(l.received_qty, l.unit)}</td>
                  <td className="px-4 py-3 text-center">
                    {l.lab_result_id ? "✅" : <span className="text-[var(--admin-orange)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {l.pos_product_key ? "🔗" : <span className="text-[var(--admin-text-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">{l.expires_on ?? "—"}</td>
                  {inProgress && (
                    <td className="px-4 py-3">
                      <ManifestLotDisposition
                        manifestId={id}
                        lotId={l.id}
                        disposition={l.disposition}
                        rejectReason={l.reject_reason}
                        acceptAction={setLotDispositionAction}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Captured COAs (knowledge-base snapshot) */}
        {coaLinks.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 className="text-sm font-bold text-[var(--admin-text)]">
                Certificates of analysis ({coaLinks.length})
              </h2>
              <form action={archiveAction}>
                <Button type="submit" variant="neutral" size="sm">
                  📄 Archive COAs to records
                </Button>
              </form>
            </div>
            <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
              Pulled from the single transfer file — no need to open each product&apos;s COA link in the
              email. We download and keep a copy on file so you can print them for LCB enforcement.
            </p>
            <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Lab result ID</th>
                    <th className="px-4 py-2">Expires</th>
                    <th className="px-4 py-2 text-right">COA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {coaLinks.map((c, i) => (
                    <tr key={`${c.coa_url}-${i}`} className="bg-[var(--admin-surface)]">
                      <td className="px-4 py-2 text-[var(--admin-text)]">{c.product_name ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-[var(--admin-text-muted)]">
                        {c.lab_result_id ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">{c.expire_date ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={c.coa_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--admin-accent)] hover:underline"
                        >
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transport / chain-of-custody (Slice 33, Feature L) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="mb-1 flex items-start justify-between gap-3">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">
              🚚 Transport &amp; chain of custody
            </h2>
            {hasTransport && manifest.transport_recorded_at && (
              <span className="text-xs text-[var(--admin-text-faint)]">
                last updated {new Date(manifest.transport_recorded_at).toLocaleString()}
              </span>
            )}
          </div>
          <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
            WA WAC 314-55-085 requires keeping transportation manifest records. Record who
            actually delivered this load and on what vehicle. Saved with the manifest so it
            prints with the intake record.
          </p>
          <form action={transportAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Transporter / carrier"
                help={linkedVendor ? "Pre-filled from the linked vendor — edit if a different carrier delivered" : "Business that moved the load"}
              >
                <Input
                  name="transporter_name"
                  defaultValue={originNameDefault}
                  placeholder="e.g. Acme Cannabis Logistics"
                />
              </Field>
              <Field
                label="Origin / transporter license #"
                help={linkedVendor?.license_number ? "Auto-filled from the vendor's WA license number" : undefined}
              >
                <Input
                  name="transporter_license"
                  defaultValue={originLicenseDefault}
                  placeholder="WA license number"
                />
              </Field>
              <Field label="Driver name">
                <Input
                  name="driver_name"
                  defaultValue={manifest.driver_name ?? ""}
                  placeholder="Person who delivered"
                />
              </Field>
              <Field label="Driver license #">
                <Input
                  name="driver_license_number"
                  defaultValue={manifest.driver_license_number ?? ""}
                  placeholder="Driver's license number"
                />
              </Field>
              <Field label="Vehicle description" help="Make / model / color">
                <Input
                  name="vehicle_description"
                  defaultValue={manifest.vehicle_description ?? ""}
                  placeholder="e.g. White Ford Transit van"
                />
              </Field>
              <Field label="License plate">
                <Input
                  name="vehicle_plate"
                  defaultValue={manifest.vehicle_plate ?? ""}
                  placeholder="Plate number"
                />
              </Field>
              <Field label="Vehicle VIN">
                <Input
                  name="vehicle_vin"
                  defaultValue={manifest.vehicle_vin ?? ""}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Expected arrival (ETA)" help="When you expect it to reach the store">
                <Input
                  type="date"
                  name="eta_date"
                  defaultValue={manifest.eta_date ?? ""}
                />
              </Field>
              <div className="hidden sm:block" />
              <Field label="Departed" help="When it left the vendor">
                <Input
                  type="datetime-local"
                  name="departed_at"
                  defaultValue={toLocalInput(manifest.departed_at)}
                />
              </Field>
              <Field label="Arrived" help="When it reached the store">
                <Input
                  type="datetime-local"
                  name="arrived_at"
                  defaultValue={toLocalInput(manifest.arrived_at)}
                />
              </Field>
            </div>
            <Field label="Route notes" help="Stops, conditions, seal numbers, etc.">
              <Textarea
                name="route_notes"
                rows={2}
                defaultValue={manifest.route_notes ?? ""}
                placeholder="Anything noteworthy about the delivery"
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="save" size="sm">
                💾 Save transport details
              </Button>
            </div>
          </form>
        </div>

        {/* Lifecycle timeline (Cultivera-style) */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
            Manifest status
          </h2>
          <ManifestTimeline status={manifest.status} events={events} />
          {inProgress ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-4">
              <span className="text-xs text-[var(--admin-text-faint)]">Update arrival progress:</span>
              <form action={markInTransitAction}>
                <Button type="submit" variant="neutral" size="sm">
                  🚚 Mark in transit
                </Button>
              </form>
              <form action={markReceivedAction}>
                <Button type="submit" variant="neutral" size="sm">
                  📦 Mark received
                </Button>
              </form>
            </div>
          ) : null}
        </div>

        {/* Accept / reject controls */}
        {inProgress ? (
          <div className="space-y-4">
            <HelpPanel
              id="ccrs-reject-guardrails"
              title="How rejecting product works (and stays compliant)"
              steps={[
                "Mark each line Accept or Reject above. Only accepted lots enter inventory (quarantine → active).",
                "Rejecting is 'refuse at the dock' — the product leaves with the driver and never becomes your reported inventory. Nothing is destroyed.",
                "Decide BEFORE you accept. Refuse questionable product at the dock rather than accepting it and rejecting/returning it later — once a lot is accepted it briefly enters inventory.",
                "Because refused product was never yours, you file NOTHING with CCRS. Ask the vendor to submit a CCRS manifest Update (to fix a quantity) or Delete (to remove a line) so their record matches what physically stayed.",
                "Do NOT create a return manifest for driver-present refusals. Contingency manifests are discontinued (WSLCB, Nov 2025).",
                "When every line is decided, click Finalize intake. A mix of accept + reject marks the manifest 'Partially Accepted'.",
              ]}
            >
              <p className="text-xs text-[var(--admin-text-faint)]">
                Grounded in the WSLCB CCRS Manifest Guide (Feb 2026) — see
                docs/ccrs-rejection-and-returns.md.
              </p>
            </HelpPanel>

            <div className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <p className="flex-1 text-sm text-[var(--admin-text-muted)]">
                Decide each line above, then <strong>Finalize intake</strong> to activate the
                accepted lots. Lines left undecided are accepted by default.
              </p>
              <form action={finalizeAction}>
                <Button type="submit" variant="save" size="sm">
                  ✓ Finalize intake
                </Button>
              </form>
            </div>

            {/* Whole-manifest reject (reason required) */}
            <details className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/30 bg-[var(--admin-surface)] p-5">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--admin-danger)]">
                ✕ Reject the entire manifest
              </summary>
              <form action={rejectAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Reason" help="Refused at the dock — nothing is destroyed or reported to CCRS.">
                  <Select name="reason_code" defaultValue="short_shipment">
                    <option value="short_shipment">Short shipment — vendor forgot it</option>
                    <option value="damaged_in_transit">Damaged / broke in transit</option>
                    <option value="wrong_product">Wrong product</option>
                    <option value="failed_coa">Failed COA / quality</option>
                    <option value="expired">Expired / short-dated</option>
                    <option value="overage">Overage — more than ordered</option>
                    <option value="other">Other (explain)</option>
                  </Select>
                </Field>
                <Field label="Details (optional / required for Other)">
                  <Input name="reason_text" placeholder="Explain if 'Other'…" />
                </Field>
                <Button type="submit" variant="neutral" size="sm">
                  ✕ Reject whole manifest
                </Button>
              </form>
            </details>
          </div>
        ) : (
          <p className="text-sm text-[var(--admin-text-faint)]">
            This manifest has been {manifestStatusBadge(manifest.status).label.toLowerCase()}. Lots
            are managed from the inventory list.
          </p>
        )}
      </div>
    </div>
  );
}
