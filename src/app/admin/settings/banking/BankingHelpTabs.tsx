import Link from "next/link";

/**
 * R40 - the three helper tabs that sit beside the vault tabs on every banking
 * page: Guide (carry me through it), Calendar (what is due, rule watch) and
 * Legal library (cases, statutes, verbatim). Kept off the main pages on
 * purpose (owner: "Don't clutter the main pages, add tabs").
 */
export const BANKING_HELP_TABS = [
  { key: "guide", href: "/admin/settings/banking/guide", label: "Guide & unblocker" },
  { key: "calendar", href: "/admin/settings/banking/calendar", label: "Calendar & reminders" },
  { key: "library", href: "/admin/settings/banking/library", label: "Legal library" },
  // R41 S9: the last check before a file goes to Timberland (section 18: no cancelling after upload).
  { key: "checker", href: "/admin/settings/banking/checker", label: "File checker" },
  // R41 S11: the daily OFAC screen of every payee (never blocks a payment).
  { key: "screening", href: "/admin/settings/banking/screening", label: "Sanctions screening" },
  // R41 S14: Nacha Phase 2 yearly obligations (procedure review, risk assessment, who did what).
  { key: "yearly", href: "/admin/settings/banking/yearly-review", label: "Yearly review" },
] as const;

export type BankingHelpTabKey = (typeof BANKING_HELP_TABS)[number]["key"];

function cls(active: boolean): string {
  return `rounded-[var(--admin-radius)] px-4 py-2 text-sm font-semibold ${
    active ? "bg-emerald-500 text-emerald-950" : "border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/[0.08]"
  }`;
}

export function BankingHelpTabs({ active, badge }: { active?: BankingHelpTabKey; badge?: Partial<Record<BankingHelpTabKey, string>> }) {
  return (
    <>
      {BANKING_HELP_TABS.map((t) => (
        <Link key={t.key} href={t.href} className={cls(active === t.key)} aria-current={active === t.key ? "page" : undefined}>
          {t.label}
          {badge?.[t.key] ? <span className="ml-1.5 rounded-full bg-amber-400/90 px-1.5 text-[11px] font-bold text-amber-950">{badge[t.key]}</span> : null}
        </Link>
      ))}
    </>
  );
}

/** The full strip for the helper pages: back to the vault tabs, then the helpers. */
export function BankingSubnav({ active, badge }: { active: BankingHelpTabKey; badge?: Partial<Record<BankingHelpTabKey, string>> }) {
  const plain = "rounded-[var(--admin-radius)] border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06]";
  return (
    <nav aria-label="Banking sections" className="mb-6 flex flex-wrap gap-2">
      <Link href="/admin/settings/banking?tab=vendors" className={plain}>Vendors</Link>
      <Link href="/admin/settings/banking?tab=employees" className={plain}>Employees</Link>
      <Link href="/admin/settings/banking?tab=company" className={plain}>My banking</Link>
      <Link href="/admin/settings/banking/documents" className={plain}>Documents to review</Link>
      <Link href="/admin/settings/banking/operations" className={plain}>ACH operations</Link>
      <BankingHelpTabs active={active} badge={badge} />
    </nav>
  );
}
