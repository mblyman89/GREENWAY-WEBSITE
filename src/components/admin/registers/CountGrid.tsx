"use client";

import { useState } from "react";
import { DENOM_FIELDS, denomTotalMinor, formatCents, type DenomCounts } from "@/lib/registers/cash";

/**
 * CountGrid — a denomination-count grid with a LIVE running total.
 *
 * Client component: the manager types quantities per denomination and sees the
 * cash total update instantly. Emits one number input per denomination named by
 * its DenomCounts key, so the existing server actions (parseDenoms on FormData)
 * read them straight off the submitted form — no new server contract needed.
 *
 * `expectedMinor` is optional; when provided (e.g. an open drawer's starting
 * float, or the expected close), we show a live variance so the count is never
 * a mystery. For BLIND closes, omit it.
 */
export function CountGrid({
  expectedMinor = null,
  expectedLabel = "Expected",
  totalLabel = "Counted total",
}: {
  expectedMinor?: number | null;
  expectedLabel?: string;
  totalLabel?: string;
}) {
  const [counts, setCounts] = useState<Partial<DenomCounts>>({});

  const total = denomTotalMinor(counts);
  const variance = expectedMinor != null ? total - expectedMinor : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DENOM_FIELDS.map((d) => (
          <label
            key={d.key}
            className="flex flex-col gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5"
          >
            <span className="text-[0.7rem] font-semibold text-white/60">{d.label}</span>
            <input
              // text + numeric inputMode = free typing, NO spinner arrows, and a
              // numeric keypad on tablets (the iPad POS use case).
              type="text"
              name={d.key}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="0"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                // Keep digits only; store the sanitized value back in the field.
                const digits = e.target.value.replace(/[^0-9]/g, "");
                if (digits !== e.target.value) e.target.value = digits;
                const v = digits === "" ? 0 : Math.max(0, parseInt(digits, 10));
                setCounts((prev) => ({ ...prev, [d.key]: v }));
              }}
              className="admin-focus w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-right text-base font-medium text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm">
        <span className="text-[var(--admin-text-muted)]">{totalLabel}</span>
        <span className="font-semibold tabular-nums text-[var(--admin-text)]">
          {formatCents(total)}
        </span>
      </div>

      {expectedMinor != null && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
          <span className="text-[var(--admin-text-faint)]">
            {expectedLabel}: {formatCents(expectedMinor)}
          </span>
          <span
            className={
              variance === 0
                ? "text-[var(--admin-text-muted)]"
                : (variance ?? 0) > 0
                  ? "text-[var(--admin-gold)]"
                  : "text-[var(--admin-danger)]"
            }
          >
            {variance === 0
              ? "Balanced"
              : (variance ?? 0) > 0
                ? `Over by ${formatCents(variance ?? 0)}`
                : `Short by ${formatCents(Math.abs(variance ?? 0))}`}
          </span>
        </div>
      )}
    </div>
  );
}
