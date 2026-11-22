import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { listMedia } from "@/lib/media/store";
import { isFluxConfigured } from "@/lib/marketing/flux-client";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { PrintStudio } from "@/components/admin/print-studio/PrintStudio";

/**
 * D263 Print Studio (owner, verbatim): "a designer for creating physical
 * banners, flyers, stickers, custom QR codes, and other various printed ads
 * ... I want to reuse the editor we use for creating the home page hero
 * banner." It mounts the real Banner Studio in print mode (see PrintStudio).
 */
export const dynamic = "force-dynamic";
// FLUX picture tools poll from the browser, but saving a result can take a while.
export const maxDuration = 300;

export default async function PrintStudioPage() {
  await requirePermission("content.edit");
  const [media, fluxConfigured] = await Promise.all([
    listMedia({ status: "published", limit: 200 }).catch(() => []),
    isFluxConfigured().catch(() => false),
  ]);
  const mediaChoices: MediaChoice[] = media
    .filter((m) => /^image\//.test(m.mime_type ?? "") && m.public_url)
    .map((m) => ({ id: m.id, url: m.public_url as string, title: m.title ?? m.filename ?? "Image", usageType: m.usage_type ?? null, mimeType: m.mime_type ?? null }));

  return (
    <div>
      <AdminPageHeader
        title="Print Studio"
        subtitle="Design banners, flyers, signs, flags and stickers at their real printed size, then download print-ready files for Vistaprint or your own printer."
        breadcrumbs={<Breadcrumbs items={[{ label: "Marketing" }, { label: "Print Studio" }]} />}
        helpId="print-studio"
      />
      <div className="px-3 py-5 sm:px-4">
        <PrintStudio mediaChoices={mediaChoices} fluxConfigured={fluxConfigured} />
      </div>
    </div>
  );
}
