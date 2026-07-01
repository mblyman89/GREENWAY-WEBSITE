import Link from "next/link";
import {
  formatMoneyMinor,
  formatMoneyCompact,
  deltaLabel,
  type AttentionFlag,
} from "@/lib/admin/cockpit-core";
import type { MobileKpi, MobileGlance, MobileShortcut } from "@/lib/admin/mobile-core";

/**
 * MobileHome — phone-first "On the Go" view for the back office.
 *
 * Purely presentational; all data is computed server-side by mobile-core from
 * the verified CockpitSnapshot. Uses the same admin design tokens as the rest
 * of the back office. This is ADDITIVE — the desktop cockpit is untouched.
 */

function deltaColor(d: MobileKpi["delta"]): string {
  if (d.isNew || d.direction === "up") return "text-[var(--admin-accent)]";
  if (d.direction === "down") return "text-[var(--admin-orange)]";
  return "text-[var(--admin-text-faint)]";
}

function KpiTile({ kpi }: { kpi: MobileKpi }) {
  const value = kpi.isMoney
    ? kpi.key === "revenue"
      ? formatMoneyMinor(kpi.valueMinorOrCount)
      : formatMoneyMinor(kpi.valueMinorOrCount)
    : String(kpi.valueMinorOrCount);
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
        {kpi.label}
      </div>
      <div className="mt-1 text-xl font-bold text-[var(--admin-text)]">{value}</div>
      <div className={`mt-0.5 text-[11px] font-semibold ${deltaColor(kpi.delta)}`}>
        {deltaLabel(kpi.delta)}
      </div>
    </div>
  );
}

const SEVERITY_STYLES: Record<AttentionFlag["severity"], string> = {
  critical: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  warning: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  info: "border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text-muted)]",
};

function AttentionRow({ flag }: { flag: AttentionFlag }) {
  const cls = SEVERITY_STYLES[flag.severity];
  const dot = flag.severity === "critical" ? "🔴" : flag.severity === "warning" ? "🟠" : "🔵";
  const body = (
    <div className={`flex items-center gap-2 rounded-[var(--admin-radius)] border px-3 py-2.5 text-sm ${cls}`}>
      <span aria-hidden>{dot}</span>
      <span className="flex-1">{flag.text}</span>
      {flag.href ? <span aria-hidden className="opacity-60">›</span> : null}
    </div>
  );
  return flag.href ? (
    <Link href={flag.href} className="block active:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

function GlanceTile({ glance }: { glance: MobileGlance }) {
  return (
    <Link
      href={glance.href}
      className="flex flex-col justify-between rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 active:opacity-80"
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
        {glance.label}
      </div>
      <div
        className={`mt-1 text-lg font-bold ${
          glance.attention ? "text-[var(--admin-orange)]" : "text-[var(--admin-text)]"
        }`}
      >
        {glance.value}
      </div>
    </Link>
  );
}

function ShortcutTile({ item }: { item: MobileShortcut }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 active:opacity-80"
    >
      <span aria-hidden className="text-xl">{item.icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--admin-text)]">{item.label}</span>
        <span className="block truncate text-[11px] text-[var(--admin-text-faint)]">{item.hint}</span>
      </span>
    </Link>
  );
}

export function MobileHome({
  firstName,
  roleLabel,
  configured,
  kpis,
  attention,
  glances,
  shortcuts,
  lastImportLabel,
}: {
  firstName: string;
  roleLabel: string;
  configured: boolean;
  kpis: MobileKpi[];
  attention: AttentionFlag[];
  glances: MobileGlance[];
  shortcuts: MobileShortcut[];
  lastImportLabel: string | null;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-4">
      {/* Greeting */}
      <header className="mb-4">
        <h1 className="text-lg font-bold text-[var(--admin-text)]">Hi {firstName} 👋</h1>
        <p className="text-xs text-[var(--admin-text-faint)]">
          On the go · {roleLabel}
          {lastImportLabel ? ` · menu updated ${lastImportLabel}` : ""}
        </p>
      </header>

      {!configured ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] p-4 text-sm text-[var(--admin-orange)]">
          Live data isn&apos;t connected yet. Once the store database is configured, your daily
          snapshot appears here.
        </div>
      ) : (
        <>
          {/* Today snapshot */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Today
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {kpis.map((k) => (
                <KpiTile key={k.key} kpi={k} />
              ))}
            </div>
          </section>

          {/* Needs attention */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Needs attention
            </h2>
            {attention.length === 0 ? (
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2.5 text-sm text-[var(--admin-text-muted)]">
                ✅ All clear — nothing needs you right now.
              </div>
            ) : (
              <div className="space-y-2">
                {attention.map((f, i) => (
                  <AttentionRow key={i} flag={f} />
                ))}
              </div>
            )}
          </section>

          {/* Quick glances */}
          <section className="mb-5">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Right now
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {glances.map((g) => (
                <GlanceTile key={g.key} glance={g} />
              ))}
            </div>
          </section>
        </>
      )}

      {/* Shortcuts */}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Quick actions
        </h2>
        <div className="grid grid-cols-1 gap-2">
          {shortcuts.map((s) => (
            <ShortcutTile key={s.href} item={s} />
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-[var(--admin-text-faint)]">
          Need the full back office?{" "}
          <Link href="/admin" className="font-semibold text-[var(--admin-accent)]">
            Open desktop view
          </Link>
        </p>
      </section>
    </div>
  );
}
