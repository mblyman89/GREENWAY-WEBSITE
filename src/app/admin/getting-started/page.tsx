import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { HelpPanel } from "@/components/admin/ux";
import { getSetupStatus, SETUP_GUIDE } from "@/lib/admin/setup-status";
import { isAiConfigured } from "@/lib/admin/ai-setup-assistant";
import {
  GettingStartedWizard,
  type WizardStep,
} from "@/components/admin/GettingStartedWizard";

export const dynamic = "force-dynamic";

export default async function GettingStartedPage() {
  await requireStaff();
  const status = await getSetupStatus();

  const steps: WizardStep[] = status.checks.map((c) => {
    const g = SETUP_GUIDE[c.id];
    return {
      id: c.id,
      label: c.label,
      state: c.state,
      why: g?.why ?? c.detail,
      how: g?.how ?? [c.detail],
      time: g?.time ?? "",
      ctaLabel: g?.ctaLabel ?? (c.href ? "Do this now" : undefined),
      ctaHref: g?.ctaHref ?? c.href,
      tip: g?.tip,
    };
  });

  return (
    <div>
      <AdminPageHeader
        title="Getting Started"
        subtitle="A guided walkthrough to get your store fully live — one step at a time, with help at every turn."
        action={
          <Link href="/admin" className="text-sm text-white/60 hover:text-white">
            ← Dashboard
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="getting-started"
          title="How this walkthrough works"
          steps={[
            "Work through the steps on the left in order.",
            "Each step explains why it matters and exactly how to do it.",
            "Click the green button to jump to the page where you complete it.",
            "This page checks your real setup and turns steps green automatically.",
          ]}
        />

        <GettingStartedWizard
          steps={steps}
          completed={status.completed}
          total={status.total}
          aiEnabled={isAiConfigured}
        />
      </div>
    </div>
  );
}
