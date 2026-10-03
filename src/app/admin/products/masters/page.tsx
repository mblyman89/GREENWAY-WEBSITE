import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
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
  loadManifestLotKeys,
  listMasterableManifests,
} from "@/lib/products/masters-store";
// R23 (owner fix 7): vendor + manifest facets.
import {
  parseMastersFilter,
  isFiltered,
  vendorOptions,
  manifestKeySet,
  manifestOptions,
  applyMastersFilter,
  masterPasses,
  withMastersFilter,
  filterSummary,
  type MastersFilter,
} from "@/lib/products/masters-filter-core";
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
import {
  bandBadgeText,
  contributionText,
  readEvidence,
  REJECT_HELP,
  type MatchBand,
} from "@/lib/products/match-weights-core";

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
    remembered?: string;
    suppressed?: string;
    unmigrated?: string;
    deleted?: string;
    back?: string;
    show?: string;
    page?: string;
    vendor?: string;
    manifest?: string;
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

  const facets = parseMastersFilter(sp);
  const [masters, suggestions, mastered, memberRead, manifestRows, manifestLots] = await Promise.all([
    listMasters(),
    listSuggestions({ status: "pending" }),
    loadMasteredMenu(),
    listAllMasterMembers(),
    listMasterableManifests(),
    facets.manifest ? loadManifestLotKeys(facets.manifest) : Promise.resolve(null),
  ]);

  const allCards: MasteredCard[] = mastered.ok ? mastered.cards : [];
  // R23 fix 7: facets narrow first (AND); a manifest whose lots could not be
  // read shows nothing and says so — never silently "all".
  const manifestReadFailed = manifestLots !== null && !manifestLots.ok;
  const manifestKeys = manifestLots && manifestLots.ok ? manifestKeySet(manifestLots.lots) : null;
  const cards: MasteredCard[] = applyMastersFilter(allCards, facets, manifestKeys);
  const vendorOpts = vendorOptions(allCards);
  const manifestOpts = manifestOptions(manifestRows, facets.vendor);
  const vendorLabel = facets.vendor ? (vendorOpts.find((v) => v.key === facets.vendor)?.label ?? facets.vendor) : null;
  const manifestLabel = facets.manifest
    ? (manifestOptions(manifestRows, "").find((m) => m.id === facets.manifest)?.label ?? "the selected manifest")
    : null;
  const passingKeys = new Set(cards.map((c) => c.key));
  const stats = masteredStats(allCards);
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
  const selfHref = withMastersFilter(liveCardsHref(BASE, show, win.page, sp.back), facets);
  const visibleMasters = isFiltered(facets)
    ? masters.filter((m) => masterPasses(membersByMaster.get(m.id) ?? [], passingKeys))
    : masters;

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
              Suggestions are <strong>drafts only</strong>. Each one is scored field
              by field (vendor, brand, strain, product type, market, strain type,
              sizes, THC and price per gram): matching facts add points, conflicting
              facts take points away, and the card shows every line. Strong is 95% or
              more, Likely 80&ndash;95%, Review 50&ndash;80%. The AI only adds a second
              opinion to Review suggestions; it never makes the score.
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
        {/* R23 item 8: the one pipeline bar, in order. */}
        <CatalogStageStrip current="master" />
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.generated !== undefined && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Created {sp.generated} new suggestion(s) from {sp.clusters ?? 0} scored group(s).
            {sp.suppressed && Number(sp.suppressed) > 0 && ` ${sp.suppressed} pair(s) you rejected stayed hidden.`}
            {!isAiConfigured && " (AI not configured — rule scores only, no second opinion.)"}
          </div>
        )}
        {sp.rejected && (
          <div
            className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]"
            data-testid="masters-rejected-banner"
          >
            {sp.unmigrated
              ? "Suggestion rejected. It is not remembered yet: run migration 0243 so rejected pairs stay hidden."
              : `Suggestion rejected. ${sp.remembered ?? 0} pair(s) will stay hidden until one of the products changes.`}
          </div>
        )}
        {sp.unmigrated && !sp.rejected && sp.generated !== undefined && (
          <div className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-orange)]" data-testid="masters-unmigrated-banner">
            Migration 0243 is not applied yet, so the field-by-field reasons were not saved and rejections are not remembered.
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
            hint={isAiConfigured ? "scored · AI second opinion on" : "scored · rule scores only"}
            accent={suggestions.length > 0 ? "gold" : "muted"}
          />
        </div>

        <PageTabs
          base={BASE}
          tabs={withTabCounts(MASTERS_PAGE_TABS, {
            live: mastered.ok ? stats.cards : null,
            masters: visibleMasters.length,
            suggestions: suggestions.length,
          })}
          active={tab}
          keep={{ back: sp.back, vendor: facets.vendor || undefined, manifest: facets.manifest || undefined }}
          allow={["back", "vendor", "manifest"]}
          ariaLabel="Product mastering views"
        />

        {tab !== "suggestions" && mastered.ok && allCards.length > 0 && (
          <MastersFacetForm
            tab={tab}
            back={sp.back}
            facets={facets}
            vendorOpts={vendorOpts}
            manifestOpts={manifestOpts}
            summary={
              isFiltered(facets)
                ? filterSummary(cards.length, allCards.length, vendorLabel, manifestLabel)
                : null
            }
            manifestReadFailed={manifestReadFailed}
          />
        )}

        {tab === "live" ? (
          <LiveCardsTab
            load={mastered}
            filtered={filtered}
            pageCards={pageCards}
            win={win}
            show={show}
            back={sp.back}
            facets={facets}
            selfHref={selfHref}
            identityKeys={identityKeys}
            masterByKey={masterByKey}
          />
        ) : tab === "masters" ? (
          <MastersTab
            masters={visibleMasters}
            filtered={isFiltered(facets)}
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
  facets,
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
  facets: MastersFilter;
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
            href={withMastersFilter(liveCardsHref(BASE, f.key, 1, back), facets)}
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
        <EmptyState
          icon="🗂️"
          title="No cards match this filter"
          description={
            isFiltered(facets)
              ? "No live card matches this vendor / manifest. Choose “Clear” above to see every live card."
              : "Choose “All cards” to see every live card."
          }
        />
      ) : (
        <>
          <ListPager window={win} total={filtered.length} noun="card" makeHref={(p) => withMastersFilter(liveCardsHref(BASE, show, p, back), facets)} />
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
          <ListPager window={win} total={filtered.length} noun="card" makeHref={(p) => withMastersFilter(liveCardsHref(BASE, show, p, back), facets)} />
        </>
      )}
    </div>
  );
}

