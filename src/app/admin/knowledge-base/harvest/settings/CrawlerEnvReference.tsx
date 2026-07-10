/**
 * CrawlerEnvReference — Slice H8: the crawler-side `.env` knobs, as a
 * READ-ONLY reference on the Harvest Tuning page.
 *
 * WHY REFERENCE-ONLY (deliberate, not a shortcut): the crawler worker reads
 * its configuration from a `.env` file on the owner's Windows VM at startup
 * (crawler/app/config.py — `get_settings()` is cached for the process
 * lifetime). The Vercel-hosted site has no way to write files on the VM, and
 * building a remote-config channel for SECRETS would mean storing the
 * crawler's Supabase service-role key inside the very database that key
 * protects — a circular trust hole. So this panel documents every knob,
 * shows the worker's LIVE effective state (from GET /health), and gives
 * exact rotation runbooks — while the values themselves change only on the
 * VM (edit `.env` → restart the worker).
 *
 * Every variable, default, and behavior below is sourced from
 * crawler/app/config.py and crawler/.env.example — not guessed.
 */
import type { CrawlerHealth } from "@/lib/ai/crawler-client";

type EnvVar = {
  name: string;
  dflt: string;
  secret?: boolean;
  what: string;
  tune?: string;
};

type EnvGroup = { title: string; vars: EnvVar[] };

