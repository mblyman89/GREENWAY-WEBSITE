import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import {
  getPublishedVersion,
  listVersions,
  listIntakeStagedVersions,
  diffVersions,
} from "@/lib/pos/menu-version";
import type { MenuVersion } from "@/lib/pos/db-types";
import {
  buildPublishVerdict,
  flagOutdatedDrafts,
  PUBLISH_SEMANTICS_COPY,
  type PublishVerdict,
} from "@/lib/pos/publish-guard-core";
import { formatDateTime } from "@/lib/pos/format";

export const dynamic = "force-dynamic";

/**
 * SLICE 76 — the Publish Menu command center (/admin/publish).
 *
 * The owner's pain: publish lived buried inside Menu Imports (under Settings),
 * multiple "Review & publish" cards with different counts were confusing, and
 * publishing an OLD draft silently shrank the live menu from 18 products to 3.
 *
 * This page is the journey's Publish stage (journey-core href). It shows:
 *   - what's live right now,
 *   - every waiting draft with ONE clearly marked "Latest" (the safe one) and
 *     the rest marked "Outdated" with a plain-English removal warning,
 *   - a safety verdict per draft built from a real diff vs. the live menu.
 *
 * Menu Imports stays where it is (uploads + import history) — this page links
 * to it but does NOT absorb it.
 */

const VERDICT_STYLE: Record<PublishVerdict["level"], string> = {
  safe: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  caution: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  danger: "border-red-500/40 bg-red-500/10 text-red-300",
};

type DraftRow = {
  version: MenuVersion & { freshness: "latest" | "outdated" };
  verdict: PublishVerdict | null;
  /** Where "Review & publish" goes — the intake or POS-import review page. */
  reviewHref: string;
  origin: "receiving" | "pos-import";
};

