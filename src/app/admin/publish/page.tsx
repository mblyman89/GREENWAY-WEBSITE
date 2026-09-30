import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, IssuesList, IssuesSummaryLine, PageTabs } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import {
  getPublishedVersion,
  listVersions,
  listIntakeStagedVersions,
  diffDraftsAgainstBase,
} from "@/lib/pos/menu-version";
import type { MenuVersion } from "@/lib/pos/db-types";
import {
  buildPublishVerdict,
  flagDraftFreshness,
  freshnessChip,
  PUBLISH_HELP_STEPS,
  PUBLISH_SEMANTICS_COPY,
  type DraftFreshness,
  type PublishVerdict,
} from "@/lib/pos/publish-guard-core";
import { formatDateTime } from "@/lib/pos/format";
import { factHoldHref } from "@/lib/pos/menu-waiting-link-core";
import {
  describeIntakeVersion,
  parseIntakeSummary,
  type IntakeVersionDescription,
} from "@/lib/pos/intake-version-copy-core";
import {
  buildPublishIssuesForVersion,
  issueChipLabel,
  issuesTabBadge,
  publishChipCount,
  sortIssues,
  summarizeIssues,
  type Issue,
} from "@/lib/admin/issues-core";
import { resolveTab, tabHref } from "@/lib/admin/page-tabs-core";
import { PUBLISH_PAGE_BASE, PUBLISH_PAGE_TABS } from "@/lib/admin/page-tab-sets";
import {
  primaryAction,
  QUEUE_EMPTY_COPY,
  QUEUE_REASON_TAG,
  queueReason,
  recentAutoPublished,
  splitQueue,
  type QueueReason,
} from "@/lib/pos/publish-queue-core";

export const dynamic = "force-dynamic";

/**
 * SLICE 76 — the Publish Menu command center (/admin/publish).
 *
 * The owner's pain: publish lived buried inside Menu Imports (under Settings),
 * multiple "Review & publish" cards with different counts were confusing, and
 * publishing an OLD draft silently shrank the live menu from 18 products to 3.
 *
 * S16: an EXCEPTION QUEUE. Approved products publish themselves, so this
 * page lists only what needs a person (bible S16.2):
 *   1. "Waiting for you" - each update with WHY it waits (the outcome S01
 *      recorded on the row, never guessed), a plain-English verdict from a
 *      real diff vs the live menu (lead with what stays and what is added),
 *      and exactly ONE primary button that resolves it.
 *   2. "Recently published automatically" - the last 10, read-only.
 *   3. "How publishing works" - collapsed help.
 * Updates older than the live menu are not work for a person: the S15 rule
 * archives them on the next publish, so they are listed apart, no button.
 * Every read is one the page already made (no new query).
 *
 * Menu Imports stays where it is (uploads + import history) — this page links
 * to it but does NOT absorb it.
 */

/** S15 chip colours: only "would take products off" is warm; nothing is red. */
const FRESHNESS_STYLE: Record<DraftFreshness, string> = {
  latest: "bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]",
  complete: "bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]/80",
  would_remove: "bg-[var(--admin-gold)]/15 text-[var(--admin-gold)]",
  superseded: "bg-white/10 text-white/50",
  unknown: "bg-white/10 text-white/60",
};

const VERDICT_STYLE: Record<PublishVerdict["level"], string> = {
  safe: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  caution: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  danger: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]",
};

type DraftRow = {
  /** S16: why this update waits for a person. */
  reason: QueueReason;
  version: MenuVersion & { freshness: DraftFreshness; removedCount: number | null };
  verdict: PublishVerdict | null;
  /** Where "Review & publish" goes — the intake or POS-import review page. */
  reviewHref: string;
  /** R13a: the delivery's flagged products (fact holds), or null. */
  factHref: string | null;
  origin: "receiving" | "pos-import";
  /** S01: why a receiving draft is waiting, in plain English (null for POS uploads). */
  story: IntakeVersionDescription | null;
};

