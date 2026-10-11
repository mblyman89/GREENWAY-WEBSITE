/**
 * R42 (owner answer Q1) — the footer's WA advertising warnings.
 *
 * Michael's site is age-gated and his LCB enforcement officer told him the
 * WAC 314-55-155(7) warnings don't have to sit inside each banner on an
 * age-gated site; the site carries them here, in the footer of every page. So
 * this text must ALWAYS contain the four statements word-for-word.
 *
 * Same behavior as the <SiteText> it replaces (draft in staff preview,
 * published otherwise, click-to-edit hooks in preview, rendered as plain text
 * exactly like before), plus one safety net: if the
 * stored value is missing a mandated sentence (e.g. the launch copy saved
 * before the rule's July 2026 wording), the canonical text renders instead.
 */
import { getContentForRender, isPreviewActive } from "@/lib/cms/render-content";
import { resolveWarningForRender, WARNING_BLOCK_KEY } from "@/lib/compliance/warning-text-core";

export async function ComplianceWarningText({ className }: { className?: string }) {
  const [stored, preview] = await Promise.all([getContentForRender(WARNING_BLOCK_KEY), isPreviewActive()]);
  const { value } = resolveWarningForRender(stored);
  const previewProps = preview ? { "data-gw-block": WARNING_BLOCK_KEY, "data-gw-editable": "true" } : {};
  return (
    <p className={className} {...previewProps}>
      {value}
    </p>
  );
}