const ENV_GROUPS: EnvGroup[] = [
  {
    title: "Environment & auth",
    vars: [
      {
        name: "CRAWLER_ENV",
        dflt: "development",
        what: "Set to `production` on the real deployment. Production HARD-REQUIRES CRAWL_ALLOW_DOMAINS (the S-5 safety gate) — the worker refuses to start without an explicit allow-list.",
      },
      {
        name: "CRAWLER_SHARED_SECRET",
        dflt: "(empty — must set)",
        secret: true,
        what: "The auth secret between the site and the worker; sent as the X-Crawler-Secret header on every call. Must be IDENTICAL in the VM's .env and Vercel's CRAWLER_SHARED_SECRET.",
      },
      {
        name: "CRAWLER_PORT",
        dflt: "8200",
        what: "The port uvicorn listens on. Change only together with the Cloudflare tunnel's service mapping.",
      },
    ],
  },
  {
    title: "Supabase & AI provider",
    vars: [
      {
        name: "SUPABASE_URL",
        dflt: "(empty — must set)",
        what: "Your project URL (https://….supabase.co). The worker writes pending drafts to ai_suggestions and nothing else.",
      },
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        dflt: "(empty — must set)",
        secret: true,
        what: "Server-side write key — treat like a root password. Lives ONLY on the VM; never in the site, never in this database.",
      },
      {
        name: "AI_BASE_URL",
        dflt: "https://api.openai.com/v1",
        what: "OpenAI-compatible endpoint for the schema-extraction gap-filling step (same provider the site uses).",
      },
      {
        name: "AI_MODEL",
        dflt: "gpt-4o-mini",
        what: "Model for gap-filling. Small + cheap is right — extraction runs at temperature ≈ 0 and every fact is verified against the page afterwards.",
      },
      {
        name: "AI_API_KEY",
        dflt: "(empty = LLM off)",
        secret: true,
        what: "Leave EMPTY to run CSS-only extraction (free, often enough). Set it to enable the LLM step for the leftover gaps.",
        tune: "A dry-run with it empty is the cheapest way to prove plumbing after any redeploy.",
      },
    ],
  },
  {
    title: "Crawl politeness & hardening",
    vars: [
      {
        name: "CRAWL_MIN_DELAY_SECONDS",
        dflt: "2.0",
        what: "Per-domain minimum delay between fetches — the core politeness knob.",
        tune: "Raise (3–5) if a brand site ever complains or rate-limits; lowering below 2 buys little and looks aggressive.",
      },
      {
        name: "CRAWL_CACHE_TTL_SECONDS",
        dflt: "86400 (24h)",
        what: "On-disk page cache lifetime. Re-researching the same page within the TTL costs nothing.",
        tune: "Raise (e.g. 604800 = 7 days) to make repeat runs cheaper; lower when you're actively iterating on a site that just changed.",
      },
      {
        name: "CRAWL_MAX_PAGES",
        dflt: "25",
        what: "Pages per SINGLE /research request (the vendor-page “Research with the crawler” button). Since the frontier crawl (C2) every fetched page's own links join the queue, so this budget walks the WHOLE site — category pages, product pages, pagination. Batch harvest jobs override this per job with the tier depths you set above.",
        tune: "Raise toward 60–120 for very large vendor catalogs. The coverage report draft tells you when a site needed more (“BUDGET REACHED — N pages still queued”).",
      },
      {
        name: "CRAWL_DYNAMIC_CONTENT",
        dflt: "true",
        what: "Full-page browser capture (C3): scrolls the whole page so lazy-loaded sections/images render, waits for images, removes cookie/newsletter overlays, and clicks visible “load more / show more / view all” buttons before saving the HTML. Features the installed crawl4ai doesn't support are skipped automatically.",
        tune: "Set false only if crawls are too slow and the sites are simple static pages.",
      },
      {
        name: "CRAWL_SCROLL_DELAY_SECONDS / CRAWL_SETTLE_SECONDS",
        dflt: "0.3 / 2.0",
        what: "Pace of the full-page scroll and the settle time before the HTML snapshot — more time lets lazy content finish loading.",
        tune: "Raise (0.5 / 3–4) for image-heavy catalogs that still come back incomplete.",
      },
      {
        name: "CRAWL_PAGE_TIMEOUT_SECONDS",
        dflt: "90",
        what: "Per-page browser time limit. Generous because full-page scans of big catalog pages legitimately take a while.",
      },
      {
        name: "CRAWL_USER_AGENT",
        dflt: "GreenwayBot/1.0 (+greenwaymarijuana.com)",
        what: "The bot's identity string. Keep a real contact email in it so site owners can reach you.",
      },
      {
        name: "CRAWL_RESPECT_ROBOTS",
        dflt: "true",
        what: "Honor robots.txt. Keep true in production — non-negotiable politeness.",
      },
      {
        name: "CRAWL_REALISTIC_HEADERS",
        dflt: "true",
        what: "Send realistic browser headers so public pages render what a human sees (parity, not evasion). Set false to always identify verbatim as GreenwayBot.",
      },
      {
        name: "CRAWL_MAX_RETRIES",
        dflt: "3",
        what: "Retries on transient failures (429/5xx/network) with exponential backoff, honoring Retry-After.",
      },
      {
        name: "CRAWL_BACKOFF_BASE_SECONDS / _MAX_SECONDS",
        dflt: "1.5 / 30",
        what: "Backoff curve for those retries. Defaults are sane; rarely worth touching.",
      },
      {
        name: "CRAWL_PROXY_URL",
        dflt: "(empty = direct)",
        secret: true,
        what: "Optional egress proxy for both browser and HTTP paths. Off by default.",
      },
      {
        name: "CRAWL_ALLOW_DOMAINS",
        dflt: "(empty = any, dev only)",
        what: "Comma-separated hostname allow-list (subdomains included). REQUIRED in production — the worker can only ever research listed hosts.",
        tune: "Add a new vendor's domain here (then restart) before their first harvest in production.",
      },
    ],
  },
  {
    title: "URL seeding (H2) & social",
    vars: [
      {
        name: "CRAWL_SEED_ENABLED",
        dflt: "true",
        what: "Master switch for the URL seeder (site inventory + BM25 scoring before any expensive browser fetch). Soft-disables safely on old crawl4ai or any error.",
      },
      {
        name: "CRAWL_SEED_SOURCE",
        dflt: "sitemap",
        what: "`sitemap` (reads the site's own map), `cc` (Common Crawl index — zero traffic to the site), or `sitemap+cc`.",
        tune: "Try `sitemap+cc` for sites with poor sitemaps.",
      },
      {
        name: "CRAWL_SEED_MAX_URLS",
        dflt: "100",
        what: "Max candidate URLs pulled from the seeder per site (inventory only — no fetches).",
      },
      {
        name: "META_GRAPH_TOKEN",
        dflt: "(empty = social off)",
        secret: true,
        what: "Long-lived Meta Page access token for the sanctioned Instagram Business Discovery API. An access token, never a password (docs/SOCIAL_SETUP.md).",
      },
      {
        name: "META_IG_BUSINESS_ID",
        dflt: "(empty)",
        what: "Greenway's IG Business account id, paired with the token above.",
      },
      {
        name: "META_GRAPH_VERSION",
        dflt: "v21.0",
        what: "Graph API version. Leave alone until Meta deprecates it.",
      },
      {
        name: "CRAWL_CACHE_DIR",
        dflt: ".cache",
        what: "Where the on-disk cache + crash-safe harvest job state live (relative to crawler/). Safe to clear when no job is mid-flight.",
      },
    ],
  },
];

