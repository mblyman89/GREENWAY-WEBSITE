import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { isAiConfigured } from "@/lib/ai/provider";
import { listMarketingIdeas } from "@/lib/marketing/ideas-store";
import { StrategyAssistant } from "@/components/admin/marketing/StrategyAssistant";
import { IdeaNotebook } from "@/components/admin/marketing/IdeaNotebook";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  await requirePermission("content.edit");

  const ideas = await listMarketingIdeas(100).catch(() => []);

  return (
    <div>
      <AdminPageHeader
        title="Marketing & Advertising"
        subtitle="Plan compliant campaigns with an AI strategist grounded in your real brand — then build the visuals in the image builder."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Marketing & Advertising" }]} />}
        help={
          <HelpPanel
            id="marketing-strategy"
            title="How the marketing assistant works"
            steps={[
              "Type a plain-language goal (e.g. “grow our newsletter list”, “promote this week’s vendor drop”).",
              "Pick the channel you want to focus on, then draft a compliant strategy.",
              "Every plan is grounded in your real store + carried vendors, and scanned against Washington advertising rules before it appears.",
              "Review and edit — then save the good ones to your idea notebook to action later.",
              "For imagery, jump to the Image prompt builder.",
            ]}
          >
            <p>
              This assistant produces <strong>drafts only</strong> — nothing is published or sent
              anywhere. It refuses plans that trip a Washington I-502 / DOH advertising rule (no
              health/medical claims, nothing appealing to minors, etc.).
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-10 px-5 py-6 sm:px-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Compliant strategy assistant
          </h2>
          <StrategyAssistant aiConfigured={isAiConfigured} />
        </section>

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
