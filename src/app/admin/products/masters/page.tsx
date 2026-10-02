import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { withBackParam } from "@/lib/admin/back-link-core";
import { PageTabs } from "@/components/admin/ui/PageTabs";
import { resolveTab, withTabCounts } from "@/lib/admin/page-tabs-core";
import { MASTERS_PAGE_TABS } from "@/lib/admin/page-tab-sets";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button, Badge } from "@/components/admin/ui";
import {
  listMasters,
  listSuggestions,
  isAiConfigured,
  loadMasteredMenu,
  loadIdentityKeysForCards,
  listAllMasterMembers,
} from "@/lib/products/masters-store";
// S35 — what is actually mastered on the live menu.
import { ListPager } from "@/components/admin/ux";
import { listWindow, parsePageParam } from "@/lib/admin/list-window-core";
import {
  MASTERS_SUBTITLE,
  MANUAL_MASTER_RULE,
  LIVE_CARDS_PAGE_SIZE,
  LIVE_CARD_FILTERS,
  masteredStats,
  parseLiveCardsFilter,
  filterCards,
  liveCardsHref,
  masterMemberViews,
  manualMasterByKey,
  type MasteredCard,
  type MasterMemberView,
  type LiveCardsFilter,
} from "@/lib/products/mastered-menu-core";
import { LiveCardRow, MasterMembersList } from "@/components/admin/products/MasteredCards";
import {
  generateSuggestions,
  acceptSuggestionAction,
  rejectSuggestionAction,
  createMasterAction,
} from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/products/masters";

export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    error?: string;
    generated?: string;
    clusters?: string;
    rejected?: string;
    deleted?: string;
    back?: string;
    show?: string;
    page?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const tab = resolveTab(MASTERS_PAGE_TABS, { tab: sp.tab }, "live");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Product Mastering" subtitle={MASTERS_SUBTITLE} />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once setup is complete,
            product mastering will appear here.
          </div>
        </div>
      </div>
    );
  }

  const [masters, suggestions, mastered, memberRead] = await Promise.all([
    listMasters(),
    listSuggestions({ status: "pending" }),
    loadMasteredMenu(),
    listAllMasterMembers(),
  ]);

  const cards: MasteredCard[] = mastered.ok ? mastered.cards : [];
  const stats = masteredStats(cards);
  const cardsByKey = new Map(cards.map((c) => [c.key, c]));
  const masterNames = new Map(masters.map((m) => [m.id, m.display_name]));
  const membersByMaster = masterMemberViews(memberRead.members, cardsByKey);
  const masterByKey = manualMasterByKey(memberRead.members, masterNames);

  // Live cards: filter, then window (ListPager) — never an unbounded list.
  const show = parseLiveCardsFilter(sp.show);
  const filtered = filterCards(cards, show);
  const win = listWindow(filtered.length, parsePageParam(sp.page), LIVE_CARDS_PAGE_SIZE);
  const pageCards = filtered.slice(win.from, win.to + 1);
  // identity_key is opt-in (never on the full-menu read): only this page's cards.
  const identityKeys =
    tab === "live" && mastered.ok && mastered.versionId
      ? await loadIdentityKeysForCards(mastered.versionId, pageCards.map((c) => c.key))
      : new Map<string, string>();
  const selfHref = liveCardsHref(BASE, show, win.page, sp.back);

  return (
    <div>
      <AdminPageHeader
        title="Product Mastering"
        subtitle={MASTERS_SUBTITLE}
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Mastering" }]} />}
        help={
          <HelpPanel
            id="product-masters"
            title="How product mastering works"
            steps={[
              "Click “Generate suggestions” to scan your live menu for items that look like the same product at different sizes.",
              "Review each suggestion. Accept the good ones — that creates a DRAFT product card.",
              "Open a draft, tidy the name and variants, then Publish to group them on your public menu.",
              "Nothing changes on your menu until you publish. AI never publishes on its own.",
            ]}
          >
            <p>
              Suggestions are <strong>drafts only</strong>. Exact-name matches are
              found instantly; the AI adds smarter matches (e.g. brand spelled two
              ways) when it&apos;s configured.
            </p>
            <SopSheetLink slug="master" />
          </HelpPanel>
        }
        action={
          <form action={generateSuggestions}>
            <Button type="submit">✨ Generate suggestions</Button>
          </form>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback="/admin/catalog"
            back={sp.back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.generated !== undefined && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Created {sp.generated} new suggestion(s) from {sp.clusters ?? 0} candidate group(s).
            {!isAiConfigured && " (AI not configured — exact-name matches only.)"}
          </div>
        )}
        {sp.rejected && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Suggestion rejected.
          </div>
        )}

        <p
          className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm text-[var(--admin-text-muted)]"
          data-testid="manual-master-rule"
        >
          {MANUAL_MASTER_RULE}
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="masters-stats">
          <StatCard
            label="Live cards"
            value={mastered.ok ? stats.cards : "—"}
            hint={mastered.ok ? `${stats.singleSize} single size · ${stats.medicalOnly} medical only` : "could not read the live menu"}
            accent="green"
          />
          <StatCard label="Multi-size" value={mastered.ok ? stats.multiSize : "—"} hint="cards selling 2+ sizes" accent="green" />
          <StatCard label="Sizes on menu" value={mastered.ok ? stats.sizes : "—"} accent="muted" />
          <StatCard
            label="Pending suggestions"
            value={suggestions.length}
            hint={isAiConfigured ? "AI grouping on" : "exact-name matches only"}
            accent={suggestions.length > 0 ? "gold" : "muted"}
          />
        </div>

        <PageTabs
          base={BASE}
          tabs={withTabCounts(MASTERS_PAGE_TABS, {
            live: mastered.ok ? stats.cards : null,
            masters: masters.length,
            suggestions: suggestions.length,
          })}
          active={tab}
          keep={{ back: sp.back }}
          ariaLabel="Product mastering views"
        />

        {tab === "live" ? (
          <LiveCardsTab
            load={mastered}
            filtered={filtered}
            pageCards={pageCards}
            win={win}
            show={show}
            back={sp.back}
            selfHref={selfHref}
            identityKeys={identityKeys}
            masterByKey={masterByKey}
          />
        ) : tab === "masters" ? (
          <MastersTab
            masters={masters}
            sp={sp}
            membersByMaster={membersByMaster}
            membersComplete={memberRead.complete}
            menuReadOk={mastered.ok}
          />
        ) : (
          <SuggestionsTab suggestions={suggestions} />
        )}
      </div>
    </div>
  );
}