function LiveDot({ on, label }: { on: boolean | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] text-white/70">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          on === undefined ? "bg-white/25" : on ? "bg-[#7ed957]" : "bg-white/30"
        }`}
      />
      {label}: {on === undefined ? "unknown" : on ? "on" : "off"}
    </span>
  );
}

export function CrawlerEnvReference({ health }: { health: CrawlerHealth }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
          Crawler worker knobs — the VM&apos;s .env (reference)
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-white/50">
          These knobs live in <span className="font-mono">crawler\.env</span> on your Windows VM,
          not in this database — the worker reads them once at startup. To change one:{" "}
          <strong className="text-white/70">
            edit the file (<span className="font-mono">notepad .env</span> in the crawler folder),
            save, then restart the worker
          </strong>{" "}
          (Ctrl+C in the uvicorn window, start it again — your CRAWLER_REDEPLOY_COMMANDS.md file has
          the exact steps). Secrets are marked 🔑 and never displayed here.
        </p>
      </div>

      {/* Live worker state — what the .env currently resolves to, per GET /health */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white">Live worker state</h3>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${
              health.ok
                ? "border-[#7ed957]/40 text-[#7ed957]"
                : "border-[#ffd700]/40 text-[#ffd700]"
            }`}
          >
            {health.ok
              ? `online${health.version ? ` · v${health.version}` : ""}`
              : `offline (${health.detail})`}
          </span>
        </div>
        {health.ok ? (
          <>
            <div className="flex flex-wrap gap-2">
              <LiveDot on={health.supabaseConfigured} label="Supabase" />
              <LiveDot on={health.aiEnabled} label="AI gap-filling" />
              <LiveDot on={health.respectRobots} label="robots.txt" />
              <LiveDot on={health.socialConfigured} label="Social (Meta)" />
              <LiveDot on={health.proxyEnabled} label="Proxy" />
            </div>
            <p className="mt-3 text-[11px] text-white/50">
              Domain allow-list:{" "}
              {health.allowDomains && health.allowDomains.length > 0 ? (
                <span className="font-mono text-white/70">{health.allowDomains.join(", ")}</span>
              ) : (
                <span className="text-[#ffd700]/80">
                  empty — any submitted host is allowed (development mode). Production requires an
                  explicit list.
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-xs text-white/50">
            Start the worker (or fix the tunnel) to see its effective configuration here — this
            panel reads the worker&apos;s own <span className="font-mono">/health</span> endpoint,
            so what you see is what the .env actually resolved to.
          </p>
        )}
      </div>

      {/* The full variable reference */}
      <div className="grid gap-4 lg:grid-cols-2">
        {ENV_GROUPS.map((group) => (
          <div key={group.title} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h3 className="mb-3 text-sm font-bold text-white">{group.title}</h3>
            <div className="space-y-3">
              {group.vars.map((v) => (
                <div key={v.name} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-mono text-[11px] font-semibold text-[#7ed957]/90">
                      {v.secret ? "🔑 " : ""}
                      {v.name}
                    </span>
                    <span className="text-[10px] text-white/40">default: {v.dflt}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/55">{v.what}</p>
                  {v.tune ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                      <span className="font-semibold text-[#5ec1ff]/90">Tuning:</span> {v.tune}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Key-rotation runbooks */}
      <div className="rounded-xl border border-[#ffd700]/20 bg-[#ffd700]/[0.03] p-5">
        <h3 className="mb-2 text-sm font-bold text-[#ffd700]">
          🔑 Rotating a key — the exact order matters
        </h3>
        <p className="mb-3 max-w-3xl text-[11px] leading-relaxed text-white/55">
          Keys are deliberately NOT editable from this page: the worker&apos;s secrets live only in
          the VM&apos;s <span className="font-mono">.env</span>, and storing them here would put the
          database&apos;s own master key inside the database it protects. Rotation is a two-minute
          VM task — here&apos;s each recipe:
        </p>
        <div className="space-y-3 text-[11px] leading-relaxed text-white/55">
          <div>
            <p className="font-semibold text-white/75">
              CRAWLER_SHARED_SECRET (site ↔ worker auth) — change BOTH sides in one sitting:
            </p>
            <ol className="ml-4 mt-1 list-decimal space-y-0.5">
              <li>
                Generate a new one on the VM:{" "}
                <span className="font-mono">
                  python -c &quot;import secrets; print(secrets.token_urlsafe(40))&quot;
                </span>
              </li>
              <li>
                Paste it into <span className="font-mono">crawler\.env</span> → restart the worker.
              </li>
              <li>
                Paste the SAME value into Vercel → Project → Settings → Environment Variables →{" "}
                <span className="font-mono">CRAWLER_SHARED_SECRET</span> → redeploy the site.
              </li>
              <li>
                Verify: the Harvest Console shows &quot;worker online&quot;; a mismatch shows 401s.
              </li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-white/75">
              SUPABASE_SERVICE_ROLE_KEY — rotate at the source, then update every holder:
            </p>
            <ol className="ml-4 mt-1 list-decimal space-y-0.5">
              <li>Supabase Dashboard → Project Settings → API → rotate the service_role key.</li>
              <li>
                Update it EVERYWHERE it&apos;s used: the VM&apos;s{" "}
                <span className="font-mono">crawler\.env</span> AND the site&apos;s Vercel env (
                <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span>).
              </li>
              <li>Restart the worker; redeploy the site.</li>
              <li>
                Verify: worker <span className="font-mono">/health</span> shows{" "}
                <span className="font-mono">supabase_configured: true</span>; the back office loads
                data.
              </li>
            </ol>
          </div>
          <div>
            <p className="font-semibold text-white/75">
              AI_API_KEY / META_GRAPH_TOKEN — single-holder keys (VM only):
            </p>
            <ol className="ml-4 mt-1 list-decimal space-y-0.5">
              <li>Issue the new key at the provider (OpenAI dashboard / Meta developer console).</li>
              <li>
                Paste into <span className="font-mono">crawler\.env</span> → restart the worker →
                revoke the old key at the provider.
              </li>
              <li>
                Verify on the live state above: &quot;AI gap-filling: on&quot; / &quot;Social
                (Meta): on&quot;.
              </li>
            </ol>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-white/40">
          Handle secrets over a password manager or secure note — never chat or email. After ANY
          .env change: restart the worker, then confirm the Live worker state panel above reflects
          it.
        </p>
      </div>
    </section>
  );
}
