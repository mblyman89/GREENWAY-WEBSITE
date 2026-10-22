/**
 * CultiveraManifestTable  (R50 S10a, owner follow-up #5)
 *
 * The Receiving table's "Cultivera manifests" view: every manifest rebuilt
 * from the Cultivera export, one row each, with a Complete / Needs attention
 * badge from its onboarding (receiving-table-core.cultiveraCompletion).
 *
 *   Manifest # | Vendor | Source | Received | Lots | Onboarding | Open
 *
 * R74 S11: a Source column + chips (transfer match / emailed manifest /
 * unmatched catch-all / received-date group), and "Group by vendor", which
 * rolls every filtered manifest up into one line per vendor with a link to
 * that vendor's manifests here and on Product Onboarding.
 *
 * Each row opens the SAME manifest page a delivery opens
 * (/admin/inventory/intake/<id>), and links to that manifest's products on
 * Product Onboarding, where Start / approve happen.
 *
 * Presentational server component; all logic is in receiving-table-core.
 */
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/admin/ui";
import { draftsForManifestHref } from "@/lib/catalog/draft-deep-link-core";
import {
  COMPLETION_LABEL,
  receivingHref,
  type CultiveraCompletion,
  type CultiveraSummary,
  type CultiveraTableRow,
  type ReceivingFilters,
} from "@/lib/inventory/receiving-table-core";
import type { ReceivingCultiveraLoad } from "@/lib/inventory/receiving-cultivera-store";
import {
  SOURCE_FILTERS,
  SOURCE_HELP,
  SOURCE_LABEL,
  type CultiveraSource,
  type VendorRollup,
} from "@/lib/inventory/cultivera-vendor-core";
import type { SourceCounts } from "@/lib/inventory/receiving-table-core";

const SOURCE_TONE: Record<CultiveraSource, BadgeTone> = {
  transfer: "green",
  email: "outline",
  unmatched: "gold",
  received: "neutral",
  unknown: "neutral",
};

/** Product Onboarding, scrolled to one vendor's Cultivera manifests. */
export function onboardingVendorHref(vendor: string): string {
  return `/admin/inventory/drafts?cv_vendor=${encodeURIComponent(vendor)}#cultivera-vendor`;
}

const TONE: Record<CultiveraCompletion, BadgeTone> = {
  complete: "green",
  not_complete: "gold",
  unknown: "neutral",
};

const ICON: Record<CultiveraCompletion, string> = {
  complete: "\u2705",
  not_complete: "\u26a0\ufe0f",
  unknown: "\u2754",
};

export const CULTIVERA_TABLE_HELP =
  "Every manifest rebuilt from the Cultivera export. Complete means every product on it went through Product Onboarding (approved or dismissed). Needs attention means it has not been started, or some products are still waiting in review. These products are already on the menu and can be sold while you work through them; nothing here changes stock, prices or the live menu.";

