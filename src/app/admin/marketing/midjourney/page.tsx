import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listMedia, publicUrlForKey } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/ai/provider";
import { getFluxCredits, getFluxDefaultModel, isFluxConfigured } from "@/lib/marketing/flux-client";
import {
  MidjourneyBuilder,
  type ReferenceImage,
  type VideoSource,
} from "@/components/admin/marketing/MidjourneyBuilder";

export const dynamic = "force-dynamic";
// Server actions on this page download finished FLUX files into the media library.
export const maxDuration = 300;

export default async function MidjourneyPage() {
  await requirePermission("content.edit");

  const fluxConfigured = await isFluxConfigured().catch(() => false);
  const [fluxDefaultModel, fluxCredits] = fluxConfigured
    ? await Promise.all([getFluxDefaultModel().catch(() => "flux-2-max"), getFluxCredits().catch(() => null)])
    : ["flux-2-max", null];

  // Published images from the media library become reference options.
  const media = await listMedia({ status: "published", limit: 60 }).catch(() => []);
  const references: ReferenceImage[] = media
    .map((m) => {
      const url = m.public_url ?? publicUrlForKey(m.storage_key);
      if (!url) return null;
      if (m.mime_type && !m.mime_type.startsWith("image/")) return null;
      return { id: m.id, url, label: m.title || m.alt_text || m.filename };
    })
    .filter((r): r is ReferenceImage => r !== null);

  // Recent mp4 clips (any status; FLUX videos save as drafts) can be continued,
  // edited or upscaled on the FLUX Video tab.
  const recent = await listMedia({ limit: 200 }).catch(() => []);
  const videos: VideoSource[] = recent
    .filter((m) => m.mime_type === "video/mp4")
    .slice(0, 60)
    .map((m) => ({ id: m.id, url: m.public_url ?? publicUrlForKey(m.storage_key) ?? "", label: `${m.title || m.filename}${m.status === "draft" ? " (draft)" : ""}` }))
    .filter((v) => v.url.startsWith("https://"));

  return (
    <div>
      <AdminPageHeader
        title="Creative Studio"
        subtitle="FLUX images and FLUX 3 video, Playground-style: your prompt goes to FLUX word for word. There's also a Midjourney prompt builder."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Creative Studio" }]} />}
        help={
          <HelpPanel
            id="midjourney-builder"
            title="How the Creative Studio works"
            steps={[
              "FLUX Image: write your prompt. It's sent to FLUX exactly as typed, the same as the BFL Playground, with nothing added behind your back.",
              "Put the subject first, then the action, style and setting. 30–80 words is BFL's sweet spot. Describe what you want; FLUX has no negative prompts.",
              "Add up to 8 reference images (FLUX.2) or 10 (FLUX 3). FLUX sees them as image 1, image 2… so name them in your prompt.",
              "Settings match the Playground: aspect ratio (or custom), safety tolerance 0–5, output format, prompt upsampling and 1, 2, 3, 4 or 8 images. Seed and model are optional extras.",
              "Results appear as they finish and are saved to your media library as DRAFTS. Nothing goes live automatically.",
              "FLUX Video: text → video, image → video (keyframes), continue, edit or upscale a clip. Pick a quick format (Reel, feed, 16:9…), duration, resolution and audio. Draft first is on by default: a fast HD preview for about a third of the cost, then Enhance renders the same shot at full quality.",
              "Midjourney prompt: builds a copy-paste prompt from a structured brief with AI assist and full Midjourney parameters.",
            ]}
          >
            <p>
              FLUX runs on your BFL account and each image is billed by BFL. The balance shows on the studio, and the exact cost
              shows on every card. Pick the default model and add your API key under Integrations → FLUX. Review every result
              for compliance before publishing.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <MidjourneyBuilder
          references={references}
          videos={videos}
          aiConfigured={isAiConfigured}
          fluxConfigured={fluxConfigured}
          fluxDefaultModel={fluxDefaultModel}
          fluxCredits={fluxCredits}
        />
      </div>
    </div>
  );
}
