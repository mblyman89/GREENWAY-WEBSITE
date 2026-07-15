"use client";

/**
 * CashRoundingEditor (POS Slice B33) — the owner picks the penny-elimination
 * policy the way Square and Toast expose it: one mode, with a live example
 * table showing exactly how each price ending lands. The register applies
 * the policy to the CASH AMOUNT DUE only — tax stays on the pre-rounded
 * total per the WA DOR interim guidance, and every rounded sale prints the
 * adjustment as its own receipt line.
 */
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  CASH_ROUNDING_MODES,
  cashRoundingModeLabel,
  roundCashDue,
  type CashRoundingMode,
  type PosCashRoundingConfig,
} from "@/lib/pos/cash-rounding-core";
import { saveCashRoundingAction } from "@/app/admin/registers/rounding/actions";

const MODE_HELP: Record<CashRoundingMode, string> = {
  off: "Charge exact pennies — no rounding at the drawer.",
  nearest: "Round the cash due to the closest nickel (.01/.02 down, .03/.04 up — the Square default). Gains and losses roughly cancel out.",
  up: "Always round the cash due up to the next nickel. The store never loses pennies; customers pay up to 4¢ more.",
  down: "Always round the cash due down to the previous nickel. Customers never pay more; the store absorbs up to 4¢ per sale.",
};

/** Example totals covering every cent ending class. */
const EXAMPLES = [2921, 2922, 2923, 2924, 2925, 2926, 2927, 2928, 2929, 2930];

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export function CashRoundingEditor({ initial }: { initial: PosCashRoundingConfig }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<CashRoundingMode>(initial.mode);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(
    () =>
      EXAMPLES.map((total) => {
        const r = roundCashDue(total, mode);
        return { total, due: r?.dueMinor ?? total, adj: r?.adjustmentMinor ?? 0 };
      }),
    [mode],
  );

  function save() {
    startTransition(async () => {
      const res = await saveCashRoundingAction({ mode });
      if (res.ok) {
        toast({ tone: "success", message: "Rounding policy saved. Registers pick it up on their next menu refresh." });
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {CASH_ROUNDING_MODES.map((m) => (
          <label
            key={m}
            className={`flex cursor-pointer items-start gap-3 rounded-[var(--admin-radius)] border p-4 ${
              mode === m
                ? "border-[var(--admin-accent)] bg-[var(--admin-surface)]"
                : "border-[var(--admin-border)] bg-[var(--admin-surface)]"
            }`}
          >
            <input
              type="radio"
              name="rounding-mode"
              checked={mode === m}
              onChange={() => setMode(m)}
              className="mt-1 h-4 w-4 accent-[var(--admin-accent)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--admin-text)]">
                {cashRoundingModeLabel(m)}
              </span>
              <span className="block text-xs text-[var(--admin-text-faint)]">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save rounding policy"}
        </Button>
        <p className="text-xs text-[var(--admin-text-faint)]">
          Sales tax is always computed on the pre-rounded total (WA Department of Revenue interim
          guidance) — rounding only changes the cash collected at the drawer. Every rounded sale
          prints the adjustment as its own receipt line, and the X/Z day report shows the day&rsquo;s
          net rounding so drawer counts reconcile to the penny&hellip; er, nickel.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
          Live example — how totals land under this policy
        </p>
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--admin-surface)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Cash due</th>
                <th className="px-3 py-2 text-right">Rounding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.total} className="border-t border-[var(--admin-border)] text-[var(--admin-text)]">
                  <td className="px-3 py-1.5">{money(r.total)}</td>
                  <td className="px-3 py-1.5 font-semibold">{money(r.due)}</td>
                  <td
                    className={`px-3 py-1.5 text-right ${
                      r.adj === 0
                        ? "text-[var(--admin-text-faint)]"
                        : r.adj > 0
                          ? "text-[var(--admin-accent)]"
                          : "text-amber-500"
                    }`}
                  >
                    {r.adj === 0 ? "—" : `${r.adj > 0 ? "+" : "−"}${Math.abs(r.adj)}¢`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
