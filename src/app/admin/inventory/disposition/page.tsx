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
  HOLD_HOURS_MIN,
  HOLD_HOURS_MAX,
} from "@/lib/inventory/disposition-core";
import {
  DESTROYABLE_LOT_STATUS_LABELS,
  isDestroyableLotStatus,
  schedulableDestructionReasons,
  lotCloseMessage,
  DESTRUCTION_CANCEL_REASON_MAX,
  type LotCloseAction,
} from "@/lib/inventory/destruction-lot-status-core";
import { isAiConfigured } from "@/lib/inventory/disposition-advisor";
// Fix Phase 1.5 (G-42): the state's vendor-return method (D63, D65).
import {
  VENDOR_RETURN_STATUS_LABELS,
  VENDOR_RETURN_STATE_STEPS,
  TRANSPORTATION_TYPES,
  TRANSPORTATION_TYPE_LABELS,
  nextVendorReturnStatus,
  isOpenVendorReturn,
  isLegacyReducedReturn,
  formatPacific,
} from "@/lib/inventory/vendor-return-core";
import { listVendors } from "@/lib/vendors/store";
import { pacificParts } from "@/lib/reports/timezone";
import { heldReleaseMessage } from "@/lib/inventory/held-stock-core";
import { CustomerReturnWizard } from "@/components/admin/inventory/CustomerReturnWizard";
import { DispositionAdvisorPanel } from "@/components/admin/inventory/DispositionAdvisorPanel";
import {
  createVendorReturnAction,
  updateManifestAction,
  updateVendorReturnTransportAction,
  cancelVendorReturnAction,
  scheduleDestructionAction,
  completeDestructionAction,
  cancelDestructionAction,
  updateDispositionSettingsAction,
} from "./actions";

export const dynamic = "force-dynamic";

