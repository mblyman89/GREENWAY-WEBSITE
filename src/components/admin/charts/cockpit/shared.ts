/**
 * D209 cockpit charts: shared styling + formatters (client-safe, no React).
 * Money arrives in CENTS and is formatted here; nothing converts to floats
 * for storage. Colours come from the one chart theme.
 */
import { CHART_COLORS } from "../theme";

export { AXIS_TICK, TOOLTIP_STYLE, CHART_COLORS, paletteAt } from "../theme";
export { compactMoney } from "@/lib/admin/cockpit-analytics-core";

/** $1,234.56 from cents (same rule as the cockpit's formatMoneyMinor). */
export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "\u2014";
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  return `${neg ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export const SMALL_TICK = { fill: CHART_COLORS.muted, fontSize: 11 };
export const BASIS_FILL = "rgba(255,255,255,0.22)";
export const BLUE = "#4fa3ff";
export const VIOLET = "#b07cff";
