import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isAiConfigured } from "@/lib/ai/provider";
import { listMarketingIdeas } from "@/lib/marketing/ideas-store";
import { StrategyAssistant } from "@/components/admin/marketing/StrategyAssistant";
import { IdeaNotebook } from "@/components/admin/marketing/IdeaNotebook";
import {
  CHANNEL_RULES,
  REQUIRED_WARNINGS,
  UNIVERSAL_CONTENT_BANS,
  campaignChecklist,
} from "@/lib/marketing/campaign-rules-core";
import { playsByCategory } from "@/lib/marketing/competitive-playbook-core";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  once: "One-time setup",
};

export default async function MarketingPage() {
  await requirePermission("content.edit");

  const ideas = await listMarketingIdeas(100).catch(() => []);
  const playbook = playsByCategory();

  return (
    <div>
      <AdminPageHeader
        title="Marketing & Advertising"
        subtitle="Your marketing command center: a compliant campaign planner, a playbook for beating nearby competitors, and an AI strategist grounded in your real brand."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Marketing & Advertising" }]} />}
        help={
          <HelpPanel
            id="marketing-strategy"
            title="How to use this page"
            steps={[
              "Start with the competitive playbook — pick one play per category and run it on its cadence.",
              "Planning a campaign? Open its channel in the campaign planner and work the checklist top to bottom.",
              "Want a plan drafted for you? Give the AI strategist a plain-language goal — every draft is scanned against Washington advertising rules before it appears.",
              "Save the good drafts to the idea notebook and action them from there.",
              "For imagery, jump to the Image prompt builder.",
            ]}
          >
            <p>
              Everything here is <strong>drafts and checklists only</strong> — nothing is published
              or sent from this page. The channel rules are taken from the current text of WAC
              314-55-155 and RCW 69.50.369, so if the checklist says a thing is banned, it&apos;s
              banned.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-10 px-5 py-6 sm:px-8">
        {/* ---- Competitive playbook ---- */}
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Competitive playbook — how to win your market
          </h2>
          <p className="mb-4 text-xs text-white/40">
            The legal levers that actually beat nearby stores: intel, price perception, retention,
            experience, and local search. Each play links to the tool in this back office where you
            run it. Pick one play per category and run it on its cadence — consistency wins, not
            stunts.
          </p>
          <div className="space-y-3">
            {playbook.map((group) => (
              <details
                key={group.category}
                className="group rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
                  <span>{group.label}</span>
                  <span className="text-xs font-normal text-white/40">
                    {group.plays.length} play{group.plays.length === 1 ? "" : "s"}
                    <span className="ml-2 inline-block transition-transform group-open:rotate-90">
                      ›
                    </span>
                  </span>
                </summary>
                <div className="space-y-4 border-t border-white/5 px-5 py-4">
                  {group.plays.map((play) => (
                    <div key={play.key} className="rounded-lg border border-white/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-white">{play.title}</h3>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                            {CADENCE_LABEL[play.cadence]}
                          </span>
                          {play.tool && (
                            <Link
                              href={play.tool.href}
                              className="rounded-full bg-[var(--admin-accent)]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/20"
                            >
                              {play.tool.label} →
                            </Link>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-white/55">{play.why}</p>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-white/70">
                        {play.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* ---- Campaign planner (per-channel rules) ---- */}
        <section>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Compliant campaign planner — the rules per channel
          </h2>
          <p className="mb-4 text-xs text-white/40">
            Verified against the current WAC 314-55-155 and RCW 69.50.369. Open the channel
            you&apos;re planning and work the pre-flight checklist before anything ships.
          </p>

          {/* Universal rules banner */}
          <div className="mb-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-gold)]">
              Banned in every channel, every time — WAC 314-55-155(2)(a)
            </h3>
            <ul className="mt-2 grid gap-1 text-xs leading-relaxed text-white/70 sm:grid-cols-2">
              {UNIVERSAL_CONTENT_BANS.map((ban, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[var(--admin-gold)]">✕</span>
                  {ban}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            {CHANNEL_RULES.map((rule) => (
              <details
                key={rule.channel}
                className="group rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
                  <span className="text-sm font-semibold text-white">{rule.label}</span>
                  <span className="flex items-center gap-2 text-xs text-white/40">
                    {rule.warningsRequired ? (
                      <span className="rounded-full bg-[var(--admin-orange)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-orange)]">
                        4 warnings required
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase text-white/40">
                        warnings exempt
                      </span>
                    )}
                    <span className="inline-block transition-transform group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="border-t border-white/5 px-5 py-4">
                  <p className="text-xs leading-relaxed text-[var(--admin-accent)]/90">{rule.edge}</p>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div>
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                        Pre-flight checklist
                      </h4>
                      <ul className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-white/70">
                        {campaignChecklist(rule.channel).map((item, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-[var(--admin-accent)]">☐</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                        Never on this channel
                      </h4>
                      <ul className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-white/70">
                        {rule.prohibitions.map((item, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-red-400">✕</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] leading-relaxed text-white/40">
                        {rule.warningsNote}
                      </p>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>

          {/* The four warnings, copy-ready */}
          <details className="group mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
              <span>The four required warnings — copy-ready text</span>
              <span className="text-xs font-normal text-white/40">
                WAC 314-55-155(7)
                <span className="ml-2 inline-block transition-transform group-open:rotate-90">›</span>
              </span>
            </summary>
            <div className="border-t border-white/5 px-5 py-4">
              <p className="mb-2 text-xs text-white/40">
                Required on all advertising except outdoor signs, each at a type size of at least
                10% of the largest type in the ad. Copy them exactly:
              </p>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-white/80">
                {REQUIRED_WARNINGS.map((w, i) => (
                  <li key={i}>
                    <q>{w}</q>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        </section>

        {/* ---- AI strategist ---- */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Compliant strategy assistant
          </h2>
          <StrategyAssistant aiConfigured={isAiConfigured} />
        </section>

        {/* ---- Idea notebook ---- */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Idea notebook
            </h2>
            <a href="/admin/marketing/midjourney" className="text-sm text-emerald-700 hover:underline">
              Image prompt builder →
            </a>
          </div>
          <IdeaNotebook ideas={ideas} />
        </section>
      </div>
    </div>
  );
}
