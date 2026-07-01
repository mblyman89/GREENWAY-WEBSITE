import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listMedia, publicUrlForKey } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/ai/provider";
import { isFluxConfigured } from "@/lib/marketing/flux-client";
import {
  MidjourneyBuilder,
  type ReferenceImage,
} from "@/components/admin/marketing/MidjourneyBuilder";

export const dynamic = "force-dynamic";

export default async function MidjourneyPage() {
  await requirePermission("content.edit");

  const fluxConfigured = await isFluxConfigured().catch(() => false);

  // Published images from the media library become style-reference options.
  const media = await listMedia({ status: "published", limit: 60 }).catch(() => []);
  const references: ReferenceImage[] = media
    .map((m) => {
      const url = m.public_url ?? publicUrlForKey(m.storage_key);
      if (!url) return null;
      if (m.mime_type && !m.mime_type.startsWith("image/")) return null;
      return { id: m.id, url, label: m.title || m.alt_text || m.filename };
    })
    .filter((r): r is ReferenceImage => r !== null);

  return (
    <div>
      <AdminPageHeader
        title="Image prompt builder"
        subtitle="Build one brief — copy a Midjourney prompt or generate directly with FLUX 2 and save into your media library."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Midjourney" }]} />}
        help={
          <HelpPanel
            id="midjourney-builder"
            title="How the prompt builder works"
            steps={[
              "Pick a preset (product hero, lifestyle, menu banner, social, signage) to start.",
              "Optionally type your idea and press AI assist to draft the brief fields — then edit them.",
              "Tune parameters (aspect ratio, version, stylize, chaos) with the sliders.",
              "Copy the Midjourney prompt to paste there, OR click Generate with FLUX 2 Max.",
              "FLUX images save into your media library as drafts — review, then publish.",
            ]}
          >
            <p>Copy builds a Midjourney prompt to paste there. FLUX 2 generates the image directly via API and saves it to your media library. All AI output is a draft to review before publishing.</p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <MidjourneyBuilder references={references} aiConfigured={isAiConfigured} fluxConfigured={fluxConfigured} />
      </div>
    </div>
  );
}
