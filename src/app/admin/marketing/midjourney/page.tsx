import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
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
        helpId="midjourney-builder"
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
