/**
 * Tabs shared by the three D220 crawl pages: Campaigns · Websites · Image catalog.
 */
const TABS = [
  { key: "board", href: "/admin/knowledge-base/campaigns", label: "⛏ Campaigns" },
  { key: "websites", href: "/admin/knowledge-base/campaigns/websites", label: "🔎 Find websites" },
  { key: "images", href: "/admin/knowledge-base/campaigns/images", label: "🖼 Image catalog" },
] as const;

export function CampaignTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Crawl campaign pages">
      {TABS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
            t.key === active
              ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]"
              : "border-white/15 text-white/70 hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
          }`}
        >
          {t.label}
        </a>
      ))}
      <a
        href="/admin/knowledge-base/harvest"
        className="ml-auto rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/50 hover:text-white/80"
      >
        Classic Harvest Console →
      </a>
    </nav>
  );
}

export function MigrationNote() {
  return (
    <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/5 px-4 py-3 text-sm text-[var(--admin-gold)]">
      The campaign tables aren&apos;t in the database yet. Apply migration{" "}
      <code className="font-mono">0351_kb_crawl_campaigns.sql</code> in the Supabase SQL editor (see
      docs/MIGRATIONS_TO_RUN.md), then reload this page.
    </div>
  );
}