function LiveCardsTab({
  load,
  filtered,
  pageCards,
  win,
  show,
  back,
  selfHref,
  identityKeys,
  masterByKey,
}: {
  load: Awaited<ReturnType<typeof loadMasteredMenu>>;
  filtered: MasteredCard[];
  pageCards: MasteredCard[];
  win: ReturnType<typeof listWindow>;
  show: LiveCardsFilter;
  back: string | undefined;
  selfHref: string;
  identityKeys: Map<string, string>;
  masterByKey: Map<string, string>;
}) {
  if (!load.ok) {
    return (
      <div
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        data-testid="live-cards-error"
      >
        {load.error}
      </div>
    );
  }
  if (load.cards.length === 0) {
    return (
      <EmptyState
        icon="🗂️"
        title={load.versionId ? "Your live menu has no visible cards" : "No live menu yet"}
        description={
          load.versionId
            ? "Every card on the published menu is hidden, so nothing is mastered on the menu customers see."
            : "Publish a menu and the cards customers see — with their sizes, prices and stock — will be listed here."
        }
      />
    );
  }
  return (
    <div className="space-y-4" data-testid="live-cards">
      <nav className="flex flex-wrap gap-2" aria-label="Filter live cards">
        {LIVE_CARD_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={liveCardsHref(BASE, f.key, 1, back)}
            aria-current={f.key === show ? "page" : undefined}
            className={
              f.key === show
                ? "rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-semibold text-black"
                : "rounded-full border border-[var(--admin-border)] px-3 py-1 text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
            }
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {filtered.length === 0 ? (
        <EmptyState icon="🗂️" title="No cards match this filter" description="Choose “All cards” to see every live card." />
      ) : (
        <>
          <ListPager window={win} total={filtered.length} noun="card" makeHref={(p) => liveCardsHref(BASE, show, p, back)} />
          <ul className="space-y-3">
            {pageCards.map((c) => (
              <LiveCardRow
                key={c.key}
                card={c}
                back={selfHref}
                manualMaster={masterByKey.get(c.key) ?? null}
                identityKey={identityKeys.get(c.key) ?? null}
              />
            ))}
          </ul>
          <ListPager window={win} total={filtered.length} noun="card" makeHref={(p) => liveCardsHref(BASE, show, p, back)} />
        </>
      )}
    </div>
  );
}

function MastersTab({
  masters,
  sp,
  membersByMaster,
  membersComplete,
  menuReadOk,
}: {
  masters: Awaited<ReturnType<typeof listMasters>>;
  sp: Record<string, string | string[] | undefined>;
  membersByMaster: Map<string, MasterMemberView[]>;
  membersComplete: boolean;
  menuReadOk: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Create a product master manually</h3>
        <form action={createMasterAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input name="display_name" placeholder="Product name (e.g. Acme OG Kush)" required />
          </div>
          <div className="min-w-40">
            <Input name="brand_name" placeholder="Brand (optional)" />
          </div>
          <div className="min-w-40">
            <Input name="category" placeholder="Category (optional)" />
          </div>
          <Button type="submit">Create</Button>
        </form>
      </div>

      {(!membersComplete || !menuReadOk) && masters.length > 0 && (
        <p className="text-xs text-[var(--admin-orange)]" data-testid="masters-partial">
          {!membersComplete
            ? "Some master members could not be read, so a list below may be incomplete."
            : "The live menu could not be read, so members are shown without their sizes, prices or stock."}
        </p>
      )}
      {masters.length === 0 ? (
        <EmptyState icon="📦" title="No product masters yet" description="Generate suggestions above, accept the good ones, or create one manually." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {masters.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
              data-testid="master-card"
            >
              <div className="flex items-center gap-2">
                <Link
                  href={withBackParam(`${BASE}/${m.id}`, sp)}
                  className="flex-1 truncate text-sm font-semibold text-white hover:text-[var(--admin-accent)]"
                >
                  {m.display_name}
                </Link>
                {m.status === "published" ? (
                  <Badge tone="green">published</Badge>
                ) : m.status === "draft" ? (
                  <Badge tone="gold">draft</Badge>
                ) : (
                  <Badge tone="neutral">archived</Badge>
                )}
              </div>
              <p className="text-xs text-white/40">
                {m.brand_name ?? "—"} · {m.category ?? "—"}
              </p>
              {m.created_origin === "ai_suggestion" && (
                <span className="text-[10px] text-white/30">✨ from AI suggestion</span>
              )}
              <MasterMembersList members={membersByMaster.get(m.id) ?? []} back={`${BASE}?tab=masters`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionsTab({
  suggestions,
}: {
  suggestions: Awaited<ReturnType<typeof listSuggestions>>;
}) {
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon="✨"
        title="No pending suggestions"
        description="Click “Generate suggestions” to scan your live menu for groupable products."
      />
    );
  }
  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <div key={s.id} className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">{s.display_name}</span>
                {s.confidence != null && (
                  <Badge tone={s.confidence >= 0.8 ? "green" : "gold"}>
                    {Math.round(s.confidence * 100)}% match
                  </Badge>
                )}
                {s.model === "ai" ? <Badge tone="outline">✨ AI</Badge> : <Badge tone="neutral">exact name</Badge>}
              </div>
              <p className="mt-1 text-xs text-white/50">{s.rationale}</p>
              <ul className="mt-2 space-y-1">
                {s.members_json.map((m) => (
                  <li key={m.pos_product_key} className="text-xs text-white/70">
                    • {m.name}
                    {m.variant_label && <span className="ml-1 text-white/40">({m.variant_label})</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <form action={acceptSuggestionAction}>
                <input type="hidden" name="id" value={s.id} />
                <Button type="submit">Accept</Button>
              </form>
              <form action={rejectSuggestionAction}>
                <input type="hidden" name="id" value={s.id} />
                <Button type="submit" variant="neutral">Reject</Button>
              </form>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
