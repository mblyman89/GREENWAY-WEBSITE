/**
 * /admin/knowledge-base/harvest — the Harvest Console (Slice H4).
 *
 * "Crawler live on the KB page? — yes, but as a Harvest Console, not a
 * button." One place to:
 *   • see worker status and LIVE job progress (poll via /api/admin/harvest),
 *   • queue batch harvests from your real target lists — current vendors
 *     (Tier 1) and discovery vendor leads (Tier 2) that have websites,
 *   • read the coverage heatmap: every vendor graded against the seven
 *     target fields (vendor data/logo, brand data/logo, product types,
 *     descriptions, images). Worst-first — the top of the table IS the
 *     harvest queue.
 *
 * Drafts-only: jobs write pending drafts reviewed on the vendor pages and
 * the review queues. Nothing publishes from here.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { HelpPanel } from "@/components/admin/ux/HelpPanel";
import { KbFlash } from "../KbFlash";
import { listVendors } from "@/lib/vendors/store";
import { listVendorLeads } from "@/lib/discovery/store";
import { computeHarvestCoverage, COVERAGE_COLUMNS } from "@/lib/kb/harvest-coverage";
import { isCrawlerConfigured, crawlerHealth } from "@/lib/ai/crawler-client";
import { HarvestJobsLive } from "@/components/admin/kb/HarvestJobsLive";
import { startHarvestAction, cancelHarvestAction, resumeHarvestAction } from "./actions";

export const dynamic = "force-dynamic";

function heatColor(v: number): string {
  if (v >= 0.999) return "bg-[#7ed957]/80";
  if (v >= 0.5) return "bg-[#7ed957]/35";
  if (v > 0) return "bg-[#ffd700]/30";
  return "bg-red-500/25";
}

export default async function HarvestConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { msg, error } = await searchParams;

  const crawlerOn = isCrawlerConfigured();
  const [health, vendors, leads, coverage] = await Promise.all([
    crawlerOn ? crawlerHealth() : Promise.resolve({ ok: false, detail: "not configured" }),
    listVendors(),
    listVendorLeads({ limit: 500 }),
    computeHarvestCoverage(),
  ]);

  const vendorTargets = vendors.filter((v) => v.website && /^https?:\/\//i.test(v.website));
  const leadTargets = leads.filter(
    (l) => l.website && /^https?:\/\//i.test(l.website) && !l.matched_vendor_id && l.status !== "dismissed",
  );
  const scoreByVendor = new Map(coverage.map((c) => [c.vendorId, c.score]));
  // Worst coverage first — same ordering as the heatmap, so the default
  // checkbox order already prioritizes the vendors that need harvesting most.
  const sortedVendorTargets = [...vendorTargets].sort(
    (a, b) => (scoreByVendor.get(a.id) ?? 0) - (scoreByVendor.get(b.id) ?? 0),
  );

  return (
    <div>
      <AdminPageHeader
        title="Harvest Console"
        subtitle="Batch-research vendor & prospect websites into reviewable drafts — the KB flywheel"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Harvest Console" },
            ]}
          />
        }
        help={
          <HelpPanel id="harvest-help" title="How harvesting works">
            <p>
              Pick targets below and start a job. The crawler on your VM visits each site politely
              (robots.txt, rate limits), extracts what the pages <strong>actually say</strong>, verifies it,
              compliance-checks it, and files everything as <strong>pending drafts</strong> — text on the
              vendor pages, logos & images as visual picks. Nothing publishes without your click.
            </p>
            <p className="mt-2">
              <strong>Tiers set the depth:</strong> Tier 1 reads up to ~25 pages per site (your current
              vendors deserve rich profiles), Tier 2 ~10 (prospects), Tier 3 ~3 pages with a one-minute
              pause between sites (whole-market background trickle).
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8 space-y-8">
        <KbFlash msg={msg} error={error} />

        {/* Worker status */}
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            health.ok
              ? "border-[#7ed957]/40 bg-[#7ed957]/5 text-[#7ed957]"
              : "border-[#ffd700]/40 bg-[#ffd700]/5 text-[#ffd700]"
          }`}
        >
          {health.ok
            ? "Crawler worker is online."
            : crawlerOn
              ? `Crawler worker is unreachable (${health.detail}). Is uvicorn running on the VM?`
              : "Crawler isn't configured — set CRAWLER_BASE_URL + CRAWLER_SHARED_SECRET to enable harvesting."}
        </div>

        {/* Live jobs */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">Jobs</h2>
          <HarvestJobsLive cancelAction={cancelHarvestAction} resumeAction={resumeHarvestAction} />
        </section>

        {/* Start a harvest */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">Start a harvest</h2>
          <form action={startHarvestAction} className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-white/60" htmlFor="tier">
                Depth
              </label>
              <select
                id="tier"
                name="tier"
                defaultValue="1"
                className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              >
                <option value="1">Tier 1 — deep (~25 pages/site) · current vendors</option>
                <option value="2">Tier 2 — medium (~10 pages/site) · prospects</option>
                <option value="3">Tier 3 — shallow trickle (~3 pages/site, 60s between sites)</option>
              </select>
              <button
                type="submit"
                className="ml-auto rounded-full bg-[#7ed957] px-5 py-2 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                disabled={!crawlerOn}
              >
                ⛏ Start harvest
              </button>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* Current vendors */}
              <div>
                <p className="mb-2 text-[11px] font-semibold text-white/60">
                  Current vendors with websites ({vendorTargets.length}) — worst coverage first
                </p>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2">
                  {sortedVendorTargets.length === 0 && (
                    <p className="p-2 text-[11px] text-white/40">
                      No vendors have a website on file yet — add websites on the Vendors page.
                    </p>
                  )}
                  {sortedVendorTargets.map((v) => (
                    <label
                      key={v.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-white/80 hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        name="target"
                        value={`vendor|${v.id}|${v.website}|${v.display_name}`}
                        className="accent-[#7ed957]"
                      />
                      <span className="flex-1 truncate">{v.display_name}</span>
                      <span className="text-[10px] tabular-nums text-white/40">
                        {(scoreByVendor.get(v.id) ?? 0).toFixed(1)}/7
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Prospect leads */}
              <div>
                <p className="mb-2 text-[11px] font-semibold text-white/60">
                  Discovery leads with websites ({leadTargets.length}) — drafts stay dark until promoted
                </p>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2">
                  {leadTargets.length === 0 && (
                    <p className="p-2 text-[11px] text-white/40">
                      No unmatched leads with websites — import/refresh leads on the Discovery page.
                    </p>
                  )}
                  {leadTargets.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-white/80 hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        name="target"
                        value={`vendor|lead:${l.id}|${l.website}|${l.display_name}`}
                        className="accent-[#5ec1ff]"
                      />
                      <span className="flex-1 truncate">{l.display_name}</span>
                      <span className="text-[10px] text-white/40">{l.city ?? ""}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-white/35">
                  Lead drafts are keyed to the lead (not a vendor), so they wait quietly until you promote
                  the lead — reviewer attention only goes to vendors that matter.
                </p>
              </div>
            </div>
          </form>
        </section>

        {/* Coverage heatmap */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
            Coverage — the seven target fields (worst first)
          </h2>
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0a0a0a]">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-white/40">
                  <th className="px-3 py-2">Vendor</th>
                  {COVERAGE_COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-center">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {coverage.slice(0, 100).map((row) => (
                  <tr key={row.vendorId} className="border-b border-white/5">
                    <td className="max-w-[220px] truncate px-3 py-1.5 text-white/85" title={row.displayName}>
                      <a href={`/admin/vendors/${row.vendorId}`} className="hover:text-[#7ed957]">
                        {row.displayName}
                      </a>
                    </td>
                    {COVERAGE_COLUMNS.map((c) => {
                      const cell = row.cells[c.key];
                      return (
                        <td key={c.key} className="px-2 py-1.5 text-center">
                          <span
                            className={`inline-block h-4 w-8 rounded ${heatColor(cell.value)}`}
                            title={`${c.label}: ${cell.detail}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums text-white/70">{row.score.toFixed(1)}/7</td>
                  </tr>
                ))}
                {coverage.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-white/40">
                      No vendors yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {coverage.length > 100 && (
            <p className="text-[10px] text-white/35">Showing the 100 vendors with the thinnest coverage.</p>
          )}
        </section>
      </div>
    </div>
  );
}
