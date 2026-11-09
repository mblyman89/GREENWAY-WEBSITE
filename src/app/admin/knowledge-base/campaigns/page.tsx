/**
 * /admin/knowledge-base/campaigns — Crawl Campaigns board (D220 S6).
 *
 * Owner: "make the new vendor crawler so much more amazing … as much detail
 * as possible for our vendor profiles … tag and label and catalog everything
 * so it is easy to match images to product cards."
 *
 * One button crawls every vendor we have stock from, SLICE BY SLICE, until
 * each site is completely read (or hits the per-site cap). Every page is
 * classified, every image tagged (and AI-labelled), and images are matched to
 * the vendor's product cards for one-click confirmation in the Image Catalog.
 * Progress is durable (kb_crawl_* tables), survives redeploys, and resumes.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button } from "@/components/admin/ui";
import { HelpPanel } from "@/components/admin/ux/HelpPanel";
import { FetchRunAutoRefresh } from "@/components/admin/catalog/FetchRunAutoRefresh";
import { KbFlash } from "../KbFlash";
import { isCrawlerConfigured, crawlerHealth } from "@/lib/ai/crawler-client";
import { listCampaigns, listCampaignSites, planCurrentVendorHarvest } from "@/lib/kb/crawl-campaigns";
import { campaignProgress, siteProgress, SITE_PHASE, type SiteRow } from "@/lib/kb/crawl-campaigns-core";
import { CampaignTabs, MigrationNote } from "./CampaignTabs";
import {
  cancelCampaignAction,
  harvestAllCurrentVendorsAction,
  rematchSiteAction,
  resumeCampaignAction,
  startCustomCampaignAction,
} from "./actions";

export const dynamic = "force-dynamic";

const ACTIVE = new Set(["queued", "running", "paused"]);

function tone(status: string): "green" | "gold" | "orange" | "danger" | "neutral" {
  if (status === "complete" || status === "completed") return "green";
  if (status === "partial") return "gold";
  if (status === "failed") return "danger";
  if (status === "running" || status === "analyzing") return "orange";
  return "neutral";
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172_800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-[var(--admin-accent)]" style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; show?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { msg, error, show } = await searchParams;
  const crawlerOn = isCrawlerConfigured();
  const [health, camps, plan] = await Promise.all([
    crawlerOn ? crawlerHealth() : Promise.resolve({ ok: false, detail: "not configured" }),
    listCampaigns(show === "all" ? 100 : 15),
    planCurrentVendorHarvest(),
  ]);
  const sites = await listCampaignSites(camps.campaigns.map((c) => c.id));
  const sitesBy = new Map<string, typeof sites>();
  for (const s of sites) {
    if (!sitesBy.has(s.campaign_id)) sitesBy.set(s.campaign_id, []);
    sitesBy.get(s.campaign_id)!.push(s);
  }
  const anyActive = camps.campaigns.some((c) => ACTIVE.has(c.status));

  return (
    <div>
      <FetchRunAutoRefresh active={anyActive} everyMs={6000} />
      <AdminPageHeader
        title="Crawl Campaigns"
        subtitle="Crawl every vendor site until it's completely read — every page catalogued, every image tagged and matched to product cards"
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Knowledge Base", href: "/admin/knowledge-base" }, { label: "Crawl Campaigns" }]} />
        }
        help={
          <HelpPanel id="campaign-help" title="How campaigns work">
            <p>
              A campaign crawls each site in <strong>slices</strong> (a few dozen pages at a time), saving the
              to-do list of unread pages after every slice. If the worker restarts, the campaign picks up exactly
              where it stopped — no page is read twice. A site is <strong>Complete</strong> when there is nothing
              left to read, or <strong>Partial</strong> when it hits the per-site page cap.
            </p>
            <p className="mt-2">
              Shopify and WooCommerce stores are read through their product feeds first (every product, every
              photo), then the crawler reads the rest of the site. After crawling, the AI reads product pages for
              facts and looks at product photos to label them (product shot, packaging, logo…, plus the strain,
              size and printed text). Images are then matched to the vendor&apos;s product cards — you confirm
              matches in the <a className="underline" href="/admin/knowledge-base/campaigns/images">Image catalog</a>.
              Text findings land as pending drafts on the vendor page as before. Nothing publishes on its own.
            </p>
          </HelpPanel>
        }
      />
      <div className="space-y-8 px-5 py-6 sm:px-8">
        <CampaignTabs active="board" />
        <KbFlash msg={msg} error={error} />
        {!camps.ready && <MigrationNote />}
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            health.ok
              ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/5 text-[var(--admin-accent)]"
              : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/5 text-[var(--admin-gold)]"
          }`}
        >
          {health.ok
            ? "Crawler worker is online."
            : crawlerOn
              ? `Crawler worker is unreachable (${health.detail}). Check the Railway service.`
              : "Crawler isn't configured — set CRAWLER_BASE_URL + CRAWLER_SHARED_SECRET."}
        </div>

        {/* The one button */}
        <section className="rounded-xl border border-[var(--admin-accent)]/30 bg-[#0a0a0a] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-1">
              <h2 className="text-base font-bold text-white">⛏ Harvest all current vendors</h2>
              <p className="text-xs text-white/60">
                {plan.stockedVendors} vendors have stock on hand. <strong className="text-white">{plan.targets.length}</strong>{" "}
                have a website and will be crawled until complete
                {plan.sharedHost.length > 0 ? ` (${plan.sharedHost.length} share a website with another vendor and ride along)` : ""}.
                {plan.needWebsite.length > 0 && (
                  <>
                    {" "}
                    <a className="text-[var(--admin-gold)] underline" href="/admin/knowledge-base/campaigns/websites">
                      {plan.needWebsite.length} have no website yet — find them →
                    </a>
                  </>
                )}
              </p>
            </div>
            <form action={harvestAllCurrentVendorsAction} className="flex flex-wrap items-center gap-3 text-xs text-white/70">
              <label className="flex items-center gap-1.5">
                <input type="hidden" name="vision" value="false" />
                <input type="checkbox" name="vision" value="true" defaultChecked className="accent-[var(--admin-accent)]" />
                AI image labels
              </label>
              <label className="flex items-center gap-1.5">
                <input type="hidden" name="page_ai" value="false" />
                <input type="checkbox" name="page_ai" value="true" defaultChecked className="accent-[var(--admin-accent)]" />
                AI page facts
              </label>
              <label className="flex items-center gap-1.5">
                Sites at once
                <select name="parallel_sites" defaultValue="" className="rounded border border-white/15 bg-black px-2 py-1">
                  <option value="">default</option>
                  {[1, 2, 3, 4, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Page cap / site
                <select name="max_pages_per_site" defaultValue="" className="rounded border border-white/15 bg-black px-2 py-1">
                  <option value="">default</option>
                  {[250, 500, 1000, 2000, 5000].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="special" size="md" disabled={!crawlerOn || !camps.ready || plan.targets.length === 0}>
                ⛏ Harvest {plan.targets.length} vendors
              </Button>
            </form>
          </div>
          {plan.targets.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[11px] text-white/50">
                …or crawl just some of them
              </summary>
              <form action={startCustomCampaignAction} className="mt-3 space-y-3">
                <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {plan.targets.map((t) => (
                    <label key={t.entity_id} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-white/80 hover:bg-white/5">
                      <input type="checkbox" name="vendor" value={t.entity_id} className="accent-[var(--admin-accent)]" />
                      <span className="truncate">{t.display_name}</span>
                      <span className="ml-auto truncate text-[10px] text-white/35">{new URL(t.url).hostname}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    name="label"
                    placeholder="Label (optional)"
                    className="rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white"
                  />
                  <Button type="submit" variant="special" size="sm" disabled={!crawlerOn || !camps.ready}>
                    Crawl selected
                  </Button>
                </div>
              </form>
            </details>
          )}
        </section>

        {/* Campaign list */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">Campaigns</h2>
            <a href={show === "all" ? "?" : "?show=all"} className="text-[11px] text-white/50 underline">
              {show === "all" ? "Show recent" : "Show all"}
            </a>
          </div>
          {camps.ready && camps.campaigns.length === 0 && (
            <p className="text-sm text-white/50">No campaigns yet — press the button above.</p>
          )}
          {camps.campaigns.map((c) => {
            const cs = sitesBy.get(c.id) ?? [];
            const prog = campaignProgress(cs as SiteRow[]);
            const totals = cs.reduce(
              (a, s) => ({
                pages: a.pages + (s.pages_read ?? 0),
                images: a.images + (s.images_found ?? 0),
                tagged: a.tagged + (s.images_tagged ?? 0),
                matched: a.matched + (s.images_matched ?? 0),
                products: a.products + (s.products_found ?? 0),
                drafts: a.drafts + (s.drafts_written ?? 0),
              }),
              { pages: 0, images: 0, tagged: 0, matched: 0, products: 0, drafts: 0 },
            );
            const usage = c.ai_usage as {
              calls?: number;
              input_tokens?: number;
              output_tokens?: number;
              images?: number;
              web_searches?: number;
            };
            const isActive = ACTIVE.has(c.status);
            return (
              <details key={c.id} open={isActive} className="rounded-xl border border-white/10 bg-[#0a0a0a]">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-4">
                  <Badge tone={tone(c.status)}>{c.status}</Badge>
                  <span className="text-sm font-semibold text-white">{c.label}</span>
                  <span className="text-[11px] text-white/40">started {ago(c.started_at ?? c.created_at)}</span>
                  {isActive && (
                    <span className="text-[11px] text-white/40">· heartbeat {ago(c.worker_heartbeat_at)}</span>
                  )}
                  <span className="ml-auto text-[11px] tabular-nums text-white/60">
                    {prog.done}/{prog.total} sites · {totals.pages.toLocaleString()} pages · {totals.images.toLocaleString()} images ·{" "}
                    {totals.matched.toLocaleString()} matched
                  </span>
                  <div className="w-full">
                    <Bar pct={prog.pct} />
                  </div>
                </summary>
                <div className="space-y-3 border-t border-white/10 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/50">
                    <span>{totals.products.toLocaleString()} products found</span>
                    <span>· {totals.tagged.toLocaleString()} images AI-labelled</span>
                    <span>· {totals.drafts.toLocaleString()} drafts written</span>
                    {usage?.calls ? (
                      <span>
                        · AI: {usage.calls} calls · {(((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)) / 1000).toFixed(0)}k tokens
                        {usage.images ? ` · ${usage.images} images viewed` : ""}
                      </span>
                    ) : null}
                    {c.last_error && <span className="text-red-400">· {c.last_error}</span>}
                    <span className="ml-auto flex gap-2">
                      {isActive ? (
                        <form action={cancelCampaignAction}>
                          <input type="hidden" name="campaignId" value={c.id} />
                          <Button type="submit" variant="neutral" size="sm">
                            ■ Stop
                          </Button>
                        </form>
                      ) : null}
                      {c.status !== "completed" || cs.some((s) => s.status === "failed" || s.status === "cancelled") ? (
                        <form action={resumeCampaignAction}>
                          <input type="hidden" name="campaignId" value={c.id} />
                          <Button type="submit" variant="special" size="sm" disabled={!crawlerOn}>
                            ↻ Resume / retry
                          </Button>
                        </form>
                      ) : null}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wide text-white/35">
                        <tr>
                          <th className="py-1 pr-3">Site</th>
                          <th className="py-1 pr-3">Status</th>
                          <th className="py-1 pr-3 text-right">Pages</th>
                          <th className="py-1 pr-3 text-right">Left</th>
                          <th className="py-1 pr-3 text-right">Images</th>
                          <th className="py-1 pr-3 text-right">Labelled</th>
                          <th className="py-1 pr-3 text-right">Matched</th>
                          <th className="py-1 pr-3 text-right">Products</th>
                          <th className="py-1 pr-3">Coverage</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {cs.map((s) => (
                          <tr key={s.id} className="border-t border-white/5 align-top">
                            <td className="py-2 pr-3">
                              <div className="font-medium text-white">{s.display_name}</div>
                              <a href={s.entry_url} target="_blank" rel="noreferrer" className="text-[10px] text-white/40 hover:underline">
                                {s.host}
                              </a>
                              {s.platform && <span className="ml-1 text-[10px] text-[var(--admin-gold)]">· {s.platform}</span>}
                            </td>
                            <td className="w-40 py-2 pr-3">
                              <Badge tone={tone(s.status)}>{s.status}</Badge>
                              <div className="mt-1 text-[10px] text-white/40">{SITE_PHASE[s.status] ?? s.status}</div>
                              {!["complete", "partial", "failed", "cancelled", "skipped"].includes(s.status) && (
                                <div className="mt-1">
                                  <Bar pct={siteProgress(s)} />
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{s.pages_read}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-white/50">{s.pages_pending}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{s.images_found}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{s.images_tagged}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{s.images_matched}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{s.products_found}</td>
                            <td className="max-w-xs py-2 pr-3 text-[10px] text-white/50">
                              {s.last_error ? <span className="text-red-400">{s.last_error}</span> : s.coverage_assessment ?? s.current_url ?? ""}
                            </td>
                            <td className="whitespace-nowrap py-2 text-right">
                              <a
                                href={`/admin/knowledge-base/campaigns/images?site=${s.id}`}
                                className="mr-2 text-[10px] text-[var(--admin-accent)] underline"
                              >
                                images
                              </a>
                              {s.vendor_id && (
                                <a href={`/admin/vendors/${s.vendor_id}`} className="mr-2 text-[10px] text-white/50 underline">
                                  vendor
                                </a>
                              )}
                              {(s.status === "complete" || s.status === "partial") && (
                                <form action={rematchSiteAction} className="inline">
                                  <input type="hidden" name="siteId" value={s.id} />
                                  <button type="submit" className="text-[10px] text-white/50 underline hover:text-white">
                                    re-match
                                  </button>
                                </form>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            );
          })}
        </section>
      </div>
    </div>
  );
}
