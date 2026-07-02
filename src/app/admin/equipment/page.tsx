import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card, Field, Input, Select } from "@/components/admin/ui";
import { listRegisters } from "@/lib/registers/store";
import {
  listEquipmentAssets,
  summarizeEquipment,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES,
  type EquipmentStatus,
  type EquipmentCategory,
} from "@/lib/equipment/store";
import { createEquipmentAssetAction } from "./actions";

export const dynamic = "force-dynamic";

function statusTone(status: string): "green" | "gold" | "orange" | "neutral" {
  if (status === "active") return "green";
  if (status === "maintenance") return "gold";
  if (status === "lost") return "orange";
  return "neutral";
}

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string; q?: string; error?: string }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const status = (EQUIPMENT_STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as EquipmentStatus)
    : undefined;
  const category = (EQUIPMENT_CATEGORIES as readonly string[]).includes(sp.category ?? "")
    ? (sp.category as EquipmentCategory)
    : undefined;
  const q = (sp.q ?? "").trim() || undefined;

  const [assets, registers] = await Promise.all([
    listEquipmentAssets({ status, category, q }),
    listRegisters({ includeInactive: true }),
  ]);
  const summary = summarizeEquipment(assets);

  return (
    <div>
      <AdminPageHeader
        title="Equipment"
        subtitle="Asset registry for store hardware — terminals, scales, safes, cameras"
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Equipment" }]} />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {sp.error}
          </div>
        )}

        <HelpPanel
          id="equipment"
          title="What the asset registry tracks"
          steps={[
            "Add each piece of hardware: POS terminals, scales, safes, cameras, printers.",
            "Map a terminal or scale to a register so you can see which till it serves.",
            "Mark scales that require calibration and set the next-due date — the dashboard flags what's due.",
            "Log service, repairs, and inspections on each asset's page for a maintenance history.",
          ]}
        >
          Scope is a registry only. Commercial scales used to weigh cannabis must be legal-for-trade
          and periodically inspected — record the next calibration date so nothing lapses.
        </HelpPanel>

        {/* Integrated hardware — the devices wired into the back office. Seeded
            as registry rows by migration 0061; links jump to each device's
            config/usage page. */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[var(--admin-text)]">Your integrated hardware</h2>
            <Badge tone="outline">Wired into the back office</Badge>
          </div>
          <p className="mb-4 text-xs text-[var(--admin-text-faint)]">
            These devices are integrated with specific pages. Once migration 0061 is applied they
            also appear as registry rows below (fill in serial numbers / purchase details there).
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
              <div className="flex items-center gap-2">
                <span>🧾</span>
                <span className="text-sm font-semibold text-[var(--admin-text)]">
                  Star Micronics TSP143IV
                </span>
                <Badge tone="neutral">Receipt printer</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Auto-prints online pickup orders via CloudPRNT.
              </p>
              <Link
                href="/admin/settings/receipt-printer"
                className="mt-1 inline-block text-xs font-semibold text-[var(--admin-accent)] hover:underline"
              >
                Configure →
              </Link>
            </div>
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
              <div className="flex items-center gap-2">
                <span>🏷</span>
                <span className="text-sm font-semibold text-[var(--admin-text)]">
                  Rollo Wireless X1040
                </span>
                <Badge tone="neutral">Label printer</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                4×6 lot / shelf labels. Prints from the browser print dialog (no cloud API).
              </p>
              <Link
                href="/admin/inventory/intake"
                className="mt-1 inline-block text-xs font-semibold text-[var(--admin-accent)] hover:underline"
              >
                Print labels from Vendor Intake →
              </Link>
            </div>
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
              <div className="flex items-center gap-2">
                <span>🖨</span>
                <span className="text-sm font-semibold text-[var(--admin-text)]">
                  Canon PIXMA TS3522
                </span>
                <Badge tone="neutral">Scanner</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Scan medical authorization forms to PDF, then upload during intake.
              </p>
              <Link
                href="/admin/medical/intake"
                className="mt-1 inline-block text-xs font-semibold text-[var(--admin-accent)] hover:underline"
              >
                Authorization Intake →
              </Link>
            </div>
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
              <div className="flex items-center gap-2">
                <span>📇</span>
                <span className="text-sm font-semibold text-[var(--admin-text)]">
                  Scotch Thermal Laminator
                </span>
                <Badge tone="neutral">Laminator</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Laminates printed medical recognition cards so they last at the register.
              </p>
              <Link
                href="/admin/medical/intake"
                className="mt-1 inline-block text-xs font-semibold text-[var(--admin-accent)] hover:underline"
              >
                Used during Authorization Intake →
              </Link>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Total assets" value={summary.total} accent="muted" />
          <StatCard label="Active" value={summary.active} accent="green" />
          <StatCard
            label="Calibration due"
            value={summary.calibrationDue}
            hint={`${summary.calibrationSoon} due soon`}
            accent={summary.calibrationDue > 0 ? "orange" : "muted"}
          />
          <StatCard label="Mapped to register" value={summary.mappedToRegister} accent="gold" />
        </div>

        {/* Filters */}
        <form className="flex flex-wrap items-end gap-3" method="get">
          <Field label="Search" className="min-w-[200px]">
            <Input name="q" defaultValue={q ?? ""} placeholder="Name, tag, serial" />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              {EQUIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select name="category" defaultValue={category ?? ""}>
              <option value="">All</option>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EQUIPMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="neutral" size="sm">
            Filter
          </Button>
        </form>

        {/* Asset list */}
        {assets.length === 0 ? (
          <EmptyState
            title="No equipment yet"
            description="Add your first asset using the form below."
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Register</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Calibration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {assets.map((a) => (
                  <tr key={a.id} className="bg-[var(--admin-surface)]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/equipment/${a.id}`}
                        className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                      >
                        {a.name}
                      </Link>
                      <div className="text-xs text-[var(--admin-text-faint)]">
                        {a.asset_tag ?? "no tag"}
                        {a.serial_number && <span> · SN {a.serial_number}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                      {EQUIPMENT_CATEGORY_LABELS[a.category]}
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                      {a.register_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {a.requires_calibration ? (
                        a.calibration_due ? (
                          <Badge tone="danger">due {a.next_calibration_due}</Badge>
                        ) : a.calibration_soon ? (
                          <Badge tone="orange">soon {a.next_calibration_due}</Badge>
                        ) : (
                          <span className="text-xs text-[var(--admin-text-muted)]">
                            {a.next_calibration_due ?? "—"}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-[var(--admin-text-faint)]">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add asset */}
        <Card>
          <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Add an asset</h2>
          <form action={createEquipmentAssetAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" required>
                <Input name="name" placeholder="e.g. Front register iPad" required />
              </Field>
              <Field label="Asset tag" help="Optional short label">
                <Input name="asset_tag" placeholder="POS-01" />
              </Field>
              <Field label="Category">
                <Select name="category" defaultValue="pos_terminal">
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {EQUIPMENT_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Manufacturer">
                <Input name="manufacturer" />
              </Field>
              <Field label="Model">
                <Input name="model" />
              </Field>
              <Field label="Serial number">
                <Input name="serial_number" />
              </Field>
              <Field label="Register" help="Map to a till (optional)">
                <Select name="register_id" defaultValue="">
                  <option value="">Not mapped</option>
                  {registers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Location">
                <Input name="location" placeholder="Sales floor / Vault" />
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue="active">
                  {EQUIPMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Purchase date">
                <Input type="date" name="purchase_date" />
              </Field>
              <Field label="Purchase cost ($)">
                <Input type="number" step="0.01" name="purchase_cost_dollars" />
              </Field>
              <Field label="Warranty expires">
                <Input type="date" name="warranty_expires" />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  name="requires_calibration"
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Requires calibration / inspection
              </label>
              <Field label="Last calibrated">
                <Input type="date" name="last_calibrated_on" />
              </Field>
              <Field label="Next calibration due">
                <Input type="date" name="next_calibration_due" />
              </Field>
            </div>
            <Field label="Notes">
              <Input name="notes" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="save" size="sm">
                ＋ Add asset
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
