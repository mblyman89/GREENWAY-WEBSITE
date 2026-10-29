"use client";

import { useState } from "react";
import { DENOM_FIELDS, EMPTY_DENOMS, denomTotalMinor, formatCents, type DenomCounts } from "@/lib/registers/cash";
import { IN_PREFIX, OUT_PREFIX } from "@/lib/registers/little-safe-core";
import { Button } from "@/components/admin/ui";

/**
 * Fix Phase 2.7b (G-02, owner D3): the master till <-> little safe exchange.
 *
 * Owner: "I just want to know when big bills leave the master till and go
 * into the little safe. And what the small bills and coin are that came out of
 * the little safe."
 *
 * Two grids posted as out_<key> and in_<key>. The live line says whether the
 * two sides are equal and the save button stays off until they are. The
 * server checks it again (little-safe-core#validateExchange) and so does the
 * database (0317 little_safe_exchanges_sides_equal). There is no little-safe
 * balance or target (D3), so nothing here shows one.
 */
export function LittleSafeExchangeForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [out, setOut] = useState<DenomCounts>({ ...EMPTY_DENOMS });
  const [inn, setIn] = useState<DenomCounts>({ ...EMPTY_DENOMS });
  const [busy, setBusy] = useState(false);
  const outMinor = denomTotalMinor(out);
  const inMinor = denomTotalMinor(inn);
  const equal = outMinor > 0 && outMinor === inMinor;

  const grid = (
    title: string,
    hint: string,
    prefix: string,
    value: DenomCounts,
    set: (f: (d: DenomCounts) => DenomCounts) => void,
    total: number,
  ) => (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <p className="text-xs font-semibold text-[var(--admin-text)]">{title}</p>
      <p className="text-[0.7rem] text-[var(--admin-text-faint)]">{hint}</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {DENOM_FIELDS.map((d) => (
          <label key={d.key} className="flex flex-col gap-0.5 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-1.5 py-1">
            <span className="text-[0.65rem] font-semibold text-white/60">{d.label}</span>
            <input
              type="text"
              name={`${prefix}${d.key}`}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="0"
              value={value[d.key] === 0 ? "" : String(value[d.key])}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                const n = digits === "" ? 0 : Math.min(99_999, parseInt(digits, 10));
                set((p) => ({ ...p, [d.key]: n }));
              }}
              className="admin-focus w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-1.5 py-1 text-right text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-right text-sm font-semibold tabular-nums text-[var(--admin-text)]">{formatCents(total)}</p>
    </div>
  );

  return (
    <form action={action} onSubmit={() => setBusy(true)} className="mt-3 space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {grid(
          "OUT of master till \u2192 little safe",
          "The big bills you take out of the master till ($20, $50, $100).",
          OUT_PREFIX,
          out,
          setOut,
          outMinor,
        )}
        {grid(
          "IN from little safe \u2192 master till",
          "The small bills and coin you take out of the little safe.",
          IN_PREFIX,
          inn,
          setIn,
          inMinor,
        )}
      </div>
      <p
        role="status"
        className={`rounded-lg px-3 py-2 text-sm ${
          equal ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-surface)] text-[var(--admin-text-muted)]"
        }`}
      >
        {outMinor === 0 && inMinor === 0
          ? "Enter both sides. They must be the same value."
          : equal
            ? `Both sides ${formatCents(outMinor)} \u2014 equal.`
            : `Not equal: OUT ${formatCents(outMinor)}, IN ${formatCents(inMinor)}. Recount until both sides are the same value.`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-[var(--admin-text-muted)]">
          Done by: your PIN (required)
          <input
            name="exchange_pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={4}
            maxLength={6}
            autoComplete="off"
            required
            placeholder="PIN"
            className="admin-focus mt-1 block w-32 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </label>
        <label className="block grow text-xs text-[var(--admin-text-muted)]">
          Notes (optional)
          <input
            name="exchange_notes"
            maxLength={500}
            placeholder="e.g. after PM count; second person initialled form 8.2"
            className="admin-focus mt-1 block w-full rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!equal || busy}>
          {busy ? "Saving\u2026" : "Record exchange"}
        </Button>
      </div>
    </form>
  );
}
