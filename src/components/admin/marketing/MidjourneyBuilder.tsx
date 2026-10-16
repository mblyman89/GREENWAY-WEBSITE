"use client";

/**
 * MidjourneyBuilder — the Creative Studio tab shell.
 *
 * R62 (owner directive: "a flux that works exactly as it does on their
 * platform… I want to use it for everything"): FLUX is now a Playground-style
 * studio where the prompt is sent verbatim with the BFL Playground controls.
 * The Midjourney copy-paste prompt builder keeps its structured brief on its
 * own tab. Tabs are client-side and every tab stays mounted (hidden), so
 * nothing typed and no running job is lost when switching.
 */
import { useState } from "react";
import { FluxImageStudio } from "./flux/FluxImageStudio";
import { MidjourneyPromptBuilder, type ReferenceImage } from "./MidjourneyPromptBuilder";

export type { ReferenceImage };

type StudioTab = "flux-image" | "midjourney";

const STUDIO_TABS: { key: StudioTab; icon: string; label: string; blurb: string }[] = [
  {
    key: "flux-image",
    icon: "⚡",
    label: "FLUX Image",
    blurb: "Generate images with FLUX exactly like the BFL Playground. Your prompt is sent word for word; results save to the media library as drafts.",
  },
  {
    key: "midjourney",
    icon: "📋",
    label: "Midjourney prompt",
    blurb: "Build a copy-paste Midjourney prompt from a structured brief, with full Midjourney parameters.",
  },
];

export function MidjourneyBuilder({
  references,
  aiConfigured,
  fluxConfigured,
  fluxDefaultModel,
  fluxCredits,
}: {
  references: ReferenceImage[];
  aiConfigured: boolean;
  fluxConfigured: boolean;
  fluxDefaultModel: string;
  fluxCredits: number | null;
}) {
  const [activeTab, setActiveTab] = useState<StudioTab>("flux-image");
  const active = STUDIO_TABS.find((t) => t.key === activeTab) ?? STUDIO_TABS[0];

  return (
    <div className="space-y-5">
      <div>
        <nav aria-label="Creative Studio generators" className="flex flex-wrap gap-1.5 border-b border-[var(--admin-border)] pb-3">
          {STUDIO_TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-current={isActive ? "page" : undefined}
                title={tab.blurb}
                className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                  isActive
                    ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                    : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </nav>
        <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{active.blurb}</p>
      </div>

      <div hidden={activeTab !== "flux-image"}>
        <FluxImageStudio library={references} configured={fluxConfigured} defaultModel={fluxDefaultModel} credits={fluxCredits} />
      </div>
      <div hidden={activeTab !== "midjourney"}>
        <MidjourneyPromptBuilder references={references} aiConfigured={aiConfigured} />
      </div>
    </div>
  );
}
