/**
 * SiteText — renders an editable content block on the PUBLIC site.
 *
 * Reads the right value (draft when a staff member is previewing, otherwise
 * published) and, in preview mode, tags the element with data attributes so
 * the click-to-edit overlay can show an "✎ Edit" affordance that deep-links to
 * the field editor.
 *
 * Usage (in a public server component):
 *   <SiteText blockKey="home.hero.title" as="h1" className="text-5xl" />
 */
import { type ElementType } from "react";
import { getContentForRender, isPreviewActive } from "@/lib/cms/render-content";
import { sanitizeStaffHtml } from "@/lib/security/html-sanitize";

export async function SiteText({
  blockKey,
  as: Tag = "span",
  className,
  /** Render value as raw HTML (for rich blocks like the compliance warning). */
  html = false,
}: {
  blockKey: string;
  as?: ElementType;
  className?: string;
  html?: boolean;
}) {
  const [value, preview] = await Promise.all([
    getContentForRender(blockKey),
    isPreviewActive(),
  ]);

  const previewProps = preview
    ? {
        "data-gw-block": blockKey,
        "data-gw-editable": "true",
      }
    : {};

  if (html) {
    // S-19: staff-authored rich blocks pass through the allowlist sanitizer
    // before hitting dangerouslySetInnerHTML — a pasted snippet can't smuggle
    // <script>, event handlers, or javascript: URLs onto the public site.
    return (
      <Tag
        className={className}
        {...previewProps}
        dangerouslySetInnerHTML={{ __html: sanitizeStaffHtml(value) }}
      />
    );
  }

  return (
    <Tag className={className} {...previewProps}>
      {value}
    </Tag>
  );
}
