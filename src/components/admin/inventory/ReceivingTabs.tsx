/**
 * src/components/admin/inventory/ReceivingTabs.tsx
 *
 * Slice H15d — the two-tab switcher for the Receiving page:
 * "Incoming (email)" (the hero, default) vs "Manual tools" (the drawer with
 * the four import forms + KB backfill).
 *
 * Unlike ReportTabs (route-per-tab via usePathname), Receiving is a single
 * route, so tabs are plain `?tab=` links and the ACTIVE tab is resolved on
 * the server (resolveReceivingTab) and passed down as a prop. That keeps
 * this a zero-JS server component and lets the server auto-select the
 * Manual tab when a manual-form error redirect lands.
 */

import Link from "next/link";
import { RECEIVING_TABS, type ReceivingTab } from "@/lib/inventory/receiving-tabs-core";

export function ReceivingTabs({ active }: { active: ReceivingTab }) {
  return (
    <nav
      aria-label="Receiving views"
      className="flex flex-wrap gap-1.5 border-b border-[var(--admin-border)] pb-3"
    >
      {RECEIVING_TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            title={tab.blurb}
            className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              isActive
                ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
