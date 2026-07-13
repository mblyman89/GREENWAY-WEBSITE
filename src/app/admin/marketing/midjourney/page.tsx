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
        title="Creative Studio"
        subtitle="Pick where the image will go, describe the idea, and generate at the exact right size with FLUX — or copy a Midjourney prompt from the same brief."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Creative Studio" }]} />}
        help={
          <HelpPanel
            id="midjourney-builder"
            title="How the Creative Studio works"
            steps={[
              "Step 1 — pick the destination (website banner, social post, email header, blog hero, print/in-store). The image is generated at that spot's exact pixel size.",
              "Step 2 — type your idea and press AI assist. Greenway AI drafts the full brief using your store profile and your LIVE weekly deals (e.g. \"a banner for our Monday deal\" uses the real Monday deal). Edit anything.",
              "Step 3 — Generate with FLUX. Results save into your media library as DRAFTS for you to review before publishing. Nothing goes live automatically.",
              "Prefer Midjourney? The same brief builds a copy-paste prompt with all parameters (aspect, stylize, chaos, style reference).",
              "Add up to 8 reference images (product shots, brand assets) so FLUX matches your look.",
            ]}
          >
            <p>
              FLUX is the dominant generator here — a baked-in API pipeline that outputs pixel-perfect images for each destination.
              Midjourney remains as a copy-a-prompt fallback on the same brief. All AI drafting is compliance-scanned
              (no health claims, no youth appeal, no consumption imagery) and everything lands as a draft for human review.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <MidjourneyBuilder references={references} aiConfigured={isAiConfigured} fluxConfigured={fluxConfigured} />
      </div>
    </div>
  );
}
