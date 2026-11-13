import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { listMedia, publicUrlForKey } from "@/lib/media/store";
import { starterCanvas } from "@/lib/cms/newsletter-canvas-core";
import { getCanvasPost, loadCanvas, renderOptsFor } from "@/lib/cms/newsletter-canvas-server";
import { type CanvasMediaChoice } from "@/components/admin/newsletter/NewsletterCanvasEditor";
import { NewsletterCanvasWithAi } from "@/components/admin/newsletter/CanvasAiStudio";
import { isAiConfigured } from "@/lib/ai/provider";
import { imageEngines } from "@/lib/cms/newsletter-ai-server";

export const dynamic = "force-dynamic";

/**
 * D238 N-8a (SOP-22 G-118, F-22-8, Q-22-5 (a)): the in-app newsletter canvas.
 * Canva stays available: a PDF can still be uploaded on the post and sent
 * when "Send this canvas as the email" is off.
 */
export default async function NewsletterCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("blog.manage");
  const { id } = await params;
  if (!isSupabaseServiceConfigured) notFound();
  const post = await getCanvasPost(id);
  if (!post || post.kind !== "newsletter") notFound();

  const [saved, assets, engines] = await Promise.all([loadCanvas(id), listMedia({ status: "published", limit: 200 }).catch(() => []), imageEngines().catch(() => [])]);
  const initial = saved ?? starterCanvas(post.title);
  const media: CanvasMediaChoice[] = assets
    .filter((a) => /^image\/(png|jpeg|gif|webp)$/.test(a.mime_type ?? ""))
    .map((a) => ({ url: publicUrlForKey(a.storage_key) ?? a.public_url ?? "", title: a.title || a.filename }))
    .filter((m) => m.url);

  return (
    <div>
      <AdminPageHeader
        title={`Canvas: ${post.title}`}
        subtitle={`${post.status} · /blog/${post.slug}${saved ? "" : " · new canvas (not saved yet)"}`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Newsletter Send", href: "/admin/newsletter" }, { label: "Canvas" }]} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button href={`/admin/blog/${post.id}`} variant="neutral">Post settings</Button>
            <Button href={`/admin/newsletter?selected=${post.id}`} variant="neutral">Send Center</Button>
          </div>
        }
        help={
          <HelpPanel
            id="newsletter-canvas"
            title="How the canvas works"
            steps={[
              "Add, move and edit sections on the left. The preview on the right is exactly what members get (switch Desktop, Phone or Plain text).",
              "Fill from this week puts the fresh drops, new vendors, deals, blog posts and the culture pick into the empty card sections. Deals that fail the below-cost check are left out.",
              "QR code: type the link, press Make QR, scan the preview with your phone.",
              "Moving GIFs: upload a GIF on an Image section. Outlook for Windows shows only the first frame, so put the key words in the first frame.",
              "The send check runs as you type. Press Run send check to weigh every picture. Press Compress images to shrink heavy ones (new copies are saved; originals are kept).",
              "The footer with the four warnings and the unsubscribe link is always added and cannot be removed.",
              "AI studio (below the selected section): Draft the newsletter writes the headline, intro, notes, button, subject and preview text from this week's facts only. Improve rewrites the selected section. Suggest 5 subjects gives subject ideas. Anything that breaks the copy or compliance rules is not applied.",
              "Picture studio: pick an Image section and ask the AI to edit it (Remove background, Studio clean-up, Brighten, Banner, Seasonal) with GPT Image, Gemini or FLUX, or pick no picture to make a new one. Results are saved to Media as new files; originals are kept.",
              "Send yourself a test, then publish the post and send it from the Send Center (or the Sunday approval).",
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8">
        <NewsletterCanvasWithAi postId={post.id} postTitle={post.title} initial={initial} renderOpts={renderOptsFor(post, null)} media={media} aiConfigured={isAiConfigured} engines={engines} />
      </div>
    </div>
  );
}
