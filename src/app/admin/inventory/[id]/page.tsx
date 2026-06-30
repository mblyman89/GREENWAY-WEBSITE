import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Field, Input, Textarea, Select, Button } from "@/components/admin/ui";
import {
  getLotById,
  listLotAdjustments,
  getManifestById,
} from "@/lib/inventory/store";
import { adjustLotAction, setLotStatusAction } from "../actions";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number | null): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

function fmtQty(qty: number, unit: string): string {
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

const REASONS = [
  { value: "receive", label: "Receive (add)" },
  { value: "shrink", label: "Shrink" },
  { value: "damage", label: "Damage" },
  { value: "sample", label: "Sample" },
  { value: "destruction", label: "Destruction" },
  { value: "count", label: "Cycle-count correction" },
  { value: "recall", label: "Recall removal" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "quarantine", label: "Quarantine" },
  { value: "recalled", label: "Recalled" },
  { value: "sold_out", label: "Sold out" },
  { value: "destroyed", label: "Destroyed" },
];

export default async function LotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { saved, error } = await searchParams;

  const lot = await getLotById(id);
  if (!lot) notFound();

  const [adjustments, manifest] = await Promise.all([
    listLotAdjustments(id),
    lot.manifest_id ? getManifestById(lot.manifest_id) : Promise.resolve(null),
  ]);

  const adjustAction = adjustLotAction.bind(null, id);
  const statusAction = setLotStatusAction.bind(null, id);

  const today = new Date().toISOString().slice(0, 10);
  const expired = lot.expires_on != null && lot.expires_on < today;

  return (
    <div>
      <AdminPageHeader
        title={lot.product_name ?? "Inventory lot"}
        subtitle={`Lot ${lot.lot_code ?? "(no code)"} · ${lot.vendor_name ?? "unknown vendor"}`}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: lot.lot_code ?? lot.product_name ?? "Lot" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Saved.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {error === "qty"
              ? "Enter a non-zero quantity."
              : error === "reason"
                ? "Choose a valid reason."
                : error === "status"
                  ? "Choose a valid status."
                  : "Something went wrong saving that."}
          </div>
        )}

        {/* KPI band */}
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="On hand" value={fmtQty(lot.on_hand_qty, lot.unit)} accent="green" />
          <StatCard label="Received" value={fmtQty(lot.received_qty, lot.unit)} accent="muted" />
          <StatCard label="Unit cost" value={fmtMoney(lot.unit_cost_minor_units)} accent="gold" />
          <StatCard
            label="Status"
            value={lot.status.replace("_", " ")}
            accent={
              lot.status === "recalled"
                ? "orange"
                : lot.status === "active"
                  ? "green"
                  : "muted"
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Lot facts */}
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Lot details</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Vendor" value={lot.vendor_name ?? "—"} />
              <Row label="Brand" value={lot.brand_name ?? "—"} />
              <Row label="POS product key" value={lot.pos_product_key ?? "— (not linked)"} />
              <Row
                label="Expires"
                value={
                  lot.expires_on
                    ? expired
                      ? `${lot.expires_on} (EXPIRED)`
                      : lot.expires_on
                    : "—"
                }
                danger={expired}
              />
              <Row label="Manifest" value={manifest?.manifest_number ?? lot.manifest_id ?? "—"} />
              {lot.notes && <Row label="Notes" value={lot.notes} />}
            </dl>
          </div>

          {/* COA panel */}
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">
              COA / lab result
            </h2>
            {lot.lab ? (
              <dl className="space-y-2 text-sm">
                <Row
                  label="Lab test ID"
                  value={lot.lab.labtest_external_identifier ?? "—"}
                />
                <Row label="Lab" value={lot.lab.lab_name ?? "—"} />
                <Row label="Tested" value={lot.lab.tested_on ?? "—"} />
                <Row
                  label="THC"
                  value={lot.lab.total_thc_pct != null ? `${lot.lab.total_thc_pct}%` : lot.lab.thc_pct != null ? `${lot.lab.thc_pct}%` : "—"}
                />
                <Row
                  label="CBD"
                  value={lot.lab.total_cbd_pct != null ? `${lot.lab.total_cbd_pct}%` : lot.lab.cbd_pct != null ? `${lot.lab.cbd_pct}%` : "—"}
                />
                <Row
                  label="Result"
                  value={lot.lab.passed == null ? "—" : lot.lab.passed ? "PASS" : "FAIL"}
                  danger={lot.lab.passed === false}
                />
              </dl>
            ) : (
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-3 py-3 text-sm text-[var(--admin-orange)]">
                No COA linked to this lot. WA CCRS manifest reporting requires the COA&apos;s
                LabtestexternalIdentifier — link or import the lab result before selling.
              </div>
            )}
          </div>
        </div>

        {/* Adjustment + status controls */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Adjust quantity</h2>
            <form action={adjustAction} className="space-y-4">
              <Field label="Quantity change" help="Use a negative number to remove stock." htmlFor="qty_delta" required>
                <Input id="qty_delta" name="qty_delta" type="number" step="any" placeholder="-1" />
              </Field>
              <Field label="Reason" htmlFor="reason" required>
                <Select id="reason" name="reason" defaultValue="shrink">
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" htmlFor="note">
                <Textarea id="note" name="note" rows={2} placeholder="Optional detail for the audit trail…" />
              </Field>
              <Button type="submit" variant="save" size="sm">
                Record adjustment
              </Button>
            </form>
          </div>

          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Lifecycle status</h2>
            <form action={statusAction} className="space-y-4">
              <Field label="Set status" help="Recalled / destroyed lots are excluded from sale." htmlFor="status">
                <Select id="status" name="status" defaultValue={lot.status}>
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="subtle" size="sm">
                Update status
              </Button>
            </form>
          </div>
        </div>

        {/* Adjustment history */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Adjustment history</h2>
          {adjustments.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">No adjustments recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {adjustments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2"
                >
                  <span className="text-[var(--admin-text-muted)]">
                    <span
                      className={`font-semibold ${a.qty_delta >= 0 ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}
                    >
                      {a.qty_delta >= 0 ? "+" : ""}
                      {a.qty_delta}
                    </span>{" "}
                    · {a.reason}
                    {a.note && <span className="text-[var(--admin-text-faint)]"> — {a.note}</span>}
                  </span>
                  <span className="text-xs text-[var(--admin-text-faint)]">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--admin-text-faint)]">{label}</dt>
      <dd className={`text-right ${danger ? "font-semibold text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`}>
        {value}
      </dd>
    </div>
  );
}
