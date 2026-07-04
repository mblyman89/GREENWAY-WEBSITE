import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card, Field, Input, Section, Select } from "@/components/admin/ui";
import { listRegisters } from "@/lib/registers/store";
import { getPrinterSettings, isPrinterOnline } from "@/lib/printing/printer-store";
import {
  listEquipmentAssets,
  summarizeEquipment,
  resolveIntegratedDevices,
  warrantyExpiringSoon,
  WARRANTY_SOON_DAYS,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES,
  type EquipmentStatus,
  type EquipmentCategory,
  type EquipmentAssetView,
} from "@/lib/equipment/store";
import { createEquipmentAssetAction } from "./actions";

export const dynamic = "force-dynamic";

function statusTone(status: string): "green" | "gold" | "orange" | "neutral" {
  if (status === "active") return "green";
  if (status === "maintenance") return "gold";
  if (status === "lost") return "orange";
  return "neutral";
}

/** Group assets by category, preserving the canonical category ordering. */
function groupByCategory(
  assets: EquipmentAssetView[],
): { category: EquipmentCategory; rows: EquipmentAssetView[] }[] {
  return EQUIPMENT_CATEGORIES.map((category) => ({
    category,
    rows: assets.filter((a) => a.category === category),
  })).filter((g) => g.rows.length > 0);
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
  const hasFilters = Boolean(status || category || q);

  // Load everything the hub needs in parallel. The registry is the single
  // source of truth; the integrated-device catalog is paired against it.
  const [assets, allAssets, registers, printer] = await Promise.all([
    listEquipmentAssets({ status, category, q }),
    // Unfiltered set powers the at-a-glance stats, the attention list, and the
    // integrated-hardware pairing so those never change when the table is filtered.
    listEquipmentAssets({}),
    listRegisters({ includeInactive: true }),
    getPrinterSettings(),
  ]);

  const summary = summarizeEquipment(allAssets);
  const integrated = resolveIntegratedDevices(allAssets);
  const printerOnline = printer ? isPrinterOnline(printer.last_poll_at) : false;

  // "Needs attention" — only actionable items (calibration due/soon or warranty
  // expiring soon). warrantyExpiringSoon() lives in the store (single source of
  // truth for the window) so the list matches the stat card exactly. Kept off
  // the page entirely when nothing needs attention.
  const attention = allAssets.filter(
    (a) =>
      (a.requires_calibration && (a.calibration_due || a.calibration_soon)) ||
      warrantyExpiringSoon(a),
  );

  const grouped = groupByCategory(assets);

  return (
    <div>
      <AdminPageHeader
        title="Equipment"
        subtitle="One home for every piece of store hardware — integrated devices, POS, scales, safes, cameras"
        breadcrumbs={<Breadcrumbs items={[{ label: "Equipment" }]} />}
        action={
          <Button href="#add-asset" variant="save" size="sm">
            ＋ Add asset
          </Button>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {sp.error}
          </div>
        )}

        <HelpPanel
          id="equipment"
          title="What lives on this page"
          steps={[
            "Integrated hardware — the devices wired into workflows (receipt printer, label printer, scanner, laminator). Each card jumps to the page it drives.",
            "Asset registry — every other piece of hardware: POS terminals, scales, safes, cameras, network gear.",
            "Map a terminal or scale to a register so you can see which till it serves.",
            "Flag scales that need calibration and set the next-due date — anything due shows under “Needs attention”.",
            "Open an asset to log service, repairs, and inspections for a full maintenance history.",
          ]}
        >
          Commercial scales used to weigh cannabis must be legal-for-trade and periodically
          inspected — record the next calibration date so nothing lapses.
        </HelpPanel>

        {/* At a glance */}
        <Section title="At a glance">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Total assets" value={summary.total} accent="muted" />
            <StatCard label="Active" value={summary.active} accent="green" />
            <StatCard
              label="Calibration due"
              value={summary.calibrationDue}
              hint={`${summary.calibrationSoon} due soon`}
              accent={summary.calibrationDue > 0 ? "orange" : "muted"}
            />
            <StatCard
              label="Warranty expiring"
              value={summary.warrantyExpiringSoon}
              hint={`within ${WARRANTY_SOON_DAYS} days`}
              accent={summary.warrantyExpiringSoon > 0 ? "gold" : "muted"}
            />
            <StatCard label="Mapped to register" value={summary.mappedToRegister} accent="gold" />
          </div>
        </Section>

        {/* Needs attention — only when there is something actionable */}
        {attention.length > 0 && (
          <Section
            title="Needs attention"
            description="Calibration due or warranty expiring soon"
          >
            <Card accent="orange" padding="sm">
              <ul className="divide-y divide-[var(--admin-border)]">
                {attention.map((a) => {
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                      <Link
                        href={`/admin/equipment/${a.id}`}
                        className="text-sm font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                      >
                        {a.name}
                      </Link>
                      <span className="text-xs text-[var(--admin-text-faint)]">
                        {EQUIPMENT_CATEGORY_LABELS[a.category]}
                      </span>
                      <span className="grow" />
                      {a.requires_calibration && a.calibration_due && (
                        <Badge tone="danger">calibration due {a.next_calibration_due}</Badge>
                      )}
                      {a.requires_calibration && a.calibration_soon && (
                        <Badge tone="orange">calibration soon {a.next_calibration_due}</Badge>
                      )}
                      {warrantyExpiringSoon(a) && (
                        <Badge tone="gold">warranty ends {a.warranty_expires}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </Section>
        )}

        {/* Integrated hardware — rendered FROM the registry (migration 0061),
            never a hardcoded list. Each device links to the page it drives. */}
        <Section
          title="Integrated hardware"
          description="Devices wired into back-office workflows"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {integrated.map((d) => {
              const online = d.kind === "receipt_printer" ? printerOnline : null;
              return (
                <Card key={d.assetTag} padding="sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden>
                        {d.icon}
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-[var(--admin-text)]">
                          {d.manufacturer} {d.model}
                        </div>
                        <div className="text-xs text-[var(--admin-text-faint)]">{d.roleLabel}</div>
                      </div>
                    </div>
                    {online === null ? (
                      d.asset ? (
                        <Badge tone={statusTone(d.asset.status)}>{d.asset.status}</Badge>
                      ) : (
                        <Badge tone="outline">catalog</Badge>
                      )
                    ) : online ? (
                      <Badge tone="green">online</Badge>
                    ) : (
                      <Badge tone="neutral">offline</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{d.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Link
                      href={d.href}
                      className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                    >
                      {d.hrefLabel} →
                    </Link>
                    {d.asset && (
                      <Link
                        href={`/admin/equipment/${d.asset.id}`}
                        className="text-xs text-[var(--admin-text-faint)] hover:text-[var(--admin-accent)] hover:underline"
                      >
                        Registry record
                      </Link>
                    )}
                    {!d.asset && (
                      <span className="text-xs text-[var(--admin-text-faint)]">
                        Not yet in registry ({d.assetTag})
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>

        {/* All assets — filterable, grouped by category */}
        <Section
          title="All assets"
          description="The complete hardware registry"
          action={
            <form className="flex flex-wrap items-end gap-2" method="get">
              <Field label="Search" className="min-w-[180px]">
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
              {hasFilters && (
                <Button href="/admin/equipment" variant="neutral" size="sm">
                  Clear
                </Button>
              )}
            </form>
          }
        >
          {assets.length === 0 ? (
            <EmptyState
              title={hasFilters ? "No matching assets" : "No equipment yet"}
              description={
                hasFilters
                  ? "Try clearing the filters, or add a new asset below."
                  : "Add your first asset using the form below."
              }
            />
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.category}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
                      {EQUIPMENT_CATEGORY_LABELS[group.category]}
                    </h3>
                    <Badge tone="outline">{group.rows.length}</Badge>
                  </div>
                  <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                        <tr>
                          <th className="px-4 py-3">Asset</th>
                          <th className="px-4 py-3">Register</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Calibration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--admin-border)]">
                        {group.rows.map((a) => (
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
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Add asset — collapsed by default to declutter; opens on demand or
            when the header action anchors here. */}
        <Section title="Add an asset">
          <Card>
            <details id="add-asset" className="group">
              <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-[var(--admin-text)]">
                <span>New asset details</span>
                <span className="text-xs text-[var(--admin-text-faint)] group-open:hidden">
                  Click to expand
                </span>
              </summary>
              <form action={createEquipmentAssetAction} className="mt-4 space-y-4">
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
            </details>
          </Card>
        </Section>
      </div>
    </div>
  );
}
