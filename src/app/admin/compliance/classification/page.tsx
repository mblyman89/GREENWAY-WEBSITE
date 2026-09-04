/**
 * /admin/compliance/classification   (SLICE 18A)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The sales-limit classification worklist.
 *
 * SLICE 16 gave low-THC beverages their own 200 mg limit and SLICE 17 gave
 * suppositories their own 10-unit limit. SLICE 18-0 wired the receiving door so
 * anything arriving from now on gets asked the question before it can be
 * approved.
 *
 * None of that reaches the products that were ALREADY here when those slices
 * landed. This page is where a human clears that backlog: it lists every
 * product whose classification could still change a legal outcome, worst first,
 * and hands each one straight to the editor on its lot detail page.
 *
 * WHY IT LIVES UNDER /admin/compliance AND NOT UNDER /admin/inventory
 *
 * The unit of work is a PRODUCT, not a lot — one menu row holds the answer, and
 * a product restocked eight times is still one question. The inventory list is
 * lot-per-row by definition, so the same question would print eight times
 * there. It sits beside the sales-limit settings it exists to serve instead.
 *
 * PERMISSION: inventory.manage, matching the editor it links to. A page that
 * lists work its reader cannot action is a dead end.
 * ────────────────────────────────────────────────────────────────────────────
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Card } from "@/components/admin/ui";
import { getClassificationWorklist } from "@/lib/inventory/classification-worklist-store";
import {
  classificationWorklistHref,
  emptyWorklistMessage,
  filterWorklist,
  parseWorklistFilter,
  summarizeWorklist,
  worklistScopeLabel,
  worklistSourceLabel,
  type ClassificationWorklistScope,
  type ClassificationWorklistSource,
} from "@/lib/inventory/classification-worklist-core";
import {
  classificationBadgeLabel,
  describeClassificationGap,
} from "@/lib/inventory/classification-status-core";
import { LOW_THC_UNIT_MAX_MG } from "@/lib/compliance/sales-limits-core";
// SLICE 18B — the shop facet's labels + deep links, so the back office and the
// customer menu speak with one vocabulary and link to one place.
import {
  CLASSIFICATION_FILTER_LABELS,
  classificationShopHref,
} from "@/lib/menu/menu-classification-filter-core";

export const dynamic = "force-dynamic";

const SCOPE_TABS: ClassificationWorklistScope[] = [
  "needs_attention",
  "urgent",
  "unconfirmed",
  "settled",
  "all",
];

const SOURCE_TABS: ClassificationWorklistSource[] = ["all", "import", "received"];

export default async function ClassificationWorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; source?: string }>;
}) {
  await requirePermission("inventory.manage");
  const params = await searchParams;
  const filter = parseWorklistFilter({ scope: params.scope, source: params.source });

  const data = await getClassificationWorklist();
  const summary = summarizeWorklist(data.entries, filter.source);
  const rows = filterWorklist(data.entries, filter);

  return (
    <div>
      <AdminPageHeader
        title="Sales-limit classification"
        subtitle="Products whose classification decides which purchase limit the register applies"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Classification" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/*
          HONESTY BANNER. A compliance list that silently under-reports is worse
          than no list, because it manufactures false confidence. If the read did
          not provably finish, say so ABOVE the numbers — never let a partial
          scan be read as an all-clear.
        */}
        {!data.complete && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
            <strong className="font-semibold">
              This list is incomplete — do not read it as an all-clear.
            </strong>
            <span className="mt-1 block text-xs">
              {data.incompleteMessage ??
                "The inventory read did not finish, so some products may be missing from the counts below."}
            </span>
          </div>
        )}

        <HelpPanel
          id="classification-worklist"
          title="What this page is for"
          steps={[
            "Two product types leave their normal purchase limit: low-THC beverages (their own 200 mg THC limit) and products otherwise taken into the body, i.e. suppositories (their own 10-unit limit).",
            "Neither can be worked out from the category alone — one shelf holds both skin balms and suppositories — so a person has to say which is which.",
            "Products received through intake are asked at Product Onboarding. Products from the original Cultivera import were never asked, so they are listed here.",
            "Red rows are urgent: leaving them unanswered sells MORE than the law allows. Amber rows are safe but may be selling short of what the law permits.",
            "Click Classify to open the product and record the answer.",
          ]}
        >
          Answers are stored on the published menu row, which is the surface the
          register actually enforces from &mdash; so an answer recorded here takes
          effect at the till, not just on this screen.
        </HelpPanel>

        {/* Headline counts. These follow the SOURCE filter but ignore the scope
            filter, so switching to "Classified" never prints a false "0 urgent". */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Urgent"
            value={String(summary.urgent)}
            hint="selling under a looser limit than the law allows"
            accent={summary.urgent > 0 ? "orange" : "green"}
          />
          <StatCard
            label="Unconfirmed"
            value={String(summary.unconfirmed)}
            hint="safe, but may be selling short"
            accent={summary.unconfirmed > 0 ? "gold" : "green"}
          />
          <StatCard
            label="Classified"
            value={String(summary.settled)}
            hint="a person has answered every question"
            accent="green"
          />
          <StatCard
            label="In scope"
            value={String(summary.products)}
            hint={`${summary.lots} lot${summary.lots === 1 ? "" : "s"} · ${data.lotsScanned} active lots scanned`}
            accent="muted"
          />
        </div>

        {/* Filters. Both knobs are always present in every href so a bookmarked
            or pasted link states its whole intent (the SLICE 6A lesson). */}
        <Card>
          <div className="space-y-3 p-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                Show
              </span>
              {SCOPE_TABS.map((scope) => (
                <Link
                  key={scope}
                  href={classificationWorklistHref({ scope, source: filter.source })}
                  className={
                    scope === filter.scope
                      ? "rounded-full border border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--admin-accent)]"
                      : "rounded-full border border-[var(--admin-border)] px-3 py-1 text-xs text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
                  }
                >
                  {worklistScopeLabel(scope)}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                Source
              </span>
              {SOURCE_TABS.map((source) => (
                <Link
                  key={source}
                  href={classificationWorklistHref({ scope: filter.scope, source })}
                  className={
                    source === filter.source
                      ? "rounded-full border border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--admin-accent)]"
                      : "rounded-full border border-[var(--admin-border)] px-3 py-1 text-xs text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
                  }
                >
                  {worklistSourceLabel(source)}
                </Link>
              ))}
            </div>
            {/*
              The source filter is a VIEW, not the definition of the list. Say so
              out loud: the natural assumption is that this backlog is "the
              Cultivera products", and building it that way would make the first
              received suppository invisible to the very list meant to catch it.
            */}
            <p className="text-xs text-[var(--admin-muted)]">
              This list covers every product in active inventory, whichever door it
              came through. The source filter narrows the view only.
            </p>
          </div>
        </Card>

        <Card>
          <div className="p-1">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--admin-text)]">
                {worklistScopeLabel(filter.scope)}
                <span className="ml-2 font-normal text-[var(--admin-muted)]">
                  {rows.length} product{rows.length === 1 ? "" : "s"}
                </span>
              </h3>
              <Badge tone="outline">
                WAC 314-55-095(1)(d)(i)(D)&ndash;(F) &middot; {LOW_THC_UNIT_MAX_MG} mg per unit
              </Badge>
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--admin-muted)]">
                {emptyWorklistMessage(filter)}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-[var(--admin-muted)]">
                      <th className="py-2 pr-4 font-semibold">Product</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      <th className="py-2 pr-4 font-semibold">What is missing</th>
                      <th className="py-2 pr-4 font-semibold">Stock</th>
                      <th className="py-2 pr-4 font-semibold">On the website</th>
                      <th className="py-2 font-semibold">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const badge = classificationBadgeLabel(row.status);
                      const tone = row.status.settled
                        ? "text-[var(--admin-accent)]"
                        : row.status.urgent
                          ? "text-[var(--admin-danger)]"
                          : "text-[var(--admin-warning,#b45309)]";
                      return (
                        <tr
                          key={row.posProductKey}
                          className="border-b border-[var(--admin-border)]/60 align-top"
                        >
                          <td className="py-2.5 pr-4">
                            <span className="font-medium text-[var(--admin-text)]">
                              {row.productName}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--admin-muted)]">
                              {row.resolvedWebsiteCategory ?? "uncategorised"}
                              {row.inventoryType ? ` · ${row.inventoryType}` : ""}
                              {row.allFromImport ? " · Cultivera import" : ""}
                            </span>
                          </td>
                          <td className={`py-2.5 pr-4 text-xs font-semibold ${tone}`}>{badge}</td>
                          <td className="py-2.5 pr-4 text-xs text-[var(--admin-muted)]">
                            {/* `status.settled`, NOT a local `reasons.length === 0`.
                                The two look interchangeable here only because
                                these rows are already filtered to in-scope
                                products; writing the predicate out again would
                                be a second definition of "settled" on the page,
                                free to drift from the core's. That is precisely
                                the SLICE 6A defect (a count computed one way, a
                                filter another) and the plumbing test forbids it. */}
                            {row.status.settled ? (
                              <span>Nothing — a person has answered every question.</span>
                            ) : (
                              <ul className="space-y-1">
                                {row.status.reasons.map((reason) => (
                                  <li key={reason}>{describeClassificationGap(reason)}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-[var(--admin-muted)]">
                            {row.onHandTotal} on hand
                            <span className="mt-0.5 block">
                              {row.lotCount} lot{row.lotCount === 1 ? "" : "s"}
                            </span>
                          </td>
                          {/* SLICE 18B — where the CUSTOMER sees this product.
                              `shopLane` is computed with the same predicates as
                              the shop facet and the register's limit meter, so
                              this column can never promise a lane the website
                              would not actually render. A product whose flags
                              are set but whose figures do not qualify shows the
                              honest dash, which is exactly the signal the owner
                              needs that his edit did not take effect. */}
                          <td className="py-2.5 pr-4 text-xs">
                            {row.shopLane ? (
                              <Link
                                href={classificationShopHref(row.shopLane)}
                                className="font-semibold text-[var(--admin-accent)] underline underline-offset-2"
                              >
                                {CLASSIFICATION_FILTER_LABELS[row.shopLane]}
                              </Link>
                            ) : (
                              <span className="text-[var(--admin-muted)]">
                                &mdash; not in a filter lane
                              </span>
                            )}
                          </td>
                          <td className="py-2.5">
                            <Link
                              href={`/admin/inventory/${row.representativeLotId}#classification`}
                              className="whitespace-nowrap rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-accent)]"
                            >
                              {row.status.settled ? "Review →" : "Classify →"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
