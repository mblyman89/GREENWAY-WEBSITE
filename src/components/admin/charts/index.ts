/**
 * Greenway admin chart kit — brand-styled wrappers around Recharts. The app
 * imports ONLY from here (never recharts directly) so all charts share the same
 * colors, axes, tooltips, and empty states.
 *
 *   import { BarChart, LineChart, DonutChart, Sparkline } from "@/components/admin/charts";
 */
export { ChartFrame } from "./ChartFrame";
export { BarChart, type BarSeries } from "./BarChart";
export { LineChart, type LineSeries } from "./LineChart";
export { AreaChart, type AreaSeries } from "./AreaChart";
export { DonutChart, PieChart, type DonutDatum } from "./DonutChart";
export { Sparkline } from "./Sparkline";
export {
  CHART_COLORS,
  CHART_PALETTE,
  paletteAt,
} from "./theme";
