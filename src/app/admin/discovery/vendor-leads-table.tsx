import { Badge, Button, Select } from "@/components/admin/ui";
import type { DiscoveryVendorLead, DiscoveryVendorStatus, DiscoveryPriority } from "@/lib/discovery/types";
import type { MatchState } from "@/lib/discovery/reconcile";

/**
 * Vendor leads table (server component — inline server-action forms, no client
 * state needed). Shows each candidate vendor, its reconciliation match badge,
 * and inline status/priority controls. "already a vendor" leads are visually
 * de-emphasised so the manager focuses on genuinely NEW prospects.
 */

const V_STATUSES: DiscoveryVendorStatus[] = [
  "new",
  "reviewing",
  "contacted",
  "qualified",
  "onboarded",
  "dismissed",
];
const PRIORITIES: DiscoveryPriority[] = ["high", "med", "low"];

function matchBadge(state: MatchState) {
  if (state === "existing") return <Badge tone="neutral">already a vendor</Badge>;
  if (state === "possible") return <Badge tone="gold">possible match</Badge>;
  return <Badge tone="green">new prospect</Badge>;
}

function statusTone(status: DiscoveryVendorStatus): "neutral" | "green" | "gold" | "orange" | "danger" {
  switch (status) {
    case "qualified":
      return "green";
    case "reviewing":
    case "contacted":
      return "gold";
    case "onboarded":
      return "neutral";
    case "dismissed":
      return "danger";
    default:
      return "orange";
  }
}

export function VendorLeadsTable({
  leads,
  updateAction,
}: {
  leads: DiscoveryVendorLead[];
  updateAction: (formData: FormData) => void | Promise<void>;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-center text-sm text-[var(--admin-text-muted)]">
        No vendor leads yet. Add one below, or import a list on the Import screen.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
            <th className="px-3 py-3">Vendor</th>
            <th className="px-3 py-3">License</th>
            <th className="px-3 py-3">Match</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Priority</th>
            <th className="px-3 py-3 text-right">Update</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--admin-border)]">
          {leads.map((l) => {
            const dim = l.match_state === "existing" || l.status === "dismissed";
            return (
              <tr
                key={l.id}
                className={dim ? "bg-[var(--admin-surface)] opacity-60" : "bg-[var(--admin-surface)]"}
              >
                <td className="px-3 py-3">
                  <div className="font-semibold text-[var(--admin-text)]">{l.display_name}</div>
                  <div className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
                    {[l.legal_name, l.city].filter(Boolean).join(" · ") || "—"}
                    {l.email ? ` · ${l.email}` : ""}
                  </div>
                  {l.note ? (
                    <div className="mt-1 text-xs text-[var(--admin-text-faint)]">{l.note}</div>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-[var(--admin-text-muted)]">{l.license_number || "—"}</td>
                <td className="px-3 py-3">{matchBadge(l.match_state)}</td>
                <td className="px-3 py-3">
                  <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                </td>
                <td className="px-3 py-3">
                  <Badge tone={l.priority === "high" ? "orange" : l.priority === "low" ? "neutral" : "gold"}>
                    {l.priority}
                  </Badge>
                </td>
                <td className="px-3 py-3">
                  <form action={updateAction} className="flex items-center justify-end gap-2">
                    <input type="hidden" name="id" value={l.id} />
                    <Select name="status" defaultValue={l.status} className="w-32">
                      {V_STATUSES.map((s) => (
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
