/**
 * src/lib/enrichment/publish-on-photo-server.ts  (D244 round 2, slice R-1)
 *
 * Owner (verbatim): "a product should be publish once it has a picture. the
 * other important details like description and facts can come later."
 *
 * Called right AFTER a person attaches a photo to a product card (detail
 * page upload, library attach, vendor/research import, intake draft attach).
 * The decision is pure (bulk-publish-core photoPublishDecision): a draft
 * with a photo goes live; archived stays archived; ENRICH_PUBLISH_ON_PHOTO=off
 * turns it off. A person's attach is the validating act (AGENTS.md rule 3:
 * attaching stays a person's step - nothing here attaches anything).
 *
 * Never throws: a failed publish leaves the card a draft (it still shows in
 * "Ready to publish") and returns a note. Audited as product.published with
 * reason "photo-attached". KB write-back is best-effort.
 */
import "server-only";
import { getEnrichment, setEnrichmentStatusForKeys } from "@/lib/enrichment/store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { photoPublishDecision, type PhotoPublishDecision } from "@/lib/enrichment/bulk-publish-core";

export const PUBLISH_ON_PHOTO_REASON = "photo-attached";

export type PhotoPublishOutcome = { decision: PhotoPublishDecision; published: boolean; note: string };

export async function publishOnPhoto(
  key: string,
  actor: { userId: string; email?: string | null },
): Promise<PhotoPublishOutcome> {
  try {
    const e = await getEnrichment(key);
    const ids = [...new Set([e?.primary_media_id, ...(e?.image_media_ids ?? [])].filter((x): x is string => Boolean(x)))];
    const hasImage = ids.length > 0;
    // Only a PUBLISHED library photo is served to shoppers.
    let hasPublicImage: boolean | undefined;
    if (hasImage) {
      const { data, error } = await createSupabaseAdminClient().from("media_assets").select("id, status").in("id", ids);
      hasPublicImage = error ? undefined : ((data as { status: string }[] | null) ?? []).some((m) => m.status === "published");
    }
    const decision = photoPublishDecision({ enrichmentStatus: e?.status ?? null, hasImage, hasPublicImage }, process.env.ENRICH_PUBLISH_ON_PHOTO);
    if (decision !== "publish") {
      return {
        decision,
        published: false,
        note:
          decision === "archived"
            ? "It stays archived (publish it by hand if you want it back)."
            : decision === "photo-not-public"
              ? "Not published yet: that photo is still a draft in the media library (rights pending review). Publish the photo, then the product."
              : "",
      };
    }
    const done = await setEnrichmentStatusForKeys([key], "published", actor.userId);
    if (done.length !== 1) return { decision, published: false, note: "It could not be published just now; it is in Ready to publish." };
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email ?? null,
      action: "product.published",
      entityType: "product",
      entityId: key,
      after: { reason: PUBLISH_ON_PHOTO_REASON },
    }).catch(() => {});
    await writeBackOnPublish(key, actor.userId).catch(() => null);
    revalidatePublicMenuSurfaces();
    return { decision, published: true, note: "It has a photo now, so it is live on the menu." };
  } catch (err) {
    return { decision: "publish", published: false, note: `It could not be published just now (${(err as Error).message}); it is in Ready to publish.` };
  }
}
