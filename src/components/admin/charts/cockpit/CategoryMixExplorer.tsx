"use client";

/**
 * D210e: categories and the types inside them.
 *
 *   Left   a two-ring sunburst: categories on the inner ring, each
 *          category's types on the outer ring in the same hue. Click a
 *          category (either ring or the list) to drill in.
 *   Right  the selected category's types as a pie (share of the category)
 *          with today vs the basis per type; with nothing selected, every
 *          category's revenue today vs the basis plus the share shift in
 *          percentage points.
 *
 * Everything is computed server-side by categoryMixVsBaseline (pure).
 */
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoryMixRow } from "@/lib/admin/cockpit-analytics-core";
import { BASIS_FILL, CHART_COLORS, SMALL_TICK, TOOLTIP_STYLE, compactMoney, money, paletteAt } from "./shared";

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}

/** Same hue, lighter for each further type. */
function shade(hex: string, i: number): string {
  const a = Math.max(0.35, 0.95 - i * 0.12);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function CategoryMixExplorer({
  categories,
  basisLabel,
  hasBaseline,
  todayTotalMinor,
}: {
  categories: CategoryMixRow[];
  basisLabel: string;
  hasBaseline: boolean;
  todayTotalMinor: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const sold = categories.filter((c) => c.todayMinor > 0);
  const colorOf = useMemo(() => new Map(categories.map((c, i) => [c.category, paletteAt(i)])), [categories]);
  const inner = sold.map((c) => ({ name: c.category, value: c.todayMinor, fill: colorOf.get(c.category)! }));
  const outer = sold.flatMap((c) =>
    c.types
      .filter((t) => t.todayMinor > 0)
      .map((t, i) => ({ name: `${c.category} \u203a ${t.type}`, category: c.category, value: t.todayMinor, fill: shade(colorOf.get(c.category)!, i) })),
  );
  const sel = selected ? categories.find((c) => c.category === selected) ?? null : null;

  if (categories.length === 0) {
    return <p className="py-10 text-center text-sm text-[var(--admin-text-faint)]">The category mix will chart here once something sells today.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="relative h-64" role="img" aria-label="Revenue by category and type today">
          {sold.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={inner}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="34%"
                  outerRadius="62%"
                  paddingAngle={1}
                  stroke={CHART_COLORS.charcoal}
                  isAnimationActive={false}
                  onClick={(_d, i: number) => {
                    const name = inner[i]?.name ?? null;
                    setSelected((s) => (s === name ? null : name));
                  }}
                >
                  {inner.map((d) => (
                    <Cell key={d.name} fill={d.fill} opacity={selected && selected !== d.name ? 0.3 : 1} cursor="pointer" />
                  ))}
                </Pie>
                <Pie
                  data={outer}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="66%"
                  outerRadius="88%"
                  paddingAngle={0.5}
                  stroke={CHART_COLORS.charcoal}
                  isAnimationActive={false}
                  onClick={(_d, i: number) => {
                    const cat = outer[i]?.category ?? null;
                    setSelected((s) => (s === cat ? null : cat));
                  }}
                >
                  {outer.map((d) => (
                    <Cell key={d.name} fill={d.fill} opacity={selected && selected !== d.category ? 0.25 : 1} cursor="pointer" />
                  ))}
                </Pie>
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(v) => {
                    const n = typeof v === "number" ? v : 0;
                    return [`${money(n)} \u00b7 ${todayTotalMinor > 0 ? pct(n / todayTotalMinor) : "0%"} of today`, ""];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-[var(--admin-text-faint)]">Nothing sold yet today.</p>
          )}
          {sold.length > 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase tracking-wider text-[var(--admin-text-faint)]">{sel ? sel.category : "Today"}</span>
              <span className="text-sm font-bold text-[var(--admin-text)]">{money(sel ? sel.todayMinor : todayTotalMinor)}</span>
            </div>
          ) : null}
        </div>
        <ul className="mt-3 space-y-1">
          {categories.map((c) => (
            <li key={c.category}>
              <button
                type="button"
                onClick={() => setSelected((s) => (s === c.category ? null : c.category))}
                aria-pressed={selected === c.category}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition hover:bg-[var(--admin-surface-2)] ${
                  selected === c.category ? "bg-[var(--admin-surface-2)]" : ""
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf.get(c.category) }} />
                <span className="min-w-0 flex-1 truncate text-[var(--admin-text)]">{c.category}</span>
                <span className="tabular-nums text-[var(--admin-text-muted)]">{pct(c.todayShare)}</span>
                {c.shareDeltaPts !== null ? (
                  <span
                    className={`w-14 text-right tabular-nums ${
                      c.shareDeltaPts > 0.05 ? "text-[var(--admin-accent)]" : c.shareDeltaPts < -0.05 ? "text-orange-400" : "text-[var(--admin-text-faint)]"
                    }`}
                    title={`Share of revenue vs ${basisLabel.replace(/^vs /, "")}, in percentage points`}
                  >
                    {c.shareDeltaPts > 0 ? "+" : ""}
                    {c.shareDeltaPts.toFixed(1)} pt
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lg:col-span-3">
        {sel ? (
          <TypeDrill row={sel} color={colorOf.get(sel.category)!} basisLabel={basisLabel} hasBaseline={hasBaseline} onBack={() => setSelected(null)} />
        ) : (
          <CategoryVsBasis categories={categories} basisLabel={basisLabel} hasBaseline={hasBaseline} />
        )}
      </div>
    </div>
  );
}

function CategoryVsBasis({ categories, basisLabel, hasBaseline }: { categories: CategoryMixRow[]; basisLabel: string; hasBaseline: boolean }) {
  const data = categories.slice(0, 10).map((c) => ({ name: c.category, today: c.todayMinor, basis: c.baselineMinor, delta: c.revenueDeltaPct }));
  return (
    <div>
      <p className="mb-2 text-xs text-[var(--admin-text-faint)]">
        Revenue by category, today{hasBaseline ? ` against ${basisLabel.replace(/^vs /, "")}` : ""}. Pick a category to see its types.
      </p>
      <div style={{ height: Math.max(200, data.length * 30 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }} barGap={1}>
            <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
            <XAxis type="number" tick={SMALL_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => compactMoney(v)} />
            <YAxis type="category" dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} width={96} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v, name, item) => {
                const d = (item?.payload as { delta?: number | null } | undefined)?.delta;
                if (name === "Today" && d != null) return [`${money(typeof v === "number" ? v : null)} (${d > 0 ? "+" : ""}${d}%)`, name];
                return [money(typeof v === "number" ? v : null), String(name)];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }} />
            {hasBaseline ? <Bar dataKey="basis" name={basisLabel.replace(/^vs /, "Basis: ")} fill={BASIS_FILL} radius={[0, 3, 3, 0]} isAnimationActive={false} /> : null}
            <Bar dataKey="today" name="Today" fill={CHART_COLORS.green} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TypeDrill({
  row,
  color,
  basisLabel,
  hasBaseline,
  onBack,
}: {
  row: CategoryMixRow;
  color: string;
  basisLabel: string;
  hasBaseline: boolean;
  onBack: () => void;
}) {
  const pie = row.types.filter((t) => t.todayMinor > 0).map((t, i) => ({ name: t.type, value: t.todayMinor, fill: shade(color, i) }));
  const bars = row.types.slice(0, 10).map((t) => ({ name: t.type, today: t.todayMinor, basis: t.baselineMinor, units: t.todayUnits }));
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} className="rounded bg-[var(--admin-surface-2)] px-2 py-0.5 text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]">
          {"\u2190 All categories"}
        </button>
        <span className="text-sm font-semibold text-[var(--admin-text)]">{row.category}</span>
        <span className="text-xs text-[var(--admin-text-faint)]">
          {`${money(row.todayMinor)} \u00b7 ${row.todayUnits} units`}
          {row.revenueDeltaPct !== null ? ` \u00b7 ${row.revenueDeltaPct > 0 ? "+" : ""}${row.revenueDeltaPct}% ${basisLabel}` : ""}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-56" role="img" aria-label={`Types within ${row.category}`}>
          {pie.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" outerRadius="85%" paddingAngle={1} stroke={CHART_COLORS.charcoal} isAnimationActive={false}>
                  {pie.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(v, n) => {
                    const x = typeof v === "number" ? v : 0;
                    return [`${money(x)} \u00b7 ${row.todayMinor > 0 ? pct(x / row.todayMinor) : "0%"} of ${row.category}`, String(n)];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-xs text-[var(--admin-text-faint)]">No {row.category} sold yet today.</p>
          )}
        </div>
        <div style={{ height: Math.max(224, bars.length * 28 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 4 }} barGap={1}>
              <XAxis type="number" tick={SMALL_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => compactMoney(v)} />
              <YAxis type="category" dataKey="name" tick={SMALL_TICK} axisLine={false} tickLine={false} width={84} />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(v, name, item) => {
                  const u = (item?.payload as { units?: number } | undefined)?.units;
                  if (name === "Today") return [`${money(typeof v === "number" ? v : null)} \u00b7 ${u ?? 0} units`, name];
                  return [money(typeof v === "number" ? v : null), String(name)];
                }}
              />
              {hasBaseline ? <Bar dataKey="basis" name="Basis" fill={BASIS_FILL} radius={[0, 3, 3, 0]} isAnimationActive={false} /> : null}
              <Bar dataKey="today" name="Today" fill={color} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
