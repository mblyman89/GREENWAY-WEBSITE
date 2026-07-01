import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listMedia, publicUrlForKey } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/ai/provider";
import {
  MidjourneyBuilder,
  type ReferenceImage,
} from "@/components/admin/marketing/MidjourneyBuilder";

export const dynamic = "force-dynamic";

export default async function MidjourneyPage() {
  await requirePermission("content.edit");

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
        title="Midjourney prompt builder"
        subtitle="Craft professional image prompts for Midjourney — presets, brand-grounded AI assist, references, and correct syntax."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Midjourney" }]} />}
        help={
          <HelpPanel
            id="midjourney-builder"
            title="How the prompt builder works"
            steps={[
              "Pick a preset (product hero, lifestyle, menu banner, social, signage) to start.",
              "Optionally type your idea and press AI assist to draft the brief fields — then edit them.",
              "Tune parameters (aspect ratio, version, stylize, chaos) with the sliders.",
              "Optionally choose a media-library image as a --sref style reference.",
              "Copy the finished prompt and paste it into Midjourney.",
            ]}
          >
            <p>This tool does not call Midjourney — it builds the prompt text for you to paste there. All AI suggestions are drafts to review.</p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <MidjourneyBuilder references={references} aiConfigured={isAiConfigured} />
      </div>
    </div>
  );
}
