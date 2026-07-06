import { Badge } from "@/components/admin/ui";
import type { SampleCapacity, CapacityTone } from "@/lib/compliance/sample-capacity-core";

/**
 * SampleCapacityGauge — "can we take in any more samples?"
 *
 * Shows DISTRIBUTION capacity (the real gate): how many trade + IQC units we can
 * still place across active employees this quarter, with a traffic-light verdict.
 * Server-component friendly (presentational only). Advisory — receiving isn't
 * unlawful; over-GIVING to an employee is.
 */

const TONE_BADGE: Record<CapacityTone, "green" | "orange" | "danger"> = {
  green: "green",
  amber: "orange",
  red: "danger",
};

const TONE_LABEL: Record<CapacityTone, string> = {
  green: "Room to accept",
  amber: "Accept with care",
  red: "Do not accept",
};

const TONE_BAR: Record<CapacityTone, string> = {
  green: "#7ed957",
  amber: "#f59e0b",
  red: "#ef4444",
};

function lane(label: string, capUsed: number, capacity: number, remaining: number, tone: CapacityTone) {
  const pct = capacity > 0 ? Math.min(100, Math.round((capUsed / capacity) * 100)) : 100;
  return (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold text-white">{label}</span>
        <span className="text-white/60">
          <strong className="text-white">{remaining}</strong> can still be placed
          <span className="text-white/40"> / {capacity} capacity</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TONE_BAR[tone] }} />
      </div>
    </div>
  );
}

export function SampleCapacityGauge({ capacity, citation }: { capacity: SampleCapacity; citation: string }) {
  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Sample capacity — can we take in more?</h3>
          <p className="text-xs text-white/40">
            Based on how many samples you can still GIVE OUT this quarter across {capacity.activeEmployees} active
            employee(s) — not the per-processor intake cap. {citation}.
          </p>
        </div>
        <Badge tone={TONE_BADGE[capacity.tone]}>{TONE_LABEL[capacity.tone]}</Badge>
      </div>

      <div
        className={`mb-4 rounded-lg px-4 py-3 text-sm font-semibold ${
          capacity.tone === "red"
            ? "border border-red-500/50 bg-red-500/10 text-red-300"
            : capacity.tone === "amber"
              ? "border border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#f59e0b]"
              : "border border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]"
        }`}
      >
        {capacity.tone === "red" ? "🚫 " : capacity.tone === "amber" ? "⚠️ " : "✅ "}
        {capacity.headline}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {lane("Trade outbound", capacity.trade.used, capacity.trade.capacity, capacity.trade.remaining, capacity.trade.tone)}
        {lane("IQC outbound", capacity.iqc.used, capacity.iqc.capacity, capacity.iqc.remaining, capacity.iqc.tone)}
        {lane(
          "IQC concentrate",
          capacity.iqcConcentrate.used,
          capacity.iqcConcentrate.capacity,
          capacity.iqcConcentrate.remaining,
          capacity.iqcConcentrate.tone,
        )}
      </div>

      <p className="mt-3 text-xs text-white/40">
        {capacity.daysLeftInQuarter} day(s) left in this quarter. Caps reset each calendar quarter and cannot be banked —
        samples you can&apos;t place before the reset are wasted product.
      </p>
    </section>
  );
}