export default async function PublishCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; published?: string }>;
}) {
  const session = await requirePermission("menu.import");
  const sp = await searchParams;
  const canPublish = can(session.profile.role, "menu.publish");

  const [published, intakeStaged, allVersions] = await Promise.all([
    getPublishedVersion(),
    listIntakeStagedVersions(),
    listVersions(),
  ]);

  // Staged POS-import versions reviewed on the Menu Imports review page.
  const posStaged = allVersions.filter((v) => v.status === "staged" && v.import_id !== null);

  // ONE freshness ranking across every waiting draft, newest first.
  const flagged = flagOutdatedDrafts([...intakeStaged, ...posStaged]);

  // Real diff-based verdict per draft (capped to keep the page snappy).
  const VERDICT_CAP = 10;
  const rows: DraftRow[] = await Promise.all(
    flagged.slice(0, VERDICT_CAP).map(async (v): Promise<DraftRow> => {
      let verdict: PublishVerdict | null = null;
      try {
        const diff = await diffVersions(v.id, published?.id ?? null);
        verdict = buildPublishVerdict({
          added: diff.added.length,
          removed: diff.removed.length,
          priceChanged: diff.priceChanged.length,
          unchanged: diff.unchangedCount,
          hasLiveMenu: Boolean(published),
          stagedCreatedAt: v.created_at,
          publishedCreatedAt: published?.created_at ?? null,
        });
      } catch (err) {
        console.error("[admin/publish] verdict diff failed:", err);
      }
      const origin = v.import_id === null ? ("receiving" as const) : ("pos-import" as const);
      const reviewHref =
        origin === "receiving"
          ? `/admin/menu-imports/version/${v.id}?back=${encodeURIComponent("/admin/publish")}`
          : `/admin/menu-imports/${v.import_id}?back=${encodeURIComponent("/admin/publish")}`;
      return { version: v, verdict, reviewHref, origin };
    }),
  );
  const overflow = Math.max(0, flagged.length - VERDICT_CAP);
  const latest = rows.find((r) => r.version.freshness === "latest") ?? null;

  return (
    <div>
      <AdminPageHeader
        title="Publish Menu"
        subtitle="One place to see what's live, review the newest menu draft, and put it live safely."
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Publish Menu" }]} />}
        help={
          <HelpPanel
            id="publish-command-center"
            title="How publishing works"
            steps={[
              "Your live menu is a snapshot — publishing a draft replaces the WHOLE menu with that draft. It never adds to it.",
              "Receiving creates a draft automatically when you approve a product with a price, and usually publishes it for you too. Drafts only wait here when a publish needs your click.",
              "Always publish the draft marked LATEST. Older drafts are missing products added after them — publishing one takes those products off your menu.",
              "Each draft's review page explains every 'to fix' item in plain English with a button to the page that fixes it.",
              "POS-export uploads and import history stay under Menu Imports (Settings) — this page just puts publishing front and center.",
            ]}
          />
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        <CatalogStageStrip current="publish" />

        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.published && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Published. The public menu now shows this version and its products are sellable at the register.
          </div>
        )}

        {/* The one-sentence mental model, verbatim from publish-guard-core. */}
        <div className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-4 text-sm text-white/70">
          <strong className="text-white">How this works:</strong> {PUBLISH_SEMANTICS_COPY}
        </div>

        {/* What's live right now */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Live menu"
            value={published ? `${published.item_count} items` : "None yet"}
            hint={published ? `Published ${formatDateTime(published.published_at)}` : "Nothing published yet"}
            accent={published ? "green" : "orange"}
          />
          <StatCard
            label="Live variants"
            value={published ? `${published.variant_count}` : "—"}
            hint={published ? `${published.vendor_count} vendors` : "—"}
            accent="muted"
          />
          <StatCard
            label="Drafts waiting"
            value={`${flagged.length}`}
            hint={flagged.length > 0 ? "Only the LATEST is safe by default" : "All caught up"}
            accent={flagged.length > 0 ? "orange" : "green"}
          />
          <StatCard
            label="Newest draft"
            value={latest ? `${latest.version.item_count} items` : "—"}
            hint={latest ? formatDateTime(latest.version.created_at) : "Nothing waiting"}
            accent="muted"
          />
        </div>

        {/* Drafts */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Menu drafts waiting for review</h2>
            {latest && canPublish && (
              <Button href={latest.reviewHref} size="sm" variant="confirm">
                Review &amp; publish the latest draft →
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-white/50">
            Each draft is a complete menu snapshot. The one marked <strong>Latest</strong> carries
            everything; drafts marked <strong>Outdated</strong> were staged earlier and are missing
            newer products — publishing one would take those products off your live menu.
          </p>

          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-white/40">
              Nothing waiting — every menu update has published. Approve a received product with a
              price (or upload a POS export under Menu Imports) to create a new draft.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {rows.map(({ version: v, verdict, reviewHref, origin }) => (
                <div
                  key={v.id}
                  className={`rounded-lg border p-4 ${
                    v.freshness === "latest" ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.04]" : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {v.freshness === "latest" ? (
                      <span className="rounded bg-[var(--admin-accent)]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--admin-accent)]">
                        Latest — publish this one
                      </span>
                    ) : (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-red-300">
                        Outdated — missing newer products
                      </span>
                    )}
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase text-white/50">
                      {origin === "receiving" ? "from receiving" : "from POS upload"}
                    </span>
                    <span className="text-xs text-white/40">{formatDateTime(v.created_at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-white/80">
                      {v.item_count} items · {v.variant_count} variants
                      {v.warning_count > 0 && (
                        <span className="text-[var(--admin-gold)]"> · {v.warning_count} to fix</span>
                      )}
                    </p>
                    <Button href={reviewHref} size="sm" variant={v.freshness === "latest" ? "primary" : "neutral"}>
                      Review &amp; publish →
                    </Button>
                  </div>
                  {verdict && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${VERDICT_STYLE[verdict.level]}`}>
                      <p className="font-semibold">{verdict.headline}</p>
                      <p className="mt-0.5 opacity-90">{verdict.detail}</p>
                    </div>
                  )}
                </div>
              ))}
              {overflow > 0 && (
                <p className="text-xs text-white/40">
                  …and {overflow} older draft(s) — see the full list under{" "}
                  <Link href="/admin/menu-imports" className="text-[var(--admin-accent)] hover:underline">
                    Menu Imports
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
        </section>

        {/* Where the other pieces live */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Related surfaces</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Link
              href="/admin/menu-imports"
              className="admin-focus rounded-lg border border-white/10 p-3 text-sm text-white/70 transition hover:border-[var(--admin-accent)]/50 hover:text-white"
            >
              <p className="font-medium text-white">Menu Imports</p>
              <p className="mt-1 text-xs text-white/40">
                Upload POS exports and browse import history — it stays right where it was.
              </p>
            </Link>
            <Link
              href="/admin/inventory"
              className="admin-focus rounded-lg border border-white/10 p-3 text-sm text-white/70 transition hover:border-[var(--admin-accent)]/50 hover:text-white"
            >
              <p className="font-medium text-white">Inventory</p>
              <p className="mt-1 text-xs text-white/40">
                Live, on-hand stock and compliance lots behind the menu.
              </p>
            </Link>
            <Link
              href="/menu"
              className="admin-focus rounded-lg border border-white/10 p-3 text-sm text-white/70 transition hover:border-[var(--admin-accent)]/50 hover:text-white"
            >
              <p className="font-medium text-white">Public menu</p>
              <p className="mt-1 text-xs text-white/40">See exactly what customers see right now.</p>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
