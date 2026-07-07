/**
 * /admin/knowledge-base/harvest/settings — Harvest Tuning (Slice H7).
 *
 * The control panel for every tunable knob of the KB harvest pipeline:
 * fast-lane bars (H5), freshness cadence + click batches (H6), tier depth
 * presets (H4), and review-inbox bounds. One singleton row
 * (kb_harvest_settings, migration 0098); FAILS OPEN to the vetted defaults
 * when the row/table doesn't exist yet, so this page is safe to ship before
 * the migration is applied.
 *
 * Every knob renders with a full tuning guide: what it does, what raising or
 * lowering it means in practice, the safe range (server-clamped), and the
 * failure mode if you overdo it. Gated by settings.manage (owner/admin).
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { HelpPanel } from "@/components/admin/ux/HelpPanel";
import { KbFlash } from "../../KbFlash";
import {
  HARVEST_CLAMPS,
  HARVEST_DEFAULTS,
  isAllDefaults,
  type HarvestSettings,
} from "@/lib/kb/harvest-settings-core";
import { loadHarvestSettings } from "@/lib/kb/harvest-settings";
import { isCrawlerConfigured, crawlerHealth } from "@/lib/ai/crawler-client";
import { saveHarvestSettingsAction, resetHarvestSettingsAction } from "./actions";
import { CrawlerEnvReference } from "./CrawlerEnvReference";

export const dynamic = "force-dynamic";

type KnobDef = {
  key: keyof HarvestSettings;
  label: string;
  unit: string;
  step: string;
  what: string;
  raise: string;
  lower: string;
  risk: string;
};

type KnobSection = { title: string; blurb: string; knobs: KnobDef[] };

/** The full tuning guide — one entry per knob, written for the operator. */
const SECTIONS: KnobSection[] = [
  {
    title: "Fast lane — what qualifies for one-click batch-accept",
    blurb:
      "A draft only rides the fast lane when the crawler is confident about it AND it isn't thin. Everything else drops to individual review. These two bars are re-checked server-side on every batch-accept — the UI can never sneak a weak draft through.",
    knobs: [
      {
        key: "fastLaneMinConfidence",
        label: "Minimum confidence",
        unit: "0–1 fraction",
        step: "0.01",
        what: "The crawler scores every extracted fact by how strongly the source page supports it. A draft below this score can still be accepted — just one at a time, never in a batch.",
        raise: "Raise it (e.g. 0.90) when batch-accepted drafts have needed edits afterward — fewer drafts qualify, but the ones that do are near-certain.",
        lower: "Lower it (e.g. 0.70) when the fast lane feels starved and you find yourself hand-accepting drafts that were fine — more one-click wins, slightly more trust in the crawler.",
        risk: "Too low and mediocre extractions land in vendor profiles with one bulk click. This is the single most impactful knob on this page — move it in small steps (±0.05) and watch the accept-rate panel on /admin/ai-usage.",
      },
      {
        key: "fastLaneMinChars",
        label: "Minimum length",
        unit: "characters (trimmed)",
        step: "1",
        what: "The thin-content bar. A 12-character 'about' text is technically valid but worthless — this keeps stubs out of the batch-accept path.",
        raise: "Raise it (e.g. 80–120) if batch-accepted profile texts feel too short to be useful.",
        lower: "Lower it (e.g. 20–30) if legitimate short mission statements keep dropping to individual review.",
        risk: "Too high and nearly everything needs manual review (the bar exceeds a normal mission statement); too low and one-line stubs get bulk-accepted.",
      },
    ],
  },
  {
    title: "Freshness cadence — when a site counts as due for re-harvest",
    blurb:
      "Every harvested site has a last-touch timestamp (its newest crawl draft). Older than the cadence = stale = due. The refresh and trickle buttons only queue due sites — never-harvested first, then stalest — so clicks never redo fresh work.",
    knobs: [
      {
        key: "staleAfterDays",
        label: "Stale after",
        unit: "days",
        step: "1",
        what: "The re-harvest cadence for BOTH vendor refresh (Tier 1) and market trickle (Tier 3). Default 90 days = the strategy's quarterly rhythm.",
        raise: "Raise it (e.g. 120–180) if re-harvests rarely find anything new — vendor sites in this industry often change slowly.",
        lower: "Lower it (e.g. 30–60) around heavy market movement (new brands, rebrands, harvest season menus) when you want the KB to track changes faster.",
        risk: "Too low burns crawl time and creates duplicate drafts to review for pages that haven't changed; too high and profiles quietly drift out of date. The compliance angle is mild — drafts are always re-scanned at accept time regardless.",
      },
      {
        key: "refreshBatch",
        label: "Refresh batch size",
        unit: "sites per click",
        step: "1",
        what: "How many due VENDOR sites one 'Refresh' click queues (deep, Tier-1 depth).",
        raise: "Raise it if you have many vendors and want to catch up in fewer clicks — the worker processes one site at a time anyway, so a big batch just means a longer-running job.",
        lower: "Lower it (e.g. 5–10) if you prefer short jobs you can watch finish, or the VM is busy.",
        risk: "A big batch × deep pages = a long job. 25 sites × 25 pages ≈ 625 page fetches; it's crash-safe and resumable, but cancel waits for the current site to finish.",
      },
      {
        key: "trickleBatch",
        label: "Trickle batch size",
        unit: "sites per click",
        step: "1",
        what: "How many due LEAD sites one 'Trickle' click queues (shallow, Tier-3 depth, with the politeness pause between sites).",
        raise: "Raise it to walk the whole WA market in fewer clicks.",
        lower: "Lower it to keep trickle jobs short and unobtrusive.",
        risk: "Remember the pause multiplies: 25 sites × 60s delay adds ~25 minutes of pure waiting on top of crawl time. That's intentional — it's a trickle, not a flood.",
      },
    ],
  },
  {
    title: "Crawl depth presets — pages per site, per tier",
    blurb:
      "Depth is where crawl budget goes. Current vendors earn deep reads; the whole-market pass skims. The crawler worker hard-caps every job at 50 pages/site and stays polite (robots.txt, per-domain rate limit) no matter what you set here.",
    knobs: [
      {
        key: "tier1MaxPages",
        label: "Tier 1 depth (current vendors)",
        unit: "pages per site",
        step: "1",
        what: "Max pages read per site for your current vendors — the deep pass that fills all seven KB target fields (about, mission, products, images, logos…).",
        raise: "Raise it (30–40) for sprawling vendor sites where good content hides deep (big brand catalogs, strain libraries).",
        lower: "Lower it (10–15) if most of your vendors have small sites and jobs feel slow for little gain.",
        risk: "Depth beyond what a site actually has is free (the crawler stops when it runs out of URLs), but on big sites extra depth = more time and more LLM gap-filling cost when the AI key is set.",
      },
      {
        key: "tier2MaxPages",
        label: "Tier 2 depth (prospects)",
        unit: "pages per site",
        step: "1",
        what: "Depth for prospects — used by the Tier-2 preset AND auto-applied when you mark a discovery lead contacted/qualified (the depth bump).",
        raise: "Raise it (15–20) if prospect profiles feel thin when reps walk in.",
        lower: "Lower it (5–8) to keep pursuit bumps cheap.",
        risk: "Prospect drafts stay dark until the lead is promoted, so extra depth here costs crawl time now for value you only see later. Medium is the sweet spot.",
      },
      {
        key: "tier3MaxPages",
        label: "Tier 3 depth (whole market)",
        unit: "pages per site",
        step: "1",
        what: "The shallow skim for the whole-market trickle — enough to grab the homepage, about page, and a menu hint.",
        raise: "Raise it (5–8) if trickle drafts are too thin to judge whether a lead is interesting.",
        lower: "Keep it low (2–3) — that's the whole point of a market-wide pass.",
        risk: "This multiplies across HUNDREDS of lead sites. +2 pages/site over 400 leads is +800 page fetches per full market walk. Small changes are big here.",
      },
      {
        key: "tier3DelaySeconds",
        label: "Tier 3 pause between sites",
        unit: "seconds",
        step: "5",
        what: "The idle pause between one lead site finishing and the next starting — what makes the trickle a slow background hum instead of a burst.",
        raise: "Raise it (120–300) to make trickle jobs maximally gentle and spread over hours.",
        lower: "Lower it (10–30) when you want a market walk to finish sooner. Per-domain politeness (robots.txt + rate limit) still applies on top.",
        risk: "0 is allowed but turns the trickle into a burst — fine occasionally, not what you want on every click. High values just make jobs take hours, which is harmless (they're resumable).",
      },
    ],
  },
  {
    title: "Review inbox bounds — keeping clicks fast and bounded",
    blurb:
      "Guardrails on how much one page load or one click can bite off. These protect responsiveness — they never change WHAT gets accepted, only how much per action.",
    knobs: [
      {
        key: "batchAcceptCap",
        label: "Batch-accept cap",
        unit: "drafts per click",
        step: "1",
        what: "The most drafts one 'Accept all clean drafts' click will process. Every draft in the batch is still individually re-verified (bars + WA I-502 re-scan) — the cap just bounds the batch.",
        raise: "Raise it (100+) after a huge harvest when vendors have piles of clean drafts and you trust the lanes.",
        lower: "Lower it (10–25) if you want batch clicks to stay small enough to eyeball afterwards.",
        risk: "Each draft in the batch runs its own compliance re-scan and DB write — very large caps make the click noticeably slower. It never times out silently; it just takes longer.",
      },
      {
        key: "pendingLimit",
        label: "Inbox load limit",
        unit: "drafts per entity type",
        step: "100",
        what: "How many pending vendor drafts + how many pending brand drafts the review inbox loads and triages per visit.",
        raise: "Raise it if the inbox says it's showing a partial view after an enormous market harvest.",
        lower: "Lower it (300–500) if the review page feels slow to load.",
        risk: "This is a soft window, not data loss — drafts beyond the limit stay pending and appear as the queue drains. Higher = slower page load (every draft is compliance-scanned during triage).",
      },
    ],
  },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default async function HarvestTuningPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const { msg, error } = await searchParams;

  const crawlerOn = isCrawlerConfigured();
  const [settings, health] = await Promise.all([
    loadHarvestSettings(),
    crawlerOn ? crawlerHealth() : Promise.resolve({ ok: false, detail: "not configured" }),
  ]);
  const allDefaults = isAllDefaults(settings);

  return (
    <div>
      <AdminPageHeader
        title="Harvest Tuning"
        subtitle="Every knob of the KB harvest pipeline — tune it, watch a cycle, adjust again"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Harvest Console", href: "/admin/knowledge-base/harvest" },
              { label: "Tuning" },
            ]}
          />
        }
        help={
          <HelpPanel id="harvest-tuning-help" title="How to fine-tune (read this once)">
            <p>
              <strong>The golden rule: change ONE knob at a time, in small steps, then watch a full
              cycle before touching anything else.</strong> A cycle = run a harvest, review the drafts,
              check the accept-rate on <span className="font-mono">/admin/ai-usage</span>. If you move
              three knobs at once you&apos;ll never know which one helped.
            </p>
            <p className="mt-2">
              <strong>Where each knob bites:</strong> the fast-lane bars decide how much lands in
              one-click batch-accept vs. individual review (reviewer time). The cadence decides how
              often sites are re-visited (crawl budget). The depths decide how many pages each visit
              reads (crawl time + AI cost). The inbox bounds keep pages and clicks snappy (they never
              change what gets accepted).
            </p>
            <p className="mt-2">
              <strong>Safety net, in plain terms:</strong> every value is clamped to a safe range on
              save AND on load, the database enforces the same ranges, and the crawler worker keeps its
              own hard ceilings (50 pages/site max, politeness always on). Every accept — batch or
              single — still runs the WA I-502 compliance re-scan at the moment of acceptance. No knob
              on this page can turn that off. And <strong>Reset to defaults</strong> takes you back to
              the vetted numbers in one click.
            </p>
            <p className="mt-2">
              <strong>Symptom → knob cheat-sheet:</strong> &ldquo;batch-accepted drafts needed
              edits&rdquo; → raise confidence. &ldquo;fast lane is always empty&rdquo; → lower
              confidence or length. &ldquo;re-harvests find nothing new&rdquo; → raise stale-after.
              &ldquo;profiles feel outdated&rdquo; → lower stale-after. &ldquo;jobs take forever&rdquo;
              → lower depth or batch size. &ldquo;drafts too thin to judge&rdquo; → raise the relevant
              tier&apos;s depth.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <KbFlash msg={msg} error={error} />

        {/* Status strip */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-xs ${
            settings.persisted
              ? "border-white/10 bg-[#0a0a0a] text-white/60"
              : "border-[#ffd700]/40 bg-[#ffd700]/5 text-[#ffd700]"
          }`}
        >
          <span>
            {settings.persisted
              ? `Saved settings in effect · last saved ${fmtDate(settings.updatedAt)}`
              : "Running on built-in defaults — saving here requires migration 0098 (kb_harvest_settings) to be applied first."}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${
              allDefaults
                ? "border-[#7ed957]/40 text-[#7ed957]"
                : "border-[#5ec1ff]/40 text-[#5ec1ff]"
            }`}
          >
            {allDefaults ? "All knobs at vetted defaults" : "Custom tuning active"}
          </span>
        </div>

        <form action={saveHarvestSettingsAction} className="space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title} className="space-y-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
                  {section.title}
                </h2>
                <p className="mt-1 max-w-3xl text-xs text-white/50">{section.blurb}</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {section.knobs.map((knob) => {
                  const clamp = HARVEST_CLAMPS[knob.key];
                  const current = settings[knob.key];
                  const dflt = HARVEST_DEFAULTS[knob.key];
                  const isDefault = current === dflt;
                  return (
                    <div
                      key={knob.key}
                      className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5"
                    >
                      <div className="mb-1 flex items-start justify-between gap-3">
                        <label htmlFor={knob.key} className="text-sm font-bold text-white">
                          {knob.label}
                        </label>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            isDefault
                              ? "border-[#7ed957]/30 text-[#7ed957]/80"
                              : "border-[#5ec1ff]/40 text-[#5ec1ff]"
                          }`}
                        >
                          {isDefault ? "default" : `default: ${dflt}`}
                        </span>
                      </div>
                      <p className="mb-3 text-xs leading-relaxed text-white/60">{knob.what}</p>
                      <div className="mb-3 flex items-center gap-3">
                        <input
                          id={knob.key}
                          name={knob.key}
                          type="number"
                          inputMode="decimal"
                          defaultValue={current}
                          min={clamp.min}
                          max={clamp.max}
                          step={knob.step}
                          className="w-32 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                        />
                        <span className="text-[11px] text-white/40">
                          {knob.unit} · allowed {clamp.min}–{clamp.max}
                        </span>
                      </div>
                      <div className="space-y-1.5 border-t border-white/5 pt-3 text-[11px] leading-relaxed">
                        <p className="text-white/55">
                          <span className="font-semibold text-[#7ed957]/90">Raise it:</span>{" "}
                          {knob.raise}
                        </p>
                        <p className="text-white/55">
                          <span className="font-semibold text-[#5ec1ff]/90">Lower it:</span>{" "}
                          {knob.lower}
                        </p>
                        <p className="text-white/45">
                          <span className="font-semibold text-[#ffd700]/90">Watch out:</span>{" "}
                          {knob.risk}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <button
              type="submit"
              className="rounded-full bg-[#7ed957] px-6 py-2.5 text-xs font-bold text-black transition hover:brightness-110"
            >
              💾 Save all settings
            </button>
            <p className="text-[11px] text-white/40">
              Values outside the allowed range are clamped to it on save; blank fields keep their
              current value. Changes apply to the NEXT job, review load, or cadence click — running
              jobs keep the settings they started with.
            </p>
          </div>
        </form>

        {/* Reset — its own form so it can't be triggered accidentally by Enter in an input. */}
        <form
          action={resetHarvestSettingsAction}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-[#ffd700]/20 bg-[#ffd700]/[0.03] p-5"
        >
          <button
            type="submit"
            className="rounded-full border border-[#ffd700]/50 px-6 py-2.5 text-xs font-bold text-[#ffd700] transition hover:bg-[#ffd700]/10"
          >
            ↩ Reset everything to defaults
          </button>
          <p className="text-[11px] text-white/40">
            One click back to the vetted numbers ({HARVEST_DEFAULTS.fastLaneMinConfidence} confidence
            · {HARVEST_DEFAULTS.fastLaneMinChars} chars · {HARVEST_DEFAULTS.staleAfterDays} days ·
            batches {HARVEST_DEFAULTS.refreshBatch}/{HARVEST_DEFAULTS.trickleBatch} · depths{" "}
            {HARVEST_DEFAULTS.tier1MaxPages}/{HARVEST_DEFAULTS.tier2MaxPages}/
            {HARVEST_DEFAULTS.tier3MaxPages} · {HARVEST_DEFAULTS.tier3DelaySeconds}s pause · cap{" "}
            {HARVEST_DEFAULTS.batchAcceptCap} · limit {HARVEST_DEFAULTS.pendingLimit}). The change is
            audited like any other save.
          </p>
        </form>

        {/* H8: crawler-side .env reference — read-only. These live on the crawler VM,
            not in the database; the page documents them and shows live worker state. */}
        <CrawlerEnvReference health={health} />
      </div>
    </div>
  );
}