const OK_MESSAGES: Record<string, string> = {
  customer_return:
    "Customer return logged — inventory adjusted, CCRS Sale correction queued. Download the correction CSV before your next upload.",
  returned:
    "Vendor return logged. The units are reserved (out of sale) and still on hand; nothing goes to CCRS until they depart.",
  manifest: "Manifest step saved.",
  transport: "Transport details saved. Download Manifest.CSV and upload it to CCRS.",
  departed: "Departure recorded: on-hand reduced and the CCRS Other adjustment posted.",
  vr_cancelled: "Vendor return cancelled.",
  scheduled: "Destruction scheduled — the hold timer is running and the lot is quarantined.",
  destroyed: "Destruction completed and the CCRS 'Destruction' adjustment posted.",
  cancelled: "Destruction cancelled.",
  settings: "Hold policy saved.",
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

/** Pacific YYYY-MM-DD and HH:MM for the date/time inputs (F-15-3: never the server's zone). */
function pacificInputs(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const p = pacificParts(iso);
  const z = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${z(p.month)}-${z(p.day)}`, time: `${z(p.hour)}:${z(p.minute)}` };
}

function manifestTone(status: string): "neutral" | "green" | "gold" | "orange" | "danger" {
  if (status === "cancelled") return "neutral";
  if (status === "picked_up") return "green";
  if (status === "confirmed") return "gold";
  if (status === "submitted" || status === "requested") return "orange";
  return "neutral";
}

export default async function DispositionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; lot?: string; lotmsg?: string; held?: string }>;
}) {
  const session = await requirePermission("inventory.manage");
  const canSettings = can(session.profile.role, "settings.manage");
  // Fix Phase 1.3 (G-28 req 6): only the owner may cancel a scheduled destruction.
  const canCancelDestruction = can(session.profile.role, "inventory.destruction.cancel");
  // Fix Phase 1.5 (G-42 req 5): only the owner cancels a vendor return.
  const canCancelVendorReturn = can(session.profile.role, "inventory.vendor_return.cancel");
  const sp = await searchParams;

  const [lots, quarantineLots, recalledLots, vendors, returns, destructions, customerReturns, summary, dispositionSettings] =
    await Promise.all([
      listLots({ status: "active", limit: 500 }),
      // Fix Phase 1.3 (G-28 req 1, F-05a-17): the destruction picker also lists
      // Quarantine lots. Recalled lots are NOT listed: recalled product is never
      // destroyed by us, it goes back to the vendor (D65; SOP-15 §4.21).
      listLots({ status: "quarantine", limit: 500 }),
      // Fix Phase 1.5 (G-42 v1.1 item 12; D65): a Recalled lot goes back to the
      // vendor, so the vendor-return picker lists it (never the destruction picker).
      listLots({ status: "recalled", limit: 500 }),
      listVendors({ active: true }),
      listVendorReturns(50),
      listDestructionEvents(50),
      listCustomerReturns(20),
      dispositionSummary(),
      getDispositionSettings(),
    ]);

  const holdHours = dispositionSettings.holdHours;
  const destroyableLots = [...lots, ...quarantineLots].filter((l) => isDestroyableLotStatus(l.status));
  const returnableLots = [...lots, ...quarantineLots, ...recalledLots];
  const lotStatusLabel = (st: string) => (st === "recalled" ? "Recalled" : st === "quarantine" ? "Quarantine" : "Active");
  const vrReleased = sp.ok === "vr_cancelled" ? Number(sp.held ?? "") : NaN;
  const preselectLot = typeof sp.lot === "string" && destroyableLots.some((l) => l.id === sp.lot) ? sp.lot : "";
  const destructionReasons = schedulableDestructionReasons(DESTRUCTION_REASONS);
  const lotCloseWhys: LotCloseAction["why"][] = ["restored", "untouched", "was_quarantine", "other_open_event", "changed_since", "unknown_previous"];
  const cancelLotMessage =
    sp.ok === "cancelled" && lotCloseWhys.includes(sp.lotmsg as LotCloseAction["why"])
      ? lotCloseMessage(
          sp.lotmsg === "restored"
            ? { action: "restore_active", why: "restored" }
            : { action: "leave", why: sp.lotmsg as Exclude<LotCloseAction["why"], "restored"> },
        )
      : null;
  // Fix Phase 1.4 (G-44): a cancelled customer-return destruction released its held units.
  const heldReleasedCount = sp.ok === "cancelled" ? Number(sp.held ?? "") : NaN;
  const heldReleaseNote = Number.isFinite(heldReleasedCount) && heldReleasedCount > 0 ? heldReleaseMessage(heldReleasedCount) : null;

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
          {cancelLotMessage ? <span data-testid="cancel-lot-message"> {cancelLotMessage}</span> : null}
          {heldReleaseNote ? <span data-testid="held-release-message"> {heldReleaseNote}</span> : null}
          {Number.isFinite(vrReleased) && vrReleased > 0 ? (
            <span data-testid="vr-release-message"> {vrReleased} reserved unit(s) released; they count as sellable stock again.</span>
          ) : null}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/[0.06] px-4 py-3">
          <p className="text-sm text-white/80">
            <span className="font-semibold text-[var(--admin-gold)]">{summary.correctionsPending}</span> customer-return Sale
            correction{summary.correctionsPending === 1 ? "" : "s"} pending — include this file in your next CCRS
            upload so the returned sale{summary.correctionsPending === 1 ? " is" : "s are"} deleted/updated in CCRS.
          </p>
          <Link
            href="/admin/inventory/disposition/sale-correction-export"
            prefetch={false}
            className="rounded-lg bg-[var(--admin-gold)] px-4 py-2 text-sm font-bold text-black transition hover:brightness-110"
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
          "Vendor return: get the processor's written acceptance (RMA) first. Logging reserves the units (out of sale, still on hand). Greenway is the origin: download Manifest.CSV, upload it to CCRS, wait for the LCB's success email with the manifest PDF, and print it; it travels with the product (WAC 314-55-085). On-hand comes off and the CCRS 'Other' adjustment posts only at departure.",
          `Destruction: scheduling opens a ${holdHours}-hour hold (a STORE POLICY you can tune below — the old 72-hour LCB notice was removed from the rule). Product must be rendered unusable BEFORE leaving the premises: grind + mix at least 50% non-cannabis waste (WAC 314-55-097).`,
          "Recalls: NEVER destroy recall-affected product before notifying the LCB and coordinating with your enforcement officer (WAC 314-55-225) — the completion form enforces this.",
          "Everything posts to the CCRS InventoryAdjustment.csv on the Compliance tab; keep all records 5 years (WAC 314-55-087).",
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
            Returning product to the processor (WAC 314-55-079(11)). Logging <strong>reserves</strong> the units: out of
            sale, still on hand and in CCRS. On-hand comes off and the CCRS &lsquo;Other&rsquo; adjustment posts only
            when the product departs with the LCB&rsquo;s manifest PDF.
          </p>
          {returnableLots.length === 0 ? (
            <EmptyState title="No Active, Quarantine or Recalled lots" description="Receive inventory first." />
          ) : (
            <form action={createVendorReturnAction} className="space-y-3">
              <Field label="Lot" required help="Active, Quarantine or Recalled. A Recalled lot stays Recalled until it departs (D65).">
                <Select name="lot_id" required>
                  <option value="">Select a lot…</option>
                  {returnableLots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {(l.product_name ?? "—") + " · " + (l.lot_code ?? l.id.slice(0, 8))} ({fmtQty(l.on_hand_qty, l.unit)}) ·{" "}
                      {lotStatusLabel(l.status)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity" required>
                  <Input name="quantity" type="number" step="any" min="0" required />
                </Field>
                <Field label="Reason" required>
                  <Select name="reason" required defaultValue="">
                    <option value="">Choose…</option>
                    {VENDOR_RETURN_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {VENDOR_RETURN_REASON_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Vendor (processor)" help="Leave on 'The lot's vendor' to use the vendor the lot was received from.">
                <Select name="vendor_id" defaultValue="">
                  <option value="">The lot&rsquo;s vendor</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.display_name}
                      {v.license_number ? ` · ${v.license_number}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="RMA #" required help="The processor's written acceptance">
                  <Input name="rma_number" required />
                </Field>
                <Field label="Processor license #" help="Blank = the vendor's license in Vendors & Brands">
                  <Input name="processor_license" inputMode="numeric" />
                </Field>
              </div>
              <Field label="Detail" required help="Who agreed, the condition, the agreement. It becomes the CCRS 'Other' detail.">
                <Textarea name="detail" rows={2} required placeholder="Contact, condition, agreement reference…" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Recall: LCB officer told" help="Reason Recall only (WAC 314-55-225)">
                  <Input name="recall_officer" />
                </Field>
                <Field label="Recall: date the officer was told" help="Reason Recall only">
                  <Input name="recall_contact_date" type="date" />
                </Field>
              </div>
              <Button type="submit">Log return (reserves the units)</Button>
            </form>
          )}
          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">The state&rsquo;s steps</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-white/55">
              {VENDOR_RETURN_STATE_STEPS.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        </section>

        <section id="schedule-destruction" className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-white/80">Schedule a destruction</h2>
          <p className="mb-4 text-xs text-white/40">
            Opens a {holdHours}h hold and quarantines the lot (a lot already in Quarantine stays there). Complete
            it below once the hold elapses. Recalled lots are not listed: they go back to the vendor, never
            destroyed by us.
          </p>
          {destroyableLots.length === 0 ? (
            <EmptyState title="No Active or Quarantine lots" description="Receive inventory first." />
          ) : (
            <form action={scheduleDestructionAction} className="space-y-3">
              <Field label="Lot" required>
                {/* Fix Phase 1.2 (G-23 req 3): the lot page's Schedule destruction link
                    opens this form with that lot chosen (?lot=<id>). */}
                <Select name="lot_id" required defaultValue={preselectLot}>
                  <option value="">Select a lot…</option>
                  {destroyableLots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {(l.product_name ?? "—") + " · " + (l.lot_code ?? l.id.slice(0, 8))} ({fmtQty(l.on_hand_qty, l.unit)}) ·{" "}
                      {isDestroyableLotStatus(l.status) ? DESTROYABLE_LOT_STATUS_LABELS[l.status] : l.status}
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
                    {destructionReasons.map((r) => (
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
              <p className="text-xs text-[var(--admin-gold)]/80">
                Recall product? Never destroy it: recalled product goes back to the vendor (owner decision D65).
                The admin tells the LCB officer first (WAC 314-55-225), then Log a vendor return with reason Recall.
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
                      {canCancelDestruction ? (
                        <form action={cancelDestructionAction.bind(null, d.id)} className="space-y-2" data-testid="cancel-destruction-form">
                          <Field label="Why cancel? (required)" help="Kept on the event and in the Security Log with your name. The lot goes back to the status it had before scheduling.">
                            <Input name="cancel_reason" required maxLength={DESTRUCTION_CANCEL_REASON_MAX} placeholder="e.g. Vendor will take it back" />
                          </Field>
                          <Button type="submit" variant="neutral">
                            Cancel destruction (owner)
                          </Button>
                        </form>
                      ) : (
                        <p className="text-xs text-white/40" data-testid="cancel-destruction-owner-only">
                          Only the owner can cancel a scheduled destruction (SOP-15 §2 rule 3).
                        </p>
                      )}
                    </div>
                  ) : d.status === "cancelled" ? (
                    <p className="mt-2 text-xs text-white/40">
                      Cancelled {d.cancelled_at ? new Date(d.cancelled_at).toLocaleString() : ""}
                      {d.cancel_reason ? ` · why: ${d.cancel_reason}` : ""}
                    </p>
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

      {/* Recent vendor returns + manifest workflow (Fix Phase 1.5, G-42) */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Vendor returns & manifests</h2>
        {returns.length === 0 ? (
          <EmptyState title="No returns yet" description="Logged vendor returns appear here." />
        ) : (
          <ul className="space-y-3">
            {returns.map((r: VendorReturnWithLot) => {
              const status = (r.manifest_status ?? "none") as string;
              const next = nextVendorReturnStatus(status);
              const open = isOpenVendorReturn(status);
              const legacy = isLegacyReducedReturn(r);
              const dep = pacificInputs(r.est_departure_at);
              const arr = pacificInputs(r.est_arrival_at);
              return (
                <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid="vendor-return-row">
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
                        {r.processor_license ? ` · lic ${r.processor_license}` : ""} · logged {formatPacific(r.created_at)}
                        {r.lcb_email_date ? ` · LCB email ${r.lcb_email_date}` : ""}
                        {r.pickup_at ? ` · departed ${formatPacific(r.pickup_at)}` : ""}
                        {r.driver_name ? ` · driver ${r.driver_name}` : ""}
                        {r.cancel_reason ? ` · cancelled: ${r.cancel_reason}` : ""}
                      </p>
                      {open && Number(r.reserved_qty ?? 0) > 0 ? (
                        <p className="mt-0.5 text-xs text-[var(--admin-gold)]">
                          {fmtQty(Number(r.reserved_qty), r.unit)} reserved: out of sale, still on hand and in CCRS until departure.
                        </p>
                      ) : null}
                      {open && legacy ? (
                        <p className="mt-0.5 text-xs text-white/50">Logged before Phase 1.5: on-hand already came off at logging.</p>
                      ) : null}
                    </div>
                    <Badge tone={manifestTone(status)}>
                      {VENDOR_RETURN_STATUS_LABELS[status as keyof typeof VENDOR_RETURN_STATUS_LABELS] ?? status}
                    </Badge>
                  </div>

                  {open && status !== "none" ? (
                    <details className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-white/70">
                        Transport details and Manifest.CSV (Greenway is the origin)
                      </summary>
                      <form action={updateVendorReturnTransportAction.bind(null, r.id)} className="mt-3 grid gap-2 sm:grid-cols-2">
                        <Field label="Transportation type" required>
                          <Select name="transportation_type" defaultValue={r.transportation_type ?? ""} required>
                            <option value="">Choose…</option>
                            {TRANSPORTATION_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TRANSPORTATION_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Transporter license #" help="Transporter Licensee only">
                          <Input name="transporter_license" defaultValue={r.transporter_license ?? ""} inputMode="numeric" />
                        </Field>
                        <Field label="Driver name" required>
                          <Input name="driver_name" defaultValue={r.driver_name ?? ""} maxLength={75} />
                        </Field>
                        <Field label="VIN #">
                          <Input name="vehicle_vin" defaultValue={r.vehicle_vin ?? ""} maxLength={50} />
                        </Field>
                        <Field label="Plate">
                          <Input name="vehicle_plate" defaultValue={r.vehicle_plate ?? ""} maxLength={7} />
                        </Field>
                        <Field label="Make">
                          <Input name="vehicle_make" defaultValue={r.vehicle_make ?? ""} maxLength={25} />
                        </Field>
                        <Field label="Model">
                          <Input name="vehicle_model" defaultValue={r.vehicle_model ?? ""} maxLength={25} />
                        </Field>
                        <Field label="Color">
                          <Input name="vehicle_color" defaultValue={r.vehicle_color ?? ""} maxLength={15} />
                        </Field>
                        <Field label="Estimated departure (Pacific)">
                          <div className="flex gap-2">
                            <Input name="est_departure_date" type="date" defaultValue={dep.date} />
                            <Input name="est_departure_time" type="time" defaultValue={dep.time} />
                          </div>
                        </Field>
                        <Field label="Estimated arrival (Pacific)">
                          <div className="flex gap-2">
                            <Input name="est_arrival_date" type="date" defaultValue={arr.date} />
                            <Input name="est_arrival_time" type="time" defaultValue={arr.time} />
                          </div>
                        </Field>
                        <Field label="Weight per unit (g)" help="Only if the lot has no unit weight">
                          <Input name="weight_per_unit_g" type="number" step="0.01" min="0" defaultValue={r.weight_per_unit_g ?? ""} />
                        </Field>
                        <Field label="Servings per unit" help="Only if the lot has no servings per pack">
                          <Input name="servings_per_unit" type="number" step="0.01" min="0" defaultValue={r.servings_per_unit ?? ""} />
                        </Field>
                        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                          <Button type="submit" variant="neutral">
                            Save transport details
                          </Button>
                          <a
                            href={`/admin/inventory/disposition/vendor-return-manifest?id=${encodeURIComponent(r.id)}`}
                            className="text-xs font-semibold text-[var(--admin-accent)] underline"
                          >
                            Download Manifest.CSV
                          </a>
                        </div>
                      </form>
                    </details>
                  ) : null}

                  {open && next ? (
                    <form action={updateManifestAction.bind(null, r.id)} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="manifest_status" value={next} />
                      <p className="w-full text-xs text-white/60">
                        Next step: <strong>{VENDOR_RETURN_STATUS_LABELS[next]}</strong>
                      </p>
                      {next === "submitted" ? (
                        <Field label="Manifest # uploaded" required className="min-w-[200px]">
                          <Input name="manifest_number" defaultValue={r.manifest_number ?? ""} required />
                        </Field>
                      ) : null}
                      {next === "confirmed" ? (
                        <Field label="Date of the LCB success email" required className="min-w-[200px]">
                          <Input name="lcb_email_date" type="date" required />
                        </Field>
                      ) : null}
                      {next === "picked_up" ? (
                        <>
                          <Field label="Pickup date (Pacific)" required>
                            <Input name="pickup_date" type="date" required />
                          </Field>
                          <Field label="Pickup time (Pacific)" required>
                            <Input name="pickup_time" type="time" required />
                          </Field>
                          <Field label="Driver name" required className="min-w-[180px]">
                            <Input name="driver_name" defaultValue={r.driver_name ?? ""} required />
                          </Field>
                        </>
                      ) : null}
                      <Button type="submit" variant="neutral">
                        {next === "picked_up" ? "Record departure (reduces on-hand)" : "Save step"}
                      </Button>
                    </form>
                  ) : null}

                  {open && canCancelVendorReturn && !legacy ? (
                    <form action={cancelVendorReturnAction.bind(null, r.id)} className="mt-3 flex flex-wrap items-end gap-2">
                      <Field label="Cancel reason (owner)" className="min-w-[260px]">
                        <Input name="cancel_reason" maxLength={500} required />
                      </Field>
                      <Button type="submit" variant="neutral">
                        Cancel return (release units)
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

    </div>
  );
}
