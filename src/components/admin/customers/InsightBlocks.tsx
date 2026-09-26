/**
 * src/components/admin/customers/InsightBlocks.tsx  (Slice 3)
 *
 * Small, server-rendered building blocks shared by the customer profile and
 * the customer intelligence dashboard. Presentation only — every number is
 * computed by the pure cores (customer-insights-core / customer-segments-core).
 */
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/admin/ui";
import { money, type Ranked, type Insight } from "@/lib/customers/customer-insights-core";

export function pct(share: number | null | undefined, digits = 0): string {
  if (share == null || !Number.isFinite(share)) return "—";
  return `${(share * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysAgoText(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function Panel({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--admin-text)]">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Banner({ tone, children }: { tone: "good" | "warn" | "risk" | "info"; children: ReactNode }) {
  const cls =
    tone === "good"
      ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
      : tone === "warn"
        ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
        : tone === "risk"
          ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
          : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]";
  return <div className={`rounded-[var(--admin-radius)] border px-4 py-2 text-sm ${cls}`}>{children}</div>;
}

const INSIGHT_TONE: Record<Insight["tone"], BadgeTone> = { good: "green", warn: "gold", risk: "danger", info: "neutral" };
const INSIGHT_WORD: Record<Insight["tone"], string> = { good: "Good", warn: "Watch", risk: "Risk", info: "Note" };

export function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return <p className="text-sm text-[var(--admin-text-faint)]">Nothing notable yet.</p>;
  return (
    <ul className="space-y-2">
      {insights.map((i, n) => (
        <li key={n} className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
          <Badge tone={INSIGHT_TONE[i.tone]} className="mt-0.5 shrink-0">
            {INSIGHT_WORD[i.tone]}
          </Badge>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A ranked "favourites" list with a share bar. */
export function RankedList({ rows, empty }: { rows: Ranked[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--admin-text-faint)]">{empty}</p>;
  return (
    <ol className="space-y-2">
      {rows.map((r, n) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-[var(--admin-text)]">
              <span className="mr-1.5 text-[var(--admin-text-faint)]">{n + 1}.</span>
              {r.label}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--admin-text-muted)]">
              {money(r.spendMinor)} · {pct(r.spendShare)}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
            <div className="h-full rounded-full bg-[var(--admin-accent)]" style={{ width: `${Math.max(2, Math.min(100, r.spendShare * 100))}%` }} />
          </div>
          <p className="mt-0.5 text-[0.7rem] text-[var(--admin-text-faint)]">
            {r.units} unit{r.units === 1 ? "" : "s"} over {r.visits} visit{r.visits === 1 ? "" : "s"}
          </p>
        </li>
      ))}
    </ol>
  );
}

const STOCK_TONE: Record<string, BadgeTone> = { "in-stock": "green", "low-stock": "gold", unavailable: "danger", "not-on-menu": "neutral" };
const STOCK_WORD: Record<string, string> = { "in-stock": "In stock", "low-stock": "Low stock", unavailable: "Sold out", "not-on-menu": "Not on menu" };

export function StockBadge({ status }: { status: string }) {
  return <Badge tone={STOCK_TONE[status] ?? "neutral"}>{STOCK_WORD[status] ?? status}</Badge>;
}

export function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-[var(--admin-radius)] bg-[var(--admin-surface-2)] px-3 py-2">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[var(--admin-text)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[0.7rem] text-[var(--admin-text-faint)]">{hint}</p> : null}
    </div>
  );
}

export const TABLE = "w-full text-left text-sm";
export const TH = "px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";
export const TD = "px-3 py-2 text-[var(--admin-text)]";
