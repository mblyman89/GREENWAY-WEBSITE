/**
 * Shared chart theme — brand tokens so every chart looks like Greenway and the
 * app never imports recharts colors directly. Used by the chart wrappers.
 */
export const CHART_COLORS = {
  green: "#7ed957",
  darkGreen: "#12351f",
  gold: "#ffd700",
  orange: "#ff7f00",
  charcoal: "#1a1a1a",
  fg: "#ffffff",
  muted: "rgba(255,255,255,0.55)",
  grid: "rgba(255,255,255,0.08)",
} as const;

/** Default categorical palette (cycled for multi-series / pie slices). */
export const CHART_PALETTE = [
  CHART_COLORS.green,
  CHART_COLORS.gold,
  CHART_COLORS.orange,
  "#4fa3ff",
  "#b07cff",
  "#ff6b9d",
] as const;

/** Shared axis + tooltip styling. */
export const AXIS_TICK = { fill: CHART_COLORS.muted, fontSize: 12 };

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#0a0a0a",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    color: "#fff",
    fontSize: 12,
  },
  labelStyle: { color: "rgba(255,255,255,0.6)" },
  itemStyle: { color: "#fff" },
  cursor: { fill: "rgba(255,255,255,0.04)" },
} as const;

export function paletteAt(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}
