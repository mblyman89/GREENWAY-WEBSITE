/**
 * src/components/admin/reports/DateRangePicker.tsx
 *
 * Date-range control for report tabs. Offers quick presets — rolling windows
 * (7/30/90 days), calendar periods (this/last month, this/last quarter, this/
 * last year), and an explicit quarter picker (Q1–Q4 of a chosen year) — plus an
 * explicit From/To form.
 *
 * Named presets push ?range=<key> (and optionally ?year=YYYY) into the URL and
 * are resolved server-side by resolveRange() in Pacific time, so the window is
 * shareable, bookmarkable, and timezone-correct regardless of the browser's
 * local zone. Rolling windows push ?range=<days>. The explicit From/To inputs
 * push ?from=&to=. Switching modes clears the conflicting params.
 */
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

/** Current Pacific calendar year, computed client-side via Intl. */
function pacificYear(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  return Number(y) || new Date().getFullYear();
}

export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const activeRange = params.get("range") ?? "";
  const activeYear = params.get("year") ?? "";
  const hasExplicit = !!from && !!to;

  const thisYear = pacificYear();
  // Year choices for the quarter picker: current year back four years.
  const yearChoices = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4];

  /** Push a named/rolling preset: set ?range (+ ?year), clear ?from/?to. */
  function pushPreset(rangeKey: string, year?: number) {
    const sp = new URLSearchParams(params.toString());
    sp.set("range", rangeKey);
    if (year) sp.set("year", String(year));
    else sp.delete("year");
    sp.delete("from");
    sp.delete("to");
    router.push(`${pathname}?${sp.toString()}`);
  }

  /** Push an explicit window: set ?from/?to, clear ?range/?year. */
  function pushExplicit(nextFrom: string, nextTo: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("from", nextFrom);
    sp.set("to", nextTo);
    sp.delete("range");
    sp.delete("year");
    router.push(`${pathname}?${sp.toString()}`);
  }

  const presets: { label: string; key: string; year?: number }[] = [
    { label: "7d", key: "7" },
    { label: "30d", key: "30" },
    { label: "90d", key: "90" },
    { label: "This month", key: "this_month" },
    { label: "Last month", key: "last_month" },
    { label: "This quarter", key: "this_quarter" },
    { label: "Last quarter", key: "last_quarter" },
    { label: "This year", key: "this_year" },
    { label: "Last year", key: "last_year" },
  ];

  const isActive = (key: string) => !hasExplicit && activeRange === key;

  const quarterValue = (() => {
    if (hasExplicit) return "";
    if (/^q[1-4]$/.test(activeRange)) {
      const y = activeYear || String(thisYear);
      return `${activeRange}:${y}`;
    }
    return "";
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-bold uppercase tracking-[0.1em] text-white/40">Range:</span>
      {presets.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={() => pushPreset(b.key, b.year)}
          aria-pressed={isActive(b.key)}
          className={
            isActive(b.key)
              ? "rounded-full border border-emerald-400/60 bg-emerald-400/15 px-3 py-1.5 text-xs font-bold text-emerald-100"
              : "rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:text-white"
          }
        >
          {b.label}
        </button>
      ))}

      {/* Explicit quarter picker (Q1–Q4 of a chosen year). */}
      <select
        value={quarterValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const [q, y] = v.split(":");
          pushPreset(q, Number(y));
        }}
        aria-label="Pick a specific quarter"
        className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1.5 text-xs font-bold text-white/70"
      >
        <option value="">By quarter…</option>
        {yearChoices.map((y) => (
          <optgroup key={y} label={String(y)}>
            {[1, 2, 3, 4].map((q) => (
              <option key={`${q}-${y}`} value={`q${q}:${y}`}>
                Q{q} {y}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <span className="mx-1 h-4 w-px bg-white/15" />
      <input
        type="date"
        value={from}
        onChange={(e) => pushExplicit(e.target.value, to || e.target.value)}
        className="rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-xs text-white"
        aria-label="From date"
      />
      <span className="text-xs text-white/40">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => pushExplicit(from || e.target.value, e.target.value)}
        className="rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-xs text-white"
        aria-label="To date"
      />
    </div>
  );
}