export default async function PublishCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; published?: string; notice?: string; tab?: string }>;
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

  // S15: freshness by item SET, not timestamp. Newest first, capped, then ONE
  // read of the live menu shared by every diff (was one per row). A diff that
  // could not be read in full is "unknown" - never shown as safe.
  const VERDICT_CAP = 10;
  const waiting = [...intakeStaged, ...posStaged].sort(
    (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
  );
  const shown = waiting.slice(0, VERDICT_CAP);
  const diffs = await diffDraftsAgainstBase(
    shown.map((v) => v.id),
    published?.id ?? null,
  );
  const removedById = new Map<string, number | null>(
    shown.map((v) => {
      const d = diffs.get(v.id);
      return [v.id, d && d.complete ? d.diff.removed.length : null];
    }),
  );
  const flagged = flagDraftFreshness(shown, {
    liveCreatedAt: published?.created_at ?? null,
    removedById,
  });

  const rows: DraftRow[] = flagged.map((v): DraftRow => {
    const d = diffs.get(v.id);
    const verdict: PublishVerdict | null =
      d && d.complete
        ? buildPublishVerdict({
            added: d.diff.added.length,
            removed: d.diff.removed.length,
            priceChanged: d.diff.priceChanged.length,
            unchanged: d.diff.unchangedCount,
            hasLiveMenu: Boolean(published),
            stagedCreatedAt: v.created_at,
            publishedCreatedAt: published?.created_at ?? null,
            removedNames: d.diff.removed.map((r) => r.name),
          })
        : null;
    const origin = v.import_id === null ? ("receiving" as const) : ("pos-import" as const);
    const reviewHref =
      origin === "receiving"
        ? `/admin/menu-imports/version/${v.id}?back=${encodeURIComponent("/admin/publish")}`
        : `/admin/menu-imports/${v.import_id}?back=${encodeURIComponent("/admin/publish")}`;
    // S01: pure, no I/O — reads the summary_json this row already carries.
    const story = origin === "receiving" ? describeIntakeVersion(v) : null;
    // R13a: where a fact hold is decided - this delivery's approved products.
    const factHref = origin === "receiving" ? factHoldHref(v.summary_json) : null;
    return { version: v, verdict, reviewHref, factHref, origin, story, reason: queueReason(v) };
  });
  const overflow = Math.max(0, waiting.length - VERDICT_CAP);
  const latest = rows.find((r) => r.version.freshness === "latest") ?? null;
  // S16: superseded rows are not work for a person (S15 archives them).
  const queue = splitQueue(rows.map((r) => ({ ...r, freshness: r.version.freshness })));
  // S16: last 10 that went live by themselves, from the list already loaded.
  const recent = recentAutoPublished(allVersions);

  // S28: one Issues model for the waiting rows, built ONLY from stored state
  // (summary_json.diagnostics + warning_count, F-117) — pure, no new read.
  // A row disappears when its cause is fixed and the page reloads.
  const issuesByVersion = new Map<string, Issue[]>();
  for (const { version: v, reviewHref, factHref, origin, story, reason } of queue.waiting) {
    const parsed = parseIntakeSummary(v.summary_json);
    const subject =
      origin === "receiving"
        ? `${story?.source ?? "From receiving"} \u00b7 ${formatDateTime(v.created_at)}`
        : `POS upload \u00b7 ${formatDateTime(v.created_at)}`;
    issuesByVersion.set(
      v.id,
      buildPublishIssuesForVersion({
        versionId: v.id,
        subject,
        diagnostics: parsed.diagnostics,
        link: {
          manifestId: parsed.manifest?.id ?? parsed.manifestId,
          vendor: parsed.manifest?.vendor ?? null,
          manifestNumber: parsed.manifest?.number ?? null,
        },
        warningCount: v.warning_count,
        reviewHref,
        reason,
        action: primaryAction(reason, reviewHref, factHref),
      }),
    );
  }
  const issues = sortIssues([...issuesByVersion.values()].flat());
  const issueSummary = summarizeIssues(issues);
  const tabs = PUBLISH_PAGE_TABS.map((t) =>
    t.key === "issues" ? { ...t, ...issuesTabBadge(issueSummary) } : t,
  );
  const active = resolveTab(PUBLISH_PAGE_TABS, { tab: sp.tab }, "overview");
  const issuesHref = tabHref(PUBLISH_PAGE_BASE, "issues");

  return (
    <div>
      <AdminPageHeader
        title="Publish Menu"
        subtitle="Approved products go live by themselves. This page shows the few updates that need you."
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Publish Menu" }]} />}
        help={
          <HelpPanel
            id="publish-command-center"
            title="How publishing works"
            steps={[...PUBLISH_HELP_STEPS]}
          />
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        <CatalogStageStrip current="publish" />

        {sp.error && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]"
          >
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {/* S18: the cutover release / rebuild outcome, told plainly. */}
        {sp.notice && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]">
            {decodeURIComponent(sp.notice)}
          </div>
        )}
        {sp.published && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Published. The public menu now shows this version and its products are sellable at the register.
          </div>
        )}

        {/* S28: Overview | Issues | History. Result banners above stay on every tab. */}
        <PageTabs base={PUBLISH_PAGE_BASE} tabs={tabs} active={active} ariaLabel="Publish views" />

        {active === "issues" && (
          <IssuesList
            issues={issues}
            emptyText="Nothing waiting has a warning. Anything that needs you is on Overview with its one button."
          />
        )}

        {active === "overview" && (
          <>
        {/* S28 (D-R2-2): at most ONE line, only when an update is held or failed. */}
        <IssuesSummaryLine summary={issueSummary} href={issuesHref} />

        {/* The one-sentence mental model, verbatim from publish-guard-core. */}
        <div className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/5 p-4 text-sm text-white/70">
          <strong className="text-white">In short:</strong> {PUBLISH_SEMANTICS_COPY}
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
            label="Waiting for you"
            value={`${queue.waiting.length}${overflow > 0 ? "+" : ""}`}
            hint={queue.waiting.length > 0 ? "Each one says why, with one button" : "All caught up"}
            accent={queue.waiting.length > 0 ? "orange" : "green"}
          />
          <StatCard
            label="Newest draft"
            value={latest ? `${latest.version.item_count} items` : "—"}
            hint={latest ? formatDateTime(latest.version.created_at) : "Nothing waiting"}
            accent="muted"
          />
        </div>

        {/* S16 (1): Waiting for you - one reason and one button per row. */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Waiting for you</h2>
          <p className="mt-1 text-xs text-white/50">
            Each update says why it is waiting and has one button that sorts it out. If more than
            one is waiting, the one marked <strong>Latest</strong> keeps every live product.
          </p>

          {queue.waiting.length === 0 ? (
            <p className="mt-4 text-sm text-white/40">
              {QUEUE_EMPTY_COPY} Approve a received product with a price and it goes live by itself.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {queue.waiting.map(({ version: v, verdict, reviewHref, factHref, origin, story, reason }) => {
                const action = primaryAction(reason, reviewHref, factHref);
                return (
                  <div
                    key={v.id}
                    data-queue-row={reason}
                    className={`rounded-lg border p-4 ${
                      v.freshness === "latest" ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.04]" : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--admin-gold)]">
                        {QUEUE_REASON_TAG[reason]}
                      </span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${FRESHNESS_STYLE[v.freshness]}`}>
                        {freshnessChip(v)}
                      </span>
                      <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase text-white/50">
                        {origin === "receiving" ? "from receiving" : "from POS upload"}
                      </span>
                      <span className="text-xs text-white/40">{formatDateTime(v.created_at)}</span>
                    </div>
                    {story && (
                      <div className="mt-2 text-sm">
                        {story.source && <p className="text-xs text-white/50">{story.source}</p>}
                        <p
                          className={`mt-0.5 font-medium ${
                            story.tone === "failed" ? "text-[var(--admin-danger)]" : "text-[var(--admin-gold)]"
                          }`}
                        >
                          {story.headline}
                        </p>
                        {story.detail && <p className="mt-0.5 text-xs text-white/60">{story.detail}</p>}
                        {story.action && (
                          <p className="mt-0.5 text-xs text-white/70">
                            <strong>Next:</strong> {story.action}
                          </p>
                        )}
                      </div>
                    )}
                    {verdict && (
                      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${VERDICT_STYLE[verdict.level]}`}>
                        <p className="font-semibold">{verdict.headline}</p>
                        <p className="mt-0.5 opacity-90">{verdict.detail}</p>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-white/80">
                        {v.item_count} items · {v.variant_count} variants
                        {(() => {
                          const chip = issueChipLabel(publishChipCount(issuesByVersion.get(v.id) ?? []));
                          return chip ? (
                            <>
                              {" \u00b7 "}
                              <Link
                                href={issuesHref}
                                data-testid="publish-issue-chip"
                                className="text-xs text-[var(--admin-gold)] underline-offset-2 hover:underline"
                              >
                                {chip}
                              </Link>
                            </>
                          ) : null;
                        })()}
                      </p>
                      {canPublish ? (
                        <Button href={action.href} size="sm" variant={v.freshness === "latest" ? "confirm" : "primary"}>
                          {action.label}
                        </Button>
                      ) : (
                        <span className="text-xs text-white/40">A manager or admin publishes this.</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {overflow > 0 && (
                <p className="text-xs text-white/40">
                  …and {overflow} more waiting — see the full list under{" "}
                  <Link href="/admin/menu-imports" className="text-[var(--admin-accent)] hover:underline">
                    Menu Imports
                  </Link>
                  .
                </p>
              )}
            </div>
          )}

          {queue.superseded.length > 0 && (
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold text-white/60">
                Older than your live menu ({queue.superseded.length}) — nothing to do
              </p>
              <p className="mt-0.5 text-xs text-white/40">
                These were overtaken by a newer menu and are archived automatically the next time a
                menu goes live.
              </p>
              <ul className="mt-2 space-y-1">
                {queue.superseded.map(({ version: v, reviewHref, origin }) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${FRESHNESS_STYLE[v.freshness]}`}>
                      {freshnessChip(v)}
                    </span>
                    <span>{origin === "receiving" ? "from receiving" : "from POS upload"}</span>
                    <span>· {formatDateTime(v.created_at)}</span>
                    <Link href={reviewHref} className="text-white/50 underline hover:text-white">
                      view
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
          </>
        )}

        {/* S16 (2): Recently published automatically - read-only (S28: the History tab). */}
        {active === "history" && (
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Recently published automatically</h2>
          <p className="mt-1 text-xs text-white/50">
            Updates that went live by themselves after an approval. Nothing to do here.
          </p>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-white/40">None in the latest menu history.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/5">
              {recent.map((v) => {
                const story = describeIntakeVersion(v);
                return (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <span className="text-white/70">
                      {story.source ?? "From receiving"}
                      <span className="text-white/40"> · {story.counts}</span>
                    </span>
                    <span className="text-white/40">
                      {v.status === "published" ? "Live now" : "Since replaced"} · {formatDateTime(v.published_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        )}

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