function MastersTab({
  masters,
  filtered,
  sp,
  membersByMaster,
  membersComplete,
  menuReadOk,
}: {
  masters: Awaited<ReturnType<typeof listMasters>>;
  filtered: boolean;
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
        filtered ? (
          <EmptyState
            icon="📦"
            title="No masters for this vendor / manifest"
            description="No master has a member card that matches the filter above. Choose “Clear” to see every master."
          />
        ) : (
          <EmptyState icon="📦" title="No product masters yet" description="Generate suggestions above, accept the good ones, or create one manually." />
        )
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

/** R23 fix 7 — plain GET form (works without JS; the URL is shareable). */
function MastersFacetForm({
  tab,
  back,
  facets,
  vendorOpts,
  manifestOpts,
  summary,
  manifestReadFailed,
}: {
  tab: string;
  back: string | undefined;
  facets: MastersFilter;
  vendorOpts: { key: string; label: string; count: number }[];
  manifestOpts: { id: string; label: string }[];
  summary: string | null;
  manifestReadFailed: boolean;
}) {
  const selectCls =
    "min-w-48 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]";
  const clearQs = new URLSearchParams({ tab });
  if (back?.trim()) clearQs.set("back", back.trim());
  return (
    <div
      className="space-y-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
      data-testid="masters-facets"
    >
      <form method="get" action={BASE} className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter by vendor and manifest">
        <input type="hidden" name="tab" value={tab} />
        {back?.trim() ? <input type="hidden" name="back" value={back.trim()} /> : null}
        <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
          Vendor
          <select name="vendor" defaultValue={facets.vendor} className={selectCls} data-testid="masters-vendor-select">
            <option value="">Any vendor</option>
            {vendorOpts.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label} ({v.count})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
          Manifest
          <select name="manifest" defaultValue={facets.manifest} className={selectCls} data-testid="masters-manifest-select">
            <option value="">Any manifest</option>
            {manifestOpts.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Apply</Button>
        {isFiltered(facets) && (
          <Link
            href={`${BASE}?${clearQs.toString()}`}
            className="py-2 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
            data-testid="masters-facets-clear"
          >
            Clear
          </Link>
        )}
      </form>
      {manifestReadFailed ? (
        <p className="text-xs text-[var(--admin-orange)]" data-testid="masters-manifest-read-failed">
          The lots on that manifest could not be read, so no card is shown. Reload the page; if it persists, check the database connection.
        </p>
      ) : summary ? (
        <p className="text-xs text-[var(--admin-text-muted)]" data-testid="masters-facets-summary">
          {summary}
        </p>
      ) : (
        <p className="text-xs text-[var(--admin-text-faint)]">
          Pick a vendor and/or a received manifest to narrow the cards and masters below.
        </p>
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
                <SuggestionBadge suggestion={s} />
              </div>
              <SuggestionWhy suggestion={s} />
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
              <p className="max-w-[11rem] text-[10px] leading-snug text-white/40" data-testid="suggestion-reject-help">
                {REJECT_HELP}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type SuggestionRow = Awaited<ReturnType<typeof listSuggestions>>[number];

const BAND_TONE: Record<Exclude<MatchBand, "hidden">, "green" | "gold" | "orange"> = {
  strong: "green",
  likely: "gold",
  review: "orange",
};

/** S36: "Strong / Likely / Review · n%". Old rows (no evidence) keep the old badge. */
function SuggestionBadge({ suggestion: s }: { suggestion: SuggestionRow }) {
  const ev = readEvidence(s.evidence_json);
  if (ev) {
    return (
      <>
        <Badge tone={BAND_TONE[ev.band]}>
          <span data-testid="suggestion-band">{bandBadgeText(ev.band, ev.probability)}</span>
        </Badge>
        {ev.ai && <Badge tone="outline">{ev.ai.agrees ? "\u2728 AI agrees" : "\u2728 AI unsure"}</Badge>}
      </>
    );
  }
  return (
    <>
      {s.confidence != null && (
        <Badge tone={s.confidence >= 0.8 ? "green" : "gold"}>{Math.round(s.confidence * 100)}% match</Badge>
      )}
      {s.model === "ai" ? <Badge tone="outline">✨ AI</Badge> : <Badge tone="neutral">older suggestion</Badge>}
    </>
  );
}

/** S36: the per-field waterfall, plus-lines first. Old rows show their saved reason. */
function SuggestionWhy({ suggestion: s }: { suggestion: SuggestionRow }) {
  const ev = readEvidence(s.evidence_json);
  if (!ev) return <p className="mt-1 text-xs text-white/50">{s.rationale}</p>;
  const lines = [...ev.contributions].sort((a, b) => b.weight - a.weight);
  return (
    <div className="mt-1" data-testid="suggestion-waterfall">
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {lines.map((c) => (
          <li
            key={c.field}
            className={c.weight > 0 ? "text-[var(--admin-accent)]" : c.weight < 0 ? "text-[var(--admin-orange)]" : "text-white/35"}
          >
            {contributionText(c)}
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-[10px] text-white/35">
        Starting point {contributionText({ weight: ev.prior, note: "(most look-alikes are different products)" })} · total {ev.weight.toFixed(1)}
        {ev.pairs.length > 1 && ` · weakest of ${ev.pairs.length} pairs shown`}
      </p>
      {ev.ai && <p className="mt-0.5 text-[10px] text-white/45">AI second opinion: {ev.ai.note}</p>}
    </div>
  );
}
