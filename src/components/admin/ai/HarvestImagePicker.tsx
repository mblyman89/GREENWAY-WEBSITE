/**
 * src/components/admin/ai/HarvestImagePicker.tsx — Slice H3.
 *
 * Visual review for the crawler's image reference drafts (research_logos /
 * research_images). Instead of raw URLs, staff see thumbnails and can, per
 * image:
 *   • "💾 Save" → download into the Media Library as a DRAFT
 *     (source=crawl:<url>, license pending review), or
 *   • "★ Save & set as logo" → same download + assign as the vendor/brand
 *     logo (the explicit human publish decision).
 *
 * Server component: each button is a form posting to the caller's server
 * action. Thumbnails render via <SmartImage> (R2 "never a black box"):
 * no-referrer direct load first, admin-only proxy fallback second, and an
 * honest "preview blocked" chip when both fail — nothing is STORED until the
 * human clicks Save.
 */

import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { SmartImage } from "./SmartImage";

export type HarvestImageItem = {
  url: string;
  /** Alt text / logo-detector context shown under the thumbnail. */
  caption: string;
};

/**
 * Parse the crawler's reference-draft lines into image items. Lines look like
 * `alt text — https://…` (research_images) or
 * `[jsonld] context — https://…` (research_logos).
 */
export function parseImageLines(value: string | null): HarvestImageItem[] {
  if (!value) return [];
  const out: HarvestImageItem[] = [];
  for (const line of value.split("\n")) {
    const idx = line.lastIndexOf(" — ");
    const rawUrl = (idx >= 0 ? line.slice(idx + 3) : line).trim();
    if (!/^https?:\/\//i.test(rawUrl)) continue;
    const caption = (idx >= 0 ? line.slice(0, idx) : "").trim();
    out.push({ url: rawUrl, caption });
  }
  return out;
}

export function HarvestImagePicker({
  items,
  entityType,
  entityId,
  vendorId,
  importAction,
  showAssignLogo = true,
}: {
  items: HarvestImageItem[];
  entityType: "vendor" | "brand";
  entityId: string;
  vendorId: string;
  importAction: (formData: FormData) => void | Promise<void>;
  /** Hide the "set as logo" button for generic image candidates if desired. */
  showAssignLogo?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.url}
          className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-black/40"
        >
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-24 items-center justify-center overflow-hidden bg-[#111] p-1"
            title="Open full size in a new tab"
          >
            {/* Remote preview only — nothing is stored until Save is clicked.
                R2: SmartImage never leaves a black box — no-referrer direct
                load → admin proxy fallback → honest "preview blocked" chip. */}
            <SmartImage
              src={item.url}
              alt={item.caption || "candidate image"}
              className="max-h-full max-w-full object-contain"
            />
          </a>
          <div className="flex flex-1 flex-col gap-1.5 p-2">
            <p className="line-clamp-2 text-[10px] leading-tight text-white/50" title={item.caption}>
              {item.caption || "(no context)"}
            </p>
            <div className="mt-auto flex flex-wrap gap-1.5">
              <form action={importAction}>
                <input type="hidden" name="vendorId" value={vendorId} />
                <input type="hidden" name="entityType" value={entityType} />
                <input type="hidden" name="entityId" value={entityId} />
                <input type="hidden" name="imageUrl" value={item.url} />
                {/* Carry the crawler's captured alt text / context so it lands on
                    the Media Library draft (Task A). Empty is fine \u2014 the server
                    action falls back to a sensible default. */}
                <input type="hidden" name="caption" value={item.caption} />
                <button
                  type="submit"
                  className={CHIP_NEUTRAL}
                  title="Download into the Media Library as a draft (license: pending review)"
                >
                  💾 Save
                </button>
              </form>
              {showAssignLogo && (
                <form action={importAction}>
                  <input type="hidden" name="vendorId" value={vendorId} />
                  <input type="hidden" name="entityType" value={entityType} />
                  <input type="hidden" name="entityId" value={entityId} />
                  <input type="hidden" name="imageUrl" value={item.url} />
                  <input type="hidden" name="caption" value={item.caption} />
                  <input type="hidden" name="assign" value="logo" />
                  <button
                    type="submit"
                    className={CHIP_ACTION}
                    title="Save AND assign as the logo (publishes the asset)"
                  >
                    ★ Set as logo
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
