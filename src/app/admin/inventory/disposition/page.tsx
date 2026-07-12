/**
 * Returns & Destruction command center (Task Q).
 *
 * One guided page for the three disposition flows a WA retailer actually has
 * (grounded in docs/RETURNS_DESTRUCTION_COMPLIANCE.md):
 *   1. Customer returns — WAC 314-55-079(12) attestations, CCRS Sale
 *      Delete/Update correction + "Other" inventory adjustment (CCRS FAQ).
 *   2. Vendor returns — CCRS-generated manifest workflow (WAC 314-55-085).
 *   3. Destruction — render-unusable methods per current WAC 314-55-097,
 *      configurable STORE-POLICY hold (the old 72h LCB notice was removed by
 *      WSR 22-14-111), waste records, and the WAC 314-55-225 recall guard.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Textarea, Button, Field, Select, Badge } from "@/components/admin/ui";
import { listLots } from "@/lib/inventory/store";
import {
  listVendorReturns,
  listDestructionEvents,
  listCustomerReturns,
  dispositionSummary,
  getSampleSettings,
  getDispositionSettings,
  type DestructionEventWithLot,
  type VendorReturnWithLot,
} from "@/lib/inventory/disposition";
import {
  VENDOR_RETURN_REASONS,
  VENDOR_RETURN_REASON_LABELS,
  DESTRUCTION_REASONS,
  DESTRUCTION_REASON_LABELS,
} from "@/lib/inventory/disposition-reasons";
import {
  RENDERING_METHODS,
  RENDERING_METHOD_LABELS,
  MANIFEST_STATUS_LABELS,
  nextManifestStatuses,
  VENDOR_RETURN_MANIFEST_STEPS,
  HOLD_HOURS_MIN,
  HOLD_HOURS_MAX,
} from "@/lib/inventory/disposition-core";
import { isAiConfigured } from "@/lib/inventory/disposition-advisor";
import { CustomerReturnWizard } from "@/components/admin/inventory/CustomerReturnWizard";
import { DispositionAdvisorPanel } from "@/components/admin/inventory/DispositionAdvisorPanel";
import {
  createVendorReturnAction,
  updateManifestAction,
  scheduleDestructionAction,
  completeDestructionAction,
  cancelDestructionAction,
  updateDispositionSettingsAction,
  updateSampleSettingsAction,
} from "./actions";

export const dynamic = "force-dynamic";

const OK_MESSAGES: Record<string, string> = {
  customer_return:
    "Customer return logged — inventory adjusted, CCRS Sale correction queued. Download the correction CSV before your next upload.",
  returned: "Vendor return logged and on-hand reduced.",
  manifest: "Manifest status updated.",
  scheduled: "Destruction scheduled — the hold timer is running and the lot is quarantined.",
  destroyed: "Destruction completed and the CCRS 'Destruction' adjustment posted.",
  cancelled: "Destruction cancelled and the lot released from quarantine.",
  settings: "Hold policy saved.",
  samples: "Sample rules saved.",
};

function fmtQty(q: number, unit: string | null): string {
  const n = Number.isInteger(q) ? q.toString() : q.toFixed(2);
  return `${n}${unit ? ` ${unit}` : ""}`;
}

function destructionTone(status: string): "neutral" | "green" | "gold" | "orange" | "danger" {
  if (status === "completed") return "green";
  if (status === "cancelled") return "neutral";
  if (status === "ready") return "orange";
  return "gold";
}

function manifestTone(status: string): "neutral" | "green" | "gold" | "orange" | "danger" {
  if (status === "picked_up") return "green";
  if (status === "confirmed") return "gold";
  if (status === "submitted" || status === "requested") return "orange";
  return "neutral";
}

export default async function DispositionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePermission("inventory.manage");
  const canSettings = can(session.profile.role, "settings.manage");
  const sp = await searchParams;

  const [lots, returns, destructions, customerReturns, summary, sampleSettings, dispositionSettings] =
    await Promise.all([
      listLots({ status: "active", limit: 500 }),
      listVendorReturns(50),
      listDestructionEvents(50),
      listCustomerReturns(20),
      dispositionSummary(),
      getSampleSettings(),
      getDispositionSettings(),
    ]);

  const holdHours = dispositionSettings.holdHours;

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Returns & Destruction" }]}
      />
      <AdminPageHeader
        title="Returns & Destruction"
        subtitle="Customer returns, vendor returns with manifests, and compliant destruction — with CCRS corrections queued automatically."
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {OK_MESSAGES[sp.ok] ?? "Saved."}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Customer returns (30d)" value={summary.customerReturnsLast30.toLocaleString()} accent="muted" />
        <StatCard label="Vendor returns (30d)" value={summary.returnsLast30.toLocaleString()} accent="muted" />
        <StatCard
          label="CCRS corrections pending"
          value={summary.correctionsPending.toLocaleString()}
          accent={summary.correctionsPending > 0 ? "gold" : "muted"}
        />
        <StatCard label="Destructions pending" value={summary.destructionsPending.toLocaleString()} accent="gold" />
        <StatCard
          label="Destroyed (30d)"
          value={summary.destructionsCompletedLast30.toLocaleString()}
          accent="green"
        />
      </div>

      {summary.correctionsPending > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/[0.06] px-4 py-3">
          <p className="text-sm text-white/80">
            <span className="font-semibold text-[#ffd700]">{summary.correctionsPending}</span> customer-return Sale
            correction{summary.correctionsPending === 1 ? "" : "s"} pending — include this file in your next CCRS
            upload so the returned sale{summary.correctionsPending === 1 ? " is" : "s are"} deleted/updated in CCRS.
          </p>
          <Link
            href="/admin/inventory/disposition/sale-correction-export"
            prefetch={false}
            className="rounded-lg bg-[#ffd700] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#e6c200]"
          >
            Download Sale correction CSV
          </Link>
        </div>
      ) : null}

      <HelpPanel
        id="disposition-help"
        title="How disposition works (the compliant way)"
        steps={[
          "Customer return: find the completed sale, attest that the product is in ORIGINAL packaging with a fully legible lot ID (WAC 314-55-079(12)) — otherwise refuse it. The system adds it back to inventory as a CCRS 'Other' adjustment and queues the Sale Delete/Update correction (per the LCB's CCRS FAQ).",
          "Vendor return: get the processor's RMA first, then follow the manifest checklist — manifests must be generated in the CCRS portal and submitted 48–72h before pickup (WAC 314-55-085).",
          `Destruction: scheduling opens a ${holdHours}-hour hold (a STORE POLICY you can tune below — the old 72-hour LCB notice was removed from the rule). Product must be rendered unusable BEFORE leaving the premises: grind + mix at least 50% non-cannabis waste (WAC 314-55-097).`,
          "Recalls: NEVER destroy recall-affected product before notifying the LCB and coordinating with your enforcement officer (WAC 314-55-225) — the completion form enforces this.",
          "Everything posts to the CCRS InventoryAdjustment.csv on the Compliance tab; keep all records 3 years (WAC 314-55-087).",
        ]}
      />

      {/* Customer return wizard */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/80">Customer return</h2>
        <p className="mb-4 text-xs text-white/40">
          Guided intake for a valid customer return — inventory add-back, CCRS Sale correction, and (optionally) a
          destruction event, all in one step.
        </p>
        <CustomerReturnWizard />
      </section>

      {/* Vendor return + schedule destruction forms */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/80">Log a vendor return</h2>
          <p className="mb-4 text-xs text-white/40">
            Returning product to the producer/processor. Reduces on-hand now and posts an &lsquo;Other&rsquo;
            adjustment for CCRS.
          </p>
          {lots.length === 0 ? (
            <EmptyState title="No active lots" description="Receive inventory first." />
          ) : (
            <form action={createVendorReturnAction} className="space-y-3">
              <Field label="Lot" required>
                <Select name="lot_id" required>
                  <option value="">Select a lot…</option>
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {(l.product_name ?? "—") + " · " + (l.lot_code ?? l.id.slice(0, 8))} ({fmtQty(l.on_hand_qty, l.unit)})
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity" required>
                  <Input name="quantity" type="number" step="any" min="0" required />
                </Field>
                <Field label="Reason" required>
                  <Select name="reason" required defaultValue="defective">
                    {VENDOR_RETURN_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {VENDOR_RETURN_REASON_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="RMA #" help="Processor's return authorization">
                  <Input name="rma_number" />
                </Field>
                <Field label="Manifest #" help="Once created in the CCRS portal">
                  <Input name="manifest_number" />
                </Field>
              </div>
              <Field label="Processor license #" help="The receiving licensee">
                <Input name="processor_license" />
              </Field>
              <Field label="Detail">
                <Textarea name="detail" rows={2} placeholder="Contact, condition, agreement reference…" />
              </Field>
              <Button type="submit">Log return (reduces on-hand)</Button>
            </form>
          )}
          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Manifest checklist</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-white/55">
              {VENDOR_RETURN_MANIFEST_STEPS.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/80">Schedule a destruction</h2>
          <p className="mb-4 text-xs text-white/40">
            Opens a {holdHours}h hold and quarantines the lot. Complete it below once the hold elapses.
          </p>
          {lots.length === 0 ? (
            <EmptyState title="No active lots" description="Receive inventory first." />
          ) : (
            <form action={scheduleDestructionAction} className="space-y-3">
              <Field label="Lot" required>
                <Select name="lot_id" required>
                  <option value="">Select a lot…</option>
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {(l.product_name ?? "—") + " · " + (l.lot_code ?? l.id.slice(0, 8))} ({fmtQty(l.on_hand_qty, l.unit)})
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity" required>
                  <Input name="quantity" type="number" step="any" min="0" required />
                </Field>
                <Field label="Reason" required>
                  <Select name="reason" required defaultValue="expired">
                    {DESTRUCTION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {DESTRUCTION_REASON_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Detail">
                <Textarea name="detail" rows={2} placeholder="What & why…" />
              </Field>
              <p className="text-xs text-[#ffd700]/80">
                Recall product? Do NOT destroy before notifying the LCB and coordinating with your enforcement
                officer (WAC 314-55-225).
              </p>
              <Button type="submit">Schedule (opens {holdHours}h hold)</Button>
            </form>
          )}
        </section>
      </div>

      {/* Destruction events + completion */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Destruction events</h2>
        {destructions.length === 0 ? (
          <EmptyState title="No destruction events" description="Scheduled destructions appear here." />
        ) : (
          <ul className="space-y-3">
            {destructions.map((d: DestructionEventWithLot) => {
              const holdElapsed = d.hold_elapsed;
              const isOpen = d.status === "pending_quarantine" || d.status === "ready";
              const isRecall = d.reason === "recall";
              return (
                <li key={d.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white/90">
                        {d.product_name ?? "—"}{" "}
                        <span className="font-mono text-xs text-white/40">{d.lot_code ?? d.lot_id.slice(0, 8)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/40">
                        {fmtQty(d.quantity, d.unit)} · {d.reason.replace("_", " ")}
                        {d.earliest_destroy_at
                          ? ` · hold ends ${new Date(d.earliest_destroy_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isRecall && isOpen ? <Badge tone="danger">recall — coordinate with LCB</Badge> : null}
                      <Badge tone={destructionTone(d.status)}>{d.status.replace("_", " ")}</Badge>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 space-y-3">
                      <form action={completeDestructionAction.bind(null, d.id)} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Rendering method" help="How it's made unusable (WAC 314-55-097)" required>
                            <Select name="rendering_method" required defaultValue="grind_mix_compostable">
                              {RENDERING_METHODS.map((m) => (
                                <option key={m} value={m}>
                                  {RENDERING_METHOD_LABELS[m]}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Mixed with" help="e.g. food waste, cardboard, plastic waste">
                            <Input name="mix_material" placeholder="Coffee grounds / shredded cardboard…" />
                          </Field>
                        </div>
                        <label className="flex items-start gap-2 text-xs text-white/70">
                          <input type="checkbox" name="fifty_percent" className="mt-0.5" />
                          <span>
                            The mixture is at least <strong>50% non-cannabis waste by volume</strong> (required for
                            grind-and-mix methods).
                          </span>
                        </label>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="Final destination" help="Where the waste goes">
                            <Input name="final_destination" placeholder="Dumpster / compost / landfill…" />
                          </Field>
                          <Field label="Disposal facility" help="Hauler or facility name">
                            <Input name="disposal_facility" placeholder="Waste Management…" />
                          </Field>
                          <Field label="Witnessed by">
                            <Input name="witnessed_by" placeholder="Names" />
                          </Field>
                        </div>
                        {isRecall ? (
                          <div className="rounded-lg border border-[#ff6b6b]/30 bg-[#ff6b6b]/[0.06] px-3 py-2.5">
                            <p className="text-xs font-semibold text-[#ff6b6b]">
                              Recall destruction — LCB coordination is REQUIRED first (WAC 314-55-225).
                            </p>
                            <label className="mt-2 flex items-start gap-2 text-xs text-white/70">
                              <input type="checkbox" name="lcb_coordinated" className="mt-0.5" />
                              <span>The LCB has been notified and destruction was coordinated with our officer.</span>
                            </label>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                              <Field label="LCB officer">
                                <Input name="lcb_officer" placeholder="Officer name" />
                              </Field>
                              <Field label="Contact date">
                                <Input name="lcb_contact_date" type="date" />
                              </Field>
                            </div>
                          </div>
                        ) : null}
                        <Button type="submit" disabled={!holdElapsed}>
                          {holdElapsed ? "Complete destruction" : "Hold not elapsed"}
                        </Button>
                      </form>
                      <form action={cancelDestructionAction.bind(null, d.id)}>
                        <Button type="submit" variant="neutral">
                          Cancel (release quarantine)
                        </Button>
                      </form>
                    </div>
                  ) : d.status === "completed" ? (
                    <p className="mt-2 text-xs text-white/40">
                      Destroyed {d.completed_at ? new Date(d.completed_at).toLocaleString() : ""}
                      {d.witnessed_by ? ` · witnessed by ${d.witnessed_by}` : ""}
                      {d.rendering_method ? ` · ${d.rendering_method.replace(/_/g, " ")}` : d.method ? ` · ${d.method}` : ""}
                      {d.final_destination ? ` · to ${d.final_destination}` : ""}
                      {d.disposal_facility ? ` (${d.disposal_facility})` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent vendor returns + manifest workflow */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Vendor returns & manifests</h2>
        {returns.length === 0 ? (
          <EmptyState title="No returns yet" description="Logged vendor returns appear here." />
        ) : (
          <ul className="space-y-3">
            {returns.map((r: VendorReturnWithLot) => {
              const status = (r.manifest_status ?? "none") as string;
              const nextStatuses = nextManifestStatuses(status);
              return (
                <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white/90">
                        {r.product_name ?? "—"}{" "}
                        <span className="font-mono text-xs text-white/40">{r.lot_code ?? r.lot_id.slice(0, 8)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/40">
                        {fmtQty(r.quantity, r.unit)} · {r.reason}
                        {r.rma_number ? ` · RMA ${r.rma_number}` : ""}
                        {r.manifest_number ? ` · manifest ${r.manifest_number}` : ""}
                        {r.processor_license ? ` · lic ${r.processor_license}` : ""} ·{" "}
                        {new Date(r.created_at).toLocaleDateString()}
                        {r.pickup_at ? ` · pickup ${new Date(r.pickup_at).toLocaleString()}` : ""}
                      </p>
                    </div>
                    <Badge tone={manifestTone(status)}>
                      {MANIFEST_STATUS_LABELS[status as keyof typeof MANIFEST_STATUS_LABELS] ?? status}
                    </Badge>
                  </div>
                  {nextStatuses.length > 0 ? (
                    <form
                      action={updateManifestAction.bind(null, r.id)}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <Field label="Advance to" className="min-w-[200px]">
                        <Select name="manifest_status" defaultValue={nextStatuses[0]}>
                          {nextStatuses.map((s) => (
                            <option key={s} value={s}>
                              {MANIFEST_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Manifest #" className="min-w-[160px]">
                        <Input name="manifest_number" defaultValue={r.manifest_number ?? ""} />
                      </Field>
                      <Field label="Pickup (optional)" className="min-w-[200px]">
                        <Input name="pickup_at" type="datetime-local" />
                      </Field>
                      <Button type="submit" variant="neutral">
                        Update manifest
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent customer returns */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Recent customer returns</h2>
        {customerReturns.length === 0 ? (
          <EmptyState
            title="No customer returns yet"
            description="Use the wizard above — it handles the inventory add-back and CCRS correction for you."
          />
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {customerReturns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-white/85">{r.product_name ?? "—"}</span>{" "}
                  <span className="font-mono text-xs text-white/40">{r.sale_external_id ?? ""}</span>
                </div>
                <span className="flex items-center gap-2 text-xs text-white/40">
                  qty {r.quantity} · {r.reason.replace("_", " ")} · {r.disposition} · $
                  {(r.refund_minor_units / 100).toFixed(2)} refunded ·{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                  <Badge tone={r.correction_status === "exported" ? "green" : "gold"}>
                    {r.correction_status === "exported"
                      ? `Sale ${r.correction_operation} exported`
                      : `Sale ${r.correction_operation} pending`}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI advisor */}
      <DispositionAdvisorPanel aiEnabled={isAiConfigured} />

      {/* Hold policy */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/80">Destruction hold policy</h2>
        <p className="mb-4 text-xs text-white/40">
          How long a scheduled destruction is held before it can be completed. This is a STORE POLICY safety window —
          the old 72-hour LCB notice was removed from WAC 314-55-097 (WSR 22-14-111). 72h remains a sensible default.
        </p>
        <form action={updateDispositionSettingsAction} className="flex flex-wrap items-end gap-3">
          <Field label="Hold (hours)" help={`${HOLD_HOURS_MIN}–${HOLD_HOURS_MAX}`}>
            <Input
              name="hold_hours"
              type="number"
              min={HOLD_HOURS_MIN}
              max={HOLD_HOURS_MAX}
              step="1"
              defaultValue={holdHours}
              disabled={!canSettings}
            />
          </Field>
          {canSettings ? (
            <Button type="submit">Save hold policy</Button>
          ) : (
            <p className="text-xs text-white/40">Changing the hold policy requires the “Change settings” permission.</p>
          )}
        </form>
      </section>

      {/* Sample pricing settings */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/80">Sample-pricing rules</h2>
        <p className="mb-4 text-xs text-white/40">
          Product flagged as a vendor/QA sample is forced to a nominal price and (optionally) blocked from public sale.
        </p>
        <form action={updateSampleSettingsAction} className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
          <Field label="Nominal price ($)" help="WSLCB nominal value">
            <Input
              name="nominal_price_dollars"
              type="number"
              step="0.01"
              min="0"
              defaultValue={(sampleSettings.nominalPriceMinor / 100).toFixed(2)}
              disabled={!canSettings}
            />
          </Field>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                name="require_nominal_price"
                defaultChecked={sampleSettings.requireNominalPrice}
                disabled={!canSettings}
              />
              Force samples to the nominal price
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                name="block_public_sale"
                defaultChecked={sampleSettings.blockPublicSale}
                disabled={!canSettings}
              />
              Block selling samples to the public
            </label>
          </div>
          <div className="sm:col-span-2">
            {canSettings ? (
              <Button type="submit">Save sample rules</Button>
            ) : (
              <p className="text-xs text-white/40">Changing sample rules requires the “Change settings” permission.</p>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
