import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import type { EmployeeAchCard as Card } from "@/lib/payroll/employee-ach-card-core";
import type { EmployeeAuthHistoryRow } from "@/lib/payroll/employee-deposit-plans-store";

/**
 * R39 S4 — the employee file's direct-deposit card (owner/admin only).
 * Masked tails only. Editing happens in the vault, never here.
 * Revoked / archived authorizations sit behind a button (owner Q11).
 */
export function EmployeeAchCard({
  employeeId,
  card,
  history,
  showHistory,
  readError,
}: {
  employeeId: string;
  card: Card | null;
  history: EmployeeAuthHistoryRow[];
  showHistory: boolean;
  readError: string | null;
}) {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">Direct deposit (ACH)</h2>
          {card ? <Badge tone={card.tone}>{card.label}</Badge> : <Badge tone="orange">Could not load</Badge>}
        </div>
        <Link href="/admin/settings/banking?tab=employees" className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">
          Open in the vault →
        </Link>
      </div>

      {readError ? (
        <p role="alert" className="mt-2 text-xs text-[var(--admin-orange)]">
          The ACH authorization read failed, so this card can&apos;t say whether payroll will pay this person: {readError}
        </p>
      ) : null}

      {card ? (
        <>
          <p className="mt-2 text-xs text-white/60">{card.detail}</p>
          {card.needsSignedForm ? (
            <p className="mt-2 rounded-md border border-[var(--admin-gold,#d4a017)]/40 bg-black/20 px-2 py-1 text-xs text-white/80">
              Every employee signs an ACH authorization form. It goes in this file and in the vault.
            </p>
          ) : null}
          {card.accounts.length > 0 ? (
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-white/40">
                <tr>
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">Account</th>
                  <th className="py-1 pr-2 font-medium">Gets</th>
                  <th className="py-1 pr-2 font-medium">Verified</th>
                  <th className="py-1 font-medium">On $1,000</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {card.accounts.map((a) => (
                  <tr key={`${a.priority}-${a.where}`} className="border-t border-white/5">
                    <td className="py-1 pr-2">{a.priority}</td>
                    <td className="py-1 pr-2 font-mono">{a.where}</td>
                    <td className="py-1 pr-2">{a.rule}</td>
                    <td className="py-1 pr-2">{a.verified ? "Yes" : <span className="text-[var(--admin-orange)]">No</span>}</td>
                    <td className="py-1">{a.sampleCents === null ? "—" : money(a.sampleCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {card.historyCount > 0 ? (
            <div className="mt-3 border-t border-white/10 pt-2">
              <Link
                href={`/admin/staffing/employees/${employeeId}${showHistory ? "" : "?ach=history"}`}
                className="text-xs font-semibold text-white/60 hover:underline"
              >
                {showHistory ? "Hide" : "Show"} past authorizations ({card.historyCount})
              </Link>
              {showHistory ? (
                <ul className="mt-2 space-y-1 text-xs text-white/50">
                  {history.map((h) => (
                    <li key={h.id}>
                      {h.state === "revoked" ? "Revoked" : "Archived"}
                      {h.ended_on ? ` ${h.ended_on}` : ""}
                      {h.signed_on ? ` · signed ${h.signed_on}` : ""}
                      {h.signature_method ? ` (${h.signature_method === "esign" ? "e-signed" : "paper"})` : ""}
                      {h.ended_reason ? ` · ${h.ended_reason}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
