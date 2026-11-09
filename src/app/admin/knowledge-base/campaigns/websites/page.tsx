/**
 * /admin/knowledge-base/campaigns/websites — Website Finder (D220 S6).
 *
 * 107 vendors have stock but only ~30 had a website on file. The finder asks
 * OpenAI web search (falling back to DuckDuckGo) for each vendor's OWN site
 * (never Leafly/Weedmaps/menus/social), then fetches every candidate homepage
 * and verifies it: name in the title, the WSLCB license number on the page,
 * Washington signals, cannabis words, an age gate. A human approves — the
 * approved URL becomes vendors.website and joins the next campaign.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button } from "@/components/admin/ui";
import { KbFlash } from "../../KbFlash";
import { isCrawlerConfigured, listWebsiteFinderJobs, type WebsiteFinderJob } from "@/lib/ai/crawler-client";
import { listWebsiteCandidates, planCurrentVendorHarvest } from "@/lib/kb/crawl-campaigns";
import { CampaignTabs, MigrationNote } from "../CampaignTabs";
import { FetchRunAutoRefresh } from "@/components/admin/catalog/FetchRunAutoRefresh";
import { approveWebsiteAction, findWebsitesAction, rejectWebsiteAction, setWebsiteManuallyAction } from "../actions";

export const dynamic = "force-dynamic";

const VERIFY_TONE: Record<string, "green" | "gold" | "orange" | "danger" | "neutral"> = {
  verified: "green",
  likely: "gold",
  unverified: "neutral",
  mismatch: "danger",
  unreachable: "orange",
  marketplace: "danger",
};

type Ev = {
  title?: string;
  h1?: string;
  name_in_title?: boolean;
  license_found?: boolean;
  wa_signals?: string[];
  cannabis_words?: string[];
  age_gate?: boolean;
  search_reason?: string;
  error?: string;
};

export default async function WebsitesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { msg, error } = await searchParams;
  const crawlerOn = isCrawlerConfigured();
  const [plan, cands, jobs] = await Promise.all([
    planCurrentVendorHarvest(),
    listWebsiteCandidates(["pending"]),
    crawlerOn ? listWebsiteFinderJobs().catch(() => [] as WebsiteFinderJob[]) : Promise.resolve([] as WebsiteFinderJob[]),
  ]);
  const running = jobs.find((j) => j.status === "running");
  const byVendor = new Map<string, typeof cands.rows>();
  for (const c of cands.rows) {
    if (!byVendor.has(c.vendor_id)) byVendor.set(c.vendor_id, []);
    byVendor.get(c.vendor_id)!.push(c);
  }
  const needIds = new Set(plan.needWebsite.map((v) => v.vendor_id));
  const nameOf = new Map(plan.needWebsite.map((v) => [v.vendor_id, v.name]));
  // Vendors with pending candidates first (best confidence first), then those still without any.
  const withCands = [...byVendor.entries()]
    .filter(([vid]) => needIds.has(vid))
    .sort((a, b) => (b[1][0]?.confidence ?? 0) - (a[1][0]?.confidence ?? 0));
  const without = plan.needWebsite.filter((v) => !byVendor.has(v.vendor_id));

  return (
    <div>
      <FetchRunAutoRefresh active={!!running} everyMs={8000} />
      <AdminPageHeader
        title="Find vendor websites"
        subtitle="AI web search + homepage verification for every stocked vendor without a website"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Crawl Campaigns", href: "/admin/knowledge-base/campaigns" },
              { label: "Find websites" },
            ]}
          />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <CampaignTabs active="websites" />
        <KbFlash msg={msg} error={error} />
        {!cands.ready && <MigrationNote />}

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="max-w-2xl text-xs text-white/60">
            <p>
              <strong className="text-white">{plan.needWebsite.length}</strong> of {plan.stockedVendors} stocked vendors have no
              website on file. The finder searches for each one&apos;s <em>own</em> site, opens every candidate and checks it:
              vendor name in the title, their <strong>WSLCB license number</strong> on the page, Washington mentions, cannabis
              words, an age gate. <strong>Verified</strong> = license found or name + WA + cannabis. You approve; nothing changes
              until you do.
            </p>
            {running && (
              <p className="mt-2 text-[var(--admin-accent)]">
                Searching… {running.done}/{running.total} vendors checked · {running.found} with candidates ·{" "}
                {running.verified} verified/likely.
              </p>
            )}
          </div>
          <form action={findWebsitesAction} className="flex items-center gap-3 text-xs text-white/70">
            <label className="flex items-center gap-1.5">
              <input type="hidden" name="use_ai" value="false" />
              <input type="checkbox" name="use_ai" value="true" defaultChecked className="accent-[var(--admin-accent)]" />
              Use OpenAI web search
            </label>
            <Button
              type="submit"
              variant="special"
              size="md"
              disabled={!crawlerOn || !cands.ready || plan.needWebsite.length === 0 || !!running}
            >
              🔎 Find {plan.needWebsite.length} websites
            </Button>
          </form>
        </section>

        {withCands.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
              Candidates to review ({withCands.length} vendors)
            </h2>
            {withCands.map(([vid, list]) => (
              <div key={vid} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <a href={`/admin/vendors/${vid}`} className="text-sm font-semibold text-white hover:underline">
                    {nameOf.get(vid) ?? vid}
                  </a>
                </div>
                <div className="space-y-2">
                  {list.map((c) => {
                    const ev = (c.evidence ?? {}) as Ev;
                    return (
                      <div key={c.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-white/5 bg-black/40 p-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={VERIFY_TONE[c.verify_status] ?? "neutral"}>{c.verify_status}</Badge>
                            <a href={c.url} target="_blank" rel="noreferrer" className="text-sm text-[var(--admin-accent)] hover:underline">
                              {c.host}
                            </a>
                            <span className="text-[10px] tabular-nums text-white/40">
                              {Math.round(c.confidence * 100)}% · via {c.source.replace("_", " ")}
                            </span>
                          </div>
                          {ev.title && <div className="truncate text-[11px] text-white/60">“{ev.title}”</div>}
                          <div className="flex flex-wrap gap-2 text-[10px] text-white/45">
                            {ev.license_found && <span className="text-[var(--admin-accent)]">✓ license # on page</span>}
                            {ev.name_in_title && <span>✓ name in title</span>}
                            {ev.age_gate && <span>✓ 21+ gate</span>}
                            {(ev.wa_signals ?? []).length > 0 && <span>WA: {(ev.wa_signals ?? []).slice(0, 3).join(", ")}</span>}
                            {(ev.cannabis_words ?? []).length > 0 && (
                              <span>cannabis: {(ev.cannabis_words ?? []).slice(0, 4).join(", ")}</span>
                            )}
                            {ev.error && <span className="text-red-400">{ev.error}</span>}
                          </div>
                          {ev.search_reason && <div className="text-[10px] italic text-white/35">{ev.search_reason}</div>}
                        </div>
                        <div className="flex gap-2">
                          <form action={approveWebsiteAction}>
                            <input type="hidden" name="candidateId" value={c.id} />
                            <input type="hidden" name="vendorId" value={vid} />
                            <Button type="submit" variant="confirm" size="sm">
                              ✓ This is it
                            </Button>
                          </form>
                          <form action={rejectWebsiteAction}>
                            <input type="hidden" name="candidateId" value={c.id} />
                            <Button type="submit" variant="neutral" size="sm">
                              ✕ Not theirs
                            </Button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {without.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
              Still no website ({without.length}) — type one in if you know it
            </h2>
            <div className="grid gap-2 lg:grid-cols-2">
              {without.map((v) => (
                <form
                  key={v.vendor_id}
                  action={setWebsiteManuallyAction}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2"
                >
                  <input type="hidden" name="vendorId" value={v.vendor_id} />
                  <a href={`/admin/vendors/${v.vendor_id}`} className="w-48 truncate text-xs text-white hover:underline">
                    {v.name}
                  </a>
                  <input
                    name="website"
                    placeholder="example.com"
                    className="min-w-0 flex-1 rounded border border-white/15 bg-black px-2 py-1 text-xs text-white"
                  />
                  <Button type="submit" variant="save" size="sm">
                    Save
                  </Button>
                </form>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