export function CultiveraManifestTable({
  load,
  rows,
  summary,
  sources = null,
  vendorGroups = null,
  filters,
  page,
  pageCount,
}: {
  load: ReceivingCultiveraLoad | null;
  rows: readonly CultiveraTableRow[];
  summary: CultiveraSummary | null;
  sources?: SourceCounts | null;
  vendorGroups?: readonly VendorRollup[] | null;
  filters: ReceivingFilters;
  page: number;
  pageCount: number;
}) {
  return (
    <div
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface)]"
      data-testid="cultivera-receiving-table"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--admin-border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-[var(--admin-text)]">
            Cultivera manifests <span className="text-[var(--admin-accent)]">(moved from Cultivera)</span>
          </h2>
          <p className="text-xs text-[var(--admin-text-muted)]">{CULTIVERA_TABLE_HELP}</p>
        </div>
        {summary ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs" data-testid="cultivera-receiving-summary">
            <Link
              href={receivingHref(filters, { status: "not_complete" })}
              className="rounded border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-2 py-1 font-semibold text-[var(--admin-gold)] hover:brightness-105"
              title="Show only the manifests that still need attention"
            >
              {ICON.not_complete} {summary.notComplete.toLocaleString("en-US")} need attention
            </Link>
            <Link
              href={receivingHref(filters, { status: "complete" })}
              className="rounded border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-2 py-1 font-semibold text-[var(--admin-accent)] hover:brightness-105"
              title="Show only the manifests whose onboarding is finished"
            >
              {ICON.complete} {summary.complete.toLocaleString("en-US")} complete
            </Link>
            {summary.unknown > 0 ? (
              <span className="rounded border border-[var(--admin-border)] px-2 py-1 text-[var(--admin-text-muted)]">
                {ICON.unknown} {summary.unknown.toLocaleString("en-US")} unknown
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {sources && load && load.ok && load.rows.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-[var(--admin-border)] px-4 py-2 text-xs"
          data-testid="cultivera-source-chips"
        >
          <span className="font-semibold text-[var(--admin-text-faint)]">Source:</span>
          <Link
            href={receivingHref(filters, { source: "" })}
            aria-current={filters.source === "" ? "true" : undefined}
            className={`rounded border px-2 py-0.5 ${filters.source === "" ? "border-[var(--admin-accent)] text-[var(--admin-accent)]" : "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}`}
          >
            Any
          </Link>
          {SOURCE_FILTERS.filter((f) => sources[f.value] > 0 || filters.source === f.value).map((f) => (
            <Link
              key={f.value}
              href={receivingHref(filters, { source: f.value })}
              title={SOURCE_HELP[f.value]}
              data-testid={`cultivera-source-chip-${f.value}`}
              aria-current={filters.source === f.value ? "true" : undefined}
              className={`rounded border px-2 py-0.5 ${filters.source === f.value ? "border-[var(--admin-accent)] text-[var(--admin-accent)]" : "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}`}
            >
              {f.label} ({sources[f.value].toLocaleString("en-US")})
            </Link>
          ))}
          <span className="ml-auto">
            {filters.group === "vendor" ? (
              <Link
                href={receivingHref(filters, { group: "" })}
                className="rounded border border-[var(--admin-accent)] px-2 py-0.5 font-semibold text-[var(--admin-accent)]"
                data-testid="cultivera-group-toggle"
              >
                {"\u2190"} Back to one row per manifest
              </Link>
            ) : (
              <Link
                href={receivingHref(filters, { group: "vendor" })}
                className="rounded border border-[var(--admin-border)] px-2 py-0.5 font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
                data-testid="cultivera-group-toggle"
                title="Roll every manifest that matches these filters up into one line per vendor"
              >
                Group by vendor
              </Link>
            )}
          </span>
        </div>
      ) : null}

      {load === null ? null : !load.ok ? (
        <div className="px-4 py-6 text-sm text-[var(--admin-danger)]" data-testid="cultivera-receiving-error">
          The Cultivera manifests could not be read: {load.error}. Nothing was changed. Refresh to try again.
        </div>
      ) : (
        <>
          {!load.tallyRead ? (
            <p className="border-b border-[var(--admin-border)] px-4 py-2 text-xs text-[var(--admin-gold)]" data-testid="cultivera-receiving-tally-error">
              The onboarding counts could not be read, so every row says Unknown instead of guessing. Refresh to try
              again.
            </p>
          ) : null}
          {load.truncated ? (
            <p className="border-b border-[var(--admin-border)] px-4 py-2 text-xs text-[var(--admin-gold)]">
              Only the first 20,000 rebuilt manifests were read.
            </p>
          ) : null}
          {vendorGroups ? (
            vendorGroups.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--admin-text-faint)]" data-testid="cultivera-vendor-empty">
                No Cultivera manifests match these filters. Clear them to see every vendor.
              </div>
            ) : (
              <div className="overflow-x-auto" data-testid="cultivera-vendor-groups">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <tr>
                      <th className="px-4 py-3">Vendor</th>
                      <th className="px-4 py-3 text-right">Manifests</th>
                      <th className="px-4 py-3 text-right">Lots</th>
                      <th className="px-4 py-3 text-right" title="Manifests not started yet">Not started</th>
                      <th className="px-4 py-3 text-right" title="Manifests with products still waiting in review">In review</th>
                      <th className="px-4 py-3 text-right" title="Manifests whose every product was approved or dismissed">Complete</th>
                      <th className="px-4 py-3 text-right">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--admin-border)]">
                    {vendorGroups.map((g) => (
                      <tr key={g.key || "unknown"} data-testid="cultivera-vendor-group" data-vendor={g.vendor}>
                        <td className="px-4 py-3 font-medium text-[var(--admin-text)]">
                          {g.key ? (
                            <Link href={receivingHref(filters, { vendor: g.vendor, group: "" })} className="hover:text-[var(--admin-accent)]">
                              {g.vendor}
                            </Link>
                          ) : (
                            g.vendor
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{g.manifests.toLocaleString("en-US")}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">{g.lots.toLocaleString("en-US")}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">{g.notStarted.toLocaleString("en-US")}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">{g.inReview.toLocaleString("en-US")}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                          {g.done.toLocaleString("en-US")}
                          {g.unknown > 0 ? <span className="ml-1 text-[var(--admin-text-faint)]">({g.unknown} unknown)</span> : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-3 text-xs">
                            {g.key ? (
                              <Link
                                href={receivingHref(filters, { vendor: g.vendor, group: "" })}
                                className="text-[var(--admin-accent)] hover:underline"
                              >
                                Manifests
                              </Link>
                            ) : null}
                            {g.key ? (
                              <Link
                                href={onboardingVendorHref(g.vendor)}
                                className="rounded border border-[var(--admin-border)] px-2 py-1 font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
                                data-testid="cultivera-vendor-onboard-link"
                                title="Start every manifest from this vendor and look up all its products with Gemini"
                              >
                                Onboard vendor
                              </Link>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[var(--admin-text-faint)]" data-testid="cultivera-receiving-empty">
              {load.rows.length === 0
                ? "No manifests have been rebuilt from Cultivera yet. They appear here after Menu Imports \u2192 Rebuild Cultivera manifests."
                : "No Cultivera manifests match these filters. Clear them to see the whole list."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">Manifest #</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="cursor-help px-4 py-3" title="How this manifest was rebuilt: matched to a Cultivera transfer, from an emailed manifest, the one unmatched catch-all, or grouped by received date.">
                      Source
                    </th>
                    <th className="cursor-help px-4 py-3" title="The day Cultivera accepted the transfer (or its transfer day when no time was recorded).">
                      Received
                    </th>
                    <th className="px-4 py-3 text-right">Lots</th>
                    <th className="cursor-help px-4 py-3 text-center" title="Complete = every product on it was approved or dismissed in Product Onboarding.">
                      Onboarding
                    </th>
                    <th className="px-4 py-3 text-right">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      data-testid="cultivera-receiving-row"
                      data-completion={r.completion}
                      className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/inventory/intake/${r.id}`}
                          className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                          title="Open this manifest (the same page a delivery opens)"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{r.vendor}</td>
                      <td className="px-4 py-3" data-testid="cultivera-row-source" data-source={r.source}>
                        <Badge tone={SOURCE_TONE[r.source]}>
                          <span title={SOURCE_HELP[r.source]}>{SOURCE_LABEL[r.source]}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{r.day ?? "\u2014"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                        {r.lots === null ? "\u2014" : r.lots.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge tone={TONE[r.completion]}>
                          <span title={r.stateLabel}>
                            {ICON[r.completion]} {COMPLETION_LABEL[r.completion]}
                          </span>
                        </Badge>
                        {r.completion !== "unknown" ? (
                          <div className="mt-1 text-[0.7rem] text-[var(--admin-text-faint)]">{r.stateLabel}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-3 text-xs">
                          <Link
                            href={draftsForManifestHref(r.id)}
                            className="text-[var(--admin-accent)] hover:underline"
                            title={
                              r.completion === "complete"
                                ? "See this manifest's products in Product Onboarding"
                                : "Start or continue this manifest's onboarding"
                            }
                          >
                            {r.completion === "complete" ? "Products" : r.state === "not_started" ? "Start onboarding" : "Continue onboarding"}
                          </Link>
                          <Link
                            href={`/admin/inventory/intake/${r.id}`}
                            className="rounded border border-[var(--admin-border)] px-2 py-1 font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
                          >
                            Open
                          </Link>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pageCount > 1 && !vendorGroups ? (
            <nav
              className="flex items-center justify-between gap-3 border-t border-[var(--admin-border)] px-4 py-2 text-xs text-[var(--admin-text-muted)]"
              aria-label="Cultivera manifest pages"
            >
              {page > 1 ? (
                <Link href={receivingHref(filters, { page: page - 1 })} className="font-semibold hover:text-[var(--admin-accent)]">
                  {"\u2190"} Previous
                </Link>
              ) : (
                <span />
              )}
              <span>
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={receivingHref(filters, { page: page + 1 })} className="font-semibold hover:text-[var(--admin-accent)]">
                  Next {"\u2192"}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
