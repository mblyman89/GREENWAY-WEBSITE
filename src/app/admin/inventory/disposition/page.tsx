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
  dispositionSummary,
  getSampleSettings,
  VENDOR_RETURN_REASONS,
  DESTRUCTION_REASONS,
  DESTRUCTION_QUARANTINE_HOURS,
  type DestructionEventWithLot,
  type VendorReturnWithLot,
} from "@/lib/inventory/disposition";
import {
  createVendorReturnAction,
  scheduleDestructionAction,
  completeDestructionAction,
  cancelDestructionAction,
  updateSampleSettingsAction,
} from "./actions";

export const dynamic = "force-dynamic";

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

export default async function DispositionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePermission("inventory.manage");
  const canSettings = can(session.profile.role, "settings.manage");
  const sp = await searchParams;

  const [lots, returns, destructions, summary, sampleSettings] = await Promise.all([
    listLots({ status: "active", limit: 500 }),
    listVendorReturns(50),
    listDestructionEvents(50),
    dispositionSummary(),
    getSampleSettings(),
  ]);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Returns & Destruction" }]}
      />
      <AdminPageHeader
        title="Returns & Destruction"
        subtitle="Vendor returns, compliant destruction with quarantine hold, and sample-pricing rules."
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          Saved.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Returns (30d)" value={summary.returnsLast30.toLocaleString()} accent="muted" />
        <StatCard label="Destructions pending" value={summary.destructionsPending.toLocaleString()} accent="gold" />
        <StatCard
          label="Destroyed (30d)"
          value={summary.destructionsCompletedLast30.toLocaleString()}
          accent="green"
        />
      </div>

      <HelpPanel
        id="disposition-help"
        title="How disposition works"
        steps={[
          "Vendor return: reduces on-hand now and logs an 'Other' adjustment for CCRS. Use for recalls, defects, overstock.",
          `Destruction: schedule it to open a ${DESTRUCTION_QUARANTINE_HOURS}h quarantine hold. The lot is quarantined and cannot be destroyed until the hold elapses.`,
          "After the hold, complete the destruction with method + witnesses — it posts a 'Destruction' adjustment and reduces on-hand.",
          "Both flow into the CCRS InventoryAdjustment.csv on the Compliance tab.",
        ]}
      />

      {/* Vendor return + schedule destruction forms */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Log a vendor return</h2>
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
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="RMA #" help="Optional vendor return-authorization number">
                <Input name="rma_number" />
              </Field>
              <Field label="Detail">
                <Textarea name="detail" rows={2} placeholder="Contact, condition, manifest reference…" />
              </Field>
              <Button type="submit">Log return (reduces on-hand)</Button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Schedule a destruction</h2>
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
                        {r.replace("_", " ")}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Detail">
                <Textarea name="detail" rows={2} placeholder="What & why…" />
              </Field>
              <Button type="submit">
                Schedule (opens {DESTRUCTION_QUARANTINE_HOURS}h hold)
              </Button>
            </form>
          )}
        </section>
      </div>

      {/* Pending / scheduled destructions needing completion */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Destruction events</h2>
        {destructions.length === 0 ? (
          <EmptyState title="No destruction events" description="Scheduled destructions appear here." />
        ) : (
          <ul className="space-y-3">
            {destructions.map((d: DestructionEventWithLot) => {
              const holdElapsed = d.hold_elapsed;
              const isOpen = d.status === "pending_quarantine" || d.status === "ready";
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
                          ? ` · earliest destroy ${new Date(d.earliest_destroy_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <Badge tone={destructionTone(d.status)}>{d.status.replace("_", " ")}</Badge>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <form
                        action={completeDestructionAction.bind(null, d.id)}
                        className="flex flex-1 flex-wrap items-end gap-2"
                      >
                        <Field label="Method" className="flex-1">
                          <Input name="method" placeholder="Rendered unusable; 50/50 soil" />
                        </Field>
                        <Field label="Witnessed by" className="flex-1">
                          <Input name="witnessed_by" placeholder="Names" />
                        </Field>
                        <Button type="submit" disabled={!holdElapsed}>
                          {holdElapsed ? "Complete destruction" : "Hold not elapsed"}
                        </Button>
                      </form>
                      <form action={cancelDestructionAction.bind(null, d.id)}>
                        <Button type="submit" variant="subtle">
                          Cancel
                        </Button>
                      </form>
                    </div>
                  ) : d.status === "completed" ? (
                    <p className="mt-2 text-xs text-white/40">
                      Destroyed {d.completed_at ? new Date(d.completed_at).toLocaleString() : ""}
                      {d.witnessed_by ? ` · witnessed by ${d.witnessed_by}` : ""}
                      {d.method ? ` · ${d.method}` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent vendor returns */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Recent vendor returns</h2>
        {returns.length === 0 ? (
          <EmptyState title="No returns yet" description="Logged vendor returns appear here." />
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {returns.map((r: VendorReturnWithLot) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium text-white/85">{r.product_name ?? "—"}</span>{" "}
                  <span className="font-mono text-xs text-white/40">{r.lot_code ?? r.lot_id.slice(0, 8)}</span>
                </div>
                <span className="text-xs text-white/40">
                  {fmtQty(r.quantity, r.unit)} · {r.reason}
                  {r.rma_number ? ` · RMA ${r.rma_number}` : ""} · {new Date(r.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
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
