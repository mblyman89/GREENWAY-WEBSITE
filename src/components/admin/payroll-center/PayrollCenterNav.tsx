import Link from "next/link";

/**
 * D248 - the payroll command center's own tab strip. Server component; the
 * current tab is passed in. Owner-only tabs are listed only when `isOwner`.
 */
export type PayrollCenterTab = "hub" | "schedule";

const TABS: { key: PayrollCenterTab; label: string; href: string }[] = [
  { key: "hub", label: "Command center", href: "/admin/payroll-center" },
  { key: "schedule", label: "Pay schedule & calendar", href: "/admin/payroll-center/schedule" },
];

export function PayrollCenterNav({ current }: { current: PayrollCenterTab }) {
  return (
    <nav aria-label="Payroll command center" className="flex flex-wrap gap-2" data-testid="payroll-center-nav">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            t.key === current
              ? "bg-[var(--admin-accent)] text-black"
              : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** The standing promise, shown on every command-center screen. */
export function CalculateOnlyBanner() {
  return (
    <div
      data-testid="calculate-only-banner"
      className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-xs text-[var(--admin-gold)]"
    >
      Calculate and compare only. Nothing in the payroll command center books a journal, files a form or pays
      anyone. Sage stays your payroll of record; these numbers are for checking it.
    </div>
  );
}
