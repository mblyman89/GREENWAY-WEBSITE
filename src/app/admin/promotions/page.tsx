/**
 * /admin/promotions — the PROMOTIONS COMMAND CENTER (Task R).
 *
 * One screen to run the whole promotions program like a big-player back
 * office:
 *  - Stats + weekly schedule strip (which weekday is covered by which deal).
 *  - Standing CCRS BELOW-COST AUDIT: every published promotion is worst-case
 *    checked against the current menu + weighted-average acquisition costs
 *    (a discount may never take the price below the cost of acquisition —
 *    CCRS Upload User Guide; RCW 69.50.357). True hits also HARD-BLOCK at
 *    publish time and clamp at the register (defense in depth).
 *  - Conflict panel (products under more than one published promo).
 *  - AI advisor (drafts-only, aggregates only).
 *  - The promotions table with URL-driven filtering (status / type / weekday /
 *    search) and sorting — server-rendered, no client JS required.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, StatusPill } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listPromotions, detectConflicts } from "@/lib/promotions/promotions-store";
import { auditPublishedPromotions } from "@/lib/promotions/promo-guard";
import { formatMoneyMinor } from "@/lib/promotions/discount-engine-core";
import { isAiConfigured } from "@/lib/ai/provider";
import { WEEKDAY_LABELS, DISCOUNT_TYPE_LABELS } from "@/lib/promotions/types";
import type { PromotionRow, Weekday, DiscountType } from "@/lib/promotions/types";
import { storeWeekday } from "@/lib/reports/timezone";
import { WeeklyScheduleStrip } from "@/components/admin/promotions/WeeklyScheduleStrip";
import { PromotionsAdvisorPanel } from "@/components/admin/promotions/PromotionsAdvisorPanel";
import { getContentForRender } from "@/lib/cms/render-content";
import {
  resolveSpecialsPresentation,
  isWeekdayHiddenByPresentation,
} from "@/lib/specials/specials-presentation-core";

export const dynamic = "force-dynamic";

type Params = {
  status?: string;
  type?: string;
  weekday?: string;
  q?: string;
  sort?: string;
  deleted?: string;
};

const SORTS = ["schedule", "title", "status", "type", "newest"] as const;
type SortKey = (typeof SORTS)[number];

function sortPromos(promos: PromotionRow[], sort: SortKey): PromotionRow[] {
  const arr = [...promos];
  switch (sort) {
    case "title":
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case "status": {
      const rank: Record<string, number> = { published: 0, scheduled: 1, draft: 2, archived: 3 };
      return arr.sort(
        (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.title.localeCompare(b.title),
      );
    }
    case "type":
      return arr.sort(
        (a, b) => a.discount_type.localeCompare(b.discount_type) || a.title.localeCompare(b.title),
      );
    case "newest":
      return arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "schedule":
    default:
      // Weekday deals first (Sun→Sat), then dated/one-offs, then priority.
      return arr.sort((a, b) => {
        const wa = a.weekday ?? 99;
        const wb = b.weekday ?? 99;
        return wa - wb || b.priority - a.priority || a.title.localeCompare(b.title);
      });
  }
}

/** Build a query string preserving the other active filters. */
function href(sp: Params, patch: Partial<Params>): string {
  const merged = { ...sp, ...patch };
  const parts: string[] = [];
  for (const [k, v] of Object.entries(merged)) {
    if (k === "deleted") continue;
    if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return `/admin/promotions${parts.length ? `?${parts.join("&")}` : ""}`;
}

function chip(active: boolean): string {
  return active
    ? "rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-semibold text-black"
    : "rounded-full border border-[var(--admin-border)] px-3 py-1 text-xs text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)]";
}

export default async function PromotionsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requirePermission("promotions.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Promotions command center"
          subtitle="Daily deals, the promotion builder, and the CCRS cost-floor audit."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn’t fully set up yet. Once your administrator finishes the one-time
            setup, you’ll be able to manage promotions here. Until then the storefront uses the
            built-in daily-deal defaults (which already enforce the cost floor at the register).
          </div>
        </div>
      </div>
    );
  }

  const [promos, conflicts, audit, presentationJson] = await Promise.all([
    listPromotions(),
    detectConflicts(),
    auditPublishedPromotions(),
    getContentForRender("specials.deals.presentation"),
  ]);
  // SLICE 106: the /specials weekly-deal grid PRESENTATION (which weekday cards
  // show / are hidden). Prices/offers still come from these promotions — this
  // only affects whether the deal's CARD is visible on the public Specials page.
  const specialsPresentation = resolveSpecialsPresentation(presentationJson);
  const published = promos.filter((p) => p.status === "published").length;
  const drafts = promos.filter((p) => p.status === "draft").length;
  const scheduled = promos.filter((p) => p.status === "scheduled").length;

  // ── URL-driven filters ────────────────────────────────────────────────────
  const status = sp.status ?? "";
  const type = sp.type ?? "";
  const weekday = sp.weekday ?? "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort: SortKey = SORTS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : "schedule";

  let filtered = promos;
  if (status) filtered = filtered.filter((p) => p.status === status);
  if (type) filtered = filtered.filter((p) => p.discount_type === type);
  if (weekday === "dated") filtered = filtered.filter((p) => p.weekday === null);
  else if (weekday !== "") filtered = filtered.filter((p) => String(p.weekday) === weekday);
  if (q) {
    filtered = filtered.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.promo_key ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q),
    );
  }
  filtered = sortPromos(filtered, sort);

  const scheduleItems = promos
    .filter((p) => p.status !== "archived")
    .map((p) => ({ id: p.id, title: p.title, status: p.status, weekday: p.weekday }));
  // S-12: "today" on the schedule strip is the STORE's (Pacific) weekday.
  const todayWeekday = storeWeekday() as Weekday;

  const auditWithIssues = audit.entries.filter(
    (e) => e.belowCost.length > 0 || e.regularBelowCost.length > 0,
  );
  const costUnknownTotal = audit.totals.costUnknown;

  // SLICE 106: published, weekday-based promotions whose /specials deal CARD is
  // currently hidden by the Specials presentation settings. The deal still
  // applies at checkout and on the menu — it just isn't advertised on the
  // weekly-deals grid. Surfaces a gentle heads-up so staff aren't surprised.
  const hiddenByPresentation = promos
    .filter((p) => p.status === "published" && p.weekday != null)
    .map((p) => ({
      id: p.id,
      title: p.title,
      weekday: p.weekday as Weekday,
      label: WEEKDAY_LABELS[p.weekday as Weekday],
    }))
    .filter((p) => isWeekdayHiddenByPresentation(specialsPresentation, p.label));

  return (
    <div>
      <AdminPageHeader
        title="Promotions command center"
        subtitle="Build deals like a pro — with the CCRS cost floor, no stacking, and a publish gate baked in."
        breadcrumbs={<Breadcrumbs items={[{ label: "Promotions" }]} />}
        help={
          <HelpPanel
            id="promotions"
            title="How promotions work"
            steps={[
              "Create a promotion, choose the mechanics (percent, BOGO, tiers, basket, either/or), and pick the products/brands.",
              "Preview affected products and test in the simulator — the exact engine the register uses.",
              "Publish. Publishing HARD-BLOCKS if any product's worst case would fall below its acquisition cost (CCRS).",
              "Deals never stack — every item gets only the single best deal, and the register clamps at the cost floor.",
            ]}
          >
            <p>
              The daily deals are set in stone: Tuesday is 20% off prerolls &amp; blunts OR 4-for-3
              (whichever saves less), Sunday is 3-for-2 storewide with savings spread
              store-advantaged. The below-cost audit re-checks every published deal against your
              live menu and costs.
            </p>
          </HelpPanel>
        }
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/promotions/simulator"
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Discount simulator
            </Link>
            <Link
              href="/admin/promotions/new"
              className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#6bc945]"
            >
              + New promotion
            </Link>
          </div>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Total promotions" value={promos.length} accent="muted" />
          <StatCard label="Published (live)" value={published} accent="green" />
          <StatCard label="Drafts" value={drafts} accent="muted" />
          <StatCard label="Scheduled" value={scheduled} accent="gold" />
          <StatCard
            label="Below-cost hits"
            value={audit.totals.belowCost}
            accent={audit.totals.belowCost > 0 ? "orange" : "green"}
          />
          <StatCard
            label="Costed products"
            value={`${audit.costedProductCount}/${audit.productCount}`}
            accent={audit.costedProductCount < audit.productCount ? "gold" : "green"}
          />
        </div>

        {scheduleItems.length > 0 && (
          <WeeklyScheduleStrip items={scheduleItems} todayWeekday={todayWeekday} />
        )}

        {/* ── Where this shows up (SLICE 106) ─────────────────────────────── */}
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <p className="font-semibold text-white/85">📍 Where your published promotions show up</p>
          <p className="mt-1 text-white/55">
            When you publish a promotion, the price is applied everywhere automatically — you don&apos;t
            set it in more than one place.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            <li className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white/75">
              <span className="font-semibold text-white/90">🛒 Register (POS)</span> — the discount
              is applied at checkout, with the CCRS cost floor enforced.
            </li>
            <li className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white/75">
              <span className="font-semibold text-white/90">🌿 Online menu</span> — sale prices and
              deal badges appear on product cards and product pages.
            </li>
            <li className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white/75">
              <span className="font-semibold text-white/90">🔥 Specials page</span> — weekday deals
              appear on the weekly-deals grid.{" "}
              <Link href="/admin/specials" className="text-[var(--admin-accent)] hover:underline">
                Control which cards show →
              </Link>
            </li>
            <li className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white/75">
              <span className="font-semibold text-white/90">🏠 Home page</span> — today&apos;s deal is
              featured in the daily-deals section.
            </li>
          </ul>
        </div>

        {/* ── Hidden-by-presentation heads-up (SLICE 106) ─────────────────── */}
        {hiddenByPresentation.length > 0 ? (
          <div className="rounded-xl border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 p-4 text-sm">
            <p className="font-semibold text-[var(--admin-gold)]">
              👀 {hiddenByPresentation.length} published deal
              {hiddenByPresentation.length === 1 ? "" : "s"} not shown on the Specials page
            </p>
            <p className="mt-1 text-white/70">
              These deals are still live — they apply at the register and on the online menu — but
              their card is hidden on the weekly-deals grid by your{" "}
              <Link href="/admin/specials" className="underline">Specials presentation settings</Link>.
              That&apos;s fine if it&apos;s on purpose; here&apos;s the list so nothing surprises you.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {hiddenByPresentation.map((p) => (
                <li
                  key={p.id}
                  className="rounded-full border border-[var(--admin-gold)]/40 bg-black/30 px-3 py-1 text-xs text-white/80"
                >
                  {p.title} <span className="text-white/45">· {p.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ── CCRS below-cost audit ─────────────────────────────────────── */}
        {auditWithIssues.length > 0 ? (
          <div className="rounded-xl border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 p-4 text-sm">
            <p className="font-semibold text-[#ff6b6b]">
              🛡 CCRS cost-floor audit — {audit.totals.belowCost + audit.totals.regularBelowCost}{" "}
              product issue{audit.totals.belowCost + audit.totals.regularBelowCost === 1 ? "" : "s"}{" "}
              across published deals
            </p>
            <p className="mt-1 text-[#ffb0b0]/90">
              A discount may never take the sale price below the cost of acquisition (CCRS Upload
              User Guide; RCW 69.50.357). The register already clamps these — fix the price, soften
              the deal, or exclude the product so the advertised deal matches the charged deal.
            </p>
            <div className="mt-3 space-y-3">
              {auditWithIssues.map((e) => (
                <div key={e.promotionId} className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <p className="text-xs font-semibold text-white/85">
                    {e.title}
                    {e.weekday != null ? ` · every ${WEEKDAY_LABELS[e.weekday as Weekday]}` : ""}
                    <span className="ml-2 font-normal text-white/45">
                      {e.affectedCount} product{e.affectedCount === 1 ? "" : "s"} in scope
                    </span>
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {e.belowCost.slice(0, 5).map((f) => (
                      <li key={`bc-${f.key}`} className="text-xs text-[#ffb0b0]">
                        <span className="font-medium text-white/80">{f.name}</span> — worst case{" "}
                        {formatMoneyMinor(f.worstCasePriceMinorUnits)} is below the{" "}
                        {formatMoneyMinor(f.floorMinorUnits)} cost floor (reg{" "}
                        {formatMoneyMinor(f.priceMinorUnits)}); register clamps to the floor.
                      </li>
                    ))}
                    {e.belowCost.length > 5 && (
                      <li className="text-xs text-[#ffb0b0]/70">
                        …and {e.belowCost.length - 5} more below-cost hits.
                      </li>
                    )}
                    {e.regularBelowCost.slice(0, 3).map((f) => (
                      <li key={`rb-${f.key}`} className="text-xs text-[var(--admin-gold)]/90">
                        <span className="font-medium text-white/80">{f.name}</span> — regular price{" "}
                        {formatMoneyMinor(f.priceMinorUnits)} already sits at/below its{" "}
                        {formatMoneyMinor(f.floorMinorUnits)} cost floor. No discount can apply;
                        review the price or the cost data.
                      </li>
                    ))}
                    {e.regularBelowCost.length > 3 && (
                      <li className="text-xs text-[var(--admin-gold)]/60">
                        …and {e.regularBelowCost.length - 3} more priced at/below cost.
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.06] p-4 text-sm">
            <p className="font-semibold text-[var(--admin-accent)]">
              🛡 CCRS cost-floor audit — all published deals clear
            </p>
            <p className="mt-1 text-white/60">
              Every published promotion was worst-case checked against your live menu and
              weighted-average acquisition costs: no product can be discounted below its cost of
              acquisition.
              {costUnknownTotal > 0 && (
                <>
                  {" "}
                  <span className="text-[var(--admin-gold)]">
                    {costUnknownTotal} product{costUnknownTotal === 1 ? "" : "s"} in scope have no
                    cost on file yet
                  </span>{" "}
                  — they fall back to the statutory never-free floor until a costed lot exists.
                </>
              )}
            </p>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="rounded-xl border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-4 text-sm text-[#ffb066]">
            <p className="font-semibold text-[var(--admin-orange)]">
              ⚠ {conflicts.length} product{conflicts.length === 1 ? "" : "s"} fall under more than
              one published promotion
            </p>
            <p className="mt-1 text-[#ffb066]/80">
              No double-dipping ever happens — the register applies only the single best deal — but
              overlapping promos can show conflicting badges. Tighten targeting or add exclusions.
            </p>
            <ul className="mt-2 space-y-1">
              {conflicts.slice(0, 8).map((c) => (
                <li key={c.productKey} className="text-xs text-[#ffb066]/90">
                  <span className="text-white/80">{c.productName}</span> —{" "}
                  {c.promotionTitles.join(" + ")}
                </li>
              ))}
              {conflicts.length > 8 && (
                <li className="text-xs text-[#ffb066]/70">…and {conflicts.length - 8} more.</li>
              )}
            </ul>
          </div>
        )}

        <PromotionsAdvisorPanel aiEnabled={isAiConfigured} />

        {/* ── Filters + search ──────────────────────────────────────────── */}
        <div className="space-y-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Status
            </span>
            <Link href={href(sp, { status: "" })} className={chip(!status)}>
              All
            </Link>
            {(["published", "scheduled", "draft", "archived"] as const).map((s) => (
              <Link key={s} href={href(sp, { status: s })} className={chip(status === s)}>
                {s}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Type
            </span>
            <Link href={href(sp, { type: "" })} className={chip(!type)}>
              All
            </Link>
            {(Object.keys(DISCOUNT_TYPE_LABELS) as DiscountType[]).map((t) => (
              <Link key={t} href={href(sp, { type: t })} className={chip(type === t)}>
                {DISCOUNT_TYPE_LABELS[t]}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Day
            </span>
            <Link href={href(sp, { weekday: "" })} className={chip(weekday === "")}>
              All
            </Link>
            {([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((d) => (
              <Link
                key={d}
                href={href(sp, { weekday: String(d) })}
                className={chip(weekday === String(d))}
              >
                {WEEKDAY_LABELS[d].slice(0, 3)}
              </Link>
            ))}
            <Link href={href(sp, { weekday: "dated" })} className={chip(weekday === "dated")}>
              Dated / one-off
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <form action="/admin/promotions" method="get" className="flex items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              {type && <input type="hidden" name="type" value={type} />}
              {weekday && <input type="hidden" name="weekday" value={weekday} />}
              {sort !== "schedule" && <input type="hidden" name="sort" value={sort} />}
              <input
                type="search"
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder="Search title, key, description…"
                className="w-64 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]"
              />
              <button
                type="submit"
                className="rounded-lg border border-[var(--admin-border)] px-3 py-1.5 text-sm text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)]"
              >
                Search
              </button>
            </form>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Sort
              </span>
              {SORTS.map((s) => (
                <Link key={s} href={href(sp, { sort: s })} className={chip(sort === s)}>
                  {s}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)] backdrop-blur">
              <tr>
                <th className="px-4 py-3 font-semibold">Promotion</th>
                <th className="px-4 py-3 font-semibold">Schedule</th>
                <th className="px-4 py-3 font-semibold">Discount</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--admin-text-faint)]">
                    {promos.length === 0
                      ? "No promotions yet. The storefront is currently showing the built-in daily-deal defaults. Create one to override them."
                      : "No promotions match the current filters."}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="odd:bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/promotions/${p.id}`}
                      className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {p.title}
                    </Link>
                    {p.promo_key && (
                      <span className="ml-2 text-xs text-[var(--admin-text-faint)]">
                        {p.promo_key}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                    {p.weekday !== null
                      ? `Every ${WEEKDAY_LABELS[p.weekday as Weekday]}`
                      : p.starts_at
                        ? `${p.starts_at.slice(0, 10)} → ${p.ends_at?.slice(0, 10) ?? "…"}`
                        : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                    {DISCOUNT_TYPE_LABELS[p.discount_type]}
                    {p.discount_percent > 0 ? ` · ${p.discount_percent}%` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--admin-text-faint)]">
          Showing {filtered.length} of {promos.length} promotion{promos.length === 1 ? "" : "s"}.
          Deals never stack; the register clamps every price at the product&apos;s CCRS cost floor.
        </p>
      </div>
    </div>
  );
}
