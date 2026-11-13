import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { listMedia, publicUrlForKey } from "@/lib/media/store";
import { usableCuratedReviews } from "@/lib/cms/curated-reviews-server";
import { starterCanvas } from "@/lib/cms/newsletter-canvas-core";
import { getCanvasPost, loadCanvas, renderOptsFor } from "@/lib/cms/newsletter-canvas-server";
import { frameContextFor } from "@/lib/cms/newsletter-frame-server";
import { type CanvasMediaChoice } from "@/components/admin/newsletter/NewsletterCanvasEditor";
import { NewsletterCanvasWithAi } from "@/components/admin/newsletter/CanvasAiStudio";
import { isAiConfigured } from "@/lib/ai/provider";
import { imageEngines } from "@/lib/cms/newsletter-ai-server";
import { canvasClicksFor } from "@/lib/cms/newsletter-motion-server";
import { CanvasClickReport } from "@/components/admin/newsletter/CanvasClickReport";

export const dynamic = "force-dynamic";

/**
 * D238 N-8a (SOP-22 G-118, F-22-8, Q-22-5 (a)): the in-app newsletter canvas.
 * Canva stays available: a PDF can still be uploaded on the post and sent
 * when "Send this canvas as the email" is off.
 */
export default async function NewsletterCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("blog.manage");
  const { id } = await params;
  if (!isSupabaseServiceConfigured) notFound();
  const post = await getCanvasPost(id);
  if (!post || post.kind !== "newsletter") notFound();

  const [saved, assets, engines, frameCtx] = await Promise.all([loadCanvas(id), listMedia({ status: "published", limit: 200 }).catch(() => []), imageEngines().catch(() => []), frameContextFor(id)]);
  const initial = saved ?? starterCanvas(post.title);
  const clicks = await canvasClicksFor(post.id, saved);
  // D239 N-9: curated reviews with the permission tick (Q-22-2 (a)).
  const reviews = await usableCuratedReviews();
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
            {isAdminRole(session.profile.role) ? <Button href="/admin/newsletter/frame" variant="neutral">Brand frame</Button> : null}
          </div>
        }
        help={
          <HelpPanel
            id="newsletter-canvas"
            title="How the canvas works"
            steps={[
              "Add, move and edit sections on the left. The preview on the right is exactly what members get (switch Desktop, Phone or Plain text).",
              "Full-page editor (D243 E-3): click or drag a section from the library onto the list; drag sections to reorder; ⧉ duplicates; Undo brings back any add, remove, move or template. Templates (Weekly, Sale, Vendor day, Holiday, 4/20) give a finished layout; write over every \"Replace:\" before sending (the send check blocks it until you do).",
              "Section style: pick a background, words colour, links colour, space, rounded box or thin border for the selected section. The readability score should be 4.5:1 or more. Save as section keeps it to reuse in any newsletter (Saved in the library).",
              "New sections: Columns (2 or 3 side by side; they stack on phones) and Picture with words over it (raise the shade if the words are hard to read). Preview tabs: Dark mode shows how the Gmail app and Outlook may invert colours; Inbox shows what Gmail and iPhone Mail show in the list.",
              "Fill from this week puts the fresh drops, new vendors, deals, blog posts and the culture pick into the empty card sections. Deals that fail the below-cost check are left out.",
              "QR code: type the link, press Make QR, scan the preview with your phone.",
              "Moving GIFs: upload a GIF on an Image section, or use the GIF maker (pick 2-10 pictures from Media; it makes an email-sized looping GIF). Outlook for Windows shows only the first frame, so put the key words in the first frame.",
              "Live countdown: add a Live countdown section and set the end time. The timer is drawn each time the email is opened, so it always shows the real time left.",
              "One-tap poll: add a poll with 2-4 answers. Each answer is a tracked link to our site, so a tap is a vote. Clicks by section (below) shows the votes and which sections people tapped.",
              "View in your browser: the email's link opens the hosted copy at /newsletter-web/<slug> once the post is published.",
              "The send check runs as you type. Press Run send check to weigh every picture. Press Compress images to shrink heavy ones (new copies are saved; originals are kept).",
              "Brand frame (D243 E-1): every newsletter opens with the same header (logo, title, issue number and date) and ends with the same footer (social icons, address, hours, 21+, the four warnings and unsubscribe). Only the owner or an admin can change it, at Newsletter > Brand frame. You build the body in between.",
              "The footer with the four warnings and the unsubscribe link is always added and cannot be removed.",
              "AI studio (below the selected section): Draft the newsletter writes the headline, intro, notes, button, subject and preview text from this week's facts only. Improve rewrites the selected section. Suggest 5 subjects gives subject ideas. Anything that breaks the copy or compliance rules is not applied.",
              "Picture studio: pick an Image section and ask the AI to edit it (Remove background, Studio clean-up, Brighten, Banner, Seasonal) with GPT Image, Gemini or FLUX, or pick no picture to make a new one. Results are saved to Media as new files; originals are kept.",
              "Ask the canvas (D243 E-5): type what you want done or a question. The AI looks at the preview, answers and lists the steps it suggests; untick any you do not want, then Apply. Undo brings the old version back; press Save to keep it. It cannot touch the header, footer, warnings or unsubscribe.",
              "Picture tools (D243 E-4): select a section with a picture, pick a tool (Make, Edit with words, Remove background, Erase, Replace what I paint, Extend, Change a colour, Relight, Style look, Variations, Enlarge 2×, AI GIF). For Erase and Replace, paint over the area with the brush. Compare with the before/after slider, then Use it here (Undo puts the old picture back). Erase, Replace and Extend need the FLUX key.",
              "Customer review: pick one from Curated reviews (Blog & Newsletter > Curated reviews). Only reviews the customer said we may quote are listed.",
              "Send yourself a test, then publish the post and send it from the Send Center (or the Sunday approval).",
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8">
        <NewsletterCanvasWithAi postId={post.id} postTitle={post.title} initial={initial} renderOpts={renderOptsFor(post, null, frameCtx)} media={media} aiConfigured={isAiConfigured} engines={engines} reviews={reviews} />
        <CanvasClickReport report={clicks} />
      </div>
    </div>
  );
}
