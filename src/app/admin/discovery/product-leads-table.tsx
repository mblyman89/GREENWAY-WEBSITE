import { Badge, Button, Select } from "@/components/admin/ui";
import type {
  DiscoveryProductLead,
  DiscoveryProductStatus,
  DiscoveryPriority,
} from "@/lib/discovery/types";
import { LEAD_ARRIVED_LABEL } from "@/lib/discovery/lead-arrival-core";

/**
 * Product leads table (server component). Each row shows the candidate product,
 * its estimated economics, a demand signal, inline status/priority controls,
 * and a "Start PO" action that promotes the lead into the Purchasing pipeline
 * (prefilling /admin/purchasing/new). Drafts-only: nothing is ordered until the
 * manager confirms it on the PO builder.
 */

const P_STATUSES: DiscoveryProductStatus[] = ["new", "reviewing", "shortlisted", "ordered", "dismissed"];
const PRIORITIES: DiscoveryPriority[] = ["high", "med", "low"];

function money(minor: number | null): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

function statusTone(status: DiscoveryProductStatus): "neutral" | "green" | "gold" | "orange" | "danger" {
  switch (status) {
    case "ordered":
      return "green";
    case "shortlisted":
      return "gold";
    case "reviewing":
      return "gold";
    case "dismissed":
      return "danger";
    default:
      return "orange";
  }
}

export function ProductLeadsTable({
  leads,
  updateAction,
  promoteAction,
  arrivedLeadIds,
}: {
  leads: DiscoveryProductLead[];
  updateAction: (formData: FormData) => void | Promise<void>;
  promoteAction: (formData: FormData) => void | Promise<void>;
  /**
   * W14 (G10): ids of ordered leads whose promoted PO has been RECEIVED —
   * surfaced as "Arrived — review outcome" so the loop gets closed by a
   * human (dismiss a dud or keep it) instead of sitting at "ordered" forever.
   */
  arrivedLeadIds?: ReadonlySet<string>;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-[var(--admin-text-muted)]">
        No product leads yet. Add one below, or import a list on the Import screen.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
            <th className="px-3 py-3">Product</th>
            <th className="px-3 py-3">Category</th>
            <th className="px-3 py-3 text-right">Est. cost</th>
            <th className="px-3 py-3 text-right">Est. retail</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--admin-border)]">
          {leads.map((l) => {
            const dim = l.status === "dismissed";
            return (
              <tr key={l.id} className={dim ? "bg-[var(--admin-surface)] opacity-60" : "bg-[var(--admin-surface)]"}>
                <td className="px-3 py-3">
                  <div className="font-semibold text-[var(--admin-text)]">{l.product_name}</div>
                  <div className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
                    {[l.brand, l.pack_size].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {l.demand_signal ? (
                    <div className="mt-1 text-xs text-[var(--admin-accent)]">↑ {l.demand_signal}</div>
                  ) : null}
                  {l.note ? <div className="mt-1 text-xs text-[var(--admin-text-faint)]">{l.note}</div> : null}
                </td>
                <td className="px-3 py-3">
                  {l.category ? <Badge tone="neutral">{l.category}</Badge> : <span className="text-[var(--admin-text-faint)]">—</span>}
                </td>
                <td className="px-3 py-3 text-right text-[var(--admin-text)]">{money(l.est_unit_cost_minor_units)}</td>
                <td className="px-3 py-3 text-right text-[var(--admin-text-muted)]">{money(l.est_retail_minor_units)}</td>
                <td className="px-3 py-3">
                  <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                  {arrivedLeadIds?.has(l.id) ? (
                    <div className="mt-1">
                      <Badge tone="gold">{LEAD_ARRIVED_LABEL}</Badge>
                    </div>
                  ) : null}
                  <div className="mt-1">
                    <Badge tone={l.priority === "high" ? "orange" : l.priority === "low" ? "neutral" : "gold"}>
                      {l.priority}
                    </Badge>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-end gap-2">
                    <form action={updateAction} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <Select name="status" defaultValue={l.status} className="w-32">
                        {P_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                      <Select name="priority" defaultValue={l.priority} className="w-24">
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="neutral" size="sm">
                        Save
                      </Button>
                    </form>
                    {l.status !== "ordered" && l.status !== "dismissed" ? (
                      <form action={promoteAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <Button type="submit" variant="primary" size="sm">
                          Start PO from lead →
                        </Button>
                      </form>
                    ) : l.promoted_po_id ? (
                      <a
                        href={`/admin/purchasing/${l.promoted_po_id}`}
                        className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                      >
                        View PO →
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
