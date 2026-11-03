/**
 * src/components/admin/registers/CountTableReadOnly.tsx  (owner D154, 2026-11-03)
 *
 * "The Second counter should have an option to see the numbers they input
 * after submitting their count. I want to be able to see the table with the
 * numbers in it again. Read only."
 *
 * The same denominations, in the same order, as the CountGrid they typed into
 * ($100 down to 1¢), shown as plain text: quantity × value = subtotal, and the
 * total. A SERVER component with no inputs, no form and no buttons, so nothing
 * on it can be changed. A wrong count is fixed the existing way (a manager
 * reconciles on the chosen count, D126), never by editing this table.
 */
import { formatCents } from "@/lib/registers/cash";
import { countTableRows } from "@/lib/registers/drawer-close-slip-core";
import type { DenomCounts } from "@/lib/registers/cash";

export function CountTableReadOnly({
  counts,
  totalLabel = "Second count total",
  caption,
}: {
  counts: Partial<DenomCounts> | null;
  totalLabel?: string;
  caption?: string | null;
}) {
  const table = countTableRows(counts);
  return (
    <div data-testid="count-table-readonly" aria-readonly="true" className="space-y-1">
      {caption ? <p className="text-xs text-[var(--admin-text-muted)]">{caption}</p> : null}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--admin-text-muted)]">
            <th className="py-1 font-semibold">Bill / coin</th>
            <th className="py-1 text-right font-semibold">Quantity</th>
            <th className="py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr
              key={r.key}
              className={
                r.qty > 0
                  ? "border-t border-[var(--admin-border)] text-[var(--admin-text)]"
                  : "border-t border-[var(--admin-border)] text-[var(--admin-text-faint,var(--admin-text-muted))] opacity-60"
              }
            >
              <td className="py-1">{r.label}</td>
              <td className="py-1 text-right tabular-nums">{r.qty}</td>
              <td className="py-1 text-right tabular-nums">{formatCents(r.subtotalMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--admin-border)] font-semibold text-[var(--admin-text)]">
            <td className="py-1" colSpan={2}>
              {totalLabel}
            </td>
            <td className="py-1 text-right tabular-nums">{formatCents(table.totalMinor)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-[0.7rem] text-[var(--admin-text-muted)]">Read only. These are the numbers that were saved.</p>
    </div>
  );
}
