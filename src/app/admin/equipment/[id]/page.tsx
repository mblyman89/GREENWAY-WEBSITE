import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { formatMoney } from "@/lib/pos/format";
import { listRegisters } from "@/lib/registers/store";
import {
  getEquipmentAsset,
  listServiceEvents,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES,
  SERVICE_EVENT_TYPES,
} from "@/lib/equipment/store";
import { updateEquipmentAssetAction, addServiceEventAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; service?: string; error?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { created, saved, service, error } = await searchParams;

  const [asset, registers, events] = await Promise.all([
    getEquipmentAsset(id),
    listRegisters({ includeInactive: true }),
    listServiceEvents(id),
  ]);
  if (!asset) notFound();

  const editAction = updateEquipmentAssetAction.bind(null, id);
  const serviceAction = addServiceEventAction.bind(null, id);
  const costDollars =
    asset.purchase_cost_minor != null ? (asset.purchase_cost_minor / 100).toFixed(2) : "";

  return (
    <div>
      <AdminPageHeader
        title={asset.name}
        subtitle={`${EQUIPMENT_CATEGORY_LABELS[asset.category]}${
          asset.asset_tag ? ` · ${asset.asset_tag}` : ""
        }`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Equipment", href: "/admin/equipment" },
              { label: asset.name },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {(created || saved) && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {created ? "Asset created." : "Asset saved."}
          </div>
        )}
        {service && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Service event logged.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Status" value={asset.status} accent={asset.status === "active" ? "green" : "muted"} />
          <StatCard label="Register" value={asset.register_name ?? "—"} accent="gold" />
          <StatCard
            label="Calibration"
            value={asset.requires_calibration ? asset.next_calibration_due ?? "—" : "n/a"}
            accent={asset.calibration_due ? "orange" : "muted"}
          />
          <StatCard
            label="Purchase cost"
            value={asset.purchase_cost_minor != null ? formatMoney(asset.purchase_cost_minor) : "—"}
            accent="muted"
          />
        </div>

        {/* Edit */}
        <Card>
          <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Asset details</h2>
          <form action={editAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" required>
                <Input name="name" defaultValue={asset.name} required />
              </Field>
              <Field label="Asset tag">
                <Input name="asset_tag" defaultValue={asset.asset_tag ?? ""} />
              </Field>
              <Field label="Category">
                <Select name="category" defaultValue={asset.category}>
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {EQUIPMENT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Manufacturer">
                <Input name="manufacturer" defaultValue={asset.manufacturer ?? ""} />
              </Field>
              <Field label="Model">
                <Input name="model" defaultValue={asset.model ?? ""} />
              </Field>
              <Field label="Serial number">
                <Input name="serial_number" defaultValue={asset.serial_number ?? ""} />
              </Field>
              <Field label="Register">
                <Select name="register_id" defaultValue={asset.register_id ?? ""}>
                  <option value="">Not mapped</option>
                  {registers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location">
                <Input name="location" defaultValue={asset.location ?? ""} />
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue={asset.status}>
                  {EQUIPMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Purchase date">
                <Input type="date" name="purchase_date" defaultValue={asset.purchase_date ?? ""} />
              </Field>
              <Field label="Purchase cost ($)">
                <Input type="number" step="0.01" name="purchase_cost_dollars" defaultValue={costDollars} />
              </Field>
              <Field label="Warranty expires">
                <Input type="date" name="warranty_expires" defaultValue={asset.warranty_expires ?? ""} />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  name="requires_calibration"
                  defaultChecked={asset.requires_calibration}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Requires calibration / inspection
              </label>
              <Field label="Last calibrated">
                <Input type="date" name="last_calibrated_on" defaultValue={asset.last_calibrated_on ?? ""} />
              </Field>
              <Field label="Next calibration due">
                <Input type="date" name="next_calibration_due" defaultValue={asset.next_calibration_due ?? ""} />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={asset.notes ?? ""} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="save" size="sm">
                💾 Save asset
              </Button>
            </div>
          </form>
        </Card>

        {/* Service log */}
        <Card>
          <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Service history</h2>
          {events.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">No service events yet.</p>
          ) : (
            <div className="mb-5 overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">By</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                    <th className="px-4 py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {events.map((e) => (
                    <tr key={e.id} className="bg-[var(--admin-surface)]">
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">{e.performed_on}</td>
                      <td className="px-4 py-2">
                        <Badge tone="neutral">{e.event_type}</Badge>
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">{e.performed_by ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-[var(--admin-text-muted)]">
                        {e.cost_minor != null ? formatMoney(e.cost_minor) : "—"}
                      </td>
                      <td className="px-4 py-2 text-[var(--admin-text-muted)]">{e.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form action={serviceAction} className="space-y-4 border-t border-[var(--admin-border)] pt-4">
            <h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
              Log a service event
            </h3>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Type">
                <Select name="event_type" defaultValue="service">
                  {SERVICE_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date">
                <Input type="date" name="performed_on" />
              </Field>
              <Field label="Performed by">
                <Input name="performed_by" placeholder="Vendor / technician" />
              </Field>
              <Field label="Cost ($)">
                <Input type="number" step="0.01" name="cost_dollars" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Next calibration due" help="Updates the asset when type is calibration/inspection">
                <Input type="date" name="next_calibration_due" />
              </Field>
              <Field label="Note">
                <Input name="note" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="neutral" size="sm">
                ＋ Log event
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
