import { requirePermission } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { loadBrandFrame } from "@/lib/cms/newsletter-frame-server";
import { renderOptsFor } from "@/lib/cms/newsletter-canvas-server";
import { BrandFrameEditor } from "@/components/admin/newsletter/BrandFrameEditor";

export const dynamic = "force-dynamic";

/**
 * D243 E-1 (SOP-22 G-121): Newsletter > Brand frame. The same header and
 * footer on every newsletter; only the owner or an admin can change it.
 */
export default async function NewsletterFramePage() {
  const session = await requirePermission("blog.manage");
  const frame = await loadBrandFrame();
  const canEdit = isAdminRole(session.profile.role);
  return (
    <div>
      <AdminPageHeader
        title="Newsletter brand frame"
        subtitle="The header and footer every newsletter shares. You design the body in the canvas."
        breadcrumbs={<Breadcrumbs items={[{ label: "Newsletter Send", href: "/admin/newsletter" }, { label: "Brand frame" }]} />}
        action={<Button href="/admin/newsletter" variant="neutral">Send Center</Button>}
        help={
          <HelpPanel
            id="newsletter-frame"
            title="How the brand frame works"
            steps={[
              "Every newsletter opens with this header (logo, title, tagline, issue number and date) and ends with this footer (social icons, address, hours, phone, 21+ badge, your note).",
              "Pick a style: Classic (logo centred), Bold (a colour band) or Minimal (logo left, date right).",
              "The Greenway wordmark switches by itself: white on the dark look, dark ink on the light look. To use your own logo, upload a PNG for dark emails and, if you like, a second one for light emails.",
              "Issue numbers count every newsletter made in the app. If you sent some before the app, put that number in Issues before the app.",
              "The four required warnings and the unsubscribe link are always printed, whatever you switch off.",
              "Only the owner or an admin can change the frame. Everyone who writes newsletters sees it in the canvas preview.",
              "Press Save frame. Drafts, test emails, the web copy and every send use the new frame straight away.",
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8">
        <BrandFrameEditor initial={frame} renderOpts={renderOptsFor(null, null, { frame, issue: { number: 1, date: "" } })} canEdit={canEdit} />
      </div>
    </div>
  );
}
