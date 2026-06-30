/**
 * src/components/admin/reports/DateRangePicker.tsx
 *
 * Date-range control for report tabs. Offers quick presets (7/30/90 days, this
 * month, last month) plus an explicit From/To form. It is a small client island
 * that pushes the chosen range into the URL query (?from=YYYY-MM-DD&to=YYYY-MM-DD)
 * so the server component re-renders with the new window.
 */
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  function push(nextFrom: string, nextTo: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("from", nextFrom);
    sp.set("to", nextTo);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function preset(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    push(iso(start), iso(end));
  }

  function thisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    push(iso(start), iso(now));
  }

  function lastMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    push(iso(start), iso(end));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Range:</span>
      {[
        { label: "7d", fn: () => preset(7) },
        { label: "30d", fn: () => preset(30) },
        { label: "90d", fn: () => preset(90) },
        { label: "This month", fn: thisMonth },
        { label: "Last month", fn: lastMonth },
      ].map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={b.fn}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:text-white"
        >
          {b.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-white/15" />
      <input
        type="date"
        value={from}
        onChange={(e) => push(e.target.value, to || e.target.value)}
        className="rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-xs text-white"
        aria-label="From date"
      />
      <span className="text-xs text-white/40">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => push(from || e.target.value, e.target.value)}
        className="rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-xs text-white"
        aria-label="To date"
      />
    </div>
  );
}
